import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollProgress,
  nextActionBarVisibility,
  shouldShowActionBar,
  SHOW_AT_PROGRESS,
  HIDE_AT_PROGRESS,
} from './action-bar-visibility';

/**
 * APT_DETAIL_MOBILE_DENSITY_ACTION_BAR_V1 §22 — 스마트 액션바 계약.
 *
 * 이 바의 의미는 "스크롤을 조금 내렸다"가 아니라 "정보를 충분히 봤다"이다.
 * 그래서 기준이 픽셀이 아니라 진행률이고, 히스테리시스가 있어야 한다.
 */

const VP = 800; // viewport height
const DOC = 8000; // document height → scrollable 7200

/** 진행률 p에 해당하는 scrollY. */
const atProgress = (p: number) => p * (DOC - VP);

// ── 초기 상태 ───────────────────────────────────────────────────────────────

test('A. 페이지를 처음 열면 액션바는 숨어 있다', () => {
  assert.equal(shouldShowActionBar(0, VP, DOC, false), false);
});

test('B. 페이지 위/중간을 읽는 동안 계속 숨어 있다', () => {
  for (const p of [0, 0.1, 0.25, 0.5, 0.6, 0.7, 0.77]) {
    assert.equal(
      shouldShowActionBar(atProgress(p), VP, DOC, false),
      false,
      `진행률 ${p}에서 아직 뜨면 안 된다`
    );
  }
});

test('스크롤을 조금 내렸다는 이유만으로 뜨지 않는다', () => {
  // 100px은 8000px 문서에서 약 1.4%다.
  assert.equal(shouldShowActionBar(100, VP, DOC, false), false);
});

// ── C. 하단 임계에서 노출 ───────────────────────────────────────────────────

test('C. 78% 지점에서 올라온다', () => {
  assert.equal(shouldShowActionBar(atProgress(SHOW_AT_PROGRESS), VP, DOC, false), true);
  assert.equal(shouldShowActionBar(atProgress(0.85), VP, DOC, false), true);
  assert.equal(shouldShowActionBar(atProgress(1), VP, DOC, false), true);
});

test('임계 바로 아래에서는 아직 뜨지 않는다', () => {
  assert.equal(shouldShowActionBar(atProgress(SHOW_AT_PROGRESS - 0.01), VP, DOC, false), false);
});

// ── D. 히스테리시스 — 깜빡이지 않는다 ───────────────────────────────────────

test('D. 한 번 뜬 뒤에는 78% 경계를 오가도 사라지지 않는다', () => {
  let visible = shouldShowActionBar(atProgress(0.8), VP, DOC, false);
  assert.equal(visible, true);
  // 경계 주변에서 손가락이 흔들리는 상황
  for (const p of [0.79, 0.77, 0.75, 0.7, 0.65, 0.62]) {
    visible = shouldShowActionBar(atProgress(p), VP, DOC, visible);
    assert.equal(visible, true, `진행률 ${p}에서 사라지면 깜빡임이 된다`);
  }
});

test('숨김 임계(60%) 아래로 **되돌아가야** 사라진다', () => {
  let visible = true;
  visible = shouldShowActionBar(atProgress(HIDE_AT_PROGRESS + 0.01), VP, DOC, visible);
  assert.equal(visible, true);
  visible = shouldShowActionBar(atProgress(HIDE_AT_PROGRESS), VP, DOC, visible);
  assert.equal(visible, false, '60% 이하면 숨는다');
});

test('나타나는 기준과 사라지는 기준이 충분히 벌어져 있다', () => {
  assert.ok(SHOW_AT_PROGRESS - HIDE_AT_PROGRESS >= 0.15, '간격이 좁으면 히스테리시스가 의미 없다');
  assert.equal(SHOW_AT_PROGRESS, 0.78);
  assert.equal(HIDE_AT_PROGRESS, 0.6);
});

test('사라진 뒤 다시 뜨려면 78%를 다시 넘어야 한다(왕복 안정성)', () => {
  let visible = false;
  visible = shouldShowActionBar(atProgress(0.8), VP, DOC, visible); // show
  visible = shouldShowActionBar(atProgress(0.5), VP, DOC, visible); // hide
  assert.equal(visible, false);
  visible = shouldShowActionBar(atProgress(0.7), VP, DOC, visible); // 아직
  assert.equal(visible, false);
  visible = shouldShowActionBar(atProgress(0.79), VP, DOC, visible);
  assert.equal(visible, true);
});

// ── §15 경계 상황 ───────────────────────────────────────────────────────────

test('페이지가 화면보다 짧으면 이미 다 본 것이므로 바로 보여준다', () => {
  // 스크롤할 것이 없는 상태에서 영영 뜨지 않는 CTA가 더 이상한 동작이다.
  assert.equal(scrollProgress(0, 800, 600), 1);
  assert.equal(scrollProgress(0, 800, 800), 1);
  assert.equal(shouldShowActionBar(0, 800, 600, false), true);
});

test('진행률은 항상 0~1로 갇힌다', () => {
  assert.equal(scrollProgress(-500, VP, DOC), 0, '바운스 스크롤로 음수가 와도 안전하다');
  assert.equal(scrollProgress(999999, VP, DOC), 1, '오버스크롤도 1을 넘지 않는다');
});

test('말이 안 되는 치수가 들어와도 던지지 않는다', () => {
  assert.equal(scrollProgress(0, NaN, DOC), 1);
  assert.equal(scrollProgress(NaN, VP, DOC), 1);
  assert.equal(scrollProgress(0, VP, 0), 1);
});

test('문서 높이가 조금 변해도 판정이 뒤집히지 않는다(액션바가 예약 여백을 더할 때)', () => {
  // 바가 뜨면 .mainWithActionBar가 약 40px을 더한다. 그 변화로 다시 숨으면
  // 문서 높이가 줄고 다시 뜨는 진동이 생긴다.
  const y = atProgress(0.8);
  let visible = shouldShowActionBar(y, VP, DOC, false);
  assert.equal(visible, true);
  visible = shouldShowActionBar(y, VP, DOC + 40, visible);
  assert.equal(visible, true, '여백 추가로 숨으면 진동한다');
});

// ── 계산 자체 ───────────────────────────────────────────────────────────────

test('진행률 계산은 스크롤 가능 영역 기준이다', () => {
  assert.equal(scrollProgress(0, 800, 8000), 0);
  assert.equal(scrollProgress(3600, 800, 8000), 0.5);
  assert.equal(scrollProgress(7200, 800, 8000), 1);
});

test('nextActionBarVisibility는 현재 상태를 반드시 반영한다', () => {
  // 같은 진행률인데 이전 상태에 따라 답이 다르다 — 그게 히스테리시스다.
  assert.equal(nextActionBarVisibility(0.7, false), false);
  assert.equal(nextActionBarVisibility(0.7, true), true);
});
