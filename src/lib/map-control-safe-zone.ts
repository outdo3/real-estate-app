// MAP UI POLISH V1 §7~12 — 지도 상단(검색+공유)/우측(레이어 토글) 플로팅 컨트롤
// 아래로 마커 칩이 시각적으로 겹쳐 보이는 문제를 해결하기 위한 순수 계산 로직.
// map/page.tsx(DOM/Kakao SDK 부작용 있음)와 분리해 단위 테스트한다(기존
// map-selected-marker.ts/map-marker-format.ts와 동일 관례).
//
// 전략: 마커 데이터를 지우거나(§9) 클러스터링 알고리즘을 광범위하게 다시 쓰지
// 않고(§17), 이미 계산돼 있는 화면 픽셀 좌표(projection.containerPointFromCoords)
// 를 기준으로 "control rect와 겹치면 그만큼만 화면상에서 밀어낸다"는 순수 함수
// 하나로 처리한다 — 마커의 실제 lat/lng, 클릭 대상, identity는 전혀 바뀌지
// 않고 렌더링 시 CSS translate/offset에 더하는 값만 계산한다.

export interface SafeZoneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Nudge {
  dx: number;
  dy: number;
}

function overlaps(chip: SafeZoneRect, zone: SafeZoneRect): boolean {
  return chip.right > zone.left && chip.left < zone.right && chip.bottom > zone.top && chip.top < zone.bottom;
}

// 칩 하나(center=point, 절반 크기 halfW/halfH)가 top/right 두 safe-zone 사각형과
// 겹치면 최소한으로만 밀어내는 픽셀 오프셋을 계산한다. top zone과는 아래로,
// right zone과는 왼쪽으로 밀어낸다(두 방향을 섞지 않아 항상 예측 가능한 단일
// 방향 이동 — §8 "과도한 abstraction 금지"). 두 zone 모두와 겹치면(오른쪽 위
// 모서리) 두 보정이 함께 적용된다.
export function computeSafeZoneNudge(
  point: Point,
  halfWidth: number,
  halfHeight: number,
  topZone: SafeZoneRect | null,
  rightZone: SafeZoneRect | null,
  buffer = 6
): Nudge {
  let dx = 0;
  let dy = 0;

  if (topZone) {
    const chip: SafeZoneRect = { left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - halfHeight, bottom: point.y + halfHeight };
    if (overlaps(chip, topZone)) {
      dy = topZone.bottom - chip.top + buffer;
    }
  }

  if (rightZone) {
    const chip: SafeZoneRect = { left: point.x - halfWidth, right: point.x + halfWidth, top: point.y - halfHeight + dy, bottom: point.y + halfHeight + dy };
    if (overlaps(chip, rightZone)) {
      dx = rightZone.left - chip.right - buffer;
    }
  }

  return { dx, dy };
}

// §12 SEARCH → SELECTED OFFSET — 검색으로 선택한 마커를 정확히 중앙에 놓으면
// (panTo) 그 지점이 safe-zone과 겹칠 수 있다(좁은 뷰포트 등). "화면상에서
// nudge만큼 이동해 보이게 하려면 지도 중심을 얼마나 옮겨야 하는가"를 순수하게
// 계산한다 — panBy의 부호 규칙을 추측하지 않고, coordsFromContainerPoint의
// 역변환 성질만 이용한다: 어떤 지점이 현재 centerPoint에서 렌더된다면, 그
// 지점이 nudge만큼 이동해 보이게 하려면 새 지도 중심은 화면상 (centerPoint -
// nudge) 위치에 있던 지점이어야 한다.
export function computeNudgedCenterPoint(centerPoint: Point, nudge: Nudge): Point {
  return { x: centerPoint.x - nudge.dx, y: centerPoint.y - nudge.dy };
}
