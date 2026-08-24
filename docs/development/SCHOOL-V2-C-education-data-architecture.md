# SCHOOL V2-C — Education Data Architecture & Ingestion Design

DESIGN ONLY. `schema.prisma` 실제 수정 0건, migration 생성/실행 0건,
DB write 0건, production API/ingestion 구현 0건, UI 변경 0건, 신규
API key 신청 0건, commit/push 없음. 본 문서는 설계 초안이며 ChatGPT/
사용자 승인 전까지 어떤 구현도 시작하지 않는다.

## 0. 시작 상태

```
git status --short  → (없음, clean)
git rev-parse HEAD        = e526f915e40287153be9c95bf5e4444bd8fe2820
git rev-parse origin/main = e526f915e40287153be9c95bf5e4444bd8fe2820
```

---

## 1. Current Architecture Inventory

### 1-1. Prisma models(실측, `grep '^model '`)

`User, Account, Session, VerificationToken, Post, Comment, Transaction,
TradeHistory, Apartment, ApartmentMaster, ApartmentLocationFeature,
ApartmentMarketFeature, AiSearchCache, Property, RedevelopmentProject,
RedevelopmentSourceRecord, Presale, PresaleHouseTypeDetail, PageView,
SearchLog, ActiveSession, ErrorLog, Report` — **23개, School/
Kindergarten/Childcare 계열 model은 0건**(V1 audit §4와 동일 결론,
이번 STEP에서 재확인).

### 1-2. school 관련 API route 3개(코드 재확인)

| route | 실제 흐름 |
|---|---|
| `GET /api/school` | 매 요청마다 NEIS `schoolInfo` 페이지네이션 전량 호출(캐시 없으면) → 지역/학교급 필터 → `getOrSetCache`로 **10분 인메모리 캐시**(`src/lib/server-cache.ts`, `Map` 기반, 서버 재시작 시 소멸) |
| `GET /api/school/stats` | 동일 NEIS 재조회(캐시 없음, 매 요청 실호출) + Kakao AC5 학원 실집계 |
| `GET /api/school/apartments` | Kakao 키워드검색(학교좌표) + MOLIT 24개월 실거래 + 건축물대장 준공연도, **5분 캐시** |

세 route 모두 **DB read/write가 전혀 없다** — `prisma` client를
import하지도 않는다(코드 전문 확인). 학교 데이터는 100% ephemeral —
서버 프로세스 메모리에만 잠깐 머물다 사라진다.

### 1-3. NEIS 호출 구조

`https://open.neis.go.kr/hub/schoolInfo?KEY=...&Type=json&pIndex=&pSize=500&ATPT_OFCDC_SC_CODE=...`
— `src/lib/neis-sido-codes.ts`의 `resolveNeisEduCode`/`addressMatchesRegion`으로
지역 매핑. **schoolCode(`SD_SCHUL_CODE`)는 목록 응답의 `id` 필드로
한 번 쓰이고, 상세 페이지 이동 시 `name` 문자열 파라미터로 대체되며
버려진다**(`school-detail-client.tsx`가 `name` 기준으로
`/api/school/apartments`를 재호출) — V1 §13에서 이미 확인된 identity
단절이 코드 레벨에서도 동일하게 재확인됨.

### 1-4. Kakao 좌표 조회

`school/apartments/route.ts`가 학교명으로 Kakao 키워드검색 →
실패 시 **서구 특정 동 이름 하드코딩 폴백**(V1 §12에서 지적된
"대신/송도/충무동" 매칭이 코드에 그대로 남아있음, 이번 STEP에서도
수정하지 않음 — production logic 수정 금지 범위).

### 1-5. cache 구조

`getOrSetCache(key, ttlMs, fetcher)` — 단일 `Map` 기반 TTL 캐시,
DB 아님, 프로세스 재시작 시 전량 소실, 서버리스/멀티 인스턴스
환경에서는 인스턴스마다 독립(공유 캐시 아님).

### 1-6. schoolCode 처리 흐름 — 결론

**목록 응답에서만 잠깐 노출 → 상세 이동 시 완전히 버려짐 → 재조회는
학교명 문자열 매칭에 전적으로 의존.** DB 저장이 없으므로 이 코드를
canonical key로 쓸 영속 구조 자체가 없다.

### 1-7. 기존 관련 자산(재사용 가능한 정확한 precedent)

이번 설계에서 그대로 참고할 기존 패턴 2가지를 코드로 확인했다:

**(a) `ApartmentMaster` + `ApartmentLocationFeature`**
(`prisma/schema.prisma:200-321`) — "내부 PK(`id Int @id
@default(autoincrement())`) + nullable 외부 자연키(`aptSeq String?
@unique`)" 조합, 그리고 **formal `@relation` FK를 걸지 않고 값
기반(value-based) 느슨한 연결**을 쓴다(주석 근거: "ApartmentMaster는
M-시리즈 배치가 주기적으로 재구축하는 테이블이라 내부 PK가
재생성될 가능성이 있음"). `ApartmentLocationFeature`는
`source`/`sourceVersion`/`fetchedAt`/`validUntil`/`qualityFlag`
('complete'|'partial'|'stale') 컬럼을 row 레벨로 갖는다.

**(b) `RedevelopmentProject` + `RedevelopmentSourceRecord`**
(`:478-565`) — canonical entity(`RedevelopmentProject`)와 provenance
child table(`RedevelopmentSourceRecord`, `@@unique([source,
sourceRecordId])`으로 idempotency 보장)을 분리한 패턴. `rawPayload
Json?`, `matchConfidence`(EXACT/HIGH/MEDIUM/LOW/UNMATCHED),
`mergeStatus`(AUTO_MATCHED/REVIEW_REQUIRED/MANUAL_MATCHED/UNMATCHED)
enum으로 **identity reconciliation을 자동 확정하지 않고 review
queue로 넘기는 구조**가 이미 이 코드베이스에 존재한다 — 학교
identity 문제(§5)에 그대로 재사용 가능한 정확한 선례.

**(c) `scripts/apartment-score/collect-location-features.ts`** —
`--dry-run`/`--force`, `validUntil > now` 기준 freshness skip(=
resumability), `success/partial/failed/rateLimited` 카운터 요약,
canary 우선 실행 패턴 — ingestion pipeline(§20-25) 설계의 직접
템플릿.

**(d) Score Engine의 "RAW ≠ SCORE" 원칙** — `ApartmentLocationFeature`에는
원본 수치만 저장하고 점수/등급은 저장하지 않으며 매 요청 재계산한다
(`apartment-score/server/*` 주석 확정 원칙). derived metrics(§29)
설계에 그대로 적용.

**(e) `nearestElementaryDistanceM`** — Kakao POI 기준 **직선거리**이며
"학교거리 임의 보정 금지" 원칙이 이미 코드 주석으로 확정돼 있음
(`school-distance-band.ts`, `/api/school/apartments`의 "송도 +5분"
제거 이력) — §18 distance model 설계의 직접 제약조건.

---

## 2. Entity Model Options(§4)

| 기준 | Option A(단일 EducationInstitution+subtype) | Option B(School/Kindergarten/Childcare 완전 분리) | Option C(Hybrid: 공통 core + subtype 상세) |
|---|---|---|---|
| schema clarity | LOW(상호배타적 nullable 필드 대량 발생) | **HIGH** | MEDIUM |
| source field 차이 | 3개 기관이 완전히 다른 소관 법령(초중등교육법/유아교육법/영유아보육법)·API를 쓰므로 강제 통합 시 필드 대부분이 subtype 하나에만 의미 있음 | **HIGH**(각자 고유 필드만) | MEDIUM(공통부만 얇게 공유, 실익 적음) |
| query simplicity | 매 쿼리 type 필터 필요 | **HIGH**(조인 없음) | 기본 정보도 매번 join 필요 |
| SCHOOL V2 UI 사용성 | 기존 UI(SchoolDistrictPanel/LivingEnvironmentPanel)가 이미 학교·유치원·어린이집을 별개 패널로 다룸 — A는 UI 구조와 불일치 | **UI 구조와 직접 일치** | 부분 일치 |
| data provenance | subtype마다 provenance 필드 의미가 달라 공용 컬럼 설계가 오히려 복잡 | **row-level provenance로 단순** | 공통 core에 provenance 두면 subtype 특성 못 담음 |
| temporal statistics | 1개 Stat 테이블에 3개 subtype 필드 혼재 | **subtype별 Stat 테이블로 명확 분리** | subtype별 Stat 필요(A와 동일 이점 없음) |
| identity reconciliation | A/B/C 선택과 무관 — 별도 `EducationIdentityMapping`으로 해결(§5) | 동일 | 동일 |
| migration complexity | 낮음(테이블 1개) | 중간(테이블 여러 개, 단 각자 독립 배포 가능) | **가장 높음**(공유 부모+3개 자식, Prisma엔 진짜 테이블 상속이 없어 사실상 B와 동일한 자식 테이블을 다시 만들어야 함 → 순수 이점 없이 조인 계층만 추가) |
| nationwide 확장 | 무관 | 무관 | 무관 |
| future maintenance | subtype 필드 추가 시 거대 테이블에 또 nullable 컬럼 추가 | **subtype별 독립 변경, 서로 영향 없음** | School 스키마 변경이 공유 부모에 영향 위험 |

### 최종 추천: **Option B — School / Kindergarten / Childcare 완전 분리**

**이유**: 이 프로젝트에 이미 존재하는 성공 패턴(`ApartmentMaster`+
`ApartmentLocationFeature`, `RedevelopmentProject`)이 전부 "단일
concrete 타입 + 필요 시 companion 테이블"이지, 폴리모픽 부모
테이블을 쓰지 않는다. Prisma에는 진짜 table-per-hierarchy 상속이
없어 Option C의 "공통 core"는 실제로는 School/Kindergarten/Childcare를
그대로 다시 만들고 얇은 부모 테이블 하나를 얹는 것과 다르지 않다 —
조인 비용만 추가되고 얻는 이득(폴리모픽 FK 하나로 묶기)은
`ApartmentEducationLink`(§17)에서 **타입 discriminator 컬럼 +
nullable per-type id**로 동일하게 달성 가능하다(이 방식도 이미
`RedevelopmentSourceRecord`가 `source: String`을 enum 대신 쓴
전례와 같은 결의 선택). Option A는 "테이블 수를 늘리지 않는다"는
지시와 얼핏 맞아 보이지만, 실제로는 nullable 컬럼 폭증과 타입
안전성 상실이라는 다른 형태의 복잡도를 만든다 — 이 코드베이스가
이미 피해온 패턴이다.

---

## 3. Entity Boundary 분류(§3 후보 판정)

| 후보 | 판정 | 사유 |
|---|---|---|
| **School** | KEEP | canonical entity, NEIS 우선 identity |
| **SchoolStat** | KEEP | 학교×공시연도 temporal stat |
| **SchoolFacility** | **MERGE → SchoolStat** | 학교알리미 시설현황도 동일 공시 주기·source에서 나오는 카테고리 중 하나(§V2-B §1-3) — 필드 스키마가 아직 미확정인 상태에서 4번째 테이블을 미리 만들 근거 부족. 시설 데이터가 실제로 별도 구조(예: 다건의 개별 시설 레코드)로 확인되면 그때 분리(FUTURE) |
| **Kindergarten** | KEEP | |
| **KindergartenStat** | KEEP | |
| **Childcare** | KEEP | |
| **ChildcareStat** | KEEP | |
| **EducationSourceSnapshot** | **MERGE → 각 core/stat 테이블의 row-level provenance 컬럼**(`ApartmentLocationFeature` 패턴 재사용) | 별도 스냅샷 로그 테이블 없이 `source/sourceDataset/fetchedAt/sourceUpdatedAt/schemaVersion`을 row에 직접 둠 — Redevelopment처럼 "동일 기관을 여러 source가 경쟁적으로 보고"하는 시나리오가 학교/유치원/어린이집에는 없어(각 subtype당 사실상 1개 주 source) 별도 로그 테이블의 실익이 낮음 |
| **EducationSource** | KEEP(단, 매우 작은 reference 테이블) | 라이선스/법적 게이트 registry(§32) — source별 1행, ingestion 전 필수 조회 |
| **EducationInstitutionAlias** | **MERGE → EducationIdentityMapping** | alias는 mapping의 특수 케이스, 별도 테이블 불필요 |
| **EducationIdentityMapping** | KEEP | NEIS↔학교알리미 등 cross-source identity 후보를 review queue로 관리(§5) |
| **ApartmentEducationLink** | KEEP | §17 참고, materialized nearest-N |
| **AttendanceZone** | **FUTURE** | §19 — 이번 단계는 외부 SHP/GeoJSON 유지, DB 테이블 생성 보류 |
| **GraduateOutcomeSnapshot**(§10 신규 후보) | KEEP(단, SchoolStat과 분리 유지) | 법적 게이트(LEGAL_REVIEW_REQUIRED)와 스키마 미확정 상태를 SchoolStat과 격리하기 위해 의도적으로 별도 테이블 — SchoolStat ingestion이 13-다 법적 검토 대기와 무관하게 진행될 수 있어야 하고, 13-다가 최종 REJECT되면 이 테이블만 드롭하면 됨(SchoolStat 영향 없음) |

**최종 신규 테이블 수: 10개**(School, SchoolStat, Kindergarten,
KindergartenStat, Childcare, ChildcareStat, EducationSource,
EducationIdentityMapping, ApartmentEducationLink,
GraduateOutcomeSnapshot) — 후보 13개에서 3개 병합(SchoolFacility,
EducationSourceSnapshot, EducationInstitutionAlias)해 축소. AttendanceZone은
이번 phase 제외.

---

## 4. Canonical Identity

### 4-1. School(§5)

**우선순위: NEIS `SD_SCHUL_CODE`** — 이미 코드에 연동돼 있고, 정부
공식 코드이며, V1에서 확인된 대로 값 자체는 매 요청 응답에 항상
존재한다(현재는 상세 페이지 이동 시 버려질 뿐). `School.id`는
`ApartmentMaster` 패턴과 동일하게 **내부 autoincrement PK + nullable
외부 자연키**(`neisSchoolCode String? @unique`)로 설계한다.

**학교알리미 identifier와의 매핑은 확정하지 않는다** — V2-B §1-6에서
이미 UNKNOWN으로 남긴 사실을 그대로 유지. 매핑 규칙을 추정해서
만들지 않고, 실제 학교알리미 키 발급 후 응답에 나타나는 식별자를
`EducationIdentityMapping`에 **review 상태로만** 기록한다. 자동
fuzzy 확정(이름 매칭만으로 같은 학교라고 단정)은 금지 —
`matchConfidence`/`mergeStatus`(§1-7(b) 패턴 재사용)로 unresolved를
명시적으로 유지한다.

### 4-2. Kindergarten(§6)

V2-B §2-3에서 유치원 고유 기관코드 존재 자체가 **UNKNOWN**으로
남았다 — 있다고 가정해 canonical key를 설계하지 않는다. 설계:

- `Kindergarten.id`(내부 PK) + `officialCode String?
  @unique`(실제 확인되면 채움, 미확인 상태로도 테이블 생성 가능)
- 코드가 끝내 확인되지 않으면 **복합 자연키 fallback**: 시도교육청코드
  + 행정구역코드 + 정규화된 기관명 해시 — 단 이 fallback 키는
  `identityConfidence: LOW`로 명시 표기하고, 이름/주소 변경 시
  깨질 수 있음을 알고 쓰는 임시값으로 취급한다(장기 canonical key로
  승격하지 않음).

### 4-3. Childcare(§7)

V2-B §3-2에서 **"시설코드" 필드가 확인됨** — 이것을 canonical key로
채택한다(`Childcare.id` 내부 PK + `facilityCode String? @unique`,
`aptSeq`/`officialCode` 패턴과 동일). 이름/주소 변경에도 시설코드는
유지될 것으로 기대되나(정부 발급 코드 통상 관례), 이 가정 자체가
아직 실제 API 응답으로 재확인된 것은 아니므로 초기 ingestion에서
시설코드 안정성을 실측 검증하는 단계를 둔다(§20).

### 4-4. Cross-source mapping 원칙(공통, §11 관련)

- 매핑 실패 시 **자동 fuzzy 확정 금지** → `EducationIdentityMapping.status
  = UNRESOLVED`로 남기고 review queue에 노출.
- 이름 문자열만으로 identity를 확정하지 않는다(현재 `/school/[id]`가
  하고 있는 방식, §1-6에서 확인된 정확히 그 문제) — 이번 설계로
  근본 해결.

---

## 5. Static vs Temporal Field 재분류(§8)

| 필드 | 원 분류 | 재분류 | 근거 |
|---|---|---|---|
| canonical code, 이름, 주소, 설립유형, 학교급/기관유형, 전화, 홈페이지 | STATIC | **SLOW_CHANGE**(연혁 보존 없이 현재값 덮어쓰기 + `updatedAt`) | 실제로는 이름/주소가 바뀌는 사례가 있음(V2-B alias 이슈, memory 참고) — "STATIC"이라 부르면 변경을 놓칠 위험, "SLOW_CHANGE + updatedAt"이 더 정확 |
| 좌표, 좌표 source | STATIC | SLOW_CHANGE(§9 coordinate model과 동일 처리) | |
| 학생수/학급수/학년별 학생수/교원수 | TEMPORAL | **TEMPORAL(연도 키)** 유지 | 학교알리미 연 1회 공시 확인(V2-B) — 연도별 row 필수 |
| 정원/현원(유치원) | TEMPORAL | TEMPORAL 유지 | 유치원 통합현황 파일도 주기적 갱신(V2-B §2-3) |
| 연령별 원아수, 교직원수 | TEMPORAL | TEMPORAL 유지 | 동일 source, 동일 주기로 추정 |
| 운영시간/통학차량/방과후/돌봄/늘봄/CCTV | TEMPORAL(요청안) | **SNAPSHOT**(최신값 덮어쓰기 + `fetchedAt`, 연도별 row 강제 안 함) | 이 항목들은 "공시 라운드"라기보다 "현재 운영 여부" 성격 — 매년 새 row를 강제하면 대부분 값이 안 바뀐 채 중복만 쌓임. 단, 최신 스냅샷 이전 값을 완전히 버리지는 않는다(교체 시 이전 row를 `validUntil` 마감 처리하는 SCD-lite 방식, 신규 인프라 도입 아님) |
| 졸업생 진로 현황(13-다) | TEMPORAL | TEMPORAL(연도 키), 단 **별도 테이블**(§3, §10) | 법적 게이트·스키마 미확정 격리 |

---

## 6. School Statistics Model(§9)

### 6-1. 학년별 데이터: JSON vs row-normalized vs hybrid

| 옵션 | 평가 |
|---|---|
| A. JSON blob 전체 | 쿼리·집계 어려움(학년별 필터링 시 매번 JSON 파싱), 이 프로젝트에 JSON 필드 선례는 있으나(`RedevelopmentSourceRecord.rawPayload`) 그건 raw 보존용이지 조회용이 아님 |
| B. Row-normalized(학교×연도×학년) | 학교급마다 학년 수가 다름(초6/중3/고3)이라 스키마 자체는 깨끗하나, 총계(총학생수 등) 조회 시 매번 SUM 필요 |
| **C. Hybrid(추천)** | 학교×연도 row에 **총계는 명시적 typed 컬럼**(`totalStudentCount`, `totalClassCount`, `teacherCount` — V2-B §1-3에서 카테고리 레벨 확인된 값), **학년별 세부는 `gradeBreakdown Json?`**(`schemaVersion` 동반) — `RedevelopmentSourceRecord`가 이미 "확정 필드는 typed 컬럼 + 나머지는 rawPayload Json"으로 쓰는 것과 동일 결. 총계만으로 충분한 대부분의 UI(§30 API)는 JSON을 파싱할 필요가 없고, 학년별 breakdown이 필요한 화면만 JSON을 읽는다 |

### 6-2. SchoolStat 초안 필드(예시, 실제 확인된 범위만)

`schoolId(FK→School.id), disclosureYear, totalStudentCount?,
totalClassCount?, teacherCount?, gradeBreakdown Json?, source,
sourceDataset, fetchedAt, sourceUpdatedAt?, schemaVersion,
disclosureStatus(enum, §27), qualityFlag` — **학급당 학생수는
컬럼으로 미리 만들지 않는다**(§6-1, source가 이미 계산해서 주는지
불확실 — DERIVABLE 상태, V2-B §1-3). 컬럼 확정은 실제 키 발급 후.

---

## 7. 졸업생 진로 현황(13-다) Temporal Model(§10)

### 7-1. 옵션 비교

| 옵션 | 평가 |
|---|---|
| A. Generic JSON payload + schemaVersion(SchoolStat에 컬럼 추가) | SchoolStat의 idempotency/ingestion을 13-다의 법적 게이트에 종속시킴 — 13-다가 막히면 SchoolStat도 영향받을 위험 |
| **B. `GraduateOutcomeSnapshot` 별도 테이블 + rawNormalizedPayload(추천)** | SchoolStat과 완전 분리 → 법적 검토/스키마 확정을 독립적으로 진행 가능, 최종 REJECT 시 테이블 하나만 드롭하면 됨 |
| C. 세부 schema 확인 후 dedicated table | 방향은 맞으나 "언제 만들지"에 대한 답이 없음 — B로 지금 뼈대만 만들고 세부 컬럼은 나중에 추가하는 것이 실질적으로 동일하면서도 더 빠르게 시작 가능 |

### 7-2. GraduateOutcomeSnapshot 초안(세부 진학유형 컬럼 없음)

```
GraduateOutcomeSnapshot {
  id                Int      @id @default(autoincrement())
  schoolId          Int      // School.id, 값 기반 연결(느슨한 FK, §1-7a 패턴)
  disclosureYear    Int      // 공시연도(11월 공시분 → 통상 전년도 졸업생 기준으로 추정, 미확정)
  targetLevel       String   // '중학교' | '고등학교' | '특수학교' | '각종학교' — 원문 그대로 저장
  sourceApiCategory String   // 학교알리미 OpenAPI 카테고리명("학생 진로 현황") 기록용
  sourceDataset     String?  // 파일 경로였다면 그 데이터셋 id
  schemaVersion     String   @default("unconfirmed-v0") // 필드 스키마 미확정 상태를 명시
  rawPayload        Json?    // 응답 원문 그대로 보존(정규화 컬럼 없음)
  fetchedAt         DateTime
  sourceUpdatedAt   DateTime?
  legalReviewStatus String   @default("PENDING") // §32 게이트, EducationSource와 별개로 이 항목 전용 상태도 유지(더 보수적인 항목이라 이중 게이트)
  qualityFlag       String   @default("SCHEMA_UNCONFIRMED")
  createdAt         DateTime @default(now())
  @@unique([schoolId, disclosureYear, targetLevel])
}
```

**일반고/자공고/자사고/특성화고/마이스터고/외고/국제고/과학고/예술고/
체육고/대학진학/전문대/취업/기타/진학자수/졸업자수/비율 — 이 중
어떤 것도 컬럼으로 만들지 않는다.** 전부 `rawPayload` 안에만 존재.
실제 키 발급 후 필드가 확정되면 그때 dedicated 컬럼 추가(별도
migration, 이번 STEP 범위 아님).

### 7-3. Historical retention(§11)

- 최근 3년 제약(V2-B §1-4-5, 법령 근거 확인됨)을 ingestion 주기
  설계에 반영: 매년 11월(추정) 이후 새 `disclosureYear` row를
  추가하는 방식이면 3년치가 자연스럽게 누적된다 — 단, **이집이
  수집한 시점의 snapshot을 이집 DB에 몇 년치 보관할지는 소스의
  3년 제약과 별개 문제**다(소스가 3년만 "제공"하는 것과 이집이
  받은 데이터를 얼마나 "보관"해도 되는지는 라이선스 문제).
- **라이선스가 장기 보관/가공을 허용한다고 이번 단계에서 단정하지
  않는다** — `legalReviewStatus`가 `CLEARED`가 되기 전까지
  ingestion 자체를 실행하지 않는 게이트를 pipeline 레벨에 둔다(§20).

---

## 8. Kindergarten / Childcare Statistics(§12, §13)

| 유치원 항목 | 분류 |
|---|---|
| 정원 | ANNUAL_STAT |
| 현원 | ANNUAL_STAT |
| 학급수 | ANNUAL_STAT |
| 연령별 원아수 | ANNUAL_STAT(단, 필드 세부는 §V2-B UNKNOWN — gradeBreakdown류 Json 패턴 재사용 가능) |
| 교직원 | ANNUAL_STAT |
| 통학차량 | SNAPSHOT |
| 방과후 | SNAPSHOT |
| 운영시간 | UNKNOWN(V2-B에서 필드 자체 미확인) |

| 어린이집 항목 | 분류 |
|---|---|
| 정원/현원 | ANNUAL_STAT(단, 업데이트 주기 자체가 V2-B에서 미확인 — 실제로는 SNAPSHOT에 더 가까울 수 있음, ingestion 시 실측 필요) |
| 유형(국공립/민간 등) | STATIC(변경 드묾, SLOW_CHANGE로 취급) |
| 교직원 | ANNUAL_STAT |
| CCTV | SNAPSHOT |
| 통학차량 | SNAPSHOT |
| 운영시간 | UNKNOWN(필드 존재는 V2-B에서 확인 안 됨) |
| 연장보육 | UNKNOWN |
| 평가등급 | UNKNOWN(source 자체 미확인, V2-B §3-2) |

---

## 9. Provenance Model(§14)

**row-level provenance를 기본으로 한다**(`ApartmentLocationFeature`
패턴). 모든 core/stat 테이블 공통 최소 컬럼:

`source, sourceDataset, referenceYear 또는 referenceDate, fetchedAt,
sourceUpdatedAt?, schemaVersion?, qualityFlag`

**field-level provenance는 기본적으로 두지 않는다** — 단 School처럼
NEIS와 학교알리미 두 source가 같은 개념(예: 학교명)을 각자 보고할
가능성이 있는 경우, 필드마다 provenance 메타데이터를 붙이는 대신
**소스별 필드를 아예 나눠서 저장**한다(`nameNeis`, `nameSchoolinfo`
같은 명시적 병렬 컬럼) — 메타데이터 오버헤드 없이 충돌을 눈에 보이게
하는 더 단순한 방법.

---

## 10. Source Conflict Rules(§15)

| 필드 | source of truth |
|---|---|
| 학교 identity/code | NEIS |
| 학교급 | NEIS |
| 학교명 | NEIS 기본, 학교알리미와 다르면 §9의 병렬 컬럼으로 둘 다 보존 |
| 학생/학급/교원 | 학교알리미 |
| 유치원 통계 | 교육부 통합 유치원 현황(파일, 라이선스 제한없음 우선) / 유치원알리미(상업이용 가능 오퍼레이션만) |
| 어린이집 | 어린이집 전국 API |
| 좌표 | 공식 좌표(있으면) 우선 → 없으면 Kakao geocoding(§11 coordinate model) |

**충돌 시 silent overwrite 금지** — `RedevelopmentProject.needsReview
Boolean` 패턴을 재사용해 각 core 테이블에 `needsReview Boolean
@default(false)` + `reviewNote String?`를 두고, ingestion이 두 source
값이 다름을 감지하면 최신 하나만 조용히 덮어쓰지 않고 flag를 세운다
(복잡한 별도 conflict-log 테이블은 만들지 않음 — 이 프로젝트에
필요 이상 테이블을 늘리지 않는다는 원칙 준수).

---

## 11. Coordinate Model(§16)

```
latitude          Float?
longitude         Float?
coordinateSource  String?   // 'official' | 'kakao_geocode' | ...
coordinateType    String?   // OFFICIAL_POINT | ADDRESS_GEOCODE | ENTRANCE | CENTER | UNKNOWN
coordinatePrecision String? // 확인된 값이 있을 때만
geocodedAt        DateTime?
```

`ApartmentMaster.geocodeQuality`('exact'|'normalized'|'failed') 패턴과
동일한 결의 String 값 — 신규 enum을 굳이 만들지 않고 기존 관례를
따른다. **주소 중심좌표(ADDRESS_GEOCODE)와 실제 출입구 좌표
(ENTRANCE)를 절대 같은 값으로 취급하지 않는다** — 현재 이 프로젝트의
학교 좌표는 전부 Kakao 키워드검색 결과이므로 초기값은 사실상 전부
`ADDRESS_GEOCODE` 또는 `UNKNOWN`이 될 것으로 예상(공식 좌표 source가
확인되면 `OFFICIAL_POINT`로 승격).

---

## 12. Apartment ↔ Education Relationship(§17)

| 옵션 | 평가 |
|---|---|
| A. Request-time 계산(현재 `/api/school/apartments` 방식) | correctness는 실시간이라 높음, 그러나 API 비용·응답지연이 페이지 로드마다 발생, 전국 확장 시 비용 선형 증가 |
| **B. Materialized `ApartmentEducationLink`** | 배치로 nearest-N 미리 계산, 응답 즉시, 갱신 주기만큼 stale 가능성 있으나 학교 위치 자체가 자주 안 바뀌어 리스크 낮음 |
| **C. Hybrid(추천)** | 학교/유치원/어린이집 "주변 목록 카드"류(현재 상세페이지, 지도 마커, Score Engine)는 **B(materialized)**로 전환 — `ApartmentLocationFeature.nearestElementaryDistanceM`이 이미 이 패턴으로 운영 중이라 그대로 확장. "인근 아파트 실거래가 목록"처럼 실거래가·준공연도 등 다른 외부 API와 실시간 조합이 필요한 화면(현재 `/api/school/apartments`)은 **A를 당분간 유지**(위험 낮고 이미 작동 중, 이번 STEP에서 손대지 않음) |

### ApartmentEducationLink 초안

```
ApartmentEducationLink {
  id              Int      @id @default(autoincrement())
  aptSeq          String   // ApartmentMaster.aptSeq, 값 기반 연결(FK 아님, 기존 컨벤션)
  institutionType String   // 'SCHOOL' | 'KINDERGARTEN' | 'CHILDCARE'
  institutionId   Int      // School.id / Kindergarten.id / Childcare.id (type으로 구분, FK 아님)
  distanceM       Float
  distanceType    String   @default("STRAIGHT_LINE") // §18, 향후 'WALKING' 추가 예정
  rank            Int      // 1=최근접
  fetchedAt       DateTime
  @@unique([aptSeq, institutionType, rank])
}
```

폴리모픽 FK 대신 `institutionType` discriminator + 값 기반 연결 —
`RedevelopmentSourceRecord.source: String` 선례와 같은 방식, Option C
(entity model, §2)에서 기각한 "공유 부모 테이블"의 실익(단일 링크
포인트)을 테이블 하나 추가 없이 달성.

---

## 13. Distance Future Model(§18)

**중요 제약 재확인**: 현재 `walkMin = round(dist*1.45*15) + padding`
값은 **추정치이며 실제 보행경로 값이 아니다**(§1-7e). 이 값을
`walkingDistanceM`/`walkingDurationSec`에 저장하는 것은 이번 설계에서
금지 — 대신:

```
straightDistanceM         Float?   // 현재도 계산 가능(Turf.js), 즉시 채울 수 있음
estimatedWalkMinutes      Int?     // 현재 방식(1.45배 근사) 값은 여기로만
walkingDistanceM          Float?   // 실제 route API 도입 후에만 채움(V2-C5+)
walkingDurationSec        Int?     // 상동
routeProvider             String?
routeCalculatedAt         DateTime?
routeStatus                String?  // NOT_ATTEMPTED | SUCCESS | FAILED
originCoordinateType      String?
destinationCoordinateType String?
```

실제 route 구현은 이번 STEP 범위 밖(V2-C5 이후).

---

## 14. Attendance Zone Model(§19)

| 옵션 | 평가 |
|---|---|
| A. Polygon DB 저장 | PostGIS 등 신규 공간 인프라 필요 — 이번 단계 금지 범위 |
| **B. 외부 SHP/GeoJSON 유지(추천, 이번 phase)** | 학구도안내서비스(V2-B §4)가 이미 SHP를 공식 제공 — 이집이 지금 당장 자체 공간 DB를 가질 필요 없이 필요 시점에 파일을 직접 참조/캐시 |
| C. Ingestion 후 simplified metadata만 저장 | 향후 후보(zoneId/zoneName/sourceDataset/sourceFileRef만 저장, 실제 polygon은 파일 참조) |
| D. Hybrid | 장기적으로는 C가 사실상 B→C 전환 경로 |

**추천: 이번 phase는 B(외부 유지), DB 테이블 생성하지 않음.** §3에서
`AttendanceZone`을 FUTURE로 분류한 이유와 동일 — PostGIS 없이
polygon을 Prisma/PostgreSQL 기본 타입으로 저장하는 것은 무리한
premature 설계다.

---

## 15. Ingestion Architecture(§20-25)

### 15-1. Pipeline stage(source 공통)

```
fetch → normalize → validate → identity match → upsert → audit → report
```

- **fetch**: source별 공식 API/파일(V2-B에서 확인된 URL만 사용)
- **normalize**: 원본 필드 → 내부 스키마 매핑(§9 School 예시 참고)
- **validate**: 필수 필드 존재/타입 확인, 실패 시 `SOURCE_ERROR`
  플래그(§26)로 기록하고 skip(전체 배치를 죽이지 않음)
- **identity match**: canonical key 매칭 시도 → 실패 시
  `EducationIdentityMapping`에 UNRESOLVED로 적재, 자동 확정 금지
- **upsert**: idempotency key(§21) 기준
- **audit**: `fetchedAt`/`sourceUpdatedAt` 등 provenance 기록
- **report**: `collect-location-features.ts`와 동일한 형태의
  success/partial/failed/rateLimited 요약 콘솔 출력

각 source(NEIS/학교알리미/유치원/어린이집/통학구역)는 **독립
스크립트로 개별 실행 가능**해야 한다(현재 apartment-score 스크립트
군의 구조를 그대로 재사용).

### 15-2. Idempotency(§21) — 후보 unique key

| 테이블 | unique key(예시, 실제 필드 확정 후 재검증) |
|---|---|
| School | `neisSchoolCode` |
| SchoolStat | `[schoolId, disclosureYear]` |
| GraduateOutcomeSnapshot | `[schoolId, disclosureYear, targetLevel]` |
| Kindergarten | `officialCode`(확인 시) 또는 복합키(§4-2) |
| KindergartenStat | `[kindergartenId, referenceYear]` |
| Childcare | `facilityCode` |
| ChildcareStat | `[childcareId, referenceDate 또는 referenceYear]` |
| ApartmentEducationLink | `[aptSeq, institutionType, rank]` |

migration은 작성하지 않는다 — 이 표는 설계 근거일 뿐.

### 15-3. Resumability(§22)

`collect-location-features.ts`의 `validUntil > now` freshness-skip을
그대로 재사용: 이미 최신인 row는 재수집하지 않고 스킵 → 중단 후
재실행 시 자연스럽게 이어감. 추가로 필요할 수 있는 것:

- **per-source checkpoint**: 대상 목록(예: 부산 667개교)을 페이지/
  배치 단위로 나눠 마지막 성공 offset을 로그로 남김(별도 DB 테이블
  아님, 스크립트 실행 로그 수준 — 기존 코드베이스에 이미 이 정도
  수준의 resumability만 존재, 과도한 인프라 도입 안 함)
- **per-region progress**: 부산 16개 구·군 단위로 나눠 순차 실행
  가능하게(현재 apartment-score의 `--sggCd=` 패턴 재사용)

BUSAN SCORE DATA V1의 idempotent/resumable 운영 경험은 이렇게
**패턴만 참고**하고 코드를 억지로 import/재사용하지 않는다(요청
지시 그대로 — School/Kindergarten/Childcare는 API 응답 구조가
아파트 점수 collector와 다르므로 새로 작성).

### 15-4. Refresh Schedule(§23) — 확인된 주기만

| source | 주기 |
|---|---|
| NEIS `schoolInfo` | 확인 안 됨(현재 request-time) — **TBD** |
| 학교알리미 학생/학급/교원 | 연 1회 이상 공시(V2-B §1-1) |
| 유치원 통합현황(파일) | "수시 자동갱신"(V2-B §2-3) — 구체 주기 **TBD** |
| 유치원알리미(API) | **TBD** |
| 어린이집 전국 API | **TBD**(V2-B에서 미확인) |
| 통학구역(학구도안내서비스) | "수시"(V2-B §4-1) — 구체 주기 **TBD** |
| 13-다 졸업생 진로 현황 | 연 1회, 11월(V2-B 정정 확정) |

추정 금지 원칙에 따라 TBD는 TBD로 남긴다.

### 15-5. Cache Strategy(§24)

**DB-first, stale-while-refresh**로 전환 제안:

1. School/SchoolStat 등이 부산 기준 ingestion 완료되면, `/api/school`
   등은 **DB를 우선 조회**하고, DB에 해당 지역/조건 row가 없을 때만
   기존 NEIS 실시간 호출로 폴백(마이그레이션 브리지 — 이번 STEP은
   설계만, 이 폴백 자체를 지금 구현하지 않음).
2. `getOrSetCache`의 인메모리 TTL 캐시는 DB 조회 결과에도 계속
   씌울 수 있다(캐시 계층 자체는 유지, 그 아래 data source만 NEIS
   실시간 → DB로 교체).
3. 최종적으로 학교 상세 페이지가 매 요청마다 외부 API에 의존하지
   않는 것이 목표(요청 지시 §24 그대로).

### 15-6. Rate-limit Resilience(§25)

- **batching**: NEIS 500건 페이지네이션(기존 로직 유지), 학교알리미/
  어린이집도 대상 목록을 배치로 쪼갬
- **delay**: 요청 사이 pacing(Kakao 관례 150ms를 기존 프로젝트가
  이미 쓰고 있음 — 신규 source에도 동일 관례 적용 권장)
- **retry + exponential backoff**: NEIS `ERROR-337`(트래픽 초과,
  V2-B 확인), Kakao 429 등에 대응
- **checkpoint/partial failure**: 배치 중 일부 실패해도 나머지는
  계속 진행, 실패분만 `SOURCE_ERROR` 플래그로 별도 재시도 대상화
- **failure report**: `collect-location-features.ts`의 summary
  카운터 패턴 재사용

---

## 16. Data Quality Flags(§26)

**공유 enum 하나로 통합 제안**(`RedevelopmentMatchConfidence`/
`MergeStatus`처럼 이 스키마에 이미 Prisma enum 전례가 있어 String
대신 enum 채택 근거 있음):

```
enum EducationDataQuality {
  COMPLETE
  PARTIAL
  STALE
  IDENTITY_UNRESOLVED
  COORDINATE_APPROX
  SOURCE_ERROR
  LEGAL_REVIEW_REQUIRED
  SCHEMA_UNCONFIRMED
}
```

**사용자 노출 상태는 별도로 단순화**해서 분리(내부 enum 값을 그대로
화면에 보이지 않음): 예) "정상" / "준비 중" / "확인 필요" 3단계
정도로만 매핑 — 구체 매핑 규칙은 UI 설계(V2-D) 단계에서 확정.

---

## 17. Missing Data Semantics(§27)

`NULL`(미수집) / `0`(실제 확인된 0) / `UNKNOWN`(source에 필드 자체가
불명확) / `NOT_APPLICABLE`(그 학교급/기관유형에 원래 해당 없음) /
`NOT_DISCLOSED`(source가 이번 라운드에 공시하지 않음) /
`SOURCE_ERROR`(수집 실패)를 구분하기 위해, 단순 nullable만으로는
"공시 안 됨"과 "수집 실패"를 못 가르므로 **stat 테이블마다
`disclosureStatus` enum을 별도로 둔다**:

```
enum DisclosureStatus {
  DISCLOSED
  NOT_DISCLOSED
  NOT_APPLICABLE
  SOURCE_ERROR
}
```

숫자 필드가 `0`이면서 `disclosureStatus = DISCLOSED`인 경우만 "실제
0명/0학급"으로 화면에 표시 가능 — 나머지는 "데이터 없음"으로 렌더링
(현재 `/school` 페이지의 "데이터 준비 중" 표기 원칙과 동일 정신을
DB 레벨에서 구조적으로 보장).

---

## 18. Derived Metrics(§28-29)

**원자료 보존이 기본, derived 값은 원칙적으로 DB에 저장하지 않고
runtime 계산**(Score Engine의 RAW≠SCORE 원칙, §1-7d 그대로 적용):

- 학급당 학생수, 학생당 교원수, 유치원/어린이집 충원율, 전년 대비
  변화율 — 전부 애플리케이션 레이어에서 저장된 원자료로 즉시 계산
  가능하므로 컬럼을 만들지 않는다.
- **예외**: source 자체가 이미 계산된 비율/평균을 제공하는 것으로
  확인되는 경우(예: `15106331` 데이터셋 설명의 "학급당 학생수
  통계도 제공" — DERIVABLE 상태, V2-B §1-3)만, 그 값을
  `SOURCE_PROVIDED`로 명확히 구분되는 별도 필드에 저장 — **e-jip이
  계산한 값과 절대 같은 컬럼에 섞지 않는다.**
- 학교알리미 화면에 비율이 보인다는 이유로 그것이 API source
  field라고 가정하지 않는다(요청 원칙 재확인, 13-다는 특히 이
  원칙이 중요 — §7-2).

---

## 19. Public API Recommendation(§30)

| route | 방향 |
|---|---|
| `GET /api/school` | **EXTEND** — 응답 shape 유지, 내부 data source만 NEIS 실시간 → School(DB) 우선 조회로 전환(§15-5), 폴백 유지 |
| `GET /api/school/stats` | **EXTEND** — `specRate`(현재 항상 null) 자리에 SchoolStat 집계값 채움 가능해짐, `studentCount`/`classCount` 등 신규 필드 추가 |
| `GET /api/school/apartments` | **KEEP**(단기) — 이미 잘 작동하는 request-time 조합, 이번 STEP에서 변경 안 함. 장기적으로 `ApartmentEducationLink`(§12) 활용한 EXTEND 여지는 있으나 이번 phase 범위 밖 |

**원칙**: 외부 원본 필드명(`SD_SCHUL_CODE`, `SCHUL_KND_SC_NM` 등)을
public API 응답에 그대로 노출하지 않는다 — 현재 `route.ts`가 이미
`mapped`로 변환해 내보내는 패턴을 계속 따른다.

---

## 20. User-facing Source Attribution(§31)

`EducationSource`(§21) 테이블의 `displayName` + 각 row의
`referenceYear`/`disclosureYear`를 조합해 화면 문구 생성:

```
"자료: {EducationSource.displayName}" + "기준: {referenceYear}년 공시"
```

값 기반 조인(`source` 문자열 키로 `EducationSource.sourceKey` 조회) —
formal FK 없이도 attribution 텍스트 생성 가능.

---

## 21. Legal / License Metadata(§32)

```
EducationSource {
  id                    Int      @id @default(autoincrement())
  sourceKey             String   @unique // 'neis' | 'schoolinfo_api' | 'schoolinfo_file' | 'kindergarten_file' | 'kindergarten_api' | 'childcare_api' | ...
  displayName            String
  license                String?  // KOGL 유형 등 V2-B에서 확인된 값 그대로
  attributionRequired    Boolean  @default(true)
  commercialUseAllowed   String   @default("UNKNOWN") // 'ALLOWED' | 'DISALLOWED' | 'UNKNOWN' | 'MIXED'
  modificationAllowed    String   @default("UNKNOWN")
  legalReviewStatus      String   @default("NOT_REVIEWED") // NOT_REVIEWED | CLEARED | BLOCKED | PARTIAL
  termsCheckedAt         DateTime?
  notes                  String?
}
```

**ingestion pipeline은 실행 전 반드시 해당 `sourceKey`의
`legalReviewStatus`를 확인**하고, `CLEARED`가 아니면 스킵한다 —
이것이 학교알리미 API 경로/유치원알리미 API/13-다에 대한 실제
게이트 메커니즘이다(§V2-B §11의 LEGAL_REVIEW_REQUIRED를 코드
레벨로 강제).

---

## 22. Privacy(§33)

제안 스키마 전체에 **학생/교사 개인 식별 정보 필드가 없다** —
School/SchoolStat/GraduateOutcomeSnapshot 어디에도 이름/연락처 등
개인 단위 데이터를 담는 컬럼을 두지 않는다. 저장 대상은 전부 학교/
기관 단위 집계·공시 통계, 그리고 기관의 공식 대표 연락처(전화/
홈페이지)뿐이다 — V1 §18에서 이미 확인된 "개인정보 저장 구조 없음"
원칙을 신규 테이블에도 그대로 적용.

---

## 23. Scale(§34)

| 테이블 | 대략 규모(부산 MVP 기준, 개략 추정) |
|---|---|
| School | ~667행(NEIS 실측, V1 §5) |
| SchoolStat | 667 × 최대 3년 ≈ 2,000행 |
| GraduateOutcomeSnapshot | 667 중 중/고/특 대상만 × 최대 3년 ≈ 1,000행 미만(법적 게이트로 실제로는 0에서 시작) |
| Kindergarten | 부산 실측 미확인(수백~1천 단위로 추정, 확정 아님) |
| Childcare | 부산 실측 미확인(전국 3만+ 규모 기준 부산은 수천 단위로 추정, 확정 아님) |
| ApartmentEducationLink | ApartmentMaster 행 수(부산 기준 수천, memory 참고 3,067) × 3 institutionType × top-N(예 3) ≈ 수만 행 |

전부 일반적인 RDBMS 기준 소규모 — premature optimization(파티셔닝,
샤딩 등) 불필요.

---

## 24. Proposed Prisma Schema(문서 내 초안, `schema.prisma` 미수정)

> 아래는 **문서 안의 설계 초안**이다. 실제 파일에는 어떤 것도
> 반영하지 않았다.

```prisma
// ── School ──────────────────────────────────────────────
model School {
  id              Int      @id @default(autoincrement())
  neisSchoolCode  String?  @unique @map("neis_school_code") // SD_SCHUL_CODE
  schoolinfoCode  String?  @map("schoolinfo_code") // 학교알리미 식별자, 확인 후 채움(§4-1)

  nameNeis        String   @map("name_neis")
  nameSchoolinfo  String?  @map("name_schoolinfo") // §9 병렬 컬럼(충돌 보존)

  schoolLevel     String?  @map("school_level") // NEIS SCHUL_KND_SC_NM
  foundationType  String?  @map("foundation_type") // NEIS FOND_SC_NM
  coeduType       String?  @map("coedu_type") // NEIS COEDU_SC_NM
  roadAddress     String?  @map("road_address")
  phone           String?
  homepage        String?

  latitude            Float?
  longitude           Float?
  coordinateSource    String?
  coordinateType      String?
  geocodedAt          DateTime?

  sido            String?
  sigungu         String?

  needsReview     Boolean  @default(false) @map("needs_review") // §10 conflict flag
  reviewNote      String?  @map("review_note")

  source          String   @default("neis")
  fetchedAt       DateTime @map("fetched_at")
  sourceUpdatedAt DateTime? @map("source_updated_at")
  qualityFlag     EducationDataQuality @default(COMPLETE) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([sido, sigungu])
  @@map("schools")
}

// ── SchoolStat(temporal, §9) ────────────────────────────
model SchoolStat {
  id                Int      @id @default(autoincrement())
  schoolId          Int      @map("school_id") // School.id, 값 기반
  disclosureYear    Int      @map("disclosure_year")

  totalStudentCount Int?     @map("total_student_count")
  totalClassCount   Int?     @map("total_class_count")
  teacherCount      Int?     @map("teacher_count")
  gradeBreakdown    Json?    @map("grade_breakdown") // §6-1 hybrid

  disclosureStatus  DisclosureStatus @default(NOT_DISCLOSED) @map("disclosure_status")

  source            String   @default("schoolinfo")
  sourceDataset     String?  @map("source_dataset")
  schemaVersion     String   @default("v0") @map("schema_version")
  fetchedAt         DateTime @map("fetched_at")
  sourceUpdatedAt   DateTime? @map("source_updated_at")
  qualityFlag       EducationDataQuality @default(SCHEMA_UNCONFIRMED) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([schoolId, disclosureYear])
  @@map("school_stats")
}

// ── GraduateOutcomeSnapshot(§7) ─────────────────────────
model GraduateOutcomeSnapshot {
  id                Int      @id @default(autoincrement())
  schoolId          Int      @map("school_id")
  disclosureYear    Int      @map("disclosure_year")
  targetLevel       String   @map("target_level") // '중학교'|'고등학교'|'특수학교'|'각종학교'

  sourceApiCategory String   @map("source_api_category") // "학생 진로 현황"
  sourceDataset     String?  @map("source_dataset")
  schemaVersion     String   @default("unconfirmed-v0") @map("schema_version")
  rawPayload        Json?    @map("raw_payload") // 세부 컬럼 없음(§7-2 원칙)

  fetchedAt         DateTime @map("fetched_at")
  sourceUpdatedAt   DateTime? @map("source_updated_at")
  legalReviewStatus String   @default("PENDING") @map("legal_review_status")
  qualityFlag       EducationDataQuality @default(SCHEMA_UNCONFIRMED) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([schoolId, disclosureYear, targetLevel])
  @@map("graduate_outcome_snapshots")
}

// ── Kindergarten / KindergartenStat ─────────────────────
model Kindergarten {
  id               Int      @id @default(autoincrement())
  officialCode     String?  @unique @map("official_code") // §4-2, 미확인 시 null
  identityConfidence String @default("LOW") @map("identity_confidence") // 코드 미확인 fallback 명시

  name             String
  foundationType   String?  @map("foundation_type")
  roadAddress      String?  @map("road_address")
  phone            String?

  latitude         Float?
  longitude        Float?
  coordinateSource String?
  coordinateType   String?

  sido    String?
  sigungu String?

  source          String   @default("moe_kindergarten")
  fetchedAt       DateTime @map("fetched_at")
  qualityFlag     EducationDataQuality @default(COMPLETE) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([sido, sigungu])
  @@map("kindergartens")
}

model KindergartenStat {
  id              Int      @id @default(autoincrement())
  kindergartenId  Int      @map("kindergarten_id")
  referenceYear   Int      @map("reference_year")

  capacity        Int?     // 정원
  enrollment      Int?     // 현원
  classCount      Int?     @map("class_count")
  staffCount      Int?     @map("staff_count")
  ageBreakdown    Json?    @map("age_breakdown")

  hasSchoolBus    Boolean? @map("has_school_bus")
  hasAfterSchool  Boolean? @map("has_after_school")

  disclosureStatus DisclosureStatus @default(NOT_DISCLOSED) @map("disclosure_status")
  source           String  @default("moe_kindergarten_file")
  fetchedAt        DateTime @map("fetched_at")
  qualityFlag      EducationDataQuality @default(COMPLETE) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([kindergartenId, referenceYear])
  @@map("kindergarten_stats")
}

// ── Childcare / ChildcareStat ───────────────────────────
model Childcare {
  id               Int      @id @default(autoincrement())
  facilityCode     String?  @unique @map("facility_code") // §4-3

  name             String
  facilityType     String?  @map("facility_type") // 국공립/민간/가정/직장 등
  roadAddress      String?  @map("road_address")
  phone            String?

  latitude         Float?
  longitude        Float?
  coordinateSource String?
  coordinateType   String?

  sido    String?
  sigungu String?

  source          String   @default("childcare_national_api")
  fetchedAt       DateTime @map("fetched_at")
  qualityFlag     EducationDataQuality @default(COMPLETE) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([sido, sigungu])
  @@map("childcares")
}

model ChildcareStat {
  id            Int      @id @default(autoincrement())
  childcareId   Int      @map("childcare_id")
  referenceDate DateTime @map("reference_date") // 연 단위 미확정이라 date로(§15-4 TBD)

  capacity      Int?
  enrollment    Int?
  staffCount    Int?     @map("staff_count")
  hasCctv       Boolean? @map("has_cctv")
  hasSchoolBus  Boolean? @map("has_school_bus")

  disclosureStatus DisclosureStatus @default(NOT_DISCLOSED) @map("disclosure_status")
  source           String  @default("childcare_national_api")
  fetchedAt        DateTime @map("fetched_at")
  qualityFlag      EducationDataQuality @default(COMPLETE) @map("quality_flag")

  createdAt DateTime @default(now()) @map("created_at")

  @@unique([childcareId, referenceDate])
  @@map("childcare_stats")
}

// ── 공통 ────────────────────────────────────────────────
model EducationSource { /* §21 참고 */ }
model EducationIdentityMapping {
  id              Int      @id @default(autoincrement())
  institutionType String   @map("institution_type") // SCHOOL|KINDERGARTEN|CHILDCARE
  primarySource   String   @map("primary_source") // 예: 'neis'
  primaryId       Int      @map("primary_id")
  candidateSource String   @map("candidate_source") // 예: 'schoolinfo'
  candidateKey    String   @map("candidate_key") // 상대 source가 보고한 식별자/이름 원문

  matchConfidence String   @default("UNMATCHED") @map("match_confidence") // EXACT|HIGH|MEDIUM|LOW|UNMATCHED
  mergeStatus     String   @default("UNMATCHED") @map("merge_status") // AUTO_MATCHED|REVIEW_REQUIRED|MANUAL_MATCHED|UNMATCHED

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([institutionType, primarySource, primaryId, candidateSource])
  @@map("education_identity_mappings")
}
model ApartmentEducationLink { /* §12 참고 */ }

enum EducationDataQuality {
  COMPLETE
  PARTIAL
  STALE
  IDENTITY_UNRESOLVED
  COORDINATE_APPROX
  SOURCE_ERROR
  LEGAL_REVIEW_REQUIRED
  SCHEMA_UNCONFIRMED
}

enum DisclosureStatus {
  DISCLOSED
  NOT_DISCLOSED
  NOT_APPLICABLE
  SOURCE_ERROR
}
```

**주의**: 위 `EducationIdentityMapping.matchConfidence`/`mergeStatus`는
`RedevelopmentSourceRecord`처럼 Prisma enum으로 승격할 수도 있으나
(재사용 가능한 값 세트가 이미 존재), 이번 문서에서는 String으로
초안만 두고 실제 enum 채택 여부는 구현 STEP에서 확정한다.

---

## 25. Migration Impact(§36)

- **신규 테이블 수**: 10개(§3)
- **기존 테이블 변경**: **0건 필요** — `ApartmentMaster`,
  `ApartmentLocationFeature` 등 기존 스키마는 손대지 않는다(값 기반
  느슨한 연결 컨벤션을 그대로 따르므로 FK 추가 등 기존 테이블 수정이
  필요 없음).
- **`ApartmentMaster` 변경 여부**: **불필요**. `ApartmentEducationLink`가
  `aptSeq` 문자열로 값 기반 연결하므로 FK 컬럼 추가가 필요 없다.
- **backfill 필요 여부**: 신규 테이블이라 backfill 대상 자체가 없음
  (ingestion이 최초 채움 그 자체).
- **rollback 난이도**: 낮음 — 전부 additive(신규 테이블만), 기존
  테이블 컬럼 변경이 없어 rollback은 신규 테이블 drop으로 충분.
- **downtime**: 예상 없음(additive migration).
- **deploy sequence(향후 실제 승인 시)**:
  1. schema migration(테이블만 생성, 데이터 없음)
  2. `EducationSource` seed(라이선스/게이트 값 입력 — 값 자체는
     이번 V2-B 조사 결과 기반, 코드 하드코딩 아님)
  3. Kindergarten/Childcare ingestion(V2-C3, 라이선스 마찰 가장
     적어 먼저 실행 가능)
  4. NEIS+학교알리미 ingestion(V2-C2, 라이선스 재확인 선행)
  5. Identity reconciliation(V2-C4)
  6. API cutover(§15-5, DB-first 전환)
  7. `ApartmentEducationLink` materialization(V2-C5)
  8. AttendanceZone/13-다는 각자의 게이트(§14, §21) 해제 후 별도 실행

---

## 26. Implementation Phases(§37, 사용자 제안 구조 개선)

| phase | 내용 | 비고 |
|---|---|---|
| **V2-C1** | Core Education Schema + Source Metadata(§24 스키마, `EducationSource` seed) | migration만, ingestion 없음 |
| **V2-C2** | NEIS + 학교알리미 ingestion(부산, School/SchoolStat) | 착수 전 라이선스 재확인(V2-B §11) 선행 조건 |
| **V2-C3** | Kindergarten + Childcare ingestion(부산) | 라이선스 마찰 가장 적음(V2-B) — **C2보다 먼저 실행 가능**, 순서 재배치 제안 유지 |
| **V2-C4** | Identity reconciliation(NEIS↔학교알리미 매핑, review queue 운영) | |
| **V2-C5** | ApartmentEducationLink materialization + distance future model 뼈대(실제 route API는 제외) | |
| **V2-C6** | Attendance Zone(파일 기반, metadata만) | §14 |
| **V2-C7**(신규 분리) | Graduate Outcome(13-다) — 법적 검토 CLEARED + 필드 스키마 확정 후에만 | SchoolStat과 완전 독립 실행 |
| **V2-D** | Parent Decision UX(기존 계획 유지) | |

---

## 27. 사용자 승인 필요 결정사항(§38)

### 1. Unified vs Separate Institution Model
- OPTION: A(단일)/B(분리)/C(hybrid)
- RECOMMENDATION: **B**
- WHY: §2 비교표, 기존 코드베이스 컨벤션과 일치
- RISK: 낮음 — 이미 검증된 패턴 재사용
- MIGRATION IMPACT: 테이블 6개(core+stat ×3), 상호 독립 배포 가능

### 2. 신규 테이블 수
- OPTION: 13개 후보 그대로 / 통합 축소안(10개)
- RECOMMENDATION: **10개**(§3 병합 3건 반영)
- WHY: SchoolFacility/EducationSourceSnapshot/EducationInstitutionAlias는
  기존 row-level provenance 컨벤션으로 흡수 가능
- RISK: 나중에 시설 데이터가 복잡해지면 재분리 필요할 수 있음(낮은 리스크, FUTURE로 대응 가능)
- MIGRATION IMPACT: 없음(설계 단계)

### 3. Historical Retention(13-다 포함 전체)
- OPTION: 무제한 보존 / 3년만 보존 / 라이선스 확정 전 보존 안 함
- RECOMMENDATION: **라이선스 확정(`legalReviewStatus=CLEARED`) 전에는
  13-다 ingestion 자체를 실행하지 않음**(테이블은 존재하되 비어있는 상태 허용). School/Kindergarten/Childcare 일반 통계는 라이선스가 상대적으로 명확한 경로(파일/제한없음)를 우선 채택해 보존 제약이 낮음
- WHY: V2-B LEGAL_REVIEW_REQUIRED 원칙 유지
- RISK: 법적 검토가 늦어지면 13-다 기능 자체가 장기간 비어있음(허용 가능한 리스크 — 잘못된 데이터를 보여주는 것보다 안전)
- MIGRATION IMPACT: 없음(스키마는 미리 만들어도 무해)

### 4. ApartmentEducationLink Materialization
- OPTION: A(request-time만)/B(전량 materialize)/C(hybrid)
- RECOMMENDATION: **C**
- WHY: §12
- RISK: materialize 값이 stale할 수 있음(학교 이전 등 드문 이벤트) → refresh 주기로 완화
- MIGRATION IMPACT: 신규 테이블 1개, 기존 `/api/school/apartments` 변경 없음

### 5. Source Snapshot 보존(EducationSourceSnapshot 여부)
- OPTION: 별도 로그 테이블 / row-level 컬럼만
- RECOMMENDATION: **row-level만**(§3)
- WHY: 이 도메인엔 소스 경쟁 시나리오가 약함(Redevelopment와 다름)
- RISK: 향후 다중 source 충돌이 잦아지면 재검토 필요
- MIGRATION IMPACT: 없음(테이블 자체를 안 만듦)

### 6. Legal-gated Source 활성화(학교알리미 API/유치원알리미 API/13-다)
- OPTION: 즉시 활성화 / `EducationSource.legalReviewStatus` 게이트로 차단
- RECOMMENDATION: **게이트로 차단**, 명시적으로 `CLEARED`될 때까지 ingestion 비활성
- WHY: V2-B LEGAL_REVIEW_REQUIRED 미해소
- RISK: 없음(보수적 기본값)
- MIGRATION IMPACT: 없음(pipeline 로직, 스키마 아님)

### 7. Attendance Zone 저장 전략
- OPTION: A(polygon DB)/B(외부 파일 유지)/C(metadata만)/D(hybrid)
- RECOMMENDATION: **B**(이번 phase), C는 V2-C6 후속 후보
- WHY: PostGIS 등 신규 인프라 금지 지시
- RISK: 낮음 — 언제든 C/A로 승격 가능한 구조
- MIGRATION IMPACT: 없음(테이블 생성 안 함)

### 8. Graduate Outcomes 확장 방식(13-다)
- OPTION: A(JSON on SchoolStat)/B(별도 테이블+rawPayload)/C(스키마 확정 후 신규)
- RECOMMENDATION: **B**
- WHY: §7 비교
- RISK: 나중에 세부 컬럼 추가 시 별도 migration 필요(낮은 리스크, 예정된 절차)
- MIGRATION IMPACT: 신규 테이블 1개, 이후 컬럼 추가 migration은 별도 승인 필요(이번 승인 범위 아님)

---

## 28. [2026-08-21] SCHOOL V2-C1 구현 반영

위 §27 결정사항 8건 전부 승인됨(사용자 확인). 실제 구현/최종
NOW-LATER 재분류/migration 상세는
[SCHOOL-V2-C1-core-education-schema.md](./SCHOOL-V2-C1-core-education-schema.md)
참고 — 요약만 기록:

- proposed 10개 테이블 중 **NOW 7개**(EducationSource, School,
  SchoolStat, Kindergarten, KindergartenStat, Childcare,
  ChildcareStat) 실제 생성, **LATER 3개**(EducationIdentityMapping,
  ApartmentEducationLink, GraduateOutcomeSnapshot)는 스키마 생성
  보류(설계는 이 문서 §24에 그대로 유지)
- migration: `20260821021307_education_v2c1_core_schema`(additive
  only, 기존 테이블 변경 0건)
- §21(Stat→EducationSource formal relation), §26(공유
  `EducationDataQuality` enum 채택) 결정이 실제 구현에 그대로
  반영됨 — §24 proposed schema 초안과 실제 구현 간 세부 nullable
  판단 차이는 C1 문서 §3에 기록

## 29. [2026-08-21] SCHOOL V2-C3A 정정 — 어린이집 API 실제 필드 재확인

C3A(어린이집 ingestion 착수)에서 공식 서비스 명세서(.doc)를 직접
열람한 결과, 이 문서 §3-2/§7 및 V2-B 문서에서 "검색엔진 요약 기반,
참고 수준"으로 표기했던 풍부한 필드 목록(위도/경도/현원/보육교직원수/
CCTV설치수/통학차량운영여부 등)이 **라이브 조회 API(`cpmsapi021`)의
실제 응답에는 없음이 확인됐다.** 그 필드들은 `전국어린이집표준데이터`
(공공데이터포털 `15013108`)라는 별도 데이터셋의 컬럼 설명이며, 이
표준데이터의 실제 배포 경로("API 유형: LINK")는 아직 확인되지
않았다 — §12(Coordinate Model)/§8(Kindergarten/Childcare
Statistics) 설계에서 "어린이집 좌표/현원/CCTV가 API로 바로 들어올
것"이라고 전제하지 않아야 한다. 상세는
[SCHOOL-V2-C3A-childcare-ingestion.md](./SCHOOL-V2-C3A-childcare-ingestion.md)
§4 참고.
