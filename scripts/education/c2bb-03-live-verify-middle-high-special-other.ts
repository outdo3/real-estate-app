// SCHOOL V2-C2B-B §5/§6/§7/§8/§10 — 중/고/특수/기타 실제 SchoolInfo OpenAPI 표본
// 검증(apiType=09 학년별·학급별 학생수, apiType=22 직위별 교원현황), 3년 이력
// 재확인. READ-ONLY, DB write 없음, SchoolStat ingestion 아님(검증 목적 개별 호출).
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync } from 'fs';

const KEY = process.env.SCHOOLINFO_API_KEY || '';
const BASE = 'http://www.schoolinfo.go.kr/openApi.do';
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

async function call(apiType: string, pbanYr: string, schulKndCode: string, sggCode: string) {
  const url = `${BASE}?apiKey=${KEY}&apiType=${apiType}&pbanYr=${pbanYr}&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sggCode}`;
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const raw: any[] = JSON.parse(readFileSync(`${SCRATCHPAD}\\schoolinfo-busan-universe.json`, 'utf-8'));

  // ── 표본 선정: 중학교 5(지역 분산), 고등학교 5(이름으로 유형 다양화 시도), 특수 2, 기타(각종/외국인 등) 2 ──
  const middleCandidates = raw.filter((r) => r.SCHUL_KND_SC_CODE === '03' && r.ABSCH_YN !== 'Y');
  const highCandidates = raw.filter((r) => r.SCHUL_KND_SC_CODE === '04' && r.ABSCH_YN !== 'Y');
  const specialCandidates = raw.filter((r) => r.SCHUL_KND_SC_CODE === '05' && r.ABSCH_YN !== 'Y');
  const otherCandidates = raw.filter((r) => !['02', '03', '04', '05'].includes(r.SCHUL_KND_SC_CODE) && r.ABSCH_YN !== 'Y');

  function pickSpread(list: any[], n: number) {
    const bySgg = new Map<string, any[]>();
    for (const r of list) bySgg.set(r.__sggCode, [...(bySgg.get(r.__sggCode) || []), r]);
    const picked: any[] = [];
    for (const [, rows] of bySgg) {
      if (picked.length >= n) break;
      picked.push(rows[0]);
    }
    return picked.slice(0, n);
  }

  const middleSample = pickSpread(middleCandidates, 5);
  const highSample = [
    highCandidates.find((r: any) => r.SCHUL_NM.includes('과학고')),
    highCandidates.find((r: any) => r.SCHUL_NM.includes('외국어고')),
    highCandidates.find((r: any) => r.SCHUL_NM.includes('공업고') || r.SCHUL_NM.includes('공고')),
    highCandidates.find((r: any) => r.FOND_SC_CODE === '사립'),
    highCandidates.find((r: any) => r.FOND_SC_CODE === '공립'),
  ].filter(Boolean);
  const specialSample = specialCandidates.slice(0, 2);
  const otherSample = otherCandidates.slice(0, 3);

  console.log('=== §5 중학교 표본(5, 지역분산) ===', middleSample.map((r: any) => `${r.SCHUL_NM}(${r.__sggName})`));
  console.log('=== §6 고등학교 표본(과학고/외고/공고/사립/공립) ===', highSample.map((r: any) => `${r.SCHUL_NM}(${r.FOND_SC_CODE})`));
  console.log('=== §7 특수 표본 ===', specialSample.map((r: any) => r.SCHUL_NM));
  console.log('=== §7 기타 표본 ===', otherSample.map((r: any) => `${r.SCHUL_NM}(kind=${r.SCHUL_KND_SC_CODE})`));

  console.log('\n\n### §5/§6/§7 apiType=09(학년별·학급별 학생수) 실측 ###');
  for (const [label, sample] of [['MIDDLE', middleSample], ['HIGH', highSample], ['SPECIAL', specialSample], ['OTHER', otherSample]] as const) {
    for (const r of sample as any[]) {
      const data = await call('09', '2025', r.SCHUL_KND_SC_CODE, r.__sggCode);
      const found = (data.list || []).find((x: any) => x.SCHUL_CODE === r.SCHUL_CODE);
      console.log(`[${label}] ${r.SCHUL_NM}: resultCode=${data.resultCode}`, found ? `COL_S_SUM=${found.COL_S_SUM} COL_C_SUM=${found.COL_C_SUM} TEACH_CNT=${found.TEACH_CNT} COL_SUM=${found.COL_SUM}` : 'NOT FOUND IN LIST(공시 비대상 가능성)');
      await new Promise((res) => setTimeout(res, 150));
    }
  }

  console.log('\n\n### §8 apiType=22(직위별 교원현황) 표본 검증 — 중/고 1건씩 ###');
  for (const r of [middleSample[0], highSample[0]].filter(Boolean) as any[]) {
    const data = await call('22', '2025', r.SCHUL_KND_SC_CODE, r.__sggCode);
    const found = (data.list || []).find((x: any) => x.SCHUL_CODE === r.SCHUL_CODE);
    console.log(`${r.SCHUL_NM}:`, found ? JSON.stringify(found) : `NOT FOUND, resultCode=${data.resultCode}`);
    await new Promise((res) => setTimeout(res, 150));
  }

  console.log('\n\n### §10 3년 이력 재검증(초/중/고/특수 각 1건) ###');
  const oneEach = [
    ['ELEMENTARY', raw.find((r) => r.SCHUL_KND_SC_CODE === '02' && r.ABSCH_YN !== 'Y')],
    ['MIDDLE', middleSample[0]],
    ['HIGH', highSample[0]],
    ['SPECIAL', specialSample[0]],
  ] as const;
  for (const [label, r] of oneEach) {
    if (!r) continue;
    for (const yr of ['2026', '2025', '2024', '2023']) {
      const data = await call('09', yr, r.SCHUL_KND_SC_CODE, r.__sggCode);
      console.log(`[${label}] ${r.SCHUL_NM} pbanYr=${yr} -> ${data.resultCode} ${data.resultMsg}`);
      await new Promise((res) => setTimeout(res, 150));
    }
  }
}

main().catch(console.error);
