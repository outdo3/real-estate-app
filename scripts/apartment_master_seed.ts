// MASTER M3/M4-B — ApartmentMaster 구축 seed 파이프라인.
// MOLIT 실거래(aptSeq 확보) → 건축물대장(REGCODE_PROXY 대신 MOLIT umdCd 직접 사용,
// M1/M2에서 확인된 우회 경로) → Kakao geocoding(exact/normalized만 저장, area_only 금지)
// 순으로 enrichment한다. 이름 매칭으로 단지를 합치지 않는다(aptSeq 단위로만 upsert).
//
// M4-B 확장(기존 M3 로직은 그대로 유지, 최소 확장만 추가):
// - --dry-run: discovery만 수행, DB write 없음(사전 규모 확인용)
// - --months=N: 조회기간(기본 24, M4-A 결정)
// - --sample=N: 진단용 표본만 처리(M3 호환, 기본은 미지정 = 발견된 aptSeq 전체 처리)
// - --concurrency=N: enrichment 단계 제한된 동시 처리 수(기본 4, 공격적 병렬화 금지 원칙 유지)
// - null-overwrite 방지: 이번 실행에서 enrichment가 실패해도 기존에 저장된 유효한 값을
//   null로 덮어쓰지 않는다(일시 실패와 기존값 오류를 구분 — M4-B §27 정책)
//
// 사용법:
//   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
//     scripts/apartment_master_seed.ts <lawdCd> <label> [--dry-run] [--months=24] [--sample=N] [--concurrency=4]
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';

const MOLIT_KEY = process.env.DATA_GO_KR_API_KEY || '';
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const kakaoHeaders = {
  Authorization: `KakaoAK ${KAKAO_KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};

function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '').replace(/아파트$/, '');
}

function monthsBack(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchMonth(lawdCd: string, dealYmd: string): Promise<any[]> {
  const cleanKey = encodeURIComponent(decodeURIComponent(MOLIT_KEY.trim().replace(/['"]/g, '')));
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${cleanKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;
  const res = await fetch(url, { headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const json = parser.parse(text);
  const items = json.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

interface Candidate {
  aptSeq: string;
  name: string;
  umdNm: string;
  umdCd: string;
  jibun: string;
  sggCd: string;
  buildYear: number | null;
  tradeCount: number;
}

async function collectCandidates(lawdCd: string, months: number): Promise<{ candidates: Candidate[]; totalTrades: number; nullAptSeq: number }> {
  let all: any[] = [];
  for (const dealYmd of monthsBack(months)) {
    all = all.concat(await fetchMonth(lawdCd, dealYmd));
  }
  const map = new Map<string, Candidate>();
  let nullAptSeq = 0;
  for (const it of all) {
    if (!it.aptSeq) {
      nullAptSeq += 1;
      continue;
    }
    const seq = String(it.aptSeq).trim();
    if (!map.has(seq)) {
      map.set(seq, {
        aptSeq: seq,
        name: String(it.aptNm || '').trim(),
        umdNm: String(it.umdNm || '').trim(),
        umdCd: String(it.umdCd || '').trim(),
        jibun: String(it.jibun || '').trim(),
        sggCd: String(it.sggCd || lawdCd).trim(),
        buildYear: it.buildYear ? parseInt(String(it.buildYear), 10) : null,
        tradeCount: 0,
      });
    }
    map.get(seq)!.tradeCount += 1;
  }
  return { candidates: [...map.values()], totalTrades: all.length, nullAptSeq };
}

// M3 호환용 — 진단표본 선정(거래多/少, 신축/구축, 흔한 이름). M4-B 기본 흐름에서는 사용 안 함(전체 처리).
function selectDiverseSample(candidates: Candidate[], limit: number): Candidate[] {
  const byTradeDesc = [...candidates].sort((a, b) => b.tradeCount - a.tradeCount);
  const byTradeAsc = [...candidates].sort((a, b) => a.tradeCount - b.tradeCount);
  const byYearDesc = [...candidates].filter((c) => c.buildYear).sort((a, b) => (b.buildYear! - a.buildYear!));
  const byYearAsc = [...candidates].filter((c) => c.buildYear).sort((a, b) => (a.buildYear! - b.buildYear!));
  const commonNameCandidates = candidates.filter((c) => {
    const n = normalizeName(c.name);
    return n.length <= 3 || /^(현대|삼성|대림|우성|신동아|한신|경남|극동)/.test(n);
  });
  const picked = new Map<string, Candidate>();
  const tryAdd = (list: Candidate[], n: number) => {
    let added = 0;
    for (const c of list) {
      if (added >= n) break;
      if (picked.has(c.aptSeq)) continue;
      picked.set(c.aptSeq, c);
      added += 1;
    }
  };
  tryAdd(byTradeDesc, 4);
  tryAdd(byTradeAsc, 3);
  tryAdd(byYearDesc, 3);
  tryAdd(byYearAsc, 3);
  tryAdd(commonNameCandidates, 3);
  tryAdd(byTradeDesc, limit);
  return [...picked.values()].slice(0, limit);
}

type LedgerStatus = 'success' | 'not_found' | 'api_error' | 'parse_error';

interface RegistryResult {
  status: LedgerStatus;
  useApprovalDate: string | null;
  mainBuildingCount: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  mgmBldrgstPk: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  recordCount: number;
}

// 건축물대장(BldRgstHubService) 전용 직렬 큐 — M4-B 부산진구 파일럿 중 실제로 발견한 문제:
// 유닛 단위 concurrency(예: 4)와 무관하게, 이 API 자체가 "초당 서비스 요청제한"(429,
// LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR)을 갖고 있어 404건 중 310건이
// api_error로 실패했다(실측). 진단 결과 800ms 간격도 429를 유발했고, 30초 냉각 후에야 성공한
// 사례가 확인됐다 — Kakao(별도 API)는 같은 조건에서 전혀 영향받지 않아 이 API에만 특이한
// 문제임을 확인했다. 이 API에 한해 전역적으로 직렬화하고 호출 사이 최소 간격을 강제한다
// (유닛 레벨 concurrency와 별개 — Kakao/DB 작업까지 직렬화하지 않는다).
const LEDGER_MIN_INTERVAL_MS = 1500;
let ledgerQueue: Promise<void> = Promise.resolve();
let ledgerLastCallAt = 0;

function throttledLedgerCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerQueue.then(async () => {
    const wait = Math.max(0, LEDGER_MIN_INTERVAL_MS - (Date.now() - ledgerLastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    ledgerLastCallAt = Date.now();
    return fn();
  });
  // 다음 호출이 이 호출의 완료를 기다리도록 큐를 갱신한다(실패해도 큐가 끊기지 않게 catch).
  ledgerQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function fetchRegistryOnce(sggCd: string, umdCd: string, jibun: string): Promise<RegistryResult> {
  const empty = (status: LedgerStatus): RegistryResult => ({
    status, useApprovalDate: null, mainBuildingCount: null, totalHouseholds: null,
    parkingCount: null, mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, recordCount: 0,
  });
  if (!sggCd || !umdCd || !jibun) return empty('parse_error');
  const cleanKey = encodeURIComponent(decodeURIComponent(MOLIT_KEY.trim().replace(/['"]/g, '')));
  const parts = jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  if (isNaN(bunNum)) return empty('parse_error');
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const bun = bunNum.toString().padStart(4, '0');
  const ji = jiNum.toString().padStart(4, '0');

  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const rawText = await res.text();
    if (!res.ok) {
      // 429(요청제한)/503(일시 과부하)은 재시도 대상으로 구분해 호출부에 알린다.
      const retryable = res.status === 429 || res.status === 503 || rawText.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS');
      const err: any = new Error(`ledger HTTP ${res.status}`);
      err.retryable = retryable;
      throw err;
    }
    // mgmBldrgstPk가 JS Number 안전정수 범위(2^53)를 넘는 경우가 실측으로 확인됐다(M3) —
    // 원본 텍스트에서 먼저 정규식으로 문자열째 추출해 보존한다.
    const pkMatch = rawText.match(/"mgmBldrgstPk"\s*:\s*"?([0-9]+)"?/);
    const rawMgmBldrgstPk = pkMatch ? pkMatch[1] : null;
    const json = JSON.parse(rawText);
    const header = json?.response?.header;
    if (header?.resultCode && header.resultCode !== '00') {
      const retryable = /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(header?.errMsg || '');
      if (retryable) {
        const err: any = new Error('ledger rate limited (resultCode)');
        err.retryable = true;
        throw err;
      }
      return empty('api_error');
    }
    const items = json?.response?.body?.items?.item;
    if (!items) return empty('not_found');
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length === 0) return empty('not_found');
    const target = arr.reduce((best: any, cur: any) => ((cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best));

    const hhldCnt = parseInt(target.hhldCnt, 10);
    const parkingCnt = parseInt(target.totPkngCnt, 10);
    const mainBldCnt = parseInt(target.mainBldCnt, 10);
    const useAprDay: string = target.useAprDay || '';

    return {
      status: 'success',
      useApprovalDate: /^\d{8}$/.test(useAprDay) ? useAprDay : null,
      mainBuildingCount: !isNaN(mainBldCnt) && mainBldCnt > 0 ? mainBldCnt : null,
      totalHouseholds: !isNaN(hhldCnt) && hhldCnt > 0 ? hhldCnt : null,
      parkingCount: !isNaN(parkingCnt) && parkingCnt > 0 ? parkingCnt : null,
      mgmBldrgstPk: arr.length === 1 && rawMgmBldrgstPk ? rawMgmBldrgstPk : (target.mgmBldrgstPk != null ? String(target.mgmBldrgstPk) : null),
      roadAddress: target.newPlatPlc ? String(target.newPlatPlc).trim() : null,
      jibunAddress: target.platPlc ? String(target.platPlc).trim() : null,
      recordCount: arr.length,
    };
  } catch (e: any) {
    if (e?.retryable) throw e;
    return empty('api_error');
  }
}

// 429/503(재시도 가능, §28)만 제한적으로 재시도한다(최대 2회 추가, 지수 백오프). not_found/
// parse_error/일반 api_error는 재시도해도 의미가 없으므로 즉시 반환한다(무한 retry 금지).
async function fetchRegistry(sggCd: string, umdCd: string, jibun: string): Promise<RegistryResult> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await throttledLedgerCall(() => fetchRegistryOnce(sggCd, umdCd, jibun));
    } catch (e: any) {
      if (!e?.retryable || attempt === maxAttempts) {
        return {
          status: 'api_error', useApprovalDate: null, mainBuildingCount: null, totalHouseholds: null,
          parkingCount: null, mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, recordCount: 0,
        };
      }
      await new Promise((r) => setTimeout(r, LEDGER_MIN_INTERVAL_MS * attempt));
    }
  }
  // 도달 불가(타입 안정성용)
  return {
    status: 'api_error', useApprovalDate: null, mainBuildingCount: null, totalHouseholds: null,
    parkingCount: null, mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, recordCount: 0,
  };
}

export type GeoStatus = 'exact' | 'normalized' | 'rejected' | 'failed';

export interface GeoResult {
  status: GeoStatus;
  lat: number | null;
  lng: number | null;
  matchedAddr: string | null;
}

async function kakaoSearch(query: string): Promise<{ lat: number; lng: number; region1: string; addr: string } | null> {
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const doc = data.documents?.[0];
    if (!doc) return null;
    // 키워드검색 응답에는 address.region_1depth_name 같은 중첩 필드가 없다(M3 실측 확인) —
    // 평문 주소 문자열의 첫 토큰을 region1으로 직접 파싱한다.
    const addr = doc.road_address_name || doc.address_name || '';
    const tokens = addr.split(/\s+/);
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x), region1: tokens[0] || '', addr };
  } catch {
    return null;
  }
}

// 우선순위: 1) 건축물대장 도로명주소 2) 건축물대장 지번주소 3) "{동} {단지명}" 키워드
// STEP 0.7-A(§14 re-geocode source policy)가 이 함수를 그대로 import해 재사용한다 —
// export만 추가했고 로직은 한 글자도 바꾸지 않았다(§11.2 "production geocode() 그대로,
// 코드 변경 없음" 요구 충족).
export async function geocode(expectedSido: string, roadAddress: string | null, jibunAddress: string | null, dong: string, name: string): Promise<GeoResult> {
  const candidates: { query: string; quality: 'exact' | 'normalized' }[] = [];
  if (roadAddress) candidates.push({ query: roadAddress, quality: 'exact' });
  if (jibunAddress) candidates.push({ query: jibunAddress, quality: 'exact' });
  candidates.push({ query: `${dong} ${name}`, quality: 'normalized' });

  let sawAnyResult = false;
  for (const { query, quality } of candidates) {
    const r = await kakaoSearch(query);
    if (!r) continue;
    sawAnyResult = true;
    // region1이 빈 문자열이면(파싱 실패 등) 검증 불가 상태이므로 통과시키지 않고 거부한다
    // (빈 문자열은 String.includes()의 항등원이라 검증을 우회할 수 있는 실제 버그를 M3에서
    // 겪었다 — 재발 방지를 위한 방어적 처리).
    if (expectedSido && (!r.region1 || (!r.region1.includes(expectedSido) && !expectedSido.includes(r.region1)))) {
      continue;
    }
    return { status: quality, lat: r.lat, lng: r.lng, matchedAddr: r.addr };
  }
  return { status: sawAnyResult ? 'rejected' : 'failed', lat: null, lng: null, matchedAddr: null };
}

// 제한된 동시성으로 배열을 처리한다(공격적 병렬화 금지 원칙, M4-A §29).
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// 좌표 중복 정정(M4-B 부산진구 파일럿 중 실제 발견, 이후 서구↔영도구 간 교차 사례로
// 구·군 경계를 넘어서도 발생함을 재확인) — Kakao 키워드검색(normalized 품질)이 서로 다른
// aptSeq(= MOLIT가 구분하는 서로 다른 등록 단위, 예: 같은/유사 이름의 다른 동군·차수·단지)를
// 완전히 동일한 좌표로 반환하는 사례가 실측으로 여러 건 확인됐다(부산진구 9건, 이후
// "e편한세상송도더퍼스트비치"(서구)↔"더퍼스트아파트"(영도구)처럼 구·군이 다른데도 이름의
// 부분 일치로 충돌하는 사례까지 발견돼, 검사 범위를 구·군 단위가 아니라 전체로 확장했다).
// 이는 M3의 "행정구역 대표좌표"류 결함이 아니라(그런 fallback 자체가 코드에 없음), Kakao
// 자체 POI 색인이 그 단지를 세분화하지 않거나 이름 일부만 보고 매칭하는 데서 생기는 한계다.
// "성공률보다 정확도" 원칙에 따라:
//   - 한 그룹에 exact 품질이 정확히 1개면 그것만 신뢰하고 나머지는 null 처리한다.
//   - exact가 여럿(또는 0)이면 어느 쪽이 맞는지 판단할 근거가 없어 그룹 전체를 null 처리한다.
async function deduplicateCoordinates(): Promise<{ groupsFound: number; rowsCorrected: number }> {
  const rows = await prisma.apartmentMaster.findMany({ where: { latitude: { not: null } } });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.latitude!.toFixed(6)},${r.longitude!.toFixed(6)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  let groupsFound = 0;
  let rowsCorrected = 0;
  for (const [, group] of groups.entries()) {
    if (group.length < 2) continue;
    groupsFound += 1;
    const exactMembers = group.filter((g) => g.geocodeQuality === 'exact');
    const toNull = exactMembers.length === 1 ? group.filter((g) => g.id !== exactMembers[0].id) : group;
    for (const row of toNull) {
      await prisma.apartmentMaster.update({
        where: { id: row.id },
        data: { latitude: null, longitude: null, geocodeQuality: 'failed' },
      });
      rowsCorrected += 1;
    }
  }
  return { groupsFound, rowsCorrected };
}

interface UnitResult {
  aptSeq: string;
  name: string;
  wasExisting: boolean;
  action: 'created' | 'updated' | 'dry_run' | 'db_error';
  ledgerStatus: LedgerStatus;
  ledgerRecordCount: number;
  geoStatus: GeoStatus;
  coordinateSaved: boolean;
}

async function processUnit(c: Candidate, expectedSido: string, sigungu: string, dryRun: boolean): Promise<UnitResult> {
  const registry = await fetchRegistry(c.sggCd, c.umdCd, c.jibun);
  const geo = await geocode(expectedSido, registry.roadAddress, registry.jibunAddress, c.umdNm, c.name);
  const normalizedName = normalizeName(c.name);

  const existing = await prisma.apartmentMaster.findUnique({ where: { aptSeq: c.aptSeq } });

  if (dryRun) {
    return {
      aptSeq: c.aptSeq, name: c.name, wasExisting: !!existing, action: 'dry_run',
      ledgerStatus: registry.status, ledgerRecordCount: registry.recordCount,
      geoStatus: geo.status, coordinateSaved: geo.lat != null,
    };
  }

  // null-overwrite 방지(M4-B §27): 이번 실행의 enrichment 결과가 비어 있으면(실패/미확보)
  // 기존에 저장된 유효값을 그대로 유지한다. MOLIT 원본 필드(name/주소/buildYear 등)는
  // 매 실행마다 항상 최신값을 제공하므로 무조건 갱신한다.
  const merged = {
    aptSeq: c.aptSeq,
    name: c.name,
    normalizedName,
    sido: expectedSido || null,
    sigungu,
    sggCd: c.sggCd || null,
    umdName: c.umdNm || null,
    umdCd: c.umdCd || null,
    jibun: c.jibun || null,
    buildYear: c.buildYear,
    mgmBldrgstPk: registry.mgmBldrgstPk ?? existing?.mgmBldrgstPk ?? null,
    roadAddress: registry.roadAddress ?? existing?.roadAddress ?? null,
    jibunAddress: registry.jibunAddress ?? existing?.jibunAddress ?? null,
    useApprovalDate: registry.useApprovalDate ?? existing?.useApprovalDate ?? null,
    mainBuildingCount: registry.mainBuildingCount ?? existing?.mainBuildingCount ?? null,
    totalHouseholds: registry.totalHouseholds ?? existing?.totalHouseholds ?? null,
    parkingCount: registry.parkingCount ?? existing?.parkingCount ?? null,
    // 좌표는 이번 실행이 성공(exact/normalized)했을 때만 갱신, 실패/거부면 기존값 유지
    latitude: geo.lat ?? existing?.latitude ?? null,
    longitude: geo.lng ?? existing?.longitude ?? null,
    geocodeQuality: geo.lat != null ? geo.status : (existing?.geocodeQuality ?? (geo.status === 'failed' || geo.status === 'rejected' ? 'failed' : null)),
  };

  try {
    const saved = await prisma.apartmentMaster.upsert({
      where: { aptSeq: c.aptSeq },
      create: merged,
      update: merged,
    });
    return {
      aptSeq: c.aptSeq, name: c.name, wasExisting: !!existing, action: existing ? 'updated' : 'created',
      ledgerStatus: registry.status, ledgerRecordCount: registry.recordCount,
      geoStatus: geo.status, coordinateSaved: saved.latitude != null,
    };
  } catch (e: any) {
    console.error(`  [DB 오류] aptSeq=${c.aptSeq} ${c.name}: ${e?.message || e}`);
    return {
      aptSeq: c.aptSeq, name: c.name, wasExisting: !!existing, action: 'db_error',
      ledgerStatus: registry.status, ledgerRecordCount: registry.recordCount,
      geoStatus: geo.status, coordinateSaved: false,
    };
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const lawdCd = args[0];
  const label = args[1] || lawdCd;
  const dryRun = args.includes('--dry-run');
  const monthsArg = args.find((a) => a.startsWith('--months='));
  const months = monthsArg ? parseInt(monthsArg.split('=')[1], 10) : 24;
  const sampleArg = args.find((a) => a.startsWith('--sample='));
  const sample = sampleArg ? parseInt(sampleArg.split('=')[1], 10) : null;
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 4;
  return { lawdCd, label, dryRun, months, sample, concurrency };
}

async function main() {
  const { lawdCd, label, dryRun, months, sample, concurrency } = parseArgs();
  if (!lawdCd) {
    console.error('사용법: apartment_master_seed.ts <lawdCd> <label> [--dry-run] [--months=24] [--sample=N] [--concurrency=4]');
    process.exit(1);
  }

  const startedAt = Date.now();
  console.log(`=== ${label}(${lawdCd}) MOLIT ${months}개월 discovery ${dryRun ? '(DRY RUN)' : ''} ===`);
  const { candidates, totalTrades, nullAptSeq } = await collectCandidates(lawdCd, months);
  console.log(`거래건수=${totalTrades}, 고유 aptSeq=${candidates.length}, null aptSeq=${nullAptSeq}`);

  const targets = sample ? selectDiverseSample(candidates, sample) : candidates;
  console.log(`처리 대상: ${targets.length}건 ${sample ? '(진단표본)' : '(전체)'}`);

  if (dryRun) {
    const existingCount = await prisma.apartmentMaster.count({ where: { sggCd: lawdCd } });
    console.log(`\n[DRY RUN] DB write 없음. 기존 Master(sggCd=${lawdCd}): ${existingCount}건`);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n=== ${label} dryRun 요약 ===`);
    console.log(JSON.stringify({ region: label, lawdCd, months, totalTrades, distinctAptSeq: candidates.length, nullAptSeq, existingMaster: existingCount, elapsedSec: elapsed }, null, 2));
    return;
  }

  const expectedSido = label.split(' ')[0];
  const sigungu = label.split(' ').slice(1).join(' ') || null;

  const results: UnitResult[] = await mapWithConcurrency(targets, concurrency, (c) => processUnit(c, expectedSido, sigungu || '', false));

  const dedupe = await deduplicateCoordinates();
  if (dedupe.rowsCorrected > 0) {
    console.log(`\n[좌표 중복 정정] ${dedupe.groupsFound}개 그룹에서 ${dedupe.rowsCorrected}건을 null로 정정(exact 있으면 그것만 유지, 없으면 전체 null)`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const summary = {
    region: label,
    lawdCd,
    months,
    totalTrades,
    distinctAptSeq: candidates.length,
    nullAptSeq,
    processed: results.length,
    created: results.filter((r) => r.action === 'created').length,
    updated: results.filter((r) => r.action === 'updated').length,
    dbError: results.filter((r) => r.action === 'db_error').length,
    ledger: {
      success: results.filter((r) => r.ledgerStatus === 'success').length,
      notFound: results.filter((r) => r.ledgerStatus === 'not_found').length,
      apiError: results.filter((r) => r.ledgerStatus === 'api_error').length,
      parseError: results.filter((r) => r.ledgerStatus === 'parse_error').length,
      multiRecord: results.filter((r) => r.ledgerRecordCount > 1).length,
    },
    kakao: {
      exact: results.filter((r) => r.geoStatus === 'exact').length,
      normalized: results.filter((r) => r.geoStatus === 'normalized').length,
      rejected: results.filter((r) => r.geoStatus === 'rejected').length,
      failed: results.filter((r) => r.geoStatus === 'failed').length,
    },
    coordinateSaved: results.filter((r) => r.coordinateSaved).length,
    coordinateDedup: dedupe,
    elapsedSec: parseFloat(elapsed),
  };

  console.log(`\n=== ${label} batch 요약 ===`);
  console.log(JSON.stringify(summary, null, 2));

  const resultsDir = path.resolve(__dirname, '_m4b_results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${lawdCd}_${label.replace(/\s+/g, '_')}.json`), JSON.stringify({ summary, results }, null, 2));
}

// require.main===module 가드: 이 파일을 직접 CLI로 실행할 때(ts-node
// apartment_master_seed.ts ...)는 기존과 완전히 동일하게 동작하고, 다른 스크립트가
// geocode() 등을 재사용하려고 import만 할 때는 main()이 임의로 실행되지 않는다
// (STEP 0.7-A §14, import 시 CLI 부작용 방지 — 기존 동작 변경 없음).
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('FATAL:', e);
      process.exit(1);
    });
}
