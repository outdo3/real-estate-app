# STATISTICS PLACEHOLDER AUDIT V1

baseline: `7690f93` (main)
날짜: 2026-08-28

이 문서는 기획+데이터+코드 감사 결과다. **구현 STEP이 아니다** — 실제 코드
변경은 statsMenu.ts의 사소한 라벨/코멘트 정정 2건뿐이다(§34 허용 범위).

## 1. Goal

"준비중"으로 남아 있는 통계 메뉴(공급/인구/외지인비율/경사·고도/대단지/
인기단지) 전수를 실제 repo/DB 기준으로 감사하고, 실제 데이터 존재 여부에
근거해 구현 우선순위를 재정렬한다. 성급한 구현 없이, 다음 STEP이 무엇을
해야 하는지 정확히 정의하는 것이 목표다.

## 2. Current Statistics IA

`STATS_MENU`(`src/app/stats/statsMenu.ts`) 기준 총 **17개** 메뉴, 5개
카테고리(코멘트가 "16개"로 남아있던 것은 stale — §Cleanup에서 정정).

| 카테고리 | 메뉴 |
|---|---|
| 가격 | 하락, 2년최고가, 상승, 전세위험 |
| 거래 | 실거래, 거래량, 거래집중, 갭투자 |
| 수요·공급 | 공급물량(soon), 인구변화(soon), 외지인비율(soon) |
| 지역 | 분위지도, 경사/고도(soon), 대단지(soon) |
| 비교·분석 | 가격비교, 여러단지비교, 인기단지(soon) |

## 3. Placeholder Inventory (Live vs Placeholder Classification)

| SLUG | 메뉴명 | subtitle | CATEGORY | STATUS | ROUTE | API | 현재 데이터 | Placeholder? |
|---|---|---|---|---|---|---|---|---|
| feed | 실거래 | 지역별 실거래 피드 | 거래 | live(A) | /stats/feed | /api/stats/feed | MOLIT 실시간 | 아니오 |
| decline | 하락 | 하락거래 단지 모음 | 가격 | live(A) | /stats/decline | /api/stats/price-rankings | MOLIT 실시간 | 아니오 |
| record-high | 2년최고가 | 최근 2년 내 최고가 경신 단지 | 가격 | live(A) | /stats/record-high | /api/stats/price-rankings | MOLIT 실시간 | 아니오 |
| rising | 상승 | 가격변동 상위 단지 | 가격 | live(A) | /stats/rising | /api/stats/price-rankings | MOLIT 실시간 | 아니오 |
| jeonse-risk | 전세위험 | 최근 전세가격이 이전보다 낮아진 단지 | 가격 | live(A) | /stats/jeonse-risk | /api/stats/price-rankings | MOLIT 실시간 | 아니오 |
| volume | 거래량 | 매매·전월세 거래량 | 거래 | live(A) | /stats/volume | /api/stats/dashboard | MOLIT 실시간 | 아니오 |
| top-traded | 거래집중 | 최근 거래가 몰린 단지 | 거래 | live(A) | /stats/top-traded | /api/stats/concentration | MOLIT 실시간 | 아니오 |
| gap-invest | 갭투자 | 갭투자 형태 거래 지역/단지 | 거래 | live(A) | /stats/gap-invest | /api/stats/gap-invest | MOLIT 실시간 | 아니오 |
| price-map | 분위지도 | 평당가 구간 색상 지도 | 지역 | live(A) | /stats/price-map | /api/transactions | MOLIT 실시간 | 아니오 |
| compare | 가격비교 | 2개 단지 시세 겹쳐보기 | 비교·분석 | live(A) | /stats/compare | /api/apt/[name] | MOLIT 실시간 | 아니오 |
| multi-compare | 여러단지비교 | 다중 단지 시세 비교 | 비교·분석 | live(A) | /stats/multi-compare | /api/apt/[name] | MOLIT 실시간 | 아니오 |
| supply | 공급물량 | 입주 예정 물량 | 수요·공급 | soon(C) | /stats/supply | 없음(ComingSoonCard) | **Presale 테이블에 실제 존재**(§4) | **예, 그러나 데이터는 이미 있음** |
| population | 인구변화 | 전입·전출 및 세대수 추이 | 수요·공급 | soon(C) | /stats/population | 없음 | 전혀 없음(§9) | 예, 완전 |
| foreign-buyer | 외지인비율 | 관외 매수자 거래 비율 | 수요·공급 | soon(C) | /stats/foreign-buyer | 없음 | 전혀 없음(§18) | 예, 완전 |
| elevation | 경사/고도 | 단지별 지형 정보 | 지역 | soon(C) | /stats/elevation | 없음 | 전혀 없음(§20) | 예, 완전 |
| large-complex | 대단지 | 1,000세대 이상 단지 | 지역 | soon(C) | /stats/large-complex | 없음(ComingSoonCard) | **ApartmentMaster에 실제 존재**(부산만, §14) | **예, 그러나 데이터는 이미 있음(부산)** |
| popular | 인기단지 | 이집 유저 인기 조회 단지 | 비교·분석 | soon(C) | /stats/popular | 없음 | **PageView 테이블이 실제로 쌓이는 중**(§21) | **예, 그러나 로깅 인프라는 이미 live** |

**DEAD/UNUSED**: 없음. **DUPLICATE/SHOULD_MERGE**: 없음(§3). 기존
live 기능을 placeholder로 오분류하지 않았다 — 11개 live 항목 전부
STATISTICS V2/V2.1/V2.1-2/V2.1-3 STEP에서 실측 검증된 것과 동일함을
재확인.

## 4. Supply Audit — Current Code

`/api/presales`, `/api/presales/[id]`, `/api/presales/[id]/nearby-market`,
`/api/presales/[id]/nearby-apartments`, `/api/admin/presales/sync`가 이미
존재한다. `syncApplyhomeListings`(`src/services/cheongyakService.ts`)가
청약홈(Applyhome, 공식 정부 API) 공고 데이터를 `Presale`/
`PresaleHouseTypeDetail` 테이블에 저장한다. 자동 cron/스케줄러는
**없음**(관리자 수동 트리거만, `mode: 'initial'|'incremental'`,
`MAX_SYNC_LIMIT=200`/호출).

## 5. Supply — Data Source Audit (실측)

DB 직접 쿼리(read-only)로 확인:

| 필드 | 커버리지 | 비고 |
|---|---|---|
| 총 row 수 | 1,046건 (전체 약 2,800여 건 중 일부만 수집됨, route.ts 코멘트) | 국내 전체 |
| moveInExpectedYm(입주예정월) | **1,046/1,046 (100%)** | "YYYYMM" 원본 문자열, 임의 날짜 변환 없음 |
| totalSupplyHouseholds(총세대수) | **1,046/1,046 (100%)** | |
| latitude/longitude | 728/1,046 (70%) | 나머지 30%는 지도 pin 불가 |
| houseType | **100% 'APT'** | 오피스텔/생숙 혼입 없음(V1 아파트 범위와 일치) |
| 부산(subscriptionAreaName='부산') | 85건, 좌표 66/85(78%) | |
| updatedAt 분포 | 전부 2026-08-12 단일 시점 | **1회성 backfill로 보임, 이후 재동기화 안 됨(17일 경과)** |

## 6. Supply — Implementability

| 항목 | 판정 |
|---|---|
| A. 입주지도 | READY_WITH_SMALL_FIX(좌표 70%만 있어 나머지는 지도에서 제외 표시 필요) |
| B. 공급추이(bar chart) | READY_WITH_SMALL_FIX(moveInExpectedYm 100% 커버, 신규 집계 route만 필요) |
| C. 지역별 공급량 | READY_WITH_SMALL_FIX(subscriptionAreaName=시/도 단위만 있음 — 시군구 세분화는 `locationAddress` 문자열 파싱 필요, §Data Trust 참고) |
| D. 향후 1년 | READY_WITH_SMALL_FIX(moveInExpectedYm 기준 필터만 하면 됨) |
| E. 향후 3년 | READY_WITH_SMALL_FIX(동일) |
| F. 비교지역 공급량 | READY_WITH_SMALL_FIX(시/도 단위까지만 정확, 시군구 비교는 파싱 정확도에 좌우) |

## 7. Supply — Data Trust

**개념 구분 중요**: `moveInExpectedYm`은 **분양 공고 시점에 사업 주체가
발표한 "입주예정월"**(청약홈 원본 필드 `MVN_PREARNGE_YM`)이다. 이것은:
- **분양예정이 아니다** — 이미 청약이 진행/완료된 공고의 데이터.
- **준공 확정이 아니다** — 공사 지연 등으로 실제 입주월이 달라질 수 있고,
  이 DB는 공고 시점 값만 저장하며 개정치를 추적하지 않는다(재동기화 시
  갱신될 수 있으나 이력은 남지 않음).
- "예정"이라는 사실을 화면 문구에서 반드시 명시해야 한다("확정 입주월"
  같은 표현 금지).

## 8. Supply — Product Recommendation

권장 구조(제시된 예시 채택):

```
공급
├ 입주지도  (좌표 있는 건만 pin, 없는 건 리스트로 별도 노출)
└ 공급추이  (moveInExpectedYm 기준 bar chart, 시/도 단위 지역선택)
```

메뉴명 "공급물량" → "공급"으로 단순화 검토 가능(사소한 라벨, 이번 STEP
미적용 — 구현 STEP에서 결정).

## 9. Population — Current Code Audit

`population`/`resident`/`migration`/`census`/`KOSIS`/`통계청`/`행안부`
전수 grep 결과 **`statsMenu.ts`의 placeholder 정의 외에는 관련 코드가
전혀 없다**(redevelopment 코드의 "migration" 매치는 "DB migration"이라는
무관한 코멘트로 확인된 false positive). 연동 API/서비스/스키마 전무.

## 10-11. Population — Required Data / Implementability

전부 **BLOCKED**(외부 공식 데이터 미연동): A~H(시도/시군구/읍면동 인구
변화, 월간/연간, 전입/전출, 순유입, 출발지/도착지 ranking) 전부 현재
데이터 0건. 추정 금지 원칙상 임의 구현 불가.

## 12. Population — Source Candidate (연동 안 함, 종류만 문서화)

- 인구변화: 행정안전부 주민등록 인구통계(읍면동 단위 월간 공식 제공) 또는 KOSIS
- 전입·전출: 통계청 국내인구이동통계(시군구 단위 월간)

이번 STEP에서 API 신청/키 설정/연동 **하지 않음**(TRUE GATE #4 — 새 외부
API credential 필요).

## 13. Population — Product Recommendation

권장 구조:
```
인구
├ 인구변화   "이 지역의 인구가 늘고 있나?"
└ 전입·전출   "사람들이 어디서 들어오고 어디로 나가고 있나?"
```
단, 실제 구현은 TRUE GATE(외부 API) 승인 이후에만 가능.

## 14. Large Complex — Current Data Audit (실측)

`ApartmentMaster` 테이블 직접 쿼리:

| 필드 | 커버리지 |
|---|---|
| 총 row 수 | 3,402건 — **전량 부산**(sido='부산' 100%, 서울/전국 0건) |
| totalHouseholds | 3,181/3,402 (93.5%) |
| buildYear | 3,402/3,402 (100%) |
| latitude/longitude | 3,401/3,402 (99.97%) |
| parkingPerHousehold | 2,357/3,402 (69%) — 이미 계산되어 저장됨(추정 아님, `parkingCount/totalHouseholds`) |
| 1,000세대 이상 | 164건(부산 15개 구 전역에 분포) |

**평형 수(unit types)는 별개 문제**: `ApartmentUnitType`은 `Apartment`
테이블(구식, 건축물대장 캐시용, `ApartmentMaster`와 다른 테이블)에만
연결된다. `Apartment` 테이블은 전체 **63건**뿐이고, `unitTypes`가 채워진
행은 **11건**뿐이다(aptSeq로 `ApartmentMaster`와 조인 가능한 행도
20/63). **즉 "평형 수" 컬럼은 3,402개 대단지 후보 중 사실상 0.3%에서만
채울 수 있다** — §32 "no fake readiness" 원칙상 대단지 V1 표에 "평형 수"
컬럼을 넣으면 안 된다(대부분 빈 값이 되어 오해를 줌).

## 15. Large Complex — Implementability

| 항목 | 판정 |
|---|---|
| A. 부산 전체 대단지 순위 | **READY_NOW** |
| B. 서울 전체 대단지 순위 | BLOCKED(데이터 0건 — 스키마/API 문제 아니라 backfill 미실행) |
| C. 전국 전체 | BLOCKED(동일 이유) |
| D. 구별 | READY_NOW(부산 15개 구 전부 데이터 있음) |
| E. 동별 | READY_NOW(umdName 필드 존재, 부산 한정) |
| F. 세대수 필터 | READY_NOW |
| G. 입주연도 | READY_NOW(buildYear 100%) |
| H. 최근가격 | READY_WITH_SMALL_FIX(aptSeq 매칭으로 MOLIT 최근 거래 batch fetch 필요 — 기존 패턴 재사용 가능, 신규 API 아님) |
| I. 평형 수 | **BLOCKED**(§14 — 0.3% 커버리지, V1 제외 권장) |
| J. 주차 | READY_NOW(parkingPerHousehold 이미 계산됨) |

## 16. Large Complex — Ranking Definition

`총세대수 DESC`로 충분하다 — 별도 가중치/보정 불필요(단순 사실 랭킹).
현재 `ApartmentMaster`는 **아파트 전용**으로 설계됐다(houseType/
propertyType 구분 필드 자체가 없음 — 분양권/오피스텔/생활형숙박시설 모델
없음, grep으로 확인). V1은 아파트만 다룬다고 명시하면 정확하다.

## 17. Large Complex — Product Recommendation

메뉴명 "대단지" 유지 가능. 화면 질문: "세대수가 많은 단지는?" 이집
추가 context(§14/§15 근거로 확정):
- 총세대수, 입주연도, 주차(세대당) — 전부 READY_NOW
- 최근 거래(84㎡ 등) — READY_WITH_SMALL_FIX
- 평형 수 — **V1에서 제외**(데이터 없음)
- 범위: **부산만 V1**, "서울/전국은 준비 중" 정직하게 표시

## 18. Foreign Buyer — Audit (실제 의미 확인)

slug는 영문 `foreign-buyer`이지만, 실제 title/subtitle/comment 전부
**"외지인"**(관외 거주자, out-of-region)을 가리킨다 — "외국인"(국적)이
아니다. `subtitle: '관외 매수자 거래 비율'`, `soonReason: '실거래가
공공데이터에는 매수자 거주지 정보가 포함돼 있지 않습니다.'`가 이를
명확히 뒷받침한다. slug 자체가 개념을 오도할 수 있어 향후 구현 시
`outside-buyer` 같은 slug로 바꾸는 것을 검토할 가치가 있다(이번 STEP은
변경하지 않음 — 라벨 변경도 아니고 URL 하위호환 이슈라 별도 판단 필요).

## 19. Foreign/Outside Buyer Data

MOLIT 실거래(`api-molit.ts` raw item) 전수 확인 — 매수자 거주지/국적
필드 **전혀 없음**(공공데이터포털 정책상 실거래 API에 매수자 개인정보
비공개, 잘 알려진 사실과 일치). 코드 전체 grep(`매수자`,
`buyerAddr`, `거래자`, `매수인`)도 placeholder 정의 외 매치 없음.
개별 거래 단위로는 **원천적으로 구현 불가능**. 한국부동산원 등이 발표하는
"관외인 매입 비중" 통계는 지역·월 단위 **집계치**로만 존재해(개별 거래
매칭 불가), 완전히 다른 데이터 모델과 별도 공식 API 연동이 필요하다.

## 20. Elevation — Audit (실제 의미 확인)

title: `경사/고도`, subtitle: `단지별 지형 정보`, Icon: `Mountain`,
soonReason: `지형 고도·경사도 데이터셋이 아직 연동되지 않았습니다.`.
**추측이 아니라 코드 그대로**: 가격 상승(그런 기능은 이미 "상승" slug로
존재)도, 층수도 아니고 **문자 그대로 지형의 해발고도/경사도**(DEM/GIS
데이터)를 뜻한다. Repo 전체에 DEM/GIS/고도 관련 데이터·API·서비스가
전혀 없다. 필요성 평가: 부동산 의사결정에서 "조망/경사"는 부차적 정보이며
(가격/공급/대단지 대비) 임팩트가 작고, 별도의 지형 데이터 API 신규
연동이 필요해 투자 대비 가치가 낮다.

## 21. Popular — Audit (핵심 발견)

**중요**: 현재 `soonReason`("단지별 조회수를 아직 집계하고 있지
않습니다")은 **더 이상 정확하지 않다.** 실측 확인 결과:

- `PageView` 모델이 실제로 존재하고, `@@map("page_views")` 주석에
  "인기 단지 랭킹(누적)과 오늘 PV 집계에 쓰인다"고 명시돼 있다.
- `/api/log/view`가 페이지 이동마다 `prisma.pageView.create()`로
  실제 기록 중이다(로그인 여부 무관, 익명 세션 ID 기반).
- DB 직접 쿼리: **총 1,937건**, 단지 연결(`complexId`) **469건**,
  기록 기간 2026-08-11~2026-08-28(17일), 이미 top10 랭킹이 형성됨
  (예: "대신롯데캐슬" 161회).

**그러나 이 신호는 아직 신뢰할 수 없다**:
1. 표본이 작고(17일, 469건) 특정 단지(내가 이번 세션들에서 반복
   QA/스모크 테스트한 "대신롯데캐슬" 등)에 **테스트 트래픽이 집중**돼
   있어 실제 사용자 인기와 혼동될 위험이 크다.
2. `PageView`에 bot/QA/관리자 트래픽을 구분하는 필드가 없다
   (`isBot`/`source` 같은 필드 부재).
3. §21 지시대로 "거래건수를 popularity로 다시 쓰지 말 것"은 이미
   지켜지고 있다(거래집중은 별도 live 기능) — 이 신호 자체는 진짜
   조회 기반이라는 점에서 원칙적으로는 맞는 방향.

결론: **로깅 인프라는 이미 준비돼 있음(ANALYTICS_READY)**. 하지만
**신뢰 가능한 순위를 만들 만큼 데이터가 성숙하지 않았고, bot/QA 필터링도
없다.** 랭킹 화면 구현 자체는 READY_WITH_SMALL_FIX 수준(쿼리+집계+UI만
필요)이지만, 신뢰할 수 있는 결과를 내려면 (a) 최소 수집 기간 확보,
(b) bot/QA 트래픽 필터 로직 추가가 선행돼야 한다. `soonReason` 텍스트는
이번 STEP에서 사실에 맞게 정정한다(§Cleanup).

## 22. Other Placeholders

이번 inventory에서 `STATS_MENU`/quick menu/type-client 라우팅 전수
검색 결과 **추가로 발견된 placeholder는 없음**. `price-map`(분위지도)은
이미 live이나, 사용자가 언급한 **PRICE MAP V2(지역 변동지도, 시도→
시군구→읍면동, 기간별 상승률/하락률)는 코드상 전혀 구현되지 않은 순수
future 개념**임을 확인(§19 문서/코드 어디에도 구현 없음, grep 0건).

## 23. Product Value Matrix

각 5점 만점(1~5), 5개 기준: 가치/신뢰/난이도역점수/차별화/콘텐츠.

| 기능 | 가치 | 신뢰 | 난이도(역) | 차별화 | 콘텐츠 | 합계 |
|---|---|---|---|---|---|---|
| **공급** | 5 | 4 | 3 | 4 | 5 | **21/25** |
| **대단지**(부산) | 4 | 5 | 4 | 3 | 4 | **20/25** |
| 인구 | 4 | 1 | 1 | 3 | 3 | 12/25 |
| 인기단지(popular) | 3 | 2 | 3 | 2 | 2 | 12/25 |
| 외지인비율 | 3 | 1 | 1 | 3 | 3 | 11/25 |
| 경사/고도 | 2 | 1 | 1 | 2 | 2 | 8/25 |

근거: 공급은 청약홈 공식 데이터 100% 커버리지(입주예정월/세대수)와
콘텐츠 가치가 최고점을 이끔(단, 신선도 문제로 신뢰 4점). 대단지는 신뢰
5점(건축물대장 확정값)이 강점이나 부산 한정이라 차별화가 낮음. 인구/
외지인비율은 데이터가 전무해 신뢰·난이도 점수가 바닥. 경사/고도는 가치
자체가 낮고 데이터도 없어 최하위.

## 24. Implementation Class

| 기능 | CLASS |
|---|---|
| 공급(입주지도/공급추이) | **B** — 기존 data source(Presale) 있음, helper/API/지도 UI 신규 필요 |
| 대단지(부산) | **B** — 기존 data source(ApartmentMaster) 있음, ranking API/UI 신규 필요(평형수 제외) |
| 대단지(서울/전국) | **C**(정확히는 "기존 파이프라인 재실행" — 새 API/스키마 아님, 대규모 backfill 실행 필요, §14 참고) |
| 인기단지(popular) | **B/D 경계** — 인프라(B)는 있으나 신뢰 가능한 데이터 축적은 D(시간+필터링 필요) |
| 인구 | **C** — 공식 데이터 source 연결 필요(TRUE GATE) |
| 외지인비율 | **C** — 공식 집계 통계 소스 연결 필요, 그마저도 거래 단위 매칭 불가(TRUE GATE) |
| 경사/고도 | **E** — 가치 대비 비용 과다, 제거/보류 검토 권장 |

## 25. Recommended Priority (실제 audit 기준 재정렬)

가설(대단지>공급>인구>외지인매수>true인기)과 달리, 실측 결과 **공급이
근소하게 대단지보다 앞선다**:

1. **공급**(21/25) — 청약홈 공식 데이터 100% 커버리지, 콘텐츠 가치 최고
2. **대단지**(20/25, 부산 한정) — 데이터 신뢰 최고점, 구현 난이도 낮음
3. **인구**(12/25) / **인기단지**(12/25) — 동점, 성격이 다름(인구=외부
   데이터 전무, 인기단지=인프라 있으나 미성숙)
4. **외지인비율**(11/25)
5. **경사/고도**(8/25) — 제거/보류 검토

## 26. Recommended Bundles

**BUNDLE A(최우선, 다음 구현 STEP 후보): 대단지 + 공급**
- 공통점: 둘 다 이미 DB에 실제 데이터가 있고(청약홈/건축물대장), 신규
  ranking·집계 API + 지도/리스트 UI라는 동일한 작업 패턴을 공유한다.
- 대단지가 신뢰도(5점)로, 공급이 가치·콘텐츠(5점)로 서로 보완.
- 둘 다 TRUE GATE 해당 없음(기존 데이터, 새 API/스키마 불필요) — 바로
  구현 STEP 착수 가능.

**BUNDLE B(보류, 리서치만): 인구변화 + 전입·전출**
- 공통점: 둘 다 동일한 외부 공식 데이터(행안부/통계청) 계열이 필요.
- TRUE GATE(#4 새 외부 API credential) 해당 — 이번 STEP에서 연동하지
  않았고, 다음 단계는 "구현"이 아니라 "공식 데이터 소스 후보 확정 +
  승인 요청"이다.

**인기단지(popular)**는 별도 소규모 STEP으로 분리 권장: (1) bot/QA
트래픽 필터 로직 추가, (2) 최소 수집 기간(예: 30일) 확보 후 재평가 —
Bundle A/B 어디에도 속하지 않는 독립 항목.

**제거/보류 검토**: 경사/고도(elevation) — 가치·데이터 둘 다 최하위,
다른 5개 placeholder 대비 우선순위가 크게 낮다. 완전 제거보다는 "당분간
보류, 로드맵에서 후순위" 권장(제거는 제품 방향 결정이라 TRUE GATE #6
irreversible product direction에 해당할 수 있어 이번 STEP에서 임의로
삭제하지 않음).

## 27. 84㎡ Ranking Placement

`price-ranking.ts`/`statsMenu.ts` 코멘트에 이미 "최고가"라는 메뉴명이
84㎡ 절대가격 순위를 위해 예약돼 있음을 확인(§FIX_PRICE_RANKINGS_V2_1_1A
근거). 현재 코드 구현은 없음(순수 future). 제안 구조:

```
가격
├ 하락
├ 2년최고가
├ 상승
├ 전세위험
└ 84㎡ 순위   (신규, 이번 STEP 구현 안 함)
```

기존 가격 카테고리에 자연스럽게 들어맞는다 — decline/rising/record-high
와 동일한 `buildHistory`/`groupKey` 인프라(raw exact area 기준)를
그대로 재사용할 수 있어(다만 84㎡ 근접값이 아니라 "정확히 84㎡대"
필터가 필요, area band 로직은 이미 `areaBandLabel`로 존재) 구조 적합성이
높다.

## 28. PRICE MAP V2 Placement

"지역 변동지도"(대한민국→시도→시군구→읍면동, 기간별 상승률/하락률 색상
지도)는 현재 `지역` 카테고리의 "분위지도"(가격 수준 지도, 절대값)와
성격이 다르다(분위지도=level, PRICE MAP V2=change/변동). 배치 제안:

```
지역
├ 분위지도       (기존 live, 절대 가격 수준)
└ 변동지도(V2)   (신규, 기간별 변동률 — 이번 STEP 구현 안 함)
```

`시장` 카테고리는 현재 존재하지 않으므로 신설하지 않고 기존 `지역`에
포함하는 것을 권장(카테고리 신설은 IA 변경이라 범위 확대).
STATISTICS_PERFORMANCE_V1.md에서 이미 gap-invest/jeonse-risk의
regionRanking/apartmentRanking 집계 contract가 이 기능에 재사용
가능하도록 설계됐음을 확인했다(지도 좌표에 의존하지 않는 순수 집계
데이터).

## 29. Broker Briefing Connection

중개사 브리핑 가치가 높은 순(§29 평가):

1. **공급**(입주 예정 물량 — 브리핑 단골 소재, 가장 높음)
2. **대단지**(지역 대표 단지 리스트 — 브리핑 도입부에 유용)
3. 거래량/2년최고가/하락(이미 live, 브리핑에 이미 활용 가능)
4. 84㎡ 순위(향후) — 실수요 대표 평형 기준이라 브리핑 친화적
5. PRICE MAP(향후) — 지역 비교 브리핑에 강력하나 구현 전
6. 인구 — 있으면 좋으나 데이터 자체가 없어 현재는 후순위

## 30. Content Creator Value

부동산 유튜브/콘텐츠 제작자가 인용하기 좋은 순:

1. PRICE MAP V2(향후) — "이 동네가 얼마나 올랐나" 시각 자료, 방송
   임팩트 최고
2. 84㎡ 순위(향후) — "국민평형" 프레이밍, 클릭 유도력 높음
3. 공급(입주지도) — "곧 이만큼 들어온다" 시각 자료
4. 대단지 — "이 동네 대장 단지"류 콘텐츠
5. 거래량/2년최고가(이미 live)

단, 이 우선순위를 §26 구현 우선순위 결정에 단독 근거로 쓰지 않았다 —
§23/§25의 5개 기준 종합 점수를 따랐다.

## 31. Data Source Status Table

| FEATURE | CURRENT SOURCE | COVERAGE | FRESHNESS | MISSING DATA | NEW API | DB | LEGAL/POLICY | STATUS |
|---|---|---|---|---|---|---|---|---|
| 공급 | 청약홈(Applyhome) 공식 API, `Presale` 테이블 | 국내 1,046건(전체 ~2,800건 중 일부), 부산 85건 | **낮음**(2026-08-12 1회성 backfill, 17일 경과, cron 없음) | 좌표 30%, 시군구 세분화(문자열 파싱 필요) | 불필요 | 불필요(기존 테이블) | 공공데이터, 정책 이슈 없음 | READY_WITH_SMALL_FIX |
| 대단지(부산) | 건축물대장 공식 API, `ApartmentMaster` | 부산 3,402건, 세대수 93.5% | 이전 STEP 백필(정확한 날짜 미확인, 안정적) | 평형수(0.3%), 서울/전국(0%) | 불필요 | 불필요(기존 테이블) | 없음 | READY_NOW(부산) |
| 인구 | 없음 | 0 | N/A | 전체 | **필요**(KOSIS/행안부/통계청) | 필요(신규 모델) | 확인 필요(공공데이터 이용약관) | NEEDS_EXTERNAL_DATA |
| 외지인비율 | 없음 | 0 | N/A | 전체(거래 단위 자체가 불가능) | **필요**(한국부동산원 등 집계 통계) | 필요 | 확인 필요 | NEEDS_EXTERNAL_DATA |
| 경사/고도 | 없음 | 0 | N/A | 전체 | **필요**(DEM/GIS) | 필요 | 확인 필요 | NEEDS_EXTERNAL_DATA(저가치) |
| 인기단지 | `PageView`(자체 로깅) | 1,937건/17일, 단지연결 469건 | 실시간(계속 쌓이는 중) | bot/QA 필터, 표본 부족 | 불필요 | 불필요(기존 테이블) | 없음(익명 세션) | ANALYTICS_READY_BUT_IMMATURE |

## 32. No Fake Readiness 원칙 준수 확인

이번 감사에서 "UI만 만들 수 있다"는 이유로 READY 처리한 항목 없음.
대단지의 "평형 수"는 명시적으로 BLOCKED/제외 처리했고(§14), 공급의
좌표 30% 결측/시군구 파싱 필요성도 숨기지 않았다(§6/§7). 인기단지는
인프라가 있음에도 "데이터 미성숙"이라는 이유로 READY_NOW로 격상하지
않았다(§21).

## Risks

- 공급: 1회성 backfill이라 재동기화 없이 구현하면 "몇 달 전 기준"
  데이터가 최신처럼 보일 위험 — 화면에 데이터 기준일 명시 필수.
- 대단지: 부산만 있는데 "대단지"라는 메뉴명이 전국을 암시할 수 있어
  V1은 지역 선택 시 부산 외 지역에서 정직하게 "준비 중" 처리 필요.
- 인기단지: bot/QA 필터링 없이 성급히 공개하면 "인기"가 실제로는
  테스트 트래픽 반영일 위험 — §21 그대로.

## Next Recommended Step

**STATISTICS_SUPPLY_LARGE_COMPLEX_V1**(Bundle A: 대단지 + 공급) —
TRUE GATE 없음, 기존 데이터 재사용, 다음 구현 STEP으로 바로 착수 가능.
