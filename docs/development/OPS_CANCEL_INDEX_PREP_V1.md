# E-JIP OPS CANCEL INDEX PREP V1

`@@index([lawdCd, dealCanceled])`를 schema와 migration SQL까지만 준비한다.
**Production 적용은 하지 않는다.**

- 준비: 2026-09-21 · 기준 커밋 `485e1bf`
- 근거 감사: `docs/development/OPS_CANCEL_COUNT_INDEX_IMPACT_AUDIT_V1.md`
- **CREATE INDEX 0 · migrate deploy 0 · db push 0 · DML 0** (§10 증거 포함)

## 판정

**READY_FOR_APPROVAL** — schema 1줄 + migration 파일 1개. 승인 시 명령 한 줄로 적용된다.

---

## 1. Schema diff

`prisma/schema.prisma` **+16줄 / -0줄**, 전부 `ApartmentTradeHistory` 모델 안.
그중 **실제 지시문은 한 줄**이고 나머지 15줄은 근거 주석이다.

```prisma
  @@index([createdAt])
+ // OPS_CANCEL_COUNT_INDEX_IMPACT_AUDIT_V1 — …(근거 주석 15줄)
+ @@index([lawdCd, dealCanceled])
  @@map("apartment_trade_histories")
```

모델·필드·타입·관계 변경 **0**. `src/` 변경 **0** — business logic 변화 없음.

**중복 확인:** 기존 8개 인덱스 중 `deal_canceled`를 포함한 것은 하나도 없다(운영 DB 실측).

## 2. Index name

```
apartment_trade_histories_lawd_cd_deal_canceled_idx
```

`prisma migrate diff`가 스스로 생성한 이름이며, 기존 컨벤션과 정확히 일치한다:

| 기존 | 패턴 |
|---|---|
| `apartment_trade_histories_lawd_cd_deal_date_idx` | `<table>_<col…>_idx` |
| `apartment_trade_histories_created_at_idx` | 〃 |
| `apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx` | 〃 |

## 3. 생성된 SQL

**오프라인 diff**(DB 접속 없음 — `--from-schema-datamodel … --to-schema-datamodel …`)가
낸 결과는 정확히 한 줄이다:

```sql
-- CreateIndex
CREATE INDEX "apartment_trade_histories_lawd_cd_deal_canceled_idx" ON "apartment_trade_histories"("lawd_cd", "deal_canceled");
```

### 커밋한 migration 파일은 여기에 `CONCURRENTLY IF NOT EXISTS`를 더한다

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "apartment_trade_histories_lawd_cd_deal_canceled_idx" ON "apartment_trade_histories"("lawd_cd", "deal_canceled");
```

**의도적인 차이이고, 이 저장소의 기존 관례다.** 결과로 만들어지는 인덱스 객체는 동일하다
(이름·컬럼·순서 모두 같음) — 잠금 방식과 재실행 안전성만 다르다.

## 4. 금지 DDL 검사 (§3)

주석을 제외한 실행문을 추출해 검사:

| 검사 | 결과 |
|---|---|
| 실행 문장 수 | **1** |
| `CREATE INDEX` | 1 |
| `DROP` / `ALTER TABLE` / `TRUNCATE` | **0** |
| `INSERT` / `UPDATE` / `DELETE` | **0** |
| `GRANT` / `REVOKE` | **0** |

## 5. Migration 파일

```
prisma/migrations/20260921090000_apartment_trade_lawd_cd_deal_canceled_idx/migration.sql
```

타임스탬프·네이밍은 직전 인덱스 마이그레이션(`20260910120000_apartment_trade_created_at_idx`)
관례를 그대로 따랐다. 파일에는 EXPLAIN 실측치, 컬럼 순서 근거, 부분 인덱스를 쓰지 않는 이유,
CONCURRENTLY 사용 이유, 실패 시 정리 명령이 주석으로 함께 들어 있다.

## 6. 적용 방식 권고 — **`CREATE INDEX CONCURRENTLY`**

> **직전 감사(§8)에서 "평범한 `CREATE INDEX`"를 권했는데, 정정한다.**
> 그때 나는 "Prisma Migrate가 마이그레이션을 트랜잭션으로 감싸므로 CONCURRENTLY는
> 우회 절차가 필요하다"고 적었다. **이 저장소에서는 틀린 말이다.** 저장소를 보니
> CONCURRENTLY 마이그레이션이 **이미 두 번 Production에 적용돼 있었다**:
>
> - `20260901084417_area84_lawd_exclusive_deal_date_idx`
> - `20260910120000_apartment_trade_created_at_idx`
>
> 두 파일 모두 "Prisma Migrate는 CONCURRENTLY를 감지하면 이 마이그레이션을 트랜잭션
> 밖에서 실행한다"고 적고 있고, 운영 DB에서 두 인덱스 모두 **valid 상태**로 확인된다.
> 일반화된 제약을 이 저장소의 실제 선례보다 앞세운 것이 잘못이었다.

| 방식 | lock | write 차단 | 우리 상황 |
|---|---|---|---|
| `CREATE INDEX` | `SHARE` | 빌드 내내 **차단** | 불필요한 위험 |
| **`CREATE INDEX CONCURRENTLY`** | `SHARE UPDATE EXCLUSIVE` | **차단 없음** | **선례 2건, 권고** |

`IF NOT EXISTS`를 함께 써 재실행해도 안전하다.

### 7. Lock risk 평가 — **LOW**

| 근거 | 값 |
|---|---|
| 쓰기 차단 | **없음**(CONCURRENTLY) |
| 테이블 크기 | heap 224 MB / 866,366행 |
| 빌드 시간 ESTIMATE | 수십 초 (CONCURRENTLY는 2-pass라 일반보다 느리다) |
| 동시 쓰기 주체 | cron 3개뿐 — **19:00 / 21:00 / 23:00 UTC = 04:00 / 06:00 / 08:00 KST** |
| 측정 시 활성 세션 | **0** |
| 권장 적용 창 | **KST 주간(예: 10:00~18:00 KST)** — cron 창 밖 |

**실패 모드:** CONCURRENTLY 빌드가 실패하면 **INVALID 인덱스가 남는다**(자동 롤백 없음).
현재 운영 DB의 INVALID 인덱스는 **0개**이므로, 적용 후 같은 쿼리로 다시 확인하면 된다.

## 8. Rollback SQL (실행하지 않음)

```sql
-- 정상 롤백 (쓰기를 막지 않는다)
DROP INDEX CONCURRENTLY IF EXISTS "apartment_trade_histories_lawd_cd_deal_canceled_idx";
```

```sql
-- CONCURRENTLY 빌드 실패로 INVALID 인덱스가 남았을 때의 정리 (같은 명령)
DROP INDEX CONCURRENTLY IF EXISTS "apartment_trade_histories_lawd_cd_deal_canceled_idx";
```

**데이터 손실 없음** — 인덱스는 파생 구조라 삭제해도 행이 바뀌지 않는다.
schema 롤백은 `@@index([lawdCd, dealCanceled])` 한 줄 제거 + `prisma generate`.

INVALID 여부 확인 쿼리(읽기 전용):

```sql
SELECT c.relname, i.indisvalid FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'apartment_trade_histories_lawd_cd_deal_canceled_idx';
```

## 9. Validation

| 항목 | 결과 |
|---|---|
| `npx prisma validate` | **valid** |
| `npx prisma generate` | **성공**(v5.22.0) |
| `npx tsc --noEmit` | **src 오류 0** |
| `npx tsx --test "src/**/*.test.ts"` | **1,944 pass / 0 fail** |
| `npm run build` | **✓ Compiled successfully** |
| business logic 변화 | **0** — `src/` 변경 파일 없음 |

## 10. Production write assertion — 실측 증거

배포 파이프라인 확인: `package.json`의 `build`는 `next build`, `postinstall`은
`prisma generate`뿐이다. `vercel.json`에도 `buildCommand` 오버라이드가 없다.
**즉 커밋·푸시해도 마이그레이션이 자동 적용되지 않는다.**

작업 후 운영 DB 실측:

```
Production 인덱스 8개:  (기존 그대로 — 아래 목록에 제안 인덱스 없음)
  …_apt_seq_exclusive_area_deal_date_idx / …_created_at_idx / …_deal_date_idx
  …_group_key_deal_amount_deal_date_f_key / …_identity_key_deal_date_idx
  …_lawd_cd_deal_date_idx / …_lawd_cd_exclusive_area_deal_date_idx / …_pkey

>>> 제안 인덱스 존재 여부: 없음 — 적용되지 않았음 (의도대로)
INVALID 인덱스: 없음
최근 적용 migration: 20260916090000_user_feedback_v1 (2026-09-15T14:48:09Z) — 변화 없음
```

| 항목 | 값 |
|---|---|
| CREATE INDEX | **0** |
| DROP INDEX | **0** |
| `migrate deploy` / `db push` | **0 / 0** |
| DML (INSERT/UPDATE/DELETE) | **0** |
| `_prisma_migrations` 변화 | **0** |

이번 STEP에서 운영 DB에 보낸 것은 `SELECT`뿐이다(`DIAGNOSTIC` 가드 경유).

## 12. 승인 후 실제로 쓸 명령

```bash
# 0) 적용 창 확인 — cron(04/06/08시 KST) 밖인지, 활성 세션이 한가한지
#    (읽기 전용)
ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ops-cancel-index-impact.ts   # baseline 재측정

# 1) 적용 — 이 한 줄이 전부다
npx prisma migrate deploy

# 2) 인덱스가 valid로 붙었는지 확인 (읽기 전용)
#    indisvalid = true 여야 한다. false면 §8의 DROP INDEX CONCURRENTLY로 정리.
ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ops-cancel-index-impact.ts

# 3) 효과 실측 — 추정(1,210ms → ~20~120ms)이 맞았는지 같은 EXPLAIN으로 확인
#    (위 스크립트가 EXPLAIN ANALYZE를 포함한다)

# 4) ops cold latency 재측정 후 보고
```

`migrate deploy`는 **아직 적용되지 않은 마이그레이션만** 실행한다. 현재 미적용은
이번에 만든 1건뿐이므로 `CREATE INDEX CONCURRENTLY` 한 문장만 돌아간다.

> **적용 전에 다시 확인하겠습니다.** 승인해 주시면 위 0→4를 순서대로 진행하고,
> 각 단계 결과(특히 3의 실측치가 추정과 다르면 다르다고) 그대로 보고하겠습니다.

## 남은 주의

1. **효과는 여전히 ESTIMATE다.** `hypopg` 미설치로 플랜 시뮬레이션을 못 했다.
   적용 후 §12-3에서 실측해야 확정된다.
2. **이 인덱스만으로 ops cold ≤3s는 보장되지 않는다.** 취소 count는 이미 4초 예산으로
   상한이 걸려 있어 줄일 수 있는 건 최대 ~4초이고, 나머지 8개 지표만으로도
   콜드 1.8~7초가 나온다.
3. **VACUUM이 23일 밀려 있다**(last_autovacuum 2026-08-29, dead 53,081).
   이 인덱스와 별개이며 기존 index-only scan의 heap fetch를 줄인다 — 별도 승인 항목.
