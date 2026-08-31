# APARTMENT OFFICIAL BASIC INFO SOURCE AUDIT V1

## 1. Goal

`ApartmentMaster`의 secondary metadata(특히 `totalHouseholds`)는 현재
건축물대장(총괄표제부/표제부) 기반이며, `MASTER_HOUSEHOLD_VERIFICATION_V1`
에서 이미 확인된 대로 다동 복합단지의 표제부 fallback이 "동 1개"의
값을 "단지 전체"로 오인할 구조적 위험을 안고 있다(경동마리나 사례,
`26350-2`, 실제 표제부 hhldCnt=72가 892세대 단지의 103동 값이었음).

이번 STEP은 사용자가 공공데이터포털에서 활용신청한
**국토교통부_공동주택 기본 정보제공 서비스**(최종 확인된 공식 버전은
`AptBasisInfoServiceV5` — §6-C 참고, 초기에는 `V3`로 잘못 추정했었다)가
이 문제의 authoritative fix가 될 수 있는지 **검증만** 한다.
Production `ApartmentMaster`는 이번 STEP에서 절대 수정하지 않는다.

## 2. Pre-flight — 3,403 → 3,400

`MASTER_COVERAGE_SYNC_V1` 완료 시점(3,400/3,400) 재확인 결과, window는
여전히 100.00%(missing=0)다. 3,403(`MASTER_MISSING_REPAIR_V1` 완료
시점) → 3,400 차이의 원인을 배치 read-only 쿼리로 직접 확인했다:

- 두 측정 모두 같은 날(2026-08-31, `+0900`)에 실행됐고 window 계산식
  (`24 * 30 * 24 * 3600 * 1000`)도 두 스크립트에서 완전히 동일 — 단순
  시:분 차이만으로는 같은 달력일의 경계가 바뀌지 않는다(경계일 자정
  기준 dealDate 비교는 두 실행 모두 동일하게 처리됨), 그래서 "단순
  rolling window 오차"만으로는 설명되지 않는다는 것을 먼저 확인.
- 실제 원인: `dealCanceled: false` 조건을 빼고 다시 집계하면 부산
  최근 24개월 distinct aptSeq가 3,400 → **3,404**로 늘어난다. 그 차이
  4건(`26170-642`/`26500-58`/`26170-12`/`26290-251`)은 전부 window 내
  유일한 거래가 `dealCanceled=true`로 바뀐 건이며, `updatedAt`이 전부
  **2026-08-30 12:23~12:34**(이 STEP 실행 하루 전)이다 — 기존
  `TRADE_CANCELLATION_RESYNC_V1` 파이프라인이 정상적으로 취소 처리한
  결과다.
- 검증에 쓴 스크립트는 1회성 진단용으로 실행 후 삭제했다(read-only,
  DB write 없음, 커밋 안 함 — 재현이 필요하면 동일 쿼리를
  `apartmentTradeHistory.groupBy` + `dealCanceled` 포함/제외 비교로
  재구성 가능).

**판정: `EXPECTED_ROLLING_WINDOW_CHANGE`**(정확히는 기존
취소 재동기화 파이프라인의 정상 동작) — query bug, 데이터 손실
아님. 본 작업 계속 진행.

## 3. 기존 코드베이스 Audit

기존 공동주택/건축물대장 관련 코드를 전수 조사했다(재사용 우선):

- **K-APT는 이미 시도되고 거부됐다.** `MASTER_HOUSEHOLD_VERIFICATION_V1`
  §6이 이미 `AptListService3/getSigunguAptList`,
  `AptListService/getSigunguAptList`, `AptListService2/getLegaldongAptList`,
  **`AptBasisInfoServiceV3/getAphusBassInfoV3`**(이번 STEP의 타겟과
  동일 endpoint) 4개 변형을 `DATA_GO_KR_API_KEY`로 시도해 전부
  `NO_OPENAPI_SERVICE_ERROR`를 받았다고 기록돼 있다(§6 참고).
- `src/lib/apt-building-info.ts` — 건축물대장(`BldRgstHubService`)
  클라이언트. `getBrRecapTitleInfo`(총괄표제부, 1순위) →
  `getBrTitleInfo`(표제부, 지번당 정확히 1건일 때만 fallback) 구조.
  `isNumberedBuildingUnit()`(정규식 `/^제?\d+동$/`)이
  `SINGLE_BUILDING_AS_COMPLEX` 가드 — `dongNm`이 "103동"처럼 구체적
  동번호면 표제부 1건이어도 단지 전체값으로 신뢰하지 않는다. 재사용
  가능한 exports: `BuildingRegistryInfo`, `isNumberedBuildingUnit`,
  `parseBrTitleInfoRecord`, `fetchBuildingRegistryInfo`.
- `src/lib/api-molit.ts` — MOLIT 실거래 클라이언트, XML 파싱
  (`fast-xml-parser`), `DATA_GO_KR_API_KEY` 재사용, 동일한
  trim/quote-strip/decode/encode 패턴.
- `scripts/backfill-apartment-master-basic-data.ts` +
  `scripts/backfill-basic-data-logic.ts` — `ApartmentMaster` enrichment
  파이프라인. `BasicSpecSource` enum(`BUILDINGHUB_GENERAL_TITLE` /
  `BUILDINGHUB_TITLE` / `UNKNOWN`)이 provenance를 태깅한다.
  `planField()`가 "기존 non-null 값은 절대 덮어쓰지 않음"을 강제하는
  두 번째 안전장치.
- 환경변수: `DATA_GO_KR_API_KEY` 하나가 MOLIT 실거래 +
  `BldRgstHubService` 양쪽에 이미 재사용되고 있다. K-APT 전용
  `KAPT_API_KEY` 같은 별도 변수는 존재하지 않는다.
- `.env.example`은 없다 — 이 프로젝트의 실제 관례는
  `<PROVIDER>_API_KEY`(서버 전용) / `NEXT_PUBLIC_<PROVIDER>_..._API_KEY`
  (클라이언트 노출용).

**결론**: 새 API 클라이언트를 만들기 전에, 기존 `DATA_GO_KR_API_KEY`가
이 신규 상품에도 그대로 통하는지부터 실측 확인이 반드시 먼저다
(중복 클라이언트를 만들 이유가 없거나, 아예 새 키/승인이 필요할 수
있음).

## 4. 공식 API 명세(문서 조사, 아직 live 검증 전)

data.go.kr 상세 페이지 및 공개 문서/wiki를 통해 확인(단, 이 페이지들
자체는 로그인 없이 전체 명세를 노출하지 않아 필드 표는 2차 출처 —
§6에서 실제 활용 가능 여부를 별도로 검증한다):

- **서비스명**: 국토교통부_공동주택 기본 정보제공 서비스
  (`data.go.kr` #15058453)
- **제공기관**: 국토교통부(주택건설운영과)
- **방식**: REST, 응답 포맷 JSON, 무료
- **트래픽 제한**: 개발계정 5,000회, 운영계정은 활용사례 등록 후 증설
  신청 가능
- **추정 endpoint**(2차 출처 기준, §6에서 미검증으로 확인됨):
  `https://apis.data.go.kr/1613000/AptBasisInfoServiceV3/getAphusBassInfoV3`
  (입력: `kaptCode` 단지코드 — **이름/주소로 직접 검색 불가**, 단지코드가
  선행 필요)
- **companion 서비스**: 국토교통부_공동주택 단지 목록제공 서비스
  (`data.go.kr` #15057332) — 시도/시군구/법정동/도로명 등 지역
  기준으로 kaptCode 목록을 조회하는 역할로 추정(정확한 request
  parameter는 미확인).
- **문서상 응답 필드**(2차 출처, 구버전 `AptBasisInfoService` 기준):
  `kaptCode`(단지코드), `kaptName`(단지명), `kaptAddr`(법정동주소),
  `bjdCode`(법정동코드), `doroJuso`(도로명주소), `kaptDongCnt`(동수),
  `kaptdaCnt`(세대수), `kaptUsedate`(사용승인일), `kaptBcompany`(시공사),
  `kaptAcompany`(시행사), `kaptTel`/`kaptFax`(관리사무소 연락처),
  `kaptUrl`(홈페이지), `kaptTarea`(연면적), `kaptMarea`(관리비부과면적),
  `privArea`(전용면적합), `codeSaleNm`/`codeHeatNm`/`codeAptNm`/
  `codeMgrNm`/`codeHallNm`(분류 코드값). **위도/경도 필드는 이 2차
  출처 문서 어디에도 없다** — 좌표는 이 서비스가 제공하지 않는 것으로
  보인다(§6 live 검증 불가로 최종 확인은 못 함).
- V3와 구버전(V1) 필드명이 완전히 같은지는 미확인(§6에서 live 응답
  자체를 받지 못해 확인 불가).

## 5. API KEY 상태

```
API_KEY_CONFIGURED=true
```

(`DATA_GO_KR_API_KEY`가 `.env.local`에 설정돼 있음 — 값은 출력하지
않음.)

## 6. 실제 Live Probe 결과 — **BLOCKER**

신규 read-only 스크립트 `scripts/audit-apartment-basic-info-source.ts`
(DB 접근 없음, 외부 GET만, key masking 없이 boolean만 로그)로 실제
gateway를 호출했다. 5개 후보(공식 V3 경로 + companion 목록 서비스 +
legacy 변형 2개)와 대조군(control) 1개, 총 2회 반복 실행:

| 호출 | 결과 |
|---|---|
| `AptBasisInfoServiceV3/getAphusBassInfoV3`(공식 V3, kaptCode 예시값) | `NO_OPENAPI_SERVICE_ERROR`("해당 오픈API 서비스가 없거나 폐기됨") |
| `AptBasisInfoService/getAphusBassInfo`(legacy) | `NO_OPENAPI_SERVICE_ERROR` |
| `AptListService3/getSigunguAptListV3`(companion, sigunguCode=26350) | `NO_OPENAPI_SERVICE_ERROR` |
| `AptListService/getSigunguAptList`(legacy) | `NO_OPENAPI_SERVICE_ERROR` |
| `AptListService3/getSidoAptListV3`(companion, sidoCode=26) | `NO_OPENAPI_SERVICE_ERROR` |
| **CONTROL**: `BldRgstHubService/getBrTitleInfo`(이미 승인된 기존 서비스, 동일 key) | **`resultCode=00 NORMAL SERVICE`** — 성공 |

같은 키로 같은 실행 안에서 대조군은 즉시 성공하고, 타겟 5개는
전부 동일한 gateway-level 오류를 낸다 — **키 자체는 정상**이고,
문제는 "이 특정 상품이 이 키에 아직 승인/활성화되지 않음"이다.

이 결과는 새로운 문제가 아니다. `MASTER_HOUSEHOLD_VERIFICATION_V1`
§6이 정확히 같은 endpoint(`AptBasisInfoServiceV3/getAphusBassInfoV3`)
를 이미 시도해 동일한 `NO_OPENAPI_SERVICE_ERROR`를 문서화해 뒀다 —
이번 STEP은 그 결과를 오늘 시점에 정확히 재현했을 뿐이다.

**결론: 이 STEP에서 요청한 "사용자가 활용신청/승인한" 상태가 현재
`DATA_GO_KR_API_KEY`에는 아직 반영되지 않았다.** data.go.kr는 계정
단위 일반 인증키를 상품별로 별도 승인하는 구조이므로, 다음 중 하나가
필요하다:

1. data.go.kr 마이페이지에서 이 상품(`AptBasisInfoServiceV3` 및/또는
   companion 목록 서비스)의 활용신청 상태가 실제로 "승인"인지 재확인
   (신청만 하고 승인 대기 중일 가능성)
2. 승인이 완료됐다면 활성화 반영에 시간이 걸릴 수 있음(문서화된 사례상
   수 시간~수일) — 시간을 두고 재확인
3. 이 상품이 별도의 새 서비스키를 발급하는 구조라면, 그 키를
   `.env.local`에 추가(기존 `DATA_GO_KR_API_KEY`와 다른 변수명 필요
   여부는 data.go.kr 마이페이지에서 직접 확인 필요)

이번 STEP의 probe 스크립트(`scripts/audit-apartment-basic-info-source.ts`)
는 그대로 남겨뒀다 — 위 조치 후 재실행 한 줄(`npx ts-node ...`)로
바로 재검증할 수 있다.

## 7. 이후 섹션이 BLOCKED된 이유

§8(경동마리나 검증), §9(추가 샘플), §10(household 적합성 판정),
§11(buildingCount 적합성), §12(사용승인일), §13(좌표) 전부 **실제 API
응답이 있어야 판정 가능한 항목**이다. §6의 blocker로 인해 이번
STEP에서는 이 항목들을 "필드명을 추측"해서 채우지 않는다(스펙 §7/§25
"필드명을 추측하지 않는다" 원칙) — 대신 각 항목을 아래처럼 명시적으로
`CANNOT_DETERMINE`으로 남긴다.

### 7-1. 경동마리나 케이스(MOLIT/건축물대장 측만 재확인)

기존에 이미 확정된 값만 재확인(신규 조사 아님):

- MOLIT: `aptSeq=26350-2`, `name=경동`, `dong=우동`, `jibun=974`,
  `buildYear=1995`
- 건축물대장: 표제부 1건, `dongNm="103동"`, `hhldCnt=72` —
  `isNumberedBuildingUnit()` 가드에 의해 `SINGLE_BUILDING_AS_COMPLEX`로
  거부됨(단지 전체값으로 저장되지 않음, 현재 `ApartmentMaster`의
  `totalHouseholds`는 이 건에 한해 `null` 또는 guard-rejected 상태 —
  `72`로 저장돼 있다면 그 자체가 이전 파이프라인의 버그 흔적이며 이번
  STEP이 수정하는 대상이 아님, `MASTER_HOUSEHOLD_VERIFICATION_V1`
  범위).
- 공식 공동주택 기본정보 API의 892세대/8개동 여부: **CANNOT_VERIFY**
  (API 접근 자체가 막혀 있어 조회 시도조차 못함 — "조회했으나 없음"이
  아니라 "조회 불가").

### 7-2. 부산 복수 샘플

**CANNOT_DETERMINE** — §6 blocker로 단 1건도 실제 API 응답을 받지
못해 샘플 테이블 자체를 만들 수 없다.

## 6-B. Re-verification After Approval Confirmed (2026-08-31)

사용자가 data.go.kr 마이페이지 → 활용신청 현황에서 두 서비스 모두
`[승인]` 상태(공동주택 단지 목록제공 서비스: 신청일 2026-08-31, 만료
2028-08-31 / 공동주택 기본 정보제공 서비스: 신청일 2026-08-24, 만료
2028-08-24)임을 직접 확인해 전달했다 — §6의 "미승인" 가설은 폐기한다.

**옛 V3 endpoint를 그대로 전제하지 말라는 지시에 따라** 후보를
9개로 넓혀 재검증했다(같은 probe 스크립트, 동일 key, 반복 2~3회):

| 후보 | 결과 |
|---|---|
| `1613000/AptBasisInfoServiceV3/getAphusBassInfoV3` | `NO_OPENAPI_SERVICE_ERROR` |
| `1613000/AptBasisInfoServiceV4/getAphusBassInfoV4`(신버전 가능성) | `NO_OPENAPI_SERVICE_ERROR` |
| `1613000/AptBasisInfoService/getAphusBassInfo`(버전 접미사 없음) | `NO_OPENAPI_SERVICE_ERROR` |
| `1611000/AptBasisInfoService/getAphusBassInfo`(legacy) | `NO_OPENAPI_SERVICE_ERROR` |
| `1613000/AptListService3/getSigunguAptListV3` | `NO_OPENAPI_SERVICE_ERROR` |
| `1613000/AptListService3/getSidoAptListV3` | `NO_OPENAPI_SERVICE_ERROR` |
| `1613000/AptListService2/getLegaldongAptList`(이전 STEP이 시도한 변형) | `NO_OPENAPI_SERVICE_ERROR` |
| `1611000/AptListService/getSigunguAptList` | `NO_OPENAPI_SERVICE_ERROR` |
| `1611000/AptListService/getLegaldongAptList`(웹 검색으로 발견한 실사용 예제 조합, `bjdCode=2635010500` 우동) | `NO_OPENAPI_SERVICE_ERROR` |
| **CONTROL**: `1613000/BldRgstHubService/getBrTitleInfo`(동일 key) | `resultCode=00 NORMAL SERVICE` — 성공(2/3회, 1회는 무관한 `SERVICETIMEOUT_ERROR` 일시 네트워크 문제) |

**진단이 바뀌었다**: `NO_OPENAPI_SERVICE_ERROR`(`returnReasonCode=12`)는
data.go.kr 공통 오류 체계에서 "요청 URL 자체가 등록된 서비스와
일치하지 않음"을 뜻하는 코드로, 승인/권한 문제에 쓰이는 다른
코드(`SERVICE_ACCESS_DENIED_ERROR` 등)와 다르다. 승인 상태가 이미
확인된 지금, 9개 후보가 전부 이 코드로 실패한다는 것은 "미승인"이
아니라 **"이 두 서비스의 정확한 End Point 경로를 아직 못 찾았다"**는
뜻으로 재해석해야 한다.

data.go.kr의 실제 End Point는 로그인한 사용자의 "마이페이지 → 개발
계정 상세" 화면에만 정확히 노출되며(비로그인 상태로 `data.go.kr/iim/
api/selectAPIAcountView.do` 접근을 시도했으나 SSO 로그인 페이지로
리다이렉트됨 — 프로그래매틱 접근 불가), 공개 문서/블로그는 버전이
자주 바뀌어 신뢰할 수 없다는 것이 이번 재검증으로 실증됐다(9개의
그럴듯한 후보 전부 틀림).

## 7-B. 남은 Blocker(재정의)

승인 blocker는 해소됐다. 남은 것은 **정확한 End Point 문자열
확보**뿐이다 — 이는 코드나 재추측으로 풀 수 없고, 사용자가 로그인한
data.go.kr 화면에서 직접 복사해야 한다(§15 PM Decision Needed 참고).
그 텍스트만 확보되면 이 STEP의 probe 스크립트에 한 줄 추가해 즉시
재검증 가능하고, 성공하면 §7~§13(경동마리나 실제 검증, 부산 샘플,
source verdict)을 곧바로 채울 수 있다.

## 6-C. Official V4/V5 Re-verification — BREAKTHROUGH (2026-08-31)

사용자가 data.go.kr에 로그인한 상태의 실제 "활용신청 상세" 화면에서
공식 End Point를 직접 확인해 전달했다:

```
공동주택 단지 목록제공 서비스: https://apis.data.go.kr/1613000/AptListService4
공동주택 기본 정보제공 서비스: https://apis.data.go.kr/1613000/AptBasisInfoServiceV5
```

기존 V2/V3/V4(기본정보 기준) 추측은 전부 폐기 — 위 두 base URL이
유일한 source of truth다. base URL은 확보됐지만 정확한 operation명은
여전히 미확인이었으므로(추측 금지 원칙에 따라 §6/§6-B와 동일하게
경험적 검증으로 접근):

### 기본 정보제공 서비스 — **CONFIRMED WORKING**

`getAphusBassInfoV5` operation이 `kaptCode` 파라미터로 실제 성공했다
(`HTTP 200`, `resultCode=00 NORMAL SERVICE.`). 공개 예제
(GitHub luritas/open-data-api wiki)에서 가져온 예시 `kaptCode=
A10027875`로 실제 조회한 결과, 서울이 아니라 **부산 사하구**의 실존
단지였다(우연히 딱 맞는 검증용 실사례를 얻음):

```json
{
  "kaptCode": "A10027875",
  "kaptName": "괴정 경성스마트W아파트",
  "kaptAddr": "부산광역시 사하구 괴정동 258 괴정 경성스마트W아파트",
  "doroJuso": "부산광역시 사하구 낙동대로 180",
  "bjdCode": "2638010100",
  "codeSaleNm": "분양", "codeHeatNm": "개별난방", "codeAptNm": "주상복합",
  "codeMgrNm": "자치관리", "codeHallNm": "혼합식",
  "kaptDongCnt": "3", "kaptdaCnt": 182.0, "hoCnt": 182,
  "kaptUsedate": "20150806",
  "kaptBcompany": "(주)경성리츠", "kaptAcompany": "(주)경성리츠",
  "kaptTel": "0512949363", "kaptFax": "0512949364", "kaptUrl": " ",
  "kaptTarea": 15040.163, "kaptMarea": 15040.163, "privArea": "9014.0338",
  "kaptMparea60": 182.0, "kaptMparea85": 0.0, "kaptMparea135": 0.0, "kaptMparea136": 0.0,
  "kaptTopFloor": 15, "ktownFlrNo": 15, "kaptBaseFloor": 2,
  "kaptdEcntp": 5, "zipcode": "49338"
}
```

핵심 확인 사항:

- **응답 envelope이 문서상 추정(§4)과 다르다**: 단건(`kaptCode`) 조회는
  `response.body.item`(단일 객체)이지, 이 프로젝트의 다른
  data.go.kr client들이 쓰는 `response.body.items.item`(배열 wrapper)
  이 아니다 — probe 스크립트를 이 실측에 맞춰 수정했다(두 shape 모두
  처리하도록).
- **좌표 필드 없음 — live 응답으로 최종 확인**(문서 추정이 아니라
  실측): 위 26개 필드 어디에도 위도/경도가 없다.
- **세대수/동수가 단지 전체 단위로 명확**: `kaptdaCnt=182`(세대수),
  `kaptDongCnt=3`(동수) — 3동 182세대 주상복합에 대해 상식적으로
  일관된 complex-level 값(동 1개당 값이 아님, §7-B에서 우려했던
  "동 단위 값이 단지 전체로 잘못 나올 위험"과는 다른 종류의 필드 —
  건축물대장 표제부/총괄표제부 구분과 달리 이 서비스는 애초에
  "단지" 단위로만 응답한다).
- 그 외 유용한 필드: `kaptUsedate`(사용승인일 YYYYMMDD), `kaptAddr`/
  `doroJuso`(법정동/도로명 주소), `bjdCode`(법정동코드),
  `kaptMparea60/85/135/136`(평형대별 세대수 분포 — 60/85/135/136㎡
  초과 구간별), `kaptTopFloor`/`kaptBaseFloor`(층수), `zipcode`.

### 단지 목록제공 서비스 — **여전히 미해결**

`AptListService4` base는 사용자가 확인해 준 대로 확실하지만, 정확한
operation명은 20개 후보(§ 아래 표)를 전부 시도해도 찾지 못했다:

| 시도한 operation 패턴 | 결과 |
|---|---|
| `getSigunguAptListV4`/`getLegaldongAptListV4`/`getSidoAptListV4`/`getRoadnmAptListV4`(V3까지의 관례 그대로 V4로 버전만 교체) | `NO_OPENAPI_SERVICE_ERROR` |
| 위 4개의 버전 접미사 없는 버전(`getSigunguAptList`/`getLegaldongAptList`) | `NO_OPENAPI_SERVICE_ERROR` |
| `sigunguCode`→`sigunguCd`, `bjdCode`→`bjdCd` 파라미터명 변형 | `NO_OPENAPI_SERVICE_ERROR` |
| `getBjdongAptListV4`/`getAptListV4`/`getEmdAptListV4`/`getUmdAptListV4`/`getAptBasisListV4` | `NO_OPENAPI_SERVICE_ERROR` |
| 기본정보 서비스가 실제로 쓰는 legacy "Aphus" 표기를 목록 서비스에도 적용(`getSigunguAphusListV4`/`getLegaldongAphusListV4`/`getBjdongAphusListV4`/`getEmdAphusListV4`/`getAphusListV4`/`getAphusList`) | `NO_OPENAPI_SERVICE_ERROR` |

20개 전부 동일한 오류. base가 사용자 확인으로 맞다는 게 확실하고,
같은 key로 대조군(`BldRgstHubService`)과 방금 확인된 기본정보
서비스가 둘 다 정상 작동하므로, 이건 승인/키 문제가 절대 아니다 —
순수하게 **operation명을 아직 못 찾은 것**이다. 이 이상 추측을
확장하지 않는다(스펙 §7/§30 — "이전 실패를 다시 분석하는 데 시간을
쓰지 않는다"의 취지를 지금부터는 반대로 적용: 이 이상 재추측에
시간을 쓰지 않는다).

### 대안 경로 시도(부차적, 목록 서비스를 대체하지 못함)

목록 서비스 없이 경동마리나 kaptCode를 얻기 위해 시도했으나 전부
실패한 부차적 경로(참고용으로만 기록, 재시도 불필요):

- K-apt(`k-apt.go.kr`) 공식 무료 다운로드 파일(단지코드 18,403건
  포함, `국토교통부_공동주택 단지 기본 정보_20240913`, data.go.kr
  #15073271) — 직접 HTTP 다운로드 시도 시 "정상적인 접근이 아닙니다"
  봇 차단, 세션 쿠키/Referer 추가해도 "서비스 준비중입니다" 응답 —
  자동화된 접근을 막는 것으로 보임.
- K-apt 웹사이트 자체 단지 검색 UI(브라우저 자동화로 시도) — 검색
  input에 "경동" 입력까지는 됐으나 자동완성/선택 UI가 필요해 완료하지
  못함(시간 대비 효율 낮다고 판단해 중단).
- 3rd-party 부동산 사이트(richgo.ai 등) — "경동마리나: 892세대, 8개동,
  1995.06 완공"을 확인(사용자가 이번 STEP에서 언급한 892/8개동과 정확히
  일치, MOLIT buildYear=1995와도 일치) — 다만 이건 **공식 정부 API가
  아닌 3rd-party 집계 사이트**라서 Production 근거로 쓸 수 없다.
  참고용 corroboration으로만 기록.

## 7-C. 경동마리나 최종 상태

- MOLIT/건축물대장 측(§7-1)은 변경 없음 — `72`는 여전히 103동 개별
  값, 단지 전체 세대수 아님.
- 공식 공동주택 기본정보 API(V5)가 실제로 작동함은 확인됐으나, 목록
  서비스 미해결로 경동마리나의 정확한 `kaptCode`를 API로 조회하지
  못해 **CANNOT_VERIFY 유지**(추측/3rd-party 값으로 대체하지 않음).
- 단, §6-C에서 검증한 다른 단지(괴정 경성스마트W아파트) 사례가
  `kaptdaCnt`/`kaptDongCnt`가 실제로 complex-level 값임을 real
  evidence로 보여준다 — API 메커니즘 자체는 신뢰할 근거가 생겼다.

## 8. Household/BuildingCount/Coordinate Source Verdict

| 항목 | 판정 | 근거 |
|---|---|---|
| Household(`kaptdaCnt`) | **LIMITED**(예비 긍정, n=1) | §6-C 실측 1건에서 complex-level 세대수로 확인(3동/182세대, 표제부 동 단위 문제와 다른 종류의 필드). 하지만 §14 스펙이 요구한 "부산 10개 이상 sample" 검증은 목록 서비스 미해결로 수행하지 못했다 — 표본 1건으로 `RECOMMENDED` 확정은 시기상조. |
| Building count(`kaptDongCnt`) | **LIMITED**(예비 긍정, n=1) | 위와 동일 근거·동일 한계. `kaptDongCnt`가 문자열 타입("3")으로 오는 것도 확인(숫자 캐스팅 필요). 관리동/부속동 포함 여부는 명세로 확인 못함 — 표본이 1건뿐이라 실측으로도 아직 답할 수 없다. |
| Coordinate | **NOT_AVAILABLE** | §6-C 실측 응답(26개 필드 전수)에 위도/경도 없음 — 문서 추정이 아니라 실제 라이브 응답으로 확정. |

## 9. 제안 Architecture(설계만, 미구현)

목록 서비스(`AptListService4`)가 해소된 이후를 가정한 최소 구조(스펙
§20과 동일한 방향, 구현은 하지 않음 — 향후 STEP 대상):

```
ApartmentMaster aptSeq
        ↓
strong identity evidence(canonical name/sido/sigungu/dong/jibun/buildYear)
        ↓
AptListService4(지역 → kaptCode 후보 목록) — operation명 확정 필요(§6-C)
        ↓
identity matcher(위 evidence vs 공식 record의 kaptName/kaptAddr/
bjdCode/kaptUsedate 다중 strong field 대조 — 단지명 단독/substring/
동일 동/first match 전부 금지)
        ↓
EXACT_MATCH / HIGH_CONFIDENCE
        ↓
AptBasisInfoServiceV5.getAphusBassInfoV5(kaptCode → 공식 단지 record)
— **확인 완료, 실제 작동**(§6-C)
        ↓
official enrichment candidate(리뷰 후 write 별도 승인)

REVIEW_REQUIRED / NO_MATCH / CONFLICT → 자동 연결 금지, 사람 검토
```

`BasicSpecSource` enum에 신규 값(예: `APT_BASIS_INFO_V5`)을 추가하는
안이 기존 provenance 패턴과 가장 잘 맞는다(schema 변경이지만 additive
enum value 추가 — 이번 STEP에서는 실행하지 않음, 승인 필요 §11).
기존 `SINGLE_BUILDING_AS_COMPLEX` 가드(`isNumberedBuildingUnit` 등)는
그대로 유지 — 새 공식 API가 household 1차 source가 되더라도
건축물대장은 보조 evidence로 남을 수 있다. `kaptDongCnt`가 문자열
타입으로 오므로 저장 전 숫자 캐스팅이 필요하다(§8).

## 10. Production Write

**0.** ApartmentMaster INSERT/UPDATE/DELETE 없음. household/좌표/
buildingCount 수정 없음.

## 11. Schema Change

**0.** `BasicSpecSource` enum 확장안(§9)은 제안만 하고 실행하지
않았다.

## 12. Tests / Build

- 신규 코드는 read-only probe 스크립트 1개뿐(DB 접근 없음, 순수 함수
  없음 — 단위 테스트 대상 로직이 없다). §6-C에서 실제 라이브 응답을
  확보해 기본정보 서비스의 실제 동작을 실증했고, 목록 서비스는 20개
  조합을 반복 실행해 재현성 있는 실패 패턴을 확인했다.
- `npx eslint scripts/audit-apartment-basic-info-source.ts`: clean.
- `npx tsc --noEmit`: 신규 오류 0(기존 20건 baseline 유지).
- `npm run build`: 이번 STEP은 `src/`/`prisma/` 변경이 없어(스크립트
  1개만 추가/수정) 별도 재실행 없이 직전 STEP의 PASS가 유효하다고
  판단 — 대규모 불필요 재빌드를 피하기 위해 생략.
- 기존 회귀 테스트(`.test.mjs`/`.test.ts`): 이번 STEP이 기존 코드를
  전혀 수정하지 않아 재실행 불필요로 판단(직전 STEP에서 672/672
  PASS 확인됨).

## 13. Known Limitations

- 이 STEP의 핵심 질문("이 공식 API를 믿고 ApartmentMaster를 보강해도
  되는가?")에 **부분적으로만** 답했다 — 기본정보 서비스(V5)는 실제로
  작동하고 실측 필드도 확보했지만(§6-C), 목록 서비스(V4) operation명
  미해결로 경동마리나를 포함한 체계적 부산 sample 검증(스펙 §14)은
  하지 못했다.
- §4의 필드 목록(2차 출처)은 §6-C 실측으로 대부분 재확인됐으나
  100% 일치는 아니다(`hoCnt`, `kaptTopFloor`, `kaptBaseFloor`,
  `kaptMparea*`, `zipcode` 등은 §4에 없던 필드로 실측에서 추가
  발견됨) — 앞으로도 문서보다 실측을 우선한다.
- household/buildingCount verdict가 `LIMITED`인 것은 필드 자체의
  결함이 아니라 **표본이 1건뿐이라 통계적 확신을 줄 수 없다는 뜻**이다
  — 목록 서비스가 풀리면 부산 10개 이상 표본으로 재판정해야 한다.
- companion 목록 서비스의 정확한 request parameter 구조는 여전히
  미확인이다(20개 조합 전부 실패, §6-C).
- 20개 후보(§6-C)는 이 서비스 API 그룹(`1613000`, 사용자 확인)
  안에서 공개적으로 관찰된 operation 이름 패턴을 조합한 것이다 —
  실제 operation명이 이 조합 밖에 있을 가능성은 배제할 수 없다.

## 14. Next Step

한글명 우선 제안:

1. **목록 서비스 정확한 operation명 확보**(사용자 행동 필요, PM 결정
   필요 — §15): data.go.kr 마이페이지 → `공동주택 단지 목록제공
   서비스` 상세 → "Sample Code"/"미리보기" 탭에 노출되는 실제 요청
   URL(operation명 포함)을 그대로 복사해 전달.
2. **확보 후 재검증**(승인 불필요, 코드 준비 완료):
   `scripts/audit-apartment-basic-info-source.ts`의
   `LIST_OPERATION_CANDIDATES`에 한 줄 추가 후 재실행 — 성공하면
   경동마리나 kaptCode 확정 + 부산 10개 이상 sample QA를 곧바로
   진행할 수 있다(기본정보 서비스는 이미 확인 완료 — 목록 서비스만
   풀리면 끝).
3. **경동마리나 kaptCode를 다른 경로로 먼저 확보하는 대안**(목록
   서비스 없이도 가능): `scripts/audit-apartment-basic-info-source.ts
   <kaptCode>` 형태로 CLI 인자를 받도록 이미 구현해 뒀다 — 사용자가
   K-apt 웹사이트(`k-apt.go.kr`, 로그인 불필요, 단지명 검색 UI 있음)
   에서 직접 검색해 kaptCode를 확인해 전달하면, 목록 서비스 없이도
   경동마리나 건 하나는 즉시 검증 가능하다(단, 10개 이상 sample QA는
   여전히 목록 서비스가 필요).
4. 그때까지는 기존 건축물대장 기반 파이프라인과 기존
   `SINGLE_BUILDING_AS_COMPLEX` 가드를 그대로 유지.

## 15. PM Decision Needed

**이번 STEP 자체는 Production write/schema 변경이 필요 없다.**
승인 상태는 이미 확인 완료됐고, 기본정보 서비스(V5)는 실제로 작동한다
— 남은 것은 목록 서비스(V4) 하나의 operation명뿐이다:

- **목록 서비스 정확한 operation명/Sample Code 확보**: data.go.kr
  마이페이지 → `국토교통부_공동주택 단지 목록제공 서비스` 상세 화면의
  "Sample Code" 또는 "미리보기" 탭에 노출되는 실제 요청 URL을 그대로
  복사해서 전달. 이 화면은 로그인 세션이 있어야만 보이므로
  프로그래매틱으로는 얻을 수 없다(§6-C에서 20개 조합 전부 실패로
  확인) — 사용자가 직접 화면을 보고 복사해줘야 하는 유일한 남은
  정보다.
- (선택) 위 확보가 어렵다면, K-apt 웹사이트에서 경동마리나를 검색해
  `kaptCode` 하나만 알려줘도 §14-3 대안으로 그 건 하나는 바로 검증
  가능하다 — 다만 부산 전체 sample QA(스펙 §14 목표 10건 이상)에는
  결국 목록 서비스가 필요하다.
