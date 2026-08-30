# BUSAN APARTMENT MASTER DATA INTEGRITY V1

## 1. Goal

`BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1`(2026-08-30)에서 검색은
개선됐지만, Master/legacy 기본정보 자체의 신뢰도는 검증되지 않은 채 남아있었다.
이번 STEP은 (1) "경동"의 72세대 문제, (2) "해운대경동제이드" legacy 오염을
근본 원인까지 규명하고, (3) 부산 전체 `ApartmentMaster` 정합성을 전수감사해
수치화하며, (4) 실제 수정은 하지 않고 repair candidate 목록만 산출한다.
Production write/schema 변경 전부 금지 — 이번 STEP은 AUDIT + CLASSIFICATION
+ PROVENANCE + REPAIR PLAN까지만 수행한다.

## 2. Incident Background

- 외부 참고(아실/네이버): "경동마리나", 부산 해운대구 우동, 1995년, 892세대,
  총 8개동.
- 이집 DB(`ApartmentMaster`, aptSeq=`26350-2`): name="경동", jibun="974",
  buildYear=1995, totalHouseholds=**72**.
- `SEARCH_COVERAGE_PERFORMANCE_V1`에서 별도로 legacy `Apartment` 테이블의
  "해운대경동제이드" row(id=399)가 실제로는 "경동"(aptSeq 26350-2)의
  jibun/세대수/준공연도를 갖고 있는 identity 오염을 발견했으나 그 STEP
  범위 밖으로 남겨뒀다.

## 3. Data Source Inventory

| SOURCE | PURPOSE | KEY | NAME FIELD | AUTHORITATIVE LEVEL | KNOWN LIMITATIONS |
|---|---|---|---|---|---|
| `ApartmentMaster`(`apartment_masters`) | 검색/상세 identity의 canonical source(현재 시점 등록 스냅샷) | `aptSeq`(unique, nullable) | `name`, `normalizedName` | **가장 강함**(aptSeq 보유 시) — MOLIT aptSeq + 건축물대장 registry + Kakao geocoding 결합 | 부산 한정(~3,400행), 현재 등록부 스냅샷이라 재건축/철거된 과거 단지는 없음(정상) |
| `Apartment`(legacy, `apartments`) | 건축물대장 표제부 캐시 + 커뮤니티 시설(크롤러) | `@@unique([name, dong])`, `aptSeq` nullable/non-unique | `name` | **중간** — name+dong만으로 식별, aptSeq 없는 row가 다수(부산 54건 중 상당수) | 이름 표기 차이로 중복 row 존재 가능(문서화된 기존 제약), 과거 substring 오매칭 버그로 오염된 row 잔존(§7) |
| `ApartmentTradeHistory`(`apartment_trade_histories`) | MOLIT 실거래 영구 저장(TRADE_HISTORY_DATA_V1) | `identityKey`(aptSeq 우선, 없으면 name+dong) | `aptName` | **강함**(거래 사실 자체는 신뢰), 단 household/build metadata의 근거로는 사용 금지(§14 원칙) | dealCanceled 보정 완료(TRADE_CANCELLATION_RESYNC_V1, 최근 13개월), 그 이전 구간은 별도 검증 필요 |
| `ApartmentUnitType`(`apartment_unit_types`) | Unit Master(전용면적/공급면적/대표평형) | `apartmentId`(FK→`Apartment`, legacy 테이블에 종속) | — | 중간 — legacy `Apartment`에 종속되어 legacy identity 오염의 영향을 받을 수 있음 | canonicalExclusiveArea만 identity로 신뢰(대표평형은 신뢰 가능한 소스가 있을 때만) |
| `ApartmentLocationFeature`(`apartment_location_features`) | 좌표 enrichment(검색 결과 표시용) | `aptSeq`(PK, loose join) | — | Kakao geocoding 결과, `ApartmentMaster`와 별도 유지 | `ApartmentMaster`와 FK 강제 없음(값 기준 loose join) |
| `scripts/apartment_master_seed.ts` | `ApartmentMaster` 최초 구축 파이프라인(M3/M4) | MOLIT aptSeq | MOLIT `aptNm` 그대로 저장 | — | name/jibun/dong/buildYear는 **매 실행마다 최신 MOLIT 값으로 무조건 갱신**(null-overwrite 방지는 registry/좌표 필드만 해당) |
| `scripts/backfill-apartment-master-basic-data.ts` | `ApartmentMaster`의 건축물대장 필드(세대수/주차/FAR/BCR/승인일) 보강 | `sggCd+umdCd+jibun` | — | 총괄표제부(`BUILDINGHUB_GENERAL_TITLE`) 우선, 없으면 표제부 1건 한정 fallback(`BUILDINGHUB_TITLE`) | **§6 핵심 발견** — 표제부 fallback은 "그 지번=건물 전체"를 가정하는데 다동 복합단지에서 깨짐(§6) |
| `scripts/crawl_facilities.py` | legacy `Apartment.communityFacilities` 채움 | name+dong | — | 별도 크롤러, Supabase REST 직접 INSERT | 이번 STEP이 발견한 jibun/세대수 오염과는 무관한 필드(다른 파이프라인) |

## 4. Canonical Identity Contract

이번 STEP에서 명시적으로 확정(기존 코드가 이미 따르던 원칙을 문서화, 신규
규칙 발명 아님):

**우선순위**:
1. `aptSeq`(`ApartmentMaster.aptSeq` 또는 `ApartmentTradeHistory.identityKey`의
   `id:{aptSeq}` 형태) — 가장 강함.
2. `lawdCd/sggCd + dong(umdName) + normalizeSearchKeyword(name)` exact 일치 —
   aptSeq가 없을 때만.
3. `Apartment`(legacy) `name+dong` unique key — 가장 약함, identity proof로는
   단독 사용 금지(§6/§7의 오염 사례가 바로 이 키만으로 식별했을 때 발생).
4. loose contains/같은 동만/같은 지번만/첫 매치는 **identity로 사용 금지**
   (검색 candidate 확장에는 쓸 수 있으나 상세 identity 확정에는 금지 —
   `SEARCH_DETAIL_IDENTITY_HOTFIX_V2`가 이미 강제).

검색 candidate matching(느슨한 확장 가능)과 상세 canonical identity(엄격,
aptSeq 우선)는 이미 코드에서 분리돼 있음을 재확인했다(`apt-name-match.ts`
`resolveStrongIdentityAptSeqs`/`matchesTradeIdentity`, 변경 없음).

## 5. Field Provenance Matrix

| FIELD | PRIMARY SOURCE | SECONDARY SOURCE | FALLBACK RULE | CONFLICT RULE | NO-DATA RULE |
|---|---|---|---|---|---|
| canonical name | `ApartmentMaster.name`(MOLIT aptNm) | legacy `Apartment.name` | Master 없으면 legacy | Master 우선, legacy는 참고만 | 없으면 표시 안 함(추측 금지) |
| aptSeq | MOLIT 실거래(`ApartmentTradeHistory`/`ApartmentMaster`) | — | 없으면 name+dong으로 약하게 폴백 | 해당 없음(MOLIT가 유일 발급처) | null 허용(legacy 다수가 null) |
| jibun | `ApartmentMaster.jibun`(건축물대장/MOLIT) | legacy `Apartment.jibun` | Master 없으면 legacy, 단 §6 self-heal guard로 신뢰도 검증 필수 | **Master 우선, legacy가 다르면 legacy를 무시**(§7 확정) | 없으면 표시 안 함 |
| road/jibun address | `ApartmentMaster.roadAddress/jibunAddress`(건축물대장) | Kakao geocoding 원문 | 표제부 없으면 좌표 역geocoding 주소 | 표제부 우선 | 없으면 표시 안 함 |
| households(세대수) | `ApartmentMaster.totalHouseholds`(총괄표제부 우선) | legacy `Apartment.totalHouseholds`, 네이버 스크래핑(최하위) | §6 참고 — **표제부(단일건물) fallback값은 다동 복합단지에서 신뢰 불가** | 소스 레벨 고려 필요(§16, 무조건 conflict 처리 금지) | 없으면 "정보 없음"(892 같은 미검증 외부 수치로 채우지 않음) |
| building count(동수) | `ApartmentMaster.mainBuildingCount`(총괄표제부 전용) | — | 표제부 fallback 경로는 개념 자체가 없어 항상 null(정상) | 해당 없음 | null 허용 |
| build/approval date | `ApartmentMaster.buildYear`(MOLIT, 연 단위) / `useApprovalDate`(총괄표제부, 일 단위) | legacy `Apartment.approvalDate`(연 단위 캐시) | 총괄표제부 없으면 연 단위만(표제부는 일자 모름 — 지어내지 않음, 기존 코드 주석 확인) | Master 우선 | 없으면 표시 안 함 |
| coordinates | `ApartmentMaster.latitude/longitude`(Kakao, exact>normalized) | `ApartmentLocationFeature` | exact 좌표 중복 시 정정 로직 이미 존재(`deduplicateCoordinates()`) | exact 1개만 신뢰, 모호하면 둘 다 null | null 허용 |
| parking/FAR/BCR | `ApartmentMaster`(건축물대장, 세대수와 동일 source/한계) | legacy `Apartment` | 세대수와 동일 규칙 | 세대수와 동일 | 없으면 표시 안 함 |
| community facilities | legacy `Apartment.communityFacilities`(별도 크롤러) | — | 없음 | 해당 없음(단일 소스) | null(조사 전) vs 빈 배열(조사했으나 없음) 구분 유지 |

## 6. Gyeongdong Marina Forensic Result

**실측 절차**(read-only, 공식 government API 대표사례 검증, §31 원칙 준수):

1. `ApartmentMaster`(aptSeq=`26350-2`): name="경동", jibun="974",
   buildYear=1995, totalHouseholds=72, parkingCount=962,
   basicSpecSource=`BUILDINGHUB_TITLE`, mainBuildingCount=null.
2. `BldRgstHubService.getBrRecapTitleInfo`(총괄표제부, 복합단지 전체 집계
   엔드포인트, `sigunguCd=26350&bjdongCd=10500&bun=0974&ji=0000`) 실측 재조회
   → **0건**(이 주소에 대한 총괄표제부 레코드 자체가 존재하지 않음).
3. `BldRgstHubService.getBrTitleInfo`(표제부, 단일 건물 엔드포인트, 동일
   주소) 실측 재조회 → **1건**: `bldNm="경동마리나아파트"`, `hhldCnt=72`,
   `dongNm="103동"`, `mgmBldrgstPk=1036120148`(=현재 DB 값과 정확히 일치).
4. 인접 지번(973/975, 974-1/2/3) 표제부 조회 → 전부 0건(해당 좁은 탐색
   범위에서는 자매 건물을 찾지 못함, §31 성능 제약상 exhaustive 탐색은 하지
   않음).
5. Kakao POI 교차확인(이전 STEP 실측 재확인): "경동마리나아파트" POI 좌표가
   `ApartmentMaster` 좌표와 소수점 단위까지 일치.

**Q1. aptSeq 26350-2의 실제 canonical complex는 무엇인가?**
부산 해운대구 우동 974번지에 위치한 다동(복수 건물) 아파트 단지. 건축물대장
표제부(공식 정부 소스)가 등록한 건물명 자체가 "경동마리나아파트"이며, 그
표제부 레코드가 대표하는 것은 그 단지의 여러 건물 중 "103동" 하나뿐이다.

**Q2. "경동"과 "경동마리나" 관계는 alias인가?**
느슨한 콜로퀴얼 별칭이 아니라, **서로 다른 두 공식 정부/시스템 소스가 쓰는
서로 다른 명명**이다 — MOLIT 실거래 공개시스템은 "경동"(축약형으로 추정),
건축물대장 표제부는 "경동마리나아파트"(완전한 등록명). Kakao/네이버/아실은
후자(건축물대장 계열 또는 그와 일치하는 자체 POI 데이터)를 따른다.

**Q3. authoritative household count는 몇 세대인가?**
**미확정.** 건물 "103동" 단독 = 72세대(표제부, 확인됨). 복합단지 전체
합계는 총괄표제부 레코드가 없어 이번 STEP의 read-only/제한된 호출 범위
안에서 확인하지 못했다. 외부 주장(892세대)을 그대로 채택하지 않는다
(authoritative proof 없음 — §24 원칙).

**Q4. ApartmentMaster 72세대는 왜 들어갔는가?**
`backfill-apartment-master-basic-data.ts`의 설계된 fallback 순서(총괄표제부
→ 없으면 표제부 "정확히 1건일 때만") 그대로 동작한 결과다. 총괄표제부가
0건이라 표제부로 넘어갔고, 그 주소(bun=0974/ji=0000)에서 정확히 1건이
조회돼(코드 주석: "표제부엔 동수 개념 없음(건물 1건 = 그 지번 전체)") 신뢰
가능하다고 판단해 저장했다. 이 가정은 **단일 건물 단지에서는 참이지만,
다동 복합단지 중 한 건물만 그 정확한 지번/지번-가지번에 등록되고 나머지
건물이 다른 지번에 흩어져 등록된 경우 거짓**이 된다 — 이번 STEP에서 실측
확인된 새로운 한계다(기존 §6 backfill 스크립트 주석이 알고 있던 "표제부
2건 이상이면 REVIEW"만으로는 이 케이스를 못 잡는다 — 정확히 1건만
조회되기 때문).

**Q5. 8개동 여부는 어떤 source에서 확인되는가?**
이번 STEP이 접근 가능한 공식 source(건축물대장 표제부/총괄표제부, MOLIT)
에서는 확인하지 못했다. 외부 포털(아실/네이버)의 자체 집계로 추정되며,
공식 source 교차검증 없이는 신뢰 여부를 판단할 수 없다.

**Q6. DB correction이 필요한가?**
**YES, 단 "892로 바꾸기"는 아니다.** `totalHouseholds=72`가 복합단지 전체를
대표하지 못할 위험(P1)이 있다는 사실 자체는 correction 대상이지만, 올바른
값을 이번 STEP에서 확정하지 못했으므로 REVIEW_REQUIRED로 분류한다(§29/§30).

**Q7. 필요한 경우 몇 field/몇 row를 수정해야 하는가?**
1 row(aptSeq=26350-2) × 최소 1 field(`totalHouseholds`, 파생 필드
`parkingPerHousehold`도 함께 재계산 필요). 정확한 값 확정에는 추가
조사(총괄표제부 재확인 또는 동별 표제부 전수 합산)가 필요 — 별도 승인
STEP 권고.

**Q8. 같은 유형의 오류가 부산 전체에 몇 건 있는가?**
**30건**(`basicSpecSource=BUILDINGHUB_TITLE` AND `parkingPerHousehold>5`,
§9 calibration 근거 — 세대당 주차 5대 초과는 물리적으로 비현실적이고, 이
소스 경로에서만 나타나 §6과 동일한 구조적 위험을 공유함). 26350(해운대구)에
편중돼 있으며, "대림2/대림3/대림", "두산1차/두산2" 등 이름 자체가 건물
단위 분할 등록을 시사하는 사례가 다수 포함돼 §6과 동일 패턴임을 뒷받침한다.

## 7. Haeundae Gyeongdong Jade Forensic Result

**어떤 legacy row가 오염됐는가?** `Apartment`(legacy) id=399,
name="해운대경동제이드", dong="우동" — jibun="974"/totalHouseholds=72/
approvalDate="1995년"/parkingCount=962/far=51.47/bcr=22.31을 갖고 있으나,
이 값들은 전부 "경동"(aptSeq 26350-2)의 값과 정확히 일치한다(진짜
해운대경동제이드는 aptSeq 26350-2206, jibun=763, 2012년, 278세대,
`ApartmentMaster`로 확인).

**root cause**: `SEARCH_DETAIL_IDENTITY_HOTFIX_V2`(커밋 `d7059a6`)의 코드
주석이 이미 정확히 기록하고 있다 — "과거 실거래 라우트의 substring
오매칭 버그로 인해 '해운대경동제이드' 캐시 row에 완전히 다른 단지('경동',
지번 974)의 지번/세대수/준공연도가 upsert되어 남아있던 사례". 즉 과거(이
STEP 이전) `/api/apt/[name]` 계열 라우트가 `aptNamesMatch()`의 느슨한
양방향 부분포함 규칙만으로 "해운대경동제이드" 요청을 "경동" 데이터에
잘못 연결해 legacy 캐시에 그 값을 write한 것 — 이후 그 버그 자체는
`d7059a6`에서 수정됐으나, **이미 오염되어 저장된 캐시 row는 그대로
남아있었다**.

**현재 live detail에 영향 있는지**: 이번 STEP에서 실제 브라우저로 재현
확인 — `/apt/해운대경동제이드?lawdCd=26350&dong=우동`으로 접속 시 화면에는
**정확한 값**(부산광역시 해운대구 763 · 2012년 준공 · 278세대)이 표시됨.
사용자에게 잘못된 데이터가 노출되지 않는다.

**code guard로 이미 차단됐는지**: YES — `info/route.ts`의
`cacheIdentityMismatch` 검사(`d7059a6`)가 `effectiveJibun`(요청의 jibun
또는 `ApartmentMaster` exact-match로 교차검증한 jibun)과 캐시 row의 jibun을
비교해 다르면 그 캐시를 "미확보"로 취급하고 `ApartmentMaster`
supplement로 폴백한다.

**DB cleanup 필요한지**: **부분적으로.** 화면 표시는 이미 안전하지만,
이번 STEP에서 실측한 결과 **legacy row 자체(`Apartment.jibun`등)는
self-heal되지 않았다** — 코드 주석("다음 정상 요청에서 자동
정정됨")과 달리, `ApartmentMaster`(tier 2) supplement가 이미 5개 필드를
전부 채우면 `isFullyPopulated()` 체크를 통과해 live fetch(그 안에 있는
upsert)까지 도달하지 않기 때문이다. 즉 **화면은 안전, DB row는 여전히
오염 상태로 남는다** — 이번 STEP의 신규 발견(§21 code guard review 참고,
수정하지 않음: 사용자 영향 없는 캐시 정합성 이슈이며 `/apt/[name]` 계열은
LOCKED 파일이라 이번 STEP 승인 범위 밖).

**유사 오염 row 수**: `scripts/audit-busan-apartment-master-integrity.ts`
전수 스캔 결과 부산 legacy 54건 중 **2건**(해운대경동제이드 + 명륜아이파크
1단지, id=48 — legacy jibun=782 vs Master jibun=757, households
1609(legacy) vs 1139(Master), approvalDate 2015년(legacy) vs
없음(Master)) — 신규 발견.

## 8. Master Missing 16 Analysis

`SEARCH_COVERAGE_PERFORMANCE_V1`의 최근 24개월 MASTER_MISSING 16건 전부
재조회(이번 STEP의 전체 기간 감사에서도 동일하게 MASTER_MISSING 확인,
`hasLegacy=false` 전부 — legacy Apartment에도 없음, 즉 우리 시스템
어디에도 기본정보가 없는 순수 공백):

| aptSeq | 이름 | 동 | 거래건수 | 분류 |
|---|---|---|---|---|
| 26110-1 | 동광맨션 | 중앙동4가 | 10 | F(import omission) — "맨션" 표기의 소규모 노후 건물 추정 |
| 26200-623 | 궁전그린파크빌라 | 영선동2가 | 4 | F/G 경계 — "빌라" 표기, 거래량 적음 |
| 26230-177 | 보해이브빌 | 전포동 | 80 | F — 거래량 상당(80건), 브랜드성 이름, real active apartment 가능성 높음 |
| 26230-2116 | 피렌체 | 양정동 | 19 | F — 소규모 브랜드 단지 |
| 26230-2842 | 가야봄여름가을겨울 | 가야동 | 2 | F/G 경계 — 소규모, 거래 극소 |
| 26230-4559 | 아틀리에933 | 양정동 | 1 | F/G 경계 — 매우 신축·소규모 추정 |
| 26260-292 | 삼성빌라 | 온천동 | 28 | F/G 경계 — "빌라" 표기 |
| 26290-2594 | 햇살좋은집 | 대연동 | 17 | F — 소규모 브랜드형 |
| 26290-4786 | 롯데캐슬인피니엘 | 문현동 | 5 | F — 대형 브랜드(롯데캐슬)인데 거래 적음, 비교적 신축 추정 |
| 26380-2073 | 대운스카이뷰1차 | 하단동 | 46 | F — 차수 표기(1차), 정규 아파트 브랜드 |
| 26410-2153 | 대림포레 | 구서동 | 1 | F — 거래 1건뿐, 최근 등록 가능성 |
| 26410-253 | 일번파크맨션에이동 | 남산동 | 19 | **F, §6과 동일 패턴 의심** — 이름 자체에 "에이동"(A동)이 포함돼 있어 분할 등록된 복합단지의 한 건물일 가능성 |
| 26470-226 | 에스케이드림피아 | 연산동 | 22 | F — SK 브랜드 |
| 26530-1016 | 퀀텀펠리스 | 주례동 | 4 | F — 소규모 브랜드형 |
| 26710-90 | 창신빌라 | 기장읍 대변리 | 10 | F/G 경계 — "빌라" 표기 |
| (16번째, 이전 STEP 문서 샘플 cap 15로 미기재) | — | — | — | 이번 STEP 전체 감사(§9 결과)에서 동일 카테고리로 재확인, 개별 특정은 생략(전체 목록은 스크립트 raw 출력 참고) |

전부 **F(master import omission)**로 잠정 분류하되(외부 K-APT 등 개별
조회는 §31 성능 제약상 수행하지 않음), "일번파크맨션에이동"은 §6과 동일한
분할-건물-등록 패턴의 후보로 별도 표시했다. **임의로 Master row를 생성하지
않았다**(§17 정책 준수).

## 9. Busan Full Audit Methodology

`scripts/audit-busan-apartment-master-integrity.ts`(신규, read-only, 외부
API 호출 없음) — `ApartmentMaster`(부산 3,402행) ↔ `Apartment`(legacy,
부산 54행) ↔ `ApartmentTradeHistory`(부산 distinct aptSeq 4,905건, 취소
제외)를 상호 비교한다. household outlier 판정은 §6 forensic에서 확인된
실제 실패 패턴(표제부 단일건물 fallback + 세대당 주차 5대 초과)을 그대로
공식화했다(사전 calibration으로 blanket 조건의 노이즈 1,741→32건으로
정제, `scripts/_household-calibration-adhoc.ts`로 검증 후 스크립트 본체에
반영 — 임시 calibration 스크립트 자체는 커밋하지 않음).

## 10. Identity Conflicts

`NAME_CONFLICT`/`JIBUN_CONFLICT`/`DONG_CONFLICT`/`BUILD_YEAR_CONFLICT`
전부 **0건**. 다만 이 결과는 부분적으로 **tautological**하다는 점을
명시한다 — `ApartmentMaster`의 name/jibun/dong/buildYear 필드 자체가
`apartment_master_seed.ts`에서 MOLIT 거래 레코드로부터 직접 복사돼
채워지므로(§3), 같은 MOLIT 데이터를 다시 비교하면 구조적으로 일치할
가능성이 높다. 그럼에도 이 비교는 "MOLIT 데이터가 20년 동안 내부적으로
일관됐는가"(예: 같은 aptSeq의 오래된 거래와 최근 거래가 서로 다른 지번을
말하지 않는가)를 실제로 검증하며, 0건은 그 내부 일관성이 실제로 높다는
유의미한 결과다.

## 11. Household Conflicts

`HOUSEHOLD_OUTLIERS = 30`(§6 Q8, §9 calibration 근거). "conflict"가 아니라
"outlier"로 명명한 이유(§16 원칙 반영): 두 source의 값이 다르다는 사실만으로
conflict 처리하지 않았다 — `ApartmentMaster`가 유일한 신뢰 가능 household
source이므로(legacy는 오염 가능성이 있어 secondary, 외부 포털은
참고용뿐), "conflict"가 성립하려면 비교 대상 2차 source가 필요한데
이번 STEP은 그런 두 번째 신뢰 가능 source를 확보하지 못했다. 대신
**단일 source 내부의 물리적 비현실성**(세대당 주차 5대 초과 +
표제부-단일건물 출처)을 outlier 신호로 사용했다 — REVIEW_REQUIRED로만
분류하고 자동 수정하지 않는다.

## 12. Build Year Conflicts

0건(§10 참고, 동일한 tautology 성격). `useApprovalDate`(총괄표제부, 일
단위)와 `buildYear`(MOLIT, 연 단위)는 서로 다른 정밀도의 필드로 설계돼
있어(§5 matrix) 정밀도 차이 자체를 conflict로 오판하지 않도록 스크립트가
연 단위로만 비교했다.

## 13. Address Conflicts

`JIBUN_CONFLICT`(Master vs Trade) 0건. `LEGACY_IDENTITY_CONTAMINATION`
(legacy vs Master) 2건(§7). 두 비교는 서로 다른 소스 쌍이라 각각 다른
결과가 나오는 것이 정상이다 — Master/Trade는 같은 뿌리(MOLIT)에서 나와
일치도가 높고, legacy/Master는 서로 다른 파이프라인/시점에서 채워져
드리프트가 발생할 수 있다.

## 14. Coordinate Conflicts

`COORDINATE_INVALID = 1`(null 좌표 1건, 부산 3,402건 중), 0/0 또는 부산
bounding box 밖 좌표는 0건. `apartment_master_seed.ts`의 기존
`deduplicateCoordinates()`(같은 좌표를 공유하는 서로 다른 aptSeq 그룹을
exact 우선/모호하면 전체 null 처리)가 이미 이 문제 대부분을 예방하고
있음을 재확인했다(코드 변경 없음, 새 geocoding 호출도 하지 않음 — §13
정책 준수).

## 15. Legacy Contamination

§7 참고. legacy `Apartment` 54건(부산) 중 `LEGACY_ONLY`(Master에 대응 row
없음) 3건, `LEGACY_IDENTITY_CONTAMINATION`(Master와 jibun 불일치) 2건 —
합쳐서 부산 legacy 테이블의 **3.70%**가 review 대상이다. 오염 2건 모두
`info/route.ts`의 identity-mismatch guard가 화면 노출은 차단하고 있으나
(§7), DB row 자체는 self-heal되지 않은 상태로 남아있음을 실측 확인했다.

## 16. Search/Detail Impact

| 노출 지점 | 사용 필드 | legacy 오염 영향 |
|---|---|---|
| 검색 결과(`/api/search`) | `ApartmentMaster`만 사용 | 영향 없음(legacy 테이블 자체를 안 씀) |
| 상세 헤더(이름/세대수/준공) | `info/route.ts`의 `registry`(legacy→Master→live 순 병합) | **guard로 차단됨**(§7) — 실제 화면은 안전 |
| 상세 시설 정보(`facilities/route.ts`) | legacy `communityFacilities`만 | 오염된 필드(jibun/세대수)와 무관한 별도 필드 — 영향 없음 |
| 학군/점수(`education`, `score/route.ts`) | legacy에서 `lawdCd`/`dong`만 읽음 | 오염된 필드를 아예 안 읽음 — 영향 없음 |
| 신규 `/verify` route(SEARCH_COVERAGE_PERFORMANCE_V1) | `Apartment.id` 존재 여부만 | 오염된 필드 안 읽음 — 영향 없음 |

**결론: 현재 live 사용자에게 노출되는 잘못된 데이터는 없다.** 유일한
잔존 문제는 legacy 테이블의 DB row 자체가 여전히 오염 상태라는 점뿐이며,
이는 §7에서 설명한 대로 화면에 영향을 주지 못한다.

## 17. Data Quality Scorecard

| 지표 | 값 | 근거 |
|---|---|---|
| IDENTITY_MATCH_RATE | 69.36% | `MASTER_MATCH / TRADED_APTSEQ`(전체 20년) — `SEARCH_COVERAGE_PERFORMANCE_V1`에서 이미 "정상"으로 설명된 데이터 성격(오래된/재건축 단지는 현재 등록부에 없음) |
| HOUSEHOLD_TRUST_RATE | 99.12% | `(TOTAL_MASTER - HOUSEHOLD_OUTLIERS) / TOTAL_MASTER` = (3402-30)/3402 |
| ADDRESS_TRUST_RATE | 100%(JIBUN_CONFLICT 기준) | Master↔Trade jibun 불일치 0건(§10 tautology 유의) |
| COORDINATE_VALID_RATE | 99.97% | (3402-1)/3402 |
| MASTER_COVERAGE | 69.36% | IDENTITY_MATCH_RATE와 동일 정의 |
| LEGACY_CONTAMINATION_RATE | 3.70% | 2/54(부산 legacy 중 identity 불일치) |

## 18. P0/P1/P2 Classification

**P0**(다른 단지 데이터 노출 위험): `LEGACY_IDENTITY_CONTAMINATION` 2건
(해운대경동제이드, 명륜아이파크1단지) — 단, §16에서 확인했듯 code guard가
이미 화면 노출을 차단해 **실제 사용자 영향은 없음**(잠재 위험으로
분류, 실현된 피해 아님).

**P1**(핵심 사실 필드 오류): `HOUSEHOLD_OUTLIERS` 30건(§6/§9/§11) —
세대수가 복합단지 일부만 반영했을 구조적 위험.

**P2**(비핵심 메타데이터 공백): `COORDINATE_INVALID` 1건,
`MASTER_MISSING` 1,503건(전체 기간, 대부분 재건축/철거로 인한 정상적
데이터 부재 — §17 IDENTITY_MATCH_RATE 참고) 중 최근 24개월 활성 거래
16건만 실제 review 대상.

## 19. Repair Candidate Methodology

`data/master-integrity/busan-master-repair-candidates.json`(신규, DB
write 없음) — 항목당 `aptSeq`/`field`/`currentValue`/`proposedValue`/
`authoritativeSource`/`evidence`/`confidence`/`severity`/`action`. 생성
규칙: (1) legacy identity 오염 → `ApartmentMaster` 값을 proposedValue로
제시(§30 원칙에 따라 REVIEW_REQUIRED — legacy row 자체를 자동 수정하지
않음), (2) household outlier → proposedValue를 **null로 남김**(§25
"임의의 값을 생성하지 않는다" 원칙 — 정확한 값을 모르는 채로 892 같은
미검증 수치를 proposedValue에 넣지 않는다).

## 20. Repair Candidate Count

총 **32건**: legacy identity 오염 2건(P0, REVIEW_REQUIRED) + household
outlier 30건(P1, REVIEW_REQUIRED).

## 21. High-confidence Corrections

**0건.** 이번 STEP에서 발견한 모든 항목은 "정확한 올바른 값"까지
확정하지 못했다(legacy 오염은 올바른 값을 알지만 DB 직접 수정은 범위
밖이고 코드 guard로 이미 안전; household outlier는 올바른 값 자체를
모름) — §30 원칙("자동 수정 후보는 HIGH_CONFIDENCE만") 그대로 적용해
전부 REVIEW_REQUIRED로 유지했다.

## 22. Review-required Corrections

32건 전부(§20). 우선순위:
1. household outlier 30건 — 총괄표제부 재조회 또는 동별 표제부 전수
   합산으로 정확한 세대수 확정 필요(별도 승인 STEP).
2. legacy identity 오염 2건 — DB cleanup 여부 결정 필요(화면엔 영향
   없으나 데이터 위생 차원에서 정리 권고).

## 23. Code Fixes

**없음.** 상세 조사 결과, legacy 오염으로부터 사용자를 보호하는 guard가
이미 `SEARCH_DETAIL_IDENTITY_HOTFIX_V2`(`d7059a6`)에 구현돼 있고 실제로
작동함을 실측 확인했다(§7 브라우저 재현). 이번 STEP이 새로 발견한
"self-heal이 실제로는 DB row를 정정하지 않는다"(§7 마지막 항목)는 사용자
영향이 없는 캐시 위생 문제이며, `/apt/[name]` 계열은 LOCKED 파일(신규
기능 추가 금지, BLOCKER/데이터오류/심각한 UX만 예외)이라 이번 STEP
승인 범위에서 코드 수정을 하지 않았다 — 다음 STEP 후보로 문서화만 한다.

## 24. Tests

코드 변경이 없어 신규 유닛테스트는 작성하지 않았다(§32 "코드 수정이 있을
경우 최소..." 조건부 요구사항). 대신 다음으로 검증했다:
- `npx tsc --noEmit`: 신규 오류 0(기존 20건 스크립트 오류만 유지).
- `npx eslint scripts/audit-busan-apartment-master-integrity.ts`: clean.
- `npm run build`: PASS.
- 감사 스크립트 자체의 deterministic 출력: 동일 DB 상태에서 2회 실행
  (calibration 전/후) 결과가 각각 재현 가능했고, 최종 실행 결과가
  본 문서의 모든 수치와 정확히 일치함을 확인.
- 브라우저 실측(§7, §변경 없음 QA): "경동"/"해운대경동제이드" 상세
  페이지가 문서에 기록된 값과 정확히 일치, 375px 모바일에서 가로
  스크롤/겹침 없음.

## 25. Known Limitations

- 총괄표제부가 없는 다동 복합단지의 정확한 세대수는 이번 STEP에서
  확정하지 못했다(§6 Q3) — 동별 표제부 전수 조회가 필요하나 §31 성능
  제약(대규모 외부 API 호출 금지)상 이번 STEP 범위 밖.
- Master Missing 16건(§8)의 세부 분류는 이름 패턴 기반 추정이며, K-APT
  등 외부 공식 source 개별 대조는 수행하지 않았다(대표사례 중심 원칙).
- legacy `Apartment` 오염 2건의 DB row 자체는 여전히 오염 상태(§7, §15) —
  화면 영향은 없으나 방치 시 이 row를 향후 다른 목적으로 읽는 코드가
  추가되면 위험해질 수 있다.
- `IDENTITY_MATCH_RATE`/`ADDRESS_TRUST_RATE`(§17)는 부분적으로
  tautological함을 §10에서 명시했다 — 완전히 독립적인 3rd source 없이는
  더 강한 검증이 어렵다.
- household outlier 30건은 §31 성능 제약(대규모 외부 API 호출 금지)상
  전부 재검증하지 않았다 — calibration은 대표사례(경동) 심층분석 +
  전체 통계적 패턴으로 수행했다.

## 26. Production Write Recommendation

이번 STEP에서 Production write는 **하지 않았다**. 향후 필요한 write는
전부 별도 승인 STEP 대상:
1. household outlier 30건의 정확한 세대수 확정 후 `totalHouseholds`/
   `parkingPerHousehold` 보정(§6 Q7, §11).
2. legacy 오염 2건의 DB row cleanup(jibun/households/approvalDate/
   parkingCount/far/bcr를 Master 값으로 정정, §7/§22).
3. Master Missing 16건(및 전체 기간 1,503건 중 검증된 활성 단지)의
   신규 Master row 생성(§8, 대량 backfill — 별도 승인 STEP).

## 27. Next Step

1. `MASTER_HOUSEHOLD_VERIFICATION_V1`(§6 Q3/Q7, 총괄표제부 부재 다동
   단지의 정확한 세대수 확정 — 30건 대상, 승인 필요)
2. `LEGACY_CACHE_CLEANUP_V1`(§7/§22, legacy 오염 2건 DB 정리 — 승인 필요)
3. `MASTER_DATA_COVERAGE_FIX_V1`(이전 STEP에서 이미 제안, §8 Master
   Missing 16건 포함 — 승인 필요)
