import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getPeerContext } from './peer-context';
import type { PeerUniverseRow } from './peer-context-pure';

// REGION_CONTEXT_PARAMETERIZATION_V1 — peer pool이 대상 단지의 시도를 따라가는지,
// 그리고 지역을 모를 때 어떤 지역으로도 fallback하지 않는지 검증한다.
//
// getPeerContext는 DB/캐시를 쓰지만 universe 로더를 주입할 수 있으므로, 여기서는
// 시도별 fixture universe를 주입해 **어떤 시도로 조회가 나가는지**와 결과를 확인한다.

/** 주입 로더 — 요청된 시도를 기록하고, 그 시도의 fixture만 돌려준다. */
function loaderFor(universes: Record<string, PeerUniverseRow[]>) {
  const asked: string[] = [];
  const loadUniverse = async (sido: string) => {
    asked.push(sido);
    return universes[sido] ?? [];
  };
  return { loadUniverse, asked };
}

const row = (aptSeq: string, sigungu: string, buildYear: number, households: number, v2Score: number): PeerUniverseRow =>
  ({ aptSeq, sigungu, buildYear, totalHouseholds: households, v2Score });

/** 한 시군구·연식대·규모에 충분한 표본을 만든다(L1에서 바로 확정되도록). */
const poolOf = (n: number, sigungu: string, prefix: string) =>
  Array.from({ length: n }, (_, i) => row(`${prefix}-${i}`, sigungu, 2015, 100, 40 + i));

const UNIVERSES: Record<string, PeerUniverseRow[]> = {
  부산: [...poolOf(30, '서구', 'busan-seogu'), ...poolOf(30, '해운대구', 'busan-haeundae')],
  서울: [...poolOf(30, '강남구', 'seoul-gangnam'), ...poolOf(30, '송파구', 'seoul-songpa')],
  경기: [...poolOf(30, '성남시 분당구', 'gg-bundang'), ...poolOf(30, '김포시', 'gg-gimpo')],
};

const target = (aptSeq: string, sigungu: string) =>
  ({ aptSeq, sigungu, buildYear: 2015, totalHouseholds: 100, v2Score: 55 });

// ── 1~2. 부산 context ──────────────────────────────────────────────────────

test('1 · 부산 서구 단지는 부산 universe로 비교한다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('busan-seogu-x', '서구'), '부산', { loadUniverse });
  assert.deepEqual(asked, ['부산'], '부산 universe만 조회해야 한다');
  assert.equal(ctx.available, true);
  assert.equal(ctx.basis?.sigungu, '서구');
});

test('2 · 부산 해운대구 단지도 부산 universe를 쓴다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('busan-hd-x', '해운대구'), '부산', { loadUniverse });
  assert.deepEqual(asked, ['부산']);
  assert.equal(ctx.available, true);
  assert.equal(ctx.basis?.sigungu, '해운대구');
});

// ── 3~4. 서울 context ──────────────────────────────────────────────────────

test('3 · 서울 강남구 단지는 서울 universe로 비교한다 — 부산 pool을 쓰지 않는다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('seoul-gangnam-x', '강남구'), '서울', { loadUniverse });
  assert.deepEqual(asked, ['서울'], '서울 단지가 부산 universe를 조회하면 안 된다');
  assert.ok(!asked.includes('부산'));
  assert.equal(ctx.available, true);
  assert.equal(ctx.basis?.sigungu, '강남구');
});

test('4 · 서울 송파구 단지도 서울 context가 전파된다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('seoul-songpa-x', '송파구'), '서울', { loadUniverse });
  assert.deepEqual(asked, ['서울']);
  assert.equal(ctx.basis?.sigungu, '송파구');
});

// ── 5~6. 경기 context (시+일반구 계층 보존) ────────────────────────────────

test('5 · 경기 성남시 분당구는 경기 universe를 쓰고 시+구 표기가 보존된다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('gg-bundang-x', '성남시 분당구'), '경기', { loadUniverse });
  assert.deepEqual(asked, ['경기']);
  assert.ok(!asked.includes('부산'));
  assert.equal(ctx.basis?.sigungu, '성남시 분당구', '시+일반구 계층이 잘리면 안 된다');
});

test('6 · 경기 김포시(단일 시)도 동일하게 동작한다', async () => {
  const { loadUniverse, asked } = loaderFor(UNIVERSES);
  const ctx = await getPeerContext(target('gg-gimpo-x', '김포시'), '경기', { loadUniverse });
  assert.deepEqual(asked, ['경기']);
  assert.equal(ctx.basis?.sigungu, '김포시');
});

// ── 7. 지역 미확정 → 조용한 fallback 금지 ──────────────────────────────────

test('7 · 시도를 모르면 어떤 지역으로도 fallback하지 않고 비교 불가를 돌려준다', async () => {
  for (const missing of [null, '', '   ']) {
    const { loadUniverse, asked } = loaderFor(UNIVERSES);
    const ctx = await getPeerContext(target('unknown-x', '어딘가'), missing, { loadUniverse });
    assert.equal(ctx.available, false, `sido=${JSON.stringify(missing)} 이면 비교하지 않는다`);
    assert.equal(ctx.percentile, null);
    assert.equal(ctx.confidence, 'NOT_AVAILABLE');
    assert.deepEqual(asked, [], '지역을 모르면 universe 조회 자체를 하지 않는다');
  }
});

// ── 10~11. 타 지역 pool 오염 금지 ──────────────────────────────────────────

test('10 · 서울 단지의 percentile이 부산 pool에 영향받지 않는다', async () => {
  // 부산 pool은 점수를 아주 높게, 서울 pool은 아주 낮게 둔다. 같은 target 점수라도
  // 어느 pool을 쓰느냐에 따라 percentile이 완전히 달라진다.
  const universes: Record<string, PeerUniverseRow[]> = {
    부산: Array.from({ length: 30 }, (_, i) => row(`b-${i}`, '강남구', 2015, 100, 90 + (i % 5))),
    서울: Array.from({ length: 30 }, (_, i) => row(`s-${i}`, '강남구', 2015, 100, 10 + (i % 5))),
  };
  const { loadUniverse } = loaderFor(universes);
  const ctx = await getPeerContext(target('seoul-x', '강남구'), '서울', { loadUniverse });
  assert.equal(ctx.available, true);
  assert.ok(
    (ctx.percentile ?? 0) > 50,
    `서울 pool(낮은 점수들) 기준이면 상위권이어야 한다 — 부산 pool을 썼다면 하위권이 된다 (percentile=${ctx.percentile})`
  );
});

test('11 · 경기 단지도 부산 pool을 쓰지 않는다', async () => {
  const universes: Record<string, PeerUniverseRow[]> = {
    부산: Array.from({ length: 30 }, (_, i) => row(`b-${i}`, '김포시', 2015, 100, 95)),
    경기: Array.from({ length: 30 }, (_, i) => row(`g-${i}`, '김포시', 2015, 100, 10 + (i % 5))),
  };
  const { loadUniverse, asked } = loaderFor(universes);
  const ctx = await getPeerContext(target('gg-x', '김포시'), '경기', { loadUniverse });
  assert.deepEqual(asked, ['경기']);
  assert.ok((ctx.percentile ?? 0) > 50);
});

// ── 8·9·12·13. 소스 계약 — 하드코딩/전파 ───────────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
const read = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), rel), 'utf8'));

test('8 · 런타임 코드에 강남구(11680) 기본값이 남아 있지 않다', () => {
  const runtime = [
    'src/app/api/apt/[name]/route.ts',
    'src/app/api/apt/[name]/info/route.ts',
    'src/app/apt/[name]/apt-client.tsx',
    'src/components/RankCard.tsx',
    'src/components/TableList.tsx',
  ];
  for (const rel of runtime) {
    const src = read(rel);
    assert.ok(!/'11680'|"11680"/.test(src), `${rel} 에 11680 기본값이 남아 있다`);
  }
});

test('9 · peer-context에 시도 하드코딩/기본값이 없다(부산 parity는 호출부가 전달)', () => {
  const src = read('src/lib/apartment-score/peer-context.ts');
  assert.ok(!/SIDO_VALUE/.test(src), '시도 상수가 남아 있다');
  assert.ok(!/sido:\s*'부산'|sido\s*\?\?\s*'부산'|=\s*'부산'/.test(src), "'부산' 기본값/fallback이 남아 있다");
  assert.match(src, /regionSido/, '시도를 명시적으로 받아야 한다');
  assert.match(src, /if \(!sido\) return UNAVAILABLE_PEER_CONTEXT;/, '시도를 모르면 비교하지 않는다');
});

test('12 · compare 경로가 시도를 전달한다', () => {
  const src = read('src/lib/report/compare-read.ts');
  assert.match(src, /getPeerContext\(\{[\s\S]*?\},\s*master\.sido\)/, 'compare가 master.sido를 넘겨야 한다');
  assert.match(src, /sido: true/, 'master select에 sido가 포함돼야 한다');
});

test('13 · detail(상세/리포트) 경로가 시도를 전달한다', () => {
  const route = read('src/app/api/apt/[name]/score/route.ts');
  assert.match(route, /getPeerContext\(\{[\s\S]*?\},\s*targetMaster\.sido\)/, 'score 라우트가 sido를 넘겨야 한다');
  assert.match(route, /sido: true/);
  const aptRead = read('src/lib/report/apt-read.ts');
  assert.match(aptRead, /getPeerContext\(\{[\s\S]*?\},\s*target\.sido\)/, 'report apt-read가 sido를 넘겨야 한다');
  assert.match(aptRead, /sido: true/);
});

test('추가 · 지역 미확정 시 라우트가 잘못된 지역 데이터 대신 명시적 상태를 돌려준다', () => {
  const route = read('src/app/api/apt/[name]/route.ts');
  assert.match(route, /regionUnresolved: true/, '지역 미확정을 명시적으로 표현해야 한다');
  assert.match(route, /trades: \[\]/, '잘못된 지역 거래를 채우지 않는다');
  const info = read('src/app/api/apt/[name]/info/route.ts');
  assert.match(info, /regionUnresolved: true/);
});
