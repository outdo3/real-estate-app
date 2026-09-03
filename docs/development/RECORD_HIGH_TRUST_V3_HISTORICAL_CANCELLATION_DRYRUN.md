# RECORD HIGH TRUST V3 — HISTORICAL CANCELLATION RESYNC DRY-RUN

- 상태: **DRY-RUN 완료 (READ ONLY)** — Production UPDATE/INSERT/DELETE **0건**
- 실행일: 2026-09-03
- 스크립트: `scripts/record-high-trust/historical-cancellation-scan.ts` (write 호출 없음)
- 실행 환경: controlled local CLI (Vercel Lambda 미사용)

---

## 1. 대상 범위

부산 16개 구 × 2020-02 ~ 2024-08 = **55개월 × 16 = 880 cells** (코드에서 재계산, 예상과 일치).
A구간(2020-01 이전)과 C구간(2024-09 이후, 기존 24개월 SAFE)은 제외.

## 2. Source fetch completeness

| 항목 | 결과 |
| --- | ---: |
| cells total | 880 |
| **cells COMPLETE** | **880 (100%)** |
| cells BLOCKED | **0** |
| PARTIAL / INVALID | 0 |
| invalid(정규화 탈락) | 0 |
| page omission / duplication | 0 |
| source rows fetched | **177,980** |
| API calls | 892 |

`fetchSaleRegionMonth()`의 `totalCount == collectedCount` 검증을 880셀 전부 통과.

## 3. 매칭 정책

기존 검증된 자연키만 사용: `(groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex)`.
`groupKeyStr = identityKey::areaKey::dealType`, `identityKey = id:{aptSeq}`.
name-only fallback / loose substring / dong fallback / first-match **미사용**.

**DB rows matched: 177,980 / 177,981 (99.9994%)**

## 4. 분류 결과

| 분류 | 정의 | 건수 |
| --- | --- | ---: |
| **A** unchanged valid | DB=false / source=false | **166,499** |
| **B** flip candidate | DB=false / **source=true** | **10,852** |
| **C** already canceled | DB=true / source=true | **629** |
| **D** reverse conflict | DB=true / source=false | **0** |
| **E** unmatched (source only) | source에 있고 DB에 없음 | **0** |
| **E** unmatched (DB only) | DB에 있고 source에 없음 | **1** |
| 기타 필드 mutation | aptName/dong/area/aptSeq 변화 | **0** |

`C = 629`는 V2 APPLY에서 삽입한 canceled-at-source 행 수와 **정확히 일치**한다 —
즉 V2 이전 B구간의 취소 정확도는 0건이었고, 현재 정확한 629건은 전부 V2가 넣은 것이다.

apply 후 B구간 취소는 629 + 10,852 = **11,481 / 177,981 = 6.45%**로,
V1 감사가 추정에 쓴 4.26~6.95% 범위 안에 정확히 들어온다(V1 추정 7,000~12,000 → 실측 10,852).

## 5. false → true 후보 (§4)

- **10,852건**, 영향 셀 **836 / 880**
- **`cancelDate` 누락 0건** — 10,852건 전부 원천 해제일을 보유(형식 `"YY.MM.DD"`)
- 샘플:
  - `26140-40 남성한빛가든` 59.34㎡ 2020-02-25 17,000 → cancelDate `20.03.11`
  - `26230-1 네오스포` 59.901㎡ 2020-02-25 16,800 → cancelDate `20.05.01`
  - `26230-1824 개금롯데캐슬` 84.9542㎡ 2020-02-21 39,150 → cancelDate `20.04.16`

## 6. Reverse conflict (§5)

**0건.** `DB=true / source=false`는 880셀 177,980행 전수에서 한 건도 없다.
V2의 23셀(31,446행)에서도 0건이었으므로, 누적 **약 209,000행 비교에서 역전 사례 0**이다.
따라서 이번 apply에서 true→false 자동 수정을 고려할 필요 자체가 없다(정책상으로도 금지).

## 7. 기타 mutation (§6)

`aptName / dong / exclusiveArea / aptSeq` 불일치 **0건**. cancellation 외 필드가 변한
거래는 없으므로, cancellation UPDATE와 섞일 위험이 없다.

## 8. E — 원천에서 사라진 거래 1건 (NEEDS_REVIEW, 삭제 금지)

| 항목 | 값 |
| --- | --- |
| cell | `26350 / 202104` |
| 자연키 | `id:26350-2109::137.32::sale\|75000\|2021-04-02\|7\|0` |
| aptName | 현대아쿠아팰리스동백섬 |
| DB dealCanceled | false |

오늘 해당 셀을 재조회하면 `totalCount 572`, 572건 전부 수신되지만 이 거래가 없다.
같은 달 응답에서 "아쿠아팰리스"를 포함하는 항목은 `현대아쿠아팰리스해운대`(61.03㎡, 44,000) 하나뿐이며
`현대아쿠아팰리스동백섬` 이름 자체가 등장하지 않는다. 동일 금액(75,000)+동일 일자(2일) 항목도 0건이다.

**판정: 취소가 아니라 "원천에서 사라진 거래".** 사유가 확인되지 않았으므로
- **DELETE 금지** (프로젝트 정책상으로도 금지)
- cancellation 후보가 아니므로 이번 resync를 막지 않는다
- 177,981행 중 1건(0.0006%)이며 별도 NEEDS_REVIEW로 남긴다

## 9. 예상 Production write (§7)

향후 APPLY가 승인될 경우 필요한 write:

```
UPDATE 10,852 rows
  dealCanceled : false -> true
  cancelDate   : source 실제값 (10,852건 전부 존재)
  registryDate : source 실제값
  sourceFetchedAt : now()
INSERT 0
DELETE 0
```

그 외 거래 필드(금액/일자/층/면적/identity)는 변경하지 않는다.

## 10. 멱등성 설계 (§8)

기존 `write-policy-logic.ts`의 `classifyRow()`를 그대로 재사용할 수 있다.

- `updateFalseToTrue`만 write, `updateTrueToFalseSkipped`는 차단 → **구조적 단방향**
- flip write가 `dealCanceled: true`를 하드코딩하므로 재실행해도 같은 상태로 수렴
- apply 후 재실행 시 이 10,852건은 전부 분류 `C(already canceled)`로 이동 →
  **false→true candidate = 0**

`scripts/resync-cancellation-v2.ts`가 `--from` / `--to` / `--lawdCd` / `--apply` /
`--maxBatches`를 모두 받으므로, **신규 코드 없이** 다음 한 줄로 apply 가능하다:

```
scripts/resync-cancellation-v2.ts --from=202002 --to=202408 --apply
```

**단, 승인 시 반드시 알아야 할 점:** 이 도구의 `classifyRow`는 `updateFalseToTrue`뿐 아니라
`insert`(자연키 미매칭 + aptSeq 있음)도 수행한다. 이번 스캔에서 **unmatched(source only) = 0**
이므로 실제 INSERT는 0건이 될 것으로 예상되지만, 승인 범위를 "UPDATE만"으로 한정하려면
insert 상한을 0으로 강제하는 게이트를 추가해야 한다.

## 11. Legacy backfill 역전 위험 (§9) — 판정: **P0 아님 (MEDIUM)**

**도달 경로 (실측):**

| 경로 | 위험 |
| --- | --- |
| `scripts/backfill-trade-history.ts --apply` | `upsertRows()` → update 절이 `dealCanceled: row.dealCanceled` 무조건 덮어씀 |
| `scripts/sync-trade-history.ts --apply` | `runTradeHistoryJob()` import → 같은 `upsertRows()` 경유. **문서상 "최근 실거래 rolling refresh" 정기 작업**이라 실수 실행 가능성이 상대적으로 높음 |
| Vercel Cron | **해당 없음** — cron은 `src/lib/sync/**`를 쓰고 단방향 `classifyRow` 정책을 따름 |
| `resync-cancellation-v2.ts`, `incremental-sync-nationwide.ts` | 안전 — `fetchOneRegionMonth`/`makeLogger`만 import, `upsertRows` 미사용 |

두 스크립트 모두 `_prod-db-guard` **미적용**(가드는 진단 스크립트 5개에만 적용됨).

**그러나 실제 발동 조건은 관측된 적이 없다.** 역전이 일어나려면 원천이 true→false로
되돌려야 하는데, V2(31,446행) + V3(177,980행) = **약 209,000행 비교에서 reverse는 0건**이다.
또한 Phase 1.5 이후 `fetchOneRegionMonth()`는 paginated fetcher를 쓰고 PARTIAL/INVALID일 때
items를 비워 반환하므로, 재실행이 데이터를 재절단하지도 않는다.

**판정: 이론적 취약점은 실재하나 P0는 아니다.** V1에서 "역전 가능성"으로 지적한 것을
실측으로 재평가하면 MEDIUM이다. 권장 fail-safe(이번 STEP에서는 **수정하지 않음**):
1. `upsertRows()`의 update 절에서 `dealCanceled` 다운그레이드 차단
   (`classifyRow` 재사용, 또는 `dealCanceled: row.dealCanceled || undefined` 류의 단방향화)
2. 두 스크립트에 `assertProductionDbAccessAllowed('BACKFILL', ...)` 적용

## 12. record-high 영향 (§11)

### 12.1 현재 rolling 24개월 — **영향 0**

10,852건 중 `dealDate >= 오늘 − 24개월`인 후보 **0건**. 대상 범위 상한이 2024-08이고
rolling 창 시작이 2024-09이므로 구조적으로 겹치지 않는다. 현재 `2년최고가` 기능은
이번 apply 전후로 **결과가 바뀌지 않는다**.

### 12.2 장기(2020-02~) 최고가 기능을 만들 경우 — **946건이 실제 왜곡 요인**

각 후보에 대해, 같은 `group_key`(단지 identity + 정확한 전용면적)에서 2020-02 이후
**취소되지 않은 것으로 기록된** 거래의 최고가와 비교했다.

**946건의 후보가 자기 그룹의 현재 최고가와 같거나 그보다 높다.**
즉 이 946건을 지금 상태로 두면, 장기 최고가 기능을 만들었을 때 **실제로는 취소된 거래가
그 단지·면적의 최고가로 표시**된다.

샘플:

| 단지 | 면적 | 거래일 | 금액(만원) | 그룹 최고가 | 해제일 |
| --- | ---: | --- | ---: | ---: | --- |
| 해운대 I PARK | 156.508 | 2020-02-24 | 113,000 | 113,000 | 20.06.30 |
| 우성빌라(백세해운대빌라2차) | 142.95 | 2020-03-13 | 44,500 | 44,500 | 20.05.28 |
| 오양양지 | 68.31 | 2020-03-12 | 33,905 | 33,905 | 20.04.08 |
| 허브센티움Ⅲ | 52.25 | 2020-02-26 | 18,000 | 18,000 | 20.03.17 |

이는 V1이 지적한 "취소 거래는 고가 편향(자전거래/업계약)" 가설과 방향이 일치하며,
**장기 최고가 기능의 전제조건이 이번 resync임**을 정량적으로 보여준다.

## 13. 성능 (§10)

| 항목 | 값 |
| --- | ---: |
| cells | 880 |
| API calls | 892 |
| source rows fetched | 177,980 |
| DB rows matched | 177,980 |
| runtime | **512초 (8분 32초)** |
| 예상 DB updates | 10,852 |

Vercel 60s Lambda에 넣지 않는다 — apply도 controlled local CLI로 실행해야 한다.

## 14. 판정

**APPLY readiness: READY**

- cells COMPLETE 880/880, BLOCKED 0
- reverse conflict 0, 기타 mutation 0, identity mismatch 0
- cancelDate 완전성 10,852/10,852
- rolling 24개월 영향 0 (회귀 위험 없음)
- 멱등성 단방향 수렴 구조 확인

단 하나의 NEEDS_REVIEW는 §8의 "원천에서 사라진 거래 1건"이며, cancellation 후보가
아니므로 apply를 막지 않는다(삭제 금지, 그대로 보존).

## 15. 필요한 승인 (§21)

```
apartment_trade_histories UPDATE 정확히 10,852행
  dealCanceled false -> true
  cancelDate / registryDate : source 실제값
  (그 외 거래 필드 불변)
INSERT 0 (게이트로 강제 권장)
DELETE 0
schema/migration/index 변경 없음
```

실행 도구: `scripts/resync-cancellation-v2.ts --from=202002 --to=202408 --apply`
(신규 코드 불필요, 기존 단방향 write 정책 그대로) + INSERT 0 게이트.

## 16. 다음 단계

1. **RECORD HIGH TRUST V3 APPLY** (승인 필요) — 위 10,852건 UPDATE.
2. **옵션 C — 취소 lag 커버리지 확대**(cron overlap 3→12개월). V1 §6에서 확인한
   "취소의 10.5%가 거래 3개월 이후 발생" 문제로, apply 이후에도 계속 누적되는 유일한 항목.
3. **legacy backfill fail-safe** (MEDIUM) — §11의 2가지 권장 조치.
4. **FULL CAP SWEEP** — 부산 3,973셀 전수 `totalCount` 대조(read only).
