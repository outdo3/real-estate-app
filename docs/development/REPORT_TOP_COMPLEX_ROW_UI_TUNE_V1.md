# REPORT TOP COMPLEX ROW UI TUNE V1

**상태: 구현 완료 / UI ONLY / 데이터·집계·API 변경 0건 / DB·schema 0건 / STRUCTURAL PASS · DEVICE QA REQUIRED**

작성일 2026-09-12 · branch `main` · 기준 HEAD `ae23e6e`

---

## 1. 목적

한장 리포트의 **"거래가 많은 단지"** 섹션을 한 줄 `[단지명] [N건]`으로 정리한다.

```
대신해모로센트럴아파트                    5건
```

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              ae23e6e  fix(stats): fit the region-change map to the selected region…
tracked dirty     package.json, package-lock.json   (사용자 작업물 — 건드리지 않음)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용. untracked 사용자
작업물 보존. DB·schema 변경 0건, Production write 0건.

---

## 3. 감사 — 대상 컴포넌트

| 항목 | 실제 코드 |
|---|---|
| 섹션 정의 | `src/lib/report/region-report.ts` §218 — `key: 'representativeComplexes'`, `title: '거래가 많은 단지'`, 상위 5곳 |
| 집계 | `src/lib/report/region-aggregate.ts` `representativeComplexes()` — aptSeq 우선 그룹핑, `건수 → 최신 거래일 → 이름` 정렬 |
| cells | `{ aptSeq, aptName, dong, count, latestDealDate }` — **가격·전용면적이 없다** |
| 렌더 (변경 전) | `src/components/report/RegionReportSheet.tsx`의 `TradeSection` — "최근 실거래"와 **같은 컴포넌트**를 공유 |
| CSS | `ReportSheet.module.css` `.tradeRow` / `.tradeMeta` / `.tradeDate` / `.tradePrice` |
| 소비처 | `RegionReportSheet`만(`envelope.sections.find(key === 'representativeComplexes')` 1곳). 일별·단지·비교 리포트는 이 섹션을 쓰지 않는다 |

**왜 2줄이 됐나:** `TradeSection`은 `[이름 + 부줄] … [가격]` 구조인데 이 섹션에는 가격이
없다. 그래서 오른쪽이 비고, 건수는 부줄로 내려가 `동 · N건 거래`가 됐다 — 같은 정보가
두 줄로 흩어지고 오른쪽 여백만 남는 형태였다.

---

## 4. 변경 전 / 변경 후

**변경 전**

```
대신해모로센트럴아파트                        (오른쪽 비어 있음)
대신동 · 5건 거래
```

**변경 후**

```
대신해모로센트럴아파트                    5건
```

`TradeSection`을 건드리지 않고 **별도 `ComplexCountSection`**을 추가해 이 섹션만 쓴다.
"최근 실거래"는 2줄 구조·가격·전용면적·계약일 그대로다.

섹션 헤드 meta도 `5건` → `상위 5곳`으로 바꿨다. 행마다 `N건`이 나오는데 헤드에도 `5건`이
있으면 "총 5건"으로 읽힌다 — 분포 섹션이 이미 쓰는 `상위 N곳` 표기에 맞췄다.

`TradeSection`의 `meta`에 남아 있던 `` `${count}건 거래` `` 조각도 제거했다. 그 조각은
이 섹션 전용이었고, 남은 소비처(최근 실거래)의 행에는 `count` 자체가 없다(`enrichRows`의
cells 참고) — 즉 출력은 바뀌지 않고 "5건 거래" 문자열만 코드에서 사라진다.

---

## 5. 지역 부줄 제거 — §3 예외 감사

브리프 §3의 "동일 이름 아파트 구분에 region이 반드시 필요한 로직이 있는지" 확인:

- 행 `key`는 `c.aptSeq ? 'id:…' : 'nd:aptName|dong'` — **동은 key에만 쓰이고 표시와 무관**하다.
- 상세 링크 `aptHref()`는 `aptSeq`만 쓴다(없으면 링크를 만들지 않는다). 동이 필요 없다.
- 동 단위 리포트는 이미 `showDong=false`로 동을 숨긴다.

Production 실측(2026-09-12, 부산 매매 최근 12개월, 읽기 전용):

| 항목 | 값 |
|---|---|
| 같은 구 · 같은 이름 · 다른 `aptSeq` 그룹 | **43건** |
| 그중 법정동까지 같아 동으로도 구분 불가 | **1건** (부곡늘푸른아파트, 부곡동 2건) |
| **구별 상위 5위 안에 같은 이름이 둘 이상 든 경우** | **0건** |

예: 부산진구 `유림노르웨이숲`이 구포동 50건 / 만덕동 13건으로 **따로** 존재한다.

→ **지금은 한 건도 없지만 구조적으로 가능하다.** 그래서 기본은 이름만 쓰고, **같은 목록
안에서 이름이 겹치고 그 그룹의 동이 서로 다를 때만** 그 행들에 동을 인라인으로 덧붙인다
(`유림노르웨이숲 (구포동)`). 여전히 한 줄이라 밀도는 그대로이고, 겹치지 않는 평상시
출력은 이름 그대로다. 동까지 같은 1건은 붙여도 구분이 안 되므로 붙이지 않는다(없는
지역명을 만들지 않는다).

판정은 순수 함수 `src/lib/report/complex-row-labels.ts`에 있고 DB/네트워크에 닿지 않는다.

---

## 6. 타이포그래피 / 레이아웃

```css
.complexRow   { display:flex; align-items:center; justify-content:space-between;
                gap:10px; padding: var(--r-trade-pad) 0; }
.complexName  { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
                white-space:nowrap; font-size: calc(0.94rem * var(--r-fs)); font-weight:700; }
.complexCount { flex-shrink:0; white-space:nowrap; font-size: calc(0.9rem * var(--r-fs));
                font-weight:700; font-variant-numeric: tabular-nums; }
```

- 긴 이름은 **이름만** 줄어들고 말줄임된다 → 건수가 화면 밖으로 밀리지 않는다.
- 건수는 `flex-shrink: 0` + `nowrap`이라 절대 잘리지 않는다.
- 건수를 과하게 키우지 않았다: 이름 0.94rem/700 vs 건수 0.9rem/700(더 크지도 굵지도 않다).
- `tabular-nums`로 숫자 폭을 고정해 `3건`/`16건`/`123건`이 섞여도 오른쪽 끝이 흔들리지 않는다.
- 세로 여백은 기존 `--r-trade-pad` 토큰을 공유한다 → A4(5px)/print(3px) 밀도 모드가
  **자동으로** 적용된다(밀도 규칙을 두 벌로 만들지 않았다).
- 기존 클래스(`.tradeRow` 등)는 재정의하지 않고 새 클래스 3개만 추가했다(테스트가 중복
  선언 0을 고정한다).

---

## 7. 모바일 / export

- 섹션이 5줄×2 → 5줄×1이 되어 **A4 한 장 예산이 오히려 여유로워진다.** 남는 공간은
  기존 `data-export-fill='spread'` 로직이 처리한다(새 규칙 없음).
- `data-export-fixed-size` / `data-export-root` / `data-export-cap` 장치는 손대지 않았다.
  새 행에는 고정 크기 요소가 없다(막대가 없다).
- 실제 360/390/430px 렌더와 PNG/PDF 산출물 확인은 브라우저가 필요하다 → §10.

---

## 8. 데이터 로직 무변경 (§7)

건수 계산·단지 ranking·정렬·기간·집계 source·canonical identity·report API **전부
그대로**다. 변경은 `RegionReportSheet`의 배치와 CSS, 그리고 표시 이름을 고르는 순수
함수뿐이다. 테스트가 다음을 고정한다: 그룹 키(`aptSeq` 우선), 정렬식, `count += 1`,
섹션 제목·상위 5곳·`cells` 구성·trust 판정, `aptSeq` 없이는 링크를 만들지 않는 규칙.

---

## 9. 검증

```
npx tsx --test src/lib/report/complex-row-labels.test.ts     23/23 pass
npx tsx --test "src/**/*.test.ts"                          1120/1120 pass (신규 23 포함, 회귀 0)
npx tsc --noEmit                                           src/ 오류 0
npx eslint <변경·신규 파일 3개>                                오류 0 / 경고 0
npm run build                                              ✓ Compiled successfully in 4.1s
```

브리프 §9의 최소 8항목 전부 대응(아파트명 렌더 / `5건` 표기 / `5건 거래` 미사용 / 부줄
제거 / 긴 이름이 건수를 밀지 않음 / 건수 nowrap / 데이터 무변경 / export 장치 무변경).

---

## 10. DEVICE QA REQUIRED

1. `/report/district/[lawdCd]`, `/report/dong/…`, `/report/city/busan`에서 "거래가 많은
   단지"가 한 줄 `[이름] [N건]`으로 보이는지.
2. 360 / 390 / 430px에서 긴 단지명(예: `대신해모로센트럴아파트`, `에코델타시티 아테라(24BL)`)이
   말줄임되고 **건수가 잘리지 않는지**.
3. 2자리/3자리 건수가 섞였을 때 오른쪽 끝이 흔들리지 않는지.
4. PNG export / PDF(A4) export에서 같은 행이 한 줄로 나오고 잘리지 않는지.
5. "최근 실거래" 섹션이 예전과 동일한지(2줄 + 가격).
6. 같은 이름 두 단지가 상위 5위에 함께 드는 지역이 생기면 `이름 (동)`으로 구분되는지
   (현재 실측 0건이라 인위적으로 만들기 어렵다 — 발견 시 확인).

---

## 11. 알려진 문제 / 범위 밖

1. **동까지 같은 1건**(부곡늘푸른아파트)은 이 섹션에서 구분할 방법이 없다 — 변경 전
   2줄 UI도 마찬가지였다(둘 다 `부곡동 · N건 거래`). 구분이 필요하면 세대수/준공연도 같은
   다른 식별 정보를 붙여야 하고 그건 별도 STEP이다.
2. **일별 리포트(`DailyReportSheet`)의 구별 분포 막대**는 이 STEP 범위가 아니다(다른 섹션,
   다른 데이터).
3. `latestDealDate` cell은 화면에 쓰이지 않는다(변경 전에도 그랬다). 섹션 계약을 바꾸지
   않기 위해 그대로 남겼다.
