# CRON DURABLE PROGRESS + DEADLINE SAFETY FIX V1

LOCAL ONLY — 브랜치 `cron-durable-progress-v1`(기준 `5d03257`). push 0 · 배포 0 · Production cron 호출 0 · Production DB write 0 · 스케줄 변경 0 · 경기 공개 0 · 41135 0.
선행: `GYEONGGI_SALE_CRON_INCOMPLETE_ROOT_CAUSE_AUDIT_V1.md`(HOLD — PROGRESS_DURABLE=NO, SALE_RUNTIME_SAFE=NO).

## 1. 목적

1. 커밋된 셀의 coverage를 실행 **도중** durable하게 남긴다(비정상 종료가 진행을 지우지 않게).
2. 다음 실행이 미완료·오래된 구부터 처리한다(sale 끝 구 starvation 제거).
3. MOLIT 요청·재시도·backoff가 남은 실행 시간을 넘지 않는다.
4. 부산·서울·경기 데이터 안전성(쓰기 판정·취소·등기·범위) 불변.

## 2. 셀 커밋 경계(변경 전 추적)

| 단계 | sale / recheck (`syncOneSaleCell`) | rent (`syncOneRentCell`) |
|---|---|---|
| 1 원천 | `fetchSaleRegionMonth` — 쪽마다 최대 6회, 10s 타임아웃, backoff 0.5–2.5s(비율제한 2–10s) | `fetchRentRegionMonth` — 같은 골격 |
| 2 정규화 | `normalizeMolitItemsToTradeRows` → `planSaleCellWrites` | `normalizeMolitRentItemsToRentRows` → `planRentCellWrites` |
| 3 쓰기 | `createMany`(500행 chunk, autocommit) → 취소 flip `$transaction` → (치유, 기본 꺼짐) → 등기일 보충 `$transaction` — 전부 순차 `await` | `createMany`(skipDuplicates) 1회 |
| 4 커밋 | 각 chunk가 개별 커밋. **셀 전체를 묶는 트랜잭션은 없다** | 단일 문장 커밋 |
| 5 coverage(메모리) | 루프 안 `coverage.push` | 같음 |
| 6 coverage(영속) | **루프가 끝난 뒤** `recordCoverageCells` 1회(셀마다 upsert) | 같음 |

셀이 안전하게 완료됐다고 말할 수 있는 지점: `syncOne*Cell`이 **반환한 순간** — 그 셀의 모든 쓰기 `await`가 끝났다.
셀 도중 종료되면 일부 chunk만 커밋될 수 있지만 coverage는 없으므로 다음 실행이 같은 셀을 다시 돌고, 쓰기는 멱등이다(자연키 unique + skipDuplicates, 등기일은 NULL일 때만, 취소는 그룹 개수 대조).

불변식: **coverage는 그 셀의 모든 DB 쓰기가 커밋된 뒤에만 기록한다.**

## 3. 설계 결정

### 3.1 셀 단위 durable coverage (sale · recheck · rent)

`syncOne*Cell` 반환 → `persistCellCoverage`(그 셀 하나 upsert) → 다음 셀. 실행 끝 일괄 기록은 없앴다.

- 기록 대상: `isVerifiedCellStatus` = COMPLETE / EMPTY_VALID만. sale 현재월 제외(§15)·rent review 후보 셀 제외(§14)는 그대로.
- 기록하지 않음: INVALID · PARTIAL · 예약분 정지 셀 · 시간 한도 정지 셀 · 쓰기 예외가 난 셀 · 시작하지 않은 셀.
- upsert가 throw → `COVERAGE_PERSIST_FAILED`로 즉시 멈춤(다음 셀 요청 0), run status `FAILED`(HTTP 500). 커밋된 원천 행은 되돌리지 않는다.
- dry-run은 여전히 기록 0(`recordCoverageCells` 내부 차단 그대로).

**의미 변경(승인 필요 사항으로 보고):** 예전에는 INVALID/PARTIAL도 그 상태로 upsert했다. 그래서 (a) 전날 COMPLETE였던 셀이 오늘 fetch 실패로 INVALID로 **강등**돼 DB-first 읽기가 MOLIT 라이브로 돌아갔고, (b) verifiedAt이 갱신돼 recheck 대기열 **뒤로 밀렸다**(실패한 셀이 굶는 방향). 이제는 기록하지 않으므로 이전 검증 기록(상태·verifiedAt)이 그대로 남고 그 셀이 다음 실행에서 먼저 다시 처리된다. 강등 신호가 사라지는 대신, 읽기는 마지막으로 검증된 DB 데이터를 계속 쓴다(cron이 하루 안 돈 것과 같은 신선도).

### 3.2 sale 재개 순서

`orderSaleDistrictsByStaleness`(shared.ts, 순수): 구 단위로 정렬하고 한 구의 월은 기존처럼 오름차순으로 함께 처리한다. 판정은 **완료월 셀만**(현재월은 절대 기록되지 않으므로 넣으면 모든 구가 늘 미검증).

1. 완료월 중 검증 기록이 없는 셀이 있는 구 먼저(과거 INVALID 기록도 미검증으로 본다)
2. 검증된 셀 중 가장 오래된 verifiedAt 오름차순(검증 셀이 없으면 가장 앞)
3. 동률은 scope 목록 순서

coverage 읽기(`loadSaleCoverageTimestamps`, SELECT 1회)가 실패하면 `ORDER_FALLBACK` 로그 후 scope 순서(기존 동작)로 진행한다. `districtOffset/Limit`는 자른 뒤 그 안에서만 정렬한다. recheck는 원래 staleness 순서였고 그대로다. rent 순서는 요청 범위 밖이라 바꾸지 않았다.

### 3.3 실행 시간 한도(deadline)

`run-deadline.ts`(순수). `TimeBudget.remainingMs()`가 fetcher까지 내려간다.

| 상수 | 값 | 근거 |
|---|---|---|
| route maxDuration | 60s | 기존 |
| 작업 예산 | sale 50s · recheck 45s · rent 50s | 기존 그대로 |
| 정리 예비 | ≥ 10s(60 − 50) / 15s(recheck) | 콜드스타트 · 요약 · 로그 · 응답. 예전엔 여기서 coverage 일괄 upsert까지 했다 |
| 시도 타임아웃 | min(10s, 남은 − 대기 − 커밋 예비) | 기본 10s(기존), 한도 근처에서만 줄어든다 |
| 최소 시도 타임아웃 | 2s | 정상 MOLIT 응답 ≈ 0.3–0.5s, 느린 밤 ≈ 1.5s |
| 셀 커밋 예비 | 2s | 정상 셀 전체 ≈ 0.8s(쓰기 + coverage 포함) |

규칙:
- 요청 시도(첫 시도·재시도·다음 쪽)는 `대기 + 2s + 2s ≤ 남은 시간`일 때만 보낸다. 아니면 요청하지 않고 `deadlineStopped`.
- backoff는 잠들기 **전에** 확인한다 — backoff 뒤 시도할 시간이 없으면 잠들지 않는다.
- 셀 시작 조건 = 기존 `hasRoomFor(2.5s)` **그리고** 첫 시도 조건(`hasRoomForCell`). 그래서 정상 예산 끝은 요청 0회인 `BUDGET_EXHAUSTED`이고, `DEADLINE_REACHED`는 이미 시작한 셀의 재시도·다음 쪽이 잘렸을 때만 나온다.
- 한도에 걸린 셀: 쓰지 않음 · coverage 미기록 · reports에 넣지 않음(INVALID/EMPTY로 세지 않음) · 로그 `DEADLINE_REACHED`.
- 최악 시간: 마지막 MOLIT 시도는 `예산 − 2s` 전에 끝나고 그 셀의 쓰기·coverage가 커밋 예비 안에서 끝난다 → 약 예산(50s/45s) + DB 지연. 예전 최악(셀 하나 ≈ 70s)과 달리 네트워크 쪽 상한이 있다.
- deadline 없이 부른 fetch(CLI backfill 등)는 예전과 똑같다(10s × 6회) — 테스트 15d.

### 3.4 쿼터·시간 순서

요청마다(`fetchOnePage`): ① 예약분(remaining > 2,000) → ② deadline → ③ 요청. 셀 경계도 같은 순서(예약분 → 시간)로 맞췄다(예전 셀 경계는 시간 → 예약분). 결과는 서로 다른 `stopReason`: `QUOTA_RESERVE_REACHED` / `DEADLINE_REACHED` / `BUDGET_EXHAUSTED` / `COVERAGE_PERSIST_FAILED`. rent에는 쿼터 가드가 원래 없고 추가하지 않았다.

### 3.5 run status

| 정지 | sale | recheck | rent |
|---|---|---|---|
| 끝까지 | SUCCESS / PARTIAL(셀 실패) | 그대로 | 그대로(NEEDS_REVIEW 우선) |
| BUDGET_EXHAUSTED | PARTIAL_RUN(기존) | SUCCESS(기존 — 회전 sweep 정상) | PARTIAL_RUN(기존) |
| QUOTA_RESERVE_REACHED | PARTIAL_RUN(기존) | PARTIAL_RUN(기존) | — |
| DEADLINE_REACHED | PARTIAL_RUN | PARTIAL_RUN(느린 원천 신호) | PARTIAL_RUN |
| COVERAGE_PERSIST_FAILED | FAILED | FAILED | FAILED |

응답·요약에 `stopReason`, `deadlineReached`가 추가된다(기존 필드 불변).

## 4. 구현

| 파일 | 변경 |
|---|---|
| `src/lib/sync/run-deadline.ts` | 신규 — 상수, `planRequestAttempt`, `hasRoomForCell` |
| `src/lib/sync/shared.ts` | `TimeBudget(budget, clock?)` + `remainingMs()` · `RunStopReason` · `orderSaleDistrictsByStaleness` · `persistCellCoverage` · `coverageRecordOf` |
| `src/lib/sync/sale-sync-core.ts` | 셀 단위 coverage · 구 순서 · deadline 전달 · stopReason · 테스트 주입점 `deps` |
| `src/lib/sync/sale-recheck-core.ts` | 셀 단위 coverage · deadline · stopReason · `deps` |
| `src/lib/sync/rent-sync-core.ts` | 셀 단위 coverage · deadline · stopReason · `deps` · `syncOneRentCell` export |
| `src/lib/sync-coverage.ts` | `loadSaleCoverageTimestamps`(읽기 전용) |
| `scripts/sale-molit-fetch.ts` · `scripts/rent-trade-history/rent-molit-fetch.ts` | 선택 인자 `{ deadline }`, 시도별 타임아웃, backoff 사전 확인, `deadlineReached` |
| 테스트 | `cron-durable-progress.test.ts`(실제 코어 + 메모리 DB + fetch 대역) · `cron-resume-order.test.ts`(주입 대역) · 기존 소스 고정 테스트 3곳을 새 호출 형태로 갱신 |

route·vercel.json·scope·enablement·쓰기 판정(`planSaleCellWrites` 등)·예산 상수는 바꾸지 않았다. `deps`는 route가 넘기지 않으므로 운영에서는 모두 기본값이다.

## 5. 테스트 결과(실행한 명령과 실제 결과)

| 명령 | 결과 |
|---|---|
| `npx tsx --test src/lib/sync/cron-durable-progress.test.ts` | 18/18 pass |
| `npx tsx --test src/lib/sync/cron-resume-order.test.ts` | 20/20 pass |
| `npx tsx --test src/lib/sync/*.test.ts` | 85/85 pass |
| `node --experimental-strip-types --test src/lib/sync/shared.test.mjs` | 20/20 pass |
| `npx tsx --test` src 전체(ts+mjs) | 2,697 중 2,695 pass · 2 fail — 아래 |
| `npx tsx --test` scripts 전체(ts+mjs) | 650 · 649 pass · 0 fail · 1 skipped |
| `node --experimental-strip-types --test` 전체 mjs | 550 pass · 18 fail — 기준 5d03257 체크아웃도 **동일 550/18**(확장자 없는 import의 ERR_MODULE_NOT_FOUND, 이 변경과 무관) |
| `npx eslint` 변경 파일 | exit 0 |
| `npx tsc --noEmit` | 21 errors, 전부 무관한 기존 scripts(apartment-score·education·list-zips 등) — 변경 파일 0 → FAIL_EXISTING_SCRIPT_ERRORS |
| `npm run build` | exit 0 |

src 2 fail(`community-launch.test.ts §15`, `recent-auth-parity.test.ts §5`): 새 worktree가 CRLF로 체크아웃돼 CSS를 고정 길이(240자)로 자르는 소스 검사가 어긋난 것. 두 파일과 대상 소스는 HEAD와 동일하고, LF인 기준 체크아웃에서는 46/46 pass. 이 변경과 무관.

### 요구 매트릭스 ↔ 테스트

1 커밋 직후 기록 `1` · 2 커밋 전 기록 없음·쓰기 실패 셀 미기록 `2` · 3 셀 1 뒤 종료 `3` · 4 구 1/구 3 뒤 종료 `4` · 5 미완료 셀 미기록 `5, 5b, 5c, 5d` · 6 미검증 우선 `6, 6b` · 7 경기 끝 구 굶지 않음 `7, 7b` · 8 재실행 insert 0 `8·9·10` · 9 등기일 재보충 0 `8·9·10, 8b` · 10 취소 parity `8·9·10, 10b` · 11·12 쿼터 `11·12, 11b` · 13·14 deadline `13·14, 15c` · 15 재시도·backoff `15, 15b, 15d, 18c` · 16 정리 예비 `16, 16b` · 17 recheck `17, 17b, 17c, 17d` · 18 rent `18, 18b, 18c, 18d` · 19–22 scope `19–22` + 기존 sale-sync-scope · 23 enablement `23` · 24 스케줄 `24`.

## 6. 성능 비용

- coverage 쓰기 수는 **예전과 같다**(검증된 완료월 셀 수): sale 부산 48 · 서울 24 · 경기 24 / recheck ≤ 처리 셀(경기 band 80) / rent 32. 시점만 실행 끝 → 셀 커밋 직후로 옮겼다.
- 예전에는 이 upsert가 예산(50s/45s) **밖**에서 돌아 총 실행 시간을 늘렸다. 이제는 예산 안이라 총 시간은 줄고, 셀당 upsert 1회만큼 처리 셀이 줄 수 있다.
- 로컬 읽기 전용 probe(같은 unique key `findUnique` 20회, local → DB): p50 22.3ms · p90 33.9ms · max 49.8ms. upsert를 이것의 약 2배로 잡아도 경기 sale 24셀 ≈ 1.2s, recheck 51셀 ≈ 2.5s.
- recheck 처리량(셀당 0.8s 모델): 셀 시작 조건에 첫 시도 여유가 들어가 54 → 51셀(테스트 17), upsert 시간까지 더하면 약 48–50셀. band 80셀은 이틀 안에 한 바퀴 — 치명적이지 않다. 버퍼링(unsafe)으로 되돌리지 않았다.

## 7. 알려진 문제·남은 위험

- DB 호출 자체에는 deadline이 없다(Prisma 쿼리를 중간에 끊지 않는다). DB가 멈추면 여전히 60s를 넘을 수 있다 — 그래도 앞 셀 coverage는 남는다.
- 콜드스타트 시간은 측정 근거가 없다(Hobby 로그 보존 ≈ 20분). 정리 예비 10s 안에 들어간다고 가정했다.
- rent 순서는 바꾸지 않았다 — 느린 밤이 반복되면 rent 끝 구가 늦게 처리될 수 있다(정상 32셀 ≈ 14s라 위험 낮음).
- 계속 실패하는 셀(매번 INVALID)은 기록되지 않아 매 실행 맨 앞에서 재시도된다 — 실행당 셀 하나(sale은 구 하나)만큼의 비용.
- 과거에 기록된 INVALID/PARTIAL 행은 그대로 남는다(데이터 수정 없음). 다음 성공 때 덮인다.

## 8. 다음 STEP

사용자 승인 → main 병합·push(= Production 배포) → 다음 04:00–05:00 KST 실행에서 `stopReason`·`coverageRecorded`·구 순서(`ORDER sale`) 사후 검증. 경기 첫 cron 판정(HOLD)은 그 검증 뒤. 8527c6e(경기 beta blocker)와는 별개다.
