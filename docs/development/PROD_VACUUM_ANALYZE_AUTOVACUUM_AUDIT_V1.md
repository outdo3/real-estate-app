# E-JIP PROD VACUUM ANALYZE + AUTOVACUUM AUDIT V1

승인된 `VACUUM (ANALYZE) apartment_trade_histories` 1회 실행 + 전후 측정 + autovacuum 원인 조사.

- 실행: **2026-09-21 21:41:11 KST** (`12:41:11Z`) · 소요 **12.4초**
- 실행 시각이 cron 창(04/06/08 KST) 밖임을 먼저 확인 (21:38 KST)
- **schema 0 · index 0 · migration 0 · autovacuum 설정 변경 0 · business DML 0**

## 판정

**PASS** — `Heap Fetches 295,518 → **0**`, all-visible **66.66% → 100%**,
ops 재조합 최악값 **7,498 ms → 2,516 ms**, 결과값 전부 불변.

autovacuum 판정: **AUTOVACUUM_CONFIG_REVIEW_NEEDED**
(설정은 정상 동작 중이고, **기본 scale factor 0.2가 이 테이블 크기에 안 맞는 것**이 원인)

---

## 1~3. VACUUM 전 상태

| 항목 | 값 |
|---|---|
| live / dead | 866,366 / **53,081** |
| mod_since_analyze | 24,103 |
| ins_since_vacuum | 60,521 |
| `last_vacuum` | **NULL** (수동 VACUUM 이력 없음) |
| `last_autovacuum` | **2026-08-30 05:19 KST** (22일 전) |
| `last_analyze` | 2026-09-01 17:47 KST |
| `last_autoanalyze` | 2026-08-30 05:24 KST |
| counts | vacuum=0 autovacuum=24 analyze=1 autoanalyze=44 |
| **all-visible 비율** | **19,081 / 28,624 = 66.66%** |

`relallvisible`이 핵심 지표다 — **전체 페이지의 33.3%가 all-visible이 아니라서**
index-only scan이 그 페이지들에 대해 heap을 다시 읽어야 했다.

### 쿼리 플랜 (before)

| 쿼리 | scan | Heap Fetches | buffers(hit) | EXPLAIN exec | wall median | Prisma median |
|---|---|---|---|---|---|---|
| **busanTotal** | Parallel Index Only Scan | **295,518** | **135,653** | 3,431.96 ms | 173 ms | 155 ms |
| latestDealDate | Index Scan | — | 4 | 1.83 ms | 22 ms | 186 ms |
| **busanCovered** | Parallel Index Only Scan | **295,518** | **135,569** | 363.27 ms | 205 ms | 205 ms |

> EXPLAIN ANALYZE는 행마다 계측하므로 86만 행에서는 실제보다 부풀려진다.
> 그래서 wall-clock median을 함께 적는다. **둘 다 같은 방식으로 전/후를 잰다.**

### ops 재조합 (직전 STEP 계측, VACUUM 전)

**1,317 / 1,319 / 4,695 / 7,498 ms** — 편차가 극심했다.

## 4. autovacuum 설정 (읽기만, 변경 0)

| 설정 | 값 | source |
|---|---|---|
| `autovacuum` | **on** | default |
| `autovacuum_vacuum_threshold` | 50 | default |
| **`autovacuum_vacuum_scale_factor`** | **0.2** | default |
| `autovacuum_analyze_threshold` | 50 | default |
| `autovacuum_analyze_scale_factor` | 0.1 | default |
| `autovacuum_naptime` | 60 s | default |
| `autovacuum_max_workers` | 3 | default |
| `autovacuum_vacuum_cost_delay` / `cost_limit` | 2 ms / -1 | default |
| `track_counts` | on | default |
| **테이블 `reloptions`** | **NULL** (개별 override 없음) | — |

**모든 값이 `source: default`다.** Supabase가 따로 손댄 설정이 없다.

## 5. 왜 23일간 안 돌았나 — **산수로 확정**

```
VACUUM 발동 임계치 = 50 + 0.2 × 866,366 = 173,323 dead tuples
현재 dead_tup      = 53,081   (임계치의 30.6%)

ANALYZE 발동 임계치 = 50 + 0.1 × 866,366 = 86,687
현재 mod_since_analyze = 24,103  (임계치의 27.8%)
```

| 후보 | 판정 | 근거 |
|---|---|---|
| A. 전역 autovacuum 비활성 | **RULED_OUT** | `autovacuum = on` |
| B. 테이블 개별 비활성 | **RULED_OUT** | `reloptions = NULL` |
| **C. 임계치 미도달** | **CONFIRMED** | 53,081 < 173,323 — **설계대로 안 돈 것이다** |
| D. worker 고갈 | **RULED_OUT** | `max_workers=3`, `naptime=60s`, 이 테이블 `autovacuum_count=24`로 과거 정상 동작 |
| E. 장기 트랜잭션 차단 | **RULED_OUT** | 감사 시점 60초 초과 트랜잭션 **0개**. 게다가 VACUUM이 dead를 **0까지** 회수했다 — 오래된 스냅샷을 잡고 있던 것이 없었다는 직접 증거 |
| F. VACUUM 취소/충돌 | **RULED_OUT** | 그런 이력의 근거 없음. C가 이미 전부 설명한다 |
| G. 통계 리셋 | **RULED_OUT** | 카운터가 누적돼 있다(autovacuum=24, autoanalyze=44) |
| H. 최근 수동 유지보수 영향 | **RULED_OUT** | `vacuum_count=0`, `last_vacuum=NULL` — 오늘 전까지 수동 VACUUM 자체가 없었다 |
| I. Supabase 관리형 동작 | **RULED_OUT** | 모든 설정이 `source: default` — 관리형 override 없음 |
| J. 근거 부족 | 해당 없음 | C가 숫자로 확정됐다 |

**결론: 고장이 아니다.** 기본 `scale_factor = 0.2`는 "테이블의 20%가 죽어야 청소"라는 뜻이고,
86만 행에서는 그게 **17만 행**이다. 테이블이 클수록 autovacuum은 더 드물게 돌고,
그 사이 visibility map이 낡아 index-only scan이 heap을 읽게 된다.

## 6. VACUUM 전 blocker 확인

| 항목 | 값 |
|---|---|
| 다른 세션 | 9개 (전부 `idle`, pgbouncer/PostgREST 유지 연결) |
| **60초 넘는 트랜잭션** | **0개** |
| 대상 테이블 ungranted lock | **0개** |

위험 요소 없음을 확인하고 진행했다. 세션을 임의로 종료하지 않았다.

## 7. 실행

```sql
VACUUM (ANALYZE) apartment_trade_histories;   -- 정확히 1회
```

**소요 12,409 ms (12.4초).** `VACUUM FULL` / `REINDEX` / `CLUSTER` **실행 0**.

## 8. VACUUM 후 테이블 상태

| 항목 | Before | After |
|---|---|---|
| dead tuples | **53,081** | **0** |
| mod_since_analyze | 24,103 | **0** |
| ins_since_vacuum | 60,521 | **0** |
| `last_vacuum` | NULL | **2026-09-21 21:41:11 KST** |
| `last_analyze` | 2026-09-01 | **2026-09-21 21:41:19 KST** |
| vacuum_count / analyze_count | 0 / 1 | **1 / 2** |
| **all-visible 비율** | **66.66%** | **100.00%** (28,624 / 28,624) |

`last_autovacuum`은 2026-08-30 그대로다 — 수동 VACUUM은 그 필드를 바꾸지 않는다(정상).

## 9. VACUUM 후 쿼리 플랜 — **핵심 결과**

| 쿼리 | 항목 | Before | After | 개선 |
|---|---|---|---|---|
| **busanTotal** | Heap Fetches | **295,518** | **0** | **-100%** |
| | buffers(hit) | 135,653 | **1,512** | **-98.9%** |
| | EXPLAIN exec | 3,431.96 ms | **471.87 ms** | -86.3% |
| | wall median | 173 ms | **97 ms** | -43.9% |
| | Prisma median | 155 ms | **93 ms** | -40.0% |
| **busanCovered** | Heap Fetches | **295,518** | **0** | **-100%** |
| | buffers(hit) | 135,569 | **1,511** | **-98.9%** |
| | EXPLAIN exec | 363.27 ms | **154.05 ms** | -57.6% |
| | wall median | 205 ms | **111 ms** | -45.9% |
| | Prisma median | 205 ms | **113 ms** | -44.9% |
| latestDealDate | scan | Index Scan | Index Scan | 변화 없음 |
| | buffers(hit) | 4 | 4 | — |
| | Prisma median | 186 ms | **97 ms** | -47.8% |

**`Heap Fetches: 295,518 → 0`.** COUNT 하나가 만지던 버퍼가 135,653 → 1,512로 줄었다.
직전 STEP에서 지목한 메커니즘이 그대로 제거됐다.

## 10. ops 성능 (Production)

**재조합 3회** (5분 TTL 만료를 실제로 기다려 측정):

| 샘플 | total | DB 합계 | busanTotal | latestDealDate | busanCovered | regionModel | 콜드 |
|---|---|---|---|---|---|---|---|
| A | **2,272.1 ms** | 2,269.1 | 766.1 | 860.5 | 162.3 | 0(캐시) | 아니오 |
| B | **2,516.3 ms** | 2,221.8 | 653.5 | 840.5 | 152.9 | 287.1 | **예**(reqIdx=1) |
| C | **2,019.5 ms** | 2,016.1 | 754.8 | 567.2 | 147.0 | 0(캐시) | 아니오 |

**Before vs After (재조합):**

| | Before | After |
|---|---|---|
| 샘플 | 1,317 / 1,319 / 4,695 / **7,498** ms | 2,020 / 2,272 / **2,516** ms |
| **최악값** | **7,498 ms** | **2,516 ms (-66.4%)** |
| 편차(최대−최소) | **6,181 ms** | **496 ms** |
| busanTotal 범위 | 221 ~ **5,344 ms** | **653 ~ 766 ms** |
| busanCovered 범위 | 270 ~ **740 ms** | **147 ~ 162 ms (-78%)** |

**가장 큰 소득은 평균이 아니라 꼬리다.** 7.5초짜리 최악 사례가 사라졌고 편차가 12배 줄었다.

**warm 12회 연속:**

| 항목 | 값 |
|---|---|
| HTTP | **200 × 12/12** |
| 실패 | **0** |
| wall **P50 / P95** | **59 ms / 102 ms** |
| 서버 측 | **1.3 ~ 3.5 ms** |
| degradedSources | **0** |

## 11~12. 오류 재발

| 패턴 | VACUUM 이후 | 총계 |
|---|---|---|
| `P2024` | **0** | 2 (마지막 07:43Z) |
| `BudgetExceeded` | **0** | 4 (마지막 08:14Z) |
| `ADMIN_OPS_FAILURE` | **0** | 2 |
| `ADMIN_OPS_SLOW` | **0** | 0 |
| 전체 신규 `error_logs` | **0건** | — |

## 13. 데이터 / 스키마 안전성

| 항목 | Before | After | 판정 |
|---|---|---|---|
| total rows | 866,366 | **866,366** | 불변 |
| 부산 rows | 865,291 | **865,291** | 불변 |
| canceled rows | 16,372 | **16,372** | 불변 |
| 최근 거래일 | 2026-09-18 | **2026-09-18** | 불변 |
| 누적 INSERT / UPDATE / DELETE | 866,452 / 100,634 / 0 | **동일** | **+0 / +0 / +0** |
| 인덱스 | 9 | **9** | 불변 |
| migrations | 22 | **22** | 불변 |
| INVALID 인덱스 | 0 | **0** | 불변 |

화면 실측: 전체 상태 **정상** · 경고 0건 · 865,291 / 848,977 / 16,314 / 2026-09-18 ·
부산 16/16 · 전국 시도 17/17 — **VACUUM은 성능만 바꿨고 값은 하나도 바꾸지 않았다.**

## 14. autovacuum 후속 — **AUTOVACUUM_CONFIG_REVIEW_NEEDED** (이번 STEP 변경 없음)

오늘 dead를 0으로 털었지만 **설정이 그대로면 같은 일이 반복된다.**
다시 173,323개가 쌓일 때까지 autovacuum은 이 테이블을 건드리지 않고,
그 사이 visibility map이 다시 낡는다.

**제안(별도 승인 항목):** 이 테이블에만 개별 override를 주는 방식

```sql
-- 실행하지 않았음 — 승인 시 별도 STEP에서
ALTER TABLE apartment_trade_histories SET (
  autovacuum_vacuum_scale_factor  = 0.02,   -- 20% -> 2% (약 17,300행)
  autovacuum_analyze_scale_factor = 0.01
);
```

- 전역 설정을 건드리지 않아 **다른 테이블에 영향이 없다**
- 되돌리기: `ALTER TABLE ... RESET (...)` 한 줄
- 다만 이건 **schema/ALTER TABLE**이라 승인이 필요하고, 이번 STEP에서는 금지된 범위다

## 15. 남은 병목 — **순위가 바뀌었다**

| 순위 | 구간 | After 범위 | 비고 |
|---|---|---|---|
| **1** | **`db:latestDealDate`** | **567 ~ 861 ms** | 새로 1위 |
| 2 | `db:busanTotal` | 653 ~ 766 ms | VACUUM으로 안정화 |
| 3 | `regionModel` | 0 ~ 287 ms | 자체 캐시가 있어 대부분 0 |
| 4 | `db:busanCovered` | 147 ~ 162 ms | **-78%**, 사실상 해결 |

**`latestDealDate`는 VACUUM으로 고칠 수 없고 인덱스 문제도 아니다.** 근거:
같은 조건의 raw SQL은 `Index Scan Backward using …_deal_date_idx` + `Limit 1`로
**buffers 4개 / Execution 3.3 ms**다. 플랜은 이미 최적이다.

그런데 Prisma `aggregate({ _max: { dealDate } })` 경로는 로컬 97 ms, 운영 567~861 ms다.
**플랜 3 ms와 관측 860 ms 사이의 차이를 이번 계측으로는 설명하지 못했다** —
Prisma의 aggregate 래핑/역직렬화인지, 드라이버인지, 네트워크인지 나누지 못한다.
**추측하지 않고 다음 STEP의 측정 대상으로 남긴다.**

## 16. 다음 단계

1. **`latestDealDate`의 3 ms ↔ 860 ms 간극을 계측하십시오(P1).**
   SQL 플랜은 이미 최적이므로 인덱스·VACUUM으로는 못 고칩니다. 확인할 것:
   Prisma `aggregate` 경로 vs `$queryRaw` 직접 호출의 운영 실측 비교.
   (로컬에서는 raw 17 ms vs Prisma 97 ms로 이미 5배 차이가 보입니다.)
2. **autovacuum 테이블 override 승인 여부를 결정해 주십시오**(§14).
   오늘 청소는 일회성이고, 설정이 그대로면 수주 안에 같은 상태로 돌아갑니다.
3. ops warm(P50 59 ms)은 충분합니다. 재조합 2.0~2.5초도 관리자 화면으로는 무리가 없으니,
   1·2를 끝낸 뒤 더 손댈지 판단하시면 됩니다.

## 남은 미확인

- **재조합 편차가 완전히 사라진 것은 아니다**(2,020~2,516 ms). 샘플 3개뿐이다.
- `latestDealDate`의 간극(§15) — 원인 미상, 측정 필요.
- warm 요청의 wall-clock 59 ms와 서버 1.3~3.5 ms의 차이(네트워크/플랫폼)는
  라우트 안에서 나눌 수 없다.
