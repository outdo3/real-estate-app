// SEOUL_MASTER_SEED_PLAN_V1 — 서울 ApartmentMaster seed 계획용 순수 함수(DB·네트워크 없음).
//
// 원칙(M2/M3/M4-B와 동일):
//   - 한 행 = MOLIT aptSeq 1개. aptSeq가 canonical identity다.
//   - 이름·동+지번·좌표로 서로 다른 aptSeq를 합치지 않는다(자동 merge 금지).
//   - aptSeq를 추정해서 만들지 않는다. 없거나 형식이 틀리면 REVIEW_REQUIRED.
//   - 원천 행끼리 위치(법정동코드·지번)가 어긋나면 어느 쪽이 맞는지 추정하지 않고 REVIEW_REQUIRED.

export interface RawTradeItem {
  aptSeq?: unknown;
  aptNm?: unknown;
  umdNm?: unknown;
  umdCd?: unknown;
  jibun?: unknown;
  sggCd?: unknown;
  buildYear?: unknown;
  roadNm?: unknown;
  roadNmBonbun?: unknown;
  roadNmBubun?: unknown;
  dealYear?: unknown;
  dealMonth?: unknown;
  dealDay?: unknown;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());

export function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '').replace(/아파트$/, '');
}

/** "0123" → "123", "00" → "0". 도로명 건물번호 표기용(원천 값 그대로 숫자만 정리, 추정 없음). */
function stripLeadingZeros(v: string): string {
  const s = v.replace(/^0+/, '');
  return s === '' ? (v === '' ? '' : '0') : s;
}

/** MOLIT 원천의 도로명 + 건물번호로 도로명 표기를 만든다. 둘 중 하나라도 없으면 null(부분 주소 금지). */
export function roadAddressFromMolit(roadNm: string, bonbun: string, bubun: string): string | null {
  const b = stripLeadingZeros(bonbun);
  if (!roadNm || !b || b === '0') return null;
  const s = stripLeadingZeros(bubun);
  return s && s !== '0' ? `${roadNm} ${b}-${s}` : `${roadNm} ${b}`;
}

export interface SeedCandidate {
  aptSeq: string;
  lawdCd: string;
  /** 가장 최근 계약일 행의 이름(원천 표기). */
  name: string;
  normalizedName: string;
  umdNm: string;
  umdCd: string;
  jibun: string;
  buildYear: number | null;
  roadAddress: string | null;
  tradeCount: number;
  latestDealDate: string;
  /** 같은 aptSeq에서 관측된 서로 다른 값(원천 표기 그대로). */
  names: string[];
  umdCds: string[];
  jibuns: string[];
  buildYears: number[];
  roadAddresses: string[];
  sggCds: string[];
  sources: string[];
}

export interface DiscoveryStats {
  rows: number;
  nullAptSeq: number;
  /** sggCd가 요청 lawdCd와 다른 행(다른 구·다른 시도 오염). */
  foreignSggRows: number;
}

/** 한 구의 원천 행들을 aptSeq 단위 후보로 모은다. 최신 계약일 행의 표기를 대표값으로 쓴다. */
export function aggregateCandidates(
  lawdCd: string,
  items: readonly { item: RawTradeItem; source: 'SALE' | 'RENT' }[]
): { candidates: SeedCandidate[]; stats: DiscoveryStats } {
  const map = new Map<string, SeedCandidate>();
  const stats: DiscoveryStats = { rows: 0, nullAptSeq: 0, foreignSggRows: 0 };
  for (const { item, source } of items) {
    stats.rows++;
    const seq = str(item.aptSeq);
    const sgg = str(item.sggCd) || lawdCd;
    if (sgg !== lawdCd) stats.foreignSggRows++;
    if (!seq) {
      stats.nullAptSeq++;
      continue;
    }
    const date = `${str(item.dealYear)}-${str(item.dealMonth).padStart(2, '0')}-${str(item.dealDay).padStart(2, '0')}`;
    const name = str(item.aptNm);
    const by = parseInt(str(item.buildYear), 10);
    const road = roadAddressFromMolit(str(item.roadNm), str(item.roadNmBonbun), str(item.roadNmBubun));
    let c = map.get(seq);
    if (!c) {
      c = {
        aptSeq: seq, lawdCd, name, normalizedName: normalizeName(name), umdNm: str(item.umdNm), umdCd: str(item.umdCd),
        jibun: str(item.jibun), buildYear: Number.isFinite(by) ? by : null, roadAddress: road, tradeCount: 0, latestDealDate: '',
        names: [], umdCds: [], jibuns: [], buildYears: [], roadAddresses: [], sggCds: [], sources: [],
      };
      map.set(seq, c);
    }
    c.tradeCount++;
    const add = <T>(arr: T[], v: T) => { if (v !== '' && v != null && !arr.includes(v)) arr.push(v); };
    add(c.names, name);
    add(c.umdCds, str(item.umdCd));
    add(c.jibuns, str(item.jibun));
    if (Number.isFinite(by)) add(c.buildYears, by);
    if (road) add(c.roadAddresses, road);
    add(c.sggCds, sgg);
    add(c.sources, source);
    if (date > c.latestDealDate) {
      c.latestDealDate = date;
      if (name) { c.name = name; c.normalizedName = normalizeName(name); }
      if (str(item.umdNm)) c.umdNm = str(item.umdNm);
      if (str(item.umdCd)) c.umdCd = str(item.umdCd);
      if (str(item.jibun)) c.jibun = str(item.jibun);
      if (Number.isFinite(by)) c.buildYear = by;
      if (road) c.roadAddress = road;
    }
  }
  return { candidates: [...map.values()].sort((a, b) => a.aptSeq.localeCompare(b.aptSeq)), stats };
}

export type ReviewReason =
  | 'APTSEQ_MALFORMED'
  | 'APTSEQ_DISTRICT_MISMATCH'
  | 'SGG_CONFLICT'
  | 'MISSING_NAME'
  | 'MISSING_UMD'
  | 'MISSING_JIBUN'
  | 'CONFLICTING_UMD'
  | 'CONFLICTING_JIBUN';

export type Flag = 'NAME_ALIAS' | 'BUILD_YEAR_VARIANT' | 'RENT_ONLY' | 'NO_ROAD_ADDRESS';

export interface IdentityVerdict {
  aptSeq: string;
  verdict: 'SEED_READY' | 'REVIEW_REQUIRED';
  reasons: ReviewReason[];
  flags: Flag[];
}

export const APTSEQ_PATTERN = /^(\d{5})-(\d+)$/;

/**
 * seed 필수 필드: aptSeq(형식·구 일치) · name · umdNm/umdCd · jibun. 하나라도 없거나 원천끼리 어긋나면 REVIEW_REQUIRED.
 * 이름 표기 차이(단지명 변경 가능성)는 aptSeq identity를 흔들지 않으므로 표시만 한다(최신 표기 사용).
 */
export function classifyIdentity(c: SeedCandidate): IdentityVerdict {
  const reasons: ReviewReason[] = [];
  const flags: Flag[] = [];
  const m = APTSEQ_PATTERN.exec(c.aptSeq);
  if (!m) reasons.push('APTSEQ_MALFORMED');
  else if (m[1] !== c.lawdCd) reasons.push('APTSEQ_DISTRICT_MISMATCH');
  if (c.sggCds.some((s) => s !== c.lawdCd)) reasons.push('SGG_CONFLICT');
  if (!c.name) reasons.push('MISSING_NAME');
  if (!c.umdNm || !c.umdCd) reasons.push('MISSING_UMD');
  if (!c.jibun) reasons.push('MISSING_JIBUN');
  if (c.umdCds.length > 1) reasons.push('CONFLICTING_UMD');
  if (c.jibuns.length > 1) reasons.push('CONFLICTING_JIBUN');
  if (new Set(c.names.map(normalizeName)).size > 1) flags.push('NAME_ALIAS');
  if (c.buildYears.length > 1) flags.push('BUILD_YEAR_VARIANT');
  if (!c.sources.includes('SALE')) flags.push('RENT_ONLY');
  if (!c.roadAddress) flags.push('NO_ROAD_ADDRESS');
  return { aptSeq: c.aptSeq, verdict: reasons.length ? 'REVIEW_REQUIRED' : 'SEED_READY', reasons, flags };
}

export interface DuplicateAudit {
  /** 같은 aptSeq가 여러 구에서 관측(원천 중복) — 있으면 안 된다. */
  aptSeqAcrossDistricts: { aptSeq: string; lawdCds: string[] }[];
  /** 같은 구·같은 정규화 이름, 다른 aptSeq(차수·동군 가능 — merge 금지). */
  sameNameDifferentAptSeq: { lawdCd: string; normalizedName: string; aptSeqs: string[] }[];
  /** 같은 법정동코드+지번, 다른 aptSeq(한 필지 여러 단지 — 건축물대장·좌표를 공유하면 안 됨). */
  sameJibunDifferentAptSeq: { lawdCd: string; umdCd: string; jibun: string; aptSeqs: string[] }[];
  /** 같은 원천 도로명주소, 다른 aptSeq. */
  sameRoadDifferentAptSeq: { lawdCd: string; roadAddress: string; aptSeqs: string[] }[];
  /** 한 aptSeq에 정규화 이름이 2개 이상(단지명 변경/표기 alias 가능). */
  nameAliases: { aptSeq: string; names: string[] }[];
}

export function auditDuplicates(candidates: readonly SeedCandidate[]): DuplicateAudit {
  const group = <K>(keyOf: (c: SeedCandidate) => K | null) => {
    const m = new Map<string, { key: K; seqs: Set<string> }>();
    for (const c of candidates) {
      const k = keyOf(c);
      if (k == null) continue;
      const id = JSON.stringify(k);
      if (!m.has(id)) m.set(id, { key: k, seqs: new Set() });
      m.get(id)!.seqs.add(c.aptSeq);
    }
    return [...m.values()].filter((g) => g.seqs.size > 1);
  };
  const bySeq = new Map<string, Set<string>>();
  for (const c of candidates) {
    if (!bySeq.has(c.aptSeq)) bySeq.set(c.aptSeq, new Set());
    bySeq.get(c.aptSeq)!.add(c.lawdCd);
  }
  return {
    aptSeqAcrossDistricts: [...bySeq.entries()].filter(([, s]) => s.size > 1).map(([aptSeq, s]) => ({ aptSeq, lawdCds: [...s].sort() })),
    sameNameDifferentAptSeq: group((c) => (c.normalizedName ? { lawdCd: c.lawdCd, normalizedName: c.normalizedName } : null))
      .map((g) => ({ ...g.key, aptSeqs: [...g.seqs].sort() })),
    sameJibunDifferentAptSeq: group((c) => (c.umdCd && c.jibun ? { lawdCd: c.lawdCd, umdCd: c.umdCd, jibun: c.jibun } : null))
      .map((g) => ({ ...g.key, aptSeqs: [...g.seqs].sort() })),
    sameRoadDifferentAptSeq: group((c) => (c.roadAddress ? { lawdCd: c.lawdCd, roadAddress: c.roadAddress } : null))
      .map((g) => ({ ...g.key, aptSeqs: [...g.seqs].sort() })),
    nameAliases: candidates
      .filter((c) => new Set(c.names.map(normalizeName)).size > 1)
      .map((c) => ({ aptSeq: c.aptSeq, names: c.names })),
  };
}

export interface PilotRow {
  aptSeq: string | null;
  lawdCd: string;
  aptName: string;
  dong: string | null;
  jibun: string | null;
}

export type PilotMatch = 'EXACT' | 'REVIEW_REQUIRED' | 'UNMATCHED';

/**
 * 기존 서울 매매 파일럿 행 → seed 후보(MASTER → transaction 방향). 거래를 master의 원천으로 쓰지 않는다.
 * EXACT: 같은 aptSeq 후보가 있고 구·법정동·지번이 같다(이름은 정규화 비교).
 * REVIEW_REQUIRED: aptSeq는 있으나 구·법정동·지번·이름 중 하나가 다르다.
 * UNMATCHED: 거래에 aptSeq가 없거나, 그 aptSeq가 discovery 후보에 없다.
 */
export function reconcilePilotRow(row: PilotRow, bySeq: ReadonlyMap<string, SeedCandidate>): { match: PilotMatch; diffs: string[] } {
  if (!row.aptSeq) return { match: 'UNMATCHED', diffs: ['NO_APTSEQ'] };
  const c = bySeq.get(row.aptSeq);
  if (!c) return { match: 'UNMATCHED', diffs: ['NOT_IN_DISCOVERY'] };
  const diffs: string[] = [];
  if (c.lawdCd !== row.lawdCd) diffs.push('LAWDCD');
  if ((row.dong ?? '').trim() !== c.umdNm) diffs.push('DONG');
  if ((row.jibun ?? '').trim() !== c.jibun && !c.jibuns.includes((row.jibun ?? '').trim())) diffs.push('JIBUN');
  if (!c.names.map(normalizeName).includes(normalizeName(row.aptName))) diffs.push('NAME');
  return { match: diffs.length ? 'REVIEW_REQUIRED' : 'EXACT', diffs };
}

export type CoordinateVerdict = 'ACCEPT_EXACT' | 'WEAK_KEYWORD' | 'REJECT_REGION' | 'NO_RESULT';

/**
 * 좌표 판정. 주소(원천 도로명·건축물대장 주소) 검색 결과가 같은 시도·같은 구일 때만 ACCEPT_EXACT.
 * "{동} {단지명}" 키워드 결과는 첫 검색 결과라서 seed에 저장하지 않는다(WEAK_KEYWORD → REVIEW).
 */
export function classifyCoordinate(input: {
  queryKind: 'ADDRESS' | 'KEYWORD' | null;
  resultAddr: string | null;
  expectedSidoShort: string;
  expectedSigungu: string;
}): CoordinateVerdict {
  if (!input.queryKind || !input.resultAddr) return 'NO_RESULT';
  const t = input.resultAddr.split(/\s+/);
  if (!t[0] || !t[0].startsWith(input.expectedSidoShort) || t[1] !== input.expectedSigungu) return 'REJECT_REGION';
  return input.queryKind === 'ADDRESS' ? 'ACCEPT_EXACT' : 'WEAK_KEYWORD';
}

/** endpoint당 한도(창) 대비 필요한 창 수. */
export function quotaWindows(calls: number, perWindow = 10000): number {
  return Math.max(0, Math.ceil(calls / perWindow));
}

/**
 * 같은 aptSeq가 여러 구 조회 결과에 나타나면(MOLIT가 이웃 구 LAWD_CD 응답에 싣는 사례) aptSeq 앞 5자리 구를 canonical로 쓴다.
 * 단, 두 쪽의 이름(정규화)·법정동·지번이 모두 같을 때만 — 하나라도 다르면 어느 쪽이 맞는지 추정하지 않고 CONFLICT.
 */
export function resolveCrossDistrict(entries: readonly SeedCandidate[]): { canonical: SeedCandidate | null; kind: 'SINGLE' | 'MISFILED_REPORT' | 'CONFLICT' } {
  if (entries.length === 1) return { canonical: entries[0], kind: 'SINGLE' };
  const prefix = entries[0].aptSeq.slice(0, 5);
  const home = entries.find((e) => e.lawdCd === prefix) ?? null;
  const sig = (e: SeedCandidate) => JSON.stringify([e.normalizedName, e.umdNm, e.jibun]);
  const same = entries.every((e) => sig(e) === sig(entries[0]));
  if (!home || !same) return { canonical: null, kind: 'CONFLICT' };
  return { canonical: home, kind: 'MISFILED_REPORT' };
}

/**
 * 전월세 원천에는 umdCd가 없다. 같은 구 매매 원천의 (구, 법정동명) → umdCd 대응이 **하나뿐**일 때만 그 값을 쓴다.
 * 대응이 없거나 둘 이상이면 null(REVIEW) — 법정동코드를 이름으로 추정하지 않는다.
 */
export function buildDongCodeMap(saleCandidates: readonly SeedCandidate[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of saleCandidates) {
    if (!c.umdNm) continue;
    for (const code of c.umdCds) {
      const k = `${c.lawdCd}|${c.umdNm}`;
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(code);
    }
  }
  return m;
}

export function resolveUmdCd(c: SeedCandidate, dongMap: ReadonlyMap<string, Set<string>>): string | null {
  if (c.umdCd) return c.umdCd;
  const s = dongMap.get(`${c.lawdCd}|${c.umdNm}`);
  return s && s.size === 1 ? [...s][0] : null;
}
