// E-JIP SCORE V2 STEP 0.7 §9 추가조사 — pilot에서 getBrRecapTitleInfo(총괄표제부)가
// 45/48(93.8%) not_found였다. 가설: 이 후보군(오래된/소규모 건물)은 여러 동으로 이뤄진
// 단지에만 존재하는 "총괄표제부"가 아니라 단일 건물 "표제부"(getBrTitleInfo)로만
// 등록돼 있을 수 있다. 실측으로 검증(추정 금지) — pilot의 not_found 5건을 표제부
// API로 재조회. READ-ONLY.
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const cases = [
  { aptSeq: '26140-63', name: '문화', sggCd: '26140', umdCd: '', dong: '토성동2가', jibun: '7-4' },
  { aptSeq: '26140-128', name: '충무제1', sggCd: '26140', umdCd: '', dong: '충무동2가', jibun: '34' },
  { aptSeq: '26350-2582', name: '협성루에나센텀', sggCd: '26350', umdCd: '', dong: '재송동', jibun: '210-10' },
  { aptSeq: '26260-56', name: '동부현대', sggCd: '26260', umdCd: '', dong: '온천동', jibun: '1680' },
  { aptSeq: '26410-319', name: '삼백크라시앙', sggCd: '26410', umdCd: '', dong: '부곡동', jibun: '225-7' },
];

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const apiKey = process.env.DATA_GO_KR_API_KEY || '';
  const cleanKey = encodeURIComponent(decodeURIComponent(apiKey.trim().replace(/['"]/g, '')));

  for (const c of cases) {
    const m = await prisma.apartmentMaster.findUnique({ where: { aptSeq: c.aptSeq }, select: { umdCd: true } });
    const umdCd = m?.umdCd;
    if (!umdCd) { console.log(`${c.aptSeq}: umdCd 없음, skip`); continue; }
    const parts = c.jibun.split('-');
    const bun = parseInt(parts[0], 10).toString().padStart(4, '0');
    const ji = (parts.length > 1 ? parseInt(parts[1], 10) : 0).toString().padStart(4, '0');

    // 표제부(단일 건물) — getBrTitleInfo
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${c.sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=5&_type=json`;
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      const json = JSON.parse(text);
      const header = json?.response?.header;
      const items = json?.response?.body?.items?.item;
      if (header?.resultCode && header.resultCode !== '00') {
        console.log(`${c.aptSeq} ${c.name}: getBrTitleInfo resultCode=${header.resultCode} ${header.resultMsg}`);
        continue;
      }
      if (!items) {
        console.log(`${c.aptSeq} ${c.name}(${c.dong} ${c.jibun}): getBrTitleInfo도 not_found`);
        continue;
      }
      const arr = Array.isArray(items) ? items : [items];
      const target = arr[0];
      console.log(`${c.aptSeq} ${c.name}(${c.dong} ${c.jibun}): getBrTitleInfo SUCCESS, ${arr.length}건, bldNm=${target.bldNm}, hhldCnt=${target.hhldCnt}, mainPurpsCdNm=${target.mainPurpsCdNm}, newPlatPlc=${target.newPlatPlc}, platPlc=${target.platPlc}, mgmBldrgstPk=${target.mgmBldrgstPk}`);
    } catch (e: any) {
      console.log(`${c.aptSeq} ${c.name}: error ${e.message}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
