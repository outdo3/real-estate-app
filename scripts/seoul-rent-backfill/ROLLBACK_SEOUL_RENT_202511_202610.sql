-- ==============================================================================
-- E-JIP SEOUL RENT BACKFILL EMERGENCY ROLLBACK SCRIPT (2025-11 ~ 2026-10)
-- 
-- 목적:
-- 서울 25개 구 12개월 전월세 데이터(240,856건) 적재 후 긴급 롤백이 필요한 경우
-- 기존 부산 데이터(134,475건) 및 타 지역에 영향 없이 서울 데이터만 100% 안전하게 제거
--
-- 안전 보장:
-- 1. lawd_cd LIKE '11%' 만 엄격하게 대상으로 지정 (부산 '26%' 영향 0건)
-- 2. deal_ymd 범위 '202511' ~ '202610' (12개월 백필 대상) 한정
-- 3. 트랜잭션(BEGIN ... COMMIT)으로 원자적 실행
-- 4. 영향받은 행 수를 SELECT로 사전/사후 확인
-- ==============================================================================

BEGIN;

-- 1. 삭제 대상 서울 전월세 행수 사전 확인 (운영 적용 전 확인용)
DO $$
DECLARE
  v_seoul_count bigint;
  v_busan_count bigint;
BEGIN
  SELECT count(*) INTO v_seoul_count 
  FROM apartment_rent_histories 
  WHERE lawd_cd LIKE '11%' AND deal_ymd >= '202511' AND deal_ymd <= '202610';

  SELECT count(*) INTO v_busan_count 
  FROM apartment_rent_histories 
  WHERE lawd_cd LIKE '26%';

  RAISE NOTICE 'Rollback Pre-check: Target Seoul Rows = %, Preserved Busan Rows = %', v_seoul_count, v_busan_count;
END $$;

-- 2. 서울 전월세 데이터 삭제
DELETE FROM apartment_rent_histories
WHERE lawd_cd LIKE '11%'
  AND deal_ymd >= '202511'
  AND deal_ymd <= '202610';

-- 3. 삭제 후 부산 데이터 보존 여부 검증
DO $$
DECLARE
  v_busan_count_after bigint;
BEGIN
  SELECT count(*) INTO v_busan_count_after 
  FROM apartment_rent_histories 
  WHERE lawd_cd LIKE '26%';

  RAISE NOTICE 'Rollback Post-check: Busan Rows After Rollback = %', v_busan_count_after;
END $$;

COMMIT;
