-- CreateEnum
CREATE TYPE "OfficetelSyncDataset" AS ENUM ('OFFICETEL_SALE', 'OFFICETEL_RENT');

-- CreateEnum
CREATE TYPE "OfficetelSyncCellStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'INVALID');

-- CreateEnum
CREATE TYPE "OfficetelSyncFailureReason" AS ENUM ('API_ERROR', 'TIMEOUT', 'QUOTA', 'PARSE_ERROR', 'DB_ERROR', 'PARTIAL_PAGINATION');

-- CreateTable
CREATE TABLE "officetel_sync_cells" (
    "id" SERIAL NOT NULL,
    "dataset" "OfficetelSyncDataset" NOT NULL,
    "lawd_cd" TEXT NOT NULL,
    "deal_ymd" TEXT NOT NULL,
    "status" "OfficetelSyncCellStatus" NOT NULL,
    "failure_reason" "OfficetelSyncFailureReason",
    "source_total_count" INTEGER,
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "inserted_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "unresolved_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_row_count" INTEGER NOT NULL DEFAULT 0,
    "run_id" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "officetel_sync_cells_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "officetel_sync_cells_dataset_deal_ymd_status_idx" ON "officetel_sync_cells"("dataset", "deal_ymd", "status");

-- CreateIndex
CREATE UNIQUE INDEX "officetel_sync_cells_dataset_lawd_cd_deal_ymd_key" ON "officetel_sync_cells"("dataset", "lawd_cd", "deal_ymd");

