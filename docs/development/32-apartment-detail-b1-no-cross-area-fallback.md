# STEP 32 — APT DETAIL B1-FIX3: 선택 평형 거래 없음 cross-area fallback 제거

상태: 구현 완료 / 검수중(사용자 모바일 검수 후 최종 승인 대기, commit/push 없음)

성격: STEP 31(B1-FIX2)이 만든 `heroTrade` 구조에 남아 있던 마지막 fallback
경로(선택 평형에 거래가 없을 때 다른 평형으로 넘어가는 것) 하나만 제거. 기준 commit
`f63bd872f05d64569d9f5e49477d4f0a061e3c1a`(STEP 30/31 미커밋 변경 그대로 보존).

새 문서로 분리한 이유: STEP 31은 "충돌 라벨 통일 + Hero가 latestPrice와 같은 거래를
가리키게 함"이 주제였고, 이번 STEP은 "그 거래 자체가 없을 때 무엇을 보여줄 것인가"라는
별개의 정책 결정(empty state)이 핵심이라 실측 사례·검증 항목이 다르다. 30/31처럼
STEP 단위로 분리해 기록하는 기존 관행을 따랐다.

---

## 0. 작업 시작 전 확인

git status --short / diff --stat / HEAD / origin 대비 ahead-behind 확인 결과, STEP 31이
남긴 정확히 예상된 7개 production 파일 + 2개 문서만 미커밋 상태였고 HEAD는 여전히
`f63bd87`(origin/main과 동일)이었다. 예상 밖 변경 없음 — STOP 없이 진행.

## 1. 코드 구조 추적 (수정 전 확인)

`src/app/apt/[name]/apt-client.tsx`를 실제로 읽고 각 값의 근거를 확인했다(추측 없음):

- `selectedArea` — `useState<string>('전체')`. "전체" 상태는 코드에 실제로 이 리터럴
  문자열로 존재(`selectedArea !== '전체'` 등 여러 곳에서 사용 확인).
- `tradeTypeFilter` — `useState<'매매'|'전월세'>('매매')`.
- `trades` — API가 돌려준, 현재 `tradeTypeFilter`(fetch 시점의 `type=apt|rent`)로
  이미 좁혀진 배열. area 필터는 걸려 있지 않음.
- `filteredTrades` — `trades`에 평형(`selectedArea`)·거래유형·`saleFilter`·기간
  4중 필터를 적용한 배열. **평형 필터 자체가 `selectedArea !== '전체' && trade.area
  !== selectedArea`로 조건부라서, `selectedArea === '전체'`일 때는 이 필터가 아무
  것도 걸러내지 않는다** — 즉 `filteredTrades[0]`는 '전체' 상태에서 이미 "현재
  거래유형 전체 최신 거래"와 동일한 값이다(별도 분기 불필요, §4).
- `heroTrade`(STEP 31에서 도입) — 문제의 원인. 아래 §2.
- `latestPrice`/`latestPriceNum` — STEP 31 이전까지 `heroTrade`와 별개로 자기만의
  fallback(`filteredTrades[0] ?? trades[0]`)을 갖고 있어 **같은 버그가 가격에도
  있었다**(§2).
- 최고가/최저가(719번째 줄 부근) — `filteredTrades`가 비면 이미 `'-'`를 보여준다.
  다른 평형 값으로 fallback하지 않음 — **이미 올바름**, 수정하지 않음(§6).
- `InvestmentMetrics`/`PriceTrendChart` — `selectedArea`를 아예 prop으로 받지 않는다.
  코드 주석에 "부모의 tradeTypeFilter(매매/전월세 단일 선택)와 무관하게... 자기완결형
  패턴"이라고 명시돼 있고, 각각 최근 6개월/기간별 매매+전세를 항상 전체 평형
  기준으로 조회한다 — **애초에 selectedArea에 종속되지 않도록 설계된 컴포넌트**라
  "다른 평형으로 fallback"이라는 개념 자체가 적용되지 않는다. `InvestmentMetrics`의
  전세가율 계산에 있는 `matchedRent = ... || sortedRent[0]`는 별도의, 이미 화면에
  `*` + 툴팁("동일 평형 매물이 없어 다른 평형의 최근 거래 기준으로 계산(참고용)")으로
  투명하게 표시되는 fallback이라 이번 STEP의 대상이 아니다(§7).
- `TradeTimelineList` — `trades={filteredTrades}` prop만 받고, 비어 있으면 다른
  데이터로 대체하지 않고 "거래 내역이 없습니다."를 보여준다 — **이미 올바름**,
  수정하지 않음(§9).

## 2. 기존 cross-area fallback 원인

STEP 31에서 도입한 코드:

```
const heroTrade = filteredTrades.length > 0 ? filteredTrades[0] : (trades.length > 0 ? trades[0] : null);
const latestPrice = filteredTrades.length > 0 ? filteredTrades[0].priceStr : (trades.length > 0 ? trades[0].priceStr : '조회 중...');
```

`selectedArea`가 특정 평형이고 그 평형+현재 거래유형에 거래가 하나도 없으면
`filteredTrades`가 비고, 이때 `trades[0]`(선택 평형과 무관한, 현재 거래유형 전체의
최신 거래 — 즉 다른 평형일 수 있음)로 넘어갔다. 그 결과 칩은 여전히 특정 평형을
가리키는데 Hero의 가격·면적·층·거래일은 전혀 다른 평형의 거래를 보여줄 수 있었다.

## 3. 최종 정책 및 구현

```
const heroTrade = filteredTrades.length > 0 ? filteredTrades[0] : null;

const latestPrice = heroTrade
  ? heroTrade.priceStr
  : (trades.length > 0 ? '거래 없음' : '조회 중...');
const latestPriceNum = heroTrade ? heroTrade.price : 0;
```

`: (trades.length > 0 ? trades[0] : null)`이라는 cross-area fallback 한 조각만
`: null`로 바꿨다. §1에서 확인했듯 `selectedArea === '전체'`일 때는 area 필터가
no-op이라 `filteredTrades[0]`가 원래도 "전체 최신 거래"와 같으므로, `if (selectedArea
=== '전체') {...} else {...}` 같은 별도 분기를 추가하지 않고 이 한 줄로 스펙의 두
정책(A: 전체 선택 시 전체 최신 거래, C: 특정 평형 선택 시 다른 평형 fallback 금지)이
동시에 성립한다.

`latestPrice`(StickyPriceBar·대출한도 모달처럼 문장형 안내를 넣을 공간이 없는 곳에서
쓰는 짧은 문자열)는 두 가지 "없음" 상태를 구분한다:

- `trades.length === 0`(아직 아무 거래도 못 불러온 상태 — 이번 버그와 무관한 기존
  상태) → 기존 그대로 `'조회 중...'`.
- `trades.length > 0`인데 선택 평형+거래유형에만 거래가 없는 상태(이번 버그의 대상)
  → 다른 평형 가격을 빌려오지 않고 짧게 `'거래 없음'`.

Hero의 큰 가격 영역(문장형 메시지를 넣을 공간이 있는 곳)은 `heroTrade` 유무로 직접
분기해 스펙이 제시한 문구를 그대로 썼다:

```jsx
{heroTrade ? (
  <>{/* 기존 가격·면적·층·거래일 표시, STEP 31과 동일 */}</>
) : selectedArea !== '전체' ? (
  <div>해당 평형의 최근 거래가 없습니다.</div>
) : (
  <span className={styles.price}>{latestPrice}</span>
)}
```

선택된 평형 칩(AreaSelector)의 선택 상태는 `selectedArea` state를 그대로 두므로
전혀 사라지지 않는다 — 사용자가 무엇을 선택했는지는 계속 보인다.

## 4. 실데이터 검증 — asymmetric 사례 2건

curl로 같은 단지의 `type=apt`/`type=rent` 응답에 등장하는 area 집합을 직접 비교해
실제 비대칭 사례를 찾았다(억지 fixture 없음):

**사례 1 — 매매 있음 / 전세 없음**: 명륜아이파크1단지(lawdCd 26260, dong 명륜동,
5년). 매매 area 집합에는 `84.919m²`가 있고 전세 area 집합에는 없음(나머지는 양쪽에
공통 존재).

**사례 2 — 전세 있음 / 매매 없음**: 대연힐스테이트푸르지오(lawdCd 26290, dong
대연동, 5년). 전세 area 집합에는 `163.69m²`가 있고 매매 area 집합에는 없음.

## 5. 비교 검증(실브라우저)

### 5.1 사례 1 — 84.919㎡, 매매 → 전세

| | 매매(정상) | 전세(빈 데이터) |
|---|---|---|
| Hero | 8억 5,000만 · 전용 84.919㎡ · 약 25.7평 · 2층 · 2021-09-02 | **해당 평형의 최근 거래가 없습니다.** |
| 최고/최저 | 최고 8억 5,000만 / 최저 8억 5,000만 | 최고 - / 최저 - |
| 선택 칩 | `84.919㎡` 활성 | `84.92㎡`(같은 원본값, 전세 데이터셋 안에서는 충돌 상대가 없어 2자리로 표시 — STEP 31의 라벨 정책 그대로) 활성 유지 |
| Timeline | (해당 없음) | "전용 84.92㎡ · 약 25.7평 · 총 0건" / "거래 내역이 없습니다." |

전세에서 다시 매매로 되돌리면 8억 5,000만 · 84.919㎡ · 2층 · 2021-09-02로 정확히
복귀함을 확인(§10 요구사항).

### 5.2 사례 2 — 163.69㎡, 전세 → 매매

| | 전세(정상) | 매매(빈 데이터) |
|---|---|---|
| Hero | 보 4억 · 전용 163.69㎡ · 약 49.5평 · 38층 · 2026-07-20 | **해당 평형의 최근 거래가 없습니다.** |
| 최고/최저 | 최고 8억 8,000만 / 최저 4억 | 최고 - / 최저 - |
| 선택 칩 | `163.69㎡` 활성 | `163.69㎡` 활성 유지(매매 데이터셋에 아예 없는 값이라 AreaSelector가 강제 포함) |

두 사례 모두 다른 평형의 가격·면적·층·날짜가 전혀 섞이지 않았고, 칩 선택 상태는
그대로 유지됐다.

### 5.3 "전체" 회귀 검증

같은 단지(대연힐스테이트푸르지오)에서 "전체" 칩으로 되돌린 뒤 매매/전세 각각 확인:

- 매매: 10억 1,500만 · 전용 84.36㎡ · 약 25.5평 · 14층 · 2026-08-06, 최고 16억/최저
  5억 3,000만 — 정상.
- 전세: 보 1억/월세 170만 · 전용 99.51㎡ · 약 30.1평 · 2층 · 2026-08-11, 최고
  10억/최저 0만 — 정상.

이번 FIX로 "전체" 상태가 깨지지 않음을 확인했다.

## 6. 최고가/최저가 처리

§1에서 확인한 대로 이 블록(`filteredTrades.length > 0 ? Math.max/min(...) : '-'`)은
STEP 31 이전부터 이미 다른 평형으로 fallback하지 않고 있었다 — 코드 변경 없음.
실브라우저 검증(§5.1, §5.2)에서도 두 empty 사례 모두 "최고 - / 최저 -"로 정상
표시됨을 재확인했다.

## 7. InvestmentMetrics / PriceTrendChart 확인

§1에서 확인한 대로 두 컴포넌트 모두 `selectedArea`를 prop으로 받지 않는 자기완결형
설계라(코드 주석에 명시) 이번 STEP의 "선택 평형 cross-area fallback" 문제와 무관
하다 — 코드 변경 없음. `InvestmentMetrics`의 전세가율 계산에 있는 자체 fallback은
이미 UI에 `*` 표시로 투명하게 안내되고 있어 그대로 유지했다.

## 8. 회귀 검증

- 매매 토글(§5.1 84.919㎡ 매매 정상, §5.3 전체 매매 정상)
- 전월세 토글(§5.2 163.69㎡ 전세 정상, §5.3 전체 전세 정상)
- 전체 선택 매매/전세(§5.3)
- TradeTimeline fallback 없음(§5.1, TradeTimelineList 코드 자체 무변경)
- Chart/Metrics fallback 없음(원래부터 selectedArea 미반영 설계, §7)
- chip selection: 두 empty 사례 모두 선택 칩이 그대로 유지됨(§5.1, §5.2)
- 면적 precision 정책(STEP 31): 코드 변경 없음, `getUniqueAreaLabels`/
  `resolveAreaLabel`/`getAreaDetailLabel` 시그니처·동작 무변경
- 공유/Header/로그인/StickyPriceBar/하단 nav: 이번 STEP에서 코드 변경 없음(git diff로
  재확인 — 변경 파일은 `apt-client.tsx` 하나뿐)

## 9. 정적 검증

- `npx tsc --noEmit` — 에러 없음
- `npx eslint`(수정 파일 한정) — 에러 0, 기존 경고 1건(무관 위치, STEP 30 이전부터
  존재)
- `npx prisma validate` — 통과
- `npx prisma migrate status` — up to date
- `npm run build` — 성공

## 10. 절대 변경 금지 항목 준수

이번 STEP에서 수정한 production 파일은 `src/app/apt/[name]/apt-client.tsx` 1개뿐이다
(git diff로 재확인). 차트 시각화, 교통/버스/생활편의/POI, 점수체계, 추천엔진, 관심
기능, 건축물대장, 커뮤니티, 메인페이지, SEO, API contract, DB/schema/migration/
package/infra 중 어느 것도 건드리지 않았다. StickyPriceBar/Header/공유/chip 디자인/
차트 디자인도 코드·CSS 변경 없음 — Hero 안에서 `heroTrade` 유무에 따라 보여줄
문자열을 바꾼 것 외에 새 CSS 클래스나 spacing/font-size 변경은 없다(empty state
텍스트에 인라인 style 3개만 추가).

## 11. 다음 STEP 후보 없음

이번 STEP으로 STEP 30(면적 표기)·STEP 31(Hero 소스 일관성)·STEP 32(cross-area
fallback 제거)가 다루려던 문제는 모두 해소됐다. 이후는 사용자 모바일 검수 결과에
따른 후속 STEP 여부를 기다린다.
