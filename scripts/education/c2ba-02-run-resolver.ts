// SCHOOL V2-C2B-A — canonical School(664, NEIS 기반) × SchoolInfo 부산 universe에
// resolver를 실제로 돌려 커버리지/중복/미해결 사례를 산출한다. READ-ONLY(DB read만,
// write 없음). scripts/education/c2ba-01-fetch-schoolinfo-universe.ts가 만든
// 스크래치패드 캐시를 그대로 사용 — 재호출 없음(대량 API 재호출 방지).
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { resolveAll, normalizeName, bucketNeisLevel, bucketSchoolInfoKind, type CanonicalSchool, type SchoolInfoRecord } from './lib/schoolinfo-identity-resolver';

const prisma = new PrismaClient();
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

async function main() {
  // ── §1 canonical School universe ──
  const canonicalRaw = await prisma.school.findMany({
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, dongName: true, roadAddress: true },
  });
  console.log('=== §1 canonical School universe ===');
  console.log('TOTAL:', canonicalRaw.length);
  const canonicalByBucket = new Map<string, number>();
  for (const c of canonicalRaw) {
    const b = bucketNeisLevel(c.schoolLevel);
    canonicalByBucket.set(b, (canonicalByBucket.get(b) || 0) + 1);
  }
  console.log('bucket별:', JSON.stringify([...canonicalByBucket.entries()]));
  console.log('neisSchoolCode 100% 존재?', canonicalRaw.every((c) => !!c.neisSchoolCode));

  // ── §2 SchoolInfo universe(캐시 로드) ──
  const rawList: any[] = JSON.parse(readFileSync(`${SCRATCHPAD}\\schoolinfo-busan-universe.json`, 'utf-8'));
  const schoolInfoList: SchoolInfoRecord[] = rawList.map((r) => ({
    schulCode: r.SCHUL_CODE,
    schulNm: r.SCHUL_NM,
    schulKndScCode: r.SCHUL_KND_SC_CODE,
    sggCode: r.__sggCode,
    addrBrkdn: r.ADRES_BRKDN || '',
    bnhhYn: r.BNHH_YN || 'N',
  }));
  console.log('\n=== §2 SchoolInfo Busan universe ===');
  console.log('TOTAL rows:', schoolInfoList.length);
  const siByBucket = new Map<string, number>();
  for (const r of schoolInfoList) {
    const b = bucketSchoolInfoKind(r.schulKndScCode);
    siByBucket.set(b, (siByBucket.get(b) || 0) + 1);
  }
  console.log('bucket별:', JSON.stringify([...siByBucket.entries()]));

  // ── §3 1차 exact matching(정규화 없이, 이름+시군구만) ──
  console.log('\n=== §3 1차 exact matching (schoolLevel/학교급 무시, 이름+시군구만) ===');
  const siByNameSigungu = new Map<string, SchoolInfoRecord[]>();
  for (const r of schoolInfoList) {
    const key = `${r.sggCode}|${r.schulNm}`;
    siByNameSigungu.set(key, [...(siByNameSigungu.get(key) || []), r]);
  }
  let directUnique = 0, ambiguous = 0, noMatch = 0;
  for (const c of canonicalRaw) {
    const key = `${c.sigunguCode}|${c.schoolName}`;
    const matches = siByNameSigungu.get(key) || [];
    if (matches.length === 0) noMatch++;
    else if (matches.length === 1) directUnique++;
    else ambiguous++;
  }
  console.log('DIRECT_UNIQUE:', directUnique, 'AMBIGUOUS:', ambiguous, 'NO_MATCH:', noMatch);

  // ── §4 normalization audit: NO_MATCH 중 normalizeName 적용하면 잡히는 게 있는지 ──
  console.log('\n=== §4 normalization audit ===');
  const siByNameSigunguNorm = new Map<string, SchoolInfoRecord[]>();
  for (const r of schoolInfoList) {
    const key = `${r.sggCode}|${normalizeName(r.schulNm)}`;
    siByNameSigunguNorm.set(key, [...(siByNameSigunguNorm.get(key) || []), r]);
  }
  let recoveredByNormalization = 0;
  for (const c of canonicalRaw) {
    const rawKey = `${c.sigunguCode}|${c.schoolName}`;
    const normKey = `${c.sigunguCode}|${normalizeName(c.schoolName)}`;
    const rawMatches = siByNameSigungu.get(rawKey) || [];
    const normMatches = siByNameSigunguNorm.get(normKey) || [];
    if (rawMatches.length === 0 && normMatches.length > 0) recoveredByNormalization++;
  }
  console.log('공백/전각 정규화로 추가 회복된 NO_MATCH 건수:', recoveredByNormalization);

  // ── §5 same-sigungu duplicate 전수조사(SchoolInfo 쪽) ──
  console.log('\n=== §5 same-sigungu duplicate groups(SchoolInfo 자체, 학교급 무관) ===');
  const dupGroups = [...siByNameSigungu.entries()].filter(([, rows]) => rows.length > 1);
  console.log('그룹 수:', dupGroups.length);
  for (const [key, rows] of dupGroups) {
    console.log(`  [${key}]`);
    for (const r of rows) {
      console.log(`    SCHUL_CODE=${r.schulCode} kind=${r.schulKndScCode} addr="${r.addrBrkdn}" BNHH_YN=${r.bnhhYn}`);
    }
  }

  // ── §10/§12 resolver 실행 + coverage ──
  console.log('\n=== §10/§12 resolver 실행 결과 ===');
  const results = resolveAll(canonicalRaw as CanonicalSchool[], schoolInfoList);
  const byConfidence = { HIGH: 0, MEDIUM: 0, LOW: 0, NO_MATCH: 0 };
  for (const r of results) byConfidence[r.confidence]++;
  console.log(JSON.stringify(byConfidence));
  console.log('TRUE_IDENTITY_COVERAGE = HIGH/664 =', (byConfidence.HIGH / canonicalRaw.length * 100).toFixed(1) + '%');

  console.log('\n학교급별 coverage:');
  for (const bucket of ['ELEMENTARY', 'MIDDLE', 'HIGH', 'SPECIAL', 'OTHER'] as const) {
    const inBucket = results.filter((r) => bucketNeisLevel(r.canonical.schoolLevel) === bucket);
    const highInBucket = inBucket.filter((r) => r.confidence === 'HIGH');
    console.log(`  ${bucket}: HIGH ${highInBucket.length}/${inBucket.length} (${inBucket.length ? (highInBucket.length / inBucket.length * 100).toFixed(1) : '0.0'}%)`);
  }

  // 무결성 체크: 서로 다른 canonical School이 같은 SchoolInfo SCHUL_CODE로 HIGH 매칭된 사례(버그/오매칭) 있는지
  console.log('\n=== WRONG_MERGE 무결성 체크 ===');
  const schulCodeToCanonical = new Map<string, number[]>();
  for (const r of results) {
    if (r.confidence === 'HIGH' && r.matched) {
      schulCodeToCanonical.set(r.matched.schulCode, [...(schulCodeToCanonical.get(r.matched.schulCode) || []), r.canonical.id]);
    }
  }
  const wrongMerges = [...schulCodeToCanonical.entries()].filter(([, ids]) => ids.length > 1);
  console.log('WRONG_MERGE(같은 SCHUL_CODE가 2개 이상 canonical School에 HIGH 매칭됨):', wrongMerges.length, JSON.stringify(wrongMerges));

  // ── §13 SchoolInfo-only / NEIS-only ──
  console.log('\n=== §13 SchoolInfo-only / NEIS-only ===');
  const matchedSchulCodes = new Set(results.filter((r) => r.matched).map((r) => r.matched!.schulCode));
  const schoolInfoOnly = schoolInfoList.filter((r) => !matchedSchulCodes.has(r.schulCode));
  const neisOnly = results.filter((r) => r.confidence === 'NO_MATCH');
  console.log('SchoolInfo-only(매칭 안 된 SchoolInfo row) count:', schoolInfoOnly.length);
  console.log('NEIS-only(매칭 안 된 canonical School) count:', neisOnly.length);
  console.log('NEIS-only 목록(school kind mismatch 포함 전체):', JSON.stringify(neisOnly.slice(0, 30).map((r) => ({ name: r.canonical.schoolName, level: r.canonical.schoolLevel, sigungu: r.canonical.sigunguCode }))));

  // ── §14 same-name regression cases ──
  console.log('\n=== §14 same-name regression cases ===');
  for (const name of ['송정초등학교', '대저중앙초등학교', '가락중학교']) {
    const matchesForName = results.filter((r) => r.canonical.schoolName === name);
    for (const r of matchesForName) {
      console.log(`  ${name}(id=${r.canonical.id}, sigungu=${r.canonical.sigunguCode}) -> confidence=${r.confidence}, matched=${r.matched?.schulCode ?? 'null'}, reasons=${JSON.stringify(r.reasons)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
