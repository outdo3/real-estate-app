/**
 * SEOUL_MASTER_SEED_SCRIPT_V1 — 서울 ApartmentMaster Tier A(매매 discovery) create-only seed.
 *
 * 기본은 DRY RUN(쓰기 0). 실제 쓰기는 아래 네 조건이 **모두** 맞을 때만:
 *   --apply · ALLOW_PROD_DB_WRITE=1 · --district=<서울 구 코드>(대상 구 전부 READY) · --expect-ready=<dry-run READY 수>
 *
 * 기존 scripts/apartment_master_seed.ts를 쓰지 않는 이유(SEOUL_MASTER_SEED_PLAN_V1 §13):
 *   1쪽(1000행)만 읽음 · 오류를 빈 결과로 반환 · 전역 좌표 dedupe가 부산 행을 update · 단지명 키워드 좌표 저장 · upsert.
 *
 * 이 스크립트는:
 *   - MOLIT 매매만 읽는다(pageNo/totalCount 검증, 동시 1·350ms). COMPLETE가 아닌 셀이 있는 구는 통째로 보류.
 *   - DB는 서울 aptSeq 목록으로만 조회하고(apt_seq = ANY), create만 한다. update/upsert/delete 경로 없음.
 *   - 좌표는 Kakao 주소 검색 필지 일치(정방향) + 그 좌표의 역지오코딩 필지 일치(역방향)가 모두 통과할 때만 저장한다.
 *     키워드 검색을 호출하지 않는다. (REVERSE CHECK V1 — WRONG COORDINATE < NULL COORDINATE)
 *   - 산출물: tmp/seoul-master-seed-run/ (checkpoints/ · raw/ · 결과 JSON). API key·DB URL은 출력하지 않는다.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/seed-seoul-apartment-master.ts [--district=11140[,11680]] [--skip-coordinates] [--refetch]
 *   (향후 승인 시에만) ALLOW_PROD_DB_WRITE=1 npx tsx scripts/seed-seoul-apartment-master.ts --apply --district=11140 --expect-ready=107
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { XMLParser } from 'fast-xml-parser';
import type { RawTradeItem } from './seoul-master-seed-plan-logic';
import {
  SEOUL_CODES,
  SEOUL_DISTRICTS,
  addressQuery,
  buildAppliedArtifact,
  buildTierARows,
  districtFetchState,
  evaluateApplyGates,
  fetchSaleCell,
  forwardTerminalStatus,
  matchExactLot,
  toCreateData,
  verifyReverseLot,
  TERMINAL_COORDINATE_STATUSES,
  type AddressSearchOutcome,
  type ForwardStatus,
  type ReverseOutcome,
  type CellFetch,
  type CoordinateStatus,
  type DistrictState,
  type InsertedRow,
  type PageFetcher,
  type PageOutcome,
  type PlanExclusions,
  type SeedRow,
} from './seed-seoul-apartment-master-logic';

// ───────────────────────── 의존성(테스트에서 가짜로 교체) ─────────────────────────

export interface ReadOnlySeedDb {
  mode: 'READ_ONLY';
  hostKind: 'PRODUCTION' | 'NON_PRODUCTION';
  findExistingAptSeqs(aptSeqs: readonly string[]): Promise<Set<string>>;
}
export interface WritableSeedDb {
  mode: 'CREATE_ONLY';
  hostKind: 'PRODUCTION' | 'NON_PRODUCTION';
  findExistingAptSeqs(aptSeqs: readonly string[]): Promise<Set<string>>;
  /** create만. 같은 aptSeq가 이미 있으면 'DUPLICATE'(unique 위반) — 절대 덮어쓰지 않는다. */
  createMaster(data: ReturnType<typeof toCreateData>): Promise<InsertedRow | 'DUPLICATE'>;
}

export interface SeedDeps {
  fetchPage: PageFetcher;
  searchAddress: (query: string) => Promise<AddressSearchOutcome>;
  /** Kakao coord2address(좌표 → 지번 필지). */
  reverseGeocode: (lat: number, lng: number) => Promise<ReverseOutcome>;
  readDb: () => Promise<ReadOnlySeedDb>;
  /** 모든 apply 게이트 통과 후에만 호출된다. */
  writeDb: () => Promise<WritableSeedDb>;
  planExclusions?: PlanExclusions | null;
  planTierA?: ReadonlySet<string> | null;
  now: () => Date;
  log: (msg: string) => void;
}

export interface SeedOptions {
  outDir: string;
  months: string[];
  districts: string[] | null;
  apply: boolean;
  allowProdDbWrite: string | undefined;
  expectReady: number | null;
  skipCoordinates: boolean;
  refetch: boolean;
}

interface Checkpoint {
  lawdCd: string;
  name: string;
  months: string[];
  state: DistrictState;
  cells: Omit<CellFetch, 'items'>[];
  rawFile: string | null;
  coordinates: Record<string, CoordEntry | LegacyCoordEntry>;
  updatedAt: string;
}

/** REVERSE CHECK V1 체크포인트 항목 — 정방향 결과와 역방향 결과를 따로 남겨, 재실행 때 끝난 단계는 다시 호출하지 않는다. */
interface CoordEntry {
  v: 2;
  status: CoordinateStatus;
  forward: { status: ForwardStatus; lat: number | null; lng: number | null; address: string | null } | null;
  reverse: { address: string | null; lot: string | null; reason: string | null } | null;
}
/** SEED SCRIPT V1 체크포인트(정방향만). EXACT는 역방향 검증 전 상태로 이어받는다. */
interface LegacyCoordEntry { status: 'EXACT' | 'NO_MATCH' | 'AMBIGUOUS' | 'JIBUN_UNPARSEABLE' | 'ERROR' | 'RATE_LIMITED'; lat: number | null; lng: number | null }

export function migrateCoordEntry(e: CoordEntry | LegacyCoordEntry | undefined): CoordEntry | null {
  if (!e) return null;
  if ((e as CoordEntry).v === 2) return e as CoordEntry;
  const old = e as LegacyCoordEntry;
  if (old.status === 'ERROR' || old.status === 'RATE_LIMITED') return null; // 다시 조회
  const forward = { status: old.status, lat: old.lat, lng: old.lng, address: null };
  const terminal = forwardTerminalStatus(old.status);
  // 정방향 EXACT는 역방향 전이라 미종결(ERROR 자리 표시) — 정방향 좌표만 재사용하고 역방향만 호출한다.
  return { v: 2, status: terminal ?? 'ERROR', forward, reverse: null };
}

// ───────────────────────── 본체 ─────────────────────────

export async function runSeed(opts: SeedOptions, deps: SeedDeps) {
  const cpDir = path.join(opts.outDir, 'checkpoints');
  const rawDir = path.join(opts.outDir, 'raw');
  fs.mkdirSync(cpDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const writeJson = (p: string, v: unknown) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
  const now = () => deps.now().toISOString();
  const calls = { molitPages: 0, kakaoForward: 0, kakaoReverse: 0 };

  const targets = opts.districts ?? SEOUL_DISTRICTS.map((d) => d.lawdCd);
  for (const t of targets) if (!SEOUL_CODES.has(t)) throw new Error(`서울 25개 구 코드가 아님: ${t}`);
  const targetSet = new Set(targets);
  const fetchPage: PageFetcher = async (...a) => { calls.molitPages++; return deps.fetchPage(...a); };

  // 1) 구별 수집(체크포인트 재사용)
  const cps = new Map<string, Checkpoint>();
  const itemsByDistrict = new Map<string, RawTradeItem[]>();
  const sourceErrors: { lawdCd: string; ym: string; status: string; totalCount: number | null; collected: number; errors: string[] }[] = [];
  for (const lawdCd of targets) {
    const name = SEOUL_DISTRICTS.find((d) => d.lawdCd === lawdCd)!.name;
    const cpPath = path.join(cpDir, `${lawdCd}.json`);
    const prev: Checkpoint | null = fs.existsSync(cpPath) ? JSON.parse(fs.readFileSync(cpPath, 'utf8')) : null;
    const reusable = !opts.refetch && prev && prev.state !== 'PARTIAL' && prev.state !== 'PENDING'
      && JSON.stringify(prev.months) === JSON.stringify(opts.months) && prev.rawFile && fs.existsSync(path.join(rawDir, prev.rawFile));
    if (reusable) {
      cps.set(lawdCd, prev!);
      itemsByDistrict.set(lawdCd, JSON.parse(fs.readFileSync(path.join(rawDir, prev!.rawFile!), 'utf8')));
      deps.log(`[fetch] ${lawdCd} ${name} checkpoint 재사용(${prev!.state})`);
      continue;
    }
    const cells: CellFetch[] = [];
    for (const ym of opts.months) cells.push(await fetchSaleCell(fetchPage, lawdCd, ym));
    const state = districtFetchState(cells, opts.months.length);
    const items = cells.flatMap((c) => c.items);
    const rawFile = `sale-${lawdCd}.json`;
    writeJson(path.join(rawDir, rawFile), items);
    const cp: Checkpoint = {
      lawdCd, name, months: opts.months, state, cells: cells.map(({ items: _i, ...rest }) => rest), rawFile,
      coordinates: {}, updatedAt: now(),
    };
    writeJson(cpPath, cp);
    cps.set(lawdCd, cp);
    itemsByDistrict.set(lawdCd, items);
    deps.log(`[fetch] ${lawdCd} ${name} ${state} rows=${items.length} multiPageCells=${cells.filter((c) => c.pages > 1).length}`);
  }
  for (const cp of cps.values()) for (const c of cp.cells) if (c.status !== 'COMPLETE') sourceErrors.push({ lawdCd: cp.lawdCd, ym: c.ym, status: c.status, totalCount: c.totalCount, collected: c.collected, errors: c.errors });
  const heldBack = new Set([...cps.values()].filter((c) => c.state === 'PARTIAL').map((c) => c.lawdCd));

  // 2) identity · Tier A
  const { rows, corrections } = buildTierARows({ itemsByDistrict, heldBack, targets: targetSet, planExclusions: deps.planExclusions ?? undefined });

  // 3) 기존 행 확인(서울 aptSeq 목록으로만 조회)
  const readDb = await deps.readDb();
  const existing = await readDb.findExistingAptSeqs(rows.filter((r) => r.status === 'READY').map((r) => r.aptSeq));
  for (const r of rows) if (r.status === 'READY' && existing.has(r.aptSeq)) { r.status = 'EXISTING_SKIPPED'; r.reasons = ['APTSEQ_ALREADY_IN_MASTER']; }

  // 4) 좌표(READY 행만): 정방향 필지 일치 → 역방향 필지 일치. 둘 다 통과해야 VERIFIED.
  let quotaStopped = false;
  for (const lawdCd of targets) {
    const cp = cps.get(lawdCd)!;
    if (heldBack.has(lawdCd)) continue;
    const ready = rows.filter((r) => r.district === lawdCd && r.status === 'READY');
    let sinceSave = 0;
    const save = () => { cp.updatedAt = now(); writeJson(path.join(cpDir, `${lawdCd}.json`), cp); };
    for (const r of ready) {
      if (opts.skipCoordinates) { r.coordinateStatus = 'SKIPPED'; continue; }
      let entry = migrateCoordEntry(cp.coordinates[r.aptSeq]);
      if (entry && TERMINAL_COORDINATE_STATUSES.has(entry.status)) { applyCoord(r, entry); continue; }
      if (quotaStopped) { r.coordinateStatus = 'PENDING'; if (entry) applyCoord(r, entry, 'PENDING'); continue; }
      // 미종결 항목(ERROR/RATE_LIMITED)은 남은 단계부터 다시: 정방향 결과가 있으면 그대로 쓰고 역방향만 다시 부른다.
      if (entry) entry = { ...entry, status: 'ERROR' };
      // 정방향(이미 있으면 재사용)
      if (!entry?.forward) {
        calls.kakaoForward++;
        const res = await deps.searchAddress(addressQuery(r));
        if (res.kind !== 'OK') {
          entry = { v: 2, status: res.kind === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'ERROR', forward: null, reverse: null };
        } else {
          const f = matchExactLot(res.docs, r);
          const terminal = forwardTerminalStatus(f.status);
          entry = { v: 2, status: terminal ?? 'ERROR', forward: { status: f.status, lat: f.lat, lng: f.lng, address: f.address }, reverse: null };
        }
      }
      // 역방향(정방향 EXACT일 때만)
      if (entry.forward?.status === 'EXACT' && entry.forward.lat != null && entry.forward.lng != null && !TERMINAL_COORDINATE_STATUSES.has(entry.status)) {
        calls.kakaoReverse++;
        const rv = await deps.reverseGeocode(entry.forward.lat, entry.forward.lng);
        if (rv.kind === 'OK') {
          const v = verifyReverseLot(rv.doc, r);
          entry = { ...entry, status: v.status, reverse: { address: v.reverseAddress, lot: v.reverseLot, reason: v.reason } };
        } else {
          entry = { ...entry, status: rv.kind === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'ERROR' };
        }
      }
      if (entry.status === 'RATE_LIMITED') { quotaStopped = true; deps.log(`[coord] Kakao 제한 — 이후 조회 중단, 다음 실행에서 이어감`); }
      cp.coordinates[r.aptSeq] = entry;
      applyCoord(r, entry);
      if (++sinceSave >= 50) { save(); sinceSave = 0; }
    }
    // 상태: 모든 READY 행의 좌표가 종결 상태여야 READY
    const coordsDone = opts.skipCoordinates || ready.every((r) => TERMINAL_COORDINATE_STATUSES.has(r.coordinateStatus as CoordinateStatus));
    cp.state = coordsDone ? 'READY' : 'VALIDATED';
    save();
  }
  const districtStates = new Map([...cps.values()].map((c) => [c.lawdCd, c.state]));

  // 5) 산출물
  const by = (s: SeedRow['status']) => rows.filter((r) => r.status === s);
  const ready = by('READY');
  const coordCount = (s: SeedRow['coordinateStatus']) => ready.filter((r) => r.coordinateStatus === s).length;
  const tierASet = new Set(rows.filter((r) => r.status === 'READY' || r.status === 'EXISTING_SKIPPED').map((r) => r.aptSeq));
  const planTierAInTargets = deps.planTierA ? [...deps.planTierA].filter((s) => targetSet.has(s.slice(0, 5))) : null;
  const summary = {
    at: now(),
    mode: opts.apply ? 'APPLY_REQUESTED' : 'DRY_RUN',
    window: { from: opts.months[opts.months.length - 1], to: opts.months[0], months: opts.months.length },
    targets,
    districtStates: Object.fromEntries(districtStates),
    heldBackDistricts: [...heldBack],
    heldBackObservedAptSeqs: Object.fromEntries([...heldBack].map((d) => [d, new Set((itemsByDistrict.get(d) ?? []).map((i) => String(i.aptSeq ?? '')).filter(Boolean)).size])),
    discoveredDistinctAptSeq: rows.length,
    byStatus: Object.fromEntries((['READY', 'EXISTING_SKIPPED', 'REVIEW_REQUIRED', 'HELD_BACK_PARTIAL_DISTRICT', 'EXCLUDED_PLAN_TIER_B', 'EXCLUDED_PLAN_REVIEW', 'OUT_OF_TARGET'] as const).map((s) => [s, by(s).length])),
    readyByDistrict: Object.fromEntries(targets.map((d) => [d, ready.filter((r) => r.district === d).length])),
    coordinates: {
      skipped: opts.skipCoordinates, quotaStopped,
      VERIFIED: coordCount('VERIFIED'), FORWARD_NO_MATCH: coordCount('FORWARD_NO_MATCH'), REVERSE_MISMATCH: coordCount('REVERSE_MISMATCH'),
      REVERSE_NO_RESULT: coordCount('REVERSE_NO_RESULT'), AMBIGUOUS: coordCount('AMBIGUOUS'), JIBUN_UNPARSEABLE: coordCount('JIBUN_UNPARSEABLE'),
      ERROR: coordCount('ERROR'), RATE_LIMITED: coordCount('RATE_LIMITED'), PENDING: coordCount('PENDING'), SKIPPED: coordCount('SKIPPED'),
      forwardExact: ready.filter((r) => r.forwardLat != null).length,
      nullCoordinates: ready.filter((r) => r.coordinateStatus !== 'VERIFIED').length,
    },
    identityCorrections: corrections.length,
    planComparison: planTierAInTargets ? {
      planTierA: planTierAInTargets.length,
      inPlanNotDiscoveredNow: planTierAInTargets.filter((s) => !tierASet.has(s)).length,
      discoveredNowNotInPlan: [...tierASet].filter((s) => !deps.planTierA!.has(s)).length,
      examplesInPlanNotNow: planTierAInTargets.filter((s) => !tierASet.has(s)).slice(0, 20),
      examplesNowNotInPlan: [...tierASet].filter((s) => !deps.planTierA!.has(s)).slice(0, 20),
    } : 'PLAN_ARTIFACT_NOT_LOADED',
    calls,
    dbHostKind: readDb.hostKind,
    writes: { insert: 0, update: 0, delete: 0 },
  };
  writeJson(path.join(opts.outDir, 'ready-to-insert.json'), ready);
  writeJson(path.join(opts.outDir, 'existing-skipped.json'), by('EXISTING_SKIPPED'));
  writeJson(path.join(opts.outDir, 'review-required.json'), by('REVIEW_REQUIRED'));
  writeJson(path.join(opts.outDir, 'coordinate-missing.json'), ready.filter((r) => r.coordinateStatus !== 'VERIFIED'));
  const reverseView = (r: SeedRow) => ({
    aptSeq: r.aptSeq, name: r.name, district: r.district, dong: r.dong, jibun: r.jibun, targetLot: r.targetLot,
    forwardAddress: r.forwardAddress, forwardLat: r.forwardLat, forwardLng: r.forwardLng,
    reverseAddress: r.reverseAddress, reverseLot: r.reverseLot, coordinateStatus: r.coordinateStatus, reason: r.coordinateReason,
  });
  writeJson(path.join(opts.outDir, 'coordinate-reverse-audit.json'), ready.map(reverseView));
  writeJson(path.join(opts.outDir, 'coordinate-reverse-mismatch.json'), ready.filter((r) => r.coordinateStatus === 'REVERSE_MISMATCH' || r.coordinateStatus === 'REVERSE_NO_RESULT').map(reverseView));
  writeJson(path.join(opts.outDir, 'district-status.json'), [...cps.values()].map((c) => ({
    lawdCd: c.lawdCd, name: c.name, state: c.state, cells: c.cells.length, completeCells: c.cells.filter((x) => x.status === 'COMPLETE').length,
    multiPageCells: c.cells.filter((x) => x.pages > 1).length, maxTotalCount: Math.max(0, ...c.cells.map((x) => x.totalCount ?? 0)),
    rows: c.cells.reduce((s, x) => s + x.collected, 0), ready: ready.filter((r) => r.district === c.lawdCd).length,
  })));
  writeJson(path.join(opts.outDir, 'source-errors.json'), sourceErrors);
  writeJson(path.join(opts.outDir, 'identity-corrections.json'), corrections);
  writeJson(path.join(opts.outDir, 'excluded-tier-b.json'), {
    note: '원천이 매매뿐이라 전월세 전용(Tier B)은 구조적으로 후보가 되지 않는다. 아래는 계획 단계 Tier B/REVIEW aptSeq가 매매 원천에 나타나 제외된 경우만.',
    planExclusionListLoaded: !!deps.planExclusions,
    rows: [...by('EXCLUDED_PLAN_TIER_B'), ...by('EXCLUDED_PLAN_REVIEW')],
  });
  writeJson(path.join(opts.outDir, 'held-back-and-out-of-target.json'), [...by('HELD_BACK_PARTIAL_DISTRICT'), ...by('OUT_OF_TARGET')]);

  // 6) apply(게이트 전부 통과할 때만)
  if (!opts.apply) {
    writeJson(path.join(opts.outDir, 'summary.json'), summary);
    deps.log(`[DRY RUN] READY ${ready.length} · 기존 SKIP ${by('EXISTING_SKIPPED').length} · REVIEW ${by('REVIEW_REQUIRED').length} · 보류 구 ${heldBack.size} — DB write 없음`);
    return { summary, rows, applied: null as null | ReturnType<typeof buildAppliedArtifact> };
  }
  const gate = evaluateApplyGates({
    applyFlag: opts.apply, allowProdDbWrite: opts.allowProdDbWrite, districts: targets, districtFilterGiven: opts.districts != null,
    districtStates, coordinatesSkipped: opts.skipCoordinates, expectReady: opts.expectReady, readyCount: ready.length,
  });
  deps.log(`[APPLY 점검] 대상 구 ${targets.join(',')} · READY ${ready.length} · 기존 SKIP ${by('EXISTING_SKIPPED').length} · REVIEW ${by('REVIEW_REQUIRED').length} · DB ${readDb.hostKind}`);
  if (!gate.allowed) {
    const refused = { ...summary, apply: { allowed: false, reasons: gate.reasons } };
    writeJson(path.join(opts.outDir, 'summary.json'), refused);
    deps.log(`[APPLY 거부] ${gate.reasons.join(', ')} — DB write 없음`);
    return { summary: refused, rows, applied: null };
  }
  const db = await deps.writeDb();
  const batchStartedAt = now();
  const inserted: InsertedRow[] = [];
  const skippedExisting: string[] = [];
  const failed: { aptSeq: string; error: string }[] = [];
  const recheck = await db.findExistingAptSeqs(ready.map((r) => r.aptSeq));
  for (const r of ready) {
    if (recheck.has(r.aptSeq)) { skippedExisting.push(r.aptSeq); continue; }
    try {
      const res = await db.createMaster(toCreateData(r));
      if (res === 'DUPLICATE') skippedExisting.push(r.aptSeq);
      else inserted.push(res);
    } catch (e: any) {
      failed.push({ aptSeq: r.aptSeq, error: String(e?.message ?? e).slice(0, 300) });
    }
  }
  const applied = buildAppliedArtifact({ batchStartedAt, batchFinishedAt: now(), districts: targets, dbHostKind: db.hostKind, inserted, skippedExisting, failed });
  writeJson(path.join(opts.outDir, `applied-${batchStartedAt.replace(/[:.]/g, '-')}.json`), applied);
  const done = { ...summary, mode: 'APPLIED', apply: { allowed: true, ...applied.counts }, writes: { insert: inserted.length, update: 0, delete: 0 } };
  writeJson(path.join(opts.outDir, 'summary.json'), done);
  deps.log(`[APPLY] inserted ${inserted.length} · skippedExisting ${skippedExisting.length} · failed ${failed.length}`);
  return { summary: done, rows, applied };
}

function applyCoord(r: SeedRow, e: CoordEntry, overrideStatus?: SeedRow['coordinateStatus']) {
  r.coordinateStatus = overrideStatus ?? e.status;
  r.forwardAddress = e.forward?.address ?? null;
  r.forwardLat = e.forward?.status === 'EXACT' ? e.forward.lat : null;
  r.forwardLng = e.forward?.status === 'EXACT' ? e.forward.lng : null;
  r.reverseAddress = e.reverse?.address ?? null;
  r.reverseLot = e.reverse?.lot ?? null;
  r.coordinateReason = e.reverse?.reason ?? null;
  // 저장 좌표는 양방향 검증 통과(VERIFIED)만. 그 밖은 정방향 좌표가 있어도 null.
  if (r.coordinateStatus === 'VERIFIED' && r.forwardLat != null && r.forwardLng != null) {
    r.lat = r.forwardLat; r.lng = r.forwardLng; r.coordinateSource = 'KAKAO_ADDRESS_EXACT_LOT_REVERSE_VERIFIED'; r.coordinateConfidence = 'EXACT_LOT_BOTH_DIRECTIONS';
  } else {
    r.lat = null; r.lng = null; r.coordinateSource = null; r.coordinateConfidence = null;
  }
}

// ───────────────────────── 실제 의존성 ─────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const molitKey = () => encodeURIComponent(decodeURIComponent((process.env.DATA_GO_KR_API_KEY || '').trim().replace(/['"]/g, '')));
const xml = new XMLParser({ ignoreAttributes: false, parseTagValue: false }); // 코드·지번 원문 보존
const SALE_ENDPOINT = 'http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';
let lastMolitAt = 0;

/** MOLIT 한 페이지. 제한·타임아웃·5xx만 제한 횟수 재시도, 나머지는 분류해서 돌려준다(빈 결과로 바꾸지 않음). */
export const realFetchPage: PageFetcher = async (lawdCd, ym, pageNo, numOfRows) => {
  let last: PageOutcome = { kind: 'NETWORK', detail: 'not attempted' };
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastMolitAt + 350 - Date.now();
    if (wait > 0) await sleep(wait);
    lastMolitAt = Date.now();
    let status = 0;
    let text = '';
    try {
      const res = await fetch(`${SALE_ENDPOINT}?serviceKey=${molitKey()}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=${pageNo}&numOfRows=${numOfRows}`, {
        headers: { Accept: 'application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000),
      });
      status = res.status;
      text = await res.text();
    } catch (e: any) {
      last = { kind: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', detail: e?.name ?? 'error' };
      if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status === 429 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|초당\s*서비스\s*요청\s*제한/.test(text)) {
      last = { kind: 'RATE_LIMITED', detail: `http=${status}` };
      if (attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
      return last;
    }
    if (status >= 500 && attempt < 2) { last = { kind: 'HTTP_ERROR', detail: `http=${status}` }; await sleep(1000 * 2 ** attempt); continue; }
    if (status !== 200) return { kind: 'HTTP_ERROR', detail: `http=${status}` };
    let j: any;
    try { j = xml.parse(text); } catch { return { kind: 'PARSE_ERROR', detail: 'xml' }; }
    const header = j?.response?.header;
    if (!header) return { kind: 'PARSE_ERROR', detail: 'no response.header' };
    const code = String(header.resultCode ?? '');
    if (code !== '00' && code !== '000') return { kind: 'RESULT_CODE', detail: `resultCode=${code}` };
    const total = Number(j.response.body?.totalCount);
    if (!Number.isFinite(total)) return { kind: 'PARSE_ERROR', detail: 'totalCount' };
    const raw = j.response.body?.items?.item;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return {
      kind: 'OK', totalCount: total,
      items: items.map((it: any) => ({
        aptSeq: it.aptSeq, aptNm: it.aptNm, umdNm: it.umdNm, umdCd: it.umdCd, jibun: it.jibun, sggCd: it.sggCd, buildYear: it.buildYear,
        roadNm: it.roadNm, roadNmBonbun: it.roadNmBonbun, roadNmBubun: it.roadNmBubun, dealYear: it.dealYear, dealMonth: it.dealMonth, dealDay: it.dealDay,
      })),
    };
  }
  return last;
};

let lastKakaoAt = 0;
/** Kakao 주소 검색(analyze_type=exact). 429는 제한 횟수만 재시도 후 RATE_LIMITED — 무한 재시도 없음. */
export async function realSearchAddress(query: string): Promise<AddressSearchOutcome> {
  const headers = {
    Authorization: `KakaoAK ${process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || ''}`,
    KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
    Origin: 'http://localhost:3000',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastKakaoAt + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    lastKakaoAt = Date.now();
    try {
      const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=exact`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { if (attempt < 2) { await sleep(2000 * 2 ** attempt); continue; } return { kind: 'RATE_LIMITED', detail: 'http=429' }; }
      if (!res.ok) return { kind: 'ERROR', detail: `http=${res.status}` };
      const body = await res.json();
      return { kind: 'OK', docs: Array.isArray(body?.documents) ? body.documents : [] };
    } catch (e: any) {
      if (attempt < 1) { await sleep(1000); continue; }
      return { kind: 'ERROR', detail: e?.name ?? 'error' };
    }
  }
  return { kind: 'ERROR', detail: 'exhausted' };
}

/** Kakao coord2address(좌표 → 지번 필지). 429는 2회만 재시도 후 RATE_LIMITED. */
export async function realReverseGeocode(lat: number, lng: number): Promise<ReverseOutcome> {
  const headers = {
    Authorization: `KakaoAK ${process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || ''}`,
    KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
    Origin: 'http://localhost:3000',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastKakaoAt + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    lastKakaoAt = Date.now();
    try {
      const res = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) { if (attempt < 2) { await sleep(2000 * 2 ** attempt); continue; } return { kind: 'RATE_LIMITED', detail: 'http=429' }; }
      if (!res.ok) return { kind: 'ERROR', detail: `http=${res.status}` };
      const body = await res.json();
      return { kind: 'OK', doc: Array.isArray(body?.documents) && body.documents.length ? body.documents[0] : null };
    } catch (e: any) {
      if (attempt < 1) { await sleep(1000); continue; }
      return { kind: 'ERROR', detail: e?.name ?? 'error' };
    }
  }
  return { kind: 'ERROR', detail: 'exhausted' };
}

async function hostKind(): Promise<'PRODUCTION' | 'NON_PRODUCTION'> {
  const { isProductionDatabaseUrl } = await import('./_prod-db-guard');
  return isProductionDatabaseUrl(process.env.DATABASE_URL) ? 'PRODUCTION' : 'NON_PRODUCTION';
}

/** 읽기 전용: SET TRANSACTION READ ONLY 안에서 주어진 서울 aptSeq만 조회. */
export async function realReadDb(): Promise<ReadOnlySeedDb> {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'seed-seoul-apartment-master(dry-run read)');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  return {
    mode: 'READ_ONLY',
    hostKind: await hostKind(),
    async findExistingAptSeqs(aptSeqs) {
      const seoul = aptSeqs.filter((s) => SEOUL_CODES.has(s.slice(0, 5)));
      if (seoul.length === 0) return new Set();
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return tx.$queryRaw<{ apt_seq: string }[]>`SELECT apt_seq FROM apartment_masters WHERE apt_seq = ANY(${seoul})`;
      });
      return new Set(rows.map((r) => r.apt_seq));
    },
  };
}

/** create 전용. BACKFILL 가드(ALLOW_PROD_DB_WRITE=1) 통과 후에만 만들어진다. update/upsert/delete 메서드 없음. */
export async function realWriteDb(): Promise<WritableSeedDb> {
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('BACKFILL', 'seed-seoul-apartment-master(--apply)');
  const read = await realReadDb();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  return {
    mode: 'CREATE_ONLY',
    hostKind: read.hostKind,
    findExistingAptSeqs: read.findExistingAptSeqs,
    async createMaster(data) {
      if (!SEOUL_CODES.has(String(data.sggCd)) || !data.aptSeq.startsWith(String(data.sggCd))) throw new Error(`서울 행이 아님: ${data.aptSeq}`);
      try {
        const r = await prisma.apartmentMaster.create({ data, select: { id: true, aptSeq: true, sggCd: true, createdAt: true } });
        return { id: r.id, aptSeq: r.aptSeq!, sggCd: r.sggCd!, createdAt: r.createdAt.toISOString() };
      } catch (e: any) {
        if (e?.code === 'P2002') return 'DUPLICATE';
        throw e;
      }
    },
  };
}

/** 계획 단계 artifact에서 Tier B/REVIEW 제외 목록과 Tier A 목록을 읽는다(없으면 null — 원천이 매매뿐이라 Tier B는 어차피 후보가 아님). */
export function loadPlan(planFile: string): { exclusions: PlanExclusions; tierA: Set<string> } | null {
  if (!fs.existsSync(planFile)) return null;
  const rows = JSON.parse(fs.readFileSync(planFile, 'utf8')) as { aptSeq: string; tier: string }[];
  const exclusions = new Map<string, 'TIER_B' | 'REVIEW'>();
  const tierA = new Set<string>();
  for (const r of rows) {
    if (r.tier === 'TIER_B_RENT_ONLY') exclusions.set(r.aptSeq, 'TIER_B');
    else if (r.tier === 'REVIEW_REQUIRED') exclusions.set(r.aptSeq, 'REVIEW');
    else if (r.tier === 'TIER_A_SALE') tierA.add(r.aptSeq);
  }
  return { exclusions, tierA };
}

/** KST 기준 이번 달 포함 최근 n개월(최신 먼저). */
export function monthsBackKst(n: number, now = new Date()): string[] {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function parseCli(argv: readonly string[], env: Record<string, string | undefined>) {
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const district = get('district');
  const expect = get('expect-ready');
  const months = Number(get('months') ?? 24);
  return {
    apply: argv.includes('--apply'),
    districts: district ? district.split(',').map((s) => s.trim()).filter(Boolean) : null,
    expectReady: expect != null && /^\d+$/.test(expect) ? Number(expect) : null,
    skipCoordinates: argv.includes('--skip-coordinates'),
    refetch: argv.includes('--refetch'),
    months,
    allowProdDbWrite: env.ALLOW_PROD_DB_WRITE,
    outDir: get('out') ?? path.resolve(__dirname, '../tmp/seoul-master-seed-run'),
    planFile: get('plan') ?? path.resolve(__dirname, '../tmp/seoul-master-seed-plan/raw/final-candidates.json'),
  };
}

async function main() {
  const cli = parseCli(process.argv.slice(2), process.env as Record<string, string | undefined>);
  const plan = loadPlan(cli.planFile);
  const result = await runSeed(
    { outDir: cli.outDir, months: monthsBackKst(cli.months), districts: cli.districts, apply: cli.apply, allowProdDbWrite: cli.allowProdDbWrite, expectReady: cli.expectReady, skipCoordinates: cli.skipCoordinates, refetch: cli.refetch },
    {
      fetchPage: realFetchPage, searchAddress: realSearchAddress, reverseGeocode: realReverseGeocode, readDb: realReadDb, writeDb: realWriteDb,
      planExclusions: plan?.exclusions ?? null, planTierA: plan?.tierA ?? null, now: () => new Date(), log: (m) => console.log(m),
    }
  );
  console.log(JSON.stringify({ byStatus: result.summary.byStatus, coordinates: result.summary.coordinates, heldBack: result.summary.heldBackDistricts, writes: result.summary.writes }, null, 2));
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
