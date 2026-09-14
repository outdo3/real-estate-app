# COMMUNITY DELETE NAVIGATION CLEANUP V1

- 기준 HEAD: `d12cd82` (main)
- 범위: **탐색·캐시·라우트 동작만**. DB schema·migration·게시글 데이터 모델·인증·권한·이미지/Storage 변경 없음. API의 404 의미는 유지.

## 1. 제품 결정 — 중간 화면을 두지 않는다

삭제된(또는 없는) 게시글에 대한 사용자 화면은 **커뮤니티 목록 하나**다.

```
게시글 삭제 → /community       (끝)
삭제된 상세·수정 주소에 다시 닿음 → /community   (안내·오류 화면 없이)
```

- 만들지 않는 것: "삭제된 게시글입니다", "존재하지 않는 게시글입니다", "게시글을 찾을 수 없습니다", 다시 시도, 목록으로 돌아가기 버튼, 404 카드, "삭제된 게시글이라 이동했습니다" 알림.
- 예외(데이터 진실성, AGENTS.md): **통신 실패·500은 "없는 글"이 아니다.** 기존 "게시글을 불러오지 못했습니다 / 다시 시도"를 유지한다. 목록으로 보내는 조건은 API **HTTP 404**뿐이다.

## 2. 원인(코드 기준)

사용자가 본 화면: 상단 "글 수정", 본문 "게시글을 찾을 수 없습니다 / 다시 시도".

1. **삭제가 push였다** — 상세 `handleDeletePost`의 `router.push('/community')`. 삭제한 상세 항목이 기록에 남는다.
2. **기록에 수정 화면도 남아 있었다** — 수정 화면에서 편집하면 이탈 경고(`useLeaveGuard`)가 같은 URL 항목을 하나 더 쌓는다. 저장 성공 시 `router.replace(detail)`가 그 항목만 덮으므로 기록은 `[목록, 상세, 수정, 상세]`가 된다.
   여기서 삭제(push)하면 `[목록, 상세, 수정, 상세, 목록]`이다.
3. 목록에서 뒤로 가기 → 삭제된 **상세**, 한 번 더 → 삭제된 **수정**.
4. **404를 오류 화면으로 그렸다.**
   - 수정 화면: 404 JSON(`success: false`)을 `loadError`로 받아 헤더 "글 수정" 아래 "게시글을 찾을 수 없습니다 + 다시 시도"를 그렸다(사용자가 본 화면).
   - 상세 화면: 같은 404를 `fetchError`로 받아 경고 + 다시 시도 카드를 그렸다(`!post` 분기의 "찾을 수 없습니다 + 돌아가기"도 있었다).
5. **상세 SWR 캐시가 남아 있었다** — `useSWR('/api/community/posts/{id}')` 캐시가 삭제 후에도 그대로라, 뒤로 가기 때 삭제 전 본문이 먼저 보인 뒤 재검증 결과로 바뀔 수 있었다.
6. 같은 탭의 뒤로·앞으로 가기는 App Router 클라이언트 캐시를 쓰므로 서버 컴포넌트가 다시 실행되지 않는다. 서버 확인만으로는 해결되지 않는다.

## 3. 기록(history) 정책

- 삭제 성공 → `router.replace('/community')`. 삭제한 화면 항목을 목록으로 덮는다.
- 이미 쌓인 과거 항목(위 2의 `상세`, `수정`)은 브라우저 API로 지울 수 없다. 대신 **그 항목에 닿는 즉시** 목록으로 `replace`한다(§5).
  - 결과적으로 뒤로 가기를 눌러도 삭제된 글 화면은 보이지 않고 목록에 머문다.
  - 과거 항목 수만큼 뒤로 가기가 목록에서 소비될 수 있다(각각 목록으로 덮임).
- `history.back()`으로 건너뛰기는 하지 않는다. 사이트 밖으로 나가 버릴 수 있기 때문이다.

## 4. 캐시 무효화 — 실제 키 기준

| 대상 | 실제 키(코드 출처) | 삭제 성공 시 |
|---|---|---|
| 상세 | `/api/community/posts/${postId}` (`post-client.tsx` `useSWR`, 수정 저장 후 캐시 기록도 같은 키) | `mutate(detailKey, undefined, { revalidate: false })` — 비움 |
| 목록 | `/api/community/posts?page=…[&aptName=…]` (`community/page.tsx` `useSWR(queryKey)`) | 필터 `mutate(isCommunityListKey, removePostFromListData, { revalidate: false })` — 모든 페이지·필터 캐시에서 이 글 제거, `total` −1. 목록을 다시 열면 SWR 기본(`revalidateIfStale`)으로 재검증 |
| 수정 | 없음 — 수정 화면은 SWR을 쓰지 않고 `fetch(..., { cache: 'no-store' })` | 해당 없음 |

SWR 2.5 `mutate(filterFn, …)`는 캐시의 원래 키(`_k`)를 필터에 넘긴다(`node_modules/swr` internalMutate에서 확인).

## 5. 없는 글 라우트 동작

### 5.1 탭 기억 — `src/lib/community/deleted-post-navigation.ts`
- `markPostDeleted(id)`: 삭제 성공 또는 API 404 때 기록한다. 모듈 `Set`(같은 문서)과 `sessionStorage`(같은 탭에서 문서가 다시 열린 경우, 최대 50개, 저장소가 막혀도 동작)에 둔다.
- `isPostDeleted(id)`: 상세·수정 화면이 `useSyncExternalStore`로 읽는다. 서버 스냅샷은 `false`라 수화 불일치가 없다.

### 5.2 상세(`/community/[id]`, `post-client.tsx`)
- 기억된 글이면 SWR 키를 `null`로 둔다(요청 없음). 아무것도 그리지 않고 `router.replace('/community')`.
- fetcher가 HTTP 상태를 함께 넘기고, 404면 기억한 뒤 목록으로 `replace`한다. 렌더는 `null`이다.
- "찾을 수 없습니다 + 돌아가기" 분기를 제거했다.

### 5.3 수정(`/community/[id]/edit`)
- 기억된 글이면 요청하지 않는다. 404면 기억한 뒤 목록으로 `replace`한다.
- `if (missing) return null`이 `AuthGate`·`Header("글 수정")`보다 앞에 있어, 헤더·오류 카드·로그인 창 모두 그리지 않는다.
- 통신 실패·500의 "다시 시도"는 유지한다.

### 5.4 직접 주소 입력·새로고침·공유 링크 — `src/app/community/[id]/layout.tsx` (신규 서버 레이아웃)
- 상세·수정 둘 다 감싼다. `prisma.post.findUnique({ select: { id: true } })`로 존재 여부만 확인한다.
- **조회가 성공했고 글이 없을 때만** 화면을 그리기 전에 `redirect('/community')`한다(HTTP 307, try 밖에서 호출).
- DB 오류는 redirect하지 않고 그대로 렌더한다(화면의 기존 오류 경로).
- 권한 판정은 하지 않는다.
- 잘못된 id도 같은 결과다(API 404 의미는 그대로).

### 5.5 BFCache
- 전역 BFCache 비활성화(unload 등록, no-store 헤더)는 하지 않았다.
- 상세·수정 화면에서만 `pageshow`의 `persisted`일 때 한 번 다시 확인한다. 다른 탭·기기에서 삭제된 글이 통째로 되살아나는 경우를 막는다.
  - 상세: 기억된 글이면 이동, 아니면 재검증(404면 이동).
  - 수정: 존재만 확인(404면 이동). 작성 중인 내용은 건드리지 않는다.

## 6. 변경하지 않은 것
- 삭제 API·권한(작성자/관리자, 서버 판정)·403/404 응답
- 이미지/Storage 정리(V1/V2 경로)
- 수정 저장 후 상세 캐시 기록(`mutate(detailKey, fetch…, { revalidate: false })`)
- 목록 화면
- 정상 상세·수정 화면
- `generateMetadata`

## 7. 파일

| 파일 | 변경 |
|---|---|
| `src/lib/community/deleted-post-navigation.ts` | 신규 — 키, 목록 캐시 제거, 404 판정, 탭 기억 |
| `src/app/community/[id]/layout.tsx` | 신규 — 직접 진입 시 없는 글 서버 redirect |
| `src/app/community/[id]/post-client.tsx` | 삭제 replace + 캐시 정리, 404·기억 → 목록, 중간 화면 제거, BFCache 확인 |
| `src/app/community/[id]/edit/page.tsx` | 404·기억 → 목록(헤더·AuthGate 전), BFCache 확인 |
| `src/lib/community/community-delete-navigation.test.ts` | 신규 8 tests(요청 17항목 매핑) |
| `src/lib/community/community-editor-v2.test.ts` | 상세 SWR 키 표현 변경에 맞춘 단언 1곳 |

## 8. 검증

| 항목 | 결과 |
|---|---|
| 커뮤니티 테스트 | 155/155 |
| src 전체 | **1899/1899** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS — 25건 전부 기존 `scripts/`·`tmp/`, src 0 |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |

## 9. Production / 기기 QA

(배포 후 기록)

## 10. 알려진 한계

- 이미 쌓인 과거 기록 항목은 지울 수 없다. 뒤로 가기가 그 항목 수만큼 목록에서 소비될 수 있다(화면은 계속 목록).
- 다른 탭·기기에서 삭제된 글을 같은 탭 기록으로 되돌아가면, 탭 기억이 없어 요청 한 번(짧은 "불러오는 중") 뒤 목록으로 간다.
- 수정 화면을 주소로 직접 열 때 로그인 전이면 `AuthGate`보다 서버 레이아웃 redirect가 먼저다(없는 글에 로그인 요구 없음).
