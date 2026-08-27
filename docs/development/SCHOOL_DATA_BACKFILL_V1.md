# SCHOOL DATA BACKFILL V1 — 부산 학교알리미/NEIS 검증 데이터 backfill

## 1. Goal

`SCHOOLINFO_SCHOOL_V2_1`(canonical school identity + decision-first 학교 상세
페이지)이 완료된 뒤에도 학생수/학급수/교원수/공식 좌표는 여전히 0건이었다. 이
STEP은 부산 School 664개를 대상으로 학교알리미(SchoolInfo) OpenAPI 공시통계와
공식 좌표를 검증된 방식으로만 backfill하고, 실제 데이터가 있을 때만 학교 상세
UI의 "연동 준비 중" placeholder를 실데이터 카드로 교체한다.

## 2. Approval Scope

사용자가 이번 STEP 시작 시 명시적으로 사전 승인한 범위:

- 부산 School 664개 dry-run/backfill
- `SchoolStat` insert/update
- 기존 `School` row의 검증된 nullable field(좌표, 주소 등) update
- batch/resume 실행, idempotency rerun
- 이번 STEP 관련 commit/push

TRUE GATE(승인 범위 밖, 별도 승인 필요): schema 변경, migration, 새 table/column
추가, 기존 데이터 대량 삭제, 검증되지 않은 값 overwrite, 원본과 충돌하는 값 강제
overwrite. 이번 STEP에서 이 중 어느 것도 발생하지 않았다(§25 DB_SCHEMA_CHANGE 참고).

## 3. Source

- **학교알리미(SchoolInfo) OpenAPI** — `http://www.schoolinfo.go.kr/openApi.do`,
  `SCHOOLINFO_API_KEY`(기존 `.env.local`에 이미 존재, 신규 발급 없음).
  `apiType=0`: 기본정보+좌표. `apiType=09`: 학년별 학생수/학급수 + 교원수 합계.
- **NEIS OpenAPI** — 기존 `scripts/education/ingest-schools-neis.ts`가 이미
  STEP 3 이전에 확보한 664개 School row(canonical identity, 주소, 구/군)를 그대로
  재사용. 이번 STEP에서 NEIS에 새로 쓰기 요청을 하지 않았다.
- **Kakao** — canonical으로 승격하지 않음(§11). 이번 STEP은 Kakao 좌표를 전혀
  읽거나 쓰지 않았다.

새로운 유료 API 의존성 추가 없음(AGENTS.md §8 준수) — `SCHOOLINFO_API_KEY`는 STEP 3
조사 단계에서 이미 발급/등록된 키다.

## 4. SchoolInfo Policy

STEP 3에서 `docs/development/SCHOOLINFO_SCHOOL_V2_1.md`에 이미 문서화한 사용자
공식 회신 기준(상업적 활용/재구성/비교/분석 가능, 이집 산출물은 RAW와 분리 표시,
위경도 임의 변경 금지, 필수 출처 "학교알리미")을 그대로 따른다. `EducationSource`
row(`code='schoolinfo_openapi'`)는 STEP 3에서 이미 `legalReviewStatus=CLEARED`로
등록되어 있다 — 이번 STEP의 백필 스크립트는 시작 시 이 값이 `CLEARED`가 아니면
즉시 BLOCKER로 중단하도록 방어 gate를 넣었다(`scripts/education/backfill-school-data-v1.ts`).

## 5. Baseline

작업 시작 시점(`git branch --show-current` = main, 직전 커밋 e855d36):

- School 총 664행(부산), 전부 `neisSchoolCode` 확보(STEP 3에서 이미 완료).
- `School.latitude`/`longitude`: 664행 전부 `null`(coordinateType=UNKNOWN 기본값).
- `SchoolStat`: 0행.
- Worktree: `package.json`, `package-lock.json`, `ApartmentAutocomplete.tsx.bak`,
  `my_prod.html`, `prisma/schema_old.prisma`, `tmp/`가 이미 사용자 작업물로
  존재 — 이번 STEP에서 건드리지 않았다(git status로 재확인, 아래 §git 참고).

## 6. School Schema (변경 없음)

`prisma/schema.prisma`의 `School` 모델은 이미 이번 STEP이 필요로 하는 모든
nullable 필드(`latitude`, `longitude`, `coordinateSource`, `coordinateType`,
`address`, `roadAddress`, `sidoCode`, `sigunguCode`)를 갖고 있었다. 스키마 변경
없이 기존 컬럼만 채웠다.

## 7. SchoolStat Schema (변경 없음)

`SchoolStat`(`studentCount`, `classCount`, `teacherCount`, `gradeBreakdown` Json,
`referenceYear`, `sourceId`, `@@unique([schoolId, sourceId, referenceYear])`)도
이미 이번 STEP에 필요한 구조를 갖추고 있었다. 학년별 세부는 Json 컬럼
`gradeBreakdown`에 그대로 넣었다(타입 컬럼화하지 않음 — STEP 3 설계 그대로 유지).

## 8. Canonical Identity

`School.neisSchoolCode`(NEIS SD_SCHUL_CODE)를 canonical key로 그대로 유지했다.
학교알리미 자체 식별자 `SCHUL_CODE`는 NEIS 코드와 별도 체계라 직접 crosswalk할
수 없음을 실측으로 확인(`scripts/education/c2b-verify-schoolinfo-api.ts`) —
이름+구/군(School.sigunguCode) 조합으로만 후보를 좁히고, 동명이교가 남으면
`School.dongName`(NEIS 출처)이 학교알리미 주소 문자열에 포함되는지로만 안전하게
확정한다(`src/lib/education/schoolinfo-match.ts`). 그래도 모호하면 REVIEW로
남기고 절대 첫 번째 결과를 쓰지 않는다.

## 9. Field Mapping

| 학교알리미 필드 | 내부 필드 | 타입 | 연도 | null 규칙 | 비고 |
|---|---|---|---|---|---|
| `LTTUD`/`LGTUD` (apiType=0) | `School.latitude`/`longitude` | Float | - | 이미 값이 있으면 덮어쓰지 않음(§13) | WGS84, 변환 없음 |
| `ADRCD_CD`(앞 5자리) | `School.sigunguCode` | String | - | `sigunguCode`가 이미 null일 때만(orphan 7건) | 구/군 코드 |
| `COL_S_SUM`(apiType=09) | `SchoolStat.studentCount` | Int | `referenceYear` | 원본 없음=null 유지 | 학생수 합계 |
| `COL_C_SUM` | `SchoolStat.classCount` | Int | 〃 | 〃 | 학급수 합계 |
| `TEACH_CNT` | `SchoolStat.teacherCount` | Int | 〃 | 〃 | 교원수 |
| `COL_S1..COL_S8`/`COL_C1..COL_C8` | `SchoolStat.gradeBreakdown.students[]`/`.classes[]` | Json 배열 | 〃 | 슬롯 없음(중/고교 4~8학년)=`null`(§오류 #2) | `normalizeGradeSlot` |
| `pbanYr`(요청 파라미터) | `SchoolStat.referenceYear`/`disclosureYear` | Int | - | - | 공시연도 |
| (고정값) | `SchoolStat.sourceId` | FK | - | - | `EducationSource.code='schoolinfo_openapi'` |

## 10. Year Mapping

`pbanYr='2026'`(가장 최신 공시연도)만 요청했다. 학교 상세 UI는 `referenceYear`를
그대로 "2026년 기준"으로 표시하고(§21), 여러 연도를 섞어 하나의 대표값으로
합치지 않는다. 이번 backfill 범위에서는 학교당 최신 연도 1건만 수집했으므로
연도 충돌 케이스는 발생하지 않았다.

## 11. Coordinate Policy

- 좌표 변환 없음 — `LTTUD`/`LGTUD`는 이미 WGS84 십진도이며 기존 부산 좌표 관례와
  일치함을 실측 확인.
- 부산 bounding box(`BUSAN_BBOX`, `src/lib/education/schoolinfo-stat-validate.ts`)
  범위를 벗어나면 쓰지 않는다(REVIEW 대상, 이번 실행에서 해당 사례 0건).
- `School.latitude`가 이미 값이 있으면(이번 STEP 이전에는 전부 null이었으므로
  실질적으로 발생하지 않았지만, 재실행 안전성을 위해) 덮어쓰지 않는다 — 신규
  값만 채운다.
- Kakao 좌표는 이번 STEP에서 전혀 다루지 않았다(canonical로 승격 금지 원칙 유지).

## 12. Sample Audit (필드 발견)

지정된 5개 학교(구덕초등학교/대신초등학교/과정초등학교/해원초등학교/경남중학교)
+ 고등학교 1곳(가야고등학교)의 실제 API 응답을 직접 조회해 필드 구조를 확인했다.
`apiType=0`은 기본정보+좌표, `apiType=09`는 학생수/학급수/교원수+학년별 배열을
모두 포함해 별도 교원 API(`apiType=22`) 호출이 불필요함을 확인했다. 이력 레코드
(`ABSCH_YN='Y'`)에는 `ADRES_BRKDN` 필드 자체가 없는 경우가 있음을 발견(§오류 #1).

## 13. Dry-run

전체 664개 학교에 대해 `--apply` 없이 실행 → `READY`/`UNCHANGED`/`REVIEW`/
`NO_SOURCE` 분류. 최초 강서구(26440) 실행에서 크래시(§오류 #1) 발견 후 수정,
재실행 시 REVIEW 0건까지 도달했다.

## 14. Full 664 Dry-run (수정 후 최종)

- READY: backfill 대상 전원(적용 전 기준)
- REVIEW(동명이교 등 identity 모호): **0건**
- NO_SOURCE: 31건(학교알리미가 다루지 않는 특수 학교급 27건 — 외국인학교/평생학교/
  각종학교/방송통신/공동실습소/고등기술학교 — + 통계 자체가 공시되지 않은 개별
  학교 4건, 예: 괘법초등학교 apiType=09 결과 없음, identity는 정상 매칭)
- FAILED_RETRYABLE: 0건(네트워크/HTTP 실패 없음)
- WRONG_SCHOOL: 0건

## 15. Apply (Production)

1차 apply에서 Prisma Json 배열 `undefined` 오류로 다수 SchoolStat 쓰기가
try/catch에 조용히 실패(§오류 #2) → `normalizeGradeSlot` 수정 후 재실행 →
`inserted=312, updated=0, skipped=352`(352 = NO_SOURCE 31 + 1차 실행에서 이미
좌표/주소만 성공적으로 써진 UNCHANGED 321)로 정상 종료. 최종 프로덕션 상태는
§19에서 직접 쿼리로 재확인했다.

## 16. Retry/Resume 설계

`scripts/education/backfill-school-data-v1.ts`는 학교급×구/군 배치를 메모리에
캐시(`BatchCache`)해 동일 배치를 중복 호출하지 않고, 매 실행마다 전체 결과를
`tmp/qa/school-backfill-checkpoint.json`에 기록한다(항상 기록, `--json` 여부와
무관). `--resume` 플래그로 이미 처리된 학교를 건너뛸 수 있으나, 이번 664건은
API 호출량이 충분히 작아(16구×4학교급×2apiType ≈ 128회) 세션 타임아웃 없이
1회 실행으로 완료되어 resume이 실제로 필요하지는 않았다.

## 17. Rate Limiting

배치 단위(구/군×학교급) 호출로 학교 개수만큼 반복 호출하지 않았다(N+1 회피,
128회 이내). 별도 인위적 delay 없이도 학교알리미 API가 에러 없이 전량 응답했다
— 429/5xx 발생 시 `SchoolInfoApiError(retryable=true)`로 구분해 재시도 가능하게
설계했으나 이번 실행에서는 발생하지 않았다.

## 18. Coverage Before

- School: 664행 (변경 없음, 이 STEP은 School row를 추가/삭제하지 않는다)
- School 공식 좌표 보유: 0/664 (0%)
- SchoolStat: 0행
- 학생수/학급수/교원수 커버리지: 0%

## 19. Coverage After (production DB 직접 쿼리로 재확인)

| 학교급 | School 수 | SchoolStat 확보 | 공식 좌표 확보 |
|---|---|---|---|
| 초등학교 | 305 | 302 | 305 |
| 중학교 | 171 | 171 | 171 |
| 고등학교 | 142 | 141 | 141 |
| 특수학교 | 16 | 16 | 16 |
| 기타(외국인/평생/각종/방송통신/공동실습소 등) | 30 | 0 | 0 |
| **합계** | **664** | **630 (94.9%)** | **633 (95.3%)** |

- 학생수/학급수/교원수 커버리지: SchoolStat 630행 전부 3개 필드 100% 채움
  (0을 임의로 채운 것이 아니라 실제 원본이 있는 행만 insert했으므로).
- `gradeBreakdown` 채움: 630/630(SchoolStat이 있으면 항상 학년별 배열도 함께 있음).
- 여전히 좌표/통계가 없는 7개 orphan(구/군 미확보) 학교는 §24 참고.

## 20. Idempotency

- backfill 성공 직후 dry-run 재실행 → `READY=0, UNCHANGED=633, REVIEW=0,
  NO_SOURCE=31` (정확히 기대한 결과).
- `--apply` 2차 실행 → `inserted=0, updated=0, skipped=664`(쓰기 0건) — PASS.

## 21. School Detail API/UI QA

`/api/school/[id]` 응답에 `stat` 블록(referenceYear/studentCount/classCount/
teacherCount/sourceName/derived) 추가. 5개 지정 학교 + district 대표 1곳
(가야초등학교 계열 26230)까지 curl로 직접 검증:

- 구덕초등학교(7171046): 학생 371/학급 19/교원 23, 학급당 19.5명, 교원 1인당 16.1명
- 대신초등학교(7171056): 712/31/41, 23.0명/17.4명
- 과정초등학교(7191048): 392/21/26, 18.7명/15.1명
- 해원초등학교(7211185): 1048/44/56, 23.8명/18.7명
- 경남중학교(7171011): 441/19/30, 23.2명/14.7명
- 가남초등학교(26230, district 대표): 50/7/9, 7.1명/5.6명

전부 `status: OK`, 계산값 수기 검산 일치. claude-in-chrome으로 구덕초등학교·
경남중학교 실제 렌더링(데스크톱 960px, 모바일 390px iframe-isolation)까지
확인 — 관련 아파트/가격/거리 섹션도 회귀 없이 정상 동작.

## 22. UI Unlock

`src/app/school/[id]/school-detail-client.tsx`의 "한눈에 보는 학교" 섹션을
`stat` 존재 여부로 분기: 데이터가 있으면 5개 카드(학생수/교원수/학급수/학급당
학생수/교원 1인당 학생수)를, 없으면 기존 "연동 준비 중" 문구를 그대로 유지한다
(§0 원칙 — 데이터 없으면 임의 생성 금지). 괘법초등학교(NO_SOURCE 사례)로 fallback
경로도 정상 확인.

## 23. Raw vs Derived

- RAW(학생수/교원수/학급수): 카드에 `출처: 학교알리미 OpenAPI(공시정보)` 회색
  태그로 표시.
- DERIVED(학급당 학생수, 교원 1인당 학생수): `이집 계산값` 파란색 태그로 별도
  표시, DB에는 저장하지 않고 API 응답 시점에 `studentsPerClass`/
  `studentsPerTeacher`(순수 함수, 0 나눗셈 방지)로만 계산.

## 24. Data Trust 준수 확인

- 이름만으로 학교 결합: 없음(구/군 스코프 + dongName 이중 확인).
- 동명이교에 첫 결과 사용: 없음(REVIEW 0건까지 확인).
- 결측치를 0으로 치환: 없음(`normalizeGradeSlot`은 "슬롯 없음"과 "원본 0"을
  구분, `validateSchoolStat`은 null을 그대로 통과시킴).
- 전국/부산 평균 대체: 없음(개별 학교 원본 값만 저장).
- LLM 생성 데이터/검색엔진 결과 사용: 없음.
- 좌표 임의 보정: 없음(원본 좌표 그대로, 범위 검증만 REVIEW 게이트로 사용).

## 25. Source Limitations & 남은 School Data Gap

- 특수 학교급 27개교(외국인학교/평생학교/각종학교/방송통신고·중/공동실습소/
  고등기술학교)는 학교알리미 통계 공시 대상이 아니거나 이번 API 조합으로
  확인되지 않아 NO_SOURCE로 남았다 — 추정하지 않고 정직하게 미확보 상태 유지.
- 개별 학교 4건(예: 괘법초등학교)은 identity/좌표는 정상 매칭됐지만 해당
  학교의 apiType=09 통계 자체가 2026년 공시에 없어 NO_SOURCE — 학교알리미
  원본 자체의 한계이며 이집 쪽 로직 결함이 아님.
- 구/군 미확보 orphan 7개교(영재학교, 병설유치원, 학력인정 고등학교 계열 등)는
  School.sidoCode/sigunguCode가 여전히 null — 전체 16개 구/군을 순회 검색했지만
  이름 자체가 일반 학교알리미 목록과 다르게 등재되어 매칭되지 않았다. 후속
  STEP에서 별도 특수학교 식별 전략이 필요하다(SCHOOL_DATA_GAP_FIX 후보).
- 학생 성별 분리, 재학생 구성, 학교 특색 데이터는 현재 소스/스키마가 지원하지
  않아 이번 STEP 범위에서 다루지 않았다(신규 schema 강제 없음, LATER).

## 코드 변경 요약

- 신규: `src/lib/education/schoolinfo-client.ts`, `schoolinfo-match.ts`(+test),
  `schoolinfo-stat-validate.ts`(+test), `scripts/education/backfill-school-data-v1.ts`
- 수정: `src/app/api/school/[id]/route.ts`(stat 블록 추가), `src/app/school/[id]/school-detail-client.tsx`
  (통계 카드 UI), `src/app/school/[id]/school-detail.module.css`(카드 스타일)
- 테스트: `.test.mjs` 135/135 PASS, `.test.ts` 361/361 PASS(전체 회귀, 신규 21개
  포함). `npx tsc --noEmit`: 이번 STEP 변경 파일 기준 에러 0(사전 존재하던
  무관 스크립트 오류만 별도 존재 — `FAIL_EXISTING_SCRIPT_ERRORS`, 상세는 최종
  리포트 참고). Lint: 변경 파일 기준 에러 0(`prefer-const` 1건 자체 수정).
  `npm run build`: PASS.
