import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { API_ROLES, HARDENING_BATCHES, TABLE_PRIVS, checkBatchMigrationSql, verifyBatch, type AuditJson } from './hardening-batches';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = 'prisma/migrations/20260915100000_security_hardening_v2_batch_a/migration.sql';
const A = HARDENING_BATCHES.A;
const OTHERS = ['posts', 'comments', 'reports', 'page_views', 'error_logs', 'apartments', 'post_images', 'post_content_blocks', 'active_sessions', 'search_logs'];
const ALL = [...A, ...OTHERS];

function rel(name: string, opts: { grants: boolean; rls: boolean; force?: boolean; policies?: number; owner?: string }) {
  const r: Record<string, unknown> = { name, kind: 'r', owner: opts.owner ?? 'postgres', rls: opts.rls, force_rls: opts.force ?? false, policy_count: opts.policies ?? 0 };
  for (const role of API_ROLES) for (const p of TABLE_PRIVS) r[`${role}_${p}`] = opts.grants;
  return r;
}
const acl = (name: string, grantee: string) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'].map((privilege_type) => ({ name, grantee, privilege_type, is_grantable: false }));

function beforeState(): AuditJson {
  const hardened = new Set(['post_images', 'post_content_blocks']);
  return {
    relations: ALL.map((t) => rel(t, { grants: !hardened.has(t), rls: hardened.has(t) })),
    explicitAcl: ALL.flatMap((t) => [...acl(t, 'postgres'), ...(hardened.has(t) ? [] : API_ROLES.flatMap((r) => acl(t, r)))]),
    policies: [],
    sequenceAcl: [{ name: 'posts_id_seq', grantee: 'anon', privilege_type: 'USAGE' }],
    defaultAcl: [{ for_role: 'postgres', schema: 'public', objtype: 'r', grantee: 'anon', privilege_type: 'SELECT' }],
  };
}

/** migration이 기대대로 적용된 상태. */
function appliedState(): AuditJson {
  const b = beforeState();
  const target = new Set<string>(A);
  return {
    ...b,
    relations: b.relations.map((r) => (target.has(String(r.name)) ? rel(String(r.name), { grants: false, rls: true }) : r)),
    explicitAcl: b.explicitAcl.filter((x) => !(target.has(String(x.name)) && x.grantee !== 'postgres')),
  };
}

test('batch A = 정확히 CRITICAL 7개', () => {
  assert.deepEqual([...A], ['users', 'accounts', 'sessions', 'verification_tokens', 'favorites', 'recent_views', 'user_preferences']);
});

test('migration SQL: 7개만, API 역할 3개 revoke, ENABLE RLS, FORCE·정책·GRANT·시퀀스·기본 권한·데이터 변경 없음', () => {
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8');
  assert.deepEqual(checkBatchMigrationSql(sql, A, ALL), []);
});

test('정적 검사는 범위 밖 SQL을 잡는다', () => {
  const sql = readFileSync(join(ROOT, MIGRATION), 'utf8');
  assert.ok(checkBatchMigrationSql(sql.replace("'user_preferences'", "'user_preferences', 'posts'"), A, ALL).some((p) => p.startsWith('target list mismatch')));
  assert.ok(checkBatchMigrationSql(sql + '\nALTER TABLE public.users FORCE ROW LEVEL SECURITY;', A, ALL).includes('FORCE ROW LEVEL SECURITY present'));
  assert.ok(checkBatchMigrationSql(sql + '\nCREATE POLICY p ON public.users USING (true);', A, ALL).includes('policy statement present'));
  assert.ok(checkBatchMigrationSql(sql + '\nGRANT SELECT ON public.users TO anon;', A, ALL).includes('GRANT present'));
  assert.ok(checkBatchMigrationSql(sql + '\nREVOKE ALL ON SEQUENCE public.x FROM anon;', A, ALL).length > 0);
  assert.ok(checkBatchMigrationSql(sql + "\nREVOKE ALL ON TABLE public.posts FROM anon;", A, ALL).some((p) => p.includes('posts')));
  assert.ok(checkBatchMigrationSql(sql + '\nDELETE FROM users;', A, ALL).length > 0);
  assert.ok(checkBatchMigrationSql(sql.replace("'3s', true)", "'3s', false)"), A, ALL).includes('transaction-local lock_timeout missing'));
});

test('검증: 기대 적용 상태는 PASS, 대상 7개·대상 밖 전부 확인', () => {
  const res = verifyBatch(beforeState(), appliedState(), A);
  assert.deepEqual(res.targetViolations, []);
  assert.deepEqual(res.unrelatedChanges, []);
  assert.equal(res.ok, true);
  assert.equal(res.checkedTargets, 7);
  assert.equal(res.checkedOthers, OTHERS.length);
});

test('검증: 적용 전 상태(권한 남음·RLS off)는 FAIL', () => {
  const res = verifyBatch(beforeState(), beforeState(), A);
  assert.equal(res.ok, false);
  assert.ok(res.targetViolations.some((v) => v === 'users: anon still has select,insert,update,delete,truncate,references,trigger'));
  assert.ok(res.targetViolations.some((v) => v === 'favorites: RLS not enabled'));
});

test('검증: 한 역할만 남아도, FORCE·정책·소유자 변경도 FAIL', () => {
  const partial = appliedState();
  const svc = partial.relations.find((r) => r.name === 'sessions')!;
  svc.service_role_select = true;
  assert.ok(verifyBatch(beforeState(), partial, A).targetViolations.includes('sessions: service_role still has select'));

  const forced = appliedState();
  forced.relations.find((r) => r.name === 'users')!.force_rls = true;
  assert.ok(verifyBatch(beforeState(), forced, A).targetViolations.includes('users: FORCE RLS is on'));

  const withPolicy = appliedState();
  withPolicy.policies = [{ tablename: 'accounts', policyname: 'p', cmd: 'SELECT', roles: '{anon}', qual: 'true', with_check: null }];
  assert.ok(verifyBatch(beforeState(), withPolicy, A).targetViolations.includes('accounts: has policies'));

  const owner = appliedState();
  owner.relations.find((r) => r.name === 'recent_views')!.owner = 'supabase_admin';
  assert.ok(verifyBatch(beforeState(), owner, A).targetViolations.some((v) => v.startsWith('recent_views: owner changed')));

  const ownerAcl = appliedState();
  ownerAcl.explicitAcl = ownerAcl.explicitAcl.filter((x) => !(x.name === 'users' && x.grantee === 'postgres'));
  assert.ok(verifyBatch(beforeState(), ownerAcl, A).targetViolations.includes('users: owner (postgres) ACL changed'));
});

test('검증: 대상 밖 테이블(posts·post_images 등)·시퀀스·기본 권한이 바뀌면 FAIL', () => {
  for (const name of ['posts', 'comments', 'reports', 'page_views', 'error_logs', 'apartments']) {
    const s = appliedState();
    const r = s.relations.find((x) => x.name === name)!;
    r.anon_select = false;
    assert.ok(verifyBatch(beforeState(), s, A).unrelatedChanges.some((v) => v.startsWith(`${name}:`)), name);
  }
  for (const name of ['post_images', 'post_content_blocks']) {
    const s = appliedState();
    s.relations.find((x) => x.name === name)!.rls = false;
    assert.ok(verifyBatch(beforeState(), s, A).unrelatedChanges.some((v) => v.startsWith(`${name}:`)), name);
  }
  const aclChange = appliedState();
  aclChange.explicitAcl = aclChange.explicitAcl.filter((x) => !(x.name === 'posts' && x.grantee === 'anon' && x.privilege_type === 'TRUNCATE'));
  assert.ok(verifyBatch(beforeState(), aclChange, A).unrelatedChanges.some((v) => v.startsWith('acl removed: posts|anon|TRUNCATE')));
  const seq = appliedState();
  seq.sequenceAcl = [];
  assert.ok(verifyBatch(beforeState(), seq, A).unrelatedChanges.some((v) => v.startsWith('sequence acl removed')));
  const def = appliedState();
  def.defaultAcl = [];
  assert.ok(verifyBatch(beforeState(), def, A).unrelatedChanges.some((v) => v.startsWith('default acl removed')));
});
