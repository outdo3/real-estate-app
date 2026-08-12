# 이집 분양정보 초기 백필 — P2-C2

작성일: 2026-08-12
성격: P2-C에서 구축한 운영 sync 체계(`syncApplyhomeListings`)를 코드 변경 없이 그대로 사용해, 최근 3년 분양 데이터를 6개 batch로 나눠 실제로 적재하고 데이터 품질을 검증

---

## 목적

P2-C까지는 sync 파이프라인 구축과 소량(25건) 테스트만 진행했고, `MAX_SYNC_LIMIT=200` 제약상 대량 백필은 미실행 상태였다. 이번 STEP은 "최근 3년 분양 데이터를 안전하게 초기 적재하고 데이터 품질을 검증하는 것"을 목적으로 한다. P2-D(UI 개발)나 재개발 작업은 포함하지 않는다.

---

## 0. 사전 안전 확인

| 항목 | 결과 |
|---|---|
| git status | clean (untracked `abc.png`만 존재, 미건드림) |
| branch | main |
| origin/main 동기화 | up to date |
| 시작 전 Presale | 25건 |
| 시작 전 PresaleHouseTypeDetail | 142건 |
| `.env`/`.env.local` | 내용 미출력, API 키 미출력. `DATA_GO_KR_API_KEY`/`NEXT_PUBLIC_KAKAO_MAP_API_KEY` 존재만 확인 |

작업 중 `dotenv` 패키지가 콘솔에 `tip: ⌁ auth for agents [www.vestauth.com]` 같은 문구를 출력해 프롬프트 인젝션 의심이 있었으나, `node_modules/dotenv/lib/main.js`의 `TIPS` 배열(무작위 자기 홍보 문구, dotenv 17.4.2 자체 기능)에서 비롯된 것으로 소스 확인 후 판단했다 — 실행 지시로 해석되는 내용이 없어 별도 조치 없이 진행했으며, 이후 스크립트는 `quiet: true`로 억제했다.

---

## 1. 기존 P2-C 구현 재확인

`src/services/cheongyakService.ts`(`syncApplyhomeListings`, `syncHouseTypeDetails`, `geocodeAddress`)와 `src/app/api/admin/presales/sync/route.ts`를 읽고 기존 정책이 그대로 유지되고 있음을 확인했다. 이번 STEP에서 이 두 파일을 수정하지 않았다(§12 참고).

- `RCRIT_PBLANC_DE::GTE/LTE` 서버사이드 날짜 필터 — 유지
- `MAX_SYNC_LIMIT=200` 하드 클램프 — 유지
- `houseManageNo` 기준 Presale upsert, `(houseManageNo, modelNo)` 기준 Detail upsert — 유지
- `minPrice`/`maxPrice`는 Detail의 `topAmount` min/max로 계산, 값이 없으면 손대지 않음 — 유지
- 날짜 normalization(`parseDate`), 아이템 단위 `try/catch` — 유지
- 지오코딩 4단계 fallback + `exact`/`normalized`/`area_only`/`failed` 4분류 — 유지(§2 참고)
- `dryRun` — 유지(DB에 쓰지 않고 `created`/`updated` 예상치만 계산)
- 관리자 수동 sync API(`requireAdmin()` 보호) — 유지, 이번 백필은 이 API를 거치지 않고 서비스 함수를 스크립트로 직접 호출(관리자 로그인 세션 없이도 백필 실행 가능하도록, 기존 `scripts/sync_presales_test.ts`와 동일한 패턴)

---

## 2. 지오코딩 정책 — 완화 없이 그대로 적용

P2-C에서 확정한 정책을 그대로 적용했다(코드 변경 없음).

- `exact`/`normalized` → 좌표 저장
- `area_only` → 좌표 저장 금지(null 유지)
- `failed` → null 유지
- 행정동 중심좌표를 임의로 저장하지 않음

---

## 3. 백필 대상 범위 확정

`presale_backfill_probe.ts`(dryRun + limit=1로 matchCount만 저비용 확인하는 신규 일회성 스크립트)로 실행 시점(2026-08-12) 기준 최근 3년(`fromDate=2023-08-13`, `toDate` 미지정)을 조회했다.

```
matchCount = 1046
```

사전 예상(약 1,046건)과 **정확히 일치**해 전체 백필을 진행했다. 전체 2,843건을 내려받아 필터링하지 않았다 — `cond[RCRIT_PBLANC_DE::GTE]` 서버사이드 필터만 사용했다(1회 API 호출로 확인, `limit=1`이면 내부 페이지네이션 루프가 첫 페이지 조회 직후 종료되는 `syncApplyhomeListings` 구조를 그대로 활용).

---

## 4. 200건 단위 배치 설계

`MAX_SYNC_LIMIT=200`을 넘지 않도록, 3년 구간을 12분기로 나눠 각 분기의 matchCount를 프로브(각 1회 API 호출, 총 12회)한 뒤, 인접한 분기를 합이 200을 넘지 않는 선에서 그리디하게 병합했다.

| 분기 프로브 | matchCount |
|---|---|
| 2023-08-13 ~ 2023-11-11 | 97 |
| 2023-11-12 ~ 2024-02-10 | 91 |
| 2024-02-11 ~ 2024-05-11 | 90 |
| 2024-05-12 ~ 2024-08-10 | 86 |
| 2024-08-11 ~ 2024-11-09 | 99 |
| 2024-11-10 ~ 2025-02-08 | 57 |
| 2025-02-09 ~ 2025-05-10 | 71 |
| 2025-05-11 ~ 2025-08-09 | 90 |
| 2025-08-10 ~ 2025-11-08 | 88 |
| 2025-11-09 ~ 2026-02-07 | 83 |
| 2026-02-08 ~ 2026-05-09 | 111 |
| 2026-05-10 ~ (open) | 83 |

합계 1,046건으로 §3의 전체 matchCount와 정확히 일치(구간 경계에 누락/중복 없음을 사전에 재확인).

병합 결과, 6개 batch로 확정했다(날짜 경계가 서로 인접하며 절대 겹치지 않음):

| Batch | 기간 | 예상 matchCount |
|---|---|---|
| 1 | 2023-08-13 ~ 2024-02-10 | 188 |
| 2 | 2024-02-11 ~ 2024-08-10 | 176 |
| 3 | 2024-08-11 ~ 2025-02-08 | 156 |
| 4 | 2025-02-09 ~ 2025-08-09 | 161 |
| 5 | 2025-08-10 ~ 2026-02-07 | 171 |
| 6 | 2026-02-08 ~ (오늘까지, open-ended) | 194 |

---

## 5. 단계별 실행 결과

`presale_backfill_batch.ts`(신규 일회성 스크립트, `syncApplyhomeListings({ mode: 'initial', fromDate, toDate, limit: 200, dryRun: false })`를 1회 호출)로 batch 1을 먼저 실행하고 DB 상태(중복 없음, 건수 증가분 일치)를 확인한 뒤, 치명적 문제가 없어 batch 2~6을 순차 실행했다. 모든 batch에서 반복 오류나 무결성 문제가 발견되지 않아 중단 없이 완료했다.

| Batch | matchCount | fetched | created | updated | failed | HouseTypeDetail upsert | mdlFailed | exact | normalized | area_only | failed(geo) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 188 | 188 | 188 | 0 | 0 | 969 | 0 | 132 | 0 | 36 | 20 |
| 2 | 176 | 176 | 176 | 0 | 0 | 971 | 0 | 129 | 0 | 27 | 20 |
| 3 | 156 | 156 | 156 | 0 | 0 | 810 | 0 | 106 | 0 | 41 | 9 |
| 4 | 161 | 161 | 161 | 0 | 0 | 706 | 0 | 118 | 3 | 30 | 10 |
| 5 | 171 | 171 | 171 | 0 | 0 | 854 | 0 | 111 | 2 | 34 | 24 |
| 6 | 194 | 194 | 169 | 25 | 0 | 1085 | 0 | 126 | 1 | 41 | 26 |
| **합계** | **1046** | **1046** | **1021** | **25** | **0** | **5395** | **0** | **722** | **6** | **209** | **109** |

- Batch 6에서 `updated=25`가 나온 것은 기존에 있던 25건이 모두 이 batch의 날짜 구간(2026-02-08 이후)에 속했기 때문 — 정확히 기존 25건과 일치해 중복 생성 없이 update로 처리됨을 확인했다.
- 6개 batch 전부 `failed: 0`, `mdlFailedCount: 0` — API 오류/파싱 실패로 인한 반복 재호출이나 중단은 없었다.
- 각 batch의 전체 결과(JSON, 아이템별 상세)는 `scripts/_backfill_results/batch{1..6}.json`에 저장했다(터미널에는 요약만 출력).

---

## 6. API 호출 안전성

무한 retry는 애초에 구현되어 있지 않다(기존 코드 그대로 — 각 fetch는 1회만 시도, 실패 시 해당 아이템만 `failed` 처리하고 다음으로 넘어감). 이번 백필 전체에서 반복 오류가 발생하지 않아 별도 중단 조치가 필요하지 않았다.

실제 API 호출량(추정): Detail 목록 조회 6회(batch당 perPage=50으로 최대 4페이지, 실제로는 matchCount가 200 이하라 필요한 페이지 수만큼만 — 예: 188건이면 4페이지) + Mdl 조회 1,046회(공고당 1회) + 사전 프로브(3년 전체 1회 + 분기 12회) ≈ 1,046건 초기 예상치(약 1,067콜)와 부합하는 규모. 개발계정 신청 가능 트래픽(40,000) 대비 여유가 크다.

---

## 7~10. 데이터 품질 검증

백필 완료 후 Prisma로 전수 검증했다(스크립트는 검증 후 삭제, 쿼리 내용은 아래에 기록).

### A. Presale

| 항목 | 결과 |
|---|---|
| `houseManageNo` 중복 | **0건** |
| `houseName` null/빈값 | **0건** |
| `locationAddress` null/빈값 | **0건** |
| `receiptStartDate > receiptEndDate`(역전) | **0건** |
| `minPrice > maxPrice` | **0건** |
| `moveInExpectedYm` 형식(6자리 숫자) 위반 | **0건** |
| `houseManageNo` null | **0건**(0건 — upsert 키가 없는 항목은 애초에 skip되므로 저장되지 않음) |

### B. PresaleHouseTypeDetail

| 항목 | 결과 |
|---|---|
| `(houseManageNo, modelNo)` 중복 | **0건** |
| orphan row(부모 Presale 없음) | **0건** |

### C. 관계

Presale ↔ PresaleHouseTypeDetail 간 orphan 없음, 전량 정상 FK 연결 확인.

### 가격 데이터

| 항목 | 결과 |
|---|---|
| `minPrice` 존재 | 1,046건(100%) |
| `maxPrice` 존재 | 1,046건(100%) |
| 가격 없는 공고 | 0건 |
| `minPrice > maxPrice` | 0건 |

`LTTOT_TOP_AMOUNT`는 기존 정책대로 "만원" 단위를 그대로 유지했다(임의 단위 변환 없음). 비정상적으로 낮거나 높은 값 후보는 이번 검증에서 발견되지 않았다(별도 삭제/보정 없음).

### 날짜 데이터

접수 시작/종료일 역전 0건, `moveInExpectedYm` 형식 위반 0건. 그 외 논리적 이상 날짜는 발견되지 않았다.

---

## 8. 좌표 품질 통계

| 범주 | 건수 |
|---|---|
| `exact` | 722 |
| `normalized` | 6 |
| `area_only`(저장 안 함) | 209 |
| `failed` | 109 |
| **신뢰 가능한 좌표(exact+normalized, 저장됨)** | **728건 (69.6%)** |
| **null 좌표(area_only+failed)** | **318건 (30.4%)** |

`area_only`는 성공 좌표로 집계하지 않았다(정책대로 저장도 하지 않음).

### null 좌표 상위 주소 패턴(시/도+시/군/구 기준, 상위 6개)

| 주소 앞부분 | null 좌표 건수 |
|---|---|
| 경기도 평택시 | 22 |
| 인천광역시 서구 | 22 |
| 경기도 부천시 | 13 |
| 경기도 남양주시 | 11 |
| 경기도 의왕시 | 11 |
| 경기도 성남시 | 10 |

특이사항: batch 1 실행 로그에서 "인천광역시 서구" 주소 다수가 Kakao 지오코딩 결과로 "인천 검단구"/"인천 서해구"를 반환해 지역 불일치로 거부되는 패턴을 관측했다. 청약 공고 당시(구) 행정구역명("서구")과 Kakao 최신 지오코더가 반환하는 (신설/변경된) 행정구역명이 달라 생기는 것으로 추정된다 — 정확도 우선 원칙상 의도된 보수적 거부이며, 잘못된 좌표를 저장하는 것보다 안전하다. 이번 STEP에서 억지로 해결하지 않는다(§15 범위 외).

**최종 검수 결정(2026-08-12)**: 이 현상은 이번 STEP에서 데이터 결함으로 간주하지 않는다. `area_only`/`failed`로 분류된 건에 좌표를 임의로 저장하지 않는 원칙을 그대로 유지한다. "행정구역 변경/별칭 기반 지오코딩 보정"은 향후 별도 STEP의 후보 과제로 남긴다(이번 STEP에서는 구현하지 않음).

---

## 11. idempotency 최종 검증

전체 3년 백필을 반복하지 않고, 이미 처리한 구간의 일부(2023-08-13~2023-09-13, matchCount 26)만 재동기화했다.

| 항목 | 결과 |
|---|---|
| 재동기화 `created` | 0 |
| 재동기화 `updated` | 26 |
| 재동기화 후 전체 Presale 건수 | 1,046 (변화 없음) |
| 재동기화 후 전체 Detail 건수 | 5,395 (변화 없음) |
| Presale 중복 | 0건 |
| Detail 중복 | 0건 |

`houseManageNo`/`(houseManageNo, modelNo)` 기준 upsert가 반복 실행에서도 안전함을 재확인했다.

---

## 12. 코드 변경 원칙 준수

백필 과정에서 데이터 무결성을 깨는 결함은 발견되지 않았다. 따라서 `src/services/cheongyakService.ts`, `src/app/api/admin/presales/sync/route.ts` 등 기존 서비스 코드는 **전혀 수정하지 않았다**.

신규로 추가한 것은 이번 백필 실행/검증 전용 일회성 스크립트 2개뿐이다(기존 `scripts/sync_presales_test.ts`, `scripts/reverify_presale_geocode.ts`와 같은 성격 — 운영 로직이 아니라 도구):

- `scripts/presale_backfill_probe.ts` — 지정 날짜 구간의 matchCount만 저비용(dryRun + limit=1)으로 확인. 사용법: `npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js scripts/presale_backfill_probe.ts <fromDate> [toDate]`
- `scripts/presale_backfill_batch.ts` — 지정 날짜 구간을 실제로 백필(1회 batch 실행), 결과 요약 출력 + 전체 JSON을 `scripts/_backfill_results/`에 저장. 사용법: `npx ts-node --compiler-options '{"module":"commonjs"}' -r ./scripts/_register-paths.js scripts/presale_backfill_batch.ts <label> <fromDate> [toDate] [dryRun]`

두 스크립트 모두 기존 `syncApplyhomeListings()`를 그대로 호출할 뿐, 내부 로직을 변경하지 않았다. 향후 재현(예: 특정 구간 재백필, 장애 후 재실행) 또는 운영 점검(matchCount 사전 확인)에 재사용 가능하도록 유지/commit한다. 결과 JSON(`scripts/_backfill_results/`)은 일회성 검증 산출물로 취급해 Git에는 포함하지 않는다(`.gitignore` 처리, 로컬에는 보존).

---

## 최종 데이터 기반 (P2-D에서 사용할 것)

- `Presale`: **1,046건**(최근 3년, 2023-08-13~2026-08-12 모집공고일 기준)
- `PresaleHouseTypeDetail`: **5,395건**
- 좌표 신뢰 가능(exact+normalized): **728건(69.6%)**, null: 318건(30.4%, 잘못된 좌표보다 안전한 미확보 상태)
- 가격 정보(minPrice/maxPrice): **100% 확보**(1,046/1,046)
- 중복/orphan/날짜역전/가격역전: 전부 0건

---

## 향후 증분 sync 정책

P2-C에서 확정한 정책(`mode: 'incremental'`, 기본 최근 90일, 관리자 수동 트리거)을 그대로 유지한다. 이번 백필로 최근 3년치 과거 데이터가 채워졌으므로, 이후로는 최근 90일 증분 동기화만으로 신규/진행중 공고를 놓치지 않고 커버할 수 있다(§C, `docs/development/05-presale-sync-operations.md` 참고). cron/자동 스케줄러는 이번에도 구현하지 않았다(§15 금지 항목).

---

## 다음 STEP

P2-D(UI 개발)는 이번 STEP 범위 밖이며, 검수 승인 후 별도로 시작한다.

---

## 최종 검수 승인 (2026-08-12)

PRESALE P2-C2(최근 3년 초기 백필)를 최종 승인한다.

| 항목 | 결과 |
|---|---|
| 백필 기간 | 2023-08-13 ~ 2026-08-12 |
| 대상 공고 | 1,046건 |
| Presale 최종 | 1,046건 |
| PresaleHouseTypeDetail 최종 | 5,395건 |
| Presale 중복 | 0 |
| HouseTypeDetail 중복 | 0 |
| 가격 확보율 | 100%(1,046/1,046) |
| 날짜 이상 | 0 |
| API 실패 | 0 |
| Mdl 실패 | 0 |
| 지오코딩 exact | 722 |
| 지오코딩 normalized | 6 |
| 지오코딩 area_only(미저장) | 209 |
| 지오코딩 failed(미저장) | 109 |
| 신뢰 가능한 좌표 | 728건(69.6%) |
| null 좌표 | 318건(30.4%) |

`area_only`/`failed`(합계 318건)는 이번 STEP에서 억지로 해결하지 않았음을 기록한다 — "좌표 없음보다 잘못된 좌표가 더 위험하다"는 P2-C 원칙을 그대로 유지했다.

행정구역 개편(인천 서구→검단구 등)으로 인한 지역 불일치는 데이터 결함이 아니라 별도 후보 과제로 분류했다(§8 참고).

`scripts/_backfill_results/`의 batch 원본 JSON은 Git에 commit하지 않고 `.gitignore` 처리했다(로컬에는 보존, 삭제하지 않음). `scripts/presale_backfill_probe.ts`/`scripts/presale_backfill_batch.ts`는 향후 재현/운영 점검용으로 유지·commit한다.

P2-D(UI 개발), 재개발 연동, cron/Vercel Cron, 행정구역 보정 구현, MASTER DB 작업은 이번 승인에 포함되지 않으며 착수하지 않는다.
