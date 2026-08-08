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
      const months = getMonths(loadMore * 3, 3);
      
      // 공공데이터 API 병렬 호출 (속도 개선)
      const promises = months.map(dealYmd => fetchMolitData({ lawdCd, dealYmd, type }));
      const results = await Promise.all(promises);
      
      // 데이터를 하나의 배열로 합치고 정렬 (최신이 위로 오도록 임시 처리)
      let data = results.flat().reverse();
      
      if (dong && dong !== 'all') {
        data = data.filter((item: any) => item.dong === dong);
      }

      // 지도 마커(단지 칩) 표시를 위해 아파트 매매(apt) 데이터에 한해 좌표 보강
      if (type === 'apt' && data.length > 0) {
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
