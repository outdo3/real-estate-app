/**
 * BUSAN SCORE DATA V1.1 — geocoding recovery 후 복구된 335건(실제 334건
 * geocode 성공)에 대해 calculateApartmentScore()를 재실행해 score 재계산
 * 결과를 집계한다. read-only(계산만, DB write 없음 — calculateApartmentScore
 * 자체가 원래 read-only 함수).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/verify-recovery-scores.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';

async function main() {
  // 이번 STEP에서 geocodeQuality가 'exact'/'normalized'로 새로 바뀐(=이번에
  // 복구된) 단지만 대상 — 원래부터 좌표가 있던 3,067건은 재계산하지 않는다
  // (§9 지시 "recovered 단지 전체에 대해서만"). feature.fetchedAt이 오늘
  // 새로 수집된 row만 골라 recovered set을 식별한다(기존 3,067건은
  // 2026-08-19~20에 수집됨, §확인 완료).
  const targets = await prisma.$queryRawUnsafe<{ apt_seq: string; name: string; sigungu: string }[]>(`
    SELECT am.apt_seq, am.name, am.sigungu
    FROM apartment_masters am
    JOIN apartment_location_features alf ON am.apt_seq = alf.apt_seq
    WHERE am.sido = '부산' AND alf.fetched_at > '2026-08-21T00:00:00Z'
  `);

  console.log(`recovered targets (feature fetched today): ${targets.length}`);

  const summary = { OK: 0, INSUFFICIENT_DATA: 0, ERROR: 0, NOT_FOUND: 0, AMBIGUOUS: 0 };
  const reasonCounts: Record<string, number> = {};
  const scores: number[] = [];

  for (const t of targets) {
    try {
      const r = await calculateApartmentScore(t.apt_seq);
      summary[r.status as keyof typeof summary] = (summary[r.status as keyof typeof summary] ?? 0) + 1;
      if (r.status === 'OK' && r.score != null) scores.push(r.score);
      if (r.status !== 'OK') {
        const reason = r.preparingReason ?? 'null';
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
      }
    } catch (e) {
      summary.ERROR++;
    }
  }

  console.log('\n=== Score status summary(recovered set) ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Preparing reason breakdown(non-OK) ===');
  console.log(JSON.stringify(reasonCounts, null, 2));
  if (scores.length > 0) {
    scores.sort((a, b) => a - b);
    console.log('\n=== Score distribution(recovered, OK only) ===');
    console.log(JSON.stringify({
      n: scores.length,
      min: scores[0],
      p25: scores[Math.floor(scores.length * 0.25)],
      median: scores[Math.floor(scores.length * 0.5)],
      p75: scores[Math.floor(scores.length * 0.75)],
      max: scores[scores.length - 1],
    }));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
