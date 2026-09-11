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
  sanitizeAnalyticsUrl,
  sanitizeGaParams,
  stripInternalQueryParams,
  toSafePagePath,
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
    // URL_PRIVACY_HARDENING_V1 §5 — page_path는 pathname 전용이다(쿼리를 싣지 않는다).
    page_path: '/report/apt/12345',
    // 귀속에 필요한 utm은 page_location에 그대로 남는다.
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

// ── URL_PRIVACY_HARDENING_V1 §8 — URL 쿼리 allowlist ────────────────────────

test('A. /ai-search?q=... 의 검색어는 GA4로 나가지 않는다', () => {
  const href = 'https://ejip.kr/ai-search?q=부산아파트';
  assert.equal(sanitizeAnalyticsUrl(href), 'https://ejip.kr/ai-search');

  const out = buildPageViewParams(href, null);
  assert.equal(out.page_location, 'https://ejip.kr/ai-search');
  assert.equal(out.page_path, '/ai-search');
  assert.ok(!JSON.stringify(out).includes('부산아파트'), '검색어가 어떤 파라미터로도 새면 안 된다');
});

test('B. 검색어는 버리고 utm은 남긴다(같은 URL 안에서)', () => {
  const href = 'https://ejip.kr/ai-search?q=01012345678&utm_source=kakao&utm_medium=share';
  const out = buildPageViewParams(href, null);
  const loc = out.page_location as string;

  assert.ok(!loc.includes('01012345678'), '전화번호처럼 보이는 검색어가 남으면 안 된다');
  assert.ok(!loc.includes('q='), 'q 파라미터 자체가 남으면 안 된다');
  assert.ok(loc.includes('utm_source=kakao'), 'utm_source는 보존돼야 한다');
  assert.ok(loc.includes('utm_medium=share'), 'utm_medium은 보존돼야 한다');
});

test('C. 지도 상태 파라미터는 분석 URL에서 사라진다', () => {
  const href = 'https://ejip.kr/map?lat=35.1&lng=129.0&zoom=15';
  assert.equal(sanitizeAnalyticsUrl(href), 'https://ejip.kr/map');

  const out = buildPageViewParams(href, null);
  assert.equal(out.page_path, '/map');
  for (const key of ['lat', 'lng', 'zoom']) {
    assert.ok(!(out.page_location as string).includes(key), `${key}는 GA4로 나가지 않는다`);
  }
});

test('D. 카카오 공유 랜딩의 utm 5종은 전부 보존된다(유입 귀속 회귀 방지)', () => {
  const href = 'https://ejip.kr/?utm_source=kakao&utm_medium=share&utm_campaign=report';
  const loc = buildPageViewParams(href, null).page_location as string;
  assert.ok(loc.includes('utm_source=kakao'));
  assert.ok(loc.includes('utm_medium=share'));
  assert.ok(loc.includes('utm_campaign=report'));

  const all = 'https://ejip.kr/?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e';
  const allLoc = buildPageViewParams(all, null).page_location as string;
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    assert.ok(allLoc.includes(key), `${key}가 보존돼야 한다`);
  }
});

test('E. 임의 파라미터에 담긴 이메일/전화번호는 제거된다', () => {
  const href =
    'https://ejip.kr/apt/abc?email=hong@example.com&tel=010-1234-5678&memo=상담희망&name=홍길동';
  const out = buildPageViewParams(href, null);
  const dump = JSON.stringify(out);
  for (const leak of ['hong@example.com', '010-1234-5678', '상담희망', '홍길동']) {
    assert.ok(!dump.includes(leak), `${leak}가 남으면 안 된다`);
  }
  assert.equal(out.page_location, 'https://ejip.kr/apt/abc');
});

test('E-2. utm 값 자체가 PII로 보이면 그 값도 버린다(심층 방어)', () => {
  const href = 'https://ejip.kr/?utm_source=kakao&utm_term=hong@example.com';
  const loc = sanitizeAnalyticsUrl(href);
  assert.ok(loc.includes('utm_source=kakao'));
  assert.ok(!loc.includes('hong'), 'allowlist 키라도 PII 값은 통과하지 못한다');
});

test('F. 쿼리가 없는 URL은 origin+pathname 그대로다', () => {
  assert.equal(sanitizeAnalyticsUrl('https://ejip.kr/report'), 'https://ejip.kr/report');
  assert.equal(sanitizeAnalyticsUrl('https://ejip.kr/'), 'https://ejip.kr/');
  const out = buildPageViewParams('https://ejip.kr/report', null);
  assert.equal(out.page_location, 'https://ejip.kr/report');
  assert.equal(out.page_path, '/report');
});

test('hash는 유입 귀속에 쓰이지 않으므로 통째로 버린다', () => {
  assert.equal(sanitizeAnalyticsUrl('https://ejip.kr/apt/x#memo=비밀'), 'https://ejip.kr/apt/x');
});

test('page_title이 방금 버린 검색어를 그대로 담고 있으면 제목도 버린다', () => {
  // /ai-search의 generateMetadata가 만드는 실제 제목 모양.
  const out = buildPageViewParams(
    'https://ejip.kr/ai-search?q=해운대 20억',
    '"해운대 20억" AI 검색 결과 - 이집'
  );
  assert.equal('page_title' in out, false, 'URL에서 지운 값이 제목으로 우회하면 안 된다');
  assert.equal(out.page_location, 'https://ejip.kr/ai-search');
});

test('검색어를 담지 않은 일반 제목은 그대로 보낸다', () => {
  const out = buildPageViewParams('https://ejip.kr/map?lat=35.1&zoom=15', '지도 - 이집');
  assert.equal(out.page_title, '지도 - 이집');
});

// ── §6 이벤트 파라미터 우회 경로 차단 ───────────────────────────────────────

test('호출부가 원본 URL을 직접 넣어도 sanitizeGaParams가 다시 정제한다', () => {
  const out = sanitizeGaParams({
    page_location: 'https://ejip.kr/ai-search?q=홍길동&utm_source=kakao',
    page_path: '/ai-search?q=홍길동',
  });
  assert.equal(out.page_location, 'https://ejip.kr/ai-search?utm_source=kakao');
  assert.equal(out.page_path, '/ai-search');
  assert.ok(!JSON.stringify(out).includes('홍길동'));
});

test('toSafePagePath는 상대 경로에서도 쿼리/hash를 떼어낸다', () => {
  assert.equal(toSafePagePath('/ai-search?q=x'), '/ai-search');
  assert.equal(toSafePagePath('/map#a'), '/map');
  assert.equal(toSafePagePath('https://ejip.kr/apt/x?y=1'), '/apt/x');
});

test('정제는 멱등이다(이미 정제된 값을 다시 넣어도 같다)', () => {
  const once = sanitizeAnalyticsUrl('https://ejip.kr/ai-search?q=a&utm_source=kakao');
  assert.equal(sanitizeAnalyticsUrl(once), once);
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
