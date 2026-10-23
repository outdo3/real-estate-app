// OFFICETEL_NEARBY_V1 — "이 좌표 주변의 오피스텔과 그 실거래"를 돌려주는 읽기 전용 API의 **순수 로직**(DB/네트워크 없음).
// zero-import 유지(strip-types 테스트 러너 제약 — map-marker-contract.ts / detail-contract.ts와 동일).
//
// 만든 이유: SELLFLOW 분양팩이 분양 현장 좌표를 주면 주변 단지의 실거래를 근거 자료로 쓰려 한다. 기존
// `/api/presales/[id]/nearby-market`은 **아파트 전용**이고 분양 공고 id가 있어야 한다. 오피스텔은 반경 조회가 없었다.
//
// 지키는 원칙(AGENTS.md "Data truth policy" 그대로):
//   * 아파트와 오피스텔을 같은 조건으로 비교하지 않는다. 이 응답은 오피스텔만 담고, 그렇다고 응답에 명시한다.
//   * 평균/중앙값을 만들지 않는다(상세 API와 같은 이유: 동일내용 형제 거래 다중성). 원시 거래 몇 건과 건수만 준다.
//   * "거래 없음"과 "동별로 귀속되지 않음"을 구분한다(attribution.ts의 상태를 그대로 싣는다).
//   * 거래일(dealDate)과 수집일(sourceFetchedAt)을 구분해 싣고, 수집일이 오래되면 STALE이라고 말한다 — 오래된 데이터를 최신 시세로 보이게 하지 않는다.
//   * 입력은 전부 검증하고 범위·개수를 제한한다. 내부 식별정보(canonicalKey, 거래 id, 원천 컬럼)는 내보내지 않는다.

// ------------------------------------------------------------------ limits
/** 응답 계약 버전. 필드를 지우거나 뜻을 바꾸면 올린다. 필드 추가는 올리지 않는다(소비자는 모르는 필드를 무시한다). */
export const NEARBY_API_VERSION = 1;
export const NEARBY_DEFAULT_RADIUS_KM = 1;
export const NEARBY_MAX_RADIUS_KM = 3;
export const NEARBY_DEFAULT_LIMIT = 5;
export const NEARBY_MAX_LIMIT = 10;
export const NEARBY_DEFAULT_MONTHS = 12;
export const NEARBY_MAX_MONTHS = 36;
export const NEARBY_DEFAULT_AREA_TOLERANCE = 1;
export const NEARBY_MAX_AREA_TOLERANCE = 5;
/** 한 오피스텔·한 거래 종류당 응답에 싣는 최근 거래 수. */
export const NEARBY_RECENT_TRADES_PER_KIND = 3;
/** 후보 master 상한(좌표 상자 안). 넘으면 자르지 않고 truncated로 알린다. */
export const NEARBY_MAX_CANDIDATES = 800;
/** 수집일이 이보다 오래되면 STALE. */
export const NEARBY_STALE_AFTER_DAYS = 45;

// 대한민국 좌표 범위(제주·울릉·독도 포함, 여유 포함). 범위 밖은 오타나 위·경도 뒤바뀜으로 본다.
const KOREA_LAT: [number, number] = [32.5, 38.9];
const KOREA_LNG: [number, number] = [124.0, 132.1];

export class OfficetelNearbyQueryError extends Error {}

export type NearbyDealKinds = 'sale' | 'rent' | 'both';

export interface OfficetelNearbyQuery {
  lat: number;
  lng: number;
  radiusKm: number;
  limit: number;
  months: number;
  /** 비교 기준 전용면적(㎡). null이면 면적 조건 없음. */
  area: number | null;
  areaTolerance: number;
  kinds: NearbyDealKinds;
}

function num(raw: string | null, name: string): number | null {
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw.trim());
  if (!Number.isFinite(v)) throw new OfficetelNearbyQueryError(`${name}는 숫자여야 합니다.`);
  return v;
}

function int(raw: string | null, name: string, def: number, min: number, max: number): number {
  const v = num(raw, name);
  if (v === null) return def;
  if (!Number.isInteger(v) || v < min || v > max) throw new OfficetelNearbyQueryError(`${name}는 ${min}~${max} 사이 정수여야 합니다.`);
  return v;
}

export function parseOfficetelNearbyQuery(get: (key: string) => string | null): OfficetelNearbyQuery {
  const lat = num(get('lat'), 'lat');
  const lng = num(get('lng'), 'lng');
  if (lat === null || lng === null) throw new OfficetelNearbyQueryError('lat, lng가 필요합니다.');
  if (lat < KOREA_LAT[0] || lat > KOREA_LAT[1] || lng < KOREA_LNG[0] || lng > KOREA_LNG[1]) {
    throw new OfficetelNearbyQueryError('좌표가 대한민국 범위를 벗어났습니다(lat, lng 순서를 확인하세요).');
  }
  const radiusRaw = num(get('radiusKm'), 'radiusKm');
  const radiusKm = radiusRaw === null ? NEARBY_DEFAULT_RADIUS_KM : radiusRaw;
  if (radiusKm < 0.1 || radiusKm > NEARBY_MAX_RADIUS_KM) {
    throw new OfficetelNearbyQueryError(`radiusKm는 0.1~${NEARBY_MAX_RADIUS_KM} 사이여야 합니다.`);
  }
  const limit = int(get('limit'), 'limit', NEARBY_DEFAULT_LIMIT, 1, NEARBY_MAX_LIMIT);
  const months = int(get('months'), 'months', NEARBY_DEFAULT_MONTHS, 1, NEARBY_MAX_MONTHS);
  const area = num(get('area'), 'area');
  if (area !== null && (area <= 0 || area > 500)) throw new OfficetelNearbyQueryError('area(전용면적 ㎡)는 0 초과 500 이하여야 합니다.');
  const tolRaw = num(get('areaTolerance'), 'areaTolerance');
  const areaTolerance = tolRaw === null ? NEARBY_DEFAULT_AREA_TOLERANCE : tolRaw;
  if (areaTolerance < 0 || areaTolerance > NEARBY_MAX_AREA_TOLERANCE) {
    throw new OfficetelNearbyQueryError(`areaTolerance는 0~${NEARBY_MAX_AREA_TOLERANCE} 사이여야 합니다.`);
  }
  const kindsRaw = (get('kinds') ?? 'both').trim();
  if (kindsRaw !== 'sale' && kindsRaw !== 'rent' && kindsRaw !== 'both') throw new OfficetelNearbyQueryError('kinds는 sale | rent | both 중 하나여야 합니다.');
  return { lat, lng, radiusKm, limit, months, area, areaTolerance, kinds: kindsRaw };
}

// ------------------------------------------------------------------ access (fail-closed in production)
export type NearbyAccess = { allowed: true } | { allowed: false; status: 401 | 503; reason: string };

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 새 API는 공개 API가 아니다. 키(`OFFICETEL_NEARBY_API_KEY`)가 설정돼 있으면 `x-api-key`가 같아야 한다.
 * 키가 없으면 Production에서는 **닫혀 있다**(fail-closed) — 배포만으로 우발적으로 열리지 않는다. 개발/테스트에서만 열린다.
 */
export function checkNearbyAccess(input: { configuredKey: string | undefined; providedKey: string | null; nodeEnv: string | undefined }): NearbyAccess {
  const configured = (input.configuredKey ?? '').trim();
  if (configured === '') {
    if (input.nodeEnv === 'production') return { allowed: false, status: 503, reason: '이 API는 아직 활성화되지 않았습니다.' };
    return { allowed: true };
  }
  const provided = (input.providedKey ?? '').trim();
  if (provided === '' || !safeEqual(configured, provided)) return { allowed: false, status: 401, reason: '인증이 필요합니다.' };
  return { allowed: true };
}

// ------------------------------------------------------------------ geometry
const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number): number => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** DB 후보 조회용 좌표 상자. 정확한 거리는 haversine으로 다시 거른다. */
export function boundingBox(lat: number, lng: number, radiusKm: number): { latMin: number; latMax: number; lngMin: number; lngMax: number } {
  const dLat = radiusKm / 111.0;
  const dLng = radiusKm / (111.0 * Math.max(0.01, Math.cos(toRad(lat))));
  return { latMin: lat - dLat, latMax: lat + dLat, lngMin: lng - dLng, lngMax: lng + dLng };
}

export interface NearbyMasterRow {
  id: number;
  displayName: string;
  umdNm: string;
  jibun: string;
  buildingDong: string | null;
  roadAddress: string | null;
  buildYear: number | null;
  hoCnt: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RankedMaster extends NearbyMasterRow {
  distanceKm: number;
}

/** 반경 안 master를 가까운 순(같으면 id 순)으로. 좌표가 없거나 유효하지 않은 master는 조용히 섞지 않고 제외한다. */
export function rankNearbyMasters(rows: NearbyMasterRow[], query: { lat: number; lng: number; radiusKm: number }): { ranked: RankedMaster[]; withinRadius: number } {
  const ranked: RankedMaster[] = [];
  for (const r of rows) {
    const { latitude: la, longitude: ln } = r;
    if (typeof la !== 'number' || typeof ln !== 'number' || !Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) continue;
    const d = haversineKm(query.lat, query.lng, la, ln);
    if (d <= query.radiusKm) ranked.push({ ...r, distanceKm: d });
  }
  ranked.sort((a, b) => a.distanceKm - b.distanceKm || a.id - b.id);
  return { ranked, withinRadius: ranked.length };
}

// ------------------------------------------------------------------ dates
/** YYYY-MM-DD(UTC). now를 주입받아 테스트에서 고정한다. */
export function windowStartDate(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

export type FreshnessStatus = 'CURRENT' | 'STALE' | 'UNKNOWN';

export function freshnessOf(lastFetchedAtIso: string | null, now: Date): { status: FreshnessStatus; ageDays: number | null } {
  if (!lastFetchedAtIso) return { status: 'UNKNOWN', ageDays: null };
  const t = Date.parse(lastFetchedAtIso);
  if (!Number.isFinite(t)) return { status: 'UNKNOWN', ageDays: null };
  const ageDays = Math.max(0, Math.floor((now.getTime() - t) / 86400000));
  return { status: ageDays > NEARBY_STALE_AFTER_DAYS ? 'STALE' : 'CURRENT', ageDays };
}

// ------------------------------------------------------------------ trades
export interface SaleTradeRow {
  dealDate: string; // YYYY-MM-DD
  dealAmount: number; // 만원
  exclusiveArea: number; // ㎡
  floor: number;
}
export interface RentTradeRow {
  dealDate: string;
  deposit: number; // 만원
  monthlyRent: number; // 만원 (0 = 전세)
  exclusiveArea: number;
  floor: number;
}

function areaMatches(area: number, query: { area: number | null; areaTolerance: number }): boolean {
  if (query.area === null) return true;
  return Math.abs(area - query.area) <= query.areaTolerance + 1e-9;
}

export interface TradeSummary<T> {
  /** 조회 기간 안, 면적 조건에 맞는 거래 수(취소 거래 제외). */
  count: number;
  latestDealDate: string | null;
  /** 최근순 원시 거래. 평균/중앙값은 만들지 않는다. */
  recent: (T & { dealMonth: string })[];
}

function summarize<T extends { dealDate: string; exclusiveArea: number }>(rows: T[], query: { area: number | null; areaTolerance: number }): TradeSummary<T> {
  const matched = rows.filter((r) => areaMatches(r.exclusiveArea, query)).sort((a, b) => (a.dealDate < b.dealDate ? 1 : a.dealDate > b.dealDate ? -1 : 0));
  return {
    count: matched.length,
    latestDealDate: matched.length > 0 ? matched[0].dealDate : null,
    recent: matched.slice(0, NEARBY_RECENT_TRADES_PER_KIND).map((r) => ({ ...r, dealMonth: r.dealDate.slice(0, 7) })),
  };
}

export const summarizeSale = (rows: SaleTradeRow[], q: { area: number | null; areaTolerance: number }): TradeSummary<SaleTradeRow> => summarize(rows, q);
export const summarizeRent = (rows: RentTradeRow[], q: { area: number | null; areaTolerance: number }): TradeSummary<RentTradeRow> => summarize(rows, q);

// ------------------------------------------------------------------ response
export type NearbyAttributionStatus = 'ATTRIBUTED' | 'UNATTRIBUTED_AT_ADDRESS' | 'NO_TRANSACTIONS';
export type NearbyDataStatus = 'OK' | 'INSUFFICIENT' | 'NO_NEARBY_OFFICETEL';

export interface NearbyMasterInput {
  master: RankedMaster;
  /** 원시 행(테스트/표본 계산용). saleSummary가 있으면 그것이 우선한다. */
  sale?: SaleTradeRow[];
  rent?: RentTradeRow[];
  /**
   * DB가 이미 센 값(조회 기간 + 면적 조건 + 취소 제외). 읽기 계층은 이 경로를 쓴다 — 건수가 "몇 행을 불러왔는가"에 좌우되지 않게 하기 위해서다.
   * recent는 최근순 상위 몇 건(NEARBY_RECENT_TRADES_PER_KIND 이하)이면 된다.
   */
  saleSummary?: { count: number; latestDealDate: string | null; recent: SaleTradeRow[] };
  rentSummary?: { count: number; latestDealDate: string | null; recent: RentTradeRow[] };
  attribution: { status: NearbyAttributionStatus; note: string | null };
}

export interface NearbyBuildInput {
  query: OfficetelNearbyQuery;
  now: Date;
  withinRadius: number;
  candidatesTruncated: boolean;
  tradeRowsTruncated: boolean;
  masters: NearbyMasterInput[];
  /** 데이터셋 전체의 마지막 수집 시각/거래일(조회 기간과 무관). 응답은 이 값으로 최신성을 말한다. */
  dataset: { sale: { lastFetchedAt: string | null; lastDealDate: string | null }; rent: { lastFetchedAt: string | null; lastDealDate: string | null } };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildOfficetelNearbyResponse(input: NearbyBuildInput) {
  const { query, now } = input;
  const wantSale = query.kinds !== 'rent';
  const wantRent = query.kinds !== 'sale';
  const since = windowStartDate(now, query.months);

  const withMonth = <T extends { dealDate: string }>(rows: T[]) => rows.slice(0, NEARBY_RECENT_TRADES_PER_KIND).map((r) => ({ ...r, dealMonth: r.dealDate.slice(0, 7) }));
  const items = input.masters.map(({ master, sale, rent, saleSummary: preSale, rentSummary: preRent, attribution }) => {
    const saleSummary = !wantSale ? null : preSale ? { count: preSale.count, latestDealDate: preSale.latestDealDate, recent: withMonth(preSale.recent) } : summarizeSale(sale ?? [], query);
    const rentSummary = !wantRent ? null : preRent ? { count: preRent.count, latestDealDate: preRent.latestDealDate, recent: withMonth(preRent.recent) } : summarizeRent(rent ?? [], query);
    const hasTrades = (saleSummary?.count ?? 0) + (rentSummary?.count ?? 0) > 0;
    return {
      id: master.id,
      /** 이집의 오피스텔 상세 화면 상대 경로(출처 링크용). 호스트는 호출하는 쪽이 붙인다. */
      detailPath: `/officetel/${master.id}`,
      name: master.displayName,
      propertyType: 'officetel' as const,
      address: { dong: master.umdNm, jibun: master.jibun, buildingDong: master.buildingDong, roadAddress: master.roadAddress },
      buildYear: master.buildYear,
      /** 규모는 호 단위(세대수 아님). 없으면 null. */
      hoCnt: master.hoCnt,
      distanceKm: round2(master.distanceKm),
      coordinates: { latitude: master.latitude, longitude: master.longitude },
      tradeStatus: hasTrades ? ('HAS_TRADES' as const) : ('NO_TRADES_IN_WINDOW' as const),
      attribution: attribution,
      sale: saleSummary,
      rent: rentSummary,
    };
  });

  const anyTrades = items.some((i) => i.tradeStatus === 'HAS_TRADES');
  const dataStatus: NearbyDataStatus = items.length === 0 ? 'NO_NEARBY_OFFICETEL' : anyTrades ? 'OK' : 'INSUFFICIENT';

  const saleFresh = freshnessOf(input.dataset.sale.lastFetchedAt, now);
  const rentFresh = freshnessOf(input.dataset.rent.lastFetchedAt, now);
  const staleAny = (wantSale && saleFresh.status !== 'CURRENT') || (wantRent && rentFresh.status !== 'CURRENT');

  const notes: string[] = [];
  if (dataStatus === 'NO_NEARBY_OFFICETEL') notes.push('반경 안에 등록된 오피스텔이 없습니다. 현재 오피스텔 자료는 부산 지역만 있습니다.');
  if (dataStatus === 'INSUFFICIENT') notes.push('주변 오피스텔은 있으나 조회 기간·면적 조건에 맞는 실거래가 없습니다. 가격을 추정하지 않습니다.');
  if (staleAny) notes.push('수집일이 오래된 자료입니다. 수집일 이후의 거래는 반영되지 않았을 수 있어 최신 시세로 쓰면 안 됩니다.');
  if (input.candidatesTruncated || input.tradeRowsTruncated) notes.push('조회량 상한에 걸려 일부만 반영됐습니다.');
  if (items.some((i) => i.attribution.status === 'UNATTRIBUTED_AT_ADDRESS')) notes.push('동별로 구분할 수 없는 거래는 어느 오피스텔에도 붙이지 않았습니다(거래 없음이 아닙니다).');

  return {
    apiVersion: NEARBY_API_VERSION,
    query: { lat: query.lat, lng: query.lng, radiusKm: query.radiusKm, limit: query.limit, months: query.months, area: query.area, areaTolerance: query.area === null ? null : query.areaTolerance, kinds: query.kinds },
    dataStatus,
    /** 이 응답은 오피스텔만 담는다. 아파트 실거래와 같은 조건(면적·거래 유형·시점)으로 비교하지 않는다. */
    comparison: {
      propertyType: 'officetel' as const,
      areaBasis: '전용면적(㎡)',
      priceUnit: '만원',
      note: '오피스텔 실거래입니다. 아파트 실거래와 같은 기준으로 비교하지 마세요. 평균·중앙값은 제공하지 않고 원시 거래만 제공합니다.',
    },
    window: { months: query.months, dealDateFrom: since, dealDateTo: now.toISOString().slice(0, 10) },
    /** 거래일(dealDate)과 수집일(lastFetchedAt)은 다른 값이다. */
    dataAsOf: {
      sale: wantSale ? { lastDealDate: input.dataset.sale.lastDealDate, lastFetchedAt: input.dataset.sale.lastFetchedAt, freshness: saleFresh.status, ageDays: saleFresh.ageDays } : null,
      rent: wantRent ? { lastDealDate: input.dataset.rent.lastDealDate, lastFetchedAt: input.dataset.rent.lastFetchedAt, freshness: rentFresh.status, ageDays: rentFresh.ageDays } : null,
    },
    source: {
      name: '국토교통부 실거래가 공개자료(오피스텔 매매·전월세)',
      collectedBy: '이집(E-JIP)',
      cancelledSaleDeals: '취소 거래는 제외했습니다. 오피스텔 원천에는 등기일이 없어 취소 신뢰도는 제한적입니다.',
      duplicates: '원천 행을 1:1로 보존합니다. 동일 내용의 형제 거래를 합치지 않습니다.',
    },
    coverage: { region: '부산광역시', note: '오피스텔 마스터와 실거래는 부산만 적재되어 있습니다.' },
    totals: { withinRadius: input.withinRadius, returned: items.length },
    truncated: { candidates: input.candidatesTruncated, tradeRows: input.tradeRowsTruncated },
    notes,
    items,
  };
}
