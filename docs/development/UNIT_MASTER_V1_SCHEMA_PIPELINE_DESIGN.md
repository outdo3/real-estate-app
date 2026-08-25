# UNIT MASTER V1 — SCHEMA & PIPELINE DESIGN

## 1. Executive Summary
이 문서에서는 최근 거래 내역에 의존하지 않고 단지 내 전체 평형(Unit Type) 목록과 정확한 시장 대표 평형(Representative Pyeong)을 제공하기 위한 **Unit Master V1**의 논리적 스키마와 백필(Backfill) 파이프라인을 설계합니다.

## 2. Requirements
- **A.** 최근 거래가 없어도 단지의 모든 주택형(Unit Type)을 UI 선택기에 제공.
- **B.** 사용자 친화적인 시장 대표 평형(예: 34평) 산출 및 제공.
- **C.** 실거래가 매핑을 위한 정확한 전용면적(Canonical `exclusiveArea`) 유지.
- **D.** 공급면적(`supplyArea`), 타입별 세대수(`householdCount`), 공식 주택형(`officialType`) 저장.
- **E.** 데이터 출처(Provenance)의 명확한 상태 관리.

## 3. Existing Identity
- **Apartment**: `(lawdCd, dong, name)` 복합 키 사용 중.
- **ApartmentMaster**: `aptSeq` (국토부 단지 일련번호) 단일 고유 키 사용.
- **Trade**: `aptSeq` (또는 단지명 매핑) + `exclusiveArea`.
- **결정**: Unit Master의 부모 식별자(Parent Identity)는 가장 안정적이고 공공데이터와 연계하기 쉬운 **`ApartmentMaster.aptSeq`**를 Hard FK로 사용합니다.

## 4. Building Registry Link
- 건축물대장(표제부/전유부) 원본 데이터와 `ApartmentMaster`의 연결은 **법정동코드(sggCd+umdCd) + 지번(jibun)**의 Exact Match를 사용합니다.
- 동명(단지명) 기반의 Fuzzy Matching은 동명이단지(예: 롯데캐슬 1차/2차) 오류를 방지하기 위해 Primary Linkage에서 엄격히 배제합니다.

## 5. Schema Options
- **OPTION A (Flat)**: 단일 `ApartmentUnitType` 테이블에 모든 정보를 평면화. (조회 성능 우수, 구현 단순)
- **OPTION B (Group+Variant)**: `ApartmentUnitGroup`(전용면적 단위) + `ApartmentUnitVariant`(공급면적/타입 단위) 분리. (정규화되나 Trade 조인 시 복잡도 증가)
- **OPTION C (JSON)**: `ApartmentMaster`에 JSON Snapshot 추가. (부분 갱신 및 집계 쿼리 불가)
- **권장 (V1)**: **OPTION A (Flat)**. 향후 확장성을 해치지 않으며 백필 및 조회 쿼리가 직관적입니다.

## 6. Recommended Model (Option A)
```prisma
model ApartmentUnitType {
  id                         Int      @id @default(autoincrement())
  aptSeq                     String   @map("apt_seq")
  canonicalExclusiveArea     Decimal  @map("canonical_exclusive_area")
  supplyArea                 Decimal? @map("supply_area")
  representativePyeong       Int?     @map("representative_pyeong")
  representativePyeongSource String   @map("representative_pyeong_source") // Enum
  officialType               String?  @map("official_type")
  householdCount             Int?     @map("household_count")
  
  source                     String   @map("source")
  sourceUnitId               String?  @map("source_unit_id")
  
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
  
  @@unique([aptSeq, canonicalExclusiveArea, supplyArea])
  @@index([aptSeq])
}
```

## 7. Field Definitions
- `aptSeq`: 부모 단지 식별자 (필수)
- `canonicalExclusiveArea`: 실거래 매핑을 위한 Exact 전용면적 (필수)
- `supplyArea`: 공급면적 (권장)
- `representativePyeong`: 산출된 대표 평형 (선택)
- `representativePyeongSource`: 신뢰도(출처) 상태 표기 (필수)
- `officialType`: 마케팅용 주택형, 예: 84A (선택)
- `householdCount`: 해당 타입의 총 세대수 (선택)

## 8. Decimal Policy
- 면적(`canonicalExclusiveArea`, `supplyArea`)은 반드시 **Prisma `Decimal`** 타입을 사용합니다.
- `Float` 사용 시 IEEE 754 부동소수점 오차(예: 84.79 -> 84.7899999)로 인해 실거래가 `exact match`가 실패하거나 고유 키 제약 조건을 위반할 위험이 큽니다.

## 9. Unique Identity
- 한 단지 내 타입의 고유성 보장: `@@unique([aptSeq, canonicalExclusiveArea, supplyArea])`
- 동일한 전용면적이라도 공급면적이 다르면 서로 다른 타입으로 간주합니다.

## 10. Same-Exclusive Variants
- 전용면적이 같으나 공급면적이 다른 타입(예: 84.99 전용인데 공급 112㎡, 114㎡ 두 개 존재)은 **별도의 Row**로 저장됩니다.
- UI에서는 이들을 각각 개별 평형(예: 34평, 35평)으로 선택할 수 있게 노출합니다.

## 11. Representative Pyeong
- DB에 계산된 숫자(Int)로 영구 저장(Materialized)합니다. 런타임 연산 부하를 줄이고, 나중에 84A 같은 공식 라벨이 수집되면 해당 Row만 덮어쓰기 용이하도록 설계합니다.

## 12. Provenance (Pyeong Source Enum)
- `OFFICIAL_LABEL`: 청약홈 등 마케팅 브로셔 기준 검증 완료.
- `SUPPLY_AREA_DERIVED`: 건축물대장 공급면적 기준 반올림 산출(`round(supplyArea / 3.3058)`).
- `UNKNOWN`: 공급면적 부재로 산출 불가.

## 13. Trade Linking
- **Edge Case (1 Exclusive -> Multiple Variants)**:
  - MOLIT 실거래가에는 '공급면적' 정보가 없습니다. 따라서 전용 `84.99` 거래가 발생했을 때, 이것이 공급 `112㎡`인지 `114㎡`인지 **정확히 분배할 수 없습니다.**
  - **정책**: Trade 데이터는 특정 Unit Type과 직접 1:1 FK 매핑하지 않습니다. UI/API 단에서 `canonicalExclusiveArea`를 기준으로 "해당 전용면적 공통 거래"로 Grouping 하여 보여주는 논리적 연결 방식을 채택합니다 (거짓 분배 금지).

## 14. Fallback
- V1 배포 직후 모든 단지가 Unit Master를 갖추진 못합니다.
- Unit Master 데이터가 없는 단지는 **현재의 기존 UI(전용면적 표시 및 "약 xx평" 자동 렌더링)** 로 우회(Fallback)하도록 설계하여 장애를 차단합니다.

## 15. Backfill Pipeline
1. **Raw Ingestion**: 건축물대장 전유부 텍스트 벌크 다운로드.
2. **Filter**: 부산광역시 관할 데이터만 추출.
3. **Identity Match**: 법정동코드+지번으로 `ApartmentMaster`와 조인 (Unmatched는 Shadow Log로 분리).
4. **Aggregation**: 세대 단위 Row를 `전용면적+공용면적` 단위로 `GROUP BY` 및 세대수 `COUNT`.
5. **Validation**: `supplyArea >= exclusiveArea` 등 규칙 검사.
6. **DB Upsert**: `ApartmentUnitType` 테이블에 일괄 적재.

## 16. Aggregation
- 개별 세대(전유부) Row -> Unit Type 합칠 때: `Math.round((exclusive + common) * 10000) / 10000` 처럼 정밀도 보정 후 Grouping.

## 17. Validation Rules
- `supplyArea` >= `canonicalExclusiveArea`
- `householdCount` > 0
- 단지별 집계된 `SUM(householdCount)` 가 `ApartmentMaster.totalHouseholds`와 오차율 ±5% 이내인지 (경고성 로깅).

## 18. Regression Benchmarks
- **대신롯데캐슬**: 84.79(33평), 84.99(34평) 분리 적재 성공 여부.
- **구덕금호 / 협성르네상스**: 구축 단지 매핑 성공 여부.
- **대신해모센트럴**: 복합 평형 존재 시 누락 여부.

## 19. Rollout
- Phase 1: 스크립트를 통한 오프라인 Shadow JSON/CSV 추출.
- Phase 2: 서구(Seo-gu) 아파트 Subset 만 DB Upsert 및 QA.
- Phase 3: 부산 전체 DB Upsert.

## 20. QA Metrics
- Matched/Unmatched 단지 비율.
- 파생된 평형명(SUPPLY_AREA_DERIVED)과 실거래가 API 매핑률 비교.

## 21. Index/Size
- 부산 전체 아파트 약 5,000개 × 평균 7개 타입 = 약 **35,000 Rows** 예상.
- Index: 부모 조인을 위한 `@@index([aptSeq])` 및 실거래 매칭용 `@@index([aptSeq, canonicalExclusiveArea])` 추가 고려.

## 22. API Contract
```json
{
  "units": [
    {
      "canonicalExclusiveArea": 84.79,
      "supplyArea": 111.5,
      "representativePyeong": 33,
      "provenance": "SUPPLY_AREA_DERIVED",
      "officialType": null,
      "householdCount": 381
    }
  ]
}
```

## 23. UI Contract
- Selector 내 표기: `33평 (전용 84.79㎡) - 381세대`

## 24. Future Types
- 테이블명 `ApartmentUnitType`은 V1 목적에 적합합니다. 추후 오피스텔(Officetel) 확장이 필요하면 `PropertyUnitType`으로 Rename 하거나, 다형성을 지원할 수 있으므로 선제적 과설계는 피합니다.

## 25. Migration Safety
- 새로운 `ApartmentUnitType` 모델을 추가(Additive)하는 것일 뿐, 기존 `Apartment`, `ApartmentMaster`, `Trade` 등 기존 테이블과 로직을 일절 훼손하지 않습니다.

## 26. PM Decision Points
- **Schema Option**: Flat 모델(Option A) 수용 여부.
- **Unique Key**: `[aptSeq, canonicalExclusiveArea, supplyArea]` 기반의 식별 허용 여부.
- **Trade Linkage Rule**: "MOLIT 거래 내역은 개별 주택형이 아닌 동일 전용면적 그룹에 공통 할당한다"는 기조 수용 여부.

## 27. Recommended Next Step
- **UNIT MASTER V1 MIGRATION GATE**: 설계가 승인되면 실제 `schema.prisma`를 변경하고 Migration 스크립트를 생성합니다.
