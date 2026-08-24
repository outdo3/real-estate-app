// E-JIP SCORE V2 STEP 0.7 §9 — 건축물대장 조회 재현(READ-ONLY 감사 전용).
// 1차: getBrRecapTitleInfo(총괄표제부, 다동 단지용) — seed script와 동일 로직/엔드포인트.
// 2차 fallback: getBrTitleInfo(표제부, 단일 건물용) — pilot 실측(§9)에서 확인된 사실:
// 1차가 not_found인 45/48건 중 다수가 실제로는 표제부(단일 동) 등록만 있는 소규모
// 단지였다(총괄표제부는 "여러 동으로 구성된 단지"에만 생성되는 레코드 — 실측으로 확인,
// 추정 아님). 이 fallback을 seed script(운영 코드)에는 적용하지 않는다 — 이번 STEP은
// READ-ONLY 감사이고, 운영 코드 변경은 §26 미래 write-plan 승인 이후의 별도 범위.
export interface RegistryProbeResult {
  status: 'success' | 'not_found' | 'api_error' | 'parse_error';
  tier: 'recap' | 'title' | null; // 어느 API에서 성공했는지
  totalHouseholds: number | null;
  mainBuildingCount: number | null;
  parkingCount: number | null;
  mgmBldrgstPk: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  bldNm: string | null;
  mainPurpsCdNm: string | null; // 주용도 — "공동주택"이 아니면 universe validity 재검토 신호(§20/§24)
  approvalYear: number | null; // useAprDay(사용승인일) 앞 4자리 — MOLIT buildYear와의 일치성 확인용(§4)
  recordCount: number;
}

const LEDGER_MIN_INTERVAL_MS = 1500;
let lastCallAt = 0;
async function throttle() {
  const wait = Math.max(0, LEDGER_MIN_INTERVAL_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

function buildBunJi(jibun: string): { bun: string; ji: string } | null {
  const parts = jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  if (isNaN(bunNum)) return null;
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  return { bun: bunNum.toString().padStart(4, '0'), ji: jiNum.toString().padStart(4, '0') };
}

async function callOperation(op: 'getBrRecapTitleInfo' | 'getBrTitleInfo', sggCd: string, umdCd: string, bun: string, ji: string): Promise<{ status: RegistryProbeResult['status']; item: any; recordCount: number }> {
  const apiKey = process.env.DATA_GO_KR_API_KEY || '';
  if (!apiKey) throw new Error('DATA_GO_KR_API_KEY not set');
  const cleanKey = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`;
  await throttle();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const rawText = await res.text();
    if (!res.ok) return { status: 'api_error', item: null, recordCount: 0 };
    const pkMatch = rawText.match(/"mgmBldrgstPk"\s*:\s*"?([0-9]+)"?/);
    const json = JSON.parse(rawText);
    const header = json?.response?.header;
    if (header?.resultCode && header.resultCode !== '00') return { status: 'api_error', item: null, recordCount: 0 };
    const items = json?.response?.body?.items?.item;
    if (!items) return { status: 'not_found', item: null, recordCount: 0 };
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length === 0) return { status: 'not_found', item: null, recordCount: 0 };
    const target = arr.reduce((best: any, cur: any) => ((cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best));
    if (pkMatch && arr.length === 1) target.__rawMgmBldrgstPk = pkMatch[1]; // 정밀도 손실 방지(원본 문자열 보존)
    return { status: 'success', item: target, recordCount: arr.length };
  } catch {
    return { status: 'api_error', item: null, recordCount: 0 };
  }
}

export async function probeRegistryTwoTier(sggCd: string, umdCd: string, jibun: string): Promise<RegistryProbeResult> {
  const empty = (status: RegistryProbeResult['status']): RegistryProbeResult => ({
    status, tier: null, totalHouseholds: null, mainBuildingCount: null, parkingCount: null,
    mgmBldrgstPk: null, roadAddress: null, jibunAddress: null, bldNm: null, mainPurpsCdNm: null,
    approvalYear: null, recordCount: 0,
  });
  if (!sggCd || !umdCd || !jibun) return empty('parse_error');
  const bj = buildBunJi(jibun);
  if (!bj) return empty('parse_error');

  const toResult = (tier: 'recap' | 'title', r: { item: any; recordCount: number }): RegistryProbeResult => {
    const target = r.item;
    const hhldCnt = parseInt(target.hhldCnt, 10);
    const parkingCnt = parseInt(target.totPkngCnt, 10);
    const mainBldCnt = parseInt(target.mainBldCnt, 10);
    const useAprDay: string = (target.useAprDay ?? '').toString().trim();
    const approvalYear = /^\d{8}$/.test(useAprDay) ? parseInt(useAprDay.slice(0, 4), 10) : null;
    return {
      status: 'success', tier,
      totalHouseholds: !isNaN(hhldCnt) && hhldCnt > 0 ? hhldCnt : null,
      mainBuildingCount: !isNaN(mainBldCnt) && mainBldCnt > 0 ? mainBldCnt : null,
      parkingCount: !isNaN(parkingCnt) && parkingCnt > 0 ? parkingCnt : null,
      mgmBldrgstPk: target.__rawMgmBldrgstPk ?? (target.mgmBldrgstPk != null ? String(target.mgmBldrgstPk) : null),
      roadAddress: target.newPlatPlc ? String(target.newPlatPlc).trim() : null,
      jibunAddress: target.platPlc ? String(target.platPlc).trim() : null,
      bldNm: (target.bldNm ?? '').toString().trim() || null,
      mainPurpsCdNm: (target.mainPurpsCdNm ?? '').toString().trim() || null,
      approvalYear,
      recordCount: r.recordCount,
    };
  };

  const recap = await callOperation('getBrRecapTitleInfo', sggCd, umdCd, bj.bun, bj.ji);
  if (recap.status === 'success') return toResult('recap', recap);
  if (recap.status === 'api_error') return empty('api_error');

  // recap이 not_found일 때만 title(단일 건물)로 fallback — recap 성공을 항상 우선
  const title = await callOperation('getBrTitleInfo', sggCd, umdCd, bj.bun, bj.ji);
  if (title.status === 'success') return toResult('title', title);
  return empty(title.status);
}
