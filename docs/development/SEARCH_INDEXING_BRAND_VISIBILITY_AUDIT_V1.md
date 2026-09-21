# E-JIP SEARCH INDEXING + BRAND VISIBILITY ROOT CAUSE AUDIT V1

홈 title/description 변경 이후 `"이집 e-jip"` · `"e-jip"` · `"이집 부동산"` 브랜드 검색 노출이
약해진 것처럼 보이는 원인을 Production·코드·기존 artifact 근거로 감사한다.

- 측정: 2026-09-21 11:40~11:52 KST · 기준 커밋 `c3f7493`
- **READ ONLY** — SEO 수정 0 · metadata 수정 0 · sitemap 수정 0 · 콘솔 제출 0 · Production write 0 · DB write 0 · **MOLIT 호출 0**

## 판정

**MIXED**

두 가지를 반드시 분리해야 한다.

1. **title/description 변경은 브랜드 신호를 약화시키지 않았다 — 오히려 강화했다.** (§3) → 원인 아님.
2. **실제 문제는 홈 SSR 빈약 + H1 부재 + 내부 링크 약함**이라는 구조 문제이며,
   여기에 신규 도메인 재수집 시간이 겹쳐 있다. (§9 · §8)

결정적 근거: **브랜드 검색 약세는 title 변경보다 먼저 관측·기록돼 있었다.**
변경을 수행한 바로 그 문서(`REGIONAL_SEO_KEYWORD_LANDING_V1`, 2026-09-16)가
*"브랜드 검색('이집') 약세와 사이트 이름 표시는 재수집·브랜드 학습 시간이 필요하다"* 고 적었고,
그 커밋은 약세를 **고치려는 조치**(JSON-LD·canonical·application-name 추가)였다.

**title 롤백은 권하지 않는다.** (§25)

---

## 1. 현재 Production 홈 SEO (실측)

`https://e-jip.com/` · Googlebot UA · HTTP **200** · `X-Vercel-Cache: PRERENDER`

| 항목 | 값 |
|---|---|
| **title** | `이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터` |
| **description** | `복잡한 부동산, 이집으로 쉽게. 아파트 실거래가부터 거래량, 학군, 교통, 단지 비교까지 한눈에 확인하세요.` |
| **canonical** | `https://e-jip.com` |
| robots meta | **없음**(= index,follow 기본) |
| `X-Robots-Tag` | **없음**(Googlebot·Googlebot-Mobile·Yeti 전부) |
| og:title / og:description | title·description과 동일 |
| og:url | `https://e-jip.com` · og:site_name **`이집`** |
| html lang | `ko` |
| **H1** | **없음 — 서버 HTML에 heading 태그가 하나도 없다** |
| structured data | **WebSite + Organization 2개**(아래 §4) |

**raw HTML과 hydrated DOM 차이**: `src/app/page.tsx`는 JSON-LD 2개 + `<HomeClient/>`만 렌더하고,
`home-client.tsx`에는 **`fetch(`·`useSWR`·`/api/` 호출이 하나도 없다**(코드 확인).
즉 hydration이 새 텍스트를 만들지 않는다 — **hydrated DOM의 텍스트 ≈ raw HTML 텍스트**이며,
추가되는 것은 localStorage 기반 "최근 본 단지" 목록뿐이다. (이 때문에 브라우저 렌더 없이 판정 가능했고,
MOLIT 호출도 발생하지 않았다.)

## 2. 브랜드 신호 감사

| 문자열 | raw HTML 전체 | **body 가시 텍스트** |
|---|---|---|
| 이집 | 33 | **1** |
| E-JIP | 14 | **0** |
| e-jip | 14 | **0** |
| 부동산 | 15 | **1** |
| 아파트 | 13 | **0** |
| 실거래 | 13 | **1** |
| 학군 | 12 | **0** |

raw 전체의 33/14는 대부분 **`<head>` 메타·JSON-LD·Next 플라이트 페이로드**다.
검색엔진이 head를 읽으므로 브랜드가 없는 것은 아니지만, **본문에서는 사실상 부재**다.

| 위치 | 브랜드 |
|---|---|
| title · og · twitter | **강함** — 이집 + E-JIP 모두 |
| JSON-LD name/alternateName | **강함** |
| 로고 | `<img alt="이집">` — 이미지 + alt 1개 |
| **H1** | **없음** |
| **첫 본문 카피** | `복잡한 부동산, 이집으로 쉽게` — `<p class=tagline>` **1회뿐** |
| footer | 서버 HTML에 브랜드 텍스트 없음 |
| 내부 anchor text | 브랜드 없음(기능명 위주) |

→ **브랜드명이 head와 이미지 alt에는 있으나 본문 텍스트에서는 거의 비어 있다.**

## 3. Title / Description git history — **강화됐다**

변경: **커밋 `9299b36`** · **2026-09-16 01:59:43 KST**
(`feat(seo): regional hubs with template metadata, canonical URLs and a canonical-only sitemap`)

| | BEFORE | AFTER (현재) |
|---|---|---|
| **title** | `이집` | `이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터` |
| **description** | `언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.` | `복잡한 부동산, 이집으로 쉽게. 아파트 실거래가부터 거래량, 학군, 교통, 단지 비교까지 한눈에 확인하세요.` |
| og:site_name | `이집` | `이집`(BRAND_NAME, 동일) |
| **H1** | **없음** | **없음**(변경 없음) |
| structured-data name | **없었음** | **`이집` + alternateName `E-JIP`,`이집(E-JIP)` 신설** |

**평가: 브랜드 신호는 강해졌다.**

- `E-JIP` 토큰이 title에 **새로 생겼다**(변경 전에는 사이트 어디에도 `E-JIP` 텍스트가 없었다).
  `"e-jip"` 쿼리 대응력은 변경 **후**가 더 좋다.
- `이집`은 변경 후에도 title **맨 앞**에 남아 exact-prefix 매칭이 유지된다.
- WebSite/Organization JSON-LD가 이때 신설됐다 — 사이트 이름 학습에 **유리한 방향**이다.

유일하게 약해졌다고 볼 여지: 변경 전 title이 문자 그대로 `이집`이어서 `"이집"` 단독 쿼리에 대한
**완전일치**였다는 점. 다만 현재도 선두가 `이집(E-JIP)`이라 실질 손실로 보기 어렵다.

## 4. 구조화 데이터 — **이미 권장 형태다**

```json
{"@type":"WebSite","name":"이집","alternateName":["E-JIP","이집(E-JIP)"],
 "url":"https://e-jip.com/","inLanguage":"ko-KR"}
{"@type":"Organization","name":"이집","alternateName":["E-JIP","이집(E-JIP)"],
 "url":"https://e-jip.com/","logo":"https://e-jip.com/brand/icon/ejip-app-icon-512.png"}
```

§4가 권장한 `name = 이집` · `alternateName`에 `E-JIP` 포함이 **이미 충족**돼 있다. 수정할 것이 없다.

## 5. Canonical / Redirect — 정상

| 진입 | 결과 |
|---|---|
| `http://e-jip.com` | 200 → `https://e-jip.com/` (redirect 1) |
| `https://e-jip.com` | 200 (redirect 0) |
| `http://www.e-jip.com` | 200 → `https://e-jip.com/` (redirect 2) |
| `https://www.e-jip.com` | 200 → `https://e-jip.com/` (redirect 1) |

www/non-www 혼선 **없음** · 리디렉션 루프 **없음** · 중복 canonical **없음**.

**사소한 불일치 1건**: canonical·og:url은 `https://e-jip.com`(슬래시 없음), sitemap은 `https://e-jip.com/`(슬래시 있음).
구글은 빈 경로를 `/`로 정규화하므로 실무 영향은 낮지만 **일관성은 아니다**(P2).

## 6. Robots / noindex — **차단 없음 (RULED_OUT)**

```
User-Agent: *
Allow: /
Disallow: /api/  /admin  /my  /community/write
Sitemap: https://e-jip.com/sitemap.xml
```

홈 robots meta 없음 · `X-Robots-Tag` 없음(Googlebot / Googlebot-Mobile / **Yeti** 각각 확인).
**홈 색인이 기술적으로 차단된 정황은 전혀 없다.**

## 7. Sitemap — 정상, 139→138 원인 규명됨

| 항목 | 값 |
|---|---|
| URL 수 | **138** |
| 홈 포함 | **예** (`https://e-jip.com/`) |
| query URL | **0** |
| 중복 | **0** |
| redirect/non-indexable URL | **0** |
| lastmod | 전 URL **동일 단일값** `2026-09-14T06:35:06.802Z` (URL별 아님) |

구성: `/report` **133**(허브 1 + 부산시 1 + 구 16 + **동 115**) · `/community` 2 · 홈 · `/stats` · `/school`

**139 → 138 설명**: 139는 **2026-09-16 배포 시점 값**이다
(`REGIONAL_SEO_KEYWORD_LANDING_V1` §: *"제출 139 URL, HTTP 200. 색인됐다는 뜻이 아니다"*).
동 경로는 **데이터 의존**이다 — 커밋 설명대로 *"dongs are indexed only with 10+ trades in the last year"*,
`buildDongReportRoutes()`가 `readBusanDongTradeCounts()` 결과로 매번 생성한다.
최근 1년 창이 굴러가며 **동 1곳이 10건 미만으로 떨어져 빠진 것**이고, **설계된 동작이지 결함이 아니다**.
2026-09-21 AdSense 감사도 이미 138로 기록했다.

## 8. 내부 링크 그래프 — **약하다**

| 페이지 | 서버 HTML `<a>` 수 | 나가는 주요 링크 |
|---|---|---|
| **홈** | **11** | `/map` · `/stats` · `/redevelopment` · `/stats/*` 7개 |
| `/stats` | 23 | `/report/city/busan` · `/school` · `/tools` · `/stats/*` 19개 |
| `/report/district/26140` | 37 | 홈(`/`, anchor **"이집"**) + 하위 동 등 |

전부 진짜 `<a href>`다(JS 전용 내비게이션 아님).

**홈에서 빠진 링크**: `/school` · `/report` · `/report/city/busan` · `/community` **전부 0건**.

| 대상 | 홈에서 | `/stats`에서 |
|---|---|---|
| `/school` | **0** | 1 |
| `/report/city/busan` | **0** | 1 |
| `/report` (허브) | **0** | **0** |
| `/community` | **0** | **0** |

- **sitemap 133개 report URL로 가는 유일한 크롤 경로가 `홈 → /stats → /report/city/busan → 구 → 동`** 이다.
  동 페이지는 홈에서 **4 hop**이고, 그 출발점인 홈이 가장 얇다.
- **`/report` 허브와 `/community`는 홈·`/stats` 어디에서도 링크되지 않는다** —
  sitemap에만 존재하는 사실상 **orphan 2건**.
- 되돌아오는 링크는 정상(구 리포트가 anchor text "이집"으로 홈을 가리킨다 — 좋은 브랜드 신호).

## 9. 홈 SSR — **SEVERELY_THIN**

| 항목 | 값 |
|---|---|
| raw HTML 전체 | 27,450 bytes |
| `<body>` | 23,216 bytes |
| **본문 가시 텍스트** | **150자** |
| heading 태그 | **0개** |
| hydration이 더하는 텍스트 | **사실상 없음**(클라이언트 fetch 0) |

본문 전문(150자):

> 홈 지도 통계 재개발·분양 MY **복잡한 부동산, 이집으로 쉽게** 지도에서 찾기 최근 본 단지
> 최근 본 단지를 불러오는 중입니다... 시장 둘러보기 시장통계 (인기) 2년최고가·거래량·갭투자
> 재개발·분양 청약·재건축 정보 실거래 하락 2년최고가 상승 거래량 단지비교 갭투자

검색봇이 JS 실행 전에 알 수 있는 것:

| 질문 | 답 |
|---|---|
| 이집이 무엇인가 | **거의 불가** — 태그라인 한 줄뿐, 서비스 설명 없음 |
| 어떤 지역을 다루는가 | **불가** — 본문에 "부산"이 **한 번도 없다** |
| 어떤 정보를 제공하는가 | 메뉴 라벨로 **간접 추정만** 가능 |

분류: **SEVERELY_THIN.** 2026-09-21 AdSense 감사의 "186자 / 불러오는 중" 관찰과 동일하며,
현재는 **150자로 더 얇다**.

## 10. `/stats` SSR — 홈보다 **건강하다**

| 항목 | 값 |
|---|---|
| title | `아파트 시장 통계·분석 - 이집` |
| canonical | `https://e-jip.com/stats` |
| **본문 텍스트** | **538자** (직전 감사 556자와 유사, 큰 변화 없음) |
| **headings** | **h1 `시장 통계·분석`** + h2 6개(가격·거래·수요·공급·지역·비교·분석·기타) |

분류: **THIN이지만 구조는 정상**(H1 존재, 섹션 구분 존재). 홈보다 명백히 낫다.

참고로 구 리포트는 **본문 1,516자 · h1 `부산 서구 아파트 시세·실거래가` · 링크 37개 · 본문에 이집 5회·E-JIP 2회**로 가장 건강하다.

> **구조적 역전**: 깊은 페이지일수록 건강하고, **브랜드 쿼리가 도달해야 할 홈이 가장 빈약하다.**

## 11. Google 색인 증거 — 확인 가능/불가능 분리

**확인 가능(이번 실측·프로젝트 artifact):**

| 항목 | 값 | 출처 |
|---|---|---|
| sitemap 제출 URL | **138** | 실측 + AdSense 감사 |
| robots/Ｘ-Robots-Tag 차단 | **없음** | 실측 |
| 홈 HTTP | **200** · PRERENDER | 실측 |
| Search Console 소유권 | **확인됨** | AdSense 감사 §13 |
| IndexNow 제출 이력 | 2026-09-16 **139 URL, HTTP 200** | `REGIONAL_SEO_KEYWORD_LANDING_V1` |

**확인 불가능(이 환경에 Search Console connector 없음):**

- indexed ≈ 8 · not indexed ≈ 34 · discovered-currently-not-indexed ≈ 31 · redirect 3 · sitemap discovered ≈ 139

이 수치는 **사용자가 제공한 값**이며 프로젝트 artifact에 저장돼 있지 않다.
**재현·검증하지 않았고 추정하지도 않았다.** 다만 `discovered-currently-not-indexed ≈ 31`이라는
형태 자체는 §8·§9가 보여주는 프로필(깊고 링크 약한 페이지 + 얇은 홈)과 **일치한다**.

## 12. Naver 색인 증거

**확인 가능**: Yeti UA에 대해 `X-Robots-Tag` 없음 · robots.txt 허용 · 홈 200.
`REGIONAL_SEO_KEYWORD_LANDING_V1` §11/§24가 **Yeti UA·Chrome UA 양쪽에서 `<head>` 안에 메타가 실림**을
QA로 확인했다(Next 16의 메타데이터 body 스트리밍이 Yeti에 문제될 수 있어 별도 확인한 항목).

**확인 불가능**: indexed 1 · crawl restriction 0 · exclusion 0 · SEO issue 0 · sitemap submitted ·
홈 URL 검사 all green — 전부 **사용자 제공 값**, 서치어드바이저 connector 없음.

**판정: 네이버 노출 저하는 기술적 차단 때문이 아니다.** 차단 신호가 하나도 없고, 오히려
사용자 제공값 자체가 "crawl restriction 0 / exclusion 0 / all green"이다.
`indexed 1`은 차단이 아니라 **수집·색인 진행 중**이라는 뜻에 가깝다.
(그 문서도 *"반영 여부는 네이버 재수집 후에만 확인할 수 있다"* 고 못박았다.)

## 13. 원인 분류

| # | 후보 | 판정 | 근거 |
|---|---|---|---|
| **A** | title/description 변경이 브랜드 적합도를 약화 | **UNLIKELY** | §3 — `E-JIP` 토큰이 **새로 생겼고** `이집`은 선두 유지. JSON-LD도 이때 신설. 방향이 반대다 |
| **B** | Google 재처리 지연 | **LIKELY** | 변경이 **5일 전**(2026-09-16). 사이트 전체 title/description/canonical/sitemap이 동시 개편돼 재평가 필요. 신규 도메인 |
| **C** | 홈 SSR 빈약 | **CONFIRMED** | §9 — 본문 **150자**, "부산" 0회, 서비스 설명 없음 |
| **D** | H1/본문 브랜드 신호 약함 | **CONFIRMED** | §1·§2 — **H1 없음**, 본문 `E-JIP` **0회**, `이집` **1회** |
| **E** | canonical/redirect 문제 | **RULED_OUT** (사소한 슬래시 불일치만) | §5 |
| **F** | robots/noindex 문제 | **RULED_OUT** | §6 — Googlebot·Yeti 모두 차단 없음 |
| **G** | 내부 링크 약함 | **CONFIRMED** | §8 — 홈이 `/report`·`/school`·`/community` 미연결, 동 4 hop, orphan 2건 |
| **H** | 전체 색인 커버리지 낮음 | **LIKELY** | 사용자 제공 indexed ≈ 8. 독립 검증 불가하나 §8·§9와 정합 |
| **I** | structured-data 브랜드 불일치 | **RULED_OUT** | §4 — name/alternateName 이미 정확 |
| **J** | 초기 단계 정상 변동 | **LIKELY** | §3 — 브랜드 약세가 **변경 이전부터** 문서화돼 있었다 |

## 14. 혼동 금지 — 현재 증거가 말하는 것

| 현상 | 이번 증거 |
|---|---|
| metadata change | **발생함** (2026-09-16 `9299b36`), 방향은 **강화** |
| ranking change | **직접 관측 못 함** — 순위/노출 데이터가 이 환경에 없다 |
| indexing removal | **증거 없음** — 차단·noindex·canonical 이상 전무 |
| title rewrite(구글이 title을 바꿔 표시) | **확인 불가** — SERP 스크래핑 안 함 |
| crawl delay | **정황상 유력** — 5일 전 전면 개편 + 신규 도메인 |

**"브랜드 검색 노출이 약해 보인다"는 관찰과 "색인에서 제거됐다"는 전혀 다른 사건이며,
후자를 뒷받침하는 증거는 하나도 없다.**

## 15. 수정 계획 (제안만 — 이번 STEP 구현 금지)

### P1 — 홈 서버 렌더 브랜드/콘텐츠

1. **홈에 H1 추가.** 예: `이집(E-JIP) — 아파트 실거래가·시세 데이터`.
   현재 H1이 **전혀 없고**, 브랜드 쿼리 착지점에 제목이 없는 상태다.
2. **홈 본문에 서버 렌더 브랜드 카피 2~3문장.** "이집(E-JIP)은 … 부산 아파트 실거래가·거래량·학군을 …"
   현재 본문에 **"부산"이 0회**여서 봇이 서비스 범위를 알 수 없다.
3. `home-client.tsx`는 fetch가 없으므로 **서버 컴포넌트에 정적 카피를 얹는 것만으로 충분**하다
   (데이터 SSR이 필요 없어 난이도·위험이 낮다).

### P2

4. **홈 → `/report/city/busan` · `/school` · `/community` 직접 링크**(현재 0건).
   `/report` 허브·`/community` orphan 해소.
5. `/stats` 본문 보강(538자) — 구조(H1/H2)는 이미 정상이라 우선순위는 낮다.
6. **canonical 슬래시 일관화** — canonical/og:url `https://e-jip.com` vs sitemap `https://e-jip.com/`.
7. sitemap `lastmod`를 URL별 실제 갱신 시각으로(현재 전 URL 동일 단일값).

**금지 사항 준수**: title 즉시 롤백 **안 함** · description 변경 **안 함** · sitemap 수정 **안 함** · 콘솔 제출 **안 함**.

## 16. 최종 답변

| # | 항목 | 값 |
|---|---|---|
| 25 | **title 롤백 권고?** | **아니오 — 권하지 않는다.** 롤백하면 `E-JIP` 토큰이 사이트 본문·title에서 **완전히 사라진다**(변경 전에는 어디에도 없었다). `"e-jip"` 쿼리 대응력이 오히려 나빠진다. 원인도 title이 아니다 |
| 26 | **즉시 재색인 요청 권고?** | **지금은 아니다 — P1 이후에 하라.** 지금 요청하면 **150자짜리 홈**을 다시 크롤하게 만들 뿐이다. H1·브랜드 카피를 올린 뒤 요청해야 재수집이 의미를 갖는다 |

## 17. No-write assertion

| 항목 | 값 |
|---|---|
| SEO / metadata / sitemap / robots 수정 | **0 / 0 / 0 / 0** |
| Search Console · 네이버 제출 | **0 / 0** |
| Production write · DB write | **0 / 0** |
| **MOLIT 호출** | **0** — 직접 호출 없음. 조회한 페이지(홈·`/stats`·구 리포트)는 PRERENDER 또는 DB 기반 SSR이고, `home-client.tsx`에는 클라이언트 fetch가 0건이다 |
| runtime `src/` 변경 | **0** |
| git worktree | 기존 user work 그대로 |

## 18. 다음 권고

1. **P1 3건(H1 · 홈 브랜드 카피 · 부산 언급)을 한 번에 처리한다.** 서버 컴포넌트 정적 텍스트라
   데이터·식별자·Score에 닿지 않는 **가장 낮은 위험의 변경**이다. 승인 시 별도 STEP.
2. **그다음에** Search Console·서치어드바이저 재수집을 요청한다(순서가 중요하다).
3. **title은 그대로 둔다.** 최소 2~4주 더 관찰해야 변경 효과와 시간 효과를 분리할 수 있다.
   `REGIONAL_SEO_KEYWORD_LANDING_V1` §도 "2~4주 후 색인 수·검색 노출 확인"을 이미 예고했다.
4. **관측 기준선을 저장한다.** 이번 수치(홈 본문 150자 · H1 0 · 링크 11 · sitemap 138)를 기준으로
   P1 이후 재측정하면 코드 효과와 시간 효과가 분리된다. Search Console 수치는
   **사용자가 캡처해 artifact로 남겨야** 다음 감사에서 재사용할 수 있다(현재 connector 없음).
5. sitemap 138은 **정상**이다. 동 임계값(최근 1년 10건) 때문에 앞으로도 ±몇 개씩 움직인다 — 결함으로 보지 말 것.
