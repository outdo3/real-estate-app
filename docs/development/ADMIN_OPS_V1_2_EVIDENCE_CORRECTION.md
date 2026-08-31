# ADMIN OPS V1.2 — Cancellation Evidence Correction + Admin Query Performance Audit

## 1. 목적

PM 검수에서 `ADMIN OPS V1.1`이 다시 PARTIAL 판정을 받았다 — V1.1이
기록한 24개월 취소검증 machine-readable snapshot(window `202410~202609`,
COMPLETE 368, EMPTY_VALID 16)이 이미 문서화된 실제 검증
(`TRADE_CANCELLATION_RESYNC_V2`, window `202409~202608`, 384 cell 전부
COMPLETE, EMPTY_VALID 0, false→true 교정 2,432건)과 일치하지 않았기
때문이다. 이 STEP의 핵심 원칙은 다음 한 문장이다:

> **"검증했다고 기록된 범위"와 "오늘 기준 최근 N개월"을 절대 같은
> 것으로 취급하지 않는다 — SAFE는 실제 검증의 결과다. 시간이 흘렀다고
> SAFE 범위가 자동으로 앞으로 이동하지 않는다. 확인할 수 없는 최신
> 기간은 미검증이다.**

Database 정책은 V1.1과 동일: READ만 허용, INSERT/UPDATE/DELETE/schema/
migration은 0건(`EXPLAIN`/`EXPLAIN ANALYZE`는 read-only라 허용).

## 2. 근본 원인(root cause) — 추측이 아니라 로그로 증명

`scripts/_resync_cancellation_v2_results/`(gitignore 대상이지만 로컬에
삭제되지 않고 남아 있던 실행 로그)를 직접 대조해 원인을 특정했다.

- `run-2026-08-31T14-11-38-685Z.log`: 원래 검증 — `from=202409
  to=202608`, 최종 라인 `DONE mode=DRY_RUN cells=384 COMPLETE=384
  EMPTY_VALID=0 FAILED=0 INVALID=0 ... SAFE_GATE=true`.
- `run-2026-08-31T14-04-46-256Z.log`: 실제 APPLY 실행(더 이전 11개월
  구간, `from=202409 to=202507`) — 최종 라인 `DONE mode=APPLY cells=176
  COMPLETE=176 ... flipFalseToTrue=2432 ... SAFE_GATE=true`. "false→true
  교정 2,432건"의 근거가 바로 이 로그다.

즉 `202409~202608` 384-cell 전체 검증은 **실제로 존재했고 SAFE였다**.
그런데 V1.1의 `scripts/generate-cancellation-24m-snapshot.ts`는 인자
없이 실행될 때마다 `compute24mWindow(now)`로 **"오늘 기준 최근
24개월"을 매번 새로 계산**해 그 결과로 snapshot 파일을 덮어쓰는
구조였다. 스크립트를 하루 뒤(2026-09-01 새벽, "오늘"이 09월로 넘어간
직후)에 재실행하면 window가 `202410~202609`로 한 칸 밀리고, 9월이
시작한 지 하루뿐이라 16개 구·군 전부 그 달 거래가 아직 없어 정당하게
EMPTY_VALID 16이 됐다 — **날조된 숫자가 아니라, "고정된 과거 검증
결과"를 "매번 다시 계산하는 현재 시점 기준 값"으로 잘못 취급한
구조적 버그**의 결과다.

spec §2의 5개 진단 질문에 대한 답:
1. 스크립트가 현재 날짜 기준 24개월을 자동 계산했는가 — **예**.
2. EMPTY_VALID=16은 임의로 만들어진 값인가 — **아니오**, 2026년 9월이
   시작한 지 1일뿐이라 16개 구·군 전부 그 달 거래가 없는 게 사실이다.
3. 스크립트가 실제 이력 대신 자신의 재계산 결과를 저장했는가 —
   **예**.
4. `verifiedAt`이 실행 시점(now)에 묶여 있었는가 — **예**, window
   계산과 `verifiedAt` 둘 다 "now"에 묶여 있었던 것이 결함의 핵심.
5. 문서(`TRADE_CANCELLATION_RESYNC_V2_24M.md`, `202409-202608`)와
   V1.1 snapshot(`202410-202609`)이 서로 다른 진실 소스를 가리켰는가
   — **예**.

## 3. 구조적 수정 — `scripts/generate-cancellation-24m-snapshot.ts`

`compute24mWindow(now)`(rolling window 자동 계산)를 완전히 제거하고,
**`--from`/`--to`를 반드시 명시적으로 받도록** 바꿨다(기본값 없음):

```ts
function parseCliArgs() {
  ...
  if (!from || !to) {
    throw new Error(
      '--from=YYYYMM --to=YYYYMM을 반드시 명시해야 합니다(§3 — rolling ' +
      'window 자동 계산 금지). 예: --from=202409 --to=202608'
    );
  }
  ...
}
```

인자 없이 실행하면 즉시 에러로 중단된다 — 이 버그 클래스(무심코
실행해도 window가 오늘 날짜에 맞춰 미끄러지는 것)가 구조적으로 재발할
수 없다.

## 4. 재검증 + Snapshot 교정(§4/§5)

원래 검증 window(`--from=202409 --to=202608`)를 **오늘 다시 read-only로
재실행**해 정확히 동일한 결과를 얻었다:

```
cells=384 COMPLETE=384 EMPTY_VALID=0 FAILED=0 INVALID=0
완료: 2026-08-31T16:54:59.631Z
```

이것은 단순히 옛 로그를 인용하는 것을 넘어, **오늘 시점 기준으로도
해당 window의 데이터가 여전히 정확하다는 것을 독립적으로 재확인**한
추가 증거다 — 원 검증 이후 해당 기간에 아무 회귀도 없었음을 뜻한다.

`correctedFalseToTrue`(2,432건)는 이 dry-run으로 재발견할 수 있는
값이 아니다 — 이미 완전히 반영된 상태의 window를 dry-run으로 다시
훑으면 구조적으로 항상 0(더 이상 뒤집을 것이 없으므로)만 나온다.
그래서 `--correctedFalseToTrueOverride` 옵션을 신설해, 실제 APPLY
로그(`run-2026-08-31T14-04-46-256Z.log`)에서 확인한 값을 명시적으로
넘기고, 그 출처를 `correctedFalseToTrueNote` 필드에 그대로 남겼다 —
증명 불가능한 값을 날조하지 않는다는 원칙을 지키면서도, 실제로 일어난
과거 사실을 누락하지 않기 위함이다.

최종 snapshot(`data/trade-history/cancellation-24m-verification-snapshot.json`):

```json
{
  "evidenceType": "SNAPSHOT",
  "verifiedAt": "2026-08-31T14:14:08.780Z",
  "startMonth": "202409",
  "endMonth": "202608",
  "cells": 384,
  "complete": 384,
  "emptyValid": 0,
  "failed": 0,
  "invalid": 0,
  "conflicts": 0,
  "correctedFalseToTrue": 2432,
  "idempotency": { "verdict": true },
  "verdict": "SAFE",
  "provenance": {
    "sourceDocument": "docs/development/TRADE_CANCELLATION_RESYNC_V2_24M.md",
    "sourceCommit": "5723469",
    "verificationType": "full_384_cell_readonly_reverification",
    "generatedBy": "scripts/generate-cancellation-24m-snapshot.ts",
    "generatedAt": "2026-08-31T16:52:28.934Z"
  }
}
```

`verifiedAt`은 날조 없이 실제 로그 타임스탬프를 그대로 썼다.
`provenance`는 §9("이 SAFE는 어디서 나온 것인가?")를 항상 추적
가능하게 한다.

## 5. SAFE 판정 로직 강화(§7/§8) — `src/lib/admin-ops-evidence.ts`

`computeCancellationVerdict()`를 단일 object 파라미터로 바꾸고 조건을
하나 추가했다:

```ts
if (input.cells <= 0) return 'UNSAFE';
if (input.failed > 0) return 'UNSAFE';
if (input.invalid > 0) return 'UNSAFE';
if (input.conflicts > 0) return 'UNSAFE';
if (!input.idempotent) return 'UNSAFE';
if (input.cells !== input.complete + input.emptyValid) return 'UNSAFE'; // 신규
return 'SAFE';
```

마지막 조건(`cells === complete + emptyValid`)은 FAILED/INVALID/
conflicts가 전부 0이어도 데이터가 내부적으로 앞뒤가 안 맞으면(예:
손상되거나 수기 편집된 snapshot) SAFE로 보이지 않게 막는 내부
일관성 체크다 — spec §8이 요구한 "cell mismatch" 시나리오를 직접
커버한다.

또한 `route.ts`는 이제 **snapshot 파일에 저장된 `verdict` 문자열을
그대로 신뢰하지 않는다** — 매 요청마다 원본 필드(`cells`, `complete`,
`emptyValid`, `failed`, `invalid`, `conflicts`, `idempotency.verdict`)에서
`computeCancellationVerdict()`로 직접 재계산한다. 저장된 문자열이
조작되거나 오래된 코드로 잘못 계산됐어도 API가 그것을 그대로 노출하지
않는다 — §27 원칙("SAFE는 실제 검증의 결과다")을 API 계층에서도
강제한다.

`src/lib/admin-ops-evidence.test.ts`에 신규/변경 테스트 4건 추가(cell
mismatch → UNSAFE, conflicts>0 → UNSAFE, idempotent=false → UNSAFE,
정확히 맞는 cell 합 → SAFE) — 파일 전체 29개 테스트 전부 pass.

## 6. Admin Query Performance Audit(§13~16)

기존 보고(V1.1 §10)의 `busanCanceled` cold 쿼리 8,746ms를 다시 `EXPLAIN`
했다:

```
Aggregate  (cost=34678.30..34678.31 rows=1 width=8)
  ->  Index Scan using apartment_trade_histories_lawd_cd_deal_date_idx
        on apartment_trade_histories
      Index Cond: (lawd_cd = ANY (...))
      Filter: deal_canceled
```

`lawd_cd` 조건은 인덱스를 타지만(Index Scan), 그다음 `deal_canceled`
필터는 인덱스 지원이 없어 부산 스코프에 해당하는 모든 row(약
584,733건 추정)를 훑어야 한다 — V1.1이 이미 지목한 원인과 동일하며,
이번 STEP에서 EXPLAIN으로 재확인했다.

**§14 Conditional Aggregate 검토**: `COUNT(*) FILTER (WHERE
deal_canceled = ...)`로 병합한 단일 쿼리를 기존 3-쿼리-병렬 방식과
비교했다. 최초 1회 측정(8,534ms vs 2,931ms)은 병합 쿼리가 더 느려
보였으나, **이는 실행 순서에 따른 버퍼 캐시 편향이었다** — 병합 쿼리를
먼저(cold) 실행했기 때문에 그다음 실행된 3-쿼리 방식이 이미 warm된
페이지를 읽어 유리했을 뿐이다. 순서를 바꿔가며 재측정한 결과:

```
run1(병합 먼저, cold):    병합 8,986ms / 3-쿼리 6,464ms
run2(3-쿼리 먼저):        3-쿼리 2,398ms / 병합 1,229ms
run3(완전 warm):          병합 1,042ms / 3-쿼리 1,491ms
```

**결론**: warm 상태에서 두 방식은 사실상 동등하다(방식 간 우열보다
캐시 상태가 훨씬 더 큰 변수). 병합 쿼리로 바꿔도 **근본 병목(인덱스
부재)은 그대로**이므로, 유의미한 이득이 없는데도 raw SQL(`$queryRaw`)
도입에 따른 유지보수·타입 안전성 비용만 늘리는 것은 근거가 부족하다.

**결정: `route.ts`의 기존 3-쿼리 병렬 구조를 변경하지 않는다.**
non-schema 최적화로는 병목이 해소되지 않는다는 것이 이번 실측의
결론이다.

### INDEX_CHANGE_RECOMMENDED(§16 — 이번 STEP에서 생성하지 않음)

- **추천 인덱스**: `apartment_trade_histories(lawd_cd, deal_canceled)`
  복합 btree 인덱스.
- **근거**: 두 EXPLAIN 모두 동일한 병목을 가리킨다 — `lawd_cd`까지는
  인덱스를 타지만 `deal_canceled` 자체가 인덱스에 없어 Filter 단계가
  전체 부산 스코프 row를 다시 훑는다. 복합 인덱스가 있으면 Postgres가
  `Index Cond`만으로 걸러낼 수 있어 cold 쿼리도 수백ms 대로 떨어질
  것으로 기대된다.
- **저장 비용**: `deal_canceled`는 boolean(1 byte) — 기존 4개
  인덱스에 이미 `lawd_cd`가 포함된 인덱스가 있으므로 순증가 폭은
  작다(테이블 전체 대비 낮은 비율의 추가 디스크 사용).
- **쓰기 비용**: INSERT/UPDATE 시 유지해야 할 인덱스가 하나
  늘어난다 — 이 테이블은 배치 sync(증분 수집)로만 쓰기가 발생하고
  고빈도 OLTP 쓰기가 아니므로 감내 가능한 수준으로 판단된다.
- **기존 인덱스와 중복 여부**: `[aptSeq, exclusiveArea, dealDate]`,
  `[lawdCd, dealDate]`, `[identityKey, dealDate]`, `[dealDate]`,
  자연키 unique index — 어느 것도 `(lawdCd, dealCanceled)` 조합을
  커버하지 않는다. **중복 아님.**
- **이번 STEP에서 인덱스를 생성하지 않는다**(spec §3 schema=0
  명시). 위 내용은 다음 STEP을 위한 문서화된 추천일 뿐이다.

## 7. UI 표현 변경(§6) — `src/app/admin/ops/page.tsx`

기존 라벨(`최근 {coverageLabel}({lookbackMonths}개월) 취소검증`)은
`price-ranking.ts`의 범용 "최근 N개월" 상수를 재사용하고 있었다 —
이것도 이번 STEP이 고치려는 것과 같은 종류의 함정이다: 오늘(2026-09)
기준으로는 우연히 실제 검증 window(202409~202608)와 값이 같아
보이지만, 다음 달에 이 페이지를 열면 그 범용 상수는 자동으로
"최근 24개월"을 다시 계산해 앞으로 밀리는 반면 snapshot은 고정돼
있어 다시 같은 종류의 착시가 생길 수 있었다.

라벨을 snapshot 자신의 고정된 `startMonth`/`endMonth`를 사용하도록
바꾸고, 상세 블록에 `emptyValid`/`conflicts`/`correctedFalseToTrue`/
`provenance`(근거 문서+커밋)를 새로 노출했다. 하단 disclaimer도
spec의 취지대로 "검증 범위 이후 발생한 거래·취소는 이 결과에
포함되지 않는다"는 사실을 명시하되, 임의의 freshness-WARNING 정책
(예: "N일 지나면 경고")은 만들지 않았다(§9와 동일 원칙).

## 8. Regression

`proxy.ts`/`requireAdmin()` 무변경 확인(git status로 재확인).
라이브 재확인: 비로그인 `/api/admin/ops` → 401, 비로그인 `/admin/ops`
→ 307 redirect(회귀 없음).

## 9. Production QA(3-way cross-check)

`buildSummary()`를 임시로 export해 직접 호출한 결과, snapshot 파일,
원본 검증 로그(§2) 세 가지를 대조 — `cells=384 complete=384
emptyValid=0 failed=0 invalid=0 correctedFalseToTrue=2432
verdict=SAFE` **완전히 일치**. 불일치 0건.

## 10. UI QA

`/admin` 밖 임시 미리보기 라우트(`buildSummary()`를 그대로 호출하는
QA 전용 API + 동일 JSX의 미리보기 페이지, auth 코드 무변경, 작업 종료
즉시 삭제)로 데스크톱 렌더링 확인 — "완료된 24개월 전체
검증(2024-09~2026-08) / SAFE / 384/384 / EMPTY_VALID 0 / FAILED 0 /
INVALID 0 / 충돌 0 / false→true 교정 반영 2432건 / 근거 문서" 전부
정상 표시. 360/375/390px iframe 격리 기법으로 모바일 확인 — 세
너비 모두 가로 overflow 없음, 카드 레이아웃 정상 wrap.

## 11. Test / Build

- `npx tsc --noEmit`: 20건(기존 스크립트 관련 무관 오류만, `admin`
  경로 매치 0건 — 신규 오류 없음).
- `src/lib/admin-ops-evidence.test.ts`: 29개(기존 25 + 신규 4) 전부
  pass.
- (아래 §12에 전체 test suite/`eslint`/`build` 최종 결과 기록)

## 12. Database

- READ: 예(EXPLAIN 2건, 오늘자 384-cell read-only 재검증 1회,
  성능 비교 쿼리 다수 — 전부 read-only).
- INSERT/UPDATE/DELETE: 0건.
- schema/migration: 변경 없음.

## 13. Known Limitations / 다음 STEP

- `[lawdCd, dealCanceled]` 복합 인덱스는 §6의 근거로 다음 STEP에서
  검토 후보로 남긴다(이번 STEP은 schema=0).
- 24개월 snapshot은 여전히 수동 스크립트 실행으로만 갱신된다 — 자동
  주기 재생성 없음(V1.1과 동일하게 의도된 상태).
- `correctedFalseToTrue`처럼 "과거 실제 적용된 값이지만 현재
  dry-run으로는 재발견 불가능한 값"을 override로 보존하는 패턴은
  이번에 처음 도입됐다 — 향후 유사한 상황(예: 다른 기간의 재검증)에서
  재사용 가능한 패턴으로 남긴다.
