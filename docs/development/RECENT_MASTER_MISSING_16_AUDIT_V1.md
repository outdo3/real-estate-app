# RECENT MASTER MISSING 16 AUDIT V1

## 1. Goal

`BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1`이 발견하고
`BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1`이 재확인한 "최근 24개월 실거래는
있으나 `ApartmentMaster`에 없는 16개 aptSeq"를 전수 분석해, 실제 active
apartment인지/rename/legacy/other-type인지 분류하고, 검색 coverage
99.53%를 출시 전 100%에 가깝게 만들 근거를 확보한다. Production write는
하지 않는다 — audit + classification + repair plan까지만.

## 2. Current 99.53% Coverage

`scripts/audit-busan-search-coverage.ts --recent24` 재실행(이번 STEP,
2026-08-31) 결과 — 이전 STEP과 완전히 동일:

```
TOTAL UNIVERSE (traded, aptSeq 있음): 3403
SEARCHABLE (MATCH): 3387
MISSING: 16
TRADED_APT_COVERAGE: 99.53%
SEARCH_API_MISSING: 0  ← 재확인, code-only fix 대상 없음
NAME_MISMATCH: 0
```

## 3. 16-candidate Universe

`scripts/audit-recent-master-missing-16.ts`(신규, read-only)로 16건 전부
전체 거래 이력(20년 전체, 최근 24/12/6개월 분리)까지 재구성:

| aptSeq | 이름 | dong | jibun | buildYear | 전체거래 | 최근24m | 최초거래 | 최근거래 |
|---|---|---|---|---|---|---|---|---|
| 26290-2594 | 햇살좋은집 | 대연동 | 1506-19 | 2017 | 17 | 1 | 2018-01-08 | 2026-08-22 |
| 26200-623 | 궁전그린파크빌라 | 영선동2가 | 39 | 2010 | 4 | 1 | - | 2026-07-20 |
| 26110-1 | 동광맨션 | 중앙동4가 | 40-15 | 1976 | 10 | 1 | - | 2026-07-31 |
| 26380-29 | 삼풍아파트 | 괴정동 | 487-6 | 1978 | 97 | 1 | - | 2026-07-24 |
| 26230-2842 | 가야봄여름가을겨울 | 가야동 | 585 | 2023 | 2 | 1 | - | 2026-08-12 |
| 26290-4786 | 롯데캐슬인피니엘 | 문현동 | 1257 | 2026 | 5 | 5 | - | 2026-08-26 |
| 26530-1016 | 퀀텀펠리스 | 주례동 | 5-2 | 2017 | 4 | 1 | - | 2026-08-22 |
| 26380-2073 | 대운스카이뷰1차 | 하단동 | 592-10 | 2022 | 46 | 46 | - | 2026-08-21 |
| 26230-177 | 보해이브빌 | 전포동 | 695-5 | 2003 | 80 | 1 | 2006-09-05 | 2026-08-16 |
| 26230-4559 | 아틀리에933 | 양정동 | 406-5 | 2025 | 1 | 1 | - | 2026-07-20 |
| 26410-2153 | 대림포레 | 구서동 | 420-14 | 2013 | 1 | 1 | - | 2026-08-13 |
| 26710-90 | 창신빌라 | 기장읍 대변리 | 442-1 | 1993 | 10 | 1 | - | 2026-08-10 |
| 26260-292 | 삼성빌라 | 온천동 | 1449-1 | 1995 | 28 | 1 | - | 2026-08-28 |
| 26470-226 | 에스케이드림피아 | 연산동 | 1299-8 | 2002 | 22 | 1 | - | 2026-08-18 |
| 26410-253 | 일번파크맨션에이동 | 남산동 | 973-3 | 1990 | 19 | 1 | - | 2026-08-10 |
| 26230-2116 | 피렌체 | 양정동 | 319-1 | 2013 | 19 | 1 | - | 2026-08-05 |

## 4. Classification Rules

A~I 9개 카테고리(스펙 §3) 그대로 적용. 판정 근거:

- **A(ACTIVE_APARTMENT_MASTER_OMISSION)**: 전체 거래 이력에서 name/dong/
  jibun이 흔들리지 않고(`SOURCE_IDENTITY_CONFLICT` 없음), `ApartmentMaster`
  에 동일 주소(dong+jibun) row가 없으며, legacy `Apartment`에도 없음.
- **F(SOURCE_ALIAS_MISMATCH)**: 동일 dong+jibun에 이미 다른 이름의
  Master row가 존재(rename 의심).
- **I(UNKNOWN)**: 자체 거래 이력 내에서 identity가 흔들림(재조사 필요).

## 5. Candidate Table (분류 결과)

16건 **전부 A(ACTIVE_APARTMENT_MASTER_OMISSION)**. 상세는
`data/master-integrity/recent-master-missing-16-v1.json` 참고(각 항목에
evidence/priority/confidence 전부 기록).

## 6. Active Apartment Findings

전부 다음 4가지를 동시에 만족해 A로 확정:

1. 전체 거래 이력(1~97건, §3 표) 내내 name/dong/jibun이 **단 한 번도
   흔들리지 않음**(예: 삼풍아파트 97건 전부 동일 identity).
2. `ApartmentMaster` 부산 전체(3,402행)에서 동일 dong+jibun row 없음.
3. legacy `Apartment`(부산 54행)에서도 exact/address match 없음.
4. 이름 정규화 후 우연히 같은 Master가 있어도(§7 참고) dong/jibun이
   달라 다른 물리적 건물임을 확인.

## 7. Rename/Alias Findings

**"보해이브빌"(aptSeq 26230-177, 전포동)** 만 유일하게 `ApartmentMaster`에
같은 이름의 다른 row(`aptSeq=26380-181`, 하단동, jibun 511-4)가 존재했다.
dong/jibun이 완전히 다르고(전포동 695-5 vs 하단동 511-4), 실측 검토 결과
**동명이인(같은 브랜드 시행사가 여러 지역에 같은 이름으로 지은 별개 단지)**
로 판정 — rename/merge 근거 없음, A 분류 유지.

## 8. Legacy Findings

16건 전부 legacy `Apartment`(부산 54행) 어디에도 exact name+dong 또는
dong+jibun 매치가 없다 — legacy 오염/legacy aptSeq 잔존 가능성 0건.

## 9. Other-type Findings

16건 전부 `ApartmentTradeHistory`에 존재하며, 이 테이블은
`TRADE_HISTORY_DATA_V1`부터 MOLIT `RTMSDataSvcAptTradeDev`(아파트 매매
실거래 전용 엔드포인트) 단일 source로만 채워진다 — "빌라"/"맨션" 등
구어체 명칭(궁전그린파크빌라/동광맨션/삼성빌라/창신빌라)이 섞여 있어도,
MOLIT가 이미 이 endpoint를 통해 "아파트"로 분류·공개한 거래이므로
E(NON_APARTMENT_OR_OTHER_TYPE)로 재분류할 근거가 없다(한국 노후 단지의
흔한 명명 관례 — 실제 연립/다세대였다면애초에 이 endpoint에 나타나지
않는다).

## 10. Official Source Verification

이번 STEP은 K-APT를 다시 시도하지 않았다(`MASTER_HOUSEHOLD_
VERIFICATION_V1`에서 이미 4개 엔드포인트 변형 전부
`NO_OPENAPI_SERVICE_ERROR`로 확정 — 스펙 §9 "무한 반복 금지" 준수).
16건의 identity 검증은 MOLIT 실거래(`ApartmentTradeHistory`, 이미
프로젝트 내 trusted persisted source) 하나만으로 충분히 강했다(§6) —
canonical name/aptSeq/address 확정에 건축물대장/K-APT 추가 조회가
필요하지 않았다(단, household/좌표 등 secondary metadata는 여전히
미확보 — §11).

## 11. Master Creation Readiness

**16/16 READY_FOR_MASTER_CREATE.** 조건(스펙 §10) 전부 충족:

- active apartment(§6) — YES 전부
- canonical identity 명확(aptSeq/dong/jibun 안정) — YES 전부
- duplicate existing Master 없음 — YES 전부(§7 보해이브빌도 다른 물리적
  건물로 확인됨)
- official/strong source 최소 1개 — YES(MOLIT 실거래, §10)
- search/detail에 안전하게 연결 가능 — YES(`ApartmentMaster.aptSeq`가
  `@unique`, `name`+`normalizedName`만 필수 필드라 최소 row 생성이
  schema상 안전, §12)

confidence: 11건 HIGH(전체 거래 5건 이상, identity가 오랜 기간 반복
검증됨), 5건 MEDIUM(전체 거래 1~4건 — identity 자체는 깨끗하지만 검증
샘플이 얇음): 아틀리에933(1), 대림포레(1), 가야봄여름가을겨울(2),
궁전그린파크빌라(4), 퀀텀펠리스(4).

## 12. Master Import Pipeline Root Cause

`ApartmentMaster` 3,402행 전부 **2026-08-13 하루 동안**(`createdAt` 범위
03:36~11:45 UTC) 단발성으로 생성됐다(`scripts/apartment_master_seed.ts`,
기본 `months=24` 롤링 윈도우). 이번 STEP 실행일(2026-08-31) 기준 16건의
거래일 분포를 보면:

- **약 절반은 seed 실행일(08-13) 이후**(예: 롯데캐슬인피니엘 08-26,
  삼성빌라 08-28, 퀀텀펠리스 08-22 등) — seed 시점에는 아예 존재하지
  않았던 거래.
- **나머지 절반은 seed 실행일 이전**(예: 피렌체 08-05, 아틀리에933
  07-20, 창신빌라 08-10) — MOLIT 실거래 신고는 계약 후 최대 30~60일
  지연될 수 있다는 사실이 이 프로젝트에 이미 문서화돼 있다
  (`scripts/sync-trade-history.ts` §40 LATE REPORTING 주석) — seed가
  08-13에 MOLIT를 조회한 시점에는 그 거래가 아직 MOLIT 시스템에
  등록되지 않았을 가능성이 높다.

**단일 근본원인**: `ApartmentMaster`는 특정 시점의 1회성 스냅샷이고,
MOLIT 실거래 신고 자체에 지연이 있다 — 이 두 요인의 조합으로, 스냅샷
시점 이후(또는 스냅샷 시점에 아직 미신고 상태였던) 거래는 구조적으로
전부 누락된다. 개별 backfill 로직 버그가 아니라 **"주기적 재동기화
부재"**가 유일한 원인이다(§14).

## 13. Search Fallback Analysis

Master row 생성(§11) 대신 검색 시점 UNION fallback(`ApartmentTradeHistory`
identity를 검색 후보로 직접 노출)도 검토했으나, 다음 이유로 Master 생성을
권장한다:

- Master row 생성은 기존 canonical identity 모델(§ 이전 STEP들에서
  확립)과 완전히 일치 — 검색/랭킹/dedupe 로직을 그대로 재사용 가능.
- UNION fallback은 검색 hot path에 새 쿼리 경로를 추가해 성능/복잡도
  리스크(§21 "기존 성능 유지" 원칙과 상충 가능)를 만든다.
- UNION fallback은 상세페이지 identity(세대수/준공/좌표 등 secondary
  필드)를 해결하지 못한다 — 결국 Master row가 필요하다.
- 16건 전부 READY_FOR_MASTER_CREATE로 이미 깨끗하게 분류됐으므로,
  fallback이라는 임시방편보다 정공법(승인 후 Master 생성)이 더 낫다.

## 14. Recurrence Risk

**"새로 실거래에 등장한 aptSeq가 ApartmentMaster에 자동/주기적으로
들어오는 구조인가?" → NO.**

`.github/workflows/` 디렉터리 자체가 존재하지 않고, `package.json`에
cron/scheduler 관련 스크립트가 없으며, `vercel.json`도 없다(Vercel Cron
Functions 미설정). `apartment_master_seed.ts`/`backfill-apartment-master-
basic-data.ts` 둘 다 사람이 CLI로 수동 실행해야 하는 1회성 스크립트다.
**이번 16건을 보완해도, 다음 달 새로 거래되는 aptSeq는 다시 같은 방식으로
누락된다** — `MASTER_COVERAGE_SYNC_V1`(주기적 재동기화 STEP)이 후속으로
필요하다(§19).

## 15. Expected Coverage After Repair

| 시나리오 | 계산 | coverage |
|---|---|---|
| 현재 | 3387/3403 | 99.53% |
| READY_FOR_MASTER_CREATE 16건 전부 생성 후(승인+실행 후) | 3403/3403 | **100.00%** |

단, 이는 "이번 STEP이 분석한 최근 24개월 스냅샷" 기준이며, §14의 recurrence
risk 때문에 재동기화 체계 없이는 시간이 지나며 다시 하락한다(매달 새로
거래되는 신규/저빈도 단지가 계속 발생).

## 16. Production Plan

Production write는 이번 STEP에서 하지 않는다. 향후 계획(승인 필요):

| action | 대상 | 비고 |
|---|---|---|
| `CREATE_MASTER_ROW` | 16건 전부 | 최소 필드(aptSeq/name/normalizedName/sido/sigungu/sggCd/umdName/jibun/buildYear, MOLIT 원본 그대로) — `apartment_master_seed.ts`의 기존 upsert 로직을 이 16개 aptSeq만 대상으로 targeted 재실행하는 방식 권장(전체 재백필 아님) |
| 후속 enrichment | 16건 전부 | `totalHouseholds`/좌표/mgmBldrgstPk 등은 건축물대장/geocoding으로 별도 보강(이번 STEP과 별개 승인) |
| `MASTER_COVERAGE_SYNC_V1` | 전체 | §14 recurrence 방지용 주기적 재동기화 체계(설계 필요, 이번 STEP 범위 밖) |

## 17. QA

- identity proof: 16건 전부 aptSeq(강한 identity) + dong+jibun 이중
  검증, 전체 거래 이력 내 흔들림 0건.
- duplicate check: `ApartmentMaster` 전체(3,402행) + legacy `Apartment`
  전체(54행) 대상 전수 스캔 — 진짜 중복 0건(보해이브빌은 검증 후
  별개 건물로 확정).
- all 16 classified: YES(전부 A, 미분류 0건).
- `npx tsc --noEmit`: 신규 오류 0(기존 20건만 유지 — 최초 1건은 타입
  narrowing 이슈로 이번 STEP 코드에서 발견/직접 수정함).
- `npx eslint`(신규 스크립트 2개): clean.
- `npm run build`: PASS.
- script determinism: `audit-recent-master-missing-16.ts` →
  `classify-recent-master-missing-16.ts` 2-step 파이프라인을 연속 2회
  실행해 완전히 동일한 summary(READY=16/REVIEW=0/DO_NOT_CREATE=0,
  HIGH=11/MEDIUM=5)를 확인.

## 18. Known Limitations

- household/좌표 등 secondary metadata는 이번 STEP에서 확보하지
  못했다(§16 후속 enrichment 대상) — Master row 생성 자체는 이 필드들
  없이도 schema상 가능하지만(§11), 상세페이지에는 "정보 없음"으로 표시될
  것이다.
- K-APT는 이번 STEP에서도 여전히 접근 불가 상태(재시도하지 않음, §10).
- §14에서 확인한 recurrence risk는 이번 16건 해결로 없어지지 않는다 —
  별도 STEP 필요.
- "보해이브빌" 동명이인 사례(§7)처럼, 향후 새 후보에서도 같은 브랜드명
  재사용으로 인한 오탐 가능성이 있다 — dong+jibun 이중검증을 항상 함께
  써야 한다(이번 STEP 스크립트가 이미 그렇게 구현됨).

## 19. Next Step

1. `MASTER_MISSING_REPAIR_V1`(§16 CREATE_MASTER_ROW 16건 실행 — 승인
   필요, targeted 재실행이라 대량 backfill 아님).
2. `MASTER_COVERAGE_SYNC_V1`(§14 recurrence 방지 — 설계+구현, 승인 필요).
