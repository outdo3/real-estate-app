# TRADE DB FIRST V1 — STEP E: 신고가/최고가 DB-FIRST 전환 + Completeness Gate 검증

## 1. 목적

"2년최고가"(`/stats/record-high`, `/api/stats/price-rankings?mode=record-high`)를
부산 요청에 한해 TradeHistory DB-first로 전환한다. 이번 STEP의 핵심은
"DB로 옮겼다"는 사실 자체가 아니라, **wording(문구)이 실제 데이터
완전성(completeness)을 초과해서 주장하지 않는지**를 명시적으로
재검증하는 것이다(§10 TRUST VERDICT 참고) — 그 결론이 나오기 전까지는
DB-first 전환 자체도 완료로 간주하지 않는다.

## 2. 기존 알고리즘 AUDIT (변경 없음)

`src/lib/price-ranking.ts`의 `buildRecordHighRows()`를 전수 감사했다.

- **비교 단위**: `groupKey`(identityKey+exact raw exclusiveArea+dealType,
  decline/rising과 동일) — 같은 단지라도 면적이 다르면 절대 병합하지
  않는다.
- **판정**: 기간 내 각 거래를, **그 거래 이전(strictly earlier) 트레일링
  `HISTORICAL_LOOKBACK_MONTHS`(=24개월) 내 검증된(비취소) 거래 중 최고가**
  와 비교한다. 실제로 넘어선 거래만 신고가로 인정 — 이전 최고가가 없으면
  (그룹의 첫 거래) 신고가 판정 자체가 불가능하다(`priorHigh: null` → skip).
- **decline/rising과의 구조적 차이**: decline/rising은 그룹당 "기간 내
  가장 최근" 거래 1건만 뽑지만(latest-in-period), 신고가는 기간 내에서
  실제로 자기 자신의 이전 최고가를 갱신한 거래를 **전부** row로 남긴다
  (같은 그룹에서 여러 건이 각각 신고가를 경신했다면 전부 별도 사건).
- **문구**: `buildRecordHighInterpretation()`이 항상 `historicalCoverageLabel()`
  ("2년" 또는 "N개월")을 문구에 넣어 조회 범위를 명시한다. `price-ranking.ts`
  §35 주석과 `price-ranking.test.ts`가 `"역대"` 문자열이 어떤 interpretation
  출력에도 등장하지 않음을 이미 테스트로 강제하고 있었다(이번 STEP 이전부터
  존재하는 기존 정책 — 새로 추가한 게 아니라 재확인).
- **statsMenu.ts**: `slug: 'record-high'`의 제목은 이미 `'2년최고가'`이고
  주석에 "무제한을 뜻하는 '신고가' 대신 정직하게 범위를 밝힌 '2년최고가'를
  쓴다"고 명시돼 있다 — UI 레이어도 이미 이 STEP이 요구하는 방향과 일치.

이 정의는 이번 STEP에서 **한 글자도 바꾸지 않았다** — `price-ranking.ts`,
`PriceRankingView.tsx`, `statsMenu.ts` 전부 무변경.

전수 감사 대상(§6 요구): `feed/route.ts`(§18 "표시 기간 내 신고가" 코멘트
확인, 별도 신고가 계산 로직 없음 — feed는 record-high row를 직접 계산하지
않고 단순 이벤트 피드), `PriceRankingView.tsx`(§32/§318 "무제한 역대 아님"
코멘트 확인, 렌더링 로직만), `home-client.tsx`/`type-client.tsx`/
`statsMenu.ts`(라우팅/메뉴만), `MarketInsights.tsx`/`TransactionFeedView.tsx`/
`TableList.tsx`/`RankingRow.tsx`/`regional-feed.ts`/`stats-insight.ts` —
전부 `price-ranking.ts`의 결과를 그대로 표시하거나 무관한 기능(다른 화면).
신고가를 독립적으로 재계산하는 다른 경로는 없음을 확인했다.

## 3. DB-FIRST SQL 설계

### 3-1. STEP C-2의 `is_new_high` CTE를 그대로 재사용

decline이 이미 내부적으로 계산하던 `is_new_high`
(`deal_amount > COALESCE(prior_high_amount, sentinel)`, `prior_high_amount`는
`MAX(deal_amount) OVER (PARTITION BY group_key ORDER BY deal_date ASC, id DESC
ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)`)가 **정확히 신고가
판정의 핵심 조건과 동일한 연산**이었다 — decline의 "step2 부산물"이 신고가의
"메인 요리"였던 셈. `raw`(dedupe) → `base`(row_seq/month_index) →
`step1`(prior_high_amount) → `step2`(is_new_high) → `step3`(prior_high_date
전파)까지 decline/rising과 **완전히 동일한 CTE**를 그대로 복사했다(§9 —
이미 검증된 tie-break/dedupe/trailing12mo 로직 재발명 금지).

### 3-2. 유일한 구조적 차이: `rn=1` 필터 제거

decline/rising은 `period_latest`에서 `ROW_NUMBER() ... rn=1`로 그룹당
"기간 내 최근 거래" 하나만 candidates로 남긴다. 신고가는 이 필터를 두지
않고 `WHERE deal_date BETWEEN period AND is_new_high = true`만으로
candidates를 뽑는다 — 그룹당 여러 row가 나올 수 있다(§2의 제품 정의 그대로).

### 3-3. tie-break/trailing12mo — decline과 100% 동일 재사용

같은 날짜 동점 시 `id DESC`를 "더 이른 것"으로 취급하는 STEP C 관례,
trailing12moSampleCount의 JOIN+GROUP BY 패턴(상관 서브쿼리 대비 최대 35배
느림, STEP C-2 실측)을 그대로 재사용했다 — 새 tie-break를 만들지 않았다.

### 3-4. 신규 함수(trade-history-read.ts)

`getRecordHighRowsFromDb(lawdCds, periodFrom, periodTo)` — 단일 SQL pass,
priorHighAmount/priorHighDate/trailingSampleCount까지 전부 계산해 반환.

### 3-5. route.ts 배선

`price-rankings/route.ts`에 decline/rising과 나란히 `mode==='record-high'`
DB-first 분기를 추가했다(sido-all/단일구 각각). 캐시 키는
`stats-price-rankings-recordhigh-v1-db(-sido)`로, decline/rising의
`declinerising-v3` prefix와 **완전히 분리**했다 — 오래된 캐시 엔트리와
충돌할 수 없다.

## 4. Row reduction / Query count

- Busan-wide 24개월 base(dealCanceled=false, sale) raw rows: **65,532건**
  (구 MOLIT-fetch-all 방식이라면 이 규모를 Node로 옮겨야 했을 양) — 새 경로는
  이 중 단 한 건도 Node로 옮기지 않고 Postgres 안에서 전부 계산한다.
- 최종 응답 row 수(가장 큰 케이스, 부산 전체 12개월): 5,190건(SQL이 이미
  계산 완료한 최종 candidate만 전송).
- **쿼리 수: 요청당 정확히 1회**(`$queryRaw` 단일 호출, `lawdCd = ANY(...)`로
  지역 배열을 한 번에 처리 — 구별 반복 없음, N+1 없음).

## 5. Old(MOLIT) vs New(DB) A/B — 18케이스

부산 전체/해운대구/서구/동래구/부산진구/기장군 × 30일/3개월/12개월,
git stash 기반 tight A/B(같은 시점 기준 재측정 — 코드만 교체, "지금"
드리프트 최소화)로 비교했다.

**결과**: 18개 파일 전부에서 차이 발견(완전 일치는 `dongnae_30d`,
`gijang_30d`, `busanjin_30d`, `seogu_3m` 정도만 근접). 그러나 차이의
방향이 **100% 한쪽으로만 일관**됐다 — 어떤 케이스에서도 old(MOLIT)의
priorHighAmount가 new(DB)보다 높거나, old의 priorHighDate가 new보다
이른 경우는 단 한 건도 없었다. 항상 new(DB) ≥ old(MOLIT), new의 날짜가
old와 같거나 더 이르다.

**Root cause 직접 검증**(원본 저장 이력과 대조, STEP C/D와 동일 기법):

- `26140-1321`(92.9051㎡): MOLIT은 priorHigh=85000만원(2026-02-01)이라고
  했지만, `getTradeHistory()`로 원본 이력을 직접 조회하니 **2025-03-28에
  같은 날 두 건(85000만원 id=4860, 87500만원 id=4852)이 있었고**, 기존
  프로덕션 tie-break(`id DESC`가 "더 이른 것") 규칙대로면 87500만원이
  정확한 priorHigh다. DB는 87500/2025-03-28을 정확히 반환했다 — MOLIT의
  실시간 fetch가 이 거래를 놓쳤다(throttling 관련 월별 부분 누락, §36
  MOLIT_DATA_MISSING).
- `26710-630`(63.9811㎡): MOLIT은 priorHigh=36300만원(2025-06-10)이라고
  했지만, 원본 이력에는 2021~2024년에 걸쳐 41000~62200만원대 거래가 다수
  존재한다 — MOLIT이 이 지역/식별자의 과거 이력을 사실상 대부분 놓쳤다는
  뜻이다. DB는 41000/2024-09-23을 정확히 반환했다.

**분류(요구된 taxonomy)**: 전부 **DB_DATA_MORE_COMPLETE / MOLIT_DATA_MISSING**
— STEP C(하락 12개월)/STEP D(변동지도 12개월)에서 이미 반복 확인된
"throttled 실시간 MOLIT fetch가 DB보다 덜 완전하다"는 동일 패턴의 4번째
재현이다. BUG 아님. total row 수가 new < old로 나온 것도 이 패턴과
일관된다 — MOLIT이 실제보다 낮은 priorHigh를 기준으로 일부 거래를
"신고가"로 잘못 판정(false positive)했었는데, DB의 더 완전한 이력으로는
그 거래가 진짜 역사적 고점을 넘지 못했으므로 신고가 목록에서 빠진다. 즉
**DB-first 전환은 기존 MOLIT 경로의 실제 정확도 문제(신고가 과대 판정)를
수정하는 효과가 있었다** — record-high가 원래 의도한 "실제로 이전
최고가를 넘었는가"라는 질문에 더 충실해졌다.

## 6. Production QA / 정확성 샘플링

- 취소거래 제외 검증: `dealCanceled=true`인 최고액(57만/205.34㎡,
  `26350-2162`) 샘플을 record-high 후보군에서 직접 검색 — **등장하지
  않음**(정상 제외 확인).
- exact-area/aptSeq 오염 방지: `group_key` partition을 그대로 재사용하므로
  STEP C-2에서 이미 실측 검증된 "855,045 rows 전부에서 SQL group_key ==
  JS groupKey() byte-identical" 보증을 그대로 상속한다 — 별도 재검증 불필요.
- 같은 날 복수 거래 tie-break: §5의 `26140-1321` 사례로 실측 확인(위 §5).
- "이전 최고가 없음"(그룹의 첫 거래) 케이스: SQL의
  `WHERE ... prior_high_amount IS NOT NULL`이 JS의 `if (!p.priorHigh)
  continue`를 구조적으로 그대로 강제한다.

## 7. MOLIT / 부산 user path

`fetchMonthGated`에 임시 `console.error` probe를 추가해 확인:

- 부산 record-high 요청(6개 지역 × 3개 기간, 18회) — probe 호출 **0회**.
- 비교 대조군(서울 강남구, `lawdCd=11680`) record-high 요청 1회 — probe
  호출 **24회**(24개월 × 1회) — probe 자체가 정상 작동함을 함께 증명.

Probe는 검증 직후 되돌렸다(`git diff src/lib/molit-stats-helpers.ts` 빈 결과
확인 — 커밋에 포함되지 않음).

## 8. Regression

`/stats/decline`(서구) 브라우저로 재확인 — 정상 동작(하락 26건, DB-first
경로 그대로 유지, 이번 STEP이 건드리지 않은 코드가 실제로 안 바뀌었음을
확인). `/stats/record-high` 브라우저 확인: 30일(7건)/12개월(134건) — 둘 다
raw SQL probe와 정확히 일치. 힐스테이트이진베이시티아파트(92.91㎡) 항목이
"최근 2년 최고가 2025-03-28 대비"로 정확히 §5에서 직접 검증한 값과
일치하는 것을 실제 화면에서 확인했다 — SQL→route→API→UI 전체 파이프라인
종단 검증.

## 9. Performance summary

Raw SQL(스크립트 직접 호출, DB round-trip만):

| 지역 | 30일 | 3개월 | 12개월 |
|---|---|---|---|
| 부산 전체 | 466ms | 525ms | 735ms(반복 시 711~769ms) |
| 해운대구 | 93ms | 70ms | 105ms |
| 서구 | 27ms | 30ms | 43ms |
| 동래구 | 109ms | 111ms | 121ms |
| 부산진구 | 77ms | 78ms | 92ms |
| 기장군 | 37ms | 40ms | 39ms |

HTTP 라우트(Turbopack dev, 첫 호출 vs 재호출):

- 첫 호출(라우트 컴파일 포함): 부산 전체 890~1195ms, 나머지 407~609ms.
- 재호출(warm): 전 지역·기간 **292~434ms** — 전부 warm 목표(≤500ms) 충족.

**판정**: 전 케이스 PASS(warm ≤500ms 충족, cold도 대부분 ≤1s, 부산
전체의 최초 1회만 1.2s 근접이나 "1~2s 검토 후 허용" 범위 내이며 이후
캐시로 즉시 해소). 재설계 불필요.

## 10. TRUST VERDICT

이번 STEP의 핵심 산출물이다 — spec §15/§40의 명시적 요구.

### 10-1. 사실관계

- `TRADE_CANCELLATION_RESYNC_V1.md`(2026-08-30 실행)가 재동기화/검증한
  범위는 **"현재월 + 직전 12개월"(총 13개월)** 뿐이다. 이전에는 parser
  버그로 `dealCanceled`가 **항상 false**로 backfill돼 있었다(취소거래가
  전부 유효거래로 잘못 저장).
- 신고가/하락이 쓰는 트레일링 lookback은 `HISTORICAL_LOOKBACK_MONTHS
  = 24개월`이다.
- 13개월(검증 완료) < 24개월(계산 범위) — **약 11개월(13~24개월 전) 구간은
  cancellation 정확성이 검증되지 않았다.** 이 구간에 실제로는 취소된
  거래가 `dealCanceled=false`로 남아있어 priorHigh를 부풀릴 가능성이
  이론적으로 존재한다(단, 13개월 재동기화 실측 취소율 2,277/39,794 ≈
  5.7%를 그대로 적용해도, 24개월 lookback 전체에서 record-high가 실제로
  이 오염의 영향을 받는 비율은 소수일 것으로 추정된다 — 정확한 재계산은
  이번 STEP 범위 밖의 전체 재동기화 없이는 불가능).

### 10-2. 판정

| 문구 | 판정 | 근거 |
|---|---|---|
| **"2년최고가"** (현재 UI, `historicalCoverageLabel()` 기반) | **LIMITED** | 완전성(completeness)을 주장하지 않고 "최근 24개월"이라는 조회 범위만 정직하게 주장한다는 점에서 안전하지만, 그 24개월 중 뒤쪽 11개월의 취소거래 정확성이 미검증이라는 알려진 데이터 품질 노출이 존재한다. |
| **"역대최고가"** | **UNSAFE** | 과거 전체(~2006~) 취소거래 정확성이 전혀 검증되지 않았고, §3 STOP 조건("역대"를 허용하려면 과거 cancellation 재수집 필요)에 명시적으로 해당 — 이번 STEP 범위 밖. |
| **"역대신고가"** | **UNSAFE** | 위와 동일 이유. |

### 10-3. 권장 문구

**현행 유지** — "2년최고가"/"최근 N개월 최고가를 넘어섰어요" 그대로. 이번
STEP은 이 문구를 하나도 바꾸지 않았다(§40 — DB-first 전환이 기존보다
더 과장된 문구를 도입해서는 안 된다는 원칙 준수). "역대" 계열 문구는
`price-ranking.test.ts`가 이미 코드 레벨에서 금지하고 있어 별도 조치
불필요.

### 10-4. PM_DECISION_REQUIRED?

**예, 하나의 항목에 한해.** DB-first 전환 자체나 현재 문구를 바꾸는 데는
승인이 필요 없다(이미 안전한 현행 문구를 그대로 재사용했을 뿐). 그러나
**"2년최고가"라는 24개월 claim의 뒤쪽 11개월이 취소거래 미검증 상태로
남아있다는 사실 자체는 STEP B/C/C-2/D가 이미 동일한 24개월 DB 윈도우로
먼저 노출시킨 것**이며, 이번 STEP이 새로 만든 리스크가 아니다(record-high
전용 리스크가 아니라 24개월 lookback을 쓰는 모든 기능의 공통 리스크).
따라서:

- **이번 STEP에서 임의로 조치하지 않은 항목**: 과거 취소 재동기화 확장
  (13개월 → 24개월, 또는 전체 역사)은 수행하지 않았다(범위 밖, STOP
  조건 §3).
- **PM 결정이 필요한 질문**: "24개월 lookback 전체에 대해 취소 재동기화를
  확장할 가치/우선순위가 있는가, 아니면 현재의 '13개월만 검증됨'이라는
  잔여 리스크를 informed하게 감수하고 진행할 것인가"는 이번 STEP 범위를
  넘는 제품 결정이며, 이 문서로 명시적으로 보고한다.

## 11. Cache

신규 prefix(`stats-price-rankings-recordhigh-v1-db(-sido)`)를 썼다 —
decline/rising의 `declinerising-v3` prefix와 절대 겹치지 않는다. TTL은
기존과 동일하게 5분.

## 12. Query count / N+1

요청당 SQL 쿼리 1회(§4). Unit Master pyeong 조회는 기존 결과 페이지(최대
100건)에만 batch로 적용되는 기존 로직 그대로(변경 없음).

## 13. Index

기존 인덱스(`[aptSeq, exclusiveArea, dealDate]`, `[lawdCd, dealDate]`,
`[identityKey, dealDate]`, `[dealDate]`)만으로 §9 성능 목표를 전부
충족했다 — 신규 인덱스/스키마 변경 없음.

## 14. Test / Build

- `npx tsc --noEmit`: 20건(전부 `scripts/` 내 기존 무관 오류, 이번 STEP
  이전과 동일) — 신규 오류 0건.
- `npx eslint src/lib/trade-history-read.ts src/app/api/stats/price-rankings/route.ts`:
  0 warning/error.
- `npm run build`: 성공(`/api/stats/price-rankings` 포함 전체 라우트 빌드).
- `npx tsx --test $(find src -name "*.test.ts")`: **211/211 pass, 0 fail**
  (price-ranking.test.ts 포함). STEP C-2/D와 동일한 이유로 신규 테스트를
  추가하지 않았다 — record-high의 순수 비즈니스 로직(`buildRecordHighRows`,
  `buildRecordHighInterpretation`)은 이번 STEP에서 한 글자도 바뀌지
  않았고 이미 기존 테스트로 커버된다. 새 SQL 경로의 정확성은 §5(A/B)와
  §6(직접 원본 대조)으로 실증했다.

## 15. Database

Prisma schema 변경 없음, migration 없음, production 쓰기 없음. 읽기 전용
SQL(`$queryRaw`, SELECT만).

## 16. Known Limitations

- §10에서 기술한 "13개월 검증 vs 24개월 계산 범위" 갭은 record-high뿐
  아니라 decline/rising/region-change(STEP C/C-2/D)에도 동일하게 존재하는
  구조적 리스크다 — 이번 STEP이 처음 발견했을 뿐, STEP E가 만든 문제가
  아니다.
- MOLIT 실시간 fetch의 완전성 문제(throttling 관련 부분 누락)는 이번
  STEP에서 다시 확인됐지만 수정 대상이 아니다(비부산 지역은 여전히
  MOLIT 경로를 그대로 쓰므로, 비부산 사용자는 이 부정확성에 계속 노출된다
  — 부산 DB-first 전환 확장이 유일한 근본 해법).
- 모바일 실기기 QA는 이번 STEP도 수행하지 못했다(`resize_window`가 이
  세션에서 계속 비정상 동작) — UI 코드 자체가 무변경이므로 STEP
  C-2/D까지의 기존 검증이 architecturally 계속 유효하다고 간주한다.
