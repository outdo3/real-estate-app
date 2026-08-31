/**
 * BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 — §7/§8/§9/§37 coverage audit.
 *
 * 부산 ApartmentTradeHistory의 distinct aptSeq를 "실제로 거래에 등장한 단지
 * universe"로 삼아, 현재 /api/search가 실제로 찾아낼 수 있는 단지 비율을 계산한다.
 * Read-only. DB write 없음. 외부 API 호출 없음.
 *
 * "검색 가능"의 정의는 /api/search/route.ts의 실제 쿼리 로직을 그대로 재현한다
 * (별도 재구현/추측 없음) — normalizedName/name의 contains 매칭 + household 기준
 * 정렬 후 top-15 절단까지 동일하게 시뮬레이션해, "DB에는 있지만 실제 응답에서는
 * 잘려나가는" FRONTEND_FILTERED류 케이스까지 잡아낸다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { rankApartmentMatches, normalizeSearchKeyword } from '../src/lib/search-ranking';
const prisma = new PrismaClient();

const BUSAN_LAWD_CODES = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];


type Category =
  | 'MATCH'
  | 'MASTER_MISSING'
  | 'NAME_MISMATCH'
  | 'SEARCH_API_MISSING'
  | 'UNKNOWN';

async function main() {
  const recentOnly = process.argv.includes('--recent24');

  console.log('STEP 1: distinct traded aptSeq (Busan) 집계 중...');
  const dealDateFilter = recentOnly
    ? { gte: new Date(Date.now() - 24 * 30 * 24 * 3600 * 1000) }
    : undefined;

  const tradedGroups = await prisma.apartmentTradeHistory.groupBy({
    by: ['aptSeq', 'identityKey'],
    where: {
      lawdCd: { in: BUSAN_LAWD_CODES },
      dealType: 'sale',
      dealCanceled: false,
      ...(dealDateFilter ? { dealDate: dealDateFilter } : {}),
    },
    _count: { _all: true },
    _max: { aptName: true, dong: true, jibun: true },
  });

  // aptSeq가 있는 것과 없는 것(nd: 식별자) 분리 — aptSeq 없는 legacy identity는
  // Master 매칭 대상에서 제외(별도 UNKNOWN 집계).
  const withAptSeq = tradedGroups.filter((g) => g.aptSeq);
  const withoutAptSeq = tradedGroups.filter((g) => !g.aptSeq);

  console.log(`TRADE DISTINCT APTSEQ (Busan${recentOnly ? ', 최근 24개월' : ''}): ${withAptSeq.length} (+ identity-only ${withoutAptSeq.length}건, aptSeq 없음)`);

  console.log('STEP 2: ApartmentMaster 매칭 확인 중...');
  const aptSeqs = withAptSeq.map((g) => g.aptSeq!) as string[];
  const masterRows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: aptSeqs } },
    select: { aptSeq: true, name: true, normalizedName: true, umdName: true, totalHouseholds: true },
  });
  const masterByAptSeq = new Map(masterRows.map((m) => [m.aptSeq!, m]));

  console.log('STEP 3: /api/search 실제 로직 시뮬레이션 중 (아파트명으로 재검색)...');
  const categoryCounts: Record<Category, number> = {
    MATCH: 0,
    MASTER_MISSING: 0,
    NAME_MISMATCH: 0,
    SEARCH_API_MISSING: 0,
    UNKNOWN: 0,
  };
  const samples: Record<Category, { aptSeq: string; name: string; dong: string | null }[]> = {
    MATCH: [], MASTER_MISSING: [], NAME_MISMATCH: [], SEARCH_API_MISSING: [], UNKNOWN: [],
  };
  const SAMPLE_CAP = 15;

  let processed = 0;
  for (const g of withAptSeq) {
    processed++;
    if (processed % 500 === 0) console.log(`  ...${processed}/${withAptSeq.length}`);
    const aptSeq = g.aptSeq!;
    const tradedName = g._max.aptName || '';
    const tradedDong = g._max.dong || null;
    const master = masterByAptSeq.get(aptSeq);

    if (!master) {
      categoryCounts.MASTER_MISSING++;
      if (samples.MASTER_MISSING.length < SAMPLE_CAP) samples.MASTER_MISSING.push({ aptSeq, name: tradedName, dong: tradedDong });
      continue;
    }

    // Master에는 있음 — 이제 그 Master row의 "공식 이름"으로 검색했을 때 실제
    // /api/search 응답(top-15 절단 포함)에 자기 자신이 나오는지 시뮬레이션.
    const queryKeyword = normalizeSearchKeyword(master.name);
    if (queryKeyword.length < 2) {
      categoryCounts.UNKNOWN++;
      if (samples.UNKNOWN.length < SAMPLE_CAP) samples.UNKNOWN.push({ aptSeq, name: master.name, dong: tradedDong });
      continue;
    }

    const rawMatches = await prisma.apartmentMaster.findMany({
      where: {
        OR: [
          { normalizedName: { contains: queryKeyword } },
          { name: { contains: queryKeyword } },
        ],
      },
      // /api/search/route.ts 현재 로직 그대로: take 상한 없음(테이블 전체 ~3,400행
      // 규모라 성능상 문제 없음, §7 감사에서 take:50이 누락의 실제 원인이었음을 확인).
      select: { aptSeq: true, name: true, normalizedName: true, totalHouseholds: true },
    });
    const top15 = rankApartmentMatches(rawMatches, queryKeyword, 15);
    const foundInTop15 = top15.some((r) => r.aptSeq === aptSeq);

    if (foundInTop15) {
      categoryCounts.MATCH++;
      if (samples.MATCH.length < SAMPLE_CAP) samples.MATCH.push({ aptSeq, name: master.name, dong: tradedDong });
    } else {
      // DB에 존재하고 자기 이름으로 검색해도 매칭은 되지만(rawMatches 안에는 있음),
      // top-15 절단 때문에 실제 응답에서는 빠지는 경우 = SEARCH_API_MISSING.
      const foundInRaw = rawMatches.some((r) => r.aptSeq === aptSeq);
      if (foundInRaw) {
        categoryCounts.SEARCH_API_MISSING++;
        if (samples.SEARCH_API_MISSING.length < SAMPLE_CAP) samples.SEARCH_API_MISSING.push({ aptSeq, name: master.name, dong: tradedDong });
      } else {
        // 자기 이름으로 검색해도 자기 자신이 안 나옴 — normalizedName/name 필드
        // 자체가 오염됐거나 정규화 불일치.
        categoryCounts.NAME_MISMATCH++;
        if (samples.NAME_MISMATCH.length < SAMPLE_CAP) samples.NAME_MISMATCH.push({ aptSeq, name: master.name, dong: tradedDong });
      }
    }
  }

  const total = withAptSeq.length;
  const searchable = categoryCounts.MATCH;
  const coveragePct = total > 0 ? (searchable / total) * 100 : 0;

  console.log('\n========== RESULT ==========');
  console.log(`TOTAL UNIVERSE (traded, aptSeq 있음): ${total}`);
  console.log(`SEARCHABLE (MATCH, 실제 top-15 응답에 포함): ${searchable}`);
  console.log(`MISSING (그 외 전부): ${total - searchable}`);
  console.log(`TRADED_APT_COVERAGE: ${coveragePct.toFixed(2)}%`);
  console.log('\nCATEGORY COUNTS:');
  for (const [k, v] of Object.entries(categoryCounts)) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`  (aptSeq 없는 identity-only, 집계 제외): ${withoutAptSeq.length}`);

  console.log('\nSAMPLE MISSING (top N per category):');
  for (const cat of ['MASTER_MISSING', 'SEARCH_API_MISSING', 'NAME_MISMATCH', 'UNKNOWN'] as Category[]) {
    if (samples[cat].length === 0) continue;
    console.log(`  -- ${cat} --`);
    for (const s of samples[cat]) console.log(`    ${s.aptSeq} ${s.name} (${s.dong})`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
