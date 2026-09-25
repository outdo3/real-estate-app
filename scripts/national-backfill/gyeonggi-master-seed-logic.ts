// GYEONGGI_MASTER_SEEDING_AUDIT_V1 — 경기 첫 8구 ApartmentMaster seed의 순수 판정(DB·네트워크 없음).
//
// 이 파일은 **설계 고정용**이다. 실행기(runner)는 아직 없고 이번 STEP에서 만들지 않는다.
// 서울 seed(seed-seoul-apartment-master-logic.ts)의 계약을 그대로 따르되, 서울 하드코딩
// (서울 25구 prefix · `서울 {구}` 주소 · region_1depth '서울')을 지역 인자로 바꾼 것만 다르다.
//
// 계약:
//   - 원천: 이미 적재·검증된 매매 전체 이력 raw 캐시(tmp/national-backfill/districts/<구>/raw). MOLIT 재호출 없음.
//   - canonical identity = aptSeq. 이름·지번·좌표로 합치거나 만들지 않는다. prefix를 고치지 않는다.
//   - 대상은 첫 8구 정확히. 41135(분당)는 REVIEW 유지 — 어떤 경로로도 READY가 되지 않는다.
//   - 최근 24개월 매매가 있는 단지(Tier A)만 seed. 과거 전용 단지는 서울과 같은 정책으로 만들지 않는다
//     (SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1 §9 — 같은 필지 재건축 승계를 증명할 증거가 없다).
//   - 좌표: Kakao 주소 검색 정방향 필지 단일 일치 + 역지오코딩 필지 일치(VERIFIED)만 저장. 그 밖은 null.
//   - create-only. 이 모듈에는 update/upsert/delete 경로가 없다.
//   - apply 게이트에 **공개 노출 차단 확인**이 들어 있다: master가 생기는 순간 검색·지도가 경기 단지를
//     싣는 현재 구조(서울 전용 deny-list)에서는 게이트가 닫혀 있다.

import { createHash } from 'crypto';
import {
  classifyIdentity,
  normalizeName,
  resolveCrossDistrict,
  type SeedCandidate,
} from '../seoul-master-seed-plan-logic';
import { parseJibun } from '../seed-seoul-apartment-master-logic';
import { getRegionByLawdCd, getSido } from '../../src/lib/region/registry';

export const GYEONGGI_SIDO_CODE = '41';
/** ApartmentMaster.sido는 registry 축약 표기를 쓴다(부산·서울과 같은 규칙). */
export const GYEONGGI_SIDO_SHORT: string = getSido(GYEONGGI_SIDO_CODE)!.shortName;

/** 매매 전체 이력 적재 + 원천=DB parity를 통과한 첫 배치 8구(NATIONAL_FIRST_BATCH_APPLY_V1). */
export const GYEONGGI_FIRST_BATCH = ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210'] as const;
/** 빈 층 원천 4행으로 REVIEW — 매매도 master도 이 구는 건드리지 않는다. */
export const EXCLUDED_DISTRICTS: ReadonlySet<string> = new Set(['41135']);
const TARGET_SET: ReadonlySet<string> = new Set(GYEONGGI_FIRST_BATCH);

/**
 * Kakao/표시용 시군구 이름. registry fullName에서 시도 접두만 뗀다 —
 * 일반구는 "수원시 장안구"(Kakao region_2depth_name과 같은 형태), 단일 시는 "의정부시".
 * registry에 없거나 경기가 아니면 null(추정하지 않는다).
 */
export function gyeonggiSigungu(lawdCd: string): string | null {
  const node = getRegionByLawdCd(lawdCd);
  if (!node || node.sidoCode !== GYEONGGI_SIDO_CODE || !node.isMolitLeaf) return null;
  const prefix = '경기도 ';
  return node.fullName.startsWith(prefix) ? node.fullName.slice(prefix.length) : null;
}

// ───────────────────────── identity 판정 ─────────────────────────

export type SeedStatus =
  | 'READY'
  | 'REVIEW'
  | 'EXISTING_SKIPPED'
  | 'HISTORICAL_EXCLUDED'
  | 'OUT_OF_TARGET'
  | 'EXCLUDED_DISTRICT';

export interface GgSeedRow {
  aptSeq: string;
  district: string;
  sigungu: string;
  name: string;
  normalizedName: string;
  dong: string;
  umdCd: string;
  jibun: string;
  buildYear: number | null;
  tradeCount: number;
  latestDealDate: string;
  status: SeedStatus;
  reasons: string[];
}

function toRow(c: SeedCandidate, status: SeedStatus, reasons: string[]): GgSeedRow {
  const prefix = c.aptSeq.slice(0, 5);
  return {
    aptSeq: c.aptSeq, district: prefix, sigungu: gyeonggiSigungu(prefix) ?? '', name: c.name,
    normalizedName: normalizeName(c.name), dong: c.umdNm, umdCd: c.umdCd, jibun: c.jibun, buildYear: c.buildYear,
    tradeCount: c.tradeCount, latestDealDate: c.latestDealDate, status, reasons,
  };
}

/** 24개월 창 시작일(YYYY-MM-01). asOfYm = 창의 마지막 달(예: '202609' → '2024-10-01'). */
export function tierAWindowStart(asOfYm: string): string {
  const y = Number(asOfYm.slice(0, 4));
  const m = Number(asOfYm.slice(4, 6));
  const idx = y * 12 + (m - 1) - 23;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * 구별 응답에서 모은 후보(같은 aptSeq가 여러 구 응답에 실릴 수 있음) → aptSeq당 1행.
 *  - aptSeq 앞 5자리가 제외 구(41135)면 EXCLUDED_DISTRICT, 첫 배치 밖이면 OUT_OF_TARGET — prefix를 고치지 않는다.
 *  - 여러 구 응답에 실렸는데 표기가 다르면 REVIEW(CROSS_DISTRICT_CONFLICT). 같으면 prefix 구가 canonical.
 *  - classifyIdentity가 REVIEW면 REVIEW(형식·구 불일치·필수 필드·법정동/지번 충돌).
 *  - 이미 master가 있으면 EXISTING_SKIPPED(비교·수정 없음).
 *  - 최근 24개월 매매가 없으면 HISTORICAL_EXCLUDED.
 */
export function classifyGgCandidates(input: {
  entriesByAptSeq: ReadonlyMap<string, readonly SeedCandidate[]>;
  districts: readonly string[];
  existingAptSeqs: ReadonlySet<string>;
  windowStart: string;
}): GgSeedRow[] {
  const run = new Set(input.districts);
  const out: GgSeedRow[] = [];
  for (const [aptSeq, list] of [...input.entriesByAptSeq.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = aptSeq.slice(0, 5);
    if (EXCLUDED_DISTRICTS.has(prefix)) { out.push(toRow(list[0], 'EXCLUDED_DISTRICT', [`DISTRICT_${prefix}_EXCLUDED`])); continue; }
    if (!TARGET_SET.has(prefix) || !run.has(prefix)) { out.push(toRow(list[0], 'OUT_OF_TARGET', [`CANONICAL_DISTRICT_${prefix}_NOT_IN_RUN`])); continue; }
    const cross = resolveCrossDistrict(list);
    if (!cross.canonical) { out.push(toRow(list[0], 'REVIEW', ['CROSS_DISTRICT_CONFLICT'])); continue; }
    const c = cross.kind === 'MISFILED_REPORT' ? { ...cross.canonical, sggCds: [cross.canonical.lawdCd] } : cross.canonical;
    const v = classifyIdentity(c);
    if (v.verdict !== 'SEED_READY') { out.push(toRow(c, 'REVIEW', v.reasons)); continue; }
    if (!/^\d{5}$/.test(c.umdCd)) { out.push(toRow(c, 'REVIEW', ['UMDCD_MALFORMED'])); continue; }
    if (!gyeonggiSigungu(prefix)) { out.push(toRow(c, 'REVIEW', ['SIGUNGU_UNRESOLVED'])); continue; }
    if (input.existingAptSeqs.has(aptSeq)) { out.push(toRow(c, 'EXISTING_SKIPPED', [])); continue; }
    if (c.latestDealDate < input.windowStart) { out.push(toRow(c, 'HISTORICAL_EXCLUDED', ['NO_SALE_IN_24M_WINDOW'])); continue; }
    out.push(toRow(c, 'READY', []));
  }
  return out;
}

/** 같은 aptSeq가 한 입력에 두 번 들어오면(원천 정리 실패) 어느 쪽도 고르지 않는다. */
export function findDuplicateAptSeqs(rows: readonly Pick<GgSeedRow, 'aptSeq'>[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) (seen.has(r.aptSeq) ? dup : seen).add(r.aptSeq);
  return [...dup].sort();
}

// ───────────────────────── 좌표(Kakao 주소 검색, 필지 일치 — 지역 인자) ─────────────────────────

export interface LotTarget { sigungu: string; dong: string; jibun: string }

export interface KakaoLotAddress {
  address_name?: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
  region_3depth_name?: string;
  mountain_yn?: string;
  main_address_no?: string;
  sub_address_no?: string;
}

const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');
const normSub = (s: string) => { const v = stripZeros(s); return v === '0' ? '' : v; };

/** 정방향 검색어. 이름을 넣지 않는다 — 필지(시군구·법정동·지번)만. */
export function ggAddressQuery(t: LotTarget): string {
  return `경기 ${t.sigungu} ${t.dong} ${t.jibun}`;
}

function sameLot(a: KakaoLotAddress, t: LotTarget): boolean {
  const lot = parseJibun(t.jibun);
  if (!lot) return false;
  return (a.region_1depth_name ?? '').startsWith('경기')
    && a.region_2depth_name === t.sigungu
    && a.region_3depth_name === t.dong
    && (a.mountain_yn === 'Y') === lot.mountain
    && stripZeros(a.main_address_no ?? '') === lot.main
    && normSub(a.sub_address_no ?? '') === lot.sub;
}

export type ForwardStatus = 'EXACT' | 'NO_MATCH' | 'AMBIGUOUS' | 'JIBUN_UNPARSEABLE';

/** 지번 주소 결과(REGION_ADDR) 중 필지가 모두 같은 결과가 **정확히 하나**일 때만 EXACT(중간 단계). */
export function ggMatchExactLot(
  docs: readonly { address_type?: string; x?: string; y?: string; address?: KakaoLotAddress | null }[],
  t: LotTarget
): { status: ForwardStatus; lat: number | null; lng: number | null } {
  if (!parseJibun(t.jibun)) return { status: 'JIBUN_UNPARSEABLE', lat: null, lng: null };
  const hits = docs.filter((d) => d.address_type === 'REGION_ADDR' && d.address && sameLot(d.address, t));
  if (hits.length === 0) return { status: 'NO_MATCH', lat: null, lng: null };
  if (hits.length > 1) return { status: 'AMBIGUOUS', lat: null, lng: null };
  const lat = Number(hits[0].y);
  const lng = Number(hits[0].x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'NO_MATCH', lat: null, lng: null };
  return { status: 'EXACT', lat, lng };
}

/** 역지오코딩 필지가 목표 필지와 같을 때만 VERIFIED. 이웃 필지·다른 시군구는 좌표를 버린다. */
export function ggVerifyReverseLot(doc: { address?: KakaoLotAddress | null } | null, t: LotTarget): 'VERIFIED' | 'REVERSE_MISMATCH' | 'REVERSE_NO_RESULT' {
  const a = doc?.address;
  if (!a || !a.main_address_no) return 'REVERSE_NO_RESULT';
  return sameLot(a, t) ? 'VERIFIED' : 'REVERSE_MISMATCH';
}

/** CROSS_REGION: 정방향 결과가 목표 필지와 다른 시도·시군구뿐(GYEONGGI_MASTER_SEEDING_DRYRUN_V1 §8 — REVIEW). */
export type CoordinateStatus = 'VERIFIED' | 'FORWARD_NO_MATCH' | 'CROSS_REGION' | 'AMBIGUOUS' | 'JIBUN_UNPARSEABLE' | 'REVERSE_MISMATCH' | 'REVERSE_NO_RESULT' | 'ERROR' | 'RATE_LIMITED' | 'NOT_ATTEMPTED';
export const TERMINAL: ReadonlySet<CoordinateStatus> = new Set<CoordinateStatus>(['VERIFIED', 'FORWARD_NO_MATCH', 'CROSS_REGION', 'AMBIGUOUS', 'JIBUN_UNPARSEABLE', 'REVERSE_MISMATCH', 'REVERSE_NO_RESULT']);

/** 계획 버킷: READY 행 중 좌표가 VERIFIED가 아니면 GEOCODE_MISSING(좌표 null로 적재 — 만들어 넣지 않는다). */
export type PlanBucket = 'READY' | 'GEOCODE_MISSING' | 'REVIEW' | 'UNRESOLVED';
export function planBucket(row: Pick<GgSeedRow, 'status'>, coord: CoordinateStatus): PlanBucket | null {
  if (row.status === 'REVIEW') return 'REVIEW';
  if (row.status !== 'READY') return null;
  if (coord === 'ERROR' || coord === 'RATE_LIMITED' || coord === 'NOT_ATTEMPTED') return 'UNRESOLVED';
  return coord === 'VERIFIED' ? 'READY' : 'GEOCODE_MISSING';
}

// ───────────────────────── create 데이터 · plan hash · apply 게이트 ─────────────────────────

/** 현 ApartmentMaster schema의 seed 필드만. enrichment 필드(roadAddress·세대수 등)는 넣지 않는다. */
export function ggToCreateData(row: GgSeedRow, coord: { status: CoordinateStatus; lat: number | null; lng: number | null }) {
  if (row.status !== 'READY') throw new Error(`NOT_READY:${row.aptSeq}`);
  if (!row.aptSeq.startsWith(row.district) || !TARGET_SET.has(row.district)) throw new Error(`DISTRICT_GUARD:${row.aptSeq}`);
  const verified = coord.status === 'VERIFIED' && coord.lat != null && coord.lng != null;
  return {
    aptSeq: row.aptSeq,
    name: row.name,
    normalizedName: row.normalizedName,
    sido: GYEONGGI_SIDO_SHORT,
    sigungu: row.sigungu,
    sggCd: row.district,
    umdName: row.dong,
    umdCd: row.umdCd,
    jibun: row.jibun,
    buildYear: row.buildYear,
    latitude: verified ? coord.lat : null,
    longitude: verified ? coord.lng : null,
    geocodeQuality: verified ? 'exact' : TERMINAL.has(coord.status) ? 'failed' : null,
  };
}

/** dry-run이 계획한 create 데이터 전체의 해시. apply는 같은 해시일 때만 진행한다. */
export function ggPlanHash(creates: readonly ReturnType<typeof ggToCreateData>[]): string {
  const canon = [...creates].sort((a, b) => a.aptSeq.localeCompare(b.aptSeq)).map((c) => JSON.stringify(c));
  return createHash('sha256').update(canon.join('\n')).digest('hex');
}

/** 공개 표면이 읽는 축 전부. cronSync는 수집 축이라 여기 없다(DATA_EXISTS ≠ PUBLIC_ALLOWED). */
export const PUBLIC_AXES = ['app', 'search', 'map', 'detail', 'report', 'stats', 'sitemap', 'seoIndex'] as const;

/**
 * GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — seed 대상 구(와 41135)가 **모든 공개 축에서 닫혀 있는가**.
 * 공개 표면은 이제 allowlist(`isPublicRegionAllowed`/`publicAllowedLawdCds`)로만 판정하므로, 이 조건이
 * 참이면 master를 만들어도 검색·지도·상세·리포트·선택기·sitemap 어디에도 실리지 않는다.
 * apply 게이트의 `publicExposureGuarded`는 이 함수 결과를 넣는다(하드코딩 금지).
 */
export function computePublicExposureGuarded(
  isAllowed: (lawdCd: string, axis: (typeof PUBLIC_AXES)[number]) => boolean,
  districts: readonly string[] = [...GYEONGGI_FIRST_BATCH, ...EXCLUDED_DISTRICTS]
): { guarded: boolean; openAxes: string[] } {
  const openAxes: string[] = [];
  for (const d of districts) for (const axis of PUBLIC_AXES) if (isAllowed(d, axis)) openAxes.push(`${d}:${axis}`);
  return { guarded: openAxes.length === 0, openAxes };
}

export interface GgApplyGateInput {
  applyFlag: boolean;
  allowProdDbWrite: string | undefined;
  districts: readonly string[];
  expectInserts: number | null;
  plannedInserts: number;
  expectPlanHash: string | null;
  planHash: string;
  coordinatesSkipped: boolean;
  /** 경기 master가 생겨도 검색·지도·상세·리포트가 경기 단지를 싣지 않음이 검증됐는가(현재 false). */
  publicExposureGuarded: boolean;
}

export function evaluateGgApplyGate(g: GgApplyGateInput): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!g.applyFlag) reasons.push('NO_APPLY_FLAG');
  if (g.allowProdDbWrite !== '1') reasons.push('ALLOW_PROD_DB_WRITE_NOT_1');
  if (g.districts.length === 0) reasons.push('DISTRICT_FILTER_REQUIRED');
  for (const d of g.districts) {
    if (EXCLUDED_DISTRICTS.has(d)) reasons.push(`DISTRICT_${d}_EXCLUDED`);
    else if (!TARGET_SET.has(d)) reasons.push(`DISTRICT_${d}_NOT_IN_FIRST_BATCH`);
  }
  if (g.expectInserts == null) reasons.push('EXPECT_INSERTS_REQUIRED');
  else if (g.expectInserts !== g.plannedInserts) reasons.push(`EXPECT_INSERTS_MISMATCH:${g.expectInserts}!=${g.plannedInserts}`);
  if (!g.expectPlanHash) reasons.push('EXPECT_PLAN_HASH_REQUIRED');
  else if (g.expectPlanHash !== g.planHash) reasons.push('PLAN_HASH_MISMATCH');
  if (g.coordinatesSkipped) reasons.push('COORDINATES_SKIPPED');
  if (!g.publicExposureGuarded) reasons.push('PUBLIC_EXPOSURE_NOT_GUARDED');
  return { allowed: reasons.length === 0, reasons };
}

// ───────────────────────── GYEONGGI_MASTER_SEEDING_DRYRUN_V1 — 계획 상태·증거·해시 ─────────────────────────

/** 계획 정책 버전. 판정 규칙이 바뀌면 올린다 — plan hash에 들어가므로 규칙 변경이 해시로 드러난다. */
export const GG_SEED_POLICY_VERSION = 'gg-master-seed/v1';

/** 후보 하나의 최종 상태. 하나의 aptSeq는 정확히 하나의 상태로 끝난다. */
export type PlanState = 'READY' | 'GEOCODE_MISSING' | 'REVIEW' | 'UNRESOLVED' | 'SKIP_EXISTING' | 'EXCLUDED_HISTORY_ONLY';

export interface CoordEvidence {
  status: CoordinateStatus;
  query: string | null;
  forwardDocs: number;
  forwardHits: number;
  /** 정방향 결과의 시도·시군구·법정동·지번 요약(최대 5) — 판정 근거를 남긴다. */
  forwardSummary: string[];
  lat: number | null;
  lng: number | null;
  reverseLot: string | null;
  detail: string | null;
}

export const NOT_ATTEMPTED_EVIDENCE: CoordEvidence = {
  status: 'NOT_ATTEMPTED', query: null, forwardDocs: 0, forwardHits: 0, forwardSummary: [], lat: null, lng: null, reverseLot: null, detail: null,
};

type ForwardDoc = { address_type?: string; x?: string; y?: string; address?: KakaoLotAddress | null };

export function summarizeLot(a: KakaoLotAddress | null | undefined): string {
  if (!a) return '-';
  const sub = normSub(a.sub_address_no ?? '');
  return `${a.region_1depth_name ?? ''}|${a.region_2depth_name ?? ''}|${a.region_3depth_name ?? ''}|${a.mountain_yn === 'Y' ? '산' : ''}${stripZeros(a.main_address_no ?? '')}${sub ? `-${sub}` : ''}`;
}

/**
 * 정방향 판정 + 교차 지역 구분. ggMatchExactLot가 NO_MATCH인데 결과가 전부 **다른 시도·시군구**면
 * CROSS_REGION(REVIEW 대상), 같은 시군구 안의 다른 필지·동 대표점이면 FORWARD_NO_MATCH(좌표 없음).
 */
export function classifyForward(docs: readonly ForwardDoc[], t: LotTarget): { status: CoordinateStatus | 'EXACT'; lat: number | null; lng: number | null; hits: number; summary: string[] } {
  const summary = docs.slice(0, 5).map((d) => `${d.address_type ?? '?'}:${summarizeLot(d.address)}`);
  const m = ggMatchExactLot(docs, t);
  if (m.status === 'EXACT') return { status: 'EXACT', lat: m.lat, lng: m.lng, hits: 1, summary };
  if (m.status === 'AMBIGUOUS') return { status: 'AMBIGUOUS', lat: null, lng: null, hits: 2, summary };
  if (m.status === 'JIBUN_UNPARSEABLE') return { status: 'JIBUN_UNPARSEABLE', lat: null, lng: null, hits: 0, summary };
  const withAddr = docs.filter((d) => d.address);
  const cross = withAddr.length > 0 && withAddr.every((d) =>
    !(d.address!.region_1depth_name ?? '').startsWith('경기') || d.address!.region_2depth_name !== t.sigungu);
  return { status: cross ? 'CROSS_REGION' : 'FORWARD_NO_MATCH', lat: null, lng: null, hits: 0, summary };
}

/** 식별 판정(classifyGgCandidates) + 좌표 증거 → 최종 계획 상태와 사유. */
export function planState(row: Pick<GgSeedRow, 'status' | 'reasons'>, coord: CoordEvidence): { state: PlanState; reasons: string[] } {
  switch (row.status) {
    case 'EXISTING_SKIPPED': return { state: 'SKIP_EXISTING', reasons: ['MASTER_ALREADY_EXISTS'] };
    case 'HISTORICAL_EXCLUDED': return { state: 'EXCLUDED_HISTORY_ONLY', reasons: row.reasons };
    case 'REVIEW': return { state: 'REVIEW', reasons: row.reasons };
    case 'OUT_OF_TARGET':
    case 'EXCLUDED_DISTRICT': return { state: 'REVIEW', reasons: row.reasons };
    case 'READY': break;
  }
  switch (coord.status) {
    case 'VERIFIED': return { state: 'READY', reasons: [] };
    case 'AMBIGUOUS': return { state: 'REVIEW', reasons: ['COORD_AMBIGUOUS_ADDRESS'] };
    case 'CROSS_REGION': return { state: 'REVIEW', reasons: ['COORD_CROSS_REGION_RESULT'] };
    case 'ERROR':
    case 'RATE_LIMITED':
    case 'NOT_ATTEMPTED': return { state: 'UNRESOLVED', reasons: [`COORD_${coord.status}`] };
    default: return { state: 'GEOCODE_MISSING', reasons: [`COORD_${coord.status}`] };
  }
}

/** 같은 구·법정동코드·지번을 쓰는 aptSeq 묶음(합치지 않는다 — 보고용). */
export function sharedParcelGroups(rows: readonly Pick<GgSeedRow, 'aptSeq' | 'district' | 'umdCd' | 'jibun'>[]): string[][] {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.district}|${r.umdCd}|${r.jibun}`;
    m.set(k, [...(m.get(k) ?? []), r.aptSeq]);
  }
  return [...m.values()].filter((v) => v.length > 1).map((v) => [...v].sort()).sort((a, b) => a[0].localeCompare(b[0]));
}

export interface PlanRecord {
  aptSeq: string;
  district: string;
  state: PlanState;
  reasons: string[];
  /** READY·GEOCODE_MISSING만 — 그대로 create data가 된다. */
  fields: ReturnType<typeof ggToCreateData> | null;
  identity: Pick<GgSeedRow, 'name' | 'dong' | 'umdCd' | 'jibun' | 'buildYear' | 'tradeCount' | 'latestDealDate'>;
  coordinate: CoordEvidence;
}

export function buildPlanRecord(row: GgSeedRow, coord: CoordEvidence): PlanRecord {
  const { state, reasons } = planState(row, coord);
  const insertable = state === 'READY' || state === 'GEOCODE_MISSING';
  return {
    aptSeq: row.aptSeq, district: row.district, state, reasons,
    fields: insertable ? ggToCreateData(row, { status: coord.status, lat: coord.lat, lng: coord.lng }) : null,
    identity: { name: row.name, dong: row.dong, umdCd: row.umdCd, jibun: row.jibun, buildYear: row.buildYear, tradeCount: row.tradeCount, latestDealDate: row.latestDealDate },
    coordinate: coord,
  };
}

/**
 * 계획 전체의 결정적 해시: 정책 버전 · 창 · 대상 구 · aptSeq별 (상태, 사유, create 필드).
 * 좌표 증거의 부수 필드(문서 수·요약)는 넣지 않는다 — 좌표 **결정**(필드의 lat/lng/geocodeQuality)만 들어간다.
 */
export function buildPlanHash(input: { asOfYm: string; districts: readonly string[]; records: readonly PlanRecord[] }): string {
  const body = {
    policy: GG_SEED_POLICY_VERSION,
    asOfYm: input.asOfYm,
    districts: [...input.districts].sort(),
    records: [...input.records].sort((a, b) => a.aptSeq.localeCompare(b.aptSeq)).map((r) => [r.aptSeq, r.state, r.reasons, r.fields]),
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * apply 대상 create 집합의 해시(= future `--expect-plan-hash`). null 좌표 정책이 미정이라 두 변형을 낸다:
 *   withCoords  : READY만
 *   withNull    : READY + GEOCODE_MISSING(좌표 null)
 */
export function insertSetHashes(records: readonly PlanRecord[]): { withCoords: { count: number; hash: string }; withNull: { count: number; hash: string } } {
  const ready = records.filter((r) => r.state === 'READY').map((r) => r.fields!);
  const all = records.filter((r) => r.state === 'READY' || r.state === 'GEOCODE_MISSING').map((r) => r.fields!);
  return { withCoords: { count: ready.length, hash: ggPlanHash(ready) }, withNull: { count: all.length, hash: ggPlanHash(all) } };
}
