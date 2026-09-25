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
  return {
    applyFlag: true, allowProdDbRead: '1', allowProdDbWrite: '1', districts: ['41115'], expectInserts: 2, plannedInserts: 2, expectPlanHash: 'h', planHash: 'h',
    coordinatesSkipped: false, publicExposureGuarded: true, reviewInScope: 0, unresolvedInScope: 0, unexpectedExistingMasters: 0,
  };
}

// ── GYEONGGI_MASTER_SEEDING_DRYRUN_V1 ────────────────────────────────────────

import {
  buildPlanHash,
  buildPlanRecord,
  classifyForward,
  insertSetHashes,
  NOT_ATTEMPTED_EVIDENCE,
  planState,
  sharedParcelGroups,
  type CoordEvidence,
} from './gyeonggi-master-seed-logic';

const ev = (status: CoordEvidence['status'], lat: number | null = null, lng: number | null = null): CoordEvidence =>
  ({ ...NOT_ATTEMPTED_EVIDENCE, status, lat, lng });

test('dry-run: forward — 같은 시군구 다른 필지는 NO_MATCH, 다른 시군구뿐이면 CROSS_REGION, 둘 이상 일치는 AMBIGUOUS', () => {
  assert.equal(classifyForward([lotDoc()], TARGET).status, 'EXACT');
  assert.equal(classifyForward([lotDoc({ main_address_no: '314' })], TARGET).status, 'FORWARD_NO_MATCH');
  assert.equal(classifyForward([lotDoc({ region_2depth_name: '수원시 권선구' })], TARGET).status, 'CROSS_REGION');
  assert.equal(classifyForward([lotDoc({ region_1depth_name: '서울' })], TARGET).status, 'CROSS_REGION');
  assert.equal(classifyForward([], TARGET).status, 'FORWARD_NO_MATCH');
  assert.equal(classifyForward([lotDoc(), lotDoc()], TARGET).status, 'AMBIGUOUS');
});

test('dry-run: 상태는 정확히 하나 — identity가 먼저, 좌표는 READY 후보에만', () => {
  const r = (status: string, reasons: string[] = []) => ({ status, reasons }) as never;
  assert.deepEqual(planState(r('READY'), ev('VERIFIED', 1, 2)).state, 'READY');
  assert.deepEqual(planState(r('READY'), ev('FORWARD_NO_MATCH')).state, 'GEOCODE_MISSING');
  assert.deepEqual(planState(r('READY'), ev('REVERSE_MISMATCH')).state, 'GEOCODE_MISSING');
  assert.deepEqual(planState(r('READY'), ev('JIBUN_UNPARSEABLE')).state, 'GEOCODE_MISSING');
  assert.deepEqual(planState(r('READY'), ev('AMBIGUOUS')), { state: 'REVIEW', reasons: ['COORD_AMBIGUOUS_ADDRESS'] });
  assert.deepEqual(planState(r('READY'), ev('CROSS_REGION')), { state: 'REVIEW', reasons: ['COORD_CROSS_REGION_RESULT'] });
  for (const s of ['RATE_LIMITED', 'ERROR', 'NOT_ATTEMPTED'] as const) assert.equal(planState(r('READY'), ev(s)).state, 'UNRESOLVED');
  assert.equal(planState(r('EXISTING_SKIPPED'), ev('VERIFIED', 1, 2)).state, 'SKIP_EXISTING');
  assert.equal(planState(r('HISTORICAL_EXCLUDED'), ev('NOT_ATTEMPTED')).state, 'EXCLUDED_HISTORY_ONLY');
  assert.equal(planState(r('REVIEW', ['SGG_CONFLICT']), ev('VERIFIED', 1, 2)).state, 'REVIEW');
  assert.equal(planState(r('EXCLUDED_DISTRICT'), ev('NOT_ATTEMPTED')).state, 'REVIEW');
});

test('dry-run: 계획 레코드 — READY/GEOCODE_MISSING만 create 필드, 좌표는 VERIFIED만', () => {
  const row = run(entries({ '41111': [item({ aptSeq: '41111-41' })] }))[0];
  const ready = buildPlanRecord(row, ev('VERIFIED', 37.3, 127.0));
  assert.deepEqual([ready.state, ready.fields?.latitude, ready.fields?.geocodeQuality], ['READY', 37.3, 'exact']);
  const miss = buildPlanRecord(row, ev('REVERSE_MISMATCH', 37.3, 127.0));
  assert.deepEqual([miss.state, miss.fields?.latitude, miss.fields?.geocodeQuality], ['GEOCODE_MISSING', null, 'failed']);
  assert.equal(buildPlanRecord(row, ev('RATE_LIMITED')).fields, null);
});

test('dry-run: 같은 필지는 묶어 보고만 하고 aptSeq는 합치지 않는다', () => {
  const rows = run(entries({ '41117': [item({ aptSeq: '41117-1', umdNm: '이의동', jibun: '1' }), item({ aptSeq: '41117-2', umdNm: '이의동', jibun: '1', aptNm: '다른단지' }), item({ aptSeq: '41117-3', umdNm: '이의동', jibun: '2' })] }));
  assert.equal(rows.length, 3);
  assert.deepEqual(sharedParcelGroups(rows), [['41117-1', '41117-2']]);
});

test('dry-run: plan hash는 결정적이고, 상태·필드·창·정책이 바뀌면 달라진다', () => {
  const rows = run(entries({ '41111': [item({ aptSeq: '41111-1' }), item({ aptSeq: '41111-2', jibun: '9' })] }));
  const recs = rows.map((r) => buildPlanRecord(r, ev('VERIFIED', 37.3, 127.0)));
  const h = buildPlanHash({ asOfYm: '202609', districts: ['41111'], records: recs });
  assert.equal(h, buildPlanHash({ asOfYm: '202609', districts: ['41111'], records: [...recs].reverse() }));
  // 증거 부수 필드(문서 수)는 해시에 들어가지 않는다
  assert.equal(h, buildPlanHash({ asOfYm: '202609', districts: ['41111'], records: recs.map((r) => ({ ...r, coordinate: { ...r.coordinate, forwardDocs: 9 } })) }));
  assert.notEqual(h, buildPlanHash({ asOfYm: '202608', districts: ['41111'], records: recs }));
  assert.notEqual(h, buildPlanHash({ asOfYm: '202609', districts: ['41111'], records: [buildPlanRecord(rows[0], ev('FORWARD_NO_MATCH')), recs[1]] }));
  const hs = insertSetHashes([recs[0], buildPlanRecord(rows[1], ev('FORWARD_NO_MATCH'))]);
  assert.equal(hs.withCoords.count, 1);
  assert.equal(hs.withNull.count, 2);
  assert.notEqual(hs.withCoords.hash, hs.withNull.hash);
});


// ── GYEONGGI_MASTER_PILOT_APPLY_PREP_V1 — apply 게이트 · create-only · rollback · 사후 검증 ──────────────

import {
  buildGgAppliedArtifact,
  computePublicExposureGuarded,
  evaluatePostApply,
  evaluateRollbackGate,
  GG_APPLY_ALLOWED_DISTRICTS,
  GG_ROLLBACK_SQL,
  ggPlanHash as ggInsertHash,
  selectInsertSet,
  type GgAppliedArtifact,
  type PlanRecord,
  type PostApplyInput,
  type RollbackDbRow,
} from './gyeonggi-master-seed-logic';
import { isPublicRegionAllowed as publicAllowed } from '../../src/lib/region/enablement';

const PILOT_HASH = '96c97397b1d879c3a3126833b27e6f4262fd2acc5b0546038922776acb075feb';
const RUNNER_SRC = fs.readFileSync(path.join(__dirname, 'gyeonggi-master-seed.ts'), 'utf8');
/** 주석을 뺀 실행 코드. */
const RUNNER = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/** 함수 본문만 잘라 본다(다음 최상위 async function까지). */
const fnBody = (name: string) => {
  const i = RUNNER.indexOf(`async function ${name}(`);
  const j = RUNNER.indexOf('\nasync function ', i + 1);
  return RUNNER.slice(i, j < 0 ? undefined : j);
};

test('apply 1·2·3 — --apply 플래그, 읽기·쓰기 승인, 공개 가드가 모두 있어야 한다', () => {
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), applyFlag: false }).reasons, ['NO_APPLY_FLAG']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), allowProdDbWrite: undefined }).reasons, ['ALLOW_PROD_DB_WRITE_NOT_1']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), allowProdDbRead: '0' }).reasons, ['ALLOW_PROD_DB_READ_NOT_1']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), publicExposureGuarded: false }).reasons, ['PUBLIC_EXPOSURE_NOT_GUARDED']);
  const apply = fnBody('runApply');
  assert.ok(apply.indexOf('requireGuard()') < apply.indexOf('planDistricts('), '가드 확인 전에 계획한다');
  assert.ok(/if \(!preflight\) assertProductionDbAccessAllowed\('BACKFILL'/.test(apply), '쓰기 승인(ALLOW_PROD_DB_WRITE) 확인이 없다');
  assert.ok(apply.indexOf("assertProductionDbAccessAllowed('BACKFILL'") < apply.indexOf('$transaction'), '쓰기 승인 확인이 트랜잭션 뒤다');
  assert.ok(apply.indexOf('if (!gate.allowed)') < apply.indexOf('apartmentMaster.create('), '게이트가 insert 뒤다');
  assert.ok(/if \(modes\[0\] === 'apply'\) await runApply\(prisma\);/.test(RUNNER), 'apply 모드는 --apply로만 들어간다');
});

test('apply 4·5 — 파일럿 잠금: 41115 하나만, 41135·다른 구·여러 구는 거부', () => {
  assert.deepEqual([...GG_APPLY_ALLOWED_DISTRICTS], ['41115']);
  assert.equal(evaluateGgApplyGate(okGate()).allowed, true);
  assert.ok(evaluateGgApplyGate({ ...okGate(), districts: ['41131'] }).reasons.includes('DISTRICT_41131_NOT_IN_APPLY_SCOPE'));
  assert.ok(evaluateGgApplyGate({ ...okGate(), districts: ['41135'] }).reasons.includes('DISTRICT_41135_EXCLUDED'));
  assert.ok(evaluateGgApplyGate({ ...okGate(), districts: ['41115', '41111'] }).reasons.includes('EXACTLY_ONE_DISTRICT_REQUIRED'));
  assert.ok(evaluateGgApplyGate({ ...okGate(), districts: [] }).reasons.includes('DISTRICT_FILTER_REQUIRED'));
});

test('apply 6·7 — expect-inserts·plan hash가 재계획과 다르면 거부, 계획 미완결(REVIEW·UNRESOLVED)도 거부', () => {
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), expectInserts: 115 }).reasons, ['EXPECT_INSERTS_MISMATCH:115!=2']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), expectInserts: null }).reasons, ['EXPECT_INSERTS_REQUIRED']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), expectPlanHash: 'deadbeef' }).reasons, ['PLAN_HASH_MISMATCH']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), expectPlanHash: null }).reasons, ['EXPECT_PLAN_HASH_REQUIRED']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), reviewInScope: 1 }).reasons, ['REVIEW_IN_SCOPE:1']);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), unresolvedInScope: 2 }).reasons, ['UNRESOLVED_IN_SCOPE:2']);
  // 해시는 aptSeq·필드·좌표가 하나라도 바뀌면 달라진다
  const rows = run(entries({ '41115': [item({ aptSeq: '41115-1', umdNm: '화서동', jibun: '650' })] }));
  const c = ggToCreateData(rows[0], { status: 'VERIFIED', lat: 37.28, lng: 127.0 });
  assert.notEqual(ggInsertHash([c]), ggInsertHash([{ ...c, longitude: 127.00001 }]));
  assert.notEqual(ggInsertHash([c]), ggInsertHash([{ ...c, name: '다른이름' }]));
});

test('apply 8 — 기존 master는 덮어쓰지 않는다: SKIP_EXISTING은 insert 집합 밖, 출처 불명 기존 master는 HOLD', () => {
  const rows = run(entries({ '41115': [item({ aptSeq: '41115-1', umdNm: '화서동' })] }), ['41115-1']);
  const rec = buildPlanRecord(rows[0], ev('VERIFIED', 37.28, 127.0));
  assert.equal(rec.state, 'SKIP_EXISTING');
  assert.equal(rec.fields, null);
  assert.deepEqual(selectInsertSet([rec], ['41115'], { allowNullCoords: true }), []);
  assert.deepEqual(evaluateGgApplyGate({ ...okGate(), unexpectedExistingMasters: 3 }).reasons, ['UNEXPECTED_EXISTING_MASTERS:3']);
  const apply = fnBody('runApply');
  assert.ok(/EXISTING_BEFORE_INSERT/.test(apply), '트랜잭션 안에서 기존 aptSeq를 다시 확인하지 않는다');
  assert.ok(apply.indexOf('EXISTING_BEFORE_INSERT') < apply.indexOf('apartmentMaster.create('));
});

test('apply 9·11·12·13 — create-only: 쓰기는 tx.apartmentMaster.create 하나뿐, upsert·update·delete 없음', () => {
  const apply = fnBody('runApply');
  assert.equal((RUNNER.match(/apartmentMaster\.create\(/g) || []).length, 1, 'create 경로가 하나가 아니다');
  assert.ok(/tx\.apartmentMaster\.create\(\{ data,/.test(apply));
  for (const w of ['.upsert(', '.update(', '.updateMany(', '.createMany(', '.delete(', '.deleteMany(']) assert.ok(!RUNNER.includes(w), w);
  assert.ok(!/DELETE|UPDATE |INSERT /.test(apply), 'apply에 raw 쓰기 SQL이 있다');
  assert.ok(!/\$executeRaw(?!Unsafe\('SET TRANSACTION READ ONLY'\))/.test(fnBody('planDistricts') + apply), 'apply/계획에 raw 실행이 있다');
  // DELETE는 rollback 한 곳에서, 3중 조건 SQL로만
  const executes = RUNNER.match(/\$executeRawUnsafe\(([^)]*)\)/g) || [];
  assert.deepEqual(executes.filter((x) => !x.includes('SET TRANSACTION READ ONLY')), ['$executeRawUnsafe(GG_ROLLBACK_SQL, p.ids, p.sggCd, p.from, p.to)']);
  assert.ok(fnBody('runRollback').includes('GG_ROLLBACK_SQL'));
  // 삽입 데이터는 구 가드를 한 번 더 통과한다
  assert.ok(/if \(data\.sggCd !== district \|\| !data\.aptSeq\.startsWith\(`\$\{district\}-`\)\) throw/.test(apply));
});

test('apply 6(실패) — insert 하나라도 실패하면 트랜잭션 전체가 되돌려지고 aptSeq를 보고한다', () => {
  const apply = fnBody('runApply');
  assert.ok(/failed\.push\(\{ aptSeq: data\.aptSeq/.test(apply));
  assert.ok(/throw e;/.test(apply), '실패 후 다음 행으로 넘어간다(부분 적재)');
  assert.ok(/APPLY_FAILED\(rolled back, inserted 0\)/.test(apply));
});

function artifactOf(n: number, district = '41115'): GgAppliedArtifact {
  const inserted = Array.from({ length: n }, (_, i) => ({
    aptSeq: `${district}-${i + 1}`, id: 9000 + i, sggCd: district,
    createdAt: `2026-09-26T01:00:00.${String(100 + i).padStart(3, '0')}Z`, updatedAt: `2026-09-26T01:00:00.${String(100 + i).padStart(3, '0')}Z`,
  }));
  return buildGgAppliedArtifact({ runId: 'run-1', policy: 'gg-master-seed/v1', district, planHash: PILOT_HASH, expectInserts: n, dbHostKind: 'PRODUCTION', inserted, failed: [], preCountsBySido: { '11': 6843, '26': 3438 } });
}
const dbRowsOf = (a: GgAppliedArtifact): RollbackDbRow[] => a.inserted.map((r) => ({ id: r.id, apt_seq: r.aptSeq, sgg_cd: r.sggCd, created_at: r.createdAt, updated_at: r.updatedAt }));

test('apply 10 — rollback은 기록된 id 목록 + 구 + created_at 창 3중 조건, 모든 행이 기록과 같을 때만', () => {
  assert.ok(/id = ANY\(\$1::int\[\]\) AND sgg_cd = \$2 AND created_at BETWEEN \$3::timestamp AND \$4::timestamp/.test(GG_ROLLBACK_SQL));
  assert.ok(!/WHERE sgg_cd = \$\d+\s*$/.test(GG_ROLLBACK_SQL), '구만으로 지운다');
  const a = artifactOf(3);
  assert.deepEqual(a.rollback.params, { ids: [9000, 9001, 9002], sggCd: '41115', from: '2026-09-26T01:00:00.100Z', to: '2026-09-26T01:00:00.102Z' });
  const ok = { rollbackFlag: true, allowProdDbWrite: '1', runIdArg: 'run-1', expectDeletes: 3, artifact: a, dbRows: dbRowsOf(a) };
  assert.deepEqual(evaluateRollbackGate(ok), { allowed: true, reasons: [] });
  assert.ok(evaluateRollbackGate({ ...ok, runIdArg: 'run-2' }).reasons.includes('RUN_ID_MISMATCH'));
  assert.ok(evaluateRollbackGate({ ...ok, expectDeletes: 4 }).reasons.includes('EXPECT_DELETES_MISMATCH:4!=3'));
  assert.ok(evaluateRollbackGate({ ...ok, allowProdDbWrite: undefined }).reasons.includes('ALLOW_PROD_DB_WRITE_NOT_1'));
  const rows = dbRowsOf(a);
  assert.ok(evaluateRollbackGate({ ...ok, dbRows: rows.slice(0, 2) }).reasons.includes('ROWS_MISSING:1'));
  assert.ok(evaluateRollbackGate({ ...ok, dbRows: [{ ...rows[0], apt_seq: '41115-999' }, ...rows.slice(1)] }).reasons.includes('ROWS_IDENTITY_MISMATCH:1'));
  assert.ok(evaluateRollbackGate({ ...ok, dbRows: [{ ...rows[0], updated_at: '2026-09-27T00:00:00.000Z' }, ...rows.slice(1)] }).reasons.includes('ROWS_MODIFIED_SINCE_INSERT:1'));
  assert.ok(evaluateRollbackGate({ ...ok, dbRows: [{ ...rows[0], created_at: '2026-09-25T00:00:00.000Z' }, ...rows.slice(1)] }).reasons.includes('ROWS_OUTSIDE_CREATED_WINDOW:1'));
  assert.ok(evaluateRollbackGate({ ...ok, artifact: artifactOf(0) , expectDeletes: 0, dbRows: [] }).reasons.includes('NOTHING_TO_ROLL_BACK'));
  assert.ok(evaluateRollbackGate({ ...ok, artifact: { ...a, district: '41135' } }).reasons.includes('DISTRICT_41135_NOT_IN_APPLY_SCOPE'));
  // 실행기: 삭제 수가 기록과 다르면 트랜잭션을 되돌린다
  assert.ok(/if \(n !== ids\.length\) throw/.test(fnBody('runRollback')));
});

test('apply 사후 검증 — +116만, 다른 시도 0, 좌표·구·중복·거래 연결·공개 차단을 모두 본다', () => {
  const a = artifactOf(3);
  const good: PostApplyInput & { live: NonNullable<PostApplyInput['live']> } = {
    artifact: a,
    districtRows: a.inserted.map((r) => ({ apt_seq: r.aptSeq, sgg_cd: '41115', latitude: 37.28, longitude: 127.0 })),
    postCountsBySido: { '11': 6843, '26': 3438, '41': 3 },
    tradeLinkedAptSeqs: new Set(a.inserted.map((r) => r.aptSeq)),
    publicExposureGuarded: true,
    live: { searchResults: 0, mapUnsupported: true, detailUnsupported: true, sitemapGyeonggi: 0 },
  };
  assert.equal(evaluatePostApply(good).pass, true);
  const fail = (patch: Partial<typeof good>, name: string) => {
    const r = evaluatePostApply({ ...good, ...patch });
    assert.equal(r.pass, false, name);
    assert.equal(r.checks.find((c) => c.name === name)?.pass, false, name);
  };
  fail({ postCountsBySido: { '11': 6844, '26': 3438, '41': 3 } }, 'MASTER_COUNT_DELTA');
  fail({ districtRows: [...good.districtRows, good.districtRows[0]] }, 'NO_DUPLICATE_APTSEQ');
  fail({ districtRows: good.districtRows.map((r, i) => (i ? r : { ...r, latitude: null })) }, 'COORDS_COMPLETE');
  fail({ tradeLinkedAptSeqs: new Set(['41115-1']) }, 'TRADE_LINKAGE');
  fail({ publicExposureGuarded: false }, 'PUBLIC_EXPOSURE_GUARDED');
  fail({ live: { ...good.live, searchResults: 1 } }, 'LIVE_SEARCH_BLOCKED');
  fail({ live: { ...good.live, sitemapGyeonggi: 2 } }, 'LIVE_SITEMAP_GYEONGGI_0');
});

test('apply 14·15 — 공개·cron 불변: 경기 공개 축 0, sale-sync scope에 경기 없음, 실행기는 enablement를 바꾸지 않는다', () => {
  assert.deepEqual(computePublicExposureGuarded((c, axis) => publicAllowed(c, axis)), { guarded: true, openAxes: [] });
  const crons = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')).crons as { path: string }[];
  assert.ok(!crons.some((c) => /gyeonggi|scope=(?!seoul)/.test(c.path)), 'cron에 경기 scope가 있다');
  assert.equal(resolveSaleSyncScope('gyeonggi').ok, false);
  assert.ok(!/ENABLEMENT|SEOUL_BETA|enablement\.ts'\)\s*\./.test(RUNNER));
  assert.ok(!/writeFileSync\([^)]*src\//.test(RUNNER), '실행기가 소스 파일을 쓴다');
});

test('apply 16 — dry-run 동작 불변: 기본 모드는 dry-run, 좌표 조회는 dry-run만, apply는 checkpoint만', () => {
  assert.ok(/else await runDryRun\(prisma\);/.test(RUNNER));
  assert.ok(/planDistricts\(prisma, \{ districts, asOfYm, resume: flag\('resume'\), allowGeocode: true \}\)/.test(fnBody('runDryRun')));
  assert.ok(/planDistricts\(prisma, \{ districts, asOfYm, resume: true, allowGeocode: false \}\)/.test(fnBody('runApply')));
  assert.ok(/else if \(opts\.allowGeocode && !stoppedBy\)/.test(fnBody('planDistricts')), 'apply가 Kakao를 부를 수 있다');
  assert.ok(/--apply는 --resume과 함께 쓰지 않는다/.test(RUNNER));
});

test('apply null 좌표 정책 분리 — GEOCODE_MISSING은 allowNullCoords를 명시해야만 들어간다(기본 제외)', () => {
  const rows = run(entries({ '41115': [item({ aptSeq: '41115-1', umdNm: '화서동' }), item({ aptSeq: '41115-2', umdNm: '화서동', jibun: '7' })] }));
  const recs: PlanRecord[] = [buildPlanRecord(rows[0], ev('VERIFIED', 37.28, 127.0)), buildPlanRecord(rows[1], ev('REVERSE_MISMATCH'))];
  assert.deepEqual(selectInsertSet(recs, ['41115'], { allowNullCoords: false }).map((c) => c.aptSeq), ['41115-1']);
  assert.deepEqual(selectInsertSet(recs, ['41115'], { allowNullCoords: true }).map((c) => c.aptSeq), ['41115-1', '41115-2']);
  assert.deepEqual(selectInsertSet(recs, ['41111'], { allowNullCoords: true }), [], '다른 구 행을 싣는다');
  assert.ok(/const allowNullCoords = flag\('allow-null-coords'\);/.test(fnBody('runApply')));
});

// 17·18 — 실제 dry-run 산출물이 있을 때만(로컬 tmp, 커밋하지 않음). 없으면 건너뛴다.
const PLAN_FILE = path.join(__dirname, '../../tmp/gyeonggi-master-seed/plan.json');
const planJson = fs.existsSync(PLAN_FILE) ? (JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')) as { records: PlanRecord[] }) : null;

test('apply 17·18 — 41115 파일럿 계획: 정확히 116행, 좌표 116/116, 해시 고정', { skip: planJson ? false : 'tmp/gyeonggi-master-seed/plan.json 없음(로컬 산출물)' }, () => {
  const recs = planJson!.records.filter((r) => r.district === '41115');
  const creates = selectInsertSet(planJson!.records, ['41115'], { allowNullCoords: false });
  assert.equal(creates.length, 116);
  assert.equal(creates.filter((c) => c.latitude != null && c.longitude != null && c.geocodeQuality === 'exact').length, 116);
  assert.equal(ggInsertHash(creates), PILOT_HASH);
  assert.deepEqual(selectInsertSet(planJson!.records, ['41115'], { allowNullCoords: true }).length, 116, 'null 좌표 정책과 무관해야 한다');
  assert.ok(creates.every((c) => c.sggCd === '41115' && c.aptSeq.startsWith('41115-') && c.sido === '경기' && c.sigungu === '수원시 팔달구'));
  assert.equal(new Set(creates.map((c) => c.aptSeq)).size, 116);
  assert.equal(recs.filter((r) => ['REVIEW', 'UNRESOLVED', 'GEOCODE_MISSING', 'SKIP_EXISTING'].includes(r.state)).length, 0);
});
