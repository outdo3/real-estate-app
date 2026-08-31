# TRADE CANCELLATION RESYNC V2 — 부산 최근 24개월 취소/해제 완전성 보강

## 1. 왜 필요했나

`TRADE_CANCELLATION_RESYNC_V1`(2026-08-30)은 "현재월+직전12개월"(13개월)만
재동기화했다. 그런데 `TRADE_DB_FIRST_V1` 시리즈(STEP B~E)가 실제로
사용하는 트레일링 lookback은 `HISTORICAL_LOOKBACK_MONTHS = 24개월`이다.
STEP E의 TRUST VERDICT는 이 13개월(검증완료) vs 24개월(계산범위) 갭을
"2년최고가" 문구에 대해 **LIMITED**로 판정하고 PM_DECISION_REQUIRED로
보고했다. 이번 STEP은 사용자가 이 갭을 실제로 해소하기로 승인한
후속 작업이다.

## 2. 이전 상태(V1 이후)

- 검증 완료: 최근 13개월(202508~202608)
- 미검증: 13~24개월 전(202409~202507, 약 11개월) — 과거 parser 버그로
  이 구간의 `dealCanceled`는 backfill 당시 전부 `false`로 저장되어
  있었다(취소 여부를 신뢰할 수 없는 상태, TRADE_CANCELLATION_AUDIT_V1
  근거와 동일).

## 3. 목표 범위

- 신규 보강 대상: older 11개월(202409~202507)
- 최종 검증 범위: full 24개월(202409~202608, 이미 검증된 최근 13개월도
  read-only로 재확인)
- 부산 16/16 구·군 전체 × 24개월 = 384 district-month cells

## 4. 기존 로직 AUDIT + 재사용

`scripts/backfill-trade-history.ts`(`runTradeHistoryJob`)와
`scripts/sync-trade-history.ts`를 감사했다. 재사용 가능한 부분:

- `fetchOneRegionMonth()`(동시 1, 최소 간격 350ms + 스로틀 감지 지수
  백오프) — 이번 STEP에서 `export`만 추가해(로직 변경 없음)
  `scripts/resync-cancellation-v2.ts`가 그대로 재사용.
- `monthsInRange()`, `makeLogger()` — 그대로 재사용.
- `normalizeMolitItemsToTradeRows()`(trade-history-logic.ts) — 취소
  필드 파싱(`parseCancellationFields`, `src/lib/api-molit.ts`)을
  포함해 완전히 그대로 재사용. `cdealType`/`cdealDay` 영문 필드명
  파서는 `TRADE_CANCELLATION_AUDIT_V1`에서 이미 수정 완료(커밋
  `30e11a7`)된 상태를 그대로 물려받는다 — 이번 STEP에서 파서를 다시
  건드리지 않았다(§6 요구사항, 구형 버그 재도입 방지).
- 자연키(`trade_natural_key` = groupKeyStr+dealAmount+dealDate+floor+
  occurrenceIndex) — `runTradeHistoryJob`의 `upsertRows()`와 동일한
  자연키를 그대로 재사용해 매칭.

**재사용하지 않고 새로 작성한 유일한 부분**: write 정책. 기존
`upsertRows()`의 `update` 절은 `dealCanceled: row.dealCanceled`를
무조건 최신 fetch 값으로 덮어쓴다 — 즉 true→false 역전을 막는 가드가
없다. 이번 STEP의 spec §14가 "취소 해제가 다시 유효 거래로 복원되는
source semantics가 명확하지 않으면 보수적으로 처리"를 명시적으로
요구했으므로, `scripts/resync-cancellation-v2.ts`는 새로운
`classifyAndWrite()`를 작성해 자연키 매칭 결과를 4가지로 분류한다:

| 분류 | 조건 | 처리 |
|---|---|---|
| `insert` | DB에 없음 | 기존 정상 ingestion과 동일하게 생성(대량이면 STOP 대상) |
| `updateFalseToTrue` | 기존 false, 신규 fetch true | **적용**(이 STEP의 핵심 목적) |
| `updateTrueToFalseSkipped` | 기존 true, 신규 fetch false | **적용하지 않음**(§14 가드, 절대 되돌리지 않음) |
| `conflict` | 같은 자연키인데 aptName/dong이 다름(occurrence 순서 흔들림 의심) | 건드리지 않고 카운트만(§10 안전하지 않은 매칭 금지) |

## 5. 기간 계산

`recentMonths(n)`와 동일한 month-arithmetic으로 계산(재발명 없음,
실행 시점 2026-08-31 기준):

- older 11개월: `new Date(now.getFullYear(), now.getMonth()-23, 1)`
  ~ `new Date(now.getFullYear(), now.getMonth()-13, 1)` → 202409~202507
- 이미 검증된 13개월: 202508~202608(V1과 동일, 재작성하지 않음)

## 6. Phase 1 — Dry-run(older 11개월)

```
cells=176(16구×11개월) COMPLETE=176 EMPTY_VALID=0 FAILED=0 INVALID=0
insert=0 flipFalseToTrue=2432 skippedTrueToFalse=0 conflicts=0
elapsedSec=76.3
```

**Sanity gate 통과**: 2,432건(≈27,876건 중 8.7%)은 V1의 실측 취소율
(2,277/39,794 ≈ 5.7%)과 같은 자릿수 — older 데이터일수록 취소가 더
많이 "정착"돼 있을 가능성(신고 지연/취소 반영 시차)과 부합해 이상
징후가 아니다. mass true→false=0, mass insert=0, conflict=0 — STOP
조건 어느 것도 해당 없음. 진행.

## 7. Phase 3 — Production Write(older 11개월)

Dry-run과 완전히 동일한 결과로 실제 반영:

```
cells=176 COMPLETE=176 EMPTY_VALID=0 FAILED=0 INVALID=0
insert=0 flipFalseToTrue=2432 skippedTrueToFalse=0 conflicts=0
elapsedSec=107.6
```

region-month 단위로 이미 자연스러운 batch 경계이고, 각 cell 내부도
`CHUNK_SIZE=500` 트랜잭션으로 나눠 실행(§17 large-transaction 금지
원칙 준수).

## 8. Post-write 검증

Before/After(정확한 달 경계 기준, `2024-09-01`~`2025-08-01` = older,
`2025-08-01`~ = recent):

| 지표 | Before | After |
|---|---|---|
| 24개월 total rows | 67,809 | 67,809(변화 없음, insert=0과 일치) |
| 24개월 canceled | 2,277 | 4,709(+2,432) |
| older 11개월 canceled | 0 | 2,432(정확히 flipFalseToTrue와 일치) |
| recent 13개월 canceled | 2,277 | 2,277(**완전히 불변** — V1이 검증한 구간을 건드리지 않았다는 직접 증거) |
| aptSeq missing | 0 | 0 |
| natural-key duplicates | 0 | 0 |

## 9. Idempotency

동일 range(202409~202507)로 재-dry-run:

```
cells=176 insert=0 flipFalseToTrue=0 skippedTrueToFalse=0 conflicts=0
```

완전히 멱등 — 반복 실행해도 추가 변경 없음.

## 10. Full 24개월 Completeness 검증(read-only)

전체 24개월(202409~202608, 384 cells = 16구×24개월) dry-run:

```
cells=384 COMPLETE=384 EMPTY_VALID=0 FAILED=0 INVALID=0
insert=0 flipFalseToTrue=0 skippedTrueToFalse=0 conflicts=0
elapsedSec=150.1
```

**24M CANCELLATION COMPLETENESS = SAFE.** 근거(§9 완전성 게이트 조건
전부 충족):

- 384/384 district-month 전부 처리 ✓
- FAILED = 0 ✓
- INVALID(자연키 매칭 충돌) = 0 ✓
- natural-key duplicate = 0 ✓(§8)
- cancellation matching conflict = 0 ✓
- idempotency PASS ✓(§9)

## 11. DB-FIRST 기능 영향 QA

이번 resync가 실제로 record-high/decline 등의 계산 결과를 바꿨는지
직접 검증했다(사전 스냅샷이 없어 raw SQL로 "교정 전 상태"를
재현하는 방식 — 이번 resync가 older window에서 true로 바로잡은
2,432건을 다시 canceled=false로 취급한 시뮬레이션 vs 현재(정답)
상태를 diff).

**신고가(record-high, 부산 전체, 12개월)**:

```
after(정답)=5,247건, before(시뮬레이션)=5,208건
- 교정 전에만 있던(잘못된 신고가) row: 4건 — 이제 정상 제외됨
- 교정 후에만 새로 나타난(진짜 신고가인데 가려져 있던) row: 43건
- priorHigh 값 자체가 바뀐 row: 31건
```

**하락(decline, 부산 전체, 12개월)**:

```
after=3,999건, before(시뮬레이션)=4,007건
- 교정 전에만 있던(가짜 하락) row: 8건 — 이제 정상 제외됨
- 교정 후에만 새로 나타난 row: 0건(논리적으로 당연 — 취소거래 제거는
  priorHigh를 낮추거나 유지만 할 수 있어 "새로운 하락"을 만들 수 없음)
- priorHigh 값이 바뀐 row: 17건
```

방향성이 항상 논리적으로 일관됨(취소거래 제외는 priorHigh를 내리거나
유지만 할 수 있다 — 신고가는 늘어나거나 앞당겨질 수만 있고, 하락은
줄어들거나 유지될 수만 있다). 이는 **버그가 아니라 의도된 정확성
개선**이다.

rising/region-change/area84도 동일한 `is_new_high`/priorHigh 메커니즘과
동일한 24개월 취소필터링 대상 데이터를 공유하므로, 방향성/영향
패턴이 동일할 것으로 판단해 별도 전체 재실행은 생략했다(record-high/
decline 두 개의 서로 다른 비교 구조에서 이미 일관된 논리적 방향성을
확인했으므로 — §26 판단 근거 명시).

**특기사항 — STEP E 사례 재조명**: STEP E의 A/B에서 `26140-1321`
(힐스테이트이진베이시티아파트, 92.9051㎡)의 priorHigh 불일치를
"MOLIT이 2025-03-28의 87500만원 거래를 놓쳤다(DB가 더 정확)"로
결론지었다. 이번 V2 resync 후 재확인한 결과, 그 87500만원 거래는
**실제로 취소된 거래**였다(older window에서 flipFalseToTrue로
바로잡힌 2,432건 중 하나) — 즉 MOLIT의 실시간 fetch가 오히려 정확했고
(당시 시점에 이미 취소 상태를 올바르게 반영), DB가 틀렸던 것이었다
(취소 완전성 검증이 안 된 구간이라 잘못된 값을 갖고 있었음). STEP E
문서의 해당 결론을 이 문서로 정정한다 — 근본 원인은 "MOLIT 누락"이
아니라 정확히 이 STEP이 다루는 "13~24개월 구간 취소 미검증 갭"이
실제로 발현된 사례였다. Live route(`/api/stats/price-rankings?
mode=record-high&lawdCd=26140`)로 확인한 현재 값(정답):
`priorHighAmount=85000, priorHighDate=2026-02-01`.

## 12. Trust Verdict

| 문구 | STEP E 판정 | 이번 STEP 판정 |
|---|---|---|
| 2년최고가 / 24개월 최고가 | LIMITED | **SAFE** |
| 역대최고가 | UNSAFE | **UNSAFE(불변)** |
| 역대신고가 | UNSAFE | **UNSAFE(불변)** |

24개월 lookback 전체에 대해 취소 완전성이 실측 검증됐으므로(§10),
"2년최고가"/"최근 24개월 최고가" 문구는 이제 **SAFE**로 격상한다.
"역대" 계열 문구는 여전히 UNSAFE다 — 이번 STEP은 24개월만 검증했을
뿐, 2006년부터의 전체 이력 취소 완전성은 검증하지 않았다(범위 밖,
향후 별도 STEP 필요 — §16).

## 13. Performance

- Phase 1(dry-run, 176 cells): 76.3초
- Phase 3(apply, 176 cells): 107.6초
- Full 24mo 검증(384 cells): 150.1초
- API 호출당 평균 약 0.4~0.5초/cell(동시 1, 최소 간격 350ms 준수)
- batch/admin 작업이므로 사용자 응답속도 기준 미적용(§26)

## 14. Database

- READ: 예(기존 row 자연키 조회)
- UPDATE: 예(older 11개월, false→true만, 2,432건)
- INSERT: 0건(발생하지 않음)
- DELETE: 0건
- schema/migration: 변경 없음

## 15. Test / Build

- `npx tsc --noEmit`: 20건(전부 기존 `scripts/` 무관 오류, 신규 0건).
  `.next/dev/types/`에서 일시적으로 관측된 9건은 dev 서버를
  `taskkill //F`로 종료하는 과정에서 남은 손상된 자동 생성 타입
  캐시였다 — `.next/`(gitignored) 삭제 후 정상 20건으로 복귀, 소스
  코드와 무관.
- `npx eslint scripts/resync-cancellation-v2.ts
  scripts/backfill-trade-history.ts`: clean.
- `npm run build`: PASS.
- `npx tsx --test`(전체 *.test.ts, 211개): 전부 pass. 취소 재동기화는
  read/write 스크립트이며, 관련 순수 로직(`normalizeMolitItemsToTradeRows`,
  `parseCancellationFields`)은 이번 STEP에서 한 글자도 바뀌지 않아
  신규 테스트를 추가하지 않았다(기존 테스트가 이미 커버).

## 16. Known Limitations / 다음 STEP

- 2006년~24개월 전까지의 전체 이력 취소 완전성은 여전히 미검증 —
  "역대" 표현은 계속 금지.
- 부산만 대상(전국 확장은 범위 밖).
- rising/region-change/area84는 record-high/decline과 동일한 메커니즘
  공유를 근거로 별도 전체 재실행을 생략했다 — 필요시 후속 STEP에서
  개별 확인 가능.
