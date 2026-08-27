import { NextResponse } from 'next/server';
import { fetchMolitData, DataType } from '@/lib/api-molit';
import { prisma } from '@/lib/prisma';
import { buildMasterCoordIndex, resolveApartmentCoords, type MasterCoordRow } from '@/lib/map-marker-coords';
import { aptNamesMatch } from '@/lib/apt-name-match';
import { recentMonths } from '@/lib/molit-months';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';

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

    // 1. type과 lawdCd가 있으면 국토부 API 실시간 호출
    if (type && lawdCd) {
      // loadMore=0 -> offset=0 (last 3 months)
      // loadMore=1 -> offset=3 (previous 3 months)
      const months = monthsParam
        ? recentMonths(Math.max(1, parseInt(monthsParam, 10) || 3), 0)
        : recentMonths(3, loadMore * 3);

      // 공공데이터 API 병렬 호출 (속도 개선)
      const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
      const results = await Promise.all(promises);

      let data = results.flat();

      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }

      // 정렬/표시용 필드 보강: info 문자열("면적 • 층 • 계약일")에서 층·계약일자를
      // 파싱한다 (api/apt/[name]/route.ts와 동일한 규칙). 여러 달치 데이터를 합친 뒤이므로
      // 단순 배열 순서로는 최신순이 보장되지 않아, 실제 계약일자 기준으로 명시적으로 정렬한다.
      // FIX_STATISTICS_DATA_TRUST — 예전에는 `areaNum / 3.3058`로 "평형"을 만들어
      // 그대로 내려줬다(가짜 평형, AGENTS.md Unit Master 보호 원칙 위반). 이제
      // raw ㎡만 파싱하고, pyung은 아래에서 Unit Master를 batch 조회해서만 채운다
      // (없으면 null — raw ㎡만 표시).
      data = data.map((item: any) => {
        const infoParts = (item.info || '').split('•');
        const area = infoParts[0]?.trim() || '';
        const floor = parseInt(infoParts[1]?.trim() || '0', 10) || 0;
        const tradeDate = infoParts[infoParts.length - 1]?.trim() || '';
        const areaNum = parseFloat(area) || null;
        return { ...item, area, floor, tradeDate, areaNum };
      });

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
