/**
 * STATISTICS V2 — REGIONAL TRANSACTION FEED §46/§47. 이 기능은 persisted DB
 * table이 없고 전부 MOLIT 라이브 조회 기반이라(§3 감사 결과), QA도 DB 쿼리가
 * 아니라 실행 중인 dev 서버의 `/api/stats/feed`를 직접 호출해 응답 구조·계산
 * 정합성을 검사하는 방식으로 만든다(read-only — GET만 호출, 쓰기 없음).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-qa.ts [옵션]
 *
 * 옵션:
 *   --region=<lawdCd>   기본 부산 서구(26140)
 *   --district=<lawdCd> --region의 별칭
 *   --period=<preset>   기본 12m(신고가/직전거래 비교 표본을 넉넉히 확보하기 위해)
 *   --quick             fixture 단지 존재여부 검사 생략(속도 우선)
 *   --json              tmp/qa/STATISTICS_V2_QA.json로 저장
 *   --base=<url>        기본 http://localhost:3000
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
  region: flag('region') || flag('district') || '26140',
  period: flag('period') || '12m',
  quick: flag('quick') !== null,
  json: flag('json') !== null,
  base: flag('base') || 'http://localhost:3000',
};

interface Finding {
  severity: 'P0_WRONG_SCHOOL' | 'P0_WRONG_REGION' | 'P0_INVALID_STAT' | 'P1_DATA_GAP' | 'INFO';
  region: string;
  detail: string;
}

const FIXTURE_REGIONS: { lawdCd: string; label: string; apartments: string[] }[] = [
  { lawdCd: '26140', label: '부산 서구', apartments: ['대신롯데캐슬'] },
  { lawdCd: '26470', label: '부산 연제구', apartments: ['한솔솔파크', '일동미라주더스타'] },
  { lawdCd: '26350', label: '부산 해운대구', apartments: [] },
  { lawdCd: '11680', label: '서울 강남구', apartments: [] },
];

async function fetchFeed(base: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${base}/api/stats/feed?${qs}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
  return res.json();
}

async function main() {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  for (const fixture of FIXTURE_REGIONS) {
    const data = await fetchFeed(OPT.base, { lawdCd: fixture.lawdCd, period: OPT.period, limit: '200' });
    if (data.status !== 'OK') {
      push({ severity: data.status === 'HTTP_ERROR' ? 'P0_WRONG_REGION' : 'P1_DATA_GAP', region: fixture.label, detail: `feed 응답 status=${data.status || data.httpStatus}` });
      continue;
    }

    const allTrades = (data.groups || []).flatMap((g: any) => g.trades as any[]);

    // A. 지역/기간 경계 — 모든 거래가 요청한 lawdCd/기간에 속하는지(dong 필터는
    // 응답에 dong 원본 필드가 없어 여기선 생략, region 자체는 API가 lawdCd로
    // 조회했으므로 응답의 region.lawdCd 일치만 확인).
    if (data.region?.lawdCd !== fixture.lawdCd) {
      push({ severity: 'P0_WRONG_REGION', region: fixture.label, detail: `요청 lawdCd(${fixture.lawdCd}) != 응답 region.lawdCd(${data.region?.lawdCd})` });
    }
    for (const t of allTrades) {
      if (t.dealDate < data.period.from || t.dealDate > data.period.to) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `기간(${data.period.from}~${data.period.to}) 밖 거래 포함: ${t.name} ${t.dealDate}` });
      }
    }

    // B. 취소거래가 집계에 섞였는지.
    for (const t of allTrades) {
      if (t.dealCanceled && (t.isRecordHigh || t.changeAmount != null)) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `취소거래가 신고가/직전거래 비교에 포함됨: ${t.name} ${t.dealDate}` });
      }
    }

    // C. 중복 거래(동일 그룹+금액+날짜+층).
    const seen = new Set<string>();
    for (const t of allTrades) {
      const key = `${t.aptSeq || t.name + '|' + t.dong}|${t.excluUseArea}|${t.dealType}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}`;
      if (seen.has(key)) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `중복 거래 의심: ${t.name} ${t.dealDate} ${t.dealAmount}` });
      seen.add(key);
    }

    // D. 날짜 그룹 정합성 — 그룹 내림차순, 그룹 안 거래의 dealDate가 그룹 날짜와 일치.
    const dates = (data.groups || []).map((g: any) => g.date);
    for (let i = 1; i < dates.length; i++) {
      if (dates[i] >= dates[i - 1]) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `날짜 그룹이 내림차순이 아님: ${dates[i - 1]} -> ${dates[i]}` });
    }
    for (const g of data.groups || []) {
      for (const t of g.trades) {
        if (t.dealDate !== g.date) push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `그룹 날짜(${g.date})와 거래 dealDate(${t.dealDate}) 불일치: ${t.name}` });
      }
    }

    // E. 거래량 집계 정합성 — verifiedCount(비취소) 재계산 후 응답 summary와 비교.
    // (pagination으로 일부만 반환될 수 있어 total>=limit이면 스킵 — 정합성 확인은
    // 첫 페이지가 전체를 다 담는 짧은 기간에서만 100% 신뢰 가능.)
    if (!data.pagination.hasMore) {
      const recomputedVerified = allTrades.filter((t: any) => !t.dealCanceled).length;
      if (recomputedVerified !== data.summary.verifiedCount) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `verifiedCount 불일치: 응답=${data.summary.verifiedCount}, 재계산=${recomputedVerified}` });
      }
      const recomputedRecordHigh = allTrades.filter((t: any) => t.isRecordHigh).length;
      if (recomputedRecordHigh !== data.summary.recordHighCount) {
        push({ severity: 'P0_INVALID_STAT', region: fixture.label, detail: `recordHighCount 불일치: 응답=${data.summary.recordHighCount}, 재계산=${recomputedRecordHigh}` });
      }
    }

    // F. apartment 링크 안전성 — name/dong이 비어있는 row가 canonical 링크 생성에 쓰이면 위험.
    for (const t of allTrades) {
      if (!t.name || t.name === '이름 없음') {
        push({ severity: 'P1_DATA_GAP', region: fixture.label, detail: `단지명 미확보 거래 존재(링크 위험) — dealDate=${t.dealDate}` });
      }
    }

    // G. fixture 단지 존재 여부(정보성 — 특정 기간에 실거래가 없을 수 있어 실패로 보지 않음).
    if (!OPT.quick) {
      for (const aptName of fixture.apartments) {
        const found = allTrades.some((t: any) => t.name.includes(aptName));
        push({ severity: 'INFO', region: fixture.label, detail: `${aptName}: ${found ? '기간 내 실거래 발견' : `${OPT.period} 내 실거래 없음(정상일 수 있음)`}` });
      }
    }

    console.log(`[${fixture.label}] verifiedCount=${data.summary.verifiedCount} recordHigh=${data.summary.recordHighCount} rise=${data.summary.riseCount} fall=${data.summary.fallCount} cancelled=${data.summary.cancelledCount}`);
  }

  // H. period preset 전수 확인(서구 기준) — 크래시/구조 오류만 체크.
  const presets = ['today', 'yesterday', '7d', 'thisWeek', 'lastWeek', '30d', '12m'];
  for (const preset of presets) {
    const data = await fetchFeed(OPT.base, { lawdCd: '26140', period: preset, limit: '20' });
    if (data.status !== 'OK') {
      push({ severity: 'P1_DATA_GAP', region: '부산 서구', detail: `preset=${preset} 응답 status=${data.status}` });
    }
  }

  // I. dong 필터 확인.
  const dongData = await fetchFeed(OPT.base, { lawdCd: '26140', dong: '암남동', period: '30d', limit: '200' });
  if (dongData.status === 'OK') {
    const wrongDong = (dongData.groups || []).flatMap((g: any) => g.trades).filter((t: any) => t.dong !== '암남동');
    if (wrongDong.length > 0) push({ severity: 'P0_WRONG_REGION', region: '부산 서구 암남동', detail: `dong 필터 적용에도 다른 동 거래 ${wrongDong.length}건 포함` });
  }

  // J. STATISTICS REGION FILTER V2 — SIDO_ALL(부산/서울 전체) 검증.
  if (!OPT.quick) {
    for (const sido of [{ code: '26', label: '부산 전체' }, { code: '11', label: '서울 전체' }]) {
      const data = await fetchFeed(OPT.base, { sidoCode: sido.code, period: '7d', limit: '200' });
      if (data.status !== 'OK') {
        push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `sido-all 응답 status=${data.status}` });
        continue;
      }
      if (data.region?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: 'region.sidoAll이 true가 아님' });
      const allTrades = (data.groups || []).flatMap((g: any) => g.trades as any[]);
      // 시도 전체 집계에서는 거래마다 lawdCd가 채워져 있어야 canonical 단지
      // 링크가 가능하다(§25 요구사항) — 누락되면 잘못된/빈 링크로 이어질 위험.
      const missingLawdCd = allTrades.filter((t: any) => !t.lawdCd);
      if (missingLawdCd.length > 0) push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `${missingLawdCd.length}건 거래에 lawdCd 누락(canonical 링크 위험)` });
      // 시도 전체 aggregation에 여러 구가 실제로 섞여 있는지(단일 구만 응답하는
      // 위장 지원이 아닌지) 확인.
      const distinctLawdCds = new Set(allTrades.map((t: any) => t.lawdCd));
      if (allTrades.length > 20 && distinctLawdCds.size < 2) {
        push({ severity: 'P0_WRONG_REGION', region: sido.label, detail: `거래가 ${allTrades.length}건인데 서로 다른 구가 ${distinctLawdCds.size}개뿐 — 실제 시도 전체 집계가 아닐 가능성` });
      }
      if (data.partial) push({ severity: 'P1_DATA_GAP', region: sido.label, detail: `일부 지역 조회 실패(partial=true): ${JSON.stringify(data.failedDistricts)}` });
      console.log(`[${sido.label}] verifiedCount=${data.summary.verifiedCount} distinctDistricts=${distinctLawdCds.size} partial=${data.partial}`);
    }
  }

  // K. FAKE PYEONG STATIC GUARD — statistics/실거래 관련 live route 소스에
  // `exclusiveArea/3.3058` 같은 가짜 대표평형 계산이 다시 들어오지 않았는지
  // 정적으로 점검한다. 무관한 정상 sqm 변환(예: 카카오 지도 반경 계산)까지
  // 오탐하지 않도록 검사 대상을 실제 statistics 라우트 파일로 좁힌다.
  const guardFiles = [
    'src/app/api/stats/rankings/route.ts',
    'src/app/api/stats/dashboard/route.ts',
    'src/app/api/transactions/route.ts',
    'src/lib/regional-feed.ts',
  ];
  for (const rel of guardFiles) {
    try {
      const content = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
      // 주석 안의 설명("예전에는 /3.3058를 썼다")까지 오탐하지 않도록, 그 줄에서
      // `//` 이전(실제 코드 부분)만 검사 대상으로 삼는다.
      const offendingLines = content.split('\n').filter((line) => {
        const codePart = line.split('//')[0];
        return /\/\s*3\.3058/.test(codePart);
      });
      if (offendingLines.length > 0) {
        push({ severity: 'P0_INVALID_STAT', region: '(static guard)', detail: `${rel}에 /3.3058 fake-pyeong 계산이 남아있음(${offendingLines.length}줄)` });
      }
    } catch {
      push({ severity: 'P1_DATA_GAP', region: '(static guard)', detail: `${rel} 파일을 읽지 못함(경로 확인 필요)` });
    }
  }

  // L. UNIT MASTER COLLISION — 대신롯데캐슬의 84.7855㎡/84.9950㎡가 서로 다른
  // raw area로 유지되면서도(병합 없음) 각각 신뢰 가능한 평형을 얻는지 확인.
  if (!OPT.quick) {
    try {
      const res = await fetch(`${OPT.base}/api/transactions?type=apt&lawdCd=26140&months=12`, { signal: AbortSignal.timeout(30000) });
      const items = res.ok ? await res.json() : [];
      const target = (Array.isArray(items) ? items : []).filter((i: any) => i.name && i.name.includes('대신롯데캐슬'));
      const areas = new Set(target.map((i: any) => i.areaNum));
      if (areas.size >= 2) {
        push({ severity: 'INFO', region: '대신롯데캐슬', detail: `raw area ${areas.size}종 확인, 병합되지 않고 유지됨: ${Array.from(areas).join(', ')}` });
      }
      for (const i of target) {
        if (i.pyung != null && i.areaNum != null) {
          const fakePyung = Math.round(i.areaNum / 3.3058);
          // 실제 신뢰 가능한 평형이 fake 계산과 다르면(이번 실측: 26 vs 34) 이는
          // Unit Master를 실제로 쓰고 있다는 강한 증거 — 우연히 같아도 실패로 보지 않는다.
          if (i.pyung !== fakePyung) {
            push({ severity: 'INFO', region: '대신롯데캐슬', detail: `${i.areaNum}㎡ → 신뢰 평형 ${i.pyung}평(가짜 계산이었다면 ${fakePyung}평) — Unit Master 사용 확인` });
          }
        }
      }
    } catch (e) {
      push({ severity: 'P1_DATA_GAP', region: '대신롯데캐슬', detail: `Unit Master collision 확인 실패: ${e}` });
    }
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_SCHOOL || 0) + (counts.P0_WRONG_REGION || 0) + (counts.P0_INVALID_STAT || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}] ${f.region}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'STATISTICS_V2_QA.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, releaseGate, findings }, null, 2));
    console.log('\n(JSON: tmp/qa/STATISTICS_V2_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
