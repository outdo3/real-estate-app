/**
 * STATISTICS PERFORMANCE V1 §38 — cold/warm latency measurement + structural
 * regression guard for the statistics API routes. Read-only(GET) against a
 * running dev server (no DB writes, no destructive calls).
 *
 * "Cold" here means: the caller has restarted the dev server process (and
 * ideally cleared .next/cache) immediately before running this script with
 * --mode=cold, so every in-memory cache (getOrSetCache store, lawdCd/sigungu
 * resolver caches, Next fetch Data Cache) starts empty. This script cannot
 * restart the server itself (§34) — restart is the operator's responsibility,
 * documented in STATISTICS_PERFORMANCE_V1.md.
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-performance-qa.ts --mode=cold --label=before --json
 *   npx tsx scripts/run-statistics-performance-qa.ts --mode=warm --label=before --json
 *
 * 옵션:
 *   --mode=cold|warm   cold: 각 케이스 1회만 호출(서버 재시작 직후에 실행해야 유효).
 *                      warm: 각 케이스 연속 2회 호출, 두 번째 값을 기록(§35).
 *   --label=<name>     결과 파일 구분용 라벨(예: before/after).
 *   --quick            district 케이스 생략, sido-all 핵심 케이스만.
 *   --json             tmp/qa/STATISTICS_PERFORMANCE_V1_<label>_<mode>.json 저장.
 *   --base=<url>       기본 http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';

function flag(name: string): string | null {
  const argv = process.argv.slice(2);
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? '' : null;
}

const OPT = {
  mode: (flag('mode') === 'warm' ? 'warm' : 'cold') as 'cold' | 'warm',
  label: flag('label') || 'run',
  quick: flag('quick') !== null,
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_DATA_TRUST' | 'P1_PARTIAL' | 'P1_SLOW' | 'INFO';
  case: string;
  detail: string;
}

interface CaseResult {
  case: string;
  route: string;
  params: Record<string, string>;
  ok: boolean;
  ms: number;
  ms2?: number; // warm mode: second call
  partial?: boolean;
  failedDistricts?: number;
  apiError?: boolean;
  entries?: number;
}

const SIDOS = [
  { code: '26', label: 'busan' },
  { code: '11', label: 'seoul' },
];
const DISTRICTS = [
  { lawdCd: '26140', label: 'busan-seogu' },
  { lawdCd: '26470', label: 'busan-yeonje' },
  { lawdCd: '11680', label: 'seoul-gangnam' },
];

async function timedFetch(base: string, urlPath: string, params: Record<string, string>, timeoutMs = 150000): Promise<{ ok: boolean; ms: number; json: any }> {
  const qs = new URLSearchParams(params).toString();
  const start = Date.now();
  try {
    const res = await fetch(`${base}${urlPath}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - start;
    if (!res.ok) return { ok: false, ms, json: { status: 'HTTP_ERROR', httpStatus: res.status } };
    const json = await res.json();
    return { ok: true, ms, json };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, json: { status: 'FETCH_ERROR', error: String(e) } };
  }
}

async function runCase(
  label: string,
  route: string,
  params: Record<string, string>,
  findings: Finding[],
  results: CaseResult[]
) {
  const first = await timedFetch(OPT.base, route, params);
  const cr: CaseResult = { case: label, route, params, ok: first.ok, ms: first.ms };

  const body = first.json || {};
  const partial = body.partial === true;
  const failedDistricts = Array.isArray(body.failedDistricts) ? body.failedDistricts.length : undefined;
  const apiError = body.apiError === true;
  cr.partial = partial;
  cr.failedDistricts = failedDistricts;
  cr.apiError = apiError;

  if (!first.ok) {
    findings.push({ severity: 'P1_SLOW', case: label, detail: `요청 실패: ${JSON.stringify(body).slice(0, 200)}` });
  }
  if (partial) {
    findings.push({ severity: 'P1_PARTIAL', case: label, detail: `partial=true, failedDistricts=${failedDistricts}` });
  }
  // data trust: 가짜 평형(음수/비정상 pyung), bounded 2년최고가 라벨 누락 등은 구조적으로만 점검.
  if (route.includes('price-rankings') && body.mode !== 'rising' && body.status === 'OK' && !body.historicalHighCoverageLabel) {
    findings.push({ severity: 'P0_DATA_TRUST', case: label, detail: 'historicalHighCoverageLabel 누락 — bounded 2년최고가 문구 위험' });
  }

  if (OPT.mode === 'warm') {
    const second = await timedFetch(OPT.base, route, params);
    cr.ms2 = second.ms;
  }

  results.push(cr);
  const shown = cr.ms2 !== undefined ? `${cr.ms}ms -> warm ${cr.ms2}ms` : `${cr.ms}ms`;
  console.log(`[${OPT.mode}] ${label.padEnd(28)} ${shown}  partial=${partial} failedDistricts=${failedDistricts ?? '-'} apiError=${apiError}`);
}

async function main() {
  const findings: Finding[] = [];
  const results: CaseResult[] = [];

  // A. VOLUME (dashboard) — sido-all 우선순위 1
  for (const s of SIDOS) {
    await runCase(`volume-${s.label}-all`, '/api/stats/dashboard', { sidoCode: s.code }, findings, results);
  }
  // B. CONCENTRATION — sido-all
  for (const s of SIDOS) {
    await runCase(`concentration-${s.label}-all`, '/api/stats/concentration', { sidoCode: s.code, period: '30d', dealType: 'sale' }, findings, results);
  }
  // C. FEED — sido-all
  for (const s of SIDOS) {
    await runCase(`feed-${s.label}-all`, '/api/stats/feed', { sidoCode: s.code, period: '30d' }, findings, results);
  }
  // D. PRICE RANKINGS — sido-all
  for (const s of SIDOS) {
    await runCase(`price-rankings-${s.label}-all`, '/api/stats/price-rankings', { sidoCode: s.code, mode: 'decline', period: '30d' }, findings, results);
  }

  if (!OPT.quick) {
    for (const d of DISTRICTS) {
      await runCase(`volume-${d.label}`, '/api/stats/dashboard', { lawdCd: d.lawdCd }, findings, results);
      await runCase(`feed-${d.label}`, '/api/stats/feed', { lawdCd: d.lawdCd, period: '30d' }, findings, results);
    }
  }

  console.log('\n=== FINDINGS ===');
  if (findings.length === 0) console.log('없음');
  for (const f of findings) console.log(`[${f.severity}] ${f.case}: ${f.detail}`);

  if (OPT.json) {
    const outDir = path.join(process.cwd(), 'tmp', 'qa');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `STATISTICS_PERFORMANCE_V1_${OPT.label}_${OPT.mode}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ mode: OPT.mode, label: OPT.label, results, findings }, null, 2));
    console.log(`\nSaved: ${outPath}`);
  }

  const p0 = findings.filter((f) => f.severity === 'P0_DATA_TRUST');
  if (p0.length > 0) process.exitCode = 1;
}

main();
