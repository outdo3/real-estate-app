# E-JIP SCORE V2 STEP 0.8 — Shadow Peer & Score Impact Validation

## 목적

STEP 0.7-A(production identity/좌표 복구 write, commit `48c5d60`)로 PEER_FULL
비율이 38.2% → 72.5%로 개선됐지만, 핵심 벤치마크에서 여전히 이상 신호가 남았다:

- **대신해모로센트럴아파트**: subway 140m, PEER_FULL, filtered rank 7/17
- **협성르네상스(서구)**: subway 306m, PEER_FULL, filtered rank 2/20

절대적으로 지하철이 훨씬 가까운 대신해모가 상대(percentile) 점수에서는 협성보다
낮게 나올 수 있다는 뜻이다. 이번 STEP은:

1. quality-filtered peer가 실제로 안전한지 검증
2. 서로 다른 peer group의 percentile을 직접 비교하는 것이 타당한지 검증
3. production Score를 바꾸지 않고 SHADOW로 부산 전체 impact를 계산
4. V2로 넘어가기 전 relative-score 구조의 한계를 데이터로 확정

**production Score/DB/API/UI/schema/weight — 전부 미변경. READ-ONLY 분석만 수행했다.**

## 현재 상태

- base: `score-v2-step07a-safe-recovery-write`(commit `48c5d60`) — STEP 0/0.5/0.6/0.7/0.7-A 전부 포함 확인
- 신규 branch: `score-v2-step08-shadow-peer-validation`(worktree `.worktrees/score-v2-step08-shadow-peer-validation`)
- main 브랜치: 미변경

## 방법론 — 왜 이 결과를 신뢰할 수 있는가

STEP 0.8의 모든 SHADOW 계산은 production 코드(`src/lib/apartment-score/server/*`)를
**한 줄도 재구현하지 않고 그대로 import해서 재사용**한다:

- `resolvePeerPoolLevels`(peer-groups.ts) — peer 후보 리스트만 교체해서 그대로 호출
- `computeCategoryWithFallback`(calculate.ts) — LOCAL→SIGUNGU→REGION_WIDE fallback 그대로
- `compute{Transport,Living,Parking,Complex,SchoolAccess}Category` — 전부 그대로
- `computeCategoryFromSubMetrics`(category-helper.ts), `rankFeature`/`scoreFromPercentile`(percentile.ts) — 전부 그대로

새로 작성한 코드(`scripts/apartment-score/lib/shadow-score.ts`)가 하는 일은 딱 하나:
**같은 sggCd(구·군) cohort 안에서, 카테고리별 peer 후보 리스트를 STEP 0.6
`peer-quality.ts classify()`의 도메인별 eligibility로 걸러서 위 production 함수에
그대로 넘기는 것**뿐이다. 필터 정의:

| 도메인 | production 후보 | SHADOW 후보 |
|---|---|---|
| transport / living / schoolAccess | 같은 sggCd cohort 전체(quality 무관) | `transportPeerEligible`(coord=COORD_HIGH)만 |
| complex | transport와 동일(nonParkingLevels 재사용) | `complexPeerEligible`(buildYear 존재 + identity≠UNRESOLVED)만 — **production과 다른 자체 후보셋을 쓰는 유일한 도메인**(§28 목적상 의도적 분리, 아래 "알려진 문제"에 명시) |
| parking | 같은 sggCd + buildYear decade band 전체 | 위 조건 + `parkingPeerEligible`(parkingCount·totalHouseholds 확보)만 |

**§2에서 이 재사용이 실제로 100% 정확한지 실측 검증했다** — SHADOW 엔진을
필터 없이(`mode='PRODUCTION'`) 돌린 결과와 실제 `calculateApartmentScore()`(DB
직접 호출) 결과를 18건(핵심 벤치마크 3 + 무작위 15) 비교해 **불일치 0건**을 확인했다.

대상 target 자신이 해당 도메인의 quality 기준을 통과하지 못하면(예: 구덕금호의
COORD_LOW) SHADOW 후보 리스트에서 target 자신도 제외된다 — 이는 "다른 단지의
peer가 될 자격"과 "자신이 그 peer 기준으로 평가받을 자격"을 동일 기준으로 보는
설계 선택이며(§18 참고), 그 결과 해당 도메인은 자연스럽게 `NOT_SCORED`가 된다
(허위로 점수를 만들어내지 않는다).

## 분석

### A. 대신해모로센트럴 transport peer 전수(§3)

- **PEER_GROUP_KEY** = `sggCd=26140(서구)::umdName=서대신동2가`
- peerPool: level=**LOCAL**, tier=HIGH, size=**17**
- shadow transport(quality-filtered LOCAL) = **63.16점**, filtered rank **7/17**
- production computeTransportCategory() 재검증과 100% 일치(§2 방법론 그대로 적용)

지하철 거리 오름차순 17건 전체(★=대상):

| rank | 거리 | 역 | 이름 | identity | coord | eligibility | transport |
|---|---|---|---|---|---|---|---|
| 1 | 38m | 동대신역 | 희망센츄럴타운 | HIGH | HIGH | PEER_FULL | 72.2 |
| 2 | 61m | 서대신역 | 서대신엔스타(278-2) | LOW | HIGH | PEER_LIMITED | 75.3 |
| 3 | 65m | 동대신역 | 위너스빌 | HIGH | HIGH | PEER_FULL | 63.9 |
| 4 | 78m | 동대신역 | 한우리빌리지5차 | LOW | HIGH | PEER_LIMITED | 65.7 |
| 5 | 108m | 동대신역 | (76-0) | HIGH | HIGH | PEER_FULL | 61.6 |
| 6 | 128m | 서대신역 | 대진골든빌리지 | LOW | HIGH | PEER_LIMITED | 60.8 |
| **7** | **140m** | **서대신역** | **★대신해모로센트럴아파트** | HIGH | HIGH | PEER_FULL | **63.2** |
| 8 | 142m | 동대신역 | 향원에이스타운(79) | LOW | HIGH | PEER_LIMITED | 49.5 |
| 9 | 143m | 동대신역 | 오현예다움 | HIGH | HIGH | PEER_FULL | 48.0 |
| 10 | 198m | 동대신역 | 신우빌라 | HIGH | HIGH | PEER_FULL | 48.0 |
| 11 | 204m | 동대신역 | 툇마루家 | LOW | HIGH | PEER_LIMITED | 42.6 |
| 12 | 212m | 서대신역 | 대신푸르지오2차 | HIGH | HIGH | PEER_FULL | 38.6 |
| 13 | 228m | 서대신역 | 보람 | HIGH | HIGH | PEER_FULL | 35.7 |
| 14 | 235m | 동대신역 | 석포로얄캐슬3차 | HIGH | HIGH | PEER_FULL | 34.6 |
| 15 | 272m | 동대신역 | 오현스위트 | HIGH | HIGH | PEER_FULL | 30.7 |
| 16 | 274m | 동대신역 | 오션스카이블루 | HIGH | HIGH | PEER_FULL | 29.9 |
| 17 | 285m | 서대신역 | 자유 | HIGH | HIGH | PEER_FULL | 32.8 |

**앞선 6개 전부 실제 아파트/원룸형 공동주택이며, 6개 중 5개가 등록된 주소·좌표를
가진 실존 건물, 그중 3개(1,3,5위)는 PEER_FULL(HIGH quality)이다.** 즉 대신해모가
7위로 밀린 것은 "가짜 peer 오염" 때문이 아니라 **동대신역/서대신역 사이에 실제로
30m대 초근접 소형 단지가 밀집한 지역 특성** 때문이다 — 이것 자체는 정상이다.
문제는 다음 절(협성 비교)에서 드러난다.

### B. 협성르네상스 transport peer 전수(§4)

- **PEER_GROUP_KEY** = `sggCd=26140(서구)::umdName=서대신동3가`
- peerPool: level=**LOCAL**, tier=HIGH, size=**22**(★STEP 0.6의 초기 ad-hoc
  시뮬레이션은 20건으로 보고했었다 — 차이 원인은 "알려진 문제" 참고)
- shadow transport = **78.28점**, filtered rank **2/22**

앞선 1개: 대윤스위트(297m, PEER_FULL, transport 70.2) — 실존 건물, 정상.

**핵심 발견**: 협성의 LOCAL peer 22개는 297m~980m 범위에 퍼져 있어(§C 참고),
306m인 협성 자신은 이 좁은 로컬 분포 안에서 "2등"이 된다. 반면 대신해모의 LOCAL
peer 17개는 38m~285m 범위에 몰려 있어, 140m인 대신해모는 같은 로컬 분포 안에서
"7등"이 된다. **두 값(140m, 306m)이 서로 다른 두 개의 좁은 분포에 각각 투영되면서,
절대적으로 훨씬 나은 140m가 상대적으로는 더 나쁜 순위로 나온다.**

### C. 왜 두 peer universe가 다른가(§5)

두 아파트 모두 `PEER_GROUP_KEY`가 `sggCd=26140(서구)::umdName=<동>` 이지만 `umdName`이
다르다 — 대신해모는 `서대신동2가`, 협성은 `서대신동3가`. `resolvePeerPoolLevels()`(peer-groups.ts
§75-77)의 LOCAL 정의가 **정확히 "같은 umdName(법정동)"** 이기 때문에, 두 아파트는
애초에 서로의 peer가 될 수 없는 서로 다른 LOCAL 모집단에 속한다. 이는 fallback
단계나 quality-filter의 부작용이 아니라 **peer-groups.ts의 LOCAL 정의 자체**다.
서대신동2가와 서대신동3가는 도보로 몇 분 거리의 동일 생활권이지만, 행정동/법정동
경계선 하나로 완전히 분리된 두 모집단이 된다 — 임의적 경계선이 실제 결과를
좌우하는 전형적 사례다.

### D. Cross-peer comparability audit(§6)

**CROSS_PEER_COMPARABLE = NO.**

근거: 서로 다른 peer group에서 나온 percentile을 직접 비교(예: "협성 79 > 대신해모
63")하면, 그 비교가 실제로 반영하는 것은 "두 단지의 교통 접근성 차이"가 아니라
"두 peer group의 절대 거리 분포 차이"다. STEP 0.8 §7-9(아래)의 실측이 이를 정량
확인한다 — 대신해모(140m)는 **부산 전체 상위 7.2%(percentile 92.8)**, 협성(306m)은
**부산 전체 상위 32.3%(percentile 67.7)**로, 절대 위치는 대신해모가 명백히 앞선다.
그런데 LOCAL 상대 점수는 정반대(63.2 vs 78.3)를 보여준다.

### E. Absolute-distance sanity(§7) — 부산 전체 분포

quality-filtered(`transportPeerEligible`) 부산 전체 **2,833건** 중 실측 거리 보유
**2,291건**(confirmed-absent 489건 + 기타 미수집 53건 별도):

| 백분위 | 거리(m) |
|---|---|
| min | 19 |
| p1 | 61 |
| p5 | 119 |
| p10 | 164 |
| p25 | 267 |
| p50(median) | 397 |
| p75 | 569 |
| p90 | 758 |
| p95 | 872 |
| max | 999 |

거리 구간 분포:

| 구간 | 건수 | 비율 |
|---|---|---|
| ≤100m | 76 | 3.3% |
| 101~200m | 254 | 11.1% |
| 201~300m | 386 | 16.8% |
| 301~500m | 818 | 35.7% |
| 501~800m | 571 | 24.9% |
| 801~1200m | 186 | 8.1% |
| >1200m | 0 | 0.0% |

### F. Busan-wide absolute percentile(§8)

| | 거리 | BUSAN rank | BUSAN percentile | SIGUNGU(서구) rank | SIGUNGU percentile | LOCAL(현재 shadow) score |
|---|---|---|---|---|---|---|
| 대신해모 | 140m | 167/2291 | **92.8** | 8/101 | **93.0** | 63.2 |
| 협성 | 306m | 742/2291 | **67.7** | 41/101 | **60.0** | 78.3 |

**LOCAL 점수와 BUSAN/SIGUNGU 절대 percentile의 순위가 완전히 뒤집혀 있다** — 이것이
이번 STEP이 확정하려던 핵심 모순이다.

### G. 서구 전체 subway ranking(§9)

서구 transport-eligible 전체 **101건**. TOP 8(전체 30건은 JSON 아카이브 참고):

1. 38m 희망센츄럴타운(서대신동2가)
2. 61m 서대신엔스타(서대신동2가)
3. 65m 위너스빌(서대신동2가)
4. 78m 한우리빌리지5차(서대신동2가)
5. 106m 부백자연애(토성동3가)
6. 108m (76-0)(서대신동2가)
7. 128m 대진골든빌리지(서대신동2가)
8. **140m 대신해모로센트럴아파트(서대신동2가) — 서구 전체 8위/101**

협성(306m)은 **서구 전체 41위/101**.

사용자의 현장 인식("대신해모가 서대신/동대신권에서 사실상 지하철 접근성이 가장
뛰어남")은 raw data와 **정확히 일치**한다 — 서구 101개 단지 중 8위, 상위 8%다.

### H. 서대신동+동대신동 combined dong audit(§10)

DB 실제 umdName 6개 확인: `동대신동1가/2가/3가`, `서대신동1가/2가/3가`. 이 6개
법정동을 하나의 생활권으로 묶은 READ-ONLY combined pool(production 규칙 변경
아님) = **58건**:

- 대신해모(140m): combined rank **7/58**
- 협성(306m): combined rank **30/58**

동을 하나로 묶어도 대신해모가 압도적으로 상위, 협성은 중위권 — LOCAL(단일 법정동)
경계가 실제 생활권보다 훨씬 좁게 잘려 있다는 §C의 결론을 재확인한다.

### I. Subway vs Bus decomposition(§11)

| | subway component | bus component | final transport |
|---|---|---|---|
| 대신해모 | 40.06 | 23.10 | 63.16 |
| 협성 | 57.07 | 21.21 | 78.28 |

두 구성요소 다 협성이 높다 — bus 접근성 차이(21.21 vs 23.10, 협성이 오히려 더
불리한 접근성)는 크지 않지만, **subway component의 격차(40.06 vs 57.07)가
지배적**이다. 이 subway component 자체가 §D~H가 보여준 "서로 다른 로컬 분포에
투영된 percentile"이므로, bus/subway 배분(70:30) 문제가 아니라 **LOCAL 표본
경계** 문제임을 다시 확인한다.

### J. "교통" 라벨 의미 검증(§12)

`LABEL_SEMANTICS = PARTIAL.`

transport 카테고리는 실제로 `nearestSubwayDistanceM`(45) + `subwayCount1000m`(25)
+ `nearestBusStopDistanceM`(18) + `busStopCount300m`(12) 4개 원본 지표의
**LOCAL(동) 내 상대 순위**를 합성한 값이다. 사용자가 "교통 79"를 볼 때 "이
단지가 실제로 지하철/버스에 얼마나 가까운가"라는 절대적 의미로 해석할 가능성이
높지만, formula는 "이 단지가 같은 법정동 안에서 얼마나 상대적으로 나은가"를
계산한다. 두 의미가 대부분의 경우 상관관계가 있어 완전히 틀린 것은 아니지만(PARTIAL),
법정동 경계가 실제 생활권보다 좁게 잘리는 경계 지역(서대신동2가/3가 같은 케이스)에서는
두 의미가 정반대로 갈릴 수 있다.

## SHADOW 계산 결과(부산 전체)

### K. Shadow 검증(§2)

18건(핵심 벤치마크 3 + 무작위 15) 비교, **불일치 0건** — quality-filter를 제거한
SHADOW 엔진이 실제 production `calculateApartmentScore()`와 100% 동일하게 재현됨을
확인했다.

### L. Transport shadow impact(§13-14, n=2,833)

| 통계 | 값 |
|---|---|
| mean delta | +0.39 |
| median delta | +0.27 |
| p10 | -1.38 |
| p90 | +2.05 |
| max(+) | +47.28 |
| max(-) | -23.73 |
| \|delta\|≥20 | 7건 |
| \|delta\|≥10 | 23건 |
| \|delta\|≥5 | 91건 |
| \|delta\|<5 | 2,742건(96.8%) |

**quality-filter 자체가 만드는 평균 영향은 미미하다**(mean +0.39). 이는 이미
STEP 0.7-A가 오염을 상당 부분 걷어냈기 때문이다. 그러나 극단값(최대 -23.73,
+47.28)이 실재하고, 91건(3.2%)은 5점 이상 흔들린다 — quality-filter 자체보다
**"어느 peer group에 속하느냐"의 구조적 문제(위 A-J)가 훨씬 크다**는 것이 이번
STEP의 결론이다.

### M. Total score shadow impact(§15)

| 구간 | 건수 |
|---|---|
| delta = 0 | 1,418 |
| 1~4 | 1,350 |
| 5~9 | 48 |
| ≥10 | 17 |
| (누적 ≥5) | 65 |

production OK **3,401건** → shadow OK **2,833건**(568건이 quality-filter만으로
`INSUFFICIENT_DATA`로 전환 — 즉 이 568건은 지금 production이 저품질 peer/자기 자신의
저품질 좌표에 의존해 "있어 보이는" 점수를 보여주고 있다는 뜻).

순위 변화(부산 전체 total score 순위, n=2,833): mean shift **65.2**, median **26**,
p90 **140**, max **2,222**. 100계단 이상 이동 **516건**, 50계단 이상 **1,112건**
(전체의 약 39%) — quality-filter 하나만으로도 순위 체계가 상당히 재배열된다.

### N. 대신해모 / 협성 shadow(§16-17)

| | 대신해모 | 협성 |
|---|---|---|
| total production | 47 | 58 |
| total shadow | 48 | 59 |
| transport production(peer) | 62.3(LOCAL/19) | 78.5(LOCAL/29) |
| transport shadow(peer) | 63.2(LOCAL/17) | 78.3(LOCAL/22) |
| living | 35.6→36.1 | 37.7→39.6 |
| parking | 17.9→17.9(불변) | 95.0→95.0(불변) |
| complex | 91.9→91.9(불변) | 60.5→59.1 |
| schoolAccess | 22.0→24.1 | 11.4→13.6 |

**quality-filter 자체는 두 단지의 최종 점수를 거의 바꾸지 않는다(+1점씩)** —
이미 둘 다 PEER_FULL이라 원래도 상당수 peer가 quality-eligible이었기 때문이다.
즉 "협성이 더 높다"는 현상은 quality 오염 때문이 아니라 §C~I의 **LOCAL 경계
구조 자체**에서 나온다 — quality-filter로는 해결되지 않는 문제라는 뜻이다.

### O. 구덕금호 negative case(§18)

- quality: identity=IDENTITY_LOW, coord=COORD_LOW → **peerEligibility=DISPLAY_ONLY**
- domain eligibility: transport=false, living=false, school=false, parking=false, **complex=true**(buildYear 보유 + identity가 UNRESOLVED는 아님)
- production: total=54(coverage 0.85) — 저품질 좌표/식별 정보에 의존해 "정상처럼 보이는" 점수를 내고 있었다
- shadow: total=**INSUFFICIENT_DATA**(coverage 0.15) — transport/living/parking/schoolAccess 전부 NOT_SCORED(REGION_WIDE까지 폴백해도 자신이 후보에서 빠져 있어 랭크 불가), complex만 PARTIAL(35.3, SIGUNGU/139)

**proposal 비교**:

| 옵션 | 설명 | 평가 |
|---|---|---|
| NOT_ENOUGH_DATA | "이 단지는 현재 신뢰 가능한 위치 정보가 부족해 점수를 계산할 수 없습니다" | SHADOW의 자연스러운 기본 동작과 정확히 일치. 정직하지만 사용자에게 정보 가치가 0 |
| LOW_CONFIDENCE | production의 54점을 보여주되 "낮은 신뢰도" 배지 부착 | 정보는 주지만, 애초에 신뢰할 수 없다고 STEP 0.6이 확정한 좌표(COORD_LOW)로 계산된 값을 노출 — §3 원칙("정확한 척하는 score 생성 금지")과 충돌 소지 |
| DISPLAY_CURRENT_BETA | 현재 production 값을 "베타/검수중" 라벨로 그대로 노출 | LOW_CONFIDENCE와 유사하나 라벨만 다름, 근본적으로 같은 문제 |

**권고(제안, 미구현)**: NOT_ENOUGH_DATA가 §3/§17 원칙에 가장 부합한다. 다만
"raw fact display"(구덕금호 자신의 원본 주소/거리 등은 그대로 보여주는 것)와
"relative score 미계산"은 분리해서, "점수만 준비 중, 원본 정보는 그대로 표시"가
현재 `PreparingReasonCode` 인프라와 가장 자연스럽게 맞는다 — 실제 UI 반영은
이번 STEP 범위 밖(§0 명시)이라 제안만 하고 구현하지 않았다.

### P. Benchmark 28개(§19)

STEP0 §11 선정 로직(지역대표/신축대단지/구축대단지/초역세권/비역세권/고용량/재건축후보)을
그대로 재사용 + STEP0.8 핵심 3개(대신해모/협성/구덕금호) 추가 → **28개**(STEP0 문서와
동일하게 목표 30~50에는 못 미침 — 선정 필터 자체가 STEP0에서 만든 것이라 이번
STEP에서 새로 확장하지 않았다). 전체 28개 production/shadow total·transport·peer·거리
비교는 `scripts/apartment-score/output/step08-summary.json`(`benchmarkRows`)에 저장.
요약:

- production/shadow **total** 차이는 거의 전부 0~1점(quality-filter 자체의 영향은 작다는 §L/§M과 일치)
- 예외: **협성루에나센텀**(REGION_WIDE/238로 폴백, shadow transport 계산 불가 → shadowTotal N/A) — LOCAL 표본이 quality-filter 후 5건 미만으로 줄어든 사례로, §22(sample size impact)의 실제 발생 케이스
- **구덕금호**: shadow total N/A(§O 그대로)
- **문화(서구/동대신동3가, 26140-15)**: production transport 69 → shadow 56(가장 큰 하락폭 중 하나, SIGUNGU 레벨로 폴백된 상태에서 quality-filter가 큰 표본 구성을 바꿈)

### Q. Suspicious inversion detection(§20)

quality-filtered 부산 전체(shadow transport SCORED/PARTIAL + 실거리 보유,
**2,291건**)에서 "distance(A)가 B보다 명백히 가까운데 shadow transport score(A) <
score(B)"인 쌍을 전수 계산(cross-population, peer group 무관):

| distance gap 기준 | inversion 쌍 | 비교대상 쌍 | 비율 |
|---|---|---|---|
| ≥200m | 236,801 | 1,359,139 | 17.42% |
| ≥300m | 144,915 | 891,110 | 16.26% |
| ≥500m | 46,155 | 314,898 | 14.66% |

**대신해모/협성 사례는 예외가 아니라, 이 percentile-per-LOCAL-group 구조 아래서는
구조적으로 항상 발생하는 현상이다.** 거리가 200m 이상 명백히 차이 나는 두 단지
쌍 중 약 17%가 "더 가까운 쪽이 더 낮은 점수"를 받는다.

### R. Component dominance(§21)

지하철 100~200m 단지(n=254) vs 500~800m 단지(n=574) 사이에서 near가 far보다
낮은 점수를 받는 쌍 = **6,587건**. 각 단지의 실제 채택 peer pool(resolvePeerPoolLevels
결과)로 정확히 재계산한 subway+bus 합계가 보고된 score와 전부 일치함을 확인한
표본(다양화 샘플링, subway+bus sum = score 검증 포함):

| NEAR(100~200m) | 거리 | score | subway/bus | FAR(500~800m) | 거리 | score | subway/bus |
|---|---|---|---|---|---|---|---|
| 대신해모로센트럴아파트 | 140m | 63.2 | 40.1/23.1 | 드파인센텀 | 551m | 68.2 | 55.3/12.9 |
| 청아 | 164m | 79.9 | 54.3/25.5 | 로웰타워 | 609m | 85.4 | 64.6/20.9 |
| 레스틴뷰 | 134m | 78.4 | 55.3/23.1 | 상경전원 | 629m | 84.2 | 66.5/17.7 |
| 한성그린아파트 | 187m | 56.9 | 51.6/5.4 | 현대타운 | 529m | 74.4 | 56.7/17.7 |
| 삼정그린코아 | 127m | 68.0 | 53.5/14.6 | 야긴다하임 | 525m | 74.2 | 61.2/13.0 |

(대신해모 자체 재검증: peerN=17, subway=40.06, bus=23.10, sum=63.16 — §I·§16-17의
63.2와 정확히 일치)

5개 표본 모두에서 **subway component가 near보다 far 쪽이 더 높다** — 즉 각자의
로컬 peer 그룹 안에서는 far 단지가 "상대적으로 더 가까운 편"으로 평가된다는
뜻이다(far 단지들이 속한 로컬 그룹의 지하철 거리 분포 자체가 near 단지들의
그룹보다 전반적으로 더 멀기 때문). 이는 우연한 개별 사례가 아니라 §Q(17%대
inversion 비율)와 동일한 구조적 원인이 만든 일관된 패턴이다.

**판정**: 이 현상은 "합리적 tradeoff"(근접 단지라도 버스 등 다른 요소가 극단적으로
나쁘면 낮아질 수 있다는 것 자체는 정당)라기보다, §Q의 수치 규모(17%)를 볼 때
**peer artifact(로컬 표본 경계 문제)가 지배적**이라고 판단한다 — component
가중치(70:30) 자체보다 "어느 표본과 비교되느냐"가 결과를 결정한다.

### S. Peer sample size impact(§22)

| peer sample size | n | score variance | extreme(≤10 or ≥90) |
|---|---|---|---|
| n<10 | 111 | 279.9 | 2건(1.8%) |
| 10~19 | 277 | 248.3 | 2건(0.7%) |
| 20~29 | 457 | 276.5 | 4건(0.9%) |
| 30+ | 1,988 | 309.0 | 17건(0.9%) |

score variance/극단값 비율이 표본 크기와 뚜렷한 단조 관계를 보이지 않는다 —
"현재 minimum peer 10(HIGH tier)/5(MEDIUM tier) 기준"이 극단값 방지 목적으로는
이미 어느 정도 작동하고 있다는 뜻이다(단, §T의 SIGUNGU 비교가 보여주듯 표본
"크기"보다 "동질성/경계"가 더 큰 변수다).

### T. DONG(R1) vs SIGUNGU(R2) shadow(§23)

| | R1(현재, DONG-first) | R2(SIGUNGU-only) |
|---|---|---|
| coverage | 2,833/3,402 | 2,833/3,402(동일) |
| mean | 50.0 | 49.7 |
| stdev | 17.2 | 18.4 |
| 구별 평균 스프레드 | 49.4~52.2(1.06x) | 49.3~50.1(1.02x) |
| distance gap≥300m inversion | 144,915 | **78,288**(R1의 54%) |

**SIGUNGU-only 모델이 DONG-first 모델보다 inversion을 거의 절반으로 줄인다.**
coverage/구별 편향(district bias)은 두 모델이 비슷하지만, "가까운데 낮은 점수"
현상은 SIGUNGU가 훨씬 덜하다 — LOCAL(동) 표본이 좁을수록 경계 왜곡이 커진다는
가설을 정량적으로 뒷받침한다.

### U. Parking cross-peer audit(§26)

- `parkingPeerEligible` = 862/3,402(**25.3%** — STEP0 당시와 coverage 수치가 사실상 동일, quality-filter로 개선되지 않음. parking eligibility는 좌표가 아니라 registry(parkingCount·totalHouseholds) 완전성에 달려 있어 STEP 0.7-A의 좌표 복구 효과가 미치지 않는다)
- shadow parking peer sample size 분포: n<10 162건, 10~19 362건, 20~29 510건, 30+ 2,368건
- ratio(주차대수/세대) gap≥0.3: inversion 19,358건/178,556쌍, gap≥0.5: 6,351건/114,120쌍

**STEP0이 지적한 "small peer n=5~8, 1.09→18 vs 1.58→95" 문제는 quality-filter로
해결되지 않는다** — coverage 자체가 25.3%로 낮은 근본 원인(주차 registry
데이터 자체의 결측)이 그대로이기 때문이다. minimum sample 전략(예: n<10인 경우
카테고리 신뢰도를 낮추는 별도 표시)이 여전히 필요하다는 STEP0 결론이 유지된다.

### V. School cross-peer audit(§27)

nearestElementaryDistanceM 기준 cross-population inversion: gap≥200m
**118,493건**/1,584,566쌍, gap≥300m **39,572건**/837,374쌍. transport와 같은
규모(약 5~7%대)의 구조적 inversion이 school에도 존재한다 — "341m vs 545m"
사례는 예외가 아니라 동일한 LOCAL-percentile 구조의 일반적 결과다. (통학구역
데이터는 이번 STEP에서 Score에 조인하지 않았다 — 지시 §27 준수.)

### W. Complex domain audit(§28)

| | buildYear 상관계수(r) | n |
|---|---|---|
| production | 0.772 | 3,402 |
| shadow(complexPeerEligible-filtered) | 0.757 | 3,000 |

STEP0이 보고한 0.825와 다소 차이가 있다(이후 데이터 추가/좌표 복구로 모집단이
바뀌었기 때문으로 추정 — 재계산 없이 임의로 맞추지 않고 실측값을 그대로
기록한다). quality-filter가 상관관계를 크게 바꾸지는 않는다(0.772→0.757, -0.015).
buildYear 의존도가 여전히 높다는 STEP0 결론은 유지된다.

### X. Life domain audit(§29)

raw absolute fact = 6개 POI **개수**(mart/편의점/약국/병원/공원/어린이집, 전부
higherIsBetter + log1p 변환) — transport/school과 달리 "거리"가 아니라 "밀도"
지표다. POI 합계 기준 cross-population inversion: gap≥5건 **922,620건**/3,545,429쌍,
gap≥10건 **723,245건**/3,047,536쌍(비율 20~26%대로 오히려 transport/school보다
높다). **의미 분리**: living은 "가장 가까운 편의시설까지의 거리"가 아니라
"주변 밀도"를 측정하므로, "distance 341m vs 545m" 같은 직접적 절대-상대 모순
서술은 부적절하다 — 대신 "quantity"가 갖는 diminishing-returns(log1p) 특성 때문에
비슷한 밀도라도 log 변환 후 순위가 크게 갈릴 수 있다는 점이 living 고유의
왜곡 원인이다.

## 설계 결정 / 판정

### Y. 라벨 의미 및 신뢰 판정(§30)

STEP0 판정: **KEEP_BETA_WITH_WARNING**. STEP 0.8 실측 결과를 반영한 재판정:

**Score V1 trust decision = C. HIDE/DEEMPHASIZE (transport/school/life 카테고리
percentile 서술에 한해)**

근거: quality-filter 자체는 이미 상당 부분 해결됐고(§K/§L/§M), 문제는 **LOCAL
peer group 경계가 실제 생활권보다 훨씬 좁게/임의로 잘려 있다는 구조적 결함**이다.
"교통 62 vs 79"처럼 절대적으로 더 가까운 쪽이 더 낮은 숫자로 표시되는 경우가
전체 비교쌍의 14~17%에 이른다는 것은(§Q) "가끔 있는 예외"가 아니라 "이 라벨을
볼 때마다 상당한 확률로 마주칠 수 있는 현상"이다. total score(전체 종합 점수)
자체는 quality-filter 영향이 작아(§M, 96.8%가 5점 미만 변화) 당장 급하게 내릴
필요는 없지만(D. URGENT_REMOVE는 과함), **개별 카테고리의 percentile 기반 서술
("상위 X%")은 절대 사실(raw distance 등)과 병기하거나, 병기가 어렵다면 당분간
강조를 낮추는 것을 권고**한다.

### Z. Relative score 역할 권고(§25)

**B. SMALL COMPONENT** 권고. 근거:
- A(TOTAL SCORE CORE)로 유지하기엔 §Q/§V/§X처럼 반대 방향 정보를 줄 위험이 구조적으로 크다.
- D(REMOVE)는 과함 — relative percentile은 "같은 동네 안에서 상대적으로 나은 편인가"라는, 그 자체로는 유효한 정보를 담고 있다(단, "동네" 경계가 문제).
- C(DISPLAY-ONLY CONTEXT)보다는 한 단계 위: 절대 raw fact(§32 개념)를 주(main) 지표로 승격하고, 현재의 percentile은 "참고용 보조 지표"로 격하하는 것이 데이터에 부합한다.
- 일반화 가능성: transport(§Q)·school(§V)·life(§X)·parking(§U) 4개 도메인 전부에서 유사한 cross-peer 왜곡이 실측 확인됐다 — complex(§W)만 buildYear 절대값 의존도가 높아 상대적으로 덜 취약하다. 즉 이 문제는 transport 특이 현상이 아니라 **percentile-per-LOCAL-group 아키텍처 자체의 일반적 한계**다.

### AA. Absolute+Relative 개념 제안(§32, 미구현)

```
TRANSPORT
  Absolute Quality: (제안만, 숫자 미확정)
  Raw: 지하철 140m
  Relative: 서구 상위 8%(SIGUNGU) / 부산 상위 7%(BUSAN percentile 92.8)
```

이 구조(절대 percentile을 SIGUNGU/BUSAN 같은 넓은 모집단 기준으로 제시)가
현재 문제(§D)를 해결하는 이유: SIGUNGU/BUSAN 모집단은 두 단지(대신해모/협성)가
공유하는 단일 모집단이므로 "62 vs 79"처럼 서로 다른 모집단 값을 직접 비교하는
오류 자체가 원천적으로 사라진다(§T의 R2 실측이 이를 뒷받침 — inversion이 거의
절반으로 감소). 숫자(예: "92") 자체는 이번 STEP에서 만들지 않았다(§24 명시 준수).

### AB. Expert credibility test 정의(§33, 향후 게이트용 제안)

| 항목 | 정의 | STEP 0.8 근거 |
|---|---|---|
| A. raw fact correctness | 원본 수치(거리·개수 등)가 실제와 일치하는가 | §2에서 production formula 100% 재현 확인, 원본 수치 자체의 정확성은 STEP 0.5/0.7 범위 |
| B. obvious dominance | 명백히 더 나은 쪽이 실제로 더 높은 점수를 받는가 | §Q/§V/§X가 정량적으로 위반 비율 제시(14~26%) |
| C. cross-district consistency | 같은 값이 지역에 따라 다르게 평가되지 않는가 | §T(구별 스프레드 R1 1.06x, R2 1.02x)로 측정 방법 확립 |
| D. explainability | 왜 이 점수인지 사용자가 이해할 수 있는가 | §12(LABEL_SEMANTICS=PARTIAL) |
| E. missing-data honesty | 데이터 부족을 있어 보이게 포장하지 않는가 | §O(구덕금호 NOT_ENOUGH_DATA 권고) |
| F. sensitivity | peer 구성 변경에 점수가 과도하게 흔들리지 않는가 | §S(peer sample size impact) |
| G. local expert review | 실제 현장 경험자가 결과에 동의하는가 | §AC(준비만, 미실행) |
| H. benchmark regression | 이전 STEP 대비 벤치마크가 퇴행하지 않았는가 | §P(28개 benchmark 표) |

### AC. Local expert review 준비(§34, 미실행)

제안 표 구조(단지명 익명화 가능):

| 익명ID | raw facts(거리/개수 등) | domain score | total score | 평가자 체크(순위/이상 여부) |
|---|---|---|---|---|
| A | 지하철 140m, 버스 5개(300m내) | 63.2 | 48 | ? |
| B | 지하철 306m, 버스 4개(300m내) | 78.3 | 59 | ? |

## 구현 내용

신규 파일(전부 `scripts/apartment-score/`, production 코드 무변경):

- `lib/shadow-score.ts` — SHADOW 엔진(quality-filtered peer 후보 + production 함수 재사용), `loadBusanDataset`, `computeScoreForTarget`, `buildTransportDecomposer`, `countCrossInversions`
- `lib/shadow-score.test.ts` — node:test fixture 8건(DB 없이 순수 함수 검증)
- `step08-01-transport-peer-full-dump.ts` — §3/4/5/11
- `step08-02-busan-distribution-and-seogu-rank.ts` — §7/8/9/10
- `step08-03-shadow-full-run.ts` — §2/13-23/26-29
- `output/step08-transport-peer-audit.json`, `output/step08-busan-distribution.json`, `output/step08-shadow-score-comparison.csv`, `output/step08-inversion-cases.json`, `output/step08-summary.json` — READ-ONLY 산출물(개인정보 없음, 아파트명/공개 주소만 포함)

## 테스트 결과

- `scripts/apartment-score/lib/shadow-score.test.ts`: **8/8 PASS**
  - PEER_FULL 대상이 SHADOW_FILTERED에서 정상 SCORED
  - DISPLAY_ONLY(COORD_LOW) peer가 SHADOW 후보에서 완전히 제외됨(peerSampleSize 정확히 검증)
  - PRODUCTION 모드는 기존처럼 오염 peer를 그대로 포함(하위호환 확인)
  - 오염이 0건일 때 PRODUCTION == SHADOW_FILTERED(동일 알고리즘 재사용 확인)
  - min sample fallback(LOCAL<5 → SIGUNGU) 정상 동작
  - `countCrossInversions` lowerIsBetter/higherIsBetter 양방향 단위 테스트
  - 결정론적 출력(동일 입력 재호출 시 완전 동일 결과, `assert.deepEqual`)
- 기존 `peer-quality.test.ts`: **20/20 PASS**(회귀 없음, 이번 STEP에서 수정하지 않음)
- `npx tsc --noEmit`: **0 errors**
- `npx eslint`(신규 파일 전수): **0 errors / 0 warnings**
- §2 production 재현 검증(스크립트 실행 결과, 별도 unit test 아님): 18건 중 **불일치 0건**

## 알려진 문제

1. **STEP 0.6 초기 시뮬레이션과의 협성 peer count 불일치(20 vs 22)**: STEP 0.6의
   `step06-02-benchmark-simulation.ts`는 `nearestSubwayDistanceM != null`인 것만
   "peer 후보"에 넣는 ad-hoc 필터를 썼다. 이번 STEP은 production
   `peer-groups.ts`와 동일하게 **coordinate/identity 자격만으로 후보를 정하고,
   feature 결측은 개별 sub-metric 랭킹 단계에서만 처리**한다(더 정확함). 실제로
   구덕하이츠·대림e편한세상 2건은 COORD_HIGH+IDENTITY_HIGH(PEER_FULL)이지만
   `nearestSubwayDistanceM`이 `qualityFlag=complete`+null("반경 내 지하철 없음"
   확인됨) 상태라 sentinel 처리 대상이다 — STEP 0.6 스크립트는 이런 케이스를
   통째로 빠뜨렸다. 순위(rank 2/22)는 STEP 0.7-A 문서의 rank 2/20과 방향상
   일치하며 결론에 영향 없음.
2. **complex 도메인만 SHADOW에서 production과 다른 후보 리스트를 쓴다**(방법론
   표 참고) — production은 complex도 transport/living/school과 같은
   dong-LOCAL(nonParkingLevels)을 재사용하지만, SHADOW는 §28 감사 목적상
   `complexPeerEligible` 자체 필터를 별도 적용했다. 이는 의도적 분석 선택이며
   production 동작을 바꾸지 않았다(§Y/§Z의 결론에는 영향 없음 — complex는
   원래도 가장 덜 취약한 도메인으로 나타났다).
3. **benchmark 28개(목표 30~50 미달)** — STEP0의 선정 필터를 그대로 재사용했고
   이번 STEP에서 새 카테고리(가격대/주차취약/학군우수)를 추가하지 않았다(§19).
4. **buildYear-complex 상관계수가 STEP0(0.825)과 다르다(0.772)** — 데이터
   갱신(STEP 0.7-A 등)으로 모집단이 변했을 가능성이 높으나, 정밀 원인 추적은
   이번 STEP 범위 밖.
5. **§21 초기 구현 버그(수정 완료)**: 최초 스크립트는 표본 단지의 subway/bus
   component를 실제 채택된 peer pool이 아니라 sigungu 전체 coordOk 후보로
   잘못 계산해, subway+bus 합계가 보고된 score와 일치하지 않았다(예: 첫 실행에서
   대신해모 subway=54.1+bus=22.4=76.5 ≠ score 63.2). `actualTransportPeerPool()`
   헬퍼로 `resolvePeerPoolLevels` 기반 실제 peer pool을 재구성하도록 수정해
   재실행했고, 현재 문서의 §R 표는 subway+bus sum이 score와 정확히 일치함을
   확인한 값이다(수정 전/후 §2·§13-20·§22-29·benchmark 결과는 diff로 완전히
   동일함을 확인 — 이 버그는 §21 표본 계산에만 국한됐었다).

## 다음 STEP

- **SCORE_V2_STEP1_READY = YES**(아래 결과 보고 §72-74 참고)
- 권고: BUSAN/SIGUNGU 절대 percentile을 1차 지표로, 현재 LOCAL percentile은
  보조 지표로 격하하는 V2 percentile 아키텍처 설계(§AA 개념을 구체 설계로 발전)
- parking(§U)의 근본 원인(registry coverage 25.3%)은 quality-filter로 해결되지
  않으므로 별도 데이터 확보/최소 표본 정책이 필요
- §AC(local expert review)는 준비만 됐고 실행되지 않음 — V2 설계 확정 전 실행 권고

---

## 최종 보고 (E-JIP SCORE V2 STEP 0.8)

1. branch = `score-v2-step08-shadow-peer-validation`
2. base = `score-v2-step07a-safe-recovery-write`(commit `48c5d60`)

3. 대신해모로센트럴 nearest station = 서대신역(부산1호선)
4. distance = 140m
5. peer group key = `sggCd=26140(서구)::umdName=서대신동2가`
6. peer count = 17(LOCAL, tier HIGH)
7. peer rank = 7/17
8. 앞선 6개 전체 검증 결과 = 전부 실존 건물, 3/6이 PEER_FULL(HIGH quality) — "가짜 오염" 아님, 실제 초근접 소형단지 밀집 지역

9. 협성르네상스 nearest station = 서대신역(부산1호선)
10. distance = 306m
11. peer group key = `sggCd=26140(서구)::umdName=서대신동3가`
12. peer count = 22(LOCAL, tier HIGH) — STEP0.6 초기 시뮬레이션은 20으로 보고(원인: 알려진 문제 #1)
13. rank = 2/22
14. 앞선 peer 검증 = 대윤스위트(297m, PEER_FULL) 1건, 실존 건물 정상

15. 왜 두 peer universe가 다른가 = `umdName`(법정동) 자체가 다름(서대신동2가 vs 3가) — peer-groups.ts LOCAL 정의(§C)

16. CROSS_PEER_COMPARABLE = **NO**

17. 대신해모 LOCAL percentile(=shadow transport score) = 63.2
18. SIGUNGU percentile(절대 거리 기준) = 93.0
19. BUSAN percentile(절대 거리 기준) = 92.8

20. 협성 LOCAL(=shadow transport score) = 78.3
21. SIGUNGU percentile(절대) = 60.0
22. BUSAN percentile(절대) = 67.7

23. 서구 distance rank 대신해모 = 8/101
24. 서구 distance rank 협성 = 41/101
25. 서대신/동대신 combined rank = 대신해모 7/58, 협성 30/58

26. 대신해모 subway component = 40.06
27. bus component = 23.10
28. final transport = 63.16(=63.2)

29. 협성 subway component = 57.07
30. bus component = 21.21
31. final transport = 78.28(=78.3)

32. LABEL_SEMANTICS = **PARTIAL**

33. shadow transport mean delta = +0.39(median +0.27)
34. ≥10 change count = 23건
35. ≥20 change count = 7건

36. shadow total mean delta = +0.16(median 0.00)
37. ≥5 total change count = 65건(누적)
38. ≥10 total change count = 17건

39. 대신해모 current/shadow = total 47→48, transport 62.3→63.2
40. 협성 current/shadow = total 58→59, transport 78.5→78.3
41. 구덕금호 shadow handling = production 54점(coverage 0.85, 저품질 좌표 의존) → shadow **INSUFFICIENT_DATA**(coverage 0.15); 권고안 NOT_ENOUGH_DATA(§O, 미구현 제안)

42. benchmark count = 28개(STEP0 §11 로직 재사용 + 핵심 3개)
43. suspicious transport inversion count(distance gap≥200m) = 236,801건/1,359,139쌍(17.42%)
44. ≥200m inversion = 236,801건
45. ≥300m inversion = 144,915건
46. ≥500m inversion = 46,155건

47. DONG(R1) model stability = mean 50.0/stdev 17.2, 구별 스프레드 1.06x, inversion 144,915건
48. SIGUNGU(R2) model stability = mean 49.7/stdev 18.4, 구별 스프레드 1.02x, inversion 78,288건(R1의 54%)
49. recommended relative peer level = **SIGUNGU 우선(또는 최소 SIGUNGU를 1차 지표로 승격)** — DONG은 inversion을 거의 2배로 늘림

50. parking findings = coverage 25.3%(불변), ratio gap≥0.3 inversion 19,358건 — quality-filter로 해결 안 됨, 근본 원인은 registry 결측
51. school findings = elementary distance gap≥200m inversion 118,493건(transport와 동일 규모의 구조적 문제, 통학구역 데이터는 조인하지 않음)
52. complex findings = buildYear correlation r=0.772(production)/0.757(shadow), STEP0(0.825) 대비 소폭 하락 — quality-filter 영향은 작음
53. life findings = POI합계 기준 inversion 비율 20~26%대(4개 도메인 중 최고) — "거리"가 아닌 "밀도" 지표라 semantics가 다름(distance/quantity 분리 필요)

54. relative percentile recommended role = **B. SMALL COMPONENT**(A→B 하향, transport/school/life/parking 전부 유사 취약성 확인, complex만 상대적으로 견고)

55. Score V1 trust decision = **C. HIDE/DEEMPHASIZE**(카테고리별 percentile 서술에 한함; total score 자체는 quality-filter 영향이 작아 즉시 조치 불필요)

56. raw data trusted? = YES(§2 production formula 100% 재현 확인, STEP 0.5/0.7 raw fact 정확성은 이미 검증됨)
57. peer universe trusted? = **PARTIAL**(quality-filter는 유효하나, LOCAL 경계 자체가 구조적 결함)
58. cross-peer comparison trusted? = **NO**(§16 그대로)

59. expert credibility test defined = YES(§AB, 8개 항목 정의 완료, 실행은 미착수)

60. production Score changed? = NO
61. DB write? = NO
62. migration? = NO
63. API changed? = NO
64. UI changed? = NO

65. tests = shadow-score.test.ts 8/8 PASS + 기존 peer-quality.test.ts 20/20 PASS(회귀 없음)
66. tsc = 0 errors
67. lint = 0 errors/0 warnings
68. docs = 본 문서(`docs/development/EJIP_SCORE_V2_STEP08_SHADOW_PEER_VALIDATION.md`)
69. commit = 진행 예정(analysis/scripts/docs only)
70. push = 진행 예정
71. worktree clean = 진행 예정(커밋 후 확인)

72. BLOCKER = 없음

73. SCORE_V2_STEP08_CLOSE = YES
74. SCORE_V2_STEP1_READY = **YES**(raw coordinate 신뢰 확보·peer contamination 통제·cross-peer comparability 확인·relative percentile 역할 결정·benchmark anomaly 정량화·미확인 major bug 없음 — §31 조건 전부 충족)

75. NEXT_RECOMMENDATION = SCORE V2 STEP 1에서 "BUSAN/SIGUNGU 절대 percentile을 1차 지표, LOCAL percentile을 보조 지표"로 재설계(§AA)하고, parking registry coverage 확보 방안과 local expert review(§AC)를 우선 착수할 것을 권고한다.
