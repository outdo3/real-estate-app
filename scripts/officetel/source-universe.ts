/**
 * OFFICETEL V1 STEP 2.1 §1/§7 — MOLIT 오피스텔 전용 거래 원천의 주소 universe 구축 (READ ONLY).
 *
 * 판별 기준 전환의 핵심: **MOLIT 오피스텔 전용 API에 등장한다는 사실 자체**가 그 건물이
 * 오피스텔로 거래된다는 가장 직접적인 공식 신호다. STEP 2가 쓴
 * `건축물대장 etcPurps LIKE '%오피스텔%'`은 부적합함이 실증됐다(MISS 표본 14/14가
 * 표제부는 있으나 용도 표기에 "오피스텔" 없음 — "경동윈츠타워오피스텔"조차 "업무시설").
 *
 * 확보 가능한 전체 기간을 훑는다: SALE 2006-01~, RENT 2011-01~ (STEP 1 probe로 확인한 시작월).
 *
 * §7 COMPLETENESS GATE — STEP 2에서 176개 법정동을 조용히 잃었던 실패를 반복하지 않는다:
 *   - 지수 백오프 재시도
 *   - 셀 단위 short-read 검사(fetched < totalCount 이면 불완전)
 *   - incomplete ledger 파일
 *   - 불완전 셀이 1건이라도 있으면 APPLY 금지(호출부가 판단)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import { normalizeJibun, normalizeOfficetelName, normalizeUmd } from '../../src/lib/officetel/identity';

const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const SALE = 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade';
const RENT = 'http://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent';
const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const UNIVERSE_PATH = path.join(OUT_DIR, 'source-universe.json');
const INCOMPLETE_PATH = path.join(OUT_DIR, 'universe-incomplete.json');

const S = (v: unknown): string => String(v ?? '').trim();
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));

const MIN_INTERVAL_MS = 420;
const MAX_ATTEMPTS = 5;
let last = 0;

async function once(url: string, lawdCd: string, dealYmd: string) {
  const w = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
  try {
    const res = await fetch(`${url}?serviceKey=${key()}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&pageNo=1&numOfRows=1000`, {
      headers: { Accept: 'application/xml' }, signal: AbortSignal.timeout(30000),
    });
    const t = await res.text();
    if (!t.trim()) return { ok: false as const, reason: 'EMPTY_BODY' };
    const o: any = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(t);
    if (o?.OpenAPI_ServiceResponse?.cmmMsgHeader) return { ok: false as const, reason: 'SERVICE_ERR' };
    const rc = S(o?.response?.header?.resultCode);
    if (rc !== '00' && rc !== '000' && rc !== '0') return { ok: false as const, reason: `rc=${rc}` };
    const b = o?.response?.body;
    const it = b?.items?.item;
    return { ok: true as const, total: Number(S(b?.totalCount)) || 0, rows: it ? (Array.isArray(it) ? it : [it]) : [] };
  } catch (e) {
    return { ok: false as const, reason: 'EXC' };
  }
}

async function cell(url: string, lawdCd: string, dealYmd: string) {
  let reason = '';
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    const r = await once(url, lawdCd, dealYmd);
    if (r.ok) return r;
    reason = r.reason;
    await new Promise((x) => setTimeout(x, 700 * a * a));
  }
  return { ok: false as const, reason };
}

function months(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    out.push(cur);
    const y = Number(cur.slice(0, 4)), m = Number(cur.slice(4, 6));
    cur = m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}

export interface UniverseEntry {
  addrKey: string;          // sggCd|normalizedUmd|normalizedJibun
  sggCd: string;
  umdNm: string;
  jibun: string;
  names: string[];          // 관측된 표시명(정규화) — identity 아님, 보조 검증용
  saleRows: number;
  rentRows: number;
  firstYmd: string;
  lastYmd: string;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const NOW_YM = '202609';
  const plan: [string, string, string[]][] = [
    ['SALE', SALE, months('200601', NOW_YM)],
    ['RENT', RENT, months('201101', NOW_YM)],
  ];
  const totalCells = plan.reduce((a, [, , ms]) => a + ms.length * BUSAN_16.length, 0);
  console.log(`OFFICETEL V1 STEP 2.1 §1 — SOURCE ADDRESS UNIVERSE (READ ONLY)`);
  console.log(`SALE ${plan[0][2].length}개월 / RENT ${plan[1][2].length}개월 × 16구 = ${totalCells}셀\n`);

  const uni = new Map<string, UniverseEntry>();
  const incomplete: { dataset: string; lawdCd: string; dealYmd: string; got: number; total: number; reason: string }[] = [];
  let done = 0, rows = 0;
  const t0 = Date.now();

  for (const [label, url, ms] of plan) {
    for (const ym of ms) {
      for (const d of BUSAN_16) {
        const r = await cell(url, d, ym);
        done++;
        if (!r.ok) { incomplete.push({ dataset: label, lawdCd: d, dealYmd: ym, got: 0, total: -1, reason: r.reason }); continue; }
        if (r.rows.length < r.total) incomplete.push({ dataset: label, lawdCd: d, dealYmd: ym, got: r.rows.length, total: r.total, reason: 'SHORT_READ' });
        rows += r.rows.length;
        for (const it of r.rows) {
          const nj = normalizeJibun(S(it.jibun));
          if (!nj) continue;
          const k = `${S(it.sggCd)}|${normalizeUmd(S(it.umdNm))}|${nj}`;
          let e = uni.get(k);
          if (!e) {
            e = { addrKey: k, sggCd: S(it.sggCd), umdNm: S(it.umdNm), jibun: S(it.jibun), names: [], saleRows: 0, rentRows: 0, firstYmd: ym, lastYmd: ym };
            uni.set(k, e);
          }
          const n = normalizeOfficetelName(S(it.offiNm));
          if (n && !e.names.includes(n)) e.names.push(n);
          if (label === 'SALE') e.saleRows++; else e.rentRows++;
          if (ym < e.firstYmd) e.firstYmd = ym;
          if (ym > e.lastYmd) e.lastYmd = ym;
        }
        if (done % 400 === 0) {
          const s = (Date.now() - t0) / 1000;
          console.log(`  ...${done}/${totalCells}셀  행 ${rows}  주소 ${uni.size}  불완전 ${incomplete.length}  ${(s / 60).toFixed(1)}분`);
          fs.writeFileSync(UNIVERSE_PATH, JSON.stringify([...uni.values()]));
        }
      }
    }
  }

  const list = [...uni.values()];
  fs.writeFileSync(UNIVERSE_PATH, JSON.stringify(list));
  fs.writeFileSync(INCOMPLETE_PATH, JSON.stringify(incomplete, null, 2));

  const secs = (Date.now() - t0) / 1000;
  console.log(`\n스윕 완료: ${done}셀 / 거래행 ${rows} / ${(secs / 60).toFixed(1)}분`);
  console.log(`**불완전 셀: ${incomplete.length}** ${incomplete.length ? '— 0이 아니면 universe 불완전 → APPLY 금지' : '(전수 완전 — 게이트 통과)'}`);
  if (incomplete.length) incomplete.slice(0, 20).forEach((x) => console.log(`   ${x.dataset} ${x.lawdCd}/${x.dealYmd}: ${x.got}/${x.total} (${x.reason})`));

  const saleOnly = list.filter((e) => e.saleRows > 0 && e.rentRows === 0).length;
  const rentOnly = list.filter((e) => e.saleRows === 0 && e.rentRows > 0).length;
  const both = list.filter((e) => e.saleRows > 0 && e.rentRows > 0).length;
  console.log(`\n================ §1 SOURCE ADDRESS UNIVERSE ================`);
  console.log(`  union unique address groups : ${list.length}`);
  console.log(`  SALE unique address groups  : ${list.filter((e) => e.saleRows > 0).length}`);
  console.log(`  RENT unique address groups  : ${list.filter((e) => e.rentRows > 0).length}`);
  console.log(`  SALE only / RENT only / both: ${saleOnly} / ${rentOnly} / ${both}`);
  const multiName = list.filter((e) => e.names.length > 1).length;
  console.log(`  한 주소에 표시명 2개 이상   : ${multiName} (${((multiName / list.length) * 100).toFixed(2)}%)`);
  const byDist: Record<string, number> = {};
  list.forEach((e) => { byDist[e.sggCd] = (byDist[e.sggCd] || 0) + 1; });
  console.log(`  구별: ${Object.entries(byDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join('  ')}`);
  console.log(`\n→ ${UNIVERSE_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
