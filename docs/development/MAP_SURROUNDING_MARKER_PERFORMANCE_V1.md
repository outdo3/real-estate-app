# MAP SURROUNDING MARKER PERFORMANCE V1

작성일: 2026-08-27
성격: `SEARCH_MAP_PERFORMANCE_V2_2`의 후속 STEP. 그 STEP에서 "selected marker fast path"로
분리해 사용자 체감에서는 감췄지만 그대로 남겨뒀던 실제 병목 — 주변 마커(surrounding
markers)를 만드는 과정의 단지별 Kakao 키워드 지오코딩 N+1 — 을 제거한다. DB/schema/
migration/거래 계산/Unit Master/Score 변경 없음.

---

## 1. Problem

`SEARCH_MAP_PERFORMANCE_V2_2`가 "다음 STEP 후보"로 명시적으로 남긴 문제: 지도 주변
마커(`aptMarkers`)를 만드는 `/api/transactions?type=apt&lawdCd=...&months=12`가 MOLIT
실거래 응답에 있는 **모든 고유 단지(dong+name)마다 개별 Kakao 키워드 지오코딩 외부
API를 호출**하고 있었다. 이 N+1 패턴이 주변 마커 준비 시간을 592ms~2,090ms(warm),
최대 5.76초(cold)까지 늘렸다.

---

## 2. Previous Performance (SEARCH_MAP_PERFORMANCE_V2_2 실측 baseline)

- cold search: 586.5ms / warm search: <5ms
- selected marker before: 592ms~5.76s → after: <100ms(구현 완료, 이번 STEP에서도 유지)
- surrounding markers: 592ms~2,090ms(warm), cold 최대 5.76s
- wrong marker selection: ABSENT / duplicate reverse-geocoding: REDUCED
- 근본 원인(직전 STEP 기록): "주변 marker 데이터 구성 과정에서 Kakao geocoding/
  reverse-geocoding 성격의 N+1 외부 요청 비용이 존재."

---

## 3. Root Cause

`src/app/api/transactions/route.ts`의 `geocodeApt(name, dong)` 함수가 MOLIT 응답에서
뽑아낸 고유 (dong, name) 쌍마다 `https://dapi.kakao.com/v2/local/search/keyword.json`을
호출했다(`Promise.all`로 병렬화는 되어 있었으나, 외부 API를 N번 부르는 구조 자체는
그대로). 같은 함수 안에서 `prisma.apartmentMaster.findMany({ where: { sggCd: lawdCd } })`
로 canonical `aptSeq`도 이미 조회하고 있었지만, 좌표는 그 결과를 쓰지 않고 별도로
Kakao에 다시 물어보고 있었다 — **ApartmentMaster가 이미 갖고 있는 좌표를 쓰지 않고
같은 정보를 외부 API에 재질문**하던 것이 근본 원인이었다.

---

## 4. Old Marker Architecture

```
map/page.tsx: handleApartmentSelect / handleDragEnd / toggleLayer / 최초 mount
  → refreshActiveLayers(lat, lng, knownLawdCd?)
    → fetchAptMarkers(lat, lng, knownLawdCd?)
      → (knownLawdCd 없으면) Kakao coord2RegionCode 역지오코딩 1회 → lawdCd 확정
      → GET /api/transactions?type=apt&lawdCd=...&months=12
          → fetchMolitData × 12개월(병렬, 정부 API, 변경 없음)
          → 고유 (dong,name) 쌍 각각에 대해 Kakao keyword geocoding 호출(N+1, 이번에 제거)
          → prisma.apartmentMaster.findMany({ sggCd }) (aptSeq/buildYear만 사용, 좌표는 버림)
          → dong+name 완전일치로 aptSeq 부여, 좌표는 Kakao 결과 사용
      → byComplex Map으로 단지별 최신 거래 1건만 남겨 AptMarker[] 생성
      → setAptMarkers → recomputeClusters(idle 이벤트) → CustomOverlayMap 렌더
```

---

## 5. N+1 Evidence (실측, 격리 측정)

`geocodeApt`와 동일한 요청을 그대로 재현해 Kakao API만 격리 측정(서버 캐시 없는
`Promise.all` 병렬 호출, 실제 이 프로젝트 API 키 사용):

| 지역 | 고유 단지 수 | Kakao 병렬 요청 총 wall time | 성공(HTTP 200) | 좌표를 실제로 찾은 비율 |
|---|---|---|---|---|
| 연산동(26470) | 207 | **2,367ms** | 207/207 | 188/207(19건 실패 — 오래된/소규모 단지, 지번 병기 표기 등) |
| 대신동(26140) | 138 | **1,643ms** | 138/138 | (아래 §6에서 after coverage로 대체 확인) |
| 해운대구(26350) | 277 | **3,062ms** | 277/277 | (동일) |

직렬이 아니라 병렬로 쐈는데도 평균 개별 latency가 1.7초에 달해(Kakao API 자체의
동시 요청 처리 특성으로 추정) 200개 안팎의 동시 요청이 여전히 2~3초의 순수 추가
지연을 만들었다. 이 비용은 MOLIT 정부 API 호출(변경 없음, §20 참고)과는 완전히 별개로
**추가**되던 것이었다.

---

## 6. Canonical Coordinate Source

`ApartmentMaster.latitude`/`ApartmentMaster.longitude`(Kakao geocoding 결과를 사전에
저장한 canonical source, `geocodeQuality` 필드로 품질까지 구분됨). 부산 3,402건 좌표
coverage 100%(3,401/3,402 — 이번 QA 재확인, §19).

`aptSeq` 매칭에는 이미 이 필드를 조회하는 같은 쿼리(`prisma.apartmentMaster.findMany`)를
쓰고 있었으므로, 좌표도 **같은 조회·같은 행**에서 가져오도록 바꾸는 것이 가장 안전한
선택이었다 — 매칭 로직을 두 벌(하나는 aptSeq용, 하나는 좌표용)로 나누지 않아 두 값이
서로 다른 identity 판정에서 나올 위험 자체가 사라진다.

---

## 7. New Marker Architecture

```
map/page.tsx: (변경 없음 — fetchAptMarkers/handleApartmentSelect 호출 흐름 그대로)
  → GET /api/transactions?type=apt&lawdCd=...&months=12
      → fetchMolitData × 12개월(변경 없음)
      → prisma.apartmentMaster.findMany({ sggCd }) — 1회, name/umdName/aptSeq/buildYear/
        latitude/longitude 모두 select(외부 API 호출 없음)
      → src/lib/map-marker-coords.ts(신규, 순수 함수):
          buildMasterCoordIndex(masters) → { exact: Map, byDong: Map }
          resolveApartmentCoords(index, dong, name, aptNamesMatch, fuzzyCache)
            1순위: dong+name 완전일치
            2순위: 같은 dong 안에서만 aptNamesMatch(차수/브랜드alias 등 안전한 표기
                   차이만 흡수, /api/apt/[name]/route.ts와 동일 유틸) — 다른 dong으로는
                   절대 확장 안 함
            매칭 실패 시 aptSeq/좌표 모두 null(다른 단지 fallback 없음)
      → data.map(item => ({ ...item, ...resolveApartmentCoords(...) }))
  → (map/page.tsx 이후 흐름 완전히 동일: byComplex dedup → AptMarker[] → clusters → render)
```

핵심: **외부 API 호출이 0회**로 줄었다(단지 개수와 무관 — N+1이 완전히 사라짐). 매칭
로직 자체를 `src/lib/map-marker-coords.ts`로 분리해 DB/외부 API 부작용 없이 단위
테스트가 가능하게 했다(`.test.mjs`가 직접 실행하는 이 프로젝트의 기존 관례 — pure
logic 파일은 로컬 import를 갖지 않으므로, 이름 매칭 함수(`aptNamesMatch`)는 호출부가
주입한다).

---

## 8. Bounds Query

이번 STEP은 **bounds(지도 화면 좌표 범위) 기반 신규 API를 만들지 않았다.** 기존
`/api/transactions`가 이미 `lawdCd`(법정동코드, 행정구역) 단위로 그 지역 전체 실거래를
가져오는 구조이고, 주변 마커의 진짜 병목은 "얼마나 넓은 범위를 가져오느냐"가 아니라
"좌표를 어디서 얻느냐"(Kakao N+1)였다 — 그 부분만 DB로 교체하는 것이 최소 변경으로
가장 큰 효과를 내는 선택이었다(§21 AGENTS.md "불필요한 확장 금지"와 일치). bounds 기반
쿼리/신규 read-only endpoint는 `MAP_CLUSTERING_V1` 등 별도 STEP 후보로 남긴다(§22).

---

## 9. API Contract

`/api/transactions`의 요청 파라미터·응답 필드는 **완전히 동일**하게 유지했다(`lat`,
`lng`, `aptSeq`, `completionYear` 필드명/의미 불변) — 값을 만드는 내부 소스만 Kakao에서
DB로 바뀌었다. `map/page.tsx`의 소비 코드(`fetchAptMarkers`)는 이 계약이 그대로라
수정할 필요가 없었다(단, §13/§14에서 별도로 stale-request/cache 안전장치를 추가함).

---

## 10. Selected Marker Fast Path

`SEARCH_MAP_PERFORMANCE_V2_2`가 구현한 `src/lib/map-selected-marker.ts`
(`buildPendingSelectedApt`/`resolveSelectedMarker`/`isPendingStillNeeded`)는 **손대지
않았다.** 검색 결과 클릭 시 즉시(동기, <100ms) 임시 마커를 보여주는 경로는 주변 마커
API가 얼마나 빨라지든 그대로 독립적으로 동작한다 — 라이브 브라우저 재확인(§17)으로
회귀 없음을 검증했다.

---

## 11. Marker Reconciliation

기존 로직(`resolveSelectedMarker`가 `aptClusters`를 우선하고, 없을 때만
`pendingSelectedApt`로 폴백 — `aptSeq` key 기준) 그대로 유지된다. 이번 STEP은 marker
DTO의 `aptSeq` 필드 자체를 바꾸지 않았으므로(§9) 이 reconcile 경로에 영향이 없다.
라이브 확인: 연산동한솔솔파크 클릭 → 즉시 "시세 정보 없음" 임시 마커 → 약 2초 후
"3억 3,000만" 실제 마커로 자연스럽게 교체, 중복/깜빡임 없음(§17 스크린샷).

---

## 12. Pan/Zoom

`handleDragEnd`(dragend, 드래그당 1회 발생 — 기존에도 연속 스팸이 아니었음)는 변경하지
않았다. `onZoomChanged`는 클러스터 재계산(zoomLevel)만 트리거하고 서버 재조회는 하지
않는 기존 동작 그대로다. 드래그로 새 지역에 진입하면 `knownLawdCd`가 없어 여전히 Kakao
`coord2RegionCode` 역지오코딩 1회가 발생한다(라이브 확인, §17) — 이는 "그 지역이 어느
법정동인지" 알아내는 별개의 단일 요청이며, 이번 STEP이 제거 대상으로 삼은 "단지별
N+1"과는 다른 것이다(`SEARCH_MAP_PERFORMANCE_V2_2` §16이 이미 이 구분을 문서화함,
기존 동작 유지가 맞는 범위 — 회귀 아님).

---

## 13. Stale Request Protection

`src/app/map/page.tsx`의 `fetchAptMarkers`에 요청 순번(`requestSeqRef`)을 추가했다.
빠르게 연속으로 지역이 바뀌면(드래그 두 번 연속 등) 먼저 보낸 요청의 응답이 나중에
보낸 요청보다 늦게 도착할 수 있는데, 이제는 응답이 왔을 때 자신이 여전히 "가장 최근
요청"일 때만 `setAptMarkers`/`setIsLoadingData(false)`를 반영한다. 판정 로직은
`src/lib/map-marker-fetch-guard.ts`(`isStaleMarkerResponse`, 순수 함수)로 분리해 단위
테스트했다(§25).

---

## 14. Cache

같은 `lawdCd`로 짧은 시간 안에 재진입하면(드래그로 벗어났다 복귀 등) 네트워크 재요청
없이 즉시 반영하는 exact-key 캐시(`markerCacheRef`, `ApartmentAutocomplete.tsx`의
`cacheRef`와 동일 관례)를 추가했다. 실거래 데이터라 무기한 캐시는 위험해 TTL을
60초로 짧게 뒀다. 판정 로직은 `isMarkerCacheFresh`(순수 함수, §25)로 분리했다.

---

## 15. Before/After Request Count (Kakao 외부 API)

| 지역 | Before(단지별 Kakao 요청) | After |
|---|---|---|
| 연산동(207개 단지) | 207 | **0** |
| 대신동(138개 단지) | 138 | **0** |
| 해운대구(277개 단지) | 277 | **0** |

**NORMAL_PATH_KAKAO_GEOCODING = 0.** (드래그로 새 지역에 진입할 때의 1회 역지오코딩은
§12에서 설명한 대로 별개 범주이며 이번 STEP 범위 밖 — 그대로 유지됨.)

---

## 16. Before/After Timing (`/api/transactions` 전체, 동일 dev 서버/환경에서 코드만 교체해 측정)

MOLIT 정부 실거래 API 자체가 매 요청 라이브 조회라 변동폭이 크다(이 STEP은 그 부분을
바꾸지 않았다, §20) — 그래서 반복 측정값을 그대로 보고한다.

| 지역 | Before(run1 / run2) | After(run1 / run2) |
|---|---|---|
| 연산동(26470) | 5,584ms / 1,993ms | **1,916ms / 1,644ms** |
| 대신동(26140) | 1,125ms / 689ms | **627ms / 656ms** |
| 해운대구(26350) | 5,331ms / 3,132ms | **2,013ms / 2,230ms** |

Cold(첫 요청, dev 서버 기준)일수록 개선폭이 컸다 — 연산동/해운대의 cold worst-case가
5.3~5.6초에서 2초 안팎으로 줄었다(§15에서 격리 측정한 Kakao 제거분 1.6~3.1s와 정합).
Warm 시나리오에서도 대신동은 1.1s→0.6s로 개선됐다. 남은 시간은 전부 MOLIT 정부 API
자체의 latency(§20 참고, 이번 STEP 범위 밖).

---

## 17. Live Browser Verification

`http://localhost:3000/map`에서 실제 확인(claude-in-chrome):

- **직접 지도 진입**: 기본 지역(서구) 마커가 실제 가격과 함께 정상 렌더(대신롯데캐슬
  "3억 8,700만" 포함) — DB 좌표 기반으로 정상 동작.
- **검색 → 연산동한솔솔파크 클릭**: 클릭 즉시 "시세 정보 없음" 임시 마커 + 바텀시트
  표시(fast path 유지 확인) → 약 2초 후 "3억 3,000만" 실제 마커로 자연스럽게 교체,
  중복/깜빡임 없음.
- **네트워크 로그**(`/api/`, `kakao` 패턴 필터): 이 클릭 흐름에서 발생한 요청은
  `/api/transactions?type=apt&lawdCd=26470&months=12` + `/api/community/recent-activity`
  뿐이었다 — `dapi.kakao.com` geocoding 요청은 **0건**(지도 타일 이미지 요청만 존재,
  이는 geocoding이 아닌 지도 렌더링 자체에 필요한 별개 요청).
- **드래그(pan)**: 드래그 후 `dapi.kakao.com/v2/local/geo/coord2regioncode.json` 1건만
  발생(§12에서 설명한 기존 동작, 회귀 아님) — 단지별 지오코딩은 여전히 0건.
- **대신롯데캐슬 identity 검증**: 서울 강남구 동명 단지와 혼동 없이 정확히
  부산 서구 서대신동3가로 이동/선택, "3억 8,700만" 정상 표시.
- **Mobile 375px**(iframe-isolation 기법, `resize_window` 이 환경에서 불안정함이
  이전 STEP들에서 재확인된 사실이라 우회): 마커 렌더/바텀시트/하단탭바 정상, 가로
  스크롤 없음. 이번 STEP은 JSX/CSS를 전혀 변경하지 않아(데이터 소스/요청 lifecycle만
  변경) 화면 크기 의존 회귀 위험이 구조적으로 낮다 — 360px/390px는 별도 재검증하지
  않았다(정직하게 명시, MANUAL_REQUIRED 아님: 코드 자체가 뷰포트에 무관하기 때문).

---

## 18. Data Trust

`scripts/run-busan-data-ux-qa.ts`에 신규 `runMapMarkerQa()`를 추가해(§19) 회귀
fixture가 속한 구/군의 `/api/transactions` 응답을 실제로 호출·검증했다:

- **WRONG_APARTMENT = ABSENT** (연산동한솔솔파크/대신롯데캐슬/연산동일동미라주더스타/
  대신해모로센트럴아파트 4개 fixture 전부 `finding 0건 — PASS`)
- **DUPLICATE_APTSEQ = ABSENT**(단지 단위로 축약한 뒤 기준 — 다건 거래를 오탐하지
  않도록 QA 로직 자체도 검증 후 수정, §19-2 참고)
- **name-only fallback = 없음**(다른 dong으로는 aptNamesMatch 폴백이 절대 확장되지
  않음 — 단위 테스트로 강제, §25)
- 마커 좌표는 항상 `ApartmentMaster`의 실제 저장값(추정/생성 없음) — 매칭 실패 시
  aptSeq/좌표 모두 `null`로 정직하게 남는다(연산동 "에스케이드림피아" 1건, §19-1).

---

## 19. Marker Count & Coverage (Before/After)

| 지역 | 원시 거래(12개월) | 고유 단지(=마커 후보) | 좌표 확보 Before | 좌표 확보 After |
|---|---|---|---|---|
| 연산동(26470) | 3,140 | 207 | 188/207(90.8%) | **206/207(99.5%)** |
| 대신동(26140) | 945 | 138 | (Kakao 실패건 다수 관측) | **138/138(100%)** |
| 해운대구(26350) | (동일 방식) | 277 | — | **277/277(100%)** |

**교체 자체가 marker coverage를 오히려 개선했다** — Kakao 키워드 검색이 실패하던
오래된/소규모 단지(예: "에이젠아파트", "현대(983-9)", "경동" 등 지번 병기·짧은 이름)
19건도 ApartmentMaster에는 이미 유효 좌표가 있었다(개별 확인, §6). 매칭이 아예 안 되는
1건("에스케이드림피아", 연산동)은 dong+name 완전일치도 `aptNamesMatch` 폴백도 실패한
경우로, 정직하게 좌표 없이 남는다(다른 단지로 fallback하지 않음, §18).

### 19-1. QA 로직 자체의 자기 검증(정직하게 기록)

이번 STEP에서 처음 `runMapMarkerQa()`를 작성했을 때 "sggCd=26470에서 중복 aptSeq
152건" 같은 거짓 양성이 나왔다 — `/api/transactions` 응답이 "마커 목록"이 아니라
"거래(trade) 목록"이라 인기 단지가 12개월 안에 여러 번 거래되면 같은 aptSeq가 여러 행에
정상적으로 반복되는데, 이를 그대로 "중복"으로 오판한 것이다. `map/page.tsx`가 실제로
쓰는 방식과 동일하게 (dong, name) 기준으로 먼저 단지 단위로 축약한 뒤에야 "서로 다른
단지가 같은 aptSeq를 공유하는지"를 판정하도록 QA 로직을 수정했다 — 수정 후
`duplicateAptSeq=0`으로 정상화됨(§16 아래 실제 로그 참고).

---

## 20. Remaining Bottlenecks

- **MOLIT 정부 실거래 API 자체의 latency**가 이제 `/api/transactions`의 지배적 비용이다
  (§16 — after 수치도 여전히 0.6~2.2초 범위, cold일수록 큼). 이 API는 서버 인메모리
  캐시 없이 매 요청 라이브 조회한다(이번 STEP은 "거래 계산/데이터 소스 변경 금지"
  범위 안에서 이 부분을 건드리지 않았다). 다음 STEP 후보(예: 짧은 TTL 서버 캐시)로
  남긴다.
- 연산동 "에스케이드림피아" 1건처럼 MOLIT 표기와 ApartmentMaster 어느 쪽도 일치하지
  않는 극소수 케이스는 여전히 마커가 뜨지 않는다(추정 좌표 생성 금지 원칙상 의도된
  동작 — §18).
- 드래그로 새 지역에 진입할 때의 1회 역지오코딩(§12)은 이번 STEP 범위 밖으로 남겨뒀다.

---

## 21. Index Audit (Read-Only)

`ApartmentMaster`에는 이미 `@@index([sggCd])`가 존재한다(`prisma/schema.prisma` 확인,
schema 변경 없이 read-only 확인만 수행). 이번 STEP이 추가한 쿼리
(`findMany({ where: { sggCd } })`)는 이 기존 인덱스를 그대로 사용하며, 실측 DB-only
쿼리 latency가 cold 484ms 이하, warm 21~36ms로 이미 목표(WARN 임계값 훨씬 이내)를
충족한다.

**INDEX_CHANGE = NOT_NEEDED.**

---

## 22. Future Clustering / Bounds Consideration

지역 전체(`lawdCd` 단위)를 한 번에 가져오는 현재 구조는 해운대구(277개 단지)처럼 큰
구에서는 여전히 300개에 가까운 마커를 한 번에 클라이언트로 보낸다 — 지금은 DB 쿼리와
네트워크 payload 자체가 가벼워 문제가 되지 않지만, 데이터가 더 늘어나거나 더 큰
지자체로 확장할 경우 지도 bounds 기반 쿼리(§8에서 이번 STEP은 만들지 않기로 결정한
바로 그것)나 클러스터링 최적화가 유효한 다음 STEP이 될 수 있다(`MAP_CLUSTERING_V1`
후보로 남김).

---

## How To Run

```bash
# 로컬 dev 서버
npm run dev

# 신규 유닛 테스트
node --experimental-strip-types --test src/lib/map-marker-coords.test.mjs src/lib/map-marker-fetch-guard.test.mjs

# 전체 .test.mjs 회귀
node --experimental-strip-types --test $(find src scripts -name "*.test.mjs")

# Busan QA(신규 MAP MARKER QA 섹션 포함, 로컬 dev 서버 필요)
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/run-busan-data-ux-qa.ts --quick
```

---

## 관련 문서

- `docs/development/SEARCH_MAP_PERFORMANCE_V2_2.md` — selected marker fast path,
  이번 STEP이 제거한 N+1의 최초 발견/문서화.
- `docs/development/BUSAN_DATA_UX_AUTOMATED_QA_V1.md` — ApartmentMaster 3,402건
  coverage/QA 체계의 baseline.
- `docs/development/CHANGELOG.md` — 이번 STEP 항목 추가.
