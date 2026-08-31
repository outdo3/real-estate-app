# APARTMENT OFFICIAL BASIC INFO SOURCE AUDIT V1

## 1. Goal

`ApartmentMaster`의 secondary metadata(특히 `totalHouseholds`)는 현재
건축물대장(총괄표제부/표제부) 기반이며, `MASTER_HOUSEHOLD_VERIFICATION_V1`
에서 이미 확인된 대로 다동 복합단지의 표제부 fallback이 "동 1개"의
값을 "단지 전체"로 오인할 구조적 위험을 안고 있다(경동마리나 사례,
`26350-2`, 실제 표제부 hhldCnt=72가 892세대 단지의 103동 값이었음).

이번 STEP은 사용자가 공공데이터포털에서 활용신청한
**국토교통부_공동주택 기본 정보제공 서비스**(`AptBasisInfoServiceV3`)가
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

## 8. Household/BuildingCount/Coordinate Source Verdict

세 항목 모두 **CANNOT_DETERMINE**(RECOMMENDED/LIMITED/NOT_RECOMMENDED
중 어느 것도 아직 판정할 근거가 없음) — §6 blocker가 해소되고 실제
응답 필드를 확인한 뒤에만 판정 가능하다. 문서상 필드 목록(§4)에는
위도/경도가 보이지 않아 좌표는 `LIMITED` 또는 `NOT_RECOMMENDED`로
기울 가능성이 있으나, 이는 2차 출처 기반 추정일 뿐 live 검증 전까지
확정하지 않는다.

## 9. 제안 Architecture(설계만, 미구현)

§6이 해소된 이후를 가정한 최소 구조(스펙 §18과 동일한 방향, 구현은
하지 않음 — 향후 STEP 대상):

```
AptListService3(지역 → kaptCode 후보) 또는 사용자 보유 kaptCode 매핑
        ↓
AptBasisInfoServiceV3(kaptCode → 공식 단지 record)
        ↓
identity matcher(aptSeq 쪽 canonical name/sido/sigungu/dong/jibun/
buildYear vs 공식 record의 kaptName/kaptAddr/bjdCode/kaptUsedate 다중
strong field 대조 — 단지명 단독/substring/동일 동/first match 전부 금지)
        ↓
EXACT_MATCH / HIGH_CONFIDENCE → enrichment candidate(리뷰 후 write 별도 승인)
REVIEW_REQUIRED / NO_MATCH / CONFLICT → 자동 연결 금지, 사람 검토
```

`BasicSpecSource` enum에 신규 값(예: `APT_BASIS_INFO_V3`)을 추가하는
안이 기존 provenance 패턴과 가장 잘 맞는다(schema 변경이지만 additive
enum value 추가 — 이번 STEP에서는 실행하지 않음, 승인 필요 §11).
기존 `SINGLE_BUILDING_AS_COMPLEX` 가드(`isNumberedBuildingUnit` 등)는
그대로 유지 — 새 공식 API가 household 1차 source가 되더라도
건축물대장은 보조 evidence로 남을 수 있다.

## 10. Production Write

**0.** ApartmentMaster INSERT/UPDATE/DELETE 없음. household/좌표/
buildingCount 수정 없음.

## 11. Schema Change

**0.** `BasicSpecSource` enum 확장안(§9)은 제안만 하고 실행하지
않았다.

## 12. Tests / Build

- 신규 코드는 read-only probe 스크립트 1개뿐(DB 접근 없음, 순수 함수
  없음 — 단위 테스트 대상 로직이 없다, 대신 §6에서 실제 2회 반복
  실행으로 결과 재현성을 확인).
- `npx eslint scripts/audit-apartment-basic-info-source.ts`: clean.
- `npx tsc --noEmit`: 신규 오류 0(기존 20건 baseline 유지,
  `master-coverage-sync` 관련 오류 없음 재확인).
- `npm run build`: 이번 STEP은 `src/`/`prisma/` 변경이 없어(스크립트
  1개만 추가) 별도 재실행 없이 직전 STEP(`MASTER_COVERAGE_SYNC_V1`)의
  PASS가 유효하다고 판단 — 대규모 불필요 재빌드를 피하기 위해 생략.
- 기존 회귀 테스트(`.test.mjs`/`.test.ts`): 이번 STEP이 기존 코드를
  전혀 수정하지 않아 재실행 불필요로 판단(직전 STEP에서 672/672
  PASS 확인됨).

## 13. Known Limitations

- 이 STEP의 핵심 질문("이 공식 API를 믿고 ApartmentMaster를 보강해도
  되는가?")에 여전히 답하지 못했다 — 승인은 확인됐지만 정확한 End
  Point를 아직 못 찾아 API 응답 자체를 못 받았다.
- §4의 필드 목록은 2차 출처(GitHub wiki, 검색 결과 요약)에 의존한다 —
  live 응답으로 검증되기 전까지는 "문서상 추정"으로만 취급해야 한다.
- companion 목록 서비스의 정확한 request parameter 구조도 미확인이다.
- 9개 후보(§6-B)는 이 프로젝트가 이미 알고 있는 두 그룹(1611000/
  1613000)과 공개적으로 관찰된 operation 이름 패턴을 조합한 것이다 —
  data.go.kr가 이 두 상품에 부여한 실제 그룹 번호가 그 조합 밖에 있을
  가능성은 배제할 수 없다.

## 14. Next Step

한글명 우선 제안:

1. **정확한 End Point 확보**(사용자 행동 필요, PM 결정 필요 — §15):
   승인은 이미 끝났으므로, data.go.kr 마이페이지 → 활용신청 현황 →
   해당 서비스 클릭 → "활용신청 상세" 또는 "개발계정 상세" 화면에서
   "End Point"로 표시되는 정확한 URL 문자열을 그대로 복사해 전달.
2. **End Point 확보 후 재검증**(승인 불필요, 코드 준비 완료): 그
   문자열을 `scripts/audit-apartment-basic-info-source.ts`의 후보
   목록에 한 줄 추가 후 재실행 — 성공하면 이 STEP의 §7~§9를 실제
   데이터로 채우는 후속 STEP 진행.
3. 그때까지는 기존 건축물대장 기반 파이프라인과 기존
   `SINGLE_BUILDING_AS_COMPLEX` 가드를 그대로 유지.

## 15. PM Decision Needed

**이번 STEP 자체는 Production write/schema 변경이 필요 없다.**
활용신청 승인 상태는 이미 확인 완료(2026-08-31, 사용자 제공)됐다 —
더 이상 재확인을 요청하지 않는다. 남은 것은 순수하게 기술적인 정보
하나뿐이다:

- **정확한 End Point 문자열 확보**: data.go.kr 마이페이지 → 활용신청
  현황 → `국토교통부_공동주택 기본 정보제공 서비스`(및 companion
  `공동주택 단지 목록제공 서비스`) 클릭 → 상세 화면에 표시되는 "End
  Point" 필드(또는 "미리보기"/"Sample Code" 탭에 노출되는 실제 요청
  URL)를 그대로 복사해서 전달. 이 화면은 로그인 세션이 있어야만
  보이므로(§6-B에서 비로그인 접근이 SSO 로그인 페이지로 리다이렉트됨을
  확인) 프로그래매틱으로는 얻을 수 없다 — 사용자가 직접 화면을 보고
  복사해줘야 하는, 코드로 우회할 수 없는 유일한 남은 정보다.
- 별도의 새 서비스키가 필요한지는 그 End Point로 재검증했을 때
  `NO_OPENAPI_SERVICE_ERROR`가 아닌 다른 오류(예: 인증 관련 오류)가
  나오면 그때 판단한다 — 현재로선 그 가능성을 시사하는 증거가 없다
  (control 호출이 같은 `DATA_GO_KR_API_KEY`로 정상 작동).
