# E-JIP REPORT ENGINE — REPORT-4 (단지 비교 한장 리포트)

> 선행: `REPORT_ENGINE_V1_REPORT_3_APARTMENT.md`.
> **Production write 없음 / schema 변경 없음 / migration 없음.**
> 이미지·PDF 내보내기는 REPORT-6.

## 1. 라우트 / identity

`/report/compare?a={aptSeq}&b={aptSeq}`

identity는 **canonical aptSeq뿐**이다(§3). 이름·동+이름·유사매칭·첫 검색결과로
비교하지 않는다. 표시명은 라벨일 뿐이다.

가드(§1) — 어떤 경우에도 **다른 단지로 대체하지 않는다**:

| 상황 | 코드 | 화면 |
|---|---|---|
| a 또는 b 누락 | `MISSING_PARAM` | "두 곳의 aptSeq가 모두 필요합니다" |
| a === b | `SAME_APARTMENT` | "같은 단지끼리는 비교할 수 없습니다" |
| 한쪽 없음 | `NOT_FOUND_A/B` | "첫/두 번째 단지를 찾을 수 없습니다" |
| 양쪽 없음 | `NOT_FOUND_BOTH` | "두 단지 모두 찾을 수 없습니다" |

모든 가드 화면에서 비교 섹션이 아예 렌더되지 않고 다른 단지의 금액도 나오지 않는다.

## 2. 데이터 흐름

```
page.tsx (server)
  → readApartmentCompareReport(a, b)      ← 유일한 DB/Score 접근 지점
  → ReportEnvelope<ApartmentCompareReportData>
  → <CompareReportSheet envelope={...} />  ← envelope만 읽는 표현 컴포넌트
```

Compare V2의 `fetch.ts`는 브라우저용(상대경로 `/api/...`, 이름 기반)이라 서버에서 쓸 수 없다.
그래서 읽기만 서버에서 다시 하고, **지표를 만드는 순수 빌더는 그대로 재사용**한다:
`selectPriceMetric` / `buildFactMetrics` / `buildLocationMetrics` / `buildScore` / `domainEvidence`.
`RawTrade` 변환 규칙(`price = dealAmount/10000`, `area`는 ㎡ 문자열)도
`/api/apt/[name]` 라우트와 동일하게 맞췄다 — 지표 정의가 화면마다 갈라지지 않게.

## 3. 신뢰 재사용과 **리포트 전용 강화**

Compare V2의 `MetricTrust`(SAFE/LIMITED/UNSAFE/MISSING)와 `MetricDirection`을 그대로 쓴다.
리포트 전용 경쟁 모델을 만들지 않았다(§5).

다만 **한 가지를 위에 더했다**(§6):

```ts
rankableInReport(d) =
  d.comparable && d.favors != null && d.a.trust === 'SAFE' && d.b.trust === 'SAFE'
```

Compare V2의 `buildDifference`는 MISSING만 비교 불가로 접고 **LIMITED는 favors를 낼 수 있다.**
비교 *화면*에서는 주의 문구와 함께 보여주는 게 맞지만, 리포트는 캡처되어 단독으로
돌아다니는 물건이라 주의 문구가 떨어져 나가기 쉽다. 그래서 **리포트 쪽에서만 더
엄격하게** 잠근다 — Compare V2의 의미는 바꾸지 않는다(§0).

`reclassifyForReport()`가 SAFE가 아닌데 favors가 붙은 항목을 강점에서 빼
**판단 제한**으로 내린다. 테스트로 고정했다:
LIMITED 지표는 Compare V2에서 `favors='a'`가 나오지만 리포트에서는 강점 0개 / 판단 제한 1개.

## 4. 비교 지표 (§4)

**핵심 비교**: 최근 실거래가 · 이집 점수 · 준공 · 세대수 · 주차
**항목별 점수**: 교통/생활/교육/단지 (양쪽 점수가 모두 있을 때만 섹션 생성)
**교통·생활**: 지하철 거리 · 초등학교 거리 · 편의점 · 버스정류장

**넣지 않은 것**: 평/평형(㎡만), "역대 신고가", 가격 전망/추천, 종합 점수 재계산.

## 5. Score (§8)

REPORT-3과 같은 경로다 — `calculateApartmentScore` → `_shadowV2` → `getPeerContext` →
compare-v2의 `buildScore`. **비교 전용 점수를 따로 만들지 않는다.**
한쪽이라도 점수가 없으면 점수 지표는 `MISSING`("준비 중")이고 항목별 점수 섹션 자체를
만들지 않는다 — 한쪽만 그리면 없는 쪽이 0점처럼 읽힌다.

## 6. 종합 승자를 만들지 않는다 (§7)

`data.overallWinner`는 **타입상 항상 `null`**이다. 단순 점수 카운트로 승자를 뽑지 않는다.

해석 문장은 개수 사실 + 선택 기준만 말한다:

> 대연롯데캐슬레전드1단지는 0개 항목에서, 동래래미안아이파크는 1개 항목에서 앞섭니다.
> 어느 쪽이 맞는지는 가격·교통·단지 규모 중 무엇을 우선순위에 두는지에 따라 달라집니다.

강점이 양쪽 다 0개면 해석 문장 자체를 만들지 않는다(실측: rich-sparse / sparse-sparse /
no-parking 케이스 모두 해석 없음, ▲ 0개).

## 7. 레이아웃 (§13/§14)

REPORT-2/3의 시트 셸을 재사용한다. **넓은 표를 쓰지 않는다** — 항목명을 위에 두고
A/B 값을 아래 2열로 쌓아, 360px에서도 가로 스크롤이 없다.

우열 강조(`▲` + 초록)는 **리포트 기준 SAFE 우열에만** 붙인다.
모든 행을 빨강/파랑으로 칠하는 스코어보드가 되지 않게 했다. 실측: rich-rich에서 ▲ 1개,
나머지 3케이스에서 ▲ 0개.

## 8. 액션 (§15)

`[공유하기]` + `[A 자세히]` + `[B 자세히]`.
두 상세 링크 모두 canonical aptSeq를 보존한다(`/apt/{name}?aptSeq={aptSeq}`).
이미지/PDF 저장은 REPORT-6이라 비교 리포트 액션바에는 넣지 않았다(성공한 척 금지).

## 9. 3단지 확장

`CompareReportInput.sides`와 `data.sides`를 **배열**로 뒀다. V1은 2개 고정 튜플이지만
계약이 3개 확장을 막지 않는다. `buildDifferences`가 쌍 단위라 3단지는 쌍 조합
처리만 추가하면 된다.

## 10. 성능 (§18)

라우트 총 시간(로컬 프로덕션 빌드, ms):

| 조합 | cold | warm |
|---|---|---|
| rich vs rich (26290-2625 / 26260-2234) | 144 | 90 / 107 / 140 |
| rich vs sparse (26290-2625 / 26110-1) | 145 | 92 / 50 / 63 |
| sparse vs sparse (26110-1 / 26110-10) | 77 | 45 / 46 / 40 |
| 가드(같은 단지 / 없는 단지 / 누락) | — | 5~56 |

**warm ≤500ms, 라우트 ≤1s 목표를 모두 충족한다.** 두 단지를 `Promise.all`로 병렬 로드한다.

## 11. QA 결과

**196/196 PASS** — 4케이스(rich-rich / rich-sparse / sparse-sparse / no-parking)
× 5폭(360/390/430/767/1280) + 가드 4종:

- 가로 오버플로 0 / 페이지 에러 0
- **승자 단정 표현 0건**(더 좋습니다·더 낫습니다·추천·승자·우승·1위)
- **예측 어휘 0건** / **"역대 신고가" 0건** / **평 라벨 0건**
- 상세 링크 2개가 각각 `aptSeq=` 보존, 요청한 두 aptSeq와 일치
- 트레이드오프 4분류 섹션 상시 존재
- 1280px 시트 520px 고정
- 가드 4종: 안내 문구 정확 + 비교 섹션 미렌더 + 다른 단지 금액 0건

**단위 11/11 PASS**: SAFE-only 랭킹 게이트 / LIMITED 강등 / 승자 미생성 /
aptSeq identity + 딥링크 / 한쪽 점수 없음 / 주차 MISSING / 4분류 상시 존재 /
커버리지 미검증 / 평·역대 표현 부재 / 결정론.

회귀 없음: REPORT-1 25/25, REPORT-3 13/13, 읽기 전용 통합 5/5.

## 12. 빌드 / 품질

eslint 0 errors · `tsc --noEmit` **src 0건** · `npm run build` 성공.

## 13. 남은 한계

1. **A ↔ B swap 버튼은 넣지 않았다**(§16은 선택). URL의 a/b를 바꾸면 되지만 UI 버튼은 없다.
2. 비교 대상 선택 UI가 없다 — 현재는 URL 직접 접근으로만 도달한다.
3. `similar`로 분류되는 항목이 많다. Compare V2의 `isMeaningful` 임계값이 342m vs 473m
   지하철 거리, 1.18 vs 1.12 세대당 주차를 "의미 있는 차이 아님"으로 판정하기 때문이며,
   그 판단은 Compare V2가 이미 보정한 것이라 리포트에서 뒤집지 않았다.
   결과적으로 리포트는 **차이를 만들어내지 않는 쪽으로** 보수적이다.
4. 2년 최고가/12개월 거래량은 비교 리포트에 넣지 않았다 — 핵심 비교가 이미 5줄이고
   한 장 가독성을 우선했다. 단지별 상세 수치는 REPORT-3 리포트에 있다.
5. 이미지/PDF 저장 없음(REPORT-6).
