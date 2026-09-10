# REPORT-5 PERFORMANCE FIX — CREATED_AT INDEX V1

> **승인된 Production schema 변경.** 인덱스 1개 추가. 데이터 수정 없음.
> 선행: `REPORT_ENGINE_V1_REPORT_5_DAILY.md` §9

## 1. 왜 필요했나

`/report/daily/[date]`는 KST 관찰일을 UTC 구간으로 바꿔 **`created_at` 범위로만**
조회한다(계약일이 아니라 "이집이 그 거래를 처음 확인한 시각"). 그런데
`apartment_trade_histories`(855,179행 / 472MB)에는 `created_at`을 선두로 하는
인덱스가 **하나도 없었다.**

애플리케이션 최적화는 REPORT-5에서 이미 소진했다(집계 1회로 축소, 발행 가능한 날만
행 조회, `deal_date` 경계로 인덱스 유도). 남은 비용은 전부 풀스캔이었다.

## 2. 매핑 확인 (§1)

추측하지 않고 스키마에서 확인했다:

| Prisma | 물리 |
|---|---|
| `model ApartmentTradeHistory` | `apartment_trade_histories` (`@@map`) |
| `createdAt` | `created_at` (`@map("created_at")`) |

## 3. 기존 인덱스 (§2)

PostgreSQL **17.6**. 적용 전 7개:

| 인덱스 | 컬럼 | unique | 크기 |
|---|---|---|---|
| `..._pkey` | id | ✓ | 21 MB |
| `..._group_key_deal_amount_deal_date_f_key` | group_key, deal_amount, deal_date, floor, occurrence_index | ✓ | 79 MB |
| `..._apt_seq_exclusive_area_deal_date_idx` | apt_seq, exclusive_area, deal_date | | 51 MB |
| `..._identity_key_deal_date_idx` | identity_key, deal_date | | 44 MB |
| `..._lawd_cd_exclusive_area_deal_date_idx` | lawd_cd, exclusive_area, deal_date | | 34 MB |
| `..._lawd_cd_deal_date_idx` | lawd_cd, deal_date | | 12 MB |
| `..._deal_date_idx` | deal_date | | 8,136 kB |

**`created_at`을 포함한 인덱스: 0개.** 중복 생성 위험 없음 → 진행.

## 4. Baseline (§3)

Production `EXPLAIN (ANALYZE, BUFFERS)`, REPORT-5의 실제 집계 쿼리 모양 그대로.

| 관찰일 | 스캔 | Rows Removed by Filter | Planning | **Execution** | Buffers |
|---|---|---|---|---|---|
| 2026-09-10 (정상일) | Parallel Seq Scan | 432,270 / worker | 132.6 ms | **7,497 ms** | hit 26,907 read 1,656 |
| 2026-08-29 (백필일) | Seq Scan | 674,677 | 8.1 ms | **12,129 ms** | hit 26,968 read 1,592, temp r678/w683 |

## 5. 적용한 인덱스 (§7)

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "apartment_trade_histories_created_at_idx"
  ON "apartment_trade_histories"("created_at");
```

```prisma
@@index([createdAt])
```

**단일 컬럼만.** 복합 인덱스를 만들지 않았다 — 부산/취소 필터는 이미 좁혀진 "하루치"
결과 안에서만 걸리므로 선두 컬럼 하나로 충분하고, 실측이 그것을 확인해준다(§7).
`ingestRunId`/`ingestMode` 등 다른 변경은 승인 범위 밖이라 손대지 않았다.

## 6. 안전성 — 왜 블로킹되지 않는가 (§4/§5/§6)

`apartment_trade_histories`는 증분 sync가 계속 쓰는 테이블이다. 일반
`CREATE INDEX`는 빌드 내내 SHARE 락을 잡아 그 쓰기를 막는다.

`CONCURRENTLY`가 안전하다는 근거는 추정이 아니라 **이 저장소의 선례**다:

- `20260901084417_area84_lawd_exclusive_deal_date_idx`가 **같은 테이블에**
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`를 이미 Production에 적용했고,
  그 인덱스(`..._lawd_cd_exclusive_area_deal_date_idx`, 34 MB)는 현재 `valid=true`다.
- 그 마이그레이션 주석이 기록해 둔 대로, **Prisma Migrate는 `CONCURRENTLY`를 감지하면
  해당 마이그레이션을 트랜잭션 밖에서 실행한다**(필수 — `CREATE INDEX CONCURRENTLY`는
  트랜잭션 안에서 실행될 수 없다).
- 접속은 Supabase pooler **5432 (session mode)** 이다. transaction mode(6543)가 아니라
  세션이 전용 백엔드를 유지하므로 `CONCURRENTLY`가 성립한다.

즉 §6의 `SAFE_INDEX_APPLY_BLOCKED` 조건에 해당하지 않았다. 블로킹 방식으로
자동 폴백하지 않았다.

`prisma migrate dev`를 쓰지 않고 마이그레이션 SQL을 직접 작성한 이유도 이것이다 —
`migrate dev`는 평범한(블로킹) `CREATE INDEX`를 생성한다.

## 7. 마이그레이션 (§8)

`prisma/migrations/20260910120000_apartment_trade_created_at_idx/migration.sql`

적용 전 검증:

- 문장 수: **1**
- `DROP` / `ALTER COLUMN` / `TRUNCATE` / `DELETE` / `UPDATE` / `RENAME` / `ALTER TABLE`: **0건**
- 테이블 재작성 없음, 무관한 인덱스 없음

## 8. Production 적용 결과 (§9)

| 항목 | 값 |
|---|---|
| 시작 | 2026-09-10T13:38:37Z |
| 종료 | 2026-09-10T13:38:54Z |
| 소요 | **17초** |
| 결과 | 성공 (exit 0) |
| 적용된 마이그레이션 | `20260910120000_apartment_trade_created_at_idx` 1건만 |
| 쓰기 경로 | `CONCURRENTLY`라 빌드 중 쓰기 차단 없음 |

인덱스 빌드가 필요로 하는 것 외의 데이터 쓰기는 하지 않았다.

## 9. 인덱스 검증 (§10)

```
name  : apartment_trade_histories_created_at_idx
table : apartment_trade_histories
valid : true    ready: true    unique: false
size  : 6072 kB
def   : CREATE INDEX ... USING btree (created_at)
```

`created_at` 인덱스 개수 = **1** (중복 없음).

## 10. 적용 후 실행계획 (§11)

| 관찰일 | 스캔 | Planning | **Execution** | Buffers |
|---|---|---|---|---|
| 2026-09-10 | **Index Scan** using `..._created_at_idx` | 33.8 ms | **3.014 ms** | hit **13** |
| 2026-08-29 | **Index Scan** using `..._created_at_idx` | 3.3 ms | **4,316 ms** | hit 5,951 read 2,099, temp r678/w683 |

Seq Scan → **Index Scan**. 정상일은 실행시간 7,497ms → 3.0ms, 버퍼 28,563 → **13**.

백필일이 여전히 4.3초인 이유는 스캔이 아니라 **집계**다 — 그날 실제로 189,951행이
매칭되고 `COUNT(DISTINCT)` / `array_agg(DISTINCT)`가 정렬을 위해 temp로 스필한다
(temp 수치가 적용 전후 동일한 678/683인 것이 근거). 인덱스가 고칠 수 있는 부분은
이미 다 고쳤다. 참고로 이 숫자는 `EXPLAIN ANALYZE`의 행별 계측 오버헤드가 포함된
값이며, 계측 없는 실제 실행은 아래처럼 훨씬 빠르다.

## 11. REPORT-5 재측정 (§12)

### 11.1 읽기 레이어 단계별 (warm)

| 관찰일 | 집계 | 가드 | 커버리지 | 확인 월 | `readDailyReport` 총합 |
|---|---|---|---|---|---|
| 2026-09-10 | 30.0 ms | 0.027 ms | 30.1 ms | 4 | **32 / 33 / 33 ms** |
| 2026-09-03 | 234.1 ms | 0.072 ms | 38.7 ms | 21 | **50 / 43 / 47 ms** |
| 2026-08-29 | 206.1 ms | 0.030 ms | 37.3 ms | 248 | **255 / 374 / 341 ms** |
| 2026-08-31 | 14.4 ms | 0.063 ms | 16.0 ms | 1 | **35 / 34 / 34 ms** |

### 11.2 route 총시간

| 관찰일 | 상태 | cold | warm | 이전(REPORT-6/7 측정) |
|---|---|---|---|---|
| 2026-09-10 | PREPARING | 408 ms | **52 / 52 / 56 ms** | 10,279 cold / 1,948~4,458 warm |
| 2026-09-03 | WITHHELD_BACKFILL | 88 ms | **64 / 71 / 71 ms** | ~1,000 ms warm |
| 2026-08-29 | WITHHELD_BACKFILL | 449 ms | **369 / 384 / 415 ms** | 12,118 cold / 3,247~5,337 warm |
| 2026-08-31 | READY_ZERO | 118 ms | **48 / 53 / 52 ms** | 2,152 cold / 1,784~1,962 warm |
| 2026-01-01 | OUTSIDE_SUPPORTED_RANGE | 47 ms | **60 / 47 / 48 ms** | 1,687~1,897 ms |

**warm 중앙값 ≈ 56 ms, warm 최악 415 ms.** 목표(warm ≤500ms / route ≤1s)를 모든
날짜에서 만족한다.

## 12. 결과 동일성 (§14/§15)

인덱스는 **속도만** 바꿔야 한다. 적용 전 REPORT-5 감사 때 기록한 값과 8개 날짜를
전수 비교했다 — raw / busan / valid / 계약월 수 / 최소 계약일 / 발행 상태 전부.

```
2026-08-28  MATCH   2026-08-29  MATCH   2026-08-30  MATCH   2026-08-31  MATCH
2026-09-03  MATCH   2026-09-05  MATCH   2026-09-09  MATCH   2026-09-10  MATCH
=== FULL PARITY ===
```

- 8/29 → `WITHHELD_BACKFILL` (계약월 248개, TOO_MANY_MONTHS) 유지
- 8/31 → `READY_ZERO` 유지. 스코프 밖 132건이 부산으로 새지 않음(raw 132 / busan 0)
- 9/3 → `WITHHELD_BACKFILL` 유지
- 9/5·9/9·9/10 → `PREPARING` 유지(202609 커버리지 미검증 상태 그대로)
- `trust.canceledExcluded = true` 유지
- KST 관찰창 `2026-08-30T15:00:00Z → 2026-08-31T15:00:00Z` 그대로

## 13. DB 영향 (§17)

| 항목 | 전 | 후 | 변화 |
|---|---|---|---|
| 테이블 총 크기 | 472 MB | 478 MB | **+6 MB** |
| 인덱스 합계 | 249 MB | 255 MB | +6 MB |
| 인덱스 개수 | 7 | 8 | +1 |

- 쓰기 경로: b-tree 인덱스 1개가 늘어난 만큼의 통상적인 삽입 비용만 추가된다.
  `created_at`은 `now()` 기본값이라 **단조 증가**이므로 삽입이 인덱스 오른쪽 끝에
  집중되어 분할 비용이 낮다.
- **sync 코드 변경은 필요 없다.** sync는 `created_at`을 `@default(now())`로 쓰기만 하고
  필터 조건으로 쓰지 않는다(확인함).

## 14. 검증 (§18)

- 리포트/단지 테스트 **132/132 통과**
- `prisma validate`: valid
- `npx tsc --noEmit`: **src 오류 0** (scripts 선행 오류 20건은 무관)
- ESLint(변경 소스): 오류 0
- `npm run build`: exit 0
- 리포트 엔진 스모크 9개 route 전부 200

## 15. 남은 한계

- **백필일(8/29·8/30)은 여전히 상대적으로 느리다**(warm 369~415ms). 원인은 스캔이
  아니라 그날 실제로 매칭되는 189,951행에 대한 `COUNT(DISTINCT)`/`array_agg(DISTINCT)`
  집계다. 목표 안에 들어오므로 이번 STEP에서 더 손대지 않는다.
- 이 날짜들은 어차피 `WITHHELD_BACKFILL`이라 사용자에게 숫자를 보여주지 않는다.
- 향후 `ingestRunId`/`ingestMode`가 생기면 백필 판정을 추정이 아닌 선언으로 바꿀 수
  있고 이 집계 자체가 불필요해진다 — **별도 승인 대상**이며 이번 범위가 아니다.

## 16. 최종 분류

| 항목 | 상태 |
|---|---|
| REPORT-5 | **READY** (기능 + 성능) |
| REPORT ENGINE V1 | **FULL READY** |
