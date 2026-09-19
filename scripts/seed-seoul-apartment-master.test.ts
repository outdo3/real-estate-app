import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  APPLIED_ARTIFACT_SCHEMA,
  buildTierARows,
  evaluateApplyGates,
  fetchSaleCell,
  matchExactLot,
  parseJibun,
  toCreateData,
  type AddressSearchOutcome,
  type KakaoAddressDoc,
  type PageFetcher,
  type PageOutcome,
} from './seed-seoul-apartment-master-logic';
import { parseCli, runSeed, type ReadOnlySeedDb, type SeedDeps, type SeedOptions, type WritableSeedDb } from './seed-seoul-apartment-master';
import type { RawTradeItem } from './seoul-master-seed-plan-logic';

// SEOUL_MASTER_SEED_SCRIPT_V1 — 네트워크·DB 없이 가짜 의존성으로 안전장치 전부를 검증한다.

const MONTHS = ['202609', '202608'];
const DISTRICT_NAME: Record<string, string> = { '11140': '중구', '11200': '성동구', '11680': '강남구', '11350': '노원구' };

function item(o: Partial<RawTradeItem> & { aptSeq?: unknown } = {}): RawTradeItem {
  return { aptSeq: '11140-1', aptNm: '남산타운', umdNm: '신당동', umdCd: '16200', jibun: '844', sggCd: '11140', buildYear: '2002', dealYear: '2026', dealMonth: '9', dealDay: '1', ...o };
}

type Cell = RawTradeItem[] | { fail: PageOutcome['kind']; page?: number };
/** 셀 데이터로 페이지를 흉내 낸다(pageSize를 존중). fail.page가 있으면 그 페이지에서 실패. */
function fakeFetch(data: Record<string, Record<string, Cell>>, log: string[] = []): PageFetcher {
  return async (lawdCd, ym, pageNo, numOfRows) => {
    log.push(`${lawdCd}:${ym}:${pageNo}`);
    const cell = data[lawdCd]?.[ym] ?? [];
    if (!Array.isArray(cell)) {
      if ((cell.page ?? 1) === pageNo) return { kind: cell.fail as Exclude<PageOutcome['kind'], 'OK'>, detail: 'fake' };
      return { kind: 'OK', totalCount: 1500, items: Array.from({ length: pageNo === 1 ? 1000 : 500 }, (_, i) => item({ aptSeq: `${lawdCd}-${9000 + i}` })) };
    }
    return { kind: 'OK', totalCount: cell.length, items: cell.slice((pageNo - 1) * numOfRows, pageNo * numOfRows) };
  };
}

function exactDoc(districtName: string, dong: string, jibun: string, x = '126.99', y = '37.55'): KakaoAddressDoc {
  const [main, sub] = jibun.split('-');
  return { address_type: 'REGION_ADDR', x, y, address: { region_1depth_name: '서울', region_2depth_name: districtName, region_3depth_name: dong, mountain_yn: 'N', main_address_no: main, sub_address_no: sub ?? '' } };
}
/** 주소 질의("서울 {구} {동} {지번}")를 그대로 해석해 필지 일치 결과를 돌려주는 가짜 Kakao. */
function fakeKakao(opts: { rateLimitAfter?: number; calls?: string[] } = {}) {
  let n = 0;
  return async (q: string): Promise<AddressSearchOutcome> => {
    opts.calls?.push(q);
    n++;
    if (opts.rateLimitAfter != null && n > opts.rateLimitAfter) return { kind: 'RATE_LIMITED', detail: 'fake' };
    const [, gu, dong, jibun] = q.split(' ');
    return { kind: 'OK', docs: [exactDoc(gu, dong, jibun)] };
  };
}

interface MasterRow { id: number; aptSeq: string; sggCd: string; name: string; latitude: number | null; createdAt: string }
function fakeDb(initial: MasterRow[] = []) {
  const rows = initial.map((r) => ({ ...r }));
  const queried: string[] = [];
  let writeDbCreated = 0;
  let nextId = 1000;
  const find = async (seqs: readonly string[]) => { queried.push(...seqs); return new Set(rows.filter((r) => seqs.includes(r.aptSeq)).map((r) => r.aptSeq)); };
  const read: ReadOnlySeedDb = { mode: 'READ_ONLY', hostKind: 'NON_PRODUCTION', findExistingAptSeqs: find };
  const write: WritableSeedDb = {
    mode: 'CREATE_ONLY', hostKind: 'NON_PRODUCTION', findExistingAptSeqs: find,
    async createMaster(data) {
      if (rows.some((r) => r.aptSeq === data.aptSeq)) return 'DUPLICATE';
      const row = { id: nextId++, aptSeq: data.aptSeq, sggCd: data.sggCd, name: data.name, latitude: data.latitude, createdAt: '2026-09-19T00:00:00.000Z' };
      rows.push(row);
      return { id: row.id, aptSeq: row.aptSeq, sggCd: row.sggCd, createdAt: row.createdAt };
    },
  };
  return { rows, queried, read, write, get writeDbCreated() { return writeDbCreated; }, markWrite() { writeDbCreated++; } };
}

function setup(o: {
  data: Record<string, Record<string, Cell>>;
  db?: ReturnType<typeof fakeDb>;
  opts?: Partial<SeedOptions>;
  deps?: Partial<SeedDeps>;
  outDir?: string;
  fetchLog?: string[];
}) {
  const outDir = o.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-seed-'));
  const db = o.db ?? fakeDb();
  const logs: string[] = [];
  const opts: SeedOptions = { outDir, months: MONTHS, districts: Object.keys(o.data), apply: false, allowProdDbWrite: undefined, expectReady: null, skipCoordinates: false, refetch: false, ...o.opts };
  const deps: SeedDeps = {
    fetchPage: fakeFetch(o.data, o.fetchLog), searchAddress: fakeKakao(), readDb: async () => db.read,
    writeDb: async () => { db.markWrite(); return db.write; }, now: () => new Date('2026-09-19T00:00:00Z'), log: (m) => logs.push(m), ...o.deps,
  };
  return { outDir, db, logs, run: () => runSeed(opts, deps) };
}
const readOut = (dir: string, f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const seed = (dir: string) => fs.readFileSync(path.resolve(__dirname, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('1 · 1000행 초과 셀 — totalCount까지 모든 페이지를 읽어 COMPLETE', async () => {
  const rows = Array.from({ length: 1042 }, (_, i) => item({ aptSeq: `11350-${i}` }));
  const c = await fetchSaleCell(fakeFetch({ '11350': { '202609': rows } }), '11350', '202609');
  assert.equal(c.status, 'COMPLETE');
  assert.equal(c.pages, 2);
  assert.equal(c.collected, 1042);
});

test('2 · 수집 개수 ≠ totalCount 이면 PARTIAL(1쪽만 읽고 완료로 보지 않는다)', async () => {
  const short: PageFetcher = async (_l, _y, p) => ({ kind: 'OK', totalCount: 1200, items: p === 1 ? Array.from({ length: 1000 }, () => item()) : Array.from({ length: 150 }, () => item()) });
  const c = await fetchSaleCell(short, '11350', '202609');
  assert.equal(c.status, 'PARTIAL');
  assert.match(c.errors[0], /COUNT_MISMATCH/);
});

test('3 · HTTP 오류는 빈 결과가 아니라 ERROR', async () => {
  const c = await fetchSaleCell(fakeFetch({ '11140': { '202609': { fail: 'HTTP_ERROR' } } }), '11140', '202609');
  assert.equal(c.status, 'ERROR');
  assert.equal(c.totalCount, null);
  assert.notEqual(c.status, 'COMPLETE');
});

test('4 · 파싱 오류(첫 페이지 ERROR, 이후 페이지 PARTIAL) · 타임아웃도 동일', async () => {
  assert.equal((await fetchSaleCell(fakeFetch({ a: { m: { fail: 'PARSE_ERROR' } } }), 'a', 'm')).status, 'ERROR');
  const later = await fetchSaleCell(fakeFetch({ a: { m: { fail: 'PARSE_ERROR', page: 2 } } }), 'a', 'm');
  assert.equal(later.status, 'PARTIAL');
  assert.equal(later.collected, 1000);
  assert.equal((await fetchSaleCell(fakeFetch({ a: { m: { fail: 'TIMEOUT' } } }), 'a', 'm')).status, 'ERROR');
});

test('5 · 셀 하나라도 실패한 구는 통째로 보류 — 그 구 insert 0, 그 구로 귀속될 행도 보류', async () => {
  const s = setup({ data: {
    '11140': { '202609': [item(), item({ aptSeq: '11350-7', sggCd: '11140' })], '202608': [] },
    '11350': { '202609': [item({ aptSeq: '11350-1', umdNm: '상계동', umdCd: '10500', jibun: '1', sggCd: '11350' })], '202608': { fail: 'TIMEOUT' } },
  } });
  const r = await s.run();
  assert.equal(r.summary.districtStates['11350'], 'PARTIAL');
  assert.equal(r.summary.readyByDistrict['11350'], 0);
  assert.equal(r.rows.find((x) => x.aptSeq === '11350-7')!.status, 'HELD_BACK_PARTIAL_DISTRICT');
  assert.equal(r.rows.find((x) => x.aptSeq === '11140-1')!.status, 'READY');
  assert.equal(readOut(s.outDir, 'source-errors.json').length, 1);
});

test('6 · 이미 있는 aptSeq는 SKIP(비교만, 변경 없음)', async () => {
  const db = fakeDb([{ id: 1, aptSeq: '11140-1', sggCd: '11140', name: '옛이름', latitude: null, createdAt: 'x' }]);
  const r = await setup({ data: { '11140': { '202609': [item()], '202608': [] } }, db }).run();
  assert.equal(r.rows[0].status, 'EXISTING_SKIPPED');
  assert.equal(db.rows[0].name, '옛이름');
});

test('7 · aptSeq 없는 원천 행은 후보가 되지 않는다(추정 aptSeq 없음)', async () => {
  const r = await setup({ data: { '11140': { '202609': [item({ aptSeq: '' }), item({ aptSeq: undefined }), item()], '202608': [] } } }).run();
  assert.deepEqual(r.rows.map((x) => x.aptSeq), ['11140-1']);
});

test('8 · 서울이 아닌 aptSeq는 REVIEW(적재 안 함)', async () => {
  const r = await setup({ data: { '11140': { '202609': [item({ aptSeq: '26350-2' })], '202608': [] } } }).run();
  assert.equal(r.rows[0].status, 'REVIEW_REQUIRED');
  assert.deepEqual(r.rows[0].reasons, ['NON_SEOUL_OR_MALFORMED_APTSEQ']);
});

test('9 · 이웃 구 응답에 실린 같은 aptSeq — aptSeq 앞 5자리 구로 정정하고 기록', async () => {
  const s = setup({ data: {
    '11140': { '202609': [item({ aptSeq: '11140-1012', aptNm: '한진해모로', jibun: '845' })], '202608': [] },
    '11200': { '202609': [item({ aptSeq: '11140-1012', aptNm: '한진해모로', jibun: '845', sggCd: '11200' })], '202608': [] },
  } });
  const r = await s.run();
  const rows = r.rows.filter((x) => x.aptSeq === '11140-1012');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].district, '11140');
  assert.equal(rows[0].status, 'READY');
  assert.deepEqual(readOut(s.outDir, 'identity-corrections.json')[0].reportedIn, ['11140', '11200']);
});

test('10·11 · 같은 이름·같은 지번의 다른 aptSeq는 각각 유지(merge 없음)', async () => {
  const r = await setup({ data: { '11140': { '202609': [
    item({ aptSeq: '11140-1', aptNm: '현대', jibun: '10' }), item({ aptSeq: '11140-2', aptNm: '현대아파트', jibun: '10' }),
  ], '202608': [] } } }).run();
  assert.deepEqual(r.rows.map((x) => [x.aptSeq, x.status]), [['11140-1', 'READY'], ['11140-2', 'READY']]);
});

test('12 · create-only — 쓰기 경로는 create 하나뿐, update/upsert/delete 없음', async () => {
  for (const f of ['seed-seoul-apartment-master.ts', 'seed-seoul-apartment-master-logic.ts']) {
    const src = seed(f);
    assert.ok(!/\.(update|upsert|delete|updateMany|deleteMany|createMany)\s*\(/.test(src), `${f}에 create 외 쓰기 경로`);
    assert.ok(!/\$executeRaw(Unsafe)?\((?!'SET TRANSACTION READ ONLY')/.test(src), `${f}에 raw write 가능 경로`);
    assert.ok(!/deduplicateCoordinates|findMany\(\s*\{\s*where:\s*\{\s*latitude/.test(src), `${f}에 전역 좌표 정리`);
  }
  const db = fakeDb([{ id: 1, aptSeq: '11140-1', sggCd: '11140', name: '기존', latitude: 1, createdAt: 'x' }]);
  const before = JSON.stringify(db.rows);
  const s = setup({ data: { '11140': { '202609': [item(), item({ aptSeq: '11140-2', jibun: '1' })], '202608': [] } }, db,
    opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 1 } });
  await s.run();
  assert.equal(JSON.stringify(db.rows.filter((r) => r.id === 1)), JSON.stringify(JSON.parse(before)));
  assert.equal(db.rows.length, 2);
});

test('13 · 좌표 — 구·법정동·본번·부번이 모두 같은 단일 지번 결과만 채택', () => {
  const r = matchExactLot([exactDoc('중구', '신당동', '845-3')], { districtName: '중구', dong: '신당동', jibun: '845-3' });
  assert.equal(r.status, 'EXACT');
  assert.equal(r.lat, 37.55);
  assert.deepEqual(parseJibun('산12-003'), { mountain: true, main: '12', sub: '3' });
  assert.deepEqual(parseJibun('0845-0'), { mountain: false, main: '845', sub: '' });
});

test('14 · 필지 불일치 · 동 대표점 · 다른 구 · 여러 개 일치는 채택하지 않는다', () => {
  const exp = { districtName: '중구', dong: '신당동', jibun: '845' };
  assert.equal(matchExactLot([exactDoc('중구', '신당동', '845-1')], exp).status, 'NO_MATCH');
  assert.equal(matchExactLot([{ ...exactDoc('중구', '신당동', '845'), address_type: 'REGION' }], exp).status, 'NO_MATCH');
  assert.equal(matchExactLot([exactDoc('성동구', '신당동', '845')], exp).status, 'NO_MATCH');
  assert.equal(matchExactLot([exactDoc('중구', '신당동', '845'), exactDoc('중구', '신당동', '845', '127', '37.6')], exp).status, 'AMBIGUOUS');
  assert.equal(matchExactLot([exactDoc('중구', '신당동', '845')], { ...exp, jibun: '블록1' }).status, 'JIBUN_UNPARSEABLE');
});

test('15 · 키워드(단지명) 검색은 호출도 저장도 하지 않는다 — 좌표는 EXACT일 때만 create 데이터에 들어간다', async () => {
  for (const f of ['seed-seoul-apartment-master.ts', 'seed-seoul-apartment-master-logic.ts']) assert.ok(!/keyword\.json/.test(seed(f)), f);
  const calls: string[] = [];
  const r = await setup({ data: { '11140': { '202609': [item()], '202608': [] } }, deps: { searchAddress: fakeKakao({ calls }) } }).run();
  assert.deepEqual(calls, ['서울 중구 신당동 844']);
  const miss = { ...r.rows[0], coordinateStatus: 'NO_MATCH' as const, lat: 1, lng: 2 };
  assert.equal(toCreateData(miss).latitude, null);
  assert.equal(toCreateData(miss).geocodeQuality, 'failed');
  assert.equal(toCreateData(r.rows[0]).geocodeQuality, 'exact');
  assert.deepEqual(Object.keys(toCreateData(r.rows[0])).sort(), ['aptSeq', 'buildYear', 'geocodeQuality', 'jibun', 'latitude', 'longitude', 'name', 'normalizedName', 'sggCd', 'sido', 'sigungu', 'umdCd', 'umdName'].sort(), 'roadAddress 등 enrichment 필드 없음');
});

test('16 · 부산 행 불변 — DB 조회는 서울 aptSeq로만, apply 후 부산 행 그대로', async () => {
  const busan = [
    { id: 1, aptSeq: '26350-2', sggCd: '26350', name: '경동', latitude: 35.1, createdAt: 'x' },
    { id: 2, aptSeq: '26230-148', sggCd: '26230', name: '서면', latitude: 35.1, createdAt: 'x' },
  ];
  const db = fakeDb(busan);
  const before = JSON.stringify(db.rows);
  await setup({ data: { '11140': { '202609': [item()], '202608': [] } }, db, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 1 } }).run();
  assert.equal(JSON.stringify(db.rows.filter((r) => r.sggCd.startsWith('26'))), before);
  assert.ok(db.queried.every((s) => s.startsWith('11')), '부산 aptSeq를 조회하지 않는다');
});

test('17 · Tier B(전월세 전용)는 원천에서 빠지고, 계획 Tier B aptSeq가 매매에 나타나도 제외', async () => {
  for (const f of ['seed-seoul-apartment-master.ts']) assert.ok(!/RTMSDataSvcAptRent/.test(seed(f)), '전월세 API를 호출하지 않는다');
  const s = setup({ data: { '11140': { '202609': [item(), item({ aptSeq: '11140-5303', jibun: '99' })], '202608': [] } }, deps: { planExclusions: new Map([['11140-5303', 'TIER_B']]) } });
  const r = await s.run();
  assert.equal(r.rows.find((x) => x.aptSeq === '11140-5303')!.status, 'EXCLUDED_PLAN_TIER_B');
  assert.equal(readOut(s.outDir, 'excluded-tier-b.json').rows.length, 1);
  assert.ok(!readOut(s.outDir, 'ready-to-insert.json').some((x: { aptSeq: string }) => x.aptSeq === '11140-5303'));
});

test('18 · REVIEW(계획 REVIEW · 원천 위치 충돌)는 ready에 없다', async () => {
  const r = await setup({ data: { '11140': { '202609': [
    item({ aptSeq: '11140-9', jibun: '1' }), item({ aptSeq: '11140-3', jibun: '10' }), item({ aptSeq: '11140-3', jibun: '11', dealMonth: '8' }),
  ], '202608': [] } }, deps: { planExclusions: new Map([['11140-9', 'REVIEW']]) } }).run();
  assert.equal(r.rows.find((x) => x.aptSeq === '11140-9')!.status, 'EXCLUDED_PLAN_REVIEW');
  assert.equal(r.rows.find((x) => x.aptSeq === '11140-3')!.status, 'REVIEW_REQUIRED');
  assert.equal(r.summary.byStatus.READY, 0);
});

test('19 · 구별 checkpoint — 완료 구는 재사용, 실패 구만 다시 수집 · 좌표는 끊긴 곳부터', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-seed-'));
  const data: Record<string, Record<string, Cell>> = {
    '11140': { '202609': [item(), item({ aptSeq: '11140-2', jibun: '2' }), item({ aptSeq: '11140-3', jibun: '3' })], '202608': [] },
    '11350': { '202609': [item({ aptSeq: '11350-1', umdNm: '상계동', umdCd: '10500', jibun: '1', sggCd: '11350' })], '202608': { fail: 'HTTP_ERROR' } },
  };
  const kakaoCalls1: string[] = [];
  const r1 = await setup({ data, outDir, deps: { searchAddress: fakeKakao({ rateLimitAfter: 1, calls: kakaoCalls1 }) } }).run();
  assert.equal(r1.summary.districtStates['11350'], 'PARTIAL');
  assert.equal(r1.summary.districtStates['11140'], 'VALIDATED', 'Kakao 제한으로 좌표 미완료');
  assert.equal(r1.summary.coordinates.PENDING, 1);
  const fixed = { ...data, '11350': { ...data['11350'], '202608': [] } };
  const log: string[] = [];
  const kakaoCalls2: string[] = [];
  const r2 = await setup({ data: fixed, outDir, fetchLog: log, deps: { searchAddress: fakeKakao({ calls: kakaoCalls2 }) } }).run();
  assert.ok(log.every((l) => l.startsWith('11350')), '완료된 중구는 다시 수집하지 않는다');
  assert.deepEqual(r2.summary.districtStates, { '11140': 'READY', '11350': 'READY' });
  assert.equal(kakaoCalls2.filter((q) => q.includes('중구')).length, 2, '중구는 이미 끝난 1건을 빼고 2건만 조회');
});

test('20 · dry-run(기본)은 쓰기 0 — 쓰기 DB를 만들지도 않는다', async () => {
  const s = setup({ data: { '11140': { '202609': [item()], '202608': [] } } });
  const r = await s.run();
  assert.equal(s.db.writeDbCreated, 0);
  assert.deepEqual(r.summary.writes, { insert: 0, update: 0, delete: 0 });
  assert.equal(r.summary.mode, 'DRY_RUN');
  assert.equal(s.db.rows.length, 0);
});

test('21 · apply는 --apply · ALLOW_PROD_DB_WRITE=1 · --district · --expect-ready 일치가 모두 있어야 한다', async () => {
  const data = { '11140': { '202609': [item()], '202608': [] } };
  const cases: [Partial<SeedOptions>, string][] = [
    [{ apply: true, allowProdDbWrite: undefined, districts: ['11140'], expectReady: 1 }, 'ALLOW_PROD_DB_WRITE_NOT_1'],
    [{ apply: true, allowProdDbWrite: '1', districts: null, expectReady: 1 }, 'DISTRICT_FILTER_REQUIRED'],
    [{ apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 2 }, 'EXPECT_READY_MISMATCH:2!=1'],
    [{ apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: null }, 'EXPECT_READY_REQUIRED'],
    [{ apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 1, skipCoordinates: true }, 'COORDINATES_SKIPPED'],
  ];
  for (const [opts, reason] of cases) {
    const s = setup({ data, opts });
    const r = await s.run();
    assert.equal(s.db.writeDbCreated, 0, reason);
    assert.ok((r.summary as any).apply.reasons.includes(reason), reason);
  }
  const ok = setup({ data, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 1 } });
  await ok.run();
  assert.equal(ok.db.writeDbCreated, 1);
  assert.equal(ok.db.rows.length, 1);
  assert.equal(evaluateApplyGates({ applyFlag: false, allowProdDbWrite: '1', districts: ['11140'], districtFilterGiven: true, districtStates: new Map([['11140', 'READY']]), coordinatesSkipped: false, expectReady: 1, readyCount: 1 }).allowed, false);
  const cli = parseCli(['--apply', '--district=11140', '--expect-ready=107'], {});
  assert.equal(cli.allowProdDbWrite, undefined, 'env 없이 --apply만으로는 게이트 1개뿐');
});

test('22 · --district 파일럿 — 그 구만 수집, 다른 구로 귀속되는 행은 OUT_OF_TARGET', async () => {
  const log: string[] = [];
  const r = await setup({ data: { '11140': { '202609': [item(), item({ aptSeq: '11200-5', sggCd: '11140' })], '202608': [] } }, fetchLog: log, opts: { districts: ['11140'] } }).run();
  assert.ok(log.every((l) => l.startsWith('11140:')));
  assert.equal(r.rows.find((x) => x.aptSeq === '11200-5')!.status, 'OUT_OF_TARGET');
  assert.deepEqual(r.summary.targets, ['11140']);
  await assert.rejects(setup({ data: {}, opts: { districts: ['26350'] } }).run(), /서울 25개 구 코드가 아님/);
});

test('23 · rollback artifact — 삽입된 id·aptSeq·sggCd·createdAt와 3중 조건 삭제 템플릿', async () => {
  const s = setup({ data: { '11140': { '202609': [item(), item({ aptSeq: '11140-2', jibun: '2' })], '202608': [] } }, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 2 } });
  const r = await s.run();
  const file = fs.readdirSync(s.outDir).find((f) => f.startsWith('applied-'))!;
  const a = readOut(s.outDir, file);
  assert.equal(a.schema, APPLIED_ARTIFACT_SCHEMA);
  assert.deepEqual(a.inserted.map((x: any) => Object.keys(x).sort()), [['aptSeq', 'createdAt', 'id', 'sggCd'], ['aptSeq', 'createdAt', 'id', 'sggCd']]);
  assert.match(a.rollback.sql, /id = ANY\(\$1::int\[\]\) AND sgg_cd LIKE '11%' AND created_at BETWEEN/);
  assert.deepEqual(a.rollback.params.ids, a.inserted.map((x: any) => x.id));
  assert.equal(r.applied!.counts.inserted, 2);
});

test('24 · 재실행 멱등 — 두 번째 실행은 전부 SKIP, 동시 삽입 충돌(unique)도 SKIP', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seoul-seed-'));
  const db = fakeDb();
  const data = { '11140': { '202609': [item(), item({ aptSeq: '11140-2', jibun: '2' })], '202608': [] } };
  await setup({ data, db, outDir, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 2 } }).run();
  const r2 = await setup({ data, db, outDir, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 0 } }).run();
  assert.equal(db.rows.length, 2);
  assert.equal(r2.summary.byStatus.EXISTING_SKIPPED, 2);
  assert.equal(r2.applied!.counts.inserted, 0);
  // 조회 뒤 다른 곳에서 먼저 들어간 경우(unique 위반) — 덮어쓰지 않고 SKIP
  const race = fakeDb();
  const racing: WritableSeedDb = { ...race.write, findExistingAptSeqs: async () => new Set(), createMaster: async () => 'DUPLICATE' };
  const r3 = await setup({ data, db: race, opts: { apply: true, allowProdDbWrite: '1', districts: ['11140'], expectReady: 2 }, deps: { writeDb: async () => racing } }).run();
  assert.equal(r3.applied!.counts.skippedExisting, 2);
  assert.equal(r3.applied!.counts.inserted, 0);
});

test('buildTierARows — 보류된 구의 부분 데이터는 identity 판정에도 쓰지 않는다', () => {
  const { rows } = buildTierARows({
    itemsByDistrict: new Map([['11140', [item()]], ['11350', [item({ aptSeq: '11140-1', jibun: '999', sggCd: '11350' })]]]),
    heldBack: new Set(['11350']), targets: new Set(['11140', '11350']),
  });
  assert.deepEqual(rows.map((r) => [r.aptSeq, r.status, r.jibun]), [['11140-1', 'READY', '844']]);
});
