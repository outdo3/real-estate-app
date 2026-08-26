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
