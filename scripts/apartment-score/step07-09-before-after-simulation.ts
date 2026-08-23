// E-JIP SCORE V2 STEP 0.7 §18-23 — STEP 0.6 peer-quality 모델 재시뮬레이션(READ-ONLY,
// production 미변경). step07-08의 RECOVERY_HIGH 분류 결과를 "적용됐다고 가정"하고
// BEFORE/AFTER를 비교한다.
//
// 중요(정직성 원칙): registry 복구(주소+세대수)만으로는 geocodeQuality가 바뀌지 않는다
// (classifyCoord는 오직 geocodeQuality 필드만 본다 — §9 identity 복구와 §11/§49
// 좌표 재지오코딩은 서로 다른 축이다). 그래서 두 시나리오를 분리해서 보여준다:
//   AFTER_IDENTITY_ONLY        — registry 복구만 적용(이번 STEP의 실제 scope). coord는
//                                 그대로라 PEER_FULL 전환은 없고, identity 축만 개선된다.
//   AFTER_WITH_REGEOCODE(투영) — RECOVERY_HIGH가 얻은 도로명주소로 재지오코딩까지
//                                 "성공한다고 가정"했을 때의 상한(§49 opportunity 크기
//                                 추정용, 실제 재지오코딩을 수행하지 않음 — 투영치임을
//                                 반드시 별도 라벨링).
import fs from 'fs';
import path from 'path';
import { prisma } from '../../src/lib/prisma';
import { classify, type QualityInput, type QualityResult } from './lib/peer-quality';

const CLASSIFICATION_PATH = path.resolve(__dirname, 'output/step07-recovery-classification.json');

function summarize(results: QualityResult[]) {
  const byPeer: Record<string, number> = {};
  for (const r of results) byPeer[r.peerEligibility] = (byPeer[r.peerEligibility] ?? 0) + 1;
  const domains = {
    transport: results.filter((r) => r.transportPeerEligible).length,
    life: results.filter((r) => r.livePeerEligible).length,
    school: results.filter((r) => r.schoolPeerEligible).length,
    parking: results.filter((r) => r.parkingPeerEligible).length,
    complex: results.filter((r) => r.complexPeerEligible).length,
  };
  return { byPeer, domains, total: results.length };
}

async function main() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, sggCd: true, roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));

  const recovered = JSON.parse(fs.readFileSync(CLASSIFICATION_PATH, 'utf-8')) as any[];
  const highByAptSeq = new Map(recovered.filter((r) => r.recovery.level === 'RECOVERY_HIGH').map((r) => [r.aptSeq, r]));
  console.log(`RECOVERY_HIGH 적용 대상: ${highByAptSeq.size}건`);

  const toInput = (m: (typeof masters)[number]): QualityInput => ({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  });

  const before = masters.map((m) => classify(toInput(m)));

  const afterIdentityOnly = masters.map((m) => {
    const rec = highByAptSeq.get(m.aptSeq!);
    if (!rec) return classify(toInput(m));
    const input = toInput(m);
    input.totalHouseholds = rec.probe.totalHouseholds ?? input.totalHouseholds;
    input.roadAddress = rec.probe.roadAddress ?? input.roadAddress;
    input.mgmBldrgstPk = rec.probe.mgmBldrgstPk ?? input.mgmBldrgstPk;
    // parkingCount는 이번 STEP의 recovery 대상 evidence가 아니다(probe에 있어도 §0
    // "복구 결과 = identity/address 강화"라는 이번 STEP 범위를 벗어나므로 적용하지 않음).
    return classify(input);
  });

  const afterWithRegeocodeProjected = masters.map((m) => {
    const rec = highByAptSeq.get(m.aptSeq!);
    if (!rec) return classify(toInput(m));
    const input = toInput(m);
    input.totalHouseholds = rec.probe.totalHouseholds ?? input.totalHouseholds;
    input.roadAddress = rec.probe.roadAddress ?? input.roadAddress;
    input.mgmBldrgstPk = rec.probe.mgmBldrgstPk ?? input.mgmBldrgstPk;
    input.geocodeQuality = 'exact'; // 투영(가정) — 실제 재지오코딩 미실행, §49에서 별도 검증
    return classify(input);
  });

  console.log('\n[BEFORE] STEP 0.6 원본:', JSON.stringify(summarize(before), null, 1));
  console.log('\n[AFTER_IDENTITY_ONLY] registry 복구만 적용(이번 STEP 실제 scope):', JSON.stringify(summarize(afterIdentityOnly), null, 1));
  console.log('\n[AFTER_WITH_REGEOCODE_PROJECTED] 재지오코딩까지 성공 가정(투영, §49 opportunity):', JSON.stringify(summarize(afterWithRegeocodeProjected), null, 1));

  // 구·군별 PEER_FULL 비율 before/after(§29 지역편향 재검토)
  function byDistrict(results: QualityResult[], masterList: typeof masters) {
    const map = new Map<string, { total: number; full: number }>();
    results.forEach((r, i) => {
      const key = masterList[i].sggCd ?? 'null';
      if (!map.has(key)) map.set(key, { total: 0, full: 0 });
      const e = map.get(key)!;
      e.total++;
      if (r.peerEligibility === 'PEER_FULL') e.full++;
    });
    return map;
  }
  const distBefore = byDistrict(before, masters);
  const distAfterProjected = byDistrict(afterWithRegeocodeProjected, masters);
  console.log('\n구·군별 PEER_FULL% (BEFORE → AFTER_WITH_REGEOCODE_PROJECTED):');
  const rows: { lawd: string; beforePct: number; afterPct: number }[] = [];
  for (const [k, v] of distBefore) {
    const a = distAfterProjected.get(k)!;
    rows.push({ lawd: k, beforePct: 100 * v.full / v.total, afterPct: 100 * a.full / a.total });
  }
  rows.sort((a, b) => a.beforePct - b.beforePct);
  for (const r of rows) console.log(`  ${r.lawd}: ${r.beforePct.toFixed(1)}% → ${r.afterPct.toFixed(1)}%`);
  const beforeVals = rows.map((r) => r.beforePct);
  const afterVals = rows.map((r) => r.afterPct);
  console.log(`\nmin/max/ratio BEFORE: ${Math.min(...beforeVals).toFixed(1)}% / ${Math.max(...beforeVals).toFixed(1)}% / ${(Math.max(...beforeVals) / Math.max(0.01, Math.min(...beforeVals))).toFixed(1)}x`);
  console.log(`min/max/ratio AFTER(projected): ${Math.min(...afterVals).toFixed(1)}% / ${Math.max(...afterVals).toFixed(1)}% / ${(Math.max(...afterVals) / Math.max(0.01, Math.min(...afterVals))).toFixed(1)}x`);

  fs.writeFileSync(path.resolve(__dirname, 'output/step07-before-after.json'), JSON.stringify({ before: summarize(before), afterIdentityOnly: summarize(afterIdentityOnly), afterWithRegeocodeProjected: summarize(afterWithRegeocodeProjected), districtRows: rows }, null, 1));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
