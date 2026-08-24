// SCHOOL V2-C2B-A §2 — SchoolInfo 부산 전체 학교 기본정보(apiType=0) read-only 수집.
// 16개 구·군 × schulKndCode(02초/03중/04고/05특수/06그외/07각종) 전수 fetch.
// DB write 없음, SchoolStat 미호출(apiType=0만), API key는 로그에 남기지 않음.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { writeFileSync } from 'fs';
import { join } from 'path';

// 세션 스크래치패드에만 캐시한다 — repo에 raw API 응답을 커밋하지 않는다(LEGAL-1
// §7 "raw response 장기 저장"이 REVIEW_REQUIRED로 남아있는 것과 별개로, 이건 이번
// 세션 분석용 임시 캐시일 뿐 repo에 들어가지 않는다).
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

const KEY = process.env.SCHOOLINFO_API_KEY || '';
const BASE = 'http://www.schoolinfo.go.kr/openApi.do';

const BUSAN_SIGUNGU = [
  { code: '26140', name: '서구' }, { code: '26170', name: '동구' }, { code: '26110', name: '중구' },
  { code: '26200', name: '영도구' }, { code: '26260', name: '동래구' }, { code: '26290', name: '연제구' },
  { code: '26320', name: '금정구' }, { code: '26350', name: '해운대구' }, { code: '26380', name: '사하구' },
  { code: '26410', name: '사상구' }, { code: '26440', name: '강서구' }, { code: '26470', name: '수영구' },
  { code: '26500', name: '북구' }, { code: '26530', name: '남구' }, { code: '26710', name: '기장군' },
  { code: '26230', name: '부산진구' },
];
const SCHUL_KND = ['02', '03', '04', '05', '06', '07'] as const; // 초/중/고/특수/그외/각종

async function fetchOne(sggCode: string, schulKndCode: string) {
  const url = `${BASE}?apiKey=${KEY}&apiType=0&pbanYr=2025&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sggCode}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.resultCode !== 'success') return [];
  return json.list || [];
}

async function main() {
  const all: any[] = [];
  for (const sgg of BUSAN_SIGUNGU) {
    for (const sk of SCHUL_KND) {
      const rows = await fetchOne(sgg.code, sk);
      for (const r of rows) all.push({ ...r, __sggName: sgg.name, __sggCode: sgg.code });
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  console.log('총 수집 row:', all.length);
  const byKind = new Map<string, number>();
  for (const r of all) byKind.set(r.SCHUL_KND_SC_CODE, (byKind.get(r.SCHUL_KND_SC_CODE) || 0) + 1);
  console.log('schulKndCode별:', JSON.stringify([...byKind.entries()]));

  // 후속 스크립트들이 재사용할 수 있도록 스크래치패드에만 캐시(repo 밖, API key 값
  // 자체는 응답 데이터에 없음 — 별도 확인).
  const outPath = join(SCRATCHPAD, 'schoolinfo-busan-universe.json');
  writeFileSync(outPath, JSON.stringify(all), 'utf-8');
  console.log('캐시 저장:', outPath);
}

main().catch(console.error);
