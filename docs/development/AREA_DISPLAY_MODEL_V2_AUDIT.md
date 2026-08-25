# AREA DISPLAY MODEL V2 — AUDIT REPORT

## 1. Executive Summary
- 현재 이집(e-jip) 단지 상세의 평형 선택기는 국토부 실거래가(MOLIT) 데이터의 **전용면적(Exclusive Area)**을 기반으로 동적으로 생성됩니다.
- 공급면적(Supply Area) 데이터가 부재하여 전용면적을 평(pyeong)으로 직접 환산(÷ 3.3058)해 노출하고 있으며, 이는 실제 부동산 시장에서 통용되는 **대표 평형(분양/공급평수, 예: 34평)**과 큰 괴리가 있습니다.
- 또한, 특정 단지의 전체 주택형을 관리하는 `Unit Master` 테이블이 없기 때문에, 최근(기본 36개월) 거래 내역이 없는 주택형은 아예 평형 선택 목록에서 누락되는 문제가 존재합니다.
- 결론적으로, 완벽한 대표 평형 노출과 전체 주택형 선택기를 구현하기 위해서는 **공급면적 및 세대별 타입 정보**를 담은 새로운 공공 데이터 Source 연동과 DB Schema 확장이 필수적입니다.

## 2. Current Area Model
- **Canonical Semantics**: 현재 시스템에서 모든 면적의 식별자(ID/Key)는 거래 데이터의 **정확한 전용면적(exact `exclusiveArea`)**입니다.
- **Fuzzy Matching 금지**: 84.79㎡와 84.99㎡는 별개의 Identity를 유지하며 합쳐지지 않습니다. (AREA MODEL V1 규칙 준수)

## 3. Area Selector Source
- **Source**: `src/app/api/apt/[name]/route.ts` 에서 실시간으로 호출하는 MOLIT 실거래가 API의 응답(`filteredTrades`).
- **Mechanism**: 클라이언트(`AreaSelector.tsx`)에서 이 거래 배열을 순회하며 `Array.from(countByArea.keys())`로 동적(unique) 평형 칩을 생성합니다.
- DB Master 기반이 아닌 **Trade Rows 기반**의 Client-side Set/Dedup 구조입니다.

## 4. Missing Unit Root Cause
가장 큰 평형 등 특정 평형이 선택기에서 누락되는 원인은 다음과 같습니다:
- **A. 최근 실거래가 있는 면적만 목록 생성 (확정)**
- API 요청 시 지정된 기간(`period` 파라미터, 기본 36개월) 내에 매매/전월세 거래가 1건도 없었다면 API 응답 배열에 해당 면적이 아예 존재하지 않습니다. 결과적으로 Area Selector가 이를 인지할 방법이 없습니다.

## 5. Schema Audit
- **Prisma Schema (`prisma/schema.prisma`)**:
  - `Apartment` 및 `ApartmentMaster` 모델에는 단지 기본 정보(건축년도, 세대수 등)만 존재합니다.
  - 단지 내 세대별 타입, 전용면적, 공급면적 리스트를 담고 있는 **Apartment Unit (주택형)** 테이블은 **존재하지 않습니다.**
  - (단, 분양권 `PresaleHouseTypeDetail` 모델에는 `supplyArea`가 존재함.)

## 6. Source Data Audit
- `fetchMolitData` (MOLIT 실거래 API): `전용면적`(`excluUseAr`)만 제공. `공급면적`, `공식 주택형` 제공 불가.
- 현재 단지 정보: Kakao API 등에서 가져오지만 세대별 세부 주택형 정보는 없음.
- **Missing Fields**: 공급면적, 공식 주택형, 평형명, 주택형별 세대수 모두 누락.

## 7. Area Concept Definitions
1. **전용면적 평환산 (`exclusiveArea` ÷ 3.3058)**: 현재 적용된 방식 (예: 84㎡ → 25.4평). 사용자는 이를 이질적으로 느낌.
2. **공급면적 평환산 (`supplyArea` ÷ 3.3058)**: 일반적으로 아파트에서 사용하는 **대표 평형** (예: 112㎡ → 33.8평 ≒ 34평).
3. **공식/시장 대표 평형명**: 33평, 34평 등 분양 시점 및 네이버 부동산 등에서 사용하는 통칭.
4. **공식 주택형**: 84A, 84B, 84.79 등.

## 8. Sample Apartments (Daesin Lotte Castle Case)
- 대신롯데캐슬에는 전용 **84.79㎡**와 **84.99㎡**가 실거래 데이터 상 별도 타입으로 존재합니다.
- 현재 코드(`trimTrailingZeros`)는 이를 소수점까지 식별하여 다른 면적으로 분리(Filter Split)하는 데 성공합니다.
- 그러나 둘 다 환산하면 "약 25.6평"과 "약 25.7평"으로 표기될 뿐, 실제 시장에서 불리는 **33평**, **34평**으로 구분할 근거(공급면적 차이 또는 주택형 이름)가 시스템 상에 전혀 없습니다.

## 9. Mapping Method Evaluation
- **A. 전용면적 ÷ 3.3058 (현재)**: UNSAFE (사용자 인지와 괴리됨, "약 25평" 표기 지속)
- **B. 전용면적 구간 Hardcoding (예: 84→34평)**: UNSAFE (단지마다 동일 84㎡라도 공용면적에 따라 32~35평으로 변동 심함. 오표기 위험)
- **C. SupplyArea 기반**: SAFE (가장 정확한 대표 평형. 단, 현재 데이터 없음)
- **D. Official Unit Type 기반**: SAFE (예: "112B" 주택형 정보 획득 시 112/3.3058 = 34평. 단, 현재 데이터 없음)

## 10. Data Gaps & Public Source Recommendation
- **Current Data Gap**: `supplyArea`(공급면적) 및 단지 내 전체 주택형 마스터 리스트 부재.
- **Public Data Candidates**:
  1. **건축물대장 (표제부/전유부)**: 정확한 면적 정보가 있으나 공동주택 주택형(Type) 묶음 처리가 복잡함.
  2. **K-apt (공동주택관리정보시스템)**: 단지별 주택형 및 면적 정보 제공 가능성 확인 필요.
  3. **국토부/부동산원 공동주택 기본정보 API**: 주택형별 공급/전용면적 정보 보유 가능성 검토.

## 11. Proposed Area Display Model V2
- 새로운 데이터 Source가 확보되면 다음과 같은 모델 도입을 권장합니다.
- **CanonicalArea (데이터 정합성)**: `exclusiveArea exact` (거래, 차트, 필터의 고유 식별자는 기존 전용면적 유지)
- **DisplayUnit (사용자 UI)**:
  ```json
  {
    "canonicalExclusiveArea": 84.79,
    "representativePyeong": 33,
    "supplyArea": 111.5,
    "officialType": "111A"
  }
  ```
- 평형 선택기에는 "최근 거래된 목록"이 아닌 "이 단지에 존재하는 **전체 DisplayUnit 목록**"을 노출하고, 거래 내역이 없으면 "최근 거래 없음"으로 처리합니다.

## 12. Decision & Next Recommendation
- **Decision**: CASE C (현재 데이터로 정확한 시장 대표 평형 매핑 불가능).
- **Next Step Recommendation**: `DATA SOURCE INTEGRATION` (공공데이터 API 등을 통해 `supplyArea`와 단지별 Type Master 정보를 수집/저장하는 파이프라인 선행 개발 필요).
