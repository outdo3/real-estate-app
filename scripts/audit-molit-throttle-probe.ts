/**
 * E-JIP MOLIT PARTIAL FAILURE REDUCTION V1 §12/§16 — rate-limit 실측 probe.
 *
 * DB write 0회. DB read 0회. MOLIT outbound GET만 수행한다(읽기 전용 공공 API).
 *
 * 모드 (baseline/gated/burst는 수정 전에 실행한 측정 — 수정 후 코드에서는 fetchMolitData가
 * 이미 게이트를 거치므로 같은 수치를 다시 내지 않는다. 설정 후보 비교는 multi를 쓴다):
 *   baseline      — /api/apt/[name] 구조(chunk=12 동시)로 fetchMolitData 호출
 *   gated A       — concurrency/pacing 격자
 *   burst c p     — 60개월 3건을 probe 게이트 하나로
 *   after         — baseline과 같은 구조, 수정 후 fetchMolitData(내장 게이트/차단기/dedup)
 *   after-burst   — 60개월 3건 동시, probe 게이트 없이 수정 후 fetchMolitData에만 맡김
 *   multi c p     — 운영 가드를 거치지 않는 raw 호출 + probe 게이트(인스턴스 1개 모사).
 *                   여러 프로세스를 동시에 띄워 다중 인스턴스 합산을 잰다
 *   collision C   — 다른 인스턴스의 무게이트 60콜 버스트와 이 인스턴스의 60개월 조회 충돌
 *   penalty ms    — 제한을 건 뒤 키가 잠기는 시간(첫 성공까지) 측정
 *
 * 주의: multi/collision/penalty는 의도적으로 제한을 걸 수 있다(키 약 60초 잠김 → 운영
 * 트래픽도 영향). 운영 시간대에는 실행하지 않는다. 출력에는 서비스 키가 나가지 않는다.
 *
 * 실행:
 *   npx ts-node -T --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/audit-molit-throttle-probe.ts <mode> [args]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const CASES: Array<{ label: string; lawdCd: string; period: number }> = [
  { label: 'A 부산 서구 60m', lawdCd: '26140', period: 60 },
  { label: 'B 부산 기장군 60m', lawdCd: '26710', period: 60 },
  { label: 'C 서울 강남구 60m', lawdCd: '11680', period: 60 },
];

function monthsFor(period: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < period; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const isErr = (r: any[]) => r.length === 1 && r[0]?.typeLabel === '에러';
const isRateLimit = (r: any[]) => isErr(r) && /요청제한|LIMITED_NUMBER_OF_SERVICE/.test(String(r[0]?.name || ''));

interface Run { ok: number; failed: number; rateLimited: number; ms: number; calls: number }

// 실제 outbound HTTP와 "초당 제한" 응답 수를 센다(재시도 포함 — outbound - 월 수 = 재시도).
const wire = { outbound: 0, rlResponses: 0 };
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const res = await origFetch(input, init);
  if (url.includes('apis.data.go.kr')) {
    wire.outbound++;
    res.clone().text().then((t) => { if (/초당\s*서비스\s*요청제한|PER_SECOND_EXCEEDS/.test(t)) wire.rlResponses++; }).catch(() => {});
  }
  return res;
}) as typeof fetch;

/** 현재 apt 라우트 구조를 **그대로** 재현: chunkSize=12, 청크 내 전부 동시, pacing/retry 없음. */
async function runBaseline(lawdCd: string, period: number, fetchOne: (ym: string) => Promise<any[]>): Promise<Run> {
  const months = monthsFor(period);
  const t0 = Date.now();
  let ok = 0, failed = 0, rl = 0, calls = 0;
  for (let i = 0; i < months.length; i += 12) {
    const chunk = months.slice(i, i + 12);
    const res = await Promise.all(chunk.map((ym) => { calls++; return fetchOne(ym); }));
    for (const r of res) {
      if (isErr(r)) { failed++; if (isRateLimit(r)) rl++; } else ok++;
    }
  }
  return { ok, failed, rateLimited: rl, ms: Date.now() - t0, calls };
}

/** concurrency N + 슬롯당 pacing P(ms) 게이트. retry 없음 — 게이트 자체의 실패율만 본다. */
async function runGated(lawdCd: string, period: number, conc: number, pace: number, fetchOne: (ym: string) => Promise<any[]>): Promise<Run> {
  const months = monthsFor(period);
  const t0 = Date.now();
  let ok = 0, failed = 0, rl = 0, calls = 0;
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = () => active < conc
    ? (active++, Promise.resolve())
    : new Promise<void>((res) => queue.push(() => { active++; res(); }));
  const release = () => { active--; const n = queue.shift(); if (n) n(); };

  await Promise.all(months.map(async (ym) => {
    await acquire();
    try {
      calls++;
      const r = await fetchOne(ym);
      if (isErr(r)) { failed++; if (isRateLimit(r)) rl++; } else ok++;
      if (pace > 0) await new Promise((res) => setTimeout(res, pace));
    } finally { release(); }
  }));
  return { ok, failed, rateLimited: rl, ms: Date.now() - t0, calls };
}

function line(tag: string, r: Run, period: number) {
  const ratio = ((r.failed / period) * 100).toFixed(1);
  console.log(`  ${tag.padEnd(30)} ok=${String(r.ok).padStart(3)} failed=${String(r.failed).padStart(3)} ` +
    `(${ratio.padStart(5)}%) rateLimited=${String(r.rateLimited).padStart(3)} calls=${String(r.calls).padStart(4)} ${(r.ms / 1000).toFixed(1)}s`);
}

async function main() {
  const mode = process.argv[2] || 'baseline';
  const { fetchMolitData } = await import('../src/lib/api-molit');
  // 게이트/재시도가 없는 순수 1회 호출 경로가 필요하므로, 원 함수를 직접 쓴다.
  const raw = (lawdCd: string) => (ym: string) => fetchMolitData({ type: 'apt', lawdCd, dealYmd: ym }) as Promise<any[]>;

  if (mode === 'baseline' || mode === 'after') {
    console.log(`=== ${mode.toUpperCase()} (/api/apt/[name] 구조: chunk=12, fetchMolitData 경유) ===`);
    for (const c of CASES) {
      const w0 = { ...wire };
      const r = await runBaseline(c.lawdCd, c.period, raw(c.lawdCd));
      await new Promise((res) => setTimeout(res, 300));
      line(c.label, r, c.period);
      console.log(`      outbound=${wire.outbound - w0.outbound} retries=${wire.outbound - w0.outbound - c.period} rateLimitResponses=${wire.rlResponses - w0.rlResponses}`);
      await new Promise((res) => setTimeout(res, 3000)); // 케이스 간 quota 회복
    }
    return;
  }

  if (mode === 'multi') {
    // 게이트 설정 후보를 "인스턴스 1개"로 모사한다: 운영 가드를 거치지 않는 raw 호출 +
    // probe 로컬 게이트(conc / pace). 두 프로세스를 동시에 띄워 다중 인스턴스를 재현한다.
    const conc = Number(process.argv[3] || 6), pace = Number(process.argv[4] || 200);
    const key = encodeURIComponent(decodeURIComponent(String(process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
    const endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
    let active = 0; const queue: Array<() => void> = [];
    const acquire = () => active < conc ? (active++, Promise.resolve())
      : new Promise<void>((res) => queue.push(() => { active++; res(); }));
    const release = () => { active--; const n = queue.shift(); if (n) n(); };
    let ok = 0, rl = 0, other = 0;
    const t0 = Date.now();
    const tasks = CASES.flatMap((c) => monthsFor(c.period).map((ym) => ({ lawd: c.lawdCd, ym })));
    await Promise.all(tasks.map(async ({ lawd, ym }) => {
      await acquire();
      try {
        const res = await origFetch(`${endpoint}?serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        const t = res ? await res.text() : '';
        if (/초당\s*서비스\s*요청제한|PER_SECOND_EXCEEDS/.test(t)) rl++;
        else if (/<resultCode>0*0<\/resultCode>/.test(t)) ok++;
        else other++;
        if (pace > 0) await new Promise((r) => setTimeout(r, pace));
      } finally { release(); }
    }));
    const secs = (Date.now() - t0) / 1000;
    console.log(`  multi conc=${conc} pace=${pace}: ok=${ok} rateLimited=${rl} other=${other} of ${tasks.length} (${((rl / tasks.length) * 100).toFixed(1)}% RL) ${secs.toFixed(1)}s ~${(tasks.length / secs).toFixed(1)} rps`);
    return;
  }

  if (mode === 'penalty') {
    // 제한을 한 번 넘긴 뒤 키가 얼마나 오래 막히는지: 60콜 동시 버스트로 제한을 걸고,
    // 이후 단일 요청을 일정 간격으로 보내 첫 성공 시점을 잰다.
    const interval = Number(process.argv[3] || 1000);
    const key = encodeURIComponent(decodeURIComponent(String(process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
    const endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
    const probe = async (lawd: string, ym: string) => {
      const res = await origFetch(`${endpoint}?serviceKey=${key}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=10`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const t = res ? await res.text() : '';
      return /초당\s*서비스\s*요청제한|PER_SECOND_EXCEEDS/.test(t) ? 'RL' : (/<resultCode>0*0<\/resultCode>/.test(t) ? 'OK' : 'OTHER');
    };
    const burst = await Promise.all(monthsFor(60).map((ym) => probe('26500', ym)));
    const tTrip = Date.now();
    console.log(`=== PENALTY (poll every ${interval}ms) === burst: OK=${burst.filter((x) => x === 'OK').length} RL=${burst.filter((x) => x === 'RL').length}`);
    const seqLog: string[] = [];
    let firstOk = -1, consecutiveOk = 0;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, interval));
      const r = await probe('26140', monthsFor(12)[i % 12]);
      const at = ((Date.now() - tTrip) / 1000).toFixed(1);
      seqLog.push(`${at}s:${r}`);
      if (r === 'OK') { if (firstOk < 0) firstOk = Number(at); consecutiveOk++; } else consecutiveOk = 0;
      if (consecutiveOk >= 5) break;
    }
    console.log('  ' + seqLog.join(' '));
    console.log(`  first OK after trip: ${firstOk}s`);
    return;
  }

  if (mode === 'collision') {
    // 서버리스 다중 인스턴스 모사: "다른 인스턴스"가 게이트 없이 60콜을 동시에 쏘는 동안
    // 이 인스턴스의 60개월 조회(내장 게이트/재시도)가 회복하는지 본다. 다른 인스턴스의
    // 호출은 origFetch로 직접 보내 이 프로세스의 게이트/카운터를 거치지 않게 한다.
    const key = encodeURIComponent(decodeURIComponent(String(process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
    const other = '26500'; // 수영구 — 대상 케이스와 다른 지역
    const endpoint = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
    const c = CASES.find((x) => x.label.startsWith(process.argv[3] || 'C'))!;
    console.log(`=== COLLISION: ungated 60-call burst (other instance) + gated ${c.label} ===`);
    const t0 = Date.now();
    let otherRl = 0;
    const otherInstance = Promise.all(monthsFor(60).map(async (ym) => {
      const res = await origFetch(`${endpoint}?serviceKey=${key}&LAWD_CD=${other}&DEAL_YMD=${ym}&numOfRows=1000`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const t = res ? await res.text() : '';
      if (/초당\s*서비스\s*요청제한|PER_SECOND_EXCEEDS/.test(t)) otherRl++;
    }));
    const w0 = { ...wire };
    const [r] = await Promise.all([runBaseline(c.lawdCd, c.period, raw(c.lawdCd)), otherInstance]);
    await new Promise((res) => setTimeout(res, 300));
    line(`this instance ${c.label}`, r, c.period);
    console.log(`      outbound=${wire.outbound - w0.outbound} retries=${wire.outbound - w0.outbound - c.period} rateLimitResponses=${wire.rlResponses - w0.rlResponses} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`      other instance rate-limited responses=${otherRl}/60`);
    return;
  }

  if (mode === 'after-burst') {
    // 수정 후: 상세페이지 3건 동시(서로 다른 지역 60개월씩 = 180콜)를 probe 쪽 게이트 없이
    // 실제 fetchMolitData(내장 게이트/재시도/dedup)에만 맡긴다.
    console.log('=== AFTER-BURST: 3 concurrent 60m route-shaped requests, no probe gate ===');
    const t0 = Date.now();
    const runs = await Promise.all(CASES.map(async (c) => ({ c, r: await runBaseline(c.lawdCd, c.period, raw(c.lawdCd)) })));
    await new Promise((res) => setTimeout(res, 300));
    for (const { c, r } of runs) line(c.label, r, c.period);
    const tot = runs.reduce((a, x) => a + x.r.failed, 0);
    console.log(`  TOTAL failed=${tot}/180 (${((tot / 180) * 100).toFixed(1)}%) wall=${((Date.now() - t0) / 1000).toFixed(1)}s outbound=${wire.outbound} retries=${wire.outbound - 180} rateLimitResponses=${wire.rlResponses}`);
    return;
  }

  if (mode === 'burst') {
    // 실제 상세페이지 1회 조회 = 이 라우트 3회 동시 호출(parent 1 + 차트/투자지표 2).
    // 공유 게이트 하나로 3개 요청 180콜을 함께 통과시킨다.
    const conc = Number(process.argv[3] || 6), pace = Number(process.argv[4] || 200);
    console.log(`=== BURST: 3 concurrent 60m requests through ONE shared gate (conc=${conc} pace=${pace}ms) ===`);
    let active = 0; const queue: Array<() => void> = [];
    const acquire = () => active < conc ? (active++, Promise.resolve())
      : new Promise<void>((res) => queue.push(() => { active++; res(); }));
    const release = () => { active--; const n = queue.shift(); if (n) n(); };
    let peak = 0;
    const gated = (lawdCd: string) => async (ym: string) => {
      await acquire(); peak = Math.max(peak, active);
      try { const r = await fetchMolitData({ type: 'apt', lawdCd, dealYmd: ym }) as any[];
        if (pace > 0) await new Promise((res) => setTimeout(res, pace)); return r; }
      finally { release(); }
    };
    const t0 = Date.now();
    const runs = await Promise.all(CASES.map(async (c) => {
      const months = monthsFor(c.period);
      const f = gated(c.lawdCd);
      let ok = 0, failed = 0, rl = 0;
      await Promise.all(months.map(async (ym) => {
        const r = await f(ym);
        if (isErr(r)) { failed++; if (isRateLimit(r)) rl++; } else ok++;
      }));
      return { c, r: { ok, failed, rateLimited: rl, ms: Date.now() - t0, calls: months.length } };
    }));
    for (const { c, r } of runs) line(c.label, r, c.period);
    const tot = runs.reduce((a, x) => a + x.r.failed, 0);
    console.log(`  TOTAL failed=${tot}/180 (${((tot / 180) * 100).toFixed(1)}%) wall=${((Date.now() - t0) / 1000).toFixed(1)}s peakConcurrency=${peak}`);
    return;
  }

  if (mode === 'gated') {
    const grid: Array<[number, number]> = [[6, 200], [4, 250], [3, 300], [2, 350]];
    const c = CASES.find((x) => x.label.startsWith(process.argv[3] || 'A'))!;
    console.log(`=== GATED GRID on ${c.label} ===`);
    for (const [conc, pace] of grid) {
      const r = await runGated(c.lawdCd, c.period, conc, pace, raw(c.lawdCd));
      line(`conc=${conc} pace=${pace}ms`, r, c.period);
      await new Promise((res) => setTimeout(res, 5000));
    }
    return;
  }
  console.error('unknown mode');
  process.exitCode = 1;
}

main().catch((e) => {
  // 예외 메시지에 요청 URL(=serviceKey)이 섞일 수 있으므로 마스킹한 메시지만 남긴다.
  console.error(String((e as Error)?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]'));
  process.exitCode = 1;
});
