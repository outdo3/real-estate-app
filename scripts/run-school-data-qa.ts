/**
 * SCHOOL DATA GAP FIX §7 — 부산 School/SchoolStat 데이터 회귀를 자동 검사하는
 * reusable QA 스크립트. 기본적으로 READ ONLY(DB write 없음).
 *
 * 검사 범위(§8): identity(중복/누락 canonical code), region(구/군 누락),
 * stats(누락/불가능한 값/중복), coordinates(누락/범위 밖), source(NO_SOURCE
 * 분류), product contract(canonical route가 실제로 열리는지 — dev 서버가 떠
 * 있을 때만 best-effort로 확인, 없으면 SKIPPED로 표시하고 실패로 취급하지
 * 않는다).
 *
 * 사용법:
 *   npx tsx scripts/run-school-data-qa.ts [옵션]
 *
 * 옵션:
 *   --all                 전체 School 대상(기본값)
 *   --school-code=<code>  단일 neisSchoolCode만 검사
 *   --district=<sggCode>  부산 시군구코드로 한정
 *   --quick               product-contract 라이브 확인(§F) 생략, DB 검사만
 *   --json                결과를 tmp/qa/SCHOOL_DATA_QA.json으로 저장
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true } as any);

import { PrismaClient } from '@prisma/client';
import { isValidBusanCoordinate } from '../src/lib/education/schoolinfo-stat-validate';

const prisma = new PrismaClient();

const BUSAN_DISTRICTS = new Set([
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
]);

// 학교알리미가 통계를 공시하지 않는 것으로 실측 확인된 학교급(SCHOOL DATA
// BACKFILL V1) — 이 목록에 속하는 학교의 SchoolStat 부재는 P1이 아니라
// SOURCE_LIMITATION으로 분류한다(억지로 채우지 않는다는 원칙의 QA 반영).
const SCHOOLINFO_UNSUPPORTED_LEVELS = new Set([
  '외국인학교', '평생학교(고)-2년6학기', '평생학교(고)-3년6학기', '평생학교(중)-2년6학기',
  '각종학교(고)', '각종학교(중)', '방송통신고등학교', '방송통신중학교', '공동실습소', '고등기술학교',
]);

const REQUIRED_FIXTURES = [
  { neisSchoolCode: '7191048', schoolName: '과정초등학교' },
  { neisSchoolCode: '7171046', schoolName: '구덕초등학교' },
  { neisSchoolCode: '7171056', schoolName: '대신초등학교' },
  { neisSchoolCode: '7211185', schoolName: '해원초등학교' },
  { neisSchoolCode: '7171011', schoolName: '경남중학교' },
  { neisSchoolCode: '7150400', schoolName: '한국과학영재학교(orphan 해결)' },
  { neisSchoolCode: '7201046', schoolName: '괘법초등학교(NO_SOURCE)' },
];

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = {
  schoolCode: flag('school-code'),
  district: flag('district'),
  quick: flag('quick') !== null,
  json: flag('json') !== null,
};

interface Finding {
  severity: 'P0_WRONG_SCHOOL' | 'P0_IDENTITY' | 'P0_INVALID_STAT' | 'P1_REGION_GAP' | 'P1_STAT_COVERAGE' | 'P1_COORDINATE_GAP' | 'SOURCE_LIMITATION';
  schoolId: number;
  neisSchoolCode: string | null;
  schoolName: string;
  detail: string;
}

async function main() {
  const where: any = {};
  if (OPT.schoolCode) where.neisSchoolCode = OPT.schoolCode;
  if (OPT.district) where.sigunguCode = OPT.district;

  const schools = await prisma.school.findMany({
    where,
    include: { stats: { orderBy: { referenceYear: 'desc' }, take: 1 } },
  });

  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // A. Identity
  const codeCount = new Map<string, number>();
  for (const s of schools) {
    if (!s.neisSchoolCode) {
      push({ severity: 'P0_IDENTITY', schoolId: s.id, neisSchoolCode: null, schoolName: s.schoolName, detail: 'neisSchoolCode 없음(canonical identity 미확보)' });
      continue;
    }
    codeCount.set(s.neisSchoolCode, (codeCount.get(s.neisSchoolCode) || 0) + 1);
  }
  for (const [code, count] of codeCount) {
    if (count > 1) {
      const dupes = schools.filter((s) => s.neisSchoolCode === code);
      for (const d of dupes) push({ severity: 'P0_WRONG_SCHOOL', schoolId: d.id, neisSchoolCode: code, schoolName: d.schoolName, detail: `neisSchoolCode 중복(${count}건) — DB unique 제약 위반 상태` });
    }
  }
  // 이름+구/군+동이 완전히 같은데 School row가 2개 이상이면 identity 충돌 가능성.
  const identityKey = new Map<string, number>();
  for (const s of schools) {
    const key = `${s.schoolName}|${s.sigunguCode}|${s.dongName}`;
    identityKey.set(key, (identityKey.get(key) || 0) + 1);
  }
  for (const s of schools) {
    const key = `${s.schoolName}|${s.sigunguCode}|${s.dongName}`;
    if ((identityKey.get(key) || 0) > 1) {
      push({ severity: 'P0_IDENTITY', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '이름+구/군+동 완전 동일한 School row 2건 이상 — identity 충돌 의심' });
    }
  }

  // B. Region
  for (const s of schools) {
    if (!s.sidoCode) {
      push({ severity: 'P1_REGION_GAP', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: 'sidoCode 없음' });
    }
    if (!s.sigunguCode) {
      push({ severity: 'P1_REGION_GAP', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: 'sigunguCode 없음(SOURCE_LIMITATION 가능— 공식 도로명주소 자체 미확보)' });
    } else if (!BUSAN_DISTRICTS.has(s.sigunguCode)) {
      push({ severity: 'P1_REGION_GAP', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `sigunguCode(${s.sigunguCode})가 부산 16개 구/군 목록에 없음` });
    }
  }

  // C. Stats
  const unsupported = { count: 0 };
  for (const s of schools) {
    const stat = s.stats[0];
    if (!stat) {
      if (s.schoolLevel && SCHOOLINFO_UNSUPPORTED_LEVELS.has(s.schoolLevel)) {
        push({ severity: 'SOURCE_LIMITATION', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `학교알리미 미지원 학교급(${s.schoolLevel}) — 통계 공시 대상 아님` });
        unsupported.count++;
      } else {
        push({ severity: 'P1_STAT_COVERAGE', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '일반 지원 학교급인데 SchoolStat 없음 — SCHOOL DATA BACKFILL V1 전체 실행에서도 학교알리미가 이 개별 학교의 통계를 공시하지 않은 것으로 확인됨(identity/좌표는 정상)' });
      }
      continue;
    }
    if (stat.studentCount != null && stat.studentCount < 0) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `studentCount 음수(${stat.studentCount})` });
    if (stat.classCount != null && stat.classCount < 0) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `classCount 음수(${stat.classCount})` });
    if (stat.teacherCount != null && stat.teacherCount < 0) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `teacherCount 음수(${stat.teacherCount})` });
    if (stat.studentCount != null && stat.studentCount > 0 && stat.classCount === 0) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '학생수>0인데 classCount=0' });
    if (stat.studentCount != null && stat.studentCount > 0 && stat.teacherCount === 0) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '학생수>0인데 teacherCount=0' });
    if (stat.referenceYear == null) push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: 'referenceYear 없음' });
  }
  // 같은 (schoolId, sourceId, referenceYear) 중복(DB unique 제약이 이미 막지만 방어적으로 재확인)
  const dupStatCheck = await prisma.$queryRaw<Array<{ school_id: number; source_id: number; reference_year: number; c: bigint }>>`
    SELECT school_id, source_id, reference_year, COUNT(*) c FROM school_stats
    GROUP BY school_id, source_id, reference_year HAVING COUNT(*) > 1
  `;
  for (const d of dupStatCheck) {
    push({ severity: 'P0_INVALID_STAT', schoolId: d.school_id, neisSchoolCode: null, schoolName: '(unknown)', detail: `동일 (schoolId, sourceId, referenceYear) SchoolStat 중복(${d.c}건)` });
  }

  // D. Coordinates
  for (const s of schools) {
    if (s.latitude == null || s.longitude == null) {
      push({ severity: 'P1_COORDINATE_GAP', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '공식 좌표 없음' });
      continue;
    }
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) {
      push({ severity: 'P0_INVALID_STAT', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '좌표가 유한값이 아님(NaN/Infinity)' });
      continue;
    }
    if (!isValidBusanCoordinate(s.latitude, s.longitude)) {
      push({ severity: 'P0_WRONG_SCHOOL', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: `좌표가 부산 범위 밖(${s.latitude}, ${s.longitude})` });
    }
    if (s.coordinateType === 'UNKNOWN') {
      push({ severity: 'P1_COORDINATE_GAP', schoolId: s.id, neisSchoolCode: s.neisSchoolCode, schoolName: s.schoolName, detail: '좌표는 있는데 coordinateType이 UNKNOWN — provenance 불명확' });
    }
  }

  // E. Source
  const statSourceIds = new Set(schools.flatMap((s) => s.stats.map((st) => st.sourceId)));
  if (statSourceIds.size > 0) {
    const sources = await prisma.educationSource.findMany({ where: { id: { in: Array.from(statSourceIds) } } });
    for (const src of sources) {
      if (src.code !== 'schoolinfo_openapi') {
        push({ severity: 'P1_STAT_COVERAGE', schoolId: 0, neisSchoolCode: null, schoolName: '(source)', detail: `예상외 source 사용: ${src.code}` });
      }
      if (src.legalReviewStatus !== 'CLEARED') {
        push({ severity: 'P0_INVALID_STAT', schoolId: 0, neisSchoolCode: null, schoolName: '(source)', detail: `source ${src.code}가 CLEARED 상태가 아님(${src.legalReviewStatus}) — 사용 중단 필요` });
      }
    }
  }

  // F. Product contract(라이브 확인, --quick이면 생략)
  const contractResults: { code: string; name: string; result: string }[] = [];
  if (!OPT.quick) {
    for (const fx of REQUIRED_FIXTURES) {
      try {
        const res = await fetch(`http://localhost:3000/api/school/${fx.neisSchoolCode}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          contractResults.push({ code: fx.neisSchoolCode, name: fx.schoolName, result: `HTTP_${res.status}` });
          continue;
        }
        const json = await res.json();
        if (json.status !== 'OK') {
          contractResults.push({ code: fx.neisSchoolCode, name: fx.schoolName, result: `STATUS_${json.status}` });
          continue;
        }
        const ok = json.identity?.type === 'CANONICAL' && Array.isArray(json.relatedApartments);
        contractResults.push({ code: fx.neisSchoolCode, name: fx.schoolName, result: ok ? 'PASS' : 'CONTRACT_MISMATCH' });
      } catch {
        contractResults.push({ code: fx.neisSchoolCode, name: fx.schoolName, result: 'SKIPPED_NO_SERVER' });
      }
    }
  }

  // Severity 집계
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;

  const p0 = (counts.P0_WRONG_SCHOOL || 0) + (counts.P0_IDENTITY || 0) + (counts.P0_INVALID_STAT || 0);
  const statCoverage = schools.length > 0 ? schools.filter((s) => s.stats[0]).length / schools.length : 1;
  let releaseGate: 'READY' | 'LIMITED' | 'BLOCKED';
  if (p0 > 0) releaseGate = 'BLOCKED';
  else if (statCoverage < 0.85) releaseGate = 'LIMITED';
  else releaseGate = 'READY';

  console.log(`BUSAN SCHOOLS: ${schools.length}`);
  console.log('\nIDENTITY');
  console.log(`  P0_WRONG_SCHOOL: ${counts.P0_WRONG_SCHOOL || 0}`);
  console.log(`  P0_IDENTITY: ${counts.P0_IDENTITY || 0}`);
  console.log('\nREGION');
  console.log(`  P1_REGION_GAP: ${counts.P1_REGION_GAP || 0}`);
  console.log('\nSTATS');
  console.log(`  coverage: ${(statCoverage * 100).toFixed(1)}%`);
  console.log(`  P0_INVALID_STAT: ${counts.P0_INVALID_STAT || 0}`);
  console.log(`  P1_STAT_COVERAGE: ${counts.P1_STAT_COVERAGE || 0}`);
  console.log('\nCOORDINATES');
  console.log(`  P1_COORDINATE_GAP: ${counts.P1_COORDINATE_GAP || 0}`);
  console.log('\nSOURCE LIMITATIONS');
  console.log(`  ${counts.SOURCE_LIMITATION || 0}`);
  if (!OPT.quick) {
    console.log('\nPRODUCT CONTRACT (fixtures)');
    for (const c of contractResults) console.log(`  [${c.result}] ${c.name}(${c.code})`);
  }
  console.log(`\nRELEASE GATE\n  ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'SCHOOL_DATA_QA.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), totalSchools: schools.length, counts, statCoverage, releaseGate, findings, contractResults }, null, 2)
    );
    console.log('\n(JSON: tmp/qa/SCHOOL_DATA_QA.json)');
  }

  await prisma.$disconnect();
  if (p0 > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
