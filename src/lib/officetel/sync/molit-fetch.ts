// OFFICETEL_INCREMENTAL_SYNC_V1 — 오피스텔 매매/전월세 MOLIT 셀 fetcher.
//
// 왜 api-molit.ts의 fetchMolitData를 그대로 쓰지 않는가: 그 함수는 화면 표시용으로 항목을 가공해 돌려준다
// (cdealType·slerGbn·useRRRight 등 적재에 필요한 원본 필드가 사라지고, 오피스텔 전월세 endpoint도 없다).
// STEP 3A 스윕이 검증한 원본 행 형태를 그대로 받아야 STEP 3B가 적재한 행과 같은 자연키가 나온다.
// 같은 이유로 파서 설정(parseTagValue:false)·URL 규약·numOfRows=1000은 row-sweep과 동일하게 맞춘다.
//
// 아파트 sale-molit-fetch.ts의 안전장치는 그대로 따른다(새 규칙을 만들지 않는다):
//   - 요청 사이 최소 간격, rate-limit 지수 backoff
//   - run-deadline.ts: 실행 시간 한도를 요청 단위까지 내려보내 한도 전에 깨끗하게 멈춤
//   - molit-quota-guard.ts: 일일 한도 예약분(2,000)에 닿으면 요청을 보내지 않음
//
// 실패는 사유와 함께 분류해 돌려준다. 정상 0건(totalCount=0)과 실패는 결코 같은 값으로 표현하지 않는다.
import { XMLParser } from 'fast-xml-parser';
import { planRequestAttempt, type RequestDeadline } from '../../sync/run-deadline';
import { molitQuotaDecision, type QuotaObservation } from '../../sync/molit-quota-guard';
import type { OfficetelFailureReason, OfficetelSyncDataset, RawOfficetelRow } from './types';

export const OFFICETEL_ENDPOINTS: Record<OfficetelSyncDataset, string> = {
  OFFICETEL_SALE: 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade',
  OFFICETEL_RENT: 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent',
};
export const OFFICETEL_PAGE_SIZE = 1000;
export const OFFICETEL_MIN_INTERVAL_MS = 420;
export const OFFICETEL_MAX_ATTEMPTS = 4;

export interface HttpResponseLike {
  status: number;
  text: string;
  /** x-ratelimit-remaining 헤더 원문(없으면 null). */
  rateLimitRemaining: string | null;
}
export type HttpGet = (url: string, timeoutMs: number) => Promise<HttpResponseLike>;

export const defaultHttpGet: HttpGet = async (url, timeoutMs) => {
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, text: await res.text(), rateLimitRemaining: res.headers?.get?.('x-ratelimit-remaining') ?? null };
};

/** 마지막으로 관측한 일일 한도. 모듈 상태이므로 같은 인스턴스의 다음 셀에서 예약분 판정에 쓰인다. */
export const officetelQuotaObserved: QuotaObservation = { remaining: null, at: null };

/** 마지막 요청 시각(요청 사이 최소 간격 유지용). 모듈 상태. */
let lastRequestAt = 0;

export interface OfficetelFetchDeps {
  httpGet?: HttpGet;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 테스트 주입용. 없으면 DATA_GO_KR_API_KEY. 어떤 로그/에러에도 값이 실리지 않는다. */
  apiKey?: string;
  quota?: QuotaObservation;
  minIntervalMs?: number;
  deadline?: RequestDeadline;
}

export type OfficetelFetchOutcome =
  | { kind: 'OK'; totalCount: number; items: RawOfficetelRow[]; pages: number }
  | { kind: 'FAILED'; reason: OfficetelFailureReason; totalCount: number | null; fetchedCount: number }
  // 요청을 보내지 않고 멈췄다. 원천 판정이 아니므로 셀 상태로 기록하지 않는다(다음 실행이 재시도).
  | { kind: 'STOPPED'; stop: 'QUOTA_RESERVE_REACHED' | 'DEADLINE_REACHED' };

type PageResult =
  | { ok: true; totalCount: number; items: RawOfficetelRow[] }
  | { ok: false; reason: OfficetelFailureReason; retryable: boolean; stop?: 'QUOTA_RESERVE_REACHED' | 'DEADLINE_REACHED' };

const S = (v: unknown): string => String(v ?? '').trim();

function buildUrl(dataset: OfficetelSyncDataset, lawdCd: string, dealYmd: string, pageNo: number, apiKey: string): string {
  const key = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));
  return `${OFFICETEL_ENDPOINTS[dataset]}?serviceKey=${key}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${OFFICETEL_PAGE_SIZE}`;
}

/** 응답 본문 -> 페이지 결과. 순수 함수(테스트 대상). 키/URL은 받지 않는다. */
export function parseOfficetelPage(httpStatus: number, text: string): PageResult {
  if (httpStatus >= 500 || httpStatus === 429) return { ok: false, reason: 'API_ERROR', retryable: true };
  if (httpStatus >= 400) return { ok: false, reason: 'API_ERROR', retryable: false };
  if (!text.trim()) return { ok: false, reason: 'PARSE_ERROR', retryable: true };
  let o: any;
  try {
    o = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(text);
  } catch {
    return { ok: false, reason: 'PARSE_ERROR', retryable: true };
  }
  const svc = o?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (svc) {
    const msg = `${S(svc.returnAuthMsg)} ${S(svc.errMsg)}`;
    const code = S(svc.returnReasonCode);
    // 초당 요청 제한은 잠시 뒤 재시도하면 풀린다. 일일 한도 초과(22)는 오늘은 풀리지 않는다.
    if (msg.includes('초당 서비스 요청제한')) return { ok: false, reason: 'API_ERROR', retryable: true };
    if (code === '22' || msg.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS')) return { ok: false, reason: 'QUOTA', retryable: false };
    return { ok: false, reason: 'API_ERROR', retryable: false };
  }
  const header = o?.response?.header;
  if (!header) return { ok: false, reason: 'PARSE_ERROR', retryable: true };
  const rc = S(header.resultCode);
  if (rc !== '00' && rc !== '000' && rc !== '0') return { ok: false, reason: 'API_ERROR', retryable: false };
  const body = o?.response?.body;
  const tcRaw = body?.totalCount;
  const totalCount = tcRaw != null && S(tcRaw) !== '' && Number.isFinite(Number(S(tcRaw))) ? Number(S(tcRaw)) : null;
  // totalCount를 못 읽으면 "0건"이라고 말하지 않는다 — 모르는 것은 모르는 것이다.
  if (totalCount === null) return { ok: false, reason: 'PARSE_ERROR', retryable: true };
  const raw = body?.items?.item;
  const items: RawOfficetelRow[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  // 건수가 있다고 하면서 항목이 없으면 응답이 깨진 것이다(정상 0건이 아니다).
  if (totalCount > 0 && items.length === 0) return { ok: false, reason: 'PARSE_ERROR', retryable: true };
  return { ok: true, totalCount, items };
}

function failureReasonOfThrown(e: unknown): OfficetelFailureReason {
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'API_ERROR';
}

export async function fetchOfficetelCell(
  dataset: OfficetelSyncDataset,
  lawdCd: string,
  dealYmd: string,
  deps: OfficetelFetchDeps = {}
): Promise<OfficetelFetchOutcome> {
  const httpGet = deps.httpGet ?? defaultHttpGet;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const quota = deps.quota ?? officetelQuotaObserved;
  const minInterval = deps.minIntervalMs ?? OFFICETEL_MIN_INTERVAL_MS;
  const apiKey = deps.apiKey ?? process.env.DATA_GO_KR_API_KEY ?? '';

  const onePage = async (pageNo: number): Promise<PageResult> => {
    if (!apiKey) return { ok: false, reason: 'API_ERROR', retryable: false };
    if (!molitQuotaDecision(quota, now()).proceed) return { ok: false, reason: 'QUOTA', retryable: false, stop: 'QUOTA_RESERVE_REACHED' };
    const wait = Math.max(0, minInterval - (now() - lastRequestAt));
    const plan = planRequestAttempt(deps.deadline, wait);
    if (!plan.ok) return { ok: false, reason: 'TIMEOUT', retryable: false, stop: 'DEADLINE_REACHED' };
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    try {
      const res = await httpGet(buildUrl(dataset, lawdCd, dealYmd, pageNo, apiKey), plan.timeoutMs);
      const h = res.rateLimitRemaining;
      if (h != null && h !== '' && Number.isFinite(Number(h))) {
        quota.remaining = Number(h);
        quota.at = now();
      }
      return parseOfficetelPage(res.status, res.text);
    } catch (e) {
      return { ok: false, reason: failureReasonOfThrown(e), retryable: true };
    }
  };

  const pageWithRetry = async (pageNo: number): Promise<PageResult> => {
    let last: PageResult = { ok: false, reason: 'API_ERROR', retryable: false };
    for (let attempt = 0; attempt < OFFICETEL_MAX_ATTEMPTS; attempt++) {
      last = await onePage(pageNo);
      if (last.ok || last.stop || !last.retryable) return last;
      if (attempt === OFFICETEL_MAX_ATTEMPTS - 1) break;
      const backoff = 500 * (attempt + 1) * (last.reason === 'API_ERROR' ? 2 : 1);
      // backoff로 잠든 뒤 시도할 시간이 없다면 잠들지 않는다.
      if (!planRequestAttempt(deps.deadline, backoff).ok) return { ok: false, reason: 'TIMEOUT', retryable: false, stop: 'DEADLINE_REACHED' };
      await sleep(backoff);
    }
    return last;
  };

  const first = await pageWithRetry(1);
  if (!first.ok) {
    if (first.stop) return { kind: 'STOPPED', stop: first.stop };
    return { kind: 'FAILED', reason: first.reason, totalCount: null, fetchedCount: 0 };
  }

  let items = first.items;
  const totalPages = Math.max(1, Math.ceil(first.totalCount / OFFICETEL_PAGE_SIZE));
  let pages = 1;
  for (let p = 2; p <= totalPages; p++) {
    const res = await pageWithRetry(p);
    if (!res.ok) {
      if (res.stop) return { kind: 'STOPPED', stop: res.stop };
      // 일부 페이지만 받은 셀은 완전하지 않다. 받은 만큼을 "전부"로 취급하지 않는다.
      return { kind: 'FAILED', reason: res.reason === 'QUOTA' ? 'QUOTA' : 'PARTIAL_PAGINATION', totalCount: first.totalCount, fetchedCount: items.length };
    }
    items = items.concat(res.items);
    pages++;
  }
  if (items.length !== first.totalCount) {
    return { kind: 'FAILED', reason: 'PARTIAL_PAGINATION', totalCount: first.totalCount, fetchedCount: items.length };
  }
  return { kind: 'OK', totalCount: first.totalCount, items, pages };
}
