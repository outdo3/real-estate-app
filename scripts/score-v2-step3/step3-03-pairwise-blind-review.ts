/**
 * E-JIP SCORE V2 STEP 3 §33-34 — 40~60개 pairwise expert sanity set 자동 선정 +
 * blind(단지명 가림) / answer-key(V2 결과 포함) 두 CSV 생성. READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, baselineDomains, type Row } from './shared-loader';
import { composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from './composition-v3';

function livingSum(r: Row): number { return [r.livingRaw.mart, r.livingRaw.convenience, r.livingRaw.pharmacy, r.livingRaw.hospital, r.livingRaw.park, r.livingRaw.daycare].filter((v): v is number => v != null).reduce((a, b) => a + b, 0); }

async function main() {
  const { rows, prisma } = await loadBusanRows();
  const eligible = rows.filter((r) => r.eligible);

  interface Pair { type: string; a: Row; b: Row }
  const pairs: Pair[] = [];
  const used = new Set<string>();
  function claim(r: Row) { used.add(r.aptSeq); }
  function pickPairs(type: string, poolA: Row[], poolB: Row[], count: number) {
    let added = 0;
    for (const a of poolA) {
      if (added >= count) break;
      if (used.has(a.aptSeq)) continue;
      const b = poolB.find((x) => x.aptSeq !== a.aptSeq && !used.has(x.aptSeq));
      if (!b) continue;
      pairs.push({ type, a, b }); claim(a); claim(b); added++;
    }
  }

  // 신축 vs 구축
  pickPairs('신축 vs 구축', [...eligible].filter((r) => r.age != null && r.age <= 8).sort((x, y) => x.age! - y.age!), [...eligible].filter((r) => r.age != null && r.age >= 30).sort((x, y) => y.age! - x.age!), 6);
  // 초역세권 vs 비역세권
  pickPairs('초역세권 vs 비역세권', [...eligible].filter((r) => r.subwayRaw != null && r.subwayRaw <= 200).sort((x, y) => x.subwayRaw! - y.subwayRaw!), [...eligible].filter((r) => r.subwayStatus === 'CONFIRMED_ABSENT' || (r.subwayRaw != null && r.subwayRaw >= 900)), 6);
  // 대단지 vs 소단지
  pickPairs('대단지 vs 소단지', [...eligible].filter((r) => r.households != null && r.households >= 1000).sort((x, y) => y.households! - x.households!), [...eligible].filter((r) => r.households != null && r.households < 100), 6);
  // 고주차 vs 저주차
  pickPairs('고주차 vs 저주차', [...eligible].filter((r) => r.parkingRatio != null && r.parkingRatio >= 1.6).sort((x, y) => y.parkingRatio! - x.parkingRatio!), [...eligible].filter((r) => r.parkingRatio != null && r.parkingRatio <= 0.6), 6);
  // 교육 접근 good/bad
  pickPairs('교육접근 양호 vs 열악', [...eligible].filter((r) => r.elemRaw != null && r.elemRaw <= 200).sort((x, y) => x.elemRaw! - y.elemRaw!), [...eligible].filter((r) => r.elemRaw != null && r.elemRaw >= 800), 6);
  // 생활밀집 vs sparse
  pickPairs('생활밀집 vs sparse', [...eligible].sort((x, y) => livingSum(y) - livingSum(x)), [...eligible].filter((r) => livingSum(r) >= 0).sort((x, y) => livingSum(x) - livingSum(y)), 6);
  // tradeoff pair: 지하철 가까우나 주차 나쁨 vs 지하철 멀지만 주차 좋음
  pickPairs('tradeoff(교통 vs 주차)', [...eligible].filter((r) => r.subwayRaw != null && r.subwayRaw <= 250 && r.parkingRatio != null && r.parkingRatio < 0.9), [...eligible].filter((r) => r.subwayRaw != null && r.subwayRaw >= 600 && r.parkingRatio != null && r.parkingRatio >= 1.5), 6);
  // tradeoff pair2: 신축 소단지 vs 구축 대단지
  pickPairs('tradeoff(연식 vs 규모)', [...eligible].filter((r) => r.age != null && r.age <= 8 && r.households != null && r.households < 200), [...eligible].filter((r) => r.age != null && r.age >= 25 && r.households != null && r.households >= 800), 6);

  console.log(`[§33] 선정된 pair = ${pairs.length}개(목표 40~60)`);
  for (const p of pairs) console.log(`  [${p.type}] ${p.a.name} vs ${p.b.name}`);

  function domainAndTotal(r: Row) {
    const d = baselineDomains(r);
    const covered = [d.transport, d.living, d.education, d.complex].filter((x) => x.score != null).length;
    const total = covered >= 3 ? composeTotalFromDomains({ transport: d.transport.score, living: d.living.score, education: d.education.score, complex: d.complex.score }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION').score : null;
    return { d, total, coverage: covered / 4 };
  }
  function confidenceTier(coverage: number): string { return coverage >= 0.75 ? 'HIGH' : coverage >= 0.4 ? 'MEDIUM' : 'LOW'; }

  const blindHeader = 'pairId,side,subwayDistanceM,subwayStatus,busStopDistanceM,busStopCount300m,ageYears,households,parkingRatio,elementaryDistanceM,mart1000m,convenience500m,pharmacy500m,hospital1000m,park1000m,dataConfidence';
  const keyHeader = 'pairId,type,side,aptSeq,name,sigungu,transport,living,education,complex,total_WA';
  const blindLines: string[] = []; const keyLines: string[] = [];
  pairs.forEach((p, idx) => {
    const pairId = `PAIR-${String(idx + 1).padStart(2, '0')}`;
    for (const [side, r] of [['A', p.a], ['B', p.b]] as const) {
      const { d, total, coverage } = domainAndTotal(r);
      blindLines.push([pairId, side, r.subwayRaw ?? '', r.subwayStatus, r.busDist ?? '', r.busCount ?? '', r.age ?? '', r.households ?? '', r.parkingRatio?.toFixed(2) ?? '정보없음', r.elemRaw ?? '', r.livingRaw.mart ?? '', r.livingRaw.convenience ?? '', r.livingRaw.pharmacy ?? '', r.livingRaw.hospital ?? '', r.livingRaw.park ?? '', confidenceTier(coverage)].join(','));
      keyLines.push([pairId, `"${p.type}"`, side, r.aptSeq, `"${r.name}"`, r.sigungu, d.transport.score?.toFixed(1) ?? '', d.living.score?.toFixed(1) ?? '', d.education.score?.toFixed(1) ?? '', d.complex.score?.toFixed(1) ?? '', total?.toFixed(1) ?? ''].join(','));
    }
  });

  const outDir = path.resolve(__dirname, '../../data/score-v2-step3');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const blindContent = [
    '# E-JIP SCORE V2 STEP 3 — Blind Expert Review Sheet',
    '# 질문: 1) 어느 단지가 실거주 품질이 높아 보입니까(A/B/TIE)? 2) 가장 중요한 이유는?',
    '# V2 점수는 이 파일에 없습니다 — 답변 후 answer-key와 대조하세요.',
    blindHeader, ...blindLines,
  ].join('\n');
  fs.writeFileSync(path.resolve(outDir, 'pairwise-expert-review-blind.csv'), blindContent);
  fs.writeFileSync(path.resolve(outDir, 'pairwise-expert-review-key.csv'), [keyHeader, ...keyLines].join('\n'));
  console.log(`\n[saved] pairwise-expert-review-blind.csv(${pairs.length}쌍, ${blindLines.length}행) / pairwise-expert-review-key.csv`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
