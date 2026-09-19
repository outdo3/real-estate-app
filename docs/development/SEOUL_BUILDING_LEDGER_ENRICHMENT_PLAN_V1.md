# E-JIP SEOUL BUILDING LEDGER ENRICHMENT PLAN V1

서울 ApartmentMaster 6,843건에 건축물대장(BldRgstHubService) 기본정보를 채울 수 있는지를 **지역 일반화 + dry-run**으로 확인했다.
Production write 0 · schema 0 · enable 0 · 매매 sync 변경 0 · `105c9ab` push 보류 유지.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `105c9ab`(로컬, origin보다 1 앞섬)
- 판정: **READY_FOR_ENRICHMENT_SCRIPT** — 단, apply는 별도 승인 STEP. 부산 paging 문제는 별도 STEP 권고(§8)

## 1. 기준선 (read-only)

| | 서울(11) | 부산(26) |
|---|---|---|
| master | 6,843 | — |
| 세대수·동수·주차·용적률·건폐율·도로명·지번주소·mgmPk·사용승인일 | 전부 0 | 3,181 · 1,379 · 2,417 · 2,514 · 2,521 · 2,624 · 2,624 · 2,626 · 622 |
| basicSpecSource | UNKNOWN 6,843 | GENERAL 994 · TITLE 1,720 · UNKNOWN 724 |

부산 enrichment 지문 `dd9810bbb6d378066dea39a2a6ef68c8`(max updated 2026-09-11T11:51:36.073Z) — 작업 전·dry-run 후·Busan 동등성 실행 후 모두 같음.

## 2. 부산 스크립트 감사 (`scripts/backfill-apartment-master-basic-data.ts`)

| 항목 | 기존 |
|---|---|
| 지역 | `sggCd startsWith '26'` 하드코딩, 샘플 aptSeq 부산 전용, 체크포인트 공용 |
| 조회 키 | sigunguCd=sggCd(5) · bjdongCd=umdCd(5) · platGbCd=0 · bun/ji 4자리 — 블록·산 지번은 조회 안 됨(not_found) |
| endpoint | `getBrRecapTitleInfo`(총괄표제부) → 없으면 `getBrTitleInfo`(표제부) |
| paging | `numOfRows=5`, `pageNo` 없음, totalCount 미확인 |
| 총괄 다건 | 세대수 최대 레코드 자동 선택 |
| 필지 확인 | 없음(응답 레코드의 필지를 조회 키와 비교하지 않음) |
| 표제부 fallback | 1건일 때만, `dongNm`이 "103동"류면 REVIEW |
| 재시도 · 속도 | 3회, 1500ms 전역 직렬 큐 |
| 쓰기 | `update()` FILL_NULL만 + basicSpecSource, prod 가드 없음, roadAddress 미추출 |

## 3. 변경

| 파일 | 내용 |
|---|---|
| `scripts/backfill-basic-data-logic.ts` | 순수 판정 추가: `regionConfig`, `LENIENT/STRICT_POLICY`, `ledgerPageParams`, `recordMatchesLot`, `decideGeneralTitle`, `extractGeneralFields`, `decideTitleFallback`, `crossCheckGeneralVsTitle`, `countMainBuildings`, `pickSeoulSample` |
| `scripts/backfill-apartment-master-basic-data.ts` | `--region`(기본 26), `--sample-size`, `--cross-check`, `--district`. 부산 = LENIENT(기존 그대로), 서울 = STRICT dry-run 전용(`--apply` 거부, exit 2). 서울은 `assertProductionDbAccessAllowed('DIAGNOSTIC')`, 산출물 `tmp/seoul-ledger-enrichment/` |
| `scripts/seoul-ledger-enrichment-logic.test.mjs` (신규) | 요구 1~10 + 표본·paging·주건축물 13개 |

사용법:

```
ALLOW_PROD_DB_READ=1 npx tsx scripts/backfill-apartment-master-basic-data.ts --region=11 --sample [--sample-size=240] [--cross-check]
ALLOW_PROD_DB_READ=1 npx tsx scripts/backfill-apartment-master-basic-data.ts --region=11 --district=11680 [--cross-check]   # 구 단위(재개 단위)
```

## 4. STRICT 매칭 규칙 (서울)

- 조회: 필지 키(sggCd+umdCd+bun+ji, platGbCd=0) + **`numOfRows=100&pageNo=1`** + totalCount 확인
- EXACT: 응답 **1건** + 레코드의 sigunguCd·bjdongCd·platGbCd·bun·ji가 조회 키와 **모두 같음**(EXACT_LOT). mgmBldrgstPk는 그 레코드 값
- 총괄표제부 2건 이상 → **MULTIPLE**(대표값 선택 안 함)
- 총괄 없음 → 표제부: 1건 + 필지 일치 + 동번호 단위 아님 → EXACT(TITLE), 2건 이상 → MULTIPLE, 동번호 단위 → REVIEW
- 잘린 응답(totalCount > 받은 건수) → REVIEW(`*_INCOMPLETE`), 필지 불일치 → REVIEW(`*_LOT_MISMATCH`), 지번 해석 불가 → REVIEW(`JIBUN_UNPARSEABLE`)
- `--cross-check`: 총괄 성공 시 같은 필지 표제부가 **완전한 단일 레코드**면 세대수 비교, 다르면 CONFLICT(병합 안 함)
- 이름·유사도·근접·첫 건·부분 문자열 판정 없음(`bldNm`은 판정에 쓰지 않음)
- 필드: 기존 스키마 필드만 — totalHouseholds, mainBuildingCount, parkingCount, floorAreaRatio, buildingCoverageRatio, parkingPerHousehold(계산), useApprovalDate, mgmBldrgstPk, roadAddress(newPlatPlc), jibunAddress(platPlc), basicSpecSource. FILL_NULL만. **스키마 변경 불필요**

## 5. 발견: `pageNo` 없으면 `numOfRows`가 무시된다

실측(2026-09-19, 청구아파트 삼성동 78-4 표제부, totalCount 4):

| 파라미터 | 응답 numOfRows | item |
|---|---|---|
| `numOfRows=100` / `numOfRows=5` | 1 | 1 |
| `numOfRows=10&pageNo=1` | 10 | 4 |

첫 6건 시험에서 이것 때문에 교차 확인이 잘린 1건과 비교해 CONFLICT 3건을 냈다. 그 뒤 STRICT에 `pageNo=1`을 붙이고, 비교는 완전한 단일 레코드일 때만 하도록 고쳤다(재실행 CONFLICT 0). 부산 URL은 바꾸지 않았다(§8).

## 6. 서울 표본 dry-run 결과 (240건, `--cross-check`)

표본: 강남 11680 · 송파 11710 · 노원 11350 · 중구 11140 · 강동 11740 · 서초 11650, 구마다 40건(구축 <2005 20 + 신축 ≥2005 20), aptSeq 순 균등 간격(결정적).

| 상태 | 건수 | 비율 |
|---|---|---|
| EXACT | 216 | 90.0% |
| MULTIPLE | 15 | 6.3% |
| NO_MATCH | 1 | 0.4% |
| REVIEW_REQUIRED | 8 | 3.3% |
| FAILED | 0 | — |

- EXACT 출처: 총괄표제부 89(37.1%) + **표제부 fallback 127(+52.9%p)**. 총괄만이면 약 37%, fallback 포함 90%
- 총괄 vs 표제부 CONFLICT 0
- MULTIPLE 15 = 총괄 다건 3 · 표제부 다건 12. 표제부 다건 12 중 8건은 **주건축물 1 + 부속건축물(경비실 등)**. 규칙 완화 후보지만 이번 버전은 보류
- REVIEW 8 = 전부 "표제부 1건이지만 dongNm이 동번호"(기존 안전조건)
- NO_MATCH 1 = 11140-1012 한진해모로(845) — 총괄·표제부 모두 0건(이전 STEP의 구 오분류 행)
- 구별 EXACT: 강남 35/40 · 송파 38 · 노원 36 · 중구 34 · 강동 37 · 서초 36. 구축 106/120 · 신축 110/120
- 필드 채움(240 중): 세대수 215 · 주차 197 · 용적률 195 · 건폐율 195 · 세대당주차 196 · 도로명 206 · 지번주소 216 · 동수 89 · mgmPk 89 · 사용승인일 62. 동수·mgmPk는 총괄표제부에만 있음(부산과 같은 구조), 사용승인일은 총괄 원문이 비어 있는 경우가 많음
- 대단지 후보(세대수 확인된 EXACT 215 중): ≥500 **38**, ≥1000 **18**(헬리오시티 9,510 · 남산타운 5,150 · 고덕그라시움 4,932 · 래미안원베일리 2,990 등). 대단지 기능 enable은 하지 않음

## 7. Quota · 전체 실행 계획

- 측정: 240행 477호출(1.99/행, cross-check 포함), 718.9초. 마지막 관측 `x-ratelimit-remaining` 9,740(표제부 오퍼레이션 — 오퍼레이션별 한도)
- 전체 6,843행 예상: 총괄 6,843 + 표제부 약 6,800 ≈ **13,600호출, 약 5.7시간**(1500ms 큐). cross-check 없이 약 11,000호출
- 라이브 `/api/apt/[name]/info`가 같은 키·같은 오퍼레이션을 쓰므로 하루 한 번에 돌리지 않는다 → **이번 STEP에서 전체 dry-run은 하지 않음**
- 재개 설계: 구 단위 `--district=11xxx` 실행 → `tmp/seoul-ledger-enrichment/district-<구>/`에 구별 산출물. 하루 2일 이상으로 나눠 25구 순차, 끝난 구는 폴더 존재로 건너뜀. 향후 apply는 구별 `exact-matches.json` 계획을 입력으로 받는 별도 승인 STEP

## 8. 부산 영향 (보고만, 변경 없음)

부산 스크립트는 `pageNo` 없이 조회해 **항상 첫 레코드 1건만** 봤다. 그래서 "표제부 1건일 때만" 안전조건이 실제로는 걸러내지 못했다.

- 동등성 실행(HEAD 스크립트 vs 새 스크립트, 부산 6 aptSeq dry-run): 출력 **완전히 동일**. 26380-100은 표제부 2건인데 여전히 "1건 정확 매칭"으로 나옴 — 기존 동작 재현
- 부산 TITLE 출처 50건 표본(md5 순) 재조회(`pageNo=1`): **totalCount>1 = 8건(16%)**, 주건축물 2개 이상 7건, 저장된 세대수 ≠ 주건축물 합 5건(예: 26350-15 저장 90 vs 14개 동 합 1,076)
- 총괄 출처 30건: totalCount>1 1건(26200-116, 두 레코드 세대수 0)
- 1,720건 중 비슷한 비율이면 수백 건 규모. 어느 레코드 값이 실제로 쓰였는지(첫 레코드 순서가 호출마다 같은지)는 별도 감사 필요
- 라이브 `src/lib/apt-building-info.ts`(`/api/apt/[name]/info`)도 `numOfRows=5`, `pageNo` 없음 — 같은 영향 가능
- 이번 STEP 범위 밖(부산 동작 변경·Production 쓰기 금지) → **별도 STEP 권고**: 부산 TITLE/GENERAL 출처 전수 재조회 audit → 영향 행 확정 → 정정 계획(승인 후)

산출물: `tmp/seoul-ledger-enrichment/busan-paging-impact.json`(TITLE 50), `busan-paging-impact-general30.json`(총괄 30 + TITLE 6)

## 9. 산출물 (`tmp/seoul-ledger-enrichment/`)

summary.json · sample-results.json · exact-matches.json · multiple-matches.json · no-match.json · review-required.json · field-coverage.json · quota-plan.json · run-*.log

## 10. 검증

- 테스트: `scripts/seoul-ledger-enrichment-logic.test.mjs` + `backfill-basic-data-logic.test.mjs` 포함 scripts 테스트 249/249 PASS(node 84, tsx 165)
- 게이트 실행: `--region=11 --apply` → BLOCKED exit 2 · `--region=41` 거부 · `--district=26110` 거부 · `ALLOW_PROD_DB_READ` 없이 prod 가드 중단
- eslint 0 · tsc = 기존 scripts/·tmp/ 오류 25건만(FAIL_EXISTING_SCRIPT_ERRORS, 변경 파일 0) · `npm run build` PASS
- 사후 read-only: 서울 enrichment 필드 전부 0 유지, 부산 지문 불변

## 11. 다음 STEP

1. (승인 필요) 서울 enrichment 구 단위 전체 dry-run → apply 설계(EXACT만, FILL_NULL, basicSpecSource)
2. (권고) 부산 ledger paging 영향 audit — 영향 행 확정 후 정정 계획
3. (선택) 표제부 "주건축물 1 + 부속건축물" 규칙 검토(표본 8/240)
4. 라이브 `apt-building-info.ts`의 paging 검토(별도 STEP)
