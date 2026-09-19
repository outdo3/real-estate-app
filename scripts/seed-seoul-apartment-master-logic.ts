// SEOUL_MASTER_SEED_SCRIPT_V1 — 서울 ApartmentMaster Tier A seed의 순수 판정(DB·네트워크 없음).
//
// 계약(SEOUL_MASTER_SEED_PLAN_V1 §13):
//   - 원천: MOLIT 매매(RTMSDataSvcAptTradeDev)만. aptSeq = canonical identity.
//   - 셀은 totalCount까지 모든 페이지를 읽어야 COMPLETE. 오류를 빈 결과로 취급하지 않는다.
//   - 한 구에 COMPLETE가 아닌 셀이 하나라도 있으면 그 구 전체를 보류한다(부분 데이터 적재 금지).
//   - 이름·지번·좌표로 aptSeq를 합치거나 만들지 않는다.
//   - 좌표는 Kakao 주소 검색에서 구·법정동·본번·부번이 모두 같은 단일 결과를 찾고(정방향),
//     그 좌표를 역지오코딩한 필지도 같은 구·법정동·본번·부번일 때만(역방향) 저장한다 — WRONG < NULL.
//   - create-only. 이 모듈에는 update/upsert/delete 경로가 없다.

import {
  aggregateCandidates,
  classifyIdentity,
  normalizeName,
  resolveCrossDistrict,
  type RawTradeItem,
  type SeedCandidate,
} from './seoul-master-seed-plan-logic';

export const SEOUL_DISTRICTS: readonly { lawdCd: string; name: string }[] = [
  ['11110', '종로구'], ['11140', '중구'], ['11170', '용산구'], ['11200', '성동구'], ['11215', '광진구'],
  ['11230', '동대문구'], ['11260', '중랑구'], ['11290', '성북구'], ['11305', '강북구'], ['11320', '도봉구'],
  ['11350', '노원구'], ['11380', '은평구'], ['11410', '서대문구'], ['11440', '마포구'], ['11470', '양천구'],
  ['11500', '강서구'], ['11530', '구로구'], ['11545', '금천구'], ['11560', '영등포구'], ['11590', '동작구'],
  ['11620', '관악구'], ['11650', '서초구'], ['11680', '강남구'], ['11710', '송파구'], ['11740', '강동구'],
].map(([lawdCd, name]) => ({ lawdCd, name }));
export const SEOUL_CODES: ReadonlySet<string> = new Set(SEOUL_DISTRICTS.map((d) => d.lawdCd));
export const districtName = (lawdCd: string): string => SEOUL_DISTRICTS.find((d) => d.lawdCd === lawdCd)?.name ?? '';

export const PAGE_SIZE = 1000;

// ───────────────────────── MOLIT 셀 ─────────────────────────

export type PageOutcome =
  | { kind: 'OK'; totalCount: number; items: RawTradeItem[] }
  | { kind: 'HTTP_ERROR' | 'PARSE_ERROR' | 'TIMEOUT' | 'RESULT_CODE' | 'RATE_LIMITED' | 'NETWORK'; detail: string };

export type PageFetcher = (lawdCd: string, ym: string, pageNo: number, numOfRows: number) => Promise<PageOutcome>;

export interface CellFetch {
  lawdCd: string;
  ym: string;
  status: 'COMPLETE' | 'PARTIAL' | 'ERROR';
  totalCount: number | null;
  collected: number;
  pages: number;
  errors: string[];
  items: RawTradeItem[];
}

/** totalCount까지 모든 페이지를 읽는다. 첫 페이지 실패 = ERROR, 이후 실패·개수 불일치 = PARTIAL. */
export async function fetchSaleCell(fetchPage: PageFetcher, lawdCd: string, ym: string, pageSize = PAGE_SIZE): Promise<CellFetch> {
  const first = await fetchPage(lawdCd, ym, 1, pageSize);
  if (first.kind !== 'OK') {
    return { lawdCd, ym, status: 'ERROR', totalCount: null, collected: 0, pages: 0, errors: [`p1:${first.kind}:${first.detail}`], items: [] };
  }
  const items = [...first.items];
  const errors: string[] = [];
  let pages = 1;
  const totalPages = Math.max(1, Math.ceil(first.totalCount / pageSize));
  for (let p = 2; p <= totalPages; p++) {
    const r = await fetchPage(lawdCd, ym, p, pageSize);
    if (r.kind !== 'OK') {
      errors.push(`p${p}:${r.kind}:${r.detail}`);
      break;
    }
    if (r.totalCount !== first.totalCount) errors.push(`p${p}:TOTAL_CHANGED:${first.totalCount}->${r.totalCount}`);
    items.push(...r.items);
    pages++;
  }
  const complete = errors.length === 0 && items.length === first.totalCount;
  if (!complete && errors.length === 0) errors.push(`COUNT_MISMATCH:collected=${items.length},total=${first.totalCount}`);
  return { lawdCd, ym, status: complete ? 'COMPLETE' : 'PARTIAL', totalCount: first.totalCount, collected: items.length, pages, errors, items };
}

export type DistrictState = 'PENDING' | 'FETCHED' | 'VALIDATED' | 'COORDINATED' | 'READY' | 'PARTIAL' | 'BLOCKED';

/** 구의 셀 결과 → FETCHED(전부 COMPLETE) 또는 PARTIAL(하나라도 아니면, 구 전체 보류). */
export function districtFetchState(cells: readonly Pick<CellFetch, 'status'>[], expectedCells: number): 'FETCHED' | 'PARTIAL' {
  return cells.length === expectedCells && cells.every((c) => c.status === 'COMPLETE') ? 'FETCHED' : 'PARTIAL';
}

// ───────────────────────── Identity / Tier A ─────────────────────────

export type RowStatus =
  | 'READY'
  | 'EXISTING_SKIPPED'
  | 'REVIEW_REQUIRED'
  | 'HELD_BACK_PARTIAL_DISTRICT'
  | 'EXCLUDED_PLAN_TIER_B'
  | 'EXCLUDED_PLAN_REVIEW'
  | 'OUT_OF_TARGET';

export interface SeedRow {
  aptSeq: string;
  district: string;
  districtName: string;
  dong: string;
  umdCd: string;
  jibun: string;
  name: string;
  normalizedName: string;
  buildYear: number | null;
  tradeCount: number;
  sourceCell: string;
  lat: number | null;
  lng: number | null;
  coordinateSource: 'KAKAO_ADDRESS_EXACT_LOT_REVERSE_VERIFIED' | null;
  coordinateConfidence: 'EXACT_LOT_BOTH_DIRECTIONS' | null;
  coordinateStatus: CoordinateStatus | 'PENDING' | 'SKIPPED' | 'NOT_ATTEMPTED';
  /** 검증 기록(REVERSE CHECK V1). 저장되는 lat/lng는 VERIFIED일 때만 채워진다. */
  targetLot: string;
  forwardAddress: string | null;
  forwardLat: number | null;
  forwardLng: number | null;
  reverseAddress: string | null;
  reverseLot: string | null;
  coordinateReason: string | null;
  status: RowStatus;
  reasons: string[];
}

export interface IdentityCorrection {
  aptSeq: string;
  kind: 'MISFILED_REPORT';
  canonicalDistrict: string;
  reportedIn: string[];
  note: string;
}

export type PlanExclusions = ReadonlyMap<string, 'TIER_B' | 'REVIEW'>;

function toRow(c: SeedCandidate, status: RowStatus, reasons: string[]): SeedRow {
  return {
    aptSeq: c.aptSeq, district: c.lawdCd, districtName: districtName(c.lawdCd), dong: c.umdNm, umdCd: c.umdCd, jibun: c.jibun,
    name: c.name, normalizedName: normalizeName(c.name), buildYear: c.buildYear, tradeCount: c.tradeCount,
    sourceCell: `${c.lawdCd}:${c.latestDealDate.slice(0, 7).replace('-', '')}`,
    lat: null, lng: null, coordinateSource: null, coordinateConfidence: null, coordinateStatus: 'NOT_ATTEMPTED', status, reasons,
    targetLot: `${districtName(c.lawdCd)} ${c.umdNm} ${c.jibun}`, forwardAddress: null, forwardLat: null, forwardLng: null,
    reverseAddress: null, reverseLot: null, coordinateReason: null,
  };
}

/**
 * 완료된 구들의 매매 원천 행 → aptSeq당 1행.
 * - 여러 구 응답에 나온 aptSeq: 표기(이름·법정동·지번)가 같으면 aptSeq 앞 5자리 구로 정정(기록), 다르면 REVIEW.
 * - aptSeq 앞 5자리가 보류된 구면 HELD_BACK, 이번 실행 대상 밖이면 OUT_OF_TARGET, 서울 25구 밖이면 REVIEW.
 * - 계획 단계에서 Tier B/REVIEW로 분류된 aptSeq는 매매가 새로 생겼더라도 이번 승인 범위 밖이라 제외.
 */
export function buildTierARows(input: {
  itemsByDistrict: ReadonlyMap<string, readonly RawTradeItem[]>;
  heldBack: ReadonlySet<string>;
  targets: ReadonlySet<string>;
  planExclusions?: PlanExclusions;
}): { rows: SeedRow[]; corrections: IdentityCorrection[] } {
  const entries = new Map<string, SeedCandidate[]>();
  for (const [lawdCd, items] of input.itemsByDistrict) {
    if (input.heldBack.has(lawdCd)) continue; // 부분 데이터는 identity 판정에도 쓰지 않는다
    const { candidates } = aggregateCandidates(lawdCd, items.map((item) => ({ item, source: 'SALE' as const })));
    for (const c of candidates) entries.set(c.aptSeq, [...(entries.get(c.aptSeq) ?? []), c]);
  }
  const rows: SeedRow[] = [];
  const corrections: IdentityCorrection[] = [];
  for (const [aptSeq, list] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = aptSeq.slice(0, 5);
    if (!SEOUL_CODES.has(prefix)) {
      rows.push(toRow(list[0], 'REVIEW_REQUIRED', ['NON_SEOUL_OR_MALFORMED_APTSEQ']));
      continue;
    }
    if (input.heldBack.has(prefix)) {
      rows.push(toRow(list[0], 'HELD_BACK_PARTIAL_DISTRICT', [`CANONICAL_DISTRICT_${prefix}_HELD_BACK`]));
      continue;
    }
    if (!input.targets.has(prefix)) {
      rows.push(toRow(list[0], 'OUT_OF_TARGET', [`CANONICAL_DISTRICT_${prefix}_NOT_IN_RUN`]));
      continue;
    }
    const cross = resolveCrossDistrict(list);
    if (!cross.canonical) {
      rows.push(toRow(list[0], 'REVIEW_REQUIRED', ['CROSS_DISTRICT_CONFLICT']));
      continue;
    }
    let c = cross.canonical;
    if (cross.kind === 'MISFILED_REPORT') {
      corrections.push({
        aptSeq, kind: 'MISFILED_REPORT', canonicalDistrict: c.lawdCd, reportedIn: list.map((e) => e.lawdCd).sort(),
        note: '이름·법정동·지번이 같은 행이 이웃 구 조회 응답에도 실림 → aptSeq 앞 5자리 구를 canonical로 사용(요청 구는 identity로 쓰지 않음)',
      });
      c = { ...c, sggCds: [c.lawdCd], tradeCount: list.reduce((s, e) => s + e.tradeCount, 0) };
    }
    const v = classifyIdentity(c);
    if (v.verdict !== 'SEED_READY') {
      rows.push(toRow(c, 'REVIEW_REQUIRED', v.reasons));
      continue;
    }
    if (!/^\d{5}$/.test(c.umdCd)) {
      rows.push(toRow(c, 'REVIEW_REQUIRED', ['UMDCD_MALFORMED']));
      continue;
    }
    const plan = input.planExclusions?.get(aptSeq);
    if (plan) {
      rows.push(toRow(c, plan === 'TIER_B' ? 'EXCLUDED_PLAN_TIER_B' : 'EXCLUDED_PLAN_REVIEW', ['OUTSIDE_APPROVED_TIER_A_SCOPE']));
      continue;
    }
    rows.push(toRow(c, 'READY', []));
  }
  return { rows, corrections };
}

// ───────────────────────── 좌표(Kakao 주소 검색, 필지 일치) ─────────────────────────

/** 정방향(주소 검색) 판정. EXACT는 **중간 단계**다 — 역방향까지 통과해야 VERIFIED. */
export type ForwardStatus = 'EXACT' | 'NO_MATCH' | 'AMBIGUOUS' | 'JIBUN_UNPARSEABLE';

/**
 * 최종 좌표 상태. 저장 좌표는 VERIFIED만.
 * 종결(재조회 안 함): VERIFIED · FORWARD_NO_MATCH · REVERSE_MISMATCH · REVERSE_NO_RESULT · AMBIGUOUS · JIBUN_UNPARSEABLE
 * 미종결(다음 실행에서 이어서): ERROR · RATE_LIMITED
 */
export type CoordinateStatus =
  | 'VERIFIED'
  | 'FORWARD_NO_MATCH'
  | 'REVERSE_MISMATCH'
  | 'REVERSE_NO_RESULT'
  | 'AMBIGUOUS'
  | 'JIBUN_UNPARSEABLE'
  | 'ERROR'
  | 'RATE_LIMITED';

export const TERMINAL_COORDINATE_STATUSES: ReadonlySet<CoordinateStatus> = new Set<CoordinateStatus>([
  'VERIFIED', 'FORWARD_NO_MATCH', 'REVERSE_MISMATCH', 'REVERSE_NO_RESULT', 'AMBIGUOUS', 'JIBUN_UNPARSEABLE',
]);

export interface KakaoAddressDoc {
  address_name?: string;
  address_type?: string;
  x?: string;
  y?: string;
  address?: {
    region_1depth_name?: string;
    region_2depth_name?: string;
    region_3depth_name?: string;
    mountain_yn?: string;
    main_address_no?: string;
    sub_address_no?: string;
  } | null;
}

export type AddressSearchOutcome = { kind: 'OK'; docs: KakaoAddressDoc[] } | { kind: 'ERROR' | 'RATE_LIMITED'; detail: string };

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');

export function parseJibun(jibun: string): { mountain: boolean; main: string; sub: string } | null {
  const m = /^(산)?\s*(\d+)(?:-(\d+))?$/.exec(jibun.trim());
  if (!m) return null;
  const sub = m[3] ? stripZeros(m[3]) : '';
  return { mountain: !!m[1], main: stripZeros(m[2]), sub: sub === '0' ? '' : sub };
}

export function addressQuery(row: Pick<SeedRow, 'districtName' | 'dong' | 'jibun'>): string {
  return `서울 ${row.districtName} ${row.dong} ${row.jibun}`;
}

/**
 * 필지 일치만 채택: 지번 주소 결과(REGION_ADDR) 중 시도=서울·구·법정동·산 여부·본번·부번이 모두 같은 결과가 **정확히 하나**.
 * 법정동 대표점(REGION)·도로명만 결과·여러 개 일치는 채택하지 않는다.
 */
export function matchExactLot(
  docs: readonly KakaoAddressDoc[],
  expected: { districtName: string; dong: string; jibun: string }
): { status: ForwardStatus; lat: number | null; lng: number | null; address: string | null } {
  const lot = parseJibun(expected.jibun);
  if (!lot) return { status: 'JIBUN_UNPARSEABLE', lat: null, lng: null, address: null };
  const hits = docs.filter((d) => {
    const a = d.address;
    if (d.address_type !== 'REGION_ADDR' || !a) return false;
    return (a.region_1depth_name ?? '').startsWith('서울')
      && a.region_2depth_name === expected.districtName
      && a.region_3depth_name === expected.dong
      && (a.mountain_yn === 'Y') === lot.mountain
      && stripZeros(a.main_address_no ?? '') === lot.main
      && (() => { const s = stripZeros(a.sub_address_no ?? ''); return (s === '0' ? '' : s) === lot.sub; })();
  });
  if (hits.length === 0) return { status: 'NO_MATCH', lat: null, lng: null, address: null };
  if (hits.length > 1) return { status: 'AMBIGUOUS', lat: null, lng: null, address: null };
  const lat = Number(hits[0].y);
  const lng = Number(hits[0].x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'NO_MATCH', lat: null, lng: null, address: null };
  return { status: 'EXACT', lat, lng, address: hits[0].address_name ?? null };
}

// ───────────────────────── 역방향(좌표 → 필지) ─────────────────────────

/** Kakao coord2address 응답 documents[0]. 지번 주소(address)만 본다 — 도로명 주소는 필지 identity가 아니다. */
export interface KakaoReverseDoc {
  address?: {
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
    region_3depth_name?: string;
    mountain_yn?: string;
    main_address_no?: string;
    sub_address_no?: string;
  } | null;
}

export type ReverseOutcome = { kind: 'OK'; doc: KakaoReverseDoc | null } | { kind: 'ERROR' | 'RATE_LIMITED'; detail: string };

/**
 * 정방향 좌표를 역지오코딩한 필지가 목표 필지(시도 서울·구·법정동·산 여부·본번·부번)와 같을 때만 VERIFIED.
 * 인접 필지·다른 동이면 REVERSE_MISMATCH, 지번 주소가 없으면 REVERSE_NO_RESULT — 둘 다 좌표를 버린다.
 */
export function verifyReverseLot(
  doc: KakaoReverseDoc | null,
  expected: { districtName: string; dong: string; jibun: string }
): { status: 'VERIFIED' | 'REVERSE_MISMATCH' | 'REVERSE_NO_RESULT' | 'JIBUN_UNPARSEABLE'; reverseAddress: string | null; reverseLot: string | null; reason: string | null } {
  const lot = parseJibun(expected.jibun);
  if (!lot) return { status: 'JIBUN_UNPARSEABLE', reverseAddress: null, reverseLot: null, reason: 'TARGET_JIBUN_UNPARSEABLE' };
  const a = doc?.address;
  if (!a || !a.main_address_no) return { status: 'REVERSE_NO_RESULT', reverseAddress: null, reverseLot: null, reason: 'NO_LOT_ADDRESS_AT_COORDINATE' };
  const sub = stripZeros(a.sub_address_no ?? '');
  const subPart = sub && sub !== '0' ? `-${sub}` : '';
  const reverseLot = `${a.region_2depth_name ?? ''} ${a.region_3depth_name ?? ''} ${a.mountain_yn === 'Y' ? '산' : ''}${stripZeros(a.main_address_no)}${subPart}`;
  const diffs: string[] = [];
  if (!(a.region_1depth_name ?? '').startsWith('서울')) diffs.push('SIDO');
  if (a.region_2depth_name !== expected.districtName) diffs.push('GU');
  if (a.region_3depth_name !== expected.dong) diffs.push('DONG');
  if ((a.mountain_yn === 'Y') !== lot.mountain) diffs.push('MOUNTAIN');
  if (stripZeros(a.main_address_no) !== lot.main) diffs.push('MAIN_LOT');
  if ((sub === '0' ? '' : sub) !== lot.sub) diffs.push('SUB_LOT');
  return diffs.length
    ? { status: 'REVERSE_MISMATCH', reverseAddress: a.address_name ?? null, reverseLot, reason: diffs.join('+') }
    : { status: 'VERIFIED', reverseAddress: a.address_name ?? null, reverseLot, reason: null };
}

/** 정방향 판정이 이미 종결인 경우의 최종 상태. EXACT면 null(역방향 필요). */
export function forwardTerminalStatus(f: ForwardStatus): CoordinateStatus | null {
  if (f === 'EXACT') return null;
  return f === 'NO_MATCH' ? 'FORWARD_NO_MATCH' : f;
}

// ───────────────────────── Apply 게이트 · 생성 데이터 · rollback ─────────────────────────

export interface ApplyGateInput {
  applyFlag: boolean;
  allowProdDbWrite: string | undefined;
  districts: readonly string[];
  districtFilterGiven: boolean;
  districtStates: ReadonlyMap<string, DistrictState>;
  coordinatesSkipped: boolean;
  expectReady: number | null;
  readyCount: number;
}

/** 네 조건이 모두 맞아야 write: --apply · ALLOW_PROD_DB_WRITE=1 · --district 명시(전부 READY) · --expect-ready = 실제 READY 수. */
export function evaluateApplyGates(g: ApplyGateInput): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!g.applyFlag) reasons.push('NO_APPLY_FLAG');
  if (g.allowProdDbWrite !== '1') reasons.push('ALLOW_PROD_DB_WRITE_NOT_1');
  if (!g.districtFilterGiven || g.districts.length === 0) reasons.push('DISTRICT_FILTER_REQUIRED');
  for (const d of g.districts) if (g.districtStates.get(d) !== 'READY') reasons.push(`DISTRICT_${d}_NOT_READY`);
  if (g.coordinatesSkipped) reasons.push('COORDINATES_SKIPPED');
  if (g.expectReady == null) reasons.push('EXPECT_READY_REQUIRED');
  else if (g.expectReady !== g.readyCount) reasons.push(`EXPECT_READY_MISMATCH:${g.expectReady}!=${g.readyCount}`);
  return { allowed: reasons.length === 0, reasons };
}

/** ApartmentMaster create 데이터 — 현 schema의 seed 필드만. roadAddress 등 enrichment 필드는 넣지 않는다. */
export function toCreateData(row: SeedRow) {
  return {
    aptSeq: row.aptSeq,
    name: row.name,
    normalizedName: row.normalizedName,
    sido: '서울특별시',
    sigungu: row.districtName,
    sggCd: row.district,
    umdName: row.dong,
    umdCd: row.umdCd,
    jibun: row.jibun,
    buildYear: row.buildYear,
    // 양방향 검증을 통과한 좌표만. 그 밖의 종결 상태는 좌표 null + 'failed'(조회했으나 신뢰 못 함), 미조회는 null.
    latitude: row.coordinateStatus === 'VERIFIED' ? row.lat : null,
    longitude: row.coordinateStatus === 'VERIFIED' ? row.lng : null,
    geocodeQuality: row.coordinateStatus === 'VERIFIED' ? 'exact'
      : TERMINAL_COORDINATE_STATUSES.has(row.coordinateStatus as CoordinateStatus) ? 'failed' : null,
  };
}

export interface InsertedRow { aptSeq: string; id: number; sggCd: string; createdAt: string }

export const APPLIED_ARTIFACT_SCHEMA = 'seoul-master-seed-applied/v1';

export function buildAppliedArtifact(a: {
  batchStartedAt: string;
  batchFinishedAt: string;
  districts: readonly string[];
  dbHostKind: 'PRODUCTION' | 'NON_PRODUCTION';
  inserted: readonly InsertedRow[];
  skippedExisting: readonly string[];
  failed: readonly { aptSeq: string; error: string }[];
}) {
  return {
    schema: APPLIED_ARTIFACT_SCHEMA,
    batchStartedAt: a.batchStartedAt,
    batchFinishedAt: a.batchFinishedAt,
    districts: [...a.districts],
    dbHostKind: a.dbHostKind,
    counts: { inserted: a.inserted.length, skippedExisting: a.skippedExisting.length, failed: a.failed.length },
    inserted: [...a.inserted],
    skippedExisting: [...a.skippedExisting],
    failed: [...a.failed],
    rollback: {
      note: '실행하지 않은 템플릿. id 목록 + 서울 구 코드 + batch 시각 3중 조건 — 부산·기존 행은 조건에 걸리지 않는다.',
      sql: "DELETE FROM apartment_masters WHERE id = ANY($1::int[]) AND sgg_cd LIKE '11%' AND created_at BETWEEN $2 AND $3",
      params: { ids: a.inserted.map((r) => r.id), from: a.batchStartedAt, to: a.batchFinishedAt },
    },
  };
}
