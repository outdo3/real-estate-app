/**
 * SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 §6 — 부산 전역 이름 충돌 감사.
 *
 * 읽기 전용. 프로덕션에 아무것도 쓰지 않는다.
 *
 * 묻는 것은 하나다: 점수 라우트가 **이름으로** 단지를 찾던 시절, 부산의 몇 개 단지가
 * 확정 불가(AMBIGUOUS)로 떨어졌고, canonical aptSeq를 쓰면 그중 몇 개가 되살아나는가.
 *
 * BEFORE 해소기는 이 STEP 이전 라우트 코드를 그대로 재현한다(정확 일치 우선 →
 * aptNamesMatch 부분포함 폴백 → 후보 2건 이상이면 AMBIGUOUS).
 * AFTER 해소기는 aptSeq가 주어지면 그것으로 끝낸다.
 *
 *   npx tsx scripts/apartment-score/score-identity-collision-audit.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';
import { aptNamesMatch, normalizeAptName } from '../../src/lib/apt-name-match';

const BUSAN_PREFIX = '26';

type Master = { aptSeq: string; name: string; umdName: string | null; sggCd: string };

/** 이 STEP 이전 라우트의 해소 규칙. 코드가 아니라 동작을 그대로 옮겼다. */
function resolveByName(candidates: Master[], queryName: string): Master[] {
  const target = normalizeAptName(queryName);
  const exact = candidates.filter((c) => normalizeAptName(c.name) === target);
  return exact.length > 0 ? exact : candidates.filter((c) => aptNamesMatch(c.name, queryName));
}

async function main() {
  const rows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: { aptSeq: true, name: true, umdName: true, sggCd: true },
  });
  const busan = rows.filter((r): r is Master => !!r.sggCd && r.sggCd.startsWith(BUSAN_PREFIX) && !!r.aptSeq);

  const bySgg = new Map<string, Master[]>();
  for (const m of busan) {
    const list = bySgg.get(m.sggCd) ?? [];
    list.push(m);
    bySgg.set(m.sggCd, list);
  }

  let ambiguousWithoutDong = 0;
  let ambiguousWithDong = 0;
  let wrongMatchRisk = 0;
  const collisionGroups = new Map<string, Master[]>();
  const lostWithoutDong: string[] = [];

  for (const [sgg, list] of bySgg) {
    for (const target of list) {
      // (A) 법정동 없이 들어오는 경로
      const withoutDong = resolveByName(list, target.name);
      // (B) 법정동이 있는 경로
      const scoped = list.filter((c) => c.umdName === target.umdName);
      const withDong = resolveByName(scoped, target.name);

      if (withoutDong.length > 1) {
        ambiguousWithoutDong++;
        lostWithoutDong.push(`${sgg} ${target.aptSeq} ${target.name}(${target.umdName ?? '-'})`);
        const key = `${sgg}|${normalizeAptName(target.name)}`;
        if (!collisionGroups.has(key)) collisionGroups.set(key, withoutDong);
      }
      if (withDong.length > 1) ambiguousWithDong++;
      // 자기 자신이 후보에 없는데 단일 해소되면 = 다른 단지로 확정된다는 뜻
      if (withDong.length === 1 && withDong[0].aptSeq !== target.aptSeq) wrongMatchRisk++;
    }
  }

  // AFTER: aptSeq가 주어지면 언제나 정확히 1건으로 해소된다(unique 제약).
  const uniqueSeqs = new Set(busan.map((m) => m.aptSeq));

  console.log('SCORE IDENTITY COLLISION AUDIT — 부산 전역');
  console.log(`대상 ApartmentMaster(aptSeq 보유) : ${busan.length}`);
  console.log(`구(sggCd) 수                      : ${bySgg.size}`);
  console.log('');
  console.log('BEFORE (이름 기반 해소)');
  console.log(`  법정동 없이 → AMBIGUOUS         : ${ambiguousWithoutDong}`);
  console.log(`  법정동 있음 → AMBIGUOUS         : ${ambiguousWithDong}`);
  console.log(`  다른 단지로 확정될 위험         : ${wrongMatchRisk}`);
  console.log('');
  console.log('AFTER (aptSeq 우선)');
  console.log(`  aptSeq로 단일 해소 가능         : ${uniqueSeqs.size} / ${busan.length}`);
  console.log(`  aptSeq로 되살아나는 단지        : ${ambiguousWithoutDong + ambiguousWithDong}`);
  console.log('');
  console.log(`정규화 이름 충돌 그룹 : ${collisionGroups.size}`);
  for (const [key, group] of [...collisionGroups].slice(0, 20)) {
    console.log(`  ${key} → ${group.map((g) => `${g.aptSeq} ${g.name}(${g.umdName ?? '-'})`).join(' | ')}`);
  }
  if (collisionGroups.size > 20) console.log(`  ... 외 ${collisionGroups.size - 20}개 그룹`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
