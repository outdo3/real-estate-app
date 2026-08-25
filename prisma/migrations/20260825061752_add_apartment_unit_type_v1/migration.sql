-- CreateEnum
CREATE TYPE "PyeongProvenance" AS ENUM ('OFFICIAL_LABEL', 'SUPPLY_AREA_DERIVED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UnitDataSource" AS ENUM ('BUILDING_REGISTRY', 'PRESALE', 'MANUAL_VERIFIED', 'OTHER');

-- CreateTable
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

-- CreateIndex
CREATE INDEX "apartment_unit_types_apartment_id_canonical_exclusive_area_idx" ON "apartment_unit_types"("apartment_id", "canonical_exclusive_area");

-- CreateIndex
CREATE UNIQUE INDEX "apartment_unit_types_apartment_id_canonical_exclusive_area__key" ON "apartment_unit_types"("apartment_id", "canonical_exclusive_area", "variant_key");

-- AddForeignKey
ALTER TABLE "apartment_unit_types" ADD CONSTRAINT "apartment_unit_types_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
