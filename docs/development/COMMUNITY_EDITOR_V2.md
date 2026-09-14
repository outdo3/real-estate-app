# COMMUNITY EDITOR V2 — 텍스트/사진 블록 + 게시글 수정

- 설계: `docs/development/COMMUNITY_EDITOR_V2_DESIGN.md` (APPROVAL_REQUIRED → 승인)
- 사용자 승인: post_content_blocks additive migration + least privilege, 관련 단지 수정 불가 유지,
  25블록 / 블록당 10,000자 / 총 20,000자, 수정 버튼 관리자 판정을 서버 규칙과 통일
- 구현 기준 HEAD: `b6f8b99`

## 1. 무엇이 바뀌었나

- 글쓰기·수정이 같은 "미니 블록 편집기"를 쓴다. 블록은 **글 / 사진** 두 종류, 순서 제한 없음(사진이 첫 블록이어도 됨).
- 상세는 블록 순서 그대로 렌더한다. 기존(V1) 글은 변환하지 않고 `[글, 사진…]`으로 같은 렌더러에 들어간다.
- 상세에서 작성자·관리자에게 **수정** 버튼 → `/community/[id]/edit`.

## 2. DB

| migration | 내용 |
|---|---|
| `20260914120000_community_content_blocks_v2` | enum `PostContentBlockType`(TEXT, IMAGE), 테이블 `post_content_blocks`, 순번 unique, `(post_image_id, post_id)` unique, `post_images(id, post_id)` unique 인덱스, 글 cascade FK, **같은 글 사진만 참조하는 복합 FK(NO ACTION)**, 모양 CHECK, API 역할 grant 회수 + RLS |
| `20260914130000_community_content_blocks_v2_text_check` | TEXT "공백만 금지" CHECK 보정(아래 §2.1) |

Production 적용 전후(2026-09-14): posts 1→1, comments 0→0, post_images 2→2, post_content_blocks 0.
"광복 롯데 애슐리" 글: id·updatedAt·본문 길이·사진 2행(id, sortOrder, bytes, 크기) **완전히 동일**, 블록 0(자동 변환 없음).
`post_content_blocks` 권한: `postgres`만, RLS ON, policy 0. `post_images`·`posts` 권한 변경 없음. Data API OFF 유지.

### 2.1 설계 SQL 결함 1건 — 발견 후 보정

설계 §4의 CHECK `length(btrim(text)) > 0`는 `btrim()`이 기본으로 **스페이스만** 지워서 줄바꿈·탭만 있는 텍스트가 통과했다.
롤백 트랜잭션 검증에서 발견했고, 행 0개 상태에서 `text ~ '[^[:space:]]'`로 교체하는 보정 migration을 적용했다.
앱 검증(`trim()` — 전각 공백 포함)이 1차 방어이며 이 CHECK는 이중 방어다.

### 2.2 DB 제약 실동작 검증

`scripts/community/verify-content-block-constraints.ts` — 각 케이스를 트랜잭션에서 실행 후 **항상 롤백**(영구 쓰기 0, 전후 행 수 동일 확인). **12/12 PASS**:
정상 TEXT+같은 글 IMAGE 삽입 / 다른 글 사진 참조 23503 / 같은 사진 두 블록 23505 / 순번 중복 23505 / 공백만 TEXT 23514 /
IMAGE+text 23514 / IMAGE 사진 없음 23514 / 음수 순번 23514 / 블록이 쓰는 사진만 삭제 23503 /
글 삭제 시 사진·블록 cascade 성공(NO ACTION은 문장 끝 검사) / 편집 순서(블록 삭제→사진 삭제) 허용 / 롤백 후 행 수 불변.

## 3. 규칙

| 항목 | 값 |
|---|---|
| 블록 | 최대 25 (빈 글 블록 제거 후) |
| 글 | 블록당 10,000자, 합계 20,000자, 줄바꿈 보존, 앞뒤 공백만 정리 |
| 사진 | 합계 5장(V1 파이프라인·압축·EXIF 제거·영수증·경로·1.5MB 그대로), 사진 1장 = 블록 1개 |
| 최소 | 의미 있는 블록 1개(글만 / 사진만 / 조합 모두 허용) |
| 제목 | 200자(기존) |
| `Post.content` | 글 블록을 빈 줄로 이은 **파생 평문**(사진만 있으면 빈 문자열) — SEO·기존 소비처 유지 |
| SEO description | 파생 평문 120자, 사진만 있으면 제목 |
| 관련 단지 | 수정 불가(수정 API가 읽지 않음, 수정 화면은 표시만) |

클라이언트는 저장 전에 서버와 **같은 함수**(`normalizeBlocks`)로 사전 검사한다.

## 4. 저장 흐름

### 생성 (`POST /api/community/posts` + `blocks`)
사전 검사 → 새 사진만 기존 업로드 API로 순차 업로드 → 블록 요청 → 서버: 제목·블록 정규화, 기존 사진 id 거부,
영수증 검증(본인·서명·만료·Storage 존재) → **한 트랜잭션**(Post + PostImage + PostContentBlock) → 실패 시 새 업로드 정리.
V1 형태(`content` + `images`) 요청도 그대로 받는다(배포 직후 옛 번들).

### 수정 (`PATCH /api/community/posts/[id]` + `blocks` + `expectedUpdatedAt`)
1. `requireUser`(비로그인 401, 차단 403) → 작성자 또는 관리자(`isAdminSessionUser`) 아니면 403
2. `expectedUpdatedAt` ≠ 현재 `updatedAt` → **409**
3. 블록 정규화 → 기존 사진은 **이 글의 사진만**, 새 사진은 **현재 편집자 본인 영수증만**
4. 분류: 유지 / 제거 / 새 사진
5. 트랜잭션: `updatedAt` 조건부 갱신(0행이면 409) → 블록 전부 삭제 → 제거 사진 행 삭제 → 유지 사진 순번 2단계 갱신 → 새 사진 행 → 블록 생성
6. 커밋 **후에만** 제거 사진 Storage 삭제(1회 재시도, 실패 시 `[community-image-orphan]` 로그, 응답은 성공)
7. 트랜잭션 실패: 기존 글·사진 그대로, 새 업로드만 정리

블록으로 저장된 글에 V1 형태로 본문만 바꾸는 PATCH는 409(블록과 파생 평문이 어긋나지 않게).

## 5. 화면

- **편집기**: 상단 `사진 n/5 · 블록 n/25`, 맨 위·블록 사이·끝의 `+ 내용 추가` → `글 추가` / `사진 추가`.
  사진 여러 장은 선택 순서대로 그 위치에 블록 여러 개. 각 블록 `↑ ↓ 삭제`(44px). 글 블록은 자동 높이·16px.
  사진 블록은 압축본(또는 저장된 사진) 미리보기, 원본 비율(최대 60vh, 자르지 않음). 드래그 없음. 조작은 전부 로컬 상태.
- **수정 화면**: V2 글은 저장 블록 그대로, V1 글은 서버 adapter 순서로 불러온다. 바뀐 것이 없으면 저장 버튼 비활성.
  409면 "다른 곳에서 이 글이 먼저 수정됐어요. 새로고침한 뒤 다시 수정해주세요."
- **상세**: `CommunityPostContent` 한 렌더러. 글은 텍스트 노드(`pre-wrap`), 사진은 폭 100%·저장 크기·lazy·alt "게시글 이미지 N".
- **관리자 판정(UI)**: `session.user.isAdmin` — 세션 생성 시 `isAdminSessionUser`(role 또는 ADMIN_EMAIL)로 계산된 값. 수정·삭제·고정·댓글 삭제 버튼에 동일 적용. 권한은 API가 다시 판정.
- **이탈 경고**: 내용이 있거나 바뀐 상태에서 탭 닫기(beforeunload), 화면 안 링크 클릭(캡처 단계 confirm),
  뒤로 가기(헤더·취소·Android 시스템 뒤로: 같은 URL history 항목 + popstate confirm). 저장 성공 시 해제 후 `router.replace`.
- **목록**: 변경 없음(블록·사진 미조회).
- V1의 `CommunityImagePicker`는 블록 편집기로 대체되어 제거했다(같은 압축 파이프라인을 편집기가 사용).

## 6. 검증

| 항목 | 결과 |
|---|---|
| `src/lib/community/community-editor-v2.test.ts` | 30/30 (요청 42항목 매핑 + 모바일 CSS·이탈 경고·스냅샷·관련 단지) |
| 커뮤니티 기존 테스트(V1 이미지·launch·익명 열람) | 68/68 — 위치가 옮겨진 3개 검사(세션 정리·상세 select·사진 렌더)만 새 위치로 갱신 |
| src 전체 | **1842/1842** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 기존 `scripts/`·`tmp/`, src 0, 신규 scripts 0 |
| eslint(변경 경로) | exit 0 |
| `npm run build` | exit 0, `/community/[id]/edit` 포함 |
| 번들 점검 | `.next/static`에 서버 키 지문·`SUPABASE_SERVICE_ROLE_KEY`·`service_role`·`ADMIN_EMAIL` 0, source map 0 |
| DB 제약 실동작 | 12/12 (롤백) |

## 7. Production / 기기 QA

(배포 후 기록)

## 8. 알려진 한계

- 드래그 정렬 없음(↑↓만). 자동 임시저장 없음.
- 이탈 경고의 뒤로 가기 처리는 history 항목을 하나 더 쌓는 방식이다. Android 시스템 뒤로 제스처·브라우저별 동작은 기기 QA로 확인해야 한다.
- 글 블록 합계 20,000자, 블록 25개는 새로 생긴 상한이다(기존 V1 글은 1개·24자라 충돌 없음).
- 제거 사진은 CDN 캐시로 최대 1시간 공개 URL이 열릴 수 있다(V1과 동일).
- 탭 종료로 인한 새 업로드 orphan 자동 정리 없음(V1과 동일).
