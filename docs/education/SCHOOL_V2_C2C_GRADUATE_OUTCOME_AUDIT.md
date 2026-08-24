# SCHOOL V2-C2C — 13-다(졸업생의 진로 현황) 공식 데이터 확보 경로 감사

- 작성일: 2026-08-23
- Worktree: `D:\anti2\aaa\real-estate-app\.worktrees\school-v2-c2c-graduate-outcome-audit`
- Branch: `school-v2-c2c-graduate-outcome-audit` (base: `school-v2-d1-parent-education-ui`)
- 목적: **AUDIT 전용.** DB write, migration, production ingestion, main merge 없음.
- 선행 문서: [SCHOOL_V2_C2B_SCHOOLINFO_SOURCE_AUDIT.md](./SCHOOL_V2_C2B_SCHOOLINFO_SOURCE_AUDIT.md) §10(OpenAPI 35개 카테고리에 13-다 없음, `WEBSITE_DISCLOSURE_ITEM = 확인 안 됨`으로 열어둔 질문을 이번 STEP이 마무리), [SCHOOL-V2-B-official-source-verification.md](../development/SCHOOL-V2-B-official-source-verification.md) §1-4(오판으로 정정된 최초 AVAILABLE_API 판단), [SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md](../development/SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md)(OpenAPI 3개 오퍼레이션 라이선스 CONDITIONAL 판정)

## 0. 결론 요약(TL;DR)

| 항목 | 결과 |
|---|---|
| 학교알리미 웹 화면에 13-다 공시 존재 | **CONFIRMED** — `경남고등학교`, `부산외국어고등학교` 실 데이터로 직접 확인 |
| OpenAPI로 제공 여부 | **NOT_AVAILABLE**(재확인) — 학사/학생·재정/시설/설비·보건/복지 3개 탭 전체 34개 오퍼레이션 목록에 "진로/진학/졸업" 항목 0건, C2B §10 결론 재확인 |
| 웹 페이지 접근 경로 | **CONFIRMED, 인증/로그인 불필요** — `GET Pneiss_b01_s0.do?SHL_IDF_CD={school-uuid}&GS_HANGMOK_CD=06` |
| 엑셀다운로드 endpoint | **CONFIRMED but 현재 SERVICE_ERROR** — `POST /cm/include/ExcelPrint.do`, 실 클릭 기준 5회 연속 HTTP 503 (2개 학교, 2개 공시항목 교차 확인) |
| 실제 컬럼 스키마 | **CONFIRMED**(HTML 렌더 표 기준, Excel 파일 바이트는 미확보) — 9개 수치 컬럼 + 8개 비율 컬럼, 전부 §11 |
| school identifier | **CONFIRMED이나 NEIS와 미연결** — `SHL_IDF_CD`(schoolinfo 내부 UUID), 기존 리졸버(`schoolinfo-identity-resolver.ts`)가 쓰는 어떤 코드와도 다름, 신규 크로스워크 필요 |
| 라이선스 | **REVIEW_REQUIRED**(LEGAL-1과 동일 결론 상속) — 이 항목 전용 페이지 없음, 사이트 공통 저작권정책만 적용 |
| 자동화 분류 | **D. SCRAPING_REQUIRED**(현재), Excel 서비스 복구 시 **C. MANUAL_DOWNLOAD_ONLY**로 재평가 필요 |
| production ingestion 가능 여부 | **NO** — identity crosswalk 미해결 + 라이선스 REVIEW_REQUIRED + Excel 서비스 다운, 3중 게이트 |

---

## 1. 학교알리미 13-다 공식 화면 구조 확인

### 1-1. 접근 경로(3단계)

```
1) Main.do 검색창 → "{학교명} {공시항목명}" 형식으로 검색
   → 검색결과 카드에 매칭된 공시항목명이 태그로 노출됨
   → 그 태그의 href가 javascript:searchSchul2('{SHL_IDF_CD}','06')

2) searchSchul2()는 hidden form(schulForm, POST, target=팝업창)을 제출:
   SHL_IDF_CD = schoolinfo 내부 UUID (예: e89e601c-c80e-4c8c-a648-cabed8935149)
   PRE_JG_YEAR = "" (기본값, 최신연도)
   GS_HANGMOK_CD = "06" (13-다의 site-internal 항목코드 — OpenAPI apiType,
                          공식 문서 "13-다" 번호와 전부 다른 제3의 번호체계)

3) 동일 파라미터를 GET query string으로 직접 접근해도 200 OK로 동작함(실측 확인):
   GET https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do
       ?SHL_IDF_CD={uuid}&GS_HANGMOK_CD=06
   → 로그인/세션/CSRF 토큰 불필요, 완전 공개 페이지
```

**중요 발견**: `GS_HANGMOK_CD`는 site 내부 UI 코드로, 앞서 C2B/C2BB가 밝힌 OpenAPI
`apiType`(0=학교기본정보, 09=학년별·학급별학생수, 22=직위별교원현황)과도, 공식 문서
"13-다" 표기와도 **전혀 다른 제3의 번호체계**다. 같은 데이터를 가리키는 서로 다른
소스(공식문서/OpenAPI/웹UI)가 서로 다른 번호를 쓴다는 C2B-B의 기존 교훈(§1)이 이번
항목에서도 그대로 재현됨 — 향후 어떤 코드도 다른 시스템에 그대로 이식하지 않는다.

### 1-2. school identifier — `SHL_IDF_CD`

- 형식: UUID v4 (예: `e89e601c-c80e-4c8c-a648-cabed8935149`)
- 획득 경로: `Main.do` 통합검색 결과의 `javascript:searchSchul('{uuid}')` href에서만 노출.
  화면 어디에도 평문으로 표시되지 않음(즉시 눈에 보이는 값이 아니라 DOM 속성에서
  추출해야 함).
- 기존 코드베이스의 `schoolinfo-identity-resolver.ts`(C2B-A)가 쓰는 매칭 방식(학교명+
  시군구, NEIS 코드 crosswalk)과 **이 UUID는 연결되어 있지 않다** — 이번 STEP에서
  crosswalk를 만들지 않았고(§8), 기존 리졸버를 그대로 재사용할 수 없다.

### 1-3. 화면에 표시되는 필드 (경남고등학교 실측)

```
공시년월 셀렉터: (4차) 2025년 11월 / (4차) 2024년 11월 / (4차) 2023년 11월
버튼: 인쇄하기 | 엑셀다운로드
안내문: "학교정보공시는 항목별로 조사 및 공시시기(4/5/9/11)가 다릅니다.
        해당 항목은 올해 공시 예정 항목이므로, 가장 최근연도의 정보가 공시됩니다."
차트: 전문대학/대학/국외진학/취업자/기타 5분류 파이차트(단위: 명, %)
표: "졸업자 진로 현황 (진학·취업·기타)" — §11
작성자/확인자 실명 표기(학교 담당자, 학생 개인정보 아님)
공시가이드: 각 필드의 공식 정의 전문(§13)
```

**엑셀다운로드 버튼 존재 — CONFIRMED**(사용자가 화면에서 직접 확인한 그대로).

---

## 2. Excel download endpoint 확인

```
Endpoint : POST https://www.schoolinfo.go.kr/cm/include/ExcelPrint.do
Form id  : excelprint (target 없음 — 팝업이 아니라 현재 창에서 파일 응답)
Fields   : ExcelData (hidden, 렌더링된 표 HTML을 그대로 담은 값으로 추정 —
                       이집이 이 값을 직접 로그로 확인하지는 못함, §2-1 참고)
           excelname = "졸업생의진로현황"
Session/Cookie 필요 여부 : 불필요(로그인 없이 페이지·다운로드 버튼 모두 접근됨)
CSRF 토큰 : 화면상 별도 토큰 필드 없음(hidden field 2개뿐)
```

### 2-1. 실측 결과 — SERVICE_ERROR (AUTOMATION_RISK 아님, 서버측 오류)

실제 버튼 클릭(자동화 아닌 실제 DOM 이벤트) 기준 **5회 연속 HTTP 503**:

| 시도 | 학교 | 공시항목 | 결과 |
|---|---|---|---|
| 1 | 경남고등학교 | 13-다(졸업생의 진로 현황) | 503 |
| 2 | 경남고등학교 | 13-다(즉시 재시도) | 503 |
| 3 | 경남고등학교 | 성별 학생수(다른 항목으로 교차검증) | 503 |
| 4 | 경남고등학교 | 13-다(10초 대기 후) | 503 |
| 5 | 부산외국어고등학교 | 13-다(다른 학교로 교차검증) | 503 |

동일 endpoint가 **학교·공시항목과 무관하게** 매번 503을 반환했다 — 특정 학교/항목의
문제가 아니라 `/cm/include/ExcelPrint.do` 자체가 이번 조사 시점(2026-08-23 저녁,
KST)에 서비스 불가 상태였던 것으로 판단한다. `fetch()`로 동일 요청을 직접 재현해도
동일하게 503이었다(브라우저 자동화의 요청 형태 문제가 아님을 시사).

**분류: SERVICE_ERROR(일시적 서버 장애로 판단) — AUTOMATION_RISK 아님.** 실제
브라우저·실제 클릭·정상 세션으로도 재현되는 서버측 오류이므로, 우회가 필요한
자동화 난이도 문제가 아니라 재시도 시점의 문제로 본다. **최종 판정은 후속
재시도로 검증 필요**(§17에서 잠정 D 등급으로 보수적으로 분류한 이유).

---

## 3-4. 실제 컬럼 스키마 (Excel 파일 대신 서버 렌더 HTML 표 기준으로 확정)

Excel 바이트 파일 자체는 §2-1의 이유로 확보하지 못했다. 다만 `ExcelData` hidden
필드명과 `excelname`(파일명만 다르고 내용은 화면과 동일한 것으로 추정되는 표준
"HTML 표 → xls 변환" 패턴, 이 사이트의 `인쇄하기` 버튼과 동일 소스 데이터를 공유)
정황상, **화면에 서버가 이미 렌더링한 표가 Excel 파일의 컬럼 구성과 동일할
개연성이 높다** — 단, 이는 추정이며 실제 xls 파일을 열어 encoding/sheet 구조/
merged cell을 확인하기 전까지 **CONFIRMED가 아니라 INFERRED**로 표기한다.

### 3-1. 확정 컬럼(화면 실측, 2개교 실 데이터)

```
구 분 (행: 남 / 여 / 합계 / 비율)
  졸업자
  진학자
    전문대학
    대학교
    국외진학
      전문대학
      대학교
      소계
    계          ← "진학 계"에 해당하는 공식 컬럼명은 정확히 "계"(진학자 그룹의 소계)
  취업자
  기타
```

**9개 수치 컬럼**: 졸업자, 진학자-전문대학, 진학자-대학교, 국외진학-전문대학,
국외진학-대학교, 국외진학-소계, 진학자-계, 취업자, 기타.
**8개 비율 컬럼**(졸업자 제외 8개 항목 각각의 %, 원본에 이미 계산되어 있음 — §5).

### 3-2. 실측 데이터 2건 (2026-08-23 기준, 2025년 11월 공시분)

| 학교 | 학교특성 | 졸업자 | 전문대 | 대학교 | 국외(전문/대학/소계) | 진학계 | 취업 | 기타 |
|---|---|---|---|---|---|---|---|---|
| 경남고등학교 | 자율고등학교(일반고 계열) | 164 | 13 | 123 | 0/0/0 | 136 | 3 | 25 |
| 부산외국어고등학교 | 특수목적고등학교 | 248 | 0 | 178 | 1/5/6 | 184 | 0 | 64 |

산술 검증(합계 행): 경남 13+123+0=136✓, 136+3+25=164✓ / 부산외고 0+178+6=184✓,
184+0+64=248✓ — 두 학교 모두 원본 표의 내부 합계가 정확히 일치.

### 3-3. NO_DATA 케이스 — 부산컴퓨터과학고등학교(특성화고)

동일 URL 패턴(`GS_HANGMOK_CD=06`)으로 접근했으나 **"입력된 데이터가 없습니다"**만
표시(공시년월 셀렉터 자체가 렌더링되지 않음, 인쇄/엑셀 버튼도 없음). `PRE_JG_YEAR=2025`를
명시적으로 붙여도 동일 — 특정 연도만 비어있는 게 아니라 이 학교는 현재 이 항목
자체를 공시하지 않은 상태로 보인다. **이것을 오류로 단정하지 않는다**(CLAUDE.md
원칙13) — 특성화고는 졸업 진로 구성이 다르거나(취업 중심), 공시 담당자가 아직
입력하지 않았을 가능성 등 여러 정상적 원인이 있을 수 있다.

### 3-4. 확실히 존재하지 않는 필드(원칙적으로 추정 금지, 실측 기준 명시)

"SKY", "수도권대", "명문대", "4년제 상위대학" 등 서열화 관련 필드는 화면 어디에도
**존재하지 않는다.** 공식 컬럼은 "전문대학/대학교/국외진학/취업자/기타"뿐 — 대학의
질적 구분(상위권/하위권 등)은 원본 데이터 자체에 없다.

---

## 5. 비율 계산 주체 확인 — SOURCE_PROVIDED(이집이 계산하지 않아도 됨)

표의 "비 율" 행이 count 행과 별도로 이미 존재한다(예: 경남고 대학교 123명 옆에
75.0%가 그대로 표시). 즉 **비율은 원본 소스가 이미 계산해 제공하는 값**이며, 이집이
직접 계산할 필요가 없다 — SCHOOL-V2-C 설계문서 §18(Derived Metrics)의
"SOURCE_PROVIDED는 이집이 계산한 값과 절대 같은 컬럼에 섞지 않는다" 원칙을 그대로
적용 가능. 반올림 오차 검증: 경남고 8개 비율 합 = 7.9+75.0+0+0+0+1.8+15.2 = 99.9
(반올림 오차 0.1, 정상 범위).

---

## 6. 연도/이력 확인

- 공시년월 셀렉터에 노출된 값: `(4차) 2025년 11월`, `(4차) 2024년 11월`,
  `(4차) 2023년 11월` — **딱 3개년**만 노출됨(학교알리미 최근 3년 제한, V2-B §1-4-5
  / LEGAL-1 §8과 동일 제약이 이 항목에도 그대로 적용됨을 재확인).
- 안내문 원문: "해당 항목은 올해 공시 예정 항목이므로, 가장 최근연도의 정보가
  공시됩니다." — **2026년 항목은 아직 미공시**이고 기본 표시값은 **2025년 11월
  공시분(2025학년도 졸업생 기준으로 추정)**이다. "공시연도"와 "졸업연도"의 정확한
  의미론적 구분은 이번 실측만으로 완전히 확정하지 못했다(화면에 "2025학년도
  졸업생"이라는 명시적 라벨은 없음, 정황상 11월 공시 = 그해 2월 졸업생 기준으로
  추정되나 UNCONFIRMED로 남긴다).
- "(4차)"라는 접두어의 의미(공시차수)는 이번 실측에서 확인했으나 그 배경 규정까지는
  조사하지 않았다.

---

## 7. 부산 고등학교 전체 coverage 가능성 (dry-run 판정, 실제 대량 다운로드 미실행)

canonical 고등학교 분모는 C2B-B(§3, 재확정)의 **159개**를 그대로 쓴다(신규 재계산
없음).

```
159 canonical Busan high schools
  ├─ eligible(중/고/특/각 대상, §13 가이드 명시) — 구조적으로 159 전체 해당 추정
  │  (고등학교 자체가 이미 대상 학교급이므로, 개별 학교가 대상 제외될 이유는
  │  방송통신고/각종학교 등 C2B-B §7에서 이미 확인된 "SOURCE_NOT_APPLICABLE"
  │  패턴과 유사할 가능성 — 재검증 안 함, 추정)
  ├─ identity(SHL_IDF_CD) resolved  — 3/3 (100%, 표본 극소)
  ├─ downloadable(HTML 조회 성공)   — 2/3 (66.7%, 표본 극소)
  └─ no data(공시 없음)             — 1/3 (33.3%, 부산컴퓨터과학고, 표본 극소)
```

**3개교 표본은 전체 판정 근거로 쓰기에는 너무 작다** — 이 dry-run의 목적은 "구조적으로
자동화 가능한가"를 확인하는 것이지 실제 coverage 비율을 확정하는 것이 아니다(지시사항
§7 그대로). 구조적 결론: **HTML 페이지 접근 자체는 159개교 전부에 대해 기계적으로
반복 가능한 패턴**(URL 2개 파라미터만 다름)이나, **SHL_IDF_CD 159개를 전부
확보하려면 159회의 개별 검색이 필요**하고(§8, 대량 조회용 벌크 엔드포인트를 이번
조사에서 찾지 못함), 실제 데이터 존재 여부는 학교마다 다를 수 있다(§3-3).

---

## 8. school identity — SHL_IDF_CD ↔ NEIS crosswalk 미해결(신규 블로커)

```
현재 코드베이스의 identity 자산:
  - School.neisSchoolCode (NEIS SD_SCHUL_CODE) — canonical PK
  - schoolinfo-identity-resolver.ts(C2B-A) — NEIS ↔ SchoolInfo apiType=09
    매칭용 리졸버(학교명+시군구 기반, HIGH/MEDIUM/LOW/NO_MATCH 신뢰도)

이번에 새로 발견된 identifier:
  - SHL_IDF_CD (schoolinfo 웹 UI 내부 UUID) — 위 어느 코드와도 직접 연결되지 않음
```

`SHL_IDF_CD`는 OpenAPI `apiType=09` 등이 쓰는 코드 체계와도 다르고, NEIS
`SD_SCHUL_CODE`와도 형식이 다르다(UUID vs 7자리 숫자). **기존 C2B-A 리졸버를
그대로 재사용할 수 없다** — 이 UUID를 얻으려면 매 학교마다 `Main.do` 검색 →
검색결과 DOM에서 `searchSchul()` href 파싱이라는 별도 크롤링 단계가 필요하다.
자동 매칭 시 동명이교 위험(§9)까지 고려하면, 이 crosswalk는 **새로운 review-queue
기반 매핑 작업(1건씩 검증)**으로 설계해야 하며 이번 STEP에서 구현하지 않았다.

---

## 9. same-name / ambiguity safety

이번 3개교 표본에서는 동명 학교가 없어 직접 충돌 사례를 재현하지 못했다. 다만
`Main.do` 검색은 학교명 단독 검색이 기본이라(§1-1), C2B-A가 이미 문서화한 부산
동명이교 위험(§9 지시사항)이 **SHL_IDF_CD 검색 단계에서도 그대로 적용된다**고
보는 것이 안전하다 — 검색결과가 여러 건이면(예: "송정중학교") 자동으로 첫 번째
결과를 채택하지 않고 시/군/구 필터(§1-1의 "학교별 공시정보" 고급 검색 UI, 학교급
→ 시/도 → 시/군/구 → 학교 4단 드릴다운)를 반드시 함께 써서 HIGH 신뢰도 매칭만
허용해야 한다. 자동 ingestion 설계 시 이 원칙을 강제할 것(§15).

---

## 10. legal/license 확인

### 10-1. OpenAPI 오퍼레이션 자체가 존재하지 않음 — LEGAL-1의 per-operation 방식 적용 불가

LEGAL-1(§1)은 `apiType=0/09/22` 각각의 "이용허락조건" 텍스트를 오퍼레이션 상세
페이지에서 직접 확인했다. 이번 STEP에서 동일 방식을 13-다에 적용하려 했으나,
**§1(본 문서)에서 재확인한 대로 13-다는 OpenAPI 오퍼레이션 자체가 존재하지
않으므로, 그런 오퍼레이션별 상세 페이지 자체가 없다.** 즉 LEGAL-1이 발견한
"schoolinfo.go.kr 오퍼레이션별 메타정보는 영리+변경까지 자유이용 허용"이라는
더 관대한 조건은 **13-다에는 적용 대상이 아니다.**

### 10-2. 적용되는 라이선스 — 사이트 공통 저작권정책뿐

13-다 웹 페이지 자체에는 이 항목 전용 라이선스 고지가 없다(화면 스캔 결과, 뱃지/
KOGL 유형 표시 없음). 확인 가능한 것은 사이트 공통 `저작권정책`
(`/ng/cp/pnngcp_a01_l0.do`)뿐이며, 그 내용은 LEGAL-1이 이미 상세히 분석한 것과
**완전히 동일한 일반 안내**(공공누리 제1~4유형 설명, "이용조건을 확인하신 후"라는
비확정적 문구, 출처표시 필수)다 — 이 페이지 자체는 13-다에 특정된 유형을
명시하지 않는다.

### 10-3. 최종 판정

```
GRADUATE_OUTCOME_LEGAL_GATE = REVIEW_REQUIRED
```

근거: (1) OpenAPI 전용의 더 관대한 "변경 허용" 조건(LEGAL-1 §2)이 13-다에는 적용
불가 — 이 항목은 원천적으로 웹 화면 스크래핑 경로만 존재하므로 데이터.go.kr 등록
자체도 없다(§2-1처럼 별도 dataset 자체가 없음), (2) 사이트 공통 저작권정책은
"공공저작물"이라는 일반 카테고리 설명일 뿐 13-다가 정확히 몇 유형인지 명시하지
않는다, (3) LEGAL-1이 이미 지적한 data.go.kr vs schoolinfo.go.kr 불일치 리스크가
여기서는 아예 data.go.kr 등록 자체가 없어 비교 대상조차 없다 — 더 불확실한
상태. **학교알리미 고객센터(1544-0079, LEGAL-1 §12 권고와 동일)에 13-다 웹 화면
데이터의 상업적 이용/DB 저장/가공 가능 여부를 서면으로 별도 확인하기 전까지
CLEARED로 격상하지 않는다.**

---

## 11. raw 그대로 표시 가능한 범위

§10-3에서 REVIEW_REQUIRED로 판정했으므로, **현재 상태로는 표시 자체를 시작하지
않는다**(LEGAL-1의 SCHOOLINFO_STATISTICS_USE_GATE=CONDITIONAL이 apiType=09/0/22
3건에 대한 판정이었던 것과 달리, 13-다는 그 CONDITIONAL 허용 범위에도 포함되지
않는 별개 항목임을 명확히 한다). 법적 게이트가 해소되면, 원본 "졸업자/전문대학/
대학교/국외진학/계/취업자/기타"라는 공식 용어 그대로 표시하는 것을 제안한다 —
"대학 진학률" 같은 이집 자체 재정의 용어는 만들지 않는다(§13, 사용자 지시 그대로).

---

## 12. parent UX 가치 제안 (법적 게이트 해소 후에만 구현)

```
졸업생 진로

졸업자 164명

대학교
123명 · 75.0%

전문대학
13명 · 7.9%

국외진학
0명 · 0.0%

취업
3명 · 1.8%

기타
25명 · 15.2%

진학 계
136명 · 82.9%
```

실제 Excel/HTML schema(§3-1)와 완전히 일치하는 필드만 사용, 라벨은 공식 용어
그대로("진학 계"는 원본의 "계" 컬럼을 부모가 이해하기 쉽게 "진학 계"로 풀어쓴
것 — 새 통계를 만든 것이 아니라 원본 컬럼명 앞에 상위 그룹명("진학자")을 붙인
것뿐임을 명확히 함).

---

## 13. 표현 안전성

금지 항목(명문대/SKY/4년제 상위대학/좋은 고등학교/대학 잘 보내는 학교 등)을
언급하지 않는다 — 실제로 원본 데이터에 그런 항목이 존재하지 않으므로(§3-4)
구조적으로 불가능하기도 하다. 공식 terminology("졸업생 진로", "대학교 진학",
"전문대학 진학", "진학 계")만 사용.

---

## 14. School Score와 분리

이번 STEP에서 Score 관련 코드를 전혀 건드리지 않았다. `schoolAccessibility`
포뮬러 미변경. 13-다 데이터는 §11의 게이트가 해소되어도 **교육환경 정보
표시로만** 쓰고 Score 자동 반영에는 별도 승인이 필요하다(SCHOOL-V2-C §18
원칙과 동일 결).

---

## 15. ingestion architecture 재검토

SCHOOL-V2-C §7의 `GraduateOutcomeSnapshot`(별도 LATER 테이블, `rawPayload Json?`,
`schemaVersion: "unconfirmed-v0"`) 설계는 **이번 실측 결과를 그대로 수용 가능하다** —
수정 불필요. 다만 다음 두 가지를 설계 노트로 추가한다(문서만, migration 없음):

1. `sourceApiCategory` 필드에 넣을 값은 "학생 진로 현황"(OpenAPI 카테고리명)이
   아니라 **"13-다 졸업생의 진로 현황(웹 공시 페이지)"**로 정정 필요 — 이 데이터는
   OpenAPI가 아니라 웹 페이지 소스이므로 provenance 표기가 달라야 한다.
2. `schoolId` 값 기반 연결의 전제인 identity crosswalk가 NEIS 코드가 아니라
   `SHL_IDF_CD`(§8)를 거쳐야 하므로, ingestion pipeline에 **crosswalk 단계가
   Excel 파싱보다 먼저** 와야 한다(현재 설계 문서의 `fetch → normalize → validate →
   identity match → upsert` 순서와 일치, 추가 변경 불필요하나 identity match 단계의
   구체적 방법이 새로 필요함을 명시).

```
제안 파이프라인:
1) Main.do 검색 크롤링 → SHL_IDF_CD 확보(학교명+시군구 필터, HIGH 신뢰도만)
2) GET Pneiss_b01_s0.do?SHL_IDF_CD=...&GS_HANGMOK_CD=06 → HTML 파싱
   (Excel 서비스 복구 시 §2 endpoint로 대체 가능, 파싱 로직은 동일 스키마 재사용)
3) §3-1 스키마로 normalize → GraduateOutcomeSnapshot.rawPayload
4) legalReviewStatus='REVIEW_REQUIRED'인 동안 upsert 자체를 skip(게이트 강제)
```

---

## 16. update cycle

공시가이드/화면 안내문 기준 **연 1회, 11월**(V2-B §1-4-4에서 사용자가 화면으로
확인한 값과 일치, 이번 실측으로 "(4차) OO년 11월"이라는 정확한 형식까지 재확인).
"4차"라는 공시차수 배경 규정은 미조사.

---

## 17. automation feasibility 판정

```
GRADUATE_OUTCOME_AUTOMATION_CLASS = D. SCRAPING_REQUIRED (현재 시점)
```

**분류 근거**:
- OpenAPI 경로 없음(§1, C2B §10 재확인) → A/B 후보에서 원천 제외.
- 공식 "엑셀다운로드" 버튼이 있으나 서버가 현재 503(§2-1) → 이 버튼이 정상
  작동한다면 C(MANUAL_DOWNLOAD_ONLY, 사람이 학교마다 클릭)에 해당하겠으나,
  **지금은 그 버튼조차 작동하지 않아 신뢰할 수 없다.**
- 실제로 안정적으로 얻을 수 있는 것은 **로그인 없는 공개 HTML 페이지의 표를
  파싱하는 경로뿐**이며, 이는 정의상 스크래핑이다.
- 세션/CSRF가 없다는 점(§2)은 스크래핑 난이도를 낮추는 요인이나, 분류 자체를
  바꾸지는 않는다(공식 구조화 데이터 출력이 아니라 사람이 보는 HTML을 파싱하는
  것이므로).

**재평가 조건**: `/cm/include/ExcelPrint.do`가 복구되어 실제 xls 파일을 안정적으로
받을 수 있음이 재확인되면 **C. MANUAL_DOWNLOAD_ONLY**(또는 세션 없이 자동
POST만으로 받아진다면 **B. OFFICIAL_BUT_SESSION_DEPENDENT**에 가까운 상위 등급)로
재분류 권고.

---

## 18. 최소 sample parser

`scripts/education/lib/graduate-outcome-parser.ts` — DB write 없음, 순수 파싱
타입/함수만 구현:

```ts
interface GraduateOutcomeRow {
  schoolName, disclosureYearMonth,
  graduateCount, collegeCount, universityCount,
  overseasCollegeCount, overseasUniversityCount, overseasSubtotal,
  continuationTotal, employmentCount, otherCount,
  ratios: { collegePct, universityPct, overseasCollegePct,
            overseasUniversityPct, overseasSubtotalPct,
            continuationTotalPct, employmentPct, otherPct }
}
type GraduateOutcomeParseResult = { status: 'DATA'; row } | { status: 'NO_DATA' };
function isArithmeticallyConsistent(row): boolean  // §3-2 산술 검증 로직 재사용
```

HTML DOM → 이 타입으로의 실제 파서(cheerio 등)는 **이번 STEP에서 구현하지
않았다** — 법적 게이트(§10-3)가 REVIEW_REQUIRED인 상태에서 실 파싱 파이프라인을
만드는 것은 시기상조로 판단, 타입 정의와 검증 로직(§19 fixture test 대상)까지만
준비했다.

---

## 19. tests

`scripts/education/lib/graduate-outcome-parser.test.ts` — `node:test`, 8개 케이스,
전부 §3-2/§3-3 실측값 그대로(가상 데이터 생성 없음):

- normal high school(경남고, 산술 정합성)
- zero employment(부산외고 취업자 0)
- zero overseas(경남고 국외진학 0)
- non-zero overseas breakdown(부산외고 전문대1+대학5=소계6)
- NO_DATA/blank(부산컴퓨터과학고, "입력된 데이터가 없습니다")
- percentage formatting(반올림 합 100±0.5)
- arithmetic inconsistency detection(고의로 값을 깨뜨려 false 반환 확인 — identity
  mismatch로 다른 학교 데이터가 섞이는 상황의 대리 시나리오)
- duplicate school guard(동일 학교명, 다른 disclosureYearMonth는 별개 row)

**결과: 8/8 PASS** (`npx tsx --test scripts/education/lib/graduate-outcome-parser.test.ts`).

`tsc --noEmit`: 신규 파일 2건 기준 0 errors(프로젝트 전체에는 이번 STEP과 무관한
기존 미해결 모듈 에러 다수 존재 — `shapefile`/`proj4`/`iconv-lite` 타입 선언
누락, C6-A/C5-B 관련 기존 파일, 이번 STEP에서 발생시키지 않았고 손대지 않음).
`eslint`(신규 파일 2건): 0 errors. `next build`는 UI/route 변경이 없어 이번
STEP에서 실행하지 않음(프로덕션 코드 미접촉).

---

## 20-21. 문서/커밋

- 신규: 이 문서.
- 기존 `SCHOOL-V2-B-official-source-verification.md`: 삭제 없이 하단에 "OpenAPI
  unavailable(C2B/C2C 재확인), official web Excel/HTML route investigated"
  형식의 append만 진행(§21 지시사항 준수).
- DB write: 0건. migration: 0건. production ingestion: 0건.
- commit: docs + scripts/education/lib 신규 파일 2건만.
- main merge: 없음.

---

## 22. 최종 보고 (지시사항 1~54 대응)

```
1.  official 13-da page               = CONFIRMED, Pneiss_b01_s0.do?SHL_IDF_CD&GS_HANGMOK_CD=06
2.  Excel download exists              = CONFIRMED(버튼 존재)
3.  download endpoint                  = POST /cm/include/ExcelPrint.do
4.  request method                     = POST(폼 제출), GET variant 없음
5.  session/cookie required            = NO(비로그인 공개 페이지)
6.  CSRF required                      = NO(확인된 hidden field 2개뿐)

7.  sample schools                     = 3개교(일반고/특성화고/특목고)
8.  files downloaded                   = 0건(§2-1, 서버 503 5회 연속)
9.  file format                        = 미확인(바이트 미확보)
10. sheet structure                    = 미확인(단, HTML 표 구조는 §3-1로 확정)

11. actual columns                     = §3-1 (9개 수치 + 8개 비율)
12. graduate count field               = "졸업자"
13. college field                      = "전문대학"
14. university field                   = "대학교"
15. overseas field                     = "국외진학"(전문대학/대학교/소계 3분해)
16. continuation total field           = "계"(진학자 그룹 소계)
17. employment field                   = "취업자"
18. other field                        = "기타"
19. percentage fields                  = 8개, source-provided(§5)

20. unsupported fields explicitly absent = SKY/명문대/수도권대/4년제상위대 전부 부재(§3-4)

21. year semantics                     = 공시년월 3개(2025/2024/2023년 11월), 2026년 미공시
22. available years                    = 최근 3년 롤링(V2-B/LEGAL-1과 동일 제약 재확인)
23. update cycle                       = 연1회, 11월("4차" 공시차수, 배경규정 미조사)

24. canonical high schools             = 159(C2B-B 재확정치 재사용)
25. eligible estimated                 = 159 전체로 추정(재검증 안 함)
26. downloadable estimated             = 표본 3건 중 2건 성공(66.7%, 표본 극소— 전체 추정 근거로 부적합)
27. identity method                    = SHL_IDF_CD(UUID), NEIS와 미연결(§8, 신규 블로커)
28. unsafe identity count              = 0/3(표본 내 동명이교 없음, 위험 자체는 §9에서 원칙적으로 인지)

29. commercial use                     = REVIEW_REQUIRED(§10-3)
30. modification                       = REVIEW_REQUIRED(§10-3)
31. DB storage                         = REVIEW_REQUIRED(§10-3)
32. historical retention               = REVIEW_REQUIRED(LEGAL-1 §8과 동일 미해결 이슈 상속)
33. attribution                        = 필수(사이트 공통 정책, LEGAL-1 §6과 동일)
34. GRADUATE_OUTCOME_LEGAL_GATE        = REVIEW_REQUIRED

35. automation classification          = D. SCRAPING_REQUIRED(§17)
36. production ingestion feasible      = NO(3중 게이트: identity/legal/service 미해결)

37. GraduateOutcomeSnapshot fit        = 기존 설계 그대로 수용 가능, 컬럼 미확정 유지가 오히려 타당했음 재확인
38. migration needed now               = NO

39. sample parser                      = 타입+검증함수만 구현(§18), 실 DOM 파서는 미구현
40. tests                              = 8/8 PASS(§19)
41. tsc                                = 신규 파일 0 errors
42. lint                               = 신규 파일 0 errors
43. build                              = 미실행(UI 미변경)

44. docs                               = 이 문서 신규 + V2-B append(§20-21)
45. commit                             = 예정(이 STEP 마지막 단계)
46. push                               = 예정
47. worktree clean                     = 신규 파일 외 변경 없음(확인됨)

48. Score changed                      = NO
49. formula changed                    = NO

50. BLOCKER                            = (1) Excel 서비스 503, (2) SHL_IDF_CD↔NEIS crosswalk 부재, (3) 라이선스 REVIEW_REQUIRED — 3건 모두 해소되어야 production 착수 가능
51. SCHOOL_V2_C2C_CLOSE                = YES(이번 STEP 범위 완료)
52. GRADUATE_OUTCOME_DATA_READY        = NO
53. SCHOOL_V2_D2_GRADUATE_READY        = NO(§50 3중 블로커 해소 전까지)
54. NEXT_RECOMMENDATION                = (a) 학교알리미 고객센터에 13-다 웹 데이터 상업적 이용/저장 가능 여부 서면 문의(§10-3, LEGAL-1 §12와 동일 채널), (b) 며칠 뒤 ExcelPrint.do 재시도로 SERVICE_ERROR가 일시적이었는지 확인, (c) 그 2가지가 CLEARED/RESOLVED로 바뀐 뒤에만 SHL_IDF_CD 크롤링 설계(§8) 및 GraduateOutcomeSnapshot ingestion 착수
```

---

**SCHOOL V2-C2C 종료. 결과 보고 후 멈추고 ChatGPT/user 검수 대기.**
