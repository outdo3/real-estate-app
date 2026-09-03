import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';
import { getOrSetCache } from '@/lib/server-cache';
import { getSidoList, getSigunguListForSido } from '@/lib/region-utils';
import { HISTORICAL_LOOKBACK_MONTHS, historicalCoverageLabel } from '@/lib/price-ranking';
import { summarizeManifest, computeOverallHealth, computeCancellationVerdict, OVERALL_STATUS_LABELS, type Manifest, type EvidenceType } from '@/lib/admin-ops-evidence';
// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §23/§24 — 검증범위와 coverage는 이제 DB
// (sync_coverage_cells)에서 온다. legacyBootstrap만 여전히 정적 파일에서 읽는다(런타임에
// 변하지 않는 provenance라 durability 문제가 없다).
import { getRentVerifiedRange, readLegacyBootstrap, summarizeCoverage } from '@/lib/sync-coverage';

export const dynamic = 'force-dynamic';

// ADMIN_OPS_V1.1 §1 — 모든 핵심 값은 근거 종류(evidence)를 명시한다. 과거 검증
// 결과를 실시간 정상처럼, 코드 상 가정을 실제 Production 상태처럼, 확인 불가능한
// 것을 정상처럼 표현하지 않는다(§2 절대 원칙). 결정 로직(summarizeManifest/
// computeOverallHealth)은 src/lib/admin-ops-evidence.ts로 분리해 테스트한다 —
// 이 파일은 그 결과를 조립하는 I/O 오케스트레이션만 담당한다.

const CACHE_TTL_MS = 5 * 60 * 1000;

const BUSAN_16 = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

const NATIONWIDE_MANIFEST_PATH = path.join(process.cwd(), 'data/trade-history/nationwide-sync-manifest.json');
const CANCELLATION_24M_SNAPSHOT_PATH = path.join(process.cwd(), 'data/trade-history/cancellation-24m-verification-snapshot.json');

type ManifestReadResult =
  | { status: 'ok'; manifest: Manifest }
  | { status: 'missing' } // 아직 한 번도 실행된 적 없음 — 정상적인 "데이터 없음" 상태
  | { status: 'unreadable'; error: string }; // 존재하는데 파싱 실패 — 진짜 UNKNOWN 사유

// §2 "확인 불가능 → 정상" 금지 — 파일이 아예 없는 것(missing, 정당한 무상태)과
// 파일이 손상돼 못 읽는 것(unreadable, 진짜 UNKNOWN)을 구분한다. 기존 V1은 둘 다
// 조용히 {}로 취급해 구분이 없었다.
function readManifest(filePath: string): ManifestReadResult {
  if (!fs.existsSync(filePath)) return { status: 'missing' };
  try {
    return { status: 'ok', manifest: JSON.parse(fs.readFileSync(filePath, 'utf-8')) };
  } catch (e) {
    console.error(`[admin/ops] manifest 읽기 실패: ${filePath}`, e);
    return { status: 'unreadable', error: String(e) };
  }
}

interface Cancellation24mSnapshot {
  verifiedAt: string;
  startMonth: string;
  endMonth: string;
  districtCount: number;
  cells: number;
  complete: number;
  emptyValid: number;
  failed: number;
  invalid: number;
  conflicts: number;
  correctedFalseToTrue?: number;
  idempotency: { verdict: boolean; note: string };
  verdict: 'SAFE' | 'UNSAFE'; // 참고용 — API는 이 값을 그대로 신뢰하지 않고 원본 필드로 재계산한다(§7)
  provenance?: {
    sourceDocument: string;
    sourceCommit: string;
    verificationType: string;
    generatedBy: string;
    generatedAt: string;
  };
}

function readCancellation24mSnapshot(): { status: 'ok'; data: Cancellation24mSnapshot } | { status: 'missing' } | { status: 'unreadable' } {
  if (!fs.existsSync(CANCELLATION_24M_SNAPSHOT_PATH)) return { status: 'missing' };
  try {
    return { status: 'ok', data: JSON.parse(fs.readFileSync(CANCELLATION_24M_SNAPSHOT_PATH, 'utf-8')) };
  } catch (e) {
    console.error('[admin/ops] 24개월 취소검증 snapshot 읽기 실패', e);
    return { status: 'unreadable' };
  }
}

// §13 하드코딩 금지 — RegionSelectModal/sync 엔진과 동일한 런타임 조회를 그대로
// 재사용한다(§7 새 체계 금지와 동일 원칙).
async function buildNationwideRegionModel() {
  const sidoList = await getSidoList();
  let syncTargets = 0;
  for (const sido of sidoList) {
    const list = await getSigunguListForSido(sido.code);
    syncTargets += list.length;
  }
  const sejong = sidoList.some((s) => s.code === '36');
  return { sidoCount: sidoList.length, syncTargets, sejongInRegionModel: sejong };
}

async function buildSummary() {
  const now = new Date();
  const nowIso = now.toISOString();

  // §11/§12 TradeHistory — 전부 부산 스코프 LIVE 쿼리. §16 세종은 실거래 DB에
  // 적재된 row가 실제로 있는지 라이브로 직접 확인한다(하드코딩 문자열 아님).
  // 부산 coverage(16/16)도 "목표 지역 수"가 아니라 "실제 row가 있는 지역 수"를
  // 라이브로 센다 — §2 "확인 불가능을 정상처럼" 금지 원칙상, 검증 없이 16/16을
  // 그냥 참으로 표시하지 않는다.
  const [busanTotal, busanCanceled, aptSeqMissing, latestDealAgg, busanCoveredGroups, sejongTradeCount, rentBusanTotal, rentBusanCoveredGroups, rentLatestDealAgg] = await Promise.all([
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }),
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, dealCanceled: true } }),
    prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, aptSeq: null } }),
    prisma.apartmentTradeHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }),
    prisma.apartmentTradeHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }),
    prisma.apartmentTradeHistory.count({ where: { lawdCd: '36110' } }),
    // DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §20 — Phase 1 감사에서 확인된 gap:
    // /admin/ops에 rent freshness가 전혀 노출되지 않았다. sale과 같은 라이브 확인
    // 방식(하드코딩 아님)으로 rent도 함께 노출한다.
    prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }),
    prisma.apartmentRentHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }),
    prisma.apartmentRentHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }),
  ]);

  const nationwideManifestResult = readManifest(NATIONWIDE_MANIFEST_PATH);
  const nationwideSummary = nationwideManifestResult.status === 'ok' ? summarizeManifest(nationwideManifestResult.manifest) : null;

  const cancellation24m = readCancellation24mSnapshot();
  // §7 — snapshot 파일에 저장된 verdict 문자열을 그대로 신뢰하지 않는다. 파일이
  // 손상/변조되거나 저장 당시 로직에 버그가 있어도 API 자신이 원본 필드에서
  // 다시 계산해 걸러낸다(ADMIN_OPS_V1.2의 핵심 교훈 — 저장된 결론이 아니라 원본
  // 사실을 근거로 삼는다).
  const cancellation24mVerdict =
    cancellation24m.status === 'ok'
      ? computeCancellationVerdict({
          cells: cancellation24m.data.cells,
          complete: cancellation24m.data.complete,
          emptyValid: cancellation24m.data.emptyValid,
          failed: cancellation24m.data.failed,
          invalid: cancellation24m.data.invalid,
          conflicts: cancellation24m.data.conflicts,
          idempotent: cancellation24m.data.idempotency.verdict,
        })
      : null;

  const regionModel = await buildNationwideRegionModel();

  // §18 Overall Health — 4단계(정상/확인 필요/문제/확인 불가) 결정은
  // computeOverallHealth()(src/lib/admin-ops-evidence.ts, 테스트 대상)로 분리했다.
  // 개발 단계상 정상적으로 미완성인 상태(전국 DB coverage, 스케줄러 OFF)는
  // 애초에 그 함수의 입력에 포함되지 않아 경고 후보가 될 수 없다.
  const health = computeOverallHealth({
    aptSeqMissing,
    nationwideManifestStatus: nationwideManifestResult.status,
    nationwideFailed: nationwideSummary?.failed ?? 0,
    nationwideInvalid: nationwideSummary?.invalid ?? 0,
    nationwideReviewRequired: nationwideSummary?.reviewRequired ?? 0,
    cancellation24mStatus: cancellation24m.status,
    cancellation24mVerdict,
    sejongInRegionModel: regionModel.sejongInRegionModel,
  });
  const allReasons = [...health.criticalReasons, ...health.warningReasons];

  const busanCoveredCount = busanCoveredGroups.length;
  const rentBusanCoveredCount = rentBusanCoveredGroups.length;
  // PHASE2 §23 — coverage는 파일이 아니라 DB에서 라이브로 읽는다. legacyBootstrap은
  // 정적 provenance라 여전히 파일 기준이다.
  const [rentVerifiedRange, rentCoverageSummary, saleCoverageSummary] = await Promise.all([
    getRentVerifiedRange(),
    summarizeCoverage('RENT'),
    summarizeCoverage('SALE'),
  ]);
  const rentLegacyBootstrap = readLegacyBootstrap();

  return {
    overall: {
      status: OVERALL_STATUS_LABELS[health.statusCode],
      statusCode: health.statusCode,
      subtitle: '현재 확인 가능한 운영 지표 기준',
      warningsCount: allReasons.length,
      lastCheckedAt: nowIso,
    },
    tradeHistory: {
      evidenceType: 'LIVE' as EvidenceType,
      checkedAt: nowIso,
      busanTotal,
      busanActive: busanTotal - busanCanceled,
      busanCanceled,
      latestDealDate: latestDealAgg._max.dealDate ? latestDealAgg._max.dealDate.toISOString().slice(0, 10) : null,
      aptSeqMissing,
      naturalKeyDuplicates: {
        value: 0,
        evidenceType: 'CONFIG' as EvidenceType,
        note: 'DB unique index(apartment_trade_histories_group_key_deal_amount_deal_date_f_key)가 자연키 중복을 구조적으로 차단 — 실제 중복 INSERT 시도가 P2002로 차단됨을 실측 확인(2026-09-01)',
      },
      reviewRequired: {
        value: nationwideSummary?.reviewRequired ?? 0,
        evidenceType: 'SNAPSHOT' as EvidenceType,
        verifiedAt: nationwideSummary?.lastSyncAt ?? null,
        note: '최근 sync 실행 결과 기준(전체 DB 스캔 아님) — aptSeq 없어 insert하지 않고 건너뛴 거래 수',
      },
    },
    coverage: {
      evidenceType: 'LIVE' as EvidenceType,
      checkedAt: nowIso,
      busan: { covered: busanCoveredCount, total: 16 },
      nationwide: { sido: regionModel.sidoCount, syncTargets: regionModel.syncTargets },
      sejong: {
        regionModel: regionModel.sejongInRegionModel ? '정상' : '확인 필요',
        tradeDbCoverage: sejongTradeCount > 0 ? `적재됨(${sejongTradeCount}건)` : '미수집',
      },
      nationwideDbCoverageNote: '전국 sync engine 준비 완료(엔진), 전국 DB 실데이터 적재는 부산 외 극히 일부 QA 샘플만 존재',
    },
    incrementalSync: {
      evidenceType: 'SNAPSHOT' as EvidenceType,
      scopeNote: '최근 제한 QA sync 결과 — 전국 운영 전체 상태가 아니다',
      verifiedAt: nationwideSummary?.lastSyncAt ?? null,
      regionsInScope: nationwideSummary?.regionsInScope ?? 0,
      cells: nationwideSummary?.cells ?? 0,
      complete: nationwideSummary?.complete ?? 0,
      emptyValid: nationwideSummary?.emptyValid ?? 0,
      failed: nationwideSummary?.failed ?? 0,
      invalid: nationwideSummary?.invalid ?? 0,
      rowsInserted: nationwideSummary?.rowsInserted ?? 0,
      cancellationsUpdated: nationwideSummary?.cancellationsUpdated ?? 0,
      // PHASE2 §23 — sale도 rent와 동일하게 DB coverage cell을 라이브로 노출한다.
      coverageCells: {
        evidenceType: 'LIVE' as EvidenceType,
        total: saleCoverageSummary.totalCells,
        byStatus: saleCoverageSummary.byStatus,
        latestVerifiedAt: saleCoverageSummary.latestVerifiedAt,
      },
      scheduler: { value: 'OFF' as const, evidenceType: 'CONFIG' as EvidenceType, note: 'vercel.json crons 미등록 — 아직 활성화하지 않은 의도된 상태' },
      nextScheduledSync: { value: null, evidenceType: 'CONFIG' as EvidenceType },
    },
    cancellation: {
      lookbackMonths: HISTORICAL_LOOKBACK_MONTHS,
      coverageLabel: historicalCoverageLabel(),
      window24m:
        cancellation24m.status === 'ok'
          ? {
              evidenceType: 'SNAPSHOT' as EvidenceType,
              verdict: cancellation24mVerdict, // API가 원본 필드에서 재계산한 값(§7) — 저장된 문자열이 아님
              verifiedAt: cancellation24m.data.verifiedAt,
              startMonth: cancellation24m.data.startMonth,
              endMonth: cancellation24m.data.endMonth,
              cells: cancellation24m.data.cells,
              complete: cancellation24m.data.complete,
              emptyValid: cancellation24m.data.emptyValid,
              failed: cancellation24m.data.failed,
              invalid: cancellation24m.data.invalid,
              conflicts: cancellation24m.data.conflicts,
              correctedFalseToTrue: cancellation24m.data.correctedFalseToTrue ?? null,
              idempotent: cancellation24m.data.idempotency.verdict,
              source: 'data/trade-history/cancellation-24m-verification-snapshot.json',
              provenance: cancellation24m.data.provenance ?? null,
            }
          : {
              evidenceType: 'UNKNOWN' as EvidenceType,
              verdict: 'UNKNOWN' as const,
              verifiedAt: null,
              startMonth: null,
              endMonth: null,
              cells: 0,
              complete: 0,
              emptyValid: 0,
              failed: 0,
              invalid: 0,
              conflicts: 0,
              correctedFalseToTrue: null,
              idempotent: null,
              source: cancellation24m.status === 'missing' ? 'snapshot 파일 없음' : 'snapshot 파일 손상',
              provenance: null,
            },
      allTime: {
        evidenceType: 'CONFIG' as EvidenceType,
        verdict: 'NOT_VERIFIED' as const,
        note: '역대(2006년~) 전체 이력 취소 완전성은 검증되지 않음 — "역대" 표현 계속 금지',
      },
    },
    rentCoverage: {
      evidenceType: 'LIVE' as EvidenceType,
      checkedAt: nowIso,
      busan: { covered: rentBusanCoveredCount, total: 16 },
      totalRows: rentBusanTotal,
      latestDealDate: rentLatestDealAgg._max.dealDate ? rentLatestDealAgg._max.dealDate.toISOString().slice(0, 10) : null,
      verified: rentVerifiedRange,
      legacyBootstrap: rentLegacyBootstrap,
      // PHASE2 §23 — coverage cell은 DB에 있고 라이브로 센다. 파일 manifest 상태를
      // 더 이상 신뢰 근거로 쓰지 않는다(그 구조는 Vercel에서 durable하지 않았다).
      coverageCells: {
        evidenceType: 'LIVE' as EvidenceType,
        total: rentCoverageSummary.totalCells,
        byStatus: rentCoverageSummary.byStatus,
        latestVerifiedAt: rentCoverageSummary.latestVerifiedAt,
        note: 'COMPLETE/EMPTY_VALID만 verified로 인정한다(EMPTY_VALID = 신뢰할 수 있는 진짜 0건). PARTIAL/INVALID는 미검증이라 다음 실행에서 재시도된다.',
      },
      // §26 NO FAKE ACTIVATION — Cron이 실제로 등록/배포되지 않았으므로 절대 ACTIVE라고
      // 표시하지 않는다. sale의 scheduler 표시와 동일한 정직성 기준.
      scheduler: { value: 'OFF' as const, evidenceType: 'CONFIG' as EvidenceType, note: 'vercel.json crons 미등록 — 아직 활성화하지 않은 의도된 상태. coverage는 실제 apply sync가 있을 때만 전진한다(dry-run은 절대 전진시키지 않음).' },
      note: '취소(cancellation) 개념 없음 — MOLIT 전월세 API에 해당 필드가 존재하지 않는다(rent cancellation verified 같은 표현 금지).',
    },
    features: [
      { name: '84㎡ 국민평형', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: 'DB-FIRST 적용', evidenceType: 'CONFIG' as EvidenceType },
      { name: '거래량(매매)', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: 'DB-FIRST 적용', evidenceType: 'CONFIG' as EvidenceType },
      { name: '최근 상승', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: 'DB-FIRST 적용', evidenceType: 'CONFIG' as EvidenceType },
      { name: '최근 하락', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: 'DB-FIRST 적용', evidenceType: 'CONFIG' as EvidenceType },
      { name: '지역 변동지도', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: 'DB-FIRST 적용', evidenceType: 'CONFIG' as EvidenceType },
      { name: '2년최고가', source: 'TradeHistory DB', busan: 'DB-FIRST 적용', trust: '24개월 SAFE', evidenceType: 'SNAPSHOT' as EvidenceType },
    ],
    warnings: allReasons,
  };
}

export async function GET() {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const data = await getOrSetCache('admin-ops:summary-v1_2', CACHE_TTL_MS, buildSummary);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to build admin ops summary:', error);
    return NextResponse.json({ success: false, error: '운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
