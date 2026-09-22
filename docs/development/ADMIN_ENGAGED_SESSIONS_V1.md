# E-JIP ADMIN ENGAGED SESSIONS V1

## 목적

"방문 세션"(sessionStorage 탭 세션의 COUNT DISTINCT)은 사람 수가 아니고 크롤러 한 대로도 수백이 된다
(`ANALYTICS_SESSION_ID_INTEGRITY_AUDIT_V1.md`: 2026-09-21 KST 319 중 317이 1페이지·상호작용 0).
이미 쌓이는 데이터만으로 **참여 세션**을 두 관리자 화면에 병기한다. 새 수집 0 · 스키마 0 · UA 0 · bot filter 0 · visitorId 0.

## 정의 (`src/lib/admin-analytics/engagement.ts`)

참여 세션 = 실제 페이지뷰 **1건 이상** AND (페이지뷰 **2건 이상** OR **상호작용 이벤트 1건 이상**).
"페이지뷰 1건 이상"은 참여 ⊆ 방문을 보장한다(이벤트만 있는 세션은 방문 세션에서도 빠지므로) → 참여율 ≤ 100%.

### 이벤트 분류 (코드 기준, 38개 전수 — `Record<AnalyticsEventName, …>`라 새 이벤트는 분류 전까지 타입 오류)

| 분류 | 이벤트 | 근거 |
|---|---|---|
| **AUTO (제외) 8** | `report_view` · `detail_map_view` · `partner_cta_impression` · `finance_fit_start` · `pwa_install_banner_view` · `personal_fit_card_view` · `personal_fit_compare_view` · `feedback_open` | 마운트 effect / 화면 진입 / IntersectionObserver |
| **INTERACTION 30** | favorite_add/remove · share_attempt/success/kakao/native/copy · next_action_click · compare_start/add/remove/detail_click/share · finance_fit_calculate/from_detail/from_compare · pwa_install_click/accept/dismiss/guide_open · report_image_save/pdf_save/share · partner_cta_click · detail_roadview_open · detail_map_return · personal_fit_settings_cta_click/login_cta_click/settings_save · feedback_submit | 클릭·제출·선택 핸들러 |

`finance_fit_start`는 이름과 달리 `/finance-fit` **페이지 로드**에서 발생한다(`finance-fit-client.tsx` useEffect) → AUTO.

**일반 검색은 들어가지 않는다.** `search_logs`에 session_id가 없어 세션에 붙일 수 없다(새 수집 없이는 불가).
세션에 남는 검색 동작은 비교 화면의 검색 결과 선택(`compare_start`/`compare_add`)뿐이다.

## 구현

- `engagement.ts`(순수): 분류표 · `INTERACTION_EVENT_URLS` · `isEngagedSession` · `countEngagedSessionsInRows`(행 단위 참조 구현) · `engagedRate`(분모 0 → null)
- `query.ts` `countEngagedSessions(since)`: 세션별 GROUP BY + HAVING, `split_part(url,'?',1) IN (분류표에서 만든 목록)` — `?action=` 이벤트 포함.
  **대시보드와 행동 분석이 이 함수 하나를 쓴다.** 행동 분석은 기존 `Promise.all` 뒤에서 순차 호출(pool=1 P2024 위험을 늘리지 않음).
- 대시보드 `/api/admin/dashboard`: `todayEngagedSessions`(오늘 KST, 캐시 없음 — 기존 §9 계약) + degraded 라벨 "오늘 참여 세션".
- UI: 대시보드 "오늘 참여 세션" 타일(방문 세션 바로 옆, 참여율 병기) · 행동 분석 "참여 세션" KPI(기간 today/7d/30d 그대로, 참여율 병기).
  두 방문 세션 라벨 보조문구를 "브라우저 탭 세션 기준"으로 명시. `title` 툴팁 + 보이는 한 줄(모바일은 hover가 없다). "방문자" 표현 없음.

## 테스트 결과

- `npx tsx --test src/lib/admin-analytics/engagement.test.ts src/lib/admin-analytics/date-parity.test.ts` → **28 pass / 0 fail**
  (A 1PV·무상호작용 → 아님 · B 2PV → 참여 · C 1PV+compare_start → 참여 · D 1PV+공유 → 참여 · E 1PV+자동 이벤트만 → 아님 ·
  F 여러 이벤트 → 1세션 · 이벤트만 있는 세션 → 아님 · 09-21 분포 재현 → 2 · 분류 전수·자동 8개 고정 · 자동 이벤트 발생 위치 소스 고정 ·
  G 두 화면 같은 함수·SQL이 분류표를 참조·자동 이벤트 이름 SQL 미포함 · H KST 자정 경계)
- `npx tsc --noEmit` → FAIL_EXISTING_SCRIPT_ERRORS(25건 전부 `scripts/`·`tmp/`, `src/` 0)
- 변경 파일 7개 eslint → 0 · `npm run build` → exit 0

### Production 재현 (READ ONLY, 출하 함수 `countEngagedSessions` 그대로 실행 + 행 단위 참조와 교차)

| 창 | 방문 세션 | PV | 참여 세션(SQL) | 참여(참조) | 참여율 |
|---|---|---|---|---|---|
| 2026-09-21 KST | 319 | 321 | **2** | 2 | 0.6% |
| 2026-09-22 KST(12:2x 기준) | 1 | 1 | **0** | 0 | 0% |

09-21 값은 `countEngagedSessions(09-21 00:00 KST) − countEngagedSessions(09-22 00:00 KST)`로 구했다(두 날에 걸친 세션 0 확인).

## 알려진 한계

- 일반 검색은 세션에 연결할 수 없어 참여 판정에 없다.
- 행동 분석의 퍼널 3단계 `decision_sessions`는 여전히 `finance_fit_start`(자동)를 포함한다 — 이번 범위 밖, 손대지 않았다.
- 참여 세션도 탭 세션 단위다. 2페이지 이상 여는 크롤러는 참여로 셀 수 있다 — UA 없이 막을 수 없다.
- `getBehaviorSummary`의 `Promise.all` 구조는 그대로다(pool=1 위험 — 별도 STEP).
