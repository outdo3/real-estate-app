# REGION CHANGE MAP BOUNDS FIX V1

**상태: 구현 완료 / STRUCTURAL PASS · DEVICE QA REQUIRED / DB·schema·migration 0건 / Production write 0건**

작성일 2026-09-12 · branch `main` · 기준 HEAD `9413ddf`

---

## 1. 목적

통계 > 변동지도(`RegionChangeMapView`)에서 **첫 항목 좌표 + 고정 zoom**으로 지도를 잡는
구조를 없애고, 선택 지역/데이터 범위에 맞춰 viewport를 계산한다.

직전 STEP(SUPPLY_MAP_REGION_BOUNDS_FIX_V1, commit `9413ddf`)에서 공급 지도의 같은 계열
버그를 고치며 이 화면에도 동일 문제가 있음을 보고했고, 이번 STEP이 그 후속이다.

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              9413ddf  fix(supply): fit the move-in map to the selected region, not to its first marker
tracked dirty     package.json, package-lock.json   (사용자 작업물 — 건드리지 않음)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용. untracked 사용자
작업물 전부 보존. DB·schema·migration 0건, Production write 0건, 좌표 추정·생성 0건.

---

## 3. 감사 — root cause

### 3.1 구조

| 항목 | 실제 코드 |
|---|---|
| data source | `/api/stats/region-change` — `level=nation/sigungu/dong/complex`, `fetch` → `scopedData` state |
| marker source | **좌표가 데이터에 없다.** 행정경계 polygon이 저장소에 없어(§15/§16 기존 감사) 지역명을 Kakao Geocoder(`addressSearch`)로 좌표화해 버블을 찍는다 |
| region filter | URL query(`level`/`sidoCode`/`lawdCd`/`dong`/`period`) |
| center (변경 전) | `points[pointEntries[0][0]]` — `Object.entries(points)`의 첫 항목 |
| zoom (변경 전) | `zoomLevel={uiLevel === 'sido' ? 9 : 7}` 고정 |
| selected region | breadcrumb/드릴다운 navigate |
| filter change | `scopedData`는 `cancelled` 플래그 + `setScopedData(null)`로 **이미 보호되고 있었다** |
| stale response | 위와 같음 — fetch 경합 보호는 정상 |
| map lifecycle | SDK 스크립트 주입 후 `ready`, `points`가 하나라도 차면 지도 렌더 |

### 3.2 첫 번째 결함 — center가 "먼저 도착한 geocode 결과"

`points`는 geocode 콜백이 **도착한 순서대로** 채워지는 객체다. 따라서 `pointEntries[0]`은
네트워크 경쟁 결과이고, center가 실행마다 달라질 수 있다.

정확히는 bucket key 종류에 따라 다르게 틀렸다(테스트로 고정):

- **동 단위** — key가 동 이름(`우동`, `중동`)이라 객체 키 삽입 순서가 보존된다 →
  center가 **가장 먼저 응답한 동**. 같은 지역을 두 번 열면 지도가 다른 곳을 볼 수 있다.
- **구 단위** — key가 `lawdCd`(정수형 문자열)라 V8이 키를 오름차순으로 재배열한다 →
  center가 **항상 가장 작은 lawdCd의 구**. 결정적이지만 여전히 "아무 구"다.

### 3.3 두 번째 결함 — `points`가 한 번도 비워지지 않는다

`setPoints((prev) => ({ ...prev, [b.key]: point }))`만 있고 초기화가 없다. `BucketBubbles`는
`key` 없이 같은 위치에 렌더되므로 지역을 드릴다운해도 **컴포넌트 state가 유지된다**.

- 이전 지역의 좌표가 `points`에 계속 쌓인다 → 예전 center 계산이 옛 지역을 가리킬 수 있다.
- 더 조용한 문제: 동 단위 key는 **동 이름**이다. `중앙동`처럼 여러 구에 같은 이름이 있으므로
  구를 옮기면 **다른 구의 같은 이름 동이 옛 좌표를 그대로 물려받는다**(geocode가 도착해
  덮어쓰기 전까지). 버블이 엉뚱한 위치에 찍히고 bounds도 그 좌표로 계산된다.

### 3.4 세 번째 결함 — 죽은 fallback 좌표

```ts
const center = pointEntries.length > 0 ? points[pointEntries[0][0]] : { lat: 36.5, lng: 127.8 };
```

위에서 `pointEntries.length === 0`이면 이미 `return null`이라 삼항의 else는 **도달 불가**
코드였다. 그럼에도 "좌표가 없으면 임의 지점" 형태가 남아 있어 제거했다.

### 3.5 좌표 유효성

`parseFloat(result[0].y/x)` 결과를 그대로 쓴다 — 응답 형식이 어긋나면 `NaN`이 들어온다.
공급 지도와 같은 가드(number·finite·범위·`0,0`)가 필요하다.

---

## 4. Helper 재사용 / 추출 결정

공급 지도가 만든 `src/lib/stats/supply-map-bounds.ts`의 **판정 로직은 그대로 적합**했지만
이름이 `resolveSupplyViewport` / `isValidSupplyCoord`여서 변동지도에서 읽으면 두 화면의
관계를 알 수 없었다. 브리프 §1의 "naming/contract 때문에 부적절하면 공통 pure helper로
**최소 추출**" 조항에 따라 다음과 같이 나눴다.

| 파일 | 역할 |
|---|---|
| `src/lib/map/map-viewport.ts` (신규) | 판정 규칙 — `isValidMapCoord` / `validMapPoints` / `resolveMapViewport(points, singlePointLevel)` / `mapViewportKey`. Kakao SDK·DOM·React import 0, 위경도 리터럴 0 |
| `src/lib/stats/supply-map-bounds.ts` | 공급 화면 **조정값만** 남긴다 — `SUPPLY_MAP_BOUNDS_PADDING = 48`, `SUPPLY_SINGLE_POINT_LEVEL = 5` |
| `RegionChangeMapView.tsx` | 이 화면 조정값을 컴포넌트 상수로 — `REGION_CHANGE_MAP_BOUNDS_PADDING = 40`, `REGION_CHANGE_SINGLE_POINT_LEVEL = 7` |

`singlePointLevel`을 상수에서 **파라미터로** 올린 것이 유일한 계약 변경이다. 분양 단지
한 곳(공급, level 5)과 행정구역 버블 하나(변동지도, level 7)는 적절한 축척이 다르다.

alias 재수출 층을 두지 않았다 — 호출부 두 곳이 공용 이름을 직접 쓴다. 공급 화면 동작은
바뀌지 않았고(같은 값, 같은 분기), 공급 테스트 20개는 import 경로/이름만 바뀐 채 **전부
그대로 통과**한다.

여백 값 근거: 버블은 `yAnchor 0.5`로 좌표 위 중앙 정렬되고 최소 44×28px(라벨이 길면
60px대)이라 경계의 버블은 절반이 잘린다. 40px은 그 절반(≈32px)보다 크고, 280px 높이
지도에서 상하 합쳐 80px 선에서 멈춘다(`presale-nearby-map.tsx`가 검증해 쓰는 값과 동일).

---

## 5. 변경 전 / 변경 후

| 케이스 | 변경 전 | 변경 후 |
|---|---|---|
| 구/군 버블 여러 개 | center = 가장 작은 lawdCd의 구, level 9 고정 | 현재 buckets 좌표 전체를 감싸는 `setBounds` + 40px 여백 |
| 동 버블 여러 개 | center = **가장 먼저 응답한 동**, level 7 고정 | 동일하게 `setBounds` — 도착 순서와 무관 |
| 버블 1개 | center 맞음, zoom은 여전히 고정 | 그 좌표 center + level 7 |
| geocode가 같은 좌표를 준 여러 구 | 폭·높이 0 bounds 위험(예전엔 bounds 자체가 없었으니 고정 zoom) | `center` 경로로 처리해 최대 배율로 튀지 않음 |
| geocode 전부 실패 | `return null`(목록만) | 동일 — `viewport.kind === 'none'`이면 `return null` |
| 지역 변경 | 이전 지역 좌표가 `points`에 누적, 같은 이름 동이 옛 좌표를 물려받음 | `queryPrefix` 변경 시 `points` 초기화 + bounds는 **현재 buckets 좌표만** |
| 무효 좌표(NaN 등) | bounds/center 계산에 그대로 유입 | 공용 가드로 배제, 버블도 찍지 않음 |
| 죽은 fallback `36.5/127.8` | 도달 불가 코드로 잔존 | 제거 |

핵심 구현:

```tsx
const bucketPoints = useMemo(() => {
  const list: { lat: unknown; lng: unknown }[] = [];
  for (const b of buckets) {
    const point = points[b.key];
    if (point) list.push(point);
  }
  return validMapPoints(list);
}, [buckets, points]);

const viewport = useMemo(() => resolveMapViewport(bucketPoints, REGION_CHANGE_SINGLE_POINT_LEVEL), [bucketPoints]);
const fitKey = mapViewportKey(queryPrefix, bucketPoints);

useEffect(() => {
  if (!mapInstance || !window.kakao?.maps) return;
  if (viewport.kind === 'bounds') {
    const bounds = new window.kakao.maps.LatLngBounds();
    for (const point of viewport.points) bounds.extend(new window.kakao.maps.LatLng(point.lat, point.lng));
    mapInstance.setBounds(bounds, REGION_CHANGE_MAP_BOUNDS_PADDING);
  } else if (viewport.kind === 'center') {
    mapInstance.setCenter(new window.kakao.maps.LatLng(viewport.center.lat, viewport.center.lng));
    mapInstance.setLevel(viewport.level);
  }
}, [mapInstance, viewport, fitKey]);
```

`zoomLevel` prop은 `initialLevel`로 이름을 바꿨다 — 그 값은 이제 `setBounds` 적용 전
한 프레임에만 쓰이는 초기값이고 최종 zoom을 결정하지 않는다. 이름이 동작을 정직하게
말하도록 했다(값 9/7은 그대로).

기존 fetch 경합 보호(`cancelled` 플래그, `setScopedData(null)`, geocode 콜백의
`if (cancelled) return`)는 정상이라 **그대로 유지**하고 테스트로 고정했다.

---

## 6. DATA PARITY (§3)

`bucketPoints`는 **현재 `buckets`를 순회해** `points[b.key]`만 모은다. 버블 렌더도 같은
`buckets`를 순회하고, 목록도 같은 `buckets`를 정렬해 쓴다. 즉 bounds 계산 대상 =
화면에 찍히는 버블 = 목록의 지역 집합이다. `BucketBubbles` 안에서
`/api/stats/region-change`를 다시 호출하는 경로가 없다(테스트로 고정).

---

## 7. 테스트

`src/lib/map/map-viewport.test.ts` — **13 tests** (공용 판정 규칙)
`src/lib/stats/region-change-map-viewport.test.ts` — **19 tests** (이 화면 계약)
`src/lib/stats/supply-map-bounds.test.ts` — **20 tests** (공급, 회귀 없음 확인)

브리프 §7의 최소 9항목 대응:

| # | 요구 | 테스트 |
|---|---|---|
| 1 | multiple distinct points → bounds | 부산 4개 구 실측 좌표 bbox 일치, 모든 점 포함 |
| 2 | one point → center | 버블 1개 → center + level 7 |
| 3 | same-coordinate multiple rows → single-point | 같은 좌표 2개 → `center`(degenerate bounds 회피) |
| 4 | zero points → no wrong fallback | `{kind:'none'}`, 컴포넌트가 `return null`, 빈 상태/오류 분기 유지 |
| 5 | invalid coords excluded | `NaN`(parseFloat 실패), `0,0`, 범위 초과, 문자열, null 배제 + 버블 미표시 |
| 6 | region change recalculates | `points` 초기화가 `queryPrefix`에 묶임, 이전 지역 좌표가 bounds에 섞이지 않음, `fitKey` 변화 |
| 7 | first-item center regression | 도착 순서가 달라도 같은 viewport(동 단위), 가장 작은 `lawdCd`가 center가 아님(구 단위), `pointEntries`·`36.5/127.8`·`zoomLevel` 소멸 |
| 8 | map/list dataset parity | bounds·버블·목록이 모두 현재 `buckets` 기준, 지도 전용 요청 0 |
| 9 | supply map regression unchanged | 공급 20 tests 그대로 통과 + 두 화면이 같은 공용 helper를 쓰고 조정값은 섞이지 않음 |

추가: 입력 배열 무변형, 순수성(SDK/DOM/React·import 0), 좌표 리터럴 0, viewport 키 동등성.

---

## 8. 검증

```
npx tsx --test src/lib/map/map-viewport.test.ts
             src/lib/stats/region-change-map-viewport.test.ts     32/32 pass
npx tsx --test src/lib/stats/supply-map-bounds.test.ts            20/20 pass (회귀 0)
npx tsx --test "src/**/*.test.ts"                               1097/1097 pass
npx tsc --noEmit                                                src/ 오류 0
npx eslint <변경·신규 파일 7개>                                    오류 0 / 경고 0
npm run build                                                   ✓ Compiled successfully in 4.5s
```

---

## 9. DEVICE QA REQUIRED

지도 실렌더는 브라우저가 필요하다. 이 환경에서 Kakao 지도를 띄워 확인할 수 없으므로
아래는 사용자 확인이 필요하다.

1. 통계 > 변동 → 시도(예: 부산광역시) → 구/군 버블이 **전부 보이는지**, 지도가 한쪽
   구에 치우치지 않는지.
2. 같은 지역을 여러 번 열어도 지도가 **같은 곳**을 보는지(예전엔 geocode 도착 순서에
   따라 달라졌다).
3. 구 → 동으로 드릴다운 → 그 구의 동만 감싸는 범위로 다시 맞춰지는지, 이전 구 버블/
   범위가 남지 않는지.
4. 여러 구를 오가며 **같은 이름의 동**(예: 중앙동)이 있는 구를 방문 → 버블이 엉뚱한
   위치에 찍히지 않는지.
5. 버블이 하나만 나오는 지역 → 최대 배율로 튀지 않는지.
6. geocode가 대부분 실패하는 지역 → 지도가 사라지고 목록만 남는지(에러 화면이 아니라).
7. 360 / 390 / 430px 폭에서 280px 높이 유지, 가장자리 버블 라벨이 잘리지 않는지.
8. 기간(period) 변경 시 버블 값이 바뀌고 범위가 유지/재계산되는지.

---

## 10. 알려진 문제 / 범위 밖

1. **행정경계 polygon이 없다** — 여전히 지역명 geocode 기반 버블이다(§15/§16 기존 설계).
   이번 STEP은 viewport만 고쳤다.
2. **geocode 실패 지역은 지도에 없다** — 기존 동작 그대로(추정 좌표를 만들지 않는다).
   목록에는 남는다.
3. **클러스터링 없음** — 시도 범위에서 버블 라벨이 겹칠 수 있다. §9-7 device QA 결과에
   따라 판단할 사항으로 남긴다.
4. **`geocodeCache`는 모듈 레벨 유지** — 키가 `"{지역 접두} {라벨}"` 전체 질의라 지역 간
   충돌이 없어 그대로 뒀다(지역 변경 시 비우는 것은 `points` state뿐이다). 캐시가 남아
   있어 되돌아올 때 재요청이 없다.
5. **공급 지도 조정값 위치** — `supply-map-bounds.ts`는 이제 상수 2개만 가진 파일이다.
   화면 옆에 두는 편이 읽기 쉬워 그대로 유지했다.
