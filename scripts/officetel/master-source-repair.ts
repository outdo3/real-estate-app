/**
 * OFFICETEL V1 STEP 2 — 불완전 법정동 표적 재수집 (READ ONLY).
 *
 * 전수 스윕이 남긴 incomplete-dongs.json의 법정동만 다시 훑어 candidates.json에 병합한다.
 * 전체를 다시 돌리지 않는 이유: 이미 247개 법정동은 totalCount만큼 완전히 받았고,
 * 같은 작업을 반복하면 40분과 3,600회 호출을 낭비한다.
 *
 * 원천이 EMPTY_BODY를 간헐적으로 돌려주므로(재현 확인) 간격을 더 늘리고 재시도를 늘린다.
 * 병합은 canonicalKey+지번+동 기준 중복 제거로 안전하게 한다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { buildOfficetelCanonicalKey, normalizeBuildingDong, normalizeJibun, normalizeOfficetelName, normalizeUmd, registryBuildingName, registryJibun } from '../../src/lib/officetel/identity';

const EP = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const CANDIDATES_PATH = path.join(OUT_DIR, 'candidates.json');
const INCOMPLETE_PATH = path.join(OUT_DIR, 'incomplete-dongs.json');

const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number | null => { const n = Number(S(v)); return Number.isFinite(n) ? n : null; };
const posInt = (v: unknown): number | null => { const n = N(v); return n != null && n > 0 ? Math.trunc(n) : null; };
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));

const MIN_INTERVAL_MS = 1100; // 전수 스윕(500ms)에서도 7개가 EMPTY_BODY → 더 늦춘다.
const MAX_ATTEMPTS = 8;
let last = 0;

async function once(sgg: string, bjd: string, p: number) {
  const w = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
  try {
    const res = await fetch(`${EP}?serviceKey=${key()}&sigunguCd=${sgg}&bjdongCd=${bjd}&numOfRows=100&pageNo=${p}&_type=json`, { signal: AbortSignal.timeout(60000) });
    const t = await res.text();
    if (!t.trim()) return { ok: false as const, reason: 'EMPTY_BODY' };
    let j: any; try { j = JSON.parse(t); } catch { return { ok: false as const, reason: 'NON_JSON' }; }
    const rc = S(j?.response?.header?.resultCode);
    if (rc !== '00' && rc !== '000') return { ok: false as const, reason: `rc=${rc}` };
    const b = j?.response?.body; const it = b?.items?.item;
    return { ok: true as const, total: Number(S(b?.totalCount)) || 0, rows: it ? (Array.isArray(it) ? it : [it]) : [] };
  } catch (e) { return { ok: false as const, reason: 'EXC' }; }
}
async function page(sgg: string, bjd: string, p: number) {
  let reason = '';
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    const r = await once(sgg, bjd, p);
    if (r.ok) return r;
    reason = r.reason;
    await new Promise((x) => setTimeout(x, 1200 * a));
  }
  return { ok: false as const, reason };
}

function toCandidate(row: any, sggCd: string, bjdongCd: string, umdNm: string) {
  const jibun = registryJibun(row.bun, row.ji);
  const dongNm = S(row.dongNm);
  const name = registryBuildingName(row.bldNm, row.dongNm);
  const platGbCd = S(row.platGbCd);
  const identity = platGbCd === '1'
    ? { ok: false as const, reason: 'MOUNTAIN_LOT' }
    : buildOfficetelCanonicalKey({ sggCd, umdNm, jibun, buildingDong: dongNm || null });
  return {
    sggCd, bjdongCd, umdNm, normalizedUmdNm: normalizeUmd(umdNm), jibun,
    normalizedJibun: normalizeJibun(jibun), platGbCd,
    buildingDong: dongNm || null,
    normalizedBuildingDong: dongNm ? normalizeBuildingDong(dongNm) : null,
    officetelName: name, normalizedName: normalizeOfficetelName(name),
    canonicalKey: identity.ok ? identity.key : null,
    unresolvedReason: identity.ok ? null : identity.reason,
    buildYear: posInt(row.useAprDay ? S(row.useAprDay).slice(0, 4) : null),
    mainPurpose: S(row.mainPurpsCdNm) || null, etcPurpose: S(row.etcPurps) || null,
    useApprovalDate: /^\d{8}$/.test(S(row.useAprDay)) ? S(row.useAprDay) : null,
    hoCnt: posInt(row.hoCnt), hhldCnt: N(row.hhldCnt), totalArea: N(row.totArea),
    bcRat: N(row.bcRat), vlRat: N(row.vlRat), structureName: S(row.strctCdNm) || null,
    grndFlrCnt: posInt(row.grndFlrCnt), ugrndFlrCnt: N(row.ugrndFlrCnt),
    indrMech: N(row.indrMechUtcnt), indrAuto: N(row.indrAutoUtcnt),
    oudrMech: N(row.oudrMechUtcnt), oudrAuto: N(row.oudrAutoUtcnt),
    roadAddress: S(row.newPlatPlc) || null, platPlc: S(row.platPlc) || null,
  };
}

async function main() {
  const incomplete: { dong: string; got: number; total: number; reason: string }[] = JSON.parse(fs.readFileSync(INCOMPLETE_PATH, 'utf-8'));
  const existing: any[] = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf-8'));
  console.log(`불완전 법정동 ${incomplete.length}개 표적 재수집 (기존 후보 ${existing.length}건)\n`);

  const stillIncomplete: typeof incomplete = [];
  const added: any[] = [];
  for (const inc of incomplete) {
    const [codes, umdNm] = inc.dong.split(' ');
    const [sgg, bjd] = codes.split('/');
    let got = 0, total = 0, fail = '';
    const rows: any[] = [];
    for (let p = 1; p <= 400; p++) {
      const r = await page(sgg, bjd, p);
      if (!r.ok) { fail = r.reason; break; }
      total = r.total; got += r.rows.length; rows.push(...r.rows);
      if (got >= total || r.rows.length === 0) break;
    }
    const ok = !fail && got >= total;
    console.log(`  ${inc.dong}: ${got}/${total} ${ok ? 'COMPLETE' : 'STILL_INCOMPLETE(' + (fail || 'SHORT_READ') + ')'}`);
    if (!ok) { stillIncomplete.push({ ...inc, got, total, reason: fail || 'SHORT_READ' }); continue; }
    for (const row of rows) {
      if (S(row.etcPurps).includes('오피스텔') || S(row.mainPurpsCdNm).includes('오피스텔')) {
        added.push(toCandidate(row, sgg, bjd, umdNm));
      }
    }
  }

  // 병합 — 같은 (sggCd, jibun, buildingDong, useApprovalDate, officetelName)은 중복으로 보고 1건만.
  const sig = (c: any) => `${c.sggCd}|${c.normalizedUmdNm}|${c.normalizedJibun}|${c.buildingDong ?? ''}|${c.useApprovalDate ?? ''}|${c.officetelName}`;
  const seen = new Set(existing.map(sig));
  const merged = [...existing];
  let newly = 0;
  for (const a of added) { if (seen.has(sig(a))) continue; seen.add(sig(a)); merged.push(a); newly++; }

  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(merged));
  fs.writeFileSync(INCOMPLETE_PATH, JSON.stringify(stillIncomplete, null, 2));
  console.log(`\n재수집 후보 ${added.length}건 중 신규 ${newly}건 병합 → 총 ${merged.length}건`);
  console.log(`**남은 불완전 법정동: ${stillIncomplete.length}** ${stillIncomplete.length ? '— APPLY 범위에서 제외하거나 STOP' : '(전수 완전 — APPLY 게이트 통과)'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
