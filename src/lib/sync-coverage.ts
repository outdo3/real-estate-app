// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §24/§25 — sync coverage의 **durable** 저장소 접근 계층.
//
// 왜 DB인가: Phase 2 감사에서 "cron이 git-tracked JSON manifest를 써서 coverage를 전진시킨다"는
// Phase 1.5 설계가 Vercel에서 구조적으로 불가능함을 실측했다. manifest는 빌드 입력이라 이를
// 읽는 함수마다 **각자의 사본**이 번들에 복사되고(빌드 산출물 .nft.json으로 확인), 함수
// 파일시스템은 읽기 전용이며, 읽는 쪽은 module load 시점에 값을 상수로 고정한다. 따라서 cron
// 함수의 쓰기는 다음 독립 invocation에서 절대 보이지 않는다.
//
// 이 파일은 그 유일한 신뢰 출처(sync_coverage_cells 테이블)를 읽고 쓴다. 판정 규칙 자체는
// rent-verified-range.ts(순수)에 있고, 여기서는 I/O와 캐싱만 담당한다.
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from './prisma';
import { getOrSetCache } from './server-cache';
import {
  BUSAN_LAWDCD_16,
  LEGACY_BOOTSTRAP_FALLBACK,
  computeVerifiedRangeFromCoverage,
  type CoverageCellStatusMap,
  type VerifiedRange,
} from './rent-verified-range';

export type SyncDatasetName = 'SALE' | 'RENT';
export type SyncCellStatusName = 'COMPLETE' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID';
export type SyncMode = 'dry-run' | 'apply';

// coverage는 많아야 한 달에 한 번 전진한다. admin/ops와 같은 5분 TTL을 쓴다 — cron 실행
// 직후에도 최대 5분이면 사용자 경로에 반영된다(파일 기반 구조에서는 재배포 전까지 영원히
// 반영되지 않았다).
const CACHE_TTL_MS = 5 * 60 * 1000;
const RENT_RANGE_CACHE_KEY = 'sync-coverage:rent-verified-range-v2';

// legacyBootstrap은 **정적 provenance**다 — 런타임에 변하지 않고 commit으로만 바뀐다.
// 그래서 파일에서 읽어도 durability 문제가 없다(문제였던 것은 런타임 "쓰기"였다).
// 이 값의 근거는 data/rent-trade-history/coverage-manifest.json의 source 필드에 기록돼 있다.
const BOOTSTRAP_MANIFEST_PATH = path.join(process.cwd(), 'data/rent-trade-history/coverage-manifest.json');

export function readLegacyBootstrap(): VerifiedRange {
  try {
    const parsed = JSON.parse(fs.readFileSync(BOOTSTRAP_MANIFEST_PATH, 'utf-8'));
    const from = parsed?.legacyBootstrap?.from;
    const to = parsed?.legacyBootstrap?.to;
    if (typeof from === 'string' && typeof to === 'string') return { from, to };
    return LEGACY_BOOTSTRAP_FALLBACK;
  } catch {
    return LEGACY_BOOTSTRAP_FALLBACK;
  }
}

/**
 * bootstrap.to 이후의 RENT coverage cell을 DB에서 읽어 판정용 map으로 만든다.
 * bootstrap 이전 구간은 이미 verified이므로 조회할 필요가 없다(쿼리 범위 최소화).
 */
export async function loadRentCoverageCells(afterYmd: string): Promise<CoverageCellStatusMap> {
  const rows = await prisma.syncCoverageCell.findMany({
    where: { dataset: 'RENT', dealYmd: { gt: afterYmd } },
    select: { lawdCd: true, dealYmd: true, status: true },
  });
  const map: CoverageCellStatusMap = {};
  for (const r of rows) map[`${r.lawdCd}:${r.dealYmd}`] = { status: r.status };
  return map;
}

/**
 * RENT 검증범위를 DB coverage 기준으로 계산한다(5분 캐시).
 *
 * DB를 읽을 수 없는 경우에도 절대 "더 넓은" 범위를 주장하지 않는다 — legacyBootstrap으로
 * 안전하게 축소 폴백한다(추측 생성 아님: 과거에 실제로 검증된 값 그대로).
 */
export async function getRentVerifiedRange(): Promise<VerifiedRange> {
  return getOrSetCache(RENT_RANGE_CACHE_KEY, CACHE_TTL_MS, async () => {
    const bootstrap = readLegacyBootstrap();
    try {
      const cells = await loadRentCoverageCells(bootstrap.to);
      return computeVerifiedRangeFromCoverage(bootstrap, cells, BUSAN_LAWDCD_16, new Date());
    } catch (e) {
      console.error('[sync-coverage] rent coverage 조회 실패 — legacyBootstrap으로 축소 폴백', e);
      return bootstrap;
    }
  });
}

export interface CoverageCellRecord {
  lawdCd: string;
  dealYmd: string;
  status: SyncCellStatusName;
  sourceTotalCount: number | null;
  fetchedCount: number;
  blockedCount: number;
  insertedCount: number;
  updatedCount: number;
}

/**
 * DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §5/§14 — coverage cell 기록.
 *
 * dry-run은 **절대** coverage를 기록하지 않는다. 이 규칙은 호출부(shouldRecordCoverageCell)
 * 에도 있지만 여기서도 독립적으로 강제한다 — 우발적인 production write를 막는 이중 안전장치다.
 * 실제로 기록되는 상태는 호출부가 결정하며, PARTIAL/INVALID도 "그 셀이 아직 검증되지 않았다"는
 * 사실 자체로서 기록될 수 있다(그 상태는 verified로 인정되지 않는다 — isVerifiedCellStatus 참고).
 */
export async function recordCoverageCells(
  mode: SyncMode,
  dataset: SyncDatasetName,
  runId: string,
  cells: CoverageCellRecord[]
): Promise<{ recorded: number; skippedReason?: string }> {
  if (mode === 'dry-run') {
    return { recorded: 0, skippedReason: 'DRY_RUN_NEVER_RECORDS_COVERAGE' };
  }
  if (cells.length === 0) return { recorded: 0 };

  const verifiedAt = new Date();
  let recorded = 0;
  for (const c of cells) {
    await prisma.syncCoverageCell.upsert({
      where: { sync_coverage_cell_key: { dataset, lawdCd: c.lawdCd, dealYmd: c.dealYmd } },
      create: { dataset, lawdCd: c.lawdCd, dealYmd: c.dealYmd, status: c.status, sourceTotalCount: c.sourceTotalCount, fetchedCount: c.fetchedCount, blockedCount: c.blockedCount, insertedCount: c.insertedCount, updatedCount: c.updatedCount, runId, verifiedAt },
      update: { status: c.status, sourceTotalCount: c.sourceTotalCount, fetchedCount: c.fetchedCount, blockedCount: c.blockedCount, insertedCount: c.insertedCount, updatedCount: c.updatedCount, runId, verifiedAt },
    });
    recorded++;
  }
  return { recorded };
}

/**
 * SALE_CANCELLATION_COVERAGE_V1 §9 — SALE coverage를 쓰는 실행이 두 종류가 됐다.
 *   - daily sale-sync   : runId `sale-<iso>`         (최신 3개월)
 *   - recheck sweep     : runId `sale-recheck-<iso>` (4~12개월 late cancellation)
 *
 * `summarizeCoverage().latestRunId`는 "가장 최근에 coverage를 기록한 실행" 하나만
 * 주므로, sweep이 도입되면 /admin/ops의 "sale 마지막 실행"이 조용히 sweep 실행으로
 * 바뀌어 **daily sync가 멈춰도 정상처럼 보이게 된다**. 그 왜곡을 막기 위해 두 종류를
 * 분리해서 읽는다. ADMIN_OPS_V1.2에서 배운 것과 같은 실수(다른 것을 같은 칸에 넣기)를
 * 반복하지 않는다.
 */
const RECHECK_RUN_ID_PREFIX = 'sale-recheck-';

export async function summarizeSaleRunKinds(): Promise<{
  daily: { runId: string | null; at: string | null };
  recheck: { runId: string | null; at: string | null; cells: number };
}> {
  const [daily, recheck, recheckCells] = await Promise.all([
    prisma.syncCoverageCell.findFirst({
      where: { dataset: 'SALE', NOT: { runId: { startsWith: RECHECK_RUN_ID_PREFIX } } },
      orderBy: { verifiedAt: 'desc' },
      select: { runId: true, verifiedAt: true },
    }),
    prisma.syncCoverageCell.findFirst({
      where: { dataset: 'SALE', runId: { startsWith: RECHECK_RUN_ID_PREFIX } },
      orderBy: { verifiedAt: 'desc' },
      select: { runId: true, verifiedAt: true },
    }),
    prisma.syncCoverageCell.count({ where: { dataset: 'SALE', runId: { startsWith: RECHECK_RUN_ID_PREFIX } } }),
  ]);
  return {
    daily: { runId: daily?.runId ?? null, at: daily?.verifiedAt ? daily.verifiedAt.toISOString() : null },
    recheck: { runId: recheck?.runId ?? null, at: recheck?.verifiedAt ? recheck.verifiedAt.toISOString() : null, cells: recheckCells },
  };
}

/** /admin/ops 표시용 — 특정 dataset의 coverage cell 요약(라이브). */
export async function summarizeCoverage(dataset: SyncDatasetName): Promise<{
  totalCells: number;
  byStatus: Record<string, number>;
  latestVerifiedAt: string | null;
  /** 가장 최근에 coverage를 기록한 실행의 runId — "마지막 실행"을 로그와 대조할 수 있게 한다.
   * cron 등록 여부(SCHEDULED)와 분리해서 보여준다: 등록됐다는 사실이 성공적으로 돌았다는
   * 뜻은 아니기 때문이다(§8). */
  latestRunId: string | null;
}> {
  const [grouped, latest, latestCell] = await Promise.all([
    prisma.syncCoverageCell.groupBy({ by: ['status'], where: { dataset }, _count: { _all: true } }),
    prisma.syncCoverageCell.aggregate({ where: { dataset }, _max: { verifiedAt: true } }),
    prisma.syncCoverageCell.findFirst({ where: { dataset }, orderBy: { verifiedAt: 'desc' }, select: { runId: true } }),
  ]);
  const byStatus: Record<string, number> = {};
  let totalCells = 0;
  for (const g of grouped) {
    byStatus[g.status] = g._count._all;
    totalCells += g._count._all;
  }
  return {
    totalCells,
    byStatus,
    latestVerifiedAt: latest._max.verifiedAt ? latest._max.verifiedAt.toISOString() : null,
    latestRunId: latestCell?.runId ?? null,
  };
}
