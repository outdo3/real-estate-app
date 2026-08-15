# STEP 36 — APT DETAIL B2-3: 선택 평형 ↔ 시세차트/투자지표 데이터 일관성

상태: 구현 완료 / 모바일 검수중(commit/push 없음)

성격: 선택 평형(selectedArea) 필터링 + 정직한 데이터 부족 안내. 데이터 집계 방식
자체(월별 중앙값 등, 문서33에서 별도 STEP으로 분리 추천됨)나 API/DB/schema는
변경하지 않았다. 기준 commit `c9919f36ec1cd02b0c4b1e450868144daf9fe6d4`(origin/main과
동일 — §0 확인).

---

## 0. 작업 시작 전 확인

```
git status --short        → M CHANGELOG.md, M PriceTrendChart.tsx(B2-2)
                             ?? 문서33/34/35 (기존, 전부 예상대로)
git rev-parse HEAD         → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git fetch origin           → (no new refs)
git rev-parse origin/main  → c9919f36ec1cd02b0c4b1e450868144daf9fe6d4
git rev-list --left-right --count origin/main...HEAD → 0  0
```

예상과 정확히 일치, 그 외 production 변경 없음 — STOP 조건 미발생, 진행. B2-2의
`PriceTrendChart.tsx` 색상 변경은 이번 STEP 내내 그대로 유지했다(§11 확인).

## 1. 기존 불일치 재확인

`src/app/apt/[name]/apt-client.tsx` 743/746행(변경 전):

```
<PriceTrendChart aptName={aptName} lawdCd={lawdCdState} dong={urlDong} />
<InvestmentMetrics aptName={aptName} lawdCd={lawdCdState} dong={urlDong} />
```

두 컴포넌트 모두 `selectedArea`를 받지 않음(문서33 §25에서 이미 확인된 내용 재확인) —
Hero(694-735행)와 실거래 타임라인(796행, `filteredTrades`)은 `selectedArea`를
반영하는데 차트/지표는 항상 전체 평형 기준이었다.

## 2. selectedArea / internal key / display label

- **source**: `apt-client.tsx` 87행, `useState<string>('전체')`. `AreaSelector`의
  `onSelect` 콜백으로만 바뀐다.
- **'전체' sentinel**: 문자열 리터럴 `'전체'` 그대로(별도 enum/undefined 아님) —
  `AreaSelector.tsx`의 "전체" 버튼, Hero의 `selectedArea !== '전체'` 분기(282행,
  716행), 타임라인 라벨(796행) 전부 이 리터럴과 정확히 일치시켜 비교한다.
- **internal key**: 원본 `trade.area` 문자열(예: `"84.9194"`) 그대로 — Hero
  필터(282행: `trade.area !== selectedArea`)와 동일한 **문자열 완전일치** 비교다.
  `parseFloat` 등으로 변환하지 않는다.
- **display label과 key 분리**: `src/lib/area-utils.ts`의 `getUniqueAreaLabels`/
  `resolveAreaLabel`이 표시 문자열만 담당하고, key(숫자/문자열)는 절대 만들거나
  바꾸지 않는다는 원칙이 파일 최상단 주석에 명시돼 있음(B1-FIX 정책, 이번 STEP에서
  변경하지 않음) — PriceTrendChart/InvestmentMetrics도 이 정책을 그대로 따라
  `selectedArea`(내부 key)를 받아 `trade.area`와 직접 비교하고, 화면에는 아무 라벨도
  새로 만들지 않는다(§12).

## 3. PriceTrendChart / InvestmentMetrics 기존 source, aggregation

`PriceTrendChart.tsx`: `/api/apt/${aptName}?lawdCd=&type=apt|rent&period=12|36|60&dong=`를
매매/전세 독립 호출(자기완결형, 문서33 §25 재확인). `chartData`는 날짜 정렬 후
**순번(id)을 x축으로 쓰는 개별 거래 그대로**(월별 집계 없음) — 즉 "차트에 찍히는 점
개수"와 "그 기간 원본 거래 건수"가 정확히 1:1이다. 이번 STEP에서 이 구조를 바꾸지
않았다(§9).

`InvestmentMetrics.tsx`: 동일 API를 `period=6`(6개월 고정, 다른 필터와 무관)으로
호출. 매매는 날짜 최신 1건, 전세는 "매매와 같은 area"를 우선 찾고 없으면
**그냥 가장 최근 전세로 폴백**(변경 전 68행) — 이 폴백은 UI에 `*` + title 툴팁으로
이미 투명하게 안내되고 있었다(문서33 §35에서 이미 확인).

## 4. 데이터 부족 최종 기준 — PriceTrendChart

§9에서 다시 확인한 대로 현재 구현은 월별 집계를 하지 않고 원본 거래를 그대로
점으로 찍는다(x축이 실제 날짜 스케일이 아니라 정렬된 순번). 이 때문에 "거래
건수 = 차트 점 개수"가 정확히 1:1이라, **문서33 §32의 "12개월 3건 미만 6.4%"
기준(매매+전월세 합산, 다른 목적의 통계)을 이번 차트 임계값으로 그대로 재사용하지
않는다** — 대신 recharts `<Line connectNulls>`가 같은 dataKey에 **유효한 점이
최소 2개는 있어야 선분을 그린다**는 렌더링 제약 자체를 기준으로 삼았다:

- 점이 0~1개면 `dot={false}`와 맞물려 화면에 **아무것도 안 보인다**(데이터는
  있는데 완전히 빈 차트처럼 보이는, 가장 오해하기 쉬운 상태).
- 점이 2개 이상이면 실제 선이 그려져 "성긴 추이"로라도 보인다 — 실제 값 그대로라
  왜곡이 아니다.

그래서 최종 기준은 **매매/전세 각각 독립적으로 2건 미만이면 "추이를 표시하기
어렵다"고 안내**하는 것으로 정했다(코드: `PriceTrendChart.tsx`의
`MIN_TREND_POINTS = 2`). 이유를 코드 옆 주석에도 남겼다.

## 5. silent fallback 정책 — 최종 선택: A안(다른 평형 미대입 + 안내)

요청서 §8의 A~D안 중 **A안(해당 series 미표시 + 안내 문구)** 을 선택했다.
문서33 §31이 추천했던 "데이터 부족 시 전체 평형으로 자동 폴백 + 안내"(D안에
해당)는 이번 STEP에서 **의도적으로 채택하지 않았다** — 이유:

- 이번 STEP의 목적 자체가 "Hero/차트/지표가 같은 평형 기준을 쓰게 만드는 것"(§0,
  §17)이다. 차트만 조용히 전체 평형으로 돌아가면, 사용자가 84.94㎡를 선택한
  화면에서 Hero는 84.94㎡ 가격을 보여주는데 차트 선은 39~114㎡가 섞인 값을
  다시 보여주게 되어 **이번 STEP이 없애려는 바로 그 불일치를 재도입**하게 된다.
  라벨을 붙여도("전체 평형 참고") 근본적으로 "선택한 평형과 다른 기준"이라는
  점은 동일하다.
- InvestmentMetrics는 애초에 다른 평형 데이터를 끌어오지 않고 "데이터 부족"으로
  정직하게 표시하는 정책(§15)을 쓰기로 했는데, 차트만 다른 정책(전체로 대체)을
  쓰면 같은 페이지 안에서 두 컴포넌트의 "부족 시 동작 원칙"이 서로 달라져
  또 다른 혼란이 생긴다.
- 매매/전세를 **독립적으로** 판단해야 한다는 §7 요구사항과도 A안이 더 잘
  맞는다 — D안처럼 "차트 전체를 전체 평형으로 되돌리기"는 한쪽만 부족해도
  두 series 모두를 바꿔버리는 결과가 되기 쉽다.

## 6. PriceTrendChart 구현 (`src/components/PriceTrendChart.tsx`)

```diff
+ selectedArea?: string  // props에 추가

+ const isAreaFiltered = !!selectedArea && selectedArea !== '전체';
+ const saleForChart = isAreaFiltered ? (saleTrades?.filter((t) => t.area === selectedArea) ?? null) : saleTrades;
+ const rentForChart = isAreaFiltered ? (rentTrades?.filter((t) => t.area === selectedArea) ?? null) : rentTrades;
  // chartData는 saleTrades/rentTrades 대신 saleForChart/rentForChart로 빌드

+ const saleThin = isAreaFiltered && (saleForChart?.length ?? 0) < MIN_TREND_POINTS;
+ const rentThin = isAreaFiltered && (rentForChart?.length ?? 0) < MIN_TREND_POINTS;
+ const thinDataNote = ...(saleThin && rentThin ? "매매·전세 모두" : saleThin ? "매매" : rentThin ? "전세" : null)
```

- `selectedArea`가 `'전체'`거나 안 넘어오면 `saleForChart`/`rentForChart`가
  `saleTrades`/`rentTrades`와 완전히 동일한 참조로 남아 **B2-2 이전과 100% 같은
  결과**(§22 회귀 검증에서 실측 확인).
- `useEffect`의 fetch 의존성 배열(`[aptName, lawdCd, period, dong]`)에
  `selectedArea`를 넣지 않았다 — 필터링은 이미 받아온 데이터에 대한 순수 파생
  계산이라 **평형 chip을 바꿔도 추가 네트워크 요청이 0건**이다(§25, 실측: 크롬
  네트워크 로그가 아니라 코드 구조로 보장 — `selectedArea`는 fetch effect의
  클로저에 전혀 들어가지 않음).
- 매매/전세를 각각 독립 배열로 필터링해서 한쪽만 부족해도 다른 쪽 렌더링에
  영향을 주지 않는다(§7).
- 안내 문구는 차트 제목 바로 아래, 작은 회색 텍스트 한 줄로만 추가했다(§8 "최소
  UI 변경" 원칙) — 새 카드/배지/토글 없음.

## 7. InvestmentMetrics 구현 (`src/components/InvestmentMetrics.tsx`)

```diff
+ selectedArea?: string  // props에 추가

+ const isAreaFiltered = !!selectedArea && selectedArea !== '전체';
+ const areaSaleTrades = isAreaFiltered ? (saleTrades?.filter((t) => t.area === selectedArea) ?? null) : saleTrades;
+ const areaRentTrades = isAreaFiltered ? (rentTrades?.filter((t) => t.area === selectedArea) ?? null) : rentTrades;
  // latestSale/jeonseOnlyRent는 saleTrades/rentTrades 대신 areaSaleTrades/areaRentTrades 사용
```

핵심 설계: **기존의 "매매와 같은 area 전세 우선, 없으면 아무 전세로 폴백"
로직(변경 전 68행)을 그대로 재사용**하되, 그 로직에 들어가는 입력 배열
(`areaSaleTrades`/`areaRentTrades`) 자체를 먼저 선택 평형으로 좁혀뒀다. 그 결과:

- `isAreaFiltered`일 때는 `sortedRent`(전세 배열)에 애초에 선택 평형 거래만
  남아있으므로, "다른 평형으로 폴백"하는 코드 줄은 그대로 있어도 **다른 평형이
  섞일 데이터 자체가 없어 자연스럽게 동작하지 않는다** — 로직을 따로 분기하거나
  다시 작성하지 않고, 입력을 좁히는 것만으로 §16("특정 평형 선택 상태에서만
  fallback 제한")이 그대로 충족된다.
- 매매만 있고 전세가 없는 경우(§15 예시) `sortedRent`가 빈 배열이 되어
  `matchedRent`가 `null` → 전세가/전세가율/필요갭금액이 전부 기존 UI 그대로
  "데이터 부족"으로 표시된다(§15 요구사항과 정확히 일치, 새 컴포넌트/문구 없이
  기존 emptyValueStyle 재사용).
- `isSameArea`(68행 유래, `matchedRent.area === latestSale.area`)는 필터링된
  모드에서는 매칭이 성립하는 한 항상 `true`가 되므로, 전세가율 카드의 `*` +
  안내 툴팁(다른 평형이 섞였다는 뜻)이 **선택 평형 모드에서는 자연히 사라진다**
  — 실제로 다른 평형이 섞이지 않기 때문에 이 caveat이 필요 없어진 것이지, 표시
  로직을 따로 숨긴 게 아니다(§14 절대 금지 사항 준수 확인).

## 8. 실데이터 표본 — 문서33 표본 재사용 + 브라우저 실검증

문서33 §38의 5개 부산 단지 표본(레이카운티/은하/엘지메트로시티3/동래래미안아이파크/
화명롯데캐슬카이저)을 그대로 재사용했다. 이번 STEP은 새로 MOLIT API를 직접 호출하는
조사 스크립트를 만들지 않고, 로컬 `next dev`로 **이 앱 자체의 화면**에서 실제
선택 평형 필터링 동작을 검증했다(§19-21).

## 9. PriceTrendChart selectedArea 연동 여부 — 반영됨

`apt-client.tsx` 743행에 `selectedArea={selectedArea}` 추가. `'전체'` 선택 시
동작은 §22에서 회귀 없음을 실측 확인.

## 10. 매매/전세 독립 필터링 — 실측 확인

**엘지메트로시티3(남구, lawdCd 26290) 243.35㎡** 선택(3년):

- 매매: 3년간 1건(2025-10-03, 10억) → `saleThin` true → 선(line) 없음.
- 전세: 3건 이상(2023.12.22 7억 포함, 서로 다른 날짜) → `rentThin` false →
  파란 선 정상 렌더.
- 실제 표시 문구: **"선택 평형은 매매 거래가 적어 추이를 표시하기 어렵습니다."**
  — 전세는 언급하지 않고 매매만 특정해서 안내(§7 요구사항과 정확히 일치).
- 매매/전세를 하나로 묶어 판단했다면 이 케이스에서 전세 선까지 함께 숨겨졌을
  것 — 독립 판단의 효과를 실측으로 확인.

## 11. B2-2 색상 유지 확인

이번 STEP 전체에서 `stroke="var(--primary-color)"`(매매)/`stroke="#3152d6"`(전세)
줄을 건드리지 않았다(§6 diff에 없음, `git diff`로 재확인). 위 모든 스크린샷에서
매매=초록/전세=파랑 유지를 육안으로도 재확인했다.

## 12. 차트 제목/기준 표시 — 추가 라벨 없음(의도적)

`AreaSelector` 칩이 차트 바로 위(1.25rem 간격)에 있고, 선택된 칩은 초록 배경으로
강조 표시된다. 이미 화면 맥락상 "지금 어느 평형 기준인지"가 충분히 명확하다고
판단해 **차트 안에 별도의 "전용 84.94㎡ 기준" 같은 중복 라벨은 추가하지
않았다**(요청서 §12 "AreaSelector가 바로 위에 있어 충분히 명확하다면 중복 라벨을
만들지 않아도 됨" 조항에 근거한 판단). 대신 §4-5의 데이터 부족 안내문(새 정보)만
추가했다.

## 13-16. InvestmentMetrics — source/연동/부족 정책/fallback 투명성

§7에서 상세. 매매가=`latestSale.priceStr`(area-filtered), 전세가=`matchedRent.priceStr`
(area-filtered, area-filtered 상태에서는 사실상 항상 같은 평형), 전세가율=
`matchedRent.price / latestSale.price * 100`, 필요갭금액=`latestSale.price -
matchedRent.price` — 넷 다 area-filtered 배열에서만 값을 가져오므로 **서로 다른
평형끼리 조합해 계산하는 경우가 없다**(§14 절대 금지 준수).

## 17. Hero ↔ Chart ↔ Metrics ↔ Timeline 일관성 실측

**대신푸르지오1차(서구, 26140) 84.94㎡** 선택:

| 영역 | 표시 평형 |
|---|---|
| Hero | 전용 84.94m² |
| PriceTrendChart | 84.94㎡만 필터링(차트 정상 렌더, 안내 없음) |
| InvestmentMetrics | 매매가 5억5,800만(Hero와 동일), 전세가/전세가율/필요갭금액은 6개월 내 매물 없어 "데이터 부족" |
| 실거래 타임라인 | "전용 84.94m² · 약 25.7평 · 총 14건" |

네 영역 모두 84.94㎡ 기준으로 통일됨을 확인. (숫자 자체가 100% 같아야 한다는
뜻은 아니라는 요청서 단서대로, Metrics는 6개월 창이라 Hero의 "최근 거래"와 다른
날짜의 거래를 보여줄 수 있음 — 평형 기준만 같으면 됨.)

## 18. Empty state — 기존 컴포넌트 재사용

새 디자인 시스템을 만들지 않았다. 차트의 완전 무데이터 상태는 기존 문구
"해당 기간의 매매/전세 거래 내역이 없습니다."를 그대로 재사용(변경 없음) —
선택 평형의 3년 윈도 안에 거래가 0건이면 이 기존 메시지가 그대로 뜨고, 1건
이상이지만 2건 미만이면(§4) 새로 추가한 `thinDataNote`가 함께 뜬다. Metrics의
"데이터 부족" 문구도 기존 그대로.

## 19. 실제 검증 — 거래 충분한 평형 (2개 단지)

1. **대신푸르지오1차 84.94㎡**(서구): §17 표 참고 — 차트 3년/1년/5년 모두 정상
   렌더(안내 없음), Hero/Timeline 84.94㎡ 일치.
2. **레이카운티(1단지) 84.83㎡**(연제구, 26470, 4,470세대·2023년 준공):
   Hero "9억 7,000만 전용 84.83m²", 차트 3년 전 구간 매매·전세 모두 촘촘한
   선(신축이라 2024년 초부터 매매 거래 급증 — 준공 시점과 일치, 왜곡 아님),
   Metrics: 매매가 9억7,000만/전세가 5억3,000만/**전세가율 54.6%(＊ 없음)**/
   필요갭금액 4.4억 — 전부 실제 값, "＊ 다른 평형 참고" caveat이 선택 평형
   모드에서 사라짐을 확인(§7 마지막 항목 실측 검증).

## 20. 실제 검증 — 거래 부족 평형 (2개 사례)

1. **엘지메트로시티3(남구) 243.35㎡**: §10 상세. 매매 1건(부족)/전세 충분 —
   매매 선 없음+안내, 전세 선 정상. Metrics는 6개월 창 기준 매매·전세 전부
   "데이터 부족"(다른 평형 대입 없이 정직하게 표시, 실측 스크린샷 확인).
2. **명륜아이파크1단지(동래구, 26260, 명륜동) 84.919㎡**: 5년 기준 매매 1건
   (2021-09-02, 8억5,000만)/전세 0건 → **"선택 평형은 매매·전세 거래가 모두
   적어 추이를 표시하기 어렵습니다."** 문구 확인, 초록 점 1개만 고립 표시(선
   없음), 파란 선은 아예 없음(전세 0건). 3년 기준으로는 매매도 0건이라 기존
   "해당 기간의 매매/전세 거래 내역이 없습니다." 메시지가 대신 뜨는 것까지
   확인 — 두 empty 메시지가 기간에 따라 올바르게 전환됨.
   - 둘 다 다른 평형(예: 84.9194㎡의 풍부한 데이터)이 섞여 들어오지 않았다 —
     Hero 가격(8억5,000만)이 84.9194㎡의 최근 거래(8억8,800만)와 다른 고유한
     값으로 유지된 것으로 확인.

## 21. collision 평형 검증 — 명륜아이파크1단지 84.919㎡ vs 84.9194㎡

periodFilter 5년 기준 드롭다운에 **"84.919㎡ (1건)"**과 **"84.9194㎡ (32건)"**이
서로 다른 항목으로 명확히 분리되어 나타남(문서30/31에서 이미 확인된 충돌 해소
로직이 여전히 정상 동작). 각각 선택 시:

| | 84.919㎡ | 84.9194㎡ |
|---|---|---|
| Hero 가격 | 8억 5,000만(2021-09-02, 2층) | 8억 8,800만(2026-06-18, 12층) |
| 차트(3년) | 데이터 없음 메시지 | 매매·전세 모두 촘촘, 안내 없음 |

두 값이 완전히 다르고 서로 섞이지 않음을 실측 확인 — internal key가 표시
라벨이 아니라 원본 area 문자열 그대로라는 §2 설계가 그대로 유지됨.

## 22. 전체 선택 회귀 검증 — 대신푸르지오1차

| | B2-3 이전(문서35 실측) | B2-3 이후(이번 실측) |
|---|---|---|
| 차트(3년, 전체) | 톱니 형태로 요동(평형 혼합, 매매 초록/전세 파랑) | **동일**(스크린샷 육안 비교로 동일 패턴 확인) |
| Metrics | 매매가 5억5,800만/전세가 1억8,000만/전세가율 32.3%(*)/필요갭금액 3.8억 | **동일한 숫자, ＊도 동일하게 유지** |

`selectedArea === '전체'`일 때 `saleForChart`/`rentForChart`(PriceTrendChart)와
`areaSaleTrades`/`areaRentTrades`(InvestmentMetrics)가 원본 배열과 같은 참조를
그대로 가리키므로 코드 구조상으로도 회귀가 있을 수 없고, 실측으로도 동일함을
확인했다.

## 23. 모바일

`claude-in-chrome` 자동화의 `resize_window`(390×844 요청)가 B2-2 검수 때와
동일하게 실제 캡처 해상도에 반영되지 않아(도구 환경 제약, 문서35에 이미 기록된
동일 현상) **실제 좁은 뷰포트 스크린샷을 다시 얻지 못했다** — 솔직하게 보고한다.
다만 이번 변경도 B2-2와 마찬가지로 미디어쿼리/반응형 분기가 전혀 없는 순수 로직
+ 텍스트 한 줄 추가라 뷰포트 폭과 무관하게 동일하게 렌더된다(코드로 확인).
차트 높이(320px 고정, 변경 안 함), legend/매매·전세 색상(B2-2 그대로), 평형 chip
가로 스크롤(`AreaSelector.tsx`, 변경 안 함), Metrics 4칸 그리드
(`repeat(auto-fit, minmax(150px,1fr))`, 변경 안 함) 전부 이번 STEP에서 손대지
않았으므로 기존과 같은 반응형 동작을 유지한다고 판단하나, 실기기 최종 확인은
사용자 검수로 대체.

## 24. PC

위 §19-22 전 과정을 1568px 폭 브라우저 창에서 수행 — 평형 선택 변경 시 차트/
지표가 새로고침 없이 즉시 반영됨을 확인. 레이아웃 변화는 안내 문구가 있을 때만
차트 제목 아래 한 줄 추가되는 정도(§6)로 최소화.

## 25. 성능 — 추가 API 호출 0건

`PriceTrendChart`/`InvestmentMetrics`의 fetch `useEffect` 의존성 배열
(`[aptName, lawdCd, period, dong]`, `[aptName, lawdCd, dong]`)에 `selectedArea`를
넣지 않았다 — 평형 필터링은 이미 받아온 `saleTrades`/`rentTrades` state에 대한
순수 파생 계산(`.filter()`)이라 평형 chip을 아무리 눌러도 새 네트워크 요청이
발생하지 않는다. 브라우저 실검증에서도 chip 클릭 시 로딩 스피너/스켈레톤 없이
즉시(같은 렌더 사이클) 반영되는 것으로 이를 간접 확인했다(로딩 상태가 한 번도
뜨지 않음 = 네트워크 재요청이 없다는 뜻).

## 26. 금지 범위 — 위반 없음

용적률/건폐율/주차대수, B2-1, 차트 디자인/높이/라이브러리, 교통/버스/생활편의/
점수체계/추천엔진/건축물대장/지도/메인UI/SEO/community/MY/API 신규/DB·schema·
migration — 전부 손대지 않았다(§6-7 diff가 `PriceTrendChart.tsx`/
`InvestmentMetrics.tsx`/`apt-client.tsx` 3개 파일, 그것도 각각 selectedArea 관련
줄만 변경했음을 `git diff --stat`으로 재확인).

## 27. 정적 검증

```
npx tsc --noEmit         → 통과(출력 없음, 에러 0)
npx eslint (변경 3파일)   → 0 errors(apt-client.tsx의 1개 warning은 369행의
                            기존 eslint-disable 주석 — 이번 STEP에서 만들지도
                            건드리지도 않음, git diff로 확인)
npm run build             → 성공, 라우트 구성(○/ƒ) 기존과 동일
npx prisma validate       → "The schema at prisma\schema.prisma is valid 🚀"
npx prisma migrate status → "Database schema is up to date!"(3 migrations, 변경 없음)
```

## 28. 문서/기록

- 이 문서(`docs/development/36-apartment-detail-b2-selected-area-consistency.md`)
  신규 생성.
- `docs/development/CHANGELOG.md`에 STEP 36 항목 추가.
- 기존 문서33/34/35 및 그 CHANGELOG 항목 보존.
- commit/push 없음(git add 포함 전혀 실행하지 않음).

## 29. 한계

- InvestmentMetrics는 여전히 6개월 고정 창이라(이번 STEP 범위 밖, §13 유지)
  선택 평형에 최근 6개월 거래가 없으면 3-5년 전 거래가 있어도 "데이터 부족"으로
  보인다 — 이는 B2-3 이전부터 있던 기존 정책(전체 평형에서도 동일)이며, 필요하면
  "6개월 고정 창을 늘릴지" 여부는 별도 STEP 논의 대상으로 남긴다.
- 문서33이 제안한 월별 중앙값 aggregation은 이번 STEP에서 구현하지 않았다(§9,
  요청서 §9 STOP 조건에 따라 filtering만으로 충분해 범위 밖으로 남김) — 개별
  거래를 그대로 점으로 찍는 현재 방식이 selectedArea와 결합하면 평형이 좁혀질수록
  점이 성겨지는데, 이는 §4의 안내 문구(2건 미만)로 커버되는 범위 밖(2건 이상
  ~ 소수) 구간에서는 여전히 "점이 듬성듬성한 차트"로 보일 수 있다 — 왜곡은
  아니지만 가독성 개선 여지는 남아 있다.
- 모바일 실기기 스크린샷 미확보(§23) — 도구 제약, 코드 근거로 간접 확인.

## 30. B2-3 완료 가능 여부 / 다음 STEP

핵심 목표(Hero/차트/지표 평형 기준 일치, silent fallback 금지, 매매/전세 독립
판단, 추가 API 호출 0건, B2-2 유지) 전부 실측으로 확인됐다. 사용자 모바일 검수
후 B2-2와 함께 완료 처리할 수 있다고 판단한다. 다음 후보(사용자 승인 필요,
자동 진행 안 함):

- B2-1(문서33에서 언급된, 이번 STEP에서 다루지 않은 나머지 스펙 표시 UX 항목).
- 월별 중앙값 aggregation(§29 한계 항목, 문서33 §34 설계 재사용 가능).
- InvestmentMetrics 6개월 고정 창 재검토(§29).
