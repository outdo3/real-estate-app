# E-JIP SEOUL PHASE B — JONGNO + YONGSAN FULL HISTORY DRY-RUN V1

**판정: READY_FOR_APPLY_APPROVAL.** Production write 0 · schema 0 · env 0 · 서울 노출 변경 0. apply는 하지 않았다.
범위: 종로구 `11110` · 용산구 `11170` · 2005-07 ~ 2026-09 · SALE only · 정책은 중구와 동일(aptSeq canonical, historical master-missing은 transaction-only, master 생성·fallback 0).

## 1. 기준선 (2026-09-22 14:2x KST, READ ONLY)

전체 sale **883,455**(active 866,790 · canceled 16,665) · 서울 **17,872** = 중구 `11140` **17,826** + 강남 `11680` 46 · 부산 865,497 · 대구 86 ·
자연키 중복 0 · 종로/용산 기존 행 **0**. master: 종로 **99** · 용산 **183**(전부 aptSeq 보유, 구 코드 불일치 0).
`src/lib/region/enablement.ts`에 `'11'`은 주석뿐(09-19 이후 변경 없음) → 서울 stats/SEO/cron/UI 비노출 유지.

## 2. quota · 실행 창

| 항목 | 값 |
|---|---|
| 한도 | 10,000 |
| 시작 전 remaining (1-cell probe, 종로 202609 — 같은 checkpoint에 들어가 재사용됨) | **9,249** |
| 예상 호출 | 255개월 × 2구 = **510** (page 1,000 — 한 달도 2페이지가 필요 없었다) |
| 실제 호출 | 1 + 254 + 255 = **510** |
| 종료 후 remaining | **8,740** (reserve 2,000 대비 +6,740) |

14:24 KST 실행 — 부산 cron(04/06/08시) 창 밖, 동시 실행 MOLIT 프로세스 없음. 두 구는 순서대로(동시 아님).

## 3. 구별 결과

| 항목 | 종로 11110 | 용산 11170 |
|---|---|---|
| 월 셀 | 255 READY (EMPTY 6: 2005-07~12 · ERROR 0) | 255 READY (EMPTY 4: 2005-07~11 대역 · ERROR 0) |
| paging | 전 셀 `totalCount == collected`, 오류 0 | 동일 |
| source total | **11,587** | **25,675** |
| active / canceled | 11,397 / 190 | 25,275 / 400 |
| DB existing | 0 | 0 |
| planned inserts | **11,587** | **25,675** |
| planned updates · cancel flips · restores | 0 · 0 · 0 | 0 · 0 · 0 |
| collisions · expected skips · review | 0 · 0 · 0 | 0 · 0 · 0 |
| master exact | 10,970 | 24,504 |
| master-missing | **617 rows / 47 aptSeq** (마지막 거래 2024-08-21) | **1,171 rows / 66 aptSeq** (마지막 거래 2024-09-25) |
| planned canceled inserts | 190 (= source canceled) | 400 (= source canceled) |

master-missing은 전부 최근 12개월 거래가 없다(지도는 12개월만 읽고, master 없는 거래는 마커를 만들지 않는다 — 노출 0).

## 4. 신뢰 감사 (raw 캐시에서 운영 normalizer로 전 행 재구성 — MOLIT 0 호출)

용산의 `ready-inserts.json`은 드라이버가 크기를 잘라 저장한다(`truncated: true`). 그래서 행 단위 감사는 그 파일이 아니라
각 구 `raw/*.json.gz` 255개를 드라이버와 같은 `mapMolitItems → normalizeMolitItemsToTradeRows`로 다시 만들어 **전 행**에 대해 했다.
재구성 행 수 = 드라이버 source 수(종로 11,587 · 용산 25,675, invalid 0).

| 검사 | 종로 | 용산 |
|---|---|---|
| aptSeq가 자기 구 코드가 아님(wrong-district) | 0 | 0 |
| aptSeq 없음 | 0 | 0 |
| identity_key ≠ `id:{aptSeq}::…` | 0 | 0 |
| 구 안 자연키 중복 | 0 | 0 |
| **두 구 사이 자연키 겹침** | **0** | |
| 기존 DB 자연키와 충돌(드라이버 `existingNaturalKeys`) | 0 | 0 |
| 같은 금액·거래일·층 형제 그룹 | 158 (2:139 · 3:8 · 4:5 · 5:4 · 6:2) | 303 (2:280 · 3:17 · 4:6) |
| occurrenceIndex 0..n−1 연속 아님 | 0 | 0 |
| 취소인데 해제일 없음 | 0 | 0 |
| 형제 전원 취소 그룹 | 8 | 6 |

형제 전원 취소 그룹은 **원천 자체의 상태**다 — 예: 종로 `11110-2290` 2020-10-18 3세대 동일 조건 거래가 같은 날(`21.03.26`) 일괄 해제,
용산 `11170-200` 2024-06-08 두 건이 각자 다른 날(`24.08.10`·`24.08.14`) 해제. 기존 행이 0이고 flip 0이라 Defect-A(응답 순서 래칫·형제 수 불일치)는 구조적으로 생길 수 없다.
apply 후 전체 "형제 전원 취소" 지표는 247 → **261**(+14)이 되며, 이는 원천을 그대로 반영한 것이다(재오염 아님).

## 5. Phase B 합계와 과거 추정

| 항목 | 값 |
|---|---|
| source total | **37,262** (종로 11,587 + 용산 25,675) |
| active / canceled | 36,672 / 590 |
| planned inserts / updates | **37,262 / 0** |
| master-missing | 1,788 rows / 113 aptSeq |
| API calls | 510 |

`SEOUL_SALE_BACKFILL_PLAN_V1.md`의 실측 추정(종로 11,582 · 용산 25,673) 대비 +5 · +2 — 뒤늦은 신고 수준의 자연 변동(중구 +3과 같은 양상). **fresh 값을 쓴다.**

## 6. apply 준비 (실행하지 않음)

checkpoint(셀 상태 READY 그대로, APPLIED로 바꾸지 않음): `tmp/seoul-phase-b-jongno-full-v1` · `tmp/seoul-phase-b-yongsan-full-v1`.
같은 `--out`으로 apply하면 raw 캐시를 재사용해 **MOLIT 0 호출**이고, 검증한 계획이 그대로 쓰인다(드라이버가 `--expect-inserts` 불일치를 스스로 거부).

```
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 npx tsx scripts/backfill-seoul-sale.ts --district=11110 --from=2005-07 --to=2026-09 --apply --expect-inserts=11587 --out=tmp/seoul-phase-b-jongno-full-v1
ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 DEFECT_A_GATE_PASS=1 npx tsx scripts/backfill-seoul-sale.ts --district=11170 --from=2005-07 --to=2026-09 --apply --expect-inserts=25675 --out=tmp/seoul-phase-b-yongsan-full-v1
```

`--approve-existing-updates`는 붙이지 않는다(업데이트 0). apply 후 기대값: 전체 **920,717** · 서울 **55,134** · 종로 11,587 · 용산 25,675 · 중구 17,826 불변.

## 7. POST-APPLY VERIFY V1 — **PASS** (READ ONLY · MOLIT 0 · write 0)

apply는 사용자가 실행했다(2026-09-22 14:47~14:53 KST, 같은 checkpoint). 드라이버 산출물 기준:
종로 `APPLIED` · calls 0 · insert **11,587** / update 0 / delete 0 · 255셀(COMPLETE 249 · EMPTY_VALID 6) · 불일치 셀 0 ·
용산 `APPLIED` · calls 0 · insert **25,675** / update 0 / delete 0 · 255셀(COMPLETE 251 · EMPTY_VALID 4) · 불일치 셀 0.

| 항목 | apply 전 | apply 후 |
|---|---|---|
| 전체 sale | 883,455 | **920,717** (+37,262) |
| canceled | 16,665 | 17,255 (+590 = 190 + 400) |
| 서울 | 17,872 | **55,134** |
| 종로 11110 | 0 | **11,587** (11,397 / 190) |
| 용산 11170 | 0 | **25,675** (25,275 / 400) |
| 중구 11140 · 강남 11680 | 17,826 · 46 | 17,826 · 46 (불변) |
| 부산 · 대구 | 865,497 · 86 | 불변 |
| 자연키 중복(전역) | 0 | 0 |
| 형제 전원 취소 그룹 | 247 | **261** (+14) |
| suspect upper bound | 306 | 322 (+16) |

**원천 ↔ DB 전수 parity** (저장된 raw를 운영 normalizer로 재구성해 DB와 대조):

| 검사 | 종로 | 용산 |
|---|---|---|
| 행 수 / 취소 수 | 11,587 = 11,587 · 190 = 190 | 25,675 = 25,675 · 400 = 400 |
| 월별(행·취소) 불일치 | 0 (거래 있는 달 249 + EMPTY 6 = 255) | 0 (251 + EMPTY 4 = 255) |
| 형제 그룹(형제 수·취소 수·**해제일 multiset**) 불일치 | 0 / 11,391그룹 | 0 / 25,343그룹 |
| occurrenceIndex gap | 0 | 0 |
| aptSeq 없음 · 다른 구 aptSeq · identity_key ≠ `id:{aptSeq}` | 0 · 0 · 0 | 0 · 0 · 0 |
| 이 구의 aptSeq가 다른 lawd_cd에 실린 행 | 0 | 0 |
| 범위 밖 · non-sale | 0 · 0 | 0 · 0 |
| master 없는 행(transaction-only) | 617 / 47 aptSeq | 1,171 / 66 aptSeq |

**형제 전원 취소 +14의 출처**: 종로 8그룹(크기 2×6 · 3×2) + 용산 6그룹(2×6) — 전부 원천에도 같은 형제 수·같은 해제일로 전원 취소다.
suspect upper bound는 Σ(형제−1)이라 +16 = 종로 10 + 용산 6. 재오염이 아니라 원천의 진짜 취소 그룹이다.

**멱등성(fresh 재계획)**: checkpoint를 `*-replan` 디렉터리로 복사해 셀 상태만 APPLIED → FETCHED로 바꾸고 raw 캐시로 live DB에 다시 계획(원본 checkpoint 불변).
종로 inserts 0 · matched 11,587 · updates/flips/restores/drift 0 · 용산 inserts 0 · matched 25,675 · 0/0/0/0 · **MOLIT 0 호출** · 두 구 255셀 모두 source = DB = matched.

**서울 노출**: `enablement.ts`의 `'11'`은 주석뿐(09-19 이후 변경 없음) · live sitemap 138 URL 중 서울 0. 앱·통계·SEO·sitemap·cron 전부 OFF 유지.

