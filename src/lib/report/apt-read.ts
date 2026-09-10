// REPORT-3 — 단지 리포트 **읽기 전용** 데이터 레이어.
//
// 이 파일만 Prisma/Score 엔진을 만진다. 템플릿은 envelope만 읽는다.
//
// Score는 **다시 만들지 않는다**(§6). /api/apt/[name]/score 라우트가 하는 조립을
// 그대로 따라간다 — 다른 점은 단 하나, 이름→aptSeq 해석 단계가 없다는 것이다.
// 우리는 이미 canonical aptSeq를 갖고 시작하므로 그 라우트가 겪는 AMBIGUOUS/
// NOT_FOUND 이름 매칭 위험 자체가 없다(§1).
//
// 화면 표시 규칙도 상세 화면과 **같은 순수 함수**(score-card-presenter)를 쓴다.
// 여기서 다시 판단하면 리포트와 상세 화면의 점수가 갈라진다.

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { resolveDisplayedScoreVersion } from '@/lib/apartment-score/resolve-score-version';
import { getPeerContext } from '@/lib/apartment-score/peer-context';
import { deriveScoreCardState, derivePeerVerdict } from '@/components/score-card-presenter';
import { buildScore } from '@/lib/compare-v2/metrics';
import type { TradeRow } from './region-aggregate';
import { buildApartmentReport, type AptReportInput, type AptScoreView, type ApartmentReportData } from './apt-report';
import type { ReportEnvelope, ReportPeriod } from './types';

/** 12개월 창 + 2년 창. 리포트 기간 라벨은 12개월 기준이다. */
const TRADE_WINDOW_MONTHS = 12;
const TWO_YEAR_DAYS = 729;
const TWO_YEAR_TOP_CANDIDATES = 5;
const RECENT_TRADE_TAKE = 5;

export class AptReportNotFound extends Error {
  constructor(public readonly aptSeq: string) {
    super(`APT_REPORT_NOT_FOUND: ${aptSeq}`);
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

interface RawTrade {
  aptSeq: string | null;
  lawdCd: string;
  dong: string;
  aptName: string;
  exclusiveArea: unknown;
  dealAmount: number;
  dealDate: Date | string;
  dealCanceled: boolean;
  floor: number | null;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === 'function') return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapRows(rows: RawTrade[]): TradeRow[] {
  return rows.map((r) => ({
    aptSeq: r.aptSeq,
    lawdCd: r.lawdCd,
    dong: r.dong,
    aptName: r.aptName,
    exclusiveArea: toNumber(r.exclusiveArea),
    dealAmount: r.dealAmount,
    dealDate: r.dealDate instanceof Date ? r.dealDate.toISOString().slice(0, 10) : String(r.dealDate).slice(0, 10),
    dealCanceled: r.dealCanceled,
    floor: r.floor,
  }));
}

const TRADE_SELECT = {
  aptSeq: true, lawdCd: true, dong: true, aptName: true,
  exclusiveArea: true, dealAmount: true, dealDate: true, dealCanceled: true, floor: true,
} as const;

/**
 * Score를 상세 화면과 **동일한 경로**로 계산해 표시용 view로 만든다.
 * 실패해도 리포트 전체를 죽이지 않는다 — 점수만 '준비 중'이 된다(§43과 같은 태도).
 */
export async function readScore(aptSeq: string): Promise<AptScoreView> {
  const empty: AptScoreView = {
    state: 'no-result', overallScore: null, scoreVersion: null, eligibility: null,
    domains: [], peerVerdict: { kind: 'unavailable' }, briefing: null,
  };
  try {
    const result = await calculateApartmentScore(aptSeq);
    const shadowV2 = (result as unknown as { _shadowV2?: unknown })._shadowV2;

    // 라우트와 같은 조건에서만 peer context를 계산한다.
    let peerContext: Awaited<ReturnType<typeof getPeerContext>> | null = null;
    const v2 = shadowV2 as { eligibility?: string; overallScore?: number | null } | undefined;
    if (v2 && v2.eligibility !== 'NOT_ENOUGH_DATA' && v2.overallScore != null) {
      const target = await prisma.apartmentMaster.findUnique({
        where: { aptSeq },
        select: { sigungu: true, buildYear: true, totalHouseholds: true },
      });
      if (target) {
        peerContext = await getPeerContext({
          aptSeq,
          sigungu: target.sigungu,
          buildYear: target.buildYear,
          totalHouseholds: target.totalHouseholds,
          v2Score: Math.round(v2.overallScore),
        });
      }
    }

    // 라우트 응답과 같은 모양으로 만든 뒤, 상세 화면과 같은 표시 규칙을 적용한다.
    const scoreJson = { ...result, _shadowV2: shadowV2, peerContext };
    const state = deriveScoreCardState(scoreJson as { _shadowV2?: unknown });
    const compare = buildScore(scoreJson);
    const verdict = derivePeerVerdict(
      peerContext ? { available: !!peerContext.available, confidence: String(peerContext.confidence), percentile: peerContext.percentile ?? null } : null
    );

    return {
      state: state.kind,
      overallScore: compare.overallScore,
      scoreVersion: resolveDisplayedScoreVersion(
        (shadowV2 as { scoreVersion?: string } | undefined)?.scoreVersion,
        result.scoreVersion
      ),
      eligibility: compare.eligibility ?? null,
      domains: compare.domains.map((d) => ({ key: d.key, label: d.label, score: d.score, coverage: d.coverage })),
      peerVerdict:
        verdict.kind === 'exact'
          ? { kind: 'exact', topPercent: verdict.topPercent }
          : verdict.kind === 'unavailable'
            ? { kind: 'unavailable' }
            : verdict.kind === 'broad'
              ? { kind: 'broad' }
              : { kind: 'directional' },
      briefing: result.briefing
        ? { summary: result.briefing.summary, strengths: result.briefing.strengths ?? [], caution: result.briefing.caution ?? null }
        : null,
    };
  } catch {
    // 점수 계산 실패를 사용자 오류로 만들지 않는다. 리포트의 나머지는 그대로 쓸 수 있다.
    return empty;
  }
}

/**
 * aptSeq로 단지 리포트를 읽는다. **읽기 전용.**
 * 없는 aptSeq면 다른 단지로 폴백하지 않고 AptReportNotFound를 던진다(§1).
 */
export async function readApartmentReport(aptSeq: string, now: Date = new Date()): Promise<ReportEnvelope<ApartmentReportData>> {
  const master = await prisma.apartmentMaster.findUnique({
    where: { aptSeq },
    select: {
      aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true,
      roadAddress: true, jibunAddress: true, buildYear: true,
      totalHouseholds: true, parkingCount: true, parkingPerHousehold: true,
    },
  });
  if (!master || !master.aptSeq) throw new AptReportNotFound(aptSeq);

  const end = shiftDays(now, -1); // 어제까지(수집 cron이 19:00 UTC라 오늘은 비어 보일 수 있다)
  const start12m = new Date(end);
  start12m.setUTCMonth(start12m.getUTCMonth() - TRADE_WINDOW_MONTHS);
  const start2y = shiftDays(end, -TWO_YEAR_DAYS);

  // 취소 제외는 쿼리에서도 건다(순수 레이어와 이중 방어).
  const baseWhere = { aptSeq, dealCanceled: false } as const;

  const [trades12m, twoYearTop, recentRows, location, market, cells] = await Promise.all([
    prisma.apartmentTradeHistory.findMany({
      where: { ...baseWhere, dealDate: { gte: start12m, lte: end } },
      select: TRADE_SELECT,
    }),
    prisma.apartmentTradeHistory.findMany({
      where: { ...baseWhere, dealDate: { gte: start2y, lte: end } },
      select: TRADE_SELECT,
      orderBy: [{ dealAmount: 'desc' }, { dealDate: 'desc' }],
      take: TWO_YEAR_TOP_CANDIDATES,
    }),
    prisma.apartmentTradeHistory.findMany({
      where: baseWhere,
      select: TRADE_SELECT,
      orderBy: [{ dealDate: 'desc' }, { dealAmount: 'desc' }],
      take: RECENT_TRADE_TAKE,
    }),
    prisma.apartmentLocationFeature.findUnique({
      where: { aptSeq },
      select: {
        nearestSubwayName: true, nearestSubwayDistanceM: true, nearestElementaryDistanceM: true,
        convenienceCount500m: true, martCount1000m: true, parkCount1000m: true,
        qualityFlag: true, fetchedAt: true,
      },
    }),
    prisma.apartmentMarketFeature.findUnique({
      where: { aptSeq },
      select: { medianPricePerM2_12m: true, transactionCount12m: true, priceChange12m: true, fetchedAt: true },
    }),
    master.sggCd
      ? prisma.syncCoverageCell.findMany({
          where: { dataset: 'SALE', lawdCd: master.sggCd },
          select: { status: true, verifiedAt: true },
          orderBy: { verifiedAt: 'desc' },
          take: 12,
        })
      : Promise.resolve([]),
  ]);

  const score = await readScore(aptSeq);

  const dataAsOf = cells.length ? cells[0].verifiedAt.toISOString() : null;
  // 최근 12개월 셀이 모두 COMPLETE일 때만 완전하다고 말한다(없으면 검증 중).
  const coverageComplete = cells.length >= TRADE_WINDOW_MONTHS
    && cells.every((c) => c.status === 'COMPLETE' || c.status === 'EMPTY_VALID');

  const period: ReportPeriod = { start: ymd(start12m), end: ymd(end), label: '최근 12개월' };

  const input: AptReportInput = {
    master: {
      aptSeq: master.aptSeq,
      name: master.name,
      sigungu: master.sigungu,
      umdName: master.umdName,
      roadAddress: master.roadAddress,
      jibunAddress: master.jibunAddress,
      buildYear: master.buildYear,
      totalHouseholds: master.totalHouseholds,
      parkingCount: master.parkingCount,
      parkingPerHousehold: master.parkingPerHousehold,
      sggCd: master.sggCd,
    },
    trades12m: mapRows(trades12m as RawTrade[]),
    twoYearTopCandidates: mapRows(twoYearTop as RawTrade[]),
    recentTradeRows: mapRows(recentRows as RawTrade[]),
    score,
    location: location
      ? {
          nearestSubwayName: location.nearestSubwayName,
          nearestSubwayDistanceM: location.nearestSubwayDistanceM,
          nearestElementaryDistanceM: location.nearestElementaryDistanceM,
          convenienceCount500m: location.convenienceCount500m,
          martCount1000m: location.martCount1000m,
          parkCount1000m: location.parkCount1000m,
          qualityFlag: location.qualityFlag ?? null,
          fetchedAt: location.fetchedAt ? location.fetchedAt.toISOString() : null,
        }
      : null,
    market: market
      ? {
          medianPricePerM2_12m: market.medianPricePerM2_12m,
          transactionCount12m: market.transactionCount12m,
          priceChange12m: market.priceChange12m,
          fetchedAt: market.fetchedAt ? market.fetchedAt.toISOString() : null,
        }
      : null,
    period,
    generatedAt: now.toISOString(),
    dataAsOf,
    coverageComplete,
  };

  return buildApartmentReport(input);
}
