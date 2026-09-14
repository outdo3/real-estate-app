-- COMMUNITY_IMAGE_UPLOAD_V1 — 게시글 사진 메타데이터(바이트는 Supabase Storage).
--
-- Additive only: 새 테이블 1개 + 인덱스 + posts FK(ON DELETE CASCADE). 기존 테이블/데이터 변경 없음.
-- 아래 CREATE 구문은 `prisma migrate diff`(schema 파일 간 diff) 출력 그대로다.

-- CreateTable
CREATE TABLE "post_images" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_images_path_key" ON "post_images"("path");

-- CreateIndex
CREATE UNIQUE INDEX "post_images_post_id_sort_order_key" ON "post_images"("post_id", "sort_order");

-- AddForeignKey
ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- LEAST PRIVILEGE
--
-- 이 프로젝트의 public schema에는 default privileges가 걸려 있어 새 테이블이 만들어지는 순간
-- anon / authenticated / service_role에 권한이 자동 부여된다. 앱은 Prisma로 테이블 owner(postgres)
-- 역할을 쓰므로 그 grant가 필요 없다 → 이 테이블에서만 회수한다(기존 테이블은 건드리지 않는다).
-- RLS를 켜고 policy는 두지 않는다: owner/BYPASSRLS 역할(Prisma)은 영향이 없고, 누군가 Data API를
-- 다시 켜거나 grant를 되돌려도 이 테이블은 API 역할에게 행을 내주지 않는다(심층 방어).
-- 역할이 없는 로컬/비-Supabase Postgres에서도 migration이 실패하지 않도록 존재 확인 후 실행한다.
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON TABLE "post_images" FROM %I', r);
        END IF;
    END LOOP;
END
$$;

ALTER TABLE "post_images" ENABLE ROW LEVEL SECURITY;
