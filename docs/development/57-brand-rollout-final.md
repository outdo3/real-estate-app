# STEP 57 — Brand Rollout Final (BRAND CLOSE)

상태: **완료 — 브랜드 1차 rollout CLOSE, 다음부터는 핵심 기능 개발로
복귀**

이 문서는 STEP 56(자산 제작·검수) ~ STEP 57-A/B/C(실제 적용·확산·
마무리)에 걸친 이집(e-jip) D안 브랜드 rollout의 최종 상태를
한곳에 정리한다. 개별 작업 로그는 `CHANGELOG.md`의 각 STEP 항목과
`56-brand-assets-validation.md`(원본 검수)에 남아있고, 이 문서는
그 최종 결과물(현재 무엇이 어디에 어떻게 적용돼 있는지)만 요약한다.

## 브랜드 방향

- 한글 메인 `이집`, 영문 보조 `e-jip`
- 슬로건: `복잡한 부동산, 이집으로 쉽게`
- 메인 컬러: E-jip Green(`--ejip-green` 계열), 기존 전역
  `--primary-color`(#03c75a, 네이버 그린)는 이번 rollout에서
  건드리지 않음 — 신규 브랜드 자산(로고 이미지, 마스코트)에만
  D안 색상이 실제로 반영돼 있고, 기존 UI 전반의 색은 그대로다.
- 캐릭터: `이집이`(ejipy) — 서비스 안내자
- 로고 = 브랜드 표지판, Brand Voice = `이집 / 이 집` 중의성을
  선택적으로 활용

## production 적용 범위

### logo

`public/brand/logo/`(WebP, 4종 APPROVED만 반입):

- `ejip-logo-horizontal.webp` → `Header.tsx`(전 페이지 공통, apt
  상세 포함 — 간접 반영)
- `ejip-symbol.webp` → 반입만 되어 있고 코드에서 아직 참조하는
  곳 없음(향후 compact 헤더/스플래시 등에 쓸 수 있도록 준비)
- `ejip-logo-mono-green.webp`, `ejip-logo-mono-dark.webp` →
  반입만 되어 있고 아직 소비하는 화면 없음(다크 배경 UI가 생기면
  사용 후보)

### symbol

위 logo 항목 참고. `BrandSymbol.tsx`(STEP 56-B2 placeholder
컴포넌트)는 여전히 텍스트 이니셜 placeholder 상태 — 이번 rollout
에서 실제 심볼 이미지로 교체하지 않았다(Header는 이 추상화를
거치지 않고 `<img>`를 직접 써서 우회했기 때문에 실사용에는 문제
없음, 다만 `BrandSymbol`을 실제로 쓰는 화면이 생기면 그때 이미지로
교체 필요).

### mascot (이집이, 7종 전부 실사용 연결 완료)

`public/brand/mascot/`(WebP, 7종 전부):

| 파일 | 적용 위치 |
|---|---|
| `ejipy-default.webp` | Home hero 인사 캐릭터 |
| `ejipy-search.webp` | AI 검색 idle(질문 대기) 상태 |
| `ejipy-analyze.webp` | AI 브리핑 라벨 아이콘 |
| `ejipy-loading.webp` | `FullPageLoader`(전역 — AI 검색/apt 상세/map 공통 반영) |
| `ejipy-empty.webp` | Home 최근 본 단지 empty, AI 검색 결과없음, `/community` 빈 목록, `/presales` 결과없음 |
| `ejipy-guide.webp` | `/redevelopment` 준비중 카드, `/community/write` 안내문 |
| `ejipy-error.webp` | `/map` 지도 로드 실패, `/presales` API 에러 |

### Brand Voice (실제 적용 사례)

```text
복잡한 부동산, 이집으로 쉽게              (Home 태그라인, 원 슬로건)
이집이가 조건에 맞는 이집을 찾고 있어요.   (AI 검색 로딩)
찾는 이집이 아직 없어요. 검색 조건을 조금 바꿔보세요.  (AI 검색 결과없음)
아직 본 이집이 없어요. 관심 가는 단지를 둘러보세요.     (Home 최근 본 단지 empty)
{단지명}, 이집 어때요?                    (apt 상세 CommunityPreview 제목, 단지명 12자 이하일 때만)
이집에 대해 궁금한 점을 남겨보세요. 첫 글을 기다리고 있어요!  (CommunityPreview empty)
이집에서 살아본 이야기를 들려주세요.       (커뮤니티 글쓰기 안내)
```

원칙(끝까지 유지됨):

- 홈/검색/커뮤니티/loading/empty → Brand Voice 선택적 활용
- 실거래·대출·정책·error 핵심 문장 → 정보형 우선, 캐릭터는 보조
  (예: map/presales error는 캐릭터 아이콘만 추가, 원인 문구와
  재시도 CTA는 그대로 주정보)
- 한 화면에서 브랜드형+캐릭터형 문구 최대 1~2개
- `이집`/`이집이`/`이 집` 연속 반복 금지

### favicon / app icon

- `metadata.icons`(`src/app/layout.tsx`): favicon 16/32/48 +
  app-icon 96/192/512(icon) + app-icon 180(apple) 전부 연결.
- `src/app/favicon.ico`: `ejip-favicon-48.png` 기반 16/32/48
  멀티사이즈 ICO로 재생성 완료(기존 플레이스홀더 대체).
- **16px 최종 판정: KEEP.** 실제 16x16 픽셀을 nearest-neighbor로
  확대 검사한 결과, 노란 창문 등 세부 디테일은 뭉개져 거의
  보이지 않지만, 초록 배경 위 흰색 실루엣이라는 색상·형태 대비는
  또렷하게 유지된다 — 브라우저 탭에서 다른 탭과 구분하는 실용적
  목적은 충족한다고 판단해 simplified variant를 새로 만들지
  않았다.

### OG / 공유 이미지 (이번 STEP 57-C에서 신규 완료)

- 원본: `brand-source/og/ejip-og-main.png`(1672x941, B3에서
  APPROVED, "1200x630 파생 필요"로 보류돼 있던 항목).
- production 파생: `public/brand/og/ejip-og-main-1200x630.jpg`
  — Pillow로 결정론적 생성(새 이미지 생성 AI 호출 없음). 폭을
  1200px로 비율 유지 리사이즈(늘리기/찌그러뜨리기 없음) 후
  675px → 630px로 상하 center-crop(각 22~23px, 스케일 후 기준
  전체 높이의 3.3%). 잘린 22~23px는 원본에서도 로고/문구/캐릭터가
  없는 여백 영역(top: 연한 배경, bottom: 짙은 배너의 여백)만
  해당해 실제 콘텐츠 손실 없음(육안 확인 완료).
- 포맷: JPEG(투명도 불필요, SNS/크롤러 호환성 우선, quality 88).
- 크기: 1200x630, 108.4KB(권장 500KB 이내 통과).
- 연결한 곳 3곳(전부 같은 파일을 참조하도록 통일):
  1. `src/app/layout.tsx` — root `metadata.openGraph.images` +
     신규 `metadata.twitter`(`card: 'summary_large_image'`)
  2. `src/config/site.ts` — `buildOpenGraph()`(홈/검색/통계/
     분양/재개발/학교/커뮤니티/약관 등 14개 페이지가 이 헬퍼를
     통해 간접적으로 새 이미지를 받음)
  3. `src/components/KakaoShareButton.tsx` — 카카오톡 공유
     페이로드의 이미지 URL(`window.location.origin` 기반, 이전
     STEP에서 고친 "서버 전용 env var 클라이언트 노출" 버그
     패턴은 그대로 유지 — 경로 문자열만 교체).
- 기존 `public/og-image.png`(2026-08-10 생성, "이집(e-zip)" 오탈자
  + 파란 배경의 구버전 placeholder)는 어디서도 더 이상 참조하지
  않지만, 임의 삭제 금지 원칙에 따라 파일 자체는 삭제하지 않고
  그대로 남겨뒀다(사용자 확인 후 정리 여부 결정 가능).
- title/description은 이번 STEP에서 변경하지 않음(지시사항대로
  "공유 이미지 연결"만 수행, SEO 전체 개편 아님).

## ACTIVE assets

```text
ejip-logo-horizontal.webp        (Header)
ejip-app-icon-512/192/180/96.png (favicon/app icon)
ejip-favicon-48/32/16.png        (favicon/app icon)
ejipy-default.webp               (Home)
ejipy-search.webp                (AI 검색 idle)
ejipy-analyze.webp               (AI 브리핑)
ejipy-loading.webp               (FullPageLoader)
ejipy-empty.webp                 (Home/AI검색/community/presales empty)
ejipy-guide.webp                 (redevelopment/community write)
ejipy-error.webp                 (map/presales error)
ejip-og-main-1200x630.jpg        (OG/Twitter/Kakao 공유)
```

## RESERVED assets

```text
ejip-symbol.webp                 (public/brand/logo/에 반입됨, 코드에서 미참조)
ejip-logo-mono-green.webp        (반입됨, 미참조 — 다크 배경 UI 생기면 후보)
ejip-logo-mono-dark.webp         (반입됨, 미참조 — 다크 배경 UI 생기면 후보)
ejip-illustration-search.png     (brand-source에만 존재, public 미반입)
ejip-illustration-analyze.png    (brand-source에만 존재, public 미반입)
ejip-illustration-cheer.png      (brand-source에만 존재, public 미반입)
```

`unused != unnecessary` — illustration 3종은 STEP 57-A/B에서
모두 "억지로 모두 사용하지 않는다" 원칙에 따라 자연스러운
자리를 찾지 못해 보류했다. 향후 onboarding, campaign, briefing
introduction, 추천 완료(success) 상태 등에서 재검토 가능. 다만
이미 mascot 아이콘이 채운 자리(AI 검색 idle/브리핑 등)에 중복
배치하지 않는다는 원칙은 계속 유지한다.

## DEFER assets

```text
ejip-logo-mono-white.png   → DEFER (재작업 안 함)
ejip-logo-vertical.png     → DEFER (재작업 안 함)
favicon 16px simplified variant → DEFER (현재 KEEP 판정, 필요성 재확인되면 착수)
```

- **mono-white**: alpha 채널이 노이즈로 손상된 상태(B3에서 원인
  분석 완료 — 흰 로고를 흰 배경에서 배경제거하다 실패한 패턴)로
  REWORK 대상이었으나, 현재 production 어디에도 흰색 단색 로고가
  필요한 자리(다크 푸터, 다크 마케팅 배너, 다크 스플래시 등)가
  없어 **DEFER**로 최종 판단. 실제 소비처가 생기면 그때
  `ejip-symbol.png` 또는 `ejip-logo-horizontal.png` 같은 정상
  기준 자산에서 색상만 흰색으로 치환하는 결정론적 방식으로
  다시 만드는 것을 권장(배경제거 재시도 방식은 다시 실패할
  가능성이 높음).
- **vertical logo**: 3D 글로시 스타일이 horizontal/mono 계열의
  플랫 스타일과 불일치해 STEP 57-A에서 production 제외 결정,
  이번 STEP에서도 재생성하지 않고 **DEFER**로 확정. 실제
  세로형 로고가 필요해지면(예: 정사각형 소셜 프로필, 세로
  배너) 그때 horizontal 로고 구성요소를 기준으로 플랫 스타일로
  다시 조판하는 것을 권장.

## APT DETAIL V1 영향

STEP 57 전체에 걸쳐 상세페이지 자체 구조/데이터/카드 순서는
한 번도 변경하지 않았다. 유일하게 반영된 것은:

1. 공통 컴포넌트 변경의 간접 반영(Header 로고, FullPageLoader
   비주얼) — LOCK 규칙이 명시적으로 허용한 범위.
2. `CommunityPreview.tsx` 문구 변경(제목 pun, empty 문구) —
   LOCK 규칙이 "CommunityPreview 문구"만 명시적으로 허용, 이미지
   (마스코트) 추가는 금지돼 있어 실제로도 텍스트만 바꾸고
   이미지는 넣지 않았다(STEP 57-B에서 한 차례 실수로 추가했다가
   지시서 재확인 후 되돌린 이력 있음, `CHANGELOG.md` STEP 57-B
   항목 참고).

## DB 영향

STEP 56~57 전체에 걸쳐 DB/schema/migration 변경 없음.

## 향후 브랜드 확장 원칙

1. **자산이 있다고 다 쓰지 않는다.** RESERVED 자산은 자연스러운
   소비처가 명확해질 때만 연결한다.
2. **한 화면 캐릭터/Brand Voice 노출은 1~2개로 제한.** 여러
   상태(loading/empty/error)가 겹치는 화면에서도 동시에
   보이는 문구·캐릭터 수를 계속 확인한다.
3. **error는 정보 우선.** 캐릭터는 항상 보조 요소이고, 원인
   문구와 재시도 동선이 주가 된다.
4. **APT DETAIL V1은 계속 LOCK.** 새 mascot 영역 추가, 카드
   구조 변경은 별도의 명시적 V2 결정이 있기 전까지 하지 않는다.
5. **손상되거나 스타일이 불일치하는 자산(mono-white, vertical)은
   실제 필요가 생기기 전까지 재작업하지 않는다.** "완벽하게
   만들기 위해" 선제적으로 다시 만들지 않는다.
6. **`--primary-color`(#03c75a) → `--ejip-green` 전환은 여전히
   미결정 상태.** 전환하려면 전체 화면 색이 바뀌는 영향이 커서,
   별도 시각 검수 STEP으로 분리해 판단한다.

## BRAND CLOSE

STEP 56(검수) ~ STEP 57-A/B/C(적용·확산·마무리)로 이어진 이집
D안 브랜드 1차 rollout을 이 문서로 CLOSE한다. BLOCKER 없음,
기존 기능/DB/APT DETAIL V1 무변경, production 배포·검증 완료.

다음 단계부터는 브랜드 작업을 종료하고 이집 핵심 기능 개발로
복귀할 수 있다.
