// SELLFLOW_DATA_API_V1 — 계약/서비스/HTTP 계층 테스트. 가짜 인메모리 DB만 쓴다(운영 데이터·네트워크 접근 없음).
// 실행: npx tsx --test src/lib/integrations/sellflow/sellflow.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PERIOD_MONTHS,
  authenticate,
  buildSummaryStatistics,
  cancellationCoverageFor,
  computeContentGuidance,
  computeVerification,
  recentMonths,
  computeMetricStats,
  formatMasterId,
  normalizeCancelDate,
  parseMasterId,
  parseSearchQuery,
  parseTransactionsQuery,
  type RawTx,
} from './contract';
import { handleSellflowRequest, type SellflowHandlerDeps, type SellflowLogEntry } from './handler';
import type { MasterRow, SellflowDb, TxFilter } from './service';

// ------------------------------------------------------------------ fixtures (모두 모의 값)
const NOW = new Date('2026-10-25T03:00:00.000Z'); // KST 2026-10-25 12:00
const KEY = 'test-key-not-a-secret';

const apt: MasterRow = {
  propertyType: 'apartment', key: '26140-1001', name: '샘플아파트', normalizedName: '샘플', lawdCd: '26140', sigungu: '서구', dong: '암남동',
  jibun: '1', buildingDong: null, roadAddress: '샘플로 1', jibunAddress: '부산 서구 암남동 1',
  buildYear: 2010, unitCount: 500, unitCountBasis: 'households', mastersAtAddress: 1, historyKeyOk: true,
};
const offi: MasterRow = {
  propertyType: 'officetel', key: 11, name: '샘플오피스텔', normalizedName: '샘플오피스텔', lawdCd: '26350', sigungu: null, dong: '우동',
  jibun: '10', buildingDong: null, roadAddress: '샘플대로 10', jibunAddress: null,
  buildYear: 2018, unitCount: 300, unitCountBasis: 'ho', mastersAtAddress: 1, historyKeyOk: true,
};
const offiMulti: MasterRow = { ...offi, key: 12, name: '다동오피스텔', normalizedName: '다동오피스텔', jibun: '20', mastersAtAddress: 5 };
const offiNoName: MasterRow = { ...offi, key: 13, name: null, normalizedName: '', jibun: '30' };

const tx = (o: Partial<RawTx> & Pick<RawTx, 'dealDate'>): RawTx => ({
  price: null, deposit: null, monthlyRent: null, exclusiveArea: 59.97, floor: 5, dealCanceled: null, cancelDateRaw: null, contractType: null,
  sourceFetchedAt: '2026-10-25T02:15:40.000Z', ...o,
});
const sale = (dealDate: string, price: number, area = 59.97, canceled = false): RawTx =>
  tx({ dealDate, price, exclusiveArea: area, dealCanceled: canceled, cancelDateRaw: canceled ? '26.10.01' : null });
const rent = (dealDate: string, deposit: number, monthlyRent: number, area = 59.97, contractType: string | null = '신규'): RawTx =>
  tx({ dealDate, deposit, monthlyRent, exclusiveArea: area, contractType });

interface FakeData {
  masters: MasterRow[];
  trades: Record<string, RawTx[]>; // `${masterId}|${transactionType}`
  verified?: Record<string, Record<string, string>>; // `${propertyType}|${transactionType}` -> month -> iso
  unattributed?: number;
  failWith?: Error;
}

function fakeDb(d: FakeData): SellflowDb {
  const rows = (f: TxFilter): RawTx[] => {
    const id = formatMasterId(f.master.propertyType, f.master.key);
    return (d.trades[`${id}|${f.window.transactionType}`] ?? [])
      .filter((r) => r.dealDate >= f.window.dateFrom && r.dealDate < f.window.dateToExclusive)
      .filter((r) => (f.window.minArea === null || r.exclusiveArea >= f.window.minArea) && (f.window.maxArea === null || r.exclusiveArea <= f.window.maxArea))
      .sort((a, b) => (a.dealDate < b.dealDate ? 1 : a.dealDate > b.dealDate ? -1 : 0));
  };
  return {
    async searchMasters(i) {
      if (d.failWith) throw d.failWith;
      return d.masters
        .filter((m) => m.propertyType === i.propertyType && m.lawdCd === i.lawdCd && (i.dong === null || m.dong === i.dong) && (i.qNormalized === null || m.normalizedName.includes(i.qNormalized)))
        .slice(0, i.take);
    },
    async getMaster(p) {
      if (d.failWith) throw d.failWith;
      return d.masters.find((m) => (p.propertyType === 'apartment' ? m.propertyType === 'apartment' && m.key === p.aptSeq : m.propertyType === 'officetel' && m.key === p.id)) ?? null;
    },
    async listTransactions(f, skip, take) {
      if (d.failWith) throw d.failWith;
      const all = rows(f).filter((r) => f.includeCanceled || r.dealCanceled !== true);
      return { rows: all.slice(skip, skip + take), total: all.length };
    },
    async listForSummary(f, max) {
      if (d.failWith) throw d.failWith;
      const base = rows(f);
      const active = base.filter((r) => r.dealCanceled !== true);
      return { rows: active.slice(0, max), overflow: active.length > max, canceledExcluded: f.window.transactionType === 'sale' ? base.length - active.length : null };
    },
    async getVerifiedMonths(i) {
      return d.verified?.[`${i.propertyType}|${i.transactionType}`] ?? {};
    },
    async countUnattributed() {
      return d.unattributed ?? 0;
    },
  };
}

const allVerified = (months: string[], at = '2026-10-24T21:00:00.000Z'): Record<string, string> => Object.fromEntries(months.map((m) => [m, at]));
const MONTHS_12 = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

function makeDeps(db: SellflowDb, over: Partial<SellflowHandlerDeps> = {}): { deps: SellflowHandlerDeps; logs: SellflowLogEntry[] } {
  const logs: SellflowLogEntry[] = [];
  return {
    logs,
    deps: {
      auth: { apiKey: KEY, enabled: 'true', propertyTypes: undefined },
      db,
      now: () => NOW,
      newRequestId: () => 'req-test-1',
      log: (e) => logs.push(e),
      ...over,
    },
  };
}

async function call(path: string, db: SellflowDb, init: { auth?: string | null; deps?: Partial<SellflowHandlerDeps> } = {}) {
  const { deps, logs } = makeDeps(db, init.deps);
  const headers: Record<string, string> = {};
  const auth = init.auth === undefined ? `Bearer ${KEY}` : init.auth;
  if (auth !== null) headers.authorization = auth;
  const u = new URL(`https://e-jip.test${path}`);
  const m = /\/buildings\/([^/]+)\/(transactions|summary)$/.exec(u.pathname);
  const route = u.pathname.endsWith('/search') ? ({ kind: 'search' } as const) : ({ kind: m![2] as 'transactions' | 'summary', masterId: m![1] } as const);
  const res = await handleSellflowRequest(new Request(u, { headers }), route, deps);
  return { res, body: (await res.json()) as any, logs };
}

const BASE = '/api/integrations/sellflow/v1/buildings';

// ------------------------------------------------------------------ auth
test('auth: 설정이 없거나 enabled가 아니면 키가 맞아도 503(fail-closed)', () => {
  assert.equal(authenticate(`Bearer ${KEY}`, { apiKey: undefined, enabled: 'true', propertyTypes: undefined }).ok, false);
  const r = authenticate(`Bearer ${KEY}`, { apiKey: KEY, enabled: undefined, propertyTypes: undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 503);
  const r2 = authenticate(`Bearer ${KEY}`, { apiKey: KEY, enabled: 'yes', propertyTypes: undefined });
  assert.equal(r2.ok, false);
});

test('auth: Authorization 없음/틀린 키/형식 오류 -> 401, 올바른 키 -> 200', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  const path = `${BASE}/search?lawdCd=26140&q=샘플`;
  for (const bad of [null, 'Bearer wrong', 'Basic abc', `Bearer`, `bearer ${KEY}x`]) {
    const r = await call(path, db, { auth: bad });
    assert.equal(r.res.status, 401, String(bad));
    assert.equal(r.body.success, false);
    assert.equal(r.body.error.code, 'UNAUTHORIZED');
    assert.equal(r.res.headers.get('www-authenticate'), 'Bearer');
  }
  const ok = await call(path, db);
  assert.equal(ok.res.status, 200);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.apiVersion, 'v1');
  assert.equal(ok.res.headers.get('x-request-id'), 'req-test-1');
});

test('auth: 응답과 로그 어디에도 키가 나오지 않는다', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  const bad = await call(`${BASE}/search?lawdCd=26140&q=샘플`, db, { auth: 'Bearer wrong-secret-value' });
  const ok = await call(`${BASE}/search?lawdCd=26140&q=샘플`, db);
  for (const r of [bad, ok]) {
    const text = JSON.stringify(r.body) + JSON.stringify(r.logs);
    assert.ok(!text.includes(KEY));
    assert.ok(!text.includes('wrong-secret-value'));
  }
});

test('403: 허용되지 않은 유형은 검색/조회 모두 막힌다', async () => {
  const db = fakeDb({ masters: [apt, offi], trades: {} });
  const only = { auth: { apiKey: KEY, enabled: 'true', propertyTypes: 'apartment' } };
  const s = await call(`${BASE}/search?lawdCd=26350&propertyType=officetel&q=샘플`, db, { deps: only });
  assert.equal(s.res.status, 403);
  const t = await call(`${BASE}/offi-11/transactions`, db, { deps: only });
  assert.equal(t.res.status, 403);
  // all은 허용된 유형만 검색한다.
  const all = await call(`${BASE}/search?lawdCd=26350&q=샘플`, db, { deps: only });
  assert.equal(all.res.status, 200);
  assert.equal(all.body.data.items.length, 0);
});

// ------------------------------------------------------------------ search
test('검색: 아파트·오피스텔을 같은 모양으로 돌려주고 이름 일치 순으로 정렬한다', async () => {
  const other: MasterRow = { ...offi, key: 99, name: '더샘플오피스텔', normalizedName: '더샘플오피스텔' };
  const db = fakeDb({ masters: [apt, { ...apt, key: '26140-1002', name: '샘플2', normalizedName: '샘플2' }, offi, other], trades: {} });
  const a = await call(`${BASE}/search?lawdCd=26140&q=샘플&propertyType=apartment`, db);
  assert.equal(a.res.status, 200);
  assert.deepEqual(a.body.data.items.map((i: any) => i.masterId), ['apt-26140-1001', 'apt-26140-1002']);
  const item = a.body.data.items[0];
  assert.equal(item.propertyType, 'apartment');
  assert.equal(item.masterMatchStatus, 'MATCHED');
  assert.equal(item.location.lawdCd, '26140');
  assert.equal(item.unitCountBasis, 'households');

  const o = await call(`${BASE}/search?lawdCd=26350&q=샘플`, db);
  assert.deepEqual(o.body.data.items.map((i: any) => i.masterId), ['offi-11', 'offi-99']); // 정확 일치(샘플오피스텔) 우선
  assert.equal(o.body.data.items[0].unitCountBasis, 'ho');
});

test('검색: 다동 주소 오피스텔은 UNRESOLVED(사유 포함), 이름 없는 master는 이름을 지어내지 않는다', async () => {
  const db = fakeDb({ masters: [offiMulti, offiNoName], trades: {} });
  const r = await call(`${BASE}/search?lawdCd=26350&dong=우동`, db);
  const byId = Object.fromEntries(r.body.data.items.map((i: any) => [i.masterId, i]));
  assert.equal(byId['offi-12'].masterMatchStatus, 'UNRESOLVED');
  assert.equal(byId['offi-12'].unresolvedReason, 'MULTI_MASTER_ADDRESS');
  assert.equal(byId['offi-13'].name, null);
  assert.equal(byId['offi-13'].masterMatchStatus, 'MATCHED');
});

test('검색: limit 상한과 truncated', async () => {
  const many = Array.from({ length: 30 }, (_, i): MasterRow => ({ ...apt, key: `26140-${2000 + i}`, name: `샘플${i}`, normalizedName: `샘플${i}` }));
  const db = fakeDb({ masters: many, trades: {} });
  const r = await call(`${BASE}/search?lawdCd=26140&q=샘플&limit=20`, db);
  assert.equal(r.body.data.items.length, 20);
  assert.equal(r.body.data.truncated, true);
  assert.equal((await call(`${BASE}/search?lawdCd=26140&q=샘플&limit=21`, db)).res.status, 400);
});

test('검색: 광역/무조건 검색 차단 및 입력 검증(400)', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  const cases = [
    `${BASE}/search?q=샘플`, // lawdCd 없음
    `${BASE}/search?lawdCd=2614&q=샘플`,
    `${BASE}/search?lawdCd=26140`, // q/dong 둘 다 없음
    `${BASE}/search?lawdCd=26140&q=a`, // 너무 짧음
    `${BASE}/search?lawdCd=26140&q=${'가'.repeat(41)}`,
    `${BASE}/search?lawdCd=26140&q=샘플&propertyType=villa`,
    `${BASE}/search?lawdCd=26140&q=샘플&sido=26`, // 알 수 없는 파라미터
  ];
  for (const c of cases) {
    const r = await call(c, db);
    assert.equal(r.res.status, 400, c);
    assert.equal(r.body.error.code, 'INVALID_PARAMETER');
  }
});

// ------------------------------------------------------------------ transactions
test('아파트 매매 조회: 기본으로 취소 제외, includeCanceled로 포함, 필드 계약', async () => {
  const trades = { 'apt-26140-1001|sale': [sale('2026-10-10', 52000), sale('2026-09-20', 51000, 84.98, true), sale('2026-08-01', 50000)] };
  const db = fakeDb({ masters: [apt], trades, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  const r = await call(`${BASE}/apt-26140-1001/transactions?transactionType=sale`, db);
  assert.equal(r.res.status, 200);
  assert.equal(r.body.data.resultState, 'HAS_DATA');
  assert.equal(r.body.data.items.length, 2);
  const first = r.body.data.items[0];
  assert.deepEqual(Object.keys(first).sort(), [
    'cancelDate', 'canceled', 'cancellationCoverage', 'contractType', 'deposit', 'dealDate', 'exclusiveArea', 'floor', 'masterId', 'masterMatchStatus',
    'monthlyRent', 'price', 'propertyType', 'sourceFetchedAt', 'transactionType',
  ].sort());
  assert.equal(first.price, 52000);
  assert.equal(first.deposit, null);
  assert.equal(first.canceled, false);
  assert.equal(first.masterMatchStatus, 'MATCHED');

  const inc = await call(`${BASE}/apt-26140-1001/transactions?includeCanceled=true`, db);
  assert.equal(inc.body.data.items.length, 3);
  const canceled = inc.body.data.items.find((i: any) => i.canceled === true);
  assert.equal(canceled.cancelDate, '2026-10-01');
});

test('오피스텔 매매 조회 + 2020년 이전 매매의 canceled는 false가 아니라 null', async () => {
  const trades = { 'offi-11|sale': [sale('2026-09-01', 30000, 30.1), sale('2019-05-05', 20000, 30.1)] };
  const db = fakeDb({ masters: [offi], trades });
  const r = await call(`${BASE}/offi-11/transactions?fromMonth=2019-05&toMonth=2019-05`, db);
  assert.equal(r.body.data.items[0].canceled, null);
  assert.equal(r.body.data.items[0].cancellationCoverage, 'NOT_PROVIDED_BY_SOURCE');
  const recent = await call(`${BASE}/offi-11/transactions`, db);
  assert.equal(recent.body.data.items[0].propertyType, 'officetel');
  assert.equal(recent.body.data.items[0].canceled, false);
  assert.equal(cancellationCoverageFor('sale', '2026-09-01'), 'PROVIDED');
});

test('전세/월세 조회(아파트·오피스텔): deposit/monthlyRent, 취소 개념 없음, 갱신 계약 표시', async () => {
  const trades = {
    'apt-26140-1001|jeonse': [rent('2026-10-02', 30000, 0)],
    'apt-26140-1001|wolse': [rent('2026-10-03', 5000, 80, 59.97, '갱신')],
    'offi-11|jeonse': [rent('2026-09-03', 10000, 0, 24.5)],
    'offi-11|wolse': [rent('2026-09-04', 1000, 60, 24.5)],
  };
  const db = fakeDb({ masters: [apt, offi], trades });
  const j = await call(`${BASE}/apt-26140-1001/transactions?transactionType=jeonse`, db);
  assert.equal(j.body.data.items[0].deposit, 30000);
  assert.equal(j.body.data.items[0].price, null);
  assert.equal(j.body.data.items[0].canceled, null);
  assert.equal(j.body.data.items[0].cancellationCoverage, 'NOT_PROVIDED_BY_SOURCE');
  const w = await call(`${BASE}/apt-26140-1001/transactions?transactionType=wolse`, db);
  assert.equal(w.body.data.items[0].monthlyRent, 80);
  assert.equal(w.body.data.items[0].contractType, '갱신');
  const oj = await call(`${BASE}/offi-11/transactions?transactionType=jeonse`, db);
  assert.equal(oj.body.data.items[0].propertyType, 'officetel');
  const ow = await call(`${BASE}/offi-11/transactions?transactionType=wolse`, db);
  assert.equal(ow.body.data.items[0].monthlyRent, 60);
  // 전월세에는 includeCanceled를 쓸 수 없다.
  assert.equal((await call(`${BASE}/offi-11/transactions?transactionType=wolse&includeCanceled=true`, db)).res.status, 400);
});

test('기간·전용면적 필터', async () => {
  const trades = { 'apt-26140-1001|sale': [sale('2026-10-10', 1, 84.98), sale('2026-06-10', 2, 59.97), sale('2025-12-10', 3, 59.97)] };
  const db = fakeDb({ masters: [apt], trades });
  const p = await call(`${BASE}/apt-26140-1001/transactions?fromMonth=2026-06&toMonth=2026-06`, db);
  assert.deepEqual(p.body.data.items.map((i: any) => i.price), [2]);
  const a = await call(`${BASE}/apt-26140-1001/transactions?minArea=80&maxArea=90`, db);
  assert.deepEqual(a.body.data.items.map((i: any) => i.price), [1]);
  // 면적은 반올림해 합치지 않는다 — 59.97은 59.97로 나온다.
  const b = await call(`${BASE}/apt-26140-1001/transactions?minArea=59&maxArea=60`, db);
  assert.equal(b.body.data.items[0].exclusiveArea, 59.97);
  assert.equal((await call(`${BASE}/apt-26140-1001/transactions?minArea=90&maxArea=80`, db)).res.status, 400);
});

test('페이지네이션: totalItems/totalPages/hasMore, 상한 초과는 400', async () => {
  const many = Array.from({ length: 120 }, (_, i) => sale(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`, 1000 + i));
  const db = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': many } });
  const p1 = await call(`${BASE}/apt-26140-1001/transactions?pageSize=50&page=1`, db);
  assert.equal(p1.body.data.items.length, 50);
  assert.deepEqual(p1.body.data.pagination, { page: 1, pageSize: 50, totalItems: 120, totalPages: 3, hasMore: true });
  const p3 = await call(`${BASE}/apt-26140-1001/transactions?pageSize=50&page=3`, db);
  assert.equal(p3.body.data.items.length, 20);
  assert.equal(p3.body.data.pagination.hasMore, false);
  for (const q of ['pageSize=101', 'page=51', 'page=0', 'pageSize=abc']) {
    assert.equal((await call(`${BASE}/apt-26140-1001/transactions?${q}`, db)).res.status, 400, q);
  }
});

test('최대 조회 기간 제한(36개월) 및 미래/형식 오류', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  assert.equal(MAX_PERIOD_MONTHS, 36);
  assert.equal((await call(`${BASE}/apt-26140-1001/transactions?fromMonth=2023-11&toMonth=2026-10`, db)).res.status, 200); // 정확히 36개월
  const long = await call(`${BASE}/apt-26140-1001/transactions?fromMonth=2023-10&toMonth=2026-10`, db); // 37개월
  assert.equal(long.res.status, 400);
  assert.equal(long.body.error.code, 'PERIOD_TOO_LONG');
  assert.equal((await call(`${BASE}/apt-26140-1001/summary?fromMonth=2020-01&toMonth=2026-10`, db)).res.status, 400);
  for (const q of ['toMonth=2026-11', 'fromMonth=2026-13', 'fromMonth=2026-10&toMonth=2026-09', 'fromMonth=2005-12', 'transactionType=lease', 'foo=1']) {
    assert.equal((await call(`${BASE}/apt-26140-1001/transactions?${q}`, db)).res.status, 400, q);
  }
});

test('masterId: 형식 오류 400, 존재하지 않음 404', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  assert.equal((await call(`${BASE}/not-an-id/transactions`, db)).res.status, 400);
  assert.equal((await call(`${BASE}/offi-0/transactions`, db)).res.status, 400);
  const nf = await call(`${BASE}/apt-26140-9999/summary`, db);
  assert.equal(nf.res.status, 404);
  assert.equal(nf.body.error.code, 'MASTER_NOT_FOUND');
  assert.deepEqual(parseMasterId('apt-26140-1164'), { propertyType: 'apartment', aptSeq: '26140-1164' });
  assert.equal(formatMasterId('officetel', 7), 'offi-7');
});

// ------------------------------------------------------------------ truth: zero / unresolved / failure
test('거래 없음: 검증된 구간이면 NO_TRANSACTIONS_VERIFIED, 검증 없으면 UNVERIFIED(없다고 단정하지 않음)', async () => {
  const verified = await call(`${BASE}/apt-26140-1001/transactions`, fakeDb({ masters: [apt], trades: {}, verified: { 'apartment|sale': allVerified(MONTHS_12) } }));
  assert.equal(verified.body.data.items.length, 0);
  assert.equal(verified.body.data.resultState, 'NO_TRANSACTIONS_VERIFIED');
  assert.equal(verified.body.data.verification.freshnessStatus, 'FRESH');
  assert.equal(verified.body.data.verification.coverageStatus, 'COMPLETE');

  const unverified = await call(`${BASE}/apt-26140-1001/transactions`, fakeDb({ masters: [apt], trades: {} }));
  assert.equal(unverified.body.data.resultState, 'NO_TRANSACTIONS_UNVERIFIED');
  assert.equal(unverified.body.data.verification.freshnessStatus, 'UNVERIFIED');
  assert.equal(unverified.body.data.verification.coverageStatus, 'UNVERIFIED');

  const partial = await call(`${BASE}/apt-26140-1001/transactions`, fakeDb({ masters: [apt], trades: {}, verified: { 'apartment|sale': { '2026-10': '2026-10-24T21:00:00.000Z' } } }));
  assert.equal(partial.body.data.resultState, 'NO_TRANSACTIONS_UNVERIFIED');
  // 최근 달은 검증돼 FRESH, 요청 기간 일부만 검증돼 PARTIAL — 둘이 동시에 표현된다.
  assert.equal(partial.body.data.verification.freshnessStatus, 'FRESH');
  assert.equal(partial.body.data.verification.coverageStatus, 'PARTIAL');
});

test('미연결 Master(다동 주소): 거래를 내보내지 않고 UNATTRIBUTED_AT_ADDRESS + 건수만', async () => {
  const db = fakeDb({ masters: [offiMulti], trades: { 'offi-12|sale': [sale('2026-10-10', 99999)] }, unattributed: 349 });
  const t = await call(`${BASE}/offi-12/transactions`, db);
  assert.equal(t.res.status, 200);
  assert.equal(t.body.data.building.masterMatchStatus, 'UNRESOLVED');
  assert.equal(t.body.data.resultState, 'UNATTRIBUTED_AT_ADDRESS');
  assert.equal(t.body.data.items.length, 0);
  assert.equal(t.body.data.unattributed.unattributedAtAddressCount, 349);
  const s = await call(`${BASE}/offi-12/summary`, db);
  assert.equal(s.body.data.resultState, 'UNATTRIBUTED_AT_ADDRESS');
  assert.equal(s.body.data.masterMatchStatus, 'UNRESOLVED');
  assert.equal(s.body.data.statistics.sampleStatus, 'NO_DATA');
  assert.ok(!JSON.stringify(s.body).includes('99999'));
});

test('조회 실패는 빈 결과가 아니라 500, 로그에는 메시지가 남지 않는다', async () => {
  const db = fakeDb({ masters: [apt], trades: {}, failWith: new Error('connection to postgres://user:pw@host failed') });
  const seen: string[] = [];
  const r = await call(`${BASE}/apt-26140-1001/transactions`, db, { deps: { onUnexpectedError: (n) => seen.push(n) } });
  assert.equal(r.res.status, 500);
  assert.equal(r.body.success, false);
  assert.equal(r.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(r.body).includes('postgres'));
  assert.deepEqual(seen, ['Error']);
  assert.ok(!JSON.stringify(r.logs).includes('postgres'));
  assert.equal(r.logs[0].status, 500);
});

// ------------------------------------------------------------------ summary / statistics
test('summary: 충분한 표본 -> SUFFICIENT, 취소 제외, 메타 필드 포함', async () => {
  const trades = {
    'apt-26140-1001|sale': [
      sale('2026-10-10', 50000), sale('2026-10-05', 52000), sale('2026-09-10', 54000), sale('2026-08-10', 56000),
      sale('2026-07-10', 58000), sale('2026-06-10', 99999, 59.97, true), sale('2026-06-11', 60000, 84.98),
    ],
  };
  const db = fakeDb({ masters: [apt], trades, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  const r = await call(`${BASE}/apt-26140-1001/summary`, db);
  assert.equal(r.res.status, 200);
  const d = r.body.data;
  assert.equal(r.body.asOf, NOW.toISOString());
  assert.deepEqual(d.period, { fromMonth: '2025-11', toMonth: '2026-10' });
  assert.equal(d.resultState, 'HAS_DATA');
  assert.equal(d.masterMatchStatus, 'MATCHED');
  assert.equal(d.verification.freshnessStatus, 'FRESH');
  assert.equal(d.verification.coverageStatus, 'COMPLETE');
  const s = d.statistics;
  assert.equal(s.sampleCount, 6);
  assert.equal(s.sampleStatus, 'SUFFICIENT');
  assert.equal(s.canceledIncluded, false);
  assert.equal(s.quality.canceledExcludedCount, 1);
  assert.deepEqual(s.metrics.price, { min: 50000, max: 60000, median: 55000 });
  assert.equal(s.latest.dealDate, '2026-10-10');
  assert.ok(typeof s.calculationMethod === 'string' && s.calculationMethod.length > 20);
  assert.deepEqual(s.byExclusiveArea.map((g: any) => [g.exclusiveArea, g.count]), [[59.97, 5], [84.98, 1]]); // 면적은 합치지 않음
});

test('summary: 표본 부족 -> LOW_SAMPLE(중앙값 없음), 0건 -> NO_DATA', async () => {
  const trades = { 'apt-26140-1001|sale': [sale('2026-10-10', 50000), sale('2026-10-05', 52000)] };
  const db = fakeDb({ masters: [apt], trades, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  const low = (await call(`${BASE}/apt-26140-1001/summary`, db)).body.data;
  assert.equal(low.statistics.sampleStatus, 'LOW_SAMPLE');
  assert.deepEqual(low.statistics.metrics.price, { min: 50000, max: 52000, median: null });

  const none = (await call(`${BASE}/apt-26140-1001/summary?fromMonth=2024-01&toMonth=2024-03`, db)).body.data;
  assert.equal(none.statistics.sampleStatus, 'NO_DATA');
  assert.equal(none.statistics.latest, null);
  assert.deepEqual(none.statistics.metrics.price, { min: null, max: null, median: null });
  assert.equal(none.resultState, 'NO_TRANSACTIONS_UNVERIFIED'); // 이 구간은 검증 기록이 없다
});

test('summary: 월세는 보증금·월세 각각 통계, 전세는 deposit', async () => {
  const w = Array.from({ length: 5 }, (_, i) => rent(`2026-10-0${i + 1}`, 1000 * (i + 1), 50 + i));
  const db = fakeDb({ masters: [offi], trades: { 'offi-11|wolse': w, 'offi-11|jeonse': [rent('2026-10-01', 9000, 0)] } });
  const ws = (await call(`${BASE}/offi-11/summary?transactionType=wolse`, db)).body.data.statistics;
  assert.equal(ws.primaryMetricName, 'deposit');
  assert.deepEqual(ws.metrics.deposit, { min: 1000, max: 5000, median: 3000 });
  assert.deepEqual(ws.metrics.monthlyRent, { min: 50, max: 54, median: 52 });
  assert.equal(ws.quality.canceledExcludedCount, null);
  const js = (await call(`${BASE}/offi-11/summary?transactionType=jeonse`, db)).body.data.statistics;
  assert.equal(js.metrics.price, undefined);
  assert.equal(js.sampleStatus, 'LOW_SAMPLE');
});

test('summary: includeCanceled 파라미터는 지원하지 않는다(통계는 항상 취소 제외)', async () => {
  const db = fakeDb({ masters: [apt], trades: {} });
  assert.equal((await call(`${BASE}/apt-26140-1001/summary?includeCanceled=true`, db)).res.status, 400);
});

test('summary: 행 상한 초과는 통계를 만들지 않고 400', async () => {
  const big = Array.from({ length: 5001 }, () => sale('2026-10-10', 1000));
  const db = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': big } });
  const r = await call(`${BASE}/apt-26140-1001/summary`, db);
  assert.equal(r.res.status, 400);
  assert.equal(r.body.error.code, 'RANGE_TOO_LARGE');
});

test('통계 순수 함수: 중앙값 홀짝, 동일 내용 형제 행, 2020 이전 취소 미제공 행 수', () => {
  assert.deepEqual(computeMetricStats([5, 1, 3, 2, 4, 6]), { min: 1, max: 6, median: 3.5 });
  assert.deepEqual(computeMetricStats([3, 1]), { min: 1, max: 3, median: null });
  const rows = [sale('2019-01-01', 100), sale('2019-01-01', 100), sale('2026-01-01', 100)];
  const s = buildSummaryStatistics(rows, 'sale', 0);
  assert.equal(s.quality.identicalSiblingRows, 2);
  assert.equal(s.quality.rowsWithoutCancellationCoverage, 2);
});

test('verification: 최근 달 FRESH + 과거 달 미검증 -> freshness FRESH, coverage PARTIAL', () => {
  const recent = recentMonths(NOW);
  assert.deepEqual(recent, ['2026-08', '2026-09', '2026-10']);
  const v = computeVerification(MONTHS_12, recent, { '2026-09': '2026-10-24T21:00:00.000Z', '2026-10': '2026-10-25T01:00:00.000Z' }, NOW);
  assert.equal(v.freshnessStatus, 'FRESH');
  assert.equal(v.coverageStatus, 'PARTIAL');
  assert.equal(v.coverage.monthsVerified, 2);
  assert.equal(v.coverage.unverifiedMonths.length, 10);
  assert.equal(v.recent.monthsVerified, 2);
});

test('verification: 최근 달 검증이 모두 오래됨 -> STALE, 최근 달 검증 없음 -> UNVERIFIED', () => {
  const recent = recentMonths(NOW);
  const stale = computeVerification(MONTHS_12, recent, { '2026-09': '2026-09-01T00:00:00.000Z', '2026-10': '2026-10-10T00:00:00.000Z' }, NOW);
  assert.equal(stale.freshnessStatus, 'STALE'); // 가장 최근 검증도 8일 초과
  // 한 달만 오래돼도 다른 최근 달이 최근에 검증됐으면 파이프라인은 살아 있다 -> FRESH (달별 나이는 recent.oldestVerifiedAt에 남는다).
  const rotating = computeVerification(MONTHS_12, recent, { '2026-08': '2026-09-06T21:57:00.000Z', '2026-09': '2026-10-24T21:57:00.000Z' }, NOW);
  assert.equal(rotating.freshnessStatus, 'FRESH');
  assert.equal(rotating.recent.oldestVerifiedAt, '2026-09-06T21:57:00.000Z');
  const none = computeVerification(MONTHS_12, recent, {}, NOW);
  assert.equal(none.freshnessStatus, 'UNVERIFIED');
  assert.equal(none.coverageStatus, 'UNVERIFIED');
  // 과거 달만 검증됐고 최근 달은 없으면 최신성은 UNVERIFIED(과거 검증이 최신성을 대신하지 않는다).
  const oldOnly = computeVerification(MONTHS_12, recent, { '2025-12': '2026-10-25T00:00:00.000Z' }, NOW);
  assert.equal(oldOnly.freshnessStatus, 'UNVERIFIED');
  assert.equal(oldOnly.coverageStatus, 'PARTIAL');
});

test('verification: 요청 기간 전체가 검증되면 coverage COMPLETE', () => {
  const v = computeVerification(MONTHS_12, recentMonths(NOW), allVerified(MONTHS_12), NOW);
  assert.equal(v.coverageStatus, 'COMPLETE');
  assert.equal(v.freshnessStatus, 'FRESH');
  assert.deepEqual(v.coverage.unverifiedMonths, []);
});

test('거래 0건이어도 최근 달 sync가 정상이면 freshness는 STALE이 아니다(과거 달 미검증이면 coverage만 PARTIAL)', async () => {
  const db = fakeDb({ masters: [apt], trades: {}, verified: { 'apartment|sale': { '2026-09': '2026-10-24T21:00:00.000Z', '2026-10': '2026-10-25T01:00:00.000Z' } } });
  const r = await call(`${BASE}/apt-26140-1001/transactions`, db);
  assert.equal(r.body.data.items.length, 0);
  assert.equal(r.body.data.verification.freshnessStatus, 'FRESH');
  assert.equal(r.body.data.verification.coverageStatus, 'PARTIAL');
  assert.equal(r.body.data.resultState, 'NO_TRANSACTIONS_UNVERIFIED');
});

test('아파트 전월세: 최근 월 셀만 있는 과거 구간 -> FRESH + PARTIAL (최신성 실패로 표현하지 않음)', async () => {
  const trades = { 'apt-26140-1001|wolse': [rent('2026-10-03', 5000, 80)] };
  // 실제 상태와 같은 모양: 최근 3개월 중 2026-07~09 셀만 있고(현재 월 셀 없음), 12개월 창의 나머지는 개별 셀이 없다.
  const verified = { 'apartment|wolse': { '2026-07': '2026-10-24T21:57:00.000Z', '2026-08': '2026-10-24T21:57:00.000Z', '2026-09': '2026-10-24T21:57:00.000Z' } };
  const db = fakeDb({ masters: [apt], trades, verified });
  const t = await call(`${BASE}/apt-26140-1001/transactions?transactionType=wolse`, db);
  assert.equal(t.body.data.verification.freshnessStatus, 'FRESH');
  assert.equal(t.body.data.verification.coverageStatus, 'PARTIAL');
  assert.equal(t.body.data.verification.coverage.monthsVerified, 3);
  assert.equal(t.body.data.verification.recent.monthsVerified, 2); // 2026-08, 2026-09 (현재 월 셀은 아직 없음)
  assert.equal(t.body.data.resultState, 'HAS_DATA');
});

test('오피스텔 전월세: 최근 2개월 셀 위주 -> FRESH + PARTIAL', async () => {
  const trades = { 'offi-11|jeonse': [rent('2026-09-03', 10000, 0, 24.5)] };
  const verified = { 'officetel|jeonse': { '2026-09': '2026-10-25T01:19:14.000Z', '2026-10': '2026-10-25T01:19:27.000Z' } };
  const db = fakeDb({ masters: [offi], trades, verified });
  const s = await call(`${BASE}/offi-11/summary?transactionType=jeonse`, db);
  assert.equal(s.body.data.verification.freshnessStatus, 'FRESH');
  assert.equal(s.body.data.verification.coverageStatus, 'PARTIAL');
  assert.equal(s.body.data.verification.coverage.monthsVerified, 2);
});

test('contentGuidance: FRESH+COMPLETE+SUFFICIENT+단일 면적만 periodTrendEligible, 그 외는 이유 코드', async () => {
  const sales = Array.from({ length: 6 }, (_, i) => sale(`2026-10-0${i + 1}`, 50000 + i * 100));
  const full = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': sales }, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  const ok = (await call(`${BASE}/apt-26140-1001/summary`, full)).body.data.contentGuidance;
  assert.deepEqual(ok, { recentFactsAllowed: true, periodTrendEligible: true, reasons: [] });

  const partial = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': sales }, verified: { 'apartment|sale': { '2026-10': '2026-10-25T01:00:00.000Z' } } });
  const p = (await call(`${BASE}/apt-26140-1001/summary`, partial)).body.data.contentGuidance;
  assert.equal(p.recentFactsAllowed, true);
  assert.equal(p.periodTrendEligible, false);
  assert.deepEqual(p.reasons, ['COVERAGE_NOT_COMPLETE']);

  const low = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': sales.slice(0, 2) }, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  const l = (await call(`${BASE}/apt-26140-1001/summary`, low)).body.data.contentGuidance;
  assert.deepEqual(l.reasons, ['LOW_SAMPLE']);
  assert.equal(l.periodTrendEligible, false);

  const mixed = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': [...sales, sale('2026-10-09', 90000, 84.98)] }, verified: { 'apartment|sale': allVerified(MONTHS_12) } });
  assert.deepEqual((await call(`${BASE}/apt-26140-1001/summary`, mixed)).body.data.contentGuidance.reasons, ['MIXED_AREAS']);

  const noVerify = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': sales } });
  const nv = (await call(`${BASE}/apt-26140-1001/summary`, noVerify)).body.data.contentGuidance;
  assert.equal(nv.recentFactsAllowed, false);
  assert.ok(nv.reasons.includes('NOT_FRESH') && nv.reasons.includes('COVERAGE_NOT_COMPLETE'));

  const none = computeContentGuidance({ matched: false, sampleStatus: 'NO_DATA', distinctAreaCount: 0, verification: computeVerification(MONTHS_12, recentMonths(NOW), allVerified(MONTHS_12), NOW) });
  assert.equal(none.recentFactsAllowed, false);
  assert.deepEqual(none.reasons, ['NOT_MATCHED', 'NO_DATA']);
});

test('source 메타데이터: 데이터셋별 출처(표시 문구가 아닌 메타)', async () => {
  const db = fakeDb({ masters: [apt, offi], trades: {} });
  const a = (await call(`${BASE}/apt-26140-1001/transactions?transactionType=jeonse`, db)).body.data.sources;
  assert.equal(a.transactions.name, '국토교통부 실거래가 공개자료');
  assert.equal(a.transactions.dataset, '국토교통부_아파트 전월세 실거래가 자료');
  assert.equal(a.building.dataset, '국토교통부_건축HUB_건축물대장정보 서비스');
  const o = await call(`${BASE}/offi-11/summary`, db);
  assert.equal(o.body.data.sources.transactions.dataset, '국토교통부_오피스텔 매매 실거래가 자료');
  assert.equal(o.body.asOf, NOW.toISOString());
});

test('Kakao 좌표 제거: 검색/거래/요약 응답과 샘플 JSON에 위경도 키가 없다', async () => {
  const sales = Array.from({ length: 5 }, () => sale('2026-10-01', 50000));
  const db = fakeDb({ masters: [apt, offi, offiMulti], trades: { 'apt-26140-1001|sale': sales, 'offi-11|sale': sales }, unattributed: 3 });
  const bodies = [
    await call(`${BASE}/search?lawdCd=26140&q=샘플`, db),
    await call(`${BASE}/search?lawdCd=26350&dong=우동`, db),
    await call(`${BASE}/apt-26140-1001/transactions`, db),
    await call(`${BASE}/offi-11/transactions`, db),
    await call(`${BASE}/apt-26140-1001/summary`, db),
    await call(`${BASE}/offi-12/summary`, db),
    await call(`${BASE}/offi-12/transactions`, db),
  ].map((r) => JSON.stringify(r.body));
  const re = /"(latitude|longitude|lat|lng|lon|coordinates?)"\s*:/i;
  for (const t of bodies) assert.ok(!re.test(t));
  const { readFileSync } = await import('node:fs');
  const samples = readFileSync('docs/development/sellflow-data-api-v1-samples.json', 'utf8');
  assert.ok(!re.test(samples));
  JSON.parse(samples);
});

test('취소일 표기 정규화: YY.MM.DD / YYYYMMDD / 해석 불가는 null', () => {
  assert.equal(normalizeCancelDate('26.10.05'), '2026-10-05');
  assert.equal(normalizeCancelDate('20261005'), '2026-10-05');
  assert.equal(normalizeCancelDate('2026-10-05'), '2026-10-05');
  assert.equal(normalizeCancelDate('garbage'), null);
  assert.equal(normalizeCancelDate(null), null);
});

// ------------------------------------------------------------------ exposure
test('내부 필드/개인정보 미노출', async () => {
  const trades = { 'apt-26140-1001|sale': [sale('2026-10-10', 50000)], 'offi-11|wolse': [rent('2026-10-10', 1000, 50)] };
  const db = fakeDb({ masters: [apt, offi], trades });
  const bodies = [
    await call(`${BASE}/search?lawdCd=26140&q=샘플`, db),
    await call(`${BASE}/apt-26140-1001/transactions`, db),
    await call(`${BASE}/offi-11/transactions?transactionType=wolse`, db),
    await call(`${BASE}/apt-26140-1001/summary`, db),
  ].map((r) => JSON.stringify(r.body));
  for (const text of bodies) {
    for (const forbidden of ['canonicalKey', 'canonical_key', 'rawUid', 'occurrenceIndex', 'identityKey', 'groupKey', 'officetelMasterId', 'email', 'password', 'userId', 'pyeong', '"id":']) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  }
});

test('파서: includeCanceled/page 기본값, 검색 파서의 허용 유형 처리', () => {
  const q = parseTransactionsQuery([], () => null, NOW);
  assert.equal(q.transactionType, 'sale');
  assert.equal(q.fromMonth, '2025-11');
  assert.equal(q.toMonth, '2026-10');
  assert.equal(q.includeCanceled, false);
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, 50);
  assert.equal(q.dateToExclusive, '2026-11-01');
  const s = parseSearchQuery(['lawdCd', 'q'], (k) => ({ lawdCd: '26140', q: '샘플 아파트' })[k as 'lawdCd' | 'q'] ?? null, ['apartment', 'officetel']);
  assert.equal(s.qNormalized, '샘플');
});

test('운영 로그: requestId/endpoint/status/ms/rows/code만', async () => {
  const db = fakeDb({ masters: [apt], trades: { 'apt-26140-1001|sale': [sale('2026-10-10', 50000)] } });
  const ok = await call(`${BASE}/apt-26140-1001/transactions`, db);
  assert.deepEqual(Object.keys(ok.logs[0]).sort(), ['code', 'endpoint', 'evt', 'ms', 'requestId', 'rows', 'status']);
  assert.equal(ok.logs[0].rows, 1);
  assert.equal(ok.logs[0].endpoint, 'transactions');
  const denied = await call(`${BASE}/search?lawdCd=26140&q=샘플`, db, { auth: null });
  assert.equal(denied.logs[0].status, 401);
  assert.equal(denied.logs[0].code, 'UNAUTHORIZED');
});

test('summary: 면적이 섞이면 distinctAreaCount로 알리고 면적별 통계(표본 5건 미만이면 median null)를 따로 준다; 전월세는 취소 미제공 행 수가 null', () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => sale(`2026-10-0${i + 1}`, 50000 + i * 1000, 59.97)),
    sale('2026-10-09', 90000, 84.98),
  ];
  const s = buildSummaryStatistics(rows, 'sale', 0);
  assert.equal(s.distinctAreaCount, 2);
  const g59 = s.byExclusiveArea.find((g) => g.exclusiveArea === 59.97)!;
  const g84 = s.byExclusiveArea.find((g) => g.exclusiveArea === 84.98)!;
  assert.equal(g59.sampleStatus, 'SUFFICIENT');
  assert.deepEqual(g59.primaryMetric, { min: 50000, max: 54000, median: 52000 });
  assert.equal(g84.sampleStatus, 'LOW_SAMPLE');
  assert.deepEqual(g84.primaryMetric, { min: 90000, max: 90000, median: null });
  const r = buildSummaryStatistics([rent('2026-10-01', 1000, 50)], 'wolse', null);
  assert.equal(r.quality.rowsWithoutCancellationCoverage, null);
});
