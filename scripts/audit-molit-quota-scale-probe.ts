/**
 * MOLIT_QUOTA_SCALE_PROBE_V1 — 서울/경기 확장 전 MOLIT API paging·규모·quota probe.
 *
 * STRICT READ ONLY:
 *   - Production DB write 0. 이 스크립트는 DB를 전혀 열지 않는다(로그 감사는 별도 스크립트).
 *   - MOLIT outbound는 GET(조회)만. 공공데이터 실거래 조회 API는 read-only endpoint다.
 *   - 의도적 throttle 유발 금지: 순차(동시 1) + 최소 간격 400ms + 재시도 없음.
 *     429/제한 응답을 "유도"하지 않고, 오면 그 자리에서 중단(STOP RULE)한다.
 *   - totalCount만 필요한 probe는 numOfRows=1로 호출해 페이로드/서버 부담을 최소화한다.
 *   - serviceKey는 출력/로그에 절대 나가지 않는다(URL 자체를 찍지 않는다).
 *
 * 실행:
 *   npx tsx scripts/audit-molit-quota-scale-probe.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';

const SALE_ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
const RENT_ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

/** §3 probe 대상. 코드는 이전 audit(§2)이 법정동코드 프록시로 확인한 값. */
const TARGETS = [
  { region: 'SEOUL', name: '강남구', lawdCd: '11680' },
  { region: 'SEOUL', name: '송파구', lawdCd: '11710' },
  { region: 'SEOUL', name: '마포구', lawdCd: '11440' },
  { region: 'GYEONGGI', name: '성남시 분당구', lawdCd: '41135' },
  { region: 'GYEONGGI', name: '수원시 영통구', lawdCd: '41117' },
  { region: 'GYEONGGI', name: '고양시 일산서구', lawdCd: '41287' },
  { region: 'GYEONGGI', name: '김포시', lawdCd: '41570' },
  { region: 'BUSAN', name: '서구', lawdCd: '26140' },
  { region: 'BUSAN', name: '해운대구', lawdCd: '26350' },
  { region: 'BUSAN', name: '연제구', lawdCd: '26470' },
] as const;

/** 최근 완료월 + 거래량이 많은 봄 성수기월. */
const MONTHS = ['202608', '202603'] as const;

/** 관측하고 싶은 rate-limit / quota 관련 응답 헤더 후보. */
const HEADER_KEYS = [
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset',
  'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset',
  'retry-after', 'x-quota-limit', 'x-quota-remaining',
  'server', 'content-type', 'cache-control', 'date',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_INTERVAL_MS = 400;
let lastAt = 0;

function key(): string {
  const raw = process.env.DATA_GO_KR_API_KEY;
  if (!raw) throw new Error('DATA_GO_KR_API_KEY is not defined in environment variables.');
  return encodeURIComponent(decodeURIComponent(raw.trim().replace(/['"]/g, '')));
}

interface Probe {
  ok: boolean;
  httpStatus: number | null;
  resultCode: string | null;
  resultMsg: string | null;
  totalCount: number | null;
  numOfRowsEcho: number | null;
  pageNoEcho: number | null;
  itemCount: number | null;
  latencyMs: number;
  bytes: number | null;
  headers: Record<string, string>;
  rateLimited: boolean;
  authError: boolean;
  error: string | null;
}

/** 한 번의 GET. 재시도 없음 — 실패는 실패로 기록한다(제한을 밀어붙이지 않는다). */
async function probe(endpoint: string, lawdCd: string, dealYmd: string, pageNo: number, numOfRows: number): Promise<Probe> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastAt));
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();

  const url = `${endpoint}?serviceKey=${key()}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=${pageNo}&numOfRows=${numOfRows}`;
  const started = Date.now();
  const base: Probe = {
    ok: false, httpStatus: null, resultCode: null, resultMsg: null, totalCount: null,
    numOfRowsEcho: null, pageNoEcho: null, itemCount: null, latencyMs: 0, bytes: null,
    headers: {}, rateLimited: false, authError: false, error: null,
  };

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    const text = await res.text();
    const latencyMs = Date.now() - started;

    const headers: Record<string, string> = {};
    for (const k of HEADER_KEYS) {
      const v = res.headers.get(k);
      if (v != null) headers[k] = v;
    }

    const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
    const j = parser.parse(text);

    // data.go.kr 게이트웨이 레벨 오류(인증/제한/미등록 등)는 OpenAPI_ServiceResponse로 온다.
    const gwMsg = j.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gwMsg?.errMsg) {
      const authMsg = String(gwMsg.returnAuthMsg ?? '');
      const reasonCode = String(gwMsg.returnReasonCode ?? '');
      return {
        ...base, httpStatus: res.status, latencyMs, bytes: text.length, headers,
        resultCode: reasonCode || null,
        resultMsg: `${gwMsg.errMsg} / ${authMsg}`,
        rateLimited: /초당\s*서비스\s*요청\s*제한|LIMITED_NUMBER_OF_SERVICE_REQUESTS|PER_SECOND/i.test(authMsg + reasonCode),
        authError: /SERVICE_KEY|서비스키|인증|ACCESS_DENIED|DEADLINE/i.test(authMsg),
        error: 'gateway',
      };
    }

    const header = j.response?.header;
    const body = j.response?.body;
    const resultCode = header?.resultCode != null ? String(header.resultCode) : null;
    const resultMsg = header?.resultMsg != null ? String(header.resultMsg) : null;
    const totalRaw = body?.totalCount;
    const totalCount = totalRaw != null && Number.isFinite(Number(totalRaw)) ? Number(totalRaw) : null;
    const rawItems = body?.items?.item;
    const itemCount = rawItems ? (Array.isArray(rawItems) ? rawItems.length : 1) : 0;

    const normalized = resultCode === '00' || resultCode === '0';
    return {
      ok: normalized && totalCount !== null,
      httpStatus: res.status,
      resultCode,
      resultMsg,
      totalCount,
      numOfRowsEcho: body?.numOfRows != null ? Number(body.numOfRows) : null,
      pageNoEcho: body?.pageNo != null ? Number(body.pageNo) : null,
      itemCount,
      latencyMs,
      bytes: text.length,
      headers,
      rateLimited: /제한|LIMIT/i.test(resultMsg ?? ''),
      authError: false,
      error: normalized ? null : `resultCode=${resultCode}`,
    };
  } catch (e: any) {
    // 메시지에 URL(=serviceKey)이 섞여 들어올 수 있으므로 반드시 마스킹한다.
    const msg = String(e?.message ?? e)
      .replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')
      .replace(/https?:\/\/\S+/gi, '[redacted-url]');
    return { ...base, latencyMs: Date.now() - started, error: msg };
  }
}

/** 제한/인증 신호가 오면 즉시 멈춘다(STOP RULE §24). */
function mustStop(p: Probe): string | null {
  if (p.rateLimited) return 'RATE_LIMIT_SIGNAL';
  if (p.authError) return 'AUTH_SIGNAL';
  if (p.httpStatus === 429) return 'HTTP_429';
  return null;
}

async function main() {
  const out: any = {
    probeStartedAt: new Date().toISOString(),
    months: MONTHS,
    note: 'READ ONLY. totalCount probes use numOfRows=1. No retry, no burst, no DB access.',
    sale: [] as any[],
    rent: [] as any[],
    pageSizeTest: [] as any[],
    stopped: null as string | null,
    requestsIssued: 0,
  };

  let stop: string | null = null;

  // §4/§5 — sale·rent totalCount (numOfRows=1: totalCount만 필요)
  for (const dataset of ['sale', 'rent'] as const) {
    const endpoint = dataset === 'sale' ? SALE_ENDPOINT : RENT_ENDPOINT;
    for (const t of TARGETS) {
      for (const dealYmd of MONTHS) {
        if (stop) break;
        const p = await probe(endpoint, t.lawdCd, dealYmd, 1, 1);
        out.requestsIssued++;
        out[dataset].push({
          region: t.region, name: t.name, lawdCd: t.lawdCd, dealYmd,
          totalCount: p.totalCount,
          pagesAt1000: p.totalCount != null ? Math.max(1, Math.ceil(p.totalCount / 1000)) : null,
          exceeds1000: p.totalCount != null ? p.totalCount > 1000 : null,
          httpStatus: p.httpStatus, resultCode: p.resultCode, resultMsg: p.resultMsg,
          numOfRowsEcho: p.numOfRowsEcho, pageNoEcho: p.pageNoEcho, itemCount: p.itemCount,
          latencyMs: p.latencyMs, bytes: p.bytes, headers: p.headers, error: p.error,
        });
        stop = mustStop(p);
      }
      if (stop) break;
    }
    if (stop) break;
  }
  out.stopped = stop;

  // §6 — page size 비교. 거래량이 가장 많을 것으로 보이는 셀 하나에서만,
  //       numOfRows=100 / 1000 이 실제로 몇 건을 돌려주는지(= 서버가 상한을 어떻게 다루는지) 확인.
  if (!stop) {
    const best = [...out.sale]
      .filter((r: any) => r.totalCount != null)
      .sort((a: any, b: any) => (b.totalCount ?? 0) - (a.totalCount ?? 0))[0];
    if (best) {
      for (const n of [100, 1000]) {
        const p = await probe(SALE_ENDPOINT, best.lawdCd, best.dealYmd, 1, n);
        out.requestsIssued++;
        out.pageSizeTest.push({
          lawdCd: best.lawdCd, dealYmd: best.dealYmd, requestedNumOfRows: n,
          totalCount: p.totalCount, itemCount: p.itemCount, numOfRowsEcho: p.numOfRowsEcho,
          latencyMs: p.latencyMs, bytes: p.bytes, resultCode: p.resultCode, error: p.error,
        });
        const s = mustStop(p);
        if (s) { out.stopped = s; break; }
      }
    }

    // 페이징이 실제로 동작하는지 마지막 페이지로 확인한다. 1페이지를 넘는 셀은
    // 실측상 rent 쪽에만 있으므로(sale 최대 577), rent 최대 셀에서 검증한다.
    const bigRent = [...out.rent]
      .filter((r: any) => r.totalCount != null && r.totalCount > 1000)
      .sort((a: any, b: any) => (b.totalCount ?? 0) - (a.totalCount ?? 0))[0];
    if (!out.stopped && bigRent) {
      const lastPage = Math.ceil(bigRent.totalCount / 1000);
      const expectedOnLastPage = bigRent.totalCount - (lastPage - 1) * 1000;
      const p = await probe(RENT_ENDPOINT, bigRent.lawdCd, bigRent.dealYmd, lastPage, 1000);
      out.requestsIssued++;
      out.pageSizeTest.push({
        dataset: 'rent', lawdCd: bigRent.lawdCd, dealYmd: bigRent.dealYmd,
        requestedNumOfRows: 1000, pageNo: lastPage,
        totalCount: p.totalCount, itemCount: p.itemCount, expectedOnLastPage,
        pagingWorks: p.itemCount === expectedOnLastPage,
        pageNoEcho: p.pageNoEcho, latencyMs: p.latencyMs, bytes: p.bytes,
        resultCode: p.resultCode, error: p.error,
        purpose: 'last-page pagination verification',
      });
    }
  }

  out.probeEndedAt = new Date().toISOString();
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]'));
  process.exit(1);
});
