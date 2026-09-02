import { buildFinanceFitUrl } from '@/lib/finance-fit/url';

// DECISION_JOURNEY_V1 §7 — 페이지별 Next Action URL을 만드는 순수 함수 모음.
// 새 API/새 state를 만들지 않고, 이미 존재하는 route와 그 route가 이미 지원하는
// query 계약만 재사용한다.
//   - /map: src/lib/map-marker-share.ts의 parseMapStateFromSearchParams가 이미
//     소비하는 lat/lng/zoom/lawdCd/dong/name 계약을 그대로 따른다. lat/lng가
//     없으면 그 파서가 전체를 무시하고 기본 지역(서구)으로 열리므로, 호출부는
//     가능하면 좌표를 지오코딩해서 넘겨야 한다(geocode-for-map.ts 참고).
//   - /stats/compare: COMPARE_V2_PHASE2부터 CompareV2(src/components/compare/
//     CompareV2.tsx)가 canonical — src/lib/compare-v2/url.ts의 aName/aLawdCd/
//     aDong/aptSeq 계약을 그대로 재사용한다(별도 prefill 계약을 새로 만들지 않음).

export function buildDetailMapUrl(params: {
  lawdCd: string;
  dong?: string;
  name?: string;
  aptSeq?: string;
  lat?: number;
  lng?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.lawdCd) qs.set('lawdCd', params.lawdCd);
  qs.set('zoom', '4');
  if (params.dong) qs.set('dong', params.dong);
  if (params.name) qs.set('name', params.name);
  // DECISION_JOURNEY_V1.1 — aptSeq를 넣어도 dong/name은 그대로 유지한다.
  // parseMapStateFromSearchParams가 aptSeq를 우선 채택하고, aptSeq 매칭 마커가 없을
  // 때도 dong/name이 남아있으면 기존 폴백 경로가 그대로 동작한다(§5).
  if (params.aptSeq) qs.set('aptSeq', params.aptSeq);
  if (params.lat != null && params.lng != null) {
    qs.set('lat', String(params.lat));
    qs.set('lng', String(params.lng));
  }
  return `/map?${qs.toString()}`;
}

export function buildDetailCompareUrl(params: {
  name: string;
  lawdCd: string;
  dong?: string;
  aptSeq?: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('aName', params.name);
  if (params.lawdCd) qs.set('aLawdCd', params.lawdCd);
  if (params.dong) qs.set('aDong', params.dong);
  if (params.aptSeq) qs.set('aptSeq', params.aptSeq);
  return `/stats/compare?${qs.toString()}`;
}

// FINANCE_FIT_V1_PHASE2A §23 — src/lib/finance-fit/url.ts의 buildFinanceFitUrl을
// 그대로 재사용한다(별도 계약을 새로 만들지 않음). refPriceWon은 heroTrade.price(억
// 단위 float)를 원 단위 정수로 변환해서 넘긴다 — 이 값은 공개된 실거래가라 URL에
// 넣어도 되지만(§25), 사용자가 직접 입력하는 준비자금/대출액은 여기 절대 포함하지 않는다.
export function buildDetailFinanceFitUrl(params: {
  name: string;
  lawdCd: string;
  dong?: string;
  aptSeq?: string;
  refPriceWon?: number;
  refTradeDate?: string;
}): string {
  return buildFinanceFitUrl({
    name: params.name,
    lawdCd: params.lawdCd,
    dong: params.dong || '',
    aptSeq: params.aptSeq,
    refPriceWon: params.refPriceWon,
    refTradeDate: params.refTradeDate,
  });
}
