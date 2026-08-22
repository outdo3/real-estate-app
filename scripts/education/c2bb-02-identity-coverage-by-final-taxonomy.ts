// SCHOOL V2-C2B-B §4 — identity mapping(schoolinfo-identity-resolver.ts, C2B-A에서
// 커밋된 그대로 미변경) 결과를 §1/§2/§3에서 확정한 FINAL canonical taxonomy로
// 재집계한다. resolver 로직 자체는 건드리지 않는다 — 그룹핑(리포트 라벨)만
// 교체한다. READ-ONLY, write 없음. SchoolInfo universe는 스크래치패드 캐시 재사용
// (재호출 없음).
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { resolveAll, type CanonicalSchool, type SchoolInfoRecord } from './lib/schoolinfo-identity-resolver';
import { finalSchoolTypeBucket } from './lib/school-type-taxonomy';

const prisma = new PrismaClient();
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

// resolver의 내부 bucketNeisLevel(매칭 로직 일부, 이번 STEP에서 미변경)과는 별개로,
// 리포트 그룹핑에는 §2/§3에서 확정한 FINAL taxonomy(./lib/school-type-taxonomy.ts)를 쓴다.
function finalBucket(raw: string | null): 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER' {
  const b = finalSchoolTypeBucket(raw);
  return b === 'UNKNOWN_RAW_VALUE' ? 'OTHER' : b;
}

async function main() {
  const canonicalRaw = await prisma.school.findMany({
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, dongName: true, roadAddress: true },
  });
  const rawList: any[] = JSON.parse(readFileSync(`${SCRATCHPAD}\\schoolinfo-busan-universe.json`, 'utf-8'));
  const schoolInfoList: SchoolInfoRecord[] = rawList.map((r) => ({
    schulCode: r.SCHUL_CODE,
    schulNm: r.SCHUL_NM,
    schulKndScCode: r.SCHUL_KND_SC_CODE,
    sggCode: r.__sggCode,
    addrBrkdn: r.ADRES_BRKDN || '',
    bnhhYn: r.BNHH_YN || 'N',
  }));

  // resolver 로직은 C2B-A 커밋 그대로 — 여기서 재구현/수정하지 않는다.
  const results = resolveAll(canonicalRaw as CanonicalSchool[], schoolInfoList);

  const overall = { HIGH: 0, MEDIUM: 0, LOW: 0, NO_MATCH: 0 };
  for (const r of results) overall[r.confidence]++;
  console.log('=== 전체(변경 없음, C2B-A와 동일해야 함) ===');
  console.log(JSON.stringify(overall));
  console.log('TRUE_IDENTITY_COVERAGE =', (overall.HIGH / canonicalRaw.length * 100).toFixed(1) + '%');

  console.log('\n=== §4/§16-20 FINAL taxonomy 기준 학교급별 재집계 ===');
  for (const bucket of ['ELEMENTARY', 'MIDDLE', 'HIGH', 'SPECIAL', 'OTHER'] as const) {
    const inBucket = results.filter((r) => finalBucket(r.canonical.schoolLevel) === bucket);
    const high = inBucket.filter((r) => r.confidence === 'HIGH').length;
    const medium = inBucket.filter((r) => r.confidence === 'MEDIUM').length;
    const low = inBucket.filter((r) => r.confidence === 'LOW').length;
    const noMatch = inBucket.filter((r) => r.confidence === 'NO_MATCH').length;
    console.log(`${bucket}: total=${inBucket.length} HIGH=${high} MEDIUM=${medium} LOW=${low} NO_MATCH=${noMatch} coverage=${inBucket.length ? (high / inBucket.length * 100).toFixed(1) : '0.0'}%`);
  }

  // 고등기술학교(finalBucket=HIGH이지만 resolver 내부 bucketNeisLevel은 여전히 OTHER로
  // 처리함 — resolver 코드는 안 바꿨으므로)의 실제 개별 결과를 투명하게 보여준다.
  console.log('\n=== 고등기술학교(부산국제영화고등학교, id=286) 개별 결과 — resolver 내부 버킷 함수 미수정 상태 재확인 ===');
  const gisool = results.find((r) => r.canonical.id === 286);
  console.log(JSON.stringify({ confidence: gisool?.confidence, matched: gisool?.matched?.schulCode ?? null, reasons: gisool?.reasons }, null, 1));

  // 무결성 재확인
  const schulCodeToCanonical = new Map<string, number[]>();
  for (const r of results) {
    if (r.confidence === 'HIGH' && r.matched) {
      schulCodeToCanonical.set(r.matched.schulCode, [...(schulCodeToCanonical.get(r.matched.schulCode) || []), r.canonical.id]);
    }
  }
  const wrongMerges = [...schulCodeToCanonical.entries()].filter(([, ids]) => ids.length > 1);
  console.log('\nWRONG_MERGE 재확인:', wrongMerges.length);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
