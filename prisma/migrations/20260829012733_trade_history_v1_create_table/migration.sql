-- CreateTable
CREATE TABLE "apartment_trade_histories" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MOLIT_APT_TRADE',
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "apt_seq" TEXT,
    "identity_key" TEXT NOT NULL,
    "deal_type" TEXT NOT NULL DEFAULT 'sale',
    "group_key" TEXT NOT NULL,
    "apt_name" TEXT NOT NULL,
    "dong" TEXT NOT NULL,
    "jibun" TEXT,
    "exclusive_area" DECIMAL(65,30) NOT NULL,
    "deal_amount" INTEGER NOT NULL,
    "deal_year" INTEGER NOT NULL,
    "deal_month" INTEGER NOT NULL,
    "deal_day" INTEGER NOT NULL,
    "deal_date" DATE NOT NULL,
    "floor" INTEGER,
    "build_year" INTEGER,
    "deal_canceled" BOOLEAN NOT NULL DEFAULT false,
    "cancel_date" TEXT,
    "registry_date" TEXT,
    "occurrence_index" INTEGER NOT NULL DEFAULT 0,
    "raw_uid" TEXT,
    "source_fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_trade_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "apartment_trade_histories_apt_seq_exclusive_area_deal_date_idx" ON "apartment_trade_histories"("apt_seq", "exclusive_area", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_trade_histories_lawd_cd_deal_date_idx" ON "apartment_trade_histories"("lawd_cd", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_trade_histories_identity_key_deal_date_idx" ON "apartment_trade_histories"("identity_key", "deal_date");

-- CreateIndex
CREATE INDEX "apartment_trade_histories_deal_date_idx" ON "apartment_trade_histories"("deal_date");

-- CreateIndex
CREATE UNIQUE INDEX "apartment_trade_histories_group_key_deal_amount_deal_date_f_key" ON "apartment_trade_histories"("group_key", "deal_amount", "deal_date", "floor", "occurrence_index");
