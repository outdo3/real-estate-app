# E-JIP REPORT ENGINE — REPORT-3 (단지 한장 리포트)

> 선행: `REPORT_ENGINE_V1_REPORT_2_REGION_UI.md`.
> **Production write 없음 / schema 변경 없음 / migration 없음.**
> 이미지·PDF 내보내기는 REPORT-6.

## 1. 라우트

`/report/apt/[aptSeq]` — 예: `/report/apt/26290-2625`

- **identity는 aptSeq뿐이다.** 표시명으로 단지를 다시 찾지 않는다.
- 없는 aptSeq면 `AptReportNotFound` → **다른 단지로 폴백하지 않고** 안내 화면을 낸다:
  "요청하신 단지(...)를 찾을 수 없습니다. 다른 단지의 정보를 대신 보여드리지 않습니다."
- 이 라우트는 `/api/apt/[name]/score`가 겪는 이름 매칭 위험(AMBIGUOUS/오매칭)이
  **구조적으로 없다** — 시작부터 canonical id를 갖기 때문이다.

## 2. 데이터 흐름

```
page.tsx (server)
  → readApartmentReport(aptSeq)     ← 유일한 DB/Score 접근 지점
  → ReportEnvelope<ApartmentReportData>
  → <ApartmentReportSheet envelope={...} />   ← envelope만 읽는 표현 컴포넌트
```

`grep -rn "prisma" src/components/report/` → 0건.

소스: `apartment_masters`, `apartment_trade_histories`, `apartment_location_features`,
`apartment_market_features`, `sync_coverage_cells`, 그리고 **기존 Score 엔진**.

## 3. Score 통합 — 재계산하지 않는다 (§6)

`apt-read.ts`는 `/api/apt/[name]/score` 라우트의 조립을 그대로 따라간다:

```
calculateApartmentScore(aptSeq)
  → _shadowV2
  → getPeerContext(...)            (라우트와 같은 조건에서만)
  → deriveScoreCardState(...)      ← 상세 화면과 **같은 표시 규칙**
  → buildScore(...)                ← compare-v2의 정규화 어댑터 재사용
  → derivePeerVerdict(...)         ← HIGH만 정확한 숫자, MEDIUM 방향성, LOW 숨김
```

표시 규칙을 리포트에서 새로 만들지 않는 이유: 만드는 순간 상세 화면과 점수가 갈라진다.

### 3.1 실측 parity 확인

| aptSeq | 리포트 점수 | 상세 로직 점수 | state | 일치 |
|---|---|---|---|---|
| 26290-2625 | 67 | 67 | ok | OK |
| 26260-2234 | 71 | 71 | ok | OK |
| 26110-1 | null | null | not-enough-data | OK |
| 26350-225 | null | null | not-enough-data | OK |

점수가 없는 경우도 **양쪽 모두 null**로 일치한다(리포트가 억지로 점수를 만들지 않는다).

Score 계산이 실패해도 리포트 전체를 죽이지 않는다 — 점수만 `준비 중`이 되고
나머지 섹션은 그대로 쓸 수 있다.

## 4. 지표 선택

**PRIMARY (KPI 4)**: 최근 실거래가 · 이집 점수 · 12개월 거래량 · 준공
**SECONDARY**: 12개월 중앙 거래가 · 12개월 ㎡당 중앙가 · 12개월 가격 변화 · 세대수
**OPTIONAL**: 주차(커버리지 70.7% — 없으면 `정보 없음`, 추정 금지)

주소·단지명은 헤더에, 교통/생활은 별도 섹션에 둔다.

**넣지 않은 것**: 평/평형 라벨(Unit Master 2.9% → ㎡만), "역대 신고가"(→ 최근 2년 최고
거래가), 매매↔전월세 관계(매칭 미검증), 가격 전망/추천.

## 5. 신뢰 규칙

- 취소 거래는 쿼리(`dealCanceled:false`)와 순수 레이어 양쪽에서 제외.
- 12개월 거래 **5건 미만**이면 가격 지표(중앙가/㎡당/가격변화)를 `LIMITED`로 내린다.
  거래 건수 자체는 사실이므로 `SAFE`로 그대로 보여준다.
- `eligibility=LIMITED`인 점수를 `SAFE`로 승격하지 않는다.
- 커버리지가 미검증이면 지표가 전부 SAFE여도 리포트는 `UNVERIFIED`.
- MISSING은 값 `null` + `정보 없음`. 0으로 채우지 않고 칩도 중복으로 붙이지 않는다.

## 6. 레이아웃

REPORT-2의 시트 셸(`RegionReportSheet.module.css`)을 **그대로 재사용**한다 —
두 리포트가 같은 물건처럼 보여야 하고, 스타일을 복제하면 곧 갈라진다.

```
HEADER (단지명 / 지역 · 주소)
KPI 4
항목별 점수 (교통·생활·교육·단지, 점수 없으면 섹션 자체가 없음)
가격 · 단지 정보 (중앙가 / ㎡당 / 가격변화 / 세대수 / 주차)
최근 2년 최고 거래가 (기간 문구 필수)
최근 실거래 (전용 ㎡ · 층 · 계약일 · 가격)
교통 · 생활 (지하철 / 초등학교 / 편의점 / 공원)
이집 데이터 해석 (요약 + 강점 + 확인할 점)
푸터 (완전성 / dataAsOf / 기간 / 주의 / 출처)
액션바
```

## 7. 액션 (§12)

`[공유하기]`(Web Share → 없으면 링크 복사, 실패 시 조용히 아무 것도 하지 않음),
`[저장 준비 중]`(**disabled** — REPORT-6이므로 성공한 척하지 않는다),
`[이집에서 단지 자세히 보기]` → `/apt/{name}?aptSeq={aptSeq}`.

## 8. 해석 (§10)

`interpretation.source = 'EJIP_SCORE_BRIEFING'` — Score briefing의 `summary`를
그대로 쓰고, `strengths`/`caution`은 envelope의 `data`로 실어 **강점 / 확인할 점**
블록에 그대로 렌더한다. **리포트가 새 문장을 만들지 않는다.**
briefing이 없으면 해석 섹션 자체가 없다.

## 9. 성능 (§14)

로컬 프로덕션 빌드, 라우트 총 시간(ms):

| 케이스 | aptSeq | cold | warm |
|---|---|---|---|
| 데이터 많음(12개월 275건) | 26290-2625 | 137 | 98~174 |
| 데이터 많음(266건) | 26260-2234 | 286 | 93~136 |
| 희소(1건, market feature 없음) | 26110-1 | 87 | 53~85 |
| 주차 없음 | 26350-225 | 95 | 62~106 |
| 없는 aptSeq | 99999-9999 | 32 | 19~22 |

**warm ≤500ms / 라우트 ≤1s 목표를 모두 충족한다.** 없는 단지는 19~32ms에 즉시 거부된다.

## 10. QA 결과

**128/128 PASS** — 3케이스(데이터 많음/희소/주차없음) × 5폭(360/390/430/767/1280)
+ 없는 aptSeq 2종:

- 가로 오버플로 0 / 페이지 에러 0
- **예측 어휘 0건**(전망·유망·매수 적기·투자 추천·오를)
- **"역대 신고가/역대 최고" 0건**, 2년 최고가는 항상 기간 문구 동반
- **평 라벨 0건**(㎡만)
- 상세 딥링크 전부 `aptSeq=` 포함
- 주차 없는 단지: `주차 정보 없음`(0 아님) + 푸터 안내
- 1280px에서 시트 520px 고정(늘어나지 않음)
- 없는 aptSeq: "찾을 수 없습니다" + **다른 단지 정보 0건**(금액 문자열 자체가 없음)

**단위 13/13 PASS**: aptSeq identity / 취소 제외(취소 금액이 envelope 어디에도 없음) /
2년 최고가 기간 문구 / 평 라벨 부재 / 주차 MISSING / 표본 게이트 / 0건 처리 /
Score 상태별 표시(ok·not-enough-data·v2-absent·no-result) / LIMITED 승격 금지 /
briefing 없을 때 해석 미생성 / 커버리지 미검증 / 결정론.

기존 스위트 회귀 없음: REPORT-1 단위 25/25, 읽기 전용 통합 5/5.

## 11. 빌드 / 품질

eslint 0 errors · `tsc --noEmit` **src 0건**(`scripts/`·`tmp/` 14개는 기존 오류) ·
`npm run build` 성공.

## 12. 남은 한계

1. 가격 추이 차트 없음 — 12개월 가격 변화 수치(`priceChange12m`)만 제공한다.
   `ApartmentMarketFeature` 커버리지가 85.9%라 없는 단지는 `정보 없음`이다.
   월별 시계열을 그리려면 별도 집계가 필요하고, 얇은 표본에서 오해를 부르기 쉬워
   이번 STEP에서는 넣지 않았다.
2. peer 백분위는 envelope(`data.peerTopPercent`)까지만 싣고 화면에는 아직 쓰지 않았다
   (HIGH confidence에서만 노출하는 정책을 UI에 옮기는 건 다음 기회에).
3. 매매↔전월세 관계 없음(매칭 계약 미검증).
4. 단지 리포트 진입점(검색/목록)이 아직 없다 — 현재는 URL 직접 접근 또는 지역 리포트
   카드에서만 도달한다.
5. `unstable_cache` 기반 score cohort 캐시는 Next 요청 컨텍스트 밖(스크립트)에서
   경고를 내고 DB 직접 조회로 폴백한다. 라우트에서는 정상이며 정확성에는 영향이 없다.
