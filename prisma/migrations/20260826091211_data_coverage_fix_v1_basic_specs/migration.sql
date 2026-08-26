-- CreateEnum
CREATE TYPE "BasicSpecSource" AS ENUM ('BUILDINGHUB_GENERAL_TITLE', 'BUILDINGHUB_TITLE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "apartment_masters" ADD COLUMN     "basic_spec_source" "BasicSpecSource" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "building_coverage_ratio" DOUBLE PRECISION,
ADD COLUMN     "floor_area_ratio" DOUBLE PRECISION,
ADD COLUMN     "parking_per_household" DOUBLE PRECISION;
