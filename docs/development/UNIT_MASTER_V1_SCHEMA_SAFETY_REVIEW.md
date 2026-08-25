# UNIT MASTER V1 — SCHEMA SAFETY REVIEW

## 1. Executive Summary
이 문서는 직전 Unit Master V1 설계에서 도출된 잠재적 위험(Parent Identity의 불안정성, Nullable 필드를 포함한 Unique 제약조건 중복 가능성, Fallback UI 정책 등)을 사전 차단하기 위해 작성된 Schema Safety Review 문서입니다. DB Migration을 수행하기 전 필수적으로 점검해야 할 논리적, 물리적 제약사항과 수정된 원칙을 담고 있습니다.

## 2. Parent Identity 재검증
- **문제점**: 직전 설계에서 제안한 `aptSeq` Hard FK 방식은 다음과 같은 치명적 단점이 존재합니다.
  - `aptSeq`는 `ApartmentMaster`에서 Nullable입니다. (모든 단지가 보유하지 않음).
  - 외부 공공데이터 동기화 과정에서 `ApartmentMaster`가 Rebuild(TRUNCATE & Re-insert)될 가능성이 있으며, 이때 Hard FK 참조 무결성이 깨지거나 Orphan Row가 대량 발생합니다.
- **수정된 권장안**: **`Apartment.id` (Application Parent Identity)**
  - `Apartment` 모델은 사용자의 좋아요(Favorite), 환경설정(Preference) 등과 연결된 서비스 내 최상위 라이프사이클 엔티티로 Rebuild 되지 않는 가장 안전한 식별자입니다.
  - `aptSeq`나 `(lawdCd, dong, name)`는 데이터 파이프라인에서 매핑을 위한 보조키(Logical Mapping Key)로만 활용하며, Unit Master DB에는 `apartmentId` (Int, Hard FK)를 저장하는 것이 가장 안전합니다.

## 3. Building Registry Match Identity
- 건축물대장의 벌크 데이터를 이집 DB와 연결할 때는 **(시군구코드 + 법정동코드 + 지번)** 의 Exact Match를 수행하여 `Apartment`의 `id`를 획득한 후 적재합니다.
- Source Match Key(법정동+지번)와 Application Identity(`apartmentId`)를 명확히 분리하여, 단지 지번이 변경되거나 갱신되더라도 내부 Unit Master Relation은 유지되도록 합니다.

## 4. Unique Key Null 문제 해결
- **문제점**: `@@unique([apartmentId, canonicalExclusiveArea, supplyArea])` 적용 시, Prisma/PostgreSQL 특성상 `supplyArea`가 `NULL`인 Row는 여러 번 Insert 되어도 Unique Constraint 위반을 뱉지 않아 중복 데이터가 발생합니다.
- **수정된 권장안**:
  - `supplyArea`를 Unique Key에 직접 넣는 것을 금지합니다.
  - 대신 백필 파이프라인에서 Deterministic 한 String 타입의 **`variantKey`** (예: `"supply_111.50_type_84A"`, 없으면 `"default"`) 필드를 생성하여 
  - `@@unique([apartmentId, canonicalExclusiveArea, variantKey])` 형태로 고유 제약을 강제합니다.

## 5. Unit Variant Identity & Source Unit ID
- **Variant Identity**: `canonicalExclusiveArea`와 `variantKey`가 결합하여 개별 주택형을 식별합니다. 대표 평형(`representativePyeong`) 자체는 마케팅 용어이므로 Identity로 절대 사용하지 않습니다.
- **Source Unit ID**: 건축물대장의 개별 '전유부 PK'는 세대 단위이므로 타입 단위의 그룹핑 키로 쓸 수 없습니다. `sourceUnitId`는 `ApartmentUnitType` 레벨에서는 (법정동+지번+전용면적+공용면적 합산해시) 등의 파생된 Logical ID로 저장하거나, 아예 생략하고 `variantKey`로 대체합니다.

## 6. Official Type 처리
- 동일 전용면적, 동일 공급면적이나 청약홈 기준 `84A`, `84B`로 타입이 갈리는 경우가 있습니다.
- 이 경우 `variantKey`에 Official Type 명칭을 포함시켜 서로 다른 Row로 분리 적재합니다.
- 단, 실거래가(MOLIT Trade) 데이터는 `84A`, `84B`를 구분해주지 않으므로, 이집 시스템은 이를 임의로 배분(거짓 분배)하지 않고 UI에서 `84㎡ 공통 실거래가`로 Grouping 표기합니다.

## 7. Representative Pyeong 저장 구조
- `representativePyeong Int?` 형태로 저장하되, **출처(Provenance)** 상태를 반드시 동반합니다.
  - `OFFICIAL_LABEL`: 청약홈 등 공식 마케팅 라벨. (실제 시장명 보장)
  - `SUPPLY_AREA_DERIVED`: 건축물대장 공급면적 기반 수식 연산. (공식과 동일하다고 단정 금지)
  - `UNKNOWN`: 산출 불가.

## 8. Fallback 정책 수정 (중요)
- **과거 방식 전면 폐기**: `전용 84.79㎡ ÷ 3.3058 = 약 25.6평` 과 같이 전용면적을 평으로 단순히 쪼개어 보여주는 "가짜 대표 평형" 표기를 **완전 제거**합니다.
- **수정된 Fallback 규칙**:
  1. Unit Master O + Representative Pyeong O ➔ `33평 (전용 84.79㎡)`
  2. Unit Master O + Representative Pyeong X ➔ `전용 84.79㎡ (공급 xxx㎡)`
  3. Unit Master X (미구축 단지) ➔ `전용 84.79㎡` (단일 표기, "평" 노출 금지)

## 9. Full Unit List Selector
- **Unit Master가 있는 경우**: 거래 내역 유무와 무관하게 DB에 구축된 전체 Unit Type 목록 노출 (거래 없는 50평형 등 포함).
- **Unit Master가 없는 경우**: 기존처럼 최근 실거래가(Trade) 기반 고유 전용면적 목록을 임시 Fallback으로 사용하되, 라벨은 무조건 "전용 XX㎡"만 사용합니다.

## 10. Household Count 유의점
- 건축물대장의 전유부 집계 시 상가/부대복리시설/복층 등 비주거용 호수가 혼입될 위험이 있습니다. 파이프라인에서 '주거용' 용도 필터링을 철저히 하고, 정확도를 100% 보장할 수 없으므로 `householdCount`는 Nullable(`Int?`)을 유지합니다.

## 11. Area Aggregation Precision
- 자바스크립트의 Floating Point(예: 84.79)를 단순 `Math.round()`로 연산 시 그룹핑이 찢어지는 현상을 방지해야 합니다.
- **정책**: `decimal.js` 등 라이브러리를 활용하거나, 문자열(String) 정규화(예: 2자리 소수점 텍스트화)를 거친 뒤 Group By 키로 사용해야 84.79와 84.99가 절대 섞이지 않고, 84.789999와 84.79가 분리되는 오류를 막을 수 있습니다.

## 12. Minimum Schema Draft (Physical Migration 제안용)
```prisma
model ApartmentUnitType {
  id                         Int      @id @default(autoincrement())
  apartmentId                Int      @map("apartment_id") // Hard FK to Apartment.id
  
  // Identities
  canonicalExclusiveArea     Decimal  @map("canonical_exclusive_area")
  variantKey                 String   @map("variant_key") // "supply_111.5_type_84A" 형태
  
  // Unit Data
  supplyArea                 Decimal? @map("supply_area")
  representativePyeong       Int?     @map("representative_pyeong")
  representativePyeongSource String   @map("representative_pyeong_source") // Enum
  officialType               String?  @map("official_type")
  householdCount             Int?     @map("household_count")
  
  // Provenance
  source                     String   @map("source")
  
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @updatedAt
  
  // Relations
  apartment                  Apartment @relation(fields: [apartmentId], references: [id], onDelete: Cascade)
  
  @@unique([apartmentId, canonicalExclusiveArea, variantKey])
  @@index([apartmentId, canonicalExclusiveArea])
}
```

## 13. Migration Physical Changes & Safety
- **Migration 특성**: `ApartmentUnitType` 테이블 신규 생성 (Additive Only).
- **안전성 보장**: 기존 `Apartment`, `ApartmentMaster`, `Trade`, `Score` 스키마 및 데이터에는 일체의 구조 변경(Alter/Drop)이 없습니다. 

## 14. Regression Cases
- **대신롯데캐슬 (84.79 / 84.99)**:
  - `canonicalExclusiveArea`가 다르므로 서로 다른 주택형 Row로 적재 보장.
  - 84.79는 33평, 84.99는 34평으로 개별 `representativePyeong` 저장 가능.
- **Same Exclusive / Multiple Official Type**:
  - `84.99`에 `84A`, `84B`가 있다면 `variantKey` 덕분에 두 개의 Row로 분리 적재 보장.
- **Unit Master 없음**:
  - Fallback 룰에 따라 오류 없이 "전용면적" 텍스트 칩 생성 보장.
- **최근 36개월 거래 없는 대형 평형**:
  - Unit Master 기반으로 전체 목록을 불러오므로 Selector에 누락 없이 정상 노출 보장.

## 15. PM Decision Gate
다음 핵심 3가지 정책의 방향성 승인을 요청합니다.
1. **Parent Identity**: 외부 `aptSeq`가 아닌 내부 `Apartment.id`를 FK로 사용하여 외부 Rebuild 시에도 고아(Orphan) 데이터를 차단하는 방안.
2. **Unique Identity**: Null 문제를 회피하기 위해 파생 문자열인 `variantKey`를 Unique Constraint 구성요소로 도입하는 방안.
3. **Fallback Policy**: 전용면적을 평으로 변환(÷ 3.3058)해 보여주던 기존 UI를 **완전 제거**하고, 공식 데이터 부재 시 "전용면적"만 표시하는 가장 안전한 Fallback 정책.
