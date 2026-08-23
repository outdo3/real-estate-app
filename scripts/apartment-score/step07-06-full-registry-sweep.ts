// E-JIP SCORE V2 STEP 0.7 §9/§16 — 1,398건 전체에 대해 2-tier 건축물대장 조회
// (총괄표제부→표제부 fallback, §9 pilot에서 47/48=97.9% 성공 확인된 방식) 전수 실행.
// 결과를 JSON으로 저장해 §45(수준 A-D 판정)/§47(recovery simulation)/§16(집계)이
// 재사용한다. READ-ONLY(조회만, DB write 없음). 소요시간 큼(약 1,398건 x 최대 2회
// 호출 x 1.5초 throttle ≈ 최대 70분) — 백그라운드 실행 전제.
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const OUT_PATH = path.resolve(__dirname, 'output/step07-registry-sweep.json');

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { loadUniverse } = await import('./lib/step07-universe');
  const { probeRegistryTwoTier } = await import('./lib/step07-registry-probe');

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  const { molitCandidates } = await loadUniverse();
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: molitCandidates.map((r) => r.aptSeq) } },
    select: { aptSeq: true, umdCd: true },
  });
  const umdCdMap = new Map(masters.map((m) => [m.aptSeq!, m.umdCd]));
  await prisma.$disconnect();

  const results: any[] = [];
  const startedAt = Date.now();
  for (let i = 0; i < molitCandidates.length; i++) {
    const r = molitCandidates[i];
    const umdCd = umdCdMap.get(r.aptSeq);
    let probe;
    if (!umdCd || !r.jibun) {
      probe = { status: 'parse_error', tier: null, totalHouseholds: null, mainBuildingCount: null, parkingCount: null, mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, bldNm: null, mainPurpsCdNm: null, recordCount: 0 };
    } else {
      probe = await probeRegistryTwoTier(r.lawdCd!, umdCd, r.jibun);
    }
    results.push({ ...r, probe });
    if ((i + 1) % 50 === 0 || i === molitCandidates.length - 1) {
      const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`[${i + 1}/${molitCandidates.length}] ${elapsedMin}분 경과`);
      fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 1));
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 1));

  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.probe.status] = (byStatus[r.probe.status] ?? 0) + 1;
    if (r.probe.tier) byTier[r.probe.tier] = (byTier[r.probe.tier] ?? 0) + 1;
  }
  console.log('\n최종 상태 분포:', JSON.stringify(byStatus, null, 1));
  console.log('성공 tier 분포:', JSON.stringify(byTier, null, 1));
  console.log(`결과 저장: ${OUT_PATH}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
