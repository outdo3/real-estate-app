// SEARCH_MAP_PERFORMANCE_V2_2 §24 — 재사용 가능한 client timing 계측 helper.
// NEXT_PUBLIC_EJIP_PERF_DEBUG=true일 때만 동작한다(기본 false) — production에서
// console spam이 생기지 않는다. performance.mark/measure를 그대로 쓰되, 이 값이
// 꺼져 있으면 호출 자체가 즉시 no-op으로 반환돼 오버헤드가 없다.
const ENABLED = process.env.NEXT_PUBLIC_EJIP_PERF_DEBUG === 'true';

export function perfMark(label: string): void {
  if (!ENABLED || typeof performance === 'undefined') return;
  try {
    performance.mark(label);
  } catch {
    /* 이름 충돌 등은 계측 실패일 뿐, 앱 동작에 영향 주지 않는다 */
  }
}

// endLabel을 생략하면 지금까지의 경과(startLabel 이후)를 측정한다.
export function perfMeasure(name: string, startLabel: string, endLabel?: string): void {
  if (!ENABLED || typeof performance === 'undefined') return;
  try {
    const end = endLabel ?? `${name}:now`;
    if (!endLabel) performance.mark(end);
    const m = performance.measure(name, startLabel, end);
    console.log(`[perf] ${name}: ${m.duration.toFixed(1)}ms`);
  } catch {
    /* 시작 mark가 없는 등 계측 실패는 무시(디버그 전용 기능이라 throw하지 않음) */
  }
}

// PERCEIVED_PERFORMANCE_V2_3 §1 — 단계별 렌더 비용을 **숫자와 함께** 남기기 위한 helper.
// performance.mark/measure는 "구간"에는 좋지만 마커 수/클러스터 수/오버레이 수 같은
// 부수 지표를 같이 실을 수 없어서, 렌더 파이프라인 계측에는 이 함수를 쓴다.
// ENABLED가 false면(기본) 호출 즉시 반환하므로 production 오버헤드가 없다.
export function perfLog(name: string, fields: Record<string, number | string | boolean>): void {
  if (!ENABLED) return;
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`);
  console.log(`[perf] ${name} ${parts.join(' ')}`);
}

/** ENABLED일 때만 performance.now()를 읽는다(꺼져 있으면 0 — 계산에 쓰지 않는다). */
export function perfNow(): number {
  return ENABLED && typeof performance !== 'undefined' ? performance.now() : 0;
}

/** 계측이 켜져 있는지. 계측 전용 분기를 감싸 production에서 완전히 죽은 코드로 만든다. */
export const PERF_ENABLED = ENABLED;
