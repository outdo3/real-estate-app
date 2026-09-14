// GAP_INVEST_BUSAN_DB_FIRST_V1 — /api/stats/gap-invest "시도 전체" 원본 수집의 DB-first 소스.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────────
// 부산 전체(기본 지역)는 16개 구 × 12개월 × (매매+전월세) = **384개의 MOLIT 호출**을 한
// 요청 안에서 했다. 전역 MOLIT 게이트(동시 4 / 250ms 페이싱)에서 호출 수가 곧 벽시계
// 시간이라 production 콜드 34.18s / 37.74s였다(FINAL_PRELAUNCH_REGRESSION_AUDIT_V2 P1-2).
// /api/stats/feed가 BUSAN_12M_STATS_PERFORMANCE_FIX_V1에서 겪은 것과 같은 모양이다.
//
// ── 무엇을 DB에서 읽는가(신뢰 경계) ────────────────────────────────────────────
// "DB에 행이 있다"는 이유만으로 DB를 쓰지 않는다. **검증된 셀만** DB로 읽는다.
//  · 매매: sync_coverage_cells(SALE)의 (구, 월) 셀이 COMPLETE/EMPTY_VALID일 때만.
//          (피드/대시보드는 부산 매매를 월 구분 없이 DB로 읽지만, 이 경로는 요구대로 더
//          보수적으로 셀 단위 검증을 요구한다.)
//  · 전월세: 기존 검증범위(getRentVerifiedRange — 16/16 구가 검증된 연속 월)에 들어갈 때만.
//          피드·대시보드와 같은 함수·같은 규칙.
//  · 진행 중인 현재월은 위 증거가 무엇이든 **절대 DB로 읽지 않는다**(sync 엔진이 현재월을
//    검증 완료로 기록하지 않는 규칙을 여기서도 독립적으로 강제 — 단일 실패 지점 회피).
//  · 나머지 셀(검증 안 됨/현재월)은 기존과 같은 MOLIT task로, 같은 bulk lane으로 읽는다.
//    그 task의 실패는 기존과 똑같이 failedLawdCds(→ partial)로 드러난다.
//  · 부산이 아닌 시도는 DB에 이력이 없으므로 plan 단계에서 전부 MOLIT이다(기존과 동일).
//
// ── 무엇을 바꾸지 않는가 ──────────────────────────────────────────────────────
// 반환 모양은 라우트가 캐시에 담던 { failedLawdCds, aptByMonth, rentByMonth }와 같고,
// 원소는 MOLIT-shape raw item + lawdCd다. DB 행은 피드와 같은 변환기
// (storedSaleToFeedRaw/storedRentToFeedRaw)로 같은 필드를 만든다. 취소 행은 DB에서 거르지
// 않고 dealCanceled 값을 그대로 싣는다 — 제외는 기존과 같이 toGapInputs()가 한 곳에서 한다.
import type { MonthTask, MonthTaskResult } from '@/lib/molit-stats-helpers';
import type { FeedSaleRow } from '@/lib/trade-history-read';
import type { StoredRentTrade } from '@/lib/rent-history-read';
import type { VerifiedRange } from '@/lib/rent-verified-range';
import { monthRangeBounds, storedSaleToFeedRaw, storedRentToFeedRaw } from '@/lib/stats/feed-db-source';

export interface GapInvestSourcePlanInput {
  lawdCds: string[];
  /** 요청 창(YYYYMM, 오름차순) — 라우트의 last12Months. */
  months: string[];
  /** 진행 중인 달(YYYYMM). 이 달과 그 이후는 절대 DB로 읽지 않는다. */
  currentMonth: string;
  /** 이 시도가 DB 이력을 가진 시도인가(부산). false면 전부 MOLIT. */
  dbBacked: boolean;
  /** SALE 검증 셀 키(`${lawdCd}:${YYYYMM}`). */
  verifiedSaleCells: Set<string>;
  /** RENT 검증범위. null이면 전월세는 전부 MOLIT. */
  rentVerifiedRange: VerifiedRange | null;
}

export interface GapInvestSourcePlan {
  /** DB로 읽을 매매 셀 키(`${lawdCd}:${YYYYMM}`). */
  saleDbCells: Set<string>;
  /** DB로 읽을 전월세 월(16/16 구 공통). */
  rentDbMonths: string[];
  /** MOLIT으로 읽을 task — 키 형식·순서는 기존 라우트와 동일(`${lawdCd}|apt:${ym}`). */
  molitTasks: MonthTask[];
}

export const cellKey = (lawdCd: string, ym: string) => `${lawdCd}:${ym}`;

/** 순수 함수 — 어느 셀을 DB/MOLIT으로 읽을지 결정한다(I/O 없음). */
export function planGapInvestSources(input: GapInvestSourcePlanInput): GapInvestSourcePlan {
  const { lawdCds, months, currentMonth, dbBacked, verifiedSaleCells, rentVerifiedRange } = input;
  const saleDbCells = new Set<string>();
  const rentDbMonths: string[] = [];

  if (dbBacked) {
    for (const ym of months) {
      if (ym >= currentMonth) continue;
      if (rentVerifiedRange && ym >= rentVerifiedRange.from && ym <= rentVerifiedRange.to) rentDbMonths.push(ym);
      for (const d of lawdCds) {
        const key = cellKey(d, ym);
        if (verifiedSaleCells.has(key)) saleDbCells.add(key);
      }
    }
  }

  const rentDbSet = new Set(rentDbMonths);
  const molitTasks: MonthTask[] = [];
  for (const d of lawdCds) {
    for (const ym of months) {
      if (!saleDbCells.has(cellKey(d, ym))) molitTasks.push({ key: `${d}|apt:${ym}`, lawdCd: d, dealYmd: ym, type: 'apt' });
      if (!rentDbSet.has(ym)) molitTasks.push({ key: `${d}|rent:${ym}`, lawdCd: d, dealYmd: ym, type: 'rent' });
    }
  }
  return { saleDbCells, rentDbMonths, molitTasks };
}

export interface GapInvestDataSource {
  mode: 'DB_FIRST' | 'MOLIT';
  sale: { dbCells: number; molitCells: number; dbMonths: string[]; molitMonths: string[]; dbRows: number };
  rent: { dbCells: number; molitCells: number; dbMonths: string[]; molitMonths: string[]; dbRows: number };
  /** 이 원본을 만들 때 실제로 보낸 MOLIT 월 조회 수(= task 수). */
  molitCalls: number;
}

export interface GapInvestSidoRaw {
  failedLawdCds: string[];
  aptByMonth: any[][];
  rentByMonth: any[][];
  dataSource: GapInvestDataSource;
}

export interface GapInvestSourceDeps {
  loadVerifiedSaleCellKeys: (lawdCds: string[], months: string[]) => Promise<Set<string>>;
  getRentVerifiedRange: () => Promise<VerifiedRange>;
  loadSaleRows: (lawdCds: string[], from: Date, to: Date) => Promise<FeedSaleRow[]>;
  loadRentBuckets: (lawdCds: string[], months: string[]) => Promise<Map<string, StoredRentTrade[]>>;
  fetchMolit: (tasks: MonthTask[]) => Promise<Record<string, MonthTaskResult>>;
  warmup?: () => Promise<void>;
  logError?: (message: string, error: unknown) => void;
}

const ymOfDate = (d: Date) => d.toISOString().slice(0, 7).replace('-', '');

export async function loadGapInvestSidoRaw(
  input: { lawdCds: string[]; months: string[]; currentMonth: string; dbBacked: boolean },
  deps: GapInvestSourceDeps
): Promise<GapInvestSidoRaw> {
  const { lawdCds, months, currentMonth, dbBacked } = input;

  let verifiedSaleCells = new Set<string>();
  let rentVerifiedRange: VerifiedRange | null = null;
  if (dbBacked) {
    // coverage를 읽지 못하면 "검증 안 됨"으로 **좁힌다**(해당 셀은 MOLIT). 더 넓은 신뢰를
    // 추측하지 않는다 — getRentVerifiedRange가 실패 시 bootstrap으로 좁히는 것과 같은 방향.
    const [saleCells, rentRange] = await Promise.all([
      deps.loadVerifiedSaleCellKeys(lawdCds, months).catch((e) => {
        deps.logError?.('[gap-invest] SALE coverage 조회 실패 — 매매 전 셀을 MOLIT으로 읽는다', e);
        return new Set<string>();
      }),
      deps.getRentVerifiedRange(),
    ]);
    verifiedSaleCells = saleCells;
    rentVerifiedRange = rentRange;
  }

  const plan = planGapInvestSources({ lawdCds, months, currentMonth, dbBacked, verifiedSaleCells, rentVerifiedRange });
  const saleDbMonths = months.filter((ym) => lawdCds.some((d) => plan.saleDbCells.has(cellKey(d, ym))));
  const saleBounds = monthRangeBounds(saleDbMonths);

  const [results, saleRows, rentBuckets] = await Promise.all([
    plan.molitTasks.length > 0 ? deps.fetchMolit(plan.molitTasks) : Promise.resolve({} as Record<string, MonthTaskResult>),
    saleBounds ? deps.loadSaleRows(lawdCds, saleBounds.from, saleBounds.to) : Promise.resolve([] as FeedSaleRow[]),
    plan.rentDbMonths.length > 0 ? deps.loadRentBuckets(lawdCds, plan.rentDbMonths) : Promise.resolve(new Map<string, StoredRentTrade[]>()),
    saleBounds || plan.rentDbMonths.length > 0 ? deps.warmup?.() : undefined,
  ]);

  // DB 행을 (구, 월) 셀로 나눈다. 검증 셀이 아닌 행(같은 날짜 범위에 걸린 미검증 셀 행)은
  // 버린다 — 그 셀은 MOLIT 결과가 대표한다(같은 셀을 두 소스에서 이중으로 세지 않는다).
  const saleByCell = new Map<string, FeedSaleRow[]>();
  let saleDbRows = 0;
  for (const row of saleRows) {
    const key = cellKey(row.lawdCd, ymOfDate(row.dealDate));
    if (!plan.saleDbCells.has(key)) continue;
    saleDbRows++;
    const bucket = saleByCell.get(key);
    if (bucket) bucket.push(row);
    else saleByCell.set(key, [row]);
  }
  const rentByCell = new Map<string, StoredRentTrade[]>();
  let rentDbRows = 0;
  const rentDbSet = new Set(plan.rentDbMonths);
  for (const [ym, rows] of rentBuckets) {
    if (!rentDbSet.has(ym)) continue;
    for (const row of rows) {
      rentDbRows++;
      const key = cellKey(row.lawdCd, ym);
      const bucket = rentByCell.get(key);
      if (bucket) bucket.push(row);
      else rentByCell.set(key, [row]);
    }
  }

  // §36 부분 실패 — 기존과 같다: MOLIT task가 하나라도 실패한 구를 실패 목록에 남긴다.
  // DB로 읽은 셀에는 실패 개념이 없다(쿼리 실패는 throw → 라우트가 요청을 에러로 만든다).
  const failedSet = new Set<string>();
  for (const d of lawdCds) {
    for (const ym of months) {
      if (results[`${d}|apt:${ym}`]?.failed || results[`${d}|rent:${ym}`]?.failed) failedSet.add(d);
    }
  }

  // 월 → 구(lawdCds 순서) 순으로 조립한다 — 기존 flatMap 순서와 같다.
  const aptByMonth = months.map((ym) =>
    lawdCds.flatMap((d) => {
      const key = cellKey(d, ym);
      if (plan.saleDbCells.has(key)) return (saleByCell.get(key) || []).map((row) => ({ ...storedSaleToFeedRaw(row), lawdCd: d }));
      return (results[`${d}|apt:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d }));
    })
  );
  const rentByMonth = months.map((ym) =>
    lawdCds.flatMap((d) => {
      if (rentDbSet.has(ym)) return (rentByCell.get(cellKey(d, ym)) || []).map((row) => ({ ...storedRentToFeedRaw(row), lawdCd: d }));
      return (results[`${d}|rent:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d }));
    })
  );

  const saleMolitMonths = months.filter((ym) => lawdCds.some((d) => !plan.saleDbCells.has(cellKey(d, ym))));
  const rentMolitMonths = months.filter((ym) => !rentDbSet.has(ym));
  const totalCells = lawdCds.length * months.length;
  const saleDbCellCount = plan.saleDbCells.size;
  const rentDbCellCount = plan.rentDbMonths.length * lawdCds.length;

  return {
    failedLawdCds: Array.from(failedSet),
    aptByMonth,
    rentByMonth,
    dataSource: {
      mode: saleDbCellCount + rentDbCellCount > 0 ? 'DB_FIRST' : 'MOLIT',
      sale: { dbCells: saleDbCellCount, molitCells: totalCells - saleDbCellCount, dbMonths: saleDbMonths, molitMonths: saleMolitMonths, dbRows: saleDbRows },
      rent: { dbCells: rentDbCellCount, molitCells: totalCells - rentDbCellCount, dbMonths: [...plan.rentDbMonths], molitMonths: rentMolitMonths, dbRows: rentDbRows },
      molitCalls: plan.molitTasks.length,
    },
  };
}

/**
 * §36 총 실패 판정. 기존: "모든 구가 실패" = apiError(화면이 결과를 숨기고 에러만 보인다).
 * DB로 읽은 셀이 하나라도 있으면 apiError로 올리지 않는다 — 남은 MOLIT(주로 현재월)이 16개 구
 * 전부 실패해도 "데이터가 하나도 없다"는 뜻이 아니므로, 있는 결과를 숨기지 않고 partial로
 * 드러낸다(/api/stats/feed DB 경로와 같은 규칙). DB 셀이 0이면 기존 판정 그대로다.
 */
export function resolveSidoApiError(raw: Pick<GapInvestSidoRaw, 'failedLawdCds' | 'dataSource'>, totalDistrictCount: number): boolean {
  const dbCells = raw.dataSource.sale.dbCells + raw.dataSource.rent.dbCells;
  return totalDistrictCount > 0 && raw.failedLawdCds.length === totalDistrictCount && dbCells === 0;
}
