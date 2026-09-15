// SUPABASE_DB_SECURITY_HARDENING_V2 — 배치 정의와 적용 전/후 비교(순수 함수, DB/네트워크 없음).
// 입력은 `audit-db-grants-rls.ts --json` 출력 두 개(before/after). 출력은 통과 여부와 위반 목록(테이블 이름·항목만).

export const HARDENING_BATCHES = {
  A: ['users', 'accounts', 'sessions', 'verification_tokens', 'favorites', 'recent_views', 'user_preferences'],
} as const;

export type BatchName = keyof typeof HARDENING_BATCHES;

export const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;
export const TABLE_PRIVS = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] as const;

type Row = Record<string, unknown>;

export interface AuditJson {
  relations: Row[];
  explicitAcl: Row[];
  policies: Row[];
  sequenceAcl: Row[];
  defaultAcl: Row[];
}

export interface BatchVerification {
  ok: boolean;
  targetViolations: string[];
  unrelatedChanges: string[];
  checkedTargets: number;
  checkedOthers: number;
}

const aclKey = (a: Row) => `${a.name}|${a.grantee}|${a.privilege_type}|${a.is_grantable ?? ''}`;
const relState = (r: Row) =>
  JSON.stringify([r.kind, r.owner, r.rls, r.force_rls, r.policy_count, ...API_ROLES.flatMap((role) => TABLE_PRIVS.map((p) => r[`${role}_${p}`]))]);

/**
 * 대상 테이블: API 역할 권한 0, RLS on, FORCE off, 정책 0, 소유자 불변.
 * 대상 밖: 관계 상태·명시 ACL·정책·시퀀스 ACL·기본 권한이 before와 완전히 같아야 한다.
 */
export function verifyBatch(before: AuditJson, after: AuditJson, targets: readonly string[]): BatchVerification {
  const targetSet = new Set(targets);
  const targetViolations: string[] = [];
  const unrelatedChanges: string[] = [];

  for (const t of targets) {
    const b = before.relations.find((r) => r.name === t);
    const a = after.relations.find((r) => r.name === t);
    if (!b || !a) {
      targetViolations.push(`${t}: missing in ${!b ? 'before' : 'after'}`);
      continue;
    }
    for (const role of API_ROLES) {
      const left = TABLE_PRIVS.filter((p) => a[`${role}_${p}`]);
      if (left.length) targetViolations.push(`${t}: ${role} still has ${left.join(',')}`);
      if (after.explicitAcl.some((x) => x.name === t && x.grantee === role)) targetViolations.push(`${t}: explicit ACL entry for ${role}`);
    }
    if (a.rls !== true) targetViolations.push(`${t}: RLS not enabled`);
    if (a.force_rls !== false) targetViolations.push(`${t}: FORCE RLS is on`);
    if (a.policy_count !== 0 || after.policies.some((p) => p.tablename === t)) targetViolations.push(`${t}: has policies`);
    if (a.owner !== b.owner) targetViolations.push(`${t}: owner changed ${b.owner} -> ${a.owner}`);
    if (a.kind !== b.kind) targetViolations.push(`${t}: kind changed`);
  }

  const beforeOthers = before.relations.filter((r) => !targetSet.has(String(r.name)));
  const afterOthers = after.relations.filter((r) => !targetSet.has(String(r.name)));
  const afterByName = new Map(afterOthers.map((r) => [String(r.name), r]));
  for (const b of beforeOthers) {
    const a = afterByName.get(String(b.name));
    if (!a) unrelatedChanges.push(`${b.name}: disappeared`);
    else if (relState(a) !== relState(b)) unrelatedChanges.push(`${b.name}: privileges/RLS/owner/policy count changed`);
  }
  for (const a of afterOthers) if (!beforeOthers.some((b) => b.name === a.name)) unrelatedChanges.push(`${a.name}: new relation`);

  const setDiff = (label: string, x: Row[], y: Row[], key: (r: Row) => string) => {
    const bx = new Set(x.map(key));
    const by = new Set(y.map(key));
    for (const k of bx) if (!by.has(k)) unrelatedChanges.push(`${label} removed: ${k}`);
    for (const k of by) if (!bx.has(k)) unrelatedChanges.push(`${label} added: ${k}`);
  };
  setDiff('acl', before.explicitAcl.filter((x) => !targetSet.has(String(x.name))), after.explicitAcl.filter((x) => !targetSet.has(String(x.name))), aclKey);
  setDiff('policy', before.policies.filter((x) => !targetSet.has(String(x.tablename))), after.policies.filter((x) => !targetSet.has(String(x.tablename))), (p) => JSON.stringify([p.tablename, p.policyname, p.cmd, p.roles, p.qual, p.with_check]));
  setDiff('sequence acl', before.sequenceAcl, after.sequenceAcl, (s) => `${s.name}|${s.grantee}|${s.privilege_type}`);
  setDiff('default acl', before.defaultAcl, after.defaultAcl, (d) => `${d.for_role}|${d.schema}|${d.objtype}|${d.grantee}|${d.privilege_type}`);
  // 대상 테이블의 postgres(소유자) 자신 ACL은 남아 있어야 한다(소유자 권한 회수 금지).
  for (const t of targets) {
    const ownerBefore = before.explicitAcl.filter((x) => x.name === t && x.grantee === 'postgres').map(aclKey).sort();
    const ownerAfter = after.explicitAcl.filter((x) => x.name === t && x.grantee === 'postgres').map(aclKey).sort();
    if (JSON.stringify(ownerBefore) !== JSON.stringify(ownerAfter)) targetViolations.push(`${t}: owner (postgres) ACL changed`);
  }

  return {
    ok: targetViolations.length === 0 && unrelatedChanges.length === 0,
    targetViolations,
    unrelatedChanges,
    checkedTargets: targets.length,
    checkedOthers: beforeOthers.length,
  };
}

/** migration SQL이 배치 범위만 건드리는지 정적 검사. */
export function checkBatchMigrationSql(sql: string, targets: readonly string[], allTables: readonly string[]): string[] {
  const problems: string[] = [];
  const code = sql.replace(/--.*$/gm, '');
  const arrayMatch = /target_tables\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\[([^\]]*)\]/i.exec(code);
  if (!arrayMatch) problems.push('target_tables array not found');
  const listed = arrayMatch ? [...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  if (JSON.stringify([...listed].sort()) !== JSON.stringify([...targets].sort())) problems.push(`target list mismatch: ${listed.join(',')}`);
  if (/FORCE\s+ROW\s+LEVEL/i.test(code)) problems.push('FORCE ROW LEVEL SECURITY present');
  if (/CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+POLICY/i.test(code)) problems.push('policy statement present');
  if (/\bGRANT\s/i.test(code)) problems.push('GRANT present');
  if (/DEFAULT\s+PRIVILEGES|SEQUENCE/i.test(code)) problems.push('sequence/default privilege statement present');
  if (/\b(DROP|TRUNCATE|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|ADD\s+COLUMN|ALTER\s+COLUMN|DISABLE\s+ROW)\b/i.test(code)) problems.push('destructive/data/column statement present');
  const others = allTables.filter((t) => !targets.includes(t));
  for (const t of others) if (new RegExp(`['"\\s.]${t}['"\\s;]`).test(code)) problems.push(`unrelated table referenced: ${t}`);
  if (!/set_config\('lock_timeout',\s*'[0-9]+s',\s*true\)/.test(code)) problems.push('transaction-local lock_timeout missing');
  if (!/REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM %I/.test(code)) problems.push('revoke statement missing');
  if (!/ENABLE ROW LEVEL SECURITY/.test(code)) problems.push('ENABLE RLS missing');
  if (!/ARRAY\['anon', 'authenticated', 'service_role'\]/.test(code)) problems.push('api role list mismatch');
  return problems;
}
