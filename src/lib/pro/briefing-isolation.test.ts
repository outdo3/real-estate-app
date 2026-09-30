// REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 — 고객 브리핑(/b/<token>) 서드파티 경계 회귀 테스트.
// 토큰은 전부 합성값(테스트 안에서 생성)이며 출력하지 않는다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  allowsFirstPartyAnalytics,
  allowsThirdPartyAnalytics,
  isAdFreePath,
  isTokenizedPrivateHref,
  isTokenizedPrivatePath,
  privateBriefingHeaders,
} from '../privacy/private-routes';
import { safeInitialLocationHref } from '../analytics/ga';
import { ADSENSE_SCRIPT_SRC } from '../adsense';
import { BRIEFING_PAGE_METADATA, isHumanBriefingView } from './briefing-page-policy';
import { addListingNote, createListing } from './listing-service';
import { createCustomer } from './customer-service';
import { createBriefing, revokeBriefing, viewBriefingByToken } from './briefing-service';
import { addProfile, customerBody, FIXED_NOW, listingBody, makeDeps } from './pro-test-helpers';

const ROOT = resolve(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const A = { userId: 'user-a' };
const SYNTH_TOKEN = 'SYNTHETICtokenSYNTHETICtokenSYNTHETICtoken0'; // 43자 합성값
const H = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test('1 · /b/<token>에는 AdSense 로더가 없다(경로 판정 + 루트 layout이 로더를 직접 싣지 않음)', () => {
  for (const p of [`/b/${SYNTH_TOKEN}`, '/b', '/b/', `/b/${SYNTH_TOKEN}?x=1`]) assert.equal(isAdFreePath(p), true, p);
  const layout = read('src/app/layout.tsx');
  assert.ok(!/ADSENSE_SCRIPT_SRC|googlesyndication/.test(layout), '루트 layout은 광고 로더를 직접 싣지 않는다');
  const loader = read('src/components/analytics/AdSenseLoader.tsx');
  assert.match(loader, /if \(isAdFreePath\(pathname\)\) return null;/);
});

test('2 · /b/<token>에는 GA·자체 방문 로그·위치 조회가 없다', () => {
  const p = `/b/${SYNTH_TOKEN}`;
  assert.equal(allowsThirdPartyAnalytics(p), false);
  assert.equal(allowsFirstPartyAnalytics(p), false);
  // GA 컴포넌트는 판정 결과로 스크립트를 렌더하지 않고, ga.ts 런타임 게이트도 같은 판정을 쓴다
  assert.match(read('src/components/analytics/GoogleAnalytics.tsx'), /if \(!enabled \|\| blocked\) return null;/);
  assert.match(read('src/lib/analytics/ga.ts'), /if \(!allowsThirdPartyAnalytics\(window\.location\.pathname\)\) return false;/);
  // 자체 방문 로그(조회·하트비트) 둘 다 판정을 거친다
  assert.equal((read('src/components/ViewTracker.tsx').match(/allowsFirstPartyAnalytics\(pathname\)/g) ?? []).length, 2);
  // 위치 권한 요청 + Kakao 역지오코딩은 브리핑에서 건너뛴다
  assert.match(read('src/contexts/RegionContext.tsx'), /if \(isTokenizedPrivatePath\(window\.location\.pathname\)\) return;/);
  // 루트 layout·AppProviders에 판정 없는 다른 서드파티 로더가 새로 붙지 않았다
  for (const f of ['src/app/layout.tsx', 'src/components/AppProviders.tsx']) {
    assert.ok(!/<Script|<script|googletagmanager|connect\.facebook|clarity\.ms|hotjar|sentry/i.test(read(f)), f);
  }
});

test('3 · 일반 공개 화면은 광고·분석을 그대로 싣는다', () => {
  for (const p of ['/', '/map', '/apt/어느단지', '/stats', '/privacy', '/community', '/best', '/bus', '/b2', '/admin', '/my', '/presales/1']) {
    assert.equal(isAdFreePath(p), false, p);
    assert.equal(allowsThirdPartyAnalytics(p), true, p);
    assert.equal(allowsFirstPartyAnalytics(p), true, p);
  }
  // 중개사 Pro 화면은 광고만 뺀다(고객 정보·브리핑 링크가 화면에 표시됨), 분석은 유지
  assert.equal(isAdFreePath('/pro/briefings/new'), true);
  assert.equal(allowsThirdPartyAnalytics('/pro/dashboard'), true);
});

test('4 · 5 · 6 · 브리핑 메타데이터: noindex·nofollow·no-referrer·canonical/og:url 없음·고정 문구만', () => {
  const m = BRIEFING_PAGE_METADATA;
  assert.equal(m.robots.index, false);
  assert.equal(m.robots.follow, false);
  assert.equal(m.robots.googleBot.index, false);
  assert.equal(m.referrer, 'no-referrer');
  assert.equal(m.alternates.canonical, null);
  assert.ok(!('url' in m.openGraph) && !('images' in m.openGraph), 'og:url·이미지로 토큰/고객 정보가 새지 않는다');
  const s = JSON.stringify(m);
  assert.ok(!/\/b\/|token|고객님|OO/.test(s), s);
  // 응답 헤더도 같은 정책(메타 태그를 무시하는 클라이언트 대비)
  const h = Object.fromEntries(privateBriefingHeaders({ dev: false }).map((x) => [x.key, x.value]));
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.match(h['X-Robots-Tag'], /noindex/);
  assert.match(h['X-Robots-Tag'], /nofollow/);
  // next.config가 /b와 /b/*에 헤더를 건다
  const cfg = read('next.config.ts');
  assert.match(cfg, /source: '\/b', headers: value/);
  assert.match(cfg, /source: '\/b\/:path\*', headers: value/);
});

test('카카오·링크 미리보기·프리페치는 조회수에 넣지 않는다', () => {
  assert.equal(isHumanBriefingView(H({ 'user-agent': 'Mozilla/5.0 (iPhone) AppleWebKit Safari' })), true);
  for (const ua of ['kakaotalk-scrap/1.0', 'Mozilla/5.0 (compatible; Yeti/1.1)', 'facebookexternalhit/1.1', 'Slackbot-LinkExpanding 1.0', 'Googlebot/2.1']) {
    assert.equal(isHumanBriefingView(H({ 'user-agent': ua })), false, ua);
  }
  assert.equal(isHumanBriefingView(H({ 'user-agent': 'Mozilla/5.0 Chrome', 'sec-purpose': 'prefetch' })), false);
  assert.equal(isHumanBriefingView(H({})), false);
  // 카카오톡 인앱 브라우저(사람)는 센다
  assert.equal(isHumanBriefingView(H({ 'user-agent': 'Mozilla/5.0 (iPhone) KAKAOTALK 10.4.5' })), true);
});

async function setup() {
  const deps = makeDeps();
  addProfile(deps.state, A.userId);
  const l = await createListing(deps, A, listingBody({ memo: '비공개메모-매물XYZ', ownerName: '소유자이름QQ', ownerPhone: '010-2222-3333', viewingNote: '방문조율메모WW' }));
  assert.ok(l.ok);
  const c = await createCustomer(deps, A, customerBody({ name: '홍비밀', memo: '고객비공개메모ABC', phone: '010-4444-5555' }));
  assert.ok(c.ok);
  if (!l.ok || !c.ok) throw new Error('setup');
  assert.ok((await addListingNote(deps, A, l.data.id, { body: '중개사노트-가격협상가능' })).ok);
  return { deps, listingId: l.data.id, customerId: c.data.id };
}

test('7 · 회수된 토큰은 내용 없음', async () => {
  const { deps, listingId, customerId } = await setup();
  const b = await createBriefing(deps, A, { listingId, customerId });
  assert.ok(b.ok);
  if (!b.ok) return;
  assert.ok((await revokeBriefing(deps, A, b.data.briefing.id)).ok);
  assert.deepEqual(await viewBriefingByToken(deps, b.data.token, { countView: true }), { access: 'REVOKED', snapshot: null });
  assert.equal(deps.state.briefings[0].viewCount, 0);
});

test('8 · 만료된 토큰은 내용 없음', async () => {
  const { deps, listingId } = await setup();
  const b = await createBriefing(deps, A, { listingId });
  assert.ok(b.ok);
  if (!b.ok) return;
  (deps as unknown as { nowValue: Date }).nowValue = new Date(FIXED_NOW.getTime() + 8 * 86_400_000);
  assert.deepEqual(await viewBriefingByToken(deps, b.data.token, { countView: true }), { access: 'EXPIRED', snapshot: null });
});

test('9 · 모르는 토큰(형식 맞는 합성값 포함)은 NOT_FOUND(페이지 404)', async () => {
  const { deps } = await setup();
  for (const t of [SYNTH_TOKEN, 'x', '']) assert.equal((await viewBriefingByToken(deps, t, { countView: true })).access, 'NOT_FOUND');
  assert.match(read('src/app/b/[token]/page.tsx'), /if \(result\.access === 'NOT_FOUND'\) notFound\(\);/);
});

test('10 · 11 · 공개 브리핑에 고객 비공개 메모·중개사 노트·소유자 정보가 없다', async () => {
  const { deps, listingId, customerId } = await setup();
  const b = await createBriefing(deps, A, { listingId, customerId });
  assert.ok(b.ok);
  if (!b.ok) return;
  const view = await viewBriefingByToken(deps, b.data.token, { countView: false });
  assert.equal(view.access, 'OK');
  const s = JSON.stringify(view.snapshot);
  for (const secret of ['고객비공개메모ABC', '비공개메모-매물XYZ', '중개사노트-가격협상가능', '소유자이름QQ', '010-2222-3333', '010-4444-5555', '방문조율메모WW', '홍비밀']) {
    assert.ok(!s.includes(secret), secret);
  }
  assert.ok(!s.includes(b.data.token), '스냅샷에 토큰 자신도 없다');
});

test('12 · 토큰이 서드파티 설정으로 나가지 않는다(광고 URL·GA 스냅샷·CSP)', () => {
  // 광고 로더 URL은 고정 상수 — 페이지 주소·토큰이 끼어들 자리가 없다
  assert.equal(ADSENSE_SCRIPT_SRC, 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3291272948162277');
  // GA 유입 스냅샷이 브리핑 URL이면 버린다(브리핑 → 다른 화면 이동 후 첫 page_view로 새지 않게)
  assert.equal(safeInitialLocationHref(`https://e-jip.com/b/${SYNTH_TOKEN}`), null);
  assert.equal(isTokenizedPrivateHref(`https://e-jip.com/b/${SYNTH_TOKEN}?utm_source=kakao`), true);
  assert.equal(safeInitialLocationHref('https://e-jip.com/map?utm_source=x'), 'https://e-jip.com/map?utm_source=x');
  // CSP: 외부 스크립트·연결·프레임 출처 없음(폰트 CDN은 style/font에만)
  for (const dev of [false, true]) {
    const csp = privateBriefingHeaders({ dev }).find((x) => x.key === 'Content-Security-Policy')!.value;
    const directive = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
    assert.ok(!/https?:/.test(directive('script-src')), directive('script-src'));
    assert.ok(!/https?:/.test(directive('connect-src')), directive('connect-src'));
    assert.equal(directive('frame-src'), "frame-src 'none'");
    assert.ok(!/googlesyndication|googletagmanager|google-analytics|kakao|daumcdn/.test(csp), csp);
  }
  assert.ok(!/unsafe-eval/.test(privateBriefingHeaders({ dev: false })[0].value), '운영 CSP에는 unsafe-eval 없음');
  assert.equal(isTokenizedPrivatePath('/pro/briefings/new'), false);
});
