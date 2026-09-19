// DATA_COVERAGE_FIX_V1 backfill의 순수 함수만 분리(부작용 없음 — dotenv/prisma/__dirname
// 없음). src/lib/chart-crosshair.ts와 같은 이유로 분리했다: 테스트 파일이 이 모듈만
// import하면 되고, CLI 스크립트(backfill-apartment-master-basic-data.ts) 전체가 같이
// 실행되는 사고를 원천적으로 막는다.

export interface FieldPlan {
  field: string;
  action: 'UNCHANGED' | 'FILL_NULL' | 'MATCH_EXISTING' | 'CONFLICT_REVIEW';
  newValue: any;
}

// parkingCount / totalHouseholds. household이 0 이하이거나 parking이 없으면 계산하지
// 않는다(0으로 나누기 금지, 추정치 아님 — 이미 확정된 두 값의 단순 나눗셈).
export function calcParkingPerHousehold(parkingCount: number | null, totalHouseholds: number | null): number | null {
  if (parkingCount == null || totalHouseholds == null || totalHouseholds <= 0) return null;
  return parkingCount / totalHouseholds;
}

// 기존 값을 절대 덮어쓰지 않는다는 §7 원칙의 핵심 판정 로직.
export function planField(field: string, existing: any, fresh: any): FieldPlan {
  if (fresh === null || fresh === undefined) return { field, action: 'UNCHANGED', newValue: null };
  if (existing === null || existing === undefined) return { field, action: 'FILL_NULL', newValue: fresh };
  const same = typeof existing === 'number' && typeof fresh === 'number'
    ? Math.abs(existing - fresh) < 0.01
    : String(existing) === String(fresh);
  return same ? { field, action: 'MATCH_EXISTING', newValue: fresh } : { field, action: 'CONFLICT_REVIEW', newValue: fresh };
}

// ───────────────────────── SEOUL_BUILDING_LEDGER_ENRICHMENT_PLAN_V1 ─────────────────────────
// 응답 해석을 순수 함수로 분리했다. 부산은 LENIENT(기존 동작 그대로), 서울은 STRICT:
//   - numOfRows 100 + totalCount 확인(잘린 응답은 REVIEW)
//   - 응답 레코드의 시군구·법정동·본번·부번이 조회 지번과 같아야 함(EXACT_LOT)
//   - 총괄표제부가 2건 이상이면 대표값을 고르지 않고 MULTIPLE(보류)
export interface LedgerPolicy { strict: boolean }
export const LENIENT_POLICY: LedgerPolicy = { strict: false };
export const STRICT_POLICY: LedgerPolicy = { strict: true };
export const ledgerNumOfRows = (p: LedgerPolicy): number => (p.strict ? 100 : 5);
/**
 * 페이지 파라미터. 실측(2026-09-19): BldRgstHubService는 pageNo가 없으면 numOfRows를 무시하고 1건만 준다
 * (응답 numOfRows=1, totalCount=4인데 item 1건). STRICT는 pageNo=1을 붙여 totalCount만큼 받는다.
 * LENIENT(부산)는 기존 URL 그대로 둔다 — 부산 동작 변경은 이 STEP 범위 밖(보고만).
 */
export const ledgerPageParams = (p: LedgerPolicy): string => (p.strict ? 'numOfRows=100&pageNo=1' : 'numOfRows=5');

/** 표제부 레코드 중 주건축물(mainAtchGbCd '0') 수 — 보고용(판정에 쓰지 않는다). */
export function countMainBuildings(arr: any[]): number {
  return arr.filter((x) => String(x?.mainAtchGbCd ?? '').trim() === '0' || String(x?.mainAtchGbCdNm ?? '').trim() === '주건축물').length;
}

export interface LotQuery { sggCd: string; umdCd: string; bun: string; ji: string }

const pad4 = (v: unknown) => String(v ?? '').trim().padStart(4, '0');

/** 응답 레코드가 조회한 필지(시군구·법정동·대지·본번·부번)와 정확히 같은가. */
export function recordMatchesLot(item: any, q: LotQuery): boolean {
  if (!item) return false;
  return String(item.sigunguCd ?? '').trim() === q.sggCd
    && String(item.bjdongCd ?? '').trim() === q.umdCd
    && String(item.platGbCd ?? '0').trim() === '0'
    && pad4(item.bun) === q.bun
    && pad4(item.ji) === q.ji;
}

export type GeneralDecision =
  | { status: 'success'; record: any; mgmBldrgstPk: string | null }
  | { status: 'not_found' | 'multiple' | 'incomplete' | 'lot_mismatch'; record: null; mgmBldrgstPk: null };

/**
 * 총괄표제부 응답 판정. LENIENT는 기존 부산 코드와 한 글자도 다르지 않은 규칙(세대수 최대 레코드 선택,
 * 1건일 때만 원문 mgmBldrgstPk). STRICT는 여러 건이면 고르지 않는다.
 */
export function decideGeneralTitle(arr: any[], totalCount: number | null, rawPkFirst: string | null, q: LotQuery, p: LedgerPolicy): GeneralDecision {
  if (arr.length === 0) return { status: 'not_found', record: null, mgmBldrgstPk: null };
  if (!p.strict) {
    const target = arr.reduce((best: any, cur: any) => ((cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best));
    return { status: 'success', record: target, mgmBldrgstPk: arr.length === 1 && rawPkFirst ? rawPkFirst : (target.mgmBldrgstPk != null ? String(target.mgmBldrgstPk) : null) };
  }
  if (totalCount != null && totalCount > arr.length) return { status: 'incomplete', record: null, mgmBldrgstPk: null };
  if (arr.length > 1) return { status: 'multiple', record: null, mgmBldrgstPk: null };
  if (!recordMatchesLot(arr[0], q)) return { status: 'lot_mismatch', record: null, mgmBldrgstPk: null };
  return { status: 'success', record: arr[0], mgmBldrgstPk: rawPkFirst ?? (arr[0].mgmBldrgstPk != null ? String(arr[0].mgmBldrgstPk) : null) };
}

/** 총괄표제부 레코드 → 필드(기존 부산 파싱 규칙 그대로 + 주소 원문). 0 이하·형식 오류는 null. */
export function extractGeneralFields(target: any, mgmBldrgstPk: string | null) {
  const hhldCnt = parseInt(target.hhldCnt, 10);
  const parkingCnt = parseInt(target.totPkngCnt, 10);
  const mainBldCnt = parseInt(target.mainBldCnt, 10);
  const vlRat = parseFloat(target.vlRat);
  const bcRat = parseFloat(target.bcRat);
  const useAprDay: string = target.useAprDay || '';
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    totalHouseholds: !isNaN(hhldCnt) && hhldCnt > 0 ? hhldCnt : null,
    mainBuildingCount: !isNaN(mainBldCnt) && mainBldCnt > 0 ? mainBldCnt : null,
    parkingCount: !isNaN(parkingCnt) && parkingCnt > 0 ? parkingCnt : null,
    useApprovalDate: /^\d{8}$/.test(useAprDay) ? useAprDay : null,
    mgmBldrgstPk,
    floorAreaRatio: !isNaN(vlRat) && vlRat > 0 ? vlRat : null,
    buildingCoverageRatio: !isNaN(bcRat) && bcRat > 0 ? bcRat : null,
    roadAddress: text(target.newPlatPlc),
    jibunAddress: text(target.platPlc),
  };
}

export type TitleDecision = 'success' | 'not_found' | 'multiple_review' | 'building_unit_review' | 'incomplete' | 'lot_mismatch';

/** 표제부 fallback 판정. LENIENT = 기존 부산 규칙(1건만, 동번호 단위면 REVIEW). STRICT는 잘린 응답·필지 불일치도 REVIEW. */
export function decideTitleFallback(arr: any[], totalCount: number | null, q: LotQuery, p: LedgerPolicy, isNumberedUnit: (dongNm: unknown) => boolean): TitleDecision {
  if (arr.length === 0) return 'not_found';
  if (p.strict && totalCount != null && totalCount > arr.length) return 'incomplete';
  if (arr.length > 1) return 'multiple_review';
  if (p.strict && !recordMatchesLot(arr[0], q)) return 'lot_mismatch';
  if (isNumberedUnit(arr[0]?.dongNm)) return 'building_unit_review';
  return 'success';
}

/**
 * 교차 확인(STRICT, 선택): 총괄표제부가 있는 필지에 표제부가 **정확히 1건**(단일 건물)이면 두 세대수가 같아야 한다.
 * 다르면 어느 쪽이 맞는지 추정하지 않고 CONFLICT(보류). 표제부가 여러 건이면 다동 단지라 비교 대상이 아니다.
 */
export function crossCheckGeneralVsTitle(generalHouseholds: number | null, titleArr: any[]): 'NO_CONFLICT' | 'CONFLICT' | 'NOT_COMPARABLE' {
  if (generalHouseholds == null || titleArr.length !== 1) return 'NOT_COMPARABLE';
  const t = parseInt(titleArr[0]?.hhldCnt, 10);
  if (isNaN(t) || t <= 0) return 'NOT_COMPARABLE';
  return t === generalHouseholds ? 'NO_CONFLICT' : 'CONFLICT';
}

/** 지역 인자 → 조회 prefix와 정책. 부산 = LENIENT(기존 그대로), 서울 = STRICT. registry에 없는 코드는 거부. */
export function regionConfig(region: string): { sggPrefix: string; policy: LedgerPolicy } | null {
  if (region === '26') return { sggPrefix: '26', policy: LENIENT_POLICY };
  if (region === '11') return { sggPrefix: '11', policy: STRICT_POLICY };
  return null;
}

/** 서울 대표 표본: 지정 구마다 aptSeq 순 균등 간격으로 구축(건축년도 < 2005)·신축(≥ 2005)을 반씩. */
export function pickSeoulSample<T extends { aptSeq: string; sggCd: string | null; buildYear: number | null }>(rows: T[], districts: string[], perDistrict: number): T[] {
  const out: T[] = [];
  const even = (list: T[], n: number) => { if (n <= 0 || !list.length) return []; const step = Math.max(1, Math.floor(list.length / n)); return list.filter((_, i) => i % step === 0).slice(0, n); };
  for (const d of districts) {
    const inD = rows.filter((r) => r.sggCd === d).sort((a, b) => a.aptSeq.localeCompare(b.aptSeq));
    const old = inD.filter((r) => (r.buildYear ?? 0) < 2005);
    const neu = inD.filter((r) => (r.buildYear ?? 0) >= 2005);
    const half = Math.floor(perDistrict / 2);
    out.push(...even(old, half), ...even(neu, perDistrict - half));
  }
  return out;
}

export const SEOUL_SAMPLE_DISTRICTS = ['11680', '11710', '11350', '11140', '11740', '11650']; // 강남·송파·노원·중구·강동·서초
