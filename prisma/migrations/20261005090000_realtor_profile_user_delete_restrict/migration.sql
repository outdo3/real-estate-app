-- REALTOR_PRO_USER_DELETE_SAFETY_V1 — realtor_profiles.user_id → users.id 의 ON DELETE 동작만 바꾼다.
--
-- 변경: ON DELETE CASCADE → ON DELETE RESTRICT (ON UPDATE CASCADE는 그대로).
-- 이유: users 행 삭제가 중개사 Pro 데이터(profile→listings/customers/briefings…)를 연쇄 삭제하면 안 된다.
--       Pro 계정 종료는 status=SUSPENDED로, 실제 데이터 삭제는 별도의 명시적 절차로만 한다.
--       Pro profile이 있는 users 행의 물리 삭제는 FK 위반으로 실패해야 안전하다.
-- 선행: 20260930090000_realtor_pro_mvp_v1 (그 파일은 수정하지 않는다 — Preview에 이미 적용됨, checksum 고정).
--
-- 데이터·컬럼·인덱스·RLS·CHECK는 건드리지 않는다. 컬럼은 NOT NULL 그대로. DELETE/UPDATE 데이터 문장 없음.
-- 하나의 DO 블록(전부 적용되거나 전혀 적용되지 않음). lock_timeout은 트랜잭션 로컬.
-- 재생성하는 FK는 users에 SHARE ROW EXCLUSIVE, realtor_profiles에 ACCESS EXCLUSIVE를 짧게 잡는다.
DO $$
DECLARE
    del_action "char";
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);

    -- 전제: 기존 FK가 CASCADE(c)로 존재해야 한다. 아니면 아무것도 바꾸지 않고 중단.
    SELECT c.confdeltype INTO del_action
      FROM pg_constraint c
     WHERE c.conname = 'realtor_profiles_user_id_fkey'
       AND c.conrelid = to_regclass('public.realtor_profiles')
       AND c.contype = 'f';
    IF del_action IS NULL THEN
        RAISE EXCEPTION 'user delete safety migration aborted: FK realtor_profiles_user_id_fkey not found';
    END IF;
    IF del_action <> 'c' THEN
        RAISE EXCEPTION 'user delete safety migration aborted: FK realtor_profiles_user_id_fkey ON DELETE is % (expected c = CASCADE)', del_action;
    END IF;

    ALTER TABLE "realtor_profiles" DROP CONSTRAINT "realtor_profiles_user_id_fkey";
    ALTER TABLE "realtor_profiles" ADD CONSTRAINT "realtor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
END
$$;
