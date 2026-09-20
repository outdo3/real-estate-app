/**
 * BUSAN_BUILDING_LEDGER_AUTO_SAFE_CORRECTION_V1 — 부산 master의 **세대수 / 도로명주소만** 보정한다.
 *
 * 승인 범위(사용자 승인 완료):
 *   A. households AUTO_SAFE = 42
 *   B. roadAddress AUTO_SAFE = 87
 * 그 밖의 어떤 컬럼도 건드리지 않는다 — parking · FAR · BCR · buildingCount · approvalDate ·
 * parkingPerHousehold · 좌표 · identity 전부 불변. 서울은 한 행도 건드리지 않는다.
 *
 * 대상 재생성(§1): 감사 결과 파일을 믿지 않는다. 현재 Production의 부산 TITLE/GENERAL_TITLE
 * master **전수**를 다시 읽고, safe pager로 대장을 다시 조회해 보류 대상과 필드 판정을
 * 처음부터 다시 만든다. 42 / 87이 아니면 멈춘다.
 *
 * 안전장치(하나라도 어긋나면 쓰기 전에 멈춘다):
 *   1. 전수 재생성 — 감사 파일 미사용
 *   2. AUTO_SAFE 규칙은 확정 정책 그대로, 완화 없음(§3 §4)
 *   3. 승인 외 필드 diff 0 확인(§5)
 *   4. rollback artifact를 **쓰기 전에** 남긴다(§7)
 *   5. UPDATE는 aptSeq + **현재 값이 예상 old와 같을 때만**(optimistic guard, §9) —
 *      그 사이 다른 경로가 바꾼 행은 덮어쓰지 않는다
 *
 * 기본은 DRY RUN. 실제 쓰기는 `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1` +
 * `--expect-households=42 --expect-road=87`이 모두 맞을 때만.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/apply-busan-ledger-auto-safe-correction.ts
 *   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/apply-busan-ledger-auto-safe-correction.ts \
 *     --apply --expect-households=42 --expect-road=87
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { isNumberedBuildingUnit } from '../src/lib/apt-building-info';
import { decideGeneralTitle, decideTitleFallback, LENIENT_POLICY } from './backfill-basic-data-logic';

const OUT = path.resolve(__dirname, '../tmp/busan-ledger-auto-safe');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import {
  isResidentialRecord, decideHouseholds, decideRoadAddress, normalizeRoad, jibunToBunJi,
  type FieldDecision,
} from './busan-ledger-auto-safe-logic';

// ─────────────────────────── 조회 ───────────────────────────

let apiCalls = 0;
let rateLimited = 0;
let backoffWaits = 0;

/**
 * rate limit는 **조회 실패가 아니라 대기 신호**다. 여기서 물러섰다 다시 부르지 않으면
 * 못 읽은 필지가 조용히 "대상 아님"이 되어 승인 집합이 축소 측정된다(실제로 1차 실행에서
 * 87건이 그렇게 빠졌다). 지수 백오프로 최대 4회까지 다시 부른다.
 */
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
      const b = j?.response?.body;
      const raw = b?.items?.item;
      const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
      const t = Number(b?.totalCount);
      return { kind: 'OK', items, totalCount: Number.isFinite(t) ? t : items.length } as const;
    } catch (e) { return { kind: 'ERROR', detail: (e as Error)?.name ?? 'error' } as const; }
  });
}

/** rate limit / 일시 오류면 물러섰다 다시 부른다. 마지막 결과를 그대로 돌려준다. */
async function fetchLotWithBackoff(op: string, sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  let last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  for (let i = 0; i < 4 && (last.status === 'RATE_LIMITED' || last.status === 'ERROR'); i++) {
    backoffWaits++;
    await sleep(1500 * (i + 1));
    last = await fetchLot(op, sgg, umd, bun, ji, intervalMs);
  }
  return last;
}

interface Target {
  aptSeq: string; name: string; sgg: string; dong: string; jibun: string; source: string;
  records: number; withheldStatus: string;
  households: FieldDecision; road: FieldDecision;
  storedHouseholds: number | null; storedRoad: string | null;
  storedParking: number | null; storedPph: number | null;
  storedFar: number | null; storedBcr: number | null;
  storedBuildingCount: number | null; storedApproval: string | null;
  inCache: boolean; cacheTier1: boolean;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 300);
  const expectH = Number(process.argv.find((a) => a.startsWith('--expect-households='))?.split('=')[1] ?? NaN);
  const expectR = Number(process.argv.find((a) => a.startsWith('--expect-road='))?.split('=')[1] ?? NaN);
  const reuse = process.argv.find((a) => a.startsWith('--reuse='))?.split('=')[1];
  const retry = process.argv.find((a) => a.startsWith('--retry='))?.split('=')[1];

  fs.mkdirSync(OUT, { recursive: true });
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'apply-busan-ledger-auto-safe-correction.ts');
  const prisma = new PrismaClient();

  // ── §1 현재 Production 상태 읽기 ──
  const db = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND basic_spec_source IN ('BUILDINGHUB_TITLE','BUILDINGHUB_GENERAL_TITLE')
       ORDER BY apt_seq`);
    const cache = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT lawd_cd, dong, jibun, total_households, parking_count, far, bcr, approval_date
       FROM apartments WHERE lawd_cd IS NOT NULL`);
    return { masters, cache };
  }, { timeout: 600_000 });
  console.log(`[DB] 부산 TITLE/GENERAL master ${db.masters.length} · apartments 캐시 ${db.cache.length}`);

  const cacheByKey = new Map(db.cache.map((c) => [`${c.lawd_cd}|${c.dong}|${c.jibun}`, c]));

  // ── §1 대장 전수 재조회 + 필드 재판정 ──
  let targets: Target[] = [];
  let scanned = 0;
  let failures: { aptSeq: string; status: string }[] = [];

  if (reuse && fs.existsSync(reuse)) {
    const prev = JSON.parse(fs.readFileSync(reuse, 'utf8'));
    targets = prev.targets;
    scanned = prev.scanned; failures = prev.failures ?? []; apiCalls = prev.apiCalls;
    console.log(`[REUSE] ${reuse} — 재조회 생략(${targets.length} targets, 미해결 조회실패 ${failures.length}, 생성 ${prev.at})`);
  } else {
    // --retry: 앞선 실행에서 **조회에 실패한 필지만** 다시 부른다. rate limit로 못 읽은 것을
    // "대상 아님"으로 처리하면 집합이 조용히 줄어든다 — 그건 측정 실패지 정책이 아니다.
    let pool = db.masters;
    if (retry && fs.existsSync(retry)) {
      const prev = JSON.parse(fs.readFileSync(retry, 'utf8'));
      const failedSeq = new Set((prev.failures ?? []).map((f: { aptSeq: string }) => f.aptSeq));
      pool = db.masters.filter((m) => failedSeq.has(m.apt_seq));
      targets = prev.targets;
      scanned = prev.scanned; apiCalls = prev.apiCalls;
      console.log(`[RETRY] ${retry} — 조회실패 ${pool.length}건만 재조회(기존 targets ${targets.length})`);
    }
    for (const m of pool) {
      scanned++;
      if (scanned % 250 === 0) console.log(`  ...${scanned} (calls=${apiCalls}, targets=${targets.length}, 조회실패 ${failures.length})`);
      const bj = jibunToBunJi(String(m.jibun ?? ''));
      if (!bj || !m.umd_cd) continue;
      const isGeneral = m.basic_spec_source === 'BUILDINGHUB_GENERAL_TITLE';
      const op = isGeneral ? 'getBrRecapTitleInfo' : 'getBrTitleInfo';
      const paged = await fetchLotWithBackoff(op, m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
      if (paged.status !== 'COMPLETE') { if (paged.status !== 'EMPTY') failures.push({ aptSeq: m.apt_seq, status: paged.status }); continue; }
      const recs = paged.items as unknown[];

      // 고친 코드가 지금도 이 행의 값을 만들어내지 못하는가(= 보류 대상인가)를 다시 판정한다.
      const q = { sggCd: m.sgg_cd, umdCd: m.umd_cd, bun: bj.bun, ji: bj.ji };
      let withheld: string | null = null;
      if (isGeneral) {
        const d = decideGeneralTitle(recs as any[], paged.totalCount, null, q, LENIENT_POLICY);
        if (d.status !== 'success') withheld = d.status;
      } else {
        const d = decideTitleFallback(recs as any[], paged.totalCount, q, LENIENT_POLICY, isNumberedBuildingUnit);
        if (d !== 'success') withheld = d;
      }
      failures = failures.filter((f) => f.aptSeq !== m.apt_seq);
      targets = targets.filter((t) => t.aptSeq !== m.apt_seq);
      if (!withheld) continue; // 고친 코드가 정상 산출하는 행 — 이번 정책의 대상이 아니다

      const households = decideHouseholds(recs, m.total_households == null ? null : Number(m.total_households));
      const road = decideRoadAddress(recs, m.road_address ?? null);
      if (households.verdict !== 'AUTO_SAFE' && road.verdict !== 'AUTO_SAFE') continue;

      const ck = `${m.sgg_cd}|${m.umd_name}|${m.jibun}`;
      const c = cacheByKey.get(ck);
      targets.push({
        aptSeq: m.apt_seq, name: m.name, sgg: m.sgg_cd, dong: m.umd_name, jibun: m.jibun,
        source: m.basic_spec_source, records: recs.length, withheldStatus: withheld,
        households, road,
        storedHouseholds: m.total_households == null ? null : Number(m.total_households),
        storedRoad: m.road_address ?? null,
        storedParking: m.parking_count == null ? null : Number(m.parking_count),
        storedPph: m.parking_per_household == null ? null : Number(m.parking_per_household),
        storedFar: m.floor_area_ratio == null ? null : Number(m.floor_area_ratio),
        storedBcr: m.building_coverage_ratio == null ? null : Number(m.building_coverage_ratio),
        storedBuildingCount: m.main_building_count == null ? null : Number(m.main_building_count),
        storedApproval: m.use_approval_date ?? null,
        inCache: !!c,
        cacheTier1: !!c && c.parking_count != null && c.far != null && c.bcr != null && c.approval_date != null,
      });
    }
    fs.writeFileSync(path.join(OUT, 'rebuild.json'), JSON.stringify({
      at: new Date().toISOString(), scanned, apiCalls, rateLimited, failures, targets,
    }, null, 2));
  }

  // ── §2 집합/교집합 ──
  const hTargets = targets.filter((t) => t.households.verdict === 'AUTO_SAFE');
  const rTargets = targets.filter((t) => t.road.verdict === 'AUTO_SAFE');
  const bothSeq = new Set(hTargets.map((t) => t.aptSeq).filter((s) => rTargets.some((r) => r.aptSeq === s)));
  const uniqueMasters = new Set([...hTargets, ...rTargets].map((t) => t.aptSeq));
  const counts = {
    householdsAuto: hTargets.length, roadAuto: rTargets.length,
    householdsOnly: hTargets.length - bothSeq.size, roadOnly: rTargets.length - bothSeq.size,
    both: bothSeq.size, uniqueMasters: uniqueMasters.size,
    scanned, apiCalls, rateLimited, backoffWaits, unresolvedFetchFailures: failures.length,
  };
  console.log('[COUNTS]', JSON.stringify(counts));

  // 세대수를 고치면 **저장된** parkingPerHousehold가 낡은 값이 된다. 사용자 확인에 따라
  // 파생 불변식(parking_count / 새 세대수)까지 같이 맞춘다 — parking_count 자체는 불변.
  // 이미 값이 있는 행만 고친다(비어 있는 행을 채우는 것은 보정이 아니라 새 범위다).
  const staleRatio = hTargets.filter((t) => t.storedPph != null && t.storedParking != null);
  const ratioNullLeft = hTargets.filter((t) => t.storedPph == null).length;

  // ── §5 승인 외 필드 diff lock ──
  const approvedFields = new Set(['total_households', 'road_address', 'parking_per_household (파생 불변식)']);
  const diffLock = {
    approvedFields: [...approvedFields],
    parkingChanges: 0, farChanges: 0, bcrChanges: 0, buildingCountChanges: 0,
    approvalDateChanges: 0, coordinateChanges: 0, identityChanges: 0,
    derivedParkingPerHouseholdRepairs: staleRatio.length,
  };

  // ── §6 캐시 선점 ──
  const cacheOverlap = targets.filter((t) => t.inCache);
  const cacheMasking = cacheOverlap.filter((t) => t.cacheTier1);

  // ── §11 세대당 주차 이상치 ──
  const anomalyBefore = targets
    .filter((t) => t.storedParking != null && t.storedHouseholds != null && t.storedHouseholds > 0)
    .map((t) => ({ aptSeq: t.aptSeq, name: t.name, parking: t.storedParking!, oldH: t.storedHouseholds!,
      oldRatio: t.storedParking! / t.storedHouseholds!,
      newH: t.households.verdict === 'AUTO_SAFE' ? (t.households.newValue as number) : null }))
    .map((x) => ({ ...x, newRatio: x.newH ? x.parking / x.newH : null }));
  const severeBefore = anomalyBefore.filter((x) => x.oldRatio > 2.0);
  const severeFixed = severeBefore.filter((x) => x.newRatio != null && x.newRatio <= 2.0);
  const severeRemaining = severeBefore.filter((x) => x.newRatio == null || x.newRatio > 2.0);


  // 26350-15 삼호가든맨션: 사용자 확인에 따라 **도로명만** 허용(세대수 REVIEW · 주차 UNRESOLVED는 불변).
  const s15 = targets.find((t) => t.aptSeq === '26350-15');

  // ── §7 rollback artifact — 쓰기 전에 ──
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackRows = [...uniqueMasters].map((seq) => {
    const t = targets.find((x) => x.aptSeq === seq)!;
    return {
      aptSeq: t.aptSeq, name: t.name, dong: t.dong, jibun: t.jibun,
      oldHouseholds: t.storedHouseholds, newHouseholds: t.households.verdict === 'AUTO_SAFE' ? t.households.newValue : null,
      oldRoadAddress: t.storedRoad, newRoadAddress: t.road.verdict === 'AUTO_SAFE' ? t.road.newValue : null,
      provenance: `BldRgstHubService ${t.source === 'BUILDINGHUB_GENERAL_TITLE' ? 'getBrRecapTitleInfo' : 'getBrTitleInfo'} · records=${t.records} · withheld=${t.withheldStatus}`,
      householdsReason: t.households.reason, roadReason: t.road.reason,
    };
  });
  const sqlLit = (v: string | null) => (v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
  const rollbackSql = rollbackRows.map((r) => {
    const sets: string[] = [];
    if (r.newHouseholds != null) sets.push(`total_households = ${r.oldHouseholds == null ? 'NULL' : r.oldHouseholds}`);
    if (r.newRoadAddress != null) sets.push(`road_address = ${sqlLit(r.oldRoadAddress)}`);
    return `UPDATE apartment_masters SET ${sets.join(', ')} WHERE apt_seq = '${r.aptSeq}';`;
  }).join('\n');
  const rollbackFile = path.join(OUT, `rollback-${stamp}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify({ at: new Date().toISOString(), counts, rows: rollbackRows, sql: rollbackSql }, null, 2));
  console.log(`[ROLLBACK] ${rollbackFile}`);

  // ── §8 dry-run 요약 ──
  const plan = {
    counts, diffLock,
    excluded: {
      reviewRequired: targets.filter((t) => t.households.verdict === 'REVIEW_REQUIRED' || t.road.verdict === 'REVIEW_REQUIRED').length,
      unknownSourceTouched: 0, seoulTouched: 0,
    },
    cache: { overlap: cacheOverlap.length, tier1Masking: cacheMasking.length, list: cacheMasking.map((t) => t.aptSeq) },
    severe: { before: severeBefore.length, fixed: severeFixed.length, remaining: severeRemaining.length,
      worst: severeBefore.sort((a, b) => b.oldRatio - a.oldRatio).slice(0, 8)
        .map((x) => ({ aptSeq: x.aptSeq, name: x.name, parking: x.parking, oldH: x.oldH,
          oldRatio: +x.oldRatio.toFixed(2), newH: x.newH, newRatio: x.newRatio ? +x.newRatio.toFixed(2) : null })) },
    derivedRatioRepair: { count: staleRatio.length, leftNull: ratioNullLeft,
      note: 'parking_per_household = parking_count / 새 세대수 (parking_count 불변). 값이 있는 행만 고친다 — null 채우기는 이번 범위 밖' },
    s26350_15: s15 == null ? 'not-a-target' : { households: s15.households.verdict, road: s15.road.verdict },
  };
  fs.writeFileSync(path.join(OUT, `dryrun-${stamp}.json`), JSON.stringify({ plan, targets }, null, 2));
  console.log('[PLAN]', JSON.stringify(plan, null, 2));

  // ── §20 STOP RULE ──
  const stops: string[] = [];
  if (failures.length > 0) stops.push(`조회 실패 ${failures.length}건 미해결 — 집합이 축소 측정됨(--retry로 재조회 필요)`);
  if (Number.isFinite(expectH) && counts.householdsAuto !== expectH) stops.push(`households ${counts.householdsAuto} != ${expectH}`);
  if (Number.isFinite(expectR) && counts.roadAuto !== expectR) stops.push(`roadAddress ${counts.roadAuto} != ${expectR}`);
  if (s15 && s15.households.verdict === 'AUTO_SAFE') stops.push('26350-15 세대수가 AUTO로 분류됨 — 반드시 REVIEW여야 한다');
  if (targets.some((t) => !t.aptSeq.startsWith('26'))) stops.push('부산 외 aptSeq 포함');
  if (targets.some((t) => t.source === 'UNKNOWN')) stops.push('UNKNOWN source 포함');
  if (stops.length) { console.error('[STOP]', stops.join(' / ')); await prisma.$disconnect(); process.exit(2); }

  if (!apply) { console.log('[DRY RUN] 쓰기 0 — --apply 없이 종료'); await prisma.$disconnect(); return; }

  // ── §9 UPDATE — 승인 2컬럼만, 행마다 optimistic guard ──
  const applied: Record<string, unknown>[] = [];
  const guardMismatch: Record<string, unknown>[] = [];
  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      if (t.households.verdict === 'AUTO_SAFE') {
        const n = await tx.$executeRawUnsafe(
          `UPDATE apartment_masters SET total_households = $1 WHERE apt_seq = $2 AND total_households = $3`,
          t.households.newValue as number, t.aptSeq, t.storedHouseholds as number);
        if (n !== 1) guardMismatch.push({ aptSeq: t.aptSeq, field: 'total_households', expectedOld: t.storedHouseholds, affected: n });
        applied.push({ aptSeq: t.aptSeq, field: 'total_households', old: t.storedHouseholds, new: t.households.newValue, affected: n });

        // 파생 불변식 — parking_count는 읽기만 하고 바꾸지 않는다. 이미 값이 있는 행만.
        if (t.storedPph != null && t.storedParking != null) {
          const newPph = t.storedParking / (t.households.newValue as number);
          const pn = await tx.$executeRawUnsafe(
            `UPDATE apartment_masters SET parking_per_household = $1
             WHERE apt_seq = $2 AND parking_count = $3 AND parking_per_household = $4`,
            newPph, t.aptSeq, t.storedParking, t.storedPph);
          if (pn !== 1) guardMismatch.push({ aptSeq: t.aptSeq, field: 'parking_per_household', expectedOld: t.storedPph, affected: pn });
          applied.push({ aptSeq: t.aptSeq, field: 'parking_per_household', old: t.storedPph, new: newPph, affected: pn });
        }
      }
      if (t.road.verdict === 'AUTO_SAFE') {
        const n = t.storedRoad == null
          ? await tx.$executeRawUnsafe(
              `UPDATE apartment_masters SET road_address = $1 WHERE apt_seq = $2 AND road_address IS NULL`,
              t.road.newValue as string, t.aptSeq)
          : await tx.$executeRawUnsafe(
              `UPDATE apartment_masters SET road_address = $1 WHERE apt_seq = $2 AND road_address = $3`,
              t.road.newValue as string, t.aptSeq, t.storedRoad);
        if (n !== 1) guardMismatch.push({ aptSeq: t.aptSeq, field: 'road_address', expectedOld: t.storedRoad, affected: n });
        applied.push({ aptSeq: t.aptSeq, field: 'road_address', old: t.storedRoad, new: t.road.newValue, affected: n });
      }
    }
    if (guardMismatch.length) throw new Error(`optimistic guard 불일치 ${guardMismatch.length}건 — 트랜잭션 롤백: ${JSON.stringify(guardMismatch.slice(0, 5))}`);
  }, { timeout: 600_000 });

  const hUpdated = applied.filter((a) => a.field === 'total_households').reduce((s, a) => s + (a.affected as number), 0);
  const rUpdated = applied.filter((a) => a.field === 'road_address').reduce((s, a) => s + (a.affected as number), 0);
  const pUpdated = applied.filter((a) => a.field === 'parking_per_household').reduce((s2, a) => s2 + (a.affected as number), 0);
  console.log(`[APPLIED] households ${hUpdated} · roadAddress ${rUpdated} · 파생비율 ${pUpdated}`);
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), counts, hUpdated, rUpdated, pUpdated, applied }, null, 2));

  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
