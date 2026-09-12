# STATS REPORT ENTRY AUDIT + FIX V1

**상태: 감사 완료 + 최소 UI 복구 / Report Engine 변경 0건 / DB·schema·migration 0건 / Production write 0건 / STRUCTURAL PASS · DEVICE QA REQUIRED**

작성일 2026-09-12 · branch `main` · 기준 HEAD `1d1c7a5`

---

## 1. 목적

사용자 관찰: **"통계에 리포트 기능이 빠진 것 같다."**

통계 화면의 리포트 진입점이 누락/숨김/깨짐 중 무엇인지 확인하고, 실제로 빠져 있다면
기존 Report Engine을 재사용해 **최소 UI만** 복구한다.

---

## 2. 시작 상태 (safe mode)

```
branch            main
HEAD              1d1c7a5  style(report): put the busiest complexes on one line…
tracked dirty     package.json, package-lock.json   (사용자 작업물 — 건드리지 않음)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용. untracked 사용자
작업물 보존. DB·schema·migration 0건, Production write 0건, report data logic 변경 0건.

---

## 3. 감사 — 현재 진입 상태

| 확인 항목 | 결과 |
|---|---|
| `/stats`(통계 메인)에 리포트 진입점 | **없음** — 지역 트리거 + 16개 메뉴 카드 + 기타(학군/도구)뿐 |
| `/stats/[type]`(개별 통계)에 진입점 | **있음** — `styles.reportCta` 전체폭 버튼 |
| 그 진입점의 노출 조건 | `slug !== 'change-map'` && `item.status === 'live'` && **`isBusanCurrentLawdCd(region.lawdCd ?? '')`** |
| `RegionContext` 기본값 | `FALLBACK_REGION = { lawdCd: null, sidoCode: '26', dong: 'all', displayRegionName: '부산광역시 전체' }` |
| desktop/mobile 차이 | 없음(같은 마크업). CSS로 숨긴 곳도 없음 |
| feature flag | **없음** — `feature-flags.ts`에 관련 플래그 0건 |
| 과거 commit에서 제거됐는지 | **아님.** `git log -S "reportCta" -- src/app/stats/` → 추가 commit `ca1d255` 하나뿐, 제거 이력 없음 |
| route 생존 | **살아 있음** — `/report/city/busan`, `/report/district/[lawdCd]`, `/report/dong/[lawdCd]/[dong]` 전부 존재 |
| 시 리포트가 통계에 연결된 적 있는지 | **없음.** `git log --all -S "REPORT_LABELS.city" -- src/app/stats/` → **0건**. `cityReportHref`는 `/tools`와 `InvalidScope`에서만 쓰였다 |
| 선택 지역 → route 전달 | 구/군·동은 정상. **시도 전체는 경로 자체를 만들지 않았다** |

### 3.1 Root cause

**삭제가 아니라 미연결 + 기본 상태와의 상호작용.**

```tsx
{slug !== 'change-map' && item.status === 'live' && (() => {
  if (!isBusanCurrentLawdCd(region.lawdCd ?? '')) return null;   // ← 여기서 끝났다
  …
})()}
```

`ca1d255`의 커밋 메시지가 그 의도를 그대로 적어 두었다: *"the region CTA is additionally
gated on isBusanCurrentLawdCd, since reports only cover Busan."* 지역을 지어내지 않기
위한 올바른 가드였지만, **"시도 전체"라는 정상 상태를 위한 분기가 없었다.**

그리고 앱의 기본 지역은 `lawdCd: null`인 **부산광역시 전체**다(위치 권한을 거부하거나
GPS가 실패해도 이 상태가 유지된다). 즉:

> 처음 들어온 사용자는 구/군을 직접 고르기 전까지 **어떤 통계 화면에서도 리포트 진입점을
> 볼 수 없었고**, 통계 메인에는 애초에 진입점이 없었다.

→ 사용자 눈에는 "리포트 기능이 빠진 것"으로 보인다. 정확한 상태는 **route는 살아 있고
CTA만 빠진 것**(§1-5 케이스)이며, 그중 시 리포트는 한 번도 연결된 적이 없다.

---

## 4. 수정 — 경로 판정을 한 곳으로

신규 `src/lib/report/stats-report-entry.ts` (순수 함수, DOM·데이터 접근 0, 경로 문자열
리터럴 0 — `report-links.ts`의 단일 정의만 호출):

```ts
resolveStatsReportEntry(region) →
  동 선택        → { href: '/report/dong/{lawdCd}/{dong}',  scope: 'dong' }
  구·군 선택      → { href: '/report/district/{lawdCd}',     scope: 'district' }
  시도 전체(부산) → { href: '/report/city/busan',            scope: 'city' }
  그 외          → null
```

`null`이 되는 경우를 명시했다(§4 잘못된 fallback 금지):

- 부산이 아닌 시도(서울 등) — 리포트가 다루지 않는다.
- 현행 16개가 아닌 `lawdCd`(`27110`, `11680`, `26999` 등) — **"부산 전체"로 바꿔 보내지
  않는다.** 사용자가 고른 지역이 아니기 때문이다.
- 구/군 이름을 모르면 경로는 `lawdCd`로 정상 생성하되 문구에서 지역명을 **추측하지 않는다**.

두 호출부가 같은 함수를 쓴다:

| 화면 | 사용 | 문구 |
|---|---|---|
| `/stats` (메인) | 헤더 인라인 보조 버튼 `.reportCtaInline` | `REPORT_LABELS.regionShort` = "한장 브리핑" (지역명은 왼쪽 트리거에 이미 보인다) |
| `/stats/[type]` | 기존 전체폭 `.reportCta` | `REPORT_LABELS.city` / `.district(name)` / `.dong(name)` |

`REPORT_LABELS`에 `regionShort` 하나만 추가했다 — 기존 `aptShort`와 같은 이유다(같은
문구를 호출부가 각자 줄이면 갈라진다). route 정의는 한 줄도 바꾸지 않았다.

`/stats/[type]`의 기존 노출 조건(`slug !== 'change-map'`, `item.status === 'live'`)은
그대로다. 변동지도는 자체 드릴다운이 RegionContext와 별개라 계속 제외한다.

---

## 5. 모바일 / 레이아웃

`.headerTop`은 이미 다음 규칙을 갖고 있다(통계 상세의 공유 버튼이 쓰던 것):

```css
.headerTop > .regionTrigger          { flex: 1 1 auto; min-width: 0; }
.headerTop > *:not(.regionTrigger)   { flex: 0 0 auto; }
.regionTriggerLabel                  { …text-overflow: ellipsis; }
```

즉 지역명이 길어지면 **왼쪽 라벨이 말줄임되고 버튼은 깎이지 않는다.** 새 버튼은 그
규칙의 적용을 받는 자리에 들어가므로 별도 대응이 필요 없다.

추가한 것은 `.reportCtaInline` 하나다: `.reportCta`가 `width: 100%` 전체폭 버튼이라
헤더 한 줄에 나란히 놓을 수 없어, 같은 색·같은 테두리를 쓰되 폭만 내용에 맞췄다.
`min-height: 44px`(터치 타겟)와 `white-space: nowrap`을 유지하고, 380px 이하에서는
가로 여백만 줄인다 — **문구를 줄이거나 버튼을 숨기지 않는다**(테스트가 `display: none`
부재를 고정한다).

배경은 흰색이고 브랜드색은 테두리·글자에만 쓴다 → 강한 primary가 아닌 **보조 액션**
수준(§3). 새 카드·섹션을 추가하지 않았다.

---

## 6. Report Engine 무변경 (§5)

PNG·PDF·share·one-page layout·report route·envelope·집계 **전부 그대로**다. 이 STEP의
변경은 진입 링크를 만드는 순수 함수 1개, 그것을 쓰는 호출부 2곳, CSS 클래스 1개,
문구 상수 1개뿐이다. 테스트가 `captureReportExport`/`dom-to-png` 연결, `data-export-root`,
`<ReportActions>` 존재, 5개 route 정의를 각각 고정한다.

---

## 7. 테스트

`src/lib/report/stats-report-entry.test.ts` — **21 tests, 전부 pass.**

브리프 §7의 최소 8항목 대응:

| # | 요구 | 테스트 |
|---|---|---|
| 1 | city selection → city report route | `부산 전체 → /report/city/busan` |
| 2 | district selection → district route | `26140 → /report/district/26140`, 16개 구 전수 |
| 3 | dong selection → dong route | `26140 + 암남동 → /report/dong/26140/암남동` |
| 4 | invalid identity → no wrong fallback | 비부산 시도 4종 null, 현행 16개 아닌 코드 4종 null, 공백 처리, 동만 있을 때 동 경로 미생성 |
| 5 | CTA visible on stats | 메인이 `resolveStatsReportEntry`를 계산해 헤더에 렌더, 상세도 같은 함수 사용(옛 부분 게이트 부재) |
| 6 | mobile structural class present | `nowrap`·`min-height: 44px`·헤더 축소 규칙·라벨 말줄임·380px 대응이 숨김이 아님 |
| 7 | report engine unchanged | route 5종 정의, export/share 연결, `ReportActions` 유지 |
| 8 | other stats actions regression | 메인(지역 선택·16메뉴·학군/도구·모달), 상세(공유·뷰 분기·준비중), 다른 화면 진입점(단지/지도/비교/도구) |

추가: 스코프 3종이 서로 다른 경로로 가는지, 보조 액션 수준인지, 판정이 순수한지
(경로 문자열을 직접 조립하지 않는지).

---

## 8. 검증

```
npx tsx --test src/lib/report/stats-report-entry.test.ts     21/21 pass
npx tsx --test "src/**/*.test.ts"                          1141/1141 pass (신규 21 포함, 회귀 0)
npx tsc --noEmit                                           src/ 오류 0
npx eslint <변경·신규 파일 5개>                                오류 0 / 경고 0
npm run build                                              ✓ Compiled successfully in 3.9s
```

---

## 9. DEVICE QA REQUIRED

1. `/stats` 진입(기본 상태 = 부산광역시 전체) → 헤더 오른쪽에 **"한장 브리핑"** 버튼이
   보이고 누르면 `/report/city/busan`으로 가는지.
2. 지역을 구/군으로 바꾸면 같은 버튼이 `/report/district/<lawdCd>`로 가는지, 동을 고르면
   `/report/dong/<lawdCd>/<dong>`로 가는지.
3. 개별 통계 화면(예: 실거래 피드)에서 부산 전체 상태에서도 전체폭 **"부산 한장 브리핑"**
   버튼이 보이는지(예전에는 구를 고르기 전까지 없었다).
4. 변동지도(`/stats/change-map`)에는 여전히 이 버튼이 없는지(의도된 제외).
5. 360 / 390 / 430px에서 지역명이 긴 경우(예: "부산광역시 해운대구") 버튼이 잘리지 않고
   지역명만 말줄임되는지, 하단 탭바와 겹치지 않는지.
6. 리포트 화면의 PNG/PDF/공유가 예전과 동일한지(엔진 무변경 확인).

---

## 10. 알려진 문제 / 범위 밖

1. **비부산 지역에는 진입점이 없다** — 리포트가 부산만 다루므로 의도된 동작이다
   (다른 지역 리포트로 보내지 않는다). 런칭 범위가 확대되면 `REPORT_SIDO_CODE`를 넓히는
   것으로 대응한다.
2. **변동지도 제외 유지** — 그 화면의 지역 드릴다운은 RegionContext와 독립적이라, 헤더
   지역과 화면이 보는 지역이 다를 수 있다. 연결하려면 그 화면의 선택 상태를 읽어야 하고
   별도 STEP이 맞다.
3. **`/report` 허브는 그대로** — `/tools`의 "비교·리포트" 탭과 `/report` 허브 진입도
   기존대로 살아 있다. 이번 STEP은 통계 화면의 누락만 메웠다.
