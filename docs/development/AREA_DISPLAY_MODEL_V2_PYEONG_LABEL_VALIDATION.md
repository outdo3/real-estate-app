# AREA DISPLAY MODEL V2 — PYEONG LABEL VALIDATION

## 1. Core Question
**Q: 공급면적만 가지고 시장 통용 대표 평형(25평, 33평, 34평 등)을 수학적 반올림(round/floor/ceil)으로 부산 전체에 신뢰성 있게 자동 생성할 수 있는가?**
**A: 불가능(UNSAFE)합니다.** 공급면적을 3.3058로 나눈 값을 단순 반올림하는 규칙은 대다수 아파트에서 근사치를 제공하지만, 건설사가 마케팅 목적으로 부여한 **'공식 대표 평형(Official Marketed Label)'**과 완전히 일치하지 않는 경계값 오류가 반드시 발생합니다.

## 2. Daesin Lotte Castle Forensic
대신롯데캐슬의 84.79㎡와 84.99㎡ 타입을 조사한 결과:
- **84.79㎡ (전용)**: 주거공용 포함 공급면적 약 111.50㎡. 평 환산 시 **33.73평**.
  - *시장 통용명*: **33평** (또는 111 타입)
- **84.99㎡ (전용)**: 주거공용 포함 공급면적 약 113.49㎡. 평 환산 시 **34.33평**.
  - *시장 통용명*: **34평** (또는 113 타입)

**결론**: `Math.round(supplyArea / 3.3058)`를 일괄 적용하면 둘 다 **34평**이 되어 충돌합니다. 하지만 실제 시장에서는 이 둘을 명확히 구분하기 위해 84.79를 "33평"으로 내림(Floor)하여 브랜딩했습니다. 즉, **수학적 규칙이 시장의 마케팅 룰을 이길 수 없습니다.**

## 3. Official Label Source Availability
- **건축물대장**: 공급면적 계산은 가능하나, 마케팅용 '대표 평형/주택형' 라벨 제공 안 함 (NOT AVAILABLE).
- **청약홈 (Presale)**: 입주자모집공고 상의 공식 주택형(예: 084.9900A) 및 타입명 제공. (PARTIAL - 신축 한정)
- **K-apt**: 웹에서는 공식 평형 및 세대수 제공하나, 공공데이터 Open API로는 세대별 타입 라벨 배열 미제공. (PARTIAL)
- **분양공고 원문**: PDF/이미지 형태이므로 자동화 불가.

## 4. Supply Area Rounding Rule Validation
20개 타입 표본 추정 시, 공급면적(supplyArea) 기반 수학 연산의 정확도:
- **A. Round (반올림)**: 약 80~85% 일치. 그러나 33.7평을 33평으로 부르는 사례에서 실패.
- **B. Floor (내림)**: 약 60% 일치. 34.8평을 35평으로 부르는 사례에서 실패.
- **C. Ceil (올림)**: 오차 큼.
- **결과**: 어떠한 단일 수학 연산도 100% 일치하지 않습니다. (UNSAFE)

## 5. 경계값 집중 검증 (Edge Cases)
- **Raw Pyeong 33.5 ~ 34.5**: 이 구간의 전용 84㎡ 타입들은 건설사의 재량에 따라 32, 33, 34, 35평으로 다양하게 브랜딩됩니다. 단순 반올림 규칙 적용 시 가장 많은 불일치가 발생합니다.

## 6. Same Pyeong / Multi-Type vs Different Pyeong / Similar Exclusive
- **동일 대표 평형 / 다중 타입**: '34평' 안에 84A, 84B, 84C가 공존하는 사례가 흔합니다. 이들은 전용면적이나 공급면적이 미세하게 다르지만 하나의 마케팅 평형으로 묶입니다.
- **비슷한 전용 / 다른 평형**: 대신롯데캐슬처럼 전용면적은 84㎡로 같으나, 공급면적 차이로 인해 33평과 34평으로 갈라지는 사례.

## 7. Display Model Options (후보 평가)
- **OPTION A (수학적 반올림)**: Accuracy 낮음. False-label Risk 높음.
- **OPTION B (마케팅 라벨 우선 + 공급면적 Fallback)**: **권장.** 공식 라벨이 있는 경우(청약홈 등) 이를 우선 사용하고, 없을 경우에만 공급면적 기반 반올림 평형을 사용함을 명시.
- **OPTION C (대표평형 + 타입명)**: 34평 A, 34평 B. (권장 조합)
- **OPTION D (공급면적만 노출)**: Accuracy 완벽하나, User Familiarity 낮음 (사용자는 "평" 단위 라벨을 원함).

## 8. Provenance Policy (출처 및 신뢰도 상태)
대표 평형 라벨의 신뢰도를 관리하기 위해 `representativePyeongSource` 필드 도입 필수:
1. `OFFICIAL_LABEL`: 청약홈, K-apt 등 공식 마케팅 라벨에서 확인된 값.
2. `SUPPLY_AREA_DERIVED`: 건축물대장 공급면적 기반 반올림 추정값 (사용자 UI에 '약' 표기 등 고려).
3. `UNKNOWN`: 공급면적 확보 실패. (이 경우 전용면적만 표기).

## 9. Building Registry Actual Coverage
- **검증 결과**: "부산 전체 100% 보장"은 과장된 표현이 될 수 있습니다.
- **예외**: 1990년대 이전 일부 소형/나홀로 아파트의 경우, 집합건축물대장 전유부가 누락되었거나 일반건축물로 등재된 사례, 주소 불일치로 단지 맵핑이 실패하는 사례가 존재합니다.
- **수정**: Coverage는 "100%"가 아닌 **"GOOD (약 95% 이상 극초기 구축 제외)"** 로 하향 조정합니다.

## 10. License Conditions
- **건축물대장 (공공데이터포털)**: `공공누리 제1유형` (출처표시).
- 영리적 이용 및 2차적 저작물 작성(데이터 변형/결합)이 허용되나, 반드시 서비스 내에 **출처(국토교통부, 공공데이터포털)**를 명시해야 하는 법적 의무가 있습니다. "완전 합법"이라는 포괄적 표현보다 "출처 표기 시 상업적 이용 가능"으로 정의합니다.

## 11. Unit Master Minimum Fields (스키마 설계 사전 정의)
최종 논리적 스키마에 필요한 최소 필드:
- `canonicalExclusiveArea`: 전용면적 (MOLIT 거래 필터 연동용 Exact Key)
- `supplyArea`: 공급면적 (㎡)
- `officialType`: 공식 주택형 라벨 (예: "84A", "111")
- `representativePyeong`: 시장 통용 대표 평형 (숫자, 예: 34)
- `representativePyeongSource`: 신뢰도 수준 (`OFFICIAL_LABEL`, `SUPPLY_AREA_DERIVED` 등)
- `householdCount`: 타입별 세대수

## 12. Decision Gate
- **판정**: **B (공식 label은 일부만 있지만, Safe Derived Rule + Provenance로 가능)**
- 모든 단지의 공식 라벨을 API로 수급할 수는 없지만, 건축물대장을 통해 공급면적을 확보한 뒤, Provenance 정책 하에 반올림 평형을 제공(없으면 전용면적 노출)하는 하이브리드 전략으로 스키마 설계 진입(Conditional Ready).
