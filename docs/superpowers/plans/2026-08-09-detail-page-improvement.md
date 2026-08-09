# 단지 상세페이지 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/app/apt/[name]/apt-client.tsx` 단지 상세페이지의 5가지 문제(공급/전용면적 미표기, 주차대수 세대당 표시 누락, 하단 4개 패널 하드코딩 더미 데이터, 실거래 내역 무한 표, 로그인 버튼 위치 CSS 버그)를 수정한다.

**Architecture:** 면적 변환 로직을 `src/lib/area-utils.ts`로 추출해 4곳(평형 필터/실거래가 정보/타임라인/카드 리스트)에서 재사용한다. `src/app/api/apt/[name]/info/route.ts`의 K-APT 건축물대장 조회 우선순위 버그를 고쳐 세대당 주차대수와 용적률/건폐율/주용도를 항상 채운다. `KakaoPlaces` 컴포넌트를 다중 카테고리 지원으로 확장해 모달뿐 아니라 하단 패널에도 실데이터를 임베드한다. 실거래 내역은 표에서 카드 리스트+페이징으로 전환한다. `Header.module.css`에 CSS 한 줄을 추가해 로그인 버튼 위치를 고친다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, 카카오맵 JS SDK(`window.kakao`). 테스트 프레임워크 없음 — `npm run build` + 로컬 브라우저 수동 확인이 검증 기준.

## Global Constraints

- 공급면적은 정확한 값이 아니라 근사치다 — 표시할 때 항상 "약"을 붙인다(예: "공급 약 34평형").
- "난방 방식" 항목은 신뢰할 수 있는 데이터 소스가 없으므로 UI에 추가하지 않는다(가짜 데이터 유지 금지).
- 기존 API 응답 형태(`/api/apt/[name]`, `/api/apt/[name]/info`)의 필드는 제거하지 않고 확장만 한다 — 기존 필드를 읽는 다른 코드가 깨지지 않아야 한다.
- 별도 브랜치/워크트리 없이 `main`에서 바로 작업한다. 각 태스크 완료 시 로컬 커밋만 하고 push는 하지 않는다.
- `npm run build` 클린 통과가 각 태스크의 필수 검증 기준이다.

---

## Task 1: 면적 변환 헬퍼 추가

**Files:**
- Create: `src/lib/area-utils.ts`

**Interfaces:**
- Produces: `getAreaInfo(exclusiveM2: number): AreaInfo` — Task 2, 6에서 사용. `AreaInfo = { exclusiveM2: number; exclusivePyung: number; supplyPyung: number; label: string }`.

- [ ] **Step 1: 작성**

```ts
// 전용면적(m²)을 받아 전용 평형과 "공급 평형(근사치)"을 함께 계산한다.
//
// MOLIT 실거래 API는 전용면적만 제공하고 공급면적 데이터는 어디서도 얻을 수 없어서,
// 자주 나오는 전용면적 구간은 업계에 잘 알려진 "국민평형" 매핑표를 우선 사용하고,
// 표에 없는 값은 아파트 평균 전용률(약 77%) 공식으로 근사치를 계산한다.
// 두 경우 모두 정확한 값이 아니므로 표시할 때는 항상 "약"을 붙인다.
const KNOWN_SUPPLY_PYUNG: Array<{ min: number; max: number; supplyPyung: number }> = [
  { min: 36, max: 43, supplyPyung: 15 },
  { min: 45, max: 53, supplyPyung: 19 },
  { min: 55, max: 63, supplyPyung: 24 },
  { min: 69, max: 79, supplyPyung: 29 },
  { min: 80, max: 89, supplyPyung: 34 },
  { min: 97, max: 106, supplyPyung: 40 },
  { min: 109, max: 119, supplyPyung: 45 },
  { min: 129, max: 140, supplyPyung: 51 },
  { min: 142, max: 154, supplyPyung: 59 },
];

const AVERAGE_EXCLUSIVE_RATIO = 0.77;
const M2_PER_PYUNG = 3.3058;

export interface AreaInfo {
  exclusiveM2: number;
  exclusivePyung: number;
  supplyPyung: number;
  label: string;
}

export function getAreaInfo(rawExclusiveM2: number): AreaInfo {
  const exclusiveM2 = Math.round(rawExclusiveM2 * 100) / 100;
  const exclusivePyung = Math.round((exclusiveM2 / M2_PER_PYUNG) * 10) / 10;

  const known = KNOWN_SUPPLY_PYUNG.find((r) => exclusiveM2 >= r.min && exclusiveM2 <= r.max);
  const supplyPyung = known
    ? known.supplyPyung
    : Math.round(exclusiveM2 / AVERAGE_EXCLUSIVE_RATIO / M2_PER_PYUNG);

  return {
    exclusiveM2,
    exclusivePyung,
    supplyPyung,
    label: `전용 ${exclusiveM2}㎡(${exclusivePyung}평) · 공급 약 ${supplyPyung}평형`,
  };
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add src/lib/area-utils.ts
git commit -m "feat: 전용/공급 평형 변환 헬퍼 추가"
```

---

## Task 2: 단지 상세페이지에 공급/전용 면적 함께 표기 적용

**Files:**
- Modify: `src/app/apt/[name]/apt-client.tsx`

**Interfaces:**
- Consumes: `getAreaInfo`(Task 1)

- [ ] **Step 1: import 추가**

파일 최상단 import 블록(9~10번째 줄 부근)에 추가:

```tsx
import KakaoPlaces from '@/components/KakaoPlaces';
import { getAreaInfo } from '@/lib/area-utils';
```

(`import KakaoPlaces from '@/components/KakaoPlaces';`는 기존 줄 — 바로 아래에 새 import를 추가하는 것)

- [ ] **Step 2: 평형 필터 버튼 라벨 수정**

현재:
```tsx
              {Array.from(new Set(trades.map(t => t.area))).sort((a, b) => parseFloat(a) - parseFloat(b)).map(area => {
                const pyung = Math.round(parseFloat(area) / 3.3058);
                return (
                  <button 
                    key={area}
                    onClick={() => setSelectedArea(area)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '4px', fontWeight: 600, border: '1px solid', cursor: 'pointer',
                      backgroundColor: selectedArea === area ? 'var(--primary-color)' : 'white',
                      color: selectedArea === area ? 'white' : 'var(--text-secondary)',
                      borderColor: selectedArea === area ? 'var(--primary-color)' : 'var(--border-color)'
                    }}
                  >
                    {area} <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>({pyung}평)</span>
                  </button>
                );
              })}
```

다음으로 교체:
```tsx
              {Array.from(new Set(trades.map(t => t.area))).sort((a, b) => parseFloat(a) - parseFloat(b)).map(area => {
                const { supplyPyung } = getAreaInfo(parseFloat(area));
                return (
                  <button 
                    key={area}
                    onClick={() => setSelectedArea(area)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '4px', fontWeight: 600, border: '1px solid', cursor: 'pointer',
                      backgroundColor: selectedArea === area ? 'var(--primary-color)' : 'white',
                      color: selectedArea === area ? 'white' : 'var(--text-secondary)',
                      borderColor: selectedArea === area ? 'var(--primary-color)' : 'var(--border-color)'
                    }}
                  >
                    {area}㎡ <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>(공급 약 {supplyPyung}평)</span>
                  </button>
                );
              })}
```

- [ ] **Step 3: 최근 실거래가 정보 라인 수정**

현재:
```tsx
                  {trades.length > 0 && (
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      ({trades[0].area} • {trades[0].floor}층 • {trades[0].tradeDate})
                    </span>
                  )}
```

다음으로 교체:
```tsx
                  {trades.length > 0 && (
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      ({getAreaInfo(parseFloat(trades[0].area)).label} • {trades[0].floor}층 • {trades[0].tradeDate})
                    </span>
                  )}
```

- [ ] **Step 4: 타임라인 아이템 수정**

현재:
```tsx
              filteredTrades.map((trade, index) => {
                const pyung = Math.round(parseFloat(trade.area) / 3.3058);
                const prevTrade = filteredTrades[index + 1];
```

다음으로 교체:
```tsx
              filteredTrades.map((trade, index) => {
                const areaInfo = getAreaInfo(parseFloat(trade.area));
                const prevTrade = filteredTrades[index + 1];
```

같은 함수 안, 현재:
```tsx
                      <div className={styles.timelineInfo}>{trade.area} ({pyung}평) • {trade.floor}층 • {trade.tradeType.replace('아파트 ', '')}</div>
```

다음으로 교체:
```tsx
                      <div className={styles.timelineInfo}>{areaInfo.label} • {trade.floor}층 • {trade.tradeType.replace('아파트 ', '')}</div>
```

- [ ] **Step 5: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 6: Commit**

```bash
git add src/app/apt/[name]/apt-client.tsx
git commit -m "feat: 평형 필터/실거래가 정보/타임라인에 공급·전용 면적 함께 표기"
```

---

## Task 3: 주차대수(세대당) 표시 복구 + 용적률/건폐율/주용도 확보

**Files:**
- Modify: `src/app/api/apt/[name]/info/route.ts`

- [ ] **Step 1: K-APT 조회 블록 교체**

현재(52~115번째 줄 부근, `// 2. 주차대수가 없으면...` 주석부터 해당 `if` 블록 끝까지):
```ts
    // 2. 주차대수가 없으면 K-APT(공동주택 기본정보 API) 또는 건축물대장 API를 모방한 공공데이터 호출 시도
    // Vercel 배포 환경에서는 공공데이터 API 키 문제로 막힐 수 있으므로 안전하게 감싸기
    if (!info['총주차대수'] && API_KEY && lawdCd && dong) {
      try {
        // 법정동 코드 조회 (법정동명 기준 10자리 코드)
        const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`);
        const regData = await regRes.json();
        let fullLawdCd = lawdCd + '10100'; // fallback
        
        if (regData.regcodes) {
          const match = regData.regcodes.find((r: any) => (r.name || '').includes(dong) && r.code.startsWith(lawdCd));
          if (match) fullLawdCd = match.code;
        }

        const bjdongCd = fullLawdCd.substring(5, 10);
        const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));

        let bldUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&numOfRows=100`;
        
        // 지번 파싱
        const jibun = searchParams.get('jibun') || '';
        if (jibun) {
          const parts = jibun.split('-');
          const bunNum = parseInt(parts[0], 10);
          const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          if (!isNaN(bunNum)) {
            const bun = bunNum.toString().padStart(4, '0');
            const ji = jiNum.toString().padStart(4, '0');
            bldUrl += `&platGbCd=0&bun=${bun}&ji=${ji}`;
          }
        }

        const bldRes = await fetch(bldUrl, { signal: AbortSignal.timeout(3000) });
        if (bldRes.ok) {
          const xmlData = await bldRes.text();
          const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
          const jsonObj = parser.parse(xmlData);
          const items = jsonObj.response?.body?.items?.item;
          if (items) {
            const itemsArr = Array.isArray(items) ? items : [items];
            // 단지명과 가장 유사한 항목 찾기
            const aptCleanName = aptName.replace(/\s+/g, '').replace(/아파트$/, '');
            const target = itemsArr.find((it: any) => {
              const bldNm = (it.bldNm || '').replace(/\s+/g, '');
              return bldNm.includes(aptCleanName) || aptCleanName.includes(bldNm);
            }) || itemsArr[0]; // 못찾으면 첫번째거라도 (대표 번지)
            
            const parkingCnt = target ? parseInt(target.totPkngCnt, 10) : NaN;
            if (target && !isNaN(parkingCnt) && parkingCnt > 0) {
              info['총주차대수'] = `${target.totPkngCnt}대`;
              // 세대당 주차대수 계산
              if (info['세대수']) {
                const totalH = parseInt(info['세대수'].replace(/,/g, ''), 10);
                if (totalH > 0) {
                  const perH = (parseInt(target.totPkngCnt, 10) / totalH).toFixed(2);
                  info['총주차대수'] = `${target.totPkngCnt}대 (세대당 ${perH}대)`;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('Public API building registry failed', e);
      }
    }
```

다음으로 교체:
```ts
    // 2. K-APT(건축물대장 표제부) 공공데이터 호출 — 주차대수(세대당 포함), 용적률, 건폐율, 주용도를 가져온다.
    // 이전에는 네이버 스크래핑이 총주차대수를 먼저 채우면 이 블록 전체가 스킵되어 세대당
    // 계산이 누락되는 버그가 있었다. 네이버 결과 존재 여부와 무관하게 항상 조회하고, 성공하면
    // 더 상세한 이 결과로 덮어쓴다. Vercel 배포 환경에서는 공공데이터 API 키 문제로 막힐 수
    // 있으므로 안전하게 감싼다.
    if (API_KEY && lawdCd && dong) {
      try {
        // 법정동 코드 조회 (법정동명 기준 10자리 코드)
        const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?is_ignore_zero=true`);
        const regData = await regRes.json();
        let fullLawdCd = lawdCd + '10100'; // fallback
        
        if (regData.regcodes) {
          const match = regData.regcodes.find((r: any) => (r.name || '').includes(dong) && r.code.startsWith(lawdCd));
          if (match) fullLawdCd = match.code;
        }

        const bjdongCd = fullLawdCd.substring(5, 10);
        const cleanKey = encodeURIComponent(decodeURIComponent(API_KEY.trim().replace(/['"]/g, '')));

        let bldUrl = `http://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?serviceKey=${cleanKey}&sigunguCd=${lawdCd}&bjdongCd=${bjdongCd}&numOfRows=100`;
        
        // 지번 파싱
        const jibun = searchParams.get('jibun') || '';
        if (jibun) {
          const parts = jibun.split('-');
          const bunNum = parseInt(parts[0], 10);
          const jiNum = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          if (!isNaN(bunNum)) {
            const bun = bunNum.toString().padStart(4, '0');
            const ji = jiNum.toString().padStart(4, '0');
            bldUrl += `&platGbCd=0&bun=${bun}&ji=${ji}`;
          }
        }

        const bldRes = await fetch(bldUrl, { signal: AbortSignal.timeout(3000) });
        if (bldRes.ok) {
          const xmlData = await bldRes.text();
          const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
          const jsonObj = parser.parse(xmlData);
          const items = jsonObj.response?.body?.items?.item;
          if (items) {
            const itemsArr = Array.isArray(items) ? items : [items];
            // 단지명과 가장 유사한 항목 찾기
            const aptCleanName = aptName.replace(/\s+/g, '').replace(/아파트$/, '');
            const target = itemsArr.find((it: any) => {
              const bldNm = (it.bldNm || '').replace(/\s+/g, '');
              return bldNm.includes(aptCleanName) || aptCleanName.includes(bldNm);
            }) || itemsArr[0]; // 못찾으면 첫번째거라도 (대표 번지)

            if (target) {
              const parkingCnt = parseInt(target.totPkngCnt, 10);
              if (!isNaN(parkingCnt) && parkingCnt > 0) {
                info['총주차대수'] = `${target.totPkngCnt}대`;
                // 세대당 주차대수 계산
                if (info['세대수']) {
                  const totalH = parseInt(info['세대수'].replace(/,/g, ''), 10);
                  if (totalH > 0) {
                    const perH = (parseInt(target.totPkngCnt, 10) / totalH).toFixed(2);
                    info['총주차대수'] = `${target.totPkngCnt}대 (세대당 ${perH}대)`;
                  }
                }
              }

              const vlRat = parseFloat(target.vlRat);
              if (!isNaN(vlRat) && vlRat > 0) info['용적률'] = `${vlRat}%`;

              const bcRat = parseFloat(target.bcRat);
              if (!isNaN(bcRat) && bcRat > 0) info['건폐율'] = `${bcRat}%`;

              if (target.mainPurpsCdNm) info['주용도'] = target.mainPurpsCdNm;
            }
          }
        }
      } catch (e) {
        console.warn('Public API building registry failed', e);
      }
    }
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → 단지 상세페이지 아무 단지나 접속(예: `http://localhost:3000/apt/특정단지명?lawdCd=11680&dong=특정동`) → "단지정보" 퀵버튼 클릭 → 총주차대수에 "(세대당 X.XX대)"가 붙어 나오는지 확인, 용적률/건폐율/주용도 행이 추가로 보이는지 확인. dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/apt/[name]/info/route.ts"
git commit -m "fix: K-APT 건축물대장 조회 우선순위 버그 수정 - 세대당 주차대수 복구, 용적률·건폐율·주용도 추가"
```

---

## Task 4: KakaoPlaces 다중 카테고리 지원으로 확장

**Files:**
- Modify: `src/components/KakaoPlaces.tsx` (전체 재작성)
- Modify: `src/app/apt/[name]/apt-client.tsx` (모달 호출부 마이그레이션)

**Interfaces:**
- Produces: `<KakaoPlaces address={string} categories={string[]} limit?={number} />` — Task 5에서 하단 패널에 사용.

- [ ] **Step 1: `src/components/KakaoPlaces.tsx` 전체 교체**

```tsx
import React, { useEffect, useState } from 'react';

interface Props {
  address: string;
  // 카카오 로컬 카테고리 코드. 여러 개를 넘기면 각각 검색 후 거리순으로 병합한다.
  // 예: SC4(학교), SW8(지하철), HP8(병원), MT1(대형마트)
  categories: string[];
  limit?: number;
}

const CATEGORY_ICON: Record<string, string> = {
  SC4: '🏫',
  SW8: '🚇',
  HP8: '🏥',
  MT1: '🛒',
};

export default function KakaoPlaces({ address, categories, limit = 5 }: Props) {
  const [places, setPlaces] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const categoriesKey = categories.join(',');

  useEffect(() => {
    const renderPlaces = () => {
      const geocoder = new window.kakao.maps.services.Geocoder();
      const ps = new window.kakao.maps.services.Places();

      const searchOneCategory = (category: string, coords: any) =>
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

      const searchPlaces = async (coords: any) => {
        const resultsByCategory = await Promise.all(
          categories.map((c) => searchOneCategory(c, coords))
        );
        const merged = resultsByCategory.flat().sort((a, b) => Number(a.distance) - Number(b.distance));

        if (merged.length === 0) {
          setError('주변에 해당 인프라가 없습니다.');
        } else {
          setPlaces(merged.slice(0, limit));
        }
        setLoading(false);
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
  }, [address, categoriesKey, limit]);

  if (loading) return <div>검색 중입니다...</div>;
  if (error) return <div style={{ color: 'var(--text-muted)' }}>{error}</div>;

  const isSchoolOnly = categoriesKey === 'SC4';
  const isSubwayOnly = categoriesKey === 'SW8';

  return (
    <ul style={{ lineHeight: 1.8, paddingLeft: '1.2rem' }}>
      {places.map((p, i) => (
        <li key={i} style={{ marginBottom: '0.5rem' }}>
          {CATEGORY_ICON[p.category_group_code] || '📍'} <b>{p.place_name}</b> 
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
            ({p.distance}m, 도보 약 {Math.ceil(p.distance / 80)}분)
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
```

(`categoriesKey`를 의존성 배열에 사용하는 이유: 호출부가 `categories={['SC4']}`처럼 매 렌더마다 새 배열을 넘기면 `categories` 배열 자체를 의존성으로 쓸 때 매번 effect가 재실행된다 — 문자열로 직렬화해 안정된 의존성 값을 만든다.)

- [ ] **Step 2: 모달 호출부 마이그레이션**

`src/app/apt/[name]/apt-client.tsx`에서 현재:
```tsx
      case '학군':
        return (
          <div style={{height: '100%'}}>
            <p style={{marginBottom: '1rem', fontWeight: 600}}>🏫 반경 1.5km 이내 학교 정보 (거리순)</p>
            <KakaoPlaces address={primaryAddress} category="SC4" />
          </div>
        );
      case '교통':
        return (
          <div style={{height: '100%'}}>
            <p style={{marginBottom: '1rem', fontWeight: 600}}>🚇 반경 1.5km 이내 지하철역 정보 (거리순)</p>
            <KakaoPlaces address={primaryAddress} category="SW8" />
          </div>
        );
```

다음으로 교체:
```tsx
      case '학군':
        return (
          <div style={{height: '100%'}}>
            <p style={{marginBottom: '1rem', fontWeight: 600}}>🏫 반경 1.5km 이내 학교 정보 (거리순)</p>
            <KakaoPlaces address={primaryAddress} categories={['SC4']} />
          </div>
        );
      case '교통':
        return (
          <div style={{height: '100%'}}>
            <p style={{marginBottom: '1rem', fontWeight: 600}}>🚇 반경 1.5km 이내 지하철역 정보 (거리순)</p>
            <KakaoPlaces address={primaryAddress} categories={['SW8']} />
          </div>
        );
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 4: 수동 스모크 테스트**

Run: `npm run dev` → 단지 상세페이지 진입 → "학군", "교통" 퀵버튼 클릭 → 기존과 동일하게 실제 학교/지하철역 목록이 뜨는지 확인(회귀 없음). dev 서버 종료.

- [ ] **Step 5: Commit**

```bash
git add src/components/KakaoPlaces.tsx "src/app/apt/[name]/apt-client.tsx"
git commit -m "refactor: KakaoPlaces 다중 카테고리 병합 검색 지원으로 확장"
```

---

## Task 5: 하단 4개 패널(학군/교통/편의시설/단지상세) 실데이터 연동

**Files:**
- Modify: `src/app/apt/[name]/apt-client.tsx`

**Interfaces:**
- Consumes: `<KakaoPlaces address categories limit />`(Task 4), `aptInfo['용적률']`/`aptInfo['건폐율']`/`aptInfo['주용도']`(Task 3에서 API가 채움)

- [ ] **Step 1: `primaryAddress`를 컴포넌트 최상위로 끌어올리기**

현재:
```tsx
  const latestPrice = filteredTrades.length > 0 ? filteredTrades[0].priceStr : (trades.length > 0 ? trades[0].priceStr : '조회 중...');
  const latestPriceNum = filteredTrades.length > 0 ? filteredTrades[0].price : 0; // 억 단위 정수

  const openModal = (modalName: string) => {
```

다음으로 교체:
```tsx
  const latestPrice = filteredTrades.length > 0 ? filteredTrades[0].priceStr : (trades.length > 0 ? trades[0].priceStr : '조회 중...');
  const latestPriceNum = filteredTrades.length > 0 ? filteredTrades[0].price : 0; // 억 단위 정수

  const firstTrade = trades.length > 0 ? trades[0] : null;
  const primaryAddress = `${regionName || firstTrade?.dong || ''} ${aptName}`.trim();

  const openModal = (modalName: string) => {
```

- [ ] **Step 2: `renderModalContent` 내부의 중복 선언 제거**

현재:
```tsx
  const renderModalContent = () => {
    const firstTrade = trades.length > 0 ? trades[0] : null;
    const primaryAddress = `${regionName || firstTrade?.dong || ''} ${aptName}`.trim();
    const jibunAddress = firstTrade?.dong && firstTrade?.jibun 
      ? `${regionName || firstTrade.dong} ${firstTrade.jibun}` 
      : undefined;
    
    switch (activeModal) {
```

다음으로 교체(Step 1에서 끌어올린 `firstTrade`/`primaryAddress`를 그대로 사용):
```tsx
  const renderModalContent = () => {
    const jibunAddress = firstTrade?.dong && firstTrade?.jibun 
      ? `${regionName || firstTrade.dong} ${firstTrade.jibun}` 
      : undefined;
    
    switch (activeModal) {
```

- [ ] **Step 3: 하단 4개 패널을 실데이터로 교체**

현재:
```tsx
      <div className="container" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>단지 입지 분석</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🎓 학군 정보</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• {regionName} 송도초등학교 (도보 8분)</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• {regionName} 암남중학교 (도보 12분)</p>
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🚇 교통 정보</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 1호선 자갈치역 (버스 10분)</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 남항대교 진입 용이</p>
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏥 편의 시설</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 고신대학교복음병원 (도보 5분)</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 송도해수욕장 (도보 3분)</p>
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏢 단지 상세</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 용적률: 868% / 건폐율: 48%</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 난방: 개별난방, 도시가스</p>
          </div>
        </div>
```

다음으로 교체:
```tsx
      <div className="container" style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>단지 입지 분석</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🎓 학군 정보</h3>
            {primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['SC4']} limit={2} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🚇 교통 정보</h3>
            {primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['SW8']} limit={2} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏥 편의 시설</h3>
            {primaryAddress ? (
              <KakaoPlaces address={primaryAddress} categories={['HP8', 'MT1']} limit={3} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
            )}
          </div>
          <div className={styles.panel} style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏢 단지 상세</h3>
            {(aptInfo?.['용적률'] || aptInfo?.['건폐율']) ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                • 용적률: {aptInfo?.['용적률'] || '정보 없음'} / 건폐율: {aptInfo?.['건폐율'] || '정보 없음'}
              </p>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>용적률/건폐율 정보 없음</p>
            )}
            {aptInfo?.['주용도'] && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>• 주용도: {aptInfo['주용도']}</p>
            )}
          </div>
        </div>
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 5: 수동 스모크 테스트**

Run: `npm run dev` → 서로 다른 지역의 단지 상세페이지 2곳 접속 → 학군/교통/편의시설 패널이 (1) 지역마다 다른 실제 장소명으로 뜨는지, (2) 더 이상 "송도초등학교"/"자갈치역" 같은 고정 텍스트가 보이지 않는지 확인. 단지상세 패널은 Task 3에서 확인한 단지에서 실제 용적률/건폐율이 보이는지 확인. dev 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add "src/app/apt/[name]/apt-client.tsx"
git commit -m "fix: 하단 학군/교통/편의시설/단지상세 패널을 하드코딩 더미 데이터에서 실데이터로 교체"
```

---

## Task 6: 실거래 내역 카드형 리스트 + 15개씩 페이징

**Files:**
- Modify: `src/app/apt/[name]/apt-client.tsx`

**Interfaces:**
- Consumes: `getAreaInfo`(Task 1)

- [ ] **Step 1: `visibleCount` state 추가**

현재:
```tsx
  const [selectedArea, setSelectedArea] = useState<string>('전체');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'매매' | '전월세'>('매매');
  const [periodFilter, setPeriodFilter] = useState<'1년' | '3년' | '5년' | '전체'>('1년');
  const [onlySales, setOnlySales] = useState<boolean>(true);
```

다음으로 교체:
```tsx
  const [selectedArea, setSelectedArea] = useState<string>('전체');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'매매' | '전월세'>('매매');
  const [periodFilter, setPeriodFilter] = useState<'1년' | '3년' | '5년' | '전체'>('1년');
  const [onlySales, setOnlySales] = useState<boolean>(true);
  const [visibleCount, setVisibleCount] = useState<number>(15);
```

- [ ] **Step 2: 필터 변경 시 15개로 리셋하는 effect 추가**

현재:
```tsx
  useEffect(() => {
    if (tradeTypeFilter === '전월세') {
      setOnlySales(false);
    }
  }, [tradeTypeFilter]);
```

다음으로 교체:
```tsx
  useEffect(() => {
    if (tradeTypeFilter === '전월세') {
      setOnlySales(false);
    }
  }, [tradeTypeFilter]);

  useEffect(() => {
    setVisibleCount(15);
  }, [selectedArea, tradeTypeFilter, periodFilter, onlySales]);
```

- [ ] **Step 3: 하단 표를 카드형 리스트 + 페이징으로 교체**

현재:
```tsx
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>전체 실거래 내역 ({selectedArea})</h2>
        <div className={styles.panel} style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ backgroundColor: 'var(--bg-color)' }}>
              <tr>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>계약일</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>유형</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>금액</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>층</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((t) => (
                <tr key={`table-${t.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '1rem' }}>{t.tradeDate}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: t.tradeType.includes('매매') || t.tradeType === '실거래' ? '#e0e7ff' : '#dcfce3', color: t.tradeType.includes('매매') || t.tradeType === '실거래' ? '#3b82f6' : '#10b981' }}>
                      {t.tradeType.replace('아파트 ', '')}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: 600 }}>{t.priceStr}</td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{t.floor}층</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
```

다음으로 교체:
```tsx
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>전체 실거래 내역 ({selectedArea})</h2>
        <div className={styles.panel} style={{ padding: 0, overflow: 'hidden' }}>
          {filteredTrades.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>거래 내역이 없습니다.</div>
          ) : (
            <>
              {filteredTrades.slice(0, visibleCount).map((t) => {
                const areaInfo = getAreaInfo(parseFloat(t.area));
                const isSale = t.tradeType.includes('매매') || t.tradeType === '실거래';
                return (
                  <div key={`card-${t.id}`} style={{ padding: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <span style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: isSale ? '#e0e7ff' : '#dcfce3', color: isSale ? '#3b82f6' : '#10b981' }}>
                        {t.tradeType.replace('아파트 ', '')}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t.tradeDate}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {areaInfo.label} · <b>{t.priceStr}</b> · {t.floor}층
                    </div>
                  </div>
                );
              })}
              {filteredTrades.length > visibleCount && (
                <div style={{ padding: '1rem', textAlign: 'center' }}>
                  <button
                    onClick={() => setVisibleCount((v) => v + 15)}
                    style={{ padding: '0.6rem 1.5rem', borderRadius: '999px', border: '1px solid var(--border-color)', background: 'white', fontWeight: 600, cursor: 'pointer' }}
                  >
                    더보기 ({filteredTrades.length - visibleCount}건 더 있음)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 5: 수동 스모크 테스트**

Run: `npm run dev` → 거래 내역이 15건 넘는 단지의 상세페이지 접속 → 카드 15개만 보이고 "더보기" 버튼이 뜨는지, 클릭 시 15개씩 더 로드되는지 확인. 평형 필터를 바꿔서 목록이 다시 15개로 리셋되는지 확인. dev 서버 종료.

- [ ] **Step 6: Commit**

```bash
git add "src/app/apt/[name]/apt-client.tsx"
git commit -m "feat: 전체 실거래 내역을 카드형 리스트로 전환, 15개씩 페이징+더보기 추가"
```

---

## Task 7: 로그인 버튼 우측 상단 고정 (Header CSS 버그 수정)

**Files:**
- Modify: `src/components/Header.module.css`

- [ ] **Step 1: `.menuList`에 `margin-left: auto` 추가**

현재(80~85번째 줄 부근):
```css
.menuList {
  display: flex;
  align-items: center;
  gap: 2rem;
  flex-shrink: 0;
}
```

다음으로 교체:
```css
.menuList {
  display: flex;
  align-items: center;
  gap: 2rem;
  flex-shrink: 0;
  /* searchSlot/pageTitle 없이 Header를 쓰는 페이지(예: 단지 상세페이지)에서는 이 요소 앞에
     flex:1로 남는 공간을 채우는 형제 요소가 없어, 메뉴+로그인 버튼이 로고 바로 옆에 붙어버리는
     문제가 있었다. margin-left:auto로 메뉴+로그인 버튼 그룹을 항상 우측 끝에 붙인다.
     searchSlot/pageTitle이 있는 페이지는 이미 그쪽이 flex:1로 남는 공간을 다 차지하므로
     이 margin이 추가로 가져갈 공간이 없어 시각적 차이가 없다. */
  margin-left: auto;
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: 에러 0건

- [ ] **Step 3: 수동 스모크 테스트**

Run: `npm run dev` → 데스크톱 폭(900px 초과)에서 다음 두 페이지를 비교:
1. 단지 상세페이지(`/apt/...`, `searchSlot`/`pageTitle` 없음) — 로그인 버튼이 헤더 우측 끝에 붙어있는지 확인(수정 전에는 메뉴 바로 옆에 붙어있었음).
2. 홈(`/`) 또는 `/stats`(`searchSlot`/`pageTitle` 있음) — 기존과 동일하게 우측 끝에 그대로 있는지 확인(회귀 없음).
모바일 폭(900px 이하)에서도 하단 탭바가 정상 동작하는지 확인. dev 서버 종료.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.module.css
git commit -m "fix: searchSlot/pageTitle 없는 페이지에서 로그인 버튼이 우측 끝에 붙지 않던 CSS 버그 수정"
```

---

## Task 8: 최종 클린 빌드 및 통합 확인

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 클린 빌드**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: 통합 수동 확인**

Run: `npm run dev` → 단지 상세페이지에서 5개 항목을 한 번에 순서대로 확인:
1. 평형 필터 버튼/실거래가 정보/타임라인/카드 리스트에 "전용 OO㎡ · 공급 약 OO평형" 형태가 일관되게 보이는지
2. "단지정보" 모달과 상단 태그에 "세대당 X.XX대"가 뜨는지
3. 학군/교통/편의시설/단지상세 4개 패널이 실제 지역 데이터로 뜨는지 (서로 다른 지역 단지 2곳)
4. 실거래 내역이 15개 단위로 페이징되고 [더보기]가 정상 동작하는지
5. 데스크톱 폭에서 로그인 버튼이 우측 상단 끝에 붙어있는지
그리고 거래 내역이 없는 단지(신규 분양 등)로 한 번 더 접속해 각 패널의 "정보 없음"/에러 처리가 깨지지 않는지 확인. dev 서버 종료.

- [ ] **Step 4: git 상태 확인**

Run: `git status`
Expected: 커밋되지 않은 변경 없음.

(이번 작업은 아직 push하지 않는다 — 남은 하위 프로젝트들과 함께 사용자가 지정하는 시점에 push한다.)
