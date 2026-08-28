// MAP MARKER UX V2 — 지도 마커 칩에 쓰는 가격/면적 표시를 순수 함수로 분리해
// map/page.tsx(DOM/Kakao SDK 부작용 있음)와 분리하고 단위 테스트한다(기존
// map-selected-marker.ts/map-marker-fetch-guard.ts와 동일 관례).

// 만원 단위 정수를 지도 칩에 맞는 compact 가격 문자열로 바꾼다. 기존
// formatKoreanPrice()("3억 8,700만")는 상세페이지 등 넓은 공간에는 적합하지만
// 좁은 마커 칩에서는 폭을 불필요하게 키운다 — 1억 이상은 소수점 2자리까지의
// "억" 단위로 압축한다(예: 38700만원 -> "3.87억"). 만원 단위 정밀도를 억 단위로
// 반올림하는 것뿐이라 실제 가격과 오해될 수준의 왜곡은 없다(최대 오차 0.005억
// = 5만원, 통상 거래가 대비 무시 가능한 수준) — deterministic, 같은 입력은 항상
// 같은 출력.
export function formatCompactPriceManwon(manwon: number | null | undefined): string {
  if (manwon == null || !Number.isFinite(manwon) || manwon <= 0) return '';
  if (manwon >= 10000) {
    const eok = manwon / 10000;
    const rounded = Math.round(eok * 100) / 100;
    const trimmed = rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${trimmed}억`;
  }
  return `${Math.round(manwon).toLocaleString('ko-KR')}만`;
}

// PYEONG TRUST CONTRACT(§6) — trustworthy Unit Master representativePyeong이
// 있으면("pyeong" 인자, 이미 route.ts의 resolveTrustworthyPyeongBatch가 검증을
// 마친 값만 여기 도달함) 평형을, 없으면 raw ㎡를 보여준다. exclusiveArea /
// 3.3058 같은 추정 계산은 이 함수도, 호출부도 절대 하지 않는다 — 이미 계산된
// pyeong 값만 그대로 표시하거나, 아예 표시하지 않는다.
export function formatMarkerAreaLabel(
  pyeong: number | null | undefined,
  areaM2: number | null | undefined
): string {
  if (pyeong != null && Number.isFinite(pyeong) && pyeong > 0) return `${pyeong}평`;
  if (areaM2 != null && Number.isFinite(areaM2) && areaM2 > 0) return `${Math.round(areaM2)}㎡`;
  return '';
}

// 마커 칩 한 줄에 들어갈 "면적 가격" 텍스트. price/area는 항상 같은 거래
// row에서 나온 값이어야 한다(§8 PRICE + AREA IDENTITY) — 이 함수 자체는 그
// 결합을 강제하지 않으므로 호출부(map/page.tsx)가 반드시 같은 item에서 꺼낸
// dealAmount/pyeong/areaM2를 넘겨야 한다.
export function formatMarkerPriceAreaLine(
  dealAmountManwon: number | null | undefined,
  pyeong: number | null | undefined,
  areaM2: number | null | undefined
): string {
  const price = formatCompactPriceManwon(dealAmountManwon);
  if (!price) return '';
  const area = formatMarkerAreaLabel(pyeong, areaM2);
  return area ? `${area} ${price}` : price;
}
