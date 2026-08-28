/**
 * STATISTICS V2.1-3 — GAP INVESTMENT + JEONSE RISK §49. 두 부분으로 구성:
 *  A. 순수 함수 단위 검사(서버 불필요) — gap matching/temporal rule/collision/
 *     cancelled exclusion/fake pyeong 없음을 코드 레벨로 검증.
 *  B. 실행 중인 dev 서버 라이브 API를 read-only(GET)로 호출해 응답 구조·
 *     partial failure·unsafe copy·canonical navigation을 검사(DB 쓰기 없음).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-1-risk-gap-qa.ts [옵션]
 *
 * 옵션:
 *   --skip-live   B 파트(라이브 서버 호출) 생략 — A 파트(단위 검사)만 실행.
 *   --json        tmp/qa/STATISTICS_V2_1_RISK_GAP_QA.json로 저장.
 *   --base=<url>  기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { buildGapCandidates, buildGapTradeEvents, gapEventGroupKey, median, type GapTrade } from '@/lib/gap-invest-calc';
import { buildJeonseRiskRows, buildJeonseRiskInterpretation, type FeedTrade, type PeriodRange } from '@/lib/price-ranking';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = {
  skipLive: flag('skip-live') !== null,
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_DATA_TRUST' | 'P0_UNSAFE_COPY' | 'P1_PARTIAL' | 'P1_STRUCTURE' | 'INFO';
  area: 'gap' | 'jeonse-risk' | 'common';
  detail: string;
}
const findings: Finding[] = [];
let passed = 0;
let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (e: any) {
    console.error(`  FAIL  ${label}: ${e.message}`);
    failed++;
    findings.push({ severity: 'P0_DATA_TRUST', area: 'common', detail: `${label}: ${e.message}` });
  }
}

function gapTrade(overrides: Partial<GapTrade>): GapTrade {
  return {
    name: '테스트단지',
    dong: '테스트동',
    lawdCd: '26140',
    dealAmount: 50000,
    excluUseArea: 84.99,
    dealDate: '2026-08-01',
    dealCanceled: false,
    monthlyRent: 0,
    aptSeq: 'TEST-1',
    ...overrides,
  };
}

console.log('=== A. UNIT TESTS (no server) ===');

// ── §34 SALE/JEONSE MATCHING QA ──
console.log('--- §34-A same apt + same area, sale/jeonse within window -> gap event ---');
check('같은 단지 + 같은 정확한 전용면적 + 90일 이내 -> 이벤트 생성, gap=2억', () => {
  const sales = [gapTrade({ dealAmount: 80000, dealDate: '2026-08-01' })];
  const rents = [gapTrade({ dealAmount: 60000, dealDate: '2026-07-20' })];
  const events = buildGapTradeEvents(sales, rents);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].gap, 20000);
  assert.ok(events[0].dayGap <= 90);
});

console.log('--- §34-B same apt + other raw area jeonse -> no match ---');
check('전용면적이 다르면(84.99 vs 59.99) 매칭 금지', () => {
  const sales = [gapTrade({ excluUseArea: 84.99 })];
  const rents = [gapTrade({ excluUseArea: 59.99 })];
  assert.strictEqual(buildGapTradeEvents(sales, rents).length, 0);
});

console.log('--- §34-C same name different city -> no match ---');
check('같은 이름·같은 면적이라도 aptSeq가 다르면(다른 도시/단지) 매칭 금지', () => {
  const sales = [gapTrade({ aptSeq: 'BUSAN-1', lawdCd: '26140' })];
  const rents = [gapTrade({ aptSeq: 'SEOUL-1', lawdCd: '11680' })];
  assert.strictEqual(buildGapTradeEvents(sales, rents).length, 0);
});

console.log('--- §34-D cancelled jeonse/sale -> exclude ---');
check('취소된 매매 거래는 이벤트 후보에서 제외됨', () => {
  const sales = [gapTrade({ dealCanceled: true })];
  const rents = [gapTrade({})];
  assert.strictEqual(buildGapTradeEvents(sales, rents).length, 0);
});
check('취소된 전세 거래는 매칭 후보에서 제외됨(indexByComplexAndArea가 이미 취소 제외)', () => {
  const sales = [gapTrade({ dealDate: '2026-08-01' })];
  const rents = [gapTrade({ dealDate: '2026-07-25', dealCanceled: true })];
  assert.strictEqual(buildGapTradeEvents(sales, rents).length, 0);
});

console.log('--- §34-E unsafe temporal match (>90일) -> no match ---');
check('매매·전세 시차가 90일을 넘으면 매칭하지 않음', () => {
  const sales = [gapTrade({ dealDate: '2026-08-01' })];
  const rents = [gapTrade({ dealDate: '2026-01-01' })]; // 200+일 차이
  assert.strictEqual(buildGapTradeEvents(sales, rents).length, 0);
});
check('90일 이내 여러 전세 후보 중 시점이 가장 가까운 것을 고름', () => {
  const sales = [gapTrade({ dealDate: '2026-08-01' })];
  const rents = [
    gapTrade({ dealDate: '2026-05-01' }), // ~92일, window 밖일 수 있음
    gapTrade({ dealDate: '2026-07-15' }), // ~17일, 더 가까움
  ];
  const events = buildGapTradeEvents(sales, rents);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].jeonseDate, '2026-07-15');
});

console.log('--- §33 AREA COLLISION (대신롯데캐슬 fixture) ---');
check('84.7855㎡와 84.9950㎡는 절대 병합되지 않음(각자 짝이 있을 때만 별도 이벤트)', () => {
  const sales = [
    gapTrade({ excluUseArea: 84.7855, dealAmount: 70000, aptSeq: 'DS-1' }),
    gapTrade({ excluUseArea: 84.995, dealAmount: 75000, aptSeq: 'DS-1' }),
  ];
  const rents = [gapTrade({ excluUseArea: 84.7855, dealAmount: 40000, aptSeq: 'DS-1' })]; // 84.995 쪽은 전세 없음
  const events = buildGapTradeEvents(sales, rents);
  assert.strictEqual(events.length, 1, '84.995 매매는 짝이 없으니 이벤트가 되면 안 됨');
  assert.strictEqual(events[0].exclusiveAreaM2, 84.7855);
});
check('gapEventGroupKey는 exact raw area를 키에 포함해 84.7855/84.9950을 분리한다', () => {
  const base = { name: '대신롯데캐슬', dong: '서대신동3가', lawdCd: '26140', aptSeq: 'DS-1', saleDate: '2026-08-01', saleAmount: 70000, jeonseDate: '2026-07-20', jeonseAmount: 40000, dayGap: 12, gap: 30000 };
  const k1 = gapEventGroupKey({ ...base, exclusiveAreaM2: 84.7855 });
  const k2 = gapEventGroupKey({ ...base, exclusiveAreaM2: 84.995 });
  assert.notStrictEqual(k1, k2);
});

console.log('--- gap temporal window default(90일) 문서화 확인 ---');
check('buildGapCandidates도 동일 window guard(90일)를 쓴다(대표 후보 표시용, §5 재확인)', () => {
  const sales = [gapTrade({ dealDate: '2026-08-01' })];
  const rents = [gapTrade({ dealDate: '2025-01-01' })];
  assert.strictEqual(buildGapCandidates(sales, rents).length, 0);
});

console.log('--- median() outlier 저항성 ---');
check('중앙값은 극단값 하나의 영향을 받지 않는다', () => {
  assert.strictEqual(median([10000, 11000, 12000, 900000]), 11500);
  assert.strictEqual(median([]), null);
});

// ── §35 JEONSE COMPARISON QA ──
console.log('--- §35-A/B jeonse decline chronology(직전 거래 대비) ---');
function feedTrade(overrides: Partial<FeedTrade>): FeedTrade {
  return {
    uid: Math.random().toString(36),
    aptSeq: 'JR-1',
    name: '테스트전세단지',
    dong: '테스트동',
    lawdCd: '26140',
    dealType: 'jeonse',
    dealAmount: 40000,
    excluUseArea: 84.99,
    floorRaw: 5,
    dealDate: '2026-08-01',
    dealCanceled: false,
    ...overrides,
  };
}
const period30d: PeriodRange = { from: '2026-07-01', to: '2026-08-31' };
check('직전 4억 -> 최근 3.5억: 하락 -0.5억 row 생성', () => {
  const trades = [
    feedTrade({ dealAmount: 40000, dealDate: '2026-06-01' }),
    feedTrade({ dealAmount: 35000, dealDate: '2026-08-01' }),
  ];
  const rows = buildJeonseRiskRows(trades, period30d);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].declineAmount, -5000);
  assert.strictEqual(rows[0].previousAmount, 40000);
});
check('직전 3.5억 -> 최근 4억(상승): 위험 row 아님', () => {
  const trades = [
    feedTrade({ dealAmount: 35000, dealDate: '2026-06-01' }),
    feedTrade({ dealAmount: 40000, dealDate: '2026-08-01' }),
  ];
  assert.strictEqual(buildJeonseRiskRows(trades, period30d).length, 0);
});
check('§35-C 다른 raw area는 별도 그룹 — 섞이지 않음(84.7855 vs 84.9950)', () => {
  const trades = [
    feedTrade({ excluUseArea: 84.7855, dealAmount: 40000, dealDate: '2026-06-01' }),
    feedTrade({ excluUseArea: 84.7855, dealAmount: 35000, dealDate: '2026-08-01' }),
    feedTrade({ excluUseArea: 84.995, dealAmount: 50000, dealDate: '2026-08-05' }), // 짝이 없어 위험 row 아님(직전 거래 없음)
  ];
  const rows = buildJeonseRiskRows(trades, period30d);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].excluUseArea, 84.7855);
});
check('§35-D 취소된 직전 거래는 비교 대상에서 제외(annotateTrades와 동일 filterVerifiedTrades 재사용)', () => {
  const trades = [
    feedTrade({ dealAmount: 40000, dealDate: '2026-06-01', dealCanceled: true }),
    feedTrade({ dealAmount: 35000, dealDate: '2026-08-01' }),
  ];
  // 취소된 직전 거래가 제외되면 비교 대상(immediatePrior) 자체가 없어 위험 row가 안 됨.
  assert.strictEqual(buildJeonseRiskRows(trades, period30d).length, 0);
});
check('§35-E 미래 거래 leakage 없음 — period 밖(미래) 거래가 비교에 끼어들지 않음', () => {
  const trades = [
    feedTrade({ dealAmount: 40000, dealDate: '2026-08-01' }),
    feedTrade({ dealAmount: 20000, dealDate: '2026-09-15' }), // period(7/1~8/31) 밖 미래 거래
  ];
  const rows = buildJeonseRiskRows(trades, period30d);
  // period 안에서 candidate로 뽑히는 건 8/1 거래뿐이고, 그 이전 직전 거래가 없어 위험 row 아님.
  assert.strictEqual(rows.length, 0);
});

console.log('--- §36 DATA CLAIM STATIC GUARD (interpretation 문구) ---');
const FORBIDDEN_PHRASES = ['역전세 확정', '보증금 미반환', '안전한 갭투자', '투자 유망', '인기 투자지역', '위험한 집주인', '보증금 사고 위험', '투자하기 좋아요', '소액 투자 가능', '수익률 높음', '매수 기회'];
check('buildJeonseRiskInterpretation은 금지 문구를 절대 포함하지 않음(경미/심각 두 분기 모두)', () => {
  const mild = buildJeonseRiskInterpretation({ declinePct: -5 });
  const severe = buildJeonseRiskInterpretation({ declinePct: -25 });
  for (const phrase of [mild, severe]) {
    for (const forbidden of FORBIDDEN_PHRASES) {
      assert.ok(!phrase.includes(forbidden), `금지 문구 "${forbidden}"가 포함됨: "${phrase}"`);
    }
  }
});

console.log(`\nA파트: ${passed} passed, ${failed} failed.\n`);

async function fetchJson(base: string, urlPath: string, params: Record<string, string>, timeoutMs = 200000): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${base}${urlPath}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
    return res.json();
  } catch (e) {
    return { status: 'FETCH_ERROR', error: String(e) };
  }
}

const DISTRICTS = [
  { lawdCd: '26140', label: '부산 서구' },
  { lawdCd: '26470', label: '부산 연제구' },
];
const SIDOS = [
  { code: '26', label: '부산 전체' },
  { code: '11', label: '서울 전체' },
];

function scanForForbiddenCopy(obj: any, area: 'gap' | 'jeonse-risk', label: string) {
  const text = JSON.stringify(obj);
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) {
      findings.push({ severity: 'P0_UNSAFE_COPY', area, detail: `${label}: 응답에 금지 문구 "${phrase}" 포함` });
    }
  }
}

async function runLive() {
  console.log('=== B. LIVE API CHECKS ===');

  // ── GAP INVEST ──
  for (const d of DISTRICTS) {
    const data = await fetchJson(OPT.base, '/api/stats/gap-invest', { lawdCd: d.lawdCd, period: '3m' });
    if (data.status !== 'OK') {
      findings.push({ severity: 'P1_STRUCTURE', area: 'gap', detail: `gap-invest(${d.label}) status=${data.status}` });
      continue;
    }
    console.log(`  [gap-invest] ${d.label}: scope=${data.scope} totalSale=${data.summary.totalSaleCount} gapEvents=${data.summary.gapEventCount} apt#=${data.apartmentRanking.length}`);
    scanForForbiddenCopy(data, 'gap', `gap-invest ${d.label}`);
    for (const r of data.apartmentRanking) {
      if (!r.lawdCd) findings.push({ severity: 'P1_STRUCTURE', area: 'gap', detail: `${d.label} 단지랭킹 lawdCd 누락(canonical navigation 불가): ${r.name}` });
      if (typeof r.pyung === 'number' && (r.pyung <= 0 || r.pyung > 200)) {
        findings.push({ severity: 'P0_DATA_TRUST', area: 'gap', detail: `${d.label} 비정상 pyung 값: ${r.name} pyung=${r.pyung}` });
      }
    }
    if (data.partial && data.failedDistricts.length === 0) {
      findings.push({ severity: 'P1_PARTIAL', area: 'gap', detail: `${d.label}: partial=true인데 failedDistricts가 비어있음(모순)` });
    }
  }

  for (const s of SIDOS) {
    const data = await fetchJson(OPT.base, '/api/stats/gap-invest', { sidoCode: s.code, period: '3m' });
    if (data.status !== 'OK') {
      findings.push({ severity: 'P1_STRUCTURE', area: 'gap', detail: `gap-invest(${s.label}) status=${data.status}` });
      continue;
    }
    console.log(`  [gap-invest] ${s.label}: scope=${data.scope} regionRanking#=${data.regionRanking.length} partial=${data.partial} failedDistricts=${data.failedDistricts.length}`);
    if (data.scope !== 'sido') findings.push({ severity: 'P1_STRUCTURE', area: 'gap', detail: `${s.label}: sidoCode 조회인데 scope=${data.scope}` });
    scanForForbiddenCopy(data, 'gap', `gap-invest ${s.label}`);
    // §7/§37 — 부분 실패를 0건으로 위장하지 않는지: partial=true인데 regionRanking이
    // 완전히 비어있고 요약도 0이면(진짜 0건인지 실패인지 구분 불가) 의심 신호로 기록.
    if (data.partial && data.summary.totalSaleCount === 0 && data.regionRanking.length === 0 && !data.apiError) {
      findings.push({ severity: 'P1_PARTIAL', area: 'gap', detail: `${s.label}: partial=true + 0건인데 apiError=false — 실패/무데이터 구분 애매` });
    }
  }

  // ── JEONSE RISK (price-rankings mode=jeonse-risk) ──
  for (const d of DISTRICTS) {
    const data = await fetchJson(OPT.base, '/api/stats/price-rankings', { mode: 'jeonse-risk', lawdCd: d.lawdCd, period: '3m', limit: '50' });
    if (data.status !== 'OK') {
      findings.push({ severity: 'P1_STRUCTURE', area: 'jeonse-risk', detail: `jeonse-risk(${d.label}) status=${data.status}` });
      continue;
    }
    console.log(`  [jeonse-risk] ${d.label}: rows=${data.rows.length} total=${data.pagination.total} historicalHighCoverageLabel=${data.historicalHighCoverageLabel}`);
    scanForForbiddenCopy(data, 'jeonse-risk', `jeonse-risk ${d.label}`);
    if (data.historicalHighCoverageLabel !== null) {
      findings.push({ severity: 'P1_STRUCTURE', area: 'jeonse-risk', detail: `${d.label}: historicalHighCoverageLabel이 null이 아님(jeonse-risk는 최고가 비교가 아니라 직전거래 비교라 null이어야 함)` });
    }
    for (const r of data.rows) {
      if (r.declineAmount != null && r.declineAmount >= 0) {
        findings.push({ severity: 'P0_DATA_TRUST', area: 'jeonse-risk', detail: `${d.label}: 하락 row인데 declineAmount>=0: ${r.name} ${r.declineAmount}` });
      }
      if (!r.lawdCd) findings.push({ severity: 'P1_STRUCTURE', area: 'jeonse-risk', detail: `${d.label}: lawdCd 누락(canonical navigation 불가): ${r.name}` });
    }
  }

  for (const s of SIDOS) {
    const data = await fetchJson(OPT.base, '/api/stats/price-rankings', { mode: 'jeonse-risk', sidoCode: s.code, period: '3m', limit: '50' });
    if (data.status !== 'OK') {
      findings.push({ severity: 'P1_STRUCTURE', area: 'jeonse-risk', detail: `jeonse-risk(${s.label}) status=${data.status}` });
      continue;
    }
    console.log(`  [jeonse-risk] ${s.label}: rows=${data.rows.length} total=${data.pagination.total} partial=${data.partial}`);
    scanForForbiddenCopy(data, 'jeonse-risk', `jeonse-risk ${s.label}`);
  }

  // ── REGRESSION: 하락/2년최고가/상승/실거래/거래량/거래집중 구조 확인 ──
  console.log('=== REGRESSION SMOKE ===');
  const regressionChecks: Array<{ path: string; params: Record<string, string> }> = [
    { path: '/api/stats/price-rankings', params: { mode: 'decline', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/price-rankings', params: { mode: 'record-high', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/price-rankings', params: { mode: 'rising', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/feed', params: { lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/dashboard', params: { lawdCd: '26140' } },
    { path: '/api/stats/concentration', params: { lawdCd: '26140', period: '30d' } },
  ];
  for (const rc of regressionChecks) {
    const data = await fetchJson(OPT.base, rc.path, rc.params);
    const ok = data.status === 'OK' || data.success === true;
    console.log(`  [regression] ${rc.path} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${rc.path} ${JSON.stringify(data).slice(0, 150)}` });
  }
}

async function main() {
  if (!OPT.skipLive) {
    await runLive();
  } else {
    console.log('(--skip-live: B파트 생략)');
  }

  console.log('\n=== FINDINGS ===');
  if (findings.length === 0) console.log('없음');
  for (const f of findings) console.log(`[${f.severity}] [${f.area}] ${f.detail}`);

  if (OPT.json) {
    const outDir = path.join(process.cwd(), 'tmp', 'qa');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'STATISTICS_V2_1_RISK_GAP_QA.json');
    fs.writeFileSync(outPath, JSON.stringify({ unitPassed: passed, unitFailed: failed, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const blocking = findings.filter((f) => f.severity === 'P0_DATA_TRUST' || f.severity === 'P0_UNSAFE_COPY');
  if (failed > 0 || blocking.length > 0) process.exitCode = 1;
}

main();
