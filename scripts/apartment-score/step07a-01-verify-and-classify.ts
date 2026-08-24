// E-JIP SCORE V2 STEP 0.7-A §4 — RECOVERY_HIGH universe 재생성.
// 현재 DB로 STEP 0.7 universe(loadUniverse)를 다시 실행하고, 같은 날 STEP 0.7이
// 이미 라이브 호출로 확보한 output/step07-registry-sweep.json(1,398건 2-tier
// registry 조회 결과)의 aptSeq 집합과 정확히 일치하는지 검증한다. 정부 API를
// 불필요하게 재호출(최대 70분, rate limit 위험)하지 않기 위한 안전한 재사용 —
// 단, 조회 결과(probe)만 재사용하고 aptName/buildYear/jibun/dong 등 식별 입력은
// 전부 "지금" DB에서 다시 읽어 resolver에 넣는다(§4 "현재 DB 기준으로 다시 실행"
// 요구를 만족: 판정 입력은 fresh, 외부 API 원천 데이터만 캐시 재사용).
// DRIFT가 발견되면(신규/삭제/jibun-dong 변경 row) 그 row만 별도로 표시하고
// 전체 재실행 여부를 판단할 수 있게 한다(STOP 조건 아님, 정보 제공).
import fs from 'fs';
import path from 'path';

const SWEEP_PATH = path.resolve(__dirname, 'output/step07-registry-sweep.json');
const OUT_PATH = path.resolve(__dirname, 'output/step07a-recovery-classification.json');

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { loadUniverse } = await import('./lib/step07-universe');
  const { classifyRecovery } = await import('./lib/step07-recovery-resolver');
  const { probeRegistryTwoTier } = await import('./lib/step07-registry-probe');

  const { molitCandidates, highRisk, noEvidence } = await loadUniverse();
  console.log(`[재현] 고위험: ${highRisk.length}건, MOLIT 복구후보: ${molitCandidates.length}건, 증거없음: ${noEvidence.length}건`);

  const sweepRaw = JSON.parse(fs.readFileSync(SWEEP_PATH, 'utf-8')) as any[];
  const sweepByAptSeq = new Map(sweepRaw.map((r) => [r.aptSeq, r]));

  const currentSet = new Set(molitCandidates.map((r) => r.aptSeq));
  const sweepSet = new Set(sweepRaw.map((r) => r.aptSeq));

  const newSinceSweep = [...currentSet].filter((s) => !sweepSet.has(s));
  const removedSinceSweep = [...sweepSet].filter((s) => !currentSet.has(s));

  const jibunDongDrift: Array<{ aptSeq: string; before: string; after: string }> = [];
  for (const r of molitCandidates) {
    const cached = sweepByAptSeq.get(r.aptSeq);
    if (!cached) continue;
    const before = `${cached.dong ?? ''}/${cached.jibun ?? ''}`;
    const after = `${r.dong ?? ''}/${r.jibun ?? ''}`;
    if (before !== after) jibunDongDrift.push({ aptSeq: r.aptSeq, before, after });
  }

  console.log(`\n[DRIFT] 신규(캐시 스윕 이후 새로 조건 충족): ${newSinceSweep.length}건`);
  console.log(`[DRIFT] 제거(캐시 스윕 당시엔 있었으나 지금은 조건 불충족/row 삭제): ${removedSinceSweep.length}건`);
  console.log(`[DRIFT] jibun/dong 값 변경: ${jibunDongDrift.length}건`);
  if (newSinceSweep.length) console.log('  신규 aptSeq:', newSinceSweep.slice(0, 20));
  if (removedSinceSweep.length) console.log('  제거 aptSeq:', removedSinceSweep.slice(0, 20));
  if (jibunDongDrift.length) console.log('  변경 상세(최대 20):', JSON.stringify(jibunDongDrift.slice(0, 20), null, 1));

  const driftTotal = newSinceSweep.length + removedSinceSweep.length + jibunDongDrift.length;
  console.log(`\n[DRIFT] 총 drift: ${driftTotal}건 / 전체 ${molitCandidates.length}건 (${(100 * driftTotal / molitCandidates.length).toFixed(2)}%)`);

  // removed 건은 classification 대상에서 자동 제외(현재 DB 조건 불충족이므로 당연히 후보 아님).
  // new 건은 캐시에 registry probe가 없으므로 그 건에 한해서만 라이브로 개별 조회(전수 재조회 아님).
  const rowsForClassification: Array<any> = [];
  for (const r of molitCandidates) {
    const cached = sweepByAptSeq.get(r.aptSeq);
    if (cached) {
      rowsForClassification.push({ ...r, probe: cached.probe });
    }
  }

  if (newSinceSweep.length > 0) {
    console.log(`\n[LIVE PROBE] 캐시에 없는 신규 ${newSinceSweep.length}건만 개별 registry 조회...`);
    const masters = await prisma.apartmentMaster.findMany({
      where: { aptSeq: { in: newSinceSweep } },
      select: { aptSeq: true, umdCd: true },
    });
    const umdCdMap = new Map(masters.map((m) => [m.aptSeq!, m.umdCd]));
    for (const seq of newSinceSweep) {
      const r = molitCandidates.find((x) => x.aptSeq === seq)!;
      const umdCd = umdCdMap.get(seq);
      const probe = (!umdCd || !r.jibun)
        ? { status: 'parse_error', tier: null, totalHouseholds: null, mainBuildingCount: null, parkingCount: null, mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, bldNm: null, mainPurpsCdNm: null, approvalYear: null, recordCount: 0 }
        : await probeRegistryTwoTier(r.lawdCd!, umdCd, r.jibun);
      rowsForClassification.push({ ...r, probe });
    }
  }

  const classified = rowsForClassification.map((r) => ({
    ...r,
    recovery: classifyRecovery({ aptSeq: r.aptSeq, aptName: r.aptName, buildYear: r.builtYear, probe: r.probe }),
  }));

  const byLevel: Record<string, number> = {};
  for (const c of classified) byLevel[c.recovery.level] = (byLevel[c.recovery.level] ?? 0) + 1;
  console.log('\n[재분류] RECOVERY 등급 분포(현재 DB 기준):', JSON.stringify(byLevel, null, 1));

  // 구덕금호 hard guard 확인용 sanity check
  const gudeok = classified.find((c) => c.aptName?.includes('구덕금호'));
  if (gudeok) {
    console.log(`\n[구덕금호 sanity] aptSeq=${gudeok.aptSeq} level=${gudeok.recovery.level} universeFlag=${gudeok.recovery.universeFlag}`);
  } else {
    console.log('\n[구덕금호 sanity] 이번 molitCandidates 집합에 없음(고위험/복구후보 조건 자체를 벗어남 — 확인 필요 없음, 별도 규칙으로 여전히 차단됨)');
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), driftTotal, newSinceSweep, removedSinceSweep, jibunDongDrift, classified }, null, 1));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
