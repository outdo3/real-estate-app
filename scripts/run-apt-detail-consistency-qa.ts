/**
 * APT DETAIL CONSISTENCY HOTFIX V1 §27 — A파트(순수 함수 단위 검사 + 정적 가드,
 * 서버 불필요) + B파트(실행 중인 dev 서버 라이브 검증, read-only GET + 회귀 스모크).
 *
 * 사용법:
 *   npx tsx --tsconfig tsconfig.json -r ./scripts/_register-paths.js scripts/run-apt-detail-consistency-qa.ts [옵션]
 * 옵션:
 *   --skip-live   B파트 생략, A파트(단위 검사 + 정적 가드)만 실행.
 *   --json        tmp/qa/APT_DETAIL_CONSISTENCY_QA.json로 저장.
 *   --base=<url>  기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import {
  resolveAreaChipDisplay,
  PYEONG_UNAVAILABLE_LABEL,
  type AreaChipDisplayUnit,
} from '@/lib/area-utils';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = { skipLive: flag('skip-live') !== null, json: flag('json') !== null, base: flag('base') || 'http://localhost:3000' };

interface Finding { severity: 'P0_DATA_TRUST' | 'P1_STRUCTURE' | 'INFO'; area: 'area-toggle' | 'sticky-bar' | 'common'; detail: string; }
const findings: Finding[] = [];
let passed = 0, failed = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${label}`); passed++; }
  catch (e: any) { console.error(`  FAIL  ${label}: ${e.message}`); failed++; findings.push({ severity: 'P0_DATA_TRUST', area: 'common', detail: `${label}: ${e.message}` }); }
}

console.log('=== A. UNIT TESTS: resolveAreaChipDisplay (no server) ===');

// CASE A — trustworthy pyeong 있음 (예: 대신롯데캐슬)
check('CASE A: pyeong 있음 -> N평 표시, 충돌 아니면 보조 라벨 없음', () => {
  const unit: AreaChipDisplayUnit = { displayExclusiveArea: '84.79', representativePyeong: 34 };
  const r = resolveAreaChipDisplay(unit, '평', false, '전용 84.79㎡');
  assert.strictEqual(r.displayLabel, '34평');
  assert.strictEqual(r.pyeongLabel, null);
});
check('CASE A: ㎡ 모드에서는 항상 raw ㎡ 표기, pyeongLabel null', () => {
  const unit: AreaChipDisplayUnit = { displayExclusiveArea: '84.79', representativePyeong: 34 };
  const r = resolveAreaChipDisplay(unit, '㎡', false, '전용 84.79㎡');
  assert.strictEqual(r.displayLabel, '전용 84.79㎡');
  assert.strictEqual(r.pyeongLabel, null);
});

// CASE B — Unit Master 자체가 없음 (예: 동대신역비스타동원아파트)
check('CASE B: unit=null(Unit Master 없음) + 평 모드 -> fallback 라벨 유지 + "평형 정보 없음"', () => {
  const r = resolveAreaChipDisplay(null, '평', false, '전용 59.96㎡');
  assert.strictEqual(r.displayLabel, '전용 59.96㎡');
  assert.strictEqual(r.pyeongLabel, PYEONG_UNAVAILABLE_LABEL);
});
check('CASE B: unit=null + ㎡ 모드 -> pyeongLabel 없음(불필요한 안내 금지)', () => {
  const r = resolveAreaChipDisplay(null, '㎡', false, '전용 59.96㎡');
  assert.strictEqual(r.pyeongLabel, null);
});

// CASE C — Unit Master row는 있지만 이 area만 representativePyeong이 null (partial coverage)
check('CASE C: Unit Master row 있음 + representativePyeong null -> raw ㎡ + "평형 정보 없음"(fake 계산 금지)', () => {
  const unit: AreaChipDisplayUnit = { displayExclusiveArea: '59.96', representativePyeong: null };
  const r = resolveAreaChipDisplay(unit, '평', false, '전용 59.96㎡');
  assert.strictEqual(r.displayLabel, '전용 59.96㎡');
  assert.strictEqual(r.pyeongLabel, PYEONG_UNAVAILABLE_LABEL);
  // fake 계산(59.96 / 3.3058 ≈ 18평)이 아닌지 명시적으로 재확인
  assert.notStrictEqual(r.displayLabel, '18평');
});

// CASE D — collision: 서로 다른 두 전용면적이 같은 representativePyeong으로 수렴
// (대신롯데캐슬 실측: 84.7855㎡ -> 34평, 84.995㎡ -> 34평)
check('CASE D: 충돌(같은 평, 다른 전용면적) -> 보조 라벨로 원본 ㎡를 구분해서 노출', () => {
  const unitA: AreaChipDisplayUnit = { displayExclusiveArea: '84.79', representativePyeong: 34 };
  const unitB: AreaChipDisplayUnit = { displayExclusiveArea: '85.00', representativePyeong: 34 };
  const rA = resolveAreaChipDisplay(unitA, '평', true, '전용 84.79㎡');
  const rB = resolveAreaChipDisplay(unitB, '평', true, '전용 85.00㎡');
  assert.strictEqual(rA.displayLabel, '34평');
  assert.strictEqual(rB.displayLabel, '34평');
  assert.strictEqual(rA.pyeongLabel, '전용 84.79㎡');
  assert.strictEqual(rB.pyeongLabel, '전용 85.00㎡');
  assert.notStrictEqual(rA.pyeongLabel, rB.pyeongLabel); // 충돌 해소 확인 — 서로 구분되어야 함
});
check('CASE D 대조군: 충돌 아니면 보조 라벨 없음(불필요한 caption 노출 금지)', () => {
  const unit: AreaChipDisplayUnit = { displayExclusiveArea: '84.79', representativePyeong: 34 };
  const r = resolveAreaChipDisplay(unit, '평', false, '전용 84.79㎡');
  assert.strictEqual(r.pyeongLabel, null);
});

console.log('\n--- 정적 가드(§4/§16 재도입 방지) ---');

const REPO_ROOT = path.join(__dirname, '..');
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

check('area-toggle 경로에 exclusiveArea/3.3058 fake 계산이 없음(area-utils.ts)', () => {
  const src = readSrc('src/lib/area-utils.ts');
  // resolveAreaChipDisplay 함수 본문만 추출해 검사 — 파일 상단 주석/다른 함수의
  // "3.305785" 참조(getUniquePyeongLabels 등, 이 STEP의 대상이 아닌 기존 dead code)는
  // 별개로 허용하고, toggle이 실제로 쓰는 함수 자체에 나눗셈이 없는지만 확인한다.
  const fnStart = src.indexOf('export function resolveAreaChipDisplay');
  assert.ok(fnStart >= 0, 'resolveAreaChipDisplay 함수를 찾을 수 없음');
  const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
  assert.ok(!/3\.3058/.test(fnBody), 'resolveAreaChipDisplay 안에 3.3058 계산이 재도입됨');
  assert.ok(!/\/\s*M2_PER_PYEONG/.test(fnBody), 'resolveAreaChipDisplay 안에 M2_PER_PYEONG 나눗셈이 재도입됨');
});
// 코드 주석(// ..., /* ... */, JSX {/* ... */})은 "이 패턴을 쓰지 않는다"는 설명을
// 위해 금지 문자열을 의도적으로 언급하는 경우가 많다 — 실제 계산식(코드) 재도입만
// 잡아내기 위해 주석을 모두 제거한 뒤 검사한다.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

check('AreaSelector.tsx의 chip 생성 로직에 자체 평 계산이 없음(resolveAreaChipDisplay에 위임)', () => {
  const src = readSrc('src/components/AreaSelector.tsx');
  const code = stripComments(src);
  assert.ok(!/3\.3058/.test(code), 'AreaSelector.tsx 코드(주석 제외)에 3.3058 계산이 재도입됨');
  assert.ok(src.includes('resolveAreaChipDisplay'), 'AreaSelector.tsx가 더 이상 resolveAreaChipDisplay를 쓰지 않음');
});
check('apt-client.tsx toggle 렌더링에 자체 평 계산이 없음', () => {
  const src = readSrc('src/app/apt/[name]/apt-client.tsx');
  const code = stripComments(src);
  assert.ok(!/3\.3058/.test(code), 'apt-client.tsx 코드(주석 제외)에 3.3058 계산이 재도입됨');
});
check('㎡/평 toggle UI가 Unit Master 존재 여부로 조건부 렌더링되지 않음(항상 노출, §5)', () => {
  const src = readSrc('src/app/apt/[name]/apt-client.tsx');
  const toggleIdx = src.indexOf("(['㎡', '평'] as AreaUnit[]).map");
  assert.ok(toggleIdx >= 0, 'toggle 렌더 블록을 찾을 수 없음');
  // toggle 블록 시작 지점 이전 300자 내에 "hasUnitMaster &&" 같은 게이트가 toggle
  // wrapper에 직접 걸려있지 않은지 확인(§5 회귀 가드).
  const before = src.slice(Math.max(0, toggleIdx - 400), toggleIdx);
  assert.ok(!/hasUnitMaster\s*&&\s*\(?\s*$/.test(before.trim()), 'toggle이 다시 hasUnitMaster 조건부로 숨겨짐');
});

check('StickyActionBar.tsx에 "관심단지 저장" 하드코딩 텍스트가 없음(§16)', () => {
  const src = readSrc('src/components/StickyActionBar.tsx');
  assert.ok(!src.includes('관심단지 저장'), 'StickyActionBar.tsx에 "관심단지 저장" 문자열이 재도입됨');
});
check('FavoriteButton.tsx의 렌더 children(가시 텍스트)이 상태와 무관하게 고정("관심단지")', () => {
  const src = readSrc('src/components/FavoriteButton.tsx');
  // 가시 텍스트를 만드는 JSX children 표현식만 검사 — aria-label/title은 접근성
  // 목적상 상태별로 다른 문구(관심단지 해제/저장)를 쓰는 것이 의도된 설계이므로 제외하고,
  // 주석(설명 목적으로 금지 문자열을 언급)도 stripComments로 먼저 제거한다.
  const code = stripComments(src);
  const lines = code.split('\n');
  const violatingLines = lines.filter((line) => {
    if (!line.includes('관심단지 저장')) return false;
    if (line.includes('aria-label') || line.includes('title=')) return false;
    if (line.includes('showError')) return false;
    return true;
  });
  assert.strictEqual(violatingLines.length, 0, `가시 텍스트에 상태 의존 "관심단지 저장"이 남아있음: ${JSON.stringify(violatingLines)}`);
  assert.ok(src.includes("{!compact && '관심단지'}"), 'FavoriteButton.tsx의 non-compact 텍스트가 더 이상 고정 문자열이 아님');
});
check('detail.module.css의 stickyActionRow가 3-column 고정 grid(overflow 방지, §17)', () => {
  const src = readSrc('src/app/apt/[name]/detail.module.css');
  const idx = src.indexOf('.stickyActionRow');
  assert.ok(idx >= 0, '.stickyActionRow 규칙을 찾을 수 없음');
  const block = src.slice(idx, src.indexOf('}', idx));
  assert.ok(/repeat\(\s*3\s*,\s*minmax\(0,\s*1fr\)\)/.test(block), '.stickyActionRow가 더 이상 3-column minmax(0,1fr) grid가 아님(overflow 위험 재도입)');
});

console.log(`\nA파트: ${passed} passed, ${failed} failed.\n`);

async function fetchJson(base: string, urlPath: string, timeoutMs = 30000): Promise<any> {
  try {
    const res = await fetch(`${base}${urlPath}`, { signal: AbortSignal.timeout(timeoutMs) });
    return { httpStatus: res.status, ok: res.ok };
  } catch (e) { return { status: 'FETCH_ERROR', error: String(e) }; }
}

async function runLive() {
  console.log('=== B. LIVE PAGE CHECKS (regression smoke) ===');

  const fixtures = [
    { label: '대신롯데캐슬 (있음: pyeong 있음 + collision)', path: '/apt/대신롯데캐슬' },
    { label: '동대신역비스타동원아파트 (Unit Master 없음)', path: '/apt/동대신역비스타동원아파트' },
    { label: '연산동한솔솔파크 (Apartment row 있으나 unit type 없음)', path: '/apt/연산동한솔솔파크' },
  ];

  for (const fx of fixtures) {
    const r = await fetchJson(OPT.base, fx.path);
    console.log(`  [detail] ${fx.label} -> httpStatus=${r.httpStatus ?? r.status}`);
    if (r.httpStatus && r.httpStatus >= 500) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'area-toggle', detail: `${fx.path} 서버 에러(${r.httpStatus})` });
    } else if (r.status === 'FETCH_ERROR') {
      findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `${fx.path} fetch 실패 — dev 서버 미기동 가능성: ${r.error}` });
    }
  }

  // ── REGRESSION SMOKE (이 STEP과 무관한 기존 기능들이 여전히 200을 반환하는지) ──
  console.log('=== REGRESSION SMOKE (기존 기능 unrelated to this STEP) ===');
  const regressionPaths = [
    '/apt/대신롯데캐슬',
    '/map',
    '/stats',
    '/school',
  ];
  for (const p of regressionPaths) {
    const r = await fetchJson(OPT.base, p);
    const ok = (r.httpStatus ?? 0) < 500;
    console.log(`  [regression] ${p} -> ${ok ? 'OK' : 'FAIL'} (${r.httpStatus ?? r.status})`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${p} httpStatus=${r.httpStatus ?? r.status}` });
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
    const outPath = path.join(outDir, 'APT_DETAIL_CONSISTENCY_QA.json');
    fs.writeFileSync(outPath, JSON.stringify({ unitPassed: passed, unitFailed: failed, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const blocking = findings.filter((f) => f.severity === 'P0_DATA_TRUST');
  if (failed > 0 || blocking.length > 0) process.exitCode = 1;
}

main();
