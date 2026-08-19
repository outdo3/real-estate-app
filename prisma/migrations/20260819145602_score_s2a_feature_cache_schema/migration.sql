-- AlterTable
ALTER TABLE "apartments" ADD COLUMN     "apt_seq" TEXT;

-- CreateTable
CREATE TABLE "apartment_location_features" (
    "apt_seq" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "nearest_subway_distance_m" INTEGER,
    "nearest_subway_name" TEXT,
    "subway_count_1000m" INTEGER,
    "nearest_bus_stop_distance_m" INTEGER,
    "bus_stop_count_300m" INTEGER,
    "mart_count_1000m" INTEGER,
    "convenience_count_500m" INTEGER,
    "pharmacy_count_500m" INTEGER,
    "hospital_count_1000m" INTEGER,
    "park_count_1000m" INTEGER,
    "daycare_kindergarten_count_500m" INTEGER,
    "nearest_elementary_distance_m" INTEGER,
    "elementary_count_1000m" INTEGER,
    "beach_distance_m" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'kakao_local_api',
    "source_version" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "quality_flag" TEXT NOT NULL DEFAULT 'complete',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_location_features_pkey" PRIMARY KEY ("apt_seq")
);

-- CreateTable
CREATE TABLE "apartment_market_features" (
    "apt_seq" TEXT NOT NULL,
    "latest_trade_price" INTEGER,
    "latest_trade_date" TIMESTAMP(3),
    "median_price_per_m2_12m" INTEGER,
    "median_price_per_m2_36m" INTEGER,
    "transaction_count_12m" INTEGER,
    "transaction_count_36m" INTEGER,
    "price_change_12m" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'molit',
    "source_version" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3),
    "quality_flag" TEXT NOT NULL DEFAULT 'complete',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartment_market_features_pkey" PRIMARY KEY ("apt_seq")
);

-- CreateIndex
CREATE INDEX "apartments_apt_seq_idx" ON "apartments"("apt_seq");
