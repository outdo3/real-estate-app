# E-JIP OPS CANCEL INDEX APPLY V1

승인된 인덱스 1개를 Production에 적용하고 효과를 실측한다.

- 적용: **2026-09-21 18:19:21 KST** (`09:19:21Z`) · 커밋 `fae200c`
- 준비 문서: `OPS_CANCEL_INDEX_PREP_V1.md` · 근거 감사: `OPS_CANCEL_COUNT_INDEX_IMPACT_AUDIT_V1.md`
- **승인 범위 외 변경 0** — schema 1개 인덱스 · migration 1건 · business DML **0**

## 판정

**PASS** — `Parallel Seq Scan → Index Only Scan`, 쿼리 **2,286 ms → 8.4 ms (273배)**,
Prisma 실호출 **1,125 ms → 21 ms (54배)**, 결과값 **16,314 불변**, 신규 오류 **0건**,
데이터 DML **0**.

단, **화면 체감(ops 재조합 5.4~6.1초)은 개선되지 않았다** — 남은 비용은 취소 count가
아니고, 어디인지는 이번 측정으로 특정하지 못했다(§10~11).

> **내 추정이 두 군데 틀렸다. 둘 다 보수적인 쪽으로 틀렸다 — 그대로 적는다.**
> 효과는 추정(~20~120 ms)보다 **더 좋았고**(8.4 ms), 인덱스 크기는 추정(11.3~12.5 MB)의
> **절반**(5.76 MB)이었다. 이유는 §9/§5에 적었다.

---

## 1. 적용 전 pending migration

```
22 migrations found in prisma/migrations
Following migration have not yet been applied:
  20260921090000_apartment_trade_lawd_cd_deal_canceled_idx
```

**미적용은 승인된 1건뿐**임을 확인하고 진행했다.

## 2~3. Baseline (적용 직전 실측)

| 항목 | 값 |
|---|---|
| scan type | **Parallel Seq Scan** |
| Filter | `deal_canceled AND lawd_cd = ANY('{26110,…,26710}')` |
| Rows Removed by Filter | **425,026 / worker** (866,366행 중 850,052행 폐기) |
| Buffers | `hit=25,543 read=3,081` (28,624) |
| Planning Time | 15.476 ms |
| **Execution Time** | **2,286.136 ms** |
| Prisma 실호출 5회 | 1,795 / 1,161 / 1,061 / 1,125 / 953 → **median 1,125 ms** |
| 결과값 | **16,314** |

## 4~5. 적용

```
npx prisma migrate deploy
Applying migration `20260921090000_apartment_trade_lawd_cd_deal_canceled_idx`
All migrations have been successfully applied.
real 0m28.169s
```

- 적용된 migration: **1건**(승인된 것). 다른 migration은 실행되지 않았다.
- 적용된 DDL: **정확히 한 문장**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "apartment_trade_histories_lawd_cd_deal_canceled_idx"
  ON "apartment_trade_histories"("lawd_cd", "deal_canceled");
```

- 적용 시각 **18:19 KST** — cron 창(04/06/08시 KST) 밖. 쓰기 차단 없음(CONCURRENTLY).
- 실패·재시도 **없음**.

## 6. 인덱스 유효성

```json
{"relname":"apartment_trade_histories_lawd_cd_deal_canceled_idx",
 "indisvalid":true,"indisready":true,"indislive":true,"size":"5896 kB"}
```

| 항목 | 결과 |
|---|---|
| 존재 | ✓ |
| `indisvalid` / `indisready` / `indislive` | **true / true / true** |
| 테이블 인덱스 수 | 8 → **9** |
| 중복 정의 | **없음** |
| **INVALID 인덱스(DB 전체)** | **없음** |
| `_prisma_migrations` | `steps=1`, `rolled_back_at=no`, 총 21 → **22건** |

## 7~8. 적용 후 쿼리 플랜 — 같은 조건, 같은 스크립트

```
Aggregate  (actual time=8.291..8.292 rows=1 loops=1)
  Buffers: shared hit=2821
  ->  Index Only Scan using apartment_trade_histories_lawd_cd_deal_canceled_idx
        (cost=0.42..851.00 rows=4014) (actual time=1.231..7.447 rows=16314 loops=1)
      Index Cond: ((lawd_cd = ANY ('{26110,…,26710}')) AND (deal_canceled = true))
      Heap Fetches: 16314
Planning Time: 0.132 ms
Execution Time: 8.365 ms
```

| 항목 | Before | After | 변화 |
|---|---|---|---|
| scan type | Parallel Seq Scan | **Index Only Scan** | — |
| rows examined | 866,366 (850,052 폐기) | **16,314** (폐기 0) | **-98.1%** |
| Buffers | hit 25,543 + read 3,081 | **hit 2,821, read 0** | **-90.1%** |
| Planning Time | 15.476 ms | **0.132 ms** | -99.1% |
| **Execution Time** | **2,286.14 ms** | **8.37 ms** | **-99.63% (273배)** |
| parallel workers | 1 launched | **0**(불필요) | — |

### Prisma 실호출 (바인드 파라미터 경로) — 10회

```
218, 21, 21, 22, 21, 21, 21, 21, 21, 21   → median 21 ms
7~10회차(generic plan 가능 구간): 21, 21, 21, 21 ms
```

**이것이 이번 적용에서 가장 중요한 확인이다.** 준비 STEP에서 부분 인덱스를 기각한 근거가
"Prisma가 `deal_canceled = $17`을 바인드 파라미터로 보내 generic plan에서 술어 함의를
증명할 수 없다"였다. 복합 인덱스는 그 제약을 받지 않는다 —
**generic plan이 쓰일 수 있는 7~10회차에서도 21 ms로 일정하다.** 판단이 맞았다.

### 9. 개선율

| 측정 | Before | After | 개선 |
|---|---|---|---|
| EXPLAIN Execution Time | 2,286.14 ms | 8.37 ms | **99.63% (273×)** |
| Prisma 실호출 median | 1,125 ms | 21 ms | **98.1% (54×)** |
| ops DB 블록 전체 P50 | 799 ms | **639 ms** | 20% |
| 4초 예산 초과(UNKNOWN) | 콜드에서 발생 | **0 / 90** | 해소 |

> **추정이 틀렸다.** 준비 문서의 ESTIMATE는 `~20~120 ms`였는데 실측은 **8.4 ms**로
> 가장 낙관적인 추정보다도 좋았다. 근거로 삼았던 것은 "865,291 엔트리 index-only scan이
> 394 ms이니 53배 적으면 그 정도"라는 비례 추정이었는데, 그 394 ms 측정값 자체가
> **heap fetch 295,518회**에 오염돼 있었다(visibility map이 낡아서). 깨끗한 인덱스에서는
> 훨씬 빠르다. 비례 추정의 기준선을 검증하지 않은 것이 원인이다.

## 5-b. 인덱스 크기 — 추정의 절반

| | 추정 | 실측 |
|---|---|---|
| 인덱스 크기 | 11.3 ~ 12.5 MB | **5,896 kB (5.76 MB)** |
| 엔트리당 | 13 ~ 14.4 B | **6.96 B** |
| DB 전체 | 716 → ~728 MB (+1.7%) | 716 → **722 MB (+0.84%)** |

**왜 절반인가:** 추정의 기준선으로 `(lawd_cd, deal_date)`의 14.37 B/entry를 썼는데,
그 인덱스는 distinct 키가 19 × 7,013(날짜) ≈ 수만 가지다. 반면
`(lawd_cd, deal_canceled)`는 **distinct 키 조합이 19 × 2 = 38가지뿐**이다.
PostgreSQL 13+의 **B-tree deduplication**이 같은 키를 한 번만 저장하고 TID를 posting
list로 압축하므로, 중복도가 극단적으로 높은 이 인덱스는 훨씬 촘촘해진다.
**저카디널리티 복합 인덱스에는 일반 밀도를 그대로 적용하면 안 된다** — 배운 점.

적용 후 인덱스 목록(9개) — 신규 인덱스는 이미 **scans=270**으로 실사용 중이다.

## 10~11. /api/admin/ops 성능 — **여기서는 개선을 입증하지 못했다**

**warm 10회 연속(5분 요약 캐시 적중 구간):**

| 항목 | 값 |
|---|---|
| HTTP | **200 × 10/10** |
| 실패 | **0** |
| **P50** | **62 ms** |
| **P95** | **2,445 ms** (콜드 인스턴스 1회 포함) |
| min / max | 48 ms / 2,445 ms |
| degradedSources | **10회 전부 0건** |

**캐시 만료 후 재조합(rebuild) 2회 — TTL을 실제로 기다려 측정:**

| 샘플 | latency | degraded | 값 |
|---|---|---|---|
| rebuild #1 (09:28:22Z) | **6,131 ms** | 0 | 16,314 ✓ |
| rebuild #2 (09:34:17Z) | **5,402 ms** | 0 | 16,314 ✓ |
| 재조합 직후 캐시 적중 | 45~54 ms | 0 | ✓ |

> **정직하게 적는다: 인덱스는 ops 재조합 비용을 없애지 못했다.**
>
> 취소 count는 1,125 ms → 21 ms가 됐고 4초 예산도 더 이상 발동하지 않는다(UNKNOWN 0/90).
> 그런데도 재조합은 **5.4~6.1초**이고, 이는 적용 전에 관측된 콜드 범위(4.2~15.4초)
> 안에 그대로 들어간다. 두 번 모두 5초대로 **재현되므로** "콜드 인스턴스 1회의
> 우연"이 아니다.
>
> **남은 5초가 어디서 오는지 단정하지 않겠다.** 짐작할 수 있는 후보를 재어봤고
> 둘 다 설명력이 약했다:
> - **DB 블록**: 로컬에서 limit=1 순차 실행 P50 **639 ms**(내 머신→Supabase). Vercel icn1은
>   더 가까우므로 이보다 느릴 이유가 없다.
> - **region model 프록시**: 단독 호출 **0.11~0.18초**(3회 측정), 18회를 병렬로 돌린다.
>
> 서버 측 구간별 계측이 없어(성공 경로에는 latency 로깅이 없다) 여기서 더 좁힐 근거가 없다.
> **"인덱스가 ops를 빠르게 만들었다"고 쓰지 않는다** — 빨라진 것은 쿼리이고,
> 화면이 체감하는 재조합 시간은 그대로다.

**인덱스가 실제로 바꿔놓은 것**(측정으로 뚜렷한 것만):

| | Before | After |
|---|---|---|
| 취소 count 쿼리 | 2,286 ms (Seq Scan) | **8.4 ms (Index Only Scan)** |
| Prisma 실호출 | 1,125 ms | **21 ms** |
| ops DB 블록 P50 | 799 ms | **639 ms** |
| 4초 예산 초과 | 콜드에서 발생(운영 로그 4건) | **0 / 90** |
| `BudgetExceeded` 로그 | 4건 | **적용 이후 0건** |

> **cold 3회 요구를 채우지 못했다.** Vercel 인스턴스 콜드 시작은 외부에서 강제할 수
> 없다. 대신 **캐시 만료 후 재조합 2회**를 TTL을 실제로 기다려 측정했고(위 표),
> warm 구간에서 자연 발생한 콜드 1회(2,445 ms)를 함께 기록한다. 세 경우 모두
> **200 / degraded 0 / 값 정확**이었다.

## 12~13. 오류 재발

| 패턴 | 총 건수 | **적용 이후** | 마지막 발생 |
|---|---|---|---|
| `ADMIN_OPS_FAILURE` | 2 | **0** | 2026-09-21T07:43:54Z (적용 96분 전) |
| `P2024` | 2 | **0** | 2026-09-21T07:43:54Z |
| `BudgetExceeded` | 4 | **0** | 2026-09-21T08:14:07Z (적용 65분 전) |
| `ADMIN_DASHBOARD*` | 0 | **0** | 없음 |

**적용 이후 `error_logs` 신규 기록 0건.** 취소 count가 4초 예산을 넘는 일은 발생하지 않았다.

## 14. UI 정확성 — 값이 바뀌지 않았다

| 항목 | 적용 전 | 적용 후 |
|---|---|---|
| 전체 row | 865,291 | **865,291** |
| 유효(active) | 848,977 | **848,977** |
| 취소 | 16,314 | **16,314** |
| 최근 거래일 | 2026-09-18 | **2026-09-18** |
| aptSeq 없는 row | 0 | **0** |
| 부산 coverage | 16/16 | **16/16** |
| 전체 상태 / 경고 | 정상 / 0건 | **정상 / 0건** |
| degradedSources | [] | **[]** |
| `stale` | null | **null** |

`총계 = 유효 + 취소` 검산 **통과**. 화면 실측도 동일(전체 상태 정상, 상태 배지 전부 정상/SAFE).
**인덱스는 성능만 바꿨고 결과값은 하나도 바꾸지 않았다.**

## 15~16. 데이터 / 스키마 안전성

| 항목 | 감사 시점 | 지금 | 판정 |
|---|---|---|---|
| total rows | 866,366 | **866,366** | 불변 |
| 부산 rows | 865,291 | **865,291** | 불변 |
| canceled rows | 16,372 | **16,372** | 불변 |
| 최근 거래일 | 2026-09-18 | **2026-09-18** | 불변 |
| 누적 INSERT | 866,452 | **866,452** | **+0** |
| 누적 UPDATE | 100,634 | **100,634** | **+0** |
| 누적 DELETE | 0 | **0** | **+0** |
| `_prisma_migrations` | 21건 | **22건** | 승인된 1건만 |

`pg_stat_user_tables`의 누적 DML 카운터가 **한 건도 증가하지 않았다** —
INSERT/UPDATE/DELETE 0의 직접 증거다. 서울·부산 거래 데이터 내용 변경 **0**.

schema 변경: **승인된 인덱스 1개뿐**. 테이블·컬럼·제약·권한 변경 없음.

## 17. Rollback 필요 여부 — **불필요**

§9의 롤백 조건을 하나씩 확인했다:

| 조건 | 상태 |
|---|---|
| index invalid | **아니오** (`indisvalid=true`) |
| latency 악화 | **아니오** (273배 개선) |
| write/lock 이상 | **아니오** (CONCURRENTLY, 차단 0, DML 카운터 불변) |
| planner가 인덱스를 쓰지 않음 | **아니오** (Index Only Scan 채택, scans=270) |
| 운영 장애 | **아니오** (신규 오류 0건) |

롤백하지 않는다. 필요해지면 `DROP INDEX CONCURRENTLY IF EXISTS "apartment_trade_histories_lawd_cd_deal_canceled_idx";` 한 줄이며 데이터 손실이 없다.

## 18. Commit / Deploy

schema·migration은 이미 `fae200c`로 커밋·푸시돼 있었고, 이번 STEP은 **그것을 Production에
적용**한 것이다. 코드 변경이 없으므로 재배포는 필요 없다(라우트·UI 모두 그대로).

## 19. 남은 ops 병목

1. **재조합 5.4~6.1초의 출처가 미확인이다 — 이게 이제 가장 큰 항목이다.**
   이번 인덱스로 취소 count는 후보에서 완전히 빠졌고(21 ms), DB 블록도 로컬 측정으로
   639 ms이며, region 프록시도 0.1초대다. **그 셋으로는 5초가 설명되지 않는다.**
   성공 경로에 구간별 latency 계측이 없어 추측만 가능하므로, 다음 작업은 **추측이
   아니라 계측**이어야 한다.
2. **`Heap Fetches: 16314`** — Index Only Scan인데도 heap을 16,314번 읽는다.
   visibility map이 낡았기 때문이다(`last_autovacuum` 2026-08-29, dead 53,081).
   `VACUUM (ANALYZE)`를 하면 이 8.4 ms가 더 줄고, 더 중요하게
   `(lawd_cd, deal_date)`를 쓰는 기존 조회들이 함께 개선된다(그쪽은 heap fetch가 295,518회다).
3. **플래너 행 추정이 여전히 어긋난다** — `rows=4014` 예상 vs 실제 16,314.
   통계가 낡은 탓(`last_analyze` 2026-09-01). 위 ANALYZE로 함께 해소된다.
4. **캐시가 인스턴스 메모리라** 새 Lambda마다 재조합 비용을 다시 치른다.
   없애려면 인스턴스 간 공유 캐시가 필요하고, 그것은 새 인프라다.

## 20. 다음 권고

1. **먼저 계측을 붙이십시오(P1).** ops 재조합이 5초인데 어느 조각이 먹는지 모른다는
   것이 지금 가장 큰 문제입니다. `buildSummary()` 구간별 소요시간을 응답에 실거나
   성공 경로에도 latency를 남기면(스키마 변경 없음) **다음 최적화를 짐작으로
   하지 않아도 됩니다.** 이번에 인덱스를 먼저 넣고 보니 정작 병목은 다른 데 있었습니다.
2. **`VACUUM (ANALYZE) apartment_trade_histories` 승인을 요청드립니다.**
   스키마 변경이 아니고 되돌릴 것도 없으며, 이번 인덱스보다 **적용 범위가 넓습니다**
   (dead 53,081 정리 + 통계 갱신 + visibility map 갱신 → 기존 조회들까지 개선).
3. 서울 Phase A(QUOTA_BLOCKED) 재개 여부는 쿼터 회복 확인이 먼저입니다.
4. 인스턴스 간 공유 캐시는 **지금 권하지 않습니다** — 새 인프라이고, warm P50가
   62 ms라 운영에는 충분합니다. 1번 계측 결과를 본 뒤에 판단해도 늦지 않습니다.
