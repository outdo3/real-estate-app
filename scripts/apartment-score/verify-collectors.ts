/**
 * STEP SCORE S2B — collector 단위 검증(§41). 이 프로젝트에는 별도 테스트 러너가
 * 없어(package.json에 test 스크립트 없음) 기존 관례(scripts/의 assert 기반 검증
 * 스크립트, 예: reverify_presale_geocode.ts)를 따른다. 실제 API/DB를 호출하지
 * 않고 순수 로직만 검증한다.
 *
 * 사용법:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js \
 *     scripts/apartment-score/verify-collectors.ts
 */
import assert from 'assert';
import { filterBeaches, filterElementary, filterParks, categorySearch } from '@/lib/apartment-score/collectors/kakao';
import { dedupAndSortStops } from '@/lib/apartment-score/collectors/tago';
import { aggregateByAptSeq, recentMonths, type MolitTradeRaw } from '@/lib/apartment-score/collectors/market';

let passed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL  ${label}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('--- Kakao parsing filters ---');
check('filterBeaches keeps only official 해수욕장,해변 category_name', () => {
  const docs = [
    { id: '1', place_name: '해운대해수욕장', category_name: '관광,명소 > 해수욕장,해변', distance: '53', x: '', y: '' },
    { id: '2', place_name: '해수욕장모텔', category_name: '숙박 > 모텔', distance: '10', x: '', y: '' },
  ] as any;
  const result = filterBeaches(docs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, '1');
});

check('filterElementary keeps only 초등학교 name matches', () => {
  const docs = [
    { id: '1', place_name: '동대신초등학교', category_name: '교육,학문 > 학교 > 초등학교', distance: '200', x: '', y: '' },
    { id: '2', place_name: '동대신중학교', category_name: '교육,학문 > 학교 > 중학교', distance: '210', x: '', y: '' },
  ] as any;
  const result = filterElementary(docs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].place_name, '동대신초등학교');
});

check('filterParks excludes apartment/villa name collisions', () => {
  const docs = [
    { id: '1', place_name: '동대신공원', category_name: '여가시설 > 공원', distance: '300', x: '', y: '' },
    { id: '2', place_name: '공원아파트', category_name: '부동산 > 아파트', distance: '50', x: '', y: '' },
  ] as any;
  const result = filterParks(docs);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].place_name, '동대신공원');
});

console.log('--- TAGO dedup + distance ---');
check('dedupAndSortStops removes duplicate nodeid and sorts by distance', () => {
  const lat = 35.113;
  const lng = 129.01;
  const raw = [
    { citycode: 22, gpslati: 35.1135, gpslong: 129.0105, nodeid: 'A', nodenm: '정류장A' },
    { citycode: 22, gpslati: 35.1135, gpslong: 129.0105, nodeid: 'A', nodenm: '정류장A(중복)' }, // 같은 nodeid 중복
    { citycode: 22, gpslati: 35.12, gpslong: 129.02, nodeid: 'B', nodenm: '정류장B' },
  ] as any;
  const result = dedupAndSortStops(lat, lng, raw);
  assert.strictEqual(result.length, 2, '동일 nodeid 중복 제거되어 2건이어야 함');
  assert.ok(result[0].distanceMeters < result[1].distanceMeters, '거리순 정렬이어야 함');
});

check('dedupAndSortStops keeps distinct nodeid at same coordinates (no name/coord merge)', () => {
  const raw = [
    { citycode: 22, gpslati: 35.1, gpslong: 129.0, nodeid: 'X1', nodenm: '같은자리정류장' },
    { citycode: 21, gpslati: 35.1, gpslong: 129.0, nodeid: 'X2', nodenm: '같은자리정류장' },
  ] as any;
  const result = dedupAndSortStops(35.1, 129.0, raw);
  assert.strictEqual(result.length, 2, '좌표/이름이 같아도 nodeid가 다르면 병합하지 않아야 함');
});

console.log('--- MOLIT market unit + aggregation ---');
check('pricePerM2 unit is 만원/㎡ (dealAmount 만원 ÷ excluUseArea ㎡)', () => {
  const trades: MolitTradeRaw[] = [
    { aptSeq: '26140-51', excluUseArea: 84.5, dealAmount: 50000, dealDate: '2026-01-15', dealCanceled: false },
  ];
  const agg = aggregateByAptSeq(trades);
  const f = agg.get('26140-51')!;
  // 50000만원(5억) / 84.5㎡ ≈ 591만원/㎡ — 부산 시세 order-of-magnitude 검산(평당 약
  // 1,950만원대, 실제 시세 범위와 부합).
  assert.strictEqual(f.medianPricePerM2_12m, Math.round(50000 / 84.5));
});

check('aggregateByAptSeq excludes canceled deals and non-positive prices', () => {
  const trades: MolitTradeRaw[] = [
    { aptSeq: 'X', excluUseArea: 84, dealAmount: 50000, dealDate: '2026-01-01', dealCanceled: true },
    { aptSeq: 'X', excluUseArea: 84, dealAmount: 0, dealDate: '2026-01-02', dealCanceled: false },
    { aptSeq: 'X', excluUseArea: 84, dealAmount: 48000, dealDate: '2026-01-03', dealCanceled: false },
  ];
  const agg = aggregateByAptSeq(trades);
  const f = agg.get('X')!;
  assert.strictEqual(f.transactionCount12m, 1, '취소/0원 거래는 집계에서 제외되어야 함');
  assert.strictEqual(f.latestTradePrice, 48000);
});

check('aggregateByAptSeq groups by aptSeq, not by name/dong', () => {
  const trades: MolitTradeRaw[] = [
    { aptSeq: 'A', excluUseArea: 84, dealAmount: 50000, dealDate: '2026-01-01', dealCanceled: false },
    { aptSeq: 'B', excluUseArea: 59, dealAmount: 40000, dealDate: '2026-02-01', dealCanceled: false },
    { aptSeq: null, excluUseArea: 84, dealAmount: 50000, dealDate: '2026-03-01', dealCanceled: false }, // aptSeq 없는 거래는 skip(AMBIGUOUS)
  ];
  const agg = aggregateByAptSeq(trades);
  assert.strictEqual(agg.size, 2, 'aptSeq 없는 거래는 매핑하지 않고 skip해야 함(§23)');
});

check('recentMonths excludes current partial month and returns count months', () => {
  const ref = new Date(2026, 7, 20); // 2026-08-20
  const months = recentMonths(ref, 12);
  assert.strictEqual(months.length, 12);
  assert.strictEqual(months[0], '202607', '가장 최근 완결된 달은 2026-07이어야 함(당월 08월 제외)');
  assert.strictEqual(months[11], '202508');
});

console.log('--- Kakao no-key error handling (retry/error path without real network) ---');
(async () => {
  const originalKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  delete process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  const result = await categorySearch('SW8', 35.1, 129.0, 1000);
  process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY = originalKey;
  check('categorySearch reports no_key error category without throwing', () => {
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.errorCategory, 'no_key');
  });

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode === 1) {
    console.error('SOME CHECKS FAILED');
  } else {
    console.log('ALL CHECKS PASSED');
  }
})();
