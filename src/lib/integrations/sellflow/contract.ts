// SELLFLOW_DATA_API_V1 — E-JIP -> SELLFLOW 서버 간 읽기 전용 데이터 API의 **순수 계약 로직**(DB/네트워크/환경변수 없음).
//
// 만든 이유: SELLFLOW가 블로그·카드뉴스·쇼츠의 근거 데이터를 아파트·오피스텔 구분 없이 같은 모양으로 조회하게 한다.
// 기존 `/api/officetel/nearby`는 좌표 반경·오피스텔 전용·3건 요약이라 이 용도(건물 검색/기간 조회/통계)에 맞지 않아 재사용하지 않는다.
// (인증 fail-closed 방식과 귀속 상태(attribution)의 의미만 같은 원칙으로 따른다.)
//
// 지키는 원칙(AGENTS.md "Data truth policy"):
//   * 거래 0건과 수집 실패는 다른 값이다. 실패는 5xx로만 나가고 빈 결과로 위장하지 않는다.
//   * 검증되지 않은 구간의 0건은 "거래 없음"이라고 쓰지 않는다(resultState).
//   * Master에 확정되지 않은 거래는 어느 건물의 거래로도 내보내지 않는다. 건수만 알린다.
//   * 취소 거래는 기본으로 제외한다. 원천이 취소를 제공하지 않는 구간의 `false`는 검증된 참이 아니므로 null로 내보낸다.
//   * 평형(평)을 만들지 않는다. 전용면적(㎡)만 원본 그대로 낸다.
//   * 내부 PK, canonicalKey, rawUid, 사용자 정보는 내보내지 않는다.

// ------------------------------------------------------------------ constants
export const SELLFLOW_API_VERSION = 'v1';

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 20;
/** 유형별 후보 상한. 넘으면 자르고 truncated로 알린다. */
export const SEARCH_MAX_CANDIDATES = 60;
export const SEARCH_Q_MIN_LENGTH = 2;
export const SEARCH_Q_MAX_LENGTH = 40;
export const SEARCH_DONG_MAX_LENGTH = 20;

export const TX_DEFAULT_PERIOD_MONTHS = 12;
/** 한 요청이 덮을 수 있는 최대 개월 수(양 끝 달 포함). */
export const MAX_PERIOD_MONTHS = 36;
/** 원천 적재 시작월 이전은 조회하지 않는다. */
export const EARLIEST_MONTH = '2006-01';
export const TX_DEFAULT_PAGE_SIZE = 50;
export const TX_MAX_PAGE_SIZE = 100;
export const TX_MAX_PAGE = 50;
export const MAX_AREA_VALUE = 1000;

/** summary가 메모리로 읽는 최대 행 수. 넘으면 통계를 만들지 않고 기간을 좁히라고 알린다. */
export const SUMMARY_MAX_ROWS = 5000;
export const SUMMARY_MAX_AREA_GROUPS = 50;
/** 이 건수 이상이어야 SUFFICIENT. 미만이면 LOW_SAMPLE(중앙값을 내지 않는다). */
export const MIN_SUFFICIENT_SAMPLE = 5;
/** 윈도우의 모든 달이 검증돼 있고 가장 오래된 검증이 이 시간 이내면 FRESH. 주간 recheck + Vercel Hobby 지터를 덮는다. */
export const FRESH_WITHIN_HOURS = 8 * 24;
/** 원천이 매매 취소를 제공하기 시작한 첫 달(오피스텔 실측: 2006~2019 취소 0건 = "원천 미제공"). */
export const CANCELLATION_COVERAGE_FROM = '2020-01';

export type PropertyType = 'apartment' | 'officetel';
export type TransactionType = 'sale' | 'jeonse' | 'wolse';
export const PROPERTY_TYPES: readonly PropertyType[] = ['apartment', 'officetel'];
export const TRANSACTION_TYPES: readonly TransactionType[] = ['sale', 'jeonse', 'wolse'];

// ------------------------------------------------------------------ errors
export class SellflowApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SellflowApiError';
    this.status = status;
    this.code = code;
  }
}

const bad = (code: string, message: string): SellflowApiError => new SellflowApiError(400, code, message);

// ------------------------------------------------------------------ auth
export interface SellflowAuthConfig {
  /** SELLFLOW_DATA_API_KEY. 비어 있으면 닫힌다. */
  apiKey: string | undefined;
  /** SELLFLOW_DATA_API_ENABLED. 정확히 'true'일 때만 열린다(이용 조건 검토 전 우발적 개방 방지). */
  enabled: string | undefined;
  /** SELLFLOW_DATA_API_PROPERTY_TYPES. 쉼표 목록. 비어 있으면 둘 다 허용. */
  propertyTypes: string | undefined;
}

export type AuthResult =
  | { ok: true; allowedPropertyTypes: PropertyType[] }
  | { ok: false; status: 401 | 503; code: 'UNAUTHORIZED' | 'NOT_ENABLED'; message: string };

/** 길이가 달라도 같은 시간 흐름으로 비교한다. */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function parseAllowedPropertyTypes(raw: string | undefined): PropertyType[] {
  const picked = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PropertyType => (PROPERTY_TYPES as readonly string[]).includes(s));
  return picked.length > 0 ? Array.from(new Set(picked)) : [...PROPERTY_TYPES];
}

/**
 * 서버 간 인증. 설정이 없거나 enabled가 아니면 **어떤 요청도 통과시키지 않는다**(fail-closed, 503).
 * 이 단계에서는 키를 만들거나 등록하지 않는다 — 환경변수에 값이 생기기 전까지 배포돼도 닫혀 있다.
 */
export function authenticate(authorizationHeader: string | null, config: SellflowAuthConfig): AuthResult {
  const key = (config.apiKey ?? '').trim();
  if (key === '' || (config.enabled ?? '').trim() !== 'true') {
    return { ok: false, status: 503, code: 'NOT_ENABLED', message: '이 API는 아직 활성화되지 않았습니다.' };
  }
  const m = /^Bearer\s+(\S+)\s*$/i.exec((authorizationHeader ?? '').trim());
  if (!m || !constantTimeEqual(key, m[1])) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: '인증이 필요합니다.' };
  }
  return { ok: true, allowedPropertyTypes: parseAllowedPropertyTypes(config.propertyTypes) };
}

// ------------------------------------------------------------------ ids
export type ParsedMasterId = { propertyType: 'apartment'; aptSeq: string } | { propertyType: 'officetel'; id: number };

/** 외부 masterId: 아파트 `apt-{aptSeq}`(aptSeq는 MOLIT 정식 식별자 — 내부 PK는 master 재구축 시 바뀔 수 있어 쓰지 않는다), 오피스텔 `offi-{id}`. */
export function formatMasterId(propertyType: PropertyType, key: string | number): string {
  return propertyType === 'apartment' ? `apt-${key}` : `offi-${key}`;
}

export function parseMasterId(raw: string): ParsedMasterId {
  const apt = /^apt-(\d{5}-\d{1,12})$/.exec(raw);
  if (apt) return { propertyType: 'apartment', aptSeq: apt[1] };
  const offi = /^offi-([1-9]\d{0,8})$/.exec(raw);
  if (offi) return { propertyType: 'officetel', id: Number(offi[1]) };
  throw bad('INVALID_MASTER_ID', 'masterId 형식이 올바르지 않습니다. (apt-{aptSeq} 또는 offi-{id})');
}

// ------------------------------------------------------------------ months / dates
export function kstMonth(now: Date): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export function monthsBetween(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  for (let m = fromYm; m <= toYm; m = addMonths(m, 1)) out.push(m);
  return out;
}

export const toYmd = (ym: string): string => ym.replace('-', '');

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 원천별 취소일 표기(`YY.MM.DD`, `YYYYMMDD`, `YYYY-MM-DD`)를 ISO 날짜로 맞춘다. 해석 못 하면 null(지어내지 않는다). */
export function normalizeCancelDate(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  let m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(s);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? s : null;
}

// ------------------------------------------------------------------ query parsing
type Getter = (key: string) => string | null;

function rejectUnknown(keys: string[], allowed: readonly string[]): void {
  const unknown = keys.filter((k) => !allowed.includes(k));
  if (unknown.length > 0) throw bad('INVALID_PARAMETER', `지원하지 않는 파라미터입니다: ${unknown.slice(0, 3).join(', ')}`);
}

function intParam(raw: string | null, name: string, min: number, max: number, dflt: number): number {
  if (raw === null || raw.trim() === '') return dflt;
  if (!/^\d{1,6}$/.test(raw.trim())) throw bad('INVALID_PARAMETER', `${name}은(는) 정수여야 합니다.`);
  const n = Number(raw);
  if (n < min || n > max) throw bad('INVALID_PARAMETER', `${name}은(는) ${min}~${max} 범위여야 합니다.`);
  return n;
}

function areaParam(raw: string | null, name: string): number | null {
  if (raw === null || raw.trim() === '') return null;
  if (!/^\d{1,4}(\.\d{1,4})?$/.test(raw.trim())) throw bad('INVALID_PARAMETER', `${name}은(는) 숫자(㎡)여야 합니다.`);
  const n = Number(raw);
  if (!(n > 0) || n > MAX_AREA_VALUE) throw bad('INVALID_PARAMETER', `${name}은(는) 0 초과 ${MAX_AREA_VALUE} 이하여야 합니다.`);
  return n;
}

/** 검색어 정규화: 공백 제거 + 후행 "아파트"/"오피스텔" 제거(master의 normalizedName 규칙과 같은 방향). 같은 건물이라는 판정이 아니다. */
export function normalizeSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/(아파트|오피스텔)$/, '');
}

export interface SearchQuery {
  propertyTypes: PropertyType[];
  lawdCd: string;
  dong: string | null;
  q: string | null;
  qNormalized: string | null;
  limit: number;
}

export const SEARCH_PARAMS = ['propertyType', 'lawdCd', 'dong', 'q', 'limit'] as const;

export function parseSearchQuery(keys: string[], get: Getter, allowed: PropertyType[]): SearchQuery {
  rejectUnknown(keys, SEARCH_PARAMS);
  const lawdCd = (get('lawdCd') ?? '').trim();
  // 지역 없이 전국/광역 검색을 허용하지 않는다(비용·오용 방지).
  if (!/^\d{5}$/.test(lawdCd)) throw bad('INVALID_PARAMETER', 'lawdCd(법정동 시군구 5자리)는 필수입니다.');

  const pt = (get('propertyType') ?? 'all').trim().toLowerCase();
  let propertyTypes: PropertyType[];
  if (pt === 'all') propertyTypes = [...allowed];
  else if ((PROPERTY_TYPES as readonly string[]).includes(pt)) {
    if (!allowed.includes(pt as PropertyType)) throw new SellflowApiError(403, 'FORBIDDEN', '이 키로 조회할 수 없는 유형입니다.');
    propertyTypes = [pt as PropertyType];
  } else throw bad('INVALID_PARAMETER', 'propertyType은 apartment | officetel | all 이어야 합니다.');

  const qRaw = (get('q') ?? '').trim();
  const dongRaw = (get('dong') ?? '').trim();
  if (qRaw === '' && dongRaw === '') throw bad('INVALID_PARAMETER', 'q(건물명) 또는 dong(법정동) 중 하나는 필요합니다.');
  if (qRaw !== '' && (qRaw.length < SEARCH_Q_MIN_LENGTH || qRaw.length > SEARCH_Q_MAX_LENGTH)) {
    throw bad('INVALID_PARAMETER', `q는 ${SEARCH_Q_MIN_LENGTH}~${SEARCH_Q_MAX_LENGTH}자여야 합니다.`);
  }
  if (dongRaw.length > SEARCH_DONG_MAX_LENGTH) throw bad('INVALID_PARAMETER', `dong은 ${SEARCH_DONG_MAX_LENGTH}자 이하여야 합니다.`);
  const qNormalized = qRaw === '' ? null : normalizeSearchTerm(qRaw);
  if (qRaw !== '' && (qNormalized ?? '').length < 1) throw bad('INVALID_PARAMETER', 'q가 너무 일반적입니다.');

  return {
    propertyTypes,
    lawdCd,
    dong: dongRaw === '' ? null : dongRaw,
    q: qRaw === '' ? null : qRaw,
    qNormalized,
    limit: intParam(get('limit'), 'limit', 1, SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT),
  };
}

export interface WindowQuery {
  transactionType: TransactionType;
  fromMonth: string;
  toMonth: string;
  months: string[];
  /** 거래일 범위 [dateFrom, dateToExclusive). */
  dateFrom: string;
  dateToExclusive: string;
  minArea: number | null;
  maxArea: number | null;
}

export interface TransactionsQuery extends WindowQuery {
  includeCanceled: boolean;
  page: number;
  pageSize: number;
}

export const TX_PARAMS = ['transactionType', 'fromMonth', 'toMonth', 'minArea', 'maxArea', 'includeCanceled', 'page', 'pageSize'] as const;
export const SUMMARY_PARAMS = ['transactionType', 'fromMonth', 'toMonth', 'minArea', 'maxArea'] as const;

function parseWindow(get: Getter, now: Date): WindowQuery {
  const tt = (get('transactionType') ?? 'sale').trim().toLowerCase();
  if (!(TRANSACTION_TYPES as readonly string[]).includes(tt)) throw bad('INVALID_PARAMETER', 'transactionType은 sale | jeonse | wolse 이어야 합니다.');

  const current = kstMonth(now);
  const toRaw = (get('toMonth') ?? '').trim();
  const fromRaw = (get('fromMonth') ?? '').trim();
  if (toRaw !== '' && !MONTH_RE.test(toRaw)) throw bad('INVALID_PARAMETER', 'toMonth는 YYYY-MM 형식이어야 합니다.');
  if (fromRaw !== '' && !MONTH_RE.test(fromRaw)) throw bad('INVALID_PARAMETER', 'fromMonth는 YYYY-MM 형식이어야 합니다.');
  const toMonth = toRaw === '' ? current : toRaw;
  const fromMonth = fromRaw === '' ? addMonths(toMonth, -(TX_DEFAULT_PERIOD_MONTHS - 1)) : fromRaw;
  if (toMonth > current) throw bad('INVALID_PARAMETER', 'toMonth는 현재 월을 넘을 수 없습니다.');
  if (fromMonth < EARLIEST_MONTH) throw bad('INVALID_PARAMETER', `fromMonth는 ${EARLIEST_MONTH} 이후여야 합니다.`);
  if (fromMonth > toMonth) throw bad('INVALID_PARAMETER', 'fromMonth는 toMonth보다 늦을 수 없습니다.');
  const months = monthsBetween(fromMonth, toMonth);
  if (months.length > MAX_PERIOD_MONTHS) throw bad('PERIOD_TOO_LONG', `조회 기간은 최대 ${MAX_PERIOD_MONTHS}개월입니다.`);

  const minArea = areaParam(get('minArea'), 'minArea');
  const maxArea = areaParam(get('maxArea'), 'maxArea');
  if (minArea !== null && maxArea !== null && minArea > maxArea) throw bad('INVALID_PARAMETER', 'minArea는 maxArea보다 클 수 없습니다.');

  return {
    transactionType: tt as TransactionType,
    fromMonth,
    toMonth,
    months,
    dateFrom: `${fromMonth}-01`,
    dateToExclusive: `${addMonths(toMonth, 1)}-01`,
    minArea,
    maxArea,
  };
}

export function parseTransactionsQuery(keys: string[], get: Getter, now: Date): TransactionsQuery {
  rejectUnknown(keys, TX_PARAMS);
  const w = parseWindow(get, now);
  const icRaw = (get('includeCanceled') ?? 'false').trim().toLowerCase();
  if (icRaw !== 'true' && icRaw !== 'false') throw bad('INVALID_PARAMETER', 'includeCanceled는 true | false 이어야 합니다.');
  const includeCanceled = icRaw === 'true';
  // 전월세 원천에는 취소 개념이 없다. 포함 여부를 물을 수 없다.
  if (includeCanceled && w.transactionType !== 'sale') throw bad('INVALID_PARAMETER', 'includeCanceled는 transactionType=sale에서만 쓸 수 있습니다.');
  return {
    ...w,
    includeCanceled,
    page: intParam(get('page'), 'page', 1, TX_MAX_PAGE, 1),
    pageSize: intParam(get('pageSize'), 'pageSize', 1, TX_MAX_PAGE_SIZE, TX_DEFAULT_PAGE_SIZE),
  };
}

export function parseSummaryQuery(keys: string[], get: Getter, now: Date): WindowQuery {
  rejectUnknown(keys, SUMMARY_PARAMS);
  return parseWindow(get, now);
}

// ------------------------------------------------------------------ raw -> external
/** 어댑터가 DB 행을 이 모양으로 맞춰 준다. 날짜는 전부 문자열(거래일 YYYY-MM-DD, 수집 시각 ISO). */
export interface RawTx {
  dealDate: string;
  /** 매매 거래금액(만원). 전월세는 null. */
  price: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  exclusiveArea: number;
  floor: number | null;
  /** DB의 dealCanceled(매매). 전월세는 null. */
  dealCanceled: boolean | null;
  cancelDateRaw: string | null;
  contractType: string | null;
  sourceFetchedAt: string;
}

export type CancellationCoverage = 'PROVIDED' | 'NOT_PROVIDED_BY_SOURCE';

export function cancellationCoverageFor(transactionType: TransactionType, dealDate: string): CancellationCoverage {
  if (transactionType !== 'sale') return 'NOT_PROVIDED_BY_SOURCE';
  return dealDate.slice(0, 7) >= CANCELLATION_COVERAGE_FROM ? 'PROVIDED' : 'NOT_PROVIDED_BY_SOURCE';
}

export interface TransactionDto {
  propertyType: PropertyType;
  masterId: string;
  masterMatchStatus: 'MATCHED';
  transactionType: TransactionType;
  dealDate: string;
  price: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  exclusiveArea: number;
  floor: number | null;
  /** 취소 여부. 원천이 취소를 제공하지 않는 구간(전월세 전체, 2020-01 이전 매매)은 false가 아니라 null. */
  canceled: boolean | null;
  cancelDate: string | null;
  cancellationCoverage: CancellationCoverage;
  /** 전월세만: '신규' | '갱신' | null. 갱신 계약을 신규 시세처럼 쓰지 않도록 싣는다. */
  contractType: string | null;
  sourceFetchedAt: string;
}

export function mapTransaction(
  raw: RawTx,
  ctx: { propertyType: PropertyType; masterId: string; transactionType: TransactionType },
): TransactionDto {
  const coverage = cancellationCoverageFor(ctx.transactionType, raw.dealDate);
  const isSale = ctx.transactionType === 'sale';
  const provided = coverage === 'PROVIDED';
  return {
    propertyType: ctx.propertyType,
    masterId: ctx.masterId,
    masterMatchStatus: 'MATCHED',
    transactionType: ctx.transactionType,
    dealDate: raw.dealDate,
    price: isSale ? raw.price : null,
    deposit: isSale ? null : raw.deposit,
    monthlyRent: isSale ? null : raw.monthlyRent,
    exclusiveArea: raw.exclusiveArea,
    floor: raw.floor,
    canceled: provided ? raw.dealCanceled === true : null,
    cancelDate: provided && raw.dealCanceled ? normalizeCancelDate(raw.cancelDateRaw) : null,
    cancellationCoverage: coverage,
    contractType: isSale ? null : raw.contractType,
    sourceFetchedAt: raw.sourceFetchedAt,
  };
}

// ------------------------------------------------------------------ verification (freshness + coverage)
// 두 질문을 분리한다:
//   freshnessStatus — "이 지역·데이터셋의 **최근** 수집이 정상인가"(최근 달의 sync 검증 시각). 조회 기간이나 거래 건수와 무관하다.
//   coverageStatus  — "요청한 **기간 전체**의 각 달이 sync로 검증됐는가". 과거 달에 개별 검증 셀이 없는 것은 최신성 실패가 아니다.
// 거래 0건이어도 최근 달 sync가 정상이면 freshnessStatus는 STALE이 되지 않는다.
export type FreshnessStatus = 'FRESH' | 'STALE' | 'UNVERIFIED';
export type CoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNVERIFIED';

/** cron이 매일/주간 다시 확인하는 "최근 달": 현재 월과 그 앞 두 달(KST). */
export const RECENT_MONTHS_COUNT = 3;

export function recentMonths(now: Date): string[] {
  const cur = kstMonth(now);
  return monthsBetween(addMonths(cur, -(RECENT_MONTHS_COUNT - 1)), cur);
}

export interface Verification {
  freshnessStatus: FreshnessStatus;
  coverageStatus: CoverageStatus;
  recent: { months: string[]; monthsVerified: number; oldestVerifiedAt: string | null; newestVerifiedAt: string | null };
  coverage: { monthsRequested: number; monthsVerified: number; unverifiedMonths: string[]; oldestVerifiedAt: string | null; newestVerifiedAt: string | null };
  /** 최근 달 중 가장 최근 검증이 이 시간 이내면 FRESH. */
  freshWithinHours: number;
}

const verifiedList = (months: string[], at: Record<string, string>): string[] =>
  months.map((m) => at[m]).filter((v): v is string => typeof v === 'string' && v !== '').sort();

/**
 * freshness: 최근 달 중 검증된 달이 하나도 없으면 UNVERIFIED, 그 중 **가장 최근** 검증이 FRESH_WITHIN_HOURS 이내면 FRESH, 아니면 STALE.
 *   "이 지역·데이터셋의 수집 파이프라인이 최근에도 돌았는가"를 본다. 아파트 전월세는 셀을 오래된 순으로 돌려가며 검증해 달마다 검증 시각이 크게 다르므로(실측 9/6~10/24),
 *   가장 오래된 달의 검증 나이로 판정하면 정상 파이프라인도 STALE로 보인다. 달별 나이는 recent.oldestVerifiedAt / coverage 필드로 그대로 노출한다.
 * coverage: 요청 기간의 모든 달이 검증되면 COMPLETE, 일부면 PARTIAL, 없으면 UNVERIFIED.
 */
export function computeVerification(windowMonths: string[], recent: string[], verifiedAtByMonth: Record<string, string>, now: Date): Verification {
  const rv = verifiedList(recent, verifiedAtByMonth);
  const cv = verifiedList(windowMonths, verifiedAtByMonth);
  let freshnessStatus: FreshnessStatus = 'UNVERIFIED';
  if (rv.length > 0) {
    const ageHours = (now.getTime() - new Date(rv[rv.length - 1]).getTime()) / 3600000;
    freshnessStatus = ageHours <= FRESH_WITHIN_HOURS ? 'FRESH' : 'STALE';
  }
  const coverageStatus: CoverageStatus = cv.length === 0 ? 'UNVERIFIED' : cv.length < windowMonths.length ? 'PARTIAL' : 'COMPLETE';
  return {
    freshnessStatus,
    coverageStatus,
    recent: { months: recent, monthsVerified: rv.length, oldestVerifiedAt: rv[0] ?? null, newestVerifiedAt: rv[rv.length - 1] ?? null },
    coverage: {
      monthsRequested: windowMonths.length,
      monthsVerified: cv.length,
      unverifiedMonths: windowMonths.filter((m) => !verifiedAtByMonth[m]),
      oldestVerifiedAt: cv[0] ?? null,
      newestVerifiedAt: cv[cv.length - 1] ?? null,
    },
    freshWithinHours: FRESH_WITHIN_HOURS,
  };
}

export type ResultState =
  | 'HAS_DATA'
  /** 요청 기간의 모든 달이 검증됐고(coverage COMPLETE) 조건에 맞는 거래가 없다 — 신뢰할 수 있는 0. */
  | 'NO_TRANSACTIONS_VERIFIED'
  /** 거래가 없지만 일부 또는 전체 달이 검증되지 않았다 — "없다"고 단정할 수 없다. */
  | 'NO_TRANSACTIONS_UNVERIFIED'
  /** 같은 주소에 거래는 있으나 어느 동의 것인지 확정되지 않아 이 건물에 귀속하지 않았다. */
  | 'UNATTRIBUTED_AT_ADDRESS';

export function resultStateFor(rowCount: number, v: Verification, unattributed: boolean): ResultState {
  if (unattributed) return 'UNATTRIBUTED_AT_ADDRESS';
  if (rowCount > 0) return 'HAS_DATA';
  return v.coverageStatus === 'COMPLETE' ? 'NO_TRANSACTIONS_VERIFIED' : 'NO_TRANSACTIONS_UNVERIFIED';
}

// ------------------------------------------------------------------ source metadata
// 표시 문구가 아니라 메타데이터다. 본문에 어떻게 쓸지는 SELLFLOW의 UX 정책이다.
export interface SourceInfo {
  name: string;
  dataset: string;
  provider: string;
  processedBy: string;
}

const PROVIDER = '공공데이터포털(data.go.kr)';
const PROCESSED_BY = '이집(E-JIP) 수집·가공';

export function transactionSource(propertyType: PropertyType, transactionType: TransactionType): SourceInfo {
  const apt = propertyType === 'apartment';
  const sale = transactionType === 'sale';
  return {
    name: '국토교통부 실거래가 공개자료',
    dataset: apt ? (sale ? '국토교통부_아파트 매매 실거래가 자료' : '국토교통부_아파트 전월세 실거래가 자료') : sale ? '국토교통부_오피스텔 매매 실거래가 자료' : '국토교통부_오피스텔 전월세 실거래가 자료',
    provider: PROVIDER,
    processedBy: PROCESSED_BY,
  };
}

export const BUILDING_SOURCE: SourceInfo = {
  name: '건축물대장',
  dataset: '국토교통부_건축HUB_건축물대장정보 서비스',
  provider: PROVIDER,
  processedBy: PROCESSED_BY,
};

// ------------------------------------------------------------------ content guidance (기계 판독용 조건 플래그)
export type GuidanceReason = 'NO_DATA' | 'NOT_MATCHED' | 'NOT_FRESH' | 'COVERAGE_NOT_COMPLETE' | 'LOW_SAMPLE' | 'MIXED_AREAS';

export interface ContentGuidance {
  /** "최근 확인된 거래에서는…" 같은 사실 서술에 쓸 수 있는가: 거래가 있고 + 최근 수집이 FRESH. */
  recentFactsAllowed: boolean;
  /** 기간 전체 추세/시세 서술(상승·하락 등)의 **필요조건**을 모두 만족하는가: 위 + coverage COMPLETE + 표본 SUFFICIENT + 단일 면적. 충분조건은 아니다. */
  periodTrendEligible: boolean;
  reasons: GuidanceReason[];
}

export function computeContentGuidance(input: { matched: boolean; sampleStatus: SampleStatus; distinctAreaCount: number; verification: Verification }): ContentGuidance {
  const reasons: GuidanceReason[] = [];
  if (!input.matched) reasons.push('NOT_MATCHED');
  if (input.sampleStatus === 'NO_DATA') reasons.push('NO_DATA');
  if (input.sampleStatus === 'LOW_SAMPLE') reasons.push('LOW_SAMPLE');
  if (input.verification.freshnessStatus !== 'FRESH') reasons.push('NOT_FRESH');
  if (input.verification.coverageStatus !== 'COMPLETE') reasons.push('COVERAGE_NOT_COMPLETE');
  if (input.distinctAreaCount > 1) reasons.push('MIXED_AREAS');
  const recentFactsAllowed = input.matched && input.sampleStatus !== 'NO_DATA' && input.verification.freshnessStatus === 'FRESH';
  return { recentFactsAllowed, periodTrendEligible: reasons.length === 0, reasons };
}

// ------------------------------------------------------------------ statistics
export type SampleStatus = 'SUFFICIENT' | 'LOW_SAMPLE' | 'NO_DATA';

export function sampleStatusFor(sampleCount: number): SampleStatus {
  if (sampleCount <= 0) return 'NO_DATA';
  return sampleCount >= MIN_SUFFICIENT_SAMPLE ? 'SUFFICIENT' : 'LOW_SAMPLE';
}

export interface MetricStats {
  min: number | null;
  max: number | null;
  /** SUFFICIENT일 때만. 표본이 적으면 null. 짝수 표본은 가운데 두 값의 평균이라 x.5가 나올 수 있다. */
  median: number | null;
}

export function computeMetricStats(values: number[]): MetricStats {
  if (values.length === 0) return { min: null, max: null, median: null };
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const median = s.length >= MIN_SUFFICIENT_SAMPLE ? (s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2) : null;
  return { min: s[0], max: s[s.length - 1], median };
}

/** 같은 (거래일·금액·면적·층)이 2행 이상인 행 수. 원천이 중복 신고인지 별개 계약인지 구분해 주지 않아 병합하지 않고, 가중치 왜곡 가능성을 알린다. */
export function countIdenticalSiblingRows(rows: RawTx[]): number {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.dealDate}|${r.price}|${r.deposit}|${r.monthlyRent}|${r.exclusiveArea}|${r.floor}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  let n = 0;
  for (const c of groups.values()) if (c > 1) n += c;
  return n;
}

export interface AreaGroupDto {
  /** 원본 전용면적(㎡). 반올림해서 합치지 않는다. */
  exclusiveArea: number;
  count: number;
  latestDealDate: string;
  sampleStatus: SampleStatus;
  /** 이 면적만의 통계. 전체 통계는 서로 다른 면적을 섞으므로 콘텐츠에는 면적별 값이나 minArea/maxArea 조건을 쓰는 편이 안전하다. */
  primaryMetric: MetricStats;
}

export interface SummaryStatistics {
  transactionType: TransactionType;
  primaryMetricName: 'price' | 'deposit';
  sampleCount: number;
  sampleStatus: SampleStatus;
  canceledIncluded: false;
  metrics: { price?: MetricStats; deposit?: MetricStats; monthlyRent?: MetricStats };
  latest: { dealDate: string; price: number | null; deposit: number | null; monthlyRent: number | null; exclusiveArea: number; floor: number | null } | null;
  /** 표본에 포함된 서로 다른 전용면적 수. 2 이상이면 전체 min/max/median은 면적이 섞인 값이다. */
  distinctAreaCount: number;
  byExclusiveArea: AreaGroupDto[];
  byExclusiveAreaTruncated: boolean;
  quality: {
    /** 매매: 포함 행 중 원천이 취소를 제공하지 않는 구간(2020-01 이전) 행 수. 이 행들의 비취소는 검증된 값이 아니다. 전월세는 취소 개념이 없어 null. */
    rowsWithoutCancellationCoverage: number | null;
    identicalSiblingRows: number;
    /** 매매에서 취소로 제외한 행 수. 전월세는 null(원천에 취소 개념 없음). */
    canceledExcludedCount: number | null;
  };
  calculationMethod: string;
}

export function buildSummaryStatistics(rows: RawTx[], transactionType: TransactionType, canceledExcludedCount: number | null): SummaryStatistics {
  const isSale = transactionType === 'sale';
  const primary: 'price' | 'deposit' = isSale ? 'price' : 'deposit';
  const pv = (r: RawTx): number | null => (isSale ? r.price : r.deposit);
  const sorted = [...rows].sort((a, b) => (a.dealDate === b.dealDate ? 0 : a.dealDate < b.dealDate ? 1 : -1));

  const metrics: SummaryStatistics['metrics'] = {};
  metrics[primary] = computeMetricStats(rows.map(pv).filter((v): v is number => typeof v === 'number'));
  if (transactionType === 'wolse') {
    metrics.monthlyRent = computeMetricStats(rows.map((r) => r.monthlyRent).filter((v): v is number => typeof v === 'number'));
  }

  const groups = new Map<number, RawTx[]>();
  for (const r of rows) {
    const g = groups.get(r.exclusiveArea);
    if (g) g.push(r);
    else groups.set(r.exclusiveArea, [r]);
  }
  const areaGroups: AreaGroupDto[] = [...groups.entries()]
    .map(([area, list]) => {
      const vals = list.map(pv).filter((v): v is number => typeof v === 'number');
      return {
        exclusiveArea: area,
        count: list.length,
        latestDealDate: list.reduce((m, r) => (r.dealDate > m ? r.dealDate : m), ''),
        sampleStatus: sampleStatusFor(list.length),
        primaryMetric: computeMetricStats(vals),
      };
    })
    .sort((a, b) => b.count - a.count || a.exclusiveArea - b.exclusiveArea);

  const top = sorted[0];
  const label = isSale ? '취소되지 않은 매매' : transactionType === 'jeonse' ? '전세' : '월세';
  return {
    transactionType,
    primaryMetricName: primary,
    sampleCount: rows.length,
    sampleStatus: sampleStatusFor(rows.length),
    canceledIncluded: false,
    metrics,
    latest: top
      ? { dealDate: top.dealDate, price: top.price, deposit: top.deposit, monthlyRent: top.monthlyRent, exclusiveArea: top.exclusiveArea, floor: top.floor }
      : null,
    distinctAreaCount: areaGroups.length,
    byExclusiveArea: areaGroups.slice(0, SUMMARY_MAX_AREA_GROUPS),
    byExclusiveAreaTruncated: areaGroups.length > SUMMARY_MAX_AREA_GROUPS,
    quality: {
      rowsWithoutCancellationCoverage: isSale ? rows.filter((r) => cancellationCoverageFor(transactionType, r.dealDate) === 'NOT_PROVIDED_BY_SOURCE').length : null,
      identicalSiblingRows: countIdenticalSiblingRows(rows),
      canceledExcludedCount: isSale ? canceledExcludedCount : null,
    },
    calculationMethod:
      `표본 = 조회 기간·면적 조건에 맞는 ${label} 거래 행 전부(행 1개 = 1건, 동일 내용 행도 병합하지 않음). ` +
      `금액 단위는 만원이며 반올림하지 않는다. median은 표본 ${MIN_SUFFICIENT_SAMPLE}건 이상일 때만 제공한다(짝수면 가운데 두 값의 평균). ` +
      '전용면적은 원본 ㎡ 값 그대로 묶으며 평형으로 환산하지 않는다.',
  };
}
