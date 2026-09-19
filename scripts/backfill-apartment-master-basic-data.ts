/**
 * DATA_COVERAGE_FIX_V1 — ApartmentMaster(부산) 기본 스펙(용적률/건폐율/주차대수/세대당
 * 주차/세대수/동수/사용승인일/mgmBldrgstPk) backfill.
 *
 * 절대 원칙:
 *  - `--apply` 없이는 DB에 절대 쓰지 않는다(기본은 dry-run).
 *  - 부산(sggCd가 "26"으로 시작) 외 행은 절대 건드리지 않는다.
 *  - 기존에 이미 non-null인 필드는 절대 덮어쓰지 않는다(FILL_NULL만, overwrite 없음).
 *    새로 조회한 값이 기존 값과 다르면 CONFLICT_REVIEW로 기록만 하고 그 필드는 쓰지 않는다.
 *  - 이름만으로 단지를 찾지 않는다 — 항상 aptSeq/sggCd+umdCd+jibun identity로만 조회한다.
 *  - 표제부 fallback은 그 지번에 건물이 정확히 1건일 때만 신뢰한다
 *    (docs/development/14-apartment-master-m4-expansion-analysis.md §K,
 *    src/lib/apt-building-info.ts의 안전조건과 동일 — parseBrTitleInfoRecord를 그대로 재사용).
 *
 * 사용법:
 *   # 1) 읽기 전용 dry-run(부산 전체)
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-apartment-master-basic-data.ts --dry-run
 *
 *   # 2) 대표 샘플만 실제 반영(승인된 sample write gate)
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-apartment-master-basic-data.ts --apply --sample
 *
 *   # 3) 특정 aptSeq만
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-apartment-master-basic-data.ts --apply --aptSeq=26470-1040
 *
 *   # 4) 부산 전체 반영(재개 가능 — 이미 terminal 상태로 체크포인트된 aptSeq는 건너뜀)
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-apartment-master-basic-data.ts --apply --resume
 *
 *   # 5) 체크포인트 무시하고 처음부터(멱등성 재검증용)
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/backfill-apartment-master-basic-data.ts --apply
 *
 * SEOUL_BUILDING_LEDGER_ENRICHMENT_PLAN_V1 — 지역 인자(--region, 기본 26=부산 — 기존 동작 그대로).
 *   서울(--region=11)은 STRICT 정책(잘린 응답·필지 불일치·총괄표제부 여러 건 = 보류)과 주소 원문 계획을 쓰고,
 *   이 버전에서는 **dry-run 전용**(--apply 거부). 산출물은 tmp/seoul-ledger-enrichment/.
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/backfill-apartment-master-basic-data.ts --region=11 --sample [--sample-size=240] [--cross-check]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient, BasicSpecSource } from '@prisma/client';
import { parseBrTitleInfoRecord, isNumberedBuildingUnit } from '../src/lib/apt-building-info';
import {
  planField,
  calcParkingPerHousehold,
  decideGeneralTitle,
  extractGeneralFields,
  decideTitleFallback,
  crossCheckGeneralVsTitle,
  ledgerPageParams,
  countMainBuildings,
  LENIENT_POLICY,
  STRICT_POLICY,
  regionConfig,
  pickSeoulSample,
  SEOUL_SAMPLE_DISTRICTS,
  type LedgerPolicy,
  type LotQuery,
  type FieldPlan as SharedFieldPlan,
} from './backfill-basic-data-logic';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

const prisma = new PrismaClient();
const API_KEY = process.env.DATA_GO_KR_API_KEY || '';

// 부산(기본)은 기존 결과 폴더 그대로, 서울은 별도 폴더(체크포인트 섞임 방지).
const REGION_ARG = (process.argv.find((a) => a.startsWith('--region=')) ?? '--region=26').split('=')[1];
const RESULTS_DIR = REGION_ARG === '26'
  ? path.resolve(__dirname, '_data_coverage_fix_v1_results')
  : path.resolve(__dirname, '../tmp/seoul-ledger-enrichment');
const CHECKPOINT_PATH = path.join(RESULTS_DIR, 'checkpoint.json');
const LOG_PATH = path.join(RESULTS_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);

/** 마지막 관측 x-ratelimit-remaining(읽기만). */
const ledgerQuota: { remaining: number | null; calls: number } = { remaining: null, calls: 0 };
function observeQuota(res: Response) {
  ledgerQuota.calls++;
  const h = res.headers?.get?.('x-ratelimit-remaining');
  if (h != null && h !== '' && Number.isFinite(Number(h))) ledgerQuota.remaining = Number(h);
}

// ── CLI args ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const prefix = `${flag}=`;
    const hit = args.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    apply: has('--apply'),
    resume: has('--resume'),
    sample: has('--sample'),
    limit: get('--limit') ? parseInt(get('--limit')!, 10) : undefined,
    aptSeqFilter: get('--aptSeq') ? get('--aptSeq')!.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    region: get('--region') ?? '26',
    crossCheck: has('--cross-check'),
    sampleSize: get('--sample-size') ? parseInt(get('--sample-size')!, 10) : 240,
    /** 서울 전용: 구 단위 분할 실행(재개 단위). 산출물은 tmp/seoul-ledger-enrichment/district-<구>/. */
    district: get('--district'),
  };
}

// §14 SAMPLE WRITE GATE — 정상 총괄표제부 단지 + 표제부 fallback 단지(연산동한솔솔파크) +
// 기존 값 많은/적은 단지를 섞은 대표 26건. 전부 실제 부산 ApartmentMaster에 존재하는
// aptSeq로 직접 DB 조회/부분 dry-run 로그로 확인한 값이다(최초 버전은 존재를 확인하지
// 않고 추측으로 만든 가짜 aptSeq가 섞여 있어 20건 중 16건이 조용히 스킵되는 실수가
// 있었다 — 재발 방지로 이 주석을 남긴다).
const SAMPLE_APT_SEQS = [
  '26470-1040', // 연산동한솔솔파크 — 표제부 fallback 케이스(감사에서 실증), STEP 필수 검증 대상
  '26140-1164', // 대신롯데캐슬(서대신동3가) — 총괄표제부 정상, 기존 legacy Apartment 캐시에 값 많음
  '26470-1481', // 연산동일동미라주더스타 — STEP 필수 검증 대상
  '26140-1356', // 대신해모로센트럴아파트 — STEP 필수 검증 대상
  // 기존 값(세대수/주차/mgmBldrgstPk) 많은 행 — overwrite 없이 신규 필드만 채워지는지 확인
  '26140-1361', '26140-1243', '26140-1290', '26140-1353',
  // 기존 값 거의 없는 행
  '26140-11', '26140-1202', '26350-271', '26350-225', '26350-283',
  // 총괄표제부 정상 성공(부분 dry-run 로그에서 확인)
  '26230-2814', '26230-2317', '26230-148', '26440-111', '26710-399',
  // 표제부 fallback 성공(부분 dry-run 로그에서 확인)
  '26350-2582', '26230-2557', '26230-2407', '26230-1890', '26170-748',
];

// ── 건축물대장(BldRgstHubService) 호출 — apartment_master_seed.ts의 검증된 rate-limit
// 대응 패턴을 그대로 재사용한다(M4-B 부산진구 파일럿 실측: 800ms 간격도 429 유발,
// 1500ms 전역 직렬 큐로 해결됨). 이 스크립트 자체가 별도 프로세스라 그 큐를 import로
// 공유할 수 없어 동일한 상수/로직을 이 파일 안에 다시 둔다(그 파일을 이 스크립트가
// import하면 apartment_master_seed.ts의 CLI 진입 코드까지 실행돼버려 안전하지 않음).
const LEDGER_MIN_INTERVAL_MS = 1500;
let ledgerQueue: Promise<void> = Promise.resolve();
let ledgerLastCallAt = 0;

function throttledLedgerCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerQueue.then(async () => {
    const wait = Math.max(0, LEDGER_MIN_INTERVAL_MS - (Date.now() - ledgerLastCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    ledgerLastCallAt = Date.now();
    return fn();
  });
  ledgerQueue = run.then(() => undefined, () => undefined);
  return run;
}

function jibunToBunJi(jibun: string): { bun: string; ji: string } | null {
  const parts = jibun.split('-');
  const bunNum = parseInt(parts[0], 10);
  if (isNaN(bunNum)) return null;
  const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  return { bun: bunNum.toString().padStart(4, '0'), ji: jiNum.toString().padStart(4, '0') };
}

interface GeneralTitleResult {
  /** multiple/incomplete/lot_mismatch는 STRICT(서울)에서만 나온다. */
  status: 'success' | 'not_found' | 'failed_retryable' | 'multiple' | 'incomplete' | 'lot_mismatch' | 'jibun_unparseable';
  totalHouseholds: number | null;
  mainBuildingCount: number | null;
  parkingCount: number | null;
  useApprovalDate: string | null;
  mgmBldrgstPk: string | null;
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  records: number;
}

function lotQueryOf(sggCd: string, umdCd: string, jibun: string): LotQuery | null {
  const bj = jibunToBunJi(jibun);
  return bj ? { sggCd, umdCd, bun: bj.bun, ji: bj.ji } : null;
}

async function fetchGeneralTitleOnce(sggCd: string, umdCd: string, jibun: string, policy: LedgerPolicy): Promise<GeneralTitleResult> {
  const bj = jibunToBunJi(jibun);
  const empty = (status: GeneralTitleResult['status'], records = 0): GeneralTitleResult => ({
    status, totalHouseholds: null, mainBuildingCount: null, parkingCount: null,
    useApprovalDate: null, mgmBldrgstPk: null, floorAreaRatio: null, buildingCoverageRatio: null, roadAddress: null, jibunAddress: null, records,
  });
  // 부산(LENIENT)은 기존과 같이 not_found, 서울(STRICT)은 지번을 조회 키로 만들 수 없음을 따로 표시한다.
  if (!bj) return empty(policy.strict ? 'jibun_unparseable' : 'not_found');
  const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bj.bun}&ji=${bj.ji}&${ledgerPageParams(policy)}&_type=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  observeQuota(res);
  const rawText = await res.text();
  if (!res.ok) {
    const retryable = res.status === 429 || res.status === 503 || rawText.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS');
    if (retryable) { const e: any = new Error(`HTTP ${res.status}`); e.retryable = true; throw e; }
    return empty('not_found');
  }
  const pkMatch = rawText.match(/"mgmBldrgstPk"\s*:\s*"?([0-9]+)"?/);
  const rawMgmBldrgstPk = pkMatch ? pkMatch[1] : null;
  const json = JSON.parse(rawText);
  const header = json?.response?.header;
  if (header?.resultCode && header.resultCode !== '00') {
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(header?.errMsg || '')) {
      const e: any = new Error('rate limited'); e.retryable = true; throw e;
    }
    return empty('not_found');
  }
  const items = json?.response?.body?.items?.item;
  const arr = Array.isArray(items) ? items : (items ? [items] : []);
  const totalRaw = Number(json?.response?.body?.totalCount);
  const decision = decideGeneralTitle(arr, Number.isFinite(totalRaw) ? totalRaw : null, rawMgmBldrgstPk, lotQueryOf(sggCd, umdCd, jibun)!, policy);
  if (decision.status !== 'success') return empty(decision.status, arr.length);
  return { status: 'success', records: arr.length, ...extractGeneralFields(decision.record, decision.mgmBldrgstPk) };
}

async function fetchGeneralTitle(sggCd: string, umdCd: string, jibun: string, policy: LedgerPolicy = LENIENT_POLICY): Promise<GeneralTitleResult> {
  const maxAttempts = 3;
  const failed: GeneralTitleResult = { status: 'failed_retryable', totalHouseholds: null, mainBuildingCount: null, parkingCount: null, useApprovalDate: null, mgmBldrgstPk: null, floorAreaRatio: null, buildingCoverageRatio: null, roadAddress: null, jibunAddress: null, records: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await throttledLedgerCall(() => fetchGeneralTitleOnce(sggCd, umdCd, jibun, policy));
    } catch (e: any) {
      if (!e?.retryable || attempt === maxAttempts) return failed;
      await new Promise((r) => setTimeout(r, LEDGER_MIN_INTERVAL_MS * attempt));
    }
  }
  return failed;
}

interface TitleFallbackResult {
  status: 'success' | 'not_found' | 'multiple_review' | 'building_unit_review' | 'failed_retryable' | 'incomplete' | 'lot_mismatch';
  info: ReturnType<typeof parseBrTitleInfoRecord> | null;
  /** 교차 확인용 원 레코드(STRICT). */
  records: any[];
  roadAddress: string | null;
  jibunAddress: string | null;
}

async function fetchTitleFallbackOnce(sggCd: string, umdCd: string, jibun: string, policy: LedgerPolicy): Promise<TitleFallbackResult> {
  const bj = jibunToBunJi(jibun);
  const none = (status: TitleFallbackResult['status'], records: any[] = []): TitleFallbackResult => ({ status, info: null, records, roadAddress: null, jibunAddress: null });
  if (!bj) return none('not_found');
  const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${sggCd}&bjdongCd=${umdCd}&platGbCd=0&bun=${bj.bun}&ji=${bj.ji}&${ledgerPageParams(policy)}&_type=json`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  observeQuota(res);
  const rawText = await res.text();
  if (!res.ok) {
    const retryable = res.status === 429 || res.status === 503 || rawText.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS');
    if (retryable) { const e: any = new Error(`HTTP ${res.status}`); e.retryable = true; throw e; }
    return none('not_found');
  }
  const json = JSON.parse(rawText);
  const header = json?.response?.header;
  if (header?.resultCode && header.resultCode !== '00') {
    if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(header?.errMsg || '')) {
      const e: any = new Error('rate limited'); e.retryable = true; throw e;
    }
    return none('not_found');
  }
  const items = json?.response?.body?.items?.item;
  const arr = Array.isArray(items) ? items : (items ? [items] : []);
  const totalRaw = Number(json?.response?.body?.totalCount);
  // 안전조건(기존과 동일): 1건일 때만, 동번호 단위("103동")면 사람 검토 — MASTER_HOUSEHOLD_VERIFICATION_V1.
  const decision = decideTitleFallback(arr, Number.isFinite(totalRaw) ? totalRaw : null, lotQueryOf(sggCd, umdCd, jibun)!, policy, isNumberedBuildingUnit);
  if (decision !== 'success') return none(decision, arr);
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { status: 'success', info: parseBrTitleInfoRecord(arr[0]), records: arr, roadAddress: text(arr[0].newPlatPlc), jibunAddress: text(arr[0].platPlc) };
}

async function fetchTitleFallback(sggCd: string, umdCd: string, jibun: string, policy: LedgerPolicy = LENIENT_POLICY): Promise<TitleFallbackResult> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await throttledLedgerCall(() => fetchTitleFallbackOnce(sggCd, umdCd, jibun, policy));
    } catch (e: any) {
      if (!e?.retryable || attempt === maxAttempts) return { status: 'failed_retryable', info: null, records: [], roadAddress: null, jibunAddress: null };
      await new Promise((r) => setTimeout(r, LEDGER_MIN_INTERVAL_MS * attempt));
    }
  }
  return { status: 'failed_retryable', info: null, records: [], roadAddress: null, jibunAddress: null };
}

// ── 체크포인트(재개 가능) ────────────────────────────────────────────────
type CheckpointOutcome = 'success_general' | 'success_title' | 'no_source' | 'review' | 'conflict';
interface Checkpoint { [aptSeq: string]: { outcome: CheckpointOutcome; at: string } }

function loadCheckpoint(): Checkpoint {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8'));
  } catch {
    return {};
  }
}
function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

// ── 행 단위 처리 ─────────────────────────────────────────────────────────
type RowOutcome = 'READY' | 'REVIEW' | 'NO_SOURCE' | 'FAILED' | 'CONFLICT' | 'UNCHANGED' | 'FILLABLE' | 'MULTIPLE';

// 실제 판정 로직(planField/calcParkingPerHousehold)은 순수 함수라 별도 파일
// (backfill-basic-data-logic.ts)로 분리해 dotenv/prisma 부작용 없이 단위 테스트한다.
type FieldPlan = SharedFieldPlan;

async function processRow(row: {
  id: number; aptSeq: string; name: string; sggCd: string | null; umdCd: string | null; jibun: string | null;
  totalHouseholds: number | null; mainBuildingCount: number | null; parkingCount: number | null;
  useApprovalDate: string | null; mgmBldrgstPk: string | null;
  floorAreaRatio: number | null; buildingCoverageRatio: number | null; parkingPerHousehold: number | null;
  roadAddress?: string | null; jibunAddress?: string | null;
}, policy: LedgerPolicy = LENIENT_POLICY, crossCheck = false): Promise<{ outcome: RowOutcome; source: BasicSpecSource | null; plans: FieldPlan[]; note: string; detail?: string }> {
  if (!row.sggCd || !row.umdCd || !row.jibun) {
    return { outcome: 'REVIEW', source: null, plans: [], note: 'identity 불완전(sggCd/umdCd/jibun 결측)' };
  }

  const general = await fetchGeneralTitle(row.sggCd, row.umdCd, row.jibun, policy);
  // STRICT(서울) 전용 상태 — 부산(LENIENT)에서는 나오지 않는다.
  if (general.status === 'jibun_unparseable') return { outcome: 'REVIEW', source: null, plans: [], note: '지번을 건축물대장 조회 키로 만들 수 없음(블록·산 지번 등)', detail: 'JIBUN_UNPARSEABLE' };
  if (general.status === 'multiple') return { outcome: 'MULTIPLE', source: null, plans: [], note: `총괄표제부 ${general.records}건 — 대표값 자동 선택 금지`, detail: 'GENERAL_MULTIPLE' };
  if (general.status === 'incomplete') return { outcome: 'REVIEW', source: null, plans: [], note: '총괄표제부 응답이 totalCount보다 적음', detail: 'GENERAL_INCOMPLETE' };
  if (general.status === 'lot_mismatch') return { outcome: 'REVIEW', source: null, plans: [], note: '총괄표제부 레코드 필지가 조회 지번과 다름', detail: 'GENERAL_LOT_MISMATCH' };
  let source: BasicSpecSource;
  let fresh: { totalHouseholds: number | null; mainBuildingCount: number | null; parkingCount: number | null; useApprovalDate: string | null; mgmBldrgstPk: string | null; floorAreaRatio: number | null; buildingCoverageRatio: number | null };
  let note = '';

  if (general.status === 'failed_retryable') {
    return { outcome: 'FAILED', source: null, plans: [], note: '총괄표제부 조회 반복 실패(retryable)' };
  }

  let addresses: { roadAddress: string | null; jibunAddress: string | null } = { roadAddress: null, jibunAddress: null };
  if (general.status === 'success') {
    source = BasicSpecSource.BUILDINGHUB_GENERAL_TITLE;
    fresh = general;
    addresses = { roadAddress: general.roadAddress, jibunAddress: general.jibunAddress };
    note = '총괄표제부 성공';
    // STRICT 교차 확인(선택): 같은 필지 표제부가 단일 건물이면 세대수가 같아야 한다 — 다르면 병합하지 않고 보류.
    if (policy.strict && crossCheck) {
      const title = await fetchTitleFallback(row.sggCd, row.umdCd, row.jibun, policy);
      // 비교는 완전한 단일 레코드 목록일 때만(잘린 응답·필지 불일치·다건은 비교 대상 아님).
      const comparable = title.status === 'success' || title.status === 'building_unit_review';
      if (comparable && crossCheckGeneralVsTitle(general.totalHouseholds, title.records) === 'CONFLICT') {
        return { outcome: 'CONFLICT', source: null, plans: [], note: '총괄표제부와 단일 표제부의 세대수가 다름 — 자동 병합 금지', detail: 'GENERAL_TITLE_CONFLICT' };
      }
    }
  } else {
    // 총괄표제부 레코드 없음 → 표제부 fallback(정확히 1건일 때만)
    const title = await fetchTitleFallback(row.sggCd, row.umdCd, row.jibun, policy);
    if (title.status === 'incomplete' || title.status === 'lot_mismatch') {
      return { outcome: 'REVIEW', source: null, plans: [], note: `표제부 ${title.status}`, detail: `TITLE_${title.status.toUpperCase()}` };
    }
    if (title.status === 'failed_retryable') {
      return { outcome: 'FAILED', source: null, plans: [], note: '표제부 조회 반복 실패(retryable)' };
    }
    if (title.status === 'multiple_review') {
      // 부산(LENIENT)은 기존대로 REVIEW, 서울(STRICT)은 MULTIPLE로 따로 센다(둘 다 보류 — 쓰지 않음).
      // STRICT 보고용: 다건 중 주건축물이 정확히 1건인지(부속건축물=경비실 등) — 판정은 그대로 보류.
      const oneMain = policy.strict && countMainBuildings(title.records) === 1;
      return { outcome: policy.strict ? 'MULTIPLE' : 'REVIEW', source: null, plans: [], note: '표제부 2건 이상 — 자동 대표값 선택 금지', detail: oneMain ? 'TITLE_MULTIPLE_ONE_MAIN' : 'TITLE_MULTIPLE' };
    }
    if (title.status === 'building_unit_review') {
      return { outcome: 'REVIEW', source: null, plans: [], note: '표제부 1건이지만 dongNm이 구체적 건물번호(예: "103동") — 다동 복합단지의 일부일 위험, 자동 채택 금지(MASTER_HOUSEHOLD_VERIFICATION_V1)' };
    }
    if (title.status === 'not_found' || !title.info) {
      return { outcome: 'NO_SOURCE', source: null, plans: [], note: '총괄표제부/표제부 모두 레코드 없음' };
    }
    source = BasicSpecSource.BUILDINGHUB_TITLE;
    fresh = {
      totalHouseholds: title.info.totalHouseholds,
      mainBuildingCount: null, // 표제부엔 동수 개념 없음(건물 1건 = 그 지번 전체)
      parkingCount: title.info.parkingCount,
      // 표제부(parseBrTitleInfoRecord)는 연도만 안다("YYYY년") — ApartmentMaster.useApprovalDate는
      // 총괄표제부 useAprDay 원본("YYYYMMDD", 일 단위까지 정확)을 저장하는 필드라 의미가 다르다.
      // 모르는 월/일을 "01월 01일"로 지어내면 실제로 알지 못하는 정밀도를 아는 것처럼 저장하게
      // 되므로(데이터 신뢰 원칙 위반), 표제부 경로에서는 이 필드를 채우지 않고 null로 둔다.
      useApprovalDate: null,
      mgmBldrgstPk: null, // 표제부 응답에서 이 스크립트가 별도로 추출하지 않음(총괄표제부 전용 경로 유지)
      floorAreaRatio: title.info.far,
      buildingCoverageRatio: title.info.bcr,
    };
    addresses = { roadAddress: title.roadAddress, jibunAddress: title.jibunAddress };
    note = '표제부 fallback 성공(1건 정확 매칭)';
  }

  const plans: FieldPlan[] = [
    planField('totalHouseholds', row.totalHouseholds, fresh.totalHouseholds),
    planField('mainBuildingCount', row.mainBuildingCount, fresh.mainBuildingCount),
    planField('parkingCount', row.parkingCount, fresh.parkingCount),
    planField('useApprovalDate', row.useApprovalDate, fresh.useApprovalDate),
    planField('mgmBldrgstPk', row.mgmBldrgstPk, fresh.mgmBldrgstPk),
    planField('floorAreaRatio', row.floorAreaRatio, fresh.floorAreaRatio),
    planField('buildingCoverageRatio', row.buildingCoverageRatio, fresh.buildingCoverageRatio),
  ];

  // parkingPerHousehold: 최종 확정된(기존 우선, 없으면 신규) household/parking 기준으로 계산
  const finalHousehold = row.totalHouseholds ?? fresh.totalHouseholds;
  const finalParking = row.parkingCount ?? fresh.parkingCount;
  const freshPph = calcParkingPerHousehold(finalParking, finalHousehold);
  plans.push(planField('parkingPerHousehold', row.parkingPerHousehold, freshPph));
  // STRICT(서울): 정확히 일치한 대장 레코드의 주소 원문도 계획(스키마 기존 필드 roadAddress=newPlatPlc, jibunAddress=platPlc).
  // 부산 기존 동작에는 넣지 않는다.
  if (policy.strict) {
    plans.push(planField('roadAddress', row.roadAddress ?? null, addresses.roadAddress));
    plans.push(planField('jibunAddress', row.jibunAddress ?? null, addresses.jibunAddress));
  }

  if (plans.some((p) => p.action === 'CONFLICT_REVIEW')) {
    return { outcome: 'CONFLICT', source, plans, note: note + ' — 기존 값과 충돌하는 필드 있음(덮어쓰지 않음)' };
  }
  if (plans.every((p) => p.action === 'UNCHANGED' || p.action === 'MATCH_EXISTING')) {
    return { outcome: 'UNCHANGED', source, plans, note: note + ' — 새로 쓸 필드 없음(이미 채워짐/동일)' };
  }
  return { outcome: 'READY', source, plans, note };
}

// ── 메인 ─────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const logLines: string[] = [];
  const log = (line: string) => { console.log(line); logLines.push(line); };

  log(`DATA_COVERAGE_FIX_V1 backfill — mode=${opts.apply ? 'APPLY' : 'DRY-RUN'} resume=${opts.resume} sample=${opts.sample} limit=${opts.limit ?? 'none'} aptSeq=${opts.aptSeqFilter?.join(',') ?? 'none'}`);

  if (!API_KEY) {
    log('DATA_GO_KR_API_KEY 미설정 — 중단');
    process.exitCode = 1;
    return;
  }

  const region = regionConfig(opts.region);
  if (!region) {
    log(`지원하지 않는 --region=${opts.region} (26=부산, 11=서울) — 중단`);
    process.exitCode = 1;
    return;
  }
  const isSeoul = region.sggPrefix === '11';
  if (isSeoul) {
    // SEOUL_BUILDING_LEDGER_ENRICHMENT_PLAN_V1 — 서울은 이 버전에서 dry-run 전용. 쓰기는 별도 승인 STEP에서 연다.
    if (opts.apply) {
      log('BLOCKED: 서울(--region=11) --apply는 아직 승인되지 않았다 — dry-run만 가능. DB write 없음.');
      process.exitCode = 2;
      return;
    }
    if (opts.district && !/^11\d{3}$/.test(opts.district)) {
      log(`--district=${opts.district}는 서울 구 코드(11xxx)가 아니다 — 중단`);
      process.exitCode = 1;
      return;
    }
    const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
    assertProductionDbAccessAllowed('DIAGNOSTIC', 'backfill-apartment-master-basic-data(--region=11 dry-run)');
    await runSeoulDryRun(opts, log);
    fs.writeFileSync(LOG_PATH, logLines.join('\n'));
    return;
  }

  const where: any = { sggCd: { startsWith: region.sggPrefix } }; // 부산만(§17: 부산 외 write 금지)
  if (opts.aptSeqFilter) where.aptSeq = { in: opts.aptSeqFilter };
  else if (opts.sample) where.aptSeq = { in: SAMPLE_APT_SEQS };

  const rows = await prisma.apartmentMaster.findMany({
    where,
    select: {
      id: true, aptSeq: true, name: true, sggCd: true, umdCd: true, jibun: true,
      totalHouseholds: true, mainBuildingCount: true, parkingCount: true,
      useApprovalDate: true, mgmBldrgstPk: true,
      floorAreaRatio: true, buildingCoverageRatio: true, parkingPerHousehold: true,
    },
    orderBy: { id: 'asc' },
  });
  // aptSeq 없는 행은 identity 자체가 없어 애초에 제외(타입도 string으로 좁힘)
  let scoped = rows.filter((r): r is typeof r & { aptSeq: string } => !!r.aptSeq);

  const checkpoint = loadCheckpoint();
  if (opts.resume) {
    const before = scoped.length;
    scoped = scoped.filter((r) => !checkpoint[r.aptSeq]);
    log(`--resume: 체크포인트 기준 ${before - scoped.length}건 스킵, ${scoped.length}건 남음`);
  }
  if (opts.limit) scoped = scoped.slice(0, opts.limit);

  log(`대상 행 수: ${scoped.length}`);

  const counts: Record<RowOutcome, number> = { READY: 0, REVIEW: 0, NO_SOURCE: 0, FAILED: 0, CONFLICT: 0, UNCHANGED: 0, FILLABLE: 0, MULTIPLE: 0 };
  const fillableByField: Record<string, number> = {};
  const newlyPopulated: Record<string, number> = {};
  let updatedRows = 0;
  let processed = 0;

  for (const row of scoped) {
    const result = await processRow(row);
    counts[result.outcome]++;
    processed++;

    if (result.outcome === 'READY') {
      counts.FILLABLE++;
      for (const p of result.plans) {
        if (p.action === 'FILL_NULL') fillableByField[p.field] = (fillableByField[p.field] || 0) + 1;
      }
    }

    if (processed % 25 === 0 || processed === scoped.length) {
      log(`[${processed}/${scoped.length}] ${row.aptSeq} ${row.name} → ${result.outcome} (${result.note})`);
    }

    if (opts.apply && (result.outcome === 'READY')) {
      const data: any = { basicSpecSource: result.source! };
      for (const p of result.plans) {
        if (p.action === 'FILL_NULL') {
          data[p.field] = p.newValue;
          newlyPopulated[p.field] = (newlyPopulated[p.field] || 0) + 1;
        }
      }
      await prisma.apartmentMaster.update({ where: { id: row.id }, data });
      updatedRows++;
      checkpoint[row.aptSeq!] = { outcome: result.source === BasicSpecSource.BUILDINGHUB_TITLE ? 'success_title' : 'success_general', at: new Date().toISOString() };
    } else if (opts.apply) {
      const outcomeMap: Partial<Record<RowOutcome, CheckpointOutcome>> = { NO_SOURCE: 'no_source', REVIEW: 'review', CONFLICT: 'conflict', UNCHANGED: 'success_general' };
      const cpOutcome = outcomeMap[result.outcome];
      if (cpOutcome) checkpoint[row.aptSeq!] = { outcome: cpOutcome, at: new Date().toISOString() };
      // FAILED는 체크포인트에 기록하지 않는다 — 다음 --resume 실행에서 자동 재시도 대상으로 남긴다.
    }

    if (opts.apply && processed % 50 === 0) saveCheckpoint(checkpoint);
  }
  if (opts.apply) saveCheckpoint(checkpoint);

  log('\n=== SUMMARY ===');
  log(`PROCESSED: ${processed}`);
  log(`READY(FILLABLE): ${counts.READY}`);
  log(`REVIEW: ${counts.REVIEW}`);
  log(`NO_SOURCE: ${counts.NO_SOURCE}`);
  log(`FAILED: ${counts.FAILED}`);
  log(`CONFLICT: ${counts.CONFLICT}`);
  log(`UNCHANGED: ${counts.UNCHANGED}`);
  log('\n필드별 채울 수 있는 건수(dry-run 기준) / 실제 채운 건수(apply 기준):');
  for (const f of ['totalHouseholds', 'mainBuildingCount', 'parkingCount', 'useApprovalDate', 'mgmBldrgstPk', 'floorAreaRatio', 'buildingCoverageRatio', 'parkingPerHousehold']) {
    log(`  ${f.padEnd(24)}: fillable=${fillableByField[f] || 0}, updated=${newlyPopulated[f] || 0}`);
  }
  if (opts.apply) log(`\nUPDATED_ROWS: ${updatedRows}`);
  log(`\n로그 저장: ${LOG_PATH}`);

  fs.writeFileSync(LOG_PATH, logLines.join('\n'));
  await prisma.$disconnect();
}

// ───────────────────────── 서울 dry-run(STRICT, 쓰기 없음) ─────────────────────────

async function runSeoulDryRun(opts: ReturnType<typeof parseArgs>, log: (l: string) => void) {
  const rows = await prisma.apartmentMaster.findMany({
    where: { sggCd: opts.district ? opts.district : { startsWith: '11' }, ...(opts.aptSeqFilter ? { aptSeq: { in: opts.aptSeqFilter } } : {}) },
    select: {
      id: true, aptSeq: true, name: true, sggCd: true, umdCd: true, umdName: true, jibun: true, buildYear: true,
      totalHouseholds: true, mainBuildingCount: true, parkingCount: true, useApprovalDate: true, mgmBldrgstPk: true,
      floorAreaRatio: true, buildingCoverageRatio: true, parkingPerHousehold: true, roadAddress: true, jibunAddress: true,
    },
    orderBy: { id: 'asc' },
  });
  const all = rows.filter((r): r is typeof r & { aptSeq: string } => !!r.aptSeq);
  let scoped = opts.sample ? pickSeoulSample(all, SEOUL_SAMPLE_DISTRICTS, Math.max(2, Math.round(opts.sampleSize / SEOUL_SAMPLE_DISTRICTS.length))) : all;
  if (opts.limit) scoped = scoped.slice(0, opts.limit);
  log(`서울 dry-run 대상 ${scoped.length}건 (전체 서울 master ${all.length}) crossCheck=${opts.crossCheck}`);

  const results: any[] = [];
  const t0 = Date.now();
  for (const [i, row] of scoped.entries()) {
    const r = await processRow(row, STRICT_POLICY, opts.crossCheck);
    const fill = Object.fromEntries(r.plans.filter((p) => p.action === 'FILL_NULL').map((p) => [p.field, p.newValue]));
    const status = r.outcome === 'READY' || r.outcome === 'UNCHANGED' ? 'EXACT' : r.outcome === 'MULTIPLE' ? 'MULTIPLE' : r.outcome === 'NO_SOURCE' ? 'NO_MATCH' : r.outcome === 'FAILED' ? 'FAILED' : 'REVIEW_REQUIRED';
    results.push({ aptSeq: row.aptSeq, name: row.name, sggCd: row.sggCd, umdName: row.umdName, jibun: row.jibun, buildYear: row.buildYear, status, outcome: r.outcome, source: r.source, detail: r.detail ?? null, note: r.note, fill });
    if ((i + 1) % 25 === 0 || i + 1 === scoped.length) log(`[${i + 1}/${scoped.length}] ${row.aptSeq} ${row.name} → ${status} (${r.note}) quotaRemaining=${ledgerQuota.remaining}`);
  }

  const by = (st: string) => results.filter((x) => x.status === st);
  const pct = (n: number) => (results.length ? Math.round((n / results.length) * 1000) / 10 : 0);
  const fieldCount = (f: string) => results.filter((x) => x.fill[f] != null).length;
  const fields = ['totalHouseholds', 'mainBuildingCount', 'parkingCount', 'floorAreaRatio', 'buildingCoverageRatio', 'parkingPerHousehold', 'useApprovalDate', 'mgmBldrgstPk', 'roadAddress', 'jibunAddress'];
  const exact = by('EXACT');
  const general = exact.filter((x) => x.source === BasicSpecSource.BUILDINGHUB_GENERAL_TITLE).length;
  const title = exact.filter((x) => x.source === BasicSpecSource.BUILDINGHUB_TITLE).length;
  const households = exact.map((x) => x.fill.totalHouseholds).filter((v: any) => typeof v === 'number') as number[];
  const byDistrict = Object.fromEntries(SEOUL_SAMPLE_DISTRICTS.map((d) => { const x = results.filter((r) => r.sggCd === d); return [d, { n: x.length, exact: x.filter((r) => r.status === 'EXACT').length, multiple: x.filter((r) => r.status === 'MULTIPLE').length, noMatch: x.filter((r) => r.status === 'NO_MATCH').length, review: x.filter((r) => r.status === 'REVIEW_REQUIRED').length }]; }));
  const byEra = ['old', 'new'].map((era) => { const x = results.filter((r) => (era === 'old' ? (r.buildYear ?? 0) < 2005 : (r.buildYear ?? 0) >= 2005)); return { era, n: x.length, exact: x.filter((r) => r.status === 'EXACT').length }; });
  const callsPerRow = results.length ? ledgerQuota.calls / results.length : 0;
  const summary = {
    at: new Date().toISOString(), mode: 'DRY_RUN', region: '11', policy: 'STRICT', sample: opts.sample, crossCheck: opts.crossCheck, district: opts.district ?? null,
    rows: results.length, seoulMasterTotal: all.length,
    status: { EXACT: exact.length, MULTIPLE: by('MULTIPLE').length, NO_MATCH: by('NO_MATCH').length, REVIEW_REQUIRED: by('REVIEW_REQUIRED').length, FAILED: by('FAILED').length },
    pct: { EXACT: pct(exact.length), MULTIPLE: pct(by('MULTIPLE').length), NO_MATCH: pct(by('NO_MATCH').length), REVIEW_REQUIRED: pct(by('REVIEW_REQUIRED').length) },
    exactBySource: { GENERAL_TITLE: general, TITLE_FALLBACK: title, fallbackGainPctPoints: pct(title) },
    reviewDetail: results.filter((x) => x.status !== 'EXACT').reduce((m: Record<string, number>, x) => ((m[x.detail ?? x.outcome] = (m[x.detail ?? x.outcome] ?? 0) + 1), m), {}),
    byDistrict, byEra,
    largeComplexCandidates: { withHouseholds: households.length, ge500: households.filter((h) => h >= 500).length, ge1000: households.filter((h) => h >= 1000).length },
    calls: { total: ledgerQuota.calls, perRow: Math.round(callsPerRow * 100) / 100, quotaRemainingLastSeen: ledgerQuota.remaining },
    elapsedSec: Math.round((Date.now() - t0) / 100) / 10,
    writes: { insert: 0, update: 0, delete: 0 },
  };
  const outDir = opts.district ? path.join(RESULTS_DIR, `district-${opts.district}`) : RESULTS_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const out = (f: string, v: unknown) => fs.writeFileSync(path.join(outDir, f), JSON.stringify(v, null, 2));
  out('summary.json', summary);
  out('sample-results.json', results);
  out('exact-matches.json', exact);
  out('multiple-matches.json', by('MULTIPLE'));
  out('no-match.json', by('NO_MATCH'));
  out('review-required.json', [...by('REVIEW_REQUIRED'), ...by('FAILED')]);
  out('field-coverage.json', { rows: results.length, fillable: Object.fromEntries(fields.map((f) => [f, { count: fieldCount(f), pct: pct(fieldCount(f)) }])) });
  const projectedCalls = Math.round(callsPerRow * all.length);
  out('quota-plan.json', {
    measuredCallsPerRow: summary.calls.perRow, seoulRows: all.length, projectedCalls, ledgerMinIntervalMs: LEDGER_MIN_INTERVAL_MS,
    projectedHours: Math.round(((projectedCalls * LEDGER_MIN_INTERVAL_MS) / 3600000) * 10) / 10,
    note: '건축물대장(BldRgstHubService)은 라이브 상세(/api/apt/[name]/info)와 같은 키를 쓴다 — 전체 실행은 구 단위 --aptSeq 분할·체크포인트로 여러 번에 나눠 한다. 총괄표제부·표제부는 오퍼레이션이 달라 한도도 각각이다.',
    quotaRemainingLastSeen: ledgerQuota.remaining,
  });
  log(`\n=== 서울 dry-run 요약 === ${JSON.stringify(summary.status)} exactBySource=${JSON.stringify(summary.exactBySource)} calls=${ledgerQuota.calls} — DB write 없음`);
  await prisma.$disconnect();
}

// CLI로 직접 실행됐을 때만 main()을 돌린다 — 이 모듈을 테스트 파일이 순수 함수(planField/
// calcParkingPerHousehold)만 가져다 쓰려고 import할 때 전체 backfill이 같이 실행되는 사고를
//막는다. `typeof require`는 ESM(테스트가 쓰는 --experimental-strip-types 로더)에서도 안전하게
// 'undefined'로 평가되어 예외를 던지지 않는다.
const isDirectCliRun = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
if (isDirectCliRun) {
  main().catch(async (e) => {
    console.error('[backfill] 치명적 오류:', e);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
}
