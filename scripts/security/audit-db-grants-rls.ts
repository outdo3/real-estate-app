/**
 * SUPABASE_DB_SECURITY_HARDENING_V2 — PHASE 1 DB 권한/RLS 감사 (STRICT READ ONLY).
 *
 * 읽는 것: pg_catalog / information_schema 메타데이터와 Data API HTTP status뿐. 테이블 행 값은 읽지 않는다.
 * 모든 쿼리는 `SET TRANSACTION READ ONLY` 트랜잭션 안에서 실행한다. GRANT/REVOKE/ALTER/POLICY 없음.
 * 키·연결 문자열·호스트는 출력하지 않는다(역할 이름·boolean·개수·HTTP status만).
 *
 * 저장소가 공개이므로 결과(테이블별 권한 상태)는 문서에 커밋하지 않는다. 운영자 터미널에만 출력한다.
 * 롤백 스냅샷: --snapshot 은 현재 grant/RLS/policy를 재적용 가능한 SQL로 stdout에 출력한다(실행하지 않음).
 *   파일로 저장할 때는 저장소 밖(또는 gitignore 대상) 경로로 리다이렉트할 것.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/security/audit-db-grants-rls.ts            # 요약 + 테이블별 표
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/security/audit-db-grants-rls.ts --json     # 기계용 JSON
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/security/audit-db-grants-rls.ts --snapshot # 롤백용 SQL(출력만)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient, Prisma } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const;

type Row = Record<string, unknown>;

const prisma = new PrismaClient();

async function readOnly<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return fn(tx);
  });
}

const q = (tx: Prisma.TransactionClient, sql: string) => tx.$queryRawUnsafe<Row[]>(sql);
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));

async function collect() {
  return readOnly(async (tx) => {
    const whoami = await q(
      tx,
      `SELECT current_user AS current_user, session_user AS session_user,
              r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
              current_setting('transaction_read_only') AS tx_read_only,
              current_setting('server_version') AS server_version
       FROM pg_roles r WHERE r.rolname = current_user`
    );
    const roles = await q(
      tx,
      `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
       FROM pg_roles
       WHERE rolname IN ('anon','authenticated','service_role','authenticator','postgres','supabase_admin','supabase_storage_admin','pgbouncer')
       ORDER BY rolname`
    );
    const memberships = await q(
      tx,
      `SELECT m.rolname AS member, g.rolname AS granted_role
       FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.member JOIN pg_roles g ON g.oid = am.roleid
       WHERE m.rolname IN ('authenticator','postgres','anon','authenticated','service_role')
         AND g.rolname IN ('anon','authenticated','service_role','postgres')
       ORDER BY 1, 2`
    );
    const schemaUsage = await q(
      tx,
      `SELECT r AS role,
              has_schema_privilege(r, 'public', 'USAGE') AS usage,
              has_schema_privilege(r, 'public', 'CREATE') AS create
       FROM unnest(ARRAY['anon','authenticated','service_role']) r`
    );
    const relations = await q(
      tx,
      `SELECT c.relname AS name, c.relkind AS kind, pg_get_userbyid(c.relowner) AS owner,
              c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
              GREATEST(c.reltuples, 0)::bigint AS approx_rows,
              (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policy_count,
              ${API_ROLES.flatMap((role) =>
                PRIVS.map((p) => `has_table_privilege('${role}', c.oid, '${p}') AS "${role}_${p.toLowerCase()}"`)
              ).join(',\n              ')}
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
       ORDER BY c.relkind, c.relname`
    );
    const explicitAcl = await q(
      tx,
      `SELECT c.relname AS name, a.grantee::regrole::text AS grantee, a.privilege_type, a.is_grantable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.grantee <> 0
       UNION ALL
       SELECT c.relname, 'PUBLIC', a.privilege_type, a.is_grantable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND a.grantee = 0
       ORDER BY 1, 2, 3`
    );
    const nullAcl = await q(
      tx,
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND c.relacl IS NULL ORDER BY 1`
    );
    const policies = await q(
      tx,
      `SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`
    );
    const sequenceAcl = await q(
      tx,
      `SELECT c.relname AS name, a.grantee::regrole::text AS grantee, a.privilege_type
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
       WHERE n.nspname = 'public' AND c.relkind = 'S' AND a.grantee <> 0 ORDER BY 1, 2, 3`
    );
    const sequences = await q(
      tx,
      `SELECT c.relname AS name,
              has_sequence_privilege('anon', c.oid, 'USAGE') AS anon_usage,
              has_sequence_privilege('anon', c.oid, 'UPDATE') AS anon_update,
              has_sequence_privilege('authenticated', c.oid, 'USAGE') AS authenticated_usage
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY 1`
    );
    const functions = await q(
      tx,
      `SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' ORDER BY 1`
    );
    const defaultAcl = await q(
      tx,
      `SELECT pg_get_userbyid(d.defaclrole) AS for_role, COALESCE(n.nspname, '(all)') AS schema, d.defaclobjtype AS objtype,
              a.grantee::regrole::text AS grantee, a.privilege_type
       FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
       WHERE a.grantee <> 0 AND (n.nspname = 'public' OR n.nspname IS NULL)
       ORDER BY 1, 2, 3, 4, 5`
    );
    const schemas = await q(
      tx,
      `SELECT n.nspname AS schema, count(c.oid)::int AS tables
       FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r','p')
       WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
       GROUP BY 1 ORDER BY 1`
    );
    // 앱(Vercel)·cron·스크립트가 실제로 어떤 역할로 붙는지 — 역할·application_name별 연결 수만(주소·쿼리 텍스트 없음).
    const connectionRoles = await q(
      tx,
      `SELECT COALESCE(usename, '(background)') AS role, COALESCE(NULLIF(application_name, ''), '(none)') AS application_name,
              backend_type, count(*)::int AS connections
       FROM pg_stat_activity WHERE datname = current_database()
       GROUP BY 1, 2, 3 ORDER BY 4 DESC`
    );
    const extensions = await q(tx, `SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_graphql','pg_net','pgsodium','supabase_vault','pg_cron') ORDER BY 1`);
    const exposedSchemaSetting = await q(
      tx,
      `SELECT r.rolname, s.setconfig::text AS setconfig
       FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname = 'authenticator'`
    );
    return toJson({ whoami, roles, memberships, schemaUsage, relations, explicitAcl, nullAcl, policies, sequenceAcl, sequences, functions, defaultAcl, schemas, extensions, connectionRoles, exposedSchemaSetting });
  });
}

async function dataApiStatus() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  if (!base) return { root_no_key: null, root_server_key: null, tables: {} as Record<string, number> };
  const st = (url: string, init?: RequestInit) => fetch(url, init).then((r) => r.status).catch(() => -1);
  const h = key ? { apikey: key, Authorization: `Bearer ${key}` } : undefined;
  const tables: Record<string, number> = {};
  // limit=0 HEAD — 행을 요청하지 않는다.
  for (const t of ['users', 'accounts', 'sessions', 'verification_tokens', 'posts', 'error_logs']) {
    tables[t] = key ? await st(`${base}/rest/v1/${t}?select=*&limit=0`, { method: 'HEAD', headers: h }) : -2;
  }
  // pg_graphql도 Data API 경유다. 스키마 조회 없는 최소 쿼리({__typename})의 status만 본다.
  const graphql = key
    ? await st(`${base}/graphql/v1`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '{__typename}' }) })
    : -2;
  return { root_no_key: await st(`${base}/rest/v1/`), root_server_key: key ? await st(`${base}/rest/v1/`, { headers: h }) : -2, graphql, tables };
}

// ── 롤백 스냅샷(SQL 텍스트만 만든다. 실행하지 않는다) ─────────────────────────────────

function quoteIdent(s: string) {
  return `"${s.replace(/"/g, '""')}"`;
}

function snapshotSql(d: Awaited<ReturnType<typeof collect>>): string {
  const lines: string[] = [];
  lines.push('-- SUPABASE_DB_SECURITY_HARDENING_V2 rollback snapshot (generated, NOT executed)');
  lines.push(`-- generated_at: ${new Date().toISOString()}`);
  lines.push('-- Restores public-schema table/view privileges for API roles, RLS flags, and policies to this snapshot.');
  lines.push('BEGIN;');
  const rels = d.relations as Row[];
  const acl = d.explicitAcl as Row[];
  for (const r of rels) {
    const t = `public.${quoteIdent(String(r.name))}`;
    lines.push(`-- ${r.name} (kind=${r.kind}, owner=${r.owner})`);
    for (const role of API_ROLES) lines.push(`REVOKE ALL ON TABLE ${t} FROM ${role};`);
    const grants = new Map<string, string[]>();
    for (const a of acl.filter((x) => x.name === r.name && (API_ROLES as readonly string[]).includes(String(x.grantee)))) {
      const g = String(a.grantee);
      grants.set(g, [...(grants.get(g) ?? []), String(a.privilege_type)]);
    }
    for (const [g, privs] of grants) lines.push(`GRANT ${[...new Set(privs)].join(', ')} ON TABLE ${t} TO ${g};`);
    if (r.kind === 'r' || r.kind === 'p') {
      lines.push(`ALTER TABLE ${t} ${r.rls ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`);
      lines.push(`ALTER TABLE ${t} ${r.force_rls ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`);
    }
  }
  const pol = d.policies as Row[];
  if (pol.length) {
    lines.push('-- policies (drop any added later, then recreate these)');
    for (const p of pol) {
      const t = `public.${quoteIdent(String(p.tablename))}`;
      const roles = String(p.roles).replace(/^\{|\}$/g, '').split(',').filter(Boolean).join(', ') || 'public';
      lines.push(`DROP POLICY IF EXISTS ${quoteIdent(String(p.policyname))} ON ${t};`);
      lines.push(
        `CREATE POLICY ${quoteIdent(String(p.policyname))} ON ${t} AS ${p.permissive} FOR ${p.cmd} TO ${roles}` +
          (p.qual != null ? ` USING (${p.qual})` : '') +
          (p.with_check != null ? ` WITH CHECK (${p.with_check})` : '') +
          ';'
      );
    }
  }
  const seqAcl = d.sequenceAcl as Row[];
  const seqNames = [...new Set(seqAcl.map((x) => String(x.name)))];
  if (seqNames.length) lines.push('-- sequences');
  for (const name of seqNames) {
    const t = `public.${quoteIdent(name)}`;
    for (const role of API_ROLES) lines.push(`REVOKE ALL ON SEQUENCE ${t} FROM ${role};`);
    const grants = new Map<string, string[]>();
    for (const a of seqAcl.filter((x) => x.name === name && (API_ROLES as readonly string[]).includes(String(x.grantee)))) {
      grants.set(String(a.grantee), [...(grants.get(String(a.grantee)) ?? []), String(a.privilege_type)]);
    }
    for (const [g, privs] of grants) lines.push(`GRANT ${[...new Set(privs)].join(', ')} ON SEQUENCE ${t} TO ${g};`);
  }
  const defAcl = (d.defaultAcl as Row[]).filter((x) => (API_ROLES as readonly string[]).includes(String(x.grantee)));
  if (defAcl.length) {
    lines.push('-- default privileges for future objects (supabase_admin entries can only be changed by supabase_admin; listed for reference)');
    const objWord: Record<string, string> = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES', n: 'SCHEMAS' };
    const groups = new Map<string, string[]>();
    for (const a of defAcl) {
      const k = `${a.for_role}|${a.schema}|${a.objtype}|${a.grantee}`;
      groups.set(k, [...(groups.get(k) ?? []), String(a.privilege_type)]);
    }
    for (const [k, privs] of groups) {
      const [forRole, schema, objtype, grantee] = k.split('|');
      const sql = `ALTER DEFAULT PRIVILEGES FOR ROLE ${forRole}${schema === '(all)' ? '' : ` IN SCHEMA ${schema}`} GRANT ${[...new Set(privs)].join(', ')} ON ${objWord[objtype] ?? objtype} TO ${grantee};`;
      lines.push(forRole === 'postgres' ? sql : `-- ${sql}`);
    }
  }
  lines.push('-- review before running; COMMIT only after verification');
  lines.push('ROLLBACK;');
  return lines.join('\n');
}

// ── 출력 ─────────────────────────────────────────────────────────────────────

const yn = (v: unknown) => (v ? 'Y' : '.');

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-db-grants-rls');
  const mode = process.argv.includes('--snapshot') ? 'snapshot' : process.argv.includes('--json') ? 'json' : 'table';
  const d = await collect();

  if (mode === 'snapshot') {
    console.log(snapshotSql(d));
    return;
  }
  const api = await dataApiStatus();
  if (mode === 'json') {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), dataApi: api, ...d }, null, 1));
    return;
  }

  const rels = d.relations as Row[];
  const tables = rels.filter((r) => r.kind === 'r' || r.kind === 'p');
  const writeAny = (r: Row, role: string) => ['insert', 'update', 'delete', 'truncate'].some((p) => r[`${role}_${p}`]);
  const allPrivs = (r: Row, role: string) => PRIVS.every((p) => r[`${role}_${p.toLowerCase()}`]);

  console.log(`# DB GRANTS / RLS AUDIT (read-only) ${new Date().toISOString()}`);
  console.log('whoami', JSON.stringify(d.whoami));
  console.log('roles', JSON.stringify(d.roles));
  console.log('memberships', JSON.stringify(d.memberships));
  console.log('schema public usage', JSON.stringify(d.schemaUsage));
  console.log('schemas(tables)', JSON.stringify(d.schemas));
  console.log('authenticator settings', JSON.stringify(d.exposedSchemaSetting));
  console.log('extensions', JSON.stringify(d.extensions));
  console.log('connection roles', JSON.stringify(d.connectionRoles));
  console.log('data api', JSON.stringify(api));
  console.log('');
  console.log(`public relations: ${rels.length} (tables ${tables.length}, other ${rels.length - tables.length})`);
  console.log(`RLS enabled: ${tables.filter((t) => t.rls).length}  disabled: ${tables.filter((t) => !t.rls).length}  forced: ${tables.filter((t) => t.force_rls).length}`);
  console.log(`anon ALL privileges: ${tables.filter((t) => allPrivs(t, 'anon')).length}  anon any write: ${tables.filter((t) => writeAny(t, 'anon')).length}  anon SELECT: ${tables.filter((t) => t.anon_select).length}`);
  console.log(`authenticated ALL: ${tables.filter((t) => allPrivs(t, 'authenticated')).length}  any write: ${tables.filter((t) => writeAny(t, 'authenticated')).length}  SELECT: ${tables.filter((t) => t.authenticated_select).length}`);
  console.log(`RLS OFF + anon write: ${tables.filter((t) => !t.rls && writeAny(t, 'anon')).length}`);
  console.log(`policies: ${(d.policies as Row[]).length}  sequences: ${(d.sequences as Row[]).length}  functions: ${(d.functions as Row[]).length}`);
  console.log('');
  console.log('kind name                                  owner      rls force pol rows~      anon:SIUDT  auth:SIUDT  svc:SIUDT');
  for (const r of rels) {
    const flags = (role: string) => ['select', 'insert', 'update', 'delete', 'truncate'].map((p) => yn(r[`${role}_${p}`])).join('');
    console.log(
      `${String(r.kind).padEnd(4)} ${String(r.name).padEnd(37)} ${String(r.owner).padEnd(10)} ${yn(r.rls).padEnd(3)} ${yn(r.force_rls).padEnd(5)} ${String(r.policy_count).padEnd(3)} ${String(r.approx_rows).padEnd(10)} ${flags('anon').padEnd(11)} ${flags('authenticated').padEnd(11)} ${flags('service_role')}`
    );
  }
  console.log('\npolicies', JSON.stringify(d.policies));
  console.log('null relacl (default owner-only privileges)', JSON.stringify(d.nullAcl));
  console.log('sequences', JSON.stringify(d.sequences));
  console.log('functions', JSON.stringify(d.functions));
  console.log('default privileges (public/all)', JSON.stringify(d.defaultAcl));
}

main()
  .catch((e) => {
    console.error('failed:', (e as { code?: string }).code ?? (e as Error).name);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
