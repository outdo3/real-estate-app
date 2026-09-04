/**
 * OFFICETEL V1 STEP 2 §1/§2/§4/§5 — 건축물대장 표제부 전수 스윕 + 후보 감사 (READ ONLY).
 *
 * 무엇을 하는가:
 *   1. 부산 16개 구의 법정동(254개)을 regcode에서 확보
 *   2. 각 법정동의 건축물대장 표제부(getBrTitleInfo)를 **전수 페이지네이션**으로 훑는다
 *   3. etcPurps 또는 mainPurpsCdNm에 "오피스텔"이 포함된 건물만 후보로 남긴다
 *   4. §1 원천 감사 / §2 buildingDong 패턴 / §4 canonicalKey 충돌 통계를 낸다
 *   5. 후보를 JSON으로 저장한다(다음 단계의 dry-run/apply 입력)
 *
 * Production DB write 없음. GET 요청만 한다.
 *
 * "오피스텔"이라는 말의 의미: 이 스크립트가 판정하는 것은 **건축물대장상 오피스텔 용도**
 * 까지다. 실제 주거용 사용 여부 / 세법상 주거용 / 주택수 포함 여부는 추론하지 않는다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/officetel/master-source-audit.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { buildOfficetelCanonicalKey, normalizeBuildingDong, normalizeJibun, normalizeOfficetelName, normalizeUmd } from '../../src/lib/officetel/identity';

const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const EP = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const REGCODE = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';
const OUT_DIR = path.resolve(__dirname, '_officetel_master_results');
const CANDIDATES_PATH = path.join(OUT_DIR, 'candidates.json');

const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number | null => {
  const n = Number(S(v));
  return Number.isFinite(n) ? n : null;
};
const posInt = (v: unknown): number | null => {
  const n = N(v);
  return n != null && n > 0 ? Math.trunc(n) : null;
};

const key = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));

const MIN_INTERVAL_MS = 500; // 첫 스윕(330ms)에서 254개 중 176개 법정동이 간헐 실패 → 간격을 늘렸다.
const MAX_ATTEMPTS = 4;

let last = 0;
async function fetchPageOnce(sigunguCd: string, bjdongCd: string, pageNo: number) {
  const w = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  if (w) await new Promise((r) => setTimeout(r, w));
  last = Date.now();
  const url = `${EP}?serviceKey=${key()}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&numOfRows=100&pageNo=${pageNo}&_type=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    if (!text.trim()) return { ok: false as const, reason: 'EMPTY_BODY' };
    let j: any;
    try { j = JSON.parse(text); } catch { return { ok: false as const, reason: 'NON_JSON' }; }
    const rc = S(j?.response?.header?.resultCode);
    if (rc !== '00' && rc !== '000') return { ok: false as const, reason: `rc=${rc} ${S(j?.response?.header?.resultMsg)}` };
    const body = j?.response?.body;
    const it = body?.items?.item;
    return { ok: true as const, total: Number(S(body?.totalCount)) || 0, rows: it ? (Array.isArray(it) ? it : [it]) : [] };
  } catch (e) {
    return { ok: false as const, reason: 'EXC:' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * 지수 백오프 재시도. 첫 스윕에서 실패한 법정동을 개별 재조회하면 정상 응답이 오는 것을
 * 확인했다 — 즉 실패는 영구적이지 않고 **원천 쪽 간헐 스로틀**이다. 재시도 없이 한 페이지
 * 실패로 법정동 전체를 버리면 후보 집합이 조용히 불완전해진다(첫 스윕에서 실제로 발생).
 */
async function fetchPage(sigunguCd: string, bjdongCd: string, pageNo: number) {
  let lastReason = '';
  for (let a = 1; a <= MAX_ATTEMPTS; a++) {
    const r = await fetchPageOnce(sigunguCd, bjdongCd, pageNo);
    if (r.ok) return r;
    lastReason = r.reason;
    await new Promise((x) => setTimeout(x, 800 * a * a)); // 0.8s, 3.2s, 7.2s
  }
  return { ok: false as const, reason: lastReason };
}

/** regcode 전체명("부산광역시 해운대구 좌동")에서 시/도·시군구를 떼어 MOLIT umdNm과 같은 표기를 만든다.
 *  기장군처럼 "일광읍 삼성리" 복합 표기도 그대로 보존된다(실측: MOLIT도 같은 문자열). */
function umdFromRegcodeName(fullName: string): string {
  const parts = S(fullName).split(/\s+/);
  return parts.length > 2 ? parts.slice(2).join(' ') : '';
}

export interface MasterCandidate {
  sggCd: string;
  bjdongCd: string;
  umdNm: string;
  normalizedUmdNm: string;
  jibun: string;
  normalizedJibun: string | null;
  platGbCd: string;
  buildingDong: string | null;
  normalizedBuildingDong: string | null;
  officetelName: string;
  normalizedName: string;
  canonicalKey: string | null;
  unresolvedReason: string | null;
  buildYear: number | null;
  mainPurpose: string | null;
  etcPurpose: string | null;
  useApprovalDate: string | null;
  hoCnt: number | null;
  hhldCnt: number | null;
  totalArea: number | null;
  bcRat: number | null;
  vlRat: number | null;
  structureName: string | null;
  grndFlrCnt: number | null;
  ugrndFlrCnt: number | null;
  indrMech: number | null;
  indrAuto: number | null;
  oudrMech: number | null;
  oudrAuto: number | null;
  roadAddress: string | null;
  platPlc: string | null;
}

function toCandidate(row: any, sggCd: string, bjdongCd: string, umdNm: string): MasterCandidate {
  const bun = S(row.bun).replace(/^0+/, '') || '0';
  const ji = S(row.ji).replace(/^0+/, '') || '0';
  const jibun = ji === '0' ? bun : `${bun}-${ji}`;
  // bldNm이 비어 있으면 dongNm이 실질 건물명 역할을 하는 경우가 있다(실측: 대연동 62-14).
  const bldNm = S(row.bldNm);
  const dongNm = S(row.dongNm);
  const name = bldNm || dongNm || '';
  const platGbCd = S(row.platGbCd);
  const normalizedJibun = normalizeJibun(jibun);
  // platGbCd '1'은 산 지번 — canonicalKey가 대지/산을 구분하지 못하므로 resolve하지 않는다.
  const identity =
    platGbCd === '1'
      ? { ok: false as const, reason: 'MOUNTAIN_LOT' }
      : buildOfficetelCanonicalKey({ sggCd, umdNm, jibun, buildingDong: dongNm || null });
  return {
    sggCd, bjdongCd, umdNm,
    normalizedUmdNm: normalizeUmd(umdNm),
    jibun,
    normalizedJibun,
    platGbCd,
    buildingDong: dongNm || null,
    normalizedBuildingDong: dongNm ? normalizeBuildingDong(dongNm) : null,
    officetelName: name,
    normalizedName: normalizeOfficetelName(name),
    canonicalKey: identity.ok ? identity.key : null,
    unresolvedReason: identity.ok ? null : identity.reason,
    buildYear: posInt(row.useAprDay ? S(row.useAprDay).slice(0, 4) : null),
    mainPurpose: S(row.mainPurpsCdNm) || null,
    etcPurpose: S(row.etcPurps) || null,
    useApprovalDate: /^\d{8}$/.test(S(row.useAprDay)) ? S(row.useAprDay) : null,
    hoCnt: posInt(row.hoCnt),
    hhldCnt: N(row.hhldCnt),
    totalArea: N(row.totArea),
    bcRat: N(row.bcRat),
    vlRat: N(row.vlRat),
    structureName: S(row.strctCdNm) || null,
    grndFlrCnt: posInt(row.grndFlrCnt),
    ugrndFlrCnt: N(row.ugrndFlrCnt),
    indrMech: N(row.indrMechUtcnt),
    indrAuto: N(row.indrAutoUtcnt),
    oudrMech: N(row.oudrMechUtcnt),
    oudrAuto: N(row.oudrAutoUtcnt),
    roadAddress: S(row.newPlatPlc) || null,
    platPlc: S(row.platPlc) || null,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('OFFICETEL V1 STEP 2 — 건축물대장 표제부 전수 스윕 (READ ONLY)\n');

  // 1) 법정동 목록
  const dongs: { sggCd: string; bjdongCd: string; umdNm: string }[] = [];
  for (const sgg of BUSAN_16) {
    const r = await fetch(`${REGCODE}?regcode_pattern=${sgg}*&is_ignore_zero=true`, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    for (const c of j.regcodes || []) {
      if (!S(c.code).startsWith(sgg) || S(c.code).length !== 10) continue;
      const umd = umdFromRegcodeName(S(c.name));
      if (!umd) continue;
      dongs.push({ sggCd: sgg, bjdongCd: S(c.code).slice(5, 10), umdNm: umd });
    }
    await new Promise((x) => setTimeout(x, 150));
  }
  console.log(`법정동 ${dongs.length}개 확보\n`);

  // 2) 전수 스윕
  const candidates: MasterCandidate[] = [];
  const incomplete: { dong: string; got: number; total: number; reason: string }[] = [];
  let scanned = 0, calls = 0;
  const t0 = Date.now();
  for (let i = 0; i < dongs.length; i++) {
    const d = dongs[i];
    let got = 0, total = 0, failReason = '';
    for (let p = 1; p <= 400; p++) {
      const r = await fetchPage(d.sggCd, d.bjdongCd, p);
      calls++;
      if (!r.ok) { failReason = r.reason; break; }
      total = r.total;
      got += r.rows.length;
      for (const row of r.rows) {
        const etc = S(row.etcPurps);
        const main = S(row.mainPurpsCdNm);
        if (etc.includes('오피스텔') || main.includes('오피스텔')) {
          candidates.push(toCandidate(row, d.sggCd, d.bjdongCd, d.umdNm));
        }
      }
      if (got >= total || r.rows.length === 0) break;
    }
    // 완전성 판정: totalCount만큼 못 받았으면 그 법정동은 **불완전**이다.
    if (failReason || got < total) incomplete.push({ dong: `${d.sggCd}/${d.bjdongCd} ${d.umdNm}`, got, total, reason: failReason || 'SHORT_READ' });
    scanned += got;
    if ((i + 1) % 25 === 0) {
      const secs = (Date.now() - t0) / 1000;
      console.log(`  ...${i + 1}/${dongs.length} 법정동  스캔 ${scanned}건  후보 ${candidates.length}건  불완전 ${incomplete.length}  calls ${calls}  ${secs.toFixed(0)}s`);
      fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates));
    }
  }
  fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(candidates));
  fs.writeFileSync(path.join(OUT_DIR, 'incomplete-dongs.json'), JSON.stringify(incomplete, null, 2));
  const secs = (Date.now() - t0) / 1000;
  console.log(`\n스윕 완료: 법정동 ${dongs.length} / 건축물 ${scanned}건 스캔 / API ${calls}회 / ${(secs / 60).toFixed(1)}분`);
  console.log(`**불완전 법정동: ${incomplete.length}** ${incomplete.length ? '— 0이 아니면 후보 집합이 불완전하므로 APPLY 금지' : '(전수 완전)'}`);
  if (incomplete.length) incomplete.slice(0, 20).forEach((x) => console.log(`   ${x.dong}: ${x.got}/${x.total} (${x.reason})`));
  console.log(`오피스텔 후보: ${candidates.length}건 → ${CANDIDATES_PATH}\n`);

  printAudit(candidates);
}

export function printAudit(c: MasterCandidate[]) {
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(2) + '%' : '-');

  console.log('================ §1 SOURCE AUDIT ================');
  console.log(`total source rows(후보)      : ${c.length}`);
  const addr = new Set(c.map((x) => `${x.sggCd}|${x.normalizedUmdNm}|${x.normalizedJibun}`));
  console.log(`unique sggCd+umd+jibun       : ${addr.size}`);
  const withDong = c.filter((x) => x.buildingDong).length;
  console.log(`buildingDong 있음 / 없음     : ${withDong} / ${c.length - withDong}  (${pct(withDong, c.length)})`);

  const byAddr = new Map<string, MasterCandidate[]>();
  for (const x of c) {
    const k = `${x.sggCd}|${x.normalizedUmdNm}|${x.normalizedJibun}`;
    const l = byAddr.get(k); if (l) l.push(x); else byAddr.set(k, [x]);
  }
  const multi = [...byAddr.values()].filter((g) => g.length > 1);
  console.log(`동일 지번 다동 건물          : ${multi.length} 지번 (${pct(multi.length, byAddr.size)})`);
  const multiShape = { allNamed: 0, allUnnamed: 0, mixed: 0 };
  for (const g of multi) {
    const named = g.filter((x) => x.buildingDong).length;
    if (named === g.length) multiShape.allNamed++;
    else if (named === 0) multiShape.allUnnamed++;
    else multiShape.mixed++;
  }
  console.log(`  └ 전부 동명 있음 / 전부 없음 / 혼합 : ${multiShape.allNamed} / ${multiShape.allUnnamed} / ${multiShape.mixed}`);

  console.log(`malformed jibun(파싱 실패)   : ${c.filter((x) => !x.normalizedJibun).length}`);
  console.log(`산 지번(platGbCd=1)          : ${c.filter((x) => x.platGbCd === '1').length}`);
  console.log(`unresolved(키 생성 실패)     : ${c.filter((x) => !x.canonicalKey).length}`);
  const ur: Record<string, number> = {};
  c.filter((x) => !x.canonicalKey).forEach((x) => { ur[x.unresolvedReason || '?'] = (ur[x.unresolvedReason || '?'] || 0) + 1; });
  if (Object.keys(ur).length) console.log(`  └ 사유: ${JSON.stringify(ur)}`);

  console.log(`hoCnt 있음                   : ${c.filter((x) => x.hoCnt != null).length} (${pct(c.filter((x) => x.hoCnt != null).length, c.length)})`);
  console.log(`hhldCnt > 0                  : ${c.filter((x) => (x.hhldCnt ?? 0) > 0).length} (오피스텔은 0이어야 정상)`);
  console.log(`useApprovalDate 있음         : ${c.filter((x) => x.useApprovalDate).length} (${pct(c.filter((x) => x.useApprovalDate).length, c.length)})`);
  console.log(`roadAddress 있음             : ${c.filter((x) => x.roadAddress).length} (${pct(c.filter((x) => x.roadAddress).length, c.length)})`);
  console.log(`건물명 비어있음              : ${c.filter((x) => !x.officetelName).length}`);
  console.log(`좌표(건축물대장 제공)        : 0 — 이 API는 좌표를 제공하지 않는다(추정 금지 → latitude/longitude는 NULL)`);

  const mixedPurpose = [...byAddr.values()].filter((g) => new Set(g.map((x) => x.etcPurpose || '')).size > 1).length;
  console.log(`동일 지번 etcPurps 혼합      : ${mixedPurpose} 지번`);

  console.log('\n--- 구별 후보 분포 ---');
  const byDist: Record<string, number> = {};
  c.forEach((x) => { byDist[x.sggCd] = (byDist[x.sggCd] || 0) + 1; });
  Object.entries(byDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n================ §4 IDENTITY COLLISION AUDIT ================');
  const byKey = new Map<string, MasterCandidate[]>();
  for (const x of c) { if (!x.canonicalKey) continue; const l = byKey.get(x.canonicalKey); if (l) l.push(x); else byKey.set(x.canonicalKey, [x]); }
  const coll = [...byKey.entries()].filter(([, g]) => g.length > 1);
  console.log(`distinct canonicalKey        : ${byKey.size}`);
  console.log(`canonicalKey collision       : ${coll.length} 키 (행 ${coll.reduce((a, [, g]) => a + g.length, 0)})`);
  const diff = { name: 0, useAprDay: 0, hoCnt: 0, etcPurps: 0, identical: 0 };
  for (const [, g] of coll) {
    const d = (f: (x: MasterCandidate) => unknown) => new Set(g.map((x) => String(f(x) ?? ''))).size > 1;
    let any = false;
    if (d((x) => x.officetelName)) { diff.name++; any = true; }
    if (d((x) => x.useApprovalDate)) { diff.useAprDay++; any = true; }
    if (d((x) => x.hoCnt)) { diff.hoCnt++; any = true; }
    if (d((x) => x.etcPurpose)) { diff.etcPurps++; any = true; }
    if (!any) diff.identical++;
  }
  console.log(`  └ 같은 키인데 다른 값: ${JSON.stringify(diff)}`);
  console.log(`     (identical = 완전 동일 중복행 → 안전하게 1건으로 collapse 가능)`);
  coll.slice(0, 8).forEach(([k, g]) => {
    console.log(`     ${k}`);
    g.forEach((x) => console.log(`        name="${x.officetelName}" dong="${x.buildingDong ?? ''}" useApr=${x.useApprovalDate} hoCnt=${x.hoCnt} etc="${x.etcPurpose}"`));
  });

  console.log('\n================ §5 DRY-RUN 예상 ================');
  const resolved = c.filter((x) => x.canonicalKey);
  const ambiguous = coll.filter(([, g]) => new Set(g.map((x) => `${x.officetelName}|${x.useApprovalDate}|${x.hoCnt}|${x.etcPurpose}`)).size > 1);
  console.log(`candidate rows               : ${c.length}`);
  console.log(`resolved rows                : ${resolved.length}`);
  console.log(`unresolved rows              : ${c.length - resolved.length}`);
  console.log(`duplicate collapsed          : ${resolved.length - byKey.size}`);
  console.log(`ambiguous collision(STOP 후보): ${ambiguous.length}`);
  console.log(`==> 예상 INSERT(distinct key): ${byKey.size - ambiguous.length}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
