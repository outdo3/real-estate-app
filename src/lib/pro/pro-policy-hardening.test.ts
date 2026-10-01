// REALTOR_PRO_POLICY_HARDENING_V1 — ① 관리자 자기 승인 금지 ② 취소·만료 브리핑 410 ③ Pro 화면 공개 하단 탭 숨김 (합성 데이터만).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adminGrantBetaPro, adminSetStatus, applyForPro, getMyStatus } from './profile-service';
import { createListing } from './listing-service';
import { createCustomer } from './customer-service';
import { createBriefing, revokeBriefing, viewBriefingByToken } from './briefing-service';
import { BRIEFING_GONE_HTML, BRIEFING_GONE_TITLE, briefingGoneHeaders, briefingGoneResponse, briefingHttpStatus, briefingTokenFromPath } from './briefing-gone';
import { addProfile, customerBody, FIXED_NOW, listingBody, makeDeps } from './pro-test-helpers';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── ① 자기 승인 금지 ─────────────────────────────────────────────

test('자기 승인: 관리자가 자기 신청을 승인하면 409 SELF_APPROVAL_NOT_ALLOWED, 상태·감사로그 불변', async () => {
  const deps = makeDeps();
  const admin = { userId: 'admin-1' };
  const applied = await applyForPro(deps, admin, { displayName: '관리자 겸 중개사', agreeTerms: true });
  assert.ok(applied.ok);
  if (!applied.ok) return;
  const auditsBefore = deps.state.audits.length;
  const r = await adminSetStatus(deps, admin, applied.data.id, { status: 'VERIFIED' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 409);
  assert.equal(r.code, 'SELF_APPROVAL_NOT_ALLOWED');
  assert.equal(deps.state.profiles[0].status, 'PENDING_REVIEW');
  assert.equal(deps.state.profiles[0].reviewedByUserId, null);
  assert.equal(deps.state.audits.length, auditsBefore);
  // 다른 관리자는 승인할 수 있다
  assert.ok((await adminSetStatus(deps, { userId: 'admin-2' }, applied.data.id, { status: 'VERIFIED' })).ok);
  const me = await getMyStatus(deps, admin);
  assert.ok(me.ok && me.data.state === 'VERIFIED');
});

test('자기 승인: 다른 사용자 승인 · 자기 반려 · 기존 VERIFIED 유지 · 자기 정지 해제는 차단', async () => {
  const deps = makeDeps();
  const admin = { userId: 'admin-1' };
  const other = addProfile(deps.state, 'user-b', 'PENDING_REVIEW');
  assert.ok((await adminSetStatus(deps, admin, other.id, { status: 'VERIFIED' })).ok);
  assert.equal(other.status, 'VERIFIED');

  // 반려는 기존 동작(자기 것이어도 가능, 사유 필수)
  const mine = addProfile(deps.state, admin.userId, 'PENDING_REVIEW', 'rp_admin');
  assert.equal((await adminSetStatus(deps, admin, mine.id, { status: 'REJECTED' })).ok, false);
  assert.ok((await adminSetStatus(deps, admin, mine.id, { status: 'REJECTED', reason: '서류 보완' })).ok);
  assert.equal(mine.status, 'REJECTED');

  // 이미 VERIFIED인 자기 프로필은 그대로(소급 변경 없음), 다른 기능도 그대로
  const deps2 = makeDeps();
  const verifiedSelf = addProfile(deps2.state, admin.userId, 'VERIFIED');
  assert.equal(verifiedSelf.status, 'VERIFIED');
  assert.ok((await createListing(deps2, admin, listingBody())).ok);
  // 정지 → 자기 정지 해제(→VERIFIED)도 승인이므로 차단, 다른 관리자는 가능
  assert.ok((await adminSetStatus(deps2, admin, verifiedSelf.id, { status: 'SUSPENDED', reason: '점검' })).ok);
  const resume = await adminSetStatus(deps2, admin, verifiedSelf.id, { status: 'VERIFIED' });
  assert.ok(!resume.ok && resume.code === 'SELF_APPROVAL_NOT_ALLOWED');
  assert.equal(verifiedSelf.status, 'SUSPENDED');
  assert.ok((await adminSetStatus(deps2, { userId: 'admin-2' }, verifiedSelf.id, { status: 'VERIFIED' })).ok);
  // 잘못된 전환·없는 ID는 기존 오류 그대로
  assert.equal((await adminSetStatus(deps2, admin, 'missing', { status: 'VERIFIED' })).ok, false);
  const bad = await adminSetStatus(deps, admin, other.id, { status: 'REJECTED', reason: 'x' });
  assert.ok(!bad.ok && bad.code === 'BAD_TRANSITION');
  // 베타 Pro 부여는 이번 범위 밖(기존 동작 유지)
  assert.ok((await adminGrantBetaPro(deps, admin, other.id, 30)).ok);
});

test('자기 승인 차단은 서버(서비스)에서 한다 — 관리자 API가 세션 사용자 id를 그대로 넘긴다', () => {
  const route = read('src/app/api/admin/pro/applications/[id]/route.ts');
  assert.match(route, /requireAdmin\(\)/);
  assert.match(route, /adminSetStatus\(deps, \{ userId: adminUserId \}, id, body\)/);
  const svc = read('src/lib/pro/profile-service.ts');
  assert.match(svc, /to === 'VERIFIED' && cur\.userId === admin\.userId/);
});

// ── ② 브리핑 410 ────────────────────────────────────────────────

test('브리핑 HTTP 상태: OK 200 · NOT_FOUND 404 · REVOKED/EXPIRED 410 · 정지(UNAVAILABLE)는 기존 200 안내', () => {
  assert.equal(briefingHttpStatus('OK'), 200);
  assert.equal(briefingHttpStatus('NOT_FOUND'), 404);
  assert.equal(briefingHttpStatus('REVOKED'), 410);
  assert.equal(briefingHttpStatus('EXPIRED'), 410);
  assert.equal(briefingHttpStatus('UNAVAILABLE'), 200);
});

test('브리핑 경로 파싱: /b/<token>만, 하위 경로·빈 토큰은 대상 아님', () => {
  assert.equal(briefingTokenFromPath('/b/abc_DEF-1'), 'abc_DEF-1');
  assert.equal(briefingTokenFromPath('/b/abc/'), 'abc');
  assert.equal(briefingTokenFromPath('/b/'), null);
  assert.equal(briefingTokenFromPath('/b/abc/x'), null);
  assert.equal(briefingTokenFromPath('/pro/b/abc'), null);
  assert.equal(briefingTokenFromPath('/b/%E0%A4%A'), null);
});

test('취소·만료 → 410, 유효 → 200, 모르는·한 글자 다른 토큰 → 404 (서비스 판정 + 상태 매핑)', async () => {
  const deps = makeDeps();
  const A = { userId: 'user-a' };
  addProfile(deps.state, A.userId);
  const l = await createListing(deps, A, listingBody({ memo: '비공개메모-XYZ', ownerName: '소유자QQ', ownerPhone: '010-2222-3333' }));
  const c = await createCustomer(deps, A, customerBody({ name: '홍비밀', phone: '010-4444-5555' }));
  assert.ok(l.ok && c.ok);
  if (!l.ok || !c.ok) return;
  const valid = await createBriefing(deps, A, { listingId: l.data.id, customerId: c.data.id });
  const revoked = await createBriefing(deps, A, { listingId: l.data.id });
  assert.ok(valid.ok && revoked.ok);
  if (!valid.ok || !revoked.ok) return;
  assert.ok((await revokeBriefing(deps, A, revoked.data.briefing.id)).ok);
  const status = async (t: string) => briefingHttpStatus((await viewBriefingByToken(deps, t, { countView: false })).access);
  assert.equal(await status(valid.data.token), 200);
  assert.equal(await status(revoked.data.token), 410);
  const t = valid.data.token;
  assert.equal(await status(t.slice(0, 42) + (t[42] === 'A' ? 'B' : 'A')), 404);
  assert.equal(await status('SYNTHETICtokenSYNTHETICtokenSYNTHETICtoken0'), 404);
  (deps as unknown as { nowValue: Date }).nowValue = new Date(FIXED_NOW.getTime() + 8 * 86_400_000);
  assert.equal(await status(valid.data.token), 410);
  // proxy 판정은 조회수를 세지 않는다
  assert.ok(deps.state.briefings.every((b) => b.viewCount === 0));
  // 원문 토큰은 저장소에 없다(해시만)
  assert.ok(!JSON.stringify(deps.state.briefings).includes(valid.data.token));
});

test('410 응답: 고정 문구만(개인정보·토큰 0) · 스크립트·외부 리소스 0 · 보안 헤더 유지', async () => {
  const res = briefingGoneResponse({ dev: false });
  assert.equal(res.status, 410);
  const body = await res.text();
  assert.equal(body, BRIEFING_GONE_HTML);
  assert.ok(body.includes(BRIEFING_GONE_TITLE));
  assert.doesNotMatch(body, /<script|<link|<iframe|<img|https?:\/\//i);
  assert.match(body, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(body, /<meta name="referrer" content="no-referrer">/);
  const h = briefingGoneHeaders({ dev: false });
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(h['Cache-Control'], /no-store/);
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.match(h['X-Robots-Tag'], /noindex/);
  assert.match(h['X-Robots-Tag'], /nofollow/);
  assert.match(h['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(h['Content-Security-Policy'], /googletagmanager|googlesyndication|kakao|ipinfo/);
});

test('proxy: /b/:token만 추가로 맞추고, 관리자 가드는 그대로, 조회수 미집계', () => {
  const src = read('src/proxy.ts');
  assert.match(src, /matcher: \['\/admin\/:path\*', '\/b\/:token'\]/);
  assert.match(src, /startsWith\('\/b\/'\)\) return briefingGate\(request\)/);
  assert.match(src, /countView: false/);
  assert.match(src, /getToken\(\{ req: request, secret: process\.env\.NEXTAUTH_SECRET \}\)/);
  assert.match(src, /isAdminSessionUser\(/);
});

// ── ③ Pro 화면 공개 하단 탭 숨김 ─────────────────────────────────

test('Pro 셸은 Header의 hideMobileNav로 공개 하단 탭을 숨기고, 탭바 높이 여백을 두지 않는다', () => {
  const layout = read('src/app/(pro)/pro/layout.tsx');
  assert.match(layout, /<Header pageTitle="중개사 Pro" hideMobileNav \/>/);
  const shell = read('src/components/pro/ProShell.module.css');
  assert.doesNotMatch(shell, /96px/);
  assert.match(shell, /padding-bottom: calc\(32px \+ env\(safe-area-inset-bottom\)\)/);
  const pro = read('src/components/pro/pro.module.css');
  assert.doesNotMatch(pro, /76px/);
  const header = read('src/components/Header.tsx');
  assert.match(header, /hideMobileNav \? styles\.menuListHideMobile : ''/);
});

test('공개 화면은 하단 탭 유지 — 공개 페이지·관리자 페이지는 hideMobileNav를 쓰지 않는다', () => {
  for (const p of ['src/app/(public)/page.tsx', 'src/app/(public)/map/page.tsx', 'src/app/(public)/admin/pro/page.tsx']) {
    let src = '';
    try { src = read(p); } catch { continue; }
    assert.doesNotMatch(src, /hideMobileNav/, p);
  }
});
