# STATISTICS V2.1-2A — TRANSACTION VOLUME CHART UI POLISH / DETAIL CHART STYLE ALIGN

## 1. 목적

"거래량" 화면의 차트를 아파트 상세페이지(`/apt/[name]`)의 `PriceTrendChart`가
이미 검증한 UX 수준(모바일 full-bleed 카드, tap-즉시-선택 + drag-scrub
crosshair, 검은 focus box 버그 없음)에 맞춰 재정비한다. 데이터 계산 로직/
API 계약/기간·지역 필터 계약은 전혀 바꾸지 않는다 — 표현(시각/인터랙션)만
개선한다.

## 2. 현재 상태(작업 전 감사)

- 차트: `type-client.tsx`의 `VolumeView`/`VolumeSummaryStrip`, 기본
  Recharts hover만 사용(커스텀 crosshair/hit-test 없음), 컬러는 라인이
  `#3b82f6` 하드코딩(토큰 아님).
- 카드: 다른 stats 화면 전부와 공유하는 `page.module.css`의
  `.panel`/`.panelBody`(모바일 전용 padding 축소나 full-bleed 없음, 항상
  1.5rem 고정 패딩) — 모바일에서 답답해 보이는 원인.
- 상세페이지 `PriceTrendChart.tsx`/`.module.css`는 이미 activeIndex 기반
  tap/drag crosshair, 커스텀 dot/tooltip, `pointerdown` `preventDefault()`로
  검은 focus box 해결, `width:100vw; margin-inline:calc(50% - 50vw)` 모바일
  full-bleed 기법을 갖추고 있었다(다른 화면에서 재사용된 적 없음).

## 3. 설계 결정

- `.panel`/`.panelBody`는 다른 stats 화면(랭킹/갭투자/비교/분위지도)이 모두
  공유하므로 직접 수정하지 않는다 — 대신 거래량 화면만을 위한 독립
  컴포넌트+CSS 모듈(`VolumeChartCard.tsx`/`.module.css`)로 분리해 다른 화면에
  영향 없이 완전히 새 스타일을 적용한다.
- interaction 패턴(activeIndex state, pointerdown/pointermove 콜백 ref,
  `chart-crosshair.ts`의 `findNearestIndex`, 커스텀 dot render-prop,
  `preventDefault(pointerdown)` 포커스 버그 방지)은 `PriceTrendChart.tsx`의
  것을 그대로 재사용/이식한다 — 이미 실측 검증된 해법을 다시 풀지 않는다.
  단, 두 컴포넌트를 하나의 공유 훅/컴포넌트로 추출하는 리팩터링은 이번
  STEP 범위 밖(과도한 리팩터링 금지 원칙)이라 하지 않았다 — `chart-crosshair.ts`
  (이미 범용 순수 함수)만 직접 import해서 재사용하고, 나머지 interaction
  코드는 거래량 차트 문맥(막대+라인 dual-axis)에 맞게 별도로 작성했다.
- "표"(연도별) 뷰는 계산/렌더링을 전혀 건드리지 않기 위해 기존
  `page.module.css`의 `.tableWrapper`/`.yearlyTable*` 클래스를 그대로
  import해서 재사용한다(로직·마크업 무변경).
- 가격지수 라인 색상은 기존 `#3b82f6`(토큰 아님, 근사 하드코딩)을
  상세페이지의 `--rent-color`와 동일한 `#3152d6`로 정리했다(더 진하고
  선명, 기존 STATISTICS_COLOR_SYSTEM_V1의 up/down 의미색과 충돌하지 않는
  중립 색 — 가격지수는 방향성 있는 상승/하락 판정이 아니라 단순 추이선이라
  up/down 토큰을 쓰지 않음).

## 4. 구현 내용

- 신규: `src/components/stats/VolumeChartCard.tsx`,
  `src/components/stats/VolumeChartCard.module.css`.
- `type-client.tsx`: `VolumeView`/`VolumeSummaryStrip`/`DealType`/
  `DEAL_TYPE_OPTIONS`/`VOLUME_COMPARISON_OPTIONS`와 그 전용 recharts/lucide
  import(`ComposedChart`,`Bar`,`BarChart3`,`Table2`,`Lightbulb`)를 제거하고
  `<VolumeChartCard lawdCd sidoCode displayRegionName />` 한 줄로 교체.
- `page.module.css`: `.main`에 `overflow-x: hidden` 추가(상세페이지
  `detail.module.css`와 동일한 이유 — 모바일 full-bleed 카드의
  `width:100vw`가 스크롤바 폭을 포함해 페이지가 미세하게 가로 스크롤되는
  것을 막는 안전장치, 이 페이지 전용 scoped 변경).
- 카드 구조를 헤더(제목+그래프/표 토글) → 거래유형 칩(매매/전세/월세) →
  요약(지역·거래유형·비교기간 + 큰 숫자 + 증감) → 비교기간 칩(7일/30일/
  3개월) → cross-link 버튼 → 커스텀 범례 → 차트 → footnote/guide로
  재배치(원 스펙 §4-A 순서).
- interaction: activeIndex state, `pointerdown`(preventDefault로 포커스
  버그 방지)/`pointermove`(hover-follow + drag-scrub 동시 처리)/`pointerup`/
  `pointerleave` 콜백 ref, 커스텀 `dot`(활성 시 반경 5+흰 테두리, 비활성
  2.5), `activeDot={false}`, `ReferenceLine`으로 세로 crosshair, 커스텀
  `Tooltip content`(월/거래량/가격지수 표시). 막대도 활성 인덱스에서 살짝
  더 진하게(`shape` render-prop) — bar가 crosshair와 같은 지점을 가리키는
  정보 강조.
- 데이터/계산: `chartDataByType[dealType]`, `volumeSummaryByPeriod[preset]`,
  yearly table 전부 API 응답을 그대로 읽기만 한다 — 새 필드 요구 없음, 응답
  shape 변경 없음.

## 5. 테스트 결과

- `npx tsc --noEmit`: 변경 파일 기준 신규 에러 0(기존 scripts/* 34줄은
  이전 STEP과 동일한 FAIL_EXISTING_SCRIPT_ERRORS).
- `npx eslint`: 변경 파일 에러 0.
- `npm run build`: PASS.
- 기존 `.test.mjs` 전체 154/154 PASS(데이터 로직 무변경이라 회귀 테스트
  갱신 불필요).
- 브라우저 실측(부산 서구, `lawdCd=26140`): 매매/전세/월세 전환, 최근
  7일/30일/3개월 비교 전환, 그래프/표 토글, "이 기간 거래가 많은 단지
  보기" cross-link(쿼리스트링 유지 회귀 없음) 전부 정상. 차트 tap 즉시
  선택 + drag-scrub 자연스럽게 이동, tooltip이 실제 API 데이터(예:
  26.03=117건/98.8)와 정확히 일치, 검은 focus box 없음. Y축 tick은 DOM
  텍스트로 직접 검증(0/30/60/90/120 등 — 스크린샷 저해상도에서는 숫자가
  뭉개져 보였으나 실제 렌더는 정확했다, 오탐 기록).
- 모바일 360px(iframe으로 실제 viewport 강제): 카드가 정확히 viewport
  가장자리까지 꽉 차는 full-bleed로 렌더, `scrollWidth === clientWidth`
  (overflow 없음), tap 인터랙션/tooltip 정상.

## 6. 알려진 문제

- 연도별 표(yearly) 데이터/계산은 이번 STEP에서 전혀 건드리지 않았다 —
  기존 성능 특성(콜드 조회 시 다소 느림) 그대로 유지.
- `PriceTrendChart.tsx`와 이번 `VolumeChartCard.tsx`의 interaction 코드는
  의도적으로 공유 추출하지 않고 각자 보유한다(§3 설계 결정 참고) — 향후
  세 번째 차트가 같은 패턴을 필요로 하면 그때 공용 훅으로 추출을 검토할
  가치가 있다.

## 7. 다음 STEP

ChatGPT PM 판단 대기.
