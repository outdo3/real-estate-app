import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { aggregateCandidates, type RawTradeItem, type SeedCandidate } from '../seoul-master-seed-plan-logic';
import {
  classifyGgCandidates,
  evaluateGgApplyGate,
  findDuplicateAptSeqs,
  GYEONGGI_FIRST_BATCH,
  ggAddressQuery,
  ggMatchExactLot,
  ggPlanHash,
  ggToCreateData,
  ggVerifyReverseLot,
  gyeonggiSigungu,
  planBucket,
  tierAWindowStart,
  type GgApplyGateInput,
} from './gyeonggi-master-seed-logic';
import { getRegionEnablement } from '../../src/lib/region/enablement';
import { resolveSaleSyncScope, SEOUL_SALE_SYNC_LAWDCDS } from '../../src/lib/sync/sale-sync-scope';

const WINDOW = tierAWindowStart('202609');

function item(p: Partial<Record<keyof RawTradeItem, unknown>>): RawTradeItem {
  return { aptNm: '동신2단지', umdNm: '정자동', umdCd: '10300', jibun: '313-1', buildYear: 1990, roadNm: '정자로', roadNmBonbun: '1', roadNmBubun: '0', dealYear: 2026, dealMonth: 9, dealDay: 1, ...p } as RawTradeItem;
}

function entries(byDistrict: Record<string, RawTradeItem[]>): Map<string, SeedCandidate[]> {
  const m = new Map<string, SeedCandidate[]>();
  for (const [d, items] of Object.entries(byDistrict)) {
    for (const c of aggregateCandidates(d, items.map((i) => ({ item: { sggCd: d, ...i }, source: 'SALE' as const }))).candidates) {
      m.set(c.aptSeq, [...(m.get(c.aptSeq) ?? []), c]);
    }
  }
  return m;
}

const run = (e: Map<string, SeedCandidate[]>, existing: string[] = [], districts: readonly string[] = GYEONGGI_FIRST_BATCH) =>
  classifyGgCandidates({ entriesByAptSeq: e, districts, existingAptSeqs: new Set(existing), windowStart: WINDOW });

const lotDoc = (o: Partial<Record<string, string>> = {}) => ({
  address_type: 'REGION_ADDR', x: '127.0', y: '37.3',
  address: { region_1depth_name: '경기', region_2depth_name: '수원시 장안구', region_3depth_name: '정자동', mountain_yn: 'N', main_address_no: '313', sub_address_no: '1', ...o },
});
const TARGET = { sigungu: '수원시 장안구', dong: '정자동', jibun: '313-1' };

test('1. exact aptSeq identity — one row per aptSeq, keyed by aptSeq', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-41' }), item({ aptSeq: '41111-41', dealDay: 5 })] }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].aptSeq, '41111-41');
  assert.equal(rows[0].status, 'READY');
  assert.equal(rows[0].tradeCount, 2);
});

test('2. no name-only identity — same name, different aptSeq stay separate; missing aptSeq is never seeded', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-41' }), item({ aptSeq: '41111-42', jibun: '400' }), item({ aptSeq: '' })] }));
  assert.deepEqual(rows.map((r) => r.aptSeq), ['41111-41', '41111-42']);
  // 좌표 검색어에 이름이 들어가지 않는다(필지만)
  assert.equal(ggAddressQuery(TARGET), '경기 수원시 장안구 정자동 313-1');
  assert.ok(!ggAddressQuery(TARGET).includes('동신'));
});

test('3. lawdCd mismatch → REVIEW, never auto-fixed', () => {
  // 41113 응답에 실렸지만 aptSeq prefix도 41113인데 sggCd가 다른 구 → SGG_CONFLICT
  const e = entries({ '41113': [item({ aptSeq: '41113-9', sggCd: '41115' })] });
  const rows = run(e);
  assert.equal(rows[0].status, 'REVIEW');
  assert.ok(rows[0].reasons.includes('SGG_CONFLICT'));
  // 이웃 구 응답에 실렸고 표기가 다르면 CONFLICT → REVIEW(어느 쪽도 고르지 않음)
  const e2 = entries({ '41111': [item({ aptSeq: '41111-7' })], '41113': [item({ aptSeq: '41111-7', jibun: '999' })] });
  assert.deepEqual(run(e2)[0].reasons, ['CROSS_DISTRICT_CONFLICT']);
  // 표기가 같으면 prefix 구가 canonical(요청 구로 바꾸지 않음)
  const e3 = entries({ '41111': [item({ aptSeq: '41111-8' })], '41113': [item({ aptSeq: '41111-8' })] });
  const r3 = run(e3)[0];
  assert.equal(r3.status, 'READY');
  assert.equal(r3.district, '41111');
});

test('4. duplicate aptSeq is detected, not resolved', () => {
  assert.deepEqual(findDuplicateAptSeqs([{ aptSeq: 'a' }, { aptSeq: 'b' }, { aptSeq: 'a' }]), ['a']);
  // 원천끼리 지번이 다르면 REVIEW
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-5' }), item({ aptSeq: '41111-5', jibun: '314', dealDay: 2 })] }));
  assert.ok(rows[0].reasons.includes('CONFLICTING_JIBUN'));
});

test('5. no cross-region substitution — other sido / other district prefixes are never seeded', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '11110-1' }), item({ aptSeq: '41171-3' })] }));
  assert.deepEqual(rows.map((r) => r.status), ['OUT_OF_TARGET', 'OUT_OF_TARGET']);
  // 정방향: 다른 시군구 · 다른 시도 결과는 필지가 같아도 채택하지 않는다
  assert.equal(ggMatchExactLot([lotDoc({ region_2depth_name: '수원시 권선구' })], TARGET).status, 'NO_MATCH');
  assert.equal(ggMatchExactLot([lotDoc({ region_1depth_name: '서울' })], TARGET).status, 'NO_MATCH');
  assert.equal(ggMatchExactLot([{ ...lotDoc(), address_type: 'REGION' }], TARGET).status, 'NO_MATCH');
  assert.equal(ggMatchExactLot([lotDoc(), lotDoc()], TARGET).status, 'AMBIGUOUS');
  // 역방향: 이웃 필지면 버린다
  assert.equal(ggVerifyReverseLot({ address: { ...lotDoc().address, sub_address_no: '358' } }, TARGET), 'REVERSE_MISMATCH');
  assert.equal(ggVerifyReverseLot({ address: lotDoc().address }, TARGET), 'VERIFIED');
});

test('6. no master overwrite — existing aptSeq is skipped; module has no update/upsert/delete path', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-41' })] }), ['41111-41']);
  assert.equal(rows[0].status, 'EXISTING_SKIPPED');
  assert.throws(() => ggToCreateData(rows[0], { status: 'VERIFIED', lat: 1, lng: 1 }), /NOT_READY/);
  const src = fs.readFileSync(path.join(__dirname, 'gyeonggi-master-seed-logic.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  for (const w of ['apartmentMaster.', 'prisma.', '.upsert(', '.delete(', 'updateMany', 'deleteMany', 'createMany', '$executeRaw', 'PrismaClient']) assert.ok(!src.includes(w), w);
});

test('7. missing coordinates are null, never fabricated', () => {
  const row = run(entries({ '41111': [item({ aptSeq: '41111-41' })] }))[0];
  for (const status of ['FORWARD_NO_MATCH', 'REVERSE_MISMATCH', 'AMBIGUOUS', 'ERROR'] as const) {
    const c = ggToCreateData(row, { status, lat: 37.1, lng: 127.1 });
    assert.equal(c.latitude, null);
    assert.equal(c.longitude, null);
  }
  assert.equal(ggToCreateData(row, { status: 'FORWARD_NO_MATCH', lat: null, lng: null }).geocodeQuality, 'failed');
  assert.equal(ggToCreateData(row, { status: 'NOT_ATTEMPTED', lat: null, lng: null }).geocodeQuality, null);
  assert.equal(planBucket(row, 'REVERSE_MISMATCH'), 'GEOCODE_MISSING');
  assert.equal(planBucket(row, 'RATE_LIMITED'), 'UNRESOLVED');
  assert.equal(planBucket(row, 'VERIFIED'), 'READY');
  const ok = ggToCreateData(row, { status: 'VERIFIED', lat: 37.3, lng: 127.0 });
  assert.deepEqual([ok.latitude, ok.longitude, ok.geocodeQuality, ok.sido, ok.sigungu], [37.3, 127.0, 'exact', '경기', '수원시 장안구']);
});

test('8. district scope exact — only the requested first-batch districts are READY; gate rejects others', () => {
  const e = entries({ '41111': [item({ aptSeq: '41111-1' })], '41150': [item({ aptSeq: '41150-1', umdNm: '용현동' })] });
  const rows = run(e, [], ['41111']);
  assert.deepEqual(rows.map((r) => [r.aptSeq, r.status]), [['41111-1', 'READY'], ['41150-1', 'OUT_OF_TARGET']]);
  assert.deepEqual([...GYEONGGI_FIRST_BATCH], ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210']);
  const g = evaluateGgApplyGate({ ...okGate(), districts: ['41111', '41171'] });
  assert.ok(g.reasons.includes('DISTRICT_41171_NOT_IN_FIRST_BATCH'));
  assert.equal(gyeonggiSigungu('41150'), '의정부시');
  assert.equal(gyeonggiSigungu('41110'), null); // 비-leaf 시(수원시) — 추정하지 않음
  assert.equal(gyeonggiSigungu('11110'), null);
});

test('9. 41135 is excluded everywhere', () => {
  const rows = run(entries({ '41135': [item({ aptSeq: '41135-157' })] }), [], [...GYEONGGI_FIRST_BATCH, '41135']);
  assert.equal(rows[0].status, 'EXCLUDED_DISTRICT');
  assert.ok(evaluateGgApplyGate({ ...okGate(), districts: ['41135'] }).reasons.includes('DISTRICT_41135_EXCLUDED'));
  assert.ok(!(GYEONGGI_FIRST_BATCH as readonly string[]).includes('41135'));
});

test('10. public exposure unchanged — Gyeonggi stays closed on every axis; apply gate requires an exposure guard', () => {
  for (const d of [...GYEONGGI_FIRST_BATCH, '41135']) {
    assert.deepEqual(getRegionEnablement(d), { app: false, search: false, map: false, detail: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false });
  }
  const g = evaluateGgApplyGate({ ...okGate(), publicExposureGuarded: false });
  assert.deepEqual(g.reasons, ['PUBLIC_EXPOSURE_NOT_GUARDED']);
  assert.equal(evaluateGgApplyGate(okGate()).allowed, true);
});

test('11. cron unchanged — no sale-sync scope contains Gyeonggi', () => {
  const def = resolveSaleSyncScope(null);
  assert.ok(def.ok && def.scope === 'busan' && def.lawdCds === undefined);
  assert.ok(SEOUL_SALE_SYNC_LAWDCDS.every((c) => c.startsWith('11')));
  assert.equal(resolveSaleSyncScope('gyeonggi').ok, false);
});

test('12. no schema change — every create field already exists on ApartmentMaster', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const block = /model ApartmentMaster \{([\s\S]*?)\n\}/.exec(schema)![1];
  const fields = new Set(block.split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean));
  const row = run(entries({ '41111': [item({ aptSeq: '41111-41' })] }))[0];
  for (const k of Object.keys(ggToCreateData(row, { status: 'VERIFIED', lat: 1, lng: 1 }))) assert.ok(fields.has(k), k);
});

test('historical-only complexes are not seeded (Seoul policy parity); window is 24 months', () => {
  assert.equal(WINDOW, '2024-10-01');
  const rows = run(entries({ '41113': [item({ aptSeq: '41113-36', umdNm: '권선동', jibun: '1035', dealYear: 2006, dealMonth: 7 })] }));
  assert.equal(rows[0].status, 'HISTORICAL_EXCLUDED');
});

test('plan hash — any change to a planned create changes the hash; order does not', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-1' }), item({ aptSeq: '41111-2', jibun: '1' })] }));
  const a = rows.map((r) => ggToCreateData(r, { status: 'VERIFIED', lat: 1, lng: 2 }));
  assert.equal(ggPlanHash(a), ggPlanHash([...a].reverse()));
  assert.notEqual(ggPlanHash(a), ggPlanHash([{ ...a[0], latitude: 1.0001 }, a[1]]));
  assert.ok(evaluateGgApplyGate({ ...okGate(), expectPlanHash: 'x' }).reasons.includes('PLAN_HASH_MISMATCH'));
  assert.ok(evaluateGgApplyGate({ ...okGate(), expectInserts: 3 }).reasons.includes('EXPECT_INSERTS_MISMATCH:3!=2'));
});

function okGate(): GgApplyGateInput {
  return { applyFlag: true, allowProdDbWrite: '1', districts: ['41111'], expectInserts: 2, plannedInserts: 2, expectPlanHash: 'h', planHash: 'h', coordinatesSkipped: false, publicExposureGuarded: true };
}
