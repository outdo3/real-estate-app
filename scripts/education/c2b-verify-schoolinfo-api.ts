// SCHOOL V2-C2B RESUME — 학교알리미(SchoolInfo) OpenAPI 실제 인증/응답 검증.
// READ-ONLY: DB write 없음, 대량 ingestion 없음. apiType=09(학년별·학급별
// 학생수)를 중심으로 wrapper/필드/식별자를 실측하고, 기존 NEIS 적재본
// (School 테이블, school-v2-c2a)과 이름+시군구 기준으로만 crosswalk한다
// (학교명 단독 매칭 금지 — 지시사항).
//
// 실행: npx tsx scripts/education/c2b-verify-schoolinfo-api.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = process.env.SCHOOLINFO_API_KEY || '';
const BASE = 'http://www.schoolinfo.go.kr/openApi.do';

// 부산 16개 구·군 lawdCd(5자리) — School.sigunguCode와 동일 값(이 프로젝트가
// MOLIT 실거래/건축물대장 조회에서 이미 쓰는 것과 같은 법정동코드 체계).
// sidoCode는 그 앞 2자리("26")를 그대로 쓴다 — 학교알리미 openApi.do가 실제로
// 이 형식을 요구함을 실측으로 확인(NEIS의 3자리 교육청코드 "C10"이나 웹페이지
// 내부 AJAX가 쓰는 10자리 법정동코드 "2600000000"과는 다른, 별도 체계다).
const BUSAN_SIGUNGU_CODES = [
  '26140', '26170', '26110', '26200', '26260', '26290', '26320', '26350',
  '26380', '26410', '26440', '26470', '26500', '26530', '26710', '26230',
];

type SchoolInfoResp = { resultCode: string; resultMsg: string; list?: any[] };

async function callApi(apiType: string, pbanYr: string, schulKndCode: string, sggCode: string): Promise<SchoolInfoResp> {
  const url = `${BASE}?apiKey=${KEY}&apiType=${apiType}&pbanYr=${pbanYr}&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sggCode}`;
  const res = await fetch(url);
  return res.json();
}

async function main() {
  if (!KEY) {
    console.log('SCHOOLINFO_API_KEY 없음 — 중단');
    return;
  }

  // 1) 인증 성공 여부 + 실제 필수 파라미터 확인(단일 표본 호출)
  console.log('=== 1. 인증 + apiType=09 단일 표본(서구, 2025) ===');
  const sample = await callApi('09', '2025', '02', '26140');
  console.log('resultCode:', sample.resultCode, 'resultMsg:', sample.resultMsg, 'count:', sample.list?.length);
  console.log('wrapper keys:', Object.keys(sample));
  if (sample.list?.[0]) {
    console.log('first record keys:', Object.keys(sample.list[0]).sort());
    console.log('first record (구덕초등학교 예상):', JSON.stringify(sample.list[0], null, 2));
  }

  // 2) 최신 공시년도 + 조회 가능 범위(3년 롤링) 확인
  console.log('\n=== 2. 공시년도 범위 확인 ===');
  for (const yr of ['2026', '2025', '2024', '2023']) {
    const r = await callApi('09', yr, '02', '26140');
    console.log(`pbanYr=${yr} -> ${r.resultCode} ${r.resultMsg} (count=${r.list?.length ?? '-'})`);
    await new Promise((res) => setTimeout(res, 150));
  }

  // 3) 부산 16개 구·군 초등학교 전수 crosswalk (apiType=0, 학교기본정보 —
  //    SCHUL_CODE/주소/좌표 확인용) vs NEIS 적재본(School 테이블)
  console.log('\n=== 3. 부산 16개 구·군 초등학교 crosswalk (schoolinfo apiType=0 vs NEIS School) ===');
  const dbSchools = await prisma.school.findMany({
    where: { schoolLevel: '초등학교' },
    select: { schoolName: true, sigunguCode: true, neisSchoolCode: true },
  });
  const dbKeys = new Set(dbSchools.map((s) => `${s.sigunguCode}|${s.schoolName}`));

  const apiKeySet = new Set<string>();
  const dupWithinDistrict: { key: string; codes: string[] }[] = [];
  const seenCode = new Map<string, string>();
  let sampleWithCoords: any = null;

  for (const sgg of BUSAN_SIGUNGU_CODES) {
    const r = await callApi('0', '2025', '02', sgg);
    if (r.resultCode !== 'success' || !r.list) {
      console.log(`  sgg=${sgg} FAIL: ${r.resultMsg}`);
      continue;
    }
    for (const item of r.list) {
      const k = `${sgg}|${item.SCHUL_NM}`;
      if (seenCode.has(k)) {
        dupWithinDistrict.push({ key: k, codes: [seenCode.get(k)!, item.SCHUL_CODE] });
      }
      seenCode.set(k, item.SCHUL_CODE);
      apiKeySet.add(k);
      if (!sampleWithCoords && item.LTTUD) sampleWithCoords = item;
    }
    await new Promise((res) => setTimeout(res, 150));
  }

  const onlyInApi = [...apiKeySet].filter((k) => !dbKeys.has(k));
  const onlyInDb = [...dbKeys].filter((k) => !apiKeySet.has(k));

  console.log('distinct API (구·군,학교명) keys:', apiKeySet.size);
  console.log('distinct DB (구·군,학교명) keys:', dbKeys.size);
  console.log('present in both (NEIS<->SchoolInfo name+구군 join):', apiKeySet.size - onlyInApi.length);
  console.log('only in schoolinfo (NEIS 적재본에 없음):', onlyInApi.length, JSON.stringify(onlyInApi));
  console.log('only in NEIS 적재본 (schoolinfo 2025에 없음):', onlyInDb.length, JSON.stringify(onlyInDb));
  console.log('구·군 내부에서조차 같은 이름이 SCHUL_CODE 다르게 중복(동명이교 그 이상):', JSON.stringify(dupWithinDistrict));

  // 4) 동명이교 안전성 — 부산 내 실제 확인된 케이스(송정초등학교: 해운대구/강서구)
  console.log('\n=== 4. 동명이교(송정초등학교) 지역 스코프 분리 확인 ===');
  const haeundaeSongjeong = await callApi('0', '2025', '02', '26350');
  const gangseoSongjeong = await callApi('0', '2025', '02', '26440');
  const h = haeundaeSongjeong.list?.find((s) => s.SCHUL_NM === '송정초등학교');
  const g = gangseoSongjeong.list?.find((s) => s.SCHUL_NM === '송정초등학교');
  console.log('해운대구 송정초등학교:', h ? { SCHUL_CODE: h.SCHUL_CODE, ADRES_BRKDN: h.ADRES_BRKDN } : 'NOT FOUND');
  console.log('강서구 송정초등학교:', g ? { SCHUL_CODE: g.SCHUL_CODE, ADRES_BRKDN: g.ADRES_BRKDN } : 'NOT FOUND');

  // 5) 학교기본정보(apiType=0)에 좌표(LTTUD/LGTUD) 필드가 실제로 채워지는지 확인
  //    — SCHOOL V2-C5 감사에서 School.latitude/longitude가 NEIS 적재로는
  //    항상 null임을 확인했는데, 학교알리미 학교기본정보는 이를 보유할 수
  //    있음을 이번 검증에서 확인(참고용, 이번 STEP 범위 밖 — ingestion 없음).
  console.log('\n=== 5. (참고) 학교알리미 학교기본정보의 위경도 필드 실측 ===');
  console.log(sampleWithCoords ? JSON.stringify({ SCHUL_NM: sampleWithCoords.SCHUL_NM, LTTUD: sampleWithCoords.LTTUD, LGTUD: sampleWithCoords.LGTUD }, null, 2) : '표본 없음');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
