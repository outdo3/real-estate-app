# DESIGN SYSTEM 3 — Common Components + Header / Bottom Navigation Integration

상태: **구현 완료 — commit/push 안 함(ChatGPT 검수 대기)**

시작 HEAD: `f167b32`(DS-2 구현 직전 문서 커밋) → 이번 STEP §0-1에서
DS-2 구현을 `88d074d`로 커밋+푸시 완료(사용자 승인, 이하 §1 참고). DS-3는
그 이후 작업.

DB/schema/migration 변경 **0건**. API/business/data logic 변경 **0건**
(`prisma/schema.prisma` 미변경, API route 미변경, 통계 계산/순위 로직
미변경 — `git diff --name-only` §41에서 재확인).

---

## 0. DS-2 검수 승인 반영 — 파일 수 정정

DS-2 최종보고에서 "신규 5개"라고 서술했으나, 실제로는 컴포넌트 4개
(Chip/Badge/SectionHeader/AreaChip) × 2파일(.tsx+.module.css)=8개 +
`area-chip-rules.ts` + `verify-design-system-2.ts` + 문서 1개 =
**신규 11개**였다(`git status --short` §41로 실측 재확인). 예상 외
파일은 없었다 — 전부 DS-2 보고에서 이미 설명한 항목들.

## 1. DS-2 commit + push

`git add`로 DS-2의 6개 수정 + 11개 신규 파일 전부 스테이징 →
`feat: establish ejip design system foundation` 커밋(`88d074d`) → push.
Push 후 `git status`는 clean, `git rev-parse HEAD` == `origin/main` ==
`88d074d` 확인 완료.

---

## 2. Button (`src/components/ui/Button.tsx`)

variant: `primary`/`secondary`/`tertiary`/`destructive`/`icon` × size:
`sm`(36px)/`md`(44px)/`lg`(52px). 새 시각 언어를 만들지 않고 기존
`quickActionBtn`/`pageBtn` 관행(card-bg + border-color + radius-lg,
hover 시 translateY+shadow-md+primary 테두리)을 그대로 토큰화했다.
`href`를 주면 `next/link`로, 안 주면 `<button>`으로 렌더링(SectionHeader의
action prop과 같은 패턴). `loading`(스피너+aria-busy), `disabled`,
icon-only일 때 `aria-label` 누락 시 dev 콘솔 경고. 브랜드 그린은
`primary`에만 사용.

**실제 wiring**: Home 퀵액션 2개(지도에서 찾기/조건으로 집 찾기),
apt 상세 quick buttons 3개(지도/로드뷰/대출한도), presales·redevelopment
pagination 4개.

## 3. Search — 기존 컴포넌트를 foundation으로 확정(재구현 없음)

- **HeroSearch 역할**: `HomeApartmentSearch.tsx`(Home 전용, 검증 후
  이동 로직 보유) — 검색 로직 변경 없음.
- **HeaderSearchTrigger 역할**: `ApartmentSearchTrigger.tsx` — 이미
  44px, Lucide `Search`, focus-visible, hover를 전부 갖추고 있었고
  apt 상세/지도/통계 상세 3곳에서 이미 재사용 중이었다. 새로 만들지
  않고 이 두 컴포넌트를 각각의 역할로 문서상 확정만 했다.

## 4. Card (`src/components/ui/Card.tsx`)

DS1 inventory 재검토 결과 `BasicCard`/`ListRow`/`StatusCard` 3종 대신
**1개 컴포넌트 + `variant` prop**(`basic`/`interactive`/`status`)으로
줄였다(스펙이 허용한 "2~3종이면 충분하면 줄여도 됨" 판단). presales/
RedevelopmentListSection의 기존 clickable card(`role="button"` +
`tabIndex` + Enter 키 지원, border-color+radius-lg+shadow-card)를 그대로
흡수했다. `href`가 있으면 Link, `onClick`이 있으면 keyboard-accessible
div, 둘 다 없으면 정적 컨테이너.

**실제 wiring**: presales 목록 카드, redevelopment 목록 카드(합계 수십
개 카드가 이 컴포넌트로 렌더링됨).

## 5. Filter (`FilterBar`/`FilterChip`/`SelectFilter`)

Statistics V2 선행조건. presales/RedevelopmentListSection이 각자
반복 구현하던 `filterBar`(모바일 wrap, 데스크톱 한 줄 density)/
`filterSelect`(control-height-sm, radius-md)를 그대로 토큰화해
공용화했다. `FilterChip`은 `Chip` 위에 얇게 얹은 필터 전용 별칭(시각/
동작 동일, 이름만 분리해 의미를 드러냄) — 아직 실제 페이지에는
select 기반 필터만 있어 FilterChip 자체는 이번 STEP에서 코드 wiring
대상이 없었다(향후 태그형 필터가 생기면 사용).

**실제 wiring**: presales 필터 3개(지역/상태/가격), redevelopment
필터 4개(시도/시군구/유형/단계) — 필터 state/로직은 그대로, UI wrapper만
교체.

## 6. Header (`src/components/Header.tsx`) — 재작성 없이 감사만

DS1이 제안한 "4 variant"는 이미 `Header.tsx`가 prop 조합(`searchSlot`/
`pageTitle`/`hideMobileNav`/`hideLogo`/`pageTitleLarge`/`pageTitleAlign`)
으로 사실상 구현하고 있었다(Home/Standard/Detail/Search-Utility가 전부
하나의 컴포넌트 + prop 분기). 스펙 §7의 "하나의 AppHeader + variant
구조가 낫다면 그렇게 한다"는 이미 충족된 상태라 **재작성하지 않고**
접근성만 보강했다: 활성 메뉴에 `aria-current="page"`, 모바일 하단탭바에
`padding-bottom: env(safe-area-inset-bottom, 0px)`.

## 7. BottomNav — 5개 메뉴 감사

### 현재 5개 메뉴(`src/lib/bottom-nav-items.tsx`)

| 메뉴 | 역할 | 진입 빈도(추정) | 로그인 필요 |
|---|---|---|---|
| 홈 | 랜딩/검색 진입점 | 최상위, 항상 | 아니오 |
| 지도 | 지도 기반 단지 탐색 | 높음 | 아니오 |
| 통계 | 시장 통계·분석 16개 메뉴 허브 | 높음 | 아니오 |
| 재개발·분양 | 재개발/청약 정보(`/presales`도 동일 탭 처리) | 중간 | 아니오 |
| MY | 마이페이지 | 낮음(로그인 사용자 중심) | 사실상 예 |

중복 없음 — 5개가 각각 다른 최상위 기능 영역을 가리키며, 겹치는
`/presales`↔`/redevelopment`는 의도적으로 같은 탭으로 묶여 있다(재개발/
분양이 사용자 관점에서 한 주제라는 기존 설계 판단, 이번 STEP에서
변경하지 않음).

### 5개 유지 권고: **YES**

### 6-item simulation(개발용 임시 실험, 제품에 반영 안 함)

`_qa-ds3.html`(개발 중 임시 harness, 실험 후 즉시 삭제) + JS로 6번째
항목("커뮤니티")을 런타임에만 주입해 375px에서 측정:

| 항목 수 | 항목당 폭 | 라벨 overflow |
|---|---|---|
| 5개(현재) | 75.0px | 없음, 여유 있음 |
| 6개(실험) | 62.5px(-17%) | 측정 라벨 기준 없음, 그러나 시각적으로 아이콘 간격이 눈에 띄게 좁아짐("재개발·분양" 라벨이 이미 여유 없이 딱 맞음) |

**결론**: 오늘의 5개 라벨 조합에서는 6개도 기술적으로 안 깨지지만,
375px 최소 폭 기준 여유가 사라져 향후 라벨이 조금만 길어져도 깨질
위험이 커진다. 스펙 지시대로 **제품은 5개를 유지**한다.

## 8. BottomNav 공용 컴포넌트(`src/components/ui/BottomNav.tsx`)

`map/page.tsx`가 인라인 스타일로 직접 그리던 `MapBottomNav`(Header를
렌더링하지 않는 지도 페이지 전용 하단탭바)를 이 공용 컴포넌트로
대체했다. Header.tsx의 모바일 하단탭바와 완전히 동일한 시각(height
60px, icon 22px, active 시 primary-color+800 weight)을 공유하고,
`aria-current`/`safe-area-inset-bottom`을 추가로 갖췄다. Header.tsx
자체의 내장 버전은 재작성하지 않았다(desktop 겸용 구조라 리스크 대비
이득이 적음) — 대신 동일한 a11y 보강(aria-current, safe-area)을
Header.module.css에도 나란히 적용해 두 구현이 시각/접근성 모두
어긋나지 않게 했다.

## 9. Desktop navigation

BottomNav는 모바일(`max-width:900px`) 전용이다. 데스크톱에서는 Header의
동일한 `<ul className={menuList}>`가 CSS만 바뀌어 상단 가로 메뉴로
렌더링된다(하단바를 데스크톱에 억지로 유지하지 않음 — 기존 구조가
이미 스펙 §10 요건을 만족하고 있었다).

## 10. Loading

- **PageLoading**: 기존 `FullPageLoader.tsx`(마스코트+스피너+메시지)를
  그대로 이 역할로 확정 — 재구현하지 않음.
- **SectionSkeleton**(`src/components/ui/SectionSkeleton.tsx`, 신규):
  `ApartmentScoreCard`가 쓰던 pulse skeleton 패턴을 공용화. TAGO 등
  느린 외부 API 구간에 적용 가능하도록 준비만 해 두었다(이번 STEP은
  기존 로딩 UI를 걷어내지 않음 — 신규 사용처 없음, 다음 STEP 대상).
- **InlineLoading**(신규): 좁은 공간용 최소 스피너+텍스트. 신규
  사용처 없음(다음 STEP 대상).

## 11. Empty (`src/components/ui/Empty.tsx`)

`noData`/`noResult`/`notReady` 3종. variant별 기본 마스코트는 기존
`public/brand/mascot/README.md` 정책을 그대로 따른다(noData/noResult→
`ejipy-empty`, notReady→`ejipy-guide`). "준비 중"은 오류가 아니므로
Error와 시각/마스코트를 분리했다.

**실제 wiring**: presales 결과 없음, redevelopment 결과 없음,
redevelopment "분양·청약 연동 준비 중"(notReady).

## 12. Error (`src/components/ui/ErrorState.tsx`)

`inline`/`section`/`page` 3종. **마스코트를 쓰지 않는다** —
`public/brand/mascot/README.md`가 이미 내려둔 결정("에러 상태는
신뢰감을 캐릭터보다 우선")을 그대로 따랐다. Lucide `AlertCircle` +
안전한 기본 문구(기술적 원문 노출 안 함) + 선택적 재시도 버튼.

**wiring 중 발견한 실제 버그**: presales-client.tsx와
RedevelopmentListSection.tsx의 기존 에러 상태가 **이미 확정된 마스코트
정책을 위반**하고 있었다 — 둘 다 `ejipy-error.webp`를 에러 화면에 쓰고
있었고, presales는 추가로 `⚠️` emoji까지 붙어 있었다. 이번 wiring으로
두 곳 모두 정책에 맞게 마스코트/emoji를 제거했다(§27 unresolved에도
기록).

## 13. Mascot policy(기존 결정 재확인, 변경 없음)

`public/brand/mascot/README.md`를 그대로 따른다:

- 사용 가능: onboarding, friendly empty(`ejipy-empty`), 준비 중
  안내(`ejipy-guide`), loading(`ejipy-loading`)
- 사용 금지: 실거래 수치, 대출, 법률/세금, **critical error**(§12에서
  기존 위반 2건 발견+수정), dense statistics row
- 44px 미만 사용 금지 원칙 유지(Empty의 `.mascot` 64px, 기존 관행과 일치)

## 14. Hero "약 N평" vs AreaChip/거래표 "N평" 통일(AREA MODEL V1 §24/§33 해소)

`src/lib/area-utils.ts`의 `pyeongLabelAtPrecision()`(→
`getUniquePyeongLabels()`가 사용)에 "약 " 접두어를 추가했다. `formatPyeong()`
(Hero)는 원래부터 "약 N평"이었고, 이제 칩/거래표의 평 라벨도 동일하게
"약 N평"이 된다 — **값 자체나 충돌 해소 정밀도 로직은 변경하지 않았다**,
문자열 접두어만 통일했다. "평형" 단어는 여전히 어디서도 쓰지 않는다
(공급면적 미검증, AREA MODEL V1 §16 그대로 유지).

**부작용 발견+수정**: "약 " 접두어가 붙으며 `TradeTimelineList`의 타입
컬럼(평 단위 표시 시)이 375px에서 다시 overflow(60건 중 21건)하는 걸
재실측으로 발견 — DS-2에서 잡았던 회귀와 같은 종류의 문제가 이번 문구
변경으로 재발한 것. `colgroup` 비율을 ㎡/평 두 단위 모두에서 60건
전수 overflow 0건이 되도록 다시 배분(17/14/44/25%→16/13/43/28%,
셀 padding도 0.2rem→0.15rem)해 해결했다.

## 15. Home / Apartment Detail / Statistics wiring

- **Home**: 퀵액션 2개(`Link`+커스텀 스타일 → `Button` href variant).
  Home 전체 redesign 없음, 이 2개 버튼의 구현만 교체.
- **Apartment Detail**: LOCKED 구조지만 이번 STEP의 공통 Button 적용은
  명시적으로 승인된 예외 — 지도/로드뷰/대출한도 버튼 3개를 `Button`으로
  교체(모달 트리거 로직 변경 없음, section order 그대로).
  HeaderSearchTrigger/AreaChip은 이미 기존에 wiring되어 있었다(§3, DS-2).
- **Statistics**: `/stats/[type]` 갭투자 패널 1곳에 `SectionHeader`
  (제목+설명) 적용, 에러 상태 1곳에 `ErrorState` 적용. 16개 메뉴 그리드/
  다른 순위 패널들은 건드리지 않았다(Statistics 전체 개편 금지 원칙,
  §20 unresolved 참고).

## 16. Redevelopment / Presale wiring

두 페이지가 `filterBar`/`filterSelect`/`stateBox`/`card`/`pageBtn`을
사실상 동일하게(3곳 이상 반복, §17 기준 충족) 구현하고 있어 FilterBar/
SelectFilter/Card/Empty/ErrorState/Button 전부를 두 곳에 동시 적용했다.
동일 패턴이 사라지며 각 페이지의 CSS 모듈에서 중복 정의(약 60줄씩,
아래 §21)를 제거했다. Redevelopment 탭 emoji(🏢/🏗️)는 이 파일을
직접 손대는 김에 Lucide(`FileText`/`Building2`)로 교체했다(§22).

## 17. Emoji → Lucide 교체 범위

이번 STEP에서 직접 수정한 영역만 교체했다(전체 emoji 일괄 교체 아님):
`redevelopment-client.tsx` 탭 아이콘(🏢/🏗️), presales 에러 상태의
`⚠️`, `/stats/[type]` 갭투자 패널 제목의 `💰`. 다른 통계 패널
(거래량·시세 추이 📊, 단지 비교 ⚖️/🏘️, 분위 지도 🗺️ 등)과
Statistics 16개 메뉴 아이콘은 이번 STEP에서 건드리지 않았다(Statistics
전체 개편 금지 원칙과 충돌 방지 — §27 unresolved에 다음 STEP 후보로
기록).

## 18. 375/390/430/1024/1280 QA

`_qa-ds3.html`(개발 중 임시 harness, 검증 후 삭제) + iframe 내부
`src` 스왑 방식으로 Home/Presales/Redevelopment/Statistics(gap-invest)
/Apartment Detail을 5개 폭에서 전수 확인 — **`document.body.scrollWidth
> document.documentElement.clientWidth`(가로 overflow) 0건**. Apartment
Detail의 TradeTimelineList는 §14에서 발견한 회귀까지 포함해 60건 전수
0건으로 재확인.

## 19. Accessibility

- BottomNav/Header 활성 탭: `aria-current="page"`
- SelectFilter 전체: `aria-label`(지역/상태/가격/시도/시군구/유형/단계 등)
- Card(interactive): `role="button"` + `tabIndex={0}` + Enter 키 지원(20개
  카드 실측 확인)
- Button: 44px(md) 터치 타깃, `:focus-visible` outline, icon-only
  `aria-label` 누락 시 dev 경고
- ErrorState: `role="alert"`

## 20. 검증 결과

- `npx tsc --noEmit`: 0 errors
- `npx eslint src`: 0 errors(무관 기존 warning 3건만)
- `npx next build`: 성공(동일 30 route, 누락 없음)
- `verify-design-system-3.ts`(신규 18개) + `verify-design-system-2.ts`
  (22개) + `verify-apt-detail-ia.ts`(13개) = **53개 전부 PASS**(회귀 없음)
- 375/390/430/1024/1280px 가로 overflow 0건(§18)
- 브라우저 실측: Home/Map/Apartment Detail/Statistics(gap-invest)/
  Presales/Redevelopment/School/Community 스모크 통과

## 21. Legacy CSS 정리

FilterBar/SelectFilter/Card/Empty/ErrorState/Button으로 대체된
`filterBar`/`filterSelect`/`stateBox`(loading wrapper만 유지)/
`stateMascot`/`card`/`pageBtn`/`emptyCard`류를 presales/redevelopment의
CSS 모듈에서 제거했다(각 파일당 30~60줄, 3곳 이상 반복되던 부분만 —
§17 원칙대로 전체 stylesheet cleanup은 하지 않았다).

## 22. Statistics V2 handoff

`SectionHeader`/`FilterBar`/`SelectFilter`/`Card`는 이제 실제 페이지에서
검증된 상태로 Statistics V2가 바로 재사용 가능하다. Statistics V2
착수 시 우선순위: (1) 16개 메뉴 그리드의 emoji→Lucide 전환, (2) 순위
패널들의 반복 헤더를 SectionHeader로, (3) FilterChip을 실제 태그형
필터가 필요한 화면(예: 다중 조건 검색)에 처음 적용.

## 23. Remaining design debt / DS-4 candidates

1. Search 자체는 재구현하지 않음 — 두 컴포넌트를 역할로만 확정. 향후
   진짜 통합이 필요하면(예: 완전히 새 검색 UX) 별도 STEP.
2. SectionSkeleton/InlineLoading은 컴포넌트만 존재, 실제 사용처 없음.
3. FilterChip은 실제 wiring 없음(select 기반 필터만 존재하는 현재
   페이지들과 맞지 않음).
4. Statistics 16개 메뉴 + 다른 패널들의 emoji 대량 잔존(§17 unresolved).
5. Header.tsx 내장 모바일 버전과 신규 BottomNav 컴포넌트가 시각적으로는
   동일하지만 코드는 별도로 유지된다(Header가 desktop 겸용이라 완전
   통합의 이득보다 리스크가 큼) — 완전 통합은 향후 선택적 개선.

## 24. Unresolved

1. §17에서 나열한 나머지 emoji(통계 패널 다수) — 전체 통계 개편과
   함께 처리 권장.
2. §12에서 발견한 mascot 정책 위반 2건은 이번 STEP에서 수정했으나,
   다른 페이지(예: `nearby-market-section.tsx` 등)에 동일 패턴이 더
   있을 가능성 — 이번 STEP 범위(직접 wiring한 파일)만 확인했다.
3. SectionSkeleton/InlineLoading 실사용처 연결.

## 25. DS3_CLOSE / STATISTICS_V2_GO

BLOCKER 없음. §23의 5개 항목은 전부 선택적 개선 후보지 블로커가
아니다. Filter/Card/SectionHeader가 실제 페이지에서 wiring+검증된
상태이므로 **STATISTICS_V2_GO = YES**(단, §17의 emoji 정리를 V2 착수
시 함께 처리 권장).
