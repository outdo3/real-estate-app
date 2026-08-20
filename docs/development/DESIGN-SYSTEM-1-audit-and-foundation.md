# DESIGN SYSTEM 1 — 전체 UI/UX 아이덴티티 감사 + 디자인 시스템 설계

상태: **AUDIT + FOUNDATION DESIGN 완료 — 코드 변경 없음(문서만), commit/push
안 함(ChatGPT 검수 대기)**

시작 HEAD: `608638a`(APT DETAIL QA/IA v1 FINAL 직후, origin/main과 일치
확인, working tree clean).

이 STEP은 4개 병렬 조사(Explore agent)로 Home/Map/AI검색,
Statistics(16개 메뉴 전체), Presale/Redevelopment/School/Community/
Auth/My, design tokens+component inventory를 각각 실제 코드 읽기 기반으로
전수 조사한 결과를 종합한 것이다 — 추측이나 일반론이 아니라 전부
file:line 근거가 있는 실측 findings다.

---

## 1. Executive Summary

이집은 지난 여러 STEP에 걸쳐 **아파트 상세페이지(+ 이집점수)를 중심으로**
디자인 토큰을 실제로 준수하는 최신 컴포넌트를 만들어왔다. 문제는 그
바깥이다 — Home/AI검색은 상세페이지와 유사한 수준으로 잘 정돈돼 있지만,
**Statistics/School/Community/My/Map은 각자 다른 시기에 독립적으로
만들어져 토큰을 거의 참조하지 않고, radius/shadow/color를 직접 하드코딩하며,
아이콘은 거의 전부 emoji다.** 특히 Statistics는 16개 메뉴 중 10개 라이브
기능이 **서로 다른 6개 컴포넌트 구현**으로 나뉘어 있고 공유되는 filter
컴포넌트가 하나도 없다.

가장 심각한 단일 발견은 **`globals.css`가 모바일(≤768px)에서 root
font-size를 16px→14px로 전역 12.5% 축소한다는 것**이다(`globals.css:98
-101`, 코드 주석에 명시). 이는 이전 STEP(APT DETAIL QA/IA)에서 "12px
이상으로 상향"한 값들도 실제 모바일에서는 그보다 12.5% 작게 렌더링된다는
뜻이며, "글자가 너무 작다"는 반복되는 사용자 피드백의 구조적 원인일
가능성이 높다.

두 번째로 중요한 발견은 **브랜드 그린이 두 개(`#03c75a` 기존 / `#13A367`
신규 `--ejip-green`) 공존 중이고 결정이 계속 보류되고 있다는 것**이다
(BRAND STEP 56-B2, 57 문서에 명시). 신규 토큰은 현재 Redevelopment
일부와 KakaoShareButton/Brand 컴포넌트에서만 부분 사용돼, 그 자체로 새로운
불일치를 만들고 있다.

이번 STEP은 **감사 + 설계만** 한다 — 실제 페이지 코드는 건드리지 않았다.

---

## 2. 가장 심한 UI 불일치 10개(실측 근거)

1. **모바일 전역 폰트 축소**: `html { font-size: 14px }` at ≤768px
   (`globals.css:98-101`) — 모든 rem 값이 모바일에서 12.5% 추가로
   작아짐. 신규 컴포넌트 작성자가 "0.78rem = 12.5px"로 계산해도 실제
   모바일 방문자에게는 ~10.9px.
2. **두 개의 브랜드 그린이 공존**: `--primary-color:#03c75a`(전체 앱) vs
   `--ejip-green:#13A367`(Redevelopment 일부 배지 + KakaoShareButton +
   Brand 컴포넌트에서만, `globals.css:43-48`, 실사용 6개 파일 19곳뿐).
3. **`--primary-color`를 우회한 리터럴 하드코딩 3곳**: `stats/page.
   module.css:627`, `map/page.tsx:698,725`가 `#03C75A`를 변수 대신 직접
   씀 — 나중에 그린을 바꾸면 이 3곳만 안 바뀌는 버그가 된다.
4. **정의되지 않은 CSS 변수가 실제로 쓰이는 중**: `var(--background-
   color)`(Community/My/School/Stats/Admin/Home 등)과 `var(--bg-light)`
   (School)가 `globals.css` 어디에도 정의돼 있지 않음 — 우연히 `body`
   배경이 이미 `--bg-color`라 눈에 띄는 사고는 없었지만 명백한 dead 참조.
5. **Statistics 색상 의미 충돌**: `#ef4444`(빨강) 한 값이 (a)상승률
   양수, (b)갭투자 절대금액, (c)5분위 지도 최고가 구간, (d)랭킹뱃지
   1등 — **4가지 서로 다른 의미**로 재사용된다(Statistics 감사 상세
   참고). 두 개의 서로 무관한 5색 팔레트(`COMPARE_COLORS`/
   `QUINTILE_COLORS`)도 각자 로컬 정의.
6. **Pill(알약) radius가 4가지 리터럴로 분산**: `var(--radius-pill)`
   (9999px, 토큰), `999px`(41곳), `99px`(Map, 3곳), `9999px` 리터럴
   (BrandSymbol) — 같은 "완전히 둥근 모양"을 의도하고 4개 값을 씀.
7. **radius 값 자체가 14종**: 4px/6px/8px/10px/12px/14px/16px/20px/
   50%/99px/999px/9999px/1rem/토큰. School 상세페이지는 세 가지 카드가
   각각 다른 radius(16/12/10px)를 쓰면서 토큰을 하나도 참조하지 않음.
8. **Statistics 16개 메뉴 카드의 subtitle이 0.65rem, "준비중" 배지가
   0.6rem** — 이번 감사에서 발견된 가장 작은 텍스트(모바일 root
   축소까지 겹치면 각각 ~9.1px/~8.4px).
9. **emoji vs Lucide가 페이지마다 다름**: Home/Header/bottom-nav/최신
   apt-detail 컴포넌트는 Lucide만 사용. Statistics(16개 메뉴 전부 emoji)/
   School(7종 emoji, 카드 아이콘 2.5rem)/Community(5종)/My(6종)/
   Redevelopment(**tab 라벨 자체**에 🏢/🏗️ emoji)/Map(🔍📍✕)은 Lucide를
   전혀 안 쓰거나 최소한만 씀.
10. **Map이 공용 컴포넌트를 재사용하지 않고 통째로 재구현**: 검색창
    (3번째로 다른 형태), 하단 탭바(`MapBottomNav`가 `Header`의 모바일
    탭바를 인라인 스타일로 복제 — `box-shadow` opacity가 0.05 vs 0.08로
    미묘하게 다름, 복제의 실제 위험을 보여주는 증거).

---

## 3. Typography

### 3.1 현재 문제(실측)
- 컴포넌트 전체에서 인라인 `fontSize:` 135곳(26개 파일), CSS 모듈
  `font-size:` 다수 — 전부 `globals.css`가 정의한 `.text-h1`~`.text-xs`
  6개 유틸리티 클래스(`:84-89`)를 **한 번도 참조하지 않는다**. 즉
  "타이포 스케일"은 파일에 존재하지만 실제로는 죽은 코드다.
- 최소 텍스트: Statistics 메뉴 subtitle `0.65rem`(~10.4px), "준비중"
  배지 `0.6rem`(~9.6px), Redevelopment 상세 provenance caption
  `0.68rem`(~10.9px) — 전부 11px 미만.
- 위 모든 값은 모바일에서 root 14px 축소가 추가로 적용돼 실제로는 더
  작다.
- 8개 페이지 클러스터에서 발견된 distinct font-size 값의 총 개수는
  40개 이상 — "Page Title"에 해당하는 자리만 봐도 1.05~1.6rem 사이
  최소 8개 값이 쓰인다.

### 3.2 제안 typography scale(rem 기준, root 16px 전제 — §10 참고)

| 레벨 | 값 | px(16px root) | 용도 | weight |
|---|---|---|---|---|
| Display | 1.75rem | 28px | Hero 숫자(가격/점수), 특별히 강조할 단일 수치 | 800 |
| Page Title | 1.25rem | 20px | Header pageTitle, 페이지 최상단 제목 | 700-800 |
| Section Title | 1.125rem | 18px | zoneTitle류, 카드 그룹 제목 | 700 |
| Card Title | 1rem | 16px | 카드/행 내부 제목(단지명, 게시글 제목 등) | 600-700 |
| Body | 0.9375rem | 15px | 본문 — 목록/설명/일반 텍스트의 기본값 | 400-500 |
| Body Small | 0.875rem | 14px | 보조 설명, 표 셀 | 400 |
| Metadata/Caption | 0.75rem | **12px(하한선)** | 라벨, 타임스탬프, 단위, 배지 텍스트 | 500-600 |

**원칙**: 11px 이하 전면 금지. 12px는 metadata/caption **전용**(본문에
쓰지 않음). 핵심 body는 15px을 기본값으로 하되, 정보 밀도가 높은
Statistics 표/랭킹 행은 Body Small(14px)까지 허용(§16 Data density
참고, 12px 미만은 거기서도 금지). `line-height`: 본문 1.5(이미
`globals.css` body 기본값), 목록형 설명문 1.7~1.8(이미 여러 곳에서
관행적으로 쓰임 — 그대로 유지/공식화).

### 3.3 최우선 foundation 이슈 — 모바일 전역 축소(승인 필요, §53)

`globals.css:98-101`의 `html{font-size:14px}` 규칙은 위 스케일 표의
"12px 하한"을 모바일에서 사실상 10.5px로 만든다. **제안**: 이 전역
축소 규칙을 제거하고, 모바일에서 정말 줄여야 하는 값은 컴포넌트별
`@media` 규칙으로 개별 처리(이미 `ApartmentScoreCard.module.css`가
이 방식을 올바르게 쓰고 있음 — 그 패턴을 표준으로 승격). 이는 전역
시각 변화를 일으키므로 **이번 STEP에서 구현하지 않고 제안만 한다** —
DS-2 Foundation 단계에서 별도 승인 후 진행 권장.

---

## 4. Font weight hierarchy

| Weight | 이름 | 용도 |
|---|---|---|
| 400 | Regular | 본문, 설명문, 보조 텍스트 |
| 500 | Medium | 라벨, 보조 강조(메타데이터 중 조금 더 눈에 띄어야 하는 것) |
| 600 | Semibold | 카드 제목, 탭 라벨, 섹션 제목 |
| 700-800 | Bold/Extrabold | 페이지 제목, 핵심 KPI(가격/점수/순위), 배지, 브랜드 텍스트 |

**금지**: 모든 숫자를 무조건 800으로 만들지 않는다. 현재 Statistics
`.compactPrice`(0.9rem/800)와 `.compactSub`("거래 N건", 0.72rem) 같은
**부가 수치**까지 800을 쓰는 곳이 많다 — 페이지당 "가장 중요한 숫자
1~2개"만 800, 나머지 숫자는 600~700으로 낮춰 위계를 만든다.

---

## 5. Spacing system

실측 결과 이미 대부분의 코드가 `0.75rem(12px)/1rem(16px)/1.25rem
(20px)/1.5rem(24px)/2rem(32px)` 근처 값을 관행적으로 쓰고 있다 —
사용자가 우려한 "13px/17px/19px 임의값 남발"은 spacing에서는 크게
발견되지 않았다(발견된 임의값 대부분은 spacing이 아니라 §7 radius와
§3 font-size 쪽에 집중돼 있었다). 기존 관행을 그대로 토큰화한다.

**제안 scale**: `--space-1:4px --space-2:8px --space-3:12px
--space-4:16px --space-5:20px --space-6:24px --space-8:32px
--space-10:40px --space-12:48px` — 사용자가 예시로 든 4/8/12/16/20/24/
32/40/48과 동일. 기존 코드의 `0.5rem/0.75rem/1rem/1.25rem/1.5rem/2rem`
표기를 이 이름들로 매핑해 재사용(값을 바꾸는 게 아니라 이름을 붙이는
작업).

---

## 6. Radius

**현재 토큰**(`globals.css:26-30`): `--radius-sm:4px --radius-md:6px
--radius-lg:8px --radius-xl:12px --radius-pill:9999px`.

**실측 사용 현황**: 토큰 기반 74곳 vs 리터럴 픽셀 값이 14종 그 이상.
가장 많이 쓰인 비토큰 값은 `999px`(41곳, 사실상 pill의 비공식 표준),
`8px`(43곳, `--radius-lg`와 값은 같지만 토큰 미사용), `4px`(26곳),
`50%`(24곳, 원형 아바타/뱃지 — 정상적인 용도), `16px`(14곳,
School/Community/My 카드가 주로 사용).

**제안 규칙**:

| 용도 | 토큰 | 값 |
|---|---|---|
| input, select, chip 내부 소형 요소 | `--radius-md` | 6px |
| card(기본), section, panel | `--radius-lg` | 8px |
| 큰 hero card, bottom sheet 상단 모서리 | `--radius-xl` | 12px |
| **(신규 제안)** 매우 큰 카드/모달 컨텐츠(School/Community/My가 이미
  16px를 광범위하게 씀 — 억지로 8px로 줄이기보다 정식 토큰으로 승격) | `--radius-2xl`(신규) | 16px |
| pill(칩/배지/버튼/검색창) | `--radius-pill` | 9999px — **`999px`/`99px` 리터럴 전부 이 토큰으로 교체 권장** |
| 원형(아바타, 아이콘 배지) | `border-radius: 50%` | 그대로 유지(토큰 불필요) |

모달은 현재 `LoginModal` 20px 하나만 outlier — `--radius-2xl`(16px)로
스냅 권장.

---

## 7. Shadows / Borders

**현재 토큰**: `--shadow-sm/md/lg/card`(`globals.css:21-24`). 이집은
과도한 그림자를 피하는 clean 스타일을 이미 대체로 지키고 있다(모든
값이 `rgba(0,0,0,0.04~0.08)`의 옅은 톤).

**문제**: School/Community/My가 토큰 대신 손으로 만든 `0 2px 8px
rgba(0,0,0,0.02)`를 쓰고, Map/AI-search 일부(`tooltip`)도 손으로 만든
rgba 그림자를 쓴다 — 시각적으로는 크게 다르지 않지만 토큰 밖에 있어
전역 조정이 불가능하다.

**제안 규칙**:

| 상태 | 토큰 |
|---|---|
| default card(정지 상태) | `--shadow-sm` |
| elevated/hover card | `--shadow-md` |
| modal, bottom sheet | `--shadow-lg` |
| selected 상태 | box-shadow 대신 `border-color: var(--primary-color)` + 그대로 `--shadow-sm` 유지(그림자를 진하게 키우지 않는다) |
| 정보 밀도 높은 리스트 행(hover) | box-shadow 없이 `background-color: #f8fafc`(이미 여러 곳의 관행) |

손으로 만든 rgba 그림자는 전부 위 4개 토큰 중 하나로 교체 권장(값
차이가 미미해 시각적 회귀 위험 낮음).

---

## 8. Color semantics

### 8.1 원칙
브랜드 그린을 "모든 긍정"에 자동으로 쓰지 않는다(사용자 지시 그대로).
현재 코드에서 이미 이 원칙이 여러 곳에서 깨져 있다 — 예: AI-search의
`.cardPrice`가 상승/하락 여부와 무관하게 항상 `--up-color`(빨강)로
표시됨, Community/My의 뱃지가 파란 배경(`#eff6ff`)에 초록 텍스트
(`--primary-color`)를 섞어 씀(색 자체의 의미가 모호해짐).

### 8.2 상승/하락(§10, §30)
기존 `--up-color:#f4361e`(빨강)/`--down-color:#3152d6`(파랑)는 **한국
부동산/증권 관행과 일치**하므로 그대로 유지 권장(코드 주석에 이미
"네이버 증권/부동산 스타일"이라 명시돼 있고, RankingListView의
`rising`/`decline`이 이미 이 관행을 올바르게 따르고 있음). 다만:
- **색상만으로 의미 전달 금지**(§30 지시) — 반드시 `+`/`-` 부호를
  명시 텍스트로 함께 표기(현재 `rising`은 이미 `+` 명시, `decline`은
  음수 부호에만 의존 — 전부 명시 부호로 통일 권장).
- `--up-color`를 "가격 상승"이 아닌 다른 의미(에러 텍스트, 절대
  가격, 랭킹 1등)에 재사용하지 않는다 — 아래 8.3 참고.

### 8.3 제안 semantic 색상 테이블

| 의미 | 토큰(제안) | 값 | 현재 상태 |
|---|---|---|---|
| Brand(주 액션, 활성 상태, 링크) | `--primary-color`(향후 `--ejip-green`) | #03c75a | 이미 존재, 계속 사용 |
| Positive/상승 | `--up-color` | #f4361e | 존재, 의미 재사용(§8.2) 정리 필요 |
| Negative/하락 | `--down-color` | #3152d6 | 존재, 유지 |
| Warning/주의(역전세 위험 등) | **(신규)** `--warning-color` | `#f59e0b` 또는 `--ejip-yellow`(#FFCA3D) | 현재 amber(#fef3c7/#b45309 조합)가 Presale/Redevelopment에 비공식으로 이미 존재 — 이 값을 토큰화 |
| Danger/실제 오류 | **(신규)** `--error-color` | `#ef4444`(현재 Map/tools에서 이미 널리 쓰는 값) | `--up-color`와 분리 — "가격 상승"과 "시스템 오류"가 우연히 같은 빨강이라도 별개 토큰이어야 나중에 독립적으로 조정 가능 |
| Information | **(신규)** `--info-color` | `#3b82f6` | Stats/AI-search가 이미 이 값을 비공식으로 자주 씀 |
| Neutral/Disabled | `--text-muted` / `--border-color` | #8f8f8f / #e4e8eb | 유지 |

### 8.4 이집점수(Score) 색상 — §11
현재 `ApartmentScoreCard`는 이미 올바른 패턴이다: 점수 숫자는 브랜드
그린(`--primary-color`) 고정, 카테고리 칩은 중립 회색(`--bg-color`)
배경 — 점수 자체를 빨강/파랑으로 "좋음/나쁨" 표현하지 않는다. **이
기존 구현을 정식 규칙으로 승격**: 이집점수/카테고리는 항상 브랜드
그린+중립 그레이만 사용, red/blue는 절대 쓰지 않는다. Regional
Strength 배지도 같은 원칙(현재 이미 중립적 문구 톤 유지 중, §S2C/S3
문서 참고).

---

## 9. Button hierarchy

| Variant | 용도 | 스타일 |
|---|---|---|
| Primary | 페이지당 1~2개, 핵심 액션(제출/확인/CTA) | solid `--primary-color`, white text, `--radius-pill` 또는 `--radius-md` |
| Secondary | 보조 액션 | outline `1px solid var(--border-color)`, `--text-primary` |
| Tertiary/Text | 취소/링크형 액션 | 배경/테두리 없음, `--primary-color` 텍스트 |
| Destructive | 로그아웃/삭제 | outline 또는 solid, `--error-color`(신규 토큰) |
| Icon Button | 뒤로가기/닫기/공유 | 배경 투명, 44×44px 최소 hit area |

**높이 원칙**: 모바일 터치 타깃 44px 이상(이미 `ApartmentSearchTrigger`
/apt-detail 최신 컴포넌트에서 지켜짐 — 이 기준을 전역 규칙으로 승격).
Primary 버튼 남발 금지 — 현재 Presale은 CTA 1개, Redevelopment는 solid
CTA가 아예 없음(과소), Home의 quickActionBtn들은 사실상 전부 동급으로
보여 위계가 불명확 — 페이지마다 "가장 중요한 행동 1개"만 Primary로
표시하는 규율 필요.

---

## 10. Search system

이전 STEP(APT DETAIL QA/IA)에서 만든 `ApartmentSearchTrigger`(완성형
검색창 모양, Lucide `Search`, 44px, placeholder, focus-visible)를
**Header 유틸리티 검색의 표준 패턴 후보**로 채택 제안.

실측 결과 검색 UI가 최소 **4가지 다른 형태**로 존재:
1. Home/AI-search: `gradient-border pill`(그라디언트 테두리 트릭,
   `linear-gradient(white,white), linear-gradient(120deg, #a7f3d0,
   #bfdbfe, #ddd6fe)`) — 둘이 서로 동일해 이미 자체적으로 일관성 있음.
2. Apartment Detail: `ApartmentSearchTrigger`(plain border pill, 최신).
3. Map: 완전히 다른 구현(`border-radius:'99px'`, `rgba(255,255,255,
   0.95)` 반투명 배경, placeholder에 emoji `🔍` 텍스트로 박혀 있음).
4. Statistics/Presale/Redevelopment/School/Community/My: 검색창 자체가
   없음(School만 region-picker 버튼이 유사 역할).

**제안**: 두 개의 공식 variant로 통합.
- **Hero Search**(Home/AI-search): 그라디언트 강조, 큰 사이즈, 랜딩
  성격의 주 검색 — 현재 패턴 그대로 유지(이미 통일돼 있음).
- **Header Search Trigger**(Apartment Detail 및 향후 다른 유틸리티
  페이지): `ApartmentSearchTrigger` 패턴 그대로 재사용.
- Map은 3번째 구현을 버리고 Header Search Trigger 패턴(치수/토큰)에
  맞춰 재정렬 권장 — 단 배경 투명도(지도 위에 떠 있어야 함) 등 map
  고유의 제약은 유지.

공통 규칙(요청 항목대로): icon(Lucide `Search`, 위치는 텍스트 왼쪽
고정) / placeholder("아파트명, 지역명 검색"류 실사용 예시 텍스트) /
height 44px / border `1px solid var(--border-color)` / background
`var(--bg-color)` 또는 white / focus 시 `border-color: var(--primary-
color)` + `outline` / clear 버튼(현재 어떤 검색 UI에도 명시적 clear
버튼이 없음 — 신규 검토 항목) / 최근 검색(`ApartmentQuickSearch`가
이미 "최근 본 단지" 제공 — 재사용).

---

## 11. Input / Select

Presale/Redevelopment의 `.filterSelect`(`padding:0.6rem 0.75rem`,
`--radius-md`, `1px solid var(--border-color)`, `0.88rem/600`)가
현재 가장 정돈된 select 스타일이며, 이를 표준으로 제안. 브라우저
기본 select 외관 차이는 이 스타일로 이미 상당 부분 정규화돼 있음(모든
select가 동일한 border/radius/padding을 가짐 — 실제 화살표 아이콘
등 완전 커스텀 select는 없음, 필요시 향후 검토).

**공통 규칙**: height 44px(현재 Presale select는 그보다 낮음 —
DS-2에서 조정 후보), radius `--radius-md`, font `--body-small`(14px)
이상, border `--border-color`, focus `--primary-color` outline.

---

## 12. Filter system(Statistics V2에 특히 중요)

현재 filter 구현이 완전히 파편화돼 있다(실측):
- RankingListView(5개 stat): filter 자체가 없음(기간 12개월 하드코딩).
- VolumeView: `.dealTypeChip`(칩 그룹) + `.viewToggle`(세그먼트 토글).
- CompareView: `ApartmentAutocomplete` 자유 입력.
- PriceMapView: filter 없음, 정적 범례만.
- Presale/Redevelopment: native `&lt;select&gt;` 3~4개.

**제안 3-패턴 체계**(요청 항목 그대로):
- **FilterBar**: 여러 개의 select를 가로로 배치(지역/기간/거래유형 등)
  — Presale/Redevelopment의 기존 `.filterSelect` 그대로 재사용.
- **FilterChip**: 소수 옵션 중 하나(또는 다중) 선택, pill 모양 —
  VolumeView의 `.dealTypeChip`, AreaSelector의 면적 칩 패턴 재사용.
- **SelectFilter**: 단일 드롭다운(지역 하나만 고를 때) — region-picker
  트리거(Stats/School이 이미 사용 중인 패턴)와 통합.

Statistics V2는 최소한 **기간/지역/거래유형** 3개를 모든 stat 타입에
FilterBar로 공통 제공하는 것을 전제조건으로 권장(§36 참고) — 현재처럼
타입마다 있다 없다 하지 않는다.

Desktop: FilterBar 가로 배치 그대로. Mobile: FilterBar가 넘치면
가로 스크롤(§32 규칙과 동일 원칙) 또는 접이식(하단 시트) 중 향후
결정 — 이번 STEP은 원칙만 제안.

---

## 13. Chip vs Badge(§16, §17)

**Chip = 선택 가능**(상태 토글), **Badge = 상태 표시 전용**(클릭 불가).
현재 코드가 이 둘을 구분 없이 섞어 쓰는 경우가 많다 — 예: Statistics의
"준비중" 배지는 Badge가 맞지만, Presale의 상태 배지(접수중/접수예정
등)도 클릭되지 않는 순수 정보 표시라 Badge가 맞다. 반면 AreaSelector
면적 칩, VolumeView의 dealTypeChip, School의 신축순/거리순 정렬
칩은 전부 클릭 가능한 진짜 Chip이다 — 현재 시각적으로 거의 구분이
안 된다(둘 다 pill + 비슷한 배경).

**제안 규칙**:
| | Chip | Badge |
|---|---|---|
| 상호작용 | hover/active/selected 상태 있음, 클릭 가능 | 없음, 순수 표시 |
| 모양 | pill, 테두리 있는 outline 기본 → 선택 시 solid 채움 | pill, 옅은 배경 + 진한 텍스트(2-tone) |
| 크기 | Body Small(14px) 근처 | Metadata(12px) |
| 색 | 활성 시 `--primary-color` | semantic 색상표(§8.3) 따름 |

---

## 14. Badge system(§17)

Presale이 이미 가장 잘 정립된 4색 semantic 배지 체계를 갖고 있다
(진행중=그린/예정=블루/마감=그레이/특이=amber) — Redevelopment도 거의
동일한 팔레트를 재사용 중. **이 체계를 전역 표준으로 승격** 제안:

| 의미 | 배경 | 텍스트 |
|---|---|---|
| 진행/활성(접수중, 착공 등) | `#e6f9ed`(또는 `--ejip-mint`) | `--primary-color` |
| 예정/정보(접수예정 등) | `#eaf0fe` | `#3152d6`(`--down-color`와 동일 계열) |
| 종료/중립(접수마감, 완료) | `#f0f0f0` | `--text-muted` |
| 주의/특이(무순위, 역전세 위험) | `#fef3c7` | `#b45309`(→`--warning-color`) |
| Beta/신규 기능 표시 | `rgba(3,199,90,0.1)` | `--primary-color` | (ApartmentScoreCard의 기존 Beta 배지 패턴 재사용)

공통: height는 텍스트+padding으로 결정(고정 px 대신 `padding:0.2rem
0.55rem` 관행 유지), font Metadata(12px)/weight 700-800, radius
`--radius-pill`.

---

## 15. Card system(§18)

과도한 추상화를 피하고 **현재 실제로 반복되는 3개 패턴만** 정식화:

1. **BasicCard**: 흰 배경, `1px solid var(--border-color)`,
   `--radius-lg`, `--shadow-sm` — Apartment Detail/Presale/
   Redevelopment 리스트 카드가 이미 이 패턴(Presale은 거의 정확히
   일치).
2. **ListRow**: 카드 테두리 없이 `border-bottom` 구분선만 — Statistics
   랭킹 행, School 목록, Community 목록이 이미 이 패턴.
3. **StatusCard/MetricCard**: 중앙 정렬된 큰 숫자 + 작은 라벨 —
   Statistics summaryCard, School summaryCard, AI-search statCard,
   AptSpecGrid 셀이 전부 이 형태의 변형.

새로운 카드 타입(InteractiveCard 등)을 추가로 만들지 않는다 — 위 3개로
전체 앱의 카드 요구를 커버할 수 있다는 것이 이번 감사의 결론이다.

---

## 16. Section Header(§19)

전 페이지 공통 구조 제안: **제목(좌, Section Title) + 설명(선택,
muted, Body Small) + 우측 action(선택, 링크 또는 작은 버튼)**. 현재
Home의 `.quickHeading`, CommunityPreview의 헤더(제목+글쓰기/더보기
링크)가 이미 이 구조를 따르고 있다 — 컴포넌트로 뽑아 재사용 후보(§45
NEW).

---

## 17. Header / Top Navigation(§20)

공용 `Header.tsx`는 이미 `searchSlot`/`pageTitle`/`hideLogo`/
`pageTitleLarge`/`pageTitleAlign` props로 상당히 유연하게 설계돼 있다.
실측된 실제 사용 variant:

| Variant | 사용처 | 구성 |
|---|---|---|
| Home(bare) | Home | 로고만, search/pageTitle 없음 |
| Utility(pageTitle) | Presale, Redevelopment, Statistics, School(목록) | `hideLogo` 없이 pageTitle 우측 표시 |
| Utility(hideLogo+pageTitle) | AI-search, School(상세, `pageTitleLarge`) | 로고 대신 페이지 제목 |
| Search-slot | Apartment Detail | `searchSlot`에 `ApartmentSearchTrigger` |
| Full-bleed(미사용) | **Map만 Header 자체를 안 씀** | 커스텀 재구현 |

**제안**: 위 4개 variant를 공식 이름으로 문서화하고, Map은 5번째
"직접 재구현"을 없애고 가능한 한 Header의 기존 코드/CSS를 재사용하도록
전환(전체화면 지도라는 제약은 `position:fixed` 배경 투명도 조정으로
해결 가능, 뼈대 컴포넌트는 공유). 공통 기준(요청 항목): logo/back/
search/share/favorite/우측 action의 배치 순서를 Header가 이미 갖고
있으므로 그대로 계약으로 문서화.

---

## 18. Bottom Navigation(§21)

`src/lib/bottom-nav-items.tsx`가 Lucide 아이콘 5개(Home/Map/BarChart3/
Building2/User) + 라벨을 단일 소스로 관리하고, `Header.tsx`의 모바일
탭바가 이를 사용 — **아이콘/라벨/active 로직은 이미 잘 공유되고
있다.** 문제는 Map의 `MapBottomNav`가 같은 데이터를 쓰면서 컨테이너
마크업/CSS를 완전히 별도로 인라인 재구현했다는 것 — 그 결과
`box-shadow` opacity가 0.05(Header) vs 0.08(Map)로 미세하게 갈라짐.

**제안**: `BottomNav`를 `Header.tsx`에서 분리해 독립 컴포넌트로 추출
(§45 NEW), Header와 Map 둘 다 그 컴포넌트를 import — 데이터뿐 아니라
마크업/스타일도 단일 소스가 되게 한다.

---

## 19. Icon system(§22)

**원칙**: Lucide 기본, emoji는 제품 UI에서 제거, 마스코트는 별도
asset(아이콘이 아니라 일러스트로 취급).

**emoji 전수 목록**(실측, 페이지별):
- Statistics: 16개 메뉴 아이콘 전부(📉🏆📈📊⚖️🏘️💰🛒🏗️👥⚠️✈️🗺️⛰️🏢👁️) +
  지역 트리거 📍 + ▾ 캐럿 + 각 상세뷰 제목(📊💰🗺️) + tip box 💡×2 +
  ComingSoonCard 📦.
- School: 📍🏫🎓📚(2.5rem 대형) + 상세페이지 📈🔬🌐.
- Community: 📍✏️⚠️🏢📌.
- My: ⚙️💬✏️🛡️📄🔒.
- Redevelopment: 🏢🏗️(**tab 라벨 텍스트 안에 직접 포함**).
- Presale: ⚠️(경고), ↗(외부링크 — 문자 글리프), ✕(닫기).
- Map: 🔍(검색 placeholder), 📍(내 위치 버튼), ✕(닫기), "초"/"중"/"고"
  (학교급 배지, 텍스트 글리프).
- AI-search: ✨📊⚖️🪄🏢🏫💡📈📉.
- LoginModal: 💬(카카오 버튼).

**제안 우선순위**(노출 빈도·상징성 기준): (1) Statistics 16개 메뉴
아이콘 — 방문 빈도가 가장 높은 화면, (2) Redevelopment 탭 라벨 —
주요 내비게이션 요소에 emoji가 박혀 있는 건 가장 시급, (3) My 페이지
내비게이션 리스트, (4) Community, (5) School. 마스코트 이미지
(`ejipy-*.webp`)는 예외 — 아이콘이 아니라 브랜드 일러스트로 유지.

---

## 20. Loading / Empty / Error(§23~25)

### 20.1 Loading — 현재 혼재 실측
- **Page-level**: `FullPageLoader`(마스코트+스피너+메시지) — Map,
  AI-search가 이미 올바르게 사용.
- **Section-level skeleton**: `.skeletonBar`(gradient shimmer) —
  현재 apt-detail의 BusAccessCard/KakaoPlaces/PriceTrendChart,
  Statistics VolumeView의 yearlyTable **뿐**. 나머지 대부분(Statistics
  RankingListView/GapInvestView, Map의 3단계 로딩, School)은 그냥
  가운데 정렬된 muted 텍스트("분석 중입니다...", "지도를 불러오는
  중입니다..." 등) — 스피너도 스켈레톤도 없음.

**규칙**: Page loading = `FullPageLoader`(라우트 전환/최초 데이터
없음일 때만). Section loading = `.skeletonBar`(최종 콘텐츠와 같은
모양, 이미 검증된 패턴 — apt-detail의 버스 로딩 개선 사례가 정확히
이 규칙을 보여준다). Card loading = skeleton의 축소판. **외부 API가
느릴 때(TAGO 등) 전체 페이지를 막지 않는다** — 이미 확립된 원칙(APT
DETAIL QA §17)을 전역 규칙으로 승격, Statistics 전체에도 적용 권장.

### 20.2 Empty(§24)
공통 구조: 마스코트(선택) + 제목 + 설명 + action(선택). 문제는 마스코트
사용이 페이지마다 제각각이라는 것 — School/My는 empty 상태에도
마스코트를 **아예 안 씀**, 반면 다른 곳은 씀. 컨테이너 스타일도
제각각(Presale/Redevelopment는 점선 테두리 `.stateBox`, Community는
테두리 없이 텍스트만, School은 스타일 클래스조차 없이 인라인).

**규칙**: 마스코트는 "진짜 텅 빈 상태"(검색 결과 0, 즐겨찾기 없음,
게시글 없음)에만 사용 — 사소한 하위 empty(Statistics 랭킹 0건 등)는
텍스트만. 컨테이너는 항상 `.stateBox`류(점선 테두리 `--radius-lg`)로
통일.

### 20.3 Error(§25)
API 오류와 데이터 없음을 반드시 분리한다. 현재 Statistics의
`ComingSoonCard`("기능 미구현")와 실제 "0건" 결과가 **똑같은
`.emptyState` 셸을 재사용해 시각적으로 구분이 안 된다** — 가장
시급한 수정 후보. 제안 3분류:

| 상태 | 시각 | 마스코트 | 예시 |
|---|---|---|---|
| 데이터 없음(정상) | 중립 텍스트, muted | 상황에 따라 선택 | "해당 기간 거래 내역이 없습니다" |
| 연동 준비 중(미구현) | 중립 텍스트 + 작은 "준비중" 배지, **오류처럼 보이지 않게** | 선택(guide류) | Statistics의 6개 soon 항목 |
| 실제 오류(API 실패 등) | `--error-color` 계열 아이콘/텍스트 + 재시도 action | 권장(ejipy-error) | Map의 mapLoadError |

AI-search의 에러 텍스트가 `--up-color`(가격 상승색)를 재사용하는 것은
§8.3의 신규 `--error-color` 토큰으로 교체 권장.

---

## 21. Mascot usage(§26)

**권장**: loading, empty, onboarding, guidance, success.
**비추천**: 실거래 수치 카드, 대출, 법률/세금, 심각한 오류(중립적
표정 버전 검토), 모든 section 장식(남발 금지).

실측: School/My/Presale-detail의 오류 상태는 마스코트가 아예 없고
(과소 사용), 반면 몇몇 곳은 같은 `ejipy-error.webp`를 오류든 empty든
구분 없이 재사용한다(의미 없는 재사용). Community 글쓰기 페이지는
36px의 작은 인라인 마스코트를 아이콘처럼 쓰는데, 이는 "일러스트"라는
정의에서 벗어난 경계 사례 — **44px 미만 크기로는 마스코트를 쓰지
않고 Lucide 아이콘이나 텍스트를 쓴다**는 규칙을 추가 제안.

---

## 22. Data density(§27)

3단계 제안:
- **Dense**(Statistics 표/랭킹): 정보량 우선, Body Small(14px)까지
  허용(12px 미만 금지는 동일), 행간 좁게(`padding:0.5~0.6rem`).
- **Standard**(Apartment Detail, Presale, Redevelopment): 현재
  카드 기반 여백 유지.
- **Relaxed**(Home, empty/onboarding류): 넉넉한 여백, 마스코트 중심.

Statistics V2는 아실 수준의 정보 밀도가 필요하다는 사용자 인식이
맞다 — 억지로 apt-detail의 여유로운 카드 스타일을 강요하지 않고
Dense 티어를 공식 채택할 것을 권장.

---

## 23. Table system(§28, Statistics V2 대비)

Statistics의 `yearlyTable`이 이미 좋은 기준점이다: `position:sticky`
헤더, `table-layout:fixed`(가로 스크롤 대신 컬럼 축소를 의도적으로
선택 — 코드 주석에 명시), 우측 정렬 숫자 컬럼, hover 행 강조
(`#f8fafc`, 여러 곳에서 이미 관행).

**공통 규칙 제안**: header sticky(선택적, 긴 표에서), 숫자/가격
컬럼 우측 정렬, 날짜 컬럼 좌측, %는 부호 명시(§8.2), hover
`#f8fafc`, **모바일 fallback은 가로 스크롤보다 컬럼 축소/행 변환을
우선**(yearlyTable의 기존 선택을 표준으로 채택 — 가로 스크롤은
칩/필터에만 허용, §32).

---

## 24. Number formatting(§29)

기존 `formatKoreanPrice()`(`src/lib/api-molit.ts`, 억/만 변환)를
가격 표기의 단일 표준으로 유지. 개수는 `.toLocaleString('ko-KR')`.
퍼센트는 소수 1자리 + 명시적 부호(§8.2) — 현재 `rising`만 명시 `+`를
쓰고 `decline`은 음수 부호에만 의존하는 차이를 통일 권장. **제안**:
`formatSignedPercent()` 공유 헬퍼(신규, §45) 하나로 Statistics
`type-client.tsx`의 개별 `value: (c) => ...` 로직들을 대체.

---

## 25. 상승/하락 표시(§30)

색상(§8.2) + 부호 텍스트 필수. 화살표 글리프(▲/▼)는 AI-search가
이미 비공식으로 쓰고 있는 문자 — 이를 상승/하락 표시의 정식
구성요소로 승격해 색맹 사용자도 부호+화살표 이중으로 구분 가능하게
한다.

---

## 26. Mobile breakpoints(§31)

실측된 breakpoint: 420px(Stats 메뉴 그리드), 480px(ApartmentScoreCard,
ApartmentSearchTrigger), 640px(AptSpecGrid), 768px(Header, globals.css
루트 축소, Stats panelHeader — 가장 널리 쓰임), 900px(Header
pageTitleLarge), 1024px(Stats rankingGrid, 미사용). 파편화돼 있지만
768px이 사실상 이미 표준으로 굳어 있다.

**제안 3-4단계**: Mobile(≤480px) / Mobile-large(481~768px) /
Desktop(769~1023px) / Desktop-wide(≥1024px, 2~3열 레이아웃 필요
시). 기존 420/640/900px 같은 1회성 breakpoint는 신규 코드부터
점진적으로 위 4단계로 정리(이번 STEP에서 기존 코드를 소급 수정하지
않음).

---

## 27. Mobile 가로 스크롤(§32)

AreaSelector(면적 칩, 이전 STEP에서 전체 노출로 전환), Statistics
compare 칩 등 **칩/필터류에서만** 허용 — §23에서 이미 명시한 대로
데이터 표는 가로 스크롤 대신 컬럼 축소를 우선한다. 스크롤 가능함을
알리는 UX: AreaSelector가 이미 컨테이너 우측을 살짝 잘라 다음 칩이
보이게 하는 방식으로 "더 있음"을 암시 — 이 관행을 표준으로 문서화
(별도 화살표 아이콘 없이도 인지 가능함을 실측 확인, APT DETAIL QA
브라우저 검수에서 확인).

---

## 28. Desktop layout(§33)

`globals.css`의 `.container`(max-width 1200px, `padding:0 1.5rem`
→ 모바일 `0 16px`)가 전역 표준 콘텐츠 폭으로 이미 광범위하게
적용돼 있다. 이번 감사에서 이 폭을 벗어나는 페이지는 발견되지
않았다(각 클러스터 감사에서 별도 max-width 리터럴이 보고되지
않음) — `.container` 사용을 표준으로 확정, 2/3-컬럼이 필요한
경우(Statistics 비교, 향후 대시보드)는 `.container` 내부에서
grid로 분할.

---

## 29. Accessibility(§35)

- **터치 타깃 44px**: 최신 컴포넌트(ApartmentSearchTrigger, apt-detail
  버튼들)는 준수. 구형 컴포넌트(Map의 ✕ 닫기, 일부 아이콘 전용
  버튼)는 미달 가능성 — 향후 개별 점검 필요(이번 STEP은 목록화만).
- **Color contrast**: `--text-muted:#8f8f8f`가 흰 배경 대비 약
  3.5:1로 **WCAG AA 본문 기준(4.5:1) 미달** — 이 토큰이 caption/
  라벨/부가정보 전역에 극히 광범위하게 쓰이고 있어(수백 곳) 값을
  바꾸면 전역 시각 변화가 크다. **foundation 제안**: `--text-muted`를
  더 어둡게(`#6b7280` 근처, ~4.6:1) 조정 검토 — 구현 전 승인 필요
  (§53, 시각적 영향 범위가 넓어 이번 STEP에서 실행하지 않음).
- **focus-visible**: `ApartmentSearchTrigger`만 명시적 `:focus-
  visible` 스타일 보유 — 신규 인터랙티브 요소 작성 시 필수 규칙으로
  제안.
- **aria-label**: Header의 back 버튼, 검색 트리거 등 이미 일부
  적용돼 있음 — 신규 아이콘 버튼 작성 시 필수화 제안.

---

## 30. Page archetypes(§36)

| Archetype | 페이지 | 공통 레이아웃 |
|---|---|---|
| A. Discovery | Home, Map, AI-search | 검색 우선, 카드/목록 브라우징, 필터 최소 |
| B. Detail | Apartment, Presale, Redevelopment, School(상세) | Hero → 핵심 스펙 그리드 → 콘텐츠 섹션들(현재 Apartment Detail이 가장 성숙) |
| C. Analytics | Statistics, 향후 Compare | FilterBar → Summary → Ranking/Table/Chart(§31 패턴) |
| D. Account | My, Community, Auth | 목록 + 폼, 단순한 chrome |

향후 신규 페이지는 이 4개 중 하나의 archetype을 채택해 처음부터
공통 레이아웃을 따르도록 설계 권장.

---

## 31. Apartment Detail 평가(§37, archetype 참고용 — 구조 재배치 안 함)

**좋은 패턴(전파 권장)**:
- Hero + AptSpecGrid의 이중 정보밀도 구조(핵심 요약 + 세부 스펙 분리).
- ApartmentScoreCard의 "compact chip → 펼치면 설명" 패턴(§9 요청의
  card/chip 규칙에 그대로 부합).
- Algorithmic Briefing(강점/확인점/종합 3단 구조, 결정론적 생성).
- 단위 토글(㎡/평)의 충돌 방지 정밀도 로직 — 다른 단위 변환이
  필요한 화면(예: 평당가 vs 총액)에도 응용 가능한 설계.
- 탭 방문 캐싱(`visitedInfraTabs`) — 불필요한 재요청 방지 패턴,
  Statistics의 탭/뷰 전환에도 적용 검토 가치 있음.
- `ApartmentSearchTrigger` — §10 표준 검색 패턴의 기반.

**주의(향후 정리 대상, 이번 STEP에서 손대지 않음)**: `apt-client.tsx`
자체가 인라인 스타일 밀도가 가장 높은 단일 파일(하드코딩 hex 18곳 +
인라인 fontSize 15곳, 감사 전체에서 최다) — CSS 모듈로의 점진적
이관을 향후 tech-debt 항목으로 기록.

---

## 32. Redevelopment 평가(§38)

카드/필터/헤더 자체는 Apartment Detail 계열과 가장 가깝다(`--radius-
lg`/`--shadow-card`/`--border-color` 정확히 사용). 그러나:
- 탭 라벨에 emoji가 직접 박혀 있음(🏢/🏗️) — 최우선 정리 대상(§19).
- tab pill/empty-card radius가 하드코딩(20px/16px, 토큰 미사용).
- **유일하게 신규 `--ejip-green*`/`--ejip-mint` 토큰을 실제 화면에서
  사용 중**(배너 1곳, 배지 일부) — 그린 색상 결정(§2-2)이 나기 전까지
  이 부분 단독으로 다른 색조를 띠어 오히려 새로운 불일치를 만든다.
  향후 R7(폴리곤 지도)도 같은 디자인 시스템을 쓰려면 이 결정이
  선행돼야 한다.

---

## 33. Presale 평가(§39)

이번 감사에서 **토큰 준수도가 가장 높은 클러스터**(정확한
`--radius-lg`/`--shadow-card`/`--border-color`, emoji 최소, 4색
배지 체계가 이미 정립돼 있음 — §14의 기반이 됨). Redevelopment와
list/detail 패턴을 상당 부분 공유할 수 있는 상태(카드 구조 동일).
사소한 흠: CTA 버튼 radius가 `--radius-md`(6px)로 pill이 아님(다른
곳 CTA와 통일 검토), 상세페이지 에러 상태가 목록 페이지와 달리
마스코트를 안 씀(§21 규칙 위반 사례로 기록).

---

## 34. Statistics 현재 문제(§40 — 가장 중요)

16개 메뉴(10 live + 6 soon) 전수 감사 결과:

- **6개의 서로 다른 컴포넌트 구현**이 10개 live 타입을 담당
  (`RankingListView`가 5개 슬러그를 config로 공유하는 것을 빼면
  사실상 개별 구현): RankingListView, VolumeView, GapInvestView,
  CompareView, PriceMapView, ComingSoonCard.
- **공유되는 filter 컴포넌트가 하나도 없음** — RankingListView는
  필터 없음, VolumeView는 칩+토글, CompareView는 자유입력, PriceMapView
  는 필터 없음(정적 범례만).
- **색상 의미 4중 충돌**(§2-5) + **서로 무관한 두 개의 5색 팔레트**
  (`COMPARE_COLORS` vs `QUINTILE_COLORS`, 로컬 정의, 공유 상수 없음).
- Lucide 아이콘 **0개** — 16개 메뉴 아이콘 전부 emoji, 상세뷰 제목도
  전부 emoji 접두어.
- 로딩 상태는 VolumeView의 yearlyTable skeleton **1곳만** 진짜
  skeleton, 나머지는 전부 "분석 중입니다..." 평문(3곳 이상 독립
  중복 문자열, 공유 컴포넌트 없음).
- `ComingSoonCard`(진짜 미구현)와 실제 "0건" empty 상태가 시각적으로
  구분 불가(둘 다 동일 `.emptyState` 셸).
- 랜딩 그리드에 16개 통계 메뉴와 **무관한 2개 링크**(학군정보/부동산
  도구)가 구분선/제목 없이 같은 그리드에 이어 붙어 있음.
- 가장 작은 텍스트 발견 지점(subtitle 0.65rem, 배지 0.6rem, §3).
- `kakao-map-script-main` 스크립트 ID가 `PriceMapView`와
  `ApartmentAutocomplete`에 각각 리터럴 문자열로 중복(공유 상수 없음).
- `/api/stats/dashboard`가 반환하는 `topPrices`/`hotIssues` 필드가
  어떤 뷰에서도 실제로 렌더링되지 않음(죽은 API 페이로드 — 이번
  STEP은 데이터 로직을 다루지 않으므로 기록만).

---

## 35. Statistics 공통 pattern 제안(§41)

요청된 구조(`Page Header → Filter Bar → Summary → Ranking/Table/Chart
→ Detail context → Share`)는 **타당하다** — 현재 VolumeView가 이미
이 구조의 부분집합(Header→viewToggle+chip→차트/표)을 갖고 있어
확장이 자연스럽다. RankingListView 5종은 Filter Bar만 추가하면 거의
그대로 이 틀에 들어맞는다. CompareView/PriceMapView는 "Filter Bar"
자리에 각자의 검색/범례가 들어가는 특수 케이스로 유지하되 Page
Header/Summary 자리는 통일 가능.

**Share 위치**(§42 선행 설계): Apartment Detail의 `KakaoShareButton`
위치(Hero 우측)를 참고해, Statistics도 Page Header 우측에 동일
컴포넌트를 배치하는 것을 제안 — 코드 확장은 SHARE-2에서, 이번
STEP은 위치만 지정.

---

## 36. STATISTICS V2 선행조건

1. FilterBar/FilterChip 공용 컴포넌트(§12) 구현.
2. 색상 의미표(§8.3) 확정 및 `#ef4444` 4중 충돌 해소.
3. RANKING_CONFIGS 패턴을 정식 공유 컴포넌트로 승격(이미 80% 완성된
   상태 — 5개 슬러그가 이미 이 방식으로 통합돼 있음).
4. 공유 skeleton 컴포넌트로 "분석 중입니다..." 평문 로딩 전부 교체.
5. ComingSoon/Empty/Error 3분류 시각 분리(§20.3).
6. 16개 메뉴 아이콘 emoji→Lucide 전환(§19 우선순위 1번).
7. 랜딩 그리드에서 무관한 2개 링크를 별도 섹션으로 분리.
8. `COMPARE_COLORS`/`QUINTILE_COLORS`를 공유 팔레트 상수로 통합
   (또는 의도적으로 다른 목적임을 이름으로 명확히 구분).

---

## 37. Component inventory(§45)

38개 `src/components/*` 직속 파일 전수 조사(카테고리/import 수는 4번
조사 agent의 grep 결과 기준).

### KEEP
`Header.tsx`(20+ 참조), `HeaderAuthButton`, `AuthGate`,
`ApartmentAutocomplete`(5), `ApartmentScoreCard`, `FullPageLoader`(3),
`KakaoPlaces`(4), `KakaoMapEmbed`, `LoginModal`(2), `KakaoShareButton`
(신규 브랜드 토큰 사용처), `AreaSelector`, `TradeTimelineList`,
`AptSpecGrid`, `RankCard`(3), `ApartmentSearchTrigger`.

### REFINE
- `ApartmentQuickSearch` + `HomeApartmentSearch` — 거의 동일한
  검색-모달 흐름을 각자 재구현 중. placement variant를 갖는 단일
  컴포넌트로 리팩터 후보.
- Map의 커스텀 검색/바텀네브 — §10/§18에서 이미 지시한 대로 Header/
  BottomNav 재사용으로 전환.
- `SchoolDistrictPanel`/`NeighborhoodInfoPanel`/`LivingEnvironmentPanel`
  — 3개 파일이 동일한 `cardStyle` 객체 리터럴(`padding:'1rem 1.1rem',
  borderRadius:'10px', background:'#f8fafc', border:'1px solid
  var(--border-color)'`)을 그대로 복사해 쓰고 있음 — 공유 상수/헬퍼로
  통합.

### MERGE
- 위 3개 패널의 `cardStyle` → 하나의 export 상수 또는 소형 wrapper
  컴포넌트.
- `ApartmentQuickSearch` + `HomeApartmentSearch` → 단일
  `SearchModal`(variant prop).

### DEPRECATE(0 importer, 실측 확인 — 삭제는 별도 STEP에서 승인 후)
`KakaoScriptLoader.tsx`, `SearchFilter.tsx`, `Hero.tsx`,
`MarketInsights.tsx`, `TableList.tsx`, `CardList.tsx`,
`SearchFilterBar.tsx` — 38개 중 7개(18%)가 어디서도 import되지
않는 죽은 컴포넌트.

### NEW(제안, 이번 STEP은 설계만)
`SectionHeader`(§16), `FilterBar`/`FilterChip`(§12), `Badge`(§14
4색 체계 공식화), `EmptyState`(empty/soon/error 3-variant, §20),
`Skeleton`(범용 section skeleton, 기존 `.skeletonBar` 패턴을
컴포넌트화), `BottomNav`(Header에서 분리, §18).

---

## 38. Hardcoded style debt — 상위 파일(§46)

| 파일 | 하드코딩 hex | 인라인 fontSize | 비고 |
|---|---|---|---|
| `src/app/apt/[name]/apt-client.tsx` | 18 | 15 | 합계 최다(33) — 향후 CSS 모듈화 최우선 후보 |
| `src/app/map/page.tsx` | 15 | 12 | 합계 27, `#FEE2E2`/`#EF4444` 에러 블록 1곳에서 7회 반복 |
| `src/app/stats/page.module.css` | 23 | — | `#03C75A` 리터럴 중복 포함(§2-3) |
| `src/app/stats/[type]/type-client.tsx` | 19 | 3 | `COMPARE_COLORS` 배열 등 팔레트 하드코딩 |
| `src/app/tools/tools.module.css` | 15 | — | 성공/경고/실패 3색 비공식 세트(§8.3 warning/error 토큰화 대상) |
| `src/app/ai-search/ai-search-client.module.css` | 14 | — | |
| `src/app/page.module.css`(Home) | 14 | — | `#03C75A` 리터럴 중복 포함 |
| `src/app/school/school.module.css` | 13 | — | radius도 토큰 미사용(§32) |
| `src/components/LivingEnvironmentPanel.tsx` | 3 | **16** | fontSize 인라인 최다 단일 컴포넌트 |

우선순위: (1) `apt-client.tsx`/`map/page.tsx`(합계 최다 + 가장 자주
보이는 화면), (2) `stats/*`(§34~36에서 이미 최우선으로 다룸), (3)
나머지는 DS-6 일반 정리 단계에서.

---

## 39. Token proposal(§44 — 최종안)

기존 토큰을 최대한 재사용하고, 실측으로 확인된 **진짜 결측만** 신규
추가한다.

```css
/* 기존 유지 */
--primary-color, --primary-hover, --bg-color, --card-bg,
--text-primary, --text-secondary, --text-muted, --border-color,
--up-color, --down-color,
--shadow-sm, --shadow-md, --shadow-lg, --shadow-card,
--radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-pill,
--transition-fast, --transition-normal, --transition-slow,
--ejip-green, --ejip-green-deep, --ejip-mint, --ejip-yellow,
--ejip-charcoal, --ejip-gray-50 (§2-2 결정 대기)

/* 신규 제안 — 구현 전 승인 필요 */
--radius-2xl: 16px;                 /* §6 */
--warning-color: #f59e0b;           /* §8.3 */
--error-color: #ef4444;             /* §8.3, --up-color와 분리 */
--info-color: #3b82f6;              /* §8.3 */
--control-height-sm: 36px;
--control-height-md: 44px;          /* 터치 타깃 기준, §9/§11 */
--control-height-lg: 52px;
--content-width: 1200px;            /* 이미 .container가 이 값, 토큰화만 */
--z-header: 100;
--z-dropdown: 500;
--z-modal: 1000;
--z-toast: 2000;
--font-size-display: 1.75rem;       /* §3.2 */
--font-size-page-title: 1.25rem;
--font-size-section-title: 1.125rem;
--font-size-card-title: 1rem;
--font-size-body: 0.9375rem;
--font-size-body-sm: 0.875rem;
--font-size-caption: 0.75rem;       /* 하한선 */
--line-height-tight: 1.3;
--line-height-normal: 1.5;
--line-height-relaxed: 1.7;
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
--space-12: 48px;

/* 정리 대상(dangling, 즉시 제거 또는 정의 추가 필요) */
--background-color  /* 정의 없이 Community/My/School/Stats/Admin/Home에서 참조 중 */
--bg-light           /* 정의 없이 School에서 참조 중 */
```

**z-index 근거**: 실측된 리터럴값 — modal overlay 999, Map bottom nav
1000, LoginModal 3000 — 현재 서로 다른 파일에서 각자 정한 값이라
겹칠 위험이 있음, 위 4단계 스케일로 통합 제안.

---

## 40. Migration roadmap(§47)

한 번에 전체 재작성하지 않는다. 제안 순서:

- **DS-2 Foundation**: 위 신규 토큰 추가(색/spacing/z-index/control-
  height), `--background-color`/`--bg-light` 정리(정의 추가 또는
  참조 제거), 하드코딩된 `--primary-color` 리터럴 3곳 교체, 그린 색상
  결정(§2-2, 승인 필요 — 이 결정이 나야 이후 단계에서 배지/버튼 색이
  확정됨), 모바일 전역 폰트 축소 제거 여부 결정(§3.3, 승인 필요).
- **DS-3 Home/Navigation**: Map의 검색/바텀네브를 Header/BottomNav
  재사용으로 전환(§10, §18), `SearchModal` 통합(§37 MERGE).
- **DS-4 Statistics V2**: §36 선행조건 전부 충족 후 착수 — 가장
  기술부채가 크고 사용자 요청상 최우선("가장 중요").
- **DS-5 Detail 계열 정리**: School/Community/My를 카드/배지/아이콘
  체계에 맞춰 정렬(구조 재배치 아님, 토큰 교체 위주).
- **DS-6 마무리**: 남은 emoji→Lucide 전환, 죽은 컴포넌트 7개 제거,
  contrast 조정(§29), 남은 하드코딩 정리.

---

## 41. Regression strategy(§48)

- **Visual QA**: 터치된 페이지마다 375/390/430/desktop 스크린샷
  (APT DETAIL QA에서 이미 검증된 iframe 고정폭 기법 재사용).
- **Route smoke test**: `next build` 성공 + 주요 라우트 수동
  클릭스루(이미 이번 STEP까지 매번 지켜온 관행).
- **데이터 로직 불변**: 모든 DS 마이그레이션 STEP은 CSS/토큰/마크업만
  변경 — API 호출, 계산 로직, DB 접근은 손대지 않는다(이 원칙은 이미
  Score Engine/APT QA 전체에서 지켜져 왔다).
- **죽은 컴포넌트 제거는 별도 diff**로 — 리팩터와 삭제를 같은 커밋에
  섞지 않는다.
- 가능하면 스크린샷 diff 비교 도구 도입 검토(이번 STEP 범위 밖,
  제안만).

---

## 42. "이집답다" 정의(§50)

이번 감사 결과를 근거로 확정:

- **신뢰감**: Statistics의 `ComingSoonCard`가 "임의의 추정치를
  보여드리지 않기 위해 실제 데이터가 연동될 때까지 비워둡니다"라고
  명시하는 것, Score Engine이 peer-percentile 기반 설명만 생성하고
  AI로 채우지 않는 것 — 이미 실제 코드에 녹아있는 제품 철학이다.
- **데이터 중심**: 이집점수/브리핑은 항상 실측 데이터에서만 문장을
  만든다(§S2C explain.ts/briefing.ts 원칙) — 계속 유지.
- **복잡하지 않음**: 현재 가장 못 지키는 원칙 — Statistics의 6개
  서로 다른 구현이 정확히 그 반대 사례다. DS-4가 이를 교정하는
  단계다.
- **판단을 도와줌**: Algorithmic Briefing, 카테고리 점수+설명 패턴 —
  숫자만 나열하지 않고 "서구 비교 단지보다 좋은 편" 같은 상대적
  해석을 준다.
- **친근하지만 장난스럽지 않음**: 마스코트는 loading/empty/guidance
  전용, 가격/법률/오류에는 쓰지 않는다(§21) — 이미 대체로 지켜지고
  있으나 규칙으로 명문화가 필요했다(이번 STEP에서 함).
- **중요한 숫자는 명확**: 아직 부족 — 색상만으로 상승/하락을
  전달하는 곳, 모든 숫자를 무조건 굵게 만드는 곳이 남아있다(§25,
  §4).
- **설명은 이해하기 쉽게**: Score explain.ts의 peer-비교 문장("~보다
  좋은 편입니다")이 좋은 예시 — 과장 어휘 금지 원칙과 함께 이미
  검증됨.
- **브랜드 Green은 절제해서 사용**: 현재 실제로는 정반대 — 그린이
  두 값으로 쪼개져 있고(§2-2), 파란 배경+초록 텍스트 같은 어색한
  조합이 여러 곳에 있다(§2-1 Community/My 배지). "절제"는 색이 적게
  쓰인다는 뜻이 아니라 **의미가 분명할 때만** 쓴다는 뜻으로 재정의
  — §8의 semantic 테이블이 그 실행 도구다.

---

## 43. 코드 변경 여부(§53)

**이번 STEP에서 UI 페이지 코드 변경 없음.** 신규 파일은 이 문서와
CHANGELOG뿐이다. 토큰 추가(§39)와 모바일 전역 폰트 축소 제거(§3.3),
브랜드 그린 통일(§2-2), `--text-muted` contrast 조정(§29)은 전부
**시각적 영향이 있는 foundation 변경**이라 이번 STEP에서 구현하지
않고 제안만 한다 — DS-2 착수 전 별도 승인 요청.

## 44. DB/schema 변경 여부

없음. 이번 STEP은 DB/API를 전혀 건드리지 않았다.
