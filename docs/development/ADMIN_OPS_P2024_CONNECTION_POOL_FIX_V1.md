# E-JIP ADMIN OPS P2024 CONNECTION POOL FIX V1

`/api/admin/ops`가 P2024(connection pool timeout)로 500을 내던 문제를 구조로 해결한다.

- 감사·구현: 2026-09-21 · 기준 커밋 `4d6b15e` → `69d2c41`, `2728016`
- **schema 0 · migration 0 · index 0 · env 0 · business data write 0 · MOLIT 0 calls**

## 판정

**PASS** — 운영에서 12/12 요청 HTTP 200, P2024 재발 0, 거짓 0 표시 0,
P50 **57ms** / P95 **88ms**, 운영 현황 화면 정상 렌더.

---

## 1. Root cause — 직관적인 해석은 틀렸다

Production 오류:

```
[ADMIN_OPS_FAILURE][PrismaClientKnownRequestError:P2024]
prisma.apartmentTradeHistory.count()
Timed out fetching a new connection from the connection pool
(pool timeout: 10, connection limit: 1)
```

"저 count가 느려서 10초를 넘겼다"로 읽기 쉽지만 **아니었다.** 운영 DB를 상대로
같은 pool 조건에서 재현했다(`scripts/audit-admin-ops-pool.ts`, READ ONLY):

| 실행 방식 | latency | 거부 |
|---|---|---|
| `Promise.all` 9개 | 6,004ms | **7/9 rejected (전부 P2024)** |
| **순차 await** 9개 | 6,164ms | **0/9** |

같은 쿼리, 같은 DB 작업량, 총 시간도 거의 같다. 다른 것은 **"언제 connection을
요청하는가"** 하나뿐이다.

`connection_limit=1`에서 `Promise.all`은 9개가 **t=0에 동시에** connection을 요청한다.
그래서 `pool_timeout` 타이머 9개가 함께 돌기 시작하고, 줄 뒤쪽 쿼리는 앞의 8개가
끝나기를 기다리다 **자기 실행 시간이 30ms여도** 대기 중에 타이머에 걸려 죽는다.

즉 오류에 찍힌 `count()`는 **느린 쿼리가 아니라 줄 뒤에 서 있던 쿼리**였다.
순차 실행은 자기 차례가 왔을 때 비로소 connection을 요청하므로 대기와 타이머가 겹치지 않는다.

> 부수 확인: 순차 실행에서는 **총 13초가 걸려도 P2024가 나지 않는다**(실측).
> pool_timeout은 "쿼리 실행 시간"이 아니라 "connection을 못 얻고 기다린 시간"이다.

## 2. Query graph (감사 결과)

`apartment_trade_histories` **866,366행** / `apartment_rent_histories` 126,022행.

| # | 쿼리 | 단독 latency(cold→warm) |
|---|---|---|
| 1 | `trade.count(lawdCd in 부산16)` | 1,229 → 172ms |
| 2 | **`trade.count(… dealCanceled=true)`** | **3,812 → 1,355ms (최대 6,450ms)** |
| 3 | `trade.count(aptSeq null)` | 88 → 21ms |
| 4 | `trade.aggregate(max dealDate)` | 355 → 268ms |
| 5 | `trade.groupBy(lawdCd)` | 463 → 362ms |
| 6 | `trade.count(세종)` | 34 → 25ms |
| 7~9 | rent count / groupBy / aggregate | 156/46/54 → 31/39/31ms |
| C1~C4 | `sync_coverage_cells` 4개 | 60~126ms |

**진짜 무거운 것은 #2 하나뿐**이다. `deal_canceled`를 덮는 인덱스가 없어
(`@@index([lawdCd, dealDate])` 등만 존재) heap fetch가 필요하다.

## 3. 시도했다가 **측정으로 기각**한 방법

§3의 "D. scoped/lightweight query"를 먼저 시도했다 — 무거운 쿼리를 한 번의 스캔으로 합치기.
**더 느렸다.**

| 방법 | latency |
|---|---|
| 단일 `COUNT(*) FILTER + COUNT(DISTINCT) + MAX` 집계 | **15,335ms** |
| raw `GROUP BY lawd_cd, deal_canceled` | 3,459ms (median of 3) |
| Prisma `groupBy(['lawdCd','dealCanceled'], _count)` | 5,841ms |
| **위가 대체하려던 기존 3개 쿼리 합계** | **1,889ms** |

개별 쿼리는 이미 `(lawd_cd, deal_date)` 인덱스를 타고 있고, 합치면 865k행 heap 스캔이 된다.
**그래서 쿼리와 스키마는 손대지 않고 실행 방식만 바꿨다.** 인덱스도 추가하지 않았다(§13).

> 이 기각을 기록으로 남긴다. 측정하지 않았다면 "합치면 빠르다"는 직관으로 상황을
> 6배 악화시켰을 것이다.

## 4~6. 무엇을 바꿨나

### (1) 순차 실행 — bounded concurrency = 1 (§6)

두 블록(DB 지표 9개, coverage 4개)을 전부 하나씩 `await`한다.
성능 희생이 아니라 **오히려 빠르다**(limit=1 실측: 병렬 2,331ms vs 순차 1,801ms).

`Promise.all`이 prisma 쿼리를 다시 감싸면 **테스트가 실패**한다.

### (2) 지표별 격리 — 한 조각 실패가 전체 500이 되지 않는다 (§5)

`src/lib/admin-ops-runner.ts`(순수 모듈, 테스트 대상):

```ts
const m = <T,>(key, run) => isolate(key, run, noteDbFailure);
const busanTotalM = await m('busanTotal', () => prisma...);
```

- 실패한 지표 → `{ status: 'UNKNOWN', value: null }`
- **전부 실패했을 때만** 전체 장애로 올린다(`isTotalDbOutage`) — 단일 쿼리 타임아웃과
  DB 연결 자체 실패를 구분한다.

### (3) 무거운 지표는 맨 뒤 + 전용 캐시 + 예산 (§3-E/§4)

```ts
const busanCanceledM = await m('busanCanceled',
  withBudget(() => getOrSetCache('admin-ops:busan-canceled', 30분, () => prisma...), 4초));
```

- **맨 뒤**라 앞의 8개 지표가 이것을 기다리지 않는다.
- **30분 전용 캐시** — 하루 한 번 sync로만 변하는 값이다.
- **4초 예산** — 넘기면 그 칸만 "확인 불가". 중요한 성질: race로 응답을 먼저 보내도
  **원래 쿼리는 계속 돌아 캐시를 채우므로 다음 요청은 진짜 숫자를 본다.**
  값을 지어내지 않고 "아직 모른다"고만 말한다.

### (4) 캐시 — 기존 헬퍼 재사용, thundering herd는 이미 막혀 있었다 (§4)

`getOrSetCache`에는 이미 key별 **in-flight dedupe**가 있다(같은 cold key로 동시에 들어온
요청이 fetcher를 한 번만 실행). 새 인프라를 만들지 않았다.

한 가지만 추가했다 — 값에 따라 TTL을 달리 주는 `ttlFor`:

| 요약 상태 | TTL |
|---|---|
| 완전 | 5분(기존 그대로) |
| **부분 실패** | **30초** |

**이건 내가 만든 결함을 운영 QA에서 잡아 고친 것이다.** 첫 배포 후 측정에서 콜드
인스턴스 하나가 예산을 넘겼고, 그 부분 실패 요약이 **5분 내내 캐시되어** 이후 8회 연속
"취소 거래 수 확인 불가"가 떴다(`degradedCounts: [0,0,0,0,1,1,1,1,1,1,1,1]`).
아예 캐시하지 않으면 장애가 길 때 매 요청이 재조회를 일으키므로, 짧게 잡는 것이 답이다.

### (5) Last-known-good (§3-C)

재조회가 실패해도 **직전에 실제로 확인했던 요약**을 200으로 내려주고, 언제 것인지
배너에 밝힌다(`stale: { isStale, capturedAt }`). 빈 오류 화면보다 낫고, 지어낸 값도 아니다.

## 7. 근사치 정책

근사치를 **쓰지 않았다.** 모든 숫자는 실제 쿼리 결과이고, 못 읽으면 숫자 대신
"확인 불가"다. `약 86.6만건` 같은 반올림 표기도 도입하지 않았다.

## 8. Response contract

스키마·API 계약을 크게 바꾸지 않았다. 최소 변경:

- 실패 가능한 숫자 필드가 `number | null`이 됐다(화면은 이미 `null → 확인 불가` 관례를 씀).
- `overall.degradedSources`에 **못 읽은 지표 이름**이 그대로 들어간다(기존 배너 재사용).
- 실패 시 `stale` 필드가 붙는다.

상태 표현: 정상 = 값 존재 · DEGRADED = `degradedSources` 비어있지 않음 ·
UNKNOWN = 해당 필드 `null` · ERROR = 전체 실패(연결 자체 실패일 때만).

## 9. 거짓 0 금지 (§12)

`busanActive = busanTotal − busanCanceled`가 특히 위험했다. 취소 조회가 실패해 0이 되면
**"유효 = 전체"**가 되어 장애가 정상보다 더 좋은 숫자로 보인다.

```ts
export function difference(total, part): number | null {
  if (total.status !== 'OK' || part.status !== 'OK') return null;   // 0이 아니라 null
  return total.value - part.value;
}
```

화면도 `num(v)` 한 곳을 거쳐 `null → '확인 불가'`로 그리고, 못 읽은 값으로 **"정상" 배지를
찍지 않는다**(`aptSeqMissing === null ? '확인 불가' : …`).

## 10. Error logging (§9)

`ADMIN_ERROR_LOGGING_P1` 계약 유지 + category 하나 추가:

| category | 의미 |
|---|---|
| `ADMIN_OPS_FAILURE` | 라우트 전체 실패 |
| `ADMIN_OPS_REGION_MODEL_FAILURE` | 외부 프록시 조각 실패(기존) |
| **`ADMIN_OPS_DB_SUMMARY_FAILURE`** | **DB 지표 한 조각 실패(신규, `metric=<key>` 포함)** |

중복 억제(5분)는 유지하되 dedupe 키에 `metricKey`를 넣어 **한 지표의 장애가 다른 지표의
기록을 가리지 않게** 했다. 로그에 남는 것은 에러 종류(`PrismaClientKnownRequestError:P2024`,
`BudgetExceeded`)와 metric 이름뿐 — 연결 문자열·쿼리 내용·개인정보는 남기지 않는다(테스트로 고정).

## 11. Failure injection (§11) — 전부 mock, Production 무손상

`src/lib/admin-ops-runner.test.ts` **17건**:

| 시나리오 | 결과 |
|---|---|
| A. trade count가 P2024 | 나머지 지표 OK, 전체 장애 아님, 값은 **null(0 아님)** |
| A. 파생값 | 취소 UNKNOWN → `busanActive` **null** |
| B. region model 타임아웃 | 기존 부분 실패 유지(category 보존을 테스트로 고정) |
| C. DB 전체 불가 | 전부 UNKNOWN일 때만 전체 장애 |
| D. 캐시 히트 | 예산 초과 후에도 백그라운드가 캐시를 채워 **다음 호출은 즉시 진짜 값** |
| E. 동시 요청 | `getOrSetCache` in-flight dedupe 존재를 계약으로 고정 |
| 배선 | `Promise.all(prisma…)` 재등장 금지 · 무거운 지표가 맨 뒤 · 전용 TTL/예산 · 거짓 0 금지 |

## 12~13. 성능 (§10)

**운영 배포 후 관리자 세션으로 12회 연속 호출:**

| 항목 | 값 |
|---|---|
| HTTP status | **200 × 12/12** |
| 실패 | **0** |
| P2024 | **0** |
| **P50** | **57ms** |
| **P95** | **88ms** |
| max | 88ms |
| degradedSources | 12회 전부 **0건** |

warm 목표(≤1.5s)를 크게 통과한다(5분 요약 캐시 히트).

**cold(새 Lambda 인스턴스 + cold Postgres buffer):** 첫 요청 4,167ms ~ 15,418ms 관측.
**200을 반환했고 P2024도 나지 않았다** — 순차 실행에서는 총 시간이 pool_timeout을 넘겨도
타임아웃이 아니기 때문이다. 다만 **§10의 cold ≤3s 목표는 충족하지 못한다**(아래 §남은 위험).

**DB 블록만 따로, limit=1에서 10회:**

| | 수정 전 | 수정 후 |
|---|---|---|
| P50 | 2,396ms | **799ms** |
| UNKNOWN | — | 1/90 (콜드 1회, 예산) |
| 전체 장애 | — | **0/10** |

## 14. Production QA (§14)

배포 후 관리자 세션으로 직접 확인:

- `/api/admin/ops` 12/12 **200**, degraded 0
- **`/admin/ops` 화면 정상 렌더** — 전체 상태 **정상**, 경고 0건,
  실거래 DB(부산) 정상 · 지역 coverage 정상 · 24개월 취소검증 **SAFE** · 최근 QA sync 정상,
  전체 row **865,291** / 유효(active) **848,977** / 취소 **16,314** / 최근 거래일 2026-09-18 /
  aptSeq 없는 row **0**

이 화면은 이번 STEP 시작 시점에 **"운영 데이터를 불러오지 못했습니다" 한 줄**이었다.

**부분 실패 → 자가 회복도 운영에서 실측했다.** 콜드 인스턴스에서 `취소 거래 수`가
확인 불가로 떨어졌고(`busanCanceled: null`, `busanActive: null` — 거짓 0 없음),
30초 뒤 재조회에서 `16,314` / `848,977`로 **스스로 복구**됐다(90ms).

**`error_logs` 실측:**

| 시각(UTC) | 기록 |
|---|---|
| 06:26:43 | `[ADMIN_OPS_FAILURE][P2024] apartmentTradeHistory.count()` |
| 07:43:54 | `[ADMIN_OPS_FAILURE][P2024] apartmentTradeHistory.count()` ← **수정 배포 전 마지막** |
| 08:09~08:14 | `[ADMIN_OPS_DB_SUMMARY_FAILURE][BudgetExceeded] (metric=busanCanceled)` × 4 |

배포 이후 **전체 실패(`ADMIN_OPS_FAILURE`)와 P2024가 한 건도 없다.** 남은 기록은
콜드 인스턴스의 예산 초과뿐이고, 그 요청들도 전부 200이었다.

## 15. No-write assertion (§13)

| 항목 | 값 |
|---|---|
| schema · migration · index | **0 · 0 · 0** |
| env(`DATABASE_URL`/`connection_limit`/`pool_timeout`) | **변경 0** |
| business data INSERT/UPDATE/DELETE | **0** |
| 서울·부산 데이터 변경 · MOLIT 호출 · SEO 변경 | **0** |
| `error_logs` | 실제 오류 발생 시 기존 계약대로 INSERT(위 4건) |

감사 스크립트는 SELECT만 하며 `DIAGNOSTIC` 가드(`ALLOW_PROD_DB_READ`)를 거친다.

## 16. 회귀 확인

| 계약 | 상태 |
|---|---|
| `ADMIN_DASHBOARD_TRUST_FIX_V1` region model 부분 실패 격리 | 유지(테스트로 고정) |
| `ADMIN_ERROR_LOGGING_P1` 로깅·중복 억제·민감정보 금지 | 유지 + category 1개 추가 |
| `ADMIN_OPS_V1.1/V1.2` evidence 표기·verdict 재계산 | 미변경 |
| `computeOverallHealth` | `aptSeqMissing`이 `number \| null`이 되어 **못 읽으면 UNKNOWN**(정상으로 단정하지 않음) |
| src 전체 테스트 | **1,937 pass / 0 fail** |
| tsc src / eslint / build | 0 / 0 / ✓ |

## 남은 ops 위험

1. **cold latency가 목표를 못 맞춘다(4~15초).** 200은 나오지만 §10의 cold ≤3s는 미달이다.
   캐시는 **인스턴스 메모리**라 새 Lambda마다 처음부터 다시 낸다.
2. **`count(deal_canceled=true)`가 여전히 단일 최대 비용**(1.2~10초). 콜드에서 예산 4초를
   넘기면 그 칸만 30초간 "확인 불가"가 된다. 거짓 0은 아니지만 빈 칸이다.
3. **`connection_limit=1`의 출처를 확인하지 못했다.** `DATABASE_URL`에 해당 파라미터가
   없는데도 런타임은 1로 동작한다(오류 메시지 기준). Prisma 기본값 계산이 Vercel에서
   1을 내는 것으로 보이지만 **확정하지 못했고, §2/§18에 따라 건드리지 않았다.**
4. **`/api/admin/dashboard`와 `/api/admin/behavior`도 같은 pool을 공유한다.** dashboard는
   여전히 `Promise.all`로 ~15개 쿼리를 띄운다 — **같은 P2024 구조를 갖고 있다.**
   아직 터지지 않았을 뿐이다.

## 다음 권고

1. **`@@index([lawdCd, dealCanceled])` 추가를 검토하십시오(schema 변경 → 승인 필요).**
   단일 최대 비용을 index-only scan으로 바꿔 cold latency 대부분을 없앱니다.
   이번 STEP에서는 §13에 따라 하지 않았습니다.
2. **`/api/admin/dashboard`에 같은 순차·격리 패턴을 적용하십시오.** 지금 구조가
   `/admin/ops`가 터지던 구조와 동일합니다 — 예방이 사후 대응보다 쌉니다.
3. `connection_limit`의 실제 출처를 확인하십시오. 근거가 확인되면 pool 설정을
   **의도적으로** 정할 수 있습니다(지금은 우연한 기본값에 의존하고 있습니다).
