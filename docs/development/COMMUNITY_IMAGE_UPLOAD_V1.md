# COMMUNITY IMAGE UPLOAD V1 — AUDIT + APPROVAL PROPOSAL

- 기준 HEAD: `79026a5` (main)
- 상태: **APPROVAL_REQUIRED** — 구현 전 STOP. 이 문서는 감사 결과와 승인 대상 변경안이다.
- 이번 STEP에서 한 것: 코드 감사, read-only DB/Storage 조회. **write 0, bucket 생성 0, schema 변경 0, 코드 변경 0.**

## 1. 현재 커뮤니티 구조 (실제 코드 기준)

| 항목 | 현재 |
|---|---|
| `Post` | `id`(cuid) `title` `content`(Text, **평문**) `pinned` `aptName?` `authorId` `createdAt` `updatedAt`. 이미지 필드 없음 |
| `Comment` | `postId` FK `onDelete: Cascade` |
| `User` | `id`(cuid) `email?` `name` `image?` `role` `banned` |
| 목록 | `/community` → `GET /api/community/posts` (20건, author·댓글 수 include) |
| 상세 | `/community/[id]` 서버 페이지(메타데이터) + `post-client.tsx`(SWR, 본문을 텍스트 노드로 렌더) |
| 작성 | `/community/write` (`AuthGate`, 제목/본문/단지 자동완성) → `POST /api/community/posts` (JSON) |
| 수정 | `PATCH /api/community/posts/[id]` API만 존재, **수정 UI 없음** → V1 범위 밖(§17) |
| 삭제 | `DELETE /api/community/posts/[id]` — 작성자 또는 관리자(`isAdminSessionUser`). 게시글 삭제 경로는 이것 하나 |
| 인증 | NextAuth, **JWT session**. `requireUser()`가 비로그인 401 / `banned` 403 |
| 관리자 | `requireAdmin` / `isAdminSessionUser` (pin 라우트 등) |
| 업로드 | 코드 전체에 `type="file"`·`FormData`·업로드 helper **없음** |
| 이미지 렌더 | `next/image` remotePatterns 없음, 기존 화면은 `<img>` 사용. CSP 헤더 없음 |
| Production 데이터 | posts **0**, comments **0** (read-only count) |

## 2. Supabase / Storage 상태

| 항목 | 현재 |
|---|---|
| 연결 | Prisma `DATABASE_URL` → Supabase Postgres(pooler). **Supabase JS 클라이언트 의존성 없음** |
| 앱 코드의 Supabase env 참조 | **없음** (`SUPABASE_*` 변수를 읽는 src 코드 0) |
| 로컬 `.env` | `SUPABASE_URL`, `SUPABASE_KEY` 이름 존재. 키 종류는 **service_role**(값 미출력, role claim만 확인). Vercel 설정 여부는 확인 불가 |
| Buckets | **0개** (read-only `GET /storage/v1/bucket`) |
| `storage.objects` | RLS enabled, storage policy **0개** |
| 이미지 변환/쿼터 코드 | 없음 |
| 인증 연동 | 사용자는 Supabase Auth 사용자가 아니다 → Storage RLS의 `authenticated` 역할로 "작성자만 업로드"를 표현할 수 없다 |

마지막 항목이 설계를 결정한다. **업로드/삭제 권한은 우리 API(NextAuth 세션)가 판정하고, Storage 쓰기는
서버에서 service role로만 한다.** 브라우저는 Supabase 키를 전혀 받지 않는다.

별도 보안 검토 필요 사항 1건을 감사 중 발견해 소유자에게 직접 보고했다(DB 노출 설정 — 이 기능과 독립적인
기존 설정이며 이번 STEP에서 변경하지 않음). 새 테이블을 추가하기 전에 그 결론을 반영해야 한다(§7).

## 3. 권장 아키텍처

```
작성 화면: 사진 선택(최대 5)
  → [클라이언트] 헤더로 형식·크기·픽셀 수 사전 검사 (디코드 전)
  → createImageBitmap(imageOrientation: 'from-image')로 디코드  (한 장씩 순차)
  → canvas에 긴 변 1600px로 축소 → WebP(q0.80) 인코딩, 미지원 브라우저는 JPEG(q0.82)
  → 800KB 초과면 q0.70 재인코딩, 1.5MB 초과면 거부
  → 미리보기(압축 결과 blob URL), 개별 삭제, 선택 순서 유지
등록 버튼
  → 이미지마다 POST /api/community/images  (requireUser, 서버 재검증, service role로 Storage PUT)
  → 전부 성공하면 POST /api/community/posts { title, content, aptName, images:[{path,width,height}] }
       서버: path 소유권(prefix = 세션 userId)·형식 검증 → Storage 존재 확인 → Post + PostImage 트랜잭션 생성
  → 어느 단계든 실패: 이미 올린 이 세션의 객체 삭제 → "사진 업로드에 실패했습니다. 다시 시도해주세요."
```

### 3.1 왜 이 구조인가

| 결정 | 이유 |
|---|---|
| 클라이언트 압축 | 원본(5~15MB)이 서버·Storage로 가지 않는다. 새 dependency 없이 native API(`createImageBitmap`, canvas `toBlob`) |
| canvas 재인코딩 | EXIF 전체(GPS 포함)가 결과에서 빠진다. 방향은 디코드 단계에서 픽셀에 반영 |
| 서버 경유 업로드(이미지당 1요청) | 서버가 저장 **전에** 바이트를 검증한다. 압축본 ≤1.5MB라 Vercel 요청 본문 한도(4.5MB) 안. signed upload URL은 서버가 저장 전 내용을 볼 수 없어 V1에서 제외 |
| 등록 시점 업로드(선택 시점 아님) | 작성 취소·이탈로 생기는 orphan을 구조적으로 줄인다 |
| Storage REST를 `fetch`로 호출 | `@supabase/supabase-js` 추가 불필요(필요 엔드포인트 3개: PUT object, HEAD/info, DELETE prefixes) |
| `<img loading="lazy" decoding="async" width height>` | next.config 변경·Vercel 이미지 최적화 비용 없음, 저장된 width/height로 레이아웃 흔들림 방지 |

### 3.2 서버 검증 (새 dependency 없이)

MIME 헤더를 믿지 않는다. 업로드 API는:
1. `requireUser()` (비로그인 401, 차단 계정 403)
2. 본문 크기 ≤ 1.5MB
3. **매직 바이트**: WebP(`RIFF....WEBP`) 또는 JPEG(`FF D8 FF`)만. PNG·SVG·HEIC·기타 바이너리 거부
   (PNG 입력은 클라이언트에서 WebP/JPEG로 재인코딩되므로 저장 형식에 PNG는 없다)
4. **헤더 파싱으로 크기 확인**: WebP(VP8/VP8L/VP8X), JPEG(SOFn). 파싱 실패 = 손상 이미지로 거부.
   긴 변 ≤ 1600, 짧은 변 ≥ 1
5. 저장 경로·Content-Type·cache-control은 서버가 결정(클라이언트 값 사용 안 함)

한계(정직하게): 서버는 전체 픽셀 디코드를 하지 않는다(sharp 등 미사용). 헤더 유효성까지만 보장한다.
객체는 Supabase 도메인에서 `image/webp`/`image/jpeg`로만 서빙되고 SVG는 저장될 수 없어 active content 위험은 차단된다.

## 4. 제한값

| 항목 | 값 | 근거 |
|---|---|---|
| 게시글당 | 최대 5장 | 요구사항. 클라이언트·업로드 API·게시글 API 3중 검사 |
| 입력 형식 | JPEG, PNG, WebP | `accept="image/jpeg,image/png,image/webp"` |
| HEIC/HEIF | **지원한다고 표시하지 않음** | iOS 사진첩은 이 accept 목록이면 보통 JPEG로 변환해 넘기지만 기기 QA 전 보장 불가. Android에서 HEIC 파일이 들어와 디코드 실패하면 "지원하지 않는 이미지 형식이에요." |
| 원본 크기 | ≤ 10MB / 장 | 요구사항 |
| 원본 픽셀 | ≤ 50MP, 긴 변 ≤ 12,000px (디코드 전 헤더 검사) | 이미지 폭탄 차단. 일반 12MP/50MP 폰 사진 허용. 10MB 한도가 사실상 먼저 걸림 |
| 저장 크기 | 긴 변 1,600px | 모바일 최대 표시 폭(430 CSS px × 3 DPR ≈ 1,290px)을 넘는 선에서 최소 |
| 인코딩 | WebP q0.80 → 미지원 시 JPEG q0.82 | `toBlob` 결과 type으로 판정(추정하지 않음) |
| 목표 | 300~800KB | 800KB 초과 시 q0.70 재시도 |
| 저장 상한 | 1.5MB (서버 강제), bucket 한도 2MB(이중 방어) | |
| 처리 | 한 장씩 순차 | 저사양 Android 메모리/UI 멈춤 방지 |

## 5. Storage 경로

```
bucket: community-images
posts/{userId}/{uploadSessionId}/{uuid}.webp   (JPEG 폴백이면 .jpg)
```
- `userId`: cuid(이메일·이름 아님, 게시글 API가 이미 `authorId`로 공개하는 값). 서버가 세션에서 넣는다.
- `uploadSessionId`, 파일명: `crypto.randomUUID()`. 원본 파일명은 어디에도 저장하지 않는다.
- 게시글 API는 `posts/{세션 userId}/` 로 시작하고 UUID 형식에 맞는 경로만 받는다 → 남의 객체를 자기 글에 붙일 수 없다.

## 6. 인증·권한

| 동작 | 누가 | 강제 위치 |
|---|---|---|
| 이미지 업로드 | 로그인 + 비차단 | 업로드 API `requireUser` |
| 게시글에 연결 | 경로 prefix가 본인 | 게시글 API |
| 읽기 | 누구나(익명 포함) | public bucket 공개 URL |
| 삭제 | 작성자 / 관리자 | 게시글 DELETE API — **DB의 PostImage 경로만** 삭제(클라이언트 경로 입력 사용 안 함) |
| service role 키 | 서버 전용 | `NEXT_PUBLIC_` 금지. 빌드 산출물 client chunk에 키 이름/값 부재를 테스트로 고정 |

## 7. 승인 필요 항목 (정확한 변경안)

### 7.1 Prisma schema (additive)

```prisma
model Post {
  // ...기존 필드 그대로
  images   PostImage[]
}

// COMMUNITY_IMAGE_UPLOAD_V1 — 게시글 이미지. 경로만 저장(바이트는 Storage).
model PostImage {
  id          String   @id @default(cuid())
  postId      String   @map("post_id")
  storagePath String   @unique @map("storage_path")
  sortOrder   Int      @map("sort_order") // 0..4, 선택 순서
  width       Int
  height      Int
  byteSize    Int      @map("byte_size")
  mimeType    String   @map("mime_type")  // image/webp | image/jpeg
  createdAt   DateTime @default(now()) @map("created_at")

  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@unique([postId, sortOrder])
  @@map("post_images")
}
```

JSON 컬럼 대신 별도 테이블인 이유: 삭제 시 경로 조회·정렬 무결성(`@@unique([postId, sortOrder])`)·
경로 중복 방지(`storagePath @unique`)·향후 목록 썸네일(첫 장만 조회)을 DB가 보장한다.

### 7.2 Migration SQL

`prisma/migrations/20260914000000_community_post_images_v1/migration.sql`
```sql
CREATE TABLE "post_images" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_images_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "post_images_storage_path_key" ON "post_images"("storage_path");
CREATE UNIQUE INDEX "post_images_post_id_sort_order_key" ON "post_images"("post_id", "sort_order");
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_fkey"
    FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
- 기존 테이블 변경 없음. DROP/DELETE/UPDATE 없음. posts 0행이라 FK 추가 영향 0.
- 적용: 승인 후 `npx prisma migrate diff`로 위 SQL과 일치 확인 → `npx prisma migrate deploy`.
- **선행 조건**: 새 public 테이블의 DB 노출 설정은 별도 보고한 보안 검토 결론(기존 테이블과 같은 방식으로
  처리할지)을 따른다. 결론 전에는 적용하지 않는다.
- Rollback: `DROP TABLE "post_images";` → `npx prisma migrate resolve --rolled-back 20260914000000_community_post_images_v1` → schema 커밋 revert.

### 7.3 Bucket

Supabase Dashboard(Storage → New bucket) 또는 동일한 REST 1회:
```
POST {SUPABASE_URL}/storage/v1/bucket   (service role, 서버/운영자 콘솔에서만)
{ "id": "community-images", "name": "community-images", "public": true,
  "file_size_limit": 2097152, "allowed_mime_types": ["image/webp", "image/jpeg"] }
```
- public: 익명 읽기 필요, signed URL 발급 비용·만료 처리 없음. 경로가 UUID라 추측 불가.
- Rollback: bucket 비우기 → 삭제(현재 bucket 0개라 다른 기능 영향 0).

### 7.4 Storage policies

**추가하지 않는다(의도적으로 0개 유지).**
- `storage.objects`는 RLS enabled + policy 0 → anon/authenticated는 INSERT/UPDATE/DELETE/목록조회 불가.
- 공개 bucket의 `/object/public/...` 읽기는 policy 없이 동작.
- 쓰기·삭제는 service role(RLS 우회)을 쓰는 우리 API만 가능 → 권한 판정은 NextAuth 세션 기준 한 곳.
- "authenticated owner only" RLS는 사용자가 Supabase Auth 사용자가 아니라 표현할 수 없다(§2).

### 7.5 Env (Vercel Production/Preview)

| 이름 | 용도 | 비고 |
|---|---|---|
| `SUPABASE_URL` | Storage REST base | 로컬 `.env`에 이름 존재, Vercel 여부 확인 필요 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 Storage 쓰기/삭제 | **권장: 새 이름.** 로컬의 `SUPABASE_KEY`는 service role인데 이름이 일반적이라 anon 키로 오인해 클라이언트에 노출될 위험이 있다. 코드는 새 이름만 읽는다 |

## 8. Orphan 정리

| 상황 | 처리 |
|---|---|
| 업로드 일부 실패 | 클라이언트가 이 세션 객체 삭제 요청(`DELETE /api/community/images?session=`) — 서버가 `posts/{세션 userId}/{session}/` prefix만 삭제 |
| 업로드 성공 + 게시글 생성 실패 | 게시글 API가 같은 요청 안에서 해당 경로 삭제 후 오류 반환 |
| 등록 도중 탭 종료 | 남을 수 있음 → **sweeper**: DB에 없는 24시간 이상 된 객체 삭제. 운영 삭제라 V1에서는 dry-run 스크립트까지만, 실행은 별도 승인 |
| 삭제 실패 | 무시하지 않고 `[community-image-orphan]` 구조화 로그(postId/경로) → sweeper 대상 |

## 9. 게시글 삭제

```
권한 확인(작성자/관리자) → PostImage 경로 조회 → prisma.post.delete (PostImage cascade)
→ Storage DELETE(prefixes) 1회 재시도 → 실패 시 [community-image-orphan] 로그, 응답은 성공(글은 삭제됨)
```
- DB 먼저: Storage 먼저 지우고 DB 삭제가 실패하면 "글은 있는데 사진이 깨진" 상태가 사용자에게 보인다.
- **CDN 캐시**: 공개 객체는 CDN에 캐시될 수 있어 삭제 직후에도 잠시 URL이 열릴 수 있다. V1 `cache-control: max-age=3600`
  (영구 캐시 안 함). 삭제 후 접근 여부는 기기 QA 항목.

## 10. 화면

- **작성**: `[사진 추가] 0/5` 버튼(48px), 가로 스크롤 미리보기 카드(각 우상단 X 44px 터치 영역), 5장이면 버튼 비활성.
  압축 중 카드에 진행 표시, 등록 중 "사진을 업로드하고 있어요" + 버튼 비활성, 등록 중 이탈 시 `beforeunload` 확인.
- **상세**: 본문 아래. 1장 = 폭 100%. 2~5장 = 모바일 세로 목록(폭 100%, height auto, radius 12px, 원본 비율, crop 없음),
  데스크톱은 최대 폭 제한. `alt="게시글 이미지 N"`, `loading="lazy"`(첫 장 제외), `width/height` 지정.
- **목록 썸네일**: **P2로 분리**(목록 쿼리·egress 증가, V1 핵심 아님).
- 이미지 없는 기존 글: `images` 빈 배열 → 기존 렌더 그대로.
- 오류 문구: "사진은 최대 5장까지 올릴 수 있어요." / "한 장당 최대 10MB까지 올릴 수 있어요." /
  "지원하지 않는 이미지 형식이에요." / "사진 업로드에 실패했습니다. 다시 시도해주세요."

## 11. 비용 추정

압축 결과 크기는 사진 내용에 따라 달라 **기기 QA로 실측 전까지 추정치**다(가정: 평균 400KB/장).

| 이미지 글 | 글당 평균 | 저장량 |
|---|---|---|
| 1,000 | 3장 | ≈ 1.2GB |
| 5,000 | 3장 | ≈ 6GB |

Egress는 상세 조회 × 표시된 장 수 × 크기(lazy loading으로 스크롤한 장만). 예: 월 50,000 상세 조회 × 평균 1.5장 로드 × 400KB ≈ 30GB/월.
Supabase 플랜의 Storage/egress 포함량은 대시보드에서 확인 필요(이 감사는 플랜 정보를 조회하지 않았다).

측정 hook: 업로드 API 응답에 `byteSize`, 게시글 생성 시 `[community-images] count bytes` 서버 로그 1줄(DB 기록 없음).

## 12. 테스트 계획 (승인 후 구현 시)

요청된 25개 항목을 매핑:
- 순수 함수 단위: 개수 제한(4), 크기(5), 매직바이트/MIME(6·7·8), 헤더 크기·픽셀 한도(9), 경로 생성·UUID(12), 순서(21), prefix 소유권
- 압축 파이프라인 계약(10·11): 브라우저 API는 주입 가능한 인터페이스로 분리해 호출 순서·`imageOrientation` 옵션·출력 긴 변을 검증. 실제 회전 결과는 기기 QA
- API: 비로그인/차단 업로드 거부(13·14), 작성자/비작성자/관리자 삭제(16·17·18), DB 경로 기반 Storage 삭제(19), 생성 실패 시 정리(20) — Storage/DB는 fake 주입
- 렌더: 이미지 없는 글(1·22), lazy·alt·width/height(23), 모바일 레이아웃 CSS 계약(24)
- 보안: service role 키 이름이 client 코드/`.next/static`에 없음(25)
- 실제 업로드/공개 읽기(2·3·15)는 bucket 생성 후 Preview 환경 QA

## 13. 기기 QA (필수, 자동화 불가)

Android Chrome 실기기: 글쓰기 → 갤러리 선택 → 1장/5장 → 미리보기 → 개별 삭제 → 등록 → 상세 표시(세로·가로 사진 방향)
→ 로그아웃 후 읽기 → 삭제 → 삭제 후 URL 접근. 카메라 직접 촬영. 저장 결과 크기 실측, EXIF/GPS 부재 확인.
iOS Safari: HEIC 사진 선택 시 JPEG 변환 여부, WebP 인코딩 폴백(JPEG) 동작.

## 14. 승인 후 진행 순서

1. 보안 검토 결론 반영 방식 결정 → 2. env 추가(Vercel) → 3. migration 적용 → 4. bucket 생성
→ 5. 구현(업로드 API, 게시글 API 확장, 작성/상세 UI, 삭제 정리) + 테스트 → 6. Preview 배포 기기 QA → 7. main 배포

승인 없이 가능한 부분(클라이언트 압축·검증 순수 모듈, UI 컴포넌트)은 코드만으로는 기능이 동작하지 않으므로,
요청의 STOP 원칙에 따라 이번 STEP에서 미리 구현하지 않았다.
