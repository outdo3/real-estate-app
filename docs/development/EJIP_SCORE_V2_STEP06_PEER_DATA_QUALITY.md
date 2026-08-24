# E-JIP SCORE V2 — STEP 0.6: Peer Data Quality & Eligibility Model

- 작성일: 2026-08-23
- Worktree/Branch: `score-v2-step0-forensic-audit`(STEP 0/0.5와 동일 branch,
  직접 연속 조사 — 별도 branch 신설 지시 없었음)
- 성격: **DATA QUALITY MODEL DESIGN.** Score formula 변경 아님. production
  score 코드 0줄 수정, DB write 0건, migration 0건, 기존 Score overwrite 없음,
  임의 데이터 삭제 없음, main merge 없음.

## 0. Root cause recap (STEP 0.5)

STEP 0.5는 "대신해모로센트럴보다 지하철이 가깝다고 판정된 peer 7곳"을
전수 추적해 **거리 계산 자체는 완벽히 정확**(Haversine 재계산 delta
0~1m)하지만, 그 7곳 전부가 **건축물대장 미연결 + 주소 없음 + (5곳은)
이름 키워드 geocoding**이라는 사실을 확정했다. 부산 전체로 확대하면
ApartmentMaster 3,401건 중 **1,725건(50.7%)**이 이 "고위험 조합"에
해당 — 국지적 사례가 아니라 구조적 문제였다. 이번 STEP은 이 발견에
대한 직접 처방: **"어떤 ApartmentMaster row가 다른 row의 peer가 될
자격이 있는가"를 실제 evidence만으로 정의**한다.

---

## 1. ApartmentMaster quality field inventory

| field | 분류 | 비고 |
|---|---|---|
| aptSeq | AVAILABLE | 100%(쿼리 필터 조건 자체) |
| canonical name/normalizedName | AVAILABLE | 100% |
| lawdCd(sggCd) | AVAILABLE | 100% |
| dong(umdName) | AVAILABLE | 대부분 100%에 근접(별도 미확인율 미측정, 이번 STEP 범위 아님) |
| jibun | AVAILABLE | umdCd/jibun 인덱스 존재, coverage 별도 미측정 |
| road address | PARTIAL | 1,389/3,402(40.8%) — mgmBldrgstPk 확보분과 유사 규모 |
| latitude/longitude | AVAILABLE(대부분) | 3,401/3,402(99.97%, STEP 0.5/BUSAN SCORE V1.1 확인) |
| coordinate source | AVAILABLE(간접) | `geocodeQuality`만 저장('exact'/'normalized'/'failed'), 진짜 좌표 provider명은 없음(Kakao 단일 소스라 불필요) |
| coordinate recovery source | PARTIAL | `recover-missing-geocodes.ts`(STEP 0-이전 STEP)가 채운 334건은 별도 플래그 없이 geocodeQuality로만 남음(recovery 이력 자체는 CHANGELOG 문서에만 존재, DB 컬럼 아님) |
| registry/building ledger link | PARTIAL | `mgmBldrgstPk` 1,389/3,402(40.8%) |
| households | PARTIAL | `totalHouseholds` 1,309/3,402(38.5%) |
| buildings(동수) | PARTIAL | `mainBuildingCount`, households와 거의 동일 coverage로 추정(별도 미측정, STEP 0의 "15~34%" 서술과 정합) |
| builtYear | **AVAILABLE(100%)** | MOLIT 원본 필드라 registry 연결과 무관하게 항상 존재(이번 STEP 신규 확인, §1-2) |
| parking | PARTIAL | `parkingCount`, households와 유사 규모(registry 총괄표제부 값) |
| FAR(용적률) | **NOT_AVAILABLE**(이 스키마) | ApartmentMaster에 컬럼 자체 없음. `apt-building-info.ts`(별도 기능, 건축물대장 실시간 조회)에는 존재 — Score 파이프라인에 조인 안 됨(STEP 0 §13 재확인) |
| BCR(건폐율) | NOT_AVAILABLE(이 스키마) | 위와 동일 |
| transaction history | **NOT_AVAILABLE(TradeHistory 테이블)** — **정정** | `TradeHistory` 모델은 존재하나 실측 결과 전체 0 rows(§1-1 참고, DB 전역 미사용). 실제 거래 evidence는 `ApartmentMarketFeature.transactionCount12m`(aptSeq 정확 join, MOLIT 원본)을 대신 사용 |
| transaction count | AVAILABLE | `ApartmentMarketFeature.transactionCount12m`, 3,402건 중 시장 evidence 있음(§6) |
| latest transaction date | AVAILABLE | `ApartmentMarketFeature.latestTradeDate` |
| presale identity | **NOT_AVAILABLE** | `Presale` 모델에 aptSeq 등 ApartmentMaster 조인 키 없음(schema 확인) |
| redevelopment identity | **NOT_AVAILABLE** | `RedevelopmentProject`도 동일(조인 키 없음) |
| source provenance | PARTIAL | `ApartmentLocationFeature.source`(kakao_local_api)/`ApartmentMarketFeature.source`(molit)는 있으나 `ApartmentMaster` 자체에는 "이 row가 MOLIT 거래에서 왔는지 건축물대장에서 왔는지" 구분 플래그 없음 |

### 1-1. 중요 정정: TradeHistory 테이블은 전역 0 rows

STEP 0.5가 "STEP 0.5 peer 7곳 TradeHistory 매칭 0건"이라 보고한 것은
**사실이었지만 무의미한 체크였다** — `TradeHistory` 테이블 자체가 이
프로젝트 DB에 **전체 0 rows**임을 이번 STEP에서 처음 확인했다(이
모델은 스키마에는 존재하나 실제로 채워지는 곳이 없는 것으로 보임,
이번 STEP 범위에서 원인까지는 조사하지 않음). 이번 STEP부터는 aptSeq로
정확히 조인되는 `ApartmentMarketFeature.transactionCount12m`(이미
`market.ts`가 쓰는 값)을 시장 evidence로 사용한다 — 이름 매칭 리스크
자체가 없는 더 안전한 source다.

### 1-2. 신규 확인: buildYear는 registry와 독립적으로 100% 존재

```
buildYear 존재: 3,402/3,402(100%)
buildYear 존재 AND registry(totalHouseholds) 없음: 2,093건
```

`buildYear`는 MOLIT 거래 데이터 자체에 포함된 필드라, 건축물대장 연결
여부와 무관하게 항상 채워진다(STEP 0 §3의 "complex coverage 100%"
서술의 정확한 근거를 이번 STEP에서 재확인). 이는 §8 domain eligibility
설계에서 complex 카테고리를 다른 domain과 다르게 취급하는 근거가 된다.

### 1-3. registryAttempted vs registryLinked 구분(신규)

```
mgmBldrgstPk(registry 연결 시도됨) 존재: 1,389건
그중 totalHouseholds(household 추출 성공) 있음: 1,309건
mgmBldrgstPk 있는데 totalHouseholds 없음: 80건
```

이 80건은 "registry 연결은 됐지만 세대수 추출에 실패한" 그룹으로,
§19 복구 후보 분류에서 별도로 다룬다(단, 실측 결과 이 80건은 §2의
"고위험 1,725건"과 겹치지 않음 — 이미 mgmBldrgstPk가 있다는 것 자체가
최소한 주소가 있었다는 뜻이라 "주소 없음" 조건에서 빠짐, §19-1).

---

## 2. STEP 0.5 고위험 1,725건 재현(정확한 조건)

`scripts/apartment-score/step06-01-busan-classify.ts` 실행 — 조건을
코드로 명시하고 재현:

```ts
highRisk = geocodeQuality === 'normalized'   // COORD_LOW
        && roadAddress == null && jibunAddress == null   // 주소 없음
        && totalHouseholds == null                          // registry 미연결
```

```
개별 조건(각자 전체 3,402건 대비, union 아님):
  registryUnlinked(totalHouseholds null)     2,093건(61.5%)
  addressMissing(road+jibun 둘 다 null)      2,013건(59.2%)
  normalizedGeocode(COORD_LOW)               1,734건(51.0%)
  coordUnresolved                                1건(0.0%)
  zeroMarketEvidence(transactionCount12m=0)    465건(13.7%)

3개 조건 AND(정확한 재현): 1,725건(50.7%) — STEP 0.5와 정확히 일치
unique aptSeq count: 1,725(중복 0건)
```

---

## 3. Apartment Identity Quality 설계

`scripts/apartment-score/lib/peer-quality.ts:classifyIdentity()`.
**"이름이 존재한다"만으로 HIGH를 주지 않는다** — registry 연결
(household 확보)과 실제 주소 존재를 **독립된 두 증거**로 취급한다.

```
IDENTITY_HIGH       registryLinked(totalHouseholds 확보) AND hasAddress
IDENTITY_MEDIUM      registryLinked XOR hasAddress(독립 증거 1개만 있음)
IDENTITY_LOW         registry도 주소도 없으나 transactionCount12m >= 1
                      (적어도 이 이름으로 실제 MOLIT 거래가 발생했다는 최소 근거)
IDENTITY_UNRESOLVED  위 어느 것도 없음 — row는 있으나 독립 증거가 전혀 없음
```

부산 실측 분포(§11):

```
IDENTITY_HIGH        1,309건(38.5%)
IDENTITY_MEDIUM          80건(2.4%)
IDENTITY_LOW          1,611건(47.4%)  ← 최대 비중, "거래는 있으나 registry/주소 없음"
IDENTITY_UNRESOLVED     402건(11.8%)
```

---

## 4. Coordinate Quality 설계

**스키마 한계를 먼저 명시**: `ApartmentMaster.geocodeQuality`는
`'exact'|'normalized'|'failed'` **3단계만** 저장한다
(`apartment_master_seed.ts:geocode()` 확인 — road/jibun 주소가 있으면
`'exact'`, 없거나 실패하면 `"{동} {건물명}"` 키워드 검색으로
`'normalized'`, 전부 실패하면 `'failed'`). 지시사항 §4의 A~F 후보 중
**"C. normalized-address geocode"(주소 자체를 정규화해 재시도)는 이
프로젝트에 별도로 존재하지 않는다** — 임의로 중간 단계를 만들어내지
않고 "존재하지 않음"으로 명시한다. 마찬가지로 `COORD_MEDIUM`도
도입하지 않았다(근거 없는 정밀도를 만드는 것을 피함).

```
A/B(official/full-address geocode)  = geocodeQuality='exact'      → COORD_HIGH
C(normalized-address geocode)        = 이 스키마에 없음(도입 안 함)
D(dong+building name keyword)        = geocodeQuality='normalized'  → COORD_LOW
E(manual/fallback)                   = 이 프로젝트에 수동 오버라이드 메커니즘 없음(NOT_AVAILABLE)
F(missing)                           = geocodeQuality='failed' 또는 좌표 null → COORD_UNRESOLVED
```

부산 실측 분포:

```
COORD_HIGH        1,667건(49.0%)
COORD_LOW         1,734건(51.0%)  ← STEP 0.5가 실제 오염원으로 확정한 그룹
COORD_UNRESOLVED      1건(0.0%)
```

**"동+건물명 키워드" 좌표(D, COORD_LOW)를 peer distance ranking에
쓸 수 있는가 — 엄격 평가 결과: 아니다.** STEP 0.5가 이미 실측으로
확정한 대로, 이 방식은 동명 건물 오매칭 위험이 구조적으로 존재하고
(이 프로젝트에 이미 기록된 "스카이맨션→경기도 부천시" 오매칭 선례),
실제로 대신해모로 사례의 peer 오염원 5/7건이 정확히 이 그룹이었다 —
**이번 STEP의 peer eligibility 설계에서 COORD_LOW는 무조건 다른
단지의 peer 모집단에서 제외**한다(§7).

---

## 5. Registry Quality

```
registryLinked(totalHouseholds 확보)     1,309건(38.5%)
registryAttempted(mgmBldrgstPk 존재)      1,389건(40.8%)
  attempted이나 households 미확보           80건(§1-3, §19 복구 후보 B)
builtYear known                          3,402건(100%, §1-2)
parkingCount known                       households와 유사 규모(총괄표제부 동시 확보)
FAR/BCR known                              0건(이 스키마 자체에 없음, §1)
```

**registry가 없다고 아파트 존재 자체를 부정하지 않는다** — identity
분류(§3)에서 registry 미연결이어도 주소나 거래이력이 있으면 MEDIUM/LOW로
남기고 UNRESOLVED로 떨어뜨리지 않는다. 다만 peer eligibility(§7)의
parking/complex처럼 **registry 값 자체가 계산에 필요한 domain**에서는
registry 미연결이 곧 "이 domain에 한해 peer 자격 없음"으로 직결된다
— identity 부정과 domain-specific 자격 제한은 별개 판단이다.

---

## 6. Market Evidence Quality

`ApartmentMarketFeature.transactionCount12m` 기준, 기존 `market.ts`의
`MIN_TRANSACTION_SAMPLE=3` threshold를 그대로 재사용(새 기준을 만들지
않음 — 이미 검증된 기존 값과의 일관성 유지):

```
STRONG(>=3건)   1,766건(51.9%)
WEAK(1~2건)     1,171건(34.4%)
ZERO(0건)         465건(13.7%)
```

**주의(지시사항 그대로 준수)**: 거래가 0건(ZERO)인 것이 "가짜 단지"를
의미하지 않는다 — market evidence는 identity 판정의 **한 요소**(§3의
LOW 등급 조건 중 하나)일 뿐, 단독으로 아파트 존재 여부를 판정하지
않는다. identity와 market evidence를 혼합하지 않는다는 지시사항 원칙을
`classifyIdentity()` 함수 설계에 그대로 반영했다(registry/주소가 있으면
market evidence와 무관하게 HIGH/MEDIUM이 나옴).

---

## 7. Peer Eligibility 설계

`classifyPeerEligibility(identity, coord)` — **단순 "registry linked
=eligible" 1조건 방식을 쓰지 않는다.** identity와 coordinate 두 축을
조합한다:

```
PEER_FULL      COORD_HIGH AND IDENTITY_HIGH
               → 다른 아파트의 점수 산정 peer로 안전(모든 domain)

PEER_LIMITED   COORD_HIGH AND (IDENTITY_MEDIUM 또는 LOW)
               → 좌표는 신뢰 가능하나 registry가 없어 일부 domain(parking/complex의
                 registry 의존 부분)에서는 peer 사용 불가 — §8

DISPLAY_ONLY   COORD_LOW(identity 무관)
               → 사용자에게 이 단지 자체를 보여줄 수는 있으나(§17), 다른 단지의
                 percentile 모집단에는 사용 금지(STEP 0.5가 실제 오염원으로 확정)

UNRESOLVED     COORD_UNRESOLVED
               → identity/coordinate 신뢰 부족, 위치 자체를 특정할 수 없어
                 표시조차 위험
```

**설계 근거**: coordinate가 나쁘면(COORD_LOW) identity가 아무리 좋아도
"어디에 있는지"를 못 믿으므로 peer로 못 쓴다(위치 기반 domain이
대부분이므로 coordinate가 gating factor). identity가 나쁘더라도
coordinate가 정확하면(COORD_HIGH) "실제로 그 좌표에 무언가 있다"는
사실 자체는 믿을 수 있어 완전 배제하지 않고 PEER_LIMITED로 격하한다.

부산 실측 분포(§11):

```
PEER_FULL        1,301건(38.2%)
PEER_LIMITED       366건(10.8%)
DISPLAY_ONLY      1,734건(51.0%)
UNRESOLVED            1건(0.0%)
```

---

## 8. Domain-specific eligibility

모든 domain에 동일 필터를 쓰지 않는다 — coordinate 기반 domain과
registry 기반 domain을 구분한다:

```
transportPeerEligible = COORD_HIGH               (좌표 기반 Kakao/TAGO 거리 조회, registry 무관)
livePeerEligible      = COORD_HIGH                (동일 — Kakao count류)
schoolPeerEligible    = COORD_HIGH                (동일)
parkingPeerEligible   = parkingCount != null AND totalHouseholds != null AND totalHouseholds > 0
                         (coordinate 무관, registry 완전성이 전부)
complexPeerEligible   = buildYear != null AND identity !== 'IDENTITY_UNRESOLVED'
                         (buildYear는 100% 있으나, 완전히 근거 없는 row가 buildYear
                          하나로 다른 단지 순위를 흔드는 것은 방지)
```

부산 실측:

```
transportPeerEligible  1,667건(= COORD_HIGH 전체와 정확히 일치)
livePeerEligible       1,667건
schoolPeerEligible     1,667건
parkingPeerEligible      862건(25.3%)
complexPeerEligible    3,000건(= 3,402 - IDENTITY_UNRESOLVED 402)
```

parking이 transport(1,667건)보다도 훨씬 적은 862건인 이유: coordinate와
무관하게 registry(household+parkingCount 동시 확보)가 전부이기
때문 — STEP 0의 "parking coverage 25.3%" 서술과 정확히 일치한다.

---

## 9-10. Transport peer 재분석 simulation(read-only, production 미변경)

`scripts/apartment-score/step06-02-benchmark-simulation.ts` 실행 —
기존 LOCAL peer(같은 동, subway distance 보유) vs
`transportPeerEligible`(COORD_HIGH)로 필터링한 결과 비교:

### 대신해모로센트럴

```
기존 peer count 19 → 필터링 후 7(COORD_HIGH만)
기존 순위 8/19 → 필터링 후 순위 4/7

필터링 후 TOP: 61m(서대신엔스타,PEER_LIMITED) / 78m(한우리빌리지5차,PEER_LIMITED) /
128m(대진골든빌리지,PEER_LIMITED) / 140m(대신해모로,PEER_FULL) / ...

제외된 4건(전부 대신해모로보다 가까웠던 기존 peer, 전부 COORD_LOW=DISPLAY_ONLY):
  38m 희망센츄럴타운, 65m 위너스빌, 108m (76-0), 116m 경남
```

**PEER_FULL(등록 확인된 실제 대단지)만 놓고 보면, 대신해모로는 자신의
동(서대신동2가)에서 가장 가까운 등록 대단지다** — 유일한 다른
PEER_FULL 경쟁자는 212m의 대신푸르지오2차뿐이고, 대신해모로(140m)가
더 가깝다. 4개의 PEER_LIMITED(등록은 안 됐지만 좌표는 정확한 소규모
건물)에는 여전히 순위상 밀리지만, 이는 §7에서 설계한 대로 "완전
배제"가 아니라 "제한적 peer" 상태로 남아 있는 정상 동작이다.

### 협성르네상스(서구)

```
기존 peer count 27 → 필터링 후 10
기존 순위 2/27 → 필터링 후 순위 **1/10**

제외된 1건: 297m 대윤스위트(COORD_LOW)
```

필터링 후 협성은 자신의 동에서 **좌표 신뢰 가능한 peer 중 지하철
최근접 1위**가 된다 — 오염원이 대신해모로 쪽 동에 집중돼 있었고
협성 쪽은 상대적으로 깨끗했음을 재확인.

### 구덕금호(신규 발견 — 중요)

```
기존 peer count 8 → 필터링 후 1
기존 순위 5/8 → 필터링 후 0/1(대상 자신이 목록에서 빠짐)
대상 자신: coord=COORD_LOW identity=IDENTITY_LOW peerEligibility=DISPLAY_ONLY
```

**구덕금호 자기 자신의 좌표가 `geocodeQuality='normalized'`(COORD_LOW)다**
— STEP 0에서 3개 benchmark 중 하나로 고정했던 이 단지 자체가, 이번
품질 모델 기준으로는 **다른 단지의 peer로 쓸 수 없을 뿐 아니라, 자기
자신의 transport 원본 데이터 신뢰도도 낮다**는 새로운 사실이 드러났다.
이는 숨기지 않고 §22-23(benchmark acceptance)에서 정직하게 기록한다.

---

## 11. Busan-wide coverage impact

```
Apartment 총계(aptSeq 확보)     3,402
IDENTITY  HIGH 1,309(38.5%) / MEDIUM 80(2.4%) / LOW 1,611(47.4%) / UNRESOLVED 402(11.8%)
COORD     HIGH 1,667(49.0%) / LOW 1,734(51.0%) / UNRESOLVED 1(0.0%)
PEER_ELIGIBILITY  FULL 1,301(38.2%) / LIMITED 366(10.8%) / DISPLAY_ONLY 1,734(51.0%) / UNRESOLVED 1(0.0%)
```

## 12. 구·군별 coverage

`scripts/apartment-score/step06-01-busan-classify.ts` 실행(§11 표 그대로,
16개 구·군 전수):

| 구·군 | total | PEER_FULL | PEER_LIMITED | DISPLAY_ONLY | UNRESOLVED |
|---|---|---|---|---|---|
| 강서구 | 44 | 33(75%) | 4(9%) | 6(14%) | 1(2%) |
| 금정구 | 308 | 89(29%) | 24(8%) | 195(63%) | 0 |
| 기장군 | 152 | 61(40%) | 16(11%) | 75(49%) | 0 |
| 남구 | 253 | 121(48%) | 29(11%) | 103(41%) | 0 |
| 동구 | 99 | 22(22%) | 10(10%) | 67(68%) | 0 |
| 동래구 | 314 | 142(45%) | 24(8%) | 148(47%) | 0 |
| 부산진구 | 404 | 142(35%) | 56(14%) | 206(51%) | 0 |
| 북구 | 173 | 114(66%) | 8(5%) | 51(29%) | 0 |
| 사상구 | 151 | 42(28%) | 17(11%) | 92(61%) | 0 |
| 사하구 | 338 | 150(44%) | 42(12%) | 146(43%) | 0 |
| **서구** | 171 | **27(16%)** | 16(9%) | 128(75%) | 0 |
| 수영구 | 251 | 77(31%) | 31(12%) | 143(57%) | 0 |
| 연제구 | 244 | 111(45%) | 24(10%) | 109(45%) | 0 |
| 영도구 | 133 | 62(47%) | 15(11%) | 56(42%) | 0 |
| **중구** | 59 | **5(8%)** | 6(10%) | 48(81%) | 0 |
| 해운대구 | 308 | 103(33%) | 44(14%) | 161(52%) | 0 |

**PEER_FULL 비율이 8.5%(중구)~75.0%(강서구)로 8.8배 차이** — 특정
구가 과도하게 탈락하는 것을 확인했다. **중구/서구가 최하위권**(각각
8%/16%)인 것은 구 도심의 오래된 소규모 건물 비중이 높아 등록
데이터가 상대적으로 얇기 때문으로 추정되나(추정임을 명시), **강서구가
75%로 최상위**인 것은 최근 개발된 대규모 택지지구(신축 등록 대단지
비중 높음)일 가능성이 있다(둘 다 이번 STEP에서 원인을 확정하지는
않음, 결과만 정직하게 기록).

---

## 13. sample-size 문제 분석

`scripts/apartment-score/step06-03-sample-size-analysis.ts` — 149개
동(umdName) 단위:

```
transport(coordinate 기반) eligible count/동:  n<5=69(46.3%) n<10=89(59.7%) n<20=117(78.5%) n>=20=32
parking(registry 기반) eligible count/동:      n<5=91(61.1%) n<10=116(77.9%) n<20=139(93.3%) n>=20=10
complex(buildYear 기반) eligible count/동:     n<5=53(35.6%) n<10=72(48.3%) n<20=91(61.1%) n>=20=58
```

**품질 필터링 후 동(dong) 단위 LOCAL peer는 절반 가까이(transport
46.3%, parking 61.1%)가 n<5로 붕괴한다** — STEP 0.5가 발견한 "parking
n=5~8" 문제가 필터링 후에는 오히려 **더 흔한 정상 상태**가 될 위험이
있다는 뜻이다.

16개 구·군(sigungu) 단위:

```
transport eligible count/구: n<5=0 n<10=0 n<20=1 n>=20=15  (최소 11건, 훨씬 건강)
parking eligible count/구:   n<5=1 n<10=1 n<20=2 n>=20=14  (최소 3건 — 중구, 여전히 위험)
```

**sigungu 단위로 올리면 transport는 16개 구 중 15개가 n>=20으로
안정화**되지만, **parking은 sigungu 단위로도 중구가 3건에 불과**해
구제되지 않는다.

### parking decade-band 세부(기존 방식 재현)

```
서구:   sigungu 전체 26건 → decade별 2/3/5/8/8(모든 decade가 5 미만이거나 근접)
동래구: sigungu 전체 83건 → decade별 3/11/22/31/16(1980년대만 위험)
해운대구: sigungu 전체 97건 → decade별 1/21/33/32/10(1980년대만 위험)
부산진구: sigungu 전체 92건 → decade별 10/31/22/29(전 decade 건강)
중구:   sigungu 전체 3건 → decade별 1/2(사실상 계산 불가)
```

**작은 구(서구/중구)일수록 parking의 decade-band narrowing이 표본을
치명적으로 줄인다** — 큰 구(부산진구/동래구/해운대구)는 대체로
건강하다. 이는 STEP 0.5가 지적한 문제가 서구에 특히 집중된 이유를
정량적으로 뒷받침한다.

---

## 14. peer fallback architecture(proposal only)

현재(STEP 0 확인) 구조: `LOCAL(동 또는 구+연대) → SIGUNGU → REGION_WIDE`.
REGION_WIDE는 실제로 SIGUNGU와 동일(§1-8, 기존 known limitation).

**§13 실측 근거로 본 재검토**:
- **DONG-level LOCAL을 품질 필터링 후에도 "1차 시도"로 유지하는 것
  자체는 문제 없다**(현재도 실패 시 자동으로 SIGUNGU 재시도, §1 코드
  구조 그대로) — 다만 **필터링 후 DONG에서 성공하는 비율이 종전보다
  낮아지므로(46~61%가 n<5), SIGUNGU 재시도가 지금보다 훨씬 자주
  발생할 것으로 예상**된다. 이건 기존 fallback 메커니즘이 원래
  하도록 설계된 일이라 구조 자체를 바꿀 필요는 없다는 결론이다.
- **parking의 "sigungu+decade band"는 재검토가 필요하다** — 중구처럼
  sigungu 단위로도 3건뿐인 경우, decade band를 유지하는 한 fallback을
  아무리 반복해도 구제되지 않는다(§25 gate 미충족 항목). proposal(향후
  별도 승인 필요, 이번 STEP에서 구현하지 않음): decade band를 정확한
  10년 단위 대신 **더 넓은 구간(예: ~1999/2000년대/2010년대/2020년대
  4구간)**으로 완화하는 안을 검토 가치가 있다 — §13 실측상 넓은
  구간이면 대부분 구에서 표본이 개선될 것으로 예상되나, 정확한 검증은
  이번 STEP 범위 밖.

---

## 15. minimum peer sample 추천(simulation 기반)

현재 `PEER_SAMPLE_MEDIUM=5`가 계산 최소선이다 — STEP 0.5가 지적한
"n=5~8 극단 민감도" 문제의 직접 원인이기도 하다. 후보별 평가:

```
10  §13 실측상 sigungu 단위 transport는 16개 구 중 15개가 이미 n>=20이라
    n>=10 기준을 대부분 만족 — 상향 여유 있음. parking은 sigungu 단위로도
    2개 구가 미달(중구 3건, 다른 1개 구 미상세 확인).
20  transport는 sigungu 단위로 거의 전부 만족(15/16). parking은 다수 구가
    미달할 것으로 예상(§13 decade-band 세부 참고, 서구도 decade별로는
    2~8건뿐).
30/50  이번 STEP 실측 범위에서 부산 sigungu 단위로는 대부분 domain에서
    비현실적(가장 큰 구도 100건대 초반, decade/dong으로 쪼개면 30~50은
    parking·dong 단위 LOCAL 자체를 사실상 무력화).
```

**추천: 10** — transport/complex/school/life는 sigungu 레벨에서 대부분
쉽게 달성 가능해 안전 마진이 있고, 5→10으로 올리는 것만으로도 STEP
0.5류의 "n=5~8 극단 사례"를 상당수 자동으로 SIGUNGU/추가 fallback으로
밀어낼 수 있다. **parking은 10으로도 일부 소규모 구(중구 등)에서
미달이 발생할 것으로 예상**되므로, §14의 decade-band 완화 proposal과
함께 검토해야 완전히 해소된다 — parking 단독으로 숫자만 올리는 것은
불충분하다.

---

## 16. relative percentile future rule

**권장: YES(반증 없는 한) — percentile용 peer도 quality-filtered
universe만 사용한다.** 이번 STEP의 모든 실측(§9/§10/§13)이 오염된
peer가 결과를 왜곡시킨다는 것을 일관되게 보여줬고, 반대로 filtered
universe만으로도(§9 협성 사례) 합리적인 순위가 나온다는 것을
확인했다 — quality 필터를 relative percentile에 적용하지 않을 근거를
이번 STEP에서 찾지 못했다.

---

## 17. raw fact display eligibility(semantics proposal)

peer에 못 쓴다고 사용자에게 숨길 필요는 없다는 지시사항 원칙을 그대로
받아 tier별 표시 semantics를 제안한다(구현은 이번 STEP 범위 밖):

```
COORD_HIGH(PEER_FULL/PEER_LIMITED)  → DISPLAY_EXACT
  "지하철 약 140m" — 좌표 신뢰 가능, 정확한 수치로 표시 가능.

COORD_LOW(DISPLAY_ONLY)             → DISPLAY_APPROXIMATE
  "지하철 약 OOm(단지 위치 확인 중)" 또는 물음표/근사 아이콘 병기 —
  정확해 보이는 숫자를 그대로 노출하면 위험하다는 지시사항 §17 원칙
  그대로. 정확한 문구는 UI 설계 단계에서 결정.

COORD_UNRESOLVED(UNRESOLVED)        → DISPLAY_NOT_AVAILABLE
  "위치 정보 확인 중" — 좌표 자체가 없어 어떤 수치도 노출하지 않음.
```

---

## 18. Score confidence 연결(proposal only, formula 미확정)

향후 Score V2의 `confidence`(현재 coverage 기반, STEP 0 §1-6)에
이번 STEP의 quality axes를 어떻게 반영할지 방향만 제안:

```
현재(V1): confidence = coverage(카테고리 weight 합) + peerTier(HIGH/MEDIUM/NOT_SCORED, 표본 크기)

제안(V2, 숫자 미확정): confidence 산정에 "대상 단지 자신의 identity/coord quality"를
  추가 축으로 고려 — 예컨대 대상 자신이 COORD_LOW/DISPLAY_ONLY이면(§10 구덕금호
  실측 사례) 그 단지의 Score 자체를 confidence 하향 조정하거나 §17처럼 별도
  DISPLAY_NOT_AVAILABLE 취급하는 방안. 또한 "peer 모집단 중 PEER_FULL 비율"을
  현재 peerTier(단순 표본 크기)에 더해 "표본 신뢰도"로 반영하는 방안도 후보.
  구체적 임계치/가중치는 이번 STEP에서 결정하지 않는다(formula 변경 금지 원칙).
```

---

## 19. 저신뢰 데이터 복구 후보 분류

`scripts/apartment-score/step06-04-recovery-and-universe.ts` — 고위험
1,725건(§2) 재분류:

```
B. registry identity resolver 가능(mgmBldrgstPk 연결됨, household 미추출)  0건
   — §1-3에서 확인한 80건은 이미 주소가 있어(mgmBldrgstPk 연결의 전제) 이
     1,725건(주소 없음이 조건)과 애초에 겹치지 않는다. 즉 80건은 1,725건과
     완전히 별개의 "더 쉬운" 복구 후보 그룹으로 남는다(§1-3 참고).

C. MOLIT 거래이력(최근12개월)으로 identity 강화 가능                    1,398건(81.0%)
   — 압도적 다수. registry/주소가 없어도 최근 실거래가 있다는 것은 최소한
     "이 이름의 무언가가 실제로 거래됐다"는 근거이므로, 향후 거래 주소 필드
     등을 활용한 identity 강화 가능성이 있다(구체 방법은 이번 STEP 설계 범위 밖).

D/E. registry·주소·거래이력 전부 없음(재시도 근거 자체가 없음)            0건
     (조건상 이 그룹은 §2 highRisk 정의와 겹치지 않게 분리됨 — 실제로는
     아래 "분류 안 된 나머지"에 흡수됨, 재정의 필요성 인지하되 이번 STEP은
     발견된 그대로 정직하게 기록)

분류 안 된 나머지(등록 이력조차 전혀 없는 최종 잔여군)                    327건(19.0%)
   — manual review 대상. "F. likely non-target housing entity"로 단정하지
     않는다(§20 원칙과 동일 이유 — 확인 불가능한 것을 추정하지 않음).

합계: 0 + 1,398 + 0 + 327 = 1,725 ✓
```

**결론: 1,725건 중 81%(1,398건)는 완전히 포기할 필요 없이 MOLIT 거래
이력을 활용한 identity 강화 여지가 있다** — 이번 STEP은 그 구체적
방법을 설계하지 않았으나(범위 밖), "전부 버리는 것이 목적이 아니다"는
지시사항 원칙에 맞는 실제 복구 여지가 확인됐다.

---

## 20. Apartment universe 자체 감사

**ApartmentMaster 스키마에 건물 유형 필드(아파트/오피스텔/주상복합/
도시형생활주택 등) 자체가 없다** — 확인된 사실이며, 이번 STEP은 이
사실 자체를 결과로 보고한다(추정 classification 금지 원칙을 그대로
지켜, 이름 패턴("빌리지", "빌라" 등)으로 유형을 임의 추정하지 않았다).

확인 가능한 유일한 간접 신호는 `totalHouseholds`(registry 확보분에만
존재):

```
1세대                 0건
2~9세대                1건
10~99세대            168건
100~499세대          702건
500세대+             438건
미확인(registry 없음) 2,093건(61.5%)
```

**registry 미연결 2,093건은 세대수 자체가 없어 "소규모/대규모"조차
판정 불가하다** — 이 항목들이 실제로 아파트인지, 소규모 다세대/연립인지,
오피스텔인지는 **이 데이터로 확인할 수 없다**(STEP 0.5에서 이름만으로
"작은 건물일 가능성"을 시사했던 것과 별개로, 이번 STEP은 확정 판정을
내리지 않는다 — 확인 불가는 확인 불가로만 기록).

---

## 21-23. Benchmark acceptance

```
21. 대신해모로: PEER_FULL(COORD_HIGH+IDENTITY_HIGH) 확정. §9에서 확인한
    "실제 비교 가능한(PEER_FULL) 단지 중에서는 최근접" 결과를 acceptance
    조건으로 본다면 — 만족.

22. 협성르네상스: PEER_FULL 확정. 필터링 후 순위가 1/10로 개선(§9) —
    subway distance(306m) raw 값 자체는 유지, 상대위치만 재평가됨.

23. 구덕금호: **acceptance 실패(신규 발견)** — 자기 자신이 COORD_LOW/
    DISPLAY_ONLY다. 3단지 고정 regression sample을 유지하되, 이 사실을
    숨기지 않고 "구덕금호는 이번 quality model 기준으로 그 자체가
    저신뢰 좌표 사례"로 명시 기록한다 — 향후 Score V2 redesign 단계에서
    이 단지를 "저신뢰 좌표의 실제 사례"로 활용할 수 있다(제거하지 않고
    오히려 유용한 negative-case로 유지 권장).
```

---

## 24. 부산-wide anomaly indicators(향후 모니터링용, 설계만)

```
LOW coordinate ratio            = COORD_LOW / 전체(현재 51.0%)
registry unlinked ratio         = !registryLinked / 전체(현재 61.5%)
peer-ineligible ratio(domain별) = !transportPeerEligible 등(현재 transport 51.0%,
                                   parking 74.7%)
zero-market-evidence ratio      = marketEvidence=ZERO / 전체(현재 13.7%)
duplicate coordinate ratio      = STEP 0.5 §13에서 이미 측정(7 groups/22 rows,
                                   미미한 수준 재확인)
impossible distance ratio       = nearestSubwayDistanceM<=5m 비율(STEP 0.5 §13에서
                                   0건 확인)
```

DATA QUALITY MONITORING V1과 연결 시, 위 6개 지표를 정기 배치로
재계산해 시계열 추적하는 것을 제안한다(이번 STEP은 설계만, 배치
구현은 범위 밖).

---

## 25. quality gate — SCORE V2 architecture 진입 조건

```
[x] peer quality rules documented          — 이 문서(§3/§4/§7/§8)
[x] transport peer contamination controlled — §9/§10 simulation으로 실제 개선 확인
[△] region coverage acceptable              — 대부분 구는 양호하나 중구(8%)/서구(16%)
                                              PEER_FULL 비율이 낮음(§12) — "허용 가능"
                                              여부는 이 문서가 판정하지 않고 다음
                                              STEP의 승인 대상으로 남긴다
[△] minimum peer sample strategy defined    — §15에서 10 추천, 단 parking은 추가
                                              조치(§14 decade-band 완화) 필요
[x] low-quality coordinates cannot distort peers — §7/§9에서 COORD_LOW를
                                              DISPLAY_ONLY로 격리해 해결
```

**5개 중 3개 충족(x), 2개 부분충족(△)** — 완전한 GO도 완전한 NO-GO도
아니다. §64 최종 판정 참고.

---

## 26. code policy 준수 확인

이번 STEP에서 추가한 코드는 전부 `scripts/apartment-score/`(read-only
분석 스크립트 4개 + prototype 라이브러리 1개 + fixture test 1개)뿐이며,
`src/lib/apartment-score/server/*`(production score engine)는 **한 줄도
import하거나 수정하지 않았다**(`peer-quality.ts` 파일 상단 주석에
명시). production score formula/DB write/migration/API/UI 변경 전부 0건.

---

## 27. docs

이 문서 신규.

---

## 28. 최종 보고

```
1.  branch                             = score-v2-step0-forensic-audit(STEP 0/0.5와 동일)
2.  base                               = score-geocode-recovery(6e06e01, 변경 없음)

3.  Apartment total                    = 3,402
4.  score-ready current count          = 3,401(STEP 0/0.5와 동일, 변동 없음)
5.  STEP0.5 high-risk count            = 1,725(정확히 재현, §2)

6.  identity HIGH                      = 1,309(38.5%)
7.  identity MEDIUM                    = 80(2.4%)
8.  identity LOW                       = 1,611(47.4%)
9.  unresolved(identity)               = 402(11.8%)

10. coordinate HIGH                    = 1,667(49.0%)
11. coordinate MEDIUM                  = 이 스키마에 존재하지 않음(§4, 임의 도입 안 함)
12. coordinate LOW                     = 1,734(51.0%)
13. missing(coord unresolved)          = 1(0.0%)

14. registry linked                    = 1,309(38.5%)
15. registry unlinked                  = 2,093(61.5%)

16. market evidence strong             = 1,766(51.9%)
17. weak                               = 1,171(34.4%)
18. zero                               = 465(13.7%)

19. PEER_FULL count                    = 1,301(38.2%)
20. PEER_LIMITED                       = 366(10.8%)
21. DISPLAY_ONLY                       = 1,734(51.0%)
22. UNRESOLVED                         = 1(0.0%)

23. transport peer eligible count      = 1,667
24. life peer eligible count           = 1,667
25. parking peer eligible count        = 862(25.3%)
26. complex peer eligible count        = 3,000
27. school peer eligible count         = 1,667

28. 대신해모 old peer count             = 19
29. 대신해모 filtered peer count        = 7
30. 대신해모 old subway rank            = 8/19
31. filtered subway rank               = 4/7(PEER_FULL만 보면 최근접)

32. 협성 old peer count                = 27
33. filtered peer count                = 10
34. old rank                           = 2/27
35. filtered rank                      = 1/10

36. 구덕금호 peer result               = 자기 자신이 COORD_LOW/DISPLAY_ONLY(신규 발견,
                                          §10/§23 — benchmark acceptance 실패 사례로 기록)

37. 서대신동2가 TOP20 contamination before = 18/20(90%, registry 미연결)
38. after                              = 이번 STEP은 TOP20 자체를 필터링된 버전으로
                                          재출력하지 않았음(§9/§10 peer-count/rank
                                          변화로 대체 확인) — 필요 시 후속 STEP에서 추가 가능

39. Busan district coverage minimum    = 8.5%(중구, PEER_FULL 비율)
40. Busan district coverage maximum    = 75.0%(강서구)

41. n<5 peer groups(동 단위, transport)  = 69/149(46.3%)
42. n<10                               = 89/149(59.7%)
43. n<20                               = 117/149(78.5%)
44. recommended minimum peer strategy  = 10(§15, parking은 추가 조치 필요)

45. peer fallback recommendation       = 현 LOCAL→SIGUNGU→REGION_WIDE 구조 유지,
                                          parking의 decade-band만 완화 검토(§14)

46. display semantics recommendation   = DISPLAY_EXACT/APPROXIMATE/NOT_AVAILABLE(§17)
47. confidence linkage recommendation  = 대상 자신의 identity/coord quality를 confidence에
                                          추가 반영(방향만, §18)

48. recoverable low-quality count      = 1,398/1,725(81.0%, MOLIT 거래이력 기반, §19)
49. manual-review count                = 327/1,725(19.0%)
50. likely out-of-universe count       = 0(단정할 근거 없음, §20 원칙상 판정 보류)

51. production Score code changed?     = NO
52. DB write?                          = NO
53. migration?                         = NO

54. tests                              = peer-quality.test.ts 20개 신규, 전체 117/117 PASS
55. tsc                                = 0 errors(신규 파일 전수)
56. lint                               = 0 errors/0 warnings(신규 파일 전수)
57. docs                               = 이 문서 신규
58. commit                             = 예정(이 STEP 마지막 단계)
59. push                               = 예정
60. worktree clean                     = step06-*.ts 4개 + lib/peer-quality.ts(+test) + 이 문서 외 변경 없음(확인 예정)

61. BLOCKER                            = 없음(설계 STEP)

62. PEER_DATA_MODEL_READY              = **YES(prototype 완성, production 미연결)** —
                                          §25 gate 3/5 충족, 2개는 부분충족으로 다음
                                          STEP 승인 필요
63. TRANSPORT_PEER_TRUSTED             = **CONDITIONAL** — PEER_FULL/PEER_LIMITED로
                                          필터링하면 신뢰 가능(§9 simulation 확인),
                                          필터링 전(현재 production 상태)은 여전히
                                          신뢰 불가(STEP 0.5 결론 유지)
64. SCORE_V2_STEP1_READY               = **NO(변경 없음, STEP 0.5와 동일 결론)** —
                                          이번 STEP은 quality model을 "설계"했을 뿐
                                          production에 아직 연결하지 않았다. 실제
                                          peer pool에 이 필터를 적용하는 것이 STEP 1
                                          이전의 다음 단계여야 한다.
65. NEXT_RECOMMENDATION                = ① 이번 STEP의 quality model(peer-quality.ts)을
                                          실제 production peer 조회 경로에 연결하는
                                          별도 구현 STEP(사용자 승인 필요, formula
                                          자체는 불변) ② parking decade-band를 4구간
                                          완화안으로 재검증(§14) ③ 1,398건 MOLIT
                                          거래이력 기반 identity 강화 방법 설계(§19)
                                          ④ 중구/서구 등 PEER_FULL 비율이 낮은 구의
                                          coverage 허용 여부를 사용자/ChatGPT가 판단
                                          (§25 △ 항목) ⑤ 위 조치들이 반영된 뒤에야
                                          STEP 1(weight 재설계) 착수
```

**E-JIP SCORE V2 STEP 0.6 종료. 결과 보고 후 멈추고 ChatGPT/user 검수 대기.**
