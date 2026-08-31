# TRADE DB FIRST V1 — STEP F-2: 전국 Region Coverage 완결 + Identity Gate 검증

## 1. 목적

STEP F PM 검수 결과 PARTIAL 판정된 두 gap을 닫는다: (1) 전국 시도
enumeration에서 세종특별자치시 누락, (2) aptSeq 없는 거래가
`name+dong` fallback으로 조용히 canonical identity에 편입될 위험
audit. 이 STEP 완료 후에만 STEP F를 FINAL PASS로 잠근다. Production
write는 하지 않았다(READ only, 명시적 §2 정책).

## 2. 세종 누락 Root Cause(실측, 추측 아님)

`REGCODE_PROXY`(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes`)를
직접 조회해 확인:

```
regcode_pattern=*00000000 (기존 getSidoList()가 쓰던 패턴)
→ 16건 반환, 세종 없음

regcode_pattern=36* (세종의 알려진 시도코드 접두)
→ 151건 반환, 최상위 항목이 "3611000000"(세종특별자치시) 하나뿐
```

**원인**: 세종특별자치시는 대한민국에서 유일하게 구/군 하위 행정구역이
없는 특별자치시다(강원/제주 "특별자치도"는 일반 도처럼 시군구가
있음). 그래서 법정동코드 최상위 항목 자체가 다른 시도처럼
`XX00000000`(뒤 8자리 전부 0) 패턴이 아니라 `3611000000`(사실상
시군구 레벨과 동일한 코드 구조)이다 — `*00000000` 패턴이 구조적으로
절대 매칭시키지 못한다. **REGCODE_PROXY 데이터 자체의 구조적
특이사항이지 프록시 버그가 아니다.**

중요한 발견: `getSigunguListForSido('36')`는 **이미 수정 없이 정상
동작한다** — `36*00000` 쿼리 패턴이 `3611000000`과 자연히 일치하기
때문(실측 확인: 위 쿼리가 정확히 `[{code:'3611000000',
name:'세종특별자치시'}]` 반환). 즉 **누락 지점은 `getSidoList()`
하나뿐**이었다.

## 3. 수정 방법(최소, 문서화된 명시적 매핑)

`src/lib/region-utils.ts`의 `getSidoList()`에 세종을 명시적으로
추가했다(§5 "하드코딩 최소화" 원칙에 따라, one-off 패치가 아니라
근본 원인을 코드 주석으로 문서화한 최소 보강):

```ts
if (!list.some((s) => s.code === '36')) list.push({ code: '36', name: '세종특별자치시' });
```

`getSigunguListForSido()`는 건드리지 않았다(이미 정상). 이 fix는
`getSidoList()`를 쓰는 **모든** 호출부에 적용된다 — 이번 STEP에서
새로 만든 sync 엔진뿐 아니라, 이미 라이브인
`/api/stats/region-change?level=nation`("대한민국 전체" 첫 화면)도
함께 고쳐졌다. 이 API의 기존 코드 주석(`REGION_PRICE_CHANGE_MAP_V2
§11`)이 이미 "시도 17개 타일"이라고 명시하고 있었다 — 즉 세종 누락은
이미 라이브 기능에 존재하던 **의도와 다른 실제 동작(잠재 버그)**
였고, 이번 fix가 그 의도를 복원한 것이다. Production 라우트를
건드렸으므로 `npm run build` + 실제 dev 서버로
`/api/stats/region-change?level=nation` 응답을 직접 확인해
`sidos` 배열에 세종이 정상 포함됨을 검증했다(§ 4).

`resolveSidoCode()`(같은 파일, 유사 패턴이지만 `src/` 어디서도 호출
안 됨 — dead code)는 이번 STEP 범위 밖으로 남겼다(사용되지 않는
코드까지 넓히지 않음, AGENTS.md §14 원칙).

## 4. 전국 Region Coverage(수정 후 실측)

```
sido: 17건(세종 포함)
서울특별시(11), 부산광역시(26), 대구광역시(27), 인천광역시(28),
광주광역시(29), 대전광역시(30), 울산광역시(31), 경기도(41),
충청북도(43), 충청남도(44), 전라북도(45), 전라남도(46), 경상북도(47),
경상남도(48), 제주특별자치도(50), 강원특별자치도(51), 세종특별자치시(36)

sido code 중복: 0
전국 sync-target(시군구): 262건(STEP F의 261 + 세종 1)
lawdCd 중복: 0
invalid lawdCd: 0
empty code: 0
```

세종은 sync-target 목록에서 `{code:'3611000000', name:'세종특별자치시'}`
단 1건(하위 구/군이 없으므로 정상 — 다른 광역시가 여러 구를 갖는 것과
달리 세종 자체가 1개의 MOLIT 조회 단위).

Production 라우트 실측 확인(`/api/stats/region-change?level=nation`,
`npm run build` 성공 후 dev 서버 기동): 응답 `sidos` 배열에
`{"code":"36","name":"세종특별자치시"}` 정상 포함, 총 17건 — 라이브
"대한민국 전체" 화면이 실제로 고쳐졌음을 확인했다.

## 5. 세종 Dry-run(별도 검증)

`lawdCd=36110`(5자리 MOLIT 조회 코드, `3611000000`의 앞 5자리), 최근
3개월(2026-06~2026-08 dry-run):

```
cells=3 COMPLETE=2 EMPTY_VALID=1 FAILED=0 INVALID=0
fetched=529 invalidRows=0 insert=529(신규 지역 최초 진입 시뮬레이션)
conflicts=0
```

- `36110`이 실제 MOLIT에서 유효한 lawdCd임을 확인(정상 응답, 529건
  실거래 fetch).
- **0건이 정상 empty인지 source 오류인지 구분**: 3개월 중 1개월이
  EMPTY_VALID(정상 응답, 0건 — 실거래가 없었던 달)로 정확히 분류됐고
  나머지 2개월은 실제 데이터가 있는 COMPLETE — FAILED로 분류된 달은
  없었다. 즉 "0건"이 API 실패로 오분류되지 않았다.
- normalizer(`normalizeMolitItemsToTradeRows`)가 529건을 전부
  정상 처리(invalidRows=0) — 별도 세종 전용 파싱 로직 불필요함을
  실증.

## 6. 전국 대표 샘플 Dry-run

서울(11110)/부산(26110)/대구(27110)/세종(36110)/경기(41110)/제주
(50110)/강원(51110), 최근 1개월(read-only, 실측 시점 202609):

```
cells=8(대구는 기존 STEP F manifest 기록 때문에 2개월 재확인 포함)
COMPLETE=1 EMPTY_VALID=7 FAILED=0 INVALID=0
insert=0 conflicts=0
```

7개 지역 전부 정상 recognized, MOLIT 요청 전부 valid(FAILED=0),
INVALID=0. 최신월(9월 1일 기준 1일차)이라 대부분 EMPTY_VALID인 것은
정상(신고 시차상 당연) — §4-2에서 이미 확인한 지난달 데이터(654건)로
aptSeq 측정을 별도 수행했다(§7).

## 7. Identity Safety Audit

### 7-1. 실제 ingestion flow 추적

- **Source**: MOLIT 응답에 `aptSeq` 필드가 존재(`api-molit.ts`가
  파싱). 없는 경우도 있음(빈 문자열/undefined).
- **Normalizer**(`trade-history-logic.ts`): `classifyInvalid()`는
  `aptSeq`와 `name`이 **둘 다** 없을 때만 `MISSING_IDENTITY`로
  거부한다 — `aptSeq`만 없고 `name`이 있으면 **거부되지 않고 통과**한다.
  `identityKey()`는 `aptSeq ? id:{aptSeq} : nd:{name}|{dong}`로
  fallback한다.
- **Write path**(`classifyAndWrite`, resync-cancellation-v2.ts): 자연키
  매칭만으로 insert/update를 결정하며, 자연키 자체가 `groupKeyStr`
  (=identityKey 기반)로 만들어지므로 **기존에는 aptSeq 없는 row도
  DB insert까지 도달할 수 있었다** — 확인됨(코드 audit으로 검증).

### 7-2. 실측 aptSeq missing율(nationwide sample, 지난달 완료 데이터)

```
서울 종로구: rows=6 missing=0(0.0%)
부산 서구: rows=49 missing=0(0.0%)
대구 중구: rows=86 missing=0(0.0%)
세종: rows=225 missing=0(0.0%)
경기 수원시: rows=0(해당월 거래 없음)
제주 제주시: rows=76 missing=0(0.0%)
강원 춘천시: rows=212 missing=0(0.0%)

전체: rows=654 missing=0(0.00%)
```

부산에서 이미 확인된 "aptSeq missing=0"(STEP A부터 일관) 결과가
수도권/광역시/특별자치시/도서/비수도권 도 지역까지 전부 동일하게
0%로 재확인됐다 — MOLIT "아파트" 매매 API 자체가 등록된 아파트
단지에는 항상 aptSeq를 포함한다는 강한 실증적 근거.

### 7-3. identityKey vs Canonical Identity 명확화(§13)

`identityKey`/`groupKey`는 **TradeHistory 내부 grouping
convenience**다 — 같은 단지+같은 정확 면적의 거래를 시간순으로 묶어
priorHigh/신고가/하락/변동지도를 계산하기 위한 목적으로만 쓰인다.
**ApartmentMaster(실제 canonical apartment 데이터베이스)나 검색/상세
페이지의 canonical identity와는 완전히 별개 시스템**이다 — 그쪽은
자체 `HIGH_CONFIDENCE`/`REVIEW_REQUIRED` 신뢰도 매칭 로직
(`audit-busan-apartment-master-integrity.ts` 등)을 쓰며 이번 STEP과
무관하다.

### 7-4. aptSeq 없는 row 정책(신규 구현)

실측(0%)상 기존 부산 동작에 영향이 없음을 확인했으므로(§12 STOP
조건 미해당), 안전 gate를 실제로 구현했다:

```
aptSeq present → insert(기존과 동일)
aptSeq absent(신규 row만) → reviewRequired로 분류, insert하지 않음
```

**적용 범위**: "신규 row"(자연키로 매칭되는 기존 DB row가 없는 경우)
에만 적용한다. 이미 DB에 있는 row(자연키로 매칭됨)의 cancellation
업데이트는 identity를 새로 만드는 게 아니므로(같은 row, 같은
identity, 취소 flag만 변경) 이 gate 대상이 아니다 — "기존 row가
있으면 aptSeq 유무와 무관하게 insert/reviewRequired로 가지 않는다"는
동작을 테스트로 명시했다(§9).

**구현 위치**: `resync-cancellation-v2.ts`의 `classifyAndWrite()` —
STEP F의 nationwide 엔진과 STEP TRADE_CANCELLATION_RESYNC_V2 둘 다
이 함수를 공유하므로, 한 곳만 고치면 양쪽 다 gate가 적용된다(중복
구현 없음). 결정 로직 자체는 순수 함수 `classifyRow()`
(`scripts/write-policy-logic.ts`, 신규, DB 접근 없음 — 테스트 대상)로
분리했다.

**검증**(dry-run 시뮬레이션, apply=false로 실제 write 없이):

```
aptSeq 있는 row + aptSeq 없는 row를 같이 넣으면
→ insertCount=1(aptSeq 있는 것만), reviewRequired=1(aptSeq 없는 것 skip)
```

기대대로 동작 확인(PASS). 기존 부산 동작에는 실측상 영향 없음(§7-2
0% 근거).

## 8. Incremental Engine Regression 없음

`computeMonthsForRegion` 기존 8개 테스트 전부 pass(변경 없음).
`classifyRow` 신규 9개 테스트 전부 pass. Overlap=3개월/retry(내장
5회)/bounded concurrency(순차)/batch 500/natural key/idempotency —
전부 STEP F 그대로, 이번 STEP은 write policy(reviewRequired 분류
추가) 외에 다른 로직을 바꾸지 않았다.

## 9. 부산 Regression 없음

부산 서구/해운대구/동래구 dry-run(overlap=3개월, read-only):

```
cells=10 COMPLETE=7 EMPTY_VALID=3 FAILED=0 INVALID=0
insert=0 conflicts=0 reviewRequired=0
```

FAILED=0/INVALID=0/reviewRequired=0(부산은 aptSeq 100%이므로 gate에
전혀 걸리지 않음 — 기존 동작 완전 보존) 확인. 이번 STEP은 Production
write를 전혀 하지 않았으므로(§2), 24M cancellation 데이터는 STEP F
직후 상태와 **완전히 동일**함을 직접 재확인했다:

```
                  STEP F 이후   STEP F-2 이후
older11mo canceled  2,432         2,432(불변)
recent13mo canceled 2,277         2,277(불변)
aptSeq missing      0             0
natural-key dup     0             0
```

## 10. Test / Build

- `node --experimental-strip-types --test scripts/incremental-sync-
  logic.test.mjs scripts/write-policy-logic.test.mjs scripts/
  trade-history-logic.test.mjs`: 32개 전부 pass(기존 23개 + 신규
  `write-policy-logic.test.mjs` 9개).
- `npx tsx --test`(src 전체, 211개): 전부 pass.
- `npx tsc --noEmit`: 20건(기존 무관 오류, 신규 0건).
- `npx eslint`(이번 STEP이 건드린 모든 파일): clean.
- `npm run build`: PASS(`region-utils.ts` 변경이 Production 라우트에
  영향을 주므로 빌드 + 실제 dev 서버 응답까지 확인, §4).

## 11. Database

- READ: 예
- INSERT: 0(§2 정책대로 Production write 없음 — 세종 dry-run/샘플
  dry-run 전부 apply=false, gate 검증도 apply=false)
- UPDATE: 0
- DELETE: 0
- schema/migration: 변경 없음

## 12. PRODUCTION_QA_WRITE_RECOMMENDED

세종 실제 write QA(예: 최근 1개월 `--apply --lawdCd=36110`)는 이번
STEP에서 실행하지 않았다 — dry-run(§5)이 이미 COMPLETE/EMPTY_VALID/
FAILED=0/INVALID=0/정상 파싱을 증명했으므로 correctness 확인을 위해
Production write가 **반드시 필요한 상태는 아니라고 판단**했다(§2
"세종 실제 write QA가 반드시 필요하다고 판단되면... PRODUCTION_QA_
WRITE_RECOMMENDED로 보고"는 조건부 지시 — 이번 STEP은 그 조건에
해당하지 않는다고 결론). 다만 세종을 실제 서비스 데이터에 포함시키려면
언젠가 반드시 최소 1회의 Production write가 필요하다 — 사용자가
원하면 STEP F의 bounded QA와 동일한 절차(dry-run→소규모 apply→
idempotency 확인)로 별도 진행 가능.

## 13. Known Limitations / 다음 STEP

- 세종은 여전히 DB에 실제 데이터가 없다(dry-run만 수행, §12).
- `resolveSidoCode()`의 동일한 세종 gap은 고치지 않았다(사용되지 않는
  dead code, 범위 밖).
- aptSeq REVIEW_REQUIRED 대상 row가 실제로 발생했을 때 이를 검토/재처리
  할 관리자 워크플로우는 아직 없다(카운트만 manifest에 기록됨) —
  실측 0%라 당장 급하지 않지만, ADMIN OPS V1에서 다룰 후보.
