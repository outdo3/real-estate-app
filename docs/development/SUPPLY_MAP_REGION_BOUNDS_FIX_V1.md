# SUPPLY MAP REGION BOUNDS FIX V1

**상태: 구현 완료 / STRUCTURAL PASS · DEVICE QA REQUIRED / DB·schema·migration 0건 / Production write 0건**

작성일 2026-09-12 · branch `main` · 기준 HEAD `a7031a5`

---

## 1. 목적

통계 → 공급(입주지도)에서 **지역 선택과 지도 viewport를 일치**시킨다.

보고된 증상:
- 지역 선택 = 부산광역시
- 목록 = 기장군·강서구·동래구 등 부산 전역
- 지도 = 부산 전체가 아니라 **기장/울산 경계 부근으로 치우쳐** 표시

즉 목록의 지역 범위와 지도 viewport가 불일치했다.

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              a7031a5  docs(stats): record the production measurement for the 12-month Busan feed
tracked dirty     package.json, package-lock.json   (사용자 작업물 — 건드리지 않음)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용. untracked 사용자 작업물
전부 보존. DB는 SELECT만, write 0회. 좌표 추정·생성 0건.

---

## 3. 감사 — root cause

### 3.1 문제의 한 줄

`src/components/stats/SupplyView.tsx` (변경 전 160행):

```tsx
<KakaoMap.Map
  center={{ lat: data.mapMarkers[0].lat, lng: data.mapMarkers[0].lng }}
  level={nationwide ? 13 : 8}
>
```

두 가지가 동시에 틀렸다.

1. **center = `mapMarkers[0]`** — "첫 번째 마커"다. 그 배열은 서버가 만든 순서 그대로이고,
   `/api/stats/supply`의 `prisma.presale.findMany`에는 **`orderBy`가 없다**(목록만 별도로
   `moveInExpectedYm` 정렬한다). 즉 첫 원소는 사실상 **id가 가장 작은 아무 단지**다.
2. **zoom 고정** — 좌표가 얼마나 퍼져 있든 `level`이 상수였다. `fitBounds`/`setBounds`가
   코드 어디에도 없었다(`grep LatLngBounds|setBounds|fitBounds` 결과: 이 화면 0건,
   `presales/[id]/presale-nearby-map.tsx`만 1건).

### 3.2 실측으로 확인한 증상의 크기

production 읽기 전용 조회(2026-09-12, 부산 · 향후 2년):

```
부산 presale 85건 → 기간 스코프 34건 → 좌표 있는 26건

mapMarkers[0] = id 47  부산 장안지구 B-2블록 중흥S-클래스(기장군)
                35.32036, 129.24011          ← 부산 북동 끝(울산 접경)

실제 좌표 bounds  lat 35.09287 ~ 35.32036   (span 0.22749)
                 lng 128.93527 ~ 129.24012  (span 0.30485)
bounds 중심       35.20661, 129.08769        ← 부산 중앙

편차: 위도 0.114도 / 경도 0.152도
```

`level = 8`은 구 단위 축척이다. 부산 전역(약 25km × 28km)을 340px 높이 지도에 담을 수
없는 값이므로, 화면은 **북동 모서리 한 조각**만 보여주고 있었다. 목록 데이터는 정상이었다
— 데이터 문제가 아니라 viewport 계산 문제다.

### 3.3 함께 확인한 것들

| 항목 | 감사 결과 |
|---|---|
| 좌표 null 처리 | 서버가 `latitude != null && longitude != null`만 검사. finite/범위/`0,0` 검사 없음 |
| 무효 좌표 실측 | 부산 26건 중 위반 **0건**, 부산 bbox 밖 **0건**(현재 데이터는 깨끗하다) |
| 좌표 null 건수 | 전체 presale 1,046건 중 318건이 좌표 null — 이미 목록에 "위치 미확인"으로 정직하게 표시됨 |
| previous viewport reuse | SWR 키에 지역·시군구·기간이 모두 들어가고 `keepPreviousData`를 쓰지 않아 **stale 응답이 새 선택을 덮는 경로는 없었다** |
| list/map parity | 목록·지도·추이가 모두 **한 번의 fetch** 결과에서 나온다(지도 전용 요청 없음) — 이미 정상 |
| 동일 좌표 중복 | **있다.** 조합원 취소분이 본 사업지와 완전히 같은 좌표를 갖는다(동래 롯데캐슬 시그니처 id 127/576, 더샵 금정위버시티 id 428/694) |

마지막 항목이 중요하다. 금정구를 고르면 마커가 2개인데 **좌표가 완전히 같다** — 그대로
`setBounds`에 넣으면 폭·높이가 0인 bounds가 되어 지도가 최대 배율로 튄다. 개수가 아니라
**퍼짐**으로 판정해야 한다.

---

## 4. 수정 내용

### 4.1 신규 — `src/lib/stats/supply-map-bounds.ts` (순수 로직)

Kakao SDK도 DOM도 import하지 않는다(지도 없이 테스트 가능).

```ts
isValidSupplyCoord(lat, lng)      // number · finite · 범위 · (0,0) sentinel 제외
validSupplyPoints(markers)        // 지도 계산용 좌표만 추출(목록 데이터는 무변경)
resolveSupplyViewport(points)     // → { kind: 'bounds' | 'center' | 'none' }
supplyViewportKey(scope, points)  // 지역·기간·좌표 집합 식별 키
SUPPLY_MAP_BOUNDS_PADDING = 48
SUPPLY_SINGLE_POINT_LEVEL = 5
```

판정 규칙:

| 입력 | viewport |
|---|---|
| 서로 다른 좌표 2개 이상 | `bounds` — 모든 점 + bbox + bbox 중심 |
| 서로 다른 좌표 1개(같은 좌표 여러 개 포함) | `center` — 그 지점 + level 5 |
| 유효 좌표 0개 | `none` — center도 level도 없음 |

`none`에 좌표 필드를 아예 두지 않아 호출부가 실수로 "없는 위치"를 읽을 수 없다.

### 4.2 `src/components/stats/SupplyView.tsx`

```tsx
const mapPoints = useMemo(() => validSupplyPoints(data?.mapMarkers ?? []), [data]);
const viewport  = useMemo(() => resolveSupplyViewport(mapPoints), [mapPoints]);
const fitKey    = supplyViewportKey(`${scopeKey}|${period}`, mapPoints);

useEffect(() => {
  if (!mapInstance || !window.kakao?.maps) return;
  if (viewport.kind === 'bounds') {
    const bounds = new window.kakao.maps.LatLngBounds();
    for (const point of viewport.points) bounds.extend(new window.kakao.maps.LatLng(point.lat, point.lng));
    mapInstance.setBounds(bounds, SUPPLY_MAP_BOUNDS_PADDING);
  } else if (viewport.kind === 'center') {
    mapInstance.setCenter(new window.kakao.maps.LatLng(viewport.center.lat, viewport.center.lng));
    mapInstance.setLevel(viewport.level);
  }
}, [mapInstance, viewport, fitKey]);
```

- `onCreate={setMapInstance}`로 지도 인스턴스를 잡는다 — `presale-nearby-map.tsx`가 이미
  쓰는 것과 **같은 패턴**(새 방식을 발명하지 않았다).
- `center={viewport.center}`: bounds 경로에서도 첫 프레임이 모서리가 아니라 **bounds 중심**이다.
  `level`은 첫 프레임용 초기값일 뿐이고 `setBounds`가 즉시 덮어쓴다(시도 초기값 9는
  `RegionChangeMapView`의 sido level 9 관례를 따랐다).
- 마커 렌더도 `isValidSupplyCoord`로 걸러 무효 좌표를 엉뚱한 위치에 찍지 않는다.
- 요약 문구의 "위치 확인 N개"를 `mapPoints.length`로 바꿨다 — 화면이 말하는 수와 실제로
  찍히는 마커 수가 항상 같다(현재 데이터에서는 기존 `summary.mapCount`와 동일한 값이다).
- 지역/기간 변경 시 `selectedMarkerId`를 초기화한다(새 결과에 없는 단지 카드가 남지 않음).

### 4.3 §4 REGION CANONICAL FALLBACK — 채택하지 않은 이유

브리프는 좌표 0개일 때 "부산 canonical center 사용 **가능**" 또는 "truthful empty state
검토"를 허용했다. **후자를 택했다.**

기존 화면에 이미 정직한 빈 상태가 있고("위치가 확인된 단지가 없어요 / 아래 목록에서 전체
단지를 볼 수 있어요"), 그 편이 더 정확하다 — 표시할 단지가 하나도 없는데 지도를 펼쳐
보여주면 사용자는 "이 지역에 뭔가 있다"고 읽는다. 새 좌표 상수를 코드에 넣지 않았고
(테스트가 이 모듈에 위경도 리터럴이 없음을 고정한다), 다른 단지·다른 지역 좌표로 메우는
경로도 만들지 않았다.

---

## 5. 기대 동작 대조

| 케이스 | 변경 전 | 변경 후 |
|---|---|---|
| 부산광역시 전체 (26개 좌표) | center = 기장군 장안지구(북동 끝), level 8 고정 → 부산 대부분 화면 밖 | 26개 좌표 전체를 감싸는 `setBounds` + 48px 여백 → 부산 전역이 들어온다 |
| 구/군 선택 (예: 부산진구 4건) | center = 그 구 첫 마커, level 8 고정 | 그 구 좌표만으로 bounds(시도 bounds의 1/10 미만 면적) |
| 단일 좌표 | center는 맞지만 zoom은 여전히 8 | 그 지점 center + level 5 |
| 같은 좌표만 여러 개 (금정구) | center 맞음, level 8 | degenerate bounds를 피해 `center` 경로로 처리 |
| 유효 좌표 0개 | 지도 미표시(기존 정직한 빈 상태) | 동일 + 무효 좌표만 있는 경우까지 포함 |
| 전국 토글 | center = 전국 첫 마커, level 13 고정 | 전국 좌표 전체 bounds |

---

## 6. 테스트

`src/lib/stats/supply-map-bounds.test.ts` — **20 tests, 전부 pass.**
좌표는 추정치가 아니라 위 §3.2 production 실측값을 쓴다.

브리프 §9의 최소 9항목 대응:

| # | 요구 | 테스트 |
|---|---|---|
| 1 | Busan-wide multiple points → bounds | 실측 26점의 bbox·center가 실측값과 일치, 모든 점이 bounds 안 |
| 2 | district multiple points → district bounds | 부산진구 4점 bounds가 시도 bounds 면적의 1/10 미만, 타 구 좌표 미포함 |
| 3 | one point → center | center + level 5, presale 지도 관례와 동일 |
| 4 | zero points → no wrong fallback | `{kind:'none'}`에 center/level 부재 + 좌표 상수 하드코딩 0건 |
| 5 | null coordinates excluded | null/undefined/문자열/NaN/Infinity/범위초과/`0,0` 전부 배제, 원본 배열 무변형 |
| 6 | filter change recalculates viewport | 구↔시도, 기간 변경 시 viewport 키·bounds 변화 |
| 7 | stale old region result does not override | SWR 키에 지역·시군구·기간 포함, `keepPreviousData` 부재, fit effect가 `fitKey`에 묶임 |
| 8 | first-item center bug regression | `mapMarkers[0]` 사용 0건 + center가 첫 마커에서 0.11도(위도)/0.15도(경도) 이상 떨어져 있음 |
| 9 | list/map same filtered dataset | `useSWR` 1곳, 지도 좌표 출처가 그 응답의 `mapMarkers`, 목록은 같은 응답의 `list` |

추가: 동일 좌표 중복(degenerate bounds) 방지, 여백 값 범위, 순수성(SDK/DOM 의존 0).

---

## 7. 검증

```
npx tsx --test src/lib/stats/supply-map-bounds.test.ts     20/20 pass
npx tsx --test "src/**/*.test.ts"                        1065/1065 pass  (신규 20 포함, 회귀 0)
npx tsc --noEmit                                         src/ 오류 0
npx eslint <변경 파일 3개>                                  오류 0 / 경고 0
npm run build                                            ✓ Compiled successfully in 4.4s
```

---

## 8. DEVICE QA REQUIRED

코드/로직은 검증했지만 **실제 지도 렌더는 브라우저가 필요하다.** 이 환경에서 Kakao 지도를
실제로 띄워 확인할 수 없으므로 아래는 사용자 확인이 필요하다(STRUCTURAL PASS / DEVICE QA
REQUIRED).

1. 통계 → 공급 → 지역 "부산광역시" → 지도에 **부산 전역**이 들어오는지(기장 쪽으로
   치우치지 않는지).
2. 구/군 변경 → 지도가 그 구로 다시 맞춰지는지, 이전 viewport가 남지 않는지.
3. 금정구처럼 **같은 좌표 2건만** 있는 구 → 지도가 최대 배율로 튀지 않는지.
4. 기간(향후 1/2/3년/전체) 변경 → viewport 재계산되는지.
5. 전국 토글 → 전국 범위로 맞춰지는지.
6. 360 / 390 / 430px 폭에서 지도 높이 340px 유지, 가장자리 마커가 잘리지 않는지,
   부산 전역 축척에서 마커 식별이 가능한지.
7. 마커 탭 → 선택 카드 표시, 지역 변경 후 카드가 사라지는지.

---

## 9. 알려진 문제 / 범위 밖

1. **`RegionChangeMapView.tsx`에 같은 계열의 버그가 있다** — 532행 `center`가
   `points[pointEntries[0][0]]`(첫 항목)이고 `zoomLevel`이 `uiLevel === 'sido' ? 9 : 7`로
   고정이다. 이번 브리프는 공급 화면 범위라 **건드리지 않았다**(unrelated refactor 금지).
   같은 `supply-map-bounds.ts` 로직을 재사용해 별도 STEP으로 고치는 것을 권한다.
2. **서버 좌표 검증은 그대로다** — `/api/stats/supply`는 여전히 null만 본다. 무효 좌표는
   클라이언트에서 막았고 실측 위반이 0건이라 API 계약은 바꾸지 않았다. 서버에서도
   `summary.mapCount`를 유효 좌표 기준으로 세는 것이 더 정확하지만, 응답 계약 변경이라
   별도 STEP이 맞다.
3. **클러스터링 없음** — 부산 전역 축척에서 마커가 겹칠 수 있다(SDK의 clusterer는 이미
   로드하지만 이 화면은 쓰지 않는다). §8-6 device QA 결과에 따라 판단할 사항으로 남긴다.
