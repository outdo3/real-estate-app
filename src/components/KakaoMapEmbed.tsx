import React, { useEffect, useRef, useState } from 'react';

interface Props {
  address: string;
  type: 'map' | 'roadview';
}

export default function KakaoMapEmbed({ address, type }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let mapInstance: any = null;
    let rvInstance: any = null;

    const renderMap = () => {
      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.addressSearch(address, (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK) {
          const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
          
          if (containerRef.current) {
            // ensure container has dimensions before initializing
            if (type === 'map') {
              const mapOptions = { center: coords, level: 3 };
              mapInstance = new window.kakao.maps.Map(containerRef.current, mapOptions);
              const marker = new window.kakao.maps.Marker({ position: coords });
              marker.setMap(mapInstance);
            } else {
              rvInstance = new window.kakao.maps.Roadview(containerRef.current);
              const rvClient = new window.kakao.maps.RoadviewClient();
              rvClient.getNearestPanoId(coords, 50, (panoId: any) => {
                if (panoId) {
                  rvInstance.setPanoId(panoId, coords);
                } else {
                  setError('해당 위치의 로드뷰 정보가 없습니다.');
                }
              });
            }
          }
        } else {
          const ps = new window.kakao.maps.services.Places();
          ps.keywordSearch(address, (places: any, status2: any) => {
            if (status2 === window.kakao.maps.services.Status.OK) {
               const coords = new window.kakao.maps.LatLng(places[0].y, places[0].x);
               if (containerRef.current) {
                 if (type === 'map') {
                   const mapOptions = { center: coords, level: 3 };
                   mapInstance = new window.kakao.maps.Map(containerRef.current, mapOptions);
                   const marker = new window.kakao.maps.Marker({ position: coords });
                   marker.setMap(mapInstance);
                 } else {
                   rvInstance = new window.kakao.maps.Roadview(containerRef.current);
                   const rvClient = new window.kakao.maps.RoadviewClient();
                   rvClient.getNearestPanoId(coords, 50, (panoId: any) => {
                     if (panoId) {
                       rvInstance.setPanoId(panoId, coords);
                     } else {
                       setError('해당 위치의 로드뷰 정보가 없습니다.');
                     }
                   });
                 }
               }
            } else {
              setError('위치를 찾을 수 없습니다.');
            }
          });
        }
      });
    };

    const loadKakaoMap = () => {
      window.kakao.maps.load(() => {
        // Use setTimeout to ensure the modal's CSS has applied and container has dimensions
        setTimeout(renderMap, 100);
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadKakaoMap();
    } else {
      const scriptId = 'kakao-map-script';
      let script = document.getElementById(scriptId) as HTMLScriptElement;
      
      if (!script) {
        script = document.createElement('script');
        script.id = scriptId;
        script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=ca05485a3b656a8eca75a33d158f26a4&libraries=services,clusterer,drawing&autoload=false`;
        document.head.appendChild(script);
      }
      
      script.addEventListener('load', loadKakaoMap);
      
      return () => {
        script.removeEventListener('load', loadKakaoMap);
      };
    }
  }, [address, type]);

  if (error) {
    return <div style={{width: '100%', height: '100%', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9'}}>{error}</div>;
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '400px', borderRadius: '8px' }}></div>;
}
