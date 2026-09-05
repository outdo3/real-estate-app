# OFFICETEL V1 STEP 6 — 저장 좌표 지도 + 로드뷰

- 상태: **완료 (READY)**
- 범위: 오피스텔 상세의 위치 카드. DB/schema/index 변경 0, Production write 0.
- 선행: [STEP 5B](./OFFICETEL_V1_STEP5_GEO_COORDINATES.md)가 적재한 5,048개 master 좌표.

## 1. 목적

오피스텔 상세에서 위치 여정을 닫는다.

```
오피스텔 상세 → 지도 기본 표시 → [로드뷰] → 같은 카드에서 로드뷰
             → [지도] → 같은 카드로 복귀
```

**런타임 지오코딩은 하지 않는다.** 좌표는 STEP 5B가 검증해 적재한 값만 쓴다.

## 2. 현재 신뢰 상태

| | 값 |
| --- | ---: |
| `officetel_masters` | 5,056 |
| 저장 좌표 보유 | **5,048 (99.84%)** |
| 좌표 없음 | **8** (TIER C 7 + TIER D 1, 의도적 제외) |
| 좌표 공유(SITE_LEVEL 후보) master | 79 |

## 3. 기존 지도 구조 감사

`src/components/KakaoMapEmbed.tsx`가 유일한 지도/로드뷰 컴포넌트였고, props는
`address` / `jibunAddress` / `type` 뿐이었다. 좌표를 받을 방법이 아예 없었고 항상

```
addressSearch(도로명) → 실패 시 addressSearch(지번) → 실패 시 keywordSearch
```

로 **런타임 지오코딩**을 했다. 오피스텔에 이 경로를 쓰면 이미 검증해 적재한 좌표를
버리고 매번 다시 추측하는 셈이 된다 — 게다가 실패하면 *다른 건물*로 조용히 떨어진다.

SDK 로딩은 10곳이 각자 복붙한 형태였다. 스크립트 id(`kakao-map-script-main`)를
공유하는 관례 덕에 태그 중복 주입은 없었지만, "준비됐는지"를 각자 200ms 폴링으로
판정하고 있었다.

## 4. 좌표 모드 설계

`KakaoMapEmbed`의 props를 **판별 유니온**으로 갈랐다. 두 모드는 타입 수준에서 섞일 수 없다.

```ts
type Props =
  | { mode: 'address';    address: string; jibunAddress?: string; type: LocationView }
  | { mode: 'coordinate'; latitude: number; longitude: number;    type: LocationView };
```

판정은 import가 하나도 없는 순수 모듈 `src/lib/kakao/map-embed-logic.ts`가 한다.

| 입력 | 계획 |
| --- | --- |
| 정상 좌표 | `USE_STORED_COORDINATE` — Geocoder/Places를 **만들지도 않는다** |
| 깨진 좌표(NaN·0,0·범위밖) | `UNRESOLVABLE` — **주소로 폴백하지 않는다** |
| 주소 | `RESOLVE_BY_ADDRESS` — 기존 아파트 경로 그대로 |

깨진 좌표에서 주소로 떨어지지 않는 것이 핵심이다. 떨어지면 두 모드가 조용히 섞이고,
"지도가 틀렸는데 틀린 줄 모르는" 상태가 만들어진다.

### SDK 로더 단일화

`src/lib/kakao/maps-sdk.ts`가 **프로미스 하나를 캐시**한다. 두 번째 호출부터는
네트워크도 폴링도 없이 즉시 resolve되므로 지도↔로드뷰 전환에서 SDK를 다시 기다리지
않는다. 스크립트 src 문자열은 기존 KakaoMapEmbed의 것을 그대로 유지했다 — 라이브러리
목록을 바꾸면 같은 id를 재사용하는 다른 9개 화면의 로딩 동작까지 바뀐다.

### 지도/로드뷰 두 pane 유지

예전에는 `type`이 바뀔 때마다 컴포넌트 전체를 다시 만들었다. 이제 지도와 로드뷰가
**각자의 컨테이너를 계속 들고 있고 visibility만 바뀐다**. 그래서:

- 주소 모드에서 전환할 때 지오코딩이 다시 돌지 않는다
- 좌표 모드에서 **사용자가 맞춰둔 줌/중심이 보존된다**
- 로드뷰 파노 조회가 토글마다 반복되지 않는다 (3회 왕복 = 조회 1회, 실측)

`display:none` 대신 `visibility:hidden`을 쓴다 — 카카오가 컨테이너 크기를 0으로 읽으면
다시 보일 때 깨진다.

## 5. 위치 카드 UI

`src/components/officetel/OfficetelLocationCard.tsx`. 정보 순서상 **실거래 다음, 건물
정보 앞**에 둔다(오피스텔은 거래가 먼저다).

- 지도가 카드 안에 직접 보인다. 외부 버튼만 두지 않는다.
- 카드 우하단에 떠 있는 단일 전환 버튼: `[로드뷰]` ↔ `[지도]`
- 높이 `clamp(280px, 42vw, 400px)` — 모바일 280px, 데스크톱 400px
- teal 액센트는 버튼 테두리/아이콘/섹션 선에만. 지도를 물들이지 않는다.

### 지연 로딩

지도 SDK를 상세 초기 렌더에 끌고 들어오면 PERFORMANCE V2에서 닫아둔 성능을 되돌린다.
카드가 화면(+200px)에 들어올 때만 로드한다.

첫 판정은 **동기적으로 `getBoundingClientRect()`** 로 한다. IntersectionObserver
콜백은 렌더 파이프라인에 실려 오기 때문에 탭이 렌더되고 있지 않으면 이미 화면 안에
있는 요소에도 영영 오지 않고, 그러면 지도가 "불러오는 중"에 멈춘다 — QA에서 실제로
재현했다. 관찰자를 신뢰의 단일 지점으로 두지 않고 scroll/resize 보조 경로도 둔다.

## 6. 좌표 없는 8개 master

가짜/빈 카카오 지도를 그리지 않는다. 재시도 지오코딩도, 근처 건물도, 다른 master
좌표도 쓰지 않는다.

> 위치 정보가 아직 확인되지 않았습니다.
> 정확한 위치가 확인되면 지도와 로드뷰를 제공할 예정입니다.

SDK 자체가 로드되지 않는 것을 실측 확인했다(`kakao` 전역 미정의).

## 7. 로드뷰

저장 좌표를 원점으로 `RoadviewClient().getNearestPanoId(coords, 200, cb)`.
파노가 없으면 "이 위치는 로드뷰를 제공하지 않습니다."와 함께 `[지도]` 버튼을 유지해
바로 돌아올 수 있게 한다. 외부 팝업은 V1 범위 밖.

## 8. SITE_LEVEL 좌표 — LIMITED

79개 master가 좌표를 공유한다(예: 이안해운대 5개, 퀸즈타운W 사하 5개).

- 지도에는 마커를 평소대로 표시한다.
- **정확한 동 위치 / 건물동 중심 / 출입구 / 동별 좌표라고 주장하지 않는다.**
- 현재 DB/API가 TIER·SITE_LEVEL 메타데이터를 보존하지 않으므로 **런타임 정밀도
  라벨을 지어내지 않는다.** 이번 STEP에서 schema를 추가하지 않는다. 한계만 기록한다.

## 9. 검증

| 항목 | 결과 |
| --- | --- |
| 좌표 모드 `addressSearch` 호출 | **0** |
| 좌표 모드 `keywordSearch` 호출 | **0** |
| SDK script 태그 (3회 토글 후) | **1** |
| 로드뷰 파노 조회 (3회 토글) | **1** |
| 줌 보존 (50m→30m→로드뷰→지도) | **30m 유지** |
| 거래 탭·면적 칩 (토글 왕복 후) | **불변** |
| 좌표 없는 master의 SDK 로드 | **없음** |
| 모바일 360/375/390 가로 overflow | **없음** |
| 전환 버튼 터치 타겟 | **44px** |
| 아파트 주소 모드 지오코딩 체인 | **보존** (address → jibun → keyword 실측) |

파노 없음 분기는 실제 오피스텔 좌표 23개 표본에서 23/23 파노가 존재해 자연 사례를
찾지 못했다. 원천이 null을 주는 상황을 SDK 수준에서 주입해 UI 분기를 검증했다.

## 10. 상태 정리

**READY** — 저장 좌표 기반 상세 지도 · 로드뷰 · 지도↔로드뷰 전환

**LIMITED**
- SITE_LEVEL 좌표 정밀도(79 master). 건물 단위이지 동 단위가 아니다.
- 로드뷰 파노 제공 여부는 카카오에 달려 있다.

**NO DATA**
- 좌표 미해결 master 8개.

**BLOCKED / DEFERRED**
- 통근 시간
- 정밀 거리 스코어링
- 좌표 신뢰 티어의 런타임 필터링 (DB에 티어가 보존돼 있지 않다 — schema 필요)

## 11. 알려진 문제 (이번 STEP 범위 밖)

- SDK 스크립트 id를 공유하는 10개 화면 중 `BusAccessCard`/`KakaoPlaces`는
  `drawing` 라이브러리를 포함해 주입하고 나머지는 하지 않는다. 먼저 로드한 쪽이
  이긴다 — **STEP 6 이전부터 있던 성질**이며 이번에 바꾸지 않았다(바꾸면 9개 화면의
  로딩 동작이 함께 바뀐다).
- `src/app/map/page.tsx`의 "주변 매물을 불러오는 중..." 문구는 백로그의 정확한
  대상 문자열("주변 매물을 가지고 오는 중")과 일치하지 않고, 이번 STEP에서 건드리는
  파일도 아니라 변경하지 않았다.

## 12. 다음 STEP

OFFICETEL FINAL QA를 시작할 수 있다.
