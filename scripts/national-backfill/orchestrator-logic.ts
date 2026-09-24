// NATIONAL_BACKFILL_ORCHESTRATOR_V1 — 전국 매매 full-history backfill 오케스트레이터의 **순수 판정**.
//
// DB·네트워크·파일 없음. 여기서는 순서·예산·상태·게이트만 결정한다.
// 셀 단위 수집·계획·적재는 검증된 서울 driver(scripts/backfill-seoul-sale.ts → 운영 cron과 같은
// planSaleCellWrites / syncOneSaleCell)를 **그대로** 쓴다 — 취소·insert 판정을 복제하지 않는다.
//
// 절대 원칙(이 파일의 모든 판정이 따르는 것):
//   · 틀린 데이터보다 데이터 없음이 낫다 — 모르면 REVIEW/BLOCKED이지 추측이 아니다.
//   · 지역은 5자리 canonical 코드로만 판정한다(접두사·이름 추측 없음).
//   · backfill 완료는 공개도 cron 편입도 아니다 — 후보만 출력한다.

import { createHash } from 'crypto';

// ───────────────────────── 1. 전국 지역 inventory ─────────────────────────

export interface InventorySnapshot {
  source: string;
  fetchedAt: string;
  sidos: { code: string; name: string }[];
  sigungu: { lawdCd: string; fullName: string }[];
  /** 프록시에 없는 것으로 확인된 지역(코드를 지어내지 않고 사실만 기록). */
  knownGaps: { what: string; note: string }[];
  /** 사람이 검토해야 하는 코드 체계 의심. key = 시도 2자리 또는 lawdCd 5자리. */
  reviewNotes: Record<string, string>;
}

export interface InventoryEntry {
  lawdCd: string;
  sidoCode: string;
  sidoName: string;
  /** 시도 이름을 뺀 표시명(예: '성남시 분당구'). */
  displayName: string;
  fullName: string;
  /** 일반구를 가진 시의 부모 코드는 false — 부모로 조회하면 자식과 중복 수집된다. */
  isMolitLeaf: boolean;
  parentLawdCd: string | null;
  /** reviewNotes에 걸린 사유(시도 단위 + 구 단위). */
  reviewNotes: string[];
}

export interface Inventory {
  entries: InventoryEntry[];
  errors: string[];
  gaps: InventorySnapshot['knownGaps'];
}

/**
 * 스냅샷 → inventory. leaf 판정 규칙: 코드가 0으로 끝나고 **같은 앞 4자리**를 가진 다른 코드가 있으면 부모 시.
 * (registry.ts의 수기 isMolitLeaf와 89/89 일치 — crossCheckWithRegistry로 매번 확인한다.)
 */
export function buildInventory(s: InventorySnapshot): Inventory {
  const errors: string[] = [];
  const sidoName = new Map(s.sidos.map((x) => [x.code, x.name]));
  const codes = s.sigungu.map((x) => x.lawdCd);
  const seen = new Set<string>();
  for (const c of codes) {
    if (!/^\d{5}$/.test(c)) errors.push(`INVALID_CODE_${c}`);
    if (seen.has(c)) errors.push(`DUPLICATE_CODE_${c}`);
    seen.add(c);
    if (!sidoName.has(c.slice(0, 2))) errors.push(`UNKNOWN_SIDO_${c}`);
    if (c.endsWith('000')) errors.push(`SIDO_ROW_AS_DISTRICT_${c}`);
  }
  // 부모 판정은 코드 앞 4자리만으로 하지 않는다 — 충북 영동군(43740)과 증평군(43745)처럼 앞 4자리가 같은
  // **별개 군**이 있다. 자식의 전체 이름이 부모 이름 + 공백으로 시작할 때만(= 그 시의 일반구) 부모다.
  const nameOf = new Map(s.sigungu.map((x) => [x.lawdCd, x.fullName]));
  const isChildOf = (child: string, parent: string) =>
    child !== parent && child.slice(0, 4) === parent.slice(0, 4) && parent.endsWith('0')
    && (nameOf.get(child) ?? '').startsWith(`${nameOf.get(parent) ?? '\u0000'} `);
  const isParent = (c: string) => codes.some((o) => isChildOf(o, c));
  const entries = s.sigungu.map(({ lawdCd, fullName }) => {
    const sidoCode = lawdCd.slice(0, 2);
    const sn = sidoName.get(sidoCode) ?? '';
    const parent = codes.find((o) => isChildOf(lawdCd, o)) ?? null;
    if (sn && !fullName.startsWith(sn)) errors.push(`NAME_SIDO_MISMATCH_${lawdCd}`);
    return {
      lawdCd, sidoCode, sidoName: sn, fullName,
      displayName: fullName.slice(sn.length).trim(),
      isMolitLeaf: !isParent(lawdCd),
      parentLawdCd: parent,
      reviewNotes: [s.reviewNotes[sidoCode], s.reviewNotes[lawdCd]].filter((x): x is string => !!x),
    };
  });
  return { entries, errors, gaps: s.knownGaps };
}

/** registry.ts(부산·서울·경기, 수기 검증)와 코드·이름·leaf가 전부 같은지. 하나라도 다르면 스냅샷을 믿지 않는다. */
export function crossCheckWithRegistry(
  inv: Inventory,
  registry: readonly { lawdCd: string; fullName: string; sidoCode: string; isMolitLeaf: boolean }[]
): { ok: boolean; missingInSnapshot: string[]; extraInSnapshot: string[]; nameMismatch: string[]; leafMismatch: string[]; inventoryErrors: string[] } {
  const regSidos = new Set(registry.map((r) => r.sidoCode));
  const snap = new Map(inv.entries.filter((e) => regSidos.has(e.sidoCode)).map((e) => [e.lawdCd, e]));
  const reg = new Map(registry.map((r) => [r.lawdCd, r]));
  const missingInSnapshot = [...reg.keys()].filter((k) => !snap.has(k));
  const extraInSnapshot = [...snap.keys()].filter((k) => !reg.has(k));
  const nameMismatch = [...reg.values()].filter((r) => snap.has(r.lawdCd) && snap.get(r.lawdCd)!.fullName !== r.fullName).map((r) => r.lawdCd);
  const leafMismatch = [...reg.values()].filter((r) => snap.has(r.lawdCd) && snap.get(r.lawdCd)!.isMolitLeaf !== r.isMolitLeaf).map((r) => r.lawdCd);
  const ok = !missingInSnapshot.length && !extraInSnapshot.length && !nameMismatch.length && !leafMismatch.length && !inv.errors.length;
  return { ok, missingInSnapshot, extraInSnapshot, nameMismatch, leafMismatch, inventoryErrors: inv.errors };
}

// ───────────────────────── 2. 기간 ─────────────────────────

/** 서울 실측 최초 매매 달(SEOUL_SALE_BACKFILL_PLAN_V1 §2). 전국 backfill도 같은 시작점을 쓴다 — 빈 달은 EMPTY_VALID로 1콜씩. */
export const NATIONAL_SALE_START = '200507';

export function ymAdd(ym: string, n: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1 + n, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(from: string, to: string): number {
  if (from > to) return 0;
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(4, 6)) - Number(from.slice(4, 6)) + 1;
}

// ───────────────────────── 3. 분류 ─────────────────────────

export type DistrictStatus = 'COMPLETE' | 'PARTIAL' | 'EMPTY' | 'NOT_STARTED' | 'REVIEW_REQUIRED' | 'BLOCKED';

export interface DistrictEvidence {
  lawdCd: string;
  tradeRows: number;
  canceledRows: number;
  earliestYm: string | null;
  latestYm: string | null;
  monthsWithRows: number;
  distinctAptSeq: number;
  masters: number;
  geocodedMasters: number;
  coverageCells: number;
  emptyValidCoverageCells: number;
  latestVerifiedAt: string | null;
  inCron: boolean;
  isPublic: boolean;
  /** 월별 행 수(deal_ymd → rows). 페이지 추정·연속성 판단에 쓴다. */
  monthly?: Record<string, number>;
}

export interface ClassifyContext {
  /** 완료로 인정할 최초 달 상한(이보다 늦게 시작하면 전체 이력이 아니다). */
  historyStartBy: string;
  /** 최신 완료월(현재 KST 달 − 1). */
  latestComplete: string;
  /** 커버리지가 최신이라고 볼 시간(ms). */
  freshnessMs: number;
  now: Date;
  /** 전체 이력으로 인정할 최소 월 채움 비율. */
  minMonthFill: number;
}

export const DEFAULT_CLASSIFY: Omit<ClassifyContext, 'latestComplete' | 'now'> = {
  historyStartBy: '200612',
  freshnessMs: 3 * 24 * 3600 * 1000,
  minMonthFill: 0.9,
};

/**
 * 증거 → 상태. 하드코딩된 "부산=완료" 같은 규칙은 없다 — 전부 행·커버리지·cron 사실로만 판정한다.
 *   BLOCKED         부모 시 코드(수집 단위가 아님)
 *   REVIEW_REQUIRED 코드 체계 의심 메모가 있다 / 이력은 있는데 정기 유지(cron·최신 커버리지)가 없다
 *   NOT_STARTED     행 0, 커버리지 0
 *   EMPTY           행 0인데 커버리지 셀이 전부 EMPTY_VALID(원천이 비었다고 **확인**됨)
 *   PARTIAL         행은 있지만 시작이 늦거나 월 채움이 부족하다
 *   COMPLETE        전체 이력 + 월 채움 + cron 유지 + 최신 커버리지
 */
export function classifyDistrict(entry: Pick<InventoryEntry, 'isMolitLeaf' | 'reviewNotes'>, ev: DistrictEvidence, ctx: ClassifyContext): { status: DistrictStatus; reasons: string[] } {
  if (!entry.isMolitLeaf) return { status: 'BLOCKED', reasons: ['PARENT_CODE_NOT_COLLECTED'] };
  if (ev.tradeRows === 0) {
    if (entry.reviewNotes.length) return { status: 'REVIEW_REQUIRED', reasons: ['CODE_SYSTEM_REVIEW', ...entry.reviewNotes] };
    if (ev.coverageCells > 0 && ev.emptyValidCoverageCells === ev.coverageCells) return { status: 'EMPTY', reasons: ['ALL_COVERAGE_EMPTY_VALID'] };
    if (ev.coverageCells > 0) return { status: 'REVIEW_REQUIRED', reasons: ['COVERAGE_WITHOUT_ROWS'] };
    return { status: 'NOT_STARTED', reasons: [] };
  }
  const reasons: string[] = [];
  const startsEarly = ev.earliestYm != null && ev.earliestYm <= ctx.historyStartBy;
  const expected = ev.earliestYm ? monthsBetween(ev.earliestYm, ctx.latestComplete) : 0;
  const fill = expected > 0 ? ev.monthsWithRows / expected : 0;
  if (!startsEarly) reasons.push(`HISTORY_STARTS_${ev.earliestYm}`);
  if (fill < ctx.minMonthFill) reasons.push(`MONTH_FILL_${fill.toFixed(2)}`);
  if (reasons.length) return { status: 'PARTIAL', reasons };
  const fresh = ev.latestVerifiedAt != null && ctx.now.getTime() - new Date(ev.latestVerifiedAt).getTime() <= ctx.freshnessMs;
  if (!ev.inCron) reasons.push('NOT_IN_CRON');
  if (!fresh) reasons.push('COVERAGE_STALE');
  if (entry.reviewNotes.length) reasons.push('CODE_SYSTEM_REVIEW');
  if (reasons.length) return { status: 'REVIEW_REQUIRED', reasons: ['HISTORY_PRESENT_NOT_MAINTAINED', ...reasons] };
  return { status: 'COMPLETE', reasons: [] };
}

// ───────────────────────── 4. 호출 수 추정 ─────────────────────────

export const MOLIT_PAGE_SIZE = 1000;

export interface EstimateParams {
  from: string;
  to: string;
  /** 이력이 없는 구에 쓰는 사전(prior) 다중 페이지 비율(월 중 1000행 초과 비율의 관측 최대). */
  priorMultipageRate: number;
  /** 이력이 없는 구의 추가 안전 여유(곱). */
  unknownVolumeMargin: number;
  /** 이력이 있는 구의 여유(재시도·신규 거래). */
  knownVolumeMargin: number;
}

export interface CallEstimate {
  lawdCd: string;
  months: number;
  basis: 'HISTORICAL' | 'PRIOR';
  /** 월당 1페이지 기준. */
  basePages: number;
  /** 1000행 초과 달의 추가 페이지(관측 또는 prior). */
  extraPages: number;
  multipageRate: number;
  riskMargin: number;
  /** 기대값(여유 제외). */
  estimatedCalls: number;
  /** 계획에 쓰는 상한(여유 포함, 올림). */
  plannedCalls: number;
}

/**
 * 셀 = 구 × 월. 한 셀은 ceil(totalCount/1000) 페이지(최소 1). 1콜 = 1페이지.
 * 이력이 있으면 DB 월별 행 수로 **실제** 추가 페이지를 센다. 없으면 관측 최대 다중 페이지 비율(prior)을 쓴다.
 * 원천 행 수는 DB 행 수 이상일 수 있으므로(철회·미적재) knownVolumeMargin을 곱한다.
 */
export function estimateDistrictCalls(lawdCd: string, monthly: Record<string, number> | null, p: EstimateParams): CallEstimate {
  const months = monthsBetween(p.from, p.to);
  const hasHistory = monthly != null && Object.keys(monthly).length > 0;
  let extraPages: number;
  let multipageRate: number;
  if (hasHistory) {
    extraPages = 0;
    let multi = 0;
    for (const [ym, n] of Object.entries(monthly!)) {
      if (ym < p.from || ym > p.to) continue;
      const pages = Math.max(1, Math.ceil(n / MOLIT_PAGE_SIZE));
      extraPages += pages - 1;
      if (pages > 1) multi++;
    }
    multipageRate = months ? multi / months : 0;
  } else {
    multipageRate = p.priorMultipageRate;
    extraPages = Math.ceil(months * p.priorMultipageRate);
  }
  const riskMargin = hasHistory ? p.knownVolumeMargin : p.unknownVolumeMargin;
  const estimatedCalls = months + extraPages;
  return { lawdCd, months, basis: hasHistory ? 'HISTORICAL' : 'PRIOR', basePages: months, extraPages, multipageRate, riskMargin, estimatedCalls, plannedCalls: Math.ceil(estimatedCalls * riskMargin) };
}

/** 관측된 구들 중 "1000행 초과 달" 비율의 최대값 — 모르는 구에 쓸 보수적 prior. */
export function observedMaxMultipageRate(monthlyByDistrict: Record<string, Record<string, number>>): number {
  let max = 0;
  for (const m of Object.values(monthlyByDistrict)) {
    const vals = Object.values(m);
    if (vals.length < 24) continue; // 파일럿 수준 표본은 비율을 왜곡한다
    const r = vals.filter((n) => n > MOLIT_PAGE_SIZE).length / vals.length;
    if (r > max) max = r;
  }
  return max;
}

/**
 * SEOUL 실측: dry-run이 원천을 가져오고, apply(realApplyCell → syncOneSaleCell)는 **셀마다 원천을 다시 가져온다**.
 * 따라서 apply ≈ dry-run 호출 수다. raw 재사용으로 apply를 0콜로 만드는 코드는 없으므로 0으로 보고하지 않는다.
 */
export function twoPassCost(dryRunCalls: number): { dryRun: number; apply: number; total: number; applyReusesRaw: false } {
  return { dryRun: dryRunCalls, apply: dryRunCalls, total: dryRunCalls * 2, applyReusesRaw: false };
}

// ───────────────────────── 5. quota 예산 ─────────────────────────

export interface QuotaModel {
  dailyLimit: number;
  reserve: number;
  cronAllowance: number;
  appAllowance: number;
}

/**
 * 운영 cron 하루 호출량(코드 상수에서 계산, 추측 아님):
 *   부산 sale-sync 16구 × 4개월 · 부산 recheck ≤ band 16 × 10 · 부산 rent-sync 16구 × 2개월
 *   서울 sale-sync 8구 × 4개월 · 서울 recheck 8 × 10
 * 페이지 여유는 pageMargin(곱)으로 준다.
 */
export function estimateCronCalls(input: { busanDistricts: number; seoulDistricts: number; saleMonths: number; recheckMonths: number; rentMonths: number; pageMargin: number }): number {
  const base = input.busanDistricts * (input.saleMonths + input.recheckMonths + input.rentMonths) + input.seoulDistricts * (input.saleMonths + input.recheckMonths);
  return Math.ceil(base * input.pageMargin);
}

export function safeBackfillBudget(q: QuotaModel): number {
  return Math.max(0, q.dailyLimit - q.reserve - q.cronAllowance - q.appAllowance);
}

// ───────────────────────── 6. 배치 계획 ─────────────────────────

export type Strategy = 'priority' | 'sido' | 'manual';

export interface PlanCandidate {
  entry: InventoryEntry;
  status: DistrictStatus;
  statusReasons: string[];
  estimate: CallEstimate;
  masters: number;
  geocodedMasters: number;
}

export interface PlanRequest {
  strategy: Strategy;
  sido?: string | null;
  districts?: string[] | null;
  maxCalls: number;
  maxDistricts: number;
  quota: QuotaModel;
}

export interface PlannedDistrict {
  lawdCd: string;
  fullName: string;
  rank: number;
  estimate: CallEstimate;
  cost: ReturnType<typeof twoPassCost>;
  masters: number;
  geocodedMasters: number;
  masterCoverage: 'NONE' | 'WEAK' | 'GOOD';
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  riskReasons: string[];
}

export interface BatchPlan {
  verdict: 'PLANNED' | 'BLOCKED_BY_QUOTA_PLAN' | 'NOTHING_ELIGIBLE' | 'INVALID_REQUEST';
  strategy: Strategy;
  request: { sido: string | null; districts: string[] | null; maxCalls: number; maxDistricts: number };
  districts: PlannedDistrict[];
  excluded: { lawdCd: string; reason: string }[];
  totals: { dryRun: number; apply: number; total: number };
  quota: QuotaModel & { safeBudget: number; sameDayFeasible: boolean; windowsNeeded: number };
  errors: string[];
}

/**
 * 확장 우선순위(시도). 수도권 → 인천 → 서울 잔여 → 광역시 → 나머지. 이것은 **기본 순서**일 뿐이고,
 * 각 구의 적격성(상태·검토 메모·leaf)은 증거로 판정한다. 검토 메모가 있는 구는 순서와 무관하게 제외된다.
 */
export const SIDO_PRIORITY = ['41', '28', '11', '27', '29', '30', '31', '36', '48', '47', '44', '43', '46', '45', '51', '50'] as const;

function sidoRank(code: string): number {
  const i = (SIDO_PRIORITY as readonly string[]).indexOf(code);
  return i < 0 ? SIDO_PRIORITY.length : i;
}

/** 군은 수요가 낮다(수도권 우선 원칙의 연장). 자치구·일반구·시를 먼저. */
function typeRank(e: InventoryEntry): number {
  return /군$/.test(e.displayName) ? 1 : 0;
}

export function masterCoverageOf(masters: number, geocoded: number): PlannedDistrict['masterCoverage'] {
  if (masters === 0) return 'NONE';
  return geocoded / masters >= 0.9 ? 'GOOD' : 'WEAK';
}

function riskOf(c: PlanCandidate): { risk: PlannedDistrict['risk']; reasons: string[] } {
  const reasons: string[] = [];
  if (c.estimate.basis === 'PRIOR') reasons.push('VOLUME_UNKNOWN_PRIOR_ESTIMATE');
  if (c.entry.parentLawdCd) reasons.push('GENERAL_DISTRICT_OF_CITY');
  if (c.masters === 0) reasons.push('NO_MASTER_MAP_EXPOSURE_LATER');
  if (c.status === 'PARTIAL') reasons.push('EXISTING_PARTIAL_ROWS');
  const risk = c.status === 'PARTIAL' ? 'HIGH' : reasons.length >= 3 ? 'MEDIUM' : 'LOW';
  return { risk, reasons };
}

/** 자동 계획에 넣을 수 있는 상태. PARTIAL은 기존 행과 섞이므로 manual에서만 허용한다. */
function eligibility(c: PlanCandidate, strategy: Strategy): string | null {
  if (!c.entry.isMolitLeaf) return 'PARENT_CODE_NOT_COLLECTED';
  if (c.status === 'BLOCKED') return 'BLOCKED';
  if (c.status === 'REVIEW_REQUIRED') return `REVIEW_REQUIRED:${c.statusReasons.join('|')}`;
  if (c.status === 'COMPLETE') return 'ALREADY_COMPLETE';
  if (c.status === 'EMPTY') return 'VERIFIED_EMPTY';
  if (c.status === 'PARTIAL' && strategy !== 'manual') return 'PARTIAL_REQUIRES_MANUAL';
  return null;
}

/** 결정론적 배치 선택. 같은 입력이면 항상 같은 출력(정렬 키 마지막은 lawdCd). */
export function planBatch(candidates: readonly PlanCandidate[], req: PlanRequest): BatchPlan {
  const errors: string[] = [];
  const safeBudget = safeBackfillBudget(req.quota);
  const maxCalls = Math.min(req.maxCalls, safeBudget);
  const request = { sido: req.sido ?? null, districts: req.districts ?? null, maxCalls: req.maxCalls, maxDistricts: req.maxDistricts };
  const byCode = new Map(candidates.map((c) => [c.entry.lawdCd, c]));
  const excluded: BatchPlan['excluded'] = [];

  let pool: PlanCandidate[];
  if (req.strategy === 'manual') {
    if (!req.districts?.length) errors.push('MANUAL_REQUIRES_DISTRICTS');
    pool = [];
    for (const d of req.districts ?? []) {
      const c = byCode.get(d);
      if (!c) { errors.push(`UNKNOWN_DISTRICT_${d}`); continue; }
      pool.push(c);
    }
  } else if (req.strategy === 'sido') {
    if (!req.sido) errors.push('SIDO_STRATEGY_REQUIRES_SIDO');
    pool = candidates.filter((c) => c.entry.sidoCode === req.sido);
  } else {
    pool = [...candidates];
  }
  if (req.maxDistricts < 1) errors.push('MAX_DISTRICTS_LT_1');
  if (req.maxCalls < 1) errors.push('MAX_CALLS_LT_1');

  const eligible: PlanCandidate[] = [];
  for (const c of pool) {
    const why = eligibility(c, req.strategy);
    if (why) excluded.push({ lawdCd: c.entry.lawdCd, reason: why }); else eligible.push(c);
  }
  if (req.strategy === 'manual') for (const x of excluded) errors.push(`MANUAL_DISTRICT_INELIGIBLE_${x.lawdCd}_${x.reason}`);

  const ordered = req.strategy === 'manual'
    ? eligible
    : [...eligible].sort((a, b) =>
      sidoRank(a.entry.sidoCode) - sidoRank(b.entry.sidoCode)
      || typeRank(a.entry) - typeRank(b.entry)
      || a.entry.lawdCd.localeCompare(b.entry.lawdCd));

  // 자동 전략에서는 한 시의 일반구를 **한 묶음**으로만 넣는다(수원 4구 중 2구만 열리는 식의 반쪽 도시를 만들지 않는다).
  // 묶음 안에 부적격 구가 하나라도 있으면(예: 검토 대상) 나머지도 이번 배치에서 뺀다.
  const units: PlanCandidate[][] = [];
  if (req.strategy === 'manual') for (const c of ordered) units.push([c]);
  else {
    const byParent = new Map<string, PlanCandidate[]>();
    for (const c of ordered) {
      const p = c.entry.parentLawdCd;
      if (!p) { units.push([c]); continue; }
      if (!byParent.has(p)) { byParent.set(p, []); units.push(byParent.get(p)!); }
      byParent.get(p)!.push(c);
    }
    const siblingsIneligible = new Set(excluded.map((x) => byCode.get(x.lawdCd)?.entry.parentLawdCd).filter((p): p is string => !!p));
    for (let i = units.length - 1; i >= 0; i--) {
      const p = units[i][0].entry.parentLawdCd;
      if (p && siblingsIneligible.has(p)) {
        for (const c of units[i]) excluded.push({ lawdCd: c.entry.lawdCd, reason: 'CITY_GROUP_HAS_INELIGIBLE_SIBLING' });
        units.splice(i, 1);
      }
    }
  }

  const picked: PlannedDistrict[] = [];
  let sum = 0;
  for (const unit of units) {
    const unitCalls = unit.reduce((s, c) => s + c.estimate.plannedCalls, 0);
    if (picked.length + unit.length > req.maxDistricts) { for (const c of unit) excluded.push({ lawdCd: c.entry.lawdCd, reason: 'MAX_DISTRICTS' }); continue; }
    if (sum + unitCalls > maxCalls) {
      for (const c of unit) {
        excluded.push({ lawdCd: c.entry.lawdCd, reason: 'MAX_CALLS' });
        if (req.strategy === 'manual') errors.push(`MANUAL_EXCEEDS_BUDGET_${c.entry.lawdCd}`);
      }
      continue;
    }
    sum += unitCalls;
    for (const c of unit) {
      const r = riskOf(c);
      picked.push({
        lawdCd: c.entry.lawdCd, fullName: c.entry.fullName, rank: picked.length + 1,
        estimate: c.estimate, cost: twoPassCost(c.estimate.plannedCalls),
        masters: c.masters, geocodedMasters: c.geocodedMasters, masterCoverage: masterCoverageOf(c.masters, c.geocodedMasters),
        risk: r.risk, riskReasons: r.reasons,
      });
    }
  }
  const totals = picked.reduce((t, d) => ({ dryRun: t.dryRun + d.cost.dryRun, apply: t.apply + d.cost.apply, total: t.total + d.cost.total }), { dryRun: 0, apply: 0, total: 0 });
  const quota = { ...req.quota, safeBudget, sameDayFeasible: totals.total <= safeBudget, windowsNeeded: safeBudget > 0 ? Math.ceil(totals.total / safeBudget) : Infinity };

  let verdict: BatchPlan['verdict'] = 'PLANNED';
  if (errors.length) verdict = 'INVALID_REQUEST';
  else if (safeBudget <= 0 || totals.dryRun > safeBudget) verdict = 'BLOCKED_BY_QUOTA_PLAN';
  else if (!picked.length) verdict = eligible.length ? 'BLOCKED_BY_QUOTA_PLAN' : 'NOTHING_ELIGIBLE';
  return { verdict, strategy: req.strategy, request, districts: picked, excluded, totals, quota, errors };
}

// ───────────────────────── 7. checkpoint 상태 ─────────────────────────

export type NationalCellState = 'PENDING' | 'FETCHED' | 'READY' | 'APPLIED' | 'EMPTY_VALID' | 'REVIEW' | 'BLOCKED' | 'ERROR';

/** driver(backfill-seoul-sale) 셀 상태 → 전국 상태. 파일 존재가 아니라 **기록된 상태**로만 판정한다. */
export function mapDriverCellState(c: { state: string; totalCount?: number | null } | undefined, hasReview: boolean): NationalCellState {
  if (!c) return 'PENDING';
  switch (c.state) {
    case 'APPLIED': return 'APPLIED';
    case 'PARTIAL': return 'ERROR';
    case 'BLOCKED': return 'BLOCKED';
    case 'PENDING': return 'PENDING';
    case 'FETCHED':
    case 'VALIDATED': return 'FETCHED';
    case 'READY':
      if (hasReview) return 'REVIEW';
      return c.totalCount === 0 ? 'EMPTY_VALID' : 'READY';
    default: return 'ERROR';
  }
}

export type NationalDistrictState = 'PENDING' | 'IN_PROGRESS' | 'READY' | 'APPLIED' | 'REVIEW' | 'BLOCKED' | 'ERROR';

/** 셀들 → 구 상태. 나쁜 상태가 우선한다(하나라도 ERROR면 구는 ERROR). */
export function aggregateDistrictState(cells: readonly NationalCellState[], expectedCells: number): NationalDistrictState {
  if (cells.includes('ERROR')) return 'ERROR';
  if (cells.includes('BLOCKED')) return 'BLOCKED';
  if (cells.includes('REVIEW')) return 'REVIEW';
  const done = cells.filter((s) => s === 'APPLIED' || s === 'EMPTY_VALID').length;
  const applied = cells.filter((s) => s === 'APPLIED').length;
  if (cells.length === expectedCells && done === expectedCells && applied > 0) return 'APPLIED';
  const ready = cells.filter((s) => s === 'READY' || s === 'EMPTY_VALID' || s === 'APPLIED').length;
  if (cells.length === expectedCells && ready === expectedCells) return 'READY';
  return cells.some((s) => s !== 'PENDING') ? 'IN_PROGRESS' : 'PENDING';
}

// ───────────────────────── 8. resume ─────────────────────────

export type ResumeAction = 'SKIP_APPLIED' | 'SKIP_REVIEW' | 'SKIP_BLOCKED' | 'SKIP_ERROR' | 'RUN_DRY_RUN' | 'RETRY_ERROR' | 'SKIP_READY';

/**
 * 재개 시 구별 동작. dry-run(읽기 전용)만 다룬다 — apply는 별도 게이트.
 *   APPLIED  다시 돌리지 않는다
 *   REVIEW / BLOCKED  자동으로 넘어가지 않는다(사람이 판단)
 *   ERROR    --retry-errors일 때만
 *   READY    이미 계획 완료 — --replan일 때만 다시(raw 재사용, MOLIT 0콜)
 */
export function resumeAction(state: NationalDistrictState, opts: { retryErrors: boolean; replan: boolean }): ResumeAction {
  switch (state) {
    case 'APPLIED': return 'SKIP_APPLIED';
    case 'REVIEW': return 'SKIP_REVIEW';
    case 'BLOCKED': return 'SKIP_BLOCKED';
    case 'ERROR': return opts.retryErrors ? 'RETRY_ERROR' : 'SKIP_ERROR';
    case 'READY': return opts.replan ? 'RUN_DRY_RUN' : 'SKIP_READY';
    default: return 'RUN_DRY_RUN';
  }
}

// ───────────────────────── 9. 원천 연속성(코드 체계 변경 탐지) ─────────────────────────

/**
 * 행정구역 코드가 바뀐 구는 옛 달 또는 새 달이 **0건**으로 돌아온다. 그것을 "거래 없음"으로 받으면
 * 조용히 불완전한 이력이 된다. 거래가 꾸준한 구에서 앞/뒤로 긴 0건 구간이 있거나 전부 0이면 REVIEW.
 */
export function detectCodeDiscontinuity(
  totals: Record<string, number>,
  opts: { minRun: number; minActiveAvg: number } = { minRun: 12, minActiveAvg: 5 }
): string[] {
  const yms = Object.keys(totals).sort();
  if (!yms.length) return [];
  const vals = yms.map((y) => totals[y]);
  const nonZero = vals.filter((v) => v > 0);
  if (!nonZero.length) return ['ALL_MONTHS_EMPTY'];
  const avg = nonZero.reduce((s, v) => s + v, 0) / nonZero.length;
  if (avg < opts.minActiveAvg) return [];
  const flags: string[] = [];
  let lead = 0; while (lead < vals.length && vals[lead] === 0) lead++;
  let trail = 0; while (trail < vals.length && vals[vals.length - 1 - trail] === 0) trail++;
  // 원천 최초 달(2005~2006) 앞쪽의 빈 달은 정상이다 — 2007 이후에 시작하는 긴 공백만 본다.
  if (lead >= opts.minRun && yms[lead] > '200712') flags.push(`LEADING_EMPTY_${lead}_UNTIL_${yms[lead]}`);
  if (trail >= opts.minRun) flags.push(`TRAILING_EMPTY_${trail}_FROM_${yms[vals.length - trail]}`);
  let run = 0;
  for (let i = lead; i < vals.length - trail; i++) {
    run = vals[i] === 0 ? run + 1 : 0;
    if (run === opts.minRun) flags.push(`INTERIOR_EMPTY_RUN_AT_${yms[i - run + 1]}`);
  }
  return flags;
}

// ───────────────────────── 10. plan hash · apply 게이트 ─────────────────────────

export interface HashableCell {
  lawdCd: string;
  ym: string;
  state: string;
  totalCount: number | null;
  inserts: number;
  cancelFlips: number;
  cancelRestores: number;
  registrySupplements: number;
  reviewCandidates: number;
  insertKeys: string[];
}

/** 계획의 결정적 지문. 셀 순서·키 순서와 무관하게 같은 계획이면 같은 hash. */
export function planHash(cells: readonly HashableCell[]): string {
  const norm = [...cells]
    .map((c) => ({ ...c, insertKeys: [...c.insertKeys].sort() }))
    .sort((a, b) => a.lawdCd.localeCompare(b.lawdCd) || a.ym.localeCompare(b.ym));
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

export interface NationalApplyGateInput {
  apply: boolean;
  env: Record<string, string | undefined>;
  /** plan.json에 기록된 구 목록과 이번 apply 요청 구 목록. */
  plannedDistricts: readonly string[];
  requestedDistricts: readonly string[];
  expectInserts: number | null;
  plannedInserts: number;
  /** dry-run 시 기록한 hash / apply 직전 raw 재계획(MOLIT 0콜)으로 다시 계산한 hash / 사용자가 넘긴 hash. */
  recordedPlanHash: string | null;
  recomputedPlanHash: string | null;
  givenPlanHash: string | null;
  recordedReview: number;
  currentReview: number;
  unexpectedUpdates: number;
  approveExistingUpdates: boolean;
  districtStates: Record<string, NationalDistrictState>;
  /** 마지막으로 관측한 MOLIT 잔여량과 그 시각. 모르면 null(→ 거부). */
  observedQuota: { remaining: number; at: string } | null;
  now: Date;
  reserve: number;
  applyEstimate: number;
  quotaMaxAgeMs: number;
}

/**
 * 전국 apply 게이트. 서울 driver의 evaluateApplyGates 앞에 한 겹 더 둔다(그 게이트도 그대로 다시 통과해야 한다).
 * 하나라도 걸리면 거부한다. 우회 플래그는 existing update 승인 하나뿐이고, 그것도 hash가 같을 때만 의미가 있다.
 */
export function evaluateNationalApplyGate(g: NationalApplyGateInput): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!g.apply) reasons.push('NO_APPLY_FLAG');
  if (g.env.ALLOW_PROD_DB_READ !== '1') reasons.push('ALLOW_PROD_DB_READ_NOT_1');
  if (g.env.ALLOW_PROD_DB_WRITE !== '1') reasons.push('ALLOW_PROD_DB_WRITE_NOT_1');
  if (g.env.DEFECT_A_GATE_PASS !== '1') reasons.push('DEFECT_A_GATE_NOT_PASSED');
  const a = [...g.plannedDistricts].sort().join(',');
  const b = [...g.requestedDistricts].sort().join(',');
  if (!b) reasons.push('DISTRICTS_REQUIRED');
  else if (a !== b) reasons.push(`DISTRICT_SCOPE_CHANGED_${a}_VS_${b}`);
  for (const d of g.requestedDistricts) {
    const st = g.districtStates[d];
    if (st !== 'READY') reasons.push(`DISTRICT_NOT_READY_${d}_${st ?? 'UNKNOWN'}`);
  }
  if (g.expectInserts == null) reasons.push('EXPECT_INSERTS_REQUIRED');
  else if (g.expectInserts !== g.plannedInserts) reasons.push(`PLANNED_INSERTS_CHANGED_${g.expectInserts}_NE_${g.plannedInserts}`);
  if (!g.recordedPlanHash || !g.recomputedPlanHash) reasons.push('PLAN_HASH_MISSING');
  else if (g.recordedPlanHash !== g.recomputedPlanHash) reasons.push('CHECKPOINT_HASH_DRIFT');
  if (!g.givenPlanHash) reasons.push('PLAN_HASH_ARG_REQUIRED');
  else if (g.givenPlanHash !== g.recomputedPlanHash) reasons.push('PLAN_HASH_ARG_MISMATCH');
  if (g.currentReview > 0) reasons.push(`REVIEW_PRESENT_${g.currentReview}`);
  if (g.currentReview > g.recordedReview) reasons.push(`NEW_REVIEW_APPEARED_${g.recordedReview}_TO_${g.currentReview}`);
  if (g.unexpectedUpdates > 0 && !g.approveExistingUpdates) reasons.push(`UNEXPECTED_EXISTING_UPDATES_${g.unexpectedUpdates}`);
  if (!g.observedQuota) reasons.push('QUOTA_UNKNOWN');
  else {
    const age = g.now.getTime() - new Date(g.observedQuota.at).getTime();
    if (!(age >= 0 && age <= g.quotaMaxAgeMs)) reasons.push('QUOTA_OBSERVATION_STALE');
    if (g.observedQuota.remaining - g.applyEstimate < g.reserve) reasons.push(`QUOTA_BELOW_RESERVE_${g.observedQuota.remaining}-${g.applyEstimate}<${g.reserve}`);
  }
  return { allowed: reasons.length === 0, reasons };
}

// ───────────────────────── 11. 노출·cron 분리 ─────────────────────────

export interface ReadinessLevels {
  lawdCd: string;
  /** 전 셀 APPLIED/EMPTY_VALID + 사후 대조 통과. */
  dataReady: boolean;
  /** dataReady면 cron 편입 **후보**(자동 편입 아님). */
  cronReadyCandidate: boolean;
  /** 항상 false — 공개는 별도 승인 STEP에서만 한다. */
  publicReady: false;
  notes: string[];
}

export function readinessLevels(lawdCd: string, state: NationalDistrictState, postVerifyPassed: boolean): ReadinessLevels {
  const dataReady = state === 'APPLIED' && postVerifyPassed;
  const notes = ['PUBLIC_EXPOSURE_REQUIRES_SEPARATE_APPROVAL'];
  if (dataReady) notes.push('CRON_EXPANSION_REQUIRES_SEPARATE_REVIEW');
  return { lawdCd, dataReady, cronReadyCandidate: dataReady, publicReady: false, notes };
}

// ───────────────────────── 12. readiness CSV ─────────────────────────

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join('|') : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}
