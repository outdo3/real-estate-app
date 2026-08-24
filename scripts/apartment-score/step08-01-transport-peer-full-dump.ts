/**
 * E-JIP SCORE V2 STEP 0.8 §3,4,5,11 — quality-filtered transport LOCAL(동) peer
 * universe 전수 출력(대신해모로센트럴/협성르네상스) + PEER_GROUP_KEY 확정 +
 * subway/bus sub-metric 기여도 분해. READ-ONLY. production score 미변경 —
 * rankFeature/scoreFromPercentile/computeTransportCategory는 production 코드를
 * 그대로 호출하고, 이 파일은 그 중간값을 노출하는 wrapper일 뿐이다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/step08-01-transport-peer-full-dump.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanDataset, guNameForSggCd, type BusanDataset, type MasterRow } from './lib/shadow-score';
import { resolvePeerPoolLevels, type PeerCandidate } from '@/lib/apartment-score/server/peer-groups';
import { computeTransportCategory } from '@/lib/apartment-score/server/categories/transport';
import { rankFeature, scoreFromPercentile, type FeatureRow } from '@/lib/apartment-score/server/percentile';
import { TRANSPORT_SUBWEIGHTS, FEATURE_DIRECTIONS } from '@/lib/apartment-score/server/config';
import type { RawLocationFeature } from '@/lib/apartment-score/server/types';

const TARGETS: { label: string; aptSeq: string }[] = [
  { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
  { label: '협성르네상스(서구)', aptSeq: '26140-51' },
];

// transport.ts의 SUB_METRICS를 그대로 재기술(가중치/방향은 config에서 import — 값 재정의
// 아님). rankFeature/scoreFromPercentile은 production 함수를 그대로 호출한다.
const SUB_METRICS = [
  { key: 'nearestSubwayDistanceM' as const, weight: TRANSPORT_SUBWEIGHTS.nearestSubwayDistanceM, direction: FEATURE_DIRECTIONS.nearestSubwayDistanceM, treatCompleteNullAsWorst: true, group: 'subway' },
  { key: 'subwayCount1000m' as const, weight: TRANSPORT_SUBWEIGHTS.subwayCount1000m, direction: FEATURE_DIRECTIONS.subwayCount1000m, treatCompleteNullAsWorst: false, group: 'subway' },
  { key: 'nearestBusStopDistanceM' as const, weight: TRANSPORT_SUBWEIGHTS.nearestBusStopDistanceM, direction: FEATURE_DIRECTIONS.nearestBusStopDistanceM, treatCompleteNullAsWorst: true, group: 'bus' },
  { key: 'busStopCount300m' as const, weight: TRANSPORT_SUBWEIGHTS.busStopCount300m, direction: FEATURE_DIRECTIONS.busStopCount300m, treatCompleteNullAsWorst: false, group: 'bus' },
];

function buildRows(peerAptSeqs: string[], key: keyof RawLocationFeature, locationByAptSeq: Map<string, RawLocationFeature>): FeatureRow[] {
  return peerAptSeqs.map((aptSeq) => {
    const loc = locationByAptSeq.get(aptSeq);
    return { aptSeq, value: loc ? (loc[key] as number | null) : null, isComplete: loc ? loc.qualityFlag === 'complete' : false };
  });
}

function decompose(targetAptSeq: string, peerAptSeqs: string[], locationByAptSeq: Map<string, RawLocationFeature>) {
  const parts: { key: string; group: string; weight: number; percentile: number | null; subScore: number | null; included: boolean }[] = [];
  for (const sub of SUB_METRICS) {
    const rows = buildRows(peerAptSeqs, sub.key, locationByAptSeq);
    const ranked = rankFeature(rows, sub.key, sub.direction, sub.treatCompleteNullAsWorst);
    const targetRank = ranked.get(targetAptSeq);
    const included = !!targetRank && targetRank.included && targetRank.percentile != null;
    parts.push({
      key: sub.key,
      group: sub.group,
      weight: sub.weight,
      percentile: included ? targetRank!.percentile : null,
      subScore: included ? scoreFromPercentile(targetRank!.percentile as number) : null,
      included,
    });
  }
  const usedWeightSum = parts.filter((p) => p.included).reduce((s, p) => s + p.weight, 0);
  const withContribution = parts.map((p) => ({ ...p, normWeight: p.included ? p.weight / usedWeightSum : 0 }));
  const bySubway = withContribution.filter((p) => p.group === 'subway').reduce((s, p) => s + p.normWeight * (p.subScore ?? 0), 0);
  const byBus = withContribution.filter((p) => p.group === 'bus').reduce((s, p) => s + p.normWeight * (p.subScore ?? 0), 0);
  return { parts: withContribution, subwayComponent: bySubway, busComponent: byBus, finalTransport: bySubway + byBus };
}

function fmt(n: number | null | undefined, digits = 1): string {
  return n == null ? '-' : n.toFixed(digits);
}

async function main() {
  const ds = await loadBusanDataset();
  const output: Record<string, unknown> = { generatedAt: new Date().toISOString(), targets: {} };

  for (const { label, aptSeq } of TARGETS) {
    const target = ds.masterByAptSeq.get(aptSeq);
    if (!target) { console.log(`${label} (${aptSeq}) NOT FOUND`); continue; }

    const cohort = ds.cohortsBySggCd.get(target.sggCd ?? '') ?? [];
    const coordOkCandidates: PeerCandidate[] = cohort
      .filter((m) => ds.qualityByAptSeq.get(m.aptSeq)?.transportPeerEligible === true)
      .map((m) => ({ aptSeq: m.aptSeq, sggCd: m.sggCd, umdName: m.umdName, buildYear: m.buildYear }));
    const targetCandidate: PeerCandidate = { aptSeq: target.aptSeq, sggCd: target.sggCd, umdName: target.umdName, buildYear: target.buildYear };

    const levels = resolvePeerPoolLevels(targetCandidate, coordOkCandidates, false);
    const peerPool = levels[0]; // LOCAL(동) 레벨이 채택되는지 여기서 실측 확인 — 가정하지 않는다.
    const peerGroupKey = `sggCd=${target.sggCd}(${guNameForSggCd(target.sggCd)})::umdName=${target.umdName}`;

    console.log(`\n${'='.repeat(90)}\n### ${label} (${aptSeq})\n${'='.repeat(90)}`);
    console.log(`PEER_GROUP_KEY = ${peerGroupKey}`);
    console.log(`peerPool.level = ${peerPool.level}  tier = ${peerPool.tier}  size = ${peerPool.aptSeqs.length}`);

    // 카테고리 최종 결과(전부 production computeTransportCategory 그대로 호출)
    const categoryResult = computeTransportCategory(aptSeq, peerPool, ds.locationByAptSeq);
    console.log(`production computeTransportCategory() 재현: status=${categoryResult.status} score=${fmt(categoryResult.score, 2)} usedSubMetrics=${categoryResult.usedSubMetrics.join(',')}`);

    // 전수 peer 목록: 각 peer를 동일 pool 안에서 "target"으로 재계산(동일 함수 재사용) —
    // 새 알고리즘이 아니라 동일 계산을 peer 수만큼 반복하는 것 뿐이다(n<=20, 비용 무시 가능).
    const rows = peerPool.aptSeqs.map((peerAptSeq, idx) => {
      const m = ds.masterByAptSeq.get(peerAptSeq);
      const loc = ds.locationByAptSeq.get(peerAptSeq);
      const q = ds.qualityByAptSeq.get(peerAptSeq);
      const cat = computeTransportCategory(peerAptSeq, peerPool, ds.locationByAptSeq);
      return {
        aptSeq: peerAptSeq,
        name: m?.name ?? '(unknown)',
        dong: m?.umdName ?? null,
        address: m?.roadAddress ?? m?.jibunAddress ?? null,
        households: m?.totalHouseholds ?? null,
        buildYear: m?.buildYear ?? null,
        identityQuality: q?.identity ?? null,
        coordinateQuality: q?.coord ?? null,
        peerEligibility: q?.peerEligibility ?? null,
        nearestStation: loc?.nearestSubwayName ?? null,
        stationDistanceM: loc?.nearestSubwayDistanceM ?? null,
        subwayCount1000m: loc?.subwayCount1000m ?? null,
        nearestBusStopDistanceM: loc?.nearestBusStopDistanceM ?? null,
        busStopCount300m: loc?.busStopCount300m ?? null,
        transportStatus: cat.status,
        transportScore: cat.score,
      };
    });
    rows.sort((a, b) => (a.stationDistanceM ?? Infinity) - (b.stationDistanceM ?? Infinity));
    const targetRankIdx = rows.findIndex((r) => r.aptSeq === aptSeq);

    console.log(`\n지하철 거리 오름차순 전체 ${rows.length}건 (rank/거리/역명/이름/identity/coord/eligibility/transportScore):`);
    rows.forEach((r, i) => {
      const marker = r.aptSeq === aptSeq ? '  <== 대상' : '';
      console.log(`  ${i + 1}. ${r.stationDistanceM ?? '?'}m | ${r.nearestStation ?? '?'} | ${r.name} | ${r.dong} | id=${r.identityQuality} coord=${r.coordinateQuality} elig=${r.peerEligibility} | transport=${fmt(r.transportScore, 1)}(${r.transportStatus})${marker}`);
    });

    if (targetRankIdx > 0) {
      console.log(`\n대상보다 앞선 ${targetRankIdx}개 상세 검증:`);
      rows.slice(0, targetRankIdx).forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.name} | dong=${r.dong} | households=${r.households} | buildYear=${r.buildYear} | address=${r.address}`);
        console.log(`       identity=${r.identityQuality} coord=${r.coordinateQuality} peerEligibility=${r.peerEligibility} | station=${r.nearestStation}(${r.stationDistanceM}m) subwayCount1000m=${r.subwayCount1000m} busStop=${r.nearestBusStopDistanceM}m busCount300m=${r.busStopCount300m}`);
      });
    }

    const decomp = decompose(aptSeq, peerPool.aptSeqs, ds.locationByAptSeq);
    console.log(`\nsub-metric 분해(대상=${label}):`);
    decomp.parts.forEach((p) => {
      console.log(`  ${p.key} [${p.group}] weight=${p.weight} included=${p.included} percentile=${fmt(p.percentile, 1)} subScore=${fmt(p.subScore, 1)} normWeight=${fmt(p.normWeight * 100, 1)}%`);
    });
    console.log(`  => subwayComponent=${fmt(decomp.subwayComponent, 2)}  busComponent=${fmt(decomp.busComponent, 2)}  finalTransport(재현)=${fmt(decomp.finalTransport, 2)} (production score=${fmt(categoryResult.score, 2)})`);

    (output.targets as Record<string, unknown>)[label] = {
      aptSeq, peerGroupKey, peerPool, categoryResult, rows, targetRank: targetRankIdx + 1, peerCount: rows.length, decomposition: decomp,
    };
  }

  const outDir = path.resolve(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.resolve(outDir, 'step08-transport-peer-audit.json'), JSON.stringify(output, null, 1));
  console.log('\n[saved] scripts/apartment-score/output/step08-transport-peer-audit.json');

  const { prisma } = await import('@/lib/prisma');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
