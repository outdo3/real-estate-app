# E-JIP ADMIN ANALYTICS DATE PARITY FIX V1

관리자 대시보드와 사용자 행동 분석이 같은 "오늘"을 보도록 날짜 계약을 통일한다.

- 감사·구현: 2026-09-21 · 기준 커밋 `a0f8171`
- **DB INSERT/UPDATE/DELETE 0 · schema 0 · migration 0 · env 0 · MOLIT 0 calls**

## 판정

**PASS** — 두 화면이 같은 KST 달력일 창과 같은 세션/PV 정의를 쓴다.
운영 원천에서 두 코드 경로를 각각 돌려 재측: **delta sessions = 0, delta pageViews = 0.**

---

## 1~6. 두 화면의 지표 정의

| 항목 | 관리자 대시보드 | 사용자 행동 분석 (수정 전) |
|---|---|---|
| UI | `src/app/admin/dashboard/page.tsx` | `src/app/admin/behavior/page.tsx` |
| API | `/api/admin/dashboard` | `/api/admin/behavior` |
| query | 라우트 안에 직접 | `src/lib/admin-analytics/query.ts` |
| 원천 | `page_views` | `page_views` |
| **방문 세션** | `COUNT(DISTINCT session_id)` **WHERE url NOT LIKE `/__event__/%`** | `COUNT(DISTINCT session_id)` — **이벤트 행 포함** |
| **PV** | `COUNT(*)` WHERE url NOT LIKE `/__event__/%` | `COUNT(*) FILTER (WHERE url NOT LIKE '/__event__/%')` |
| **today 경계** | `startOfKstDay()` (KST 00:00) | `new Date(); d.setHours(0,0,0,0)` → **런타임 TZ** |
| 7일 / 30일 | `Date.now() - N×24h` (rolling) | `Date.now() - N×24h` (rolling) |
| 캐시 | 없음(파이프라인 헬스만 5분) | 전 range 5분 TTL |

두 화면 모두 **같은 테이블**을 쓴다(§2 SOURCE PARITY: 동일). 갈라진 것은 **창**과 **세션 정의**다.

## 4. 수정 전 원천 실측 (READ ONLY)

`scripts/audit-admin-analytics-date-parity.ts`, 2026-09-21 16:28 KST:

| window | sessions(전체 행) | sessions(이벤트 제외) | PV(이벤트 제외) | rows(전체) |
|---|---|---|---|---|
| **KST 00:00~now** | 317 | 317 | **318** | 694 |
| **UTC 00:00~now** | 166 | 166 | **167** | 329 |

각 화면이 그 시점에 실제로 내놓던 값:

| 화면 | 방문 세션 | PV |
|---|---|---|
| 대시보드 (KST) | **317** | **318** |
| 행동 분석 (UTC) | **166** | **167** |
| **delta** | **151** | **151** |

사용자가 본 **301/302 vs 149/150**은 같은 두 창을 조금 이른 시각에 본 값이다
(두 쌍 모두 `PV = sessions + 1`이라는 같은 형태까지 일치한다). **증명 완료.**

> UTC 행이 Vercel 런타임 재현이다. 내 개발 머신은 TZ=Asia/Seoul이라
> `setHours(0,0,0,0)`가 로컬에서는 KST를 내놓는다 — 이 버그가 로컬 QA를 통과했던
> 이유가 정확히 그것이므로, 감사 스크립트는 UTC 자정을 **명시적으로** 계산해서 잰다.

## 5. 원인 판정

| 후보 | 판정 | 근거 |
|---|---|---|
| **A. UTC/KST date boundary mismatch** | **CONFIRMED** | 317/318 vs 166/167이 정확히 두 창의 차이. delta 151이 09:00 KST 이전 트래픽과 일치 |
| B. 서로 다른 event filter | **CONFIRMED (영향 0)** | 세션 정의가 실제로 갈라져 있었다(행동 분석은 이벤트 행까지 셈). 다만 오늘 실측 차이는 **0** — 이벤트만 남기고 페이지뷰가 없는 세션이 없었다. 우연히 0이었을 뿐이라 정의를 맞춘다 |
| C. 서로 다른 session definition | **CONFIRMED (= B)** | 위와 동일한 한 줄 |
| D. cache | **LIKELY (부차)** | 행동 분석만 5분 TTL. 계약을 맞춰도 최대 5분치 트래픽만큼 어긋날 수 있었다 |
| E. stale response | **RULED_OUT** | SWR `revalidateOnFocus:false`지만 range 변경마다 재요청. 고정된 오래된 응답 아님 |
| F. inclusive/exclusive 경계 | **RULED_OUT** | 양쪽 다 `created_at >= since`, 상한 없음 |
| G. API field mapping bug | **RULED_OUT** | `kpi.sessions`/`kpi.pageViews`가 SQL 별칭과 1:1 |

## 6. 수정 — today 계약

`src/lib/admin-analytics/query.ts`:

```ts
export function rangeStart(range: AnalyticsRange, now: Date = new Date()): Date {
  if (range === 'today') return startOfKstDay(now);
  const days = range === '7d' ? 7 : 30;
  return startOfKstDaysAgo(days - 1, now);
}
```

**KST 계산 사본을 만들지 않았다** — 대시보드와 같은 `src/lib/kst-day.ts`를 쓴다.
런타임 TZ에도 브라우저 TZ에도 의존하지 않는다(오프셋 산술만; 한국은 서머타임 없음).

세션 정의도 대시보드와 같은 식으로 맞췄다:

```sql
COUNT(DISTINCT session_id) FILTER (WHERE url NOT LIKE '/__event__/%') as sessions
```

이제 KPI "방문 세션"이 퍼널 1단계 `entry_sessions`와도 **자동으로 같은 값**이 된다
(예전에는 이 둘조차 한 화면 안에서 서로 달라질 수 있었다).

## 7~8. 7일 / 30일 계약

**오늘을 포함한 최근 N개 KST 달력일**로 통일했다. 새 helper 하나만 추가:

```ts
export function startOfKstDaysAgo(daysAgo: number, now = new Date()): Date
```

- `7d` = `startOfKstDaysAgo(6)` → 오늘 포함 7일
- `30d` = `startOfKstDaysAgo(29)` → 오늘 포함 30일

왜 rolling이 아닌가: 화면 라벨이 "7일"/"30일"이다. rolling은 조회 시각에 따라 가장 오래된
날의 앞부분이 잘려, **오전에 본 "7일"과 저녁에 본 "7일"이 서로 다른 집합**을 가리킨다.

대시보드의 "최근 7일"(인기 검색어·이벤트 집계)과 "최근 30일"(인기 단지)도 같은 계약으로
바꿨다(§8 — 화면마다 기간 의미가 모순되지 않게).

실측 차이:

| 계약 | 7일 | 30일 |
|---|---|---|
| rolling(기존) | sessions 367 / PV 513 | sessions 821 / PV 2,836 |
| **calendar(신규)** | sessions 362 / PV 452 | sessions 817 / PV 2,783 |

**리포트(`resolveVolumePeriod`)는 건드리지 않았다.** 이미 "KST 계약일, 오늘 포함"이고,
종료일을 어제로 두는 것은 MOLIT 수집 cron(04:00 KST) 때문이다 — 거래일 계약이지
방문 분석 계약이 아니다. 의도적으로 다르며 모순이 아니다.

## 9. 동일 시각 parity — 실측

같은 창(KST 00:00)에서 **두 코드 경로를 각각 독립적으로** 돌려 비교했다
(같은 숫자를 두 번 출력하는 것은 증명이 아니므로):

| 경로 | 방문 세션 | PV |
|---|---|---|
| 대시보드 (`prisma.pageView.count` + raw `COUNT(DISTINCT)`) | **317** | **318** |
| 행동 분석 (combined `FILTER` SQL) | **317** | **318** |
| **delta** | **0** | **0** |

## 10. 캐시

`today`는 **캐시하지 않는다.** 대시보드의 트래픽 지표는 원래 캐시 없이 매번 집계하는데
행동 분석만 5분 TTL을 두면, 계약을 똑같이 맞춰도 두 화면을 나란히 놓고 볼 때 최대 5분치
트래픽만큼 숫자가 달라 다시 "왜 다르냐"가 된다.

`7d`/`30d`는 더 무거운 집계이고 분 단위로 의미가 바뀌지 않으므로 **기존 5분 캐시 관례를
그대로 유지**했다. 초단위 polling은 추가하지 않았다(§10 지시).

응답에 `rangeStartsAt`을 추가해 어느 창을 재고 있는지 화면 밖에서도 검증할 수 있게 했다
(대시보드의 `todayStartsAt`과 같은 관례).

## 11. 기간 라벨

행동 분석 화면에 대시보드와 같은 수준의 안내를 넣었다:

```
오늘 = 한국시간 00:00 기준 · 관리자 대시보드와 같은 기준입니다.
최근 7일 = 오늘 포함 한국시간 7일치 · 관리자 대시보드와 같은 기준입니다.
```

UI 구조는 그대로, 캡션 한 줄만 늘렸다.

## 12. 다른 지표도 같은 창을 쓰는가

`getBehaviorSummary`는 `rangeStart()`가 만든 `since` **하나**를 모든 쿼리에 넘긴다.
따라서 아래가 전부 같은 창으로 함께 이동했다 — 방문/PV만 KST가 되고 나머지가 UTC로
남는 일은 구조적으로 불가능하다:

단지 상세조회 · 비교 시작 · 관심단지 추가 · 자금 계산 실행 · 공유 시도/성공 ·
검색(SearchLog) · 지도/통계 조회 · 사용자 여정 퍼널 3단계 · 인기 단지 · 인기 지역 ·
다음 행동 분해.

## 13. 테스트 — 신규 17건

`src/lib/admin-analytics/date-parity.test.ts` (13) + `src/lib/kst-day.test.ts` (4 추가)

| 구분 | 내용 |
|---|---|
| A | today가 KST 00:00 — 대시보드 `startOfKstDay`와 **같은 순간** |
| B | KST 08:59 — UTC로는 전날이어도 같은 KST day |
| C | KST 09:00 — UTC 날짜 변경이 "오늘"을 리셋하지 않음 |
| D | 7일 = 오늘 포함 7개 KST 달력일 (구간 길이까지 검증) |
| E | 30일 = 오늘 포함 30개 KST 달력일 |
| D/E | 달력일 경계는 조회 시각(09:30 vs 22:00)에 따라 움직이지 않음 — rolling이면 어긋남 |
| F | 같은 fixture에서 **방문 세션 일치** (이벤트만 남긴 세션은 양쪽 다 제외) |
| G | 같은 fixture에서 **PV 일치** |
| 배선 | 두 화면이 같은 KST helper 사용 · `setHours(0,0,0,0)` 재등장 금지 · 세션 식이 이벤트 제외 · 대시보드 7/30일이 달력일 · today 무캐시 · `rangeStartsAt` 존재 |
| helper | `startOfKstDaysAgo` 0/N/음수/소수/월·년 경계 |

**src 전체 1,920 pass / 0 fail** · `npx tsc --noEmit` src 오류 **0** ·
변경 파일 eslint **exit 0** · `npm run build` **성공**.

## 15. No-write assertion

| 항목 | 값 |
|---|---|
| DB INSERT / UPDATE / DELETE | **0 / 0 / 0** (감사 스크립트는 SELECT만, `DIAGNOSTIC` 가드 경유) |
| schema · migration · env | **0 · 0 · 0** |
| 서울/부산 데이터 변경 | **0** |
| MOLIT 호출 | **0** |

## 16. 회귀 확인

| 계약 | 상태 |
|---|---|
| `ADMIN_DASHBOARD_TRUST_FIX_V1` — KST today | 유지(같은 helper, 그대로 호출) |
| 〃 "오늘 방문 세션" 라벨 / "오늘 = 한국시간 00:00 기준" | 유지 |
| 〃 `todayStartsAt` / `fetchedAt` | 유지(테스트로 고정) |
| 〃 ops partial failure isolation | 미변경 |
| `ADMIN_ERROR_LOGGING_P1` — admin failure logging | 미변경(`logAdminFailure` 호출 그대로) |

## 알려진 영향 (의도됨)

대시보드의 "최근 7일 인기 검색어"와 "최근 30일 인기 단지"가 달력일 경계로 바뀌면서
**집계 대상이 소폭 줄어든다**(7일 PV 513→452, 30일 PV 2,836→2,783). 순위가 바뀔 수
있으나 "최근 7일/30일"이라는 라벨과는 오히려 더 정확히 맞는다.

## 남은 분석 격차

1. **봇/내부 트래픽 필터가 두 화면 모두에 없다.** `historicalDataNote`가 정직하게
   밝히고 있지만, 숫자 자체는 여전히 QA·크롤러를 포함할 수 있다.
2. **세션 = 브라우저 sessionId**다. "순 방문자"가 아니며, 두 화면 모두 그렇게 표기하지
   않는다. 기기·브라우저가 바뀌면 다른 세션이다.
3. **시간대별(hourly) 분해가 없다.** 이번 STEP에서 추가하지 않았다(§20 금지).
4. `rangeStartsAt`은 응답에만 있고 화면에는 노출하지 않았다 — 필요하면 작게 붙일 수 있다.
