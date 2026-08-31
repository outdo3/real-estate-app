# MASTER HOUSEHOLD VERIFICATION V1

## 1. Goal

`BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1`이 발견한 household outlier 30건을
공식/신뢰 source로 검증하고, "경동마리나"의 실제 전체 세대수/동수를 확정
시도하며, 단일 표제부가 단지 전체값으로 오인되는 패턴의 정확한 규모를
수치화한다. Production write는 하지 않는다 — READ-ONLY VERIFICATION +
REPAIR CANDIDATE CLASSIFICATION까지만.

## 2. Input: 30 Outliers

`data/master-integrity/busan-master-repair-candidates.json`의
`field="totalHouseholds"` 30건 전부를 입력 universe로 사용(재구현 없이
그대로 재사용). 필수 fixture: 경동/경동마리나(aptSeq 26350-2).

## 3. Source Priority

실행 순서대로 시도:

1. **K-APT/공동주택관리정보** — 이번 STEP에서 실제로 시도했으나 이 프로젝트의
   `DATA_GO_KR_API_KEY`로는 접근 불가 확인(§6).
2. 국토교통부 공동주택 정보 공공데이터 — 1과 사실상 동일 서비스군, 동일하게
   불가.
3. **건축물대장 총괄표제부**(`BldRgstHubService.getBrRecapTitleInfo`) — 30건
   전부 재조회, 전부 0건(레코드 없음).
4. **건축물대장 표제부**(`getBrTitleInfo`, 단일 건물) — 30건 전부 1건씩
   존재. 안전하게 합산 가능한지 §7 기준으로 판정(대부분 불가능 — 아래 참고).
5. 프로젝트 내 검증된 imported source — 해당 없음(legacy Apartment도 이
   30건에 대해서는 별도 신뢰 소스가 아님, 이미 같은 파이프라인 산출물).
6. 네이버/아실 — 참고 비교용으로만 인용(892세대 등), authoritative proof로
   미채택.

**결론**: 이번 STEP이 실제로 접근 가능했던 유일한 공식 source는
건축물대장(표제부/총괄표제부)뿐이었다. K-APT가 확보됐다면 30건 대부분이
HIGH_CONFIDENCE로 전환됐을 가능성이 높으나, 현재 접근 권한으로는 확인할
수 없다(§26 알려진 한계).

## 4. Identity Matching Rules

30건 전부 `ApartmentMaster.aptSeq`(canonical, MOLIT 발급)로 식별 —
`sggCd+umdCd+jibun`을 그대로 건축물대장 조회 파라미터로 사용해 loose name
match를 전혀 쓰지 않았다(§5 요구사항 그대로 준수). 다른 아파트로
오매칭된 사례 없음(전부 동일 aptSeq의 동일 jibun을 재조회했을 뿐).

## 5. Gyeongdong Marina Proof

**Q1. 공식 단지 전체 세대수는 몇 세대인가?**
**미확정.** 총괄표제부 0건(재확인), 표제부 1건(건물 "103동" 단독 72세대).

**Q2. 공식 동수는 몇 동인가?**
**미확정.** 총괄표제부가 없어 공식 동수 집계 자체가 존재하지 않는다.
MOLIT 실거래 981건 재분석 결과 — 전 거래가 jibun="974" 하나로만 등록돼
있으나, 같은 층 번호(예: 10층)에서 서로 다른 전용면적(58.695/59.535/
84.77/84.95/123.98㎡)이 반복 관측돼(§7) 여러 라인/동이 존재할 개연성은
높지만, 정확한 동수는 확인하지 못했다.

**Q3. K-APT 단지코드가 존재하는가?**
**확인 불가.** K-APT API 자체가 이 프로젝트 키로 접근 불가(§6).

**Q4. 총괄표제부 또는 공식 공동주택 source에서 전체값 확인 가능한가?**
아니오 — 총괄표제부 재조회 0건(이번 STEP 재확인).

**Q5. 892세대가 공식 source와 일치하는가?**
**확인 불가.** 공식 source에서 892라는 숫자를 확인할 방법이 없었다 —
채택하지 않는다(§ 데이터 진실 원칙).

**Q6. ApartmentMaster 72는 명백한 잘못된 값인가?**
72 자체는 **거짓이 아니다**(건물 "103동"의 실제 등록 세대수) — 다만
그 값이 "단지 전체"를 대표한다는 **가정**이 명백히 근거 없다(§7 root
cause). 즉 "72"라는 숫자는 정확하지만, 그것이 채워진 필드의 의미
(`ApartmentMaster.totalHouseholds` = 단지 전체 세대수)와 실제로 나타내는
범위(건물 1개)가 불일치한다.

**Q7. correction confidence는 HIGH/REVIEW 중 무엇인가?**
**REVIEW_REQUIRED.** 올바른 전체값을 모르는 채로 892 등 미검증 수치로
"수정"하는 것은 §23/§25 원칙 위반이다.

## 6. K-APT Findings

`AptListService3/getSigunguAptList`, `AptListService/getSigunguAptList`,
`AptListService2/getLegaldongAptList`, `AptBasisInfoServiceV3/
getAphusBassInfoV3` 4개 엔드포인트 변형을 시도(모두 `DATA_GO_KR_API_KEY`
재사용) — 전부 동일한 `NO_OPENAPI_SERVICE_ERROR`("해당 오픈API 서비스가
없거나 폐기됨") 응답. data.go.kr는 API 상품별로 별도 활용신청/승인이
필요한 구조이며, 이 키는 현재 MOLIT 실거래 + 건축물대장(BldRgstHubService)
상품에만 승인돼 있고 K-APT 계열 상품에는 승인돼 있지 않은 것으로
판단된다. 새 API 상품 활용신청은 계정 조치가 필요해 이번 STEP 범위 밖—
사용자 승인 후 진행 권고(§26).

## 7. Building Register Findings

**핵심 발견**: 30건 재조회 결과, 표제부 응답의 `dongNm` 필드(기존
파이프라인이 추출하지 않던 필드)가 결정적 신호였다.

| dongNm 패턴 | 건수 | 해석 |
|---|---|---|
| "숫자+동"/"제N동"(예: "103동", "6동", "제108동") | **27건** | 다동 복합단지 중 특정 건물 — 전체값으로 신뢰 불가 |
| 공백 | **3건** | 진짜 단일 건물 단지 — 표제부 1건 = 그 지번 전체 (기존 가정이 실제로 맞는 경우) |
| 비정형(단지명 자체가 dongNm에 들어감, 예: "범일역 삼정그린코아 더 시티") | **1건** | 애매함, 자동 판정 불가 |

§6 "표제부 합산 안전조건"(동일 대지/공동주택 용도/동 identity/중복
없음/세대수 field 의미 동일) 재검토 결과: 각 후보의 표제부가 정확히
1건씩만 나오므로 애초에 "합산"할 대상 자체가 없다(같은 지번에 여러
표제부가 동시에 잡히는 경우가 아니라, 그 지번 자체가 복합단지의 한
동만 등록하고 있는 구조) — 따라서 "합산 가능 여부 증명"이 아니라
"이 1건이 전체를 대표하는지" 여부가 실제 쟁점이었고, dongNm이 그 답을
제공했다.

## 8. 30-candidate Result Table

전체 결과는 `data/master-integrity/busan-household-verification-v1.json`
참고(각 행에 aptSeq/name/dong/jibun/currentHouseholds/verifiedHouseholds/
currentBuildingCount/verifiedBuildingCount/primarySource/sourceId/
sourceDate/confidence/severity/rootCause/recommendedAction/evidence/
evidenceStrength/correctionDelta/notes 전부 기록). 요약:

| confidence | 건수 |
|---|---|
| HIGH_CONFIDENCE | 0 |
| REVIEW_REQUIRED | 27 |
| NO_CORRECTION | 3 |

## 9. HIGH_CONFIDENCE

**0건.** 30건 전부 재조회한 총괄표제부가 예외 없이 0건이었다 — 즉 최초
backfill 파이프라인이 총괄표제부를 놓친 사례(재조회 시 발견됐다면
`MASTER_IMPORT_OMISSION`으로 자동 HIGH_CONFIDENCE 처리하도록 스크립트에
분기를 마련했으나, 실제로 하나도 해당하지 않았다).

## 10. REVIEW_REQUIRED

**27건**(경동 aptSeq=26350-2 포함, §8 표 참고) — 26건은
`SINGLE_BUILDING_AS_COMPLEX`(§7 dongNm 패턴 확정), 1건("범일역삼정그린코아
더시티", aptSeq=26170-837)은 `UNKNOWN`(dongNm 비정형이라 이번 STEP의
좁은 가드로 자동 판정 불가). 전부 `recommendedAction=NO_ACTION`(정확한
값을 모르는 채로 임의 수정 금지) — 올바른 값 확정에는 K-APT 접근 권한
확보 또는 별도의 전수 동별 표제부 조사가 필요하다.

## 11. NO_CORRECTION

**3건**: 일광(26140-1202, 8세대), 일루스타(26530-1045, 9세대),
성우이린타워(26500-2212, 28세대) — 전부 표제부 `dongNm`이 공백으로,
"진짜 단일 건물 단지"의 정상 패턴과 일치한다. 즉 §9 household outlier
탐지(세대당 주차 5대 초과)가 이 3건에 대해서는 **household 필드 기준으로는
false positive**였다 — 현재 저장된 세대수 자체는 신뢰 가능하다고 판단한다.
(주차대수 자체의 이상은 별도 필드 문제로, 이번 STEP 범위 밖 — §26에 기록)

## 12. Error Pattern Distribution

| PATTERN | 건수 |
|---|---|
| SINGLE_BUILDING_AS_COMPLEX | 26 |
| PARTIAL_BUILDING_SUM | 0 |
| LEGACY_CACHE_OVERRIDE | 0 |
| MASTER_IMPORT_OMISSION | 0 |
| WRONG_SOURCE_ROW | 0 |
| MIXED_USE_COMPLEX | 0 |
| SOURCE_CONFLICT | 0 |
| FALSE_POSITIVE | 3 |
| UNKNOWN | 1 |

30건 중 26건(87%)이 정확히 동일한 단일 원인(§13)에서 비롯됐다 — 이는
개별 데이터 오류가 아니라 **파이프라인 설계 자체의 구조적 위험**임을
강하게 뒷받침한다.

## 13. Pipeline Root Cause

`scripts/backfill-apartment-master-basic-data.ts`의 `processRow()`(및
동일 로직을 공유하는 `src/lib/apt-building-info.ts`의
`fetchBuildingRegistryInfo` → `fetchBrTitleInfoFallback`, `info/route.ts`의
라이브 조회 경로도 같은 함수를 씀)에서:

```
총괄표제부(getBrRecapTitleInfo) 조회
  → 0건이면 표제부(getBrTitleInfo) fallback
    → "그 지번에 표제부가 정확히 1건"이면 신뢰(안전조건, 코드 주석:
       "표제부엔 동수 개념 없음(건물 1건 = 그 지번 전체)")
```

이 가정은 "그 지번에 건물이 정확히 1개 등록돼 있다"는 사실로부터
"그 지번이 곧 그 단지 전체"라는 결론을 끌어내는데, **다동 복합단지 중
한 건물만 정확히 그 지번/bun-ji 조합에 등록되고 나머지는 API가 응답하지
않는 경우**(원인은 등록 자체가 지번별로 분산됐거나 API가 그 조합에서는
1건만 반환하는 구조 — 정확한 이유는 확인 못함) 이 가정이 깨진다. 표제부
원본 응답에는 `dongNm`(예: "103동")이라는 명확한 반증 신호가 이미 존재
했으나, 기존 `parseBrTitleInfoRecord()`가 이 필드를 아예 추출하지
않았다 — **버그는 안전조건의 논리 자체가 아니라, 이미 응답에 있던
신호를 무시한 것**이었다.

## 14. Household Provenance Contract

```
HOUSEHOLDS PRIMARY:
  K-APT verified complex total (현재 접근 불가 — 확보 시 최우선)

SECONDARY:
  건축물대장 총괄표제부(getBrRecapTitleInfo) — 복합단지 전체 집계

FALLBACK:
  건축물대장 표제부(getBrTitleInfo) 1건, 단 dongNm이 공백(구체적 건물
  번호가 아님)일 때만 — 그 지번에 등록된 유일한 건물이라는 의미이므로
  단지 전체로 신뢰 가능

NEVER:
  표제부 dongNm이 "숫자+동"/"제N동" 등 구체적 건물번호를 가리키는데
  그 값을 단지 전체 세대수로 저장하는 것(이번 STEP에서 코드 가드로
  차단, §16)

  네이버/아실 등 민간 서비스 수치를 단독 근거로 DB 값을 확정하는 것
```

## 15. Building-count Provenance Contract

```
BUILDING COUNT PRIMARY:
  건축물대장 총괄표제부의 mainBldCnt

SECONDARY/FALLBACK:
  없음 — 표제부(getBrTitleInfo)는 "동수" 개념 자체가 없다(단일 레코드가
  그 건물 하나를 기술할 뿐, 몇 개 동으로 구성된 단지인지는 알려주지
  않는다). 표제부만으로 동수를 추정/기입하지 않는다.

NO-DATA RULE:
  총괄표제부가 없으면 mainBuildingCount는 null로 유지(추측 금지) — 기존
  코드가 이미 이 원칙을 지키고 있었음을 재확인(변경 없음).
```

## 16. Code Guard

`src/lib/apt-building-info.ts`에 `isNumberedBuildingUnit(dongNm)` 신규
추가(순수 함수) — `dongNm`이 `/^제?\d+동$/` 패턴(구체적 건물번호)이면
`true`. 이 함수를 두 지점에 적용:

1. `fetchBrTitleInfoFallback()`(같은 파일, `info/route.ts`의 라이브 조회가
   쓰는 경로) — 표제부 1건이어도 `isNumberedBuildingUnit`이면 `null`
   반환(정보 없음으로 처리, 잘못된 값을 저장/노출하지 않음).
2. `backfill-apartment-master-basic-data.ts`의 `fetchTitleFallbackOnce()`
   — 동일 조건이면 신규 상태 `building_unit_review`를 반환, `processRow()`
   에서 `outcome: 'REVIEW'`로 분류해 자동 write하지 않는다(사람 검토
   유도).

**DB/schema 변경 없음.** 현재 live 값(72 등)을 코드에 하드코딩하지
않았다 — 가드는 향후 재실행/신규 발견 시 같은 오류가 재발하는 것만
막는다(이미 저장된 30건은 이번 STEP에서 건드리지 않음, §22).

## 17. Repair Candidate File

`data/master-integrity/busan-household-verification-v1.json`(신규) —
30건 전부, §8 스키마 그대로. 원본 `busan-master-repair-candidates.json`
(이전 STEP 산출물)은 수정하지 않았다(새 파일로 분리 산출).

## 18. Production Repair Plan

**HIGH_CONFIDENCE 0건 — 실행 대상 없음.** 이번 STEP은 어떤 Production
row도 수정 대상으로 확정하지 못했다. 27건(REVIEW_REQUIRED)에 대한 향후
계획:

- rows: 27(§10 목록, aptSeq 전체는 repair candidate 파일 참고)
- fields: `totalHouseholds`, 파생 `parkingPerHousehold`
- current→proposed: 미확정(§9 — 올바른 값을 모름, 892 등 미검증 수치
  채택 안 함)
- source: K-APT(확보 필요) 또는 동별 표제부 전수 조사
- confidence: REVIEW_REQUIRED → 위 source 확보 후 재평가 필요
- expected user-visible impact: 해당 27개 단지 상세페이지의 "세대수"
  표시가 실제보다 낮게 나올 수 있음(§20 검색/상세 노출 범위는 이전
  STEP §16에서 이미 확인 — Master가 이미 값을 갖고 있어 legacy/live
  fetch 경로를 거치지 않고 그대로 노출됨).

## 19. Quota Usage

- K-APT 탐색: 4회(모두 실패, §6).
- 30건 검증(총괄표제부+표제부 각 1회): 60회.
- 총 64회, 전부 targeted call(부산 전체 blind scan 없음, §17 준수).
- 429/quota 경고 없음, 전부 1.6초 간격 순차 호출로 완료.

## 20. Known Limitations

- K-APT 접근 불가로 인해 이번 STEP의 가장 중요한 질문("경동마리나의
  진짜 세대수는?")에 최종 답을 내지 못했다.
- `isNumberedBuildingUnit`은 "숫자+동" 패턴만 잡는다 — "범일역삼정그린코아
  더시티"처럼 dongNm에 단지명 전체가 들어가는 비정형 케이스는 이 가드로
  자동 차단되지 않는다(§7/§10 UNKNOWN 1건).
- NO_CORRECTION 3건은 household 필드 관점의 결론이며, 애초에 이 3건을
  outlier로 만든 parkingPerHousehold 이상치(주차대수 필드) 자체의 원인은
  조사하지 않았다(이번 STEP 범위 밖).
- 30건 모두 부산 해운대구(26350)/사상구(26530) 등 특정 구에 편중돼
  있는데, 이는 §17 targeted call 원칙상 이 30건에만 조사가 한정됐기
  때문이며, 부산 전체에 같은 패턴이 이 30건 이상으로 존재하지 않는다는
  뜻은 아니다(이전 STEP의 pph>5 임계값 기준 산출물을 그대로 재사용).

## 21. Next Step

1. K-APT API 활용신청(계정 조치, 사용자 승인 필요) — 승인되면 27건
   REVIEW_REQUIRED 대부분이 HIGH_CONFIDENCE로 전환 가능할 것으로 예상.
2. `MASTER_DATA_REPAIR_V1`(K-APT 확보 후, 실제 Production correction
   실행 — 별도 승인 STEP).
3. NO_CORRECTION 3건의 주차대수 필드 이상 원인 조사(선택적, 낮은 우선순위).
