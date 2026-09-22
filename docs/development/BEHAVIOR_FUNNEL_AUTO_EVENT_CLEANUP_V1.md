# E-JIP BEHAVIOR FUNNEL AUTO-EVENT CLEANUP V1

쿼리만 변경. schema 0 · 새 수집 0 · UA 0 · visitorId 0 · bot filter 0 · Production write 0.

## 목적

사용자 행동 분석 퍼널 3단계 "비교 / 관심 / 자금계산"이 `finance_fit_start`를 세고 있었다.
이 이벤트는 `/finance-fit` **페이지 로드** 시 자동 발생한다(`finance-fit-client.tsx` useEffect, ADMIN_ENGAGED_SESSIONS_V1 분류 AUTO).

## 분석

`src/lib/admin-analytics/query.ts` `fetchCombinedCounts`의 `decision_sessions`:

| | 이벤트 |
|---|---|
| 이전 | `compare_start` · `favorite_add` · **`finance_fit_start`** (prefix LIKE) |
| 이후 | `compare_start` · `favorite_add` · **`finance_fit_calculate`** (`split_part(url,'?',1) IN`, `engagement.ts` `DECISION_ACTION_EVENT_NAMES`) |

단계의 "자금계산"을 대표하던 이벤트가 자동 이벤트 하나뿐이었으므로, 빼기만 하면 라벨의 자금계산이 아무것도 측정하지 않게 된다.
그래서 실제 계산 버튼 이벤트 `finance_fit_calculate`로 **교체**했다(요청서 테스트 B가 이 의미를 요구한다).
이전에 이 단계에 없던 `compare_add` · `favorite_remove` · `finance_fit_from_detail/compare`는 **추가하지 않았다** — 퍼널 정의 확장은 이번 범위가 아니다.

## 다른 단계 감사 (보고만)

- 1단계 방문 = 실제 페이지뷰의 distinct session, 2단계 단지 상세 = `/apt/*` 페이지뷰 — 이벤트를 쓰지 않는다. 자동 이벤트 오염 **없음**.
- KPI·기능 사용표의 자금 계산은 이미 `finance_fit_calculate`다. `finance_fit_starts` 컬럼은 SQL에서 계산만 되고 **어디서도 읽지 않는다**(죽은 값, 오염 아님, 손대지 않음).
- 자동 이벤트 8개(report_view · detail_map_view · partner_cta_impression · finance_fit_start · pwa_install_banner_view · personal_fit_card_view · personal_fit_compare_view · feedback_open)는
  이제 행동 분석의 어떤 "실제 행동" 지표에도 쓰이지 않는다.

## Production 측정 (READ ONLY, 출하 `getBehaviorSummary` 그대로)

| 범위 | 방문 | 참여 | PV | 3단계 이전 | 3단계 이후 |
|---|---|---|---|---|---|
| 오늘(09-22) | 1 | 0 | 1 | 0 | **0** |
| 7일 | 352 | 6 | 381 | **12** | **0** |
| 30일 | 818 | 203 | 2,772 | 16 | **4** |

7일의 12는 **전부** `finance_fit_start` 세션(09-21 크롤러가 /finance-fit을 12번 연 것)이었다. 7일간 실제 비교·관심·계산 세션은 0.
30일 4 = favorite_add 3 + finance_fit_calculate 1. 방문·참여·PV·1~2단계는 변하지 않았다. 참여 세션 계약도 그대로(09-21 참여 2 재확인).

## 테스트

`npx tsx --test src/lib/admin-analytics/engagement.test.ts src/lib/admin-analytics/date-parity.test.ts` → **35 pass / 0 fail**
(A start만 → 0 · B calculate → 1 · C compare_start → 1 · D favorite_add → 1 · E 한 세션 여러 결정 이벤트 → 1 ·
결정 이벤트 전부 INTERACTION · 결정 단계 SQL이 공통 목록을 쓰고 자동 이벤트 이름을 적지 않음). `npx tsc --noEmit` src/ 0(기존 scripts/tmp 25) · eslint 0 · build exit 0.
