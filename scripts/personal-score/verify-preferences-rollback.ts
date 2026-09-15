/**
 * PERSONALIZED_SCORE_V1 P2-A — 선호 API 판정 + 실제 Prisma 저장소를 Production DB에서 **롤백 트랜잭션**으로 검증.
 *
 * QA 전용 사용자 2명을 트랜잭션 안에서 만들고 handleGet/PutPreferences + createPreferencesStore(tx)로
 * 저장·부분 갱신·초기화(DB NULL)·교차 사용자 격리·잘못된 입력 거부를 확인한 뒤 sentinel 예외로 전부 되돌린다.
 * 실제 사용자 행은 읽지도 바꾸지도 않는다(끝에 전체 행 수·지문만 비교). 출력은 PASS/FAIL과 개수뿐.
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/personal-score/verify-preferences-rollback.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';
import { handleGetPreferences, handlePutPreferences } from '../../src/lib/preferences-handlers';
import { createPreferencesStore } from '../../src/lib/preferences-prisma-store';

const prisma = new PrismaClient();
const ROLLBACK = 'P2A_ROLLBACK_SENTINEL';
const VALID = { transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 };

async function fingerprint() {
  const r = await prisma.$queryRawUnsafe<{ n: number; fit_non_null: number; fp: string | null }[]>(
    `SELECT count(*)::int n, count(fit_importance)::int fit_non_null,
            md5(string_agg(user_id || ':' || purposes::text || ':' || coalesce(fit_importance::text,'∅') || ':' || updated_at::text, '|' ORDER BY user_id)) fp
     FROM user_preferences`
  );
  return r[0];
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'personal-score/verify-preferences-rollback');
  const results: [string, boolean][] = [];
  const check = (name: string, pass: boolean) => {
    results.push([name, pass]);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  };

  const before = await fingerprint();
  const tag = randomUUID().replace(/-/g, '').slice(0, 12);
  let unexpected: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const store = createPreferencesStore(tx);
      const a = await tx.user.create({ data: { name: `[qa] p2a-a ${tag}` }, select: { id: true } });
      const b = await tx.user.create({ data: { name: `[qa] p2a-b ${tag}` }, select: { id: true } });
      const authA = { error: null, status: 200, user: { id: a.id } };
      const authB = { error: null, status: 200, user: { id: b.id } };
      const rawFit = async (id: string) =>
        (await tx.$queryRawUnsafe<{ is_null: boolean; json_type: string | null }[]>(
          `SELECT fit_importance IS NULL AS is_null, jsonb_typeof(fit_importance) AS json_type FROM user_preferences WHERE user_id = $1`,
          id
        ))[0];

      const g0 = await handleGetPreferences(authA, store);
      check('GET without row → purposes [] + fitImportance null', JSON.stringify(g0.body) === JSON.stringify({ success: true, data: { purposes: [], fitImportance: null } }));

      const p1 = await handlePutPreferences(authA, { purposes: ['BUY'] }, store);
      check('PUT purposes only creates row, fitImportance stays null', p1.status === 200 && JSON.stringify(p1.body) === JSON.stringify({ success: true, data: { purposes: ['BUY'], fitImportance: null } }));
      check('new row fit_importance is SQL NULL (not JSON null)', (await rawFit(a.id)).is_null === true);

      const p2 = await handlePutPreferences(authA, { fitImportance: VALID }, store);
      check('PUT fitImportance only → purposes preserved', JSON.stringify(p2.body) === JSON.stringify({ success: true, data: { purposes: ['BUY'], fitImportance: VALID } }));
      check('stored as JSON object', (await rawFit(a.id)).json_type === 'object');

      const p3 = await handlePutPreferences(authA, { purposes: ['SELL', 'JEONSE'] }, store);
      check('PUT purposes only → fitImportance preserved', JSON.stringify(p3.body) === JSON.stringify({ success: true, data: { purposes: ['SELL', 'JEONSE'], fitImportance: VALID } }));

      const bad = await handlePutPreferences(authA, { fitImportance: { ...VALID, living: 6 } }, store);
      const afterBad = await handleGetPreferences(authA, store);
      check('invalid fitImportance → 400, stored value unchanged', bad.status === 400 && JSON.stringify(afterBad.body) === JSON.stringify(p3.body));

      const gB = await handleGetPreferences(authB, store);
      check('user B cannot see user A settings', JSON.stringify(gB.body) === JSON.stringify({ success: true, data: { purposes: [], fitImportance: null } }));
      await handlePutPreferences(authB, { userId: a.id, fitImportance: { transport: 1, living: 1, newness: 1, parking: 1, elementarySchoolAccess: 1 } }, store);
      const gA = await handleGetPreferences(authA, store);
      check('user B write (with userId in body) does not touch user A', JSON.stringify(gA.body) === JSON.stringify(p3.body));

      const reset = await handlePutPreferences(authA, { fitImportance: null }, store);
      const raw = await rawFit(a.id);
      check('reset → fitImportance null, purposes kept, SQL NULL', JSON.stringify(reset.body) === JSON.stringify({ success: true, data: { purposes: ['SELL', 'JEONSE'], fitImportance: null } }) && raw.is_null === true);

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) unexpected = (e as { code?: string }).code ?? (e as Error).name;
  }
  check('transaction rolled back (no unexpected error)', unexpected === null);

  const after = await fingerprint();
  check('user_preferences rows/fingerprint identical after rollback', JSON.stringify(before) === JSON.stringify(after));
  check('no QA user left behind', (await prisma.user.count({ where: { name: { startsWith: `[qa] p2a-` } } })) === 0);
  console.log(`rows=${after.n} fit_importance_non_null=${after.fit_non_null}`);

  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('failed:', (e as { code?: string }).code ?? (e as Error).name);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
