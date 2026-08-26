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
