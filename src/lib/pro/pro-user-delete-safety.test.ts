import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// REALTOR_PRO_USER_DELETE_SAFETY_V1 — users 삭제가 Pro 데이터를 연쇄 삭제하지 못하게 하는 migration 고정(파일만 읽음, DB 없음).

const ROOT = resolve(__dirname, '../../..');
const MIG = resolve(ROOT, 'prisma/migrations');
const PRO = '20260930090000_realtor_pro_mvp_v1';
const SAFE = '20261005090000_realtor_profile_user_delete_restrict';
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const SAFE_SQL = read(`prisma/migrations/${SAFE}/migration.sql`);
// 주석(-- ...)을 제거한 실행 SQL
const EXEC = SAFE_SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

test('기존 Pro migration은 수정되지 않았고(checksum 고정) 새 migration이 그 뒤에 온다', () => {
  const sha = createHash('sha256').update(readFileSync(resolve(MIG, PRO, 'migration.sql'))).digest('hex');
  assert.equal(sha, '995018369e8364c5ed8928f53993840911db14eb0174fae64d7ffeabba108f03');
  const dirs = readdirSync(MIG, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.ok(dirs.indexOf(SAFE) > dirs.indexOf(PRO));
  assert.equal(dirs[dirs.length - 1], SAFE);
});

test('새 migration은 realtor_profiles.user_id FK의 delete action만 RESTRICT로 바꾼다', () => {
  assert.match(EXEC, /DROP CONSTRAINT "realtor_profiles_user_id_fkey"/);
  assert.match(EXEC, /ADD CONSTRAINT "realtor_profiles_user_id_fkey" FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.equal((EXEC.match(/ALTER TABLE/g) ?? []).length, 2);
  assert.doesNotMatch(EXEC, /ON DELETE (CASCADE|SET NULL|SET DEFAULT)/);
});

test('새 migration에 데이터 변경·파괴·기타 객체 변경 문장이 없다', () => {
  assert.doesNotMatch(EXEC, /\b(DELETE\s+FROM|UPDATE\s+"?\w+"?\s+SET|INSERT\s+INTO|TRUNCATE|DROP\s+(TABLE|COLUMN|INDEX|POLICY|TRIGGER|FUNCTION|SCHEMA))\b/i);
  assert.doesNotMatch(EXEC, /CREATE\s+(INDEX|POLICY|TRIGGER|FUNCTION|TABLE)|ADD\s+COLUMN|ALTER\s+COLUMN|DISABLE\s+ROW|ENABLE\s+ROW|GRANT|REVOKE/i);
  assert.match(EXEC, /lock_timeout/);
  assert.match(EXEC, /del_action <> 'c'/); // 전제(CASCADE일 때만 진행) 가드
});

test('schema.prisma: RealtorProfile.user만 Restrict, Pro 하위 관계는 기존 Cascade 유지', () => {
  const s = read('prisma/schema.prisma');
  const body = s.slice(s.indexOf('model RealtorProfile {'));
  const profile = body.slice(0, body.indexOf('\n}'));
  assert.match(profile, /user\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Restrict\)/);
  assert.doesNotMatch(profile, /onDelete: Cascade/);
  assert.match(s, /realtor RealtorProfile @relation\(fields: \[realtorId\], references: \[id\], onDelete: Cascade\)/);
});
