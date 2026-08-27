# SCHOOLINFO / SCHOOL V2.1 — DECISION-FIRST SCHOOL DETAIL EXPERIENCE

작성일: 2026-08-27
성격: 학교 상세페이지를 "정보 나열"에서 "이 학교를 기준으로 어떤 아파트를 봐야
하는가"까지 이어지는 의사결정형 페이지로 재구성한다(§0). 기존 SCHOOL V2-C 시리즈
(canonical `School`/`SchoolStat`/`EducationSource` 스키마, 664개 부산 학교 마스터,
attendance-zone artifact)를 그대로 이어받아 확장했다 — DB schema 변경/migration
없음, 신규 대규모 데이터 ingestion 없음(§24).

---

## 1. Official SchoolInfo Reply

사용자가 학교알리미(교육부/KERIS) 측으로부터 확보한 공식 회신 8개 항목:

1. 원본 데이터를 임의 변경/왜곡하지 않으면 상업적 웹/앱 활용 가능.
2. 원본값 유지 전제에서 재구성/비교/분석 가능.
3. 이집이 산출하는 비율/거리/비교/지표/순위/해석은 학교알리미 공식값이 아니라
   **이집 자체 산출**임을 명확히 표시.
4. 학교알리미 원본 위도/경도는 임의 변경 금지.
5. 아파트↔학교 거리 계산 가능(단, "이집 자체 산출" 표시 조건).
6. 진학/졸업/학교 특성 원본값 표시 가능. 파생 ranking/평가는 별도 구분.
7. 자체 DB 저장/업데이트 자체는 금지 아님(원본 정합성 유지 조건).
8. 필수 출처: **"출처: 학교알리미"** 반드시 적용.

이 회신은 `docs/development/SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md`가 남긴
`SCHOOLINFO_STATISTICS_USE_GATE = CONDITIONAL`/`SCHOOLINFO_COORDINATE_USE_GATE =
CONDITIONAL` 판정(§12-1 "학교알리미 고객상담센터에 서면 문의" 권고)을 실제로 해소한
1차 자료다 — 이번 STEP부터는 이 범위 안에서 재승인 요청 없이 진행한다.

---

## 2. Usage Policy

허용: 원본값 그대로 저장/표시, 원본 기반 재구성·비교·분석(거리/비율/지표/해석),
원본 위경도의 거리 계산 input 사용. **금지/조건부**: 원본 왜곡, RAW/DERIVED 라벨
없이 이집 산출값을 공식값처럼 표시, 위경도 자체 변형. `EducationSource.code =
'schoolinfo_openapi'`를 `legalReviewStatus: CLEARED`로 등록했다(§8, 1회성
governance 액션 — `scripts/education/register-schoolinfo-source.ts`, 실제 실행
완료, id=5).

---

## 3. Attribution

모든 화면에 **"출처: NEIS"**(School 기본정보, 이미 존재하던 소스 — 이번 STEP은 이
표시를 유지)와, 향후 SchoolStat이 채워지면 **"출처: 학교알리미"**를 병기한다.
이집이 계산한 값(거리/비교/해석)은 별도로 **"이집 계산값"**으로 표시한다(§15).
현재는 SchoolStat이 0건이라 학교알리미 출처가 표시될 실데이터가 아직 없다 — 출처
라벨은 실제 데이터가 붙는 시점에만 노출한다(값 없이 출처만 먼저 노출하지 않음).

---

## 4. Raw vs Derived

| 구분 | 예 | 표시 |
|---|---|---|
| A. OFFICIAL_RAW | School.schoolName/schoolLevel/establishmentType/genderType/address(NEIS), 통학구역/학교군(학구도안내서비스) | 출처 그대로 |
| B. E_JIP_DERIVED | 학교↔아파트 직선거리, relation 판정(공식 통학구역/학교군/주변), 가격 비교, "이집의 해석" | "이집 계산값" |
| C. LOCATION_EXTERNAL | Kakao POI 좌표(School 공식 좌표 미확보 시에만 보조로 사용) | `location.source: 'KAKAO_EXTERNAL'`로 API 응답에 명시, 화면엔 좌표 자체를 노출하지 않음(거리 계산 input으로만 사용) |

두 좌표 소스(OFFICIAL_POINT/KAKAO_EXTERNAL)는 API 응답에서 항상 분리해 반환하고
섞지 않는다(§22).

---

## 5. School Identity

canonical 우선순위: **1) `School.neisSchoolCode`**(NEIS 표준 학교 코드) → **2)
Kakao POI id**(neisSchoolCode 미확보 학교의 secondary identity). name-only
canonical identity는 어디에도 없다 — 동명이교(예: 강서구 송정초/해운대구 구덕초등학교
사례)를 코드 없이 이름만으로 구분하지 않는다.

`/api/school/[id]/route.ts`의 실제 해석 순서:

1. `[id]`가 `School.neisSchoolCode`와 정확히 일치하면 CANONICAL(좌표 불필요).
2. 아니면(기존 Kakao 링크), `name`+`lawdCd` 쿼리로 `School` 테이블에서 **정확히
   1건만** 매칭되면 CANONICAL로 승격(2건 이상 모호하면 승격하지 않음 —
   `school/apartments/route.ts`의 `lookupCanonicalSchoolCoordinate`와 동일한
   안전 원칙 재사용).
3. 둘 다 실패하면 KAKAO_ONLY(진짜 비공식/미등록 기관 — 사설학원 등).

---

## 6. Route Design

`/school/[id]`(경로 구조 변경 없음, 하위호환) — `[id]` 자리의 의미만 확장했다:

- **신규(canonical)**: `/school/{neisSchoolCode}?lawdCd=&aptSeq=` — **좌표 없이도
  연다**(§7 핵심 PASS 조건). `name`/`lat`/`lng` 불필요.
  `buildCanonicalSchoolHref()`(`src/lib/school-link.ts`)가 만든다.
- **기존(Kakao POI, 하위호환)**: `/school/{kakaoId}?name=&lat=&lng=&lawdCd=` —
  그대로 동작(§6 아래).

새 API `/api/school/[id]/route.ts`가 이 판단을 전담하고, 페이지/클라이언트는 어떤
형식으로 들어왔는지 신경 쓰지 않는다.

---

## 7. Current Architecture (변경분 요약)

```
src/lib/education/attendance-zone.ts        (+getApartmentsForSchool — 학교→아파트 역방향 조회)
src/lib/education/school-apartment-relations.ts  (신규, 순수 함수 — zone/middle-group 역인덱스)
src/lib/school-trade-price.ts               (신규, 순수 함수 — MOLIT trade → 후보 aptSeq 가격 매칭)
src/lib/school-decision-insight.ts          (신규, 순수 함수 — deterministic 비교 해석)
src/lib/molit-months.ts                     (신규, 기존 transactions route 로직 추출/재사용)
src/lib/school-link.ts                      (+buildCanonicalSchoolHref — 좌표 없는 canonical 링크)
src/app/api/school/[id]/route.ts            (신규 — canonical 학교 상세 + 관련 아파트 API)
src/app/school/[id]/school-detail-client.tsx (전면 재작성 — 의사결정형 IA)
src/app/school/[id]/page.tsx                (메타데이터: School 테이블 우선 조회)
src/components/EducationPanel.tsx           (+EduSchoolLink — 공식 통학구역/학교군 학교를 좌표 없이 클릭 가능하게)
scripts/education/register-schoolinfo-source.ts (신규, 1회 실행 완료 — EducationSource governance)
```

`/api/school/apartments`(기존, Kakao POI 반경검색 기반 — aptSeq 없음)는 더 이상
호출되지 않지만 삭제하지 않았다(AGENTS.md 원칙 14, 다른 소비자가 생길 가능성 배제
안 함).

---

## 8. Decision-First IA

`school-detail-client.tsx` 최종 구조(모바일 우선):

1. **학교 헤더**: 학교명/학교급/공립·사립/남여공학/주소(School 테이블, 있으면),
   공유 버튼(기존 `KakaoShareButton` 재사용).
2. **현재 보고 있는 단지 콜아웃**(`aptSeq` 쿼리 있을 때만): 거리·최근 가격.
3. **한눈에 보는 학교**: SchoolStat 0건 상태를 정직하게 "연동 준비 중"으로 안내
   (§9 자세히).
4. **이 학교와 연결된 아파트**: relation 배지(공식 통학구역/학교군 관련/학교 주변)
   + 세대수/연식/최근 가격 + 상세보기(§10~11).
5. **이집의 해석**: `buildDecisionInsights()` 결과(있을 때만, 최소 2개 비교 가능
   값 필요).
6. **CTA**: 관련 아파트 보기(스크롤)/현재 단지로 돌아가기(`router.back()`, 있을
   때만).
7. **출처 푸터**.

---

## 9. School Header

`School` 테이블(664건, NEIS 학교기본정보) 필드를 최초로 실제 화면에 노출했다 —
기존 SCHOOL V2-C2A가 이미 적재해뒀지만 어떤 route도 조회하지 않던 데이터다.
좌표가 없어도(대부분의 경우) 헤더는 항상 렌더된다. `School`에 없는(KAKAO_ONLY)
학교는 헤더를 아예 생략하고 "학교알리미 공식 정보와 아직 연결되지 않은 학교"임을
명시한다(추정 헤더 생성 금지).

---

## 10. School Metrics / 11. Student Composition / 12. School Features

**SchoolStat 0건**(§24) — 학생수/교원수/학급수/학년별 구성/학교 특성 데이터가
현재 하나도 없다. 없는 항목을 시안 때문에 만들지 않는다(지시사항 명시) — 세 섹션을
별도로 쪼개 3개의 빈 카드를 늘어놓는 대신, "한눈에 보는 학교" 섹션 하나에
학교알리미 정책이 확정됐고(§1) 통계 연동이 다음 단계임을 정직하게 안내하는 문구
하나로 통합했다. 실제 통계가 들어오면 이 섹션을 원본(RAW)/이집 계산(DERIVED)
라벨과 함께 확장한다(§10 items).

---

## 13. Commute / Distance

`§10 아파트 상세→학교`로 진입한 경우 `aptSeq` 쿼리로 "현재 보고 있는 단지"
콜아웃에 직선거리를 표시한다. 좌표가 없으면(대부분의 canonical 학교) "거리 정보
없음"으로 정직하게 표시한다(추정 통학시간/보정계수 없음 — 기존 SCHOOL V2-C5-A
원칙 그대로 계승).

---

## 14. Related Apartments — 소스와 relation

`src/lib/education/school-apartment-relations.ts`(순수 함수)가 attendance-zone
artifact(3,402건, `school-apartment-relations.test.mjs` 6개 테스트로 canonical
code 우선 매칭·동명이교 안전 검증)를 "학교→아파트" 방향으로 역색인한다:

- **A. ATTENDANCE_ZONE**(공식 초등 통학구역) — neisSchoolCode 우선 매칭.
- **B. MIDDLE_GROUP**(중학교 학교군) — 동일.
- **C. NEARBY**(거리 기반, 위치가 있을 때만) — `src/lib/nearby-apartments.ts`(기존,
  presale nearby apartments가 이미 쓰던 canonical ApartmentMaster 기반 함수)를
  그대로 재사용. A/B와 겹치는 aptSeq는 제외해 중복 노출하지 않는다.

**단순 거리 기반 결과를 "배정 아파트"라고 표시하지 않는다** — 화면에 항상 relation
배지(공식 통학구역/학교군 관련/학교 주변)를 명시한다(§17).

---

## 15. Apartment Comparison / RAW·DERIVED Label

카드별 가격은 이 프로젝트의 기존 검증된 실거래 파이프라인(`fetchMolitData`, dong+name
매칭, `src/lib/school-trade-price.ts`)만 사용한다 — 새 가격 소스 없음. 해제(취소)
거래는 최신 거래로 채택하지 않는다(테스트로 강제). 화면 하단에 **"출처: NEIS" /
"가격·거리·비교: 이집 계산값"**을 항상 병기해 RAW/DERIVED를 구분한다(§4/§15
원문 예시와 동일한 방향).

---

## 16. Current Apartment Context

`aptSeq` 쿼리 파라미터(신규 — `buildCanonicalSchoolHref`가 아파트 상세에서 진입할
때 함께 싣는다)로 "현재 보고 있던 단지"를 유지한다. DB 변경 없이 query 파라미터만
사용(지시사항 §10 "DB 변경 필요하면 하지 말고 query/state 방식 우선"과 일치). 이
단지가 실제로 학교와 관계가 있으면(zone/middle/nearby) 관련 아파트 목록에서 항상
1순위로 pin되고(§18, 상한선에 밀려 잘리지 않도록 슬라이스 전에 고정), 관계가
없어도 별도 `currentApartment` 필드로 비교 컨텍스트를 계속 보여준다.

---

## 17. E-jip Interpretation

`src/lib/school-decision-insight.ts`(순수 함수, `school-decision-insight.test.mjs`
7개 테스트) — 최소 2개 이상의 유효한 비교값이 있을 때만 다음을 deterministic하게
생성한다: 최단거리 단지, 최고가/최저가 차액(실제 금액), 최신축 단지, 현재 단지의
거리 순위. **AI/LLM 호출 없음** — 전부 배열 reduce/필터 기반 산술 비교다. "명문
학교"/"좋은 학교"류 가치판단 문자열은 코드 어디에도 없다(§12 준수, grep 가능).

---

## 18. Price Trust

기존 `fetchMolitData`/`dealCanceled` 판정을 그대로 재사용 — API 실패와 무거래를
혼동하지 않는 기존 trust rule(§27)을 새로 구현하지 않고 그대로 상속했다. 가격이
없는 후보는 `hasRecentPrice:false, price:null`로 정직하게 남는다(0 처리 금지).

---

## 19. Error/Empty

- School/Kakao 어느 쪽으로도 이름을 확정할 수 없으면 API가 `404 NOT_FOUND` →
  클라이언트가 `Empty` 컴포넌트로 안내.
- 네트워크 실패 → `ErrorState`.
- 관련 아파트 0건 → "연결된 아파트 정보를 찾지 못했어요"(0을 조용히 숨기지 않음).
- 로딩 중 → `InlineLoading`(blank screen 없음).

---

## 20. Mobile

360px/375px 라이브 확인(iframe-isolation 기법) — 헤더 배지 줄바꿈, 관련 아파트
카드, "이집의 해석" 카드, CTA 2-버튼 행, 하단 출처 전부 가로 스크롤/클리핑 없이
정상. 긴 학교명(예: "해운대두산위브더제니스" 급의 8자 이상 아파트명)도 카드 안에서
자연 줄바꿈.

---

## 21. Desktop

852px에서 대신초등학교/구덕초등학교/해원초등학교 케이스 라이브 확인 — 헤더/관련
아파트/이집의 해석/CTA/네비게이션 전부 정상. 모바일 전용 컴포넌트를 그대로 desktop
폭에 늘린 구조라 카드가 과도하게 늘어나지 않는다(`aptList`가 이미 max-width 없는
단일 컬럼 리스트 — 기존 관례 유지).

---

## 22. Performance

- 관련 아파트 최대 12건(§ MAX_RELATED) — 상한 없이 전부 내려주지 않는다.
- ApartmentMaster 조회는 **1회**(`aptSeq: { in: [...] }`), 아파트 개수만큼
  반복하지 않는다(N+1 방지).
- 가격은 **distinct lawdCd 개수만큼만** MOLIT 호출(대부분 1~2회) — 아파트
  개수만큼 호출하지 않는다.
- attendance-zone artifact는 기존 모듈 스코프 캐시(`cachedArtifact`)를 그대로
  재사용 — 요청마다 5.76MB를 다시 읽지 않는다.

---

## 23. Data Gaps

- **SchoolStat 0건** — 학생수/학급수/교원수/학년별 구성/학교 특성 데이터 없음
  (§24 next-step).
- School 공식 좌표 0% — 위치 섹션은 Kakao 외부 좌표(쿼리로 들어온 경우)에만
  의존, 대부분의 canonical 진입(아파트 상세→학교, 좌표 쿼리 없음)에서는 거리
  계산 자체가 생략된다(정직한 생략, 추정 없음).
- `School.isActive` 폐교 필터가 canonical 조회 경로 전체에 아직 일관 적용되지
  않음(SCHOOL V2 FINAL QA §28-8에 이미 기록된 기존 한계, 이번 STEP도 확장하지
  않음).

---

## 24. Future School Score Work

1. **SchoolStat 실제 ingestion**(학교알리미 학년별·학급별 학생수=apiType09,
   직위별 교원현황=apiType22) — legal gate는 CLEARED(§1)이지만 실제 API 호출
   패턴/파싱/664개 학교 순회는 이번 STEP 범위를 넘는 **대규모 신규 데이터
   ingestion**이라 별도 STEP(SCHOOL_DATA_BACKFILL 후보)으로 분리했다.
2. School 공식 좌표(위경도) ingestion — 위 통계 ingestion과 같은 API 호출
   세션에서 함께 확보 가능(schoolinfo.go.kr apiType0).
3. SchoolStat 확보 후 §10 학교 헤더에 실제 학생수/학급당 인원 카드 추가.
4. 시계열/증감률/학교 자체 점수화는 §1-3 라벨링 원칙(RAW/DERIVED 명확 분리)을
   지키는 선에서 SchoolStat 확보 이후 검토(현 시점엔 데이터 자체가 없어
   불가능).
5. `School.isActive` 폐교 필터를 canonical 조회 경로 전체로 확장(선행 데이터
   소스 이슈 해소 필요, §23).

---

## How To Run

```bash
npm run dev

node --experimental-strip-types --test src/lib/education/school-apartment-relations.test.mjs \
  src/lib/school-trade-price.test.mjs src/lib/school-decision-insight.test.mjs src/lib/school-link.test.mjs
node --experimental-strip-types --test $(find src scripts -name "*.test.mjs")
npx tsx --test $(find src scripts -name "*.test.ts")

# EducationSource governance 등록(이미 1회 실행 완료, 재실행해도 upsert라 안전)
npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
  -r ./scripts/_register-paths.js scripts/education/register-schoolinfo-source.ts
```

---

## 관련 문서

- `docs/development/SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md` — 이번 STEP §1이
  해소한 CONDITIONAL 게이트의 최초 조사.
- `docs/development/SCHOOL-V2-C1-core-education-schema.md` — `School`/`SchoolStat`/
  `EducationSource` 스키마 최초 설계.
- `docs/development/SCHOOL-V2-C6A-busan-attendance-zone-build.md` — attendance-zone
  artifact(3,402건) 구축 근거.
- `docs/development/APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX.md` — 이번 STEP이
  이어받은 학교 클릭 복구(좌표 기반 Kakao-only) 직전 STEP.
- `docs/development/CHANGELOG.md` — 이번 STEP 항목 추가.
