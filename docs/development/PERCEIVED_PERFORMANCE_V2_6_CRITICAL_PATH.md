# E-JIP PERCEIVED PERFORMANCE V2.6 — CRITICAL PATH BYTE REDUCTION

> 선행: `MAP_CONTROLLED_PERFORMANCE_BASELINE_V1`(= `PERCEIVED_PERFORMANCE_V2_5_MAP_JS_HYDRATION.md` 이후 측정 STEP).
> 범위: 임계경로 바이트만. **MAP SHELL 재작성 없음. durable 버스 캐시 없음.**
> DB·schema·migration 변경 없음. V2.1~V2.5 동작 변경 없음.

측정 조건은 BASELINE V1과 **동일**하다:
**Production / Slow 4G(1.6Mbps, RTT 150ms) / CPU 4x / cold cache / 390px / 구별 n=10 valid.**
BASELINE V1에서 발견한 "배치 첫 run은 cold browser 아티팩트"를 그대로 적용해
**run #0을 제외한 정상 상태**로 비교한다(BEFORE/AFTER 양쪽에 동일 적용).

---

## 1. 로더 마스코트 감사

| 항목 | 값 |
|---|---|
| 파일 | `public/brand/mascot/ejipy-loading.webp` |
| 원본 크기 | **800 x 800** |
| 파일 크기 | **82,492 B** |
| 실제 표시 크기 | **96px**(데스크톱) / **76px**(≤900px) — `FullPageLoader.module.css` |
| 요청 시작 | 약 312ms (SSR HTML 안의 `<img>` → preload scanner가 즉시 발견) |
| preload 태그 | 없음(별도 `<link rel=preload>` 아님) |
| 다른 용도 | 없음 — `FullPageLoader`에서만 쓴다(다른 마스코트는 각자 다른 파일) |

**약 8배 과샘플링이다.** 96px 슬롯에 800px 원본을 보낸다.

`FullPageLoader`는 `/map` 외에 ai-search, apt 상세, InlineLoading에서도 쓰이므로
이 자산 하나를 고치면 그 화면들도 같이 좋아진다.

---

## 2. 구현 — 그리는 크기대로 보낸다

같은 그림을 **256 x 256으로 재인코딩**해 `ejipy-loading-256.webp`(13,912 B)로 교체했다.

- 256은 데스크톱 96px@2x(192)와 모바일 76px@3x(228)를 모두 덮는다 → 화질 저하 없음.
- 표시 크기는 CSS(`.mascot`)가 그대로 고정 → **레이아웃 시프트 없음**(실측 CLS ≤ 0.0011).
- 그림·위치·브랜딩 동일 → §0의 "브랜딩 변경" STOP 조건에 해당하지 않는다.
- 원본 800x800 파일은 **지우지 않았다**(브랜드 원본 보관).
- `fetchPriority="low"` / `decoding="async"`도 함께 붙였다(뷰포트 내 이미지 우선순위
  부스트 차단 + 디코딩 오프로드).

자산 생성은 이미 설치돼 있던 `sharp`(Next.js의 의존성) 로 **오프라인 1회** 수행했다.
런타임 의존성도, `package.json` 변경도, 새 외부 유료 API도 없다. `next/image`는
쓰지 않았다 — 이 저장소는 `next/image` 사용처가 0곳이고, 도입하면 Vercel 이미지
최적화라는 런타임/과금 의존성이 새로 생긴다.

---

## 3. 가설이 한 번 뒤집혔다가 다시 확인됐다 (기록)

구현 전에 로컬에서 A/B를 했다: 이미지를 Playwright `route.abort()`로 **완전히 차단**하고
라우트 JS 완료 시각을 비교.

```
blockImg=false  routeJS_end med=2290ms   |  blockImg=true  routeJS_end med=2318ms
blockImg=false  routeJS_end med=2292ms   |  blockImg=true  routeJS_end med=2308ms
```

차이가 없어서 **"이미지는 JS를 늦추지 않는다 = BASELINE V1의 인과 주장은 틀렸다"**고
한때 판단했고, 그 판단을 커밋 메시지(`e9a0ba9`)에도 적었다.

**그 A/B가 틀렸다.** 배포 후 동일 harness로 잰 Production 전후는 정반대다(§4).
원인: `localhost` + `route.abort()` 조합이 요청 스케줄링을 바꿔 실제 대역폭 경쟁을
재현하지 못했다(로컬 오리진은 RTT/커넥션 특성이 CDN과 다르고, 가로챈 요청은
스로틀 예산을 실제와 같게 소비하지 않는다).

**결론: BASELINE V1의 진단이 옳았다.** 다만 그 근거를 로컬 A/B로 반박했다가
Production 실측으로 되돌린 과정을 그대로 남긴다 — 커밋 `e9a0ba9`의 본문에는
반증됐다는 (지금은 틀린) 서술이 남아 있으므로 이 문서가 정정본이다.

---

## 4. 임계경로 바이트 BEFORE → AFTER

첫 마커 이전까지 전송 바이트(390px, Slow 4G, cold cache):

| 항목 | BEFORE | AFTER |
|---|---|---|
| route JS | 173.5 KB | 173.5 KB |
| **images(로더 마스코트)** | **80.9 KB** | **13.9 KB** |
| CSS | 22.2 KB | 22.2 KB |
| app API | 16.0 KB | 16.0 KB |
| fonts | 0.8 KB | 0.8 KB |
| **합계** | **293.3 KB** | **226.4 KB (-66.9KB, -23%)** |

로더 이미지 전송 구간: **312→2,358ms → 312→1,185ms.**

---

## 5. Production 통제 재측정 (구별 n=10 valid, run #0 제외)

| 구 | usable BEFORE | usable AFTER | Δ | p75 | worst |
|---|---|---|---|---|---|
| 중구 | 3,765ms | **3,406ms** | **-359** | 3,499 | 3,726 |
| 부산진구 | 4,255ms | **3,830ms** | **-425** | 3,899 | 4,051 |
| 해운대구 | 3,841ms | **3,447ms** | **-394** | 3,539 | 3,746 |

구간별(중앙값):

| 구간 | 중구 | 부산진구 | 해운대구 |
|---|---|---|---|
| route JS 완료 | 2,377 → **1,982** (-395) | 2,418 → **2,038** (-380) | 2,403 → **2,055** (-348) |
| hydration(proxy) | 2,631 → **2,303** (-328) | 2,708 → **2,318** (-390) | 2,667 → **2,333** (-334) |
| 컨테이너(loaderGone) | 3,152 → **2,792** | 3,188 → **2,795** | 3,144 → **2,826** |

**숫자가 물리적으로 맞는다**: 줄인 68.6KB ÷ 1.6Mbps = **343ms**, 실측 route JS 단축
348~395ms. 즉 이 개선은 정확히 "대역폭에서 68.6KB를 덜어낸 만큼"이다.

배경 부하 지표(LTpreTile)는 BEFORE 324~366 / AFTER 311~341로 비슷해, 부하 차이로
설명되는 값이 아니다.

### 5.1 폭별 (부산진구, run #0 제외)

| 폭 | BEFORE | AFTER | Δ |
|---|---|---|---|
| 360px | 4,302ms | **3,840ms** | -462 |
| 430px | 4,275ms | **3,901ms** | -374 |
| 1280px | 5,418ms | **4,956ms** | -462 |

### 5.2 §7 목표 대비 — 정직한 판정

| 목표 | 결과 |
|---|---|
| 전 구 median ≤ 3s | **미달** (3,406 / 3,830 / 3,447) |
| 최소한 startup latency를 유의하게 줄일 것 | **달성** (-359 ~ -425ms, 전 구·전 폭 일관) |

목표는 재정의하지 않았다. 3초 미달이며, 남은 격차는 중구 406ms / 부산진구 830ms /
해운대구 447ms다.

---

## 6. §3 라우트 JS 우선순위 / §4 폰트·CSS

- 로더 이미지 외에 임계 구간에서 JS와 다투는 자원은 남아 있지 않다.
  공유 SDK는 V2.5에서 idle로 밀려 3,358ms에 시작한다(첫 타일 이후).
- `globals.css` 첫 줄이 `@import url('https://cdn.jsdelivr.net/.../pretendard.css')`다.
  CSS `@import`는 **직렬 체인**(앱 CSS 다운로드 → 파싱 → 그제서야 서드파티 CSS 요청)을
  만들고 렌더를 막는다. 실측 638→945ms에 끝나며 전송량은 0.8KB다.
  **hydration(약 2,300ms)보다 훨씬 먼저 끝나 usable을 게이트하지 않으므로 §4 기준
  ("측정 가능하고 usable 이전에 명확히 영향") 미충족 → 이번 STEP에서 건드리지 않았다.**
  다만 서드파티 렌더 블로킹이라는 구조 자체는 별도 STEP 후보로 기록한다.

---

## 7. QA (Production)

| 항목 | 결과 |
|---|---|
| 로더 자산 200 + `-256` 사용 (360/390/430/1280) | PASS |
| 깨진 이미지 0건 | PASS |
| 마스코트 박스 크기 (76x76 모바일 / 96x96 1280px) | PASS |
| CLS | PASS (0 ~ 0.0011) |
| 가로 오버플로 0px | PASS |
| 마커 렌더 (390:29 / 430:30 / 1280:76) | PASS |
| V2.4 데이터 경로 6/6 (직접·home→map·복원·공유링크·구경계 패닝) | PASS |
| keepIds/컬링 (선택 마커 화면 밖에서도 카드/aptSeq 유지) | PASS — V2.3/V2.4/V1과 동일 |
| SDK 단일 주입 (sdk.js 요청 1회, 태그 1개) | PASS |
| 초기 요청 중복 없음 (tx 1회 / geo 0회) | PASS |

> QA 스크립트 초판이 폭 루프에서 `setViewportSize`를 호출하지 않아 네 폭이 전부
> 390px로 돌았다(1280px에서 마스코트가 76x76으로 나온 것으로 발견). 고쳐서 다시 돌렸고
> 위 표는 **실제로 폭이 적용된** 재실행 결과다.

## 8. 빌드 / 품질

| 항목 | 결과 |
|---|---|
| `npx eslint src/components/FullPageLoader.tsx` | 0 errors |
| `npx tsc --noEmit` | **src 0건.** `scripts/`·`tmp/` 14개는 기존 오류(FAIL_EXISTING_SCRIPT_ERRORS) |
| `npm run build` | 성공 |
| 지도 단위 테스트 | 59 pass / 0 fail |

## 9. 남은 항목

- **P0 없음.**
- **P1 — route JS 173.5KB가 이제 유일한 지배 항목이다.** BASELINE V1에서 확인했듯
  이 중 72.8%가 React/Next 프레임워크이고 `/map` 자체 코드는 13.3KB(br)뿐이라
  앱 코드로는 줄일 수 없다. 3초를 넘기려면 라우트 구조(서버 셸 + 작은 client
  bootstrap)를 건드려야 하는데, BASELINE V1이 CASE C로 판정했고 그 판정은 이번
  측정으로도 뒤집히지 않았다(컨테이너를 앞당겨도 Kakao 모듈이 그보다 늦게 준비됨).
- **P1 — 1280px는 4,956ms로 여전히 가장 느리다.** 이건 startup이 아니라 마커 렌더
  비용이다(폭이 넓어 마커 76개). V2.3 컬링은 이미 적용돼 있고, 추가 개선은
  별도 렌더 STEP 사안이다.
- 서드파티 CSS `@import`(pretendard) 직렬 체인 — 현재 usable을 게이트하지 않음.

## 10. 변경 파일

- `public/brand/mascot/ejipy-loading-256.webp` — 신규(13,912 B)
- `src/components/FullPageLoader.tsx` — 256px 자산 사용 + fetchPriority/decoding
- `docs/development/PERCEIVED_PERFORMANCE_V2_6_CRITICAL_PATH.md` — 이 문서
