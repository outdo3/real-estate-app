# SCHOOL V2-C3A — Childcare Official Data Ingestion

**결과 요약(2026-08-21 BLOCKER RESOLUTION STEP 반영): BLOCKER 유지,
단 source selection은 확정.** 공식 source 실 endpoint/명세를 직접
확인했고, legal gate는 CLEARED로 확정했으며, ingestion 파이프라인
전체(fetch/normalize/validate/upsert/checkpoint/report)를 실제로 구현·
실행까지 했다. 그러나 이 API 전용 인증키가 없어(기존
`DATA_GO_KR_API_KEY`로 실 호출 테스트 결과 `INFO-100` 인증 실패 확인)
**부산 어린이집 실 데이터는 0건 그대로다** — Childcare/ChildcareStat 전부
row 0건, 가짜/추정 데이터 생성 없음.

**추가 조사(§21 이하) 결론**: "더 풍부한 필드(위경도/현원/교직원수/
CCTV/통학차량)를 가진 다른 공식 source가 있는가?"를 검증한 결과,
`전국어린이집표준데이터`(15013108)와 `한국사회보장정보원_어린이집
기본정보`(15083298)는 실제로는 **같은 원천**(`info.childcare.go.kr`의
"어린이집 기본정보" SHEET)을 가리키며, (1) REST API가 아니라 수동
UI 클릭이 필요해 자동화가 안 되고, (2) 원 제공처 문구("비영리목적")와
data.go.kr 카탈로그 문구("제한없음")가 서로 상충해 상업 서비스인
이집에 바로 쓸 라이선스 근거로 부족하다. **cpmsapi021이 여전히
유일하게 자동화 가능하고 라이선스가 명확한 primary source 후보다**
— 즉 "더 나은 대체 source가 있어 키 신청이 불필요하다"는 결론은
아니다. `CHILDCARE_API_KEY_APPLICATION_REQUIRED = YES`(§34).

## 0. 시작 상태

```
git status --short  → (없음, clean)
git rev-parse HEAD        = 82f49145df7fdbff2100cbd62418cb2db4cfe444
git rev-parse origin/main = 82f49145df7fdbff2100cbd62418cb2db4cfe444
```

## 1. 공식 source 재확인(§2)

SCHOOL V2-B에서는 정책 레벨(라이선스 문구, 필드 카테고리)까지만
확인했었다 — 이번 STEP에서 실제 **서비스 명세서(공식 문서, .doc)를
직접 다운로드해** endpoint/파라미터/응답 필드를 실측했다.

- **provider**: 제공기관 교육부, 관리기관(실무) 한국사회보장정보원
- **portal**: `info.childcare.go.kr`(어린이집정보공개포털) → 보육정보공개
  API → OPEN API → "전국 어린이집 정보 조회"
  (`OpenApiInfoSl.jsp`, 등록일 2014.03.07, 적재주기 **비정기(수시)**)
- **datasetId(공공데이터포털 카탈로그)**: `15101155`(한국사회보장정보원_
  전국 어린이집 정보 조회) — data.go.kr에서도 동일 서비스로 등록
- **endpoint(실측, 서비스 명세서 원문)**:
  `http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request`
  (오퍼레이션명 `cpmsapi021`, 개발/운영환경 URL 동일)
- **인증키 필요 여부**: 필요(`key` 파라미터, `string(32)`)
- **이용조건(원문 그대로 인용)**: *"저작자와 출처를 표시하면 영리목적의
  이용을 포함한 변경 및 자유이용을 허락합니다."*
- **상업적 이용**: **가능**(원문에 명시)
- **수정(가공) 가능 여부**: **가능**(원문에 "변경... 자유이용" 명시) —
  V2-B에서 우려했던 "학교알리미/유치원알리미처럼 API 경로가 변경금지일
  수 있다"는 패턴이 이 어린이집 API에는 해당하지 않음이 확인됨
- **호출 제한**: 명세서에 구체 수치 없음(data.go.kr 카탈로그도 "기관
  정책에 따라 상이"로만 표기) — `INFO-300`(일 요청 건수 초과) 에러코드
  존재는 확인, 정확한 한도는 미확인
- **pagination**: **없음** — 요청 파라미터가 `key`, `arcode`(시군구코드)
  뿐이고 페이지 파라미터 자체가 명세서에 없다. 즉 이 API는 **시군구
  단위로만 조회 가능하고, 전국/시도 단위 일괄 조회가 없다**(§8 지역
  범위 설계에 직접 영향)
- **전체/지역 필터**: `arcode`(시군구코드, `string(5)`) — 필수 파라미터,
  없으면 조회 불가(`ERROR-100`)
- **기준일/update field**: 명세서 응답 필드 표에는 없으나, 실제 예제
  응답에 `frstcnfmdt`(최초인가일자로 추정, YYYYMMDD)가 존재 — 명세서
  표와 실제 예제가 100% 일치하지 않는다(§5-3 참고)

## 2. Legal Gate(§3) — CLEARED

라이선스 원문이 상업적 이용·변경(가공) 모두 명시적으로 허용하고 있어
불명확한 지점이 없다 — `REVIEW_REQUIRED`로 남길 이유가 없다.

`EducationSource` 등록(실제 DB write, `scripts/education/
register-childcare-source.ts`):

```json
{
  "code": "childcare_national_api",
  "displayName": "전국 어린이집 정보(어린이집정보공개포털)",
  "provider": "한국사회보장정보원",
  "datasetId": "15101155",
  "sourceType": "API",
  "sourceUrl": "http://api.childcare.go.kr/mediate/rest/cpmsapi021/cpmsapi021/request",
  "licenseCode": "ATTRIBUTION_ONLY_FREE_USE",
  "attributionRequired": true,
  "commercialUseAllowed": true,
  "modificationAllowed": true,
  "legalReviewStatus": "CLEARED",
  "termsCheckedAt": "2026-08-21T03:06:56.486Z"
}
```

추정 없음 — 전부 위 §1에서 실측한 원문 근거 그대로.

## 3. 인증키(§4) — **BLOCKER**

- 기존 `.env.local`의 `DATA_GO_KR_API_KEY`(값 미출력)로 실제 1회 호출
  테스트(부산 서구, arcode=26140) → **`INFO-100: 인증키가 유효하지
  않습니다`** 반환. 이 키는 `apis.data.go.kr`(MOLIT/건축물대장 등
  기존 연동)용이며, `api.childcare.go.kr`은 **별도 도메인/별도
  활용신청 체계**라 재사용되지 않는 것으로 실측 확인됨.
- `info.childcare.go.kr` 자체 페이지 명시: 이 서비스는 **"승인심의
  (개발) 승인심의(운영)"** — 개발 단계부터 자동승인이 아니라 담당자
  검토가 필요하다(학교알리미의 "개발단계 자동승인"과 다른 패턴).
- 필요한 키: **`api.childcare.go.kr` cpmsapi021 전용 서비스키**(신규
  env var 이름 후보: `CHILDCARE_API_KEY`)
- 신청 위치: `info.childcare.go.kr` → 보육정보공개 API → OPEN API →
  "전국 어린이집 정보 조회" 상세 페이지(`OpenApiInfoSl.jsp`) 하단
  **"활용신청"** 버튼 → 개발계정 신청 → 담당자 승인 대기 → 운영계정
  전환 시 재승인
- **사용자 승인 없이 신규 계정/키를 신청하지 않았다.**

## 4. API Schema Sample Verification(§5)

공식 서비스 명세서(`OpenAPI서비스명세서_021_v1.0.doc`,
`info.childcare.go.kr/info/oais/common/FileDownload.jsp?flag=
OPENAPIFILE&svcseq=79`, 로그인 없이 다운로드 가능 — 문서 자체는
6페이지, 텍스트 추출됨)를 직접 열람해 확인.

### 요청 메시지 명세(원문)

| 항목명(영문) | 항목명(국문) | 타입 | 필수 |
|---|---|---|---|
| key | 인증키 | string(32) | 필수 |
| arcode | 시군구코드 | string(5) | 필수 |

### 응답 메시지 명세(원문 표)

| 항목명(영문) | 항목명(국문) | 타입 |
|---|---|---|
| stcode | 어린이집코드 | string(11) |
| crname | 어린이집명 | string(150) |
| crtelno | 전화번호 | string(15) |
| crfaxno | 팩스번호 | string(15) |
| craddr | 주소 | string(300) |
| crhome | URL | string(150) |
| crcapat | 정원 | number(9) |

### 실제 예제 응답(명세서 원문, 3건) — 표와 다른 점 발견

```xml
<response>
<item>
  <stcode>11200000070</stcode>
  <crname>구립 벽산어린이집</crname>
  <crtel>02-2296-3062</crtel>
  <crfax>02-2299-4736</crfax>
  <craddr>서울 성동구 금호동1가 632 벽산아파트금호벽산제2관리소2층</craddr>
  <crhome>없음</crhome>
  <crcapat>77</crcapat>
  <arcode>11200</arcode>
  <frstcnfmdt>20130521</frstcnfmdt>
</item>
...
</response>
```

**실측 불일치**: 응답 필드 표는 `crtelno`/`crfaxno`라고 적었지만 실제
예제 XML 태그는 `crtel`/`crfax`다. 또한 표에는 없는 `arcode`(시군구코드
회신), `frstcnfmdt`(추정: 최초인가일자)가 실제 예제에는 존재한다 —
**"명세서 표에 있다고 실제 응답 필드라고 단정하지 않고, 실제 예제
태그를 우선한다"** 원칙을 그대로 적용했다(§5 지시, ingestion
스크립트의 `normalizeRow`는 `crtel ?? crtelno`로 둘 다 받도록 방어
처리).

### §요청5 field-by-field 확인 결과

| 확인 대상 | 상태 | 비고 |
|---|---|---|
| 시설코드 | **CONFIRMED**(`stcode`) | |
| 어린이집명 | **CONFIRMED**(`crname`) | |
| 유형 | **NOT PROVIDED** | 이 오퍼레이션 응답에 없음 |
| 주소 | **CONFIRMED**(`craddr`) | 도로명/지번 구분 없는 단일 주소 문자열로 추정(명세서에 구분 없음) |
| 도로명주소 | **NOT PROVIDED** | `craddr` 하나뿐, 별도 도로명 필드 없음 |
| 시도 | **NOT PROVIDED**(직접) | `arcode`(시군구코드) 앞 2자리로 파생 가능(행정표준코드 체계 공개 규칙) |
| 시군구 | **CONFIRMED**(`arcode`) | |
| 위도 | **NOT PROVIDED** | |
| 경도 | **NOT PROVIDED** | |
| 정원 | **CONFIRMED**(`crcapat`) | |
| 현원 | **NOT PROVIDED** | |
| 보육교직원수 | **NOT PROVIDED** | |
| CCTV | **NOT PROVIDED** | |
| 통학차량 | **NOT PROVIDED** | |
| 운영상태 | **NOT PROVIDED** | |
| 기준일 | **PARTIAL** | `frstcnfmdt`(추정 최초인가일자) 존재하나 명세서 표에 정식 정의 없음 — 의미를 100% 확정하지 못해 이번 STEP에서는 저장하지 않음 |
| 수정일 | **NOT PROVIDED** | |

**중요**: SCHOOL V2-B 문서/웹 검색 합성 결과에서 언급됐던 "위도, 경도,
현원수, 보육교직원수, CCTV설치수, 통학차량운영여부" 등 풍부한 필드
목록은 **이 라이브 조회 API(cpmsapi021)의 실제 응답에는 없다** — 그
풍부한 필드 목록은 `전국어린이집표준데이터`(공공데이터포털
`15013108`, 표준데이터셋)의 **컬럼 설명**이며, 실제 배포 메커니즘(API
유형 "LINK")을 이번 조사에서 끝까지 확인하지 못했다(§13 참고). "문서에
있다고 API 필드로 바로 가정하지 않는다"는 원칙이 실제로 작동한
사례로 기록한다 — V2-B의 §3-2 "참고 수준으로 표기" 캐비어가 실제로
맞았다.

## 5. Field Mapping(§6)

| raw field | 목적지 | 분류 | 비고 |
|---|---|---|---|
| `stcode` | `Childcare.facilityCode` | **DIRECT** | canonical identity |
| `crname` | `Childcare.childcareName` | **DIRECT** | |
| `craddr` | `Childcare.address` | **DIRECT** | |
| `crtel`/`crtelno` | (없음) | **IGNORED** | C1 schema에 `Childcare.phone` 컬럼 없음 — 후속 migration 후보로만 기록 |
| `crfax`/`crfaxno` | (없음) | **IGNORED** | 동일 사유 |
| `crhome` | (없음) | **IGNORED** | C1 schema에 `Childcare.homepage` 컬럼 없음("없음" 문자열은 null로 정규화하는 로직은 구현/검증했으나 저장할 컬럼이 없어 저장 안 함) |
| `crcapat` | `ChildcareStat.capacity` | **DIRECT**(파싱) | 파싱 실패 시 null, 0으로 치환 안 함 |
| `arcode` | `Childcare.sigunguCode` | **DIRECT** | |
| `arcode`(앞 2자리) | `Childcare.sidoCode` | **NORMALIZED** | 행정표준코드 체계 규칙 적용(추정 아님) |
| `frstcnfmdt` | (없음) | **UNKNOWN** | 의미 미확정(명세서 정식 정의 없음) — 저장하지 않음 |
| (응답에 없음) | `Childcare.facilityType` | **UNKNOWN** | source가 제공 안 함 |
| (응답에 없음) | `Childcare.latitude`/`longitude` | **UNKNOWN** | source가 제공 안 함, 이번 STEP에서 Kakao geocoding 등 대체 보강도 하지 않음(라이브 데이터 자체가 없어 착수 불가) |
| (응답에 없음) | `Childcare.isActive` | 기본값 유지 | source에 운영상태 필드 없음 — Prisma 기본값 `true`(조회 API가 반환하는 row 자체가 현재 등록된 시설이라는 전제, §14 지시대로 무조건 임의 true를 코드로 강제 입력하지 않고 스키마 기본값에 위임) |
| (응답에 없음) | `ChildcareStat.enrollment`/`staffCount`/`cctvCount`/`hasShuttle` | **UNKNOWN** | source가 제공 안 함, null 유지 |

## 6. Canonical Identity(§7)

`Childcare.facilityCode`(`stcode`)를 canonical identity로 사용 —
설계 그대로. `stcode`가 없는 row가 있으면(명세서상 필수 필드라 정상
응답에서는 없어야 함) **이름+주소로 identity를 억지 생성하지 않고
skip + audit 기록**하도록 `normalizeRow`에 구현했다(`missing
facilityCode(stcode)` issue로 기록, DB write 안 함). 실제 라이브
데이터가 없어 이 경로가 실행된 사례는 이번 STEP에 없다(코드만 구현·
로직 검증 완료, §37 참고).

## 7. 지역 범위(§8) — 전국 확장 가능 구조

이 API 자체가 "시군구코드 하나씩만" 조회 가능한 구조라, **지역
범위는 "호출할 arcode 목록"으로 결정된다** — 코드 구조상
`BUSAN_DISTRICTS`라는 배열 하나를 넘겨 순회할 뿐이고, 다른 시도를
수집하려면 이 배열 대신 다른 지역 코드 배열을 넘기면 된다(하드코딩된
"부산 전용 분기" 없음). 이번 실행은 지시대로 **부산 16개 구·군만**
대상으로 했다.

**부산 16개 구·군 시군구코드**(기존 `scripts/redevelopment/
_results/busan_regcodes_raw.json` — 이전 STEP에서 이미 검증된 공식
법정동코드 원본에서 "시군구 단위 row"만 추출, 새로 만든 값 아님):

```
26110 중구, 26140 서구, 26170 동구, 26200 영도구, 26230 부산진구,
26260 동래구, 26290 남구, 26320 북구, 26350 해운대구, 26380 사하구,
26410 금정구, 26440 강서구, 26470 연제구, 26500 수영구, 26530 사상구,
26710 기장군
```

## 8. 부산 행정구역 검증(§9) — 실행 결과

**실제 데이터 수집은 1개 구(중구)에서 인증 실패로 즉시 중단됐다** —
나머지 15개 구·군은 호출조차 하지 않았다(동일 키로 반복 호출해봐야
같은 `INFO-100`만 반복되므로, 외부 서버에 불필요한 요청을 보내지
않기 위해 스크립트가 자동 중단하도록 설계함, §19). 16개 구·군 각각의
실제 coverage count는 **전부 0건**(수집 자체가 안 됨) — 이것이
"원본 source 문제"인지 "parser 문제"인지 조사한 결과: **원본
source(인증키) 문제이지 parser 문제가 아니다**. 근거: (1) 동일
요청을 명세서의 예제 파라미터(`arcode=11380`, 서울 강북구 추정) 조합
없이도 순수하게 재현 가능한 인증 오류이고, (2) 파서 자체는
§10(normalization 검증 스크립트)에서 명세서 실제 예제 XML 3건을
100% 정확히 파싱함을 별도로 확인했다.

## 9. Childcare / ChildcareStat 실제 매핑 코드(§10-11)

구현: `scripts/education/ingest-childcare.ts` — mapping은 §5 표
그대로. `referenceDate`는 source가 기준일을 안 주므로 **수집일**을
쓰고(§11 지시 "fetchedAt을 source 기준일처럼 사용하지 말 것"의 취지를
살려 `sourceUpdatedAt`은 null로 남기고 `referenceDate`만 수집일로
명시), `capacity` 외 `ChildcareStat`의 나머지 후보 필드(enrollment/
staffCount/cctvCount/hasShuttle)는 전부 null로 남긴다(§6 표).

## 10. 0/null/Boolean semantics 검증(§12-13)

`scripts/education/verify-childcare-normalization.ts`로 명세서 실제
예제 3건 + 경계값(빈 문자열/undefined/"0"/숫자 아닌 문자열)을 대조
검증 — **전부 PASS**:

- `crcapat="77"` → `77`(정상 파싱)
- `crcapat=undefined`/`""` → `null`(0으로 치환 안 함)
- `crcapat="0"` → `0`(실제 0은 실제 0으로 저장, null과 구분)
- `crcapat="N/A"`(숫자 아님) → `null`(parse 실패를 0으로 치환하지
  않음, §12 지시 그대로)
- `crhome="없음"`/`""` → `null`("없음"이라는 문자열 placeholder를
  실제 URL처럼 저장하지 않음)
- `crhome="arimkids.kidwon.com"` → 그대로 보존

Boolean normalization(§13, 예: 통학차량 Y/N)은 **이 오퍼레이션 응답에
해당 필드 자체가 없어 이번 STEP에서 실제 정규화 대상이 없었다** —
로직은 향후 다른 source(예: 전국어린이집표준데이터의 통학차량운영
여부)를 붙일 때 별도 구현 필요.

## 11. Active Status(§14)

명세서 응답에 운영상태 필드가 없다. `Childcare.isActive`는 C1
schema에서 이미 `Boolean @default(true)`(NOT NULL)로 고정돼 있어
이번 STEP에서 임의로 코드가 `true`를 강제 입력하지 않고 **스키마
기본값에 위임**했다 — "공식 상태 필드가 없다고 무조건 코드에서 true를
넣지 말 것"이라는 지시를 어기지 않기 위해, ingestion 코드 자체에는
`isActive` 필드를 아예 언급하지 않는다(생성 시 자동으로 기본값 적용,
갱신 시에도 건드리지 않음). 실 데이터가 없어 이 경로는 라이브
검증되지 않았다.

## 12. EducationSource Relation(§15)

`ChildcareStat.sourceId` → `EducationSource(code=
'childcare_national_api')`(id=1, 실제 DB row) 참조하도록 구현. `
sourceRecordId`는 이 오퍼레이션 응답에 별도 레코드ID가 없어(응답
자체가 `stcode`로 식별 가능해 별도 필드 불필요) 채우지 않는다(null).

## 13. Ingestion Script(§16)

- `scripts/education/register-childcare-source.ts` — `EducationSource`
  1회성 등록(governance, ingestion과 분리)
- `scripts/education/ingest-childcare.ts` — fetch(district별)→
  normalize→validate→identity match→upsert core→upsert stat→
  progress log→최종 summary. `--dry-run`(§21)/`--force` 지원.
  UI/route 코드는 전혀 건드리지 않음(순수 CLI 스크립트).

## 14. Idempotency / Resumability(§17-18)

- `Childcare.facilityCode` unique, `ChildcareStat`
  `[childcareId, sourceId, referenceDate]` unique — 재실행 시
  `upsert`가 create/update를 자동 분기하도록 구현(코드 레벨 확인 완료).
- resumability: 인증 실패 감지 시 즉시 중단(§8) — 재실행 시 처음부터
  다시 시도하는 구조이며(이번 STEP 규모에서는 시군구 16개뿐이라
  page-level checkpoint 같은 복잡한 구조는 만들지 않음, §18 "너무
  복잡한 신규 framework 만들지 않는다" 지시 반영), 향후 전국 확장
  시(약 250개 시군구) 시군구 단위 재시작만으로 충분할 것으로 판단.
- **실제 재실행(idempotency 2회차) 테스트는 라이브 데이터가 없어
  수행하지 못했다** — §28 참고.

## 15. Rate Limit(§19)

- district 호출 사이 300ms pacing(Kakao 기존 관례 150ms보다 보수적 —
  이 API의 실측 rate limit이 확인된 바 없어 안전 측으로 설정)
- `INFO-100`/`INFO-400`(인증 오류)은 재시도 대상이 아니라고 판단해
  즉시 중단(무의미한 반복 호출 방지) — 네트워크 오류/5xx는 exponential
  backoff로 최대 2회 재시도
- 실제 429/`INFO-300`(일 요청 초과)은 이번 STEP에서 발생하지 않음
  (인증 단계에서 이미 막혀 트래픽 한도까지 도달하지 못함)

## 16. Validation(§20)

`normalizeRow`에서 `stcode`/`crname` 필수 검증 — 없으면 skip +
`issues` 배열에 기록(치명적 schema 오류가 아니므로 전체 ingestion을
중단하지 않음). `crcapat` 등 숫자 필드는 파싱 실패 시 null(§10).
lat/lng range 검증은 source에 좌표 자체가 없어 이번 STEP에서 대상이
없다.

## 17. Coverage 결과(§21-29 — 전부 0건, 원인: BLOCKER)

| 항목 | 결과 |
|---|---|
| dry-run fetched | 0(1개 구 시도 후 인증 실패로 중단) |
| 실제 ingestion fetched | 0 |
| Busan rows | 0 |
| valid/invalid rows | 0/0 |
| Childcare DB rows | 0 |
| ChildcareStat DB rows | 0 |
| district별 count | 16개 구·군 전부 0(1개 구만 시도, 나머지 15개는 호출 자체 안 함) |
| coordinate/capacity/enrollment/staff/CCTV/shuttle coverage | 전부 해당 없음(수집 데이터 자체가 없음) |
| duplicates | 0건(에초에 write가 없어 중복 발생 여지 없음) |
| second run idempotency test | **미실행**(라이브 데이터 없이는 의미 있는 재검증 불가) |

## 18. District Readiness(§26)

16개 구·군 전부 **BLOCKED**(인증키 문제, source/parser 문제 아님) —
§9 근거 그대로. 키 확보 즉시 전부 재시도 가능한 상태(코드는 이미
완성).

## 19. 후속 필요 사항(§13 관련, schema 변경 STOP 대상)

C1 schema로 이번 STEP의 **핵심 목표(canonical identity + 정원)는
충분**했다 — `facilityCode`/`childcareName`/`address`/`sidoCode`/
`sigunguCode`/`capacity`는 전부 기존 컬럼으로 저장 가능해 **schema
변경 없이 진행했다**(§33 지시 준수, 실제로 migration 0건). 다만 다음은
**BLOCKER는 아니지만** 향후 schema 확장 후보로 명확히 기록한다(임의로
지금 추가하지 않음):

- `Childcare.phone`, `Childcare.homepage` — source에 실제 있으나
  C1 schema에 컬럼 없음(IGNORED로 처리, §5)
- 위경도/현원/교직원수/CCTV/통학차량은 이 API 자체에 없어 schema
  문제가 아니라 **source 문제** — 전국어린이집표준데이터(15013108)의
  실제 배포 경로(§4 "API 유형 LINK") 확인이 선행돼야 함(별도 조사
  후보)

## 20. Documentation & Verification

- `scripts/education/verify-childcare-normalization.ts` 실행 결과:
  **17개 assertion 전부 PASS**(§10 인용)
- `tsc --noEmit`: 0 errors
- `eslint`: 0 errors(기존 무관 warning 5건만, 신규 파일 warning 0건)
- `next build`: 성공, 기존 `/api/school*` 라우트/UI 변경 없음 확인

---

# SCHOOL V2-C3A BLOCKER RESOLUTION(2026-08-21 추가)

## 21. 15013108 공식 source 확인

`data.go.kr/data/15013108/standard.do`("전국어린이집표준데이터") 직접
재확인:

- **설명/필드 목록**: 시도, 시군구, 어린이집명, 어린이집유형구분,
  운영현황, 우편번호, 주소, 어린이집전화번호, 어린이집팩스번호,
  보육실수, 보육실면적, 놀이터수, CCTV설치수, 보육교직원수, 정원수,
  **현원수, 위도, 경도**, 통학차량운영여부, 홈페이지주소, 인가일자,
  휴지시작일자, 휴지종료일자, 폐지일자(사용자가 제시한 목록과 100%
  일치, 이번에 재확인)
- **API 유형**: `LINK`(data.go.kr이 직접 서비스하는 게 아니라 외부
  제공처로 연결만 함)
- **오픈 API 정보 탭**이 실제로 가리키는 대상: `OpenAPI 명 =
  한국사회보장정보원_어린이집 정보`(=`data.go.kr/data/3065251/openapi.do`)
- **이용허락범위**: "공공저작물 : 출처표시 (제 1유형)"
- **심의유형**: 개발단계 자동승인 / 운영단계 자동승인
- **소관기관**: 교육부, **제공기관**: 한국사회보장정보원
- 페이지 자체에 "다운로드" 버튼은 없음(§22에서 실제 배포 경로 추적)

## 22. 15013108 인증 방식 실검증

`3065251`(15013108이 가리키는 실제 API 등록)을 열람:

- **API 유형**: `LINK`, **데이터 포맷**: XML, **활용신청 수**: 11,753
  (실사용 많음)
- **이용허락범위**: "공공저작물 : 출처표시 (제 1유형)", **심의유형**:
  개발단계 자동승인 / 운영단계 자동승인
- 이 페이지의 "이 데이터와 유사한 데이터"에 **"한국사회보장정보원_
  어린이집 기본정보"(파일데이터, =15083298)로의 링크**가 있음 —
  즉 이 LINK-type API의 실체는 15083298과 동일 원천으로 이어진다.
- `data.go.kr`에서 직접 "활용신청" 대화상자(프로젝트 서비스키 선택
  화면)까지는 열렸으나, **실제 요청 URL/파라미터가 이 페이지 어디에도
  노출돼 있지 않다** — LINK형이라 data.go.kr 자체는 이 데이터를
  중계하지 않고 발급된 서비스키를 제공처(`info.childcare.go.kr`)
  쪽에서 어떻게 쓰는지는 별도 안내가 없음.
- **결론(분류)**: **D. LINK 방식/별도 활용신청 필요** — A(기존
  `DATA_GO_KR_API_KEY` 재사용 가능)로 단정할 근거가 없다. 실제 sample
  request를 시도할 구체적 endpoint 자체를 이번 조사에서 확보하지
  못했다(§23에서 실체를 추적한 결과 REST endpoint가 아니라 수동
  UI로 귀결됨 — 애초에 "샘플 요청"이 성립하지 않는 구조).
- 기존 cpmsapi021의 `INFO-100`과는 **다른 문제**다 — cpmsapi021은
  "요청은 도달했으나 인증키가 틀림"이었고, 15013108/3065251은 "요청을
  보낼 구체적 REST endpoint 자체가 확인되지 않음"(ENDPOINT_NOT_AVAILABLE
  에 더 가까움, §41 분류표 참고).

## 23. 15083298 공식 파일데이터 확인

`data.go.kr/data/15083298/fileData.do`("한국사회보장정보원_어린이집
기본정보") 직접 확인:

- **실제 다운로드 경로**: 페이지의 `URL` 필드가
  `http://info.childcare.go.kr/info/oais/openapi/OpenApiSlL.jsp`
  (=OPEN API **목록** 페이지)로만 적혀 있음 — **직접 파일 URL이
  아니다.**
- **"기타 유의사항"(원문 그대로 인용, 매우 중요)**: *"해당 페이지에서
  어린이집 기본정보 클릭 → 어린이집 지역 선택 후 검색 → 파일저장을
  통해 CSV형태의 엑셀파일로 다운로드 가능합니다."* — **수동 UI
  조작이 필수**임을 data.go.kr 스스로 명시.
- **제공형태**: "기관자체에서 다운로드(제공데이터URL기재)"
- **파일 형식**: 매체유형 텍스트, **확장자 XLS**
- **로그인/별도 인증 필요 여부**: 이 SHEET 자체는 로그인 없이 접근
  가능해 보이나(페이지 텍스트상 로그인 요구 문구 없음), 실제로 CSV를
  받으려면 지역+기준년월을 선택하고 "검색" 버튼을 눌러야 하는 **UI
  상호작용이 필수** — 단순 HTTP GET으로 안 됨.
- **업데이트 주기**: "수시 (자동 갱신)" — 단, 이는 정부 내부 DB
  갱신 주기를 말하는 것으로 보이며, 최종 사용자가 파일을 받는
  과정은 여전히 수동이다.
- **수정일**: 2025-08-11
- **이용허락범위(data.go.kr 카탈로그 기록)**: **"이용허락범위 제한
  없음"** — §24 라이선스 상충 참고

## 24. 원 제공처 vs data.go.kr 카탈로그 — 라이선스 상충(중요 발견)

`info.childcare.go.kr`의 실제 "어린이집 기본정보" SHEET 페이지
(`OpenApiInfoSl.jsp`, 클릭해 직접 확인)에 적힌 원문:

> **이용허락조건**: "저작자와 출처를 표시하면 **비영리목적**의 변경
> 및 자유이용을 허락합니다."

data.go.kr의 15083298 카탈로그 기록:

> **이용허락범위**: "이용허락범위 **제한 없음**"

**두 공식 페이지가 같은 데이터에 대해 서로 다른 이용조건을 표시하고
있다.** 상업 서비스인 이집 입장에서는 원 제공처(데이터를 실제로
만들고 배포하는 기관, `info.childcare.go.kr`)가 데이터 접근 시점에
직접 보여주는 문구가 data.go.kr의 일반 카탈로그 분류보다 더
구체적이고 권위 있다고 판단해, **"제한없음"으로 임의로 유리하게
해석하지 않는다.** `EducationSource(code='childcare_national_sheet')`에
`commercialUseAllowed = null`(UNKNOWN), `legalReviewStatus =
REVIEW_REQUIRED`로 등록했다(§29). CLEARED로 임의 승격하지 않았다.

## 25. 실제 field schema 확인(§6 요청 항목별)

15013108/3065251/15083298 세 페이지의 설명 문구가 서로 100% 동일한
필드 목록을 반복 기재하고 있어 **문서상으로는 AVAILABLE**로 보이나,
**실제 파일 header/sample row를 직접 다운로드해 대조하지는
못했다**(§24 라이선스 상충 미해소 상태에서 실 데이터를 받는 것 자체를
보류) — 아래는 "문서 기재 AVAILABLE" ≠ "실측 CONFIRMED"임을 명확히
구분해 표기한다.

| 항목 | 상태 |
|---|---|
| facilityCode(시설코드) | **UNKNOWN** — 세 페이지의 설명 문구 어디에도 "시설코드"가 명시적으로 나열되지 않음(cpmsapi021의 `stcode`와 달리) — 있을 수도 있으나 확인되지 않음. §26 참고 |
| childcareName | 문서 기재 AVAILABLE(어린이집명) — 실측 미확인 |
| facilityType | 문서 기재 AVAILABLE(어린이집유형구분) — 실측 미확인 |
| operatingStatus | 문서 기재 AVAILABLE(운영현황) — 실측 미확인 |
| address | 문서 기재 AVAILABLE(주소, 우편번호 별도) — 실측 미확인 |
| roadAddress | **NOT_AVAILABLE**(문서 설명에 "주소"만 있고 도로명/지번 구분 언급 없음) |
| sidoCode/sidoName | 문서 기재 AVAILABLE(시도, 텍스트명으로 추정 — 코드 형태인지 명칭 텍스트인지 미확인) |
| sigunguCode/sigunguName | 문서 기재 AVAILABLE(시군구, 동일 사유로 형태 미확인) |
| latitude/longitude | 문서 기재 AVAILABLE(위도, 경도) — 실측 미확인, **공식 provider 좌표인지 별도 지오코딩 결과인지도 미확인**(§27) |
| capacity | 문서 기재 AVAILABLE(정원수) |
| enrollment | 문서 기재 AVAILABLE(현원수) — cpmsapi021엔 없는 값 |
| staffCount | 문서 기재 AVAILABLE(보육교직원수) |
| cctvCount | 문서 기재 AVAILABLE(CCTV설치수) |
| hasShuttle | 문서 기재 AVAILABLE(통학차량운영여부) — 원본 raw 값(Y/N인지 운영/미운영인지)은 미확인 |
| phone/fax | 문서 기재 AVAILABLE |
| homepage | 문서 기재 AVAILABLE(홈페이지주소) |
| approvalDate | 문서 기재 AVAILABLE(인가일자) |
| suspensionStartDate/EndDate | 문서 기재 AVAILABLE(휴지시작/종료일자) |
| closureDate | 문서 기재 AVAILABLE(폐지일자) |
| sourceUpdatedDate/dataReferenceDate | **NOT_AVAILABLE**(문서 설명 목록에 없음, "수정일"은 데이터셋 메타데이터 수정일이지 row별 기준일이 아님) |

## 26. facilityCode 특별 확인 — 결과: UNKNOWN(§7 지시대로 억지 identity 생성 안 함)

15013108/3065251/15083298 세 곳 어디에도 "시설코드"라는 단어가 필드
설명에 나오지 않는다. cpmsapi021의 `stcode`("어린이집코드")처럼
명시적 식별자 필드가 있다는 확증을 얻지 못했다 — **있을 가능성은
있으나(정부가 관리하는 시설 데이터에 내부 코드가 없을 가능성은
낮다는 상식적 추정은 가능하지만, 이건 추정일 뿐 확인이 아니다)**,
이번 조사로 CONFIRMED 처리하지 않는다. 만약 이 source를 실제로
채택한다면 **이름+주소로 canonical key를 자동 생성하지 않고**, 실
파일을 받아 header를 확인한 뒤 별도로 CHANGE REQUEST를 보고해야
한다 — 이번 STEP에서는 채택하지 않으므로 이 결정 자체는 보류
상태로 남긴다.

## 27. 좌표 품질 — 확인 안 됨

문서 설명에 "위도, 경도"가 나열돼 있으나, 이것이 (a) 어린이집
등록 시 기관이 직접 신고한 공식 좌표인지, (b) 주소를 별도
지오코딩해서 채운 값인지, (c) 정문/출입구 좌표인지 중심좌표인지
**어느 페이지에도 명시돼 있지 않다.** 실 파일을 받아보지 않는 한
`coordinateType`을 `OFFICIAL_POINT`로 단정할 근거가 없다 — 채택
시에도 우선 `UNKNOWN` 또는 `ADDRESS_GEOCODE`(주소 좌표일 가능성이
더 높다고 보수적으로 가정)로 두고, provider에 직접 문의해 확인되면
승격하는 방향을 권고한다. **ENTRANCE로 추정하지 않았다.**

## 28. cpmsapi021 vs 15013108/15083298 비교(§9)

| | **cpmsapi021**(전국 어린이집 정보조회) | **15013108/15083298**(어린이집 기본정보 SHEET) |
|---|---|---|
| SOURCE | REST API, 실제 endpoint 확인됨 | SHEET(수동 UI), REST endpoint 미확인 |
| IDENTITY | `stcode` CONFIRMED | UNKNOWN(§26) |
| COORDINATES | 없음(NOT_AVAILABLE) | 있다고 문서 기재, 실측/의미 미확인 |
| FACILITY TYPE | 없음 | 있다고 문서 기재 |
| OPERATING STATUS | 없음 | 있다고 문서 기재 |
| CAPACITY | **CONFIRMED**(`crcapat`) | 있다고 문서 기재 |
| ENROLLMENT | 없음 | 있다고 문서 기재 |
| STAFF | 없음 | 있다고 문서 기재 |
| CCTV | 없음 | 있다고 문서 기재 |
| SHUTTLE | 없음 | 있다고 문서 기재 |
| PHONE | **CONFIRMED**(`crtel`) | 있다고 문서 기재 |
| HOMEPAGE | **CONFIRMED**(`crhome`) | 있다고 문서 기재 |
| APPROVAL DATE | 명세서 표엔 없으나 예제엔 있음(의미 불확실) | 있다고 문서 기재 |
| UPDATE FREQUENCY | 비정기(수시) | "수시(자동 갱신)" — 단 사용자 수령은 수동 |
| AUTH FRICTION | **HIGH**(전용 키, 승인심의 양단계) | **UNKNOWN**(REST 경로 자체가 불명확) |
| LICENSE | **명확, 상업+가공 허용**(원문 확인) | **상충**(원 제공처 비영리 vs 카탈로그 제한없음) |
| COMMERCIAL USE | **가능(명확)** | **UNKNOWN(상충)** |
| AUTOMATION | **가능**(REST, 자동화 완성) | **불가**(수동 UI 클릭 필요, data.go.kr 자체 안내) |
| NATIONWIDE COVERAGE | 가능(시군구 순회, ~250회) | 가능(지역 드롭다운에 17개 시도 전부 있음) — 단 수동 |

## 29. Source Architecture Options(§10) — 최종 추천: **Option A**

| 옵션 | 평가 |
|---|---|
| A. cpmsapi021 단독 | **추천**. official authority HIGH, identity CONFIRMED, license 명확, automation 가능, 다만 field richness는 LOW(정원만) — 그러나 "확실히 자동화·상업이용 가능한" 유일한 후보 |
| B. 15013108 단독 | REJECT — REST endpoint 미확인, license 상충 |
| C. 15083298 파일 단독 | REJECT — 수동 다운로드 필수(운영 리스크 HIGH), license 상충, identity 미확인 |
| D. B/C를 primary + cpmsapi021 secondary | REJECT — B/C가 애초에 CLEARED가 아니라 primary 자격 없음. legal review로 향후 상충이 해소되면 그때 secondary(보완) 후보로 재검토 가능(§30) |

**최종 추천: Option A(cpmsapi021 단독을 primary로 유지)**. field
richness가 낮다는 한계는 인정하지만, "확인 가능한 legal clarity +
automation" 두 조건을 동시에 만족하는 유일한 source다. 더 풍부한
데이터를 위해 불확실한 라이선스의 수동 source로 primary를 바꾸는
것은 이 프로젝트의 "official source only, no guessing" 원칙에
어긋난다.

## 30. Primary/Secondary 원칙 및 Source-of-truth(§11)

- **Primary**: `cpmsapi021`(`code=childcare_national_api`,
  CLEARED) — facilityCode/childcareName/address/capacity/phone/
  homepage/sigunguCode의 source of truth.
- **Secondary 후보(현재 비활성)**: `childcare_national_sheet`
  (`code=childcare_national_sheet`, REVIEW_REQUIRED) — 라이선스
  상충이 인간 법무 검토로 해소되고, 실제 파일 header 확인으로
  facilityCode 존재가 CONFIRMED되면, **primary가 이미 가진
  facilityCode 매칭 기준으로만** capacity 외 필드(위경도/현원/
  교직원/CCTV/통학차량)를 보완하는 방식을 향후 검토 후보로 남긴다.
  같은 필드(예: capacity)를 두 source가 동시에 제공하면 **primary
  값을 silent overwrite하지 않고** conflict flag를 남기는 방향을
  원칙으로 삼는다(SCHOOL V2-C 설계문서 §10 source conflict rules와
  동일 원칙 재사용).
- 이번 STEP에서 secondary를 실제로 활성화하지 않았다 — 원칙만
  문서화.

## 31. 기존 ingestion script 영향(§12) — **KEEP(+소폭 ADAPT)**

`scripts/education/ingest-childcare.ts`를 새로 작성하지 않고 그대로
유지했다 — source 자체가 바뀌지 않았기 때문(§29 결론). 재사용 확인된
부분: facilityCode validation, null/0 처리(`parseCountField`),
boolean 정규화 로직 자리(`crhome` "없음" 처리), region scope 분리,
retry/backoff, audit summary(issues 배열), idempotent upsert
구조 — 전부 그대로. **ADAPT한 부분**: §16 지시대로
`--sigungu=<코드>` CLI 옵션을 추가해 지역 범위를 하드코딩에서
파라미터로 분리했다(§32).

## 32. 전국 확장 구조(§16-17) — NATIONWIDE_ARCHITECTURE_READY = **YES**(조건부)

- `BUSAN_DISTRICTS` 배열은 기존 재개발 STEP에서 이미 검증된 공식
  법정동코드 원본(`scripts/redevelopment/_results/busan_regcodes_raw.json`)
  에서 파생한 **부산 전용 데이터일 뿐**이고, 코드 로직 자체(`for (const
  district of targetDistricts)`, `fetchDistrict(apiKey, districtCode)`)
  에는 부산이라는 문자열이 등장하지 않는다 — `if (지역 === '부산')`
  류 분기 없음(§17 금지 사항 준수 확인).
- 이번 STEP에서 `--sigungu=<code>` CLI 옵션을 추가해 임의의 단일
  시군구코드로 즉시 재사용 가능함을 코드 레벨로 보강했다.
  `--region-name=`은 로그 표기용 선택 옵션.
- **조건부 YES인 이유**: 전국 300여 개 시군구를 한 번에 순회하는
  `--all` 옵션 자체는 이번 STEP에서 만들지 않았다(지시 §16 "전국
  대량 ingestion은 이번 STEP에서 하지 않는다"와 상충하지 않기 위해
  의도적으로 보류) — 구조는 준비됐으나 "전국 목록을 실제로 로드해
  자동 loop"하는 마지막 조립은 SCHOOL V2-C3A-NATIONWIDE에서 하도록
  남겨뒀다.

## 33. 부산 Dry-run/실제 ingestion(§19-20) — 실행 불가(동일 BLOCKER)

Primary source(cpmsapi021)가 여전히 인증키 문제로 막혀 있어(§3),
dry-run/실제 ingestion 모두 이번 STEP에서 재실행하지 않았다 — 직전
STEP(§8-9)에서 이미 1개 구 시도 후 `INFO-100`으로 중단되는 것을
확인했고, 상황이 바뀌지 않아 반복 호출하지 않았다(§19 지시 "429
시 무한 재시도 금지"와 같은 정신 — 이미 답을 아는 호출을 반복하지
않음).

## 34. CHILDCARE_API_KEY_APPLICATION_REQUIRED(§39) — **YES**

15013108/15083298이 "더 적합한 대체 source"였다면 NO로 결론 내릴
계획이었으나, 실제로는 (1) REST 접근 경로 자체가 불명확하고, (2)
라이선스가 상업 이용 관점에서 상충하며, (3) identity(facilityCode)
존재도 미확인이라 **핵심 데이터를 안정적으로 확보할 대체 수단이
되지 못한다.** cpmsapi021 전용 키 활용신청이 여전히 필요하다 —
신청 위치는 §3과 동일(`info.childcare.go.kr` → OPEN API → 전국
어린이집 정보 조회 → 활용신청). **사용자 승인 없이는 신청하지
않았다.**

## 35. EducationSource 최종 상태

| id | code | legalReviewStatus | 역할 |
|---|---|---|---|
| 1 | `childcare_national_api` | **CLEARED** | primary(§29) |
| 2 | `childcare_national_sheet` | **REVIEW_REQUIRED** | secondary 후보, 현재 비활성(§30) |

기존 row(id=1) 삭제/변경 없음 — 신규 row만 추가(§15/§42 지시 준수).
