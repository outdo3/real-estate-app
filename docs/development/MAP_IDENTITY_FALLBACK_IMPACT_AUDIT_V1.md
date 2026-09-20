# E-JIP MAP IDENTITY FALLBACK IMPACT AUDIT V1

`SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1` §7이 STOP 조건으로 올린 **지도 tier-2 이름 fallback 오귀속**의 실제 사용자 노출 규모를 정량화한다. 정책 변경 전 영향도 측정만 한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `c532c4e`
- **Production INSERT/UPDATE/DELETE 0** · runtime 코드 변경 0 · deploy 0 · master 생성 0 · Seoul apply 0 · fallback 제거 0 · 외부 API 0
- 도구(이번 STEP 추가, read-only): `scripts/audit-map-identity-fallback-impact.ts`

## 판정

**PASS — 측정 완료. 그리고 결론이 이전 STEP의 우려를 크게 좁힌다.**

> 현재 지도 창(최근 12개월)에서 tier-2 fallback은 **부산 2,886 marker 중 1개(0.03%)**, **서울 시뮬레이션 5,819 marker 중 0개**에만 쓰인다.
> fallback을 전부 제거해도 **부산에서 marker 1개, 서울에서 0개**가 사라지고, 그 1개는 **확정 오귀속**이라 없어지는 편이 맞다.

이전 STEP의 "서울 338 aptSeq / 11,766행"은 **전체 이력 기준 잠재값**이었고, 지도가 실제로 읽는 창에는 들어오지 않는다(§10).

---

## 1. 실제 지도 marker 경로 (코드 기준, 추정 없음)

| 단계 | 사실 |
|---|---|
| 요청 모양 | `/api/transactions?type=apt&months=12&loadMore=0&dong=all&lawdCd=NNNNN` — `isMapMarkerShape` |
| 요청 범위 | **한 번에 lawdCd 1개**. 지도 중심 좌표를 Kakao로 역지오코딩해 구를 정한다(실패 시 26140 서구 폴백). **시 전체 marker 화면은 존재하지 않는다** |
| DB-first 조건 | `isMapMarkerShape && isTradeDbFirstLawdCd(lawdCd)` → 현재 **부산만** |
| 부산 소스 | `fetchApt12MonthsFromDb` → `queryTrades({ lawdCd, from: now-12개월, withLatestDealDate:false })` |
| 필터 | `dealType='sale'` · **`dealCanceled=false`** · take(행 상한) **없음** · 캐시 30분 |
| 서울 소스(오늘) | cronSync 꺼져 있어 **live MOLIT** — 같은 12개월 창, 같은 좌표 결합 단계를 그대로 통과한다 |
| 전월세 | 포함 안 됨(`type='apt'` 매매만) |
| dong 필터 | 지도는 `dong=all`로 부르고, 서버는 그 뒤에 `item.dong` 필터를 적용(지도 경로에선 무효) |
| 좌표 소스 | `getMasterCoords(lawdCd)`(30분 공유 캐시) → `buildMasterCoordIndex` |
| **identity 해석** | `resolveApartmentCoords(index, dong, name, aptNamesMatch, fuzzyCache)` — **tier-1** `dong\|name` 완전일치, **tier-2** 같은 법정동 안에서 `aptNamesMatch`(양방향 부분포함 + 차수 가드). 실패 시 aptSeq·좌표 모두 null |
| 드롭 규칙 | `map/page.tsx`: **`lat`/`lng` 없으면 그 행을 버린다** → marker 미생성 |
| marker dedupe | 키가 **`dong\|name`(aptSeq 아님)**, 단지당 **최신 비취소 1건**만 대표 |
| marker id | `item.aptSeq || \`${dong}-${name}\`` |
| bounds/culling | **없음** — 구 단위 marker 전량이 상태에 있고, zoom은 `markerDensityMode`로 individual 칩 / grouped 개수 배지만 전환. 같은 좌표는 `groupByExactCoordinate`로 묶임 |
| 처리 단계 | 소스·좌표결합은 **서버**(route.ts), dedupe·marker화·렌더는 **클라이언트**(map/page.tsx) |

**오귀속의 실제 사용자 영향**: dedupe 키가 `dong|name`이라 잘못 매칭된 단지도 **자기 이름으로 별도 marker가 생기고**, 위치와 `aptSeq`만 다른 단지 것을 물려받는다. 같은 좌표라 진짜 단지와 한 클러스터로 겹치고, 클릭하면 `/apt/<자기이름>?...&aptSeq=<다른 단지 aptSeq>`로 이동한다 — 이름과 aptSeq가 어긋난 채 상세로 넘어간다.

## 2·3. 부산 현재 Production (12개월 창)

`2025-09-20 ~ 오늘`, 실제 Production DB + 위 파이프라인 그대로.

| 지표 | 행 | marker |
|---|---|---|
| A. 입력 거래 행 | **34,829** | — |
| 복합 키(dong\|name) | — | 2,932 |
| **렌더 marker** | — | **2,886** |
| C/D. EXACT (tier-1) | 34,687 | **2,885 (99.97%)** |
| E/F/G. FALLBACK (tier-2 성공) | 1 | **1 (0.03%)** |
| — FALLBACK_SELF(정당한 표기차) | 0 | **0** |
| — **FALLBACK_WRONG(확정 오귀속)** | 1 | **1 (0.03%)** |
| — FALLBACK_UNKNOWN(aptSeq 없음) | 0 | **0** |
| H/I. master 매칭 실패 → 드롭 | 27 | 9 단지 |
| master는 있으나 **좌표 없음** → 드롭 | 115 | 37 단지 |

- **J. ambiguous candidates = 0** — tier-2가 성공한 건이 1건뿐이고 그 1건은 양쪽 canonical aptSeq 비교로 확정됐다. 증명 불가(UNKNOWN)는 0건이다.
- **K/L. 확정 오귀속 aptSeq 1개 / 행 1건.**

> 판정 방법(추측 금지): tier-2로 붙은 marker에 대해 **거래 행의 aptSeq와 매칭된 master의 aptSeq를 직접 비교**했다. 다르면 확정 오귀속, 같으면 정당한 표기차, 거래에 aptSeq가 없으면 UNKNOWN.

## 4. 구별 분해 (부산, 12개월)

| 구 | rendered | exact | fallback | **wrong** | noMatch | noCoords | fb% | wrong% |
|---|---|---|---|---|---|---|---|---|
| 부산진구 | 351 | 351 | 0 | 0 | 0 | 7 | 0.00 | 0.00 |
| 사하구 | 288 | 288 | 0 | 0 | 0 | 2 | 0.00 | 0.00 |
| 동래구 | 275 | 275 | 0 | 0 | 1 | 1 | 0.00 | 0.00 |
| 해운대구 | 272 | 272 | 0 | 0 | 0 | 3 | 0.00 | 0.00 |
| 금정구 | 233 | 233 | 0 | 0 | 1 | 5 | 0.00 | 0.00 |
| 수영구 | 214 | 214 | 0 | 0 | 1 | 3 | 0.00 | 0.00 |
| 남구 | 213 | 213 | 0 | 0 | 1 | 3 | 0.00 | 0.00 |
| 연제구 | 206 | 206 | 0 | 0 | 1 | 1 | 0.00 | 0.00 |
| 북구 | 157 | 157 | 0 | 0 | 0 | 1 | 0.00 | 0.00 |
| **사상구** | **141** | 140 | **1** | **1** | 0 | 1 | **0.71** | **0.71** |
| 서구 | 137 | 137 | 0 | 0 | 0 | 2 | 0.00 | 0.00 |
| 기장군 | 119 | 119 | 0 | 0 | 0 | 3 | 0.00 | 0.00 |
| 영도구 | 113 | 113 | 0 | 0 | 1 | 1 | 0.00 | 0.00 |
| 동구 | 75 | 75 | 0 | 0 | 2 | 2 | 0.00 | 0.00 |
| 중구 | 50 | 50 | 0 | 0 | 0 | 1 | 0.00 | 0.00 |
| 강서구 | 42 | 42 | 0 | 0 | 1 | 1 | 0.00 | 0.00 |
| **합계** | **2,886** | 2,885 | **1** | **1** | 9 | 37 | 0.03 | 0.03 |

문제는 **사상구 한 곳에만** 있다.

## 5. 동 단위 (문제 있는 동만)

| 구 | 동 | wrong marker | wrong 거래 행 |
|---|---|---|---|
| 사상구 | **주례동** | **1** | **1** |

부산 전체에서 오귀속이 있는 법정동은 **주례동 하나뿐**이다.

## 6. 확정 오매칭 사례

대표 사례라 할 것도 없이 **전부 1건**이다.

| 항목 | 값 |
|---|---|
| source aptSeq | `26530-69` |
| source 단지명 | **주례일산맨션** |
| 구/동 | 사상구 / 주례동 |
| 거래 수(12개월 창) | 1 |
| resolved master aptSeq | `26530-72` |
| resolved master 이름 | **주례** |
| resolved 좌표 | 주례(26530-72)의 좌표를 그대로 사용 |
| 왜 매칭됐나 | tier-1 `주례동\|주례일산맨션` 완전일치 실패 → tier-2에서 같은 동의 `주례`와 `aptNamesMatch` — 정규화 후 **`주례` ⊂ `주례일산맨션`** 양방향 부분포함이 성립 |
| 왜 틀렸나 | 둘 다 MOLIT canonical aptSeq를 가진 **서로 다른 단지**다(`26530-69` ≠ `26530-72`). 이름 포함 관계는 identity가 아니다 |

## 7. EXACT-ONLY 시뮬레이션 (코드 변경 없음)

tier-2를 전부 제거하고 tier-1만 허용한다고 가정.

| | CURRENT (X) | EXACT_ONLY (Y) | REMOVED (X−Y) | REMOVAL RATE |
|---|---|---|---|---|
| 부산 | **2,886** | **2,885** | **1** | **0.03%** |
| 서울(시뮬) | **5,819** | **5,819** | **0** | **0.00%** |

제거되는 marker의 성격:

| 구분 | 부산 | 서울 |
|---|---|---|
| confirmed wrong | **1** | 0 |
| likely legitimate fallback(표기차, FALLBACK_SELF) | **0** | 0 |
| unresolved but potentially valid (UNKNOWN) | **0** | 0 |

**제거되는 marker가 전부 확정 오귀속이다.** 정당한 fallback으로 살아 있는 marker는 현재 창에 **한 건도 없다**.

## 8. 사용자 시나리오

지도는 한 번에 구 하나를 보여주므로 "부산 전체 marker" 화면은 존재하지 않는다. 대표 구:

| 시나리오 | current marker | exact-only marker | 차이 | 차이 % |
|---|---|---|---|---|
| 부산진구(거래 최다) | 351 | 351 | 0 | 0.00% |
| 해운대구 | 272 | 272 | 0 | 0.00% |
| 서구 | 137 | 137 | 0 | 0.00% |
| **사상구(유일한 영향 구)** | **141** | **140** | **−1** | **−0.71%** |
| 부산 16개 구 합 | 2,886 | 2,885 | −1 | −0.03% |

API payload와 화면 표시 수는 **같다** — marker 상한이나 bounds 컬링이 없다(§9). 다만 zoom에 따라 개별 칩 대신 개수 배지로 접힌다.

## 9. Zoom / bounds 영향

- **dataset 컬링 없음**: 구 단위 marker 전량이 클라이언트 상태에 있다. `slice`·상한·viewport 필터가 코드에 없다.
- zoom은 `markerDensityMode('apt', zoomLevel)`로 **individual ↔ grouped** 렌더만 바꾼다. grouped에서는 `groupByExactCoordinate`가 같은 좌표를 묶어 개수 배지 하나로 그린다.
- 따라서 **latent(화면에 안 나오는) 행 = 12개월 창 밖 + 좌표 없음**이지 viewport 때문이 아니다.
- 오귀속 marker는 진짜 단지와 **좌표가 정확히 같으므로 항상 같은 클러스터에 들어간다** — 확대하면 같은 지점에 칩 2개가 겹쳐 보인다.

## 10. 잠재값 vs 현재 노출

| | 전체 이력 잠재 | **현재 지도 창(12개월)** |
|---|---|---|
| 부산 master 없는 aptSeq | 1,470 | 9 단지 / 27행이 매칭 실패 |
| 부산 fallback 오귀속 후보 | **98 aptSeq / 2,879행** | **1 marker / 1행** |
| 서울 MASTER_MISSING | 2,424 aptSeq / 73,275행 | **0** |
| 서울 fallback 오귀속 후보 | **338 aptSeq / 11,766행** | **0** |

두 값의 관계:

1. 지도는 **최근 12개월만** 읽는다. 잠재값은 2006년부터 전체 이력 기준이다.
2. 서울 MASTER_MISSING **2,424개 전부 마지막 거래가 2024-10 이전**이다(`SEOUL_SALE_FULL_HISTORY_MEASUREMENT_COMPLETION_V1` §4, D=0). 12개월 창은 2025-09부터라 **구조적으로 한 건도 들어올 수 없다**.
3. 그래서 **서울 sale backfill은 지도 노출을 전혀 늘리지 않는다** — backfill이 넣는 것은 전부 창 밖의 과거 행이고, 창 안의 12개월 행은 지금도 live MOLIT로 같은 경로를 통과하고 있다.

**잠재 결함과 현재 노출을 혼동하지 않는다**: 경로는 열려 있으나(언젠가 창을 넓히거나 다른 소비자가 같은 함수를 쓰면 드러난다) 오늘 사용자가 보는 오귀속은 **부산 1건**이다.

## 11. 서울 시뮬레이션 (DB INSERT 0)

이미 수집해 둔 서울 원천 캐시로 같은 12개월 창을 돌렸다 — 셀 누락 **0**.

| 지표 | 값 |
|---|---|
| 입력 거래 행 | **70,702** |
| 렌더 marker | **5,819** |
| EXACT | **5,819 (100%)** |
| fallback marker | **0** |
| 확정 오귀속 | **0** |
| master 매칭 실패 → 드롭 | 2 단지 / 2행 |
| master는 있으나 좌표 없음 → 드롭 | **93 단지 / 812행** |
| exact-only 제거 | **0 (0.00%)** |

### 부수 발견 — 더 큰 marker 공백은 fallback이 아니라 **좌표**다

| | master 총수 | 좌표 없음 |
|---|---|---|
| 서울 | 6,843 | **117 (1.7%)** |
| 부산 | 3,438 | **37 (1.1%)** |

현재 창에서 좌표 없음 때문에 marker가 못 만들어지는 단지가 **서울 93곳(812행) · 부산 37곳(115행)** 이다. fallback 오귀속(1건)보다 **두 자릿수 크다**. 서울을 열 때 marker 커버리지에 실제로 영향을 주는 것은 이쪽이다(별도 STEP 대상, 이번엔 측정만).

## 12. 결정 지표

**BUSAN CURRENT**

1. rendered markers **2,886**
2. fallback markers **1**
3. fallback share **0.03%**
4. confirmed wrong markers **1**
5. wrong share **0.03%**
6. exact-only removed markers **1**
7. removal rate **0.03%**

**SEOUL AFTER BACKFILL (시뮬레이션)**

8. rendered markers **5,819**
9. fallback markers **0**
10. fallback share **0.00%**
11. confirmed wrong markers **0**
12. wrong share **0.00%**
13. exact-only removed markers **0**
14. removal rate **0.00%**

## 13. 정책 옵션 비교 (이번 STEP에서 변경 안 함)

### A. fallback 유지

| 축 | 평가 |
|---|---|
| wrong marker risk | 현재 1건. 경로가 열려 있어 창 확대·다른 소비자 재사용 시 잠재 98/338 aptSeq로 커질 수 있다 |
| marker coverage loss | 없음 |
| implementation | 0 |
| identity trust | 낮음 — 이름 부분포함을 identity로 인정하는 규칙이 남는다. 상세는 이미 `resolveStrongIdentityAptSeqs`로 막았는데 지도만 안 막혀 **일관성이 없다** |

### B. fallback 전체 제거 (tier-1만)

| 축 | 평가 |
|---|---|
| wrong marker risk | **0** — 확정 오귀속 경로가 사라진다 |
| marker coverage loss | **부산 marker 1개(0.03%), 서울 0개**. 잃는 1개가 바로 그 틀린 marker다 |
| implementation | 작다 — `resolveApartmentCoords`의 tier-2 분기 제거. 순수 함수라 단위 테스트가 이미 있다 |
| identity trust | 높음 — 상세(`resolveStrongIdentityAptSeqs`)와 같은 원칙으로 통일 |
| 주의 | 지금은 FALLBACK_SELF가 0이지만, 원천 표기가 바뀌면 정당한 표기차를 tier-2가 흡수하던 케이스가 생길 수 있다. 그때는 marker가 안 뜨는 쪽으로(가짜 identity 대신 결측) 실패한다 — data truth 원칙과 맞는 방향 |

### C. strong-evidence fallback만 허용

| 축 | 평가 |
|---|---|
| wrong marker risk | 낮음 — 예: 거래 aptSeq와 master aptSeq가 **같을 때만** tier-2 결과를 채택 |
| marker coverage loss | 부산 1개(그 1개가 wrong이라 채택 안 됨), 서울 0개 — **B와 같다** |
| implementation | B보다 큼 — `resolveApartmentCoords`가 거래의 aptSeq를 인자로 받아야 해서 시그니처와 호출부가 바뀐다 |
| identity trust | 높음. 다만 **현재 데이터에서 B와 결과가 완전히 동일**하다(FALLBACK_SELF 0) |

**현재 수치 기준으로 B와 C의 결과는 같고 B가 더 단순하다.** 다만 C는 원천 표기가 달라질 때 정당한 표기차를 살릴 여지를 남긴다. 최종 선택은 사용자 승인 사항이며 이번 STEP에서 바꾸지 않았다.

## 14. No-write assertion

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| runtime 코드 변경 | **0** (`git status -- src/` 비어 있음) |
| deploy | **0** |
| master 생성/수정 | **0 / 0** |
| Seoul apply · cancellation repair · schema | 0 · 0 · 0 |
| fallback 제거 | **0** |
| 외부 API 호출 | **0** (부산은 DB, 서울은 기존 캐시) |

## 15. 테스트

```
npx tsx --test src/lib/map-marker-coords.test.mjs src/lib/apt-name-match*.test.* src/lib/map-*.test.*   pass 93   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"                                                  pass 2339 fail 0
npx eslint scripts/audit-map-identity-fallback-impact.ts                                               exit 0
npx tsc --noEmit                                          src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
```

## 16. Blockers · 권고

1. **Blocker 없음** — STOP 조건에 해당하는 상황은 발생하지 않았다(운영 경로 재현 성공, identity 판정에 추측 0, Production write 0, runtime 변경 0, 서울 캐시 셀 누락 0).
2. **권고 결정**: 옵션 **B(또는 동치인 C)**. 근거는 비용이 사실상 0이라는 점이다 — 부산 marker 1개가 줄고 그 1개가 틀린 marker다. 서울은 손실 0.
3. 이전 STEP이 서울 backfill의 선결 조건으로 올린 "지도 보호"는 **backfill을 막을 이유가 아니다**(§10 — backfill은 지도 노출을 늘리지 않는다). 다만 결함 자체는 부산에 이미 있으므로 독립적으로 고칠 가치가 있다.
4. **별도 STEP 후보(이번엔 측정만)**: master 좌표 공백 — 서울 117 / 부산 37. 현재 창에서 서울 93단지·812행, 부산 37단지·115행의 marker가 이것 때문에 안 뜬다. fallback보다 영향이 크다.
