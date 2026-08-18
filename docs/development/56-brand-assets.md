# BRAND STEP 56-B2 — Brand Asset Package

상태: **컴포넌트/토큰 기반 완료 / 실제 로고·심볼·마스코트 그래픽 아트웍
미제작(BLOCKER) / 실제 화면 미적용 / commit·push 하지 않음**

## 기준 브랜드 방향

- 한글 메인 `이집`, 영문 보조 `e-jip`, 슬로건 "복잡한 부동산, 이집으로
  쉽게"(BRAND STEP 56-A, 승인 상태)
- 이집 Green 중심, White/Charcoal 기반, Yellow는 소량 accent
- 로고 = 브랜드 표지판, 이집이 = 서비스 안내자, Brand Voice = '이집/이
  집' 중의성을 필요한 순간에만
- 친숙하되 네이버 복제 금지

## 로고 구성

**실제 로고 그래픽(벡터 워드마크) 자산 없음.** `BrandLogo` 컴포넌트는
텍스트 워드마크("이집" + "e-jip")를 Pretendard 폰트로 렌더링한다 —
"로고 SVG가 없을 경우에도 text fallback이 깨지지 않아야 한다"는 요구를
그대로 만족하며, 이것이 현재의 실제 모습이다(자산 도착 전까지는
fallback이 아니라 "지금의 로고"다).

## 심볼 구성

**실제 심볼 그래픽(디자인된 벡터 마크) 자산 없음.** `BrandSymbol`
컴포넌트는 이니셜 모노그램(둥근 배지 + "이" 한 글자)으로 자리를
대신한다. 이는 최종 심볼 디자인이 아니라 **타이포그래피 기반
placeholder**임을 명확히 한다 — 로고/심볼 자체를 손으로 그리는 벡터
디자인 작업은 이번 STEP의 범위가 아니고(자신 있게 확정할 수 없는
영역), 대신 그 자리와 API만 확정했다.

## 브랜드 컬러

기존 `src/app/globals.css`를 조사한 결과, `--primary-color: #03c75a`
가 이미 있고 **원본 코드 주석이 명시적으로 "네이버 그린"이라고 적어
두었다**(`--bg-color`도 "네이버 배경색과 유사한 연회색", `--up-color`/
`--down-color`도 "네이버 증권/부동산 스타일"). D안이 "네이버 복제품처럼
보이지 않게 차별화"를 요구하는 것과 정면으로 부딪히는 지점이다.

**판단**: 이번 STEP에서는 `--primary-color` 값을 바꾸지 않았다(전역
변수 하나를 바꾸면 즉시 전체 production 화면 색이 바뀌므로, 이는 사실상
"실제 화면 적용"이지 토큰 준비가 아니다 — 18번 "이번 STEP에서 실제 UI
적용 금지" 원칙과 충돌한다). 대신 티켓이 제시한 D안 팔레트를 **새
변수로 추가만** 했다(`globals.css`, 기존 값 옆에 additive로 배치,
어떤 기존 규칙도 참조하지 않아 시각적 변화 0):

```css
--ejip-green: #13A367;
--ejip-green-deep: #0A7A4F;
--ejip-mint: #E6F7EF;
--ejip-yellow: #FFCA3D;
--ejip-charcoal: #1F2937;
--ejip-gray-50: #F5F6F8;
```

`BrandLogo`/`BrandSymbol`의 `tone="default"`는 이미 `--ejip-green`을
참조한다(새 컴포넌트는 새 토큰을 쓰고, 기존 전역 UI는 기존
`--primary-color`를 그대로 쓰는 상태 — 두 값이 당분간 공존한다:
`#03c75a` vs `#13A367`).

**향후 결정 필요**(STEP 57 이후, 시각 검수 후):
1. `--primary-color`를 `--ejip-green`으로 점진 전환(전역 alias 교체,
   실제 색상 변경 — Header/버튼/active 컬러 등 전부 영향)
2. 또는 기존 `#03c75a`를 그대로 유지하고 새 토큰은 신규 브랜드 자산
   (로고/심볼/마스코트) 전용으로만 한정

둘 다 코드 관점에서는 간단하다(전역 변수 alias 한 줄) — 결정 기준은
순수히 **시각적으로 어느 쪽이 "네이버 복제로 안 보이면서도 신뢰감
있는지"**이며, 이건 실제 화면에 적용해보고 판단할 문제라 이번 문서
STEP에서 확정하지 않는다.

## Typography

`src/app/globals.css` 1번째 줄에서 이미 확인:

```css
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
```

**Pretendard가 이미 CDN import로 로드되고 있다** — 새 폰트 설치/추가
불필요(원칙 그대로 준수). 브랜드 타이포 규칙:

- 한글 "이집" — `font-weight: 800`, 살짝 좁힌 자간(`letter-spacing:
  -0.3px`) — strong/compact
- `e-jip` — 보조, 더 작고(0.62em) 연하게(`opacity: 0.7`) — secondary
- 본문/나머지 UI — 기존 `var(--font-family)` 그대로, 브랜드 컴포넌트도
  별도 폰트 지정 없이 이 변수를 상속받는다(명시적으로 폰트를 재선언
  하지 않음 — `BrandLogo.module.css`에 `font-family` 없음 확인).

## Mascot 역할

56-A 정의 그대로: 서비스 안내자, 상태 기반으로만 등장(상시 아님).
디자인 원칙(56-A 10번)을 그대로 계승 — 신뢰감 > 귀여움, 에러 화면은
캐릭터 자제.

## Mascot 필요 pose

`public/brand/mascot/README.md`에 규격을 정의했다(이 문서와 별도
파일 — 자산 디렉터리 안에 두어 실제 파일이 도착했을 때 바로 옆에서
참고할 수 있게 함). 표 요약:

| 포즈 | 용도 | 우선순위 |
|---|---|---|
| `ejipy-search` | AI 조건검색 대기 | 최우선 |
| `ejipy-loading` | FullPageLoader global loading | 높음 |
| `ejipy-empty` | 검색결과없음/최근본단지없음 | 높음 |
| `ejipy-analyze` | section loading 보조 | 중 |
| `ejipy-default` | empty state 기본 | 중 |
| `ejipy-guide` | onboarding/준비중 안내 | 낮음 |
| `ejipy-error` | (사용 자제, 보류) | — |

## 파일명 규칙

`ejipy-{pose}.webp`(+ 필요 시 동일 이름 `.png` fallback), 소문자·하이픈
구분, `public/brand/mascot/` 아래 평면 구조(하위 디렉터리 없음 — 개수가
적어 불필요).

## 파일 포맷

WebP 주 포맷, 투명 배경, 1:1 기본 비율, 원본 1024px 이상 확보, 파일당
200KB 권장 상한. 상세는 `public/brand/mascot/README.md` 참고.

## BrandLogo API

`src/components/brand/BrandLogo.tsx`(+ `.module.css`) 신규 생성:

```tsx
<BrandLogo />                          {/* horizontal, default */}
<BrandLogo variant="compact" />        {/* "이집"만, e-jip 숨김 */}
<BrandLogo tone="light" />             {/* 어두운 배경용 흰 텍스트 */}
<BrandLogo ariaLabel="이집" />         {/* 주변에 이미 "이집"이 텍스트로 읽히는 화면에서 중복 안내 방지 */}
```

- `variant`: `'horizontal' | 'compact'`(기본 `'horizontal'`)
- `tone`: `'default' | 'light'`(기본 `'default'`)
- `className`: 외부에서 위치/여백 조정용
- `ariaLabel`: 생략 시 일반 텍스트로 그대로 읽힘(추가 처리 불필요),
  넘기면 내부 텍스트에 `aria-hidden` + 래퍼에 `role="img"
  aria-label`로 전환(12번 "동일 화면 중복 읽힘 방지" 요구 반영)

## BrandSymbol API

`src/components/brand/BrandSymbol.tsx`(+ `.module.css`) 신규 생성:

```tsx
<BrandSymbol size={24} />
<BrandSymbol size={40} tone="light" />
<BrandSymbol size={32} ariaLabel="이집" />  {/* 단독 사용 시에만 접근성 라벨 노출 */}
```

- `size`: px 숫자(기본 24) — 하나의 prop만 허용(요구대로 최소 API)
- `tone`: `'default' | 'light'`
- 기본은 `aria-hidden="true"`(장식용, 보통 로고/텍스트와 함께 쓰여
  중복 정보를 전달하지 않음) — `ariaLabel`을 넘기면 단독 사용 가능하게
  `role="img"`로 전환

## favicon/app icon 전략

`src/app/favicon.ico`가 실제 존재하고 유효한 ICO 바이너리임을 확인했다
(파일 헤더 `00 00 01 00` = 정상 ICO 시그니처, 4개 이미지 포함).
`src/app/layout.tsx`의 `metadata` 객체에는 `icons` 필드가 없어 —
Next.js가 `src/app/favicon.ico`를 파일 컨벤션으로 자동 인식하는
기본 구조 그대로다. 별도 `icon.png`/`apple-icon.png` 컨벤션 파일도
없음(확인만, 생성하지 않음).

**변경하지 않는다.** 이유: `BrandSymbol`이 아직 placeholder
모노그램이라, 지금 favicon을 이걸로 바꾸면 오히려 "엉성한 아이콘을
production에 확정"하는 셈이 된다(원칙 위반). 실제 심볼 아트웍이
확정되면 그때 `src/app/favicon.ico` 교체 + 필요 시 Next.js
`icon.png`/`apple-icon.png` 컨벤션 파일 추가를 STEP 57-A 이후로
넘긴다.

## loading 적용 전략

`src/components/FullPageLoader.tsx`는 **코드를 수정하지 않았다**(18번
"실제 UI 적용 금지" + 최소 변경 원칙). 현재 API(`active`, `message`)가
이미 단순하고 잘 작동하므로 선행 리팩터를 하지 않는다. STEP 57-A에서
검토할 확장 형태만 문서로 남긴다:

```tsx
<FullPageLoader
  variant="search"   // 향후: 포즈별 마스코트 이미지 매핑에 사용
  message="이집이가 조건에 맞는 이집을 찾고 있어요."
/>
```

이 `variant` prop은 `public/brand/mascot/README.md`의 pose 파일명과
1:1 대응시킬 수 있다(`search` → `ejipy-search.webp`) — 실제 구현은
마스코트 파일이 도착한 뒤 STEP 57-A에서.

## image optimization

- 마스코트 이미지는 (도착 후) `next/image`로 서빙한다 — 프로젝트에
  이미 Next.js 16이 설치돼 있어 별도 의존성 추가 없이 바로 사용
  가능(자동 리사이즈/포맷 협상).
- GIF·autoplay video·Lottie·canvas animation 등 무거운 방식은
  쓰지 않는다(원칙 그대로, 이번 STEP에서 그런 의존성을 추가하지도
  않았음 — `package.json` 무변경 확인).
- Loading의 1차 표현은 SVG/CSS 애니메이션(이미 `FullPageLoader`가
  `spinner` CSS keyframe으로 구현 중)을 우선하고, WebP 마스코트는
  "상태를 알려주는 정적 이미지"로 보조하는 조합을 STEP 57-A 설계
  방향으로 유지한다(56-A 문서 6-1 결론과 동일).

## accessibility

- `BrandLogo`: 기본은 순수 텍스트라 스크린리더가 그대로 읽는다.
  `ariaLabel`을 넘긴 경우에만 내부 텍스트를 `aria-hidden` 처리하고
  `role="img" aria-label`로 대체 — 중복 안내 방지 옵션을 API로
  제공(강제하지 않음).
- `BrandSymbol`: 기본 `aria-hidden="true"`(장식용) — 대부분
  `BrandLogo`나 주변 텍스트와 함께 쓰여 심볼 자체가 추가 정보를
  전달하지 않기 때문. `ariaLabel`을 넘기면 단독 사용 가능하도록
  `role="img"`로 전환.
- 두 컴포넌트 다 현재는 이미지가 아니라 텍스트/CSS 배지라 `alt` 속성
  이슈 자체가 없다 — 실제 이미지/SVG로 교체되는 시점에 `alt`/
  `aria-hidden` 처리를 다시 검토해야 한다(이 문서에 명시적으로 남겨
  STEP 57-A에서 잊지 않도록 함).

## 성능 관점

- 이번 STEP에서 추가된 코드는 텍스트/CSS 배지뿐이라 번들/로딩 성능에
  영향이 사실상 없다(이미지 자산 0개).
- `package.json` 변경 없음(Lottie/canvas 라이브러리 등 신규 설치
  안 함 — `git diff package.json` 결과로 확인).
- 마스코트 이미지가 실제 추가될 때 지킬 상한(파일당 200KB, WebP,
  1024px 원본)은 `public/brand/mascot/README.md`에 규격으로 미리
  박아뒀다.

## Brand Voice 연계

56-A에서 정의한 정보형/브랜드형/캐릭터형 3단계 copy 체계를 그대로
유지한다. 코드 상수화(`brandCopy.loading.search` 등)는 **이번
STEP에서 하지 않았다** — YAGNI 판단 근거: 실제로 이 상수를 소비할
코드(FullPageLoader 확장, empty state 컴포넌트 등)가 아직 하나도
없다(FullPageLoader를 이번 STEP에서 건드리지 않기로 했으므로).
소비처가 생기는 STEP 57-A에서 그 컴포넌트와 함께 만드는 것이 실제
사용 패턴에 맞는 API를 얻기에도 낫다고 판단했다.

같은 이유로 `src/lib/brand.ts`(또는 `src/config/brand.ts`)의
`EjipyPose` 타입도 **만들지 않았다** — 현재 이 타입을 참조할 컴포넌트
prop이 없다(위 `FullPageLoader`의 `variant` prop도 문서 제안일 뿐
아직 코드에 없음). 타입만 미리 만들어두면 실제 사용 시점에 실제
필요와 다르게 설계돼 있을 위험이 있어, "소비처가 생길 때 함께
정의"하는 쪽을 택했다.

## STEP 57-A 적용 대상

BrandLogo/BrandSymbol 컴포넌트 자체는 **지금 바로 사용 가능**하다
(텍스트/모노그램 기반이라 이미지 자산 대기 불필요). 단, 아래 표처럼
"컴포넌트 사용 가능"과 "완성된 로고로 사용 가능"은 다르다:

| 항목 | 컴포넌트 인프라 | 최종 그래픽 자산 |
|---|---|---|
| Header 로고 교체 | 가능(`BrandLogo` import만 하면 됨) | **불가 — 그래픽 로고 없음, 현재도 텍스트라 시각적 차이 없음** |
| FullPageLoader 브랜드화 | `variant` prop 설계만 있음, 코드 미작성 | 마스코트 이미지 없어 불가 |
| Empty state 이집이 적용 | — | 마스코트 이미지 없어 불가 |
| favicon 교체 | — | 심볼 아트웍 없어 불가 |

즉 STEP 57-A는 **"문구/컬러/컴포넌트 배선" 수준까지는 지금 자산으로도
진행 가능**하지만("이집이가 조건에 맞는 이집을 찾고 있어요" 같은 Brand
Voice 문구를 FullPageLoader message에 넣는 것 자체는 가능), **실제
로고/심볼/마스코트 "그래픽"이 들어가는 부분은 그 자산이 나올 때까지
불가능**하다.

## 아직 미확정 자산 (BLOCKER)

- **로고 벡터 워드마크**(SVG) — 미제작. `BrandLogo`는 텍스트로 대체
  중이며, 이게 "임시"가 아니라 다음 자산이 나올 때까지의 **실제
  운영 상태**다.
- **심볼 벡터 마크**(SVG) — 미제작. `BrandSymbol`은 이니셜 모노그램
  placeholder.
- **이집이 마스코트 일러스트**(7개 포즈, WebP) — 전부 미제작.
- **`--primary-color` 최종 교체 여부** — 판단 보류(위 "브랜드 컬러"
  참고), 실물 시안 없이 텍스트로만 결정하지 않기로 함.

이 넷은 실제 디자인/이미지 생성 작업이 필요하며, 이번 STEP(코드
패키지화)의 범위를 벗어난다. **BLOCKER로 보고한다** — 사용자 승인
없는 엉성한 자산을 production 자산으로 확정하지 않는다는 원칙에 따라,
이 문서는 "무엇이 필요한지"까지만 확정하고 실제로 그리지 않았다.
