# UNIT MASTER V1 — FINAL MIGRATION GATE

## 1. Actual Apartment Model Audit
- **Apartment Lifecycle**: `Apartment` 모델은 사용자 좋아요, 관심단지 등 주요 비즈니스 도메인과 엮여 있는 핵심 엔티티입니다. 반면 `ApartmentMaster`는 외부 데이터(MOLIT 등)의 캐시/동기화 모델에 가깝습니다.
- **Apartment.id Stability**: `Apartment.id`는 `Int @id @default(autoincrement())`로 생성되며, 서비스 내에서 삭제나 Rebuild가 임의로 발생하지 않는 매우 **STABLE**한 식별자입니다.

## 2. FK Option Final Comparison
- **OPTION A 권장**: `Apartment.id FK` + `onDelete RESTRICT`.
- **평가**: `RESTRICT` 방식을 사용하면, `Apartment` 레코드를 실수로 삭제하려고 할 때 연관된 `ApartmentUnitType`이 있으면 DB 차원에서 오류를 뱉어 **Accidental Deletion(사고 삭제)을 방어**할 수 있습니다. `CASCADE`는 명시적 근거 없이 데이터 유실 위험을 키우므로 배제합니다.

## 3. Variant Key Principle & 6. Variant Key Options
- **Variant Identity**: `variantKey`는 한 번 생성되면(Enrichment 이후에도) 변경되지 않는 Deterministic한 값이어야 합니다.
- **Rule**: `supplyArea`를 기반으로 `supply_111.50`과 같은 포맷의 Non-null String을 생성합니다 (Option A: exclusive + supply). 
- `officialType` 등은 차후 업데이트(Enrichment) 될 수 있는 가변 데이터이므로 Identity Key 구성에서 배제합니다.

## 4. Official Type Enrichment
- 추후 청약홈 등에서 특정 공급면적이 `84A`임을 알아냈다면, 새로운 Row를 `INSERT`하는 것이 아니라 기존 `variantKey = 'supply_111.50'` Row를 `UPDATE`하여 기존 Identity를 안전하게 유지합니다.

## 5. Same Area / Different Official Type
- 전용면적과 공급면적이 모두 같은데 단순히 84A, 84B로 나뉘는 경우: 공공 데이터(건축물대장)에서 이 둘을 물리적으로 나눌 완벽한 근거가 없다면, 억지로 분리(거짓 정밀도)하지 않고 `officialType = '84A/84B'` 형태로 단일 Grouping을 유지합니다.

## 7. Null Supply Area
- `supplyArea`가 Null인 경우(데이터 유실 등), `variantKey = 'supply_unknown'`으로 매핑하여 Non-null Deterministic Key를 유지함으로써 무한 중복 생성을 원천 차단(Null-safe uniqueness)합니다.

## 8. Representative Pyeong
- `representativePyeong Int?`
- `representativePyeongSource` Enum: `OFFICIAL_LABEL`, `SUPPLY_AREA_DERIVED`, `UNKNOWN`. (UNKNOWN일 경우 `representativePyeong`은 반드시 `null` 저장).

## 9. Data Source Provenance
- Enum 도입 권장: `BUILDING_REGISTRY`, `PRESALE`, `MANUAL_VERIFIED`, `OTHER`.

## 10. Source Match Information
- 건축물대장 데이터와의 추적성 확보를 위해 `sourceMatchKey String?` (예: 법정동코드+지번 결합문자열)을 유지하되, 과도한 메타데이터 복제는 지양합니다.

## 11. Household Count & 12. Timestamps
- `householdCount Int?`: 주거용 계산이 불명확할 경우 `null` 허용.
- `createdAt`, `updatedAt` 최소 적용.

## 13. Final Prisma Draft
```prisma
enum PyeongProvenance {
  OFFICIAL_LABEL
  SUPPLY_AREA_DERIVED
  UNKNOWN
}

enum UnitDataSource {
  BUILDING_REGISTRY
  PRESALE
  MANUAL_VERIFIED
  OTHER
}

model ApartmentUnitType {
  id                         Int                @id @default(autoincrement())
  apartmentId                Int                @map("apartment_id")
  
  // Identities
  canonicalExclusiveArea     Decimal            @map("canonical_exclusive_area")
  variantKey                 String             @map("variant_key")
  
  // Data
  supplyArea                 Decimal?           @map("supply_area")
  representativePyeong       Int?               @map("representative_pyeong")
  representativePyeongSource PyeongProvenance   @default(UNKNOWN) @map("representative_pyeong_source")
  officialType               String?            @map("official_type")
  householdCount             Int?               @map("household_count")
  
  // Provenance
  source                     UnitDataSource     @map("source")
  sourceMatchKey             String?            @map("source_match_key")
  
  // Timestamps
  createdAt                  DateTime           @default(now())
  updatedAt                  DateTime           @updatedAt
  
  // Relations
  apartment                  Apartment          @relation(fields: [apartmentId], references: [id], onDelete: Restrict)
  
  @@unique([apartmentId, canonicalExclusiveArea, variantKey])
  @@index([apartmentId, canonicalExclusiveArea])
  @@map("apartment_unit_types")
}
```

## 14. Final SQL Draft
```sql
CREATE TYPE "PyeongProvenance" AS ENUM ('OFFICIAL_LABEL', 'SUPPLY_AREA_DERIVED', 'UNKNOWN');
CREATE TYPE "UnitDataSource" AS ENUM ('BUILDING_REGISTRY', 'PRESALE', 'MANUAL_VERIFIED', 'OTHER');

CREATE TABLE "apartment_unit_types" (
    "id" SERIAL NOT NULL,
    "apartment_id" INTEGER NOT NULL,
    "canonical_exclusive_area" DECIMAL(65,30) NOT NULL,
    "variant_key" TEXT NOT NULL,
    "supply_area" DECIMAL(65,30),
    "representative_pyeong" INTEGER,
    "representative_pyeong_source" "PyeongProvenance" NOT NULL DEFAULT 'UNKNOWN',
    "official_type" TEXT,
    "household_count" INTEGER,
    "source" "UnitDataSource" NOT NULL,
    "source_match_key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "apartment_unit_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "apartment_unit_types_apartment_id_canonical_exclusive_a_key" ON "apartment_unit_types"("apartment_id", "canonical_exclusive_area", "variant_key");

CREATE INDEX "apartment_unit_types_apartment_id_canonical_exclusive_area_idx" ON "apartment_unit_types"("apartment_id", "canonical_exclusive_area");

ALTER TABLE "apartment_unit_types" ADD CONSTRAINT "apartment_unit_types_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

## 15. Existing Table Impact
- **Physical Impact**: `NONE`. 기존 `Apartment`, `Trade` 테이블 등에는 어떠한 Alter 문도 실행되지 않습니다. (Prisma 레벨에서의 양방향 Relation 명시 추가만 존재).

## 16. Delete Safety
- `onDelete: RESTRICT`가 걸려 있으므로, Unit Type이 있는 `Apartment`를 강제로 지우려 시도하면 DB 엔진이 거부합니다. 

## 17. Backfill Upsert Key
- `Upsert Where`: `apartmentId_canonicalExclusiveArea_variantKey` Unique Index를 사용하여 Idempotent(멱등성)를 보장합니다. 몇 번을 재실행해도 중복 생성되지 않습니다.

## 18. Enrichment Update & 19. Label Correction
- 추후 공식 라벨이 발견되면, 기존 `canonicalExclusiveArea`와 `variantKey`가 일치하는 Row를 `UPDATE` 하여 `representativePyeong`, `representativePyeongSource`, `officialType`을 교체합니다.

## 20. Regression Result Expectations
- **대신롯데캐슬 84.79 / 84.99**: 고유 전용면적과 별도의 `variantKey(supply_111.5, supply_113.5)`를 가지므로 충돌 없이 2개의 Row로 명확히 적재.
- **Unit Master Missing**: 에러 없이 기존 Trade 데이터 기반 전용면적 표기로 Fallback.
- **Supply Area Null**: `variant_key = supply_unknown`으로 중복 없이 1개만 생성.

## 21. Migration Rollback
- 새 테이블만 추가하는 작업이므로 롤백 시 `DROP TABLE apartment_unit_types; DROP TYPE ...;` 만 실행하면 기존 데이터베이스는 100% 원상복구됩니다. 자동 DROP 롤백 스크립트는 운영 안전성을 위해 제공하지 않고 매뉴얼 처리합니다.

## 22. Migration Safety
- **ADDITIVE_ONLY = YES**. 기존 컬럼 삭제/수정 일절 없습니다.

## 23. Expected Row Scale
- 35k 행은 인덱스와 함께 저장해도 몇 MB에 불과하므로 쿼리나 스토리지에 무리를 주지 않습니다.

## 24. PM Approval Package
- **생성 테이블**: `apartment_unit_types`
- **생성 ENUM**: `PyeongProvenance`, `UnitDataSource`
- **FK / onDelete**: `Apartment.id` / `RESTRICT`
- **기존 데이터 영향**: 없음 (Additive Only)
- **Production Write**: 없음 (Migration 후 0 Rows)
