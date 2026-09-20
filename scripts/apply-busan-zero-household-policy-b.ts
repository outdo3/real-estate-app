/**
 * BUSAN_ZERO_HOUSEHOLD_POLICY_B_APPLY_V1 — POLICY B로 확정된 부산 master의 **세대수**와,
 * 그에 딸린 **파생 주차비율만** 보정한다.
 *
 * 승인 범위(사용자 승인 완료):
 *   A. `total_households`      정확히 **37** master
 *   B. `parking_per_household` 정확히 **34** 행 — 위 37 안에서, **기존 값이 있을 때만**
 *      새 값 = `parking_count / 보정된 세대수`
 *
 * **`parking_count`는 읽기 전용 증거다. 절대 쓰지 않는다.** FAR · BCR · buildingCount ·
 * approvalDate · roadAddress · 좌표 · identity · 캐시 · 서울 · sale · cancellation 전부 불변.
 *
 * 대상 재생성(§2): 감사 artifact를 믿지 않는다. 현재 Production master + safe pager로
 * 대장을 다시 조회해 POLICY B 판정을 처음부터 다시 만든다. 37 / 34가 아니면 멈춘다.
 *
 * 안전장치:
 *   1. 전수 재생성 — 감사 파일 미사용
 *   2. 한보장산(26350-52) · roadAddress-only REVIEW · UNKNOWN · 기존 AUTO 42 · ALREADY_OK는
 *      대상 집합에서 구조적으로 배제되고, STOP 규칙이 한 번 더 확인한다
 *   3. severe 4건(엘지·대림2·대림·삼호가든맨션) 기대값 사전 대조
 *   4. rollback artifact를 **쓰기 전에** 생성
 *   5. 행마다 optimistic guard — 세대수는 기대 old와 같을 때만, 파생비율은 `parking_count`와
 *      옛 비율이 **둘 다** 일치할 때만. 하나라도 어긋나면 트랜잭션 전체 롤백
 *
 * 기본은 DRY RUN. 실제 쓰기는 `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1`.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/apply-busan-zero-household-policy-b.ts
 *   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/apply-busan-zero-household-policy-b.ts \
 *     --apply --expect-households=37 --expect-ratio=34
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isNumberedBuildingUnit } from '../src/lib/apt-building-info';
import { decideGeneralTitle, decideTitleFallback, LENIENT_POLICY } from './backfill-basic-data-logic';
import { isResidentialRecord, jibunToBunJi } from './busan-ledger-auto-safe-logic';
import { classifyZeroHouseholdRecord } from './audit-ledger-zero-household-policy';

const OUT = path.resolve(__dirname, '../tmp/zero-household-apply');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 반드시 제외되어야 하는 단지 — 공식 근거가 상충한다(부속건축물인데 호수 1 신고). */
export const MUST_EXCLUDE = new Set(['26350-52']);

/** §6 쓰기 전 대조할 기대값. 하나라도 다르면 멈춘다. */
export const SEVERE_EXPECTED: Record<string, { name: string; oldH: number; newH: number; parking: number }> = {
  '26350-131': { name: '엘지', oldH: 48, newH: 1848, parking: 1984 },
  '26350-112': { name: '대림2', oldH: 42, newH: 682, parking: 708 },
  '26350-111': { name: '대림', oldH: 104, newH: 1424, parking: 1541 },
  '26350-15': { name: '삼호가든맨션', oldH: 90, newH: 1076, parking: 743 },
};

export interface PolicyBOutcome { newHouseholds: number | null; excluded: number; blocked: string[]; evidence: string[] }

/**
 * POLICY B — 공식 근거로 비주거/부속임이 확정된 0세대 레코드만 제외하고 주거 세대수를 합산한다.
 * 근거 없는 0세대가 하나라도 남으면 값을 만들지 않는다.
 */
export function policyBOutcome(records: Record<string, unknown>[]): PolicyBOutcome {
  const res = records.filter(isResidentialRecord);
  const blocked: string[] = [];
  const evidence: string[] = [];
  let sum = 0, excluded = 0;
  for (const r of res) {
    const h = num(r.hhldCnt);
    if (h > 0) { sum += h; continue; }
    const v = classifyZeroHouseholdRecord(r);
    if (v.excludable) { excluded++; evidence.push(`${v.cls}: ${v.evidence}`); }
    else blocked.push(v.cls);
  }
  return { newHouseholds: blocked.length === 0 && sum > 0 ? sum : null, excluded, blocked, evidence };
}

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

/** rate limit는 실패가 아니라 대기 신호다 — 물러섰다 다시 부른다(집합 축소 측정 방지). */
async function fetchWithBackoff(op: string, sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  let last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  for (let i = 0; i < 4 && (last.status === 'RATE_LIMITED' || last.status === 'ERROR'); i++) {
    backoffWaits++; await sleep(1500 * (i + 1));
    last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  }
  return last;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 380);
  const expectH = Number(process.argv.find((a) => a.startsWith('--expect-households='))?.split('=')[1] ?? NaN);
  const expectR = Number(process.argv.find((a) => a.startsWith('--expect-ratio='))?.split('=')[1] ?? NaN);
  const reuse = process.argv.find((a) => a.startsWith('--reuse='))?.split('=')[1];
  const retry = process.argv.find((a) => a.startsWith('--retry='))?.split('=')[1];
  fs.mkdirSync(OUT, { recursive: true });

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'apply-busan-zero-household-policy-b.ts');
  const prisma = new PrismaClient();

  const masters = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND basic_spec_source IN ('BUILDINGHUB_TITLE','BUILDINGHUB_GENERAL_TITLE')
       ORDER BY apt_seq`);
  }, { timeout: 600_000 });
  console.log(`[DB] 부산 TITLE/GENERAL master ${masters.length}`);

  let targets: Record<string, any>[] = [];
  let scanned = 0;
  let failures: string[] = [];

  if (reuse && fs.existsSync(reuse)) {
    const prev = JSON.parse(fs.readFileSync(reuse, 'utf8'));
    targets = prev.targets; scanned = prev.scanned; failures = prev.failures ?? []; apiCalls = prev.apiCalls;
    console.log(`[REUSE] ${reuse} — 재조회 생략(${targets.length} targets, 조회실패 ${failures.length})`);
  } else {
    // --retry: 앞선 실행에서 **조회에 실패한 필지만** 다시 부른다. 못 읽은 필지를 "대상 아님"으로
    // 두면 승인 집합이 조용히 축소 측정된다 — 수가 우연히 맞아떨어져도 완전성의 증거가 아니다.
    let pool = masters;
    if (retry && fs.existsSync(retry)) {
      const prev = JSON.parse(fs.readFileSync(retry, 'utf8'));
      const failed = new Set<string>(prev.failures ?? []);
      pool = masters.filter((m) => failed.has(m.apt_seq));
      targets = prev.targets; scanned = prev.scanned; apiCalls = prev.apiCalls;
      console.log(`[RETRY] ${retry} — 조회실패 ${pool.length}건만 재조회(기존 targets ${targets.length})`);
    }
    for (const m of pool) {
      scanned++;
      if (scanned % 250 === 0) console.log(`  ...${scanned} (calls=${apiCalls}, targets=${targets.length}, 실패 ${failures.length})`);
      const bj = jibunToBunJi(String(m.jibun ?? ''));
      if (!bj || !m.umd_cd) continue;
      const isGeneral = m.basic_spec_source === 'BUILDINGHUB_GENERAL_TITLE';
      const op = isGeneral ? 'getBrRecapTitleInfo' : 'getBrTitleInfo';
      const paged = await fetchWithBackoff(op, m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
      if (paged.status !== 'COMPLETE') { if (paged.status !== 'EMPTY') failures.push(m.apt_seq); continue; }
      const recs = paged.items as Record<string, unknown>[];
      failures = failures.filter((f) => f !== m.apt_seq);
      targets = targets.filter((t) => t.aptSeq !== m.apt_seq);

      // 고친 코드가 이 행의 값을 여전히 산출하지 못하는가(= 보류 대상인가)
      const q = { sggCd: m.sgg_cd, umdCd: m.umd_cd, bun: bj.bun, ji: bj.ji };
      const withheld = isGeneral
        ? decideGeneralTitle(recs as any[], paged.totalCount, null, q, LENIENT_POLICY).status !== 'success'
        : decideTitleFallback(recs as any[], paged.totalCount, q, LENIENT_POLICY, isNumberedBuildingUnit) !== 'success';
      if (!withheld) continue;

      const storedH = m.total_households == null ? null : Number(m.total_households);
      const zeros = recs.filter(isResidentialRecord).filter((r) => num(r.hhldCnt) === 0);
      if (zeros.length === 0) continue;            // 0세대 레코드가 없으면 앞 STEP에서 이미 처리된 집합
      if (storedH == null) continue;               // 저장값 없음 = KEEP_NULL, 승인 범위 밖

      const o = policyBOutcome(recs);
      if (o.newHouseholds == null) continue;       // 근거 없는 0세대가 남음 → 보류(한보장산 등)
      if (o.newHouseholds === storedH) continue;   // 이미 맞음

      const parking = m.parking_count == null ? null : Number(m.parking_count);
      const oldPph = m.parking_per_household == null ? null : Number(m.parking_per_household);
      targets.push({
        aptSeq: m.apt_seq, name: m.name, dong: m.umd_name, jibun: m.jibun, source: m.basic_spec_source,
        records: recs.length, zeroRecords: zeros.length,
        oldHouseholds: storedH, newHouseholds: o.newHouseholds,
        parkingCount: parking, oldPph, newPph: oldPph != null && parking != null ? parking / o.newHouseholds : null,
        excluded: o.excluded, evidence: o.evidence,
        oldRatio: parking && storedH > 0 ? parking / storedH : null,
        newRatio: parking ? parking / o.newHouseholds : null,
        // 승인 밖 필드 — 스냅샷만, 쓰지 않는다
        keepFar: m.floor_area_ratio == null ? null : Number(m.floor_area_ratio),
        keepBcr: m.building_coverage_ratio == null ? null : Number(m.building_coverage_ratio),
        keepBuildingCount: m.main_building_count == null ? null : Number(m.main_building_count),
        keepApprovalDate: m.use_approval_date ?? null,
        keepRoadAddress: m.road_address ?? null,
      });
    }
    fs.writeFileSync(path.join(OUT, 'rebuild.json'), JSON.stringify({ at: new Date().toISOString(), scanned, apiCalls, rateLimited, backoffWaits, failures, targets }, null, 2));
  }

  const ratioTargets = targets.filter((t) => t.oldPph != null && t.parkingCount != null);
  const counts = {
    autoSafeNew: targets.length, householdsUpdates: targets.length,
    parkingPerHouseholdUpdates: ratioTargets.length,
    parkingCountUpdates: 0, otherFieldUpdates: 0,
    ratioLeftNull: targets.length - ratioTargets.length,
    scanned, apiCalls, rateLimited, backoffWaits, unresolvedFetchFailures: failures.length,
  };

  // ── §6 severe 기대값 대조 ──
  const severeCheck = Object.entries(SEVERE_EXPECTED).map(([seq, exp]) => {
    const t = targets.find((x) => x.aptSeq === seq);
    const ok = !!t && t.oldHouseholds === exp.oldH && t.newHouseholds === exp.newH && t.parkingCount === exp.parking;
    return { aptSeq: seq, name: exp.name, expected: exp, actual: t ? { oldH: t.oldHouseholds, newH: t.newHouseholds, parking: t.parkingCount, newRatio: +t.newRatio.toFixed(2) } : null, ok };
  });

  // ── §7 rollback artifact — 쓰기 전에 ──
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackFile = path.join(OUT, `rollback-${stamp}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify({
    at: new Date().toISOString(), counts,
    rows: targets.map((t) => ({
      aptSeq: t.aptSeq, name: t.name, oldHouseholds: t.oldHouseholds, newHouseholds: t.newHouseholds,
      parkingCount: t.parkingCount, oldParkingPerHousehold: t.oldPph, newParkingPerHousehold: t.newPph,
      evidence: t.evidence, reason: `POLICY B — 0세대 공동주택 ${t.zeroRecords}건 중 ${t.excluded}건을 공식 근거로 제외`,
    })),
    sql: targets.map((t) => {
      const s = [`total_households = ${t.oldHouseholds}`];
      if (t.oldPph != null && t.parkingCount != null) s.push(`parking_per_household = ${t.oldPph}`);
      return `UPDATE apartment_masters SET ${s.join(', ')} WHERE apt_seq = '${t.aptSeq}';`;
    }).join('\n'),
  }, null, 2));
  console.log(`[ROLLBACK] ${rollbackFile}`);

  const plan = {
    counts, severeCheck,
    excluded: { hanbojangsan: targets.some((t) => MUST_EXCLUDE.has(t.aptSeq)) ? 'INCLUDED(오류)' : 1 },
    sample: targets.slice(0, 5).map((t) => ({ aptSeq: t.aptSeq, name: t.name, h: `${t.oldHouseholds}->${t.newHouseholds}`, parking: t.parkingCount, ratio: `${t.oldRatio?.toFixed(2)}->${t.newRatio?.toFixed(2)}` })),
  };
  fs.writeFileSync(path.join(OUT, `dryrun-${stamp}.json`), JSON.stringify({ plan, targets }, null, 2));
  console.log('[PLAN]', JSON.stringify(plan, null, 2));

  // ── §19 STOP RULE ──
  const stops: string[] = [];
  if (failures.length > 0) stops.push(`조회 실패 ${failures.length}건 미해결 — 집합이 축소 측정됨`);
  if (Number.isFinite(expectH) && counts.householdsUpdates !== expectH) stops.push(`households ${counts.householdsUpdates} != ${expectH}`);
  if (Number.isFinite(expectR) && counts.parkingPerHouseholdUpdates !== expectR) stops.push(`parking_per_household ${counts.parkingPerHouseholdUpdates} != ${expectR}`);
  for (const t of targets) if (MUST_EXCLUDE.has(t.aptSeq)) stops.push(`${t.aptSeq}는 반드시 제외돼야 한다`);
  for (const s of severeCheck) if (!s.ok) stops.push(`severe 기대값 불일치: ${s.name}`);
  for (const t of targets) if (!t.aptSeq.startsWith('26')) stops.push('부산 외 aptSeq 포함');
  if (stops.length) { console.error('[STOP]', stops.join(' / ')); await prisma.$disconnect(); process.exit(2); }

  if (!apply) { console.log('[DRY RUN] 쓰기 0 — --apply 없이 종료'); await prisma.$disconnect(); return; }

  // ── §9 UPDATE — 승인 2컬럼만, 행마다 optimistic guard ──
  const applied: Record<string, unknown>[] = [];
  const mismatch: Record<string, unknown>[] = [];
  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      const n = await tx.$executeRawUnsafe(
        `UPDATE apartment_masters SET total_households = $1 WHERE apt_seq = $2 AND total_households = $3`,
        t.newHouseholds, t.aptSeq, t.oldHouseholds);
      if (n !== 1) mismatch.push({ aptSeq: t.aptSeq, field: 'total_households', expectedOld: t.oldHouseholds, affected: n });
      applied.push({ aptSeq: t.aptSeq, field: 'total_households', old: t.oldHouseholds, new: t.newHouseholds, affected: n });

      if (t.oldPph != null && t.parkingCount != null) {
        // parking_count는 조건으로만 읽는다 — SET에 등장하지 않는다.
        const pn = await tx.$executeRawUnsafe(
          `UPDATE apartment_masters SET parking_per_household = $1
           WHERE apt_seq = $2 AND parking_count = $3 AND parking_per_household = $4`,
          t.newPph, t.aptSeq, t.parkingCount, t.oldPph);
        if (pn !== 1) mismatch.push({ aptSeq: t.aptSeq, field: 'parking_per_household', expectedOld: t.oldPph, affected: pn });
        applied.push({ aptSeq: t.aptSeq, field: 'parking_per_household', old: t.oldPph, new: t.newPph, affected: pn });
      }
    }
    if (mismatch.length) throw new Error(`optimistic guard 불일치 ${mismatch.length}건 — 트랜잭션 롤백: ${JSON.stringify(mismatch.slice(0, 5))}`);
  }, { timeout: 600_000 });

  const hU = applied.filter((a) => a.field === 'total_households').reduce((s, a) => s + (a.affected as number), 0);
  const pU = applied.filter((a) => a.field === 'parking_per_household').reduce((s, a) => s + (a.affected as number), 0);
  console.log(`[APPLIED] households ${hU} · parking_per_household ${pU} · parking_count 0`);
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), counts, hU, pU, applied }, null, 2));
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
