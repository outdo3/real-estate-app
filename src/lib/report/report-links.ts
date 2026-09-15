// REPORT-7 — 리포트 route의 **단일 정의**.
//
// 진입 CTA(상세/비교/지도/통계)와 내보내기·공유(canonical URL)가 같은 함수를 쓴다.
// 두 곳에서 각자 문자열을 조립하면 언젠가 갈라지고, 갈라지는 순간 공유 링크가
// 다른 리포트를 가리킨다.
//
// 규칙(§4):
//   canonical identity가 없으면 **null**을 돌려준다. 이름으로 지어내지 않는다.
//   호출부는 null이면 CTA 자체를 렌더하지 않는다 — 깨진 링크를 만들지 않기 위해.

/**
 * 리포트 → 단지 상세. BUSAN_LAUNCH_FINAL_RELEASE_GATE_V1 — 예전 `/apt/{name}?aptSeq=`만 싣던 링크는
 * 상세가 이름(+동 없음)으로 거래를 찾아 **동명 다른 단지**를 열었다(Production: 우동 롯데 → 서울 롯데,
 * 연산동 삼익 → 경기 연천 삼익). 검색·지도와 같은 canonical 계약(lawdCd+dong+aptSeq)으로만 만들고,
 * 하나라도 없으면 null — 틀린 단지로 보내는 링크보다 링크 없음이 낫다.
 */
export function aptDetailHref(params: {
  name: string | null | undefined;
  aptSeq: string | null | undefined;
  lawdCd: string | null | undefined;
  dong: string | null | undefined;
}): string | null {
  const name = (params.name || '').trim();
  const aptSeq = (params.aptSeq || '').trim();
  const lawdCd = (params.lawdCd || '').trim();
  const dong = (params.dong || '').trim();
  if (!name || !aptSeq || !dong || !/^\d{5}$/.test(lawdCd)) return null;
  return `/apt/${encodeURIComponent(name)}?${new URLSearchParams({ lawdCd, dong, aptSeq }).toString()}`;
}

/** 부산 시 리포트는 단일 경로다. */
export function cityReportHref(): string {
  return '/report/city/busan';
}

export function districtReportHref(lawdCd: string | null | undefined): string | null {
  const v = (lawdCd || '').trim();
  return v ? `/report/district/${encodeURIComponent(v)}` : null;
}

export function dongReportHref(
  lawdCd: string | null | undefined,
  dong: string | null | undefined
): string | null {
  const l = (lawdCd || '').trim();
  const d = (dong || '').trim();
  return l && d ? `/report/dong/${encodeURIComponent(l)}/${encodeURIComponent(d)}` : null;
}

/** 단지 리포트 — canonical aptSeq만 받는다(이름 기반 식별 금지). */
export function aptReportHref(aptSeq: string | null | undefined): string | null {
  const v = (aptSeq || '').trim();
  return v ? `/report/apt/${encodeURIComponent(v)}` : null;
}

/** 비교 리포트 — a/b 순서가 곧 화면 순서다. 둘 다 있어야 한다. */
export function compareReportHref(
  a: string | null | undefined,
  b: string | null | undefined
): string | null {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (!x || !y) return null;
  // 같은 단지끼리는 비교 리포트가 성립하지 않는다(REPORT-4 가드와 동일).
  if (x === y) return null;
  return `/report/compare?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`;
}

/** 일별 리포트 — KST 관찰일(YYYY-MM-DD). */
export function dailyReportHref(dateKst: string | null | undefined): string | null {
  const v = (dateKst || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `/report/daily/${v}` : null;
}

/**
 * §16 — 표시 문구도 한 곳에서만 정한다.
 * 지역은 "한장 브리핑", 단지는 "한장 리포트", 비교는 "비교 리포트",
 * 일별은 "새로 확인된 실거래".
 */
export const REPORT_LABELS = {
  city: '부산 한장 브리핑',
  district: (name: string) => `${name} 한장 브리핑`,
  dong: (name: string) => `${name} 한장 브리핑`,
  /** STATS_REPORT_ENTRY_V1 — 지역명이 바로 옆에 이미 보이는 좁은 자리(통계 헤더)용.
   *  `aptShort`와 같은 이유로 둔다: 같은 문구를 호출부가 각자 줄이면 갈라진다. */
  regionShort: '한장 브리핑',
  apt: '이 단지 한장 리포트',
  aptShort: '한장 리포트',
  compare: '비교 리포트 보기',
  daily: '오늘 새로 확인된 실거래',
} as const;
