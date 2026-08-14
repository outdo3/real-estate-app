# STEP 27 — APT DETAIL B0: 모바일 하단 고정 UI 충돌 최소 수정

상태: 구현 완료 / 검수중(commit/push 대기)

성격: 구조 버그 최소 수정 전용(상단 Hero/가격/평형/실거래/지도/학교·생활정보/KTX 오탐/
buildAptBrief/커뮤니티 시설 등 문서26의 다른 항목은 이번 STEP에서 다루지 않음).
기준 commit `e991060374cc2a2bf3b01f1f08a9eec521995dd7`. PROJECT ROADMAP R1(문서25)·
APT DETAIL UI-A(문서26)의 미커밋 상태를 그대로 보존.

---

## 1. 문제

`/apt/[name]` 모바일 화면에서 `Header`의 전역 하단 탭바(홈/지도/통계/재개발분양/MY)와
페이지 자체 `StickyPriceBar`(가격 요약 + 글쓰기 버튼)가 동시에
`position:fixed; bottom:0`으로 렌더되어 서로 겹치는 구조적 버그(문서26 §4-B-7/§9에서
발견, 문서26이 "이번 조사에서 가장 영향도 높은 문제"로 명시).

## 2. 코드 근거 (재확인, 추측 없이 실제 파일 재열람)

- `Header.tsx`(line 17): `hideMobileNav?: boolean` prop이 실제로 존재.
- `Header.tsx`(line 85): `<ul className={... ${hideMobileNav ? styles.menuListHideMobile : ''}}>` — prop이 true일 때만 하단탭바를 숨김.
- `Header.module.css`(line 227~244, `@media max-width:900px`): `.menuList { position:fixed; bottom:0; left:0; right:0; height:60px; z-index:1000; background:white; ... }`
- `apt-client.tsx`(line 613, 수정 전/후 동일): `<Header hideLogo pageTitle={displayName || aptName} pageTitleLarge pageTitleAlign="left" />` — **`hideMobileNav` 미전달** 확인.
- `apt-client.tsx`(line 817): `<StickyPriceBar aptName={aptName} latestPrice={latestPrice} />`
- `detail.module.css`(수정 전, line 361~378, `@media max-width:768px`): `.stickyBar { position:fixed; bottom:0; z-index:500; ... }`
- `grep -r hideMobileNav src`: 코드 전체에서 `hideMobileNav`를 실제로 호출부에 전달하는 곳은 **한 곳도 없음**(Header.tsx 자신의 선언/소비부만 매칭). 즉 어떤 페이지도 이 prop을 아직 써본 적이 없다.
- `grep -rl StickyPriceBar src`: `StickyPriceBar`는 `apt-client.tsx`에서만 사용됨(다른 화면에 자체 sticky 하단바 없음 — 이번 충돌은 `/apt/[name]`에만 존재하는 조건).
- `grep -rl "apt/\[name\]/detail.module.css" src`: 이 CSS 모듈을 import하는 곳은 `apt-client.tsx`와 `StickyPriceBar.tsx` 둘뿐(다른 페이지·다른 CSS 모듈과 공유되지 않는, 완전히 이 페이지 전용 파일임을 재확인).

## 3. 검토한 해결안 A/B/C

| 안 | 내용 | 사용자 경험 | 앱 navigation 일관성 | 구현 위험 | 다른 페이지 영향 | 향후 리뉴얼과의 관계 |
|---|---|---|---|---|---|---|
| **A** | `apt-client.tsx`의 `<Header>` 호출에 `hideMobileNav` 추가 → 전역 하단탭바를 이 페이지에서만 숨김 | `StickyPriceBar`(가격+글쓰기)만 남고 전역 5탭 내비게이션 접근 수단이 이 화면에서만 사라짐 | **낮음** — `/map`은 Header 없이 동일 5탭 하단바를 직접 재구현해 "항상 노출"을 유지하는 게 이 앱의 기존 원칙(코드 주석: "Header.tsx의 하단탭바와 동일한 5개 메뉴… 하단탭바만 이 페이지에도 동일하게 떠 있도록 별도로 둔다"). 아파트 상세만 하단탭바를 완전히 없애면 앱 전체에서 유일하게 전역 내비게이션이 없는 화면이 됨 | 낮음(prop 1개 추가, `hideMobileNav`가 이미 설계돼 있어 검증된 경로) | `apt-client.tsx` 1줄만 변경하면 다른 페이지 영향 없음 | 문서26 재설계(§13)는 여전히 `StickyPriceBar`를 "현행 유지"로 분류 — A안을 선택하면 그 전제가 흔들림 |
| **B(선택)** | `StickyPriceBar`를 전역 nav 위로 올림(`bottom:0`→`bottom:60px`) | 두 요소 모두 유지, 세로로 쌓여 보임(가격바가 nav 바로 위) | **높음** — 전역 5탭 내비게이션과 `StickyPriceBar`(가격+글쓰기) 둘 다 유지, 앱 전체의 "항상 하단탭바 노출" 원칙과 정확히 일치 | 낮음(CSS 값 1개 변경, `detail.module.css` 전용 파일이라 이 페이지 밖 영향 불가능) | 없음(구조적으로 불가능 — 아래 §4 근거) | 문서26 재설계(§13)의 "StickyPriceBar 현행 유지" 전제를 그대로 보존 |
| **C** | `StickyPriceBar`의 모바일 `fixed` 자체를 해제(일반 흐름으로 되돌림) | 스크롤 중 가격/글쓰기 CTA가 항상 보이던 기능을 완전히 잃음 | 전역 내비게이션은 그대로 유지되나, `StickyPriceBar`라는 기존 기능 자체를 제거하는 것이라 "구조 버그 최소 수정"의 범위를 넘어섬 | 낮음(CSS 1줄) | 없음 | 문서26이 `StickyPriceBar`를 Keep 목록(§11)에 넣은 판단과 정면으로 배치 |

## 4. 최종 선택안 및 이유

**B안(StickyPriceBar를 전역 하단탭바 높이만큼 offset)을 선택했다.**

1. 이 앱은 이미 "전역 5탭 하단 내비게이션은 어떤 화면에서도 항상 보인다"는 원칙을 갖고 있다 — `/map`이 `Header`를 아예 쓰지 않으면서도 동일한 5탭 하단바를 코드로 직접 재구현해 유지하는 것이 그 증거다(§2). A안(`hideMobileNav`)은 이 원칙을 아파트 상세에서만 깨는 선택이라, "전체 서비스 UX상 자연스러운지" 판단 기준(이번 STEP §5)에 비춰 우선순위가 낮다고 판단했다.
2. `hideMobileNav`가 실제로 존재하는 이유(문서26 §9, Header.tsx 주석: "페이지가 자체적인 모바일 하단 탭바를 이미 그리는 경우… 중복 표시되는 것을 막기 위해")는 "그 페이지가 자체 하단탭바를 이미 그리는 경우"를 전제로 한다. `/apt/[name]`의 `StickyPriceBar`는 5탭 내비게이션을 대체하는 하단탭바가 아니라 가격 요약+글쓰기 CTA이므로, 이 prop이 원래 상정한 상황과 정확히 일치하지 않는다.
3. C안은 기존 기능(스크롤 중 가격 확인) 자체를 없애는 것이라 "구조 버그만 최소 수정"이라는 이번 STEP 범위를 넘어선다.
4. B안은 production 변경이 `detail.module.css` 1개 파일, CSS 값 1개(`bottom`)로 가장 작고, `Header.tsx`/`Header.module.css`/`apt-client.tsx`는 전혀 건드리지 않아 다른 화면에 구조적으로 영향을 줄 수 없다(§2의 import 스코프 근거).

대규모 재설계가 필요한 상황은 아니므로 STOP하지 않고 진행했다.

## 5. 최소 수정 내용

`src/app/apt/[name]/detail.module.css` 1개 파일만 수정(다른 production 파일 변경 없음).

```diff
@media (max-width: 768px) {
+  .main {
+    padding-bottom: calc(60px + 5rem);
+  }
+
   .stickyBar {
     display: flex;
     position: fixed;
     left: 0;
     right: 0;
-    bottom: 0;
+    bottom: 60px;
     z-index: 500;
     ...
```

- **`bottom: 0` → `bottom: 60px`**: 핵심 수정. `60px`은 `Header.module.css`의 `.menuList` 높이(60px, 하드코딩 값)와 정확히 일치시킨 값이다.
- **`.main { padding-bottom: calc(60px + 5rem) }` 추가**: 아래 §7에서 실측으로 발견한 추가 문제(콘텐츠 가림)를 막기 위한 후속 수정. `.main`의 기존 `padding-bottom:5rem`은 `stickyBar` 하나만 가릴 것을 가정한 값이라, `stickyBar`가 위로 올라간 지금은 부족하다. 이 규칙도 같은 `@media (max-width:768px)` 블록 안에만 추가해 데스크톱에는 영향이 없다.

두 변경 모두 `.stickyBar`가 이미 있던 `@media (max-width: 768px)` 블록 범위 안에서만 이뤄졌다.

## 6. 검증(도구 제약 명시)

이번 세션의 브라우저 자동화 창이 원격 디스플레이 해상도(1536×864)에 고정돼 있어
`resize_window` 호출로도 실제 360/375/390px 뷰포트를 만들 수 없었다(문서26에서도 동일
제약을 보고한 바 있음, 재확인). **실기기/실제 좁은 뷰포트 스크린샷은 얻지 못했다.**

대신 다음 방식으로 근사 검증했다:

1. `npx next build`로 실제 프로덕션 빌드를 만들고 로컬(`localhost:3450`)에서 실행.
2. 실제 컴파일된 CSS 모듈 클래스(`Header-module__hBw1pG__menuList`,
   `detail-module__NNho8q__stickyBar`, `detail-module__NNho8q__main`)를 그대로 대상으로,
   `@media (max-width:768px)` 블록에 실제로 존재하는 속성값을 `!important` 인라인
   스타일로 주입해 "너비만 못 바꾼 것"을 보정하고(속성값 자체는 실제 CSS 파일에서
   그대로 가져와 임의 수치를 넣지 않음), `getBoundingClientRect()`로 기하학적으로 측정.
3. 이 방식은 실제 360/375/390px에서의 폰트 줄바꿈·터치 영역 미세 차이까지는 검증하지
   못하지만, `position:fixed`+고정 px 값(`bottom:0`, `height:60px`, `bottom:60px`)으로
   구성된 이번 레이아웃은 뷰포트 폭과 무관하게 항상 동일한 세로 배치 결과를 내므로
   (세 너비 모두 768px 미만이라 미디어쿼리 활성 조건은 동일), 결과의 신뢰도는 높다고
   판단한다.

### 6-A. 겹침 해소

```js
overlap: !(barRect.bottom <= navRect.top || barRect.top >= navRect.bottom)
// → false (겹치지 않음)
gapBetween_barBottom_to_navTop: 0.0000076px // 사실상 0, 정확히 맞닿음
```

스크린샷(로컬 프로덕션 빌드, 시뮬레이션 CSS 적용): `StickyPriceBar`(가격 5억 5,955만 +
"글쓰기" 버튼)가 전역 5탭 하단바 바로 위에 겹침 없이 쌓여 렌더됨을 육안으로도 확인.

### 6-B. 버튼 접근성

```js
elementFromPoint(글쓰기버튼 중심좌표) === 글쓰기 버튼 자신 // true
```

"글쓰기" 버튼의 실제 클릭 히트 영역이 다른 요소(하단탭바 등)에 가로채이지 않고 버튼
자신임을 확인 — 버튼이 시각적으로만 보이고 클릭은 안 되는 상태가 아님을 검증.

### 6-C. 하단 콘텐츠 가림

1차 수정(`bottom:60px`만 적용)만으로 측정했을 때 `.main`의 기존 `padding-bottom:80px`이
새로운 결합 높이(하단탭바 60px + `stickyBar` 실측 높이 67.6px ≈ 127.6px)보다 작아
**4구역(단지 커뮤니티) 마지막 콘텐츠가 두 고정바에 가려지는 새로운 문제를 실측으로
발견**했다. 이를 §5의 `.main` padding-bottom 추가 수정으로 해결했고, 재측정 결과:

```js
contentClippedByFixedBars: false
clearanceMargin_px: 12.8  // 마지막 콘텐츠 하단과 고정바 상단 사이 여유 간격
```

스크롤을 페이지 맨 끝까지 내린 스크린샷에서도 "단지 커뮤니티" 섹션 전체가 고정바에
가리지 않고 노출됨을 육안으로 확인.

### 6-D. 데스크톱 영향

시뮬레이션 스타일을 제거한 원래(1536px) 상태에서:

```js
getComputedStyle(stickyBar).display // → 'none' (수정 전과 동일)
getComputedStyle(main).paddingBottom // → '80px' (수정 전과 동일, calc(60px+5rem) 규칙은
                                      //   @media(max-width:768px) 안에만 있어 미적용)
```

데스크톱 뷰포트에서는 수정 전후 계산값이 완전히 동일함을 확인 — 데스크톱 영향 없음.

## 7. 다른 화면 회귀 검증

Header.tsx/Header.module.css/apt-client.tsx를 전혀 수정하지 않고 `detail.module.css`
(이 페이지 전용 CSS 모듈, §2에서 import 스코프 재확인) 1개 파일만 수정했으므로, 다른
화면이 이번 변경의 영향을 받는 것은 Next.js CSS Modules 스코핑 구조상 불가능하다.
이 구조적 근거에 더해:

- `npx next build` 전체 빌드가 `/`, `/map`, `/presales`, `/presales/[id]`를 포함한 전체
  라우트를 오류 없이 생성함을 확인(§9).
- `grep -rl "apt/\[name\]/detail.module.css" src` 결과 이 CSS 모듈을 참조하는 파일이
  `apt-client.tsx`/`StickyPriceBar.tsx` 두 곳뿐임을 재확인(§2) — `/`, `/presales`,
  `/presales/[id]`, `/map` 어디에도 이 클래스가 로드되지 않는다.

이 근거로 회귀 없음으로 판단했다(개별 페이지를 브라우저로 다시 열어보는 방식의 확인은
CSS Modules 스코프 구조상 이 변경에 대해서는 추가 정보를 주지 않는다고 판단해 생략).

## 8. 정적 검증

```
npx tsc --noEmit         → 오류 0건
npx eslint (apt 관련 파일) → 오류 0건(경고 1건, apt-client.tsx 338행 unused eslint-disable —
                              이번 변경과 무관한 기존 경고, detail.module.css만 수정했으므로
                              건드리지 않음)
npx next build            → 성공(전체 55개 라우트 정상 생성)
npx prisma validate       → "The schema at prisma\schema.prisma is valid"
npx prisma migrate status → "Database schema is up to date!" (3 migrations, drift 없음)
```

DB/schema/migration 변경 없음을 재확인.

## 9. 한계

- 실제 360/375/390px 실기기·실뷰포트 스크린샷은 얻지 못함(§6 도구 제약). 고정 px 값
  기반 레이아웃이라 신뢰도는 높다고 판단하나, 실기기 최종 확인은 사용자 검수 시 필요.
- `StickyPriceBar`(z-index 500)가 이제 하단탭바(z-index 1000) 바로 위에 흰 배경+
  상단 보더+그림자를 가진 채로 나란히 쌓여, 두 개의 얇은 흰 바가 연속으로 붙어 보이는
  시각적 중복감(보더가 두 번 겹치는 느낌)이 있을 수 있다 — 기능적 결함은 아니며,
  겹침 자체를 없애는 이번 STEP 범위를 넘어서는 시각적 다듬기이므로 수정하지 않았다.
- A안(`hideMobileNav`)이 장기적으로 더 나은 선택일 가능성(예: 아파트 상세 리뉴얼 시
  StickyPriceBar를 더 풍부한 액션바로 키우면서 전역 nav를 의도적으로 숨기는 방향)도
  있으나, 이번 STEP은 "최소 수정"이 목적이라 그 판단은 다음 STEP(B1 이후)으로 미룬다.

## 10. B1(상단 Hero 설계) 진행 가능 여부

가능하다고 판단한다. B0는 문서26 §13이 전제한 "StickyPriceBar 현행 유지"를 그대로
보존한 채 구조적 충돌만 해소했으므로, B1(§14 안 A 히어로 압축형 등 상단 재설계)
진행에 필요한 전제 조건을 바꾸지 않는다.
