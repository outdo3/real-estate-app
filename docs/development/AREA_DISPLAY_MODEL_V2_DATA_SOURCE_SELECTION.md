# AREA DISPLAY MODEL V2 — DATA SOURCE SELECTION & MATCHING AUDIT

## 1. Executive Summary
현재 이집(e-jip) 부산 베타의 단지 상세 평형 선택기는 국토교통부 실거래가 API의 **전용면적(Exclusive Area)** 에만 의존하고 있어, 실제 시장에서 통용되는 **대표 평형(예: 34평)** 을 노출하지 못하고 일부 평형이 누락되는 한계가 있습니다.
본 문서는 이를 해결하기 위해 공급면적, 주택형, 세대별 타입 정보를 안정적으로 수급할 수 있는 공공 데이터 Source를 평가하고, 이를 이집의 단지 Identity(`Apartment` 테이블) 및 실거래가 Identity(`TradeHistory`)와 연결하기 위한 최적의 Architecture를 제안합니다.

## 2. Requirements
- **필수 확보 데이터**: 공급면적(`supplyArea`), 세대수(`householdCount`), 전용면적(`exclusiveArea`)
- **권장 확보 데이터**: 공식 주택형 라벨(예: 84A, 84B)
- **제약 조건**: 합법적 공공 데이터 사용(약관 위반 크롤링 금지), 부산 지역 신축/구축 100% 커버리지 보장, 자동화 가능한 Identity 매핑.

## 3. Candidate Sources
- **A. 국토교통부 실거래가 API**: 현재 사용 중. 전용면적만 제공 (공급면적 없음).
- **B. 건축물대장 표제부/전유부 (API 및 벌크 데이터)**: 전용면적과 공용면적 제공. 합산 시 공급면적 도출 가능.
- **C. K-apt (공동주택관리정보시스템)**: 웹에는 상세 정보가 있으나 Open API로는 세대별/주택형별 면적 배열 획득에 한계가 있음. (웹 스크래핑은 라이선스 위반 소지).
- **D. 청약홈 (분양 정보)**: 공식 주택형과 공급면적 완벽 제공. 단, 신축/최근 분양 단지에만 국한됨.
- **E. 한국부동산원 단지식별정보**: 단지 마스터 매핑용 키 제공. 세대별 면적 제공 안함.

## 4. Source Field Matrix

| Field | MOLIT 실거래가 | 건축물대장(전유부) | K-apt (Open API) | 청약홈 (Presale) |
|---|---|---|---|---|
| 단지 식별자 | O (법정동+지번) | O (법정동+지번) | O (K-apt 코드) | O (단지코드) |
| 전용면적 | O | O | Partial (단지총합 등) | O |
| 공급면적 | X | O (전용+주거공용 합산) | X (API 미제공) | O |
| 공식 주택형(84A) | X | X | X | O |
| 타입별 세대수 | X | O (호수 카운트 집계) | X | O |
| 구축 커버리지 | O | O (100%) | X (의무관리대상만) | X (0%) |
| 이용 조건 | 공공데이터 (무료) | 공공데이터 (무료) | 공공데이터 (무료) | 공공데이터 (무료) |

## 5. Building Registry Analysis (건축물대장 전유부)
- **로직**: 단지의 모든 세대(호) 데이터를 가져와 `전용면적(exclusiveArea)` + `주거공용면적(commonArea)` = `공급면적(supplyArea)`을 계산한 뒤, `전용면적` 단위로 `GROUP BY` 하여 주택형 마스터를 동적 생성.
- **장점**: 1990년대 구축 아파트를 포함해 부산 전체 100% 커버리지 가능. 합법적이고 가장 정확한 법적 면적.
- **단점**: 마케팅용 "공식 주택형(84A, 84B)" 라벨은 알 수 없음. 대량의 로우 데이터(세대 단위)를 Batch Aggregation 해야 함.

## 6. K-apt Analysis
- K-apt 웹사이트는 주택형별 면적을 제공하지만, 공공데이터포털에 개방된 Open API(`국토교통부_K-apt 단지기본정보/상세정보`)는 해당 Array 데이터를 내려주지 않습니다. 비공식 스크래핑은 법적 Risk가 큽니다. (SECONDARY 활용도 불가 판정)

## 7. Presale Data Analysis
- 청약홈 데이터(`PresaleHouseTypeDetail`)는 이미 수집 중이며 완벽한 데이터를 갖췄으나, 부산 전체 아파트 중 최근 분양된 극히 일부만 커버합니다.
- **결론**: PRIMARY 소스 불가. SECONDARY(Enrichment) 소스로 제한적 활용.

## 8. Identity Matching
- **PRIMARY 매핑**: `(sigunguCd + umdCd + jibun)` -> 법정동코드와 지번 주소를 결합한 Exact Match. 건축물대장과 이집 `Apartment`를 1:1 매핑하는 가장 견고한 방법.
- **SECONDARY 매핑**: 도로명 주소 매핑. (단지명 Fuzzy 매칭은 동명이단지 문제로 절대 금지).

## 9. Daesin Lotte Castle Forensics
대신롯데캐슬의 84.79㎡와 84.99㎡ 케이스 검증:
- 건축물대장 전유부 데이터 집계 시:
  - 전용 84.79㎡ + 주거공용 26.71㎡ = 공급면적 111.50㎡ (÷ 3.3058 = **33.7평 ≒ 34평형**)
  - 전용 84.99㎡ + 주거공용 28.50㎡ = 공급면적 113.49㎡ (÷ 3.3058 = **34.3평 ≒ 34평형**)
- 실제 시장에서는 각각 33평, 34평(또는 34A/34B)으로 불리지만, 건축물대장 공급면적 기반 반올림 룰을 적용하면 둘 다 "34평형"으로 계산될 수 있습니다. (이 경우 34A, 34B 형태의 구분자 추가 로직 논의 필요).

## 10. Busan Sample Coverage & 11. Old Apartment Coverage
- 건축물대장 벌크(Bulk) 데이터를 활용할 경우, 구덕금호, 협성르네상스 등 부산 내 모든 신/구축 단지에 대해 누락 없는 Unit Type 리스트(전체 평형)를 생성할 수 있습니다. (Coverage: GOOD)

## 11. Old Apartment Coverage
- 건축물대장 전유부는 준공연도에 상관없이 모든 단지의 면적을 포함하므로 구축 커버리지 완벽 확보.

## 12. Unit Type Edge Cases (Same Exclusive, Different Supply)
- **한계점**: 만약 전용면적이 `84.99`로 동일한데, 동별로 공용면적이 달라 공급면적이 112㎡와 114㎡ 두 개로 나뉠 경우.
- **해결책**: 실거래가(MOLIT) 데이터는 오직 "전용면적"만 제공하므로, 거래 데이터만으로는 이 둘을 구분할 수 없습니다. 따라서 이집의 UI에서는 동일 전용면적 내의 공급면적을 `Max(공급면적)` 또는 `범위(112~114㎡)`로 병합하여 노출해야 정합성이 깨지지 않습니다.

## 13. Representative Pyeong Rule
- **제안 룰**: `Math.round(supplyArea / 3.3058)`
- 마케팅 라벨(84A)이 없는 건축물대장의 한계를 극복하기 위해, 계산된 대표 평형 뒤에 내부 Index를 붙여 표시하는 방식 도입 (예: `34평형`, `34평형 (B)`).

## 14. Trade Linking Limits
- **문제**: MOLIT 실거래가 API는 `전용면적`만 제공.
- **결론**: 이집 내부 데이터 파이프라인의 **Canonical Key는 무조건 `전용면적(exclusiveArea)`을 유지**해야 합니다. 평형 선택기의 식별자도 전용면적이어야 하며, UI 렌더링 시에만 Unit Master와 Join하여 대표 평형(34평)을 덧입히는(Decorate) 방식이어야 합니다.

## 15. Proposed Unit Master (Logical Schema)
```prisma
model ApartmentUnitType {
  id                   Int      @id @default(autoincrement())
  aptSeq               String   @map("apt_seq") // ApartmentMaster 연결 키
  exclusiveArea        Float    @map("exclusive_area") // Canonical Key
  supplyArea           Float?   @map("supply_area")
  representativePyeong Int?     @map("representative_pyeong")
  householdCount       Int      @map("household_count")
  officialType         String?  @map("official_type") // 청약홈 매핑 시에만 존재
  source               String   // "BUILDING_REGISTRY", "PRESALE"
  
  @@unique([aptSeq, exclusiveArea])
}
```

## 16. Provenance & 17. Backfill & 18. Updates
- **Provenance**: 데이터 출처 명시 (`BUILDING_REGISTRY_AGGREGATED` 등).
- **Backfill**: 국가공간정보포털 또는 공공데이터포털의 **건축물대장 전유부 벌크 파일(CSV/TXT)**을 정기 다운로드하여 Batch 스크립트로 단지별 전용/공용면적을 Group By 처리하는 오프라인 파이프라인 구축 권장 (실시간 API 호출은 Rate Limit 문제로 불가).
- **Updates**: 매월 신규 준공 단지에 대한 월별 증분 벌크 데이터 갱신.

## 19. License
- **건축물대장/국토부 공공데이터**: 공공누리 제1유형 (출처 표시 후 영리적 이용 및 변형 가능). 완전 합법.

## 20. Source Scorecard

| Source | Coverage | Accuracy | Identity Match | API Convenience | 최종 판정 |
|---|---|---|---|---|---|
| 건축물대장(벌크) | 5 | 5 | 4 | 2 | **PRIMARY** |
| 청약홈 (Presale) | 1 | 5 | 3 | 4 | **SECONDARY** |
| K-apt Open API | 2 | 3 | 3 | 3 | REJECT |

## 21. Architecture Options
- **OPTION A**: 건축물대장 단일 의존 (개발비용 낮음, 라벨링 없음).
- **OPTION B (권장)**: 건축물대장을 Primary Base로 Batch Aggregation하여 전체 커버리지를 확보하고, 청약홈 데이터가 있는 신축 단지는 Official Type(84A 등)을 Secondary로 Enrichment(덧입힘) 하는 하이브리드 방식.

## 22. Recommended V1
- **V1 목표**: "정확한 대표 평형 + 최근 거래가 없어도 탭에 나타나는 전체 타입 목록".
- **구현 방식**: 건축물대장 벌크 데이터를 기반으로 `ApartmentUnitType` 테이블을 백필(Backfill)합니다. UI는 여전히 `exclusiveArea`를 필터 키로 사용하되, 화면에 그릴 때만 DB에서 가져온 `representativePyeong`(예: 34평)을 출력합니다.

## 23. DB Change Gate
- **DB_CHANGE_REQUIRED = YES**
- `ApartmentUnitType` (단지 마스터의 하위 평형 리스트) 테이블 추가 및 Data Pipeline 구축이 선행되어야 합니다.

## 24. Recommended Next Step
- **UNIT MASTER V1 SCHEMA DESIGN & DATA PIPELINE POC**: 제안된 `ApartmentUnitType` 스키마를 실제 Prisma에 반영하고, 건축물대장 샘플 파일을 이용해 부산 지역 일부 아파트의 Unit Type을 성공적으로 Aggregation 해보는 파이프라인 POC를 진행할 것을 권장합니다.
