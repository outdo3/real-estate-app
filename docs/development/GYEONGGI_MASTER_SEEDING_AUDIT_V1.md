# E-JIP GYEONGGI MASTER SEEDING AUDIT V1

경기 첫 배치 8구(매매 539,443행 적재 완료)의 `ApartmentMaster` + 좌표 seed 가능성 READ-ONLY 감사.

- 날짜: 2026-09-25 (KST) · 기준 커밋 `f84bec8`(HEAD = origin/main)
- Production write 0 · migration 0 · MOLIT 호출 0 · 공개 노출/cron 변경 0
- 산출: `scripts/national-backfill/gyeonggi-master-seed-logic.ts`(순수 판정, 실행기 없음) · `...-logic.test.ts`(14개)

## 판정

**PARTIAL → `GYEONGGI_MASTER_SEEDING = READY_FOR_DRY_RUN`**

- identity·원천·schema·좌표 경로는 준비됨: 1,324 aptSeq 전부 identity 깨끗, 기존 master 0, schema 변경 불필요.
- **apply는 막혀 있음**: 지금 코드에서는 경기 master가 생기는 순간 검색·지도·상세·단지 리포트에 경기 단지가 공개된다(§7). 공개 노출 차단(`app` 축 allowlist)이 먼저다. seed 게이트에 `PUBLIC_EXPOSURE_NOT_GUARDED`로 고정했다.

## 1. 기존 master 파이프라인

| 경로 | 상태 | 비고 |
|---|---|---|
| `seed-seoul-apartment-master(-logic).ts` | **검증됨**(서울 6,843 적재) | MOLIT 매매 aptSeq identity + Kakao 주소검색 필지 단일 일치 + 역지오코딩 필지 일치. create-only. **서울 하드코딩**: `SEOUL_CODES`, `addressQuery`='서울 …', `matchExactLot`/`verifyReverseLot`의 region_1depth '서울', `sido` 상수, rollback SQL `sgg_cd LIKE '11%'` |
| `apartment_master_seed.ts`(부산 M3/M4) | **사용 금지** | 1쪽만 읽음, 오류=빈 결과, 전역 좌표 dedupe, 키워드 첫 결과 좌표, upsert (SEOUL_MASTER_SEED_SCRIPT_V1 §1) |
| AptBasisInfoServiceV5 | **seed 원천 불가** | `kaptCode` 전용. 이번 probe: `kaptCode=41111-41`(aptSeq) → HTTP 200, item 전 필드 null. 좌표 필드 없음(기존 감사). kaptCode 목록 서비스 AptListService4 operation 미해결 |
| 건축물대장 BldRgstHubService | 후속 enrichment | seed 범위 밖 |
| 지도 좌표 | master 전용 | `/api/transactions` → `getMasterCoords(sggCd)` → `resolveApartmentCoords` |

Canonical identity: `aptSeq`(앞 5자리 = 구). 이름·지번·좌표로 합치거나 생성하지 않는다.

## 2. aptSeq inventory (cached raw + Production READ ONLY)

| 구 | lawdCd | 거래행 | aptSeq | 이름(DB distinct) | 최초~최근 | 기존 master | 누락 | 24개월 Tier A | 과거 전용 |
|---|---|---|---|---|---|---|---|---|---|
| 수원 장안구 | 41111 | 68,862 | 170 | 160 | 2006-01-02~2026-09-23 | 0 | 170 | 155 | 15 |
| 수원 권선구 | 41113 | 79,047 | 220 | 216 | 2006-01-02~2026-09-23 | 0 | 220 | 196 | 24 |
| 수원 팔달구 | 41115 | 38,932 | 134 | 129 | 2006-01-02~2026-09-23 | 0 | 134 | 116 | 18 |
| 수원 영통구 | 41117 | 111,466 | 149 | 146 | 2005-07-26~2026-09-23 | 0 | 149 | 148 | 1 |
| 성남 수정구 | 41131 | 19,268 | 108 | 108 | 2005-10-05~2026-09-23 | 0 | 108 | 92 | 16 |
| 성남 중원구 | 41133 | 28,900 | 109 | 106 | 2005-10-03~2026-09-22 | 0 | 109 | 93 | 16 |
| 의정부시 | 41150 | 115,675 | 313 | 307 | 2005-08-23~2026-09-23 | 0 | 313 | 289 | 24 |
| 광명시 | 41210 | 77,293 | 121 | 119 | 2006-01-01~2026-09-21 | 0 | 121 | 104 | 17 |
| **합계** | 8 | **539,443** | **1,324** | | | **0** | **1,324** | **1,193** | **131** |

- 원천 aptSeq 집합 = DB aptSeq 집합(1,324 = 1,324, 차이 0). aptSeq null 0, prefix 불일치 0, 다른 구 응답 오기재 0, 중복 0.
- 20년 이력에서도 aptSeq별 이름·법정동코드·지번·건축년도 변형 0(MOLIT가 현재 표기로 응답). 지번 해석 불가 0.
- 같은 필지 공유: 34그룹/75 aptSeq (Tier A끼리 26그룹/58, 과거+현재 혼합 5그룹).
- Production: master 서울 6,843 · 부산 3,438 · 경기 0. legacy `apartments` 경기 0. 41135 거래 0.

## 3. 원천 커버리지

MOLIT 매매 raw(이미 캐시된 전체 이력)로 identity 확정 가능: **1,324/1,324 (100%)**, unresolved 0, invalid 0, ambiguous 0, 공식 중복 0.
AptBasisInfoServiceV5로 aptSeq 직접 해석: **0% (불가)**.
단지 폐지/개명: 과거 전용 131(9.9%)은 재건축 등으로 필지에 다른 단지가 선 경우가 있음(probe: 권선주공2 필지 → "수원시청역 SK VIEW", 화서주공 필지 → "화서역 블루밍푸른숲"). 서울 정책(`SEOUL_HISTORICAL_MASTER_MISSING_STRATEGY_V1` §9)대로 **만들지 않는다**.

## 4. 좌표

- 원천: 공식 원천 좌표 없음 → Kakao 주소 검색(`analyze_type=exact`, KA/Origin 헤더) + 역지오코딩, 서울과 같은 양방향 필지 일치.
- 경기 차이: Kakao `region_2depth_name`이 일반구는 **"수원시 장안구"**, 단일 시는 "의정부시" → registry `fullName`에서 '경기도 '를 뗀 값과 정확히 같음(probe 16/16 형태 확인).
- Probe(구별 Tier A 최다 거래 1 + 가장 오래된 과거 단지 1): Tier A **8/8 VERIFIED**, 과거 6/8(건우 태평동 50-1 NO_MATCH, 오성이큐빌 가능동 15-7 → 역조회 15-358 REVERSE_MISMATCH).
- **EXPECTED_GEOCODE_RATE ≈ 98% (Tier A)** — 근거: 서울 Tier A 실적 6,726/6,843(98.3%) + 경기 probe 8/8. 확정값은 dry-run에서만 나온다.
- **EXPECTED_MISSING_COORDS ≈ 20~25 / 1,193** (추정). 미확보는 lat/lng null + `geocodeQuality='failed'`.
- 이름 기반 geocode·다른 단지 좌표 차용·동 대표점·다른 시군구 결과는 모두 거부(테스트 5·7).

## 5. Schema 적합성

**NO_SCHEMA_CHANGE_REQUIRED.** seed 필드(aptSeq·name·normalizedName·sido·sigungu·sggCd·umdName·umdCd·jibun·buildYear·latitude·longitude·geocodeQuality) 모두 기존 컬럼, nullable 적합(테스트 12가 schema 파일로 고정).
결정 필요(설계값): `sido='경기'`(registry shortName, 부산·서울과 같은 규칙), `sigungu='수원시 장안구'`(Kakao·registry fullName 형태). 부산·서울은 구 이름만 쓰지만 경기 일반구는 "장안구"만으로는 시가 빠진다.

## 6. 지역 가정 audit — 경기 master가 생기면

| 표면 | 파일 | 현재 게이트 | 누출 |
|---|---|---|---|
| 검색(단지·지역) | `src/app/api/search/route.ts:61-62` | 서울 deny-list(`seoulPublicBlockedLawdCds`) | **YES** |
| 검색 Kakao alias fallback | `src/lib/search-alias-fallback.ts:118` | `isSeoulPublicBlocked`(서울만) | **YES** |
| 지도 마커 | `src/app/api/transactions/route.ts:213` + `src/lib/master-coords-cache.ts:35` | 없음 | **YES**(라이브 MOLIT 경기 거래에 좌표가 붙음) |
| 단지 상세 metadata | `src/app/apt/[name]/page.tsx:22-52` | `decideSeoulSeo` → 경기 `NONE` | **YES**(색인 가능) |
| 단지 리포트 `/report/apt/[aptSeq]` | `page.tsx:25-39` | 서울만 | **YES**(self-canonical, 색인 가능) |
| `/report/compare`, `/stats/compare` | | 없음 / 서울만 | YES |
| 분양·학교 주변 단지 | `src/lib/nearby-apartments.ts:44` | 없음(의도적) | YES |
| E-JIP Score | `score/route.ts`, peer-context | 없음, 라벨 부산 고정(`region-label.ts:25`) | YES/오표기 위험 |
| 지역·일간 리포트, sitemap, stats API, cron | Busan allowlist / `stats` 축 / scope allowlist | 닫힘 | NO |

근본 원인: 소비자가 "`getRegionEnablement(lawdCd).app`이 열렸나?"(allowlist)가 아니라 "차단된 서울인가?"(deny-list)를 묻는다. `isSeoulPublicBlocked`는 서울 외에는 항상 false(`src/lib/region/enablement.ts:143-150`). 부수 발견(미검증): `/api/transactions`에 서울 차단 게이트가 없다 — 차단 서울 구 마커 노출 여부는 별도 확인 필요.

## 7. Identity 안전 규칙 (logic 모듈에 고정)

aptSeq 없음 → 후보 아님 · prefix ≠ 요청 구/sggCd 충돌 → REVIEW(자동 수정 없음) · 이웃 구 표기 불일치 → REVIEW · 원천 내 지번/법정동 충돌 → REVIEW · 첫 배치 밖 prefix → OUT_OF_TARGET · 41135 → EXCLUDED_DISTRICT · 기존 master → EXISTING_SKIPPED · 24개월 매매 없음 → HISTORICAL_EXCLUDED.

## 8. 행정코드

- 첫 8구(수원 4 일반구·성남 2 일반구·의정부·광명)는 전 기간 코드 연속, 영향 없음(원천=DB parity로 확인).
- 확장 전 확인 필요(이번 범위 밖, 미검증): 부천 41190(일반구 재도입 여부 — registry는 leaf로 둠), 화성 41590(일반구 신설 여부), REGCODE_PROXY 일반구 자식 누락. 구 코드→신 코드 전환 시 aptSeq prefix와 lawdCd가 달라질 수 있으므로 "prefix 자동 수정 금지" 규칙이 그대로 REVIEW로 보낸다.

## 9. 호출 비용

| 항목 | 호출 | 제공자 |
|---|---|---|
| MASTER_SOURCE_CALLS | **0** (캐시된 매매 raw 재사용, K-apt 불가) | MOLIT/data.go.kr |
| GEOCODE_CALLS | **≤ 2,386** (Tier A 1,193 × 정방향 1 + 역방향 ≤1) | Kakao Local (MOLIT 한도와 별개) |
| TOTAL_ESTIMATE | **≤ 2,386** | |

이번 STEP 실제 호출: Kakao 48(첫 probe 16 + 진단 1은 KA 헤더 누락으로 401 — 내 probe 결함, 제품 문제 아님; 재실행 정방향 16 + 역방향 15) · K-apt V5 1 · MOLIT 0 · DB READ ONLY.

## 10. Seeding 설계 (미실행)

실행기(다음 STEP)는 서울 실행기 구조를 따르고 판정은 `gyeonggi-master-seed-logic.ts`를 쓴다.
- 원천: `tmp/national-backfill/districts/<구>/raw`(0 MOLIT). 구 단위 checkpoint(PENDING→VALIDATED→COORDINATED→READY), Kakao 429 2회 후 RATE_LIMITED 중단·재개.
- 버킷: READY · GEOCODE_MISSING(좌표 null로 적재) · REVIEW · UNRESOLVED(ERROR/RATE_LIMITED) · APPLIED. 산출물 `tmp/gyeonggi-master-seed/`.
- create-only(`apartmentMaster.create` 단일 경로, P2002 → SKIP), 기존 aptSeq 재조회 후 SKIP.
- apply 게이트: `--apply` · `ALLOW_PROD_DB_WRITE=1` · `--district` 명시(첫 배치만, 41135 거부) · `--expect-inserts` · `--expect-plan-hash` · 좌표 생략 금지 · **공개 노출 차단 검증**.
- rollback artifact: id 목록 + `sgg_cd = ANY(8구)` + batch 시각 3중 조건 DELETE 템플릿(미실행).
- 공개 분리: seed는 enablement·검색·지도·sitemap·SEO·cron 어느 것도 켜지 않는다. 경기 노출은 별도 STEP·별도 승인.

## 11. 테스트 / 빌드

```
npx tsx --test scripts/national-backfill/gyeonggi-master-seed-logic.test.ts        pass 14 fail 0
npx tsx --test orchestrator.test.ts seed-seoul-apartment-master.test.ts seoul-master-seed-plan-logic.test.ts   pass 77 fail 0
npx eslint (신규 2파일)                                                              exit 0
npx tsc --noEmit                                                                     exit 2 — 27건 전부 기존 scripts/·tmp/, 신규 0 → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                                        exit 0
```

## 12. 구별 준비 표

| 구 | lawdCd | aptSeq | 원천 exact | unresolved | seed 대상(Tier A) | 예상 좌표 | 위험 | Seeding Ready |
|---|---|---|---|---|---|---|---|---|
| 수원 장안구 | 41111 | 170 | 170 | 0 | 155 | ~98% | LOW | DRY_RUN_READY |
| 수원 권선구 | 41113 | 220 | 220 | 0 | 196 | ~98% | LOW | DRY_RUN_READY |
| 수원 팔달구 | 41115 | 134 | 134 | 0 | 116 | ~98% | LOW | DRY_RUN_READY |
| 수원 영통구 | 41117 | 149 | 149 | 0 | 148 | ~98% | MEDIUM(같은 필지 공유 25 aptSeq) | DRY_RUN_READY |
| 성남 수정구 | 41131 | 108 | 108 | 0 | 92 | ~98% | LOW | DRY_RUN_READY |
| 성남 중원구 | 41133 | 109 | 109 | 0 | 93 | ~98% | LOW | DRY_RUN_READY |
| 의정부시 | 41150 | 313 | 313 | 0 | 289 | ~98% | MEDIUM(같은 필지 공유 22) | DRY_RUN_READY |
| 광명시 | 41210 | 121 | 121 | 0 | 104 | ~98% | LOW | DRY_RUN_READY |
| 성남 분당구 | 41135 | — | — | — | 0 | — | REVIEW 유지 | EXCLUDED |

전 구 공통 apply 차단: `PUBLIC_EXPOSURE_NOT_GUARDED`.

## 13. 다음 STEP

1. **GYEONGGI_PUBLIC_EXPOSURE_GUARD** (seed apply 선결, 사용자 승인 필요 — 검색·지도·상세·리포트 동작 변경): §6 소비자를 `app` 축 allowlist로 전환, 부산·서울 8구 회귀 0 실측.
2. GYEONGGI_MASTER_SEED_DRY_RUN: 실행기 작성 + 8구 dry-run(Kakao ≤2,386, write 0) → 확정 좌표율·plan hash.
3. apply 파일럿(승인 후): 41131 성남 수정구 Tier A 92.
