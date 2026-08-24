# SCHOOL V2-C6-A — 부산 공식 통학구역 실데이터 빌드

## 목적

SCHOOL V2-C6에서 학구도안내서비스(한국교육시설안전원)를 공식 source로 확정하고
(`ATTENDANCE_ZONE_LEGAL_GATE = CLEARED`), 부산 7개 아파트 표본을 라이브 GIS UI로
파일럿 검증했다. 이번 STEP은 사용자가 실제로 다운로드한 공식 SHP/CSV 원본 파일을
사용해 (1) geometry를 실제로 검증하고, (2) 부산 전체 학구 데이터를 추출하고,
(3) canonical School과 identity를 연결하고, (4) 부산 ApartmentMaster 전체
(3,402건)에 대해 point-in-polygon을 실행하고, (5) 실제 coverage를 측정하고,
(6) 공동학구를 검증하고, (7) SCHOOL V2-D가 바로 쓸 수 있는 결과 구조를 확정하는
것이 목적이다. DB/schema 변경, production write, main merge, Score 변경은
이번 STEP 범위 밖이다(전부 미수행).

## 0. 원본 데이터

사용자가 다운로드한 폴더: `D:\anti2\aaa\schoolzone-data\`

| 파일 | 크기 | 수정시각 |
|---|---|---|
| 한국교육시설안전원_초등학교통학구역_20260320.zip | 35,279,077 bytes | 2026-08-22 02:32 |
| 한국교육시설안전원_중학교학교군_20260320.zip | 23,256,982 bytes | 2026-08-22 02:41 |
| 한국교육시설안전원_학교학구도연계정보_20260320.csv | 2,016,746 bytes | 2026-08-22 02:37 |

## 1. 파일 inventory

두 ZIP 모두 동일 구조(SHP + sidecar 4종 + QGIS 메타데이터):

```
{데이터셋명}.cpg   — 인코딩 태그: EUC-KR
{데이터셋명}.dbf   — 속성 테이블
{데이터셋명}.prj   — 좌표계 정의(WKT)
{데이터셋명}.qmd   — QGIS 메타데이터(내용 대부분 비어있음, 참고용 아님)
{데이터셋명}.shp   — geometry
{데이터셋명}.shx   — geometry 인덱스
```

CSV는 단일 평문 파일, EUC-KR 인코딩, 헤더 1행 + 17,985 데이터 행.

파일명만으로 schema를 추정하지 않고, 실제 `.dbf`/CSV 컬럼을 파싱해 분류했다(§5).
초등/중학교 SHP 모두 **동일 스키마**(HAKGUDO_ID/HAKGUDO_NM/HAKGUDO_GB/SD_CD/SGG_CD/
EDU_UP_CD/EDU_UP_NM/EDU_CD/EDU_NM/CRE_DT/UPD_DT/BASE_DT)를 공유한다 — "학구"라는
동일 개념의 서로 다른 학교급 인스턴스이기 때문으로 판단된다(실측, 문서 추정 아님).

분류:
- 초등학교통학구역.shp → elementary attendance zone (1:1 + 공동통학구역)
- 중학교학교군.shp → middle school group/district (학교군, 중학구)
- 학교학구도연계정보.csv → school-zone linkage(학구ID↔학교ID, 초/중/고 전체 포함)

고등학교 SHP, 별도 middle school district-only 파일은 사용자가 다운로드하지 않아
이번 STEP에서 다루지 않는다(범위 밖, 미확보 — 오류 아님).

## 2. 실제 geometry 확인

**CRS**: `.prj` WKT를 그대로 옮기면 `Korea_2000_Korea_Central_Belt_2010`
(EPSG:5186) — Transverse Mercator, central meridian 127°, false easting
200000/northing 600000, GRS80 타원체, 단위 meter. `proj4` 정의
`+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs`
를 PRJ 파라미터에서 직접 옮겨 적용했다(추정 아님).

WGS84(EPSG:4326)로 변환 후 부산 좌표 범위(lng 128.7~129.3, lat 35.0~35.4)로
sanity check — 장림초통학구역 변환 결과 `[128.97, 35.08]`로 실제 사하구 장림동
위치와 일치함을 확인했다(`scripts/education/c6a-05-verify-crs-and-csv.ts`).

**Geometry type**: Polygon 및 MultiPolygon 혼재(단일 zone이 물리적으로 떨어진
여러 구역으로 나뉘는 경우 MultiPolygon).

**Record count**: 전국 초등학교통학구역 7,140건, 전국 중학교학교군 1,684건.

**Field list**: OBJECTID, HAKGUDO_ID("Z"+9자리), HAKGUDO_NM, HAKGUDO_GB(0/1),
SD_CD, SGG_CD, EDU_UP_CD/NM, EDU_CD/NM, CRE_DT, UPD_DT, BASE_DT(2026-03-20),
ESRI_OID.

## 3. geometry quality audit

전국 규모(7,140+1,684건)에서 `turf.booleanValid`/`turf.kinks`(self-intersection)를
전량 실행했더니 CPU가 과도하게 소모돼(약 400 CPU초 후에도 미완료) 중단했다 —
**임의로 결과를 지어내지 않고** 스코프를 재조정했다: 전국은 경량 스캔(레코드 수,
geometry type, bbox)만, 실제 사용 대상인 **부산 subset은 전량 정밀 검사**.

| | 부산 초등(n=308) | 부산 중학교군(n=24) |
|---|---|---|
| valid | 305 | 24 |
| invalid | 3 | 0 |
| empty | 0 | 0 |
| self-intersection(kinks) | 3 | 0 |
| multiPolygon | 21 | 6 |
| holes(2+ part/ring) | 5 | 0 |
| 부산 bounds 밖(sanity) | 0 | 0 |
| 중복 zoneId | 0 | 0 |

invalid 3건: **장림초통학구역(Z000100598), 개포초통학구역(Z000100618),
신덕초통학구역(Z000100772)** — 자체교차(self-intersecting polygon). 임의 수정
(repair)하지 않았고, 이 3개 zone에 매칭된 아파트 **25건**을 `geometryInvalid`
플래그로 결과에 별도 표기했다(§10, §13).

## 4. 부산 데이터 추출

- `BUSAN_ELEMENTARY_ZONE_COUNT` = 308 (단일 286 + 공동통학구역 22)
- `BUSAN_SHARED_ZONE_COUNT` = 22 (대칭 14 + 비대칭"일방" 8)
- `BUSAN_MIDDLE_GROUP_COUNT` = 24 (전부 HAKGUDO_GB=0 — 부산은 중학교 공동학구
  타입이 SHP상 관측되지 않음)
- `BUSAN_MIDDLE_DISTRICT_COUNT` = 학교군 개념과 별도의 "중학구"(단일교) 포함,
  §9 분포표 참고

## 5. 학구도 attribute schema (실측)

**SHP** (§2 field list 동일).
**CSV** (`학교학구도연계정보`): `학구ID, 학교ID, 학교명, 학교급구분,
시도교육청코드, 시도교육청명, 교육지원청코드, 교육지원청명, 데이터기준일자`.
zone code(학구ID)/zone name(HAKGUDO_NM, SHP 쪽)/school code(학교ID)/school
name/sido/sigungu(EDU_NM으로 간접 표현, §6)/school group(zoneName 파싱, §11)/
shared-zone indicator(HAKGUDO_GB)/directionality("(일방)" 문자열)/year
(BASE_DT)/effective date(BASE_DT)까지 전부 실 파일에서 확인. "priority(큰/작은)"
전용 필드는 **CSV/SHP 어디에도 없다** — zoneName 토큰 순서로만 유추 가능(§11).

## 6. 공식 school identifier

CSV의 학교ID는 예측대로 **"B"+9자리**(예: `B000002463`) — C6에서 예상한
OFFICIAL_OTHER_CODE 그대로 재확인됐다.

**새 발견**: SHP의 zone identifier(HAKGUDO_ID)도 별도 코드 체계 — **"Z"+9자리**
(예: `Z000100598`). 두 코드 모두 NEIS `neisSchoolCode`/SchoolInfo `SCHUL_CODE`와
호환되지 않는 제3의 체계다. 직접 동일 코드로 가정하지 않고 §7 이름 기반 resolver로
연결했다.

**부수 발견(중요)**: SHP의 `SD_CD`+`SGG_CD`를 이어붙이면 이 프로젝트가 이미 쓰는
`School.sigunguCode`(=MOLIT lawdCd, 5자리)와 **완전히 동일한 포맷**이다. 부산
16개 구·군 전부(`SD_CD='26'` + `SGG_CD` 3자리)를 canonical `School.sigunguCode`
분포(26110~26710)와 대조해 **16/16 정확히 일치**함을 실측 확인했다
(`scripts/education/c6a-04-verify-lawdcd-hypothesis.ts`) — 별도 crosswalk
테이블 없이 SHP 속성만으로 지역 조인이 가능함을 뜻한다.

## 7. identity resolver

`scripts/education/lib/zone-school-identity-resolver.ts` — C2B-A
(`schoolinfo-identity-resolver.ts`)와 동일 원칙(이름 fuzzy matching 금지, 접미사
제거 금지, 모호하면 자동 merge 금지)을 그대로 적용했다.

1차: 이름(정규화만, suffix 제거 없음) + zone의 lawdCd(§6) + 학교급 버킷
(초/중/고/특수/기타) 정확 일치 → 유일하면 HIGH.
2차(신규): 1차에서 실패하면 **부산 전역**에서 이름+학교급 정확 일치 재검색 →
유일하면 MEDIUM(교차구역 표시), 2건 이상이면 LOW, 0건이면 NO_MATCH.

2차 tier를 추가한 이유: 1차만으로 부산 초등 링크 338건 중 19건이 NO_MATCH였는데,
실제로 조사해보니 그중 18건(금성초등학교 8건, 공덕초등학교 8건, 주학초/양동초/
개림초 각 1건)이 **공동(일방)통학구역의 opt-in 대상 학교가 zone을 관할하는
교육지원청과 다른 구·군에 실제로 위치**하는 사례였다(예: 금성초·공덕초는
canonical sigunguCode=26410(금정구)인데, 이들을 opt-in 대상으로 포함하는 zone은
26260/26320/26470 소속으로 등록돼 있음 — `scripts/education/c6a-12-check-specific-schools.ts`
로 실측). 이건 데이터 오류가 아니라 **공동학구가 행정구역 경계를 넘을 수 있다는
실제 구조적 사실**이다. fuzzy matching이 아니라 탐색 범위만 넓힌 정확 매칭이므로
안전하다고 판단해 채택했다.

나머지 1건(신연초등학교(휴교), zoneId=Z000100648)은 canonical에 "신연초등학교"
(괄호 없음, isActive=true)가 있으나 CSV 쪽 이름에 "(휴교)"가 붙어 있어 정확 매칭이
실패한 것 — 실제 휴교 여부를 이 STEP에서 판단할 근거가 없어 **NO_MATCH로 정직하게
남겼다**(임의로 붙이거나 떼지 않음).

`scripts/education/lib/zone-school-identity-resolver.test.ts` — 10개 fixture
테스트(유일 매칭/다른 lawdCd/다른 학교급/중복 후보/빈 pool/이름 정규화/버킷 분류/
교차구역 MEDIUM/교차구역도 모호하면 LOW/통합 시나리오).

## 8. 부산 school-zone identity coverage

부산 초등 학구-학교 링크 338건 기준:

| confidence | count |
|---|---|
| HIGH | 319 |
| MEDIUM(교차구역) | 18 |
| LOW | 0 |
| NO_MATCH | 1 |

`TRUE_ZONE_SCHOOL_IDENTITY_COVERAGE`(HIGH만) = 319/338 = **94.4%**
`USABLE_ZONE_SCHOOL_IDENTITY_COVERAGE`(HIGH+MEDIUM) = 337/338 = **99.7%**

공동통학구역에 여러 학교가 연결되는 것은 정상이므로 중복 오류로 세지 않았다
(338건 = 고유 zone-school 쌍 개수, zone 개수 아님).

## 9. Apartment universe

`TOTAL_BUSAN_APARTMENTS` = **3,402** — Score 작업 당시와 동일(변동 없음,
`sggCd LIKE '26%'` 기준 재확인).

좌표 있는 단지: **3,401**건. 좌표 없는 1건은 `에코델타호반써밋스마트시티`
(강서구 강동동, aptSeq=26440-147) — point-in-polygon 대상에서 `COORDINATE_MISSING`으로
분리했다.

## 10. 부산 전체 point-in-polygon

`scripts/education/lib/attendance-zone-matcher.ts`(순수 함수, 12개 fixture
테스트) + `scripts/education/c6a-10-busan-full-pipeline.ts`(실행 스크립트)로
3,402건 전체 실행. bbox 사전 필터는 정확도 손실 없이(모든 zone과 실제 polygon
판정 전 저비용 배제만) 성능을 확보했고, **lawdCd로 미리 자르지 않았다** — 학구가
구·군 경계와 정확히 일치한다는 가정을 검증 없이 쓰지 않기 위해서다(실제로 §7에서
확인했듯 그 가정이 항상 성립하진 않는다). boundary(경계선) 위 점은 turf 기본 동작
그대로 "내부"로 처리했다(명시적 정책, §14).

| status | count |
|---|---|
| MATCHED_SINGLE | 3,191 |
| MATCHED_SHARED | 76 |
| IDENTITY_UNRESOLVED | 130 (§8 MEDIUM 129건 + 진짜 NO_MATCH 1건) |
| OVERLAP | 0 |
| NO_MATCH(zone 밖) | 4 |
| COORDINATE_MISSING | 1 |
| **합계** | **3,402** |

## 11. 공동통학구역 처리

zoneName에서 학교명 토큰을 순서대로 추출하는 `parseZoneSchoolNameTokens()`를
만들었다: `"온천초공덕초금성초공동(일방)통학구역"` → `["온천초", "공덕초", "금성초"]`.
CSV linkage로 실제 연결된 학교 집합과 대조해 **정확히 일치**함을 확인했다
(예: zoneId=Z000151624는 CSV상 금성초/온천초/공덕초 3개교와 연결 — zoneName
파싱 결과와 동일).

**C6(라이브 GIS UI 파일럿) 재현 검증**:
- `향원에이스타운(79)`(서구 서대신동2가) → `대신초동신초공동통학구역`
  [대신초 HIGH, 동신초 HIGH] — **C6 라이브 파일럿 결과와 완전 일치**.
- `신화타워`(동래구 온천동) → `온천초공덕초금성초공동(일방)통학구역`
  [온천초 HIGH, 공덕초 MEDIUM, 금성초 MEDIUM] — **C6 라이브 파일럿에서 관찰한
  "온천초=큰(547m)/금성초·공덕초=작은" 순서와 zoneName 첫 토큰이 온천초로
  일치**.

토큰 순서가 "큰(우선)/작은(opt-in)" 관계를 나타낸다는 것은 이 1건의 교차검증과
zoneName 명명 패턴("(일방)"이 붙는 zone은 항상 자기 학교명이 먼저 오고 opt-in
대상 학교가 뒤따름)으로 뒷받침되지만, **명시적 우선순위 필드가 아니라 명명 규칙
추론**이므로 UI에는 확정적 "큰/작은" 표현 대신 §18 원칙을 따른다.

geometryInvalid 3개 zone(§3)에 매칭된 아파트 **25건**은 결과 레코드에 플래그로
남겼다(리스트: 한진, 그린코아, 상록한신휴플러스, 스마트더블유, 장림3차동원 등
— 대부분 장림초통학구역 소속, 사하구 장림동 밀집).

## 12. nearest vs attendance comparison

School 테이블은 좌표 커버리지가 **0%**(C5-B 확인 사항 그대로, 이번 STEP에서도
재확인 — DB write 금지라 채우지 않음)라서, "nearest" 비교를 위해 부산 초등학교
canonical 305건(고유 이름 304건)을 **읽기 전용으로 Kakao 키워드 검색 geocoding**
했다(DB에 저장하지 않음, scratchpad 캐시만). 304/304 성공.

| | count | 비율(3,397건 기준*) |
|---|---|---|
| SAME(최근접=zone 학교) | 2,452 | 72.2% |
| DIFFERENT | 749 | 22.0% |
| MULTIPLE_ZONE_OPTIONS(공동학구라 단순 비교 불가) | 196 | 5.8% |
| NO_ZONE | 4 | — |

*zone 매칭된 3,397건(좌표 있고 NO_MATCH 아닌 건) 기준.

**"어느 쪽이 정답"이라는 표현은 쓰지 않는다** — nearest는 직선거리 계산값이고
attendance zone은 공식 행정 배정 기준으로 의미가 다르다. DIFFERENT 22.0%는
"가장 가까운 학교 = 배정 학교"라는 가정이 위험하다는 것을 실측으로 보여준다.

대표 DIFFERENT 사례 10개(전체는 scratchpad JSON):

| 아파트 | 최근접(직선거리) | 공식 통학구역 |
|---|---|---|
| 협성루에나센텀(해운대구) | 송수초(254m) | 신재초 |
| 스카이맨션(해운대구) | 해운대초(700m) | 동백초 |
| 에이스빌라(해운대구) | 해송초(603m) | 동백초 |
| 태석101동(해운대구) | 해운대초(499m) | 해동초 |
| 대신푸르지오2차(서구) | 부민초(710m) | 대신초 |
| SKVIEW(해운대구) | 동백초(388m) | 좌산초 |
| 보람(서구) | 부민초(584m) | 대신초 |
| 에이스스카이뷰(해운대구) | 좌산초(2,403m) | 송정초 |
| 코모도에스테이트(중구) | 남성초(134m) | 광일초 |
| 양정자이더샵SKVIEW(2단지)(부산진구) | 양동초(519m) | 양정초 |

(주의: 학교 좌표는 Kakao 키워드 검색 결과이며 공식 좌표가 아니다 — School
테이블 좌표 미확보 상태에서의 비교용 참고치, §DATA_CONTRACT에는 반영하지 않음.)

## 13. no-match audit

geometry 밖 4건 전부 실제 주소 확인:

| 아파트 | 구·군/동 |
|---|---|
| 삼성비치타운 | 부산진구 부전동 |
| 동남주상복합 | 부산진구 당감동 |
| 엄궁 | 사상구 엄궁동 |
| 글로벌빌라트 | 동래구 사직동 |

4건 모두 원인을 **polygon gap**(zone 경계가 도심 재개발/주상복합 밀집지역에서
촘촘한 지번 경계까지 못 따라가는 경우로 추정되나 확정하지 않음) vs 좌표 자체
오차(geocode_quality 필드 미확인)로 명확히 구분할 근거가 부족해 `REVIEW_REQUIRED`로
남긴다 — 가장 가까운 polygon으로 강제 할당하지 않았다.

## 14. boundary/overlap audit

`turf.booleanPointInPolygon` 기본 동작(경계선 포함 = 내부)을 명시적 정책으로
채택했다(`ignoreBoundary` 미지정). OVERLAP(2개 이상 서로 다른 zoneId에 동시
매칭) = **0건** — 전체 3,402건 전수 검사 결과.

## 15. 부산 전체 실제 coverage

```
TOTAL_BUSAN_APARTMENTS        = 3,402
COORDINATE_READY              = 3,401
ZONE_MATCHED(SINGLE+SHARED)   = 3,267
IDENTITY_UNRESOLVED           = 130  (129 MEDIUM 사용가능 + 1 진짜 미해결)
ZONE_NO_MATCH                 = 4
COORDINATE_MISSING            = 1
```

세 단계로 정직하게 분모를 분리한다(착시 방지):

1. **ZONE_GEOMETRY_MATCH_COVERAGE**(공식 zone polygon 안에 들어가는가) =
   (3,191+76+130)/3,402 = **99.85%**
2. **USABLE_SCHOOL_IDENTITY_COVERAGE**(zone 매칭 + 학교 identity HIGH 또는
   MEDIUM로 실사용 가능) = (3,191+76+129)/3,402 = **99.82%**
3. **HIGH_CONFIDENCE_ONLY_COVERAGE**(학교 identity가 HIGH인 것만) =
   (3,191+76)/3,402 = **96.03%**

16개 구·군별 (zone geometry 매칭/전체):

| lawdCd | 구·군 | matched/total |
|---|---|---|
| 26110 | 중구 | 59/59 |
| 26140 | 서구 | 171/171 |
| 26170 | 동구 | 99/99 |
| 26200 | 영도구 | 133/133 |
| 26230 | 부산진구 | 402/404 |
| 26260 | 동래구 | 313/314 |
| 26290 | 남구 | 253/253 |
| 26320 | 북구 | 173/173 |
| 26350 | 해운대구 | 308/308 |
| 26380 | 사하구 | 338/338 |
| 26410 | 금정구 | 308/308 |
| 26440 | 강서구 | 43/44 (좌표 없는 1건 포함) |
| 26470 | 연제구 | 244/244 |
| 26500 | 수영구 | 251/251 |
| 26530 | 사상구 | 150/151 |
| 26710 | 기장군 | 152/152 |

## 16. 중학교 학교군/중학구

CSV linkage(학교급구분='중학교') 167건을 zoneId별로 그룹핑했다. 학교군 크기
분포(zone당 소속 중학교 수):

```
1개교: 7개 zone(사실상 단일 배정과 동일 — "학교군"이라는 이름이지만 선택지 없음)
2개교: 1  4개교: 1  5개교: 1  6개교: 1  7개교: 2  8개교: 3
9개교: 1  10개교: 2  13개교: 1  14개교: 1  15개교: 1  16개교: 1  18개교: 1
```

10개 부산 아파트(16개 구·군 중 10곳에서 1건씩) 실측 lookup 결과, 예:
- e편한세상송도더퍼스트비치(서구) → 3학교군(8개교)
- 협성·DS엘리시안(강서구) → 지사중학구(1개교 — 실질적으로 단일 배정)
- 삼한힐파크(북구) → 8학교군(15개교)

**"OO중학교 배정"이라는 단정적 표현은 쓰지 않는다.** 제안 구조:

```
schoolGroupName: string       // "9학교군" 또는 "지사중학구" 등 원문
schoolGroupSchools: string[]  // 소속 학교 전체 목록
middleDistrictName?: string   // 학교군과 별도인 "중학구" 표기가 있는 경우
applicableSchools: string[]   // schoolGroupSchools와 동일(가독성 위한 별칭)
```

## 17. SCHOOL V2-D contract 최종화

```ts
interface SchoolAccessInfo {
  nearbySchools: NearestSchoolInfo[]; // 기존 C5 계열 로직 그대로(직선거리)

  elementaryAttendanceZone: {
    status: 'MATCHED_SINGLE' | 'MATCHED_SHARED' | 'IDENTITY_UNRESOLVED'
          | 'NO_MATCH' | 'COORDINATE_MISSING' | 'REVIEW_REQUIRED';
    zoneName?: string;
    schools: { name: string; identityConfidence: 'HIGH' | 'MEDIUM' }[];
    zoneType?: 'SINGLE' | 'JOINT_SYMMETRIC' | 'JOINT_ASYMMETRIC';
    sourceDate: string;   // BASE_DT, 예: "2026-03-20"
    sourceName: string;   // "학구도안내서비스(한국교육시설안전원)"
  };

  middleSchoolGroup: {
    status: 'MATCHED' | 'NO_MATCH';
    groupName?: string;
    schools: string[];
    sourceDate: string;
  };
}
```

## 18. UI terminology

- 초등 단일 zone: **"공식 통학구역 기준: OO초등학교"** — 가능.
- 초등 공동학구(대칭): **"통학구역 선택 가능 학교: OO초, XX초"**.
- 초등 공동학구(비대칭/일방): **"기본 통학구역: OO초 (선택 가능: XX초, △△초)"**
  — §11에서 확인한 명명 순서(첫 토큰=자기 학구)를 "기본"으로, 나머지를 "선택
  가능"으로 표현하되, **"확정 배정"이라는 단정은 하지 않는다**(공식 우선순위
  필드가 없다는 점을 존중).
- 중학교: **"OO학교군(N개교 포함)"**, 1개교뿐인 학교군은 그냥 학교명 표시해도
  무방(실질적으로 단일 배정과 동일).
- 공통 안내문(원문 인용, C6에서 이미 확인): *"학교 배정 등 학구(통학구역)에
  대한 정확한 사항은 관할 교육청(교육지원청)에 반드시 확인하시기 바랍니다."*
- **"배정학교"라는 표현은 어디에도 쓰지 않는다.**

## 19. V1 persistence 설계

PostGIS 미사용. 권장 구조:

```
공식 원본 파일(SHP/CSV) 보존(리포에 커밋하지 않음, LEGAL-1 provenance 원칙 유지)
  → offline parser(이번 STEP lib 재사용: attendance-zone-source.ts)
  → point-in-polygon(attendance-zone-matcher.ts)
  → 사전계산 결과를 ApartmentEducationLink류 테이블에 저장(제안, 미생성)
```

제안 필드(마이그레이션 없이 설계만):

```
apartmentId, zoneId, zoneName, zoneType, schoolIds[], identityConfidence,
geometryInvalid, sourceBaseDate, computedAt
```

DB/schema 변경은 이번 STEP에서 하지 않았다.

## 20. refresh pipeline (설계만)

```
반기(3월/9월) 배포 감지
  → 다운로드(수동 또는 인증된 자동화 — 세션 쿠키 문제로 C6에서 자동화 실패,
    C6-A는 사용자가 수동 다운로드한 파일 사용)
  → checksum/BASE_DT 비교로 버전 확인
  → validate(§2~3 절차 재실행)
  → diff(이전 버전과 zoneId/학교 연결 변화 탐지)
  → rematch(point-in-polygon 재실행)
  → QA(§13~15 재검증)
  → publish
```

자동 scheduler는 구현하지 않았다.

## 21. legal/provenance

C6에서 확정한 그대로: 제공처 한국교육시설안전원, 라이선스 "이용허락범위 제한
없음"(2차 파일 fileData 페이지 원문), 기준일자 BASE_DT=2026-03-20. 모든 결과에
`sourceDate`/`sourceName` 필드로 출처를 보존한다(§17). "법적효력 없음, 교육지원청
확인 필요" 공식 고지를 UI 안내문(§18)에 반영한다.

## 22. Score 분리

이번 데이터는 E-jip Score의 schoolAccess 로직에 자동 적용하지 않았다. Score
관련 코드/formula/weight 전부 미변경.

## 23. tests

- `scripts/education/lib/attendance-zone-source.test.ts` — 7개(토큰 파싱 3종
  + CSV EUC-KR 파싱 3종 + malformed line 처리)
- `scripts/education/lib/zone-school-identity-resolver.test.ts` — 10개(HIGH/
  교차구역 MEDIUM/모호 LOW/학교급 불일치/빈 pool/이름 정규화/버킷/통합)
- `scripts/education/lib/attendance-zone-matcher.test.ts` — 12개(내부/외부/
  경계선/멀티파트/overlap/bbox 필터/상태 분류 5종)

`node:test` 기준(이 프로젝트 실제 관례) 전체 **29개 신규 테스트 전부 통과**,
기존 `src/lib/redevelopment/*.test.ts` 119개도 회귀 없이 통과(합계 148/148).

## 24. tsc / lint / build

- `npx tsc --noEmit` — clean(shapefile 타입 선언 `@types/shapefile` 추가,
  turf 타입은 `GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>`로
  통일해 해결).
- `npx eslint scripts/education` — clean.
- `npm run build` — 성공(전체 라우트 정상 컴파일, 기존 페이지/API 영향 없음
  — education 스크립트는 앱 런타임에서 import되지 않는 순수 오프라인 도구이므로
  build에 실질적 영향 없음을 라우트 목록으로 확인).

## 25. 알려진 문제 / 한계

1. NO_MATCH 4건(§13) — 원인 미확정, `REVIEW_REQUIRED`로 남김.
2. 신연초등학교(휴교) 명칭 불일치 1건 — 실제 휴교 여부 미확인, 임의 판단 안 함.
3. Busan geometry invalid 3개 zone(자체교차) — 관련 아파트 25건에 플래그만
   남기고 repair하지 않음.
4. "큰/작은" 우선순위는 명시적 필드가 아니라 zoneName 명명 규칙 추론 + 1건
   교차검증 — UI 표현을 신중하게 유지(§18).
5. nearest-school 비교용 학교 좌표는 Kakao 키워드 검색 결과이며 공식 좌표
   아님(School 테이블 좌표 0% — C5-B 이후 변동 없음, DB write 금지라 채우지
   않음).
6. 고등학교 통학구역/중학구(district-only, 학교군과 별도 개념) 원본 파일은
   사용자가 다운로드하지 않아 이번 STEP에서 다루지 않음.
7. 전국 스케일 valid/kinks 정밀 검사는 비용 문제로 생략, 부산 subset만 전량
   실행(§3).

## 26. 다음 단계

- SCHOOL V2-D: §17 contract를 실제 API/UI에 연결.
- 위 미해결 4+1건에 대한 사람 판단(REVIEW_REQUIRED) 필요.
- School 좌표를 공식 소스로 채우는 것(C5-B에서 이미 설계된 조건부 write 정책)이
  선행되면 nearest 비교의 신뢰도가 올라간다.
- 고등학교/중학구(district-only) 데이터 확보 시 동일 파이프라인 확장 가능
  (lib 코드는 학교급 무관하게 재사용 가능하도록 설계됨).
