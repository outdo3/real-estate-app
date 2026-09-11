import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageViewParams,
  createPageViewDeduper,
  gaEvent,
  gaInitScriptBody,
  gaPageView,
  gaRuntimeEnabled,
  isGaConfigured,
  isGaEnvEnabled,
  sanitizeGaParams,
  stripInternalQueryParams,
} from './ga';

// ── §24 Measurement ID 게이트 ────────────────────────────────────────────────

test('Measurement ID가 없으면 GA4는 꺼진다', () => {
  assert.equal(isGaConfigured(''), false);
  assert.equal(isGaEnvEnabled('', 'production', false), false);
  assert.equal(isGaEnvEnabled('', 'production', true), false);
});

test('GA4 형식이 아닌 ID는 받지 않는다(UA-/GTM-/오타)', () => {
  assert.equal(isGaConfigured('UA-12345-1'), false);
  assert.equal(isGaConfigured('GTM-ABCDEF'), false);
  assert.equal(isGaConfigured('G-'), false);
  assert.equal(isGaConfigured('g-abcdefghij'), false, '소문자는 GA4 형식이 아니다');
  assert.equal(isGaConfigured('G-ABCDEFGHIJ'), true);
});

test('로컬 dev에서는 ID가 있어도 기본적으로 꺼지고, debug 플래그로만 켜진다(§18)', () => {
  const id = 'G-ABCDEFGHIJ';
  assert.equal(isGaEnvEnabled(id, 'development', false), false);
  assert.equal(isGaEnvEnabled(id, 'development', true), true);
  assert.equal(isGaEnvEnabled(id, 'production', false), true);
  assert.equal(isGaEnvEnabled(id, 'test', false), false);
});

test('서버(window 없음)에서는 런타임 게이트가 항상 false다', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(gaRuntimeEnabled(), false);
});

// ── §24 PII 거부 / 파라미터 allowlist ────────────────────────────────────────

test('allowlist에 없는 키는 전부 버린다', () => {
  const out = sanitizeGaParams({
    page_path: '/report/apt/123',
    apt_name: '해운대 두산위브',
    q: '방 3개 10억 이하',
    user_id: 'abc',
    note: '아무 자유 텍스트',
  });
  assert.deepEqual(out, { page_path: '/report/apt/123' });
});

test('PII 키는 절대 통과하지 못한다(§10)', () => {
  const out = sanitizeGaParams({
    email: 'a@b.com',
    phone: '010-1234-5678',
    name: '홍길동',
    customer_name: '홍길동',
    owner_name: '홍길동',
    session_token: 'xyz',
    oauth_id: '12345',
  });
  assert.deepEqual(out, {}, 'PII 키는 하나도 남지 않아야 한다');
});

test('allowlist 키라도 값이 이메일/전화번호로 보이면 버린다(심층 방어)', () => {
  assert.deepEqual(sanitizeGaParams({ source_surface: 'user@example.com' }), {});
  assert.deepEqual(sanitizeGaParams({ source_surface: '010-1234-5678' }), {});
  assert.deepEqual(sanitizeGaParams({ page_title: '문의 01012345678' }), {});
  assert.deepEqual(sanitizeGaParams({ source_surface: 'report_hub' }), { source_surface: 'report_hub' });
});

test('빈 값/타입이 맞지 않는 값/NaN은 버리고, 긴 문자열은 100자로 자른다', () => {
  assert.deepEqual(sanitizeGaParams({ placement: '   ' }), {});
  assert.deepEqual(sanitizeGaParams({ placement: null }), {});
  assert.deepEqual(sanitizeGaParams({ placement: { a: 1 } }), {});
  assert.deepEqual(sanitizeGaParams({ compare_count: NaN }), {});
  assert.deepEqual(sanitizeGaParams({ compare_count: 2 }), { compare_count: 2 });
  const long = 'a'.repeat(250);
  assert.equal((sanitizeGaParams({ page_title: long }).page_title as string).length, 100);
});

test('sanitize는 null/undefined 입력에도 빈 객체를 돌려준다', () => {
  assert.deepEqual(sanitizeGaParams(null), {});
  assert.deepEqual(sanitizeGaParams(undefined), {});
});

// ── §24 page_view 페이로드 모양 ──────────────────────────────────────────────

test('page_view는 안전한 페이지 정보만 담는다(§5)', () => {
  const out = buildPageViewParams('https://ejip.kr/report/apt/12345?utm_source=kakao', '단지 리포트');
  assert.deepEqual(out, {
    page_path: '/report/apt/12345?utm_source=kakao',
    page_location: 'https://ejip.kr/report/apt/12345?utm_source=kakao',
    page_title: '단지 리포트',
  });
});

test('page_title이 없으면 키 자체가 빠진다(빈 문자열을 보내지 않는다)', () => {
  const out = buildPageViewParams('https://ejip.kr/', null);
  assert.equal('page_title' in out, false);
  assert.equal(out.page_path, '/');
});

// ── §6/§21 UTM 보존 ─────────────────────────────────────────────────────────

test('utm 파라미터는 절대 제거하지 않는다', () => {
  const href = 'https://ejip.kr/?utm_source=naver&utm_medium=blog&utm_campaign=launch&utm_content=a&utm_term=b';
  assert.equal(stripInternalQueryParams(href), href);
  const out = buildPageViewParams(href, null);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    assert.ok((out.page_location as string).includes(key), `${key}가 보존돼야 한다`);
  }
});

test('내부 QA 파라미터만 제거하고 나머지 쿼리는 그대로 둔다', () => {
  assert.equal(
    stripInternalQueryParams('https://ejip.kr/map?utm_source=kakao&__ejip_qa=1&lawdCd=26140'),
    'https://ejip.kr/map?utm_source=kakao&lawdCd=26140'
  );
});

test('URL로 파싱되지 않는 값을 받아도 던지지 않는다', () => {
  assert.equal(stripInternalQueryParams('not a url'), 'not a url');
  assert.equal(buildPageViewParams('/report', null).page_path, '/report');
});

// ── §4 중복 집계 방지 ───────────────────────────────────────────────────────

test('같은 경로를 연속으로 보내지 않는다(라우트 변경 이중 집계 방지)', () => {
  const d = createPageViewDeduper();
  assert.equal(d.shouldSend('/'), true);
  assert.equal(d.shouldSend('/'), false, 'StrictMode 이중 effect로도 두 번 나가면 안 된다');
  assert.equal(d.shouldSend('/map'), true);
  assert.equal(d.shouldSend('/map'), false);
  assert.equal(d.shouldSend('/'), true, '다른 경로를 거쳐 돌아오면 다시 집계한다');
});

test('빈 경로는 보내지 않는다', () => {
  const d = createPageViewDeduper();
  assert.equal(d.shouldSend(''), false);
});

// ── §3/§4 init 스니펫 ───────────────────────────────────────────────────────

test('init 스니펫은 자동 page_view를 끈다', () => {
  const body = gaInitScriptBody('G-ABCDEFGHIJ', false);
  assert.ok(body.includes('send_page_view: false'), '자동 page_view가 켜져 있으면 최초 로드가 두 번 잡힌다');
  assert.ok(body.includes("gtag('config', 'G-ABCDEFGHIJ'"));
  assert.equal(body.includes('debug_mode'), false, '기본값으로 debug 이벤트를 보내지 않는다(§19)');
});

test('debug 플래그를 켜면 debug_mode가 붙는다', () => {
  assert.ok(gaInitScriptBody('G-ABCDEFGHIJ', true).includes('debug_mode: true'));
});

// ── §17 실패 안전성 ─────────────────────────────────────────────────────────

test('gtag가 없어도(서버/광고 차단) 이벤트 함수는 던지지 않고 조용히 no-op이다', () => {
  assert.doesNotThrow(() => gaEvent('report_view', { report_type: 'APARTMENT_DETAIL' }));
  assert.doesNotThrow(() => gaEvent('', null));
  assert.doesNotThrow(() => gaPageView('https://ejip.kr/'));
  assert.doesNotThrow(() => gaPageView(null));
});
