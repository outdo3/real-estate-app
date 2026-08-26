/**
 * BUSAN_DATA_UX_AUTOMATED_QA_V1의 순수 판정 로직만 분리한 모듈.
 *
 * run-busan-data-ux-qa.ts(CLI 본체, DB/HTTP 부작용 있음)와 분리해 이 파일은 부작용이
 * 전혀 없다 — import만 해도 QA가 실행되지 않으므로 안전하게 유닛 테스트할 수 있다
 * (scripts/backfill-basic-data-logic.ts와 동일한 관례).
 */

export function pct(n: number, total: number): string {
  if (total === 0) return 'N/A(표본 0)';
  return `${((n / total) * 100).toFixed(1)}%`;
}

export function parseAreaM2(areaLabel: string): number | null {
  const m = areaLabel.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? parseFloat(m[1]) : null;
}

export function toIsoDate(tradeDate: string): string {
  const d = new Date(tradeDate);
  if (isNaN(d.getTime())) return tradeDate;
  return d.toISOString().slice(0, 10);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type ConsistencyInput = {
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  parkingPerHousehold: number | null;
  buildYear: number | null;
  latitude: number | null;
  longitude: number | null;
};

export type BusanBBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

// L2 DATA CONSISTENCY §4 규칙을 hard(FAIL, 명백히 무효)/soft(WARN, 이론상 가능하나 비현실적)로
// 분리해 판정한다. null은 항상 허용(§4 "null 허용" 원칙) — 값이 있을 때만 검사한다.
export function classifyConsistency(r: ConsistencyInput, bbox: BusanBBox, currentYear: number): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];

  if (r.floorAreaRatio != null && r.floorAreaRatio <= 0) hard.push(`floorAreaRatio<=0(${r.floorAreaRatio})`);
  if (r.buildingCoverageRatio != null && r.buildingCoverageRatio <= 0) hard.push(`buildingCoverageRatio<=0(${r.buildingCoverageRatio})`);
  if (r.floorAreaRatio != null && r.floorAreaRatio > 2000) soft.push(`floorAreaRatio 비정상 범위(${r.floorAreaRatio})`);
  if (r.buildingCoverageRatio != null && r.buildingCoverageRatio > 100) soft.push(`buildingCoverageRatio>100(${r.buildingCoverageRatio})`);

  if (r.totalHouseholds != null && r.totalHouseholds <= 0) hard.push(`totalHouseholds<=0(${r.totalHouseholds})`);
  if (r.parkingCount != null && r.parkingCount < 0) hard.push(`parkingCount<0(${r.parkingCount})`);

  if (r.buildYear != null && (r.buildYear > currentYear + 1 || r.buildYear < 1900)) {
    hard.push(`buildYear 비정상(${r.buildYear})`);
  }

  if (r.parkingCount != null && r.totalHouseholds && r.totalHouseholds > 0 && r.parkingPerHousehold != null) {
    const expected = r.parkingCount / r.totalHouseholds;
    const diff = Math.abs(expected - r.parkingPerHousehold);
    if (diff > Math.max(0.01, expected * 0.01)) {
      hard.push(`parkingPerHousehold 불일치(저장값=${r.parkingPerHousehold}, 계산값=${expected.toFixed(4)})`);
    }
  }

  if (r.latitude != null && r.longitude != null) {
    if (r.latitude < bbox.minLat || r.latitude > bbox.maxLat || r.longitude < bbox.minLng || r.longitude > bbox.maxLng) {
      hard.push(`좌표가 부산 범위 밖(lat=${r.latitude}, lng=${r.longitude})`);
    }
  }

  return { hard, soft };
}

// TRADE DATA TRUST §6 핵심 규칙: API 실패(apiError truthy) ≠ 거래 없음. apiError가 있는데
// trades가 0건이면 그 0건은 "실제 무거래"가 아니라 "조회 실패"로 분류해야 한다.
export function isApiFailureMisclassifiedAsNoTrade(apiError: string | null, tradesLength: number): boolean {
  return !!apiError && tradesLength === 0;
}
