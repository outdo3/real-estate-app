# E-JIP SCORE V2 STEP 1 — Score Architecture & Factor Model

## 목적

STEP 0~0.8이 확정한 것: V1의 계산 구현은 대체로 정확하고, subway distance 같은
원천 데이터는 신뢰 가능하며, STEP 0.7-A로 peer contamination이 크게 줄었다
(PEER_FULL 38.2%→72.5%). 하지만 **LOCAL(법정동) percentile끼리의 cross-peer
비교는 타당하지 않다**(CROSS_PEER_COMPARABLE=NO, transport inversion
14.66~17.42%, relative percentile 권장 역할=SMALL COMPONENT, Score V1
trust=C.HIDE/DEEMPHASIZE, `SCORE_V2_STEP1_READY=YES`).

이번 STEP부터는 V1을 고치지 않고 **"좋은 아파트란 무엇인가"부터 다시 정의**한다.
숫자 가중치는 아직 정하지 않는다 — 이번 STEP은 (1) 이집점수의 의미, (2) Core
domain과 factor, (3) 절대/상대평가 분리, (4) Core에서 제외할 요소와 별도 Index
구조, (5) 데이터 가용성, (6) explainability 구조, (7) STEP 2에 필요한 수치설계
목록을 결정한다.

**production Score/DB/API/UI/schema — 전부 미변경. analysis/docs only.**

## 현재 상태

- base: `score-v2-step08-shadow-peer-validation`(commit `f4f456c`)
- 신규 branch: `score-v2-step1-architecture`(worktree `.worktrees/score-v2-step1-architecture`)
- main 브랜치: 미변경
- 방법론: 3개 read-only 조사 agent(complex/market/investment schema, transport/bus/community-facility, School V2 상태)를 병렬 실행해 실제 Prisma schema·코드·문서·라이브 DB count를 근거로 factor inventory를 작성했다. **추정 없이 evidence(file:line, DB count, doc quote) 기준으로만 분류**했다.

## 분석

### 1. 이집점수 의미 후보(§3)

| 후보 | 사용자 이해도 | 데이터 가능성 | 투자요소 혼입 위험 | 가격 영향 | 지역간 비교가능성 | 설명가능성 | 장기 확장성 |
|---|---|---|---|---|---|---|---|
| A. 아파트 종합 가치 | 낮음(모호) | 낮음(가격 포함 시 순환오류) | 매우 높음 | 필연적으로 큼 | 나쁨(가격 지역차) | 나쁨 | 나쁨(이름이 계속 오해 유발) |
| B. 가격을 제외한 주거 품질 | **높음** | **높음**(현재 Core 후보 전부 비가격 데이터) | **거의 없음**(정의상 배제) | **0** | 좋음(절대 raw fact 중심 가능) | **높음**("가격과 무관하게 살기 좋은 정도") | **좋음**(Market/Investment를 별도 index로 자연스럽게 분리) |
| C. 실거주 경쟁력 | 중간("경쟁력"이 시장성을 암시할 위험) | 높음 | 중간(단어 자체가 시장 프레이밍 유발) | 간접적 위험 | 보통 | 중간 | 보통 |
| D. 입지 + 단지 상품성 | 중간(두 축만 강조, 교육/환경 소외 인상) | 높음 | 낮음 | 없음 | 좋음 | 보통(도메인 나열이지 "의미"가 아님) | 보통 |
| E. 주거상품의 객관적 경쟁력 | 중간("경쟁력" 문제 C와 동일) | 높음 | 중간 | 간접적 위험 | 보통 | 중간 | 보통 |

**추천: B. 가격을 제외한 주거 품질.**

한 문장 정의: **"이집점수는 가격과 무관하게, 이 아파트가 실제로 살기에 얼마나
좋은지를 객관적 데이터로 평가한 점수입니다."** 이 정의는 이미 V1
`config.ts`(§9 comment, `market:0` 가중치)가 채택했던 "가격=좋음 편향 차단"
원칙과 정확히 일치하며, §21(가격 제외)·§22(Market Index 분리)·§23(Investment
Index 분리)을 이름 자체가 미리 정당화한다는 점에서 장기적으로 가장 안전하다.

### 2. "좋은 집" vs "좋은 투자" 분리(§4)

**원칙: 분리한다.** Core E-jip Score에서 제외하고 별도 후보로 이동:

| 요소 | 이동처 |
|---|---|
| 현재 가격, 가격상승률, 전고점 대비, 거래량, 전세가율 | MARKET_STRENGTH(별도 index, §22) |
| 공급, 미분양 | INVESTMENT_ATTRACTIVENESS(별도, §23) |
| 재건축, 개발호재 | RECONSTRUCTION/FUTURE(별도, §31) |
| 향후 교통(예정 노선/역) | 근거 불충분·투기적 요소라 FUTURE index로(§11) — 확정되지 않은 계획을 Core에 넣으면 "호재 기대감=좋은 집"이라는 또 다른 순환오류가 생긴다 |
| 투자수익률 | INVESTMENT_ATTRACTIVENESS |

### 3. Factor Master Inventory + Data Classification + Core Eligibility(§5-7)

**분류 기준**(추정 금지, 전부 evidence 확인):
`READY_NOW`/`SAFE_DERIVABLE`/`SOURCE_EXISTS_NOT_INGESTED`/`LEGAL_REVIEW`/`NEEDS_NEW_SOURCE`/`NOT_RELIABLE`/`NOT_AVAILABLE`
그리고 `CORE_V2`/`SEPARATE_INDEX`/`PERSONALIZED`/`DISPLAY_ONLY`/`FUTURE`/`EXCLUDE`.

#### A. 교통

| factor | 실제 근거 | 데이터 분류 | Core eligibility |
|---|---|---|---|
| subway distance | `ApartmentLocationFeature.nearestSubwayDistanceM`, 2,833/3,402 coordOk, Kakao SW8 "역 대표점"(station-center) 기준 — STEP0.5 감사로 재현오차 0~1m 확인 | READY_NOW | CORE_V2 |
| subway station count(1000m) | `subwayCount1000m` | READY_NOW | CORE_V2 |
| 환승역 여부 | 없음 — station 구조화 테이블 자체가 schema에 없음(30개 model 전수 확인, 없음) | NOT_AVAILABLE | EXCLUDE |
| 노선 가치 | 없음, `nearestSubwayName`은 "서대신역 부산1호선" 같은 단일 free-text, 노선별 구조화 없음 | NOT_AVAILABLE | EXCLUDE |
| bus stops(거리/개수) | `nearestBusStopDistanceM`/`busStopCount300m`(persist) | READY_NOW | CORE_V2 |
| bus route availability(노선번호) | TAGO 실시간 조회(`/api/transit/bus-stops`)만 존재, DB 미저장, 서버 메모리 6h 캐시뿐 | SOURCE_EXISTS_NOT_INGESTED | DISPLAY_ONLY(현재 상세페이지에 이미 노출 중, scoring엔 아직 미편입) |
| major road accessibility | 전무(간선도로/고속도로 키워드 0건) | NOT_AVAILABLE | EXCLUDE/FUTURE |
| 주요 업무지구 접근 | 업무지구 좌표/정의 자체가 없음(STEP0 §20 감사 재확인) | NOT_AVAILABLE | FUTURE |
| KTX/rail | Kakao 키워드 검색(라이브, 미저장) + 화물역 오염 확인(가야화물역 등 category_name 여객역과 동일) | NOT_RELIABLE | DISPLAY_ONLY |
| airport(김해공항) | 전무 | NOT_AVAILABLE | EXCLUDE |
| future transport(예정 노선) | 전무, 확정 계획 데이터 소스 없음 | NEEDS_NEW_SOURCE | FUTURE(§21 순환오류 방지 목적상 의도적 배제) |
| personalized commute | 코드 전무(통근/목적지 설정 기능 미구현 — memory 기록은 로드맵 아이디어였을 뿐) | NOT_AVAILABLE | PERSONALIZED(향후 기능, 이번 STEP엔 없음) |

#### B. 입지/생활

| factor | 실제 근거 | 데이터 분류 | Core eligibility |
|---|---|---|---|
| hospital(1000m)/pharmacy(500m) | `hospitalCount1000m`/`pharmacyCount500m` | READY_NOW | CORE_V2 |
| clinic vs general hospital 구분 | Kakao 카테고리가 세분화 안 됨 | NOT_RELIABLE(세분화만) | EXCLUDE(세분화), hospital 합산은 CORE_V2 |
| supermarket/mart | `martCount1000m` | READY_NOW | CORE_V2 |
| 대형마트/백화점/쇼핑몰 구분 | mart count가 규모 구분 안 함 | NOT_RELIABLE(구분만) | EXCLUDE(구분), mart 합산은 CORE_V2 |
| 전통시장 | 현재 미수집이나 Kakao 카테고리로 손쉽게 추가 가능(SAFE_DERIVABLE급 난이도) | SOURCE_EXISTS_NOT_INGESTED | FUTURE |
| convenience store | `convenienceCount500m` | READY_NOW | CORE_V2 |
| public office/bank/library/sports/culture | 미수집(Kakao 카테고리 자체는 존재 — 학원가 AC5 사례처럼 검증된 패턴 재사용 가능) | SOURCE_EXISTS_NOT_INGESTED | FUTURE |
| restaurant/cafe | 미수집 | NOT_AVAILABLE | EXCLUDE(변별력 낮음 — 어디나 많아 "상업밀도=원도심 편향"만 만들 위험) |
| park(1000m) | `parkCount1000m` | READY_NOW | CORE_V2 |
| waterfront(해변) | `beachDistanceM`, **3,401/3,401(100%) 커버리지** | READY_NOW | CORE_V2(단, 배치는 Environment 도메인 — 아래 §11 참고) |
| 문화시설 | 미수집(Kakao CT1 카테고리 존재) | SOURCE_EXISTS_NOT_INGESTED | FUTURE |
| daycare/kindergarten(500m, Kakao POI) | `daycareKindergartenCount500m` | READY_NOW | CORE_V2(Education 도메인으로 재배치 권고 — 육아 관련 요소이지 "생활편의"가 아님) |

#### C. 교육

| factor | 실제 근거 | 데이터 분류 | Core eligibility |
|---|---|---|---|
| elementary distance/count(Kakao POI) | `nearestElementaryDistanceM`/`elementaryCount1000m`, 3,381/3,401 | READY_NOW | CORE_V2 |
| 공식 통학구역 | school-v2-final-qa 등 미병합 branch에만 존재(JSON artifact, 부산 99.09% 커버리지, 라이선스 CLEARED) — main/현재 worktree엔 없음 | SOURCE_EXISTS_NOT_INGESTED | CORE_V2 후보(병합 후 승격) |
| 공동학구 | 위와 동일 artifact(`zoneType`), 부산 22개 학구 | SOURCE_EXISTS_NOT_INGESTED | CORE_V2 후보 |
| 중학교 배정군 | 위와 동일, AVAILABLE 3,400/3,402 | SOURCE_EXISTS_NOT_INGESTED | CORE_V2 후보 |
| 유치원 | `Kindergarten`+`KindergartenStat` — **DB엔 이미 367/367행 실존**(공유 DB), 단 이 worktree/main엔 이를 읽는 application 코드가 없음 | SOURCE_EXISTS_NOT_INGESTED(app-level) | CORE_V2 후보 |
| 어린이집 | `Childcare`/`ChildcareStat` 0건, API 키 신청이 필요하나 사용자 승인 없이 신청 보류 중 | NEEDS_NEW_SOURCE(정확히는 "사용자 승인 필요") | FUTURE(승인 시 CORE_V2 후보로 승격 가능) |
| 고등학교(기본 registry) | `School` 664행 실존(공유 DB), 특목고/자사고 플래그(`HS_KND_SC_NM`)는 API엔 있으나 미저장 | SOURCE_EXISTS_NOT_INGESTED | CORE_V2 후보(기본), FUTURE(유형 플래그) |
| 학원가 | `/api/school/stats`가 Kakao AC5로 구 단위 실시간 집계 중(단지별 아님) | SAFE_DERIVABLE | FUTURE(단지별 반경 집계로 확장 시 CORE_V2 후보) |
| 돌봄교실 | 전무(`KindergartenStat.hasAfterSchool` 필드는 있으나 367건 전부 null) | NOT_AVAILABLE | EXCLUDE |
| SchoolInfo 학업성취도 등 | data.go.kr(KOGL Type-3) vs schoolinfo.go.kr 자체 페이지 라이선스 문구가 상충, 미해결 | LEGAL_REVIEW | EXCLUDE(법무 검토 전엔 절대 미사용) |
| 진로/졸업생 진학현황(13-다) | OpenAPI 자체가 없음, Excel 다운로드는 HTTP 503 | NOT_AVAILABLE | EXCLUDE |

**중요 원칙**: Core Education은 "학업 수준"이 아니라 **"교육 접근 환경"**만
다룬다(SchoolInfo 성취도 데이터는 데이터 가용성과 무관하게 철학적으로도 Core에서
배제 — 학업성취도로 아파트를 평가하면 "학군 프리미엄=좋은 집"이라는 또 다른 가격
편향을 만든다).

#### D. 단지상품성

| factor | 실제 근거 | 데이터 분류 | Core eligibility |
|---|---|---|---|
| builtYear/age | `ApartmentMaster.buildYear`, 사실상 100% coverage(MOLIT 원본) | READY_NOW | CORE_V2 |
| households(scale) | `totalHouseholds`, PEER_FULL 72.5%와 연동 | READY_NOW | CORE_V2 |
| building count | `mainBuildingCount`, 부분 coverage | READY_NOW(coverage 보통) | CORE_V2(보조) |
| parking per household | `parkingCount/totalHouseholds`, **coverage 25.3%만**(registry 결측이 근본원인, quality-filter로도 해결 안 됨 — STEP0.8 §U) | READY_NOW(low coverage) | CORE_V2(신뢰도 배지 필수) |
| underground parking/건물-주차 연결 | 전무 | NOT_AVAILABLE | EXCLUDE |
| FAR/BCR | `Apartment.far/.bcr`(0.94 coverage) 존재하나 이 테이블은 **34행짜리 legacy cache**일 뿐, score 엔진이 쓰는 `ApartmentMaster`(3,402행)엔 컬럼 자체가 없음(0% coverage) | SOURCE_EXISTS_NOT_INGESTED | FUTURE(ApartmentMaster로 이관 전엔 Core 불가) |
| 건설사/브랜드 | `Presale.constructCompany`(98% coverage)는 **분양 매물 전용**, 기존 준공 아파트(`ApartmentMaster`)로의 join key가 없음 | NOT_AVAILABLE(기축 아파트 기준) | EXCLUDE(§20: 데이터 없으면 브랜드 점수화 금지 원칙과도 일치) |
| 엘리베이터/조경/EV충전/평면(bay)/복도형식/수납 | 전부 전무, 일부는 명시적 "coming soon" stub(평면도, 관리비) | NOT_AVAILABLE/NEEDS_NEW_SOURCE | EXCLUDE/FUTURE |
| 커뮤니티 시설(내부 편의시설) | `Apartment.communityFacilities`, 크롤러 존재하나 **0/34 실측 coverage**(UI 버튼도 이미 제거됨) | NOT_RELIABLE | EXCLUDE |
| 관리비 | 소스 자체 없음(단지별 상이, 공개 데이터 없음), UI에서도 명시적 제거 이력 | NEEDS_NEW_SOURCE | EXCLUDE |

#### E. 쾌적성/환경

| factor | 실제 근거 | 데이터 분류 | Core eligibility |
|---|---|---|---|
| 공원/녹지 | Living의 `parkCount1000m`와 중복(§16에서 중복가중 처리 방안 논의) | READY_NOW | CORE_V2(Living과 공유, 이중 가중 주의) |
| 해변/워터프론트 | `beachDistanceM`, **100% coverage** | READY_NOW | **CORE_V2 — 현재 유일하게 완전한 Environment factor** |
| 산/조망/일조 | 전무, 본질적으로 주관적(단위 층/향 데이터도 없음) | NOT_AVAILABLE | EXCLUDE(객관화 불가) |
| 평지/경사 | **전무 — `statsMenu.ts`에 스스로 "coming soon, 지형 고도·경사도 데이터셋 미연동"으로 명시**(DEM 등 신규 소스 필요) | NOT_AVAILABLE | FUTURE(부산 사용자 체감가치가 커서 최우선 acquisition 후보로 기록) |
| 소음(철도/고속도로) | 전무 | NOT_AVAILABLE | NEEDS_NEW_SOURCE → FUTURE |
| 혐오시설 | 전무(매립지/화장장/변전소 등 키워드 0건) | NOT_AVAILABLE | NEEDS_NEW_SOURCE → FUTURE |
| 대기질 | 전무(공공 API 있으나 미연동) | NOT_AVAILABLE | NEEDS_NEW_SOURCE → FUTURE |
| 침수/산사태/해안재해 | 전무 | NOT_AVAILABLE | NEEDS_NEW_SOURCE → FUTURE — **주의**: "해변 가까움=쾌적성"과 "해안=재해 위험" 두 factor가 향후 공존할 경우 서로 다른 방향으로 점수를 당길 수 있음을 STEP2 설계 시 명시적으로 인지해야 한다(상쇄 로직 필요, 이번 STEP에서 결정하지 않음). |

#### F. 시장성(Core 아님, 별도 Index 후보)

| factor | 실제 근거 | 데이터 분류 |
|---|---|---|
| 거래량/유동성 | `ApartmentMarketFeature.transactionCount12m/36m`, 2,937건(전체 아파트의 86%) | READY_NOW |
| 가격/㎡당가 | `latestTradePrice`/`medianPricePerM2_12m/36m`, 100% of 2,937 | READY_NOW |
| 가격상승률(priceChange12m) | 컬럼은 있으나 **의도적으로 항상 null**(수집 코드 자체가 계산을 미룸, "EXTERNAL_VERIFICATION_REQUIRED"로 S2C에 이관) | SOURCE_EXISTS_NOT_INGESTED |
| 전고점/drawdown/회복률 | 지속 저장 컬럼 없음 — `/api/stats/rankings`가 **최대 24개월 윈도우 내에서만** 라이브 계산(진짜 "역대 최고가"가 아님) | SAFE_DERIVABLE(단, window-bounded 한계 명시 필수) |
| 전세가율/전세 | 실거래 라이브 fetch에 jeonse 유형 포함(역전세 버그는 이미 수정됨 — 월세 혼입 필터링), 별도 저장 컬럼은 없음 | SAFE_DERIVABLE |
| 공급/미분양 | 전무(Presale의 "unsold"는 무순위 잔여세대일 뿐, 정부 미분양 통계 아님) | NOT_AVAILABLE/NEEDS_NEW_SOURCE |
| 매물(listings) | 3개 조사 agent 어디서도 발견되지 않음 | NOT_AVAILABLE |

#### G. 미래가치(Core 아님, 별도 Index 후보)

| factor | 실제 근거 | 데이터 분류 |
|---|---|---|
| 재건축/재개발 단계 | `RedevelopmentProject.stage`, **1,798건 실제로 잘 채워짐**(13개 stage 전부 분포 확인) | READY_NOW(원본 registry 자체는) |
| 재건축 프로젝트 ↔ 아파트 join | `RedevelopmentProject`에 aptSeq/FK 없음, `lat/lng`도 0/1,798 — 좌표 자체가 아직 지오코딩 안 됨 | NOT_AVAILABLE(단지 단위 연결) |
| 대지지분 | 전무(어떤 모델에도 없음) | NEEDS_NEW_SOURCE |
| FAR(재건축 잠재력 관점) | §D와 동일한 SOURCE_EXISTS_NOT_INGESTED | SOURCE_EXISTS_NOT_INGESTED |
| 향후 교통망/개발계획/업무지구 계획 | 전무 | NEEDS_NEW_SOURCE |

### 4. Absolute Score 원칙(§8) — Absolute/Relative/Hybrid 분류

STEP 0.8의 핵심 교훈(140m subway가 LOCAL percentile 때문에 306m보다 낮은 점수를
받음)을 architecture 차원에서 원천 차단한다.

| factor | 분류 | 근거 |
|---|---|---|
| subway distance/count | **ABSOLUTE 중심** | 물리적 거리는 지역과 무관한 절대 사실. STEP0.8 §Q(inversion 14~17%)가 LOCAL 상대평가의 위험을 정량 증명 |
| bus distance/count | **ABSOLUTE 중심** | 동일 논리 |
| elementary distance/count | **ABSOLUTE 중심** | STEP0.8 §V(school inversion) + 이번 STEP §32 실측(협성 341m vs 대신해모 545m인데 협성 school score가 더 낮음)이 동일 문제를 재확인 |
| parking ratio | **ABSOLUTE 중심 + 동시대 context 병기** | STEP0(1.09→18 vs 1.58→95)의 실제 두 단지가 바로 대신해모/협성 자신이었음(§32-33에서 재확인) — LOCAL peer 소표본의 극단값 문제가 이미 실증됨 |
| living(mart/편의점/공원 등 count) | **HYBRID** | count류는 절대 개수 자체(0개 vs 5개)가 이미 의미 있는 절대 정보이지만, log1p 변환이 필요한 diminishing-returns 특성상 "밀도"라는 상대적 해석도 필요(§X 참고) — distance류와 다른 취급 필요 |
| buildYear(age) | **ABSOLUTE(curve)** | 연식 자체는 절대 사실. 다만 "최신=항상 좋음"이 아닌 밴드형 curve로(§13) |
| households(scale) | **ABSOLUTE(saturating curve)** | 절대 세대수 자체가 유동성/커뮤니티에 의미 있음(§18) |
| waterfront distance | **ABSOLUTE** | 거리 팩트, 지역 무관 |
| 신축 희소성(newness scarcity) | **RELATIVE 필요** | "이 지역에서 얼마나 드문 신축인가"는 본질적으로 상대적 개념(공급 맥락) — 시장성 index 쪽에 가까움 |
| 가격 | (Core 제외) **RELATIVE(지역 비교 중요)** | 별도 Market Index에서만, "이 가격이 이 지역 기준 비싼가"는 상대평가가 핵심 |

### 5. Relative Score 역할(§9) 및 비교 population 정책(§10)

factor/domain별로 역할이 다르다 — 단일 population을 전체에 적용하지 않는다:

| factor | relative 역할 | 비교 population |
|---|---|---|
| 교통(subway/bus) | C. "지역 내 위치" 표시만(참고 문장) | **BUSAN**(1차) / **SIGUNGU**(보조) — STEP0.8 §T가 SIGUNGU 채택 시 inversion이 절반(144,915→78,288)으로 줄어듦을 실측 확인. **LOCAL(법정동)은 어떤 Core factor의 주 비교 population으로도 사용하지 않는다.** |
| 학교 접근성 | C. 표시만 | BUSAN/SIGUNGU |
| 주차 | D. factor별 다르게 — 절대 curve가 주, "동시대 단지 대비" 상대문장은 보조 | **SIMILAR_AGE**(§14의 1990/2000/2020년대 구조 차이 반영) + BUSAN 절대 curve |
| 생활편의(count) | B. Core domain 내부 small adjustment | LIVING_AREA(생활권, 법정동보다 넓게 — STEP0.8 §H가 검증한 "combined dong" 개념 확장) |
| 단지 규모/연식 | C. 표시만(예: "부산 상위 15% 규모") | BUSAN |
| 가격(별도 Market Index) | A급 중요도 — 이 index 안에서는 relative가 핵심 | SIGUNGU/SIMILAR_SIZE/SIMILAR_AGE 조합 |

**LOCAL(법정동) percentile은 Core Score의 직접 입력으로 사용하지 않는다** —
이것이 STEP 0.8→STEP 1의 가장 중요한 architecture 결정이다.

### 6. Transport V2 설계(§11)

- **SUBWAY_ACCESS**: absolute distance-band + count, BUSAN 절대 curve 중심(§9). Station 중심(center) 거리와 실제 출입구 접근성은 다를 수 있음 — Kakao SW8은 "역 대표점" 좌표만 제공하므로(STEP0.5 확인), UI 문구는 반드시 "역 중심 기준 약 140m"처럼 **정확한 척하지 않는다**(entrance 데이터 없음을 명시).
- **BUS_ACCESS**: absolute distance+count(READY_NOW 요약 필드). 노선번호/노선유형(TAGO 라이브)은 아직 미저장이라 scoring엔 편입하지 않고 DISPLAY_ONLY로 유지.
- **ROAD_ACCESS**: NOT_AVAILABLE, FUTURE.
- **MAJOR_DESTINATION_ACCESS**: 업무지구 정의 자체가 없어 범용 factor로는 NOT_AVAILABLE. 진짜 의미 있는 버전은 본질적으로 PERSONALIZED(§25)이며 현재 미구현 — Core Transport는 "공통 접근성"만 다루고 개인화는 완전히 분리 유지.
- **환승/노선가치**: 데이터 없음, 이번 V2에서 EXCLUDE.

Core Transport 최종안 = SUBWAY_ACCESS + BUS_ACCESS, 둘 다 절대 curve 중심.

### 7. Complex Quality V2(§12) / Age(§13) / Parking(§14) / Scale(§18) / FAR·BCR(§19) / Brand(§20)

| 후보 factor | 처리 |
|---|---|
| AGE_QUALITY | 절대 밴드 curve(§13) — "신축=무조건 좋음" 금지. 연식이 실제로 의미하는 상품성(설비/주차구조/평면)과 구축의 입지우위·재건축가능성을 분리: **재건축 잠재력은 Core에서 제외하고 별도 RECONSTRUCTION/FUTURE index로**(§31) |
| SCALE(세대수) | 절대 **포화(saturating) curve** 후보(§18) — "733세대가 489세대보다 무조건 몇 점 높다"는 선형식 금지. 소규모(유동성/커뮤니티 열위)에는 페널티, 중~대형은 완만한 곡선, 초대형은 추가 보너스 없음(체감가치 포화) |
| PARKING | 절대 curve 중심(§9) + 동시대(SIMILAR_AGE) context 병기(§14) — 1990/2000/2020년대 구조가 다른 현실 반영. coverage 25.3%가 근본 제약이라 **신뢰도 배지 필수**(§27) |
| FAR/BCR | `ApartmentMaster`에 컬럼 자체가 없어(0% coverage) 이번 V2 Core엔 넣지 않음(FUTURE). 낮은 용적률이 "무조건 쾌적"이라는 단순 판단 금지 — 주거 쾌적성 관점(동간 거리·일조)과 재건축 사업성 관점(대지지분 여유)을 명확히 분리해 설계해야 함(§19) — 향후 편입 시 두 의미를 별도 factor로 다뤄야 함 |
| BUILDER/BRAND | 기축 아파트에는 연결된 데이터가 전무 — **EXCLUDE**. 브랜드 선호는 주관적이고 지역별로 다르며, 안전한 데이터가 없는 한 인지도를 임의 점수화하지 않는다(§20 원칙 그대로 확인) |
| 주차를 별도 domain으로? | **아니오, Complex 내부 factor로 유지** — 데이터 양/coverage가 독립 domain을 정당화할 만큼 richer하지 않고(단일 ratio 하나뿐), Complex 안에서 별도 sub-factor로 명확히 라벨링하는 편이 explainability상 더 낫다 |

### 8. Education V2(§15) — 이미 위 인벤토리에 반영. 핵심 원칙: "학업 수준"이 아니라
"교육 접근 환경". 아이키우기 지수(Child-Friendly, §24)는 별도 index로 분리.

### 9. Life V2(§16)

호갱노노 유사 5분류(교육/교통/의료/쇼핑/문화)를 참고하되 **공식은 추정하지
않는다**(원칙 §4/§13 재확인). 현재 데이터로는 SHOPPING/CULTURE가 사실상
비어있어(대형마트·백화점 구분 불가, 문화시설 미수집) 5개 독립 top-level
sub-domain으로 승격할 근거가 부족하다.

**결정**: Core "생활 편의" 도메인 하나를 유지하되, 내부적으로
MEDICAL(병원·약국) / DAILY_CONVENIENCE(마트·편의점) / PARK_LEISURE(공원)
3개 **explainable sub-label**로 나눠 노출한다(`school-access-sentence.ts`
패턴 재사용, §28). SHOPPING/CULTURE는 데이터가 채워지기 전까지 sub-label
자체를 만들지 않는다(있어 보이게 포장 금지, CLAUDE.md 원칙 4/13).

### 10. Environment / terrain(§17)

현재 유일한 READY_NOW factor는 **해변 거리(100% coverage)** 뿐이다. 평지/경사
("산복도로")는 부산 사용자 체감가치가 크다는 지시를 인지하지만, DEM 등 새
데이터 소스가 전혀 없어(§2 STOP 조건: "새로운 외부 유료 데이터 source 필요"에
해당할 수 있음) 이번 STEP에서 확보하지 않는다 — **FUTURE 최우선 후보로만
기록**한다.

**결정**: Environment를 Core domain #5로 두되(§31 참고), 현재는 해변 거리
단일 factor만 채워진 "제한적 커버리지" 도메인으로 명시적으로 표시한다(§43
scorecard). 소음·침수·경사 등이 확보되면 자연스럽게 같은 도메인에 추가되는
구조를 만들어 두는 것이, 지금은 Living에 묻어뒀다가 나중에 도메인을 분리하는
재구조화보다 낫다고 판단했다(장기 확장성 우선). 해안-재해 리스크 factor가
미래에 추가될 경우 "해변에 가까움=쾌적"과 상충할 수 있음을 §3-E에 명시했다.

### 11. Scale — §7 표 참고. FAR/BCR — §7 표 참고. Brand — §7 표 참고.
(중복 방지를 위해 위 통합 표로 대체)

### 12. Price exclusion(§21) / Market Index(§22) / Investment Index(§23) / Child-Friendly Index(§24) / Personalized Commute(§25)

- **가격은 Core에서 완전히 제외**(§2 재확인). "이 품질을 이 가격에 사는 것이
  합리적인가"는 VALUE/INVESTMENT 별도 index에서만 다룬다.
- **MARKET_STRENGTH**(별도): 거래량/가격/㎡당가는 READY_NOW, priceChange12m은
  SOURCE_EXISTS_NOT_INGESTED, 전고점/drawdown은 SAFE_DERIVABLE이나 window-bounded
  한계 명시 필수. Core와 절대 혼합하지 않는다.
- **INVESTMENT_ATTRACTIVENESS**(별도): supply/미분양이 NOT_AVAILABLE이라 지금
  당장 완성도 있게 만들 수 없다 — **V2 Core와 동시 출시할 필요 없음**(spec 허용
  그대로 채택).
- **CHILD_FRIENDLY**(별도): 공식 통학구역(SOURCE_EXISTS_NOT_INGESTED이지만
  merge만 하면 즉시 사용 가능) + 유치원(DB에 이미 367건 존재) + 공원 + 의료 +
  (보행안전은 FUTURE) 조합 — Core 완성 후 기존 factor 재조합만으로 빠르게 만들
  수 있는 저비용 index.
- **PERSONALIZED_COMMUTE**(별도): 확인 결과 코드가 전혀 없다(§11) — 순수
  로드맵 항목으로 유지, Core Transport는 계속 "공통 접근성"만 평가.

### 13. Missing data 전략(§26)

| 후보 | 설명 | 평가 |
|---|---|---|
| A. fixed weights + partial score(현 V1) | 결측 도메인의 weight를 남은 도메인에 비례 재분배 | STEP0.8에서 이미 위험 확인(coverage 낮은 카테고리가 나머지를 과대 대표) — 그대로 채택 금지 |
| B. bounded redistribution | 재분배 허용폭에 상한을 둠(한 factor 결측이 나머지를 과도하게 부풀리지 못하게) | STEP2 수치설계 목표로 채택 |
| C. score + coverage badge | 점수와 별도로 "N개 중 M개 factor 기반" 배지 표시 | **지금 당장 채택 가능**(표시 정책이라 숫자 확정 불필요) |
| D. confidence-adjusted score | 낮은 coverage일 때 점수 자체를 신뢰도로 감쇠 | STEP2 수치설계 목표로 채택 |

**추천: 지금은 C(투명성 확보), STEP2에서 B+D를 수치로 확정.** A(현재 V1 방식)는
그대로 이어가지 않는다.

### 14. Confidence(§27)

Score와 Confidence를 분리 노출한다("이집점수 82 / 데이터 신뢰도 높음"). 입력
후보: identity quality/coordinate quality(STEP 0.6 `peer-quality.ts classify()`
그대로 재사용 가능 — 이미 검증된 로직), domain coverage(§13 C의 badge와 연동),
source freshness(`fetchedAt`/`validUntil` 이미 스키마에 존재). **formula는
확정하지 않는다** — STEP2 대상.

### 15. Explainability 계약(§28)

각 domain은 최소 다음 필드를 지원해야 한다:

```
{
  score, grade,
  rawFacts: string[],       // "지하철 약 140m(역 중심 기준)"
  strengths: string[],
  weaknesses: string[],
  absoluteLevel: string,    // "매우 가까움" 같은 절대 밴드
  relativeContext: string,  // "부산 상위 8%" — 참고용, 표시만
  coverage: number,
  confidence: 'HIGH'|'MEDIUM'|'LOW',
  source: string,
  sourceDate: string,
}
```

기존 `school-access-sentence.ts`의 "ABSOLUTE FACT → RELATIVE CONTEXT" 패턴을
모든 domain에 일반화한 것이다 — 이미 한 곳에서 검증된 패턴이라 새로운 개념이
아니라 확장이다.

### 16. Score label(§29)

| 기존(V1) | V2 후보 |
|---|---|
| 교통 | 교통 접근성 |
| 생활(Living) | 생활 편의 |
| 학교(schoolAccess) | 교육 환경 |
| 단지(Complex) | 단지 상품성 |
| (신규) | 주거 쾌적성(Environment) |

"단지"처럼 너무 넓은 이름을 금지하고 실제 factor에 맞춘 이름만 사용한다.

### 17. Architecture Model 비교(§30)

| | MODEL A(4-domain) | MODEL B(5-domain) | MODEL C(Core+separate) |
|---|---|---|---|
| domain | Transport/Living/Education/Complex | + Environment(해변 단일 factor) | A or B + 별도 index 5종 |
| factor 수(Core) | ~14개 | ~15개(+해변) | 동일 + index별 factor |
| overlap 위험 | 낮음 | Living-park count와 Environment-해변이 인접 개념(§3-E 명시) | 동일 |
| data coverage | 전부 READY_NOW 중심, 안전 | Environment가 factor 1개뿐이라 "도메인"치고 얇음 | Core는 A/B와 동일, 별도 index는 READY_NOW~NOT_AVAILABLE 혼재(투명 라벨 전제) |
| explainability | 높음(모든 domain이 충분히 두꺼움) | Environment 설명이 "해변 거리 하나"뿐이라 다소 빈약 | Core는 explainable, 별도 index는 아예 안 보여줄 수도 있어(§23) 오히려 정직함 유지 쉬움 |
| user comprehension | 쉬움 | "환경 domain인데 해변만?" 의문 가능 | 좋음 — "이건 집 품질, 이건 시장/투자"로 구조 자체가 이해를 돕는다 |
| future expansion | Environment를 나중에 새 domain으로 추가하려면 재구조화 필요 | 지금부터 자리 확보, 확장 매끄러움 | A/B 선택과 독립적으로 항상 유리(Market/Investment/Child-Friendly/Redevelopment를 위한 자리를 미리 만듦) |

### 18. RECOMMENDED_ARCHITECTURE(§31)

**Model B + Model C를 결합한다** — 즉 spec §31 예시와 동일한 구조:

```
CORE E-JIP SCORE (가격을 제외한 주거 품질)
- Transport(교통 접근성): SUBWAY_ACCESS, BUS_ACCESS
- Living(생활 편의): MEDICAL, DAILY_CONVENIENCE, PARK_LEISURE
- Education(교육 환경): elementary access(READY) + attendance zone/중학교군/유치원/고교(SOURCE_EXISTS_NOT_INGESTED, 병합 시 승격)
- Complex(단지 상품성): AGE_QUALITY, SCALE, PARKING(신뢰도 배지)
- Environment(주거 쾌적성) — LIMITED: 해변 거리만(향후 경사/소음/침수 추가 예정)

SEPARATE INDICES(Core 아님, 각자 독립 출시 가능)
- MARKET_STRENGTH
- INVESTMENT_ATTRACTIVENESS(데이터 부족 — 우선순위 낮음)
- CHILD_FRIENDLY(기존 factor 재조합, 저비용)
- PERSONALIZED_COMMUTE(로드맵, 미착수)
- RECONSTRUCTION/FUTURE(재건축 stage는 READY지만 아파트 join 자체가 없어 현재 실질 미가동)
```

Environment를 5번째 Core domain으로 넣는 이유(Model B 채택 이유)는 §10에
설명한 대로 "지금 얇아도 미래 확장 지점을 먼저 만들어 두는 것이 나중에
재구조화하는 것보다 싸다"는 판단이며, 대신 **§43 data readiness scorecard에서
`LIMITED`로 명시**해 "있어 보이게 포장"하지 않는다.

### 19. 대신해모로센트럴 qualitative test(§32) — 숫자 생성 없이 raw fact 기준

| factor | raw fact | 정성 평가 |
|---|---|---|
| Transport | 지하철 140m(부산 상위 7.2%, 서구 8/101) | **STRONG** |
| Complex age | 2022년 준공(비교군 중 최신) | **STRONG** |
| Scale | 733세대, 9개동 | **STRONG(대형)** |
| Parking | 800대/733세대 = **1.09대**/세대 | **WEAK** — production/shadow 양쪽에서 낮은 점수(17.9)로 일관 → peer artifact가 아니라 raw ratio 자체가 낮음 |
| Education | 최근접 초등 545m, 1000m 내 4개교 | **WEAK-ish**, 단 협성(341m)보다 명백히 멀면서도 V1 relative school score는 대신해모가 더 높게 나오는 역전 현상 존재(§20 참고) — **절대 거리 기준으로는 협성보다 열위** |
| Living | mart/편의점/약국 등 밀도 낮은 편(V1 living score 35.6) | **WEAK-ish** |
| Environment(해변) | 3,923m | **WEAK**(서대신동은 원래 내륙 — 정상적 결과이지 결함 아님) |

### 20. 협성르네상스 qualitative test(§33)

| factor | raw fact | 정성 평가 |
|---|---|---|
| Transport(절대) | 지하철 306m — **부산 상위 32.3%, 서구 41/101**(대신해모보다 명백히 열위) | **AVERAGE**(LOCAL percentile 78.3은 §5의 architecture 원칙상 신뢰하지 않음) |
| Complex age | 2001년 준공(대신해모보다 21년 구축) | **WEAK** |
| Parking | 775대/489세대 = **1.58대**/세대 | **STRONG** — production/shadow 양쪽 95.0으로 일관, 진짜 우위 |
| Scale | 489세대, 10개동 | **AVERAGE** |
| Education | 최근접 초등 **341m**(대신해모의 545m보다 204m 더 가까움) | **원칙상 STRONG이어야 하나, V1 relative school score는 오히려 대신해모보다 낮다(11.4 vs 22.0) — 이것이 STEP0.8 §V가 실측한 cross-peer inversion의 실제 당사자였음이 이번 조사로 확인됨** |
| Living | V1 living score 37.7(대신해모와 비슷한 수준) | **WEAK-ish** |

**중요 발견**: 대신해모/협성 두 벤치마크는 STEP0 스펙이 인용한 세 가지 유명
사례 — 교통(140m vs 306m), 주차(1.09→18 vs 1.58→95), 학교(341m vs
545m 역전) — 의 **동일한 두 아파트**였다. 즉 이 한 쌍이 V1 relative-percentile
구조의 문제를 transport/parking/education 세 도메인에서 동시에 보여주는
축소판이다 — 우연이 아니라 "서대신동2가 vs 서대신동3가"라는 좁은 법정동
경계 하나가 세 도메인 모두에서 반복적으로 왜곡을 만든 것이다.

### 21. 구덕금호 negative case 처리(§34)

- 현재 상태: `IDENTITY_LOW`, `COORD_LOW`, `DISPLAY_ONLY`, `totalHouseholds=null`,
  `parkingCount=null`(registry 연결 자체가 안 됨)
- STEP0.8 SHADOW 결과: production 54점(저품질 좌표 의존, coverage 0.85) →
  shadow 상 5개 도메인 중 4개가 NOT_SCORED, complex만 PARTIAL(35.3)

**V2 eligibility 규칙 제안**: identity/coord가 STEP 0.6 기준 `DISPLAY_ONLY` 이하인
단지는 **Core 종합점수 자체를 계산하지 않는다**(V1/shadow처럼 도메인별
partial-coverage로 그럴듯한 총점을 만들지 않음 — 총점 단위에서 즉시
`NOT_ENOUGH_DATA`). 대신:
- raw fact(주소, 준공년도 등 확보된 것)는 그대로 표시(§17 원칙)
- 개별 도메인 중 확실한 것(예: complex의 buildYear)은 "참고 정보"로만 노출,
  종합점수에는 반영하지 않음
- registry 상 주용도가 "단독주택" 등 공동주택이 아닌 것으로 확인되는 경우
  (구덕금호처럼) STEP 0.6 `classify()`에 없는 새로운 신호(**registry-use-type
  불일치 검사**)를 추가하는 것을 STEP2 후보로 제안 — 이번 STEP에서 구현하지 않음

## 설계 결정 요약

### 22. Expert Credibility Gate(§36) — STEP0.8 8개 항목을 정식 release gate로 채택

| # | 항목 | V2 설계가 만족해야 하는 것 |
|---|---|---|
| 1 | raw fact correctness | 모든 Core factor는 §7 인벤토리의 evidence 기준(READY_NOW/SAFE_DERIVABLE)만 사용 |
| 2 | obvious dominance | §37 monotonic constraint 전수 통과 |
| 3 | cross-district consistency | LOCAL percentile을 Core 입력에서 배제(§5)로 구조적 해결 |
| 4 | explainability | §15 계약 100% 구현 |
| 5 | missing-data honesty | §13 C(coverage badge) 최소 적용 |
| 6 | sensitivity | STEP2에서 peer/curve 변경 시 벤치마크 회귀 테스트 |
| 7 | local expert review | STEP0.8 §AC 표 구조 실행(이번 STEP도 미실행, 계속 이월) |
| 8 | benchmark regression | §35 확장된 benchmark set 대비 회귀 없음 |

### 23. Monotonic constraints(§37)

- 동일 조건에서 **140m subway는 900m보다 SUBWAY_ACCESS에서 낮아서는 안 된다**
  (절대 거리 기반이므로 architecture상 자동 보장 — LOCAL percentile을 배제한
  것 자체가 이 제약의 구조적 해法)
- **parking 1.5대/세대는 0.7대보다 낮아서는 안 된다**(동일 논리)
- **data quality가 LOW인 단지가 confidence HIGH로 나와서는 안 된다**(§14
  confidence 설계에 identity/coord quality를 반드시 포함)

### 24. Anti-gaming / anti-overfit(§38)

대신해모 한 사례를 고치기 위한 overfit을 방지하기 위해, STEP2 검증은 반드시
(a) §35 확장 benchmark(28→30~50개)와 (b) 부산 전체 3,402 universe 양쪽에서
수행한다 — STEP0.8이 이미 이 패턴(benchmark + 전수 cross-population
inversion 카운트)을 확립했으므로 STEP2도 동일 방법론을 이어간다.

### 25. Data-source independence(§39)

| domain | 주 데이터 소스 | 장애 시 영향 범위 |
|---|---|---|
| Transport | Kakao Local API(SW8) + TAGO | Kakao 장애 시 subway 전체 영향, TAGO 장애 시 bus만 영향(서로 독립) |
| Living | Kakao Local API(카테고리별) | Kakao 장애 시 전체 영향 — **단일 장애점**, STEP2에서 대체 소스 필요성 검토 권고 |
| Education | Kakao(초등 POI) + NEIS/교육시설안전원(통학구역, 병합 시) | 이원화되어 있어 한쪽 장애가 전체를 막지 않음(양호) |
| Complex | MOLIT 건축물대장/registry | 단일 소스, 그러나 배치성이라 실시간 장애 영향 적음 |
| Environment | Kakao(해변 키워드) | Living과 동일 장애점 공유 |

**Living/Environment가 Kakao 단일 장애점을 공유**한다는 점을 STEP2 리스크로
기록한다.

### 26. Score versioning(§40)

`EJIP_SCORE_V1_BETA`(현재) → `EJIP_SCORE_V2_BETA`(설계 확정 후) →
`EJIP_SCORE_V2`(release gate 통과 후) 순서를 제안한다. 과거 점수와 구분
가능해야 하므로 응답에 `scoreVersion` 필드를 유지(V1이 이미 하는 방식 그대로
확장). **이번 STEP에서 DB migration은 하지 않는다.**

### 27. UI concept(§41, 구현 금지 — 컨셉만)

```
이집점수 82

교통 접근성 91        "지하철 약 140m(역 중심 기준)"   부산 상위 8%
단지 상품성 86        "2022년 준공 · 733세대"          -
생활 편의 78          "편의점 5개(500m 내)"             -
교육 환경 72          "초등학교 약 340m"                -
주거 쾌적성 (LIMITED) "해변까지 약 4.0km"               데이터 확장 예정
```

relative context("부산 상위 8%")는 §15 계약의 `relativeContext` 필드로만
존재하고, 점수 자체(91)는 절대 curve로 계산된다.

### 28. Compare UX(§42, 제안만)

호갱노노 radar보다 강화된 A vs B 비교 표:

```
             A(대신해모)    B(협성)      실질적 차이
Transport    91(절대)       67(절대)      A가 명백히 우세(140m vs 306m)
Parking      낮음(1.09)     높음(1.58)    B가 명백히 우세
Complex age  2022           2001          A가 명백히 우세
Education    340m           341m          거의 동일(raw fact 병기 필수)
Confidence   HIGH           HIGH
```

"factor winner"를 raw fact 기준으로 명시하고, "meaningful difference"는
절대 수치 차이가 임계치 이상일 때만 표시(임계치 수치는 STEP2). purpose-specific
result(예: "아이 키우기 목적이면 A가 유리")는 Child-Friendly index(§24)
완성 후 가능.

### 29. Data readiness scorecard(§43)

| Core domain | factor | 상태 |
|---|---|---|
| Transport | subway/bus | READY |
| Living | mart/편의점/약국/공원 | READY |
| Education | elementary(Kakao) | READY |
| Education | 통학구역/중학군/유치원/고교 | LIMITED(SOURCE_EXISTS_NOT_INGESTED, 병합 필요) |
| Complex | buildYear/households | READY |
| Complex | parking | LIMITED(coverage 25.3%) |
| Environment | 해변 | READY(단일 factor) |
| Environment | 기타 전부(경사/소음/침수 등) | BLOCKED(신규 소스 필요) |

**판정**: Core domain 중 어느 하나도 BLOCKED data에 전적으로 의존하지 않는다
(Environment조차 해변 하나는 READY) — architecture 재검토 불필요. 단
Education/Complex-parking/Environment 3곳은 LIMITED이므로 §13 coverage
badge가 반드시 필요하다.

### 30. STEP 2 필요 분포분석 목록(§44, 숫자 미확정)

1. 부산 전체 subway/bus 절대거리 분포 곡선 형태(선형/로그/계단) 결정을 위한 histogram 재확인(STEP0.8 §E 재사용 가능)
2. parking ratio 절대 분포 + 시대별(1990/2000/2010/2020) 구간별 분포 비교
3. buildYear 밴드 경계값 후보 산출을 위한 buildYear vs 상품성 proxy 상관 분석
4. households(scale) saturating curve 변곡점 후보 탐색(유동성 proxy와의 상관)
5. living count류(mart/편의점 등) log1p 이후 분포 재검증(현재 V1 캡 45 적정성)
6. Education 도메인 통합 시(통학구역 병합 후) coverage/분포 재조사
7. bounded redistribution 상한값(§26 B) 결정을 위한 domain별 결측 패턴 분석
8. confidence 가중치(§27 D) 결정을 위한 identity/coord quality별 실제 오차 분석
9. 확장 benchmark(30~50개, §35) 선정 및 domain별 회귀 기준값 확정

### 31. V1 처리 권고(§45)

STEP0.8 trust=C(HIDE/DEEMPHASIZE)를 유지. V2 완성 전까지: Beta 유지, ranking
콘텐츠 확대 금지, recommendation 입력 확대 금지, 핵심 마케팅 문구 사용 금지 —
**이번 STEP에서 UI 코드를 변경하지 않는다**(권고만 기록).

## 구현 내용

이번 STEP은 analysis/docs only다. 신규 코드/스크립트 없음(§8-9의 factor
분류는 3개 read-only 조사 agent의 실제 schema/코드/문서/DB count 확인과, 두
벤치마크의 raw parking ratio·초등거리 확인을 위한 임시 1회성 read-only 스크립트
실행으로 이루어졌으며, 그 스크립트 자체는 결과 확인 후 삭제했다 — 재사용 가치가
없는 1회성 조회였기 때문).

## 테스트 결과

해당 없음(analysis/docs only, production 코드 변경 없음). tsc/lint는 이번
STEP에서 수정된 코드가 없어 실행하지 않았다(CLAUDE.md §11 "가능한 범위에서" —
변경된 소스가 없으므로 대상 없음).

## 알려진 문제

1. **School V2 데이터가 schema/DB엔 있지만 application 코드가 없다** — `School`
   664행, `Kindergarten`/`KindergartenStat` 367/367행이 공유 DB에 실존하지만,
   이를 읽는 API/UI 코드는 전부 미병합 branch(`school-v2-final-qa` 등)에만
   있다. Education 도메인을 Core로 완전히 채우려면 **코드 병합**이 선행돼야
   한다(이번 STEP 범위 밖, STEP2 이전 권장 액션으로 기록).
2. **어린이집 API 키 신청이 사용자 승인 대기 중** — 기술적으로는 파이프라인이
   준비돼 있으나(17/17 테스트 통과) 실제 신청은 하지 않았다. 이번 STEP에서도
   신청하지 않는다(§2 SAFE AUTONOMOUS MODE의 "새로운 외부 데이터 source 필요"
   조건에 해당할 수 있어 임의 진행하지 않음).
3. **SchoolInfo 라이선스가 두 공식 출처끼리 상충**(data.go.kr KOGL Type-3 vs
   schoolinfo.go.kr 자체 페이지) — 법무 검토 없이는 학업성취도류 데이터를
   영구히 Core/별도 index 어디에도 쓰지 않는다.
4. **Living/Environment가 Kakao API 단일 장애점을 공유**(§39) — STEP2에서
   대체 소스 필요성 논의 권고.
5. **STEP0.5 문서의 "SCORE_V2_STEP1_READY = NO"는 이제 stale하다** — 그
   판정은 STEP 0.7-A(peer 복구 write) 이전 시점 기준이었고, STEP 0.7-A 이후
   STEP 0.8이 `SCORE_V2_STEP1_READY = YES`로 재확정했다. 조사 agent가 이
   시점차를 정확히 지적해 혼선을 피했다 — 향후 이 문서를 참고할 때도 날짜/STEP
   순서를 반드시 확인할 것.

## 다음 STEP

- STEP 2: absolute scoring curve, threshold, normalization, factor/domain
  weighting — 처음으로 숫자를 설계한다(§30 분포분석 9개 선행)
- 그 전에 권장하는 낮은 리스크 우선순위 작업: School V2 branch 병합
  (데이터는 이미 있고 위험이 낮음), CHILD_FRIENDLY index 설계(기존 factor
  재조합이라 저비용)

---

## 최종 보고 (E-JIP SCORE V2 STEP 1)

1. branch = `score-v2-step1-architecture`
2. base = `score-v2-step08-shadow-peer-validation`(commit `f4f456c`)

3. factor inventory total ≈ 75개(A~G 카테고리 전수, §7 표 기준)
4. READY_NOW ≈ 24개(subway거리/count, bus거리/count, mart/편의점/약국/병원/공원count, 해변거리, elementary거리/count, buildYear, households, mainBuildingCount, parking ratio, 거래량/가격류 5종, redevelopment stage/businessType, presale 다수 필드 등)
5. SAFE_DERIVABLE ≈ 5개(유동성, 전고점/drawdown, 전세가율/전세, 학원가 구단위 집계, 재건축 age 재해석)
6. SOURCE_NOT_INGESTED ≈ 15개(FAR/BCR, 통학구역, 공동학구, 중학교군, 유치원 app-level, 고교 app-level, 전통시장/관공서/은행/도서관/체육/문화시설 Kakao 미수집, bus 노선번호 영속화, priceChange12m)
7. LEGAL_REVIEW = 2개(SchoolInfo 학업성취도류 통계, 좌표 사용 게이트)
8. NOT_AVAILABLE ≈ 25개+(환승역/노선가치/업무지구접근/공항/간선도로/경사/소음/혐오시설/대기질/침수/산사태/대지지분/브랜드(기축)/엘리베이터/조경/EV충전/평면/복도형식/수납/관리비/커뮤니티시설(실질)/공식 미분양통계/매물 등)

9. recommended definition of E-jip Score = **"가격을 제외한, 이 아파트가 실제로 살기에 얼마나 좋은지에 대한 객관적 데이터 기반 평가"**(후보 B)

10. CORE factors = 교통(subway/bus), 생활(의료/편의/공원), 교육(초등거리 지금 즉시 + 통학구역 등 병합 후), 단지(연식/세대수/주차), 환경(해변, LIMITED)
11. separate-index factors = 시장성(거래량/가격/전고점), 투자매력도(공급/미분양 등, 데이터 부족), 재건축/미래(stage는 있으나 join 없음)
12. personalized factors = 개인화 출퇴근(미구현, 로드맵)
13. display-only factors = bus 노선번호/유형(TAGO 라이브), KTX(신뢰도 문제)
14. future factors = FAR/BCR, 경사/소음/침수/혐오시설, 전통시장/문화시설/도서관 등 Kakao 미수집 항목, 브랜드(신뢰 가능한 소스 확보 시)

15. absolute factors = subway/bus 거리·count, elementary 거리·count, parking ratio, buildYear, households, 해변거리
16. relative factors = 신축 희소성, 가격의 지역 비교(별도 index)
17. hybrid factors = living count류(절대 개수 + log1p 밀도 해석 병행)

18. Model A = 4-domain Core(Transport/Living/Education/Complex), 안전하지만 Environment 확장에 재구조화 필요
19. Model B = 5-domain Core(+Environment, 현재 해변 단일 factor로 얇음)
20. Model C = Core(A or B) + Market/Investment/Child-Friendly/Personalized-Commute/Reconstruction 별도 index

21. RECOMMENDED_ARCHITECTURE = **Model B + Model C 결합**(5-domain Core + 5개 별도 index, §18)

22. Core domains = Transport, Living, Education, Complex, Environment(LIMITED)

23. Transport design = SUBWAY_ACCESS + BUS_ACCESS, BUSAN 절대 curve 중심, station-center 한계 명시, 환승/노선가치/업무지구접근/개인화통근 전부 Core 제외
24. Complex design = AGE_QUALITY(밴드 curve) + SCALE(포화 curve) + PARKING(절대+동시대 context)
25. Parking treatment = 별도 domain화하지 않고 Complex 내부 factor 유지, coverage 25.3% 신뢰도 배지 필수
26. Education design = "교육 접근 환경"(학업 수준 아님), 초등거리 즉시 Core, 통학구역/중학군/유치원/고교는 병합 후 Core 승격 후보
27. Life design = 단일 "생활 편의" 도메인 + MEDICAL/DAILY_CONVENIENCE/PARK_LEISURE 내부 라벨(SHOPPING/CULTURE는 데이터 없어 승격 보류)
28. Environment design = 해변 거리만으로 우선 출시(LIMITED 명시), 경사/소음/침수는 FUTURE 최우선 acquisition 후보

29. Market treatment = 별도 index, Core와 절대 혼합 금지
30. Investment treatment = 별도 index, 데이터 부족으로 V2 Core와 동시 출시 불필요
31. Future/redevelopment treatment = 별도 index, stage 데이터는 있으나 아파트 join 부재로 현재 실질 미가동
32. Child-friendly treatment = 별도 index, 기존 factor 재조합이라 저비용 후속 가능
33. personalized commute treatment = 로드맵 유지, 코드 없음 확인됨

34. age treatment = 절대 밴드 curve, "신축=무조건 좋음" 금지, 재건축잠재력은 별도 index로 분리
35. households/scale treatment = 절대 포화 curve, 선형 비교 금지
36. FAR/BCR treatment = ApartmentMaster 0% coverage라 이번 V2 Core 제외(FUTURE), 쾌적성/재건축 의미 분리 필요성만 기록
37. brand treatment = 기축 아파트 데이터 전무 → EXCLUDE

38. missing data strategy = 지금은 C(coverage badge), STEP2에서 B(bounded redistribution)+D(confidence-adjusted) 수치화
39. confidence strategy = identity/coordinate quality(STEP0.6 재사용) + domain coverage + source freshness, formula 미정
40. explainability contract = {score, grade, rawFacts, strengths, weaknesses, absoluteLevel, relativeContext, coverage, confidence, source, sourceDate}

41. relative percentile role = C(지역 내 위치 "표시"만), Core 입력에서 배제
42. comparison population policy = 절대형 factor는 BUSAN(1차)/SIGUNGU(보조), LOCAL(법정동)은 Core 입력 금지, 주차만 SIMILAR_AGE 추가 병기, 가격(별도 index)만 SIGUNGU/SIMILAR_SIZE 중요

43. 대신해모 qualitative result = Transport STRONG, Complex age STRONG, Scale STRONG, Parking WEAK(1.09대), Education WEAK-ish(545m, 그러나 협성보다 절대적으로 열위), Living WEAK-ish
44. 협성 qualitative result = Transport AVERAGE(절대 306m/서구41위, LOCAL 상대점수는 신뢰 안 함), Complex age WEAK(2001), Parking STRONG(1.58대), Education 절대적으론 STRONG(341m, 대신해모보다 204m 가까움)이나 V1 relative score는 오히려 더 낮은 역전 확인
45. 구덕금호 handling = identity/coord DISPLAY_ONLY 이하 단지는 Core 종합점수 자체 미계산(NOT_ENOUGH_DATA), raw fact만 참고 표시, registry-use-type 불일치 검사를 STEP2 후보로 제안

46. benchmark count = 28개(STEP0.8과 동일, 확대는 STEP2/§35로 이월)
47. expert credibility gate = STEP0.8 8개 항목을 그대로 release gate로 채택(§22 표)
48. monotonic guards = subway/parking 절대순서 보장(LOCAL percentile 배제로 구조적 해결), LOW confidence가 HIGH로 나오지 않도록 설계

49. compare UX proposal = raw fact 병기 A/B 비교표(§28), purpose-specific 결과는 Child-Friendly index 완성 후

50. V1 handling recommendation = trust C(HIDE/DEEMPHASIZE) 유지, Beta 유지, 콘텐츠/추천 입력 확대 금지, 코드 변경은 이번 STEP에서 하지 않음

51. STEP2 required distribution analyses = 9개 목록(§30)

52. production Score changed? = NO
53. DB write? = NO
54. migration? = NO
55. API changed? = NO
56. UI changed? = NO

57. tests if any = 없음(코드 변경 없음)
58. tsc = 대상 없음(변경된 소스 없음)
59. lint = 대상 없음
60. docs = 본 문서(`docs/development/EJIP_SCORE_V2_STEP1_ARCHITECTURE.md`)
61. commit = 진행 예정(docs only)
62. push = 진행 예정
63. worktree clean = 진행 예정(커밋 후 확인)

64. BLOCKER = 없음(어린이집 API 키 신청은 사용자 승인이 필요한 별도 결정 사항으로 남겨두었을 뿐, 이번 STEP 진행을 막지 않음)

65. SCORE_V2_STEP1_CLOSE = YES
66. SCORE_V2_ARCHITECTURE_READY = YES
67. SCORE_V2_STEP2_READY = YES(단, School V2 branch 병합은 STEP2 착수 전 권장 선행 작업)

68. NEXT_RECOMMENDATION = STEP2에서 §30의 9개 분포분석을 먼저 수행해 절대 curve/threshold 수치를 설계하고, 병행해서 School V2 branch 병합(위험 낮음, Education Core를 즉시 완성시킴)과 Child-Friendly index 설계(저비용)를 우선순위로 진행할 것을 권고한다.
