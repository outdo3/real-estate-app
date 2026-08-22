/**
 * SCHOOL V2-C2A — NEIS 학교기본정보(schoolInfo) 기반 School canonical
 * master ingestion. 학생수/학급수/교원/졸업생 진로 등 SchoolStat은
 * 이번 STEP에서 전혀 다루지 않는다(학교알리미 C2B 범위).
 *
 * source: NEIS 교육정보 개방포털 schoolInfo API(기존 /api/school,
 * /api/school/stats route가 이미 쓰고 있는 것과 동일 endpoint/파싱
 * 구조 — 새 parser를 중복 구현하지 않고 그 구조를 그대로 재사용했다,
 * §3/§19 지시).
 *
 * office-code(ATPT_OFCDC_SC_CODE)는 하드코딩된 분기가 아니라 CLI
 * 파라미터다 — 이번 실행은 부산(C10)만 대상으로 하지만, 다른 시도를
 * 수집하려면 --office-code=<코드>만 바꾸면 된다(§12/§13 지시).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/ingest-schools-neis.ts --dry-run
 *
 * 옵션:
 *   --dry-run              실제 API 호출은 하되 DB write 없음
 *   --force                (현재 School에 freshness 개념이 없어 전체 upsert와 동일 — 향후 확장 대비 자리만 유지)
 *   --office-code=C10      기본값 C10(부산광역시교육청). 다른 시도교육청 코드로 교체 가능
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import * as fs from 'fs';
import { prisma } from '@/lib/prisma';

const SOURCE_CODE = 'neis_school_info';
const DEFAULT_OFFICE_CODE = 'C10'; // 부산광역시교육청(src/lib/neis-sido-codes.ts와 동일 값)
const PAGE_SIZE = 500; // 기존 /api/school, /api/school/stats route와 동일

// ── 부산 16개 구·군 시군구코드 조회(공식 법정동코드 원본에서 파생) ──
// scripts/redevelopment/_results/busan_regcodes_raw.json은 기존 재개발
// STEP에서 이미 검증된 공식 법정동코드 dump다(gitignore 대상 scratch
// 파일이라 worktree마다 로컬 복사 필요 — 이번 STEP에서 main 작업물의
// 동일 파일을 그대로 복사해 재사용했다, 새로 만들지 않음). "코드 끝
// 5자리 00000"인 row만 시군구 단위다. 이 로직은 부산에 한정되지 않고
// 이 JSON에 어떤 시도가 담겨 있든 동일하게 동작한다(§13 지시 — 전국
// 확장 시 이 파일을 전국판으로 교체하면 동일 코드가 그대로 작동).
type RegcodeEntry = { code: string; name: string };
function loadSigunguRegcodes(): RegcodeEntry[] {
  const filePath = path.resolve(__dirname, '../redevelopment/_results/busan_regcodes_raw.json');
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return (data.regcodes || []).filter((r: RegcodeEntry) => /^\d{5}00000$/.test(r.code));
}

// 도로명주소 문자열에서 시도+구/군 토큰이 "정확히" 일치하는 regcode
// entry를 찾는다(부분 문자열 포함 매칭 금지 — 기존 addressMatchesRegion과
// 같은 원칙). 매칭 실패 시 null(임의 코드로 채우지 않음, §14 지시).
function resolveSigunguCode(roadAddress: string | null, regcodes: RegcodeEntry[]): { sidoCode: string; sigunguCode: string } | null {
  if (!roadAddress) return null;
  const tokens = roadAddress.split(/\s+/);
  for (const entry of regcodes) {
    const nameTokens = entry.name.split(/\s+/); // 예: ["부산광역시", "북구"]
    if (nameTokens.length < 2) continue;
    const gunguToken = nameTokens[nameTokens.length - 1];
    const sidoFull = nameTokens[0]; // "부산광역시"
    // [실측 2026-08-21] NEIS ORG_RDNMA가 "부산광역시" 대신 "부산"처럼
    // 축약 표기를 쓰는 사례가 실제로 있다(부산솔빛학교: "부산 사상구
    // 백양대로 650 ..."). 시도 전체 명칭 포함 여부만 보면 이런 축약
    // 표기를 놓치므로, 시도명 앞 2글자(광역시/도 접미사 제외)도 허용한다
    // — 구/군 토큰은 여전히 정확 일치(exact match)만 인정해 다른
    // 시도의 동명 구·군과 섞이지 않는다(전국 확장 시에도 안전).
    const sidoShort = sidoFull.replace(/(특별자치시|특별자치도|광역시|특별시|도)$/, '');
    const sidoMatches = roadAddress.includes(sidoFull) || tokens.includes(sidoShort);
    if (tokens.includes(gunguToken) && sidoMatches) {
      return { sidoCode: entry.code.slice(0, 2), sigunguCode: entry.code.slice(0, 5) };
    }
  }
  return null;
}

type RawSchool = {
  SD_SCHUL_CODE?: string;
  SCHUL_NM?: string;
  SCHUL_KND_SC_NM?: string;
  FOND_SC_NM?: string;
  COEDU_SC_NM?: string;
  ORG_RDNMA?: string;
  ORG_RDNDA?: string;
  ORG_TELNO?: string;
  HMPG_ADRES?: string;
  LCTN_SC_NM?: string;
};

type NormalizedRow = {
  neisSchoolCode: string;
  schoolName: string;
  schoolLevel: string | null;
  establishmentType: string | null;
  genderType: string | null;
  roadAddress: string | null;
  dongName: string | null;
  phone: string | null;
  homepage: string | null;
  sidoCode: string | null;
  sigunguCode: string | null;
};

type RowIssue = { raw: RawSchool; reason: string };

// crhome류와 동일한 "의미 없는 placeholder" 정규화 원칙(ingest-childcare.ts와
// 동일 함수를 별도 파일에 다시 둔 이유: 두 스크립트가 서로 다른 raw shape을
// 다루고 있어 공유 유틸로 추상화하면 오히려 원본 필드명이 가려짐 — 각자
// 자기 source의 필드명으로 명시적으로 유지).
function normalizeEmptyish(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || t === 'http://' || t === 'https://' || t === '-') return null;
  return t;
}

// ORG_RDNDA는 "(구포동)"처럼 괄호로 감싼 상세동 표기 — 괄호를 벗겨
// dongName으로 쓴다. 괄호가 없거나 빈 값이면 null.
function extractDongName(v: string | undefined | null): string | null {
  const t = normalizeEmptyish(v);
  if (!t) return null;
  const m = t.match(/\(([^)]+)\)/);
  return m ? m[1] : t;
}

function normalizeRow(raw: RawSchool, regcodes: RegcodeEntry[]): { row: NormalizedRow } | { issue: RowIssue } {
  const neisSchoolCode = (raw.SD_SCHUL_CODE || '').trim();
  const schoolName = (raw.SCHUL_NM || '').trim();

  // NEIS schoolInfo에는 아직 개교하지 않은 예정 학교("(가칭)에코1초등학교" 등,
  // FOND_YMD가 미래 날짜)가 SD_SCHUL_CODE 공백으로 섞여 있다(부산 667건 중
  // 실측 3건, 2026-08-21 확인) — 학교명으로 임시 코드를 만들지 않고 skip.
  if (!neisSchoolCode) return { issue: { raw, reason: 'missing neisSchoolCode(SD_SCHUL_CODE blank — likely a not-yet-opened school)' } };
  if (!schoolName) return { issue: { raw, reason: 'missing schoolName(SCHUL_NM)' } };

  const roadAddress = normalizeEmptyish(raw.ORG_RDNMA);
  const region = resolveSigunguCode(roadAddress, regcodes);

  return {
    row: {
      neisSchoolCode,
      schoolName,
      // SCHUL_KND_SC_NM은 NEIS 공식 필드 원문을 그대로 저장한다 — 이름
      // 접미사(".includes('초등학교')")로 재분류하지 않는다(§9 지시,
      // 기존 classifySchoolLevel의 취약점을 School master에는 들이지 않음).
      schoolLevel: normalizeEmptyish(raw.SCHUL_KND_SC_NM),
      establishmentType: normalizeEmptyish(raw.FOND_SC_NM),
      genderType: normalizeEmptyish(raw.COEDU_SC_NM),
      roadAddress,
      dongName: extractDongName(raw.ORG_RDNDA),
      phone: normalizeEmptyish(raw.ORG_TELNO),
      homepage: normalizeEmptyish(raw.HMPG_ADRES),
      sidoCode: region?.sidoCode ?? null,
      sigunguCode: region?.sigunguCode ?? null,
    },
  };
}

// 학교급 원문(SCHUL_KND_SC_NM)을 리포트 집계용으로만 5개 버킷으로
// 묶는다 — DB에는 절대 이 버킷명을 저장하지 않는다(원문 그대로
// School.schoolLevel에 저장, §9). 이 함수는 §15/§20 커버리지 리포트
// 출력 전용.
function bucketSchoolLevel(raw: string | null): 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER' {
  if (!raw) return 'OTHER';
  if (raw === '초등학교') return 'ELEMENTARY';
  if (raw === '특수학교') return 'SPECIAL';
  if (raw.includes('중학교')) return 'MIDDLE'; // 중학교, 방송통신중학교, 각종학교(중), 평생학교(중)-2년6학기
  if (raw.includes('고등학교') || raw.includes('고등기술학교')) return 'HIGH'; // 고등학교, 방송통신고등학교, 각종학교(고), 평생학교(고)-*, 고등기술학교
  return 'OTHER'; // 공동실습소, 외국인학교 등
}

async function fetchAllSchools(apiKey: string, officeCode: string): Promise<RawSchool[]> {
  let all: RawSchool[] = [];
  let pIndex = 1;
  let totalCount = Infinity;
  while ((pIndex - 1) * PAGE_SIZE < totalCount) {
    const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${apiKey}&Type=json&pIndex=${pIndex}&pSize=${PAGE_SIZE}&ATPT_OFCDC_SC_CODE=${officeCode}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`NEIS HTTP ${res.status}`);
    const data: any = await res.json();

    const result = data.schoolInfo?.[0]?.head?.[1]?.RESULT;
    if (result && result.CODE !== 'INFO-000') {
      throw new Error(`NEIS ${result.CODE}: ${result.MESSAGE}`);
    }

    totalCount = data.schoolInfo?.[0]?.head?.[0]?.list_total_count ?? 0;
    const rows: RawSchool[] = data.schoolInfo?.[1]?.row || [];
    if (rows.length === 0) break;
    all = all.concat(rows);
    pIndex++;
  }
  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const officeCode = args.find((a) => a.startsWith('--office-code='))?.split('=')[1] ?? DEFAULT_OFFICE_CODE;

  console.log('=== SCHOOL V2-C2A NEIS School Master Ingestion ===');
  console.log(`dry-run: ${dryRun}`);
  console.log(`office-code: ${officeCode}${officeCode === DEFAULT_OFFICE_CODE ? '(기본값=부산광역시교육청)' : ''}`);

  const apiKeyRaw = process.env.NEIS_API_KEY || '';
  if (!apiKeyRaw) {
    console.error('BLOCKER: NEIS_API_KEY not set in env. Cannot proceed.');
    process.exitCode = 1;
    return;
  }

  const source = await prisma.educationSource.findUnique({ where: { code: SOURCE_CODE } });
  if (!source) {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}) not registered. Run register-neis-school-source.ts first.`);
    process.exitCode = 1;
    return;
  }
  if (source.legalReviewStatus !== 'CLEARED') {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}).legalReviewStatus = ${source.legalReviewStatus}, not CLEARED. Ingestion blocked.`);
    process.exitCode = 1;
    return;
  }

  const regcodes = loadSigunguRegcodes();
  console.log(`region regcode entries loaded: ${regcodes.length}`);

  let rawSchools: RawSchool[];
  try {
    rawSchools = await fetchAllSchools(apiKeyRaw, officeCode);
  } catch (e: any) {
    console.error(`BLOCKER: NEIS fetch failed — ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const summary = {
    fetched: rawSchools.length,
    valid: 0,
    invalid: 0,
    createdCore: 0,
    updatedCore: 0,
    regionResolved: 0,
    regionUnresolved: 0,
  };
  const issues: RowIssue[] = [];
  const levelBuckets: Record<string, number> = { ELEMENTARY: 0, MIDDLE: 0, HIGH: 0, SPECIAL: 0, OTHER: 0 };
  const districtCounts: Record<string, number> = {};
  const seenCodes = new Set<string>();
  let duplicateCodes = 0;

  for (const raw of rawSchools) {
    const outcome = normalizeRow(raw, regcodes);
    if ('issue' in outcome) {
      summary.invalid++;
      issues.push(outcome.issue);
      continue;
    }
    summary.valid++;
    const row = outcome.row;

    if (seenCodes.has(row.neisSchoolCode)) duplicateCodes++;
    seenCodes.add(row.neisSchoolCode);

    levelBuckets[bucketSchoolLevel(row.schoolLevel)]++;
    if (row.sigunguCode) {
      summary.regionResolved++;
      districtCounts[row.sigunguCode] = (districtCounts[row.sigunguCode] || 0) + 1;
    } else {
      summary.regionUnresolved++;
    }

    if (dryRun) continue;

    const existing = await prisma.school.findUnique({ where: { neisSchoolCode: row.neisSchoolCode } });
    // isActive는 이 create/update 어디에도 명시하지 않는다 — NEIS
    // schoolInfo에 폐교/운영상태를 판정할 공식 field가 없어(§18 확인)
    // 스키마 기본값(true)에 위임한다(어린이집 C3A와 동일 원칙).
    await prisma.school.upsert({
      where: { neisSchoolCode: row.neisSchoolCode },
      create: {
        neisSchoolCode: row.neisSchoolCode,
        schoolName: row.schoolName,
        schoolLevel: row.schoolLevel,
        establishmentType: row.establishmentType,
        genderType: row.genderType,
        roadAddress: row.roadAddress,
        dongName: row.dongName,
        phone: row.phone,
        homepage: row.homepage,
        sidoCode: row.sidoCode,
        sigunguCode: row.sigunguCode,
        qualityFlag: row.sigunguCode ? 'COMPLETE' : 'PARTIAL',
      },
      update: {
        schoolName: row.schoolName,
        schoolLevel: row.schoolLevel,
        establishmentType: row.establishmentType,
        genderType: row.genderType,
        roadAddress: row.roadAddress,
        dongName: row.dongName,
        phone: row.phone,
        homepage: row.homepage,
        sidoCode: row.sidoCode,
        sigunguCode: row.sigunguCode,
        qualityFlag: row.sigunguCode ? 'COMPLETE' : 'PARTIAL',
      },
    });
    if (existing) summary.updatedCore++; else summary.createdCore++;
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify({ ...summary, duplicateCodes }, null, 2));
  console.log('\n=== School level buckets(report-only, not stored) ===');
  console.log(JSON.stringify(levelBuckets, null, 2));
  console.log('\n=== District counts(sigunguCode) ===');
  console.log(JSON.stringify(districtCounts, null, 2));
  if (issues.length > 0) {
    console.log(`\n=== Invalid rows(${issues.length}) ===`);
    issues.forEach((i) => console.log(` - ${i.raw.SCHUL_NM ?? '(no name)'}: ${i.reason}`));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
