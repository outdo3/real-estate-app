/**
 * PERFORMANCE_V2 §22 — 반복 가능한 사용자 여정 성능 감사 (STRICT READ ONLY).
 *
 * 유료 서비스 없이, GET 요청만으로 핵심 여정의 cold/warm 지연을 잰다.
 * 성능이 조용히 나빠지는 것을 막기 위해 배포 전후로 같은 스크립트를 돌린다.
 *
 * 왜 이런 도구가 필요했나: PERFORMANCE_V1 이후 라우트와 데이터가 크게 늘었는데
 * "warm API는 빠르다"만 보고 있었다. 실제 사용자가 느린 지점은 **콜드 첫 진입**이었고,
 * warm 중앙값만 보면 그것이 보이지 않는다(§2 "warm만 보고하지 말 것").
 *
 * 사용:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/perf-journey-audit.ts
 *   npx ts-node ... scripts/perf-journey-audit.ts --base=http://localhost:3000 --label=local
 *
 * 콜드 측정 주의: 서버리스 함수는 최근 호출되면 따뜻하다. 진짜 콜드를 보려면 배포 직후나
 * 유휴 시간 뒤 **첫 실행**의 숫자를 쓰고, 같은 실행을 반복한 두 번째 값과 섞지 않는다.
 */
const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'https://real-estate-app-phi-taupe.vercel.app';
const LABEL = args.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'run';
const WARM_RUNS = 5;

/** 프로젝트 목표치(§2). 이 값을 넘으면 조사 대상이다. */
const WARM_TARGET_MS = 500;
const P1_MS = 2000;
const FAIL_MS = 3000;

const enc = encodeURIComponent;

interface Step { name: string; path: string; core: boolean }

/** 실제 사용자 여정 순서대로. core=true는 "핵심 경로"로 3초 초과 시 FAIL. */
const JOURNEY: Step[] = [
  { name: 'HOME', path: '/', core: true },
  { name: 'SEARCH api (apt+officetel)', path: `/api/search?q=${enc('대신')}`, core: true },
  { name: 'SEARCH api (officetel hit)', path: `/api/search?q=${enc('한일오르듀')}`, core: true },
  { name: 'APT DETAIL page', path: `/apt/${enc('대신푸르지오1차')}?lawdCd=26140&dong=${enc('서대신동1가')}`, core: true },
  { name: 'APT DETAIL api', path: `/api/apt/${enc('대신푸르지오1차')}?lawdCd=26140&dong=${enc('서대신동1가')}`, core: true },
  { name: 'MAP page', path: '/map', core: true },
  { name: 'MAP markers api', path: '/api/transactions?type=apt&lawdCd=26140&months=12', core: true },
  { name: 'STATISTICS landing', path: '/stats', core: true },
  { name: 'VOLUME page', path: '/stats/volume', core: true },
  { name: 'VOLUME dashboard api', path: '/api/stats/dashboard?lawdCd=26140', core: true },
  { name: 'FEED page', path: '/stats/feed', core: true },
  { name: 'FEED api 전체', path: '/api/stats/feed?lawdCd=26140&dong=all&period=7d&offset=0&limit=50', core: true },
  { name: 'FEED api 매매', path: '/api/stats/feed?lawdCd=26140&dong=all&period=7d&offset=0&limit=50&dealType=sale', core: false },
  { name: 'FEED api 전세', path: '/api/stats/feed?lawdCd=26140&dong=all&period=7d&offset=0&limit=50&dealType=jeonse', core: false },
  { name: 'OFFICETEL DETAIL page', path: '/officetel/2243', core: true },
  { name: 'OFFICETEL detail api', path: '/api/officetel/2243', core: true },
  { name: 'OFFICETEL tx api', path: '/api/officetel/2243/transactions?type=sale&limit=20', core: false },
];

async function timed(url: string): Promise<{ ms: number; status: number | string; bytes: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const buf = await res.arrayBuffer();
    return { ms: Date.now() - t0, status: res.status, bytes: buf.byteLength };
  } catch (e) {
    return { ms: Date.now() - t0, status: `ERR:${(e as Error).message}`, bytes: 0 };
  }
}

const pick = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * q) - 1))];
};

async function main() {
  console.log(`PERFORMANCE journey audit  [${LABEL}]  base=${BASE}\n`);
  const rows: Record<string, unknown>[] = [];
  let p1 = 0, fail = 0, overWarmTarget = 0;

  for (const step of JOURNEY) {
    const url = BASE + step.path;
    const first = await timed(url);
    const warms: number[] = [];
    for (let i = 0; i < WARM_RUNS; i++) warms.push((await timed(url)).ms);

    const warmMedian = pick(warms, 0.5);
    const warmP95 = pick(warms, 0.95);
    let verdict = 'OK';
    if (step.core && first.ms > FAIL_MS) { verdict = 'FAIL'; fail++; }
    else if (warmMedian > P1_MS) { verdict = 'P1'; p1++; }
    else if (warmMedian > WARM_TARGET_MS) { verdict = 'SLOW'; overWarmTarget++; }

    rows.push({ name: step.name, core: step.core, status: first.status, firstMs: first.ms, warmMedian, warmP95, kb: +(first.bytes / 1024).toFixed(1), verdict });
    console.log(
      `  ${String(first.ms).padStart(5)}ms first | ${String(warmMedian).padStart(4)}ms warm | ${String(warmP95).padStart(4)}ms p95 | ` +
      `${String(first.status).padStart(3)} | ${String(+(first.bytes / 1024).toFixed(1)).padStart(7)}KB | ${verdict.padEnd(4)} | ${step.name}`
    );
  }

  console.log(`\n  목표: warm <= ${WARM_TARGET_MS}ms · 반복 > ${P1_MS}ms = P1 · 핵심 > ${FAIL_MS}ms = FAIL`);
  console.log(`  SLOW=${overWarmTarget}  P1=${p1}  FAIL=${fail}`);
  console.log(`\n${JSON.stringify({ label: LABEL, base: BASE, at: new Date().toISOString(), rows }, null, 1)}`);
  if (fail > 0) process.exitCode = 1;
}

main();

// 이 파일을 모듈로 만들어 top-level 식별자가 다른 스크립트와 충돌하지 않게 한다
// (scripts/*.ts 중 import/export가 없는 파일들이 전역 스코프를 공유해 TS2451을 낸다).
export {};
