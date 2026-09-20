/**
 * BUILDING_LEDGER_ZERO_HOUSEHOLD_REVIEW_POLICY_V1 — REVIEW로 남은 부산 master를 전수 분석한다.
 *
 * 핵심 질문: `mainPurpsCdNm = 공동주택`인데 `hhldCnt = 0`인 레코드가 **실제 주거동인지
 * 비주거성(상가·부속·주차·관리)인지, 공식 필드만으로 구분 가능한가?**
 *
 * 이름 문자열 추측 금지. 판정 근거는 공식 응답 필드(주/부속 구분·주용도·기타용도·호수·
 * 가구수·층수·연면적 등)로만 만든다. DB write 0 · 대장 GET만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-ledger-zero-household-policy.ts [--interval=380]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isResidentialRecord, decideHouseholds, decideRoadAddress, jibunToBunJi } from './busan-ledger-auto-safe-logic';

const OUT = path.resolve(__dirname, '../tmp/zero-household-policy');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const txt = (v: unknown) => String(v ?? '').trim();

// ───────────────────────── 0세대 공동주택 레코드 분류 (공식 필드만) ─────────────────────────

export type ZeroClass =
  | 'COMMERCIAL_OR_AMENITY' | 'PARKING_OR_AUXILIARY' | 'MANAGEMENT_SECURITY'
  | 'RESIDENTIAL_ZERO_SUSPICIOUS' | 'MIXED_USE' | 'UNRESOLVED';

export interface ZeroVerdict { cls: ZeroClass; evidence: string; excludable: boolean }

/**
 * `공동주택`으로 분류됐는데 세대수가 0인 레코드를 **공식 필드로만** 판정한다.
 *
 * 실측으로 무너진 가정: 처음에는 `hoCnt`(호수)나 `fmlyCnt`(가구수)가 0보다 크면 주거 단위가
 * 있는 것으로 봤다. 전수 대조 결과 그 반대였다 —
 *   - 기타용도가 명백히 상업(생활편익시설·구매시설·근린생활·의료)인 0세대 레코드 **77건 중 74건**이
 *     `hoCnt > 0`이고, **25건**은 `fmlyCnt > 0`이다(엘지 상가동은 가구수 60·호수 67).
 * 즉 호수·가구수는 상가 **호실**에도 그대로 쓰인다. 주거의 증거가 아니다.
 *
 * 그래서 판정 근거는 두 공식 필드로 좁힌다:
 *   1. `mainAtchGbCdNm`(주/부속 구분) — 대장 자체의 구분이라 가장 강하다
 *   2. `etcPurps`(기타용도) — 그 동이 실제로 어떤 용도인지 공식적으로 적힌 곳
 * 동 이름(`dongNm`·`bldNm`)은 판정에 쓰지 않는다.
 *
 * 호수·가구수는 **제외를 막는 쪽으로만** 쓴다: 부속건축물인데 주거 단위가 신고돼 있으면
 * 근거가 상충하므로 자동 제외하지 않는다(실측 3건 — 성도뷰크 가구수 48 등).
 */
const NON_RESIDENTIAL_USE = /생활편익|구매시설|판매시설|근린생활|상가|소매|의료|목욕|주민공동|복리|생활시설|입주자|노인정|탁아|업무시설|운동시설|종교시설|교육연구|노유자|주차|경비|관리|기계|전기|펌프|발전|MDF|엠디에프|변소|화장실|정화조|계단실|재활용|창고/;
const PARKING_USE = /주차/;
const MGMT_USE = /경비|관리|기계|전기|펌프|발전|MDF|엠디에프|변소|화장실|정화조|계단실|재활용/;
/** 그 동 **자신의** 용도가 주거라고 적힌 경우. "공동주택(경비실)"처럼 괄호 안이 실제 용도면 주거가 아니다. */
function declaresOwnResidentialUse(etc: string): boolean {
  if (!/공동주택|아파트|연립주택|다세대/.test(etc)) return false;
  const paren = etc.match(/[(（]([^)）]*)[)）]/);
  if (paren && NON_RESIDENTIAL_USE.test(paren[1])) return false; // 공동주택(경비실) 등
  return true;
}

export function classifyZeroHouseholdRecord(r: Record<string, unknown>): ZeroVerdict {
  const atch = txt(r.mainAtchGbCdNm);
  const etc = txt(r.etcPurps);
  const ho = num(r.hoCnt);
  const fmly = num(r.fmlyCnt);
  const ownResidential = declaresOwnResidentialUse(etc);

  if (atch === '부속건축물') {
    // 부속인데 주거 단위가 신고돼 있으면 근거가 상충한다 — 자동 제외하지 않는다.
    if (ho > 0 || fmly > 0) {
      return { cls: 'RESIDENTIAL_ZERO_SUSPICIOUS', evidence: `부속건축물이지만 hoCnt=${ho} · fmlyCnt=${fmly} — 근거 상충`, excludable: false };
    }
    const cls: ZeroClass = PARKING_USE.test(etc) ? 'PARKING_OR_AUXILIARY' : MGMT_USE.test(etc) ? 'MANAGEMENT_SECURITY' : 'PARKING_OR_AUXILIARY';
    return { cls, evidence: `mainAtchGbCdNm=부속건축물 · 주거단위 0${etc ? ` · etcPurps=${etc}` : ''}`, excludable: true };
  }

  // 주건축물: 기타용도가 그 동의 용도를 말한다.
  if (ownResidential) {
    return { cls: NON_RESIDENTIAL_USE.test(etc) ? 'MIXED_USE' : 'RESIDENTIAL_ZERO_SUSPICIOUS', evidence: `etcPurps=${etc} — 자기 용도로 주거를 명시`, excludable: false };
  }
  if (etc && NON_RESIDENTIAL_USE.test(etc)) {
    const cls: ZeroClass = PARKING_USE.test(etc) ? 'PARKING_OR_AUXILIARY' : MGMT_USE.test(etc) ? 'MANAGEMENT_SECURITY' : 'COMMERCIAL_OR_AMENITY';
    return { cls, evidence: `etcPurps=${etc} — 비주거 용도만 기재(hoCnt=${ho}·fmlyCnt=${fmly}는 호실 수)`, excludable: true };
  }
  return { cls: 'UNRESOLVED', evidence: `공식 필드로 판정 불가(etcPurps=${etc || '(없음)'} · mainAtchGbCdNm=${atch || '(없음)'})`, excludable: false };
}

/** POLICY B 후보 세대수 — 공식 근거로 제외 가능한 0세대 레코드만 빼고 합산한다. */
export function policyBHouseholds(records: Record<string, unknown>[]): { sum: number; excluded: number; blocked: string[] } {
  const res = records.filter(isResidentialRecord);
  const blocked: string[] = [];
  let sum = 0, excluded = 0;
  for (const r of res) {
    const h = num(r.hhldCnt);
    if (h > 0) { sum += h; continue; }
    const v = classifyZeroHouseholdRecord(r);
    if (v.excludable) excluded++;
    else blocked.push(v.cls);
  }
  return { sum, excluded, blocked };
}

/** POLICY C — 0세대 공동주택을 근거 없이 전부 제외(공격적, 위험 측정용). */
export function policyCHouseholds(records: Record<string, unknown>[]): number {
  return records.filter(isResidentialRecord).reduce((s, r) => s + num(r.hhldCnt), 0);
}

// ───────────────────────── 조회 ─────────────────────────

let apiCalls = 0, rateLimited = 0, backoffWaits = 0;

async function fetchLot(op: string, sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  return fetchAllLedgerPages(async (pageNo, numOfRows) => {
    await sleep(intervalMs);
    apiCalls++;
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${cleanKey()}&sigunguCd=${sgg}&bjdongCd=${umd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (!res.ok || /LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(text)) {
        if (res.status === 429 || res.status === 503 || /LIMITED_NUMBER/.test(text)) { rateLimited++; return { kind: 'RATE_LIMITED', detail: `http=${res.status}` } as const; }
        return { kind: 'ERROR', detail: `http=${res.status}` } as const;
      }
      const j = JSON.parse(text);
      if (j?.response?.header?.resultCode && j.response.header.resultCode !== '00') return { kind: 'ERROR', detail: 'resultCode' } as const;
      const b = j?.response?.body; const raw = b?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const t = Number(b?.totalCount);
      return { kind: 'OK', items, totalCount: Number.isFinite(t) ? t : items.length } as const;
    } catch (e) { return { kind: 'ERROR', detail: (e as Error)?.name ?? 'error' } as const; }
  });
}

async function fetchWithBackoff(op: string, sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  let last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  for (let i = 0; i < 4 && (last.status === 'RATE_LIMITED' || last.status === 'ERROR'); i++) {
    backoffWaits++; await sleep(1500 * (i + 1));
    last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  }
  return last;
}

/** §2가 요구하는 공식 필드만 골라 남긴다(원문 그대로, 가공 없음). */
const KEEP = ['mgmBldrgstPk', 'mainPurpsCd', 'mainPurpsCdNm', 'etcPurps', 'dongNm', 'bldNm', 'hhldCnt',
  'hoCnt', 'fmlyCnt', 'totPkngCnt', 'indrAutoUtcnt', 'indrMechUtcnt', 'oudrAutoUtcnt', 'oudrMechUtcnt',
  'grndFlrCnt', 'ugrndFlrCnt', 'platArea', 'archArea', 'totArea', 'vlRatEstmTotArea', 'useAprDay',
  'newPlatPlc', 'platPlc', 'mainAtchGbCd', 'mainAtchGbCdNm', 'strctCdNm', 'etcStrct',
  'regstrGbCdNm', 'regstrKindCdNm', 'atchBldCnt', 'atchBldArea', 'heit', 'vlRat', 'bcRat'] as const;

async function main() {
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 380);
  fs.mkdirSync(OUT, { recursive: true });

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-ledger-zero-household-policy.ts');
  const prisma = new PrismaClient();

  const prev = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tmp/building-ledger-paging/field-policy.json'), 'utf8'));
  const affectedSeq: string[] = prev.rows.filter((r: any) => r.aptSeq).map((r: any) => r.aptSeq);

  const masters = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, parking_per_household, road_address
       FROM apartment_masters WHERE apt_seq = ANY($1::text[]) ORDER BY apt_seq`, affectedSeq);
  }, { timeout: 300_000 });
  await prisma.$disconnect();
  console.log(`[DB] 영향 master ${masters.length}`);

  const rows: Record<string, any>[] = [];
  let scanned = 0;
  const failures: string[] = [];

  for (const m of masters) {
    scanned++;
    if (scanned % 50 === 0) console.log(`  ...${scanned}/${masters.length} (calls=${apiCalls})`);
    const bj = jibunToBunJi(String(m.jibun ?? ''));
    if (!bj || !m.umd_cd) continue;
    const op = m.basic_spec_source === 'BUILDINGHUB_GENERAL_TITLE' ? 'getBrRecapTitleInfo' : 'getBrTitleInfo';
    const paged = await fetchWithBackoff(op, m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
    if (paged.status !== 'COMPLETE') { failures.push(m.apt_seq); continue; }
    const recs = (paged.items as Record<string, unknown>[]);

    const storedH = m.total_households == null ? null : Number(m.total_households);
    const storedP = m.parking_count == null ? null : Number(m.parking_count);
    const hDec = decideHouseholds(recs, storedH);
    const rDec = decideRoadAddress(recs, m.road_address ?? null);
    const isReview = hDec.verdict === 'REVIEW_REQUIRED' || rDec.verdict === 'REVIEW_REQUIRED';

    const residential = recs.filter(isResidentialRecord);
    const zeros = residential.filter((r) => num(r.hhldCnt) === 0)
      .map((r) => ({ ...Object.fromEntries(KEEP.map((k) => [k, r[k] ?? null])), verdict: classifyZeroHouseholdRecord(r) }));

    const policyA = hDec.verdict === 'AUTO_SAFE' ? hDec.newValue as number : null;
    const b = policyBHouseholds(recs);
    const policyB = b.blocked.length === 0 && b.sum > 0 ? b.sum : null;
    const policyC = policyCHouseholds(recs) || null;

    rows.push({
      aptSeq: m.apt_seq, name: m.name, sgg: m.sgg_cd, dong: m.umd_name, jibun: m.jibun,
      source: m.basic_spec_source, records: recs.length,
      storedHouseholds: storedH, storedParking: storedP,
      storedPph: m.parking_per_household == null ? null : Number(m.parking_per_household),
      householdsVerdict: hDec.verdict, householdsReason: hDec.reason,
      roadVerdict: rDec.verdict, isReview,
      residentialRecords: residential.length, zeroHouseholdRecords: zeros.length,
      zeros,
      policyA, policyB, policyC,
      policyBExcluded: b.excluded, policyBBlocked: b.blocked,
      oldRatio: storedH && storedP && storedH > 0 ? storedP / storedH : null,
      ratioA: policyA && storedP ? storedP / policyA : null,
      ratioB: policyB && storedP ? storedP / policyB : null,
      ratioC: policyC && storedP ? storedP / policyC : null,
    });
  }

  const tally = (f: (r: any) => string | null) => rows.reduce((a: Record<string, number>, r) => { const k = f(r); if (k == null) return a; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const review = rows.filter((r) => r.isReview);
  const allZeros = rows.flatMap((r) => r.zeros as any[]);

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0,
    apiCalls, rateLimited, backoffWaits, fetchFailures: failures.length, failures,
    audited: rows.length,
    reviewMasters: review.length,
    zeroRecordsTotal: allZeros.length,
    zeroClassDistribution: allZeros.reduce((a: Record<string, number>, z) => { a[z.verdict.cls] = (a[z.verdict.cls] ?? 0) + 1; return a; }, {}),
    zeroExcludable: allZeros.filter((z) => z.verdict.excludable).length,
    householdsVerdicts: tally((r) => r.householdsVerdict),
    signals: {
      mainAtchGbCdNm: allZeros.reduce((a: Record<string, number>, z) => { const k = String(z.mainAtchGbCdNm ?? '(none)'); a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      hasHoCnt: allZeros.filter((z) => num(z.hoCnt) > 0).length,
      hasFmlyCnt: allZeros.filter((z) => num(z.fmlyCnt) > 0).length,
      hasEtcPurps: allZeros.filter((z) => txt(z.etcPurps) !== '').length,
      etcPurpsUniverse: allZeros.reduce((a: Record<string, number>, z) => { const k = txt(z.etcPurps) || '(빈값)'; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    },
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'zero-household.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, rows: rows.length, failures: failures.length }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
