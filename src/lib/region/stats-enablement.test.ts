import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isTradeDbFirstSido, isTradeDbFirstLawdCd,
  isStatsEnabledSido, getStatsEnabledSidoCodes, getTradeDbFirstSidoCodes,
  getSidoEnablement,
} from './enablement';
import { FEED_DB_SIDO_CODE, isFeedDbBackedSido } from '../stats/feed-db-source';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';

// STATS_REGION_ENABLEMENT_MIGRATION_V1 — stats 지역 판정이 registry/enablement에서
// 나오는지, 그리고 그 의미가 마이그레이션 전과 **완전히 동일**한지 고정한다.
//
// 핵심: 여기서 다루는 판정은 "출시 여부"가 아니라 "DB-first 적격 여부"다.
// 비부산 요청은 예나 지금이나 live 경로로 정상 처리된다(이 테스트가 그 구분을 지킨다).

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'));

const STATS_ROUTES = [
  'src/app/api/stats/dashboard/route.ts',
  'src/app/api/stats/price-rankings/route.ts',
  'src/app/api/stats/region-change/route.ts',
  'src/app/api/stats/yearly/route.ts',
  'src/app/api/stats/large-complex/route.ts',
  'src/app/api/transactions/route.ts',
  'src/lib/stats/feed-db-source.ts',
];

// ── 1~3. 부산은 DB-first 그대로 ───────────────────────────────────────────

test('1 · 부산 시도 전체는 DB-first 적격', () => {
  assert.equal(isTradeDbFirstSido('26'), true);
  assert.deepEqual([...getTradeDbFirstSidoCodes()], ['26']);
});

test('2 · 부산 16개 구·군 전부 DB-first 적격(마이그레이션 전 startsWith("26")과 동일)', () => {
  for (const code of BUSAN_LAWDCD_16) {
    assert.equal(isTradeDbFirstLawdCd(code), true, code);
  }
  assert.equal(BUSAN_LAWDCD_16.length, 16);
});

test('3 · 대표 구(서구·해운대구·연제구)도 동일', () => {
  for (const code of ['26140', '26350', '26470']) assert.equal(isTradeDbFirstLawdCd(code), true, code);
});

// ── 4~8. 서울/경기/미지 지역은 DB-first가 아니다(= live 경로 유지) ─────────

test('4 · 서울 강남구는 DB-first가 아니다 — 부산 DB로 답하지 않는다', () => {
  assert.equal(isTradeDbFirstLawdCd('11680'), false);
  assert.equal(isTradeDbFirstSido('11'), false);
});

test('5 · 서울 송파구도 동일', () => {
  assert.equal(isTradeDbFirstLawdCd('11710'), false);
});

test('6 · 경기 성남시 분당구는 DB-first가 아니다', () => {
  assert.equal(isTradeDbFirstLawdCd('41135'), false);
  assert.equal(isTradeDbFirstSido('41'), false);
});

test('7 · 경기 김포시도 동일', () => {
  assert.equal(isTradeDbFirstLawdCd('41570'), false);
});

test('8 · registry에 없는 코드는 DB-first가 아니다(접두사 추측 금지)', () => {
  // 27110(대구 중구)/11680은 실제로 trade DB에 파일럿 행이 있지만 DB-first 대상이 아니다.
  for (const code of ['27110', '99999', '26999', '', null, undefined]) {
    assert.equal(isTradeDbFirstLawdCd(code), false, String(code));
  }
});

// ── 9. 부산 fallback 없음 ─────────────────────────────────────────────────

test('9 · 비부산 판정이 부산으로 떨어지지 않는다(어떤 축도 true가 되지 않음)', () => {
  for (const sido of ['11', '41', '27', '99']) {
    const e = getSidoEnablement(sido);
    assert.deepEqual(e, { app: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false }, sido);
  }
});

// ── 10. feed ──────────────────────────────────────────────────────────────

test('10 · feed가 registry/enablement에서 시도 컨텍스트를 가져온다', () => {
  assert.equal(FEED_DB_SIDO_CODE, '26', '기존 계약 값 유지');
  assert.equal(isFeedDbBackedSido('26'), true);
  assert.equal(isFeedDbBackedSido('11'), false);
  assert.equal(isFeedDbBackedSido('41'), false);
  assert.equal(isFeedDbBackedSido(null), false);
  const src = read('src/lib/stats/feed-db-source.ts');
  assert.ok(!/=\s*'26'/.test(src), 'feed에 26 리터럴이 남아 있다');
});

// ── 11. DB-first parity (소스 계약) ───────────────────────────────────────

test('11 · DB-first 분기가 registry/enablement를 쓰고, 접두사 비교가 사라졌다', () => {
  for (const rel of STATS_ROUTES) {
    const src = read(rel);
    assert.ok(!/BUSAN_SIDO_CODE/.test(src), `${rel}에 BUSAN_SIDO_CODE가 남아 있다`);
    assert.ok(!/startsWith\(['"]26['"]\)/.test(src), `${rel}에 '26' 접두사 비교가 남아 있다`);
    assert.ok(!/===\s*['"]26['"]/.test(src), `${rel}에 '26' 동등 비교가 남아 있다`);
  }
});

test('11b · 각 라우트가 실제로 enablement helper를 호출한다', () => {
  const expectations: Array<[string, RegExp]> = [
    ['src/app/api/stats/dashboard/route.ts', /isTradeDbFirst(Sido|LawdCd)\(/],
    ['src/app/api/stats/price-rankings/route.ts', /isTradeDbFirst(Sido|LawdCd)\(/],
    ['src/app/api/stats/region-change/route.ts', /isTradeDbFirst(Sido|LawdCd)\(/],
    ['src/app/api/stats/yearly/route.ts', /isTradeDbFirstLawdCd\(/],
    ['src/app/api/transactions/route.ts', /isTradeDbFirstLawdCd\(/],
    ['src/app/api/stats/large-complex/route.ts', /isStatsEnabledSido\(/],
    ['src/lib/stats/feed-db-source.ts', /isTradeDbFirstSido\(/],
  ];
  for (const [rel, re] of expectations) assert.match(read(rel), re, rel);
});

// ── 14. large-complex ─────────────────────────────────────────────────────

test('14 · large-complex는 지원 시도만 통과시키고 나머지는 UNSUPPORTED 유지', () => {
  assert.equal(isStatsEnabledSido('26'), true);
  for (const sido of ['11', '41', '27', '99', null]) assert.equal(isStatsEnabledSido(sido), false, String(sido));
  assert.deepEqual([...getStatsEnabledSidoCodes()], ['26']);
  const src = read('src/app/api/stats/large-complex/route.ts');
  assert.match(src, /status: 'UNSUPPORTED'/, 'UNSUPPORTED 계약이 유지돼야 한다');
  assert.ok(!/sido: '부산'/.test(src), "where 절의 '부산' 리터럴이 남아 있다");
});

// ── 15~16. 정책 단일화 ───────────────────────────────────────────────────

test('15 · 출시(stats)와 DB-first(cronSync)가 서로 다른 축으로 분리돼 있다', () => {
  // 지금은 부산에서 둘 다 true지만, 이름과 경로가 달라야 나중에 따로 열 수 있다.
  const busan = getSidoEnablement('26');
  assert.equal(busan.stats, true);
  assert.equal(busan.cronSync, true);
  const src = read('src/lib/region/enablement.ts');
  assert.match(src, /isTradeDbFirstSido/);
  assert.match(src, /isStatsEnabledSido/);
  assert.ok(!/=\s*'26'/.test(src), 'enablement에 26 리터럴이 하드코딩돼 있다');
});

test('16 · 지역 정책이 registry/enablement 한 곳에서만 나온다(stats 영역 재선언 0)', () => {
  for (const rel of STATS_ROUTES) {
    const src = read(rel);
    assert.ok(
      !/const\s+\w*SIDO_CODE\w*\s*=\s*['"]\d{2}['"]/.test(src),
      `${rel}가 시도 코드를 자체 상수로 다시 선언했다`
    );
  }
});
