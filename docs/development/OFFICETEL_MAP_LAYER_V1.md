# OFFICETEL_MAP_LAYER_V1 — 메인 지도 부산 오피스텔 레이어

작성일: 2026-09-07
시작 HEAD: `123e18e` (branch `main`)

## 목적

`/map`의 "오피스텔 준비중" 안내를 없애고, OFFICETEL V1에서 적재한 **저장 좌표**로
실제 오피스텔 마커를 그린다. 요구 여정:

```
/map → 오피스텔 선택 → 실제 마커 → 마커 선택 → 기본정보 → 상세 진입 → /officetel/[id]
```

이 STEP은 **메인 지도 레이어**만 다룬다. 오피스텔 상세, MOLIT 신뢰성, 금융, 커뮤니티,
전국 확장은 열지 않았다.

## 현재 상태(변경 전)

`src/app/map/page.tsx`는 단일 `'use client'` 페이지다.

- 레이어: `apt`(MOLIT 실거래) / `school`(카카오 SC4 POI)만 실제 데이터, 나머지 4개
  (`officetel`/`livingLodging`/`redevelopment`/`auction`)는 `COMING_SOON_LAYERS`로
  하단에 "…아직 연동 준비 중입니다." 배너만 띄웠다.
- **"오피스텔 준비중"의 정확한 출처**: `page.tsx`의 `COMING_SOON_LAYERS` +
  `COMING_SOON_MESSAGE.officetel = '오피스텔 실거래 데이터는 아직 연동 준비 중입니다.'`
  와 이를 렌더하는 `activeComingSoon` 배너 블록.
- 뷰포트 모델: **bounds가 아니라 시군구(lawdCd) 단위**. 좌표를 카카오
  `coord2RegionCode`로 역지오코딩해 lawdCd를 얻고 `/api/transactions?type=apt&lawdCd=..&months=12`
  를 부른다. 드래그 종료(`dragend`)마다 재조회, 같은 lawdCd 60초 TTL 캐시,
  요청 순번(`requestSeqRef`)으로 stale 응답 차단.
- 클러스터링: 카카오 projection으로 마커를 화면 픽셀로 투영해 반경 안의 칩을 묶고,
  **숫자 배지가 아니라 격자로 벌려** 각 칩을 그대로 보여준다.
- 레이어 토글은 다중 선택(`Record<LayerKey, boolean>`) 구조다.

## 설계 결정

### 1. 데이터 원천 — 저장 좌표만

`officetel_masters`의 `latitude`/`longitude`만 쓴다. 런타임 지오코딩
(주소/지번/건물명/keywordSearch), 아파트 좌표 전용, 인접 폴백, 첫 결과 매칭 **모두 금지**.
좌표가 없는 master 8건은 마커에서 제외하고 **그 수를 응답과 화면에 남긴다**.

### 2. 뷰포트 전략 — 기존 lawdCd 모델 재사용

새 bounds 아키텍처를 만들지 않았다. 아파트 레이어가 이미 lawdCd 단위로 받고 있고,
부산 최대 구가 부산진구 845건(실측)이라 한 번의 응답이 그보다 커지지 않는다.
같은 좌표에 대한 역지오코딩은 `refreshActiveLayers`에서 **1회만** 수행해 두 레이어가
공유한다(중복 왕복 제거).

렌더 단계에서만 오피스텔에 **뷰포트 컬링**(여유 160px)을 추가했다. 아파트 경로는
`viewport=null`을 넘겨 이전과 완전히 동일하게 동작한다.

### 3. 확대 단계별 표현

오피스텔 마스터는 아파트 단지보다 훨씬 촘촘하다(서구 284, 부산진구 845). 아파트와 같은
기준(레벨 4)에서 이름 칩을 펼쳤더니 **화면이 이름표로 뒤덮여 지도가 안 보였다**(실측).

| 확대 단계(카카오 레벨) | 오피스텔 표현 |
| --- | --- |
| ≤ 3 (`OFFICETEL_DETAIL_ZOOM_LEVEL`) | 이름 칩. 겹친 그룹은 **격자로 벌려 낱개 선택 가능** |
| 4 ~ 6 (`OFFICETEL_MAX_ZOOM_LEVEL`) | 아이콘 배지. 겹친 그룹은 **개수 배지 1개**(누르면 한 단계 확대) |
| > 6 | 그리지 않고 "지도를 확대하면 오피스텔 마커가 표시됩니다." 안내 |

축소 상태의 개수 배지는 "칩 대신 뱃지" 회귀가 아니다 — 이 단계의 칩은 이름이 없어
낱개로 펼쳐도 정보가 늘지 않는 반면, 오버레이 DOM만 수백 개가 된다. 확대하면 그 자리에서
낱개 칩으로 펼쳐지고, **선택은 언제나 개별 master로만** 일어난다.

### 4. 마커 계약

`/api/officetel/markers?lawdCd=NNNNN` (읽기 전용, 신규):

```
{ success, data: { lawdCd, markers[], masterCount, excludedNoCoordinate } }
```

마커 1건: `id`(`offi-{id}`) / `officetelId` / `canonicalKey` / `displayName` / `lat` / `lng`
/ `dong` / `jibun` / `buildingDong` / `roadAddress` / `hoCnt` / `propertyType:'officetel'`.
거래 이력·가격은 **담지 않는다**. master 전체 행도 내리지 않는다.

`Cache-Control: public, s-maxage=600, stale-while-revalidate=3600` — master는 배치 적재로만
바뀌는 준정적 데이터라 CDN 재사용이 안전하다.

### 5. identity

이동은 **항상 `/officetel/{master id}`**. 이름/부분주소/느슨한 검색/첫 결과 매칭 경로를
만들지 않았다. 마커 id는 `offi-` 접두사를 붙여 아파트 마커 id(aptSeq 또는 `dong-name`)와
절대 충돌하지 않는다.

### 6. 좌표 공유(SITE_LEVEL) 79건

동일 좌표 그룹 32개 / master 79건 / 최대 5개(실측). **좌표가 같다는 이유로 합치지 않는다.**
기존 격자 전개가 그대로 처리한다 — 확대 상태에서 5개가 각각의 칩으로 벌어지고, 각 칩이
자기 master id로 이동한다(실측: 사하구 `퀸즈타운W 사하` 5개 → 클릭한 칩이 `/officetel/811`).

## 구현 내용

| 파일 | 내용 |
| --- | --- |
| `src/lib/officetel/map-marker-contract.ts` (신규) | 순수 계약. lawdCd 파싱, 좌표 유효성(널/NaN/Infinity/0,0 제외), 마커 id 접두사, 주소 한 줄, 렌더 상한/확대 임계값 상수 |
| `src/lib/officetel/map-marker-contract.test.mjs` (신규) | 위 계약 8개 테스트 |
| `src/lib/officetel/map-marker-read.ts` (신규) | 구 단위 master 조회 → 마커 변환. 이력 조인 없음. 이름 폴백은 `detail-contract`의 기존 함수 재사용 |
| `src/app/api/officetel/markers/route.ts` (신규) | 읽기 전용 라우트. 실패는 500 그대로(빈 배열 위장 금지) |
| `src/app/map/page.tsx` | 오피스텔 레이어 state/fetch/클러스터/칩/카드, 로딩·빈·오류 문구, 클러스터링 제네릭화 |
| `scripts/officetel/map-layer-coverage.ts` (신규) | 16개 구 커버리지 실측(READ ONLY) |
| `scripts/officetel/map-layer-qa-cases.ts` (신규) | QA 케이스 추출(READ ONLY) |

DB/스키마/마이그레이션/인덱스 변경 **없음**. Production 쓰기 **없음**.

## 발견하고 고친 결함

1. **레이어 토글 1회에 마커 요청이 중복 발사** — `setLayers` **업데이터 함수 안에서**
   fetch를 하고 있었다. React는 업데이터를 순수 함수로 보고 개발 모드에서 일부러 두 번
   호출하므로 요청이 2배가 된다(실측: 토글 1회에 `/api/officetel/markers` 4회 관측, 그중
   2건 503). 상태 갱신과 부수효과를 분리했다 — 같은 문제가 있던 **아파트/학교 레이어에도
   함께 적용**된다. 수정 후 토글 1회 = 요청 1회(실측).
2. **지도 확대 단계와 state가 어긋날 수 있었다** — `<KakaoMap level={4}>`가 하드코딩이라
   공유 링크의 `zoom`이 `zoomLevel` state에만 들어가고 실제 지도는 항상 레벨 4로 떴다.
   오피스텔 레이어는 확대 단계로 표시 여부를 판단하므로 "확대하면 보입니다"가 잘못 뜬다.
   `level={zoomLevel}`로 묶어 두 값이 항상 수렴하게 했다(공유 링크 zoom 복원도 함께 동작).
3. **하단 배너 겹침** — 준비중 안내와 로딩 안내가 각각 `bottom:76px` 절대배치라 동시에
   뜨면 서로 완전히 겹쳤다(오피스텔 안내가 추가되며 3개가 겹칠 수 있게 됨). 세로 스택으로 묶었다.
4. **"없음" 오표시 한 프레임** — 마커가 막 도착한 프레임에서는 클러스터가 아직 계산 전인데
   "표시할 오피스텔이 없습니다"로 읽힐 수 있었다. 어느 마커 목록으로 계산됐는지를 함께
   기록해 계산 전 상태와 진짜 0건을 구분한다.

## 문구

- 로딩: 아파트만 `주변 아파트를 불러오는 중...` / 오피스텔만 `주변 오피스텔을 불러오는 중...`
  / 둘 다 `주변 부동산 정보를 불러오는 중...` — **"매물"이라는 말을 쓰지 않는다**(마커는
  매물 인벤토리가 아니다).
- 빈 범위: `현재 지도 범위에 표시할 오피스텔이 없습니다.` (그 구에 좌표 미해결 master가
  있으면 그 수를 함께 알린다)
- 조회 실패: `오피스텔 정보를 불러오지 못했습니다.` — **FAILED ≠ ZERO**
- 축소 상태: `지도를 확대하면 오피스텔 마커가 표시됩니다.`
- 렌더 상한 초과: 못 그린 곳 수를 명시(silent truncation 금지)

## 테스트 결과

- `node --experimental-strip-types --test` (officetel/map 8파일): **58/58 PASS**
- `npx tsc --noEmit`: `src/` 신규 오류 **0**. 저장소 전체는
  `FAIL_EXISTING_SCRIPT_ERRORS`(scripts/education, scripts/list-zips, tmp/ 등 기존 오류만)
- `npx eslint` (이번 STEP 변경 6파일): **0 problems**
- `npm run build`: 성공
- 16개 구 READ 계층 실측: marker **5,048** / master **5,056** / excluded **8** /
  집계 불일치 구 **0** / 구별 쿼리 21~101ms

## 알려진 제한

**READY**
- 부산 16개 구 오피스텔 메인 지도 레이어(저장 좌표 5,048개)
- 마커 → 기본정보 카드 → `/officetel/[id]` 정확 이동
- 아파트 ↔ 오피스텔 레이어 전환

**LIMITED**
- SITE_LEVEL 공유 좌표 79건(32그룹): 위치는 부지 기준이라 건물별로 정확하지 않다.
  identity는 각자 유지되며 확대하면 낱개로 선택할 수 있다.
- 축소 상태(레벨 4~6)에서는 이름이 아니라 아이콘/개수 배지로만 보인다.
- 레벨 7 이상에서는 마커를 그리지 않는다.
- 레이어 토글 칩 높이 33px(기존 UI) — 44px 권장치 미만. 이 STEP에서 바꾸면 우측 컨트롤
  전체 레이아웃과 safe-zone이 달라져 아파트 지도에 영향이 있어 손대지 않았다.

**NO DATA**
- 좌표 미해결 master **8건**(동구1·부산진구1·동래구1·남구3·강서구1·사상구1)은 지도에
  올리지 않는다. 상세 페이지는 그대로 사용 가능하다.

**DEFERRED**
- 전국 오피스텔 지도, 통근/거리 점수, 거래가 기반 마커 분석

## 다음 STEP 권고

`OFFICETEL_MAP_SEARCH_HANDOFF_V1` — 검색창(`ApartmentAutocomplete`)에서 오피스텔을
고르면 지도가 그 좌표로 이동하며 해당 마커가 선택된 상태로 열리게 한다. 현재 검색
자동완성은 오피스텔 결과를 반환하지만 지도는 `type==='APARTMENT'`만 처리하므로,
오피스텔을 고르면 선택 상태가 만들어지지 않는다(마커 자체는 정상 표시).
