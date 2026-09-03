import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice, DataType } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { buildMasterCoordIndex, resolveApartmentCoords, type MasterCoordRow } from '@/lib/map-marker-coords';
import { aptNamesMatch } from '@/lib/apt-name-match';
import { recentMonths } from '@/lib/molit-months';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { queryTrades } from '@/lib/trade-history-read';
import { getOrSetCache } from '@/lib/server-cache';

// MAP_PERFORMANCE_V1 — 이 route가 지도(map/page.tsx)·분위지도(stats type-client.tsx)·
// AI 검색 조건검색(ai-search.ts runConditionSearch) 3곳 모두에서 정확히 같은 모양
// (`type=apt&lawdCd=X&months=12`, dong/loadMore 없음)으로만 호출된다는 것을 실제
// 호출부 전수 확인으로 검증했다. 이 정확한 모양일 때만 부산 지역에 한해 DB-first로
// 전환한다(TRADE_DB_FIRST_V1 STEP A/AREA84 SQL PUSHDOWN과 동일한 "정확히 알려진 모양만
// 좁혀서 전환" 원칙 — 다른 파라미터 조합은 기존 MOLIT-live 경로를 그대로 탄다, 회귀 없음).
// 지도의 첫 마커 로드가 이 route를 기다리는 동안 실측 3.6~4.5s가 걸렸는데(부산 16개 구
// 중 큰 구는 더 심함), 원인은 이 route가 이미 완성된 apartment_trade_histories DB를 전혀
// 쓰지 않고 12개월치 MOLIT 실시간 호출(월별 병렬)을 그대로 하고 있었기 때문이다.
const BUSAN_SIDO_CODE = '26';

async function fetchApt12MonthsFromDb(lawdCd: string): Promise<any[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  // SUPABASE_EGRESS_P0_FIX_V1 — 이 호출부는 meta를 전혀 쓰지 않는다(구조분해가 trades만
  // 꺼낸다). 기본값이면 동일 where로 MAX(dealDate) aggregate가 한 번 더 실행돼, 부산 구
  // 단위 12개월 스캔을 매 요청마다 두 번 하게 된다 — 감사에서 PROVEN된 낭비라 끈다.
  const { trades } = await queryTrades({ lawdCd, from, withLatestDealDate: false });
  return trades.map((t) => {
    const areaNum = Number(t.exclusiveArea);
    const tradeDate = t.dealDate.toISOString().slice(0, 10);
    return {
      id: `db-apt-${t.id}`,
      rank: 0,
      name: t.aptName,
      price: formatKoreanPrice(t.dealAmount),
      dealAmount: t.dealAmount,
      monthlyRent: 0,
      priceChange: '',
      changeType: 'new',
      typeLabel: '실거래',
      dong: t.dong,
      buildYear: t.buildYear != null ? String(t.buildYear) : '',
      jibun: t.jibun || '',
      dealCanceled: t.dealCanceled,
      aptSeq: t.aptSeq,
      area: `${areaNum}m²`,
      areaNum,
      floor: t.floor ?? 0,
      tradeDate,
    };
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const changeType = searchParams.get('changeType');
    const type = searchParams.get('type') as DataType;
    const lawdCd = searchParams.get('lawdCd');
    const dong = searchParams.get('dong');
    const loadMore = parseInt(searchParams.get('loadMore') || '0', 10);
    // 지도 마커처럼 "최근 3개월에 거래가 없어도 그 단지의 가장 최근 실거래로라도 마커를
    // 띄워야" 하는 호출부를 위한 단발성 넓은 윈도우. loadMore 기반 페이지네이션과는
    // 별개 파라미터라 기존 호출부(홈 화면 "더보기")는 영향받지 않는다.
    const monthsParam = searchParams.get('months');

    // 1. type과 lawdCd가 있으면 국토부 API 실시간 호출(단, 아래 조건에 맞으면 DB-first)
    if (type && lawdCd) {
      // MAP_PERFORMANCE_V1 — 지도/분위지도/AI조건검색이 실제로 쓰는 정확히 이 모양
      // (apt, 12개월, dong/loadMore 없음)이고 부산 지역이면 DB-first. 캐시는 기존
      // getOrSetCache 재사용(신규 인프라 없음), TTL 30분 — Score/area84가 이미 쓰는
      // "배치 갱신 데이터라 30분 지연은 문제 없음" 원칙과 동일.
      const isMapMarkerShape = type === 'apt' && monthsParam === '12' && loadMore === 0 && (!dong || dong === 'all');
      const isDbFirstEligible = isMapMarkerShape && lawdCd.startsWith(BUSAN_SIDO_CODE);

      let data: any[];
      let usedDbFirst = false;

      if (isDbFirstEligible) {
        data = await getOrSetCache(`transactions-apt-12mo-db:${lawdCd}`, 30 * 60 * 1000, () => fetchApt12MonthsFromDb(lawdCd));
        usedDbFirst = true;
      } else {
        // loadMore=0 -> offset=0 (last 3 months)
        // loadMore=1 -> offset=3 (previous 3 months)
        const months = monthsParam
          ? recentMonths(Math.max(1, parseInt(monthsParam, 10) || 3), 0)
          : recentMonths(3, loadMore * 3);

        // 공공데이터 API 병렬 호출 (속도 개선)
        const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
        const results = await Promise.all(promises);
        data = results.flat();
      }

      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }

      // 정렬/표시용 필드 보강: info 문자열("면적 • 층 • 계약일")에서 층·계약일자를
      // 파싱한다 (api/apt/[name]/route.ts와 동일한 규칙). 여러 달치 데이터를 합친 뒤이므로
      // 단순 배열 순서로는 최신순이 보장되지 않아, 실제 계약일자 기준으로 명시적으로 정렬한다.
      // DB-first 경로는 fetchApt12MonthsFromDb()가 이미 area/floor/tradeDate/areaNum을
      // 최종 형태로 채워뒀으므로(가짜 .info 문자열을 만들어 다시 파싱하는 왕복 금지) 이
      // 재파싱 단계를 건너뛴다.
      // FIX_STATISTICS_DATA_TRUST — 예전에는 `areaNum / 3.3058`로 "평형"을 만들어
      // 그대로 내려줬다(가짜 평형, AGENTS.md Unit Master 보호 원칙 위반). 이제
      // raw ㎡만 파싱하고, pyung은 아래에서 Unit Master를 batch 조회해서만 채운다
      // (없으면 null — raw ㎡만 표시).
      if (!usedDbFirst) {
        data = data.map((item: any) => {
          const infoParts = (item.info || '').split('•');
          const area = infoParts[0]?.trim() || '';
          const floor = parseInt(infoParts[1]?.trim() || '0', 10) || 0;
          const tradeDate = infoParts[infoParts.length - 1]?.trim() || '';
          const areaNum = parseFloat(area) || null;
          return { ...item, area, floor, tradeDate, areaNum };
        });
      }

      {
        const lookupKeys = new Map<string, PyeongLookupKey>();
        for (const item of data as any[]) {
          if (item.areaNum == null) continue;
          const key: PyeongLookupKey = { name: item.name, dong: item.dong || '', aptSeq: item.aptSeq ?? null, rawAreaM2: item.areaNum };
          lookupKeys.set(pyeongLookupKeyId(key), key);
        }
        const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(lookupKeys.values()));
        data = data.map((item: any) => {
          if (item.areaNum == null) return { ...item, pyung: null };
          const key: PyeongLookupKey = { name: item.name, dong: item.dong || '', aptSeq: item.aptSeq ?? null, rawAreaM2: item.areaNum };
          return { ...item, pyung: pyeongMap.get(pyeongLookupKeyId(key)) ?? null };
        });
      }

      data.sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

      // 지도 마커(단지 칩) 표시를 위해 아파트 매매(apt)·분양권(silv) 데이터에 한해 좌표 보강.
      // MAP_SURROUNDING_MARKER_PERFORMANCE_V1: 이전에는 단지별로 Kakao 키워드 지오코딩을
      // N회 호출해 좌표를 얻었다(N+1 외부 API, 실측 지연 592ms~5.76s). ApartmentMaster가
      // 이미 이 지역 단지 전체의 검증된 좌표(Kakao geocoding 결과를 사전에 저장한 canonical
      // source, Busan coverage 100%)를 갖고 있으므로 외부 API 호출 없이 단일 DB 쿼리로
      // 대체한다.
      if ((type === 'apt' || type === 'silv') && data.length > 0) {
        const masters: MasterCoordRow[] = await prisma.apartmentMaster.findMany({
          where: { sggCd: lawdCd },
          select: { name: true, umdName: true, aptSeq: true, buildYear: true, latitude: true, longitude: true }
        });

        // 실측(연산동 26470, 207개 단지): dong+name 완전일치만으로 206건이 이미 매칭됐지만
        // Kakao 지오코딩은 그중 19건에서 실패했었다(오래된/소규모 단지, 지번 병기 표기 등) —
        // ApartmentMaster는 그 19건 전부 유효 좌표를 갖고 있어 이 교체만으로 marker coverage가
        // 오히려 개선된다. 매칭/좌표 결합 규칙 자체는 src/lib/map-marker-coords.ts(순수 함수,
        // 단위 테스트 있음)에 있다.
        const masterIndex = buildMasterCoordIndex(masters);
        const fuzzyCache = new Map<string, MasterCoordRow | null>();

        data = data.map((item: any) => {
          const resolved = resolveApartmentCoords(masterIndex, item.dong, item.name, aptNamesMatch, fuzzyCache);
          return { ...item, ...resolved };
        });
      }

      return NextResponse.json(data);
    }

    // 2. 파라미터가 없으면 기존 DB 데이터(TOP 5) 반환
    const transactions: any[] = [];

    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Failed to fetch transactions:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
