/**
 * PEER FALLBACK HOTFIX — before/after regression 스냅샷. 부산 전역
 * location feature 보유 단지 전수에 calculateApartmentScore()를 실행해
 * aptSeq/status/score/coverage/카테고리별 score+peerLevel을 JSON으로
 * 저장한다. read-only, DB에 아무것도 쓰지 않는다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/busan-score-snapshot.ts <output.json>
 */
import * as fs from 'fs';
import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';

const SIDO_VALUE = '부산';

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('사용법: busan-score-snapshot.ts <output.json>');
    process.exitCode = 1;
    return;
  }

  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true },
  });
  const locFeatures = await prisma.apartmentLocationFeature.findMany({ select: { aptSeq: true } });
  const locAptSeqs = new Set(locFeatures.map((r) => r.aptSeq));
  const targets = allMaster.filter((r) => locAptSeqs.has(r.aptSeq!));

  console.log(`대상: ${targets.length}건`);

  const snapshot: Record<string, any> = {};
  let i = 0;
  for (const t of targets) {
    i++;
    if (i % 200 === 0) console.log(`  ...${i}/${targets.length}`);
    const r = await calculateApartmentScore(t.aptSeq!);
    snapshot[t.aptSeq!] = {
      name: t.name,
      gu: t.sigungu,
      dong: t.umdName,
      status: r.status,
      score: r.score,
      coverage: r.coverage,
      preparingReason: r.preparingReason,
      categories: r.categories.map((c) => ({ key: c.key, score: c.score })),
    };
  }

  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 0));
  console.log(`저장 완료: ${outPath} (${Object.keys(snapshot).length}건)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
