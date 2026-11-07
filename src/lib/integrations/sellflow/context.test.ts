// SELLFLOW_DATA_API_V1.3 — 단지·교육 컨텍스트 / 지역 개발·공급 컨텍스트 테스트. 가짜 인메모리 DB만 쓴다(운영 데이터·네트워크·파일 접근 없음). 모든 값은 모의 값이다.
// 실행: npx tsx --test src/lib/integrations/sellflow/context.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSellflowRequest, type SellflowHandlerDeps, type SellflowRoute } from './handler';
import {
  PRESALE_FRESH_DAYS,
  STAGE_GROUP,
  WITHHELD,
  buildComplexAttributes,
  buildEducation,
  buildPresaleSection,
  buildRedevelopmentSection,
  getAreaContext,
  isAccessDenied,
  presaleStatusAt,
  type ComplexAttributesRow,
  type EducationZoneInfo,
  type PresaleRows,
  type RedevelopmentRows,
  type SellflowContextDb,
} from './context';
import type { MasterRow, SellflowDb } from './service';

const NOW = new Date('2026-10-25T03:00:00.000Z');
const KEY = 'test-key-not-a-secret';

const apt: MasterRow = {
  propertyType: 'apartment', key: '26500-1001', name: '샘플아파트', normalizedName: '샘플', lawdCd: '26500', sigungu: '수영구', dong: '광안동', jibun: '1', buildingDong: null,
  roadAddress: '샘플로 1', jibunAddress: '부산 수영구 광안동 1', buildYear: 2010, unitCount: 500, unitCountBasis: 'households', mastersAtAddress: 1, historyKeyOk: true,
};
const offi: MasterRow = { ...apt, propertyType: 'officetel', key: 11, name: '샘플오피스텔', unitCountBasis: 'ho', unitCount: 300 };
const spec = (over: Partial<ComplexAttributesRow> = {}): ComplexAttributesRow => ({
  parkingCount: 600, floorAreaRatio: 249.8, buildingCoverageRatio: 18.2, mainBuildingCount: 6, useApprovalDate: '20100301', basicSpecSource: 'BUILDINGHUB_GENERAL_TITLE', updatedAt: '2026-08-01T00:00:00.000Z', ...over,
});
const zone = (over: Partial<EducationZoneInfo['elementary']> = {}, mid: Partial<EducationZoneInfo['middle']> = {}): EducationZoneInfo => ({
  elementary: {
    status: 'AVAILABLE', reasonCode: 'SINGLE_ZONE', zoneName: '샘플초통학구역', zoneType: 'SINGLE', sourceDate: '2026-03-20', sourceName: '한국교육시설안전원 초등학교통학구역', notice: '출처: 한국교육시설안전원',
    schools: [{ schoolName: '샘플초등학교', identityConfidence: 'HIGH' }, { schoolName: '확인불가초', identityConfidence: 'LOW' }], ...over,
  },
  middle: { status: 'AVAILABLE', reasonCode: 'ZONE', groupName: '샘플학교군', schools: [{ schoolName: '샘플중학교', identityConfidence: 'MEDIUM' }], sourceDate: '2026-03-20', ...mid },
  datasetVersion: 'busan-20260320', generatedAt: '2026-08-22T00:00:00.000Z',
});

// ------------------------------------------------------------------ 단지 속성
test('단지 속성: 출처가 확인된 값만 내고, 세대당 주차대수는 주차대수÷세대수로 계산한다', () => {
  const c = buildComplexAttributes(apt, spec());
  assert.equal(c.status, 'HAS_DATA');
  assert.equal(c.basis, 'BUILDINGHUB_GENERAL_TITLE');
  assert.deepEqual(c.attributes, { parkingCount: 600, parkingPerHousehold: 1.2, floorAreaRatio: 249.8, buildingCoverageRatio: 18.2, mainBuildingCount: 6, useApprovalDate: '20100301' });
  assert.deepEqual(c.omitted, []);
});

test('단지 속성: 결측·0은 추측하거나 0으로 채우지 않고 omitted로 알린다; 세대수를 모르면 세대당 주차대수는 없다', () => {
  const c = buildComplexAttributes({ ...apt, unitCount: null }, spec({ parkingCount: 0, floorAreaRatio: null }));
  assert.equal(c.attributes.parkingCount, null);
  assert.equal(c.attributes.floorAreaRatio, null);
  assert.equal(c.attributes.parkingPerHousehold, null);
  assert.ok(c.omitted.some((o) => o.field === 'parkingCount' && o.reason === 'MISSING_OR_ZERO'));
  assert.ok(c.omitted.some((o) => o.field === 'parkingPerHousehold' && o.reason === 'MISSING_OR_ZERO'));
  assert.equal(c.attributes.buildingCoverageRatio, 18.2);
});

test('단지 속성: 출처를 알 수 없는 값(UNKNOWN)은 값이 있어도 내지 않는다; 비현실적인 세대당 주차대수와 잘못된 날짜 형식도 내지 않는다', () => {
  const unknown = buildComplexAttributes(apt, spec({ basicSpecSource: 'UNKNOWN' }));
  assert.equal(unknown.status, 'NO_DATA');
  assert.ok(Object.values(unknown.attributes).every((v) => v === null));
  assert.ok(unknown.omitted.every((o) => o.reason === 'SOURCE_UNKNOWN'));
  const odd = buildComplexAttributes({ ...apt, unitCount: 10 }, spec({ parkingCount: 900, useApprovalDate: '2010/03' }));
  assert.equal(odd.attributes.parkingPerHousehold, null);
  assert.ok(odd.omitted.some((o) => o.field === 'parkingPerHousehold' && o.reason === 'IMPLAUSIBLE'));
  assert.equal(odd.attributes.useApprovalDate, null);
  assert.equal(buildComplexAttributes(apt, null).status, 'NO_DATA');
  assert.equal(buildComplexAttributes(offi, spec()).status, 'NOT_COVERED');
});

// ------------------------------------------------------------------ 교육
test('교육: 공식 통학구역은 확정된 학교만(신뢰도 낮은 것 제외), 거리는 제공하지 않고 측정 방식을 만들지 않는다', () => {
  const e = buildEducation(apt, () => zone());
  assert.equal(e.status, 'HAS_DATA');
  assert.deepEqual(e.attendanceZone?.elementary.schools, [{ schoolName: '샘플초등학교', identityConfidence: 'HIGH' }]);
  assert.deepEqual(e.attendanceZone?.middle.schools, [{ schoolName: '샘플중학교', identityConfidence: 'MEDIUM' }]);
  assert.equal(e.attendanceZone?.attributionNotice, '출처: 한국교육시설안전원');
  assert.deepEqual(e.schoolDistance, { status: 'WITHHELD', measurement: null });
  const text = JSON.stringify(e);
  assert.doesNotMatch(text, /distanceM|walk|minutes|도보|직선거리|latitude|longitude/);
});

test('교육: 검토 필요·자료 없음 구역은 학교를 내지 않고, 부산 밖·오피스텔은 NOT_COVERED', () => {
  const review = buildEducation(apt, () => zone({ status: 'REVIEW_REQUIRED' }, { status: 'NOT_AVAILABLE' }));
  assert.equal(review.status, 'NO_DATA');
  assert.deepEqual(review.attendanceZone?.elementary.schools, []);
  assert.deepEqual(review.attendanceZone?.middle.schools, []);
  assert.equal(buildEducation(apt, () => null).status, 'NOT_COVERED');
  assert.equal(buildEducation(offi, () => zone()).status, 'NOT_COVERED');
  const shared = buildEducation(apt, () => zone({ status: 'SHARED', zoneType: 'JOINT_SYMMETRIC' }));
  assert.equal(shared.attendanceZone?.elementary.status, 'SHARED');
});

test('라이선스 미확정 데이터는 withheld로만 알리고 응답에 값이 없다', () => {
  const cats = WITHHELD.map((w) => w.category).sort();
  assert.deepEqual(cats, ['COMPLEX_COMMUNITY_FACILITIES', 'LIVING_FACILITIES', 'SCHOOL_DISTANCE', 'SCHOOL_STATISTICS', 'TRANSIT']);
  assert.ok(WITHHELD.every((w) => w.reason === 'LICENSE_PENDING' || w.reason === 'SOURCE_UNVERIFIED'));
});

// ------------------------------------------------------------------ 재개발·재건축
const redevRows = (over: Partial<RedevelopmentRows> = {}): RedevelopmentRows => ({
  groups: [
    { stage: 'PROMOTION_COMMITTEE', businessType: 'REDEVELOPMENT', projectStatus: 'ACTIVE', needsReview: false, count: 3 },
    { stage: 'CONSTRUCTION', businessType: 'RECONSTRUCTION', projectStatus: 'ACTIVE', needsReview: false, count: 2 },
    { stage: 'COMPLETED', businessType: 'RECONSTRUCTION', projectStatus: 'COMPLETED', needsReview: false, count: 1 },
    { stage: 'CANCELLED', businessType: 'REDEVELOPMENT', projectStatus: 'CANCELLED', needsReview: false, count: 1 },
    { stage: 'PLANNED', businessType: 'OTHER', projectStatus: 'UNKNOWN', needsReview: true, count: 4 },
  ],
  items: [{ name: '샘플1구역', businessType: 'REDEVELOPMENT', stage: 'PROMOTION_COMMITTEE', projectStatus: 'ACTIVE', householdCount: 1200, primarySource: 'MOLIT', dataUpdatedAt: '2026-09-01T00:00:00.000Z' }],
  latestSourceUpdatedAt: '2026-08-15T00:00:00.000Z', latestCollectedAt: '2026-09-01T00:00:00.000Z', ...over,
});

test('재개발: 단계를 그룹으로 묶어 계획·인가·공사·완료·중단을 구분하고, 확인 필요 사업은 사실에서 빼 개수만 알린다', () => {
  const s = buildRedevelopmentSection(redevRows());
  assert.equal(s.status, 'HAS_DATA');
  assert.equal(s.summary.total, 7);
  assert.equal(s.summary.excludedNeedsReview, 4);
  const g = Object.fromEntries(s.summary.byStageGroup.map((x) => [x.group, x.count]));
  assert.deepEqual(g, { PLANNING: 3, CONSTRUCTION: 2, COMPLETED: 1, STOPPED: 1 });
  assert.equal(s.asOf, '2026-08-15T00:00:00.000Z');
  assert.equal(s.items[0].stageLabel.length > 0, true);
  assert.equal(s.items[0].stageGroup, 'PLANNING');
  assert.equal(STAGE_GROUP.PROJECT_IMPLEMENTATION_APPROVED, 'APPROVAL');
  assert.equal(s.granularity, 'SIGUNGU');
  assert.equal(s.coordinates, 'NOT_USED');
  assert.doesNotMatch(JSON.stringify(s), /latitude|longitude|lat|lng/);
  assert.ok(s.caveats.some((c) => c.includes('확정된 개발로 쓰지 않는다')));
  assert.ok(s.caveats.some((c) => c.includes('근처')));
});

test('재개발: 확정된 사업이 없으면 NO_DATA(확인 필요 사업만 있어도)', () => {
  const s = buildRedevelopmentSection(redevRows({ groups: [{ stage: 'PLANNED', businessType: 'OTHER', projectStatus: 'UNKNOWN', needsReview: true, count: 2 }], items: [] }));
  assert.equal(s.status, 'NO_DATA');
  assert.equal(s.summary.excludedNeedsReview, 2);
  assert.equal(buildRedevelopmentSection({ groups: [], items: [], latestSourceUpdatedAt: null, latestCollectedAt: null }).status, 'NO_DATA');
});

// ------------------------------------------------------------------ 분양
const presaleRows = (collected: string | null, over: Partial<PresaleRows> = {}): PresaleRows => ({
  total: 3,
  rows: [
    { houseName: '접수예정단지', houseType: 'APT', totalSupplyHouseholds: 300, announcementDate: '2026-10-20', receiptStartDate: '2026-11-03T00:00:00.000Z', receiptEndDate: '2026-11-05T00:00:00.000Z', moveInExpectedYm: '202811', minPrice: 50000, maxPrice: 80000, pblancUrl: 'https://www.applyhome.co.kr/x', locationAddress: '부산광역시 수영구 광안동 1' },
    { houseName: '접수중단지', houseType: 'APT', totalSupplyHouseholds: 120, announcementDate: '2026-10-15', receiptStartDate: '2026-10-24T00:00:00.000Z', receiptEndDate: '2026-10-27T00:00:00.000Z', moveInExpectedYm: '202712', minPrice: null, maxPrice: null, pblancUrl: 'http://insecure.example/x', locationAddress: null },
    { houseName: '지난단지', houseType: 'APT', totalSupplyHouseholds: 80, announcementDate: '2026-03-02', receiptStartDate: '2026-03-10T00:00:00.000Z', receiptEndDate: '2026-03-12T00:00:00.000Z', moveInExpectedYm: '202803', minPrice: 40000, maxPrice: 60000, pblancUrl: null, locationAddress: null },
  ],
  lastCollectedAt: collected, ...over,
});

test('분양: 공고 날짜로 접수 예정·접수 중·종료를 가르고, https가 아닌 출처 링크는 내지 않는다', () => {
  const s = buildPresaleSection(presaleRows('2026-10-24T00:00:00.000Z'), NOW);
  assert.deepEqual(s.items.map((i) => i.status), ['upcoming', 'ongoing', 'closed']);
  assert.equal(s.items[0].sourceUrl, 'https://www.applyhome.co.kr/x');
  assert.equal(s.items[1].sourceUrl, null);
  assert.equal(s.items[1].minPriceManwon, null);
  assert.equal(s.currentStatusStatable, true);
  assert.equal(s.summary.total, 3);
  assert.ok(s.caveats.some((c) => c.includes('우열을 판단하지 않는다')));
});

test('분양: 최근 수집이 아니면 현재 상태로 말하지 못하게 한다(자동 갱신이 보장되지 않음)', () => {
  const stale = buildPresaleSection(presaleRows('2026-09-01T00:00:00.000Z'), NOW);
  assert.equal(stale.currentStatusStatable, false);
  assert.ok(stale.caveats.some((c) => c.includes('지금의 상태로 쓰지 않는다')));
  assert.equal(buildPresaleSection(presaleRows(null), NOW).currentStatusStatable, false);
  const edge = new Date(NOW.getTime() - PRESALE_FRESH_DAYS * 86_400_000).toISOString();
  assert.equal(buildPresaleSection(presaleRows(edge), NOW).currentStatusStatable, true);
  assert.equal(buildPresaleSection(presaleRows('2026-10-24T00:00:00.000Z', { total: 0, rows: [] }), NOW).status, 'NO_DATA');
});

test('분양 상태 규칙은 이집의 computePresaleStatus와 같다(잔여세대는 unsold, 날짜 없음은 upcoming)', () => {
  assert.equal(presaleStatusAt({ houseType: 'REMAIN', receiptStartDate: null, receiptEndDate: null }, NOW), 'unsold');
  assert.equal(presaleStatusAt({ houseType: 'APT', receiptStartDate: null, receiptEndDate: null }, NOW), 'upcoming');
  assert.equal(presaleStatusAt({ houseType: 'APT', receiptStartDate: '2026-10-01T00:00:00Z', receiptEndDate: '2026-10-02T00:00:00Z' }, NOW), 'closed');
});

// ------------------------------------------------------------------ 지역 컨텍스트: 부분 성공·권한·지역
const okDb = (over: Partial<SellflowContextDb> = {}): SellflowContextDb => ({
  async getComplexAttributes() { return spec(); },
  async listRedevelopment() { return redevRows(); },
  async listPresales() { return presaleRows('2026-10-24T00:00:00.000Z'); },
  ...over,
});
const denied = () => Object.assign(new Error('Invalid `prisma.presale.count()` invocation: permission denied for table presales'), { code: 'P2010', meta: { code: '42501' } });

test('권한 없음(42501)은 자료 없음이나 조회 실패와 다른 값이고, 한 영역의 실패가 다른 영역을 지우지 않는다(부분 성공)', async () => {
  assert.equal(isAccessDenied(denied()), true);
  assert.equal(isAccessDenied(new Error('connection timeout')), false);
  const r = await getAreaContext('26500', ['redevelopment', 'presale'], okDb({ listPresales: async () => { throw denied(); } }), NOW);
  assert.equal(r.data.redevelopment.status, 'HAS_DATA');
  assert.equal(r.data.presale.status, 'ACCESS_DENIED');
  assert.equal((r.data.presale as { failureCode?: string }).failureCode, 'DATA_ACCESS_DENIED');
  const down = await getAreaContext('26500', ['redevelopment', 'presale'], okDb({ listRedevelopment: async () => { throw new Error('timeout'); } }), NOW);
  assert.equal(down.data.redevelopment.status, 'UNAVAILABLE');
  assert.equal(down.data.presale.status, 'HAS_DATA');
  const empty = await getAreaContext('26500', ['redevelopment'], okDb({ listRedevelopment: async () => ({ groups: [], items: [], latestSourceUpdatedAt: null, latestCollectedAt: null }) }), NOW);
  assert.equal(empty.data.redevelopment.status, 'NO_DATA');
  assert.equal(empty.data.presale.status, 'NOT_REQUESTED');
});

test('지역 컨텍스트: 시도는 전체 이름, 시군구는 이집 레지스트리의 이름으로 조회한다; 모르는 코드는 404, 구가 있는 시는 400', async () => {
  const calls: unknown[] = [];
  await getAreaContext('26500', ['redevelopment', 'presale'], okDb({
    listRedevelopment: async (i) => { calls.push(['redev', i]); return redevRows(); },
    listPresales: async (i) => { calls.push(['presale', i]); return presaleRows('2026-10-24T00:00:00.000Z'); },
  }), NOW);
  assert.deepEqual(calls, [['redev', { sido: '부산광역시', sigungu: '수영구', take: 10 }], ['presale', { sidoShort: '부산', addressPrefix: '부산광역시 수영구', take: 10 }]]);
  await assert.rejects(() => getAreaContext('99999', ['presale'], okDb(), NOW), (e: { status?: number; code?: string }) => e.status === 404 && e.code === 'REGION_NOT_FOUND');
  await assert.rejects(() => getAreaContext('41130', ['presale'], okDb(), NOW), (e: { status?: number }) => e.status === 400);
});

// ------------------------------------------------------------------ HTTP: 인증·파라미터·엔드포인트
function deps(over: Partial<SellflowHandlerDeps> = {}): SellflowHandlerDeps {
  const db = { async getMaster(p: { propertyType: string }) { return p.propertyType === 'apartment' ? apt : offi; } } as unknown as SellflowDb;
  return { auth: { apiKey: KEY, enabled: 'true', propertyTypes: undefined }, db, ctxDb: okDb(), educationZone: () => zone(), now: () => NOW, newRequestId: () => 'req-ctx-1', log: () => undefined, ...over };
}
async function call(route: SellflowRoute, query = '', d: SellflowHandlerDeps = deps(), auth: string | null = `Bearer ${KEY}`) {
  const headers: Record<string, string> = {};
  if (auth !== null) headers.authorization = auth;
  const res = await handleSellflowRequest(new Request(`https://e-jip.test/x${query}`, { headers }), route, d);
  return { res, body: (await res.json()) as any };
}

test('건물 컨텍스트 HTTP: 200 응답에 단지 속성·통학구역·withheld·출처가 있고 좌표·거리·시설 개수는 없다', async () => {
  const { res, body } = await call({ kind: 'buildingContext', masterId: 'apt-26500-1001' });
  assert.equal(res.status, 200);
  assert.equal(body.data.building.masterId, 'apt-26500-1001');
  assert.equal(body.data.complex.status, 'HAS_DATA');
  assert.equal(body.data.education.status, 'HAS_DATA');
  assert.equal(body.data.withheld.length, 5);
  assert.equal(body.data.sources.building.name, '건축물대장');
  assert.equal(body.data.sources.attendanceZone.provider, '한국교육시설안전원');
  assert.doesNotMatch(JSON.stringify(body), /latitude|longitude|distanceM|busStop|subway|convenience|mart/i);
});

test('오피스텔 건물 컨텍스트: 단지 속성과 통학구역은 NOT_COVERED(없는 값을 만들지 않음)', async () => {
  const { body } = await call({ kind: 'buildingContext', masterId: 'offi-11' });
  assert.equal(body.data.complex.status, 'NOT_COVERED');
  assert.equal(body.data.education.status, 'NOT_COVERED');
});

test('인증은 기존과 같다: 키 없음·틀린 키 401, 설정 꺼짐 503, 허용되지 않은 유형 403, 모르는 파라미터 400, 모르는 건물 404', async () => {
  for (const route of [{ kind: 'buildingContext', masterId: 'apt-26500-1001' }, { kind: 'areaContext', lawdCd: '26500' }] as SellflowRoute[]) {
    assert.equal((await call(route, '', deps(), null)).res.status, 401);
    assert.equal((await call(route, '', deps(), 'Bearer wrong')).res.status, 401);
    assert.equal((await call(route, '', deps({ auth: { apiKey: KEY, enabled: 'no', propertyTypes: undefined } }))).res.status, 503);
    assert.equal((await call(route, '?foo=1')).res.status, 400);
  }
  assert.equal((await call({ kind: 'buildingContext', masterId: 'apt-26500-1001' }, '', deps({ auth: { apiKey: KEY, enabled: 'true', propertyTypes: 'officetel' } }))).res.status, 403);
  const missing = deps({ db: { async getMaster() { return null; } } as unknown as SellflowDb });
  assert.equal((await call({ kind: 'buildingContext', masterId: 'apt-26500-9999' }, '', missing)).res.status, 404);
  assert.equal((await call({ kind: 'buildingContext', masterId: 'not-an-id' })).res.status, 400);
});

test('지역 컨텍스트 HTTP: include 선택, 잘못된 include·lawdCd는 400, 모르는 지역 404, ctxDb가 없으면 501(조용히 빈 값을 내지 않는다)', async () => {
  const both = await call({ kind: 'areaContext', lawdCd: '26500' });
  assert.equal(both.res.status, 200);
  assert.equal(both.body.data.redevelopment.status, 'HAS_DATA');
  assert.equal(both.body.data.presale.status, 'HAS_DATA');
  const only = await call({ kind: 'areaContext', lawdCd: '26500' }, '?include=presale');
  assert.equal(only.body.data.redevelopment.status, 'NOT_REQUESTED');
  assert.equal((await call({ kind: 'areaContext', lawdCd: '26500' }, '?include=schools')).res.status, 400);
  assert.equal((await call({ kind: 'areaContext', lawdCd: '2650' })).res.status, 400);
  assert.equal((await call({ kind: 'areaContext', lawdCd: '99999' })).res.status, 404);
  const none = await call({ kind: 'areaContext', lawdCd: '26500' }, '', deps({ ctxDb: undefined }));
  assert.equal(none.res.status, 501);
});

test('읽기 전용: 컨텍스트 구현 파일에 쓰기 호출이 없다', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['context.ts', 'prisma-context-db.ts']) {
    const text = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRawUnsafe/, f);
  }
});
