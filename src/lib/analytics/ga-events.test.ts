import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANALYTICS_EVENT_NAMES, isAnalyticsEventName } from './events';
import {
  GA_EVENT_MAP,
  GA_RESERVED_PARTNER_EVENTS,
  gaMappedFirstPartyEvents,
  isValidGaEventName,
  toGaEventName,
} from './ga-events';

// ── §9 이벤트 이름 규칙 ─────────────────────────────────────────────────────

test('GA4로 나가는 모든 이벤트명이 GA4 명명 규칙을 지킨다', () => {
  for (const gaName of Object.values(GA_EVENT_MAP)) {
    assert.ok(gaName, '매핑 값이 비어 있으면 안 된다');
    assert.ok(isValidGaEventName(gaName!), `${gaName}은(는) 소문자 snake_case 40자 이내여야 한다`);
  }
});

test('이름 규칙 검증기가 잘못된 이름을 거른다', () => {
  assert.equal(isValidGaEventName('report_view'), true);
  assert.equal(isValidGaEventName('Report_View'), false, '대문자 금지');
  assert.equal(isValidGaEventName('report view'), false, '공백 금지');
  assert.equal(isValidGaEventName('리포트_조회'), false, '한글 키 금지');
  assert.equal(isValidGaEventName('1report'), false, '숫자로 시작 금지');
  assert.equal(isValidGaEventName('a'.repeat(41)), false, '40자 초과 금지');
});

// ── §7/§8 allowlist 매핑 ────────────────────────────────────────────────────

test('매핑 표의 모든 키가 실제 1st-party taxonomy 안에 있다', () => {
  for (const key of Object.keys(GA_EVENT_MAP)) {
    assert.ok(isAnalyticsEventName(key), `${key}는 ANALYTICS_EVENT_NAMES에 없는 이름이다`);
  }
  assert.equal(gaMappedFirstPartyEvents().length, Object.keys(GA_EVENT_MAP).length);
});

test('매핑되지 않은 이벤트는 GA4로 나가지 않는다(기본값 = 보내지 않음)', () => {
  // 고빈도 노이즈/중복/제품 전용 이벤트는 의도적으로 제외돼 있다(§8).
  assert.equal(toGaEventName('share_attempt'), null);
  assert.equal(toGaEventName('compare_remove'), null);
  assert.equal(toGaEventName('next_action_click'), null);
  assert.equal(toGaEventName('finance_fit_start'), null);
  assert.equal(toGaEventName('finance_fit_calculate'), null);
});

test('taxonomy에 새 이벤트가 생겨도 자동으로 GA4에 실리지 않는다', () => {
  const mapped = new Set(gaMappedFirstPartyEvents());
  const unmapped = ANALYTICS_EVENT_NAMES.filter((n) => !mapped.has(n));
  assert.ok(unmapped.length > 0, '매핑되지 않은 이벤트가 존재하는 것이 정상이다');
  for (const n of unmapped) assert.equal(toGaEventName(n), null);
});

// ── §11 리포트 이벤트 매핑 ──────────────────────────────────────────────────

test('리포트 액션이 GA4 이벤트로 매핑된다', () => {
  assert.equal(toGaEventName('report_view'), 'report_view');
  assert.equal(toGaEventName('report_image_save'), 'report_image_save');
  assert.equal(toGaEventName('report_pdf_save'), 'report_pdf_save');
  assert.equal(toGaEventName('report_share'), 'report_share');
});

// ── §12 PWA 이벤트 매핑 ─────────────────────────────────────────────────────

test('PWA 설치 퍼널 5개가 전부 매핑돼 있다', () => {
  assert.equal(toGaEventName('pwa_install_banner_view'), 'pwa_install_banner_view');
  assert.equal(toGaEventName('pwa_install_click'), 'pwa_install_click');
  assert.equal(toGaEventName('pwa_install_accept'), 'pwa_install_accept');
  assert.equal(toGaEventName('pwa_install_dismiss'), 'pwa_install_dismiss');
  assert.equal(toGaEventName('pwa_install_guide_open'), 'pwa_install_guide_open');
});

// ── §13/§14 찜 · 비교 ───────────────────────────────────────────────────────

test('찜/비교 이벤트 매핑', () => {
  assert.equal(toGaEventName('favorite_add'), 'favorite_add');
  assert.equal(toGaEventName('favorite_remove'), 'favorite_remove');
  assert.equal(toGaEventName('compare_start'), 'compare_start');
  assert.equal(toGaEventName('compare_add'), 'compare_add');
  assert.equal(toGaEventName('share_success'), 'share', 'GA4 권장 이벤트명을 쓴다');
});

// ── §15 파트너 ──────────────────────────────────────────────────────────────

test('파트너 이벤트는 예약만 돼 있고 실제로 매핑되지 않는다', () => {
  // 저장소에 파트너 리드 기능 자체가 없다. 존재하지 않는 이벤트를 지어내지 않는다.
  const mappedGaNames = new Set(Object.values(GA_EVENT_MAP));
  for (const reserved of GA_RESERVED_PARTNER_EVENTS) {
    assert.equal(mappedGaNames.has(reserved), false, `${reserved}는 아직 연결되면 안 된다`);
    assert.ok(isValidGaEventName(reserved), '예약 이름도 GA4 명명 규칙은 지켜 둔다');
  }
});

test('측정 수단이 없는 성과 이벤트는 예약조차 하지 않는다', () => {
  const reserved = new Set<string>(GA_RESERVED_PARTNER_EVENTS);
  assert.equal(reserved.has('call_connected'), false);
  assert.equal(reserved.has('consultation_completed'), false);
});
