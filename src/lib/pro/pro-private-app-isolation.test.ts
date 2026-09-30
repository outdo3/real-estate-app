// REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 — 중개사 Pro 비공개 앱 경계 회귀 테스트.
// 1차 경계(루트 layout 분리 → 구역 간 이동은 전체 문서 로드)는 파일 구조로, 2·3차(판정·헤더)는 순수 함수로 검사한다.
// 실제 브라우저 시나리오(공개 → /pro, 뒤로/앞으로, 합성 비밀 문자열 외부 전송 여부)는 docs/pro/REALTOR_PRO_V1_SECURITY.md §0 기록.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  allowsFirstPartyAnalytics,
  allowsLocationLookup,
  allowsThirdPartyAnalytics,
  isAdFreePath,
  privacyZoneOf,
  privateAppHeaders,
  scriptAllowed,
  THIRD_PARTY_SCRIPTS,
  type ThirdPartyScriptId,
} from '../privacy/private-routes';
import { safeInitialLocationHref } from '../analytics/ga';

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const APP = 'src/app';
// 주석은 빼고 코드만 검사(설명 주석에 금지 요소 이름이 나올 수 있다)
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function filesUnder(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(join(dir, name)));
    else if (/\.(tsx?|css)$/.test(name)) out.push(join(dir, name));
  }
  return out;
}

const PRO_ROUTES = ['/pro', '/pro/dashboard', '/pro/listings', '/pro/listings/new', '/pro/customers', '/pro/matches', '/pro/briefings', '/pro/settings'];
const PUBLIC_ROUTES = ['/', '/map', '/apt/어느단지', '/stats', '/privacy', '/community', '/my', '/admin', '/presales/1', '/project', '/profile', '/bus'];

test('1 · 공개 → Pro는 루트 layout이 달라 전체 문서 로드(구역마다 자체 <html> 루트)', () => {
  assert.equal(existsSync(resolve(ROOT, APP, 'layout.tsx')), false, 'app/layout.tsx(공통 루트)가 있으면 구역 간 이동이 클라이언트 전환이 된다');
  for (const g of ['(public)', '(pro)', '(briefing)']) {
    const src = read(`${APP}/${g}/layout.tsx`);
    assert.match(src, /<html lang="ko">/, `${g} 루트 layout`);
    assert.match(src, /<body/, `${g} 루트 layout`);
  }
  // Pro 라우트는 (pro) 아래에만, 브리핑은 (briefing) 아래에만 있다(공개 루트 아래 사본 없음)
  assert.ok(existsSync(resolve(ROOT, APP, '(pro)', 'pro', 'page.tsx')));
  assert.ok(existsSync(resolve(ROOT, APP, '(briefing)', 'b', '[token]', 'page.tsx')));
  for (const stray of ['pro', 'b', '(public)/pro', '(public)/b']) assert.equal(existsSync(resolve(ROOT, APP, stray)), false, stray);
  // URL은 그대로(그룹 이름은 경로에 안 나옴)
  for (const r of PRO_ROUTES) assert.equal(privacyZoneOf(r), 'PRO', r);
});

test('2 · 3 · 4 · 5 · Pro 문서에는 AdSense·GA4·공개 방문 로그·위치 조회가 마운트되지 않는다', () => {
  const FORBIDDEN = /AdSenseLoader|GoogleAnalytics|ViewTracker|RegionProvider|RegionContext|AppProviders|InstallBanner|RegisterServiceWorker|next\/script|googletagmanager|googlesyndication|dapi\.kakao|navigator\.geolocation|\/api\/log\//;
  const files = [...filesUnder(`${APP}/(pro)`), ...filesUnder('src/components/pro')];
  assert.ok(files.length > 20, `Pro 파일 ${files.length}개`);
  for (const f of files) assert.ok(!FORBIDDEN.test(code(f)), `${f}에 공개 추적 요소`);
  // Pro 루트 공급자는 세션만
  assert.match(read('src/components/pro/ProProviders.tsx'), /return <SessionProvider>\{children\}<\/SessionProvider>;/);
  // Pro가 쓰는 공개 Header 트리도 추적 요소를 끌어오지 않는다
  for (const f of ['src/components/Header.tsx', 'src/components/HeaderAuthButton.tsx', 'src/components/LoginModal.tsx']) {
    assert.ok(!FORBIDDEN.test(code(f)), f);
  }
  // 2차 방어: 공개 루트 안의 판정도 Pro를 막는다
  for (const r of PRO_ROUTES) {
    assert.equal(isAdFreePath(r), true, r);
    assert.equal(allowsThirdPartyAnalytics(r), false, r);
    assert.equal(allowsFirstPartyAnalytics(r), false, r);
    assert.equal(allowsLocationLookup(r), false, r);
  }
});

test('6 · Pro → 공개 이동 시 Pro URL이 리퍼러·GA 스냅샷으로 새지 않는다', () => {
  const h = Object.fromEntries(privateAppHeaders({ dev: false }).map((x) => [x.key, x.value]));
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.match(read(`${APP}/(pro)/layout.tsx`), /referrer: 'no-referrer'/);
  const cfg = read('next.config.ts');
  assert.match(cfg, /source: '\/pro', headers: pro/);
  assert.match(cfg, /source: '\/pro\/:path\*', headers: pro/);
  // 같은 탭에서 Pro를 먼저 열고 공개 화면으로 옮긴 경우에도 GA 유입 스냅샷은 Pro URL을 버린다
  assert.equal(safeInitialLocationHref('https://e-jip.com/pro/customers/rc_1?x=1'), null);
  assert.equal(safeInitialLocationHref('https://e-jip.com/map'), 'https://e-jip.com/map');
});

test('7 · 8 · 공개 화면은 광고·분석·방문 로그·위치 조회를 그대로 싣는다', () => {
  const layout = read(`${APP}/(public)/layout.tsx`);
  assert.match(layout, /<AdSenseLoader \/>/);
  assert.match(layout, /<AppProviders>\{children\}<\/AppProviders>/);
  assert.match(layout, /rel="preconnect" href="https:\/\/dapi\.kakao\.com"/);
  const providers = read('src/components/AppProviders.tsx');
  for (const c of ['<ViewTracker />', '<GoogleAnalytics />', '<RegionProvider>', '<RegisterServiceWorker />', '<InstallBanner />']) assert.ok(providers.includes(c), c);
  for (const r of PUBLIC_ROUTES) {
    assert.equal(privacyZoneOf(r), 'PUBLIC', r);
    for (const id of ['adsense', 'ga4', 'visitLogging', 'locationLookup', 'kakaoPreconnect'] as ThirdPartyScriptId[]) assert.equal(scriptAllowed(id, r), true, `${id} ${r}`);
  }
});

test('9 · 브리핑 루트 layout은 공급자·스크립트를 하나도 싣지 않는다(b548cde 경계 유지)', () => {
  const src = code(`${APP}/(briefing)/layout.tsx`);
  assert.ok(!/Provider|Script|<script|AdSense|Analytics|ViewTracker|import .*components/.test(src), src);
  assert.match(src, /<body>\{children\}<\/body>/);
  assert.match(read('next.config.ts'), /source: '\/b\/:path\*', headers: value/);
});

test('10 · Pro는 noindex·nofollow(메타 + X-Robots-Tag), frame 차단', () => {
  const layout = read(`${APP}/(pro)/layout.tsx`);
  assert.match(layout, /robots: \{ index: false, follow: false/);
  const h = Object.fromEntries(privateAppHeaders({ dev: false }).map((x) => [x.key, x.value]));
  assert.match(h['X-Robots-Tag'], /noindex/);
  assert.match(h['X-Robots-Tag'], /nofollow/);
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('11 · Pro 문서는 외부로 스크립트를 싣거나 연결할 수 없다(CSP) · 클라이언트 코드에 외부 전송·콘솔 출력 없음', () => {
  for (const dev of [false, true]) {
    const csp = privateAppHeaders({ dev }).find((x) => x.key === 'Content-Security-Policy')!.value;
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
    assert.ok(!/https?:/.test(directive('script-src')), directive('script-src'));
    assert.ok(!/https?:/.test(directive('connect-src')), directive('connect-src'));
  }
  assert.ok(!/unsafe-eval/.test(privateAppHeaders({ dev: false })[0].value));
  for (const f of [...filesUnder(`${APP}/(pro)`), ...filesUnder('src/components/pro')]) {
    const s = code(f);
    assert.ok(!/fetch\(\s*['"`]https?:/.test(s), `${f} 외부 fetch`);
    assert.ok(!/console\.(log|info|warn|error|debug)\(/.test(s), `${f} 콘솔 출력`);
    assert.ok(!/sendBeacon|localStorage|sessionStorage/.test(s), `${f} 비콘/브라우저 저장소`);
  }
});

test('스크립트 등록부: 모든 항목이 구역을 선언하고, 비공개 구역 허용은 폰트뿐', () => {
  for (const [id, def] of Object.entries(THIRD_PARTY_SCRIPTS)) {
    assert.ok(def.zones.length > 0 && def.what.length > 0, id);
    const privateOk = def.zones.some((z) => z !== 'PUBLIC');
    assert.equal(privateOk, id === 'pretendardFont', `${id}가 비공개 구역에 허용됨`);
  }
});
