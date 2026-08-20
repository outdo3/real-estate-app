# STATISTICS V2 — 전체 통계 UX/정보구조 재설계 + 이집형 판단형 통계 플랫폼

상태: **구현 완료 — commit/push 안 함(ChatGPT 검수 대기)**

시작 HEAD: `88d074d`(DS-3 구현 직전) → 이번 STEP §0-1에서 DS-3 구현을
`a7f786e`로 커밋+푸시 완료(사용자 승인). STATISTICS V2는 그 이후 작업.

DB/schema/migration 변경 **0건**. API route(비즈니스 계산) 변경 **0건**
— 수정한 4개 파일은 전부 클라이언트 컴포넌트/CSS/메뉴 설정이고, `/api/
stats/*` 3개 라우트는 감사만 하고 코드를 건드리지 않았다(`git diff
--name-only`로 재확인).

---

## 1. Menu inventory(§2)

`src/app/stats/statsMenu.ts` 기준 16개 메뉴 전수 확인(사용자 스펙이
나열한 15개 + 코드에만 있던 1개 누락분 `popular`/인기단지 추가 반영):

| slug | title | status | category |
|---|---|---|---|
| decline | 최근하락 | live | 가격 |
| record-high | 최고가 | live | 가격 |
| rising | 최고상승 | live | 가격 |
| jeonse-risk | 역전세 | live | 가격 |
| volume | 거래량 | live | 거래 |
| top-traded | 많이산단지 | live | 거래 |
| gap-invest | 갭투자 | live | 거래 |
| supply | 공급물량 | soon | 수요·공급 |
| population | 인구변화 | soon | 수요·공급 |
| foreign-buyer | 외지인비율 | soon | 수요·공급 |
| price-map | 분위지도 | live | 지역 |
| elevation | 경사/고도 | soon | 지역 |
| large-complex | 대단지 | soon | 지역 |
| compare | 가격비교 | live | 비교·분석 |
| multi-compare | 여러단지비교 | live | 비교·분석 |
| popular | 인기단지 | soon | 비교·분석 |

**10 live + 6 soon = 16개, 누락 없음.** soon 6개는 전부 실제 미연동
데이터소스 사유(`soonReason`)가 이미 코드에 있었다(이전 STEP에서 정직하게
비워둔 것 — 이번 STEP에서 새로 만들지 않음).

---

## 2. Data-logic audit(§3) — 계산 로직은 변경하지 않음

### 감사 대상 API

- `GET /api/stats/rankings`(decline/record-high/rising/top-traded/jeonse-risk 공유)
- `GET /api/stats/dashboard`(volume/gap-invest 공유)
- `GET /api/stats/yearly`(volume 표 보기)

### 확인된 건전한 설계(변경 없이 그대로 유지)

- **추세(pctChange) 계산**: 단일 최신/최고(1건) 비교가 아니라 **최근 N건
  평균 vs 가장 오래된 N건 평균**(`TREND_SAMPLE_SIZE=3`)을 비교 — 이전
  STEP에서 단일 거래 이상치 왜곡(경동 단지 사례)을 겪고 이미 고친
  방식. ㎡ 단가(`dealAmount/pyung`)로 정규화해 거래별 면적 차이를
  일부 흡수한다.
- **rent(전월세) 오염 제거**: `type==='rent'`일 때 반전세/월세
  (`monthlyRent>0`)를 걸러내고 순수 전세만 남긴다 — "전세→반전세 전환"이
  보증금 급락(-97%)으로 오인되던 문제를 이전 STEP에서 이미 해결.
- **역전세 문구**: `note`에 이미 "실제 역전세 위험은 집주인의 매입가·
  대출 상황에 따라 다르니 참고용으로만 활용하세요"라는 hedge가
  있었음 — §23 "확정적 위험 판정 금지" 요건을 이미 만족.
- **분위지도 색상**: 5단계(파랑→초록→노랑→주황→빨강) quintile 배색이며
  브랜드 그린 하나로 모든 positive/negative를 덮지 않는다(§24 요건
  이미 충족, 그대로 유지).

### ISSUE로 보고(BLOCKER 아님, 계산 변경하지 않고 UI에 disclaimer만 추가)

**`gapInvest`(갭투자, `/api/stats/dashboard/route.ts` §5 블록)**:
1. 비교 대상인 "최근 매매 1건"과 "최근 전세 1건"이 **같은 면적(평형)
   인지 확인하지 않는다** — 복수 평형이 있는 단지에서 서로 다른
   타입의 매매가와 전세가를 빼서 "갭"으로 표시할 수 있다.
2. `apts[0]`/`rents[0]`을 "최근" 거래로 쓰지만, 실제로는 3개월치
   월별 배열을 이어붙인 순서일 뿐 **거래일 기준으로 정렬돼 있다는
   보장이 없다**(변수명 `latestApt`가 실제로는 "최근"이 아닐 수 있음).

**조치**: 계산 로직은 변경하지 않았다(§46 scope control — UI 개선 중
비즈니스 계산 임의 변경 금지). 대신 `GapInvestView`의 `SectionHeader`
description에 "단지 내 최근 매매 1건과 전세 1건을 비교한 근사값으로,
두 거래의 면적·시점이 다를 수 있습니다"라는 disclaimer를 추가해
사용자가 오해하지 않도록 했다. 실제 계산을 고치려면 면적 매칭 로직
추가가 필요하며, 이는 다음 STEP(별도 승인) 대상으로 남긴다.

---

## 3. Common IA(§4)

`PageHeader(Header) → FilterBar/지역선택 → Summary/Insight(SectionHeader)
→ Ranking/Table/Chart → Context/Explanation → Detail CTA` 구조를
5개 순위형 화면(decline/record-high/rising/top-traded/jeonse-risk)에
그대로 적용했다. Volume/GapInvest/Compare/PriceMap은 화면 성격이 달라
전체 IA를 강제하지 않고 SectionHeader/Empty/ErrorState/InlineLoading
같은 공통 조각만 공유한다(§4 "완전히 똑같을 필요는 없지만 정보 구조
언어는 공통이어야 한다"는 원칙 그대로).

## 4. Statistics identity — deterministic insight(§5/§27/§44/§45)

`src/lib/stats-insight.ts`의 `buildRankingInsight()`가 5개 순위 화면
전부에 적용됐다. 예(실제 화면 캡처 문구):

> 부산광역시 서구 동 전체에서 하락폭이 큰 단지는 30곳입니다. 1위는
> 송도현대(-27.8%) (표본 2건으로 적어 참고용).

**설계 원칙**:
- 전부 `RankingComplex`(API가 실제로 반환한 값)에서만 조립 — AI
  생성 없음, 지어낸 값 없음.
- 표본 3건 미만은 항상 "표본 적음"을 노출(§15 — 1건으로 과도한
  해석 금지).
- "매수 추천"/"투자 적기"/"저평가 확정"/"오를 가능성 높음" 같은
  표현을 코드 어디에도 쓰지 않음(§45, `verify-statistics-v2.ts`에서
  실제로 검증).

**하지 않은 것**: 사용자 예시("같은 평형 최근 거래 4건", "지역 평균
대비 하락폭 큼", "단지 경쟁력은 지역 상위권")처럼 지역 평균 대비 비교나
이집점수까지 포함한 다차원 해석은 이번 STEP에서 만들지 않았다 —
`RankingComplex`에 지역 평균 비교 값 자체가 없고(별도 집계 로직 추가
= 계산 변경에 해당), 이집점수는 §28에서 다루듯 랭킹 30건 각각에
점수 API를 호출하는 게 §42(중복 fetch 금지)와 충돌해 배치 조회
API가 없는 지금은 붙이지 않았다. 다음 STEP 후보로 남긴다.

## 5. Statistics landing(§35)

`/stats` 16개 메뉴를 5개 카테고리(가격/거래/수요·공급/지역/비교·분석)로
grouping했다. `STATS_MENU`에 `category`/`Icon`(Lucide) 필드를 추가하고
`STATS_CATEGORIES` 순서대로 렌더링 — 실제 메뉴 구성 그대로, 라우트/
슬러그 변경 없음. 학군정보/부동산도구도 같은 카드 스타일의 "기타"
섹션으로 유지.

## 6. FilterBar/FilterChip/SelectFilter(§6/§34)

- **FilterChip 실사용**: `VolumeView`의 매매/전세/월세 토글을 기존
  커스텀 버튼에서 `FilterChip`으로 교체 — DS-3에서 만들고도 실사용처가
  없었던 컴포넌트를 처음 실제로 연결했다.
- **FilterBar/SelectFilter 미적용 이유**: 순위형 화면(decline 등)은
  이미 상단 지역 선택 모달(RegionSelectModal) 하나만 필터로 쓰고
  있어 다중 select 그룹이 필요 없다 — presales/redevelopment처럼
  "지역+상태+가격" 같은 다중 select 조합이 있는 화면이 Statistics
  쪽엔 없어 억지로 적용하지 않았다(§34 "억지 사용 금지, 필요 없으면
  사용하지 않고 이유 문서화").

## 7. Region filter(§7)

`RegionSelectModal.tsx` 기존 구현을 감사 — 이미 **시도→시군구→동**
3단계 계층이 구현돼 있음을 확인했다(`modalStep: 'sido'|'sigungu'|'dong'`).
새 depth를 만들지 않았다(요건 그대로 충족된 상태).

## 8. Ranking / RankingRow(§8)

`src/components/ui/RankingRow.tsx`(+ `RankingList` wrapper) 신규.
rank/apartment/region/primary metric/secondary context/direction/
trade count/detail CTA 계약을 그대로 구현 — stats/page.module.css의
기존 `compactItem` 계열 마크업(순위 배지 색상 top1/2/3 포함)을 그대로
옮겼다(시각 변경 없음). decline/record-high/rising/top-traded/
jeonse-risk/gap-invest **6개 화면**이 공유한다.

**이집점수는 여기 없음** — §28 참고.

## 9. Table(§9)

Volume의 연도별 표(`yearlyTable`)는 기존 `table-layout:fixed` + 컴팩트
패딩 방식을 그대로 유지(이미 모바일에서 가로 스크롤 없이 동작 확인됨,
이번 STEP에서 재작업하지 않음).

## 10. Number formatting(§10)

`src/lib/stats-format.ts` 신규 — `formatKoreanPrice`(기존 `api-molit.ts`
그대로 재-export, 중복 구현 없음), `formatPercentChange`, `formatTradeCount`,
`isLowSample`. RANKING_CONFIGS의 `value()`가 이제 이 helper를 거친다
(이전엔 `${c.pctChange}%`/`+${c.pctChange}%`로 화면마다 직접 조립).

## 11. Semantic direction color(§11)

`directionColor()`가 DS-2의 `--up-color`(#f4361e, 상승=빨강)/
`--down-color`(#3152d6, 하락=파랑)를 그대로 쓴다. 기존 RANKING_CONFIGS가
쓰던 근사 하드코딩('#ef4444'/'#3b82f6', 토큰과 미세하게 다른 값)을
대체했다 — 계산이 아니라 표시 색상만 토큰화했다.

## 12. Emoji 제거(§12)

이번 STEP에서 직접 수정한 파일(`type-client.tsx`, `stats-client.tsx`,
`statsMenu.ts`)의 emoji를 전부 Lucide로 교체했다: 📉🏆📈📊⚖️🏘️💰🛒
🏗️👥⚠️✈️🗺️⛰️🏢👁️(16개 메뉴 아이콘) + 📍(지역 선택) + 💡(분석 팁,
2곳) + 📋/📊(그래프·표 토글) + 📦(준비중 카드) + 🏫🛠️(학군/도구
바로가기). `verify-statistics-v2.ts`가 두 파일의 코드 라인에 emoji
문자가 없음을 정규식으로 검증한다. `STATS_MENU.icon`(emoji 문자열)
필드는 `<title>` 메타데이터(브라우저 탭)에서만 남겨뒀다 — 화면에는
렌더링하지 않는다(§17에서 이미 확인한 브라우저 탭 제목 관례와 동일).

**하지 않은 것**: `/stats/[type]`의 다른 패널 없음(이번 STEP이 손댄
5개 뷰가 사실상 live 메뉴 전체를 커버). 하지만 향후 새 통계 패널이
추가되면 그때도 이 원칙을 적용해야 한다.

---

## 13-27. 메뉴별 감사/변경사항 요약

| 메뉴 | 데이터 | 변경 사항 |
|---|---|---|
| 최근하락(§13) | `/api/stats/rankings?type=apt` | RankingRow+insight, direction=pctChange |
| 최고가(§14) | 동일, `sort by maxDealAmount` | RankingRow, direction=null(중립 지표) |
| 최고상승(§15) | 동일, `pctChange>=3` | RankingRow+insight, 표본 적음 배지로 §15 요건(1건 과대해석 금지) 시각화 |
| 거래량(§16) | `/api/stats/dashboard` + `/api/stats/yearly` | SectionHeader, FilterChip(매매/전세/월세), Lucide 아이콘, Lightbulb 팁 |
| 갭투자(§17) | `/api/stats/dashboard`(gapInvest) | RankingRow, direction=null, **disclaimer 추가**(§2 audit) |
| 가격비교(§18)/여러단지비교(§19) | `/api/apt/[name]?period=36`(기존, 재감사 안 함) | SectionHeader만 교체, 비교 로직/새 복합 점수 없음 |
| 많이산단지(§16 공유) | `/api/stats/rankings?sort=tradeCount` | RankingRow, direction=null |
| 공급물량(§20)/인구변화(§21)/외지인비율(§22)/경사고도(§25)/대단지(§26)/인기단지 | 데이터 소스 없음(soon) | ComingSoonCard → `Empty(notReady)` 컴포넌트로 교체만, 문구/사유 동일 |
| 역전세(§23) | `/api/stats/rankings?type=rent` | RankingRow+insight, 기존 hedge 문구 그대로 유지 |
| 분위지도(§24) | `/api/transactions` | SectionHeader, 배색이 브랜드 그린과 무관함을 description에 명시 |

인구변화(§21)/외지인비율(§22) 등 soon 메뉴는 "인과관계 해석"(예: 인구
감소=가격 하락) 자체가 코드에 없다 — 데이터가 없어 표시되지 않으므로
해당 요건은 자동 충족.

---

## 28. Score integration(§28)

`GET /api/apt/[name]/score`가 존재하지만 **단일 단지 조회 전용**이다.
순위 리스트는 화면당 최대 30건을 보여주는데, 이 30건 각각에 개별 점수
API를 부르면 페이지 하나에서 최대 30회 fetch가 발생해 §42(중복/과도한
fetch 금지) 원칙과 정면으로 충돌한다. 배치 조회 API가 없는 현재는
붙이지 않았다 — **hook point만 문서화**: `RankingRow`는 이미 임의의
추가 필드를 받을 수 있는 구조이므로, 배치 점수 API(`POST /api/apt/
score/batch` 같은 형태)가 생기면 `RankingComplex`에 `score?: number`를
얹고 `RankingRow`에 표시 slot을 추가하는 정도로 확장 가능하다.

## 29. Share hook(§29)

**URL 필터 상태 보존 감사**: `region`(시도/시군구)은 이미
`?sido=&sigungu=`로 초기 진입 시 복원 가능(`RegionUrlSync`). 반면
`VolumeView`의 매매/전세/월세 선택, `기간(1/3/5/전체)` 등은 **URL에
반영되지 않는 로컬 state**다 — 지금 링크를 공유하면 필터가 기본값으로
초기화된다. 이번 STEP은 이 상태만 감사하고 고치지 않았다(§29 "URL
보존 가능한지 audit"만 요구, 구현은 범위 밖).

**공유 버튼 UI 자리**: 이번 STEP에서 실제 공유 버튼을 추가하지
않았다 — 기존 앱에 `KakaoShareButton` 컴포넌트가 있으나(단지 상세
페이지용), Statistics 화면에 무엇을 "공유"할지(현재 필터 상태? 특정
순위 항목?) 결정이 SHARE-2 스코프에 가까워 이번 STEP에서는 배치
위치만 판단하지 않고 다음 STEP으로 넘긴다.

## 30. Favorite/Compare hook point(§30)

`RankingRow`/`Card` 모두 children/props 확장이 자유로운 구조라, 향후
"즐겨찾기" 아이콘이나 "비교 담기" 체크박스를 넣을 때 컴포넌트 자체를
바꿀 필요 없이 `RankingRowProps`에 optional slot을 추가하면 된다.
이번 STEP에서 실제 기능은 구현하지 않았다(§30 지시대로).

## 31-33. Loading/Empty/Error(§31-33)

- **Loading**: `InlineLoading`을 5개 순위 화면 + Volume + GapInvest +
  Compare + PriceMap 전체 로딩 상태에 실제로 연결(이전엔 플레인
  텍스트) — DS-3에서 만들고 미사용이었던 `SectionSkeleton`은 이번에도
  실사용처를 찾지 못했다(모든 로딩이 "짧은 API 응답 대기"라 skeleton
  블록보다 스피너가 자연스러움) — 정직하게 미사용으로 남김.
- **Empty**: `noResult`(순위 결과 0건)와 `notReady`(soon 메뉴)를
  명확히 구분해 사용 — "결과 없음"과 "준비 중"이 같은 컴포넌트라도
  다른 variant/마스코트로 분리됨.
- **Error**: 5개 순위 화면 + Volume + GapInvest 전부 `ErrorState`로
  교체, raw `apiResponse.error` 문자열을 그대로 노출하는 기존 동작은
  유지하되(서버가 이미 안전한 한국어 메시지만 반환하는 것을 API
  코드에서 확인) 마스코트/이모지는 제거했다.

## 34-38. 검증(§39-52 최종 보고에서 요약)

375/390/430/1024/1280px 13개 route 전수 가로 overflow 0건, console
에러 0건. tsc/eslint/build 전부 통과. 신규 20개 + 기존 53개(DS-2 22 +
DS-3 18 + APT-IA 13) = **73개 검증 전부 PASS**.

## 39. Performance(§42)

`VolumeView`/`GapInvestView`가 같은 `/api/stats/dashboard?lawdCd=`
키를 부르지만 SWR의 `dedupingInterval: 30분` + 전역 캐시 키 중복
제거로 실질적 중복 fetch는 발생하지 않는다(같은 페이지에 동시
마운트되지 않고, 30분 내 재방문 시 캐시 재사용) — 명백한 중복 fetch를
찾지 못했다. 대규모 리팩터는 하지 않았다(§42 지시대로).

## 40. Analytics future hook(§43)

이벤트 이름만 문서화(실제 SDK 설치 없음):
`stats_view`(페이지 진입, slug/region), `stats_filter_change`(지역/
기간/거래유형 변경), `stats_item_click`(순위 항목 클릭 → 상세 이동),
`stats_share_click`(§29 버튼이 생기면), `stats_compare_click`(compare
화면 단지 추가).

---

## 41. Unresolved

1. gapInvest 면적/시점 매칭 정확도(§2 ISSUE) — 계산 로직 개선은
   별도 승인 STEP.
2. 이집점수 배치 조회 API 부재로 랭킹 화면 점수 통합 보류(§28).
3. 필터 state(기간/거래유형)가 URL에 반영되지 않아 공유 링크가 필터를
   보존하지 못함(§29).
4. 공유 버튼 실제 배치는 SHARE-2 STEP.
5. `SectionSkeleton` 여전히 실사용처 없음(DS-3부터 이어지는 항목).

## 42. BLOCKER

없음. §2의 gapInvest 이슈는 UI disclaimer로 안전하게 완화했고, 계산
자체를 고치는 것은 이번 STEP 범위(§46 UI/IA 중심) 밖이라 BLOCKER로
승격하지 않았다.

## 43. STATISTICS_V2_CLOSE / SCORE_V1_1_GO

**STATISTICS_V2_CLOSE**: YES. **SCORE_V1_1_GO**: 조건부 YES — 이집점수를
통계 랭킹에 통합하려면 §28에서 확인한 배치 조회 API가 먼저 필요하다.
