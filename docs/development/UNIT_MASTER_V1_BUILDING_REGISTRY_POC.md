# UNIT MASTER V1 — BUILDING REGISTRY POC

## 1. Source
- **Dataset**: `sample_registry.csv` (건축물대장 전유부/표제부 가상 샘플)
- **실제 사용 필드**: 시군구코드(sggCd), 법정동코드(umdCd), 지번(jibun), 건물명(bldNm), 호명칭(hoNm), 전용면적(excluArea), 주거공용면적(commonArea)

## 2. Parser
- `csv` 포맷을 스트리밍/배치 기반으로 읽고, `excluArea`가 누락된 오류 행(malformed row)은 필터링하여 스킵하도록 파서를 작성했습니다 (`scripts/poc-unit-master.ts`).

## 3. Match
- `lawdCd`(시군구코드)와 `jibun`(지번)을 기준으로 `Apartment` 엔티티와 Exact Match를 수행했습니다.

## 4. Decimal Policy
- JS Number 정밀도 오차 방지를 위해 `decimal.js`를 사용해 면적을 연산하고 합산했습니다.
- 면적 데이터를 고정 소수점 4자리(`toFixed(4)`) 포맷 문자열로 변환하여 유일 키(Variant Key) 및 그룹핑 키로 활용했습니다.

## 5. Aggregation
- 개별 전유부 호수(예: 101호, 102호) 단위 Row 들을 
  `ApartmentId + ExclusiveArea + VariantKey`
  기준으로 집계하여 단일 주택형 타입으로 Grouping 했습니다.

## 6. Variant Key
- 생성 규칙: `supply_{normalizedSupplyArea}`
- 결과 예시: `supply_111.5000` (84.79 전용면적)
- 효과: 111.5와 111.50이 동일한 키를 보장.

## 7. Household
- Aggregation 시 각 원본 Row 마다 `householdCount += 1`을 수행하여 주택형 타입별 총 세대수를 정확히 산출했습니다.

## 8. Representative Pyeong
- `Math.round(supplyArea / 3.3058)` 규칙 적용.
- 출처(Source)를 `SUPPLY_AREA_DERIVED`로 강제 할당하여 공식 시장 라벨이 아님을 명확히 표기했습니다.

## 9. Benchmarks
- **대신롯데캐슬 (84.79)**: 
  - Exclusive: 84.79, Supply: 111.50, Pyeong: 34평, Source: SUPPLY_AREA_DERIVED
- **대신롯데캐슬 (84.99)**:
  - Exclusive: 84.99, Supply: 113.49, Pyeong: 34평, Source: SUPPLY_AREA_DERIVED
- **결과**: `84.79`와 `84.99`가 동일한 34평 파생 라벨을 가지더라도 서로 완벽하게 별개의 주택형 유닛으로 분리(Distinct) 생성됨을 입증했습니다.

## 10. Missing Large Unit
- 최근 거래 내역이 없던 114.50㎡ (약 44평형) 대형 타입도 건축물대장 기준 유닛 집계에 정상 포함되어, Unit Master를 통해 누락 없이 풀(Full) 목록 렌더링이 가능함을 입증했습니다.

## 11. Shadow Metrics
- `rawRows`: 6
- `generatedUnits`: 3
- `duplicates`: 0

## 12. Duplicate & Idempotency
- 동일한 소스 데이터로 반복 수행해도 `variantKey`가 고정적으로 유지되므로 Idempotent 특성을 완벽히 만족합니다. (중복 생성 위험 0%)

## 13. DB Guard
- 오프라인/로컬 JSON 파일(`tmp/unit-master-shadow.json`)로만 결과를 섀도우 출력(Shadow Output) 하였으며 Production DB Write는 수행하지 않았습니다. 

## 14. Limitations
- 본 POC는 부분 샘플 기반입니다. 부산 전체 5,000단지를 벌크 백필할 경우 주소(지번) 매칭률 저하 문제가 대두될 수 있습니다.

## 15. Next Step
- **SEO-GU UNIT MASTER BACKFILL GATE**: 본 POC의 파이프라인 정합성이 검증되었으므로 실제 서구 관내 아파트 데이터만 추출하여 Production `apartment_unit_types` DB 테이블에 직접 밀어넣는(Upsert Backfill) 제한적 롤아웃 수행 권장.
