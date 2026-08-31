# MASTER COVERAGE SYNC V1

## 1. Goal

`RECENT_MASTER_MISSING_16_AUDIT_V1` §14/§19와 `MASTER_MISSING_REPAIR_V1`
§17이 이미 확정한 next step: 16건을 보정해 만든 현재 100.00% coverage는
**1회성 스냅샷 보정**일 뿐, 다음 달 새로 거래되는 aptSeq는 동일한
구조적 원인(`ApartmentMaster`가 1회성 seed이고 MOLIT 신고에 지연이
있음)으로 다시 누락된다. 이번 STEP은 그 16건을 다시 수동 복구하는 게
아니라, **missing aptSeq를 반복적으로 탐지·검증·분류할 수 있는 재사용
가능한 구조**를 만든다.

## 2. Audit — 기존 구조 재사용

바로 코드를 작성하지 않고 먼저 직전 파이프라인을 역추적했다:

- `scripts/audit-recent-master-missing-16.ts` — read-only, 최근 24개월
  Busan traded aptSeq를 `groupBy`로 모아 `ApartmentMaster`와 대조,
  missing마다 전체 거래 이력을 조회해 name/dong/jibun variant, Master
  alias/address 충돌, legacy `Apartment` 충돌까지 forensic profile로
  저장.
- `scripts/classify-recent-master-missing-16.ts` — profile을 읽어
  A(ACTIVE_APARTMENT_MASTER_OMISSION)/F(SOURCE_ALIAS_MISMATCH)/
  I(UNKNOWN) 규칙으로 `READY_FOR_MASTER_CREATE` / `REVIEW_REQUIRED`를
  판정.
- `scripts/repair-recent-missing-masters-logic.ts` — 순수 함수
  `buildMasterRowPlan()`/`buildAllPlans()`. aptSeq 우선 + 필수 identity
  필드 완전성만으로 INSERT/SKIP_DUPLICATE/REJECT_MISSING_FIELD/
  SKIP_NOT_READY를 판정하고, secondary metadata 키를 아예 생성 데이터에
  넣지 않는다. `BUSAN_GU_BY_LAWDCD`(16개 구·군 매핑)도 여기 있다.
- `scripts/repair-recent-missing-masters.ts` — dry-run 기본,
  `--apply`로만 write, `prisma.apartmentMaster.create()` 단 한 곳에서만
  실제 INSERT(update 경로 자체가 코드에 없음).

`ApartmentMaster`(`aptSeq @unique`, §M2/M3 설계 그대로),
`ApartmentTradeHistory`(`aptSeq`/`dong`/`jibun`/`lawdCd`/`buildYear`
raw 필드, `dealDate` 인덱스 쿼리 가능) 스키마는 변경 없이 그대로
충분했다. cron/scheduler 인프라는 여전히 없다(`vercel.json` 없음,
`package.json`에 cron 스크립트 없음 — §14 기존 확인 재검증).

**결론**: 새 구조를 새로 설계하지 않고, 이 파이프라인을 "16건 1회성
스냅샷"에서 "임의 크기 missing 집합에 대해 반복 실행 가능한 도구"로
일반화하는 방향을 택했다.

## 3. 구현

### 3-1. `scripts/master-coverage-sync-logic.ts`(신규, 순수 함수)

- `computeCoverage(tradedAptSeqs, existingMasterAptSeqs)` — §8 coverage
  계산(집합 차집합, DB 호출 없음).
- `buildForensicProfile(aptSeq, trades, allMasters)` —
  audit-recent-master-missing-16.ts의 profile 구성 로직을 일반화. 추가:
  aptSeq 접두부("{lawdCd}-...")와 거래의 실제 lawdCd를 교차검증하는
  `aptSeqLawdMismatch` 가드를 새로 추가(원본 16건 audit에는 없던 추가
  안전장치).
- `classifyCandidateProfile(profile)` — classify-recent-master-missing-16
  .ts의 A/F/I 규칙을 그대로 일반화하되, 최종 출력을 스펙이 요구하는
  `HIGH_CONFIDENCE` / `REVIEW_REQUIRED` / `INVALID` 3단계로 매핑. 내부적
  으로는 기존 `Readiness`(`READY_FOR_MASTER_CREATE`/`REVIEW_REQUIRED`/
  `DO_NOT_CREATE`) 타입을 그대로 사용해 `buildMasterRowPlan()`과 100%
  호환.
- `profileToRepairCandidate()` — profile+classification을 기존
  `RepairCandidate` 형태로 변환하는 얇은 어댑터.
- `BUSAN_LAWD_CODES` — `BUSAN_GU_BY_LAWDCD`(기존 파일)에서 파생, 16개
  구·군 코드를 4번째로 하드코딩하지 않음.

이번 STEP에서 **새로 작성한 것은 missing 탐지/classification/adapter
뿐**이고, 실제 INSERT plan 생성(`buildMasterRowPlan`/`buildAllPlans`)은
`MASTER_MISSING_REPAIR_V1`이 이미 작성·테스트·Production에서 검증한
코드를 변경 없이 그대로 import해서 쓴다 — write 경로가 코드베이스에
두 곳으로 갈라지지 않는다.

### 3-2. `scripts/master-coverage-sync.ts`(신규, CLI 오케스트레이터)

```
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/master-coverage-sync.ts              # dry-run, 24개월
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/master-coverage-sync.ts --months=12   # 기간 조정
npx ts-node --compiler-options '{"module":"commonjs"}' scripts/master-coverage-sync.ts --apply       # HIGH_CONFIDENCE만 실제 INSERT
```

단계:

1. `apartmentTradeHistory.groupBy({by:['aptSeq']})` 배치 1회 — 최근
   N개월(기본 24) Busan `sale`/미취소 distinct aptSeq.
2. `apartmentMaster.findMany({aptSeq:{in:...}})` 배치 1회 — matched 집합.
3. `computeCoverage()` — coverage report 출력.
4. missing=0이면 여기서 report 저장 후 종료(§8 스펙 "missing 0이면
   할 것 없음으로 끝내지 말 것"을 만족시키려고, missing=0이어도 탐지
   →분류 파이프라인 코드 자체는 항상 실행되고 report에 명시적으로
   `HIGH_CONFIDENCE: 0 / REVIEW_REQUIRED: 0 / INVALID: 0`을 남긴다).
5. missing>0이면: `apartmentTradeHistory.findMany({aptSeq:{in:missingAptSeqs}})`
   **단 1회**로 전체 거래를 배치 조회(원본 16건 audit 스크립트는
   aptSeq당 개별 `findMany`를 루프 안에서 호출했음 — 이번 버전은 missing
   개수와 무관하게 항상 2개의 배치 쿼리로 끝나도록 고쳤다) 후 JS에서
   aptSeq별로 그룹핑, `apartmentMaster.findMany({sggCd:{in:BUSAN}})`
   배치 1회로 alias/address 충돌 참조 집합 확보.
6. `buildForensicProfile` + `classifyCandidateProfile` — 전부 인메모리.
7. `buildAllPlans()`(기존 코드 그대로) — `HIGH_CONFIDENCE`만 INSERT
   plan이 됨.
8. dry-run이면 여기서 종료(write 없음, PRODUCTION_WRITE_APPROVAL_REQUIRED
   여부만 report에 남김). `--apply`면 INSERT 직전 aptSeq 재조회(레이스
   가드) 후 `create()`.
9. 사람이 읽는 콘솔 report(§15 형식) + `scripts/_master_coverage_sync_results/
   sync-<timestamp>.json`(재현 가능, `.gitignore` 추가, 커밋 안 함)에
   기록.

### 3-3. Dry-run 기본 / write gate

`--apply` 플래그가 없으면 DB read만 하고 절대 write하지 않는다(기존
`repair-recent-missing-masters.ts`와 동일한 관례). `--apply`가 있어도
`HIGH_CONFIDENCE`(=`READY_FOR_MASTER_CREATE`)가 아닌 candidate는
`buildAllPlans()`가 `SKIP_NOT_READY`로 분류해 INSERT 후보에서 아예
빠진다 — REVIEW_REQUIRED/INVALID는 코드 구조상 자동 생성이
불가능하다.

### 3-4. Idempotency

- aptSeq가 이미 `ApartmentMaster`에 있으면 `buildMasterRowPlan()`이
  `SKIP_DUPLICATE`(기존 로직, 변경 없음).
- `--apply` 직전에 이번 STEP이 추가한 재확인 쿼리(§3-2 STEP 8)로
  candidate aptSeq를 다시 조회해, read와 write 사이에 다른 프로세스가
  같은 aptSeq를 이미 만들었을 가능성을 한 번 더 배제.
- 반복 실행해도 이미 처리된 aptSeq는 항상 SKIP — 매달 재실행 가능한
  구조.

### 3-5. Scheduler 연결

Vercel Cron/`.github/workflows`는 이번 STEP에서도 여전히 없다(§2
재확인). §16 권장 구조(`sync core → dry-run command → write-capable
command → 향후 scheduler`) 중 앞의 3단계까지 완성했고, scheduler
활성화는 별도 승인이 필요한 인프라 변경이라 이번 STEP 범위 밖으로
남긴다(§8 Next Step).

## 4. 현재 Production Coverage 감사 결과

`scripts/master-coverage-sync.ts`(dry-run, 기본 24개월) 실제 Production
DB 실행 결과(2026-08-31):

```
window: 24 months (>= 2024-09-10)
mode: DRY_RUN

TradeHistory distinct aptSeq: 3400
ApartmentMaster matched: 3400
Missing: 0
Coverage: 100.00%

HIGH_CONFIDENCE: 0
REVIEW_REQUIRED: 0
INVALID: 0

Production write: NOT EXECUTED (missing=0, no candidate to act on)
execution time: 2138ms
```

`MASTER_MISSING_REPAIR_V1` 완료 시점(3,403/3,403)과 비교해 3건 줄어든
3,400은 데이터 누락이 아니라 **24개월 rolling window가 며칠 지나며
자연스럽게 앞으로 밀린 것**(window 하한이 매 실행마다 "지금−24개월"로
재계산되므로, 그 사이 window 밖으로 빠져나간 오래된 거래가 있으면
분모/분자가 함께 줄어든다) — missing은 여전히 0이므로 정합성 문제
아님. Production write는 실행하지 않았다(missing=0이라 후보 자체가
없음, §13 "missing=0이면 승인 요청 없이 나머지 STEP을 끝까지 완료"
조건 그대로 적용).

## 5. Secondary Metadata 정책

변경 없음 — HIGH_CONFIDENCE candidate가 생기더라도
`buildMasterRowPlan()`(기존 코드, 변경 없음)이 `totalHouseholds`/좌표/
`parkingCount`/FAR·BCR/`useApprovalDate`/`mainBuildingCount`/
`mgmBldrgstPk`를 생성 데이터 객체에 아예 넣지 않는다(Prisma 기본값
null). `buildYear`만 MOLIT trade 원본 값으로 채운다. 단위테스트 K가
INSERT plan에 secondary metadata 키가 전혀 없음을 다시 확인한다(§7).

## 6. Household Guard 재확인

`SINGLE_BUILDING_AS_COMPLEX`류 문제(단일동 표제부 값을 단지 전체
세대수로 오인)는애초에 이번 STEP의 write 경로에 진입할 수 없다 — Master
생성 데이터에 `totalHouseholds` 필드 자체가 없기 때문이다(§5). 기존
household enrichment 파이프라인(`backfill-apartment-master-basic-data.ts`
의 guard)은 건드리지 않았다.

## 7. Tests

`scripts/master-coverage-sync-logic.test.mjs`(신규) 12개, `npx tsx
--test`:

- A/B: coverage 계산(missing=0 케이스, missing 1건 정확 탐지 — fixture)
- C: 깨끗한 identity → `HIGH_CONFIDENCE`
- D: 동일 aptSeq 내 이름/동/지번 흔들림(ambiguous) → `REVIEW_REQUIRED`
- E: 동일 dong+jibun에 다른 aptSeq Master 존재(address collision) →
  `REVIEW_REQUIRED`
- F: **wrong-apartment-fallback 회귀 가드** — 같은 브랜드명이 다른
  주소에 있어도(§7 "보해이브빌" 동명이인 사례) 충돌로 취급하지 않고
  `HIGH_CONFIDENCE` 유지
- G: 필수 identity 필드(jibun) 결측 → `INVALID`(`DO_NOT_CREATE`)
- H: aptSeq 접두부/거래 lawdCd 불일치(신규 가드) → `REVIEW_REQUIRED`
- I: 이미 Master에 있는 aptSeq는 HIGH_CONFIDENCE여도 INSERT 안 됨
  (idempotency)
- J: REVIEW_REQUIRED 후보는 INSERT plan으로 전혀 이어지지 않음
- K: HIGH_CONFIDENCE INSERT plan에 secondary metadata 키 없음
- `BUSAN_LAWD_CODES` 16개 구·군 재사용 확인(중복 정의 없음)

세션 전체 회귀: 기존 `.test.mjs`/`.test.ts` 전체(`npx tsx --test`)
**672/672 PASS**(신규 12개 포함, 회귀 없음).

## 8. Performance

Production 실행 실측: **2,138ms**(missing=0 경로, 배치 쿼리 2회 —
`groupBy` 1회 + `findMany` 1회). missing>0 경로는 추가로 배치 쿼리
2회(전체 거래 1회 + Master alias 참조 1회)만 더 실행되고, missing 건수
가 늘어도 DB 쿼리 횟수는 고정(N+1 없음) — §18 "3천~4천 aptSeq 수준은
빠르게 처리" 요구를 만족.

## 9. Test/Build

- `npx tsx --test $(find src scripts -name "*.test.mjs" -o -name
  "*.test.ts")`: **672/672 PASS**.
- `npx tsc --noEmit`: 기존 20건 유지(신규 파일 오류 0,
  `FAIL_EXISTING_SCRIPT_ERRORS` — 전부 무관한 사전 존재 스크립트:
  `apartment-score/busan-final8-check.ts`, `education/c6a-*`,
  `list-zips.ts`, `test-api.ts` 등).
- `npx eslint scripts/master-coverage-sync.ts
  scripts/master-coverage-sync-logic.ts`: clean.
- `npm run build`: PASS.

## 10. Known Limitations

- Production에서 missing=0이라 HIGH_CONFIDENCE/REVIEW_REQUIRED 분류가
  실제 후보를 대상으로는 검증되지 않았다(fixture 단위테스트로만
  검증, §7) — 다음 번 missing이 실제로 발생했을 때 이 STEP에서 만든
  분류 규칙이 그대로 유효한지는 그 시점에 재확인이 필요하다.
- scheduler(Vercel Cron 등) 연결은 하지 않았다 — 사람이 CLI로 실행하는
  구조(§3-5).
- household/좌표 등 secondary metadata enrichment는 여전히 이 도구의
  범위 밖이다(§5, 기존 정책 그대로).

## 11. Next Step

한글명 우선 제안:

1. **Master coverage sync 정기 실행 습관화**(승인 불필요, 운영 절차):
   최소 월 1회 `npx ts-node scripts/master-coverage-sync.ts`(dry-run)로
   재확인 — HIGH_CONFIDENCE 후보가 쌓이면 그때 `--apply` 실행 여부를
   승인받는다.
2. **Master coverage sync 자동 스케줄러 연결**(승인 필요): Vercel
   Cron 또는 유사 인프라를 도입해 위 정기 실행을 자동화. 인프라 신규
   도입이라 별도 STEP + 승인 필요.
3. **Household/좌표 등 secondary metadata enrichment 확장**(승인
   필요): 이번 STEP이 identity-only로 남긴 필드들을 건축물대장/
   geocoding으로 보강.
