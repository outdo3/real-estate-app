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

## P2-C + P2-E — 상세 카드 + MY 중요도 설정 (2026-09-15)

- 기준 HEAD: `405ef06` (main)
- 범위: 사용자에게 보이는 첫 MVP. schema·`fit_importance` 구조·P2-B 계산식·공통 점수·검색 정렬·analytics 변경 없음.

### 1. 기존 화면(코드 기준)

| 항목 | 실제 |
|---|---|
| 공통 점수 카드 | `apt-client.tsx` `<ApartmentScoreCard result={scoreResult} loading={scoreLoading} />`(TIER 1, 브리핑 위). `scoreLoading` 초기값 true, 점수 요청마다 true → 완료 후 false |
| 점수 응답 | `scoreResult._shadowV2`(V2 결과 JSON) — 브리핑·비교가 같은 값 사용 |
| 세션 | NextAuth JWT, 클라이언트 `useSession()`, `session.user.id` 제공 |
| 선호 API 사용처 | MY 페이지만(관심 목적 GET/PUT) |
| 로그인 CTA 패턴 | `LoginModal`(기본 콜백 = 현재 URL) — FavoriteButton·AuthGate·커뮤니티가 사용 |
| 로그아웃 | MY 페이지 `signOut({ callbackUrl: '/' })`(전체 이동) |

### 2. 상세 카드 (`src/components/PersonalFitCard.tsx`)

위치: `ApartmentScoreCard` **바로 아래 별도 카드**(12px 간격). 공통 카드 내부는 바꾸지 않았다.
판정: `derivePersonalFitCard`(`src/lib/personal-fit-ui.ts`) → P2-B `calculatePersonalFit` 결과를 그대로 화면 모델로. 카드는 점수·GOOD/WEAK를 다시 판정하지 않는다.

| 상태 | 조건 | 화면 |
|---|---|---|
| 자리 유지 | 공통 점수 로딩 중, 또는 로그인 사용자의 선호 조회 중 | 높이 72px 빈 카드(큰 skeleton 없음) |
| 숨김 | 비로그인 + 공통 점수 없음 | 렌더 안 함(계산할 수 없는 단지에서 로그인을 권하지 않음) |
| 비로그인 | 공통 점수 있음 | "로그인하면 나에게 맞는 점수를 확인할 수 있어요" + [로그인하고 확인] → 기존 `LoginModal`(현재 상세 URL로 복귀). **선호 요청·계산 없음** |
| 미설정 | 로그인 + `fitImportance` null | "중요하게 보는 조건을 설정하면 나에게 맞는 점수를 계산해 드려요" + [내 중요도 설정하기] → `/my#fit-score-settings` |
| 계산 불가 | 설정 있음 + 공통 점수 없음(또는 포함 축 0) | "현재 이 단지는 나에게 맞는 점수를 계산할 정보가 부족해요." 숫자 없음 |
| 조회 실패 | 선호 GET 실패 | "내 중요도를 불러오지 못했어요." |
| FULL | P2-B `FULL` | 제목·[내 중요도 반영]·[중요도 수정]·보조문구·점수(1.9rem, 본문색 — 공통 2.5rem green과 구분)·5축 행(축·중요도 n·n점)·잘 맞는 점/아쉬운 점·면책 |
| LIMITED | P2-B `LIMITED` | 점수 표시 + [일부 정보 부족] + "일부 정보가 없어 확인 가능한 조건만 반영했어요. 반영 제외: 주차 정보 없음" |

- 제외 축 행은 점수 대신 "반영 제외"(0점처럼 보이지 않게). FULL이어도 제외 축이 있으면 "반영 제외: …" 한 줄.
- 제외 사유 문구: 주차 실측 없음 "주차 정보 없음", 데이터 없음 "{축} 정보 없음", 값 이상 "{축} 정보 확인 필요".
- 면책(작게): "개인 선호를 반영한 적합도이며, 투자 판단이나 가격 전망을 의미하지 않습니다."
- 금지 표현(추천 점수·투자 점수·투자가치·미래가치·수익) 없음, "학군" 없음(테스트 고정).

### 3. MY 설정 (`src/components/my/FitImportanceSettings.tsx`)

- 섹션 "나에게 맞는 점수 설정"(관심 목적 섹션 다음, `id="fit-score-settings"`). 설명: "아파트를 볼 때 중요하게 생각하는 조건을 알려주세요. 이 설정은 나에게 맞는 점수를 계산할 때만 사용됩니다."
- 교통 · 생활편의 · 신축 · 주차 · 초등학교 접근성 × [1][2][3][4][5] (`role="radiogroup"`, 5등분 폭, 44px 이상). 선택 의미: 1 중요하지 않음 · 2 조금 중요 · 3 보통 · 4 중요 · 5 매우 중요, 미선택은 "선택 안 함".
- **기본값 없음**: 처음엔 전부 미선택. 5개 모두 골라야 [저장하기] 활성화("5개 항목을 모두 선택하면 저장할 수 있어요.").
- 기존 값이 있으면 그 값으로 채우고, 바뀌었을 때만 저장 가능.
- 저장: `PUT /api/my/preferences` `{ fitImportance }`만 → 관심 목적 유지(P2-A 필드별 갱신). 성공: "저장했어요" + 세션 캐시 갱신(새로고침 없이 상세 반영). 실패: 저장된 값 유지 + "저장하지 못했어요. 다시 시도해 주세요."
- 상세의 링크로 들어오면 섹션으로 스크롤(MY 본문이 세션 확인 뒤에 그려져 기본 앵커 이동이 안 되기 때문, `scroll-margin-top` 적용).

### 4. 선호 조회·캐시·개인정보

- `useFitPreference` 훅: `status === 'authenticated'`일 때만 조회. `unauthenticated`이면 요청 없이 캐시 비움.
- `fitPreferenceCache`(`src/lib/fit-preference-cache.ts`): **탭 메모리**, 사용자 id로 묶음(다른 id 조회 시 이전 값 폐기), 동시 요청 1회로 합침, 실패는 캐시 안 함, 사용자 전환 중 늦게 온 응답은 버림, `cache: 'no-store'`. localStorage·쿠키·URL 없음.
- MY 로그아웃 버튼은 `signOut` 전에 캐시를 비운다.
- 중요도 값: analytics·URL·console·저장소로 보내지 않음(값을 다루는 파일 전체 소스 검사). 상세·MY 페이지 파일은 값을 직접 만지지 않는다.

### 5. 성능

- 공통 점수 요청·렌더 흐름 무변경. 카드는 같은 응답의 `_shadowV2`만 읽고, 선호 조회는 카드 안에서 따로(공통 카드를 기다리게 하지 않음).
- 추가 네트워크: 로그인 사용자 탭당 선호 GET 최대 1회(상세 간 이동 재조회 없음). 계산은 P2-B 순수 함수(~0.01ms).
- 참고: MY 첫 진입에서는 기존 관심 목적 GET과 중요도 캐시 GET이 각각 1회 나간다(같은 API 2회, 기존 MY 로직 무변경을 우선).

### 6. 검증

| 항목 | 결과 |
|---|---|
| `src/lib/personal-fit-ui.test.ts` | 16/16 — 요청 24개 항목(비로그인 CTA·요청 없음·미설정·FULL·LIMITED·제외 축·UNAVAILABLE·공통 점수 불변·5축·학군 없음·기본값 없음·5개 전 저장 비활성·저장·재로드·수정·purposes 유지·캐시 격리·로그아웃 비움·analytics/URL 없음·P2-B 결과 재사용·모바일 CSS) |
| P2-A 범위 테스트 | 중요도 사용처 목록에 P2-C/E 파일 반영, 비교·검색·리포트·관리자 미사용 고정 |
| src 전체 | 2019/2019 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 25건, 신규 0) |
| eslint(변경 파일) | exit 0(경고 2건은 기존 `apt-client.tsx` eslint-disable 주석) |
| `npm run build` | exit 0 |
| 로컬 production 빌드(비로그인, 360/375/390px iframe) | 카드 상태 logged-out, 공통 점수 카드 바로 다음 형제 요소(간격 12px), 가로 넘침 없음, CTA 44px·카드 폭, `/api/my/preferences` 요청 0 |

### 7. Production QA (배포 `90c6768`, 2026-09-15)

브라우저 창 폭 767px(이 환경 Chrome 최소 폭). 로그인된 실제 계정으로 **읽기·화면 조작만**, 저장하지 않음.

| 단계 | 결과 |
|---|---|
| 상세(우동 롯데 `26350-9`) | 카드 상태 `no-settings`("중요하게 보는 조건을 설정하면…" + [내 중요도 설정하기]), 바로 앞 형제 = 이집점수 카드, 이집점수 51(변경 전과 동일), `/api/my/preferences` 요청 1, 가로 넘침 없음 |
| [내 중요도 설정하기] | `/my#fit-score-settings`로 이동, 섹션이 화면 상단(108px)으로 스크롤 |
| MY 섹션 | 축 5개(교통·생활편의·신축·주차·초등학교 접근성), 축당 1~5 버튼(최소 44px), 처음 전부 "선택 안 함"·선택 0, [저장하기] 비활성 + "5개 항목을 모두 선택하면…", "학군" 없음, 관심 목적 섹션 유지 |
| 선택만(저장 안 함) | 4개 선택 시 비활성 유지, 5개째에서 활성, 의미 표시(매우 중요·보통·중요·매우 중요·조금 중요) |
| 캐시 | 상세 → MY 이동 동안 선호 요청은 상세 1회 + MY 기존 관심 목적 GET 1회뿐(카드 캐시 재사용) |
| 저장 여부 | 이후 GET: `fitImportance` null 유지, purposes 배열 유지 — **계정 설정 변경 없음** |

FULL/LIMITED 카드와 저장 후 상세 반영은 실계정 값을 바꾸지 않기 위해 Production에서 실행하지 않았다(단위 테스트 + P2-A 롤백 DB 검증으로 대체) → 기기 QA 필요.

## P2-D — 비교 화면 연동 (2026-09-15)

- 기준 HEAD: `bd54269` (main)
- 범위: 비교 화면(`/stats/compare`, `CompareV2`)만. schema·`fit_importance`·계산식·공통 점수·검색·analytics·선호 API 변경 없음, 외부 API·LLM 없음.

### 1. 기존 비교 구조(코드 기준)

| 항목 | 실제 |
|---|---|
| 화면 | `src/components/compare/CompareV2.tsx`, 슬롯 **최대 2개**(`[null, null]`) |
| 단지 데이터 | `fetchCompareApartment` → 단지당 trades + `/api/apt/[name]/score?aptSeq=` 병렬 1회씩 → `CompareApartment` |
| 공통 점수 표시 | `ScoreSection`: 제목 "이집 분석 (절대 평가 — 순위 아님)" + 교통·생활·교육·단지 **도메인 막대 4줄**(격자 `44px 1fr 1fr`) + peer 줄. 종합 숫자 줄은 없음. 두 단지 모두 점수가 없으면 섹션 렌더 안 함 |
| `_shadowV2` | `buildScore`가 도메인만 매핑하고 원본은 `CompareApartment`에 남기지 않았음 |

### 2. 변경

- `CompareApartment.scoreV2?: unknown` 추가 — `fetch.ts`가 **이미 받은** score 응답의 `_shadowV2`를 그대로 담는다(새 요청 없음, 공통 `buildScore` 매핑 불변). 선택 필드라 리포트 비교(`compare-read.ts`) 등 기존 생성부 영향 없음.
- `deriveComparePersonalFit`(`src/lib/personal-fit-ui.ts`): 두 단지 각각 상세 카드와 **같은 판정**(`derivePersonalFitCard` → P2-B `calculatePersonalFit`)에 **같은 사용자 중요도**를 넣는다. 가중합·임계값을 새로 쓰지 않는다.
- `ScoreSection` 안, peer 줄 **바로 아래** `PersonalFitCompareBlock` 한 블록(별도 카드 추가 없음).

### 3. 상태

| 상태 | 조건 | 화면 |
|---|---|---|
| 숨김 | 두 단지 모두 공통 점수 없음 | 렌더 안 함(기존 ScoreSection도 이 경우 렌더 안 함) |
| 자리 유지 | 로그인 사용자 선호 조회 중 | 44px 빈 칸 |
| 비로그인 | — | 섹션 전체에 한 번: "로그인하면 나에게 맞는 점수로 비교할 수 있어요" + [로그인하고 비교](기존 `LoginModal`, 현재 비교 URL로 복귀). **선호 요청 없음** |
| 미설정 | 로그인 + `fitImportance` null | 섹션 전체에 한 번: "중요하게 보는 조건을 설정하면 나에게 맞는 점수로 비교할 수 있어요" + [내 중요도 설정하기] → `/my#fit-score-settings` |
| 조회 실패 | 선호 GET 실패 | "내 중요도를 불러오지 못했어요." |
| 점수 | 설정됨 | 제목 + [내 중요도 반영], A/B 칸(도메인 막대와 같은 `44px \| 1fr \| 1fr` 정렬): 쪽마다 독립 |

쪽별 표시:
- FULL: `NN점` + "전체 조건 반영"
- LIMITED: `NN점` + [일부 정보 부족] + 제외 사유(예: "교통 정보 없음, 주차 정보 없음")
- FULL이지만 제외 축 있음: `NN점` + 제외 사유
- 계산 불가: "정보 부족"(숫자 없음). **한쪽이 계산 불가여도 다른 쪽 점수는 그대로.**

제외 사유는 점수 대신 글자로만(0점처럼 보이지 않음), 최대 2줄. 두 점수가 서로 다른 조건으로 계산됐을 수 있음을 쪽마다 드러낸다.
면책 "개인 선호를 반영한 적합도이며, 투자 판단이나 가격 전망을 의미하지 않습니다."는 블록 하단 **한 번**.
잘 맞는 점/아쉬운 점 문장은 비교에 넣지 않고 상세에만 둔다(제안: 추후 쪽별 "가장 잘 맞는 축" 1개 — 이번 STEP 미구현).

### 4. 캐시·개인정보·성능

- 선호는 P2-C/E의 `useFitPreference`(탭 메모리·사용자 id별·로그아웃 비움·실패 미캐시)를 그대로 사용. 비교 전용 fetch/cache 없음, 비교 화면이 선호 API를 직접 부르지 않음.
- 계산은 순수 함수 2회. 추가 네트워크는 캐시되지 않은 경우의 선호 GET 1회뿐. 공통 비교 렌더는 기다리지 않는다.
- 중요도 값 analytics·URL·저장소 전송 없음. 기존 비교 analytics 호출(`compare_start`·`compare_add`·`compare_remove`·`compare_detail_click`×2·`finance_fit_from_compare`×2) 이름·횟수 불변. 비교 URL·공유(`compare-v2/*`)에 중요도 없음.

### 5. 검증

| 항목 | 결과 |
|---|---|
| `src/lib/personal-fit-compare.test.ts` | 16/16 — 요청 22개 항목(비로그인 CTA 1회·요청 없음·미설정 CTA 1회·A/B 점수·같은 중요도·FULL/FULL·FULL/LIMITED·FULL/UNAVAILABLE·LIMITED/LIMITED·UNAVAILABLE/UNAVAILABLE·한쪽 불가·쪽별 제외 축·0점 표시 없음·공통 점수 불변·P2-B 재사용·공식 중복 없음·캐시 재사용·analytics/URL·학군 없음·모바일 CSS·최대 2곳) |
| src 전체 | 2035/2035 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 25건, 신규 0) |
| eslint(변경 파일) | exit 0 |
| `npm run build` | exit 0 |
| 로컬 production 빌드(비로그인, `/stats/compare?a=26350-9&b=26110-837`, 360/375/390px iframe) | 블록이 "이집 분석" 패널 안 peer 줄 아래, 도메인 막대 4줄 유지, CTA 1개(44px·블록 전체 폭), 가로 넘침 없음, `/api/my/preferences` 요청 0 |
