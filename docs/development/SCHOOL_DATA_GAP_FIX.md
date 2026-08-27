# SCHOOL DATA GAP FIX — orphan School 정리 + 자동 QA

## 1. Goal

`SCHOOL_DATA_BACKFILL_V1` 완료 시점에 남아 있던 두 가지 미해결 이슈(구/군 코드
없는 orphan School 7건, NO_SOURCE 31건)를 안전하게 정리하고, 향후 학교 데이터
회귀를 상시 자동 검사할 수 있는 reusable QA 스크립트를 만든다. 이 STEP을 마지막
으로 학교 데이터 작업을 닫고 STATISTICS V2로 넘어간다.

## 2. Baseline

- branch: main, 시작 시점 HEAD = origin/main = `874d666`(SCHOOL DATA BACKFILL V1).
- Busan School 664, SchoolStat 630, student/teacher/class coverage 94.9%,
  official coordinate coverage 95.3%, wrong-school 0, invalid stat 0, REVIEW 0,
  NO_SOURCE 31, Release Gate READY, DB schema change NONE — 사용자가 제시한
  수치와 재확인 결과 100% 일치.
- pre-existing dirty worktree(package.json, package-lock.json,
  ApartmentAutocomplete.tsx.bak, my_prod.html, prisma/schema_old.prisma, tmp/)
  이번 STEP 동안 미접촉 확인.

## 3. Orphan 7 — 정확한 목록

| id | neisSchoolCode | schoolName | schoolLevel | establishmentType |
|---|---|---|---|---|
| 280 | 7150434 | 부산공업고등학교부설기계계열공동실습소 | 공동실습소 | 공립 |
| 366 | 7150447 | 부산화교소학교병설유치원 | 외국인학교 | 사립 |
| 610 | 7150439 | 학력인정국제금융고등학교(2년제) | 평생학교(고)-2년6학기 | 사립 |
| 611 | 7150408 | 학력인정부경보건고등학교 | 평생학교(고)-3년6학기 | 사립 |
| 612 | 7150443 | 학력인정부경보건고등학교(2년제) | 평생학교(고)-2년6학기 | 사립 |
| 613 | 7150436 | 학력인정부경보건고등학교병설부경중학교(2년제) | 평생학교(중)-2년6학기 | 사립 |
| 627 | 7150400 | 한국과학영재학교 | 고등학교 | 국립 |

7건 전부 `neisSchoolCode`(canonical identity)는 이미 확보돼 있었고, `address`,
`roadAddress`, `sidoCode`, `sigunguCode`, `latitude`, `longitude` 전부 null,
SchoolStat 0건이었다.

## 4. Official Source Resolution

각 `neisSchoolCode`로 NEIS `schoolInfo` API를 canonical code 직접 조회
(이름 검색이 아닌 `SD_SCHUL_CODE` 파라미터 exact lookup — identity 자체가
이미 확정돼 있으므로 name-only 매칭 위험이 구조적으로 없음)로 재확인했다.

결과(7건 전수, raw 응답 원문 확인):

- `ATPT_OFCDC_SC_CODE` = `C10`(부산광역시교육청) — 7건 전부.
- `LCTN_SC_NM` = `부산광역시` — 7건 전부.
- `ORG_RDNMA`(도로명주소) = `null` — 7건 전부. NEIS 원본 자체가 이 7개 학교의
  도로명주소를 갖고 있지 않다(공동실습소/외국인학교/평생학교/국립 영재학교 등
  비표준 학교 유형이라 일반 학교 주소 등록 체계에서 빠져 있는 것으로 추정되나,
  원인을 추정으로 문서화하지 않고 "값이 없다"는 사실만 확인).
- 학교알리미(SchoolInfo) 쪽도 재확인: `SCHOOL_DATA_BACKFILL_V1` 전체 664개교
  실행 시 이 7건 전부 이미 전체 16개 구/군을 순회 검색했음(orphan은
  `sigunguCode`가 없어 자동으로 전체 구/군 검색 대상이 됨) — 6건은 schoolinfo가
  아예 다루지 않는 학교급(공동실습소/외국인학교/평생학교)이라 애초에 검색
  대상에서 제외됐고, 한국과학영재학교(고등학교로 분류돼 검색은 시도됨)는
  "학교알리미에서 동일 이름 학교를 찾지 못함"으로 확인됨(§7 참고).

## 5. Classification

| 학교 | sidoCode | sigunguCode | 분류 |
|---|---|---|---|
| 7건 전체 | READY(=26) | UNRESOLVED | 부분 READY — sidoCode만 안전하게 확정, sigunguCode는 공식 소스 자체가 없어 UNRESOLVED |

**READY 판단 근거**: `sidoCode='26'`은 새로운 추정이 아니다. 이 7개 School row가
애초에 "부산 664개 School" 테이블에 존재하는 이유 자체가 NEIS
`ATPT_OFCDC_SC_CODE=C10` 필터(`scripts/education/ingest-schools-neis.ts`가
사용한 것과 동일 필터)였다 — 즉 이미 확보돼 있던 official 근거를 미완성이던
컬럼에 반영하는 것뿐이며, 기존 657개 School row와 동일한 값·동일한 출처다.
이름을 보고 구/군을 추정한 것이 아니라 canonical `neisSchoolCode`로 NEIS를
직접 재조회해 얻은 관할청 필드를 그대로 옮긴 것이다.

**sigunguCode를 UNRESOLVED로 남긴 이유**: NEIS 원본에 도로명주소가 없고,
학교알리미에도 6건은 아예 없고 1건은 이름조차 찾지 못했다 — 구/군을 확정할
공식 소스가 존재하지 않는다. Kakao 등 외부 소스로 주소를 역추정하는 것은
"추정 주소 생성" 및 "name-only 매칭" 금지 원칙에 저촉될 위험이 있어 시도하지
않았다.

IDENTITY_CONFLICT: 0건(관할청이 부산이 아닌 경우는 없었음).

## 6. Updates (적용된 변경)

`scripts/education/fix-orphan-school-sido-v1.ts`(신규, `--apply` 플래그) 실행:

- `School.sidoCode`: 7건 전부 `null` → `'26'`.
- `School.sigunguCode`, `address`, `roadAddress`, `latitude`, `longitude`:
  변경 없음(공식 소스 부재로 UNRESOLVED 유지).
- School 삭제/병합/neisSchoolCode 변경: 없음.

적용 결과: `updated=7, skipped=0`. 재실행(idempotency 확인, §13) 시
`updated=0, skipped=0`(이미 채워진 행은 건드리지 않음).

## 7. NO_SOURCE 31 재분류

기존 STEP(BACKFILL V1)의 "NO_SOURCE=31"은 backfill 스크립트의 identity-매칭
단계에서 "학교알리미 후보 자체를 찾지 못함" 상태만 집계한 수치였다. 이번
`scripts/run-school-data-qa.ts`로 SchoolStat 부재 전체(664-630=34건)를 다시
전수 분류한 결과, 실제로는 두 가지 서로 다른 원인이 섞여 있었음을 확인했다
(억지로 합치지 않고 원인별로 분리):

| 분류 | 건수 | 설명 |
|---|---|---|
| 학교알리미 미지원 학교급(구조적) | 30 | 외국인학교(6), 평생학교 고/중 각종(17), 각종학교(6), 방송통신고/중(3), 공동실습소(2), 고등기술학교(1) — schoolinfo가 애초에 다루지 않는 학교급 |
| 개별 학교 2026 공시 자체 없음 | 4 | 괘법초등학교(7201046), 봉삼초등학교(7171060), 신선초등학교(7171071), 한국과학영재학교(7150400) — identity/학교급은 정상 지원 대상이지만 해당 학교의 통계가 2026년 공시에 없음(원본 자체의 한계, SCHOOL DATA BACKFILL V1 전체 664개교 실행에서 이미 확인됨) |
| **합계** | **34** | (664 − 630 = 34, 기존 "31"은 이 중 identity-매칭 단계 실패분만 집계한 부분집합이었음 — 이번 STEP에서 SchoolStat 부재 전체 기준으로 정정) |

31 → 34로 늘어난 것은 새로운 문제가 발견된 것이 아니라 **집계 기준을 "identity
매칭 실패"에서 "SchoolStat 존재 여부"로 정정**한 것이다. 억지로 채우지 않았고,
어느 쪽도 이번 STEP에서 backfill을 시도하지 않았다(사용자 지시 §6 준수).

## 8. Source Limitations

- 30건(학교급 구조적 미지원): 후속 STEP에서도 schoolinfo 소스만으로는 해결
  불가 — 다른 공식 통계원(예: 교육부 평생교육 통계, 특수학교 전용 공시)이
  확인되기 전까지는 구조적 SOURCE_LIMITATION으로 유지.
- 4건(개별 공시 없음): 다음 공시연도(2027년 등)에 재시도하면 채워질 가능성이
  있다 — `backfill-school-data-v1.ts --pban-yr=2027`을 그때 재실행하면 됨(코드
  변경 불필요).
- orphan 7건의 sigunguCode: 동일하게 다음 NEIS/학교알리미 갱신 시 주소가
  채워지면 재조회로 해결 가능 — 현재는 SOURCE_LIMITATION.

## 9. Automated QA — `scripts/run-school-data-qa.ts`

신규 read-only 스크립트. 플래그: `--school-code`, `--district`, `--quick`(라이브
product-contract 확인 생략), `--json`. 기본 동작은 전체 664개 School 대상.

검사 항목(§8 지시 그대로 구현):

- **Identity**: `neisSchoolCode` 중복/누락, 이름+구/군+동 완전 동일한 School row
  중복(잠재적 identity 충돌).
- **Region**: `sidoCode`/`sigunguCode` 누락, 부산 16개 구/군 목록 밖의 코드.
- **Stats**: 음수/불가능 값(학생>0인데 학급·교원=0), `referenceYear` 누락,
  `(schoolId, sourceId, referenceYear)` 중복(raw SQL로 DB unique 제약 우회
  여부까지 재확인).
- **Coordinates**: 누락, NaN/Infinity, 부산 bounding box 밖, `coordinateType`이
  `UNKNOWN`인데 좌표는 존재하는 provenance 불일치.
- **Source**: SchoolStat이 참조하는 `EducationSource`가 `schoolinfo_openapi`가
  아니거나 `legalReviewStatus`가 `CLEARED`가 아닌 경우.
- **Product contract**: `--quick` 미지정 시 로컬 dev 서버(`localhost:3000`)로
  지정 7개 fixture의 `/api/school/[id]`를 실제 호출해 `status:OK`,
  `identity.type:CANONICAL`, `relatedApartments` 배열 존재를 확인. 서버가 없으면
  `SKIPPED_NO_SERVER`로 표시하고 실패로 집계하지 않는다(read-only 원칙 유지,
  QA 자체가 서버 기동을 강제하지 않음).

## 10. Severity 결과(이번 실행)

```
BUSAN SCHOOLS: 664
P0_WRONG_SCHOOL: 0
P0_IDENTITY: 0
P0_INVALID_STAT: 0
P1_REGION_GAP: 7           (orphan sigunguCode UNRESOLVED)
P1_STAT_COVERAGE: 4         (개별 2026 공시 없음, §7 4건)
P1_COORDINATE_GAP: 31       (통계 없는 학교와 대부분 겹침 — 664-633)
SOURCE_LIMITATION: 30       (schoolinfo 구조적 미지원 학교급)
stat coverage: 94.9%
```

## 11. Release Gate

P0 계열(P0_WRONG_SCHOOL, P0_IDENTITY, P0_INVALID_STAT) 전부 0 → BLOCK 조건
없음. stat coverage 94.9%(≥85% 기준) → **READY**.

## 12. Idempotency

- `fix-orphan-school-sido-v1.ts --apply` 1차: `updated=7, skipped=0`.
- 2차 재실행: `updated=0, skipped=0`(이미 채워진 sidoCode는 재조회했지만
  건드리지 않음) — PASS.
- `run-school-data-qa.ts`를 orphan 수정 전/후 비교 없이 수정 후 상태로 2회
  연속 실행 → 완전히 동일한 카운트 반복 확인(P1_REGION_GAP=7,
  P1_STAT_COVERAGE=4 등 변동 없음) — PASS.

## 13. Remaining School Data Gaps

- orphan 7건의 sigunguCode/address/좌표: 여전히 SOURCE_LIMITATION(§8).
- 개별 2026 미공시 4건: 다음 공시연도 재시도 필요(§8).
- schoolinfo 구조적 미지원 30건: 다른 공식 소스 확인 전까지 구조적 한계.
- 학생 성별/재학생 구성/학교 특색: 이번에도 다루지 않음(LATER, 이전 STEP과
  동일한 판단 유지).

## 14. School Closure Decision

P0 이슈 0건, 남은 격차 전부 원인이 명확히 문서화된 SOURCE_LIMITATION/UNRESOLVED
상태이며 재시도 경로(다음 공시연도, 다른 공식 소스 확보 시)도 명시했다.
`scripts/run-school-data-qa.ts`로 향후 회귀를 상시 자동 검사할 수 있는 기반도
마련했다. 이에 따라 이번 STEP을 끝으로 학교 데이터 작업을 닫고
**STATISTICS V2**로 이동한다.
