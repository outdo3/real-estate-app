-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GUEST', 'USER', 'VERIFIED', 'ADMIN');

-- CreateEnum
CREATE TYPE "PropertyCategory" AS ENUM ('APT', 'OFFICETEL', 'LIVING_STAY', 'REDEVELOPMENT');

-- CreateEnum
CREATE TYPE "RedevelopmentStage" AS ENUM ('ZONE_DESIGNATED', 'UNION_ESTABLISHED', 'PROJECT_APPROVED', 'MANAGEMENT_DISPOSAL_APPROVED', 'RELOCATION_DEMOLITION', 'CONSTRUCTION');

-- CreateEnum
CREATE TYPE "PresaleHouseType" AS ENUM ('APT', 'OFFICETEL', 'URBAN', 'REMAIN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "nickname" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "apt_name" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "rank" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "priceChange" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "typeLabel" TEXT NOT NULL,
    "info" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeHistory" (
    "id" SERIAL NOT NULL,
    "aptName" TEXT NOT NULL,
    "tradeDate" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "priceStr" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "tradeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "dong" TEXT,
    "lawd_cd" TEXT,
    "community_facilities" JSONB,
    "parking_count" INTEGER,
    "far" DOUBLE PRECISION,
    "bcr" DOUBLE PRECISION,
    "total_households" INTEGER,
    "approval_date" TEXT,
    "jibun" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_search_cache" (
    "id" SERIAL NOT NULL,
    "query_hash" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_search_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" SERIAL NOT NULL,
    "category" "PropertyCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "dong" TEXT,
    "lawd_cd" TEXT,
    "total_households" INTEGER,
    "total_parking" INTEGER,
    "build_year" INTEGER,
    "approval_date" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redevelopment_projects" (
    "id" SERIAL NOT NULL,
    "zone_name" TEXT NOT NULL,
    "lawd_cd" TEXT,
    "stage" "RedevelopmentStage" NOT NULL,
    "target_households" INTEGER,
    "polygon_geojson" JSONB,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redevelopment_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "presales" (
    "id" SERIAL NOT NULL,
    "house_manage_no" TEXT,
    "pblanc_no" TEXT,
    "house_name" TEXT NOT NULL,
    "house_type" "PresaleHouseType" NOT NULL,
    "location_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "total_supply_households" INTEGER,
    "construct_company" TEXT,
    "announcement_date" TIMESTAMP(3),
    "receipt_start_date" TIMESTAMP(3),
    "receipt_end_date" TIMESTAMP(3),
    "winner_date" TIMESTAMP(3),
    "min_price" INTEGER,
    "max_price" INTEGER,
    "pblanc_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_views" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "complex_id" TEXT,
    "apt_name" TEXT,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" SERIAL NOT NULL,
    "query" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_sessions" (
    "session_id" TEXT NOT NULL,
    "user_id" TEXT,
    "current_url" TEXT,
    "current_apt_name" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "post_id" TEXT,
    "comment_id" TEXT,
    "reporter_id" TEXT,
    "reason" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "posts_pinned_created_at_idx" ON "posts"("pinned", "created_at");

-- CreateIndex
CREATE INDEX "posts_apt_name_created_at_idx" ON "posts"("apt_name", "created_at");

-- CreateIndex
CREATE INDEX "comments_post_id_idx" ON "comments"("post_id");

-- CreateIndex
CREATE INDEX "TradeHistory_aptName_idx" ON "TradeHistory"("aptName");

-- CreateIndex
CREATE UNIQUE INDEX "apartments_name_dong_key" ON "apartments"("name", "dong");

-- CreateIndex
CREATE UNIQUE INDEX "ai_search_cache_query_hash_key" ON "ai_search_cache"("query_hash");

-- CreateIndex
CREATE INDEX "properties_category_idx" ON "properties"("category");

-- CreateIndex
CREATE UNIQUE INDEX "properties_category_name_dong_key" ON "properties"("category", "name", "dong");

-- CreateIndex
CREATE INDEX "redevelopment_projects_stage_idx" ON "redevelopment_projects"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "presales_house_manage_no_key" ON "presales"("house_manage_no");

-- CreateIndex
CREATE INDEX "presales_receipt_start_date_receipt_end_date_idx" ON "presales"("receipt_start_date", "receipt_end_date");

-- CreateIndex
CREATE INDEX "page_views_created_at_idx" ON "page_views"("created_at");

-- CreateIndex
CREATE INDEX "page_views_apt_name_created_at_idx" ON "page_views"("apt_name", "created_at");

-- CreateIndex
CREATE INDEX "page_views_session_id_created_at_idx" ON "page_views"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "search_logs_created_at_idx" ON "search_logs"("created_at");

-- CreateIndex
CREATE INDEX "active_sessions_last_seen_at_idx" ON "active_sessions"("last_seen_at");

-- CreateIndex
CREATE INDEX "active_sessions_current_apt_name_last_seen_at_idx" ON "active_sessions"("current_apt_name", "last_seen_at");

-- CreateIndex
CREATE INDEX "error_logs_created_at_idx" ON "error_logs"("created_at");

-- CreateIndex
CREATE INDEX "reports_resolved_created_at_idx" ON "reports"("resolved", "created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

