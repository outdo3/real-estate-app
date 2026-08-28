# STATISTICS V2.1-4 — SUPPLY + LARGE COMPLEX

baseline: `f7a2be1` (main)
날짜: 2026-08-28

## 1. Goal

STATISTICS_PLACEHOLDER_AUDIT_V1이 READY_WITH_SMALL_FIX/READY_NOW로 판정한
두 placeholder(공급, 대단지)를 실제 live 통계 기능으로 구현한다. 없는
데이터를 추정하지 않고, 서울/전국 대단지를 구현된 것처럼 보이게 하지
않는다.

## 2. Asil Benchmark

사용자 제공 아실 캡처(입주지도/공급추이, 대단지 순위)를 참고하되 그대로
복제하지 않았다 — 공급은 "지도에 위치 확인된 것만 표시"라는 정직한
커버리지 고지를 추가했고, 대단지는 평형 수 대신 canonical navigation·
주차·최근 거래로 이집만의 맥락을 붙였다(§17 지시).

## 3. Supply Data Source

`Presale`/`PresaleHouseTypeDetail`(청약홈 공식 API, `cheongyakService.ts`)
재사용. 재검증 결과 §2(placeholder audit) 수치와 완전히 일치: 총
1,046건, `moveInExpectedYm`/`totalSupplyHouseholds` 100%, 좌표 728/1,046
(70%). 새 API/스키마 없음.

## 4. Supply Coverage

`locationAddress` 샘플 검증(부산/서울) 결과 형식은 항상
`"{시도전체명} {시군구} {동/지구} {지번}"`이었다 — 단, 세 번째 토큰부터는
"에코델타시티 공동주택용지"처럼 행정동이 아닌 프로젝트/지구명이 섞이는
사례를 확인했다(§5 근거).

## 5. Supply Region Parsing

`src/lib/presale-region.ts` 신규:
- `SIDO_FULL_TO_SHORT`: 대한민국 17개 광역시/도 고정 매핑(REGION_DATA
  키와 동일 집합 — 동적 데이터가 아니라 법정 상수라 하드코딩 금지
  원칙의 대상이 아님).
- `parsePresaleSigungu(locationAddress, sidoFull)`: 두 번째 토큰이
  `REGION_DATA[sidoFull]` 실제 목록에 있을 때만 신뢰(§5 "애매한 주소
  fallback 금지" 그대로 구현) — 세 번째 토큰 이후(동)는 신뢰하지 않아
  **동 단위 drilldown은 이번 V1에서 미지원**(§6 지시대로).

## 6. Move-in Map(입주지도)

`/api/stats/supply`가 지도 마커 + 목록 + 추이를 한 번의 fetch로 함께
계산한다(§14 rows가 1,046건뿐이라 fetch 비용이 낮음, 지도/목록/추이가
같은 필터링 집합에서 나와 숫자가 어긋나지 않음). `SupplyView.tsx`가
`react-kakao-maps-sdk`(`CustomOverlayMap`)로 렌더 — 기존
`PriceMapView`(type-client.tsx)가 이미 검증한 스크립트 로딩 패턴을 그대로
재사용했다(새 GIS 라이브러리 도입 없음, §10).

## 7. Coordinate Coverage

지도에는 좌표가 있는 마커만 렌더한다(§43 — 좌표 없는 단지를 실시간
geocoding으로 보완하지 않음). 목록(list)은 **좌표 유무와 무관하게 전체
row**를 포함해 좌표 없는 단지도 확인 가능하게 했다(§44 지시).

## 8. Map Honesty

Summary 카드에 항상 "전체 입주예정 단지 N개 중 위치 확인 M개"를 함께
표시하고, "지도에는 위치정보가 확인된 단지만 표시됩니다" 고지를
고정 노출한다(§8 지시 그대로). 실측(전국·향후 2년): 전체 485개 중 위치
확인 328개(68%).

## 9. Supply Trend(공급추이)

연도별 집계(월별 대신 — §14 "실제 데이터 분포를 보고 결정"에 따라, 조회
기간이 최대 3년/전체 예정까지 늘어날 수 있어 연 단위가 더 읽기 쉬움).
`projectCount`(단지 수)와 `householdSum`(세대수 합)을 항상 함께 반환해
혼동을 막는다(§15 지시).

## 10. Time Filter

향후 1년/2년/3년/전체 예정(§12/§14) — `moveInExpectedYm >= 오늘 YYYYMM`
필터를 **항상** 먼저 적용한 뒤 상한을 얹는다. 과거 row가 향후 공급에
섞이지 않음을 라이브 QA로 확인(§50 참고).

## 11. Household Aggregation

`totalSupplyHouseholds` 합계와 프로젝트 수를 연도별로 집계
(`byYear` Map). 0건 세대수는 존재하지 않음(Presale이 100% 커버리지라
합산 자체에 결측 보정 로직 불필요).

## 12. Supply Interpretation

deterministic 문장만: "내년(2027년) 입주예정 물량이 올해(2026년)보다
많아요.", "조회 기간 중 2027년 입주물량이 가장 많아요(229개 단지 ·
128,676세대)." — "공급폭탄"/가격전망류 문구는 코드 어디에도 없음(§16).

## 13. Large Complex Data Source

`ApartmentMaster`(건축물대장 공식 데이터) 재사용. 재검증 결과 §2 수치와
완전히 일치: 부산 3,402건, 세대수 3,181(93.5%), 주차 2,357(69%),
건축년도 3,402(100%). aptSeq 중복 0건 확인.

## 14. Busan-only Scope

**중요한 신규 발견**: `mgmBldrgstPk`(총괄표제부 관리번호)가 같은 여러
row가 `totalHouseholds`를 동일하게 복제 저장하고 있었다 — 실측: "엘지
메트로시티1~5, 4-1, 4-2" 7개 row가 전부 같은 mgmBldrgstPk, 세대수
7,374로 동일. 세대수 DESC로 그대로 정렬하면 **상위 10건 중 9건이 실제로는
단 2개 단지**(엘지메트로시티, 레이카운티)였다. `src/lib/large-complex-
dedup.ts`(`dedupeByRegistryGroup`)로 같은 mgmBldrgstPk는 대표 1건만
남긴다(가장 짧은 이름, 동률이면 aptSeq 오름차순 — 이름을 새로 만들지
않음). dedup 후 부산 distinct 대단지는 3,167개(1,000세대+는 164→152개로
정정).

## 15. Ranking Definition

`totalHouseholds DESC`(dedup 이후) — §23 지시대로 canonical metric으로
충분하다고 판단했다. ApartmentMaster는 애초에 아파트 전용 스키마라
(propertyType 필드 자체가 없음, 오피스텔/생숙 모델 부재 확인) V1이
아파트만 다룬다는 사실이 자동으로 보장된다.

## 16. Filters

세대수 threshold(전체/500+/1,000+/2,000+, §24), 구/동 필터(§22). 정렬은
세대수 많은순 고정(이번 V1에서 복잡한 거래가격 필터 불필요, §24 그대로).

## 17. Parking

`parkingPerHousehold`(이미 backfill 시점에 계산되어 저장된 확정값) 있으면
"주차 N.NN대/세대" 표시, 없으면(31%) 그 줄 자체를 숨긴다(§27 — 다른 단지
fallback 없음).

## 18. Build Year

`useApprovalDate`(건축물대장 사용승인일, 더 정확) 우선, 없으면
`buildYear`(MOLIT 건축년도, 참고용) — 기존 다른 화면(price-rankings 등)이
이미 써온 우선순위 관례를 재사용했다. 화면 문구는 기존 관례와 통일해
"OOOO년 입주"로 표시한다(§28).

## 19. Recent Price

aptSeq 기준 batch lookup만 사용(§29, row별 fetch 금지). 현재 **페이지에
등장하는 구만** 모아 최근 3개월 apt 거래를 fetch하고, 구 단위로 5분
TTL 캐시(`getOrSetCache`, 기존 stats 라우트 관례 재사용 — 처음 구현 시
비어있었으나 §41 성능 감사 중 추가했다). 최근 거래 없으면(아직
캐시되지 않았거나 최근 3개월 내 거래가 없는 경우) 그 줄을 숨긴다.

## 20. Why UnitType Count Is Hidden

`ApartmentUnitType`은 `ApartmentMaster`가 아니라 별도의 구식 `Apartment`
테이블(전체 63건)에만 연결돼 있고, 그중 unitTypes가 채워진 건 11건뿐이다
(부산 3,402개 대단지 후보 대비 0.3%). §30 지시대로 대단지 UI 어디에도
"평형 수"를 표시하지 않는다 — QA 스크립트가 응답에 관련 필드가 없는지
정적으로 확인한다(§53).

## 21. Region Support

부산 전체 → 구 → 동 지원(§22). RegionContext.setRegion을 그대로 재사용해
UNSUPPORTED 화면의 "부산으로 이동" CTA를 구현했다 — 새 지역 선택 UI를
만들지 않았다.

## 22. Error/Unsupported

부산 외 지역은 `status: 'UNSUPPORTED'`(§40, "0건"과 명확히 구분되는 별도
상태) + 정직한 안내 문구 + CTA. 공급의 NO_DATA는 일반 `Empty` 컴포넌트로
"선택한 지역/기간에 확인된 입주예정 단지가 없어요"를 표시한다(§19).

## 23. Performance

두 라우트 모두 **신규 N+1 없음**(§42 확인):
- 공급: MOLIT 의존 전혀 없음 — Presale 단일 쿼리(≤1,046행)만으로 지도/
  목록/추이 전부 계산.
- 대단지: ApartmentMaster 단일 쿼리(≤3,402행, 서버 메모리에서 dedup+정렬
  후 페이지만 반환 — §41 "client에 전체 던지고 sort 금지" 준수) + 페이지에
  등장하는 구만 batch MOLIT fetch(구 단위 5분 캐시 추가).

## 24-25. Mobile / Desktop

390px iframe 격리 기법(resize_window 미동작 환경, 기존 STEP 확립 우회법
재사용)으로 공급(입주지도/공급추이 두 탭)·대단지 둘 다 확인 — overflow
없음, 지도/범례/차트/필터/리스트 전부 겹침·잘림 없음. 데스크톱(1440px)도
반응형 확인, 콘솔 에러 없음. 대단지의 UNSUPPORTED→"부산으로 이동" CTA를
실제 클릭까지 검증(정상 동작).

## 26. QA

`scripts/run-statistics-v2-1-supply-large-complex-qa.ts`(신규) — A파트
단위 테스트 10개(dedup 로직, region parsing 안전성, future-only 필터) +
B파트 라이브 API(전국/부산/서울/구 필터/세대수 필터, dedup 회귀 가드,
평형수 노출 여부 정적 검사) + 기존 8개 live 화면 회귀 스모크. 전부 PASS,
findings 0건(2회 반복 실행 모두 확인).

## 27. Known Limitations

- 대단지는 부산 한정이며, 서울/전국 확장은 스키마/API 문제가 아니라
  **건축물대장 backfill 파이프라인을 다른 지역에 대해 재실행**해야 하는
  데이터 엔지니어링 작업이다(§28 Future 참고).
- 공급 데이터는 2026-08-12 1회성 backfill 이후 재동기화되지 않았다(청약홈
  동기화는 관리자 수동 트리거만 존재, cron 없음) — 화면에는 원본 출처
  고지만 표시하고, 자동 재동기화는 이번 STEP 범위 밖.
- Presale 시군구 매칭은 문자열 파싱 기반이라 `locationAddress`가 표준
  형식을 벗어나는 극소수 사례는 시군구 필터에서 누락될 수 있다(동 단위
  파싱 자체를 하지 않으므로 상위 레벨 왜곡은 없음).

## 28. Future National Pipeline

대단지 서울/전국 확장에 필요한 것은 새 API/스키마가 아니라 기존
건축물대장 backfill 파이프라인(부산에서 이미 검증됨)을 다른 지역에
재실행하는 것뿐이다 — 다음 STEP 후보로 남긴다(TRUE GATE 대상 아님,
대규모 데이터 작업이라 별도 STEP으로 분리 권장).

## 29. Broker Briefing Connection

공급(입주 예정 물량)과 대단지(지역 대표 단지 리스트) 둘 다
placeholder audit §29에서 이미 브리핑 가치 상위로 평가됐다 — 이번 STEP의
`interpretation`(공급)과 `scopeLabel`+순위 문구(대단지)는 향후 BROKER
BRIEFING REPORT V1이 그대로 인용할 수 있는 형태로 설계했다(문장 자체가
이미 완결된 사실 진술). report/PDF 구현은 이번 범위 밖.

## 30. Content Creator Value

공급추이의 연도별 bar chart, 대단지의 순위 카드는 캡처 친화적으로
설계했다(카드 단위 완결성, 숫자 강조). 별도 export/공유 기능은 이번
STEP 범위 밖(§59 지시대로).

## 31. Next Step

`FIX_SUPPLY_LARGE_COMPLEX`(마이너 후속) 또는 `84SQM_RANKING`/
`PRICE_MAP_V2`(placeholder audit이 이미 IA 배치를 문서화한 신규 기능) —
ChatGPT PM 판단 대기.
