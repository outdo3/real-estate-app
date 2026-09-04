/**
 * OFFICETEL V1 STEP 2.1 §2~§10 — source-driven master 확장 (DRY-RUN / APPLY).
 *
 * 판별 기준: **MOLIT 오피스텔 전용 API에 등장한 주소**가 오피스텔 후보의 primary evidence다.
 * 건축물대장은 판별 게이트가 아니라 metadata 보강(hoCnt / useAprDay / 주차 / 층 / 도로명)에만 쓴다.
 * `etcPurps LIKE '%오피스텔%'`는 inclusion gate로 쓰지 않는다(STEP 2에서 부적합 실증).
 *
 * §4 IDENTITY 분리 계약:
 *   - MASTER identity  : 건축물대장 dongNm이 명확하면 **동별 master**. building-level 강제 병합 금지.
 *   - TRADE linkage    : 거래 원천에 동이 없으므로 주소 그룹에 master가 **정확히 1개일 때만** 연결.
 *                        2개 이상이면 **UNRESOLVED**로 유지(추측 연결 금지).
 *
 * 쓰기 정책: INSERT only. 기존 canonicalKey는 skip. 기존 master를 UPDATE/분할/삭제하지 않는다.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import {
  buildOfficetelCanonicalKey, classifyCollision, masterNormalizedFields,
  normalizeJibun, normalizeOfficetelName, normalizeUmd, registryBuildingName, registryJibun,
} from '../../src/lib/officetel/identity';

const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const UNIVERSE_PATH = path.join(OUT_DIR, 'source-universe.json');
const ENRICH_PATH = path.join(OUT_DIR, 'enriched-candidates.json');
const REG_INCOMPLETE_PATH = path.join(OUT_DIR, 'registry-incomplete.json');
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

async function regOnce(sgg: string, bjd: string, bun: string, ji: string) {
  const w = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
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

type RegistryClass = 'A_SINGLE' | 'B_MULTI_DONG' | 'C_NO_TITLE' | 'D_UNRESOLVED' | 'E_CONFLICT';

interface Enriched {
  addrKey: string; sggCd: string; umdNm: string; jibun: string; sourceNames: string[];
  registryClass: RegistryClass;
  masters: any[]; // 생성 후보 master row(정규화 전 raw 필드)
}

async function buildBjdongMap(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const d of BUSAN_16) {
    const r = await fetch(`${REGCODE}?regcode_pattern=${d}*&is_ignore_zero=true`, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    for (const c of j.regcodes || []) {
      if (S(c.code).length !== 10 || !S(c.code).startsWith(d)) continue;
      const parts = S(c.name).split(/\s+/);
      const umd = parts.slice(2).join(' ');
      if (umd) map[`${d}|${normalizeUmd(umd)}`] = S(c.code).slice(5, 10);
    }
    await new Promise((x) => setTimeout(x, 150));
  }
  return map;
}

function toMasterRow(row: any, sggCd: string, umdNm: string) {
  const jibun = registryJibun(row.bun, row.ji);
  const dongNm = S(row.dongNm) || null;
  const name = registryBuildingName(row.bldNm, row.dongNm);
  const id = buildOfficetelCanonicalKey({ sggCd, umdNm, jibun, buildingDong: dongNm });
  return {
    canonicalKey: id.ok ? id.key : null,
    sggCd, umdNm, jibun, buildingDong: dongNm, officetelName: name,
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

/** 주소 그룹 기준 coverage 계산 — §2/§6/§10 공통. */
function coverage(universe: any[], masterByAddr: Map<string, any[]>, pick: (e: any) => number) {
  let exact = 0, single = 0, multi = 0, miss = 0, rowsExact = 0, rowsSingle = 0, rowsMulti = 0, rowsMiss = 0;
  for (const e of universe) {
    const n = pick(e);
    if (n === 0) continue;
    const g = masterByAddr.get(e.addrKey);
    if (!g || g.length === 0) { miss++; rowsMiss += n; continue; }
    if (g.length === 1) {
      single++; rowsSingle += n;
      // 거래 행은 동 없는 building-level 키만 만든다 → master도 dong 없을 때만 exact
      if (!g[0].buildingDong) { exact++; rowsExact += n; }
    } else { multi++; rowsMulti += n; }
  }
  return { exact, single, multi, miss, rowsExact, rowsSingle, rowsMulti, rowsMiss };
}

function printCoverage(label: string, c: ReturnType<typeof coverage>) {
  const g = c.exact + c.single + c.multi + c.miss - c.exact; // exact는 single의 부분집합
  const groups = c.single + c.multi + c.miss;
  const rows = c.rowsSingle + c.rowsMulti + c.rowsMiss;
  const p = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
  console.log(`  ${label}`);
  console.log(`    주소그룹 ${groups} | 연결가능(master 1건) ${c.single} (${p(c.single, groups)})  ├ exact ${c.exact}`);
  console.log(`              | 다동 UNRESOLVED ${c.multi} (${p(c.multi, groups)}) | MISS ${c.miss} (${p(c.miss, groups)})`);
  console.log(`    거래행   ${rows} | 연결가능 ${c.rowsSingle} (${p(c.rowsSingle, rows)}) | UNRESOLVED ${c.rowsMulti} (${p(c.rowsMulti, rows)}) | MISS ${c.rowsMiss} (${p(c.rowsMiss, rows)})`);
}

async function loadMasterByAddr() {
  const ms = await prisma.officetelMaster.findMany({
    select: { canonicalKey: true, sggCd: true, normalizedUmdNm: true, normalizedJibun: true, buildingDong: true, officetelName: true },
  });
  const m = new Map<string, typeof ms>();
  for (const x of ms) {
    const k = `${x.sggCd}|${x.normalizedUmdNm}|${x.normalizedJibun}`;
    const l = m.get(k); if (l) l.push(x); else m.set(k, [x]);
  }
  return { list: ms, byAddr: m, keys: new Set(ms.map((x) => x.canonicalKey)) };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const distArg = args.find((a) => a.startsWith('--districts='));
  const districts = distArg ? distArg.replace('--districts=', '').split(',').map((s) => s.trim()) : null;
  const skipEnrich = args.includes('--use-cached-enrich');
  if (apply && !all && !districts) throw new Error('--apply에는 --all 또는 --districts= 가 필요하다');

  const universe: any[] = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf-8'));
  const before = await loadMasterByAddr();
  console.log(`universe 주소 ${universe.length}건 / 기존 master ${before.list.length}건\n`);

  // ── §2 EXISTING MASTER COVERAGE ─────────────────────────────
  console.log('================ §2 EXISTING MASTER COVERAGE ================');
  printCoverage('SALE ', coverage(universe, before.byAddr, (e) => e.saleRows));
  printCoverage('RENT ', coverage(universe, before.byAddr, (e) => e.rentRows));
  printCoverage('UNION', coverage(universe, before.byAddr, (e) => e.saleRows + e.rentRows));

  // ── §3 NEW CANDIDATES + registry enrichment ─────────────────
  const newAddrs = universe.filter((e) => !before.byAddr.has(e.addrKey));
  console.log(`\n================ §3 NEW CANDIDATES ================`);
  console.log(`master에 없는 주소 그룹: ${newAddrs.length}`);

  let enriched: Enriched[];
  if (skipEnrich && fs.existsSync(ENRICH_PATH)) {
    enriched = JSON.parse(fs.readFileSync(ENRICH_PATH, 'utf-8'));
    console.log(`(캐시된 enrichment ${enriched.length}건 사용)`);
  } else {
    const bjd = await buildBjdongMap();
    enriched = [];
    const incomplete: any[] = [];
    const t0 = Date.now();
    for (let i = 0; i < newAddrs.length; i++) {
      const e = newAddrs[i];
      const code = bjd[`${e.sggCd}|${normalizeUmd(e.umdNm)}`];
      if (!code) { enriched.push({ ...e, sourceNames: e.names, registryClass: 'D_UNRESOLVED', masters: [] }); continue; }
      const nj = normalizeJibun(e.jibun);
      if (!nj) { enriched.push({ ...e, sourceNames: e.names, registryClass: 'D_UNRESOLVED', masters: [] }); continue; }
      const [bun, ji] = nj.split('-');
      const r = await registry(e.sggCd, code, bun, ji);
      if (!r.ok) { incomplete.push({ addrKey: e.addrKey, reason: r.reason }); continue; }
      const rows = r.rows;
      let cls: RegistryClass;
      let masters: any[] = [];
      if (rows.length === 0) cls = 'C_NO_TITLE';
      else {
        masters = rows.map((x: any) => toMasterRow(x, e.sggCd, e.umdNm)).filter((m) => m.canonicalKey);
        const distinctKeys = new Set(masters.map((m) => m.canonicalKey));
        if (masters.length === 0) cls = 'D_UNRESOLVED';
        else if (distinctKeys.size === 1 && masters.length > 1) {
          cls = classifyCollision(masters as any) === 'AMBIGUOUS' ? 'E_CONFLICT' : 'A_SINGLE';
          if (cls === 'A_SINGLE') masters = [masters[0]];
        }
        else if (distinctKeys.size === 1) cls = 'A_SINGLE';
        else cls = 'B_MULTI_DONG';
      }
      enriched.push({ addrKey: e.addrKey, sggCd: e.sggCd, umdNm: e.umdNm, jibun: e.jibun, sourceNames: e.names, registryClass: cls, masters });
      if ((i + 1) % 200 === 0) {
        console.log(`  ...enrich ${i + 1}/${newAddrs.length}  불완전 ${incomplete.length}  ${((Date.now() - t0) / 60000).toFixed(1)}분`);
        fs.writeFileSync(ENRICH_PATH, JSON.stringify(enriched));
      }
    }
    fs.writeFileSync(ENRICH_PATH, JSON.stringify(enriched));
    fs.writeFileSync(REG_INCOMPLETE_PATH, JSON.stringify(incomplete, null, 2));
    console.log(`\n**registry 조회 불완전: ${incomplete.length}** ${incomplete.length ? '— APPLY 금지' : '(게이트 통과)'}`);
  }

  const tally: Record<string, number> = {};
  enriched.forEach((e) => { tally[e.registryClass] = (tally[e.registryClass] || 0) + 1; });
  console.log(`registry 분류: ${JSON.stringify(tally)}`);

  // ── §5 RECONCILIATION (기존 master가 있는 주소에서 구조 변화) ─
  console.log(`\n================ §5 RECONCILIATION ================`);
  console.log('기존 master는 UPDATE/분할하지 않는다. 구조 변화만 NEEDS_REVIEW로 보고한다.');
  console.log(`  (이번 확장은 master가 없는 주소만 대상이므로 기존 행 변경 경로가 없다)`);

  // ── INSERT 대상 산출 ────────────────────────────────────────
  let toInsert: any[] = [];
  for (const e of enriched) {
    if (e.registryClass === 'C_NO_TITLE' || e.registryClass === 'D_UNRESOLVED' || e.registryClass === 'E_CONFLICT') continue;
    for (const m of e.masters) {
      if (!m.canonicalKey || before.keys.has(m.canonicalKey)) continue;
      toInsert.push(m);
    }
  }
  // 같은 canonicalKey 중복 제거(동일 키가 여러 주소에서 나올 수 없지만 방어)
  const seen = new Set<string>();
  toInsert = toInsert.filter((m) => (seen.has(m.canonicalKey) ? false : (seen.add(m.canonicalKey), true)));
  if (districts) toInsert = toInsert.filter((m) => districts.includes(m.sggCd));

  console.log(`\n================ §6 DRY-RUN 예상 ================`);
  console.log(`  INSERT 대상: ${toInsert.length}` + (districts ? ` (구 ${districts.join(',')})` : ''));

  // 예상 coverage — 신규 master를 가상으로 더한 상태
  const projected = new Map(before.byAddr);
  for (const m of toInsert) {
    const k = `${m.sggCd}|${normalizeUmd(m.umdNm)}|${normalizeJibun(m.jibun)}`;
    const l = projected.get(k);
    const row = { canonicalKey: m.canonicalKey, buildingDong: m.buildingDong } as any;
    if (l) projected.set(k, [...l, row]); else projected.set(k, [row]);
  }
  console.log('  ── 신규 master 추가 후 예상 coverage ──');
  printCoverage('SALE ', coverage(universe, projected, (e) => e.saleRows));
  printCoverage('RENT ', coverage(universe, projected, (e) => e.rentRows));

  if (!apply) { console.log('\nDRY-RUN — Production write 없음.'); await prisma.$disconnect(); return; }

  // ── APPLY (INSERT only) ─────────────────────────────────────
  console.log(`\n================ APPLY (INSERT only) ================`);
  const beforeCount = await prisma.officetelMaster.count();
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const res = await prisma.officetelMaster.createMany({
      data: chunk.map((c) => {
        const n = masterNormalizedFields({ umdNm: c.umdNm, jibun: c.jibun, buildingDong: c.buildingDong, officetelName: c.officetelName });
        return {
          canonicalKey: c.canonicalKey, sggCd: c.sggCd, umdNm: c.umdNm,
          normalizedUmdNm: n.normalizedUmdNm, jibun: c.jibun, normalizedJibun: n.normalizedJibun as string,
          buildingDong: c.buildingDong, normalizedBuildingDong: n.normalizedBuildingDong,
          officetelName: c.officetelName, normalizedName: normalizeOfficetelName(c.officetelName),
          buildYear: c.buildYear,
          buildingRegistryMainPurpose: c.mainPurpose, buildingRegistryEtcPurpose: c.etcPurpose,
          useApprovalDate: c.useApprovalDate, hoCnt: c.hoCnt,
          totalArea: c.totalArea != null ? new Prisma.Decimal(c.totalArea) : null,
          buildingCoverageRatio: c.bcRat, floorAreaRatio: c.vlRat, structureName: c.structureName,
          groundFloorCount: c.grndFlrCnt, undergroundFloorCount: c.ugrndFlrCnt,
          indoorMechanicalParking: c.indrMech, indoorAutoParking: c.indrAuto,
          outdoorMechanicalParking: c.oudrMech, outdoorAutoParking: c.oudrAuto,
          roadAddress: c.roadAddress, latitude: null, longitude: null,
        };
      }),
      skipDuplicates: true,
    });
    inserted += res.count;
  }
  const afterCount = await prisma.officetelMaster.count();
  console.log(`  inserted reported : ${inserted}`);
  console.log(`  master ${beforeCount} -> ${afterCount} (delta ${afterCount - beforeCount})`);
  console.log(`  일치 여부         : ${afterCount - beforeCount === inserted ? 'OK' : '*** MISMATCH ***'}`);

  // ── §10 POST-APPLY LINKAGE READINESS ────────────────────────
  const after = await loadMasterByAddr();
  console.log(`\n================ §10 POST-APPLY LINKAGE READINESS ================`);
  printCoverage('SALE ', coverage(universe, after.byAddr, (e) => e.saleRows));
  printCoverage('RENT ', coverage(universe, after.byAddr, (e) => e.rentRows));

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
