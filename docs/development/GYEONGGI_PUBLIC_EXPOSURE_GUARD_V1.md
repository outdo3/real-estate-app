# E-JIP GYEONGGI PUBLIC EXPOSURE GUARD V1

경기 master seed 전에 공개 노출 판정을 **서울 deny-list → 전국 공통 allowlist**로 바꿨다.
경기 master가 생겨도 검색·지도·상세·리포트·비교·선택기·SEO에 자동으로 실리지 않는다.

- 날짜: 2026-09-25 (KST) · 기준 `b9055a5`(로컬, 이번 push에 포함)
- Production DB write 0 · migration 0 · master seed 0 · cron 변경 0 · 경기 공개 0

## 1. 문제

공개 표면이 "이 지역이 공개 허용됐는가?"가 아니라 "차단된 서울인가?"(`isSeoulPublicBlocked`)를 물었다.
서울이 아니면 무조건 통과였다. 운영 실측(2026-09-25, 배포 전):

| 표면 | 실측 |
|---|---|
| `/api/transactions` 강남 11680 / 서초 11650 | **마커 375 / 408개** — 공개 차단 서울이 지도 API로 새고 있었다(지역 게이트 자체가 없음) |
| `/api/apt/동신2단지?lawdCd=41111` | live MOLIT **80건** 응답 |
| `/apt/동신2단지?lawdCd=41111&aptSeq=41111-41` | 단지명 title + **self canonical, robots 없음**(색인 가능) |
| `/stats/compare?a=26350-22&b=41111-41` | robots 없음 + canonical |
| 검색 | 경기 master 0이라 아직 0 — master가 생기면 deny-list를 그대로 통과 |

## 2. 새 모델

`src/lib/region/enablement.ts`
- 축 추가: `search` · `map` · `detail`(기존 `app` · `report` · `stats` · `sitemap` · `seoIndex` · `cronSync` 유지)
- `isPublicRegionAllowed(lawdCd, feature)` — registry 노드의 enablement 축. 모르는 코드·null = false
- `publicAllowedLawdCds(feature)` — DB 질의용 allowlist(`sggCd IN`)
- `isSidoPubliclyHidden(sido)` — 모든 시도에 같은 규칙(공개 구 0 → 숨김)
- `isSeoulPublicBlocked`/`seoulPublicBlockedLawdCds`는 서울 감사 스크립트·`stats/supply`(분양 원천)용으로 유지

| 지역 | app | search | map | detail | report | stats | sitemap | seoIndex | cronSync |
|---|---|---|---|---|---|---|---|---|---|
| 부산 16구 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 서울 beta 8구 | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ |
| 서울 강남 + 16구 | – | – | – | – | – | – | – | – | – |
| 경기 48노드(8구 적재 포함) | – | – | – | – | – | – | – | – | – |
| 그 밖 전국 · registry 밖 | – | – | – | – | – | – | – | – | – |

## 3. 소비자 변경

| 표면 | 파일 | 게이트 |
|---|---|---|
| 검색(지역·단지) | `api/search/route.ts` | `sggCd IN publicAllowedLawdCds('search')`(notIn 제거) + 오피스텔 결과 필터 |
| 검색 alias fallback | `search-alias-fallback.ts` | `!isPublicRegionAllowed(m.sggCd,'search')` → 즉시 null(다음 후보로 넘어가지 않음) |
| 지도 | `api/transactions/route.ts` | `map` 축 — DB/MOLIT/master 좌표 조회 **전에** `{transactions:[], regionUnsupported:true}`(no-store) |
| 거래 읽기 계약 | `trade-read-state.ts`, `ai-search.ts` | `regionUnsupported` 전달 → 검증된 0건과 구분, AI 조건검색은 `unavailable` |
| 상세 | `api/apt/[name]/route.ts`, `info`, `education`, `score`, `verify` | `detail` 축(canonical lawdCd / aptSeq 앞자리, 이름 아님). live MOLIT 전에 종료 |
| 상세 메타 | `apt/[name]/page.tsx` | `decidePublicSeo(…,'detail')` — 닫힌 지역 BLOCKED(일반 제목·noindex·nofollow·canonical 없음) |
| 단지 리포트 | `report/apt/[aptSeq]/page.tsx` | `report` 축(형태가 aptSeq가 아니면 기존 not-found 경로) |
| 비교 리포트 | `report/compare-read.ts` | 양쪽 master `report` 축 — 아니면 "찾을 수 없음"과 같게 거부 |
| `/stats/compare` | `compare-v2/resolve-seeds.ts`, `stats/compare/page.tsx` | seed는 `detail` 축만 해석, 메타는 요청 aptSeq 앞자리도 판정 |
| 주변 단지(분양·학교) | `nearby-apartments.ts` | `sggCd IN publicAllowedLawdCds('app')`(구 경계 넘는 부산 후보는 유지) |
| 지역 선택기 | `RegionSelectModal.tsx` | 시도: 공개 구 있는 시도만(부산·서울) / 시군구: `app` 축 |
| sitemap | 변경 없음 | 이미 부산 전용(`LAUNCH_SIDO`, `BUSAN_DISTRICTS`) |

`seoul-blocked-seo.ts`: `decideSeoulSeo` → `decidePublicSeo`, 기본 판정을 allowlist로. 지역 코드가 하나도 없는 URL(이름만)은 지역을 알 수 없어 기존 동작(NONE, canonical 없음) 유지.

## 4. 의도된 동작 변화

- **공개 차단 서울 17구 지도 마커 0**(기존 누출 수정).
- **전국(부산·서울 8구 외) 상세·지도가 닫힌다.** 예전 설계(SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1)는 "검색/상세는 전국 live MOLIT"를 의도된 동작으로 뒀다 — 이번 STEP 요구로 뒤집었다(DECISIONS §13). 대구 등 URL은 "이 지역은 아직 준비 중입니다" 응답.
- **지역 선택기에서 부산·서울 외 시도가 사라진다**(예전: REGCODE 전국 목록).
- **서울 8구의 `/report/compare`가 닫힌다** — 단지 리포트는 이미 `report` 축으로 닫혀 있었고 비교만 게이트가 없었다(우회로). `/stats/compare`(detail 축)는 서울 8구 그대로.
- 차단 서울의 점수·정보·교육 API가 `UNSUPPORTED_REGION`(예전엔 계산/조회됨).
- 변경 없음: `stats/supply`(분양 원천, 서울 전용 판정 유지), 분양/재개발 목록, cron, 수집 경로.

## 5. Seeder 게이트

`gyeonggi-master-seed-logic.ts`에 `computePublicExposureGuarded(isAllowed)` 추가 — 8구 + 41135의 모든 공개 축(app·search·map·detail·report·stats·sitemap·seoIndex)이 닫혀 있으면 `guarded: true`. apply 게이트의 `publicExposureGuarded`는 이 값을 넣는다(하드코딩 금지). 현재 런타임: `{ guarded: true, openAxes: [] }`.

## 6. 테스트 / 빌드

```
npx tsx --test src/lib/region/public-exposure-guard.test.ts                 pass 13 (§12 매트릭스 20항목)
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs" "src/**/*.test.tsx"   pass 2633 fail 0
npx tsx --test "scripts/*.test.ts" "scripts/*.test.mjs" "scripts/**/*.test.ts"  pass 586 fail 0
npx eslint (변경 파일 전부)                                                   exit 0
npx tsc --noEmit                                                              exit 2 — 27건 전부 기존 scripts/·tmp/, 변경 파일 0 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                 exit 0
```

기존 테스트 갱신(의미 변경 반영): `seoul-leak-close.test.ts`(경기·대구 "과잉 차단 아님" → allowlist로 차단), `seoul-blocked-seo.test.ts`(서울 밖 NONE → BLOCKED), enablement 축 리터럴 4파일, 점수 라우트 import 고정 목록(+`region/enablement`, 산식 모듈 아님).

## 7. 운영 검증

§8에 배포 후 결과를 기록한다(배포 전 기준선은 §1).

## 8. 운영 검증 (배포 68bf522, Vercel success, 2026-09-25 KST)

같은 스크립트로 배포 전/후 GET만 비교(쓰기 0).

| 항목 | 배포 전 | 배포 후 |
|---|---|---|
| 검색 해운대 / 경동 / 남산타운 | 15 [26350] / 15 부산 + 지역 11230 / 1 [11140] | 동일 |
| 검색 은마·반포자이(차단 서울)·동신2단지(경기) | 0 | 0 |
| 마커 부산 26350 / 26410 | 275 / 236 | 275 / 236 |
| 마커 서울 8구 11440 / 11110 | 241 / 87 | 241 / 87 |
| 마커 강남 11680 / 서초 11650 | **375 / 408** | 0 / 0 (`regionUnsupported`) |
| 마커 경기 41111 / 대구 27110 | 0 / 0 | 0 / 0 (`regionUnsupported`) |
| 상세 API 부산 센텀현대 / 서울 남산타운 | 38 DB / 137 DB | 동일 |
| 상세 API 강남 개포주공7단지 | UNSUPPORTED | 동일 |
| 상세 API 경기 동신2단지 / 대구 황금 | **80 MOLIT** / 0 MOLIT | 0 UNSUPPORTED / 0 UNSUPPORTED |
| `/apt/동신2단지?lawdCd=41111` 메타 | 단지명 + self canonical, robots 없음 | 일반 제목, noindex·nofollow, canonical 없음 |
| `/apt/황금?lawdCd=27110` 메타 | 단지명, robots 없음 | 일반 제목, noindex·nofollow |
| `/apt/센텀현대…`(부산) · `/apt/남산타운…`(서울 8) 메타 | self canonical / NOINDEX | 동일 |
| `/report/apt/26350-22` | 단지명 + canonical | 동일 |
| `/report/apt/41111-41` | noindex, follow | noindex, nofollow(BLOCKED) |
| `/stats/compare?a=26350-22&b=41111-41` | robots 없음 | noindex, nofollow |
| sitemap | 140 · 경기 0 · 서울 0 | 동일 |
| 점수 부산 / 강남 | — | OK 51 / UNSUPPORTED_REGION |
| 정보 부산 / 경기 | — | present / null + regionUnsupported |

지역 선택기는 클라이언트 필터라 정책·소스 테스트(§12 #10)로 확인했다(브라우저 수동 확인은 하지 않음).
