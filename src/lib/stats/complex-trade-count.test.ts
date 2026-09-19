import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { countValidTradesByComplex, groupValidTradesByComplex } from './complex-trade-count';
import { buildConcentrationRanking, dedupeByRecord, dedupeTrades, identityKey, isDateInRange, toFeedTrade, type FeedTrade } from '../regional-feed';
import { storedRentToFeedRaw, storedSaleToFeedRaw } from './feed-db-source';
import { representativeComplexes, type TradeRow } from '../report/region-aggregate';
import { VOLUME_PERIOD_OPTIONS, resolveVolumePeriod } from './volume-period';

// TOP_COMPLEX_AGGREGATION_FIX_V1 — "거래 많은 단지" = 선택 기간의 유효(취소 아님) 매매 계약 기록 수.
// 원천 유효 기록 하나 = 한 건. (금액·계약일·층·면적)이 같다고 접지 않고, 취소는 먼저 뺀다.
// 근거: TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1 (대운스카이뷰1차 30일: 원천 46 = DB 46, 예전 화면 16).

const ROOT = resolve(__dirname, '../../..');
const codeOf = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let nextId = 1000;
/** 화면 DB 경로와 똑같이 만든다: DB 행 → storedSaleToFeedRaw → toFeedTrade. */
function dbTrade(o: { aptSeq?: string; name?: string; dong?: string; area?: string; amount?: number; date?: string; floor?: number; canceled?: boolean; id?: number; lawdCd?: string } = {}): FeedTrade {
  const lawdCd = o.lawdCd ?? '26380';
  return toFeedTrade(storedSaleToFeedRaw({
    id: o.id ?? nextId++, lawdCd, aptSeq: o.aptSeq ?? '26380-2073', aptName: o.name ?? '대운스카이뷰1차', dong: o.dong ?? '하단동',
    exclusiveArea: o.area ?? '24.43', dealAmount: o.amount ?? 13500, dealDate: new Date(`${o.date ?? '2026-08-21'}T00:00:00Z`),
    floor: o.floor ?? 6, dealCanceled: o.canceled ?? false,
  }), 'sale', lawdCd)!;
}
/** 화면 파이프라인(현행): 기록 단위 dedupe → 단지별 유효 거래 수. */
const screenCounts = (trades: FeedTrade[]) => new Map(buildConcentrationRanking(dedupeByRecord(trades), []).map((e) => [e.aptSeq ?? e.name, e.currentCount]));
/** 수정 전 화면 파이프라인: 내용 dedupe(첫 행) → 취소 제외 → 단지별. 회귀 증거용. */
const legacyScreenCounts = (trades: FeedTrade[]) => new Map(buildConcentrationRanking(dedupeTrades(trades), []).map((e) => [e.aptSeq ?? e.name, e.currentCount]));

/** 대운스카이뷰1차 30일 원천 구성: 2층 28.135㎡ 1건 + 3~17층 24.43㎡ 층마다 3건(같은 금액) = 46. */
function daewoon46(): FeedTrade[] {
  const rows: FeedTrade[] = [dbTrade({ floor: 2, area: '28.135', amount: 13393 })];
  const priceByFloor = (f: number) => (f === 3 ? 12770 : f <= 5 ? 13123 : f <= 10 ? 13500 : 13982);
  for (let f = 3; f <= 17; f++) for (let k = 0; k < 3; k++) rows.push(dbTrade({ floor: f, amount: priceByFloor(f) }));
  return rows;
}

test('1 · 대운스카이뷰1차 — 화면 46(수정 전 16), 브리핑 46', () => {
  const rows = daewoon46();
  assert.equal(rows.length, 46);
  assert.equal(screenCounts(rows).get('26380-2073'), 46);
  assert.equal(legacyScreenCounts(rows).get('26380-2073'), 16, '수정 전 화면 로직이 16을 냈다(재현)');
  const reportRows: TradeRow[] = rows.map((t) => ({ aptSeq: t.aptSeq, lawdCd: t.lawdCd, dong: t.dong, aptName: t.name, exclusiveArea: t.excluUseArea!, dealAmount: t.dealAmount, dealDate: t.dealDate, dealCanceled: t.dealCanceled, floor: Number(t.floorRaw) }));
  assert.equal(representativeComplexes(reportRows, 5)[0].count, 46);
});

test('2 · 같은 날·같은 금액·같은 층·같은 면적 유효 3건 = 3건(1건으로 접지 않는다)', () => {
  const rows = [dbTrade(), dbTrade(), dbTrade()];
  assert.equal(screenCounts(rows).get('26380-2073'), 3);
  assert.equal(countValidTradesByComplex(rows, identityKey, (t) => t.dealCanceled).get(identityKey(rows[0])), 3);
});

test('3·4·5 · 취소 형제 — 유효+취소 = 1, 유효+유효 = 2, 순서가 바뀌어도 같다', () => {
  // 취소 행이 먼저 적재된(id가 작은) 경우 — 수정 전 화면은 취소 행을 남긴 뒤 빼서 0이 됐다(부곡늘푸른 사례).
  const canceledFirst = [dbTrade({ id: 1, canceled: true }), dbTrade({ id: 2 })];
  const activeFirst = [dbTrade({ id: 3 }), dbTrade({ id: 4, canceled: true })];
  assert.equal(screenCounts(canceledFirst).get('26380-2073'), 1);
  assert.equal(screenCounts(activeFirst).get('26380-2073'), 1);
  assert.equal(screenCounts([...canceledFirst].reverse()).get('26380-2073'), 1);
  assert.equal(legacyScreenCounts(canceledFirst).get('26380-2073') ?? 0, 0, '수정 전: 취소 행이 먼저면 유효 거래까지 사라졌다(재현)');
  const bothActive = [dbTrade({ id: 5 }), dbTrade({ id: 6 })];
  assert.equal(screenCounts(bothActive).get('26380-2073'), 2);
  assert.equal(screenCounts([...bothActive].reverse()).get('26380-2073'), 2);
});

test('6~11 · 오늘·어제·7일·15일·30일·3개월 — 기간과 무관하게 같은 규칙(기간 안 유효 기록 수)', () => {
  const now = new Date('2026-09-19T03:00:00.000Z');
  const rows = [
    ...daewoon46(), // 08-21
    dbTrade({ aptSeq: '26290-4786', name: '롯데캐슬인피니엘', dong: '문현동', date: '2026-09-18', floor: 24 }),
    dbTrade({ aptSeq: '26290-4786', name: '롯데캐슬인피니엘', dong: '문현동', date: '2026-09-18', floor: 24 }),
    dbTrade({ aptSeq: '26290-4786', name: '롯데캐슬인피니엘', dong: '문현동', date: '2026-09-10', floor: 7, canceled: true }),
    dbTrade({ aptSeq: '26500-29', name: '삼익비치', dong: '남천동', date: '2026-07-01', floor: 5 }),
    // 오늘(09-19)·어제(09-18) — 같은 조건 2건 + 취소 형제
    dbTrade({ aptSeq: '26140-1361', name: 'e편한세상', dong: '암남동', date: '2026-09-19', floor: 9 }),
    dbTrade({ aptSeq: '26140-1361', name: 'e편한세상', dong: '암남동', date: '2026-09-19', floor: 9 }),
    dbTrade({ aptSeq: '26140-1361', name: 'e편한세상', dong: '암남동', date: '2026-09-18', floor: 3, canceled: true }),
    dbTrade({ aptSeq: '26140-1361', name: 'e편한세상', dong: '암남동', date: '2026-09-18', floor: 3 }),
  ];
  for (const key of ['today', 'yesterday', '7d', '15d', '30d', '3m'] as const) {
    const range = resolveVolumePeriod(key, now);
    const inRange = rows.filter((t) => isDateInRange(t.dealDate, range));
    const counts = screenCounts(inRange);
    const expected = new Map<string, number>();
    for (const t of inRange) if (!t.dealCanceled) expected.set(t.aptSeq!, (expected.get(t.aptSeq!) ?? 0) + 1);
    assert.deepEqual(new Map([...counts].sort()), new Map([...expected].sort()), key);
  }
  // 대운은 30일·3개월에 46, 7일·15일에는 없음
  assert.equal(screenCounts(rows.filter((t) => isDateInRange(t.dealDate, resolveVolumePeriod('30d', now)))).get('26380-2073'), 46);
  assert.equal(screenCounts(rows.filter((t) => isDateInRange(t.dealDate, resolveVolumePeriod('15d', now)))).get('26380-2073'), undefined);
  // 라우트는 기간별 분기 없이 같은 함수를 부른다.
  const route = codeOf('src/app/api/stats/concentration/route.ts');
  assert.match(route, /const entries = buildConcentrationRanking\(currentTrades, previousTrades\);/);
  assert.ok(!/dedupeTrades\(/.test(route), 'concentration이 아직 내용 dedupe를 쓴다');
  assert.equal(VOLUME_PERIOD_OPTIONS.length, 6);
});

test('10 · 화면과 브리핑이 같은 규칙 — 무작위 표본에서 단지별 개수가 완전히 같다', () => {
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const complexes = [['26380-2073', '대운', '하단동'], ['26500-29', '삼익비치', '남천동'], ['26140-1361', 'e편한', '암남동'], [null, '이름만', '우동']] as const;
  const feed: FeedTrade[] = [];
  const report: TradeRow[] = [];
  for (let i = 0; i < 400; i++) {
    const [seq, name, dong] = complexes[rnd(complexes.length)];
    const o = { aptSeq: seq ?? undefined, name, dong, amount: 10000 + rnd(3) * 100, floor: 1 + rnd(3), date: `2026-09-0${1 + rnd(3)}`, canceled: rnd(5) === 0 };
    const t = toFeedTrade(storedSaleToFeedRaw({ id: 5000 + i, lawdCd: '26380', aptSeq: seq, aptName: name, dong, exclusiveArea: '84.9', dealAmount: o.amount, dealDate: new Date(`${o.date}T00:00:00Z`), floor: o.floor, dealCanceled: o.canceled }), 'sale', '26380')!;
    feed.push(t);
    report.push({ aptSeq: seq, lawdCd: '26380', dong, aptName: name, exclusiveArea: 84.9, dealAmount: o.amount, dealDate: o.date, dealCanceled: o.canceled, floor: o.floor });
  }
  const scr = new Map(buildConcentrationRanking(dedupeByRecord(feed), []).map((e) => [e.aptSeq ?? `nd:${e.name}`, e.currentCount]));
  const rep = new Map(representativeComplexes(report.filter((r) => !r.dealCanceled), 10).map((c) => [c.aptSeq ?? `nd:${c.aptName}`, c.count]));
  assert.deepEqual(new Map([...scr].sort()), new Map([...rep].sort()));
  // 두 경로가 공용 함수를 실제로 쓴다.
  assert.match(codeOf('src/lib/regional-feed.ts'), /groupValidTradesByComplex\(currentTrades, identityKey, \(t\) => t\.dealCanceled\)/);
  assert.match(codeOf('src/lib/report/region-aggregate.ts'), /groupValidTradesByComplex\(/);
});

test('11·12 · 정렬과 동률 처리는 각 경로 기존 규칙 그대로', () => {
  // 화면: 건수 내림차순, 동률은 입력(계약일·id) 순서 — 라우트의 정렬 식이 그대로다.
  const route = codeOf('src/app/api/stats/concentration/route.ts');
  assert.match(route, /return b\.currentCount - a\.currentCount;/);
  // 브리핑: 건수 → 최근 계약일 → 이름.
  const agg = codeOf('src/lib/report/region-aggregate.ts');
  assert.match(agg, /\.sort\(\(a, b\) => \(b\.count - a\.count\) \|\| b\.latestDealDate\.localeCompare\(a\.latestDealDate\) \|\| a\.aptName\.localeCompare\(b\.aptName\)\)/);
  const rows = [dbTrade({ aptSeq: 'A', name: 'A', date: '2026-09-01' }), dbTrade({ aptSeq: 'B', name: 'B', date: '2026-09-02' }), dbTrade({ aptSeq: 'B', name: 'B', date: '2026-09-03' })];
  const ranked = buildConcentrationRanking(dedupeByRecord(rows), []).sort((a, b) => b.currentCount - a.currentCount);
  assert.deepEqual(ranked.map((e) => [e.aptSeq, e.currentCount, e.latestDealDate]), [['B', 2, '2026-09-03'], ['A', 1, '2026-09-01']]);
});

test('13 · 요약 거래건수와 단지 합계가 같은 기준(유효 기록 수)이다', () => {
  const rows = [...daewoon46(), dbTrade({ canceled: true }), dbTrade({ aptSeq: '26500-29', name: '삼익비치', dong: '남천동' })];
  const total = rows.filter((t) => !t.dealCanceled).length; // dashboard: verifiedApt = !dealCanceled 행 수
  const sum = [...countValidTradesByComplex(dedupeByRecord(rows), identityKey, (t) => t.dealCanceled).values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, total);
  assert.match(codeOf('src/app/api/stats/dashboard/route.ts'), /const verifiedApt = allAptTrades\.filter\(\(t: any\) => !t\.dealCanceled\);/);
});

test('14·15 · 데이터는 그대로 — 취소로 저장된 행(false-cancel 포함)은 여전히 세지 않고, 원천 회수 행도 손대지 않는다', () => {
  // false-cancel(원천 1/2 ↔ DB 2/2 취소): 집계는 DB 상태를 따른다 → 0. repair는 이번 범위가 아니다.
  assert.equal(screenCounts([dbTrade({ canceled: true }), dbTrade({ canceled: true })]).get('26380-2073') ?? 0, 0);
  // 집계 모듈은 DB에 쓰지 않는다(prisma를 import하지 않는 순수 함수).
  for (const p of ['src/lib/stats/complex-trade-count.ts', 'src/lib/regional-feed.ts', 'src/lib/report/region-aggregate.ts']) {
    assert.ok(!/prisma/.test(codeOf(p)), `${p}가 DB에 접근한다`);
  }
  assert.deepEqual([...groupValidTradesByComplex([] as FeedTrade[], identityKey, () => false)], []);
});

test('16 · 실거래 피드도 기록 단위 — 같은 조건 다른 세대·취소+재신고 형제를 숨기지 않는다', () => {
  const feed = codeOf('src/app/api/stats/feed/route.ts');
  assert.ok(!/dedupeTrades\(/.test(feed), '피드가 아직 내용 dedupe를 쓴다');
  assert.equal((feed.match(/dedupeByRecord\(/g) ?? []).length, 2);
  const pair = [dbTrade({ id: 11, canceled: true }), dbTrade({ id: 12 })];
  const shown = dedupeByRecord(pair);
  assert.equal(shown.length, 2, '취소 기록은 "취소" 표시로, 유효 기록은 그대로 둘 다 남는다');
  assert.equal(shown.filter((t) => t.dealCanceled).length, 1);
  // 같은 원천 기록이 두 번 들어온 경우만 하나로
  assert.equal(dedupeByRecord([pair[1], pair[1]]).length, 1);
  // 전월세 DB 기록도 순번이 id에 들어가 같은 조건의 다른 기록이 접히지 않는다.
  const base = { lawdCd: '26230', aptSeq: '26230-2866', aptName: 'X', dong: '양정동', exclusiveArea: '84.97', deposit: 40000, monthlyRent: 0, dealType: 'jeonse', dealDate: new Date(Date.UTC(2025, 9, 25)), dealYmd: '202510', floor: 8, buildYear: 2024, jibun: '1' };
  const r0 = toFeedTrade(storedRentToFeedRaw({ ...base, occurrenceIndex: 0 }), 'jeonse', '26230')!;
  const r1 = toFeedTrade(storedRentToFeedRaw({ ...base, occurrenceIndex: 1 }), 'jeonse', '26230')!;
  assert.notEqual(r0.uid, r1.uid);
  assert.equal(dedupeByRecord([r0, r1]).length, 2);
  assert.match(codeOf('src/lib/rent-history-read.ts'), /occurrence_index as "occurrenceIndex"/);
});

test('19 · 화면 순위·건수 = 브리핑(=이미지/PDF 원본) 순위·건수 — 6개 기간 모두, 대운 46 포함', async () => {
  const { buildRegionReport } = await import('../report/region-report');
  const now = new Date('2026-09-19T03:00:00.000Z');
  const rows = [
    ...daewoon46(),
    ...Array.from({ length: 27 }, (_, i) => dbTrade({ aptSeq: '26290-4786', name: '롯데캐슬인피니엘', dong: '문현동', date: `2026-09-${String(1 + (i % 19)).padStart(2, '0')}`, floor: 5 + (i % 20) })),
    ...Array.from({ length: 12 }, (_, i) => dbTrade({ aptSeq: '26500-29', name: '삼익비치', dong: '남천동', date: `2026-09-${String(10 + (i % 10)).padStart(2, '0')}`, floor: 3 })),
    dbTrade({ aptSeq: '26500-29', name: '삼익비치', dong: '남천동', date: '2026-09-18', floor: 3, canceled: true }),
    ...Array.from({ length: 3 }, () => dbTrade({ aptSeq: '26140-1361', name: 'e편한세상', dong: '암남동', date: '2026-09-19', floor: 9 })),
  ];
  for (const key of ['today', 'yesterday', '7d', '15d', '30d', '3m'] as const) {
    const range = resolveVolumePeriod(key, now);
    const inRange = rows.filter((t) => isDateInRange(t.dealDate, range));
    // 화면: 라우트와 같은 파이프라인 + 라우트 정렬(건수 내림차순)
    const screen = buildConcentrationRanking(dedupeByRecord(inRange), []).sort((a, b) => b.currentCount - a.currentCount).map((e) => [e.aptSeq, e.currentCount]);
    // 브리핑: 리포트 빌더의 "거래가 많은 단지" 섹션(이미지·PDF가 캡처하는 그 값)
    const env = buildRegionReport({
      level: 'CITY', lawdCd: null, dong: null, previousCount: 0, trailingYearCount: 500, masters: [], generatedAt: now.toISOString(), dataAsOf: null, coverageComplete: true,
      period: { start: range.from, end: range.to, label: key },
      rows: inRange.map((t) => ({ aptSeq: t.aptSeq, lawdCd: t.lawdCd, dong: t.dong, aptName: t.name, exclusiveArea: t.excluUseArea!, dealAmount: t.dealAmount, dealDate: t.dealDate, dealCanceled: t.dealCanceled, floor: Number(t.floorRaw) })),
      twoYearRows: [],
    });
    const report = (env.sections.find((x) => x.key === 'representativeComplexes')?.rows ?? []).map((r) => [r.cells.aptSeq, r.cells.count]);
    assert.deepEqual(screen.slice(0, report.length), report, key);
    // 요약 거래건수 = 단지 합계
    const total = env.metrics.find((m) => m.key === 'transactionCount')!.value;
    assert.equal(screen.reduce((a, [, c]) => a + Number(c), 0), total, `${key} 합계`);
  }
  const range30 = resolveVolumePeriod('30d', now);
  const r30 = buildConcentrationRanking(dedupeByRecord(rows.filter((t) => isDateInRange(t.dealDate, range30))), []);
  assert.equal(r30.find((e) => e.aptSeq === '26380-2073')!.currentCount, 46);
});
