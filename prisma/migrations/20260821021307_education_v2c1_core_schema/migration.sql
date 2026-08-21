-- CreateEnum
CREATE TYPE "EducationDataQuality" AS ENUM ('COMPLETE', 'PARTIAL', 'STALE', 'IDENTITY_UNRESOLVED', 'COORDINATE_APPROX', 'SOURCE_ERROR');

-- CreateEnum
CREATE TYPE "DisclosureStatus" AS ENUM ('AVAILABLE', 'NOT_DISCLOSED', 'NOT_APPLICABLE', 'UNKNOWN', 'SOURCE_ERROR');

-- CreateEnum
CREATE TYPE "CoordinateType" AS ENUM ('OFFICIAL_POINT', 'ADDRESS_GEOCODE', 'ENTRANCE', 'CENTER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LegalReviewStatus" AS ENUM ('UNKNOWN', 'REVIEW_REQUIRED', 'CLEARED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IdentityConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "education_sources" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "provider" TEXT,
    "dataset_id" TEXT,
    "source_type" TEXT NOT NULL,
    "source_url" TEXT,
    "license_code" TEXT,
    "attribution_required" BOOLEAN NOT NULL DEFAULT true,
    "commercial_use_allowed" BOOLEAN,
    "modification_allowed" BOOLEAN,
    "legal_review_status" "LegalReviewStatus" NOT NULL DEFAULT 'UNKNOWN',
    "terms_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schools" (
    "id" SERIAL NOT NULL,
    "neis_school_code" TEXT,
    "school_name" TEXT NOT NULL,
    "school_level" TEXT,
    "establishment_type" TEXT,
    "gender_type" TEXT,
    "address" TEXT,
    "road_address" TEXT,
    "sido_code" TEXT,
    "sigungu_code" TEXT,
    "dong_name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coordinate_source" TEXT,
    "coordinate_type" "CoordinateType" NOT NULL DEFAULT 'UNKNOWN',
    "phone" TEXT,
    "homepage" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_stats" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "reference_year" INTEGER NOT NULL,
    "disclosure_year" INTEGER,
    "reference_date" TIMESTAMP(3),
    "student_count" INTEGER,
    "class_count" INTEGER,
    "teacher_count" INTEGER,
    "grade_breakdown" JSONB,
    "source_id" INTEGER NOT NULL,
    "source_record_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "disclosure_status" "DisclosureStatus" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kindergartens" (
    "id" SERIAL NOT NULL,
    "official_code" TEXT,
    "kindergarten_name" TEXT NOT NULL,
    "establishment_type" TEXT,
    "address" TEXT,
    "road_address" TEXT,
    "sido_code" TEXT,
    "sigungu_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coordinate_source" TEXT,
    "coordinate_type" "CoordinateType" NOT NULL DEFAULT 'UNKNOWN',
    "identity_confidence" "IdentityConfidence" NOT NULL DEFAULT 'LOW',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kindergartens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kindergarten_stats" (
    "id" SERIAL NOT NULL,
    "kindergarten_id" INTEGER NOT NULL,
    "reference_year" INTEGER NOT NULL,
    "reference_date" TIMESTAMP(3),
    "capacity" INTEGER,
    "enrollment" INTEGER,
    "class_count" INTEGER,
    "staff_count" INTEGER,
    "age_breakdown" JSONB,
    "has_shuttle" BOOLEAN,
    "has_after_school" BOOLEAN,
    "source_id" INTEGER NOT NULL,
    "source_record_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "disclosure_status" "DisclosureStatus" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kindergarten_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "childcares" (
    "id" SERIAL NOT NULL,
    "facility_code" TEXT NOT NULL,
    "childcare_name" TEXT NOT NULL,
    "facility_type" TEXT,
    "address" TEXT,
    "road_address" TEXT,
    "sido_code" TEXT,
    "sigungu_code" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "coordinate_source" TEXT,
    "coordinate_type" "CoordinateType" NOT NULL DEFAULT 'UNKNOWN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "childcares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "childcare_stats" (
    "id" SERIAL NOT NULL,
    "childcare_id" INTEGER NOT NULL,
    "reference_date" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "enrollment" INTEGER,
    "staff_count" INTEGER,
    "cctv_count" INTEGER,
    "has_shuttle" BOOLEAN,
    "source_id" INTEGER NOT NULL,
    "source_record_id" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "quality_flag" "EducationDataQuality" NOT NULL DEFAULT 'COMPLETE',
    "disclosure_status" "DisclosureStatus" NOT NULL DEFAULT 'UNKNOWN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "childcare_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "education_sources_code_key" ON "education_sources"("code");

-- CreateIndex
CREATE UNIQUE INDEX "schools_neis_school_code_key" ON "schools"("neis_school_code");

-- CreateIndex
CREATE INDEX "schools_sido_code_sigungu_code_idx" ON "schools"("sido_code", "sigungu_code");

-- CreateIndex
CREATE INDEX "schools_school_level_idx" ON "schools"("school_level");

-- CreateIndex
CREATE INDEX "school_stats_school_id_idx" ON "school_stats"("school_id");

-- CreateIndex
CREATE INDEX "school_stats_source_id_idx" ON "school_stats"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_stats_school_id_source_id_reference_year_key" ON "school_stats"("school_id", "source_id", "reference_year");

-- CreateIndex
CREATE UNIQUE INDEX "kindergartens_official_code_key" ON "kindergartens"("official_code");

-- CreateIndex
CREATE INDEX "kindergartens_sido_code_sigungu_code_idx" ON "kindergartens"("sido_code", "sigungu_code");

-- CreateIndex
CREATE INDEX "kindergarten_stats_kindergarten_id_idx" ON "kindergarten_stats"("kindergarten_id");

-- CreateIndex
CREATE INDEX "kindergarten_stats_source_id_idx" ON "kindergarten_stats"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "kindergarten_stats_kindergarten_id_source_id_reference_year_key" ON "kindergarten_stats"("kindergarten_id", "source_id", "reference_year");

-- CreateIndex
CREATE UNIQUE INDEX "childcares_facility_code_key" ON "childcares"("facility_code");

-- CreateIndex
CREATE INDEX "childcares_sido_code_sigungu_code_idx" ON "childcares"("sido_code", "sigungu_code");

-- CreateIndex
CREATE INDEX "childcare_stats_childcare_id_idx" ON "childcare_stats"("childcare_id");

-- CreateIndex
CREATE INDEX "childcare_stats_source_id_idx" ON "childcare_stats"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "childcare_stats_childcare_id_source_id_reference_date_key" ON "childcare_stats"("childcare_id", "source_id", "reference_date");

-- AddForeignKey
ALTER TABLE "school_stats" ADD CONSTRAINT "school_stats_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_stats" ADD CONSTRAINT "school_stats_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "education_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kindergarten_stats" ADD CONSTRAINT "kindergarten_stats_kindergarten_id_fkey" FOREIGN KEY ("kindergarten_id") REFERENCES "kindergartens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kindergarten_stats" ADD CONSTRAINT "kindergarten_stats_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "education_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "childcare_stats" ADD CONSTRAINT "childcare_stats_childcare_id_fkey" FOREIGN KEY ("childcare_id") REFERENCES "childcares"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "childcare_stats" ADD CONSTRAINT "childcare_stats_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "education_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
