// MASTER M3 — ApartmentMaster 소량 실제 구축 검증용 seed 스크립트.
// MOLIT 실거래(aptSeq 확보) → 건축물대장(REGCODE_PROXY 대신 MOLIT umdCd 직접 사용,
// M1/M2에서 확인된 우회 경로) → Kakao geocoding(exact/normalized만 저장, area_only 금지)
// 순으로 enrichment한다. 이름 매칭으로 단지를 합치지 않는다(aptSeq 단위로만 upsert).
//
// 사용법: npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js scripts/apartment_master_seed.ts <lawdCd> <label> <limit>
import * as dotenv from 'dotenv';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';

const MOLIT_KEY = process.env.DATA_GO_KR_API_KEY || '';
const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const kakaoHeaders = {
  Authorization: `KakaoAK ${KAKAO_KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};

function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '').replace(/아파트$/, '');
}

function monthsBack(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchMonth(lawdCd: string, dealYmd: string): Promise<any[]> {
  const cleanKey = encodeURIComponent(decodeURIComponent(MOLIT_KEY.trim().replace(/['"]/g, '')));
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${cleanKey}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`;
  const res = await fetch(url, { headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const json = parser.parse(text);
  const items = json.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

interface Candidate {
  aptSeq: string;
  name: string;
  umdNm: string;
  umdCd: string;
  jibun: string;
  sggCd: string;
  buildYear: number | null;
  tradeCount: number;
}

async function collectCandidates(lawdCd: string): Promise<Candidate[]> {
  let all: any[] = [];
  for (const dealYmd of monthsBack(18)) {
    all = all.concat(await fetchMonth(lawdCd, dealYmd));
  }
  const map = new Map<string, Candidate>();
  for (const it of all) {
    if (!it.aptSeq) continue;
    const seq = String(it.aptSeq).trim();
    if (!map.has(seq)) {
      map.set(seq, {
        aptSeq: seq,
        name: String(it.aptNm || '').trim(),
        umdNm: String(it.umdNm || '').trim(),
        umdCd: String(it.umdCd || '').trim(),
        jibun: String(it.jibun || '').trim(),
        sggCd: String(it.sggCd || lawdCd).trim(),
        buildYear: it.buildYear ? parseInt(String(it.buildYear), 10) : null,
        tradeCount: 0,
      });
    }
    map.get(seq)!.tradeCount += 1;
  }
  return [...map.values()];
}

// 다양한 케이스를 섞어 표본을 뽑는다: 거래 많음/적음, 신축/구축, 이름 정규화 중복 후보.
function selectDiverseSample(candidates: Candidate[], limit: number): Candidate[] {
  const byTradeDesc = [...candidates].sort((a, b) => b.tradeCount - a.tradeCount);
  const byTradeAsc = [...candidates].sort((a, b) => a.tradeCount - b.tradeCount);
  const byYearDesc = [...candidates].filter((c) => c.buildYear).sort((a, b) => (b.buildYear! - a.buildYear!));
  const byYearAsc = [...candidates].filter((c) => c.buildYear).sort((a, b) => (a.buildYear! - b.buildYear!));

  // 정규화 이름이 흔한 것(브랜드/일반명, 동일명 가능성) 후보
  const nameFreq = new Map<string, number>();
  for (const c of candidates) {
    const n = normalizeName(c.name);
    nameFreq.set(n, (nameFreq.get(n) || 0) + 1);
  }
  const commonNameCandidates = candidates.filter((c) => {
    const n = normalizeName(c.name);
    return n.length <= 3 || /^(현대|삼성|대림|우성|신동아|한신|경남|극동)/.test(n);
  });

  const picked = new Map<string, Candidate>();
  const tryAdd = (list: Candidate[], n: number) => {
    let added = 0;
    for (const c of list) {
      if (added >= n) break;
      if (picked.has(c.aptSeq)) continue;
      picked.set(c.aptSeq, c);
      added += 1;
    }
  };
  tryAdd(byTradeDesc, 4); // 거래 많은 단지
  tryAdd(byTradeAsc, 3); // 거래 적은 단지
  tryAdd(byYearDesc, 3); // 신축
  tryAdd(byYearAsc, 3); // 구축
  tryAdd(commonNameCandidates, 3); // 동일/유사 이름 가능
  tryAdd(byTradeDesc, limit); // 나머지는 거래량 순으로 채움

  return [...picked.values()].slice(0, limit);
}

interface RegistryResult {
  useApprovalDate: string | null;
  mainBuildingCount: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  mgmBldrgstPk: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  recordCount: number; // 총괄표제부 레코드 수(1이 정상, 2+ = 복수 레코드 사례)
}

async function fetchRegistry(sggCd: string, umdCd: string, jibun: string): Promise<RegistryResult | null> {
  if (!sggCd || !umdCd || !jibun) return null;
  const cleanKey = encodeURIComponent(decodeURIComponent(MOLIT_KEY.trim().replace(/['"]/g, '')));
  const parts = jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  if (isNaN(bunNum)) return null;
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const bun = bunNum.toString().padStart(4, '0');
  const ji = jiNum.toString().padStart(4, '0');

  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    // mgmBldrgstPk가 JS Number 안전정수 범위(2^53)를 넘는 경우가 실측으로 확인됐다
    // (예: "1000000000000004180361", 22자리) — res.json()의 표준 JSON.parse는 이런
    // 큰 정수를 IEEE754 double로 반올림해 값을 조용히 훼손한다(예: "...042e+21"로 깨짐,
    // M3 seed 중 실제로 발견). 원본 텍스트에서 mgmBldrgstPk만 정규식으로 먼저 문자열째
    // 추출해 보존한 뒤, 나머지 필드는 기존처럼 JSON.parse한다.
    const rawText = await res.text();
    const pkMatch = rawText.match(/"mgmBldrgstPk"\s*:\s*"?([0-9]+)"?/);
    const rawMgmBldrgstPk = pkMatch ? pkMatch[1] : null;
    const json = JSON.parse(rawText);
    const header = json?.response?.header;
    if (header?.resultCode && header.resultCode !== '00') return null;
    const items = json?.response?.body?.items?.item;
    if (!items) return null;
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length === 0) return null;
    // 복수 레코드면 세대수가 가장 큰 것을 대표로 쓴다(기존 apt-building-info.ts 정책과 동일)
    const target = arr.reduce((best: any, cur: any) => ((cur.hhldCnt || 0) > (best.hhldCnt || 0) ? cur : best));

    const hhldCnt = parseInt(target.hhldCnt, 10);
    const parkingCnt = parseInt(target.totPkngCnt, 10);
    const mainBldCnt = parseInt(target.mainBldCnt, 10);
    const useAprDay: string = target.useAprDay || '';

    return {
      useApprovalDate: /^\d{8}$/.test(useAprDay) ? useAprDay : null,
      mainBuildingCount: !isNaN(mainBldCnt) && mainBldCnt > 0 ? mainBldCnt : null,
      totalHouseholds: !isNaN(hhldCnt) && hhldCnt > 0 ? hhldCnt : null,
      parkingCount: !isNaN(parkingCnt) && parkingCnt > 0 ? parkingCnt : null,
      // 레코드가 1건일 때만 정규식 추출값(정밀도 보존)을 신뢰한다. 복수 레코드(recordCount>1)는
      // 어차피 "단일 컬럼으로 고정하지 않는다"는 정책(M3 §5)이라 이 필드 자체를 참고용으로만 쓴다.
      mgmBldrgstPk: arr.length === 1 && rawMgmBldrgstPk ? rawMgmBldrgstPk : (target.mgmBldrgstPk != null ? String(target.mgmBldrgstPk) : null),
      roadAddress: target.newPlatPlc ? String(target.newPlatPlc).trim() : null,
      jibunAddress: target.platPlc ? String(target.platPlc).trim() : null,
      recordCount: arr.length,
    };
  } catch {
    return null;
  }
}

interface GeoResult {
  lat: number;
  lng: number;
  quality: 'exact' | 'normalized';
  matchedAddr: string;
}

async function kakaoSearch(query: string): Promise<{ lat: number; lng: number; region1: string; region2: string; addr: string } | null> {
  try {
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const doc = data.documents?.[0];
    if (!doc) return null;
    // 키워드검색(keyword.json) 응답에는 address search(address.json)와 달리 중첩된
    // address.region_1depth_name 필드 자체가 없다(실측 확인 — documents[]에 address_name/
    // road_address_name 평문 문자열만 존재) — 이 필드가 항상 undefined인 채로 검증을
    // 시도하면 빈 문자열이 "".includes()/.includes("") 양쪽 다 true가 되는 경계 조건 때문에
    // 지역 불일치 검증이 사실상 항상 통과되는 실제 버그를 겪었다(해운대 seed 중 발견 —
    // "스카이맨션"/"에이스빌라"가 경기 부천시의 동명 장소로 잘못 매칭됨). 평문 주소 문자열의
    // 첫 토큰(시/도)을 region1으로 직접 파싱해 사용한다.
    const addr = doc.road_address_name || doc.address_name || '';
    const tokens = addr.split(/\s+/);
    return {
      lat: parseFloat(doc.y),
      lng: parseFloat(doc.x),
      region1: tokens[0] || '',
      region2: tokens[1] || '',
      addr,
    };
  } catch {
    return null;
  }
}

// 우선순위: 1) 건축물대장 도로명주소 2) 건축물대장 지번주소 3) "{동} {단지명}" 키워드
async function geocode(expectedSido: string, roadAddress: string | null, jibunAddress: string | null, dong: string, name: string): Promise<GeoResult | null> {
  const candidates: { query: string; quality: 'exact' | 'normalized' }[] = [];
  if (roadAddress) candidates.push({ query: roadAddress, quality: 'exact' });
  if (jibunAddress) candidates.push({ query: jibunAddress, quality: 'exact' });
  candidates.push({ query: `${dong} ${name}`, quality: 'normalized' });

  for (const { query, quality } of candidates) {
    const r = await kakaoSearch(query);
    if (!r) continue;
    // region1이 빈 문자열이면(파싱 실패 등) 검증 불가 상태이므로 통과시키지 않고 거부한다
    // (빈 문자열은 String.includes()의 항등원이라 검증을 우회할 수 있었던 실제 버그를
    // 재발시키지 않기 위한 방어적 처리).
    if (expectedSido && (!r.region1 || (!r.region1.includes(expectedSido) && !expectedSido.includes(r.region1)))) {
      console.log(`    [geocode 거부] query="${query}" kakao지역="${r.region1 || '(없음)'}" expected="${expectedSido}"`);
      continue;
    }
    return { lat: r.lat, lng: r.lng, quality, matchedAddr: r.addr };
  }
  return null;
}

async function main() {
  const lawdCd = process.argv[2];
  const label = process.argv[3] || lawdCd;
  const limit = parseInt(process.argv[4] || '15', 10);
  if (!lawdCd) {
    console.error('사용법: apartment_master_seed.ts <lawdCd> <label> <limit>');
    process.exit(1);
  }

  console.log(`=== ${label}(${lawdCd}) MOLIT 18개월 후보 수집 ===`);
  const candidates = await collectCandidates(lawdCd);
  console.log(`고유 aptSeq 후보 ${candidates.length}개 확보`);

  const sample = selectDiverseSample(candidates, limit);
  console.log(`\n선정된 표본 ${sample.length}개:`);
  sample.forEach((c) => console.log(`  ${c.aptSeq} | ${c.name} | ${c.umdNm} ${c.jibun} | 거래${c.tradeCount}건 | 건축년도${c.buildYear ?? '?'}`));

  const results: any[] = [];
  for (const c of sample) {
    console.log(`\n--- ${c.name}(${c.aptSeq}) enrichment ---`);
    const registry = await fetchRegistry(c.sggCd, c.umdCd, c.jibun);
    if (registry) {
      console.log(`  건축물대장: 성공 (레코드수=${registry.recordCount}, 세대수=${registry.totalHouseholds}, 동수=${registry.mainBuildingCount}, 주차=${registry.parkingCount}, 사용승인=${registry.useApprovalDate})`);
    } else {
      console.log('  건축물대장: 실패/결과없음');
    }

    // sido는 estateAgentSggNm 관례(예: "부산 서구") 대신 label에서 시도 부분만 추출 시도 -
    // 여기서는 REGCODE_PROXY를 authoritative source로 쓰지 않는다는 M2 정책에 따라
    // MOLIT 응답 자체에는 sido 텍스트 필드가 없으므로, geocode 검증 기준은 label의 앞 토큰(예: "부산")을 사용한다.
    const expectedSido = label.split(' ')[0];
    const geo = await geocode(expectedSido, registry?.roadAddress ?? null, registry?.jibunAddress ?? null, c.umdNm, c.name);
    if (geo) {
      console.log(`  좌표: 성공 (${geo.quality}, lat=${geo.lat}, lng=${geo.lng}, matched="${geo.matchedAddr}")`);
    } else {
      console.log('  좌표: 실패(지역불일치 또는 결과없음) — null 유지');
    }

    const normalizedName = normalizeName(c.name);
    const sigungu = label.split(' ').slice(1).join(' ') || null;

    const data = {
      aptSeq: c.aptSeq,
      mgmBldrgstPk: registry?.mgmBldrgstPk ?? null,
      name: c.name,
      normalizedName,
      sido: expectedSido || null,
      sigungu,
      sggCd: c.sggCd || null,
      umdName: c.umdNm || null,
      umdCd: c.umdCd || null,
      jibun: c.jibun || null,
      roadAddress: registry?.roadAddress ?? null,
      jibunAddress: registry?.jibunAddress ?? null,
      latitude: geo?.lat ?? null,
      longitude: geo?.lng ?? null,
      geocodeQuality: geo?.quality ?? (geo === null ? 'failed' : null),
      buildYear: c.buildYear,
      useApprovalDate: registry?.useApprovalDate ?? null,
      mainBuildingCount: registry?.mainBuildingCount ?? null,
      totalHouseholds: registry?.totalHouseholds ?? null,
      parkingCount: registry?.parkingCount ?? null,
    };

    const saved = await prisma.apartmentMaster.upsert({
      where: { aptSeq: c.aptSeq },
      create: data,
      update: data,
    });
    results.push({ ...saved, registryRecordCount: registry?.recordCount ?? 0 });
    console.log(`  DB upsert 완료: id=${saved.id}`);
  }

  console.log(`\n\n=== ${label} seed 요약 ===`);
  console.log(`대상 ${sample.length}건 처리 완료`);
  console.log(`건축물대장 성공: ${results.filter((r) => r.totalHouseholds != null || r.mainBuildingCount != null).length}건`);
  console.log(`좌표 exact: ${results.filter((r) => r.geocodeQuality === 'exact').length}건`);
  console.log(`좌표 normalized: ${results.filter((r) => r.geocodeQuality === 'normalized').length}건`);
  console.log(`좌표 failed: ${results.filter((r) => r.geocodeQuality === 'failed' || r.geocodeQuality == null).length}건`);
  console.log(`복수 건축물대장 레코드 사례: ${results.filter((r) => r.registryRecordCount > 1).length}건`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  });
