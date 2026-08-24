# AUTH/MY V1 — MY-2: FAVORITES END-TO-END

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD 시작 시점**: `b009d8d fix(auth): normalize prisma schema encoding and complete my v1 migration`
- Production DB: `favorites`/`recent_views`/`user_preferences` 테이블은 MY-1C.1에서 이미 생성·검증 완료(row 0). 이번 STEP은 **DB schema 변경 없이** 기존 `favorites` 테이블만 사용한다.

## 2. API Architecture
- `GET /api/my/favorites` — 로그인 사용자의 favorites 전체 목록 (`createdAt desc`)
- `POST /api/my/favorites` — body `{ lawdCd, dong, name, aptSeq?, address? }`, upsert
- `DELETE /api/my/favorites?lawdCd=&dong=&name=` — 본인 favorite만 삭제(query string, body 없음)
- 응답 형식은 기존 `/api/community/posts` 등과 동일한 `{ success, data }` / `{ success:false, error }` 컨벤션을 그대로 따름.
- 신규 네임스페이스 `/api/my/*`를 처음 만듦(기존엔 `/api/community/*`, `/api/apt/*`뿐이었음) — 이후 recent-views/preferences 같은 MY 하위 기능도 이 네임스페이스 아래 자연스럽게 추가 가능.

## 3. Auth Contract
- 3개 handler 모두 `requireUser()`(`src/lib/auth-helpers.ts`, 기존 코드 그대로 재사용, 신규 auth 로직 없음)로 서버에서 세션을 검증하고, `userId`는 **오직 `user.id`(세션)에서만** 가져온다.
- client가 body/query로 보낸 `userId`는 애초에 읽지 않음 — 스키마 자체에 그런 필드가 없어 구조적으로 차단됨.
- 미로그인 요청은 GET/POST/DELETE 모두 401 (`{ success:false, error:'로그인이 필요합니다.' }`), `banned` 계정은 403 — `requireUser()`의 기존 동작 그대로.

## 4. Canonical Identity
- 상세페이지(`apt-client.tsx`)가 이미 들고 있는 `lawdCdState`/`urlDong`/`displayName || aptName`/`primaryAddress`를 그대로 사용 — recent-apartments.ts(로컬스토리지 "최근 본 단지")와 완전히 동일한 identity 소스, canonical routing 규칙(`/apt/[name]?lawdCd=&dong=`)과도 일치.
- `aptSeq`는 상세페이지 어디에도 변수로 노출되어 있지 않아(조사 결과) 비워둠(모델상 optional) — 임의로 추정/fuzzy 매칭하지 않음.
- 서버 `validateFavoriteInput()`(`src/lib/favorites.ts`)은 lawdCd/dong/name이 빈 문자열이 아닌지만 검증한다 — 클라이언트가 보낸 문자열의 "진짜 존재하는 단지인지"는 재해석하지 않는다(fuzzy resolution 금지 원칙).

## 5. Duplicate Policy
- `prisma.favorite.upsert({ where: { userId_lawdCd_dong_name: {...} }, update: { aptSeq, address }, create: {...} })` — DB `@@unique([userId, lawdCd, dong, name])`와 동일한 키.
- 같은 단지를 다시 저장해도 500이나 중복 row 없이 조용히 성공(`success:true`) — idempotent.

## 6. Delete Handling
- `deleteMany({ where: { userId: user.id, lawdCd, dong, name } })` — 항상 `userId` 조건 포함.
- 이미 없는 항목을 삭제해도(0건 삭제) 에러 없이 `success:true` — 다른 사용자의 데이터 존재 여부를 에러 메시지로 유추할 수 없게 함(정보 노출 방지).

## 7. Detail UX
- 위치: 단지 상세 Hero(`heroTop`) — 기존 `KakaoShareButton(compact)`와 나란히, 같은 pill 버튼 디자인 언어(44px 터치 타겟, `var(--ejip-green)` 계열) 재사용.
- 아이콘: `lucide-react` `Heart`, 비활성 시 outline, 활성 시 `fill="currentColor"` + 배경색 채움. 이모지 미사용.
- `aria-pressed`, `aria-label`("관심단지 저장"/"관심단지 해제")로 상태를 텍스트로도 구분(색상 단독 의존 금지).
- optimistic UI: 클릭 즉시 하트 상태 토글 → API 실패 시 원상복구 + 3초 노출되는 인라인 에러 토스트("관심단지를 저장하지 못했습니다."). 페이지 전체 crash 없음. 연속 클릭은 `pending` 플래그로 무시.

## 8. Login Transition
- 미로그인 사용자가 클릭 → **DB에 아무 것도 쓰지 않고** 기존 `LoginModal`을 그대로 재사용해서 띄움(새 provider/새 모달 없음).
- `LoginModal`은 `callbackUrl`을 넘기지 않으면 자동으로 `window.location.href`(현재 페이지, 같은 origin)를 사용 — 기존 컴포넌트의 기존 동작을 그대로 상속하므로 **open redirect 위험을 새로 만들지 않음**(외부 URL을 받는 파라미터 자체가 없음).

## 9. Pending Intent
- `src/lib/favorites.ts`의 `writePendingFavorite`/`readPendingFavorite`/`isPendingFavoriteValid`가 `sessionStorage`(`ejip:pendingFavorite`)에 로그인 전 의도를 저장.
- 로그인 후 복귀 시 FavoriteButton이 세션이 `authenticated`로 바뀌는 순간 pending intent를 확인 → **현재 보고 있는 단지(lawdCd/dong/name)와 정확히 일치하고, 저장된 지 10분 이내**일 때만 자동으로 POST 완료. 다른 단지/오래된 intent는 무시(자동 정리).
- 이 판정 로직(`isPendingFavoriteValid`)은 순수 함수로 분리해 `favorites.test.ts`에서 단위 테스트로 검증함.

## 10. MY UI
- `/my`(`src/app/my/page.tsx`)의 기존 `AuthGate`/세션 분기/섹션 구조를 그대로 유지한 채, 프로필 카드와 "바로가기" 사이에 "관심단지" 섹션만 추가(MY 전체 리디자인 없음).
- 로그인 상태에서 `GET /api/my/favorites`로 목록을 불러와 단지명/주소(optional)를 카드 리스트로 표시, 클릭 시 canonical routing(`/apt/[name]?lawdCd=&dong=`)으로 상세 이동.
- 비로그인 진입 시 동작은 기존 `AuthGate` 그대로(건드리지 않음) — "로그인이 필요한 페이지입니다" 카드 + 로그인 모달, wall 아님(닫고 둘러볼 수 있음).

## 11. Empty State
- favorites가 빈 배열이면 "아직 저장한 관심단지가 없습니다." + 홈으로 연결되는 "단지를 둘러보세요" 링크. 새 페이지 없음.

## 12. Security
- `requireUser()` 서버 검증(모든 write/list 공통) — client `userId` 신뢰 없음.
- ownership filter: GET은 `where:{userId}`, DELETE는 `where:{userId, ...}` — 항상 포함.
- SQL injection 위험 없음(Prisma parameterized query만 사용, raw SQL 없음).
- service role/OAuth 토큰을 로그·응답에 노출하지 않음(`console.error`는 에러 객체만, PII 없음).
- `callbackUrl`은 항상 현재 origin(`window.location.href`)로만 결정 — 사용자가 조작 가능한 외부 URL 입력 경로 없음.

## 13. Tests
`src/lib/favorites.test.ts` (node:test, 11개, 전부 PASS) — 순수 로직만 커버:
- validateFavoriteInput: 정상 통과, trim, 필수값 누락, 빈 문자열, non-object body, optional aptSeq/address 보존·정규화 (item G, H 대응)
- isPendingFavoriteValid: 동일 단지+TTL 이내 유효, 다른 단지 무효, TTL 초과 무효, 형식 불일치 무효 (item K의 안전장치 대응)

**커버되지 않음 (알려진 한계)** — repo에 API route/React 컴포넌트 테스트 관례(jest/vitest/RTL, Prisma/NextAuth mocking)가 전혀 없고, 이번 STEP에서 새 테스트 프레임워크를 도입하는 것은 "관심단지 기능 추가"라는 요청 범위를 넘는 인프라 결정이라 판단해 도입하지 않음:
- A/B(미인증 401), C(생성), D(중복 idempotent), E(본인 삭제), F(타인 접근 차단) — requireUser/Prisma 통합 동작이라 실제 DB 붙여야 검증됨. 대신 코드 리뷰로 로직을 재확인함(§3, §5, §6).
- I/L/M(상세 favorite 상태 렌더, MY 목록 렌더, empty state) — React 컴포넌트 렌더 테스트 도구가 repo에 없어 자동화 테스트 대신 **로컬 브라우저로 직접 확인**함(§12 참고).
- J/K 일부(로그인 게이트/콜백 안전성)는 브라우저에서 미로그인 클릭 → 로그인 모달 오픈 + `sessionStorage` intent 기록까지 실측 확인했으나, **실제 로그인 완료 후 자동완성/목록 표시는 검증 못 함**(§14 한계 참고).
- N(API 실패 안전 처리)은 코드상 try/catch + optimistic revert로 구현되어 있으나 실패를 인위적으로 유발하는 통합 테스트는 없음.

## 14. Mobile/Desktop QA
로컬 dev 서버(`localhost:3000`, 실제 production Supabase에 연결된 동일 DB — §18 참고) + Chrome 자동화로 실측. `resize_window`가 이 환경에서 실제 뷰포트를 바꾸지 못해(기존에도 확인된 문제) iframe-isolation 기법으로 진짜 360/375/390px 렌더링을 확인함.
- **360px**: 단지명이 2줄로 줄바꿈되는 케이스에서도 관심단지/공유하기 버튼이 `flex-wrap`으로 아래 줄로 자연스럽게 내려가 제목과 겹치지 않음. 터치 타겟 44px 유지.
- **375px / 390px**: 제목 1줄, 버튼 2개가 나란히 배치, 겹침/여백 이상 없음.
- 로그인 모달: 375px에서 카카오/네이버 버튼 풀너비로 정상 렌더, 닫기(X) 버튼 정상.
- `/my` 비로그인 진입(375px): 기존 AuthGate 동작 그대로(변경 없음) 확인.
- 데스크톱(958px 기준): Hero 영역에서 관심단지 버튼이 공유하기 버튼과 나란히, 어색한 여백 없음.
- 콘솔 에러: 위 모든 화면에서 0건.

## 15. Production Data Safety
- **이번 STEP 동안 production favorites 테이블에 어떠한 row도 생성하지 않았다.** 로컬 dev 서버가 실제 production Supabase에 연결되는 구조(별도 dev DB 없음, MY-1C 문서에 이미 기록됨)라, 브라우저 QA 내내 **로그인을 한 번도 완료하지 않고 비로그인 상태에서만** 클릭/렌더를 확인했다(로그인 모달 오픈까지만, 실제 카카오/네이버 OAuth는 진행하지 않음).
- `GET /api/my/favorites`도 비로그인 상태에서는 아예 호출하지 않도록 구현되어 있어(§7 FavoriteButton, §14 useEffect 가드) QA 중 production DB에 대한 조회조차 발생하지 않았다.
- `npx prisma validate`/`generate`는 스키마 파일만 읽고 DB에 연결하지 않음(§10 재확인 완료), 어떤 DB 접속도 없음.

## 16. Known Limitations
- **실제 로그인 후 E2E 미검증**: 인증된 상태에서의 찜 추가/삭제, MY 페이지의 실제 목록 표시, 로그인 복귀 후 pending intent 자동완성은 실제 Kakao/Naver 계정으로 로그인해야만 검증 가능한데, 이는 이번 STEP 권한 밖(§18 승인 필요)이라 수행하지 않았다. 다음 릴리스/QA에서 사용자 승인 하에 테스트 계정으로 검증 필요.
- API route에 대한 자동화 통합 테스트가 없다(§13) — repo에 관련 인프라가 없어 신규 도입하지 않기로 판단.
- `aptSeq`는 상세페이지에서 구할 수 있는 곳이 없어 항상 비어 저장된다 — 추후 필요해지면 별도 STEP에서 다룰 것.
- `.worktrees/score-v2-step35-expert-calibration/` 디렉터리가 `eslint .` 스캔에 포함되어 6만 건 이상의 무관한 lint 결과가 함께 출력됨을 발견했다(pre-existing, 이번 STEP과 무관) — MY-2가 만든 파일들만 별도로 scoped lint(§26)해서 0 error/0 warning 확인했지만, 이 worktree lint 노이즈 자체는 별도 정리가 필요해 보인다(범위 밖이라 손대지 않음).

## 17. Next Step
- MY-3 (최근 본 단지 DB 동기화, `RecentView`) 또는 실제 로그인 계정으로 MY-2 E2E 수동 QA 중 선택.
