import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEOUL_BETA_LAWDCDS,
  SEOUL_BETA_ENABLED,
  isBetaAllowlistedLawdCd,
  getRegionEnablement,
  getSidoEnablement,
  getEnabledRegions,
  getEnabledSidoCodes,
  getStatsEnabledSidoCodes,
  getTradeDbFirstSidoCodes,
  isStatsEnabledLawdCd,
  isTradeDbFirstLawdCd,
  isTradeDbFirstSido,
} from './enablement';
import { SEOUL_SALE_SYNC_LAWDCDS } from '../sync/sale-sync-scope';
import { REGION_NODES, getMolitLeafRegions } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { isStatsRegionSupported } from './stats-gate';

// SEOUL_MOBILE_BETA_PREP_V1 — 시군구 allowlist 계약. 런타임은 **꺼진 채로** 유지된다.

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const SEOUL_NON_BETA = REGION_NODES
  .filter((n) => n.sidoCode === '11' && !(SEOUL_BETA_LAWDCDS as readonly string[]).includes(n.lawdCd))
  .map((n) => n.lawdCd);

test('§1 allowlist는 정확히 승인된 8개 구다(중복 없음, 강남 없음)', () => {
  assert.equal(SEOUL_BETA_LAWDCDS.length, 8);
  assert.equal(new Set<string>(SEOUL_BETA_LAWDCDS).size, 8);
  assert.ok(!(SEOUL_BETA_LAWDCDS as readonly string[]).includes('11680'), '강남 11680이 들어 있다');
  assert.deepEqual(
    [...SEOUL_BETA_LAWDCDS].sort(),
    ['11110', '11140', '11170', '11215', '11230', '11410', '11440', '11545']
  );
});

test('§2 allowlist는 cron scope(전체 이력+검증 완료 구)와 **같은 집합**이다', () => {
  // 두 목록이 갈라지면 "동기화는 하는데 노출은 안 되는" 혹은 그 반대의 구가 생긴다.
  assert.deepEqual([...SEOUL_BETA_LAWDCDS].sort(), [...SEOUL_SALE_SYNC_LAWDCDS].sort());
});

test('§3 allowlist의 8구는 전부 registry에 있는 서울 MOLIT leaf다', () => {
  const byCode = new Map(REGION_NODES.map((n) => [n.lawdCd, n]));
  for (const code of SEOUL_BETA_LAWDCDS) {
    const node = byCode.get(code);
    assert.ok(node, `${code}가 registry에 없다`);
    assert.equal(node!.sidoCode, '11');
    assert.equal(node!.isMolitLeaf, true);
    assert.ok(node!.name.endsWith('구'), `${code} 이름이 이상하다: ${node!.name}`);
  }
});

test('§4 서울 나머지 17구는 allowlist 밖이다', () => {
  assert.equal(SEOUL_NON_BETA.length, 17);
  assert.ok(SEOUL_NON_BETA.includes('11680'), '강남이 비-beta 목록에 없다');
  for (const code of SEOUL_NON_BETA) {
    assert.ok(!(SEOUL_BETA_LAWDCDS as readonly string[]).includes(code));
  }
});

// ── 런타임 상태: 지금은 꺼져 있어야 한다 ─────────────────────────────────────

test('§5 마스터 스위치가 꺼져 있다 — 서울은 모든 축에서 닫힘', () => {
  assert.equal(SEOUL_BETA_ENABLED, false, 'beta 스위치가 켜진 채 커밋됐다');
  const allFalse = { app: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false };
  for (const code of [...SEOUL_BETA_LAWDCDS, ...SEOUL_NON_BETA]) {
    assert.deepEqual(getRegionEnablement(code), allFalse, `${code}가 열려 있다`);
    assert.equal(isBetaAllowlistedLawdCd(code), false, `${code}가 allowlist에 적중한다`);
    assert.equal(isStatsEnabledLawdCd(code), false);
    assert.equal(isTradeDbFirstLawdCd(code), false);
  }
});

test('§6 시도 층은 건드리지 않았다 — "서울 전체" 요청은 계속 거부된다', () => {
  // 이것이 안전의 핵심이다: sidoCode=11 / ?sido=서울특별시 경로는 시도 층만 보므로
  // 시군구 allowlist가 켜지더라도 시도 전체 질의는 열리지 않는다.
  const allFalse = { app: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false };
  assert.deepEqual(getSidoEnablement('11'), allFalse);
  assert.equal(isTradeDbFirstSido('11'), false);
  assert.equal(isStatsRegionSupported({ lawdCd: null, sidoCode: '11', sidoName: null }), false);
  assert.equal(isStatsRegionSupported({ lawdCd: null, sidoCode: null, sidoName: '서울특별시' }), false);
});

test('§7 부산 16구는 이 변경의 영향을 받지 않는다(무회귀)', () => {
  const allTrue = { app: true, report: true, stats: true, sitemap: true, seoIndex: true, cronSync: true };
  for (const code of BUSAN_LAWDCD_16) {
    assert.deepEqual(getRegionEnablement(code), allTrue, `부산 ${code}가 닫혔다`);
  }
  assert.deepEqual(getEnabledSidoCodes(), ['26']);
  assert.deepEqual(getStatsEnabledSidoCodes(), ['26']);
  assert.deepEqual(getTradeDbFirstSidoCodes(), ['26']);
});

test('§8 축별 열린 지역 수는 여전히 부산 16구뿐', () => {
  for (const axis of ['app', 'report', 'stats', 'sitemap', 'seoIndex', 'cronSync'] as const) {
    const open = getEnabledRegions(axis, REGION_NODES);
    assert.equal(open.length, 16, `${axis} 축이 16개가 아니다`);
    assert.ok(open.every((n) => n.sidoCode === '26'), `${axis} 축에 비부산이 있다`);
  }
  assert.equal(getMolitLeafRegions().filter((n) => getRegionEnablement(n.lawdCd).cronSync).length, 16);
});

// ── 소스 수준 가드 ───────────────────────────────────────────────────────────

test('§9 시도 map에 서울이 추가되지 않았다(시군구 층으로만 연다)', () => {
  const src = read('src/lib/region/enablement.ts');
  assert.ok(/'26': BUSAN_ENABLED/.test(src), '부산 시도 엔트리가 사라졌다');
  assert.ok(!/^\s*'11'\s*:/m.test(src), "ENABLEMENT_BY_SIDO에 '11'이 추가됐다 — 서울 25구가 통째로 열린다");
  assert.ok(!/^\s*'41'\s*:/m.test(src), "ENABLEMENT_BY_SIDO에 '41'이 추가됐다");
});

test('§10 getEnabledRegions가 시군구 단위로 판정한다(시도 단위면 일부 개방이 불가능)', () => {
  const src = read('src/lib/region/enablement.ts');
  assert.ok(
    /return nodes\.filter\(\(n\) => getRegionEnablement\(n\.lawdCd\)\[feature\]\);/.test(src),
    'getEnabledRegions가 아직 시도 단위로 판정한다'
  );
});
