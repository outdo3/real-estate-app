/**
 * MASTER_COORDINATE_GAP_AUDIT_V1 §9·§10 — 좌표 없는 master의 **읽기 전용** geocode dry-run.
 *
 * 승인된 규칙을 그대로 쓴다(SEOUL_MASTER_COORDINATE_REVERSE_CHECK_V1):
 *   정방향  Kakao search/address `analyze_type=exact` → 지번 결과(REGION_ADDR) 중
 *           시도·구·법정동·산 여부·본번·부번이 **전부 같은 결과가 정확히 하나**일 때만 EXACT
 *   역방향  그 좌표를 coord2address → 같은 필지로 되돌아올 때만 VERIFIED
 *
 * `seed-seoul-apartment-master-logic.ts`의 두 함수는 시도를 '서울'로 고정하고 있어 부산에
 * 그대로 쓸 수 없다. 여기서는 **같은 규칙을 시도만 파라미터로 바꿔** 그대로 옮겼다(완화 없음).
 *
 * WRONG COORDINATE < NULL COORDINATE — 이름 검색·부분일치·같은 동 최근접·첫 결과·중심점은
 * 전부 쓰지 않는다. **DB write 0**: 좌표를 저장하지 않고 판정만 기록한다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-master-coordinate-geocode-dryrun.ts [--seoul-sample=10]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const OUT = path.resolve(__dirname, '../tmp/master-coordinate-gap');

export interface Lot { main: string; sub: string; mountain: boolean }

/** "844" · "50-7" · "산12-3" → 본번/부번/산. 형식이 아니면 null(추측하지 않는다). */
export function parseLot(jibun: string | null | undefined): Lot | null {
  const t = (jibun ?? '').trim();
  const m = /^(산)?\s*(\d+)(?:-(\d+))?$/.exec(t);
  if (!m) return null;
  return { mountain: !!m[1], main: String(Number(m[2])), sub: m[3] ? String(Number(m[3])) : '' };
}
const strip = (v: string) => (v ?? '').replace(/^0+(?=\d)/, '');

export type ForwardStatus = 'EXACT' | 'NO_MATCH' | 'AMBIGUOUS' | 'JIBUN_UNPARSEABLE';

/** 승인 규칙과 동일 — 시도만 파라미터. 완전 일치 결과가 정확히 하나일 때만 EXACT. */
export function matchExactLotFor(
  docs: readonly any[],
  expected: { sidoPrefix: string; districtName: string; dong: string; jibun: string }
): { status: ForwardStatus; lat: number | null; lng: number | null; address: string | null; hits: number } {
  const lot = parseLot(expected.jibun);
  if (!lot) return { status: 'JIBUN_UNPARSEABLE', lat: null, lng: null, address: null, hits: 0 };
  const hits = docs.filter((d) => {
    const a = d?.address;
    if (d?.address_type !== 'REGION_ADDR' || !a) return false;
    return String(a.region_1depth_name ?? '').startsWith(expected.sidoPrefix)
      && a.region_2depth_name === expected.districtName
      && a.region_3depth_name === expected.dong
      && (a.mountain_yn === 'Y') === lot.mountain
      && strip(a.main_address_no ?? '') === lot.main
      && (strip(a.sub_address_no ?? '') === '0' ? '' : strip(a.sub_address_no ?? '')) === lot.sub;
  });
  if (hits.length === 0) return { status: 'NO_MATCH', lat: null, lng: null, address: null, hits: 0 };
  if (hits.length > 1) return { status: 'AMBIGUOUS', lat: null, lng: null, address: null, hits: hits.length };
  const lat = Number(hits[0].y), lng = Number(hits[0].x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'NO_MATCH', lat: null, lng: null, address: null, hits: 1 };
  return { status: 'EXACT', lat, lng, address: hits[0].address_name ?? null, hits: 1 };
}

export type ReverseStatus = 'VERIFIED' | 'REVERSE_MISMATCH' | 'REVERSE_NO_RESULT';

/** 승인 규칙과 동일 — 좌표를 역조회한 필지가 목표 필지와 완전히 같을 때만 VERIFIED. */
export function verifyReverseLotFor(
  doc: any,
  expected: { sidoPrefix: string; districtName: string; dong: string; jibun: string }
): { status: ReverseStatus; reverseAddress: string | null; reason: string | null } {
  const lot = parseLot(expected.jibun);
  const a = doc?.address;
  if (!lot) return { status: 'REVERSE_NO_RESULT', reverseAddress: null, reason: 'TARGET_JIBUN_UNPARSEABLE' };
  if (!a || !a.main_address_no) return { status: 'REVERSE_NO_RESULT', reverseAddress: null, reason: 'NO_LOT_ADDRESS_AT_COORDINATE' };
  const sub = strip(a.sub_address_no ?? '');
  const diffs: string[] = [];
  if (!String(a.region_1depth_name ?? '').startsWith(expected.sidoPrefix)) diffs.push('SIDO');
  if (a.region_2depth_name !== expected.districtName) diffs.push('GU');
  if (a.region_3depth_name !== expected.dong) diffs.push('DONG');
  if ((a.mountain_yn === 'Y') !== lot.mountain) diffs.push('MOUNTAIN');
  if (strip(a.main_address_no ?? '') !== lot.main) diffs.push('MAIN_LOT');
  if ((sub === '0' ? '' : sub) !== lot.sub) diffs.push('SUB_LOT');
  return diffs.length
    ? { status: 'REVERSE_MISMATCH', reverseAddress: a.address_name ?? null, reason: diffs.join('+') }
    : { status: 'VERIFIED', reverseAddress: a.address_name ?? null, reason: null };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Kakao REST(local API)는 **REST 키**를 요구한다. 실측(2026-09-20): 기존 seed 스크립트가 쓰는
// NEXT_PUBLIC_KAKAO_MAP_API_KEY(JS 키)는 이 endpoint에서 **401**이고, KAKAO_CLIENT_ID가 200이다.
// 값은 출력하지 않는다 — 이름만 기록한다.
const KAKAO_KEY = process.env.KAKAO_CLIENT_ID || process.env.KAKAO_REST_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '';
const KAKAO_KEY_NAME = process.env.KAKAO_CLIENT_ID ? 'KAKAO_CLIENT_ID'
  : process.env.KAKAO_REST_API_KEY ? 'KAKAO_REST_API_KEY'
  : process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ? 'NEXT_PUBLIC_KAKAO_MAP_API_KEY' : '(none)';
const headers = { Authorization: `KakaoAK ${KAKAO_KEY}` };
let calls = 0;

async function forward(query: string): Promise<{ ok: boolean; docs: any[]; detail?: string }> {
  for (let i = 0; i < 3; i++) {
    calls++;
    try {
      const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=exact`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await sleep(700 * (i + 1)); continue; }
      if (!res.ok) return { ok: false, docs: [], detail: `http=${res.status}` };
      const j = await res.json();
      return { ok: true, docs: j?.documents ?? [] };
    } catch (e: any) { if (i === 2) return { ok: false, docs: [], detail: e?.name ?? 'error' }; await sleep(500); }
  }
  return { ok: false, docs: [], detail: 'RATE_LIMITED' };
}

async function reverse(lat: number, lng: number): Promise<{ ok: boolean; doc: any; detail?: string }> {
  for (let i = 0; i < 3; i++) {
    calls++;
    try {
      const res = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { await sleep(700 * (i + 1)); continue; }
      if (!res.ok) return { ok: false, doc: null, detail: `http=${res.status}` };
      const j = await res.json();
      return { ok: true, doc: (j?.documents ?? [])[0] ?? null };
    } catch (e: any) { if (i === 2) return { ok: false, doc: null, detail: e?.name ?? 'error' }; await sleep(500); }
  }
  return { ok: false, doc: null, detail: 'RATE_LIMITED' };
}

async function probe(row: any, sidoPrefix: string) {
  const expected = { sidoPrefix, districtName: row.sigungu ?? '', dong: row.dong ?? '', jibun: row.jibun ?? '' };
  const query = `${sidoPrefix} ${expected.districtName} ${expected.dong} ${expected.jibun}`;
  const f = await forward(query);
  if (!f.ok) return { ...row, query, verdict: 'ERROR', detail: f.detail };
  const fm = matchExactLotFor(f.docs, expected);
  if (fm.status !== 'EXACT') {
    return { ...row, query, verdict: fm.status === 'AMBIGUOUS' ? 'MULTIPLE' : fm.status === 'NO_MATCH' ? 'NO_RESULT' : 'REVIEW_REQUIRED',
      forwardStatus: fm.status, forwardHits: fm.hits, resultCount: f.docs.length };
  }
  await sleep(120);
  const r = await reverse(fm.lat!, fm.lng!);
  if (!r.ok) return { ...row, query, verdict: 'ERROR', detail: r.detail, forwardStatus: 'EXACT' };
  const rv = verifyReverseLotFor(r.doc, expected);
  return {
    ...row, query, resultCount: f.docs.length, forwardStatus: 'EXACT',
    candidateLat: fm.lat, candidateLng: fm.lng, forwardAddress: fm.address,
    reverseAddress: rv.reverseAddress, reverseReason: rv.reason,
    verdict: rv.status === 'VERIFIED' ? 'VERIFIED_EXACT' : rv.status === 'REVERSE_MISMATCH' ? 'REVERSE_MISMATCH' : 'NO_RESULT',
  };
}

async function main() {
  const sampleN = Number(process.argv.find((a) => a.startsWith('--seoul-sample='))?.split('=')[1] ?? 10);
  const gap = JSON.parse(fs.readFileSync(path.join(OUT, 'coordinate-gap.json'), 'utf8'));
  const rows: any[] = gap.gapRows;

  // 부산: 한 번도 strict geocode를 돌린 적 없는 후보 전부.
  const busan = rows.filter((r) => r.region === 'BUSAN' && r.recovery === 'CANDIDATE_EXACT_LOT');
  // 서울: 이미 같은 규칙으로 거부된 집합 — 표본만 돌려 "재시도해도 같다"를 확인한다.
  const seoulAll = rows.filter((r) => r.region === 'SEOUL' && r.recovery === 'PREVIOUSLY_REJECTED_STRICT');
  const seoul = [...seoulAll].sort((a, b) => b.windowRows - a.windowRows).slice(0, sampleN);

  const results: any[] = [];
  for (const r of busan) { results.push(await probe(r, '부산')); await sleep(120); }
  for (const r of seoul) { results.push(await probe(r, '서울')); await sleep(120); }

  const tally = (list: any[]) => list.reduce((m: Record<string, { n: number; rows: number }>, x) => {
    const e = (m[x.verdict] ??= { n: 0, rows: 0 }); e.n++; e.rows += x.windowRows ?? 0; return m;
  }, {});
  const b = results.filter((r) => r.region === 'BUSAN');
  const s = results.filter((r) => r.region === 'SEOUL');
  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, coordinatesStored: 0, kakaoCalls: calls, kakaoKeyEnv: KAKAO_KEY_NAME,
    rule: '정방향 analyze_type=exact 필지 완전일치 1건 + 역방향 같은 필지 복귀 — 둘 다 통과해야 VERIFIED_EXACT',
    busan: { probed: b.length, byVerdict: tally(b), verifiedRows: b.filter((x) => x.verdict === 'VERIFIED_EXACT').reduce((n, x) => n + (x.windowRows ?? 0), 0) },
    seoulSample: { probed: s.length, ofTotal: seoulAll.length, byVerdict: tally(s) },
  };
  fs.writeFileSync(path.join(OUT, 'geocode-dryrun.json'), JSON.stringify({ ...out, results }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
