# E-JIP NON-BUSAN STATS TRUST GATE V1

부산 출시 신뢰 정책에 맞춰 **부산 밖의 통계를 신뢰할 수 있는 DB가 준비될 때까지 닫는다.** 비부산 stats 요청이 live MOLIT를 직접 불러 DB-first·coverage·취소 반영 같은 신뢰 장치를 우회하던 경로를 제거한다.

- 날짜: 2026-09-19 (KST)
- 기준 커밋: `6b93e51`
- 범위: **enablement의 `stats` 축으로 게이트만 추가.** DB write 0, schema/migration 0, 서울·경기 수집/backfill 0, report route 0, REGION_DATA 0, sitemap/SEO 0, 취소 보정 0.
- 선행: `STATS_REGION_ENABLEMENT_MIGRATION_V1` §10 — 거기서 승인 대상으로 남긴 **안 B("stats: false 시도를 UNSUPPORTED로")** 를 이번 지시로 수행한다.

---

## 1. 정책

| 지역 | stats |
|---|---|
| 부산광역시(26) | **열림** — 기존 화면 그대로 |
| 서울(11)·경기(41) | 닫힘 — registry에 존재하지만 `stats: false` |
| 그 밖의 시도·미등록 코드 | 닫힘 — registry에 없음 = 닫힘(추측하지 않음) |

단일 기준은 `src/lib/region/enablement.ts`의 `stats` 축이다. 새 플래그 체계를 만들지 않았다.

---

## 2. Baseline — 게이트 전 비부산 동작 (Production 실측, 2026-09-19)

| 요청 | 결과 | 시간 |
|---|---|---|
| `yearly?lawdCd=11680` (강남) | 200 success (live MOLIT) | **117.3s** |
| `yearly?lawdCd=41135` (분당) | 200 success (live) | **78.0s** |
| `dashboard?lawdCd=11680` (강남) | 200 success (live) | 7.3s |
| `dashboard?lawdCd=11710` (송파) | 200 success (live) | 6.3s |
| `price-rankings?mode=record-high&lawdCd=11680` | 200 OK (live) | 3.2s |
| `price-rankings?mode=area84&lawdCd=41570` (김포) | 200 OK (live) | 5.2s |
| `region-change?level=sigungu&sidoCode=11` | 200 OK (live, 25구 fan-out) | **88.4s** |
| `region-change?level=dong&lawdCd=41135` | 200 OK (live) | 1.1s |
| `feed?lawdCd=11710&period=7d` | 200 OK (live) | 66.9s |
| `feed?sidoCode=41&period=7d` | 200 OK (live) | 34.9s |
| `concentration?lawdCd=41570` | 200 OK (live) | 27.4s |
| `gap-invest?lawdCd=11680` | 200 OK (live) | 8.3s |
| `rankings?lawdCd=41135` | 200 success (live) | 7.7s |
| `dashboard?lawdCd=27110` (대구 중구) | 200 success (live) | 8.9s |
| `large-complex?sidoCode=11` | 200 **UNSUPPORTED** | 0.06s |
| `large-complex?sidoCode=26&lawdCd=11680` | 200 **OK, items 0, total 0** | 0.07s |

마지막 줄은 **실패/미지원이 "0건"으로 위장된 사례**다 — 시도는 부산인데 시군구가 서울이면 부산 ApartmentMaster에 서울 코드가 걸려 빈 결과가 정상 응답으로 나갔다. 이번 게이트가 함께 막는다.

변동지도 대한민국 화면은 시도 17개에 `level=sigungu`를 각각 호출한다 — 부산 외 16개 시도가 전부 live MOLIT fan-out을 돌았다(서울 88s, 이전 실측 경기 94s).

---

## 3. 게이트한 라우트

| 라우트 | 이전 비부산 경로 | 이후 |
|---|---|---|
| `stats/dashboard` | live MOLIT 12개월 × (매매+전월세) | 준비 중 |
| `stats/yearly` | live MOLIT 13년 × 12개월 × 2 | 준비 중 |
| `stats/price-rankings` (5개 mode) | live MOLIT 24개월 | 준비 중 |
| `stats/region-change` (sigungu/dong/complex) | live MOLIT | 준비 중 (`nation`은 시도 목록만이라 유지) |
| `stats/feed` | live MOLIT | 준비 중 |
| `stats/concentration` | live MOLIT | 준비 중 |
| `stats/gap-invest` | live MOLIT | 준비 중 |
| `stats/rankings` (클라이언트 소비처 없음) | live MOLIT | 준비 중 |
| `stats/large-complex` | 이미 UNSUPPORTED | 같은 게이트로 통일 + 시도/시군구 불일치도 차단 |

**게이트하지 않은 것**

| 대상 | 이유 |
|---|---|
| `/api/transactions` (지도·상세·분위지도) | §9 — stats 게이트는 stats 기능에만. 지도/상세 비부산 요청은 기존 live 경로 그대로 |
| `stats/supply` | MOLIT가 아니라 `Presale` DB, 지역 파라미터가 시도명. 이번 문제(live MOLIT 우회)와 무관 → §9 남은 결정 |

게이트 위치: 파라미터 파싱 직후, **캐시(`getOrSetCache`)·DB·MOLIT·법정동 프록시(`resolveLawdCd`/`getSigunguListForSido`) 호출 전**. 이름 경로(`sido`/`gungu`)는 시도명을 registry에서 먼저 확인하고, `resolveLawdCd` 이후 해석된 코드를 한 번 더 확인한다.

판정 순서는 라우트의 지역 해석 순서를 그대로 따른다: 유효한 5자리 `lawdCd` → (lawdCd가 없을 때) 2자리 `sidoCode` → 시도명. 따라서 `sidoCode=26&lawdCd=11680`은 lawdCd 기준으로 막힌다.

---

## 4. 응답 계약

HTTP **200**(500 아님). 기존 응답 모양을 유지하고 필드만 더한다.

```jsonc
// status 계약 라우트 (price-rankings/region-change/feed/concentration/gap-invest/large-complex)
{ "status": "UNSUPPORTED", "supported": false, "reason": "UNSUPPORTED_REGION",
  "message": "이 지역 통계는 현재 준비 중입니다.", "supportedSidoCode": "26", "supportedSidoName": "부산광역시" }

// success 계약 라우트 (dashboard/yearly/rankings)
{ "success": false, "supported": false, "reason": "UNSUPPORTED_REGION",
  "message": "이 지역 통계는 현재 준비 중입니다.", "supportedSidoCode": "26", "supportedSidoName": "부산광역시" }
```

- `data`/`rows`/`items`/`entries`/`summary`/`total`/`overall`/`apiError`를 싣지 않는다 — "0건"으로 읽힐 여지를 없앤다.
- `supportedSidoCode/Name`은 안내용 힌트일 뿐 부산 데이터는 싣지 않는다(fallback 없음).
- large-complex는 기존 문구("대단지 순위는 현재 부산 지역부터 제공하고 있어요.")와 필드를 유지하고 `supported`/`reason`만 추가됐다.
- HTTP 200을 고른 이유: 모든 stats 클라이언트가 `fetch().then(res => res.json())`으로 status 코드를 보지 않고 본문을 읽는다. large-complex가 이미 200 UNSUPPORTED를 쓰고 있었다. 4xx는 "요청이 틀렸다"는 의미라 준비 중 지역에 맞지 않는다.

---

## 5. 사용자 화면

공용 컴포넌트 `StatsUnsupportedRegion` — `Empty variant="notReady"`(오류 마스코트가 아닌 안내 마스코트, 빨간 오류 아님):

> **이 지역 통계는 현재 준비 중입니다.**
> {지역명} 통계는 믿을 수 있는 실거래 데이터가 준비되면 열어드릴게요. 지금은 부산광역시 통계를 제공하고 있어요.
> [부산광역시 통계 보기]

- 버튼은 사용자가 누를 때만 지역을 부산 전체로 바꾼다(자동 전환·부산 데이터 대체 표시 없음). 터치 영역 44px.
- 적용: 거래량(VolumeChartCard), 실거래 피드, 하락/신고가/상승/전세위험, 84㎡, 거래집중, 갭투자, 대단지, 변동지도.
- 각 화면은 unsupported 분기를 **맨 앞**에 둔다. 두지 않으면 `status !== 'ERROR'`·`!apiError`를 지나 "거래가 없어요"(noData)로 떨어진다 — 금지된 표현.
- 변동지도 대한민국 타일: 준비 중 시도는 "조회 실패"가 아니라 "준비 중"으로 표시. 시도/구/동 단계는 같은 안내 + "부산광역시 통계 보기"(URL 기반 이동).
- AI 검색 `regional_stats`: 비부산이면 dashboard를 부르지 않고 "이 지역 통계는 현재 준비 중입니다."를 돌려준다(이전: "지역 통계를 불러오지 못했습니다."로 보였을 경로). 결과 캐시에 저장하지 않는다.

---

## 6. 캐시 · 오류 로그

- 게이트가 `getOrSetCache` 이전이라 비부산 요청은 서버 메모리 캐시를 **읽지도 채우지도 않는다**. 부산 캐시 키는 변경 0.
- Next 16 route handler GET은 기본 비캐시(`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` "Route Handlers are not cached by default")이고, 이 라우트들은 `force-static`을 쓰지 않는다 → CDN/라우트 캐시 오염 없음.
- 게이트 분기는 `console.error`/`logServerError`/`errorLog`를 호출하지 않는다. 테스트가 Prisma 싱글턴 전체를 기록 대역으로 바꿔 `errorLog.create`를 포함한 DB 접근 0을 확인한다.
- 새 analytics 없음.

---

## 7. 미래 활성화

서울 DB가 준비되면 `enablement.ts`의 `ENABLEMENT_BY_SIDO`에 서울 항목을 추가하는 것만으로 게이트가 열린다 — 라우트에 서울 분기가 없다. 테스트 `15`가 주입된 predicate로 이를 고정한다(서울만 열면 서울 통과·경기 여전히 닫힘).

**운영 규칙(테스트 `15b`)**: 게이트는 `stats` 축, 게이트 뒤의 DB-first/live 선택은 `cronSync` 축이다. 서울을 열 때는 DB 적재 완료 후 **두 축을 함께** 연다. `stats`만 열면 게이트를 통과한 뒤 다시 live MOLIT 경로로 떨어진다.

---

## 8. 테스트 · 빌드 (로컬)

`src/lib/region/stats-gate.test.ts` — 10개. 라우트 테스트는 실제 `GET` 핸들러를 호출하고, `fetch`(MOLIT·법정동 프록시)와 Prisma 싱글턴(`globalThis.prisma`)을 **호출되면 기록하고 던지는** 대역으로 바꾼다.

| # | 확인 |
|---|---|
| B1 | 부산 시도 전체·16개 구·기본 진입(이름 경로)·형식 오류 lawdCd 모두 게이트 통과 |
| 5~8 | 강남·송파·분당·김포 — 시군구/시도 전체/이름 경로 모두 닫힘 |
| 9 | 대구·99999·26999·26000·빈 값 닫힘, `sidoCode=26&lawdCd=11680` 닫힘 |
| 15 | 미래 활성화 fixture — stats 축만 열면 통과, 다른 시도는 여전히 닫힘 |
| 15b | 게이트 뒤 DB-first는 cronSync를 따른다 · enablement에 서울/경기 활성 항목 0 |
| 13 | 응답 계약 — 0건 필드 없음, 오류/0건 응답을 unsupported로 오인하지 않음 |
| 5~12·14 | **77개 비부산 요청**(9개 라우트 × 강남/송파/분당/김포 + 서울/경기/대구 시도 전체 + 이름 경로 + 미등록 코드) — HTTP 200, `reason=UNSUPPORTED_REGION`, **fetch 0 · DB 0 · console.error 0**, 데이터 필드 0, 각 < 1s |
| B2 | 부산 요청 5개는 게이트를 통과해 DB 경로에 실제로 도달 |
| 9b | `/api/transactions`는 stats 게이트를 쓰지 않음 |
| 16 | 9개 라우트 모두 게이트가 캐시/DB/MOLIT/프록시 호출보다 먼저 옴 |

하네스 민감도 확인: region-change sigungu 게이트를 임시로 끈 변이에서 위 77개 요청 테스트가 **실패**했다(대역이 누수를 잡는다). 확인 후 원복.

기존 `stats-enablement.test.ts`의 large-complex 단언 2개는 게이트가 공용 모듈로 옮겨진 것에 맞춰 대상만 바꿨다(UNSUPPORTED 계약 자체는 그대로 검증).

```
npx tsx --test src/lib/region/stats-gate.test.ts           pass 10   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"      pass 2243 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs"    pass 135  fail 0
npx eslint (변경 23개 파일)                                  exit 0
npm run lint                                               exit 1 — 오류 1638건 전부 기존: .worktrees/ 1633, scripts/ 5, src/ 0
npx tsc --noEmit                                           src/ 오류 0 · 기존 25건 scripts/ 21 + tmp/ 4 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                              Compiled successfully
```

---

## 9. 남은 결정 / 알려진 갭

- **`stats/supply`(공급)**: Presale DB 기반이라 게이트하지 않았다. 비부산 공급 데이터를 계속 보여줄지는 별도 제품 결정.
- **분위지도(`/stats/price-map`)**: `/api/transactions`를 쓰므로 §9에 따라 게이트하지 않았다. 비부산에서는 여전히 live 경로로 동작한다. stats 화면 쪽에서만 막을지 결정 필요.
- **부산 단일 구의 일부 경로는 여전히 live MOLIT**다(피드 단일 구, 갭투자 단일 구, 연도별 표 전월세, 대단지 "최근 매매"). 부산 parity 대상이라 이번 STEP에서 바꾸지 않았다.
- **GPS/수동으로 서울을 고른 사용자**는 통계 화면 전반에서 준비 중 안내를 본다(의도된 정책). 지역 선택 모달 자체는 전국을 계속 보여준다.
- AI 검색 캐시(`aiSearchCache`, 30분 TTL)에 배포 전 저장된 비부산 `regional_stats` 결과가 있다면 TTL 동안 캐시로 응답될 수 있다(새로 저장되지는 않음).

---

## 10. Production QA

커밋 `99419e4` push → Vercel Production 배포(push 후 약 60초에 새 응답 확인). DB/schema 변화 없음.

### 부산 parity — 배포 전 2회 / 배포 후 1회, 응답 본문 전체 해시 비교

| 요청 (26개 + 지도 1) | 결과 |
|---|---|
| dashboard 부산전체 / 서구 / 해운대 / 연제 / 기본 진입 | **동일** ×5 |
| price-rankings record-high 서구 · rising/decline 해운대 · area84 연제 · area84 부산전체 · decline 부산전체 | **동일** ×6 |
| region-change sigungu 부산 · dong 해운대 · complex 연제 · (param 누락 400) | **동일** ×4 |
| yearly 해운대 | **동일** |
| yearly 서구 | **다름** — 아래 |
| feed 부산전체 7일 / 30일 | **동일** ×2 |
| concentration 부산전체 / 서구 | **동일** ×2 |
| gap-invest 부산전체 | **동일** |
| gap-invest 해운대 | 배포 전 두 번끼리도 달랐음(부산 단일 구 갭투자는 live MOLIT) — 비교 대상 아님 |
| large-complex 부산 / 서구 | **동일** ×2 |
| transactions marker 해운대(지도) | **동일** |

`yearly?lawdCd=26140` 차이 분석: 연도별 표의 매매는 DB, 전세/월세는 부산이어도 **live MOLIT**다(`fetchMonthsThrottled`, 실패 월을 조용히 빈 배열로 둠). 읽기 전용 조회로 서구 매매 row의 마지막 변경이 2026-09-18 23:29Z(배포 전 baseline 01:16Z 이전)임을 확인했다 — 매매 부분은 두 시점에 동일한 DB였다. 같은 코드 경로의 해운대 yearly는 동일했고, 배포 후 캐시 만료(10분)를 넘겨 두 번 다시 계산한 서구 yearly는 매매·전세·월세 전 연도가 서로 동일했다. 차이는 live 전월세 응답 쪽이며 게이트(부산은 통과)와 무관하다고 판단한다. 단, 배포 전 본문을 저장하지 않아 어느 연도가 달랐는지까지는 확인하지 못했다.

**PARITY: PASS**(비교 가능한 25개 전부 동일, 1개는 live 전월세 변동으로 설명).

### 비부산 — 빠른 준비 중, live MOLIT fan-out 0

| 요청 | 배포 전 | 배포 후 |
|---|---|---|
| yearly 강남 11680 | 200 success, **117.3s** | 200 준비 중, **0.11s** |
| yearly 분당 41135 | 200 success, **78.0s** | 200 준비 중, **0.11s** |
| dashboard 강남 11680 | 200 success, 7.3s | 200 준비 중, 0.07s |
| dashboard 송파 11710 | 200 success, 6.3s | 200 준비 중, 0.22s |
| price-rankings record-high 강남 | 200 OK, 3.2s | 준비 중, 0.06s |
| price-rankings area84 김포 41570 | 200 OK, 5.2s | 준비 중, 0.06s |
| region-change sigungu 서울 | 200 OK, **88.4s** | 준비 중, 0.07s |
| region-change dong 분당 | 200 OK, 1.1s | 준비 중, 0.06s |
| feed 송파 7일 | 200 OK, 66.9s | 준비 중, 0.05s |
| feed 경기 전체 7일 | 200 OK, 34.9s | 준비 중, 0.58s |
| concentration 김포 | 200 OK, 27.4s | 준비 중, 0.05s |
| gap-invest 강남 | 200 OK, 8.3s | 준비 중, 0.15s |
| rankings 분당 | 200 success, 7.7s | 준비 중, 0.06s |
| dashboard 대구 27110 | 200 success, 8.9s | 준비 중, 0.06s |
| large-complex 서울 | UNSUPPORTED | UNSUPPORTED + `supported:false`/`reason` |
| large-complex `sidoCode=26&lawdCd=11680` | **OK, 0건** | **준비 중** |

16개 전부 HTTP 200, 응답 본문은 계약별로 동일한 한 가지(`success` 계약 1종, `status` 계약 1종, large-complex 1종) — 데이터·0건 필드 없음. 서버는 캐시/DB/MOLIT 전에 반환하므로(로컬 테스트로 fetch 0·DB 0 고정) 이 요청들이 MOLIT를 부른 경로가 없다.

### 지도/상세 영향 없음

`/api/transactions?type=apt&lawdCd=11680&months=1`(강남, 지도 경로) — 배포 전후 **동일**(200). stats 게이트가 지도/상세에 걸리지 않았다.

### 화면 (Production, Chrome)

- 강남 공유 링크로 들어간 거래량·실거래·하락·신고가·상승·전세위험·84㎡·거래집중·갭투자·대단지 **10개 화면 전부** "이 지역 통계는 현재 준비 중입니다." 표시, "거래가 없어요"/"불러오지 못했"/"조회 실패" 문구 0.
- 변동지도: 경기 시도 단계·서울 구 단계 준비 중 안내. **대한민국 화면: 부산광역시 "0% · 1016개 단지", 나머지 16개 시도 "준비 중"**(이전: 16개 시도 live fan-out 후 값 또는 "조회 실패").
- 360/375/390px: 가로 스크롤 0(`scrollWidth == innerWidth`), "부산광역시 통계 보기" 버튼 높이 44px. 데스크톱에서도 같은 카드로 표시.
- "부산광역시 통계 보기" 클릭 → 지역 "부산광역시 전체"로 바뀌고 부산 실거래 피드가 정상 표시.

### 안전 확인

| 확인 | 결과 |
|---|---|
| sitemap `<loc>` | **139** (불변) |
| sitemap 내 서울/경기 URL | **0** · stats URL은 `/stats` 1개(기존) |
| `/stats` canonical | `https://e-jip.com/stats` (불변) |
| `/` · `/stats` · `/map` · `/stats/volume` | 200 |
| `error_logs` 배포 후 / 최근 24시간 | **0 / 0** (최신 2026-09-11) — 읽기 전용 조회 |
| DB write · schema | 0 |

AI 검색 `regional_stats` 경로는 Gemini 호출 비용이 들어 Production에서 직접 호출하지 않았다(로컬 코드·타입 검증만).
