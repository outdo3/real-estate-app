# E-JIP SEOUL SALE FULL-HISTORY MEASUREMENT COMPLETION V1

`SEOUL_SALE_BACKFILL_PLAN_V1`이 quota 예약분 때문에 남겨 둔 **7개 구**의 full-history 실측을 끝내고, 서울 25개 구 전체를 **projection 없이 실측값**으로 확정한다.

- 날짜: 2026-09-20 (KST) · 기준 커밋 `dfd9aa0`
- 측정 시각: 10:45~11:10 KST (`2026-09-20T01:45~02:10Z`)
- 도구: 기존 `scripts/audit-seoul-sale-backfill-plan.ts`(fetch/status/report) 재사용 + 이번 STEP의 read-only helper 2개
- **Production write 0** · schema 0 · migration 0 · 서울 sale apply 0 · false-cancel repair 0 · Defect B repair 0 · 서울 stats/cronSync/SEO enable 0

## 판정

**PASS — 서울 25/25 구 full-history 측정 완료. 전체 1,440,126행, 비COMPLETE 셀 0.**

apply는 여전히 **BLOCKED_FOR_APPLY**(`DEFECT_A_GATE_PASS` 미설정). 이번 STEP은 측정만 했다.

---

## 1. 이번에 측정한 7개 구

구 코드는 registry(`getMolitLeafRegions('11')`, 25개)에서 가져왔다 — 하드코딩 추정 없음. 스크립트의 `FETCH_ORDER` 25개와 **완전 일치**(registry mismatch 0).

| 구 | lawdCd | 원천 행 | 기존 projection | 오차 | 셀 | 비COMPLETE | multipage | calls | quota after |
|---|---|---|---|---|---|---|---|---|---|
| 강서구(잔여) | 11500 | **85,982** | 85,405 | +0.7% | 252 | **0** | 3 | 102 | 9,665 |
| 구로구 | 11530 | **74,721** | 72,855 | +2.6% | 251 | **0** | 1 | 252 | 9,413 |
| 금천구 | 11545 | **25,106** | 20,799 | **+20.7%** | 253 | **0** | 0 | 253 | 9,160 |
| 영등포구 | 11560 | **63,680** | 73,634 | **−13.5%** | 252 | **0** | 0 | 252 | 8,908 |
| 동작구 | 11590 | **53,748** | 63,097 | **−14.8%** | 251 | **0** | 0 | 251 | 8,657 |
| 관악구 | 11620 | **46,842** | 44,607 | +5.0% | 252 | **0** | 0 | 252 | 8,405 |
| 서초구 | 11650 | **64,189** | 53,013 | **+21.1%** | 249 | **0** | 0 | 249 | 8,156 |

- 강서구는 기존 checkpoint(152셀)에서 이어받았고, **이미 COMPLETE인 셀은 한 번도 재호출하지 않았다**.
- **projection 경고**: 합계는 우연히 정확했지만(예상 ≈1.44M ↔ 실측 1,440,126) 구 단위로는 −14.8%~+21.1%로 크게 어긋났다. 배치 계획의 구별 수치는 전부 실측으로 교체했다(§7).

## 2. 서울 25개 구 최종 합계

| 지표 | 값 |
|---|---|
| full-history 원천 행 | **1,440,126** |
| 정규화 결과 | 1,440,126 (**invalid 0**) |
| active | **1,422,723** |
| canceled | **17,403 (1.21%)** |
| 구 | **25 / 25 완료** (districtsPartial `[]`) |
| 전체 셀 | **6,276** |
| COMPLETE 셀 | **6,276** |
| PARTIAL 셀 | **0** |
| FAILED 셀 | **0** |
| 총 API 호출(페이지 fetch) | **6,330** |
| multipage 셀 | **50** |
| 최대 셀 | **노원 11350:2006-11 = 3,141행 (4쪽)** |
| EXACT_MASTER | **1,366,818 (94.91%)** |
| MASTER_MISSING | **73,275 (5.09%)** |
| MASTER_MISSING distinct aptSeq | **2,424** |
| INVALID_APTSEQ | **0** |
| REVIEW_REQUIRED(이웃 구 오기재) | **33** |

`collectedEqTotal = true` — 6,276셀 전부 수집 수 = totalCount. 1쪽만 읽는 경로였다면 절단됐을 셀이 50개다.

### 연도별

| 연도 | 원천 | 취소 | | 연도 | 원천 | 취소 |
|---|---|---|---|---|---|---|
| 2005 | 104 | 0 | | 2016 | 110,085 | 0 |
| 2006 | 111,946 | 0 | | 2017 | 104,930 | 0 |
| 2007 | 53,231 | 0 | | 2018 | 81,579 | 0 |
| 2008 | 48,094 | 0 | | 2019 | 74,998 | 0 |
| 2009 | 73,268 | 0 | | 2020 | 84,017 | 3,159 |
| 2010 | 44,195 | 0 | | 2021 | 43,429 | 1,478 |
| 2011 | 54,395 | 0 | | 2022 | 12,801 | 754 |
| 2012 | 41,012 | 0 | | 2023 | 35,582 | 1,547 |
| 2013 | 68,139 | 0 | | 2024 | 57,758 | 2,588 |
| 2014 | 85,552 | 0 | | 2025 | 83,772 | 6,419 |
| 2015 | 120,039 | 0 | | 2026(~09) | 51,200 | 1,458 |

**취소 정보는 2020년부터만** 존재(거래 해제 신고 제도 시점) — 18구 측정 때와 같은 성질이 25구에서도 유지된다.

### 구별 전체 이력 (실측, 오름차순)

종로 11,582 · 중구 17,824 · **금천 25,106** · 용산 25,673 · 강북 28,288 · 광진 29,358 · 서대문 44,636 · **관악 46,842** · 중랑 47,599 · 은평 49,543 · 마포 52,796 · 동대문 53,025 · 성동 53,238 · **동작 53,748** · **영등포 63,680** · **서초 64,189** · 도봉 65,520 · 양천 67,731 · 성북 73,305 · **구로 74,721** · 강동 78,414 · **강서 85,982** · 강남 86,153 · 송파 91,993 · 노원 149,180 (굵게 = 이번에 측정)

## 3. MASTER 대조 (aptSeq exact match만)

fuzzy · dong+jibun fallback · name fallback · first-match **전부 사용하지 않았다**. `classifyMaster()`는 aptSeq 형식과 앞 5자리 구 코드만 본다.

구별 EXACT 비율: **82.8%(서초) ~ 99.5%(성북)**. 낮은 쪽은 전부 대규모 재건축 구다 — 서초 82.8% · 강동 83.9% · 강남 85.9%. 이번에 측정한 7구: 강서 96.9 · 구로 95.7 · 금천 95.3 · 영등포 97.4 · 동작 97.7 · 관악 95.9 · **서초 82.8**.

### REVIEW_REQUIRED 33행 · 자연키 충돌 2 (신규 발견)

이웃 구 응답에 실린 행 33개(성동 13 · 성북 10 · 관악 5 · 동작 2 · 강북 2 · 서대문 1). 이 중 **2행은 canonical 구 응답에도 같은 자연키가 있다**(18구 측정에서는 0이었다):

```
id:11590-3369::114.69::sale|106000|2025-03-15|4|0   → 11590:202503 과 11620:202503 양쪽
id:11590-3369::114.69::sale|105000|2025-08-08|10|0  → 11590:202508 과 11620:202508 양쪽
```

자연키에 `lawdCd`가 없으므로(§6 PLAN) 두 셀이 같은 행을 만든다. 적재 시 동작: 먼저 처리된 셀이 insert하고 다른 셀은 `createMany skipDuplicates`로 **조용히 건너뛴다**.

- 데이터 정확성에는 문제 없다 — 중복 행이 생기지 않고, 한 행이 canonical 구(11590 동작)에 저장된다.
- **Defect A 위험 없음**: 관악 셀에서 이 그룹의 DB 형제는 0으로 보이므로 count 기반 insert 경로가 아니라 신규 그룹 경로를 타고, 취소 상태는 원천 그대로 들어간다.
- **apply 계획에만 영향**: 관악 셀의 계획 insert 수와 실제 기록 수가 2 어긋난다. `--expect-inserts` 대조 시 이 2건을 감안해야 하고, 이후 재동기화마다 같은 no-op이 반복된다.
- 삭제·이동 추정은 하지 않는다. 원천 그대로 적재 + 목록 기록(PLAN §5 정책 유지).

## 4. MASTER_MISSING census (§7)

전체 이력 기준 **2,424 aptSeq / 73,275행**. 18구 측정(1,564 / 52,402)에서 늘어난 것은 측정 범위가 넓어졌기 때문이다.

`scripts/audit-seoul-master-missing-census.ts` — 관측 가능한 신호로만 분류했고, **master를 만들지 않았다**.

| 분류 | aptSeq | 행 | 근거 |
|---|---|---|---|
| **A** CURRENT_MASTER (지금 master에 있음) | **0** | **0** | 정합성 확인용 — 0이 맞다 |
| **B** HISTORICAL_ONLY (마지막 거래가 seed 창 이전) | **2,392** | **70,590** | master를 최근 24개월 매매로 만들었으므로 구조적 |
| **C** LOT_REUSED **신호** | **32** | **2,685** | 같은 `(lawdCd, dong, jibun)`에 master가 가진 **다른** aptSeq가 있음 |
| **D** UNRESOLVED_RECENT | **0** | **0** | 최근 거래가 있는데 master에 없는 단지 **없음** |

- **D = 0이 핵심**: 2,424개 전부 마지막 거래가 2024-10 이전이다. 즉 master seed에 **최근 누락이 없다**. 마지막 거래 연도 분포는 2006:8 … 2019:187 · 2020:400 · 2021:388 · 2022:223 · 2023:322 · 2024:395로 끝난다.
- C는 **재건축/개명 가능성을 시사하는 신호일 뿐 동일 단지 판정이 아니다**: 송파 미성(625행, 신천동 17-6) · 서초 신반포8(527, 잠원동 60-3) · 노원 보람2단지(497, 상계동 639) · 도봉 한양4(205) · 강남 홍실아파트(178) 등.
- B 상위: 개포주공1단지 2,965 · 시영1 2,029 · 개포주공4단지 1,567 · 시영2 1,479 · 주공3 1,441 · 주공2 1,238 · 둔촌주공4단지 1,198.
- 매매 행은 master 없이도 aptSeq로 적재 가능하다(부산도 동일). 과거 단지 master 생성은 **별도 STEP**.

## 5. 기존 서울 46행 (§8)

`scripts/audit-seoul-existing-rows-drift.ts` — 캐시된 원천과 DB 기존 행을 운영과 **같은 판정 함수** `planSaleCellWrites()`(순수 함수)에 넣어 센다. **API 호출 0 · 쓰기 경로 없음**.

| 구분 | 행 |
|---|---|
| same (변경 없음) | **40** |
| cancel drift (`CANCEL_FLIP`) | **2** |
| registryDate drift (`REGISTRY_SUPPLEMENT`) | **4** |
| other drift | **0** |
| `CANCEL_RESTORE` | 0 |
| **승인 필요한 기존 행 UPDATE 합계** | **6** |

기존에 알려진 drift(취소 2 + 등기일 4 = 6)와 **정확히 일치**. 자연키 46/46 EXACT, master 46/46 EXACT.

- 취소 2건: `940441` 11680-4090 세곡푸르지오(18.6억, 2026-08-14, 8층, 해제일 `26.09.12`) · `940456` 11680-3650 청담2차이-편한세상(25억, 2026-08-07, 3층, 해제일 `26.09.08`). 원천이 적재 뒤 취소로 바꾼 진짜 취소다.
- 같은 셀(11680:202608)의 계획 insert는 **41행** — 46행 적재(2026-08-31) 이후 원천에 8월 거래가 더 신고됐다.
- **이번 STEP에서 변경 0.**

## 6. 취소 관측 (§9)

count 기반 semantics만 사용했고 응답 순서로 판정하지 않았다.

| 지표 | 값 |
|---|---|
| source active | 1,422,723 |
| source canceled | 17,403 |
| occurrence 그룹 | 1,420,621 |
| 같은 조건 복수 거래 그룹 / 행 | 15,817 / 35,322 |
| 원천 전 필드 동일 행 | 7,878 |
| 형제 중 일부만 취소인 그룹 | 10,613 |
| **역순 정규화 시 그룹별 건수·취소 수 차이** | **0** (`countsDiffer=0`, 6,276셀 전부) |
| 취소가 붙는 occurrence 슬롯만 달라진 그룹 | 10,577 |

25구 전체에서도 **원천 순서는 건수·취소 수에 영향이 없다**. 최초 insert는 건수만 정확하면 되고, 이후 재동기화는 count 기반 reconcile이 필수라는 PLAN §7 결론이 그대로 유지된다. DB write 0.

## 7. 배치 계획 재계산 (실행 안 함)

전부 실측값. 기존 계획과 달라진 것은 **Phase C뿐**(projection 7구가 실측으로 교체).

| 단계 | 범위 | 원천 행 | 기존 | 비고 |
|---|---|---|---|---|
| Pilot | 중구 11140 최근 12개월(202510~202609) | **944** (12셀) | 944 | 변화 없음 |
| Phase A | 중구 11140 전체 이력 | **17,824** (249셀) | 17,824 | 변화 없음 |
| Phase B | 종로 11,582 + 용산 25,673 | **37,255** | 37,255 | 변화 없음 |
| Phase C | 나머지 22개 구 | **1,385,047** | 1,384,189(추정 포함) | **+858, 전부 실측** |
| **합계** | | **1,440,126** | ≈1.44M | 이제 projection 0 |

Phase C 순서(작은 구 → 큰 구, 노원 마지막 — multipage 35셀):
금천 25,106 · 강북 28,288 · 광진 29,358 · 서대문 44,636 · 관악 46,842 · 중랑 47,599 · 은평 49,543 · 마포 52,796 · 동대문 53,025 · 성동 53,238 · 동작 53,748 · 영등포 63,680 · 서초 64,189 · 도봉 65,520 · 양천 67,731 · 성북 73,305 · 구로 74,721 · 강동 78,414 · 강서 85,982 · 강남 86,153 · 송파 91,993 · 노원 149,180.

### 적재 규모 · 소요 · 크기

| 지표 | 값 | 근거 |
|---|---|---|
| projected DB insert | **1,440,078** | 1,440,126 − 기존 46 − 자연키 충돌로 건너뛸 2 |
| 기존 행 | 46 | 전부 자연키 EXACT |
| 기존 행 UPDATE(승인 필요) | **6** | 취소 2 + 등기일 4 |
| 행당 크기(부산 실측) | 579.8B (heap 270.6 + index 309.1) | 501.8MB / 865,421행 |
| **예상 증가** | **≈ +835MB** (heap ≈390 + index ≈445) | 기존 +835MB 추정과 **동일** — 실측 총행이 추정과 거의 같아서 |
| 적재 후 매매 테이블 | ≈ **1.34GB** | 501.8MB + 835MB (러프 추정, 과금 추정 아님) |
| 수집 호출 | **6,330** | 실측(이번 6,330 페이지 fetch) |
| 수집 시간 | ≈ **38분** | 0.36초/호출 |
| 전체 apply 예상 | **1~2시간대** | 부산 cron 0.54~0.79초/셀 × 6,276셀 = 56~83분 + insert 시간 |
| quota | 6,330 + 예약 2,000 = 8,330 < 10,000 | 한 창에 들어가나 **2창 분할 권장**(Production 몫 보호) |

## 8. Quota (§4)

| 항목 | 값 |
|---|---|
| 한도 | 10,000 / 창 (매매 endpoint, Production 라이브·부산 cron과 공유) |
| 시작 remaining | **9,767** (창 리셋 확인됨) |
| 이번 STEP 사용 | **1,611** (+ quota probe 1) |
| 종료 remaining | **8,156** |
| 예약분 | 2,000 — **한 번도 닿지 않음**(RESERVE_STOP 0) |
| throttling | 동시 1 · 최소 간격 350ms 유지 |
| retry | 제한 횟수 + 지수 backoff, 무한 재시도 없음 |
| 중복 실행 | 0 — COMPLETE 셀 재호출 없음 |

PLAN이 예상한 "2개 창 분할"이 필요 없었다(창이 리셋된 뒤 시작해서 1,611호출로 끝남).

## 9. No-write assertion (§14)

| 항목 | 값 |
|---|---|
| Production INSERT / UPDATE / DELETE | **0 / 0 / 0** |
| 서울 sale apply | **0** |
| false-cancel repair / Defect B repair | **0 / 0** |
| schema / migration | 0 / 0 |
| 서울 stats · cronSync · SEO/sitemap enable | **0** |
| runtime 코드 변경 | **0** (`git status -- src/` 비어 있음) |
| 측정 전후 DB | 전체 865,421행 · 취소 16,345 · 서울 매매 46행 · 서울 coverage cell 0 · 상한 334 · 전원취소 273 · 확정 28행 28/28 — **전부 불변** |

이번 STEP의 새 스크립트 2개는 `_prod-db-guard`(DIAGNOSTIC, `ALLOW_PROD_DB_READ=1`) 아래에서 `SET TRANSACTION READ ONLY` SELECT만 하고, Prisma create/update/delete도 raw write SQL도 없다.

**관측된 1건(무관)**: `error_logs`에 `2026-09-20T02:07:59Z` `[MOLIT_PARTIAL] type=rent lawdCd=11680 율현동 202506 (2028/2033건, 3페이지)` 1건이 새로 쌓였다. **전월세(rent) endpoint**의 라이브 조회이고 이번 측정(매매 endpoint)과 다른 endpoint·다른 quota다. 사유도 rate limit이 아니라 원천 응답 불완전이며, 시스템이 절단된 결과를 저장하지 않고 PARTIAL로 거부한 **정상 동작**이다. 이번 STEP이 기여했다는 증거는 없다.

## 10. 테스트 (§13)

```
npx tsx --test scripts/audit-seoul-sale-backfill-plan.test.ts scripts/backfill-seoul-sale.test.ts
             scripts/sale-pagination-logic.test.ts scripts/seed-seoul-apartment-master.test.ts
             scripts/seoul-master-seed-plan-logic.test.ts scripts/cancel-insert-plan.test.ts
             scripts/cancel-reconcile-logic.test.ts src/lib/sync/cancel-insert-path-sync.test.ts
                                                              pass 132  fail 0
npx eslint (이번 STEP 새 스크립트 2개)                            exit 0
npx tsc --noEmit                                              src/ 0 · 기존 scripts 21 + tmp 4 = FAIL_EXISTING_SCRIPT_ERRORS (건수 불변)
```

runtime 코드를 바꾸지 않았으므로 build는 돌리지 않았다.

## 11. 이번 STEP이 추가한 스크립트 (READ ONLY)

| 파일 | 역할 |
|---|---|
| `scripts/audit-seoul-master-missing-census.ts` | MASTER_MISSING aptSeq 전체 목록 + A/B/C/D 분류(신호 기반, master 생성 0) |
| `scripts/audit-seoul-existing-rows-drift.ts` | 캐시 원천 + DB 기존 행을 `planSaleCellWrites()`에 넣어 기존 행 drift만 census(API 호출 0) |

둘 다 apply 경로가 없다. 산출물은 `tmp/seoul-sale-backfill-plan/master-missing-census.json` · `existing-rows-drift.json`.

## 12. Blockers · 다음

1. **apply는 여전히 BLOCKED** — `DEFECT_A_GATE_PASS` 미설정(Production env에 없음). 선결: false-cancel 28행 repair 결정, insert 경로의 Production 양성 실행 확인(`CANCELLATION_CRON_VALIDATION_AFTER_INSERT_PATH_FIX_V1` §5·§13).
2. **자연키 충돌 2건**(§3) — apply 전에 `--expect-inserts` 대조 방식에 반영하거나, 관악 셀을 예외로 기록할지 결정 필요.
3. 기존 46행의 **UPDATE 6건**은 apply 승인 항목(`--approve-existing-updates`)으로 명시.
4. 과거 단지 master(B 2,392 + C 32 = 2,424 aptSeq)는 별도 STEP — 이번엔 census만 했고 추정으로 만들지 않았다.
5. 공개 전(별도): cron 서울 파라미터화·분할, 전월세 DB-first 축 분리, SALE coverage cell, Defect B 정책.
