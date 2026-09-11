# BUSAN LAUNCH READINESS AUDIT V1

작성일: 2026-09-11
기준 커밋: `358d73d` (branch `main`)
분류: **감사 전용** — 기능 추가 없음, 수정 없음, 프로덕션 쓰기 없음

---

## 0. 종합 판정: **LIMITED**

부산 소프트 런칭 가능. **P0 없음.** P1 3건은 전부 경계가 분명하고, 그중 2건은 출시 전 저비용 조치가 가능하다.

| | 건수 |
|---|---|
| P0 (출시 차단) | **0** |
| P1 (출시 전 권장) | **3** |
| LIMITED (알려진 한계로 출시) | 8 |
| READY | 18 |

---

## 1. P0 블로커

**없음.**

확인한 것: 잘못된 단지 신원 없음, 잘못된 금액 없음, 다른 단지 폴백 없음, 인증/프라이버시 결함 없음, 핵심 기능 사용 불가 없음.

`src/` 전수 검색에서 살아 있는 모의 로직·플레이스홀더 계산·하드코딩 세율·`income * N` 류가 **0건**이다. 검색에 걸린 "가짜/모의" 문자열은 **전부 과거에 제거한 로직을 설명하는 주석**이었다(예: `acquisition-tax.ts`의 "// 계산 로직 (간단한 모의 로직)"은 무엇을 지웠는지 기록한 주석이다).

---

## 2. P1 — 출시 전 조치 권장

### P1-1. MASTER COVERAGE 드리프트 — 자동화 없음 ⚠ 신규 발견

`MASTER_COVERAGE_SYNC_V1`은 **구현돼 있다**(`scripts/master-coverage-sync.ts`, dry-run 기본, INSERT 전용, HIGH_CONFIDENCE만). 문제는 **자동 실행이 없다**는 것이다.

| 시점 | 거래 단지 | 미매칭 | 커버리지 |
|---|---|---|---|
| 마지막 실행 **2026-08-31** | 3,400 | **0** | **100%** |
| **오늘 2026-09-11** | 3,418 | **21** | **99.39%** |

**11일 만에 21곳이 새로 밀렸다 — 하루 약 2곳씩 누적된다.** `vercel.json`의 cron은 `sale-sync` / `rent-sync` / `sale-recheck` 셋뿐이고 master sync는 없다.

사용자 영향(실측, 송암파크빌 `26140-118`):

```
상세 페이지    200 OK — 실거래 2건 정상 표시
좌표          NO_COORDINATE / reason: NO_MASTER  → 지도는 "확인할 수 없습니다"(가짜 지도 없음)
점수 API      status: NOT_FOUND, score: null      → 점수 미표시(지어낸 점수 없음)
리포트        200 OK
```

**틀린 데이터는 나오지 않는다 — 기능이 조용히 빠질 뿐이다.** 그래서 P0가 아니라 P1이다.

> 참고: 전체 기간(2006~) 기준 미매칭은 1,559건이지만, 그중 1,489건은 부산의 오래된 빌라·연립이 과거 한두 번 거래된 기록이다. sync의 판정 기준(부산 + 매매 + 취소 제외 + 24개월)이 제품이 실제로 다루는 범위이며, 위 21건이 그 기준의 수치다.

**필요 조치(출시 전)**: sync를 `--apply`로 1회 실행. **프로덕션 INSERT이므로 이 감사에서 실행하지 않았다 — 승인 필요.**
**필요 조치(출시 직후)**: master sync cron 추가.

### P1-2. 학교 거리 표시 모순 — 사용자가 볼 수 있다

§2가 확인을 지시한 항목이다. **확인됐다.**

리치플러스(`26530-105`) 실측:

```
리포트 화면     괘법초등학교 · 직선 79m
점수 카드       "초등학교까지 도보로 다닐 만한 무난한 거리입니다"   ← 508m(NORMAL band) 기준 문구
                ApartmentScoreCard는 evidence.nearestElementaryDistanceM(=508m)을 그대로 표시한다
```

같은 단지에서 **79m와 508m가 다른 화면에 동시에 존재한다.** 79m는 바로 옆 건물인데 점수 카드는 "무난한 거리"라고 말한다.

영향 범위: **41개 단지**(전체 3,401건의 1.2%).

**표시 전용 완화안 3가지 — 어느 것도 깨끗하지 않다:**

| 안 | 결과 |
|---|---|
| 점수 카드 거리를 NEIS 값으로 교체 | 숫자는 맞아지지만 **설명 문구가 Kakao band에서 나오므로** 79m 옆에 "무난한 거리"가 남는다 |
| 점수 카드에서 원거리 수치 줄 제거 | 모순은 사라지지만 정확한 3,360건에서도 유용한 정보가 사라진다 |
| 그대로 두기 | 41건에서 모순 유지 |

→ **깨끗한 표시 전용 해법이 없다.** 진짜 해법은 이미 기록된 `SCHOOL SCORE MODEL REBASE V1`이다. 소프트 런칭에서는 **리포트를 권위 있는 화면으로 두고 현 상태 수용**을 권고한다(점수 모델 변경 금지 지시 준수).

### P1-3. 도메인 커토버 — OG 메타태그에 Vercel URL 하드코딩

`src/app/layout.tsx`가 세 곳에서 도메인을 박아두고 있다:

```
line 43  openGraph.url    'https://real-estate-app-park11.vercel.app'
line 47  openGraph.images 'https://real-estate-app-park11.vercel.app/brand/og/...jpg'
line 59  twitter.images   'https://real-estate-app-park11.vercel.app/brand/og/...jpg'
```

`siteConfig.url`을 거치지 않는다. `getBaseUrl()` 체인(`NEXT_PUBLIC_SITE_URL` → `VERCEL_ENV=production`이면 `CANONICAL_PRODUCTION_URL` → …)은 올바르게 동작하므로 `metadataBase`·`robots`·`sitemap`·`absoluteUrl()`은 환경변수 하나로 따라온다. **그러나 위 3줄은 따라오지 않는다** — e-jip.com 전환 후에도 카카오톡/SNS 공유 카드가 옛 도메인을 가리킨다.

**필요 조치**: 하드코딩 3줄을 `siteConfig.url` / `absoluteUrl()`로 교체. 소스 3줄 수정이며 이 감사 범위 밖이다.

---

## 3. 부산 16개 구 커버리지 (§3)

**16 / 16 전부 존재. 부산 외 sggCd 유출 0건.**

allowlist(`BUSAN_LAWDCD_16`): 26110, 26140, 26170, 26200, 26230, 26260, 26290, 26320, 26350, 26380, 26410, 26440, 26470, 26500, 26530, 26710

`ApartmentMaster` 분포(총 3,418):

| 구 | 건수 | 구 | 건수 |
|---|---|---|---|
| 26110 | 60 | 26380 | 340 |
| 26140 | 171 | 26410 | 310 |
| 26170 | 99 | 26440 | 44 |
| 26200 | 134 | 26470 | 245 |
| 26230 | 408 | 26500 | 251 |
| 26260 | 315 | 26530 | 152 |
| 26290 | 255 | 26710 | 153 |
| 26320 | 173 | 26350 | 308 |

`ApartmentTradeHistory`에 부산 외 aptSeq가 **70건** 남아 있다(11680 서울 39, 27110 대구 31 — 파일럿 잔존). 모든 부산 화면이 `lawdCd`로 필터하므로 **사용자 화면에 유출되지 않는다.** P2.

---

## 4. 데이터 신뢰 (§31)

- **다른 단지 폴백: 0건.** 검색에 걸린 항목은 전부 폴백을 *막는* 가드와 그 설명 주석이었다(`apt/[name]/route.ts`, `score/route.ts`, `info/route.ts`).
- 좌표 없음 → `NO_COORDINATE` 정직 표시, 가짜 마커 없음
- master 없음 → 점수 `NOT_FOUND`, 지어낸 점수 없음
- 취소 거래 16,275건 보유 · `excludeCanceled`로 제외
- 학교 이름 확인 불가 → "학교 정보 확인 불가"
- 경매·공매 / 임장 노트 → 준비중(가짜 매물 없음)

---

## 5. 성능 (§29) — warm TTFB, 로컬 프로덕션 빌드

| 라우트 | TTFB | 라우트 | TTFB |
|---|---|---|---|
| `/` | 0.004s | `/stats` | 0.024s |
| `/map` | 0.018s | `/stats/decline` | 0.080s |
| `/tools` | 0.008s | `/stats/compare` | 0.010s |
| `/finance-fit` | 0.009s | `/school` | 0.012s |
| `/report` | 0.121s | `/presales` | 0.008s |
| `/report/city/busan` | **0.911s** | `/redevelopment` | 0.007s |
| `/ai-search` | 0.024s | `/officetel/1` | **0.665s** |
| 단지 상세 | 0.034s | `/my` `/privacy` `/terms` `/community` | 0.007s |

**3초 초과 0건.** 가장 느린 `/report/city/busan`(0.91s)도 목표 1~1.5s 안이다. 단, 이는 **로컬 프로덕션 빌드 + 로컬 네트워크** 수치이고 실제 사용자 환경은 아니다.

---

## 6. 전체 출시 매트릭스 (§36)

| 영역 | 상태 | 심각도 | 근거 | 차단? | 필요 조치 | 연기 가능? |
|---|---|---|---|---|---|---|
| HOME | READY | — | 라우트 200, 죽은 CTA 없음 | N | — | — |
| SEARCH | READY | — | canonical aptSeq, 이름-only 폴백 차단 | N | — | — |
| AI SEARCH | **LIMITED** | P2 | 베타. 결정적 DSL 미구현 | N | 라벨 유지 | Y |
| MAP | **LIMITED** | P2 | 이전 판정 유지(성능 LIMITED). 신규 회귀 없음 | N | — | Y |
| APT DETAIL | READY | — | 전체 기본값·전 평형 최신·인라인 지도·밀도·액션바 전부 검증됨 | N | — | — |
| TRANSACTIONS | READY | — | canonical aptSeq, DB-first, 취소 제외, 면적 정규화 | N | — | — |
| SCHOOL | **LIMITED** | **P1** | 41건 표시 모순(§2-2) | N | 리포트를 권위 화면으로 | Y |
| SCORE | **LIMITED** | **P1** | 학교 입력 결함 문서화됨. 공식은 정상 동작, NaN 없음 | N | 모델 리베이스 연기 | Y |
| COMPARE | READY | — | canonical identity, 조작된 승자 없음 | N | — | — |
| STATS | READY | — | "부산광역시 서구 전체", "동 전체" 0건, 공유 한 줄 | N | — | — |
| REPORT | READY | — | A4/PNG/PDF/공유, 파트너 CTA 내보내기 제외 | N | — | — |
| DAILY REPORT | READY | — | "새롭게 확인한 실거래" 의미 유지, 오도하는 0 없음 | N | — | — |
| TOOLS | READY | — | 모의 로직 제거 완료, 재검색 0건 | N | — | — |
| FINANCE | READY | — | 필요현금·월상환·LTV·DSR·취득세(범위한정)·등기(견적) | N | — | — |
| PARTNER | READY | — | 설정 단일 출처, click≠lead, PII 수집 0 | N | — | — |
| AUTH | **LIMITED** | **P1** | Google/Kakao/Naver 동작. **도메인 전환 시 3사 콘솔 등록 필요** | N | 커토버 체크리스트 | Y |
| MY | READY | — | 즐겨찾기·리포트·PWA 진입, 죽은 컨트롤 없음 | N | — | — |
| PWA | READY | — | 이전 PASS 유지, 회귀 없음 | N | — | — |
| GA4 | READY | — | URL 살균·UTM 보존·PII 0. EM 토글은 문서화됨 | N | EM 토글 확인 | Y |
| PRIVACY | READY | — | GA 고지·쿠키·직선거리 표기 반영됨 | N | — | — |
| PRESALES | **LIMITED** | P2 | 기존 데이터만. 경쟁률 수치 없음(지어내지 않음) | N | — | Y |
| REDEVELOPMENT | **LIMITED** | P2 | 공식 출처 연동 미완. 완결성 암시 문구 없음 | N | — | Y |
| OFFICETEL | **LIMITED** | P2 | 이전 판정 유지. 아파트 폴백 없음 | N | — | Y |
| RENT | **LIMITED** | P2 | DB 보유 **2024-08~2026-08**. 그 이전은 외부 호출 의존 | N | 한계 유지 | Y |
| MASTER COVERAGE | **LIMITED** | **P1** | 99.39%, 11일간 21건 드리프트, cron 없음(§2-1) | N | sync 1회 실행(승인) + cron | 부분 |
| PERFORMANCE | READY | — | 최대 0.91s, 3초 초과 0건 | N | 실기기 확인 | — |
| MOBILE | **LIMITED** | P2 | **구조 분석만** — 렌더 QA 미실시 | N | 실기기 확인 | Y |
| SEO | READY | — | robots/sitemap 200, 민감 경로 차단 | N | — | — |
| DOMAIN | **LIMITED** | **P1** | OG 3줄 하드코딩(§2-3) | N | 3줄 수정 + 콘솔 등록 | 부분 |

---

## 7. e-jip.com 커토버 체크리스트 (§33)

**이 감사에서 연결하지 않았다.**

| 항목 | 상태 | 비고 |
|---|---|---|
| Vercel 도메인 추가 | 대기 | — |
| DNS (A/CNAME) | 대기 | — |
| HTTPS 인증서 | 자동 | Vercel |
| www 리다이렉트 정책 | **결정 필요** | apex vs www canonical |
| `NEXT_PUBLIC_SITE_URL` | **필수** | 설정하면 metadataBase·robots·sitemap·absoluteUrl 전부 따라옴 |
| `NEXTAUTH_URL` | **필수** | NextAuth 콜백 |
| **layout.tsx OG 3줄** | **🔴 차단** | 하드코딩 — 환경변수로 안 따라옴(§2-3) |
| Google OAuth 승인 리디렉션 URI | **필수** | 콘솔 등록 |
| Kakao OAuth Redirect URI + 사이트 도메인 | **필수** | 콘솔 등록 |
| Naver OAuth Callback URL | **필수** | 콘솔 등록 |
| **Kakao Map JS 키 허용 도메인** | **🔴 차단** | 미등록 시 지도·로드뷰 전부 실패 |
| GA4 데이터 스트림 URL | 권장 | 기존 스트림 유지 가능 |
| Search Console 소유 확인 + 사이트맵 제출 | 출시 후 | — |
| 네이버 서치어드바이저 | 출시 후 | — |
| Open Graph 이미지 절대경로 | OG 3줄과 동일 | — |
| PWA manifest `start_url`/`scope` | 확인 필요 | 상대경로면 자동 |
| 공유 URL(`shareUtils`) | 자동 | `window.location.origin` 사용 |

**커토버 차단 2건**: layout.tsx OG 하드코딩, Kakao Map 허용 도메인 등록.

---

## 8. 빌드/테스트 건강도 (§32)

| 항목 | 결과 |
|---|---|
| src 전체 테스트 | **708/708 PASS**, fail 0 |
| `npx tsc --noEmit` | src/ 오류 **0건** |
| 기존 `scripts/`·`tmp/` 오류 | 14개 파일(이전과 동일, FAIL_EXISTING_SCRIPT_ERRORS) |
| `npm run build` | **exit 0** |
| ESLint | 변경 없음(이 감사는 소스 무변경) |

---

## 9. 모바일 (§30) — **STRUCTURAL ONLY**

브라우저 확장이 이 세션에서 승인되지 않았고 헤드리스 브라우저는 `package.json`을 건드려야 해서 설치하지 않았다. **렌더 QA를 주장하지 않는다.**

직전 STEP들에서 빌드 산출 CSS로 확인한 것: 상세 밀도 블록(≤768px), 지도 높이 5단계(380/340/300/290/280), 액션바 숨김/노출 전환, 통계 헤더 한 줄 유지, 도구 입력 2열→1열(≤400px).

**출시 전 권장**: 실기기 360/390/430에서 단지 상세(지도 높이·액션바)와 도구 화면 1회 확인.

---

## 10. 연기 항목 보존 (§35)

`00-PROJECT-ROADMAP.md`에 아래를 유지/추가했다. **어느 것도 삭제하지 않았다.**

**[보류 / P1 데이터 신뢰]** — SCHOOL SCORE MODEL REBASE V1(시뮬레이션 완료, 출시 후 진행)

**[출시 직후 / P1]** — RENT Phase C 2014+, AI 결정적 DSL/구조화 검색, 출퇴근 접근성, 예산 기반 추천, 학교 기반 단지 검색, 대체 단지 추천, PARTNER ANALYTICS V2, **MASTER COVERAGE SYNC 자동화(신규)**

**[데이터 감사 후]** — PRESALE COMPETITION V1, 재개발 공식 출처 확장

**[출시 후]** — Broker PRO, 매물, CRM/AI 매칭, PRO 리포트, 뉴스/커뮤니티 확장, 취득세 확장, 등기 채권 할인차손, 임장노트 저장, 경매·공매 연동, 상세 LTV 모달 통일, 갭 prefill

---

## 11. 소프트 런칭에서 수용 가능한 한계

1. 41개 단지에서 점수 카드와 리포트의 학교 거리가 다르다 — 리포트가 정확하다
2. 학교 접근성 점수가 41건에서 실제보다 낮다(최악 사례: 79m 학교를 508m로 계산)
3. 전월세 히스토리 DB가 2024-08 이후만 — 그 이전은 외부 호출 의존
4. AI 검색 베타, 경매·공매·임장노트 준비중, 재개발·분양 제한적
5. 취득세는 1주택·유상거래만
6. LTV/DSR은 참고 계산(승인 금액 아님), 등기비용은 금액 없이 견적 안내
7. 모바일 QA가 렌더링 기반이 아니다
8. master 커버리지가 99.39%이고 자동화 전까지 계속 드리프트한다

---

## 12. 이 감사가 바꾼 것

**프로덕션 동작: 무변경.** `src/` 0건, 스키마 0건, DB 쓰기 0건, 점수 재수집 0건, 임계값 0건.
추가된 것: 이 문서 + 로드맵/CHANGELOG 갱신뿐이다.
