# E-JIP ADMIN OPS LATENCY INSTRUMENTATION V1

`/api/admin/ops` 재조합이 5~6초 걸리는 **실제 원인**을 구간 계측으로 특정한다.
이번 STEP은 **최적화를 하지 않는다.**

- 계측 구현·배포: 2026-09-21 · 커밋 `0294bcc`
- **schema 0 · migration 0 · index 0 · VACUUM 0 · env 0 · business DML 0 · 최적화 0**

## 판정

**ROOT_CAUSE_FOUND**

재조합 시간의 **99.97%가 DB**이고, 그중 **`db:busanTotal` 한 지표가 최대 71%**다.
`regionModel`·auth·파일 읽기·직렬화는 전부 합쳐도 무의미한 수준이었다.

**근본 원인은 인덱스 부재가 아니라 `(lawd_cd, deal_date)` index-only scan이 강제로 수행하는
`Heap Fetches: 295,518`이다** — visibility map이 낡아서 생긴다(`last_autovacuum` 2026-08-29,
dead 53,081). 버퍼 캐시 상태에 따라 같은 쿼리가 **221 ms ↔ 5,344 ms**로 흔들린다.

> **직전 STEP의 순서가 틀렸다는 것이 이 계측으로 확인됐다.** 나는 인덱스를 먼저 넣었고,
> 그것이 고친 취소 count는 실제로는 두 번째 이하 비용이었다. **가장 비싼 것은 내가
> "가볍다"고 판단해 손대지 않은 `busanTotal`(단순 count)이었다.**

---

## 1. 계측한 성공 경로

| 구간 | 내용 |
|---|---|
| `auth` | `requireAdmin()` (세션 조회 포함) |
| `cacheOrBuild` | `getOrSetCache` 전체 — 아래 세 상태를 구분해 `cachePhase`로 보고 |
| ↳ `hit` / `inflight-wait` / `rebuild` | fetcher가 **실제로 돌았는지**로 판별 |
| `db:<metric>` × 13 | 순차 DB 지표 각각 |
| `regionModel` | 외부 프록시 전체 |
| ↳ `proxy:sidoList` / `proxy:sigunguAll` | 시도 목록 1회 / 시군구 18회(병렬) |
| `file:manifest` `file:cancelSnapshot` `file:legacyBootstrap` `file:cronRegistration` | 파일 읽기 |
| `serialize` | `NextResponse.json()` |
| `unaccountedMs` | **어느 구간에도 안 잡힌 시간** — 계측 구멍이 숨지 않게 |

중첩 구간을 이중으로 빼지 않도록 `unaccountedMs`는 **최상위 구간만** 기준으로 계산한다
(안 그러면 음수가 나와 거짓 안심을 준다 — 테스트로 고정).

## 2~3. 로깅 정책

- **DB에 쓰지 않는다.** `error_logs`는 오류용이다. 성능 로그는 `console.warn` 한 줄뿐이고
  **1,500 ms 이상일 때만** 남긴다. 실측 확인: `error_logs`에 `ADMIN_OPS_SLOW` **0건**.
- 형식: `[ADMIN_OPS_SLOW] /api/admin/ops rid=<8자난수> total=… unaccounted=… cache=… reqIdx=… | auth=… db:busanTotal=… …`
- 남기는 것은 **구간 이름·밀리초·난수 id**뿐이다. 세션/사용자/쿼리 원문/연결 문자열 없음(테스트로 고정).
- 계측값은 관리자 전용 응답의 `data.timings`로도 내려준다(개인정보 없음).

## 4. 캐시 단계 — **cold 5초는 캐시 lifecycle 탓이 아니다**

| cachePhase | 샘플 | 서버 측 총시간 |
|---|---|---|
| `hit` | 9회 | **1.7 ~ 3.2 ms** |
| `rebuild` | 4회 | 1,317 / 1,319 / 4,695 / **7,498 ms** |
| `inflight-wait` | 관측 없음 | — |

**캐시 조회 자체는 공짜다.** 히트일 때 서버가 쓰는 시간은 2 ms 남짓이고,
그중 `auth`가 1.3~2.9 ms다. 재조합일 때만 시간이 뛴다.

## 5. DB 구간 — 여기서 결론이 난다

**가장 무거웠던 재조합 샘플(총 7,498.4 ms, 콜드 인스턴스 아님 · reqIdx=17):**

| 구간 | ms | 비중 |
|---|---|---|
| **`db:busanTotal`** | **5,344.0** | **71.3%** |
| `db:latestDealDate` | 760.1 | 10.1% |
| `db:busanCovered` | 740.3 | 9.9% |
| `db:rentBusanTotal` | 284.4 | 3.8% |
| `db:saleRunKinds` | 75.1 | 1.0% |
| `db:rentCoverageCells` | 71.8 | 1.0% |
| 나머지 DB 지표 7개 | ~220 | 2.9% |
| **DB 합계** | **7,495.8** | **99.97%** |
| `auth` | 1.3 | 0.02% |
| 파일 읽기 4개 | ~1.7 | 0.02% |
| `serialize` | <1 | ~0% |
| **`unaccountedMs`** | **0.1** | — |

**DB 합계와 HTTP total의 차이가 2.6 ms다.** 계측이 사실상 전 구간을 덮었고,
**남은 시간은 전부 DB에 있다.**

**다른 재조합 샘플:**

| 샘플 | total | busanTotal | latestDealDate | busanCovered | regionModel | 콜드? |
|---|---|---|---|---|---|---|
| A | 4,695 ms | **2,751.2** | 569.4 | 548.8 | 279.7 | 예(reqIdx=1) |
| C | 1,319 ms | 221.0 | 176.9 | **269.9** | 264.0 | 예(reqIdx=1, sinceInit=1 ms) |
| D | 7,498 ms | **5,344.0** | 760.1 | 740.3 | (top6 밖) | **아니오**(reqIdx=17) |

**같은 쿼리가 221 ms ↔ 5,344 ms로 24배 흔들린다.** 이 분산이 핵심 단서다.

## 6. 외부 / region — 병목이 아니다

| 구간 | 실측 |
|---|---|
| `proxy:sidoList` | 140.2 ms |
| `proxy:sigunguAll` (18회 **병렬**) | 139.2 ms |
| `regionModel` 합계 | **264 ~ 280 ms** |

`AbortSignal.timeout(3000)`이 걸려 있고 **retry/backoff는 없다**. 18회를 병렬로 돌아
1회분 시간밖에 안 든다(ADMIN_DASHBOARD_TRUST_FIX_V1 §7의 병렬화가 유효하게 작동 중).
가장 느린 재조합(7,498 ms)에서는 아예 top 6에도 못 들었다. **여기는 손댈 곳이 아니다.**

## 7. 콜드 스타트 — **원인이 아니다**

모듈 평가 시각과 인스턴스별 요청 카운터로 판별했다.

| 샘플 | `likelyColdInstance` | `reqIdx` | `sinceInit` | total |
|---|---|---|---|---|
| C | **true** | 1 | **1 ms** | **1,319 ms** (가장 빠른 재조합) |
| D | **false** | 17 | — | **7,498 ms** (가장 느린 재조합) |

**가장 빠른 재조합이 콜드 인스턴스였고, 가장 느린 재조합은 따뜻한 인스턴스였다.**
콜드 스타트 가설은 실측으로 기각된다.

> **측정 불가로 명시:** Vercel 컨테이너 startup·번들 로드는 **모듈 평가 이전**이라
> 라우트 안에서 볼 수 없다. 위 `sinceInit`은 모듈 평가 이후만 센다. warm 요청의
> wall-clock(44~76 ms)과 서버 측 시간(1.7~3.2 ms)의 차이 **약 40~70 ms**가
> 네트워크 + 플랫폼 몫인데, 그 안에서 startup을 분리할 방법이 여기엔 없다.

## 8. Production 측정

**warm 10회 연속** (같은 인스턴스, reqIdx 1→10):

| 항목 | 값 |
|---|---|
| HTTP | **200 × 10/10** |
| 실패 | **0** |
| wall P50 / P95 | **60 ms / 1,470 ms** |
| 서버 측(캐시 히트 9회) | **1.7 ~ 3.2 ms** |
| degradedSources 합계 | **0** |

첫 요청(reqIdx=1)만 rebuild였고 1,470 ms였다. 이후 9회는 전부 히트.

**rebuild 4회**: 1,317 / 1,319 / 4,695 / 7,498 ms (§5 표).

## 9. 병목 순위 — **측정값 기준**

| 순위 | 구간 | 실측 범위 | 가장 느린 샘플에서의 비중 |
|---|---|---|---|
| **1** | **`db:busanTotal`** | 221 ~ **5,344 ms** | **71.3%** |
| **2** | `db:latestDealDate` | 177 ~ **760 ms** | 10.1% |
| **3** | `db:busanCovered` | 270 ~ **740 ms** | 9.9% |

**셋이 합쳐 91.3%이고, 셋 다 같은 인덱스 `(lawd_cd, deal_date)`를 쓴다.**

### 왜 느린가 — 플랜으로 확인

`db:busanTotal`의 플랜(운영 `EXPLAIN (ANALYZE, BUFFERS)`):

```
Parallel Index Only Scan using apartment_trade_histories_lawd_cd_deal_date_idx
  Index Cond: (lawd_cd = ANY ('{26110,…,26710}'))
  Heap Fetches: 295518          <-- 원인
  Buffers: shared hit=135592
Execution Time: 574.026 ms      (버퍼가 따뜻할 때)
```

**Index Only Scan인데 heap을 295,518번 읽는다.** visibility map이 낡았기 때문이다:

| 항목 | 값 |
|---|---|
| `last_autovacuum` | **2026-08-29** (23일 전) |
| `last_analyze` | 2026-09-01 (20일 전) |
| `n_dead_tup` | **53,081** |
| 수동 `vacuum_count` | 0 |

COUNT 하나에 **135,592 버퍼**(≈1 GB 상당의 버퍼 접근)를 쓴다. 그 페이지들이 shared_buffers에
있으면 221 ms, 없으면 디스크로 내려가 5,344 ms가 된다 — **관측된 24배 분산의 정체다.**
`latestDealDate`(MAX)와 `busanCovered`(GROUP BY)도 같은 인덱스를 타서 같은 벌을 받는다.

## 10. 최적화 없음 (§10 준수)

query rewrite **0** · cache 구조 변경 **0** · index 추가 **0** · **VACUUM 실행 0** ·
env 변경 **0** · `connection_limit` 변경 **0**. 이번 커밋은 계측만 추가했다.

## 11. 회귀 확인

| 계약 | 상태 |
|---|---|
| HTTP 200 | **10/10 + 재조합 4회 전부 200** |
| partial failure isolation | 유지(`isolate`·`isTotalDbOutage`·`withBudget` 테스트로 고정) |
| false zero | **0** — 865,291 / 848,977 / 16,314, `총계 = 유효 + 취소` 검산 통과 |
| P2024 | **0**(총 2건, 마지막 07:43Z) |
| BudgetExceeded | **0**(총 4건, 마지막 08:14Z) |
| 배포 이후 신규 `error_logs` | **0건** |
| 인덱스 / migration | 9개 / 22건 — **변화 없음** |
| 누적 INSERT/UPDATE/DELETE | 866,452 / 100,634 / 0 — **+0** |

## 16. 계측 오버헤드 — 무시 가능

| | 계측 전 | 계측 후 |
|---|---|---|
| warm wall P50 | 62 ms | **60 ms** |
| warm 서버 측 | (측정 불가) | **1.7 ~ 3.2 ms** (auth 1.3~2.9 ms 포함) |
| `unaccountedMs` | — | 0.1 ~ 0.4 ms |

`performance.now()` 호출 22회 수준이라 측정 노이즈 안에 있다.

## 15. 권고 — 다음에 할 일 (이번 STEP에서는 실행하지 않음)

1. **`VACUUM (ANALYZE) apartment_trade_histories` 승인을 요청드립니다.**
   이것이 **진짜 수정**입니다. `Heap Fetches: 295,518`을 0에 가깝게 만들면
   `busanTotal`·`latestDealDate`·`busanCovered` **세 개가 동시에** 해결되고, 그것이
   가장 느린 재조합의 **91%**입니다.
   - 스키마 변경 아님 · 되돌릴 것 없음 · 데이터 변경 없음
   - `(lawd_cd, deal_date)`를 쓰는 **사용자 화면 조회들도 함께** 좋아집니다
   - 낡은 통계도 갱신됩니다(플래너가 행 수를 7배 과소추정 중)
2. **autovacuum이 23일 동안 안 돈 이유**를 함께 보셔야 합니다. 한 번 VACUUM으로
   털어도 설정이 그대로면 다시 쌓입니다(테이블별 `autovacuum_vacuum_scale_factor` 등).
   이건 조사 후 별도 승인 항목입니다.
3. **인덱스·캐시·인프라는 지금 건드릴 이유가 없습니다.** 계측이 그쪽을 가리키지 않습니다.

## 남은 미확인

- **warm 요청의 wall-clock 40~70 ms**(서버 2 ms 대비)가 네트워크인지 Vercel 플랫폼인지
  분리하지 못했다. 라우트 안에서는 볼 수 없는 구간이다.
- `inflight-wait` 상태는 **관측되지 않았다**(동시 요청이 겹치지 않았다). 코드 경로는
  있지만 실측 샘플이 없다.
- 재조합 분산(1,317 ~ 7,498 ms)이 전적으로 버퍼 캐시 때문인지, Supabase 쪽 I/O 경합이
  섞였는지는 이 계측으로 나누지 못한다.
