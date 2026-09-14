import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LAYER_PILL_EDGE,
  LAYER_PILL_HIT_HEIGHT,
  LAYER_PILL_ICON_SIZE,
  LAYER_PILL_VISIBLE_GAP,
  LAYER_PILL_VISIBLE_HEIGHT,
  LAYER_STACK_RIGHT,
  layerHitButtonStyle,
  layerPillStyle,
  layerStackStyle,
} from './map-layer-pill-style';

/** MAP_LAYER_PILL_COMPACT_UI_V1 — 지도 우측 레이어 알약을 글자 폭만큼 작게. 지도 로직·토글 동작은 그대로. */

const ROOT = resolve(__dirname, '../../..');
const PAGE = readFileSync(resolve(ROOT, 'src/app/map/page.tsx'), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const stackJsx = () => {
  const code = codeOf(PAGE);
  const start = code.indexOf('<div ref={rightControlRef}');
  return code.slice(start, code.indexOf('</div>', start));
};
const px = (v: unknown) => (typeof v === 'number' ? v : Number(String(v).replace('px', '')));

test('1. 여섯 레이어 라벨·순서 그대로 렌더(아파트·오피스텔·생숙·재개발·경·공매·학교)', () => {
  const code = codeOf(PAGE);
  assert.ok(/const LAYER_ORDER: LayerKey\[\] = \['apt', 'officetel', 'livingLodging', 'redevelopment', 'auction', 'school'\];/.test(code));
  for (const [k, label] of [['apt', '아파트'], ['officetel', '오피스텔'], ['livingLodging', '생숙'], ['redevelopment', '재개발'], ['auction', '경·공매'], ['school', '학교']]) {
    assert.ok(new RegExp(`${k}: '${label}',`).test(code), label);
  }
  const jsx = stackJsx();
  assert.ok(/\{LAYER_ORDER\.map\(\(key\) => \{/.test(jsx) && /\{LAYER_LABEL\[key\]\}/.test(jsx));
});

test('2. 선택 상태 의미 그대로: 활성 = 레이어 색 배경 + 흰 글자(아파트 green·오피스텔 teal), 비활성 = 밝은 배경', () => {
  const jsx = stackJsx();
  assert.ok(/<span style=\{layerPillStyle\(active, layerActiveBg\(key\)\)\}>/.test(jsx));
  assert.ok(/aria-pressed=\{active\}/.test(jsx));
  assert.ok(/const layerActiveBg = \(key: LayerKey\) => \(key === 'officetel' \? OFFI\.fill : 'var\(--primary-color\)'\);/.test(codeOf(PAGE)), '색 규칙 불변');
  const on = layerPillStyle(true, 'var(--primary-color)');
  const off = layerPillStyle(false, 'var(--primary-color)');
  assert.equal(on.background, 'var(--primary-color)');
  assert.equal(on.color, 'white');
  assert.equal(off.background, 'rgba(255,255,255,0.95)');
  assert.equal(off.color, 'var(--text-secondary)');
  assert.notEqual(on.boxShadow, off.boxShadow, '비선택은 더 가벼운 그림자');
  // 아이콘(아파트·오피스텔)도 그대로, 크기만 12px
  assert.ok(/key === 'officetel' && <Building2 size=\{LAYER_PILL_ICON_SIZE\}/.test(jsx) && /key === 'apt' && <Home size=\{LAYER_PILL_ICON_SIZE\}/.test(jsx));
  assert.equal(LAYER_PILL_ICON_SIZE, 12);
});

test('3·4. 고정/최소 폭 없음 + 좌우 패딩 축소(16px → 10px), 글자 폭 기준', () => {
  for (const style of [layerStackStyle, layerHitButtonStyle, layerPillStyle(true, 'x'), layerPillStyle(false, 'x')]) {
    assert.equal(style.width, undefined);
    assert.equal(style.minWidth, undefined);
  }
  assert.equal(layerPillStyle(false, 'x').padding, '0 10px');
  assert.equal(px(layerPillStyle(false, 'x').fontSize), 12.5);
  assert.equal(layerPillStyle(false, 'x').gap, '4px');
  assert.equal(layerPillStyle(false, 'x').borderRadius, '99px', '알약 모양 유지');
  // 예전 인라인 값(좌우 1rem, 전폭 늘림)은 남아 있지 않다
  assert.ok(!/padding: '0 1rem'/.test(stackJsx()));
});

test('5. 스택 컨테이너: 오른쪽 정렬(칩이 가장 긴 칩 폭으로 늘어나지 않음), 불필요한 폭·패딩 없음', () => {
  assert.equal(layerStackStyle.alignItems, 'flex-end');
  assert.equal(layerStackStyle.flexDirection, 'column');
  assert.equal(layerStackStyle.padding, undefined);
  assert.equal(layerStackStyle.gap, 0);
  assert.equal(layerStackStyle.top, '64px', '상단 컨트롤과의 위치 유지');
  assert.equal(layerStackStyle.zIndex, 10);
  // 보이는 알약의 화면 끝 여백은 기존 12px 그대로(스택 8px + 버튼 오른쪽 누름 여백 4px)
  assert.equal(LAYER_STACK_RIGHT + px(String(layerHitButtonStyle.padding).split(' ')[1]), LAYER_PILL_EDGE);
  assert.equal(LAYER_PILL_EDGE, 12);
  assert.ok(/<div ref=\{rightControlRef\} style=\{layerStackStyle\}>/.test(codeOf(PAGE)), '안전영역 측정 대상(ref)은 같은 요소');
});

test('6. 누르는 영역: 보이는 알약 32px, 버튼 세로 38px(알약 + 간격 6px, 버튼 사이 빈틈 없음), 좌우로 더 넓게', () => {
  assert.equal(LAYER_PILL_VISIBLE_HEIGHT, 32);
  assert.equal(LAYER_PILL_VISIBLE_GAP, 6);
  assert.equal(LAYER_PILL_HIT_HEIGHT, 38);
  assert.equal(layerHitButtonStyle.minHeight, LAYER_PILL_HIT_HEIGHT);
  assert.equal(layerPillStyle(true, 'x').height, LAYER_PILL_VISIBLE_HEIGHT);
  assert.equal(layerHitButtonStyle.background, 'transparent');
  assert.equal(layerHitButtonStyle.border, 'none');
  assert.equal(layerHitButtonStyle.padding, '0 4px 0 8px');
  assert.equal(layerHitButtonStyle.touchAction, 'manipulation');
  assert.equal(layerStackStyle.gap, 0, '버튼 사이 누르지 못하는 틈 없음');
});

test('7. 글자 잘림 없음: 줄바꿈 금지·높이 고정·말줄임/overflow 숨김 없음', () => {
  const pill = layerPillStyle(false, 'x');
  assert.equal(pill.whiteSpace, 'nowrap');
  assert.equal(pill.overflow, undefined);
  assert.equal(pill.textOverflow, undefined);
  assert.equal(pill.maxWidth, undefined);
  assert.equal(pill.boxSizing, 'border-box');
  assert.ok(px(pill.fontSize) * 1 < LAYER_PILL_VISIBLE_HEIGHT - 2, '한 줄 글자가 알약 높이 안');
});

test('8. 지도 로직 불변: 토글 핸들러·레이어 상태·안전영역 측정·색 규칙 그대로', () => {
  const code = codeOf(PAGE);
  const jsx = stackJsx();
  assert.ok(/onClick=\{\(\) => toggleLayer\(key\)\}/.test(jsx));
  assert.ok(/setSafeZoneRects\(\{ top: toRelative\(topControlRowRef\.current\), right: toRelative\(rightControlRef\.current\) \}\);/.test(code));
  assert.ok(/type LayerKey = 'apt' \| 'officetel' \| 'livingLodging' \| 'redevelopment' \| 'auction' \| 'school';/.test(code));
  assert.ok(/const COMING_SOON_LAYERS: LayerKey\[\] = \['livingLodging', 'redevelopment', 'auction'\];/.test(code));
  // 스타일 모듈은 모양 값만(React 타입 외 import 없음)
  const mod = readFileSync(resolve(ROOT, 'src/lib/map/map-layer-pill-style.ts'), 'utf8');
  assert.ok(!/fetch\(|kakao|useState|toggleLayer|layers\[/.test(codeOf(mod)));
  assert.ok(/^import type \{ CSSProperties \} from 'react';$/m.test(mod));
});
