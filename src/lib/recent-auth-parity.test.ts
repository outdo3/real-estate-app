import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  RECENT_ROWS_COLLAPSED,
  canCollapseRecent,
  canExpandRecent,
  visibleRecentItems,
} from './my/recent-rows';

/**
 * RECENT_VIEWED_AUTH_PARITY_V1 §12 — "최근 본 단지"의 로그인 상태별 계약.
 *
 * 고친 문제는 단순한 표시 버그가 아니라 **기록 유출**이었다. 상세페이지 방문이 로그인
 * 여부와 무관하게 localStorage에 쌓이고, useRecentSync가 서버(계정) 목록까지 local에
 * mirror했으며, 홈은 세션을 보지 않고 그 local을 읽었다. 그래서 로그아웃한 뒤에도,
 * 같은 기기의 다른 사람에게도, 다른 계정으로 로그인해도 이전 계정이 본 단지가 홈에
 * 남았다. 아래 테스트는 그 경로들이 다시 열리지 않게 고정한다.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 언급한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const STORE = read('src/lib/recent-apartments.ts');
const HOOK = read('src/hooks/useRecentApartments.ts');
const SYNC = read('src/hooks/useRecentSync.ts');
const HOME = read('src/app/home-client.tsx');
const MY = read('src/app/my/page.tsx');
const APT = read('src/app/apt/[name]/apt-client.tsx');
const RECENT_API = read('src/app/api/my/recent/route.ts');

// ── A. 출처 분기(§2/§4) ────────────────────────────────────────────────────

test('§4 홈은 세션에 따라 출처를 가른다 — localStorage를 직접 읽지 않는다', () => {
  const code = codeOf(HOME);
  assert.ok(/useRecentApartments\(\)/.test(code), '홈이 출처 분기 훅을 쓰지 않는다');
  assert.ok(!/getRecentApartments\(/.test(code), '홈이 아직 localStorage를 직접 읽는다');
});

test('§2 로그인 상태에서는 서버(계정) 기록만 읽는다', () => {
  const code = codeOf(HOOK);
  assert.ok(/\/api\/my\/recent/.test(code), '계정 목록을 서버에서 읽지 않는다');
  // 로그인 분기(= if (status === 'authenticated') { ... })만 잘라서 본다.
  // codeOf가 주석을 지우므로 주석을 앵커로 쓰지 않는다.
  const authStart = code.indexOf("if (status === 'authenticated') {");
  assert.ok(authStart > -1, '로그인 분기를 찾지 못했다');
  const authBranch = code.slice(authStart, code.indexOf('return {', code.indexOf("source: 'account',")));
  assert.ok(!/getRecentApartments/.test(authBranch), '로그인 분기가 로컬을 읽는다');
});

test('§2 비로그인 상태에서는 서버를 건드리지 않는다', () => {
  const code = codeOf(HOOK);
  // SWR 키가 null이면 조회 자체가 일어나지 않는다.
  assert.ok(
    /status === 'authenticated' && userId \? `\/api\/my\/recent#\$\{userId\}` : null/.test(code),
    '비로그인일 때 계정 조회가 차단되지 않는다'
  );
});

test('§4 세션 확인 중에는 목록을 보여주지 않는다 — false flash 금지', () => {
  const code = codeOf(HOOK);
  assert.ok(/if \(status === 'loading'\)/.test(code), '세션 로딩 분기가 없다');
  const loadingBranch = code.slice(code.indexOf("status === 'loading'"), code.indexOf("status === 'authenticated'", code.indexOf("status === 'loading'")));
  assert.ok(/items: \[\]/.test(loadingBranch), '세션 확인 중에 목록을 내보낸다');
  assert.ok(/loading: true/.test(loadingBranch));
  // 홈도 로딩 상태를 별도로 렌더한다.
  assert.ok(/recentLoading \?/.test(codeOf(HOME)), '홈에 로딩 분기가 없다');
});

// ── B. 계정 격리(§7) ───────────────────────────────────────────────────────

test('§7 계정별 캐시 키 — A의 응답이 B 화면에 재사용될 수 없다', () => {
  const code = codeOf(HOOK);
  assert.ok(/#\$\{userId\}/.test(code), 'SWR 키에 사용자 식별자가 없다');
  assert.ok(/session\?\.user as \{ id\?: string \}/.test(code), '세션에서 사용자 id를 읽지 않는다');
});

test('§5 로그아웃하면 계정 목록이 즉시 화면에서 빠진다', () => {
  const code = codeOf(HOOK);
  // 키가 null이 되면 SWR은 조회하지 않고, authenticated 분기를 타지 않으므로
  // 이전 계정 데이터가 렌더될 경로가 없다.
  assert.ok(/: null;/.test(code), '로그아웃 시 조회 키가 비워지지 않는다');
  const guestReturn = code.slice(code.indexOf('return {\n    items: guestItems'));
  assert.ok(/source: 'guest'/.test(guestReturn), '로그아웃 후 게스트 출처로 전환되지 않는다');
});

// ── C. 로컬 저장소가 게스트 전용인가(§10) ──────────────────────────────────

test('§10 로그인 상태의 방문은 게스트 저장소에 쓰지 않는다', () => {
  const code = codeOf(STORE);
  assert.ok(/if \(options\.authenticated\) return;/.test(code), '로그인 방문이 로컬에 쌓인다');
});

test('§10 상세페이지는 세션이 확정된 뒤 비로그인일 때만 로컬에 기록한다', () => {
  const code = codeOf(APT);
  // 호출부는 import 한 줄과 실제 호출 두 곳에 나온다 — 호출(괄호 포함)만 찾는다.
  const idx = code.indexOf('recordApartmentVisit({');
  assert.ok(idx > -1, '게스트 기록 호출을 찾지 못했다');
  const effect = code.slice(code.lastIndexOf('useEffect(() => {', idx), idx);
  assert.ok(/sessionStatus !== 'unauthenticated'/.test(effect), '세션 확정 전에 기록할 수 있다');
  // 그 effect의 deps에 세션 상태가 들어가야 세션이 뒤늦게 확정돼도 동작한다.
  const deps = code.slice(idx, code.indexOf('}, [', idx) + 80);
  assert.ok(/\[pageReady, sessionStatus,/.test(deps), 'deps에 세션 상태가 없다');
});

test('§10 서버 목록을 로컬에 mirror하지 않는다 — 유출의 두 번째 경로', () => {
  const code = codeOf(SYNC);
  assert.ok(!/localStorage\.setItem/.test(code), '서버 목록을 로컬에 되쓴다');
  assert.ok(!/mirrorItems/.test(code), 'mirror 로직이 남아 있다');
  // 업로드(local → 서버 병합)는 그대로 남는다.
  assert.ok(/\/api\/my\/recent\/sync/.test(code), '로컬 기록 업로드가 사라졌다');
});

test('§10 이미 오염된 저장소를 읽지 않는다 — 키를 새로 쓰고 옛 키를 지운다', () => {
  const code = codeOf(STORE);
  assert.ok(/ejip:recentApartments:guest:v2/.test(code), '게스트 전용 키가 없다');
  assert.ok(/LEGACY_STORAGE_KEY = 'ejip:recentApartments'/.test(code), '옛 키 상수가 없다');
  assert.ok(/removeItem\(LEGACY_STORAGE_KEY\)/.test(code), '옛 키를 정리하지 않는다');
  // 읽기는 새 키에서만 한다.
  assert.ok(/getItem\(STORAGE_KEY\)/.test(code));
});

// ── D. 실패 처리(§11) ──────────────────────────────────────────────────────

test('§11 계정 목록 조회 실패를 로컬로 속이지 않는다', () => {
  const code = codeOf(HOOK);
  const failBranch = code.slice(code.indexOf('const failed ='), code.indexOf('if (isLoading'));
  assert.ok(/items: \[\]/.test(failBranch), '실패 시 다른 목록을 보여준다');
  assert.ok(/error: true/.test(failBranch));
  assert.ok(!/guestItems/.test(failBranch), '실패 시 로컬로 대체한다');
});

test('§11 홈이 오류를 사용자에게 말한다', () => {
  assert.ok(/최근 본 단지를 불러오지 못했어요/.test(HOME), '오류 안내가 없다');
  assert.ok(/role="alert"/.test(HOME));
});

// ── E. 홈 개수 UX(§9) ──────────────────────────────────────────────────────

test('§9 홈 기본 5개', () => {
  assert.equal(RECENT_ROWS_COLLAPSED, 5);
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
  assert.equal(visibleRecentItems(items, false).length, 5);
  assert.deepEqual(visibleRecentItems(items, false), items.slice(0, 5));
});

test('§9 5개 이하면 더보기가 없고, 초과하면 전부 펼친다', () => {
  for (const n of [0, 3, 5]) assert.equal(canExpandRecent(n), false);
  assert.equal(canExpandRecent(6), true);
  const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
  assert.equal(visibleRecentItems(items, true).length, 12);
  assert.equal(canCollapseRecent(12, true), true);
  assert.equal(canCollapseRecent(12, false), false);
});

test('§9 홈이 MY와 같은 개수 규칙 모듈을 쓴다', () => {
  assert.ok(/from '@\/lib\/my\/recent-rows'/.test(HOME), '홈이 개수 규칙을 따로 정의한다');
  assert.ok(/from '@\/lib\/my\/recent-rows'/.test(MY), 'MY가 같은 모듈을 쓰지 않는다');
  // 홈이 자기만의 상한을 다시 정의하지 않는다.
  assert.ok(!/HOME_RECENT_LIMIT/.test(HOME), '홈에 별도 상한 상수가 남아 있다');
});

test('§9 더보기/접기 접근성', () => {
  assert.ok(/aria-expanded=\{recentExpanded\}/.test(HOME));
  assert.ok(/'최근 본 단지 접기'/.test(HOME));
  assert.ok(/'최근 본 단지 더보기'/.test(HOME));
  const css = read('src/app/home-client.module.css');
  const rule = css.slice(css.indexOf('.recentToggle {'), css.indexOf('.recentToggle:hover'));
  assert.ok(/min-height: 44px/.test(rule), '터치 타깃이 작다');
});

// ── F. 홈 / MY 일관성(§8) ──────────────────────────────────────────────────

test('§8 로그인 상태의 홈과 MY가 같은 서버 출처를 쓴다', () => {
  assert.ok(/\/api\/my\/recent/.test(codeOf(HOOK)), '홈이 서버 출처를 쓰지 않는다');
  assert.ok(/fetch\('\/api\/my\/recent'\)/.test(codeOf(MY)), 'MY의 출처가 바뀌었다');
  // 정렬/상한은 서버가 정한다 — 두 화면이 각자 다시 정하지 않는다.
  assert.ok(/orderBy: \{ viewedAt: 'desc' \}/.test(RECENT_API));
  assert.ok(/take: 20/.test(RECENT_API));
});

test('§8 홈은 서버 정렬을 그대로 따른다 — 자체 재정렬 없음', () => {
  const code = codeOf(HOOK);
  const fromServer = code.slice(code.indexOf('function fromServer'), code.indexOf('export function useRecentApartments'));
  assert.ok(!/sort\(/.test(fromServer), '홈이 서버 정렬을 다시 건드린다');
});

// ── G. 범위 밖 무변경(§14) ─────────────────────────────────────────────────

test('§14 서버 기록을 지우지 않는다 — 로그아웃은 화면에서만 사라진다', () => {
  for (const [name, src] of [['hook', HOOK], ['home', HOME], ['sync', SYNC]] as const) {
    const code = codeOf(src);
    assert.ok(!/method: 'DELETE'/.test(code), `${name}이 서버 기록을 삭제한다`);
  }
  // recent API에는 DELETE 핸들러가 없다(있었던 적도 없다).
  assert.ok(!/export async function DELETE/.test(RECENT_API));
});

test('§14 인증/프로바이더 설정을 건드리지 않았다', () => {
  const auth = read('src/lib/auth.ts');
  for (const p of ['KakaoProvider', 'GoogleProvider', 'NaverProvider']) {
    assert.ok(auth.includes(p), `${p}가 사라졌다`);
  }
  assert.ok(/strategy: 'jwt'/.test(auth), '세션 전략이 바뀌었다');
});
