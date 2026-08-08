import React, { useEffect, useState } from 'react';

interface Props {
  address: string;
  category: 'SC4' | 'SW8'; // SC4: 학교, SW8: 지하철
}

export default function KakaoPlaces({ address, category }: Props) {
  const [places, setPlaces] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const renderPlaces = () => {
      const geocoder = new window.kakao.maps.services.Geocoder();
      const ps = new window.kakao.maps.services.Places();

      const searchPlaces = (coords: any) => {
        ps.categorySearch(category, (result: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK) {
            setPlaces(result.slice(0, 5)); // 상위 5개만
          } else {
            setError('주변에 해당 인프라가 없습니다.');
          }
          setLoading(false);
        }, {
          location: coords,
          radius: 1500, // 1.5km 반경
          sort: window.kakao.maps.services.SortBy.DISTANCE
        });
      };

      geocoder.addressSearch(address, (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
          searchPlaces(coords);
        } else {
          ps.keywordSearch(address, (res: any, status2: any) => {
            if (status2 === window.kakao.maps.services.Status.OK) {
               const coords = new window.kakao.maps.LatLng(res[0].y, res[0].x);
               searchPlaces(coords);
            } else {
              setError('위치를 찾을 수 없어 주변 인프라를 검색할 수 없습니다.');
              setLoading(false);
            }
          });
        }
      });
    };

    const loadKakaoPlaces = () => {
      window.kakao.maps.load(() => {
        setTimeout(renderPlaces, 100);
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadKakaoPlaces();
    } else {
      const scriptId = 'kakao-map-script-main';
      let script = document.getElementById(scriptId) as HTMLScriptElement;

      if (!script) {
        const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
        if (!apiKey) {
          console.error('[KakaoPlaces] NEXT_PUBLIC_KAKAO_MAP_API_KEY 환경변수가 없습니다.');
          setError('지도 API 키가 설정되지 않았습니다.');
          setLoading(false);
          return;
        }
        script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer,drawing&autoload=false`;
        document.head.appendChild(script);
      }
      
      script.addEventListener('load', loadKakaoPlaces);
      
      return () => {
        script.removeEventListener('load', loadKakaoPlaces);
      };
    }
  }, [address, category]);

  if (loading) return <div>검색 중입니다...</div>;
  if (error) return <div style={{ color: 'var(--text-muted)' }}>{error}</div>;

  return (
    <ul style={{ lineHeight: 1.8, paddingLeft: '1.2rem' }}>
      {places.map((p, i) => (
        <li key={i} style={{ marginBottom: '0.5rem' }}>
          {category === 'SC4' ? '🏫' : '🚇'} <b>{p.place_name}</b> 
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
            ({p.distance}m, 도보 약 {Math.ceil(p.distance / 80)}분)
          </span>
        </li>
      ))}
      {places.length > 0 && category === 'SC4' && places[0].distance < 300 && (
         <li style={{color: 'var(--primary-color)', fontWeight: 600, marginTop: '1rem', listStyle: 'none', marginLeft: '-1.2rem'}}>
           🏆 초품아(학세권) 단지로 교육 환경이 매우 우수합니다.
         </li>
      )}
      {places.length > 0 && category === 'SW8' && places[0].distance < 500 && (
         <li style={{color: 'var(--primary-color)', fontWeight: 600, marginTop: '1rem', listStyle: 'none', marginLeft: '-1.2rem'}}>
           🚗 도보 5분 이내의 초역세권 단지입니다!
         </li>
      )}
    </ul>
  );
}
