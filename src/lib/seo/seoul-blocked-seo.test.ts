import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decidePublicSeo, lawdCdFromAptSeq, SEOUL_NOINDEX_ROBOTS, type SeoulBlockedCheck } from './seoul-blocked-seo';
import { SEOUL_BETA_ENABLED, SEOUL_BETA_LAWDCDS } from '../region/enablement';
import { REGION_NODES } from '../region/registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';

// SEOUL_BETA_PRELAUNCH_SEO_SAFETY_FIX_V1 — 공개 차단 서울 화면의 색인 정책 회귀 테스트.

const ROOT = resolve(__dirname, '../../..');
/** 주석을 뺀 실제 코드만 본다 — 주석 문구가 매칭되면 안 된다. */
const readCode = (p: string) =>
  readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEOUL_ALL = REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
const BETA8 = SEOUL_BETA_LAWDCDS as readonly string[];
const SEOUL_NON_BETA = SEOUL_ALL.filter((c) => !BETA8.includes(c));
const GANGNAM = '11680';

/**
 * beta ON 시뮬레이션 — enablement.ts의 SEOUL_BETA_ENABLEMENT(app·cronSync만 true)와 같은 규칙.
 * 실제 스위치는 건드리지 않는다.
 */
const betaOn: SeoulBlockedCheck = (lawdCd, feature) => {
  const node = REGION_NODES.find((n) => n.lawdCd === lawdCd);
  if (!node || node.sidoCode !== '11') return false;
  const open = BETA8.includes(lawdCd) && ['app', 'search', 'map', 'detail', 'cronSync'].includes(feature);
  return !open;
};

/** beta OFF 시뮬레이션 — 서울은 전 축 닫힘(launch 이전 상태, 롤백 시 상태). */
const betaOff: SeoulBlockedCheck = (lawdCd) => {
  const node = REGION_NODES.find((n) => n.lawdCd === lawdCd);
  return !!node && node.sidoCode === '11';
};

test('§0 beta 스위치는 켜져 있다(SEOUL_MOBILE_BETA_LAUNCH_V1) — 승인 8구, 강남 제외', () => {
  assert.equal(SEOUL_BETA_ENABLED, true);
  assert.equal(BETA8.length, 8);
  assert.equal(SEOUL_NON_BETA.length, 17);
  assert.ok(!BETA8.includes(GANGNAM));
});

test('§1 beta OFF(시뮬레이션) — 승인 8구 상세도 BLOCKED(noindex)', () => {
  for (const code of BETA8) assert.equal(decidePublicSeo([code], 'app', betaOff), 'BLOCKED', code);
});

test('§2 강남 상세 BLOCKED — beta OFF·현재(ON) 모두', () => {
  assert.equal(decidePublicSeo([GANGNAM], 'app', betaOff), 'BLOCKED');
  assert.equal(decidePublicSeo([GANGNAM], 'app'), 'BLOCKED');
  assert.equal(decidePublicSeo([null, lawdCdFromAptSeq('11680-4090')], 'app'), 'BLOCKED');
});

test('§3 나머지 17구 상세 BLOCKED — beta OFF·현재(ON) 모두', () => {
  for (const code of SEOUL_NON_BETA) {
    assert.equal(decidePublicSeo([code], 'app', betaOff), 'BLOCKED', code);
    assert.equal(decidePublicSeo([code], 'app'), 'BLOCKED', code);
  }
});

test('§3b 현재(ON) 런타임 — 승인 8구 상세는 열리되 NOINDEX, 리포트는 BLOCKED', () => {
  for (const code of BETA8) {
    assert.equal(decidePublicSeo([code], 'app'), 'NOINDEX', code);
    assert.equal(decidePublicSeo([code], 'report'), 'BLOCKED', code);
  }
});

test('§4 부산 16구는 NONE(불변), 서울 밖 미출시 지역은 BLOCKED', () => {
  for (const code of BUSAN_LAWDCD_16) {
    assert.equal(decidePublicSeo([code], 'app'), 'NONE', code);
    assert.equal(decidePublicSeo([code], 'report'), 'NONE', code);
    assert.equal(decidePublicSeo([code], 'app', betaOn), 'NONE', `${code} (beta ON)`);
  }
  for (const code of BUSAN_LAWDCD_16) assert.equal(decidePublicSeo([code], 'detail'), 'NONE', code);
  // GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — 서울 밖 미출시 지역(경기·대구)·registry 밖 코드는 이제 BLOCKED다(예전엔 NONE).
  for (const code of ['41135', '41111', '27110', '99999']) {
    for (const axis of ['app', 'detail', 'report'] as const) assert.equal(decidePublicSeo([code], axis), 'BLOCKED', `${code} ${axis}`);
  }
  // 부산 + 경기 조작 URL은 덜 열린 쪽(BLOCKED)
  assert.equal(decidePublicSeo(['26350', lawdCdFromAptSeq('41111-41')], 'detail'), 'BLOCKED');
  // 식별자가 없으면(이름만 있는 주소) 판정하지 않는다 — 이름으로 지역을 추측하지 않는다.
  assert.equal(decidePublicSeo([null, undefined, ''], 'app'), 'NONE');
});

test('§5 서울 리포트는 beta OFF·ON 모두 25구 전부 BLOCKED', () => {
  for (const code of SEOUL_ALL) {
    assert.equal(decidePublicSeo([code], 'report'), 'BLOCKED', code);
    assert.equal(decidePublicSeo([code], 'report', betaOn), 'BLOCKED', `${code} (beta ON)`);
  }
});

test('§6·§7 sitemap — 서울·강남 URL 0(서울 동 거래가 들어와도 싣지 않는다)', () => {
  const region = buildLaunchRegionRoutes().map((r) => r.path);
  const dong = buildDongRoutes([
    { lawdCd: '11440', dong: '상암동', count: 500 },
    { lawdCd: GANGNAM, dong: '세곡동', count: 500 },
    { lawdCd: '26350', dong: '우동', count: 500 },
  ]).map((r) => r.path);
  const all = [...region, ...dong].map((p) => decodeURIComponent(p));
  const seoul = all.filter((p) => SEOUL_ALL.some((c) => p.includes(c)) || /서울|seoul/i.test(p));
  assert.deepEqual(seoul, []);
  assert.ok(!all.some((p) => p.includes(GANGNAM)));
  assert.ok(dong.some((p) => p.includes('26350')), '부산 동은 그대로 실린다');
});

test('§8 차단 화면은 단지명을 색인 가능한 메타데이터로 내보내지 않는다(소스 수준)', () => {
  assert.deepEqual({ ...SEOUL_NOINDEX_ROBOTS }, { index: false, follow: false });

  const detail = readCode('src/app/apt/[name]/page.tsx');
  const blockedBranch = /if \(seoulSeo === 'BLOCKED'\) \{([\s\S]*?)\n  \}/.exec(detail)?.[1] ?? '';
  assert.ok(blockedBranch, '상세 BLOCKED 분기가 없다');
  assert.ok(/robots: SEOUL_NOINDEX_ROBOTS/.test(blockedBranch));
  assert.ok(!/aptName/.test(blockedBranch), 'BLOCKED 메타데이터에 단지명이 들어간다');
  assert.ok(!/canonical/.test(blockedBranch), 'BLOCKED 메타데이터에 canonical이 있다');
  // 게이트는 제목을 만들기 전에 판정한다.
  assert.ok(detail.indexOf("seoulSeo === 'BLOCKED'") < detail.indexOf('const title = `${aptName}'));

  const report = readCode('src/app/report/apt/[aptSeq]/page.tsx');
  const gate = report.indexOf("'report') !== 'NONE'");
  assert.ok(gate > 0, '리포트 메타데이터 게이트가 없다');
  assert.ok(gate < report.indexOf('apartmentMaster'), '단지명 조회가 게이트보다 먼저다');

  const compare = readCode('src/app/stats/compare/page.tsx');
  const cGate = compare.indexOf("'detail') !== 'NONE'");
  assert.ok(cGate > 0 && cGate < compare.indexOf('${a.name} vs ${b.name}'), '비교 제목이 게이트보다 먼저다');
});

test('§9 beta ON 시뮬레이션 — 승인 8구 상세는 열리되(NOINDEX) 색인·canonical은 없다', () => {
  for (const code of BETA8) {
    assert.equal(decidePublicSeo([code], 'app', betaOn), 'NOINDEX', code);
    assert.equal(decidePublicSeo([null, `${code}-1`].map((v) => v && lawdCdFromAptSeq(v)), 'app', betaOn), 'NOINDEX');
  }
  const detail = readCode('src/app/apt/[name]/page.tsx');
  assert.ok(/seoulSeo === 'NOINDEX'\s*\?\s*null/.test(detail), 'NOINDEX인데 canonical을 싣는다');
  assert.ok(/seoulSeo === 'NOINDEX' \? \{ robots: SEOUL_NOINDEX_ROBOTS \}/.test(detail), 'NOINDEX인데 robots가 없다');
});

test('§10 beta ON이어도 강남·나머지 17구는 BLOCKED, 섞인 식별자는 덜 열린 쪽', () => {
  assert.equal(decidePublicSeo([GANGNAM], 'app', betaOn), 'BLOCKED');
  for (const code of SEOUL_NON_BETA) assert.equal(decidePublicSeo([code], 'app', betaOn), 'BLOCKED', code);
  // 쿼리 lawdCd는 승인 구인데 aptSeq는 강남 → 막는다.
  assert.equal(decidePublicSeo(['11440', lawdCdFromAptSeq('11680-4090')], 'app', betaOn), 'BLOCKED');
  // 쿼리 lawdCd는 부산인데 aptSeq는 차단 서울 → 막는다.
  assert.equal(decidePublicSeo(['26350', lawdCdFromAptSeq('11680-4090')], 'app'), 'BLOCKED');
  assert.equal(decidePublicSeo(['26350', lawdCdFromAptSeq('11440-136')], 'app', betaOff), 'BLOCKED');
});

test('§11 aptSeq 앞자리 추출은 형태가 맞을 때만', () => {
  assert.equal(lawdCdFromAptSeq('11440-136'), '11440');
  assert.equal(lawdCdFromAptSeq(' 26350-2611 '), '26350');
  for (const bad of [null, undefined, '', '11440', '1144-136', 'abcde-1', '11440-']) {
    assert.equal(lawdCdFromAptSeq(bad), null, String(bad));
  }
});
