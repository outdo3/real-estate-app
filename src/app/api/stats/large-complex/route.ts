import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { getOrSetCache } from '@/lib/server-cache';
import { fetchMonthsThrottledWithStatus, type MonthTask } from '@/lib/molit-stats-helpers';
import { dedupeByRegistryGroup } from '@/lib/large-complex-dedup';

// STATISTICS V2.1-4 — LARGE COMPLEX(대단지). §21 이번 V1은 BUSAN ONLY다 — ApartmentMaster가
// 부산 데이터만 갖고 있다(§14 실측: 3,402건 전량 sido='부산'). 서울/전국 선택 시 빈 화면을
// "0건"처럼 보여주지 않고 정직하게 UNSUPPORTED를 반환한다(§40).
export const dynamic = 'force-dynamic';

const BUSAN_SIDO_CODE = '26';
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const RECENT_TRADE_MONTHS = 3;

function monthsBack(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sidoCodeParam = searchParams.get('sidoCode') || BUSAN_SIDO_CODE;
  const lawdCdParam = searchParams.get('lawdCd');
  const dongParam = searchParams.get('dong');
  const minHouseholdsParam = parseInt(searchParams.get('minHouseholds') || '0', 10);
  const minHouseholds = Number.isFinite(minHouseholdsParam) && minHouseholdsParam > 0 ? minHouseholdsParam : 0;
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  // §21/§22 — 부산 외 시도는 데이터가 아예 없다(빈 결과를 "0건"처럼 보여주지 않음).
  if (sidoCodeParam !== BUSAN_SIDO_CODE) {
    return NextResponse.json({
      status: 'UNSUPPORTED',
      message: '대단지 순위는 현재 부산 지역부터 제공하고 있어요.',
      supportedSidoCode: BUSAN_SIDO_CODE,
      supportedSidoName: '부산광역시',
    });
  }

  try {
    const where: any = { sido: '부산', totalHouseholds: { not: null } };
    if (minHouseholds > 0) where.totalHouseholds = { gte: minHouseholds };
    if (lawdCdParam && /^\d{5}$/.test(lawdCdParam)) where.sggCd = lawdCdParam;
    if (dongParam && dongParam !== 'all') where.umdName = dongParam;

    // §41 — Busan 전체가 최대 3,402건인 소규모 데이터셋이라 서버 메모리에서 정렬/중복
    // 제거까지 끝낸 뒤 페이지 단위로만 클라이언트에 내려준다(원본 rows를 그대로 던지지
        // 않음).
    const rows = await prisma.apartmentMaster.findMany({
      where,
      orderBy: { totalHouseholds: 'desc' },
      select: {
        id: true,
        name: true,
        aptSeq: true,
        mgmBldrgstPk: true,
        sggCd: true,
        sigungu: true,
        umdName: true,
        totalHouseholds: true,
        buildYear: true,
        useApprovalDate: true,
        parkingPerHousehold: true,
        latitude: true,
        longitude: true,
      },
    });

    // §20/§26 — 같은 총괄표제부(mgmBldrgstPk)를 공유하는 row는 세대수가 복제 저장돼
    // 있어 대표 1건만 남긴다(dedupeByRegistryGroup, 이름을 새로 만들지 않음).
    const deduped = dedupeByRegistryGroup(rows).sort((a, b) => (b.totalHouseholds ?? 0) - (a.totalHouseholds ?? 0));

    const total = deduped.length;
    const pageRows = deduped.slice(offset, offset + limit).map((r, i) => ({ ...r, rank: offset + i + 1 }));

    // §29 — "최근 거래"는 aptSeq 기준 batch lookup만 허용(row별 fetch 금지). 현재
    // 페이지에 등장하는 구(sggCd)만 모아 최근 N개월 apt 거래를 한 번에 fetch한다.
    const distinctLawdCds = Array.from(new Set(pageRows.map((r) => r.sggCd).filter((v): v is string => !!v)));
    const now = new Date();
    const months = monthsBack(RECENT_TRADE_MONTHS, now);
    const recentTradeByAptSeq = new Map<string, { dealAmount: number; dealDate: string }>();

    // PERF — 구 단위로 개별 캐시한다(5분 TTL, 기존 stats 라우트 관례 재사용). 페이지가
    // 바뀌어도(같은 구가 다시 등장하면) MOLIT 재조회 없이 캐시를 공유한다.
    if (distinctLawdCds.length > 0) {
      const perDistrict = await Promise.all(
        distinctLawdCds.map((lawdCd) =>
          getOrSetCache(`stats-large-complex-recent:${lawdCd}:${months.join(',')}`, 5 * 60 * 1000, async () => {
            const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd, dealYmd: m, type: 'apt' as const }));
            const results = await fetchMonthsThrottledWithStatus(tasks);
            const byAptSeq = new Map<string, { dealAmount: number; dealDate: string }>();
            for (const m of months) {
              const items = results[m]?.items || [];
              for (const item of items) {
                if (!item || item.typeLabel === '에러' || item.dealCanceled || !(item.dealAmount > 0)) continue;
                const seq = item.aptSeq ? String(item.aptSeq) : null;
                if (!seq) continue;
                const existing = byAptSeq.get(seq);
                if (!existing || item.dealDate > existing.dealDate) {
                  byAptSeq.set(seq, { dealAmount: item.dealAmount, dealDate: item.dealDate });
                }
              }
            }
            return Array.from(byAptSeq.entries());
          })
        )
      );
      for (const entries of perDistrict) {
        for (const [seq, trade] of entries) recentTradeByAptSeq.set(seq, trade);
      }
    }

    const sigunguName = rows.find((r) => r.sggCd === lawdCdParam)?.sigungu || null;
    const scopeLabel = dongParam && dongParam !== 'all'
      ? `${sigunguName || ''} ${dongParam}`.trim()
      : lawdCdParam
        ? sigunguName || '해당 구'
        : '부산 전체';

    const items = pageRows.map((r) => {
      const recentTrade = r.aptSeq ? recentTradeByAptSeq.get(r.aptSeq) ?? null : null;
      // §28 — buildYear는 MOLIT 참고용 건축년도, useApprovalDate(건축물대장 사용승인일)가
      // 있으면 그게 더 정확한 "입주연도"에 가깝다(FIX_STATISTICS_DATA_TRUST 관례 재사용) —
      // 다만 두 값 다 "준공/사용승인" 시점이지 실제 최초 입주월 확정치는 아니므로 "입주연도"
      // 라는 단정적 표현 대신 코드 주석에는 출처를 남기고, 화면 문구는 "입주연도"로 통일
      // 하되(이미 다른 화면들이 buildYear를 "입주연도"로 표시해온 기존 관례, §28 지시의
      // "현재 field 의미에 맞는 정확한 wording"과 일치) 새 가공값을 만들지 않는다.
      const approvalYear = r.useApprovalDate && r.useApprovalDate.length >= 4 ? parseInt(r.useApprovalDate.slice(0, 4), 10) : null;
      const buildYear = approvalYear || r.buildYear || null;
      return {
        rank: r.rank,
        id: r.id,
        name: r.name,
        aptSeq: r.aptSeq,
        lawdCd: r.sggCd,
        sigungu: r.sigungu,
        dong: r.umdName,
        totalHouseholds: r.totalHouseholds,
        buildYear,
        parkingPerHousehold: r.parkingPerHousehold != null ? Math.round(r.parkingPerHousehold * 100) / 100 : null,
        latitude: r.latitude,
        longitude: r.longitude,
        recentTrade: recentTrade
          ? { dealAmount: recentTrade.dealAmount, dealDate: recentTrade.dealDate, priceLabel: formatKoreanPrice(String(recentTrade.dealAmount)) }
          : null,
      };
    });

    return NextResponse.json({
      status: 'OK',
      scope: { sidoCode: BUSAN_SIDO_CODE, sidoName: '부산광역시', lawdCd: lawdCdParam || null, dong: dongParam && dongParam !== 'all' ? dongParam : null, scopeLabel },
      minHouseholds,
      total,
      items,
      pagination: { offset, limit, total, hasMore: offset + limit < total },
      recentTradeWindowMonths: RECENT_TRADE_MONTHS,
    });
  } catch (error) {
    console.error('Failed to load large complex ranking:', error);
    return NextResponse.json({ status: 'ERROR', message: '대단지 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
