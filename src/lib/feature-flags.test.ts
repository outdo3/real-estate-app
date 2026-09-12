import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FEATURE_FLAGS, isFeatureEnabled } from './feature-flags';

/**
 * CONDITIONAL_HOME_FIND_UI_HIDE_V1 — 진입점만 숨기고 기능은 남긴다는 계약.
 *
 * 이 STEP에서 가장 쉽게 어긋나는 방향은 두 가지다:
 *   1) 숨기는 대신 지워버리기(라우트/API/로직 삭제)
 *   2) 화면마다 display:none을 흩뿌려서 다시 켤 때 빠뜨리기
 * 아래 테스트가 그 두 가지를 막는다.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const exists = (p: string) => existsSync(resolve(ROOT, p));
/** 주석은 왜 숨겼는지 설명하느라 관련 단어를 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = read('src/app/home-client.tsx');
const HOME_CSS = read('src/app/home-client.module.css');
const NAV = read('src/lib/bottom-nav-items.tsx');

// ── A. 진입점이 숨겨졌다 ───────────────────────────────────────────────────

test('소프트런칭 동안 조건검색 진입점은 꺼져 있다', () => {
  assert.equal(FEATURE_FLAGS.conditionalHomeFindEntry, false);
  assert.equal(isFeatureEnabled('conditionalHomeFindEntry'), false);
});

test('홈의 조건검색 버튼이 플래그로 가려진다 — 항상 렌더되지 않는다', () => {
  const code = codeOf(HOME);
  assert.ok(/isFeatureEnabled\('conditionalHomeFindEntry'\) && \(/.test(code), '플래그로 감싸지 않았다');
  // 버튼이 플래그 밖에 그대로 남아 있지 않다.
  const gateAt = code.indexOf("isFeatureEnabled('conditionalHomeFindEntry')");
  const btnAt = code.indexOf('href="/ai-search"');
  assert.ok(gateAt > -1 && btnAt > gateAt, '버튼이 플래그 바깥에 있다');
});

test('다른 사용자 진입점이 남아 있지 않다', () => {
  // 하단탭바 5개 메뉴에 조건검색이 없다.
  assert.ok(!/ai-search/.test(NAV), '하단탭바에 진입점이 있다');
  // 홈 외의 화면에서 링크로 노출되는 곳이 없다(주석 제외).
  for (const p of [
    'src/components/Header.tsx',
    'src/components/ui/BottomNav.tsx',
    'src/app/map/page.tsx',
    'src/app/stats/page.tsx',
    'src/app/my/page.tsx',
  ]) {
    if (!exists(p)) continue;
    assert.ok(!/href=["'{]?\/ai-search/.test(codeOf(read(p))), `${p}에 진입점이 남아 있다`);
  }
});

// ── B. 기능은 지우지 않았다 ────────────────────────────────────────────────

test('라우트·API·컴포넌트·로직 파일이 모두 남아 있다', () => {
  for (const p of [
    'src/app/ai-search/page.tsx',
    'src/app/ai-search/ai-search-client.tsx',
    'src/app/api/ai-search/route.ts',
    'src/lib/ai-search.ts',
  ]) {
    assert.ok(exists(p), `삭제됐다: ${p}`);
  }
});

test('검색/추천 로직이 그대로다 — 다른 모듈이 계속 쓰고 있다', () => {
  const lib = read('src/lib/ai-search.ts');
  // 다른 기능이 의존하는 공용 상수가 살아 있다.
  assert.ok(/NATIONAL_STANDARD_AREA_MIN/.test(lib));
  assert.ok(/NATIONAL_STANDARD_AREA_MAX/.test(lib));
  // 실제 소비처도 그대로다(비교·일별 리포트).
  assert.ok(/from '\.\.\/ai-search'/.test(read('src/lib/compare-v2/metrics.ts')));
  assert.ok(/from '@\/lib\/ai-search'/.test(read('src/lib/report/daily-report.ts')));
});

test('직접 URL 접근 경로가 살아 있다 — 라우트가 여전히 페이지를 렌더한다', () => {
  const page = read('src/app/ai-search/page.tsx');
  assert.ok(/export default/.test(page), '페이지 컴포넌트가 없다');
  assert.ok(/generateMetadata/.test(page), '메타데이터 생성이 사라졌다');
  const api = read('src/app/api/ai-search/route.ts');
  assert.ok(/export async function (GET|POST)/.test(api), 'API 핸들러가 사라졌다');
});

// ── C. 되돌리기가 한 곳이다 ────────────────────────────────────────────────

test('CSS로 숨기지 않았다 — display:none을 흩뿌리지 않는다', () => {
  // 퀵액션 레이아웃에 숨김 규칙이 추가되지 않았다.
  const rule = HOME_CSS.slice(HOME_CSS.indexOf('.quickActionsRow {'), HOME_CSS.indexOf('.quickActionBtn {') + 200);
  assert.ok(!/display:\s*none/.test(rule), 'CSS로 숨겼다(되돌릴 때 빠뜨리기 쉽다)');
  // 버튼이 하나만 남아도 레이아웃이 성립한다.
  assert.ok(/flex:\s*1/.test(rule), '남은 버튼이 폭을 채우지 못한다');
});

test('플래그를 읽는 곳이 진입점 하나뿐이다 — 되돌릴 자리가 흩어지지 않았다', () => {
  const uses = [
    'src/app/home-client.tsx',
  ].filter((p) => /conditionalHomeFindEntry/.test(read(p)));
  assert.deepEqual(uses, ['src/app/home-client.tsx']);
});

test('플래그 타입이 좁게 강제된다 — 임의 문자열을 넣을 수 없다', () => {
  // keyof FeatureFlags만 받으므로 오타가 컴파일 단계에서 걸린다.
  assert.equal(typeof isFeatureEnabled('conditionalHomeFindEntry'), 'boolean');
  assert.deepEqual(Object.keys(FEATURE_FLAGS), ['conditionalHomeFindEntry']);
});

// ── D. SEO 노출 상태(감사 결과 고정) ───────────────────────────────────────

test('조건검색은 sitemap에 없다 — 색인 제출 대상이 아니다', () => {
  const scope = read('src/lib/sitemap-scope.ts');
  const sitemap = read('src/app/sitemap.ts');
  assert.ok(!/ai-search/.test(scope), 'sitemap 범위에 들어갔다');
  assert.ok(!/ai-search/.test(sitemap), 'sitemap에 들어갔다');
});

test('robots는 조건검색을 막지도 허용 목록에 넣지도 않는다 — 현재 정책 그대로', () => {
  const robots = read('src/app/robots.ts');
  assert.ok(!/ai-search/.test(robots), 'robots 정책이 바뀌었다');
});
