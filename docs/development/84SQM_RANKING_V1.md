# 84SQM_RANKING_V1 — 84㎡ 국민평형 순위

## 1. Goal

이집 통계에 "84㎡ 국민평형 순위" 기능을 추가한다. 전용 84㎡ 계열
아파트의 최근 실거래 가격을 지역별로 한눈에 비교하고, 부산 전체 →
구/군 → 동 → 단지로 drill-down할 수 있으며, 단지의 기본 맥락(세대수,
준공연도, 직전거래 대비, 2년 최고가 대비)을 함께 제공하는 공유 가능한
콘텐츠 화면이다.

이 기능은 **"34평 순위"가 아니라 "전용 84㎡ 계열 순위"**다. 전용면적과
시장평형(마케팅 평형)을 혼동하지 않는다.

## 2. Benchmark Intent

Apt2.me의 "국민평형 순위"를 참고했지만 화면을 복제하지 않았다. 이집은
"순위 + 해석 + 의사결정 연결" 방향으로 재구성했다: 대표 거래 1건의
절대가격 랭킹 위에 직전거래 대비 변화, 트레일링 2년 최고가 대비
맥락, 지역 분포 해석 문장을 얹고, 단지 상세로 바로 연결한다.

## 3. Why 84㎡

`src/lib/price-ranking.ts`의 기존 주석(record-high 슬러그 설명, STATISTICS
FIX_PRICE_RANKINGS_V2_1_1A)이 이미 이 기능을 "84㎡ 절대가격 순위"라는
이름으로 예약해두고 있었다 — "최고가"라는 메뉴명을 향후 이 기능을 위해
남겨둔다는 코멘트. 이번 STEP은 그 자리를 채운다.

## 4. Area Band Audit

실제 데이터 분포를 먼저 감사했다(추정 금지 원칙).

**방법**: `/api/transactions?type=apt&lawdCd=<lawdCd>&months=12`로 부산
서구(26140)/연제구(26470)/해운대구(26350)/동래구(26260) 4개 구의 최근
12개월 매매 실거래(2026-08-29 기준, 총 12,620건)를 raw `excluUseArea`
기준으로 82~87㎡ 구간 0.1㎡ 단위 히스토그램으로 집계했다.

결과 요약(건수):

| 구간 | 건수 |
|---|---|
| 82.0~82.9 | 99 |
| 83.0~83.8 | 66 |
| **83.9** | **0** |
| **84.0~84.9** | **4,980** |
| **85.0** | **12** |
| **85.1~85.8** | **0** |
| 85.9 | 2 |
| 86.1 | 3 |

83.9㎡ 구간은 표본 12,620건 중 0건으로 완전히 비어 있고, 85.1~85.8㎡
구간도 0건이다. 84.0~84.9999㎡ 구간에만 4,980건이 밀집돼 있고(83.x대
전체 66건보다 압도적으로 큼), 85.0㎡은 12건뿐으로 별도의 소수 단지
전용 면적으로 보인다. 이는 "전용 84㎡ 계열(국민평형)"이라는 실제
시장 관행과 정확히 일치하는 경계다 — 83.x대나 85.0㎡ 단지를 억지로
포함시키면 서로 다른 평면설계를 하나로 뭉뚱그리는 위험이 있다.

## 5. Final Area Band

```
AREA84_BAND_MIN = 84   (inclusive)
AREA84_BAND_MAX = 85   (exclusive)
```

즉 `84.0000 <= excluUseArea < 85.0000`. `src/lib/price-ranking.ts`의
`isInArea84Band()`/`DEFAULT_AREA84_BAND`로 구현했고, 경계값
테스트(83.99 제외/84.00 포함/84.9999 포함/85.00 제외)로 고정했다.

## 6. Raw Area Identity

Band는 "후보를 넓게 모으는" 용도일 뿐 identity가 아니다. 단지별 대표
거래를 고를 때는 band 안의 서로 다른 raw area(예: 84.7855 vs 84.9950)
후보를 모두 비교 대상으로 삼지만(§9), 선택된 이후에는 그 거래의 exact
raw area만 그대로 노출한다 — 병합·반올림 없음. 직전거래 비교(§9
아래)와 2년 최고가 비교는 반드시 **같은 exact raw area** 그룹
안에서만 계산한다(다른 면적과 비교 금지). 실측(대신롯데캐슬,
84.7855㎡/84.9950㎡ 두 가지 raw area가 실제로 공존)으로 병합되지
않음을 확인했다(unit test + live QA 모두 통과).

## 7. Ranking Definition

"선택한 기간 내 84㎡ 계열(84.0~85.0㎡)에서 확인된 단지별 대표 실거래
1건을 가격 내림차순으로 정렬한 순위." "역대 최고가/신고가 순위"라는
표현은 쓰지 않는다 — 영구 실거래 이력 DB가 없어 무제한 범위를
보장할 수 없기 때문(기존 decline/record-high가 이미 확립한 원칙과
동일).

## 8. Recency

기본 기간은 **12개월**. 추가로 1개월/3개월/6개월/24개월을 제공한다
(`price-ranking.ts`의 `PriceRankingPeriodPreset`에 `'1m'`/`'24m'`을
additive로 추가 — 기존 decline/record-high/rising/jeonse-risk 4개
모드의 기본 preset 노출 범위는 전혀 바뀌지 않았다). 24개월은 기존
`HISTORICAL_LOOKBACK_MONTHS`(트레일링 fetch 상한)와 정확히 일치해
안전하다.

## 9. Representative Trade

단지(identity, aptSeq 우선·없으면 name+dong) 단위로, 기간 내 band에
속하는 검증된(취소 제외) 거래 후보를 모아 다음 순서로 대표 거래 1건을
정한다:

1. `dealDate` DESC(가장 최근)
2. `dealAmount` DESC
3. `excluUseArea` DESC
4. `floorRaw` DESC
5. `uid` 오름차순(최종 결정론적 tie-break)

`buildArea84RankingRows()`(`src/lib/price-ranking.ts`)로 구현, 단위
테스트로 각 단계를 개별 검증했다.

## 10. Sorting

기본: 대표 거래가(`currentAmount`) DESC. 보조: 최근거래순(`recent`,
`currentDate` DESC) — 기존 record-high 모드가 쓰던 정렬 함수를 그대로
재사용했다(새 정렬 함수를 만들지 않음).

## 11. Region

전국 → 시도 → 시군구 → 동 drill-down은 기존
`RegionSelectModal`/`RegionContext`를 그대로 재사용해 지원한다. Ranking
계산 자체는 MOLIT 실거래 API 기반이라 지역 제한이 없지만(전국 어디든
lawdCd만 있으면 동작), **세대수/준공연도 enrichment**는 기존
`Apartment`(건축물대장 캐시) 커버리지에 의존하므로 부산 등 이미
캐시가 채워진 지역에서 더 완전하게 보이고, 없으면 항상 null로
숨긴다(추정 없음).

## 12. Row Information

순위, 단지명, 지역(구+동), 대표 실거래가, exact 전용면적(+신뢰
가능한 평형만 보조 표시), 층, 거래일, 세대수, 준공연도, 직전거래(같은
exact area) 대비 변화, 트레일링 2년 최고가 대비 맥락. N+1 없이
페이지(최대 30~100건)당 고정 쿼리 수로만 제공 가능한 정보만
포함했다(§17 참고).

## 13. Price Change (§19)

같은 aptSeq + exact raw area 기준 "바로 직전" 거래와만 비교한다. 다른
면적과는 비교하지 않는다. 직전거래가 없으면 필드 자체를 숨긴다(0으로
지어내지 않음). 라이브 QA에서 실제 사례(힐스테이트이진베이시티,
84.5182㎡, 현재 68,000만원 vs 직전 68,000만원 → 변화 0)로 공식을
검증했다.

## 14. 2-Year Context

기존 `buildHistory()`의 `priorHigh` 추적(트레일링 24개월, 현재 거래
포함 비교)을 재사용해 "최근 2년 최고" 여부와 대비율(%)을 계산한다.
"신고가"/"역대"라는 무제한 표현은 쓰지 않고, 항상
`historicalHighCoverageLabel`(예: "2년")로 조회 범위를 명시한다.

라이브 크로스체크: 힐스테이트이진베이시티(84.5182㎡) 대표 거래
68,000만원(2026-08-08)에 대해 API가 계산한 `recent2yHighDeltaPct =
-6.2%`를, `/api/transactions?months=24` 원본에서 수동으로 재계산(트레일링
24개월 내 같은 exact area 최고가 72,500만원, (68000-72500)/72500 =
-6.2%)해 정확히 일치함을 확인했다.

## 15. Share

새 bespoke share 컴포넌트를 만들지 않았다. 기존
`buildStatsShareContext()`(`src/app/stats/[type]/shareContext.ts`)가
`StatsMenuItem` + `RegionState`만으로 title/text/params를 만드는 generic
헬퍼라 area84도 그대로 재사용된다. 페이지 상단 질문 문구도
`statsRegionShareLabel(region)`을 재사용해 "서구에서 84㎡가 비싼
단지는?"처럼 현재 지역을 반영한다.

## 16. Map/Detail Connection

row 클릭 → `/apt/{name}?lawdCd&dong` 이동(기존 canonical navigation
패턴 재사용, aptSeq/lawdCd/dong 컨텍스트 유지). 라이브 QA에서
실제로 클릭해 이동한 단지 상세 페이지의 가격/면적/층/거래일이 랭킹
row와 정확히 일치함을 확인했다.

"지도에서 보기"/"비교하기" CTA는 이번 V1에서 구현하지 않았다(§26
Next Step 참고) — 좌표 enrichment를 새로 추가하는 것은 이번 STEP
범위를 넘는 확장이라 판단해 보류했다.

## 17. Performance

- Busan 개별 구(서구/연제구/해운대구/동래구) 콜드 응답: 2.0~4.6초
(24개월 fetch, 5분 캐시 — 기존 decline/record-high와 동일한 캐시
계층 재사용).
- 부산 전체(7개 구 병렬 fetch): 캐시 히트 시 빠름, 콜드일 때도 기존
sido-all 인프라(`fetchMonthsThrottledWithStatus`) 그대로 재사용.
- N+1 없음: 세대수/준공연도는 `resolveApartmentContextBatch`(기존
feed/gap-invest/concentration이 이미 쓰는 고정 2쿼리 batch 헬퍼)를
그대로 재사용 — area84 전용 새 쿼리 경로를 추가하지 않았다. 평형
조회도 기존 `resolveTrustworthyPyeongBatch`(고정 2쿼리)를 그대로
재사용.
- 정렬/페이지네이션은 DB 조회 이전에 메모리에서 끝내고, Unit
Master/세대수 batch 조회는 실제 노출되는 페이지 rows에만
적용한다(기존 PERF 원칙 그대로 재사용).

## 18. Mobile

360px/375px/390px 3개 뷰포트에서 QA했다(`resize_window`가 이
환경에서 정상 동작하지 않아 iframe-isolation 기법으로 재현 — 기존
STEP48 문서에서 확립한 방법). 3개 폭 모두 가로 스크롤 없음, 텍스트
잘림 없음, 카드/필터 chip/공유 버튼 정상 렌더 확인.

## 19. Desktop

1568px 폭(브라우저 실측)에서 모바일 카드 레이아웃이 중앙 정렬된 좁은
컬럼으로 유지됨을 확인 — 기존 통계 상세 페이지들과 동일한 패턴(모바일
전용 레이아웃을 억지로 늘리지 않음).

## 20. QA

### 20.1 Automated (`scripts/run-84sqm-ranking-qa.ts`)

부산 서구/연제구/해운대구/동래구/서울 강남구 5개 구 + 부산 전체
sido-all에 대해 라이브 API를 호출해 검증:

- area band(84~85 미만) 준수
- 단지당 row 1개(complexKey 중복 없음)
- 가격 내림차순 정렬
- 직전거래 공식 일치(`changeAmount = currentAmount - previousAmount`)
- "역대"/"신고가" 무제한 표현 부재
- `historicalHighCoverageLabel` 존재
- fake pyeong 정적 가드(우연 일치 시 INFO만)
- canonical 링크 필드(name/lawdCd) 무결성
- `areaBand` 응답 필드 일치
- sido-all region 분포(distinct lawdCd >= 2, sigunguName 존재, partial 계약)
- 대신롯데캐슬 raw area 비병합 spot-check

**실행 결과**: `RELEASE GATE: READY`, P0/P1 findings 0건, INFO 3건(평형
우연 일치 — 기존 스크립트와 동일한 성격의 정보성 로그).

### 20.2 Unit Tests (`src/lib/price-ranking.test.ts`)

기존 30개 테스트(decline/record-high/rising/jeonse-risk)에 area84
전용 16개 테스트를 추가(총 46개, 전부 pass): band 경계값, band 밖
제외, 취소/미래/기간외 거래 제외, 단지당 대표 1건, 동점 tie-break,
raw area 비병합(대신롯데캐슬 케이스), 단지별 독립 row, 같은 exact
area만 직전거래 비교, 2년 최고가 판정/대비율, interpretation 문구
분기 및 금지어 부재, 지역 분포 해석 문구(표본 부족/집중도 부족 시
null).

### 20.3 Live cross-check

부산 서구 1위 row(힐스테이트이진베이시티, 84.5182㎡, 68,000만원,
2026-08-08)를 `/api/transactions` 원본 응답과 직접 대조해 가격/면적/
층/거래일/직전거래/2년최고가 대비율까지 전부 일치함을 확인(§14 참고).

## 21. Known Limitations

- "역대 진짜 최고가"는 제공하지 않는다(영구 실거래 이력 DB 없음,
기존 decline/record-high와 동일한 한계).
- 세대수/준공연도는 `Apartment` 캐시 커버리지가 있는 지역에서만
채워진다(주로 부산) — 없으면 항상 숨김, 추정하지 않음.
- "지도에서 보기"/"비교하기" CTA 없음(§16/§26).
- 2년 최고가/직전거래 비교는 같은 exact raw area 그룹 안에서만
계산되므로, 같은 단지의 다른 84㎡대 면적(예: 84.5㎡ vs 84.9㎡)끼리는
서로 비교하지 않는다(설계 의도).

## 22. Future TRADE HISTORY DATA

이번 STEP에서 영구 실거래 이력 DB(TRADE_HISTORY_DATA_V1)는 구현하지
않았다. 이 데이터가 생기면: (1) "역대 진짜 최고가"를 정직하게 제공
가능, (2) 24개월보다 긴 기간 옵션 제공 가능, (3) sido-all 응답
속도가 라이브 fetch가 아니라 DB 집계로 크게 개선될 수 있다.

## 23. 사용자 결정 여정 연결

향후 "사용자 결정 여정"(84㎡ 순위 → 단지 상세 → 지도 → 비교 →
실구매 비용) 연결 후보를 기록만 해둔다. 이번 STEP에서 Journey Engine
자체는 구현하지 않았다:

- 단지 상세는 이미 연결됨(row 클릭).
- "지도에서 보기": 좌표 enrichment(aptSeq 기준 ApartmentMaster 배치
조회 1회 추가)가 필요 — 안전하게 추가 가능해 보이나 이번 STEP
범위 밖.
- "비교하기": 현재 `/stats/compare`는 URL 프리필을 지원하지 않아(수동
검색만 가능) 랭킹 row에서 바로 연결하려면 compare 페이지에 URL
state 지원을 먼저 추가해야 한다 — 후속 backlog.
- 실구매 비용 연결은 해당 기능이 아직 없어 범위 밖.

## 24. Next Step

권장 다음 단계는 `PRICE_MAP_V2`(§29 CONTENT-CREATOR VALUE와 자연스럽게
이어지는 시각화) 또는 위 §23 "지도에서 보기" 좌표 enrichment 추가.
`TRADE_HISTORY_DATA_V1`은 스키마 변경이 필요한 더 큰 작업이라 별도
승인 후 진행을 권장한다.
