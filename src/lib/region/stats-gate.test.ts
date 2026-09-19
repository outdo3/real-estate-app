import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isStatsRegionSupported,
  isStatsUnsupportedResponse,
  statsUnsupportedStatusBody,
  statsUnsupportedSuccessBody,
  STATS_UNSUPPORTED_REASON,
  type StatsRegionQuery,
} from './stats-gate';
import { isStatsEnabledLawdCd, isTradeDbFirstLawdCd } from './enablement';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';

// NON_BUSAN_STATS_TRUST_GATE_V1 — 통계는 enablement의 `stats` 축이 열린 지역(부산)에서만 동작한다.
// 비부산 요청은 캐시·DB·MOLIT·법정동 프록시에 닿기 전에 "준비 중"으로 돌아가야 하고, 그것이
// 오류(500/error_logs)나 "0건"으로 보이면 안 된다.
//
// 라우트 테스트는 실제 GET 핸들러를 부른다. fetch(MOLIT·법정동 프록시)와 Prisma 싱글턴을
// **호출되면 기록하고 던지는** 대역으로 바꿔 두므로, 게이트가 새면 호출 기록이 남는다.

const q = (lawdCd: string | null, sidoCode: string | null = null, sidoName: string | null = null): StatsRegionQuery => ({ lawdCd, sidoCode, sidoName });

const SEOUL_GYEONGGI = [
  ['11680', '서울 강남구'],
  ['11710', '서울 송파구'],
  ['41135', '경기 성남시 분당구'],
  ['41570', '경기 김포시'],
] as const;

// ── 게이트 판정(순수) ─────────────────────────────────────────────────────

test('B1 · 부산은 시도 전체·16개 구·기본값(이름 경로) 모두 통과', () => {
  assert.equal(isStatsRegionSupported(q(null, '26')), true);
  for (const code of BUSAN_LAWDCD_16) assert.equal(isStatsRegionSupported(q(code)), true, code);
  // lawdCd/sidoCode가 없으면 라우트는 resolveLawdCd('부산광역시', '서구')로 간다 — 기본 진입.
  assert.equal(isStatsRegionSupported(q(null, null, '부산광역시')), true);
  // lawdCd가 형식 오류면 라우트는 이름 경로로 떨어진다 — 같은 순서를 따른다.
  assert.equal(isStatsRegionSupported(q('null', '11', '부산광역시')), true);
});

test('5~8 · 서울 강남·송파, 경기 분당·김포는 막힌다(시군구·시도 전체·이름 경로 모두)', () => {
  for (const [code, label] of SEOUL_GYEONGGI) {
    assert.equal(isStatsRegionSupported(q(code)), false, label);
    assert.equal(isStatsEnabledLawdCd(code), false, label);
  }
  assert.equal(isStatsRegionSupported(q(null, '11')), false);
  assert.equal(isStatsRegionSupported(q(null, '41')), false);
  assert.equal(isStatsRegionSupported(q(null, null, '서울특별시')), false);
  assert.equal(isStatsRegionSupported(q(null, null, '경기도')), false);
});

test('9 · 모르는 지역(대구·미등록 코드·미등록 부산 접두사·빈 값)은 막힌다 — 접두사로 추측하지 않는다', () => {
  for (const code of ['27110', '99999', '26999', '26000']) assert.equal(isStatsRegionSupported(q(code)), false, code);
  for (const sido of ['27', '99', '00']) assert.equal(isStatsRegionSupported(q(null, sido)), false, sido);
  assert.equal(isStatsRegionSupported(q(null, null, '대구광역시')), false);
  assert.equal(isStatsRegionSupported(q(null, null, null)), false);
  // lawdCd가 있으면 sidoCode보다 우선한다 — 부산 sidoCode를 붙여도 서울 lawdCd는 통과하지 못한다.
  assert.equal(isStatsRegionSupported(q('11680', '26')), false);
});

test('15 · 미래 활성화 fixture — stats 축만 열면 같은 판정이 서울을 통과시킨다(별도 분기 없음)', () => {
  const seoulOpened = (code: string | null | undefined) => code === '26' || code === '11';
  assert.equal(isStatsRegionSupported(q('11680'), seoulOpened), true);
  assert.equal(isStatsRegionSupported(q('11710'), seoulOpened), true);
  assert.equal(isStatsRegionSupported(q(null, '11'), seoulOpened), true);
  assert.equal(isStatsRegionSupported(q(null, null, '서울특별시'), seoulOpened), true);
  // 서울만 열었을 때 경기는 여전히 닫혀 있다 — 한 시도를 여는 것이 다른 시도를 열지 않는다.
  assert.equal(isStatsRegionSupported(q('41135'), seoulOpened), false);
  assert.equal(isStatsRegionSupported(q(null, '41'), seoulOpened), false);
  // registry에 없는 코드는 predicate가 무엇이든 닫힘이다.
  assert.equal(isStatsRegionSupported(q('99999'), () => true), false);
});

test('15b · 게이트 뒤의 라우팅은 여전히 DB 보유(cronSync) 축을 따른다 — 서울을 열 때는 두 축을 함께 연다', () => {
  // 부산은 두 축 모두 열려 있어 게이트 통과 후 DB-first 경로를 탄다.
  assert.equal(isTradeDbFirstLawdCd('26140'), true);
  // 서울은 아직 두 축 모두 닫혀 있다. stats만 열고 cronSync를 닫아 두면 live 경로로 떨어지므로,
  // enablement.ts에서 서울을 열 때는 DB 적재 완료와 함께 두 축을 같이 연다(문서화된 운영 규칙).
  assert.equal(isTradeDbFirstLawdCd('11680'), false);
  const src = readFileSync(path.join(process.cwd(), 'src/lib/region/enablement.ts'), 'utf8');
  assert.match(src, /'26': BUSAN_ENABLED/);
  assert.ok(!/^\s*'11'\s*:/m.test(src), '서울이 enablement에 활성화돼 있다 — 이번 STEP 범위 밖');
  assert.ok(!/^\s*'41'\s*:/m.test(src), '경기가 enablement에 활성화돼 있다 — 이번 STEP 범위 밖');
});

test('13 · 응답 계약 — 준비 중은 0건도 오류도 아니다', () => {
  for (const body of [statsUnsupportedStatusBody(), statsUnsupportedSuccessBody()]) {
    assert.equal(body.supported, false);
    assert.equal(body.reason, STATS_UNSUPPORTED_REASON);
    assert.ok(body.message.includes('준비 중'));
    // "0건"으로 읽힐 수 있는 필드를 싣지 않는다.
    for (const k of ['data', 'rows', 'items', 'groups', 'entries', 'summary', 'total', 'overall', 'apiError']) {
      assert.ok(!(k in body), `unsupported 응답에 ${k}가 있다`);
    }
    assert.equal(isStatsUnsupportedResponse(body), true);
  }
  assert.equal(statsUnsupportedStatusBody().status, 'UNSUPPORTED');
  assert.equal(statsUnsupportedSuccessBody().success, false);
  // 안내용 지원 시도는 부산이지만, 부산 데이터는 싣지 않는다(12 · fallback 없음).
  assert.equal(statsUnsupportedStatusBody().supportedSidoCode, '26');
  // 정상/오류/0건 응답은 unsupported로 오인되지 않는다.
  assert.equal(isStatsUnsupportedResponse({ status: 'OK', rows: [] }), false);
  assert.equal(isStatsUnsupportedResponse({ status: 'ERROR', message: 'x' }), false);
  assert.equal(isStatsUnsupportedResponse({ success: false, error: 'API Error' }), false);
  assert.equal(isStatsUnsupportedResponse(null), false);
});

// ── 라우트 — 실제 핸들러 호출 ─────────────────────────────────────────────

type Handler = (req: Request) => Promise<Response>;
const calls = { fetch: [] as string[], prisma: [] as string[], consoleError: 0 };
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const g = globalThis as unknown as { prisma?: unknown };
const originalPrisma = g.prisma;
const routes: Record<string, Handler> = {};

before(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.fetch.push(String(input));
    throw new Error('network disabled in test');
  }) as typeof fetch;
  // lib/prisma.ts는 globalThis.prisma가 있으면 그걸 싱글턴으로 쓴다(Prisma 권장 패턴).
  // 어떤 모델/메서드에 닿든 기록하고 던진다 — error_logs 기록(prisma.errorLog.create)도 여기 걸린다.
  const recorder = (pathSoFar: string): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : recorder(`${pathSoFar}.${String(prop)}`)),
      apply: () => {
        calls.prisma.push(pathSoFar);
        throw new Error(`db disabled in test: ${pathSoFar}`);
      },
    });
  g.prisma = recorder('prisma');
  console.error = () => {
    calls.consoleError += 1;
  };
  const load = async (name: string) => ((await import(`../../app/api/stats/${name}/route`)) as { GET: Handler }).GET;
  for (const name of ['dashboard', 'yearly', 'price-rankings', 'region-change', 'feed', 'concentration', 'gap-invest', 'rankings', 'large-complex']) {
    routes[name] = await load(name);
  }
});

after(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  g.prisma = originalPrisma;
});

function resetCalls() {
  calls.fetch.length = 0;
  calls.prisma.length = 0;
  calls.consoleError = 0;
}

async function call(route: string, query: string) {
  const started = performance.now();
  const res = await routes[route](new Request(`http://localhost/api/stats/${route}?${query}`));
  const elapsedMs = performance.now() - started;
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, elapsedMs };
}

const NON_BUSAN_CASES: Array<[string, string]> = [];
for (const [code] of SEOUL_GYEONGGI) {
  NON_BUSAN_CASES.push(
    ['dashboard', `lawdCd=${code}`],
    ['yearly', `lawdCd=${code}`],
    ['price-rankings', `mode=record-high&lawdCd=${code}`],
    ['price-rankings', `mode=area84&lawdCd=${code}`],
    ['price-rankings', `mode=jeonse-risk&lawdCd=${code}`],
    ['region-change', `level=dong&lawdCd=${code}`],
    ['region-change', `level=complex&lawdCd=${code}`],
    ['feed', `lawdCd=${code}&period=7d`],
    ['concentration', `lawdCd=${code}`],
    ['gap-invest', `lawdCd=${code}`],
    ['rankings', `lawdCd=${code}`],
    ['large-complex', `sidoCode=${code.slice(0, 2)}&lawdCd=${code}`],
  );
}
for (const sido of ['11', '41', '27']) {
  NON_BUSAN_CASES.push(
    ['dashboard', `sidoCode=${sido}`],
    ['price-rankings', `mode=decline&sidoCode=${sido}`],
    ['region-change', `level=sigungu&sidoCode=${sido}`],
    ['feed', `sidoCode=${sido}&period=12m`],
    ['concentration', `sidoCode=${sido}`],
    ['gap-invest', `sidoCode=${sido}`],
    ['rankings', `sidoCode=${sido}`],
    ['large-complex', `sidoCode=${sido}`],
  );
}
// 이름 경로(구 공유 링크 형태)와 미등록 코드
NON_BUSAN_CASES.push(
  ['dashboard', `sido=${encodeURIComponent('서울특별시')}&gungu=${encodeURIComponent('강남구')}`],
  ['yearly', `sido=${encodeURIComponent('경기도')}&gungu=${encodeURIComponent('김포시')}`],
  ['yearly', 'lawdCd=26999'],
  ['dashboard', 'lawdCd=99999'],
  // 시도는 부산인데 시군구가 서울 — 부산 필터에 서울 코드가 걸려 "0건"이 되던 조합.
  ['large-complex', 'sidoCode=26&lawdCd=11680'],
);

test('5~12·14 · 비부산 요청은 MOLIT·DB·법정동 프록시 호출 0, 200 준비 중, 오류 로그 0', async () => {
  for (const [route, query] of NON_BUSAN_CASES) {
    resetCalls();
    const { status, body, elapsedMs } = await call(route, query);
    const label = `${route}?${query}`;
    assert.equal(status, 200, `${label} — 500이 아니라 200이어야 한다`);
    assert.equal(body.supported, false, label);
    assert.equal(body.reason, STATS_UNSUPPORTED_REASON, label);
    assert.equal(isStatsUnsupportedResponse(body), true, label);
    assert.deepEqual(calls.fetch, [], `${label} — MOLIT/법정동 프록시 호출이 있었다`);
    assert.deepEqual(calls.prisma, [], `${label} — DB 접근이 있었다(error_logs 기록 포함)`);
    assert.equal(calls.consoleError, 0, `${label} — 오류로 기록됐다`);
    // "0건"으로 보일 수 있는 데이터 필드가 없다(부산 데이터로 채우지도 않는다).
    for (const k of ['data', 'rows', 'items', 'groups', 'entries', 'districts', 'dongs', 'overall']) {
      assert.ok(!(k in body), `${label} — ${k}가 응답에 있다`);
    }
    assert.ok(elapsedMs < 1000, `${label} — ${elapsedMs.toFixed(1)}ms`);
  }
});

test('B2 · 부산 요청은 게이트를 통과해 기존 DB 경로에 도달한다(대역 DB가 던지므로 기존 오류 처리로 끝남)', async () => {
  for (const [route, query] of [
    ['price-rankings', 'mode=decline&lawdCd=26140'],
    ['price-rankings', 'mode=record-high&lawdCd=26350'],
    ['price-rankings', 'mode=area84&sidoCode=26'],
    ['large-complex', 'sidoCode=26'],
    ['large-complex', 'sidoCode=26&lawdCd=26470'],
  ] as const) {
    resetCalls();
    const { body } = await call(route, query);
    const label = `${route}?${query}`;
    assert.equal(isStatsUnsupportedResponse(body), false, `${label} — 부산이 막혔다`);
    assert.ok(calls.prisma.length > 0, `${label} — DB 경로에 도달하지 않았다`);
  }
});

test('9b · 지도/상세 실거래 API는 stats 게이트를 쓰지 않는다(범위 분리)', () => {
  const src = readFileSync(path.join(process.cwd(), 'src/app/api/transactions/route.ts'), 'utf8');
  assert.ok(!/stats-gate|isStatsRegionSupported|isStatsEnabled/.test(src), 'transactions 라우트가 stats 게이트에 묶였다');
});

test('16 · 모든 stats 거래 라우트가 캐시/DB/MOLIT 이전에 게이트를 건다', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const name of ['dashboard', 'yearly', 'price-rankings', 'region-change', 'feed', 'concentration', 'gap-invest', 'rankings', 'large-complex']) {
    const src = strip(readFileSync(path.join(process.cwd(), `src/app/api/stats/${name}/route.ts`), 'utf8'));
    const gate = src.indexOf('isStatsRegionSupported(');
    assert.ok(gate > 0, `${name}에 게이트가 없다`);
    for (const dataCall of ['getOrSetCache(', 'fetchMonthsThrottled', 'prisma.', 'getSigunguListForSido(', 'resolveLawdCd(sido']) {
      const at = src.indexOf(dataCall, src.indexOf('export async function GET'));
      if (at >= 0) assert.ok(gate < at, `${name}: ${dataCall}가 게이트보다 먼저 온다`);
    }
  }
});
