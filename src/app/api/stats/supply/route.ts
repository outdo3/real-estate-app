import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sidoFullToShort, parsePresaleSigungu, currentYm, isFutureOrCurrentYm, addMonthsToYm } from '@/lib/presale-region';

// STATISTICS V2.1-4 — SUPPLY(공급). 입주지도 + 공급추이를 한 번의 fetch로 함께 계산한다
// (§14/§41 — Presale 총 1,046건은 큰 데이터가 아니라 매 요청마다 새로 fetch해도 무리가
// 없고, 지도/리스트/추이가 전부 같은 필터링된 집합에서 나와야 숫자가 서로 어긋나지
// 않는다). moveInExpectedYm이 과거인 row는 항상 제외한다(§12 — 향후 공급에 과거 포함 금지).
export const dynamic = 'force-dynamic';

type PeriodPreset = 'y1' | 'y2' | 'y3' | 'all';
const VALID_PERIODS: PeriodPreset[] = ['y1', 'y2', 'y3', 'all'];
const PERIOD_MONTHS: Record<Exclude<PeriodPreset, 'all'>, number> = { y1: 12, y2: 24, y3: 36 };

// §9 — 세대수 규모 구간(임의 cut-off, 문서화됨): 소규모 <300 / 중간 300~999 / 대규모 1000+.
function householdScale(households: number | null): 'small' | 'medium' | 'large' | 'unknown' {
  if (households == null) return 'unknown';
  if (households < 300) return 'small';
  if (households < 1000) return 'medium';
  return 'large';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sidoFull = searchParams.get('sido'); // 예: "부산광역시" — 없으면 전국
  const sigunguShort = searchParams.get('sigungu'); // 예: "서구" — sido 있을 때만 의미 있음
  const presetParam = searchParams.get('period') || 'y2';
  const preset: PeriodPreset = (VALID_PERIODS as string[]).includes(presetParam) ? (presetParam as PeriodPreset) : 'y2';
  const sortParam = searchParams.get('sort') === 'household' ? 'household' : 'moveIn';

  try {
    const sidoShort = sidoFull ? sidoFullToShort(sidoFull) : null;
    // §5 — sido가 주어졌는데 17개 고정 목록에 없는 값이면(오타/미지원) 안전하게 빈 스코프로
        // 처리한다(다른 지역으로 fallback하지 않음).
    if (sidoFull && !sidoShort) {
      return NextResponse.json({ status: 'OK', scope: { sido: sidoFull, sigungu: null, nationwide: false }, period: { preset }, summary: { totalCount: 0, mapCount: 0 }, mapMarkers: [], list: [], trend: [], interpretation: [] });
    }

    const rows = await prisma.presale.findMany({
      where: sidoShort ? { subscriptionAreaName: sidoShort } : undefined,
      select: {
        id: true,
        houseName: true,
        locationAddress: true,
        subscriptionAreaName: true,
        moveInExpectedYm: true,
        totalSupplyHouseholds: true,
        latitude: true,
        longitude: true,
        pblancUrl: true,
      },
    });

    const nowYm = currentYm();
    const upperBoundYm = preset === 'all' ? null : addMonthsToYm(nowYm, PERIOD_MONTHS[preset]);

    let scoped = rows.filter((r) => isFutureOrCurrentYm(r.moveInExpectedYm, nowYm));
    if (upperBoundYm) scoped = scoped.filter((r) => (r.moveInExpectedYm as string) <= upperBoundYm);

    // §6 — 동 단위는 안전하지 않아 미지원. 시군구까지만.
    if (sidoFull && sigunguShort) {
      scoped = scoped.filter((r) => parsePresaleSigungu(r.locationAddress, sidoFull) === sigunguShort);
    }

    const totalCount = scoped.length;
    const withCoords = scoped.filter((r) => r.latitude != null && r.longitude != null);
    const mapCount = withCoords.length;

    const mapMarkers = withCoords.map((r) => ({
      id: r.id,
      name: r.houseName,
      moveInExpectedYm: r.moveInExpectedYm,
      totalSupplyHouseholds: r.totalSupplyHouseholds,
      lat: r.latitude,
      lng: r.longitude,
      scale: householdScale(r.totalSupplyHouseholds),
      locationAddress: r.locationAddress,
    }));

    const listSorted = [...scoped].sort((a, b) => {
      if (sortParam === 'household') return (b.totalSupplyHouseholds ?? 0) - (a.totalSupplyHouseholds ?? 0);
      return (a.moveInExpectedYm ?? '').localeCompare(b.moveInExpectedYm ?? '');
    });
    const list = listSorted.map((r) => ({
      id: r.id,
      name: r.houseName,
      moveInExpectedYm: r.moveInExpectedYm,
      totalSupplyHouseholds: r.totalSupplyHouseholds,
      hasCoords: r.latitude != null && r.longitude != null,
      locationAddress: r.locationAddress,
      pblancUrl: r.pblancUrl,
    }));

    // §14/§15 — 연도별 집계(월별 대신 연도 단위로 단순화, 문서화됨). 프로젝트 수와
    // 세대수를 함께 보여준다(혼동 금지).
    const byYear = new Map<string, { projectCount: number; householdSum: number }>();
    for (const r of scoped) {
      if (!r.moveInExpectedYm) continue;
      const year = r.moveInExpectedYm.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, { projectCount: 0, householdSum: 0 });
      const bucket = byYear.get(year)!;
      bucket.projectCount += 1;
      bucket.householdSum += r.totalSupplyHouseholds ?? 0;
    }
    const trend = Array.from(byYear.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, v]) => ({ year, projectCount: v.projectCount, householdSum: v.householdSum }));

    // §16 — deterministic 문구만(LLM 없음, "공급폭탄"/가격전망류 절대 금지).
    const interpretation: string[] = [];
    const thisYear = nowYm.slice(0, 4);
    const nextYear = String(parseInt(thisYear, 10) + 1);
    const thisYearBucket = trend.find((t) => t.year === thisYear);
    const nextYearBucket = trend.find((t) => t.year === nextYear);
    if (thisYearBucket && nextYearBucket) {
      if (nextYearBucket.householdSum > thisYearBucket.householdSum) {
        interpretation.push(`내년(${nextYear}년) 입주예정 물량이 올해(${thisYear}년)보다 많아요.`);
      } else if (nextYearBucket.householdSum < thisYearBucket.householdSum) {
        interpretation.push(`내년(${nextYear}년) 입주예정 물량이 올해(${thisYear}년)보다 적어요.`);
      }
    }
    if (trend.length > 0) {
      const maxYear = [...trend].sort((a, b) => b.householdSum - a.householdSum)[0];
      if (maxYear.householdSum > 0) {
        interpretation.push(`조회 기간 중 ${maxYear.year}년 입주물량이 가장 많아요(${maxYear.projectCount}개 단지 · ${maxYear.householdSum.toLocaleString('ko-KR')}세대).`);
      }
    }

    return NextResponse.json({
      status: 'OK',
      scope: { sido: sidoFull, sigungu: sidoFull && sigunguShort ? sigunguShort : null, nationwide: !sidoFull },
      period: { preset, from: nowYm, to: upperBoundYm },
      summary: { totalCount, mapCount },
      mapMarkers,
      list,
      trend,
      interpretation,
      sort: sortParam,
      source: '청약홈(한국부동산원 청약Home) 공고 기준 입주예정월 — 사업 주체가 공고 시점에 발표한 예정일이며 확정 준공일이 아닙니다.',
    });
  } catch (error) {
    console.error('Failed to load supply insights:', error);
    return NextResponse.json({ status: 'ERROR', message: '공급 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
