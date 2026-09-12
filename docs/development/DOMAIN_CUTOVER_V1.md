# DOMAIN CUTOVER V1

브랜치: `main` / 기준 커밋: `3fc9db1`
대상 canonical 도메인: `https://e-jip.com`
현재 프로덕션: Vercel (`real-estate-app-park11.vercel.app`)

이 문서는 **기능 개발 STEP이 아니다.** 프로덕션 identity를 임시 Vercel 도메인에서
`e-jip.com`으로 옮기기 위한 사전 감사 + 실행 절차 + 검증 기록이다.

## 0. 결론 요약

| 항목 | 상태 |
|---|---|
| 코드 준비 | **완료** — 코드 변경 필요 없음 |
| 도메인 등록 | 완료 (`e-jip.com` 등록됨) |
| DNS | **미전환** — 현재 Hosting.kr 파킹 페이지를 가리킴 |
| HTTPS | **없음** — 443 포트 응답 없음, TLS 인증서 미발급 |
| Vercel 도메인 연결 | **미완료** |
| 외부 콘솔 작업 | **전부 사용자 작업 필요** |

**코드는 이미 준비돼 있다.** 남은 것은 전부 외부 콘솔(Vercel / Hosting.kr / Google /
Kakao / Naver / GA4)에서 사람이 해야 하는 작업이다.

## 1. 사전 코드 감사 — 호스트 참조 분류

전수 검색: `vercel.app`, `real-estate-app-park11`, `e-jip.com`, `localhost`,
`NEXT_PUBLIC_SITE_URL`, `NEXTAUTH_URL`, `siteConfig`, `getBaseUrl`, `absoluteUrl`,
`canonical`, `openGraph`, `sitemap`, `robots`, `manifest`.

| 참조 | 위치 | 분류 | 조치 |
|---|---|---|---|
| `https://real-estate-app-park11.vercel.app` | `src/config/site.ts:6` (`CANONICAL_PRODUCTION_URL`) | **B. 의도적 폴백** | 유지. `NEXT_PUBLIC_SITE_URL`이 있으면 도달하지 않는다. 롤백 안전판이므로 제거하지 않는다 |
| `real-estate-app-park11.vercel.app` | `src/config/site-metadata.test.ts:18` | C. 테스트 | 유지 |
| `e-jip.com` | 주석 6곳 + 테스트 8곳 | C. 주석/테스트 전용 | 런타임 하드코딩 **0건** |
| `http://localhost:3000` | `src/config/site.ts:13` | B. 로컬 개발 폴백 | 유지 |
| `http://localhost:3000` | Kakao dapi 호출 `Origin`/`KA` 헤더 7곳 | **D-주의** | §8 경고 참조 — **삭제 금지** |
| `allowedDevOrigins` | `next.config.ts` | C. 개발 전용 | 유지 |

**런타임에 호스트를 박아둔 곳은 없다.** 오리진을 결정하는 곳은 `src/config/site.ts`의
`getBaseUrl()` 하나뿐이다:

```
NEXT_PUBLIC_SITE_URL → (VERCEL_ENV==='production') 고정 도메인
                     → NEXT_PUBLIC_VERCEL_URL → VERCEL_URL → localhost:3000
```

### 1.1 주의: `VERCEL_ENV`는 서버 전용

`getBaseUrl()`의 2순위 가지는 `process.env.VERCEL_ENV`를 본다. 이 변수는 `NEXT_PUBLIC_`
접두사가 없어 **클라이언트 번들에 주입되지 않는다.** 즉 `NEXT_PUBLIC_SITE_URL`을 넣지
않으면 브라우저에서 `siteConfig.url`이 `http://localhost:3000`으로 내려앉는다.

→ **`NEXT_PUBLIC_SITE_URL` 설정은 선택이 아니라 필수다.**
(공유 경로는 `resolveShareOrigin()`이 이 상황을 한 번 더 막아주지만, 메타데이터 등
다른 경로까지 보호하지는 않는다.)

## 2. 단일 오리진 권한 검증 — 로컬 실측

`NEXT_PUBLIC_SITE_URL=https://e-jip.com`으로 프로덕션 빌드를 실제로 돌려 확인했다.

```
NEXT_PUBLIC_SITE_URL=https://e-jip.com npm run build   → Compiled successfully
```

| 검사 | 결과 |
|---|---|
| prerender된 `og:url` | `https://e-jip.com` ✓ |
| prerender된 `og:image` | `https://e-jip.com/brand/og/ejip-og-main-1200x630.jpg` ✓ |
| prerender된 `robots.txt` | `Sitemap: https://e-jip.com/sitemap.xml`, `Disallow: /` 없음 ✓ |
| `.next/static` (클라이언트 청크) 내 레거시 호스트 | **0건** ✓ |
| `.next/server` (소스맵 제외) 내 레거시 호스트 | **0건** ✓ |
| `.next/static` 내 `localhost:3000` | 1건 — next-auth 라이브러리 내부 기본값(`parseUrl`), 우리 코드 아님. 런타임에 실제 오리진으로 덮어씌워짐 |

즉 **환경변수 하나로 canonical / OG / Twitter / robots / sitemap / 공유 카드 이미지 /
Kakao CTA URL이 전부 따라온다.** 단위 테스트로도 고정돼 있다
(`src/config/site-metadata.test.ts`, 52 tests PASS).

## 3. 현재 DNS 실측 (2026-09-12)

```
nslookup e-jip.com 8.8.8.8
  e-jip.com        A     99.83.196.71, 75.2.85.42
  www.e-jip.com    CNAME e-jip.com
  NS               ns1.hosting.co.kr ~ ns4.hosting.co.kr

curl http://e-jip.com/    → 200, Hosting.kr 도메인 파킹 페이지 HTML
curl https://e-jip.com/   → TCP 443 연결 타임아웃 (인증서 없음)
curl https://real-estate-app-park11.vercel.app/ → 200, Server: Vercel
```

**해석**

- 도메인은 등록돼 있고 DNS는 Hosting.kr 네임서버가 관리한다.
- 현재 A 레코드는 **Hosting.kr 파킹 서버**를 가리킨다 — Vercel이 아니다.
- 443 포트에 아무것도 응답하지 않는다 → TLS 인증서가 발급된 적 없다.
- **Vercel 프로젝트에 도메인이 연결되지 않은 상태다.**

## 4. 실행 절차 (전부 사용자 콘솔 작업)

### STEP A — Vercel에 도메인 추가

```
Vercel → 프로젝트 → Settings → Domains → Add Domain
  e-jip.com
  www.e-jip.com
```

www 정책 권장: **`e-jip.com`을 canonical**로 두고 `www.e-jip.com`은 308 영구
리다이렉트. Vercel의 Domains 화면에서 `www`에 "Redirect to e-jip.com"을 선택하면
코드 변경 없이 처리된다.

도메인을 추가하면 Vercel이 **필요한 DNS 레코드의 정확한 값을 화면에 표시한다.**
그 값이 유일한 정답이다 — 아래 형태는 참고일 뿐이고, 실제 값은 반드시 대시보드에서
복사해야 한다.

| 이름 | 타입 | 값 |
|---|---|---|
| `@` (apex) | A | Vercel 대시보드가 표시하는 IP |
| `www` | CNAME | Vercel 대시보드가 표시하는 호스트 (`cname.vercel-dns.com` 계열) |

참고 실측: `cname.vercel-dns.com` → `76.76.21.22`, `66.33.60.129` (존재 확인됨).
apex A 레코드 값은 프로젝트/리전마다 다를 수 있으므로 **추측하지 않는다.**

### STEP B — Hosting.kr DNS 레코드 교체

```
Hosting.kr → 도메인 관리 → e-jip.com → DNS 관리
```

1. 기존 apex A 레코드 `99.83.196.71`, `75.2.85.42` **삭제** (파킹 서버)
2. Vercel이 표시한 apex A 레코드 **추가**
3. `www` CNAME을 현재 `e-jip.com` → Vercel이 표시한 CNAME 호스트로 **교체**
4. 전파 대기 (TTL에 따라 수 분 ~ 수 시간)

네임서버를 Vercel DNS로 옮기는 방법도 있으나, 메일 등 다른 레코드까지 이관해야 하므로
**레코드만 교체하는 위 방식을 권장한다** (위험이 낮고 롤백이 쉽다).

### STEP C — Vercel 환경변수

```
Vercel → Settings → Environment Variables → Production
```

| 변수 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://e-jip.com` | **필수** (§1.1) |
| `NEXTAUTH_URL` | `https://e-jip.com` | **필수** — NextAuth v4는 프로덕션에서 이 값으로 콜백 URL을 만든다 |

- Preview / Development 환경에는 프로덕션 오리진을 **넣지 않는다.** Preview는 기존
  동작(배포별 호스트)을 유지하고, 로컬은 `localhost:3000` 폴백을 그대로 쓴다.
- 새 변수를 발명하지 않는다. 이 프로젝트는 NextAuth v4(`next-auth@^4.24.15`)를 쓰므로
  `AUTH_URL`(Auth.js v5 명명)이 아니라 `NEXTAUTH_URL`이다.

### STEP D — 재배포 (필수)

환경변수 변경만으로는 반영되지 않는다. prerender된 메타데이터가 빌드 타임에 오리진을
굽기 때문이다(§2에서 실측 확인). **Production 재배포를 반드시 트리거한다.**

## 5. OAuth 콜백 URL (코드에서 도출)

라우트: `src/app/api/auth/[...nextauth]/route.ts` (NextAuth v4)
프로바이더 id: `google`, `kakao`, `naver` (`src/lib/auth.ts` — Naver는 커스텀
프로바이더이며 `id: 'naver'`)

| 제공자 | 콘솔 | 등록할 Redirect URI |
|---|---|---|
| Google | Google Cloud Console → 사용자 인증 정보 → OAuth 2.0 클라이언트 | `https://e-jip.com/api/auth/callback/google` |
| Kakao | Kakao Developers → 내 애플리케이션 → 카카오 로그인 → Redirect URI | `https://e-jip.com/api/auth/callback/kakao` |
| Naver | 네이버 개발자센터 → 애플리케이션 → API 설정 | `https://e-jip.com/api/auth/callback/naver` |

Google은 추가로 **Authorized JavaScript origins**에 `https://e-jip.com`이 필요할 수 있다.
Naver는 **서비스 URL**에 `https://e-jip.com`을 등록한다.

**기존 Vercel 콜백 URL은 당분간 지우지 않는다** — 롤백 경로를 살려두기 위함이다.
커토버 검증이 끝난 뒤 별도로 정리한다.

## 6. Kakao 플랫폼 도메인 — 릴리스 크리티컬

Kakao는 **두 가지를 구분**해야 한다.

1. **카카오 로그인 Redirect URI** — §5 표
2. **Web 플랫폼 도메인** — 지도 / 로드뷰 / 공유 SDK가 전부 여기에 걸린다

```
Kakao Developers → 내 애플리케이션 → 앱 설정 → 플랫폼 → Web → 사이트 도메인
```

등록해야 할 목록:

```
https://e-jip.com              ← 신규, 필수
https://real-estate-app-park11.vercel.app   ← 롤백용으로 유지
http://localhost:3000          ← 삭제 금지 (아래 경고)
```

### 경고 — `http://localhost:3000`을 지우면 서버 기능이 깨진다

이 프로젝트는 서버에서 Kakao Local REST API(`dapi.kakao.com`)를 호출할 때
`NEXT_PUBLIC_KAKAO_MAP_API_KEY`(JavaScript 키)를 쓰면서 다음 헤더를 함께 보낸다:

```
Authorization: KakaoAK <JS key>
KA: sdk/1.0 os/javascript origin/http%3A%2F%2Flocalhost%3A3000
Origin: http://localhost:3000
```

해당 호출부(실측 7곳):

- `src/app/api/apt/[name]/education/route.ts`
- `src/app/api/school/apartments/route.ts`
- `src/app/api/school/stats/route.ts`
- `src/lib/ai-search.ts`
- `src/lib/apartment-score/collectors/kakao.ts`
- `src/lib/geocode-apt.ts`
- `src/lib/redevelopment/sigunguResolver.ts`

즉 **서버 호출이 `http://localhost:3000` 오리진을 가장해서 나간다.** 플랫폼 도메인
목록에서 `http://localhost:3000`을 지우면 주변 학교 조회 / 지오코딩 / 점수 수집 /
AI 검색 / 재개발 시군구 해석이 조용히 실패할 수 있다.

이 STEP에서는 해당 코드를 **바꾸지 않는다**(동작 중인 기능이고 커토버 범위 밖).
정리하려면 별도 STEP에서 REST API 키로 분리하는 편이 맞다 — 권고 사항으로 남긴다.

지도 키와 공유 SDK 키는 **같은 키**(`getKakaoAppKey()`가
`NEXT_PUBLIC_KAKAO_MAP_API_KEY` → `NEXT_PUBLIC_KAKAO_MAP_KEY` 순으로 읽음)이므로,
위 도메인 등록 한 번으로 지도·로드뷰·공유가 함께 해결된다.

## 7. GA4

- Measurement ID는 **`G-RHCB04C6XC` 그대로 유지**. 새 속성을 만들지 않는다.
- 코드에는 ID가 박혀 있지 않다 — `NEXT_PUBLIC_GA_MEASUREMENT_ID` 환경변수에서 읽는다
  (`src/lib/analytics/ga.ts`). 따라서 **코드 변경 없음.**
- GA4 콘솔 → 관리 → 데이터 스트림 → 웹 스트림 → 스트림 URL을 `https://e-jip.com`으로
  수정.
- 기존 URL 정제(sanitizer)와 파라미터 allowlist는 건드리지 않는다. PII 정책 변화 없음.

## 8. 커토버 후 검증 체크리스트

### 8.1 DNS / HTTPS

- [ ] `https://e-jip.com` → 200, 유효한 TLS 인증서, 경고 없음
- [ ] `http://e-jip.com` → `https://e-jip.com` 리다이렉트
- [ ] `https://www.e-jip.com` → `https://e-jip.com` (308)
- [ ] 리다이렉트 루프 없음

### 8.2 메타데이터

- [ ] 홈 `og:url` = `https://e-jip.com`
- [ ] 단지 상세 canonical = `https://e-jip.com/apt/...`
- [ ] OG 이미지가 절대 https URL이고 실제로 열린다
- [ ] `https://e-jip.com/robots.txt` → `Sitemap: https://e-jip.com/sitemap.xml`,
      `Disallow: /` 없음
- [ ] `https://e-jip.com/sitemap.xml` → 모든 URL이 e-jip.com, localhost/vercel 없음
- [ ] `https://e-jip.com/manifest.webmanifest` → `start_url: "/"`, `scope: "/"`, 아이콘 로드

### 8.3 인증 실기기 QA

각각 로그인 → 콜백 → 인증 상태 → 로그아웃 → 재로그인:

- [ ] Google
- [ ] Kakao
- [ ] Naver

### 8.4 지도 — 릴리스 크리티컬

- [ ] `/map` 지도 렌더
- [ ] 단지 상세 인라인 지도
- [ ] 로드뷰
- [ ] 오피스텔 지도

### 8.5 카카오 공유 실기기 (안드로이드 카카오톡)

- [ ] 단지 상세 → 브랜드 카드 + "이집에서 자세히 보기" + e-jip.com 목적지
- [ ] 비교 → "이집에서 비교 보기", URL이 `/stats/compare?a=<aptSeq>&b=<aptSeq>` 유지
- [ ] 통계 → "이집에서 통계 보기"
- [ ] 리포트 → "이집에서 리포트 보기", 이미지/PDF 저장 정상

### 8.6 대표 경로

`/`, `/map`, 단지 상세 1개, `/stats`, `/stats/compare?a=…&b=…`, 리포트 1개, `/my`,
`/finance-fit`, 오피스텔 1개 — 200 / 혼합 콘텐츠 없음 / localhost·Vercel canonical 없음.

### 8.7 성능 sanity

주요 경로 warm 응답 > 2초면 구조적 우려, 핵심 경로 > 3초면 런치 블로커로 기록.
기존에 종결된 지도 성능 작업은 도메인 고유 증거가 없는 한 다시 열지 않는다.

## 9. 레거시 Vercel 도메인 정책

`real-estate-app-park11.vercel.app`은 **접근 가능한 상태로 둔다**(롤백 경로).
커스텀 리다이렉트를 구현하지 않는다 — 리다이렉트 루프 위험만 늘고 얻는 게 없다.
canonical 메타데이터는 전부 `e-jip.com`을 가리키므로 검색엔진 관점의 중복은
canonical 태그로 해소된다.

## 10. 롤백 계획

문제 발생 시 순서대로:

1. Vercel Production 환경변수 `NEXT_PUBLIC_SITE_URL`, `NEXTAUTH_URL`을 제거하거나
   `https://real-estate-app-park11.vercel.app`로 되돌린다
2. Production 재배포
3. Vercel 도메인 목록에서 `e-jip.com`은 남겨둬도 된다(트래픽은 이미 옛 호스트로 복귀)
4. 필요하면 OAuth 제공자 콘솔의 기존 Vercel 콜백 URI가 살아 있는지 확인

코드 롤백은 필요 없다 — 이 STEP은 **코드를 바꾸지 않는다.**

## 11. 검색엔진 등록 — 다음 STEP

도메인이 완전히 건강해진 뒤에 별도 STEP으로 진행한다. 지금 등록하지 않는다.

- Google Search Console (도메인 속성 또는 URL 접두어, 소유권 확인)
- 네이버 서치어드바이저
- Bing Webmaster Tools
- IndexNow
- Yandex Webmaster

## 12. 남은 수동 작업 (전부 사용자)

1. Vercel에 `e-jip.com` / `www.e-jip.com` 추가 → 표시되는 DNS 값 확보
2. Hosting.kr에서 파킹 A 레코드 교체 + www CNAME 교체
3. Vercel Production 환경변수 2개 설정
4. Production 재배포
5. Google / Kakao / Naver OAuth 콜백 URI 추가
6. Kakao Web 플랫폼 도메인에 `https://e-jip.com` 추가 (**localhost:3000 삭제 금지**)
7. GA4 웹 스트림 URL 수정
8. §8 체크리스트 실기기 QA

## 13. 코드 변경

**없음.** 선행 STEP(`MASTER_COVERAGE_SYNC_APPLY_DOMAIN_OG_FIX_V1`,
`COMPARE_SHARE_URL_COMPACT_FIX_V1`, `SHARE_CARD_UNIFICATION_V1`)에서 이미 단일 오리진
구조가 완성돼 있고, 이번 감사에서 런타임 하드코딩이 0건임을 빌드 산출물로 실증했다.
