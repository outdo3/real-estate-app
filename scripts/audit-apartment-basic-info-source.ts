/**
 * APARTMENT_OFFICIAL_BASIC_INFO_SOURCE_AUDIT_V1 — read-only probe for the
 * "국토교통부_공동주택 기본 정보제공 서비스" and its companion
 * "국토교통부_공동주택 단지 목록제공 서비스". No DB access, no write of any
 * kind — pure external HTTP GET.
 *
 * OFFICIAL End Point base URLs (confirmed 2026-08-31 by the user directly from
 * their logged-in data.go.kr 활용신청 상세 screen — this is the source of truth,
 * not a guess):
 *   목록:   https://apis.data.go.kr/1613000/AptListService4
 *   기본정보: https://apis.data.go.kr/1613000/AptBasisInfoServiceV5
 *
 * CONFIRMED WORKING (2026-08-31, live, resultCode=00):
 *   AptBasisInfoServiceV5.getAphusBassInfoV5?kaptCode=<code> — real sample
 *   response envelope is `response.body.item`(singular object, NOT the older
 *   `response.body.items.item` array wrapper this project's other data.go.kr
 *   clients use for list-style responses) when queried by a single kaptCode.
 *   No latitude/longitude field anywhere in the real response — confirmed
 *   empirically, not assumed from docs.
 *
 * STILL UNRESOLVED: the exact operation name for AptListService4. 20 candidate
 * operation names were tried (see LIST_OPERATION_CANDIDATES) spanning every
 * naming convention observed elsewhere in this API family (Apt vs legacy
 * "Aphus" root, V4 suffix vs none, sigungu/legaldong/sido/roadnm/emd/umd/bjdong
 * region scoping, sigunguCode vs sigunguCd param casing) — all 20 return
 * NO_OPENAPI_SERVICE_ERROR. The base path itself is confirmed correct (per the
 * user's screen) and the key/approval are confirmed fine (the basic-info call
 * and the BldRgstHubService control call both succeed with the same key in the
 * same run) — only the operation name remains unknown. Do not keep guessing
 * further combinations; get the exact operation name from the same kind of
 * authenticated data.go.kr screen the base URLs came from, then add it to
 * LIST_OPERATION_CANDIDATES and re-run.
 *
 * Reuses the project's existing DATA_GO_KR_API_KEY (same key already used by
 * src/lib/api-molit.ts and src/lib/apt-building-info.ts against the same
 * apis.data.go.kr/1613000 group) and the same key-sanitization pattern those
 * files use. No new API client abstraction — this stays a throwaway diagnostic
 * script until the list-service operation is confirmed and real end-to-end
 * crosswalk work begins.
 *
 * Usage: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-apartment-basic-info-source.ts [kaptCode]
 *   kaptCode (optional) — look up a specific complex via the confirmed-working
 *   basic-info operation (e.g. a code found through the K-apt website UI once
 *   the list-service operation is still unresolved). Defaults to a publicly
 *   documented example code used only to prove the response shape.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const RAW_KEY = process.env.DATA_GO_KR_API_KEY || '';
const CLEAN_KEY = RAW_KEY ? encodeURIComponent(decodeURIComponent(RAW_KEY.trim().replace(/['"]/g, ''))) : '';

console.log(`API_KEY_CONFIGURED=${RAW_KEY.length > 0}`);

interface ProbeResult {
  label: string;
  httpStatus: number | null;
  gatewayError: string | null;
  resultCode: string | null;
  resultMsg: string | null;
  itemCount: number;
  fields: string[] | null;
  fetchError: string | null;
}

async function callOnce(label: string, url: string): Promise<ProbeResult> {
  console.log(`\n=== ${label} ===`);
  const result: ProbeResult = {
    label,
    httpStatus: null,
    gatewayError: null,
    resultCode: null,
    resultMsg: null,
    itemCount: 0,
    fields: null,
    fetchError: null,
  };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    result.httpStatus = res.status;
    console.log('HTTP status:', res.status);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON — fall through to raw-text logging below
    }

    if (!parsed) {
      console.log('non-JSON response (first 500 chars):', text.slice(0, 500));
      return result;
    }

    const errMsg = (parsed as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } } })
      .OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (errMsg) {
      result.gatewayError = `${errMsg.errMsg} - ${errMsg.returnAuthMsg}`;
      console.log('GATEWAY ERROR:', result.gatewayError);
      return result;
    }

    const response = (parsed as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; item?: unknown; items?: { item?: unknown } } } }).response;
    result.resultCode = response?.header?.resultCode ?? null;
    result.resultMsg = response?.header?.resultMsg ?? null;
    console.log('resultCode:', result.resultCode, 'resultMsg:', result.resultMsg);

    // 실제 서버 응답 shape은 두 가지 다 관찰됐다 — kaptCode 단건 조회는
    // response.body.item(단일 객체), 목록류 조회는 response.body.items.item(배열).
    // 과거 필드명/shape을 그대로 있다고 가정하지 않는다(§7 원칙) — 둘 다 처리.
    const single = response?.body?.item;
    const listItems = response?.body?.items?.item;
    const itemsArr = single
      ? [single]
      : Array.isArray(listItems)
        ? listItems
        : listItems
          ? [listItems]
          : [];
    result.itemCount = itemsArr.length;
    console.log('totalCount:', response?.body?.totalCount, 'itemsReturned:', itemsArr.length);
    if (itemsArr.length > 0) {
      result.fields = Object.keys(itemsArr[0] as object);
      console.log('field names:', result.fields);
      console.log('items (raw, up to 20):', JSON.stringify(itemsArr.slice(0, 20), null, 2));
    }
  } catch (e: unknown) {
    result.fetchError = e instanceof Error ? e.message : String(e);
    console.log('FETCH ERROR:', result.fetchError);
  }
  return result;
}

const OFFICIAL_LIST_BASE = 'https://apis.data.go.kr/1613000/AptListService4';
const OFFICIAL_BASIC_BASE = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV5';
const CONFIRMED_BASIC_OPERATION = 'getAphusBassInfoV5';

async function main() {
  if (!CLEAN_KEY) {
    console.log('DATA_GO_KR_API_KEY not configured — cannot probe live API. Stopping.');
    return;
  }

  // 해운대구 우동(경동마리나 소재) — 기존 신뢰 regcode 프록시로 정확히 조회한 값
  // (grpc-proxy-server regcodes, 추측 아님).
  const bjdCode = '2635010500';
  const sigunguCode = '26350';
  const sidoCode = '26';

  const LIST_OPERATION_CANDIDATES = [
    { op: 'getSigunguAptListV4', params: `sigunguCode=${sigunguCode}` },
    { op: 'getLegaldongAptListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getSidoAptListV4', params: `sidoCode=${sidoCode}` },
    { op: 'getRoadnmAptListV4', params: `sigunguCode=${sigunguCode}` },
    { op: 'getSigunguAptList', params: `sigunguCode=${sigunguCode}` },
    { op: 'getLegaldongAptList', params: `bjdCode=${bjdCode}` },
    { op: 'getSigunguAptListV4', params: `sigunguCd=${sigunguCode}` },
    { op: 'getLegaldongAptListV4', params: `bjdCd=${bjdCode}` },
    { op: 'getBjdongAptListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getAptListV4', params: `sigunguCode=${sigunguCode}` },
    { op: 'getSigunguAphusListV4', params: `sigunguCode=${sigunguCode}` },
    { op: 'getLegaldongAphusListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getBjdongAphusListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getAphusListV4', params: `sigunguCode=${sigunguCode}` },
    { op: 'getAphusList', params: `sigunguCode=${sigunguCode}` },
    { op: 'getEmdAptListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getUmdAptListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getSigunguAphusListV4', params: `sigunguCd=${sigunguCode}` },
    { op: 'getEmdAphusListV4', params: `bjdCode=${bjdCode}` },
    { op: 'getAptBasisListV4', params: `sigunguCode=${sigunguCode}` },
  ];

  console.log('\n########## LIST SERVICE: operation-name discovery ##########');
  const listResults: ProbeResult[] = [];
  for (const c of LIST_OPERATION_CANDIDATES) {
    listResults.push(
      await callOnce(
        `AptListService4.${c.op} (${c.params})`,
        `${OFFICIAL_LIST_BASE}/${c.op}?serviceKey=${CLEAN_KEY}&${c.params}&numOfRows=50&pageNo=1&_type=json`
      )
    );
  }
  const workingListOp = listResults.find((r) => r.resultCode === '00');

  console.log('\n########## BASIC INFO SERVICE: confirmed operation ##########');
  // CLI arg로 실제 kaptCode를 넘기면 그 단지를 조회한다. 인자가 없으면 공개된 사용
  // 예제(GitHub luritas/open-data-api wiki)의 kaptCode로 응답 shape만 확인한다 —
  // 이 기본값이 실제로는 부산 사하구 단지로 확인됨(2026-08-31 실측).
  const kaptCode = process.argv[2] || 'A10027875';
  const basicResult = await callOnce(
    `AptBasisInfoServiceV5.${CONFIRMED_BASIC_OPERATION} (kaptCode=${kaptCode})`,
    `${OFFICIAL_BASIC_BASE}/${CONFIRMED_BASIC_OPERATION}?serviceKey=${CLEAN_KEY}&kaptCode=${kaptCode}&_type=json`
  );

  // CONTROL — same key, already-approved service, proving the key itself stays
  // fine throughout this re-verification.
  const controlResult = await callOnce(
    'CONTROL: BldRgstHubService.getBrTitleInfo (already-approved service, same key)',
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${CLEAN_KEY}&sigunguCd=26350&bjdongCd=10300&platGbCd=0&bun=0974&ji=0000&numOfRows=5&_type=json`
  );

  console.log('\n########## SUMMARY ##########');
  console.log('list service working operation:', workingListOp?.label ?? 'NONE FOUND (20 candidates tried)');
  console.log('basic-info service:', basicResult.resultCode === '00' ? `WORKING (${CONFIRMED_BASIC_OPERATION})` : 'FAILED');
  console.log('control call (key health check):', controlResult.resultCode === '00' ? 'SUCCESS' : `FAILED (${controlResult.gatewayError ?? controlResult.resultMsg})`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
