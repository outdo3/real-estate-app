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

### 9-1. Production API smoke (배포 `df8786f`)

| 요청(비로그인) | 결과 |
|---|---|
| `GET /api/my/preferences` | 401 `{"success":false,"error":"로그인이 필요합니다."}`, `Cache-Control: private, no-store` |
| `PUT /api/my/preferences` (유효한 fitImportance body) | 401 동일, 저장 없음 |
| `/my` 페이지 | 200 |

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

## P2-B — 순수 계산 엔진 + 설명 항목 (2026-09-15)

- 기준 HEAD: `356166a` (main)
- 범위: `src/lib/personalized-score.ts`(순수 함수) + 테스트 + 실데이터 동등성 스크립트. **schema·Production 쓰기·공통 점수·UI·analytics·LLM 변경 없음**. 아직 어떤 화면도 이 모듈을 호출하지 않는다(P2-C).

### 1. 입력(실제 score 응답 기준)

`GET /api/apt/[name]/score` 응답의 `_shadowV2` = V2 엔진 `ScoreV2Result` JSON.

| 축 | 출처 | 확인 |
|---|---|---|
| `transport` 교통 | `domains.transport.score` | 0~100, 결측 시 null |
| `living` 생활편의 | `domains.living.score` | 〃 |
| `newness` 신축 | `domains.complex.evidence.ageScore` | 요소 점수, buildYear 없으면 null |
| `parking` 주차 | `domains.complex.evidence.parkingScore` | **`parkingRawStatus === 'KNOWN'` 이고 `parkingModelTreatment === 'KNOWN_VALUE'`일 때만** |
| `elementarySchoolAccess` 초등학교 접근성 | `domains.education.score` | 초등학교 직선거리 기반 |

주차 실측/중립 구분: 공통 단지 도메인은 결측 시 `parkingScore: null`, `parkingModelTreatment: 'P-D_ERA_CONDITIONED'`, `parkingEraNeutralUsed: 65/68/53/22`를 기록하고 합성에는 중립값을 쓴다(`score-v2/complex.ts`). 개인화는 두 상태 표식이 모두 실측일 때만 점수를 읽고, 표식이 어긋나면 값이 있어도 쓰지 않는다.

공통 점수 사용 가능 = `_shadowV2`가 객체 + `eligibility !== 'NOT_ENOUGH_DATA'` + `overallScore`가 유한 숫자(비교 화면 `buildScore`·peer universe와 같은 기준, 공통 LIMITED 포함).

### 2. 계산

```
personalScore = Σ(axisScore × importance) / Σ(importance of included axes)
coverage      = Σ(importance of included axes) / Σ(importance of all 5 axes)
```

- 중요도는 정수 1~5 그대로(합계 100 변환 없음 — 비율이 같아 결과 동일).
- 계산하지 않음(`status: 'UNAVAILABLE'`): `NO_PREFERENCE`(중요도 없음·무효) / `NO_COMMON_SCORE` / `NO_INCLUDED_AXES`(포함 축 0개).
- 결측 축: 0점 처리 없이 분모에서 제외, `excludedAxes`와 축별 `exclusion`(`NO_DATA` · `PARKING_NOT_MEASURED` · `INVALID_SCORE`(숫자 아님·0~100 밖)).
- `coverage < 0.60` → `LIMITED`, `≥ 0.60` → `FULL`(정확히 0.60은 FULL).
- 반올림: 기존 점수 카드와 같은 `Math.round`. 결과에 `score`(정수)와 `rawScore`(반올림 전) 둘 다.

### 3. 설명 항목(규칙 기반, LLM 없음)

- 후보: **중요도 4~5**인 포함 축만.
- 판정은 **표시 정수 점수**(`Math.round`) 기준 — 화면에 보이는 숫자와 판정이 어긋나지 않게(예: 74.5 → 75 GOOD, 45.5 → 46 중립).
- `GOOD`: ≥ 75 / `WEAK`: ≤ 45 / 46~74 중립·결측 축은 설명 안 함.
- 정렬: 중요도 내림차순 → (GOOD은 점수 높은 순, WEAK는 낮은 순) → 축 고정 순서.

| 축 | GOOD | WEAK |
|---|---|---|
| 교통 | 교통 접근성이 선호에 잘 맞아요 | 교통 접근성은 선호보다 아쉬워요 |
| 생활편의 | 생활편의시설 접근성이 잘 맞아요 | 생활편의시설 접근성은 선호보다 아쉬워요 |
| 신축 | 신축 선호에 잘 맞아요 | 건물 연식은 신축 선호보다 아쉬워요 |
| 주차 | 주차 여건이 선호에 잘 맞아요 | 주차 여건은 선호보다 아쉬워요 |
| 초등학교 접근성 | 초등학교 접근성이 선호에 잘 맞아요 | 초등학교 접근성은 선호보다 아쉬워요 |

최고·우수·투자·미래가치·추천·학군 표현 없음(테스트 고정).

### 4. 출력 타입

```ts
type PersonalFitResult =
  | { status: 'UNAVAILABLE'; reason: 'NO_PREFERENCE' | 'NO_COMMON_SCORE' | 'NO_INCLUDED_AXES' }
  | { status: 'FULL' | 'LIMITED'; score: number; rawScore: number; coverage: number;
      includedAxes: FitAxis[]; excludedAxes: FitAxis[];
      axisResults: { axis; label; importance; score: number | null; included; exclusion }[];
      goodFit: { axis; label; importance; displayScore; text }[]; weakFit: [...] };
```

### 5. 불변·결정성·호환

- 공통 점수 객체는 읽기만 한다(깊게 동결한 실제 엔진 결과로 계산해도 오류·변화 없음).
- 시간·난수·env·네트워크·DB·React 없음. 같은 입력 → 같은 결과.
- 입력은 API 응답 `_shadowV2` JSON 그대로 — 상세(`apt-client`)·비교(`compare-v2/metrics` `buildScore`와 같은 객체) 모두 재사용 가능.

### 6. 검증

| 항목 | 결과 |
|---|---|
| `src/lib/personalized-score.test.ts` | 21/21 — 요청 22개 항목 포함(주차 신뢰 회귀는 **실제 V2 엔진** 결과로: 공통 단지 점수는 중립값 합성, 개인화는 주차 제외) |
| PHASE 1 동등성(단위) | 실제 엔진 출력 5단지 × 4프로필 20건 일치 |
| PHASE 1 동등성(실데이터, `scripts/personal-score/verify-engine-parity.ts`, READ ONLY) | 부산 점수 산출 2,833단지 × 4프로필 = 11,332건: 상태·표시 점수·coverage 불일치 **0**, rawScore 최대 차 2.8e-14, LIMITED 수 PHASE 1과 동일(51/2/18/1). 공통 점수가 주차 중립값을 쓴 808단지에서 개인화가 주차를 포함한 경우 **0** |
| 성능 | 단위 테스트 1만 회 평균 < 0.1ms 조건 통과, 실데이터 스크립트 호출당 약 0.008ms |
| src 전체 | 2003/2003 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 25건, 신규 0) |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |

rawScore 미세 차이 원인: PHASE 1 프로토타입은 교통·생활·초등·신축·주차 순, 모듈은 교통·생활·신축·주차·초등 순으로 더한다 — 수식은 같고 부동소수 합산 순서만 다르다.

P2-A 범위 테스트("중요도 사용처") 목록에 `personalized-score.ts`를 추가하고 UI(tsx) 사용 없음을 함께 고정했다.

### 7. 한계

- 공통 점수 응답이 `_shadowV2`를 `any`로 넘기므로 모듈이 형태를 방어적으로 검사한다(형태가 바뀌면 해당 축은 `NO_DATA`/`INVALID_SCORE`로 빠진다).
- 설명은 축 점수 구간만 말하고 원자료(거리·대수·연식)를 문장에 넣지 않는다 — 원자료 병기는 P2-C UI에서 공통 점수 카드의 근거 값 재사용으로 검토.
- 역방향 선호 표현 불가, 가격·향후가치 축 없음(PHASE 1 결정).
