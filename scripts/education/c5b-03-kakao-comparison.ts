// SCHOOL V2-C5-B §5 — SchoolInfo apiType=0 좌표 vs 현재 runtime Kakao SC4 POI 좌표
// 표본 비교(10개, 급별/구별 분산). READ-ONLY.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

const SCHOOLINFO_KEY = process.env.SCHOOLINFO_API_KEY || '';
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';

const SAMPLES: { sgg: string; schulKndCode: string; label: string }[] = [
  { sgg: '26140', schulKndCode: '02', label: '서구-초' },
  { sgg: '26140', schulKndCode: '03', label: '서구-중' },
  { sgg: '26350', schulKndCode: '02', label: '해운대구-초' },
  { sgg: '26350', schulKndCode: '04', label: '해운대구-고' },
  { sgg: '26440', schulKndCode: '02', label: '강서구-초(비모호 필요)' },
  { sgg: '26440', schulKndCode: '03', label: '강서구-중(비모호 필요)' },
  { sgg: '26260', schulKndCode: '02', label: '동래구-초(기타)' },
  { sgg: '26380', schulKndCode: '03', label: '사하구-중(기타)' },
  { sgg: '26530', schulKndCode: '04', label: '수영구-고(기타)' },
  { sgg: '26710', schulKndCode: '05', label: '기장군-특수(기타)' },
];

// 강서구는 동명이교(송정/대저중앙/가락)가 있으니 그 이름은 표본에서 제외.
const AMBIGUOUS_NAMES = new Set(['송정초등학교', '대저중앙초등학교', '가락중학교']);

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchSchoolInfoOne(sgg: string, schulKndCode: string) {
  const url = `http://www.schoolinfo.go.kr/openApi.do?apiKey=${SCHOOLINFO_KEY}&apiType=0&pbanYr=2025&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sgg}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.resultCode !== 'success') return null;
  const candidates = (json.list || []).filter((r: any) => r.LTTUD != null && !AMBIGUOUS_NAMES.has(r.SCHUL_NM) && r.ABSCH_YN !== 'Y');
  return candidates[0] || null;
}

async function findKakaoPoi(name: string, lat: number, lng: number) {
  // schoolinfo 좌표 중심 500m 내에서 SC4 카테고리로 검색 후 이름이 정확히 일치하는 것을 우선.
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=SC4&x=${lng}&y=${lat}&radius=1000&sort=distance`;
  const res = await fetch(url, {
    headers: {
      Authorization: `KakaoAK ${KAKAO_KEY}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    },
  });
  if (!res.ok) return { ok: false as const, status: res.status };
  const data = await res.json();
  const docs = data.documents || [];
  const exact = docs.find((d: any) => d.place_name === name);
  return { ok: true as const, exact, nearest: docs[0] };
}

async function main() {
  for (const s of SAMPLES) {
    const si = await fetchSchoolInfoOne(s.sgg, s.schulKndCode);
    if (!si) {
      console.log(`[${s.label}] SchoolInfo 표본 없음(비모호 후보 없음)`);
      continue;
    }
    const kakao = await findKakaoPoi(si.SCHUL_NM, si.LTTUD, si.LGTUD);
    if (!kakao.ok) {
      console.log(`[${s.label}] ${si.SCHUL_NM} — Kakao 조회 실패 status=${kakao.status}`);
      continue;
    }
    const match = kakao.exact || kakao.nearest;
    if (!match) {
      console.log(`[${s.label}] ${si.SCHUL_NM} — MISSING_ONE_SIDE(Kakao 쪽 없음), SchoolInfo=(${si.LTTUD},${si.LGTUD})`);
      continue;
    }
    const kLat = Number(match.y);
    const kLng = Number(match.x);
    const delta = haversineM(si.LTTUD, si.LGTUD, kLat, kLng);
    let cls = 'A. CLOSE_MATCH';
    if (delta > 30 && delta <= 150) cls = 'B. MODERATE_DIFFERENCE';
    if (delta > 150) cls = 'C. LARGE_DIFFERENCE';
    const nameMatch = kakao.exact ? 'exact-name-match' : `nearest-only(name="${match.place_name}")`;
    console.log(
      `[${s.label}] ${si.SCHUL_NM} | SchoolInfo=(${si.LTTUD.toFixed(6)},${si.LGTUD.toFixed(6)}) addr="${si.ADRES_BRKDN}" | Kakao=(${kLat},${kLng}) [${nameMatch}] | delta=${delta.toFixed(1)}m | ${cls}`
    );
    await new Promise((r) => setTimeout(r, 200));
  }
}

main().catch(console.error);
