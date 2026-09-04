/**
 * OFFICETEL V1 STEP 2.1 §1/§2/§3 — 건축물대장 보강 **이어받기**(READ ONLY, DB write 없음).
 *
 * 전체 재실행을 하지 않는다. enriched-candidates.json에 **이미 있는 후보는 다시 호출하지 않고**,
 * 신규 후보 집합에서 빠진 것만 보강해 병합한다.
 *
 * 신규 후보 집합(3,646)은 universe + 기존 master로부터 **결정적으로 재계산**되므로
 * (API 호출 0회) 이어받기 기준이 흔들리지 않는다.
 *
 * 사용법:
 *   verify only : ... scripts/officetel/enrich-resume.ts
 *   resume      : ... scripts/officetel/enrich-resume.ts --run
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';
import {
  buildOfficetelCanonicalKey, classifyCollision, normalizeJibun, normalizeUmd,
  registryBuildingName, registryJibun,
} from '../../src/lib/officetel/identity';

const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const UNIVERSE_PATH = path.join(OUT_DIR, 'source-universe.json');
const UNIVERSE_INC_PATH = path.join(OUT_DIR, 'universe-incomplete.json');
const ENRICH_PATH = path.join(OUT_DIR, 'enriched-candidates.json');
const REG_INC_PATH = path.join(OUT_DIR, 'registry-incomplete.json');
const EP = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const REGCODE = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';
const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];

const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number | null => { const n = Number(S(v)); return Number.isFinite(n) ? n : null; };
const posInt = (v: unknown): number | null => { const n = N(v); return n != null && n > 0 ? Math.trunc(n) : null; };
const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));

const MIN_INTERVAL_MS = 620;
const MAX_ATTEMPTS = 6;
let last = 0;
let apiCalls = 0;

async function regOnce(sgg: string, bjd: string, bun: string, ji: string) {
  const w = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
  apiCalls++;
  try {
    const u = `${EP}?serviceKey=${key()}&sigunguCd=${sgg}&bjdongCd=${bjd}&platGbCd=0&bun=${bun.padStart(4, '0')}&ji=${ji.padStart(4, '0')}&numOfRows=50&_type=json`;
    const res = await fetch(u, { signal: AbortSignal.timeout(40000) });
    const t = await res.text();
    if (!t.trim()) return { ok: false as const, reason: 'EMPTY_BODY' };
    let j: any; try { j = JSON.parse(t); } catch { return { ok: false as const, reason: 'NON_JSON' }; }
    const rc = S(j?.response?.header?.resultCode);
    if (rc !== '00' && rc !== '000') return { ok: false as const, reason: `rc=${rc}` };
    const it = j?.response?.body?.items?.item;
    return { ok: true as const, rows: it ? (Array.isArray(it) ? it : [it]) : [] };
  } catch { return { ok: false as const, reason: 'EXC' }; }
}
async function registry(sgg: string, bjd: string, bun: string, ji: string) {
  let reason = '';
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    const r = await regOnce(sgg, bjd, bun, ji);
    if (r.ok) return r;
    reason = r.reason;
    await new Promise((x) => setTimeout(x, 900 * a));
  }
  return { ok: false as const, reason };
}

function toMasterRow(row: any, sggCd: string, umdNm: string) {
  const jibun = registryJibun(row.bun, row.ji);
  const dongNm = S(row.dongNm) || null;
  const id = buildOfficetelCanonicalKey({ sggCd, umdNm, jibun, buildingDong: dongNm });
  return {
    canonicalKey: id.ok ? id.key : null,
    sggCd, umdNm, jibun, buildingDong: dongNm,
    officetelName: registryBuildingName(row.bldNm, row.dongNm),
    useApprovalDate: /^\d{8}$/.test(S(row.useAprDay)) ? S(row.useAprDay) : null,
    buildYear: posInt(S(row.useAprDay).slice(0, 4)),
    mainPurpose: S(row.mainPurpsCdNm) || null, etcPurpose: S(row.etcPurps) || null,
    hoCnt: posInt(row.hoCnt), hhldCnt: N(row.hhldCnt), totalArea: N(row.totArea),
    bcRat: N(row.bcRat), vlRat: N(row.vlRat), structureName: S(row.strctCdNm) || null,
    grndFlrCnt: posInt(row.grndFlrCnt), ugrndFlrCnt: N(row.ugrndFlrCnt),
    indrMech: N(row.indrMechUtcnt), indrAuto: N(row.indrAutoUtcnt),
    oudrMech: N(row.oudrMechUtcnt), oudrAuto: N(row.oudrAutoUtcnt),
    roadAddress: S(row.newPlatPlc) || null,
  };
}

async function main() {
  const run = process.argv.includes('--run');
  const t0 = Date.now();

  // ── §1 RESUME SAFETY ────────────────────────────────────────
  console.log('================ §1 RESUME SAFETY ================');
  const universe: any[] = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));
  const uniInc: any[] = JSON.parse(fs.readFileSync(UNIVERSE_INC_PATH, 'utf-8'));
  console.log(`  source-universe.json          : ${universe.length}건`);
  console.log(`  universe-incomplete.json      : ${uniInc.length}건 ${uniInc.length === 0 ? '(== [] 확인)' : '*** 불완전 ***'}`);
  const uniDup = universe.length - new Set(universe.map((e) => e.addrKey)).size;
  console.log(`  universe addrKey 중복         : ${uniDup}`);

  const masters = await prisma.officetelMaster.findMany({ select: { sggCd: true, normalizedUmdNm: true, normalizedJibun: true } });
  const masterAddr = new Set(masters.map((m) => `${m.sggCd}|${m.normalizedUmdNm}|${m.normalizedJibun}`));
  console.log(`  기존 master                   : ${masters.length}건 / 주소그룹 ${masterAddr.size}`);

  // 신규 후보 집합을 결정적으로 재계산(API 0회)
  const newCandidates = universe.filter((e) => !masterAddr.has(e.addrKey));
  console.log(`  신규 후보(재계산, API 0회)    : ${newCandidates.length}건`);

  const enriched: any[] = fs.existsSync(ENRICH_PATH) ? JSON.parse(fs.readFileSync(ENRICH_PATH, 'utf-8')) : [];
  const enrichedKeys = new Set(enriched.map((e) => e.addrKey));
  const enrichDup = enriched.length - enrichedKeys.size;
  console.log(`  cached enrichment             : ${enriched.length}건 (중복 ${enrichDup})`);

  const stray = enriched.filter((e) => !universe.some((u) => u.addrKey === e.addrKey)).length;
  const strayNotCandidate = [...enrichedKeys].filter((k) => masterAddr.has(k)).length;
  console.log(`  universe에 없는 enriched      : ${stray} (0이어야 함)`);
  console.log(`  이미 master 있는 enriched     : ${strayNotCandidate} (0이어야 함)`);

  const remaining = newCandidates.filter((e) => !enrichedKeys.has(e.addrKey));
  console.log(`  ▶ 남은 보강 대상              : ${remaining.length}건`);

  if (uniInc.length || uniDup || enrichDup || stray || strayNotCandidate) {
    console.log('\n*** 체크포인트 무결성 실패 — 중단 ***');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('  → 무결성 OK\n');

  if (!run) {
    console.log('verify only. 이어받기를 실행하려면 --run 을 붙인다.');
    await prisma.$disconnect();
    return;
  }

  // ── §2 RESUME REMAINING ONLY ────────────────────────────────
  console.log('================ §2 RESUME (남은 건만) ================');
  const bjd: Record<string, string> = {};
  for (const d of BUSAN_16) {
    const r = await fetch(`${REGCODE}?regcode_pattern=${d}*&is_ignore_zero=true`, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    for (const c of j.regcodes || []) {
      if (S(c.code).length !== 10 || !S(c.code).startsWith(d)) continue;
      const umd = S(c.name).split(/\s+/).slice(2).join(' ');
      if (umd) bjd[`${d}|${normalizeUmd(umd)}`] = S(c.code).slice(5, 10);
    }
    await new Promise((x) => setTimeout(x, 150));
  }

  const incomplete: any[] = fs.existsSync(REG_INC_PATH) ? JSON.parse(fs.readFileSync(REG_INC_PATH, 'utf-8')) : [];
  const merged = [...enriched];
  for (let i = 0; i < remaining.length; i++) {
    const e = remaining[i];
    const code = bjd[`${e.sggCd}|${normalizeUmd(e.umdNm)}`];
    const nj = normalizeJibun(e.jibun);
    if (!code || !nj) {
      merged.push({ addrKey: e.addrKey, sggCd: e.sggCd, umdNm: e.umdNm, jibun: e.jibun, sourceNames: e.names, registryClass: 'D_UNRESOLVED', masters: [] });
      continue;
    }
    const [bun, ji] = nj.split('-');
    const r = await registry(e.sggCd, code, bun, ji);
    if (!r.ok) { incomplete.push({ addrKey: e.addrKey, reason: r.reason }); continue; }
    let cls: string;
    let ms = r.rows.map((x: any) => toMasterRow(x, e.sggCd, e.umdNm)).filter((m) => m.canonicalKey);
    if (r.rows.length === 0) cls = 'C_NO_TITLE';
    else if (ms.length === 0) cls = 'D_UNRESOLVED';
    else {
      const distinct = new Set(ms.map((m) => m.canonicalKey));
      if (distinct.size === 1 && ms.length > 1) {
        cls = classifyCollision(ms as any) === 'AMBIGUOUS' ? 'E_CONFLICT' : 'A_SINGLE';
        if (cls === 'A_SINGLE') ms = [ms[0]];
      } else if (distinct.size === 1) cls = 'A_SINGLE';
      else cls = 'B_MULTI_DONG';
    }
    merged.push({ addrKey: e.addrKey, sggCd: e.sggCd, umdNm: e.umdNm, jibun: e.jibun, sourceNames: e.names, registryClass: cls, masters: ms });
    if ((i + 1) % 100 === 0) {
      console.log(`  ...resume ${i + 1}/${remaining.length}  불완전 ${incomplete.length}  API ${apiCalls}  ${((Date.now() - t0) / 60000).toFixed(1)}분`);
      fs.writeFileSync(ENRICH_PATH, JSON.stringify(merged));
      fs.writeFileSync(REG_INC_PATH, JSON.stringify(incomplete, null, 2));
    }
  }
  fs.writeFileSync(ENRICH_PATH, JSON.stringify(merged));
  fs.writeFileSync(REG_INC_PATH, JSON.stringify(incomplete, null, 2));

  // ── §3 COMPLETENESS GATE ────────────────────────────────────
  const finalKeys = new Set(merged.map((e) => e.addrKey));
  console.log('\n================ §3 COMPLETENESS GATE ================');
  console.log(`  expected candidates          : ${newCandidates.length}`);
  console.log(`  enriched candidates          : ${merged.length}`);
  console.log(`  duplicate candidate keys     : ${merged.length - finalKeys.size}`);
  console.log(`  incomplete registry          : ${incomplete.length}`);
  const pass = merged.length === newCandidates.length && merged.length === finalKeys.size && incomplete.length === 0;
  console.log(`  ▶ GATE : ${pass ? 'PASS' : '*** FAIL — APPLY 금지 ***'}`);
  console.log(`\n  resumed API calls            : ${apiCalls}`);
  console.log(`  resume runtime               : ${((Date.now() - t0) / 60000).toFixed(1)}분`);
  console.log(`  source universe 재수집        : 0회 (파일 재사용)`);
  console.log(`  기존 enriched 재호출          : 0회 (${enriched.length}건 skip)`);

  await prisma.$disconnect();
  if (!pass) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
