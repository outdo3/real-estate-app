// SCHOOL V2-C2B-B §1/§2/§3 — C2A(ingest-schools-neis.ts bucketSchoolLevel)와
// C2B-A(schoolinfo-identity-resolver.ts bucketNeisLevel)의 school-type bucket
// 차이를 학교 단위로 diff하고, 최종 canonical taxonomy를 명시적 매핑표로 확정한다.
// READ-ONLY(DB read만), write 없음.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { PrismaClient } from '@prisma/client';
import { finalSchoolTypeBucket } from './lib/school-type-taxonomy';

const prisma = new PrismaClient();

// ── C2A 원본 함수 그대로 복사(scripts/education/ingest-schools-neis.ts:164-171) ──
function c2aBucket(raw: string | null): 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER' {
  if (!raw) return 'OTHER';
  if (raw === '초등학교') return 'ELEMENTARY';
  if (raw === '특수학교') return 'SPECIAL';
  if (raw.includes('중학교')) return 'MIDDLE';
  if (raw.includes('고등학교') || raw.includes('고등기술학교')) return 'HIGH';
  return 'OTHER';
}

// ── C2B-A 원본 함수 그대로 복사(scripts/education/lib/schoolinfo-identity-resolver.ts) ──
function c2baBucket(raw: string | null): 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER' {
  const s = raw || '';
  if (s.includes('특수')) return 'SPECIAL';
  if (s.startsWith('초등학교')) return 'ELEMENTARY';
  if (s.includes('중학교') || s.includes('(중)')) return 'MIDDLE';
  if (s.includes('고등학교') || s.includes('(고)')) return 'HIGH';
  return 'OTHER';
}

// ── §2/§3: 최종 canonical taxonomy — 부산 664건에 실제 존재하는 14개 원문 값을
// 전수 확인해 명시적으로 하나씩 매핑한다(정규식/substring 재사용 안 함 — 이번
// 사고 원인 자체가 substring 매칭 누락이었으므로 최종 표는 exact-value lookup으로
// 만들어 같은 종류의 버그를 원천 차단한다). 근거는 각 학교 종류의 공식 성격
// (교육과정 급, 학력인정 여부)에 따른 것이며, DB에 저장된 원문 School.schoolLevel은
// 전혀 건드리지 않는다 — 이 표는 리포트/분석 전용 파생 라벨이다. 실제 표는
// ./lib/school-type-taxonomy.ts로 분리해 fixture 테스트를 붙였다(중복 정의 방지).
const finalBucket = finalSchoolTypeBucket;

async function main() {
  const schools = await prisma.school.findMany({
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true },
    orderBy: { id: 'asc' },
  });
  console.log('canonical School total:', schools.length);

  const c2aCounts: Record<string, number> = { ELEMENTARY: 0, MIDDLE: 0, HIGH: 0, SPECIAL: 0, OTHER: 0 };
  const c2baCounts: Record<string, number> = { ELEMENTARY: 0, MIDDLE: 0, HIGH: 0, SPECIAL: 0, OTHER: 0 };
  const finalCounts: Record<string, number> = { ELEMENTARY: 0, MIDDLE: 0, HIGH: 0, SPECIAL: 0, OTHER: 0, UNKNOWN_RAW_VALUE: 0 };

  const diffRows: any[] = [];
  const unknownRaw: any[] = [];

  for (const s of schools) {
    const a = c2aBucket(s.schoolLevel);
    const b = c2baBucket(s.schoolLevel);
    const f = finalBucket(s.schoolLevel);
    c2aCounts[a]++;
    c2baCounts[b]++;
    finalCounts[f]++;
    if (f === 'UNKNOWN_RAW_VALUE') {
      unknownRaw.push({ id: s.id, schoolName: s.schoolName, schoolLevel: s.schoolLevel });
    }
    if (a !== b) {
      diffRows.push({
        id: s.id,
        neisSchoolCode: s.neisSchoolCode,
        schoolName: s.schoolName,
        rawSchoolLevel: s.schoolLevel,
        c2aBucket: a,
        c2baBucket: b,
        finalBucket: f,
      });
    }
  }

  console.log('\n=== C2A bucket totals(재구성) ===');
  console.log(JSON.stringify(c2aCounts));
  console.log('=== C2B-A bucket totals(재구성) ===');
  console.log(JSON.stringify(c2baCounts));
  console.log('=== FINAL canonical taxonomy totals ===');
  console.log(JSON.stringify(finalCounts));
  console.log('\nUNKNOWN_RAW_VALUE(664건 전수 표에 없는 새 원문값, 있으면 안 됨):', unknownRaw.length, JSON.stringify(unknownRaw));

  console.log('\n=== §1 discrepancy rows (C2A bucket ≠ C2B-A bucket) ===');
  console.log('count:', diffRows.length);
  console.log(JSON.stringify(diffRows, null, 1));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
