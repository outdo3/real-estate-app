-- CreateTable
CREATE TABLE "apartment_rent_histories" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MOLIT_APT_RENT',
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "apt_seq" TEXT,
    "identity_key" TEXT NOT NULL,
    "deal_type" TEXT NOT NULL,
    "group_key" TEXT NOT NULL,
    "apt_name" TEXT NOT NULL,
    "dong" TEXT NOT NULL,
    "jibun" TEXT,
    "exclusive_area" DECIMAL(65,30) NOT NULL,
    "deposit" INTEGER NOT NULL,
    "monthly_rent" INTEGER NOT NULL,
    "deal_year" INTEGER NOT NULL,
    "deal_month" INTEGER NOT NULL,
    "deal_day" INTEGER NOT NULL,
    "deal_date" DATE NOT NULL,
    "floor" INTEGER,
    "build_year" INTEGER,
    "contract_type" TEXT,
    "contract_term" TEXT,
    "pre_deposit" INTEGER,
    "pre_monthly_rent" INTEGER,
    "use_renewal_right" BOOLEAN,
    "occurrence_index" INTEGER NOT NULL DEFAULT 0,
    "source_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_rent_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apartment_rent_histories_apt_seq_exclusive_area_deal_date_idx" ON "apartment_rent_histories"("apt_seq", "exclusive_area", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_rent_histories_lawd_cd_deal_date_idx" ON "apartment_rent_histories"("lawd_cd", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_rent_histories_identity_key_deal_date_idx" ON "apartment_rent_histories"("identity_key", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_rent_histories_deal_date_idx" ON "apartment_rent_histories"("deal_date");

-- CreateIndex
CREATE INDEX "apartment_rent_histories_lawd_cd_deal_type_deal_date_idx" ON "apartment_rent_histories"("lawd_cd", "deal_type", "deal_date");

-- CreateIndex
CREATE UNIQUE INDEX "apartment_rent_histories_group_key_deposit_monthly_rent_dea_key" ON "apartment_rent_histories"("group_key", "deposit", "monthly_rent", "deal_date", "floor", "occurrence_index");
