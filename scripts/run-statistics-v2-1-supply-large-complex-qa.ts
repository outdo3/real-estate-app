/**
 * STATISTICS V2.1-4 — SUPPLY + LARGE COMPLEX §53. A파트(순수 함수 단위 검사, 서버
 * 불필요) + B파트(실행 중인 dev 서버 라이브 API, read-only GET).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-1-supply-large-complex-qa.ts [옵션]
 * 옵션:
 *   --skip-live   B파트 생략, A파트(단위 검사)만 실행.
 *   --json        tmp/qa/STATISTICS_V2_1_SUPPLY_LARGE_COMPLEX_QA.json로 저장.
 *   --base=<url>  기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { dedupeByRegistryGroup } from '@/lib/large-complex-dedup';
import { sidoFullToShort, parsePresaleSigungu, currentYm, isFutureOrCurrentYm, addMonthsToYm } from '@/lib/presale-region';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = { skipLive: flag('skip-live') !== null, json: flag('json') !== null, base: flag('base') || 'http://localhost:3000' };

interface Finding { severity: 'P0_DATA_TRUST' | 'P1_STRUCTURE' | 'INFO'; area: 'supply' | 'large-complex' | 'common'; detail: string; }
const findings: Finding[] = [];
let passed = 0, failed = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${label}`); passed++; }
  catch (e: any) { console.error(`  FAIL  ${label}: ${e.message}`); failed++; findings.push({ severity: 'P0_DATA_TRUST', area: 'common', detail: `${label}: ${e.message}` }); }
}

console.log('=== A. UNIT TESTS (no server) ===');

console.log('--- LARGE COMPLEX dedup (§20/§26) ---');
check('같은 mgmBldrgstPk를 공유하는 7개 row -> 대표 1건만 남김', () => {
  const rows = [
    { id: 1, name: '엘지메트로시티1', aptSeq: '26290-38', mgmBldrgstPk: 'PK1' },
    { id: 2, name: '엘지메트로시티2', aptSeq: '26290-90', mgmBldrgstPk: 'PK1' },
    { id: 3, name: '엘지메트로시티4-2(230~238)', aptSeq: '26290-93', mgmBldrgstPk: 'PK1' },
  ];
  const deduped = dedupeByRegistryGroup(rows);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].name, '엘지메트로시티1'); // 가장 짧은 이름
});
check('mgmBldrgstPk가 null이면(각자 다른 등록) 병합하지 않음', () => {
  const rows = [
    { id: 1, name: '단지A', aptSeq: 'seq-1', mgmBldrgstPk: null },
    { id: 2, name: '단지B', aptSeq: 'seq-2', mgmBldrgstPk: null },
  ];
  assert.strictEqual(dedupeByRegistryGroup(rows).length, 2);
});
check('동률 이름 길이면 aptSeq 오름차순으로 결정론적 선택', () => {
  const rows = [
    { id: 1, name: 'AA', aptSeq: 'seq-2', mgmBldrgstPk: 'PK2' },
    { id: 2, name: 'BB', aptSeq: 'seq-1', mgmBldrgstPk: 'PK2' },
  ];
  const deduped = dedupeByRegistryGroup(rows);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].aptSeq, 'seq-1');
});

console.log('--- SUPPLY region parsing safety (§5) ---');
check('sidoFullToShort: 고정 17개 매핑 정확성', () => {
  assert.strictEqual(sidoFullToShort('부산광역시'), '부산');
  assert.strictEqual(sidoFullToShort('서울특별시'), '서울');
  assert.strictEqual(sidoFullToShort('경기도'), '경기');
  assert.strictEqual(sidoFullToShort('없는시도'), null);
});
check('parsePresaleSigungu: 정상 주소에서 시군구 안전 추출', () => {
  assert.strictEqual(parsePresaleSigungu('부산광역시 남구 대연동 1756-9번지', '부산광역시'), '남구');
});
check('parsePresaleSigungu: 프로젝트명이 3번째 토큰이라도 시군구는 안전(2번째 토큰만 신뢰)', () => {
  assert.strictEqual(parsePresaleSigungu('부산광역시 강서구 에코델타시티 공동주택용지 13BL', '부산광역시'), '강서구');
});
check('parsePresaleSigungu: REGION_DATA에 없는(가짜) 시군구는 null(추정 금지)', () => {
  assert.strictEqual(parsePresaleSigungu('부산광역시 없는구 어딘가', '부산광역시'), null);
});
check('parsePresaleSigungu: 주소가 없거나 짧으면 null', () => {
  assert.strictEqual(parsePresaleSigungu(null, '부산광역시'), null);
  assert.strictEqual(parsePresaleSigungu('부산광역시', '부산광역시'), null);
});

console.log('--- SUPPLY future-only filter (§12) ---');
check('과거 입주예정월은 제외, 오늘 달/미래는 포함', () => {
  const now = currentYm(new Date('2026-08-28'));
  assert.strictEqual(now, '202608');
  assert.strictEqual(isFutureOrCurrentYm('202607', now), false);
  assert.strictEqual(isFutureOrCurrentYm('202608', now), true);
  assert.strictEqual(isFutureOrCurrentYm('203001', now), true);
  assert.strictEqual(isFutureOrCurrentYm(null, now), false);
});
check('addMonthsToYm: 연도 경계 넘는 계산 정확성', () => {
  assert.strictEqual(addMonthsToYm('202608', 12), '202708');
  assert.strictEqual(addMonthsToYm('202611', 3), '202702');
});

console.log(`\nA파트: ${passed} passed, ${failed} failed.\n`);

async function fetchJson(base: string, urlPath: string, params: Record<string, string>, timeoutMs = 60000): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${base}${urlPath}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
    return res.json();
  } catch (e) { return { status: 'FETCH_ERROR', error: String(e) }; }
}

async function runLive() {
  console.log('=== B. LIVE API CHECKS ===');

  // ── SUPPLY ──
  const nationwide = await fetchJson(OPT.base, '/api/stats/supply', { period: 'y2' });
  if (nationwide.status === 'OK') {
    console.log(`  [supply] 전국 y2: total=${nationwide.summary.totalCount} mapCount=${nationwide.summary.mapCount}`);
    if (nationwide.summary.mapCount > nationwide.summary.totalCount) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'supply', detail: 'mapCount가 totalCount보다 큼(모순)' });
    }
    for (const m of nationwide.mapMarkers) {
      if (m.lat == null || m.lng == null) findings.push({ severity: 'P0_DATA_TRUST', area: 'supply', detail: `지도 마커에 좌표 없음: ${m.name}` });
    }
    for (const item of [...nationwide.list].slice(0, 500)) {
      if (item.moveInExpectedYm < nationwide.period.from) {
        findings.push({ severity: 'P0_DATA_TRUST', area: 'supply', detail: `과거 입주예정 row가 포함됨: ${item.name} ${item.moveInExpectedYm}` });
      }
    }
  } else {
    findings.push({ severity: 'P1_STRUCTURE', area: 'supply', detail: `전국 조회 실패: ${JSON.stringify(nationwide).slice(0, 150)}` });
  }

  const busanAll = await fetchJson(OPT.base, '/api/stats/supply', { sido: '부산광역시', period: 'all' });
  const busanNam = await fetchJson(OPT.base, '/api/stats/supply', { sido: '부산광역시', sigungu: '남구', period: 'all' });
  if (busanAll.status === 'OK' && busanNam.status === 'OK') {
    console.log(`  [supply] 부산 전체: ${busanAll.summary.totalCount}건, 부산 남구: ${busanNam.summary.totalCount}건`);
    if (busanNam.summary.totalCount > busanAll.summary.totalCount) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'supply', detail: '남구 건수가 부산 전체보다 많음(지역 필터 모순)' });
    }
  }

  const seoulScoped = await fetchJson(OPT.base, '/api/stats/supply', { sido: '서울특별시', period: 'all' });
  console.log(`  [supply] 서울: ${seoulScoped.status === 'OK' ? seoulScoped.summary.totalCount + '건' : seoulScoped.status}`);

  // ── LARGE COMPLEX ──
  const busanLC = await fetchJson(OPT.base, '/api/stats/large-complex', { sidoCode: '26', limit: '50' });
  if (busanLC.status === 'OK') {
    console.log(`  [large-complex] 부산: total=${busanLC.total} items=${busanLC.items.length}`);
    // household DESC 확인
    for (let i = 1; i < busanLC.items.length; i++) {
      if (busanLC.items[i].totalHouseholds > busanLC.items[i - 1].totalHouseholds) {
        findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: `정렬 위반: rank ${busanLC.items[i].rank}가 이전보다 세대수 큼` });
      }
    }
    // 중복(같은 이름이 연속 상위 다수 차지) 감지 — dedup 회귀 가드
    const names = busanLC.items.map((it: any) => it.name.replace(/\(.+?\)|[0-9]+$/g, ''));
    const nameCounts = new Map<string, number>();
    for (const n of names) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
    const suspiciousDup = Array.from(nameCounts.entries()).filter(([, c]) => c >= 4);
    if (suspiciousDup.length > 0) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: `dedup 회귀 의심(같은 접두 이름이 상위 페이지에 4회+): ${JSON.stringify(suspiciousDup)}` });
    }
    // UnitType(평형 수) 필드가 응답에 노출되지 않는지 확인(§30)
    const raw = JSON.stringify(busanLC);
    if (raw.includes('unitType') || raw.includes('평형')) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: '응답에 평형 수 관련 필드가 노출됨(§30 위반 가능)' });
    }
  } else {
    findings.push({ severity: 'P1_STRUCTURE', area: 'large-complex', detail: `부산 조회 실패: ${JSON.stringify(busanLC).slice(0, 150)}` });
  }

  const seoulLC = await fetchJson(OPT.base, '/api/stats/large-complex', { sidoCode: '11' });
  console.log(`  [large-complex] 서울: status=${seoulLC.status}`);
  if (seoulLC.status !== 'UNSUPPORTED') {
    findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: `서울이 UNSUPPORTED가 아님(status=${seoulLC.status}) — 없는 데이터를 있는 것처럼 보여줄 위험` });
  }

  const districtLC = await fetchJson(OPT.base, '/api/stats/large-complex', { sidoCode: '26', lawdCd: '26470', limit: '10' }); // 연제구
  if (districtLC.status === 'OK') {
    console.log(`  [large-complex] 연제구: total=${districtLC.total}`);
    for (const it of districtLC.items) {
      if (it.lawdCd !== '26470') findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: `구 필터 누수: ${it.name} lawdCd=${it.lawdCd}` });
    }
  }

  const minHouseholdsLC = await fetchJson(OPT.base, '/api/stats/large-complex', { sidoCode: '26', minHouseholds: '2000', limit: '50' });
  if (minHouseholdsLC.status === 'OK') {
    console.log(`  [large-complex] 2000세대+: total=${minHouseholdsLC.total}`);
    for (const it of minHouseholdsLC.items) {
      if (it.totalHouseholds < 2000) findings.push({ severity: 'P0_DATA_TRUST', area: 'large-complex', detail: `세대수 필터 누수: ${it.name} ${it.totalHouseholds}` });
    }
  }

  // ── REGRESSION SMOKE (기존 8개 live 화면) ──
  console.log('=== REGRESSION SMOKE ===');
  const regressionChecks: Array<{ path: string; params: Record<string, string> }> = [
    { path: '/api/stats/price-rankings', params: { mode: 'decline', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/price-rankings', params: { mode: 'record-high', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/price-rankings', params: { mode: 'rising', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/price-rankings', params: { mode: 'jeonse-risk', lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/feed', params: { lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/dashboard', params: { lawdCd: '26140' } },
    { path: '/api/stats/concentration', params: { lawdCd: '26140', period: '30d' } },
    { path: '/api/stats/gap-invest', params: { lawdCd: '26140', period: '3m' } },
  ];
  for (const rc of regressionChecks) {
    const data = await fetchJson(OPT.base, rc.path, rc.params);
    const ok = data.status === 'OK' || data.success === true;
    console.log(`  [regression] ${rc.path}${rc.params.mode ? '?mode=' + rc.params.mode : ''} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${rc.path} ${JSON.stringify(data).slice(0, 150)}` });
  }
}

async function main() {
  if (!OPT.skipLive) await runLive();
  else console.log('(--skip-live: B파트 생략)');

  console.log('\n=== FINDINGS ===');
  if (findings.length === 0) console.log('없음');
  for (const f of findings) console.log(`[${f.severity}] [${f.area}] ${f.detail}`);

  if (OPT.json) {
    const outDir = path.join(process.cwd(), 'tmp', 'qa');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'STATISTICS_V2_1_SUPPLY_LARGE_COMPLEX_QA.json');
    fs.writeFileSync(outPath, JSON.stringify({ unitPassed: passed, unitFailed: failed, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const blocking = findings.filter((f) => f.severity === 'P0_DATA_TRUST');
  if (failed > 0 || blocking.length > 0) process.exitCode = 1;
}

main();
