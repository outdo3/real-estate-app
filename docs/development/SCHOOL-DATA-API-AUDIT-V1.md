# SCHOOL DATA/API AUDIT V1 — 학교·학군·유치원·어린이집 기존 연동 전수 감사

AUDIT ONLY. 코드/DB/UI 변경 없음, 신규 API 연동 없음, commit/push 없음.
읽기 전용 조사 + NEIS API 유효성 확인용 최소 호출 1건(§7)만 수행했다.

## 0. 시작 상태

```
git status --short  → (없음, clean)
git rev-parse HEAD        = ccf62b2ecae868f19260bda1fabfd90c2b0a55c6
git rev-parse origin/main = ccf62b2ecae868f19260bda1fabfd90c2b0a55c6
```
BUSAN SCORE DATA V1 peer fallback hotfix는 이미 commit·push 완료된
상태(직전 STEP)였다 — 이번 STEP은 그 위에서 시작했고 아무것도 건드리지
않았다.

## 1. API route inventory

| path | 역할 | source | cache |
|---|---|---|---|
| `GET /api/school` | 지역+학교급별 학교 목록(가나다순) | NEIS `schoolInfo` | 서버 메모리 10분(`getOrSetCache`) |
| `GET /api/school/stats` | 지역 학교 수 집계(초/중/고) + 학원가 밀집도 | NEIS `schoolInfo` + Kakao 카테고리(AC5, 학원) | 캐시 없음(매 요청 실시간) |
| `GET /api/school/apartments` | 특정 학교 인근 1.5km 아파트 목록(거리/도보시간/실거래가) | Kakao 키워드 검색 + MOLIT 실거래 + 건축물대장 | 서버 메모리 5분 |

입력/출력/error handling은 §3 상세 참고(routeUrl 파라미터, JSON 응답
`{success, data}`/`{success:false, error}` 통일 패턴, 전부 try/catch로
감싸 500 대신 빈 배열/에러 메시지로 정상 응답).

이 외에 학교 관련 **DB 저장/영속 route는 존재하지 않는다** — 아래 3개
route 전부 매 요청마다 외부 API를 직접 호출하고, DB에 school 데이터를
쓰는 코드는 프로젝트 전체에 0건이다(§6).

## 2. External API inventory

| source | endpoint | 제공 데이터 | key 필요 | 활성 여부 |
|---|---|---|---|---|
| **NEIS 교육정보 개방포털** | `open.neis.go.kr/hub/schoolInfo` | 학교 기본정보(이름/코드/종류/주소/설립구분/남녀공학/홈페이지 등, §7 필드 전체 나열) | `NEIS_API_KEY` | **활성** — `.env.local`에 실제 값(32자, `sample` 폴백 아님) 설정돼 있고, 이번 audit 중 1회 검증 호출로 `INFO-000 정상 처리` 응답 확인(부산 667개교) |
| **Kakao Local** | `dapi.kakao.com/v2/local/search/{keyword,category,address}` | 학교/학원 POI 좌표·주소(SC4=학교, AC5=학원), 아파트 POI 검색 | `NEXT_PUBLIC_KAKAO_MAP_API_KEY` | 활성(기존 apartment-score/지도 기능과 동일 키 재사용) |
| **공공데이터포털(MOLIT)** | `fetchMolitData` 공용 헬퍼 | `/api/school/apartments`에서 인근 아파트 실거래가만 조회(학교 데이터 아님) | `DATA_GO_KR_API_KEY` | 활성(기존 재사용) |
| **건축물대장(data.go.kr BldRgstService_v2)** | `getBrTitleInfo` | `/api/school/apartments`에서 아파트 준공연도만 조회(학교 데이터 아님) | `DATA_GO_KR_API_KEY` | 활성(기존 재사용) |

**학교알리미(schoolinfo.go.kr) 연동은 프로젝트 전체에 0건**이다 — 코드,
문서, 환경변수, 어디에도 참조가 없다(§8 grep 결과 0 files). 학생수/
학급수/교원현황/진학률 등은 NEIS `schoolInfo`에도 없는 값이라(§7 확인된
실제 응답 필드 목록에 없음), 현재 이 앱에 이 값들을 제공하는 source가
**아예 없다** — "연동은 됐는데 fetch 안 함"이 아니라 "source 자체가
없음"이다.

## 3. Environment variables

| 이름 | USED/UNUSED | 비고 |
|---|---|---|
| `NEIS_API_KEY` | **USED** | `/api/school`, `/api/school/stats` 2곳에서 사용. `.env.local`에 실값 설정, `.env`에는 없음(로컬 전용 관례로 보임 — 다른 키들도 `.env`/`.env.local` 분리 패턴 동일) |
| `NEXT_PUBLIC_KAKAO_MAP_API_KEY` | USED(학교 관련 3개 route + 스코어 엔진 등에서 공용 재사용) | 기존 키, 학교 전용 아님 |
| `DATA_GO_KR_API_KEY` | USED(학교 관련 route에서는 아파트 준공연도 조회에만 사용, 학교 데이터 자체와 무관) | 기존 키 재사용 |

학교 전용 신규 env var(예: `SCHOOL_API_KEY`, `KINDERGARTEN_API_KEY`,
`CHILDCARE_API_KEY`)는 **하나도 존재하지 않는다**(`.env`/`.env.local`
전체 스캔, 이름만 확인, 값 미출력).

## 4. DB/schema inventory

**`prisma/schema.prisma`에 School 관련 model이 전혀 없다.** 전체 23개
model(`grep '^model '`) 중 School/SchoolFeature/SchoolAccess/
ApartmentSchool 등은 0건이다. 학교와 조금이라도 관련된 필드는:

- `ApartmentLocationFeature.nearestElementaryDistanceM` /
  `elementaryCount1000m` — **초등학교만**, Kakao SC4 POI 카운트/거리일
  뿐 학교 자체의 레코드가 아니다(단지 기준 집계값, 학교 이름/코드/주소
  없음). Apartment Score Engine 전용(§10 BUSAN SCORE DATA V1 문서
  참고), `/school` 페이지들과는 완전히 별개 데이터.

**즉 이 프로젝트의 모든 학교 데이터는 DB에 저장되지 않고, 매 요청마다
NEIS/Kakao를 실시간 호출해서만 존재한다**(짧은 서버 메모리 캐시만
있음, §1). School PK/school code/학생수/학급수/교원 등을 담는 테이블
자체가 없다.

## 5. 기존 학교 데이터 coverage

DB에 School 테이블이 없어(§4) "DB read-only 집계" 자체가 불가능하다.
대신 이번 audit에서 NEIS API에 1회 검증 호출한 결과(부산, `ATPT_OFCDC_SC_CODE=C10`)로 대체 확인했다:

- **부산 전체 학교 수(NEIS 기준)**: 667개교(`list_total_count`)
- 초/중/고 세부 집계는 `/api/school/stats`가 매 요청 시 위 667건을
  region 필터링해 즉석 계산 — DB 집계가 아니라 **매번 실시간 재계산**
  이다(캐시도 없음, §1).
- 좌표: NEIS `schoolInfo`에는 좌표 필드가 없다(도로명주소만 있음).
  이 프로젝트는 학교 좌표가 필요할 때 Kakao 키워드 검색으로 별도
  조회한다(§15) — NEIS 학교 목록과 Kakao 좌표 검색 결과가 이름 문자열
  매칭으로만 연결되고, 있음/없음을 DB로 추적하지 않는다.
- schoolCode(`SD_SCHUL_CODE`): NEIS 응답에는 항상 존재하지만, 이
  프로젝트 코드는 `/api/school`의 목록 `id` 필드로만 잠깐 쓰고
  (§7) `/school/[id]` 상세 진입 시에는 **버려진다** — 상세페이지 URL은
  `schoolCode`가 아니라 `name`(학교명 문자열) 쿼리 파라미터로만
  이동한다(§16 identity 문제로 이어짐).

## 6. School Detail Page(`/school/[id]`) audit

실제 화면에 존재하는 카드는 **3개뿐**이다(코드 전문 확인,
`school-detail-client.tsx`):

| 카드 | 분류 | 근거 |
|---|---|---|
| 학년별 학생 수 추이(초등, 1~6학년 × 학생수/학급당인원) | **C. placeholder** | 표는 렌더링되지만 모든 셀이 하드코딩 텍스트 "데이터 준비 중" — 실제 데이터 fetch 없음 |
| 특목고·자사고 진학률(과학고/외고·국제고/자사고) | **C. placeholder** | 동일하게 전부 "데이터 준비 중" 고정 텍스트 |
| 인근 아파트 단지 목록 | **A. 실제 데이터 연동** | `/api/school/apartments` 실호출(Kakao+MOLIT+건축물대장), 로딩/빈 상태 처리 있음 |

`/school`(목록) 페이지에는 추가로:

| 카드 | 분류 |
|---|---|
| 지역 학교 수(초/중/고 합계) | A. 실제 연동(NEIS 실시간 집계) |
| 평균 특목고 진학률 | C. placeholder("데이터 준비 중" 고정, `specRate`는 코드가 항상 `null` 반환) |
| 주요 학원가 밀집(위치+개수) | A. 실제 연동(Kakao AC5 카테고리 실집계) — 단, Kakao 주소 검색 실패 시 `academyCount=-1`로 "데이터 수집 중..." 표시(E. fallback) |
| 학교 목록 아이템별 부가정보(중등 "학업성취도·특목고 진학률", 초등 "학급당 인원·통학 정보", 고등 "4년제 진학률") | C. placeholder(전부 "데이터 준비 중"), 단 고등학교 "유형"은 A(NEIS `HS_GNRL_BUSNS_SC_NM` 실값) |

**학생수/학급수/학급당 학생수/학년별 학생수/교원현황/늘봄·돌봄/
방과후/급식/배정·통학구역 카드는 이 프로젝트 화면 어디에도 존재하지
않는다** — "데이터 준비 중" 표시조차 없는 게 아니라, 애초에 해당
UI 자체가 없다(요청 문서의 §14 매트릭스에서 대부분 `NOT_FOUND`로
분류된 이유).

이전엔 아파트 상세페이지의 "학군" 탭에도 동일한 두 placeholder
카드(학생수 추이/특목고 진학률)가 있었으나, **STEP50 V1 CLEANUP에서
이미 제거되고 실데이터 카드(`SchoolDistrictPanel`의 "인근 학교" —
Kakao SC4 POI 5개)만 남아 있다**(코드 주석에 명시, 아파트 상세는
학교 placeholder 카드가 0개).

## 7. "데이터 준비 중" 원인

전부 동일한 원인이다: **source 자체가 없음**(카테고리로 보면 "API가
있는데 fetch 안 함"이 아니라 "그 값을 제공하는 API/데이터셋이 이 앱에
연결된 어떤 source에도 없음"). NEIS `schoolInfo`가 제공하는 필드는
§7(External API inventory 아님, 아래 §8) 목록이 전부이고, 학생수/
학급수/교원/진학률은 그 목록에 없다. 학교알리미(§2)가 이 값들을
제공할 가능성이 있는 유일한 후보 source지만 전혀 연동돼 있지 않다.

**과거 이력**: git log 확인 결과 `94c2aa0 fix: remove fabricated
school statistics`, `86a2258 fix: 하단 학군/교통/편의시설/단지상세
패널을 하드코딩 더미 데이터에서 실데이터로 교체` 커밋으로 예전에
존재했던 "학교명 문자열 해시로 만든 가짜 수치"(코드 주석이 명시)가
이미 제거됐다. **이번 audit에서 재확인한 결과 가짜 수치가 다시 남아있는
곳은 없다** — 전부 정직하게 `null`/"데이터 준비 중"으로 처리된다(§13).

## 8. NEIS integration audit — 실제 확인된 응답 필드

이번 audit 중 1회 검증 호출(`schoolInfo`, 부산, pSize=1)로 확인한
실제 응답 필드 전체:

```
ATPT_OFCDC_SC_CODE, ATPT_OFCDC_SC_NM, SD_SCHUL_CODE, SCHUL_NM,
ENG_SCHUL_NM, SCHUL_KND_SC_NM(학교종류), LCTN_SC_NM(소재지구분),
JU_ORG_NM(관할조직), FOND_SC_NM(설립구분: 공립/사립 등),
ORG_RDNZC(우편번호), ORG_RDNMA(도로명주소), ORG_RDNDA(상세주소),
ORG_TELNO(전화), HMPG_ADRES(홈페이지), COEDU_SC_NM(남녀공학구분),
ORG_FAXNO, HS_SC_NM(고교구분), INDST_SPECL_CCCCL_EXST_YN,
HS_GNRL_BUSNS_SC_NM(일반고/특성화고 등), SPCLY_PURPS_HS_ORD_NM(특목고
계열), ENE_BFE_SEHF_SC_NM, DGHT_SC_NM(주간/야간), FOND_YMD(설립일),
FOAS_MEMRD(개교기념일), LOAD_DTM
```

**현재 코드가 실제로 사용하는 필드는 4개뿐**: `SD_SCHUL_CODE`(목록
id로만), `SCHUL_NM`, `SCHUL_KND_SC_NM`(급별 필터), `HS_GNRL_BUSNS_SC_NM`
(고교 "유형" 표시). **나머지는 NEIS가 이미 제공하는데도 코드가
파싱하지 않고 버린다** — 특히 `FOND_SC_NM`(공립/사립), `COEDU_SC_NM`
(남녀공학 여부), `ORG_RDNMA`(도로명주소), `HMPG_ADRES`(홈페이지),
`ORG_TELNO`(전화번호)는 §14 매트릭스에서 요청된 항목 중 "새 API 없이
이미 있는 값으로 바로 채울 수 있는" 후보다(§46).

학생수/학급수/학년별 학생수/교원/진학/급식/학사일정은 NEIS
`schoolInfo` 응답에 **없다**(별도 NEIS 엔드포인트 — 급식식단정보
`mealServiceDietInfo`, 학사일정 `schoolSchedule` 등 — 자체가 이
프로젝트에 전혀 연동돼 있지 않음, §11에서 확인). 없는 데이터를
있다고 추정하지 않는다(사용자 지시 원칙 그대로 확인).

## 9. 학교알리미 integration audit

**0건.** 코드/문서/환경변수 전체에서 "학교알리미", "schoolinfo.go.kr",
"mealService", "schulAflco", "schoolSchedule", "공시정보" 등 관련
문자열이 단 한 곳도 없다(전수 grep 확인). 학생수/학급수/학년별
학생수/교원/설립구분(중복, NEIS에 이미 있음)/남녀공학(중복)/특수학급/
방과후/돌봄·늘봄/진학 — 이 항목들을 제공할 수 있는 유일한 현실적
후보(공공데이터포털에 학교알리미 공시자료가 일부 공개돼 있음)가 이
프로젝트에는 전혀 연동되지 않은 상태다.

## 10. 유치원 audit

**API/DB/raw file/route/component 전부 0건.** "유치원", "kindergarten",
"유치원알리미", "e-childschool" 어떤 키워드로도 전용 코드가 없다.
유치원이 등장하는 유일한 곳은 Kakao Local `PS3` 카테고리인데, 이는
**Kakao 자체가 "어린이집,유치원"을 하나로 묶어 분류**하는 카테고리라
(코드 주석에 실측 확인 기록) 유치원만 따로 셀 수도, 식별할 수도 없다.
정원/현원, 국공립/사립, 운영시간 등은 전혀 다루지 않는다.

## 11. 어린이집 audit

**유치원과 동일하게 API/DB/raw file/route/component 전부 0건.**
"어린이집", "childcare", "daycare", "보육", "아이사랑", "보육통합"
어떤 키워드로도 전용 코드가 없다. 유일한 흔적은 Kakao `PS3`
카테고리(§10과 동일 — 유치원과 구분 불가) 두 곳에서의 사용:

1. `apartment-score/collectors/location.ts` — 단지 반경 500m 내
   `daycareKindergartenCount500m`(개수만, `ApartmentLocationFeature`에
   저장) — Score Engine의 `living` 카테고리 sub-metric 중 하나일 뿐,
   어린이집 자체의 상세 데이터가 아니다.
2. `LivingEnvironmentPanel.tsx`(아파트 상세) — 같은 PS3 카운트를
   "🧸 어린이집·유치원" 카드로 표시(개수만, Kakao 실시간 조회).

정원/현원/운영시간/연장보육/통학차량 등은 어디에도 없다.

## 12. 학교 거리/도보시간 방식 재확인

**둘 다 B(직선거리 기반 근사), 실제 보행경로 API 아님** — BUSAN SCORE
DATA V1 §2에서 이미 확인된 사실을 이번 STEP에서 `/api/school/apartments`
코드 전문으로 재확인:

- 거리 자체: `@turf/turf`의 `distance()`(대권거리/직선거리, km)
- 도보시간: `realDistance = dist * 1.45`(보정계수) → `walkMin =
  round(realDistance*15) + 구간별 padding(0.1km↑ +4, 0.5km↑ +3)`,
  최소 3분
- **"송도 +5분" 하드코딩은 이미 제거된 상태**(BUSAN SCORE DATA V1
  §1에서 제거, 이번 STEP은 수정 금지 지시에 따라 손대지 않고 코드
  주석으로 제거 사실만 재확인)
- **새로 발견(이번 STEP)**: `resolveSchoolAndApartments()` 내부에
  Kakao 키워드 검색이 실패했을 때 쓰는 **좌표 하드코딩 폴백**이 여전히
  존재한다 — 학교명에 "대신/경남/부경/중앙/구덕/동신/화랑"이 포함되면
  대신동 좌표로, "송도/천마/알로이시오"면 송도동 좌표로, "초장/남부/
  아미/토성"이면 충무동 좌표로 임의 지정한다(전부 서구 특정 동
  이름 기준). "송도 +5분"과는 다른 코드지만 같은 성격의 **지역
  하드코딩 잔존**이다 — 이번 STEP은 audit only라 수정하지 않고
  기록만 남긴다(§18 legacy 목록에도 포함).

## 13. Apartment ↔ School identity

연결 key가 **schoolCode가 전혀 아니다.** 실제 흐름:

1. `/school`(목록) → NEIS로 학교 목록 조회 → 사용자가 클릭 → `name`
   문자열 + (있으면) `lat`/`lng`를 쿼리 파라미터로 다음 페이지에 전달
2. `/school/[id]` → 그 `name` 문자열만으로 `/api/school/apartments`
   재호출 → **학교명으로 Kakao 키워드 재검색**(§12 폴백 로직 포함)해
   좌표를 다시 얻고 반경 1.5km 아파트를 찾음

즉 NEIS의 `SD_SCHUL_CODE`(고유 학교 코드)는 최초 목록 렌더링 후
버려지고, 그 다음 단계부터는 **학교명 문자열 매칭에 전적으로
의존**한다. 동명이인(같은 이름의 학교가 다른 구에 있는 경우), 폐교,
이전 등에 대한 방어 로직은 없다 — 다만 `lawdCd`(지역)가 함께
전달되므로 완전히 무작위 지역으로 새는 것은 아니고, Kakao 키워드
검색 자체가 통상 근접 지역을 우선 반환하는 데 의존한다(정식 식별자
기반 방어는 아님).

아파트 쪽 identity: `/api/school/apartments`가 반환하는 "인근 아파트"는
Kakao POI 검색 결과의 `place_name`을 `normalizeAptName()`으로 정규화해
MOLIT 실거래 데이터와 매칭한다 — 프로젝트 전역에서 이미 쓰이는 동일한
퍼지 매칭 관례(§41/§52 원칙과 동일 계열)이고 이 route 전용의 새로운
매칭 로직은 아니다.

## 14. School type correctness

두 갈래로 나뉜다:

- **API 레벨(`/api/school`, `/api/school/stats`)**: NEIS의 실제
  `SCHUL_KND_SC_NM`(학교종류) 필드로 정확히 분류 — 신뢰할 수 있는
  authoritative source.
- **화면 레벨(`/school/[id]`, `/map`)**: `classifySchoolLevel()`이라는
  **이름 접미사 문자열 매칭**(`.includes('초등학교')` 등) fallback을
  쓴다 — NEIS 필드를 넘겨받지 못하는 진입 경로(예: Kakao POI 검색
  결과로 마커를 그리는 지도, 목록에서 넘어온 `name` 파라미터만 있는
  상세페이지)에서 다시 분류해야 하기 때문이다. 두 지도/상세 파일
  (`map/page.tsx`, `school-detail-client.tsx`)에 **동일한 로직이
  중복 구현**돼 있다(공유 유틸리티 없음).

이름에 "초등학교"/"중학교"/"고등학교"가 포함되지 않는 특수 학교명이
있다면 이 fallback은 분류 실패(`null`)로 안전하게 빠진다(임의 추정
안 함, 확인됨) — 다만 정확도는 NEIS 필드보다 구조적으로 낮다.

## 15. Legacy / dead code / fake data

- **fake 진학률/학생수 수치**: 과거 존재했으나 이미 제거됨(§9, 커밋
  `94c2aa0`, `86a2258`). **이번 audit에서 재발 확인 결과 0건** — 남아있는
  건 전부 명시적 "데이터 준비 중"/`null`이다.
- **지역 좌표 하드코딩 fallback**: `/api/school/apartments`의 서구
  특정 동 이름 매칭(§12) — 살아있는 코드, 가짜 데이터는 아니지만
  지역 하드코딩 잔존.
- **`classifySchoolLevel` 이름 매칭 fallback 중복**: `map/page.tsx`와
  `school-detail-client.tsx`에 동일 함수가 각각 구현(§14) — dead code는
  아니고 둘 다 실사용 중이지만 통합 여지가 있는 중복.
- **미사용 NEIS 필드**: §8에서 확인한 20개 필드 중 16개가 파싱되지
  않고 버려짐 — dead code라기보다 "이미 받은 데이터를 안 쓰는" 낭비.
- **`academyCount = -1` 센티널**: 실패를 나타내는 매직넘버(§6) —
  버그는 아니나 타입으로 명시적 상태(`null`/`enum`)를 쓰는 편이
  나을 수 있는 코드 스멜. 이번 STEP에서 수정하지 않음.

## 16. 중복 source(같은 데이터를 여러 곳에서 각자 수집)

**"근처 초등학교 찾기"가 프로젝트 전체에 4곳에서 독립 구현**돼 있다
(전부 Kakao SC4 카테고리를 각자 호출, 공유 유틸리티 없음):

| 위치 | 반경 | 용도 | 영속 여부 |
|---|---|---|---|
| `apartment-score/collectors/location.ts` | 1000m | Score Engine feature 수집 | `ApartmentLocationFeature`에 저장(30일 TTL) |
| `lib/ai-search.ts::findNearestElementarySchool` | 500m | AI 검색 "초품아" 조건 필터링 | 저장 안 함, on-demand |
| `components/KakaoPlaces.tsx`(SchoolDistrictPanel 경유) | 미지정(limit=5) | 아파트 상세 "인근 학교" 카드 | 저장 안 함, client-side 실시간 |
| `app/map/page.tsx` | 지도 뷰포트 기준 | 지도 학교 마커 | 저장 안 함, client-side 실시간 |

각자 목적이 달라(하나는 영속 feature, 셋은 즉시 UI) 당장 통합이
필수는 아니지만, **NEIS 학교 목록(§1) vs Kakao SC4 POI 검색(§16 위
4곳) 사이에는 어떤 교차 검증도 없다** — 같은 학교라도 NEIS 이름/코드와
Kakao POI 이름이 100% 일치한다는 보장이 코드로 확인되지 않는다(둘
다 신뢰할 만한 source지만 서로 다른 시스템이라 표기가 다를 수 있음,
실측 불일치 사례를 이번 audit에서 직접 찾지는 않았음 — 범위 밖).
**source of truth 제안(확정 아님, 다음 STEP 논의용)**: 학교 "정체성"
(이름/코드/종류/주소)은 NEIS를 canonical로, "좌표"는 Kakao를
canonical로 — 지금처럼 이름 문자열로만 둘을 잇지 말고 NEIS
`SD_SCHUL_CODE`를 계속 들고 다니면 identity 리스크(§13)가 줄어든다.

## 17. API 비용/제한

코드/문서에서 확인 가능한 범위만(추정 없음):

| API | 비용 | rate limit | cache TTL | batch |
|---|---|---|---|---|
| NEIS `schoolInfo` | 코드/문서에 비용 정보 없음(공공 Open API, 통상 무료로 알려져 있으나 이 코드베이스 안에서 명시적으로 확인되지는 않음) | 코드에 명시적 rate-limit 처리 없음(페이지네이션만 있음, 429 대응 로직 없음) | `/api/school` 10분, `/api/school/stats` **없음**(매 요청 실호출) | 가능(pSize=500 페이지네이션 이미 사용 중) |
| Kakao Local | 기존 프로젝트 관례상 유료/무료 등급 존재(이 route들 자체엔 문서화 없음, apartment-score 쪽 문서에 "150ms 페이싱/429 1회 재시도" 관례가 있으나 학교 관련 3개 route에는 그 관례가 적용돼 있지 않음) | 없음(429 시 단순 `if(!res.ok) break`로 조용히 빈 결과) | 없음(school/stats), 5분(school/apartments) | 아니오 |

## 18. 개인정보/민감정보

**학생/교사 개인 단위 정보를 저장하는 구조는 없다.** NEIS
`schoolInfo`는 학교 단위 공개 정보만 제공하고(개인정보 아님), 이
프로젝트는 그마저도 DB에 저장하지 않는다(§4). 코드 전체에서
학생/교사 개인 식별 데이터를 다루는 로직은 발견되지 않았다.

## 19. 학부모 핵심정보 coverage map

**[영유아]**

| 항목 | 상태 |
|---|---|
| 어린이집 위치 | UI_ONLY(PS3 카운트만, 개별 위치 리스트 아님) |
| 어린이집 유형 | NOT_FOUND |
| 정원/현원 | NOT_FOUND |
| 운영시간 | NOT_FOUND |
| 연장보육 | NOT_FOUND |
| 통학차량 | NOT_FOUND |
| 유치원 위치 | UI_ONLY(어린이집과 동일 PS3 카운트에 섞여 있음, 분리 불가) |
| 국공립/사립 | NOT_FOUND |
| 정원/현원 | NOT_FOUND |

**[초등]**

| 항목 | 상태 |
|---|---|
| 실제 거리 | AVAILABLE(Kakao POI 기준 직선거리) |
| 도보시간 | PARTIAL(직선거리×보정계수 근사, 실제 보행경로 아님) |
| 학생수 | NOT_CONNECTED(source 없음) |
| 학급수 | NOT_CONNECTED |
| 학급당 학생수 | NOT_CONNECTED |
| 학년별 학생수 | UI_ONLY(표 UI는 있으나 전부 placeholder) |
| 교원 | NOT_FOUND |
| 늘봄/돌봄 | NOT_FOUND |
| 방과후 | NOT_FOUND |
| 급식 | NOT_FOUND |
| 통학구역 | NOT_FOUND |
| 주변 학원/도서관 | PARTIAL(학원만 Kakao AC5로 지역 집계, 도서관은 없음) |

**[중등]**

| 항목 | 상태 |
|---|---|
| 학생수/학급수/학급당 학생수 | NOT_CONNECTED |
| 남녀공학 | NOT_CONNECTED(NEIS `COEDU_SC_NM`에 실제로 있으나 코드가 안 씀, §8) |
| 교원 | NOT_FOUND |
| 자유학기 | NOT_FOUND |
| 방과후 | NOT_FOUND |
| 배정권역 | NOT_FOUND |
| 진학 관련 공식정보 | UI_ONLY(placeholder만) |

**[고등]**

| 항목 | 상태 |
|---|---|
| 학교유형 | AVAILABLE(NEIS `HS_GNRL_BUSNS_SC_NM` 실연동) |
| 학생수/학급수 | NOT_CONNECTED |
| 교원 | NOT_FOUND |
| 교육과정 | NOT_FOUND |
| 특색프로그램 | NOT_FOUND |
| 기숙사 | NOT_FOUND |
| 진학 관련 공식정보 | UI_ONLY(placeholder만) |

## 20. SCHOOL V2 재사용 가능 자산

| 자산 | 분류 | 사유 |
|---|---|---|
| NEIS `schoolInfo` 연동(3개 route) | **EXTEND** | 키/호출 방식 정상 작동, 미사용 필드(§8) 파싱만 추가하면 즉시 자산 확대 |
| `/api/school/apartments`(Kakao+MOLIT+건축물대장) | **KEEP** | 잘 작동하는 크로스 소스 조합, 캐시도 있음 |
| `neis-sido-codes.ts`(교육청 코드/주소 매칭) | **KEEP** | 정확도 개선 이력 있는 안정적 유틸(강서구/서구 등 substring 오매칭 이미 수정된 버전) |
| `getOrSetCache`(server-cache.ts) | KEEP | 범용, 학교 전용 아님 |
| `/api/school/apartments`의 좌표 하드코딩 폴백(§12) | **REPLACE 후보** | Kakao 검색 실패 시의 임시방편, 정식 학교 좌표 source(NEIS엔 좌표 없음 — Kakao 재시도/캐시가 더 나은 방향) 확보되면 대체 |
| `classifySchoolLevel` 중복 구현 2곳(§14) | **REPLACE 후보(통합)** | 로직 자체는 KEEP, 공유 유틸로 합치는 게 좋음 |
| "학년별 학생수"/"특목고 진학률" placeholder UI(§6) | **DEPRECATE 또는 REPLACE** | 학교알리미 연동(§21) 전까지는 UI 자체가 항상 실패하는 카드 — 이미 아파트 상세에서는 제거된 선례(STEP50) 그대로 `/school` 쪽도 검토 대상 |
| `academyCount=-1` 센티널(§15) | UNKNOWN(작은 리팩터 후보, 우선순위 낮음) | |

## 21. External source candidate — 이미 알려졌으나 미연동

- **학교알리미(schoolinfo.go.kr) 공시정보** — 학생수/학급수/교원/
  진학률/방과후/돌봄 등 §19에서 NOT_FOUND로 표시된 대부분을 해소할
  유일한 현실적 후보. 코드/문서 어디에도 실제 연동 흔적 없음(§9) —
  공공데이터포털에 관련 데이터셋이 공개돼 있는지, API 형태인지 CSV
  배치 형태인지는 이번 audit 범위(코드 기준 조사)에서 확인되지
  않았다 — **source부터 조사 필요**(§24 C 분류).
- **NEIS 기타 엔드포인트**(급식식단정보 `mealServiceDietInfo`,
  학사일정 `schoolSchedule` 등) — 존재는 알려져 있으나(NEIS Open API
  하브에 공개된 엔드포인트) 이 프로젝트에는 schoolInfo 외 연동 0건.
- **어린이집/유치원 공공데이터**(예: 임신육아종합포털 "아이사랑" 유사
  공개 데이터셋) — 코드/문서에 후보로조차 언급된 적이 없다(§10/§11).

## 22. 개인정보/민감정보 — §18과 동일 내용(§26 문서 인덱스 순번 유지용 중복 언급 없음)

## 23. 최종 추천 — A/B/C 분류

**A. 이미 연동됨 → 바로 재사용**
- 학교 기본정보(이름/코드/종류/주소 등 NEIS `schoolInfo`)
- 학교 지역별 개수 집계
- 고교 유형(일반고/특성화고 등)
- 인근 아파트 목록(거리/실거래가/준공연도)
- 학원가 밀집도(Kakao AC5)
- Kakao 기반 "인근 학교" POI 카드(아파트 상세)

**B. API/source 있음 → 연결만 필요(신규 API 신청 불필요)**
- 설립구분(공립/사립) — NEIS `FOND_SC_NM`
- 남녀공학 여부 — NEIS `COEDU_SC_NM`
- 홈페이지/전화/도로명주소 — NEIS `HMPG_ADRES`/`ORG_TELNO`/`ORG_RDNMA`
- 특목고 계열 표시 — NEIS `SPCLY_PURPS_HS_ORD_NM`

**C. source부터 새로 조사 필요**
- 학생수/학급수/학급당 학생수/학년별 학생수/교원현황/진학률(학교알리미
  또는 동급 공식 통계 조사 필요)
- 늘봄/돌봄/방과후/급식/통학구역/배정권역
- 유치원/어린이집 상세(위치 개별 목록/유형/정원현원/운영시간 등) —
  Kakao PS3는 개수만 제공, 상세 속성 없음
- 실제 보행경로 기반 도보시간(현재는 직선거리 근사)

## 24. SCHOOL V2 작업 분해 제안(실제 결과 기반 재설계)

- **SCHOOL V2-A: Existing Integration Cleanup** — NEIS 미사용 필드
  파싱 추가(§8 B그룹), `classifySchoolLevel` 중복 통합(§14/§20),
  좌표 하드코딩 폴백 정리(§12/§20), `academyCount` 센티널 정리. 신규
  API 없이 가능, 낮은 리스크.
- **SCHOOL V2-B: Official Data Expansion** — 학교알리미(또는 동급
  공식 source) 실제 존재 여부/형태 조사부터 시작(§21 C 그룹). 학생수/
  학급수/교원/진학 등 §19 NOT_FOUND 대부분이 여기 걸림 — **본
  조사가 SCHOOL V2 착수의 진짜 병목**.
- **SCHOOL V2-C: Distance/Route Accuracy** — 실제 보행경로 API 도입
  검토(§12), 4곳 중복 SC4 호출(§16) 통합 여부 설계.
- **SCHOOL V2-D: Parent Decision UX** — §19 매트릭스에서 AVAILABLE/
  PARTIAL로 이미 확보된 항목만으로 우선 화면 재구성(거리/실거래가/
  학교유형/학원가), placeholder 카드는 실제 source 확보 전까지
  DEPRECATE 검토.
- **SCHOOL V2-E: Kindergarten/Childcare** — 완전히 새로운 영역(§10/
  §11 전부 NOT_FOUND) — source 조사부터 별도 STEP으로 분리 권장(부동산
  앱 핵심 스코프인 초중고보다 우선순위는 낮게 판단되나 결정은 사용자
  몫).

## 25. Unresolved / 확인 필요

- NEIS API의 실제 요금제/제한(무료 여부, 일일 호출 한도)이 코드/문서
  어디에도 명시돼 있지 않다 — 공식 문서 확인 필요(추정 금지 원칙상
  이번 문서에도 단정하지 않음).
- 학교알리미 데이터가 실제로 공공데이터포털을 통해 API/배치 형태로
  받을 수 있는지 자체가 미확인 — SCHOOL V2-B의 첫 조사 항목.
