# E-JIP SCORE V2 — STEP 0.5: Transport Data Truth Audit

- 작성일: 2026-08-23
- Worktree: `D:\anti2\aaa\real-estate-app\.worktrees\score-v2-step0-forensic-audit`
  (STEP 0과 동일 worktree/branch — "0.5"라는 이름 그대로 STEP 0의 직접 연속
  조사, 별도 branch 신설 지시 없었음)
- Branch: `score-v2-step0-forensic-audit`
- 성격: **RAW DATA TRUTH AUDIT ONLY.** Score formula/weight 변경 없음, DB
  write 없음, migration 없음, production write 없음, main merge 없음.

## 0. 결론 요약(먼저)

STEP 0이 "peer 8곳이 더 가깝다"고 보고한 것은 **정확히는 7곳**(경미한
오차, 정정)이며, **거리 계산 자체(좌표→station까지 Haversine)는 완벽하게
정확했다**(실측 재계산 델타 0~1m). 서대신역/동대신역은 실제로 존재하는
서로 다른 역(654~767m 이격)이며 좌표 오류·중복 POI가 아니다.

**그러나 그 "더 가까운 7곳"을 자세히 파보니 새로운, STEP 0에서 발견하지
못한 심각한 문제가 나왔다**: 7곳 전부(100%) `roadAddress`/`jibunAddress`/
`mgmBldrgstPk`(건축물대장 연결)가 없고, `totalHouseholds`도 없으며, 그중
5곳은 `geocodeQuality='normalized'`(주소가 아니라 "동+건물명" 키워드 검색
좌표)다. 서대신동2가·동대신동 일대를 지하철 거리 오름차순 TOP 20으로
보면 **20곳 중 18곳(90%)이 이 "registry 미연결" 그룹**이고, 실제
건축물대장에 등록된 대단지(대신해모로 733세대, 대신푸르지오2차 815세대)는
각각 8위·16위로 밀려나 있다. 부산 전체로 확대하면 **ApartmentMaster
3,401건 중 1,725건(50.7%)이 이 "고위험 조합"(normalized geocode+주소없음+
registry 미연결)**이다 — 서대신동 국지적 사례가 아니라 **부산 전역
transport peer pool의 구조적 특성**이다.

**root cause = E(PEER_UNIVERSE_ERROR, 확정) + B(APARTMENT_COORDINATE_ERROR,
의심·미확정)**. A(순수 모델 문제)도 여전히 유효하지만 이번 STEP으로
"모델 문제만"이 아니라 "peer 구성 자체의 데이터 품질 문제"가 추가로
확인됐다.

**TRANSPORT_DATA_TRUSTED = PARTIAL**(대상 단지 자신의 raw distance는
신뢰 가능. peer 비교 대상 구성은 신뢰 불가 — 절반이 검증 안 된 소규모/
비주소 항목).
**SCORE_V2_STEP1_READY = NO** — weight 재설계 전에 peer 구성 정제가
선행돼야 한다(§14/§16).

---

## 1. 두 단지 identity 확정

```
대신해모로센트럴아파트
  aptSeq        26140-1356
  normalizedName 대신해모로센트럴
  lawdCd(sggCd) 26140
  dong(umdName) 서대신동2가 (umdCd 10500)
  jibun         576
  roadAddress   부산광역시 서구 대티로 178 (서대신동2가)
  jibunAddress  부산광역시 서구 서대신동2가 576번지
  좌표          35.11090321028151, 129.0106006132854
  geocodeQuality exact
  buildYear/households 2022 / 733

협성르네상스(서구)
  aptSeq        26140-51
  normalizedName 협성르네상스
  lawdCd(sggCd) 26140
  dong(umdName) 서대신동3가 (umdCd 10600)
  jibun         694-1
  roadAddress   부산광역시 서구 대티로 159 (서대신동3가)
  jibunAddress  부산광역시 서구 서대신동3가 694-1번지
  좌표          35.11304170905226, 129.010002813048
  geocodeQuality exact
  buildYear/households 2001 / 489
```

두 단지 모두 `geocodeQuality='exact'`(도로명/지번 주소 매칭 성공, 이름
검색이 아님) — **자기 자신의 좌표는 최고 신뢰 등급**이다. 동명이
단지/identity 오류 없음(도로명주소가 서로 다른 실제 건물임을 확인,
"협성르네상스"라는 이름은 부산에 5건 존재하지만(STEP 0에서 이미 확인)
이번 대상은 명확히 서구 서대신동3가 1건으로 고정).

---

## 2. 실제 사용된 subway raw feature 추적

두 단지의 `ApartmentLocationFeature`(`nearestSubwayDistanceM`/
`nearestSubwayName`) 원본:

```
대신해모로: nearestSubwayDistanceM=140, nearestSubwayName="서대신역 부산1호선",
            subwayCount1000m=2, source="kakao_local_api", fetchedAt=2026-08-19T16:18:51Z, qualityFlag=complete
협성:      nearestSubwayDistanceM=306, nearestSubwayName="서대신역 부산1호선",
            subwayCount1000m=2, source="kakao_local_api", fetchedAt=2026-08-19T16:19:02Z, qualityFlag=complete
```

값의 출처: `src/lib/apartment-score/collectors/location.ts` →
`categorySearch('SW8', lat, lng, 1000)`(Kakao Local category API, 반경
1000m, `sort=distance`) → 응답 `documents[0].distance`를 `Math.round()`한
값이 `ApartmentLocationFeature.nearestSubwayDistanceM` 컬럼에 그대로
저장됨(STEP 0에서 이미 코드로 확인한 경로를 이번 STEP에서 실제 DB
row로 재확인).

---

## 3. 대신해모로보다 가깝다고 판정된 peer 전부(정정: 8개 아니라 7개)

`scripts/apartment-score/step05-01-transport-truth-audit.ts` 실행 결과,
대신해모로 LOCAL peer(서대신동2가, 19곳) 중 `nearestSubwayDistanceM < 140`인
row는 **7개**다(STEP 0 문서의 "peer 8곳"은 정확한 카운트가 아니라 눈대중
표현이었음 — 이 자리에서 정정한다):

| 순위 | 거리 | 사용 역 | 단지명 | aptSeq | 좌표 | geocodeQuality | roadAddress | totalHouseholds |
|---|---|---|---|---|---|---|---|---|
| 1 | 38m | **동대신역** | 희망센츄럴타운 | 26140-37 | 35.11018,129.01735 | normalized | 없음 | 없음 |
| 2 | 61m | 서대신역 | 서대신엔스타(278-2) | 26140-1081 | 35.11038,129.01235 | exact | 없음 | 없음 |
| 3 | 65m | **동대신역** | 위너스빌 | 26140-159 | 35.11038,129.01702 | normalized | 없음 | 없음 |
| 4 | 78m | **동대신역** | 한우리빌리지5차 | 26140-1239 | 35.11005,129.01694 | exact | 없음 | 없음 |
| 5 | 108m | **동대신역** | (76-0) | 26140-208 | 35.11074,129.01666 | normalized | 없음 | 없음 |
| 6 | 116m | **동대신역** | 경남 | 26140-25 | 35.11098,129.01675 | normalized | 없음 | 없음 |
| 7 | 128m | 서대신역 | 대진골든빌리지 | 26140-26 | 35.11118,129.01350 | exact | 없음 | 없음 |
| — | **140m** | 서대신역 | **대신해모로센트럴(대상)** | 26140-1356 | 35.11090,129.01060 | exact | **있음** | **733** |

**핵심 관찰 1**: 7개 중 5개(38/65/78/108/116m)는 대신해모로가 쓰는
**서대신역이 아니라 654~767m 떨어진 별개 역 "동대신역"**까지의 거리다.
같은 "서대신역"으로 대신해모로보다 실제로 더 가까운 곳은 **61m 서대신엔스타,
128m 대진골든빌리지 2곳뿐**이다.

**핵심 관찰 2(신규, STEP 0에서 못 본 것)**: 7개 전부 `roadAddress`/
`jibunAddress`/`mgmBldrgstPk`(건축물대장 총괄표제부 연결)/`totalHouseholds`가
**전부 null**이고, `TradeHistory`에 해당 이름으로 매매 기록도 **0건**이다
— MOLIT 실거래 데이터에 존재하긴 하나(그래서 ApartmentMaster에 aptSeq가
있음) 건축물대장 조인도, 이름 매칭 거래 이력도 없는 **"registry-thin"**
항목들이다. "위너스빌", "경남", "(76-0)"(지번 그대로가 이름)처럼 이름
자체가 소규모 다세대/연립 성격을 강하게 시사한다.

---

## 4. 8개(정정: 7개) peer 좌표 sanity check

- **좌표가 실제 주소와 동일 지역인지**: 5개 모두 서구 서대신동2가~동대신동
  권역 내 좌표(위경도 범위 정상, 타 지역 아님) — 지리적으로 말이 안 되는
  좌표는 없음.
- **다른 아파트 좌표 fallback 여부**: LOCAL peer 19곳 내 좌표 중복 **0건**
  (동일 좌표를 공유하는 쌍 없음).
- **동일 좌표 과다중복**: 0건(위와 동일).
- **역 좌표와 비정상적으로 겹침**: 없음(가장 가까운 38m도 역 좌표와
  명확히 분리된 별개 지점).
- **0~20m 같은 비현실적 값**: 0건(LOCAL peer 19곳 중 최솟값 38m,
  §13에서 부산 전체 기준으로도 5m 이하 0건 재확인).
- **POI/주소 geocode mismatch**: **직접 확인 불가**(애초에 roadAddress/
  jibunAddress 자체가 없어 "주소와 좌표가 일치하는지" 비교할 기준 주소가
  없음 — 이것 자체가 §12 root cause 판정의 핵심 근거). `geocodeQuality='normalized'`인
  5건은 `apartment_master_seed.ts:geocode()`의 3순위 로직(`{동} {건물명}`
  Kakao 키워드 검색)으로 채워진 좌표라, 실제 그 이름의 건물이 다른 곳에
  있어도(동명 건물 오매칭) 걸러낼 방법이 원본 데이터에 없다 — STEP 0
  이전 세션(SCHOOL V2 계열)에서 이미 "스카이맨션이 경기도 부천시로
  오매칭"된 사례가 이 프로젝트에 실제로 기록돼 있어(동일한 위험
  패턴), **이 5건 좌표의 정확성은 "확인됨"이 아니라 "미검증"으로
  분류한다**(오류라고 단정하지도, 정확하다고 단정하지도 않음 — B
  root cause를 SUSPECTED로만 표기하는 이유).

---

## 5. 역 station identity 검증 — 실시간 Kakao 재조회(read-only)

`scripts/apartment-score/step05-02-station-and-haversine.ts`로 대신해모로/
협성 좌표 각각에서 실시간 `SW8`(지하철) 카테고리 검색(반경 1000m,
`sort=distance`) 재실행:

```
대신해모로 기준: 140m 서대신역 부산1호선(35.11091,129.01213), 654m 동대신역 부산1호선(35.11032,129.01773)
협성 기준:      306m 서대신역 부산1호선(35.11091,129.01213, 좌표 동일), 767m 동대신역 부산1호선(좌표 동일)
```

**서대신역/동대신역은 실제로 존재하는 서로 다른 두 역(부산1호선)이며,
좌표도 두 단지 조회에서 완전히 일치한다(같은 물리적 위치를 가리킴,
좌표 오류·중복 POI 아님).** 각 반경 검색에서 SW8 결과는 **역당 정확히
1건**만 나온다 — **Kakao의 SW8 카테고리 데이터는 "역 대표점(station
center)" 단위이며, 출입구/게이트별 개별 POI가 아니다**(STEP 0에서 추정만
했던 것을 이번 STEP에서 실측으로 확정). 이는 이 프로젝트의 collector
버그가 아니라 **Kakao Local이 공개하는 지하철 POI 데이터 자체의
granularity 한계**다 — 더 세밀한(출입구별) 데이터가 필요하면 다른
공식 소스가 필요하며, 이번 STEP 범위에서 그런 소스는 찾지 못했다
(NOT_AVAILABLE로 분류, 새 유료 API 추가는 원칙8 위반이라 시도하지 않음).

---

## 6-7. 협성/대신해모로 transport 완전 분해(side-by-side)

`scripts/apartment-score/step05-01-transport-truth-audit.ts` 실행(각자
LOCAL peer 기준, TRANSPORT_SUBWEIGHTS 45/25/18/12 그대로):

| sub-metric(weight) | 대신해모로(peer n=19) | 협성(peer n=29) |
|---|---|---|
| nearestSubwayDistanceM(45) | raw **140m** → percentile 61.1 → 기여점수≈60.0 | raw **306m** → percentile **96.4** → 기여점수≈91.8 |
| subwayCount1000m(25) | raw 2 → percentile 50.0 → 기여점수≈50.0 | raw 2 → percentile 62.5 → 기여점수≈61.3 |
| nearestBusStopDistanceM(18) | raw 60m → percentile 64.7 → 기여점수≈63.2 | raw 58m → percentile 74.1 → 기여점수≈71.7 |
| busStopCount300m(12) | raw 25 → percentile 100.0 → 기여점수≈95.0 | raw 19 → percentile 77.8 → 기여점수≈75.0 |
| **transport 합산(가중평균)** | **62**(공식 재확인) | **79**(공식 재확인) |

**결론**: 지하철 거리 하나가 아니라 4개 sub-metric 전부에서 협성이
우세하지만(버스거리 제외), **격차의 대부분(45% weight)은 지하철
거리 sub-metric에서 발생**한다 — 대신해모로가 raw 절대값(140m)은
압도적으로 좋은데도 percentile이 61%에 그치는 이유가 §3/§4의 peer
오염(7개 중 5개가 다른 역 기준, 7개 전부 registry-thin)임을 재확인.
버스정류장 개수(busStopCount300m)는 반대로 대신해모로가 우세(25개 vs
19개, percentile 100 vs 77.8)하지만 weight가 12%뿐이라 총점 역전에는
못 미친다.

---

## 8. peer universe 정확성

코드 재확인(STEP 0과 동일, 변경 없음): transport LOCAL peer = **같은
umdName(행정동) 전체**, 건물 유형(아파트/오피스텔/다세대)이나 registry
연결 여부를 **전혀 필터링하지 않는다**(`peer-groups.ts`에 그런 조건
없음).

```
대신해모로(서대신동2가) LOCAL peer = 19건
  households 있음(등록 아파트) = 2건(11%)
  geocodeQuality=normalized     = 12건(63%)
  주소(road+jibun) 둘 다 없음     = 17건(89%)

협성르네상스(서대신동3가) LOCAL peer = 29건
  households 있음(등록 아파트) = 8건(28%)
  geocodeQuality=normalized     = 18건(62%)
  주소(road+jibun) 둘 다 없음     = 21건(72%)
```

**두 단지 모두 자신의 LOCAL peer pool 과반이 "registry 미연결" 항목이다**
(대신해모로 89%, 협성 72%) — 대신해모로 쪽이 더 심각하다. 오피스텔
여부를 직접 구분하는 필드는 ApartmentMaster에 없어 "오피스텔이 섞였는지"는
확정할 수 없으나, 이름 패턴("빌리지", "빌라", "(지번만)")과 registry
데이터 전무는 다세대/연립/소규모 건물일 가능성을 강하게 시사한다.
동일 단지 중복은 없음(§4 좌표 중복 0건과 일치), 폐기된 ApartmentMaster는
이번 STEP에서 별도 플래그가 없어 확인 불가(NOT_AVAILABLE).

---

## 9. 거리 monotonic sanity test

`scripts/apartment-score/step05-05-monotonic-and-peer-quality.ts` —
서대신동2가/3가 + 동대신동1~3가(대신해모로·협성이 속한 5개 동) 전체를
지하철 거리 오름차순 TOP 20:

```
 1.  38m 동대신역 | 희망센츄럴타운(서대신동2가)   | households=없음 | geo=normalized
 2.  61m 서대신역 | 서대신엔스타(서대신동2가)     | households=없음 | geo=exact
 3.  65m 동대신역 | 위너스빌(서대신동2가)         | households=없음 | geo=normalized
 4.  78m 동대신역 | 한우리빌리지5차(서대신동2가)  | households=없음 | geo=exact
 5. 108m 동대신역 | (76-0)(서대신동2가)           | households=없음 | geo=normalized
 6. 116m 동대신역 | 경남(서대신동2가)             | households=없음 | geo=normalized
 7. 128m 서대신역 | 대진골든빌리지(서대신동2가)   | households=없음 | geo=exact
 8. 140m 서대신역 | 대신해모로센트럴(서대신동2가) | households=733  | geo=exact  ← 첫 등록 대단지
 9. 141m 동대신역 | 골든캐슬(동대신동2가)         | households=없음 | geo=normalized
10. 142m 동대신역 | 향원에이스타운(서대신동2가)   | households=없음 | geo=exact
11. 143m 동대신역 | 오현예다움(서대신동2가)       | households=없음 | geo=normalized
12. 170m 동대신역 | 대신메트로빌(서대신동2가)     | households=없음 | geo=normalized
13. 180m 동대신역 | 동대맨션(동대신동1가)         | households=없음 | geo=normalized
14. 198m 동대신역 | 신우빌라(서대신동2가)         | households=없음 | geo=normalized
15. 204m 동대신역 | 툇마루家(서대신동2가)         | households=없음 | geo=exact
16. 212m 서대신역 | 대신푸르지오2차(서대신동2가)  | households=815  | geo=exact  ← 두번째 등록 대단지
17. 216m 동대신역 | 삼익(동대신동2가)             | households=없음 | geo=normalized
18. 228m 서대신역 | 보람(서대신동2가)             | households=없음 | geo=normalized
19. 235m 동대신역 | 석포로얄캐슬3차(서대신동2가)  | households=없음 | geo=normalized
20. 238m 동대신역 | 세진골든빌리지(동대신동2가)   | households=없음 | geo=normalized
```

**TOP 20 중 18곳(90%)이 households=없음(registry 미연결)**이고, 등록
확인된 대단지는 8위(대신해모로)·16위(대신푸르지오2차) 딱 2곳뿐이다.
FLAG: "역 바로 앞 단지 → 더 먼 단지" 순서 자체는 각 항목의 raw 좌표
기준으로는 monotonic하다(오름차순이 실제 거리 오름차순과 일치, 계산
로직 문제 아님) — **문제는 순서가 틀린 게 아니라, 그 순서에 낄 자격
(registry 검증)이 없는 항목이 사실상 순위 전체를 채우고 있다는 것**이다.

---

## 10. raw distance 직접 재계산(Turf/Haversine)

`scripts/apartment-score/step05-02-station-and-haversine.ts` — 위 §5에서
실측한 역 좌표를 그대로 써서 9개 단지(대상 2곳 + peer 7곳) 전부 재계산:

| 단지 | stored | recomputed(Turf Haversine) | delta |
|---|---|---|---|
| 대신해모로센트럴 | 140m | 139m | -1 |
| 협성르네상스 | 306m | 306m | 0 |
| 희망센츄럴타운 | 38m | 38m | 0 |
| 서대신엔스타 | 61m | 62m | +1 |
| 위너스빌 | 65m | 65m | 0 |
| 한우리빌리지5차 | 78m | 78m | 0 |
| (76-0) | 108m | 108m | 0 |
| 경남 | 116m | 116m | 0 |
| 대진골든빌리지 | 128m | 128m | 0 |

**delta가 전부 -1~+1m(반올림 오차 수준)** — **거리 계산 로직(F) 자체는
완전히 정확하다.** 이번 STEP의 가장 명확한 결론 중 하나: 저장된 값과
좌표 기준 재계산값이 사실상 100% 일치하므로, 이 단계에서의 계산 버그는
**없다**. 문제는 계산이 아니라 §3/§8에서 확인한 **입력(peer 구성·좌표
신뢰도)** 쪽에 있다.

---

## 11. 사용자 현장 사실과 데이터 비교

```
사용자 관찰: 대신해모로센트럴 = 엘리베이터에서 출입구까지 수십 초
데이터 확인: 140m(도보 약 2분 미만) — 절대적으로 매우 가까움, 모순 없음.
             사용자 체감과 raw 숫자 자체는 일치한다.

사용자 관찰: "서대신동/동대신동에 더 가까운 단지는 사실상 없다"
데이터 확인: 같은 서대신역 기준으로는 실제로 2곳(61m/128m)만 더 가깝다
             — 등록된 대단지 기준으로는 대신해모로가 사실상 최상위(§9,
             registry 확인된 단지 중 1위). "동대신역까지의 거리"까지
             섞어서 "더 가까운 7곳"이라 표현한 STEP 0의 서술이
             사용자 체감과 어긋난 진짜 원인이었다.

사용자 관찰: 협성르네상스 = 실제 도보 약 7~8분
데이터 확인: 306m(도보 약 4~5분 상당) — 사용자 체감(7~8분)보다 raw
             수치가 다소 더 가깝게 나온다. 정확히 반대는 아니지만
             완전히 일치하지도 않음 — DATA_QUALITY_SUSPECT까지는 아니고
             "도보 환산은 안 하는 프로젝트 원칙(SCHOOL V2/C5-A와 동일)"
             범위 안의 정상적 오차로 판단(직선거리와 실제 보행경로의
             차이, §5 station-center 한계와 결합 가능).
```

**판정: DATA_QUALITY_SUSPECT는 "협성 도보 7~8분"이 아니라 "대신해모로
peer 7곳" 쪽에 적용된다** — 사용자의 절대 체감(대신해모로가 매우
가깝다)은 raw 데이터와 완전히 일치했고, 어긋난 것은 "그보다 가까운
7곳"이라는 STEP 0의 **peer 집계 표현**이었다.

---

## 12. root cause classification

```
A. SCORE_MODEL_ONLY               — 부분 해당(peer-relative 설계 자체는 STEP 0 결론 그대로 유효)
B. APARTMENT_COORDINATE_ERROR     — SUSPECTED, 미확정(§4: normalized 5건 좌표 검증 불가,
                                     오류로 단정할 증거도 없음 — CLAUDE.md §13 원칙대로
                                     "확인 안 됨"으로 남김)
C. STATION_COORDINATE_ERROR       — 아니다(RULED OUT, §5 실측 확인)
D. STATION_IDENTITY_ERROR         — 아니다(RULED OUT, §5 — 서대신역/동대신역은 실존하는 별개 역)
E. PEER_UNIVERSE_ERROR            — **확정, 이번 STEP의 핵심 발견**(§3/§8/§9: peer pool이
                                     registry 미연결 소규모 항목으로 과반~90% 오염)
F. DISTANCE_CALCULATION_ERROR     — 아니다(RULED OUT, §10 — 재계산 delta 0~1m)
G. TRANSPORT_COMPONENT_WEIGHTING  — 기여(§6/§7: 45% weight가 걸린 sub-metric에서 문제가
                                     발생해 총점 영향이 컸음 — STEP 0 결론과 일치, 신규 아님)
H. DUPLICATE_POI                  — 아니다(RULED OUT, §5 — 역당 1건, 중복 없음)
I. DATA_STALENESS                 — 아니다(두 단지 모두 2026-08-19 수집, validUntil 2026-09-18 이내)
J. UNKNOWN                        — 해당 없음(충분히 설명됨)
```

**최종 판정: 주 원인 = E(확정), 보조 원인 = B(의심)+A/G(STEP 0에서 이미
확인된 모델 설계 특성). C/D/F/H/I는 전부 이번 STEP 실측으로 배제됐다.**

---

## 13. 부산 교통 데이터 영향범위(read-only 추정)

`scripts/apartment-score/step05-04-busan-impact-scan.ts` — 부산 좌표
확보 ApartmentMaster 3,401건 전수:

```
geocodeQuality='normalized'                       1,734건 (51.0%)
geocodeQuality='exact'                             1,667건
주소(road+jibun) 둘 다 없음                        2,012건 (59.2%)
totalHouseholds 없음(건축물대장 미연결)            2,092건 (61.5%)

[고위험 조합] normalized + 주소없음 + registry미연결  1,725건 (50.7%)

좌표 중복 그룹(부산 전체)                          7건(22 row) — 미미한 수준
nearestSubwayDistanceM <= 5m(비현실적 의심)         0건 — 없음
```

**서대신동 사례는 예외가 아니라 부산 전체 패턴의 축소판이다** — 부산
ApartmentMaster의 **절반 이상(50.7%)**이 이번 STEP에서 확인한 "고위험
조합"에 해당한다. transport 카테고리는 이 항목들을 peer pool에서
걸러내지 않으므로, **대신해모로/협성 사례와 유사한 왜곡이 부산 전역의
transport percentile 계산에 광범위하게 존재할 가능성이 높다**(개별
건별 검증은 이번 STEP 범위 밖, 전수 검증은 별도 STEP 필요). 좌표 중복과
비현실적 근접값(≤5m)은 미미해 이 두 항목은 문제의 핵심이 아니다.

---

## 14. Score V2 STEP 1 진행 가능 여부

```
SCORE_V2_STEP1_READY = NO
```

raw distance 계산 로직(F) 자체는 완전히 정확하지만(§10), **peer universe
구성(E)이 부산 전역 50.7% 규모로 오염돼 있어(§13)**, 지금 상태로
weight 재설계(STEP 1)를 진행하면 **오염된 peer 위에 새 weight를 얹는
꼴**이 된다 — 근본 원인을 해소하지 않은 재설계는 같은 왜곡을 다른
비율로 재현할 뿐이다. **먼저 TRANSPORT(및 다른 카테고리도 영향받을 수
있는) peer pool에 registry 연결 여부/주소 존재 여부 기반 최소 품질
필터를 적용하는 것을 권고**(§16, 계산 로직 변경이 아니라 peer **후보
목록** 필터링이므로 STEP 0/0.5가 지킨 "formula 불변" 원칙과 배치되지
않음 — 다만 실제 구현은 이번 STEP 범위 밖, 별도 승인 필요).

---

## 15. tests/tsc/lint

STEP 0과 동일하게 순수 조회/집계 read-only 스크립트만 추가(6개:
`step05-01`~`step05-05`, production 코드 0줄 수정). `tsc --noEmit`
0 errors, `eslint` 0 errors/0 warnings(신규 파일 전수).

---

## 16. 최종 보고

```
1.  대신해모 aptSeq                    = 26140-1356
2.  협성 aptSeq                        = 26140-51

3.  대신해모 apartment coordinate      = 35.11090321028151, 129.0106006132854(geo=exact)
4.  협성 apartment coordinate          = 35.11304170905226, 129.010002813048(geo=exact)

5.  대신해모 nearest station           = 서대신역 부산1호선(35.11091,129.01213)
6.  대신해모 subway distance           = 140m(재계산 139m, delta -1)

7.  협성 nearest station               = 서대신역 부산1호선(대신해모로와 동일 좌표)
8.  협성 subway distance               = 306m(재계산 306m, delta 0)

9.  대신해모보다 가깝다고 판정된 peer count = 7건(STEP 0의 "8곳"을 이번 STEP에서 7건으로 정정)
10. peer 8개(7개) 전체 목록             = §3 표(희망센츄럴타운38m/서대신엔스타61m/위너스빌65m/
                                          한우리빌리지5차78m/(76-0)108m/경남116m/대진골든빌리지128m)
11. 실제 suspicious peer count         = 7/7(전부 registry 미연결), 그중 5/7은 다른 역(동대신역) 기준

12. station coordinate semantics       = 역 대표점(station center) 1개/역 — 출입구별 POI 없음(Kakao 데이터 한계, 버그 아님)
13. station duplicate issue            = 없음(역당 정확히 1건, 중복 POI 아님)

14. 대신해모 transport components      = subway60.0/subwayCount50.0/busDist63.2/busCount95.0 → 합산 62
15. 협성 transport components          = subway91.8/subwayCount61.3/busDist71.7/busCount75.0 → 합산 79

16. 대신해모 peer universe             = 19건(households 있음 2건=11%, 주소없음 17건=89%)
17. 협성 peer universe                 = 29건(households 있음 8건=28%, 주소없음 21건=72%)

18. stored vs recomputed distance      = 9건 전부 delta -1~+1m(사실상 완전 일치)
19. distance mismatch count            = 0건(유의미한 불일치 없음)

20. apartment coordinate error count   = 0건 확정(§4), 단 5건 SUSPECTED(미확정, normalized geocode)
21. station coordinate error count     = 0건(§5 확정)
22. peer contamination count           = 7/7건(대신해모로 peer 중 "더 가까운" 항목 전부), 동 전체 기준 89%(대신해모로)/72%(협성)

23. root cause classification          = E(확정, 주원인) + B(의심, 보조) + A/G(STEP 0 기존 결론 유효) — C/D/F/H/I 배제(§12)

24. Busan-wide impact suspected        = YES(구조적, 국지적 사례 아님)
25. affected estimated count           = 1,725건/3,401건(50.7%) 고위험 조합(§13)

26. Score code changed                 = NO
27. DB write                           = NO
28. migration                          = NO

29. docs                               = 이 문서 신규
30. commit                             = 예정(이 STEP 마지막 단계)
31. push                               = 예정
32. worktree clean                     = step05-*.ts 5개 + 이 문서 외 변경 없음(확인 예정)

33. BLOCKER                            = 없음(분석 STEP)

34. TRANSPORT_DATA_TRUSTED             = PARTIAL(대상 단지 자신의 raw distance는 신뢰 가능,
                                          peer 비교 구성은 신뢰 불가)
35. SCORE_V2_STEP1_READY               = NO — 먼저 TRANSPORT DATA(peer 품질) FIX 권고
36. NEXT_RECOMMENDATION                = ① transport(및 living/schoolAccess 등 동일 peer 구조를
                                          쓰는 카테고리) peer 후보에 최소 품질 필터(registry
                                          연결 또는 주소 존재) 적용을 별도 설계 STEP으로 검토
                                          ② normalized geocode 5건(§4)의 실제 정확성을 표본
                                          확대 검증(예: 서구 전체로 확대해 오매칭 비율 추정)
                                          ③ 부산 전체 50.7% 고위험 조합(§13)에 대한 영향
                                          범위를 다른 대표 지역(해운대/동래 등) 표본으로 재확인
                                          ④ 위 조치 완료 후에도 여전히 이상 사례가 남으면
                                          그때 STEP 1(weight 재설계) 착수
```

**E-JIP SCORE V2 STEP 0.5 종료. 결과 보고 후 멈추고 검수 대기.**
