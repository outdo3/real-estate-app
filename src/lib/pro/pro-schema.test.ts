import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as R from './rules';

// REALTOR_PRO_MVP_V1 — migration.sql ↔ rules.ts 허용 목록 · 보안 조항 고정(파일만 읽음, DB 없음).

const ROOT = resolve(__dirname, '../../..');
const SQL = readFileSync(resolve(ROOT, 'prisma/migrations/20260930090000_realtor_pro_mvp_v1/migration.sql'), 'utf8');
const TABLES = ['realtor_profiles', 'realtor_subscriptions', 'realtor_listings', 'realtor_listing_notes', 'realtor_customers', 'realtor_customer_preferences', 'realtor_matches', 'realtor_followups', 'realtor_briefings', 'realtor_audit_logs'];
const OWNED = ['realtor_listings', 'realtor_listing_notes', 'realtor_customers', 'realtor_customer_preferences', 'realtor_matches', 'realtor_followups', 'realtor_briefings'];

function checkList(name: string): string[] {
  const m = SQL.match(new RegExp(`"${name}" CHECK \\([^)]*?IN \\(([^)]*)\\)`));
  assert.ok(m, name);
  return m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

test('CHECK 허용 목록 = rules.ts 상수', () => {
  const pairs: [string, readonly string[]][] = [
    ['realtor_profiles_status_check', R.PROFILE_STATUSES],
    ['realtor_subscriptions_plan_check', R.SUBSCRIPTION_PLANS],
    ['realtor_subscriptions_status_check', R.SUBSCRIPTION_STATUSES],
    ['realtor_listings_deal_type_check', R.DEAL_TYPES],
    ['realtor_listings_floor_band_check', R.FLOOR_BANDS],
    ['realtor_listings_tenant_status_check', R.TENANT_STATUSES],
    ['realtor_listings_repair_status_check', R.REPAIR_STATUSES],
    ['realtor_listings_viewing_method_check', R.VIEWING_METHODS],
    ['realtor_listings_source_check', R.LISTING_SOURCES],
    ['realtor_listing_notes_kind_check', R.NOTE_KINDS],
    ['realtor_customers_status_check', R.CUSTOMER_STATUSES],
    ['realtor_customers_consent_status_check', R.CONSENT_STATUSES],
    ['realtor_matches_state_check', R.MATCH_STATES],
    ['realtor_matches_confidence_check', R.MATCH_CONFIDENCES],
    ['realtor_followups_kind_check', R.FOLLOWUP_KINDS],
    ['realtor_followups_status_check', R.FOLLOWUP_STATUSES],
    ['realtor_followups_repeat_rule_check', R.REPEAT_RULES],
    ['realtor_audit_logs_actor_role_check', R.AUDIT_ACTOR_ROLES],
    ['realtor_audit_logs_action_check', R.AUDIT_ACTIONS],
  ];
  for (const [name, list] of pairs) assert.deepEqual(checkList(name), [...list], name);
});

test('10개 테이블 전부 생성 · API role REVOKE · RLS ENABLE(FORCE 없음) · 재실행 방지 전제', () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`CREATE TABLE "${t}"`), t);
    assert.ok(SQL.includes(`'${t}'`), `${t} in pro_tables loop`);
  }
  assert.match(SQL, /REVOKE ALL ON TABLE public\.%I FROM %I/);
  assert.match(SQL, /ENABLE ROW LEVEL SECURITY/);
  assert.ok(!/FORCE ROW LEVEL SECURITY/.test(SQL));
  assert.match(SQL, /already exists/);
  assert.match(SQL, /set_config\('lock_timeout', '3s', true\)/);
  assert.match(SQL, /^DO \$\$/m);
});

test('소유자 정책: 소유 테이블마다 SELECT/INSERT/UPDATE/DELETE, 쓰기는 VERIFIED만, 감사로그·프로필 쓰기 정책 없음', () => {
  for (const t of OWNED) {
    for (const op of ['select', 'insert', 'update', 'delete']) assert.match(SQL, new RegExp(`CREATE POLICY "${t}_owner_${op}" ON "${t}" FOR ${op.toUpperCase()}`), `${t} ${op}`);
    const ins = SQL.match(new RegExp(`CREATE POLICY "${t}_owner_insert"[^;]*;`))![0];
    assert.match(ins, /current_setting\('app\.realtor_id', true\)/);
    assert.match(ins, /p\."status" = 'VERIFIED'/);
  }
  assert.ok(!/CREATE POLICY "realtor_audit_logs/.test(SQL));
  assert.ok(!/CREATE POLICY "realtor_profiles_owner_(insert|update|delete)"/.test(SQL));
});

test('기존 테이블은 바꾸지 않는다(users는 FK 참조만)', () => {
  const stmts = SQL.split(';').map((s) => s.trim()).filter((s) => /^(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b/i.test(s.replace(/^--.*$/gm, '').trim()));
  for (const s of stmts) {
    const body = s.replace(/^--.*$/gm, '').trim();
    assert.match(body, /^ALTER TABLE "realtor_/, body.slice(0, 80));
  }
  assert.ok(!/DROP\s/i.test(SQL.replace(/^--.*$/gm, '')));
  assert.match(SQL, /REFERENCES "users"\("id"\) ON DELETE CASCADE/);
});

test('스키마: users에는 relation 필드만 추가(컬럼 없음) · 연락처는 *_enc/*_hash만', () => {
  const schema = readFileSync(resolve(ROOT, 'prisma/schema.prisma'), 'utf8');
  const user = schema.slice(schema.indexOf('model User {'), schema.indexOf('@@map("users")'));
  assert.match(user, /realtorProfile RealtorProfile\?/);
  const pro = schema.slice(schema.indexOf('model RealtorProfile'));
  assert.ok(!/\b(phone|email|ownerPhone|licenseNumber)\s+String/.test(pro), '평문 연락처 컬럼');
  assert.ok(!/users[^\n]*ADD COLUMN/.test(SQL));
});
