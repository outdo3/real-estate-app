/**
 * OFFICETEL V1 STEP 2 §9 — 향후 SALE/RENT linkage 가능성 분석 (READ ONLY).
 *
 * 아무것도 연결하지 않는다. 다음만 측정한다:
 *   - 거래 원천 행에서 canonicalKey를 만들 수 있는 비율
 *   - master와 exact match되는 비율
 *   - unresolved 비율
 *   - 다동(multi-dong) 모호성 규모
 *
 * **구조적 쟁점**: 실거래 원천(RTMSDataSvcOffiTrade/Rent)에는 동(棟) 필드가 없다.
 * 따라서 거래 행이 만들 수 있는 키는 언제나 building-level(`...:_`)이다. 반면 master는
 * 건축물대장 `dongNm`이 있으면 동 단위 키를 갖는다. 이 둘은 **문자열이 달라 exact match가
 * 되지 않는다.** 이 스크립트는 그 규모를 정확히 재서 STEP 3 설계 입력으로 삼는다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import { prisma } from '../../src/lib/prisma';
import { buildOfficetelCanonicalKey, normalizeOfficetelName } from '../../src/lib/officetel/identity';

const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const SALE = 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade';
const RENT = 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent';
const MONTHS = ['202608', '202605', '202602'];

const S = (v: unknown): string => String(v ?? '').trim();
let last = 0;

async function fetchCell(url: string, lawdCd: string, dealYmd: string) {
  const w = Math.max(0, 380 - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
  const key = encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
  const res = await fetch(`${url}?serviceKey=${key}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=1&numOfRows=1000`, {
    headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(25000),
  });
  const o: any = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(await res.text());
  const rc = S(o?.response?.header?.resultCode);
  if (rc !== '00' && rc !== '000' && rc !== '0') return [];
  const it = o?.response?.body?.items?.item;
  return it ? (Array.isArray(it) ? it : [it]) : [];
}

async function main() {
  console.log('OFFICETEL V1 STEP 2 §9 — LINKAGE READINESS (READ ONLY)\n');

  const masters = await prisma.officetelMaster.findMany({
    select: { canonicalKey: true, sggCd: true, normalizedUmdNm: true, normalizedJibun: true, buildingDong: true, officetelName: true, normalizedName: true },
  });
  console.log(`master ${masters.length}건 로드\n`);

  const byKey = new Set(masters.map((m) => m.canonicalKey));
  // 주소(동 무시) 단위 그룹 — 거래 행이 만들 수 있는 유일한 단위
  const byAddr = new Map<string, typeof masters>();
  for (const m of masters) {
    const k = `${m.sggCd}|${m.normalizedUmdNm}|${m.normalizedJibun}`;
    const l = byAddr.get(k); if (l) l.push(m); else byAddr.set(k, [m]);
  }

  for (const [label, url, nameField] of [['SALE', SALE, 'offiNm'], ['RENT', RENT, 'offiNm']] as const) {
    const rows: any[] = [];
    for (const d of BUSAN_16) for (const ym of MONTHS) rows.push(...(await fetchCell(url, d, ym)));

    let keyable = 0, exact = 0, addrHit = 0, addrMiss = 0;
    let addrSingle = 0, addrMultiDong = 0, resolvedByName = 0, unresolvableMulti = 0;
    for (const r of rows) {
      // 거래 원천에는 동 필드가 없다 → building-level 키만 가능
      const k = buildOfficetelCanonicalKey({ sggCd: S(r.sggCd), umdNm: S(r.umdNm), jibun: S(r.jibun), buildingDong: null });
      if (!k.ok) continue;
      keyable++;
      if (byKey.has(k.key)) exact++;
      const addr = `${S(r.sggCd)}|${S(r.umdNm).replace(/\s+/g, '')}|${(() => { const m = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(S(r.jibun).replace(/\s+/g, '')); return m ? `${Number(m[1])}-${m[2] === undefined ? 0 : Number(m[2])}` : ''; })()}`;
      const g = byAddr.get(addr);
      if (!g) { addrMiss++; continue; }
      addrHit++;
      if (g.length === 1) addrSingle++;
      else {
        addrMultiDong++;
        // 표시명으로 동을 특정할 수 있는가(보조 검증 — identity 단독 근거 아님)
        const n = normalizeOfficetelName(S(r[nameField]));
        const hit = g.filter((m) => m.normalizedName === n || normalizeOfficetelName(m.buildingDong || '') === n);
        if (hit.length === 1) resolvedByName++; else unresolvableMulti++;
      }
    }
    const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(2) + '%' : '-');
    console.log(`──────── ${label} (${rows.length}행, 부산 16구 × ${MONTHS.length}개월) ────────`);
    console.log(`  canonicalKey 생성 가능      : ${keyable} (${pct(keyable, rows.length)})`);
    console.log(`  master EXACT match(키 일치) : ${exact} (${pct(exact, keyable)})`);
    console.log(`  주소(동 무시) 그룹 HIT      : ${addrHit} (${pct(addrHit, keyable)})`);
    console.log(`    └ master 1건(명확)        : ${addrSingle} (${pct(addrSingle, keyable)})`);
    console.log(`    └ master 다건(다동 모호)  : ${addrMultiDong} (${pct(addrMultiDong, keyable)})`);
    console.log(`        ├ 표시명으로 특정 가능: ${resolvedByName}`);
    console.log(`        └ 특정 불가(UNRESOLVED): ${unresolvableMulti}`);
    console.log(`  주소 그룹 MISS(master 없음) : ${addrMiss} (${pct(addrMiss, keyable)})\n`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
