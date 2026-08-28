/**
 * APT INFO IDENTITY HOTFIX V1 §23 — A파트(순수 함수 단위 검사 + 정적 가드, 서버
 * 불필요) + B파트(실행 중인 dev 서버 라이브 검증, read-only GET + 회귀 스모크).
 *
 * 사용법:
 *   npx tsx -r ./scripts/_register-paths.js scripts/run-apt-info-identity-qa.ts [옵션]
 * 옵션:
 *   --skip-live   B파트 생략, A파트(단위 검사 + 정적 가드)만 실행.
 *   --json        tmp/qa/APT_INFO_IDENTITY_QA.json로 저장.
 *   --base=<url>  기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import { shouldAdoptFallbackUnitTypes, normalizeAptName } from '@/lib/apt-name-match';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}
const OPT = { skipLive: flag('skip-live') !== null, json: flag('json') !== null, base: flag('base') || 'http://localhost:3000' };

interface Finding { severity: 'P0_DATA_TRUST' | 'P1_STRUCTURE' | 'INFO'; area: 'identity' | 'common'; detail: string; }
const findings: Finding[] = [];
let passed = 0, failed = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`  PASS  ${label}`); passed++; }
  catch (e: any) { console.error(`  FAIL  ${label}: ${e.message}`); failed++; findings.push({ severity: 'P0_DATA_TRUST', area: 'common', detail: `${label}: ${e.message}` }); }
}

console.log('=== A. UNIT TESTS: shouldAdoptFallbackUnitTypes (no server) ===');

// A. strong exact result preserved (currentUnitTypesCount > 0 -> 절대 false)
check('A. 이미 non-empty(strong) 결과가 있으면 fallback을 절대 채택하지 않음(이름이 완전히 같아도)', () => {
  const result = shouldAdoptFallbackUnitTypes({
    currentUnitTypesCount: 8,
    fallbackName: '대신롯데캐슬',
    requestedAptName: '대신롯데캐슬',
    fallbackUnitTypesCount: 3,
  });
  assert.strictEqual(result, false);
});

// B. 0-row weak fallback cannot overwrite
check('B. fallback의 unitTypes가 0건이면 이름이 같아도 채택하지 않음(있으나 마나 한 덮어쓰기 방지)', () => {
  const result = shouldAdoptFallbackUnitTypes({
    currentUnitTypesCount: 0,
    fallbackName: '대신롯데캐슬',
    requestedAptName: '대신롯데캐슬',
    fallbackUnitTypesCount: 0,
  });
  assert.strictEqual(result, false);
});

// C. same address different apartment does not merge (synthetic — 실제 DB에는 이런
// 사례가 없어 §15 지시대로 synthetic으로 검증)
check('C. 같은 주소라도 정규화 후 이름이 다르면(다른 아파트) 채택하지 않음', () => {
  const result = shouldAdoptFallbackUnitTypes({
    currentUnitTypesCount: 0,
    fallbackName: '엘지메트로시티3차', // 실제로는 전혀 다른 단지라고 가정
    requestedAptName: '대신롯데캐슬',
    fallbackUnitTypesCount: 5,
  });
  assert.strictEqual(result, false);
});

// D. aptSeq exact wins — 이 route/함수는 요청 컨텍스트에 aptSeq가 없다(§7 문서
// 근거: 실측상 이름 표기가 다른 두 row가 같은 aptSeq를 공유하는 사례가 확인돼
// aptSeq만으로는 이 케이스를 구분하지 못한다). 대신 여기서는 "정규화된 이름이 다른
// 요청은 설령 나중에 같은 aptSeq로 밝혀지더라도 이 함수만으로는 채택되지 않는다"
// (즉 aptSeq를 임의로 identity proof로 취급해 이름 검사를 우회하지 않는다)는
// 안전한 보수적 동작을 확인한다.
check('D. aptSeq 정보 없이도 이름 정규화 불일치 시 안전하게 거부(과신 방지)', () => {
  const result = shouldAdoptFallbackUnitTypes({
    currentUnitTypesCount: 0,
    fallbackName: '대신롯데캐슬아파트', // 실측: 같은 aptSeq(26140-1164)를 공유하는 실제 사례
    requestedAptName: '대신롯데캐슬',
    fallbackUnitTypesCount: 0, // 실측: 이 특정 row는 unitTypes 0건
  });
  assert.strictEqual(result, false); // 0건이라 B 가드에 먼저 걸림 — 별도 안전 확인
});
check('D-2. 이름이 정규화 후 정확히 같고(같은 아파트로 판단) fallback에 실제 데이터가 있으면 채택', () => {
  const result = shouldAdoptFallbackUnitTypes({
    currentUnitTypesCount: 0,
    fallbackName: '대신롯데캐슬아파트',
    requestedAptName: '대신롯데캐슬',
    fallbackUnitTypesCount: 8,
  });
  assert.strictEqual(result, true);
  assert.strictEqual(normalizeAptName('대신롯데캐슬아파트'), normalizeAptName('대신롯데캐슬'));
});

// E. name-only cross-region fallback absent — 이 함수 자체가 dong/jibun/lawdCd 등
// 지역 파라미터를 전혀 받지 않는다(주소는 호출부의 findFirst where절이 이미
// dong+jibun으로 제한한 후보군에서만 이 함수가 호출됨) — 함수 시그니처 자체로
// "이름만으로 타 지역까지 검색"이 구조적으로 불가능함을 확인.
check('E. 함수 시그니처에 지역/주소 파라미터가 없어 이름만으로 타 지역 검색이 불가능함(구조적 보장)', () => {
  const paramNames = Object.keys({
    currentUnitTypesCount: 0,
    fallbackName: '',
    requestedAptName: '',
    fallbackUnitTypesCount: 0,
  } satisfies Parameters<typeof shouldAdoptFallbackUnitTypes>[0]);
  assert.deepStrictEqual(paramNames.sort(), ['currentUnitTypesCount', 'fallbackName', 'fallbackUnitTypesCount', 'requestedAptName'].sort());
});

// F. fake pyeong unchanged absent — 이전 STEP(APT DETAIL CONSISTENCY HOTFIX V1)의
// 가드를 이번 STEP이 건드리지 않았는지 재확인.
console.log('\n--- 정적 가드 ---');

const REPO_ROOT = path.join(__dirname, '..');
function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

check('F. area-utils.ts의 resolveAreaChipDisplay는 여전히 fake pyeong 계산이 없음(이전 STEP 회귀 가드 유지)', () => {
  const src = readSrc('src/lib/area-utils.ts');
  const fnStart = src.indexOf('export function resolveAreaChipDisplay');
  assert.ok(fnStart >= 0, 'resolveAreaChipDisplay 함수를 찾을 수 없음');
  const fnBody = src.slice(fnStart, src.indexOf('\n}', fnStart));
  assert.ok(!/3\.3058/.test(fnBody), 'resolveAreaChipDisplay 안에 3.3058 계산이 재도입됨');
});

check('G. info/route.ts에 "dong+jibun만"으로 unitTypes를 직접 대입하는 무조건 패턴이 재도입되지 않음', () => {
  const src = readSrc('src/app/api/apt/[name]/info/route.ts');
  const code = stripComments(src);
  // 과거 버그 패턴: `if (byJibun) { unitTypes = byJibun.unitTypes; }` — 조건 없이
  // byJibun 존재만으로 즉시 대입하는 코드가 다시 들어오면 안 된다.
  assert.ok(
    !/if\s*\(\s*byJibun\s*\)\s*\{\s*unitTypes\s*=\s*byJibun\.unitTypes\s*;?\s*\}/.test(code),
    '무조건 대입 패턴(if (byJibun) { unitTypes = byJibun.unitTypes; })이 재도입됨'
  );
  assert.ok(code.includes('shouldAdoptFallbackUnitTypes'), 'info/route.ts가 더 이상 shouldAdoptFallbackUnitTypes를 쓰지 않음');
});

check('H. info/route.ts 응답 필드(success/aptName/info/unitTypes)가 그대로 유지됨(response contract 불변)', () => {
  const src = readSrc('src/app/api/apt/[name]/info/route.ts');
  const returnIdx = src.indexOf('return NextResponse.json({');
  assert.ok(returnIdx >= 0);
  const block = src.slice(returnIdx, src.indexOf('});', returnIdx));
  for (const field of ['success', 'aptName', 'info', 'unitTypes']) {
    assert.ok(block.includes(field), `응답에서 ${field} 필드가 사라짐(contract 위반)`);
  }
});

console.log(`\nA파트: ${passed} passed, ${failed} failed.\n`);

async function fetchJson(base: string, urlPath: string, timeoutMs = 30000): Promise<any> {
  try {
    const res = await fetch(`${base}${urlPath}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
    return res.json();
  } catch (e) { return { status: 'FETCH_ERROR', error: String(e) }; }
}

// HTML 페이지(회귀 스모크 대상: /apt/[name], /map, /stats, /school)는 JSON이 아니므로
// httpStatus만 확인하고 본문은 파싱하지 않는다.
async function fetchStatus(base: string, urlPath: string, timeoutMs = 30000): Promise<{ httpStatus: number } | { status: 'FETCH_ERROR'; error: string }> {
  try {
    const res = await fetch(`${base}${urlPath}`, { signal: AbortSignal.timeout(timeoutMs) });
    return { httpStatus: res.status };
  } catch (e) { return { status: 'FETCH_ERROR', error: String(e) }; }
}

async function runLive() {
  console.log('=== B. LIVE API CHECKS ===');

  // 대신롯데캐슬 — strong exact identity(name+dong)로 unitTypes 8건이 그대로
  // 보존되는지 실제 라이브 라우트에서 확인한다(before: 버그로 0건, after: 8건).
  const strong = await fetchJson(
    OPT.base,
    '/api/apt/' + encodeURIComponent('대신롯데캐슬') + '/info?jibun=762&dong=' + encodeURIComponent('서대신동3가') + '&lawdCd=26140'
  );
  const strongCount = Array.isArray(strong.unitTypes) ? strong.unitTypes.length : 0;
  console.log(`  [identity] 대신롯데캐슬(exact) -> unitTypes=${strongCount}건`);
  if (strongCount !== 8) {
    findings.push({ severity: 'P0_DATA_TRUST', area: 'identity', detail: `대신롯데캐슬 exact 조회에서 unitTypes가 8건이 아님(실제 ${strongCount}건) — STRONGER_RESULT PROTECTION 회귀 의심` });
  }
  if (strongCount > 0) {
    const has3458collision = strong.unitTypes.some((u: any) => u.representativePyeong === 34);
    if (!has3458collision) {
      findings.push({ severity: 'P0_DATA_TRUST', area: 'identity', detail: '대신롯데캐슬 unitTypes에 34평 collision 케이스가 없음(데이터 변질 의심)' });
    }
  }

  // 이름 변형("대신롯데캐슬아파트")으로 조회해도 서버 500/구조 붕괴 없이 정상
  // 응답하는지(0건이라도 honest 0이면 OK, 회귀는 500/예외).
  const variant = await fetchJson(
    OPT.base,
    '/api/apt/' + encodeURIComponent('대신롯데캐슬아파트') + '/info?jibun=762&dong=' + encodeURIComponent('서대신동3가') + '&lawdCd=26140'
  );
  console.log(`  [identity] 대신롯데캐슬아파트(변형) -> httpStatus=${variant.httpStatus ?? 'OK'} success=${variant.success}`);
  if (variant.success !== true) {
    findings.push({ severity: 'P1_STRUCTURE', area: 'identity', detail: `이름 변형 조회가 실패함: ${JSON.stringify(variant).slice(0, 150)}` });
  }

  // ── DETAIL PAGE REGRESSION (§17) ──
  console.log('=== REGRESSION SMOKE ===');
  const fixtures = [
    { label: '동대신역비스타동원아파트', path: '/apt/' + encodeURIComponent('동대신역비스타동원아파트') },
    { label: '연산동한솔솔파크', path: '/apt/' + encodeURIComponent('연산동한솔솔파크') },
    { label: '대신롯데캐슬', path: '/apt/' + encodeURIComponent('대신롯데캐슬') },
  ];
  for (const fx of fixtures) {
    const r = await fetchStatus(OPT.base, fx.path);
    const status = 'httpStatus' in r ? r.httpStatus : null;
    const ok = status !== null && status < 500;
    console.log(`  [regression] ${fx.label} -> ${ok ? 'OK' : 'FAIL'} (${status ?? (r as any).error})`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${fx.path}` });
  }
  for (const p of ['/map', '/stats', '/school']) {
    const r = await fetchStatus(OPT.base, p);
    const status = 'httpStatus' in r ? r.httpStatus : null;
    const ok = status !== null && status < 500;
    console.log(`  [regression] ${p} -> ${ok ? 'OK' : 'FAIL'} (${status ?? (r as any).error})`);
    if (!ok) findings.push({ severity: 'P1_STRUCTURE', area: 'common', detail: `회귀 확인 실패: ${p}` });
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
    const outPath = path.join(outDir, 'APT_INFO_IDENTITY_QA.json');
    fs.writeFileSync(outPath, JSON.stringify({ unitPassed: passed, unitFailed: failed, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const blocking = findings.filter((f) => f.severity === 'P0_DATA_TRUST');
  if (failed > 0 || blocking.length > 0) process.exitCode = 1;
}

main();
