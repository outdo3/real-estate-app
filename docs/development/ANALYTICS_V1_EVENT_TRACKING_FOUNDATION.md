# ANALYTICS_V1 — 이벤트 트래킹 기반 구축

## 목적

이집(e-jip) Analytics V1: 페이지뷰/세션 트래킹(`PageView`/`SearchLog`/
`ActiveSession`)은 이미 존재하지만, 클릭/필터/즐겨찾기/공유 같은 범용
커스텀 이벤트를 기록할 수단이 없었다. 이번 STEP은 **DB schema 변경
없이** 그 기반(수집 유틸리티 + API + 관리자 대시보드 노출)을 구축한다.
`feature/analytics-v1` 브랜치에서 독립적으로 진행했으며, main에 진행
중인 다른 작업(전체 실거래 이력 구축 V1)과 충돌 가능한 파일은 건드리지
않았다.

## 현재 상태 (작업 전)

- `PageView`(페이지 이동 로그), `SearchLog`(검색어 로그),
  `ActiveSession`(30초 하트비트 기반 실시간 접속자), `ErrorLog`(에러
  모니터링), `Report`(커뮤니티 신고) 5개 트래킹 테이블이 이미 있고,
  각각 `/admin/dashboard`의 특정 지표(오늘 PV, 인기 검색어, 실시간
  접속자, 에러 건수, 미처리 신고 건수)에 1:1로 연결돼 있었다.
- 클릭형 커스텀 이벤트(즐겨찾기 추가/삭제, 공유 클릭 등)를 위한
  필드/테이블은 존재하지 않았다.

## 분석

기존 5개 테이블 모두 이미 특정 지표에 연결돼 있어, 새 컬럼 없이
그대로 재사용하면 그 지표들이 오염될 위험이 있었다(예: 이벤트 row가
"오늘 PV" count에 섞임, `ErrorLog`/`Report`에 끼워 넣으면 에러/신고
건수가 가짜로 늘어남). `PageView`만 이 문제를 안전하게 피할 수
있었다 — `url` 필드가 자유 문자열이라 예약된 네임스페이스로 구분할
수 있고, 그 네임스페이스를 기존 집계 쿼리에서 명시적으로 제외하면
된다.

## 설계 결정

- **저장 전략(V1 한정, 임시)**: 이벤트는 `PageView` row로 저장하되
  `url = "/__event__/<eventName>"` 예약 네임스페이스를 쓴다. 이
  접두사는 Next.js App Router 라우트로 존재하지 않으므로 실제 페이지
  이동 로그와 절대 충돌하지 않는다.
- **고정 taxonomy**: `eventName`은 `src/lib/analytics/events.ts`의
  allow-list(`favorite_add`, `favorite_remove`, `share_success`,
  `share_attempt`)에 있는 값만 허용한다. 목록 밖의 이름은
  `/api/log/event`가 DB에 쓰지 않고 조용히 무시한다(200,
  `ignored:true`) — 임의 이벤트/자유 형식 props가 이 테이블에 쌓이는
  것을 코드 레벨에서 차단한다.
- **성공 시점 정의**: `favorite_add`/`favorite_remove`는 서버가
  성공을 확인해준 시점(`json.success`)에만 기록한다(낙관적 업데이트
  시점이 아님). 공유는 실제로 완료를 확인할 수 있는 경로만
  `share_success`로 기록한다 — Web Share API가 `'shared'`를 반환한
  경우, 그리고 `navigator.clipboard.writeText()`가 실제로 resolve된
  경우. 카카오 SDK(`Kakao.Share.sendDefault`)는 실제 전송 완료를
  알려주는 콜백이 없는 fire-and-forget 팝업 트리거이므로, 성공을
  과장하지 않고 `share_attempt`로 구분해 기록한다.
- **기존 지표 보호**: `/api/admin/dashboard`의 `todayPageViews`,
  `todayUniqueSessions`, `popularAptGroups` 3개 쿼리에
  `url: { not: { startsWith: '/__event__/' } }` 필터를 추가해 이벤트
  row가 절대 섞이지 않게 했다. 이벤트 자체는 최근 7일 집계로만 별도
  노출한다(`data.events`).
- **V2로의 이전 경로**: 이벤트당 props(부가 속성)를 저장할 별도
  필드가 없는 것은 V1의 알려진 한계다. 저장 백엔드는
  `src/lib/analytics/events.ts`, `src/lib/analytics/trackEvent.ts`,
  `src/app/api/log/event/route.ts` 세 파일에만 격리했으므로, V2에서
  전용 `Event` 테이블(스키마 변경, 별도 승인 필요)로 옮길 때 호출부
  (`FavoriteButton.tsx`, `useSharePage.ts` 등)는 변경할 필요가 없다.

## 구현 내용

- 신규: `src/lib/analytics/events.ts` — allow-list, `AnalyticsEventName`
  타입, `isAnalyticsEventName()`, `eventUrl()`.
- 신규: `src/lib/analytics/trackEvent.ts` — 클라이언트 fire-and-forget
  이벤트 트래커. `ViewTracker.tsx`의 fetch 관례(keepalive, 실패 무시)를
  그대로 따른다.
- 신규: `src/app/api/log/event/route.ts` — `/api/log/view`와 동일한
  입력 검증/truncate/`getCurrentUser`/무조건 2xx 응답 패턴을 재사용.
  allow-list 밖 이벤트명은 DB에 쓰지 않고 무시한다.
- 수정: `src/components/FavoriteButton.tsx` — `handleClick`의 서버
  성공 확인 직후(`if (!json.success) throw` 다음 줄)에
  `trackEvent('favorite_add' | 'favorite_remove', { complexId, aptName })`
  한 줄 추가. 기존 찜 로직/UX는 변경하지 않았고, 기존 `pending` 가드가
  중복 클릭으로 인한 중복 이벤트를 그대로 막아준다.
- 수정: `src/hooks/useSharePage.ts` — `share()` 콜백의 세 지점(네이티브
  공유 성공, 카카오 SDK 호출, 클립보드 복사 성공)에 각각
  `trackEvent(...)` 한 줄씩 추가. 분기/UX 로직은 변경하지 않았다.
  `complexId`/`aptName`은 이 훅이 페이지 비종속적(아파트 상세/통계/
  학교/지도 공용)이라 의도적으로 비워둔다.
- 수정: `src/app/api/admin/dashboard/route.ts` — `todayPageViews`/
  `todayUniqueSessions`/`popularAptGroups` 쿼리에 이벤트 제외 필터
  추가, `data.events`(최근 7일 이벤트명별 카운트) 필드 신규 추가.

## 테스트 결과

이 worktree(`D:\anti2\aaa\real-estate-app-work3`)에는 `.env`/
`.env.local`이 없어 `DATABASE_URL`, `NEXT_PUBLIC_KAKAO_MAP_API_KEY`가
모두 미설정이었다(임의로 생성/타 worktree에서 복사하지 않음 — secret
취급 원칙). 이 환경 제약이 검증 범위에 실제로 영향을 줬으며, 아래에
실행한 명령과 실제 결과만 정직하게 기록한다.

**정적 검증(실행 완료, 전부 실제 결과)**
- `npx tsc --noEmit`: 신규/수정 파일(analytics/events.ts,
  analytics/trackEvent.ts, api/log/event/route.ts,
  components/FavoriteButton.tsx, hooks/useSharePage.ts,
  api/admin/dashboard/route.ts) 관련 에러 0건. 전체 실행 결과 23건의
  TS 에러가 있었으나 전부 `scripts/**`(빌드에 포함되지 않는 1회성
  스크립트) 소속이고 이번 변경 이전부터 있던 것으로, 이번 변경이
  건드린 파일과 무관함을 확인했다(`FAIL_EXISTING_SCRIPT_ERRORS`).
- `npx eslint <각 수정 파일>`: 전부 에러/경고 0건.

**라이브 검증(dev 서버, 실제 실행 결과)**
- `npm ci`로 이 worktree에 처음 의존성 설치(기존에 `node_modules`가
  아예 없었음 — 이 사실도 함께 기록).
- `POST /api/log/event` with `name: "favorite_add"`: allow-list를
  통과해 `prisma.pageView.create()`까지 도달했으나, `DATABASE_URL`
  미설정으로 `{"success":false}` 응답 — 서버 로그로
  `Environment variable not found: DATABASE_URL` 원인을 확인. 같은
  worktree의 **기존** `/api/log/view`도 동일 요청 조건에서 동일하게
  `{"success":false}`로 실패함을 대조 확인(REGRESSION 아님, 이
  worktree 전체의 환경 설정 공백).
- `POST /api/log/event` with `name: "totally_made_up"`(allow-list
  밖): `{"success":true,"ignored":true}` — DB 시도 자체를 하지 않고
  즉시 무시함을 실측 확인(allow-list 게이트 PASS).
- `GET /api/admin/dashboard`(비로그인): `401
  {"success":false,"error":"로그인이 필요합니다."}` — 새로 추가한
  `ANALYTICS_EVENT_URL_PREFIX` import를 포함해 라우트가 정상
  컴파일/실행되고 `requireAdmin()` 게이트까지 정확히 도달함을 확인.
  다만 인증된 세션 + 실제 DB 데이터가 없어, "이벤트 3건을 더 발생시켜도
  오늘 PV/방문자/인기단지 숫자가 그대로인지"를 실측 숫자로 증명하는
  것은 이 worktree에서 **완료하지 못했다** — 코드 리뷰로 각 쿼리의
  `NOT LIKE '/__event__/%'` 필터 적용 위치를 직접 확인했을 뿐이다.
- Chrome 브라우저 자동화로 `/stats/decline` 페이지의 "공유" 버튼을
  실제로 클릭 시도: 이 환경의 Chrome이 `navigator.share`를 지원해
  Web Share API(OS 네이티브 공유 시트) 경로를 타는 것을 확인했으나,
  OS 레벨 다이얼로그는 브라우저 자동화 도구로 안전하게 관찰/해제할 수
  없어(자동화 세션이 블로킹될 위험) 더 진행하지 않고 중단했다. 즉
  `share_success`/`share_attempt` 분기의 실제 클릭 QA는 코드 리뷰
  수준(각 분기가 정확히 어떤 조건에서 어떤 이벤트명을 쓰는지 직접
  추적)에 머물렀고, 실제 브라우저 클릭 종단 검증은 완료하지 못했다.
- `/map` 페이지 로드 시 `NEXT_PUBLIC_KAKAO_MAP_API_KEY` 미설정으로
  "지도를 불러오는 데 실패했습니다" 확인 — 이 역시 이번 변경과 무관한
  worktree 환경 공백.

`npm run lint`(전체)/`npm run build`(전체)는 Task 8(최종 검증)에서
실행하고 결과를 이 문서와 별도로 커밋 로그/최종 보고에 남긴다.

## 알려진 문제

1. `KakaoShareButton.tsx`의 별도 3개 호출부(아파트 상세/
   StickyActionBar/학교 상세)는 `useSharePage`를 쓰지 않는 독립
   컴포넌트라 이번 V1 계측 범위에 포함되지 않았다. 필요 시 후속
   STEP에서 별도 계측 검토.
2. 이벤트당 props(부가 메타데이터)를 저장할 필드가 없다 — 확장이
   필요해지면 스키마 변경(별도 승인 필요)이 불가피하다.
3. 이 worktree는 `.env`/`.env.local`이 없어 `DATABASE_URL`/카카오 키
   기반 라이브 종단 검증(실제 DB row 적재 확인, 관리자 대시보드 회귀
   숫자 확인, 공유 버튼 실클릭)을 완료하지 못했다. main 병합 전에
   `DATABASE_URL`이 구성된 환경(원본 worktree 등)에서 아래를
   재검증할 것을 권장한다:
   - 로그인 후 즐겨찾기 추가/삭제 클릭 → `PageView`에
     `/__event__/favorite_add`|`/__event__/favorite_remove` row 적재 확인
   - 공유 버튼 클릭(모바일 네이티브 공유/클립보드) →
     `/__event__/share_success` 적재 확인
   - `/api/admin/dashboard`에서 이벤트 발생 전후 `todayPageViews`/
     `todayUniqueVisitors`/`popular30d` 숫자가 이벤트로 인해 변하지
     않는지, `data.events`에 카운트가 정확히 반영되는지 실측
4. 이 저장소에는 자동화 테스트 러너(jest/vitest 등)가 없다
   (`package.json`에 `test` 스크립트 없음) — 검증은 타입체크/린트/
   빌드/수동 QA로 대체했고, 이는 이 프로젝트의 기존 관행과 동일하다.

## 다음 STEP

- 검색결과 클릭 / 지도 마커 클릭 / 비교 / 필터 적용 / 통계→상세 이동
  등으로 `trackEvent` 계측 확장 (동일한 allow-list 확장 패턴).
- `KakaoShareButton.tsx` 3개 호출부 계측 검토.
- 필요해지면 Analytics V2에서 전용 `Event` 테이블로 저장 백엔드 이전
  (스키마 변경, 별도 승인 필요) — 호출부는 변경 불필요하도록 이미
  격리해둠.
- DATABASE_URL이 구성된 환경에서 위 "알려진 문제 3" 재검증.
