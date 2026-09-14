// MAP_LAYER_PILL_COMPACT_UI_V1 — 지도 우측 레이어 토글(아파트·오피스텔·생숙·재개발·경·공매·학교)의 모양 값.
//
// 문제: 버튼마다 좌우 16px 패딩 + 세로 스택이 기본 align-items: stretch라 **모든 칩이 가장 긴 칩(오피스텔+아이콘) 폭**으로 늘어나
// 짧은 라벨도 93×44px 알약이 되어 지도 마커·도로·단지명을 가렸다(Production 측정).
//
// 해결: 누르는 영역(버튼)과 보이는 알약(안쪽 span)을 나눈다.
//  - 보이는 알약: 높이 32px, 좌우 10px, 12.5px 글자, 아이콘 간격 4px — 폭은 글자 길이만큼.
//  - 버튼: 투명, 세로 38px(알약 32 + 보이는 간격 6), 알약보다 좌 8px·우 4px 넓게 눌림. 버튼끼리 간격 0이라
//    세로로 빈틈 없이 38px 간격으로 누를 수 있다(6개가 세로로 붙어 있어 44px로 키우면 보이는 간격이 12px로 벌어진다).
//  - 스택은 오른쪽 정렬(align-items: flex-end)이라 각 버튼이 자기 알약 폭만큼만 차지한다.
// 색·선택 상태 의미·토글 동작은 바꾸지 않는다(색은 page.tsx의 layerActiveBg 그대로).
import type { CSSProperties } from 'react';

export const LAYER_PILL_VISIBLE_HEIGHT = 32;
export const LAYER_PILL_VISIBLE_GAP = 6;
/** 버튼(누르는 영역) 높이 = 보이는 알약 + 보이는 간격. */
export const LAYER_PILL_HIT_HEIGHT = LAYER_PILL_VISIBLE_HEIGHT + LAYER_PILL_VISIBLE_GAP;
export const LAYER_PILL_ICON_SIZE = 12;
/** 스택의 오른쪽 여백. 버튼이 오른쪽으로 4px 더 눌리므로 보이는 알약은 기존과 같은 화면 끝 12px 위치다. */
export const LAYER_STACK_RIGHT = 8;
/** 보이는 알약의 화면 오른쪽 끝 여백(기존 값 12px 유지). */
export const LAYER_PILL_EDGE = 12;
const HIT_PAD_LEFT = 8;
const HIT_PAD_RIGHT = LAYER_PILL_EDGE - LAYER_STACK_RIGHT;

export const layerStackStyle: CSSProperties = {
  position: 'absolute',
  right: `${LAYER_STACK_RIGHT}px`,
  top: '64px',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 0,
};

export const layerHitButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  minHeight: LAYER_PILL_HIT_HEIGHT,
  margin: 0,
  padding: `0 ${HIT_PAD_RIGHT}px 0 ${HIT_PAD_LEFT}px`,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'manipulation',
};

export function layerPillStyle(active: boolean, activeBackground: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    height: LAYER_PILL_VISIBLE_HEIGHT,
    padding: '0 10px',
    borderRadius: '99px',
    fontWeight: 700,
    fontSize: '12.5px',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    background: active ? activeBackground : 'rgba(255,255,255,0.95)',
    color: active ? 'white' : 'var(--text-secondary)',
    border: active ? '1px solid transparent' : '1px solid rgba(15,23,42,0.08)',
    boxShadow: active ? '0 2px 8px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.12)',
    boxSizing: 'border-box',
  };
}
