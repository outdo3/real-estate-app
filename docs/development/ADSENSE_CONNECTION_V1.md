# E-JIP ADSENSE CONNECTION V1

AdSense 사이트 소유권 확인을 위해 공식 snippet과 `ads.txt`만 추가한다.

- 날짜: 2026-09-21 (KST) · 커밋 `db7de64` · 배포 `real-estate-gp71v8y04`
- **광고 슬롯 0 · Auto Ads 활성화 0 · UI 변경 0 · DB write 0 · 서울 데이터 변경 0**

## 판정

**PASS** — 스크립트와 `ads.txt` 모두 Production에서 확인됐고, 광고는 한 개도 노출되지 않는다.

---

## 1. 스크립트 삽입 위치

`src/app/layout.tsx` 루트 레이아웃의 `<head>`:

```tsx
<Script
  id="adsense-loader"
  strategy="afterInteractive"
  src={ADSENSE_SCRIPT_SRC}
  crossOrigin="anonymous"
/>
```

`next/script` + `afterInteractive`는 이 저장소의 GA4가 이미 쓰는 기준이다(초기 렌더/LCP 경로를 막지 않는다). 기존 `metadata`·`verification` 계약과 preconnect 태그는 건드리지 않았다.

## 2. Publisher ID — 두 형식을 한 곳에서 파생

`src/lib/adsense.ts` 신규:

| 상수 | 값 |
|---|---|
| `ADSENSE_CLIENT_ID` | `ca-pub-3291272948162277` |
| `ADSENSE_PUBLISHER_ID` | `pub-3291272948162277` (`ca-` 제거) |
| `ADSENSE_SCRIPT_SRC` | `…/adsbygoogle.js?client=ca-pub-3291272948162277` |
| `ADSENSE_ADS_TXT_LINE` | `google.com, pub-3291272948162277, DIRECT, f08c47fec0942fa0` |

**이 파일이 존재하는 이유**: 스크립트는 `ca-pub-`, ads.txt는 `pub-`을 쓴다. 세 글자 차이로 ads.txt가 통째로 무효가 되는데, 두 곳에 손으로 적으면 어긋나도 눈에 띄지 않는다. 하나에서 파생시키고 테스트로 고정했다.

publisher ID는 비밀값이 아니다 — 최종적으로 페이지 소스와 `/ads.txt`에 공개되는 값이라 환경변수로 감추지 않았다. 감추면 오히려 두 곳이 어긋났을 때 알아채기 어렵다.

## 3. ads.txt 생성

`public/ads.txt` (1줄, 개행 포함 59바이트):

```
google.com, pub-3291272948162277, DIRECT, f08c47fec0942fa0
```

## 4. ads.txt Production 상태

| 항목 | 결과 |
|---|---|
| `https://e-jip.com/ads.txt` | **HTTP 200** |
| Content-Type | **text/plain; charset=utf-8** |
| 크기 | 59 bytes |
| 내용 | **요구된 문자열과 완전 일치** |

## 5. AdSense 스크립트 Production 상태 — 런타임까지 실측

**raw HTML**에는 preload 힌트로 나타난다:

```html
<link rel="preload" href="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3291272948162277" as="script" crossorigin=""/>
```

`afterInteractive`라 실행 `<script>`는 hydration 후 주입된다. **그래서 가정하지 않고 브라우저에서 직접 확인했다**:

| 확인 | 결과 |
|---|---|
| 실제 `<script>` DOM 존재 | **있음** — `src=…adsbygoogle.js?client=ca-pub-3291272948162277` |
| `async` · `crossOrigin` | `true` · `anonymous` |
| `window.adsbygoogle` | **정의됨** |
| Google 후속 로드 | `show_ads_impl_fy2021.js` 자동 로드 — **로더가 실제로 동작했다는 증거** |

즉 raw HTML만 보면 preload 링크뿐이지만, 런타임에는 공식 스크립트가 정상 실행된다. AdSense 확인 크롤러는 페이지를 렌더하므로 이 형태로 확인이 가능하다.

## 6~8. 품질 게이트

| 항목 | 결과 |
|---|---|
| `npx eslint` (변경 3파일) | **exit 0** |
| `npx tsc --noEmit` | **`src/` 오류 0** (기존 `scripts/`·`tmp/` 25건은 이번 변경과 무관, 건수 불변) |
| `npm run build` | **✓ Compiled successfully** · static pages 43/43 |
| `npx tsx --test "src/**"` | **2,375 pass / 0 fail** (신규 8개 포함) |

신규 테스트 `src/lib/adsense.test.mjs`가 고정하는 것:
두 ID 형식 · 파생 일치 · **디스크의 `public/ads.txt`와 상수 대조** · 레이아웃이 ID를 하드코딩하지 않음 · **광고 슬롯/Auto Ads 코드 부재**.

## 9. 주요 페이지 회귀

| 경로 | HTTP |
|---|---|
| `/` · `/map` · `/stats` · `/school` | **200** |
| `/report/city/busan` · `/report/district/26140` | **200** |
| `/privacy` · `/terms` | **200** |

## 10. DB write 단언

| 항목 | 값 |
|---|---|
| INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| Production DB 접근 | **없음** — 이번 STEP은 DB를 열지 않았다 |
| 외부 통신 | Production HTTP GET + 브라우저 읽기 전용 탐색뿐 |

## 11. 서울 작업 무관

서울 pilot·취소 관련 코드·데이터를 **한 줄도 건드리지 않았다**. 로컬 보류 커밋(`7c3dbc4` · `bb864e9`)도 그대로 두었다.

## 12. Auto Ads 상태 — **광고 노출 0 (실측)**

로더를 넣으면 페이지에 AdSense 요소가 생기므로, 그것이 **광고인지 초기화 스캐폴딩인지** 직접 측정했다.

홈과 구 리포트 양쪽에서:

| 항목 | 홈 | 구 리포트 |
|---|---|---|
| AdSense 관련 요소 | 3 | 3 |
| **시각적으로 렌더된 광고** | **0** | **0** |
| 크기 | `INS:0x0` · `IFRAME:0x0` · `IFRAME:0x0` | 동일 |
| `ins.adsbygoogle` 위치 / 상태 | `<body>` 직계 / `status=done` | 동일 |

두 번째 iframe은 `googleads.g.doubleclick.net/…/zrt_lookup_fy2021.html`로, AdSense 로더의 **표준 초기화/조회 프레임**이다. `ins`는 0×0이고 `google_ads` 프레임도 `data-page-level-ads` 마커도 없다.

**결론: 실제로 렌더되는 광고는 0개다.** 슬롯 컴포넌트를 만들지 않았고 Auto Ads 코드도 넣지 않았다.

> 다만 **Auto Ads는 AdSense 계정 쪽 설정**이라 코드에서 읽을 수 없다. 지금 관측되는 사실은 "광고가 렌더되지 않는다"이며, 계정에서 Auto Ads가 켜지면 코드 변경 없이도 광고가 나타날 수 있다. 승인 후 슬롯을 직접 배치하기 전까지는 계정에서 Auto Ads를 꺼 두기를 권한다.

## 13. 캡처 안전 (기존 계약 무손상)

구 리포트 페이지 실측:

| 항목 | 값 |
|---|---|
| `data-export-root` | 1 |
| `data-export-exclude` | 1 |
| **캡처 루트 안의 광고 요소** | **없음** (`adInsideExportRoot: false`) |

광고 컴포넌트를 아직 만들지 않았으므로 제외 대상도 없다. 리포트 PNG·PDF·Instagram 계약은 건드리지 않았다.

## 14. 커밋 / 배포

| 항목 | 값 |
|---|---|
| 커밋 | `db7de64` (`public/ads.txt` · `src/lib/adsense.ts` · `src/lib/adsense.test.mjs` · `src/app/layout.tsx`) |
| push | `ffc3178..db7de64` |
| 배포 | **`real-estate-gp71v8y04` · Ready · 29s** |

## 15. 다음 작업

**AdSense 화면에서 "코드를 삽입했습니다"에 체크하고 "확인"을 눌러도 된다.** 스크립트는 런타임에 정상 실행되고 `ads.txt`는 200으로 열린다.

확인 요청 후:

1. 검토 결과 대기(보통 수일).
2. 승인되면 **수동 슬롯 1~2개만** 먼저 배치 — 리포트 본문 하단, `/stats` 하단(`ADSENSE_READINESS_AUDIT_V1` §8).
3. 광고 컴포넌트에는 **`data-export-exclude`를 반드시 붙이고 `data-export-root` 밖에 둔다.** 회귀 테스트도 같이 고정한다.
4. 슬롯에 **고정 높이를 예약**해 CLS를 막는다. `BottomNav`와 겹치는 앵커 광고는 피한다.
5. 승인 전 넣어두면 좋은 것은 커뮤니티 **신고 버튼**(readiness audit P1-2) 하나다.
