/**
 * STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING §43. 계산 로직 자체(같은
 * aptSeq+같은 raw area, 시간순 이전 최고가/직전거래, 취소거래 제외, 미래거래
 * 누출 없음)는 이미 `src/lib/price-ranking.test.ts`(27개 단위 테스트)로
 * 검증돼 있다 — 이 스크립트는 그 로직이 실제 라이브 API(`/api/stats/
 * price-rankings`)에 올바르게 연결됐는지, 시도 전체 집계/canonical 링크/
 * 중복/정렬이 실제 데이터에서도 성립하는지를 확인하는 통합 QA다(read-only,
 * GET만 호출).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-1-price-ranking-qa.ts [옵션]
 *
 * 옵션:
 *   --quick   시도 전체(부산/서울) 검사 생략(속도 우선, 단일 구만 확인)
 *   --json    tmp/qa/STATISTICS_V2_1_PRICE_RANKING_QA.json로 저장
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
  quick: flag('quick') !== null,
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_WRONG_APARTMENT' | 'P0_INVALID_STAT' | 'P0_WRONG_REGION' | 'P1_DATA_GAP' | 'INFO';
  region: string;
  mode: string;
  detail: string;
}

const FIXTURE_DISTRICTS = [
  { lawdCd: '26140', label: '부산 서구' },
  { lawdCd: '26470', label: '부산 연제구' },
  { lawdCd: '26350', label: '부산 해운대구' },
  { lawdCd: '11680', label: '서울 강남구' },
];
const MODES = ['decline', 'record-high', 'rising'] as const;

async function fetchRanking(base: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/api/stats/price-rankings?${qs}`, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
  return res.json();
}

async function main() {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  for (const d of FIXTURE_DISTRICTS) {
    for (const mode of MODES) {
      const data = await fetchRanking(OPT.base, { mode, lawdCd: d.lawdCd, period: '30d', limit: '100' });
      if (data.status !== 'OK') {
        push({ severity: 'P0_WRONG_REGION', region: d.label, mode, detail: `응답 status=${data.status || data.httpStatus}` });
        continue;
      }
      const rows = data.rows as any[];

      // A. same-area grouping — 같은 aptSeq라도 raw area가 다르면 groupKey가
      // 달라야 한다(다른 면적을 하나로 합치지 않음).
      for (const r of rows) {
        if (r.aptSeq && r.excluUseArea != null) {
          const expectedPrefix = `id:${r.aptSeq}::${r.excluUseArea}::sale`;
          if (r.groupKey !== expectedPrefix) {
            push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `groupKey 불일치: ${r.groupKey} (기대: ${expectedPrefix})` });
          }
        }
      }

      // B. decline formula — declineAmount = currentAmount - priorHighAmount, declinePct 부호 일치.
      if (mode === 'decline') {
        for (const r of rows) {
          if (r.currentAmount - r.priorHighAmount !== r.declineAmount) {
            push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `declineAmount 공식 불일치: ${r.name}` });
          }
          if (r.declineAmount >= 0) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `하락 row인데 declineAmount>=0: ${r.name}` });
          if (r.currentAmount >= r.priorHighAmount) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `현재가가 이전 최고가 이상인데 하락 row: ${r.name}` });
        }
      }

      // C. record-high correctness — currentAmount > priorHighAmount 항상 성립, 이전 최고가 없는 row 없음.
      if (mode === 'record-high') {
        for (const r of rows) {
          if (!(r.currentAmount > r.priorHighAmount)) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `신고가 조건 위반(현재<=이전최고가): ${r.name}` });
          if (r.priorHighAmount == null) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `이전 최고가 없이 신고가 판정됨: ${r.name}` });
        }
      }

      // D. rising chronology — currentDate > previousDate, riseAmount = current - previous.
      if (mode === 'rising') {
        for (const r of rows) {
          if (r.currentDate < r.previousDate) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `상승 row인데 currentDate가 previousDate보다 이름: ${r.name}` });
          if (r.currentAmount - r.previousAmount !== r.riseAmount) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `riseAmount 공식 불일치: ${r.name}` });
          if (r.riseAmount <= 0) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `상승 row인데 riseAmount<=0: ${r.name}` });
        }
      }

      // E. fake pyeong 정적 가드 — pyung이 null이거나, 있으면 exclusiveArea/3.3058 반올림과 다를 수 있음(실제 Unit Master 값인지는 별도 확인).
      for (const r of rows) {
        if (r.pyung != null && r.excluUseArea != null) {
          const fake = Math.round(r.excluUseArea / 3.3058);
          if (r.pyung === fake) {
            // 우연히 같을 수도 있으나(예: 정확히 3.3058 배수), 다수 발생하면 의심 대상 — INFO로만 남긴다.
            push({ severity: 'INFO', region: d.label, mode, detail: `${r.name} pyung(${r.pyung})이 fake 계산과 우연히 동일 — Unit Master 값인지 별도 확인 권장` });
          }
        }
      }

      // F. duplicate rows — 동일 groupKey+currentDate 중복 없어야 함(record-high는 같은 그룹에서 여러 날짜 가능하므로 날짜까지 포함).
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.groupKey}|${r.currentDate}|${r.currentAmount}`;
        if (seen.has(key)) push({ severity: 'P0_INVALID_STAT', region: d.label, mode, detail: `중복 row 의심: ${r.name} ${r.currentDate}` });
        seen.add(key);
      }

      // G. canonical apartment link 안전성 — lawdCd/name 비어있는 row 없어야 함.
      for (const r of rows) {
        if (!r.name || !r.lawdCd) push({ severity: 'P0_WRONG_APARTMENT', region: d.label, mode, detail: `canonical 링크에 필요한 name/lawdCd 누락: ${JSON.stringify(r).slice(0, 80)}` });
      }

      console.log(`[${d.label}/${mode}] total=${data.pagination.total} rows=${rows.length}`);
    }
  }

  // H. 정렬 정확성 — 각 모드 기본 정렬 방향 확인(부산 서구, decline 기준).
  const declineSorted = await fetchRanking(OPT.base, { mode: 'decline', lawdCd: '26140', period: '30d', sort: 'declineRate', limit: '50' });
  if (declineSorted.status === 'OK') {
    const pcts = declineSorted.rows.map((r: any) => r.declinePct);
    for (let i = 1; i < pcts.length; i++) {
      if (pcts[i] < pcts[i - 1]) push({ severity: 'P0_INVALID_STAT', region: '부산 서구', mode: 'decline', detail: `declineRate 정렬 위반: ${pcts[i - 1]} -> ${pcts[i]}` });
    }
  }

  // I. 대신롯데캐슬 Unit Master collision — 84.7855㎡/84.9950㎡ 별도 유지.
  const declineAll = await fetchRanking(OPT.base, { mode: 'decline', lawdCd: '26140', period: '12m', limit: '100' });
  if (declineAll.status === 'OK') {
    const target = declineAll.rows.filter((r: any) => r.name.includes('대신롯데캐슬'));
    const areas = new Set(target.map((r: any) => r.excluUseArea));
    if (areas.size >= 2) push({ severity: 'INFO', region: '대신롯데캐슬', mode: 'decline', detail: `raw area ${areas.size}종 별도 유지 확인: ${Array.from(areas).join(', ')}` });
  }

  // J. 시도 전체(부산/서울) — 실제 여러 구가 섞여 있는지, partial 필드 존재.
  if (!OPT.quick) {
    for (const sido of [{ code: '26', label: '부산 전체' }, { code: '11', label: '서울 전체' }]) {
      for (const mode of MODES) {
        const data = await fetchRanking(OPT.base, { mode, sidoCode: sido.code, period: '30d', limit: '50' });
        if (data.status !== 'OK') {
          push({ severity: 'P0_WRONG_REGION', region: sido.label, mode, detail: `sido-all 응답 status=${data.status}` });
          continue;
        }
        if (data.region?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', region: sido.label, mode, detail: 'region.sidoAll이 true가 아님' });
        const distinctLawdCds = new Set(data.rows.map((r: any) => r.lawdCd));
        if (data.rows.length > 5 && distinctLawdCds.size < 2) {
          push({ severity: 'P0_WRONG_REGION', region: sido.label, mode, detail: `${data.rows.length}건인데 서로 다른 구가 ${distinctLawdCds.size}개뿐` });
        }
        const missingSigunguName = data.rows.filter((r: any) => !r.sigunguName);
        if (missingSigunguName.length > 0) push({ severity: 'P1_DATA_GAP', region: sido.label, mode, detail: `${missingSigunguName.length}건 sigunguName 누락(구+동 표시 불가)` });
        if (typeof data.partial !== 'boolean') push({ severity: 'P1_DATA_GAP', region: sido.label, mode, detail: 'partial 필드 누락(부분 실패 계약 위반)' });
        console.log(`[${sido.label}/${mode}] total=${data.pagination.total} distinctDistricts=${distinctLawdCds.size} partial=${data.partial}`);
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_APARTMENT || 0) + (counts.P0_INVALID_STAT || 0) + (counts.P0_WRONG_REGION || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}] ${f.region}/${f.mode}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'STATISTICS_V2_1_PRICE_RANKING_QA.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, releaseGate, findings }, null, 2));
    console.log('\n(JSON: tmp/qa/STATISTICS_V2_1_PRICE_RANKING_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
