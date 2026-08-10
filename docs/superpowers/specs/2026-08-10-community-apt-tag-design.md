# 커뮤니티 단지 태그 연동 설계 (Sub-project B)

**작성일**: 2026-08-10
**선행 작업**: [2026-08-10-apt-detail-layout-redesign-design.md](./2026-08-10-apt-detail-layout-redesign-design.md) (Sub-project A, 완료) — A에서 단지 상세페이지에 `/community?aptName=...`로 이동하는 CTA를 이미 배치했지만, `/community`가 그 쿼리파라미터를 읽지 않아 죽은 링크 상태였다. B는 이 파라미터를 실제로 동작시키는 작업이다.

## 배경 / 목표

아파트 상세페이지(`src/app/apt/[name]/apt-client.tsx`)에서 "이 단지 실거주민 이야기가 궁금하다면?" CTA로 커뮤니티에 진입했을 때, 해당 단지와 무관한 전체 글이 보이는 문제를 해결한다. `Post`에 단지명을 태그할 수 있게 하고, 태그된 글을 단지별로 필터링/배지 표시한다.

## 범위 결정 사항 (브레인스토밍에서 확정)

- **태그 방식**: 자유 텍스트 입력 (기존 앱 전역에서 아파트명이 항상 문자열로 다뤄지는 관례를 따름 — 별도 `Apartment` 테이블 없음, MOLIT API가 유일한 출처). 글쓰기 폼에 "단지명" 입력칸을 추가하고, URL 쿼리파라미터로 자동채움하되 수정 가능하게 한다.
- **매칭 방식**: 정확 일치(trim 후 문자열 equals). Fuzzy 매칭 없음.
- **목록 필터링**: `?aptName=`이 있으면 해당 단지 글만 필터링 + "전체보기" 버튼으로 해제.
- **배지 표시**: 필터 여부와 무관하게 목록/상세 모두에서 단지 배지를 항상 표시, 클릭 시 `/apt/[단지명]`으로 이동.
- **글쓰기 진입점**: 단지 상세페이지 CTA에 "이 단지로 글쓰기" 버튼을 추가로 배치(`/community/write?aptName=...` 직행), 기존 "커뮤니티 가기"(목록 이동) 버튼과 병행.
- **작업 브랜치**: `main`에서 직접 작업 (A와 동일한 방식), 푸시는 별도 요청 시에만.

## 아키텍처

### 1. 스키마 / 마이그레이션

`prisma/schema.prisma`의 `Post` 모델에 필드 추가:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String   @db.Text
  pinned    Boolean  @default(false)
  aptName   String?  @map("apt_name")
  authorId  String   @map("author_id")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  author   User      @relation(fields: [authorId], references: [id])
  comments Comment[]

  @@index([pinned, createdAt])
  @@index([aptName, createdAt])
  @@map("posts")
}
```

- `aptName`은 nullable — 기존 글은 `null`로 남고 일반 글로 계속 취급된다. 백필 불필요.
- `@@index([aptName, createdAt])`는 필터링된 목록 조회(단지별 최신순)를 위한 인덱스. 기존 `@@index([pinned, createdAt])`는 전체 목록 조회용으로 그대로 유지.
- `prisma migrate dev`로 실제 마이그레이션 파일 생성 (Sub-project B가 A와 분리된 이유 — 실제 DB 변경이 필요).

### 2. API

**`POST /api/community/posts`** (`src/app/api/community/posts/route.ts`):
- body에서 `aptName` 추가로 읽음: `const aptName = (body.aptName || '').trim() || null;`
- `prisma.post.create`의 `data`에 `aptName` 포함.

**`GET /api/community/posts`** (같은 파일):
- `searchParams.get('aptName')`로 선택적 필터 읽음.
- `where: aptName ? { aptName } : undefined`를 `findMany`와 `count` 양쪽에 동일하게 적용 (그래야 페이지네이션 총 개수가 필터와 일치).
- 정렬(`orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }]`)은 필터 여부와 무관하게 동일 유지.

**`GET /api/community/posts/[id]`**: 변경 없음 — `aptName`은 스칼라 필드라 `select` 제약 없이 자동으로 응답에 포함됨.

### 3. UI

**`src/app/community/write/page.tsx`**:
- "단지명" 텍스트 입력칸 추가 (선택 입력, placeholder "예: 래미안 강남포레스트").
- 마운트 시 `useEffect`에서 `new URLSearchParams(window.location.search)`로 `aptName` 쿼리파라미터를 읽어 state 초기값으로 채움 — `apt-client.tsx`가 이미 쓰는 패턴과 동일 (이 Next 버전에서 `next/navigation`의 `useSearchParams` 훅은 Suspense 경계가 필요해 기존 코드베이스는 이를 피하고 `window.location.search`를 직접 읽는 방식을 관례로 씀).
- 제출 시 body에 `aptName: aptName.trim() || undefined` 포함.

**`src/app/community/page.tsx`**:
- `useEffect` + `window.location.search`로 `aptName` 쿼리파라미터를 state로 읽음, SWR 키에 반영: `` `/api/community/posts?page=${page}${aptName ? `&aptName=${encodeURIComponent(aptName)}` : ''}` ``.
- `aptName`이 있을 때 상단에 배너 표시: "📍 {aptName} 관련글 · {total}건" + "전체보기" 링크(`href="/community"`, 쿼리 제거).
- 빈 상태 문구를 필터 여부에 따라 분기: 필터 중이면 "아직 이 단지 관련 글이 없습니다. 첫 글을 남겨보세요!", 아니면 기존 문구 유지.
- "글쓰기" 버튼 href에 현재 `aptName`을 이어서 전달: `` `/community/write${aptName ? `?aptName=${encodeURIComponent(aptName)}` : ''}` ``.
- 각 글 행에 단지 배지 표시 (아파트명이 태그된 글만): "🏢 {post.aptName}". 현재 행 전체가 `<Link href="/community/{id}">`로 감싸여 있어 그 안에 또 다른 `<Link>`(배지)를 중첩시키면 `<a>` 중첩이 되어 유효하지 않은 HTML이 된다. 행 래퍼를 `<Link>`에서 `onClick`에 `router.push`를 쓰는 `<div role="link">`로 바꾸고, 배지만 실제 `<Link href="/apt/{aptName}">`로 두어 `onClick`에 `e.stopPropagation()`을 건다.

**`src/app/community/[id]/post-client.tsx`**:
- `post.aptName`이 있으면 제목 아래 메타 영역에 동일한 "🏢 {aptName}" 배지를 `<Link href="/apt/{aptName}">`로 표시 (여긴 중첩 `<a>` 문제 없음 — 기존 구조가 `Link` 래퍼가 아님).

**`src/app/apt/[name]/apt-client.tsx`** (커뮤니티 카드, 726~734행 부근):
- 기존 "커뮤니티 가기" 버튼 옆에 "이 단지로 글쓰기" 버튼 추가: `<Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`}>`.

## 에러 처리

기존 API 에러 처리 패턴(`try/catch` + `{ success: false, error }`) 그대로 재사용. 새로운 실패 모드 없음 — `aptName`은 선택적 문자열이라 별도 유효성 검사 불필요 (제목/내용과 달리 필수값 아님).

## 테스트 / 검증 계획

- `npm run build` / `npx tsc --noEmit` 0 에러 확인.
- 브라우저 라이브 검증 (A와 동일한 관례):
  1. 실제 데이터가 있는 단지 상세페이지 → "이 단지로 글쓰기" 클릭 → 단지명 자동채움 확인 → 글 작성 → 저장 확인.
  2. 해당 단지 상세페이지 → "커뮤니티 가기" → 필터된 목록에 방금 쓴 글만 보이는지, 배너/카운트 정상인지 확인.
  3. "전체보기" 클릭 → 필터 해제, 모든 글(태그 없는 기존 글 포함) 노출 확인.
  4. 목록/상세에서 배지 클릭 → 단지 상세페이지로 정상 이동하는지, 그리고 행 클릭(배지 이외 영역)은 여전히 글 상세로 이동하는지 (중첩 앵커 리팩터링 회귀 확인).
  5. 태그 없이 쓴 글이 일반 목록에 정상 노출되는지 (하위호환).
