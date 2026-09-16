# E-JIP MOLIT LIVE PAGING FIX V1

라이브 MOLIT 조회 경로가 1,000건 초과 셀을 조용히 잘라내던 결함의 수정. **데이터 진실성 핫픽스.**

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `a073814` (MOLIT_QUOTA_SCALE_PROBE_V1 직후)
- 범위: 라이브 read path만. DB/schema/migration/bulk backfill/cron/coverage cell 변경 0.
- 근거: `docs/development/MOLIT_QUOTA_SCALE_PROBE_V1.md` §2(결함 확정), §5(quota 실측)

---

## 0. 결론 요약

**판정: PASS**

1. **결함 수정 완료.** `src/lib/api-molit.ts`의 라이브 경로가 `pageNo`/`totalCount`를 읽고 필요한 페이지를 모두 가져온다. 실 API 검증에서 서울 강남구 전월세 2026-03이 **1,000 → 2,091건**으로 복구됐다(누락 52.2% 해소).
2. **≤1,000건 셀은 완전히 동일하다.** `pageNo=1`을 붙인 요청과 기존 요청의 응답이 **바이트 단위로 같음**을 실 API로 확인했다(부산 4개 셀). 부산은 probe한 모든 셀이 1페이지라 **운영 동작 변화가 없다**.
3. **부분 실패를 완전한 결과로 위장하지 않는다.** 페이지 하나라도 최종 실패하면 기존 `'에러'` 플레이스홀더 계약으로 실패를 알린다 — `classifyMolitMonthResult`가 `FAILED`로 잡아 사용자에게 부분 실패가 그대로 보인다.
4. **rate-limit 부담을 늘리지 않았다.** 페이지 하나하나가 기존과 동일한 게이트(동시 4 · 250ms · 차단기 · 재시도)를 **개별로** 통과한다. ungated `Promise.all` 없음. 한 셀 안에서 페이지는 순차로만 나간다(테스트로 고정).
5. **새 아키텍처를 만들지 않았다.** 대량 sync fetcher가 이미 쓰던 `pageNo → totalCount → ceil()` 패턴을 그대로 가져왔다.

---

## 1. Root cause

수정 전 `src/lib/api-molit.ts:126`
```
`${endpoint}?serviceKey=…&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000`
```

- `pageNo` 없음 → 서버 기본값 1페이지만.
- `totalCount`를 파싱하지 않음 → **더 있는지조차 모름**.
- 1,000건에서 잘린 결과가 "그 달 거래 전부"로 화면·통계·점수에 그대로 흘러감.

영향 소비자 18곳 — 단지 상세, 거래 목록, 통계 4개 라우트, 학교, 지역 피드, 월 캐시, 점수 market collector 등.

### 재현 (수정 전, 실 API)

| 지역 | 월 | totalCount | 라이브가 본 값 | 누락 |
|---|---|---|---|---|
| 서울 강남구 11680 | 202603 | 2,091 | 1,000 | **52.2%** |
| 서울 송파구 11710 | 202603 | 1,873 | 1,000 | 46.6% |
| 경기 분당구 41135 | 202603 | 1,358 | 1,000 | 26.4% |

---

## 2. 구현

### 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/api-molit.ts` | 페이지 단위 fetch + 전체 페이지 수집 + 부분 실패 정책 (+141/−18) |
| `src/lib/molit-paging.test.ts` | 신규 — 페이지네이션 계약 테스트 16개 |
| `scripts/qa-molit-live-paging.ts` | 신규 — 실 API read-only QA |

### 핵심 구조

- `fetchMolitDataOnce()` → **`fetchMolitPageRaw(params, pageNo)`** 로 교체. 매핑 전 `{ rawItems, totalCount }`를 반환한다(매핑을 페이지마다 하지 않기 위해).
- **`fetchAllPagesGuarded()`** 신규. 페이지 1 → `totalCount` → `ceil(totalCount / MOLIT_PAGE_SIZE)` → 필요한 페이지만 순차 수집 → 합친 배열에 `mapMolitItems()`를 **한 번만** 적용.
- `MOLIT_PAGE_SIZE = 1000` 상수로 노출(테스트가 경계를 직접 검증).

```
page 1 fetch (게이트 통과)
  ├ totalCount == null  ├ items <  1000 → 그대로 반환 (수정 전과 동일)
  │                     └ items >= 1000 → 실패 (절단 여부 불명 → "전부"라고 말하지 않음)
  ├ totalCount <= items.length → 그대로 반환
  └ 그 외 → page 2..ceil(total/1000) 순차 수집 (각각 게이트 통과)
             ├ 어느 페이지든 최종 실패 → 실패
             ├ 합계 < totalCount      → 실패 (불완전)
             └ 그 외 → 전체 반환 + [molit] paged fetch 로그
```

### 계약 보존

`fetchMolitData()`의 반환 계약은 그대로다 — 성공은 거래 배열, 정상 0건은 `[]`, 최종 실패는 `typeLabel:'에러'` 플레이스홀더 1건. 소비자 18곳 중 어느 것도 수정하지 않았다.

기존 테스트가 쓰던 `deps.fetchOnce`(단일 페이지, 매핑된 배열) 주입 지점을 **그대로 유지**했다 — 주입되면 페이지네이션 없이 기존 경로를 탄다. 덕분에 `molit-rate-guard.test.ts` 26개가 한 줄도 바뀌지 않고 통과한다. 페이지네이션 검증용으로는 `deps.fetchPage`를 새로 두었다.

---

## 3. 부분 실패 정책

**silent truncation 금지**가 유일한 원칙이다. 새 상태를 만들지 않고 기존 실패 표현을 재사용했다.

| 상황 | 처리 | 사용자가 보는 것 |
|---|---|---|
| 모든 페이지 성공, 합계 == totalCount | 전체 반환 | 정상 |
| 2페이지 이상 중 하나가 최종 실패 | **실패** | 기존 부분 실패 표시(`[MOLIT_PARTIAL]`) |
| 전 페이지 수집 후에도 합계 < totalCount | **실패**(불완전) | 동일 |
| totalCount 없음 + 1페이지 < 1000 | 그대로 반환 | 수정 전과 동일 |
| totalCount 없음 + 1페이지 == 1000 | **실패**(절단 가능) | 부분 실패 표시 |
| totalCount 0 + items 없음 | `[]` | "거래 없음"(실패 아님) |

`classifyMolitMonthResult`(`apt-trade-completeness.ts`)가 이미 `'에러'` 플레이스홀더를 `FAILED`로 분류하므로, 상세 라우트의 `[MOLIT_PARTIAL]` 로깅과 `summarizeTradeCompleteness` 경로가 **수정 없이 그대로** 새 실패도 잡는다.

---

## 4. 게이트 · 동시성 · 타임아웃

### 게이트 (변경 없음)

동시 4 · 250ms 페이싱 · 적응형 쿨다운 · 5초 차단기 · in-flight dedup — 전부 그대로다.

달라진 점은 **한 셀이 여러 번 게이트를 통과할 수 있다**는 것뿐이다. 페이지마다 `runMolitGuarded`를 개별 호출하므로 슬롯 획득·페이싱·차단기·rate-limit 재시도가 페이지 단위로 적용된다. 같은 `ticket`을 재사용해 lane(interactive/bulk)과 우선순위 승격은 유지된다.

**ungated 병렬 발사는 없다.** 테스트로 고정: 한 셀 안에서 동시 실행 페이지 수 == 1, 6개 셀 × 3페이지 = 18 요청에서도 전역 peak ≤ `MOLIT_CONCURRENCY`.

### dedup (변경 없음)

dedup 키는 `type:lawdCd:dealYmd`(셀 단위) 그대로다. 같은 셀을 동시에 요청한 3개 호출부가 페이지 시퀀스 하나를 공유하는 것을 테스트로 확인했다(`calls == [1,2,3]`). 한 셀의 페이지는 순차로만 읽으므로 같은 페이지를 두 번 요청하는 경로가 없다.

### 타임아웃 — 변경하지 않음

`AbortSignal.timeout(5000)`은 **페이지 단위**다(각 `fetchMolitPageRaw` 호출이 자기 5초를 가진다). 셀 전체에 5초를 거는 구조가 아니므로 다중 페이지 셀이 부당하게 timeout되지 않는다.

실측상 조정이 필요 없었다:

| 페이지 수 | 실측 소요 |
|---|---|
| 1페이지 | 369~523ms |
| 2페이지 | 1,152~1,325ms |
| 3페이지 | 2,333ms |

3페이지 셀도 2.3초로, 페이지당 5초 예산에 한참 못 미친다. `MOLIT_RETRY_BUDGET_MS`(8초)는 rate-limit 대기에만 쓰이는 값이라 정상 경로에 영향이 없다. **타임아웃 정책 변경 없음 — 근거는 위 실측.**

---

## 5. 순서 · 중복

- 페이지를 `pageNo` 오름차순으로 concat → 서버 순서 그대로 보존.
- `mapMolitItems()`를 합친 배열에 한 번만 적용 → `id`(`type-lawdCd-dealYmd-index`)와 `rank`가 0..N-1로 **끊기지 않는다**. 페이지마다 매핑했다면 rank가 페이지마다 1로 되돌아갔을 것이다.
- 페이지는 `pageNo`로 나뉘어 서로 겹치지 않으므로 **dedup이 불필요**하다. fuzzy dedup을 넣지 않았다. 2,091건 셀에서 고유 id 2,091개를 테스트와 실 API 양쪽에서 확인했다.

---

## 6. 테스트

### 신규 `src/lib/molit-paging.test.ts` — 16개 전부 통과

| # | 테스트 | 확인 |
|---|---|---|
| 1 | 577건 단일 페이지 parity | 페이지 1회, rank 1..577 |
| 2 | 정상 0건 | `[]`, `SUCCESS_EMPTY` |
| 3 | 정확히 1,000건 | 2페이지를 요청하지 않음 |
| 4 | 1,001건 | 2페이지, 1,001건 전부 |
| 5 | **2,091건(실측 재현)** | 3페이지, 2,091건 전부 |
| 6 | 페이지 수 = ceil(total/1000) | 6개 경계값, 중복 페이지 요청 0 |
| 7 | 순서·id·rank 연속성 | `items[1000].rank == 1001`, 고유 id 2,091 |
| 8 | 2페이지 실패 | `FAILED` — 1,000건을 정상처럼 주지 않음 |
| 9 | 마지막 페이지가 모자람 | `FAILED`(불완전) |
| 10 | totalCount 없음 + 소량 | 기존과 동일하게 통과 |
| 11 | totalCount 없음 + 상한 도달 | `FAILED`(절단 가능) |
| 12 | totalCount 비숫자 | 0건으로 떨어뜨리지 않음 |
| 13 | 다중 셀 동시 | 전역 peak ≤ `MOLIT_CONCURRENCY` |
| 14 | 한 셀 내부 | 동시 페이지 == 1(버스트 없음) |
| 15 | 같은 셀 동시 요청 | 페이지 시퀀스 1회 공유, 각자 사본 |
| 16 | 비밀값 | serviceKey·URL이 응답으로 새지 않음 |

### 실행 결과

```
npx tsx --test src/lib/molit-paging.test.ts       pass 16  fail 0
npx tsx --test src/lib/molit-rate-guard.test.ts   pass 26  fail 0  (한 줄도 수정 없이)
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"
                                                  pass 2171  fail 0  (10.3s)
npx eslint src/lib/api-molit.ts src/lib/molit-paging.test.ts   exit 0
npx tsc --noEmit                                  src/ 오류 0
                                                  나머지 25건은 기존 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                     Compiled successfully in 1404ms, 43/43 static pages
```

---

## 7. 실 API QA (read-only)

`scripts/qa-molit-live-paging.ts` — 수정된 `fetchMolitData()`를 그대로 호출.

| 지역 | 유형 | 월 | expected | fetched | 페이지 | 고유 id | 소요 | 판정 |
|---|---|---|---|---|---|---|---|---|
| 서울 강남구 11680 | 전월세 | 202603 | 2,091 | **2,091** | 3 | 2,091 | 2,333ms | PASS |
| 서울 송파구 11710 | 전월세 | 202603 | 1,873 | **1,873** | 2 | 1,873 | 1,325ms | PASS |
| 경기 분당구 41135 | 전월세 | 202603 | 1,358 | **1,358** | 2 | 1,358 | 1,152ms | PASS |
| 부산 해운대구 26350 | 전월세 | 202603 | 714 | 714 | 1 | 714 | 523ms | PASS |
| 부산 해운대구 26350 | 매매 | 202603 | 387 | 387 | 1 | 387 | 417ms | PASS |
| 부산 서구 26140 | 매매 | 202603 | 117 | 117 | 1 | 117 | 369ms | PASS |

### 부산 parity — 요청 형태 변경의 무해성

`pageNo=1`을 붙인 요청과 기존(`pageNo` 없음) 요청의 응답 페이로드를 직접 비교:

| 유형 | lawdCd | 월 | totalCount | 기존 | pageNo=1 | 동일 |
|---|---|---|---|---|---|---|
| 매매 | 26140 | 202603 | 117 | 117 | 117 | **YES** |
| 매매 | 26350 | 202603 | 387 | 387 | 387 | **YES** |
| 전월세 | 26350 | 202603 | 714 | 714 | 714 | **YES** |
| 전월세 | 26470 | 202608 | 181 | 181 | 181 | **YES** |

**바이트 단위로 동일**하다. ≤1,000건 셀에서 이 변경은 관측 가능한 차이를 만들지 않는다.

---

## 8. 성능

- **단일 페이지 셀: 회귀 없음.** 요청 수가 그대로 1회이고 페이로드가 동일하다. 위 parity가 이를 확인한다.
- **다중 페이지 셀: 페이지 수에 비례.** 2페이지 ≈ 1.2초, 3페이지 ≈ 2.3초(게이트 페이싱 250ms 포함). 이는 "없던 데이터를 가져오는 비용"이지 회귀가 아니다 — 수정 전에는 그 행들을 아예 못 가져왔다.
- **운영 영향은 현재 0이다.** 서울/경기는 아직 활성화돼 있지 않고, 부산은 probe한 모든 셀이 1페이지다(매매 최대 387, 전월세 최대 714). 다중 페이지 경로는 서울/경기 lawdCd로 직접 조회할 때만 활성화된다.
- 핵심 사용자 플로우에서 3초 이상 회귀는 관측되지 않았다.

---

## 9. 로깅

다중 페이지를 실제로 읽은 셀만 한 줄 남긴다(정상 단일 페이지는 조용하다):

```
[molit] paged fetch type=rent lawdCd=11680 dealYmd=202603 totalCount=2091 pagesFetched=3 fetchedCount=2091
```

serviceKey·요청 URL은 남기지 않는다. 실패 메시지는 기존 `redactMolitFailureMessage()`를 그대로 통과한다(테스트 16번으로 고정). 기존 ErrorLog 아키텍처를 바꾸지 않았다.

---

## 10. 하지 않은 것

- DB/schema/migration 변경 0. coverage cell·verified bookkeeping 변경 0(§14 준수 — 대량 경로는 이미 페이징 가능).
- bulk backfill 0. cron 재설계 0. `SyncRun` 테이블 0.
- SEO/region enable 0. Score 공식 변경 0. auth/security 변경 0.
- 소비자 18곳 수정 0. 대량 sync fetcher 수정 0.
- 타임아웃 정책 변경 0(실측 근거로 불필요 판정).

---

## 11. 남은 위험

- **다중 페이지 셀의 운영 실증은 아직 서울/경기 직접 조회뿐이다.** 부산 운영 트래픽은 여전히 전부 1페이지라, 이 경로가 실제 사용자 부하 아래에서 도는 것은 서울 활성화 이후에 처음 관측된다.
- **한 셀이 여러 요청을 쓰므로 quota 소모가 셀당 최대 3배가 될 수 있다.** 다만 실측 한도가 endpoint당 10,000이고 일일 증분이 그 5% 미만이라(`MOLIT_QUOTA_SCALE_PROBE_V1` §6) 여유가 크다.
- **과거 호황기 매매 월은 1,000을 넘을 수 있다**(DB에 최대 2,442행 셀 존재). 그 셀을 라이브로 조회하면 이제 2~3페이지를 읽는다 — 옳은 동작이지만 해당 월 상세 조회가 그만큼 느려진다.
- 통계 라우트에 `maxDuration`이 없다는 기존 지적(`SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1` §22)은 그대로다. 서울 활성화 시 다중 페이지 셀이 겹치면 이 라우트가 먼저 압박을 받는다.
- 무제한 인메모리 월 캐시(`molit-month-cache.ts`) 지적도 그대로다. 이번 STEP 범위 밖.
