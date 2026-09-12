# COMMUNITY LAUNCH READINESS V1

브랜치: `main` / 기준 커밋: `a7b7d72`

부산 정식 출시 전 커뮤니티 전수 점검 + P0/P1 수정. 대개편이 아니다.
**DB schema/migration 변경 없음**, production bulk write 없음.

## 1. 실제 구조 (감사 결과)

추정하지 않고 코드에서 확인한 것만 적는다.

### 라우트

| 경로 | 내용 |
|---|---|
| `/community` | 목록. 페이지네이션(20건), `aptName` 필터, 고정글 상단 |
| `/community/[id]` | 상세 + 댓글 |
| `/community/write` | 글쓰기 |
| `POST/GET /api/community/posts` | 목록 조회(공개) / 작성(인증) |
| `GET/PATCH/DELETE /api/community/posts/[id]` | 상세(공개) / 수정 / 삭제 |
| `POST /api/community/posts/[id]/comments` | 댓글 작성 |
| `DELETE /api/community/comments/[id]` | 댓글 삭제 |
| `POST /api/community/posts/[id]/pin` | 관리자 고정 |
| `GET /api/community/recent-activity` | 최근 활동 |

### 존재하는 기능 / 존재하지 않는 기능

**있다**: 글 목록·상세·작성·수정(API만)·삭제, 댓글 작성·삭제, 관리자 고정,
단지명(`aptName`) 태그 필터, 공유(ShareAction), 페이지네이션, 관리자 배지.

**없다**(추정하지 않고 확인): **카테고리 없음**(스키마에 필드 자체가 없다 —
`aptName`은 자유 텍스트 태그다), 조회수·좋아요 없음, **신고 기능 없음**,
댓글 수정 없음, 글 수정 UI 없음(PATCH API만 존재), 검색 없음, 이미지 첨부 없음.

## 2. 분류

### P0 — 없음

서버 측 권한은 이미 정상이었다. 글·댓글 수정/삭제 모두
`existing.authorId === user.id || 관리자` 를 **서버에서** 검사하고, 작성자는
`authorId: user!.id`로 세션에서만 정한다. 클라이언트 body의 사용자 식별자를 읽는
경로가 없다. 데이터 손실·권한 우회·인증 우회 없음.

### P1 — 이번 STEP에서 수정 (9건)

| # | 문제 | 영향 |
|---|---|---|
| 1 | **통신 실패를 "글이 없음"으로 표시** | 오프라인/타임아웃 때 "아직 작성된 글이 없습니다"가 떴다 |
| 2 | **모든 글의 og:url이 홈을 가리킴** | 공유 카드·검색엔진이 글을 구분하지 못함 |
| 3 | **댓글 Enter 연타 중복 등록** | 버튼은 disabled였지만 키보드 경로에 가드가 없었다 |
| 4 | **삭제에 in-flight 가드 없음** | 연타 시 같은 DELETE가 여러 번 나갔다 |
| 5 | **관리자 판정 불일치** | 고정(pin)은 `requireAdmin`, 수정/삭제는 `role === 'ADMIN'`만 — `ADMIN_EMAIL` 관리자는 고정은 되고 삭제는 안 됐다 |
| 6 | **차단(banned) 계정이 기존 글을 수정 가능** | 글쓰기는 막혔는데 수정은 열려 있어 차단이 무의미 |
| 7 | **상세에 목록으로 돌아가는 길 없음** | 공유 링크로 들어오면 나갈 경로가 브라우저 뒤로가기뿐 |
| 8 | **20자 닉네임이 레이아웃을 밀어냄** | `USER_NICKNAME_EDIT_V1` 이후 생긴 신규 위험 |
| 9 | **장식용 이모지 사용** | AGENTS.md의 lucide 아이콘 규칙 위반 |

부수적으로: `alert()` → 화면 내 인라인 오류, 빈 상태 문구 개선,
공개 응답에서 내부 `author.id` 제거.

### P2 — 출시 후 (문서화만)

- **신고/모더레이션 기능 없음.** §14 판단: 출시 blocker 아님 — 본인 글·댓글 삭제와
  관리자 삭제가 정상 동작하므로 최소 대응 경로는 있다. 복잡한 moderation system을
  이번에 만들지 않는다.
- **댓글 수정 없음.** 삭제 후 재작성으로 대체 가능. blocker 아님.
- **카테고리 없음.** 스키마에 필드가 없어 도입하려면 **DB 변경이 필요하다** → STOP 대상.
  현재는 `aptName` 태그가 사실상의 분류축이다. §10 지시대로 label/order/hide 수준으로
  정리할 대상 자체가 존재하지 않는다.
- **글 수정 UI 없음** (PATCH API는 있음).
- **AuthGate가 공개 화면에서 로그인 모달을 자동으로 연다** — 아래 §3 참고.
- **작성 중 draft 보존 없음** — OAuth 리다이렉트로 로그인하면 입력 내용이 사라진다.
  §6이 "대형 draft autosave는 범위 밖"이라고 못박아 미구현.
- `buildOpenGraph`의 `url`이 사이트 루트 고정 — 커뮤니티는 이번에 해결했지만
  다른 상세 화면(단지/학교/분양 등)도 같은 상태다. 사이트 전역 수정은 범위 밖.

## 3. 로그인 없이 열람 (§3) — 확인 결과와 남긴 판단

**열람 가능하다.** `/api/community/posts` GET과 `/api/community/posts/[id]` GET은
인증을 요구하지 않고(테스트로 고정), 목록·상세 모두 비로그인 상태로 렌더된다.

다만 `<AuthGate>`가 감싸고 있어 **비로그인 방문자에게 로그인 모달이 자동으로 뜬다.**
모달은 닫을 수 있고, 닫으면 그대로 둘러볼 수 있다(AuthGate 주석에 의도로 기록돼 있음).

커뮤니티가 sitemap에 들어가 검색 유입을 받는 화면이라는 점에서 **검색에서 들어온 첫
방문자가 즉시 모달을 만나는 것은 재고할 여지가 있다.** 다만 이는 버그가 아니라
의도된 로그인 유도 정책이고, 두 화면의 로그인 프롬프트 동작을 바꾸는 것은 제품 결정이라
**이번 STEP에서 바꾸지 않았다.** 바꾸기로 하면 `/community`와 `/community/[id]`에서
`AuthGate` 래퍼만 걷어내면 된다(글쓰기 페이지의 AuthGate는 유지) — 한 줄짜리 변경이다.

## 4. 수정 상세

### 4.1 loading / empty / error 분리 (§3/§16)

```
전: useSWR(...)  →  data.success === false 만 오류로 처리
    fetch가 throw하면 data는 undefined  →  posts.length === 0  →  "글이 없습니다"

후: const { data, isLoading, error: swrError, mutate } = useSWR(...)
    swrError → 오류 상태 + [다시 시도] 버튼(role="alert")
    isLoading → 로딩 상태(role="status")
    빈 배열 → 빈 상태
```

목록과 상세 양쪽에 적용. 404(글 없음)와 통신 실패도 분리했다.

### 4.2 빈 상태 (§4)

```
전: "아직 작성된 글이 없습니다. 첫 글을 남겨보세요!"

후: 아직 올라온 글이 없어요
    살아본 이야기, 동네 분위기, 실제로 겪은 일을 남겨주세요.
    같은 곳을 알아보는 사람에게 도움이 됩니다.
    [첫 글 남기기]
```

과장된 마케팅 문구는 쓰지 않았다(테스트로 고정).

### 4.3 권한 일관화 (§7)

- 글·댓글 수정/삭제의 관리자 판정을 `isAdminSessionUser()` 단일 기준으로 통일.
  `role === 'ADMIN'` 또는 `ADMIN_EMAIL` — pin 라우트(`requireAdmin`)와 같은 기준이 됐다.
- 글 **수정**은 `requireUser()`로 바꿔 차단(banned) 계정을 막는다.
  **삭제는 그대로 `getCurrentUser()`** — 차단된 사용자가 자기 글을 지우는 것까지 막을
  이유가 없다(의도적 비대칭, 테스트로 고정).

### 4.4 중복 실행 방지 (§6/§7/§8)

- 댓글: `if (submitting || !comment.trim()) return;` — Enter 경로에도 가드
- 글 삭제 / 댓글 삭제: in-flight 상태 + 버튼 `disabled` + `삭제 중...`
- 글 작성: `if (submitting) return;` 가드 추가

### 4.5 SEO (§12)

```
전: openGraph.url = siteConfig.url        (= 홈, 모든 글이 동일)
후: canonical = absoluteUrl(`/community/${id}`)
    alternates: { canonical }
    openGraph: { ...buildOpenGraph(...), url: canonical }
```

공용 `buildOpenGraph`는 건드리지 않았다 — `/stats/compare`가 쓰는 것과 같은 패턴이라
범위 밖 화면에 영향을 주지 않는다. 오리진은 여전히 `siteConfig` 한 곳에서만 나온다.

`/community/write`는 robots.txt에서 이미 `Disallow` 중이다(확인).

### 4.6 PII (§13)

- 공개 응답 `select`에서 `author.id`(내부 cuid) 제거 — 클라이언트가 쓰지 않는 값이었다.
  소유권 판정은 `post.authorId` / `c.authorId` 스칼라로 계속 동작한다.
- 응답 select에 이메일·provider id·토큰 없음(테스트로 고정).
- 작성자 표시는 닉네임만.

### 4.7 닉네임 연계 (§9)

`Post`/`Comment`는 `authorId`만 저장하고 조회 시 `User`를 join한다.
**닉네임을 바꾸면 기존 글·댓글의 작성자명도 함께 바뀐다.** snapshot 컬럼을
만들지 않았고, 만들지 않는다는 것을 테스트로 고정했다.

## 5. 모바일 구조 점검 (§15)

- 목록 제목: `overflow: hidden` + `ellipsis` + `nowrap` (기존) ✓
- **작성자명 폭 제한 추가** — `.authorName` / `.commentAuthor`에 `max-width` + ellipsis.
  `USER_NICKNAME_EDIT_V1`으로 20자 닉네임이 가능해지면서 `.rowMeta`(flex-shrink: 0)가
  360px에서 제목을 밀어낼 수 있었다.
- 새로 추가한 버튼(재시도/첫 글 남기기/목록으로)은 모두 `min-height: 44px`.
- 댓글 입력창은 기존 구조 유지.

> **STRUCTURAL PASS / DEVICE QA REQUIRED.** 이 환경에 브라우저가 없어
> 360 / 390 / 430px 실제 렌더, 하단탭바 겹침, 키보드 동작은 확인하지 못했다.

## 6. 성능 (§18)

- 목록: `findMany` + `count` 를 `Promise.all`로 병렬, `take: 20`, `include`로 작성자·
  댓글수를 한 번에 가져온다 — **N+1 없음**.
- 상세: 글 + 댓글 + 작성자를 단일 쿼리로 가져온다 — **N+1 없음**.
- 인덱스: `@@index([pinned, createdAt])`, `@@index([aptName, createdAt])`,
  `@@index([postId])` — 목록 정렬/필터/댓글 조회 경로에 모두 대응.
- 중복 요청: SWR 키가 `page`/`aptName`로 안정적.

현재 구조로 충분하다고 판단해 **건드리지 않았다.** 실측 지연은 device QA 대상.

## 7. 테스트

`src/lib/community/community-launch.test.ts` — 26개, 전부 PASS.

공개 읽기(목록/상세 GET에 인증 없음) · 비로그인 쓰기 거부 · 작성자 id가 세션에서만 옴 ·
글/댓글 수정·삭제 소유권 + 403 · 관리자 판정 단일 기준 · 차단 계정 수정 차단(삭제는 허용) ·
닉네임 snapshot 부재 + live join · 내부 user id 미노출 · 응답 select에 이메일 없음 ·
false empty 금지(SWR error 반영, 오류가 빈 상태보다 먼저) · 재시도 수단 · 로딩 분기 ·
빈 상태 CTA + 과장 문구 금지 · 댓글 Enter 중복 가드 · 삭제 in-flight 가드 ·
작성 중복 가드 · 실패 시 입력 보존 · 목록 복귀 링크 · 닉네임 폭 제한 · 이모지 부재 ·
canonical/og:url · metadata PII 부재 · write 페이지 색인 제외.

전체: `npx tsx --test "src/**/*.test.ts"` → **948/948 PASS**

## 8. 검증

```
npx tsc --noEmit          src/ 오류 0
npx eslint <변경 파일>     오류 0, 경고 0
npm run build             Compiled successfully
```

회귀 확인: 로그인 · MY 닉네임 · 단지 상세 · 통계 · 리포트 · 지도 · 내비게이션 —
전부 무변경(커뮤니티 파일 외 수정 없음). 빌드 라우트 목록에서 기존 경로 유지 확인.

## 9. 남은 작업

- **DEVICE QA REQUIRED**: Android Chrome / 카카오 인앱 브라우저 / iPhone Safari / PC Chrome
  에서 360·390·430px 렌더, 하단탭바 겹침, 키보드, 실제 작성/삭제 플로우
- §3의 AuthGate 자동 모달 정책 결정
- P2 항목(신고, 댓글 수정, 카테고리=DB 변경 필요, draft 보존)
