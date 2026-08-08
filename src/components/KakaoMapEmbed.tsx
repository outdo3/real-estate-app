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
                   rvClient.getNearestPanoId(coords, 200, (panoId: any) => {
                     if (panoId) {
                       rvInstance.setPanoId(panoId, coords);
                     } else {
                       setError('해당 단지 근처의 로드뷰 정보를 찾을 수 없습니다.');
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
        setTimeout(renderMap, 100);
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadKakaoMap();
    } else {
      let checkKakao = setInterval(() => {
        if (window.kakao && window.kakao.maps) {
          clearInterval(checkKakao);
          loadKakaoMap();
        }
      }, 100);
      return () => clearInterval(checkKakao);
    }
  }, [address, type]);

  if (error) {
    return <div style={{width: '100%', height: '100%', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f5f9'}}>{error}</div>;
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: '400px', borderRadius: '8px' }}></div>;
}
