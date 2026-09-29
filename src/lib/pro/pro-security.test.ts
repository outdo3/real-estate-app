import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { addListingNote, createListing, deleteListing, getListing, listListings, revealListingOwnerContact, setListingActive, updateListing } from './listing-service';
import { createCustomer, deleteCustomer, getCustomer, listCustomers, revealCustomerContact, savePreference, updateCustomer } from './customer-service';
import { createFollowup } from './followup-service';
import { computeMatchesForCustomer, setMatchState } from './match-service';
import { createBriefing, revokeBriefing, viewBriefingByToken } from './briefing-service';
import { adminSetStatus, applyForPro, getMyStatus } from './profile-service';
import { getDashboard } from './dashboard-service';
import { BRIEFING_TOKEN_PATTERN, findForbiddenSnapshotKeys, generateBriefingToken, hashBriefingToken } from './briefing';
import { buildAuditEntry } from './audit';
import { resolveProMode } from './mode';
import { PLAN_CAPABILITIES } from './plan-limits';
import { addProfile, customerBody, FIXED_NOW, grantPro, listingBody, makeDeps, publicInfo } from './pro-test-helpers';

// REALTOR_PRO_MVP_V1 — 보안·소유권 회귀(합성 데이터, 메모리 저장소, DB·네트워크 0).

const A = { userId: 'user-a' };
const B = { userId: 'user-b' };
const ANON_LIKE = { userId: 'user-without-profile' };

function twoRealtors() {
  const deps = makeDeps();
  addProfile(deps.state, A.userId);
  addProfile(deps.state, B.userId);
  return deps;
}

async function aListing(deps: ReturnType<typeof makeDeps>, over: Record<string, unknown> = {}) {
  const r = await createListing(deps, A, listingBody({ ownerName: '소유자', ownerPhone: '010-2222-3333', memo: '남향', ...over }));
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

async function aCustomer(deps: ReturnType<typeof makeDeps>, over: Record<string, unknown> = {}) {
  const r = await createCustomer(deps, A, customerBody({ phone: '010-4444-5555', email: 'test@example.com', memo: '주말 선호', ...over }));
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

test('1 · 25 · realtor A 매물을 B가 읽기·수정·보관·삭제·노트·연락처 조회 전부 404(IDOR)', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  for (const r of [
    await getListing(deps, B, l.id),
    await updateListing(deps, B, l.id, { memo: 'x' }),
    await setListingActive(deps, B, l.id, { active: false }),
    await deleteListing(deps, B, l.id),
    await addListingNote(deps, B, l.id, { body: 'x' }),
    await revealListingOwnerContact(deps, B, l.id),
  ]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 404);
  }
  const bList = await listListings(deps, B, {});
  assert.ok(bList.ok && bList.data.items.length === 0);
  // A의 매물은 그대로
  const still = await getListing(deps, A, l.id);
  assert.ok(still.ok && still.data.listing.memo === '남향');
});

test('2 · 25 · realtor A 고객을 B가 읽기·수정·삭제·연락처·조건·매칭·팔로업·브리핑 전부 404', async () => {
  const deps = twoRealtors();
  const c = await aCustomer(deps);
  const l = await aListing(deps);
  for (const r of [
    await getCustomer(deps, B, c.id),
    await updateCustomer(deps, B, c.id, { name: 'x' }),
    await deleteCustomer(deps, B, c.id),
    await revealCustomerContact(deps, B, c.id),
    await savePreference(deps, B, c.id, null, { dealTypes: ['SALE'] }),
    await computeMatchesForCustomer(deps, B, c.id),
    await createFollowup(deps, B, { customerId: c.id, dueAt: FIXED_NOW.toISOString() }),
    await createBriefing(deps, B, { listingId: l.id, customerId: c.id }),
  ]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.status === 404 || r.status === 403, `${r.status} ${r.code}`);
  }
  const bList = await listCustomers(deps, B, {});
  assert.ok(bList.ok && bList.data.items.length === 0);
});

test('3 · 4 · 프로필 없는 사용자(비중개사)는 비공개 읽기·쓰기 403, 익명은 라우트에서 401(서버 세션 actor 없음)', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  for (const r of [await listListings(deps, ANON_LIKE, {}), await getListing(deps, ANON_LIKE, l.id), await createListing(deps, ANON_LIKE, listingBody()), await createCustomer(deps, ANON_LIKE, customerBody()), await getDashboard(deps, ANON_LIKE)]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
  }
  // 라우트 계층: withPro가 actor 없으면 401 — 모든 /api/pro 라우트가 withPro를 거치고 본문의 사용자 id를 쓰지 않는다
  const root = resolve(__dirname, '../../app/api/pro');
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f === 'route.ts' && files.push(join(d, f))));
  walk(root);
  assert.ok(files.length >= 20);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /withPro\(/, f);
    assert.ok(!/body\.(userId|realtorId)|\.userId\s*=|getServerSession/.test(src), f);
  }
  const runtime = readFileSync(resolve(__dirname, 'runtime.ts'), 'utf8');
  assert.match(runtime, /if \(!actor\) return NextResponse\.json\(\{ success: false, code: 'LOGIN_REQUIRED'/);
});

test('5 · 정지 중개사: 쓰기 거부, 읽기·브리핑 회수는 허용, 공개 브리핑 즉시 비활성', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  const c = await aCustomer(deps);
  const created = await createBriefing(deps, A, { listingId: l.id, customerId: c.id });
  assert.ok(created.ok);
  deps.state.profiles.find((p) => p.userId === A.userId)!.status = 'SUSPENDED';
  for (const r of [await createListing(deps, A, listingBody()), await updateListing(deps, A, l.id, { memo: 'x' }), await createCustomer(deps, A, customerBody()), await createBriefing(deps, A, { listingId: l.id })]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, 'SUSPENDED');
  }
  assert.ok((await getListing(deps, A, l.id)).ok);
  assert.ok((await listCustomers(deps, A, {})).ok);
  const view = await viewBriefingByToken(deps, created.ok ? created.data.token : '', { countView: false });
  assert.equal(view.access, 'UNAVAILABLE');
  assert.equal(view.snapshot, null);
  assert.ok((await revokeBriefing(deps, A, created.ok ? created.data.briefing.id : '')).ok);
});

test('6 · 7 · 본인 매물·고객 읽기 허용', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  const c = await aCustomer(deps);
  assert.ok((await getListing(deps, A, l.id)).ok);
  assert.ok((await getCustomer(deps, A, c.id)).ok);
});

test('8 · 저장된 연락처는 평문이 아니다(암호문 + HMAC 해시) · DTO에 암호문·해시가 없다', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  const c = await aCustomer(deps);
  const rawL = deps.state.listings.find((x) => x.id === l.id)!;
  const rawC = deps.state.customers.find((x) => x.id === c.id)!;
  const stored = JSON.stringify([rawL, rawC]);
  for (const plain of ['010-2222-3333', '01022223333', '010-4444-5555', '01044445555', 'test@example.com']) assert.ok(!stored.includes(plain), plain);
  assert.ok(rawL.ownerPhoneEnc?.startsWith('pii.v1.') && /^[0-9a-f]{64}$/.test(rawL.ownerPhoneHash!));
  const dto = JSON.stringify([l, c]);
  assert.ok(!/pii\.v1\.|Enc"|Hash"/.test(dto));
  assert.equal((l as { hasOwnerPhone: boolean }).hasOwnerPhone, true);
  // 명시적 조회만 복호화 + 감사로그(필드 이름만)
  const rev = await revealCustomerContact(deps, A, c.id);
  assert.ok(rev.ok && rev.data.phone === '01044445555' && rev.data.email === 'test@example.com');
  const log = deps.state.audits.find((a) => a.action === 'CONTACT_DECRYPTED')!;
  assert.deepEqual(log.meta, { fields: ['phone', 'email'] });
});

test('키 미설정이면 연락처 저장을 거부(평문 저장으로 떨어지지 않음), 연락처 없는 입력은 허용', async () => {
  const deps = makeDeps({ ring: null });
  addProfile(deps.state, A.userId);
  const r = await createCustomer(deps, A, customerBody({ phone: '010-1111-2222' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, 'PII_KEY_MISSING');
  assert.ok((await createCustomer(deps, A, customerBody())).ok);
  assert.ok(!JSON.stringify(deps.state).includes('010-1111-2222'));
});

test('14 · 15 · 16 · Free 한도(활성 매물 10·고객 5) / Pro 한도는 plan-limits에서만', async () => {
  const deps = twoRealtors();
  const free = PLAN_CAPABILITIES.FREE;
  for (let i = 0; i < free.activeListings; i++) assert.ok((await createListing(deps, A, listingBody())).ok, `listing ${i}`);
  const over = await createListing(deps, A, listingBody());
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, 'PLAN_LIMIT');
  // 보관하면 한도에서 빠진다
  const first = deps.state.listings[0];
  assert.ok((await setListingActive(deps, A, first.id, { active: false })).ok);
  assert.ok((await createListing(deps, A, listingBody())).ok);
  for (let i = 0; i < free.customers; i++) assert.ok((await createCustomer(deps, A, customerBody())).ok);
  const overC = await createCustomer(deps, A, customerBody());
  assert.equal(overC.ok, false);
  // Pro 베타 부여 → 한도 확장
  grantPro(deps.state, deps.state.profiles.find((p) => p.userId === A.userId)!.id);
  assert.ok((await createCustomer(deps, A, customerBody())).ok);
  const me = await getMyStatus(deps, A);
  assert.ok(me.ok && me.data.plan === 'PRO' && me.data.capabilities.customers === PLAN_CAPABILITIES.PRO.customers);
  // 서비스 코드에 한도 숫자 하드코딩 없음(plan-limits 경유)
  for (const f of ['listing-service.ts', 'customer-service.ts', 'followup-service.ts', 'briefing-service.ts', 'match-service.ts']) {
    // HTTP 상태 코드 인자(fail(500, ...))는 한도 숫자가 아니다
    const src = readFileSync(resolve(__dirname, f), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/fail\(\d{3},/g, 'fail(STATUS,');
    assert.ok(!/\b(300|500)\b/.test(src) && !/>=\s*(5|10)\b/.test(src), f);
  }
});

test('Free 팔로업 고객당 1개 · 반복은 Pro 전용', async () => {
  const deps = twoRealtors();
  const c = await aCustomer(deps);
  assert.ok((await createFollowup(deps, A, { customerId: c.id, dueAt: FIXED_NOW.toISOString() })).ok);
  const second = await createFollowup(deps, A, { customerId: c.id, dueAt: FIXED_NOW.toISOString() });
  assert.equal(second.ok, false);
  const rep = await createFollowup(deps, A, { customerId: c.id, dueAt: FIXED_NOW.toISOString(), repeatRule: 'WEEKLY' });
  assert.equal(rep.ok, false);
  if (!rep.ok) assert.equal(rep.code, 'PLAN_FEATURE');
});

test('17 · 스키마에 출입 비밀번호·열쇠·PIN 필드가 없다', () => {
  const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const pro = schema.slice(schema.indexOf('model RealtorProfile'));
  const fieldNames = [...pro.matchAll(/^\s+(\w+)\s+\w/gm)].map((m) => m[1].toLowerCase());
  for (const f of fieldNames) assert.ok(!/password|passcode|doorcode|door_code|lockbox|pin$|pincode|keylocation|entrycode|secret/.test(f), f);
  const types = readFileSync(resolve(__dirname, 'types.ts'), 'utf8');
  assert.ok(!/password|lockbox|doorCode|entryCode|accessPin/i.test(types));
});

test('18 · 브라우저로 새는 비밀 없음: service-role·NEXT_PUBLIC 키를 Pro 코드가 쓰지 않는다, crypto는 서버 전용', () => {
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && files.push(join(d, f))));
  walk(resolve(__dirname));
  walk(resolve(__dirname, '../../app/api/pro'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/SUPABASE_SERVICE_ROLE|service_role_key|NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|PEPPER)|NEXT_PUBLIC_REALTOR/i.test(src.replace(/^\s*\/\/.*$/gm, '')), f);
  }
  const crypto = readFileSync(resolve(__dirname, 'crypto.ts'), 'utf8');
  assert.match(crypto, /typeof window !== 'undefined'/);
  assert.match(crypto, /from 'node:crypto'/);
});

test('19 · 감사로그에 연락처·이메일·메모·이름·토큰이 없다', async () => {
  const deps = twoRealtors();
  const c = await aCustomer(deps);
  const l = await aListing(deps);
  await updateCustomer(deps, A, c.id, { phone: '010-9999-8888', memo: '비밀 메모 내용' });
  await revealCustomerContact(deps, A, c.id);
  await revealListingOwnerContact(deps, A, l.id);
  const b = await createBriefing(deps, A, { listingId: l.id, customerId: c.id });
  const dump = JSON.stringify(deps.state.audits);
  for (const s of ['010-9999-8888', '01099998888', '010-4444-5555', 'test@example.com', '비밀 메모 내용', '박테스트', '소유자', b.ok ? b.data.token : 'x']) assert.ok(!dump.includes(s), s);
  // meta allowlist: 모르는 키·긴 문자열·PII 형태는 버린다
  const e = buildAuditEntry({ actorUserId: 'u', actorRole: 'REALTOR', action: 'CUSTOMER_UPDATED', targetType: 'realtor_customer', targetId: 'c1', realtorId: 'r1', reason: '연락처 010-1234-5678 a@b.com', meta: { phone: '010', fields: ['phone'], note: 'x', count: 3 } });
  assert.deepEqual(e.meta, { count: 3, fields: ['phone'] });
  assert.ok(!e.reason!.includes('010-1234-5678') && !e.reason!.includes('a@b.com'));
});

test('20 · 브리핑 토큰: 256bit 무작위·열거 불가·DB에는 해시만', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  const tokens = new Set(Array.from({ length: 200 }, () => generateBriefingToken()));
  assert.equal(tokens.size, 200);
  for (const t of tokens) assert.match(t, BRIEFING_TOKEN_PATTERN);
  const b = await createBriefing(deps, A, { listingId: l.id });
  assert.ok(b.ok);
  if (!b.ok) return;
  const stored = deps.state.briefings[0];
  assert.equal(stored.tokenHash, hashBriefingToken(b.data.token));
  assert.ok(!JSON.stringify(deps.state).includes(b.data.token));
  // 형식이 틀린/순차적인 토큰은 조회조차 하지 않는다
  for (const guess of ['1', 'aaaa', stored.id, b.data.token.slice(0, 42), `${b.data.token}x`]) assert.equal((await viewBriefingByToken(deps, guess, { countView: false })).access, 'NOT_FOUND', guess);
  const ok = await viewBriefingByToken(deps, b.data.token, { countView: true });
  assert.equal(ok.access, 'OK');
  assert.equal(deps.state.briefings[0].viewCount, 1);
});

test('21 · 22 · 회수·만료된 브리핑은 내용 없음', async () => {
  const deps = twoRealtors();
  const l = await aListing(deps);
  const b1 = await createBriefing(deps, A, { listingId: l.id });
  const b2 = await createBriefing(deps, A, { listingId: l.id });
  assert.ok(b1.ok && b2.ok);
  if (!b1.ok || !b2.ok) return;
  assert.ok((await revokeBriefing(deps, A, b1.data.briefing.id)).ok);
  assert.deepEqual(await viewBriefingByToken(deps, b1.data.token, { countView: true }), { access: 'REVOKED', snapshot: null });
  (deps as unknown as { nowValue: Date }).nowValue = new Date(FIXED_NOW.getTime() + 8 * 86_400_000); // Free 7일 만료
  assert.deepEqual(await viewBriefingByToken(deps, b2.data.token, { countView: true }), { access: 'EXPIRED', snapshot: null });
  // 다른 중개사는 회수할 수 없다
  assert.equal((await revokeBriefing(deps, B, b2.data.briefing.id)).ok, false);
});

test('브리핑 스냅샷에 소유자·호수·메모·연락처·예산 원문이 없다 · 닫힌 지역은 실거래 미포함', async () => {
  const deps = makeDeps({ publicData: { lookup: async () => publicInfo({ detailOpen: false, tradeState: 'REGION_NOT_OPEN', recentTrades: [] }) } });
  addProfile(deps.state, A.userId);
  const l = await aListing(deps, { aptSeq: '11680-218', lawdCd: '11680', unitHo: '1203', buildingDong: '101', viewingNote: '평일 저녁 조율' });
  const c = await aCustomer(deps);
  await savePreference(deps, A, c.id, null, { dealTypes: ['SALE'], budgetMinManwon: 80000, budgetMaxManwon: 95000, areaMinM2: 80, areaMaxM2: 90 });
  const b = await createBriefing(deps, A, { listingId: l.id, customerId: c.id });
  assert.ok(b.ok);
  if (!b.ok) return;
  const snap = b.data.snapshot;
  assert.deepEqual(findForbiddenSnapshotKeys(snap), []);
  const s = JSON.stringify(snap);
  for (const bad of ['1203', '101동', '소유자', '010-2222-3333', '남향', '평일 저녁 조율', '박테스트', '9.5억', '95000']) assert.ok(!s.includes(bad), bad);
  assert.equal(snap.customerLabel, '박OO 고객님');
  assert.ok(snap.listing && !('floor' in snap.listing) && !('unitHo' in snap.listing), '매물 정확 층·호수는 스냅샷에 없다');
  assert.equal(snap.publicData.state, 'REGION_NOT_OPEN');
  assert.deepEqual(snap.publicData.recentTrades, []);
});

test('23 · Prisma 저장소: 비공개 조회·수정은 전부 realtorId 조건, id 단독 조회·수정 없음', () => {
  const src = readFileSync(resolve(__dirname, 'repo-prisma.ts'), 'utf8');
  const privateModels = ['realtorListing', 'realtorListingNote', 'realtorCustomer', 'realtorCustomerPreference', 'realtorMatch', 'realtorFollowup', 'realtorSubscription'];
  for (const m of privateModels) {
    const calls = [...src.matchAll(new RegExp(`prisma\\.${m}\\.(\\w+)\\(\\{([\\s\\S]*?)\\}\\)`, 'g'))];
    assert.ok(calls.length > 0, m);
    for (const [, method, args] of calls) {
      if (method === 'create') assert.match(args, /realtorId/, `${m}.create`);
      else assert.match(args, /realtorId/, `${m}.${method}`);
      assert.ok(!['findUnique', 'update', 'delete', 'upsert', 'deleteMany'].includes(method), `${m}.${method}`);
    }
  }
  // 브리핑: 공개 뷰의 tokenHash 단건 외에는 realtorId 조건
  const briefingCalls = [...src.matchAll(/prisma\.realtorBriefing\.(\w+)\(\{([\s\S]*?)\}\)/g)];
  for (const [, method, args] of briefingCalls) {
    if (method === 'findUnique') assert.match(args, /tokenHash/);
    else if (!/briefingId/.test(args)) assert.match(args, /realtorId/, method);
  }
});

test('24 · mass assignment: 본문의 realtorId·id·status·deletedAt·userId는 무시된다', async () => {
  const deps = twoRealtors();
  const bId = deps.state.profiles.find((p) => p.userId === B.userId)!.id;
  const l = await createListing(deps, A, listingBody({ realtorId: bId, id: 'forced', isActive: false, deletedAt: FIXED_NOW, ownerPhoneEnc: 'pii.v1.x.y.z.w' }));
  assert.ok(l.ok);
  const raw = deps.state.listings[0];
  assert.notEqual(raw.realtorId, bId);
  assert.notEqual(raw.id, 'forced');
  assert.equal(raw.isActive, true);
  assert.equal(raw.deletedAt, null);
  assert.equal(raw.ownerPhoneEnc, null);
  const c = await createCustomer(deps, A, customerBody({ realtorId: bId, deletedAt: FIXED_NOW, phoneHash: 'x' }));
  assert.ok(c.ok);
  assert.notEqual(deps.state.customers[0].realtorId, bId);
  assert.equal(deps.state.customers[0].phoneHash, null);
  // 신청으로 스스로 VERIFIED가 될 수 없다
  const deps2 = makeDeps();
  const applied = await applyForPro(deps2, { userId: 'new-user' }, { displayName: '새 중개사', agreeTerms: true, status: 'VERIFIED', userId: 'someone-else' });
  assert.ok(applied.ok);
  assert.equal(deps2.state.profiles[0].status, 'PENDING_REVIEW');
  assert.equal(deps2.state.profiles[0].userId, 'new-user');
  // 매칭 상태 변경도 타인 id는 404
  assert.equal((await setMatchState(deps, B, 'rm_unknown', { state: 'SEEN' })).ok, false);
});

test('관리자 심사: 허용된 전환만, 반려·정지는 사유 필수, 감사로그', async () => {
  const deps = makeDeps();
  const p = addProfile(deps.state, 'applicant', 'PENDING_REVIEW');
  assert.equal((await adminSetStatus(deps, { userId: 'admin' }, p.id, { status: 'SUSPENDED', reason: 'x' })).ok, false);
  assert.equal((await adminSetStatus(deps, { userId: 'admin' }, p.id, { status: 'REJECTED' })).ok, false);
  assert.ok((await adminSetStatus(deps, { userId: 'admin' }, p.id, { status: 'VERIFIED' })).ok);
  assert.equal(deps.state.audits.at(-1)!.action, 'PROFILE_STATUS_CHANGE');
  assert.deepEqual(deps.state.audits.at(-1)!.meta, { fromStatus: 'PENDING_REVIEW', toStatus: 'VERIFIED' });
});

test('자유 텍스트의 비밀번호·열쇠 패턴은 확인 없이는 저장되지 않는다', async () => {
  const deps = twoRealtors();
  const r = await createListing(deps, A, listingBody({ viewingNote: '현관 비번 #1234*' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'SENSITIVE_TEXT_CONFIRM');
    assert.deepEqual(r.sensitiveFields, ['viewingNote']);
  }
  assert.equal(deps.state.listings.length, 0);
  assert.ok((await createListing(deps, A, listingBody({ viewingNote: '현관 비번 #1234*', confirmSensitive: true }))).ok);
  assert.ok(!JSON.stringify(deps.state.audits).includes('1234'));
});

test('모드: 기본 꺼짐 · 데모는 개발 환경에서만(production·Vercel에서는 절대 켜지지 않음)', () => {
  assert.equal(resolveProMode({}), 'OFF');
  assert.equal(resolveProMode({ REALTOR_PRO_ENABLED: 'false' }), 'OFF');
  assert.equal(resolveProMode({ REALTOR_PRO_ENABLED: 'true' }), 'LIVE');
  assert.equal(resolveProMode({ REALTOR_PRO_DEMO: '1', NODE_ENV: 'development' }), 'DEMO');
  assert.equal(resolveProMode({ REALTOR_PRO_DEMO: '1', NODE_ENV: 'production' }), 'OFF');
  assert.equal(resolveProMode({ REALTOR_PRO_DEMO: '1', VERCEL_ENV: 'preview' }), 'OFF');
  assert.equal(resolveProMode({ REALTOR_PRO_DEMO: '1', NODE_ENV: 'production', REALTOR_PRO_ENABLED: 'true' }), 'LIVE');
});

test('삭제한 고객은 404이고 연락처·메모가 즉시 비워진다', async () => {
  const deps = twoRealtors();
  const c = await aCustomer(deps);
  assert.ok((await deleteCustomer(deps, A, c.id)).ok);
  assert.equal((await getCustomer(deps, A, c.id)).ok, false);
  const raw = deps.state.customers[0];
  assert.equal(raw.phoneEnc, null);
  assert.equal(raw.emailEnc, null);
  assert.equal(raw.memo, null);
});
