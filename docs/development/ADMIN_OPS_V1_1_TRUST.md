# ADMIN OPS V1.1 — Operational Evidence / Trust Hardening

## 1. 목적

`ADMIN OPS V1`은 PM 검수에서 PARTIAL 판정을 받았다 — 관리자 화면의
핵심 목적("현재 이집 데이터를 믿어도 되는가?")에 비해, 일부 상태가
LIVE 계산값인지 과거 검증 Snapshot인지 충분히 구분되지 않았기
때문이다. 이 STEP은 새 기능이 아니라 **표현의 정직성**을 보강하는
작업이다 — 근거 없는 확신을 제거하고, 모든 핵심 상태에 근거 종류와
검증 시점을 명확히 붙인다. Production write는 0건(READ만).

## 2. Evidence 분류 정의

```
LIVE      현재 Production DB/runtime에서 직접 계산(요청 시점 기준)
SNAPSHOT  특정 시점에 검증된 결과(과거 실행 결과, 재계산 아님)
CONFIG    코드/운영 설정으로 확인되는 상태(스키마 제약, 환경 설정 등)
UNKNOWN   현재 근거로 확인할 수 없음(파일 손상 등 — "정상"으로 표시 금지)
```

## 3. `/api/admin/ops` 필드별 Evidence 감사 결과

| Field | 이전(V1) | 이번(V1.1) | 근거 |
|---|---|---|---|
| tradeHistory.busanTotal/busanActive/busanCanceled/latestDealDate/aptSeqMissing | 암묵적 LIVE | **LIVE**(명시) | 부산 스코프 DB 쿼리 |
| tradeHistory.naturalKeyDuplicates | "스키마 제약" 문자열만 | **CONFIG**, 실측 증거 첨부 | §4 참고 — 실제 DB unique index 확인+INSERT 차단 실측 |
| tradeHistory.reviewRequired | 전역 상태처럼 표시 | **SNAPSHOT**, verifiedAt 명시 | STEP F 3-cell bounded QA manifest 기준임을 명시(§5) |
| coverage.busan.covered/total | 하드코딩 16/16 | **LIVE**(실제 row 있는 lawdCd distinct count) | §2 "확인 불가능을 정상처럼" 금지 — 검증 없이 참 주장 안 함 |
| coverage.nationwide.sido/syncTargets | 런타임 조회(이미 LIVE) | **LIVE**(유지) | 변경 없음 |
| coverage.sejong.tradeDbCoverage | 하드코딩 '미수집' 문자열 | **LIVE**(`lawdCd='36110'` count) | 문자열 대신 실제 라이브 카운트로 검증 |
| incrementalSync.* | "전국 Sync 상태"처럼 오해 가능 | **SNAPSHOT**, `scopeNote` 필수 표시 | §14 — bounded QA(3개 지역)를 전국 운영 전체로 오인 방지 |
| incrementalSync.scheduler/nextScheduledSync | 상수 | **CONFIG**(유지, 명시) | vercel.json/cron 부재 실측(STEP F) |
| cancellation.window24m | **문서 prose만**(machine-readable 없음) | **SNAPSHOT**, 실제 JSON 파일 근거 | §6 — 신규 snapshot 생성(§5 참고) |
| cancellation.allTime | 상수 NOT_VERIFIED | **CONFIG**(유지) | 검증한 적 없다는 사실 자체가 정직성 |
| features[].trust | "정상"(health-check처럼 오해 가능) | **CONFIG**, "DB-FIRST 적용"으로 재표현(§17) | 구현 상태이지 실시간 health-check 아님 |
| overall.status | 2단계(정상/확인 필요) | **4단계**(정상/확인 필요/문제/확인 불가) | §18 — CRITICAL/UNKNOWN 신설 |

## 4. Duplicate=0 근거 정밀 검증(§10/§11)

**질문 1: `trade_natural_key`에 실제 DB UNIQUE constraint가 있는가?**
`pg_constraint`(contype='u') 조회 결과는 **비어 있었다** — 그러나
이는 Prisma의 `@@unique(...)`가 Postgres에서 테이블 제약이 아니라
**UNIQUE INDEX**로 구현되기 때문이다(Prisma/Postgres의 잘 알려진
동작 방식). `pg_indexes` 조회로 실제 확인:

```
apartment_trade_histories_group_key_deal_amount_deal_date_f_key
CREATE UNIQUE INDEX ... ON apartment_trade_histories
  USING btree (group_key, deal_amount, deal_date, floor, occurrence_index)
```

정확히 자연키(`trade_natural_key`) 5개 컬럼과 일치한다.

**질문 2/3/4 — 실제로 무엇이 차단되는가, 관리자 화면이 말하는
duplicate와 동일한가?** 이론적 확인에 그치지 않고 **실측**했다 —
기존 row 하나를 골라 정확히 같은 자연키(5개 컬럼 전부 동일)로 INSERT
시도(트랜잭션 내부, 실패 여부와 무관하게 강제 롤백 — Production
데이터 변경 없음 확인). 결과: **Prisma 에러 P2002(unique constraint
violation)로 즉시 차단됨**. 테스트 데이터 잔존 0건도 별도 확인.

**판정**: §11의 "실제 unique constraint가 완전히 보장한다면" 조건에
해당 — evidence type **CONFIG/STRUCTURAL**. "0"은 추정이 아니라
증명된 사실이며, 근거(정확한 index 이름 + 실측 실험)를 API 응답과
문서 양쪽에 남겼다.

## 5. 24개월 Cancellation Evidence(§6/§7) — 핵심 산출물

기존에는 이 결과가 **문서 prose**(`TRADE_CANCELLATION_RESYNC_V2_24M.md`)
로만 존재해, API/UI가 참조할 machine-readable 소스가 없었다. 이번
STEP에서 **384-cell 전체 24개월 read-only 재검증을 실제로 다시
실행**(Production READ만, write 없음)해 그 결과를 다음 위치에
snapshot으로 저장했다:

```
data/trade-history/cancellation-24m-verification-snapshot.json
```

실행 결과(2026-08-31 실행, 이 STEP 진행 시점 기준 "현재"):

```json
{
  "verifiedAt": "2026-08-31T16:16:51.820Z",
  "startMonth": "202410",
  "endMonth": "202609",
  "districtCount": 16,
  "cells": 384,
  "complete": 368,
  "emptyValid": 16,
  "failed": 0,
  "invalid": 0,
  "conflicts": 0,
  "changesFoundThisRun": { "insert": 0, "flipFalseToTrue": 0, "skippedTrueToFalse": 0, "reviewRequired": 0 },
  "idempotency": { "verdict": true, "note": "..." },
  "verdict": "SAFE"
}
```

기존 문서(2026-08-31 STEP TRADE_CANCELLATION_RESYNC_V2 실행분,
`202409~202608`)와 창이 1개월(`202410~202609`) 이동한 것은 실행
시점이 하루 지나 "현재 기준 24개월 전"이 재계산됐기 때문이다(하드코딩
아님, §6 "실제 검증된 사실만 기록" 원칙대로 매번 새로 계산).
`changesFoundThisRun`이 전부 0이라는 것은 이미 완전히 반영된 상태임을
뜻한다 — 이번 실행 자체가 write를 하지 않았으므로, "apply 후 재실행
0건"이라는 최초 idempotency 증명은 여전히 2026-08-31 V2 STEP 자체의
실측 결과를 인용한다(이 snapshot이 그 증명을 다시 한 것은 아니다 —
snapshot의 `idempotency.note`에 이 구분을 명시).

API는 이제 이 파일을 직접 읽어 `cancellation.window24m`을 구성한다
— 파일이 없거나 손상되면 **UNKNOWN**으로 표시하고 절대 SAFE로 보이게
하지 않는다(§7 절대 원칙).

## 6. UI 표현 변경(§8)

기존 "24개월 취소검증 / SAFE" 두 줄에서, SNAPSHOT일 때 상세 블록을
추가했다:

```
24개월 취소검증  [검증 시점 기준]
SAFE

마지막 전체 검증   2026. 08. 31. 오후 11:16
검증 범위          2024-10 ~ 2026-09
완료 cell          368 / 384
FAILED · INVALID   0 · 0
재검증 시 변경사항  없음(멱등)

이 검증은 「마지막 검증 Snapshot 기준」입니다.
```

임의의 freshness 정책(7일 WARNING/30일 CRITICAL 등)은 **만들지
않았다**(§9 명시적 지시) — 검증 날짜 자체만 정직하게 노출한다.

## 7. Overall Health 알고리즘 재정의(§18)

```ts
// src/lib/admin-ops-evidence.ts — computeOverallHealth()
CRITICAL: 부산 aptSeq missing(LIVE) > 0
        | 최근 sync manifest에 FAILED > 0
        | 최근 sync manifest에 INVALID(identity conflict) > 0
        | 24개월 cancellation snapshot verdict !== SAFE
WARNING:  세종이 region model에서 조회 안 됨
        | REVIEW_REQUIRED > 0
UNKNOWN:  24개월 snapshot 파일이 없거나(missing) 손상됨(unreadable)
        | nationwide manifest 파일이 손상됨(unreadable)
        (단, CRITICAL 사유가 있으면 CRITICAL이 UNKNOWN보다 우선 — 더
        급한 사실을 숨기지 않는다)
HEALTHY:  위 전부 해당 없음
```

**개발 단계상 정상적으로 미완성인 상태(전국 DB coverage 미완성,
스케줄러 OFF)는 애초에 이 함수의 입력에 포함되지 않는다** — 자동으로
경고화될 수 있는 경로 자체가 없다(§18 "현재 개발 단계에서 정상적으로
미완성인... 전체 상태를 CRITICAL로 만들지 않는다"). 전체 상태가
HEALTHY(정상)이어도 항상 "현재 확인 가능한 운영 지표 기준" subtitle을
붙여 과도한 확신을 피한다(§19).

로직은 `src/lib/admin-ops-evidence.ts`(순수 함수, DB/네트워크 없음)로
분리해 `route.ts`(I/O만)와 나눴다 — 결정 로직만 독립적으로 테스트
가능하게 하기 위함(§8).

## 8. Feature Health 표현 정정(§17)

기존 "신뢰 상태: 정상"은 매 페이지 로드마다 해당 기능 API를
health-check한 것처럼 오해될 수 있었다. 실제로는 코드 구성(어떤
데이터 소스를 쓰는가)에 기반한 **구현 상태**다 — "DB-FIRST 적용"으로
재표현하고 evidence type을 CONFIG로 명시했다. 2년최고가만 SNAPSHOT
(24개월 SAFE 판정에 연동)으로 남겼다 — 이 값은 실제로 §5의 snapshot과
연결돼 있기 때문이다.

## 9. Nationwide Coverage 재확인(§16, V1에서 이미 존재하던 구분 강화)

`coverage.sejong.tradeDbCoverage`를 이번에 라이브 쿼리로 바꾸면서
(`lawdCd='36110'` count), 세종 실거래 DB 데이터가 여전히 0건임을
재확인했다 — STEP F-2의 "dry-run만 검증, 실제 적재 없음" 상태가
그대로 유지되고 있음을 이번 STEP이 살아있는 코드로 증명한다(문서
주장이 아니라 실측). UI에는 "Region Model"과 "실거래 DB 적재"가
서로 다른 지표라는 문구를 굵게 강조했다.

## 10. 성능 실측(§22)

이전 보고서는 "수 초"로만 뭉뚱그렸다 — 이번엔 개별 쿼리 실측:

```
busanTotal(부산 스코프 COUNT):        4,041ms
busanCanceled(부산 스코프+dealCanceled=true COUNT): 8,746ms  ← 5초 초과, 원인 조사
aptSeqMissing(부산 스코프+aptSeq null COUNT):  82ms
latestDealDate(MAX aggregate):          479ms
busanCoveredGroups(distinct lawdCd groupBy): 369ms
sejongTradeCount(단일 lawdCd COUNT):    245ms
6개 쿼리 병렬 실행 합계:              4,386ms
```

**원인 조사 결과**: `apartment_trade_histories`에는 `[aptSeq,
exclusiveArea, dealDate]`/`[lawdCd, dealDate]`/`[identityKey,
dealDate]`/`[dealDate]` 인덱스만 있고 **`dealCanceled` 컬럼을 포함한
인덱스가 없다**. `lawdCd IN (...)` 필터는 인덱스를 타지만, 그 다음
`dealCanceled = true` 조건은 인덱스 지원 없이 매 row를 검사해야 한다
— Busan이 테이블의 사실상 전부(855,047건)라 이 필터의 선택도가
쿼리플래너에 도움이 안 된다.

**조치하지 않음(의도적)**: 인덱스 추가는 schema 변경이라 이번 STEP
범위 밖(§3 `schema=0`)이다. 대신 5분 캐시(`getOrSetCache`)가 이
비용을 "5분에 한 번, 캐시를 처음 미스한 관리자 요청 1건"으로만
흡수한다 — 실제 사용자 체감 성능은 warm(캐시 hit) 시 즉시 응답이다.
향후 STEP에서 `[lawdCd, dealCanceled]` 복합 인덱스 추가를 검토할
근거로 이 실측치를 남긴다(§16 Known Limitations).

## 11. Tests(§23 — 이번 STEP은 필수)

`src/lib/admin-ops-evidence.ts`(순수 함수: `summarizeManifest`,
`computeCancellationVerdict`, `computeOverallHealth`)를 신규 추출해
`src/lib/admin-ops-evidence.test.ts`에 **25개 테스트** 작성:

- manifest 집계(상태별 카운트, distinct region 수, 구버전 필드 누락
  방어, 합산, lastSyncAt 선택)
- **cancellation verdict SAFE 게이팅**: cells=0(미검증) → SAFE 금지,
  FAILED>0 → SAFE 금지, INVALID>0 → SAFE 금지, 둘 다 있어도 UNSAFE
- **overall health 4단계**: HEALTHY/CRITICAL(각 5가지 트리거)/
  WARNING(2가지)/UNKNOWN(3가지, missing과 unreadable 구분)/CRITICAL이
  UNKNOWN보다 우선하는 것/개발 단계상 미완성 상태가 입력에 없어
  자동 경고화 안 되는 것

기존 "이 프로젝트에 route 테스트 없음" 관례는 이번 STEP에는 적용하지
않았다(spec §23 명시 요구 — 관리자 신뢰 판단에 직접 쓰이는 로직이라
예외로 뒀다). 다만 `route.ts`의 DB/파일 I/O 자체는 여전히 라이브
QA로 검증한다(순수 결정 로직만 unit test, I/O는 기존 관례 유지).

## 12. Regression

`proxy.ts`/`requireAdmin()` 무변경 확인. 라이브 재확인: 비로그인
`/api/admin/ops` 401, 비로그인 `/admin/ops` 307 redirect, 기존
`/api/admin/dashboard` 401(회귀 없음).

## 13. Production QA(§25)

LIVE 필드는 독립 쿼리 재실행으로 교차검증(busanTotal=855,047,
busanCanceled=4,709 — 기존 STEP들의 알려진 값과 일치). SNAPSHOT
필드는 API 응답을 원본 JSON 파일과 직접 대조(완전 일치). CONFIG
필드(scheduler OFF, duplicate 0)는 §4/기존 STEP F 감사 근거와 대조.
불일치 0건.

## 14. UI QA

`/admin` 밖 임시 미리보기 라우트(auth 코드 무변경, §5의 실제
captured 데이터 하드코딩)로 시각 QA 후 삭제. 데스크톱: subtitle
disclaimer, evidence badge(실시간/검증 시점 기준/설정), 24개월 상세
블록(384/384, FAILED·INVALID, 재검증 시 변경사항) 전부 정상 렌더링.
360/375/390 iframe 격리 기법으로 모바일 확인: overflow 없음, 5컬럼
feature 테이블은 `.tableWrap`의 `overflow-x:auto`로 페이지 레벨
overflow 없이 테이블 내부에서만 가로 스크롤(정상 동작), STEP
ADMIN_OPS_V1이 고친 하단 네비 padding(`7rem`)이 새 콘텐츠에서도
유지됨을 확인.

## 15. Test / Build

- `npx tsx --test`(src 전체, 236개 = 기존 211 + 신규 25): 전부 pass.
- `npx tsc --noEmit`: 20건(기존 무관 오류, 신규 0건).
- `npx eslint`: clean(직접 인용부호 3곳을 「」로 교체해 react/no-unescaped-entities 해결).
- `npm run build`: PASS.

## 16. Database

- READ: 예(실측 쿼리 다수, §10 duplicate 실험 1건 포함 — 트랜잭션
  강제 롤백으로 실제 반영 없음, 잔존 데이터 0건 확인)
- INSERT/UPDATE/DELETE: 0(영구 반영 기준)
- schema/migration: 변경 없음

## 17. Known Limitations / 다음 STEP

- `busanCanceled` 쿼리가 8.7초로 측정됨 — `[lawdCd, dealCanceled]`
  복합 인덱스가 있으면 개선 가능하지만 이번 STEP은 schema 변경을
  하지 않는다(§10 실측 근거만 남김, 향후 STEP 후보).
- 24개월 snapshot은 수동 생성 스크립트
  (`scripts/generate-cancellation-24m-snapshot.ts`)로 만든다 — 자동
  주기 재생성은 없다(스케줄러 자체가 없는 것과 동일한 이유, §15
  의도된 상태).
- `reviewRequired`/`incrementalSync`는 여전히 STEP F의 bounded QA(3개
  지역) 결과만 반영한다 — 전국 규모 sync를 실제로 실행하면 이
  snapshot도 그만큼 갱신된다(이번 STEP은 그 실행을 하지 않음, §3
  Production write 정책).
