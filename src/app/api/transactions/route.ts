import { NextResponse } from 'next/server';
import { fetchMolitData, DataType } from '@/lib/api-molit';

// MOLIT 실거래가 데이터는 좌표를 제공하지 않으므로, 지도 마커 표시를 위해
// 카카오 로컬 키워드 검색으로 "법정동 + 단지명" 기준 좌표를 보강한다.
// 서버 인스턴스가 살아있는 동안 재사용되는 캐시로 동일 단지 중복 조회를 방지.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

async function geocodeApt(name: string, dong: string): Promise<{ lat: number; lng: number } | null> {
  const key = `${dong}|${name}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !name) {
    geocodeCache.set(key, null);
    return null;
  }

  try {
    const query = `${dong} ${name}`.trim();
    const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${kakaoKey}`,
        KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
        Origin: 'http://localhost:3000',
      },
    });

    if (!res.ok) {
      geocodeCache.set(key, null);
      return null;
    }

    const data = await res.json();
    const doc = data.documents?.[0];
    if (!doc) {
      geocodeCache.set(key, null);
      return null;
    }

    const coords = { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
    geocodeCache.set(key, coords);
    return coords;
  } catch (err) {
    geocodeCache.set(key, null);
    return null;
  }
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

    // 1. type과 lawdCd가 있으면 국토부 API 실시간 호출
    if (type && lawdCd) {
      const getMonths = (startOffset: number, count: number) => {
        const res = [];
        for (let i = 0; i < count; i++) {
          const date = new Date();
          // Current month is 0-indexed, so we subtract startOffset + i
          date.setMonth(date.getMonth() - (startOffset + i));
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          res.push(`${y}${m}`);
        }
        return res;
      };

      // loadMore=0 -> offset=0 (last 3 months)
      // loadMore=1 -> offset=3 (previous 3 months)
      const months = monthsParam
        ? getMonths(0, Math.max(1, parseInt(monthsParam, 10) || 3))
        : getMonths(loadMore * 3, 3);
      
      // 공공데이터 API 병렬 호출 (속도 개선)
      const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
      const results = await Promise.all(promises);
      
      let data = results.flat();

      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }

      // 정렬/표시용 필드 보강: info 문자열("면적 • 층 • 계약일")에서 평형·층·계약일자를
      // 파싱한다 (api/apt/[name]/route.ts와 동일한 규칙). 여러 달치 데이터를 합친 뒤이므로
      // 단순 배열 순서로는 최신순이 보장되지 않아, 실제 계약일자 기준으로 명시적으로 정렬한다.
      data = data.map((item: any) => {
        const infoParts = (item.info || '').split('•');
        const area = infoParts[0]?.trim() || '';
        const floor = parseInt(infoParts[1]?.trim() || '0', 10) || 0;
        const tradeDate = infoParts[infoParts.length - 1]?.trim() || '';
        const areaNum = parseFloat(area);
        const pyung = areaNum ? Math.round(areaNum / 3.3058) : null;
        return { ...item, area, floor, tradeDate, pyung };
      });

      data.sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

      // 지도 마커(단지 칩) 표시를 위해 아파트 매매(apt)·분양권(silv) 데이터에 한해 좌표 보강
      if ((type === 'apt' || type === 'silv') && data.length > 0) {
        const uniqueKeys = Array.from(new Set(data.map((item: any) => `${item.dong}|${item.name}`)));
        await Promise.all(
          uniqueKeys.map((key) => {
            const [dongName, aptName] = key.split('|');
            return geocodeApt(aptName, dongName);
          })
        );
        data = data.map((item: any) => {
          const coords = geocodeCache.get(`${item.dong}|${item.name}`);
          return coords ? { ...item, lat: coords.lat, lng: coords.lng } : item;
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
