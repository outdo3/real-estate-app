/**
 * SCHOOL V2-C3A — 어린이집 공식 데이터 ingestion(Childcare/ChildcareStat).
 *
 * source: 한국사회보장정보원 "전국 어린이집 정보조회"(cpmsapi021),
 * info.childcare.go.kr에서 공식 서비스 명세서(OpenAPI서비스명세서_021_v1.0.doc,
 * svcseq=79)를 직접 다운로드해 확인한 실제 field 기준으로만 매핑한다
 * (docs/development/SCHOOL-V2-C3A-childcare-ingestion.md §2/§5 참고).
 *
 * 이 API는 "전체 조회"가 없고 시군구코드(arcode)별로만 조회 가능하다 —
 * 그래서 REGIONS 목록을 순회하는 구조 자체가 "부산 전용"이 아니라
 * "지역 코드 목록을 넘기면 그 지역들을 수집"하는 범용 구조다. 이번
 * 실행은 BUSAN_DISTRICTS만 넘겨 부산 16개 구·군만 수집한다(§8 지시,
 * 특정 구 하드코딩이 아니라 "이번 실행 대상 목록"일 뿐 — 다른 시도를
 * 수집하려면 이 배열 대신 다른 지역 코드 배열을 넘기면 된다).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/ingest-childcare.ts --dry-run
 *
 * 옵션:
 *   --dry-run          실제 API 호출은 하되(실 데이터 구조 검증 위해) DB write 없음
 *   --force            freshness skip 없이 전 지역 재수집
 *   --sigungu=26140    기본 목록(BUSAN_DISTRICTS) 대신 이 시군구코드 1개만 대상
 *   --region-name=서구 --sigungu와 함께 쓰면 로그에만 표시(선택)
 *
 * region scope를 코드에 하드코딩하지 않고 옵션으로 분리했다(SCHOOL
 * V2-C3A BLOCKER RESOLUTION §16 지시) — 이번 실행은 옵션 없이 실행해
 * BUSAN_DISTRICTS(부산 16개 구·군) 그대로 쓰지만, 다른 시도를 검증할
 * 때는 --sigungu=<코드>만 바꿔서 같은 스크립트를 그대로 재사용한다.
 * 전국 대량 순회(300여개 시군구 자동 loop)는 이번 STEP에서 만들지
 * 않는다(전국 실행은 SCHOOL V2-C3A-NATIONWIDE에서 별도 설계 예정).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/prisma';

// [실측] scripts/redevelopment/_results/busan_regcodes_raw.json(기존 재개발 STEP에서
// 이미 확보된 공식 법정동코드 원본)에서 "코드 끝 5자리 00000"(시군구 단위 row)만
// 추출해 확인한 부산 16개 구·군 5자리 시군구코드 — 임의 하드코딩이 아니라 기존에
// 검증된 원본 데이터에서 파생했다. cpmsapi021의 arcode 파라미터는 example에서도
// 5자리("11380", "48880")를 쓰므로 형식이 일치한다.
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

const CPMSAPI021_URL = 'http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request';
const SOURCE_CODE = 'childcare_national_api';
const REQUEST_DELAY_MS = 300; // 정부 API 관례 페이싱(Kakao 150ms 관례보다 보수적으로 — 이 서비스의 실측 rate limit이 확인된 적 없어 §19 지시대로 안전 측 선택)
const MAX_RETRY = 2;

type RawItem = {
  stcode?: string;
  crname?: string;
  crtel?: string;
  crtelno?: string;
  crfax?: string;
  crfaxno?: string;
  craddr?: string;
  crhome?: string;
  crcapat?: string | number;
  arcode?: string;
  frstcnfmdt?: string;
};

type NormalizedRow = {
  facilityCode: string;
  childcareName: string;
  address: string | null;
  phone: string | null;
  homepage: string | null;
  sidoCode: string | null;
  sigunguCode: string | null;
  capacity: number | null;
};

type RowIssue = { raw: RawItem; reason: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// crhome처럼 "없음"류 placeholder 문자열이 실제 URL이 아니라 "값 없음"을 의미하는
// 경우를 null로 정규화한다(§13 지시 — 알 수 없는/의미 없는 원문 값을 그대로 저장해
// "필드가 있는 것처럼" 보이게 만들지 않는다).
function normalizeEmptyish(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || t === '없음' || t === '-') return null;
  return t;
}

// crcapat이 숫자로 파싱 안 되면(파싱 실패) null — 0으로 치환하지 않는다(§12 지시,
// "parse 실패를 0으로 변환 금지"). 실제 "0"이 온 경우에만 0을 저장한다.
function parseCountField(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// §6 field mapping — DIRECT/NORMALIZED/IGNORED/UNKNOWN 분류는
// docs/development/SCHOOL-V2-C3A-childcare-ingestion.md §6 표 참고.
function normalizeRow(raw: RawItem, districtCode: string): { row: NormalizedRow } | { issue: RowIssue } {
  const facilityCode = (raw.stcode || '').trim();
  const childcareName = (raw.crname || '').trim();
  if (!facilityCode) return { issue: { raw, reason: 'missing facilityCode(stcode)' } };
  if (!childcareName) return { issue: { raw, reason: 'missing childcareName(crname)' } };

  // sidoCode는 API가 직접 주지 않는다 — arcode(시군구코드) 앞 2자리가 시도코드라는
  // 것은 대한민국 행정표준코드 체계의 공개된 규칙이다(예: "26"=부산광역시). 이 값을
  // 추정이 아니라 코드 체계 규칙 적용으로 명시한다(V1/V2-B에서 이미 이 프로젝트
  // 다른 코드도 동일 체계를 쓰고 있음, neis-sido-codes.ts 등).
  const sigunguCode = (raw.arcode || districtCode || '').trim() || null;
  const sidoCode = sigunguCode ? sigunguCode.slice(0, 2) : null;

  return {
    row: {
      facilityCode,
      childcareName,
      address: normalizeEmptyish(raw.craddr),
      // 명세서 표는 crtelno/crfaxno로 적혀 있으나 실제 예제 응답 태그는 crtel/crfax다
      // (§5-3 실측 불일치) — 실제 응답 태그를 우선한다.
      phone: normalizeEmptyish(raw.crtel ?? raw.crtelno),
      homepage: normalizeEmptyish(raw.crhome),
      sidoCode,
      sigunguCode,
      capacity: parseCountField(raw.crcapat),
    },
  };
}

async function fetchDistrict(apiKey: string, districtCode: string): Promise<
  | { ok: true; items: RawItem[] }
  | { ok: false; errcode: string; errmsg: string }
> {
  const url = `${CPMSAPI021_URL}?key=${apiKey}&arcode=${districtCode}`;
  let lastErr: any = null;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(text);
      const response = parsed?.response;

      if (response?.errcode) {
        // INFO-100(인증키 무효)/INFO-400(만료)는 재시도해도 결과가 바뀌지 않는
        // 인증 실패다 — 429/5xx처럼 잠깐 기다렸다 다시 시도할 대상이 아니므로
        // 즉시 반환한다(§19 지시 "429 시 무한 재시도 금지"와 같은 원칙을
        // 인증 오류에도 적용 — 무한정 재시도하지 않음).
        return { ok: false, errcode: String(response.errcode), errmsg: String(response.errmsg || '') };
      }

      const items = response?.item;
      if (!items) return { ok: true, items: [] }; // INFO-200(검색결과 없음)과 동일하게 취급
      return { ok: true, items: Array.isArray(items) ? items : [items] };
    } catch (e: any) {
      lastErr = e;
      if (attempt < MAX_RETRY) {
        await sleep(500 * Math.pow(2, attempt)); // exponential backoff
        continue;
      }
    }
  }
  return { ok: false, errcode: 'NETWORK_ERROR', errmsg: String(lastErr?.message || lastErr) };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const sigunguArg = args.find((a) => a.startsWith('--sigungu='))?.split('=')[1] ?? null;
  const regionNameArg = args.find((a) => a.startsWith('--region-name='))?.split('=')[1] ?? null;

  // 기본은 BUSAN_DISTRICTS(이번 STEP 대상, 부산만) — --sigungu가 오면 그
  // 코드 하나만 대상으로 좁힌다. 이 목록을 통째로 바꿔치기하면 다른
  // 시도도 같은 스크립트로 처리 가능하다는 뜻이다(하드코딩 아님).
  const targetDistricts = sigunguArg
    ? [{ code: sigunguArg, name: regionNameArg ?? sigunguArg }]
    : BUSAN_DISTRICTS;

  console.log('=== SCHOOL V2-C3A Childcare Ingestion ===');
  console.log(`dry-run: ${dryRun}, force: ${force}`);
  console.log(`region scope: ${sigunguArg ? `--sigungu=${sigunguArg}` : 'default(BUSAN_DISTRICTS, 16개 구·군)'}`);
  console.log(`target districts: ${targetDistricts.length}`);

  const apiKeyRaw = process.env.DATA_GO_KR_API_KEY || '';
  if (!apiKeyRaw) {
    console.error('BLOCKER: DATA_GO_KR_API_KEY not set in env. Cannot proceed.');
    process.exitCode = 1;
    return;
  }
  const apiKey = encodeURIComponent(decodeURIComponent(apiKeyRaw.trim().replace(/['"]/g, '')));

  // legal gate — EducationSource가 등록돼 있고 CLEARED 상태인지 확인 없이는
  // ingestion을 진행하지 않는다(§3/§29 지시 그대로, 코드 레벨 강제).
  const source = await prisma.educationSource.findUnique({ where: { code: SOURCE_CODE } });
  if (!source) {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}) not registered. Run the source-registration step first.`);
    process.exitCode = 1;
    return;
  }
  if (source.legalReviewStatus !== 'CLEARED') {
    console.error(`BLOCKER: EducationSource(code=${SOURCE_CODE}).legalReviewStatus = ${source.legalReviewStatus}, not CLEARED. Ingestion blocked.`);
    process.exitCode = 1;
    return;
  }

  const summary = {
    districtsAttempted: 0,
    districtsOk: 0,
    fetchedRows: 0,
    validRows: 0,
    invalidRows: 0,
    createdCore: 0,
    updatedCore: 0,
    createdStat: 0,
    updatedStat: 0,
    authFailed: false,
  };
  const issues: RowIssue[] = [];
  const perDistrict: { code: string; name: string; fetched: number; error?: string }[] = [];

  for (const district of targetDistricts) {
    summary.districtsAttempted++;
    const result = await fetchDistrict(apiKey, district.code);

    if (!result.ok) {
      perDistrict.push({ code: district.code, name: district.name, fetched: 0, error: `${result.errcode}: ${result.errmsg}` });
      console.error(`[FAIL] ${district.code} ${district.name} — ${result.errcode}: ${result.errmsg}`);

      // INFO-100/INFO-400은 인증키 자체 문제라 다른 지역을 계속 호출해도 결과가
      // 같다 — 나머지 15개 구·군에 같은 실패를 반복하며 외부 서버에 불필요한
      // 호출을 보내지 않고 즉시 중단한다.
      if (result.errcode === 'INFO-100' || result.errcode === 'INFO-400') {
        summary.authFailed = true;
        console.error('Auth error detected — aborting remaining districts (no point retrying with the same invalid key).');
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
      const outcome = normalizeRow(raw, district.code);
      if ('issue' in outcome) {
        summary.invalidRows++;
        issues.push(outcome.issue);
        continue;
      }
      summary.validRows++;
      const row = outcome.row;

      if (dryRun) continue;

      const existing = await prisma.childcare.findUnique({ where: { facilityCode: row.facilityCode } });
      const childcare = await prisma.childcare.upsert({
        where: { facilityCode: row.facilityCode },
        create: {
          facilityCode: row.facilityCode,
          childcareName: row.childcareName,
          address: row.address,
          // phone/homepage는 source(crtel/crhome)에 실제로 있지만 C1 schema에는
          // 저장할 컬럼이 없다(Childcare에 phone/homepage 필드 없음) — 임의 schema
          // 추가 없이 IGNORED 처리(§6 mapping 표, SCHOOL-V2-C3A 문서에 후속
          // migration 후보로 기록. NormalizedRow에는 남겨 향후 재사용 가능).
          sidoCode: row.sidoCode,
          sigunguCode: row.sigunguCode,
          // 이 API는 위경도/기관유형/운영상태를 주지 않는다(§6 mapping 표) — 좌표는
          // 이번 STEP 범위에서 채우지 않는다(추정 좌표 생성 금지). coordinateType은
          // Prisma 기본값 UNKNOWN 그대로 둔다.
          qualityFlag: 'PARTIAL', // 원천 API 필드 커버리지 자체가 부분적(§27)
        },
        update: {
          childcareName: row.childcareName,
          address: row.address,
          sidoCode: row.sidoCode,
          sigunguCode: row.sigunguCode,
          qualityFlag: 'PARTIAL',
        },
      });
      if (existing) summary.updatedCore++; else summary.createdCore++;

      const referenceDate = new Date(fetchedAt.toDateString()); // 이 API는 응답에 기준일을 안 주므로 수집일을 referenceDate로 쓴다(§11 지시 — "fetchedAt을 source 기준일처럼 쓰지 말 것"의 반대 방향 오독 방지 위해 별도 변수로 명시: referenceDate=수집일 그 자체를 의미로 쓰는 것이지 "출처가 확인해준 기준일"인 것처럼 위장하지 않는다 — sourceUpdatedAt은 null로 둔다)
      const existingStat = await prisma.childcareStat.findUnique({
        where: { childcareId_sourceId_referenceDate: { childcareId: childcare.id, sourceId: source.id, referenceDate } },
      });
      await prisma.childcareStat.upsert({
        where: { childcareId_sourceId_referenceDate: { childcareId: childcare.id, sourceId: source.id, referenceDate } },
        create: {
          childcareId: childcare.id,
          referenceDate,
          capacity: row.capacity,
          // enrollment/staffCount/cctvCount/hasShuttle — cpmsapi021 응답에 없는
          // 필드다(§6 mapping, UNKNOWN) — null로 남긴다. 0으로 채우지 않는다.
          sourceId: source.id,
          fetchedAt,
          disclosureStatus: 'AVAILABLE',
          qualityFlag: 'PARTIAL',
        },
        update: {
          capacity: row.capacity,
          fetchedAt,
          disclosureStatus: 'AVAILABLE',
          qualityFlag: 'PARTIAL',
        },
      });
      if (existingStat) summary.updatedStat++; else summary.createdStat++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\n=== Per-district ===');
  console.table(perDistrict);
  if (issues.length > 0) {
    console.log(`\n=== Invalid rows (${issues.length}) — first 5 ===`);
    console.log(JSON.stringify(issues.slice(0, 5), null, 2));
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
