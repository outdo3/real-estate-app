import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventUrl, isAnalyticsEventName } from './events';
import { NEXT_ACTION_TYPES } from '@/lib/decision-journey/types';

test('actionType 없이 eventUrl을 호출하면 기본 네임스페이스만 반환한다', () => {
  assert.equal(eventUrl('next_action_click'), '/__event__/next_action_click');
});

test('actionType이 있으면 쿼리로 인코딩된다', () => {
  assert.equal(eventUrl('next_action_click', 'COMPARE'), '/__event__/next_action_click?action=COMPARE');
});

test('actionType이 있어도 기존 이벤트/페이지뷰 구분 접두사(startsWith)는 깨지지 않는다', () => {
  const url = eventUrl('next_action_click', 'BUDGET');
  assert.equal(url.startsWith('/__event__/'), true);
  assert.equal(url.startsWith('/__event__/next_action_click'), true);
});

test('실제 NextActionType enum의 모든 값이 유효한 actionType으로 인코딩된다', () => {
  for (const type of NEXT_ACTION_TYPES) {
    const url = eventUrl('next_action_click', type);
    assert.equal(url, `/__event__/next_action_click?action=${type}`);
  }
});

test('허용되지 않은 이벤트명은 isAnalyticsEventName이 거부한다', () => {
  assert.equal(isAnalyticsEventName('arbitrary_event'), false);
  assert.equal(isAnalyticsEventName('next_action_click'), true);
});
