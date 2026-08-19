# STEP R3B — Redevelopment Master DB Schema 설계

상태: **설계안 확정(문서) — Prisma schema/migration/DB 미적용**

## 배경

R1~R3A에서 전국/부산 재개발·재건축 데이터를 실물 기준으로 검증했다.
이번 STEP은 그 결과를 반영해 이집이 여러 source(국토부, 부산시,
향후 서울/경기 등)를 안정적으로 적재·통합·갱신할 수 있는 Master
DB 구조를 **설계**한다. `prisma/schema.prisma`는 건드리지 않았고,
아래 스키마는 전부 proposal이다.

## R1~R3A 핵심 사실(재조사 없이 인용만)

- 국토부 전국 도시정비사업 통합 데이터: 1,566건, 7컬럼(주소/좌표
  없음), 연간 갱신, 진행단계 코드 2/3/4/5/6/7/17(불연속).
- 부산광역시 정비사업 API: 343건, 23필드, 진행단계 12종 실측,
  사업유형 공식 필드 없음(areaName 접미사 추정).
- 부산 서구는 두 소스 모두에 실존(R1의 "API 누락" 결론은 R2에서
  정정 — 실제로는 구 이름 대신 법정동명만 쓰는 형식 문제였음).
- 두 소스 이름 정규화 매칭: 공유 키 129개 중 1:1 107(83%), 나머지
  17%는 1:N/N:1/N:N.
- **지오코딩 성공(11/22, 50%)의 82%(9/11)가 조합·추진위 사무실
  주소일 위험**(층/호/상가명 텍스트로 실증).
- **"재개발/재건축" 접미사를 정규화에서 제거하면 실제 오매칭이
  발생**(부산API 내부 충돌 20건 전부 이 패턴).
- **국토부 CSV 내부에도 같은 구역이 "주거환경개선/정비구역지정/
  세대수0" 행과 "재개발·재건축/진행단계/실세대수" 행으로 중복
  존재**(부산 내 16건, 그중 13건이 이 패턴). `촉진5`는 금정구·
  영도구 두 다른 구에 동명으로 존재 — 시군구 없는 이름 매칭은
  위험.
- Polygon 전국 통합 Master는 발견하지 못함 → POINT_FIRST_OK
  (V1: point, V2: polygon으로 분리 가능) 판단.

## 기존 schema 문제

### 현재 RedevelopmentProject

```prisma
model RedevelopmentProject {
  id                Int                 @id @default(autoincrement())
  zoneName          String              @map("zone_name")
  lawdCd            String?             @map("lawd_cd")
  stage             RedevelopmentStage
  targetHouseholds  Int?                @map("target_households")
  polygonGeojson    Json?               @map("polygon_geojson")
  lat               Float?
  lng               Float?
  updatedAt         DateTime            @default(now()) @updatedAt @map("updated_at")

  @@index([stage])
  @@map("redevelopment_projects")
}

enum RedevelopmentStage {
  ZONE_DESIGNATED
  UNION_ESTABLISHED
  PROJECT_APPROVED
  MANAGEMENT_DISPOSAL_APPROVED
  RELOCATION_DEMOLITION
  CONSTRUCTION
}
```

- **관계**: 없음(단일 테이블).
- **index/unique**: `stage`에 index만, unique 없음.
- **실제 사용처**: `src/app/api/properties/route.ts`(REDEVELOPMENT
  카테고리 조회, 지도 필터용), `src/services/publicDataService.ts`
  의 `upsertRedevelopmentProject()`(저장 함수, `zoneName` 하나만
  보고 존재 여부를 판단 — **시군구를 안 보므로 `촉진5`(금정구/
  영도구) 같은 사례에서 서로 다른 두 사업을 하나로 덮어쓸 수
  있는 실제 버그 소지**를 이번 STEP에서 재확인함).
- **호출부**: 코드베이스 전체에서 `upsertRedevelopmentProject`를
  실제로 호출하는 곳이 없음(정의만 있고 아무도 안 씀 — 확인됨).
- **production 데이터 존재 여부**: read-only count 쿼리로 직접
  확인 — **0건**. 삭제하지 않고 조회만 했다.

### 핵심 문제 요약

1. 단일 테이블이라 국토부/부산 두 source의 원본 값을 보존할 곳이
   없다 — 재수집 때마다 덮어쓰기만 가능.
2. `zoneName` 단독 매칭이라 동명이인(다른 시군구, 다른 사업유형)
   위험이 실제로 있다(R3A 실증).
3. `RedevelopmentStage` 6단계가 실제 관측 데이터(국토부 불연속
   7종 + 부산 12종)를 표현하지 못한다 — 추진위원회구성 등 실사용
   빈도 높은 단계가 없고, 준공/해제/조합해산 등 종료 상태를 아예
   표현할 수 없다.
4. 사업유형 필드 자체가 없다.
5. 좌표는 있지만 "이 좌표가 무엇을 의미하는지"(현장/사무실/근사)
   구분할 방법이 없다 — R3A에서 이게 실제로 82% 빈도의 문제임이
   드러났다.
6. `polygonGeojson`은 있지만 실제로 채울 데이터 소스를 이번
   조사에서 찾지 못했다(당장은 죽은 필드).

MIGRATION_RISK: **없음** — production 데이터 0건 확인.

## 설계 원칙

- **A. 원본을 버리지 않는다**: canonical 값과 raw source 값을
  분리한다.
- **B. 사업(Project)과 source record를 분리한다**: 한 사업에
  여러 source가 연결될 수 있는 구조(1:N)로 간다 — Project
  테이블 하나에 소스를 계속 덮어쓰는 방식은 피한다.
- YAGNI: 현재 어떤 source도 이력(history)을 제공하지 않으므로
  StageHistory 테이블은 만들지 않는다. Review 전용 테이블도
  당장은 만들지 않는다(Project에 boolean 플래그로 충분).

## Entity model

**2개 모델 추천**: `RedevelopmentProject` + `RedevelopmentSourceRecord`.

`RedevelopmentProjectLocation`, `RedevelopmentStageHistory`는
**만들지 않는다**:

- Location을 별도 테이블로 뺄 만큼 "사업당 여러 개의 canonical
  위치"가 필요한 근거가 없다(V1은 point 하나면 충분, polygon은
  placeholder 필드만).
- StageHistory는 채울 데이터가 없다(두 source 모두 시점 스냅샷만
  제공, 이력 제공 안 함) — 나중에 실제로 여러 시점 스냅샷을
  누적하기로 결정하면 그때 추가한다(과잉설계 금지).

## Project fields

| 필드 | 타입 | 필수 | source | 목적 |
|---|---|---|---|---|
| id | Int @id | 예 | DB 생성 | 내부 PK. 기존 스키마 관례(Property도 Int autoincrement) 유지 |
| canonicalName | String | 예 | primarySource의 rawName | 화면 표시용 이름 |
| normalizedName | String | 예 | 계산값 | 매칭 후보 조회용. **공백/"제"만 제거, 유형 접미사는 지우지 않음**(R3A 오매칭 실증 반영) |
| sido | String | 예 | 양쪽 source | 지역 필터/식별의 필수 구성요소 |
| sigungu | String | 예 | 양쪽 source | 동상 — `촉진5` 사례처럼 이름만으로는 구분 불가 |
| businessType | RedevelopmentBusinessType | 예(기본 UNKNOWN) | canonical 변환 | 재개발/재건축/... 분류 |
| stage | RedevelopmentStage | 예(기본 UNKNOWN) | canonical 변환, source priority 적용 | 진행단계 |
| projectStatus | RedevelopmentProjectStatus | 예(기본 UNKNOWN) | stage에서 파생 | ACTIVE/COMPLETED/CANCELLED — stage와 분리(아래 설명) |
| householdCount | Int? | 아니오 | canonical, source priority | 세대수 |
| lat / lng | Float? | 아니오 | geocoding 결과 | 지도 표시용 point |
| locationType | RedevelopmentLocationType? | 아니오 | geocoding 판정 | PROJECT_SITE/OFFICE/APPROXIMATE/UNKNOWN |
| locationConfidence | RedevelopmentLocationConfidence? | 아니오 | geocoding 판정 | HIGH/MEDIUM/LOW/UNKNOWN |
| geocodeStatus | RedevelopmentGeocodeStatus? | 아니오 | geocoding 결과 | NOT_ATTEMPTED/SUCCESS/AMBIGUOUS/FAILED |
| geocodeSource | String? | 아니오 | geocoding 결과 | 예: `"KAKAO_ADDRESS_SEARCH"` — **문자열**(아래 이유) |
| polygonSource / polygonRef | String? / String? | 아니오 | 미확보(V2) | placeholder만, 지금 채우지 않음 |
| primarySource | String | 예 | ingestion 로직 | 현재 canonical 값이 어느 source 기준인지 |
| sourceUpdatedAt | DateTime? | 아니오 | primarySource | 원본 갱신 시점(국토부는 파일 등록일, 없으면 null) |
| collectedAt | DateTime | 예 | ingestion 로직 | 이집이 마지막으로 수집한 시점 |
| needsReview | Boolean(기본 false) | 예 | ingestion 로직 | 연결된 SourceRecord끼리 값이 크게 다를 때 true(R3A 국토부 내부 중복 패턴 대응) |
| createdAt / updatedAt | DateTime | 예 | DB | 표준 타임스탬프 |

## SourceRecord fields

| 필드 | 타입 | 필수 | 목적 |
|---|---|---|---|
| id | Int @id | 예 | 내부 PK |
| projectId | Int (FK) | 예 | 소속 Project |
| source | String | 예 | `"MOLIT"` \| `"BUSAN_CITY"` \| ... — **문자열**(아래 이유) |
| sourceRecordId | String | 예 | 원본 고유 ID 있으면 그대로, 없으면 결정론적 fingerprint |
| rawName | String | 예 | 원본 구역명 그대로 |
| rawBusinessType / rawBusinessTypeCode | String? | 아니오 | 원본 유형 텍스트/코드 그대로 보존 |
| rawStage / rawStageCode | String? | 아니오 | 원본 단계 텍스트/코드 그대로 보존 |
| rawHouseholdCount | String? | 아니오 | **문자열**(국토부 원본에 " 542 ", "해당없음" 등 비정형 값 실측 확인) |
| rawLocation | String? | 아니오 | 원본 주소/위치 텍스트 |
| rawPayload | Json? | 아니오 | 원본 응답 전체 보존(아래 설명) |
| matchConfidence | RedevelopmentMatchConfidence? | 아니오 | 이 레코드가 Project에 연결된 확신도(EXACT~UNMATCHED) |
| mergeStatus | RedevelopmentMergeStatus(기본 UNMATCHED) | 예 | 운영 상태(자동/검토대기/수동확정/미매칭) |
| sourceUpdatedAt | DateTime? | 아니오 | 이 레코드 자체의 원본 갱신 시점 |
| collectedAt | DateTime | 예 | 수집 시점 |
| createdAt / updatedAt | DateTime | 예 | 표준 타임스탬프 |

## BusinessType

```text
REDEVELOPMENT             재개발            (국토부 1,2 / 부산 "재개발")
RECONSTRUCTION            재건축            (국토부 3,4 / 부산 "재건축")
RESIDENTIAL_ENVIRONMENT   주거환경개선       (국토부 5)
SMALL_RECONSTRUCTION      소규모재건축       (부산만, 국토부 범위 밖 — 소규모주택정비법)
BLOCK_HOUSING             가로주택정비       (부산만, 국토부 범위 밖 — 소규모주택정비법)
OTHER                     원본은 파악됐으나 위 분류 밖
UNKNOWN                   원본 값 자체가 없거나 해석 불가
```

`OTHER`/`UNKNOWN`을 분리 유지한다 — OTHER는 "새로운 합법적
카테고리를 만났다"는 신호이고 UNKNOWN은 "파싱 실패"라 운영 대응이
다르다.

rawBusinessType/rawBusinessTypeCode 보존 여부: **보존한다.**
국토부는 코드("1)재개발(주택정비)")와 라벨이 한 문자열에 섞여
있어 코드/라벨을 분리 저장할 실익이 낮다 — `rawBusinessType`
하나에 원본 그대로 넣고, `rawBusinessTypeCode`는 파싱 가능한
경우만(예: 앞자리 숫자) 채우는 optional로 둔다.

## Stage(재설계)

```text
PLANNED                          예정구역지정(부산만 관측)
ZONE_DESIGNATED                  정비구역지정(양쪽)
PROMOTION_COMMITTEE              추진위원회구성(양쪽) — 기존 6단계에 없던 실사용 빈도 높은 단계
ASSOCIATION_APPROVED             조합설립인가(양쪽)
ARCHITECTURAL_REVIEW             건축심의 및 통합심의(부산만 관측)
PUBLIC_OPERATOR_DESIGNATED       사업시행자지정(국토부 코드17, 공공시행 트랙)
PROJECT_IMPLEMENTATION_APPROVED  사업시행인가/사업시행계획인가(양쪽)
MANAGEMENT_DISPOSITION_APPROVED  관리처분인가/관리처분계획(양쪽)
RELOCATION_DEMOLITION            이주철거 — 유지 여부는 아래 별도 항목 참고
CONSTRUCTION                     착공(양쪽)
COMPLETED                        준공(부산만 관측)
TRANSFER_REGISTERED              이전고시(부산만 관측, 준공 이후 소유권 이전등기 단계)
DISSOLVED                        조합해산(부산만 관측) — 의미 모호, 아래 참고
CANCELLED                        해제(부산만 관측)
UNKNOWN                          원본 값 해석 불가
```

기존 6단계 → 신규 14단계 매핑:

| 기존 | 신규 |
|---|---|
| ZONE_DESIGNATED | ZONE_DESIGNATED |
| UNION_ESTABLISHED | ASSOCIATION_APPROVED |
| PROJECT_APPROVED | PROJECT_IMPLEMENTATION_APPROVED |
| MANAGEMENT_DISPOSAL_APPROVED | MANAGEMENT_DISPOSITION_APPROVED |
| RELOCATION_DEMOLITION | RELOCATION_DEMOLITION(유지, 아래 참고) |
| CONSTRUCTION | CONSTRUCTION |
| (없음) | PLANNED / PROMOTION_COMMITTEE / ARCHITECTURAL_REVIEW / PUBLIC_OPERATOR_DESIGNATED / COMPLETED / TRANSFER_REGISTERED / DISSOLVED / CANCELLED / UNKNOWN(신규 9종) |

**current 6-stage 폐기 여부**: 폐기하고 위 14단계로 교체를
권장한다. production 데이터가 0건이라 하위호환을 고려할 필요가
없다.

### RELOCATION_DEMOLITION 재평가

R2/R3A 결론 재확인: **국토부·부산 어느 실측 데이터에도 이 값이
없다.** 그럼에도 **enum에서 삭제하지 않고 유지**하기로 한다 —
"이주 및 철거"는 실제 정비사업 법정 절차의 널리 알려진 단계라
(부산 API 12종에도 없지만 다른 지자체 API에는 존재할 가능성이
있음) 값 자체가 틀렸다고 보기 어렵고, 지금 지우면 나중에 실제로
필요할 때 다시 마이그레이션해야 한다. "현재 어떤 source에도
관측되지 않는 값"이라는 사실만 이 문서에 남긴다.

### DISSOLVED(조합해산)의 모호성

R3A 원본 데이터에서 `대연2 재개발`이 `조합해산` 상태이면서
세대수 3,149로 기록된 사례를 발견했다 — 세대수가 큰 것으로
보아 **성공적으로 완공되고 조합이 소임을 다해 해산**했을
가능성이 높지, 실패해서 무산된 것으로 보이지 않는다. 반대로
초기 단계에서 조합이 해산되는 경우(사업 좌초)도 실제로 존재할
수 있다. **원본 데이터만으로는 "완료 후 해산"과 "중도 좌초"를
구분할 수 없다** — 그래서 `DISSOLVED`를 `COMPLETED`나
`CANCELLED`에 강제로 합치지 않고 별도 값으로 유지하며,
`projectStatus`는 이 경우 `UNKNOWN`으로 둔다(아래 참고).

## Project lifecycle(projectStatus) 분리

```text
enum RedevelopmentProjectStatus {
  ACTIVE      // 계속 진행 중(default)
  COMPLETED   // stage가 COMPLETED 또는 TRANSFER_REGISTERED
  CANCELLED   // stage가 CANCELLED(해제)
  UNKNOWN     // stage가 DISSOLVED(조합해산, 모호함) 또는 stage 자체가 UNKNOWN
}
```

stage(어디까지 왔는가)와 projectStatus(지금도 살아있는 사업인가)를
분리했다 — "완료/취소 사업만 걸러서 검색"같은 화면을 stage enum
14종을 전부 나열하지 않고 projectStatus 하나로 필터링할 수 있게
하기 위함이다. **DB 트리거나 코드로 자동 계산**하는 필드이며(위
매핑 규칙), 사람이 직접 입력하지 않는다.

## Identity

**Project에 공격적인 composite unique를 걸지 않는다.** R3A에서
"시도+시군구+정규화명+사업유형"이 EXACT 조건으로도 세대수가 크게
다른 사례(명서1: 1521 vs 785)를 발견했다 — 완전 일치처럼 보여도
DB가 강제로 병합/거부하게 만들면 위험하다. 대신:

```prisma
@@index([sido, sigungu])
@@index([normalizedName])
```

로 매칭 후보를 빠르게 찾을 수 있게만 하고, **실제 병합 여부
판단은 R4 ingestion 애플리케이션 코드가 matchConfidence 로직으로
결정**한다(아래 Matching 참고).

DB PK는 기존 스키마 관례(Property, 기존 RedevelopmentProject
전부 `Int @id @default(autoincrement())`)를 그대로 따른다 — UUID/
CUID로 바꿀 만한 근거가 없다(내부 FK로만 쓰이고 외부 노출 API
식별자가 필요하면 그때 별도 slug를 추가하면 된다).

## normalizedName 전략

**필드 하나만 둔다**(matchName 별도 필드 만들지 않음). 이유:
실제 fuzzy 매칭 로직(R3A에서 설계한 EXACT~UNMATCHED confidence
계산)은 `normalizedName`(안전한 정규화)과 `businessType`(별도
canonical 필드)을 애플리케이션 코드에서 조합해 판단하면 되므로,
"유형까지 지운 두 번째 정규화 필드"가 굳이 DB에 따로 필요하지
않다. 필드 수를 최소화하는 방향을 우선했다.

## sourceRecordId 전략

```text
1순위: source 자체의 안정적 native id가 있으면 사용(부산API의
       "aCode" 같은 값)
2순위(국토부처럼 native id가 없을 때): 결정론적 fingerprint
       = hash(source + sido + sigungu + rawName + rawBusinessType)

주의: stage/세대수는 fingerprint에 포함하지 않는다(포함하면
값이 바뀔 때마다 새 레코드로 취급돼 사실상 매번 새로 생성되는
문제가 생김 — 지시사항 그대로 반영).
```

이 방식은 R2에서 발견한 유일한 완전중복 행(1건)도 안전하게
처리한다 — 같은 fingerprint가 나오므로 unique 제약에 걸려
upsert의 update 경로로 자연스럽게 흡수된다.

## 국토부 중복행 처리

R3A에서 확인한 "같은 구역이 다른 businessType으로 여러 행
존재"(대연3 등)는, businessType이 fingerprint에 포함되므로
**서로 다른 SourceRecord로 각각 저장된다**(하나가 다른 하나를
덮어쓰지 않음 — 신뢰할 수 없는 기준으로 "최신"을 추정하지
않는다는 원칙 그대로).

이 SourceRecord들이 하나의 Project로 묶일지는 매칭 로직(sido+
sigungu+normalizedName 후보 조회)에 달려 있다 — 같은 Project로
묶이면 businessType/stage 값이 서로 다른 SourceRecord가 한
Project에 연결되는 상황이 생기므로, 이때 `Project.needsReview =
true`로 표시해 사람이 검토하게 한다. 별도 Review 테이블은
만들지 않는다(문서/로그로 충분, YAGNI).

## source priority

R2 권장(존재=국토부, 유형=국토부 단 소규모주택정비법은 지역API,
진행단계/세대수=지역API 우선, 좌표=geocoding)을 필드마다 별도
`sourceOfTruth` 필드로 만들지 않는다 — 대신 **`primarySource`
하나로 "이 Project의 canonical 값이 지금 어느 source 기준으로
채워졌는지"만 기록**하고, 실제 우선순위 규칙 자체는 R4 ingestion
코드에 하드코딩한다(스키마가 아니라 로직의 책임). 필드별
provenance table은 과함 — SourceRecord가 원본을 전부 보존하고
있으므로 "이 값 어디서 왔나"는 필요할 때 SourceRecord를 다시
찾아보면 된다.

## unmatched 처리

- **국토부에만 있는 사업**(예: 아미1, 아미3): 그대로 새 Project
  생성, `primarySource="MOLIT"`, 좌표 없음(`geocodeStatus=
  NOT_ATTEMPTED` 또는 시도 후 `FAILED`), `mergeStatus=UNMATCHED`.
  버리지 않는다.
- **부산API에만 있는 사업**(194건, 가로주택정비/소규모재건축
  포함): 마찬가지로 새 Project 생성 가능, `primarySource=
  "BUSAN_CITY"`. 지역 API만으로도 canonical Project를 만들 수
  있다는 정책을 채택한다.

## matchConfidence / mergeStatus

```text
RedevelopmentMatchConfidence: EXACT / HIGH / MEDIUM / LOW / UNMATCHED
  → SourceRecord.matchConfidence — "이 레코드가 지금 연결된
    Project와 얼마나 확실하게 같은 사업인가"(알고리즘 산출값)

RedevelopmentMergeStatus: AUTO_MATCHED / REVIEW_REQUIRED /
                            MANUAL_MATCHED / UNMATCHED
  → SourceRecord.mergeStatus — "지금 운영상 어떤 상태인가"
    (matchConfidence로부터 파생되지만, 사람이 나중에 수동으로
    MANUAL_MATCHED로 바꿀 수 있어 별도 필드로 둔다)

자동 merge 기준(R3A 그대로): EXACT/HIGH → AUTO_MATCHED,
MEDIUM → REVIEW_REQUIRED, LOW → 자동 merge 금지(새 Project로
분리하거나 REVIEW_REQUIRED), UNMATCHED → 별도 Project.
```

## rawPayload 저장

**저장한다(Json, nullable).** 검토 결과:

- 개인정보성 데이터: 부산 API 23필드는 시공사/설계사/전화번호
  등 법인·사업 정보이며 이미 공개 API로 노출 중인 데이터라
  개인정보 문제 없음.
- 저장 용량: 부산 레코드 1건당 1~2KB 수준, 최대 수천 건 규모라
  Postgres JSON 컬럼으로 무리 없음.
- 이용조건: 공공데이터포털 표준 이용조건(출처표시 조건부 재사용
  허용이 일반적) 범위 안에서 사용한다고 판단 — **상세 라이선스
  문구 재확인은 이번 STEP에서 하지 않았고 R4에서 재확인 권장.**

## latitude/longitude 구조

`lat`/`lng`는 Project에 canonical 값 하나만 둔다(SourceRecord는
`rawLocation` 텍스트만 보존, 좌표 자체는 계산하지 않음 — 지오코딩은
Project 레벨에서 한 번만 수행). 반드시 아래 3개 필드와 **함께만**
의미가 있다:

## locationType / locationConfidence / geocodeStatus

```text
locationType: PROJECT_SITE / OFFICE / APPROXIMATE / UNKNOWN
locationConfidence: HIGH / MEDIUM / LOW / UNKNOWN  (enum — 숫자 score 아님, 이유 아래)
geocodeStatus: NOT_ATTEMPTED / SUCCESS / AMBIGUOUS / FAILED  (R3A 실제 분류와 동일)
```

**enum vs numeric score**: enum을 선택했다. R6 지도 UX가 필요로
하는 건 "일반 marker로 보여줄지 말지"같은 이산적 분기이지 정밀한
순위가 아니다(matchConfidence와 같은 이유로 통일). 숫자 score는
지금 이를 산출할 근거 있는 공식이 없어 오히려 거짓 정밀도를
만든다.

## office 좌표 처리 전략

R4에서 반드시 지켜야 할 안전장치(스키마가 지원):

```text
location 텍스트에 층/호/상가명/건물명 패턴이 있으면
  → locationType = OFFICE, locationConfidence = LOW

"OO번지 일원" 같은 vicinity 표현이거나 명확한 지번 주소면
  → locationType = PROJECT_SITE, locationConfidence = HIGH

동 이름까지만 성공(구체 지번 실패)
  → locationType = APPROXIMATE, locationConfidence = MEDIUM

location 자체가 없거나 geocoding 실패
  → geocodeStatus = FAILED/NOT_ATTEMPTED, locationType = UNKNOWN
```

패턴 탐지 로직 자체는 이번 STEP에서 구현하지 않는다(R4 TODO,
R3A "unresolved"에 이미 기록됨).

## approximate 좌표 처리 전략

동 단위로만 확보된 좌표는 `locationType=APPROXIMATE`로 명시하고
R6 지도 UX에서 "근사 위치" 안내와 함께 표시하는 걸 전제로 한다
(UI 구현은 이번 STEP 대상 아님).

## polygon 필드 V1 포함 여부

**포함한다(placeholder만)**: `polygonSource String?`,
`polygonRef String?` — nullable이라 지금 채우지 않아도 스키마
비용이 없고, 나중에 polygon 소스를 찾았을 때 마이그레이션 없이
바로 연결할 수 있다. 실제 geometry 컬럼(PostGIS 등)은 만들지
않는다 — polygon 자체가 확보 안 됐으므로 지금 만들면 빈 컬럼만
느는 과잉설계다.

## householdCount 구조

`Project.householdCount Int?`(canonical, source priority로 선택),
`SourceRecord.rawHouseholdCount String?`(원본 그대로 — 국토부
실측 값에 " 542 "처럼 공백이 섞이거나 "해당없음" 텍스트가 있어
Int로 바로 저장할 수 없음, 파싱은 ingestion 코드 책임).

## 이미지 구조

V1 Project에 이미지 필드를 추가하지 않는다. 부산 API의
`viewImgPath`/`loctImgPath`/`panoImgPath`/`placeImgPath`는
`SourceRecord.rawPayload`에 이미 보존되므로 나중에 R6에서 실제
이미지 표시 화면을 만들 때 canonical 필드로 승격하면 된다(YAGNI).

## freshness 구조

```text
Project.sourceUpdatedAt   원본이 마지막으로 갱신된 시점(모르면 null)
Project.collectedAt        이집이 마지막으로 이 Project를 갱신한 시점
SourceRecord.sourceUpdatedAt / collectedAt  레코드 단위로도 동일 개념
```

국토부처럼 원본에 날짜가 없으면 `sourceUpdatedAt=null`을 허용한다
(값을 지어내지 않는다).

## index 설계(제안, migration 없음)

```prisma
// Project
@@index([sido, sigungu])
@@index([businessType])
@@index([stage])
@@index([normalizedName])

// SourceRecord
@@unique([source, sourceRecordId])
@@index([projectId])
```

R5 API가 시도/시군구/사업유형/단계/이름으로 필터링할 것으로
예상되는 것에 맞춘 최소 인덱스 세트다.

## unique 설계

- SourceRecord: `@@unique([source, sourceRecordId])` — 같은
  source의 같은 원본 레코드를 중복 저장하지 않기 위한 안전한
  제약(위험 없음, R3A와 무관하게 확실히 걸 수 있음).
- Project: 공격적 composite unique 없음(위 Identity 섹션 참고).

## stage history table 필요 여부

**만들지 않는다.** 현재 어떤 source도 시점별 이력을 제공하지
않는다 — 억지로 테이블을 만들어도 채울 데이터가 없다. 나중에
"매 sync마다 스냅샷을 쌓아서 변화를 추적하자"는 요구가 실제로
생기면 그때 `RedevelopmentStageHistory` 테이블을 추가한다(과잉
설계 금지, YAGNI).

## review table 필요 여부

**만들지 않는다.** `Project.needsReview`(boolean)와
`SourceRecord.mergeStatus=REVIEW_REQUIRED`로 R4 초기 운영에는
충분하다. 검토 이력을 사람이 남기는 워크플로우가 실제로 필요해지면
그때 추가한다.

## Alternative designs

### 안 A — Project + SourceRecord 분리(추천)

| 항목 | 평가 |
|---|---|
| 확장성 | 좋음 — 서울/경기 API 추가 시 SourceRecord만 늘면 됨 |
| 중복관리 | 좋음 — source별 원본이 독립적으로 남아 충돌 시각화 가능 |
| 원본 보존 | 완전 보존(rawPayload 포함) |
| merge | matchConfidence/mergeStatus로 명시적 관리 가능 |
| 업데이트 | source별 upsert, canonical은 priority 규칙으로 재계산 |
| 복잡성 | 테이블 2개, JOIN 필요 — 중간 수준 |
| 향후 확장 | 자연스러움(신규 source = 신규 SourceRecord rows) |

### 안 B — Project 하나에 source 통합(비추천)

| 항목 | 평가 |
|---|---|
| 확장성 | 나쁨 — source 늘 때마다 Project에 필드 추가 필요 |
| 중복관리 | 나쁨 — 나중 sync가 먼저 값을 덮어씀, 충돌 시 정보 손실 |
| 원본 보존 | 불가능(마지막 쓴 source 값만 남음) |
| merge | 암묵적(그냥 덮어쓰기) — R3A가 밝힌 82% 사무실주소 위험을 다룰 방법이 없음 |
| 업데이트 | 단순하지만 위험(국토부가 더 최신일 때 부산 값을 실수로 덮어쓸 수 있음) |
| 복잡성 | 테이블 1개 — 낮음 |
| 향후 확장 | 매번 스키마 변경 필요 |

**최종 선택: 안 A.** R1~R3A에서 실증한 "두 source 값이 자주
불일치한다"는 사실 자체가 안 B를 배제하는 결정적 근거다.

## Recommended schema(Proposal Only — 아직 적용 안 함)

```prisma
// ═══════════════════════════════════════════════════════════
// STEP R3B PROPOSAL — 기존 RedevelopmentProject/RedevelopmentStage를
// 대체한다(production 0건 확인, 하위호환 불필요). R4에서 실제 적용.
// ═══════════════════════════════════════════════════════════

enum RedevelopmentBusinessType {
  REDEVELOPMENT
  RECONSTRUCTION
  RESIDENTIAL_ENVIRONMENT
  SMALL_RECONSTRUCTION
  BLOCK_HOUSING
  OTHER
  UNKNOWN
}

enum RedevelopmentStage {
  PLANNED
  ZONE_DESIGNATED
  PROMOTION_COMMITTEE
  ASSOCIATION_APPROVED
  ARCHITECTURAL_REVIEW
  PUBLIC_OPERATOR_DESIGNATED
  PROJECT_IMPLEMENTATION_APPROVED
  MANAGEMENT_DISPOSITION_APPROVED
  RELOCATION_DEMOLITION
  CONSTRUCTION
  COMPLETED
  TRANSFER_REGISTERED
  DISSOLVED
  CANCELLED
  UNKNOWN
}

enum RedevelopmentProjectStatus {
  ACTIVE
  COMPLETED
  CANCELLED
  UNKNOWN
}

enum RedevelopmentLocationType {
  PROJECT_SITE
  OFFICE
  APPROXIMATE
  UNKNOWN
}

enum RedevelopmentLocationConfidence {
  HIGH
  MEDIUM
  LOW
  UNKNOWN
}

enum RedevelopmentGeocodeStatus {
  NOT_ATTEMPTED
  SUCCESS
  AMBIGUOUS
  FAILED
}

enum RedevelopmentMatchConfidence {
  EXACT
  HIGH
  MEDIUM
  LOW
  UNMATCHED
}

enum RedevelopmentMergeStatus {
  AUTO_MATCHED
  REVIEW_REQUIRED
  MANUAL_MATCHED
  UNMATCHED
}

model RedevelopmentProject {
  id                 Int                               @id @default(autoincrement())

  canonicalName      String                            @map("canonical_name")
  normalizedName     String                            @map("normalized_name")

  sido               String
  sigungu            String

  businessType       RedevelopmentBusinessType         @default(UNKNOWN) @map("business_type")
  stage              RedevelopmentStage                @default(UNKNOWN)
  projectStatus      RedevelopmentProjectStatus        @default(UNKNOWN) @map("project_status")

  householdCount     Int?                              @map("household_count")

  lat                Float?
  lng                Float?
  locationType       RedevelopmentLocationType?        @map("location_type")
  locationConfidence RedevelopmentLocationConfidence?  @map("location_confidence")
  geocodeStatus      RedevelopmentGeocodeStatus?       @map("geocode_status")
  geocodeSource      String?                           @map("geocode_source")

  polygonSource      String?                           @map("polygon_source")
  polygonRef         String?                           @map("polygon_ref")

  primarySource      String                            @map("primary_source")
  sourceUpdatedAt    DateTime?                         @map("source_updated_at")
  collectedAt        DateTime                          @map("collected_at")

  needsReview        Boolean                           @default(false) @map("needs_review")

  sourceRecords      RedevelopmentSourceRecord[]

  createdAt          DateTime                          @default(now()) @map("created_at")
  updatedAt          DateTime                          @updatedAt @map("updated_at")

  @@index([sido, sigungu])
  @@index([businessType])
  @@index([stage])
  @@index([normalizedName])
  @@map("redevelopment_projects")
}

model RedevelopmentSourceRecord {
  id                   Int                            @id @default(autoincrement())
  projectId            Int                            @map("project_id")
  project              RedevelopmentProject            @relation(fields: [projectId], references: [id])

  source               String
  sourceRecordId       String                          @map("source_record_id")

  rawName              String                          @map("raw_name")
  rawBusinessType      String?                         @map("raw_business_type")
  rawBusinessTypeCode  String?                         @map("raw_business_type_code")
  rawStage             String?                         @map("raw_stage")
  rawStageCode         String?                         @map("raw_stage_code")
  rawHouseholdCount    String?                         @map("raw_household_count")
  rawLocation          String?                         @map("raw_location")

  rawPayload           Json?                           @map("raw_payload")

  matchConfidence      RedevelopmentMatchConfidence?   @map("match_confidence")
  mergeStatus          RedevelopmentMergeStatus        @default(UNMATCHED) @map("merge_status")

  sourceUpdatedAt      DateTime?                       @map("source_updated_at")
  collectedAt          DateTime                        @map("collected_at")

  createdAt            DateTime                        @default(now()) @map("created_at")
  updatedAt            DateTime                        @updatedAt @map("updated_at")

  @@unique([source, sourceRecordId])
  @@index([projectId])
  @@map("redevelopment_source_records")
}
```

`source`/`geocodeSource` 필드를 **enum이 아니라 String으로**
설계한 이유: Prisma enum에 새 값을 추가하려면 매번 migration이
필요하다. 이 앱은 이미 부산 다음으로 서울/경기 확장을 언급하고
있어(R2), 지역이 늘 때마다 스키마를 건드리게 하는 것보다 문자열
+ TypeScript 상수/union 타입으로 애플리케이션 레벨 타입 안전성만
확보하는 쪽이 실용적이다.

## Migration considerations

- 기존 `RedevelopmentProject`/`RedevelopmentStage`는 production
  0건이 확인됐으므로 **데이터 마이그레이션 없이 교체(drop &
  create) 가능** — R4에서 실제 migration 작성 시 안전.
- `PropertyCategory.REDEVELOPMENT`(기존 `Property` 모델의 enum
  값)는 이번 설계와 별개로 유지된다 — `api/properties/route.ts`가
  REDEVELOPMENT 카테고리일 때 `RedevelopmentProject`를 별도
  조회하는 기존 분기 로직은 R4에서 새 모델을 가리키도록만 바꾸면
  된다(구조 변경 없음).

## 기존 save 함수 영향

`src/services/publicDataService.ts`의 `upsertRedevelopmentProject()`
(현재 `zoneName` 단일 필드로 존재 여부를 판단하는 함수)는 새
스키마와 근본적으로 맞지 않는다 — **이번 STEP에서 수정하지
않았다.** R4 TODO로 정리:

```text
- upsertRedevelopmentProject() 폐기, 아래로 교체:
  - ingestMolitRecord(raw) → SourceRecord upsert(@@unique 활용)
  - ingestBusanRecord(raw) → SourceRecord upsert
  - matchOrCreateProject(sourceRecord) → sido+sigungu+normalizedName
    후보 조회 → matchConfidence 계산 → Project 연결 또는 신규 생성
  - recomputeCanonicalFields(project) → source priority 규칙으로
    businessType/stage/householdCount/projectStatus 재계산
```

## R4 ingestion plan

```text
1. 위 schema를 실제 prisma/schema.prisma에 반영, migration 생성
2. 국토부 importer: CSV → SourceRecord(source="MOLIT")
3. 부산 API importer: JSON → SourceRecord(source="BUSAN_CITY")
4. normalization: rawName → normalizedName(안전한 규칙만)
5. matching: sido+sigungu+normalizedName 후보 조회 →
   matchConfidence 산출(EXACT~UNMATCHED)
6. canonical merge: source priority 규칙으로 Project 필드 계산,
   충돌 시 needsReview=true
7. geocode: location 있는 SourceRecord만, office 패턴 탐지 →
   locationType/locationConfidence 세팅(R3A 안전장치)
8. quality report: needsReview/UNMATCHED/FAILED 건수 집계 문서화
9. production data validation: 소량 파일럿(예: 부산 서구)부터
   먼저 넣고 검수, 전체 확대는 그 다음
10. (R5 이후) API/UI 연결
```

## Risks

- **office 좌표를 그대로 노출하면 사용자에게 잘못된 위치 정보를
  줄 수 있다** — R4 ingestion이 반드시 locationType 안전장치를
  적용해야 하고, R6 UI도 `PROJECT_SITE`가 아닌 `OFFICE`/
  `APPROXIMATE`를 다르게 표시해야 한다(스키마는 이를 지원하도록
  준비했으나 실제 로직 구현·적용은 R4/R6 책임으로 남는다).
- **국토부 내부 중복행의 "무엇이 최신인가" 문제**는 이번 설계로
  구조적으로 보존은 되지만(별도 SourceRecord + needsReview)
  자동으로 해소되지는 않는다 — 사람 검토가 필요한 채로 남는다.
- **DISSOLVED의 모호성**은 스키마 레벨에서 완전히 해결할 수
  없다 — projectStatus=UNKNOWN으로 정직하게 남기는 것이 최선이라
  판단했다.

## Final GO/NO-GO

Go 조건(R3A에서 넘어온 4가지) 재확인:

```text
1. identity 전략 가능?        → 가능(sido+sigungu+normalizedName 후보 조회 + matchConfidence)
2. match confidence 전략 가능? → 가능(5단계 enum, SourceRecord에 저장)
3. point 좌표 확보 전략 가능?  → 가능(locationType/Confidence로 office 위험 관리)
4. polygon 없어도 V1 가능?     → 가능(placeholder 필드만 두고 V2로 분리)
```

4개 전부 충족. 이번 STEP 자체의 설계 완결성도 확인됨(2-엔티티
구조, 엔진별 필드 근거 명시, 위험 요소마다 대응 전략 마련).

**R4_GO.**
