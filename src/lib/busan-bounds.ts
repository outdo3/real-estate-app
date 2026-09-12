// BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §4/§11 — 좌표가 부산 안인지 판정하는 **순수** 함수.
//
// 왜 좌표 경계인가: 지도는 사용자의 실제 위치로 열린다(의도된 동작). 그 위치가 부산
// 밖인지 알려면 역지오코딩을 부를 수도 있지만, 그러면 지도를 움직일 때마다 네트워크
// 호출이 붙는다(§11 금지). bounding box 판정은 호출이 0이고 즉시 끝난다.
//
// 이 박스는 새로 만든 값이 아니다. BUSAN_DATA_UX_AUTOMATED_QA_V1에서 실측/합의해
// scripts/busan-qa-logic.ts와 src/lib/education/schoolinfo-stat-validate.ts가 이미 쓰던
// 것과 **같은 값**이며, 세 번째 사본을 만들지 않도록 여기로 모았다.
//
// 여유를 둔 박스라 경계 근처(예: 김해·양산 접경)에서는 부산으로 판정될 수 있다. 이
// 용도에는 그 편이 맞다 — 부산 사용자에게 "부산 밖입니다"라고 잘못 말하는 쪽이,
// 접경 지역 사용자에게 안내를 한 번 덜 보여주는 쪽보다 나쁘다.

export const BUSAN_BBOX = { minLat: 34.9, maxLat: 35.45, minLng: 128.6, maxLng: 129.35 } as const;

export function isInsideBusanBounds(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= BUSAN_BBOX.minLat &&
    lat <= BUSAN_BBOX.maxLat &&
    lng >= BUSAN_BBOX.minLng &&
    lng <= BUSAN_BBOX.maxLng
  );
}
