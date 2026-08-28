# REGION_PRICE_CHANGE_MAP_V2 — 지역 변동지도

## 1. Goal

이집 통계에 "지역 변동지도"를 구현한다. 사용자가 "어디가 오르고 있고
어디가 떨어지고 있지?"라는 질문에 숫자 + 색상 + 지도로 답할 수 있게,
대한민국 → 시도 → 시군구 → 읍면동 → 단지 순으로 drill-down 가능한
가격 변동률 지도를 제공한다.

## 2. Product Question

"예쁜 지도"보다 변동률 정의와 데이터 신뢰가 우선이라는 지시에 따라,
변동률 계산 로직과 그 검증(단위 테스트 22개 + 라이브 QA)에 구현
시간의 대부분을 썼다.

## 3. Data Source

국토교통부 실거래가(MOLIT, 아파트 매매만, `type=apt`) 실시간 조회.
영구 저장된 실거래 이력 DB는 없다(기존 84㎡ 순위/가격순위 STEP과 동일한
제약) — 매 요청마다 필요한 만큼만 라이브 fetch하고 5분 캐싱한다.

## 4. Change Rate Definition

**"같은 단지 + 같은 raw 전용면적(exact area) 거래를, 선택 기간(current
window) 대표가와 그 직전 동일 길이 기간(previous window) 대표가로 pair를
만들고, 지역 단위에서는 그 pair들의 %변화율 median으로 집계한다."**

절대 "지역 내 모든 거래 가격을 그냥 평균내 기간 전후 비교"하지 않는다
— 거래되는 단지/면적 mix가 달라지면 가격 변화가 아니라 구성 변화가
상승률처럼 보일 수 있기 때문이다(§5 참고, 실제로 이 오염을 막았음을
합성 테스트로 증명함).

## 5. Composition Bias

**COMPOSITION BIAS GUARD** 단위 테스트(`region-change.test.ts`)로 직접
증명했다: 이전 기간엔 59㎡ 거래가 압도적으로 많고 현재 기간엔 84㎡
거래가 압도적으로 많은 합성 데이터(두 면적 모두 실제 가격은 변화
없음)를 넣었을 때, paired 방식은 여전히 0%를 정확히 반환한다 — 단순
평균이었다면 84㎡가 59㎡보다 비싸므로 mix 변화만으로 "크게 상승"한
것처럼 보였을 상황이다.

## 6. Pairing Rule

`buildRegionChangePairs()`(`src/lib/region-change.ts`): identity(aptSeq
우선, 없으면 name+dong) + exact raw area + dealType(sale) 조합
(`groupKey`, 기존 price-ranking.ts/regional-feed.ts와 동일한 원칙 재사용)
단위로 그룹화한 뒤, 그룹별로:

- **current** = current window(오늘 포함 최근 N개월) 안의 최신 검증
  거래
- **baseline** = previous window(그 바로 직전 동일 길이) 안의 최신
  검증 거래

두 window 모두에 거래가 있는 그룹만 pair가 된다 — 한쪽이라도 없으면
그 그룹은 이번 기간 비교에서 제외한다(억지로 채우지 않음).

## 7. Aggregation

`aggregateChangeByBucket()`: pair 목록을 임의의 bucket(지역=lawdCd,
동=dong 등)으로 나눠 **median**을 집계한다. 평균이 아니라 median을
쓴 이유는 outlier 방어(§9) 때문 — 실측: 극단값(+500%) 1건을 21개
pair 중에 주입해도 median은 거의 흔들리지 않음을 단위 테스트로
확인했다(평균이었다면 크게 왜곡됐을 것).

## 8. Periods

1개월 / 3개월 / 6개월 / 1년(12개월). `previousPeriodRange()`(기존
`regional-feed.ts` 함수 재사용)로 "current window 바로 직전, 끊김·겹침
없는 동일 길이 window"를 만든다. 예: current가 5/29~8/29(93일)이면
previous는 2/25~5/28.

**기본값은 3개월**로 정했다 — 부산 4개 구 실측(§9) 결과 1개월도 안정적
표본(16~144쌍)이었지만, 3개월이 더 안정적인 median과 최근성의 균형을
준다는 판단(spec이 제시한 "3개월 또는 6개월" 후보 중 선택).

## 9. Sample Threshold

부산 서구/연제구/해운대구/동래구 24개월 raw 거래 데이터로 window-vs-window
방식의 실제 pair 수를 감사했다:

| 구 | 1개월 | 3개월 | 6개월 | 12개월 |
|---|---|---|---|---|
| 서구 | 16 | 65 | 96 | 154 |
| 연제구 | 40 | 165 | 272 | 345 |
| 해운대구 | 67 | 267 | 436 | 562 |
| 동래구 | 40 | 171 | 327 | 419 |

시군구 단위는 모든 기간에서 충분했지만, **동 단위**로 내려가면 활동이
적은 동은 5쌍 미만인 경우가 실측 확인됐다(서구 19개 동 중 12개가
3개월 기준 5쌍 미만). 이를 근거로 `MIN_SAMPLE_PAIRS = 5`로 정했다 —
미만이면 `medianPct`/`direction`/`intensity`를 전부 `null`로 만들어
"숫자를 억지로 보여주지 않는다"(§7 지시 그대로 구현, 단위 테스트로
고정).

Confidence 4단계(`deriveConfidence`): INSUFFICIENT(<5) / LOW(5~9) /
MEDIUM(10~29) / HIGH(30+).

## 10. Neutral Range

`NEUTRAL_RANGE_PCT = 0.5`(±0.5%). 실측 median 값들(3개월 기준 서구
0.00%, 연제 0.19%, 해운대 -0.88%, 동래 0.13%)이 대부분 ±0.5% 안에
들어와, "사실상 변화 없음"의 안전한 경계로 채택했다.

## 11. Region Levels

LEVEL 0(대한민국) ~ LEVEL 4(단지) 전부 lawdCd/sidoCode 기반
identity로 구현했다(name-only 금지 원칙 준수):

- LEVEL 0: `getSidoList()`(신규, `region-utils.ts`)로 17개 시도
  code/name.
- LEVEL 1(시도 상세): `level=sigungu&sidoCode=XX` — 그 시도의 모든
  시군구.
- LEVEL 2(시군구 상세): `level=dong&lawdCd=XXXXX` — 그 시군구의 모든
  읍면동.
- LEVEL 3(동 상세)/LEVEL 4(단지): `level=complex&lawdCd=XXXXX&dong=YY`
  — 그 동의 단지별 변동률 목록(`buildComplexChangeRows`, 단지 안에
  여러 raw area가 있으면 두 window 모두에서 거래가 가장 활발했던
  대표 면적 1개만 사용 — 면적 혼합 금지, 단위 테스트로 고정).

## 12. Map Representation

행정경계 polygon/GeoJSON 데이터가 저장소 어디에도 없음을 사전
감사로 확인했다(신규 외부 데이터 파이프라인 없이는 불가능 — TRUE
GATE 대상이 아니라 §16이 명시한 안전한 V1 대체 방식을 그대로
따랐다). 대신:

- 지역명을 **Kakao Geocoder**(`services.Geocoder().addressSearch`,
  기존 `/map`·`PriceMapView`가 이미 쓰는 SDK 로딩 패턴 그대로 재사용)
  로 실시간 좌표화해 컬러 버블 + %숫자 라벨로 표시한다(좌표 추정/
  하드코딩 없음 — 실패하면 그 지역은 버블 없이 목록에서만 보인다).
  시도 레벨은 "시도명"으로, 시군구/동 레벨은 "시도+시군구(+동)"
  전체 주소로 질의해 동명이인 지역(예: 여러 시도의 "서구") 오매칭을
  방지했다.
- 지도 아래 **목록(ranking companion)**이 항상 함께 있어, 지도
  버블이 실패해도 정보 손실이 없다.
- LEVEL 3(단지) 목록은 지도 버블 없이 목록만 제공한다 — 단지 좌표를
  안정적으로 붙이려면 ApartmentMaster(부산 한정) 또는 단지별
  Kakao 키워드 지오코딩(기존에 N+1 문제로 제거된 패턴)이 필요해
  이번 STEP 범위 밖으로 뒀다(§24 Known Limitations).

## 13. Color System

- 상승 = **RED**(`var(--up-color)`, #f4361e), 하락 = **BLUE**
  (`var(--down-color)`, #3152d6), 보합 = **neutral gray** — 기존 앱
  전역 semantic color token을 그대로 재사용(새 팔레트 없음).
- 강도 4단계(대칭): 0~1% / 1~3% / 3~5% / 5%+. 실측 median 분포(구
  단위 -0.88%~3.73%, pair 단위 p10~p90 대략 ±14%)를 근거로 spec
  제시 예시 그대로 채택.
- 강도는 같은 색상의 opacity 단계로 표현하고(새 색상 발명 없음),
  **모든 곳에서 색상+숫자를 함께 표시**한다(color-only 금지, §42
  접근성 요구 그대로).

## 14. Legend

화면 상단에 상승/보합/하락 3단 legend를 항상 표시(`Legend` 컴포넌트).

## 15. Drill-down

- LEVEL 0 타일 클릭 → LEVEL 1(그 시도의 시군구 breakdown).
- LEVEL 1 지도 버블/목록 행 클릭 → LEVEL 2(그 시군구의 동 breakdown).
- LEVEL 2 지도 버블/목록 행 클릭 → LEVEL 3(그 동의 단지 목록).
- LEVEL 3 단지 행 클릭 → `/apt/{name}?lawdCd&dong`(기존 canonical
  navigation 패턴 그대로 재사용).

## 16. URL State

`/stats/change-map?level={sido|sigungu|dong}&sidoCode=XX&lawdCd=YYYYY&dong=ZZZ&period={1m|3m|6m|12m}`
— URL querystring을 단일 진실 소스로 쓴다(전역 `RegionContext`는
"대한민국 전체"/단지 레벨을 표현할 수 없어 이 화면 전용 상태를 별도로
둠, 감사 결과). 브라우저 뒤로가기가 자연스럽게 동작함을 실측 확인.

## 17. Share

새 bespoke share 로직을 만들지 않고 기존 `ShareAction`을 그대로
재사용했다. `params`로 `level`/`sidoCode`/`lawdCd`/`dong`/`period`를
전달해 공유 링크가 현재 drill-down 상태를 그대로 복원한다. title
예: "부산광역시 3개월 아파트 가격 변동지도 | 이집".

## 18. Performance

정의(§6)가 사용하는 fetch 범위는 항상 **정확히 2×period개월**로
bounded(`regionChangeFetchMonths`) — 기존 84㎡ 순위/가격순위가 쓰던
고정 24개월 lookback보다 짧아, 1개월 조회는 3개월치만, 3개월 조회는
7개월치(달력 경계 포함)만 fetch한다.

기존 sido-all 인프라(`fetchMonthsThrottledWithStatus`,
`getOrSetCache` 5분 캐시, `GLOBAL_MOLIT_CONCURRENCY=6` 전역
세마포어)를 그대로 재사용했다.

**중요한 실측 발견**: 전국(17개 시도)을 클라이언트에서 한 번에 병렬
요청하면, 서버의 MOLIT 호출 동시성이 프로세스 전역으로 공유돼(위
세마포어) 시도 17개가 6개 슬롯을 나눠 쓰게 되어 경기도 같은 큰
시도가 다른 작은 시도까지 전부 함께 느리게 만드는 문제를 실측으로
발견했다(17-way 동시 요청 시 경기도 94s, 충북 97s까지 관측). 이를
클라이언트 동시 진행 개수를 3개로 제한하는 작은 워커 큐로
수정했다(`NATION_FETCH_CONCURRENCY=3`, `RegionChangeMapView.tsx`) —
작은 시도부터 먼저 채워지고, 큰 시도가 나머지를 막지 않는다. §19에
정리한 실측치는 이 수정 이후 값이다.

## 19. Call Budget (실측)

`scripts/run-price-map-v2-qa.ts` + 직접 curl로 측정(dev 서버, cache
미스 기준):

| 요청 | districtsFetched | monthsFetched | 콜드 | 웜(캐시 히트) |
|---|---|---|---|---|
| `level=nation`(시도 목록) | - | - | 275ms | - |
| `level=sigungu` 부산(16개 구) | 16 | 7 | 13.9s | 300~500ms |
| `level=sigungu` 서울(25개 구) | 25 | 7 | 30.9s | - |
| `level=sigungu` 경기(44개+ 구, 단독 실행) | 44+ | 7 | **62s** | - |
| `level=dong` 부산 서구(1개 구) | 1 | 7 | 2.4s | 270ms |
| `level=complex` 서구 암남동(1개 동) | 1 | 7 | 67ms(이미 캐시) | 20~70ms |

**정직한 평가**: 시군구/동/단지 레벨은 어떤 지역이든 실용적인 속도(수
초 이내)다. **전국(LEVEL 0) 완전 로드는 경기도처럼 시군구가 많은
시도가 병목이 되어 콜드 기준 최대 약 1분까지 걸릴 수 있다** — 다만
동시성 제한 덕분에 작은 시도(제주/광주/대전 등)는 몇 초 안에 먼저
채워지고, 5분 캐시 이후 재방문은 즉시 로드된다. 이 실측을 근거로
최종 상태를 `NATIONWIDE = PARTIAL`로 정직하게 보고한다(§35가
지시한 "전국 진입 시 모든 동/단지를 미리 계산 금지" 원칙은
지켰고, 시도 단위까지는 완전 계산하되 그 완전성에 시간이 걸림을
숨기지 않음).

## 20. Mobile

360px/375px/390px 3개 뷰포트를 iframe-isolation 기법으로
QA했다(resize_window가 이 환경에서 정상 동작하지 않음, 기존 STEP48/
84SQM_RANKING_V1 문서에서 확립한 방법 재사용). 3개 폭 모두 가로
스크롤 없음, breadcrumb/기간칩/legend/요약카드/지도/목록/공유 버튼
전부 정상 렌더 확인.

## 21. Desktop

~1065px(브라우저 실측 뷰포트) 확인 — 좁은 중앙 정렬 컬럼 레이아웃을
유지한다(기존 통계 상세 페이지들과 동일 패턴, 모바일을 억지로 늘리지
않음). Side-by-side map+ranking 레이아웃은 이번 V1에서 구현하지
않았다(§24 Known Limitations).

## 22. Accessibility

모든 변동률은 색상과 함께 항상 `+2.3%`/`-1.8%` 텍스트로 표시한다
(color-only 금지, §42 그대로 구현). 지역 항목은 시맨틱 `<button>`
(시도 타일, 지도 버블)이거나 클릭 가능한 `<li>`(목록 행)로 키보드/탭
접근 가능하다. Legend는 항상 텍스트 라벨(상승/보합/하락)을 포함한다.

## 23. QA

### 23.1 Unit Tests(`region-change.test.ts`, 22개, 전부 pass)

Window 계산, pairing(양쪽 window 필요/취소거래 제외/raw area
비병합), **COMPOSITION BIAS GUARD**(면적 mix 역전 시나리오), **OUTLIER
GUARD**(극단값 주입 후 median 안정성), sample threshold 경계값(4/5/6),
neutral/intensity 분류 경계, interpretation 문구(표본 부족 제외/비교
대상 2개 미만 시 null/보합 1위 시 null), 단지 대표 면적 선택(활발한
쪽 우선, 면적 혼합 금지).

### 23.2 Live QA

대한민국 전체, 부산, 부산 서구/해운대구/연제구/동래구, 서울 라이브
확인. Boundary QA: `level=sigungu&sidoCode=26`의 `districts` 배열에
서구/해운대구/연제구/동래구가 실제로 존재하는지 자동 확인.

### 23.3 Automated QA(`scripts/run-price-map-v2-qa.ts`)

`RELEASE GATE: READY`, P0/P1 findings 0건. 검사 항목: level=nation
정상, districts 최소 개수, boundary QA(부산 대표 4개 구 존재),
neutral/sample threshold 서버 응답 일치, direction-부호 일치(color
mapping), N+1 없음(callBudget.districtsFetched == districts.length),
no-all-time-claim(금지 표현 부재), same-area 보존(exact area 정수
의심 패턴 INFO 로그), changePct 공식 일치, 단지당 1행.

### 23.4 회귀 스모크

기존 통계(하락/2년최고가/상승/84㎡ 순위) + `/stats` 메뉴 그리드 +
`/map`(마커/검색/공유) 전부 정상 확인.

## 24. Known Limitations

- LEVEL 3(단지) 목록에는 지도 버블이 없다(목록만) — 좌표 소스가
  마땅치 않아 이번 STEP 범위 밖으로 뒀다.
- 전국(LEVEL 0) 완전 로드는 큰 시도(경기 등) 때문에 콜드 기준 최대
  약 1분까지 걸릴 수 있다(§19).
- 영구 실거래 이력 DB가 없어 "역대"/장기 추세는 제공하지 않는다.
- Side-by-side(지도+목록 나란히) 데스크톱 레이아웃은 구현하지
  않았다(현재는 세로 스택).
- "비교하기"/"지도에서 보기(전역 /map 연동)" CTA는 이번 V1에 없다.

## 25. 전체 실거래 이력 구축 연결

영구 이력 DB가 생기면: (1) fetch 비용 없이 즉시 전국 완전 로드
가능, (2) 12개월보다 긴 기간(3년/5년) 옵션 제공 가능, (3) 진짜
"역대" 변동률 계산 가능.

## 26. 사용자 결정 여정 연결

변동지도 → 시군구/동 drill-down → 단지 상세(이미 연결됨) → 비교/
실구매 비용(향후) 순서로 자연스럽게 이어질 수 있다. Journey Engine
자체는 이번 STEP에서 구현하지 않았다.

## 27. Next Step

권장 다음 단계: (1) `TRADE_HISTORY_DATA_V1`(스키마 변경 필요, 별도
승인 후 진행 권장) — 전국 로드 성능과 장기 기간 지원을 근본적으로
개선, 또는 (2) `FIX_REGION_PRICE_CHANGE_MAP`으로 LEVEL 3 지도 버블
추가(Busan ApartmentMaster 좌표 재사용 검토).
