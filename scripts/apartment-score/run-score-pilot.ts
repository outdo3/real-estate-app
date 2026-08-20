/**
 * STEP SCORE S2C — 부산 서구·해운대 실데이터 score pilot(§45~49) + bias/sensitivity(§29,
 * §36~41) + briefing QA(§54). DB read-only, score를 저장하지 않는다(§56).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/run-score-pilot.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import type { FinalScoreResult } from '@/lib/apartment-score/server/types';

const REGIONS = [
  { label: '서구', lawdCd: '26140' },
  { label: '해운대', lawdCd: '26350' },
];

function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}
function median(arr: number[]) {
  return pct(arr, 50);
}

interface PilotRow {
  aptSeq: string;
  name: string;
  umdName: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  result: FinalScoreResult;
}

async function scoreRegion(lawdCd: string): Promise<PilotRow[]> {
  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd: lawdCd, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, umdName: true, buildYear: true, totalHouseholds: true },
  });
  const rows: PilotRow[] = [];
  for (const m of masters) {
    const result = await calculateApartmentScore(m.aptSeq!);
    rows.push({ aptSeq: m.aptSeq!, name: m.name, umdName: m.umdName, buildYear: m.buildYear, totalHouseholds: m.totalHouseholds, result });
  }
  return rows;
}

function spearman(xs: number[], ys: number[]): { rho: number | null; n: number } {
  const n = xs.length;
  if (n < 3) return { rho: null, n };
  const rank = (vals: number[]) => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(vals.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[idx[k][1]] = avgRank;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - mx, dy = ry[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return { rho: denom === 0 ? null : num / denom, n };
}

async function main() {
  const allRows: Record<string, PilotRow[]> = {};

  for (const region of REGIONS) {
    console.log(`\n========== ${region.label}(${region.lawdCd}) scoring ${'='.repeat(10)}`);
    const rows = await scoreRegion(region.lawdCd);
    allRows[region.label] = rows;

    const scored = rows.filter((r) => r.result.status === 'OK' && r.result.score != null);
    const scores = scored.map((r) => r.result.score!);

    console.log(`대상(aptSeq 확보) n=${rows.length}, OK(score 산출) n=${scored.length}`);
    console.log(`  status breakdown:`, countBy(rows.map((r) => r.result.status)));
    if (scores.length > 0) {
      console.log(`  score: min=${Math.min(...scores)} p10=${pct(scores, 10)} median=${median(scores)} p90=${pct(scores, 90)} max=${Math.max(...scores)}`);
    }

    const sample = [...scored].sort((a, b) => b.result.score! - a.result.score!).slice(0, 3)
      .concat([...scored].sort((a, b) => a.result.score! - b.result.score!).slice(0, 2));
    console.log(`\n  대표 5단지:`);
    for (const s of sample) {
      console.log(`  - ${s.name}(${s.umdName ?? '?'}, ${s.buildYear ?? '?'}) aptSeq=${s.aptSeq} score=${s.result.score} coverage=${s.result.coverage?.toFixed(2)} confidence=${s.result.confidence}`);
      console.log(`    categories: ${s.result.categories.map((c) => `${c.label}=${c.score ?? 'N/A'}`).join(', ')}`);
      if (s.result.regionalStrengths.length) console.log(`    regionalStrengths: ${s.result.regionalStrengths.map((rs) => rs.type + ':' + rs.level).join(', ')}`);
      if (s.result.briefing) console.log(`    briefing: ${s.result.briefing.summary}`);
    }

    // ---- bias tests ----
    console.log(`\n  bias tests(${region.label}):`);
    const buildYears = scored.map((r) => r.buildYear).filter((v): v is number => v != null);
    const buildYearVsScore = spearman(
      scored.filter((r) => r.buildYear != null).map((r) => r.buildYear!),
      scored.filter((r) => r.buildYear != null).map((r) => r.result.score!)
    );
    console.log(`  신축 bias: Spearman(buildYear, score) rho=${buildYearVsScore.rho?.toFixed(3)} n=${buildYearVsScore.n} (1에 가까우면 신축일수록 무조건 고득점 = bias 의심)`);

    const householdsVsScore = spearman(
      scored.filter((r) => r.totalHouseholds != null).map((r) => r.totalHouseholds!),
      scored.filter((r) => r.totalHouseholds != null).map((r) => r.result.score!)
    );
    console.log(`  대단지 bias: Spearman(totalHouseholds, score) rho=${householdsVsScore.rho?.toFixed(3)} n=${householdsVsScore.n}`);

    const priceRows = scored.filter((r) => r.result.market?.medianPricePerM2_12m != null);
    const priceVsScore = spearman(
      priceRows.map((r) => r.result.market!.medianPricePerM2_12m!),
      priceRows.map((r) => r.result.score!)
    );
    console.log(`  가격 bias: Spearman(medianPricePerM2_12m, score) rho=${priceVsScore.rho?.toFixed(3)} n=${priceVsScore.n} (Market weight=0이라 0에 가까워야 정상)`);

    const missingCoverageRows = scored.filter((r) => r.result.coverage != null);
    const coverageVsScore = spearman(
      missingCoverageRows.map((r) => r.result.coverage!),
      missingCoverageRows.map((r) => r.result.score!)
    );
    console.log(`  missing bias: Spearman(coverage, score) rho=${coverageVsScore.rho?.toFixed(3)} n=${missingCoverageRows.length} (0에서 크게 벗어나면 데이터 많은/적은 단지가 부당하게 유불리)`);

    void buildYears;
  }

  // ---- 지역 bias(§29, §46): 해운대가 무조건 서구보다 높으면 설계 문제 ----
  const seoguScores = allRows['서구'].filter((r) => r.result.score != null).map((r) => r.result.score!);
  const haeundaeScores = allRows['해운대'].filter((r) => r.result.score != null).map((r) => r.result.score!);
  console.log(`\n========== 지역 간 비교 ==========`);
  console.log(`서구 median=${median(seoguScores)}, 해운대 median=${median(haeundaeScores)}`);
  console.log(`서구 range=[${Math.min(...seoguScores)}, ${Math.max(...seoguScores)}], 해운대 range=[${Math.min(...haeundaeScores)}, ${Math.max(...haeundaeScores)}]`);

  // ---- sensitivity(§49): 카테고리 하나를 빼고 재계산했을 때 순위가 뒤집히는지 ----
  console.log(`\n========== Ranking sensitivity(카테고리 1개 제외 시뮬레이션, 서구 top10) ==========`);
  const seoguScored = allRows['서구'].filter((r) => r.result.status === 'OK').sort((a, b) => b.result.score! - a.result.score!).slice(0, 10);
  const top10AptSeqs = new Set(seoguScored.map((r) => r.aptSeq));
  for (const dropKey of ['transport', 'living', 'parking', 'complex', 'schoolAccess'] as const) {
    const resimulated = seoguScored.map((r) => {
      const remaining = r.result.categories.filter((c) => c.key !== dropKey && c.score != null);
      if (remaining.length === 0) return { aptSeq: r.aptSeq, score: r.result.score! };
      const weightMap: Record<string, number> = { transport: 30, living: 25, parking: 15, complex: 15, schoolAccess: 15 };
      const sumW = remaining.reduce((s, c) => s + weightMap[c.key], 0);
      const score = remaining.reduce((acc, c) => acc + (weightMap[c.key] / sumW) * c.score!, 0);
      return { aptSeq: r.aptSeq, score };
    });
    const newTop10 = new Set([...resimulated].sort((a, b) => b.score - a.score).slice(0, 10).map((r) => r.aptSeq));
    const overlap = [...top10AptSeqs].filter((s) => newTop10.has(s)).length;
    console.log(`  ${dropKey} 제외 시 top10 유지율: ${overlap}/10`);
  }

  // ---- briefing QA(§54): 20개 자동 생성 ----
  console.log(`\n========== Briefing QA(20개 샘플) ==========`);
  const allScored = [...allRows['서구'], ...allRows['해운대']].filter((r) => r.result.briefing != null);
  const qaSample = allScored.slice(0, 20);
  const seenSummaries = new Set<string>();
  let duplicateCount = 0;
  for (const r of qaSample) {
    const b = r.result.briefing!;
    console.log(`  [${r.name}] ${b.summary}`);
    if (b.strengths.length) console.log(`    강점: ${b.strengths.join(' / ')}`);
    if (b.caution) console.log(`    확인: ${b.caution}`);
    if (seenSummaries.has(b.summary)) duplicateCount++;
    seenSummaries.add(b.summary);
  }
  console.log(`\n  20개 중 summary 중복: ${duplicateCount}건, 서로 다른 summary 종류: ${seenSummaries.size}개`);

  await prisma.$disconnect();
}

function countBy<T extends string>(arr: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of arr) out[v] = (out[v] ?? 0) + 1;
  return out;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
