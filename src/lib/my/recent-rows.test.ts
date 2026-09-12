import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  RECENT_ROWS_COLLAPSED,
  canCollapseRecent,
  canExpandRecent,
  visibleRecentItems,
} from './recent-rows';

/**
 * LOGIN_RECENT_VIEWED_DENSITY_V1 §11 — MY(로그인) 화면 "최근 본 단지" 밀도 계약.
 *
 * 예전에는 서버가 준 목록(최대 20건)을 **전부** 세로로 깔았다. 카드 한 줄이 약 86px라
 * 20건이면 1,700px가 넘어, 로그인 화면에서 아래 항목에 닿으려면 계속 스크롤해야 했다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 바뀐 내력을 설명하느라 옛 코드를 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MY_PAGE = read('src/app/my/page.tsx');
const MY_CSS = read('src/app/my/page.module.css');
const RECENT_API = read('src/app/api/my/recent/route.ts');

/** 실제 항목과 같은 모양의 최소 샘플(순서 확인용 index 포함). */
const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    name: `단지${i}`,
    lawdCd: '26140',
    dong: '서대신동3가',
    viewedAt: `2026-09-${String(30 - i).padStart(2, '0')}`,
    order: i,
  }));

// ── A. 기본 5행(§2) ────────────────────────────────────────────────────────

test('§2 기본은 5행이다', () => {
  assert.equal(RECENT_ROWS_COLLAPSED, 5);
  assert.equal(visibleRecentItems(items(20), false).length, 5);
});

test('§2 기본 5행은 같은 목록의 정확히 앞 5건이다 — 순서가 바뀌지 않는다', () => {
  const all = items(20);
  const shown = visibleRecentItems(all, false);
  assert.deepEqual(shown, all.slice(0, 5));
  assert.deepEqual(shown.map((r) => r.order), [0, 1, 2, 3, 4]);
  // 재정렬도 재조회도 없다 — 원본 배열을 건드리지 않는다.
  assert.deepEqual(all.map((r) => r.order), Array.from({ length: 20 }, (_, i) => i));
});

test('§2 항목이 5개 이하이면 전부 보인다', () => {
  for (const n of [0, 1, 4, 5]) {
    assert.equal(visibleRecentItems(items(n), false).length, n);
  }
});

// ── B. 더보기 / 접기(§3) ───────────────────────────────────────────────────

test('§3 5건 이하이면 더보기를 만들지 않는다', () => {
  for (const n of [0, 1, 4, 5]) {
    assert.equal(canExpandRecent(n), false, `${n}건인데 더보기가 뜬다`);
  }
});

test('§3 6건 이상이면 더보기가 나온다', () => {
  for (const n of [6, 12, 20]) {
    assert.equal(canExpandRecent(n), true, `${n}건인데 더보기가 없다`);
  }
});

test('§3 펼치면 현재 가진 항목을 전부 보여준다', () => {
  const all = items(20);
  const shown = visibleRecentItems(all, true);
  assert.equal(shown.length, 20);
  assert.deepEqual(shown, all);
  // 단계적으로 늘리는 게 아니라 한 번에 전부다.
  assert.deepEqual(shown.map((r) => r.order), all.map((r) => r.order));
});

test('§3 접기는 펼쳐져 있고 접을 게 있을 때만 보인다', () => {
  assert.equal(canCollapseRecent(20, false), false, '접힌 상태에 접기가 뜬다');
  assert.equal(canCollapseRecent(20, true), true);
  // 5건 이하면 펼침 상태여도 접기 버튼이 홀로 남지 않는다.
  assert.equal(canCollapseRecent(5, true), false);
  assert.equal(canCollapseRecent(0, true), false);
});

test('§3 펼쳤다 접으면 처음과 똑같은 5건이다', () => {
  const all = items(20);
  const before = visibleRecentItems(all, false);
  const expanded = visibleRecentItems(all, true);
  const after = visibleRecentItems(all, false);
  assert.equal(expanded.length, 20);
  assert.deepEqual(after, before);
});

// ── C. 데이터/식별자 무변경(§4) ────────────────────────────────────────────

test('§4 개수 모듈에 데이터 판단이 섞여 있지 않다', () => {
  const code = codeOf(read('src/lib/my/recent-rows.ts'));
  for (const forbidden of ['fetch', 'sort', 'filter', 'aptSeq', 'viewedAt', 'localStorage', 'dedupe']) {
    assert.ok(!code.includes(forbidden), `개수 모듈에 데이터 판단이 섞였다: ${forbidden}`);
  }
  // 자르기는 앞에서부터만 — 중간을 건너뛰지 않는다.
  assert.ok(/items\.slice\(0, RECENT_ROWS_COLLAPSED\)/.test(code));
});

test('§4 조회 경로와 보관 정책이 그대로다', () => {
  // 서버가 정렬·개수를 정한다. 이 STEP은 여기를 건드리지 않았다.
  assert.ok(/orderBy: \{ viewedAt: 'desc' \}/.test(RECENT_API), '정렬 규칙이 바뀌었다');
  assert.ok(/take: 20/.test(RECENT_API), '보관/조회 개수가 바뀌었다');
  // 화면은 여전히 같은 엔드포인트 하나만 쓴다(새 API를 만들지 않았다).
  assert.ok(MY_PAGE.includes("fetch('/api/my/recent')"));
  assert.equal((MY_PAGE.match(/\/api\/my\/recent/g) ?? []).length, 1, '조회 호출이 늘었다');
});

test('§4 클릭 목적지가 그대로다 — canonical 쿼리 형태 유지', () => {
  assert.ok(
    /function aptHref\(f: \{ lawdCd: string; dong: string; name: string \}\) \{/.test(MY_PAGE),
    'aptHref 시그니처가 바뀌었다'
  );
  assert.ok(/\/apt\/\$\{encodeURIComponent\(f\.name\)\}\?lawdCd=\$\{encodeURIComponent\(f\.lawdCd\)\}&dong=\$\{encodeURIComponent\(f\.dong\)\}/.test(MY_PAGE));
  // 최근 목록 행이 계속 같은 헬퍼로 링크를 만든다.
  const recentBlock = MY_PAGE.slice(MY_PAGE.indexOf('visibleRecentItems('), MY_PAGE.indexOf('canExpandRecent('));
  assert.ok(/href=\{aptHref\(r\)\}/.test(recentBlock), '최근 목록 링크가 바뀌었다');
  assert.ok(/key=\{r\.id\}/.test(recentBlock), 'key가 바뀌어 중복/재사용 동작이 달라질 수 있다');
});

// ── D. 배선(§3/§9) ─────────────────────────────────────────────────────────

test('§3 화면이 개수 모듈을 통해 목록을 자른다 — 페이지가 직접 slice하지 않는다', () => {
  const code = codeOf(MY_PAGE);
  assert.ok(/visibleRecentItems\(recentViews, recentExpanded\)/.test(code));
  assert.ok(!/recentViews\.slice\(/.test(code), '페이지가 직접 잘라내고 있다');
  // 예전처럼 전부 깔지 않는다.
  assert.ok(!/recentViews\.map\(/.test(code), '목록 전체를 그대로 렌더한다');
});

test('§9 펼침 상태를 저장하지 않는다 — 진입할 때마다 접힌 상태다', () => {
  assert.ok(/useState\(false\)/.test(MY_PAGE.slice(MY_PAGE.indexOf('const [recentExpanded'))));
  const code = codeOf(MY_PAGE);
  const toggleArea = code.slice(code.indexOf('recentExpanded'), code.indexOf('recentExpanded') + 1500);
  assert.ok(!/localStorage|sessionStorage|cookie/.test(toggleArea), '펼침 상태를 저장한다');
});

test('§10 접근성 — 라벨, aria-expanded, 키보드 활성화', () => {
  assert.ok(MY_PAGE.includes("'최근 본 단지 접기'"));
  assert.ok(MY_PAGE.includes("'최근 본 단지 더보기'"));
  assert.ok(/aria-expanded=\{recentExpanded\}/.test(MY_PAGE));
  // <button>이라 Enter/Space가 기본 동작한다(div+onClick이 아니다).
  const block = MY_PAGE.slice(MY_PAGE.indexOf('canExpandRecent(recentViews.length)'));
  assert.ok(/<button\s/.test(block.slice(0, 400)), 'button 요소가 아니다');
  assert.ok(/type="button"/.test(block.slice(0, 400)), 'form submit으로 동작할 수 있다');
});

test('§7 토글 버튼 터치 타깃이 44px 이상이다', () => {
  const rule = MY_CSS.slice(MY_CSS.indexOf('.recentToggle {'), MY_CSS.indexOf('.recentToggle:hover'));
  assert.ok(/min-height: 44px/.test(rule), '터치 타깃이 작다');
});

test('§6/§12 목록 행 스타일과 관심단지 목록은 건드리지 않았다', () => {
  // .aptItem은 관심단지와 공유하는 클래스다 — 여기를 바꾸면 범위 밖 화면이 같이 바뀐다.
  const aptItem = MY_CSS.slice(MY_CSS.indexOf('.aptItem {'), MY_CSS.indexOf('.aptItem:hover'));
  assert.ok(/padding: 1rem 1\.25rem/.test(aptItem), '행 패딩이 바뀌었다(관심단지에도 영향)');
  // 관심단지는 여전히 전부 렌더한다(이 STEP의 범위가 아니다).
  assert.ok(/favorites\.map\(/.test(MY_PAGE), '관심단지 렌더가 바뀌었다');
});
