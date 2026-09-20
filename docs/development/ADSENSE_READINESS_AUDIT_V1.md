# E-JIP ADSENSE READINESS AUDIT V1

e-jip.com을 AdSense에 신청하기 전 기술·정책·UX 준비 상태를 감사한다.

- 날짜: 2026-09-21 (KST) · 기준 커밋 `bb864e9`
- **DB write 0 · 광고 노출 0 · Auto Ads 0 · 가짜 publisher ID 0 · runtime `src/` 변경 0**

## 판정

**READY_WITH_MINOR_FIXES**

**BLOCKER 없음.** 신청을 막는 항목은 발견되지 않았다. 정리할 것은 P1 3건 · P2 2건이고, 그중 두 건은 publisher ID를 받은 **뒤에야** 가능한 작업이다.

---

## 1. 사이트 접근성

AdSense 크롤러 UA(`Mediapartners-Google`)로 확인 — **로그인·비밀번호 없이 전부 접근 가능**:

| 경로 | HTTP | 크기 | 응답 |
|---|---|---|---|
| `/` | **200** | 28.0 KB | 0.77s |
| `/map` | **200** | 19.0 KB | 0.40s |
| `/stats` | **200** | 36.9 KB | 1.06s |
| `/school` | **200** | 20.4 KB | 0.25s |
| `/report/city/busan` | **200** | 79.1 KB | 5.27s |
| `/report/district/26140` | **200** | 82.3 KB | 0.58s |
| `/robots.txt` | **200** | 137 B | — |
| `/privacy` · `/terms` | **200** | 44.2 KB · 30.7 KB | — |

**5xx 0건.** `robots.txt`는 `Allow: /`에 `/api/` · `/admin` · `/my` · `/community/write`만 차단 — 콘텐츠 페이지는 전부 크롤 허용이고 sitemap도 선언돼 있다.

> `/report/city/busan`이 5.27초로 느리다(콜드 스타트 추정). 승인 차단 요소는 아니지만 P2로 둔다.

## 2. 콘텐츠 준비도

**SSR raw HTML 실측** — JS 없이 서버가 내려주는 본문:

| 경로 | 본문 길이 | 금액/수치 표현 | 평가 |
|---|---|---|---|
| `/report/district/26140` | **1,537자** | **32개** | **충실** — 실거래·시세가 HTML에 그대로 |
| `/stats` | 556자 | 0 | 라벨 위주, 수치는 클라이언트 렌더 |
| `/` | **186자** | 0 | "불러오는 중입니다" — 사실상 클라이언트 렌더 |

sitemap 138 URL 구성: **`/report` 133** · `/community` 2 · 홈 · `/stats` · `/school`.

| 위험 항목 | 결과 |
|---|---|
| 빈 페이지 · placeholder · under construction | **발견 안 됨** |
| dummy / fake data | **없음** — 전 구간 MOLIT 실거래·건축물대장 실데이터 |
| 테스트 문구 | 발견 안 됨 |
| 거의 동일한 반복 페이지 | 리포트 133개는 지역별로 수치·단지·순위가 다르다. 템플릿은 공유하지만 **내용은 지역 고유** |
| thin content | 홈·`/stats`의 **raw HTML**이 얇다(위 표) |

콘텐츠 자체는 실서비스로 판단하기에 충분하다 — 부산 실거래 기반 리포트가 133개이고, 이번 세션에서 세대수·주차·도로명 데이터 정확도를 대규모로 보정한 직후다.

## 3. 신뢰 페이지 — **이미 존재**

| 항목 | 상태 |
|---|---|
| 개인정보처리방침 `/privacy` | **있음** (본문 3,691자) |
| 이용약관 `/terms` | **있음** |
| 문의 방법 | **있음** — 처리방침에 운영자 이메일 명시 + `/feedback` 라우트 |
| 운영자 정보 | **있음** — "사업자등록 없이 운영되는 개인 서비스"로 명시 |
| 쿠키/광고 고지 | **있음** (§4) |

정책 문구를 이번 STEP에서 생성·배포하지 않았다.

## 4. 개인정보 / 광고 고지 — **핵심 항목 이미 충족**

코드에서 확인된 데이터 수집: **GA4**(`GoogleAnalytics.tsx`) · **OAuth**(NextAuth, 자체 비밀번호 저장 없음) · 쿠키/로컬스토리지 · 커뮤니티 UGC · 피드백.

처방침 **§7-다 "광고 서비스"** 항목이 이미 다음을 담고 있다:

- 구글을 비롯한 **제3자 광고 제공업체가 쿠키를 사용**해 다른 사이트 방문 정보 기반으로 광고 게재
- **구글 광고 쿠키**로 파트너가 적절한 광고 제공
- **opt-out 안내** — Google 광고 설정 페이지 링크

AdSense가 요구하는 표준 고지의 핵심이 이미 들어가 있다. 도입 시 확인할 implementation checklist(법률 판단 아님):

| 확인 | 현재 |
|---|---|
| 제3자 광고 쿠키 고지 | ✅ 있음 |
| Google 광고 쿠키 명시 | ✅ 있음 |
| opt-out 경로 안내 | ✅ 있음(adssettings.google.com) |
| "맞춤형 광고" 표현 | △ "맞춤 광고"로 표기 — 의미상 포함 |
| 제3자 제공 현황 표에 Google 광고 추가 | △ 현재 표에는 **Google Analytics만** 기재 |
| EU 사용자 동의(CMP) | 미도입 — 국내 중심 서비스라 우선순위 낮음, 도입 시 판단 필요 |

## 5. ads.txt 상태 — **MISSING**

| 항목 | 값 |
|---|---|
| `https://e-jip.com/ads.txt` | **404 (MISSING)** |
| `public/ads.txt` | 없음 |

**가짜 publisher ID를 만들지 않았다.** publisher ID 발급 전에는 ads.txt를 만들 수 없다(빈 파일이나 더미 ID는 오히려 해롭다).

**발급 후 구현 위치는 확정돼 있다**: `public/ads.txt` 한 파일이면 된다. 같은 방식으로 이미 `public/396495517bdb4193ae13ffd0541124f6.txt`가 루트에서 서빙되고 있어 경로 계약이 검증돼 있다.

```
# public/ads.txt — publisher ID 발급 후 이 한 줄
google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
```

> 현재 404가 Next.js HTML 404 페이지(16.5 KB)로 응답한다. AdSense는 ads.txt 부재를 404로 판단하므로 승인에는 문제없다.

## 6. 사이트 연결 방식 — **A(head snippet) 권장**

| 방식 | 현 구조 적합성 |
|---|---|
| **A. `<head>` 코드 조각** | **권장** — `src/app/layout.tsx`의 `metadata`/루트 레이아웃에 `next/script`로 `strategy="afterInteractive"` 삽입. Next.js App Router 표준 경로 |
| B. meta 태그 | 가능 — `metadata.other`로 주입. A와 병행 가능 |
| C. ads.txt | **승인 후 필수**, 소유권 확인 수단으로는 보조 |
| D. Search Console 소유권 | **이미 확인됨** — AdSense가 이 신호를 활용할 수 있어 유리 |

**publisher/client ID가 없으므로 코드에 placeholder를 넣지 않았다.**

## 7. CSP / 보안 헤더 — **차단 요소 없음**

| 헤더 | 값 |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000` |
| **`Content-Security-Policy`** | **없음** |
| `X-Frame-Options` · `X-Content-Type-Options` · `Referrer-Policy` | 없음 |

`next.config.ts`에 `headers()` 설정이 없고 미들웨어에도 CSP가 없다. 따라서:

- **AdSense 스크립트(`pagead2.googlesyndication.com` · `googleads.g.doubleclick.net`)는 차단되지 않는다.**
- **CSP 완화가 필요 없다** — 완화할 CSP 자체가 없다. wildcard 허용도 불필요.

> 뒤집어 보면 CSP가 없다는 것 자체는 별개의 보안 개선 여지다. 다만 이번 STEP 범위 밖이고, 광고 도입 **전에** CSP를 새로 도입하면 오히려 광고 도메인을 빠뜨려 문제를 만들 수 있다. 도입한다면 광고 적용 이후 광고 도메인을 포함해 설계하는 편이 안전하다.

## 8. 광고 배치 전략 — 수동 배치 우선

**Auto Ads를 처음부터 켜지 말 것을 권한다.** Auto Ads는 DOM을 스스로 판단해 삽입하므로 아래 "최소화 구역"을 침범할 수 있고, 특히 캡처 DOM과 지도 UI에서 통제가 어렵다.

**권장 배치(1차)**

| 위치 | 근거 |
|---|---|
| `/stats` 하단 — 통계 카드 묶음 **아래** | 비핵심 영역, 체류 길고 스크롤 종료 지점 |
| `/report/district/*` · `/report/city/*` 본문 **하단**(캡처 영역 밖) | 콘텐츠가 가장 두껍고 SSR 텍스트가 충실 |
| 홈 콘텐츠 섹션 **사이** 1개 | 과밀하지 않게 1개만 |
| 커뮤니티 목록 피드 사이 | 자연스러운 구획이 이미 존재 |

**광고 최소화/금지 구역**

| 구역 | 이유 |
|---|---|
| 지도 조작 UI(`/map`) | 마커·컨트롤 오조작 유발, 모바일에서 특히 위험 |
| 단지 핵심 가격/거래 정보 바로 위 | 신뢰도 직결 — 가격 위 광고는 오인 유발 |
| **한장리포트 캡처 영역** | §11 — 절대 금지 |
| PDF / Instagram export | §11 — 절대 금지 |
| CTA·상담 버튼 인접 | 오클릭 → 정책 위반 위험 |
| 로그인 / 폼 제출 UI | 오클릭 위험 |

## 9. 모바일 UX 위험 (360 / 375 / 390)

현재 고정·스티키 요소: **`BottomNav`(하단 고정)** · `Header` · `InstallBanner`(PWA) · 각종 모달.

| 위험 | 내용 |
|---|---|
| **하단 고정바 충돌** | 앵커/스티키 광고를 쓰면 `BottomNav`와 겹친다. **앵커 광고 비권장**, 쓴다면 `BottomNav` 높이만큼 오프셋 필요 |
| **CLS** | 광고 슬롯에 **고정 높이를 미리 예약**하지 않으면 로드 시 본문이 밀린다. 리포트처럼 수치가 촘촘한 화면에서 체감이 크다 |
| CTA 가림 | 상담/저장 버튼 근처 배치 금지(§8) |
| 지도 컨트롤 충돌 | `/map`은 배치 제외 |
| InstallBanner 중첩 | PWA 배너와 광고가 동시에 뜨면 화면 상·하단이 모두 점유된다 |

## 10. 성능 영향

| 지표 | 예상 영향 | 완화 |
|---|---|---|
| **LCP** | 광고가 첫 화면 위에 있으면 직접 악화 | **첫 화면 위 배치 금지** |
| **CLS** | 가장 큰 위험 | 슬롯에 **고정 min-height 예약** |
| JS payload | AdSense 스크립트 + 광고별 추가 요청 | `next/script strategy="afterInteractive"` |
| 3rd-party 요청 | 도메인 2~3개 증가 | 지연 로딩, 뷰포트 근접 시 렌더 |

현재 실측 응답 시간(홈 0.77s · 구 리포트 0.58s)에는 여유가 있으나, `/report/city/busan` 5.27초는 광고를 더하기 전에 확인해 두는 편이 낫다(P2).

## 11. 리포트 / 이미지 캡처 격리 — **이미 계약이 존재한다 (가장 중요한 확인)**

캡처 경로는 **단일 계약**으로 통제되고 있고, 새 메커니즘을 만들 필요가 없다:

| 상수 | 의미 |
|---|---|
| `EXPORT_ROOT_ATTR` = `data-export-root` | 캡처 루트 |
| **`EXPORT_EXCLUDE_ATTR` = `data-export-exclude`** | **캡처·인쇄에서 제외** |

3중으로 강제되고 있다:

1. **PNG 캡처** — `src/lib/report/dom-to-png.ts:114` : `if (source.hasAttribute(EXPORT_EXCLUDE_ATTR)) return null;`
2. **인쇄/PDF** — `src/app/globals.css:242` : `@media print { [data-export-exclude] { display: none !important } }`
3. **Instagram 4:5** — `InstagramExportStage.tsx:77`가 같은 속성을 사용, `one-page-report-redesign.test.ts:268`이 회귀 테스트로 고정

**광고 제외 정책(확정)**

> 광고 컴포넌트는 **반드시 `data-export-exclude`를 갖고**, **`data-export-root` 내부에 배치하지 않는다.** 둘 중 하나만 지켜도 캡처에서 빠지지만, 둘 다 지키는 것을 규칙으로 한다.

추가로, 광고 컴포넌트가 생기면 기존 테스트와 같은 방식으로 "광고에 `data-export-exclude`가 있다"를 회귀 테스트에 고정할 것을 권한다.

## 12. 커뮤니티 / UGC 위험

| 안전장치 | 상태 |
|---|---|
| 작성 권한 | 로그인 필수 · `robots.txt`가 `/community/write` 차단 |
| 수정/삭제 | **작성자 본인만**(`authorId` 확인) |
| 계정 차단 | **있음** — `User.banned` + `role`, 차단 계정은 쓰기 403 |
| 이미지 검증 | **강함** — 매직 바이트로 형식 판별(MIME·확장자 불신) · 원본 10 MB · 저장 1.5 MB(413) · 픽셀 폭탄 방지(5천만 px) · 글당 5장 |
| **사용자 신고(report/flag)** | **없음** ← **P1** |

현재 커뮤니티 글은 sitemap 기준 **2건**으로 매우 적어 당장의 노출 위험은 낮다. 다만 광고가 붙은 페이지에 UGC가 있으면 Google은 **부적절 콘텐츠 신고 경로**를 기대한다. 글이 늘기 전에 신고 버튼을 두는 편이 안전하다.

> 이번 STEP에서 moderation 정책을 바꾸지 않았다.

## 13. 색인과의 독립성

**AdSense 승인 ≠ Google 검색 색인 수.** 둘은 별개 심사다.

- sitemap 제출 URL **138개** · robots 정상 · Search Console 소유권 확인됨.
- 색인된 페이지가 적다는 사실이 **AdSense 승인 불가를 의미하지 않는다.** AdSense는 크롤러가 사이트에 접근해 콘텐츠·정책을 확인할 수 있는지를 본다.
- 색인 개선은 별도 SEO 과제로 분리해 관리한다(이번 판정에 반영하지 않음).

## 14. 계정/결제 체크리스트 (코드 밖, 사용자 작업)

1. AdSense 계정 생성 / 로그인
2. **사이트 추가** → `e-jip.com`
3. **결제 프로필** — 개인(사업자등록 없음)으로 생성. 이름·주소·전화번호는 **실제 수취 정보와 일치**해야 하며 이후 변경이 까다롭다
4. 사이트 연결 코드(`<head>` snippet) 수령
5. **publisher ID(`pub-…`) 확인**
6. `public/ads.txt`에 발급받은 한 줄 추가 → 배포
7. 사이트 검토 요청 → 결과 대기

**secret 취급 권고**: publisher ID는 비밀값은 아니지만(최종적으로 ads.txt와 페이지 소스에 공개된다) **결제 정보·계정 비밀번호·인증 코드는 채팅이나 커밋 로그에 남기지 않는다.** publisher ID는 `public/ads.txt`와 레이아웃 코드에 직접 커밋하면 되고, 그 외 경로로 옮길 필요가 없다.

## 15~17. 이슈 분류

### BLOCKER — **없음**

### P1

| # | 항목 | 조치 |
|---|---|---|
| P1-1 | **`ads.txt` 부재** | publisher ID 발급 **후** `public/ads.txt` 1줄 추가. 지금은 만들 수 없다(가짜 ID 금지) |
| P1-2 | **UGC 신고 경로 없음** | 커뮤니티 글/댓글에 신고 버튼 + 접수 경로. 글이 2건일 때 넣는 편이 쉽다 |
| P1-3 | **홈 / `/stats` raw HTML이 얇다** | 크롤러가 JS를 렌더하긴 하지만, 홈·통계의 핵심 수치 일부를 SSR로 내려주면 심사·SEO 모두에 유리 |

### P2

| # | 항목 |
|---|---|
| P2-1 | `/report/city/busan` 응답 5.27초(콜드 스타트 추정) — 광고 추가 전 확인 |
| P2-2 | 처방침 제3자 제공 표에 **Google 광고**를 GA와 나란히 한 줄 추가(본문 §7-다에는 이미 기재) |

### OK (이미 충족)

개인정보처리방침 · 이용약관 · 문의 경로 · 운영자 정보 · **광고/쿠키 고지와 opt-out 링크** · robots/sitemap · HTTPS/HSTS · **CSP 차단 없음** · **캡처 격리 계약** · 이미지 업로드 방어 · 계정 차단 · 실데이터 기반 고유 콘텐츠 133개 리포트

## 18. PATCH_REQUIRED (이번 STEP에서 수정하지 않음)

| 대상 | 내용 | 선행 조건 |
|---|---|---|
| `public/ads.txt` | 신규 파일 1줄 | **publisher ID 필요** |
| `src/app/layout.tsx` | AdSense `<head>` snippet | **client ID 필요** |
| 커뮤니티 신고 기능 | API + UI | 사용자 승인(기능 추가) |
| 광고 컴포넌트 | `data-export-exclude` 필수 + 회귀 테스트 | 광고 도입 시 |
| 홈/`stats` SSR 보강 | 핵심 수치 서버 렌더 | 별도 판단(범위 큼) |

§18 STOP 규칙에 해당하는 항목(publisher ID 필요 · 정책 문구 승인 필요 · 대규모 UI 변경)은 **수정하지 않고 보고만** 했다.

## 19. No-write assertion

| 항목 | 값 |
|---|---|
| 광고 노출 · Auto Ads | **0 · 0** |
| 가짜 publisher/client ID 삽입 | **0** |
| DB write (INSERT/UPDATE/DELETE) | **0 / 0 / 0** |
| runtime `src/` 변경 · UI 변경 · SEO 변경 | **0 · 0 · 0** |
| CSP/보안 완화 | **0** |
| 정책 문구 생성/배포 | **0** |

Production은 **읽기(HTTP GET)만** 했다.

## 20. 다음 권고

1. **지금 바로 신청 가능하다.** BLOCKER가 없고, AdSense 승인에서 흔히 걸리는 항목(처방침·약관·문의처·광고 쿠키 고지·크롤러 접근)이 이미 갖춰져 있다.
2. **순서 권고**: ① AdSense 사이트 추가 + `<head>` snippet 배포 → ② 검토 통과 → ③ publisher ID로 `public/ads.txt` 추가 → ④ **수동 슬롯 1~2개만** 배치(리포트 하단·stats 하단) → ⑤ CLS/모바일 확인 후 점진 확대. **Auto Ads는 마지막에, 켜더라도 캡처 영역 제외를 검증한 뒤.**
3. **신청 전에 넣어두면 좋은 것은 P1-2(신고 버튼)** 하나다. 커뮤니티 글이 2건인 지금이 가장 비용이 낮다.
4. **광고 컴포넌트를 만들 때 첫 줄이 `data-export-exclude`여야 한다.** 리포트 PNG·PDF·인스타 이미지는 이 제품의 신뢰 자산이고, 거기에 광고가 찍히면 되돌리기 어렵다.
