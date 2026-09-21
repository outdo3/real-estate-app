# E-JIP HOMEPAGE SEO BRAND SIGNAL P1 V1

`SEARCH_INDEXING_BRAND_VISIBILITY_AUDIT_V1`이 확정한 홈 P1 3건을 최소 변경으로 수정한다.

- 구현·배포: 2026-09-21 11:55~12:06 KST · 커밋 **`724073b`** (기준 `38fda26`)
- 변경 파일 **2개**: `src/app/home-client.tsx` · `src/app/home-client.module.css`
- **DB write 0 · MOLIT 호출 0 · title/description/canonical/JSON-LD/robots/sitemap 변경 0 · 서울 SEO 변경 0**

## 판정

**PASS** — §8 목표 전부 달성, §9 회귀 없음, §10 lint·typecheck·build 통과, §11 Production 확인 완료.

---

## 1. 무엇을 고쳤나

감사에서 확정된 원인 3가지에 각각 대응했다.

| # | 원인 | 조치 |
|---|---|---|
| 1 | 홈 SSR 본문 약 150자 | H1 + 리드 문장 + 서비스 소개 단락 추가 → **363자** |
| 2 | **H1 없음** | 기존 태그라인을 **그 자리에서** `<h1>`으로 승격 → **H1 1개** |
| 3 | 본문에 부산·E-JIP 거의 없음 | 리드·소개 문단에 자연 문장으로 포함 → **E-JIP 3 · 부산 3** |

추가로 §5의 내부 링크 3건(`/report/city/busan` · `/school` · `/community`)을 실제 `<a>`로 연결했다.

### 변경 내용

**`home-client.tsx`** — hero:

```tsx
<h1 className={styles.tagline}>복잡한 부동산, 이집(E-JIP)으로 쉽게</h1>
<p className={styles.heroLead}>부산 아파트 실거래가·거래량·학군을 한곳에서 확인하세요.</p>
```

기존 `<p className={styles.tagline}>복잡한 부동산, 이집으로 쉽게</p>`를 **같은 클래스 그대로** `<h1>`으로 바꿨다.
`.tagline`이 `margin`까지 정의하고 있어 **보이는 모양이 바뀌지 않는다.** 브랜드 표기는 title과 같은 `이집(E-JIP)` 형식으로 맞췄다.

**`home-client.tsx`** — `quickSection` 맨 아래(하단 내비 여백을 그대로 쓰도록 섹션 **안**에 배치):

```tsx
<h2 className={styles.aboutHeading}>이집(E-JIP)은 어떤 서비스인가요</h2>
<p className={styles.aboutBody}>
  이집(E-JIP)은 부산 아파트의 실거래가와 거래량, 학군과 단지 정보를 한곳에서 비교할 수 있는
  부동산 데이터 서비스입니다. 정보를 길게 나열하는 대신, 어디에 살지 정할 때 실제로 필요한 것만
  골라 보여드립니다.
</p>
<nav aria-label="주요 페이지">
  <Link href="/report/city/busan">부산 아파트 한장 브리핑</Link>
  <Link href="/school">학군·학교 정보</Link>
  <Link href="/community">부동산 커뮤니티</Link>
</nav>
```

키워드 나열이 아니라 **사용자가 읽는 문장**으로 썼다.

**`home-client.module.css`** — `.heroLead` · `.aboutBlock` · `.aboutHeading` · `.aboutBody` · `.aboutLinks` · `.aboutLink` 추가.
`.tagline`의 `margin-bottom`만 `1.25rem → 0.4rem`으로 줄이고 그 `1.25rem`을 `.heroLead`가 이어받아, **검색창까지의 총 여백은 텍스트 한 줄분만 늘어난다.**
`.aboutLink`는 기존 `.recentToggle`과 같은 pill 톤이고 **최소 높이 44px**(터치 타깃).

### 하지 않은 것

새 `fetch` · MOLIT · DB query · client state **0건**. `home-client.tsx`는 여전히 **데이터 요청이 하나도 없다** —
그래서 이번 추가분은 전부 **정적 서버 렌더**이고 hydration을 기다리지 않는다.

## 2~8. Before / After (Production 실측, Googlebot UA)

| 지표 | BEFORE | AFTER | 목표 |
|---|---|---|---|
| **raw 본문 텍스트** | **150자** | **363자** | 증가 |
| **H1 개수** | **0** | **1** | **1** |
| H2 개수 | 0 | 1 | — |
| **이집** (본문) | 1 | **3** | 증가 |
| **E-JIP** (본문) | **0** | **3** | 존재 |
| **부산** (본문) | **0** | **3** | 식별 가능 |
| **실거래가** (본문) | **0** | **2** | 존재 |
| **학군** (본문) | **0** | **3** | 존재 |
| 거래량 (본문) | 2 | 4 | — |
| **내부 링크** | **11** | **14** | 증가 |
| → `/report/city/busan` | **없음** | **있음** | 필수 |
| → `/school` | **없음** | **있음** | 필수 |
| → `/community` | **없음** | **있음** | 필수 |

**H1 텍스트**: `복잡한 부동산, 이집(E-JIP)으로 쉽게`

### §4 SSR 요건 — 충족

빌드 산출물(`.next/server/app/index.html`)과 Production raw HTML **양쪽에서** 확인했다.
hydration 이후가 아니라 **prerender된 HTML 자체**에 H1·리드·소개·링크가 모두 들어 있다.

`이집` · `E-JIP` · `부산` · `실거래가` · `학군` **전부 raw HTML 본문에 존재**한다.

## 9. SSR 검증 방법

| 단계 | 방법 | 결과 |
|---|---|---|
| 빌드 | `.next/server/app/index.html` 직접 파싱 | 본문 363자 · H1 1 · 링크 14 |
| Production | `curl` + Googlebot UA, JS 실행 없음 | 동일 |
| 라우트 모드 | 빌드 출력 | `/`는 여전히 **`○ (Static)` prerender** |

## 10. UI / 모바일 QA

로컬 production 빌드(`next start`)를 브라우저로 확인했다.

**데스크톱(뷰포트 958px)**: hero·검색창·CTA 배치 그대로, 소개 블록은 구분선 아래에 조용히 붙는다. 가로 오버플로 **0**.

**좁은 폭**: Chrome 확장 사이드바 때문에 **창을 390px까지 줄일 수 없었다**(뷰포트가 958px에서 더 내려가지 않음 — 기존 QA에서도 기록된 제약).
그래서 `<main>` 폭을 390/375/360px로 직접 제약해 **실제 레이아웃 값을 측정**했다:

| 폭 | H1 | 리드 | 소개 블록 | 링크 nav | hero 높이 |
|---|---|---|---|---|---|
| **390px** | 342px · **overflow 0** · 1줄(28px) | 342px · **overflow 0** · 1줄(22px) | **overflow 0** (252px) | **overflow 0** | 319px |
| **375px** | 327px · **overflow 0** · 1줄 | 327px · **overflow 0** · 1줄 | **overflow 0** | **overflow 0** | 319px |
| **360px** | 312px · **overflow 0** · 1줄 | 312px · **overflow 0** · **2줄**(44px) | **overflow 0** | **overflow 0** | 341px |

- **가로 오버플로 0** (전 폭)
- 링크 3개는 **2줄로 자연 줄바꿈**(153 / 106 / 113px), 각 **높이 44px**
- 리드 문장은 360px에서만 2줄이 되며 `word-break: keep-all`로 단어가 깨지지 않는다
- **hero 증가폭은 텍스트 한 줄(약 28px)** — CTA가 크게 밀리지 않는다
- 새 요소는 전부 정적 텍스트라 **CLS 유발 요소가 없다**(지연 로드·크기 미지정 이미지 없음)

> 정직하게 적어 둔다: **390px 실제 창에서의 육안 확인은 못 했다.** 위 수치는 같은 브라우저·같은 CSS로
> 컨테이너 폭을 제약해 측정한 값이다. 실기기 확인은 사용자 몫으로 남는다.

## 11~13. 변경하지 않은 것 (검증)

| 항목 | 결과 |
|---|---|
| **title** | **동일** — `이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터` |
| **description** | **동일** |
| **canonical** | **동일** — `https://e-jip.com` |
| **JSON-LD** | **동일** — 블록 수 변화 0 (WebSite/Organization 그대로) |
| robots · sitemap · query URL 정책 | **변경 0** |
| `/stats` SEO · 서울 SEO/stats/sitemap enable | **변경 0** |

staged 파일은 `home-client.tsx` · `home-client.module.css` **2개뿐**이고,
`layout.tsx` · `page.tsx` · `sitemap.ts` · `site-seo.ts` · `config/site` 는 **하나도 건드리지 않았다.**

## 14~16. Lint / Typecheck / Build

| 검사 | 결과 |
|---|---|
| `npx eslint src/app/home-client.tsx` | **통과(exit 0, 지적 0건)** |
| `npx tsc --noEmit` | **`src/` 오류 0** · 전체 25건은 전부 **기존 무관 스크립트 오류**(`scripts/education/*`, `scripts/list-zips.ts`, `tmp/*` 등) = `FAIL_EXISTING_SCRIPT_ERRORS` |
| `npm run build` | **`✓ Compiled successfully`** · `/`는 여전히 `○ (Static)` |

`npm run lint`의 전체 65,461건은 이번 변경 이전부터 있던 저장소 전역 수치이며, **변경 파일 자체는 지적 0건**이다.

## 17. Production HTTP 회귀

| 경로 | 상태 | 응답 |
|---|---|---|
| `/` | **200** | 0.12s |
| `/stats` | **200** | 0.48s |
| `/school` | **200** | 0.20s |
| `/report/city/busan` | **200** | 1.89s |
| `/community` | **200** | 0.30s |
| `/map` | **200** | 0.35s |
| `/report/district/26140` | **200** | 0.37s |

## 18. No-write assertion

| 항목 | 값 |
|---|---|
| DB INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| 이 STEP 중 생성·갱신된 행 | **0 · 0** |
| 전체 866,366 / 중구 943 / 부산 865,291 / known28 restored 28 | **전부 불변** |
| **MOLIT 호출** | **0** |
| 서울 데이터 · sitemap · Search Console 제출 · 네이버 제출 | **0 · 0 · 0 · 0** |

## 19~20. Commit / Deploy

- 커밋 **`724073b`** — `home-client.tsx` · `home-client.module.css` **2개만** stage(기존 user work 제외)
- push 완료 · `main...origin/main` 동기
- Vercel 배포 완료(push 후 약 40초), Production raw HTML에서 확인

## 21. 다음 권고

1. **지금은 재색인을 요청하지 않는다**(§15 STOP 준수). PM 검수 후 다음 STEP에서 진행한다.
   이제는 요청할 가치가 생겼다 — 크롤러가 다시 와도 **150자가 아니라 363자와 H1**을 읽는다.
2. **재색인 요청 순서**: Search Console URL 검사 → 색인 요청(홈) → 서치어드바이저 수집 요청.
   sitemap은 **재제출 불필요**(변경 0).
3. **P2는 별도 STEP**: `/stats` 본문 보강 · canonical 슬래시 일관화(`https://e-jip.com` vs sitemap `https://e-jip.com/`) ·
   sitemap `lastmod`를 URL별 실제 시각으로.
4. **2~4주 관찰 기준선**을 이 문서 §2~8 표로 고정한다. 다음 측정에서 브랜드 검색 노출이 움직이면
   **코드 효과**(이번 변경)와 **시간 효과**(재수집)를 분리해 볼 수 있다.
5. **title은 계속 그대로 둔다.** 이번에도 손대지 않았다.
