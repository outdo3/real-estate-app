# SCHOOL V2-C2A — NEIS School Master Ingestion

**결과 요약: 성공.** 부산 664개교의 NEIS 학교기본정보를 `School` 테이블에
canonical master로 최초 ingestion했다. `SchoolStat`은 이번 STEP에서
의도적으로 건드리지 않았다(0행 유지, 학교알리미 C2B 범위).

작업은 별도 worktree(`D:\anti2\aaa\e-jip-school-c2a`, branch
`school-v2-c2a`, base `82f4914`)에서 진행했고, main worktree의 SCHOOL
V2-C3A(어린이집) 미커밋 작업물은 전혀 건드리지 않았다.

## 0. 시작 상태

```
(main worktree, D:\anti2\aaa\real-estate-app)
git status --short  → M CHANGELOG.md, M SCHOOL-V2-C-education-data-architecture.md,
                       ?? SCHOOL-V2-C3A-childcare-ingestion.md, ?? scripts/education/
git rev-parse HEAD        = 82f49145df7fdbff2100cbd62418cb2db4cfe444
git rev-parse origin/main = 82f49145df7fdbff2100cbd62418cb2db4cfe444

(worktree, D:\anti2\aaa\e-jip-school-c2a)
git worktree add ../e-jip-school-c2a -b school-v2-c2a 82f4914
git status --short  → (없음, clean)
git rev-parse HEAD  = 82f49145df7fdbff2100cbd62416cb2db4cfe444
git branch --show-current = school-v2-c2a
```

worktree는 main과 `.git`을 공유하지만 `node_modules`/`.env`/`.env.local`은
공유하지 않는다 — `npm install` 실행, `.env`/`.env.local`은 main
worktree에서 값 그대로 복사했다(둘 다 git 미추적 로컬 설정 파일).
`DATABASE_URL`이 동일 Supabase 인스턴스를 가리키므로 **DB는 main
worktree의 C1/C3A 작업과 동일한 하나의 DB를 공유**한다(브랜치가
분리된 건 코드/git 이력이지 별도 DB가 아님 — 의도된 설계, `EducationSource`
테이블에 어린이집 source 2건이 이미 있는 상태에서 NEIS source가
3번째로 추가됨).

## 1. 기존 NEIS 연동 재확인(§3)

`/api/school`, `/api/school/stats`(기존 production route, 코드 전문
재확인, 이번 STEP에서 수정하지 않음)에서 이미 검증된 구조를 그대로
재사용:

- endpoint: `https://open.neis.go.kr/hub/schoolInfo`
- 인증 파라미터: `KEY`(env `NEIS_API_KEY`)
- 페이지네이션: `pIndex`/`pSize`(500), `Type=json`
- 지역 스코프: `ATPT_OFCDC_SC_CODE`(교육청 코드, 부산=`C10`,
  `src/lib/neis-sido-codes.ts`)
- 응답 구조: `schoolInfo[0].head[0].list_total_count`,
  `schoolInfo[1].row[]`
- 기존 parser를 새로 만들지 않고 동일한 필드 파싱 구조를 그대로
  따랐다(§3/§19 지시).

## 2. 공식 NEIS Source 확인(§4) — Legal Gate CLEARED(§5)

- **이용약관**(`open.neis.go.kr/portal/userAgreementPage.do`) 제11조
  원문: *"기관은 당 사이트의 서비스에서 제공하는 데이터에 대하여
  저작자 및 출처 표시 조건으로 자유이용을 허락함을 원칙으로
  합니다."* — 영리목적 이용을 별도로 금지하는 조항 없음.
- **학교기본정보 데이터셋 상세**(`open.neis.go.kr/portal/data/service/
  selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2`)
  원문: **"이용 허락 범위 제한없음"**, 갱신주기 **"매주"**, 제공기관
  **"교육부, 16개 시도교육청"**.
- 두 공식 페이지가 서로 상충하지 않는다(어린이집 C3A에서 발견된
  원제공처/data.go.kr 라이선스 상충과 다른 경우) — **CLEARED로
  확정**.
- `EducationSource` 등록(`scripts/education/register-neis-school-source.ts`,
  실제 DB write):

```json
{
  "id": 3,
  "code": "neis_school_info",
  "displayName": "NEIS 학교기본정보(교육정보 개방포털)",
  "provider": "교육부, 16개 시도교육청(운영: 한국교육학술정보원)",
  "datasetId": "OPEN17020190531110010104913",
  "sourceType": "API",
  "sourceUrl": "https://open.neis.go.kr/hub/schoolInfo",
  "licenseCode": "UNRESTRICTED_ATTRIBUTION",
  "attributionRequired": true,
  "commercialUseAllowed": true,
  "modificationAllowed": true,
  "legalReviewStatus": "CLEARED",
  "termsCheckedAt": "2026-08-21T05:29:20.671Z"
}
```

기존 `childcare_national_api`(id=1)/`childcare_national_sheet`(id=2)
row는 변경/삭제하지 않았다 — id=3으로 신규 추가만.

## 3. NEIS_API_KEY(§4 지시, 값 미출력)

`.env.local`에 이미 존재(길이 32자, 기존 production route가 이미
쓰고 있는 값과 동일 변수) — **신규 키 신청 불필요, STOP 없이 진행**.

## 4. Sample Request(§6) — 실제 응답 필드(재확인)

부산(`ATPT_OFCDC_SC_CODE=C10`) 대상 실제 호출(`pSize=2`) 결과:

```
total_count: 667
RESULT: INFO-000 정상 처리되었습니다.
```

응답 필드(24개, 실측 — V1 audit의 기존 확인과 100% 일치):
`ATPT_OFCDC_SC_CODE, ATPT_OFCDC_SC_NM, SD_SCHUL_CODE, SCHUL_NM,
ENG_SCHUL_NM, SCHUL_KND_SC_NM, LCTN_SC_NM, JU_ORG_NM, FOND_SC_NM,
ORG_RDNZC, ORG_RDNMA, ORG_RDNDA, ORG_TELNO, HMPG_ADRES, COEDU_SC_NM,
ORG_FAXNO, HS_SC_NM, INDST_SPECL_CCCCL_EXST_YN, HS_GNRL_BUSNS_SC_NM,
SPCLY_PURPS_HS_ORD_NM, ENE_BFE_SEHF_SC_NM, DGHT_SC_NM, FOND_YMD,
FOAS_MEMRD, LOAD_DTM`

**신규 발견(이번 STEP)**: 샘플 첫 행이 `SCHUL_NM="(가칭)에코1초등학교"`,
`SD_SCHUL_CODE="       "`(공백), `FOND_YMD="20280301"`(미래 날짜) —
**아직 개교하지 않은 예정 학교가 NEIS 목록에 코드 공백 상태로
포함돼 있다.** 부산 667건 전수 조회 결과 이런 사례가 **정확히 3건**
확인됨(§7).

## 5. Field Mapping(§7)

| NEIS field | 목적지 | 분류 |
|---|---|---|
| `SD_SCHUL_CODE` | `School.neisSchoolCode` | **DIRECT**(trim 후 공백이면 invalid) |
| `SCHUL_NM` | `School.schoolName` | **DIRECT** |
| `SCHUL_KND_SC_NM` | `School.schoolLevel` | **DIRECT**(원문 그대로 저장, §9) |
| `FOND_SC_NM` | `School.establishmentType` | **DIRECT** |
| `COEDU_SC_NM` | `School.genderType` | **DIRECT** |
| `ORG_RDNMA` | `School.roadAddress` | **DIRECT** |
| `ORG_RDNDA` | `School.dongName` | **NORMALIZED**(괄호 표기 "(구포동)" → "구포동") |
| `ORG_TELNO` | `School.phone` | **DIRECT** |
| `HMPG_ADRES` | `School.homepage` | **NORMALIZED**("http://" 단독 placeholder는 null) |
| `ORG_RDNMA`+공식 법정동코드 | `School.sidoCode`/`sigunguCode` | **NORMALIZED**(주소 substring 매칭 아님, §14 참고) |
| `ENG_SCHUL_NM`, `LCTN_SC_NM`, `JU_ORG_NM`, `ORG_RDNZC`, `ORG_FAXNO`, `HS_SC_NM`, `INDST_SPECL_CCCCL_EXST_YN`, `HS_GNRL_BUSNS_SC_NM`, `SPCLY_PURPS_HS_ORD_NM`, `ENE_BFE_SEHF_SC_NM`, `DGHT_SC_NM`, `FOND_YMD`, `FOAS_MEMRD`, `LOAD_DTM` | (없음) | **IGNORED**(C1 School schema에 대응 컬럼 없음, School master 필수 요건 아님) |
| `ATPT_OFCDC_SC_CODE`/`ATPT_OFCDC_SC_NM` | (없음, fetch scope로만 사용) | **IGNORED**(row별 저장 안 함) |

School master 구축에 **필수인 필드(neisSchoolCode, schoolName)는
전부 C1 schema에 저장 가능**했다 — schema 확장 STOP 사유 없음(§7/§13
지시 준수). `LOAD_DTM`(공시 갱신일시)을 `School`에 provenance로 남길
컬럼이 없다는 점은 사소한 gap으로만 기록하고(§13 원문: "optional
field 때문에 schema를 확장하지 않는다"), 이번 STEP에서 schema를
건드리지 않았다.

## 6. Canonical Identity(§8)

`School.neisSchoolCode`(`SD_SCHUL_CODE`)를 canonical identity로
채택 — 학교명은 canonical key로 쓰지 않는다(schema에 unique 제약
없음, 실제로 "송정초등학교"가 서로 다른 코드로 2건 존재함이 확인돼
이 원칙의 필요성이 실측으로 입증됨, §33).

- **중복 audit**: 664건 유효 코드 중 **중복 0건**(`duplicateCodes: 0`,
  스크립트 실행 로그 + DB `GROUP BY neis_school_code HAVING count(*)>1`
  쿼리 결과 0행으로 재확인).
- **자동 merge 없음**: 같은 이름(송정초등학교)이라도 코드가 다르면
  별도 row로 유지(§8/§27 지시 그대로 — 실제 해운대구/강서구 별개
  학교였음, §33에서 상세).

## 7. School Level Normalization(§9)

**이름 접미사 기반 재분류를 하지 않는다** — `School.schoolLevel`에는
NEIS `SCHUL_KND_SC_NM` 원문을 그대로 저장한다(기존 `map/page.tsx`,
`school-detail-client.tsx`의 `classifySchoolLevel()`이 쓰는 이름
접미사 매칭 방식과 다른 경로 — School master는 애초에 신뢰할 수
있는 공식 필드를 그대로 갖고 있어 그 fallback이 필요 없다).

부산 664건의 원문 값 전체 분포(14종, 전부 실측):

```
초등학교 307건(개교예정 제외 305건 유효), 중학교 172건, 고등학교 142건,
방송통신고등학교 2건, 공동실습소 2건, 특수학교 16건, 고등기술학교 1건,
외국인학교 6건, 각종학교(고) 4건, 각종학교(중) 2건,
평생학교(고)-3년6학기 5건, 평생학교(고)-2년6학기 5건,
평생학교(중)-2년6학기 2건, 방송통신중학교 1건
```

리포트 집계 전용(저장 안 함) 5-버킷 요약: **ELEMENTARY 305 / MIDDLE
172 / HIGH 145 / SPECIAL 16 / OTHER 26** — 미분류(OTHER)로 빠지는
원문 값(공동실습소, 외국인학교)도 원문 자체는 DB에 그대로 남아
audit 가능하다(§9 지시 "알 수 없는 값은... 원문도 audit 가능하게").

## 8. Establishment/Gender Normalization(§10-11)

공식 필드(`FOND_SC_NM`, `COEDU_SC_NM`) 원문을 그대로 저장 —
"국립"/"공립"/"사립" 등 문자열을 추측해서 매핑하지 않는다. 값이
없으면(`null`) `School.establishmentType`/`genderType`도 `null`로
남긴다(UNKNOWN 강제 문자열 대입 없음).

## 9. 부산 Ingestion Scope(§12) — office-code 파라미터화

```
scripts/education/ingest-schools-neis.ts --office-code=C10
```

`C10`은 기본값일 뿐 하드코딩된 분기가 아니다 — 다른 시도를 수집하려면
`--office-code=<다른 교육청 코드>`만 바꾸면 된다(코드에 `if
(officeCode === 'C10')`류 분기 없음, 코드 리뷰로 확인).

## 10. 전국 확장 구조(§13) — NATIONWIDE_SCHOOL_ARCHITECTURE_READY = **YES**

- `fetchAllSchools(apiKey, officeCode)`는 office code를 인자로만
  받는다 — 부산 전용 parser/schema/enum/조건 분기가 코드 어디에도
  없다.
- 지역 매핑(`resolveSigunguCode`)도 "부산 16개 구·군 리스트"를
  하드코딩하지 않고, **공식 법정동코드 원본 파일(regcodes)을
  파라미터로 받아 그 안에 담긴 시군구를 그대로 매칭**한다 — 이
  파일을 전국판으로 교체하면 동일 함수가 전국 어디든 그대로
  동작한다(부산 16개만 들어있는 현재 파일은 "이번 실행 데이터"일
  뿐, 로직의 일부가 아니다).
- 이번 STEP에서 전국 실제 API 대량 호출은 하지 않았다(지시 그대로).

## 11. Region/Sigungu Mapping(§14) — 실측 이슈 1건 발견·수정

주소 문자열 substring 포함 매칭이 아니라, 공식 법정동코드 원본
(`scripts/redevelopment/_results/busan_regcodes_raw.json` — 기존
재개발 STEP에서 이미 검증된 파일, worktree에 로컬 복사)의 시군구
row와 **토큰 단위 정확 일치**로 매칭한다. 개발 중 실측으로 발견한
이슈:

- `ORG_RDNMA`가 "부산광역시" 전체 명칭 대신 **"부산"으로 축약**된
  사례 발견(부산솔빛학교: `"부산 사상구 백양대로 650 부산솔빛학교"`).
  최초 구현은 시도 전체 명칭만 인정해 이 1건을 놓쳤다 — 시도명에서
  "광역시/특별시/도" 등 접미사를 제거한 축약형도 토큰 일치로
  인정하도록 수정, 재검증 후 정상 해석 확인(§33 verify script에 이
  실측 사례 그대로 fixture로 포함).
- 다른 시도의 동명 구(예: 서울 "중구")와 섞이지 않도록 시도 토큰
  체크를 유지 — verify script에서 별도 assertion으로 확인.

## 12. 부산 16개 구·군 검증(§15)

| 구·군 | sigunguCode | count |
|---|---|---|
| 중구 | 26110 | 9 |
| 서구 | 26140 | 24 |
| 동구 | 26170 | 20 |
| 영도구 | 26200 | 28 |
| 부산진구 | 26230 | 66 |
| 동래구 | 26260 | 52 |
| 남구 | 26290 | 53 |
| 북구 | 26320 | 53 |
| 해운대구 | 26350 | 65 |
| 사하구 | 26380 | 58 |
| 금정구 | 26410 | 53 |
| 강서구 | 26440 | 45 |
| 연제구 | 26470 | 30 |
| 수영구 | 26500 | 22 |
| 사상구 | 26530 | 40 |
| 기장군 | 26710 | 39 |

16개 구·군 **전부 0건 없이 실데이터 확인**(0건을 자동 오류 처리하지
않는다는 지시와 무관하게, 실제로 전 구·군에 학교가 존재해 0건 사례
자체가 없었다). 합계 657 + 지역 미해석 7건 = 664(valid 전체).

## 13. Coordinates(§16)

`latitude`/`longitude`는 전부 `null`, `coordinateType`은 스키마
기본값 `UNKNOWN` 그대로 — Kakao 대량 geocoding을 하지 않았다(지시
그대로). 기존 request-time Kakao 코드(`/api/school/apartments`
등)도 손대지 않음.

## 14. School Code Retention(§17)

`School.neisSchoolCode`가 이제 DB에 영구 저장된다 — 기존
`/api/school`/`/school/[id]`가 겪던 "목록에서만 잠깐 쓰이고 상세
진입 시 버려지는" 문제(V1 §13)의 근본 해결 기반이 마련됐다. **단,
이번 STEP에서 production route/UI는 전혀 수정하지 않았다** — 실제
전환은 후속 STEP 범위.

## 15. isActive/폐교 처리(§18)

NEIS `schoolInfo` 응답 24개 필드 어디에도 운영/폐교 여부를 명확히
나타내는 공식 필드가 없다(실측 재확인). 임의로 `false`를 추정해
넣지 않았고, **`isActive`를 create/update payload 어디에도 명시하지
않아 스키마 기본값(`true`)에 위임**했다(어린이집 C3A와 동일 원칙).
향후 폐교/통폐합 refresh 시에도 hard delete 대신 `isActive=false` +
row 유지 방향을 원칙으로 문서화한다(§36).

## 16. Ingestion Script(§19)

`scripts/education/ingest-schools-neis.ts` — env validate → legal
gate(EducationSource CLEARED 확인) → office-code scope → NEIS
pagination fetch → normalize → validate → dry-run 지원 → upsert
School → progress/summary. `scripts/education/
register-neis-school-source.ts` — EducationSource 1회성 등록.
`scripts/education/verify-school-normalization.ts` — 정규화 로직
검증(§32).

## 17. Validation(§20)

`neisSchoolCode`/`schoolName` 필수 — 누락 시 skip + issue 기록(전체
ingestion 중단 안 함). **학교명 기반 임시 코드 생성 없음.** 부산
667건 중 invalid 3건 전부 "SD_SCHUL_CODE 공백"(개교 예정 학교) 사유로
정확히 분류됨.

## 18. Dry-run(§21) 결과

```
fetched: 667, valid: 664, invalid: 3, skipped: 3(=invalid와 동일 건),
duplicate schoolCode: 0
region resolved: 657, region unresolved: 7(전부 ORG_RDNMA=null, 실제 주소 데이터 자체가 없음)
```

coverage(dry-run 시점 미리보기 = 실제 ingestion 결과와 동일, §28):
schoolCode 100%(664/664), name 100%, schoolLevel 100%, address(roadAddress)
98.9%(657/664), sigungu mapping 98.9%(657/664), phone 100%, homepage
97.9%(650/664), gender 100%, establishment 100%.

## 19. 기존 667개교 Audit와 비교(§22)

V1 audit(BUSAN SCORE/SCHOOL AUDIT V1)이 실측한 "부산 667개교"와
**총량은 정확히 일치**(`list_total_count=667`, 변동 없음). 이번
STEP에서 새로 밝혀진 차이: **667 중 3건은 아직 개교하지 않은
예정 학교(SD_SCHUL_CODE 공백)** — V1은 `list_total_count`만 확인해
이 세부를 보지 못했다(V1 방법론의 한계이지 오류는 아님, pSize=1
검증 호출이라 애초에 이 3건을 만날 확률이 낮았음). **667을 강제
정답으로 취급하지 않고, 이번 실측(664 canonical + 3 future-school)이
더 정확한 현재 상태**라고 판단한다.

## 20. Actual Ingestion(§23) 결과

```
created: 664, updated: 0(최초 ingestion)
School 테이블: 664행
SchoolStat: 0행(의도적, §24)
```

## 21. SchoolStat(§24)

**신규 row 0건 — 정상.** 학생수/학급수/교원/졸업생 진로는 학교알리미
C2B 범위, 이번 STEP에서 손대지 않았다(DB 실측으로 재확인).

## 22. Idempotency(§25) — 부분 충족(정직하게 기록)

두 번째 실행 결과: `created: 0, updated: 664`. **`neisSchoolCode`
기준 중복 row는 확실히 0건**(DB `GROUP BY` 쿼리로 재확인, §6) —
"동일 identity로 재실행해도 중복이 생기지 않는다"는 핵심 안전성은
충족한다. 다만 **"데이터가 안 바뀌었으면 updated도 0"**이라는
이상적 기준(§25 원문 "또는 freshness skip")까지는 채우지 못했다 —
이 스크립트는 필드 단위 diff 없이 기존 row를 매번 그대로
재upsert한다(`updatedAt`이 매 실행마다 갱신됨). School에는
`ApartmentLocationFeature`류의 `validUntil` freshness 개념이 C1
schema에 없어 이번 STEP에서 새로 만들지 않았다(§13 "과도한
framework 생성 금지" 지시와 균형 — 필요성이 확인되면 후속 STEP에서
검토).

## 23. Resumability(§26)

이번 실행 규모(667건, 2페이지)에서는 중단 시나리오가 사실상 발생하지
않아 별도 checkpoint 구조를 만들지 않았다(§26 "과도한 framework
생성 금지"). `pIndex` 루프 자체는 이미 존재하는 방식(기존
`/api/school` route와 동일) — 재실행 시 처음부터 다시 받아도
idempotent upsert라 안전하다(§6/§25).

## 24. Duplicate/Identity Audit(§27)

- **duplicate neisSchoolCode**: 0건(원칙대로 0)
- **same schoolName, different code**: **1건 발견** — "송정초등학교"
  (해운대구 `7211058`, 강서구 `7201235`) — 실제 별개 학교로 확인,
  **자동 merge하지 않고 그대로 2개 row 유지**(§8/§27 지시 그대로)
- **same address, different code**: 별도 조사하지 않음(이번 STEP
  범위에서 발견된 anomaly 없음, roadAddress 문자열 단위 그룹핑은
  번지수 표기 차이로 오탐이 많아 이번 STEP에서는 schoolName 기준만
  실시)
- **same phone, different code**: 별도 조사하지 않음(우선순위상
  생략, 후속 STEP 후보)

## 25. Quality Audit(§28)

| 항목 | coverage |
|---|---|
| schoolCode | 664/664(100%) |
| schoolName | 664/664(100%) |
| schoolLevel | 664/664(100%) |
| address(roadAddress) | 657/664(98.9%) |
| sigunguCode | 657/664(98.9%) |
| phone | 664/664(100%) |
| homepage | 650/664(97.9%) |
| genderType | 664/664(100%) |
| establishmentType | 664/664(100%) |

필수 identity(schoolCode/schoolName) 누락 0건 — BLOCKER 없음. 나머지
누락은 전부 PARTIAL 허용 범위(source 자체에 값이 없는 경우, 특히
`ORG_RDNMA=null`인 7건).

## 26. Rate Limit/Retry(§29)

이번 실행은 2페이지(667건, pSize=500)뿐이라 rate limit에 도달하지
않았다. 기존 `/api/school` route와 동일하게 `res.ok` 실패 시 즉시
에러로 처리하고 무한 재시도하지 않는다 — 인증 오류(NEIS
`RESULT.CODE !== 'INFO-000'`)도 재시도 대상이 아니라 즉시 중단하도록
구현(어린이집 C3A와 동일 원칙).

## 27. Tests(§32) — 21개 assertion 전부 PASS

`scripts/education/verify-school-normalization.ts` — 2026-08-21
실측 fixture(개교예정 학교 공백코드, "부산"↔"부산광역시" 축약주소,
"http://" placeholder 등 실제 관찰된 케이스 그대로) 기준 검증.

## 28. tsc/lint/build(§33)

전부 PASS — 상세는 최종 보고 참고. 기존 warning 5건은 이번 변경과
무관(사전 존재).

## 29. 자동 갱신 전략(§36, 설계만)

```
NEIS schoolInfo(공식, 주기 "매주" 확인됨, §2)
  → 주기적 fetch(office-code 파라미터화된 이 스크립트 재사용)
  → neisSchoolCode 기준 upsert(이미 idempotent)
  → 신규 학교: create
  → 기존 학교 정보 변경: update(단, 현재는 diff 없이 항상 재기록 — §22 한계)
  → 폐교/통폐합: 공식 상태 필드가 없어 자동 판정 불가 — 목록에서
    사라진 neisSchoolCode를 감지해 "확인 필요"로 플래그하는 방식을
    후속 STEP에서 검토(hard delete 금지, isActive=false + history
    유지가 원칙)
  → audit
```

scheduler 구현은 이번 STEP에서 하지 않았다(지시 그대로).
