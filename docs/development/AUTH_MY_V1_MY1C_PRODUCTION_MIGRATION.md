# AUTH/MY V1 — MY-1C: PRODUCTION MIGRATION APPLY + VERIFICATION

## 1. Branch / Source Commit
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `14972ed chore(auth): finalize my v1 production migration gate` (= `origin/feature/auth-my-v1`)
- Working tree clean (untracked `prisma/schema_old.prisma`만 존재, MY-1B.1 이후 발생한 무관 파일, 이번 STEP에서 다루지 않음)

## 2. User Approval
- 사용자가 "PRODUCTION MIGRATION APPLY 승인 완료"를 명시.
- 그러나 아래 4번 항목에서 read-only 사전 점검(`prisma migrate status`) 자체가 **실행 불가** 상태로 확인되어, GO 조건(6번, 항목 D)을 충족하지 못함. 승인이 있어도 안전 조건 미충족 시 배포하지 않는다는 절대 원칙에 따라 **`prisma migrate deploy`를 실행하지 않고 STOP**함.

## 3. Production DB Identity Confirmation Method
- `.env`의 `DATABASE_URL` 파싱 결과(secret 미노출):
  - host: `aws-0-ap-northeast-2.pooler.supabase.com`
  - port: `5432`
  - database: `postgres`
  - user: `postgres.ztlnagzmwksgjkappfyh`
- `.env.local`에는 `DATABASE_URL`이 정의되어 있지 않음(override 없음) — 즉 `.env`의 값이 그대로 사용됨.
- `NEXTAUTH_URL=http://localhost:3000` (secret 아님) — 로컬 개발 서버가 원격 Supabase(Seoul) production DB를 그대로 바라보는 구조. 별도 staging/dev DB 없음.
- **PRODUCTION_TARGET_CONFIRMED = YES** (localhost/dev DB 아님, Seoul Supabase pooler 확인)

## 4. Pre-migration Status — BLOCKED
```
npx prisma migrate status
```
결과:
```
Datasource "db": PostgreSQL database "postgres", schema "public" at "aws-0-ap-northeast-2.pooler.supabase.com:5432"
Error: Error in Schema engine.
Reason: Error reading datamodel file `prisma\schema.prisma`: stream did not contain valid UTF-8
```

**Root cause 확인**: `prisma/schema.prisma`의 **1077번째 줄** 단 한 줄이 UTF-8이 아닌 CP949(EUC-KR)로 인코딩되어 있음.
```
1076: // ────────────────────────────────────────────
1077: // AUTH/MY V1 - 사용자 계정 개인 데이터   (CP949로 저장되어 깨짐)
1078: // ────────────────────────────────────────────
1080: model Favorite {
```
- MY-1B 단계에서 Favorite/RecentView/UserPreference 모델 앞에 추가된 섹션 배너 주석으로, 모델 정의/컬럼/타입에는 영향 없음(순수 주석 1줄).
- `npx prisma validate` / `npx prisma generate`(Node.js 기반 파서, lossy decode 허용)는 이 파일로 이미 여러 차례 PASS했으나, `npx prisma migrate status` / `migrate deploy`가 사용하는 Rust **schema-engine 바이너리는 strict UTF-8**을 요구하여 즉시 실패함.
- 즉 **이 상태로는 `prisma migrate deploy`도 100% 동일한 이유로 실패**할 것으로 판단됨(같은 schema-engine 바이너리 사용).
- 이 명령은 **DB 연결 이전(로컬 파일 파싱 단계)에서 실패**했으므로 Production DB에 어떠한 접속/조회/쓰기도 발생하지 않음.

## 5. Pending Migrations Before Deploy
- **확인 불가** (status 조회 자체가 실패). 따라서 "예상하지 못한 pending migration 없음"을 증명할 수 없는 상태.

## 6. Unexpected Pending Migration
- N/A — 판정 불가로 처리.

## 7. Deploy Command
- **실행하지 않음.**

## 8. Deploy Result
- **NOT_RUN**

## 9–16. Post-migration 검증 항목
- 모두 **N/A** — deploy를 실행하지 않았으므로 신규 테이블/row count/기존 auth row count/FK 등 사후 검증 대상이 없음.

## 17. Failure/Rollback Policy
- 이번 STEP은 "실패"가 아니라 **사전 안전 점검 단계에서의 STOP**이며, DB에 아무 것도 적용되지 않았으므로 rollback 대상 자체가 없음.
- 절대 금지 목록(`migrate reset`, `db push`, 수동 DROP, migration history 수동 수정, SQL 임의 수정 후 재실행)은 전부 미실행.

## 최종 판단 (Final Verdict)
- **원인은 명확하고 국소적**(주석 1줄, CP949 인코딩)이며 수정 자체는 모델/컬럼/제약조건에 영향을 주지 않는 저위험 변경으로 판단됨.
- 다만 이는 이번 STEP이 다루기로 한 "검증된 migration artifact를 prisma migrate deploy로 적용" 범위를 벗어나는 **schema.prisma 소스 수정**이므로, PM 승인 없이 임의로 고치고 곧바로 재시도하지 않고 STOP 상태로 보고함.
- **권장 조치**: `prisma/schema.prisma` 1077번째 줄의 주석을 UTF-8로 재저장(내용은 "AUTH/MY V1 - 사용자 계정 개인 데이터" 동일, 인코딩만 수정) 후 `prisma migrate status`를 재실행하여 GO 조건 D(healthy)를 다시 확인하고, 그 결과가 깨끗할 때만 `prisma migrate deploy`를 진행.

---

## 상태 요약

```
PRODUCTION_TARGET_CONFIRMED       = YES
UNEXPECTED_PENDING_MIGRATIONS     = UNKNOWN (status check failed before DB read)
MIGRATION_DEPLOY                  = NOT_RUN
NEW_TABLES_CREATED                = NO
NEW_TABLE_ROWS                    = N/A
EXISTING_AUTH_DATA_UNCHANGED      = YES (no DB write attempted)
PRODUCTION_DB_MIGRATION           = BLOCKED
MY1C_STATUS                       = BLOCKED
NEXT_STEP                         = FIX schema.prisma 1077 line encoding (CP949→UTF-8, comment-only), then retry MY-1C from step 4
```

---

# MY-1C.1 — UTF-8 SCHEMA REPAIR + MIGRATION RETRY (완료)

## Encoding Blocker
- 위 4번 항목에서 확인된 그대로: `prisma/schema.prisma` 1077번째 줄(주석 1줄)이 CP949로 저장되어 Rust schema-engine이 파일 전체를 invalid UTF-8로 거부.

## UTF-8 Repair
- Python으로 파일을 바이트 단위로 읽어, 1077번째 줄(`\n` split 기준 0-indexed 1076)만 CP949로 디코드 → UTF-8로 재인코드하여 그 줄만 교체. 나머지 바이트는 전혀 건드리지 않음.
- 복구된 텍스트: `// AUTH/MY V1 - 사용자 계정 개인 데이터` (기존과 완전히 동일한 문구, 인코딩만 변경).
- BOM 없음 확인(`xxd` 첫 바이트가 `67 65 6e 65...` = `gene...`, EF BB BF 아님) — 저장소 내 다른 `.prisma`/`.ts` 파일과 동일하게 UTF-8 without BOM 컨벤션 유지.
- `git diff prisma/schema.prisma` 결과: **정확히 1줄만 변경**(`1 file changed, 1 insertion(+), 1 deletion(-)`), 그 외 whitespace/line-ending/model 순서/내용 변화 없음.

## Semantic Schema Diff
- 변경 전/후 `git diff` 확인 결과 모델/컬럼/relation/constraint 어디에도 변화 없음 — 순수 comment 인코딩 수정.
- **SCHEMA_SEMANTIC_CHANGE = NONE**

## Prisma Validate / Generate (재실행)
- `npx prisma validate` → `The schema at prisma\schema.prisma is valid 🚀` **PASS**
- `npx prisma generate` → `Generated Prisma Client (v5.22.0)` **PASS**

## Migration Status (배포 전, 재실행)
```
npx prisma migrate status
```
```
Datasource "db": ... at "aws-0-ap-northeast-2.pooler.supabase.com:5432"
7 migrations found in prisma/migrations
Following migration have not yet been applied:
20260824154230_add_my_v1_account_data
```
- DB 연결 정상, failed/diverged migration 없음.
- Pending migration = **정확히 1개**, `20260824154230_add_my_v1_account_data`만 존재. 그 외 예상 밖 pending 없음.

## Production Target 재확인
- host: `aws-0-ap-northeast-2.pooler.supabase.com` (Seoul pooler) — localhost/dev 아님. secret 값 미노출.

## Migration Artifact 재확인
- `git diff prisma/migrations/20260824154230_add_my_v1_account_data/migration.sql` → 결과 없음(변경 없음). MY-1B.1 커밋 시점과 byte 단위로 동일함을 재확인.

## Pre-deploy Read-only Snapshot
| 항목 | 값 |
|---|---|
| users | 0 |
| accounts | 0 |
| sessions | 0 |
| favorites (to_regclass) | null (테이블 없음) |
| recent_views (to_regclass) | null (테이블 없음) |
| user_preferences (to_regclass) | null (테이블 없음) |

## GO 조건 판정
| 조건 | 결과 |
|---|---|
| A. schema UTF-8 정상 | PASS |
| B. schema semantic change 없음 | PASS |
| C. prisma validate PASS | PASS |
| D. migrate status healthy | PASS |
| E. pending migration = MY V1 1개만 | PASS |
| F. production target confirmed | PASS |
| G. migration artifact unchanged | PASS |
| H. destructive SQL 없음 | PASS |

→ 모든 조건 충족, deploy 진행.

## Deploy 실행
```
npx prisma migrate deploy
```
```
Applying migration `20260824154230_add_my_v1_account_data`
The following migration(s) have been applied:
migrations/
  └─ 20260824154230_add_my_v1_account_data/
    └─ migration.sql
All migrations have been successfully applied.
```
**MIGRATION_DEPLOY = PASS**, 에러/경고 없음.

## Post-deploy Migration Status
```
npx prisma migrate status
```
```
Database schema is up to date!
```
Pending/failed 없음.

## 신규 테이블 검증 (read-only, information_schema/pg_indexes 조회)
- **favorites**: 컬럼 8개(id, user_id, lawd_cd, dong, name, apt_seq, address, created_at) — artifact와 정확히 일치. PK=id. FK: user_id → users(id), ON DELETE CASCADE, ON UPDATE CASCADE. Index: `favorites_user_id_created_at_idx`, unique `favorites_user_id_lawd_cd_dong_name_key`.
- **recent_views**: 컬럼 8개(id, user_id, lawd_cd, dong, name, apt_seq, address, viewed_at) — 일치. PK=id. FK 동일 구조. Index: `recent_views_user_id_viewed_at_idx`, unique `recent_views_user_id_lawd_cd_dong_name_key`.
- **user_preferences**: 컬럼 3개(user_id, purposes[jsonb], updated_at) — 일치. PK=user_id. FK 동일 구조.
- 총 인덱스 7개(PK 3 + 일반 2 + unique 2) — migration artifact와 완전 일치.

## 신규 Row Count
- favorites = 0, recent_views = 0, user_preferences = 0 — 테스트 데이터 INSERT 없음.

## 기존 Auth 데이터 Before/After 비교
| 테이블 | Before | After | 변화 |
|---|---|---|---|
| users | 0 | 0 | 없음 |
| accounts | 0 | 0 | 없음 |
| sessions | 0 | 0 | 없음 |

**EXISTING_AUTH_DATA_UNCHANGED = YES**

## Build Sanity
- `npx prisma validate` PASS / `npx prisma generate` PASS (배포 후 재실행)
- `npm run build` (`next build`, Turbopack) → `✓ Compiled successfully in 3.1s`, 정적 페이지 30/30 생성 완료, 에러 없음. **PASS**

## Production App Sanity (read-only, 실제 배포된 프로덕션 URL)
- `https://real-estate-app-park11.vercel.app/` — 정상 로드, 홈 타이틀 "이집 - AI 부동산 검색" 정상 렌더링.
- `https://real-estate-app-park11.vercel.app/my` — 정상 로드(500/크래시 아님), 네비게이션 및 로딩 상태 정상.
- `https://real-estate-app-park11.vercel.app/stats` — 정상 로드, 통계 카테고리 메뉴 정상 렌더링.
- 신규 favorites/recent_views/user_preferences를 사용하는 UI/API는 아직 미구현 상태이므로 별도 테스트 데이터 생성 없이 read-only 확인만 수행.

## DB Writes Performed
- `prisma migrate deploy` 1회 (CREATE TABLE ×3, CREATE INDEX ×4, ALTER TABLE ADD CONSTRAINT ×3) — migration artifact 내용 그대로.
- 그 외 INSERT/UPDATE/DELETE **0건**.

## Changed Files
- `prisma/schema.prisma` (인코딩 전용, 1줄)
- `docs/development/AUTH_MY_V1_MY1C_PRODUCTION_MIGRATION.md` (본 섹션 추가)

## Blocker
- 없음.

## Next Step
- **MY-2 (Favorites 기능 구현)**로 진행 가능. 신규 테이블은 생성되었으나 아직 어떤 API/UI도 연결되어 있지 않은 순수 스키마 상태.

---

## MY-1C.1 상태 요약

```
SCHEMA_UTF8                  = YES
SCHEMA_SEMANTIC_CHANGE        = NONE
PENDING_MIGRATIONS            = MY_V1_ONLY
MIGRATION_DEPLOY               = PASS
NEW_TABLES_CREATED             = YES
EXISTING_AUTH_DATA_UNCHANGED   = YES
MY1C_STATUS                    = PASS
NEXT_STEP                      = MY-2 FAVORITES
```
