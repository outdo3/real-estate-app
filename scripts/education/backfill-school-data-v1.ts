/**
 * SCHOOL DATA BACKFILL V1 — 부산 School(664건) 대상 학교알리미(schoolinfo.go.kr)
 * 검증 데이터 backfill(SchoolStat 학생수/학급수/교원수, School 공식 좌표/미확보
 * 지역코드).
 *
 * source: schoolinfo.go.kr openApi.do apiType=0(기본정보+좌표+폐교여부) +
 * apiType=09(학년별·학급별 학생수, 교원수 TEACH_CNT도 함께 포함돼 있어 별도
 * apiType=22 호출 불필요 — scripts/education/c2b-verify-schoolinfo-api.ts로
 * 실측 확인). SCHUL_CODE(schoolinfo 자체 식별자)는 NEIS SD_SCHUL_CODE와 다른
 * 별도 체계라 crosswalk 불가 — School.schoolName + sigunguCode(+dongName) 조합
 * (src/lib/education/schoolinfo-match.ts, 동명이교 안전 처리)으로만 매칭한다.
 *
 * 조회는 (구/군 × 학교급) 단위 배치 호출이다 — 학교 개수만큼 반복 호출하지
 * 않는다(부산 16개 구/군 × 4개 학교급[초/중/고/특수] × 2개 apiType = 최대
 * 128회로 664개 학교 전체를 커버).
 *
 * 사용법:
 *   npx tsx scripts/education/backfill-school-data-v1.ts [옵션]
 *
 * 옵션:
 *   (기본값)             dry-run(Production write 없음)
 *   --apply              실제 Production write 수행(READY 상태만)
 *   --district=<sggCode> 부산 시군구코드로 한정(예: --district=26140)
 *   --school-code=<code> 단일 neisSchoolCode만 처리
 *   --limit=<n>          처리할 School row 상한(스모크 테스트용)
 *   --pban-yr=<year>     공시연도(기본 2026, 실측 확인된 최신 정상 연도)
 *   --resume             직전 체크포인트(tmp/qa/school-backfill-checkpoint.json)에서
 *                        FAILED_RETRYABLE만 재시도, 나머지는 스킵
 *   --json               요약을 tmp/qa/SCHOOL_DATA_BACKFILL_V1.json으로 저장
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true } as any);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true } as any);

import { PrismaClient } from '@prisma/client';
import {
  fetchSchoolInfoBasic,
  fetchSchoolInfoStat,
  SCHUL_KND_SC_CODE_BY_LEVEL,
  SchoolInfoApiError,
  type SchoolInfoBasicRecord,
  type SchoolInfoStatRecord,
} from '../../src/lib/education/schoolinfo-client';
import { matchSchoolInfoCandidate } from '../../src/lib/education/schoolinfo-match';
import { validateSchoolStat, isValidBusanCoordinate, normalizeGradeSlot } from '../../src/lib/education/schoolinfo-stat-validate';

const prisma = new PrismaClient();

const BUSAN_DISTRICTS = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

const argv = process.argv.slice(2);
function flag(name: string): string | null {
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}

const OPT = {
  apply: flag('apply') !== null,
  district: flag('district'),
  schoolCode: flag('school-code'),
  limit: flag('limit') ? parseInt(flag('limit')!, 10) : null,
  pbanYr: flag('pban-yr') || '2026',
  resume: flag('resume') !== null,
  json: flag('json') !== null,
};

const CHECKPOINT_PATH = path.resolve(__dirname, '../../tmp/qa/school-backfill-checkpoint.json');
const SOURCE_CODE = 'schoolinfo_openapi';

type Status = 'READY' | 'UNCHANGED' | 'REVIEW' | 'NO_SOURCE' | 'FAILED_RETRYABLE';

interface SchoolResult {
  neisSchoolCode: string;
  schoolId: number;
  schoolName: string;
  sigunguCode: string | null;
  status: Status;
  reason: string;
  statCandidate?: { studentCount: number | null; classCount: number | null; teacherCount: number | null };
  coordinateCandidate?: { latitude: number; longitude: number };
  addressCandidate?: { sidoCode: string; sigunguCode: string; dongName: string | null };
}

// ── 학교급별 코드 조회 캐시: (schulKndCode, sggCode) → apiType0/09 응답 ──
type BatchCache = Map<string, { basic: SchoolInfoBasicRecord[]; stat: SchoolInfoStatRecord[] }>;

async function loadBatch(apiKey: string, pbanYr: string, schulKndCode: string, sggCode: string, cache: BatchCache) {
  const key = `${schulKndCode}|${sggCode}`;
  if (cache.has(key)) return cache.get(key)!;

  const [basicRes, statRes] = await Promise.all([
    fetchSchoolInfoBasic(apiKey, pbanYr, schulKndCode, sggCode),
    fetchSchoolInfoStat(apiKey, pbanYr, schulKndCode, sggCode),
  ]);
  const basic = basicRes.ok ? basicRes.list : [];
  const stat = statRes.ok ? statRes.list : [];
  const entry = { basic, stat };
  cache.set(key, entry);
  return entry;
}

function pickGradeBreakdown(stat: SchoolInfoStatRecord) {
  return {
    students: [stat.COL_S1, stat.COL_S2, stat.COL_S3, stat.COL_S4, stat.COL_S5, stat.COL_S6, stat.COL_S7, stat.COL_S8].map(normalizeGradeSlot),
    classes: [stat.COL_C1, stat.COL_C2, stat.COL_C3, stat.COL_C4, stat.COL_C5, stat.COL_C6, stat.COL_C7, stat.COL_C8].map(normalizeGradeSlot),
  };
}

async function processSchool(
  school: { id: number; neisSchoolCode: string; schoolName: string; schoolLevel: string | null; sigunguCode: string | null; dongName: string | null; latitude: number | null; longitude: number | null; address: string | null; sidoCode: string | null },
  apiKey: string,
  cache: BatchCache
): Promise<SchoolResult & { statRecord?: SchoolInfoStatRecord; basicRecord?: SchoolInfoBasicRecord }> {
  const base = { neisSchoolCode: school.neisSchoolCode, schoolId: school.id, schoolName: school.schoolName, sigunguCode: school.sigunguCode };

  const schulKndCode = school.schoolLevel ? SCHUL_KND_SC_CODE_BY_LEVEL[school.schoolLevel] : undefined;
  if (!schulKndCode) {
    return { ...base, status: 'NO_SOURCE', reason: `schoolinfo가 다루지 않는 학교급(${school.schoolLevel})` };
  }

  // 구/군 미확보 학교(7건, §3 감사에서 확인) — 어느 구인지 몰라 전체 구/군을
  // 순회해서만 찾을 수 있다(이 학교급 배치는 이미 캐시돼 있으므로 추가 API
  // 호출 없이 메모리에서만 검색한다).
  const districtsToSearch = school.sigunguCode ? [school.sigunguCode] : BUSAN_DISTRICTS;

  const basicCandidates: { schulCode: string; addressBrkdn: string | undefined; record: SchoolInfoBasicRecord; sggCode: string }[] = [];
  let anySourceFound = false;
  for (const sgg of districtsToSearch) {
    let batch;
    try {
      batch = await loadBatch(apiKey, OPT.pbanYr, schulKndCode, sgg, cache);
    } catch (e) {
      if (e instanceof SchoolInfoApiError && e.retryable) {
        return { ...base, status: 'FAILED_RETRYABLE', reason: e.message };
      }
      return { ...base, status: 'FAILED_RETRYABLE', reason: (e as Error).message };
    }
    if (batch.basic.length > 0) anySourceFound = true;
    // ABSCH_YN='Y' 레코드는 이전/개편으로 대체된 과거 이력이다(실측: 강서구
    // 송정초등학교/대저중앙초등학교/경일중학교가 전부 이 쌍으로 존재) — 현재 유효한
    // 학교만 후보로 남긴다. 이 필터만으로 실측 확인된 동명이교 사례가 전부 1건으로
    // 좁혀졌지만, 혹시 남는 진짜 동명이교(같은 이름의 서로 다른 두 현재 학교)에
    // 대비해 dongName 2차 disambiguation(matchSchoolInfoCandidate)은 그대로 유지한다.
    const found = batch.basic.filter((r) => r.SCHUL_NM === school.schoolName && r.ABSCH_YN !== 'Y');
    basicCandidates.push(...found.map((r) => ({ schulCode: r.SCHUL_CODE, addressBrkdn: r.ADRES_BRKDN, record: r, sggCode: sgg })));
  }

  if (!anySourceFound) {
    return { ...base, status: 'NO_SOURCE', reason: '학교알리미 응답 자체가 비어있음(해당 구/군·학교급 데이터 없음)' };
  }

  const matchResult = matchSchoolInfoCandidate(
    school.dongName,
    basicCandidates.map((c) => ({ schulCode: c.schulCode, addressBrkdn: c.addressBrkdn }))
  );

  if (matchResult.status === 'NOT_FOUND') {
    return { ...base, status: 'NO_SOURCE', reason: '학교알리미에서 동일 이름 학교를 찾지 못함' };
  }
  if (matchResult.status === 'REVIEW_IDENTITY') {
    return { ...base, status: 'REVIEW', reason: matchResult.reason };
  }

  const matchedBasic = basicCandidates.find((c) => c.schulCode === matchResult.matched!.schulCode)!;

  // stat(apiType=09)은 같은 (schulKndCode, sggCode) 배치에서 동일 SCHUL_CODE로
  // 조회한다 — 두 apiType 모두 schoolinfo 자체 발급 SCHUL_CODE라 안정적으로
  // 대응된다(§6 실측 확인).
  const statBatch = await loadBatch(apiKey, OPT.pbanYr, schulKndCode, matchedBasic.sggCode, cache);
  const statRecord = statBatch.stat.find((s) => s.SCHUL_CODE === matchedBasic.schulCode);

  const result: SchoolResult & { statRecord?: SchoolInfoStatRecord; basicRecord?: SchoolInfoBasicRecord } = {
    ...base,
    status: 'READY',
    reason: matchResult.reason,
    basicRecord: matchedBasic.record,
  };

  // 좌표 candidate — 부산 범위 내 유효 좌표일 때만, School에 이미 좌표가 없을
  // 때만(§24 "nullable field update", 기존 값 임의 overwrite 금지).
  if (school.latitude == null && school.longitude == null && isValidBusanCoordinate(matchedBasic.record.LTTUD, matchedBasic.record.LGTUD)) {
    result.coordinateCandidate = { latitude: matchedBasic.record.LTTUD!, longitude: matchedBasic.record.LGTUD! };
  }

  // 구/군 미확보 학교(7건)만 — schoolinfo ADRCD_CD(법정동코드)에서 sido/sigungu
  // 파생. 기존 NEIS 기반 주소(657건)는 이미 공식값이 있어 건드리지 않는다.
  if (!school.sigunguCode && matchedBasic.record.ADRCD_CD && matchedBasic.record.ADRCD_CD.length >= 5) {
    result.addressCandidate = {
      sidoCode: matchedBasic.record.ADRCD_CD.slice(0, 2),
      sigunguCode: matchedBasic.record.ADRCD_CD.slice(0, 5),
      dongName: matchedBasic.record.ADRES_BRKDN || null,
    };
  }

  if (!statRecord) {
    // 기본정보는 찾았지만 학생수 통계가 없는 경우(PBAN_EXCP_YN 공시예외 등) —
    // 좌표/주소만 READY로 반영하고 통계는 NO_SOURCE로 별도 명시.
    result.reason += ' / 통계(apiType=09) 없음';
    return result;
  }
  if (statRecord.PBAN_EXCP_YN === 'Y') {
    result.reason += ' / 공시 예외(PBAN_EXCP_YN=Y) — 통계 미기재';
    return result;
  }

  const statCandidate = { studentCount: statRecord.COL_S_SUM, classCount: statRecord.COL_C_SUM, teacherCount: statRecord.TEACH_CNT };
  const validation = validateSchoolStat(statCandidate);
  if (!validation.valid) {
    return { ...base, status: 'REVIEW', reason: `통계 이상값: ${validation.reasons.join('; ')}`, basicRecord: matchedBasic.record, statRecord };
  }

  result.statCandidate = statCandidate;
  result.statRecord = statRecord;
  return result;
}

async function main() {
  console.log('='.repeat(72));
  console.log('SCHOOL DATA BACKFILL V1');
  console.log('='.repeat(72));
  console.log(`옵션: ${JSON.stringify(OPT)}`);

  const apiKey = process.env.SCHOOLINFO_API_KEY || '';
  if (!apiKey) {
    console.error('BLOCKER: SCHOOLINFO_API_KEY not set in env.');
    process.exitCode = 1;
    return;
  }

  const source = await prisma.educationSource.findUnique({ where: { code: SOURCE_CODE } });
  if (!source || source.legalReviewStatus !== 'CLEARED') {
    console.error(`BLOCKER: EducationSource(${SOURCE_CODE})가 CLEARED 상태가 아닙니다.`);
    process.exitCode = 1;
    return;
  }

  let resumeSkip = new Set<string>();
  if (OPT.resume && fs.existsSync(CHECKPOINT_PATH)) {
    const prevResults: SchoolResult[] = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8')).results;
    resumeSkip = new Set(prevResults.filter((r) => r.status !== 'FAILED_RETRYABLE').map((r) => r.neisSchoolCode));
    console.log(`--resume: 직전 체크포인트에서 ${resumeSkip.size}건 스킵(FAILED_RETRYABLE만 재처리)`);
  }

  const where: any = { neisSchoolCode: { not: null } };
  if (OPT.district) where.sigunguCode = OPT.district;
  if (OPT.schoolCode) where.neisSchoolCode = OPT.schoolCode;

  let schools = await prisma.school.findMany({
    where,
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, dongName: true, latitude: true, longitude: true, address: true, sidoCode: true },
    orderBy: { id: 'asc' },
  });
  if (resumeSkip.size > 0) schools = schools.filter((s) => !resumeSkip.has(s.neisSchoolCode!));
  if (OPT.limit) schools = schools.slice(0, OPT.limit);

  console.log(`\n대상 School: ${schools.length}건`);

  const cache: BatchCache = new Map();
  const results: (SchoolResult & { statRecord?: SchoolInfoStatRecord; basicRecord?: SchoolInfoBasicRecord })[] = [];

  for (const school of schools) {
    const r = await processSchool(school as any, apiKey, cache);
    results.push(r);
    process.stdout.write(`  ${school.schoolName}(${school.neisSchoolCode}) -> ${r.status}${r.status === 'REVIEW' || r.status === 'NO_SOURCE' || r.status === 'FAILED_RETRYABLE' ? ` (${r.reason})` : ''}\n`);
  }

  // ── UNCHANGED 판정: READY인데 기존 DB 값과 이미 동일하면 write 불필요 ──
  for (const r of results) {
    if (r.status !== 'READY') continue;
    if (r.statCandidate) {
      const existing = await prisma.schoolStat.findUnique({
        where: { schoolId_sourceId_referenceYear: { schoolId: r.schoolId, sourceId: source.id, referenceYear: parseInt(OPT.pbanYr, 10) } },
      });
      const coordUnchanged = !r.coordinateCandidate; // 좌표 candidate가 아예 없으면(이미 있던 값) 그 축은 변경 없음
      if (
        existing &&
        existing.studentCount === r.statCandidate.studentCount &&
        existing.classCount === r.statCandidate.classCount &&
        existing.teacherCount === r.statCandidate.teacherCount &&
        coordUnchanged &&
        !r.addressCandidate
      ) {
        r.status = 'UNCHANGED';
      }
    } else if (!r.coordinateCandidate && !r.addressCandidate) {
      // stat도 없고 좌표/주소 candidate도 없으면 실제로 반영할 변경이 없다.
      r.status = 'UNCHANGED';
    }
  }

  const summary = {
    TOTAL: results.length,
    READY: results.filter((r) => r.status === 'READY').length,
    UNCHANGED: results.filter((r) => r.status === 'UNCHANGED').length,
    REVIEW: results.filter((r) => r.status === 'REVIEW').length,
    NO_SOURCE: results.filter((r) => r.status === 'NO_SOURCE').length,
    FAILED_RETRYABLE: results.filter((r) => r.status === 'FAILED_RETRYABLE').length,
  };

  console.log('\n' + '='.repeat(72));
  console.log('DRY-RUN SUMMARY');
  console.log('='.repeat(72));
  console.log(JSON.stringify(summary, null, 2));

  const statCoverage = {
    studentCount: results.filter((r) => r.statCandidate?.studentCount != null).length,
    classCount: results.filter((r) => r.statCandidate?.classCount != null).length,
    teacherCount: results.filter((r) => r.statCandidate?.teacherCount != null).length,
    coordinate: results.filter((r) => r.coordinateCandidate).length,
  };
  console.log('\nCANDIDATE COVERAGE (dry-run):', JSON.stringify(statCoverage, null, 2));

  fs.mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), pbanYr: OPT.pbanYr, results }, null, 2));

  if (OPT.json) {
    const outPath = path.resolve(__dirname, '../../tmp/qa/SCHOOL_DATA_BACKFILL_V1.json');
    fs.writeFileSync(outPath, JSON.stringify({ options: OPT, summary, statCoverage, results }, null, 2));
    console.log(`\n[JSON] ${outPath}`);
  }

  if (!OPT.apply) {
    console.log('\ndry-run 완료(Production write 없음). --apply로 실제 반영.');
    await prisma.$disconnect();
    return;
  }

  // ── PRODUCTION APPLY: READY만 write ──
  console.log('\n' + '='.repeat(72));
  console.log('PRODUCTION APPLY (READY만)');
  console.log('='.repeat(72));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of results) {
    if (r.status !== 'READY') {
      skipped++;
      continue;
    }
    try {
      if (r.coordinateCandidate) {
        await prisma.school.update({
          where: { id: r.schoolId },
          data: {
            latitude: r.coordinateCandidate.latitude,
            longitude: r.coordinateCandidate.longitude,
            coordinateSource: SOURCE_CODE,
            coordinateType: 'OFFICIAL_POINT',
          },
        });
      }
      if (r.addressCandidate) {
        await prisma.school.update({
          where: { id: r.schoolId },
          data: {
            sidoCode: r.addressCandidate.sidoCode,
            sigunguCode: r.addressCandidate.sigunguCode,
            dongName: r.addressCandidate.dongName ?? undefined,
          },
        });
      }
      if (r.statCandidate) {
        const upserted = await prisma.schoolStat.upsert({
          where: { schoolId_sourceId_referenceYear: { schoolId: r.schoolId, sourceId: source.id, referenceYear: parseInt(OPT.pbanYr, 10) } },
          create: {
            schoolId: r.schoolId,
            sourceId: source.id,
            referenceYear: parseInt(OPT.pbanYr, 10),
            disclosureYear: parseInt(OPT.pbanYr, 10),
            studentCount: r.statCandidate.studentCount,
            classCount: r.statCandidate.classCount,
            teacherCount: r.statCandidate.teacherCount,
            gradeBreakdown: r.statRecord ? pickGradeBreakdown(r.statRecord) : undefined,
            sourceRecordId: r.basicRecord?.SCHUL_CODE ?? null,
            fetchedAt: new Date(),
            qualityFlag: 'COMPLETE',
            disclosureStatus: 'AVAILABLE',
          },
          update: {
            studentCount: r.statCandidate.studentCount,
            classCount: r.statCandidate.classCount,
            teacherCount: r.statCandidate.teacherCount,
            gradeBreakdown: r.statRecord ? pickGradeBreakdown(r.statRecord) : undefined,
            sourceRecordId: r.basicRecord?.SCHUL_CODE ?? null,
            fetchedAt: new Date(),
            qualityFlag: 'COMPLETE',
            disclosureStatus: 'AVAILABLE',
          },
        });
        if (upserted.createdAt.getTime() === upserted.updatedAt.getTime()) inserted++;
        else updated++;
      } else {
        updated++; // 좌표/주소만 변경된 경우도 update로 카운트
      }
    } catch (e) {
      console.error(`  APPLY FAILED: ${r.schoolName}(${r.neisSchoolCode}) — ${(e as Error).message}`);
      skipped++;
    }
  }

  console.log(`\nAPPLY 결과: inserted=${inserted}, updated=${updated}, skipped(non-READY 또는 오류)=${skipped}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
