# E-JIP OPS CANCEL COUNT INDEX IMPACT AUDIT V1

`/api/admin/ops` cold latency의 최대 병목인 취소 건수 count에 대해
`@@index([lawdCd, dealCanceled])`가 실제로 필요한지 근거로 판단한다.

- 감사: 2026-09-21 · 기준 커밋 `53ec103` · **READ ONLY**
- **CREATE INDEX 0 · DROP INDEX 0 · migration 0 · schema 0 · INSERT/UPDATE/DELETE 0**

## 판정

**INDEX_RECOMMENDED_NOW** — 단, **긴급하지 않다.** 증상(ops 500)은 이미 캐시+예산으로
해소됐고, 이것은 사고 수습이 아니라 최적화다. 서울 backfill을 기다릴 이유는 없다.

**그리고 제안 형태를 정정한다:** 처음에 더 낫다고 본 **부분 인덱스(partial index)는
쓸 수 없다.** 이유는 §9-b에 증거와 함께 적었다. STEP이 제안한 **복합 인덱스
`(lawd_cd, deal_canceled)`가 맞다.**

---

## 1. 정확히 어떤 쿼리인가

`src/app/api/admin/ops/route.ts:162`

```ts
prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, dealCanceled: true } })
```

**Prisma가 실제로 보내는 SQL**(query log로 캡처):

```sql
SELECT COUNT(*) FROM (
  SELECT "apartment_trade_histories"."id" FROM "apartment_trade_histories"
  WHERE ("lawd_cd" IN ($1,…,$16) AND "deal_canceled" = $17)
  OFFSET $18
) AS "sub"
-- params: [26110,…,26710, true, 0]
-- 이 캡처에서의 실행 시간: 8,161 ms
```

- WHERE: `lawd_cd IN (부산 16개)` **AND** `deal_canceled = true`
- COUNT(\*) · ORDER BY 없음 · GROUP BY 없음
- **`deal_canceled`를 DB 필터로 쓰는 운영 쿼리는 전 저장소에서 이것 하나뿐이다.**
  나머지(`region-read.ts`, `apt-read.ts`, `compare-read.ts`, `trade-history-read.ts`)는
  전부 `dealCanceled: false`이고, 앞단의 `aptSeq`/`identityKey`/`lawd_cd+deal_date`로
  이미 좁혀진 뒤라 이 인덱스와 무관하다.

## 2. 현재 인덱스 (실제 DB 기준, Prisma schema 아님)

| 인덱스 | 정의 | 크기 | 누적 scans |
|---|---|---|---|
| `…_group_key_deal_amount_deal_date_f_key` | UNIQUE (group_key, deal_amount, deal_date, floor, occurrence_index) | 79 MB | 1,216,262 |
| `…_apt_seq_exclusive_area_deal_date_idx` | (apt_seq, exclusive_area, deal_date) | 52 MB | 7,603 |
| `…_identity_key_deal_date_idx` | (identity_key, deal_date) | 44 MB | 8,189 |
| `…_lawd_cd_exclusive_area_deal_date_idx` | (lawd_cd, exclusive_area, deal_date) | 34 MB | 2,065 |
| `…_pkey` | (id) | 21 MB | 26,836 |
| `…_lawd_cd_deal_date_idx` | (lawd_cd, deal_date) | 12 MB | 79,727 |
| `…_deal_date_idx` | (deal_date) | 8,160 kB | 22,952 |
| `…_created_at_idx` | (created_at) | 6,088 kB | 411 |

**`deal_canceled`를 포함한 인덱스는 하나도 없다.** 중복 제안이 아니다.

## 3~4. 쿼리 플랜 — 왜 1.2~10초인가

`EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` 실측(READ ONLY):

```
Finalize Aggregate  (actual time=995.453..1203.288 rows=1)
  Buffers: shared hit=25321 read=3303
  -> Gather (Workers Launched: 1)
      -> Partial Aggregate
          -> Parallel Seq Scan on apartment_trade_histories
                (cost=0.04..36270.21 rows=2362) (actual time=25.445..804.502 rows=8157 loops=2)
             Filter: (deal_canceled AND (lawd_cd = ANY ('{26110,…,26710}')))
             Rows Removed by Filter: 425026
Planning Time: 13.802 ms
Execution Time: 1209.946 ms
```

**Scan type: Parallel Seq Scan.** 224 MB heap 전체를 훑어 **850,052행을 버리고** 16,314행을
찾는다. 같은 스크립트 실행 중 첫 회는 `Execution Time 5,675 ms`였고, 실제 Prisma 호출은
**8,161 ms**였다 — 이전 STEP에서 보고한 1.2~10초 범위가 그대로 재현된다.

**왜 인덱스를 못 쓰나:** `(lawd_cd, deal_date)`는 `lawd_cd`로 seek할 수 있지만
`deal_canceled`가 없어 **행마다 heap을 다시 읽어** 조건을 확인해야 한다. 부산이 테이블의
99.88%라 그건 seq scan보다 비싸다. 플래너의 선택이 옳다.

**대조군** — 같은 조건에서 `deal_canceled`만 뺐을 때:

```
Parallel Index Only Scan using apartment_trade_histories_lawd_cd_deal_date_idx
  Index Cond: (lawd_cd = ANY (…))     rows=432646 loops=2
  Heap Fetches: 295518
Execution Time: 393.791 ms
```

조건 하나 차이로 **Seq Scan ↔ Index Only Scan**이 갈린다. 이것이 인덱스가 없다는 증거다.

## 4. 데이터 분포 / selectivity

| 항목 | 행 수 | 비율 |
|---|---|---|
| total | 866,366 | 100% |
| 부산 16개 구·군 | 865,291 | **99.88%** |
| 부산 밖 | 1,075 | 0.12% |
| **`deal_canceled = true`** | **16,372** | **1.89%** |
| 부산 ∧ 취소 | 16,314 | 1.88% |

`distinct lawd_cd = 19`, `pg_stats`: `lawd_cd` n_distinct=17, `deal_canceled` n_distinct=2.

구·군별 상위: 26350 130,635(취소 2,343) · 26230 100,731(2,036) · 26320 89,466(1,321) …
비부산은 11140(서울 중구) 943 · 27110 86 · 11680 46.

**`deal_canceled`가 선택도 전부를 갖는다(1.89%). `lawd_cd`는 지금 선택도가 사실상 없다(99.88%).**

## 8~9. 제안 인덱스와 컬럼 순서

### 제안: `@@index([lawdCd, dealCanceled])` → `(lawd_cd, deal_canceled)`

`lawd_cd IN (16) AND deal_canceled = true`에 대해 B-tree가 **16번의 범위 seek**을 수행해
각각 `(코드, true)` 지점에 바로 내려간다 — 읽는 엔트리 ≈ 16,314개.

### 순서 근거 — `(deal_canceled, lawd_cd)`와 비교

이 쿼리만 보면 **둘 다 효율이 같다**(각각 ~16.3k 엔트리). 갈림길은 다른 데 있다:

| 기준 | `(lawd_cd, deal_canceled)` | `(deal_canceled, lawd_cd)` |
|---|---|---|
| 이 쿼리 | ~16,314 엔트리 seek | ~16,372 엔트리 seek |
| 서울 backfill 이후 | **`lawd_cd`가 선택적이 되어 더 유리** | 선두 컬럼은 계속 2값 |
| 선두 컬럼 카디널리티 | 17 | **2** (B-tree 선두로 비권장) |
| 기존 컨벤션 | `(lawd_cd, deal_date)`·`(lawd_cd, exclusive_area, deal_date)`와 **일치** | 불일치 |
| prefix 재사용 | `lawd_cd` 단독 조회에도 쓰임 | 불가 |

→ **`(lawd_cd, deal_canceled)`가 맞다.** STEP의 제안 그대로다.

### 9-b. 부분 인덱스는 왜 안 되는가 (내가 처음 더 낫다고 본 안)

크기만 보면 `CREATE INDEX … (lawd_cd) WHERE deal_canceled`가 압도적이다 —
16,372 엔트리면 **~0.3 MB**, 복합의 1/40이고 일반 INSERT(`deal_canceled=false`)는
아예 인덱스를 건드리지 않는다.

**그런데 Prisma가 `deal_canceled = $17`을 바인드 파라미터로 보낸다**(§1 캡처).
Postgres가 부분 인덱스를 쓰려면 **계획 시점에** 인덱스 술어가 쿼리 술어에 함의됨을
증명해야 하는데, generic plan에서는 `$17`의 값을 모르므로 증명할 수 없다.
custom plan이면 가능하지만 `plan_cache_mode=auto`에서 어느 쪽이 선택될지는 보장되지 않는다.

**즉 부분 인덱스는 "될 때도 있고 안 될 때도 있는" 인덱스다.** 운영 지표를 그런 것에
걸지 않는다. 복합 인덱스는 파라미터와 무관하게 동작한다.

## 5. 크기 추정

기존 인덱스의 실측 밀도가 추정 근거다:

| 기존 인덱스 | 크기 | 엔트리당 |
|---|---|---|
| `(lawd_cd, deal_date)` — text + date | 12,451,840 B | **14.37 B** |
| `(deal_date)` — date 단독 | 8,355,840 B | 9.64 B |

`(lawd_cd, deal_canceled)`는 text(5) + bool(1)로 `(lawd_cd, deal_date)`보다 컬럼 폭이
작다 → 엔트리당 13~14.4 B로 보면:

**ESTIMATE: 866,366 × 13~14.4 B ≈ 11.3 ~ 12.5 MB**

### 11. 디스크 여유

| 항목 | 값 |
|---|---|
| 테이블 heap | 224 MB |
| 인덱스 합계 | 255 MB |
| 테이블 total | 479 MB |
| **DB 전체** | **716 MB** |
| 신규 인덱스 | **+11~12.5 MB (DB의 약 +1.7%)** |

> **확인하지 못한 것:** Supabase 플랜의 디스크 한도는 DB 안에서 읽을 수 없다.
> 현재 716 MB이므로 Free(500 MB)는 아니지만, **남은 여유는 Supabase 대시보드에서
> 확인해 주셔야 한다.** 증가분 자체는 1.7%로 작다.

## 6. Write amplification — **LOW**

`pg_stat_user_tables` 실측: 누적 INSERT 866,452 · UPDATE 100,634 · DELETE 0.

최근 10일 INSERT(KST): 09-20 **945** · 09-18 104 · 09-17 89 · 09-16 108 · 09-15 109 ·
09-14 190 · 09-13 9 · 09-12 4 · 09-11 106 — **하루 수십~수백 건**.

| 쓰기 경로 | 영향 |
|---|---|
| SALE cron INSERT (일 ~100~950건) | 인덱스 1개 추가 = 엔트리 1개 삽입. 무시 가능 |
| 서울 backfill INSERT | §7 참조 |
| cancellation UPDATE (false→true) | `deal_canceled`가 인덱스에 포함되므로 **이 UPDATE는 HOT이 아니게 된다.** 다만 전체 이력에서 16,372건뿐이고 일 단위로는 한 자릿수~수십 건 |
| `source_fetched_at`/`updated_at` UPDATE | 인덱스 컬럼이 아니므로 **HOT 유지** — 영향 없음 |

**판정: LOW.** 현재 쓰기량 기준으로 체감 불가 수준이다.

## 7. 서울 backfill과의 상호작용

현재 상태: 서울 Phase A는 **QUOTA_BLOCKED**(중구 기준 잔여 16,880행 삽입 예정, MOLIT
쿼터 때문에 중단). 전국 확장까지 가면 수십만 행 규모가 된다.

| 시점 | 총 작업량 | 운영 안정성 |
|---|---|---|
| **A. backfill 전(지금)** | 866k 빌드 + 이후 삽입분 증분 유지 | 지금 0 active session, 쓰기 창이 비어 있어 가장 조용하다 |
| B. Phase A/B 후 | 거의 동일(증분 유지 비용 ≈ 빌드 차이) | Phase A가 **언제 풀릴지 모른다** |
| C. 서울 전체 후 | 한 번에 더 큰 빌드 | 가장 오래 기다림 |

**핵심:** 서울 backfill의 병목은 **MOLIT API 쿼터**이지 DB 삽입 속도가 아니다.
인덱스 1개가 늘어도 backfill 소요 시간은 실질적으로 바뀌지 않는다.
그리고 **B는 무기한 대기**다 — 막혀 있는 작업을 기다릴 이유가 없다.

→ **A(지금)를 권한다.** 대량 INSERT 중 인덱스 유지 비용은 이 규모에서 유의미하지 않다.

## 8. 온라인 생성 안전성

환경: **PostgreSQL 17.6** · `transaction_read_only = off` · **활성 세션 0** ·
설치된 확장: `pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp`.

| 방식 | lock | write 차단 | 트랜잭션 | 실패 시 |
|---|---|---|---|---|
| `CREATE INDEX` | `SHARE` | **차단**(SELECT는 통과) | 가능 | 자동 롤백, 잔여물 없음 |
| `CREATE INDEX CONCURRENTLY` | `SHARE UPDATE EXCLUSIVE` | 차단 없음 | **불가**(트랜잭션 블록 안에서 실행 불가) | **INVALID 인덱스가 남아 수동 `DROP INDEX` 필요** |

**Prisma 제약:** Prisma Migrate는 마이그레이션 파일을 **트랜잭션으로 감싼다** → `CIC`는
그대로는 실패한다. 쓰려면 `migrate diff`/`--create-only`로 SQL만 만들고 psql로 직접 실행한 뒤
`prisma migrate resolve --applied`로 표시하는 절차가 필요하다.

**커넥션:** `DATABASE_URL`은 `…pooler.supabase.com:5432`(**session mode**)라 CIC가 가능하다
(transaction mode 6543이면 불가). `DIRECT_URL`은 현재 미설정이다.

**쓰기 창:** cron은 19:00 / 21:00 / 23:00 UTC(= 04:00 / 06:00 / 08:00 KST)뿐이다.
**KST 주간에는 이 테이블에 쓰는 주체가 사실상 없다**(측정 시 활성 세션 0).

→ **권장: cron 창 밖(KST 주간)에 평범한 `CREATE INDEX`.** 224 MB / 866k행이라
빌드는 수 초~수십 초로 예상되고, 그 동안 막히는 쓰기가 사실상 없다. 절차도 단순하고
실패 시 잔여물이 없다. 무중단이 꼭 필요하면 CIC가 가능하지만 위의 Prisma 우회 절차가 붙는다.

## 9. 예상 성능 — **ESTIMATE (시뮬레이션 불가)**

**시뮬레이션을 시도했고 할 수 없었다.** `hypopg`는 `pg_available_extensions`에는 있지만
**설치돼 있지 않고**, `CREATE EXTENSION`은 schema 변경이라 이번 STEP에서 금지다.
따라서 아래는 **추정치**이며 실측이 아니다.

| 항목 | 현재(실측) | 인덱스 후(ESTIMATE) |
|---|---|---|
| 쿼리 scan | Parallel Seq Scan, 866,366행 | Index Scan, **~16,314 엔트리** |
| 쿼리 warm | **1,210 ms** | **~20 ~ 120 ms** |
| 쿼리 cold | **5,676 ms** · Prisma 실호출 **8,161 ms** | ~100 ~ 400 ms |

추정 근거: §3의 대조군이 **865,291 엔트리 index-only scan = 394 ms**(heap fetch 295,518
포함)였다. 대상 엔트리가 **53배 적으므로** 같은 자릿수 이하로 떨어진다고 보는 것이 자연스럽다.

**ops cold latency에 대한 정직한 한계:**
현재 ops cold는 4.2~15.4초이고, 취소 count는 **이미 4초 예산으로 상한이 걸려 있다.**
따라서 이 인덱스가 없앨 수 있는 것은 **최대 ~4초**다. 나머지 8개 지표만으로도 콜드에서
1.8~7초가 나왔으므로 — **이 변경 하나로 §10의 cold ≤3s 목표가 달성된다고 약속할 수 없다.**
"최대 병목 하나를 제거한다"까지가 근거가 뒷받침하는 표현이다.

## 10. 인덱스 없는 대안 비교

| 대안 | 정확성 | 복잡도 | 운영비 | schema 영향 | 현재 상태 |
|---|---|---|---|---|---|
| **전용 캐시(30분) + 4초 예산** | 정확, 최대 30분 stale | 낮음 | 0 | **0** | **이미 배포됨** — ops 500을 실제로 없앤 것이 이것이다 |
| 사전계산 health 테이블 | 정확, 갱신 지연 | 높음(테이블 + 갱신 job) | 중 | **필요** | 미도입 |
| 근사 count(`reltuples`) | **불가** — `lawd_cd`+`deal_canceled` 필터를 표현할 수 없다 | — | — | — | 해당 없음 |
| Materialized view | 정확, REFRESH 필요 | 중 | 중(REFRESH가 결국 같은 seq scan) | **필요** | 미도입 |
| `VACUUM ANALYZE` | — | 낮음 | 0 | 0 | §아래 별건 |

**대안들이 이미 증상을 덮고 있다는 점이 이 감사의 핵심이다.** 인덱스는 "500을 고치는 수단"이
아니라 "남은 비용을 실제로 없애는 수단"이다.

### 별건: VACUUM이 밀려 있다 (schema 변경 아님)

| 항목 | 값 |
|---|---|
| `last_autovacuum` | **2026-08-29** (23일 전) |
| `last_analyze` | 2026-09-01 (20일 전) |
| `n_dead_tup` | **53,081** |
| `vacuum_count` (수동) | 0 |

§3 대조군의 `Heap Fetches: 295518`이 이것의 직접적 결과다 — visibility map이 오래돼
index-only scan이 heap을 다시 읽고 있다. 또 플래너가 이 쿼리의 행 수를 `rows=2362`로
잡았는데 실제는 16,314였다(**약 7배 과소추정**) — 통계가 낡았다는 신호다.

`VACUUM (ANALYZE)`는 **이 쿼리의 플랜을 바꾸지 못한다**(인덱스가 없으니 여전히 seq scan).
그러나 `(lawd_cd, deal_date)`를 쓰는 **기존 조회들**은 즉시 빨라진다. 인덱스와 별개로
권한다. 단, VACUUM은 heap/VM을 수정하므로 **이번 READ-ONLY STEP에서는 실행하지 않았다.**

## 12. No-write assertion

| 항목 | 값 |
|---|---|
| CREATE INDEX / DROP INDEX | **0 / 0** |
| migration · schema change · CREATE EXTENSION | **0 · 0 · 0** |
| INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| VACUUM / ANALYZE 실행 | **0** |
| 서울·부산 데이터 변경 | **0** |

실행한 것은 `SELECT`와 `EXPLAIN (ANALYZE)`(대상은 전부 SELECT)뿐이다.
스크립트는 `DIAGNOSTIC` 가드(`ALLOW_PROD_DB_READ`)를 거친다.

## 19. 최종 권고

**INDEX_RECOMMENDED_NOW** — 다만 **P2 우선순위**다.

승인해 주시면 다음 순서로 진행하겠습니다(각 단계 전에 다시 보고):

1. `prisma/schema.prisma`에 `@@index([lawdCd, dealCanceled])` 추가 + `migrate diff`로
   SQL만 생성(`--create-only`), **적용 없이** 먼저 보여드림
2. cron 창 밖(KST 주간)에 평범한 `CREATE INDEX` 적용 · 소요 시간 기록
3. 적용 직후 같은 `EXPLAIN (ANALYZE)`를 다시 돌려 **추정이 맞았는지 실측으로 확인**
   (틀렸으면 틀렸다고 보고)
4. ops cold latency 재측정 — ≤3s 달성 여부를 과장 없이 보고
5. 되돌리기: `DROP INDEX` 한 줄. 데이터 손실 없음

**함께 권하는 것(인덱스와 무관, 승인 시):** `VACUUM (ANALYZE) apartment_trade_histories`.
dead 53,081 정리 + 통계 갱신 + visibility map 갱신으로 **기존** 조회들이 즉시 개선된다.

**하지 않기를 권하는 것:** 부분 인덱스(§9-b — Prisma의 바인드 파라미터 때문에 신뢰 불가),
materialized view / 사전계산 테이블(schema 비용 대비 이득 없음 — 이미 캐시가 같은 일을 한다).
