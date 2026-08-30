/**
 * BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 — §12/§36 성능 벤치마크.
 *
 * 실행 중인 dev/prod 서버의 /api/search에 대표 query set을 반복 요청해 p50/p95/max를
 * 측정한다. 외부 API 호출 없음(대상 엔드포인트 자체의 동작에 맡김 — 이 스크립트는
 * HTTP 타이밍만 잰다). Production write 없음.
 *
 * 사용법:
 *   npx ts-node --transpile-only scripts/benchmark-apartment-search.ts [baseUrl]
 *   (기본 baseUrl=http://localhost:3000)
 */
export {};

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const ITERATIONS = 15;

const QUERIES = [
  '경동',
  '경동마리나',
  '롯데',
  '해운대',
  '대신롯데캐슬',
  '가', // 1글자 — 서버에서 no-op이어야 함(q.trim().length<2)
  'ㅁㅁㅁㅁ존재안함', // no-result
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function timeRequest(url: string): Promise<number> {
  const start = performance.now();
  const res = await fetch(url);
  await res.json();
  return performance.now() - start;
}

async function main() {
  console.log(`BASE_URL=${BASE_URL}, iterations per query=${ITERATIONS}\n`);

  for (const q of QUERIES) {
    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(q)}`;
    // 첫 요청(cold, dev 컴파일/커넥션 워밍업 포함)은 별도로 기록하고 통계에서 제외.
    const coldMs = await timeRequest(url);

    const warmTimes: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      warmTimes.push(await timeRequest(url));
    }
    warmTimes.sort((a, b) => a - b);

    const p50 = percentile(warmTimes, 50);
    const p95 = percentile(warmTimes, 95);
    const max = warmTimes[warmTimes.length - 1];

    console.log(
      `q="${q}" cold=${coldMs.toFixed(0)}ms warm_p50=${p50.toFixed(0)}ms warm_p95=${p95.toFixed(0)}ms warm_max=${max.toFixed(0)}ms`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
