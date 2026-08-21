# SCHOOL V2-C1 — Core Education Schema Implementation

구현 완료. 학교/유치원/어린이집 canonical entity + temporal stat을 위한
최소 core schema를 실제로 생성했다. **ingestion 코드는 없다** — 7개
테이블 전부 배포 직후 row 0건이 정상이며, 이번 STEP에서 그 상태로
검증을 마쳤다.

## 0. 시작 상태

```
git status --short  → M CHANGELOG.md(V2-C 설계 기록, 미commit), ?? SCHOOL-V2-C-education-data-architecture.md(미commit)
git rev-parse HEAD        = e526f915e40287153be9c95bf5e4444bd8fe2820
git rev-parse origin/main = e526f915e40287153be9c95bf5e4444bd8fe2820
```

## 1. NOW / LATER 최종 결정

[SCHOOL V2-C](./SCHOOL-V2-C-education-data-architecture.md) §3/§27에서
이미 10개로 좁힌 proposed table을, 이번 C1에서 "당장 실제 migration에
넣을 것"과 "설계는 유지하되 스키마 생성은 미룰 것"으로 한 번 더
나눴다.

| TABLE | PURPOSE | NOW/LATER | WHY | BLOCKS WHICH STEP |
|---|---|---|---|---|
| EducationSource | source/license/legal 게이트 registry | **NOW** | 모든 ingestion의 전제조건(legalReviewStatus 확인 없이는 어떤 source도 안전하게 못 켬) — 다른 6개 NOW 테이블 중 4개(*Stat)가 formal FK로 이 테이블을 참조 | C2, C3A, C3B 전부 |
| School | 학교 canonical entity | **NOW** | C2(NEIS+학교알리미 ingestion) 필요조건 | C2 |
| SchoolStat | 학교 temporal stat | **NOW** | C2 필요조건 — 단 학교알리미 필드 레벨 스키마가 아직 NOT_CONFIRMED이라 최초 ingestion 시점에도 `studentCount` 등 대부분 null일 가능성이 높음(스키마 자체는 미리 만들어도 무해) | C2 |
| Kindergarten | 유치원 canonical entity | **NOW** | C3B(유치원 ingestion) 필요조건 | C3B |
| KindergartenStat | 유치원 temporal stat | **NOW** | C3B 필요조건 | C3B |
| Childcare | 어린이집 canonical entity | **NOW** | C3A(어린이집 ingestion) 필요조건 — SCHOOL V2-B에서 라이선스 마찰이 가장 적어 실제로 가장 먼저 ingestion될 가능성이 높은 대상 | C3A |
| ChildcareStat | 어린이집 temporal stat | **NOW** | C3A 필요조건 | C3A |
| EducationIdentityMapping | cross-source identity 연결(NEIS↔학교알리미 등) | **LATER** | C2/C3는 전부 **단일 source** ingestion(School은 NEIS만, Kindergarten/Childcare도 각자 주 source 하나)이라 즉시 필요하지 않다 — cross-source 매칭이 실제로 발생하는 시점은 C4(Identity Reconciliation)뿐. 지금 만들면 스키마만 있고 오랫동안 빈 상태로 남아 "설계상 존재"와 "실제 쓰임"의 괴리만 커짐 | C4에서 생성 |
| ApartmentEducationLink | 아파트↔교육기관 materialized 거리 | **LATER** | 실제 distance semantics(직선/도보, provider 등)가 C5에서야 확정된다 — 지금 만들면 어떤 값을 넣어야 할지도 불명확한 빈 스키마가 된다(SCHOOL V2-C §27 결정사항 4와 일치, "C5 전까지 사용 안 하면 LATER") | C5에서 생성 |
| GraduateOutcomeSnapshot | 13-다 졸업생 진로 현황 | **LATER** | 세부 API field schema NOT_CONFIRMED + `legalReviewStatus` 미해소 두 gate가 전부 안 풀림 — 지금 만들어도 실제 필드 확인 후 거의 확실히 다시 설계해야 한다(premature schema 방지, 사용자 지시 §18 그대로) | C7(법적 게이트 해제 후)에서 생성 |

**결과: 이번 migration에서 실제 생성 7개**(NOW), **LATER 3개는 문서
설계만 유지하고 스키마 생성 안 함** — "설계상 10개 유지"와 "이번
migration에서 10개 모두 생성"을 명확히 분리하라는 지시를 그대로
반영했다.

## 2. 기존 Prisma 컨벤션 재확인 후 적용한 규칙

`prisma/schema.prisma` 전체(741줄, 신규 추가 전)를 다시 읽고 확인한
컨벤션과, 이번 신규 모델에 그대로 적용한 대응:

| 기존 컨벤션 | 적용 |
|---|---|
| datasource: PostgreSQL(Supabase), `DATABASE_URL` | 그대로 사용, 신규 설정 없음 |
| feature/데이터 테이블은 `id Int @id @default(autoincrement())`(User/Post 등 인증 관련만 `String @id @default(cuid())`) | School/Kindergarten/Childcare/EducationSource/각 Stat 전부 Int autoincrement |
| `createdAt DateTime @default(now()) @map(...)`, `updatedAt DateTime @default(now()) @updatedAt @map(...)`(`ApartmentMarketFeature`/`Apartment` 패턴) | 7개 테이블 전부 동일 패턴 |
| camelCase 필드명 + `@map`으로 snake_case 컬럼/`@@map`으로 snake_case 복수형 테이블명 | 동일 적용(`neisSchoolCode` → `neis_school_code`, `School` → `schools`) |
| enum은 PascalCase, 도메인 접두어 없이 짧게(Role, RedevelopmentBusinessType 등) | `EducationDataQuality`/`DisclosureStatus`/`CoordinateType`/`LegalReviewStatus`/`IdentityConfidence` — 5개, 전부 NOW 테이블에서 최소 1곳 이상 실사용(미사용 enum 없음) |
| 배치로 재구축되는 테이블(`ApartmentMaster`)은 값 기반 느슨한 연결(FK 없음), 반대로 안정적인 참조 테이블(`RedevelopmentProject`↔`RedevelopmentSourceRecord`)은 formal `@relation` | **School/Kindergarten/Childcare ↔ 각 Stat**: formal `@relation`(Stat이 canonical entity 없이는 의미 없음, `onDelete: Cascade`) / **각 Stat ↔ EducationSource**: formal `@relation`(`onDelete` 미지정 = Prisma 기본 Restrict, source row가 사용 중이면 삭제 방지 — §20 "source row 삭제가 기관 데이터를 날리지 않도록") |
| Json 필드는 "필드 스키마가 아직 불확실한 원자료"에만 사용(`RedevelopmentSourceRecord.rawPayload`, `Apartment.communityFacilities`) | `SchoolStat.gradeBreakdown`, `KindergartenStat.ageBreakdown` — 세부 필드 미확정 구간만 Json, 확정된 필드(`studentCount` 등)는 typed column |
| `qualityFlag`류 필드는 기존엔 String 자유값(`ApartmentLocationFeature.qualityFlag: 'complete'\|'partial'\|'stale'`)이었으나, 이 스키마에 이미 Prisma enum 전례(Redevelamento MatchConfidence 등)가 있음 | 신규 테이블은 String 대신 `EducationDataQuality` enum으로 승격(재사용 빈도가 School/Kindergarten/Childcare/3×Stat 총 7곳으로 많아 String 자유값보다 enum이 안전) |

## 3. 실제 생성 모델(7개) 필드 요약

상세 필드 정의는 `prisma/schema.prisma`(741번째 줄부터) 참고. 여기서는
설계 대비 실제 반영에서 조정한 지점만 기록한다.

### EducationSource
사용자 제안 필드 그대로 반영. `sourceType`은 enum화하지 않고
`String`으로 유지(§13 "필요 최소만" 원칙 — ingestion 코드의 자유
태그일 뿐 이 스키마 레벨에서 분기 로직에 관여하지 않음).
`commercialUseAllowed`/`modificationAllowed`는 `Boolean?`으로 —
`null`이 "미확인(UNKNOWN)"을 의미하고 `false`와 명확히 구분된다(지시
그대로).

### School
- `neisSchoolCode String? @unique` — nullable + unique. §7 원문
  필드 목록엔 nullable 표시가 없었으나, 바로 위 identity 단락이
  "아직 미확정 기관도 저장할 수 있어야 하면 nullable unique 검토"라고
  명시해 이쪽을 우선했다 — `ApartmentMaster.aptSeq` 패턴과 동일.
- `schoolName`만 필수(`String`, NOT NULL) — NEIS 응답에 항상
  존재하는 값이고, canonical key로 쓰지 않는다는 지시와 무관하게
  "row를 식별할 최소 표시값"으로는 필요. 그 외 서술 필드(`address`,
  `sidoCode`, `establishmentType` 등)는 전부 nullable로 통일했다 —
  외부 source가 채우지 못한 값에 DB 제약으로 막히지 않도록(CLAUDE.md
  원칙 4 "데이터가 없으면 임의의 값을 생성하지 않는다"의 연장 —
  NOT NULL 제약이 오히려 가짜 placeholder 값을 강제하게 만드는
  부작용을 피함).
- `coordinateType`은 `CoordinateType @default(UNKNOWN)`로 non-null
  (nullable 대신 default) — enum에 이미 `UNKNOWN`이 있어 별도
  nullable이 불필요.

### SchoolStat
- `referenceYear Int`(필수) — idempotency key의 핵심. `disclosureYear`/
  `referenceDate`는 nullable 보조 필드로 유지.
- `sourceId Int`(필수) + `source EducationSource @relation(...)` —
  §15 지시("Stat은 EducationSource relation을 가져야 함") 반영.
- unique: `[schoolId, sourceId, referenceYear]`.

### Kindergarten
- `officialCode String? @unique`, `identityConfidence
  IdentityConfidence @default(LOW)` — 지시 그대로. 이름+주소를 DB
  unique로 강제하지 않았다(요청 원칙 그대로 미준수 방지).

### KindergartenStat
- `referenceYear Int`(필수), `referenceDate DateTime?`(보조) —
  SCHOOL V2-B에서 유치원 통합현황 파일이 "연 2회 수집" 수준으로
  확인돼(§V2-B) 연 단위 키가 합리적이라고 판단했다.
- unique: `[kindergartenId, sourceId, referenceYear]`.

### Childcare
- `facilityCode String @unique`(**필수**, nullable 아님) — 유치원과
  달리 SCHOOL V2-B에서 시설코드가 실제 확인된 필드라 identity 신뢰도가
  더 높다고 판단해 필수로 뒀다(§11 지시 "facilityCode unique" — 원문에
  nullable 표시가 없어 필수로 해석).

### ChildcareStat
- `referenceDate DateTime`(**필수**, `referenceYear` 필드 자체를
  두지 않음) — §12 지시 원문 그대로("referenceDate" 필수, referenceYear
  없음)와, SCHOOL V2-B에서 어린이집 갱신 주기가 "수시" 수준까지만
  확인되고 연 단위 확정이 안 됐다는 사실이 일치해 그대로 반영했다.
- unique: `[childcareId, sourceId, referenceDate]`.

## 4. Index / Relation / Delete Policy 실제 반영

- unique index: `education_sources.code`, `schools.neis_school_code`,
  `kindergartens.official_code`, `childcares.facility_code`, 3개
  Stat 테이블의 복합 unique(§3 각 항목)
- normal index: `schools(sido_code, sigungu_code)`,
  `schools(school_level)`, `kindergartens/childcares(sido_code,
  sigungu_code)`, 3개 Stat 테이블의 `(institutionId)`/`(sourceId)`
  각각 — §19 지시 그대로, 과도한 index 추가 없음
- FK: Stat → 자기 institution(`onDelete: Cascade`) / Stat →
  EducationSource(`onDelete` 미지정 = Restrict) — §20 지시("기관
  삭제 시 통계 cascade는 검토, source 삭제가 기관 데이터를 날리지
  않도록") 그대로 구현
- delete policy: `isActive Boolean @default(true)` — 폐교/폐원은
  hard delete 대신 이 플래그로 표현(§20)

## 5. Missing Semantics 반영

숫자 필드는 전부 nullable(`Int?`)로 "미수집"을 표현하고, 각 Stat
테이블의 `disclosureStatus DisclosureStatus`(AVAILABLE/NOT_DISCLOSED/
NOT_APPLICABLE/UNKNOWN/SOURCE_ERROR)가 "그 값이 왜 없는지"를 별도로
설명한다 — `studentCount = null`이면서 `disclosureStatus = UNKNOWN`
(아직 확인 안 함)인 경우와 `disclosureStatus = NOT_DISCLOSED`(이번
라운드에 공시 안 됨)인 경우가 DB 레벨에서 구분된다. `0`은 두 필드가
모두 "실제 0" 의미를 가질 때만(`studentCount = 0` +
`disclosureStatus = AVAILABLE`) 유효한 값으로 해석되도록 설계했다
(§14 지시 그대로).

## 6. Provenance

row-level 중심(§15) — `sourceId`(FK) + `sourceRecordId`(nullable) +
`fetchedAt`(필수) + `sourceUpdatedAt`(nullable)을 3개 Stat 테이블에
동일하게 둔다. raw payload 전체를 저장하는 별도 테이블/컬럼은
**만들지 않았다**(`rawJson` 계열 컬럼 없음 — 지시 그대로 "기본
false 방향", 필요 시 LATER).

## 7. Legal Gate 설계(런타임 미구현)

`EducationSource.legalReviewStatus`(`UNKNOWN`/`REVIEW_REQUIRED`/
`CLEARED`/`BLOCKED`)만 이번 STEP에서 스키마로 존재한다. **이 필드를
실제로 확인하고 ingestion을 막는 runtime guard 코드는 이번 STEP에
없다**(ingestion 코드 자체가 없음) — 원칙만 명시:

> `EducationSource.legalReviewStatus != CLEARED`인 source는 향후
> ingestion 코드가 절대 write하면 안 된다.

## 8. Migration

- 이름: `20260821021307_education_v2c1_core_schema`
- 생성: `prisma migrate dev --create-only`(SQL 먼저 검토)
- 검토 결과: `CREATE TYPE` 5건, `CREATE TABLE` 7건, `CREATE INDEX`
  17건, `ALTER TABLE ... ADD CONSTRAINT`(FK) 6건 — **`DROP`/
  `TRUNCATE`/기존 테이블 `ALTER`/데이터 `UPDATE` 0건**(destructive
  statement 없음 확인 후 적용)
- 적용: `prisma migrate deploy` — 성공
- `prisma generate` 재실행 — 성공

## 9. DB 검증

`information_schema`/`pg_indexes`/`pg_enum` 직접 조회(read-only)로
실측 확인:

- 7개 테이블 전부 존재, 각 `PRIMARY KEY` 1개씩 정상
- FK 6건(`school_stats`×2, `kindergarten_stats`×2, `childcare_stats`×2)
  전부 존재, `school_id`/`kindergarten_id`/`childcare_id`는 CASCADE,
  `source_id`는 미지정(Restrict) — 설계와 일치
- unique index 7건, normal index 10건 — 설계와 일치
- enum 5종 전부 생성, 값 목록 실측 결과 schema.prisma와 100% 일치

## 10. Schema Smoke Test

Prisma Client로 read-only `count()` 실행(쓰기 없음):

```
educationSource: 0
school: 0
schoolStat: 0
kindergarten: 0
kindergartenStat: 0
childcare: 0
childcareStat: 0
```

전부 0건 — 예상과 일치. seed 데이터 생성 안 함.

## 11. 기존 애플리케이션 회귀 확인

- `tsc --noEmit`: 에러 0건
- `eslint`: 에러 0건(기존에도 있던 무관한 파일 5건 warning만, 이번
  변경 파일에는 warning 0건)
- `next build`: 성공, `/api/school`, `/api/school/stats`,
  `/api/school/apartments`, `/school`, `/school/[id]` 라우트 전부
  기존과 동일하게 출력됨(코드 미변경 확인)
- 이 프로젝트에는 별도 `npm test`/jest 스위트가 없다(package.json에
  `test` 스크립트 없음) — `scripts/apartment-score/verify-*.ts`류는
  실제 외부 API를 호출하는 수동 스크립트라 "외부 API 대량 호출 금지"
  범위와 충돌해 이번 STEP에서 실행하지 않았다(school 관련 로직
  자체를 변경하지 않았으므로 회귀 위험도 없음).

## 12. Production Data Safety

전부 additive(`CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/신규 FK)라
기존 테이블 데이터에 영향 없음 — **LOW RISK**로 기록한다.
`ApartmentMaster`, `RedevelopmentProject` 등 기존 모델은 스키마
파일에서 단 1바이트도 수정하지 않았다(신규 블록은 파일 끝에
순수 추가). production 배포는 이 프로젝트의 기존 운영 절차(Prisma
migration deploy)를 그대로 따르며, 이번 STEP에서 별도 예외 처리를
두지 않았다.

## 13. 다음 STEP(자동 진행 아님)

commit/push가 끝나도 SCHOOL V2-C3A(어린이집 ingestion)를 자동으로
시작하지 않는다 — ChatGPT/사용자 검수 후 별도 지시 대기.
