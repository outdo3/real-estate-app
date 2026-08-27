/**
 * STATISTICS V2.1-2 — TRANSACTION ACTIVITY (실거래/거래량/거래집중) §46~§50.
 * run-statistics-v2-qa.ts / run-statistics-v2-1-price-ranking-qa.ts와 동일하게
 * 실행 중인 dev 서버의 라이브 API를 read-only(GET)로 호출해 응답 구조·계산
 * 정합성을 검사한다(DB 쿼리 없음, 쓰기 없음).
 *
 * 사용법:
 *   npx tsx scripts/run-statistics-v2-1-transaction-activity-qa.ts [옵션]
 *
 * 옵션:
 *   --quick       SIDO_ALL/추가 성능 측정 등 무거운 검사 생략(속도 우선)
 *   --json        tmp/qa/STATISTICS_V2_1_TRANSACTION_ACTIVITY_QA.json로 저장
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
  severity: 'P0_WRONG_REGION' | 'P0_INVALID_STAT' | 'P0_OVERCLAIM' | 'P1_DATA_GAP' | 'P1_PERFORMANCE' | 'INFO';
  screen: 'feed' | 'volume' | 'concentration' | 'static';
  region: string;
  detail: string;
}

const DISTRICTS = [
  { lawdCd: '26140', label: '부산 서구' },
  { lawdCd: '26470', label: '부산 연제구' },
];
const SIDOS = [
  { code: '26', label: '부산 전체' },
  { code: '11', label: '서울 전체' },
];

async function fetchJson(base: string, urlPath: string, params: Record<string, string>, timeoutMs = 30000): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${base}${urlPath}?${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { status: 'HTTP_ERROR', httpStatus: res.status };
    return res.json();
  } catch (e) {
    return { status: 'FETCH_ERROR', error: String(e) };
  }
}

async function main() {
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // ── A. FEED — 신고가 badge safety(§11/§20), 세대수/입주연도 배치 조회, mini trend 표본 규칙 ──
  for (const d of DISTRICTS) {
    const data = await fetchJson(OPT.base, '/api/stats/feed', { lawdCd: d.lawdCd, period: '12m', limit: '200' });
    if (data.status !== 'OK') {
      push({ severity: 'P1_DATA_GAP', screen: 'feed', region: d.label, detail: `feed 응답 status=${data.status}` });
      continue;
    }
    const allTrades = (data.groups || []).flatMap((g: any) => g.trades as any[]);

    // recordHighCoverageLabel이 반드시 존재하고, 무제한 "신고가" 단어가 아니라
    // bounded label을 쓰는지(§11) — 응답 필드 자체가 있는지만 구조적으로 확인.
    if (!data.recordHighCoverageLabel) {
      push({ severity: 'P0_OVERCLAIM', screen: 'feed', region: d.label, detail: 'recordHighCoverageLabel 필드 누락 — 신고가 badge가 bounded label 없이 표시될 위험' });
    }

    // 신고가로 표시된 거래는 반드시 changeAmount/previousTrade 계산 대상(비취소)이어야 한다.
    for (const t of allTrades) {
      if (t.isRecordHigh && t.dealCanceled) {
        push({ severity: 'P0_INVALID_STAT', screen: 'feed', region: d.label, detail: `취소거래가 신고가로 표시됨: ${t.name} ${t.dealDate}` });
      }
    }

    // mini trend 표본 규칙 — recentTrend이 있다면 반드시 3건 이상이어야 한다(§9).
    for (const t of allTrades) {
      if (t.recentTrend != null && t.recentTrend.length < 3) {
        push({ severity: 'P0_INVALID_STAT', screen: 'feed', region: d.label, detail: `mini trend 표본 규칙 위반(3건 미만인데 노출): ${t.name} ${t.dealDate}` });
      }
    }

    // 세대수/입주연도가 있다면 음수/0 같은 비정상 값이 아닌지.
    for (const t of allTrades) {
      if (t.totalHouseholds != null && t.totalHouseholds <= 0) {
        push({ severity: 'P1_DATA_GAP', screen: 'feed', region: d.label, detail: `totalHouseholds 비정상 값: ${t.name}=${t.totalHouseholds}` });
      }
    }

    console.log(`[feed:${d.label}] verifiedCount=${data.summary.verifiedCount} recordHigh=${data.summary.recordHighCount} coverageLabel=${data.recordHighCoverageLabel}`);
  }

  // ── B. VOLUME — 기간별 이전기간 비교 산술, sale/jeonse/wolse 분리, SIDO_ALL ──
  for (const d of DISTRICTS) {
    const data = await fetchJson(OPT.base, '/api/stats/dashboard', { lawdCd: d.lawdCd });
    if (!data.success) {
      push({ severity: 'P1_DATA_GAP', screen: 'volume', region: d.label, detail: `dashboard 응답 success=false` });
      continue;
    }
    const byPeriod = data.data?.volumeSummaryByPeriod;
    if (!byPeriod || !byPeriod['30d']) {
      push({ severity: 'P0_INVALID_STAT', screen: 'volume', region: d.label, detail: 'volumeSummaryByPeriod["30d"] 누락' });
      continue;
    }
    for (const preset of ['7d', '30d', '3m']) {
      const p = byPeriod[preset];
      if (!p) {
        push({ severity: 'P0_INVALID_STAT', screen: 'volume', region: d.label, detail: `volumeSummaryByPeriod["${preset}"] 누락` });
        continue;
      }
      for (const dt of ['sale', 'jeonse', 'wolse'] as const) {
        const m = p[dt];
        if (!m) { push({ severity: 'P0_INVALID_STAT', screen: 'volume', region: d.label, detail: `${preset}.${dt} 누락` }); continue; }
        if (m.changeCount !== m.currentCount - m.previousCount) {
          push({ severity: 'P0_INVALID_STAT', screen: 'volume', region: d.label, detail: `${preset}.${dt} changeCount 산술 불일치: current=${m.currentCount} previous=${m.previousCount} changeCount=${m.changeCount}` });
        }
        if (m.currentCount < 0 || m.previousCount < 0) {
          push({ severity: 'P0_INVALID_STAT', screen: 'volume', region: d.label, detail: `${preset}.${dt} 음수 거래량` });
        }
      }
    }
    console.log(`[volume:${d.label}] 30d.sale=${byPeriod['30d'].sale.currentCount}건(이전 ${byPeriod['30d'].sale.previousCount}건)`);
  }

  // ── C. CONCENTRATION — aptSeq/name+dong 그룹핑, 취소 제외, delta 산술, rank 정렬 ──
  for (const d of DISTRICTS) {
    const data = await fetchJson(OPT.base, '/api/stats/concentration', { lawdCd: d.lawdCd, period: '30d', dealType: 'sale' });
    if (data.status !== 'OK') {
      push({ severity: 'P1_DATA_GAP', screen: 'concentration', region: d.label, detail: `concentration 응답 status=${data.status}` });
      continue;
    }
    const entries = data.entries || [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].currentCount > entries[i - 1].currentCount) {
        push({ severity: 'P0_INVALID_STAT', screen: 'concentration', region: d.label, detail: `거래건수순 정렬 위반: rank${i} (${entries[i].currentCount}) > rank${i - 1} (${entries[i - 1].currentCount})` });
      }
      if (entries[i].rank !== i + 1) {
        push({ severity: 'P0_INVALID_STAT', screen: 'concentration', region: d.label, detail: `rank 불연속: index=${i} rank=${entries[i].rank}` });
      }
    }
    for (const e of entries) {
      if (e.deltaCount !== e.currentCount - e.previousCount) {
        push({ severity: 'P0_INVALID_STAT', screen: 'concentration', region: d.label, detail: `${e.name} deltaCount 산술 불일치` });
      }
      if (e.currentCount <= 0) {
        push({ severity: 'P0_INVALID_STAT', screen: 'concentration', region: d.label, detail: `${e.name} currentCount<=0인데 랭킹에 노출됨(취소만 있는 그룹이 새어나왔을 가능성)` });
      }
    }
    // §21 date-window: previousPeriod.to가 period.from 바로 하루 전이어야 한다(끊김/겹침 없음).
    if (data.previousPeriod && data.period) {
      const prevTo = new Date(`${data.previousPeriod.to}T00:00:00Z`).getTime();
      const curFrom = new Date(`${data.period.from}T00:00:00Z`).getTime();
      if (curFrom - prevTo !== 86400000) {
        push({ severity: 'P0_INVALID_STAT', screen: 'concentration', region: d.label, detail: `이전 기간과 현재 기간이 이어지지 않음: previousPeriod.to=${data.previousPeriod.to}, period.from=${data.period.from}` });
      }
    }
    console.log(`[concentration:${d.label}] complexCount=${data.complexCount} top1=${entries[0]?.name || '(없음)'}(${entries[0]?.currentCount ?? 0}건)`);
  }

  // ── D. SIDO_ALL — 부산/서울 전체 3화면 모두 ──
  if (!OPT.quick) {
    for (const s of SIDOS) {
      const t0 = Date.now();
      const feed = await fetchJson(OPT.base, '/api/stats/feed', { sidoCode: s.code, period: '7d', limit: '200' });
      const feedMs = Date.now() - t0;
      if (feed.status === 'OK') {
        if (feed.region?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', screen: 'feed', region: s.label, detail: 'sido-all인데 region.sidoAll !== true' });
        if (feedMs > 20000) push({ severity: 'P1_PERFORMANCE', screen: 'feed', region: s.label, detail: `feed sido-all 응답 ${feedMs}ms (20초 초과)` });
      } else {
        push({ severity: 'P1_DATA_GAP', screen: 'feed', region: s.label, detail: `feed sido-all 응답 status=${feed.status}` });
      }

      // volume(dashboard)은 기존부터(이번 STEP 이전부터) sido-all cold fetch가
      // 수십~100초대로 느릴 수 있다고 알려져 있다(§34) — 이번 STEP은 이미 fetch된
      // 12개월 데이터 위에서 순수 배열 연산만 추가했을 뿐 새 MonthTask를 추가하지
      // 않았으므로, 실측 목적상 넉넉한 타임아웃(120초)으로 "완주 가능한지"만
      // 확인하고 cold 시간 자체는 PERFORMANCE 경고로만 남긴다(BLOCKED 처리 안 함).
      const t1 = Date.now();
      const volume = await fetchJson(OPT.base, '/api/stats/dashboard', { sidoCode: s.code }, 120000);
      const volumeMs = Date.now() - t1;
      if (volume.success) {
        if (volume.data?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', screen: 'volume', region: s.label, detail: 'sido-all인데 data.sidoAll !== true' });
        if (volumeMs > 30000) push({ severity: 'P1_PERFORMANCE', screen: 'volume', region: s.label, detail: `volume sido-all 응답 ${volumeMs}ms(cold, §34 기존부터 알려진 한계 — 이번 STEP은 새 fetch를 추가하지 않음)` });
      } else {
        push({ severity: 'P1_DATA_GAP', screen: 'volume', region: s.label, detail: `volume sido-all 응답 success=false` });
      }

      const t2 = Date.now();
      const conc = await fetchJson(OPT.base, '/api/stats/concentration', { sidoCode: s.code, period: '30d', dealType: 'sale' }, 120000);
      const concMs = Date.now() - t2;
      if (conc.status === 'OK') {
        if (conc.region?.sidoAll !== true) push({ severity: 'P0_WRONG_REGION', screen: 'concentration', region: s.label, detail: 'sido-all인데 region.sidoAll !== true' });
        const distinctLawd = new Set((conc.entries || []).map((e: any) => e.lawdCd));
        if ((conc.entries || []).length > 5 && distinctLawd.size < 2) {
          push({ severity: 'P0_WRONG_REGION', screen: 'concentration', region: s.label, detail: `${conc.entries.length}개 단지인데 서로 다른 구가 ${distinctLawd.size}개뿐 — 실제 시도 전체 집계가 아닐 가능성` });
        }
        if (concMs > 30000) push({ severity: 'P1_PERFORMANCE', screen: 'concentration', region: s.label, detail: `concentration sido-all 응답 ${concMs}ms (30초 초과)` });
        if (conc.partial) push({ severity: 'P1_DATA_GAP', screen: 'concentration', region: s.label, detail: `partial=true: ${JSON.stringify(conc.failedDistricts)}` });
      } else {
        push({ severity: 'P1_DATA_GAP', screen: 'concentration', region: s.label, detail: `concentration sido-all 응답 status=${conc.status}` });
      }

      console.log(`[SIDO_ALL:${s.label}] feed=${feedMs}ms volume=${volumeMs}ms concentration=${concMs}ms`);
    }
  }

  // ── E. dong 필터(구 level) — 실거래/거래집중 둘 다 ──
  const dongFeed = await fetchJson(OPT.base, '/api/stats/feed', { lawdCd: '26470', dong: '거제동', period: '3m', limit: '200' });
  if (dongFeed.status === 'OK') {
    const wrong = (dongFeed.groups || []).flatMap((g: any) => g.trades).filter((t: any) => t.dong !== '거제동');
    if (wrong.length > 0) push({ severity: 'P0_WRONG_REGION', screen: 'feed', region: '부산 연제구 거제동', detail: `dong 필터에도 다른 동 거래 ${wrong.length}건` });
  }

  // ── F. NO DATA vs API ERROR 구분 — 실거래가 사실상 없을 극단적으로 짧은 기간(오늘)도 크래시 없이 OK ──
  const todayFeed = await fetchJson(OPT.base, '/api/stats/feed', { lawdCd: '26140', period: 'today', limit: '50' });
  if (todayFeed.status !== 'OK') {
    push({ severity: 'P1_DATA_GAP', screen: 'feed', region: '부산 서구', detail: `period=today 응답 status=${todayFeed.status}(no-data도 OK+summary.totalCount=0으로 와야 함)` });
  } else if (todayFeed.apiError === true && todayFeed.summary?.totalCount > 0) {
    push({ severity: 'P0_INVALID_STAT', screen: 'feed', region: '부산 서구', detail: 'apiError=true인데 거래 데이터가 존재 — API 실패와 거래없음이 혼동됨' });
  }

  // ── G. POPULARITY OVERCLAIM STATIC GUARD(§23/§49) — §23이 명시적으로 금지한
  // 문구("인기 1위"/"매수 선호 1위" 등)가 거래집중 화면 소스에 그대로 다시
  // 들어오지 않았는지 점검한다. 단순 단어("인기"/"선호") 매칭은 §23이 허용한
  // 정직한 disclaimer("~선호를 뜻하지 않아요")나 무관한 미래 기능(slug='popular',
  // 아직 'soon' 상태인 진짜 사용자-행동 인기 기능)까지 오탐하므로, 실제 금지된
  // 구체 문구만 정확히 매칭한다. ──
  const bannedPhrases = ['인기 1위', '가장 좋아하는 단지', '매수 선호 1위', '인기 급상승', '매수세가 몰립'];
  const overclaimGuardFiles = [
    'src/components/stats/ConcentrationView.tsx',
    'src/app/api/stats/concentration/route.ts',
  ];
  for (const rel of overclaimGuardFiles) {
    try {
      const content = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
      for (const phrase of bannedPhrases) {
        if (content.includes(phrase)) {
          push({ severity: 'P0_OVERCLAIM', screen: 'static', region: '(static guard)', detail: `${rel}에 금지된 overclaim 문구 "${phrase}" 발견(§23)` });
        }
      }
    } catch {
      push({ severity: 'P1_DATA_GAP', screen: 'static', region: '(static guard)', detail: `${rel} 파일을 읽지 못함` });
    }
  }
  // top-traded 메뉴 항목 자체가 다시 "인기"류 title로 되돌아가지 않았는지(이번
  // STEP의 핵심 rename)만 statsMenu.ts에서 좁혀서 확인한다 — 파일 전체가 아니라
  // 'top-traded' 줄 하나만 대상으로 해 §23과 무관한 slug='popular'(진짜 미래
  // 인기 기능, 아직 soon)를 오탐하지 않는다.
  try {
    const menuContent = fs.readFileSync(path.resolve(__dirname, '..', 'src/app/stats/statsMenu.ts'), 'utf8');
    const topTradedLine = menuContent.split('\n').find((l) => l.includes("slug: 'top-traded'"));
    if (topTradedLine && (topTradedLine.includes("title: '인기'") || topTradedLine.includes("colorToken: 'popular'"))) {
      push({ severity: 'P0_OVERCLAIM', screen: 'static', region: '(static guard)', detail: `statsMenu.ts의 top-traded 항목이 다시 "인기" title/popular 색상으로 회귀함` });
    }
  } catch {
    push({ severity: 'P1_DATA_GAP', screen: 'static', region: '(static guard)', detail: 'statsMenu.ts 파일을 읽지 못함' });
  }

  // ── H. FAKE PYEONG / UNSAFE RECORD-HIGH STATIC GUARD(§49, 기존 가드 재사용) ──
  const guardFiles = ['src/app/api/stats/concentration/route.ts', 'src/lib/regional-feed.ts'];
  for (const rel of guardFiles) {
    try {
      const content = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
      const offendingLines = content.split('\n').filter((line) => /\/\s*3\.3058/.test(line.split('//')[0]));
      if (offendingLines.length > 0) {
        push({ severity: 'P0_INVALID_STAT', screen: 'static', region: '(static guard)', detail: `${rel}에 /3.3058 fake-pyeong 계산 발견(${offendingLines.length}줄)` });
      }
    } catch {
      push({ severity: 'P1_DATA_GAP', screen: 'static', region: '(static guard)', detail: `${rel} 파일을 읽지 못함` });
    }
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  const p0 = (counts.P0_WRONG_REGION || 0) + (counts.P0_INVALID_STAT || 0) + (counts.P0_OVERCLAIM || 0);
  const releaseGate: 'READY' | 'LIMITED' | 'BLOCKED' = p0 > 0 ? 'BLOCKED' : (counts.P1_DATA_GAP || 0) + (counts.P1_PERFORMANCE || 0) > 3 ? 'LIMITED' : 'READY';

  console.log('\n=== FINDINGS ===');
  for (const f of findings) console.log(`[${f.severity}][${f.screen}] ${f.region}: ${f.detail}`);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log(`RELEASE GATE: ${releaseGate}`);

  if (OPT.json) {
    const outDir = path.resolve(__dirname, '../tmp/qa');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'STATISTICS_V2_1_TRANSACTION_ACTIVITY_QA.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), counts, releaseGate, findings }, null, 2)
    );
    console.log('\n(JSON: tmp/qa/STATISTICS_V2_1_TRANSACTION_ACTIVITY_QA.json)');
  }

  if (p0 > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
