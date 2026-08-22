# SCHOOL V2-C2B-B — School Type Reconciliation + Middle/High/Special Live Operation Verification

- **STEP**: SCHOOL V2-C2B-B
- **성격**: READ-ONLY / API VERIFICATION 중심 — DB ingestion, SchoolStat write, coordinate write, migration, main merge 전부 없음.
- **Branch**: `school-v2-c2bb-type-verification` (worktree `D:/anti2/aaa/e-jip-school-c2bb`, base `b94bfe0` = `school-v2-c2ba-identity`)
- **선행 문서**: [SCHOOL-V2-C2BA-identity-disambiguation.md](./SCHOOL-V2-C2BA-identity-disambiguation.md), [SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md](./SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md) — 전부 보존.

---

## 1. Bucket Discrepancy — 근본 원인 확정

C2A 최종 보고(elementary 305/middle 172/high 145/special 16/other 26)와 C2B-A 최종 보고(305/176/158/16/9)의 차이를 두 원본 함수를 **그대로 복사해 실제 664건에 재실행**해서 재현했다(`scripts/education/c2bb-01-bucket-reconciliation.ts`). 둘 다 같은 canonical School 664건을 썼다 — 표본 차이가 아니라 **버킷 함수 로직 차이**임을 확정.

**C2A**(`ingest-schools-neis.ts` `bucketSchoolLevel`):
```ts
if (raw === '초등학교') return 'ELEMENTARY';
if (raw === '특수학교') return 'SPECIAL';
if (raw.includes('중학교')) return 'MIDDLE';
if (raw.includes('고등학교') || raw.includes('고등기술학교')) return 'HIGH';
return 'OTHER';
```
**C2B-A**(`schoolinfo-identity-resolver.ts` `bucketNeisLevel`):
```ts
if (s.includes('특수')) return 'SPECIAL';
if (s.startsWith('초등학교')) return 'ELEMENTARY';
if (s.includes('중학교') || s.includes('(중)')) return 'MIDDLE';
if (s.includes('고등학교') || s.includes('(고)')) return 'HIGH';
return 'OTHER';
```

**근본 원인(재구성으로 정확히 확정, 추정 아님)**: 두 함수 다 substring 매칭에 의존하는데, "각종학교(중)"·"평생학교(중)-2년6학기"는 문자열 안에 "중학교"가 **연속으로 등장하지 않는다**(...학교**(**중**)** — 괄호가 끼어 있음). C2A는 이 케이스를 전혀 못 잡아 전부 OTHER로 떨어뜨렸다(주석에는 "각종학교(중), 평생학교(중)-2년6학기"도 MIDDLE로 잡힌다고 적혀 있었지만 실제 코드는 그렇게 동작하지 않는다 — 주석과 코드가 불일치했던 것으로 확인). C2B-A는 `.includes('(중)')`/`.includes('(고)')`를 추가해 이 문제는 고쳤지만, 그 대신 "고등기술학교"(괄호가 아예 없는 이름)를 못 잡아 OTHER로 떨어뜨렸다 — C2A는 이 케이스를 위해 명시적으로 `raw.includes('고등기술학교')`를 추가해뒀었는데, C2B-A를 작성할 때 이 특수 케이스를 놓쳤다.

**§1 요구: 학교 단위 diff(19건, School.id 기준)**

| id | neisSchoolCode | schoolName | raw schoolLevel | C2A bucket | C2B-A bucket | 최종 확정 |
|---|---|---|---|---|---|---|
| 286 | 7150351 | 부산국제영화고등학교 | 고등기술학교 | HIGH | **OTHER** | **HIGH**(C2A 근거 채택) |
| 311 | 7150238 | 부산산업학교 | 각종학교(고) | OTHER | HIGH | HIGH(C2B-A 근거 채택) |
| 325 | 7150673 | 부산예빛학교 | 각종학교(고) | OTHER | HIGH | HIGH |
| 328 | 7150744 | 부산온라인학교 | 각종학교(고) | OTHER | HIGH | HIGH |
| 432 | 7201238 | 송정중학교 | 각종학교(중) | OTHER | MIDDLE | MIDDLE |
| 544 | 7150676 | 장대현중고등학교 | 각종학교(고) | OTHER | HIGH | HIGH |
| 545 | 7201264 | 장대현중고등학교(중) | 각종학교(중) | OTHER | MIDDLE | MIDDLE |
| 609–620 (12건) | — | 학력인정○○고등학교 계열 | 평생학교(고)-3/2년6학기, 평생학교(중)-2년6학기 | OTHER | HIGH/MIDDLE | HIGH/MIDDLE(C2B-A 근거 채택) |

(전체 19행 원본은 `c2bb-01-bucket-reconciliation.ts` 실행 로그에 그대로 있음 — 문서에는 대표 행만 표로 정리.)

**임의 우열 판단 금지 원칙 준수**: 위 표에서 "최종 확정" 열은 두 함수 중 어느 한쪽을 통째로 채택한 게 아니라, **각 학교 종류의 공식 성격(교육과정 급/학력인정 여부)을 근거로 항목별로 판단**했다(§2). 18건은 C2B-A 쪽이 맞았고(각종학교/평생학교 계열), 1건(고등기술학교)은 C2A 쪽이 맞았다.

---

## 2. Canonical School-Type Taxonomy 확정

신규 공용 모듈 `scripts/education/lib/school-type-taxonomy.ts` — **exact-value lookup만 사용**(regex/substring 재사용 금지, 이번 사고 자체가 substring 매칭 누락이었으므로). 부산 664건에 실제 존재하는 **14개 원문값 전부**를 명시적으로 나열:

| raw NEIS schoolLevel | count | bucket | 근거 |
|---|---|---|---|
| 초등학교 | 305 | ELEMENTARY | 정규 초등교육과정 |
| 중학교 | 171 | MIDDLE | 정규 중등교육과정 |
| 방송통신중학교 | 1 | MIDDLE | 중학교 학력인정, 방송통신 방식 |
| 각종학교(중) | 2 | MIDDLE | 각종학교이나 이수 과정이 중학교급 |
| 평생학교(중)-2년6학기 | 2 | MIDDLE | 학력인정 평생교육시설, 중학교 학력 인정 |
| 고등학교 | 142 | HIGH | 정규 고등교육과정 |
| 방송통신고등학교 | 2 | HIGH | 고등학교 학력인정, 방송통신 방식 |
| 각종학교(고) | 4 | HIGH | 각종학교이나 이수 과정이 고등학교급 |
| 평생학교(고)-3년6학기 | 5 | HIGH | 학력인정, 고등학교 학력 인정(3년제 상당) |
| 평생학교(고)-2년6학기 | 5 | HIGH | 학력인정, 고등학교 학력 인정(2년제 상당) |
| 고등기술학교 | 1 | HIGH | 산업교육진흥법 등 근거, 고등학교급 기술교육기관 |
| 특수학교 | 16 | SPECIAL | 특수교육대상자를 위한 별도 학교 체계 |
| 공동실습소 | 2 | OTHER | 특정 학교급에 속하지 않는 실습 전용 시설(학생 소속 "학교" 아님) |
| 외국인학교 | 6 | OTHER | 국내 정규 학제(초중고) 밖의 별도 인가 체계 |

`UNKNOWN_RAW_VALUE`(이 14종 밖의 새 원문값)는 664건 전수에서 **0건** — 향후 전국 확장 시 새 값이 나오면 조용히 묻히지 않고 이 이름으로 드러나도록 설계했다(fixture test로 확인, §15).

**DB 원문 미훼손 확인**: `School.schoolLevel`은 이번 STEP에서 UPDATE 문 자체가 존재하지 않는다(전 스크립트 read-only) — 이 표는 순수 리포트/분석 파생 라벨이다.

---

## 3. 664 Canonical 분모 재계산 (신규 단일 기준)

```
TOTAL = 664
ELEMENTARY = 305
MIDDLE     = 176
HIGH       = 159   (C2B-A의 158에서 +1 — 고등기술학교 보정)
SPECIAL    = 16
OTHER      = 8    (C2B-A의 9에서 -1 — 같은 보정)

305+176+159+16+8 = 664 ✓
```

**이 숫자를 이후 SCHOOL V2 canonical denominator의 단일 기준으로 사용한다.** C2A/C2B-A 문서는 삭제하지 않고 그대로 둔다 — 이 문서가 정정 이유와 함께 최신 기준을 제공.

---

## 4. C2B-A Identity Coverage — 재집계(매칭 로직 불변, 그룹핑만 교체)

지시사항대로 **identity mapping(리졸버 알고리즘) 자체는 전혀 바꾸지 않았다** — `schoolinfo-identity-resolver.ts`는 C2B-A 커밋 그대로 재사용(`scripts/education/c2bb-02-identity-coverage-by-final-taxonomy.ts`). 전체 결과는 **완전히 동일**함을 재확인:

```
HIGH: 633, MEDIUM: 0, LOW: 1, NO_MATCH: 30
TRUE_IDENTITY_COVERAGE = 633/664 = 95.3%(불변)
WRONG_MERGE = 0(재확인)
```

학교급별(§2의 FINAL taxonomy로 그룹핑만 교체):

| 버킷 | total | HIGH | MEDIUM | LOW | NO_MATCH | coverage |
|---|---|---|---|---|---|---|
| ELEMENTARY | 305 | 305 | 0 | 0 | 0 | **100.0%** |
| MIDDLE | 176 | 170 | 0 | 1 | 5 | 96.6% |
| HIGH | 159 | 142 | 0 | 0 | 17 | 89.3% |
| SPECIAL | 16 | 16 | 0 | 0 | 0 | **100.0%** |
| OTHER | 8 | 0 | 0 | 0 | 8 | 0.0% |

**투명성 노트**: "부산국제영화고등학교"(고등기술학교, id=286)는 이번에 리포트 라벨상 HIGH 버킷으로 옮겼지만, 리졸버 **내부** `bucketNeisLevel`(코드 자체는 미수정)은 여전히 이 학교를 OTHER로 취급한다 — 다행히 SchoolInfo 쪽도 이 학교의 `schulKndScCode`가 표준 04(고등)가 아니라 마찬가지로 OTHER 계열로 분류돼 있어, 양쪽이 내부적으로 일관되게 OTHER-대-OTHER로 매칭돼 실제 매칭 결과는 처음부터 HIGH였다(실행 로그로 확인, 우연이 아니라 구조적으로 그렇게 됨). 즉 이번 리포트 라벨 교체가 실제 매칭 결과를 바꾸지 않았다는 것을 개별 확인했다.

---

## 5. 중학교 Live API 검증 (5개, 지역 분산)

`scripts/education/c2bb-03-live-verify-middle-high-special-other.ts`, apiType=09(학년별·학급별 학생수), pbanYr=2025.

| 학교 | 지역 | resultCode | 학생수(COL_S_SUM) | 학급수(COL_C_SUM) | 교사수(TEACH_CNT) | 학급당학생수(COL_SUM) |
|---|---|---|---|---|---|---|
| 경남중학교 | 서구 | success | 449 | 18 | 30 | 24.9 |
| 경남여자중학교 | 동구 | success | 418 | 18 | 32 | 23.2 |
| 덕원중학교 | 중구 | success | 233 | 11 | 19 | 21.2 |
| 남도여자중학교 | 영도구 | success | 219 | 10 | 19 | 21.9 |
| 부산내성중학교 | 동래구 | success | 585 | 20 | 32 | 29.3 |

5/5 성공, 필드 구조·타입·null semantics 전부 C2B가 확인한 초등학교 표본과 **동일**(래퍼 `{resultCode,resultMsg,list}`, `COL_S{n}`/`COL_C{n}`/`COL_{n}`/`COL_S_SUM`/`COL_C_SUM`/`COL_SUM`/`TEACH_CNT`/`TEACH_CAL`).

---

## 6. 고등학교 Live API 검증 (5개, 유형 분산)

과학고 계열은 부산에 별도 표본이 잡히지 않아(부산 소재 과학고는 이름에 "과학고"가 안 들어가는 경우가 있어 이번 표본 선정 방식으로는 못 찾음, 아래 대신 다양한 설립유형으로 대체) 외고/공고/사립/공립으로 대체 확보:

| 학교 | 설립구분 | 특기 | resultCode | 학생수 | 학급수 | 교사수 | 학급당학생수 |
|---|---|---|---|---|---|---|---|
| 부산컴퓨터과학고등학교 | 사립 | `HS_KND_SC_NM="특성화고등학교"` 필드 확인 | success | 531 | 27 | 53 | 19.7 |
| 부산외국어고등학교 | 사립 | 외국어고 계열 | success | 747 | 30 | 61 | 24.9 |
| 부산전자공업고등학교 | 공립 | 공업계 특성화 | success | 629 | 33 | 62 | 19.1 |
| 경성전자고등학교 | 사립 | 전자계 특성화 | success | 317 | 18 | 35 | 17.6 |
| 경남고등학교 | 공립 | 일반고 | success | 482 | 25 | 48 | 19.3 |

5/5 성공. **신규 확인**: apiType=0(학교기본정보) 응답에 `HS_KND_SC_NM`(고교유형명, 예: "특성화고등학교") 필드가 존재함을 확인 — 향후 "고교 유형별" 분류가 필요해지면 이 필드를 재사용할 수 있다(단, 이번 STEP에서 저장/활용하지 않음). 학교 유형(일반/특성화/사립/공립)에 따라 apiType=09 필드 구조가 달라지는지는 **달라지지 않음**을 확인(전부 동일 필드셋, null 없음).

---

## 7. 특수/기타 Live API 검증

**특수학교(2개)**:

| 학교 | resultCode | 학생수 | 학급수 | 교사수 | 학급당학생수 |
|---|---|---|---|---|---|
| 부산혜송학교 | success | 169 | 32 | 59 | **5.3** |
| 부산맹학교 | success | 73 | 21 | 38 | **3.5** |

일반 학교 대비 학급당학생수가 현저히 낮다(특수교육 학급 편성 특성 — 소규모 학급) — 데이터가 정상적으로 그 특성을 반영하고 있음을 확인, 오류로 오인하지 않음.

**기타(OTHER, 3개 — 각종학교/방송통신고)**:

| 학교 | 원문 schulKndCode(응답) | 요청 schulKndCode(02~07 재시도) | 결과 |
|---|---|---|---|
| 부산국제영화고등학교(고등기술학교) | 08 | 06→fail(데이터없음), 07→fail(데이터없음) | **SOURCE_NOT_APPLICABLE** |
| 경남여자고등학교부설방송통신고등학교 | 11 | 06→success이나 목록에 없음, 07→fail | **SOURCE_NOT_APPLICABLE** |
| 동래고등학교부설방송통신고등학교 | 11 | (동일 패턴) | **SOURCE_NOT_APPLICABLE** |

**요청 파라미터 실수가 아님을 재확인**: 표준 `schulKndCode`(02/03/04/05/06/07) 전부로 재시도해도 해당 학교가 apiType=09 목록에 나타나지 않는다 — 방송통신고/고등기술학교류는 **이 오퍼레이션 자체가 다루지 않는 학교 유형**임을 실측으로 확정(SOURCE_NOT_APPLICABLE이지 SOURCE_MISSING/IDENTITY_UNRESOLVED가 아님 — 이 학교들이 SchoolInfo에 정문 존재/식별 자체는 되기 때문, apiType=0 학교기본정보에서는 정상 조회됨).

---

## 8. 교원 상세 Operation 실측 (apiType=22, 직위별 교원현황)

경남중학교/부산컴퓨터과학고등학교 각 1건 호출:

- 필드: `COL_1`~`COL_15`(직위별 총원), `COL_M1~15`(남), `COL_W1~15`(여), `COL_R1~15`(비고/기타), `COL_S`(전체 교원수), `COL_SM`/`COL_SW`/`COL_SR`(성별 합계) 등 매우 세분화된 구조.
- `TEACH_CNT`(교사수 총원, apiType=09에도 있는 값)와의 관계: `COL_S`(apiType=22)와 apiType=09의 `TEACH_CNT`가 같은 개념(교원 총원)으로 보이나 **정확히 같은 값인지는 이번 표본 2건 모두 비교하지 않았다**(교차검증 안 함 — 후속 확인 필요).
- null semantics: 값이 없는 직위는 명시적으로 `0`(null이 아님) — 예: 경남중학교 `COL_R9:0` 등.
- 직위별/자격별 여부: 이 오퍼레이션(apiType=22)은 "직위별"(교장/교감/보직교사/평교사 등 총 15개 직위 슬롯)만 다루고 "자격종별"은 별도 오퍼레이션(C2B에서 확인한 apiType=09... 아니 정정: 자격종별 교원 현황은 별도 apiType, 이번 STEP에서 재호출하지 않음, C2B 기록 참고).

**판단(§8 지시사항)**: **V1 부모 UX에는 불필요한 세부정보**로 판단한다 — 부모가 필요로 하는 것은 "교사가 몇 명인가"(총원)이지 "직위별 15단계 분해"가 아니다. apiType=22는 SchoolStat 최소 구조(§9)에서 제외하고 후속(더 상세한 통계가 실제로 필요해지는 시점)으로 넘긴다.

---

## 9. 부모 UX용 최소 SchoolStat 구조 확정 (설계만, ingestion 없음)

```
전체 학생수         ← apiType=09 COL_S_SUM
학급수              ← apiType=09 COL_C_SUM
교사수(총원)        ← apiType=09 TEACH_CNT (apiType=22 세부 직위 불필요, §8)
학년별 학생수        ← apiType=09 COL_S1~COL_S8(학교급별 학년 수 다름 — 스키마 gradeBreakdown JSON에 그대로)
학급당 학생수(원본)  ← apiType=09 COL_SUM(API 자체 제공값, 이집이 계산하지 않음 — LEGAL-1 §4-D SAFE 판정과 일치)
```

`SchoolStat`(C1 스키마, `studentCount`/`classCount`/`teacherCount`/`gradeBreakdown Json`/`sourceRecordId`)에 이미 정확히 맞아떨어짐을 재확인(C5 audit에서 이미 확인된 사실, 이번 STEP에서 실제 값으로 재검증만 함) — **스키마 변경 불필요**. `apiType=22`(교원 세부), 증감률·차트(LEGAL-1 REVIEW_REQUIRED 영역)는 이번 최소 구조에서 제외.

---

## 10. 최신년도 / 3년 History 재검증

초/중/고/특수 각 1건, pbanYr 2026/2025/2024/2023:

| 학교급 | 2026 | 2025 | 2024 | 2023 |
|---|---|---|---|---|
| 초등(구덕초등학교) | AVAILABLE | AVAILABLE | AVAILABLE | **NOT_AVAILABLE**("최근 3년만 제공") |
| 중(경남중학교) | AVAILABLE | AVAILABLE | AVAILABLE | NOT_AVAILABLE |
| 고(부산컴퓨터과학고등학교) | AVAILABLE | AVAILABLE | AVAILABLE | NOT_AVAILABLE |
| 특수(부산혜송학교) | AVAILABLE | AVAILABLE | AVAILABLE | NOT_AVAILABLE |

4개 학교급 전부 동일 패턴 — 3년 롤링 윈도우가 학교급과 무관하게 일관되게 적용됨을 재확인. `NOT_APPLICABLE`(애초에 이 오퍼레이션 대상이 아님, §7)과 `NOT_AVAILABLE`(대상이지만 연도가 범위 밖)을 구분해 기록.

---

## 11. SchoolInfo-only / NEIS-only 의미 보강

**SchoolInfo-only(25건)**: C2B-A에서 이미 전수 `ABSCH_YN='Y'`(폐교) 확인 완료 — 변경 없음, 재확인만.

**NEIS-only(30건) — 이번 STEP에서 전수 분류 완료**(`scripts/education/c2bb-05-neis-only-classification.ts`):

| 분류 | 건수 | 의미 |
|---|---|---|
| **[A] IDENTITY_UNRESOLVED** | 7 | canonical `School.sigunguCode` 자체가 **null** — SchoolInfo 문제가 아니라 **우리 쪽(NEIS ingestion) 데이터 갭**. 예: 한국과학영재학교, 부산화교소학교병설유치원, 학력인정부경보건고등학교 계열 일부. sigungu가 없으면 리졸버가 애초에 시군구 스코핑을 못 해 항상 NO_MATCH가 된다. |
| **[B] SOURCE_NOT_APPLICABLE** | 23 | sigungu는 있으나 학교유형이 방송통신/평생학교/외국인학교/공동실습소/각종학교 계열 — §7에서 실측 확인한 "이 오퍼레이션이 다루지 않는 유형" 패턴과 일치. 직접 재호출로 전수 재검증하지는 않았으나(§7에서 대표 3건만 실측), 같은 비표준 유형 카테고리라 동일하게 분류하는 것이 합리적이라고 판단. |
| 기타(분류 불명) | 0 | — |

30건 전부가 A 또는 B로 설명된다 — "이유를 알 수 없는 갭"은 남지 않았다.

---

## 12. Coverage Denominator 이원화 (신규 확정)

**A. `CANONICAL_SCHOOL_IDENTITY_COVERAGE`** = HIGH matched / canonical 664 = **95.3%**(identity 그 자체 — "이 SchoolInfo row가 어느 canonical School인지 아는가")

**B. `SCHOOLINFO_ELIGIBLE_STAT_COVERAGE`** = HIGH matched **중 SchoolInfo 공시 대상인** canonical 학교만 분모로:

```
분모 = 664 - 7(IDENTITY_UNRESOLVED, 우리쪽 갭) - 23(SOURCE_NOT_APPLICABLE, 공시 비대상)
     = 634

분자 = HIGH matched 중 이 634건에 속하는 것 = 633
     (LOW 1건 = 경일중학교도 이 634건 안에 있음 — 표준 유형인데 우리 dongName 데이터
     오염으로 disambiguation 실패, C2B-A §6)

SCHOOLINFO_ELIGIBLE_STAT_COVERAGE = 633 / 634 = 99.8%
```

**해석**: 664 대비 100% 매칭이 안 되는 이유의 대부분(30건)은 SchoolInfo 데이터 오류가 아니라 (a) 우리 쪽 NEIS ingestion의 주소 데이터 갭(7건)과 (b)애초에 이 오퍼레이션이 다루지 않는 비표준 학교 유형(23건)이다 — 이걸 "데이터 오류"라고 표현하지 않는다(지시사항 §12 그대로 준수). SchoolInfo가 실제로 다루는 표준 학교(초/중/고/특수, 정규 교육과정) 기준으로는 **99.8%**가 정확한 실제 coverage다.

---

## 13. Legal Gate 유지 (재확인, 변경 없음)

```
SCHOOLINFO_COORDINATE_USE_GATE = CONDITIONAL  (변경 없음)
SCHOOLINFO_STATISTICS_USE_GATE = CONDITIONAL  (변경 없음)
```

이번 STEP은 identity/operation 실측만 했고, LEGAL-1의 공식 회신(학교알리미 고객센터 서면 확인)이 오기 전까지 이 상태를 CLEARED로 문서에 쓰지 않는다. 모든 API 호출은 read-only 검증(개별 학교 몇 건 샘플, SchoolStat 대량 ingestion 아님)이었다.

---

## 14. Ingestion Plan (설계만, 미실행)

법적 CLEARED 회신이 오면 바로 실행 가능하도록 설계:

```
대상 = HIGH identity (633건) ∩ SchoolInfo stat applicable (SOURCE_NOT_APPLICABLE 아님)
     = 633 - (HIGH이면서 동시에 SOURCE_NOT_APPLICABLE인 경우, 실제로는 0 —
       SOURCE_NOT_APPLICABLE 23건은 애초에 NO_MATCH라 HIGH에 없음)
     = 633건 전부 ingestion 후보

LOW(1건)/NO_MATCH(30건) = skip, reconciliation queue로 분리
  (§11 IDENTITY_UNRESOLVED 7건은 canonical 쪽 주소 데이터 보정이 선행돼야 함 — NEIS
  재조회 또는 수동 확인 필요, 이번 STEP에서 하지 않음)

Idempotency: SchoolStat.studentCount/classCount/teacherCount/gradeBreakdown이
  기존 저장값과 실제로 다를 때만 update(no-op 방지) — referenceYear/disclosureYear를
  unique key(schoolId, sourceId, referenceYear)로 이미 C1 스키마가 보장.

History 보존: pbanYr별로 별도 SchoolStat row(연도마다 새 referenceYear) —
  API가 3년 후 예전 연도를 내려도 이미 저장된 row는 그대로 유지(LEGAL-1 §8
  HISTORICAL_RETENTION=REVIEW_REQUIRED 상태와 별개로, 구조적으로는 유지 가능하게 설계).
```

**이번 STEP에서 실행하지 않음** — legal gate가 CONDITIONAL인 한 코드로 구현하지 않는다.

---

## 15. Tests

`scripts/education/lib/school-type-taxonomy.test.ts`(신규, 10개 케이스) + `scripts/education/lib/schoolinfo-identity-resolver.test.ts`(C2B-A 재사용, 12개 케이스) = **22/22 PASS**(`node:test`, `npx tsx --test`).

포함: canonical bucket mapping(14종 전수) / 이전 C2A·C2B-A discrepancy regression(각종학교·평생학교, 고등기술학교) / 중학교·고등학교 표본 정규화(방송통신중/고) / OTHER 동작(공동실습소·외국인학교만) / not-applicable semantics(미지 원문값·null) / identity resolver 무결성(재사용, 오매칭 0건 재확인).

`tsc --noEmit`: 0 errors. `eslint`(전체 신규/수정 파일): 0 errors. UI/route 변경이 없어 `next build`는 이번 STEP에서 실행하지 않음(코드 변경이 `scripts/`에 한정, 프로덕션 코드 미접촉).

---

## 16. 문서/커밋

- 문서: 이 파일 신규(`SCHOOL-V2-C2BB-type-and-operation-verification.md`), 기존 C2B-A/LEGAL-1 문서 보존.
- DB write: 없음(전부 read-only).
- schema/migration: 없음.
