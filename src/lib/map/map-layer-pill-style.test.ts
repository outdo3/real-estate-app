import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LAYER_PILL_EDGE,
  LAYER_PILL_HIT_HEIGHT,
  LAYER_PILL_ICON_GAP,
  LAYER_PILL_ICON_SIZE,
  LAYER_PILL_ICON_SLOT,
  LAYER_PILL_PAD_LEFT,
  LAYER_PILL_VISIBLE_GAP,
  LAYER_PILL_VISIBLE_HEIGHT,
  LAYER_PILL_VISIBLE_WIDTH,
  LAYER_STACK_RIGHT,
  layerHitButtonStyle,
  layerPillIconSlotStyle,
  layerPillStyle,
  layerStackStyle,
} from './map-layer-pill-style';

/**
 * MAP_LAYER_PILL_COMPACT_UI_V1 — 지도 우측 레이어 알약을 작게(누르는 영역과 보이는 알약 분리).
 * MAP_LAYER_PILL_UNIFIED_COMPACT_UI_V2 — 정렬감 우선: 모든 알약 같은 폭·높이(72×32), 표시 라벨 "오피"·"경공매"(재개발 그대로).
 * 지도 로직·토글·URL·aria-pressed·선택 상태는 그대로.
 */

const ROOT = resolve(__dirname, '../../..');
const PAGE = readFileSync(resolve(ROOT, 'src/app/map/page.tsx'), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const stackJsx = () => {
  const code = codeOf(PAGE);
  const start = code.indexOf('<div ref={rightControlRef}');
  return code.slice(start, code.indexOf('</button>', start) + '</button>'.length);
};
const labelMap = () => {
  const code = codeOf(PAGE);
  const start = code.indexOf('const LAYER_LABEL: Record<LayerKey, string> = {');
  const block = code.slice(start, code.indexOf('};', start));
  return Object.fromEntries([...block.matchAll(/(\w+): '([^']+)',/g)].map((m) => [m[1], m[2]]));
};
const px = (v: unknown) => (typeof v === 'number' ? v : Number(String(v).replace('px', '')));

test('1·2·3·4. 여섯 라벨·순서: 아파트·오피·생숙·재개발·경공매·학교(표시만 줄임, 재개발 그대로)', () => {
  const code = codeOf(PAGE);
  assert.ok(/const LAYER_ORDER: LayerKey\[\] = \['apt', 'officetel', 'livingLodging', 'redevelopment', 'auction', 'school'\];/.test(code));
  assert.deepEqual(labelMap(), { apt: '아파트', officetel: '오피', livingLodging: '생숙', redevelopment: '재개발', auction: '경공매', school: '학교' });
  const jsx = stackJsx();
  assert.ok(/\{LAYER_ORDER\.map\(\(key\) => \{/.test(jsx));
  assert.ok(/<span>\{LAYER_LABEL\[key\]\}<\/span>/.test(jsx));
  // 줄인 "오피"만 보조기기에 전체 이름(보이는 글자를 포함 — WCAG 2.5.3). 나머지는 보이는 글자가 이름.
  assert.ok(/const LAYER_ARIA_LABEL: Partial<Record<LayerKey, string>> = \{ officetel: '오피스텔' \};/.test(code));
  assert.ok(/aria-label=\{LAYER_ARIA_LABEL\[key\]\}/.test(jsx));
  assert.ok('오피스텔'.includes(labelMap().officetel));
});

test('5·6. 모든 알약 같은 폭·높이(72×32, 선택·레이어 색과 무관), 같은 모서리·여백 구조, 가변 폭 없음', () => {
  const styles = [layerPillStyle(true, 'var(--primary-color)'), layerPillStyle(false, 'var(--primary-color)'), layerPillStyle(true, '#0d9488'), layerPillStyle(false, '#0d9488')];
  for (const st of styles) {
    assert.equal(st.width, LAYER_PILL_VISIBLE_WIDTH);
    assert.equal(st.height, LAYER_PILL_VISIBLE_HEIGHT);
    assert.equal(st.minWidth, undefined);
    assert.equal(st.maxWidth, undefined);
    assert.equal(st.borderRadius, '99px');
    assert.equal(st.padding, `0 0 0 ${LAYER_PILL_PAD_LEFT}px`);
    assert.equal(st.boxSizing, 'border-box', '테두리 포함 72px');
    assert.equal(px(st.fontSize), 12.5);
    assert.equal(st.gap, `${LAYER_PILL_ICON_GAP}px`);
  }
  assert.ok(LAYER_PILL_VISIBLE_WIDTH >= 68 && LAYER_PILL_VISIBLE_WIDTH <= 74, '예전 93px로 돌아가지 않음');
  assert.equal(LAYER_PILL_VISIBLE_HEIGHT, 32);
  for (const st of [layerStackStyle, layerHitButtonStyle]) assert.equal(st.width, undefined, '폭 기준은 알약');
  assert.ok(!/padding: '0 1rem'/.test(stackJsx()));
});

test('정렬. 아이콘 칸을 모든 알약에 같은 폭으로 두어 아이콘 위치·글자 시작선이 같다', () => {
  assert.equal(layerPillStyle(false, 'x').justifyContent, 'flex-start');
  assert.equal(layerPillIconSlotStyle.width, LAYER_PILL_ICON_SLOT);
  assert.equal(layerPillIconSlotStyle.flexShrink, 0);
  assert.equal(LAYER_PILL_ICON_SLOT, LAYER_PILL_ICON_SIZE);
  assert.equal(LAYER_PILL_ICON_SIZE, 12);
  const jsx = stackJsx();
  // 아이콘 칸은 조건 없이 항상 렌더(아이콘만 조건부)
  assert.ok(/<span style=\{layerPillIconSlotStyle\} aria-hidden="true">\s*\{key === 'officetel' && <Building2 size=\{LAYER_PILL_ICON_SIZE\} \/>\}\s*\{key === 'apt' && <Home size=\{LAYER_PILL_ICON_SIZE\} \/>\}\s*<\/span>/.test(jsx));
  // 모든 알약의 글자 시작 x = 왼쪽 여백 + 아이콘 칸 + 간격
  assert.equal(LAYER_PILL_PAD_LEFT + LAYER_PILL_ICON_SLOT + LAYER_PILL_ICON_GAP, 28);
  // 스택 오른쪽 정렬 + 같은 폭 → 왼쪽·오른쪽 선이 일치
  assert.equal(layerStackStyle.alignItems, 'flex-end');
  assert.equal(LAYER_STACK_RIGHT + px(String(layerHitButtonStyle.padding).split(' ')[1]), LAYER_PILL_EDGE);
});

test('7. 글자 잘림 없음: 가장 긴 라벨(세 글자) + 아이콘 칸이 72px 안, 줄바꿈 금지·말줄임/overflow 숨김 없음', () => {
  // Production 측정(Pretendard 700 12.5px): 세 글자 32.4px(아파트·재개발·경공매). 더 넓은 대체 글꼴 가정(3×12.5=37.5px)도 확인.
  const border = 1;
  for (const textWidth of [32.4, 37.5]) {
    const end = border + LAYER_PILL_PAD_LEFT + LAYER_PILL_ICON_SLOT + LAYER_PILL_ICON_GAP + textWidth;
    assert.ok(end <= LAYER_PILL_VISIBLE_WIDTH - border - 4, `글자 끝 ${end}px이 알약 안쪽(여유 4px 이상)`);
  }
  assert.ok(Math.max(...Object.values(labelMap()).map((l) => [...l].length)) <= 3, '라벨 세 글자 이하');
  const pill = layerPillStyle(false, 'x');
  assert.equal(pill.whiteSpace, 'nowrap');
  assert.equal(pill.overflow, undefined);
  assert.equal(pill.textOverflow, undefined);
});

test('8. 선택 상태 의미 그대로: 활성 = 레이어 색 배경 + 흰 글자(아파트 green·오피스텔 teal), 비활성 = 밝은 배경', () => {
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
});

test('누르는 영역: 보이는 알약 32px, 버튼 세로 38px(알약 + 간격 6px, 버튼 사이 빈틈 없음), 좌우로 더 넓게', () => {
  assert.equal(LAYER_PILL_VISIBLE_GAP, 6);
  assert.equal(LAYER_PILL_HIT_HEIGHT, 38);
  assert.equal(layerHitButtonStyle.minHeight, LAYER_PILL_HIT_HEIGHT);
  assert.equal(layerHitButtonStyle.background, 'transparent');
  assert.equal(layerHitButtonStyle.padding, '0 4px 0 8px');
  assert.equal(layerHitButtonStyle.touchAction, 'manipulation');
  assert.equal(layerStackStyle.gap, 0, '버튼 사이 누르지 못하는 틈 없음');
  assert.equal(layerStackStyle.top, '64px');
  assert.ok(/<div ref=\{rightControlRef\} style=\{layerStackStyle\}>/.test(codeOf(PAGE)), '안전영역 측정 대상(ref)은 같은 요소');
});

test('9·10·11. 지도 로직 불변: 토글 핸들러·레이어 키·URL 레이어 상태·안전영역 측정·색 규칙 그대로', () => {
  const code = codeOf(PAGE);
  assert.ok(/onClick=\{\(\) => toggleLayer\(key\)\}/.test(stackJsx()));
  assert.ok(/setSafeZoneRects\(\{ top: toRelative\(topControlRowRef\.current\), right: toRelative\(rightControlRef\.current\) \}\);/.test(code));
  assert.ok(/type LayerKey = 'apt' \| 'officetel' \| 'livingLodging' \| 'redevelopment' \| 'auction' \| 'school';/.test(code));
  assert.ok(/const COMING_SOON_LAYERS: LayerKey\[\] = \['livingLodging', 'redevelopment', 'auction'\];/.test(code));
  // 표시 라벨은 알약 렌더 한 곳에서만 쓰인다 — URL·상태·안내 문구에 들어가지 않는다
  assert.equal((code.match(/LAYER_LABEL\[/g) || []).length, 1);
  assert.ok(/경매\/공매 매물 데이터는 아직 연동 준비 중입니다\./.test(code), '안내 문구는 그대로');
  const mod = readFileSync(resolve(ROOT, 'src/lib/map/map-layer-pill-style.ts'), 'utf8');
  assert.ok(!/fetch\(|kakao|useState|toggleLayer|layers\[/.test(codeOf(mod)));
  assert.ok(/^import type \{ CSSProperties \} from 'react';$/m.test(mod));
});
