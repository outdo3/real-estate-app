-- CreateEnum
CREATE TYPE "RedevelopmentBusinessType" AS ENUM ('REDEVELOPMENT', 'RECONSTRUCTION', 'RESIDENTIAL_ENVIRONMENT', 'SMALL_RECONSTRUCTION', 'BLOCK_HOUSING', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RedevelopmentProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RedevelopmentLocationType" AS ENUM ('PROJECT_SITE', 'OFFICE', 'APPROXIMATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RedevelopmentLocationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RedevelopmentGeocodeStatus" AS ENUM ('NOT_ATTEMPTED', 'SUCCESS', 'AMBIGUOUS', 'FAILED');

-- CreateEnum
CREATE TYPE "RedevelopmentMatchConfidence" AS ENUM ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "RedevelopmentMergeStatus" AS ENUM ('AUTO_MATCHED', 'REVIEW_REQUIRED', 'MANUAL_MATCHED', 'UNMATCHED');

-- AlterEnum
BEGIN;
CREATE TYPE "RedevelopmentStage_new" AS ENUM ('PLANNED', 'ZONE_DESIGNATED', 'PROMOTION_COMMITTEE', 'ASSOCIATION_APPROVED', 'ARCHITECTURAL_REVIEW', 'PUBLIC_OPERATOR_DESIGNATED', 'PROJECT_IMPLEMENTATION_APPROVED', 'MANAGEMENT_DISPOSITION_APPROVED', 'RELOCATION_DEMOLITION', 'CONSTRUCTION', 'COMPLETED', 'TRANSFER_REGISTERED', 'DISSOLVED', 'CANCELLED', 'UNKNOWN');
ALTER TABLE "redevelopment_projects" ALTER COLUMN "stage" TYPE "RedevelopmentStage_new" USING ("stage"::text::"RedevelopmentStage_new");
ALTER TYPE "RedevelopmentStage" RENAME TO "RedevelopmentStage_old";
ALTER TYPE "RedevelopmentStage_new" RENAME TO "RedevelopmentStage";
DROP TYPE "RedevelopmentStage_old";
COMMIT;

-- AlterTable
ALTER TABLE "redevelopment_projects" DROP COLUMN "lawd_cd",
DROP COLUMN "polygon_geojson",
DROP COLUMN "target_households",
DROP COLUMN "zone_name",
ADD COLUMN     "business_type" "RedevelopmentBusinessType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "canonical_name" TEXT NOT NULL,
ADD COLUMN     "collected_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "geocode_source" TEXT,
ADD COLUMN     "geocode_status" "RedevelopmentGeocodeStatus",
ADD COLUMN     "household_count" INTEGER,
ADD COLUMN     "location_confidence" "RedevelopmentLocationConfidence",
ADD COLUMN     "location_type" "RedevelopmentLocationType",
ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "normalized_name" TEXT NOT NULL,
ADD COLUMN     "polygon_ref" TEXT,
ADD COLUMN     "polygon_source" TEXT,
ADD COLUMN     "primary_source" TEXT NOT NULL,
ADD COLUMN     "project_status" "RedevelopmentProjectStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "sido" TEXT NOT NULL,
ADD COLUMN     "sigungu" TEXT NOT NULL,
ADD COLUMN     "source_updated_at" TIMESTAMP(3),
ALTER COLUMN "stage" SET DEFAULT 'UNKNOWN',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "redevelopment_source_records" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "source_record_id" TEXT NOT NULL,
    "raw_name" TEXT NOT NULL,
    "raw_business_type" TEXT,
    "raw_business_type_code" TEXT,
    "raw_stage" TEXT,
    "raw_stage_code" TEXT,
    "raw_household_count" TEXT,
    "raw_location" TEXT,
    "raw_payload" JSONB,
    "match_confidence" "RedevelopmentMatchConfidence",
    "merge_status" "RedevelopmentMergeStatus" NOT NULL DEFAULT 'UNMATCHED',
    "source_updated_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redevelopment_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redevelopment_source_records_project_id_idx" ON "redevelopment_source_records"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "redevelopment_source_records_source_source_record_id_key" ON "redevelopment_source_records"("source", "source_record_id");

-- CreateIndex
CREATE INDEX "redevelopment_projects_sido_sigungu_idx" ON "redevelopment_projects"("sido", "sigungu");

-- CreateIndex
CREATE INDEX "redevelopment_projects_business_type_idx" ON "redevelopment_projects"("business_type");

-- CreateIndex
CREATE INDEX "redevelopment_projects_normalized_name_idx" ON "redevelopment_projects"("normalized_name");

-- AddForeignKey
ALTER TABLE "redevelopment_source_records" ADD CONSTRAINT "redevelopment_source_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "redevelopment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

