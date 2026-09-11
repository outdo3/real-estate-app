# GA4 INTEGRATION V1

작성일: 2026-09-11
기준 커밋(작업 시작): `e2a51f3` (branch `main`)

---

## 1. 목적과 아키텍처 원칙

이집에는 이미 1st-party 분석이 있다(`trackEvent` → `/api/log/event` → `PageView` 테이블).
이 STEP은 **그것을 유지한 채** GA4를 2차 레이어로 추가한다.

| 레이어 | 역할 | 저장소 | 소유 질문 |
|---|---|---|---|
| 1st-party (기존) | 제품 분석 | 자체 DB(`PageView`) | "단지 A를 몇 명이 봤나", "실시간 접속자", "다음 행동 클릭" |
| GA4 (신규) | 마케팅/유입 분석 | Google | "카카오 공유로 몇 명이 들어왔나", "어떤 캠페인이 리포트 저장으로 이어지나" |

**두 시스템을 합치지 않는다.** 그리고 어느 쪽도 다른 쪽의 선행 조건이 아니다.

- GA4가 실패해도(ID 미설정 / 광고 차단기 / 네트워크 실패) 1st-party 로깅과 제품 기능은 그대로 동작한다.
- 반대로 `sessionId`가 없어 1st-party가 기록하지 못하는 상황에서도 GA4는 독립적으로 동작한다.

---

## 2. 변경/추가 파일

**신규**

| 파일 | 역할 |
|---|---|
| `src/lib/analytics/ga.ts` | GA4 코어. 환경 게이트, 파라미터 allowlist/정제, page_view 중복 방지, `gaEvent`/`gaPageView` |
| `src/lib/analytics/ga-events.ts` | 1st-party 이벤트명 → GA4 이벤트명 **매핑 단일 원본** |
| `src/components/analytics/GoogleAnalytics.tsx` | gtag 로더 + App Router page_view |
| `src/lib/analytics/ga.test.ts` | 22 tests |
| `src/lib/analytics/ga-events.test.ts` | 7 tests |

**수정**

| 파일 | 변경 |
|---|---|
| `src/lib/analytics/events.ts` | 리포트 이벤트 4종을 1st-party taxonomy에 추가 |
| `src/lib/analytics/trackEvent.ts` | GA4 브리지 1줄 + GA 전용 `ga` 컨텍스트 필드 |
| `src/components/AppProviders.tsx` | `<GoogleAnalytics />` 마운트(ViewTracker **다음**) |
| `src/components/report/ReportActions.tsx` | 리포트 진입/저장/공유 계측 |
| `src/components/pwa/InstallBanner.tsx` | 기존 이벤트에 `placement: 'banner'` 부여 |
| `src/components/pwa/InstallEntry.tsx` | 기존 이벤트에 `placement: 'entry'` 부여 |

DB 스키마 변경 없음. migration 없음. 프로덕션 DB 쓰기 없음. **npm 의존성 추가 없음.**

---

## 3. 로더 아키텍처

`@next/third-parties`도 `react-ga4`도 쓰지 않고 **`next/script` + 공식 gtag 스니펫**을 쓴다.

이유:

1. `package.json` / `package-lock.json`이 현재 사용자 작업으로 수정된 상태다. 이 STEP이 그 파일을 건드리지 않는 것이 안전하다.
2. `@next/third-parties`가 하는 일은 결국 같은 gtag 스니펫을 `afterInteractive`로 붙이는 것이다. 기능 이득 없이 의존성만 늘어난다.
3. 자체 구현이므로 `send_page_view:false`, QA suppression 연동, 유입 URL 스냅샷 같은 이집 고유 요구를 그대로 넣을 수 있다.

동작:

```
GoogleAnalytics (client, AppProviders에 1회 마운트)
  └ mount effect → gaRuntimeEnabled() 판정 → enabled state
      └ enabled일 때만 <Script id="ga4-lib">  (googletagmanager.com/gtag/js, afterInteractive)
                       <Script id="ga4-init"> (dataLayer + gtag('config', ID, {send_page_view:false}))
```

- **서버에서는 아무것도 렌더하지 않는다.** hydration 불일치가 구조적으로 없다.
- `next/script`의 고정 `id`와 단일 마운트 지점으로 **중복 주입이 불가능하다.**
- `ga.ts`의 `ensureGtag()`가 `dataLayer`/`gtag` 스텁을 멱등하게 보장하므로, gtag.js가 붙기 **전에** 발생한 이벤트도 큐에 쌓였다가 처리된다.

---

## 4. Measurement ID / 환경변수

| 변수 | 값 | 필수 | 설명 |
|---|---|---|---|
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-XXXXXXXXXX` | 아니오 | 없으면 GA4 전체가 조용히 비활성. 앱은 정상 동작 |
| `NEXT_PUBLIC_GA_DEBUG` | `true` | 아니오 | 로컬/프리뷰에서 GA4 강제 활성 + `debug_mode:true`(DebugView) |

- **소스에 ID를 하드코딩하지 않는다.** `process.env`로만 읽는다.
- 형식 검증: `/^G-[A-Z0-9]{4,24}$/`. `UA-`(Universal Analytics), `GTM-`(태그 매니저 컨테이너), 소문자, 오타는 전부 거부되어 GA4가 꺼진다. 잘못된 ID로 조용히 엉뚱한 속성에 쏘는 사고를 막는다.
- 저장소에 `.env.example`은 없고 `.gitignore`가 `.env*`를 제외한다. 이 STEP에서 `.gitignore` 규칙을 바꾸지 않았다. 환경변수는 이 문서와 Vercel 프로젝트 설정이 원본이다.
  - 권장(선택): `.gitignore`에 `!.env.example` 예외를 두고 값 없는 템플릿을 커밋하는 방식. 이 STEP의 범위를 넘어서므로 실행하지 않았다.

---

## 5. 환경별 동작 (§18)

| 환경 | `NODE_ENV` | GA4 |
|---|---|---|
| 로컬 `next dev` | development | **OFF** (`NEXT_PUBLIC_GA_DEBUG=true`로만 ON) |
| Vercel Preview | production | ON (ID가 있으면) |
| Vercel Production | production | ON (ID가 있으면) |
| ID 미설정 | — | 항상 OFF |
| QA suppression 세션(`?__ejip_qa=1`) | — | 항상 OFF |

호스트명을 가정하지 않는다. Vercel Preview는 배포 전 검증에 실제로 유용하므로 일부러 켜 둔다.

**QA suppression 연동이 중요하다.** 1st-party에서 제외하는 운영자/QA 트래픽을 GA4에만 남기면 두 지표가 영구히 어긋난다. 그래서 `GoogleAnalytics`는 `AppProviders`에서 반드시 `ViewTracker` **다음에** 놓인다 — `ViewTracker`의 마운트 effect가 `initQaSuppressionFromUrl()`로 플래그를 먼저 확정해야 GA4가 같은 기준으로 판단할 수 있다.

---

## 6. page_view 전략 (§4)

**중복 집계를 막기 위해 자동 page_view를 끈다.**

```js
gtag('config', ID, { send_page_view: false })
```

그 다음 `usePathname()` 변화에 맞춰 수동으로 1건씩 보낸다. 자동/수동을 함께 켜면 최초 로드가 두 번 집계된다.

이중 방어가 하나 더 있다: `createPageViewDeduper()`가 **직전에 보낸 `page_path`와 같으면 보내지 않는다.** 개발 모드 StrictMode의 effect 이중 실행이나 동일 경로 재렌더로 세션/이탈률이 조용히 왜곡되는 것을 막는다.

### `useSearchParams`를 쓰지 않은 이유

루트 레이아웃 아래 클라이언트 컴포넌트에서 `useSearchParams()`를 쓰면 **앱 전체가 정적 렌더링에서 이탈한다**(Next 16). 그래서 `usePathname()`으로만 트리거하고, 쿼리는 effect 시점에 `window.location`에서 읽는다.

부수 효과: **쿼리만 바뀌는 변화는 page_view를 만들지 않는다.** 지도 패닝은 400ms마다 `replaceState`로 쿼리를 갱신하는데(`src/app/map/page.tsx`), 그것이 전부 page_view가 되면 GA4가 노이즈로 덮인다. 지금 동작이 오히려 바람직하다.

빌드 결과로 확인: `/`, `/map`, `/privacy`, `/terms`, `/community`, `/my`, `/finance-fit`, `/tools`, `/admin/*` 이 여전히 `○ (Static)`으로 프리렌더된다 — 정적 렌더링 이탈이 발생하지 않았다.

### page_view 페이로드 (§5)

`page_path`, `page_location`, `page_title` 셋뿐이다. 이름/이메일/전화/자유 텍스트 검색어는 실리지 않는다.

---

## 7. UTM / 유입 (§6, §21)

**발견한 실제 위험 — `/map` 랜딩의 UTM 소실**

`src/app/map/page.tsx`는 지도가 준비된 뒤 400ms 디바운스로

```js
const next = `${window.location.pathname}?${qs}`;   // qs = 지도 파라미터만
window.history.replaceState(window.history.state, '', next);
```

를 실행한다. 즉 `/map?utm_source=kakao`로 들어온 랜딩은 **잠시 뒤 주소창에서 utm이 사라진다.** gtag.js는 `afterInteractive`로 느리게 붙으므로, 그 시점에 `window.location.href`를 읽으면 이미 늦었을 수 있다.

**대응:** 지도의 URL 동기화 동작은 **바꾸지 않았다**(뒤로가기 복원 계약이 그 동작에 의존한다. 이 STEP의 범위 밖이다). 대신 `ga.ts`가 **클라이언트 모듈이 평가되는 가장 이른 시점에 원본 URL을 스냅샷**으로 붙잡고, 첫 page_view는 그 스냅샷으로 보낸다.

```ts
const INITIAL_LOCATION_HREF = typeof window !== 'undefined'
  ? stripInternalQueryParams(window.location.href) : null;
```

그 외:

- `stripInternalQueryParams()`는 내부 파라미터(`__ejip_qa`)만 제거한다. **`utm_*`는 절대 건드리지 않는다**(테스트로 고정).
- `document.referrer`에 손대지 않는다. GA4의 자동 referrer 수집을 방해하지 않는다.
- 리포트 canonical URL(`reportCanonicalUrl`) 생성 로직을 바꾸지 않았다. 공유받은 사람의 유입 출처가 보존된다.
- **커스텀 UTM DB를 만들지 않았다**(§6 요구대로).

---

## 8. 이벤트 매핑 (§7~§9)

브리지는 `trackEvent()` **한 곳뿐이다.** 앱의 모든 이벤트가 이미 이 함수를 통과하므로 호출부는 한 줄도 바뀌지 않는다.

```ts
if (isQaSuppressed()) return;              // 두 시스템 동시 제외
const gaName = toGaEventName(name);
if (gaName) gaEvent(gaName, context.ga);   // GA4 (실패해도 throw 없음)
if (!sessionId) return;
fetch('/api/log/event', ...)               // 1st-party (기존 그대로)
```

한 번의 사용자 행동 = **1st-party 1건 + (매핑돼 있다면) GA4 1건.** 재귀 없음(`gaEvent`는 `trackEvent`를 호출하지 않는다), 1st-party 중복 호출 없음.

### 매핑표 (`src/lib/analytics/ga-events.ts`)

| 1st-party | GA4 | 비고 |
|---|---|---|
| `favorite_add` / `favorite_remove` | 동일 | 재방문 의도 |
| `share_success` | `share` | GA4 권장 이벤트명 |
| `compare_start` / `compare_add` / `compare_detail_click` / `compare_share` | 동일 | |
| `report_view` / `report_image_save` / `report_pdf_save` / `report_share` | 동일 | 신규 |
| `pwa_install_banner_view` / `_click` / `_accept` / `_dismiss` / `_guide_open` | 동일 | 기존 이벤트 재사용 |

### 일부러 보내지 않는 것

| 제외 | 이유 |
|---|---|
| heartbeat / leave / 조회 로그 | 고빈도 노이즈. 세션·참여도는 gtag가 이미 잰다 |
| `share_attempt` | `share_success`의 선행 단계 — 같은 행동이 두 번 잡힌다 |
| `compare_remove` | 이탈 신호는 제품 분석 영역 |
| `next_action_click`, `finance_fit_*` | 제품(의사결정 여정) 분석. 1st-party가 `actionType`까지 들고 있다. GA4는 유입 레이어로 한정 |
| 내부 에러/디버그 이벤트 | 내보내지 않는다 |
| 검색 원문(`search_submit`) | 자유 텍스트를 배제한 페이로드 계약이 아직 없다. **V1에서 구현하지 않았다** |

**기본값이 "보내지 않음"이다.** taxonomy에 새 이벤트가 생겨도 이 표에 추가하지 않는 한 GA4로 나가지 않는다(테스트로 고정).

---

## 9. 리포트 이벤트 (§11)

`ReportActions`는 4개 리포트 시트(단지/비교/일간/지역) 각각에 **정확히 한 번** 렌더된다. 리포트당 1회 진입을 보장하는 유일한 클라이언트 마운트 지점이라 여기에 계측을 넣었다.

| 이벤트 | 발생 시점 |
|---|---|
| `report_view` | 마운트 1회 (`useRef` 가드로 StrictMode 이중 실행 차단) |
| `report_image_save` | **캡처가 실제로 성공하고 다운로드가 시작된 뒤**. 실패한 저장을 저장으로 세지 않는다 |
| `report_pdf_save` | `window.print()` 호출 시 |
| `report_share` | Web Share **성공** 또는 링크 복사 **성공** 시. **사용자 취소는 집계하지 않는다** |

파라미터: `report_type`(고정 enum), `scope_type`(고정 enum), `lawd_cd`(있을 때), `method`(`web_share` / `web_share_file` / `copy_link`).

`report_view`를 제외하면 **렌더로 발생하는 이벤트가 없다.**

---

## 10. PWA 이벤트 (§12)

기존 5개 이벤트를 그대로 브리지했다. **새 이벤트를 심지 않았다.**

추가한 것은 `placement` 파라미터뿐이다: 배너(`banner`)와 설정 진입(`entry`)을 GA4에서 구분하기 위함이다. 두 표면은 동시에 발생하지 않으므로 중복 집계가 아니라 퍼널 구분이다.

`pwa_install_click` 다음에 `pwa_install_accept`/`dismiss`가 오는 것은 **중복이 아니라 기존의 의도된 퍼널**(클릭 → 결과)이며, 그 의미를 바꾸지 않았다.

---

## 11. 찜 / 비교 (§13, §14)

- 찜: `favorite_add` / `favorite_remove`가 이미 존재했다. 그대로 브리지했다.
- 비교: `compare_start`, `compare_add`, `compare_detail_click`, `compare_share`가 이미 존재했다. 그대로 브리지했다.
- **`compare_view`는 만들지 않았다.** `/compare` 진입은 GA4 page_view가 이미 잡는다. 분석을 위해 제품에 새 이벤트를 심을 이유가 없다(§13 "분석만을 위해 제품 동작을 추가하지 않는다").
- `compare_count`는 V1에서 싣지 않았다. 파라미터 키는 allowlist에 준비돼 있으므로 필요해지면 `CompareV2`에서 `ga: { compare_count }`만 넘기면 된다.
- 단지명은 GA4로 보내지 않는다.

---

## 12. 파트너 CTA (§15)

**저장소에 파트너 리드 기능이 존재하지 않는다.** 관련 컴포넌트/이벤트/라우트 검색 결과 0건.

그래서 파트너 이벤트를 **지어내지 않았다.** `partner_cta_impression` / `partner_cta_click` 두 이름만 `GA_RESERVED_PARTNER_EVENTS`에 예약해 두어, PARTNER LEAD TRACKING V1이 실제로 구현되면 매핑표에 한 줄씩 추가하는 것만으로 연결되게 했다.

`call_connected`, `consultation_completed`처럼 **측정 수단이 없는 성과 이벤트는 예약조차 하지 않았다** — 존재하면 언젠가 추정값으로 채워질 위험이 있다(테스트로 고정).

---

## 13. PII 보호 (§10, §23)

**denylist가 아니라 allowlist다.** denylist는 새 호출부가 생길 때마다 빠뜨릴 수 있지만, allowlist는 "적지 않은 것은 나가지 않는다"가 기본값이다.

허용 키 전체:
`page_path`, `page_location`, `page_title`, `page_type`, `report_type`, `scope_type`, `placement`, `partner_type`, `lawd_cd`, `device_class`, `source_surface`, `method`, `compare_count`, `debug_mode`

`email` / `phone` / `name` / `customer_name` / `owner_name` / `session_token` / `oauth_id` 같은 키는 **목록에 없으므로 구조적으로 전송이 불가능하다**(테스트로 고정).

심층 방어 3겹:

1. 키 allowlist
2. **값** 검사 — 허용된 키라도 값이 이메일/전화번호 패턴이면 버린다
3. 타입/길이 — string·number·boolean만, 빈 문자열 제외, 100자 절단

`TrackEventContext.ga`는 **GA4 전용 필드이며 1st-party POST 본문에 절대 포함되지 않는다.** 서버/스키마/관리자 대시보드는 전혀 영향받지 않는다.

### `aptSeq` 판단 (§10 명시 요구)

**V1에서는 `aptSeq`를 GA4로 보내지 않는다.**

- `aptSeq`는 국토부 공개 단지 식별자로 사람이 아니라 건물을 가리키므로 그 자체로 PII는 아니다.
- 그럼에도 보내지 않는 이유: (a) GA4의 역할은 유입/획득 분석이고 단지 단위 제품 분석은 1st-party가 `complexId`/`aptName`으로 이미 완전히 커버한다. (b) 고카디널리티 값은 GA4 커스텀 디멘션 할당량을 빠르게 소모한다. (c) 사용자의 열람 단지 이력을 제3자에게 넘길 필요가 지금은 없다.
- 지역 단위 분석에는 `lawd_cd`(공개 행정구역 코드)로 충분하다.
- 필요해지면 allowlist에 키를 추가하는 것만으로 가능하지만, **그때 다시 판단한다.**

### 클라이언트 노출 검증

빌드된 `.next/static/chunks`에서 `GA_API_SECRET` / `service_account` / `private_key` 검색 결과 **0건**. 클라이언트에 나가는 GA 관련 값은 Measurement ID(공개값) 하나뿐이다. GA Admin API 키·서비스 계정·서버 분석 시크릿은 이 STEP에서 도입하지 않았다.

---

## 14. 실패 안전성 (§17)

`gaEvent` / `gaPageView`는 **전체가 try/catch로 감싸여 있고 어떤 경우에도 throw하지 않는다.**

no-op이 되는 조건: 서버 렌더(`window` 없음) / ID 미설정·형식 오류 / dev 환경 / QA suppression / `gtag` 접근 실패.

따라서 gtag.js가 광고 차단기에 막히거나 로드에 실패해도:

- JS 크래시 없음
- 네비게이션 차단 없음
- 공유·PWA 설치·CTA 차단 없음 — 이벤트 전송은 이 동작들의 **뒤나 옆**에서 일어나며 앞을 막지 않는다

테스트로 고정: `gtag`가 없는 환경에서 모든 공개 함수가 던지지 않는다.

---

## 15. 성능 (§22)

- **npm 의존성 0개 추가.** 번들에 들어가는 것은 자체 코드 3개 모듈(원본 약 17.9 KB, 주석 포함 — 압축 후에는 훨씬 작다)뿐이다.
- gtag.js는 Google CDN에서 `afterInteractive`로 받는다. 동기 블로킹 스크립트가 아니며 초기 렌더/LCP 경로에 없다.
- **ID가 없으면 `googletagmanager.com` 요청이 아예 발생하지 않는다**(스크립트 자체가 렌더되지 않는다).
- 정적 렌더링 이탈 없음(§6에서 확인).
- 참고: 이 저장소의 Next 16.3 빌드 출력은 라우트별 바이트 크기를 인쇄하지 않아, 빌드 로그 기반의 정확한 번들 델타 수치는 제시할 수 없다.

---

## 16. 개인정보/동의 판정 (§16)

### 판정 이력

| 시점 | 판정 |
|---|---|
| GA4 INTEGRATION V1 (2026-09-11, `e2a51f3`) | **PRIVACY POLICY UPDATE NEEDED** — 코드만 구현하고 방침은 초안만 제시 |
| GA4 PRIVACY POLICY PATCH V1 (2026-09-11, `48a4ddd`) | **RESOLVED (기술적 고지 완료)** — 아래 반영. 단 일부 항목은 법률 검토 권고 상태로 남음 |

### 반영된 내용 (`src/app/privacy/page.tsx`)

| 위치 | 변경 |
|---|---|
| 머리말 | `시행일자: 2026년 8월 11일` → `시행일자: 2026년 8월 11일 · 최종 개정일자: 2026년 9월 11일` |
| 1-나. 자동 수집 정보 | 자동 수집 정보 중 일부가 Google Analytics를 통해서도 수집된다는 상호참조 1줄 추가(7항 연결) |
| 5. 처리의 위탁 | 수탁업체 표에 `Google LLC / 서비스 이용 현황 분석(Google Analytics)` 행 추가 |
| 7. 제목 | `쿠키(Cookie)의 운영 및 광고 서비스` → `쿠키(Cookie)의 운영 및 이용 분석·광고 서비스` |
| 7-가 | 쿠키 일반 문단 — 목적에 "로그인 상태 유지 / 이용 현황 분석" 명시, 삭제 방법 추가 |
| 7-나 (신규) | Google Analytics 고지 — 처리 주체(Google LLC), 처리 정보, 이용 목적, PII 미전송, 거부 방법, Google 정책 링크 |
| 7-나 표 (신규) | 분석 쿠키 표 — `_ga, _ga_로 시작하는 쿠키` / `Google (Google Analytics)` / `방문 횟수·유입 경로 등 서비스 이용 통계 분석` |
| 7-다 | 기존 광고 문단을 소제목 아래로 이동(문구 자체는 무변경) |
| 부칙 | 최초 시행일 보존 + 2026-09-11 개정 시행 문단 추가 |

**코드 변경 없음.** GA 계측 동작, Measurement ID, 이벤트 매핑, allowlist는 한 줄도 건드리지 않았다.

### 문안이 실제 구현과 일치하는가 (검증)

| 방침 문구 | 근거 코드 | 일치 |
|---|---|---|
| "쿠키 또는 이에 준하는 식별자" | gtag.js 기본 동작(`_ga`, `_ga_<container>`) | O |
| "기기·브라우저 정보, 방문한 페이지 주소와 방문 일시, 서비스에 들어온 경로" | `buildPageViewParams` (`page_path`/`page_location`/`page_title`) + gtag 자동 수집 | O |
| "이름·전화번호·이메일·상담 문의 내용을 전송하지 않는다" | `GA_PARAM_ALLOWLIST`에 해당 키 없음 + `EMAIL_LIKE`/`PHONE_LIKE` 값 드롭 | O |
| "입력 내용이 페이지 주소에 포함된 링크로 접속하면 해당 주소가 남을 수 있다" | `/ai-search?q=<검색어>` 직접 진입 시 `page_location`에 포함(§19-9 참조) | O |

**의도적으로 쓰지 않은 문구**: 쿠키 만료 기간(숫자). `gtag('config', …)`에 `cookie_expires`를 설정하지 않아 Google 기본값을 따르며, 코드로 증명할 수 있는 값이 아니다. 그래서 "Google이 정한 정책에 따른다"로만 적었다.

### 남은 법률 검토 권고 사항 — LEGAL_REVIEW_RECOMMENDED

1. **국외 이전(국외 처리) 고지 없음.** 현재 방침에는 국외이전 항목 자체가 **존재하지 않으며**, 이미 수탁업체로 올라와 있는 Supabase·Vercel도 해외 사업자다. 즉 이것은 GA4가 만든 공백이 아니라 **방침 전체의 구조적 공백**이다. Google에만 국외이전 문구를 붙이면 오히려 일관성이 깨지므로 이번 STEP에서는 추가하지 않았다. → 국외이전 항목을 **방침 전체 차원에서** 신설할지 운영자/법률 검토 필요.
2. **Google의 법적 지위를 "수탁자"로 분류했다.** 기존 표의 구조(Supabase/Vercel/카카오/네이버가 모두 수탁업체)를 따른 것이며, 새 분류 체계를 만들지 않기 위한 선택이다. Google Analytics를 수탁으로 볼지 제3자 제공으로 볼지는 법률 판단 영역이다.
3. **11항 고지의 의무와 시행일의 관계.** 11항은 개정 7일 전 공지를 약속하는데, 이번 개정은 같은 날 시행으로 적었다. 이미 동작 중인 처리에 대한 **고지 추가**이고 이용자에게 불리한 변경이 아니라는 근거를 부칙에 명시했으나, 사전 공지 절차를 별도로 밟을지는 운영자 판단이다.
4. **이 문서는 법률 자문이 아니다.** 방침 반영으로 법적 준수가 보장된다고 주장하지 않는다.

### Consent / 쿠키 UX 판정 — **B. CONSENT UX REVIEW RECOMMENDED**

CMP(동의 관리 플랫폼)나 쿠키 배너를 이 STEP에서 **구현하지 않았다**(범위 밖 + 승인 필요).

**B로 판정한 근거:**

- **A(현행 UX로 충분)로 볼 수 없는 이유**: 분석 쿠키가 사전 동의 없이 설정되고 있다. 국내법상 분석 목적 쿠키의 opt-in 필요 여부는 다툼의 여지가 있으나, "방침 고지만으로 충분하다"고 단정할 근거도 없다.
- **C(블로커)로 볼 수 없는 이유**: 서비스는 부산 중심 국내 이용자를 대상으로 하고, **GA4 광고 기능(Google Signals·광고 개인화)을 쓰지 않으며**, 리마케팅·광고 식별자 연동이 없다. Consent Mode v2가 강제되는 EEA/UK 광고 시나리오에 해당하지 않는다. 또한 이용자는 브라우저 설정과 GA 차단 부가기능으로 거부할 수 있고, 그 방법을 방침에 명시했다.
- 따라서 **릴리스 차단 사유는 아니되**, 향후 이용자 지역이 확대되거나 GA4 광고 기능을 켜는 시점에는 재검토가 필요하다.

---

## 17. 테스트 / 검증 결과

실제로 실행한 명령과 결과만 적는다.

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/analytics/ga.test.ts src/lib/analytics/ga-events.test.ts` | **29/29 PASS** |
| `npx tsx --test <src 전체 *.test.ts/.mjs>` | **1104/1105 PASS, 1 FAIL** |
| `npx tsc --noEmit` | `src/` **오류 0건**. 전체 24건은 전부 `scripts/`(20) · `tmp/`(4)의 **기존 오류** → `FAIL_EXISTING_SCRIPT_ERRORS` |
| `npx eslint <변경 파일 11개>` | **clean (exit 0)** |
| `npm run build` | **PASS** (`✓ Compiled successfully`) |

**유일한 실패 1건은 이 STEP과 무관한 기존 실패다.**
`src/lib/transactions-read-state.test.mjs` → "라우트가 월별 판정을 실제로 수행하고 완전성을 응답에 싣는다". 이 테스트는 `src/app/api/transactions/route.ts`의 **소스 문자열을 정규식으로 검사**하는 구현 가드이며, 해당 라우트와 테스트 파일 모두 이 STEP에서 수정하지 않았다(`git status`로 확인).

### 신규 테스트 커버리지 (§24)

- Measurement ID 없음 → no-op / `UA-`·`GTM-`·소문자·오타 ID 거부
- dev/prod/debug 환경 게이트
- page_view 페이로드 모양, `page_title` 없을 때 키 누락
- 라우트 변경 이중 집계 방지(같은 경로 연속 전송 차단)
- 이벤트 allowlist 매핑 / 매핑 없는 이벤트는 전송 안 함 / taxonomy 추가 시 자동 전파 안 됨
- PII 키 거부 + 값 수준 이메일·전화 패턴 거부 + 길이 절단
- UTM 5종 보존 / 내부 파라미터만 제거
- 리포트 이벤트 매핑, PWA 이벤트 매핑, 파트너 이벤트 미연결
- GA4 이벤트명 규칙(소문자 snake_case, 한글·공백·대문자 거부)
- gtag 부재 시 throw 없음

GA 내부를 과도하게 mock하지 않았다. 순수 함수와 계약만 검증한다.

---

## 18. 배포 후 수동 검증 절차 (§20)

**GA4가 동작한다고 아직 주장할 수 없다 — Measurement ID가 설정되지 않았다.** 아래는 ID 설정 후 실제로 확인해야 할 절차다.

### 사전 작업 (운영자)

1. Google Analytics 접속 → 관리 → 속성 만들기 → 웹 데이터 스트림 생성 → `G-`로 시작하는 측정 ID 복사
2. Vercel → 프로젝트 → Settings → Environment Variables
   - `NEXT_PUBLIC_GA_MEASUREMENT_ID` = `G-XXXXXXXXXX` (Production + Preview)
3. **재배포**(`NEXT_PUBLIC_*`는 빌드 시점에 인라인되므로 환경변수만 추가하면 반영되지 않는다)

### Realtime 검증

GA4 → 보고서 → **실시간**

| 확인 | 방법 | 기대 |
|---|---|---|
| `page_view` | 홈 접속 후 `/map` → 단지 상세 이동 | 이동할 때마다 1건씩. **최초 로드가 2건으로 잡히면 실패** |
| `report_view` | `/report/apt/<aptSeq>` 접속 | `report_type=APARTMENT_DETAIL`, `scope_type=APARTMENT` |
| `report_share` | 리포트 공유하기 → 실제 공유/복사 완료 | 1건. **공유창을 취소하면 발생하지 않아야 정상** |
| `report_image_save` | 리포트 이미지 저장 | 다운로드 성공 시 1건 |
| `pwa_install_click` | 모바일에서 설치 배너 → 설치 | `placement=banner`, 이어서 accept/dismiss |
| UTM | `https://<도메인>/?utm_source=kakao&utm_medium=share&utm_campaign=test` 접속 | 실시간 → 사용자 소스에 `kakao` |

### DebugView (권장)

Preview 배포에 `NEXT_PUBLIC_GA_DEBUG=true`를 설정하면 GA4 → 관리 → **DebugView**에서 이벤트와 파라미터를 건별로 볼 수 있다. **Production에는 설정하지 않는다.**

### 1st-party 동시 확인

같은 동작을 한 뒤 관리자 대시보드에서 기존 지표가 그대로 올라오는지 본다. 두 시스템이 **각각 1건씩** 기록되어야 한다.

---

## 19. 알려진 한계

1. **`report_pdf_save`는 "PDF 저장을 시작했다"는 뜻이다.** 브라우저 인쇄 대화상자에서 실제로 저장까지 했는지는 브라우저가 알려주지 않는다. 완료율로 읽으면 안 된다.
2. **`/map` 랜딩의 UTM은 주소창에서 약 400ms 뒤 사라진다.** GA4 집계는 유입 URL 스냅샷으로 보호했지만, 그 시점 이후 사용자가 URL을 복사해 공유하면 UTM이 빠진 링크가 된다. 지도의 URL 동기화 계약을 바꾸는 별도 STEP이 필요하다.
3. **검색 이벤트(`search_submit`)는 GA4로 보내지 않는다.** 자유 텍스트를 배제한 페이로드 계약이 아직 없다.
4. **`compare_count` / `source_surface` / `page_type` / `device_class`는 키만 준비돼 있고 실제로 채우는 호출부가 없다.**
5. **파트너 이벤트는 연결돼 있지 않다** — 기능 자체가 없기 때문이다.
6. **동의 배너(CMP)가 없다.** GA4 PRIVACY POLICY PATCH V1에서 개인정보처리방침 고지는 완료했고, 동의 UX는 **B. CONSENT UX REVIEW RECOMMENDED**로 판정했다(릴리스 차단 아님). §16 참조.
7. 브라우저 확장/광고 차단기가 gtag.js를 막으면 해당 사용자는 GA4에 집계되지 않는다(1st-party는 영향 없음). GA4의 구조적 한계다.
8. 이 저장소의 Next 16.3 빌드 출력은 라우트별 바이트 크기를 찍지 않아 번들 델타를 수치로 제시하지 못했다.
9. **`/ai-search?q=<검색어>`로 직접 진입하면 검색어가 `page_location`에 포함된다.** 이벤트 파라미터 allowlist는
   자유 텍스트를 구조적으로 막지만, **page_view의 URL 자체는 막지 못한다**. 앱 내부 검색은 `router.push`가 같은
   pathname으로 이동해 page_view를 만들지 않으므로 실제 노출 경로는 "검색 결과 링크를 공유받아 외부에서 진입"으로
   한정된다. 방침 7-나에 이 사실을 그대로 고지했다(숨기지 않는다). 완전히 없애려면 `buildPageViewParams`에서
   경로별 쿼리 필터를 추가해야 하며, 이는 GA 코드 변경이라 별도 STEP + 승인이 필요하다.
10. **`/report/apt/<aptSeq>` 등 경로 파라미터는 `page_path`에 그대로 들어간다.** aptSeq·lawdCd는 국토부 공개
    행정코드이므로 개인정보가 아니지만, "GA4에 aptSeq가 전혀 나가지 않는다"는 서술은 **사실이 아니다**.

---

## 20. 다음 STEP 후보

- ~~개인정보처리방침 갱신(§16 초안 반영)~~ → **완료** (GA4 PRIVACY POLICY PATCH V1, 2026-09-11)
- 국외이전 항목 신설 여부 결정 — 방침 전체 차원(Supabase/Vercel/Google 공통), **법률 검토 + 승인 필요**
- PARTNER LEAD TRACKING V1 구현 후 예약된 파트너 이벤트 연결
- `/map` URL 동기화가 UTM을 보존하도록 개선
- `source_surface` 채우기(어느 화면에서 리포트/비교로 들어왔는지)
- GA4 전환(Conversion) 지정: `report_share`, `pwa_install_accept`, `favorite_add`

---

## 21. URL PRIVACY HARDENING V1 (2026-09-11, 기준 `c4008b0`)

### 왜 필요했나 — 이전 STEP이 남긴 유출 경로

이벤트 파라미터 allowlist(`GA_PARAM_ALLOWLIST`)는 자유 텍스트를 구조적으로 막는다. 그런데 **page_view가 싣는 URL 자체는 그 allowlist 밖**이었다.

```
/ai-search?q=<이용자 입력>   →  page_location에 q가 그대로 포함
```

감사 과정에서 **두 번째 경로**가 추가로 발견됐다. URL만 정제하면 닫히지 않는다:

```
src/app/ai-search/page.tsx  generateMetadata()
  title = `"<q>" AI 검색 결과 - 이집`
```

`page_title`은 `document.title`을 그대로 싣는다. 즉 쿼리에서 `q`를 잘라내도 **같은 값이 제목으로 나간다.**

### 안전 쿼리 allowlist (`GA_SAFE_QUERY_PARAMS`)

| 보존 | 이유 |
|---|---|
| `utm_source` `utm_medium` `utm_campaign` `utm_content` `utm_term` | 유입 귀속. 카카오 공유 트래킹이 여기에 달려 있다 |

**그 외 모든 쿼리는 제거된다.** `q`, `lat`/`lng`/`zoom`, `lawdCd`, `dong`, `aptSeq`, `__ejip_qa`, 처음 보는 파라미터 전부 포함. denylist가 아니므로 **새 화면이 새 쿼리를 만들어도 목록을 갱신할 필요가 없다.**

`gclid` / `gbraid` / `wbraid`는 **넣지 않았다** — 이 저장소에 Google Ads 연동이 없다. 집행하게 되면 배열에 한 줄 추가하면 된다.

`hash(#...)`는 통째로 버린다. 귀속에 쓰이지 않으면서 무엇이든 담을 수 있다.

### 적용 지점 (4곳, 전부 `src/lib/analytics/ga.ts`)

| 지점 | 동작 |
|---|---|
| `sanitizeAnalyticsUrl()` | `origin + pathname + allowlist 쿼리`로 **재조립**. 빼는 게 아니라 안전한 것만 옮겨 담는다 |
| `INITIAL_LOCATION_HREF` | 유입 스냅샷을 **붙잡는 시점에** 정제. 메모리에도 원본이 남지 않는다 |
| `buildPageViewParams()` | `page_path`=pathname 전용(§5), `page_location`=정제 URL, `page_title`=반향 검사 통과 시에만 |
| `sanitizeGaParams()` | `page_location`/`page_path` 값을 **한 번 더** 정제 — 호출부가 원본 URL을 직접 넣는 우회 경로(§6)를 막는다 |

### page_title 반향(echo) 검사

경로 denylist를 만들지 않았다. 대신 **"우리가 방금 버린 쿼리 값이 제목에 들어 있으면 제목을 통째로 버린다."** 무엇을 버렸는지는 `droppedQueryValues()`가 정확히 알고 있으므로 화면이 늘어나도 관리할 목록이 없다. `page_title`은 부가 정보라 애매할 때 버리는 쪽이 항상 안전하다.

### 실제 전송 페이로드 (E2E 하니스로 확인)

유입: `https://ejip.kr/ai-search?q=홍길동 01012345678 해운대&utm_source=kakao&utm_medium=share`

```
["event","page_view",{"page_path":"/ai-search",
                      "page_location":"https://ejip.kr/ai-search?utm_source=kakao&utm_medium=share"}]
["event","page_view",{"page_path":"/map",
                      "page_location":"https://ejip.kr/map","page_title":"지도 - 이집"}]
["event","share",{"page_location":"https://ejip.kr/ai-search?utm_source=kakao&utm_medium=share",
                  "method":"kakao"}]
```

- 첫 page_view의 `page_title`이 **없다** — 제목이 검색어를 담고 있어 버려졌다.
- 세 번째는 호출부가 원본 URL과 `q`를 일부러 우겨넣은 것이다. 둘 다 정제/탈락했다.
- `utm_source` / `utm_medium`은 **보존**됐다(§4 귀속 회귀 없음).

### 주소창은 바뀌지 않는다

이 STEP은 **분석 전송값만** 만든다. `ga.ts`에는 `location`/`history` 쓰기가 한 줄도 없다(읽기 2곳뿐). `/ai-search?q=해운대`는 여전히 정상 렌더되고 지도 URL 상태 동기화도 그대로다.

---

## 22. Enhanced Measurement 중복 판정 — **B. CONFIG REVIEW NEEDED**

### 코드로 확정할 수 있는 것

`gtag('config', ID, { send_page_view: false })` — 이건 **config 명령이 보내는 최초 page_view만** 끈다.

### 코드로 확정할 수 없는 것 (그래서 A가 아니다)

Enhanced Measurement의 **"브라우저 기록 이벤트 기반 페이지 변경"** 은 GA4 웹 스트림의 **서버 측 설정**이다. `send_page_view:false`로 꺼지지 않으며, 저장소 코드에서는 상태를 읽을 수도 바꿀 수도 없다.

이 앱에는 history 이벤트가 **두 종류** 있다:

| 발생원 | 빈도 | 우리 수동 page_view | EM이 켜져 있다면 |
|---|---|---|---|
| App Router 라우트 이동(pushState) | 화면 전환마다 | 1건 보냄 | **추가 1건 → 중복** |
| `/map` URL 동기화(replaceState, 400ms 디바운스) | **지도를 움직일 때마다** | 보내지 않음(pathname 불변) | **패닝마다 1건 → /map 과다 집계** |

### 더 중요한 문제: 이 STEP의 정제를 **우회한다**

EM이 만드는 page_view는 Google의 gtag.js가 **`window.location`을 직접 읽어** 보낸다. 우리 `sanitizeAnalyticsUrl`을 거치지 않는다.

→ EM 기록 추적이 켜져 있으면 **`/ai-search?q=<검색어>`의 원본 URL이 그대로 GA4에 전송된다.** 즉 §21의 방어는 코드 쪽에서는 완결됐지만, **완전한 차단은 아래 설정 확인까지 끝나야 성립한다.**

### 운영자가 확인할 정확한 위치

```
GA4 → 관리(Admin) → 데이터 스트림 → 웹 스트림 선택
  → 향상된 측정(Enhanced measurement) → 페이지 조회수 오른쪽 톱니바퀴
  → "브라우저 기록 이벤트를 기반으로 하는 페이지 변경" 체크 해제
```

권장: **해제.** 우리는 SPA page_view를 직접, 정제해서 보내고 있다. 이 설정을 끄면 중복과 우회가 동시에 사라지고, 스크롤/이탈 클릭 등 나머지 향상된 측정 기능은 그대로 유지된다.

**코드에서 GA4 콘솔 설정을 바꾸지 않았다**(§7 지시). 설정 확인 전까지 판정은 B다.

---

## 23. GA4 Realtime / DebugView 수동 검증 절차 (§10)

Preview 배포에 `NEXT_PUBLIC_GA_DEBUG=true`를 두면 DebugView에서 파라미터를 건별로 볼 수 있다(Production에는 두지 않는다).

| # | 시나리오 | 조작 | 기대 결과 |
|---|---|---|---|
| 1 | 일반 page_view | 홈 접속 | `page_view` **1건**. `page_path=/`. 2건이면 §22 설정 문제 |
| 2 | 카카오 UTM 랜딩 | `/?utm_source=kakao&utm_medium=share&utm_campaign=test` 접속 | 실시간 → 사용자 소스에 `kakao`. `page_location`에 utm 3종 유지 |
| 3 | **검색어 차단** | `/ai-search?q=테스트검색어` **직접 접속** | `page_location`이 `/ai-search`로 끝나고 **`q`와 `테스트검색어`가 어디에도 없어야 한다.** `page_title`도 비어 있어야 정상 |
| 4 | 라우트 이동 | 홈 → 지도 → 단지 상세 | 이동마다 `page_view` 1건씩. `page_path`에 `?`가 **없어야** 한다 |
| 5 | **중복 확인** | 지도에서 **패닝만** 반복(화면 전환 없이) | `page_view`가 **늘지 않아야** 정상. 늘어나면 §22가 C로 확정 → 설정 해제 |

3번과 5번이 이 STEP의 핵심 검증이다.
