-- CreateTable
CREATE TABLE "apartment_masters" (
    "id" SERIAL NOT NULL,
    "apt_seq" TEXT,
    "mgm_bldrgst_pk" TEXT,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "sido" TEXT,
    "sigungu" TEXT,
    "sgg_cd" TEXT,
    "umd_name" TEXT,
    "umd_cd" TEXT,
    "jibun" TEXT,
    "road_address" TEXT,
    "jibun_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geocode_quality" TEXT,
    "build_year" INTEGER,
    "use_approval_date" TEXT,
    "main_building_count" INTEGER,
    "total_households" INTEGER,
    "parking_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_masters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apartment_masters_apt_seq_key" ON "apartment_masters"("apt_seq");

-- CreateIndex
CREATE INDEX "apartment_masters_sgg_cd_idx" ON "apartment_masters"("sgg_cd");

-- CreateIndex
CREATE INDEX "apartment_masters_normalized_name_idx" ON "apartment_masters"("normalized_name");

-- CreateIndex
CREATE INDEX "apartment_masters_umd_cd_jibun_idx" ON "apartment_masters"("umd_cd", "jibun");
