// OFFICETEL_INCREMENTAL_SYNC_V1 — 원천 행 -> history 적재 행. 순수 함수.
//
// STEP 3B(scripts/officetel/step3b-history-backfill.ts)의 변환 규칙을 **그대로** 따른다. 그 스크립트는
// NDJSON/파일 매니페스트/Prisma에 묶여 있어 함수로 import할 수 없으므로 규칙만 옮겼고, 판정에 쓰는
// 계약 모듈(identity.ts · natural-key.ts)은 복제하지 않고 직접 호출한다. 두 경로가 갈라지지 않도록
// normalize.test.ts가 3B의 대표 입력에 대한 기대값을 고정한다.
//
// 3B와 다른 점은 하나다: 3B는 행 하나가 깨지면 셀 전체를 INVALID로 버렸다(최초 적재의 엄격한 게이트).
// 증분에서는 깨진 행 하나가 그 구·월의 모든 신규 거래를 영구히 막으면 안 되므로, 깨진 행만 제외하고
// 건수를 센다(invalidRowCount). 그 셀은 COMPLETE가 아니라 PARTIAL(PARSE_ERROR)로 남는다.
// 셀 월과 행 월이 어긋나는 것 같은 구조적 문제는 3B와 같이 셀 전체를 INVALID로 둔다.
import { buildOfficetelCanonicalKey, normalizeJibun, normalizeUmd } from '../identity';
import { assignOccurrenceIndexes, officetelRentGroupKey, officetelSaleGroupKey } from '../natural-key';
import type { MasterRef, PreparedRent, PreparedSale, RawOfficetelRow } from './types';

export const SALE_SOURCE = 'MOLIT_OFFI_TRADE';
export const RENT_SOURCE = 'MOLIT_OFFI_RENT';

const text = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
/** 3A 감사와 동일한 파서(콤마 제거 후 Number). */
const num = (s: unknown): number | null => {
  const v = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};
const intOrNull = (v: unknown): number | null => {
  const t = text(v);
  if (t === null) return null;
  const n = num(t);
  return n === null ? null : Math.trunc(n);
};

export type MasterIndex = Map<string, MasterRef[]>;

export function buildMasterIndex(masters: MasterRef[]): MasterIndex {
  const idx: MasterIndex = new Map();
  for (const m of masters) {
    const k = `${m.sggCd}|${m.normalizedUmdNm}|${m.normalizedJibun}`;
    const list = idx.get(k);
    if (list) list.push(m);
    else idx.set(k, [m]);
  }
  return idx;
}

export type Linkage = 'LINKABLE' | 'UNRESOLVED_MULTI' | 'MASTER_MISS';

export interface PrepareResult<T> {
  rows: T[];
  /** 제외한 행 수(파싱 불가). */
  invalidRowCount: number;
  /** 사유별 제외 건수. 개별 거래 원문은 담지 않는다. */
  invalidReasons: Record<string, number>;
  /** 셀 전체를 믿을 수 없는 구조적 문제(있으면 rows는 비어 있고 아무것도 쓰지 않는다). */
  structuralInvalid: string | null;
  linkage: Record<Linkage, number>;
  /** master에 연결하지 못한 채 적재 대상이 된 행 수(= MASTER_MISS + UNRESOLVED_MULTI). */
  unresolvedCount: number;
}

interface Parsed {
  raw: RawOfficetelRow;
  key: string | null;
  y: number | null;
  m: number | null;
  d: number | null;
  dealDate: string | null;
  floor: number | null;
  areaRaw: string | null;
  areaOk: boolean;
}

function parseCommon(raw: RawOfficetelRow): Parsed {
  const k = buildOfficetelCanonicalKey({ sggCd: text(raw.sggCd) ?? '', umdNm: text(raw.umdNm) ?? '', jibun: text(raw.jibun) ?? '', buildingDong: null });
  const y = intOrNull(raw.dealYear);
  const m = intOrNull(raw.dealMonth);
  const d = intOrNull(raw.dealDay);
  const dealDate = y && m && d ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
  const areaRaw = text(raw.excluUseAr);
  const areaNum = areaRaw === null ? null : num(areaRaw);
  return {
    raw,
    key: k.ok ? k.key : null,
    y, m, d, dealDate,
    floor: intOrNull(raw.floor),
    areaRaw,
    areaOk: areaNum !== null && areaNum > 0,
  };
}

function linkOf(raw: RawOfficetelRow, masters: MasterIndex): { id: number | null; linkage: Linkage } {
  const addr = `${text(raw.sggCd)}|${normalizeUmd(String(raw.umdNm ?? ''))}|${normalizeJibun(String(raw.jibun ?? ''))}`;
  const group = masters.get(addr);
  if (!group) return { id: null, linkage: 'MASTER_MISS' };
  if (group.length === 1) return { id: group[0].id, linkage: 'LINKABLE' };
  // 같은 지번에 master가 여럿이면 어느 건물인지 추측하지 않는다.
  return { id: null, linkage: 'UNRESOLVED_MULTI' };
}

/** 공통: 행별 파싱 -> 검증 -> 자연키 그룹/occurrenceIndex. kind별 금액 필드는 호출부가 채운다. */
function prepare<T extends PreparedSale | PreparedRent>(
  kind: 'SALE' | 'RENT',
  lawdCd: string,
  dealYmd: string,
  rawRows: RawOfficetelRow[],
  masters: MasterIndex,
  fetchedAt: Date
): PrepareResult<T> {
  const empty = (structuralInvalid: string | null): PrepareResult<T> => ({
    rows: [], invalidRowCount: 0, invalidReasons: {}, structuralInvalid,
    linkage: { LINKABLE: 0, UNRESOLVED_MULTI: 0, MASTER_MISS: 0 }, unresolvedCount: 0,
  });
  const parsed = rawRows.map(parseCommon);

  // 셀 좌표와 행 계약연월 일치 — 어긋나면 occurrence 배치 전제가 깨지므로 셀 전체를 믿지 않는다(3B 동일).
  for (const p of parsed) {
    if (p.y && p.m && `${p.y}${String(p.m).padStart(2, '0')}` !== dealYmd) {
      return empty(`cell dealYmd(${dealYmd}) != row ${p.y}-${p.m}`);
    }
  }

  const reasons: Record<string, number> = {};
  const bad = (r: string) => { reasons[r] = (reasons[r] ?? 0) + 1; };
  const amountOf = (p: Parsed): { ok: boolean; a: number; b: number } => {
    if (kind === 'SALE') {
      const amt = intOrNull(p.raw.dealAmount);
      return { ok: amt !== null && amt > 0, a: amt ?? 0, b: 0 };
    }
    const dep = intOrNull(p.raw.deposit);
    const rent = intOrNull(p.raw.monthlyRent);
    return { ok: dep !== null && rent !== null, a: dep ?? 0, b: rent ?? 0 };
  };

  // 자연키 그룹 + occurrenceIndex — 원천 응답 순서 그대로. 깨진 행은 고유 placeholder 그룹에 넣어
  // 다른 행의 occurrenceIndex를 밀어내지 않는다.
  const valid: boolean[] = [];
  const groupKeys = parsed.map((p, i) => {
    let reason: string | null = null;
    if (!p.key) reason = 'CANONICAL_KEY_FAIL';
    else if (!p.dealDate) reason = 'DEAL_DATE_PARSE_FAIL';
    else if (p.floor === null) reason = 'FLOOR_PARSE_FAIL';
    else if (!p.areaOk) reason = 'AREA_PARSE_FAIL';
    else if (!amountOf(p).ok) reason = kind === 'SALE' ? 'AMOUNT_PARSE_FAIL' : 'RENT_PARSE_FAIL';
    if (reason) { bad(reason); valid.push(false); return ` INVALID#${i}`; }
    valid.push(true);
    const amt = amountOf(p);
    return kind === 'SALE'
      ? officetelSaleGroupKey({ canonicalKey: p.key!, dealDate: p.dealDate!, exclusiveArea: p.areaRaw!, dealAmount: amt.a, floor: p.floor! })
      : officetelRentGroupKey({ canonicalKey: p.key!, dealDate: p.dealDate!, exclusiveArea: p.areaRaw!, deposit: amt.a, monthlyRent: amt.b, floor: p.floor! });
  });
  const occ = assignOccurrenceIndexes(groupKeys);

  const rows: T[] = [];
  const linkage: Record<Linkage, number> = { LINKABLE: 0, UNRESOLVED_MULTI: 0, MASTER_MISS: 0 };
  for (let i = 0; i < parsed.length; i++) {
    if (!valid[i]) continue;
    const p = parsed[i];
    const r = p.raw;
    const link = linkOf(r, masters);
    linkage[link.linkage]++;
    const common = {
      officetelMasterId: link.id,
      canonicalKey: p.key!,
      lawdCd,
      dealYmd,
      umdNm: text(r.umdNm) ?? '',
      jibun: text(r.jibun) ?? '',
      offiNm: text(r.offiNm) ?? '',
      exclusiveArea: p.areaRaw!, // 원본 문자열 그대로 — 반올림 금지
      dealYear: p.y!, dealMonth: p.m!, dealDay: p.d!,
      dealDate: p.dealDate!,
      floor: p.floor!,
      buildYear: intOrNull(r.buildYear),
      occurrenceIndex: occ[i],
      // 실제 외부 API 수집 시각. STEP 3B는 스윕 파일 mtime을 넣었지만 증분은 방금 원천에서 받은 것이다.
      sourceFetchedAt: fetchedAt,
    };
    if (kind === 'SALE') {
      const row: PreparedSale = {
        ...common,
        source: SALE_SOURCE,
        dealAmount: intOrNull(r.dealAmount)!,
        dealingGbn: text(r.dealingGbn),
        buyerGbn: text(r.buyerGbn),
        // STEP 3A §12-5 — 원천 필드명은 sellerGbn이 아니라 slerGbn이다.
        sellerGbn: text(r.slerGbn),
        estateAgentSggNm: text(r.estateAgentSggNm),
        dealCanceled: text(r.cdealType) === 'O',
        cancelDate: text(r.cdealDay), // 원본 표기 그대로 — 재해석 금지
      };
      rows.push(row as T);
    } else {
      const row: PreparedRent = {
        ...common,
        source: RENT_SOURCE,
        deposit: intOrNull(r.deposit)!,
        monthlyRent: intOrNull(r.monthlyRent)!,
        contractTerm: text(r.contractTerm),
        contractType: text(r.contractType),
        preDeposit: intOrNull(r.preDeposit),
        preMonthlyRent: intOrNull(r.preMonthlyRent),
        // 원천에 "미사용" 값이 없다 — false를 만들지 않는다(null = UNKNOWN).
        useRenewalRight: text(r.useRRRight) === '사용' ? true : null,
      };
      rows.push(row as T);
    }
  }
  return {
    rows,
    invalidRowCount: parsed.length - rows.length,
    invalidReasons: reasons,
    structuralInvalid: null,
    linkage,
    unresolvedCount: linkage.MASTER_MISS + linkage.UNRESOLVED_MULTI,
  };
}

export function prepareSaleRows(lawdCd: string, dealYmd: string, rawRows: RawOfficetelRow[], masters: MasterIndex, fetchedAt: Date): PrepareResult<PreparedSale> {
  return prepare<PreparedSale>('SALE', lawdCd, dealYmd, rawRows, masters, fetchedAt);
}

export function prepareRentRows(lawdCd: string, dealYmd: string, rawRows: RawOfficetelRow[], masters: MasterIndex, fetchedAt: Date): PrepareResult<PreparedRent> {
  return prepare<PreparedRent>('RENT', lawdCd, dealYmd, rawRows, masters, fetchedAt);
}
