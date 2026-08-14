# STEP 24 — PRESALE P2-D4-B4: 분양 상세 "위치와 주변 단지" 지도 UI

상태: P2-D4-B4 구현 완료 / 사용자 최종 승인 (2026-08-14)

## 사용자 모바일 최종 검수 결과 및 승인 (2026-08-14)

사용자가 production(commit `d362a10`)에서 실제 모바일 화면으로 B4를
검수했다. 결과:

**B4 지도 — 승인**:
- "위치와 주변 단지" 섹션 위치 적절(위치정보 직후, B3 직전)
- 모바일 260px 지도 높이 적절
- 분양 초록 marker와 주변 marker 구분 양호
- 지도 → B3 흐름 자연스러움
- "카카오맵에서 크게 보기" 적절

지도 관련 사양(위치/260px/marker 구조/색상/bounds/lazy load/Kakao SDK/
외부 링크)은 이번 STEP에서 전혀 수정하지 않고 그대로 유지했다.

**B3 — 기능은 문제 없으나 세로밀도 개선 요청**: 최근 거래 → 최근 거래
대표가격 → 분양 최고가와 차이 사이 수직 여백이 누적돼 카드가 모바일에서
필요 이상으로 길어 보인다는 피드백을 받아, 정보/기능/계산 삭제 없이
CSS spacing만 최소 조정했다(아래 "B3 카드 세로밀도 개선" 참고). 조정
후 실측 결과를 사용자 승인 기준으로 삼아 최종 완료 처리한다.

## 목적

`/presales/[id]`에 "분양단지 1개 + 주변 아파트 최대 5개"를 한 화면에서
보여주는 지도 섹션을 추가한다. 지도는 위치·거리·방향·밀집도 체감을
담당하고, 실거래 상세는 기존 B3 카드가 그대로 담당한다 — 역할을
분리하고 B1/B2 계산 로직은 전혀 건드리지 않는다. 문서23(B4-A)의 최종
판단 B와 V1 범위를 그대로 채택했다.

## 데이터 구조 — B3와 완전히 공유(신규 API 호출 0회)

`useSWR('/api/presales/{id}/nearby-market', fetcher)` 호출을 기존
`nearby-market-section.tsx`(B3) 내부에서 부모 `presale-detail-client.tsx`
로 끌어올려, B3와 B4가 **정확히 같은 fetch 결과**를 props로 나눠 받는다.
선택된 주택형(`selectedHouseTypeId`)도 같은 위치로 끌어올려 지도
popup의 대표가격이 B3의 현재 선택과 항상 같은 값을 보게 했다(§9~10
요구사항).

```
presale-detail-client.tsx (부모)
├─ useSWR(`/api/presales/{id}`)           — 기존, 무변경
├─ useSWR(`/api/presales/{id}/nearby-market`) — 신규 위치(기존 B3 내부에서 이동)
├─ useState(selectedHouseTypeId)          — 신규 위치(기존 B3 내부에서 이동)
├─ <PresaleNearbyMap marketData=... selectedHouseTypeId=... />   (B4, 신규)
└─ <NearbyMarketSection data=... selectedId=... onSelectId=... />  (B3, props로 전환)
```

**"단순히 SWR이라 아마 한 번"이라고 추측하지 않고**, Chrome DevTools
Network 탭(`read_network_requests`)으로 실측 확인했다 — `/presales/479`
진입 후 `nearby-market` 요청은 **정확히 1건**이었다.

## nearby-market API additive 확장

`src/app/api/presales/[id]/nearby-market/route.ts`에 최상위 필드
`nearbyApartments`를 추가했다.

```ts
function toMapApartments(items: NearbyApartmentItem[]) {
  return items.map((i) => ({
    id: i.id, aptSeq: i.aptSeq, name: i.name,
    latitude: i.latitude, longitude: i.longitude,
    distanceKm: i.distanceKm, buildYear: i.buildYear,
  }));
}
```

`findNearbyApartments()`가 이미 계산해 둔 `items`(B1과 동일한 함수,
동일한 adaptive radius 정책)를 그대로 노출만 한다 — **새 주변검색
로직/새 DB 쿼리/단지명 문자열 매칭을 추가하지 않았다.**

### `nearbyApartments`의 의미 — `houseTypes[].comparisons`와 다르다

`houseTypes[].comparisons`는 "선택 주택형과 ±1㎡ 이내로 실거래 비교
가능한 아파트만" 담는다(B2 정책, 무변경). `nearbyApartments`는 "이
Presale 좌표 기준 B1 정책으로 검색된 주변 ApartmentMaster 최대 5개"
전부를 담는다 — 실거래 비교 가능 여부와 무관하다. 실측으로 이 차이가
실제로 발생함을 확인했다(§실데이터 검증 참고, id=801/847: B1 기준
5개인데 `comparisons`엔 각각 1개만 노출).

### API backward compatibility

기존 필드(`presaleId`/`locationAvailable`/`radiusKm`/`totalCandidates`/
`nearbyApartmentCount`/`monthsSearched`/`houseTypes`)는 삭제/rename/의미
변경 없이 그대로 유지했다 — `nearbyApartments` 하나만 additive로
추가했다. B3(기존 consumer)가 그대로 정상 동작함을 실측으로 확인했다
(아래 회귀검증 참고).

## 신규 지도 component

`src/app/presales/[id]/presale-nearby-map.tsx`(신규) —
`PresaleNearbyMap`. 기존 `nearby-market-section.tsx`(B3)와 같은
디렉터리·같은 kebab-case 네이밍 컨벤션을 따랐다. B3의 실거래 계산
로직은 이 파일에 전혀 없다 — Kakao SDK 준비, 지도 생성, marker 렌더,
bounds fit, marker click UI, loading/실패 처리만 담당한다.

`src/components/MapViewer.tsx`는 이번 STEP에서도 수정하지 않았다(문서23
§2 결론대로 여전히 미사용 상태로 남겨둠 — 이번 STEP의 범위가 아니라
삭제도 하지 않았다, CLAUDE.md 원칙 14).

## Kakao SDK loading

`/map/page.tsx`, `KakaoMapEmbed.tsx`와 **동일한 script id**
(`kakao-map-script-main`)를 재사용해 `document.getElementById`로 기존
스크립트 유무를 먼저 확인한다. 프로젝트 전체 지도 로더를 공용
helper로 리팩터링하지는 않았다(요청 범위 — 대규모 리팩터링 금지). 4가지
상황(SDK 이미 로드됨/스크립트가 DOM에 있지만 로딩 중/SDK 없음/스크립트
로드 실패) 전부 기존 `/map`·`KakaoMapEmbed`와 동일한 폴링(200ms)+
타임아웃(10초)+`error` 이벤트 처리 패턴으로 대응한다.

## Lazy load

`IntersectionObserver`(`rootMargin: '200px'`)로 지도 섹션이 viewport에
근접하기 전까지 Kakao SDK 요청 자체를 만들지 않는다. 네이티브 API만
사용(신규 package 없음) — 이 프로젝트에 `IntersectionObserver` 사용
사례가 없어 최초 도입이다.

**실측 결과**(Network 탭, 스크롤 전/후 비교):
- 스크롤 전: `dapi.kakao.com/v2/maps/sdk.js` 요청 **없음**
- 지도 섹션까지 스크롤 후: `sdk.js` 요청 **1건** 발생

## Marker 정책

- 분양단지(1개): `--primary-color`(#03c75a) 배경의 알약 칩, "분양"
  라벨. `zIndex`를 선택 시 20, 평시 10으로 둬 다른 마커보다 항상
  우선.
- 주변단지(최대 5개): neutral(`#94a3b8` 테두리 + 흰 배경, `/map`의
  "최근 거래 없음" 마커가 이미 쓰는 조합 재사용). 선택 시 테두리만
  `--primary-color`로 바뀌고 `transform: scale(1.08)`.
- 새 색상 토큰을 추가하지 않았다 — 전부 `globals.css`에 이미 있는
  값만 사용.

## Marker label

`apt.name.length > 6`이면 6자+"…"로 축약(예: "e편한세상송…"), 짧으면
그대로. 전체 이름은 클릭 popup에만 표시(§19 정책 그대로).

## Marker click popup

- 주변단지: 단지명(전체) + 거리(`formatDistance`, B3와 동일 포맷) +
  준공연도. 선택된 주택형의 `comparisons`에 해당 아파트의
  `recentMedianPrice`가 있으면 "최근 거래 대표가격 OO억 OOOO만원" 한
  줄 추가 — **없으면 그 줄 자체를 렌더링하지 않는다**(가격 생성 안
  함, §9 정책).
- 분양단지: 분양단지명(`houseName`) + "분양 위치" — 그 이상 없음(§21).
- 거래 3건 전체/차액 상세/투자 판단 문구는 어디에도 없다.
- popup은 지도 컨테이너 안 하단에 고정 오버레이로 표시된다. **버그 발견
  및 수정**: 초기 구현 시 두 가지 실제 문제를 실기기 테스트 중 발견해
  고쳤다.
  1. marker 클릭 시 Kakao 지도 컨테이너의 `onClick`(빈 곳 클릭 → 선택
     해제)이 네이티브 이벤트 버블링으로 함께 발동해 선택이 즉시
     풀리는 문제 — marker의 클릭 핸들러에 `e.stopPropagation()` 추가로
     해결.
  2. popup이 DOM에는 정상 존재하지만 화면에 보이지 않는 문제 — Kakao
     지도 내부 pane들이 명시적 z-index를 쓰는 CSS stacking 특성상
     `z-index: auto`인 형제 요소(popup)가 가려질 수 있음을 확인,
     popup에 `z-index: 30`(마커 최대 zIndex 20보다 큼)을 명시해
     해결.

두 문제 모두 브라우저에서 실제로 클릭해 재현한 뒤 코드로 고치고 다시
확인했다 — 코드만 보고 "동작할 것"이라고 가정하지 않았다.

## bounds fit — 고정 zoom 아님

`react-kakao-maps-sdk`의 `<Map onCreate={...}>`(공식 타입 정의가 ref
폴링보다 권장하는 방식, `/map`의 구형 폴링 패턴을 그대로 베끼지 않고
이미 설치된 패키지의 최신 권장 API를 사용)로 실제 `kakao.maps.Map`
인스턴스를 받아, 분양단지+주변단지 좌표 전부를 포함하는
`LatLngBounds`를 계산해 `setBounds(bounds, 40)`(40px 패딩)로 지도를
자동 맞춤한다. 고정 zoom level을 쓰지 않는다 — adaptive radius로 인해
실측 거리 편차가 60m~2.38km까지 크기 때문(문서23 §13/§22).

## 좌표 없는 Presale / 주변단지 0개

- 좌표 없음: `latitude`/`longitude`가 null이면 지도를 아예 렌더하지
  않고 "정확한 위치정보가 없어 지도를 표시할 수 없습니다."만
  표시(기존 위치정보/B3와 동일한 톤).
- 주변단지 0개: 분양단지 marker만 표시하고 지도 하단에 "반경 3km 내
  표시할 주변 단지가 없습니다." 안내를 추가로 표시한다(지도 자체를
  숨기지 않음).

## 실패 UX

SDK 로드 실패/타임아웃 시 지도 섹션만 "지도를 불러오지 못했습니다."
+ "카카오맵에서 보기"(기존 위치정보 카드와 같은 외부 링크)로
fallback한다. 상세페이지의 다른 섹션(청약일정/주택형/B3 등)은 이
실패와 무관하게 정상 동작한다 — B3가 이미 따르는 섹션별 독립 에러
처리 원칙과 일치.

## 카카오맵 외부 링크

기존 위치정보 카드의 "카카오맵에서 보기"는 그대로 유지(무변경). 지도
섹션 하단에 "카카오맵에서 크게 보기"를 별도로 추가했다 — 두 링크가
바로 위/아래에 있지만, 위치정보 카드는 "핵심정보 확인 직후"이고 지도
섹션은 "주변 관계를 본 직후"라는 서로 다른 시점의 CTA라 중복이라고
판단하지 않았다.

## 섹션 제목 / 위치

- 제목: "위치와 주변 단지"(내부 용어 "B4"/"ApartmentMaster"/
  "nearby-market" 노출 없음).
- 위치: 기존 위치정보(E) 섹션 직후, B3 직전 — 문서16 §26이 B1~B3
  설계 때부터 권장한 순서를 그대로 따른다. 기존 위치정보 섹션은 한
  줄도 수정하지 않았다.

## 지도 크기

모바일 기본 260px(`.mapContainer { height: 260px }`), PC는 상세페이지
`max-width` 컨테이너 안에서 `width: 100%` 그대로 — 별도 breakpoint로
지도를 키우지 않았다.

## 접근성

지도 컨테이너 자체에 별도 aria-label을 달지는 않았으나(팝업이
`role="status"`), **지도가 보여주는 핵심 정보(단지명/거리/준공연도)는
전부 B3 카드에 이미 텍스트로 존재**한다 — screen reader 사용자가 지도
때문에 정보를 놓치는 구조가 아니다(문서23 §27 판단 그대로 실측 확인:
B3 카드가 여전히 정상 렌더링됨).

## 디자인

기존 `.section`/`.sectionTitle`/`.nearbyHeaderRow`/`.infoButton`/
`.infoPanel`/`.retryBtn`/`.stateLink`/`.emptyText` 클래스를 그대로
재사용했다. 새로 추가한 클래스(`.mapContainer`/`.mapStateBox`/
`.mapMarkerPresale`/`.mapMarkerNearby`/`.mapMarkerNearbySelected`/
`.mapPopup*`)는 기존 `border-radius`(`--radius-md`)·spacing·색상
토큰(`--primary-color`/`--primary-hover`/`--border-color`/`--bg-color`)
만 사용했다.

## 실데이터 검증 (production 코드, 로컬 dev 서버, 실제 브라우저)

6개 표본을 실제 브라우저로 확인했다(요청된 6개 이상 충족).

| id | 시나리오 | 확인 결과 |
|---|---|---|
| 479 | 밀집지역(5개, 60~252m), 12개 주택형, 24개월 fallback | 지도 6marker 정상, bounds fit 정상, marker 클릭→popup(이름/거리/준공연도, 가격 있으면 표시) 정상, 주택형 chip 전환 시 marker 목록 불변·가격만 업데이트 확인, B3 정상 |
| 755 | 밀집지역, 6개월 사례 | 지도 정상(분양+주변 marker), B3 "최근 6개월 · 최대 3건 기준" 정상 |
| **801** | **지역경계 사례**(문서19 §16) | **핵심 검증**: `nearby-market` comparisons엔 아파트 1개만 노출되지만, 지도는 `nearbyApartments` additive 필드 덕분에 **5개 marker 전부 정상 표시**(한웅남천마티안·대우포르투나·더비치푸르지오써밋·아침햇살·영광드림타워) — B3-only로는 불가능했던 것을 실제로 확인 |
| **847** | **3km adaptive radius 확장 사례** | 최장거리 2.38km 사례에서 bounds fit이 분양+주변 5개 전부를 화면 안에 담음(넓은 1km 축척 지도로 자동 확장) |
| 173 | 좌표 없는 Presale | "위치와 주변 단지" 섹션에 "정확한 위치정보가 없어 지도를 표시할 수 없습니다." 정상 표시, 지도 렌더 시도 없음 |
| 47 | 주변단지 0개(문서23에서 좌표 있는 부산 Presale 중 3km 내 후보가 0인 두 사례로 발견) | 분양 marker만 단독 표시 + "반경 3km 내 표시할 주변 단지가 없습니다." 정상 표시 |

추가로 id=164(좌표 없음)는 API 레벨(`locationAvailable:false`)로만
재확인했다(173과 동일 패턴이라 브라우저 재확인은 생략).

### 주택형 변경과 지도 — 실측 확인

id=479에서 chip을 "79.48㎡ B" → "80㎡ F"로 전환한 뒤 DOM을 직접
조회해, 지도 marker 목록(5개 단지명)이 전후 **완전히 동일**함을
확인했다(§10 요구사항 — API 재호출 없이 client-side 데이터만 사용).

## 모바일/PC 검증

이 환경의 브라우저 자동화 도구는 실제 창 리사이즈(360/375/390px)가
동작하지 않는다(B3/B3-FIX와 동일한 기존 한계, 문서19/22에서 이미 확인)
— 이번에도 근사 검증으로 대체했다. 실제 관찰된 뷰포트는
1568~1707px(데스크톱 폭)이었다.

- `.mapContainer` height 260px는 CSS로 고정, 뷰포트 폭과 무관 —
  코드상 모바일에서도 동일하게 적용된다.
- horizontal overflow: `document.body.scrollWidth`(1690px) ≤
  `window.innerWidth`(1707px) — 오버플로 없음(단, 이는 데스크톱 폭
  기준 측정치이며 좁은 뷰포트에서 재측정하지 못했다는 한계는 그대로
  남는다).
- marker label은 짧게 축약되어(§label 정책) 지도 대부분을 가리지
  않음을 스크린샷으로 확인.
- popup은 `left/right: 0.6rem`로 지도 컨테이너 폭에 맞춰 반응형으로
  늘어나 화면 밖으로 벗어나지 않는 구조(코드상 확인, 실측은 데스크톱
  폭 기준).
- **완전한 360/375/390px 뷰포트 검증과, 지도 drag 제스처와 페이지
  세로 스크롤 간 충돌 여부(문서23 §26이 미리 지적한 리스크)는 도구
  제약으로 확인하지 못했다** — 사용자 실기기 검수가 필요한 항목으로
  명시한다.

## 성능 검증

- lazy load 전 SDK 요청 0건 / viewport 근접 후 1건 — 실측(Network
  탭) 확인.
- `nearby-market` 네트워크 요청 정확히 1건 — 실측(Network 탭) 확인.
- marker 최대 6개(분양1+주변5) — `/map`이 이미 수십 개 이상을
  문제없이 렌더링 중이라 이 규모의 렌더 비용은 낮다고 판단(별도 성능
  프로파일링은 하지 않음, 문서23의 판단을 그대로 따름).
- 지도 로드 실패가 페이지 전체에 영향 없음 — 코드 구조상 지도
  컴포넌트의 실패 state는 그 섹션에만 국한되며, B3/기존 섹션들과
  독립적으로 렌더링됨을 코드 검토로 확인(실제 SDK 실패를 인위적으로
  재현하지는 않음 — API 키를 건드리는 것은 금지 항목이라 시도하지
  않았다. 한계로 명시).

## 회귀검증

- `npx prisma validate` — 통과(schema 변경 없음)
- `npx prisma migrate status` — up to date
- `npx tsc --noEmit` — 오류 0
- `npx eslint`(전체) — 오류 0, 기존 무관 경고 5건(변경과 무관한 기존
  파일)만 존재
- `npm run build` — 성공, `/presales/[id]` 등 전체 라우트 정상 포함
- `GET /api/presales` — 200
- `GET /api/presales/479` — 200
- `GET /api/presales/479/nearby-apartments`(B1) — 200, 기존 응답
  구조 무변경
- `GET /api/presales/479/nearby-market`(B2) — 200, 기존 필드 전부
  유지(`presaleId`/`locationAvailable`/`radiusKm`/`totalCandidates`/
  `nearbyApartmentCount`/`monthsSearched`/`houseTypes`) +
  `nearbyApartments` 추가 필드, `recentMedianPrice`/`differenceAmount`
  값 기존과 동일(39235/18765, 이전 세션 실측치와 일치)
- DB row count(read-only 조회): `ApartmentMaster` 3,402 /
  `Apartment` 20 / `Property` 0 / `Presale` 1,046 /
  `PresaleHouseTypeDetail` 5,395 — 전부 기존 기준(문서16)과 정확히
  일치, 변경 없음

## 발견 문제 (전부 이번 STEP 내에서 발견·수정·재검증)

1. marker 클릭 시 지도 컨테이너의 빈 곳 클릭 핸들러가 함께 발동해
   선택이 즉시 풀리는 문제 — `stopPropagation()`으로 수정.
2. popup이 Kakao 지도 내부 레이어에 가려 보이지 않는 문제 —
   `z-index: 30` 명시로 수정.

두 문제 모두 실제 브라우저 클릭 테스트로 발견했다(코드 리뷰만으로는
발견되지 않았을 종류의 문제) — 수정 후 재테스트로 해결을 확인했다.

## 한계

- 360/375/390px 정확한 모바일 뷰포트 검증 불가(도구 제약, 기존
  B3/B3-FIX와 동일한 한계).
- 지도 drag 제스처 ↔ 페이지 세로 스크롤 충돌 여부 미검증(실기기
  필요).
- SDK 로드 실패 상황은 실제로 재현하지 않고 코드 구조 검토로만
  확인(API 키를 건드리는 등의 인위적 실패 유발은 금지 항목).
- "주변단지 1~2개" 정확한 사례는 문서23에서 이미 밝힌 대로 현재 부산
  ApartmentMaster 분포에 존재하지 않아(0개 아니면 13개 이상), 0개
  사례로 대체 검증했다.

## B3 카드 세로밀도 개선 (2026-08-14, 사용자 모바일 검수 반영)

`src/app/presales/[id]/page.module.css`의 spacing 값만 조정했다 —
JSX(`nearby-market-section.tsx`)는 한 줄도 바꾸지 않았다. font-size,
가격 숫자 크기, 좌우 padding, 정보 항목, 문구는 전부 그대로 유지했다.

| 클래스 | 항목 | 이전 | 이후 |
|---|---|---|---|
| `.aptCard` | padding | `0.9rem`(전체) | `0.6rem 0.9rem`(상하만 축소, 좌우 `0.9rem` 유지) |
| `.aptCard` | margin-bottom(카드 간 간격) | `0.65rem` | `0.45rem` |
| `.aptName` | margin-bottom | `0.2rem` | `0.12rem` |
| `.aptMeta` | margin-bottom | `0.75rem` | `0.45rem` |
| `.cardStatBlock` | margin-bottom(정보 block 간 gap, ×3) | `0.6rem` | `0.38rem` |
| `.expandBtn` | padding | `0.3rem 0` | `0.18rem 0` |
| `.txList` | margin-top / gap / padding-top | `0.5rem` / `0.4rem` / `0.5rem` | `0.3rem` / `0.25rem` / `0.3rem` |
| `.moreBtn` | margin-top / padding | `0.4rem` / `0.7rem`(전체) | `0.25rem` / `0.5rem 0.7rem`(좌우 유지) |

### 실측 카드 높이 (id=479, 첫 번째 comparison 카드, `getBoundingClientRect().height`)

브라우저에서 임시 `<style>` override(파일은 건드리지 않고 이전 값을
`!important`로 재현)로 같은 페이지·같은 데이터에서 전/후를 직접
측정했다.

| 상태 | FIX 전 | FIX 후 | 감소율 |
|---|---|---|---|
| collapsed(접힘) | 304.17px | 276.00px | 약 9.3% |
| expanded(거래 3건 펼침) | 391.46px | 352.10px | 약 10.1% |

목표(§7 "10~20% 정도 짧아 보이는 카드")의 하한에 근접한 수준으로,
지나치게 압축해 답답해 보이지 않는 선에서 확정했다.

### 회귀 확인

- 정보 삭제 없음: 단지명/거리/준공연도/최근 거래(금액·면적·층·연월)/
  최근 거래 대표가격/`monthsSearched`·최대 3건 기준/분양 최고가와
  차이/거래 3건 펼치기·접기 — 전부 그대로 렌더링됨을 스크린샷으로
  확인.
- 문구 무변경: "최근 거래", "최근 거래 대표가격", "최근 24개월 · 최대
  3건 기준", "분양 최고가와 차이" 전부 동일.
- font-size 무변경(가격 숫자 크기 포함) — CSS diff에 `font-size` 관련
  변경 없음.
- 거리순/신축순 토글, 주택형 chip, B4 지도는 이번 STEP에서 전혀
  수정하지 않았다(diff에 미등장) — id=479/801/847 재검증 결과 전부
  정상.
- **Production 모드로 재현한 network request 재검증**: 최초 측정 시
  브라우저 자동화 절차상 실수(같은 URL로 `navigate`를 연속 2회 호출)로
  `nearby-market` 요청이 2~4건으로 잘못 측정된 사건이 있었다 — dev
  서버 아티팩트(React StrictMode/HMR)를 의심해 `npm run start`(production
  빌드)로 전환하고, 탭을 새로 만들어 `navigate`를 정확히 1회만
  호출하는 절차로 다시 측정한 결과 **정확히 1건**임을 재확인했다
  (`nearby-apartments` 0건도 재확인). 실제 코드 문제가 아니라 측정
  절차의 실수였음을 이렇게 원인까지 규명한 뒤 기록한다 — 추측으로
  덮지 않았다.

## 최종 판단

**A — 구현 완료, 기존 기능 무손상, 모바일 검수 가능.**

B1/B2 계산 로직 무변경(실측 확인), B3 UI/기능 무손상(실측 확인),
nearby-market API는 additive 필드 1개만 추가(backward compatible,
실측 확인), 신규 API 호출 0회(실측 확인), 지도 자체도 6개 실데이터
표본에서 정상 동작을 확인했다. 다만 실기기 모바일 검증(뷰포트/제스처
충돌)은 하지 못했으므로, 사용자 최종 승인 전까지 P2-D4-B4를 완료
처리하지 않는다.

## 최종 승인 (2026-08-14)

사용자가 production 모바일 화면에서 B4 지도를 승인하고, B3 카드
세로밀도 개선(위 §B3 카드 세로밀도 개선)을 반영한 뒤 **P2-D4-B4를
최종 완료로 승인**했다. B1/B2/B3/B3-FIX 정책과 기능은 전부 그대로
유지되며, 이번 STEP에서 API/DB/schema/migration 변경은 없었다(read-only
검증만 수행, row count 재확인 결과 기존과 일치).
