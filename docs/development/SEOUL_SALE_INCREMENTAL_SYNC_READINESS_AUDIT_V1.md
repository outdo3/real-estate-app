# E-JIP SEOUL SALE INCREMENTAL SYNC READINESS AUDIT V1

READ ONLY. Production write 0 · cron 설정 변경 0 · schema 0 · env 0 · 서울 노출 변경 0.

## 판정: **MORE_CODE_WORK_REQUIRED** (작은 코드 변경 + 승인 1건) — 그 뒤 "서울 cron만 ON"은 가능하다

서울 데이터 동기화와 서울 공개는 **분리할 수 있다**. 다만 지금 코드로는 cron에 서울 구를 넘길 방법이 없고,
가장 눈에 띄는 스위치(`enablement.cronSync`)는 이름과 달리 **읽기 경로 스위치**라서 그것을 켜면 안 된다.

## 1. 현재 매매 cron 구조

| 항목 | 현재 |
|---|---|
| 등록 | `vercel.json` — `sale-sync?mode=apply` 19:00 UTC(04:00 KST) · `rent-sync` 06:00 KST · `sale-recheck?mode=apply` 08:00 KST |
| 인증 | `CRON_SECRET` Bearer(fail-closed), mode 기본 dry-run |
| 구 목록 | `runSaleSync`: `opts.lawdCds ?? BUSAN_LAWDCD_16` — 라우트는 `lawdCds`를 넘기지 않는다(받는 것은 `districtOffset/districtLimit`뿐, 부산 16개 안에서 자르기만 한다). recheck도 동일 |
| 일일 창 | `SALE_DEFAULT_OVERLAP_MONTHS = 3` → `latestComplete−2 ~ 현재월` = **4개월**(오늘 202606~202609) |
| recheck 창 | `latestComplete−12 ~ latestComplete−3` = 10개월, 검증이 오래된 셀부터, 45초 예산 |
| 쓰기 | `syncOneSaleCell` → `planSaleCellWrites` — 신규 insert, 그룹 단위 취소 reconcile, 그룹 insert, registry 보충. **delete 경로 없음** |
| 실측(09-22) | 매매 run 64셀(기록 48 + 현재월 16) **약 22초**/50초 예산 · recheck 122셀 **약 42초**/45초(전날 38셀) |

**부산만 도는 이유**: 구 목록이 `BUSAN_LAWDCD_16` 상수로 고정돼 있고 cron URL로 바꿀 수 없다. enablement 설정을 읽지 않는다.

## 2. 동기화 vs 공개 — PARTIALLY_COUPLED

| 축 | 무엇이 결정하나 | cron 실행과의 관계 |
|---|---|---|
| A. 데이터 cron | `BUSAN_LAWDCD_16` 상수 | — |
| B. stats | `enablement.stats` (region/stats-gate) | 독립 |
| C. app 지역 노출 | `enablement.app` | 독립 |
| D. SEO / E. sitemap | `seoIndex` / `sitemap` | 독립 (live sitemap 서울 0) |
| F. reports | `report` + coverage(구별 필터) | 독립 |
| G. 검색 | app 노출 | 독립 |
| **`enablement.cronSync`** | 상세 `/api/apt/[name]`·지도 `/api/transactions`의 **DB-first 읽기**, 통계 피드의 DB 시도(`FEED_DB_SIDO_CODE`) | **이름만 cron** — 실제 cron 목록은 이 값을 읽지 않는다 |

결론: cron 목록 자체는 공개 축과 **독립**이다. 그러나 `cronSync`를 서울에 켜면 cron은 여전히 부산만 돌면서
**서울 상세·지도 읽기만 DB-first로 바뀐다**(stats 게이트를 거치지 않는 경로 — 코드 주석이 강남 46행 부분 데이터로 전체 이력을 가리는 위험을 직접 경고한다).
→ 서울 동기화는 `cronSync`를 건드리지 않는 **별도 구 목록**으로 해야 한다.

## 3~4. 범위와 창

- 적재된 서울 구: 종로 11110 · 중구 11140 · 용산 11170(전체 이력) + 강남 11680(**202608 한 달, 46행 파일럿**).
- 일일 4개월 창 + recheck 3~12개월 창이 합쳐 **최근 12개월의 늦은 신고·취소를 흡수**한다. 중구 재측정에서 나온 늦은 신고 3건(2026-07-28, 2026-09-04×2)은 전부 일일 창 안이다.
- **강남은 제외**해야 한다: 일일 창이 202606~202609를 채우고 recheck가 과거 10개월을 조금씩 채워, 강남은 "파일럿도 전체 이력도 아닌" 들쭉날쭉한 부분 이력이 된다. 강남은 전체 이력 backfill(계획 추정 86,153행 · 약 255 호출) 뒤에 넣는다.

## 5. 취소 경로 동일성

서울 cron도 **같은 `syncOneSaleCell`** 을 쓴다(backfill apply도 이 함수였다) — occurrenceIndex, 그룹 개수 기반 reconcile(`reconcileGroupCancellation`),
형제 수 불일치 시 skip(`SIBLING_COUNT_MISMATCH`), 기존 형제가 있는 그룹의 그룹 insert(`planGroupInserts`), 삭제 없음 → 일시 부재(withdrawal)는 행을 지우지 않는다.
부산과 다른 코드 경로 **없음**. `sale-sync-core`에 부산 전용 가정은 기본 구 목록 하나뿐.

## 6. master 안전성

sync 쓰기 경로에는 master 생성·연결 코드가 **없다**(`apartmentMaster` 참조 0). aptSeq를 그대로 싣고(`identity_key = id:{aptSeq}`), aptSeq 없는 새 행은 insert하지 않는다(reviewRequired).
→ master 없는 과거 단지(중구 547/38 · 종로 617/47 · 용산 1,171/66)는 transaction-only 그대로이고, 새 historical master가 생기지 않는다.

## 7. quota

| 항목 | 호출/일 |
|---|---|
| 부산 매매 일일 | 16구 × 4개월 ≈ **64** |
| 부산 recheck | 예산 한도 ≈ **120~160** |
| **서울 3구 일일** | 3 × 4 = **12** |
| 서울 3구 recheck(전체 창을 하루에 돈다고 가정한 상한) | 3 × 10 = **30** |
| (강남 포함 시 추가) | 4 + 10 = 14 |
| cron 합계 | ≈ 230~270 (강남 포함 ≈ 250~280) = 한도 10,000의 **3% 미만** |

reserve 2,000을 빼도 하루 **약 7,500 호출**이 backfill에 남는다(구 하나 전체 이력 ≈ 255 호출).

## 8. backfill 공존 규칙 (제안만 — 구현 없음)

- 같은 셀 겹침: cron은 최근 12개월, backfill은 전체 이력이라 **겹친다**. 두 경로 모두 같은 자연키 unique + `skipDuplicates`라 중복 행은 생기지 않지만, 같은 셀을 동시에 쓰면 reconcile 판단이 서로의 결과를 모른 채 겹칠 수 있다.
- 규칙 제안: ① backfill은 cron 창(04:00·06:00·08:00 KST ±30분) 밖에서만 ② backfill 대상 구는 apply가 끝나고 사후 검증을 통과한 뒤에만 cron 목록에 추가 ③ backfill 시작 전 quota ≥ 예상 호출 + 2,000 확인(지금처럼) ④ 한 번에 한 프로세스(동시 MOLIT batch 금지) ⑤ checkpoint 디렉터리는 구별로 분리(지금처럼).
- recheck 예산은 이미 거의 차 있다(42/45초) — 서울 recheck는 **별도 호출**로 두어 부산 sweep을 늦추지 않는다.

## 9. 현재 신선도 (Production READ ONLY)

| 구 | 행 | 최신 거래일 | 최신 등기일 | 마지막 수집(UTC) | 일일 창(202606~) 행 |
|---|---|---|---|---|---|
| 종로 11110 | 11,587 | 2026-09-14 | 26.09.15 | 2026-09-22 05:48 | 103 |
| 중구 11140 | 17,826 | 2026-09-12 | 26.09.17 | 2026-09-22 02:05 | 181 |
| 용산 11170 | 25,675 | 2026-09-19 | 26.09.17 | 2026-09-22 05:53 | 185 |
| 강남 11680 | 46 | 2026-08-24 | 26.08.18 | 2026-08-31 14:57 | 46(202608만) |

세 구는 **오늘 수집**이라 지금은 최신이다. 내일부터 하루씩 늦어지고, 새 신고·새 취소·등기일 보충이 전혀 반영되지 않는다. 서울 coverage 셀은 0개(backfill은 coverage를 쓰지 않는다).

## 10~11. 필요한 변경과 정확한 범위

**코드(작음, 되돌리기 쉬움)**
1. 서울 동기화 구 목록 상수 `11110 · 11140 · 11170` — `enablement.cronSync`가 **아니라** 별도 상수.
2. `sale-sync`·`sale-recheck` 라우트에 허용 목록 방식의 `scope=seoul` 파라미터(임의 lawdCd 입력은 받지 않음) → `runSaleSync({ lawdCds })`.
3. `/admin/ops`의 `summarizeCoverage('SALE')`·`summarizeSaleRunKinds()`는 구 필터가 없다 — 서울 셀이 섞이지 않게 부산 16구로 좁히거나 시도별로 나눈다(관리자 화면만 영향).

**Production 변경(승인 필요)**: `vercel.json`에 서울 호출 2개(예: 매매 04:15 KST · recheck 08:15 KST, 부산 호출과 분리) — push = 배포.

**필요 없음**: schema 0 · env 0 · 서울 공개 0 · `cronSync` 변경 0.

**정확한 범위**: 종로 11110 · 중구 11140 · 용산 11170. 강남 11680 제외(전체 이력 backfill 후 편입).
