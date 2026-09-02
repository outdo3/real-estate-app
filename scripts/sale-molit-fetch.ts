// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §2/§3 — RTMSDataSvcAptTradeDev(매매) 전용
// pagination-aware fetcher. 왜 src/lib/api-molit.ts의 fetchMolitData()를 그대로
// 대량 sync에 계속 쓰지 않는가: 그 함수는 pageNo=1(numOfRows=1000) 고정이라
// totalCount를 검증하지 않는다 — Phase 1 감사에서 실제 production 데이터로 증명됨
// (apartment_trade_histories에 정확히 1,000행인 (lawdCd, dealYmd) 셀 23개 발견,
// 전부 numOfRows 상한과 정확히 일치 — 조용한 truncation의 직접 증거).
//
// fetchMolitData() 자체는 수정하지 않는다 — 그 함수는 검색/상세/대시보드 등 "최근
// 몇 건이면 충분한" 라이브 사용자 요청 경로에서도 광범위하게 쓰이며, 그 경로들은
// 페이지네이션이 필요 없다(회귀 위험을 만들 이유가 없음). 대신 항목 매핑 로직만
// (mapMolitItems, api-molit.ts) 재사용해 이 fetcher의 출력이 fetchMolitData()의
// 출력과 완전히 동일한 shape을 갖도록 보장한다 — trade-history-logic.ts의
// normalizeMolitItemsToTradeRows()가 두 경로 모두에서 변경 없이 그대로 동작한다.
//
// rent-molit-fetch.ts와 동일한 pagination/retry 골격을 재사용(재발명 금지) — 동시 1,
// 최소 간격 350ms, 스로틀 감지 시 지수 백오프.
import { XMLParser } from 'fast-xml-parser';
import { mapMolitItems } from '../src/lib/api-molit';
import { classifySaleCellCompleteness, type SaleCellStatus } from './sale-pagination-logic';

const ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const PAGE_SIZE = 1000; // 기존 api-molit.ts와 동일한 관행값

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIN_INTERVAL_MS = 350;
let lastFetchAt = 0;

function buildUrl(lawdCd: string, dealYmd: string, pageNo: number): string {
  const API_KEY = process.env.DATA_GO_KR_API_KEY;
  if (!API_KEY) throw new Error('DATA_GO_KR_API_KEY is not defined in environment variables.');
  const cleanKey = API_KEY.trim().replace(/['"]/g, '');
  const decodedKey = decodeURIComponent(cleanKey);
  const finalKey = encodeURIComponent(decodedKey);
  return `${ENDPOINT}?serviceKey=${finalKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`;
}

interface RawPageResult {
  ok: boolean;
  rawItems: any[];
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
      return { ok: false, rawItems: [], totalCount: null, rateLimited: authMsg.includes('초당 서비스 요청제한') };
    }

    const header = jsonObj.response?.header;
    const resultCode = header?.resultCode;
    if (resultCode !== '00' && resultCode !== 0) {
      return { ok: false, rawItems: [], totalCount: null, rateLimited: false };
    }

    const totalCountRaw = jsonObj.response?.body?.totalCount;
    const totalCount = totalCountRaw != null && Number.isFinite(Number(totalCountRaw)) ? Number(totalCountRaw) : null;
    if (totalCount === null) return { ok: false, rawItems: [], totalCount: null, rateLimited: false };

    const rawItems = jsonObj.response?.body?.items?.item;
    const itemsArray: any[] = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
    return { ok: true, rawItems: itemsArray, totalCount, rateLimited: false };
  } catch {
    return { ok: false, rawItems: [], totalCount: null, rateLimited: false };
  }
}

async function fetchOnePageWithRetry(lawdCd: string, dealYmd: string, pageNo: number): Promise<RawPageResult> {
  let last: RawPageResult = { ok: false, rawItems: [], totalCount: null, rateLimited: false };
  for (let attempt = 0; attempt <= 5; attempt++) {
    last = await fetchOnePage(lawdCd, dealYmd, pageNo);
    if (last.ok) return last;
    if (attempt === 5) break;
    const backoffMs = last.rateLimited ? Math.min(2000 * (attempt + 1), 10000) : 500 * (attempt + 1);
    await sleep(backoffMs);
  }
  return last;
}

export interface SaleRegionMonthResult {
  items: any[]; // fetchMolitData()와 동일 shape(mapMolitItems 결과)
  status: SaleCellStatus;
  totalCount: number | null;
  collectedCount: number;
  pagesFetched: number;
}

/**
 * §3 — pageNo/numOfRows/totalCount를 실제로 검증하며 필요한 만큼 모든 페이지를
 * 읽는다(한 page만 읽고 COMPLETE로 판정하지 않는다). 어느 한 페이지라도 재시도 소진
 * 후 실패하면 PARTIAL로 분류하고, 호출부(sale-molit-fetch 소비자)는 PARTIAL을 절대
 * COMPLETE로 취급하지 않아야 한다.
 */
export async function fetchSaleRegionMonth(lawdCd: string, dealYmd: string): Promise<SaleRegionMonthResult> {
  const first = await fetchOnePageWithRetry(lawdCd, dealYmd, 1);
  if (!first.ok || first.totalCount === null) {
    return {
      items: [],
      status: classifySaleCellCompleteness({ firstPageFailed: true, totalCount: null, collectedCount: 0, anyLaterPageFailed: false }),
      totalCount: null,
      collectedCount: 0,
      pagesFetched: 0,
    };
  }

  let rawItems = [...first.rawItems];
  let anyLaterPageFailed = false;
  const totalPages = Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE));
  let pagesFetched = 1;

  for (let page = 2; page <= totalPages; page++) {
    const res = await fetchOnePageWithRetry(lawdCd, dealYmd, page);
    if (!res.ok) {
      anyLaterPageFailed = true;
      break;
    }
    rawItems = rawItems.concat(res.rawItems);
    pagesFetched++;
  }

  const status = classifySaleCellCompleteness({
    firstPageFailed: false,
    totalCount: first.totalCount,
    collectedCount: rawItems.length,
    anyLaterPageFailed,
  });

  // mapMolitItems()를 그대로 재사용 — fetchMolitData()가 만드는 shape과 완전히 동일한
  // 값을 만들어, 이 결과를 소비하는 normalizeMolitItemsToTradeRows()가 두 경로 어느
  // 쪽에서 와도 변경 없이 그대로 동작한다.
  const items = mapMolitItems(rawItems, 'apt', lawdCd, dealYmd);

  return { items, status, totalCount: first.totalCount, collectedCount: rawItems.length, pagesFetched };
}
