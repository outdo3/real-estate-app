-- COMMUNITY_EDITOR_V2 — TEXT 블록 "공백만 금지" CHECK 보정.
--
-- 20260914120000의 CHECK는 length(btrim(text)) > 0 이었는데, btrim()은 기본으로 **스페이스만** 지운다.
-- 그래서 줄바꿈·탭만 있는 텍스트("  \n\t ")가 통과했다(롤백 트랜잭션 검증에서 발견,
-- scripts/community/verify-content-block-constraints.ts). 승인된 의도(공백만 있는 TEXT 금지)대로
-- "공백이 아닌 문자가 하나 이상"을 요구하는 정규식으로 교체한다.
-- 적용 시점 테이블 행 수 0 — 기존 데이터 영향 없음. 앱 검증(trim 후 빈 문자열 거부)이 1차 방어이고 이 제약은 이중 방어다.

ALTER TABLE "post_content_blocks" DROP CONSTRAINT "post_content_blocks_shape_check";

ALTER TABLE "post_content_blocks" ADD CONSTRAINT "post_content_blocks_shape_check" CHECK (
    ("type" = 'TEXT' AND "text" IS NOT NULL AND "text" ~ '[^[:space:]]' AND "post_image_id" IS NULL)
    OR ("type" = 'IMAGE' AND "post_image_id" IS NOT NULL AND "text" IS NULL)
);
