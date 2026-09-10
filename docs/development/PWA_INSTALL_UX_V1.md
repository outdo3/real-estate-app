# PWA INSTALL UX V1

> **DB write 없음 / schema 변경 없음 / migration 없음 / 신규 의존성 없음.**

## 1. 시작 상태 (§1)

감사 결과 이 프로젝트는 **PWA가 아니었다.**

| 항목 | 상태 |
|---|---|
| manifest | **없음** |
| service worker | **없음** |
| next-pwa / workbox / serwist | **없음** |
| theme-color | **없음** |
| appleWebApp 메타 | **없음** |
| 앱 아이콘 | **있음** — 96/180/192/512 + favicon 16/32/48 |
| HTTPS | 있음(Vercel) |

즉 아이콘만 이미 준비돼 있었고 설치 가능 요건은 충족하지 못한 상태였다.
"이미 설치 가능하다"고 가정하지 않고 실제로 확인한 결과다(§1).

## 2. 설치 가능성 — 실측으로 증명 (§2)

주장하지 않고 Chrome에게 직접 물었다. `Page.getInstallabilityErrors`:

```
일반(신규) 컨텍스트   → [{ "errorId": "in-incognito" }]
영속 프로필 컨텍스트  → []            ← 오류 0건
beforeinstallprompt  → fired: true
```

`in-incognito`는 Playwright의 임시 컨텍스트 때문이지 앱의 결함이 아니다.
실제 프로필에서는 **설치 가능 오류가 하나도 없고 `beforeinstallprompt`가 실제로
발생**했다. 안드로이드 네이티브 설치 경로가 동작한다는 뜻이다.

`Page.getAppManifest` 파싱 오류도 0건이며 name/short_name/display/icons가 모두
의도대로 읽힌다.

## 3. Manifest (§3)

`src/app/manifest.ts` (Next App Router 네이티브 라우트 → `/manifest.webmanifest`,
`application/manifest+json`). 의존성 추가 없음.

```
name        이집 E-JIP
short_name  이집
start_url   /
scope       /
display     standalone
theme_color #10b981
background  #ffffff
icons       96 / 192 / 512 (purpose: any)
```

`maskable` 아이콘은 **선언하지 않았다.** maskable은 안전 영역 여백이 있는 별도
자산이 필요한데 현재 자산에는 없어서, 선언하면 안드로이드에서 아이콘이 잘린다.
설치 요건은 `any` 아이콘만으로 충족된다(실측 확인).

## 4. 아이콘 (§4)

기존 브랜드 자산을 **그대로** 재사용했다. 새로 만들거나 시각적으로 다른 앱 정체성을
만들지 않았다.

## 5. 서비스 워커

`public/sw.js` — **의도적으로 아무것도 캐시하지 않는다.**

브라우저는 설치 가능 판정에 fetch 핸들러를 가진 워커를 요구한다. 하지만 캐싱을
시작하면 실거래 데이터와 리포트가 낡은 채로 굳을 수 있고, 이 제품의 원칙은
"낡은 데이터를 보여주지 않는다"이다. 그래서 fetch는 네트워크로 그대로 통과시키고
핸들러의 **존재**만으로 요건을 만족시킨다. 오프라인 지원은 이 STEP의 범위가 아니며,
필요해지면 캐시 전략을 따로 설계해야 한다.

등록은 `RegisterServiceWorker`가 idle에 수행하고(첫 렌더와 경쟁하지 않게),
개발 모드에서는 등록하지 않는다(HMR과 섞이면 디버깅이 어렵다).
`skipWaiting`/`clients.claim`으로 낡은 워커가 남지 않게 한다.

## 6. 설치 상태 판정 — 단일 출처 (§5)

`src/lib/pwa/install-state.ts`. UA 로직을 컴포넌트마다 흩지 않는다. 전부 순수 함수라
테스트 가능하고 서버 렌더 중 `window`를 만지지 않는다.

```
INSTALLED    → display-mode: standalone 또는 navigator.standalone
PROMPTABLE   → beforeinstallprompt를 잡아둔 상태
KAKAO_INAPP  → UA에 KAKAOTALK
OTHER_INAPP  → Line/Instagram/FB/NAVER 등
IOS_SAFARI   → iOS이면서 인앱도 CriOS/FxiOS도 아닌 Safari
UNSUPPORTED  → 그 외
```

**판정 순서가 중요하다.** 인앱 브라우저를 iOS보다 **먼저** 본다 — 카카오 인앱은
iOS에서도 공유 시트로 홈 화면 추가를 할 수 없기 때문이다. 순서가 반대면 카카오
사용자에게 "Safari 공유 버튼을 누르세요"라는 불가능한 안내를 하게 된다.
이 함정은 테스트로 고정해 뒀다.

## 7. 플랫폼별 동작 (§6/§7/§8)

| 환경 | 버튼 | 동작 |
|---|---|---|
| Android(프롬프트 확보) | `설치하기` | 네이티브 설치 프롬프트. accepted/dismissed/unavailable 모두 처리 |
| iOS Safari | `설치 방법 보기` | 공유 → 홈 화면에 추가 → 추가 (3단계 시트) |
| 카카오/기타 인앱 | `설치 방법 보기` | "Safari 또는 Chrome에서 열어주세요" + 외부 브라우저 여는 법 |
| 데스크톱/미지원 | — | 배너 자체를 만들지 않는다 |

**카카오 인앱에서 원탭 설치를 주장하지 않는다**(§8). 취약한 딥링크도 쓰지 않는다.
프롬프트가 이미 소비된 뒤 `설치하기`를 누르면 조용히 실패하지 않고 안내 시트로
내려간다(거짓 성공 금지).

## 8. 배너 정책 (§9/§10)

- **모바일 전용**, 이미 설치된 상태에서는 렌더하지 않는다.
- 화면 하단에 얇게 붙고 **내용을 가리지 않는다** — 카카오로 받은 리포트를 여는 것이
  주 시나리오이기 때문이다(§13).
- 닫으면 `localStorage`에 시각을 기록하고 **14일** 동안 다시 띄우지 않는다.
  키: `ejip:pwa-install-dismissed-at`. 영구 억제는 하지 않는다.
- 네이티브 프롬프트를 사용자가 거절한 것도 거절로 보고 같은 쿨다운을 건다
  (§6 "반복해서 조르지 않는다").
- 저장값이 깨졌거나 접근이 막혀도(사생활 보호 모드) 기능이 영구히 사라지지 않도록
  **보여주는 쪽**으로 폴백한다.

## 9. 하단 바 충돌 — 실측 기반 (§15/§16/§17)

이 STEP에서 가장 실질적인 위험이었고, 실제로 결함을 하나 잡았다.

E-JIP의 하단 고정 요소는 라우트마다 다르다:

| 화면 | 하단 고정 요소 |
|---|---|
| 대부분의 화면 | `Header`의 `.menuList`가 모바일에서 **fixed 하단 탭바**(60px, z-index 1000)가 된다 |
| `/map`, `/report` | 추가로 `BottomNav`(60px + safe-area, z-index 1000) |
| 리포트 시트 화면 | 리포트 액션바(fixed bottom, z-index 50) — 탭바는 없다 |

그래서 배너는 오프셋을 **하드코딩하지 않고 런타임에 잰다.** 세 컨테이너 모두
`data-bottom-bar` 속성을 갖고, 배너는 화면 하단에 실제로 붙어 있는 것 중 가장 높은
것을 피해 8px 위에 앉는다.

**초기 QA는 이 충돌을 놓쳤다.** `Header`의 `.menuList`에 표시를 안 해서 측정에
잡히지 않았고, 그 결과 홈/단지 상세에서 배너가 진짜 탭바를 덮고 있었는데도 테스트는
"겹치지 않음"으로 통과했다. 표시를 추가하자 같은 화면에서 `barTop=784 /
bannerBottom=776`으로 8px 여유가 확인됐다.

배너 `z-index`는 900으로 탭바(1000)보다 **낮다** — 측정이 실패하더라도 탭바를 덮지
않는다. 안내 시트만 1200으로 위에 뜬다(모달이므로 의도된 동작).

## 10. 설치된 상태 (§11)

`display-mode: standalone`(Android/데스크톱)과 `navigator.standalone`(iOS) 둘 다 본다.
어느 쪽이든 참이면 배너를 만들지 않고 MY 진입점은 "홈 화면에 설치됨"으로 바뀐다.

> 참고: Chrome DevTools Protocol의 `Emulation.setEmulatedMedia`는 이 Chrome에서
> `display-mode`에 적용되지 않는다(에뮬레이션 후에도
> `matchMedia('(display-mode: browser)')`가 true). 그래서 QA는 실제 브라우저가 주는
> 두 신호를 각각 주입해서 검증한다.

## 11. MY 진입점 (§12)

`InstallEntry` — **쿨다운을 보지 않는다.** 배너를 닫은 사용자도 나중에 여기서 다시
설치할 수 있어야 한다는 것이 §12의 요구다. 이미 설치돼 있으면 "홈 화면에 설치됨"만
표시하고, 네이티브 프롬프트도 안내도 불가능한 환경(주로 데스크톱)에서는 아예
렌더하지 않는다 — 없는 기능을 권하지 않는다.

## 12. 공유 링크 사용자 여정 (§13/§14)

카카오 → 리포트 URL → 내용 확인 → 배너 → 설치/안내 → **같은 화면 유지**.

설치 동작이 사용자를 현재 라우트에서 이동시키지 않는다. `start_url`은 `/`로 고정이라
앱을 나중에 아이콘으로 열면 항상 홈에서 시작한다 — 페이지별 동적 manifest는 canonical
route를 흐리고 설치 상태를 예측 불가능하게 만들어 쓰지 않았다(§14).

## 13. 접근성 (§18)

- 배너/시트 모두 semantic `<button>`, 아이콘은 `aria-hidden`
- 닫기 버튼에 `aria-label="설치 안내 닫기"`, 터치 타겟 40×40
- 시트는 `role="dialog"` + `aria-modal` + `aria-label`, **ESC로 닫힘**(실측 확인)
- 보이지 않는 클릭 오버레이 없음(오버레이는 시트가 열렸을 때만 존재)

## 14. 분석 (§20)

기존 allowlist(`ANALYTICS_EVENT_NAMES`) 메커니즘을 그대로 쓴다. 새 third-party
analytics를 추가하지 않았고 payload도 없다(이벤트 이름만).

`pwa_install_banner_view` / `pwa_install_click` / `pwa_install_accept` /
`pwa_install_dismiss` / `pwa_install_guide_open`

## 15. 성능 / 번들 (§19)

- **신규 의존성 0.**
- 새 소스 합계 약 **25.9KB**(주석 포함 원본). 설치 UX 코드가 들어간 클라이언트 청크는
  29KB이며 여기에는 기존 provider 코드가 함께 있다.
- 배너는 조건 불충족 시 `return null`이라 렌더 비용이 사실상 없다.
- 서비스 워커 등록은 idle에 수행되어 첫 화면 렌더를 막지 않는다.
- 차단 스크립트 없음.

## 16. QA 결과

### 16.1 동작 매트릭스 (390px)

| 케이스 | 결과 |
|---|---|
| A. Android 프롬프트 가능 | 배너 노출, `설치하기`, 액션바와 8px 여유 |
| B. iOS Safari | `설치 방법 보기` → 공유 시트 3단계 안내, ESC 닫힘 |
| C. 카카오 인앱 | 외부 브라우저 유도, 원탭 설치 주장 없음 |
| D. 이미 설치됨 | `navigator.standalone` / `display-mode` 둘 다에서 미노출 |
| E. 닫음 | 즉시 사라짐 · 새로고침 후에도 안 뜸 · localStorage 기록 |
| F. 단지 상세 landing | 배너 노출, 겹침 없음, **50평 회귀 유지**(6억 6,500만 / 2026.09.05) |
| H. 데스크톱 767/1280 | 모바일 배너 미노출, 레이아웃 영향 없음 |

### 16.2 폭 × 화면 충돌 (§21)

360 / 390 / 430 × 7개 화면 = **21칸 전부 PASS**. 겹침 0, 가로 오버플로 0.
모든 화면에서 하단 바 위 8px 여유가 일정하게 유지된다.

## 17. 알려진 한계

- **`/map`에서는 배너 충돌을 직접 검증하지 못했다.** 이 환경의 Kakao SDK 키가
  포트 3000에만 허용돼 있어(사용자의 기존 서버가 그 포트를 쓰고 있다) 지도 페이지가
  끝까지 렌더되지 않았고, DOM에 `<nav>`가 하나도 없었다. `/map`이 쓰는 `BottomNav`는
  `/report` 허브에서 정상 감지됨을 확인했으므로(bars=2) 같은 컴포넌트가 지도에서도
  동일하게 감지될 것으로 보지만, **실측은 아니다.**
- **실기기 검증은 없다.** 안드로이드 설치는 Chrome이 `beforeinstallprompt`를 실제로
  발생시키는 것까지 확인했지만, 실제 폰에서 아이콘이 추가되는 화면까지는 보지 못했다.
  iOS/카카오 경로는 UA 기반 분기 검증이다.
- **오프라인 동작 없음.** 서비스 워커가 의도적으로 캐시하지 않는다(§5).
- **maskable 아이콘 없음.** 안드로이드 일부 런처에서 아이콘이 원형 마스크에 딱 맞게
  들어가지 않을 수 있다. 여백이 있는 자산이 준비되면 추가할 수 있다.
