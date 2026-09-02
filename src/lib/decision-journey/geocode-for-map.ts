// DECISION_JOURNEY_V1 §11 — 상세 페이지에는 아파트의 lat/lng가 없다(주소 문자열만
// 있음). /map의 공유링크 파서(parseMapStateFromSearchParams)는 lat/lng가 없으면
// 전체 딥링크를 무시하고 기본 지역으로 열리므로, "지도에서 위치 보기" 클릭 시점에
// 이미 이 앱 전역에서 쓰는 카카오 지도 SDK(KakaoMapEmbed.tsx와 동일한 스크립트
// 로드/주소검색 폴백 패턴)로 좌표를 즉석에서 조회한다. 새 유료 API 의존성이
// 아니라 기존 카카오 지도 SDK를 다른 트리거 시점에 재사용하는 것뿐이다.
const KAKAO_SCRIPT_ID = 'kakao-map-script-main';

function ensureKakaoMapsLoaded(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    const w = window as any;
    if (w.kakao?.maps?.services) {
      resolve(true);
      return;
    }

    const finishLoad = () => {
      w.kakao.maps.load(() => resolve(!!w.kakao.maps.services));
    };

    if (w.kakao?.maps) {
      finishLoad();
      return;
    }

    let script = document.getElementById(KAKAO_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
      if (!apiKey) {
        resolve(false);
        return;
      }
      script = document.createElement('script');
      script.id = KAKAO_SCRIPT_ID;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services&autoload=false`;
      script.async = true;
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    }

    const checkInterval = setInterval(() => {
      if (w.kakao?.maps) {
        clearInterval(checkInterval);
        clearTimeout(timeoutId);
        finishLoad();
      }
    }, 200);
    const timeoutId = setTimeout(() => {
      clearInterval(checkInterval);
      resolve(false);
    }, 8000);
  });
}

export async function geocodeAddressToCoords(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null;
  const loaded = await ensureKakaoMapsLoaded();
  if (!loaded) return null;

  const w = window as any;
  return new Promise((resolve) => {
    const geocoder = new w.kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result: any, status: any) => {
      if (status === w.kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
        return;
      }
      const ps = new w.kakao.maps.services.Places();
      ps.keywordSearch(address, (places: any, kwStatus: any) => {
        if (kwStatus === w.kakao.maps.services.Status.OK && places[0]) {
          resolve({ lat: parseFloat(places[0].y), lng: parseFloat(places[0].x) });
        } else {
          resolve(null);
        }
      });
    });
  });
}
