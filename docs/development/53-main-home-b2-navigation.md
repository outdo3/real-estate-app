# MAIN UI-B2 / STEP 53 — Home Explore Section + Header + Bottom Navigation UI 정리

상태: **구현 완료 / production build 통과 / commit·push 하지 않음**

## 목적

STEP 52(B1 Search Hero)로 홈 상단은 정리됐지만, 그 아래 Quick Menu와
Header/Bottom Navigation은 과거 이모지 중심 UI가 그대로 남아 시각적
단절이 컸다. 이번 STEP에서는 B1 기능(검색/지도/AI/최근 본 단지)을
전혀 건드리지 않고, 이모지를 동일한 SVG line icon system으로 교체하고
홈 탐색 영역과 하단 nav의 정보구조/디자인을 정리한다.

## 모바일 실사용 화면에서 확인된 문제

- 홈은 최상위 화면인데도 Header에 뒤로가기 화살표가 항상 표시됨.
- Quick Menu/Bottom Nav 아이콘이 전부 컬러 이모지라 B1 Search Hero와
  시각적으로 이질적.
- "핵심 Quick 메뉴"라는 제목이 실제 사용자 언어보다 개발용 표현에
  가까움.
- "재개발·분양" 진입점이 홈 본문에 없음(STEP 51 조사에서 이미 식별,
  B2로 이관됨).
- `/map`이 Header를 렌더링하지 않고 자체 하단탭바(`MapBottomNav`)를
  별도로 구현하고 있어, 아이콘 교체를 Header 한 곳만 해서는
  `/map`에서 이모지가 남는 문제가 있음(코드 확인으로 발견).

## Header 변경

`src/components/Header.tsx`, `Header.module.css`:

- **뒤로가기 버튼**: `pathname === '/'`일 때만 숨긴다(`isHome` 조건 추가).
  다른 모든 경로는 조건에 안 걸리므로 기존 동작 100% 유지 — prop을
  추가하지 않고 Header 내부에서 자동 판단하게 해서, 호출부를 하나도
  건드리지 않고 안전하게 홈에만 적용했다.
- **메뉴 아이콘**: `NavButton`의 `icon: string`(이모지) prop을
  `Icon: LucideIcon`(컴포넌트) prop으로 교체. 데스크톱 상단 메뉴와
  모바일 하단탭바가 같은 컴포넌트라 양쪽에 동일하게 적용됨(모바일
  22px, 데스크톱 18px — CSS 미디어쿼리로만 크기 분기, 컴포넌트는 하나).
- **active 색상**: 기존에는 데스크톱에 active 색상 규칙 자체가
  없었고(버그), 모바일도 `--text-primary`(검정)였다. 이번에 데스크톱
  active 규칙을 추가하고 모바일 포함 전부 `--primary-color`(이집
  그린)로 통일. inactive는 기존대로 `--text-muted`.
- 메뉴 5개 항목의 아이콘/active 판정을 새 `src/lib/bottom-nav-items.tsx`
  설정 하나로 옮겨서 관리한다(아래 참고).

## Explore/Quick Menu Before

```
핵심 Quick 메뉴
  큰 카드 1개: 📊 시장통계 (인기)
  아이콘 그리드 6개: 📉최근하락 🏆최고가 📈최고상승 📊거래량 ⚖️단지비교 💰갭투자
```

## Explore/Quick Menu After

```
시장 둘러보기
  큰 카드 2개: [BarChart3] 시장통계 (인기) / [Building2] 재개발·분양
  아이콘 그리드 6개: [TrendingDown]최근하락 [Award]최고가 [TrendingUp]최고상승
                     [Activity]거래량 [Scale]단지비교 [Coins]갭투자
```

## 메뉴 정보구조

- 제목: "핵심 Quick 메뉴" → **"시장 둘러보기"**. 후보로 "부동산
  둘러보기"도 검토했으나, 실제 하위 항목 8개(시장통계/재개발·분양/
  최근하락/최고가/최고상승/거래량/단지비교/갭투자)가 전부 시장·통계
  성격이고 "부동산 탐색" 전반(검색/지도/AI)은 이미 B1 Hero가 맡고
  있어, 이 섹션에는 "시장 둘러보기"가 실제 구성과 더 정확히 맞는다고
  판단했다.
- 큰 카드에 **"재개발·분양"을 신규 추가**. B1(STEP 52) 설계 문서에서
  "재개발분양 등 전체 탐색영역 정리는 B2에서 한다"고 명시적으로
  이관해 둔 항목이라 이번 STEP 범위가 맞다. 하단 nav에도 같은 항목이
  있지만, 하단 nav는 상시 노출되는 전역 이동 수단이고 이 카드는 홈
  본문 안의 탐색 진입점이라 위계가 달라 "중복 CTA"로 보지 않았다
  (B1에서 지도 카드를 제거한 것은 같은 위계의 진짜 중복이었던 것과
  다른 경우).
- 카드 1개→2개가 되면서 `.bigCards`의 `grid-template-columns`는 이미
  B1에서 `repeat(auto-fit, minmax(140px, 1fr))`로 바꿔둔 상태라 추가
  CSS 수정 없이 2열로 균등 배치됐다.

## 기존 route 유지 여부

전부 유지. 변경한 것은 라벨/아이콘/카드 구성뿐이고, `href`는 QUICK_MENU
6개·bigCards 2개·bottom nav 5개 모두 기존 그대로다. 유일한 변경은
"재개발·분양" 하단탭 active 판정을 `/redevelopment` 단독에서
`/redevelopment` 또는 `/presales`로 넓힌 것 — `/presales`는
`redevelopment-client.tsx`의 "분양" 탭에서 "분양정보 전체 보기"로
이어지는 같은 기능 영역인데(코드로 확인), 지금까지는 `/presales`에
있을 때 하단 nav 어느 탭도 active로 안 잡혔다. 이동 경로 자체는
바꾸지 않고 active 판정만 정확하게 넓혔다.

## 아이콘 시스템

`lucide-react`를 신규 설치해서 사용했다.

## package 추가 여부

**추가함(`lucide-react`)**. 판단 근거:

- 이번 STEP에서 아이콘이 필요한 자리가 최소 14곳(하단 nav 5 + Explore
  bigCard 2 + iconGrid 6 + B1 hero 2)이라, 수십 개는 아니지만 직접
  손으로 그린 SVG를 유지보수하기엔 적지 않은 개수다.
- `lucide-react`는 런타임 의존성이 없는 순수 아이콘 컴포넌트
  라이브러리로(실행 시 외부 호출 없음), React 19 peer dependency를
  공식 지원한다(`^19.0.0` 확인 후 설치).
  CLAUDE.md 8/9번 원칙이 금지하는 "유료 API"·"생성형 AI 의존성"과는
  무관한, 무료 오픈소스 UI 라이브러리다.
  개별 아이콘만 import해서 쓰므로 번들에는 실제 사용한 14개 아이콘만
  들어간다(트리쉐이킹).
- 직접 그린 SVG 14개보다 시각적 일관성(동일 stroke width/weight)을
  훨씬 안전하게 보장한다고 판단했다.
- `npm install` 후 `npm audit`로 확인한 결과 새 high-severity 취약점은
  없었다(기존에 있던 `nanoid`/`postcss`/`next` 전이 의존성 1건은
  `lucide-react`와 무관하게 이미 존재하던 것 — `npm ls nanoid`로 확인,
  이번 STEP 범위 밖이라 손대지 않음).

## 신규 icon component 여부

별도 wrapper 컴포넌트는 만들지 않았다(각 파일에서 `lucide-react`
아이콘을 직접 import). 대신 **하단 nav 5개 항목의 아이콘+active
판정 설정**을 `src/lib/bottom-nav-items.tsx` 하나로 묶어 신규
생성했다 — `Header.tsx`와 `src/app/map/page.tsx`의 `MapBottomNav`가
이 설정을 공유해서 쓴다(전에는 두 파일에 동일한 5개 항목 배열이
복붙돼 있었음).

## Bottom Navigation Before

```
🏠 홈   🗺️ 지도   📊 통계   🏗️ 재개발·분양   👤 MY
(active: 검정, inactive: 회색)
```

## Bottom Navigation After

```
[Home] 홈   [Map] 지도   [BarChart3] 통계   [Building2] 재개발·분양   [User] MY
(active: 이집 그린, inactive: 회색)
```

메뉴 5개·라벨 전부 유지("재개발·분양" 포함 — 실제 코드 확인 결과 더
나은 축약이 없다고 판단, 모바일 360~430px 전부에서 줄바꿈/잘림 없이
들어감).

## active route 처리

`src/lib/bottom-nav-items.tsx`에 항목별 `isActive(pathname)` 함수로
정리:

- 홈: `pathname === '/'`
- 지도: `pathname === '/map'`
- 통계: `pathname.startsWith('/stats')`
- 재개발·분양: `pathname.startsWith('/redevelopment') || pathname.startsWith('/presales')`
- MY: `pathname.startsWith('/my')`

`Header.tsx`와 `MapBottomNav` 둘 다 이 함수를 그대로 호출한다.

## safe-area

기존 `quickSection`의 `padding-bottom: calc(5.5rem + env(safe-area-inset-bottom))`은
그대로 두었다(변경 불필요, 모바일 실측에서 하단 nav와 콘텐츠 겹침
없음 재확인).

## B1 회귀검사

STEP 52에서 구현한 기능 전부 재검증(아래 "모바일 검증" 표 참고).
`HomeApartmentSearch.tsx`는 검색 아이콘(🔍→`Search`)만 교체했고
검색/검증/이동 로직은 한 줄도 건드리지 않았다.

## APT DETAIL V1 영향

**없음.** `src/app/apt/` 하위 파일은 전혀 수정하지 않았다. 공용
`Header.tsx` 변경(뒤로가기 조건부 숨김, 아이콘 교체)이 상세페이지에
어떻게 나타나는지 직접 확인했다 — 상세페이지는 `pathname`이 `/apt/...`
라 `isHome`이 항상 false이므로 뒤로가기 버튼이 기존과 동일하게
표시되고, 상단 메뉴 아이콘만 자동으로 SVG로 바뀐 것을 브라우저로
확인했다(회귀 아님, 의도된 전역 적용).

## NextAuth 기존 이슈 처리

**손대지 않았다.** STEP 52에서 발견된
`[next-auth][error][CLIENT_FETCH_ERROR]`는 이번 STEP 지시사항(25번)
대로 범위에서 완전히 제외했다 — `HeaderAuthButton.tsx`, NextAuth
설정, 관련 API route 전부 미수정.

## 모바일 검증

iframe 격리 기법으로 360/375/390/430px 동시 확인(`resize_window`
도구가 이 환경에서 실제 창 크기를 못 바꾸는 문제로 우회, STEP 52와
동일 방식).

| 케이스 | 결과 |
|---|---|
| 홈 → 일반 아파트 검색 → 상세 | 통과 ("대신롯데캐슬" 검색→선택→상세 이동, lawdCd/dong 정확) |
| 홈 → 지도에서 찾기 → /map | 통과 |
| 홈 → 조건으로 집 찾기 → /ai-search | 통과 |
| 최근 본 단지 → 상세 | 통과 |
| Bottom Nav 5개 route | 통과 (홈/지도/통계 확인, 재개발·분양은 `/presales`에서도 active 확인) |
| Home Header 모바일 | 통과 (뒤로가기 없음, "이집" 로고만 좌측) |
| 360px / 375px / 390px / 430px | 통과 — 검색창/버튼/최근 본 단지/시장 둘러보기 카드/아이콘 그리드/하단 nav 전부 overflow·잘림 없음, "재개발·분양" 라벨 줄바꿈 없음, safe-area 겹침 없음 |
| horizontal overflow | 없음 |

## PC 검증

- Bottom Nav는 여전히 모바일 전용(`@media (max-width: 900px)`에서만
  `position:fixed` 하단바로 전환) — 기존 responsive 정책 미변경, PC는
  상단 가로 메뉴 그대로.
- `/map`의 `MapBottomNav`는 원래부터 뷰포트와 무관하게 항상 표시되는
  구조였다(지도 페이지엔 다른 nav가 없어서) — 이 동작도 미변경, 아이콘/
  active 색상만 교체.
- 홈 탐색 섹션은 기존 `max-width:1200px` 컨테이너 안에서 카드 2개가
  균등하게 배치되고, 데스크톱에서 과도하게 넓어지거나 불필요한 빈
  공간이 생기지 않음을 확인.
- 데스크톱 상단 메뉴에서도 "홈" 항목이 이집 그린으로 active 표시되는
  것을 확인(기존에는 데스크톱에 active 스타일 자체가 없던 버그를
  같은 김에 수정).

## TypeScript

`npx tsc --noEmit` 통과(에러 없음).

## lint

`npx eslint src/app/home-client.tsx src/app/home-client.module.css src/components/Header.tsx src/components/HomeApartmentSearch.tsx src/lib/bottom-nav-items.tsx src/app/map/page.tsx`
— 0 errors(CSS 파일은 eslint 대상이 아니라는 warning 1건만, 정상).

## build

`npx next build` 통과, 30개 라우트 정상 생성.

## BRAND STEP으로 넘긴 항목

- 정식 이집 로고/로고 심볼/앱 아이콘/favicon 최종안
- 이집이 캐릭터/캐릭터 일러스트
- 브랜드 가이드 최종본
- (참고) 정식 brand color system 확정 — 이번엔 기존 이집 그린만
  유지하고 검색창의 green+purple 그라디언트 테두리는 B1 그대로 뒀다
  (Search Hero 재디자인 금지 지시에 따름).

## 수정/생성 파일

수정:
- `package.json`, `package-lock.json` (`lucide-react` 추가)
- `src/app/home-client.tsx`, `src/app/home-client.module.css`
- `src/components/Header.tsx`, `src/components/Header.module.css`
- `src/components/HomeApartmentSearch.tsx` (검색 아이콘만 교체)
- `src/app/map/page.tsx` (`MapBottomNav`만 수정, 지도 기능 로직 미수정)

신규:
- `src/lib/bottom-nav-items.tsx`
- `docs/development/53-main-home-b2-navigation.md`(이 문서)
