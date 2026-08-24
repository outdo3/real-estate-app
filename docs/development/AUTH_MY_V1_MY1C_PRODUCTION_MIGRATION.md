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
