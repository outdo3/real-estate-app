/**
 * APARTMENT_OFFICIAL_BASIC_INFO_SOURCE_AUDIT_V1 — read-only probe for the
 * "국토교통부_공동주택 기본 정보제공 서비스"(data.go.kr #15058453, AptBasisInfoServiceV3)
 * and its companion 단지 목록제공 서비스(data.go.kr #15057332, AptListService3).
 * No DB access, no write of any kind — pure external HTTP GET.
 *
 * Reuses the project's existing DATA_GO_KR_API_KEY (same key already used by
 * src/lib/api-molit.ts and src/lib/apt-building-info.ts against the same
 * apis.data.go.kr/1613000 API group) and the same key-sanitization pattern those
 * files use (trim/strip-quotes/decodeURIComponent/encodeURIComponent, handles a
 * key that may already be URL-encoded in .env). No new API client abstraction
 * introduced — this stays a throwaway diagnostic script, not a reusable lib,
 * because §6 of the audit doc found the product itself is not yet activated on
 * this key (see docs/development/APARTMENT_OFFICIAL_BASIC_INFO_SOURCE_AUDIT_V1.md).
 *
 * RESULT (2026-08-31, re-run any time to re-check): the user confirmed both
 * products show 승인(approved) status on data.go.kr (활용신청 현황), so this is
 * NOT an approval problem. Re-tested with 9 candidate group-id/operation
 * combinations spanning both plausible API groups (1611000/1613000) and every
 * publicly-documented operation-name variant found — all 9 still return
 * NO_OPENAPI_SERVICE_ERROR("해당 오픈API 서비스가 없거나 폐기됨", returnReasonCode=12,
 * data.go.kr's "wrong service URL" code, distinct from an access-denied code)
 * while the CONTROL call to the already-approved BldRgstHubService keeps
 * succeeding on the SAME key in the same run. Conclusion: the key and approval
 * are both fine — the literal End Point path for these two products is simply
 * not yet known. It's only visible on the user's authenticated data.go.kr
 * 마이페이지 (an unauthenticated fetch of that page redirects to SSO login).
 * See docs/development/APARTMENT_OFFICIAL_BASIC_INFO_SOURCE_AUDIT_V1.md §6-B/§15.
 * Once the exact End Point string is obtained, add it to the `candidates` array
 * below and re-run.
 *
 * Usage: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/audit-apartment-basic-info-source.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const RAW_KEY = process.env.DATA_GO_KR_API_KEY || '';
const CLEAN_KEY = RAW_KEY ? encodeURIComponent(decodeURIComponent(RAW_KEY.trim().replace(/['"]/g, ''))) : '';

console.log(`API_KEY_CONFIGURED=${RAW_KEY.length > 0}`);

async function callOnce(label: string, url: string) {
  console.log(`\n=== ${label} ===`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    console.log('HTTP status:', res.status);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON — fall through to raw-text logging below
    }

    if (!parsed) {
      console.log('non-JSON response (first 500 chars):', text.slice(0, 500));
      return;
    }

    const errMsg = (parsed as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: string; returnAuthMsg?: string } } })
      .OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (errMsg) {
      console.log('GATEWAY ERROR:', errMsg.errMsg, '-', errMsg.returnAuthMsg);
      return;
    }

    const response = (parsed as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; items?: { item?: unknown } } } }).response;
    console.log('resultCode:', response?.header?.resultCode, 'resultMsg:', response?.header?.resultMsg);
    const items = response?.body?.items?.item;
    const itemsArr = Array.isArray(items) ? items : items ? [items] : [];
    console.log('totalCount:', response?.body?.totalCount, 'itemsReturned:', itemsArr.length);
    if (itemsArr.length > 0) {
      console.log('sample item field names:', Object.keys(itemsArr[0] as object));
      console.log('sample item (raw, full):', JSON.stringify(itemsArr[0], null, 2));
    }
  } catch (e: unknown) {
    console.log('FETCH ERROR:', e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  if (!CLEAN_KEY) {
    console.log('DATA_GO_KR_API_KEY not configured — cannot probe live API. Stopping.');
    return;
  }

  const kaptCodeCandidate = 'A10027875'; // 임의 예시 kaptCode — 실존 여부 무관, 경로 자체가 살아있는지만 확인

  const candidates: { label: string; url: string }[] = [
    // 기본 정보제공 서비스 후보 — 버전/그룹 조합을 넓혀서 재확인(승인 직후라 정확한
    // 현재 버전을 단정하지 않음).
    {
      label: 'AptBasisInfoServiceV3.getAphusBassInfoV3 (group 1613000)',
      url: `https://apis.data.go.kr/1613000/AptBasisInfoServiceV3/getAphusBassInfoV3?serviceKey=${CLEAN_KEY}&kaptCode=${kaptCodeCandidate}&_type=json`,
    },
    {
      label: 'AptBasisInfoServiceV4.getAphusBassInfoV4 (group 1613000, 신버전 가능성)',
      url: `https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4?serviceKey=${CLEAN_KEY}&kaptCode=${kaptCodeCandidate}&_type=json`,
    },
    {
      label: 'AptBasisInfoService.getAphusBassInfo (group 1613000, 버전 접미사 없음)',
      url: `https://apis.data.go.kr/1613000/AptBasisInfoService/getAphusBassInfo?serviceKey=${CLEAN_KEY}&kaptCode=${kaptCodeCandidate}&_type=json`,
    },
    {
      label: 'AptBasisInfoService.getAphusBassInfo (legacy, group 1611000)',
      url: `https://apis.data.go.kr/1611000/AptBasisInfoService/getAphusBassInfo?serviceKey=${CLEAN_KEY}&kaptCode=${kaptCodeCandidate}&_type=json`,
    },
    // 단지 목록제공 서비스 후보.
    {
      label: 'AptListService3.getSigunguAptListV3 (group 1613000, sigunguCode=26350 해운대구)',
      url: `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptListV3?serviceKey=${CLEAN_KEY}&sigunguCode=26350&numOfRows=50&pageNo=1&_type=json`,
    },
    {
      label: 'AptListService3.getSidoAptListV3 (group 1613000, sidoCode=26 부산)',
      url: `https://apis.data.go.kr/1613000/AptListService3/getSidoAptListV3?serviceKey=${CLEAN_KEY}&sidoCode=26&numOfRows=50&pageNo=1&_type=json`,
    },
    {
      label: 'AptListService2.getLegaldongAptList (group 1613000, 이전 STEP에서 시도된 변형)',
      url: `https://apis.data.go.kr/1613000/AptListService2/getLegaldongAptList?serviceKey=${CLEAN_KEY}&bjdCode=2635010500&numOfRows=50&pageNo=1&_type=json`,
    },
    {
      label: 'AptListService.getSigunguAptList (legacy, group 1611000)',
      url: `https://apis.data.go.kr/1611000/AptListService/getSigunguAptList?serviceKey=${CLEAN_KEY}&sigunguCode=26350&numOfRows=50&pageNo=1&_type=json`,
    },
    {
      label: 'AptListService.getLegaldongAptList (group 1611000, bjdCode=2635010500 우동 — 실사용 예제에서 발견된 조합)',
      url: `https://apis.data.go.kr/1611000/AptListService/getLegaldongAptList?serviceKey=${CLEAN_KEY}&bjdCode=2635010500&numOfRows=50&pageNo=1&_type=json`,
    },
  ];

  for (const c of candidates) {
    await callOnce(c.label, c.url);
  }

  // CONTROL — same key, same 1613000 group, but a service already known-approved
  // (BldRgstHubService, used in production by src/lib/apt-building-info.ts). If
  // this succeeds while the candidates above fail, the key itself is fine and the
  // failure is specifically "this product not yet approved on this key", not a
  // broken/expired key or wrong request shape.
  await callOnce(
    'CONTROL: BldRgstHubService.getBrTitleInfo (already-approved service, same key)',
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${CLEAN_KEY}&sigunguCd=26350&bjdongCd=10300&platGbCd=0&bun=0974&ji=0000&numOfRows=5&_type=json`
  );
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
