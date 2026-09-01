// RENT_TRADE_HISTORY_V1 PHASE B — RTMSDataSvcAptRent 전용 raw fetcher(네트워크 I/O,
// 페이지네이션, 재시도). src/lib/api-molit.ts의 fetchMolitData()를 재사용하지 않는
// 이유(§25/§26 of task spec): (1) fetchMolitData는 rent 응답을 이미 손실 매핑해
// contractType/contractTerm/preDeposit/preMonthlyRent/useRRRight를 완전히 버리고,
// rent에 존재하지도 않는 취소 필드를 parseCancellationFields()로 잘못 채운다(항상
// dealCanceled=false — PHASE A §7 확인) — 새 DB에 그 오염된 semantics를 들여오지 않기
// 위해 raw 응답을 직접 파싱한다. (2) fetchMolitData는 pageNo=1(numOfRows=1000) 고정이라
// totalCount를 검증하지 않는다 — 대량 backfill 대상 구(예: 부산진구, PHASE A 실측
// 868건/월)가 향후 numOfRows를 넘길 가능성에 안전하려면 실제 pagination이 필요하다.
//
// 기존 live consumer(src/lib/api-molit.ts, 대시보드/상세/전세위험/갭투자/AI검색)는
// 이 파일과 무관하게 그대로 동작한다(§63 — 기존 rent consumer 동작 변경 금지).
import { XMLParser } from 'fast-xml-parser';
import type { RawMolitRentItem } from './rent-history-logic';
import { classifyRentCellCompleteness, type RentCellStatus } from './rent-completeness-logic';

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';
const PAGE_SIZE = 1000; // 기존 api-molit.ts와 동일한 관행값

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// backfill-trade-history.ts §RATE LIMIT 실측 근거를 그대로 따른다 — 대량 sync는 실
// throttle을 유발하므로 라이브 트래픽용 GLOBAL_MOLIT_CONCURRENCY(동시 6)가 아니라
// 훨씬 보수적인 순차 fetcher(동시 1, 최소 간격, 지수 백오프)를 쓴다(§30/§51/§52 재사용
// 권고 + 이미 검증된 상수 재사용).
const MIN_INTERVAL_MS = 350;
let lastFetchAt = 0;

function buildUrl(lawdCd: string, dealYmd: string, pageNo: number): string {
  const API_KEY = process.env.DATA_GO_KR_API_KEY;
  if (!API_KEY) throw new Error('DATA_GO_KR_API_KEY is not defined in environment variables.');
  // src/lib/api-molit.ts와 동일한 encoding 방어(서비스키가 이미 encoded/decoded 어느
  // 쪽으로 .env에 저장돼 있어도 안전하게 동작).
  const cleanKey = API_KEY.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  return `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`;
}

interface RawPageResult {
  ok: boolean;
  items: RawMolitRentItem[];
  totalCount: number | null;
  rateLimited: boolean;
}

async function fetchOnePage(lawdCd: string, dealYmd: string, pageNo: number): Promise<RawPageResult> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastFetchAt));
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();

  try {
    const url = buildUrl(lawdCd, dealYmd, pageNo);
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(10000),
    });
    const textData = await response.text();
    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const jsonObj = parser.parse(textData);

    const errMsg = jsonObj.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg;
    if (errMsg) {
      const authMsg = String(jsonObj.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg || '');
      return { ok: false, items: [], totalCount: null, rateLimited: authMsg.includes('초당 서비스 요청제한') };
    }

    const header = jsonObj.response?.header;
    const resultCode = header?.resultCode;
    if (resultCode !== '00' && resultCode !== 0) {
      return { ok: false, items: [], totalCount: null, rateLimited: false };
    }

    const totalCountRaw = jsonObj.response?.body?.totalCount;
    const totalCount = totalCountRaw != null && Number.isFinite(Number(totalCountRaw)) ? Number(totalCountRaw) : null;
    if (totalCount === null) return { ok: false, items: [], totalCount: null, rateLimited: false };

    const rawItems = jsonObj.response?.body?.items?.item;
    const itemsArray: RawMolitRentItem[] = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
    return { ok: true, items: itemsArray, totalCount, rateLimited: false };
  } catch {
    return { ok: false, items: [], totalCount: null, rateLimited: false };
  }
}

async function fetchOnePageWithRetry(lawdCd: string, dealYmd: string, pageNo: number): Promise<RawPageResult> {
  let last: RawPageResult = { ok: false, items: [], totalCount: null, rateLimited: false };
  for (let attempt = 0; attempt <= 5; attempt++) {
    last = await fetchOnePage(lawdCd, dealYmd, pageNo);
    if (last.ok) return last;
    if (attempt === 5) break;
    const backoffMs = last.rateLimited ? Math.min(2000 * (attempt + 1), 10000) : 500 * (attempt + 1);
    await sleep(backoffMs);
  }
  return last;
}

export interface RentRegionMonthResult {
  items: RawMolitRentItem[];
  status: RentCellStatus;
  totalCount: number | null;
  collectedCount: number;
  pagesFetched: number;
}

/**
 * §31 — pageNo/numOfRows/totalCount를 실제로 검증하며 필요한 만큼 모든 페이지를
 * 읽는다(한 page만 읽고 COMPLETE로 판정 금지). §32 — 페이지별 재시도, 재시도 소진 후
 * 실패한 지역-월은 0건이 아니라 PARTIAL/INVALID로 명확히 남긴다.
 */
export async function fetchRentRegionMonth(lawdCd: string, dealYmd: string): Promise<RentRegionMonthResult> {
  const first = await fetchOnePageWithRetry(lawdCd, dealYmd, 1);
  if (!first.ok || first.totalCount === null) {
    return {
      items: [],
      status: classifyRentCellCompleteness({ firstPageFailed: true, totalCount: null, collectedCount: 0, anyLaterPageFailed: false }),
      totalCount: null,
      collectedCount: 0,
      pagesFetched: 0,
    };
  }

  let items = [...first.items];
  let anyLaterPageFailed = false;
  const totalPages = Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE));
  let pagesFetched = 1;

  for (let page = 2; page <= totalPages; page++) {
    const res = await fetchOnePageWithRetry(lawdCd, dealYmd, page);
    if (!res.ok) {
      anyLaterPageFailed = true;
      break;
    }
    items = items.concat(res.items);
    pagesFetched++;
  }

  const status = classifyRentCellCompleteness({
    firstPageFailed: false,
    totalCount: first.totalCount,
    collectedCount: items.length,
    anyLaterPageFailed,
  });

  return { items, status, totalCount: first.totalCount, collectedCount: items.length, pagesFetched };
}
