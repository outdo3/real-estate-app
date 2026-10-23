// OFFICETEL_NEARBY_V1 — 주변 오피스텔 계약의 순수 로직 테스트. DB/네트워크 없음, 운영 데이터 접근 없음(모의 데이터).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEARBY_API_VERSION,
  NEARBY_MAX_LIMIT,
  NEARBY_MAX_RADIUS_KM,
  NEARBY_RECENT_TRADES_PER_KIND,
  OfficetelNearbyQueryError,
  boundingBox,
  buildOfficetelNearbyResponse,
  checkNearbyAccess,
  freshnessOf,
  haversineKm,
  parseOfficetelNearbyQuery,
  rankNearbyMasters,
  summarizeRent,
  summarizeSale,
  windowStartDate,
} from './nearby-contract.ts';

const q = (obj) => parseOfficetelNearbyQuery((k) => (k in obj ? String(obj[k]) : null));
const NOW = new Date('2026-10-23T00:00:00Z');
const SITE = { lat: 35.0830, lng: 128.9040 }; // 명지 부근(모의)

const master = (id, lat, lng, over = {}) => ({
  id, displayName: `오피스텔${id}`, umdNm: '명지동', jibun: `${id}-0`, buildingDong: null, roadAddress: null, buildYear: 2014, hoCnt: null, latitude: lat, longitude: lng, ...over,
});

test('query: 기본값과 정상 입력', () => {
  const r = q({ lat: 35.08, lng: 128.9 });
  assert.deepEqual(r, { lat: 35.08, lng: 128.9, radiusKm: 1, limit: 5, months: 12, area: null, areaTolerance: 1, kinds: 'both' });
  const r2 = q({ lat: 35.08, lng: 128.9, radiusKm: 2.5, limit: 10, months: 24, area: 84, areaTolerance: 2, kinds: 'sale' });
  assert.equal(r2.radiusKm, 2.5);
  assert.equal(r2.kinds, 'sale');
});

test('query: 잘못된 좌표(없음, 문자, 한국 밖, 위경도 뒤바뀜)는 거부', () => {
  assert.throws(() => q({}), OfficetelNearbyQueryError);
  assert.throws(() => q({ lat: 'abc', lng: 128.9 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ lat: 0, lng: 0 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ lat: 128.9, lng: 35.08 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ lat: 'NaN', lng: 128.9 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ lat: 'Infinity', lng: 128.9 }), OfficetelNearbyQueryError);
});

test('query: 과도한 반경·개수·기간·면적 거부', () => {
  const base = { lat: 35.08, lng: 128.9 };
  assert.throws(() => q({ ...base, radiusKm: NEARBY_MAX_RADIUS_KM + 0.1 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, radiusKm: 0 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, radiusKm: -1 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, limit: NEARBY_MAX_LIMIT + 1 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, limit: 0 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, limit: 2.5 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, months: 37 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, area: -5 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, area: 9999 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, areaTolerance: 6 }), OfficetelNearbyQueryError);
  assert.throws(() => q({ ...base, kinds: 'apt' }), OfficetelNearbyQueryError);
});

test('access: 키 설정 시 일치해야 하고, 키가 없으면 Production은 닫혀 있다(fail-closed)', () => {
  assert.equal(checkNearbyAccess({ configuredKey: 'k', providedKey: 'k', nodeEnv: 'production' }).allowed, true);
  const wrong = checkNearbyAccess({ configuredKey: 'k', providedKey: 'x', nodeEnv: 'production' });
  assert.equal(wrong.allowed, false);
  assert.equal(wrong.status, 401);
  assert.equal(checkNearbyAccess({ configuredKey: 'k', providedKey: null, nodeEnv: 'development' }).allowed, false);
  const closed = checkNearbyAccess({ configuredKey: undefined, providedKey: null, nodeEnv: 'production' });
  assert.equal(closed.allowed, false);
  assert.equal(closed.status, 503);
  assert.equal(checkNearbyAccess({ configuredKey: '  ', providedKey: null, nodeEnv: 'production' }).allowed, false);
  assert.equal(checkNearbyAccess({ configuredKey: undefined, providedKey: null, nodeEnv: 'development' }).allowed, true);
  assert.equal(checkNearbyAccess({ configuredKey: undefined, providedKey: null, nodeEnv: 'test' }).allowed, true);
});

test('거리 계산: 알려진 거리와 일치, 대칭, 0', () => {
  assert.equal(haversineKm(35, 129, 35, 129), 0);
  // 위도 1도 ≈ 111.19km
  assert.ok(Math.abs(haversineKm(35, 129, 36, 129) - 111.19) < 0.2);
  assert.equal(haversineKm(35.1, 128.9, 35.2, 129.0), haversineKm(35.2, 129.0, 35.1, 128.9));
  // 서울-부산 직선 약 325km
  const sb = haversineKm(37.5665, 126.978, 35.1796, 129.0756);
  assert.ok(sb > 320 && sb < 335);
});

test('bounding box가 반경 원을 포함한다', () => {
  const box = boundingBox(SITE.lat, SITE.lng, 1);
  // 정북/정동 1km 지점이 상자 안(경계)에 있다
  const north = SITE.lat + 1 / 111.19;
  assert.ok(north <= box.latMax && north >= box.latMin);
  const east = SITE.lng + 1 / (111.19 * Math.cos((SITE.lat * Math.PI) / 180));
  assert.ok(east <= box.lngMax + 1e-6);
});

test('반경 검색·정렬: 반경 밖 제외, 가까운 순, 같은 거리는 id 순, 좌표 없는 master 제외', () => {
  const rows = [
    master(5, SITE.lat + 0.005, SITE.lng), // ≈0.56km
    master(2, SITE.lat + 0.002, SITE.lng), // ≈0.22km
    master(9, SITE.lat + 0.05, SITE.lng), // ≈5.5km 반경 밖
    master(3, null, null), // 좌표 없음
    master(4, 0, 0), // (0,0)
    master(7, Number.NaN, SITE.lng),
    master(1, SITE.lat + 0.002, SITE.lng), // id 1, 2와 같은 거리
  ];
  const { ranked, withinRadius } = rankNearbyMasters(rows, { ...SITE, radiusKm: 1 });
  assert.deepEqual(ranked.map((r) => r.id), [1, 2, 5]);
  assert.equal(withinRadius, 3);
  assert.ok(ranked.every((r) => r.distanceKm <= 1));
});

test('기간 시작일과 최신성 판정(수집일이 오래되면 STALE, 없으면 UNKNOWN)', () => {
  assert.equal(windowStartDate(NOW, 12), '2025-10-23');
  assert.equal(windowStartDate(NOW, 1), '2026-09-23');
  assert.deepEqual(freshnessOf('2026-10-20T00:00:00Z', NOW), { status: 'CURRENT', ageDays: 3 });
  assert.equal(freshnessOf('2026-09-04T17:07:02.495Z', NOW).status, 'STALE');
  assert.deepEqual(freshnessOf(null, NOW), { status: 'UNKNOWN', ageDays: null });
  assert.deepEqual(freshnessOf('not-a-date', NOW), { status: 'UNKNOWN', ageDays: null });
});

const sale = (date, amount, area, floor = 5) => ({ dealDate: date, dealAmount: amount, exclusiveArea: area, floor });
const rent = (date, deposit, monthly, area, floor = 5) => ({ dealDate: date, deposit, monthlyRent: monthly, exclusiveArea: area, floor });

test('매매 요약: 최근순, 최근 3건만, 건수, 면적 조건, 평균/중앙값 필드 없음', () => {
  const rows = [sale('2026-05-01', 3900, 84), sale('2026-08-12', 4053, 84.4), sale('2026-07-06', 3959, 83.6), sale('2026-09-01', 4100, 84), sale('2026-06-01', 2500, 59)];
  const all = summarizeSale(rows, { area: null, areaTolerance: 1 });
  assert.equal(all.count, 5);
  assert.equal(all.recent.length, NEARBY_RECENT_TRADES_PER_KIND);
  assert.deepEqual(all.recent.map((r) => r.dealDate), ['2026-09-01', '2026-08-12', '2026-07-06']);
  assert.equal(all.recent[0].dealMonth, '2026-09');
  const only84 = summarizeSale(rows, { area: 84, areaTolerance: 1 });
  assert.equal(only84.count, 4);
  assert.ok(only84.recent.every((r) => Math.abs(r.exclusiveArea - 84) <= 1));
  const tight = summarizeSale(rows, { area: 84, areaTolerance: 0 });
  assert.equal(tight.count, 2);
  for (const k of ['average', 'mean', 'median', 'avg']) assert.ok(!(k in all));
});

test('전월세 요약: 전세(월세 0)와 월세를 모두 원시로 유지', () => {
  const s = summarizeRent([rent('2026-09-02', 20000, 0, 59), rent('2026-08-30', 3000, 55, 59)], { area: 59, areaTolerance: 1 });
  assert.equal(s.count, 2);
  assert.deepEqual(s.recent.map((r) => [r.deposit, r.monthlyRent]), [[20000, 0], [3000, 55]]);
});

const rm = (id, d) => ({ ...master(id, SITE.lat, SITE.lng), distanceKm: d });
const dataset = (fetched) => ({ sale: { lastFetchedAt: fetched, lastDealDate: '2026-08-29' }, rent: { lastFetchedAt: fetched, lastDealDate: '2026-09-01' } });
const build = (masters, over = {}) =>
  buildOfficetelNearbyResponse({
    query: q({ lat: SITE.lat, lng: SITE.lng, ...(over.query ?? {}) }), now: NOW, withinRadius: masters.length, candidatesTruncated: false, tradeRowsTruncated: false,
    masters, dataset: over.dataset ?? dataset('2026-10-22T00:00:00Z'),
  });

test('응답: 거래가 있으면 OK, 오피스텔만 담고 아파트와 비교하지 말라고 명시, 내부 식별정보 없음', () => {
  const r = build([{ master: rm(1, 0.234), sale: [sale('2026-08-12', 4053, 34.5)], rent: [rent('2026-09-02', 3000, 55, 34.5)], attribution: { status: 'ATTRIBUTED', note: null } }]);
  assert.equal(r.dataStatus, 'OK');
  assert.equal(r.comparison.propertyType, 'officetel');
  assert.match(r.comparison.note, /아파트/);
  assert.equal(r.comparison.areaBasis, '전용면적(㎡)');
  assert.equal(r.items[0].distanceKm, 0.23);
  assert.equal(r.items[0].tradeStatus, 'HAS_TRADES');
  assert.equal(r.items[0].sale.count, 1);
  assert.equal(r.items[0].rent.count, 1);
  const json = JSON.stringify(r);
  for (const leaked of ['canonicalKey', 'sourceFetchedAt', 'occurrenceIndex', 'OFFI:']) assert.ok(!json.includes(leaked), leaked);
  assert.ok(r.window.dealDateFrom < r.window.dealDateTo);
  assert.ok(r.source.name.includes('국토교통부'));
});

test('거래 없는 단지: INSUFFICIENT, 가격을 만들지 않음(건수 0, 최근 거래 빈 배열, null)', () => {
  const r = build([{ master: rm(1, 0.3), sale: [], rent: [], attribution: { status: 'NO_TRANSACTIONS', note: null } }]);
  assert.equal(r.dataStatus, 'INSUFFICIENT');
  assert.equal(r.items[0].tradeStatus, 'NO_TRADES_IN_WINDOW');
  assert.deepEqual(r.items[0].sale, { count: 0, latestDealDate: null, recent: [] });
  assert.ok(r.notes.some((n) => n.includes('추정하지 않습니다')));
});

test('주변 오피스텔이 없으면 NO_NEARBY_OFFICETEL과 부산 한정 안내', () => {
  const r = build([]);
  assert.equal(r.dataStatus, 'NO_NEARBY_OFFICETEL');
  assert.deepEqual(r.items, []);
  assert.ok(r.notes.some((n) => n.includes('부산')));
  assert.equal(r.coverage.region, '부산광역시');
});

test('면적 조건이 맞는 거래가 없으면(다른 면적 거래만 있으면) 거래 없음으로 처리', () => {
  const r = build([{ master: rm(1, 0.3), sale: [sale('2026-08-12', 4053, 34.5)], rent: [], attribution: { status: 'ATTRIBUTED', note: null } }], { query: { area: 84 } });
  assert.equal(r.dataStatus, 'INSUFFICIENT');
  assert.equal(r.items[0].sale.count, 0);
  assert.equal(r.query.areaTolerance, 1);
});

test('오래된 데이터: 수집일이 45일 초과면 STALE로 말하고 최신 시세로 쓰지 말라는 안내(실제 이집 수집일 2026-09-04 기준)', () => {
  const r = build([{ master: rm(1, 0.3), sale: [sale('2026-08-12', 4053, 34.5)], rent: [], attribution: { status: 'ATTRIBUTED', note: null } }], { dataset: dataset('2026-09-04T17:07:02.495Z') });
  assert.equal(r.dataAsOf.sale.freshness, 'STALE');
  assert.equal(r.dataAsOf.sale.ageDays, 48);
  assert.equal(r.dataAsOf.sale.lastDealDate, '2026-08-29');
  assert.ok(r.notes.some((n) => n.includes('최신 시세로 쓰면 안 됩니다')));
  const fresh = build([{ master: rm(1, 0.3), sale: [sale('2026-08-12', 4053, 34.5)], rent: [], attribution: { status: 'ATTRIBUTED', note: null } }]);
  assert.equal(fresh.dataAsOf.sale.freshness, 'CURRENT');
  assert.ok(!fresh.notes.some((n) => n.includes('수집일이 오래된')));
});

test('수집일을 모르면 UNKNOWN이고 최신이라고 하지 않는다', () => {
  const r = build([], { dataset: dataset(null) });
  assert.equal(r.dataAsOf.sale.freshness, 'UNKNOWN');
  assert.ok(r.notes.some((n) => n.includes('수집일이 오래된')));
});

test('매매만/전월세만 요청하면 다른 쪽은 null(섞지 않음)', () => {
  const m = [{ master: rm(1, 0.3), sale: [sale('2026-08-12', 4053, 34.5)], rent: [rent('2026-09-02', 3000, 55, 34.5)], attribution: { status: 'ATTRIBUTED', note: null } }];
  const onlySale = build(m, { query: { kinds: 'sale' } });
  assert.equal(onlySale.items[0].rent, null);
  assert.equal(onlySale.dataAsOf.rent, null);
  const onlyRent = build(m, { query: { kinds: 'rent' } });
  assert.equal(onlyRent.items[0].sale, null);
});

test('동별로 귀속되지 않은 단지는 "거래 없음"이 아니라 구분 불가로 표시하고 안내를 싣는다', () => {
  const r = build([{ master: rm(1, 0.3), sale: [], rent: [], attribution: { status: 'UNATTRIBUTED_AT_ADDRESS', note: '동을 구분할 수 없는 거래 120건은 표시하지 않습니다.' } }]);
  assert.equal(r.items[0].attribution.status, 'UNATTRIBUTED_AT_ADDRESS');
  assert.ok(r.notes.some((n) => n.includes('거래 없음이 아닙니다')));
});

test('응답 크기 제한: 최근 거래는 종류당 3건, 잘림 상태는 숨기지 않는다', () => {
  const many = Array.from({ length: 200 }, (_, i) => sale(`2026-0${(i % 9) + 1}-01`, 1000 + i, 34.5));
  const r = buildOfficetelNearbyResponse({
    query: q({ lat: SITE.lat, lng: SITE.lng }), now: NOW, withinRadius: 40, candidatesTruncated: true, tradeRowsTruncated: true,
    masters: [{ master: rm(1, 0.3), sale: many, rent: [], attribution: { status: 'ATTRIBUTED', note: null } }], dataset: dataset('2026-10-22T00:00:00Z'),
  });
  assert.equal(r.items[0].sale.count, 200);
  assert.equal(r.items[0].sale.recent.length, 3);
  assert.equal(r.truncated.candidates, true);
  assert.equal(r.truncated.tradeRows, true);
  assert.ok(r.notes.some((n) => n.includes('상한')));
  assert.equal(r.totals.withinRadius, 40);
  assert.equal(r.totals.returned, 1);
  assert.ok(JSON.stringify(r).length < 20_000);
});

test('입력 객체를 바꾸지 않는다(읽기 전용 순수 함수)', () => {
  const rows = [sale('2026-08-12', 4053, 34.5), sale('2026-09-01', 4100, 34.5)];
  const copy = JSON.parse(JSON.stringify(rows));
  summarizeSale(rows, { area: null, areaTolerance: 1 });
  assert.deepEqual(rows, copy);
});

test('응답 계약: apiVersion과 상세 경로(출처 링크용)가 있고, 필드 순서와 무관하게 필요한 키가 모두 있다', () => {
  const r = build([{ master: rm(7, 0.1), sale: [sale('2026-08-12', 4053, 34.5)], rent: [], attribution: { status: 'ATTRIBUTED', note: null } }]);
  assert.equal(r.apiVersion, NEARBY_API_VERSION);
  assert.equal(r.items[0].detailPath, '/officetel/7');
  for (const k of ['query', 'dataStatus', 'comparison', 'window', 'dataAsOf', 'source', 'coverage', 'totals', 'truncated', 'notes', 'items']) assert.ok(k in r, k);
});

test('DB가 센 요약(saleSummary/rentSummary)이 있으면 원시 행이 아니라 그 건수를 쓴다(불러온 행 수에 좌우되지 않음)', () => {
  const r = build([{
    master: rm(1, 0.2),
    saleSummary: { count: 1234, latestDealDate: '2026-08-29', recent: [sale('2026-08-29', 5000, 84), sale('2026-08-01', 4900, 84), sale('2026-07-01', 4800, 84), sale('2026-06-01', 4700, 84)] },
    rentSummary: { count: 0, latestDealDate: null, recent: [] },
    attribution: { status: 'ATTRIBUTED', note: null },
  }]);
  assert.equal(r.items[0].sale.count, 1234);
  assert.equal(r.items[0].sale.recent.length, 3);
  assert.equal(r.items[0].sale.recent[0].dealMonth, '2026-08');
  assert.equal(r.items[0].tradeStatus, 'HAS_TRADES');
  assert.deepEqual(r.items[0].rent, { count: 0, latestDealDate: null, recent: [] });
  // 요약은 kinds 요청을 여전히 따른다
  const onlyRent = build([{ master: rm(1, 0.2), saleSummary: { count: 5, latestDealDate: '2026-08-29', recent: [] }, rentSummary: { count: 2, latestDealDate: '2026-08-01', recent: [rent('2026-08-01', 1000, 50, 59)] }, attribution: { status: 'ATTRIBUTED', note: null } }], { query: { kinds: 'rent' } });
  assert.equal(onlyRent.items[0].sale, null);
  assert.equal(onlyRent.items[0].rent.count, 2);
});
