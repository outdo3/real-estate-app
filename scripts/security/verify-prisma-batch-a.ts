/**
 * SUPABASE_DB_SECURITY_HARDENING_V2 BATCH A — Prisma(앱 경로) 읽기 + 롤백 쓰기 확인.
 *
 * 읽기: 7개 테이블 count + findFirst(id만 조회, 출력하지 않음) + NextAuth adapter와 같은 모양의 조회.
 * 쓰기: 한 트랜잭션 안에서 QA 전용 사용자와 연결 행(account/session/verification token/favorite/recent view/preference)을
 *       만들고·수정·삭제한 뒤 **항상 롤백**한다(sentinel 예외). 기존 사용자 행은 읽지도 수정하지도 않는다.
 *       끝에 count가 before와 같은지 확인한다. 값·id·이메일은 출력하지 않는다(개수와 PASS/FAIL만).
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/security/verify-prisma-batch-a.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
const ROLLBACK = 'BATCH_A_ROLLBACK_SENTINEL';

async function counts() {
  const [users, accounts, sessions, verificationTokens, favorites, recentViews, userPreferences] = await Promise.all([
    prisma.user.count(),
    prisma.account.count(),
    prisma.session.count(),
    prisma.verificationToken.count(),
    prisma.favorite.count(),
    prisma.recentView.count(),
    prisma.userPreference.count(),
  ]);
  return { users, accounts, sessions, verificationTokens, favorites, recentViews, userPreferences };
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'verify-prisma-batch-a');
  const results: [string, boolean, string][] = [];
  const record = (name: string, pass: boolean, detail = '') => {
    results.push([name, pass, detail]);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  };
  const errCode = (e: unknown) => (e as { code?: string }).code ?? (e as Error).name;

  // ── 읽기 ──
  let before: Awaited<ReturnType<typeof counts>> | null = null;
  try {
    before = await counts();
    record('read: count on 7 tables', true, '(values not printed)');
  } catch (e) {
    record('read: count on 7 tables', false, errCode(e));
  }
  for (const [label, fn] of [
    ['read: users findFirst (adapter-style select)', () => prisma.user.findFirst({ select: { id: true, role: true, banned: true } })],
    ['read: accounts findFirst', () => prisma.account.findFirst({ select: { id: true } })],
    ['read: favorites findMany', () => prisma.favorite.findMany({ take: 1, select: { id: true } })],
    ['read: recent_views findMany', () => prisma.recentView.findMany({ take: 1, orderBy: { viewedAt: 'desc' }, select: { id: true } })],
    ['read: user_preferences findFirst', () => prisma.userPreference.findFirst({ select: { userId: true } })],
    ['read: users with relations include', () => prisma.user.findFirst({ select: { id: true, _count: { select: { favorites: true, recentViews: true, accounts: true } } } })],
  ] as const) {
    try {
      await fn();
      record(label, true);
    } catch (e) {
      record(label, false, errCode(e));
    }
  }

  // ── 롤백 쓰기 ──
  const tag = randomUUID().replace(/-/g, '').slice(0, 16);
  const steps: string[] = [];
  let writeError: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: `[qa] batch-a ${tag}`, email: `qa-batch-a-${tag}@invalid.local` }, select: { id: true } });
      steps.push('user.create');
      await tx.user.update({ where: { id: user.id }, data: { name: `[qa] batch-a ${tag} updated` } });
      steps.push('user.update');
      await tx.account.create({ data: { userId: user.id, type: 'oauth', provider: 'qa-batch-a', providerAccountId: tag } });
      steps.push('account.create');
      await tx.session.create({ data: { userId: user.id, sessionToken: `qa-batch-a-${tag}`, expires: new Date(Date.now() + 60_000) } });
      steps.push('session.create');
      await tx.verificationToken.create({ data: { identifier: `qa-batch-a-${tag}`, token: `qa-batch-a-${tag}`, expires: new Date(Date.now() + 60_000) } });
      steps.push('verificationToken.create');
      await tx.favorite.create({ data: { userId: user.id, lawdCd: '00000', dong: 'qa', name: `qa-${tag}` } });
      steps.push('favorite.create');
      await tx.recentView.upsert({
        where: { userId_lawdCd_dong_name: { userId: user.id, lawdCd: '00000', dong: 'qa', name: `qa-${tag}` } },
        create: { userId: user.id, lawdCd: '00000', dong: 'qa', name: `qa-${tag}` },
        update: { viewedAt: new Date() },
      });
      steps.push('recentView.upsert');
      await tx.userPreference.upsert({ where: { userId: user.id }, create: { userId: user.id, purposes: ['qa'] }, update: { purposes: ['qa'] } });
      steps.push('userPreference.upsert');
      await tx.favorite.deleteMany({ where: { userId: user.id } });
      steps.push('favorite.deleteMany');
      await tx.user.delete({ where: { id: user.id } }); // cascade: accounts/sessions/recent_views/user_preferences
      steps.push('user.delete(cascade)');
      await tx.verificationToken.delete({ where: { token: `qa-batch-a-${tag}` } });
      steps.push('verificationToken.delete');
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if ((e as Error).message !== ROLLBACK) writeError = errCode(e);
  }
  record('write (rolled back): create/update/upsert/delete on 7 tables', writeError === null && steps.length === 11, writeError ? `failed after [${steps.join(', ')}]: ${writeError}` : `${steps.length} steps`);

  try {
    const after = await counts();
    record('no persistent change: counts identical after rollback', before !== null && JSON.stringify(before) === JSON.stringify(after));
    const leftover = await prisma.user.count({ where: { email: `qa-batch-a-${tag}@invalid.local` } });
    record('no QA user left behind', leftover === 0);
  } catch (e) {
    record('post-rollback count', false, errCode(e));
  }

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
