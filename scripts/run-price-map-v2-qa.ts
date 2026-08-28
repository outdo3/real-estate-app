/**
 * REGION_PRICE_CHANGE_MAP_V2 §48 AUTOMATED QA — /api/stats/region-change가
 * 실제 데이터에서도 계약대로 동작하는지 확인하는 read-only 통합 QA.
 * 계산 로직 자체(pairing, composition-bias guard, median 집계, 표본 threshold,
 * 대표 면적 선택 등)는 src/lib/region-change.test.ts(22개 단위 테스트)로 이미
 * 검증돼 있다 — 이 스크립트는 그 로직이 라이브 API에 올바르게 연결됐는지만
 * 확인한다(run-84sqm-ranking-qa.ts와 동일 관례).
 *
 * 사용법:
 *   npx tsx scripts/run-price-map-v2-qa.ts [옵션]
 *
 * 옵션:
 *   --json        tmp/qa/PRICE_MAP_V2_QA.json로 저장
 *   --base=<url>  기본 http://localhost:3000
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
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_WRONG_APARTMENT' | 'P0_INVALID_STAT' | 'P0_WRONG_REGION' | 'P1_DATA_GAP' | 'INFO';
  region: string;
  detail: string;
}

async function get(base: string, qs: string): Promise<any> {
  const res = await fetch(`${base}/api/stats/region-change?${qs}`, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
  return res.json();
}

async function main() {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);
  const callBudgetLog: string[] = [];

  // 1. level=nation — 시도 목록.
  const started0 = Date.now();
  const nation = await get(OPT.base, 'level=nation');
  callBudgetLog.push(`[level=nation] elapsedMs=${Date.now() - started0}`);
  if (nation.status !== 'OK' || !Array.isArray(nation.sidos) || nation.sidos.length < 10) {
    push({ severity: 'P0_WRONG_REGION', region: '전국', detail: `level=nation 응답 이상: ${JSON.stringify(nation).slice(0, 200)}` });
  }

  // 2. level=sigungu — 부산/서울(2). 최소 2개 시군구 이상 다른 lawdCd를 갖는지, N+1 없이 고정 응답인지.
  const FIXTURE_SIDOS = [
    { sidoCode: '26', label: '부산' },
    { sidoCode: '11', label: '서울' },
  ];
  for (const sido of FIXTURE_SIDOS) {
    const started = Date.now();
    const data = await get(OPT.base, `level=sigungu&sidoCode=${sido.sidoCode}&period=3m`);
    const elapsedMs = Date.now() - started;
    callBudgetLog.push(`[level=sigungu sido=${sido.label}] elapsedMs=${elapsedMs} callBudget=${JSON.stringify(data.callBudget)}`);
    if (data.status !== 'OK') {
      push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `level=sigungu 응답 status=${data.status}` });
      continue;
    }
    if (!Array.isArray(data.districts) || data.districts.length < 2) {
      push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `구/군 목록이 비정상: ${data.districts?.length}개` });
    }
    // no all-time claim — "역대"/"신고가"/"전망"/"추천" 등 금지 표현.
    const banned = ['역대', '신고가', '전망', '추천', '투자 기회'];
    if (data.interpretation) {
      for (const w of banned) {
        if (data.interpretation.includes(w)) push({ severity: 'P0_INVALID_STAT', region: sido.label, detail: `금지 표현("${w}") 포함: ${data.interpretation}` });
      }
    }
    // neutral threshold — |medianPct| <= 0.5면 direction은 반드시 neutral.
    for (const d of data.districts) {
      if (d.medianPct != null && Math.abs(d.medianPct) <= 0.5 && d.direction !== 'neutral') {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `neutral 경계 위반: medianPct=${d.medianPct} direction=${d.direction}` });
      }
      if (d.medianPct != null && Math.abs(d.medianPct) > 0.5 && d.direction === 'neutral') {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `neutral 경계 위반(반대): medianPct=${d.medianPct} direction=neutral` });
      }
      // sample threshold — pairCount < minSamplePairs이면 medianPct는 반드시 null.
      if (d.pairCount < data.minSamplePairs && d.medianPct != null) {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `표본 부족인데 medianPct 노출: pairCount=${d.pairCount} medianPct=${d.medianPct}` });
      }
      if (d.pairCount >= data.minSamplePairs && d.confidence === 'INSUFFICIENT') {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `표본 충분한데 confidence=INSUFFICIENT: pairCount=${d.pairCount}` });
      }
      // color mapping — direction과 up/down 부호 일치.
      if (d.direction === 'up' && d.medianPct != null && d.medianPct <= 0.5) {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `direction=up인데 medianPct<=0.5: ${d.medianPct}` });
      }
      if (d.direction === 'down' && d.medianPct != null && d.medianPct >= -0.5) {
        push({ severity: 'P0_INVALID_STAT', region: `${sido.label}/${d.label}`, detail: `direction=down인데 medianPct>=-0.5: ${d.medianPct}` });
      }
    }
    // N+1 없음 — callBudget.districtsFetched는 구/군 수와 일치(요청당 1회 fetch).
    if (data.callBudget?.districtsFetched !== data.districts.length) {
      push({ severity: 'P1_DATA_GAP', region: sido.label, detail: `callBudget.districtsFetched(${data.callBudget?.districtsFetched}) != districts.length(${data.districts.length})` });
    }
  }

  // 3. level=sigungu — 부산 대표 QA 구(서구/해운대구/연제구/동래구)가 districts 배열에 실제 존재하는지 boundary QA.
  const busan = await get(OPT.base, 'level=sigungu&sidoCode=26&period=3m');
  if (busan.status === 'OK') {
    const names = new Set((busan.districts || []).map((d: any) => d.label));
    for (const name of ['서구', '해운대구', '연제구', '동래구']) {
      if (!names.has(name)) push({ severity: 'P0_WRONG_REGION', region: '부산', detail: `districts 목록에 ${name} 없음(boundary QA 실패)` });
    }
  }

  // 4. level=dong — 부산 서구(동 breakdown). same-area/composition-bias는 단위 테스트로 커버, 여기서는 배선만 확인.
  const started1 = Date.now();
  const dong = await get(OPT.base, 'level=dong&lawdCd=26140&period=3m');
  callBudgetLog.push(`[level=dong 서구] elapsedMs=${Date.now() - started1} callBudget=${JSON.stringify(dong.callBudget)}`);
  if (dong.status !== 'OK' || !Array.isArray(dong.dongs) || dong.dongs.length === 0) {
    push({ severity: 'P0_WRONG_REGION', region: '부산 서구', detail: `level=dong 응답 이상` });
  } else {
    if (dong.sigunguName !== '서구') push({ severity: 'P0_WRONG_REGION', region: '부산 서구', detail: `sigunguName 불일치: ${dong.sigunguName}` });
  }

  // 5. level=complex — 부산 서구 암남동(단지 목록). exact area 보존 + same-area 원칙 spot check.
  const started2 = Date.now();
  const complex = await get(OPT.base, `level=complex&lawdCd=26140&dong=${encodeURIComponent('암남동')}&period=3m&limit=50`);
  callBudgetLog.push(`[level=complex 서구/암남동] elapsedMs=${Date.now() - started2}`);
  if (complex.status !== 'OK') {
    push({ severity: 'P0_WRONG_REGION', region: '부산 서구 암남동', detail: `level=complex 응답 이상` });
  } else {
    for (const r of complex.rows || []) {
      if (!r.name || !r.lawdCd) push({ severity: 'P0_WRONG_APARTMENT', region: '암남동', detail: `canonical 필드 누락: ${JSON.stringify(r).slice(0, 80)}` });
      // exact raw area preserved — 정수/반올림 의심 패턴만 아니면 통과(정보성).
      if (Number.isInteger(r.excluUseArea)) push({ severity: 'INFO', region: '암남동', detail: `${r.name} excluUseArea가 정수값(${r.excluUseArea}) — 실제 MOLIT 원본인지 참고` });
      // changePct 공식 일치.
      const expected = Math.round(((r.currentAmount - r.baselineAmount) / r.baselineAmount) * 1000) / 10;
      if (Math.abs(expected - r.changePct) > 0.15) {
        push({ severity: 'P0_INVALID_STAT', region: '암남동', detail: `changePct 공식 불일치: ${r.name} expected=${expected} actual=${r.changePct}` });
      }
    }
    // 단지당 1행 — complexKey 중복 없음.
    const keys = (complex.rows || []).map((r: any) => r.complexKey);
    if (new Set(keys).size !== keys.length) push({ severity: 'P0_INVALID_STAT', region: '암남동', detail: '같은 단지(complexKey)가 두 번 이상 등장' });
  }

  // 6. URL state / share params — 이 스크립트는 서버 API만 검증(클라이언트 URL state는 코드 레벨로 보장,
  // 라이브 브라우저 QA에서 확인 완료). share 관련은 기존 ShareAction 재사용이라 별도 API 없음(INFO만 기록).
  push({ severity: 'INFO', region: 'share', detail: 'ShareAction/URL state는 기존 공통 컴포넌트 재사용 — 브라우저 QA로 별도 확인(문서 참고)' });

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_APARTMENT || 0) + (counts.P0_INVALID_STAT || 0) + (counts.P0_WRONG_REGION || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('=== CALL BUDGET LOG ===');
  for (const l of callBudgetLog) console.log(l);
  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}] ${f.region}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'PRICE_MAP_V2_QA.json'), JSON.stringify({ generatedAt: new Date().toISOString(), callBudgetLog, counts, releaseGate, findings }, null, 2));
    console.log('\n(JSON: tmp/qa/PRICE_MAP_V2_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
