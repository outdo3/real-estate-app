// E-JIP SCORE V2 STEP 0.7 §11/§49 — RECOVERY_HIGH로 얻은 도로명주소를 실제
// Kakao 키워드 검색으로 재지오코딩했을 때 'exact'(성공)로 이어지는지 표본
// 검증(§18-23의 AFTER_WITH_REGEOCODE_PROJECTED 가정을 뒷받침하는 근거,
// 조회만 하고 DB에는 쓰지 않음). apartment_master_seed.ts:kakaoSearch()와
// 동일 엔드포인트/헤더 재사용. READ-ONLY.
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
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return { ok: false, status: 'no_result' };
  return { ok: true, addr: doc.road_address_name || doc.address_name, lat: doc.y, lng: doc.x };
}

async function main() {
  const classified = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07-recovery-classification.json'), 'utf-8')) as any[];
  const highs = classified.filter((c) => c.recovery.level === 'RECOVERY_HIGH' && c.probe.roadAddress);
  // 16개 구·군 고루 분포된 20건 표본
  const byLawd = new Map<string, any[]>();
  for (const r of highs) {
    const k = r.lawdCd ?? 'null';
    if (!byLawd.has(k)) byLawd.set(k, []);
    byLawd.get(k)!.push(r);
  }
  const sample: any[] = [];
  for (const [, rows] of byLawd) sample.push(rows[0], ...(rows.length > 1 ? [rows[Math.floor(rows.length / 2)]] : []));

  let successCount = 0;
  for (const r of sample.slice(0, 30)) {
    await new Promise((res) => setTimeout(res, 300));
    const result = await kakaoSearch(r.probe.roadAddress);
    if (result.ok) successCount++;
    console.log(`${r.aptSeq} "${r.probe.roadAddress}" → ${result.ok ? `OK(${(result as any).addr})` : `FAIL(${(result as any).status})`}`);
  }
  console.log(`\n재지오코딩 spot-check: ${successCount}/${Math.min(sample.length, 30)}건 성공`);
}
main().catch((e) => { console.error(e); process.exit(1); });
