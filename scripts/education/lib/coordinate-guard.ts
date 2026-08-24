// SCHOOL V2-C5-B §14 — 교육시설(School/Kindergarten/Childcare) 좌표 ingestion 공통 가드.
// 향후 ingestion 스크립트가 좌표를 저장하기 전에 반드시 거쳐야 하는 최소 검증만 모았다.
// 이 모듈 자체는 DB에 아무것도 쓰지 않는다 — 순수 검증 함수만 제공.

// 부산 대략적 경계(느슨한 bounding box). C5-B §3 실측(662건, out-of-bounds 0건)을
// 근거로 잡은 여유 범위이지 정밀 행정경계가 아니다 — "명백히 딴 지역"만 걸러낸다.
export const BUSAN_BOUNDS = { latMin: 34.87, latMax: 35.42, lngMin: 128.72, lngMax: 129.32 };

export interface CoordinateCandidate {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  sidoCode?: string | null;
  source: string; // provenance 필수 — 빈 문자열/undefined면 reject
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

// SCHOOL V2-C5-B §10/§15 원칙: 수동으로 손으로 지정한 좌표(hardcode)는 이 가드를
// 통과시키지 않는다 — "manual"/"hardcode"/"fix_" 같은 source 문자열 자체를 명시적으로
// 차단한다(fix_coords.ts/fix_songdo_coords.ts 재발 방지, §15).
const FORBIDDEN_SOURCE_PATTERNS = [/manual/i, /hardcode/i, /^fix_/i, /temp/i, /임시/, /수동/];

export function validateCoordinate(c: CoordinateCandidate): GuardResult {
  if (!c.source || c.source.trim() === '') {
    return { ok: false, reason: 'source(provenance) 없음 — 출처 없는 좌표는 저장 금지' };
  }
  if (FORBIDDEN_SOURCE_PATTERNS.some((p) => p.test(c.source))) {
    return { ok: false, reason: `금지된 source 패턴("${c.source}") — 수동/하드코딩 좌표로 의심됨` };
  }
  if (c.latitude == null || c.longitude == null) {
    return { ok: false, reason: '좌표 없음(null) — 이 경우 null로 그대로 두고 저장 자체를 하지 않는다' };
  }
  if (c.latitude === 0 && c.longitude === 0) {
    return { ok: false, reason: '(0,0) 좌표 — 명백한 오류값, 저장 금지' };
  }
  if (c.latitude < -90 || c.latitude > 90) {
    return { ok: false, reason: `latitude 범위 초과: ${c.latitude}` };
  }
  if (c.longitude < -180 || c.longitude > 180) {
    return { ok: false, reason: `longitude 범위 초과: ${c.longitude}` };
  }
  if (c.sidoCode === '26' || c.sidoCode == null) {
    // 부산(26) 데이터로 알려진 경우에만 부산 bounds를 검사한다 — 전국 확장 시
    // sidoCode가 다르면 이 검사를 건너뛴다(다른 지역까지 부산 bounds로 잘못 거르지 않기 위함).
    if (
      c.latitude < BUSAN_BOUNDS.latMin ||
      c.latitude > BUSAN_BOUNDS.latMax ||
      c.longitude < BUSAN_BOUNDS.lngMin ||
      c.longitude > BUSAN_BOUNDS.lngMax
    ) {
      return { ok: false, reason: `부산 bounds 밖(${c.latitude}, ${c.longitude}) — sidoCode=26인데 좌표가 부산 밖을 가리킴` };
    }
  }
  return { ok: true };
}

// 같은 좌표가 과도하게 중복되는지(예: 여러 시설이 우연히 같은 대표점을 공유) 탐지만
// 한다 — 자동으로 reject하지는 않는다(C5-B §3에서 실측한 대로, 같은 캠퍼스 내
// 초/중 병설처럼 실제로 좌표가 같을 수 있는 정당한 경우가 있어 이건 "경고"이지 "오류"가
// 아니다). threshold 초과 그룹만 반환해 사람이 검토하게 한다.
export function findExcessiveDuplicateCoordinates<T extends { latitude: number | null; longitude: number | null; name: string }>(
  rows: T[],
  threshold = 2
): { key: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (r.latitude == null || r.longitude == null) continue;
    const key = `${r.latitude.toFixed(6)},${r.longitude.toFixed(6)}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.entries()].filter(([, g]) => g.length > threshold).map(([key, rows]) => ({ key, rows }));
}
