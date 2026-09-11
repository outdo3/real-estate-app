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

### 판정: **PRIVACY POLICY UPDATE NEEDED**

GA4는 `_ga`, `_ga_<container>` 형태의 **1st-party 쿠키를 설정한다.**

현재 `src/app/privacy/page.tsx` 상태:

- **7. 쿠키의 운영 및 광고 서비스** — 쿠키 사용 사실과 구글 제3자 **광고** 쿠키는 이미 고지하고 있다. 그러나 **분석(Analytics) 목적**은 언급이 없다.
- **5. 개인정보 처리의 위탁** — 수탁업체 표에 Supabase / Vercel / 카카오·네이버만 있고 **Google(Analytics)이 없다.**
- **1-나. 자동 수집 정보** — 쿠키·이용기록은 이미 포함돼 있다.

즉 **갱신이 필요한 곳은 사실상 2군데**다: 위탁 표에 Google LLC(웹 분석) 추가, 7항에 분석 쿠키 문구 추가.

### 이 STEP에서 개인정보처리방침을 수정하지 않은 이유

`AGENTS.md`는 **법률/정책 리스크가 있는 변경에 사전 승인을 요구한다.** 개인정보처리방침은 그 정의에 정확히 해당하므로, 문안을 임의로 고치지 않고 초안만 제시한다.

**위탁 표에 추가할 행 (초안):**

| 수탁업체 | 위탁 업무 내용 |
|---|---|
| Google LLC | 웹사이트 이용 분석(Google Analytics) |

**7항에 추가할 문단 (초안):**

> 서비스는 이용 현황 분석을 위해 Google Analytics를 이용하며, 이 과정에서 방문 경로·페이지 조회 등 이용 기록이 쿠키를 통해 수집됩니다. 이용자는 Google이 제공하는 [Google Analytics 차단 브라우저 부가기능](https://tools.google.com/dlpage/gaoptout)을 설치하거나 브라우저 쿠키 설정을 통해 수집을 거부할 수 있습니다.

### Consent Mode / CMP

- 이 STEP에서 **CMP(동의 관리 플랫폼)를 구현하지 않았다.** 승인 없이 도입할 범위가 아니다(§16 명시).
- Consent Mode v2도 설정하지 않았다. 주로 EEA/UK 대상 광고 기능과 엮인 요구사항이며, 현재 서비스는 부산 중심의 한국 사용자 대상이고 GA4 광고 기능을 쓰지 않는다.
- **법률 자문이 아니다.** 실제 준수 여부 판단은 운영자의 몫이며, 위 초안도 검토 후 반영해야 한다.

### 런칭에 대한 영향

**코드 배포 자체는 차단 요인이 아니다.** Measurement ID를 설정하기 전까지 GA4는 완전히 비활성이고 쿠키도 설정되지 않는다.
→ **개인정보처리방침 갱신은 Measurement ID를 켜기 전에 끝내는 것을 권장한다.**

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
6. **동의 배너(CMP)가 없다.** §16 참조.
7. 브라우저 확장/광고 차단기가 gtag.js를 막으면 해당 사용자는 GA4에 집계되지 않는다(1st-party는 영향 없음). GA4의 구조적 한계다.
8. 이 저장소의 Next 16.3 빌드 출력은 라우트별 바이트 크기를 찍지 않아 번들 델타를 수치로 제시하지 못했다.

---

## 20. 다음 STEP 후보

- 개인정보처리방침 갱신(§16 초안 반영) — **승인 필요**
- PARTNER LEAD TRACKING V1 구현 후 예약된 파트너 이벤트 연결
- `/map` URL 동기화가 UTM을 보존하도록 개선
- `source_surface` 채우기(어느 화면에서 리포트/비교로 들어왔는지)
- GA4 전환(Conversion) 지정: `report_share`, `pwa_install_accept`, `favorite_add`
