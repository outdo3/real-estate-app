# COMMUNITY IMAGE UPLOAD V1

- 감사/제안: `c2b6748` (APPROVAL_REQUIRED) → 사용자 승인: "Vercel 서버 env 추가 + PostImage additive migration(least privilege)
  + community-images bucket 생성" → 구현 기준 HEAD `4d53769`
- 범위: 글쓰기 사진 첨부(최대 5장), 상세 표시, 게시글 삭제 시 정리. **목록 썸네일·글 수정·드래그 정렬·orphan cron 제외.**

## 1. 구성 한눈에

```
[브라우저 /community/write]
  사진 선택(accept=jpeg,png,webp, 최대 5) → 한 장씩 순차 전처리
    헤더 검사(형식·10MB·50MP·긴 변 12,000) → createImageBitmap(imageOrientation:'from-image')
    → canvas 긴 변 1600 → WebP q0.80 (브라우저가 WebP를 못 만들면 JPEG q0.82)
    → 800KB 초과 시 q0.70 재인코딩 → 1.5MB 초과 거부 → 압축본 미리보기(object URL)
  [등록]
    → 사진마다 POST /api/community/images?session=<uuid>  (압축본 바이트, 순차)
         서버: requireUser · 매직바이트/헤더 크기/EXIF 검사 · 세션당 5장 · service role로 Storage 저장
         응답: path, public url, width, height, bytes, mimeType, **서명 영수증 token**
    → 전부 성공 → POST /api/community/posts { title, content, aptName, images:[{token}] }
         서버: 영수증 서명·만료·소유자·중복 검증 → Storage 존재 확인 → Post + PostImage nested create(단일 트랜잭션)
    → 어느 단계든 실패: 글 생성 안 함 + 이 세션 업로드 정리 + "사진 업로드에 실패했습니다. 다시 시도해주세요."

[상세 /community/[id]]  GET이 images(sortOrder asc) → { url, width, height, sortOrder } → 본문 아래 세로 목록
[삭제]  권한 → DB에서 경로 → post.delete(PostImage cascade) → Storage 삭제(1회 재시도) → 실패 시 orphan 로그
```

## 2. Schema / Migration

`prisma/migrations/20260914100000_community_post_images_v1/migration.sql` — 2026-09-14 Production `migrate deploy` 적용.

```prisma
model PostImage {
  id        String   @id @default(cuid())
  postId    String   @map("post_id")
  path      String   @unique @map("path")
  sortOrder Int      @map("sort_order")
  width     Int
  height    Int
  bytes     Int
  mimeType  String   @map("mime_type")
  createdAt DateTime @default(now()) @map("created_at")
  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  @@unique([postId, sortOrder])
  @@map("post_images")
}
// Post: images PostImage[]
```

- 제안의 `@@index([postId, sortOrder])` 대신 `@@unique`: 같은 글에 같은 순번이 두 번 들어가는 상태를 DB가 막는다(인덱스 역할도 겸함).
- SQL: CREATE TABLE + unique index 2 + FK(ON DELETE CASCADE). 기존 테이블 변경 없음(`prisma migrate diff` 출력과 동일).
- 적용 후 확인: 테이블 존재, FK cascade, 인덱스 3개, posts 0 / comments 0 / post_images 0 불변.

### Least privilege

이 프로젝트의 public schema default privileges는 새 테이블을 anon/authenticated/service_role에 자동 grant한다.
앱은 Prisma로 테이블 owner(`postgres`, BYPASSRLS)를 쓰므로 필요 없다 → migration에서 **이 테이블만**:

- `REVOKE ALL ... FROM anon, authenticated, service_role` (역할 존재 확인 후)
- `ENABLE ROW LEVEL SECURITY`, policy 0 (owner는 영향 없음, API 역할은 행 0 — Data API 재활성화 대비 심층 방어)

적용 후 grant 보유자: `postgres`만. 기존 테이블의 grant는 건드리지 않았다(별도 정리 과제).

## 3. Storage

| 항목 | 값 |
|---|---|
| bucket | `community-images` — public, `file_size_limit` 2MB, `allowed_mime_types` `image/webp`, `image/jpeg` |
| 생성 | `scripts/community/create-community-images-bucket.ts --apply` (idempotent, 재실행 시 설정 비교만) |
| 경로 | `posts/{userId}/{uploadSession uuid}/{uuid}.webp\|jpg` — 서버가 결정. 원본 파일명·이메일·이름 없음 |
| policy | **0개(의도적)**. 브라우저는 Storage에 직접 쓰지 않는다. 쓰기/삭제는 서버 API가 service role로만 |
| 캐시 | 업로드 시 `cache-control: max-age=3600` → 응답 `public, max-age=3600` |
| 덮어쓰기 | `x-upsert: false` — 같은 경로 재업로드 거부 |

`scripts/community/verify-community-images-storage.ts` 실측(검증 객체는 스크립트가 삭제, 잔여 0): **13/13 PASS**
— service role 업로드/존재/목록, 익명 공개 읽기 200, 무인증·잘못된 키 업로드 거부, 무인증 삭제 거부(객체 유지),
bucket이 `image/png`·`image/svg+xml`·2MB 초과 거부, upsert 없는 덮어쓰기 거부, 삭제 후 존재 false.

**삭제 직후 공개 URL은 HTTP 200이 한동안 유지된다(CDN 캐시).** 캐시 시간은 최대 1시간으로 제한했고, V1에서 purge
인프라는 추가하지 않았다. "삭제 = 즉시 접근 불가"가 아니라 "최대 캐시 시간 뒤 접근 불가"다.

## 4. Env (Vercel)

| 이름 | Production | Preview | 비고 |
|---|---|---|---|
| `SUPABASE_URL` | 있음(기존) | 있음(기존) | |
| `SUPABASE_SERVICE_ROLE_KEY` | **추가** | **추가** | Sensitive. 값은 로컬 `.env`에서 stdin으로만 전달(출력·인자 노출 없음) |
| `SUPABASE_KEY` | 있음(기존) | 있음(기존) | 앱 코드는 읽지 않는다(스크립트 폴백만). 정리는 별도 |

앱에서 service role 키를 읽는 파일은 `src/lib/supabase/server-storage.ts` 하나(`import 'server-only'`). 테스트가 고정.

## 5. 압축 정책

| 항목 | 값 |
|---|---|
| 입력 | JPEG, PNG, WebP. **HEIC 미표기**(디코드 실패 시 "지원하지 않는 이미지 형식이에요.") |
| 원본 한도 | 10MB, 50MP, 긴 변 12,000px — 디코드 **전** 헤더로 검사(이미지 폭탄) |
| 저장 | 긴 변 1600px(확대 안 함), WebP q0.80 / JPEG q0.82 폴백, 800KB 초과 시 q0.70, 1.5MB 초과 거부 |
| WebP 판정 | 추정하지 않고 `toBlob` 결과 Blob의 `type`으로 판정 |
| 방향 | `createImageBitmap(..., { imageOrientation: 'from-image' })` |
| EXIF/GPS | 결과는 항상 canvas 재인코딩 산출물. 서버는 EXIF 블록이 있는 저장본을 거부(이중 보장) |
| 메모리 | 한 장씩 순차, 인코딩 후 canvas 0×0, bitmap close, 미리보기 object URL은 삭제·언마운트 시 해제 |
| 투명 PNG | JPEG 폴백 시 흰 배경 |

### 실제 Chrome(153) API 계약 확인

인증·앱과 무관한 페이지에서 브라우저 API만 실행:
- 4032×3024 JPEG에 EXIF Orientation=6 + GPS 표식 문자열 주입 → `createImageBitmap(from-image)` 결과 **3024×4032**,
  좌상단 표식이 우상단으로 이동(90° 시계 방향 — 정상).
- 1200×1600 재인코딩 WebP/JPEG 결과에 `Exif`·GPS 표식 바이트 **없음**.
- 실제 Chrome 출력 헤더(WebP `VP8X`+ICCP, JPEG JFIF+ICC APP2)가 서버 `checkStoredImage` 통과(1200×1600, EXIF 없음).
- 합성 테스트 이미지 크기(수십 KB)는 실제 사진 대표값이 아니다 → **실제 사진 크기는 기기 QA 항목**(§9).

## 6. 보안

- 업로드: `requireUser`(비로그인 401, 차단 403). 정리(DELETE)는 로그인만 요구하되 **본인 세션 prefix + DB에 연결 안 된 객체만**.
- MIME·확장자 불신: 매직 바이트 + 헤더 크기 파싱. SVG·HEIC·PNG(저장본)·임의 바이너리·SOF 없는 JPEG·잘린 WebP 거부.
- 게시글 연결: 업로드 영수증을 HMAC-SHA256으로 서명(키 = `NEXTAUTH_SECRET`에서 용도 전용 파생, 새 secret 없음, 6시간 만료).
  클라이언트가 보낸 경로·가로·세로는 쓰지 않는다. 남의 영수증 403, 위조·변조·만료·중복·이미 정리된 객체 400.
- 삭제: 지울 경로는 DB에서만 읽는다. 라우트가 소유자/관리자 검사 후 핸들러가 한 번 더 확인.
- 키 유출 점검(빌드 산출물): `.next/static`에서 키 지문·`SUPABASE_SERVICE_ROLE_KEY`·`service_role`·`storage/v1` 0건, public source map 0.
- Data API: OFF 유지(이번 STEP에서 변경 없음). `post_images`는 API 역할 grant 없음 + RLS.

## 7. Orphan

| 상황 | 처리 |
|---|---|
| 업로드 중 일부 실패 | 클라이언트가 `DELETE /api/community/images?session=` → 서버가 본인 세션의 미연결 객체 삭제 |
| 업로드 성공 + 글 생성 실패 | 글 API가 같은 요청에서 삭제(1회 재시도), 클라이언트도 세션 정리 호출 |
| 등록 중 탭 종료/네트워크 끊김 | **남을 수 있다.** V1 자동 정리 없음 → 후속 COMMUNITY IMAGE ORPHAN CLEANUP V1 |
| 정리 실패 | `[community-image-orphan]` error 로그(postId/경로) — 조용히 무시하지 않음 |

등록 중에는 `beforeunload` 확인과 취소 버튼 비활성으로 이탈을 줄인다.

## 8. 화면

- 글쓰기: `사진 추가 n/5`(44px), 88px 미리보기 가로 스크롤(썸네일만 cover), 각 카드 `n/5` 순번과 44px 삭제 영역,
  처리 중 "준비 중", 등록 중 "사진을 업로드하고 있어요 (i/n)" → "게시글을 등록하고 있어요", 버튼 "업로드 중...".
- 상세: 본문 아래 `<ul>` 세로 목록, `width:100%; height:auto; max-width:720px; radius 12px`, 자르지 않음,
  `loading="lazy" decoding="async" width height alt="게시글 이미지 N"`. `next/image`·next.config 변경 없음.
- 사진 없는 글: `images: []` → 기존 렌더 그대로. 목록 API는 사진을 조회하지 않는다.

## 9. 검증

| 항목 | 결과 |
|---|---|
| `src/lib/community/community-images.test.ts` | 28/28 (요청 30항목 전부 매핑 + migration 계약) |
| 기존 커뮤니티 테스트 포함 | 68/68 |
| src 전체 | **1812/1812** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 기존 `scripts/`·`tmp/`, src 0, 신규 scripts 0 |
| eslint(변경 경로) | exit 0 |
| `npm run build` | exit 0, `/api/community/images` 포함 |
| 로컬 `next start` | 비로그인 업로드/정리/사진 포함 글 생성/삭제 401, 없는 글 404, 목록·/community·/community/write 200 |

Preview QA: **불가**. Vercel Preview에는 `DATABASE_URL`이 없고(Production 전용) OAuth 콜백도 Production 호스트 기준이라
Preview에서 로그인·DB가 동작하지 않는다. Preview에 DB를 연결하는 것은 이번 승인 범위 밖이라 하지 않았다.

Production QA / 기기 QA: §10.

## 10. Production / 기기 QA

### 10.1 Production QA (e-jip.com, `0685583`, Vercel 배포 성공 06:09:57 UTC)

데스크톱 Chrome 153, 로그인된 브라우저에서 **실제 배포 번들의 글쓰기 화면**을 사용. 파일 선택창 대신 같은 `<input type=file>`에
DataTransfer로 파일을 넣었다(이후 전처리·업로드·등록은 앱 코드 그대로). 입력은 합성 사진형 이미지다.

| 확인 | 결과 |
|---|---|
| 6장 동시 선택(JPEG 3.1MB×2 중 1장 EXIF Orientation=6, PNG 5.4MB, WebP 0.8MB, JPEG 0.47/0.27MB) | 5장 수락, "사진은 최대 5장까지 올릴 수 있어요.", 버튼 `5/5` 비활성, 순번 `1/5`~`5/5` |
| 미리보기 크기 | 3024×4032→1200×1600, **Orientation=6 가로 4032×3024→1200×1600(세로)**, PNG 1170×2532→739×1600, WebP 2400×1600→1600×1067, 1600×1200 유지 |
| 미리보기 삭제 버튼 | 5→4, `4/5` |
| 한 장 추가 후 순서 | 삭제한 3번 자리 없이 새 사진이 5번으로 추가 |
| 등록 중 | 버튼 "업로드 중...", "사진을 업로드하고 있어요 (3/5)", 취소 비활성 |
| 등록 결과 | 상세로 이동, 이미지 5개, `loading=lazy` `decoding=async`, alt "게시글 이미지 1~5", width/height 속성 = 저장 크기 |
| 익명 상세 API | images 필드 `url,width,height,sortOrder`만, sortOrder 0~4 |
| 익명 이미지 요청 | 5/5 HTTP 200, `image/webp`, `public, max-age=3600`, 바이트에 `Exif`·GPS 표식 **없음** |
| 방향 영구 반영 | Orientation=6 원본의 좌상단 빨간 표식이 저장본 **우상단**에 위치 |
| DB 행 | 5행, 바이트 수가 서빙 객체와 일치, 경로 소유자 = 작성자, 경로 형식 일치 |
| 삭제(API DELETE) | 200, 상세 404, DB 행 0, 전체 사용자 `posts/*` 객체 **0**, posts/comments/post_images 0으로 복귀 |
| 삭제 후 공개 URL | 캐시 우회 요청 5/5 HTTP 400(원본 삭제 확인), 캐시 우회 없는 요청 중 2/5는 200(CDN 캐시 창) |
| 실패 경로 | 실제 WebP 업로드 200 → JPEG로 위장한 SVG 415 → 위조 영수증 글 생성 400(글 미생성) → 세션 정리 `removed:1` → 공개 URL 400 |
| 레이아웃 | 창을 390px로 줄였으나 이 환경의 Chrome 최소 폭 때문에 뷰포트 767px. 767px에서 가로 넘침 없음, 이미지 비율 = 저장 비율 |
| Data API | 여전히 OFF(서버 키로도 503, `/post_images` 503) |

실측 저장 크기(합성 입력이라 실제 사진 대표값 아님): 25,352 / 24,892 / 53,854 / 231,766 / 27,010 bytes, 합계 362,874 bytes.
원본 합계(선택 5장) 약 7.8MB → 저장 0.36MB. **실제 폰 사진 기준 크기는 아래 기기 QA에서 측정 필요.**

측정하지 못한 것(정직하게):
- UI 멈춤: 자동화 탭이 백그라운드라 requestAnimationFrame이 돌지 않았고(프레임 0) 타이머가 제한돼 처리 시간(9.6s/장)도 부풀려졌다 → 무효.
- 360/375/390px 레이아웃: 위 창 최소 폭 제한으로 미확인.
- 게시글 삭제 버튼 UI 흐름: 네이티브 `confirm()` 대화상자가 자동화를 막아 동일 API를 페이지에서 직접 호출했다.

### 10.2 기기 QA (필수, 미실시)

Android Chrome 실기기: 갤러리 1장/5장 선택, 카메라 촬영, 세로·가로 사진 방향, 미리보기 삭제, 등록, 로그아웃 후 읽기, 글 삭제,
실제 사진 원본 MB → 저장 KB(최소 3장), 5장 처리 중 화면 멈춤 여부, 360/375/390px 레이아웃.
iOS Safari: 사진첩 HEIC 선택 시 동작, WebP 인코딩 불가 시 JPEG 폴백.

## 11. 비용·크기

- 저장: 사진당 목표 300~800KB, 상한 1.5MB. 원본은 저장하지 않는다.
- 전송: 상세에서 lazy loading(스크롤한 장만). 목록은 사진을 싣지 않는다.
- 측정 hook: 업로드 성공 시 `[community-images] uploaded {bytes, mimeType}`, 글 생성 시 `[community-images] post created {count, bytes}` 서버 로그(DB 기록 없음).

## 12. 알려진 한계

- 서버는 전체 픽셀 디코드를 하지 않는다(헤더 유효성·EXIF 부재까지). 새 이미지 처리 의존성 추가 안 함.
- 탭 종료로 인한 orphan 자동 정리 없음. 사용자별 업로드 속도 제한 없음(세션당 5장·로그인·차단 계정 차단만).
- 삭제 후 최대 1시간 CDN 캐시.
- HEIC: iOS 사진첩의 자동 JPEG 변환 여부는 기기 QA 전 미확인. Android HEIC 파일은 디코드 실패 시 거부.
- Preview 환경에서 커뮤니티 QA 불가(§9).
- 목록 썸네일, 글 수정 시 사진 편집, 순서 변경: 미구현(P2).
