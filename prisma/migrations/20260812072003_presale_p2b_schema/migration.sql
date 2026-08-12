-- AlterTable
ALTER TABLE "presales" ADD COLUMN     "business_entity_name" TEXT,
ADD COLUMN     "contract_end_date" TIMESTAMP(3),
ADD COLUMN     "contract_start_date" TIMESTAMP(3),
ADD COLUMN     "house_secd" TEXT,
ADD COLUMN     "house_secd_name" TEXT,
ADD COLUMN     "move_in_expected_ym" TEXT,
ADD COLUMN     "rent_secd" TEXT,
ADD COLUMN     "rent_secd_name" TEXT,
ADD COLUMN     "subscription_area_code" TEXT,
ADD COLUMN     "subscription_area_name" TEXT;

-- CreateTable
CREATE TABLE "presale_house_type_details" (
    "id" SERIAL NOT NULL,
    "presale_id" INTEGER NOT NULL,
    "house_manage_no" TEXT NOT NULL,
    "model_no" TEXT NOT NULL,
    "house_ty" TEXT,
    "supply_area" DOUBLE PRECISION,
    "general_supply" INTEGER,
    "special_supply" INTEGER,
    "total_supply" INTEGER,
    "top_amount" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presale_house_type_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presale_house_type_details_presale_id_idx" ON "presale_house_type_details"("presale_id");

-- CreateIndex
CREATE UNIQUE INDEX "presale_house_type_details_house_manage_no_model_no_key" ON "presale_house_type_details"("house_manage_no", "model_no");

-- AddForeignKey
ALTER TABLE "presale_house_type_details" ADD CONSTRAINT "presale_house_type_details_presale_id_fkey" FOREIGN KEY ("presale_id") REFERENCES "presales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
