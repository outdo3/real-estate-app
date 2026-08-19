# STEP R4 — Redevelopment Master DB Schema 적용 + Ingestion/Sync 구현

상태: **schema/migration 생성 완료(production 미적용) — ingestion 코드 구현·인메모리
파일럿 검증 완료 — production DB migration/insert는 검수 전까지 미실행**

## 목적

R3B에서 설계(문서)만 하고 적용하지 않은 Redevelopment Master DB 구조(`RedevelopmentProject`
+ `RedevelopmentSourceRecord`)를 실제 `prisma/schema.prisma`에 반영하고, 국토부 전국
1,566건 + 부산광역시 정비사업 343건을 실제로 파싱·정규화·매칭·병합할 수 있는
ingestion 파이프라인을 구현한다. Production migration 실행과 production insert는
이번 STEP 범위 밖(검수 후 별도 승인 필요)이다.

## schema changes

`docs/development/R3B-redevelopment-master-schema-design.md`의 "Recommended schema"
섹션을 그대로 `prisma/schema.prisma`에 적용했다 — 재설계하지 않음. 기존
`RedevelopmentProject`(단일 테이블, 6단계 enum)를 대체하고 `RedevelopmentSourceRecord`를
신규 추가했다.

- **대체된 모델**: `RedevelopmentProject`(기존 `zoneName`/`lawdCd`/`stage`(6단계)/
  `targetHouseholds`/`polygonGeojson` 필드 전부 제거, 새 필드 세트로 교체)
- **대체된 enum**: `RedevelopmentStage`(6단계 → 15단계, `PLANNED`/`UNKNOWN` 등 9종 신규)
- **신규 모델**: `RedevelopmentSourceRecord`
- **신규 enum**: `RedevelopmentBusinessType`, `RedevelopmentProjectStatus`,
  `RedevelopmentLocationType`, `RedevelopmentLocationConfidence`,
  `RedevelopmentGeocodeStatus`, `RedevelopmentMatchConfidence`, `RedevelopmentMergeStatus`
- **다른 모델**: 전혀 건드리지 않음(`git diff --stat` 기준 `prisma/schema.prisma`
  안에서도 redevelopment 관련 블록만 변경).
- **SCHEMA_IMPLEMENTATION_ADJUSTMENT**: 없음 — R3B 확정안을 그대로 적용했고 Prisma
  제약으로 인한 강제 수정은 발생하지 않았다.

## migration

- **production 데이터 존재 여부**: read-only `count()` 쿼리로 재확인 — **0건**
  (MIGRATION_RISK 없음, R3B 판단 재확인).
- **생성 방법**: `prisma migrate dev --create-only`는 비대화형 환경 제약으로 실패해,
  `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel
  prisma/schema.prisma --script`로 순수 SQL diff를 생성(DB에 아무 영향 없음)한 뒤 직접
  `prisma/migrations/20260819110211_redevelopment_master_schema_r4/migration.sql`로
  저장했다.
- **destructive SQL 검토**: `DROP COLUMN`(구 필드 4개) + enum 값 교체(`ALTER TYPE ...
  RENAME`)는 있지만 `DROP TABLE`/`TRUNCATE`/`DELETE`는 없다. enum 교체는
  `ALTER TABLE ... USING ("stage"::text::"RedevelopmentStage_new")` 캐스팅을 쓰는데,
  테이블이 비어 있어(0행) 캐스팅 실패 위험이 없다.
- **다른 모델 영향**: diff 파일 전체(98줄)에 `redevelopment_projects`/
  `redevelopment_source_records` 외 테이블 참조가 전혀 없음 — `Property`, `Apartment`,
  `User`, `Post` 등 다른 모델은 SQL 레벨에서도 확인상 무관.
- **적용 상태**: `npx prisma migrate status`로 재확인 — **`Following migration have
  not yet been applied: 20260819110211_redevelopment_master_schema_r4`**. Production
  `redevelopment_projects` 테이블은 여전히 옛 구조 그대로다.

## importer architecture

```text
src/lib/redevelopment/     — 재사용 가능한 순수 로직(단위 테스트 대상)
  types.ts                 공유 타입
  csv.ts                   국토부 CSV 최소 RFC4180 파서(신규 의존성 없음)
  normalize.ts              normalizedName(R3B 확정 규칙)
  businessType.ts           국토부 코드/부산 접미사 → canonical businessType
  stage.ts                  국토부 코드/부산 라벨 → canonical stage, projectStatus 파생
  fingerprint.ts             국토부 결정론적 sourceRecordId
  officeDetector.ts          location 텍스트 → locationType/locationConfidence(R3A 안전장치)
  matching.ts                후보 대비 matchConfidence 계산(EXACT~UNMATCHED)
  merge.ts                   canonical 필드 재계산(source priority, needsReview 판정)
  parse.ts                   원본 row/record → ParsedSourceRecord
  ingest.ts                  match-or-create-Project → upsert SourceRecord →
                              canonical 재계산까지 레코드 1건 파이프라인 전체
  inMemoryStore.ts            Prisma 없이 ingest.ts를 그대로 재사용하는 테스트/파일럿용
                              인메모리 구현(구조적 타입이라 실제 Prisma와 교체 가능)
  *.test.ts                  node:test 기반 단위/통합 테스트(신규 패키지 설치 없음)

scripts/redevelopment/     — 일회/관리용 runner
  import_molit.ts            국토부 CSV 실제 다운로드(3-step 흐름 재현) + import
  import_busan.ts             부산 API 실제 호출 + import
  quality_report.ts           MOLIT+BUSAN 실물 데이터로 인메모리 파일럿 실행 + 집계
```

## MOLIT importer

- **다운로드**: R2가 문서화한 흐름(`selectFileDataDownload.do` →
  `check-limit.json` → `fileDownload.do`)을 코드로 재구현해 이번 STEP에서
  **실제로 다시 실행**, `publicDataPk=15160169`,
  `publicDataDetailPk=uddi:4d7f16a9-b0fd-4d07-b266-d0ad82aeaf34`를 페이지 HTML에서
  확인 후 사용. 응답 `atchFileId=FILE_000000003667489`, 파일 크기 **123,933 bytes**
  — R2가 기록한 크기와 정확히 일치(재현성 확인됨). URL을 추측하지 않고 매 실행마다
  이 흐름을 다시 타므로 국토부가 파일을 갱신해도(연 1회) 코드 변경 없이 최신 파일을
  받는다.
- **CAPTCHA 처리**: `check-limit.json` 응답의 `needCaptcha`가 true면
  `CAPTCHA_REQUIRED` 에러로 명확히 실패시키고 조용히 빈 데이터로 넘어가지 않는다.
- **인코딩**: CP949 대신 `TextDecoder('euc-kr')` 사용(Node 표준 인코딩 목록에
  cp949가 없어 상위호환인 euc-kr로 디코딩 — 실사용 한글 범위에서 안전, 새 npm
  의존성 추가 없음).
- **스키마 방어**: CSV 헤더가 R1/R2 실측(7컬럼)과 다르면
  `SCHEMA_IMPLEMENTATION_ADJUSTMENT` 에러로 즉시 실패(다른 형식으로 조용히
  잘못 파싱하지 않음).
- **--dry-run 실행 결과(실제 데이터, DB 쓰기 없음)**:

  ```json
  fetched: 1566
  identicalDuplicateRows: 1   (R2가 기록한 완전중복 1건과 정확히 일치)
  conflictingDuplicateRows: 1 (신규 발견 — 아래 "신규 발견" 참고)
  unknownBusinessType: 0
  unknownStage: 0
  sidoBreakdown: 17개 시도 전부, 서울 644 / 경기 241 / 부산 227 등 — R2와 정확히 일치
  ```

## BUSAN importer

- **API 응답 형식**: `type=json` 파라미터를 줘도 XML로 응답한다(재확인). 이
  프로젝트가 이미 `api-molit.ts`에서 쓰는 `fast-xml-parser` 패턴을 그대로 재사용.
- **--dry-run 실행 결과(실제 데이터)**:

  ```json
  fetched: 343
  unknownBusinessType: 0
  unknownStage: 0
  sigunguResolved: 148  (location 텍스트에 구/군명이 직접 포함된 경우만, R1과 동일 방식)
  sigunguUnresolved: 195
  ```

## normalization

`normalizeName()` = 공백 제거 + "제" 제거만(R3B 확정, 유형 접미사는 지우지 않음).
단위 테스트로 "거제2 재개발"/"거제2 재건축"이 정규화 후에도 서로 다른 문자열로
남는 것, "촉진5"가 정규화만으로는 구·군을 구분하지 못하는 것(별도 sido/sigungu
비교가 반드시 필요함)을 회귀 테스트로 고정했다.

## business type / stage mapping

R2에서 실측한 표 그대로 코드화(추정 없음):

- 국토부 5개 코드(1~5) → `REDEVELOPMENT`/`RECONSTRUCTION`/`RESIDENTIAL_ENVIRONMENT`
- 국토부 7개 stage 코드(2,3,4,5,6,7,17, R2가 확인한 "1과 8~16은 미관측") →
  15종 canonical stage
- 부산 12종 step 라벨 → 15종 canonical stage 전수 매핑(단위 테스트로 12종 전부 검증)
- 부산 areaName 접미사(재개발/재건축/가로주택정비/소규모재건축) → canonical
  businessType(공식 필드가 아니라 추정이라는 사실을 코드 주석에 명시)

## matching

R3A "match confidence 설계"(EXACT/HIGH/MEDIUM/LOW/UNMATCHED)를 코드로 구현.
`normalizedName` 완전 일치 시 `businessType`이 둘 다 known인데 다르면 **LOW로
강등**한다(거제2 재개발 vs 재건축 회귀 테스트로 고정) — R3A가 발견한 "유형 접미사
제거가 오매칭을 만든다"는 교훈을 알고리즘 레벨에서 재현.

## canonical merge

R2 source priority(존재/일반유형=국토부, 소규모주택정비=부산, 진행단계/세대수=부산)를
`mergeCanonicalFields()`에 그대로 반영. `needsReview` 자동 판정 2종:
businessType 충돌(R3A "국토부 내부 중복" 패턴), 세대수 30%+ 불일치(R3A "명서1: 1521
vs 785" 패턴). 두 패턴 모두 통합 테스트로 고정.

## location safety

`classifyLocationText()`가 R3B "office 좌표 처리 전략"을 구현 — 층/호/상가/빌딩/
오피스/조합/사무실 패턴이 있으면 무조건 `OFFICE`+`LOW`로 분류(단어 하나만으로
site를 확정하지 않는 것과 반대 방향으로, office 판정은 보수적으로 과탐지되도록
설계 — R3A가 밝힌 "지오코딩 성공의 82%가 사무실"이라는 위험을 놓치지 않기 위함).
**이번 STEP에서는 343건 전체에 대한 실제 지오코딩(좌표 확보)은 실행하지 않았다**
(섹션 35 지시 — quota/오탐 위험, 정책 검증 우선). `classifyLocationText()` 자체는
구현·테스트 완료 상태라 R5/R6에서 파일럿부터 바로 적용 가능하다.

## idempotency

`ingest.test.ts`에서 같은 레코드를 3회 반복 `ingestRecord()`해도 project/
sourceRecord 수가 늘지 않는 것을 통합 테스트로 확인(인메모리 스토어 사용, DB
없이도 실제 파이프라인 코드 경로 100% 실행). MOLIT+BUSAN 두 소스를 섞어 반복해도
1 project + 2 sourceRecord로 수렴하는 것도 확인.

## quality report(실물 데이터 파일럿 — DB 쓰기 없음)

`scripts/redevelopment/quality_report.ts`로 MOLIT 1,566행 + 부산 343건을 실제로
받아 `ingestRecord()`를 인메모리 스토어에 그대로 실행한 결과:

```text
canonical projects:     1,904
source records:         1,907
MOLIT-only projects:    1,562
BUSAN-only projects:      340
merged(양쪽 연결) projects: 2

matchConfidence 분포: EXACT 3 / HIGH 0 / MEDIUM 67 / LOW 455 / UNMATCHED 1,382
needsReview projects: 0
```

원본 JSON: `scripts/redevelopment/_results/quality_report_*.json`(커밋 대상 아님,
`.gitignore`의 `scripts/_backfill_results/` 패턴과 동일하게 취급 권장).

### 신규 발견 1 — 국토부 내부 "conflicting duplicate" 1건(R2에 없던 사례)

`대구광역시/남구/봉덕1동/1)재개발(주택정비)` 조합이 세대수만 다르게(1091 vs 621)
두 번 등장한다. fingerprint에 stage/세대수를 포함하지 않는 R3B 설계상 이 두 행은
같은 SourceRecord로 흡수되고, **CSV상 나중에 나오는 행의 값이 최종적으로 남는다**
(최신을 추정하지 않는다는 원칙과 별개로, 흡수 순서 자체가 "정답 판단"이 아니라
"CSV 순서"라는 사실을 여기 정직하게 기록한다 — R2가 발견한 1건과는 다른 새로운
사례이며, 로직 버그가 아니라 실제 원본 데이터의 특성이다).

### 신규 발견 2 — merged=2는 낮다: 부산 sigungu 해석률이 실제 병목

matchConfidence 분포 자체(EXACT/HIGH/MEDIUM/LOW 판정 로직)는 51개 단위 테스트로
검증되어 있지만, **실제 파일럿에서 merged 프로젝트가 2건에 그친 진짜 원인은
매칭 알고리즘이 아니라 부산 레코드의 sigungu 해석 실패**다 — `extractSigunguFromLocation()`
이 location 텍스트에서 "OO구"/"OO군" 리터럴 문자열만 찾기 때문에(R1/R2와 동일
방식), "대영로45번길20, 3층(서대신동2가)"처럼 **동 이름만 있고 구 이름 자체가
텍스트에 없는 경우(부산 서구가 특히 이 패턴, R1의 "서구 0" 발견과 정확히 같은
현상)** sigungu가 "미상"으로 떨어져 애초에 매칭 후보 조회(`sido+sigungu` 인덱스)
대상에 들지 못한다.

**"서대신4" 검증 결과가 바로 이 문제의 실증 사례다** — 아래 참고.

## Seo-gu(서구) verification

- **부산 서구 canonical project 수**: 20건 — R2가 CSV로 확정한 "부산 서구 20건"과
  정확히 일치(국토부 데이터만으로도 서구가 통째로 빠지는 일은 없다는 R1의 원래
  우려가 R2/R4 양쪽에서 재확인됨).
- **서대신4**: **MOLIT-only(id 648) + BUSAN-only(id 1883) 두 개의 별도 Project로
  분리됨 — 자동 병합 실패.** 원인은 위 "신규 발견 2" — 부산 레코드의 `location`
  텍스트("대영로45번길20, 3층(서대신동2가)")에 "서구"라는 문자열 자체가 없어
  sigungu가 "미상"으로 떨어졌기 때문이다(코드 버그가 아니라 위치 텍스트 기반
  sigungu 해석의 근본적 한계). 두 레코드 각각의 stage(`CONSTRUCTION`)와
  householdCount(542)는 정확히 일치하므로, sigungu만 올바르게 해석됐다면 R3A가
  예측한 대로 EXACT 매칭됐을 것이다.
- **아미1 / 아미3**: 기대대로 **MOLIT-only**, `businessType=RESIDENTIAL_ENVIRONMENT`,
  `stage=ZONE_DESIGNATED` — R3A 문서의 예측과 정확히 일치. 좌표 없음, 데이터
  숨기지 않고 그대로 유지됨.

## nationwide sanity check

17개 시도 전부에서 canonical project가 생성됨(서울/경기/부산/대구/인천 등) —
Master가 부산 전용으로 잘못 필터링되지 않았음을 확인.

## test results

```text
npx tsc --noEmit                — 0 errors
npx eslint (변경 파일 전체)      — 0 errors
npx next build                  — 성공, 기존 라우트 회귀 없음
node:test (src/lib/redevelopment/*.test.ts) — 53 pass / 0 fail
  - businessType/stage 매핑 전수 테스트
  - normalize 안전성(오매칭 방지) 회귀 테스트
  - fingerprint 결정성 테스트
  - officeDetector 안전장치 테스트
  - matching confidence 5단계 전부
  - merge source priority + needsReview 판정
  - ingestRecord 통합 테스트(인메모리 스토어) — idempotency 2종, EXACT/MEDIUM
    매칭, 오매칭 방지 회귀(거제2, 촉진5), canonical 재계산
```

## migration production 상태

**미실행.** `npx prisma migrate status`로 재확인, `20260819110211_redevelopment
_master_schema_r4`가 `not yet been applied` 상태. `prisma migrate deploy`는
호출하지 않았다(섹션 47 지시).

## ingestion production 상태

**미실행.** `import_molit.ts`/`import_busan.ts` 둘 다 `--dry-run`으로만 실행했고,
실제 DB 쓰기가 발생하는 경로(`ingestRecord` 호출)는 오직 `InMemoryRedevelopmentStore`
대상으로만 실행했다. Production `RedevelopmentProject`/`RedevelopmentSourceRecord`에
실제로 insert된 행은 0건이다(섹션 48 지시).

## unresolved

1. **부산 sigungu 해석률 43%(148/343)가 cross-source 매칭의 실질적 병목** —
   위 "신규 발견 2" 참고. R5/R6에서 해결이 필요하면 후보는: (a) location 텍스트에
   동 이름까지만 있는 레코드를 Kakao Local API로 역지오코딩해 행정구 코드만
   가져오는 방식(좌표를 지도에 쓰는 것과 별개로, region 식별용으로 국한하면
   섹션 35의 "전체 343건 무조건 지오코딩 금지" 취지와 상충하지 않을 수 있음 —
   단 이번 STEP에서 실행하지 않았고 별도 승인 필요), (b) 부산시가 별도로 제공하는
   행정동-자치구 매핑 공개데이터를 찾아 결합(임의로 만들지 않음).
2. **국토부 conflicting duplicate 처리 정책** — 현재는 "마지막 CSV 행이 이긴다"는
   암묵적 동작이다. R3B가 요구한 "최신을 추정하지 않는다"는 원칙에는 위배되지
   않지만(정말로 추정하지 않고 그냥 마지막 값을 쓸 뿐), 이게 실제로 원하는 동작인지
   product 판단이 필요하다 — 지금은 최소 정직하게 카운트만 하고 있다(사람이 다시
   보게).
3. **office 좌표 실제 지오코딩 파일럿 미실행** — `classifyLocationText()`는 구현·
   테스트됐지만 Kakao Geocoder와 연결한 실제 좌표 확보 파일럿은 R5/R6으로 이관.
4. **매칭 similarity 임계치(0.7)는 R3A 문서에 숫자로 명시되지 않아 이번 STEP에서
   판단한 값** — R3A는 "편집거리 등"이라고만 서술. 임계치를 바꾸면 MEDIUM/LOW
   경계가 이동하므로, 실제 서비스 투입 전 사람이 MEDIUM 판정 샘플(67건)을 훑어
   임계치가 적절한지 확인 권장.
5. **`classifyLocationText()`가 `ingestRecord()` 파이프라인에 아직 배선되지
   않았다** — office 감지 로직 자체는 구현·단위 테스트(7건) 완료 상태지만,
   `ingestRecord()`/`recomputeProjectCanonicalFields()`가 이 함수를 호출해
   `Project.locationType`/`locationConfidence`/`geocodeStatus`를 채우는 단계까지는
   짜여 있지 않다 — 이번 파일럿에서 생성된 1,904개 Project 전부 이 3개 필드가
   기본값(null/NOT_ATTEMPTED 상당) 그대로다. R5/R6에서 실제 좌표 확보 파이프라인을
   붙일 때 반드시 함께 연결해야 한다(로직 검증은 끝났으니 배선만 남음).

## R5 GO/NO-GO

**조건부 GO.**

- Schema/migration: 안전(0건 데이터, 다른 모델 무영향) — 실제 적용만 남음.
- Importer: 둘 다 실제 데이터로 검증 완료(1,566 + 343 전량 파싱 성공, unknown
  business/stage 0건).
- Canonical merge 로직: 51개 테스트로 검증, 알고리즘 자체는 건전.
- **막힌 것**: 실제 병합 품질(merged=2)이 기대(R3A pilot 83% 1:1)에 크게
  못 미치는데, 원인이 매칭 알고리즘이 아니라 **부산 sigungu 해석**이라는 게
  이번 STEP에서 명확해졌다 — R5(API/Service Layer) 전에, 또는 R5와 병행해
  sigungu 해석 개선이 필요하다(위 unresolved #1).

즉 스키마/importer/matching 코드 자체는 R5로 넘어가도 되지만, **실제 production
데이터를 넣기 전에 sigungu 해석 문제를 먼저 해결하거나, 최소한 "sigungu 미상
Busan 레코드는 자동 매칭 대상에서 제외되고 전부 BUSAN-only project로 생성된다"는
현재 동작을 제품 결정으로 명시적으로 승인받아야 한다.**
