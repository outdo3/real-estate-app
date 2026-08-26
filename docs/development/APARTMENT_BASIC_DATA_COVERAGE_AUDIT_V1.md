# APARTMENT BASIC DATA COVERAGE AUDIT V1

작성일: 2026-08-26
성격: **읽기 전용 감사** + 코드-검증 근거 기반 원인 분석. DB 스키마/마이그레이션/production 대량쓰기 없음. 감사 중 발견된 "안전한 application-level 버그"(읽기 경로 mismatch) 1건만 최소 범위로 수정했다(§14).

---

## 1. Problem

프로덕션 단지 상세페이지(연산동한솔솔파크, 부산 연제구 연산동 406-10)가 주소/준공년도(2007년)/세대수(165세대)는 정상 표시하지만 **용적률/건폐율/주차대수는 전부 "정보 없음"**으로 표시된다. 외부 경쟁 서비스는 같은 단지에 대해 용적률 535%, 건폐율 59%를 표시한다.

**하드 룰(이번 STEP 전체를 관통)**: 외부 서비스가 보여주는 535%/59%라는 숫자를 그대로 e-jip DB에 베끼거나 source of truth로 쓰지 않는다. 이 감사의 목적은 "e-jip 자체 파이프라인/공공데이터에 원본 데이터가 이미 있는데 왜 안 보이는가"를 밝히는 것이다.

**결론 선요약**: 실제로 대한민국 정부 공식 공공데이터(data.go.kr `BldRgstHubService`)를 이 프로젝트가 이미 쓰고 있는 API 키로 직접 재조회한 결과, 535.3%/59.82%라는 값이 **독자적으로, 경쟁 서비스와 무관하게** 재현됐다(§5). 경쟁 서비스 값을 복사한 것이 아니라, 정부 공식 소스에서 동일한 진짜 값을 다시 뽑아낸 것이다. 문제는 이 프로젝트의 코드가 이 값이 있는 API operation을 애초에 호출하지 않고 있었다는 것(§10).

---

## 2. Current Data Architecture

이 프로젝트에는 "아파트 기본정보"를 다루는 서로 독립된 두 개의 병렬 테이블이 있다.

| 테이블 | 성격 | 현재 행 수(2026-08-26 실측) | 실제 서빙 여부 |
|---|---|---|---|
| `Apartment`(`apartments`) | 레거시 캐시 — 상세페이지가 실제로 조회된 단지만 lazy upsert되는 cache-aside 테이블 | **36건** | **현재 라이브 서빙 경로가 실제로 쓰는 테이블** |
| `ApartmentMaster`(`apartment_masters`) | M1~M4 시리즈로 설계된 신규 마스터. 최근(`7776114 feat: build Busan apartment master dataset` 커밋) 부산 전체로 확장됨 | **3,402건** | **아직 라이브 API에 연결 안 됨**(M4-A 문서 §201 자체가 명시) |

중요: 세션 시작 시점의 기억(memory)에 남아있던 "ApartmentMaster는 33건(서구+해운대 파일럿)"이라는 13일 전(2026-08-13) 문서(`14-apartment-master-m4-expansion-analysis.md`)의 기술은 **이미 낡은 정보**였다 — 실제로 DB를 직접 읽어 검증한 결과 3,402건으로 이미 부산 전체 규모로 확장돼 있었다(§12). 기억/문서를 그대로 믿지 않고 실제 DB를 재확인해서 발견했다.

**라이브 서빙 경로**(사용자가 실제로 보는 값):

```
GET /apt/[name] (상세페이지)
  → apt-client.tsx
    → GET /api/apt/[name]/info?lawdCd&dong&jibun
      → route.ts:
          1) fetchCachedRegistry(): Apartment 테이블에서 name+dong (또는 dong+jibun)으로 조회
             — parkingCount/far/bcr/approvalDate 4개 전부 truthy일 때만 "cache hit"
          2) cache miss면 fetchBuildingRegistryInfo() 라이브 호출(건축물대장 공공데이터)
          3) 라이브 호출 결과 중 truthy 필드만 Apartment 테이블에 upsert
          4) 응답 조립: 세대수/사용승인일은 Naver 스크래핑으로 보강 가능, 총주차대수/용적률/건폐율은
             registry 값이 없으면 그냥 없음(다른 소스로 대체 안 함)
    → AptSpecGrid.tsx: aptInfo['용적률']/['건폐율']/['총주차대수']가 falsy면 "정보 없음" + [제보/수정] 링크
```

`ApartmentMaster`는 이 경로 어디에도 관여하지 않는다 — 완전히 별개의, 아직 미연결된 데이터셋이다.

---

## 3. Field Source Matrix

| 필드 | UI 컴포넌트 | API 응답 필드 | DB/모델 필드 | 상류 소스 |
|---|---|---|---|---|
| 세대수 | `AptSpecGrid.tsx` `aptInfo['세대수']` | `/api/apt/[name]/info` → `info.세대수` | `Apartment.totalHouseholds` | 건축물대장 총괄표제부 `hhldCnt` (실패 시 Naver 스크래핑 폴백) |
| 준공년월 | `AptSpecGrid.tsx` `buildYear` prop(별도 경로, 실거래 `trades[0].buildYear`) + `aptInfo['사용승인일']` | `/api/apt/[name]/info` → `info.사용승인일` | `Apartment.approvalDate` | 건축물대장 `useAprDay`(실패 시 Naver 폴백) |
| 용적률 | `AptSpecGrid.tsx` `aptInfo['용적률']` | `info.용적률` | `Apartment.far` | 건축물대장 총괄표제부 `vlRat`만(폴백 없었음 — 이번 STEP에서 표제부 폴백 추가, §14) |
| 건폐율 | 〃 `aptInfo['건폐율']` | `info.건폐율` | `Apartment.bcr` | 건축물대장 총괄표제부 `bcRat`만(위와 동일) |
| 주차대수 | 〃 `aptInfo['총주차대수']` | `info.총주차대수` | `Apartment.parkingCount` | 건축물대장 총괄표제부 `totPkngCnt`만(위와 동일) |
| 동수 | **UI에 표시 안 됨**(`AptSpecGrid`에 필드 없음) | 없음 | `Apartment`에 필드 자체 없음(`ApartmentMaster.mainBuildingCount`에는 있으나 미연결) | (제공 시) 건축물대장 총괄표제부 `mainBldCnt` |
| 세대당 주차 | `AptSpecGrid.tsx` `총주차대수` 문자열 안에 `formatParking()`으로 합쳐서 표시("세대당 X대 (총 Y대)") | `info.총주차대수`(문자열에 합산 포함) | 별도 컬럼 없음(런타임 계산) | `parkingCount / totalHouseholds` |
| 난방방식 | **UI/API/DB 어디에도 없음** | 없음 | 없음 | 없음 — MISSING_SOURCE(§8) |

---

## 4. Yeonsan Hansol Solpark(연산동한솔솔파크) Identity

`/api/search`(MOLIT 실거래 기반)로 재확인한 canonical identity:

| 필드 | 값 |
|---|---|
| Apartment.id(레거시 캐시) | 없음(§7 — 캐시에 행 자체가 없었음) |
| ApartmentMaster.id | 존재(§7) |
| ApartmentMaster.aptSeq | `26470-1040` |
| 이름 | 연산동한솔솔파크 |
| lawdCd | `26470`(부산 연제구) |
| dong | 연산동 |
| jibun | `406-10` |
| road/jibun 주소 | 부산광역시 연제구 과정로 211(연산동) / 부산광역시 연제구 연산동 406-10번지 |
| lat/lng | 35.18762356680902 / 129.1041432993443 |
| buildYear | 2007 |
| householdCount | 165 |

현재 상세페이지 URL/API가 실제로 쓰는 identity: **name("연산동한솔솔파크") + dong("연산동")** — `aptSeq`는 API 쿼리 파라미터로 쓰이지 않는다(§2 라이브 경로 참고). 이는 이 프로젝트의 기존 계약과 일치한다(`Apartment.@@unique([name, dong])`).

**중요 발견**: 이름만으로 이 단지를 찾으면 위험하다 — "한솔솔파크"라는 이름은 **연제구 연산동**과 **해운대구 우동**(`ApartmentMaster.aptSeq = "26350-2115"`, "해운대한솔솔파크") 양쪽에 존재하는 서로 다른 두 단지다. 이번 감사 스크립트를 작성하던 중 실제로 이름 substring 매칭(`.includes('한솔솔파크')`)으로 엉뚱하게 해운대 단지를 집어온 실수를 자체적으로 발견하고 즉시 aptSeq 정확 매칭으로 수정했다(§15 스크립트에 이 사례를 주석으로 남김) — AGENTS.md의 "이름만으로 재식별 금지" 원칙이 실제로 재현된 사례다.

---

## 5. BuildingHUB Evidence

이 프로젝트는 "BuildingHUB"라는 이름으로 별도 브랜딩된 통합을 갖고 있지 않다 — 실제로는 data.go.kr의 `BldRgstHubService`(건축물대장정보 공동활용 서비스)를 직접 호출하며, 이것이 사실상 "BuildingHUB"에 해당한다.

**실측(라이브 API 재호출, 2026-08-26, 이 세션에서 직접 수행)**:

| Operation | 호출 결과(반복 검증) |
|---|---|
| `getBrRecapTitleInfo`(총괄표제부, 단지 집계) | **3/3회 정상 응답(HTTP 200, resultCode 00), 전부 `totalCount=0`** — 이 단지에는 총괄표제부 레코드가 없다(재현 가능, 일시적 오류 아님). 별도로 2회는 `HTTP 503 SERVICETIMEOUT_ERROR`도 관측됨(외부 서비스 자체의 불안정성, "레코드 없음"과는 별개 현상) |
| `getBrTitleInfo`(표제부, 건물 1건 단위) | **2/3회 정상 응답, 매번 동일한 1건**: `totalCount=1`, `bldNm="연산동 한솔솔파크"`, `hhldCnt=165`, `vlRat=535.3`, `bcRat=59.82`, `mgmBldrgstPk=10401100171804`, `indrAutoUtcnt=201`, `oudrAutoUtcnt=3`, `indrMechUtcnt=0`, `oudrMechUtcnt=0`, `useAprDay="20071226"` |
| `getBrExposPubuseAreaInfo`(전유부) | 1회 시도, `HTTP 503`(추가 검증 안 함, 이번 STEP 범위 밖) |

**교차검증**: `getBrTitleInfo`가 반환한 `mgmBldrgstPk="10401100171804"`는 `ApartmentMaster`(M4-B가 이미 이 단지를 부산 전체 배치에서 처리해 저장해둔 값)의 `mgmBldrgstPk` 필드와 **정확히 일치**한다(§7). `hhldCnt=165`도 `ApartmentMaster.totalHouseholds=165`, `Apartment` 테이블 스키마의 세대수 개념과 정확히 일치한다. 세 개의 독립 경로(라이브 표제부 재조회 / M4-B 배치가 저장해둔 ApartmentMaster / 실거래 API의 householdCount)가 모두 165로 일치 — 우연이 아니라 같은 건물을 가리키는 강한 증거다.

**결론**: 535.3%/59.82%는 경쟁 서비스에서 베낀 값이 아니라, 정부 공식 API를 이 프로젝트의 기존 키로 직접 재조회해 독립적으로 재현한 값이다.

---

## 6. K-apt Evidence

저장소 전체에서 `K-apt`/`공동주택관리정보`/`공동주택관리시스템`을 검색했다. 실제 통합은 존재하지 않는다 — 유일한 매치는 `src/app/api/school/apartments/route.ts` 53행의 주석 하나뿐이며, 이 주석조차 실제로는 (K-apt가 아니라) 건축물대장 조회 패턴을 가리키는 부정확한 명칭 사용이다. **분류: MISSING_SOURCE.** 이번 STEP에서 신규 연동을 구현하지 않는다(요청 규칙 §8/§17과 일치).

---

## 7. DB Evidence(read-only)

읽기 전용 Prisma 쿼리로 직접 확인(스크립트: §15). 절대 UPDATE/INSERT/DELETE 없음.

**(A) Apartment(레거시 캐시)**: 연산동한솔솔파크에 해당하는 행이 **존재하지 않는다.** 원인: `/api/apt/[name]/info`의 upsert는 "건축물대장 라이브 호출 결과에 truthy 필드가 하나라도 있을 때만" 실행되는데, 이 단지는 그동안 총괄표제부 호출이 항상 실패(§5)했으므로 upsert 자체가 한 번도 발생하지 않았다. 즉 이 단지는 **매 페이지뷰마다 캐시 미스 → 라이브 재조회 → 재실패**를 반복해온 상태였다(성능/API 호출량 관점에서도 낭비).

**(B) 건물/기본정보 레코드**: 위 §5.

**(C) Unit Master(`ApartmentUnitType`)**: `Apartment.id`가 있어야 FK를 걸 수 있는데 (A)에서 Apartment 행 자체가 없었으므로 Unit Master 행도 없다. Unit Master는 전용면적/타입 구분용이라 이번 결측(FAR/BCR/주차)과는 애초에 무관한 시스템이다.

**(D) 주차 관련 레코드**: 위 §5(표제부의 `indrAutoUtcnt`/`oudrAutoUtcnt`/`indrMechUtcnt`/`oudrMechUtcnt`).

**(E) Provenance**: `Apartment` 모델 자체에 별도 provenance 컬럼은 없다(값의 출처는 컬럼 주석으로만 문서화돼 있음, §3).

**ApartmentMaster 행 존재**(§4): `aptSeq=26470-1040`, `mgmBldrgstPk="10401100171804"`, `buildYear=2007`, `totalHouseholds=165`, **`mainBuildingCount=null`, `parkingCount=null`**. M4-B 배치가 이 단지의 총괄표제부를 조회했던 시점에는 총괄표제부가 부분적으로라도 성공(mgmBldrgstPk/세대수는 확보, 주차/동수는 실패)했거나, 그 사이 정부 데이터가 바뀌었을 가능성이 있다 — 정확한 시점 재현은 이번 STEP 범위 밖으로 남긴다(중요하지 않음: 어느 경우든 "표제부에 실제 데이터가 있다"는 이번 감사의 핵심 결론에는 영향 없음).

---

## 8. API Evidence

라이브 개발 서버(`npm run dev`)에 대해 실제 HTTP 호출로 재현했다(2026-08-26):

```
GET /api/apt/연산동한솔솔파크/info?jibun=406-10&dong=연산동&lawdCd=26470  (수정 전)
→ {"success":true,"aptName":"연산동한솔솔파크",
   "info":{"세대수":"165세대","사용승인일":"2007년"},   ← 용적률/건폐율/총주차대수 키 자체가 없음
   "unitTypes":null}
```

프로덕션 스크린샷과 정확히 일치하는 패턴을 재현했다(추측이 아니라 실제 호출).

수정 후(§14) 같은 요청:

```
→ {"success":true,"aptName":"연산동한솔솔파크",
   "info":{"주용도":"공동주택","세대수":"165세대","사용승인일":"2007년",
            "총주차대수":"세대당 1.24대 (총 204대)","용적률":"535.3%","건폐율":"59.8%"},
   "unitTypes":null}
```

---

## 9. UI Evidence

`AptSpecGrid.tsx`(§3 표)의 각 셀은 `aptInfo[label]`이 falsy면 무조건 `정보 없음` + `[제보/수정]` 링크를 렌더링한다 — 값이 있는데 UI가 못 그리는 렌더 버그는 없었다(순수하게 API 응답 자체에 값이 없었을 뿐). 컴포넌트 내 기존 주석([B2-1])이 "총괄표제부는 여러 동으로 이뤄진 단지 개념이라 소규모/단독동 건물은 등록 자체가 없는 경우가 다수 확인됐다"고 이미 기록해뒀는데, 이는 이번 감사가 재확인한 사실(총괄표제부 부재)의 앞부분과 일치한다 — 다만 그 주석을 쓴 시점에는 "표제부에는 있을 수 있다"는 후속 확인을 하지 않았던 것으로 보인다(그 표제부 폴백이 이번 STEP 전까지 코드에 없었다는 사실과 일치, §10).

---

## 10. Root Cause by Field

| 필드 | 분류 | 근거 |
|---|---|---|
| 용적률(FAR) | **WRONG_SOURCE_SELECTION** | 상류 소스(정부 건축물대장)에 값이 실제로 존재(표제부, §5)하지만, 코드가 그 값을 가진 operation(`getBrTitleInfo`)을 전혀 호출하지 않고 값이 없는 operation(`getBrRecapTitleInfo`)만 호출했다 |
| 건폐율(BCR) | **WRONG_SOURCE_SELECTION** | 위와 동일 근거 |
| 총주차대수 | **WRONG_SOURCE_SELECTION** | 표제부에 `totPkngCnt`라는 단일 필드는 없지만, 옥내/옥외×자주식/기계식 4개 필드의 합(201+3+0+0=204)으로 동일한 값을 재구성할 수 있다(§14) — 코드가 이 경로도 쓰지 않고 있었다 |

**왜 SOURCE_MISSING이 아닌가**: 정부 소스 자체에 데이터가 없는 게 아니라(§5에서 표제부로 실제 확인됨), "이 프로젝트가 어떤 operation을 조회하는가"라는 코드 레벨의 선택 문제였다. 단, 이 단지가 총괄표제부를 갖지 못한 이유 자체는 이번 STEP에서 밝히지 않는다(정부 등록 관행의 문제로 추정 — 단독/소규모 형태 단지는 애초에 "총괄"이 필요 없어 등록되지 않는 패턴이 §9의 기존 코드 주석과 §5 실측 양쪽에서 일관되게 나타남 — 확정은 아님).

**추가로 확인한, 이 단지에 국한되지 않는 구조적 사실**: `ApartmentMaster` 스키마 자체에 `far`/`bcr` 컬럼이 아예 없다(§2, §12) — 이는 이 단지만의 문제가 아니라 M-시리즈 설계 시점부터의 스키마 차원 gap이며, `SOURCE_MISSING_AT_SCHEMA_LEVEL`로 별도 기록해둔다(§16에서 후속 권고).

---

## 11. Present vs Missing Comparison

`Apartment`(레거시 캐시, 36건) 안에서 비교(스크립트 §15 실행 결과 그대로):

**FAR/BCR/주차 전부 있는 단지 예시**:
- 해운대동백두산위브더제니스아파트(dong=우동, aptSeq=26350-2360, far=1105.37, bcr=62.28, parking=446)
- 대신롯데캐슬(dong=서대신동3가, aptSeq=26140-1164, far=249.53, bcr=18.36, parking=888)

**FAR/BCR/주차 전부 없는 단지 예시**:
- 시범(dong=여의도동, jibun=50, household=1812)
- 삼익아파트(dong=개포동, jibun=12, household=4199)

**차이의 실체**(라이브 재확인, 2026-08-26): "있는" 단지(대신롯데캐슬)는 `getBrRecapTitleInfo`(총괄표제부)가 실제로 정상 응답(HTTP 200, 레코드 존재)한다 — 즉 정부 등록 자체가 "총괄표제부" 형태로 되어 있는 단지다. "없는" 단지들은 이 감사의 스크립트가 자동 분류한 대로 `aptSeq`가 `null`이거나(시범/삼익아파트) identity 자체가 약한 경우가 많다 — 다만 시범/삼익아파트가 총괄표제부와 표제부 양쪽 다 없는지, 아니면 표제부는 있는데도 아직 아무도 안 봐서 캐시가 안 됐을 뿐인지는 이번 STEP에서 개별 재현하지 않았다(연산동한솔솔파크 사례로 패턴 자체는 충분히 실증했다고 판단, §15의 재사용 가능한 스크립트로 필요 시 추가 표본을 언제든 뽑을 수 있다).

정직한 한계: `Apartment` 캐시 테이블은 "이미 조회된 36개 단지"일 뿐이라 표본이 작다 — 부산 전체 관점의 present/missing 비교는 §12/§13에서 별도로 다룬다.

---

## 12. Busan Coverage

**정직하게 밝히는 한계**: 이번 STEP에서 "부산 전체 단지"에 대해 FAR/BCR/주차를 전수 조사하려면 ~2,900~3,400개 단지(M4-A §B/§C 실측) 각각에 대해 건축물대장을 라이브로 호출해야 한다 — M4-A 자체 추정으로도 수 시간이 걸리는 대량 외부 API 호출이며, 이는 §17(BuildingHUB 대량 재수집 금지)에 명시적으로 해당하는 항목이라 이번 감사에서 실행하지 않았다.

대신 **이미 DB에 저장된 두 테이블을 기준으로 실측 가능한 coverage**를 정직하게 구분해 보고한다.

### 12-1. `Apartment`(레거시 캐시, 모집단 = 36건, "부산 전체"가 아니라 "이미 조회된 단지"만)

| 필드 | Present | Total | Coverage |
|---|---|---|---|
| 세대수 | 35 | 36 | 97.2% |
| 준공년도 | 25 | 36 | 69.4% |
| 용적률 | 34 | 36 | 94.4% |
| 건폐율 | 34 | 36 | 94.4% |
| 주차대수 | 34 | 36 | 94.4% |
| jibun(identity) | 36 | 36 | 100.0% |
| aptSeq(identity) | 20 | 36 | 55.6% |

(이 표의 94%대 수치가 높아 보이는 이유: 애초에 조회에 성공한 단지만 캐시에 남기 때문에 생기는 survivorship bias다 — 연산동한솔솔파크처럼 반복 실패한 단지는 캐시에 아예 안 남는다는 것이 §7의 핵심 발견이었다. 그래서 이 94%를 "부산 커버리지"로 오인하면 안 된다.)

### 12-2. `ApartmentMaster`(M4-B 부산 전체 배치, 모집단 = 3,402건 — 이쪽이 진짜 "부산 전체"에 가깝다)

| 필드 | Present | Total | Coverage |
|---|---|---|---|
| 준공년도(buildYear) | 3,402 | 3,402 | 100.0% |
| 사용승인일(useApprovalDate) | 619 | 3,402 | 18.2% |
| 동수(mainBuildingCount) | 1,365 | 3,402 | 40.1% |
| 세대수(totalHouseholds) | 2,544 | 3,402 | 74.8% |
| 주차대수(parkingCount) | 876 | 3,402 | 25.7% |
| 건축물대장 관리번호(mgmBldrgstPk) | 2,624 | 3,402 | 77.1% |
| 좌표(latitude) | 3,401 | 3,402 | 100.0% |
| **용적률(far)** | **0** | 3,402 | **N/A — 컬럼이 스키마에 없음**(§10) |
| **건폐율(bcr)** | **0** | 3,402 | **N/A — 컬럼이 스키마에 없음**(§10) |

구/군별(sggCd) 상위 분포(세대수/주차 coverage, 상위 5개 구·군):

| sggCd | 총 단지 | 세대수 coverage | 주차 coverage |
|---|---|---|---|
| 26230(부산진구) | 404 | 71.8% | 24.5% |
| 26380(사하구) | 338 | 75.4% | 19.8% |
| 26260(동래구) | 314 | 83.4% | 26.4% |
| 26350(해운대구) | 308 | 71.8% | 31.8% |
| 26410(금정구) | 308 | 73.1% | 14.9% |
| 26470(연제구, 이번 primary case 소속 구) | 244 | 76.6% | 28.7% |

**핵심 결론**: `ApartmentMaster`(부산 전체 규모)에서도 주차대수 coverage는 25.7%로 낮다 — 즉 연산동한솔솔파크 하나만의 문제가 아니라, **총괄표제부 단일 소스 의존이 부산 전체 규모에서 주차 데이터의 약 74%를 놓치고 있는 구조적 패턴**이다(용적률/건폐율은 애초에 이 테이블에 컬럼이 없어 비교 불가, §10).

---

## 13. Missing Patterns

`Apartment`(36건, §15 스크립트 자동 분류) 안에서는 (A)/(C)/(D)/(E) 패턴이 **0건**이었다 — 즉 지금 캐시에 남아있는 36건은 "부분 결측"이 아니라 "거의 다 있거나(재조회 성공) 거의 다 없거나(연산동한솔솔파크처럼 매번 실패)" 양극단으로 갈리는 경향을 보였다. 이는 이번 STEP의 핵심 가설(총괄표제부 유무가 all-or-nothing에 가깝게 작동한다)과 일치한다.

`ApartmentMaster`(3,402건) 기준으로는 (B) "표제부 매치가 있는데 UI가 비어있음"에 해당하는 대규모 후보군이 존재할 가능성이 높다 — 세대수(74.8%)는 확보됐지만 주차(25.7%)는 없는 단지가 상당수라는 것이 §12-2에서 이미 드러났다. 다만 "표제부 매치 여부"까지 3,402건 전부에 대해 라이브로 재확인하는 것은 §17이 금지하는 대량 외부 API 재수집에 해당해, 이번 STEP에서는 연산동한솔솔파크 1건의 표제부 매치만 실증하고 나머지는 **패턴으로 존재를 추정**하는 데 그친다(추정과 실측을 섞어 보고하지 않기 위해 이 문장에서 명확히 구분한다).

---

## 14. Safe Fixes

**적용한 수정(코드 레벨, DB 스키마/마이그레이션 없음)**: `src/lib/apt-building-info.ts`의 `fetchBuildingRegistryInfo()`가 총괄표제부(`getBrRecapTitleInfo`)에서 레코드를 못 찾으면, **같은 이미 사용 중인 `BldRgstHubService` API의 다른 operation인 `getBrTitleInfo`(표제부)를 폴백으로 시도**하도록 추가했다. 신규 외부 API 연동이 아니다(기존에 이미 쓰던 서비스의 다른 operation일 뿐).

**안전조건(반드시 지킨 것)**: 표제부 조회 결과가 **정확히 1건일 때만** 값을 신뢰한다. `docs/development/14-apartment-master-m4-expansion-analysis.md` §K가 13일 전에 이미 지적한 위험(표제부는 "동 1개" 단위 값이라, 여러 동으로 이뤄진 단지에 그대로 적용하면 "동 단위 값을 단지 총괄값으로 잘못 저장"하게 된다)을 그대로 존중해, **이 지번에 건물이 정확히 1개뿐인 경우로만 적용 범위를 제한**했다 — 그 경우에는 그 1건이 곧 지번 전체(=단지)의 값이라 동-단지 혼동이 구조적으로 발생할 수 없다. 여러 표제부를 합산하는 방식(M4-A가 "위험하다"고 평가한 방식)은 채택하지 않았다.

**주차대수 계산**: 표제부에는 총괄표제부의 `totPkngCnt` 같은 단일 합계 필드가 없다. 대신 옥내자주식+옥외자주식+옥내기계식+옥외기계식(`indrAutoUtcnt`+`oudrAutoUtcnt`+`indrMechUtcnt`+`oudrMechUtcnt`) 4개 필드를 합산했다 — 이는 추정치가 아니라 같은 레코드의 실측 개별 수치를 그대로 더한 것이다(0 이하 값은 기존 프로젝트 관례대로 "미확보"로 취급, 실제 0을 저장하지 않음).

**검증 결과**(라이브 dev 서버, 실제 HTTP 호출):
- 연산동한솔솔파크: `용적률 535.3% / 건폐율 59.8% / 세대당 1.24대(총 204대)` — 정상 노출 확인(§8).
- 회귀 확인 1(이미 총괄표제부로 정상 작동하던 대신롯데캐슬, 부산 서대신동): 수정 전후 동일하게 `249.5%/18.4%/888대` — 폴백 로직이 기존 정상 경로를 건드리지 않음을 확인.
- 회귀 확인 2(총괄표제부·표제부 양쪽 다 매치 안 되는 "시범", 서울 여의도동): 수정 후에도 여전히 정직하게 "정보 없음" 유지 — 안전조건(1건 정확 매칭)이 값을 지어내지 않음을 확인.

**테스트**: `src/lib/apt-building-info.test.mjs`(신규, 7개 테스트) — 실제 연산동한솔솔파크 원본 필드로 정확한 추출 검증, 4개 주차 필드 합산 검증, 0/음수 값의 "미확보" 처리(데이터 신뢰 원칙 재확인), 필드 결측 시 안전한 null 처리, `useAprDay` 형식 오류 처리, null 레코드 처리.

---

## 15. Automated QA(재사용 가능한 read-only 스크립트)

`scripts/audit-apartment-basic-data-coverage.ts` — DB에 절대 쓰지 않는다(SELECT류 Prisma 호출만). `Apartment`/`ApartmentMaster` 두 테이블의 필드별 coverage, 고가치 결측 패턴(A/C/D/E), present/missing 비교 표본, primary case(aptSeq 정확 매칭 — 이름 substring 매칭의 위험성을 주석으로 명시), 구/군별 분포까지 한 번에 출력한다.

실행: `npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-apartment-basic-data-coverage.ts`

---

## 16. Recommended Backfill/Integration (USER_APPROVAL_REQUIRED 대상 — 이번 STEP에서 실행하지 않음)

1. **`ApartmentMaster`에 far/bcr 컬럼 추가**: 스키마 변경이 필요하므로 이번 STEP에서 하지 않는다. 추가된다면 §14와 동일한 표제부-폴백 안전조건(1건 정확 매칭)을 M4 시리즈 배치에도 이식하는 것을 권장한다.
2. **부산 전체(3,402건) 대상 표제부 폴백 백필**: 라이브 경로(§14)는 사용자가 그 단지를 조회할 때만 폴백이 실행되는 lazy 방식이라 즉시 전체 커버리지를 올리지 않는다. 3,402건 전체를 표제부까지 포함해 재조회하는 배치는 대량 외부 API 재수집(§17 하드스톱 대상)이라 **승인 없이 실행하지 않는다.** 승인 시 영향 범위는 최대 3,402건(현재 far/bcr 자체가 없는 전체 ApartmentMaster) — 정확한 영향 건수는 스키마 추가 이후 재산정 필요.
3. **K-apt 신규 연동**: §6에서 MISSING_SOURCE로 분류됨 — 이번 STEP에서 구현하지 않는다. 향후 검토 시 총괄표제부/표제부만으로는 못 얻는 "관리방식" 같은 필드의 보강 후보로 남긴다.

---

## 17. Automated QA

§15 스크립트 + §14 유닛 테스트(7개, 전부 pass) + 기존 baseline 테스트 31개(회귀 없음, 총 38/38 pass).

---

## 18. Launch Risk

- **DB 쓰기**: 없음(스키마/마이그레이션/대량쓰기 전부 없음). §14의 유일한 런타임 부작용은 기존에도 있던 "라이브 조회 성공 시 Apartment 테이블에 upsert"라는 **이미 존재하던 동작**이 조회 성공 케이스를 하나 더 갖게 된 것뿐이다(신규 upsert 로직 추가 아님).
- **성능**: 폴백은 총괄표제부가 실패했을 때만 실행되는 2차 호출이라 총괄표제부가 정상 응답하는 다수의 단지(§11 "있는 단지" 그룹)에는 추가 지연이 없다. 실패 케이스에서도 기존에 이미 겪던 지연(총괄표제부 4초 타임아웃)에 표제부 호출(동일 4초 타임아웃) 하나가 더해지는 정도로, §20이 금지하는 "새로운 상시 외부 호출"에 해당하지 않는다(같은 실패 상황에 한해서만 추가로 시도하는 구조).
- **오탐 위험**: 안전조건(정확히 1건)을 어기면 동-단지 혼동 위험이 있다는 것이 M4-A의 핵심 경고였다 — 이번 구현은 이 조건을 코드 레벨에서 강제하므로, 복수 동 단지에는 폴백이 발동하지 않고 여전히 "정보 없음"으로 남는다(값을 지어내는 것보다 안전).

---

## 관련 문서

- `docs/development/14-apartment-master-m4-expansion-analysis.md` §K(표제부 폴백 위험 최초 지적, 이번 STEP의 안전조건 설계 근거)
- `docs/development/CHANGELOG.md`(이번 STEP 항목 추가)
