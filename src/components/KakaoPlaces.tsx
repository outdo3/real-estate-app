import React, { useEffect, useState } from 'react';
import Link from 'next/link';

// 카카오 로컬 카테고리 코드 중 이 컴포넌트에서 실제로 사용하는 7종.
// SC4(학교), SW8(지하철), HP8(병원), MT1(대형마트), CS2(편의점), PM9(약국),
// PS3(어린이집,유치원 — Kakao 공식 category_group_name 자체가 이 둘을 묶어서
// 부른다, 실측 확인. 그래서 이 카테고리를 쓰는 화면은 반드시 "어린이집·유치원"처럼
// 두 시설을 함께 지칭하는 라벨을 써야 한다 — "어린이집"만 쓰면 유치원 결과가
// 섞여 나오는데 라벨이 실제와 달라진다).
type KakaoCategoryCode = 'SC4' | 'SW8' | 'HP8' | 'MT1' | 'CS2' | 'PM9' | 'PS3';

interface Props {
  address: string;
  // 카카오 로컬 카테고리 코드. 여러 개를 넘기면 각각 검색 후 거리순으로 병합한다.
  categories: KakaoCategoryCode[];
  // 카테고리 코드가 없는 장소(공원, KTX역 등)는 키워드 검색으로 보완한다. 카테고리 결과와
  // 동일하게 거리순으로 병합된다. 기존 호출부는 이 prop을 넘기지 않아도 그대로 동작한다.
  keywords?: string[];
  limit?: number;
  // 학교 목록(isSchoolOnly)일 때 /school/[id] 링크에 함께 실어 보낼 지역코드 — 학교
  // 상세페이지가 배정 아파트 목록(/api/school/apartments)을 조회할 때 필요하다.
  lawdCd?: string;
}

const CATEGORY_ICON: Record<string, string> = {
  SC4: '🏫',
  SW8: '🚇',
  HP8: '🏥',
  MT1: '🛒',
  CS2: '🏪',
  PM9: '💊',
  PS3: '🧸',
};

const KEYWORD_ICON: Record<string, string> = {
  공원: '🌳',
  KTX: '🚄',
  기차역: '🚄',
};

// 장소명에 이 문자열이 포함되면 결과에서 제외한다(아파트/빌라 단지명, 화장실 등 실제
// 인프라가 아닌 결과가 카테고리/키워드 검색에 섞여 들어오는 것을 막는다).
const EXCLUDED_NAME_SUBSTRINGS = ['아파트', '빌라', '화장실', '맨션', '타워'];

const iconFor = (place: any, keyword?: string) => {
  if (place.category_group_code && CATEGORY_ICON[place.category_group_code]) {
    return CATEGORY_ICON[place.category_group_code];
  }
  if (keyword && KEYWORD_ICON[keyword]) return KEYWORD_ICON[keyword];
  return '📍';
};

// 도보 기준(분속 80m)이 비현실적인 거리(1km 초과)에서는 차량 이동시간(분속 500m, 시속 약
// 30km 도심 평균 가정)을 함께 보여준다 — 둘 다 카카오 실측 직선거리 기반의 근사치이며,
// 이 앱 다른 곳(학군 탭 walkTime)에서도 이미 쓰는 것과 같은 종류의 어림값이다.
const formatEta = (distance: number) => {
  const walkMin = Math.ceil(distance / 80);
  if (distance <= 1000) return `도보 약 ${walkMin}분`;
  const driveMin = Math.ceil(distance / 500);
  return `차량 약 ${driveMin}분`;
};

export default function KakaoPlaces({ address, categories, keywords = [], limit = 5, lawdCd }: Props) {
  const [places, setPlaces] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const categoriesKey = categories.join(',');
  const keywordsKey = keywords.join(',');

  useEffect(() => {
    let cancelled = false;

    // 새 실행 시작: 이전 실행이 남긴 상태(특히 error)가 최신 결과 렌더링을 가리지 않도록 초기화.
    setLoading(true);
    setError('');
    setPlaces([]);

    const renderPlaces = () => {
      if (cancelled) return;
      const geocoder = new window.kakao.maps.services.Geocoder();
      const ps = new window.kakao.maps.services.Places();

      const searchOneCategory = (category: KakaoCategoryCode, coords: any) =>
        new Promise<any[]>((resolve) => {
          ps.categorySearch(
            category,
            (result: any, status: any) => {
              resolve(status === window.kakao.maps.services.Status.OK ? result : []);
            },
            {
              location: coords,
              radius: 1500, // 1.5km 반경
              sort: window.kakao.maps.services.SortBy.DISTANCE,
            }
          );
        });

      const searchOneKeyword = (keyword: string, coords: any) =>
        new Promise<any[]>((resolve) => {
          ps.keywordSearch(
            keyword,
            (result: any, status: any) => {
              resolve(status === window.kakao.maps.services.Status.OK ? result.map((r: any) => ({ ...r, __keyword: keyword })) : []);
            },
            {
              location: coords,
              radius: 5000, // 공원/KTX역은 도보권 밖에도 있을 수 있어 카테고리 검색보다 넓게
              sort: window.kakao.maps.services.SortBy.DISTANCE,
            }
          );
        });

      const searchPlaces = async (coords: any) => {
        const [categoryResults, keywordResults] = await Promise.all([
          Promise.all(categories.map((c) => searchOneCategory(c, coords))),
          Promise.all(keywords.map((k) => searchOneKeyword(k, coords))),
        ]);
        if (cancelled) return;
        // 카테고리 검색과 키워드 검색 결과가 같은 장소를 중복으로 찾을 수 있어(예: KTX역이
        // 지하철 카테고리와 'KTX' 키워드 양쪽에 걸리는 경우) 카카오 장소 id 기준으로 제거한다.
        const seen = new Set<string>();
        const merged = [...categoryResults.flat(), ...keywordResults.flat()]
          .sort((a, b) => Number(a.distance) - Number(b.distance))
          .filter((p) => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          })
          // '공원' 키워드 검색은 카카오가 이름에 포함된 문자열만 보고 매칭해서 "OO공원아파트",
          // "공원빌라", "체육공원 화장실"처럼 실제로는 병원·약국·공원이 아닌 곳도 섞여 들어온다
          // — 이름에 이런 문자열이 포함된 결과는 제외한다.
          .filter((p) => !EXCLUDED_NAME_SUBSTRINGS.some((s) => p.place_name.includes(s)));

        if (merged.length === 0) {
          // [UI-C2] "주변에 없습니다"는 검색 반경(카테고리 1.5km/키워드 5km) 밖에도
          // 실제로는 있을 수 있는데 단정하는 느낌을 준다 — 반경 기준임을 명시한다.
          setError('검색 반경 내 정보가 없습니다.');
        } else {
          setPlaces(merged.slice(0, limit));
        }
        setLoading(false);
      };

      geocoder.addressSearch(address, (result: any, status: any) => {
        if (cancelled) return;
        if (status === window.kakao.maps.services.Status.OK) {
          const coords = new window.kakao.maps.LatLng(result[0].y, result[0].x);
          searchPlaces(coords);
        } else {
          ps.keywordSearch(address, (res: any, status2: any) => {
            if (cancelled) return;
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
      return () => {
        cancelled = true;
      };
    } else {
      const scriptId = 'kakao-map-script-main';
      let script = document.getElementById(scriptId) as HTMLScriptElement;

      if (!script) {
        const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
        if (!apiKey) {
          console.error('[KakaoPlaces] NEXT_PUBLIC_KAKAO_MAP_API_KEY 환경변수가 없습니다.');
          setError('지도 API 키가 설정되지 않았습니다.');
          setLoading(false);
          return () => {
            cancelled = true;
          };
        }
        script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer,drawing&autoload=false`;
        document.head.appendChild(script);
      }

      script.addEventListener('load', loadKakaoPlaces);

      return () => {
        cancelled = true;
        script.removeEventListener('load', loadKakaoPlaces);
      };
    }
  }, [address, categoriesKey, keywordsKey, limit]);

  if (loading) return <div>검색 중입니다...</div>;
  if (error) return <div style={{ color: 'var(--text-muted)' }}>{error}</div>;

  const isSchoolOnly = categoriesKey === 'SC4' && keywords.length === 0;
  const isSubwayOnly = categoriesKey === 'SW8' && keywords.length === 0;

  return (
    <ul style={{ lineHeight: 1.8, paddingLeft: '1.2rem' }}>
      {places.map((p, i) => (
        <li key={i} style={{ marginBottom: '0.5rem' }}>
          {iconFor(p, p.__keyword)}{' '}
          {isSchoolOnly ? (
            <Link
              href={`/school/${encodeURIComponent(p.id)}?name=${encodeURIComponent(p.place_name)}&lat=${p.y}&lng=${p.x}${lawdCd ? `&lawdCd=${encodeURIComponent(lawdCd)}` : ''}`}
              style={{ color: 'var(--text-primary)', textDecoration: 'underline', textDecorationColor: 'var(--border-color)' }}
            >
              <b>{p.place_name}</b>
            </Link>
          ) : (
            <b>{p.place_name}</b>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
            ({p.distance}m, {formatEta(Number(p.distance))})
          </span>
        </li>
      ))}
      {places.length > 0 && isSchoolOnly && places[0].distance < 300 && (
         <li style={{color: 'var(--primary-color)', fontWeight: 600, marginTop: '1rem', listStyle: 'none', marginLeft: '-1.2rem'}}>
           🏆 초품아(학세권) 단지로 교육 환경이 매우 우수합니다.
         </li>
      )}
      {places.length > 0 && isSubwayOnly && places[0].distance < 500 && (
         <li style={{color: 'var(--primary-color)', fontWeight: 600, marginTop: '1rem', listStyle: 'none', marginLeft: '-1.2rem'}}>
           🚗 도보 5분 이내의 초역세권 단지입니다!
         </li>
      )}
    </ul>
  );
}
