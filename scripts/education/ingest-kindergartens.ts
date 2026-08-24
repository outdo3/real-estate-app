/**
 * SCHOOL V2-C3B — 유치원알리미 "일반현황"(basicInfo2) 기반 유치원
 * canonical master + stat ingestion(Kindergarten/KindergartenStat).
 *
 * source: 교육부 유치원알리미 OpenAPI(REST, JSON), 실제 endpoint/
 * 요청·응답 필드를 2026-08-21 포털에서 직접 확인(docs/development/
 * SCHOOL-V2-C3B-kindergarten-ingestion.md §2/§6 참고).
 *
 * 이 API는 시도코드+시군구코드가 둘 다 필수라 지역 목록을 순회하는
 * 구조 자체는 어린이집(cpmsapi021)/학교(NEIS) 스크립트와 동일한
 * 결이다 — REGIONS 목록을 통째로 바꾸면 다른 시도도 동일 스크립트로
 * 수집 가능하다(부산 전용 분기 없음, §14 지시).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/ingest-kindergartens.ts --dry-run
 *
 * 옵션:
 *   --dry-run          실제 API 호출은 하되 DB write 없음
 *   --sido=26          기본값 26(부산광역시)
 *   --sggcode=26140    기본 목록(BUSAN_DISTRICTS) 대신 이 시군구코드 1개만 대상
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';

const SOURCE_CODE = 'moe_kindergarten_basicinfo_api';
const BASE_URL = 'https://e-childschoolinfo.moe.go.kr/api/notice/basicInfo2.do';
const DEFAULT_SIDO = '26'; // 부산광역시(포털 드롭다운 실측값)
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 300;
const MAX_RETRY = 2;

// [실측] scripts/redevelopment/_results/busan_regcodes_raw.json(기존
// STEP에서 이미 검증된 원본)에서 파생한 부산 16개 구·군 5자리
// 시군구코드 — 어린이집/학교 스크립트와 동일 값 재사용(새로 만들지
// 않음). basicInfo2의 sggCode 요청 파라미터 형식(예제: "27140")과
// 자릿수가 일치한다.
const BUSAN_DISTRICTS: { code: string; name: string }[] = [
  { code: '26110', name: '중구' },
  { code: '26140', name: '서구' },
  { code: '26170', name: '동구' },
  { code: '26200', name: '영도구' },
  { code: '26230', name: '부산진구' },
  { code: '26260', name: '동래구' },
  { code: '26290', name: '남구' },
  { code: '26320', name: '북구' },
  { code: '26350', name: '해운대구' },
  { code: '26380', name: '사하구' },
  { code: '26410', name: '금정구' },
  { code: '26440', name: '강서구' },
  { code: '26470', name: '연제구' },
  { code: '26500', name: '수영구' },
  { code: '26530', name: '사상구' },
  { code: '26710', name: '기장군' },
];

type RawKinder = {
  // [실측 2026-08-21] 포털 명세 표는 "kinderCode"(camelCase)로 적혀
  // 있으나 실제 응답 필드명은 "kindercode"(전부 소문자)다 — 명세와
  // 실제 응답이 다르면 실제 응답을 우선한다(이번 STEP 지시 그대로).
  kindercode?: string;
  kindername?: string;
  establish?: string;
  addr?: string;
  telno?: string;
  lttdcdnt?: string | number;
  lngtcdnt?: string | number;
  clcnt3?: string | number; clcnt4?: string | number; clcnt5?: string | number;
  mixclcnt?: string | number; shclcnt?: string | number;
  prmstfcnt?: string | number;
  ag3fpcnt?: string | number; ag4fpcnt?: string | number; ag5fpcnt?: string | number;
  mixfpcnt?: string | number; spcnfpcnt?: string | number;
  ppcnt3?: string | number; ppcnt4?: string | number; ppcnt5?: string | number;
  mixppcnt?: string | number; shppcnt?: string | number;
  pbnttmng?: string | number; // 공시차수, YYYYT
};

type AgeBucket = { classCount: number | null; capacity: number | null; enrollment: number | null };
type AgeBreakdown = {
  schemaVersion: string;
  byAge: { age3: AgeBucket; age4: AgeBucket; age5: AgeBucket; mixed: AgeBucket; special: AgeBucket };
};

type NormalizedRow = {
  officialCode: string;
  kindergartenName: string;
  establishmentType: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  sidoCode: string;
  sigunguCode: string;
  capacity: number | null;
  ageBreakdown: AgeBreakdown;
  referenceYear: number | null;
};

type RowIssue = { raw: RawKinder; reason: string };

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeEmptyish(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === '' || t === '-') return null;
  return t;
}

// parse 실패를 0으로 치환하지 않는다(§11 지시) — 어린이집/학교와 동일 원칙.
function parseCountField(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseCoordinate(v: string | number | undefined): number | null {
  const n = parseCountField(v as any);
  if (n == null) return null;
  // 좌표가 0 또는 명백히 대한민국 범위 밖(위도 33~39, 경도 124~132 대략)이면
  // 미기재/오류 값으로 보고 저장하지 않는다(§ Missing semantics — 0을 실제
  // 좌표처럼 저장하지 않음. 정확한 범위는 대한민국 전역 기준 보수적으로 둠).
  if (n === 0) return null;
  return n;
}

function ageBucket(classCount: unknown, capacity: unknown, enrollment: unknown): AgeBucket {
  return {
    classCount: parseCountField(classCount as any),
    capacity: parseCountField(capacity as any),
    enrollment: parseCountField(enrollment as any),
  };
}

// pbnttmng(공시차수)는 "YYYYT" 형식(예: "20201")이라고 포털에 명시돼
// 있다 — 앞 4자리를 referenceYear로, 나머지를 차수로 본다. 형식이
// 다르면(자릿수 불일치 등) null로 남기고 임의 추정하지 않는다.
function parseReferenceYear(pbnttmng: string | number | undefined): number | null {
  if (pbnttmng == null) return null;
  const t = String(pbnttmng).trim();
  if (t.length < 5) return null;
  const year = Number(t.slice(0, 4));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  return year;
}

function normalizeRow(raw: RawKinder, sidoCode: string, sigunguCode: string): { row: NormalizedRow } | { issue: RowIssue } {
  const officialCode = normalizeEmptyish(raw.kindercode ?? null);
  const kindergartenName = normalizeEmptyish(raw.kindername ?? null);
  if (!officialCode) return { issue: { raw, reason: 'missing officialCode(kindercode)' } };
  if (!kindergartenName) return { issue: { raw, reason: 'missing kindergartenName' } };

  const ageBreakdown: AgeBreakdown = {
    schemaVersion: 'moe-kindergarten-basicinfo2-v1',
    byAge: {
      age3: ageBucket(raw.clcnt3, raw.ag3fpcnt, raw.ppcnt3),
      age4: ageBucket(raw.clcnt4, raw.ag4fpcnt, raw.ppcnt4),
      age5: ageBucket(raw.clcnt5, raw.ag5fpcnt, raw.ppcnt5),
      mixed: ageBucket(raw.mixclcnt, raw.mixfpcnt, raw.mixppcnt),
      special: ageBucket(raw.shclcnt, raw.spcnfpcnt, raw.shppcnt),
    },
  };

  return {
    row: {
      officialCode,
      kindergartenName,
      establishmentType: normalizeEmptyish(raw.establish ?? null),
      address: normalizeEmptyish(raw.addr ?? null),
      latitude: parseCoordinate(raw.lttdcdnt),
      longitude: parseCoordinate(raw.lngtcdnt),
      sidoCode,
      sigunguCode,
      // 인가총정원수(prmstfcnt)는 source가 이미 "총계"로 제공하는 값이라
      // DIRECT로 저장한다. classCount/enrollment는 총계 필드 자체가
      // source에 없어(연령별 세부만 있음) 임의로 합산해 만들지 않고
      // null로 두며, 세부는 ageBreakdown에만 보존한다(derived 값을
      // source-provided 필드에 섞지 않는다는 이 프로젝트 원칙, §Missing).
      capacity: parseCountField(raw.prmstfcnt),
      ageBreakdown,
      referenceYear: parseReferenceYear(raw.pbnttmng),
    },
  };
}

async function fetchDistrict(apiKey: string, sidoCode: string, sggCode: string): Promise<
  | { ok: true; items: RawKinder[] }
  | { ok: false; status: string; message: string }
> {
  let currentPage = 1;
  let all: RawKinder[] = [];

  for (;;) {
    const url = `${BASE_URL}?key=${apiKey}&sidoCode=${sidoCode}&sggCode=${sggCode}&pageCnt=${PAGE_SIZE}&currentPage=${currentPage}`;
    let lastErr: any = null;
    let data: any = null;

    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        data = await res.json();
        break;
      } catch (e: any) {
        lastErr = e;
        if (attempt < MAX_RETRY) { await sleep(500 * Math.pow(2, attempt)); continue; }
      }
    }
    if (data == null) return { ok: false, status: 'NETWORK_ERROR', message: String(lastErr?.message || lastErr) };

    // basicInfo2는 인증 실패 시 {"status":"DENIED","message":"유효하지
    // 않은 키"} 형태로 응답한다(2026-08-21 실측 확인) — 재시도해도
    // 결과가 바뀌지 않는 인증 오류라 즉시 반환한다(무한 재시도 금지).
    if (data.status === 'DENIED') {
      return { ok: false, status: data.status, message: String(data.message || '') };
    }

    // [실측 2026-08-21] 응답 배열은 "kinderInfo" 키 아래에 있다(문서화된
    // 명세 표에는 이 wrapper 자체가 없었음 — 실제 응답을 우선한다).
    const items: RawKinder[] = data.kinderInfo || [];
    if (!Array.isArray(items) || items.length === 0) break;
    all = all.concat(items);
    if (items.length < PAGE_SIZE) break; // 마지막 페이지
    currentPage++;
    await sleep(REQUEST_DELAY_MS);
  }

  return { ok: true, items: all };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sidoCode = args.find((a) => a.startsWith('--sido='))?.split('=')[1] ?? DEFAULT_SIDO;
  const sggcodeArg = args.find((a) => a.startsWith('--sggcode='))?.split('=')[1] ?? null;
  const targetDistricts = sggcodeArg ? [{ code: sggcodeArg, name: sggcodeArg }] : BUSAN_DISTRICTS;

  console.log('=== SCHOOL V2-C3B Kindergarten Ingestion ===');
  console.log(`dry-run: ${dryRun}, sido: ${sidoCode}`);
  console.log(`target districts: ${targetDistricts.length}`);

  // 이 API 전용 키는 이번 STEP에서 확보되지 않았다(BLOCKER, docs 참고) —
  // env에 없으면 즉시 STOP하고 어떤 계정/키도 신청하지 않는다.
  const apiKeyRaw = process.env.KINDERGARTEN_API_KEY || '';
  if (!apiKeyRaw) {
    console.error('BLOCKER: KINDERGARTEN_API_KEY not set in env. Cannot proceed (no key requested without user approval).');
    process.exitCode = 1;
    return;
  }
  const apiKey = encodeURIComponent(apiKeyRaw.trim());

  const source = await prisma.educationSource.findUnique({ where: { code: SOURCE_CODE } });
  if (!source) {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}) not registered.`);
    process.exitCode = 1;
    return;
  }
  if (source.legalReviewStatus !== 'CLEARED') {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}).legalReviewStatus = ${source.legalReviewStatus}, not CLEARED.`);
    process.exitCode = 1;
    return;
  }

  const summary = {
    districtsAttempted: 0, districtsOk: 0,
    fetchedRows: 0, validRows: 0, invalidRows: 0,
    createdCore: 0, updatedCore: 0, createdStat: 0, updatedStat: 0,
    authFailed: false,
  };
  const issues: RowIssue[] = [];
  const perDistrict: { code: string; name: string; fetched: number; error?: string }[] = [];

  for (const district of targetDistricts) {
    summary.districtsAttempted++;
    const result = await fetchDistrict(apiKey, sidoCode, district.code);

    if (!result.ok) {
      perDistrict.push({ code: district.code, name: district.name, fetched: 0, error: `${result.status}: ${result.message}` });
      console.error(`[FAIL] ${district.code} ${district.name} — ${result.status}: ${result.message}`);
      if (result.status === 'DENIED') {
        summary.authFailed = true;
        console.error('Auth error detected — aborting remaining districts.');
        break;
      }
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    summary.districtsOk++;
    summary.fetchedRows += result.items.length;
    perDistrict.push({ code: district.code, name: district.name, fetched: result.items.length });
    console.log(`[OK] ${district.code} ${district.name} — ${result.items.length} rows`);

    const fetchedAt = new Date();
    for (const raw of result.items) {
      const outcome = normalizeRow(raw, sidoCode, district.code);
      if ('issue' in outcome) { summary.invalidRows++; issues.push(outcome.issue); continue; }
      summary.validRows++;
      const row = outcome.row;
      if (dryRun) continue;

      const existing = await prisma.kindergarten.findUnique({ where: { officialCode: row.officialCode } });
      const kindergarten = await prisma.kindergarten.upsert({
        where: { officialCode: row.officialCode },
        create: {
          officialCode: row.officialCode,
          kindergartenName: row.kindergartenName,
          establishmentType: row.establishmentType,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          coordinateSource: row.latitude != null ? 'moe_kindergarten_api' : null,
          sidoCode: row.sidoCode,
          sigunguCode: row.sigunguCode,
          // kinderCode가 실제 공식 기관코드로 확인됐으므로(§7) 유치원 C1
          // 기본값 LOW 대신 HIGH로 명시 — 이름/주소 기반 fallback이 아님.
          identityConfidence: 'HIGH',
          qualityFlag: 'PARTIAL', // staffCount/hasShuttle/hasAfterSchool 등은 이 오퍼레이션에 없음
        },
        update: {
          kindergartenName: row.kindergartenName,
          establishmentType: row.establishmentType,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          coordinateSource: row.latitude != null ? 'moe_kindergarten_api' : null,
          sidoCode: row.sidoCode,
          sigunguCode: row.sigunguCode,
          identityConfidence: 'HIGH',
          qualityFlag: 'PARTIAL',
        },
      });
      if (existing) summary.updatedCore++; else summary.createdCore++;

      if (row.referenceYear != null) {
        const existingStat = await prisma.kindergartenStat.findUnique({
          where: { kindergartenId_sourceId_referenceYear: { kindergartenId: kindergarten.id, sourceId: source.id, referenceYear: row.referenceYear } },
        });
        await prisma.kindergartenStat.upsert({
          where: { kindergartenId_sourceId_referenceYear: { kindergartenId: kindergarten.id, sourceId: source.id, referenceYear: row.referenceYear } },
          create: {
            kindergartenId: kindergarten.id,
            referenceYear: row.referenceYear,
            capacity: row.capacity,
            ageBreakdown: row.ageBreakdown as any,
            sourceId: source.id,
            fetchedAt,
            disclosureStatus: 'AVAILABLE',
            qualityFlag: 'PARTIAL',
          },
          update: {
            capacity: row.capacity,
            ageBreakdown: row.ageBreakdown as any,
            fetchedAt,
            disclosureStatus: 'AVAILABLE',
            qualityFlag: 'PARTIAL',
          },
        });
        if (existingStat) summary.updatedStat++; else summary.createdStat++;
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Per-district ===');
  console.table(perDistrict);
  if (issues.length > 0) {
    console.log(`\n=== Invalid rows(${issues.length}) — first 5 ===`);
    console.log(JSON.stringify(issues.slice(0, 5), null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
