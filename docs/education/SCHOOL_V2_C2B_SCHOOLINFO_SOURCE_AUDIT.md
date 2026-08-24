# SCHOOL V2-C2B — 학교알리미(SchoolInfo) 공식 통계 소스 감사 + 설계

- 작성일: 2026-08-21
- Worktree: `D:\anti2\aaa\e-jip-school-c2b`
- Branch: `school-v2-c2b` (base: `school-v2-c2a` @ `da17c0a`)
- 목적: **AUDIT + DESIGN 전용.** DB write, 대량 ingestion, UI 구현 없음.
- 최종 결론: **SCHOOLINFO_DATA_INGESTION_READY = NO**

---

## 0. 요약(TL;DR)

| 항목 | 결과 |
|---|---|
| 공식 API 존재 여부 | **YES** — `schoolinfo.go.kr/openApi.do`, REST/JSON, 실제 운영 확인 |
| 필드 스키마 확인 | **YES(문서 기준)** — 공식 35개 카테고리 Excel 명세서 전체 확보·파싱 |
| 라이선스(이용조건) | **부분 확인** — apiType=09(학년별·학급별 학생수) 페이지에서 직접 확인(출처표시, 상업적 이용/변경/2차적저작물 자유). 나머지 apiType은 사이트 공통 "공공데이터 이용정책"에 귀속되는 것으로 추정되나 이번 STEP에서 개별 재확인 안 함 |
| 실제 API 호출(schema 검증) | **NO — BLOCKER: API Key 없음** |
| SchoolInfo↔NEIS identity crosswalk 값 단위 검증 | **NO — BLOCKER: API Key 없음 + 공개 웹 UI가 코드 대신 내부 UUID 사용** |
| 13-다(졸업생의 진로 현황) | **정정: NOT AVAILABLE — 공식 35개 카테고리에 해당 항목 없음** (SCHOOL V2-B의 "AVAILABLE_API" 판단은 WebFetch 기반 오판으로 확인, 본 STEP에서 정정) |
| GRADUATE_OUTCOME_SCHEMA_READY | **NO** |
| 4개 병렬 워크스트림 무결성 | **YES — main/C2A/C3B/score-geocode-recovery 전부 미변경 확인** |

이번 STEP은 실사용 가능한 API 엔드포인트·파라미터·필드 스키마·일부 라이선스 텍스트까지는 실증적으로 확보했지만, **API Key 부재로 실제 응답 값(특히 SCHUL_CODE 실값)을 단 한 번도 확인하지 못했다.** 사용자 지시("추측으로 DB에 적재하지 말 것")에 따라 identity crosswalk는 미확정 상태로 남기고, ingestion은 NO로 정직하게 종료한다.

---

## 1. 병렬 워크스트림 무결성 확인 (작업 시작 시점)

```
main worktree(D:\anti2\aaa\real-estate-app):
  M docs/development/CHANGELOG.md
  M docs/development/SCHOOL-V2-C-education-data-architecture.md
  ?? docs/development/SCHOOL-V2-C3A-childcare-ingestion.md
  ?? scripts/education/
  → SCHOOL V2-C3A 작업 시작 시점과 동일. 이번 STEP에서 건드리지 않음.

school-v2-c2a worktree: clean, HEAD=da17c0a (변경 없음)
school-v2-c3b worktree: clean, HEAD=1a2be74 (변경 없음)
score-geocode-recovery worktree: clean, HEAD=6e06e01 (변경 없음)
score-display-bug-audit worktree: 감사 문서만 존재(uncommitted, 이전 상태 그대로)
school-v2-c2b(현재) worktree: base=da17c0a, School=664 / SchoolStat=0 / EducationSource=4건(기존과 동일)
```

→ **MAIN_C3A_WORKTREE_UNTOUCHED=YES / C2A_BRANCH_BASE_PRESERVED=YES / C3B_BRANCH_UNTOUCHED=YES / SCORE_BRANCH_UNTOUCHED=YES**

---

## 2. 공식 SchoolInfo(학교알리미) 소스 인벤토리

### 2-1. 서비스 개요
- 정식 명칭: 학교알리미(초·중등 교육정보 공시서비스), 운영기관 한국교육학술정보원(KERIS), 주관 교육부
- 공식 사이트: `https://www.schoolinfo.go.kr`
- OpenAPI 엔드포인트: `http://www.schoolinfo.go.kr/openApi.do`
- 실행: 브라우저로 API 상세 페이지(OpenAPI 소식 > API 제공목록) 직접 접속·확인 (WebFetch 아닌 실제 DOM 탐색)

### 2-2. 실제 확인한 오퍼레이션 상세 (apiType=09, 학년별·학급별 학생수)
| 항목 | 값 |
|---|---|
| 엔드포인트 | `http://www.schoolinfo.go.kr/openApi.do` |
| 프로토콜/포맷 | REST / JSON |
| Rate limit | 없음(페이지 명시) |
| 갱신주기 | 연 1회 |
| 필수 파라미터 | `apiKey`(필수), `apiType`(필수, "09"), `pbanYr`(필수, yyyy, **최근 3년만 조회 가능**), `schulKndCode`(필수, 02:초등/03:중등/04:고등/05:특수/06:그외/07:각종) |
| 선택 파라미터 | `sidoCode`, `sggCode` |
| 라이선스(페이지 원문) | "출처표시 : 출처를 표시하면 영리 목적의 이용이나 변경 및 2차적저작물의 작성을 포함한 자유 이용을 할 수 있습니다." |

이 라이선스 문구는 기존 `neis_school_info`, `moe_kindergarten_basicinfo_api` 소스와 **동일한 등급(UNRESTRICTED_ATTRIBUTION)**이다.

### 2-3. 공식 필드 명세서(OpenAPI_Output.xlsx) 확보
- 다운로드: `https://www.schoolinfo.go.kr/download/OpenAPI_Output.xlsx` (사이트 내 "OPEN API > API 제공목록"에서 링크 확인)
- `xlsx` npm 패키지로 파싱(`npm install xlsx --no-save`, package.json/lock 변경 없음 확인 완료)
- **총 35개 시트 = 35개 공시 카테고리(apiType)** 전수 목록 확인:

```
0  학교기본정보(0)                          18 학교발전기금(30)
1  수업일수 및 수업시수 현황(08)              19 환경위생관리 현황(42)
2  자유학기제 운영에 관한 사항(04)            20 시설안전 점검 현황(44)
3  학교 현황(62)                             21 교복 구매 유형 및 단가(73)
4  성별 학생수(63)                           22 교육운영 특색사업 계획(67)
5  학년별·학급별 학생수(09)                  23 장애인 편의시설 현황(21)
6  전·출입 및 학업중단 학생 수(10)            24 급식 실시 현황(34)
7  직위별 교원 현황(22)                      25 급식비 집행 실적(35)
8  자격종별 교원 현황(64)                    26 보건관리 현황(38)
9  표시과목별 교원 현황(24)                  27 안전교육 계획 및 실시현황(43)
10 대상별 학교폭력 예방교육 실적(94)          28 장학금 수혜 현황(55)
11 입학생 현황(51)                          29 동아리 활동 현황(56)
12 학교용지 현황(16)                        30 학교도서관 현황(58)
13 교사(校舍) 현황(17)                       31 방과후학교 운영계획 및 운영·지원현황(59)
14 학생교육활동 지원시설 현황(18)            32 학생·학부모 상담계획 및 실시 현황(61)
15 학교시설 개방에 관한 사항(20)             33 직원 현황(68)
16 학교회계 예·결산서(국공립)(27)            34 학생의 체력 증진에 관한 사항(90)
17 사립학교 교비회계 예·결산서(28)
```

**중요: 이 35개 목록 어디에도 "졸업생의 진로 현황" / "진로·진학" 관련 시트가 없다.** (§10에서 상세 정정)

### 2-4. 이번 STEP에서 필드까지 상세 확인한 카테고리
| apiType | 시트명 | 확인 내용 |
|---|---|---|
| 0 | 학교기본정보 | 38개 필드 전수 확인(주소/좌표/설립정보/SCHUL_CODE 포함) |
| 62 | 학교 현황 | 공통 메타 14필드 확인 |
| 63 | 성별 학생수 | 공통 메타 14필드 확인 |
| 09 | 학년별·학급별 학생수 | 공통 메타 14필드 + TEACH_CNT(교사수) + TEACH_CAL(수업교원 1인당 학생수) 확인 |
| 10 | 전·출입 및 학업중단 학생 수 | 공통 메타 14필드 확인 |
| 22 | 직위별 교원 현황 | 공통 메타 + 교장/교감/수석교사/보직교사/일반교사/특수교사/... 남·여·휴직·계 세부 확인 |
| 64 | 자격종별 교원 현황 | 공통 메타 확인(62개 행) |
| 24 | 표시과목별 교원 현황 | 공통 메타 + 학교급별(교과별/과목별) 세부 구조 확인(78개 행) |

**공통 메타 14필드**(0,62,63,09,10,22,64,24 시트 전부 동일):
```
1  시도교육청           ATPT_OFCDC_ORG_NM
2  시도교육청코드        ATPT_OFCDC_ORG_CODE
3  교육지원청           JU_ORG_NM
4  교육지원청코드        JU_ORG_CODE
5  지역                ADRCD_NM
6  지역코드             ADRCD_CD
7  소재지구분코드        LCTN_SC_CODE
8  정보공시 학교코드     SCHUL_CODE     ← identity crosswalk 핵심 필드(§5)
9  학교명              SCHUL_NM
10 학교급코드          SCHUL_KND_SC_CODE
11 설립구분            FOND_SC_CODE
12 분교여부            BNHH_YN
13 제외여부            PBAN_EXCP_YN
14 제외사유            PBAN_EXCP_RSN
```

### 2-5. 미확인(이번 STEP 범위 밖으로 남긴) 카테고리
입학생 현황(51), 자유학기제(04), 학교시설/회계/급식/체육 등 나머지 22개 시트는 이번 STEP의 목표(A.기본통계 B.공시기준 C.identity D.이용조건)와 직접 관련이 낮아 필드까지는 파싱하지 않음(시트 존재만 확인). 필요 시 후속 STEP에서 확인.

---

## 3. 실제 API 스키마 검증 — BLOCKER

### 3-1. API Key 확인 결과
```
worktree .env / .env.local 스캔 (값 미출력, 존재 여부만 확인):
  NEIS_API_KEY = SET (len=32)   ← C2A에서 사용한 NEIS Open API 키 (별개 시스템)
  SCHOOLINFO_API_KEY            = 없음
  SCHOOL_INFO_API_KEY           = 없음
  SCHOOLALIMI_API_KEY           = 없음
```
학교알리미(schoolinfo.go.kr) API는 NEIS(open.neis.go.kr)와 **완전히 별개의 시스템**이며 별도 발급 키가 필요하다. 현재 이 worktree는 물론 다른 어떤 worktree의 `.env`에도 학교알리미 전용 키가 존재하지 않음을 확인했다(4개 워크스트림 전부 동일 DB를 쓰지만 `.env`는 worktree별 로컬 파일이므로 개별 확인).

→ **`apiKey` 없이는 `openApi.do` 호출이 원천적으로 불가능**(파라미터 필수). 실제 JSON 응답(필드명 실값, SCHUL_CODE 실값, null/공시제외 처리 방식 등)은 **단 한 건도 확인하지 못했다.**

### 3-2. 대체 검증 경로 시도 — 결과
1. **공개 웹 검색(schoolinfo.go.kr 프론트엔드)**: 스크린 파싱 성공(§5-1) — 그러나 학교 상세 페이지 진입 링크가 `javascript:searchSchul('e116b138-dc28-45f2-9c75-cfd77cf1a1a8')` 형태의 **내부 UUID**를 사용, SCHUL_CODE나 NEIS 코드 형식이 전혀 아님. 상세 페이지도 새 창(팝업)으로 열려 이 세션의 tab 추적 범위 밖(정상적인 브라우저 팝업 차단/추적 한계, 사이트 자체는 정상 동작).
2. **네트워크 요청 가로채기**: 클릭 시 XHR이 현재 탭에서 발생하지 않음(신규 window.open 경유로 추정) — 코드 값을 노출하는 요청을 포착하지 못함.
3. 결론: **공개 웹 UI 어디에도 SCHUL_CODE 실값이 노출되지 않는다.** API Key 없이는 확인 불가능한 상태로 확정.

### 3-3. 정직한 결론
> **LIVE_SAMPLE_CALL_SUCCESS = NO (API Key 미보유로 시도 자체 불가)**
> **API_AUTH_STATUS = BLOCKED(키 없음)** — 이전 C3B(유치원)처럼 사용자가 키를 발급·저장하면 즉시 재개 가능한 구조로 스크립트 설계만 해둘 것을 권고(§9).

---

## 4. Identity Crosswalk 감사 (SchoolInfo ↔ NEIS)

### 4-1. 이론적 근거(미검증 가설)
- 두 시스템 모두 필드명이 "학교코드"(SchoolInfo: `SCHUL_CODE`, NEIS: `SD_SCHUL_CODE`)이며, 한국 교육행정 데이터 표준상 각급학교는 "표준학교코드"(행정표준코드관리시스템 관리)를 공유하는 것으로 일반적으로 알려져 있다.
- 그러나 이는 **이번 세션에서 실증적으로 확인한 사실이 아니라 공개된 필드명 패턴에 근거한 추정**이다. 사용자 지시("추측으로 DB에 적재하지 말 것")에 따라 이를 CONFIRMED로 표기하지 않는다.

### 4-2. 실증 시도 — 동명이교(同名異校) 케이스
`school-v2-c2a`가 이미 적재한 부산 School 664건 중 실제 동명이교 사례 확인:

```sql
schoolName: 송정중학교   neisSchoolCode=7201238  sigunguCode=26440(강서구)
schoolName: 송정초등학교  neisSchoolCode=7211058  sigunguCode=26350(해운대구)
schoolName: 송정초등학교  neisSchoolCode=7201235  sigunguCode=26440(강서구)  ← 동명이교
```

schoolinfo.go.kr에서 "송정초등학교" 검색 → 전국 13건(초등학교만) 검색됨, 상위 노출 2건이 정확히 **주소 기준으로 구분**되어 표시됨:
```
1. 서울송정초등학교  주소: 서울특별시 강서구 공항대로3길 18
2. 송정초등학교      주소: 부산광역시 강서구 신호산단4로 10  ← 우리 DB의 neisSchoolCode=7201235와 도로명주소 완전 일치
```
→ **주소 문자열 레벨에서는 일치가 실증적으로 확인됨.** 다만 이는 "이름+주소" 매칭이지 "코드값" 매칭이 아니다. 부산 해운대구 송정초등학교(7211058)가 13건 중 어디에 위치하는지는 검색결과 스크롤을 끝까지 확인하지 않아 이번 STEP에서는 미확인.

### 4-3. Identity 분류 (사용자 지정 A-E 스케일)

| 등급 | 정의 | 해당 여부 |
|---|---|---|
| A. DIRECT_NEIS_CODE_MATCH | SCHUL_CODE 실값이 SD_SCHUL_CODE와 동일함을 실증 확인 | ❌ NO(값 미확인) |
| B. OFFICIAL_CROSSWALK_AVAILABLE | 정부 제공 공식 매핑 테이블 존재 확인 | ❌ NO(발견 못함, 미탐색 영역일 수 있음) |
| **C. COMPOSITE_MATCH_REQUIRED** | 이름+지역코드+주소 조합으로 매칭, 모호 시 검토 큐 | **✅ 현재 유일하게 근거 있는 등급** |
| D. MANUAL_MAPPING_REQUIRED | 자동 매칭 불가, 수작업 전제 | 조건부(C 매칭 실패 건에 한해) |
| E. UNSAFE | 신뢰 불가, 적재 금지 | ❌(C조차 시도할 근거는 있음) |

**최종 판정: C. COMPOSITE_MATCH_REQUIRED** — School/Kindergarten/Childcare에서 이미 사용한 것과 동일한 "이름+시군구코드+도로명주소" 조합 매칭 방식을 그대로 재사용하는 설계를 권고한다(§9). API Key 확보 후 실제 SCHUL_CODE 값을 받으면, 그 값이 NEIS SD_SCHUL_CODE와 일치하는지 표본 검증(최소 10개교, 동명이교 포함)을 먼저 수행하고 **일치가 확인된 경우에만** A등급으로 격상하고 코드 직접 매칭으로 전환한다. 그 전까지는 코드값을 신뢰하지 않는다.

---

## 5. 시군구 코드 안정성 리스크 (신규 발견)

schoolinfo.go.kr 공지사항(2026-07-01)에서 다음 공지를 확인:

> "2026년 7월 1일, 전남광주통합특별시 및 인천 행정체제 개편에 따라 학교알리미 OpenAPI 시군구 코드 변경을 안내드립니다. [변경사항] 전라남도, 광주광역시 통합 > 전남광주통합특별시 / 인천광역시 행정구역 개편"

- **부산은 이번 개편 대상이 아님** — 이번 STEP(부산 한정)의 진행에 직접적 영향 없음.
- 다만 이는 "시군구 코드가 실제로 개편될 수 있다"는 실증 사례이며, `busan_regcodes_raw.json`(C2A/C3B/C3A/score-geocode-recovery에서 재사용해온 gitignored 캐시 파일)을 향후 전국 확장 시 그대로 재사용하면 안 되고, 매 ingestion 실행 전 "시도시군구코드.xlsx"(학교알리미 자료실 제공)와 대조하는 절차를 설계에 포함해야 한다(§9-4).

---

## 6. SchoolStat 스키마 충분성 감사

현재 `SchoolStat` 모델(C2A 이전 C1에서 이미 생성, 변경 없음):
```prisma
studentCount   Int?
classCount     Int?
teacherCount   Int?
gradeBreakdown Json?   // 학년별 세부 — 필드 스키마 미확정이라 typed column화 안 함
referenceYear  Int     // unique key
disclosureYear Int?
```

| 카테고리 | 매핑 가능 여부 | 분류 |
|---|---|---|
| 09 학년별·학급별 학생수(총원/학급/교원) | studentCount/classCount/teacherCount에 총계 저장, 학년별 세부는 gradeBreakdown Json | **B(경미)** — 그대로 사용 가능 |
| 63 성별 학생수 | 전용 컬럼 없음. gradeBreakdown Json에 우겨넣으면 이름 의미와 어긋남 | **C(설계 개선 권장)** |
| 10 전·출입 및 학업중단 학생 수 | 대응 컬럼 전혀 없음 | **C(설계 개선 권장)** |
| 22/64/24 교원 현황(직위별/자격별/과목별) | teacherCount(총원)만 대응, 세부는 없음 | **C(설계 개선 권장)** |

**결론(등급 B/C 혼재):** 09번(이번 STEP의 1차 목표 카테고리)만 놓고 보면 기존 스키마로 즉시 수용 가능(B등급)하다. 그러나 "기본 통계"를 09번 하나로 한정하지 않고 성별/전출입/교원현황까지 포함하려면, `gradeBreakdown`이라는 이름이 의미상 맞지 않게 되므로 **후속 스키마 변경 시 `gradeBreakdown`을 더 일반적인 `statBreakdown Json` 또는 카테고리별 전용 Json 컬럼(`teacherBreakdown`, `transferBreakdown` 등)으로 재설계할 것을 제안**한다. **이번 STEP에서는 스키마를 변경하지 않는다** (설계 제안만, 사용자 승인 후 별도 STEP에서 실행).

---

## 7. 시간 모델(Temporal Model) 검증

- `@@unique([schoolId, sourceId, referenceYear])` — `referenceYear`를 API의 `pbanYr`(공시년도, yyyy)에 그대로 매핑하면 **충분**하다.
- API 제약: `pbanYr`는 **최근 3년만 조회 가능** — 이는 History 관리 정책에 직접 영향. 3년 이전 과거 데이터는 API로 재조회 불가능하므로, **한 번 수집한 연도 데이터는 삭제하지 말고 계속 보존**해야 한다는 설계 원칙이 강화된다(SCHOOL V2-C에서 이미 정한 "historical retention은 legal review 통과 후"와 결합해도 모순 없음 — 라이선스가 CLEARED이면 과거 스냅샷 보존에 법적 문제 없음).
- `disclosureYear` vs `referenceYear` 구분 필요성: 이번 STEP에서 실제 공시년도와 기준연도가 다른 사례를 API로 확인하지 못했음(BLOCKER). 스키마상 이미 분리되어 있으므로 즉시 대응 가능, 실제 값 검증은 후속.

---

## 8. Ingestion 아키텍처 제안(설계만, 미구현)

### 8-1. 개선 목표: 진짜 no-op idempotency
C2A/C3B는 "대상 학교마다 매번 upsert 실행 → 매번 updated=N으로 로그에 잡힘"(실제 변경이 없어도 DB write가 발생하는 구조)이었다. 이번 설계는 다음을 제안한다:

```
1. 소스에서 받은 row를 정규화한다.
2. DB의 기존 (schoolId, sourceId, referenceYear) row와 diff한다
   (studentCount/classCount/teacherCount/gradeBreakdown JSON deep-equal 비교).
3. diff가 없으면 write를 skip한다(updatedAt도 건드리지 않음).
4. diff가 있으면 update 하고, 그 결과를 unchanged/updated/created 3분류로 집계한다.
```
→ 결과 리포트가 "667건 처리, 664건 unchanged, 3건 updated, 0건 created"처럼 실제 변화량을 드러내야 한다.

### 8-2. Identity 매칭 파이프라인(제안)
```
for each SchoolInfo row:
  1차: (SCHUL_CODE 실값이 향후 확보되면) neisSchoolCode 직접 매칭 시도
  2차(현재 유일한 실사용 경로): schoolName + sigunguCode(정규화 후) + 도로명주소 exact-token 매칭
     → 기존 School 테이블에서 1건 매칭되면 확정
     → 0건 또는 2건 이상 매칭되면 REVIEW_REQUIRED 큐로 분리(자동 적재 금지)
  3차: 매칭 실패 건은 SchoolStat을 생성하지 않고 별도 unmatched 리포트에 기록
```

### 8-3. EducationSource 등록 제안값(미실행, 승인 대기)
```
code: 'schoolinfo_stat_api'
displayName: '학교알리미 학생/학급/교원 통계(OpenAPI)'
provider: '한국교육학술정보원(KERIS)'
sourceType: 'API'
sourceUrl: 'http://www.schoolinfo.go.kr/openApi.do'
licenseCode: 'UNRESTRICTED_ATTRIBUTION'   // 기존 neis_school_info와 동일 등급
attributionRequired: true
commercialUseAllowed: true
modificationAllowed: true
legalReviewStatus: 'REVIEW_REQUIRED'   // apiType=09 외 카테고리 라이선스 개별 미확인 + 실 API 응답 미검증이므로 CLEARED 아님
```
**legalReviewStatus를 CLEARED가 아닌 REVIEW_REQUIRED로 제안하는 이유**: (1) 라이선스 텍스트는 apiType=09 페이지에서만 직접 읽었고 나머지 apiType은 사이트 공통 정책에 귀속된다고 추정만 했음, (2) 실제 API 응답을 한 번도 받아보지 못해 "명세와 실제가 다를 수 있다"(C3B에서 실제로 겪은 문제)는 리스크가 그대로 남아있음.

---

## 9. 두 지표(Two-Metric) 커버리지 QA 모델 제안

BUSAN-SCORE-DATA-V1.1에서 확립한 패턴(A: 분모를 성공 대상으로만 좁힌 성공률 vs B: 전체 분모 기준 실제 커버리지)을 그대로 적용:

```
A. SOURCE_ROW_SUCCESS_RATE = (SchoolInfo에서 정상 매칭+정규화 성공한 row 수) / (SchoolInfo API가 반환한 전체 row 수)
B. BUSAN_SCHOOL_STAT_COVERAGE = (SchoolStat이 생성된 School 수) / (canonical School 전체 664건)
   → 학교급별(초/중/고/특수/각종) breakdown 필수 — apiType별로 schulKndCode 파라미터가 분리되어 있어
     학교급 하나가 통째로 누락되어도 전체 숫자만 보면 드러나지 않는 함정이 있음(교원 현황 22/64/24가 특히 학교급별 시트 구조 상이).
```

---

## 10. "13-다 졸업생의 진로 현황" — 정정 보고 (중요)

### 10-1. 기존 SCHOOL V2-B 판단(정정 대상)
이전 V2-B 재조사에서 "13-다 졸업생의 진로 현황"을 `AVAILABLE_API(카테고리)` + `LEGAL_REVIEW_REQUIRED` + `필드스키마 NOT_CONFIRMED`로 판정했다. 이는 **WebFetch로 가져온 11개 항목 메뉴 텍스트**에 근거했다.

### 10-2. 이번 STEP에서 확인한 사실
이번 STEP에서 학교알리미가 공식 배포하는 **`OpenAPI_Output.xlsx`(OpenAPI로 실제 제공되는 전체 35개 카테고리의 공식 명세서)를 직접 다운로드·파싱**했다. 35개 시트 전체를 나열했을 때(§2-3), "진로", "진학", "졸업생" 관련 시트는 **단 하나도 존재하지 않는다.**

### 10-3. 해석
- 학교알리미 웹사이트의 "공시항목" 메뉴(사람이 보는 화면)에는 "학생의 진로 현황" 같은 항목이 존재할 수 있다(V2-B가 본 것이 이것일 가능성). 그러나 **OpenAPI로 실제 제공되는 35개 카테고리 목록에는 포함되어 있지 않다.**
- 즉, 웹 화면에 공시되는 항목 ≠ OpenAPI로 자동 수집 가능한 항목. 이 둘을 혼동한 것이 V2-B의 오판 원인으로 추정된다(WebFetch가 사람용 메뉴 텍스트를 읽어온 것으로 보임).

### 10-4. 최종 정정 판정
```
13-다(졸업생의 진로 현황):
  AVAILABLE_API           = NO   (35개 공식 OpenAPI 카테고리에 없음 — V2-B 판단 정정)
  WEBSITE_DISCLOSURE_ITEM = 확인 안 됨(이번 STEP 범위 밖, 필요 시 후속 확인)
  GRADUATE_OUTCOME_SCHEMA_READY = NO
```
`GraduateOutcomeSnapshot`은 SCHOOL V2-C 설계 결정(별도 LATER 테이블, 컬럼 미확정)을 그대로 유지한다 — 오히려 이번 정정으로 "당장 컬럼을 설계하지 않는다"는 기존 결정이 더 타당했음이 재확인되었다. 향후 이 데이터가 필요하다면 OpenAPI가 아닌 **개별 학교 웹페이지 공시자료(PDF/HWP) 크롤링** 등 완전히 다른 수집 경로를 처음부터 재설계해야 한다.

---

## 11. 최종 판정

```
SCHOOLINFO_DATA_INGESTION_READY = NO
```

**차단 사유(우선순위 순):**
1. **API Key 없음** — `openApi.do` 실호출 자체가 불가능. 실제 응답 필드/SCHUL_CODE 실값을 한 번도 확인하지 못함.
2. **Identity crosswalk 값 단위 미검증** — C등급(이름+주소 조합 매칭)으로만 설계 가능, A등급(코드 직접 매칭)으로 격상하려면 키 확보 후 실증 필요.
3. **라이선스 전 카테고리 개별 확인 미완료** — apiType=09만 직접 확인, 나머지는 사이트 공통 정책 추정 단계.

**즉시 진행 가능한 후속 조치(사용자 승인 시):**
- KERIS 학교알리미 OpenAPI 키 발급 신청(사용자 액션 필요 — C3B의 KINDERGARTEN_API_KEY와 동일 패턴)
- 키 확보 후 "SCHOOL V2-C2B RESUME" 형태로 재개하여 §3(실 API 검증)·§4(코드값 crosswalk 표본검증, 송정초등학교 등 동명이교 최소 10개교)를 마무리
- 그 결과에 따라 EducationSource.legalReviewStatus를 CLEARED로 격상할지 재판단

---

## 12. 이번 STEP에서 하지 않은 것(명시)

- UI 구현 없음
- SchoolStat 실제 대량 적재 없음(SchoolStat 여전히 0건)
- GraduateOutcomeSnapshot 실제 구현 없음
- 13-다 세부 category 컬럼 추정 설계 없음
- 학교 서열/학업성취 점수화 없음
- 학군 점수(score) 변경 없음
- SCHOOL V2-D UX 착수 없음
- main/C2A/C3B/score 브랜치 merge 없음
- prisma schema/migration 변경 없음(§6 제안은 설계 문서 언급일 뿐 미실행)
