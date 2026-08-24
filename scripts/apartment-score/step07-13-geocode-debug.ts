// E-JIP SCORE V2 STEP 0.7 §11 추가조사 — spot-check에서 RECOVERY_HIGH 도로명주소
// 재지오코딩이 3/30(10%)만 성공했다. 원인 규명(추정 금지, 실측 비교): 동일 주소를
// (a) production과 동일한 키워드검색+원본 문자열 그대로, (b) "(동)" 괄호 제거,
// (c) Kakao 주소검색(keyword 아닌 address) 엔드포인트, (d) jibunAddress로 각각 시도.
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const kakaoHeaders = {
  Authorization: `KakaoAK ${KAKAO_KEY}`,
  KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
  Origin: 'http://localhost:3000',
};

async function keywordSearch(query: string) {
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(4000) });
  const status = res.status;
  const data = await res.json().catch(() => null);
  return { status, count: data?.documents?.length ?? 0, first: data?.documents?.[0]?.address_name ?? null, raw: data?.meta };
}
async function addressSearch(query: string) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: kakaoHeaders, signal: AbortSignal.timeout(4000) });
  const status = res.status;
  const data = await res.json().catch(() => null);
  return { status, count: data?.documents?.length ?? 0, first: data?.documents?.[0]?.address_name ?? null };
}

const cases = [
  { aptSeq: '26140-63', road: '부산광역시 서구 구덕로186번길 37 (토성동2가)', jibun: '부산광역시 서구 토성동2가 7-4번지' },
  { aptSeq: '26230-1790', road: '부산광역시 부산진구 동평로 197 (부암동)', jibun: '부산광역시 부산진구 부암동 304-1번지' },
  { aptSeq: '26470-1176', road: '부산광역시 연제구 과정로 162 (연산동)', jibun: '부산광역시 연제구 연산동 478-2번지' },
];

async function main() {
  for (const c of cases) {
    console.log(`\n${'='.repeat(60)}\n${c.aptSeq}`);
    await new Promise((r) => setTimeout(r, 300));
    console.log('(a) keyword, 원본 그대로:', JSON.stringify(await keywordSearch(c.road)));
    await new Promise((r) => setTimeout(r, 300));
    const noParen = c.road.replace(/\s*\([^)]*\)\s*$/, '');
    console.log(`(b) keyword, "(동)" 제거("${noParen}"):`, JSON.stringify(await keywordSearch(noParen)));
    await new Promise((r) => setTimeout(r, 300));
    console.log('(c) address 엔드포인트, 원본 그대로:', JSON.stringify(await addressSearch(c.road)));
    await new Promise((r) => setTimeout(r, 300));
    console.log(`(d) address 엔드포인트, "(동)" 제거:`, JSON.stringify(await addressSearch(noParen)));
    await new Promise((r) => setTimeout(r, 300));
    console.log('(e) keyword, jibunAddress:', JSON.stringify(await keywordSearch(c.jibun)));
    await new Promise((r) => setTimeout(r, 300));
    console.log('(f) address 엔드포인트, jibunAddress:', JSON.stringify(await addressSearch(c.jibun)));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
