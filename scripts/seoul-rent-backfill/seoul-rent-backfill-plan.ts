// SEOUL_RENT_BACKFILL_V3 — 서울 25개 구 전월세 백필 계획 및 사전 산출기.
//
// ── 왜 사전 산출이 필수인가 ──────────────────────────────────────────────────
// 서울은 25개 구로 부산(16개 구)보다 1.5배 이상 크고, 전월세 거래량은 매매 대비 약 1.5~2배 많다.
// 2005년~2026년(약 240개월) 전체를 한 번에 부르면 25 × 240 = 6,000셀 이상의 MOLIT 호출과
// 페이지네이션을 포함해 20,000회 이상의 HTTP 요청이 발생할 수 있다.
// 따라서:
//   1. seoul-a (8구), seoul-b (9구), seoul-c (8구) shard 단위로 나눈다.
//   2. 백필 기간을 연도별 또는 n개월 단위로 분할할 수 있도록 지원한다.
//   3. 실행 전 예상 셀 수, 예상 API 호출 수, 예상 소요 시간, 예상 DB 레코드 수, 예상 용량을 사전에 정확히 계산한다.

import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_ALL_25_LAWDCDS,
  RentSyncScope,
  resolveRentSyncScope,
} from '../../src/lib/sync/rent-sync-scope';

export interface BackfillPlanInput {
  scope: RentSyncScope;
  fromYmd: string; // YYYYMM (e.g. "202401")
  toYmd: string;   // YYYYMM (e.g. "202412")
}

export interface BackfillEstimate {
  scope: RentSyncScope;
  districtCount: number;
  monthCount: number;
  totalCells: number; // districtCount * monthCount
  estimatedCallsPerCell: number; // 평균 1.8회 (페이지네이션 고려)
  estimatedMolitCalls: number;
  estimatedRuntimeMinutes: number; // 250ms 페이싱 기준
  estimatedRowsCount: number; // 서울 평균 구당 월 650건 전월세 기준
  estimatedDbSizeMb: number; // row당 약 300바이트
  shardsRecommended: boolean;
}

/**
 * YYYYMM 시작~종료월 사이의 월 목록을 반환한다(순수 함수).
 */
export function generateMonthList(fromYmd: string, toYmd: string): string[] {
  if (!/^\d{6}$/.test(fromYmd) || !/^\d{6}$/.test(toYmd)) return [];
  const startY = parseInt(fromYmd.slice(0, 4), 10);
  const startM = parseInt(fromYmd.slice(4, 6), 10);
  const endY = parseInt(toYmd.slice(0, 4), 10);
  const endM = parseInt(toYmd.slice(4, 6), 10);

  if (startY > endY || (startY === endY && startM > endM)) return [];

  const months: string[] = [];
  let curY = startY;
  let curM = startM;

  while (curY < endY || (curY === endY && curM <= endM)) {
    months.push(`${curY}${String(curM).padStart(2, '0')}`);
    curM++;
    if (curM > 12) {
      curM = 1;
      curY++;
    }
  }
  return months;
}

/**
 * 백필 계획 및 사전 부하·비용·용량 산출.
 */
export function calculateBackfillEstimate(input: BackfillPlanInput): BackfillEstimate | null {
  const resolved = resolveRentSyncScope(input.scope === 'busan' ? null : input.scope);
  if (!resolved.ok || !resolved.lawdCds) return null;

  const months = generateMonthList(input.fromYmd, input.toYmd);
  if (months.length === 0) return null;

  const districtCount = resolved.lawdCds.length;
  const monthCount = months.length;
  const totalCells = districtCount * monthCount;

  // 실측치 기반 지표:
  // - 서울 구당 월평균 전월세 거래량 ≈ 650건 (MOLIT 1페이지 100건 기준 페이지네이션 약 2~7페이지, 평균 2.2호출)
  const estimatedCallsPerCell = 2.2;
  const estimatedMolitCalls = Math.round(totalCells * estimatedCallsPerCell);

  // MOLIT 호출 페이싱 250ms + 네트워크 왕복 약 150ms ≈ 호출당 400ms
  const estimatedRuntimeMinutes = Math.round((estimatedMolitCalls * 0.4) / 60 * 10) / 10;

  // row당 약 650건
  const estimatedRowsCount = totalCells * 650;
  // 행당 인덱스 포함 약 350 bytes
  const estimatedDbSizeMb = Math.round((estimatedRowsCount * 350) / (1024 * 1024) * 10) / 10;

  return {
    scope: input.scope,
    districtCount,
    monthCount,
    totalCells,
    estimatedCallsPerCell,
    estimatedMolitCalls,
    estimatedRuntimeMinutes,
    estimatedRowsCount,
    estimatedDbSizeMb,
    shardsRecommended: totalCells > 120, // 120셀(예: 10개 구 × 12개월) 초과 시 shard 분할 권장
  };
}
