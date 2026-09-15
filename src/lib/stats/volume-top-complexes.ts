// STATISTICS_PERIOD_TRADE_UX_V1 — 거래량 카드 "거래가 많은 단지" 미리보기의 순수 규칙.
// 데이터는 /api/stats/concentration 응답을 그대로 쓴다(순위·건수를 다시 계산하지 않는다).

export interface ConcentrationEntryLike {
  rank: number;
  aptSeq?: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  currentCount: number;
}

/** 응답 순서(거래건수 desc)를 유지한 상위 N개. 건수 0 이하는 거래가 아니므로 버린다. */
export function topComplexRows<T extends ConcentrationEntryLike>(entries: readonly T[], limit: number): T[] {
  return entries.filter((e) => e.currentCount > 0).slice(0, limit);
}

/**
 * 단지 상세 링크 — 검색·지도와 같은 canonical 계약(lawdCd 5자리 + dong, aptSeq는 있으면 함께).
 * lawdCd/dong이 없으면 null: 이름만으로 링크를 만들면 동명 다른 단지를 열 수 있다.
 */
export function buildTopComplexHref(e: ConcentrationEntryLike): string | null {
  const name = (e.name || '').trim();
  const lawdCd = (e.lawdCd || '').trim();
  const dong = (e.dong || '').trim();
  if (!name || !dong || !/^\d{5}$/.test(lawdCd)) return null;
  const qs = new URLSearchParams({ lawdCd, dong });
  if (e.aptSeq) qs.set('aptSeq', e.aptSeq);
  return `/apt/${encodeURIComponent(name)}?${qs.toString()}`;
}
