/**
 * BUSAN_UNKNOWN_AUTO_SAFE_CORRECTION_V1 — `basic_spec_source = UNKNOWN`인 부산 master 중
 * AUTO_SAFE로 판정된 **세대수**와 **도로명주소만** 보정한다.
 *
 * 승인 범위(사용자 승인 완료):
 *   A. `total_households` 정확히 **57**
 *   B. `road_address`     정확히 **94** (전부 저장값이 없거나 빈 문자열인 행)
 *
 * 금지: parking · parkingPerHousehold · FAR · BCR · buildingCount · approvalDate · 좌표 ·
 * identity · **`basic_spec_source`(provenance)** · 캐시 · 서울 · sale · cancellation · schema.
 * 이번 STEP은 provenance를 기록하지 않는다 — 라벨은 UNKNOWN으로 남는다.
 *
 * 대상 재생성(§2): 감사 artifact를 믿지 않는다. 현재 Production master + safe pager로
 * 대장을 다시 조회해 POLICY B / 단일 도로명 판정을 처음부터 다시 만든다. 57 / 94가 아니면 멈춘다.
 *
 * 안전장치:
 *   1. 전수 재생성 · 미해결 조회 실패가 1건이라도 있으면 STOP(집합 축소 측정 방지)
 *   2. 미평가 48(NO_LOT_KEY 45 + PARTIAL 3) · REVIEW 166은 구조적으로 제외되고 STOP 규칙이 재확인
 *   3. 대표 기대값(왕자 30→390 · 그린파크 40→200) 사전 대조
 *   4. rollback artifact를 **쓰기 전에** 생성
 *   5. 행마다 optimistic guard — 세대수는 기대 old와 같을 때만, 도로명은 **여전히 비어 있을 때만**
 *
 * 기본은 DRY RUN. 실제 쓰기는 `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1`.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/apply-busan-unknown-auto-safe-correction.ts
 *   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 npx tsx scripts/apply-busan-unknown-auto-safe-correction.ts \
 *     --apply --expect-households=57 --expect-road=94
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { fetchAllLedgerPages } from '../src/lib/building-ledger-pager';
import { decideRoadAddress, normalizeRoad, jibunToBunJi } from './busan-ledger-auto-safe-logic';
import { policyBOutcome } from './apply-busan-zero-household-policy-b';
import { isBlank } from './analyze-ledger-unknown-source-trust';

const OUT = path.resolve(__dirname, '../tmp/unknown-apply');
const cleanKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** §6 쓰기 전 대조할 대표 기대값. 다르면 멈춘다. */
export const EXPECTED_SAMPLES: Record<string, { name: string; oldH: number; newH: number }> = {
  '26350-165': { name: '왕자', oldH: 30, newH: 390 },
  '26350-153': { name: '그린파크', oldH: 40, newH: 200 },
};

let apiCalls = 0, rateLimited = 0, backoffWaits = 0;

async function fetchLot(sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  return fetchAllLedgerPages(async (pageNo, numOfRows) => {
    await sleep(intervalMs);
    apiCalls++;
    const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${cleanKey()}&sigunguCd=${sgg}&bjdongCd=${umd}&platGbCd=0&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
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

async function fetchWithBackoff(sgg: string, umd: string, bun: string, ji: string, intervalMs: number) {
  let last = await fetchLot(sgg, umd, bun, ji, intervalMs);
  for (let i = 0; i < 5 && (last.status === 'RATE_LIMITED' || last.status === 'ERROR'); i++) {
    backoffWaits++; await sleep(2000 * (i + 1));
    last = await fetchLot(sgg, umd, bun, ji, intervalMs);
  }
  return last;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const interval = Number(process.argv.find((a) => a.startsWith('--interval='))?.split('=')[1] ?? 450);
  const expectH = Number(process.argv.find((a) => a.startsWith('--expect-households='))?.split('=')[1] ?? NaN);
  const expectR = Number(process.argv.find((a) => a.startsWith('--expect-road='))?.split('=')[1] ?? NaN);
  const reuse = process.argv.find((a) => a.startsWith('--reuse='))?.split('=')[1];
  const retry = process.argv.find((a) => a.startsWith('--retry='))?.split('=')[1];
  // §3 EXCLUSION LOCK — 감사에서 이미 "미평가"로 분류돼 **승인 대상이 아닌** 필지는
  // 조회 실패로 남아도 진행을 막지 않는다. 단 그 집합이 **정확히 일치할 때만** 통과시킨다
  // (새로 생긴 실패가 조용히 묻히지 않도록, 기대 aptSeq를 명시적으로 받는다).
  const ackList = (process.argv.find((a) => a.startsWith('--acknowledge-unevaluated='))?.split('=')[1] ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean).sort();
  fs.mkdirSync(OUT, { recursive: true });

  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'apply-busan-unknown-auto-safe-correction.ts');
  const prisma = new PrismaClient();

  const db = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const masters = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT apt_seq, name, sgg_cd, umd_name, umd_cd, jibun, basic_spec_source,
              total_households, parking_count, parking_per_household, main_building_count,
              use_approval_date, floor_area_ratio, building_coverage_ratio, road_address,
              mgm_bldrgst_pk, latitude, longitude
       FROM apartment_masters
       WHERE sgg_cd LIKE '26%' AND basic_spec_source = 'UNKNOWN'
       ORDER BY apt_seq`);
    const cache = await tx.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT lawd_cd, dong, jibun, total_households,
              (parking_count IS NOT NULL AND far IS NOT NULL AND bcr IS NOT NULL AND approval_date IS NOT NULL) AS gate
       FROM apartments WHERE lawd_cd IS NOT NULL`);
    return { masters, cache };
  }, { timeout: 600_000 });
  console.log(`[DB] 부산 UNKNOWN master ${db.masters.length}`);
  const cacheByKey = new Map(db.cache.map((c) => [`${c.lawd_cd}|${c.dong}|${c.jibun}`, c]));

  let targets: Record<string, any>[] = [];
  let failures: string[] = [];
  let scanned = 0;
  let noLotKey = 0;

  if (reuse && fs.existsSync(reuse)) {
    const prev = JSON.parse(fs.readFileSync(reuse, 'utf8'));
    targets = prev.targets; failures = prev.failures ?? []; scanned = prev.scanned; apiCalls = prev.apiCalls; noLotKey = prev.noLotKey ?? 0;
    console.log(`[REUSE] ${reuse} — 재조회 생략(${targets.length} targets, 조회실패 ${failures.length})`);
  } else {
    let pool = db.masters;
    if (retry && fs.existsSync(retry)) {
      const prev = JSON.parse(fs.readFileSync(retry, 'utf8'));
      const failed = new Set<string>(prev.failures ?? []);
      pool = db.masters.filter((m) => failed.has(m.apt_seq));
      targets = prev.targets; scanned = prev.scanned; apiCalls = prev.apiCalls; noLotKey = prev.noLotKey ?? 0;
      console.log(`[RETRY] ${retry} — 조회실패 ${pool.length}건만 재조회(기존 targets ${targets.length})`);
    }
    for (const m of pool) {
      scanned++;
      if (scanned % 100 === 0) console.log(`  ...${scanned} (calls=${apiCalls}, targets=${targets.length}, 실패 ${failures.length})`);
      const bj = jibunToBunJi(String(m.jibun ?? ''));
      // 지번/법정동 코드가 없으면 조회 자체가 불가능하다 — 미평가로 남기고 건드리지 않는다.
      if (!bj || !m.umd_cd) { noLotKey++; continue; }

      const paged = await fetchWithBackoff(m.sgg_cd, m.umd_cd, bj.bun, bj.ji, interval);
      failures = failures.filter((f) => f !== m.apt_seq);
      targets = targets.filter((t) => t.aptSeq !== m.apt_seq);
      if (paged.status === 'EMPTY') continue;
      if (paged.status !== 'COMPLETE') { failures.push(m.apt_seq); continue; }

      const recs = paged.items as Record<string, unknown>[];
      const storedH = m.total_households == null ? null : Number(m.total_households);
      const storedRoad = m.road_address ?? null;

      const b = policyBOutcome(recs);
      // 세대수: 저장값이 있고, POLICY B가 근거 있게 다른 값을 만들 때만
      const hAuto = storedH != null && b.newHouseholds != null && b.newHouseholds !== storedH;
      // 도로명: 단일 canonical 값이고, 저장값이 비어 있을 때만(덮어쓰기 아님)
      const road = decideRoadAddress(recs, storedRoad);
      const rAuto = road.verdict === 'AUTO_SAFE' && isBlank(storedRoad);
      if (!hAuto && !rAuto) continue;

      const ck = `${m.sgg_cd}|${m.umd_name}|${m.jibun}`;
      const c = cacheByKey.get(ck);
      targets.push({
        aptSeq: m.apt_seq, name: m.name, dong: m.umd_name, jibun: m.jibun, records: recs.length,
        hAuto, rAuto,
        oldHouseholds: storedH, newHouseholds: hAuto ? (b.newHouseholds as number) : null,
        oldRoadAddress: storedRoad, newRoadAddress: rAuto ? (road.newValue as string) : null,
        truncationSign: hAuto && recs.map((r) => Number(r.hhldCnt) || 0).includes(storedH as number),
        evidence: b.evidence, zerosExcluded: b.excluded,
        // 승인 밖 필드 — 스냅샷만, 쓰지 않는다
        keepParking: m.parking_count == null ? null : Number(m.parking_count),
        keepPph: m.parking_per_household == null ? null : Number(m.parking_per_household),
        keepFar: m.floor_area_ratio == null ? null : Number(m.floor_area_ratio),
        keepBcr: m.building_coverage_ratio == null ? null : Number(m.building_coverage_ratio),
        keepBuildingCount: m.main_building_count == null ? null : Number(m.main_building_count),
        keepApprovalDate: m.use_approval_date ?? null,
        keepSource: m.basic_spec_source,
        keepPk: m.mgm_bldrgst_pk ?? null,
        keepLat: m.latitude == null ? null : Number(m.latitude),
        keepLng: m.longitude == null ? null : Number(m.longitude),
        inCache: !!c, cacheTier1: !!c && !!c.gate,
        cacheHouseholds: c?.total_households == null ? null : Number(c.total_households),
      });
    }
    fs.writeFileSync(path.join(OUT, 'rebuild.json'), JSON.stringify({
      at: new Date().toISOString(), scanned, apiCalls, rateLimited, backoffWaits, noLotKey, failures, targets,
    }, null, 2));
  }

  const hTargets = targets.filter((t) => t.hAuto);
  const rTargets = targets.filter((t) => t.rAuto);
  const both = hTargets.filter((t) => t.rAuto).length;
  const counts = {
    householdsUpdates: hTargets.length, roadAddressUpdates: rTargets.length,
    householdsOnly: hTargets.length - both, roadOnly: rTargets.length - both, both,
    uniqueMasters: new Set(targets.map((t) => t.aptSeq)).size,
    parkingUpdates: 0, parkingPerHouseholdUpdates: 0, farUpdates: 0, bcrUpdates: 0,
    buildingCountUpdates: 0, approvalDateUpdates: 0, coordinateUpdates: 0,
    basicSpecSourceUpdates: 0, cacheWrites: 0,
    noLotKeyExcluded: noLotKey, scanned, apiCalls, rateLimited, backoffWaits,
    unresolvedFetchFailures: failures.length,
    unresolvedAreKnownUnevaluated: failures.length > 0 && ackList.length > 0,
  };

  const sampleCheck = Object.entries(EXPECTED_SAMPLES).map(([seq, exp]) => {
    const t = targets.find((x) => x.aptSeq === seq);
    const ok = !!t && t.oldHouseholds === exp.oldH && t.newHouseholds === exp.newH;
    return { aptSeq: seq, name: exp.name, expected: exp, actual: t ? { oldH: t.oldHouseholds, newH: t.newHouseholds } : null, ok };
  });

  const cacheShadow = hTargets.filter((t) => t.cacheTier1 && t.cacheHouseholds != null);

  // ── §9 rollback artifact — 쓰기 전에 ──
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sqlLit = (v: string | null) => (v == null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
  const rollbackFile = path.join(OUT, `rollback-${stamp}.json`);
  fs.writeFileSync(rollbackFile, JSON.stringify({
    at: new Date().toISOString(), counts,
    rows: targets.map((t) => ({
      aptSeq: t.aptSeq, name: t.name, dong: t.dong, jibun: t.jibun,
      oldHouseholds: t.oldHouseholds, newHouseholds: t.newHouseholds,
      oldRoadAddress: t.oldRoadAddress, newRoadAddress: t.newRoadAddress,
      evidence: t.evidence,
      reason: `UNKNOWN AUTO_SAFE — ${t.hAuto ? `POLICY B 세대수(0세대 ${t.zerosExcluded}건 공식 근거로 제외)` : ''}${t.hAuto && t.rAuto ? ' + ' : ''}${t.rAuto ? '단일 canonical 도로명 채움' : ''}`,
    })),
    sql: targets.map((t) => {
      const s: string[] = [];
      if (t.hAuto) s.push(`total_households = ${t.oldHouseholds}`);
      if (t.rAuto) s.push(`road_address = ${sqlLit(t.oldRoadAddress)}`);
      return `UPDATE apartment_masters SET ${s.join(', ')} WHERE apt_seq = '${t.aptSeq}';`;
    }).join('\n'),
  }, null, 2));
  console.log(`[ROLLBACK] ${rollbackFile}`);

  const plan = {
    counts, sampleCheck,
    truncationSigns: hTargets.filter((t) => t.truncationSign).length,
    cache: { overlap: targets.filter((t) => t.inCache).length, tier1: targets.filter((t) => t.cacheTier1).length,
      shadowOnHouseholds: cacheShadow.length, shadowRows: cacheShadow.map((t) => t.aptSeq) },
    roadOldStates: { null: rTargets.filter((t) => t.oldRoadAddress == null).length,
      blankString: rTargets.filter((t) => t.oldRoadAddress != null && isBlank(t.oldRoadAddress)).length },
    sample: hTargets.slice(0, 8).map((t) => ({ aptSeq: t.aptSeq, name: t.name, h: `${t.oldHouseholds}->${t.newHouseholds}` })),
  };
  fs.writeFileSync(path.join(OUT, `dryrun-${stamp}.json`), JSON.stringify({ plan, targets }, null, 2));
  console.log('[PLAN]', JSON.stringify(plan, null, 2));

  // ── §20 STOP RULE ──
  const stops: string[] = [];
  const unresolved = [...failures].sort();
  const ackExact = ackList.length > 0 && unresolved.length === ackList.length
    && unresolved.every((f, i) => f === ackList[i]);
  if (failures.length > 0 && !ackExact) {
    stops.push(`조회 실패 ${failures.length}건 미해결 — 집합이 축소 측정됨 (${unresolved.join(',')})`);
  }
  // 승인 대상에 미평가 필지가 섞이면 무조건 중단한다.
  for (const f of unresolved) if (targets.some((t) => t.aptSeq === f)) stops.push(`미평가 ${f}가 대상에 포함됨`);
  if (Number.isFinite(expectH) && counts.householdsUpdates !== expectH) stops.push(`households ${counts.householdsUpdates} != ${expectH}`);
  if (Number.isFinite(expectR) && counts.roadAddressUpdates !== expectR) stops.push(`roadAddress ${counts.roadAddressUpdates} != ${expectR}`);
  for (const s of sampleCheck) if (!s.ok) stops.push(`대표 기대값 불일치: ${s.name}`);
  for (const t of targets) {
    if (!t.aptSeq.startsWith('26')) stops.push('부산 외 aptSeq 포함');
    if (t.keepSource !== 'UNKNOWN') stops.push(`${t.aptSeq} source가 UNKNOWN이 아님`);
    if (t.rAuto && !isBlank(t.oldRoadAddress)) stops.push(`${t.aptSeq} 도로명 덮어쓰기 시도`);
  }
  if (cacheShadow.length) stops.push(`캐시가 가리는 세대수 보정 ${cacheShadow.length}건`);
  if (stops.length) { console.error('[STOP]', [...new Set(stops)].join(' / ')); await prisma.$disconnect(); process.exit(2); }

  if (!apply) { console.log('[DRY RUN] 쓰기 0 — --apply 없이 종료'); await prisma.$disconnect(); return; }

  // ── §11 UPDATE — 승인 2컬럼만, 행마다 optimistic guard ──
  const applied: Record<string, unknown>[] = [];
  const mismatch: Record<string, unknown>[] = [];
  await prisma.$transaction(async (tx) => {
    for (const t of targets) {
      if (t.hAuto) {
        const n = await tx.$executeRawUnsafe(
          `UPDATE apartment_masters SET total_households = $1 WHERE apt_seq = $2 AND total_households = $3`,
          t.newHouseholds, t.aptSeq, t.oldHouseholds);
        if (n !== 1) mismatch.push({ aptSeq: t.aptSeq, field: 'total_households', expectedOld: t.oldHouseholds, affected: n });
        applied.push({ aptSeq: t.aptSeq, field: 'total_households', old: t.oldHouseholds, new: t.newHouseholds, affected: n });
      }
      if (t.rAuto) {
        // 여전히 비어 있을 때만 — 그 사이 다른 경로가 채운 행은 덮지 않는다.
        const n = t.oldRoadAddress == null
          ? await tx.$executeRawUnsafe(
              `UPDATE apartment_masters SET road_address = $1 WHERE apt_seq = $2 AND road_address IS NULL`,
              t.newRoadAddress, t.aptSeq)
          : await tx.$executeRawUnsafe(
              `UPDATE apartment_masters SET road_address = $1 WHERE apt_seq = $2 AND road_address = $3`,
              t.newRoadAddress, t.aptSeq, t.oldRoadAddress);
        if (n !== 1) mismatch.push({ aptSeq: t.aptSeq, field: 'road_address', expectedOld: t.oldRoadAddress, affected: n });
        applied.push({ aptSeq: t.aptSeq, field: 'road_address', old: t.oldRoadAddress, new: t.newRoadAddress, affected: n });
      }
    }
    if (mismatch.length) throw new Error(`optimistic guard 불일치 ${mismatch.length}건 — 트랜잭션 롤백: ${JSON.stringify(mismatch.slice(0, 5))}`);
  }, { timeout: 600_000 });

  const hU = applied.filter((a) => a.field === 'total_households').reduce((s, a) => s + (a.affected as number), 0);
  const rU = applied.filter((a) => a.field === 'road_address').reduce((s, a) => s + (a.affected as number), 0);
  console.log(`[APPLIED] households ${hU} · roadAddress ${rU} · 그 밖 0`);
  fs.writeFileSync(path.join(OUT, `applied-${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), counts, hU, rU, applied }, null, 2));
  await prisma.$disconnect();
}

if (require.main === module) main().catch((e) => { console.error(String((e as Error)?.stack ?? e)); process.exit(1); });
