# COMMUNITY EDITOR V2 — DESIGN AUDIT (텍스트/사진 블록 + 글 수정)

- 기준 HEAD: `b6f8b99` (main)
- 상태: **승인·구현 완료** — 구현 기록은 `docs/development/COMMUNITY_EDITOR_V2.md`. 아래는 승인 당시 설계안이다.
- 구현 차이: §4 CHECK의 `length(btrim(text)) > 0`는 줄바꿈·탭만 있는 텍스트를 통과시켜 보정 migration(`text ~ '[^[:space:]]'`)으로 교체했다.
- 이번 STEP에서 한 것: 코드 감사, Production read-only 조회, 제안 schema를 **스크래치 사본**으로 `prisma validate` + `migrate diff`(DB 미접속).

## 1. 실제 폰 사진 저장 크기 (Production read-only)

사용자가 Android 폰으로 작성한 글 "광복 롯데 애슐리"(삭제·수정하지 않음). 본문 24자 1줄, 사진 2장.

| | 크기 | 가로×세로 | MIME | sortOrder | Storage 메타데이터 크기 = `PostImage.bytes` | 공개 URL |
|---|---|---|---|---|---|---|
| IMAGE 1 | 193.6 KB | 1200×1600 | image/webp | 0 | 일치 | 200 |
| IMAGE 2 | 149.5 KB | 1200×1600 | image/webp | 1 | 일치 | 200 |
| **합계 / 평균** | **343.2 KB / 171.6 KB** | | | | | |

- 목표(300~800KB)보다 작다. 긴 변 1600px WebP q0.80 첫 인코딩에서 끝났다(800KB 재인코딩 경로 미사용).
- 원본 파일 크기는 저장하지 않으므로(설계상) 압축률은 이 데이터로 계산할 수 없다 — 필요하면 기기에서 원본 크기를 따로 확인.
- 표본 2장이라 평균은 참고값이다.

## 2. 현재 구조 감사

| 항목 | 현재 |
|---|---|
| `Post` | `title`, `content`(Text, 평문), `pinned`, `aptName?`, `authorId`, `images PostImage[]` |
| `PostImage` | `path @unique`, `sortOrder`(`@@unique([postId, sortOrder])`), `width`, `height`, `bytes`, `mimeType`, post cascade |
| 생성 | `POST /api/community/posts` — title ≤200, aptName ≤100, **content 길이 상한 없음**, images=업로드 영수증 토큰 |
| 수정 API | `PATCH /api/community/posts/[id]` — **title·content만**. `requireUser`(차단 계정 403), 작성자 또는 관리자(`isAdminSessionUser`). aptName·사진 수정 불가 |
| 수정 UI | **없음**. 상세에는 작성자/관리자에게 "삭제"만 |
| 삭제 | 작성자/관리자, 차단 계정도 자기 글 삭제 가능. DB 경로 → cascade → Storage 정리 |
| 상세 렌더 | 본문(`white-space: pre-wrap` 텍스트 노드) 아래에 사진 전부 |
| `content` 사용처 | 상세 렌더, `generateMetadata` description(120자). 목록 화면·미리보기·관리자·sitemap은 content를 렌더하지 않음 |
| 목록 API | Post 행 전체(content 포함) + author + 댓글 수. 사진 relation은 포함하지 않음 |
| 의존성 | zod·에디터 라이브러리 없음 → 기존처럼 수기 검증 |

## 3. 콘텐츠 모델 비교

| 기준 | A. `Post.contentBlocks Json?` | **B. `PostContentBlock` 테이블** | C. 본문 placeholder |
|---|---|---|---|
| 기존 글 호환 | null이면 legacy | 블록 0개면 legacy | 본문 파싱 규칙에 의존 |
| 자유 순서 | O | O | O |
| 수정 | 한 행 JSON 교체 | 트랜잭션에서 블록 교체 | 문자열 편집 — 깨지기 쉬움 |
| 이미지 참조 무결성 | **앱 검증뿐**(dangling·중복·다른 글 사진 참조를 DB가 못 막음) | **DB가 보장**: FK(같은 글의 사진만), unique(사진 1회), CHECK(블록 모양) | 없음 |
| 서버 검증 | JSON 전체 형태 검증 필요 | 컬럼 타입 + 제약 | 파서 필요 |
| HTML 주입 | 텍스트로 렌더하면 안전 | 동일 | 사용자 입력이 토큰 문법과 충돌 |
| 목록 썸네일(향후) | JSON 파싱 | 첫 IMAGE 블록 join | 파싱 |
| 블록 종류 확장 | 유연 | enum 값 + nullable 컬럼 추가 | 불가 |
| migration | 컬럼 1개 | enum + 테이블 + 인덱스 | 없음 |
| Prisma 지원 | Json(타입 약함) | relation 1급 지원 | — |

**선택: B.** 이 기능의 핵심 위험은 "사진 참조가 틀어지는 것"(다른 글·다른 사용자 사진, 삭제된 사진, 중복)이고, 그걸 앱 코드가 아니라
DB 제약으로 막을 수 있는 건 B뿐이다. 블록 종류는 V2에서 TEXT/IMAGE 둘뿐이라 A의 유연성 이점이 작다.
C는 요구대로 제외(수정 안정성·검증·입력 충돌).

## 4. 제안 schema (승인 필요)

스크래치 사본에서 `prisma validate` 통과, 아래 SQL은 `prisma migrate diff`(schema 파일 간) 출력 그대로 + 수기 추가분(CHECK, 권한).

```prisma
model Post {
  // ...기존 그대로
  images   PostImage[]
  blocks   PostContentBlock[]
}

model PostImage {
  // ...기존 그대로
  post  Post              @relation(fields: [postId], references: [id], onDelete: Cascade)
  block PostContentBlock?

  @@unique([postId, sortOrder])
  @@unique([id, postId])          // 신규: 복합 FK 대상
  @@map("post_images")
}

enum PostContentBlockType {
  TEXT
  IMAGE
}

model PostContentBlock {
  id          String               @id @default(cuid())
  postId      String               @map("post_id")
  sortOrder   Int                  @map("sort_order")
  type        PostContentBlockType
  text        String?              @db.Text
  postImageId String?              @map("post_image_id")
  createdAt   DateTime             @default(now()) @map("created_at")

  post  Post       @relation(fields: [postId], references: [id], onDelete: Cascade)
  image PostImage? @relation(fields: [postImageId, postId], references: [id, postId], onDelete: NoAction)

  @@unique([postId, sortOrder])
  @@unique([postImageId, postId])
  @@map("post_content_blocks")
}
```

`prisma/migrations/<timestamp>_community_content_blocks_v2/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "PostContentBlockType" AS ENUM ('TEXT', 'IMAGE');

-- CreateTable
CREATE TABLE "post_content_blocks" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "type" "PostContentBlockType" NOT NULL,
    "text" TEXT,
    "post_image_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_content_blocks_post_id_sort_order_key" ON "post_content_blocks"("post_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "post_content_blocks_post_image_id_post_id_key" ON "post_content_blocks"("post_image_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_images_id_post_id_key" ON "post_images"("id", "post_id");

-- AddForeignKey
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_post_image_id_post_id_fkey" FOREIGN KEY ("post_image_id", "post_id") REFERENCES "post_images"("id", "post_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 수기 추가: 블록 모양(Prisma가 CHECK를 모델링하지 않음)
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_shape_check" CHECK (
    ("type" = 'TEXT' AND "text" IS NOT NULL AND length(btrim("text")) > 0 AND "post_image_id" IS NULL)
    OR ("type" = 'IMAGE' AND "post_image_id" IS NOT NULL AND "text" IS NULL)
);
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_sort_order_check" CHECK ("sort_order" >= 0);

-- 수기 추가: least privilege (COMMUNITY_IMAGE_UPLOAD_V1과 같은 방식)
DO $$
DECLARE r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON TABLE "post_content_blocks" FROM %I', r);
        END IF;
    END LOOP;
END
$$;
ALTER TABLE "post_content_blocks" ENABLE ROW LEVEL SECURITY;
```

제약이 보장하는 것:
- 사진 블록은 **같은 글의** 사진만 참조(복합 FK `(post_image_id, post_id)` → `post_images(id, post_id)`).
- 한 사진은 한 블록에만(`(post_image_id, post_id)` unique — `post_images.id`가 전역 unique라 사실상 사진당 1회).
- 블록 순번 중복 없음, TEXT는 공백만 불가, IMAGE는 text 없음.
- `ON DELETE NO ACTION`(RESTRICT 아님): 글 삭제 시 같은 문장 안에서 사진·블록이 함께 cascade되고 검사는 문장 끝에 한다.
  반대로 블록이 가리키는 사진만 따로 지우는 실수는 거부된다. (구현 STEP에서 migration 후 실제 동작을 테스트로 확인)

## 5. 기존 글 호환

- **일괄 변환 없음.** 기존 글은 블록 0개 → legacy adapter로 읽는다.
- adapter: `[TEXT(content) if content 비어있지 않음, IMAGE(PostImage…sortOrder 순)]` → **같은 렌더러**(`CommunityPostContent`). 표시 로직은 하나.
- V2 작성·수정은 항상 블록 1개 이상을 쓰므로 "블록 0개 = legacy" 판정이 안정적이다.
- `Post.content`는 계속 채운다: TEXT 블록 텍스트를 빈 줄로 이어 붙인 **파생 평문**(사진만 있는 글은 빈 문자열).
  → SEO description·관리자·향후 검색 등 기존 소비처가 바뀌지 않는다. 사진만 있는 글은 description을 제목으로 대체(`generateMetadata` 1줄).
- `PostImage.sortOrder`도 계속 "블록 안 사진 순서"로 맞춘다 → legacy 경로·향후 썸네일과 일관.
- **롤백 시 성질**: 블록 테이블을 지워도 V2 글은 `content`(파생 평문) + 사진(순서 유지)로 legacy 렌더된다 — 순서 배치만 잃고 내용은 남는다.
- 기존 V1 생성 API 형태(`content` + `images`)는 그대로 받는다(배포 직후 옛 클라이언트 번들 대비).

## 6. 수정 UX

- 상세: 작성자/관리자에게 **수정**·삭제. 수정 → `/community/[id]/edit`(AuthGate). 서버가 권한을 최종 판정한다.
- 글쓰기·수정은 같은 `CommunityBlockEditor`를 쓴다.

```
제목
[텍스트 블록]           (↑ ↓ 삭제)
      + 내용 추가  → [글 추가] [사진 추가]
[사진 블록]             (↑ ↓ 삭제)
      + 내용 추가
[텍스트 블록]
                       [취소] [등록/저장]
```

- 초기: 빈 텍스트 블록 1개. 텍스트·사진 모두 첫 블록 가능.
- "+ 내용 추가"는 블록 사이와 끝에. 사진 추가 → 파일 선택 → 선택 순서대로 그 위치에 사진 블록 여러 개 삽입(남은 장수까지).
- 사진 블록: 기존 전처리 파이프라인 그대로(압축·방향·EXIF 제거), 미리보기는 폭 100% · 원본 비율(최대 높이 제한, 자르지 않음).
- 텍스트 블록: 자동 높이 textarea, 줄바꿈 보존, 글자 크기 16px(iOS 확대 방지).
- 제어: ↑ ↓ 삭제 아이콘(lucide), 각 44px. 드래그 정렬 없음. 순서 변경·타이핑은 로컬 상태만(서버 요청 없음).
- 저장 시 빈 텍스트 블록은 자동 제거. 남는 게 없으면 "내용을 입력하거나 사진을 추가해주세요."
- 한도: 사진 5장(기존 유지), 블록 25개, 텍스트 블록당 10,000자, 텍스트 합계 20,000자, 제목 200자(기존).
  현재 본문에는 상한이 없지만 Production 글은 1개(24자)라 새 상한과 충돌하지 않는다.
- 단지(aptName): **수정 불가 유지**(기존 PATCH 정책). 수정 화면에는 라벨로만 표시.
- 이탈 보호: 내용이 바뀐 상태에서 `beforeunload` + 취소/화면 내 뒤로 버튼 확인. Android 시스템 뒤로 가기(SPA 내비게이션)는
  `beforeunload`로 잡히지 않는다 → V2 한계로 기록, 기기 QA에서 필요성 판단. 자동 임시저장은 범위 밖.
- 모바일: 기존 `padding-bottom: 7rem + safe-area`가 하단 내비와의 겹침을 막고 있음. 키보드가 올라온 상태의 버튼 접근성은 기기 QA 필수.

## 7. 사진 수정 수명주기

수정 요청(PATCH):

```json
{
  "title": "…",
  "expectedUpdatedAt": "2026-09-14T06:35:06.802Z",
  "blocks": [
    { "type": "text", "text": "…" },
    { "type": "image", "existingImageId": "cm…" },
    { "type": "image", "uploadToken": "…" }
  ]
}
```

서버 순서:
1. `requireUser`(비로그인 401, 차단 403) → 글 조회 → 작성자 또는 관리자(아니면 403).
2. `expectedUpdatedAt`이 현재 `updatedAt`과 다르면 409(동시 수정 덮어쓰기 방지 — 다른 탭/관리자와 충돌).
3. 블록 검증: 개수·길이·빈 텍스트·사진 총 5장·existing/new 중복 없음.
4. `existingImageId`는 **이 글의 PostImage만**(`where: { postId }`로 조회, 없으면 400). 다른 글·다른 사용자 사진 거부.
5. `uploadToken`은 V1 영수증 검증(서명·만료·**현재 편집자 본인**·Storage 존재). 경로를 클라이언트가 지정할 수 없다.
6. 분류: retained(요청에 있는 기존 사진) / removed(글에 있었지만 요청에 없음) / new(영수증).
7. **DB 트랜잭션 하나**: 블록 전부 삭제 → removed PostImage 삭제 → retained 순번 2단계 갱신(unique 충돌 회피) → new PostImage 생성
   → 블록 생성 → Post(title, content 파생 평문) 갱신.
8. 커밋 **후에만** removed 사진의 Storage 삭제(1회 재시도, 실패 시 `[community-image-orphan]` 로그). 사용자 응답은 성공.
9. 트랜잭션 실패: 기존 글·사진은 그대로. **이번 요청에서 새로 올린 사진만** 정리(기존 V1 cleanup 재사용).

클라이언트: 새 사진만 기존 업로드 API로 먼저 순차 업로드 → 실패 시 저장 중단 + 세션 정리(기존 동작). 기존 사진은 재업로드하지 않는다.
DB 커밋 전에 기존 Storage 객체를 지우는 경로는 존재하지 않는다.

생성(POST)도 같은 블록 형식을 받는다(사진은 new만).

## 8. 보안

- 권한은 서버에서만(생성 `requireUser`, 수정 `requireUser` + 작성자/관리자, 삭제 기존 정책). 클라이언트 표시 여부는 편의일 뿐.
- 사진 참조: 앱 검증(§7) + DB 제약(§4) 이중. 임의 Storage 경로를 받는 필드 없음.
- 텍스트는 React 텍스트 노드로만 렌더(`dangerouslySetInnerHTML` 없음, HTML/마크다운 해석 없음).
- 새 테이블은 API 역할 grant 회수 + RLS. Data API는 OFF 유지.
- 참고(기존): 상세 화면의 관리자 판정은 `session.user.role === 'ADMIN'`만 보고, 서버는 `ADMIN_EMAIL`도 인정한다 —
  `ADMIN_EMAIL`로만 관리자인 계정에는 버튼이 안 보일 수 있다(권한 오류는 아님). V2 구현 시 같은 기준으로 맞출지 결정 필요.

## 9. 상세 / 목록

- 상세 API: 기존 `content`, `images` 유지 + `blocks`(렌더용 정규화: V2 블록 또는 legacy adapter 결과).
  사진 블록은 `{ url, width, height }`만 노출(bytes·mime·path 미노출, V1과 동일).
- 렌더러 `CommunityPostContent`: 블록 순서 그대로, 텍스트 `pre-wrap`, 사진 폭 100%·height auto·저장 크기 width/height·
  `loading="lazy"`·alt "게시글 이미지 N"(사진 순번 기준).
- 목록: 변경 없음. Prisma relation은 명시적으로 include하지 않으면 실리지 않으므로 블록·사진이 목록 응답에 추가되지 않는다(테스트로 고정).
  목록이 이미 content 전문을 보내는 것은 기존 동작이며 이번에 바꾸지 않는다.
- 공유/OG/canonical: 변경 없음(사진만 있는 글의 description 대체만).

## 10. 테스트 계획

| # | 테스트 | 방식 |
|---|---|---|
| 1–5 | text only / image only / text-image-text / image-text-image / image-image-text 생성·렌더 | 핸들러 + 렌더 모델 |
| 6, 28 | 사진 5장 한도(생성·수정 합계), 6번째 거부 | 핸들러 |
| 7 | 블록 순서 변경 저장 → 렌더 순서 | 에디터 상태 reducer + 핸들러 |
| 8, 9 | 텍스트 블록 삭제 / 사진 블록 삭제 | reducer + 핸들러 |
| 10 | legacy V1 글 렌더(content→사진 순) | adapter |
| 11 | legacy 글 수정 시 결정적 변환 `[TEXT, IMAGE…]` | adapter + 핸들러 |
| 12–15 | 작성자 수정 / 다른 사용자 403 / 관리자 수정 / 차단 계정 403 | 핸들러 + 라우트 배선 |
| 16–18 | 새 사진 추가 / 유지 / 제거 분류 | 핸들러 |
| 19, 20 | 다른 글·다른 사용자 사진 거부 / 중복 참조 거부 | 핸들러 + (migration 후) DB 제약 |
| 21 | 수정 실패 시 기존 글·사진 불변 | 트랜잭션 fake 실패 |
| 22 | 수정 실패 시 새 업로드만 정리 | 핸들러 |
| 23 | DB 성공 후에만 제거 사진 Storage 삭제, 실패 시 orphan 로그 | 호출 순서 검증 |
| 24 | 익명 상세 읽기(blocks 포함) | 라우트 |
| 25 | 360/375/390px 넘침·터치 영역 | CSS 계약 + 기기 QA |
| 26 | 목록 응답에 blocks/images 없음 | 라우트 소스 검사 |
| 27 | HTML/스크립트 문자열이 텍스트로만 렌더 | 렌더러 |
| 추가 | 409 동시 수정 / 빈 텍스트 자동 제거·전부 비면 거부 / 텍스트 길이 한도 / 파생 content / NO ACTION cascade 실제 동작 / migration 권한·RLS | 핸들러·SQL 검사·migration 후 확인 |

## 11. 구현 예상

| 파일 | 내용 |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/…_community_content_blocks_v2/` | §4 |
| `src/lib/community/content-blocks.ts` | 블록 타입·한도·검증·legacy adapter·파생 content (순수) |
| `src/lib/community/post-edit-handlers.ts` | 생성/수정 판정·사진 분류·정리(의존성 주입) |
| `src/app/api/community/posts/route.ts`, `[id]/route.ts` | blocks 생성, PATCH 확장, GET blocks |
| `src/components/community/CommunityBlockEditor.tsx` (+ css) | 블록 편집 UI(기존 전처리 재사용) |
| `src/components/community/CommunityPostContent.tsx` (+ css) | 공용 렌더러 |
| `src/app/community/write/page.tsx`, `src/app/community/[id]/edit/page.tsx`(신규), `[id]/post-client.tsx`, `[id]/page.tsx` | 화면 |
| `src/lib/community/community-editor-v2.test.ts` | §10 |
| docs | 이 문서 갱신, CHANGELOG, DECISIONS |

규모: 승인 후 구현 + 자동 테스트 + 빌드 1 STEP, 그 뒤 Production QA와 Android 기기 QA 1회.

## 12. Production 영향 / 롤백

- 영향: enum 1, 테이블 1(빈 테이블), `post_images`에 unique 인덱스 1개(현재 2행 — 즉시 완료). 기존 행 수정 없음.
- 적용 전 필수: 코드와 migration의 배포 순서 — migration 먼저, 그 다음 코드(블록 테이블을 읽는 코드가 먼저 나가면 상세 조회 실패).
- 롤백(코드 revert 후):
  ```sql
  DROP TABLE "post_content_blocks";
  DROP TYPE "PostContentBlockType";
  DROP INDEX "post_images_id_post_id_key";
  ```
  + `prisma migrate resolve --rolled-back <migration>`. V2로 쓴 글은 파생 content + 사진으로 legacy 렌더된다(§5).
