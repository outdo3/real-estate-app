/**
 * MAP MARKER UX V2 §40 — A파트(순수 함수 단위 검사 + 정적 가드, 서버 불필요) +
 * B파트(실행 중인 dev 서버 라이브 회귀 스모크).
 *
 * 사용법:
 *   npx tsx -r ./scripts/_register-paths.js scripts/run-map-marker-ux-v2-qa.ts [옵션]
 * 옵션:
 *   --skip-live   B파트 생략, A파트(단위 검사 + 정적 가드)만 실행.
 *   --json        tmp/qa/MAP_MARKER_UX_V2_QA.json로 저장.
 *   --base=<url>  기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import {
  formatCompactPriceManwon,
  formatMarkerAreaLabel,
  formatMarkerPriceAreaLine,
} from '@/lib/map-marker-format';
import {
  buildMapShareParams,
  parseMapStateFromSearchParams,
  matchRestoreIdentity,
} from '@/lib/map-marker-share';
import type { AptMarker } from '@/lib/map-selected-marker';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = { skipLive: flag('skip-live') !== null, json: flag('json') !== null, base: flag('base') || 'http://localhost:3000' };

interface Finding { severity: 'P0_DATA_TRUST' | 'P1_STRUCTURE' | 'INFO'; area: 'marker' | 'share' | 'common'; detail: string; }
const findings: Finding[] = [];
let passed = 0, failed = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${label}`); passed++; }
  catch (e: any) { console.error(`  FAIL  ${label}: ${e.message}`); failed++; findings.push({ severity: 'P0_DATA_TRUST', area: 'common', detail: `${label}: ${e.message}` }); }
}

function makeMarker(overrides: Partial<AptMarker>): AptMarker {
  return {
    id: 'test-id',
    name: '테스트단지',
    dong: '테스트동',
    price: '3억 8,700만',
    hasRecentPrice: true,
    dealAmount: 38700,
    pyeong: 34,
    areaM2: 84.79,
    lat: 35.1,
    lng: 129.0,
    ...overrides,
  };
}

console.log('=== A. UNIT TESTS: map-marker-format.ts (no server) ===');

// 1. compact price formatter — deterministic, 1억 이상 소수점 압축
check('1. formatCompactPriceManwon: 38700만 -> "3.87억"', () => {
  assert.strictEqual(formatCompactPriceManwon(38700), '3.87억');
});
check('1. formatCompactPriceManwon: 45000만 -> "4.5억"(불필요한 소수 0 제거)', () => {
  assert.strictEqual(formatCompactPriceManwon(45000), '4.5억');
});
check('1. formatCompactPriceManwon: 98000만 -> "9.8억"', () => {
  assert.strictEqual(formatCompactPriceManwon(98000), '9.8억');
});
check('1. formatCompactPriceManwon: 123000만 -> "12.3억"', () => {
  assert.strictEqual(formatCompactPriceManwon(123000), '12.3억');
});
check('1. formatCompactPriceManwon: 1억 미만은 그대로 "만" 단위 콤마 표기', () => {
  assert.strictEqual(formatCompactPriceManwon(9500), '9,500만');
});
check('1. formatCompactPriceManwon: 0/음수/null/NaN은 빈 문자열(값을 지어내지 않음)', () => {
  assert.strictEqual(formatCompactPriceManwon(0), '');
  assert.strictEqual(formatCompactPriceManwon(-100), '');
  assert.strictEqual(formatCompactPriceManwon(null), '');
  assert.strictEqual(formatCompactPriceManwon(NaN), '');
});
check('1. formatCompactPriceManwon: 같은 입력은 항상 같은 출력(deterministic)', () => {
  assert.strictEqual(formatCompactPriceManwon(67890), formatCompactPriceManwon(67890));
});

// 2. PYEONG TRUST CONTRACT — trustworthy pyeong 있으면 평, 없으면 raw ㎡, exclusiveArea/3.3058 계산 없음
check('2. formatMarkerAreaLabel: trustworthy pyeong이 있으면 "34평"', () => {
  assert.strictEqual(formatMarkerAreaLabel(34, 84.79), '34평');
});
check('2. formatMarkerAreaLabel: pyeong이 null이면 raw ㎡로 폴백("84㎡", 반올림)', () => {
  assert.strictEqual(formatMarkerAreaLabel(null, 84.43), '84㎡');
});
check('2. formatMarkerAreaLabel: pyeong/areaM2 둘 다 없으면 빈 문자열(지어내지 않음)', () => {
  assert.strictEqual(formatMarkerAreaLabel(null, null), '');
});
check('3. formatMarkerPriceAreaLine: price+area가 같은 거래에서 결합됨("34평 3.87억")', () => {
  assert.strictEqual(formatMarkerPriceAreaLine(38700, 34, 84.79), '34평 3.87억');
});
check('3. formatMarkerPriceAreaLine: pyeong 없으면 raw ㎡ 사용("84㎡ 3.87억")', () => {
  assert.strictEqual(formatMarkerPriceAreaLine(38700, null, 84.43), '84㎡ 3.87억');
});
check('3. formatMarkerPriceAreaLine: 가격이 없으면 빈 문자열(호출부가 기존 "시세 정보 없음"으로 폴백)', () => {
  assert.strictEqual(formatMarkerPriceAreaLine(null, 34, 84.79), '');
});

console.log('\n=== A. UNIT TESTS: map-marker-share.ts (no server) ===');

// 7. SHARE SELECTED IDENTITY PARAM — aptSeq 우선, 없으면 dong+name(name-only 금지)
check('7. buildMapShareParams: 선택 없으면 identity 파라미터 없음', () => {
  const params = buildMapShareParams({ lat: 35.1, lng: 129.0 }, 4, '26140', null);
  assert.strictEqual(params.aptSeq, undefined);
  assert.strictEqual(params.dong, undefined);
  assert.strictEqual(params.name, undefined);
  assert.strictEqual(params.lawdCd, '26140');
});
check('7. buildMapShareParams: aptSeq가 있으면 aptSeq만 싣는다(우선순위 1)', () => {
  const marker = makeMarker({ aptSeq: '26140-1361' });
  const params = buildMapShareParams({ lat: 35.1, lng: 129.0 }, 4, '26140', marker);
  assert.strictEqual(params.aptSeq, '26140-1361');
  assert.strictEqual(params.dong, undefined);
  assert.strictEqual(params.name, undefined);
});
check('7. buildMapShareParams: aptSeq가 없으면 dong+name(둘 다 함께, name-only 아님)', () => {
  const marker = makeMarker({ aptSeq: undefined, dong: '서대신동3가', name: '대신롯데캐슬' });
  const params = buildMapShareParams({ lat: 35.1, lng: 129.0 }, 4, '26140', marker);
  assert.strictEqual(params.aptSeq, undefined);
  assert.strictEqual(params.dong, '서대신동3가');
  assert.strictEqual(params.name, '대신롯데캐슬');
});

// URL 파싱
check('parseMapStateFromSearchParams: lat/lng 없으면 공유 링크 아님(null)', () => {
  const parsed = parseMapStateFromSearchParams(new URLSearchParams('zoom=4'));
  assert.strictEqual(parsed, null);
});
check('parseMapStateFromSearchParams: aptSeq가 있으면 restoreIdentity에 aptSeq만', () => {
  const parsed = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0&zoom=4&lawdCd=26140&aptSeq=26140-1361&dong=서대신동3가&name=대신롯데캐슬'));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed!.restoreIdentity, { aptSeq: '26140-1361' });
});
check('parseMapStateFromSearchParams: aptSeq 없고 dong+name만 있으면 그 조합', () => {
  const parsed = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0&dong=서대신동3가&name=대신롯데캐슬'));
  assert.ok(parsed);
  assert.deepStrictEqual(parsed!.restoreIdentity, { dong: '서대신동3가', name: '대신롯데캐슬' });
});
check('parseMapStateFromSearchParams: identity 파라미터가 전혀 없으면 restoreIdentity는 null', () => {
  const parsed = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0'));
  assert.ok(parsed);
  assert.strictEqual(parsed!.restoreIdentity, null);
});

// 8/9. SELECTED RESTORE + WRONG FALLBACK 방지
check('8. matchRestoreIdentity: aptSeq가 실제 fetch된 markers 안에 있으면 그 마커를 찾는다', () => {
  const markers = [makeMarker({ id: 'a', aptSeq: '26140-1361', name: '대신롯데캐슬' }), makeMarker({ id: 'b', aptSeq: '26140-9999', name: '다른단지' })];
  const found = matchRestoreIdentity({ aptSeq: '26140-1361' }, markers);
  assert.strictEqual(found?.id, 'a');
});
check('9. matchRestoreIdentity: 정확히 일치하는 게 없으면 다른 단지로 대체하지 않고 null', () => {
  const markers = [makeMarker({ id: 'a', aptSeq: '26140-1361', name: '대신롯데캐슬' })];
  const found = matchRestoreIdentity({ aptSeq: '26140-0000' }, markers);
  assert.strictEqual(found, null);
});
check('9. matchRestoreIdentity: dong+name도 둘 다 정확히 일치해야 한다(부분 일치로 다른 단지 선택 금지)', () => {
  const markers = [makeMarker({ id: 'a', aptSeq: undefined, dong: '서대신동3가', name: '대신롯데캐슬' })];
  const wrongDong = matchRestoreIdentity({ dong: '암남동', name: '대신롯데캐슬' }, markers);
  assert.strictEqual(wrongDong, null);
});
check('9. matchRestoreIdentity: identity가 null이면 항상 null', () => {
  const markers = [makeMarker({ id: 'a' })];
  assert.strictEqual(matchRestoreIdentity(null, markers), null);
});

console.log('\n--- 정적 가드 ---');

const REPO_ROOT = path.join(__dirname, '..');
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// 5. BLACK_SELECTED_OUTLINE — #1e293b 검은 강조가 map/page.tsx에서 완전히 제거됨
check('5. map/page.tsx에 검은 selected 강조(#1e293b)가 재도입되지 않음', () => {
  const code = stripComments(readSrc('src/app/map/page.tsx'));
  assert.ok(!code.includes('#1e293b'), 'map/page.tsx에 #1e293b(검은 선택 강조)가 남아있음');
});
// 6. SELECTED_MARKER_UX — 이집 Green fill이 selected 스타일로 쓰이고 있음
check('6. map/page.tsx의 renderMarkerChip이 selected 상태에 이집 Green(--ejip-green)을 사용', () => {
  const code = readSrc('src/app/map/page.tsx');
  const fnStart = code.indexOf('const renderMarkerChip');
  assert.ok(fnStart >= 0, 'renderMarkerChip을 찾을 수 없음');
  const fnBody = code.slice(fnStart, code.indexOf('\n  };', fnStart));
  assert.ok(fnBody.includes("selected ? 'var(--ejip-green)'"), 'selected 상태가 이집 Green fill을 쓰지 않음');
});
// 3. FAKE_PYEONG — exclusiveArea/3.3058류 계산이 지도 코드에 없음
check('3. map/page.tsx, map-marker-format.ts에 exclusiveArea/3.3058 같은 추정 평형 계산이 없음', () => {
  for (const rel of ['src/app/map/page.tsx', 'src/lib/map-marker-format.ts']) {
    const code = stripComments(readSrc(rel));
    assert.ok(!/3\.3058/.test(code), `${rel}에 3.3058 계산이 있음(가짜 평형 금지 위반)`);
  }
});
// 29. 취소 거래 필터링 — dealCanceled를 건너뛰는 코드가 fetchAptMarkers에 있음
check('취소(dealCanceled)된 거래는 대표 거래 후보에서 제외됨', () => {
  const code = readSrc('src/app/map/page.tsx');
  const fnStart = code.indexOf('const fetchAptMarkers');
  assert.ok(fnStart >= 0);
  const fnBody = code.slice(fnStart, code.indexOf('\n  };', fnStart));
  assert.ok(/item\.dealCanceled/.test(fnBody), 'fetchAptMarkers가 dealCanceled를 확인하지 않음');
});
// 10. NO PER-MARKER FETCH — renderMarkerChip 안에는 fetch(가 없어야 한다(마커 렌더마다 개별 호출 금지)
check('10. renderMarkerChip 안에 fetch() 호출이 없음(N+1 금지)', () => {
  const code = readSrc('src/app/map/page.tsx');
  const fnStart = code.indexOf('const renderMarkerChip');
  const fnEnd = code.indexOf('\n  };', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const fnBody = code.slice(fnStart, fnEnd);
  assert.ok(!/\bfetch\(/.test(fnBody), 'renderMarkerChip 안에서 fetch()를 호출함(마커별 개별 요청, N+1 위반)');
});

async function fetchStatus(base: string, urlPath: string) {
  try {
    const res = await fetch(`${base}${urlPath}`, { redirect: 'manual' });
    return { httpStatus: res.status };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function runLive() {
  console.log('\n=== B. LIVE REGRESSION (dev server) ===');
  for (const p of ['/map', '/stats', '/apt/' + encodeURIComponent('대신롯데캐슬')]) {
    const r = await fetchStatus(OPT.base, p);
    const status = 'httpStatus' in r ? (r.httpStatus ?? null) : null;
    const ok = status !== null && status < 500;
    console.log(`  [regression] ${p} -> ${ok ? 'OK' : 'FAIL'} (${status ?? (r as any).error})`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${p}` });
  }
}

async function main() {
  if (!OPT.skipLive) await runLive();
  else console.log('\n(--skip-live: B파트 생략)');

  console.log('\n=== FINDINGS ===');
  if (findings.length === 0) console.log('없음');
  for (const f of findings) console.log(`[${f.severity}] [${f.area}] ${f.detail}`);

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);

  if (OPT.json) {
    const outDir = path.join(process.cwd(), 'tmp', 'qa');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'MAP_MARKER_UX_V2_QA.json');
    fs.writeFileSync(outPath, JSON.stringify({ unitPassed: passed, unitFailed: failed, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const blocking = findings.filter((f) => f.severity === 'P0_DATA_TRUST');
  if (failed > 0 || blocking.length > 0) process.exitCode = 1;
}

main();
