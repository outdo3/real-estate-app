# E-JIP SEOUL JUNG-GU FULL HISTORY RETRY V1

서울 중구(`11140`) 아파트 매매 전체 이력(2005-07 ~ 2026-09, SALE only)을 Production에 적재했다.
어제(`SEOUL_SALE_PHASE_A_FULL_HISTORY_APPLY_V1`) quota gate에서 멈춘 승인 범위를 그대로 재개한 것이다.
정책은 동일: aptSeq canonical identity, historical master-missing은 **transaction-only**(master 생성 0, fallback 0).

## 결과 요약

| 항목 | 값 |
|---|---|
| 판정 | **PASS** |
| apply | 2026-09-22 11:04~11:05 KST · mode APPLIED · **insert 16,883 / update 0 / delete 0** · MOLIT 호출 **0**(checkpoint 재사용) |
| 중구 행 | 943 → **17,826** (active 17,489 · canceled 337) = 원천과 정확히 일치 |
| 전체 sale 행 | 866,572 → **883,455** (+16,883) · canceled 16,383 → 16,665 (+282 = 계획의 insertCanceled) |
| 다른 시도 | 부산 865,497 · 대구 86 · 강남 46 **불변** |
| quota | 전 9,810 → dry-run 후 9,555 → apply·검증 호출 0 |

## 1. quota / 실행 창

- 1-cell probe(1 call): remaining **9,810** / 10,000 — 기준(≥2,600, 권장 ≥3,000) 충족.
- 실행 10:52 KST — 당일 04:00/06:00/08:00 cron 이후, 다음 cron은 익일 04:00. 동시 실행 프로세스 없음.
- 주의: Git Bash의 `TZ=Asia/Seoul date`는 무시되고 UTC를 출력한다. KST는 `node -e` + `timeZone`으로 확인했다.

## 2. fresh dry-run (`--out=tmp/seoul-junggu-full-retry-v1`)

255 cells 전부 READY · calls 255.

| 항목 | 기준선(09-21) | fresh | 차이 |
|---|---|---|---|
| source total | 17,823 | **17,826** | +3 |
| active | 17,486 | 17,489 | +3 |
| canceled | 337 | 337 | 0 |
| existing exact | 943 | 943 | 0 |
| planned inserts | 16,880 | **16,883** | +3 |
| updates / collisions / skips / drift | 0 | 0 | — |
| master-missing | 547 / 38 aptSeq | 547 / 38 | 0 |

**+3의 위치를 확정했다.** 2025-09 이전(historical) 계획은 **정확히 16,880**(canceled 282, master-missing 547, 최대 거래일 2025-09-30)으로 기준선과 동일하다.
+3은 전부 pilot 창 안의 **뒤늦게 신고된 정상 거래**다: 2026-07-28 `11140-16` 1건, 2026-09-04 `11140-37` 2건 —
전부 EXACT_MASTER · 비취소 · occurrenceIndex 0(형제 없는 신규 그룹). 서울은 cron 대상이 아니라 pilot 이후 신규 신고가 쌓인 것.
→ STOP 조건 해당 없음. `--expect-inserts=16883`(fresh 값)으로 apply.

## 3. apply

사용자 실행: `--apply --expect-inserts=16883 --out=tmp/seoul-junggu-full-retry-v1`(같은 checkpoint).
`summary.json`: mode APPLIED · calls **0** · writes insert 16,883 / update 0 / delete 0.
`applied-2026-09-22T02-05-53-915Z.json`: 255 cells(COMPLETE 249 · EMPTY_VALID 6), 셀별 inserted == expectedActualInserts, 불일치 셀 0.

## 4. post-apply 검증 (전부 READ ONLY · MOLIT 0 · write 0)

**스냅샷** (`scripts/audit-junggu-pilot-apply-verify.ts`, PRE/POST): 중구 17,826 / 17,489 / 337, null aptSeq 0,
natural-key 중복 전역 0 · 중구 0, junggu_master_exact 17,279 + master_missing 547, all-canceled groups 247 → **247(불변)**,
multi-sibling 13,115 → 13,353(+238, 중구 자체 반복 자연키이며 all-canceled 0).

**원천↔DB 전수 parity — 진짜 재계획.** 같은 checkpoint의 재실행은 셀이 APPLIED라 저장된 계획만 재사용한다
(inserts 16,883 → expectedSkips 16,883 → 실제 0; 원천 0행 재평가). 이것만으로는 원천↔DB 비교가 아니므로,
checkpoint를 **별도 디렉터리**(`tmp/seoul-junggu-full-retry-v1-replan`)로 복사해 셀 상태만 FETCHED로 바꾸고
캐시된 `raw/*.json.gz`(255개)로 **live DB에 대해 다시 계획**했다. 원본 checkpoint는 손대지 않았다.

| 재계획 결과 | 값 |
|---|---|
| calls | **0** |
| source | 17,826 (17,489 / 337) |
| inserts / updates / drift | **0 / 0 / 0** |
| existingMatched | **17,826** |
| cancelFlips / cancelRestores | **0 / 0** |
| review / paging errors / collisions | 0 / 0 / 0 |

셀별: 255개 전부 `collected == DB existing == matched`(합 17,826 = 17,826 = 17,826) → **DB-only 행 0**.

**identity · 월별 취소 parity** (`tmp/seoul-junggu-full-retry-v1-replan/verify-identity.ts`, READ ONLY tx):

- 범위: deal_ymd 2006-01 ~ 2026-09, 범위 밖 0, non-sale 0 (2005-07~12는 MOLIT 자체가 0건 — EMPTY_VALID)
- identity: null aptSeq 0 · `11140-` 아닌 aptSeq 0 · `identity_key ≠ id:{aptSeq}` 0 · distinct aptSeq 145 · 다른 구에 실린 `11140-*` 0
- 그룹: 17,465 · multi 283(= 원천 sameConditionGroups 283) · **all-canceled multi 0**
- 월별(원천 raw `cdealType='O'` ↔ DB): 255개월 **행 수·취소 수 불일치 0**, DB-only 월 0

## 5. 노출

`src/lib/region/enablement.ts`의 `ENABLEMENT_BY_SIDO`에 `'11'`은 주석뿐(09-19 이후 변경 없음) → 서울은 app/report/stats/sitemap/seo/cron 전부 NOT_ENABLED.
Production sitemap 138 URL 중 서울 0. **데이터 적재만 했다.**

## 알려진 문제 (이번 STEP 범위 밖)

- **known28 `still_canceled` = 2**(09-21 repair 직후 0). 2026-09-22 04:59 KST sale-sync가 마지막으로 건드렸고,
  all-canceled groups 245 → 247, suspect upper bound 304 → 306. **부산** 건이며 중구 apply 전(PRE)부터 이 상태 —
  이번 적재와 무관. 09-21의 "재오염 위험 없음" 결론과 어긋나므로 별도 read-only 조사가 필요하다.
- master-missing 547행 / 38 aptSeq는 transaction-only로 적재됐다(정책대로). 지도는 12개월만 읽고 전부 2024-07-17 이전이라 노출 0.

## 다음 STEP

1. known28 재오염 조사(read-only): `scripts/audit-defect-a-28-repair-verify.ts --label=POST_CRON`부터.
2. 서울 추가 구(Phase B 종로·용산)는 별도 승인. 서울 공개 시에는 `stats`와 `cronSync`를 **함께** 연다.
