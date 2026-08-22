# SCHOOL V2-C5-B — Education Coordinate Provenance Cleanup

- **STEP**: SCHOOL V2-C5-B
- **Branch**: `school-v2-c5b-coordinate-provenance` (worktree `D:/anti2/aaa/e-jip-school-c5b`, base `d457100` = `school-v2-c5a-distance-label`)
- **선행 문서**: [SCHOOL-V2-C5-distance-accessibility-audit.md](./SCHOOL-V2-C5-distance-accessibility-audit.md), [SCHOOL-V2-C5A-distance-label-correction.md](./SCHOOL-V2-C5A-distance-label-correction.md) — 둘 다 보존, 덮어쓰지 않음.

---

## 0. 목적

C5/C5-A에서 미해결로 남긴 두 가지를 처리한다: (1) 학교 좌표의 공식 source 후보(SchoolInfo apiType=0)를 실측 검증하고 School/Kindergarten/Childcare의 `coordinateType`을 정리, (2) 부산 서구 하드코딩 폴백을 안전하게 제거. Score/route provider/SchoolStat 대량 ingestion은 이번 STEP 범위 밖.

---

## 1. Education Coordinate Pipeline 현황 (읽기 전용 DB 조사)

| Entity | DB 총 행수 | 좌표 보유 | coordinateType | coordinateSource | Ingestion 시 좌표 저장? | Runtime Kakao 검색 사용? | 거리 계산 시 실제 사용 좌표 |
|---|---|---|---|---|---|---|---|
| **School** | 664 | **0건(0%)** | 전부 `UNKNOWN` | 전부 `null` | 아니오(NEIS `schoolInfo`엔 좌표 필드 자체가 없음, C2A 확인) | 예 — `/api/school/apartments`가 매 요청마다 Kakao 키워드 검색(§11에서 canonical 우선 시도로 개선, 그래도 폴백은 Kakao) | Kakao 실시간 검색 결과 좌표(파이프라인 B) 또는 Kakao `SC4` 카테고리 검색 결과(파이프라인 A, Score) — **DB 좌표 아님** |
| **Kindergarten** | 367 | **367건(100%)** | **이번 STEP에서 `UNKNOWN`→`OFFICIAL_POINT` 367건 전환 완료** | `moe_kindergarten_api`(유치원알리미 basicInfo2) | 예(C3B) | 아니오(DB 좌표 그대로 사용) | DB 좌표(`Kindergarten.latitude/longitude`) |
| **Childcare** | **0** | N/A | N/A | N/A | 아직 미실행(C3A 진행 중, `CHILDCARE_API_KEY` 승인 대기) | N/A | N/A |

---

## 2. SchoolInfo apiType=0 좌표 실측

**표본**: 부산 초등 3·중등 3·고등 3·특수 1 = 10개(스크립트 `scripts/education/c5b-03-kakao-comparison.ts`, 서구/해운대구/강서구/동래구/사하구/수영구/기장군 분산).

- **필드 실존**: `LTTUD`(위도)/`LGTUD`(경도) 실제 존재 확인(공식 개발자가이드 `OpenAPI_Output.xlsx`의 "학교기본정보(0)" 시트에 명시된 필드명 그대로).
- **null 비율**: 부산 662건 중 2건만 null(0.3%) — §3 coverage 참고.
- **값 형식**: 십진수 소수(WGS84로 추정, 명시적 좌표계 표기는 API 응답에 없음), 소수점 10자리까지 반환.
- **부산 범위**: 662건 중 out-of-Busan 0건.
- **school name/address 일치**: 표본 10건 모두 `SCHUL_NM`/`ADRES_BRKDN`이 실제 학교와 일치(육안 확인).
- **SCHUL_CODE 동반 여부**: 예 — apiType=0 응답에 `SCHUL_CODE`(학교알리미 자체 식별자)가 함께 온다.
- **연도별 값 차이**: 확인 안 함(이번 STEP은 좌표 검증이 목적이라 2024/2025/2026 3개 연도의 좌표값 자체를 비교하진 않았음 — 필요하면 후속 확인).
- **좌표 semantics(정문/대표점) 공식 근거**: **없음.** `OpenAPI_Output.xlsx`도, 이번에 접근 가능했던 웹페이지도 LTTUD/LGTUD가 무엇을 가리키는 점인지(정문/건물중심/주소대표점) 명시하지 않는다.

### coordinateType 판정

**후보군은 `OFFICIAL_POINT` 또는 `UNKNOWN`뿐**(지시사항)이고, 이번 STEP에서는 **School에는 아직 적용하지 않는다**(§7 참고 — 좌표 자체를 쓰지 않기로 했으므로 타입 판정도 유보). Kindergarten(§8)에는 이미 저장된 데이터에 대해 `OFFICIAL_POINT`를 적용했다 — "정문"이라고 단정하지 않고, "정부 공식 API가 제공하는 그 학교/기관의 대표 좌표"라는 의미로만 쓴다(ENTRANCE/CENTER처럼 물리적 지점 종류를 확정하는 라벨이 아님).

---

## 3. SchoolInfo 좌표 Coverage (부산 전체, read-only)

스크립트: `scripts/education/c5b-02-schoolinfo-coordinate-coverage.ts` — 부산 16개 구·군 × 초/중/고/특수(schulKndCode 02/03/04/05), apiType=0, pbanYr=2025.

| 항목 | 값 |
|---|---|
| **schoolinfo source 기준 total rows** | 662 |
| coordinate non-null | 660 (99.7%) |
| coordinate null | 2 |
| invalid(범위 밖/0,0) | 0 |
| out-of-Busan | 0 |
| **duplicate-coordinate groups**(같은 lat/lng을 공유하는 서로 다른 학교, 2건 이상) | 8개 그룹 — 자동으로 오류라고 단정하지 않음(같은 캠퍼스 병설 초/중 등 정당한 사유 가능, 개별 조사는 이번 STEP 범위 밖) |

**학교급별 coverage(schoolinfo source 기준)**:

| 학교급 | total | withCoords |
|---|---|---|
| 초등학교(02) | 319 | 319 (100%) |
| 중학교(03) | 183 | 181 (98.9%) |
| 고등학교(04) | 144 | 144 (100%) |
| 특수(05) | 16 | 16 (100%) |

**canonical School(NEIS 적재본, 664행) 분모 기준**: `School.latitude` non-null은 **0건(0%)**(§1) — 즉 schoolinfo source 자체의 coverage(99.7%)와, 그걸 canonical `School` 테이블에 실제로 반영한 coverage(0%)는 완전히 다른 숫자다. 이번 STEP은 반영(write)까지 하지 않기로 했으므로(§7) 이 갭이 그대로 남는다.

---

## 4. SchoolInfo ↔ NEIS(canonical School) Identity Crosswalk

C2B 확정 사실 그대로 존중: **`SCHUL_CODE` ≠ `SD_SCHUL_CODE`**, 코드 직접 조인 불가, `학교명 + 시군구` 조합이 안전 후보.

실측(부산 전체, 초/중/고/특수 662건 대상 — C2B는 초등만 봤던 것을 이번에 전 급으로 확장):

| 항목 | 값 |
|---|---|
| 이름 중복 그룹(전체, 부산 내) | 5개 |
| 이름은 겹치나 **구·군이 달라** (이름,구군) 키로 안전한 건수 | 4건(2개 그룹) |
| **같은 구·군 안에서도 중복돼 unsafe**(자동 매핑 금지) 건수 | **7건(3개 그룹)** |

**Unsafe 3개 그룹(전부 강서구)**:
- 송정초등학교 — 해운대구 송정동(1) + 강서구 송정동(1) + **강서구 신호동(1)** → 강서구 내부에서만도 2건 중복.
- 대저중앙초등학교 — 강서구 대저2동(1) + 강서구 강동동(1).
- 가락중학교 — 강서구 죽림동(1) + 강서구 강동동(1).

`BNHH_YN`(분교여부)으로 이 중복을 구분할 수 있는지 확인했으나 **셋 다 `BNHH_YN=N`**(분교 아님으로 표시)이라 이 필드로는 disambiguate 되지 않는다. 주소(`ADRES_BRKDN`)는 서로 다르므로(신호동 vs 송정동, 대저2동 vs 강동동 등) **동 단위 주소를 3차 disambiguator로 쓰면 구분 가능**해 보이지만, 이번 STEP은 좌표를 실제로 매핑하지 않기로 했으므로(§7) 이 로직을 구현하지는 않았다 — 후속(C5-B1 또는 identity 정리 STEP)에서 "이름+구군+동" 3단 키를 정식 채택할지 검토 권고.

**결론**: 이 7건(전체 662건의 1.1%)은 이번 STEP은 물론 향후 어떤 좌표 자동 매핑에서도 이름+구군만으로는 자동 저장하면 안 된다 — 코드(`lookupCanonicalSchoolCoordinate`, §11)가 정확히 이 원칙대로 동작하도록 만들었다(1건이 아니면 null 반환).

---

## 5. SchoolInfo 좌표 vs Kakao POI 좌표 비교

스크립트: `scripts/education/c5b-03-kakao-comparison.ts`. 10개 표본(서구2/해운대2/강서2/기타4 — §19 규정과 동일한 분산) 중 SchoolInfo 좌표 중심 1km 이내 Kakao `SC4` 카테고리 검색으로 비교.

| 분류 | 건수 | 비고 |
|---|---|---|
| A. CLOSE_MATCH | **9** | 전부 델타 **0.0m** — 소수점 10자리까지 완전히 동일 |
| B. MODERATE_DIFFERENCE | 0 | — |
| C. LARGE_DIFFERENCE | 0 | — |
| D. MISSING_ONE_SIDE | 1 | 부산성우학교(특수, 기장군) — SchoolInfo엔 좌표 있으나 Kakao SC4 카테고리 검색이 반경 1km 내에서 **아무 결과도 못 찾음**(원거리/특수학교라 Kakao 지도 데이터 자체가 성긴 것으로 추정, 확정 아님) |

**해석(중요)**: 9건 전부 **완전히 동일한 좌표값**이라는 것은 SchoolInfo의 LTTUD/LGTUD가 Kakao 지도 POI 데이터와 **사실상 같은 원천이거나 같은 값을 공유**한다는 강한 정황이다(공식 문서에 이 관계가 명시돼 있진 않다 — 추론). 즉 **"SchoolInfo 좌표가 Kakao보다 더 정밀하다"는 근거는 없다** — 정확도 측면에서 동등하다고 보는 게 정직하다. 반면 **실용적 이점은 분명하다**: (1) SchoolInfo는 이미 시군구로 스코핑된 상태로 받아오므로 이름만으로 전국 검색하는 Kakao 키워드 검색보다 지역 오매칭 위험이 구조적으로 낮고, (2) DB에 저장·재사용 가능해 매 요청 Kakao 호출이 불필요해지며, (3) 부산성우학교 사례처럼 Kakao 커버리지가 성긴 케이스도 SchoolInfo가 더 완전하다(99.7% vs 이 표본에서 Kakao 1건 누락).

**금지 원칙 준수 확인**: "Kakao가 무조건 더 정확하다"고 가정하지 않았고(실측상 동일), "SchoolInfo가 무조건 정문"이라고도 가정하지 않았다(§2에서 이미 UNKNOWN 성격으로 판정).

---

## 6. Canonical School Coordinate 정책 (문서화, 이번 STEP은 미시행)

우선순위:

1. **SchoolInfo 좌표**가 확보돼 있고, `School.coordinateType`으로 저장 가능한 상태이며, identity가 (이름+구군, 그리고 §4의 unsafe 7건을 제외한) HIGH일 때 사용 — **단, EducationSource에 CLEARED로 등록되기 전까지는 이 좌표를 School 테이블에 쓰지 않는다**(§7).
2. 공식 좌표 없음 + 주소 있음 → 주소 지오코딩(`ADDRESS_GEOCODE`).
3. Kakao POI 검색은 **fallback candidate로만** — 현재 `/api/school/apartments`가 실제로 이렇게 쓰고 있다(§11).

**금지**: 학교명만으로 POI 자동 확정 / 다른 학교 좌표로 대체 / 서구(또는 다른 지역) 대표좌표 폴백 / 수동 하드코딩. 전부 코드(§11) 및 가드(§14)에 반영.

---

## 7. School.latitude/longitude DB Write 여부 — **WRITE 하지 않음**

조건 4개를 실제로 대조한 결과:

| 조건 | 상태 |
|---|---|
| legal/use source cleared | **NO** — `EducationSource` 테이블을 직접 조회한 결과(read-only), 학교알리미(SchoolInfo) 관련 source는 **단 1건도 등록돼 있지 않다.** 등록된 4건은 `childcare_national_api`(CLEARED), `childcare_national_sheet`(REVIEW_REQUIRED), `neis_school_info`(CLEARED), `moe_kindergarten_basicinfo_api`(CLEARED)뿐 — SchoolInfo는 이 중 어디에도 없다. 이 프로젝트 자체가 설계한 게이트("EducationSource.legalReviewStatus가 CLEARED 되기 전까지 ingestion 자체가 실행되지 않는 구조", CHANGELOG 2026-08-21(18))를 그대로 따르면 이는 명백히 write 불가 상태다. |
| identity HIGH | 부분 충족(655/662는 안전, 7건은 unsafe — §4) |
| coordinate valid | 충족(§3 — invalid 0건) |
| official coordinate semantics understood | **NO** — §2에서 확인한 대로 정문/대표점 여부가 공식적으로 확인되지 않음 |

**4개 조건 중 2개가 명확히 미충족**이므로 지시사항("legal/source definition이 불명확하면 WRITE 하지 말고 C5-B1 후속으로 분리")에 따라 이번 STEP에서는 **School.latitude/longitude를 쓰지 않는다.** `lookupCanonicalSchoolCoordinate()` 함수(§11)는 이미 만들어 두었으니, 향후 SchoolInfo가 `EducationSource`에 CLEARED로 등록되고 실제 ingestion(C5-B1)이 이뤄지면 **이 라우트는 코드 변경 없이 자동으로 canonical 좌표를 쓰기 시작한다.**

---

## 8. Kindergarten Coordinate Provenance 정리 — **완료**

- **Source**: `Kindergarten.coordinateSource = 'moe_kindergarten_api'`(367건 전부) — `EducationSource` 테이블에서 `moe_kindergarten_basicinfo_api`(유치원알리미 basicInfo2, `licenseCode=ATTRIBUTION_ONLY_FREE_USE`, `commercialUseAllowed=true`, `modificationAllowed=true`, **`legalReviewStatus=CLEARED`**)와 대응됨을 확인했다. 문자열이 정확히 일치하진 않는데(`moe_kindergarten_api` vs `moe_kindergarten_basicinfo_api`) 이는 C3B 구현 당시의 표기 차이로 보이며, 이번 STEP에서 `coordinateSource` 자체는 건드리지 않았다(범위 밖, 최소 변경 원칙) — 후속 정리 후보로만 기록.
- 정문이라고 단정하지 않고 **`OFFICIAL_POINT`**로 정리 — 이미 프로덕션에 있고 이미 CLEARED된 source의 데이터에 라벨만 정확히 붙이는 작업이라 School(§7)과 달리 write 조건이 충족된다고 판단했다.
- **Dry-run 실행 → 367/367건 가드 통과 → `--apply`로 실제 반영**(스크립트 `scripts/education/c5b-04-kindergarten-coordinatetype-update.ts`). `coordinateType: UNKNOWN` → `OFFICIAL_POINT` 367건, `latitude`/`longitude`/`coordinateSource` 등 다른 컬럼은 전혀 건드리지 않음.

---

## 9. Childcare Coordinate Provenance

`Childcare` 테이블이 **현재 0행**(C3A 미착수, `CHILDCARE_API_KEY` 승인 대기 — main dirty 상태와 일치). 확인할 좌표 자체가 없다. `EducationSource`에는 `childcare_national_api`(cpmsapi021, CLEARED)가 이미 등록돼 있으나, 지시사항에 명시된 대로 "cpmsapi021은 좌표 필드가 구조적으로 없는 것으로 알려져 있음" — 향후 C3A가 실행되더라도 이 API 자체에서 좌표를 받을 수 없다면 `latitude/longitude`는 정직하게 `null`로 남겨야 한다. 다른 source로 무리하게 채우지 않는다(지시사항 그대로 재확인만 하고 이번 STEP에서 아무 조치도 하지 않음).

---

## 10. 부산 서구 하드코딩 폴백 제거 — **완료**

`src/app/api/school/apartments/route.ts`의 `[129.0225, 35.0772]` 기본값 + 대신동/송도동/충무동 문자열 매칭 보정 블록을 **전체 삭제**했다. 소비자 확인: 이 라우트의 유일한 소비자는 `school-detail-client.tsx`(C5-A에서 이미 확인) — 다른 곳 없음.

좌표를 끝내 못 찾으면(§11 새 흐름) `schoolCoords`가 `null`로 남고, 그 결과 `searchedApartments`가 빈 배열이 돼 최종적으로 기존에 이미 있던 **"인근 아파트 매물 없음"** 안전 경로로 자연스럽게 합류한다(새로운 UI 문구를 추가할 필요조차 없었다) — 다른 부산 좌표로 대체하는 코드는 어디에도 남지 않았다(§20 가드 스크립트로 재확인).

---

## 11. `/api/school/apartments` 라우트 정리 — **완료**

새 해석 순서:

1. `lat`/`lng` 쿼리파라미터 있으면 그대로 사용(기존 동일).
2. **[신규]** `lookupCanonicalSchoolCoordinate(schoolName, lawdCd)` — `School` 테이블에서 `(schoolName, sigunguCode=lawdCd)`가 **정확히 1건**이고 좌표가 있을 때만 사용. 0건/2건 이상이면 사용 안 함(§4의 unsafe 7건은 이 함수를 통과 못 함). 현재는 `School.latitude`가 전부 null이라(§7) 실질적으로 항상 통과하지 못하지만, 코드는 이미 완성돼 있어 C5-B1에서 좌표가 채워지는 즉시 별도 배포 없이 우선 적용되기 시작한다.
3. Kakao 실시간 키워드 검색(기존 유지) — "폴백"이 아니라 그 학교 자체를 찾으려는 시도.
4. 그래도 못 찾으면 **`null`** — 더 이상 어떤 좌표로도 대체하지 않는다.

**request마다 Kakao POI 쿼리가 필요한지 재검토** 결과: 현재는 여전히 필요하다(School 좌표가 비어있는 한 3번이 사실상 유일한 실동 경로) — School 좌표가 채워지면(C5-B1 이후) 이 Kakao 호출 빈도가 자연히 줄어드는 구조로 이미 짜여 있다.

**미해결로 확인된 위험(이번 STEP에서 고치지 않음, §12/§19에서 재확인)**: `lawdCd`가 주어져도 3번(Kakao 키워드 검색)이 그 지역으로 스코핑되지 않는다 — 학교기본정보 조회에 쓰는 `regcodes`(건축물대장용으로 이미 병렬로 fetch 중)를 재사용해 검색어에 구·군명을 붙이는 방식으로 고칠 수 있어 보이지만, `regcodes`가 `resolveSchoolAndApartments`와 별도 병렬 브랜치라 순서를 재구성해야 해서 이번 STEP 범위(라벨/폴백 제거)를 넘어선다고 판단해 미루고 명시적으로 기록만 남긴다(§19에서 실측 확인된 실제 위험 사례 포함).

---

## 12. School Detail Route Identity 평가

`/school`(목록) → `/school/[id]` → 인근 아파트 흐름을 다시 확인:

- `/school` 목록 페이지(`school-client.tsx`)는 `item.lat`/`item.lng`을 절대 채우지 못한다(`/api/school` 응답에 애초에 lat/lng 필드가 없음, C5 audit에서 이미 확인) — 즉 이 경로로 `/school/[id]`에 진입하면 **항상 lat/lng 파라미터 없이** 들어간다.
- `KakaoPlaces.tsx`(학군 탭 등)에서 진입하는 경로는 Kakao 자체 POI의 `p.y`/`p.x`를 lat/lng으로 실어 보낸다 — 이 경로는 이미 안전.
- 즉 **identity가 정확히 canonical `School` row로 이어지는 보장은 없다** — `/school/[id]`는 `schoolName`(URL의 `name` 쿼리파라미터, 순수 문자열) 하나로 동작하고, 그 뒤 `/api/school/apartments`가 다시 `schoolName`만으로 Kakao를 검색한다. 두 곳 모두 canonical `School.id`나 `neisSchoolCode`를 아예 쓰지 않는다.

**이번 C5-B 범위를 벗어나는 identity refactor 제안(구현하지 않음)**: `/school/[id]`의 라우트 파라미터를 canonical `School.id`로 바꾸고, `/api/school/apartments`도 `schoolId`를 받아 `School` row를 직접 조회하도록 바꾸면 이름 기반 검색 자체가 필요 없어진다 — 다만 이는 `/school` 목록 페이지, `KakaoPlaces.tsx`의 학교 링크 생성 로직, 그리고 School의 `id`가 안정적인 PK인지(§ApartmentMaster와 동일하게 batch 재생성 가능성 있음, School 스키마 주석엔 이런 경고가 없어 재확인 필요) 등을 모두 다시 봐야 하는 별도 STEP 규모다.

---

## 13. coordinateType Population Dry-Run 결과

| Entity | 정리 전 | 정리 후(실제 반영) |
|---|---|---|
| School | UNKNOWN 664 / null 0 | **변경 없음**(§7 — write 보류) |
| Kindergarten | UNKNOWN 367 | **OFFICIAL_POINT 367**(실제 반영 완료) |
| Childcare | 0행 | 0행(변경 대상 없음) |

School을 억지로 채우지 않았다 — enum semantics(OFFICIAL_POINT가 실제로 뭘 보장하는지)와 legal 상태가 불확실한 채로 라벨만 붙이는 것은 오히려 나중에 잘못된 신뢰를 줄 수 있다고 판단했다.

---

## 14. Coordinate Correctness Guard — 구현 완료

`scripts/education/lib/coordinate-guard.ts`(신규, 향후 ingestion 스크립트가 import해서 재사용):

- `validateCoordinate()`: lat -90~90, lng -180~180, (0,0) 금지, source(provenance) 필수 문자열, `manual`/`hardcode`/`fix_`/`temp`/`임시`/`수동` 패턴의 source 명시적 차단(§15 재발 방지), sidoCode가 부산(26)으로 알려진 경우에만 부산 bounds 검사(다른 지역 확장 시 오탐 방지).
- `findExcessiveDuplicateCoordinates()`: 같은 좌표를 공유하는 그룹을 "경고"로만 반환(§5에서 실측한 대로 정당한 동일좌표 케이스가 있어 자동 reject하지 않음, 사람이 검토하도록 함).
- 회귀 가드 스크립트(`c5b-05-verify-provenance-guards.ts`)에서 9개 케이스로 in-process 검증 — 전부 PASS.

---

## 15. `fix_coords.ts`/`fix_songdo_coords.ts` 정리 — **삭제 완료**

C5-A에서 **NO_PRODUCTION_IMPACT** 확정(Transaction 테이블 0행, `src/` 어디서도 미참조) — 이번 STEP에서 재확인 결과 여전히 동일(테이블/참조 상태 변동 없음). `package.json`/다른 스크립트/문서(감사 기록 제외) 어디에서도 참조되지 않음을 grep으로 재확인 후 `git rm`으로 삭제. git history에 그대로 보존됨.

---

## 16. 거리 계산 Semantics 유지 확인

이번 STEP은 좌표 **source**만 정리했고 계산 방식은 손대지 않았다 — 여전히 `STRAIGHT_LINE_DISTANCE`(Turf 직선거리), 표시는 `"직선거리 약 Nm"` 그대로. `walkMin`류 계산이나 "도보 N분" 문자열이 코드에 재도입되지 않았음을 §20 가드 스크립트로 재확인했다.

---

## 17. Score와의 분리 확인

`ApartmentLocationFeature`, `nearestElementaryDistanceM`, `school-distance-band.ts`, `school-access-sentence.ts`, `explain.ts` — 전부 미접촉(diff에 포함되지 않음). 이번 STEP의 School coordinate 정리(§7, 실제로는 write 자체를 안 함)도, Kindergarten coordinateType 정리(§8)도 Score 계산에 자동으로 반영되지 않는다 — Score는 여전히 `ApartmentLocationFeature`의 raw feature만 쓰고, 그 raw feature는 Kakao 실시간 카테고리 검색으로 별도로 채워진다(C5 audit §1 파이프라인 A, 이번 STEP도 그대로).

**SCORE V1.x future recommendation(기록만, 구현 안 함)**: School 좌표가 향후 canonical화되면(C5-B1 이후) Score의 `nearestElementaryDistanceM` 산출 방식도 Kakao 실시간 검색 대신 canonical 좌표 기반으로 바꿀지 검토할 가치가 있다 — 다만 이는 Score 팀/후속 STEP의 별도 결정 사항이다.

---

## 18. C5-C(Route Provider) 준비 자료

- **canonical apartment coordinate type**: `ApartmentMaster.geocodeQuality`(`exact`/`normalized`/`failed`), 출처는 Kakao 주소 지오코딩 단일 원천(C5 audit §3 그대로, 변경 없음) — 이는 여전히 "주소 대표점"이며 출입구가 아니다.
- **canonical school coordinate type**: 아직 미확정(§7 — School 좌표 write 보류). SchoolInfo가 유력 후보이나 Kakao와 사실상 동일값(§5)이라는 점을 C5-C 설계에 반영해야 한다 — "SchoolInfo를 쓰면 더 정확한 출발점을 얻는다"는 전제는 성립하지 않는다, 얻는 것은 안정성/재사용성이다.
- **straight-line baseline**: 두 좌표 다 결국 같은 성격(대표점, 정밀 출입구 아님)이라 직선거리 자체의 근본적 부정확성(§C5 audit §6)은 route provider 도입 여부와 무관하게 남는다.
- **candidate provider**: C5 audit §8 그대로(Kakao Mobility 도보 길찾기 = 제휴 계약 필요 확정, Naver/TMAP = 가격 미확인) — 이번 STEP에서 갱신 사항 없음.

---

## 19. Regression (10 표본: 서구2/해운대2/강서2/기타4)

로컬 dev 서버(read-only) 기준, 실제 API 호출:

| 지역 | 학교 | 결과 |
|---|---|---|
| 서구 | 구덕초등학교 | 정상, `직선거리 약 72m`(유진대림아파트) 등 |
| 서구 | 대신초등학교 | 정상, `직선거리 약 193m`(대신롯데캐슬아파트) 등 |
| 해운대구 | 해운대초등학교 | 정상, `직선거리 약 101m` 등 |
| 해운대구 | 해송초등학교 | 정상, `직선거리 약 195m` 등 |
| 강서구 | 가락초등학교 | 정상 — 학교 좌표는 정확히 해결됐으나(§5에서 delta 0m 확인) 반경 1.5km 내 아파트가 없어 "인근 아파트 매물 없음"(정상적인 빈 상태, 좌표 실패 아님) |
| 강서구 | 낙동중학교 | 정상, `직선거리 약 1438m`(우창더뷰아파트, 1건) |
| 동래구(기타) | 교동초등학교 | 정상, `직선거리 약 141m` 등 |
| 사하구(기타) | 감천중학교 | 정상, `직선거리 약 366m` 등 |
| 수영구(기타) | 민안초등학교 | 정상, `직선거리 약 205m` 등 |
| 기장군(기타) | 대청초등학교 | 정상, `직선거리 약 176m` 등 |

**no Seo-gu fallback 확인**: 존재하지 않는 가짜 학교명으로 호출 → 예전 같으면 서구 좌표로 계산된 결과가 나왔을 것이나, 이번엔 `"인근 아파트 매물 없음"`으로 정직하게 처리됨(§10에서 실측 로그 확인).

**동명이교 안전성 — 부분적으로만 안전, 실측으로 위험 확인**: 송정초등학교를 `lat/lng` 없이 조회하면 현재는 우연히 해운대구 결과가 나오지만(Kakao 키워드 검색의 기본 정렬 순서에 의존), `lawdCd`를 줘도 학교 좌표 검색 자체가 그 값으로 스코핑되지 않아(§11에서 이미 명시) **이 정확성이 보장된 게 아니라 우연**이다 — 정직하게 위험으로 남긴다(§12 identity refactor로 연결).

**missing coordinate graceful**: 확인됨(위 "가짜 학교명" 케이스).
**straight-line 값 합리적 범위**: 10건 모두 72m~1438m 사이, 이상치 없음.
**no fake walking time**: 10건 전부 `distanceLabel`이 `"직선거리 약 Nm"` 형식, "도보"라는 단어 없음.

브라우저 확인: `/school/1?...`(lat/lng 없이 진입)도 정상 렌더, 캐비엇 문구·직선거리 라벨 그대로.

---

## 20. Tests

`scripts/education/c5b-05-verify-provenance-guards.ts`(신규, DB/네트워크 접근 없는 순수 정적+in-process 검증):

- Seo-gu 하드코딩 좌표 **대입 코드**(주석 아님) 재등장 여부 — PASS(없음).
- 동 단위 보정 대입 코드 재등장 여부 — PASS(없음).
- `lookupCanonicalSchoolCoordinate` 존재 여부 — PASS.
- 직선거리 label 유지 — PASS.
- `walkMin`류 도보시간 계산 재도입 여부 — PASS(없음).
- `fix_coords.ts`/`fix_songdo_coords.ts` repo root 제거 확인 — PASS.
- `validateCoordinate()` 9개 케이스(정상/0·0/범위초과/부산bounds밖/source없음/manual·fix_ 패턴 차단/null/타지역 skip) — 전부 PASS.
- `findExcessiveDuplicateCoordinates()` 동작 확인 — PASS.

`tsc --noEmit`: 0 errors. `eslint`(수정/신규 파일 전체): 0 errors. `next build`: 성공.

---

## 21. 남은 한계 (C5-B1/C5-C/식별자 정리로 이월)

- School.latitude/longitude 실제 write — SchoolInfo가 `EducationSource`에 CLEARED로 등록되기 전까지 보류(§7).
- `/api/school/apartments`의 Kakao 키워드 검색이 `lawdCd`로 스코핑되지 않는 문제 — 동명이교 사례에서 실측으로 위험 확인(§11, §19).
- `/school/[id]`가 canonical `School.id`가 아니라 문자열 이름으로 동작하는 구조적 identity 격차(§12).
- Kindergarten `coordinateSource` 문자열이 `EducationSource.code`와 정확히 일치하지 않는 사소한 불일치(§8) — 기능에 영향 없음, 정리 후보로만 기록.
- School coordinateType의 8개 duplicate-coordinate 그룹(§3) 개별 원인 미조사.
