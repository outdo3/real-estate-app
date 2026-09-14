-- COMMUNITY_EDITOR_V2 — 게시글 본문 블록(텍스트/사진, 순서 자유).
--
-- Additive only: enum 1 + 테이블 1 + 인덱스(기존 post_images에는 unique 인덱스 1개만 추가) + FK 2.
-- 기존 행은 수정하지 않는다. 블록이 0개인 글은 앱이 V1(legacy: content + images)으로 읽는다.
-- CREATE/INDEX/FK 구문은 `prisma migrate diff`(schema 파일 간) 출력 그대로이며, CHECK와 권한 블록은 수기 추가다
-- (docs/development/COMMUNITY_EDITOR_V2_DESIGN.md §4).

-- CreateEnum
CREATE TYPE "PostContentBlockType" AS ENUM ('TEXT', 'IMAGE');

-- CreateTable
CREATE TABLE "post_content_blocks" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "type" "PostContentBlockType" NOT NULL,
    "text" TEXT,
    "post_image_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_content_blocks_post_id_sort_order_key" ON "post_content_blocks"("post_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "post_content_blocks_post_image_id_post_id_key" ON "post_content_blocks"("post_image_id", "post_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_images_id_post_id_key" ON "post_images"("id", "post_id");

-- AddForeignKey
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- 복합 FK: 사진 블록은 **같은 글의** 사진만 참조한다. NO ACTION은 문장 끝에 검사하므로 글 삭제 시 사진·블록 cascade가
-- 함께 끝난 뒤 통과하고, 블록이 쓰는 사진만 따로 지우는 것은 거부된다(RESTRICT는 즉시 검사라 cascade 순서에 걸린다).
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_post_image_id_post_id_fkey" FOREIGN KEY ("post_image_id", "post_id") REFERENCES "post_images"("id", "post_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 블록 모양(Prisma가 CHECK를 모델링하지 않아 수기 추가)
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_shape_check" CHECK (
    ("type" = 'TEXT' AND "text" IS NOT NULL AND length(btrim("text")) > 0 AND "post_image_id" IS NULL)
    OR ("type" = 'IMAGE' AND "post_image_id" IS NOT NULL AND "text" IS NULL)
);
ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_sort_order_check" CHECK ("sort_order" >= 0);

-- LEAST PRIVILEGE (COMMUNITY_IMAGE_UPLOAD_V1의 post_images와 같은 방식)
-- public schema default privileges가 새 테이블을 API 역할에 자동 부여하므로 이 테이블에서만 회수한다.
-- 앱은 Prisma로 owner(postgres, BYPASSRLS)를 쓴다. RLS ON + policy 0. 기존 테이블 권한은 건드리지 않는다.
DO $$
DECLARE
    r TEXT;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON TABLE "post_content_blocks" FROM %I', r);
        END IF;
    END LOOP;
END
$$;

ALTER TABLE "post_content_blocks" ENABLE ROW LEVEL SECURITY;
