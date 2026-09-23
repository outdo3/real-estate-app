import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEOUL_BETA_LAWDCDS,
  SEOUL_BETA_ENABLED,
  isSeoulPublicBlocked,
  seoulPublicBlockedLawdCds,
  isSidoPubliclyHidden,
  isSidoPartiallyPublic,
  isSeoulBetaDistrict,
  getRegionEnablement,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';

// SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1 — 실제로 새던 경로에 대한 회귀 테스트.

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석을 뺀 실제 코드만 본다 — 주석에 적힌 반례 문구가 매칭되면 안 된다. */
const readCode = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SEOUL_ALL = REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
const SEOUL_NON_BETA = SEOUL_ALL.filter((c) => !(SEOUL_BETA_LAWDCDS as readonly string[]).includes(c));

/** 운영 /api/search 응답으로 실제 확인된 leak 사례. */
const LEAK_CASES = [
  { q: '은마', lawdCd: '11680', note: '강남 — beta에서도 영구 제외' },
  { q: '남산타운', lawdCd: '11140', note: '중구 — beta 승인 구' },
  { q: '광화문스페이스본', lawdCd: '11110', note: '종로 — beta 승인 구' },
];

// ── 현재 상태(beta OFF) ──────────────────────────────────────────────────────

test('§1 beta는 꺼져 있다', () => {
  assert.equal(SEOUL_BETA_ENABLED, false);
});

test('§2 leak 3건이 전부 차단된다(은마·남산타운·광화문스페이스본)', () => {
  for (const c of LEAK_CASES) {
    assert.equal(isSeoulPublicBlocked(c.lawdCd), true, `${c.q}(${c.lawdCd})가 아직 공개된다 — ${c.note}`);
  }
});

test('§3 서울 25구 전부 차단 — deny-list도 25개', () => {
  for (const code of SEOUL_ALL) assert.equal(isSeoulPublicBlocked(code), true, `${code} 미차단`);
  assert.equal(seoulPublicBlockedLawdCds('app').length, 25);
  assert.equal(SEOUL_ALL.length, 25);
});

test('§4 서울은 선택지에서 통째로 숨는다(시도 전체 선택 불가)', () => {
  assert.equal(isSidoPubliclyHidden('11'), true);
  // 열린 구가 0개이므로 "부분 공개"가 아니다 — 시도가 아예 목록에 없다.
  assert.equal(isSidoPartiallyPublic('11'), false);
});

// ── 무회귀: 이 정책은 서울에만 적용된다 ──────────────────────────────────────

test('§5 부산 16구는 차단 대상이 아니다(동작 불변)', () => {
  for (const code of BUSAN_LAWDCD_16) {
    assert.equal(isSeoulPublicBlocked(code), false, `부산 ${code}가 차단됐다`);
    assert.equal(getRegionEnablement(code).app, true);
  }
  assert.equal(isSidoPubliclyHidden('26'), false);
  assert.equal(isSidoPartiallyPublic('26'), false, '부산은 전 구가 열려 "부분 공개"가 아니다');
});

test('§6 서울 밖 미출시 지역(경기·대구)은 이 게이트의 대상이 아니다', () => {
  // 검색/상세의 전국 live MOLIT 동작은 이번 작업 범위가 아니다 — 막으면 과잉 차단이다.
  for (const code of ['41135', '41111', '27110', '99999']) {
    assert.equal(isSeoulPublicBlocked(code), false, `${code}가 차단됐다(과잉 차단)`);
  }
  assert.equal(isSidoPubliclyHidden('41'), false);
});

// ── 미래 상태(beta ON) 시뮬레이션 — 실제 스위치는 켜지 않는다 ────────────────

/** enablement의 판정 규칙과 같은 식으로, beta가 켜졌을 때의 결과를 재현한다. */
function blockedWhenBetaOn(lawdCd: string): boolean {
  const node = REGION_NODES.find((n) => n.lawdCd === lawdCd);
  if (!node || node.sidoCode !== '11') return false;
  return !(SEOUL_BETA_LAWDCDS as readonly string[]).includes(lawdCd); // app 축은 beta에서 열린다
}

test('§7 beta ON 시뮬레이션 — 승인 8구만 열리고 강남·나머지 17구는 계속 차단', () => {
  for (const code of SEOUL_BETA_LAWDCDS) {
    assert.equal(blockedWhenBetaOn(code), false, `승인 구 ${code}가 열리지 않는다`);
  }
  for (const code of SEOUL_NON_BETA) {
    assert.equal(blockedWhenBetaOn(code), true, `미승인 구 ${code}가 열린다`);
  }
  assert.equal(blockedWhenBetaOn('11680'), true, '강남이 열린다');
  assert.equal(SEOUL_NON_BETA.length, 17);
});

test('§8 beta ON이어도 리포트 축은 서울 8구까지 전부 닫힌 채다', () => {
  const src = read('src/lib/region/enablement.ts');
  assert.ok(
    /const SEOUL_BETA_ENABLEMENT: RegionEnablement = \{[\s\S]*?report: false,/.test(src),
    'beta 설정에서 report가 열려 있다 — 리포트는 아직 부산 전용이다'
  );
  for (const code of SEOUL_ALL) {
    assert.equal(isSeoulPublicBlocked(code, 'report'), true, `${code} 리포트가 열려 있다`);
  }
});

test('§9 beta ON이어도 stats/sitemap/seoIndex는 닫힌 채다', () => {
  const src = read('src/lib/region/enablement.ts');
  for (const axis of ['stats', 'sitemap', 'seoIndex'] as const) {
    assert.ok(
      new RegExp(`const SEOUL_BETA_ENABLEMENT: RegionEnablement = \\{[\\s\\S]*?${axis}: false,`).test(src),
      `beta 설정에서 ${axis}가 열려 있다`
    );
    for (const code of SEOUL_ALL) assert.equal(isSeoulPublicBlocked(code, axis), true);
  }
});

// ── 각 경로가 실제로 게이트를 통과하는지(소스 수준) ──────────────────────────

test('§10 /api/search 두 쿼리 모두 지역 필터를 쓴다', () => {
  const src = read('src/app/api/search/route.ts');
  assert.ok(/seoulPublicBlockedLawdCds\('app'\)/.test(src), '검색이 deny-list를 만들지 않는다');
  assert.equal((src.match(/\.\.\.regionScope,/g) || []).length, 2, '지역 필터가 두 쿼리에 모두 붙지 않았다');
  assert.ok(/sggCd: \{ notIn:/.test(src), 'canonical 코드가 아니라 다른 기준으로 거른다');
});

test('§11 alias fallback이 검색 필터를 우회하지 못한다', () => {
  const src = read('src/lib/search-alias-fallback.ts');
  assert.ok(/isSeoulPublicBlocked\(m\.sggCd\)/.test(src), 'alias 경로에 지역 게이트가 없다');
  // 차단 시 다음 POI로 넘어가면 다른 지역 단지를 집어올 수 있다 — 즉시 null이어야 한다.
  const idx = src.indexOf('isSeoulPublicBlocked(m.sggCd)');
  assert.ok(/return null;/.test(src.slice(idx, idx + 260)), '차단 후 즉시 중단하지 않는다');
});

test('§12 상세 라우트가 canonical lawdCd로 게이트한다(이름 아님)', () => {
  const src = read('src/app/api/apt/[name]/route.ts');
  assert.ok(/if \(isSeoulPublicBlocked\(lawdCd\)\)/.test(src), '상세에 접근 게이트가 없다');
  assert.ok(/reason: 'UNSUPPORTED_REGION'/.test(src));
  // import 줄이 아니라 **실제 호출부**와 비교한다.
  assert.ok(
    src.indexOf('isSeoulPublicBlocked(lawdCd)') < src.indexOf('fetchMolitMonthCached({'),
    '게이트가 MOLIT 호출 뒤에 있다'
  );
});

test('§13 리포트 라우트가 aptSeq 앞 5자리로 게이트한다', () => {
  const src = read('src/app/report/apt/[aptSeq]/page.tsx');
  assert.ok(/isSeoulPublicBlocked\(id\.slice\(0, 5\), 'report'\)/.test(src), '리포트 게이트가 없다');
  assert.ok(
    src.indexOf('isSeoulPublicBlocked') < src.indexOf('readApartmentReport(id)'),
    '게이트가 리포트 read 뒤에 있다'
  );
});

test('§14 지역 선택 모달이 시도·시군구 두 목록 모두 거른다', () => {
  const src = read('src/components/RegionSelectModal.tsx');
  assert.ok(/isSidoPubliclyHidden\(s\.code\.substring\(0, 2\)\)/.test(src), '시도 목록이 안 걸러진다');
  assert.ok(/isSeoulPublicBlocked\(item\.code\.substring\(0, 5\)\)/.test(src), '시군구 목록이 안 걸러진다');
  assert.ok(/isSidoPartiallyPublic\(sidoCode\)/.test(src), '"시도 전체" 핸들러 가드가 없다');
});

test('§15 supply 라우트가 서울 전체 집계를 막고 구 단위로만 판정한다', () => {
  const src = read('src/app/api/stats/supply/route.ts');
  assert.ok(/sidoShort === SEOUL_SHORT/.test(src), 'supply에 서울 분기가 없다');
  assert.ok(/isSeoulPublicBlocked\(node\.lawdCd\)/.test(src), 'canonical 코드로 판정하지 않는다');
  assert.ok(/!node \|\| isSeoulPublicBlocked/.test(src), '구 미지정(서울 전체) 요청이 통과한다');
});

test('§16 어떤 게이트도 접두사 판정을 쓰지 않는다', () => {
  for (const p of [
    'src/app/api/search/route.ts',
    'src/lib/search-alias-fallback.ts',
    'src/app/api/apt/[name]/route.ts',
    'src/app/report/apt/[aptSeq]/page.tsx',
    'src/components/RegionSelectModal.tsx',
    'src/app/api/stats/supply/route.ts',
    'src/lib/region/enablement.ts',
  ]) {
    assert.ok(!/startsWith\('11'\)/.test(readCode(p)), `${p}가 접두사로 서울을 판정한다`);
  }
});

test('§17 allowlist 정적 소속 판정은 스위치와 무관하다', () => {
  assert.equal(isSeoulBetaDistrict('11140'), true);
  assert.equal(isSeoulBetaDistrict('11680'), false);
  assert.equal(isSeoulBetaDistrict('26140'), false);
});
