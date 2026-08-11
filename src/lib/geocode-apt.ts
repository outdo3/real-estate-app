// 아파트명만으로 lawdCd(법정동코드 5자리)와 dong(법정동명)을 알아낸다. 카카오 키워드
// 검색으로 단지 좌표를 찾은 뒤 좌표를 행정구역 코드로 역지오코딩한다 — api/apt/[name]/route.ts
// 에서 쓰던 로직을 AI 검색(runConditionSearch)도 재사용할 수 있도록 공용 모듈로 뺐다.
const aptGeoCache = new Map<string, { lawdCd: string; dong: string } | null>();

export async function geocodeApartmentName(aptName: string): Promise<{ lawdCd: string; dong: string } | null> {
  if (aptGeoCache.has(aptName)) return aptGeoCache.get(aptName)!;

  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  if (!kakaoKey || !aptName) {
    aptGeoCache.set(aptName, null);
    return null;
  }

  try {
    // 이 카카오 키는 JavaScript 키라 REST 호출 시 KA/Origin 헤더가 없으면 401을 반환한다.
    const headers = {
      Authorization: `KakaoAK ${kakaoKey}`,
      KA: 'sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000',
      Origin: 'http://localhost:3000',
    };

    const keywordRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(aptName)}`,
      { headers }
    );
    if (!keywordRes.ok) {
      aptGeoCache.set(aptName, null);
      return null;
    }
    const keywordData = await keywordRes.json();
    const place = keywordData.documents?.[0];
    if (!place) {
      aptGeoCache.set(aptName, null);
      return null;
    }

    const regionRes = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${place.x}&y=${place.y}`,
      { headers }
    );
    if (!regionRes.ok) {
      aptGeoCache.set(aptName, null);
      return null;
    }
    const regionData = await regionRes.json();
    const bRegion = (regionData.documents || []).find((r: any) => r.region_type === 'B');
    if (!bRegion?.code) {
      aptGeoCache.set(aptName, null);
      return null;
    }

    const result = { lawdCd: String(bRegion.code).substring(0, 5), dong: bRegion.region_3depth_name || '' };
    aptGeoCache.set(aptName, result);
    return result;
  } catch (e) {
    console.warn('아파트명 -> 지역 지오코딩 실패', e);
    aptGeoCache.set(aptName, null);
    return null;
  }
}
