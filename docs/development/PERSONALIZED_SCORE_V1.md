# PERSONALIZED SCORE V1 — 나에게 맞는 점수

감사·설계: `PERSONALIZED_SCORE_V1_PHASE1_AUDIT.md`. 이 문서는 PHASE 2 구현 단계별 기록이다.

## P2-A — 사용자 중요도 저장 + API (2026-09-15)

- 기준 HEAD: `c4ae456` (main)
- 승인: "P2-A — USER PREFERENCE STORAGE + API / ADDITIVE MIGRATION APPROVED", 저장 방식 **Option A**
- 범위: 저장 구조·검증·API·소유권/개인정보. **점수 계산·상세/비교 UI·MY 설정 UI·로그인 CTA 없음**(P2-B 이후).

### 1. 기존 구조(변경 전)

| 항목 | 실제 |
|---|---|
| 모델 | `UserPreference`(`user_preferences`): `userId` PK(`user_id`), `purposes Json @default("[]")`(jsonb, NOT NULL), `updatedAt` |
| API | `GET/PUT /api/my/preferences` — `requireUser()` 세션 사용자만(비로그인 401, 차단 403), body의 userId 미사용 |
| PUT | `purposes` 배열 필수(`validatePurposes`: 허용 8종, 최대 8, 중복 제거), 없으면 400. upsert |
| 사용처 | MY 화면만(`src/app/my/page.tsx`): GET 1회, 목적 토글 시 500ms debounce로 `PUT {purposes}` |
| 캐시 | 클라이언트 공용 캐시 없음(MY 화면 컴포넌트 state) |
| 행 수 | 2 |

### 2. Migration

`prisma/migrations/20260915130000_personalized_score_v1_fit_importance/migration.sql`

```sql
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE "user_preferences" ADD COLUMN "fit_importance" JSONB;
END $$;
```

- nullable, default 없음, backfill 없음, `purposes` 불변, grant/RLS/policy 변경 없음.
- Prisma: `fitImportance Json? @map("fit_importance")`.
- 적용 전 `prisma migrate diff`(Production introspection → 새 schema) 결과가 위 ADD COLUMN 한 줄뿐임을 확인.

### 3. 축과 값

| key | 표시명 |
|---|---|
| `transport` | 교통 |
| `living` | 생활편의 |
| `newness` | 신축 |
| `parking` | 주차 |
| `elementarySchoolAccess` | 초등학교 접근성 |

"학군" key·label 없음(공통 점수의 교육 축은 초등학교 직선거리뿐).

값 규칙(`src/lib/fit-importance.ts` `parseFitImportance`):
- plain object(프로토타입이 Object/null), 배열·클래스 인스턴스 거부
- **5개 key 정확히**(누락 `MISSING_KEY`, 추가 `UNKNOWN_KEY` — `__proto__` 같은 key 포함)
- 각 값 `number` 타입 정수 1~5(0·6·소수·문자열 숫자·null·NaN·중첩 `INVALID_VALUE`)
- 입력을 그대로 저장하지 않고 허용 key만 새 객체로 복사

### 4. 완전/부분 정책

**완전한 5축만 저장**. 일부 key 저장은 허용하지 않는다: 계산 시 "미설정 축"과 "데이터 결측 축"이 섞이지 않게 하고, P2-E UI에서 5개를 모두 고르게 한다.

### 5. 미설정·초기화

- 미설정 = `fit_importance` SQL `NULL`(JSON `null` 아님 — Prisma `DbNull`).
- 빈 객체 `{}`·일부 key 객체는 **400**(설정됨으로 저장하지 않는다).
- `PUT {"fitImportance": null}` → NULL로 초기화, `purposes` 유지.
- 저장값이 규칙에 어긋나면(수동 수정 등) 읽을 때 미설정(null)으로 본다.

### 6. API 계약

`GET /api/my/preferences`
```json
{ "success": true, "data": { "purposes": ["BUY"], "fitImportance": { "transport": 5, "living": 3, "newness": 4, "parking": 5, "elementarySchoolAccess": 2 } } }
```
미설정·행 없음: `"fitImportance": null`(행 없으면 `purposes: []`도 기존과 같음).

`PUT /api/my/preferences` — body에 **`purposes`와 `fitImportance` 중 하나 이상**:
- 들어온 필드만 갱신, 다른 필드는 그대로(행이 없으면 생성, purposes 기본값 `[]`).
- 둘 중 하나라도 규칙 위반이면 400이고 아무것도 저장하지 않는다.
- 응답: 갱신 후 `{ purposes, fitImportance }`.
- 기존 MY 화면 요청 `{purposes}`는 그대로 동작하며 저장된 중요도를 지우지 않는다.
- 변경점: 필드가 하나도 없는 body의 400 메시지 문구만 달라짐(상태 코드 동일).

두 메서드 모두 `Cache-Control: private, no-store`, `dynamic = 'force-dynamic'`.

### 7. 소유권·개인정보

- userId는 `requireUser()` 세션에서만. body/query의 `userId` 무시(테스트로 고정).
- 판정은 `src/lib/preferences-handlers.ts`(의존성 주입), 저장소는 `src/lib/preferences-prisma-store.ts`(라우트와 QA 스크립트 공용).
- 실패 로그는 오류 **코드만**(`{ code }`). Prisma 오류 메시지가 저장하려던 값을 담을 수 있어 원문을 남기지 않는다.
- analytics context에 중요도 필드 없음, `trackEvent`/로그/URL로 `fitImportance`를 보내는 코드 없음(테스트로 고정).
- 응답 no-store로 공유 캐시 저장 차단. 클라이언트 캐시는 아직 없음(P2-C/E에서 세션 단위·로그아웃 시 폐기로 설계).

### 8. Production 적용 결과

| 항목 | 결과 |
|---|---|
| 적용 전 | 대기 migration 1건(이것뿐), owner `postgres`, RLS on, FORCE off, 정책 0, API 역할 테이블·컬럼 권한 0, 잠금 0, 5초 초과 트랜잭션 0 |
| `prisma migrate deploy` | 1회, 05:07:50Z, exit 0 |
| 컬럼 | `fit_importance` `jsonb`, nullable, default 없음 |
| 기존 행 | 2행, `user_id·purposes·updated_at` 지문 적용 전후 동일, `fit_importance` NULL 2 |
| 보안(Batch A) | 43개 테이블 관계·ACL·정책·시퀀스 ACL·기본 권한 **전부 불변**(전후 카탈로그 비교), `user_preferences` API 역할 권한 0·RLS on·FORCE off·정책 0, 컬럼 권한 0 |
| Data API | `/rest/v1/` 503, 민감 테이블 503, `/graphql/v1` 503 |
| schema drift | 적용 후 `migrate diff` 빈 결과, `migrate status` up to date |

### 9. 롤백 쓰기 검증(Production DB)

`scripts/personal-score/verify-preferences-rollback.ts` — 트랜잭션 안에서 QA 사용자 2명 + 실제 핸들러/Prisma 저장소:
행 없음 GET → purposes만 PUT(행 생성, SQL NULL) → 중요도만 PUT(purposes 유지, JSON object) → purposes만 PUT(중요도 유지) →
잘못된 값 400·기존 값 유지 → 다른 사용자 조회 불가 → 다른 사용자 body에 userId 넣어도 영향 없음 → null 초기화(SQL NULL, purposes 유지) → 롤백.
**13/13 PASS**, 전후 행 지문 동일, QA 사용자 잔여 0.

### 10. 테스트·검증

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/preferences-fit-importance.test.ts` | 20/20 |
| src 전체(`*.test.ts`·`*.test.mjs`) | 1982/1982 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 scripts/tmp 25건, 신규 0) |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |

### 11. 한계

- 중요도를 설정하는 UI가 아직 없어 실제 사용자 값은 0건(P2-E).
- 로그인 세션으로 GET을 호출하는 Production 확인은 자동화 세션이 없어 하지 않았다(DB 롤백 검증으로 대체).
- 역방향 선호(예: 구축 선호)는 1~5 중요도로 표현할 수 없다(PHASE 1 결정).
