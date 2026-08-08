import React, { useEffect, useRef, useState } from 'react';

interface Props {
  address: string;
  jibunAddress?: string;
  type: 'map' | 'roadview';
}

export default function KakaoMapEmbed({ address, jibunAddress, type }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mapInstance: any = null;
    let rvInstance: any = null;

    const renderMap = () => {
      const geocoder = new window.kakao.maps.services.Geocoder();
      const ps = new window.kakao.maps.services.Places();

      const applyCoords = (coords: any) => {
        if (containerRef.current) {
          if (type === 'map') {
            const mapOptions = { center: coords, level: 3 };
            mapInstance = new window.kakao.maps.Map(containerRef.current, mapOptions);
            const marker = new window.kakao.maps.Marker({ position: coords });
            marker.setMap(mapInstance);
          } else {
            rvInstance = new window.kakao.maps.Roadview(containerRef.current);
            const rvClient = new window.kakao.maps.RoadviewClient();
            rvClient.getNearestPanoId(coords, 200, (panoId: any) => {
              if (panoId) {
                rvInstance.setPanoId(panoId, coords);
              } else {
                setError('해당 단지 근처의 로드뷰 정보를 찾을 수 없습니다.');
              }
            });
          }
        }
      };

      const searchKeyword = () => {
        ps.keywordSearch(address, (places: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK) {
            applyCoords(new window.kakao.maps.LatLng(places[0].y, places[0].x));
          } else {
            console.error(`Geocoding failed for both address(${address}) and jibun(${jibunAddress}). Keyword search also failed.`);
            setError('위치를 찾을 수 없습니다.');
          }
        });
      };

      const searchJibun = () => {
        if (!jibunAddress) {
          searchKeyword();
          return;
        }
        geocoder.addressSearch(jibunAddress, (result: any, status: any) => {
          if (status === window.kakao.maps.services.Status.OK) {
            applyCoords(new window.kakao.maps.LatLng(result[0].y, result[0].x));
          } else {
            searchKeyword();
          }
        });
      };

      geocoder.addressSearch(address, (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK) {
          applyCoords(new window.kakao.maps.LatLng(result[0].y, result[0].x));
        } else {
          searchJibun();
        }
      });
    };

    const loadKakaoMap = () => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.load) {
        window.kakao.maps.load(() => {
          if (window.kakao.maps.services) {
            setTimeout(renderMap, 100);
          } else {
            setError('카카오 서비스 라이브러리 로드 대기 중...');
            setTimeout(loadKakaoMap, 500);
          }
        });
      } else {
        setTimeout(loadKakaoMap, 500);
      }
    };

    // 지도/로드뷰 모달을 다른 페이지(예: 학군/교통)를 거치지 않고 처음 여는
    // 경우에도 정상 동작하도록, 이 컴포넌트가 직접 SDK 스크립트 로드를 보장한다.
    // (기존에는 다른 컴포넌트가 먼저 스크립트를 주입해줄 것이라 가정하고 있었고,
    //  그 전제가 깨지면 window.kakao가 영영 정의되지 않아 무한 대기 상태로
    //  빈 화면만 표시되는 문제가 있었다.)
    const ensureScriptAndLoad = () => {
      if (window.kakao && window.kakao.maps) {
        loadKakaoMap();
        return;
      }

      const scriptId = 'kakao-map-script-main';
      let script = document.getElementById(scriptId) as HTMLScriptElement | null;

      if (!script) {
        const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
        if (!apiKey) {
          console.error('[KakaoMapEmbed] NEXT_PUBLIC_KAKAO_MAP_API_KEY 환경변수가 없습니다.');
          setError('지도 API 키가 설정되지 않았습니다.');
          return;
        }
        script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
        script.async = true;
        script.onerror = () => setError('카카오 지도 스크립트 로드에 실패했습니다.');
        document.head.appendChild(script);
      }

      const checkKakao = setInterval(() => {
        if (window.kakao && window.kakao.maps) {
          clearInterval(checkKakao);
          loadKakaoMap();
        }
      }, 200);

      // 도메인 미등록 등으로 스크립트가 로드되지 않는 경우 무한 대기 대신 에러 표시
      const timeoutId = setTimeout(() => {
        clearInterval(checkKakao);
        if (!window.kakao || !window.kakao.maps) {
          setError('카카오 지도를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      }, 10000);

      return () => {
        clearInterval(checkKakao);
        clearTimeout(timeoutId);
      };
    };

    return ensureScriptAndLoad();
  }, [address, type]);

  if (error) {
    return <div style={{width: '100%', height: '100%', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9'}}>{error}</div>;
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '400px', borderRadius: '8px' }}></div>;
}
