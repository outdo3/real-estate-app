-- CreateTable
CREATE TABLE "officetel_masters" (
    "id" SERIAL NOT NULL,
    "canonical_key" TEXT NOT NULL,
    "sgg_cd" TEXT NOT NULL,
    "umd_nm" TEXT NOT NULL,
    "normalized_umd_nm" TEXT NOT NULL,
    "jibun" TEXT NOT NULL,
    "normalized_jibun" TEXT NOT NULL,
    "building_dong" TEXT,
    "normalized_building_dong" TEXT,
    "officetel_name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "build_year" INTEGER,
    "building_registry_main_purpose" TEXT,
    "building_registry_etc_purpose" TEXT,
    "use_approval_date" TEXT,
    "ho_cnt" INTEGER,
    "total_area" DECIMAL(65,30),
    "building_coverage_ratio" DOUBLE PRECISION,
    "floor_area_ratio" DOUBLE PRECISION,
    "structure_name" TEXT,
    "ground_floor_count" INTEGER,
    "underground_floor_count" INTEGER,
    "indoor_mechanical_parking" INTEGER,
    "indoor_auto_parking" INTEGER,
    "outdoor_mechanical_parking" INTEGER,
    "outdoor_auto_parking" INTEGER,
    "road_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officetel_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officetel_trade_histories" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MOLIT_OFFI_TRADE',
    "officetel_master_id" INTEGER,
    "canonical_key" TEXT NOT NULL,
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "umd_nm" TEXT NOT NULL,
    "jibun" TEXT NOT NULL,
    "offi_nm" TEXT NOT NULL,
    "exclusive_area" DECIMAL(65,30) NOT NULL,
    "deal_amount" INTEGER NOT NULL,
    "deal_year" INTEGER NOT NULL,
    "deal_month" INTEGER NOT NULL,
    "deal_day" INTEGER NOT NULL,
    "deal_date" DATE NOT NULL,
    "floor" INTEGER NOT NULL,
    "build_year" INTEGER,
    "dealing_gbn" TEXT,
    "buyer_gbn" TEXT,
    "seller_gbn" TEXT,
    "estate_agent_sgg_nm" TEXT,
    "deal_canceled" BOOLEAN NOT NULL DEFAULT false,
    "cancel_date" TEXT,
    "occurrence_index" INTEGER NOT NULL DEFAULT 0,
    "source_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officetel_trade_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "officetel_rent_histories" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MOLIT_OFFI_RENT',
    "officetel_master_id" INTEGER,
    "canonical_key" TEXT NOT NULL,
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "umd_nm" TEXT NOT NULL,
    "jibun" TEXT NOT NULL,
    "offi_nm" TEXT NOT NULL,
    "exclusive_area" DECIMAL(65,30) NOT NULL,
    "deposit" INTEGER NOT NULL,
    "monthly_rent" INTEGER NOT NULL,
    "deal_year" INTEGER NOT NULL,
    "deal_month" INTEGER NOT NULL,
    "deal_day" INTEGER NOT NULL,
    "deal_date" DATE NOT NULL,
    "floor" INTEGER NOT NULL,
    "build_year" INTEGER,
    "contract_term" TEXT,
    "contract_type" TEXT,
    "pre_deposit" INTEGER,
    "pre_monthly_rent" INTEGER,
    "use_renewal_right" BOOLEAN,
    "occurrence_index" INTEGER NOT NULL DEFAULT 0,
    "source_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "officetel_rent_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "officetel_masters_canonical_key_key" ON "officetel_masters"("canonical_key");

-- CreateIndex
CREATE INDEX "officetel_masters_sgg_cd_normalized_umd_nm_normalized_jibun_idx" ON "officetel_masters"("sgg_cd", "normalized_umd_nm", "normalized_jibun");

-- CreateIndex
CREATE INDEX "officetel_masters_normalized_name_idx" ON "officetel_masters"("normalized_name");

-- CreateIndex
CREATE INDEX "officetel_trade_histories_canonical_key_deal_date_idx" ON "officetel_trade_histories"("canonical_key", "deal_date");

-- CreateIndex
CREATE INDEX "officetel_trade_histories_lawd_cd_deal_date_idx" ON "officetel_trade_histories"("lawd_cd", "deal_date");

-- CreateIndex
CREATE UNIQUE INDEX "officetel_trade_histories_canonical_key_deal_date_exclusive_key" ON "officetel_trade_histories"("canonical_key", "deal_date", "exclusive_area", "deal_amount", "floor", "occurrence_index");

-- CreateIndex
CREATE INDEX "officetel_rent_histories_canonical_key_deal_date_idx" ON "officetel_rent_histories"("canonical_key", "deal_date");

-- CreateIndex
CREATE INDEX "officetel_rent_histories_lawd_cd_deal_date_idx" ON "officetel_rent_histories"("lawd_cd", "deal_date");

-- CreateIndex
CREATE UNIQUE INDEX "officetel_rent_histories_canonical_key_deal_date_exclusive__key" ON "officetel_rent_histories"("canonical_key", "deal_date", "exclusive_area", "deposit", "monthly_rent", "floor", "occurrence_index");

-- AddForeignKey
ALTER TABLE "officetel_trade_histories" ADD CONSTRAINT "officetel_trade_histories_officetel_master_id_fkey" FOREIGN KEY ("officetel_master_id") REFERENCES "officetel_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officetel_rent_histories" ADD CONSTRAINT "officetel_rent_histories_officetel_master_id_fkey" FOREIGN KEY ("officetel_master_id") REFERENCES "officetel_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

