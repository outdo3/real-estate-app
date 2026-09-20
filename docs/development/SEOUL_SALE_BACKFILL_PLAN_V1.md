# E-JIP SEOUL SALE BACKFILL PLAN V1

서울 아파트 매매 **전체 이력** backfill 계획 + read-only 실측. Production write 0 · schema 0 · 서울 enable 0.
**서울 매매 apply는 BLOCKED_FOR_APPLY**(§7 Defect A 선결).

- 날짜: 2026-09-19 (KST) · 기준 커밋 `665f28c`
- 도구: `scripts/audit-seoul-sale-backfill-plan.ts`(fetch · prestart · status · report) · 테스트 `scripts/audit-seoul-sale-backfill-plan.test.ts`
- 산출물(로컬): `tmp/seoul-sale-backfill-plan/` — summary · district-year-counts · master-reconciliation · cancellation-audit · paging-audit · quota-plan · review-required · existing-46-reconcile · batch-plan (+ `raw/` 셀별 gzip, `cells/` checkpoint, 2005 probe)
- 이 STEP 중 별도 승인으로 처리한 hotfix: §19(상세페이지 DB-first 지역 게이트, `8681234`)

## 판정

**READY_FOR_BACKFILL_SCRIPT** — 설계에 필요한 사실(원천 시작 월·paging·identity·취소·master 대조·기존 46행·index·stats 준비도)은 실측으로 확정.
단서: (1) 원천 규모 실측은 **18개 구 전체 + 강서 일부(1,083,461행, 약 75%)** — 나머지 7개 구(구로·금천·영등포·동작·관악·서초 + 강서 잔여)는 MOLIT quota 예약분(2,000)을 지키느라 다음 quota 창에서 checkpoint로 이어 받는다(약 1,650호출). (2) apply는 Defect A 선결 전까지 BLOCKED.

## 1. Baseline (READ ONLY)

master 서울 6,843 · 부산 3,438 · 서울 매매 46행(강남구 11680, 2026-08-01~08-24, 취소 1) · 서울 커버리지 셀 0 · `enablement.ts` `'11'` 주석(stats/cronSync/SEO 닫힘). 매매 테이블: 부산 865,289행(2006-01~2026-09-18), 전체 크기 501.8MB(heap 234MB + index 267MB).

## 2. 원천 · 시작 월

- 원천: MOLIT `RTMSDataSvcAptTradeDev`(매매). 서울 25개 구 모두 정상 응답.
- **가장 이른 달 = 2005-07**(강서구 1행). 2005-01~06은 25개 구 전부 0, 2000-01·2004-12(확인한 3개 구) 0.
  2005-07~12에 51개 (구·월) 셀 · 104행이 있다(계약일 2005년, 2006년 제도 시작 직후 신고분으로 보임). 2006-01부터가 본격 데이터.
- backfill 범위: **2005-07 ~ 현재 달**(2005년은 행이 있는 셀만), 즉 2006-01~2026-09 249개월 + 2005년 소량 셀.

## 3. 실측 규모 (18개 구 전체 + 강서 2005~2018-05)

| 연도 | 원천 행 | 취소 | 측정 구 |
|---|---|---|---|
| 2005 | 77 | 0 | 16 |
| 2006 | 86,944 | 0 | 19 |
| 2007 | 42,216 | 0 | 19 |
| 2008 | 36,826 | 0 | 19 |
| 2009 | 56,607 | 0 | 19 |
| 2010 | 33,707 | 0 | 19 |
| 2011 | 41,738 | 0 | 19 |
| 2012 | 32,088 | 0 | 19 |
| 2013 | 52,306 | 0 | 19 |
| 2014 | 65,100 | 0 | 19 |
| 2015 | 92,112 | 0 | 19 |
| 2016 | 85,231 | 0 | 19 |
| 2017 | 81,316 | 0 | 19 |
| 2018 | 60,923 | 0 | 19(강서 5월까지) |
| 2019 | 54,891 | 0 | 18 |
| 2020 | 58,989 | 2,171 | 18 |
| 2021 | 29,788 | 994 | 18 |
| 2022 | 8,602 | 534 | 18 |
| 2023 | 26,141 | 1,111 | 18 |
| 2024 | 41,800 | 1,940 | 18 |
| 2025 | 60,101 | 4,705 | 18 |
| 2026(~09) | 35,958 | 1,060 | 18 |
| **합계** | **1,083,461** | **12,515 (1.16%)** | |

- 정규화(운영 `mapMolitItems` → `normalizeMolitItemsToTradeRows`) 결과: 1,083,461 = 원천 수, **invalid 0**(층·면적·금액·날짜·identity 누락 0).
- **취소 정보는 2020년부터만** 존재(2005~2019 취소 0 — 거래 해제 신고 제도 시점과 일치).
- 구별 전체 이력(실측): 노원 149,180 · 송파 91,993 · 강남 86,153 · 강동 78,414 · 성북 73,305 · 양천 67,731 · 도봉 65,520 · 성동 53,238 · 동대문 53,025 · 마포 52,796 · 은평 49,543 · 중랑 47,599 · 서대문 44,636 · 광진 29,358 · 강북 28,288 · 용산 25,673 · 중구 17,824 · 종로 11,582.
> **2026-09-20 갱신**: 나머지 7개 구 측정이 끝나 서울 25/25가 실측으로 확정됐다 — **1,440,126행**(취소 17,403, 셀 6,276, 비COMPLETE 0). 아래 projection은 기록으로 남기되, 최신 수치는 `SEOUL_SALE_FULL_HISTORY_MEASUREMENT_COMPLETION_V1.md`를 본다.

- **서울 전체 예상 ≈ 1.44M행**(측정 구의 "전체 이력 / 최근 24개월" 비율 9.867을 미측정 7개 구의 실측 24개월 행 수에 적용한 **projection** — 다음 quota 창 수집 후 실측으로 교체). 기존 추정 0.8~1.2M보다 크다.

## 4. Paging

측정 셀 4,668개 **전부 COMPLETE**(수집 = totalCount), PARTIAL/ERROR 0. 다중 페이지 47셀, 최대 **3,141행(노원 2006-11, 4쪽)** — 2006~2007·2017~2018 급등기의 대형 구. 1쪽만 읽는 경로는 서울에서 절단된다(기존 `apartment_master_seed.ts`·라이브 경로 과거 결함과 같은 유형). backfill은 `fetchSaleRegionMonth`/`fetchSaleCell`의 COMPLETE 판정만 적재.

## 5. MASTER 대조 (aptSeq만, 추정 없음)

| 분류 | 행 | 비율 |
|---|---|---|
| EXACT_MASTER | 1,031,033 | **95.16%** |
| MASTER_MISSING | 52,402 | 4.84% |
| INVALID_APTSEQ | 0 | — |
| REVIEW_REQUIRED(이웃 구 응답 오기재) | 26 | — |

- MASTER_MISSING = **1,564개 aptSeq, 전부 마지막 거래가 2024-10 이전** — master를 최근 24개월 매매로 만들었기 때문. 대부분 재건축 전 단지(개포주공1단지 2,965행 · 시영1 2,029 · 개포주공4단지 1,567 · 둔촌주공4단지 1,198 · 고덕 주공2·3 …). 이름·지번으로 현재 단지에 붙이지 않는다.
- 구별 EXACT 비율: 83.9%(강동, 둔촌·고덕 재건축) ~ 99.5%(성북).
- 매매 행은 master 없이도 aptSeq로 적재 가능(부산도 aptSeq 기준 30%·행 4.6%가 master 밖). 과거 단지 master 생성은 별도 STEP(서울용 master-coverage-sync 부재).
- REVIEW 26행: 11140-1012(성동 응답 13) · 11230-2029(성북 10) · 11320-87(강북 2) · **11740-2573 청원파크빌3(서대문 2020-01, 1)** — 모두 canonical 구 응답에는 **같은 자연키가 없다**(중복 게재 0, 자연키 충돌 0). 동기화 경로는 조회 구(lawdCd)로 저장하므로 해당 구 통계에 1행씩 섞인다 — 부산에도 같은 유형 4 aptSeq. 정책 제안: 원천 그대로 적재 + 목록 기록(삭제·이동 추정 금지).

## 6. 거래 identity

- 자연키(unique): `(group_key, deal_amount, deal_date, floor, occurrence_index)`, `group_key = id:{aptSeq}::{전용면적}::sale`. **lawdCd·dealYmd 미포함**.
- 같은 조건 복수 거래: **11,666그룹 · 25,556행** — occurrenceIndex로 각각 별도 행(접지 않음). 원천 전 필드가 완전히 같은 행도 5,263행 존재(원천에 거래번호 없음) — 모두 보존.
- 측정 데이터에서 **셀 간 자연키 충돌 0** → lawdCd 미포함 자연키로 인한 `skipDuplicates` 누락 위험은 실측상 없음(향후 적재 시 dry-run에서 재확인).

## 7. 취소 semantics · Defect A 의존

현재 신뢰 규칙(`syncOneSaleCell` + `write-policy-logic.ts`, CANCELLATION_INSERT_PATH_FIX_V1):

| 경우 | 동작 |
|---|---|
| DB 0(서울 최초 적재) | 원천 그룹 그대로 insert(형제 수·취소 수 정확) |
| 원천 > DB > 0 | 부족분만 count 기반 insert |
| 원천 = DB | count 기반 취소 reconcile만(restore는 `SALE_CANCEL_RESTORE_ENABLED=1`일 때만) |
| 원천 < DB | insert·delete·flip 없음(Defect B 보류) |

- 원천 순서는 진실로 쓰지 않는다: 측정 4,668셀을 **역순 정규화** → 그룹별 건수·취소 수 차이 **0**, 취소가 붙는 occurrence 슬롯만 7,809그룹에서 달라짐. 즉 최초 insert는 건수만 정확하면 되고, 이후 재동기화는 count 기반 reconcile이 필수(행 단위 경로는 Defect A 재발).
- 형제 중 일부만 취소인 그룹: 7,830.
- **Defect A 의존(BLOCKED_FOR_APPLY)**: 서울 매매 apply 전제 = ① 2026-09-20 부산 cron 검증 PASS ② false-cancel 28행 repair 결정 완료 ③ insert-path fix 안정. 현재: insert-path fix 배포(2026-09-19), 28행 미복구, restore OFF, cron 증명 대기.
- 서울용 규칙 재사용 가능: 정책 코드에 지역 분기 없음(default 구 목록만 부산).

## 8. Defect B 정책

- **최초 backfill**: 원천에 있는 행만 insert(DB 0 → 원천 그대로) — 원천에 없는 행을 만들지 않는다.
- **이후 동기화**: 원천에서 사라진 행(원천 < DB)은 지금처럼 삭제·표시 없이 보류 — 부산 Defect B와 같은 미결 정책(`sourceMissingSince` 등 schema 제안은 별도 승인). 서울 공개 전 결정 필요.

## 9. 기존 46행

- 46/46 **자연키 정확 일치**(원천 재정규화 결과와 group_key·금액·계약일·층·occurrence 동일) · 46/46 master EXACT → 재적재 시 insert 0(멱등).
- **취소 상태 44/46 일치**. 2행은 적재 뒤 원천에서 취소됨: 11680-4090 세곡푸르지오 2026-08-14(18.6억, 8층) · 11680-3650 청담2차이-편한세상 2026-08-07(25억, 3층) — 둘 다 형제 1건 그룹. 향후 apply 시 count 기반 reconcile이 두 행을 `dealCanceled=true`로 **UPDATE**하게 된다(원천 truth 반영) → apply 승인 항목에 명시 필요. 이번 STEP 변경 없음.
- 이 46행 때문에 서울 상세페이지가 DB 부분 데이터만 보여주던 문제는 §19 hotfix로 차단.

## 10. 적재 스크립트 결정

| 경로 | 판정 |
|---|---|
| `syncOneSaleCell`(`src/lib/sync/sale-sync-core.ts`) | **기반으로 사용** — 완전성 게이트 · count 기반 취소/insert · 커버리지 셀 · 지역 중립 |
| `runSaleSync` | 그대로 쓰면 안 됨: `monthsInRange` 240개월 상한(`shared.ts:131`)으로 2006-01~ 범위가 조용히 잘림 · 기본 구 목록 부산 · 커버리지 셀을 실행 끝에 한 번만 기록 · 50초 예산 |
| `backfill-trade-history.ts` · `sync-trade-history.ts` · `incremental-sync-nationwide.ts` · `resync-cancellation-v2.ts` | **사용 금지** — 응답 순서 기반 행 단위 취소(Defect A 경로), registryDate null 덮어쓰기, 커버리지 셀 없음, prod 가드 없음 |

새 CLI driver(얇게) 요건:
- default dry-run · apply = `--apply` + `ALLOW_PROD_DB_WRITE=1` + `ALLOW_PROD_DB_READ=1`(`assertProductionDbAccessAllowed('BACKFILL')`) + **`--district` 또는 `--from/--to` 범위 필수**(서울 전체 one-shot 금지) + `--expect-inserts` 일치.
- 셀 루프를 driver가 직접 돌며 `syncOneSaleCell` 호출(240개월 상한 우회), **셀마다** 커버리지 기록/checkpoint(`tmp` + `sync_coverage_cells`), 현재 달은 검증 기록 안 함.
- `x-ratelimit-remaining` 예약분 정지(이 STEP probe와 같은 방식).
- 서울 25구는 registry `getMolitLeafRegions('11')`.
- 적재 전 dry-run artifact(셀별 insert/reconcile/skip 수)와 `--expect-inserts` 대조.
- 기존 행 조회(`where { lawdCd, dealYmd }`)는 index가 없어 구 전체 이력을 훑는다 → **dealDate 월 범위 조건을 추가**해 `(lawd_cd, deal_date)` index를 타게 한다(코드 변경, schema 불필요, 부산 cron 결과 동일).

## 11. Checkpoint · 멱등성

- 구+연월 셀 단위 상태: PENDING → FETCHED → VALIDATED → READY → APPLIED / PARTIAL / BLOCKED. PARTIAL·ERROR 셀은 적재하지 않고 다음 실행에서 재수집.
- 멱등: 자연키 일치 행 SKIP(`createMany skipDuplicates` + 그룹 count), 원천 상태 변화는 count 기반 reconcile만, blind update/duplicate 없음. 재실행 시 APPLIED 셀은 dry-run 대조만.

## 12. Batch 전략 (`batch-plan.json`)

| 단계 | 범위 | 원천 행 |
|---|---|---|
| Pilot | 중구 최근 12개월(2025-10~2026-09) | 944 |
| Phase A | 중구 전체 이력 | 17,824 |
| Phase B | 종로구 · 용산구 | 11,582 · 25,673 |
| Phase C | 나머지 22개 구, 작은 구부터(노원 마지막 — 다중 페이지 셀 다수) | 1,384,189(측정 15구 + projection 7구) |
| **합계** | | **≈1.44M**(측정 1,083,461) |

Phase C 순서(행): 금천 20,799* · 강북 28,288 · 광진 29,358 · 관악 44,607* · 서대문 44,636 · 중랑 47,599 · 은평 49,543 · 마포 52,796 · 서초 53,013* · 동대문 53,025 · 성동 53,238 · 동작 63,097* · 도봉 65,520 · 양천 67,731 · 구로 72,855* · 성북 73,305 · 영등포 73,634* · 강동 78,414 · 강서 85,405* · 강남 86,153 · 송파 91,993 · 노원 149,180 (*projection).

각 단계 뒤 사후 감사(구별 행 수 = dry-run, 자연키 중복 0, 취소 수 = 원천, 부산 불변) 후 다음 단계.

## 13. Quota · 소요

- 한도 10,000/창(endpoint별), **Production 라이브 조회·부산 cron과 공유**. 이 STEP에서 매매 호출 약 5,000(probe 4,719 + 시작 월 확인 281) 사용, 예약 2,000에서 정지.
- 측정 속도 0.36초/호출(4,719호출 1,700초).
- 전체 backfill 수집 ≈ 6,450호출 ≈ 39분(수집만) — 한 창에 들어가지만 예약 유지를 위해 **2개 창 분할** 권장. DB 쓰기 시간은 셀당 수백 ms(부산 cron 실측 0.54~0.79초/셀, 수집 포함) → 전체 1~2시간대 예상(추정).

## 14. DB 크기 · index

- 현재 행당 약 580B(heap 271B + index 309B). 1.44M행 추가 ≈ **+835MB**(heap ≈390MB, index ≈445MB) → 매매 테이블 약 1.34GB(러프 추정, 과금 추정 아님).
- index: `(lawd_cd, deal_date)` · `(lawd_cd, exclusive_area, deal_date)` · `(apt_seq, exclusive_area, deal_date)` · `(identity_key, deal_date)` · `(deal_date)` · `(created_at)` · unique 자연키. stats 조회 패턴은 모두 선두 컬럼이 맞는 index를 가진다. **예외**: sync의 `(lawd_cd, deal_ymd)` 기존 행 조회 — §10 코드 수정으로 해결(migration 불필요). 연간 집계(2014~)는 대형 구에서 heap 읽기가 커질 수 있어 적재 후 관찰.
- schema/index migration 없이 진행 가능 → STOP 조건 아님.

## 15. Stats DB-first 준비도 (서울 enable 전, 활성화 안 함)

| route | 판정 | 요지 |
|---|---|---|
| yearly | READY_AFTER_DATA | 2014~ DB 집계, 전월세는 라이브 |
| price-rankings | READY_AFTER_DATA | 24개월 데이터 필요, 늦은 취소 recheck가 부산 전용 |
| region-change | READY_AFTER_DATA | 24개월 필요 |
| dashboard | NEEDS_PARAMETERIZATION | 매매 DB 플래그가 전월세도 DB로 보냄 + 전월세 검증 범위 부산 전용 → 서울 전월세 0 |
| feed | NEEDS_PARAMETERIZATION | 시도 전체 전월세 동일 문제, 단일 구는 라이브 |
| concentration | NEEDS_PARAMETERIZATION | 매매는 준비, 전세·월세 동일 문제 |
| gap-invest | NEEDS_PARAMETERIZATION | 서울 SALE `sync_coverage_cells` 필요 + 전월세 |
| rankings | NEEDS_NEW_WORK | DB 경로 없음(라이브만) |
| large-complex | NEEDS_NEW_WORK | **서울 master `sido` 표기 불일치**(§18) · 세대수 미적재 · '부산 전체' 라벨 |

공통: cron 3종(sale-sync·sale-recheck·rent-sync)이 `BUSAN_LAWDCD_16` 하드코딩 — `cronSync` 축이 cron을 움직이지 않는다. sale-sync 50초 예산은 41개 구 불가(구 분할 cron 필요). 서울 `cronSync`를 켜면 지도 마커(`/api/transactions`)도 DB로 바뀐다.

## 16. 대표 구

| 구 | 전체 이력 | 취소 | 호출 | master EXACT | 비고 |
|---|---|---|---|---|---|
| 중구 11140 | 17,824 | 337 | 249 | 96.9% | 파일럿 후보(최근 12개월 944) |
| 강남구 11680 | 86,153 | 1,152 | 253 | 85.9% | 개포주공 등 재건축 전 단지 |
| 송파구 11710 | 91,993 | 838 | 255 | 92.8% | 시영 등 |
| 노원구 11350 | 149,180 | 1,300 | 291 | 98.4% | 최대 셀 3,141행(4쪽), 다중 페이지 다수 |
| 강동구 11740 | 78,414 | 977 | 253 | 83.9% | 둔촌·고덕 재건축 |

## 17. 테스트

`scripts/audit-seoul-sale-backfill-plan.test.ts` 6개: 월 범위 · master 분류(aptSeq만) · 자연키 = DB 형식 · 같은 조건 복수 거래 보존 · 취소 건수 순서 무관/슬롯 순서 의존 · 페이지 완전성과 PARTIAL/ERROR 보류.

## 18. 발견: 서울 master `sido` 표기

부산 master `sido`는 **'부산'**(축약, 프로젝트 관행 — large-complex·점수 peer-context가 이 값으로 조회), 서울 seed는 **'서울특별시'**로 적재(내 seed 스크립트 `toCreateData`). 현재 서울은 두 기능 모두 닫혀 있어 사용자 영향 없음. 제안(승인 필요): Production `UPDATE apartment_masters SET sido='서울' WHERE sgg_cd LIKE '11%'`(6,843행, 되돌림 가능) + seed 스크립트를 registry `shortName`으로 수정.

## 19. Hotfix(이 STEP 중 사용자 승인): 상세페이지 DB-first 지역 게이트

- 증상(Production 실측): 서울 강남구 파일럿 46행(2026-08만)이 있는 39개 단지의 상세 API가 DB를 1차 소스로 써 **최근 1개월 3건만** 반환(은마 `tradeDataSource: DB`, 3건). DB 행이 1건이라도 있으면 DB로 전환하는 규칙에 지역 게이트가 없었고, 서울 master 적재로 이름 기반 aptSeq 확정도 가능해져 aptSeq 파라미터 없이도 발생.
- 수정(`8681234`): DB-first는 **aptSeq 자체 구 코드가 cronSync 지역**일 때만(`isTradeDbFirstLawdCd(aptSeq.slice(0,5))`). 부산 동작 불변.
- 검증(Production): 은마 → MOLIT 158건·35개월(2023-10~2026-09, aptSeq 유무 동일) · 부산 대신롯데캐슬 → DB 83건·33개월(불변). 테스트 +1(src 2,321 통과) · build 성공.

## 20. No-write assertion

Production INSERT 0 · UPDATE 0 · DELETE 0 · schema 0 · migration 0 · 서울 stats/cronSync/SEO enable 0 · 부산 변경 0. 외부 호출은 MOLIT 매매 GET만(약 5,000) — 서울 매매 apply 없음.

## 21. Blockers · 다음

1. **Apply 차단**: Defect A cron 검증(2026-09-20) · 28행 repair 결정 · insert-path 안정.
2. 규모 실측 완료: 다음 quota 창에서 `npx tsx scripts/audit-seoul-sale-backfill-plan.ts fetch --reserve=2000` → `report`.
3. backfill driver 작성(§10, 코드만·dry-run 기본) + sync 기존 행 조회 dealDate 범위 조건.
4. 서울 master `sido` 정정 승인 여부(§18).
5. 공개 전(별도): cron 서울 파라미터화·분할, 전월세 DB-first 축 분리, SALE 커버리지 셀, 과거 단지 master, Defect B 정책.
