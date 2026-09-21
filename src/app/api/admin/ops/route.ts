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
import { getRentVerifiedRange, readLegacyBootstrap, summarizeCoverage, summarizeSaleRunKinds } from '@/lib/sync-coverage';
import { readCronRegistration } from '@/lib/cron-schedule';
import { SALE_RECHECK_MAX_MONTHS_BACK, SALE_RECHECK_MIN_MONTHS_BACK } from '@/lib/sync/shared';
import { getMolitLeafRegions } from '@/lib/region/registry';
import { logAdminFailure } from '@/lib/admin/log-admin-failure';
import { difference, isTotalDbOutage, isolate, unavailableLabels, valueOf, withBudget } from '@/lib/admin-ops-runner';

export const dynamic = 'force-dynamic';

// ADMIN_OPS_V1.1 §1 — 모든 핵심 값은 근거 종류(evidence)를 명시한다. 과거 검증
// 결과를 실시간 정상처럼, 코드 상 가정을 실제 Production 상태처럼, 확인 불가능한
// 것을 정상처럼 표현하지 않는다(§2 절대 원칙). 결정 로직(summarizeManifest/
// computeOverallHealth)은 src/lib/admin-ops-evidence.ts로 분리해 테스트한다 —
// 이 파일은 그 결과를 조립하는 I/O 오케스트레이션만 담당한다.

const CACHE_TTL_MS = 5 * 60 * 1000;
// §3/§4 — 취소 건수는 daily sync가 돌 때만 바뀜다. 요약 캐시보다 길게 잡아
// 콜드 인스턴스가 이 무거운 쿼리를 반복해서 치지 않게 한다.
const BUSAN_CANCELED_TTL_MS = 30 * 60 * 1000;
// 예산을 넘기면 그 칸만 "확인 불가" — 화면 전체를 무한정 기다리게 하지 않는다.
// 운영 실측 median 1.3~2.4s — 정상 범위는 다 통과하고 이상치만 잡는 값을 고른다.
const BUSAN_CANCELED_BUDGET_MS = 4000;

// REGION_REGISTRY_V1 §12 — canonical registry에서 파생(중복 하드코딩 제거).
const BUSAN_16: string[] = getMolitLeafRegions('26').map((r) => r.lawdCd);

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
  // ADMIN_DASHBOARD_TRUST_FIX_V1 §7 — 예전에는 시도마다 `await`을 걸어 **18회를 순차로**
  // 호출했다. 각 호출은 서로 독립적이므로 한 번에 보낸다(프록시 호출 수는 그대로다).
  // region-utils 쪽에 timeout이 걸려 있어 한 곳이 늦어도 전체가 매달리지 않는다.
  const lists = await Promise.all(sidoList.map((sido) => getSigunguListForSido(sido.code)));
  const syncTargets = lists.reduce((sum, list) => sum + list.length, 0);
  const sejong = sidoList.some((s) => s.code === '36');
  // 목록을 아예 못 받았으면 "시도 0개"를 사실처럼 내려보내지 않는다 — 조회 실패다.
  if (sidoList.length === 0) return null;
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
  // ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §1/§5/§6 — 예전에는 이 9개를 한 번의
  // `Promise.all`로 동시에 띄웠다. `connection_limit=1`에서는 9개가 t=0에 함께
  // connection을 요청해 pool_timeout 타이머 9개가 동시에 돌고, 줄 뒤쪽 쿼리는
  // 실행 시간이 30ms여도 대기 중 P2024로 죽는다. 재현 실측(limit=1, timeout=2s,
  // 동일 작업량): Promise.all 7/9 rejected ↔ 순차 0/9, latency는 6.0s 대 6.2s로 거의 같다.
  //
  // 그래서 **하나씩 await**하고, 각각을 isolate()로 감싸 한 지표의 실패가
  // 화면 전체 500으로 번지지 않게 한다. 이 순차성은 성능 희생이 아니라
  // 오히려 빠르다(실측: 병렬 2,331ms vs 순차 1,801ms). 테스트로 고정했다.
  const dbFailures: string[] = [];
  const noteDbFailure = (key: string, e: unknown) => {
    console.error(`[admin/ops] DB 지표 조회 실패: ${key}`, e);
    dbFailures.push(key);
    // §9 — 전체 실패(ADMIN_OPS_FAILURE)·region model 실패와 구분되는 category.
    logAdminFailure({ category: 'ADMIN_OPS_DB_SUMMARY_FAILURE', endpoint: '/api/admin/ops', error: e, metricKey: key });
  };
  const m = <T,>(key: string, run: () => Promise<T>) => isolate(key, run, noteDbFailure);

  const busanTotalM = await m('busanTotal', () => prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }));
  const aptSeqMissingM = await m('aptSeqMissing', () => prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, aptSeq: null } }));
  const latestDealM = await m('latestDealDate', () => prisma.apartmentTradeHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }));
  const busanCoveredM = await m('busanCovered', () => prisma.apartmentTradeHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }));
  const sejongTradeM = await m('sejongTradeCount', () => prisma.apartmentTradeHistory.count({ where: { lawdCd: '36110' } }));
  // DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §20 — Phase 1 감사에서 확인된 gap:
  // /admin/ops에 rent freshness가 전혀 노출되지 않았다. sale과 같은 라이브 확인
  // 방식(하드코딩 아님)으로 rent도 함께 노출한다.
  const rentBusanTotalM = await m('rentBusanTotal', () => prisma.apartmentRentHistory.count({ where: { lawdCd: { in: BUSAN_16 } } }));
  const rentBusanCoveredM = await m('rentBusanCovered', () => prisma.apartmentRentHistory.groupBy({ by: ['lawdCd'], where: { lawdCd: { in: BUSAN_16 } } }));
  const rentLatestDealM = await m('rentLatestDealDate', () => prisma.apartmentRentHistory.aggregate({ where: { lawdCd: { in: BUSAN_16 } }, _max: { dealDate: true } }));

  // §3-E/§10 — 이 블록에서 유일하게 진짜 무거운 지표. `deal_canceled`를 덮는 인덱스가
  // 없어 heap fetch가 필요하고 운영 실측이 1.2s~10s로 튀다(인덱스 추가는 schema 변경이라
  // 이번 범위 밖). 그래서 **맨 뒤에** 두어 앞의 지표들이 이것을 기다리지 않게 하고,
  // 따로 긴 TTL로 캐시하며(하루 한 번 sync로만 변하는 값이다), 예산을 넘기면 그 칸만
  // "확인 불가"로 내린다. 단, race로 응답을 먼저 보내도 원래 쿼리는 계속 돌아 캐시를
  // 채우므로 **다음 요청은 진짜 숫자를 본다** — 지어낸 값을 내보내지 않는다.
  const busanCanceledM = await m(
    'busanCanceled',
    withBudget(
      () =>
        getOrSetCache('admin-ops:busan-canceled', BUSAN_CANCELED_TTL_MS, () =>
          prisma.apartmentTradeHistory.count({ where: { lawdCd: { in: BUSAN_16 }, dealCanceled: true } })
        ),
      BUSAN_CANCELED_BUDGET_MS
    )
  );

  // §5 — 지표가 **전부** 실패했다면 개별 쿼리 문제가 아니라 DB 연결 자체가 죽은 것이다.
  // 그 경우에만 전체 실패로 올린다(부분 실패를 전체 실패로 키우지 않는다).
  const dbMetrics = [busanTotalM, busanCanceledM, aptSeqMissingM, latestDealM, busanCoveredM, sejongTradeM, rentBusanTotalM, rentBusanCoveredM, rentLatestDealM];
  if (isTotalDbOutage(dbMetrics)) {
    throw new Error('DB 지표를 하나도 읽지 못했다(연결 자체 실패로 판단)');
  }

  const busanTotal = valueOf(busanTotalM);
  const busanCanceled = valueOf(busanCanceledM);
  const busanActive = difference(busanTotalM, busanCanceledM);
  const aptSeqMissing = valueOf(aptSeqMissingM);
  const latestDealAgg = valueOf(latestDealM);
  const sejongTradeCount = valueOf(sejongTradeM);
  const rentBusanTotal = valueOf(rentBusanTotalM);
  const rentLatestDealAgg = valueOf(rentLatestDealM);

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

  // §6 — region model은 이 요약에서 **유일하게 외부 서비스**에 의존하는 조각이다.
  // 여기가 실패해도 DB/cron/manifest 기반 섹션은 전부 멀쩡하므로, 예전처럼 화면 전체를
  // 죽이지 않고 이 조각만 "확인 불가"로 떨어뜨린다.
  const degradedSources: string[] = [];
  const regionModel = await buildNationwideRegionModel().catch((e) => {
    console.error('[admin/ops] region model 조회 실패', e);
    // ADMIN_ERROR_LOGGING_P1_V1 §4 — 전체 실패와 **조각 하나 실패**를 로그에서 구분한다.
    // 화면은 부분 실패로 계속 뜨지만(TRUST_FIX_V1 §6), 왜 비었는지는 추적 가능해야 한다.
    logAdminFailure({ category: 'ADMIN_OPS_REGION_MODEL_FAILURE', endpoint: '/api/admin/ops', error: e });
    return null;
  });
  if (!regionModel) {
    degradedSources.push('전국 region model(법정동코드 프록시)');
  }

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
    sejongInRegionModel: regionModel ? regionModel.sejongInRegionModel : null,
  });
  const allReasons = [...health.criticalReasons, ...health.warningReasons];

  const busanCoveredCount = busanCoveredM.status === 'OK' ? busanCoveredM.value.length : null;
  const rentBusanCoveredCount = rentBusanCoveredM.status === 'OK' ? rentBusanCoveredM.value.length : null;

  // PHASE2 §23 — coverage는 파일이 아니라 DB에서 라이브로 읽는다. legacyBootstrap은
  // 정적 provenance라 여전히 파일 기준이다.
  //
  // §6 — 위 블록과 같은 이유로 이 4개도 동시에 띄우지 않는다. sync_coverage_cells는
  // 수천 행이라 가볍지만, pool=1에서 중요한 것은 "가볍다"가 아니라 "줄을 늘리지 않는다"이다.
  const rentVerifiedRangeM = await m('rentVerifiedRange', () => getRentVerifiedRange());
  const rentCoverageM = await m('rentCoverageCells', () => summarizeCoverage('RENT'));
  const saleCoverageM = await m('saleCoverageCells', () => summarizeCoverage('SALE'));
  // SALE_CANCELLATION_COVERAGE_V1 §9 — daily sync와 recheck sweep을 같은 칸에 섬지 않는다.
  const saleRunKindsM = await m('saleRunKinds', () => summarizeSaleRunKinds());

  const rentVerifiedRange = valueOf(rentVerifiedRangeM);
  const rentCoverageSummary = valueOf(rentCoverageM);
  const saleCoverageSummary = valueOf(saleCoverageM);
  const saleRunKinds = valueOf(saleRunKindsM);

  // §8 — 무엇을 확인하지 못했는지를 숨기지 않는다. 화면은 이 목록을 그대로 배너에 쓴다.
  degradedSources.push(
    ...unavailableLabels([
      { label: '부산 전체 row', metric: busanTotalM },
      { label: '취소 거래 수', metric: busanCanceledM },
      { label: 'aptSeq 없는 row', metric: aptSeqMissingM },
      { label: '최근 거래일', metric: latestDealM },
      { label: '부산 구·군 coverage', metric: busanCoveredM },
      { label: '세종 적재 여부', metric: sejongTradeM },
      { label: '전월세 row', metric: rentBusanTotalM },
      { label: '전월세 구·군 coverage', metric: rentBusanCoveredM },
      { label: '전월세 최신 거래일', metric: rentLatestDealM },
      { label: '전월세 검증범위', metric: rentVerifiedRangeM },
      { label: '전월세 coverage cell', metric: rentCoverageM },
      { label: '매매 coverage cell', metric: saleCoverageM },
      { label: 'sync 실행 이력', metric: saleRunKindsM },
    ])
  );
  const rentLegacyBootstrap = readLegacyBootstrap();
  // CRON ACTIVATION §8 — scheduler 상태를 코드에 하드코딩하지 않고 배포된 vercel.json에서
  // 실제 등록 여부를 읽는다. 등록(SCHEDULED)과 "무인 실행 성공"은 분리해서 표시한다.
  const saleCron = readCronRegistration('/api/cron/sale-sync');
  const rentCron = readCronRegistration('/api/cron/rent-sync');
  const saleRecheckCron = readCronRegistration('/api/cron/sale-recheck');

  return {
    overall: {
      status: OVERALL_STATUS_LABELS[health.statusCode],
      statusCode: health.statusCode,
      subtitle: '현재 확인 가능한 운영 지표 기준',
      warningsCount: allReasons.length,
      lastCheckedAt: nowIso,
      // ADMIN_DASHBOARD_TRUST_FIX_V1 §6 — 일부 조각만 못 읽었을 때, 화면 전체를 실패로
      // 만들지 않는 대신 **무엇을 못 읽었는지**는 숨기지 않는다.
      degradedSources,
    },
    tradeHistory: {
      evidenceType: 'LIVE' as EvidenceType,
      checkedAt: nowIso,
      busanTotal,
      busanActive,
      busanCanceled,
      latestDealDate: latestDealAgg?._max.dealDate ? latestDealAgg._max.dealDate.toISOString().slice(0, 10) : null,
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
      nationwide: { sido: regionModel?.sidoCount ?? null, syncTargets: regionModel?.syncTargets ?? null },
      sejong: {
        regionModel: regionModel ? (regionModel.sejongInRegionModel ? '정상' : '확인 필요') : '확인 불가',
        tradeDbCoverage: sejongTradeCount === null ? '확인 불가' : sejongTradeCount > 0 ? `적재됨(${sejongTradeCount}건)` : '미수집',
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
        total: saleCoverageSummary?.totalCells ?? null,
        byStatus: saleCoverageSummary?.byStatus ?? null,
        latestVerifiedAt: saleCoverageSummary?.latestVerifiedAt ?? null,
      },
      scheduler: {
        value: saleCron.state,
        evidenceType: 'CONFIG' as EvidenceType,
        scheduleUtc: saleCron.scheduleUtc,
        scheduleKst: saleCron.scheduleKst,
        note:
          saleCron.state === 'SCHEDULED'
            ? `vercel.json에 cron 등록됨(${saleCron.scheduleUtc} UTC = ${saleCron.scheduleKst ?? '해석 불가'}). 등록된 상태일 뿐, 무인 실행 성공을 뜻하지 않는다 — 마지막 실행은 아래 값으로 확인한다.`
            : saleCron.state === 'OFF'
              ? 'vercel.json crons 미등록 — 아직 활성화하지 않은 의도된 상태'
              : 'vercel.json을 읽을 수 없어 등록 여부를 확인하지 못했다(정상으로 단정하지 않음)',
      },
      lastRun: {
        evidenceType: 'LIVE' as EvidenceType,
        // §9 — recheck sweep 실행은 제외한다. 섞으면 daily sync가 멈춰도 정상처럼 보인다.
        runId: saleRunKinds?.daily.runId ?? null,
        at: saleRunKinds?.daily.at ?? null,
        note: 'daily sale-sync가 coverage를 마지막으로 기록한 실행(recheck sweep 제외). 이 값이 갱신되지 않으면 예약된 실행이 실제로 적용되지 않은 것이다.',
      },
      nextScheduledSync: { value: saleCron.scheduleKst, evidenceType: 'CONFIG' as EvidenceType },
      // SALE_CANCELLATION_COVERAGE_V1 §9 — daily overlap(3개월) 바깥의 late cancellation을
      // 훑는 별도 sweep. daily sync와 완전히 분리해서 표시한다.
      recheckSweep: {
        evidenceType: 'LIVE' as EvidenceType,
        scheduler: {
          value: saleRecheckCron.state,
          evidenceType: 'CONFIG' as EvidenceType,
          scheduleUtc: saleRecheckCron.scheduleUtc,
          scheduleKst: saleRecheckCron.scheduleKst,
        },
        bandMonthsBack: { from: SALE_RECHECK_MAX_MONTHS_BACK, to: SALE_RECHECK_MIN_MONTHS_BACK },
        lastRunId: saleRunKinds?.recheck.runId ?? null,
        lastRunAt: saleRunKinds?.recheck.at ?? null,
        cellsCoveredBySweep: saleRunKinds?.recheck.cells ?? null,
        note: `취소 지연 실측 p99 11.8개월. daily overlap 3개월이 못 덮는 ${SALE_RECHECK_MIN_MONTHS_BACK}~${SALE_RECHECK_MAX_MONTHS_BACK}개월 구간을 예산이 허용하는 만큼 "가장 오래 확인 안 된 셀부터" 매일 훑는다. 한 번에 band 전체를 돌지 않는 것이 정상이다.`,
      },
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
      latestDealDate: rentLatestDealAgg?._max.dealDate ? rentLatestDealAgg._max.dealDate.toISOString().slice(0, 10) : null,
      verified: rentVerifiedRange,
      legacyBootstrap: rentLegacyBootstrap,
      // PHASE2 §23 — coverage cell은 DB에 있고 라이브로 센다. 파일 manifest 상태를
      // 더 이상 신뢰 근거로 쓰지 않는다(그 구조는 Vercel에서 durable하지 않았다).
      coverageCells: {
        evidenceType: 'LIVE' as EvidenceType,
        total: rentCoverageSummary?.totalCells ?? null,
        byStatus: rentCoverageSummary?.byStatus ?? null,
        latestVerifiedAt: rentCoverageSummary?.latestVerifiedAt ?? null,
        note: 'COMPLETE/EMPTY_VALID만 verified로 인정한다(EMPTY_VALID = 신뢰할 수 있는 진짜 0건). PARTIAL/INVALID는 미검증이라 다음 실행에서 재시도된다.',
      },
      // §26 NO FAKE ACTIVATION — Cron이 실제로 등록/배포되지 않았으므로 절대 ACTIVE라고
      // 표시하지 않는다. sale의 scheduler 표시와 동일한 정직성 기준.
      scheduler: {
        value: rentCron.state,
        evidenceType: 'CONFIG' as EvidenceType,
        scheduleUtc: rentCron.scheduleUtc,
        scheduleKst: rentCron.scheduleKst,
        note:
          rentCron.state === 'SCHEDULED'
            ? `vercel.json에 cron 등록됨(${rentCron.scheduleUtc} UTC = ${rentCron.scheduleKst ?? '해석 불가'}). coverage는 실제 apply sync가 있을 때만 전진한다(dry-run은 절대 전진시키지 않음). 등록 != 무인 실행 성공.`
            : rentCron.state === 'OFF'
              ? 'vercel.json crons 미등록 — 아직 활성화하지 않은 의도된 상태. coverage는 실제 apply sync가 있을 때만 전진한다.'
              : 'vercel.json을 읽을 수 없어 등록 여부를 확인하지 못했다(정상으로 단정하지 않음)',
      },
      lastRun: {
        evidenceType: 'LIVE' as EvidenceType,
        runId: rentCoverageSummary?.latestRunId ?? null,
        at: rentCoverageSummary?.latestVerifiedAt ?? null,
        note: 'coverage를 마지막으로 기록한 실행.',
      },
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

/**
 * ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §3-C — 마지막으로 성공한 요약.
 *
 * TTL이 끝난 뒤 재조회가 실패하면 예전에는 화면이 통째로 죽었다. 그럴 때
 * **직전에 실제로 확인했던 값**을 그대로 보여주되, 언제 것인지를 명시한다.
 * 지어낸 숫자가 아니라 과거의 사실이므로, 신선도를 숨기지 않는 한 정직하다.
 * 캐시 TTL과 달리 만료가 없다 — 장애가 길어져도 보여줄 것이 있어야 하기 때문이다.
 */
let lastKnownGood: { data: Awaited<ReturnType<typeof buildSummary>>; at: string } | null = null;

export async function GET() {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  const startedAt = Date.now();
  try {
    const data = await getOrSetCache('admin-ops:summary-v1_2', CACHE_TTL_MS, buildSummary);
    lastKnownGood = { data, at: new Date().toISOString() };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to build admin ops summary:', error);
    // §2 — 운영자가 실제로 자주 보는 실패. 부분 실패(위)와 다른 category로 남긴다.
    logAdminFailure({
      category: 'ADMIN_OPS_FAILURE',
      endpoint: '/api/admin/ops',
      error,
      latencyMs: Date.now() - startedAt,
    });

    // §3-C — 이번 재조회는 실패했지만 직전에 확인한 값이 있으면 빈 화면보다 낫다.
    // 200으로 내리되 stale임을 화면이 숨길 수 없게 표시한다.
    if (lastKnownGood) {
      return NextResponse.json({
        success: true,
        data: {
          ...lastKnownGood.data,
          overall: {
            ...lastKnownGood.data.overall,
            degradedSources: [
              ...lastKnownGood.data.overall.degradedSources,
              `지금 재조회에 실패해 ${new Date(lastKnownGood.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 기준 값을 보여주고 있습니다`,
            ],
          },
          stale: { isStale: true, capturedAt: lastKnownGood.at },
        },
      });
    }

    return NextResponse.json({ success: false, error: '운영 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
