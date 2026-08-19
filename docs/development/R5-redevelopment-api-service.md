# STEP R5 — Redevelopment API / Service Layer

상태: **완료 — UI 변경 없음, schema/migration 변경 없음, production ingestion 재실행
없음(read-only 검증만)**

## architecture

```text
src/lib/redevelopment/service.ts   — API route가 호출하는 유일한 진입점.
                                      Prisma 쿼리는 이 파일 안에서만 작성한다.
src/app/api/redevelopment/route.ts        — GET 목록(필터/검색/페이지네이션)
src/app/api/redevelopment/[id]/route.ts   — GET 상세(source summary 포함)
```

기존 `RedevelopmentProject`/`RedevelopmentSourceRecord` 조회 로직
(`src/app/api/properties/route.ts`의 REDEVELOPMENT 분기)은 건드리지 않았다 —
그 라우트는 이미 R4에서 `sido`/`sigungu` 필터로 전환됐고 이번 STEP과 목적이
다르다(카테고리 통합 지도 API 대 재개발 전용 API). 두 라우트는 공존한다.

## service functions

- `listRedevelopmentProjects(prisma, params)` — 필터/검색/페이지네이션.
- `getRedevelopmentProjectById(prisma, id)` — 상세 + source summary + 데이터
  품질 + field provenance. 없으면 `null`(404 판단은 route.ts 책임).
- `getRedevelopmentMapProjects(prisma, params)` — 지도 전용, 안전 좌표가
  있는 project만(현재 production 기준 0건 반환 — 정직한 결과, 아래 참고).

`searchRedevelopmentProjects()`를 별도 함수로 만들지 않았다 — `q` 파라미터를
`listRedevelopmentProjects()`에 통합해 필요 최소 함수만 유지했다(섹션 3
"필요 최소만").

## list API

```text
GET /api/redevelopment?sido=&sigungu=&businessType=&stage=&q=&page=&pageSize=
```

응답:

```json
{
  "success": true,
  "data": {
    "items": [...],
    "page": 1,
    "pageSize": 20,
    "total": 1798,
    "totalPages": 90
  }
}
```

기존 `api/properties/route.ts`의 `{ success, data }` 봉투 관례를 그대로
따랐다(섹션 5의 "실제 naming은 project convention 우선" 반영).

## detail API

```text
GET /api/redevelopment/[id]
```

목록 item shape + `canonicalName`/`normalizedName`/`sources[]`/
`dataQuality`/`fieldProvenance`.

## filters

- `sido`/`sigungu`: exact match, `sido`만 축약형("부산")을 허용하고
  `src/lib/regions.ts`의 `SIDO_LIST` 기준으로 canonical 값("부산광역시")으로
  정규화한다(섹션 12). 매칭 안 되면 원본 문자열을 그대로 써서 0건이
  나오게 둔다(추측하지 않음).
- `businessType`/`stage`: R3B enum 값과 정확히 일치해야 한다 — 안 맞으면
  `InvalidRedevelopmentQueryError` → route.ts가 400으로 변환.

## search

`q`는 `canonicalName`에 대한 부분일치(`contains`)만 지원한다(섹션 11 최소
요구사항). "서대신4"/"아미1"/"아미3" 전부 검색 가능함을 실제 API로 확인.

## pagination

기본 `page=1`, `pageSize=20`, 최대 `pageSize=100`(그 이상 요청해도 100으로
clamp, 전체 무제한 반환 금지 — 섹션 5). `page`/`pageSize`가 숫자가 아니면
(`NaN`) 조용히 기본값으로 떨어진다 — 400도 500도 아니고 안전한 기본 동작
(실사용 편의를 우선, invalid enum처럼 "무엇을 요청했는지 모호한" 경우만
400).

## default sort

`updatedAt DESC, canonicalName ASC` — stage enum 문자열 순서로 정렬하지
않는다(섹션 15가 명시적으로 경고한 함정, stage progression 순서 매핑까지는
이번 STEP에서 만들지 않고 V1 안전한 단순 정렬을 선택).

## 목록 item shape

```ts
{
  id, name, sido, sigungu, businessType, stage, status, householdCount,
  latitude, longitude, locationType, locationConfidence,
  hasSafeMapLocation, primarySource, dataUpdatedAt, needsReview
}
```

## 지도 좌표 안전성

**production 기준 `lat`/`lng`가 채워진 project는 0건이다**(R4/R4.1에서
전체 지오코딩을 실행하지 않았기 때문 — 의도된 상태). `hasSafeMapLocation`은
`lat != null && lng != null && locationType === 'PROJECT_SITE'`로만
true가 된다 — 좌표가 있어도 `locationType`이 `OFFICE`/`APPROXIMATE`/
`UNKNOWN`이면 false. `getRedevelopmentMapProjects()`도 같은 조건으로
필터링해 현재는 빈 배열을 반환한다 — **좌표를 지어내지 않는다**(섹션 7
금지 목록: OFFICE를 사업 위치로 반환 금지, UNKNOWN에 임의 좌표 생성 금지,
sigungu 중심점을 project location처럼 반환 금지 — 셋 다 하지 않았다).
R6 UI는 "목록은 보이지만 지도 marker는 없음"을 정상 상태로 처리해야 한다.

## source summary

상세 API의 `sources[]`는 `rawPayload`를 제외한 필드만 노출한다(섹션 9):
`source`, `rawName`, `rawBusinessType`, `rawStage`, `rawHouseholdCount`,
`sourceUpdatedAt`, `collectedAt`, `matchConfidence`, `mergeStatus`.
단위 테스트로 `rawPayload` 값이 응답 JSON 어디에도 없음을 직접 확인했다.

## field provenance

새 provenance 테이블을 만들지 않았다(섹션 10) — `sources[]`에 어느
source가 존재하는지만으로 R2/R3B가 이미 정한 고정 우선순위 규칙(존재/
일반유형=국토부, 진행단계/세대수=부산시 있으면 부산시 우선)을 그대로
텍스트로 서술하는 `describeFieldProvenance()` 순수 함수를 추가했다.
서대신4 실제 상세 API 응답에서 `"stage": "부산시 기준"` 확인, 아미1/아미3
(MOLIT-only) 패턴에서 `"stage": "국토부 기준"` 확인.

## matchConfidence 재동기화 덮어쓰기 fix

**원인**: `ingestRecord()`가 매 호출마다 항상 후보 매칭을 다시 계산했다 —
이미 존재하는 SourceRecord를 재동기화(re-sync)할 때도 예외가 없어, 그
레코드가 이미 만들어둔 canonical project를 후보로 다시 조회하면 트리비얼한
self-EXACT가 나와 원래 matchConfidence(최초 ingest 시점의 실제 cross-source
매칭 품질)를 덮어썼다(R4 FINAL에서 production 2회 재실행으로 발견).

**수정**: `ingestRecord()` 시작 지점에 `findUnique`로 기존 SourceRecord
존재 여부를 먼저 확인한다. 존재하면 후보 매칭을 아예 실행하지 않고
raw 필드(stage 진행 등 실제로 갱신될 수 있는 값)만 `update()`로 최신화한
뒤, `matchConfidence`/`mergeStatus`/`projectId`는 그대로 보존한다. 새
레코드일 때만 기존 매칭 로직(후보 조회 → confidence 계산 → 생성/연결)을
탄다. 새 schema 변경 없이 해결했다(섹션 18 지시대로 최소 수정 우선,
STOP 필요 없었음).

`RedevelopmentPrismaClient` 인터페이스에 `update` 메서드를 추가했고
(`InMemoryRedevelopmentStore`도 동일하게 구현), `IngestOutcome.action`에
`'resynced'`를 추가해 재동기화 경로를 구분할 수 있게 했다.

## fix 검증(신규 3개 회귀 테스트, ingest.test.ts)

- MEDIUM으로 처음 매칭된 레코드를 재ingest해도 `matchConfidence`가 여전히
  `MEDIUM`(`EXACT`로 덮어써지지 않음), `action='resynced'`, project/
  sourceRecord 수 불변 — 확인.
- EXACT로 매칭된 레코드도 재ingest 후 그대로 `EXACT` 유지 — 확인.
- 재동기화 시 raw 필드(예: stage가 조합설립인가→착공으로 진행)는 계속
  최신화되고 canonical 재계산에도 반영된다는 것 — 확인(matchConfidence만
  보존, 나머지는 정상 갱신).

**production에는 이 fix를 반영해 재적재하지 않았다** — 이번 STEP은 코드
수정 + 인메모리 테스트 검증까지만이고, production ingestion 재실행은
지시대로 하지 않았다("read-only verification 필요한 경우 외 금지"). 그래서
production의 기존 SourceRecord들은 여전히 R4 FINAL 2차 재실행 때 덮어써진
`matchConfidence=EXACT`(전부)를 갖고 있다 — 다음에 실제로 재동기화를
돌리면 그 시점부터는 새 레코드만 진짜 confidence를 얻고, 기존 레코드는
이 STEP의 fix로 인해 더 이상 재계산되지 않아 EXACT인 채로 남는다(과거
값을 소급 복구하지는 않음, 이 fix는 "앞으로의 덮어쓰기 방지"이지 "과거
데이터 복구"가 아니라는 점을 문서에 명시).

## Seo-gu / 대표 사업 검증(local dev, production DB against)

```text
GET /api/redevelopment?sido=부산&sigungu=서구  → total: 24  (R4 FINAL과 일치)
GET /api/redevelopment?q=서대신4               → 1건, stage=CONSTRUCTION, householdCount=542
GET /api/redevelopment/648                     → sources=[MOLIT, BUSAN_CITY], dataQuality=OK,
                                                   fieldProvenance.stage="부산시 기준"
GET /api/redevelopment?q=아미1                 → 1건, MOLIT-only, RESIDENTIAL_ENVIRONMENT/ZONE_DESIGNATED
GET /api/redevelopment?q=아미3                 → 1건, 동일 패턴
GET /api/redevelopment?sido=서울               → total: 644
GET /api/redevelopment?sido=경기               → total: 241
GET /api/redevelopment?sido=부산               → total: 461
```

전부 R4 FINAL이 기록한 production 값과 정확히 일치.

## performance

- 목록 쿼리는 `RedevelopmentProject`만 조회하고(`sourceRecords` include
  없음) — N+1 없음. 상세만 `include: { sourceRecords: true }`.
- 필터(`sido`+`sigungu`, `businessType`, `stage`)는 기존 R3B 인덱스
  (`@@index([sido, sigungu])`, `@@index([businessType])`,
  `@@index([stage])`)로 전부 커버된다 — 새 인덱스 불필요,
  `SCHEMA_INDEX_REVIEW` 보고 대상 없음.
- `q`(`contains`) 검색과 `updatedAt` 정렬은 인덱스를 못 타 시퀀셜 스캔이
  되지만, 현재 1,798행 규모에서는 무관(실측 API 응답 즉시 반환). 데이터가
  수만 건 이상으로 늘면 trigram/updatedAt 인덱스 검토 필요 — 이번 STEP
  범위 밖(migration 금지).
- 과도한 캐시 레이어를 추가하지 않았다(섹션 23) — `force-dynamic`만
  적용(기존 `api/properties/route.ts`와 동일 관례).

## tests

신규 20건(`service.test.ts`) + 재동기화 회귀 3건(`ingest.test.ts`) —
**전체 88개 pass**(기존 65 + 신규 23). filter/pagination/search/detail/
404/enum validation/matchConfidence persistence 전부 커버.

## R6 contract

목록 카드에 필요한 필드:

```text
name, businessType(BUSINESS_TYPE_LABELS로 한글 변환), stage(STAGE_LABELS로
한글 변환), status, householdCount, hasSafeMapLocation(마커 표시 여부
판단용 — 현재 전부 false), primarySource, dataUpdatedAt
```

상세에 필요한 필드:

```text
canonicalName, sido/sigungu, businessType/stage/status, householdCount,
sources[](출처별 원본 요약), dataQuality("REVIEW_REQUIRED"면 UI가 주의
안내 가능), fieldProvenance(어느 소스 기준인지 설명)
```

`STAGE_LABELS`/`BUSINESS_TYPE_LABELS`(한글 라벨 매퍼)는
`src/lib/redevelopment/service.ts`에 이미 만들어뒀다 — R6가 바로 import해
쓸 수 있다.

## typecheck / lint / build / tests

전부 통과(0 errors, 88/88 tests, 기존 라우트 회귀 없음 — `/api/properties`,
`/api/presales`, `/api/apt/[name]`, `/api/school/stats` 로컬 smoke 확인).

## DB / schema / migration / production ingestion

**전부 무변경.** 이번 STEP은 API/service 코드만 추가했고, `prisma/
schema.prisma`는 건드리지 않았다. production에 대해서는 read-only 조회
(local dev 서버가 `.env`의 production DATABASE_URL로 연결해 실제 API
응답을 검증)만 수행했다 — insert/update/delete 없음(`ingestRecord`의
matchConfidence fix 자체도 코드 수정일 뿐 production에 재실행하지 않음).

## unresolved

1. matchConfidence fix는 코드 레벨 방지책이지 소급 복구가 아니다 — 현재
   production SourceRecord의 matchConfidence는 R4 FINAL 2차 재실행 때
   덮어써진 상태(대부분 EXACT) 그대로 남아있다. 필요하면 다음 정식
   재동기화 실행 시점부터 정확해지거나, 별도 backfill 스크립트를
   작성해야 한다(이번 STEP 범위 밖).
2. `q` 검색/`updatedAt` 정렬이 인덱스를 타지 않는다 — 현재 규모에서는
   무관하나 데이터 급증 시 재검토 필요.
3. R4/R4.1의 기존 unresolved(office 좌표 실제 지오코딩 파일럿, 부산
   UNRESOLVED 37건, similarity 임계치 검증 등)는 이번 STEP 범위 밖으로
   그대로 유지.

## R6_GO 판단

```text
list API 정상:            Yes
detail API 정상:          Yes
filters 정상:              Yes
search 정상:                Yes
pagination 정상:            Yes
부산 서구 24건:              Yes
서대신4 정상:                Yes
아미1/아미3 정상:            Yes
safe map semantics:        Yes(좌표 0건, 정직하게 반환)
matchConfidence 덮어쓰기 fix: Yes(코드 수정+테스트 검증, production 소급 복구는 아님)
typecheck/lint/build/tests: 전부 통과
```

**R6_GO.**
