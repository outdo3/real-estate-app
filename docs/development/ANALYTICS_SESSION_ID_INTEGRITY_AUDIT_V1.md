# E-JIP ANALYTICS SESSION ID INTEGRITY AUDIT V1

READ ONLY. Production write 0 · schema 0 · user_agent 수집 0 · bot filter 변경 0.
Production 조회는 전부 집계(COUNT/분포)만 — session_id·user_id는 출력하지 않았다. 스크립트: `tmp/analytics-session-audit/`(미커밋).

## 판정

**TRACKING_MODEL_LIMITATION + BOT_LIKE 트래픽.** sessionId 과생성 버그는 **없다.**
"319 / 321"은 **2026-09-21 KST** 하루치이며(오늘 09-22는 12:17 KST 기준 1 / 1), 그중 거의 전부가
JS를 실행하는 자동 클라이언트의 모양을 하고 있다. UA가 저장되지 않으므로 bot으로 **확정하지는 않는다.**

## 1. sessionId 생성 — 경로 하나

`src/lib/live-presence.ts` `getClientSessionId()`:

| 항목 | 값 |
|---|---|
| 생성 | `crypto.randomUUID()` (없으면 `Date.now()-random`) |
| 저장 | **sessionStorage**, key `egip_session_id` |
| 최초 생성 | 첫 `getClientSessionId()` 호출 — ViewTracker의 첫 view/heartbeat effect(클라이언트만, 서버는 `''` 반환) |
| 재사용 | 같은 탭의 sessionStorage에 값이 있으면 항상 재사용 |
| 만료 | 코드상 만료 없음 — 탭(브라우징 컨텍스트)이 끝나면 브라우저가 지운다 |

다른 생성 경로 없음(`randomUUID`/`sessionStorage` 전수 검색). 스키마 주석(`PageView.sessionId`)도 같은 의미를 적고 있다.

## 2. 생명주기 (localhost:3100 실측 — NON_PRODUCTION이라 기록 0)

| | 상황 | 결과 | 근거 |
|---|---|---|---|
| A | 같은 페이지 새로고침 | **SAME** (+PV 1) | 실측 |
| B | SPA 내부 이동 | **SAME** (+PV 1/경로) | 실측 |
| C | 같은 탭 뒤로/앞으로 | **SAME** (경로가 바뀌면 +PV) | 실측 |
| D | 새 탭 — `window.open`(opener 유지) | **SAME** — Chrome이 sessionStorage를 복사 | 실측 |
| D' | 새 탭 — `target=_blank rel=noopener` 링크 | **NEW** | 실측 |
| E | 주소 복사 후 새 탭 | **NEW** | 실측 |
| F | 같은 브라우저 새 창 | **NEW** | E와 같은 이유(새 최상위 컨텍스트) — 코드 기준 |
| G | 브라우저 완전 종료 후 재실행 | **NEW**, 단 "이전 세션 복원"이면 **UNKNOWN**(브라우저가 sessionStorage를 복원할 수 있음) | 코드 기준 |
| H | 시크릿 창 | **NEW** | 코드 기준 |
| I | PWA standalone | 실행마다 **NEW**, 백그라운드 유지 중엔 SAME | 코드 기준 |
| J | 카카오 인앱브라우저 | 링크를 열 때마다 새 WebView면 **NEW** — 실기기 **UNKNOWN** | 코드 기준 |

쿼리/해시만 바뀌면 PV 없음(실측 — ViewTracker는 `usePathname`에만 반응).

## 3. 계약 분류

현재 구현은 **"하나의 브라우저 탭 동안 유지되는 익명 sessionId"** 다. visitorId(설치 단위·기간 유지)가 아니다.
같은 사람이 새 탭·새 창·재실행할 때마다 새 세션이 된다. 바꾸지 않았다.

## 4. 페이지뷰 생성

- `ViewTracker`(AppProviders에 1회 마운트): `pathname`이 바뀔 때마다 1건. `/apt/*`는 건너뛴다.
- `/apt/*`: `apt-client.tsx`가 `pageReady` 후 1건(단지명 포함).
- 새로고침 = 재마운트 = +1. prefetch는 마운트가 없어 0. StrictMode 이중 effect는 개발 모드에만 있다.
- 서버(`/api/log/view`)는 `classifyTraffic`로 QA·관리자·**알려진 bot UA**·비운영 환경을 **쓰기 전에** 버린다(UA는 저장하지 않음).
- 잠재 위험: `apt-client`의 effect 의존성에 `displayName`/`aptName`이 있어 이름이 늦게 바뀌면 2건이 될 수 있다 — **Production에서 관측 0**(같은 세션·같은 URL 3초 내 중복 0).

## 5~9, 12. 2026-09-21 KST 실측 (`created_at`은 naive UTC — KST 변환은 `(created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul'`)

| 지표 | 값 |
|---|---|
| sessions / PV | **319 / 321** (관리자 화면 값과 정확히 일치) |
| 1-PV 세션 | **317 (99.4%)** |
| 2-PV 세션 | 2 (0.6%) |
| 3+-PV 세션 | 0 (0%) |
| 평균 / 중앙값 / 최대 | 1.006 / 1 / 2 |
| 로그인 세션 | **0** |
| 서로 다른 URL | **187** (sitemap 138 중 55 + sitemap 밖 132: `/apt/*` 97, `/stats/*` 19, `/report/*` 11 …) |
| 1-PV 세션 URL 분류 | apt 129 · report 85 · stats 52 · community 20 · other 16 · home 11 · map 2 · school 2 |
| TOP URL | `/finance-fit` 12 · `/` 11 · `/stats/compare` 10 · `/community` 10 · `/community/write` 10 · `/report/city/busan` 6 · 나머지 대부분 URL당 1~2 |
| 시간대(KST) | 02시~15시 매시간 **22~30개**로 평탄, **08~09시 0**, 16시에 4개로 급감 후 종료 |
| 새 세션 간격 | 중앙값 **130초**, 1초 미만 0, 5초 미만 1 |
| 체류 | 1-PV 317 중 315가 이탈 신호 없이 presence 행이 남았는데, **30초 이상 살아 있던 세션 0** (첫 heartbeat 외 추가 heartbeat 없음) |
| 이벤트 | 379건/230세션 — **전부 로드 시 자동 노출 이벤트**(partner_cta_impression 150, detail_map_view 129, report_view 86, finance_fit_start 12, pwa_install_banner_view 2). 클릭·검색·비교·찜·공유 **0**, search_logs **0** |
| 전날 이어진 세션 | 0 |
| 비교 — 다른 날 | 09-14 31/108 · 09-15 14/75 · 09-16 13/20 · 09-17 4/4 · 09-18 4/4 · 09-19 11/31 · 09-22(12시까지) 1/1 |

`/__event__/` 행은 방문·PV 집계에서 제외된다(`admin-analytics/query.ts:91-92`, `api/admin/dashboard/route.ts:139`). 위 원시 분석도 같은 조건을 썼다.

**자동화 판정: BOT_LIKE.** 사람이라면 나올 수 없는 조합이다 — 14시간 동안 2분 간격의 일정한 도착, 세션당 정확히 1페이지,
URL을 거의 겹치지 않는 너비 우선 순회(글쓰기 화면 10회 포함), 로그인 0, 상호작용 0, 그리고 **317개 중 30초를 넘긴 탭이 하나도 없음**.
페이지를 렌더링해 JS를 실행하는 크롤러이며, 현재 UA 패턴(`traffic-classification.ts`)에 걸리지 않는 UA를 쓴다. 어떤 크롤러인지는 UA 없이 알 수 없다.

## 10~11. sessionStorage 동작 · 중복 생성 버그

- 새 탭(noopener·주소 입력)은 NEW, opener 탭은 SAME — "방문 세션"은 **사람이 아니라 탭 세션**에 가깝다.
- 중복 생성 버그 **없음**: 경로 이동마다 재생성 없음(실측) · 재마운트 시에도 sessionStorage 재사용 · 서버는 생성하지 않음 ·
  동기 read-then-set이라 같은 탭 경합 없음. 크롤러는 페이지마다 새 컨텍스트로 열기 때문에 세션이 새로 생긴 것이지, 코드가 과생성한 것이 아니다.
- 부수: sessionStorage 접근이 막힌 환경에서는 `getItem`이 던져 그 PV가 **빠진다**(과소 집계 방향, 과대 아님).

## 13. "오늘 방문 세션 319"의 정확한 뜻

> "2026-09-21 KST 하루 동안 page_views에 기록된 서로 다른 브라우저 탭 세션 수 319개 — 알려진 bot UA·관리자·QA는 제외했지만, 그 밖의 자동 클라이언트는 포함된다."

## 알려진 영향

- 09-21의 방문/PV뿐 아니라 **노출형 이벤트 지표도 부풀었다**: `finance_fit_start` +12(이 이벤트는 페이지 로드 시 발생 — 이름과 달리 "시작"이 아니다), detail_map_view 129, report_view 86, partner_cta_impression 150.

## 다음 권고 (구현 없음)

1. **쿼리만으로 가능한 "참여 세션" 지표를 병기** — 2PV 이상 또는 상호작용 이벤트 1건 이상인 세션. 스키마·수집 변경 없이 바로 가능하며, 09-21 값은 이 기준으로 한 자릿수가 된다.
2. **UA 분류 결과만 저장(원문 UA 저장 아님)** 은 스키마 + 개인정보 결정이다 — 승인이 필요하다.
3. visitorId(localStorage, 기간 유지)는 제품·개인정보 결정이다. 지금 계약(탭 세션)을 유지한다면 화면 라벨을 "방문 세션(탭 기준)"으로 명확히 한다.
