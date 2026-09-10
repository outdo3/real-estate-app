// REPORT-4 — 비교 리포트 **읽기 전용** 데이터 레이어.
//
// Compare V2의 fetch 레이어(fetch.ts)는 브라우저용이다 — 상대 경로 `/api/...`를 부르고
// 이름+lawdCd+dong으로 시작한다. 리포트는 서버에서 돌고 **canonical aptSeq로 시작**하므로
// 같은 것을 서버에서 재구성한다. 다만 **지표를 만드는 순수 빌더는 그대로 재사용**한다
// (selectPriceMetric / buildFactMetrics / buildLocationMetrics / buildScore / domainEvidence).
// 그래야 비교 화면과 리포트의 지표 정의가 갈라지지 않는다.
//
// 쓰기는 없다. SELECT만 한다.

import { prisma } from '@/lib/prisma';
import { formatKoreanPrice } from '@/lib/api-molit';
import {
  selectPriceMetric,
  buildFactMetrics,
  buildLocationMetrics,
  domainEvidence,
} from '@/lib/compare-v2/metrics';
import type { CompareApartment, ComparableIdentity } from '@/lib/compare-v2/types';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { getPeerContext } from '@/lib/apartment-score/peer-context';
import { buildCompareReport, type ApartmentCompareReportData, type CompareSideInfo } from './compare-report';
import { districtName } from './region-scope';
import type { ReportEnvelope, ReportPeriod } from './types';

const TRADE_MONTHS = 36; // Compare V2 fetch가 쓰는 period=36과 같은 창.

export class CompareReportError extends Error {
  constructor(
    public readonly code: 'MISSING_PARAM' | 'SAME_APARTMENT' | 'NOT_FOUND_A' | 'NOT_FOUND_B' | 'NOT_FOUND_BOTH',
    message: string
  ) {
    super(message);
  }
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === 'function') return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compare V2의 selectPriceMetric이 기대하는 RawTrade 모양으로 맞춘다.
 * 규칙은 /api/apt/[name] 라우트와 동일하다: price = dealAmount/10000(억), area는 ㎡ 문자열.
 */
function toCompareTrades(
  rows: { dealAmount: number; exclusiveArea: unknown; dealDate: Date | string; dealCanceled: boolean; buildYear: number | null }[]
) {
  return rows.map((r) => ({
    tradeDate: r.dealDate instanceof Date ? r.dealDate.toISOString().slice(0, 10) : String(r.dealDate).slice(0, 10),
    price: r.dealAmount / 10000,
    priceStr: formatKoreanPrice(r.dealAmount),
    area: String(toNumber(r.exclusiveArea)),
    buildYear: r.buildYear != null ? String(r.buildYear) : '',
    dealCanceled: r.dealCanceled,
  }));
}

interface SideLoad {
  side: CompareSideInfo;
  apt: CompareApartment;
  dataAsOf: string | null;
  coverageComplete: boolean;
}

/** 한 단지를 aptSeq로 읽어 Compare V2 계약에 맞춘다. 없으면 null. */
async function loadSide(aptSeq: string): Promise<SideLoad | null> {
  const master = await prisma.apartmentMaster.findUnique({
    where: { aptSeq },
    select: {
      aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true,
      buildYear: true, totalHouseholds: true, parkingCount: true,
    },
  });
  if (!master || !master.aptSeq) return null;

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - TRADE_MONTHS);

  const [trades, scoreResult, cells] = await Promise.all([
    prisma.apartmentTradeHistory.findMany({
      // 취소 제외는 쿼리에서도 건다(selectPriceMetric도 다시 거른다 — 이중 방어).
      where: { aptSeq, dealCanceled: false, dealDate: { gte: since } },
      select: { dealAmount: true, exclusiveArea: true, dealDate: true, dealCanceled: true, buildYear: true },
      orderBy: { dealDate: 'desc' },
    }),
    calculateApartmentScore(aptSeq).catch(() => null),
    master.sggCd
      ? prisma.syncCoverageCell.findMany({
          where: { dataset: 'SALE', lawdCd: master.sggCd },
          select: { status: true, verifiedAt: true },
          orderBy: { verifiedAt: 'desc' },
          take: 12,
        })
      : Promise.resolve([]),
  ]);

  // Score를 상세/비교 화면과 같은 경로로 조립한다(재계산 아님).
  let scoreJson: unknown = null;
  let side: Pick<CompareSideInfo, 'scoreState' | 'overallScore' | 'eligibility' | 'domains'> = {
    scoreState: 'no-result', overallScore: null, eligibility: null, domains: [],
  };
  if (scoreResult) {
    const shadowV2 = (scoreResult as unknown as { _shadowV2?: { eligibility?: string; overallScore?: number | null } })._shadowV2;
    let peerContext: Awaited<ReturnType<typeof getPeerContext>> | null = null;
    if (shadowV2 && shadowV2.eligibility !== 'NOT_ENOUGH_DATA' && shadowV2.overallScore != null) {
      peerContext = await getPeerContext({
        aptSeq,
        sigungu: master.sigungu,
        buildYear: master.buildYear,
        totalHouseholds: master.totalHouseholds,
        v2Score: Math.round(shadowV2.overallScore),
      }).catch(() => null);
    }
    scoreJson = { ...scoreResult, _shadowV2: shadowV2, peerContext };
  }

  // buildScore는 compare-v2의 것을 그대로 쓴다(리포트 전용 점수를 만들지 않는다).
  const { buildScore } = await import('@/lib/compare-v2/metrics');
  const compareScore = buildScore(scoreJson);
  side = {
    scoreState: compareScore.available ? 'ok' : 'not-enough-data',
    overallScore: compareScore.overallScore,
    eligibility: compareScore.eligibility,
    domains: compareScore.domains.map((d) => ({ key: d.key, label: d.label, score: d.score, coverage: d.coverage })),
  };

  const identity: ComparableIdentity = {
    kind: 'aptSeq',
    aptSeq: master.aptSeq,
    lawdCd: master.sggCd ?? '',
    dong: master.umdName ?? '',
    name: master.name,
  };

  const apt: CompareApartment = {
    identity,
    displayName: master.name,
    regionLabel: [districtName(master.sggCd) ?? master.sigungu, master.umdName].filter(Boolean).join(' ') || null,
    metrics: [
      selectPriceMetric(toCompareTrades(trades), false),
      ...buildFactMetrics(domainEvidence(scoreJson, 'complex')),
      ...buildLocationMetrics(
        domainEvidence(scoreJson, 'transport'),
        domainEvidence(scoreJson, 'education'),
        domainEvidence(scoreJson, 'living')
      ),
    ],
    score: compareScore,
    loadError: false,
  };

  return {
    side: {
      aptSeq: master.aptSeq,
      name: master.name,
      regionLabel: apt.regionLabel,
      buildYear: master.buildYear,
      totalHouseholds: master.totalHouseholds,
      parkingCount: master.parkingCount,
      ...side,
    },
    apt,
    dataAsOf: cells.length ? cells[0].verifiedAt.toISOString() : null,
    coverageComplete: cells.length >= 12 && cells.every((c) => c.status === 'COMPLETE' || c.status === 'EMPTY_VALID'),
  };
}

/**
 * 두 단지를 canonical aptSeq로 비교한다. **읽기 전용.**
 * 같은 단지/없는 단지는 조용히 대체하지 않고 명시적으로 실패한다(§1/§3).
 */
export async function readApartmentCompareReport(
  aptSeqA: string,
  aptSeqB: string,
  now: Date = new Date()
): Promise<ReportEnvelope<ApartmentCompareReportData>> {
  const a = aptSeqA?.trim();
  const b = aptSeqB?.trim();
  if (!a || !b) throw new CompareReportError('MISSING_PARAM', '비교할 단지 두 곳의 aptSeq가 모두 필요합니다.');
  // §1 — 같은 단지끼리 비교하지 않는다(의미도 없고, 전부 '비슷함'으로 보여 오해를 준다).
  if (a === b) throw new CompareReportError('SAME_APARTMENT', '같은 단지끼리는 비교할 수 없습니다.');

  const [loadA, loadB] = await Promise.all([loadSide(a), loadSide(b)]);
  if (!loadA && !loadB) throw new CompareReportError('NOT_FOUND_BOTH', `두 단지(${a}, ${b}) 모두 찾을 수 없습니다.`);
  // 한쪽만 없으면 **다른 단지로 대체하지 않고** 그 사실을 말한다.
  if (!loadA) throw new CompareReportError('NOT_FOUND_A', `첫 번째 단지(${a})를 찾을 수 없습니다.`);
  if (!loadB) throw new CompareReportError('NOT_FOUND_B', `두 번째 단지(${b})를 찾을 수 없습니다.`);

  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - TRADE_MONTHS);
  const period: ReportPeriod = {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: '최근 36개월 거래 기준',
  };

  return buildCompareReport({
    sides: [loadA.side, loadB.side],
    a: loadA.apt,
    b: loadB.apt,
    period,
    generatedAt: now.toISOString(),
    // 두 단지 중 더 오래된 검증 시각을 쓴다 — 더 최신인 쪽을 대표로 쓰면 실제보다 신선해 보인다.
    dataAsOf:
      loadA.dataAsOf && loadB.dataAsOf
        ? (loadA.dataAsOf < loadB.dataAsOf ? loadA.dataAsOf : loadB.dataAsOf)
        : (loadA.dataAsOf ?? loadB.dataAsOf),
    coverageComplete: loadA.coverageComplete && loadB.coverageComplete,
  });
}
