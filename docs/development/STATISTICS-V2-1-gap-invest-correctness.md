# STATISTICS V2.1 — Gap Investment Data Correctness Hotfix

상태: **구현 완료 — commit/push 안 함(ChatGPT 검수 대기)**

시작 HEAD: `a7f786e`(Statistics V2 구현 직전) → 이번 STEP §1에서 Statistics
V2 구현을 `dcc5168`로 커밋+푸시 완료(사용자 승인). STATISTICS V2.1은 그
이후 작업.

DB/schema/migration 변경 **0건**. Statistics 전체 UI 변경 **없음**(갭투자
화면 설명 문구 1줄만 수정). 새 통계 기능/이집점수 통합/SHARE-2 **없음**.

---

## 1. Statistics V2 commit + push

`git diff --name-only`로 Statistics V2 범위(수정 4 + 신규 6 = 10개 파일)
만 있음을 확인 후 `feat: redesign ejip statistics experience`(`dcc5168`)로
커밋, push. `HEAD == origin/main == dcc5168` 확인 완료.

---

## 2. GapInvest calculation trace(§2)

```
UI: src/app/stats/[type]/type-client.tsx → GapInvestView()
  ↓ useSWR('/api/stats/dashboard?lawdCd=...')
API: src/app/api/stats/dashboard/route.ts → GET()
  ↓ fetchMonthsThrottled() (src/lib/molit-stats-helpers.ts)
  ↓ fetchMolitData() (src/lib/api-molit.ts) — MOLIT 공공데이터 원본
계산: src/lib/gap-invest-calc.ts → buildGapCandidates() (이번 STEP에서 분리)
```

## 3. 기존 identity 확인(§3)

수정 전 pair key는 **단지명(정규화)뿐**이었다 — `normalizeAptName(t.name)`
하나로 묶고, 그 안에서 배열의 첫 원소(`apts[0]`/`rents[0]`)를 그대로
"최근 매매"/"최근 전세"로 썼다. **exclusiveArea·floor·date 어느 것도
identity에 포함되지 않았다** — 추정이 아니라 코드를 직접 읽어 확인.

---

## 4. 실제 오류 규모 실측(§9/§10) — 부산 해운대구(lawdCd 26350), 최근 3개월

> **정정**: 이전 버전 문서에서 lawdCd 26350을 "부산 서구"로 잘못 표기했다
> ("서구"는 stats-client.tsx의 기본 fallback 지역명일 뿐, 실제로 URL에
> `lawdCd=26350`을 직접 넘기면 그 값이 우선한다는 것을 확인 없이 넘겨짚었다
> — §추정 금지 원칙을 내가 스스로 어긴 사례). FINAL IDENTITY CHECK STEP에서
> `https://grpc-proxy-server-.../v1/regcodes`로 직접 조회해 26350 =
> **해운대구**(2635)임을 코드/API 응답으로 확인하고 정정했다. 아래 표의
> 우동/좌동/반여동/반송동/재송동 등은 전부 해운대구 소속 동이다.

`/api/transactions?type=apt|rent&lawdCd=26350&months=3`로 원본 거래를
받아 기존 로직을 그대로 재현해 실측했다(스크립트는 검증 후 삭제,
원본 데이터는 임시 스크래치 파일 — 커밋 대상 아님):

| 지표 | 값 |
|---|---|
| 3개월 유효 매매 거래 | 761건 |
| 3개월 유효 전세+월세 거래 | 1,373건(순수 전세 736건 / 반전세·월세 637건) |
| **기존 로직 갭 후보(gap≥0)** | **133건** |
| **그중 서로 다른 전용면적을 뺀 wrong-area pair** | **68건(51%)** |
| 취소(해제)된 매매 거래 | 0건(이번 표본 한정, §7) |
| `apts[0]`이 실제 최신 거래가 아닌 단지 수 | 0/177(이번 표본 한정, §6) |
| 수정 후 갭 후보(정확 페어링, gap≥0) | 251건, wrong-area **0건(구조적으로 불가능)** |
| 매매-전세 계약일 시간차(matched pair 기준) | 최소 0일 / 최대 72일 / 평균 21일 |

**wrong-area pair 실제 사례(상위 10건)**:

| 단지 | 매매 면적 | 전세 면적 | 갭(오염된 값) |
|---|---|---|---|
| 엘지 | 49.83㎡ | 134.94㎡ | 2억5,000만 |
| 해운대힐스테이트위브 | 114.7528㎡ | 158.6162㎡ | 3억400만 |
| 해운대두산위브더제니스 | 111.07㎡ | 127.6584㎡ | 5억3,000만 |
| 센텀두산위브 | 84.9988㎡ | 84.972㎡(0.03㎡ 차, AREA MODEL V1상 다른 값) | 2,000만 |
| 드파인센텀 | 59.9761㎡ | 74.715㎡ | 2,750만 |
| 더샵센텀파크1차 | 84.6389㎡ | 100.945㎡ | 4,200만 |
| 센텀현대 | 84.92㎡ | 59.84㎡ | 4,520만 |
| 장산동국 | 84.95㎡ | 59.64㎡ | 350만 |
| 센텀협성르네상스타운 | 73.4795㎡ | 84.4011㎡ | 2,600만 |
| 롯데캐슬스타 | 84.9177㎡ | 84.9953㎡(0.08㎡ 차) | 5,250만 |

**결론**: 51%라는 비율은 "가끔 발생하는 예외"가 아니라 **기존 로직의
구조적 결함**이었다 — 단지명만으로 묶고 배열 순서를 신뢰하는 한 필연적
으로 발생한다. UI disclaimer로 "다를 수 있음"이라고만 알리는 것으로는
부족하다고 판단한 사용자 지시가 실측으로 뒷받침됐다.

## 5. 반전세/월세 오염(트레이스 중 추가 발견, §17과 연결)

기존 gapInvest 코드는 `recentRentTrades`(전세+월세 합본)를 그대로 썼다
— 같은 파일의 전세가율(§6) 계산과 rankings.ts의 jeonse-risk는 이미
`monthlyRent>0`(월세)를 걸러내는데 gapInvest만 빠져 있었다. 반전세로
전환된 거래는 보증금이 원래 전세보다 훨씬 작아, 실제로는 "갭이 적은"
것이 아니라 "월세라 보증금 자체가 작은" 것을 소액 갭투자로 오인시킬
수 있다. 이번 표본에서 전세+월세 합본의 46%(637/1,373)가 월세였다 —
과소평가할 수 없는 비중이라 함께 고쳤다(§13 unresolved 아님, 이미 수정).

---

## 6. 수정 내용

### 6-1. Pair key(§5)

`(normalizeAptName(name), exclusiveAreaM2)` — **정확한 raw 전용면적**만
쓴다. AREA MODEL V1 원칙 그대로: 84.99와 84.996은 절대 병합하지 않고
서로 다른 키가 된다(§4/H번 테스트로 검증).

### 6-2. Latest 정의(§6)

각 (단지, 면적) 그룹 내부를 `dealDate`(MOLIT 원본 년/월/일 조합,
`api-molit.ts`가 이미 `YYYY-MM-DD`로 정규화해 둔 필드) 기준
**내림차순 명시 정렬** 후 첫 원소를 사용한다. API 응답 순서를 최신순
으로 가정하지 않는다(§C/D/E번 테스트로 검증 — 배열을 섞어도 결과가
동일함을 확인).

### 6-3. 취소 거래(§7)

`item.dealCanceled`(`해제여부==='O'`, 매매 상세 API에만 존재하는 원본
필드 — `api-molit.ts`가 이미 파싱해 둠)가 true인 거래는 pairing 후보에서
제외한다. 이번 3개월 표본에는 취소 거래가 0건이었지만, 기존 공통 필드를
그대로 재사용한 것이라 새 가정을 추가한 게 아니다.

### 6-4. 매매/전세 시간차(§8)

**임의 threshold로 제외하지 않았다.** 실측 결과(위 §4 표) 시간차는
0~72일, 평균 21일로 분포가 넓어 "N일 이내만 유효"식 기준을 지어낼
근거가 없었다 — 사용자 지시("먼저 실제 분포 확인")대로 분포만 확인하고
필터링은 추가하지 않았다.

### 6-5. No-jeonse / no-sale(§11)

`buildGapCandidates()`는 (단지, 면적) 조합이 **양쪽 모두**에 있을 때만
후보를 만든다 — 한쪽만 있으면 애초에 후보 자체가 생기지 않는다(§F/G번
테스트로 검증).

### 6-6. Low confidence(§12)

`excluUseArea == null`(파싱 실패)인 거래는 pairing에서 완전히 제외한다
— `null`끼리 같은 키로 묶이는 스푸리어스 매칭을 막기 위함이다. "계산
불가"가 잘못된 숫자보다 낫다는 원칙 그대로, 억지로 숫자를 만들지 않는다.

---

## 7. UI label(§13) / 기존 disclaimer(§14)

`GapInvestView`의 `SectionHeader` description을 계산과 정확히 일치하게
수정했다:

- 이전: "최근 3개월 · 매매-전세 근사 갭. 단지 내 최근 매매 1건과 전세
  1건을 비교한 근사값으로, 두 거래의 **면적**·시점이 다를 수 있습니다."
  (계산 오류를 가리는 문구 — 제거)
- 이후: "최근 3개월 · **동일 전용면적**의 최근 매매·전세 거래 기준.
  두 거래의 계약 **시점(날짜)**은 다를 수 있어 참고용으로 활용하세요."
  (면적 관련 caveat 제거 — 이제 항상 동일 면적, §6-1로 보장됨. 시점
  차이 caveat는 유지 — §6-4에서 확인했듯 실제로 남아있는 한계이므로)

---

## 8. Tests(§15) — `scripts/apartment-score/verify-statistics-v2-1-gap-invest.ts`

A~H 전부 + 추가 3건, 총 15개 assert:

| # | 케이스 | 결과 |
|---|---|---|
| A | same apt + same area → pair | PASS |
| B | same apt + different area → no pair | PASS |
| C | multiple sale → newest date | PASS |
| D | multiple jeonse → newest date | PASS |
| E | unsorted API input → newest 선택(배열 순서 무관, 결과 동일성까지 확인) | PASS |
| F | missing sale → no gap | PASS |
| G | missing jeonse → no gap | PASS |
| H | raw precision different(84.99 vs 84.996) → no forced merge(양쪽 다 짝 없을 때 1건만 후보 / 양쪽 다 짝 있을 때 별개 2건) | PASS |
| 추가 | 취소 거래 제외 | PASS |
| 추가 | excluUseArea null 제외(null끼리 안 뭉침) | PASS |
| 추가 | normalizeAptName 동등성 | PASS |
| 추가 | route.ts가 실제로 buildGapCandidates를 씀(인라인 로직 잔존 없음) | PASS |
| 추가 | 전세는 순수 전세만 넘김(반전세/월세 필터 확인) | PASS |
| 추가 | §6 전세가율 계산은 미변경 확인 | PASS |

기존 `verify-statistics-v2.ts`의 "gapInvest 계산 미변경" assert는 이번
STEP의 목적과 모순되므로(계산을 의도적으로 고쳤다) 새 assert(계산
코드 자체가 사라지지 않았는지, §41 참고)로 교체했다 — 나머지 19개
assert는 전부 그대로 재통과.

---

## 9. Regression(§16)

`/stats/gap-invest`를 375/390/430/1024/1280px에서 실측 — 가로 overflow
0건. 시각적으로 `SectionHeader` 설명 문구 1줄만 바뀌었고, 나머지
레이아웃(RankingRow 목록, 표본 적음 배지 등)은 STATISTICS V2 그대로다.

## 10. Type/build(§17)

`npx tsc --noEmit` 0 errors / `npx eslint src` 0 errors(무관 기존 warning
3건만) / `npx next build` 성공(동일 30 route) / 기존 스위트(APT-IA 13 +
DS-2 22 + DS-3 18 + Statistics V2 20) + 신규 15 = **88개 전부 PASS**.

## 11. DB(§18)

schema/migration 변경 **0건**(`prisma/schema.prisma` 미변경).

---

## 12. Unresolved(§4 시점 기준 — §15 FINAL IDENTITY CHECK에서 3번 항목 해소)

1. 매매-전세 시간차(0~72일, 평균 21일)는 여전히 존재 — UI disclaimer로
   안내만 하고 임의 threshold를 도입하지 않았다(§8 지시대로). 향후
   "N일 이내" 같은 기준이 필요하다면 별도 승인 STEP.
2. §4 실측은 부산 해운대구(lawdCd 26350) 3개월 표본 1곳 기준이었다 —
   §15에서 3개구를 추가 실측해 부분적으로 넓혔다(아래).
3. ~~`normalizeAptName` 기반 단지 identity(aptSeq 미사용)~~ → §15에서
   aptSeq 기반으로 교체해 해소.

## 13. BLOCKER

없음(§4 시점).

---

## 15. FINAL IDENTITY CHECK(추가 STEP — 같은 V2.1 범위 내 identity 강화)

### 15-1. 현재 identity fields 전수 확인

MOLIT 거래 객체(`api-molit.ts`가 매매/전세 API 응답을 파싱해 만드는
객체)와 dashboard fetch 컨텍스트에서 **실제로 존재하는** identity 후보
필드를 코드로 확인(추정 없음):

| 필드 | 존재 여부 | 비고 |
|---|---|---|
| `aptSeq` | **존재** | MOLIT 원본 단지 고유번호(`item.aptSeq`), 문자열 그대로 보존 |
| `lawdCd` | 존재(단, per-trade 필드 아님) | API 요청 파라미터 — 응답 전체가 이미 하나의 lawdCd로 스코프됨 |
| `sigungu` | 미존재(파생 가능) | lawdCd로부터 유도 가능하나 원본 필드 자체는 없음 |
| `dong`(법정동) | **존재** | `item.법정동`/`item.umdNm` |
| `jibun`(지번) | **존재** | `item.지번`/`item.jibun` |
| road address(도로명주소) | **미존재** | MOLIT RTMS 실거래 API 자체가 지번 기반이라 도로명주소 필드가 없음(임의 생성 안 함) |
| apartment name | **존재** | `item.아파트`/`item.aptNm` 등 |
| exclusiveArea | **존재** | `item.excluUseArea`(raw 숫자) |

### 15-2. 부산 4개구 실측(5,695건, 835개 정규화 단지명)

`/api/transactions?type=apt|rent&lawdCd=...&months=3`로 해운대구(26350,
2,134건)/부산진구(26230, 2,068건)/동래구(26260, 1,113건)/서구(26140,
380건) 원본 거래를 받아 확인:

| 지표 | 결과 |
|---|---|
| `aptSeq` 존재율 | **2,134/2,134, 2,068/2,068, 1,113/1,113, 380/380 — 4개구 전부 100%** |
| 같은 정규화 이름, 2개 이상 동에 분산 | 11/835(1.3%) — 예: "삼익"(부산진구 당감동/연지동, 동래구 온천동/사직동), "신동아"(해운대구 우동/반여동) |
| 같은 이름 + 동일 exclusiveArea + 다른 동(동명이인 위험) | **0건**(4개구 전체, 이번 표본 한정) |
| 매매 API ↔ 전세 API aptSeq 교차 일치율 | **404/406(99.5%)** |

### 15-3. aptSeq 불일치 2건 — 데이터 결함이 아니라 "진짜 다른 단지" 증거

교차 불일치 2건을 개별 확인한 결과 **둘 다 실제로 이름만 같은 서로
다른 물리적 단지**였다:

- **부산진구 "수목하우스"(양정동)**: 매매 쪽 `jibun=343-3, aptSeq=
  26230-2325` vs 전세 쪽 `jibun=141-10, aptSeq=26230-2485` — **같은
  동인데도** 지번과 aptSeq가 완전히 다르다. 동(dong) 단위 폴백만으로는
  이 충돌을 못 잡는다는 걸 실측으로 증명한 사례.
- **동래구 "경보이리스힐"**: 수안동/온천동 두 곳에 존재, aptSeq도 다름
  (기존 §4 "같은 이름, 다른 동" 목록에 이미 있던 사례).

→ aptSeq는 이름 문자열보다 **더 정확한** 신호였다. "데이터 결함이라
못 믿겠다"가 아니라 "이름만으로는 못 잡는 걸 aptSeq가 잡아냈다"는
결론이다.

### 15-4. API 지역 격리(§3) — 코드로 확인

`dashboard/route.ts`는 요청당 **정확히 하나의 `lawdCd`만** 해석하고
(`const lawdCd = lawdCdParam ?? await resolveLawdCd(...)`, 21번째 줄),
이후 모든 `MonthTask`와 캐시 키(`stats-dashboard:${lawdCd}`)가 이
하나의 값에 고정된다 — **한 번의 API 응답 안에서 서로 다른 lawdCd의
데이터가 섞이는 경로 자체가 없다.** 다른 지역 동명이인 혼입은 구조적
으로 불가능하고, 위험은 오직 **같은 lawdCd 안의 동명이인**(§15-2/15-3)
에만 있다 — 이번 수정이 정확히 그 위험을 겨냥한 것이다.

### 15-5. 최종 pair key 결정

**`aptSeq`(있으면 최우선) → 없으면 `(dong, normalizedName)` 폴백**,
그 뒤에 항상 exact `exclusiveArea`를 결합한다:

```
key = aptSeq ? `seq:${aptSeq}` : `fallback:${dong}::${normalizedName}`
pairKey = `${key}::${exclusiveAreaM2}`
```

`src/lib/gap-invest-calc.ts`의 `complexIdentityKey()`로 구현. aptSeq가
4개구 전체에서 100% 존재했지만, 전국 다른 지역/시기에 없는 경우를
배제할 수 없어 방어적으로 폴백 경로를 유지했다(§5 지시대로 "실제
데이터가 지원하는 가장 강한 identity"). `lawdCd`는 §15-4에서 확인했듯
호출부가 이미 완전히 격리하므로 key에 별도로 넣지 않았다(넣어도
항상 상수라 무의미).

### 15-6. Wrong-apartment pair — before/after(§10/§F)

기존(단지명+면적)으로도 이번 4개구 표본에서는 동명이인 오염 사례가
0건이었다(§15-2). 즉 **오늘 시점 수치상의 개선은 0→0**이다. 그러나
이는 "위험이 없다"가 아니라 "이번 표본에서 우연히 안 터졌다"는
뜻이다 — 11개 동명이인 후보(§15-2) 중 하나라도 미래에 겹치는 면적
거래를 가지면 즉시 오염된다. §15-3에서 실제로 aptSeq만 다르고 이름·
동까지 같은 사례("수목하우스")를 찾아낸 것 자체가 "동만으로는 불충분"
하다는 직접 증거다. aptSeq 적용은 **선제적 하드닝**이며, 오늘 발생한
사고를 되돌린 것이 아니라 내일 발생할 수 있었던 사고를 막은 것이다.

### 15-7. Tests(§7)

`verify-statistics-v2-1-gap-invest.ts`에 6개 신규 assert 추가(총
21개로 증가, 전부 PASS):

- 같은 이름 + 다른 동 + 같은 면적, aptSeq 다름 → pair 금지
- 같은 이름 + **같은 동** + aptSeq 다름("수목하우스" 실측 축소판) → pair 금지
- 같은 aptSeq + 같은 면적 → 정상 pair(이름/동 표기 편차와 무관)
- aptSeq 둘 다 없음 → (동, 이름) 폴백으로 정상 pair
- aptSeq 한쪽만 없음 → pair 금지(불확실한 데이터로 억지 생성 안 함, §12)
- 취소거래/월세오염 방지는 §8(기존 15개)에서 이미 커버, 재확인 통과

### 15-8. 기존 표본 재검증 + 신규 3개구

§4의 해운대구 표본을 이 STEP에서 재확인했고(§15-2 표), 부산진구/
동래구/서구 3곳을 추가했다 — 총 4개구, 5,695건, 835개 단지명.

### 15-9. STATISTICS_V2_1_FINAL_CLOSE

**YES.** aptSeq 100% 가용성 + 실제 동명이인 사례 발견(수목하우스)을
근거로 aptSeq 우선 identity를 채택했다. BLOCKER 없음.

## 16. STATISTICS_V2_1_CLOSE / SCORE_V1_1_GO(종합)

**STATISTICS_V2_1_CLOSE**: YES(§4 계산 수정 + §15 identity 강화 전부 포함).
**STATISTICS_V2_1_FINAL_CLOSE**: YES(§15-9). **SCORE_V1_1_GO**: Statistics
V2와 동일하게 조건부(이집점수 배치 조회 API 선행 필요) — 이번 STEP과는 무관.
