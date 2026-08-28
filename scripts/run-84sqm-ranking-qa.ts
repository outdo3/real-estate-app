/**
 * 84SQM_RANKING_V1 §46 AUTOMATED QA — /api/stats/price-rankings?mode=area84가
 * 실제 데이터에서도 계약대로 동작하는지 확인하는 read-only 통합 QA.
 * 계산 로직 자체(band 경계, tie-break, exact area 보존, 직전거래/2년최고가
 * 비교)는 src/lib/price-ranking.test.ts(46개 단위 테스트, area84 16개 포함)로
 * 이미 검증돼 있다 — 이 스크립트는 그 로직이 라이브 API에 올바르게 연결됐는지만
 * 확인한다(run-statistics-v2-1-price-ranking-qa.ts와 동일 관례).
 *
 * 사용법:
 *   npx tsx scripts/run-84sqm-ranking-qa.ts [옵션]
 *
 * 옵션:
 *   --json        tmp/qa/84SQM_RANKING_QA.json로 저장
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

const FIXTURE_DISTRICTS = [
  { lawdCd: '26140', label: '부산 서구' },
  { lawdCd: '26470', label: '부산 연제구' },
  { lawdCd: '26350', label: '부산 해운대구' },
  { lawdCd: '26260', label: '부산 동래구' },
  { lawdCd: '11680', label: '서울 강남구' },
];

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
    const started = Date.now();
    const data = await fetchRanking(OPT.base, { mode: 'area84', lawdCd: d.lawdCd, period: '12m', limit: '100' });
    const elapsedMs = Date.now() - started;
    if (data.status !== 'OK') {
      push({ severity: 'P0_WRONG_REGION', region: d.label, detail: `응답 status=${data.status || data.httpStatus}` });
      continue;
    }
    const rows = data.rows as any[];
    console.log(`[${d.label}] total=${data.pagination.total} rows=${rows.length} elapsedMs=${elapsedMs} summary=${JSON.stringify(data.summary)}`);

    // 1. canceled excluded — API는 취소 여부를 노출하지 않지만, buildHistory가
    // filterVerifiedTrades를 거친 trades만 쓰므로 rows에 취소 거래가 섞일 수
    // 없다(단위 테스트로 이미 검증). 여기서는 응답 자체의 정합성만 재확인한다.

    // 2. area band — 모든 row가 84 이상 85 미만이어야 한다.
    for (const r of rows) {
      if (r.excluUseArea == null || r.excluUseArea < 84 || r.excluUseArea >= 85) {
        push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `band 밖 row: ${r.name} excluUseArea=${r.excluUseArea}` });
      }
    }

    // 3. exact raw area preserved — 정수/반올림된 값(84, 84.5 같은 "너무 딱 떨어지는"
    // 값만 반복되면 의심)이 아니라 실제 MOLIT 소수점 원본이 그대로 노출되는지 표본 확인.
    const roundish = rows.filter((r) => Number.isInteger(r.excluUseArea * 100) && r.excluUseArea * 10000 % 100 === 0);
    if (rows.length > 5 && roundish.length === rows.length) {
      push({ severity: 'P1_DATA_GAP', region: d.label, detail: '모든 row의 excluUseArea가 정수/반올림값처럼 보임 — raw area 보존 여부 재확인 필요' });
    }

    // 4. one row per apartment — complexKey 중복 없어야 한다.
    const complexKeys = rows.map((r) => r.complexKey);
    if (new Set(complexKeys).size !== complexKeys.length) {
      push({ severity: 'P0_INVALID_STAT', region: d.label, detail: '같은 단지(complexKey)가 두 번 이상 등장' });
    }

    // 5. ranking DESC — 기본 정렬(가격순)일 때 currentAmount가 내림차순인지.
    if (data.sort === 'price') {
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].currentAmount > rows[i - 1].currentAmount) {
          push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `가격 내림차순 위반: ${rows[i - 1].currentAmount} -> ${rows[i].currentAmount}` });
          break;
        }
      }
    }

    // 6. same-area previous trade — previousAmount가 있으면 changeAmount 공식 일치.
    for (const r of rows) {
      if (r.previousAmount != null) {
        if (r.currentAmount - r.previousAmount !== r.changeAmount) {
          push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `changeAmount 공식 불일치: ${r.name}` });
        }
      } else if (r.changeAmount != null) {
        push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `previousAmount 없는데 changeAmount만 존재: ${r.name}` });
      }
    }

    // 7. 2-year claim wording — "역대"/"신고가" 같은 무제한 표현 금지.
    for (const r of rows) {
      if (r.interpretation && (r.interpretation.includes('역대') || r.interpretation.includes('신고가'))) {
        push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `무제한 표현 잔존: ${r.name} - ${r.interpretation}` });
      }
    }
    if (!data.historicalHighCoverageLabel) {
      push({ severity: 'P0_INVALID_STAT', region: d.label, detail: 'historicalHighCoverageLabel 누락' });
    }

    // 8. fake pyeong 정적 가드 — pyung이 exclusiveArea/3.3058 반올림과 우연히 같으면 INFO.
    for (const r of rows) {
      if (r.pyung != null && r.excluUseArea != null) {
        const fake = Math.round(r.excluUseArea / 3.3058);
        if (r.pyung === fake) {
          push({ severity: 'INFO', region: d.label, detail: `${r.name} pyung(${r.pyung})이 fake 계산과 우연히 동일 — Unit Master 값인지 별도 확인 권장` });
        }
      }
    }

    // 9. canonical link 안전성 — name/lawdCd 누락 row 없어야 함.
    for (const r of rows) {
      if (!r.name || !r.lawdCd) push({ severity: 'P0_WRONG_APARTMENT', region: d.label, detail: `canonical 링크 필드 누락: ${JSON.stringify(r).slice(0, 80)}` });
    }

    // 10. 세대수/준공연도 — 존재할 때 타입이 올바른지만 확인(없으면 null 허용, §17).
    for (const r of rows) {
      if (r.totalHouseholds != null && typeof r.totalHouseholds !== 'number') {
        push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `totalHouseholds 타입 이상: ${r.name}` });
      }
    }

    // 11. areaBand 응답 필드.
    if (!data.areaBand || data.areaBand.min !== 84 || data.areaBand.max !== 85) {
      push({ severity: 'P0_INVALID_STAT', region: d.label, detail: `areaBand 응답 불일치: ${JSON.stringify(data.areaBand)}` });
    }
  }

  // 12. sido-all region filter — 여러 구가 섞여 있는지, partial 계약.
  for (const sido of [{ code: '26', label: '부산 전체' }]) {
    const data = await fetchRanking(OPT.base, { mode: 'area84', sidoCode: sido.code, period: '12m', limit: '50' });
    if (data.status !== 'OK') {
      push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `sido-all 응답 status=${data.status}` });
    } else {
      if (data.region?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: 'region.sidoAll이 true가 아님' });
      const distinctLawdCds = new Set(data.rows.map((r: any) => r.lawdCd));
      if (data.rows.length > 5 && distinctLawdCds.size < 2) {
        push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `${data.rows.length}건인데 서로 다른 구가 ${distinctLawdCds.size}개뿐` });
      }
      const missingSigunguName = data.rows.filter((r: any) => !r.sigunguName);
      if (missingSigunguName.length > 0) push({ severity: 'P1_DATA_GAP', region: sido.label, detail: `${missingSigunguName.length}건 sigunguName 누락` });
      if (typeof data.partial !== 'boolean') push({ severity: 'P1_DATA_GAP', region: sido.label, detail: 'partial 필드 누락' });
      console.log(`[${sido.label}] total=${data.pagination.total} distinctDistricts=${distinctLawdCds.size} partial=${data.partial} regionInterpretation=${data.regionInterpretation}`);
    }
  }

  // 13. 대신롯데캐슬 collision spot-check(있으면) — 같은 단지, 다른 raw area가 별도로
  // 병합되지 않고 대표 거래 1건만 남는지(§8/§45).
  const seogu = await fetchRanking(OPT.base, { mode: 'area84', lawdCd: '26140', period: '24m', limit: '100' });
  if (seogu.status === 'OK') {
    const target = seogu.rows.filter((r: any) => r.name.includes('대신롯데캐슬'));
    if (target.length > 1) push({ severity: 'P0_INVALID_STAT', region: '대신롯데캐슬', detail: `단지당 1건 원칙 위반 — ${target.length}건 노출` });
    else if (target.length === 1) push({ severity: 'INFO', region: '대신롯데캐슬', detail: `대표 거래 1건만 노출 확인, excluUseArea=${target[0].excluUseArea}` });
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_APARTMENT || 0) + (counts.P0_INVALID_STAT || 0) + (counts.P0_WRONG_REGION || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}] ${f.region}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, '84SQM_RANKING_QA.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, releaseGate, findings }, null, 2));
    console.log('\n(JSON: tmp/qa/84SQM_RANKING_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
