// E-JIP SCORE V2 STEP 0.7 §9 — 1,398건 registry 재조회 전면 실행 전, 소규모 pilot으로
// 성공/실패 분포를 먼저 확인한다(무조건 전수부터 돌리지 않음 — API 쿼터/응답 패턴
// 사전 확인 원칙). 8개 구·군에서 각 3건씩 표본. READ-ONLY(조회만, DB write 없음).
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { loadUniverse } = await import('./lib/step07-universe');
  const { probeRegistryTwoTier: probeRegistry } = await import('./lib/step07-registry-probe');

  const { molitCandidates } = await loadUniverse();
  const byLawd = new Map<string, typeof molitCandidates>();
  for (const r of molitCandidates) {
    const key = r.lawdCd ?? 'null';
    if (!byLawd.has(key)) byLawd.set(key, []);
    byLawd.get(key)!.push(r);
  }
  const sample: typeof molitCandidates = [];
  for (const [, rows] of byLawd) sample.push(...rows.slice(0, 3));
  console.log(`pilot 표본: ${sample.length}건 (${byLawd.size}개 구·군 x 최대 3건) — 2-tier(총괄표제부→표제부 fallback)`);

  const umdCdMap = new Map<string, string | null>();
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: sample.map((r) => r.aptSeq) } },
    select: { aptSeq: true, umdCd: true },
  });
  for (const m of masters) umdCdMap.set(m.aptSeq!, m.umdCd);

  const results: any[] = [];
  for (const r of sample) {
    const umdCd = umdCdMap.get(r.aptSeq);
    if (!umdCd) { results.push({ ...r, probe: { status: 'parse_error', tier: null } }); continue; }
    const probe = await probeRegistry(r.lawdCd!, umdCd, r.jibun!);
    results.push({ ...r, probe });
    const nameNote = probe.status === 'success' && probe.bldNm
      ? (probe.bldNm.replace(/\s+/g, '').replace(/아파트$/, '') === r.normalizedName ? 'name=일치' : `name=불일치(registry="${probe.bldNm}")`)
      : '';
    console.log(`${r.aptSeq} ${r.aptName}(${r.dong} ${r.jibun}): ${probe.status}${probe.tier ? `[${probe.tier}]` : ''}${probe.status === 'success' ? ` households=${probe.totalHouseholds} purpose=${probe.mainPurpsCdNm} ${nameNote}` : ''}`);
  }

  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.probe.status] = (byStatus[r.probe.status] ?? 0) + 1;
    if (r.probe.tier) byTier[r.probe.tier] = (byTier[r.probe.tier] ?? 0) + 1;
  }
  console.log('\n상태 분포:', JSON.stringify(byStatus, null, 1));
  console.log('성공 tier 분포:', JSON.stringify(byTier, null, 1));
  const nonResidential = results.filter((r) => r.probe.status === 'success' && r.probe.mainPurpsCdNm && r.probe.mainPurpsCdNm !== '공동주택');
  console.log(`주용도≠공동주택(universe 재검토 필요): ${nonResidential.length}건`, nonResidential.map((r: any) => `${r.aptSeq}(${r.probe.mainPurpsCdNm})`));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
