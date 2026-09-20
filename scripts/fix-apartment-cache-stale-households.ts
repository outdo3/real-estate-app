/**
 * APARTMENT_CACHE_STALE_HOUSEHOLDS_CORRECTION_V1 — `apartments` 캐시의 **세대수만** 고친다.
 *
 * 배경: BUSAN_BUILDING_LEDGER_AUTO_SAFE_CORRECTION_V1에서 master는 정확히 보정됐지만,
 * 상세 API의 tier1 캐시가 master보다 먼저 읽혀 옛 세대수를 계속 노출한다. tier1 게이트는
 * `parkingCount && far && bcr && approvalDate`이고 **세대수는 게이트에 없다** — 그래서
 * 네 필드가 채워진 캐시 행은 세대수가 낡아도 그대로 통과한다(실측: 경동 72세대).
 *
 * 승인 범위(사용자 승인 완료): 아래 **정확히 2행**의 `total_households`.
 *   26350-2   해운대경동제이드(우동 974)   72 -> 892
 *   26350-278 우성빌라(중동 1505-3)          4 -> 15
 * 그 밖 어떤 행도, 어떤 컬럼도 건드리지 않는다 — parking · FAR · BCR · approvalDate ·
 * name · jibun · 좌표 · **master 전부 불변**. INSERT/DELETE 0.
 *
 * 안전장치:
 *   1. 현재 Production에서 baseline을 다시 읽어 72 / 4와 정확히 일치하는지 확인(다르면 STOP)
 *   2. master가 892 / 15인지 확인(다르면 STOP)
 *   3. 대상이 정확히 2행인지 확인(다르면 STOP)
 *   4. rollback artifact를 **쓰기 전에** 생성
 *   5. UPDATE는 행마다 `id` + `total_households = 기대 old`일 때만(optimistic guard)
 *
 * 기본은 DRY RUN. 실제 쓰기는 `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1`.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/fix-apartment-cache-stale-households.ts
 *   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/fix-apartment-cache-stale-households.ts --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const OUT = path.resolve(__dirname, '../tmp/apartment-cache-stale');

/** 승인된 대상. 지번까지 적어 identity를 이름에 의존하지 않는다. */
export const TARGETS = [
  { aptSeq: '26350-2', dong: '우동', jibun: '974', cacheName: '해운대경동제이드', oldHouseholds: 72, newHouseholds: 892 },
  { aptSeq: '26350-278', dong: '중동', jibun: '1505-3', cacheName: '우성빌라(백세해운대빌라2차)', oldHouseholds: 4, newHouseholds: 15 },
] as const;

export interface BaselineRow { id: number; total_households: number | null }

/** baseline이 승인 시점과 정확히 같은지. 하나라도 어긋나면 쓰지 않는다. */
export function baselineMatches(
  target: { oldHouseholds: number; newHouseholds: number },
  cache: { total_households: number | null } | undefined,
  master: { total_households: number | null } | undefined,
): { ok: boolean; reason: string } {
  if (!cache) return { ok: false, reason: '캐시 행 없음' };
  if (!master) return { ok: false, reason: 'master 행 없음' };
  if (Number(cache.total_households) !== target.oldHouseholds) {
    return { ok: false, reason: `캐시 세대수 ${cache.total_households} != 기대 ${target.oldHouseholds}` };
  }
  if (Number(master.total_households) !== target.newHouseholds) {
    return { ok: false, reason: `master 세대수 ${master.total_households} != 기대 ${target.newHouseholds}` };
  }
  return { ok: true, reason: 'baseline 일치' };
}

async function main() {
  const apply = process.argv.includes('--apply');
  fs.mkdirSync(OUT, { recursive: true });

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'fix-apartment-cache-stale-households.ts');
  const prisma = new PrismaClient();

  // ── §2 현재 Production baseline 재확인 ──
  const dongs = TARGETS.map((t) => t.dong);
  const jibuns = TARGETS.map((t) => t.jibun);
  const snap = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const cache = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT id, name, dong, jibun, lawd_cd, total_households, parking_count, far, bcr, approval_date, updated_at
       FROM apartments WHERE dong = ANY($1::text[]) AND jibun = ANY($2::text[])`, dongs, jibuns);
    const master = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, umd_name, jibun, total_households, parking_count, parking_per_household,
              floor_area_ratio, building_coverage_ratio, use_approval_date
       FROM apartment_masters WHERE apt_seq = ANY($1::text[])`, TARGETS.map((t) => t.aptSeq));
    const totals = (await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT COUNT(*)::int AS cache_rows FROM apartments`))[0];
    return { cache, master, totals };
  }, { timeout: 300_000 });

  const cacheBy = new Map(snap.cache.map((c) => [`${c.dong}|${c.jibun}`, c]));
  const masterBy = new Map(snap.master.map((m) => [m.apt_seq, m]));

  // ── §15 STOP RULE ──
  const stops: string[] = [];
  const plan: Record<string, any>[] = [];
  for (const t of TARGETS) {
    const c = cacheBy.get(`${t.dong}|${t.jibun}`);
    const m = masterBy.get(t.aptSeq);
    const v = baselineMatches(t, c as any, m as any);
    if (!v.ok) stops.push(`${t.aptSeq}: ${v.reason}`);
    plan.push({
      aptSeq: t.aptSeq, cacheId: c?.id ?? null, cacheName: c?.name ?? null, dong: t.dong, jibun: t.jibun,
      oldHouseholds: c?.total_households == null ? null : Number(c.total_households), newHouseholds: t.newHouseholds,
      masterHouseholds: m?.total_households == null ? null : Number(m.total_households),
      // 승인 밖 캐시 필드 — 스냅샷만 남기고 건드리지 않는다
      keepParking: c?.parking_count == null ? null : Number(c.parking_count),
      keepFar: c?.far == null ? null : Number(c.far),
      keepBcr: c?.bcr == null ? null : Number(c.bcr),
      keepApprovalDate: c?.approval_date ?? null,
      masterApprovalDate: m?.use_approval_date ?? null,
      baseline: v.reason,
    });
  }
  // 같은 dong+jibun을 가리키는 캐시 행이 대상 밖에 더 있으면 어느 행이 읽힐지 모호해진다.
  if (snap.cache.length !== TARGETS.length) stops.push(`대상 지번의 캐시 행이 ${snap.cache.length}개(기대 ${TARGETS.length})`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // ── §6 rollback artifact — 쓰기 전에 ──
  const rollbackFile = path.join(OUT, `rollback-${stamp}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify({
    at: new Date().toISOString(), plan,
    sql: plan.filter((p) => p.cacheId != null)
      .map((p) => `UPDATE apartments SET total_households = ${p.oldHouseholds == null ? 'NULL' : p.oldHouseholds} WHERE id = ${p.cacheId};`).join('\n'),
    note: '되돌림은 세대수 한 컬럼만 원복한다. 다른 컬럼은 애초에 쓰지 않았다.',
  }, null, 2));
  console.log(`[ROLLBACK] ${rollbackFile}`);
  console.log('[PLAN]', JSON.stringify({ targets: TARGETS.length, cacheRowsTotal: snap.totals.cache_rows, plan }, null, 2));

  if (stops.length) { console.error('[STOP]', stops.join(' / ')); await prisma.$disconnect(); process.exit(2); }
  if (!apply) { console.log('[DRY RUN] 쓰기 0 — --apply 없이 종료'); await prisma.$disconnect(); return; }

  // ── §7 UPDATE — 정확히 2행, 세대수 한 컬럼, 행마다 optimistic guard ──
  const applied: Record<string, unknown>[] = [];
  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE apartments SET total_households = $1 WHERE id = $2 AND total_households = $3`,
        p.newHouseholds, p.cacheId, p.oldHouseholds);
      applied.push({ aptSeq: p.aptSeq, cacheId: p.cacheId, old: p.oldHouseholds, new: p.newHouseholds, affected: n });
      if (n !== 1) throw new Error(`optimistic guard 불일치 ${p.aptSeq}: 영향 행 ${n} — 트랜잭션 롤백`);
    }
  }, { timeout: 300_000 });

  const total = applied.reduce((s, a) => s + (a.affected as number), 0);
  console.log(`[APPLIED] 캐시 세대수 ${total}행`);
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), applied }, null, 2));
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
