// SCHOOL V2-C5-B §2/§3/§4 — SchoolInfo(학교알리미) apiType=0의 LTTUD/LGTUD 실측 +
// 부산 전체 coverage 측정 + NEIS 적재 School과의 identity crosswalk. READ-ONLY,
// DB write 없음, SchoolStat ingestion 없음(학교기본정보만 조회, 통계 항목 미호출).
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = process.env.SCHOOLINFO_API_KEY || '';
const BASE = 'http://www.schoolinfo.go.kr/openApi.do';

// C2B에서 실측 확인된 부산 16개 구·군 lawdCd(5자리) — sidoCode=26과 함께 사용.
const BUSAN_SIGUNGU_CODES = [
  '26140', '26170', '26110', '26200', '26260', '26290', '26320', '26350',
  '26380', '26410', '26440', '26470', '26500', '26530', '26710', '26230',
];
// schulKndCode: 02=초, 03=중, 04=고, 05=특수(§2 표본 요구사항)
const SCHUL_KND_CODES = ['02', '03', '04', '05'] as const;

// 부산 대략적 경계(§3 out-of-Busan 판정용, 느슨한 bounding box)
const BUSAN_BOUNDS = { latMin: 34.87, latMax: 35.42, lngMin: 128.72, lngMax: 129.32 };

interface SchoolInfoRow {
  SCHUL_CODE: string;
  SCHUL_NM: string;
  SCHUL_KND_SC_CODE: string;
  ADRES_BRKDN: string;
  LTTUD: number | null;
  LGTUD: number | null;
  BNHH_YN: string;
  ABSCH_YN?: string;
}

async function fetchBasicInfo(sgg: string, schulKndCode: string): Promise<SchoolInfoRow[]> {
  const url = `${BASE}?apiKey=${KEY}&apiType=0&pbanYr=2025&schulKndCode=${schulKndCode}&sidoCode=26&sggCode=${sgg}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.resultCode !== 'success') return [];
  return json.list || [];
}

async function main() {
  const allRows: SchoolInfoRow[] = [];
  for (const sgg of BUSAN_SIGUNGU_CODES) {
    for (const sk of SCHUL_KND_CODES) {
      const rows = await fetchBasicInfo(sgg, sk);
      allRows.push(...rows);
      await new Promise((r) => setTimeout(r, 130));
    }
  }

  console.log('=== §3 SchoolInfo coverage (부산 16개 구군 x 초/중/고/특수, apiType=0, pbanYr=2025) ===');
  console.log('total rows fetched:', allRows.length);

  const nonNull = allRows.filter((r) => r.LTTUD != null && r.LGTUD != null);
  const nullCoord = allRows.filter((r) => r.LTTUD == null || r.LGTUD == null);
  const invalid = nonNull.filter(
    (r) => r.LTTUD! < -90 || r.LTTUD! > 90 || r.LGTUD! < -180 || r.LGTUD! > 180 || (r.LTTUD === 0 && r.LGTUD === 0)
  );
  const outOfBusan = nonNull.filter(
    (r) =>
      !invalid.includes(r) &&
      (r.LTTUD! < BUSAN_BOUNDS.latMin ||
        r.LTTUD! > BUSAN_BOUNDS.latMax ||
        r.LGTUD! < BUSAN_BOUNDS.lngMin ||
        r.LGTUD! > BUSAN_BOUNDS.lngMax)
  );
  const coordKey = (r: SchoolInfoRow) => `${r.LTTUD?.toFixed(6)},${r.LGTUD?.toFixed(6)}`;
  const coordCounts = new Map<string, number>();
  for (const r of nonNull) coordCounts.set(coordKey(r), (coordCounts.get(coordKey(r)) || 0) + 1);
  const duplicateCoordGroups = [...coordCounts.entries()].filter(([, c]) => c > 1);

  console.log('non-null LTTUD/LGTUD:', nonNull.length, `(${((nonNull.length / allRows.length) * 100).toFixed(1)}%)`);
  console.log('null coord:', nullCoord.length);
  console.log('invalid (range/0,0):', invalid.length, JSON.stringify(invalid.map((r) => r.SCHUL_NM)));
  console.log('out-of-Busan bounds:', outOfBusan.length, JSON.stringify(outOfBusan.map((r) => ({ name: r.SCHUL_NM, lat: r.LTTUD, lng: r.LGTUD }))));
  console.log('duplicate-coordinate groups (same lat/lng, 2+ schools):', duplicateCoordGroups.length, JSON.stringify(duplicateCoordGroups.slice(0, 10)));

  console.log('\n=== level breakdown (schoolinfo source rows) ===');
  for (const sk of SCHUL_KND_CODES) {
    const levelRows = allRows.filter((r) => r.SCHUL_KND_SC_CODE === sk);
    const levelCoords = levelRows.filter((r) => r.LTTUD != null);
    console.log(`schulKndCode=${sk}: total=${levelRows.length}, withCoords=${levelCoords.length}`);
  }

  console.log('\n=== §4 identity crosswalk vs NEIS-ingested School (canonical, 664행) ===');
  const dbSchools = await prisma.school.findMany({ select: { schoolName: true, sigunguCode: true, schoolLevel: true } });
  const dbNameCountBySigungu = new Map<string, number>(); // key = sigungu|name -> count in DB (동명이교 감지용, School 테이블 자체 기준)
  for (const s of dbSchools) {
    const k = `${s.sigunguCode}|${s.schoolName}`;
    dbNameCountBySigungu.set(k, (dbNameCountBySigungu.get(k) || 0) + 1);
  }

  // schoolinfo 쪽에서도 같은 (구군,이름) 중복이 있는지(§4 지시: 송정초등학교/대저중앙초등학교 등)
  const apiNameCountBySigungu = new Map<string, { count: number; rows: SchoolInfoRow[] }>();
  for (let i = 0; i < BUSAN_SIGUNGU_CODES.length; i++) {
    // sgg 정보가 row 자체엔 없어 재조회 대신 ADRES_BRKDN 접두어로 근사 매칭은 부정확 —
    // 대신 원 fetch 루프에서 sgg를 못 들고 왔으므로, 여기서는 전체 allRows 내에서
    // 이름 중복만으로 1차 스크리닝(같은 구군 여부는 ADRES_BRKDN으로 재확인).
  }
  const byName = new Map<string, SchoolInfoRow[]>();
  for (const r of allRows) {
    byName.set(r.SCHUL_NM, [...(byName.get(r.SCHUL_NM) || []), r]);
  }
  const dupNames = [...byName.entries()].filter(([, rows]) => rows.length > 1);

  let safeMatch = 0;
  let unsafeAmbiguous = 0;
  for (const [name, rows] of dupNames) {
    // 서로 다른 구/군(ADRES_BRKDN의 두 번째 토큰)인지 확인 — 같으면 진짜 같은 구 내 중복.
    const districts = new Set(rows.map((r) => (r.ADRES_BRKDN || '').split(/\s+/)[1] || ''));
    if (districts.size === rows.length) {
      // 서로 다른 구/군 — 이름은 겹치지만 (이름,구군) 키는 유일 — §4 지시대로 안전.
      safeMatch += rows.length;
    } else {
      // 같은 구/군 안에서도 중복 — (이름,구군)으로도 disambiguate 안 됨.
      console.log(`  구내 중복(이름+구군으로도 미해소): ${name} — ${JSON.stringify(rows.map((r) => ({ SCHUL_CODE: r.SCHUL_CODE, addr: r.ADRES_BRKDN, BNHH_YN: r.BNHH_YN })))}`);
      unsafeAmbiguous += rows.length;
    }
  }
  console.log('이름 중복 그룹 수(전체):', dupNames.length);
  console.log('이름은 겹치나 구군이 달라 (이름,구군) 키로 안전한 건수:', safeMatch);
  console.log('같은 구군 안에서도 중복돼 unsafe(자동 매핑 금지) 건수:', unsafeAmbiguous);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
