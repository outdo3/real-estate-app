// E-JIP SCORE V2 STEP 0.7 §11/§49 — §13에서 발견: BldRgstHubService 도로명주소가
// "(동)" 괄호로 끝나면 Kakao 키워드검색이 종종 0건을 반환한다(같은 주소를 address
// 엔드포인트나 괄호 제거로 재시도하면 성공 — §13 확인). 그러나 production
// geocode()는 roadAddress 실패 시 jibunAddress로, 그마저 실패하면 "동 이름" 키워드로
// cascade한다(apartment_master_seed.ts:geocode() 그대로, 이번 STEP에서 로직
// 변경 없음). 이 cascade 전체를 그대로 재현해 RECOVERY_HIGH 후보의 실제
// "재지오코딩 시 exact 도달률"을 정직하게 측정한다(§13처럼 1개 후보만 보고 과소
// 추정하지 않기 위함). READ-ONLY, DB write 없음.
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const kakaoHeaders = {
  Authorization: `KakaoAK ${KAKAO_KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};

async function kakaoSearch(query: string) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;
  const addr = doc.road_address_name || doc.address_name || '';
  const tokens = addr.split(/\s+/);
  return { lat: parseFloat(doc.y), lng: parseFloat(doc.x), region1: tokens[0] || '', addr };
}

// production geocode()의 candidate 순서/판정을 그대로 재현(quality 로직만, sido
// 검증 단계는 생략 — 이번 감사는 "도달하는가"만 확인, region1 검증은 기존 함수 그대로 신뢰).
async function simulateGeocode(roadAddress: string | null, jibunAddress: string | null, dong: string, name: string) {
  const candidates: { label: string; query: string }[] = [];
  if (roadAddress) candidates.push({ label: 'road(원본)', query: roadAddress });
  if (jibunAddress) candidates.push({ label: 'jibun', query: jibunAddress });
  candidates.push({ label: 'dong+name keyword', query: `${dong} ${name}` });

  for (const c of candidates) {
    await new Promise((r) => setTimeout(r, 300));
    const result = await kakaoSearch(c.query);
    if (result) return { quality: c.label === 'dong+name keyword' ? 'normalized' : 'exact', via: c.label, addr: result.addr };
  }
  return { quality: 'failed', via: null, addr: null };
}

async function main() {
  const classified = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07-recovery-classification.json'), 'utf-8')) as any[];
  const highs = classified.filter((c) => c.recovery.level === 'RECOVERY_HIGH' && c.probe.roadAddress);
  const byLawd = new Map<string, any[]>();
  for (const r of highs) {
    const k = r.lawdCd ?? 'null';
    if (!byLawd.has(k)) byLawd.set(k, []);
    byLawd.get(k)!.push(r);
  }
  const sample: any[] = [];
  for (const [, rows] of byLawd) sample.push(rows[0]);
  sample.push(...highs.slice(0, 14)); // 16(구·군 1건씩) + 14 = 30

  const results: any[] = [];
  for (const r of sample) {
    const g = await simulateGeocode(r.probe.roadAddress, r.probe.jibunAddress, r.dong, r.aptName);
    results.push({ aptSeq: r.aptSeq, ...g });
    console.log(`${r.aptSeq}: quality=${g.quality} via=${g.via ?? '-'}`);
  }
  const exactCount = results.filter((r) => r.quality === 'exact').length;
  const viaRoad = results.filter((r) => r.via === 'road(원본)').length;
  const viaJibun = results.filter((r) => r.via === 'jibun').length;
  console.log(`\n표본 ${results.length}건 중 exact 도달: ${exactCount}건(${(100 * exactCount / results.length).toFixed(1)}%)`);
  console.log(`  road(원본)로 도달: ${viaRoad}건, jibun으로 도달(road 실패 후 fallback): ${viaJibun}건`);
}
main().catch((e) => { console.error(e); process.exit(1); });
