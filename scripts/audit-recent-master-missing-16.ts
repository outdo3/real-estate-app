/**
 * RECENT_MASTER_MISSING_16_AUDIT_V1 — read-only forensic profile builder for the
 * 16 recent (24-month) traded aptSeq that are absent from ApartmentMaster
 * (per BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 / re-confirmed by
 * BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1). No DB write. No external API calls.
 *
 * Step 1 of 2 — writes data/master-integrity/_recent-16-forensic-profiles.json
 * (intermediate, not committed, fully regeneratable by re-running this script).
 * Step 2 is scripts/classify-recent-master-missing-16.ts (reads this output and
 * applies classification rules, writes the committed repair-candidate file).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { normalizeSearchKeyword } from '../src/lib/search-ranking';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const BUSAN_LAWD_CODES = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

async function main() {
  // SUPABASE_EGRESS_P0_FIX_V1 §3 — 이 스크립트는 DIAGNOSTIC(QA/benchmark)이라
  // Production DB에 대해서는 기본 차단된다(ALLOW_PROD_DB_READ=1로만 해제).
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-recent-master-missing-16.ts');
  const now = new Date();
  const from24 = new Date(now.getTime() - 24 * 30 * 24 * 3600 * 1000);
  const from12 = new Date(now.getTime() - 12 * 30 * 24 * 3600 * 1000);
  const from6 = new Date(now.getTime() - 6 * 30 * 24 * 3600 * 1000);

  const tradeGroups = await prisma.apartmentTradeHistory.groupBy({
    by: ['aptSeq'],
    where: {
      lawdCd: { in: BUSAN_LAWD_CODES }, dealType: 'sale', dealCanceled: false,
      aptSeq: { not: null }, dealDate: { gte: from24 },
    },
    _count: { _all: true },
  });
  const aptSeqs = tradeGroups.map((g) => g.aptSeq!) as string[];
  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { in: aptSeqs } }, select: { aptSeq: true } });
  const masterSet = new Set(masters.map((m) => m.aptSeq));
  const missingAptSeqs = aptSeqs.filter((s) => !masterSet.has(s));

  console.log(`MASTER_MISSING(recent 24mo): ${missingAptSeqs.length}건\n`);

  const allMasters = await prisma.apartmentMaster.findMany({
    where: { sggCd: { in: BUSAN_LAWD_CODES } },
    select: { aptSeq: true, name: true, normalizedName: true, umdName: true, jibun: true, buildYear: true, latitude: true, longitude: true },
  });
  const masterByNormName = new Map<string, typeof allMasters>();
  for (const m of allMasters) {
    const key = m.normalizedName;
    if (!masterByNormName.has(key)) masterByNormName.set(key, []);
    masterByNormName.get(key)!.push(m);
  }

  const legacyAll = await prisma.apartment.findMany({ where: { lawdCd: { in: BUSAN_LAWD_CODES } } });

  const profiles: any[] = [];

  for (const aptSeq of missingAptSeqs) {
    const allTrades = await prisma.apartmentTradeHistory.findMany({
      where: { aptSeq },
      select: { aptName: true, dong: true, jibun: true, lawdCd: true, dealDate: true, buildYear: true, exclusiveArea: true },
      orderBy: { dealDate: 'asc' },
    });
    const recent24 = allTrades.filter((t) => t.dealDate >= from24);
    const recent12 = allTrades.filter((t) => t.dealDate >= from12);
    const recent6 = allTrades.filter((t) => t.dealDate >= from6);

    const nameVariants = new Set(allTrades.map((t) => t.aptName));
    const dongVariants = new Set(allTrades.map((t) => t.dong));
    const jibunVariants = new Set(allTrades.map((t) => t.jibun));
    const buildYearVariants = new Set(allTrades.map((t) => t.buildYear).filter(Boolean));
    const areaVariants = new Set(allTrades.map((t) => t.exclusiveArea?.toString()));

    const canonicalName = allTrades[allTrades.length - 1]?.aptName || '';
    const canonicalDong = allTrades[allTrades.length - 1]?.dong || '';
    const canonicalJibun = allTrades[allTrades.length - 1]?.jibun || '';
    const canonicalLawdCd = allTrades[allTrades.length - 1]?.lawdCd || '';
    const canonicalBuildYear = allTrades[allTrades.length - 1]?.buildYear ?? null;

    // Master alias check: normalized exact name match anywhere in Busan Master (not just same dong)
    const normName = normalizeSearchKeyword(canonicalName);
    const nameMatches = masterByNormName.get(normName) || [];
    // dong+jibun match (regardless of name) — could reveal a renamed row at the same address
    const addressMatch = allMasters.find((m) => m.umdName === canonicalDong && m.jibun === canonicalJibun);

    // legacy Apartment check
    const legacyExact = legacyAll.find((l) => normalizeSearchKeyword(l.name) === normName && l.dong === canonicalDong);
    const legacyAddress = legacyAll.find((l) => l.dong === canonicalDong && l.jibun === canonicalJibun);

    profiles.push({
      aptSeq,
      canonicalName,
      lawdCd: canonicalLawdCd,
      dong: canonicalDong,
      jibun: canonicalJibun,
      buildYear: canonicalBuildYear,
      totalTradeCount: allTrades.length,
      recent24Count: recent24.length,
      recent12Count: recent12.length,
      recent6Count: recent6.length,
      firstTradeDate: allTrades[0]?.dealDate,
      lastTradeDate: allTrades[allTrades.length - 1]?.dealDate,
      nameVariants: [...nameVariants],
      dongVariants: [...dongVariants],
      jibunVariants: [...jibunVariants],
      buildYearVariants: [...buildYearVariants],
      distinctAreaCount: areaVariants.size,
      sourceIdentityConflict: nameVariants.size > 1 || dongVariants.size > 1 || jibunVariants.size > 1,
      masterNameAliasMatches: nameMatches.map((m) => ({ aptSeq: m.aptSeq, name: m.name, dong: m.umdName, jibun: m.jibun })),
      masterAddressMatch: addressMatch ? { aptSeq: addressMatch.aptSeq, name: addressMatch.name } : null,
      legacyExactMatch: legacyExact ? { id: legacyExact.id, name: legacyExact.name, aptSeq: legacyExact.aptSeq } : null,
      legacyAddressMatch: legacyAddress ? { id: legacyAddress.id, name: legacyAddress.name, aptSeq: legacyAddress.aptSeq } : null,
    });
    console.log(`${aptSeq} ${canonicalName}(${canonicalDong}): trades=${allTrades.length}(24mo=${recent24.length}/12mo=${recent12.length}/6mo=${recent6.length}) buildYear=${canonicalBuildYear} nameAlias=${nameMatches.length} addrMatch=${!!addressMatch} legacyExact=${!!legacyExact} legacyAddr=${!!legacyAddress} identityConflict=${nameVariants.size > 1 || dongVariants.size > 1 || jibunVariants.size > 1}`);
  }

  const outDir = path.resolve(__dirname, '../data/master-integrity');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_recent-16-forensic-profiles.json'), JSON.stringify(profiles, null, 2));
  console.log(`\n저장: data/master-integrity/_recent-16-forensic-profiles.json`);

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
