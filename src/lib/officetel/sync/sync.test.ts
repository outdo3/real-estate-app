import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fetchOfficetelCell, parseOfficetelPage, OFFICETEL_PAGE_SIZE, type HttpGet } from './molit-fetch';
import { buildMasterIndex, prepareRentRows, prepareSaleRows } from './normalize';
import { planRentInserts, planSaleReconcile, syncOfficetelCell } from './cell-sync';
import { runOfficetelSync } from './run';
import { incrementalMonths, kstYearMonth, monthRange, recheckMonths, subtractMonths, OFFICETEL_BUSAN_LAWD_CDS } from './months';
import { APPLY_CONFIRM_TOKEN, catchupConfirmOf, catchupLawdExplicit, checkApplyGuard, parseCatchupArgs } from './catchup-guard';
import { OFFICETEL_CRON_PLAN, handleOfficetelCron, parseOfficetelCronParams } from './cron-handler';
import { freshnessOf } from '../nearby-contract';
import { TimeBudget } from '../../sync/shared';
import type {
  ExistingRentRow, ExistingSaleRow, MasterRef, OfficetelCellRecord, OfficetelSyncDb, PreparedRent, PreparedSale, SaleCancelUpdate,
} from './types';

// OFFICETEL_INCREMENTAL_SYNC_V1 — 외부 호출 0 · DB 접속 0. MOLIT은 XML 대역, DB는 메모리 대역이다.

const ROOT = resolve(__dirname, '../../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------------ 대역

const MASTER: MasterRef = { id: 1, sggCd: '26350', normalizedUmdNm: '우동', normalizedJibun: '1408-0' };
const NOW = new Date('2026-10-24T01:00:00.000Z');

const saleItem = (o: Record<string, string> = {}) => ({
  sggCd: '26350', umdNm: '우동', jibun: '1408', offiNm: '테스트오피스텔', dealYear: '2026', dealMonth: '10', dealDay: '5',
  excluUseAr: '31.56', dealAmount: '25,000', floor: '7', cdealType: '', cdealDay: '', buildYear: '2015',
  dealingGbn: '중개거래', buyerGbn: '개인', slerGbn: '개인', estateAgentSggNm: '부산 해운대구', ...o,
});
const rentItem = (o: Record<string, string> = {}) => ({
  sggCd: '26350', umdNm: '우동', jibun: '1408', offiNm: '테스트오피스텔', dealYear: '2026', dealMonth: '10', dealDay: '5',
  excluUseAr: '31.56', deposit: '1,000', monthlyRent: '60', floor: '7', useRRRight: '', contractTerm: '24.10~26.10', contractType: '신규',
  preDeposit: '', preMonthlyRent: '', buildYear: '2015', ...o,
});

function xml(items: Record<string, string>[], total: number = items.length, resultCode = '000'): string {
  const body = items.map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</item>`).join('');
  return `<?xml version="1.0"?><response><header><resultCode>${resultCode}</resultCode><resultMsg>OK</resultMsg></header><body>${items.length ? `<items>${body}</items>` : '<items/>'}<numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;
}

/** 전체 행 목록을 numOfRows=1000 단위로 페이지 응답하는 대역. failPage 번째 요청은 오류를 돌려준다. */
function pagedHttp(all: Record<string, string>[], opts: { failPage?: number; failStatus?: number; resultCode?: string; text?: string; headers?: string } = {}): { get: HttpGet; calls: number[] } {
  const calls: number[] = [];
  const get: HttpGet = async (url) => {
    const page = Number(/pageNo=(\d+)/.exec(url)![1]);
    calls.push(page);
    if (opts.text !== undefined) return { status: 200, text: opts.text, rateLimitRemaining: opts.headers ?? null };
    if (opts.failPage === page) return { status: opts.failStatus ?? 500, text: '', rateLimitRemaining: null };
    if (opts.resultCode) return { status: 200, text: xml([], 0, opts.resultCode), rateLimitRemaining: null };
    const slice = all.slice((page - 1) * OFFICETEL_PAGE_SIZE, page * OFFICETEL_PAGE_SIZE);
    return { status: 200, text: xml(slice, all.length), rateLimitRemaining: opts.headers ?? null };
  };
  return { get, calls };
}

const fetchDeps = (get: HttpGet) => ({ httpGet: get, sleep: async () => undefined, minIntervalMs: 0, apiKey: 'test-key', quota: { remaining: null, at: null } as { remaining: number | null; at: number | null } });

class FakeDb implements OfficetelSyncDb {
  sale: (PreparedSale & { id: number })[] = [];
  rent: PreparedRent[] = [];
  cells = new Map<string, OfficetelCellRecord>();
  masters: MasterRef[] = [MASTER];
  writes = 0;
  nextId = 1;
  failInsert = false;
  failRecord = false;
  stateTableMissing = false;
  async loadMasters() { return this.masters; }
  async loadExistingSale(lawdCd: string, ym: string): Promise<ExistingSaleRow[]> {
    return this.sale.filter((r) => r.lawdCd === lawdCd && r.dealYmd === ym).map((r) => ({
      id: r.id, canonicalKey: r.canonicalKey, dealDate: new Date(`${r.dealDate}T00:00:00.000Z`), exclusiveArea: r.exclusiveArea,
      dealAmount: r.dealAmount, floor: r.floor, occurrenceIndex: r.occurrenceIndex, dealCanceled: r.dealCanceled,
    }));
  }
  async loadExistingRent(lawdCd: string, ym: string): Promise<ExistingRentRow[]> {
    return this.rent.filter((r) => r.lawdCd === lawdCd && r.dealYmd === ym).map((r) => ({
      canonicalKey: r.canonicalKey, dealDate: new Date(`${r.dealDate}T00:00:00.000Z`), exclusiveArea: r.exclusiveArea,
      deposit: r.deposit, monthlyRent: r.monthlyRent, floor: r.floor, occurrenceIndex: r.occurrenceIndex,
    }));
  }
  async insertSale(rows: PreparedSale[]) {
    if (this.failInsert) throw new Error('db down');
    let n = 0;
    for (const r of rows) {
      const dup = this.sale.some((x) => x.canonicalKey === r.canonicalKey && x.dealDate === r.dealDate && Number(x.exclusiveArea) === Number(r.exclusiveArea) && x.dealAmount === r.dealAmount && x.floor === r.floor && x.occurrenceIndex === r.occurrenceIndex);
      if (!dup) { this.sale.push({ ...r, id: this.nextId++ }); n++; this.writes++; }
    }
    return n;
  }
  async insertRent(rows: PreparedRent[]) {
    if (this.failInsert) throw new Error('db down');
    let n = 0;
    for (const r of rows) {
      const dup = this.rent.some((x) => x.canonicalKey === r.canonicalKey && x.dealDate === r.dealDate && Number(x.exclusiveArea) === Number(r.exclusiveArea) && x.deposit === r.deposit && x.monthlyRent === r.monthlyRent && x.floor === r.floor && x.occurrenceIndex === r.occurrenceIndex);
      if (!dup) { this.rent.push({ ...r }); n++; this.writes++; }
    }
    return n;
  }
  async cancelSale(updates: SaleCancelUpdate[]) {
    let n = 0;
    for (const u of updates) {
      const row = this.sale.find((r) => r.id === u.id && !r.dealCanceled);
      if (row) { row.dealCanceled = true; row.cancelDate = u.cancelDate; row.sourceFetchedAt = u.sourceFetchedAt; n++; this.writes++; }
    }
    return n;
  }
  async loadCellStates(dataset: string, yms: string[]) {
    if (this.stateTableMissing) throw new Error('relation "officetel_sync_cells" does not exist');
    return [...this.cells.values()].filter((c) => c.dataset === dataset && yms.includes(c.dealYmd)).map((c) => ({ lawdCd: c.lawdCd, dealYmd: c.dealYmd, verifiedAt: c.verifiedAt }));
  }
  async recordCell(rec: OfficetelCellRecord) {
    if (this.failRecord) throw new Error('cell table down');
    const k = `${rec.dataset}:${rec.lawdCd}:${rec.dealYmd}`;
    const prev = this.cells.get(k);
    this.cells.set(k, { ...rec, verifiedAt: rec.verifiedAt ?? prev?.verifiedAt ?? null });
    this.writes++;
  }
}

function cellDeps(db: FakeDb, get: HttpGet, clock = () => NOW) {
  return { db, fetchCell: (d: 'OFFICETEL_SALE' | 'OFFICETEL_RENT', l: string, y: string) => fetchOfficetelCell(d, l, y, fetchDeps(get)), clock };
}
const P = (dataset: 'OFFICETEL_SALE' | 'OFFICETEL_RENT', mode: 'dry-run' | 'apply' = 'apply') => ({ dataset, lawdCd: '26350', dealYmd: '202610', mode, runId: 'test-run' });
const asReport = (r: Awaited<ReturnType<typeof syncOfficetelCell>>) => { assert.equal(r.kind, 'REPORT'); return (r as Extract<typeof r, { kind: 'REPORT' }>); };

// ------------------------------------------------------------------ A~D 정상 경로

test('A. 매매 정상 1페이지 — 신규 insert, master 연결, 셀 COMPLETE 기록', async () => {
  const db = new FakeDb();
  const http = pagedHttp([saleItem(), saleItem({ dealDay: '6', dealAmount: '26,500' })]);
  const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, http.get)));
  assert.equal(report.status, 'COMPLETE');
  assert.equal(report.sourceTotalCount, 2);
  assert.equal(report.inserted, 2);
  assert.equal(db.sale.length, 2);
  assert.equal(db.sale[0].officetelMasterId, 1);
  assert.equal(db.sale[0].dealAmount, 25000);
  assert.equal(db.sale[0].exclusiveArea, '31.56'); // 원본 문자열 그대로
  assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.status, 'COMPLETE');
  assert.equal(report.recorded, true);
});

test('B. 매매 pagination — 2,500건은 3페이지를 순서대로 읽고 totalCount와 일치할 때만 COMPLETE', async () => {
  const all = Array.from({ length: 2500 }, (_, i) => saleItem({ dealDay: String((i % 28) + 1), dealAmount: String(10000 + i), floor: String((i % 20) + 1) }));
  const http = pagedHttp(all);
  const out = await fetchOfficetelCell('OFFICETEL_SALE', '26350', '202610', fetchDeps(http.get));
  assert.equal(out.kind, 'OK');
  if (out.kind === 'OK') { assert.equal(out.items.length, 2500); assert.equal(out.pages, 3); }
  assert.deepEqual(http.calls, [1, 2, 3]);
});

test('C. 전월세 정상 — 전세(월세 0)와 월세 모두 적재, useRRRight 미기재는 null', async () => {
  const db = new FakeDb();
  const http = pagedHttp([rentItem(), rentItem({ deposit: '30,000', monthlyRent: '0', useRRRight: '사용' })]);
  const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_RENT'), cellDeps(db, http.get)));
  assert.equal(report.status, 'COMPLETE');
  assert.equal(db.rent.length, 2);
  assert.equal(db.rent[0].useRenewalRight, null);
  assert.equal(db.rent[1].useRenewalRight, true);
  assert.equal(db.rent[1].monthlyRent, 0);
});

test('D. 정상 0건 — COMPLETE + sourceTotalCount=0, 실패와 구분되고 기록된다', async () => {
  const db = new FakeDb();
  const http = pagedHttp([]);
  const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, http.get)));
  assert.equal(report.status, 'COMPLETE');
  assert.equal(report.sourceTotalCount, 0);
  assert.equal(report.fetched, 0);
  assert.equal(report.failureReason, null);
  assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.sourceTotalCount, 0);
});

// ------------------------------------------------------------------ E~F 실패

test('E. API 오류는 0건이 아니다 — PARTIAL + 사유, sourceTotalCount=null, 쓰기 없음', async () => {
  const cases: [string, Parameters<typeof pagedHttp>[1], string][] = [
    ['resultCode 99', { resultCode: '99' }, 'API_ERROR'],
    ['HTTP 500 (재시도 후 포기)', { failPage: 1, failStatus: 500 }, 'API_ERROR'],
    ['빈 본문', { text: '' }, 'PARSE_ERROR'],
    ['깨진 XML', { text: '<response><header>' }, 'PARSE_ERROR'],
    ['일일 한도 초과', { text: '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>' }, 'QUOTA'],
    ['totalCount 없음', { text: '<response><header><resultCode>000</resultCode></header><body><items/></body></response>' }, 'PARSE_ERROR'],
    ['건수는 있는데 항목 없음', { text: '<response><header><resultCode>000</resultCode></header><body><items/><totalCount>5</totalCount></body></response>' }, 'PARSE_ERROR'],
  ];
  for (const [name, o, reason] of cases) {
    const db = new FakeDb();
    const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([], o).get)));
    assert.equal(report.status, 'PARTIAL', name);
    assert.equal(report.failureReason, reason, name);
    assert.equal(report.sourceTotalCount, null, name);
    assert.equal(db.sale.length, 0, name);
    assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.status, 'PARTIAL', name);
  }
});

test('E2. 타임아웃은 TIMEOUT으로 분류된다', async () => {
  const get: HttpGet = async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; };
  const out = await fetchOfficetelCell('OFFICETEL_SALE', '26350', '202610', fetchDeps(get));
  assert.deepEqual(out, { kind: 'FAILED', reason: 'TIMEOUT', totalCount: null, fetchedCount: 0 });
});

test('F. 일부 페이지 실패 — PARTIAL_PAGINATION, 받은 페이지로 아무것도 쓰지 않는다', async () => {
  const all = Array.from({ length: 1500 }, (_, i) => saleItem({ dealAmount: String(10000 + i) }));
  const db = new FakeDb();
  const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp(all, { failPage: 2 }).get)));
  assert.equal(report.status, 'PARTIAL');
  assert.equal(report.failureReason, 'PARTIAL_PAGINATION');
  assert.equal(report.sourceTotalCount, 1500);
  assert.equal(report.fetched, 1000);
  assert.equal(db.sale.length, 0);
});

// ------------------------------------------------------------------ G~I 멱등 · sourceFetchedAt · 취소

test('G. 재실행은 멱등이다 — 두 번째 실행은 insert 0, 중복 행 0', async () => {
  const db = new FakeDb();
  const http = pagedHttp([saleItem(), saleItem(), saleItem({ dealDay: '9' })]); // 같은 자연키 2행 -> occurrenceIndex 0,1
  const first = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, http.get))).report;
  assert.equal(first.inserted, 3);
  assert.deepEqual(db.sale.map((r) => r.occurrenceIndex).sort(), [0, 0, 1]);
  const second = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, http.get))).report;
  assert.equal(second.inserted, 0);
  assert.equal(second.planned.inserts, 0);
  assert.equal(second.updated, 0);
  assert.equal(db.sale.length, 3);
  assert.equal(second.status, 'COMPLETE');
});

test('H. sourceFetchedAt은 실제 수집 시각이다 — 파일 mtime이 아니라 clock', async () => {
  const db = new FakeDb();
  const t1 = new Date('2026-10-24T01:00:05.000Z');
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get, () => t1));
  assert.equal(db.sale[0].sourceFetchedAt.toISOString(), t1.toISOString());
  const t2 = new Date('2026-10-25T01:00:05.000Z');
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem(), saleItem({ dealDay: '20' })]).get, () => t2));
  // 새 행은 t2, 이미 있던 행은 건드리지 않는다.
  assert.deepEqual(db.sale.map((r) => r.sourceFetchedAt.toISOString()), [t1.toISOString(), t2.toISOString()]);
  assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.attemptedAt.toISOString(), t2.toISOString());
});

test('I. 매매 취소 반영 — 원본 행이 취소로 바뀌면 갱신하고, 취소 사본(TYPE B)은 insert한다. 삭제·되돌림 없음', async () => {
  const db = new FakeDb();
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get));
  assert.equal(db.sale[0].dealCanceled, false);

  // (1) 같은 행이 취소로 바뀌어 옴
  const r1 = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem({ cdealType: 'O', cdealDay: '26.10.20' })]).get))).report;
  assert.equal(r1.updated, 1);
  assert.equal(db.sale.length, 1);
  assert.equal(db.sale[0].dealCanceled, true);
  assert.equal(db.sale[0].cancelDate, '26.10.20');

  // (2) 원천이 취소가 더 적다고 말해도 되돌리지 않는다(보고만)
  const r2 = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get))).report;
  assert.equal(r2.updated, 0);
  assert.equal(r2.cancelRestorePending, 1);
  assert.equal(db.sale[0].dealCanceled, true);

  // (3) TYPE B: 정상 + 취소 사본이 함께 옴 -> 새 occurrence insert, 기존 행은 그대로
  const db2 = new FakeDb();
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db2, pagedHttp([saleItem()]).get));
  const r3 = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db2, pagedHttp([saleItem(), saleItem({ cdealType: 'O', cdealDay: '26.10.21' })]).get))).report;
  assert.equal(r3.inserted, 1);
  assert.equal(r3.updated, 0);
  assert.deepEqual(db2.sale.map((r) => [r.occurrenceIndex, r.dealCanceled]), [[0, false], [1, true]]);

  // (4) 원천에서 사라진 행은 지우지 않는다
  const r4 = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db2, pagedHttp([]).get))).report;
  assert.equal(r4.dbOnlyRows, 2);
  assert.equal(db2.sale.length, 2);
});

test('I2. 취소 계획은 순수 함수로도 결정적이다 — 순서가 바뀐 응답에서도 취소 행 수가 같아진다', () => {
  const masters = buildMasterIndex([MASTER]);
  const src = prepareSaleRows('26350', '202610', [saleItem({ cdealType: 'O', cdealDay: '26.10.20' }), saleItem()], masters, NOW).rows;
  const existing: ExistingSaleRow[] = [{ id: 7, canonicalKey: src[0].canonicalKey, dealDate: new Date('2026-10-05T00:00:00.000Z'), exclusiveArea: '31.56', dealAmount: 25000, floor: 7, occurrenceIndex: 0, dealCanceled: false }];
  const plan = planSaleReconcile(src, existing, NOW);
  assert.equal(plan.inserts.length, 1); // occurrence 1
  assert.equal(plan.cancelUpdates.length, 1); // 기존 occurrence 0을 취소로
  assert.equal(plan.cancelUpdates[0].id, 7);
  assert.equal(plan.cancelUpdates[0].cancelDate, '26.10.20');
});

// ------------------------------------------------------------------ J~K unresolved · 상태

test('J. master 연결 실패 행도 버리지 않는다 — 연결 없이 적재하고 unresolved로 센다', async () => {
  const db = new FakeDb();
  db.masters = [{ ...MASTER, id: 1 }, { ...MASTER, id: 2 }]; // 같은 지번에 master 둘 -> 추측 금지
  const a = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get))).report;
  assert.equal(a.inserted, 1);
  assert.equal(a.unresolved, 1);
  assert.equal(db.sale[0].officetelMasterId, null);
  assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.unresolvedCount, 1);

  const db2 = new FakeDb();
  db2.masters = []; // 주소 그룹에 master 없음
  const b = asReport(await syncOfficetelCell(P('OFFICETEL_RENT'), cellDeps(db2, pagedHttp([rentItem()]).get))).report;
  assert.equal(b.unresolved, 1);
  assert.equal(db2.rent[0].officetelMasterId, null);
});

test('K. COMPLETE / PARTIAL / INVALID 구분', async () => {
  // PARTIAL: 깨진 행(층 없음)은 제외하고 나머지는 적재, 셀은 COMPLETE가 아니다
  const db = new FakeDb();
  const p = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem(), saleItem({ floor: '', dealDay: '7' })]).get))).report;
  assert.equal(p.status, 'PARTIAL');
  assert.equal(p.failureReason, 'PARSE_ERROR');
  assert.equal(p.invalidRows, 1);
  assert.equal(p.inserted, 1);
  assert.equal(db.sale.length, 1);

  // INVALID: 행의 계약월이 셀 월과 다름 -> 아무것도 쓰지 않는다
  const db2 = new FakeDb();
  const i = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db2, pagedHttp([saleItem({ dealMonth: '09' })]).get))).report;
  assert.equal(i.status, 'INVALID');
  assert.equal(db2.sale.length, 0);
  assert.equal(db2.cells.get('OFFICETEL_SALE:26350:202610')?.status, 'INVALID');
});

test('K2. DB 오류는 COMPLETE로 기록되지 않는다(DB_ERROR)', async () => {
  const db = new FakeDb();
  db.failInsert = true;
  const { report } = asReport(await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get)));
  assert.equal(report.status, 'PARTIAL');
  assert.equal(report.failureReason, 'DB_ERROR');
  assert.equal(db.cells.get('OFFICETEL_SALE:26350:202610')?.status, 'PARTIAL');
});

test('K3. 실패한 시도가 이전의 검증 시각(verifiedAt)을 지우지 않는다', async () => {
  const db = new FakeDb();
  const t1 = new Date('2026-10-20T01:00:00.000Z');
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get, () => t1));
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([], { resultCode: '99' }).get, () => NOW));
  const c = db.cells.get('OFFICETEL_SALE:26350:202610')!;
  assert.equal(c.status, 'PARTIAL');
  assert.equal(c.verifiedAt?.toISOString(), t1.toISOString());
});

// ------------------------------------------------------------------ L quota / deadline / budget

test('L. deadline — 시간이 없으면 요청을 보내지 않고 STOPPED(기록 없음)', async () => {
  const http = pagedHttp([saleItem()]);
  const out = await fetchOfficetelCell('OFFICETEL_SALE', '26350', '202610', { ...fetchDeps(http.get), deadline: { remainingMs: () => 1000 } });
  assert.deepEqual(out, { kind: 'STOPPED', stop: 'DEADLINE_REACHED' });
  assert.equal(http.calls.length, 0);
  const db = new FakeDb();
  const res = await syncOfficetelCell(P('OFFICETEL_SALE'), { db, clock: () => NOW, fetchCell: async () => ({ kind: 'STOPPED', stop: 'DEADLINE_REACHED' }) });
  assert.equal(res.kind, 'STOPPED');
  assert.equal(db.cells.size, 0);
});

test('L2. quota — 일일 한도 예약분(2,000)에 닿으면 요청하지 않는다', async () => {
  const http = pagedHttp([saleItem()]);
  const deps = fetchDeps(http.get);
  deps.quota = { remaining: 2000, at: Date.now() };
  const out = await fetchOfficetelCell('OFFICETEL_SALE', '26350', '202610', { ...deps, now: () => deps.quota.at! });
  assert.deepEqual(out, { kind: 'STOPPED', stop: 'QUOTA_RESERVE_REACHED' });
  assert.equal(http.calls.length, 0);
  // 응답 헤더로 한도를 관측한다
  const q = { remaining: null as number | null, at: null as number | null };
  await fetchOfficetelCell('OFFICETEL_SALE', '26350', '202610', { ...fetchDeps(pagedHttp([], { headers: '1234' }).get), quota: q });
  assert.equal(q.remaining, 1234);
});

test('L3. run — 예산 소진 시 셀 경계에서 멈추고 PARTIAL_RUN, 처리한 셀 상태는 남는다', async () => {
  const db = new FakeDb();
  const http = pagedHttp([saleItem()]);
  let t = 0;
  const budget = new TimeBudget(6000, () => t);
  const summary = await runOfficetelSync(
    { dataset: 'OFFICETEL_SALE', mode: 'apply', lawdCds: ['26350', '26230'], months: ["202610", "202609"], runId: "r", budgetMs: 6000 },
    {
      db, clock: () => NOW, budget, now: () => t,
      fetchCell: async (d, l, y) => { t += 1000; return fetchOfficetelCell(d, l, y, fetchDeps(http.get)); },
    }
  );
  assert.equal(summary.stopReason, 'BUDGET_EXHAUSTED');
  assert.ok(summary.cellsProcessed >= 1 && summary.cellsProcessed < 4);
  assert.equal(summary.status, 'PARTIAL_RUN');
  assert.equal(db.cells.size, summary.cellsProcessed);
});

test('L4. run — 셀 상태를 기록하지 못하면 멈춘다(COVERAGE_PERSIST_FAILED, FAILED)', async () => {
  const db = new FakeDb();
  db.failRecord = true;
  const summary = await runOfficetelSync(
    { dataset: 'OFFICETEL_RENT', mode: 'apply', lawdCds: ['26350'], months: ['202610', '202609'], runId: 'r', budgetMs: 50_000 },
    { db, clock: () => NOW, fetchCell: (d, l, y) => fetchOfficetelCell(d, l, y, fetchDeps(pagedHttp([rentItem()]).get)) }
  );
  assert.equal(summary.stopReason, 'COVERAGE_PERSIST_FAILED');
  assert.equal(summary.status, 'FAILED');
  assert.equal(summary.cellsProcessed, 1);
});

test('L5. run — 가장 오래 검증되지 않은 셀부터 처리한다', async () => {
  const db = new FakeDb();
  const old = new Date('2026-10-01T00:00:00.000Z');
  db.cells.set('OFFICETEL_SALE:26350:202610', { dataset: 'OFFICETEL_SALE', lawdCd: '26350', dealYmd: '202610', status: 'COMPLETE', failureReason: null, sourceTotalCount: 0, fetchedCount: 0, insertedCount: 0, updatedCount: 0, duplicateCount: 0, unresolvedCount: 0, invalidRowCount: 0, runId: 'x', attemptedAt: old, verifiedAt: old });
  const order: string[] = [];
  await runOfficetelSync(
    { dataset: 'OFFICETEL_SALE', mode: 'dry-run', lawdCds: ['26350', '26230'], months: ['202610'], runId: 'r', budgetMs: 50_000 },
    { db, clock: () => NOW, fetchCell: async (_d, l) => { order.push(l); return { kind: 'OK', totalCount: 0, items: [], pages: 1 }; } }
  );
  assert.deepEqual(order, ['26230', '26350']); // 한 번도 검증 안 된 26230이 먼저
});

test('L6. 상태 테이블이 없으면 dry-run은 진행하고 apply는 쓰기 전에 중단한다', async () => {
  const db = new FakeDb();
  db.stateTableMissing = true;
  const run = (mode: 'dry-run' | 'apply') => runOfficetelSync(
    { dataset: 'OFFICETEL_SALE', mode, lawdCds: ['26350'], months: ['202610'], runId: 'r', budgetMs: 50_000 },
    { db, clock: () => NOW, fetchCell: (d, l, y) => fetchOfficetelCell(d, l, y, fetchDeps(pagedHttp([saleItem()]).get)) }
  );
  const dry = await run('dry-run');
  assert.equal(dry.stateUnavailable, true);
  assert.equal(dry.planned.inserts, 1);
  assert.equal(db.sale.length, 0);
  const applied = await run('apply');
  assert.equal(applied.status, 'FAILED');
  assert.equal(db.sale.length, 0);
  assert.equal(db.writes, 0);
});

// ------------------------------------------------------------------ M~N catch-up

test('M. catch-up 기본은 dry-run이고 dry-run은 DB에 아무것도 쓰지 않는다', async () => {
  const parsed = parseCatchupArgs([], NOW);
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.args.apply, false);
    assert.deepEqual(parsed.args.months, ['202609', '202610']);
    assert.equal(parsed.args.lawdCds.length, 16);
    assert.equal(checkApplyGuard(parsed.args, null, false), null); // dry-run은 가드 대상 아님
  }
  const db = new FakeDb();
  const summary = await runOfficetelSync(
    { dataset: 'OFFICETEL_SALE', mode: 'dry-run', lawdCds: ['26350'], months: ['202610'], runId: 'r', budgetMs: 50_000 },
    { db, clock: () => NOW, fetchCell: (d, l, y) => fetchOfficetelCell(d, l, y, fetchDeps(pagedHttp([saleItem(), saleItem({ dealDay: '8' })]).get)) }
  );
  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.planned.inserts, 2);
  assert.equal(summary.inserted, 0);
  assert.equal(db.writes, 0);
  assert.equal(db.sale.length, 0);
  assert.equal(db.cells.size, 0);
});

test('N. apply 가드 — 확인 토큰과 범위 지정이 모두 있어야 통과', () => {
  const guard = (argv: string[]) => {
    const p = parseCatchupArgs(argv, NOW);
    assert.ok(p.ok);
    return p.ok ? checkApplyGuard(p.args, catchupConfirmOf(argv), catchupLawdExplicit(argv)) : 'parse';
  };
  assert.match(guard(['--apply']) ?? '', /--confirm=/);
  assert.match(guard(['--apply', '--confirm=yes']) ?? '', /--confirm=/);
  assert.match(guard(['--apply', `--confirm=${APPLY_CONFIRM_TOKEN}`]) ?? '', /explicit scope/);
  assert.equal(guard(['--apply', `--confirm=${APPLY_CONFIRM_TOKEN}`, '--lawd=26350']), null);
  assert.equal(guard(['--apply', `--confirm=${APPLY_CONFIRM_TOKEN}`, '--all-districts']), null);
  // 인자 검증
  for (const bad of [['--lawd=99999'], ['--from=202610', '--to=202609'], ['--to=202701'], ['--from=2026-09'], ['--dataset=ALLX'], ['--lawd=26350', '--all-districts'], ['--from=202401', '--to=202610']]) {
    assert.equal(parseCatchupArgs(bad, NOW).ok, false, bad.join(' '));
  }
});

// ------------------------------------------------------------------ O cron

test('O. cron 인증 — secret 미설정/불일치는 거부, 허용 밖 lawdCd는 400, 기본 mode는 dry-run', async () => {
  const prev = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await handleOfficetelCron(new Request('http://x/api/cron/officetel-sale-sync'), 'sale-sync')).status, 401);
    assert.equal((await handleOfficetelCron(new Request('http://x/api/cron/officetel-sale-sync', { headers: { authorization: 'Bearer ' } }), 'sale-sync')).status, 401);
    process.env.CRON_SECRET = 's3cret';
    assert.equal((await handleOfficetelCron(new Request('http://x/a', { headers: { authorization: 'Bearer nope' } }), 'sale-sync')).status, 401);
    const bad = await handleOfficetelCron(new Request('http://x/a?lawdCd=11110', { headers: { authorization: 'Bearer s3cret' } }), 'rent-sync');
    assert.equal(bad.status, 400);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev;
  }
  const dry = parseOfficetelCronParams(new URL('http://x/a'), 'sale-sync', NOW);
  assert.ok(dry.ok && dry.mode === 'dry-run');
  const ap = parseOfficetelCronParams(new URL('http://x/a?mode=apply'), 'sale-sync', NOW);
  assert.ok(ap.ok && ap.mode === 'apply' && ap.months.join() === '202609,202610' && ap.lawdCds.length === 16);
  assert.equal(parseOfficetelCronParams(new URL('http://x/a?mode=APPLY'), 'sale-sync', NOW).ok && (parseOfficetelCronParams(new URL('http://x/a?mode=APPLY'), 'sale-sync', NOW) as { mode: string }).mode, 'dry-run');
  assert.equal(parseOfficetelCronParams(new URL('http://x/a?lookback=9'), 'sale-sync', NOW).ok, false);
  assert.equal(parseOfficetelCronParams(new URL('http://x/a?minBack=5&maxBack=2'), 'sale-recheck', NOW).ok, false);
});

test('O2. cron 계획 — vercel.json 기존 시각과 겹치지 않고, 아직 등록되지 않았으며, 개수 한도 안이다', () => {
  const vercel = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
  const used = new Set(vercel.crons.map((c) => c.schedule.split(' ').slice(0, 2).join(':')));
  for (const e of OFFICETEL_CRON_PLAN) {
    assert.ok(!used.has(e.schedule.split(' ').slice(0, 2).join(':')), `${e.kind} collides with an existing cron time`);
    assert.ok(!vercel.crons.some((c) => c.path.includes('officetel')), 'officetel cron must not be registered yet');
  }
  assert.ok(vercel.crons.length + OFFICETEL_CRON_PLAN.length <= 100, 'Vercel Hobby cron count limit (100)');
  // 일 1회 이하(Hobby 최소 간격): 분/시가 숫자로 고정돼야 한다
  for (const e of OFFICETEL_CRON_PLAN) assert.match(e.schedule, /^\d+ \d+ \* \* (\*|\d)$/);
  // 라우트가 실제로 존재한다
  for (const e of OFFICETEL_CRON_PLAN) {
    const dir = e.path.split('?')[0].replace('/api/cron/', '');
    assert.ok(readFileSync(resolve(ROOT, `src/app/api/cron/${dir}/route.ts`), 'utf8').includes('handleOfficetelCron'));
  }
});

// ------------------------------------------------------------------ 정규화 / 월 계산 / 안전

test('정규화는 STEP 3B 규칙과 같다 — slerGbn, cdealType=O, 자연키 occurrence, 원본 면적 문자열', () => {
  const masters = buildMasterIndex([MASTER]);
  const sale = prepareSaleRows('26350', '202610', [saleItem(), saleItem(), saleItem({ cdealType: 'O', cdealDay: '26.10.20', slerGbn: '법인' })], masters, NOW);
  assert.equal(sale.rows.length, 3);
  assert.deepEqual(sale.rows.map((r) => r.occurrenceIndex), [0, 1, 2]);
  assert.equal(sale.rows[2].dealCanceled, true);
  assert.equal(sale.rows[2].sellerGbn, '법인');
  assert.equal(sale.rows[0].canonicalKey, 'OFFI:26350:우동:1408-0:_');
  assert.equal(sale.rows[0].source, 'MOLIT_OFFI_TRADE');
  assert.equal(sale.linkage.LINKABLE, 3);
  // 깨진 행이 끼어도 다른 행의 occurrenceIndex는 밀리지 않는다
  const mixed = prepareSaleRows('26350', '202610', [saleItem({ floor: '' }), saleItem(), saleItem()], masters, NOW);
  assert.deepEqual(mixed.rows.map((r) => r.occurrenceIndex), [0, 1]);
  assert.equal(mixed.invalidRowCount, 1);
  const rent = prepareRentRows('26350', '202610', [rentItem(), rentItem({ monthlyRent: '' })], masters, NOW);
  assert.equal(rent.rows.length, 1);
  assert.equal(rent.invalidReasons.RENT_PARSE_FAIL, 1);
  assert.equal(rent.rows[0].source, 'MOLIT_OFFI_RENT');
  const plan = planRentInserts(rent.rows, []);
  assert.equal(plan.inserts.length, 1);
});

test('월 계산 — KST 달력월, 증분 2개월, 재확인 band는 증분 바로 바깥(겹침·틈 없음)', () => {
  assert.equal(kstYearMonth(new Date('2026-09-30T16:00:00.000Z')), '202610'); // KST 10/1 01:00
  assert.equal(kstYearMonth(new Date('2026-09-30T14:59:00.000Z')), '202609');
  assert.deepEqual(incrementalMonths(new Date('2026-10-24T01:00:00.000Z')), ['202609', '202610']);
  assert.deepEqual(incrementalMonths(new Date('2027-01-05T01:00:00.000Z')), ['202612', '202701']);
  assert.equal(subtractMonths('202601', 1), '202512');
  assert.deepEqual(monthRange('202611', '202702'), ['202611', '202612', '202701', '202702']);
  const inc = incrementalMonths(NOW);
  const re = recheckMonths(NOW);
  assert.equal(re[0], '202510');
  assert.equal(re[re.length - 1], '202608');
  assert.equal(re.length, 11);
  assert.ok(!re.some((m) => inc.includes(m)));
  assert.equal(subtractMonths(inc[0], 1), re[re.length - 1]);
  assert.equal(OFFICETEL_BUSAN_LAWD_CDS.length, 16);
});

test('쓰기 안전 — sync 코드에 삭제·raw SQL 쓰기가 없고, 쓰기는 insert(skipDuplicates)와 취소 갱신뿐이다', () => {
  for (const f of ['db.ts', 'cell-sync.ts', 'run.ts', 'normalize.ts', 'molit-fetch.ts']) {
    const src = code(`src/lib/officetel/sync/${f}`);
    assert.doesNotMatch(src, /\.delete\(|deleteMany|\$executeRaw|\$queryRawUnsafe|TRUNCATE|DROP TABLE/i, f);
  }
  const db = code('src/lib/officetel/sync/db.ts');
  assert.match(db, /skipDuplicates: true/);
  assert.match(db, /dealCanceled: false/); // 취소 갱신은 비취소 행에만
  // 키는 환경변수에서만 읽고 로그/에러에 싣지 않는다
  const fetchSrc = code('src/lib/officetel/sync/molit-fetch.ts');
  assert.doesNotMatch(fetchSrc, /console\./);
  assert.doesNotMatch(code('src/lib/officetel/sync/cron-handler.ts'), /console\.(log|error)\([^)]*(apiKey|serviceKey|CRON_SECRET)/);
});

test('API 응답 파서 — 정상 0건과 오류가 구분된다', () => {
  const zero = parseOfficetelPage(200, xml([], 0));
  assert.deepEqual(zero.ok && { total: zero.totalCount, n: zero.items.length }, { total: 0, n: 0 });
  assert.equal(parseOfficetelPage(200, xml([], 0, '99')).ok, false);
  assert.equal(parseOfficetelPage(503, '').ok, false);
});

// ------------------------------------------------------------------ P nearby freshness 회귀

test('P. nearby freshness — 증분이 기록한 sourceFetchedAt이면 CURRENT, 9/4 값이면 STALE (nearby 로직은 수정하지 않음)', async () => {
  const db = new FakeDb();
  const t = new Date('2026-10-23T01:00:00.000Z');
  await syncOfficetelCell(P('OFFICETEL_SALE'), cellDeps(db, pagedHttp([saleItem()]).get, () => t));
  const max = db.sale.map((r) => r.sourceFetchedAt.getTime()).reduce((a, b) => Math.max(a, b));
  assert.equal(freshnessOf(new Date(max).toISOString(), NOW).status, 'CURRENT');
  assert.equal(freshnessOf('2026-09-04T17:07:02.495Z', NOW).status, 'STALE');
  // nearby 읽기 코드는 이 변경에서 건드리지 않았다(회귀 방지: 읽기 경로는 sourceFetchedAt 최댓값을 그대로 쓴다)
  assert.match(code('src/lib/officetel/nearby-read.ts'), /_max/);
});
