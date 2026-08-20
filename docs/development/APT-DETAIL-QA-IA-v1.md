# APT DETAIL QA / IA v1 — 상세페이지 데이터 일관성 + 정보구조 정리

상태: **구현 완료 — commit/push 완료(사용자 지시로 최종 라운드 종료 후 즉시 진행)**

시작 HEAD: `c7cc192`(S3 `feat: add apartment score ui and briefing` 커밋 직후,
origin/main과 일치 확인) → 이번 STEP 착수 전 커밋 없음 확인.

## 1. 현재 상세페이지 IA(코드 기준)

```
Header
1구역(Hero): 단지명/지역/준공·세대수 → 가격 블록(최근 실거래가, 평형칩+단위토글,
  시세차트, 투자지표) → AptSpecGrid(세대수/준공년월/용적률/건폐율/주차대수)
이집점수 카드(S3에서 추가, Hero 직후)
quickButtons: 지도/로드뷰/대출한도
2구역: 실거래 타임라인 → 단지 브리핑(Algorithmic Briefing, S3)
3구역: 단지 주변 생활정보(환경/교통/학군 탭)
AdContainer
4구역: 단지 커뮤니티
StickyPriceBar(모바일 하단 고정)
```

**사용자가 승인한 범위**: 이번 STEP은 큰 section 순서 재배치(Hero→점수→실거래→
면적→브리핑→기본정보→교통→주거환경→학교접근성→지도→대출→커뮤니티로 전면 이동)는
**적용하지 않는다** — 확인된 실제 문제만 우선 처리하고 전면 재배치는 다음 STEP으로
미루기로 사용자가 결정했다(2026-08-20 확인).

## 2. 평형칩 누락 — 근본 원인(§3~5)

### 조사 방법
`AreaSelector.tsx`, `area-utils.ts`, `/api/apt/[name]/route.ts`의 실제 코드를
읽고, 살아있는 API(`/api/apt/[name]?period=120`)로 서구·해운대 활성 거래
단지 20곳의 실제 응답을 받아 "원본 거래에 등장하는 distinct area 수"와
"기본 화면에 보이는 chip 수"를 직접 비교했다.

### 결과 — root cause 확정
**A(데이터 없음)/B(mapping 누락)/C(중복 제거 중 소실)/E(rounding 병합) 전부
아니었다.** 원인은 `AreaSelector.tsx`의 `MAX_CHIPS = 4`(거래량 상위 4개만
기본 노출, 나머지는 "▼ 전체 평형" 모달에서만 선택 가능) — **의도된 UI
상한값**이었다. 데이터 자체는 항상 온전했다(모달을 열면 전부 보였음).

**분류: UI_DESIGN_LIMITATION** (DATA_FIX_REQUIRED/SCHEMA_REVIEW_REQUIRED
아님 — DB/데이터 수정 불필요, 코드만 수정).

### 실측 규모(§4)
| 지역 | 표본 | distinct area ≥5(칩 상한 초과) | 최대 관측 |
|---|---|---|---|
| 서구 | 10(거래량 상위) | 9/10 | 13종(e편한세상송도더퍼스트비치) |
| 해운대 | 10(거래량 상위) | 8/10 | **39종(경동)**, 28종(해운대힐스테이트위브) |

거래 활성 단지의 **85%**가 기본 화면에서 실제 평형 중 최소 1종~최대 35종을
볼 수 없었다.

## 3. 수정(§3~5, 사용자 승인: "칩 상한 삭제, 전체 가로스크롤")

`AreaSelector.tsx`:
- `MAX_CHIPS`/거래량 기준 `topAreas` 선정 로직 제거.
- `chipAreas = allAreas`(전용면적 오름차순 전체)를 그대로 렌더링 — 컨테이너가
  이미 `overflowX:'auto'`라 칩이 많아도 가로 스크롤만 될 뿐 레이아웃이
  깨지지 않는다(실측 확인, §18 참고).
- "▼ 전체 평형" 모달은 긴 목록에서 빠르게 점프하는 보조 수단으로 그대로 유지.

## 4. 면적 normalization(§5) — 기존 로직 검증만, 변경 없음

`area-utils.ts`의 `getUniqueAreaLabels`는 이미 "2자리에서 라벨이 겹치는
값만 겹치지 않을 때까지(최대 4자리) 정밀도를 올리는" 충돌 해소 알고리즘을
갖고 있었다(이전 STEP에서 구현됨) — 84.9404㎡/84.96㎡ 같은 근접값이 임의로
합쳐지지 않음을 재확인했다. 이번 STEP에서 이 알고리즘 자체는 건드리지
않고, **평 단위에도 동일 원칙을 적용**하기 위해 재사용 가능한 형태로만
리팩터링했다(§6 참고).

## 5. ㎡↔평 토글(§6~10)

### 공식·표기(§7)
`1평 = 3.305785㎡`(기존 `formatPyeong`이 이미 이 공식을 정확히 쓰고
있었음, 재확인만 함). "34평형"류 공급면적 표현은 쓰지 않는다 — 이
페이지의 면적은 전용면적뿐이라 "약 25.4평"처럼 항상 근사 표기.

### 용어(§8)
현재 UI는 애초에 "평형칩"이라는 용어를 화면에 노출하지 않는다(칩 안에는
숫자만 표시, "평형"이라는 단어는 "▼ 전체 평형" 버튼과 "선택 평형" 안내
문구에서만 쓰이며 이는 "면적 종류를 고른다"는 의미로 이미 무난하다) —
"전용면적"이라는 표현으로 문구를 바꾸는 추가 변경은 하지 않았다(§8이
요구하는 "34평형처럼 공급면적을 뜻하는 것으로 오인될 표현"은애초에 없었음,
근거 없는 변경 방지).

### 구현(사용자 승인 항목)
- `area-utils.ts`: `getUniquePyeongLabels`(㎡ 버전과 동일한 충돌 해소
  알고리즘, 평 변환 후 1~3자리로 정밀도 escalation) + `getAreaLabelsForUnit
  (rawAreasM2, unit)` 단일 진입점 추가. 기존 `getUniqueAreaLabels`는 내부적으로
  같은 공통 헬퍼(`buildUniqueLabels`)를 쓰도록 리팩터링(동작 동일, 중복 제거).
- `apt-client.tsx`: `areaUnit` state(기본값 `'㎡'` — §6 "기본 단위는 기존
  UX 유지"), `localStorage`(`ejip:areaUnit`)로 가볍게 기억(§10, 서버/세션
  저장 없음). `chipAreaLabels = getAreaLabelsForUnit(trades, areaUnit)`를
  AreaSelector·TradeTimelineList에 전달.
- 토글 UI: `AreaSelector` 옆 작은 "㎡ | 평" segmented 버튼(이집 그린,
  이모지 없음).

### 적용 범위(§9) — 실제 area 값을 표시하는 지점 전수 확인
| 위치 | 적용 여부 | 근거 |
|---|---|---|
| AreaSelector 칩 | ✅ 토글 적용 | 이번 수정 대상 |
| 전체 평형 모달 | ✅ 토글 적용 | 같은 `areaLabels` prop 공유 |
| 거래표(TradeTimelineList) "타입" 컬럼 | ✅ 토글 적용 | 같은 맵 전달 |
| Hero 가격 블록("전용 X㎡ · 약 Y평") | 변경 없음(항상 이중표기 유지) | `getAreaDetailLabel`은 원래도 ㎡+평 동시 표시라 토글을 그대로 적용하면 "약 25.4평 · 약 25.4평"처럼 평이 중복 표기되는 새 버그가 생김 — 이미 최선의 형태라 판단해 손대지 않음 |
| "실거래 타임라인" 헤더의 선택 평형 표기 | 변경 없음(위와 동일 함수, 동일 이유) | 상동 |
| PriceTrendChart/InvestmentMetrics | 해당 없음 | 두 컴포넌트 모두 `selectedArea`를 내부 필터 key로만 쓰고 화면에 면적 문자열을 렌더링하지 않음(코드 확인) — 애초에 단위 표기가 없어 토글 대상이 아님 |

`selectedArea`(내부 key, 원본 ㎡ 문자열)는 토글과 무관하게 항상 그대로다
— "표시 문자열을 데이터 identity로 재사용하지 않는다"는 기존 원칙 유지,
평형 필터링/차트/투자지표 로직은 전혀 건드리지 않았다(§22 일관성).

## 6. 주차정보 중복(§11~12)

**확인**: 상단 `AptSpecGrid`("주차대수")와 주거환경 탭 `LivingEnvironmentPanel`
(`ParkingGauge`, "주차공간(세대당)" 게이지)이 **동일한 원본 값**
(`aptInfo['총주차대수']`)을 그대로 반복 표시하고 있었다.

**수정**: `LivingEnvironmentPanel`에서 `ParkingGauge`/`parseParkingRatio`
제거. 상단 `AptSpecGrid`는 그대로 유지(핵심 스펙은 유지, 반복만 제거 —
§12 "상단=핵심 숫자, 세부 section=상세 근거" 원칙). 이집점수 카드의
"주차" category(0~100 점수+정성 설명)는 원본 숫자를 반복하지 않으므로
원래부터 중복이 아니었다(§15, 아래 참고).

## 7. 교통·편의 IA 분리(§13~14)

### 이전
"교통" 탭(`NeighborhoodInfoPanel`)에 대중교통(지하철·버스)/광역교통(KTX)
**+ 병원·공원 + 대형마트 + 편의점 + 약국 + 어린이집·유치원**까지 7개 카드가
전부 들어있었다.

### 이후
- **교통 탭**: 대중교통(지하철·버스), 광역교통(KTX)만 유지.
- **주거환경 탭**: 대형마트/편의점/약국/어린이집·유치원/공원/병원(§13
  "의료는 별도 section 있으면 중복 검토" — 별도 의료 section이 없어 병원을
  주거환경으로 편입) + 기존 배송생활권. "병원·공원" 한 카드로 묶여있던 걸
  성격이 달라(의료 접근 vs 녹지) 분리했다.
- 컴포넌트 자체(`KakaoPlaces`, category code)는 그대로 재사용 — 어느
  탭에서 렌더링되는지만 바뀌었다. 신규 API 호출/신규 category 없음.

## 8. 점수-상세 중복 검토(§15~16)

- **점수카드 vs 상단 spec vs 주거환경**: 점수카드는 0~100 점수와
  peer-비교 정성 문구만 쓰고("서구 비교 단지보다 좋은 편입니다") 원본 숫자
  ("1.2대", "84㎡" 등)를 절대 반복하지 않는다(explain.ts 설계 그대로) —
  실제 코드/실측 확인 결과 §15가 우려한 "3중 반복"은 **애초에 존재하지
  않았다**(점수카드=판단, 상단 spec=원본 숫자, 세부 section=상세 근거라는
  역할 분리가 S2C/S3 설계 시점부터 이미 지켜지고 있었음).
- **브리핑 vs 점수카드**: 둘 다 같은 `scoreResult` API 응답에서 나오므로
  내용이 모순될 수 없다(S3에서 이미 확인). 문구가 겹치는지도 확인했다 —
  점수카드의 카테고리 설명은 기본적으로 접혀 있고("왜 이런 점수인가요?"
  클릭 전에는 숫자만 노출), 브리핑은 별도 카드에 최대 2강점+1확인+1종합만
  쓴다. 접힌 상태에서는 동시에 같은 문장이 두 번 보이는 경우가 없어 추가
  수정 없이 유지했다.

## 9. score identity matching 광역 QA(§20~21)

S3에서 발견한 "짧은 이름과의 부분포함으로 인한 false AMBIGUOUS" 버그
(exact-match 우선으로 수정됨, 서구14+해운대43건)를 **부산 전체**로 확대
검증했다.

### 방법
1. 수영구(26500)/남구(26290)/동래구(26260)/연제구(26470)/부산진구(26230)
   각 10곳(총 50곳, §23 요구치 "기타구 10"을 초과 달성) — 실제 살아있는
   `/api/apt/[name]/score`를 호출해 자기 자신의 이름+동으로 정확히 해결
   되는지 확인.
2. **부산 전체 3,402개 apt**(aptSeq 확보분)를 대상으로 "같은 sggCd+dong
   안에서 fuzzy 매칭이 여러 건 걸리는 쌍"을 전수 스캔.

### 결과
- 5개구 50곳 표본: **NOT_FOUND 0 / AMBIGUOUS 0 / 예상 밖(잘못된 지역
  fallback으로 의심되는) OK 0건** — 전부 정상적으로 `INSUFFICIENT_DATA`
  (feature 미수집 지역이라 score는 없지만 identity는 정확히 해결됨).
- 부산 전체 스캔: fuzzy 매칭 충돌이 발생하는 apt-지목 쌍 **461건** 중
  S3의 exact-match-우선 수정으로 **453건이 해소**, 나머지 **4쌍(8건)만
  여전히 AMBIGUOUS**로 남았다:

  | 지역/동 | 충돌 쌍 |
  |---|---|
  | 부산진구 양정동 | 수목하우스(26230-2325) / 수목하우스(26230-2485) |
  | 영도구 동삼동 | 오션라이프에일린의뜰2단지(26200-1221 / 26200-783) |
  | 기장군 교리 | 리츠빌리지(26710-541 / 26710-540) |
  | 금정구 부곡동 | 부곡늘푸른아파트(26410-29 / 26410-34) |

  이 4쌍은 **같은 동 안에 정규화 후에도 완전히 동일한 이름**을 가진
  서로 다른 aptSeq 2건이 `ApartmentMaster`에 실제로 존재하는 경우다 —
  코드로 "어느 쪽이 맞는지" 추측할 근거가 없어 **AMBIGUOUS로 안전하게
  응답하는 것이 올바른 동작**이다(다른 단지 score를 잘못 주는 것보다
  안전). 분류: **DATA_REVIEW_CANDIDATE**(향후 `ApartmentMaster` 원본
  데이터에 왜 동일 이름 2건이 있는지 별도 확인 필요 — 이번 STEP에서
  임의로 병합/삭제하지 않음).

### wrong score fallback 여부
**0건.** 모든 표본에서 다른 단지/다른 지역의 score가 잘못 반환된 사례는
없었다.

## 10. Mobile / Desktop 실측(§18~19)

`해운대구 경동`(26350-2, 892세대, 실측 39종 중 12개월 기준 다수 노출)으로
확인:
- Desktop: 칩 11개+가 한 줄에 가로 스크롤(하단 스크롤바+우측 화살표
  affordance)로 자연스럽게 노출, 우측 끝 ㎡|평 토글은 항상 고정 위치.
- Mobile 375px(iframe 고정폭 방식, `resize_window` 미동작 — 기존 기록과
  동일 환경 특성): 칩 컨테이너 안에서만 가로 스크롤, 페이지 레벨
  가로 스크롤 없음. 토글 버튼 줄바꿈 없이 정상 표시.
- 평 토글 클릭 시 칩이 "17.8평/18.009평/18.014평/..."로 즉시 전환 —
  **18.009평과 18.014평처럼 실제로 정밀도 escalation이 발동하는 사례를
  실거래 데이터에서 직접 확인**(설계가 이론이 아니라 실제로 작동함을
  증명).
- 거래표(75건) 전체를 스크롤하며 "타입" 컬럼이 칩과 동일한 단위/라벨로
  일관되게 표시됨을 확인(§22).
- 주거환경 탭에서 마트/편의점/약국/어린이집/공원/병원 카드가 정상 렌더,
  주차 게이지 중복 없음, 상단 AptSpecGrid의 "주차대수"는 그대로 유지 확인.

## 11. 검증(§26~27)

```text
npx tsc --noEmit                                — 0 errors
npx eslint (변경 파일 전체)                        — clean(사전 존재 경고 1건만, 무관)
npx next build                                   — 성공
verify-score-engine.ts                           — 26/26 pass(회귀 없음, S2C/S3 그대로)
verify-apt-detail-ia.ts(신규, 13개)                — ALL PASS: 평 변환 공식/면적
                                                     normalization 무병합/unit toggle
                                                     단일 진입점/칩 상한 제거(정적)/
                                                     주차 중복 제거(정적)/교통·주거환경
                                                     IA 이동(정적)
브라우저 실사용 검증                                — §10 기록대로 desktop+mobile 375,
                                                     실제 데이터로 정밀도 escalation
                                                     발동 확인
```

## 12. DB/UI 변경 범위(§33)

- DB schema/migration: 없음.
- feature collection: 없음(신규 API/데이터 소스 없음, 기존 KakaoPlaces
  category 재사용만).
- score formula/weight: 변경 없음.
- UI 변경: `AreaSelector`(칩 상한 제거), `apt-client.tsx`(토글 추가, 두
  컴포넌트 prop 변경), `LivingEnvironmentPanel`/`NeighborhoodInfoPanel`
  (카드 재배치, 컴포넌트 자체 로직은 재사용).

## 13. 생성/수정 파일

신규:
- `scripts/apartment-score/verify-apt-detail-ia.ts`
- `docs/development/APT-DETAIL-QA-IA-v1.md`

수정:
- `src/lib/area-utils.ts`(평 변환 라벨 함수 추가, 기존 함수 리팩터링만
  — 동작 동일)
- `src/components/AreaSelector.tsx`(칩 상한 제거)
- `src/app/apt/[name]/apt-client.tsx`(areaUnit state/toggle, prop 배선)
- `src/components/LivingEnvironmentPanel.tsx`(주차 게이지 제거, 생활편의
  카드 6종 추가)
- `src/components/NeighborhoodInfoPanel.tsx`(생활편의 카드 6종 제거,
  교통만 남김)

## 14. Unresolved / 다음 STEP 후보(§41)

- 4쌍(8건) 진짜 동일이름 중복은 `ApartmentMaster` 데이터 자체 검토
  필요(DATA_REVIEW_CANDIDATE, 이번 STEP에서 임의 수정하지 않음).
- section 전체 재배치(Hero→점수→실거래→면적→브리핑→기본정보→교통→
  주거환경→학교접근성→지도→대출→커뮤니티)는 사용자 결정에 따라 이번
  STEP에서 보류 — 별도 STEP으로 진행 필요.
- Hero의 "전용 X㎡ · 약 Y평" 이중표기를 토글과 통합할지(예: 평 모드일 때
  "전용 25.4평"만 보여줄지)는 이번 STEP에서 판단하지 않음 — 현재는
  일관되게 이중표기 유지가 더 안전하다고 판단했다.
- 모바일 실기기(에뮬레이터 아님) 검증은 하지 않음(S3와 동일한 제약).

## 15. APT_DETAIL_QA_CLOSE(1차)

BLOCKER 없음. 위 unresolved 3건은 전부 명시적으로 범위 밖 처리(다음 STEP
후보)로 문서화됐고, 이번 STEP에서 손댄 모든 항목은 tsc/eslint/build/
39개 unit test/실브라우저 검증을 통과했다.

---

# FINAL 전 추가 UX QA — typography / 버스 로딩 / 검색 UI

사용자 실사용 피드백으로 아래 3개를 1차 QA 이후 추가로 처리했다.

## 16. Typography audit

`detail.module.css`, `AptSpecGrid.module.css`, `StickyPriceBar.tsx`,
`ApartmentScoreCard.module.css`, `TradeTimelineList.tsx` 등 상세페이지
전체의 `font-size` 선언을 grep으로 전수 확인(px 환산 기준 16px root).

### 실제 발견한 11~12px 미만 텍스트
| 위치 | 이전 | px 환산 | 이후 |
|---|---|---|---|
| AptSpecGrid `.cellLabel`(세대수/준공년월 등 라벨) | 0.68rem | 10.9px | 0.78rem(12.5px) |
| AptSpecGrid `.cellMissing`("정보 없음") | 0.72rem | 11.5px | 0.8rem(12.8px) |
| AptSpecGrid `.reportLink`("제보/수정") | **0.62rem** | **9.9px** | 0.75rem(12px) |
| StickyPriceBar "최근 실거래가" 라벨(모바일 하단 고정바) | 0.7rem | 11.2px | 0.78rem(12.5px) |
| TradeTimelineList `thStyle`(거래표 컬럼 헤더) | 0.7rem | 11.2px | 0.78rem(12.5px) |
| TradeTimelineList 가격 증감 배지(▲/▼) | 0.65rem | 10.4px | 0.72rem(11.5px) |
| ApartmentScoreCard `.betaBadge`("Beta" 배지) | 0.7rem | 11.2px | 0.75rem(12px) |

AptSpecGrid `.cell`의 `min-height`도 늘어난 텍스트에 맞춰 68px→76px로
소폭 조정(정보 밀도 구조는 그대로 — 5열/3열 그리드, 칸 수 변경 없음).

### 이미 12px 이상이라 손대지 않은 것
0.78rem 이상(InvestmentMetrics 라벨, CommunityPreview 메타, 모달
`detailTable`, 학교/생활정보 패널 안내문 등)은 그대로 뒀다 — "가독성
우선"이되 "이미 충분한 걸 임의로 더 키우지 않는다"는 원칙(§1 "정보 밀도
유지").

브랜드 전체 typography 토큰(글자 크기 체계 자체)은 만들지 않았다 — 상세
페이지 범위의 개별 값만 최소 수정.

## 17. 대중교통 버스 로딩 지연 — 원인 추적 결과

### 실측
`/api/transit/bus-stops`를 직접 timing 측정:
- **최초(캐시 미스) 호출: 3.4초**
- 같은 좌표 재호출(서버 캐시 hit): **0.02~0.03초**

route.ts 코드 확인 결과 서버는 이미 `getOrSetCache`로 정류소 위치(6h)/
경유노선(6h)을 캐싱하고 있었다 — **재방문·재조회가 느린 게 아니라, 캐시가
없는 좌표를 처음 조회할 때 외부 TAGO(국토교통부 공공데이터) API 자체가
느리다**는 게 확정됐다(정류소 조회 → 그 결과로 노선 조회, 이 둘이
구조상 순차적일 수밖에 없어 콜드 스타트에서 지연이 누적됨). Kakao
categorySearch(지하철)는 Kakao 자체 인프라라 상대적으로 빨라 버스보다
먼저 표시되는 것으로 확인 — **프론트엔드 워터폴 문제가 아니라 API 자체
응답 지연이 주 원인**(사용자 질문 그대로 구분 확정).

### 실제로 고친 것(API 호출 수 증가 없이)
1. **탭 재방문 시 불필요한 재호출 제거**: `apt-client.tsx`가 환경/교통/
   학군 탭을 조건부 렌더(`{infraTab === tab && <Panel/>}`)해 매번
   unmount/remount — 같은 세션에서 교통→환경→교통으로 오가기만 해도
   KakaoPlaces/BusAccessCard가 매번 새로 geocode+API를 호출했다.
   `visitedInfraTabs`(Set) 상태를 추가해 한 번 연 탭은 계속 마운트해두고
   `display:none`만 토글 — **처음 열 때까지는 그대로 지연 렌더**(방문한
   적 없는 탭 때문에 호출이 늘지는 않음), 재방문은 캐시된 컴포넌트 상태를
   그대로 재사용. 브라우저로 직접 검증: 환경↔교통 반복 전환 시
   `bus-stops` 네트워크 요청 **0건 추가**.
2. **로딩 skeleton 개선**: `BusAccessCard`/`KakaoPlaces`의 "검색
   중입니다..." 밋밋한 텍스트를 최종 콘텐츠와 같은 모양의 skeleton
   bar(`detail.module.css`의 기존 `.skeletonBar` 재사용)로 교체 — 외부
   API 지연 자체는 줄일 수 없지만(§ "해결 불가한 외부 API 지연이면
   skeleton/loading UX 개선" 지시대로) 체감을 개선했다.

### 하지 않은 것
- geocoding을 지하철/버스가 공유하도록 구조를 바꾸는 안(Promise.all
  병렬화)은 검토했으나, 실측상 지연의 실질적 원인이 TAGO API 자체 응답
  시간이라 geocoding 중복 제거만으로는 체감 개선폭이 작다고 판단해
  이번 STEP에서는 하지 않았다(§"기존 데이터 정확도나 fallback 정책
  훼손 금지" 원칙과 함께, 검증되지 않은 구조 변경으로 새 버그를 만들
  위험 대비 효과가 낮음).
- 서버 사이드 사전 워밍(인기 단지 백그라운드 pre-fetch)은 훨씬 큰 인프라
  변경이라 범위 밖.

## 18. 상세 상단 검색 UI

### 이전 상태(실브라우저 확인)
Header의 `searchSlot`은 이미 `flex:1; max-width:320px`로 검색창 크기의
자리를 잡아뒀는데, 그 안에 38×38 원형 투명 버튼(🔍 이모지)만 떠 있어
"완성된 검색창"이 아니라 어중간한 아이콘으로 보였다(이모지 사용은 브랜드
규칙 위반이기도 함).

### 수정
`src/components/ApartmentSearchTrigger.tsx` 신규(+ CSS module):
- 실제 검색창처럼 보이는 pill 버튼 — border/background(`var(--bg-color)`)
  /radius, `Lucide Search` 아이콘(이모지 아님) + placeholder 텍스트
  "아파트명, 지역명 검색".
- height 44px(터치 영역 기준 충족), hover/focus-visible 상태 정의.
- 클릭 시 여는 동작(기존 `openModal('빠른 검색')` → `ApartmentQuickSearch`
  모달)은 완전히 그대로 — 새 라우트/새 모달 없음, 기존 "최근 본 단지"
  기능도 그대로 동작 확인.

### 실측 확인
- Desktop: 검색창이 로고와 우측 메뉴 사이에 자연스러운 폭으로 표시,
  클릭 시 기존 빠른 검색 모달 정상 오픈(최근 본 단지 목록 정상 표시).
- Mobile 375px: placeholder가 좁은 폭에 맞춰 ellipsis로 축약(잘림 아님,
  CSS `text-overflow:ellipsis`), 로그인 버튼과 겹침 없음.
- Mobile 430px: placeholder 전체 텍스트 표시, 여유 있음.

## 19. 검증(이번 라운드)

```text
npx tsc --noEmit           — 0 errors
npx eslint(변경 파일 전체)   — clean(사전 존재 경고 1건만, 무관)
npx next build              — 성공
verify-score-engine.ts      — 26/26 pass(회귀 없음)
verify-apt-detail-ia.ts     — 13/13 pass(회귀 없음)
브라우저 실측                — §16~18 기록대로 375/430+desktop, console
                              error 0건, bus-stops 재호출 0건(탭 전환),
                              typography 육안 확인
```

## 20. 최종 결과 — 1차 QA + 추가 UX QA 통합

### 생성/수정 파일(전체)
1차(§13)에 추가로:
- 신규: `src/components/ApartmentSearchTrigger.tsx`,
  `ApartmentSearchTrigger.module.css`
- 수정: `apt-client.tsx`(탭 caching, 검색 트리거 교체),
  `AptSpecGrid.module.css`/`StickyPriceBar.tsx`/`TradeTimelineList.tsx`/
  `ApartmentScoreCard.module.css`(typography), `BusAccessCard.tsx`/
  `KakaoPlaces.tsx`(skeleton)

### DB/schema/score weight
변경 없음(이번 라운드도 UI/프론트 구조 수정만).

### unresolved(누적)
1차 3건 + 이번 라운드에서 새로 발견된 것 없음 — geocoding 공유 구조
개선은 "검토했으나 이번 STEP에서 보류"로 §17에 명시.

## 21. APT_DETAIL_QA_CLOSE(FINAL)

BLOCKER 없음. 1차 QA(§1~15) + 추가 UX QA(§16~20) 전부 tsc/eslint/build/
unit test/실브라우저 검증 통과. commit/push 진행.
