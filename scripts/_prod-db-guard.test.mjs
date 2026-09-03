// SUPABASE_EGRESS_P0_FIX_V1 §3 — 가드 판정 로직 테스트(DB/네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideProductionDbAccess, isProductionDatabaseUrl } from './_prod-db-guard.ts';

// --- Production 판정 ---------------------------------------------------------

test('원격 관리형 DB(supabase pooler)는 Production으로 본다', () => {
  assert.equal(isProductionDatabaseUrl('postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'), true);
});

test('로컬 호스트는 Production이 아니다', () => {
  for (const h of ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']) {
    assert.equal(isProductionDatabaseUrl(`postgresql://u:p@${h}:5432/db`), false, `${h}가 Production으로 판정되면 안 된다`);
  }
});

test('DATABASE_URL이 없거나 파싱 불가하면 안전한 쪽(Production 간주)으로 처리한다', () => {
  assert.equal(isProductionDatabaseUrl(undefined), false, '설정이 없으면 애초에 접속도 못 하므로 차단 대상이 아니다');
  assert.equal(isProductionDatabaseUrl('not a url'), true, '모르는 형식을 개발용으로 낙관하면 안 된다');
});

// --- 운영 스크립트는 절대 막지 않는다 (Cron/sync 보호) -----------------------

test('OPERATIONAL은 Production이어도 항상 통과한다 — 운영 sync를 깨뜨리지 않는다', () => {
  const d = decideProductionDbAccess({ scriptClass: 'OPERATIONAL', isProductionDb: true, env: {} });
  assert.equal(d.allowed, true);
});

// --- 진단/QA는 Production에서 기본 차단 --------------------------------------

test('DIAGNOSTIC은 Production에서 기본 차단된다(egress 원인)', () => {
  const d = decideProductionDbAccess({ scriptClass: 'DIAGNOSTIC', isProductionDb: true, env: {} });
  assert.equal(d.allowed, false);
  assert.equal(d.overrideEnv, 'ALLOW_PROD_DB_READ');
});

test('DIAGNOSTIC도 명시적 opt-in이면 통과한다', () => {
  const d = decideProductionDbAccess({ scriptClass: 'DIAGNOSTIC', isProductionDb: true, env: { ALLOW_PROD_DB_READ: '1' } });
  assert.equal(d.allowed, true);
});

test('DIAGNOSTIC은 로컬 DB에서는 제한 없이 돈다', () => {
  const d = decideProductionDbAccess({ scriptClass: 'DIAGNOSTIC', isProductionDb: false, env: {} });
  assert.equal(d.allowed, true);
});

// --- backfill은 별도(더 강한) 승인 키를 쓴다 ---------------------------------

test('BACKFILL은 read 승인만으로는 통과하지 못한다(write 승인이 별도)', () => {
  const d = decideProductionDbAccess({ scriptClass: 'BACKFILL', isProductionDb: true, env: { ALLOW_PROD_DB_READ: '1' } });
  assert.equal(d.allowed, false);
  assert.equal(d.overrideEnv, 'ALLOW_PROD_DB_WRITE');
});

test('BACKFILL은 ALLOW_PROD_DB_WRITE=1이어야 통과한다', () => {
  const d = decideProductionDbAccess({ scriptClass: 'BACKFILL', isProductionDb: true, env: { ALLOW_PROD_DB_WRITE: '1' } });
  assert.equal(d.allowed, true);
});

test('"1"이 아닌 값은 승인으로 인정하지 않는다(오타/true 등으로 열리지 않게)', () => {
  for (const v of ['true', 'yes', '0', '', 'TRUE']) {
    const d = decideProductionDbAccess({ scriptClass: 'DIAGNOSTIC', isProductionDb: true, env: { ALLOW_PROD_DB_READ: v } });
    assert.equal(d.allowed, false, `ALLOW_PROD_DB_READ=${v} 가 통과되면 안 된다`);
  }
});
