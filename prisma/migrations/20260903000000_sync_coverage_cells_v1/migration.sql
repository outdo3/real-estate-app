-- CreateEnum
CREATE TYPE "SyncDataset" AS ENUM ('SALE', 'RENT');

-- CreateEnum
CREATE TYPE "SyncCellStatus" AS ENUM ('COMPLETE', 'EMPTY_VALID', 'PARTIAL', 'INVALID');

-- CreateTable
CREATE TABLE "sync_coverage_cells" (
    "id" SERIAL NOT NULL,
    "dataset" "SyncDataset" NOT NULL,
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "status" "SyncCellStatus" NOT NULL,
    "source_total_count" INTEGER,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "run_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_coverage_cells_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_coverage_cells_dataset_deal_ymd_status_idx" ON "sync_coverage_cells"("dataset", "deal_ymd", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sync_coverage_cells_dataset_lawd_cd_deal_ymd_key" ON "sync_coverage_cells"("dataset", "lawd_cd", "deal_ymd");

