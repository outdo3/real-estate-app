# E-JIP BUSAN RELEASE CANDIDATE FREEZE + PRELAUNCH AUDIT V1

**판정: CONDITIONAL GO — P0 0건 / P1 code blocker 0건 / 남은 조건은 실기기 QA 1건 + 운영 결정 2건**

작성일 2026-09-13 · branch `main` · Release Candidate `e867a40`
감사 범위: 코드 정적 감사 + read-only production HTTP + 전체 테스트/빌드
DB·schema·migration 0건 · Production write 0건 · auth/provider/env 변경 0건 · 신규 기능 0건

---

## 1. Baseline

```
branch            main
HEAD              e867a40  fix(stats): connect the region report entry that the default region hid
tracked dirty     package.json, package-lock.json            (사용자 작업물 — 미변경)
untracked         .claude/settings.local.json, ApartmentAutocomplete.tsx.bak,
                  my_prod.html, prisma/schema_old.prisma, tmp/,
                  scripts/audit-apt-trade-*.ts, scripts/officetel/step3a-*.ts,
                  docs/development/{APARTMENT_TRADE_SYNC_COVERAGE_AUDIT_V1,
                  OFFICETEL_V1_STEP3A_BACKFILL_DRYRUN,
                  PERCEIVED_PERFORMANCE_AUDIT_V1}.md         (사용자 작업물 — 미변경)
```

`git stash` / `git clean` / `git reset` / `git checkout .` 미사용.
사용자 unrelated modified/untracked 파일은 읽지도 쓰지도 않았다.

**Production이 HEAD를 반영하는지 확인**: `e867a40`이 처음 추가한 `/stats`의
`report/city/busan` 링크가 production HTML에 존재한다 → production ≥ `e867a40`.

---

## 2. Release Candidate

```
BUSAN RELEASE CANDIDATE = e867a40229de4cddd9bb2ad40514aa6ccb4a026f
```

(감사 중 적용한 test-only fix 1건은 §16에 별도 commit으로 기록. git tag는 생성하지 않았다.)

---

## 3. Recent release fix inventory

13개 항목 전부 실제 commit + 코드 + 테스트로 확인. **NOT FOUND 0건.**

| 항목 | commit | 코드 근거 | 판정 |
|---|---|---|---|
| USER NICKNAME EDIT V1 | `a7b7d72` | `src/lib/nickname.ts`, `auth.ts` jwt `trigger === 'update'`가 DB를 재조회 | **READY** |
| COMMUNITY LAUNCH READINESS V1 | `9ba868a` | `src/lib/community/community-launch.test.ts` | **READY** |
| COMMUNITY ANONYMOUS BROWSING UX FIX V1 | `ffea6f3` | `src/lib/community/anonymous-browsing.test.ts`, production 익명 200 | **READY** |
| RECENT VIEWED AUTH PARITY FIX V1 | `bed6a3a` | `recent-auth-parity.test.ts`, SWR key가 `userId`로 스코프 | **READY** |
| STATS LOADING STATE UX FIX V1 | `7702286` | `src/lib/stats/view-state.test.ts` — loading/empty/error 분리 | **READY** |
| SCORE CANONICAL APTSEQ RESOLUTION FIX V1 | `0d14a69` | `apartment-score/resolve-score-identity.test.ts` | **READY** |
| COMPARE SHARE URL COMPACT FIX V1 | `edfdf7e` | `compare-v2/url.ts` `buildCompareSharePath`가 `?a=&b=` 뿐 | **READY** |
| CONDITIONAL HOME FIND UI HIDE V1 | `25bf6d1` | `feature-flags.ts` 단일 지점, 소비자 1곳 | **READY** |
| BUSAN 12M STATS PERFORMANCE FIX V1 | `a8ef871` | `stats/feed-db-source.ts`, production 실측 §5 | **READY** |
| SUPPLY MAP REGION BOUNDS FIX V1 | `9413ddf` | `stats/supply-map-bounds.ts` + test | **READY** |
| REGION CHANGE MAP BOUNDS FIX V1 | `ae23e6e` | `stats/region-change-map-viewport.test.ts` | **READY** |
| DAILY REPORT TOP COMPLEX ROW UI TUNE V1 | `1d1c7a5` | report 스타일 변경 · 렌더는 DEVICE QA | **READY (구조)** |
| STATS REPORT ENTRY AUDIT + FIX V1 | `e867a40` | `report/stats-report-entry.ts` + production HTML 확인 | **READY** |

---

## 4. P0 / P1 launch gate

### P0 = 0건

| P0 기준 | 결과 | 근거 |
|---|---|---|
| build failure | 없음 | `npm run build` exit 0, warning 0 |
| crash | 없음 | 40개 production route 확인, 5xx 0건 |
| wrong apartment fallback | 없음 | trades가 요청한 `aptSeq=26230-2567`만 반환 |
| auth/session leakage | 없음 | 익명 `/api/auth/session` → `{}` |
| 타 사용자 데이터 노출 | 없음 | `/api/my/*` 401, `/api/admin/*` 401, `/admin/*` 307 |
| broken core navigation | 없음 | BottomNav 5개 + STATS_MENU 19개 + report 8개 전부 200 |
| destructive write | 없음 | `/api/cron/*` 3개 전부 401 fail-closed |
| major incorrect data | 없음 | §7 |

### P1 code blocker = 0건

| P1 기준 | 결과 | 근거 |
|---|---|---|
| >10s 반복 core request | **해소됨** | 12m 부산 전체 cold 4.73s / warm 0.65s (직전 22~25초 P1) |
| false empty/error | 없음 | community·transactions 모두 loading/error/true-empty 분리 |
| broken share | 없음 | `/stats/compare?a=&b=` 200 복원 |
| map wrong region | 없음 | supply / region-change bounds fix + 테스트 |
| login/logout stale state | 없음 | recent parity 계약 테스트 통과 |
| mobile-blocking layout | **미검증** | DEVICE QA REQUIRED (§15) |
| broken report route | 없음 | report 8개 route 전부 200 |

---

## 5. Production HTTP spot check (read-only)

모든 호출은 GET. Production write 0건.

### 페이지

| route | code | time |
|---|---|---|
| `/` | 200 | 0.13s |
| `/stats` | 200 | 0.84s |
| `/community` | 200 | 0.36s |
| `/map` | 200 | 0.39s |
| `/tools` | 200 | 0.37s |
| `/my` | 200 | 0.33s |
| `/report/city/busan` | 200 | 0.79s |
| `/finance-fit` `/presales` `/school` `/redevelopment` `/terms` `/privacy` `/community/write` `/ai-search` | 200 | ≤0.43s |
| `/apt/전포유림노르웨이숲?lawdCd&dong&aptSeq` | 200 | 0.41s |
| `/stats/compare?a=26230-2567&b=26230-1682` | 200 | 0.37s |
| `/stats/<19개 메뉴 slug>` | 200 ×19 | ≤0.25s |
| `/report/{,city/busan,district/26230,dong/26230/전포동,apt/26230-2567,compare,daily/2026-09-12,daily/2026-09-11}` | 200 ×8 | ≤0.47s |

### API

| endpoint | code | time |
|---|---|---|
| `stats/feed` 7d 부산전체 | 200 | cold 1.34s / warm 0.19s |
| `stats/feed` 12m 부산전체 | 200 | cold 4.73s / warm 0.65s |
| `stats/supply` | 200 | 0.32s |
| `stats/region-change?level=sigungu` | 200 | 0.33s |
| `stats/dashboard` | 200 | 0.18s |
| `community/posts` | 200 | 0.23s (`total: 0`) |
| `community/recent-activity` | 200 | 0.15s |
| `presales` | 200 | 0.28s |
| `search?q=전포` | 200 | 0.66s |
| `apt/{name}` trades | 200 | cold 3.73s / warm 0.25s |
| `apt/{name}/info` `/score` `/verify` | 200 | ≤1.06s |

### redirect / 인증 경계

```
http://e-jip.com/        308 → https://e-jip.com/ → 200    (loop 없음)
https://www.e-jip.com/   DNS 미해결 (curl exit 6)          → §14 운영 항목
/api/my/recent, /api/my/favorites                   401
/api/admin/users, /api/admin/dashboard              401
/admin/dashboard                                    307
/api/cron/{sale-sync,rent-sync,sale-recheck}        401  (fail-closed)
```

**의도된 4xx (결함 아님)**

- `/officetel` 404 — detail-only route. 코드 전체에 `/officetel` index 링크 0건 →
  broken navigation 아님. 원칙 13/14(미구현 ≠ 오류).
- `stats/feed?gungu=all` 400, `stats/region-change`(level 없음) 400 — 필수 파라미터
  검증이 동작한 결과.

---

## 6. Auth status

| provider | 판정 | 근거 |
|---|---|---|
| **Google** | **READY** | `/api/auth/providers`에 callback `https://e-jip.com/api/auth/callback/google` 등록. 직전 QA 모바일 Chrome PASS |
| **Kakao** | **READY** | 동일. 직전 QA 모바일 Chrome PASS |
| **Naver** | **LIMITED (launch blocker 아님)** | PC PASS. 모바일에서 `OAUTH_CALLBACK_ERROR / State cookie was missing` 이력 |

- 서버는 세 프로바이더에 `__Secure-next-auth.state`를 동일하게 발급한다 — 공용 쿠키
  인프라 문제가 아니다.
- PC PASS이므로 자격증명/콜백 URL 계열이 아니라 **모바일 브라우저 컨텍스트 전환
  (네이버 앱 핸드오프)** 쪽으로 범위가 좁혀진다.
- 네이버 심사 대기와 이 오류는 같은 문제로 단정하지 않는다 — 심사 단계라면 네이버
  자체 화면에서 막혀 우리 콜백에 도달하지 못한다.
- **판정: Naver 때문에 전체 auth를 수정하지 않는다.** Google·Kakao 2개로 로그인 경로가
  완결되므로 Naver는 LIMITED provider로 출시하고 post-launch에서 분리 처리한다.
- 이번 STEP에서 auth / provider / session / token / env **변경 0건.**

### 보안 확인 (읽기만, 변경 없음)

- session strategy `jwt`. 닉네임 변경은 `trigger === 'update'`일 때 **DB에서 다시
  읽는다** — 클라이언트가 넘긴 값을 토큰에 넣지 않으므로 저장하지 않은 이름을 자기
  세션에 표시하는 경로가 없다.
- 관리자 여부는 서버에서 계산해 boolean 하나만 세션에 싣는다. `ADMIN_EMAIL` 값이나
  허용 목록은 클라이언트로 나가지 않는다.
- provider secret은 전부 `process.env` 참조. 하드코딩 0건.

---

## 7. Data trust

| 항목 | 결과 | 근거 |
|---|---|---|
| aptSeq canonical identity | **PASS** | search가 `aptSeq`/`lawdCd`/`dong`/`apartmentId`를 동반 반환하고 상세 이동 시 query로 전달 |
| no another-apartment fallback | **PASS** | trades 응답의 모든 row가 요청 `aptSeq`와 일치 |
| cancellation exclusion | **PASS** | 12m 부산: total 83,216 / verified 82,602 / **cancelled 614** 분리. 집계 제외 + 목록은 "취소" 표기로 유지(원거래 은폐 없음) |
| recent trade detail | **PASS** | 평형별 최신거래 테스트 통과, micro-variant 병합 0건 |
| compare identity parity | **PASS** | `compare-v2/score-identity-parity.test.ts` |
| report identity parity | **PASS** | `/report/apt/26230-2567` — aptSeq 기반 route |
| score aptSeq resolution | **PASS** | `resolve-score-identity.test.ts`, production `scoreVersion: EJIP_SCORE_V2_1`, `coverage: 1`, `confidence: HIGH`, 카테고리별 설명 동반 |
| **Unit Master 보호** | **PASS** | 전포유림노르웨이숲은 `unitTypes: null` / `hasUnitTypes: false`인데 면적 라벨이 **`61.08m²`(정확 전용면적)** — 가짜 평형 생성 0건, 규정된 fallback 그대로 |
| E-JIP Score | **변경 0건** | formula / weights / eligibility / provenance / normalization 미변경 |

`/api/transactions`는 월별 성공·실패를 판정해 완전성(`partial` / `failedMonths` /
`monthsRequested` / `monthsSucceeded`)을 응답 envelope에 싣고, 소비자
(`resolveTransactionsReadState`)가 **실패 · 부분 · 검증된 0건**을 구분한다.
API 실패를 "거래 없음"으로 접는 경로는 테스트로 고정되어 있다.

---

## 8. Stats

| 항목 | 결과 |
|---|---|
| loading / empty / error 분리 | **PASS** — `stats/view-state.ts`. 조회 중에 "거래 없음"을 말하지 않는다 |
| Busan 12m performance | **PASS** — cold 4.73s / warm 0.65s (기준 cold ≤5s, warm ≤2s) |
| supply map viewport | **PASS (구조)** — `supply-map-bounds.ts` 20/20 |
| region-change map viewport | **PASS (구조)** — `region-change-map-viewport.test.ts` |
| report CTA | **PASS** — production `/stats` HTML에 `report/city/busan` 존재 |
| city / district / dong mapping | **PASS** — `resolveStatsReportEntry`가 dong→dong, district→district, 부산전체→city, 그 외 null. 현 16개 밖 lawdCd가 city 리포트로 조용히 대체되지 않는다 |
| 분위 지도 불완전 처리 | **PASS** — incomplete면 분위 색 대신 회색 + 사유 안내 |

**성능 기준 대비**: 반복 >10s core request **0건**. 직전 감사의 유일한 성능 P1
(12개월 + 부산 전체 22~25초)은 `a8ef871`로 해소되어 production에서 재측정 확인했다.

---

## 9. Map

| 항목 | 결과 |
|---|---|
| `/map` 응답 | 200 / 0.39s |
| marker priority `SELECTED > NEW_BUILD > DEFAULT` | 계약 유지(변경 0건) |
| 마커 캐시 partial 플래그 | **PASS** — 캐시가 `{markers, partial, ts}`를 함께 저장. 캐시 히트에서 불완전이 완전으로 둔갑하지 않는다 |
| region bounds | supply / region-change 둘 다 선택 지역 기준 |
| Kakao Map JS 키 허용 도메인 | **DEVICE QA REQUIRED** — 서버에서 검증 불가 |

---

## 10. Report

| 항목 | 결과 |
|---|---|
| city / district / dong / apt / compare / daily | **PASS** — 8개 route 전부 200 |
| PNG export | **DEVICE QA REQUIRED** |
| PDF export | **DEVICE QA REQUIRED** |
| share | **DEVICE QA REQUIRED** (링크 복원·canonical은 검증됨) |
| bottom action bar | **DEVICE QA REQUIRED** |
| top complex row (단지명 좌 / N건 우) | **DEVICE QA REQUIRED** — `1d1c7a5` 구조 반영, 렌더 미검증 |

Report engine(레이아웃·envelope·route)은 이번 STEP에서 **변경 0건**.

---

## 11. Community

| 항목 | 결과 |
|---|---|
| anonymous list | **PASS** — 비로그인 200, 로그인 요구 전에 읽힌다 |
| anonymous detail | **PASS** — 404와 통신 실패를 구분 |
| write auth / comment auth / ownership | **PASS** — 계약 테스트 통과 |
| nickname join | **PASS** — 작성자명을 User에 live join (닉네임 변경이 과거 글에도 반영) |
| canonical / OG | **PASS** |
| false empty | **없음** — loading("불러오는 중입니다") / error(`role="alert"`) / true-empty(마스코트 + "첫 글 남기기") 3상태 분리 |
| **게시글 수** | **0건** (`{"posts":[],"total":0}`) |

**게시글 0건 = 운영 이슈.** 코드 결함이 아니다. 원칙에 따라 seed/post를 생성하지 않았다.
빈 커뮤니티로 soft launch할지, 운영자가 직접 글을 넣을지는 **사용자 결정 대기**(§21).

---

## 12. Recent viewed

| 항목 | 결과 |
|---|---|
| guest → local | **PASS** |
| authenticated → server | **PASS** — 로그인 분기에서 localStorage를 읽지 않는다 |
| logout → account recent hidden | **PASS** |
| relogin → account restored | **PASS** |
| A→B isolation | **PASS** — SWR key가 `/api/my/recent#${userId}`로 스코프되어 계정이 바뀌면 키 자체가 달라진다 |
| 서버 경계 | `/api/my/recent` 익명 401 |

schema / data 변경 0건.

---

## 13. Conditional home find

| 항목 | 결과 |
|---|---|
| `conditionalHomeFindEntry === false` | **확인** — `feature-flags.ts` 단일 지점 |
| UI entry hidden | **PASS** — production `/` HTML에 "조건으로 집 찾기" 0건 |
| route alive | **PASS** — `/ai-search` 200 |
| API alive | **PASS** — `/api/ai-search` 존재, 삭제 0건 |
| 재노출 | **없음** — 소비자 1곳(`home-client.tsx:67`)뿐, CSS 숨김 0건 |

---

## 14. SEO / domain

| 항목 | 결과 |
|---|---|
| canonical host | **PASS** — `https://e-jip.com`. `og:url`, sitemap, robots, 3사 OAuth callback 전부 동일 origin |
| http → https | **PASS** — 308, redirect loop 없음 |
| sitemap | **PASS** — 부산 스코프(중구·서구… 16개 구). 17개 시도 전체가 아님 |
| robots | **PASS** — `/api/`, `/admin`, `/my`, `/community/write` disallow |
| Naver verification | **PASS** — `<meta name="naver-site-verification">` 렌더됨 |
| Yandex verification | **PASS** — `<meta name="yandex-verification">` 렌더됨 |
| IndexNow key file | **PASS** — 200 |
| GA4 | **PASS (구조)** — env 참조 구조. 쿼리스트링이 GA4에 도달하지 않게 하는 가드 테스트 존재 |
| PWA manifest + icon 96/192/512 + sw.js + og-image | **PASS** — 전부 200 |

secret value는 출력하지 않았다. 외부 심사/색인 대기는 blocker로 보지 않는다.

### P2 관찰 2건 (이번 STEP 미수정 — 신규 기능 금지 범위)

1. `<link rel="canonical">` 태그가 어느 페이지에도 렌더되지 않는다. `metadataBase`는
   설정되어 있어 OG/Twitter absolute URL은 정상이나 `alternates.canonical`이 없다.
   sitemap에 `/stats?sido=…&sigungu=…` 쿼리 URL이 있어 중복 색인이 분산될 여지가 있다.
2. manifest에 `purpose: "maskable"` 아이콘이 없다 — Android 런처에서 아이콘이 흰 배경에
   letterbox될 수 있다.

### 운영 항목 1건

`www.e-jip.com`이 DNS 미해결이다. apex는 정상이므로 코드 blocker가 아니지만,
소프트런칭 홍보에서 `www`를 타이핑한 사용자는 연결 실패를 본다.
DNS에서 `www` → apex redirect 등록을 권고한다(코드 변경 아님).

---

## 15. Mobile QA matrix — DEVICE QA REQUIRED

**이 환경에는 실제 browser/device가 없다. 아래 항목에 PASS를 쓰지 않는다.**

### Android Chrome

- [ ] login (Google / Kakao / **Naver — 실패 재현 여부 확인**)
- [ ] nickname 수정 후 헤더·MY 즉시 반영
- [ ] recent viewed: guest → login → logout → 재로그인 → A/B 계정 격리
- [ ] map / roadview (**Kakao Map JS 키 허용 도메인 의존 — 서버 검증 불가**)
- [ ] stats: 12개월 + 부산 전체 로딩 상태 및 체감 속도
- [ ] compare share: 카카오 말풍선 카드
- [ ] report: PNG / PDF export, bottom action bar, top complex row 정렬
- [ ] community: 익명 열람 → 글쓰기 진입 시 로그인 유도
- [ ] PWA 설치
- [ ] 360 / 375 / 390px 가로 overflow, 글자 잘림, 바텀네비 가림, 44px 터치 타깃

### Kakao in-app browser

- [ ] 외부 브라우저 열기 UX
- [ ] share
- [ ] map

### iPhone Safari

- [ ] 가능하면 위 항목 별도 1회

---

## 16. 적용한 수정 (1건, test-only)

### `src/lib/transactions-read-state.test.mjs` — stale implementation guard 복구

**증상**: 전체 테스트 1670건 중 1건 FAIL.
`라우트가 월별 판정을 실제로 수행하고 완전성을 응답에 싣는다`
→ "완전성이 응답에 실리지 않는다".

**원인**: 제품 결함이 아니다. 이 가드는 `d1fa766`에서 **한 줄짜리** 응답을 정규식으로
고정했는데, 이후 `2a0f586`(캐시 헤더 작업)이 같은 호출을 여러 줄로 재포맷하면서 가드를
갱신하지 않았다.

```
src/app/api/transactions/route.ts:277
  return NextResponse.json(
    { transactions: data, ...completeness },
    { headers: cacheHeaders(!completeness.partial) }
  );
```

완전성은 **실제로 응답에 실려 있고**, 주변 행위 테스트(실패/부분/검증된 0건 구분,
분위 지도, 마커 캐시 partial)는 전부 통과했다. 즉 계약은 살아 있고 가드의 정규식만
낡았다.

**수정**: 정규식을 공백 허용형으로 바꿨다. `transactions: data, ...completeness`가
함께 있어야 통과하는 강도는 그대로다 — `...completeness`를 빼면 여전히 실패한다.

```diff
- /NextResponse\.json\(\{ transactions: data, \.\.\.completeness \}\)/.test(src),
+ /NextResponse\.json\(\s*\{\s*transactions:\s*data,\s*\.\.\.completeness\s*\}/.test(src),
```

schema 변경 0 · auth/security 변경 0 · production write 0 · product policy 변경 0 ·
**src 프로덕션 코드 변경 0**(테스트 파일 1줄).

---

## 17. Tests / build

| 명령 | 결과 |
|---|---|
| `npx tsx --test <src 전체 78 파일>` (수정 전) | **1669/1670 pass, 1 fail** |
| `npx tsx --test src/lib/transactions-read-state.test.mjs` (수정 후) | **18/18 pass** |
| `npx tsx --test <src 전체>` (수정 후) | **1670/1670 pass, 0 fail** (7.5s) |
| `npx tsc --noEmit` | **FAIL_EXISTING_SCRIPT_ERRORS** — `src/` 오류 **0건**. 전부 `scripts/`(기존) 및 `tmp/`(사용자 untracked) |
| `npx eslint src/lib/transactions-read-state.test.mjs` | **clean** |
| `npm run build` | **exit 0** — warning 0, error 0, 전 route 컴파일 |

`tsc` 잔여 오류는 이번 변경과 무관한 기존 script 오류다(`shapefile` 타입 누락,
`adm-zip` 미설치, 제거된 `formatPyeong` export 참조 등). production 번들에 포함되지
않는다.

---

## 18. External pending reviews (blocker 아님)

- 네이버 검색 노출 심사
- Yandex Webmaster 색인
- IndexNow 색인 반영
- 신규 도메인 검색엔진 색인 일반 지연

---

## 19. Post-launch P1/P2 (출시 blocker 아님)

1. SCHOOL SCORE MODEL REBASE V1
2. RENT RECHECK SWEEP
3. cancellation ratchet repair
4. MASTER COVERAGE SYNC AUTOMATION
5. REVIEW_REQUIRED master `26440-329`
6. coordinate enrichment for new masters
7. 생활숙박시설 DATA AUDIT / MVP
8. PARTNER ANALYTICS V2
9. AI conditional home search optimization
10. nationwide data audit
11. Android app packaging

**이번 감사에서 추가**

12. `<link rel="canonical">` 부재 (§14 P2-1)
13. PWA maskable 아이콘 부재 (§14 P2-2)
14. `www.e-jip.com` DNS 미등록 (§14 운영 항목)
15. Naver 모바일 OAuth state cookie 판별 — PC PASS로 범위가 모바일 컨텍스트 전환으로 좁혀짐
16. `scripts/` 기존 tsc 오류 정리 (production 영향 없음)

---

## 20. Release freeze

```
P0                  0
P1 code blocker     0
```

**`e867a40`을 BUSAN RELEASE CANDIDATE로 기록한다.**
git tag는 사용자 요청이 없어 생성하지 않았다.

**이번 STEP 이후 규칙**

- 신규 기능 개발 중단
- 출시 전에는 P0/P1 bug fix만 허용
- Score formula / DB schema / auth 정책은 승인 없이 변경 금지

---

## 21. 최종 판정

### **CONDITIONAL GO**

**GO인 근거**

- P0 0건, P1 code blocker 0건
- 40개 production route 확인, 5xx 0건, redirect loop 0건
- 인증 경계(개인 / 관리자 / cron) 전부 fail-closed
- 직전 감사의 유일한 성능 P1 해소를 production에서 재측정 확인
- 데이터 진실성 계약(canonical identity, 취소 분리, Unit Master fallback, false empty
  금지)이 테스트로 고정되어 있고 production 응답과 일치
- 1670/1670 테스트, build exit 0

**CONDITIONAL인 근거 — 코드가 아니라 3건의 미해결 조건**

1. **실기기 QA 미수행**(§15). 특히 지도/로드뷰(Kakao 도메인 등록 의존), 카카오 공유,
   report export는 서버에서 대체 검증이 불가능하다. **출시 전 1회는 반드시 밟아야 한다.**
2. **커뮤니티 게시글 0건** — 빈 커뮤니티로 갈지 운영자가 글을 넣을지 사용자 결정 필요.
3. **Naver 로그인 LIMITED** — Google·Kakao로 로그인이 완결되므로 blocker는 아니나,
   출시 시 Naver 버튼 노출 여부를 결정해야 한다.

**권고**: §15 Android Chrome 체크리스트를 1회 통과시키면 **GO**.
그 전까지는 코드 freeze 상태로 유지하고 P0/P1 외 변경을 넣지 않는다.
