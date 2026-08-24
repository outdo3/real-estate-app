# AUTH/MY V1 — MY-1B.1: PRODUCTION MIGRATION SAFETY GATE

## 1. Actual Baseline HEAD
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `0cc3155 feat(auth): prepare my v1 account data migration` (= `origin/feature/auth-my-v1`)
- **Note**: 이전 세션(quota 소진 전)이 "MY-1B.1 gate 문서 작성 중"이었다는 전제로 이번 STEP이 시작되었으나, 실제 저장소에는 해당 문서나 MY-1B.1 관련 커밋이 존재하지 않았다. 확인 가능한 최신 상태는 MY-1B(초안) 커밋(`0cc3155`)까지였다. 본 문서는 그 지점부터 MY-1B.1을 처음 완료한 결과다.

## 2. Recovery 상태 (작업 시작 시점)
| 항목 | 상태 |
|---|---|
| `prisma/schema.prisma` 변경 | COMPLETED (이미 커밋됨) |
| 정식 migration artifact | NOT_STARTED |
| MY-1B.1 문서 | NOT_STARTED |
| tsc | pre-existing 무관 오류만 존재 |
| lint | 미확정 |
| build | 미실행 |
| production DB | untouched |

## 3. Migration Artifact Path
```
prisma/migrations/20260824154230_add_my_v1_account_data/migration.sql
```
- `prisma migrate dev`는 실행하지 않음: 이 프로젝트에 `SHADOW_DATABASE_URL`이 설정되어 있지 않아, 실행 시 `DATABASE_URL`과 동일한(운영과 공유되는 Supabase) 인스턴스에 shadow DB를 자동 생성/삭제하려 시도할 위험이 있었음.
- 대신 기존 untracked `prisma/migration_draft.sql`(offline `prisma migrate diff`로 사전 생성된 파일)의 내용을 UTF-8로 그대로 정식 migration 폴더에 옮겨 작성함. 바이트 단위 diff로 원본과 내용이 동일함을 확인(BOM 문자 1개, 파일 끝 개행 1줄 차이만 존재 — SQL 내용은 100% 동일).

## 4. Exact SQL Operations
```sql
CREATE TABLE "favorites" (...)
CREATE TABLE "recent_views" (...)
CREATE TABLE "user_preferences" (...)

CREATE INDEX "favorites_user_id_created_at_idx" ON "favorites"(...)
CREATE UNIQUE INDEX "favorites_user_id_lawd_cd_dong_name_key" ON "favorites"(...)
CREATE INDEX "recent_views_user_id_viewed_at_idx" ON "recent_views"(...)
CREATE UNIQUE INDEX "recent_views_user_id_lawd_cd_dong_name_key" ON "recent_views"(...)

ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
연산 요약: `CREATE TABLE` × 3, `CREATE INDEX` × 2, `CREATE UNIQUE INDEX` × 2, `ALTER TABLE ... ADD CONSTRAINT (FK)` × 3. 그 외 연산 없음.

## 5. UTF-8 확인
- `file` 결과: `ASCII text` (UTF-8의 유효한 부분집합, 문제 없음)
- 기존 `prisma/migration_draft.sql`은 `UTF-16LE with CRLF` — Prisma가 정상 인식하지 못할 위험이 있었음. 정식 artifact는 UTF-8/ASCII로 재작성 완료.

## 6. Destructive SQL Audit
- `DROP` / `DELETE` / `UPDATE` / `TRUNCATE` / `RENAME` / `ALTER COLUMN` / `DROP COLUMN`: **0건**
- grep에서 `ON DELETE CASCADE` / `ON UPDATE CASCADE` 문자열이 `DELETE `/`UPDATE ` 패턴에 매칭되었으나, 이는 FK cascade 옵션 키워드이며 실제 DML(DELETE/UPDATE 문)이 아님 — false positive로 확인.
- **DESTRUCTIVE_SQL = NO**

## 7. Existing Table Physical Impact
- `users`, `accounts`, `sessions`, `Apartment`, `ApartmentMaster` 등 기존 테이블에 대한 물리적 ALTER 없음.
- **EXISTING_TABLE_PHYSICAL_ALTER = NO**

## 8. FK / Cascade
- 신규 테이블 3개 모두 `user_id` → `users.id` FK, `ON DELETE CASCADE ON UPDATE CASCADE`.
- 사용자 삭제 시 관련 favorites/recent_views/user_preferences가 orphan 없이 함께 정리됨.

## 9. Unique / Index
- `favorites`: `UNIQUE(user_id, lawd_cd, dong, name)`, `INDEX(user_id, created_at DESC)`
- `recent_views`: `UNIQUE(user_id, lawd_cd, dong, name)`, `INDEX(user_id, viewed_at DESC)`
- `user_preferences`: PK = `user_id` (단일 로우 정책)

## 10. `npx prisma validate`
```
The schema at prisma\schema.prisma is valid 🚀
```
**PASS**

## 11. `npx prisma generate`
```
✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client in 986ms
```
**PASS** — DB 연결/쓰기 없음 (schema 기반 codegen만 수행).

## 12. `npx tsc --noEmit`
총 14개 오류 라인(29 lines) 발생. 전부 아래 3개 파일/모듈에 국한:
- `scripts/apartment-score/busan-final8-check.ts` — `RawMasterInfo`에 `geocodeQuality` 필드 누락 (기존 타입 불일치)
- `scripts/education/c6a-*.ts`, `scripts/education/lib/attendance-zone-source.ts` — `shapefile` 미정의, `proj4`/`iconv-lite` 모듈 타입 없음, 중복 함수 선언
- `src/lib/score-v2/adapter.ts` — `../../apartment-score/server/types` 모듈 경로 없음

## 13. Pre-existing / New Type Errors
- 위 14건 모두 `scripts/apartment-score`, `scripts/education`, `src/lib/score-v2` 소속이며 auth/my/Favorite/RecentView/UserPreference 관련 코드를 전혀 포함하지 않음.
- Prisma schema 변경(신규 모델 추가)이 이 모듈들과 타입 의존 관계가 없어 원인 불명 요소 없음(module-not-found, 사전 존재 타입 불일치 — 이번 변경과 무관).
- **AUTH_MY_NEW_TYPE_ERRORS = NONE**
- **PRE_EXISTING**으로 판정.

## 14. Lint
```
npx eslint .
```
출력 없음 (0 warnings, 0 errors), exit code 0.
**LINT = PASS**

## 15. Full Build
```
npm run build  (next build, Turbopack)
✓ Compiled successfully in 2.9s
✓ Generating static pages using 7 workers (30/30)
```
**FULL_BUILD = PASS** — 30/30 정적 페이지 생성 완료, 에러 없음.

## 16. Production DB Untouched
이번 STEP 전체에서 아래 명령 실행 횟수:
- `prisma migrate deploy`: 0
- `prisma db push`: 0
- `prisma migrate reset`: 0
- production `CREATE TABLE` / `INSERT` / `UPDATE` / `DELETE`: 0
- 실행한 DB 관련 명령은 `prisma validate`(로컬 schema 파싱), `prisma generate`(codegen)뿐이며 둘 다 연결/쓰기 없음.
- **PRODUCTION_DB_TOUCHED = NO**

## 17. Future MY-1C Apply Command (문서 기록 전용 — 실행 금지)
```bash
npx prisma migrate deploy
```
- `prisma db push --accept-data-loss`는 production 후보에서 완전히 제외.
- 승인 없이 실행하지 않음.

## 18. Verification Plan (Post-Deploy, MY-1C 이후 참고용)
1. `favorites`, `recent_views`, `user_preferences` 3개 테이블 존재 확인
2. 각 테이블 row count = 0 확인
3. 기존 `users` 테이블 row 무결성/개수 불변 확인
4. 애플리케이션 build/배포 정상 동작 확인

## 19. Failure Handling
- **PRE-USE ROLLBACK**: 사용 이전이라면 `DROP TABLE "favorites", "recent_views", "user_preferences";`로 되돌릴 수 있음.
- **POST-USE ROLLBACK**: 사용자 데이터가 쌓인 이후에는 테이블을 직접 DROP하지 않고, 기능을 UI/Feature Flag로 비활성화한 뒤 백업 후 스키마 정리를 검토.

---

## 승인 권고 (Approval Recommendation)
- MY-1B.1 안전 게이트의 모든 정적 검증(schema validate, generate, tsc, lint, build, destructive-SQL audit)을 통과했고, 신규 스키마는 기존 테이블에 물리적 영향이 없는 순수 additive 변경임.
- Production DB는 이번 STEP 동안 한 번도 접속/변경되지 않음.
- **PM 승인 시 MY-1C(`prisma migrate deploy`)로 진행 가능**하다고 판단되나, 실제 실행은 명시적 승인 이후로 보류함.

---

## 상태 요약

```
MIGRATION_ARTIFACT_READY          = YES
MIGRATION_UTF8                    = YES
DESTRUCTIVE_SQL                   = NO
EXISTING_TABLE_PHYSICAL_ALTER     = NO
AUTH_MY_NEW_TYPE_ERRORS           = NONE
LINT                              = PASS
FULL_BUILD                        = PASS
PRODUCTION_DB_TOUCHED             = NO
MY1B1_STATUS                      = PASS
PRODUCTION_MIGRATION_APPROVAL_READY = YES
```
