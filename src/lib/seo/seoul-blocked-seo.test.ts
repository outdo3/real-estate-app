import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideSeoulSeo, lawdCdFromAptSeq, SEOUL_NOINDEX_ROBOTS, type SeoulBlockedCheck } from './seoul-blocked-seo';
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
  const open = BETA8.includes(lawdCd) && (feature === 'app' || feature === 'cronSync');
  return !open;
};

test('§0 beta 스위치는 꺼져 있다(이 STEP은 켜지 않는다)', () => {
  assert.equal(SEOUL_BETA_ENABLED, false);
  assert.equal(BETA8.length, 8);
  assert.equal(SEOUL_NON_BETA.length, 17);
  assert.ok(!BETA8.includes(GANGNAM));
});

test('§1 beta OFF — 승인 8구 상세도 BLOCKED(noindex)', () => {
  for (const code of BETA8) assert.equal(decideSeoulSeo([code], 'app'), 'BLOCKED', code);
});

test('§2 beta OFF — 강남 상세 BLOCKED', () => {
  assert.equal(decideSeoulSeo([GANGNAM], 'app'), 'BLOCKED');
  assert.equal(decideSeoulSeo([null, lawdCdFromAptSeq('11680-4090')], 'app'), 'BLOCKED');
});

test('§3 beta OFF — 나머지 17구 상세 BLOCKED', () => {
  for (const code of SEOUL_NON_BETA) assert.equal(decideSeoulSeo([code], 'app'), 'BLOCKED', code);
});

test('§4 부산 16구·서울 밖 지역은 NONE — 기존 메타데이터 불변', () => {
  for (const code of BUSAN_LAWDCD_16) {
    assert.equal(decideSeoulSeo([code], 'app'), 'NONE', code);
    assert.equal(decideSeoulSeo([code], 'report'), 'NONE', code);
    assert.equal(decideSeoulSeo([code], 'app', betaOn), 'NONE', `${code} (beta ON)`);
  }
  for (const code of ['41135', '27110', '99999']) assert.equal(decideSeoulSeo([code], 'app'), 'NONE', code);
  // 식별자가 없으면(이름만 있는 주소) 판정하지 않는다 — 이름으로 지역을 추측하지 않는다.
  assert.equal(decideSeoulSeo([null, undefined, ''], 'app'), 'NONE');
});

test('§5 서울 리포트는 beta OFF·ON 모두 25구 전부 BLOCKED', () => {
  for (const code of SEOUL_ALL) {
    assert.equal(decideSeoulSeo([code], 'report'), 'BLOCKED', code);
    assert.equal(decideSeoulSeo([code], 'report', betaOn), 'BLOCKED', `${code} (beta ON)`);
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
  const cGate = compare.indexOf("'app') !== 'NONE'");
  assert.ok(cGate > 0 && cGate < compare.indexOf('${a.name} vs ${b.name}'), '비교 제목이 게이트보다 먼저다');
});

test('§9 beta ON 시뮬레이션 — 승인 8구 상세는 열리되(NOINDEX) 색인·canonical은 없다', () => {
  for (const code of BETA8) {
    assert.equal(decideSeoulSeo([code], 'app', betaOn), 'NOINDEX', code);
    assert.equal(decideSeoulSeo([null, `${code}-1`].map((v) => v && lawdCdFromAptSeq(v)), 'app', betaOn), 'NOINDEX');
  }
  const detail = readCode('src/app/apt/[name]/page.tsx');
  assert.ok(/seoulSeo === 'NOINDEX'\s*\?\s*null/.test(detail), 'NOINDEX인데 canonical을 싣는다');
  assert.ok(/seoulSeo === 'NOINDEX' \? \{ robots: SEOUL_NOINDEX_ROBOTS \}/.test(detail), 'NOINDEX인데 robots가 없다');
});

test('§10 beta ON이어도 강남·나머지 17구는 BLOCKED, 섞인 식별자는 덜 열린 쪽', () => {
  assert.equal(decideSeoulSeo([GANGNAM], 'app', betaOn), 'BLOCKED');
  for (const code of SEOUL_NON_BETA) assert.equal(decideSeoulSeo([code], 'app', betaOn), 'BLOCKED', code);
  // 쿼리 lawdCd는 승인 구인데 aptSeq는 강남 → 막는다.
  assert.equal(decideSeoulSeo(['11440', lawdCdFromAptSeq('11680-4090')], 'app', betaOn), 'BLOCKED');
  // 쿼리 lawdCd는 부산인데 aptSeq는 서울 → 막는다.
  assert.equal(decideSeoulSeo(['26350', lawdCdFromAptSeq('11440-136')], 'app'), 'BLOCKED');
});

test('§11 aptSeq 앞자리 추출은 형태가 맞을 때만', () => {
  assert.equal(lawdCdFromAptSeq('11440-136'), '11440');
  assert.equal(lawdCdFromAptSeq(' 26350-2611 '), '26350');
  for (const bad of [null, undefined, '', '11440', '1144-136', 'abcde-1', '11440-']) {
    assert.equal(lawdCdFromAptSeq(bad), null, String(bad));
  }
});
