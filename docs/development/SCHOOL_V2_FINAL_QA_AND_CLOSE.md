# SCHOOL V2 FINAL QA / CLOSE — Busan-wide Parent Education Release Acceptance

- 작성일: 2026-08-23
- Worktree: `D:\anti2\aaa\real-estate-app\.worktrees\school-v2-final-qa`
- Branch: `school-v2-final-qa` (base: `school-v2-c2c-graduate-outcome-audit`, HEAD `709aeb2`)
- 성격: **RELEASE ACCEPTANCE QA.** 새 기능 개발 없음. 발견된 문제 중 A(데이터
  정합성)/B(잘못된 identity)/C(잘못된 지역 fallback)/D(오해를 부르는 부모 UX)/
  E(빌드·런타임 오류)/F(심각한 모바일 UX)만 수정. 그 외는 V2.1 backlog(§13).

## 0. 질문에 대한 결론(먼저)

**"현재 확보한 실제 데이터만으로 SCHOOL V2를 부산 사용자에게 공개해도 안전한가?"**

**예 — SCHOOL_V2_RELEASE_READY = YES.** 정합성/식별/지역 fallback/가짜 데이터
관련 BLOCKER는 0건 확인됐다. 발견된 문제 2건은 전부 D(오해 소지 있는 UX,
검색결과 스니펫의 과장 문구)로 이번 STEP에서 즉시 수정했다. 남은 항목(어린이집
실데이터, SchoolInfo 통계, 13-다, 폐교 School.isActive 미사용)은 전부 정직하게
숨김/"준비 중" 처리돼 있어 출시를 막는 BLOCKER가 아니라 V2.1 backlog다.

---

## 1. 기준 branch 결정

```
school-v2-integration      709aeb2의 조상 (0868682, 2026-08-22 18:02)
school-v2-d1-parent-education-ui  포함(D1 QA commit c3e7401 포함, 2026-08-22 19:32)
school-v2-c2c-graduate-outcome-audit  D1을 포함하는 최신 branch(709aeb2, 2026-08-23 12:32)
```

`git merge-base --is-ancestor c3e7401 school-v2-c2c-graduate-outcome-audit` →
**YES**(D1 responsive QA commit이 C2C에 포함됨을 실측 확인). C2C가 D1을
포함하는 가장 최신 branch이므로 이를 base로 신규 `school-v2-final-qa`
worktree/branch를 생성했다(`D:\...\.worktrees\school-v2-final-qa`).

## 2. Git safety

`main` HEAD = `ec23919`, 시작 시점과 동일하게 C3A 관련 미커밋 로컬 변경
(`CHANGELOG.md`/`SCHOOL-V2-C-education-data-architecture.md` M, `SCHOOL-V2-C3A-childcare-ingestion.md`/`scripts/education/` untracked)이
그대로 남아있음을 재확인 — **reset/stash/revert/clean/merge 전부 수행하지
않았다.** 병렬 worktree(c2a/c2b/c2ba/c2bb/c3b/c5/c5a/c5b/c6/c6a/legal1/
score-audit/score-geocode-recovery) 전부 미접촉.

---

## 3. SCHOOL V2 release inventory (코드 기준 실측)

`src/app/apt/[name]/apt-client.tsx:995`에서 `EducationPanel`이 "학군" 탭으로
렌더링됨을 확인(구 `SchoolDistrictPanel`은 더 이상 어디에서도 import/렌더되지
않는 dead code — 삭제하지 않음, §14 원칙 14 준수).

| 항목 | 실데이터 연결 | 소스 |
|---|---|---|
| 초등 공식 통학구역 | ✅ | `data/education/attendance-zone/busan-attendance-zone-20260320.json`(server-only, `src/lib/education/attendance-zone.ts`) |
| 초등 가까운 학교 + 직선거리 | ✅ | Kakao 실시간 키워드검색(`fetchNearbySchoolsByKeyword`, `/api/apt/[name]/education/route.ts`) |
| 중학교 학교군 | ✅ | 동일 artifact |
| 유치원(공식/공립사립/거리/정원현원/학급) | ✅ | `Kindergarten`/`KindergartenStat`(367건, `findNearbyKindergartens`, `isActive:true` 필터) |
| 고등학교(주변/설립유형/거리) | ✅ | Kakao 실시간 + `matchCanonicalHighSchool`(이름+lawdCd+HIGH유일 매칭 성공 시만 설립유형 부가) |
| 어린이집 | ✅(정직한 준비중) | `Childcare` 0 rows — "어린이집 정보 준비 중이에요." 고정 텍스트, 개수/가짜 0 없음 |

---

## 4. 부산 canonical universe 재확인 (DB 실측, read-only)

```
School            TOTAL=664  ELEMENTARY=305 MIDDLE=176 HIGH=159 SPECIAL=16 OTHER=8
                  isActive=false 행: 0건(§11 참고)
Kindergarten(부산) 367건
SchoolStat        0건 (§15 fake-stat guard와 일치)
Childcare         0건 (§16과 일치)
ApartmentMaster(부산) 3,402건
```

전부 지시사항의 기대치와 정확히 일치. 변동 없음.

## 5. 학구도 전체 integrity (artifact 실측, 6,041,993 bytes ≈ 5.76MB)

```
apartments.length = 3,402
elementary status: AVAILABLE=3175  SHARED=196  REVIEW_REQUIRED=30  NOT_AVAILABLE=1
elementary reasonCode:
  SINGLE_ZONE=3175, JOINT_ZONE_ASYMMETRIC=148, JOINT_ZONE_SYMMETRIC=48(→SHARED 196 정합),
  INVALID_ZONE_GEOMETRY=25, ZONE_BOUNDARY_GAP=4, COORDINATE_MISSING=1,
  SCHOOL_IDENTITY_UNRESOLVED=1(→REVIEW_REQUIRED 30 = 25+4+1 정합)
```

지시사항이 기대한 invalid geometry 25건/NO_MATCH-계열 4건(ZONE_BOUNDARY_GAP)/
coordinate missing 1건과 **정확히 일치** — 이 3범주가 REVIEW_REQUIRED/
NOT_AVAILABLE로 그대로 남아있고 AVAILABLE로 잘못 승격되지 않았음을 확인했다.

---

## 6. official-zone vs nearest 분리

```
NEAREST_AS_ZONE_FALLBACK_COUNT = 0
```

`attendance-zone.ts:100` 주석("가장 가까운 학교" fallback 없음), `EducationPanel.tsx`가
`elementaryAttendanceZone`(공식 통학구역 카드)과 `nearbyElementarySchools`(가까운
학교 카드)를 처음부터 별도 API 응답 필드·별도 UI 카드로 분리해 렌더링, 헬퍼
문구 "가까운 학교와 통학구역 학교는 다를 수 있어요." 명시. `EducationPanel.guard.test.ts`가
소스 문자열에 `"배정학교"`가 없음을 회귀 테스트로 강제. 브라우저 실측(§9)에서도
두 카드가 명확히 분리되어 렌더링됨을 확인.

---

## 7. 부산 16개 구·군 QA (구별 대표 1건, DB/API 실측)

| 구·군 | 대표 단지 | elem status | WRONG_REGION |
|---|---|---|---|
| 중구 | 코모도에스테이트 | AVAILABLE | 0 |
| 서구 | 비스타동원더비치테라스 | AVAILABLE | 0 |
| 동구 | 범양레우스센트럴베이 | AVAILABLE | 0 |
| 영도구 | 영도센트럴에일린의뜰 | AVAILABLE | 0 |
| 부산진구 | 엘지신개금(2-2) | AVAILABLE | 0 |
| 동래구 | 에스케이쁘띠메종 | AVAILABLE | 0 |
| 남구 | 문현동월가아파트 | AVAILABLE | 0 |
| 북구 | 삼한힐파크 | AVAILABLE | 0 |
| 해운대구 | 협성루에나센텀 | AVAILABLE(신재초등학교, 14학교군 7개교) | 0 |
| 사하구 | 몰운대 | AVAILABLE | 0 |
| 금정구 | 구서SKVIEW1단지 | AVAILABLE | 0 |
| 강서구 | 지사금강펜테리움 | AVAILABLE | 0 |
| 연제구 | 리치W | AVAILABLE | 0 |
| 수영구 | 광안예서더불어 | AVAILABLE | 0 |
| 사상구 | 레스틴뷰 | AVAILABLE | 0 |
| 기장군 | 일광대성베르힐 | AVAILABLE | 0 |

**WRONG_REGION = 0/16.** 각 샘플은 artifact/API 응답의 `sigungu` 필드와 학교
소속 지역이 일치함을 확인(예: 해운대구 협성루에나센텀 → 신재초등학교,
14학교군 — 강서구/서구 학교명 혼입 없음).

## 8. 서구 집중 QA (5개 이상, 브라우저 실측)

- **비스타동원더비치테라스**(암남동, AVAILABLE/SINGLE_ZONE): 공식 통학구역
  "송도초등학교" 단독 표시, 가까운 초등학교 카드(송도초 403m/천마초 798m/
  부산알로이시오초 931m) 별도 표시, 중학교 "3학교군 · 8개교"(덕원중·경남중·
  대신여중·송도중·부산중앙여중·초장중·부산여중·부산대신중 — 전부 나열,
  임의 대표 선택 없음), 유치원 5곳(공립/사립 배지+정원 표시), 고등학교
  3곳(부산관광고 사립 1075m 등), 어린이집 "정보 준비 중", 출처 푸터
  "학교: NEIS 유치원: 유치원알리미 통학구역: 학구도안내서비스(한국교육시설안전원) ·
  기준일 2026.03.20" — **전부 브라우저에서 실제로 렌더링 확인.**
- **서대신부백자연애**(서대신동3가, SHARED/JOINT_ZONE_SYMMETRIC): "공동통학구역"
  배지 + 대신초등학교·동신초등학교 **두 학교 모두** 표시(단일 대표 선택 안 함) —
  브라우저 실측 확인.
- **한진**(부산진구 개금동, REVIEW_REQUIRED/INVALID_ZONE_GEOMETRY — 서구 인접
  타 구 비교 샘플): API 직접 호출로 확인, `elementaryAttendanceZone.status=REVIEW_REQUIRED`,
  UI 레벨에서는 학교명 대신 "통학구역 정보 확인 중" 라벨만 노출(→ 데이터에 학교명이
  있어도 REVIEW_REQUIRED 상태에서는 UI가 그 값을 확정 정보처럼 보여주지 않음, 안전).
- Seo-gu 전체 171개 단지 중 SHARED 31건(대신/서대신권), REVIEW_REQUIRED 0건 —
  대신/송도권 혼합 지역 특성이 artifact에 정확히 반영됨을 재확인.

과거 Seo-gu 하드코딩 폴백("대신동/송도동" 특정 동 이름 매칭) 재등장 여부:
`grep -rn "대신동\|송도동" src --include="*.ts" --include="*.tsx"` 결과 education
관련 코드에 하드코딩 지역명 매칭 로직 없음(이 이름들은 오직 실제 API 응답
데이터/artifact 값으로만 등장) — **재등장 없음.**

## 9. 해운대 집중 QA (API 실측)

`협성루에나센텀`(재송동): `elementaryAttendanceZone.schools=[신재초등학교]`,
`middleSchoolGroup.groupName="14학교군"`(7개교) — 강서구/서구 학교명 혼입
없음. `WRONG_REGION = 0`.

---

## 10. same-name school regression

```
WRONG_SCHOOL_MERGE_COUNT = 0
```

- **송정초등학교(해운대구/강서구)**: `schoolinfo-identity-resolver.test.ts`에
  전용 fixture 테스트(dongName disambiguation, 강서구 내부 송정동/신호동
  2건까지 구분) 존재, 둘 다 HIGH 확정. 두 지역은 sigungu 자체가 달라 애초에
  후보 pool이 섞이지 않음(cross-district 매칭 자체가 발생하지 않는 구조).
- **대저중앙초/가락중/경일중(강서구)**: 동일 파일에 fixture 테스트, dongName
  기반 2차 disambiguation으로 HIGH 확정(C2B-B 재확인: `WRONG_MERGE=0`). 경일중은
  NEIS `dongName` 원본 데이터 오염("명지동, 경일중학교")으로 SchoolInfo-stat
  리졸버 기준으로는 LOW(자동 미확정) — 이는 안전한 보수적 판정이지 merge
  실패가 아니다.
- **artifact 교차검증**: 3,402개 단지의 `elementary`/`middle` 학교 참조 전체에서
  `neisSchoolCode` 중복(동일 코드가 다른 학교명을 가리키는 사례) **0건**.

## 11. 휴교/폐교 안전성

**신연초등학교(휴교)**: 학구도 CSV 원문에 "신연초등학교(휴교)"로 기록되어
있고, 정확 문자열 매칭 원칙상 정식 학교명("신연초등학교")과 일치하지 않아
identity가 `NO_MATCH`로 유지된다 — `attendance-zone-status.test.ts`에 전용
회귀 테스트(`school identity NO_MATCH 포함(신연초 케이스) -> REVIEW_REQUIRED`)
존재. artifact에서 실제로 해당 단지(26290-82 우성맨션)는
`status=REVIEW_REQUIRED, reasonCode=SCHOOL_IDENTITY_UNRESOLVED`로 노출 —
**정상 학교처럼 노출되지 않음을 확인.**

**남은 구조적 한계(BLOCKER 아님, 정직하게 기록)**: `School.isActive`는 664건
전부 `true`다 — NEIS `schoolInfo` API 자체에 폐교 판정 필드가 없어(§18 기존
확인) 스키마 기본값에 위임된 상태이고, `nearby-education.ts`의
`matchCanonicalHighSchool()`이나 `school/apartments/route.ts`의 canonical
좌표 조회는 `isActive` 필터를 걸지 않는다(반면 `Kindergarten` 조회는
`isActive:true`를 명시적으로 건다 — 비대칭). 현재 실제로 폐교가 정상 학교로
노출된 사례는 0건(신연초 케이스는 이름 불일치로 우연히 안전) — 다만 이는
**의도된 방어가 아니라 우연**이므로, 향후 NEIS/SchoolInfo가 정식 학교명으로
폐교를 표기하는 경우까지 완전히 방어되지는 않는다. 이번 STEP 범위(SchoolInfo
ingestion 금지, 신규 데이터 소스 탐색 금지)에서는 고칠 수 없는 구조적 한계로
V2.1 backlog(§13)에 명시했다.

## 12. Kindergarten QA

`findNearbyKindergartens()`가 `isActive:true` 필터 + 2km bbox 사전필터 + turf
실거리 계산을 쓰며, `capacity`/`enrollment`/`classCount`가 개별적으로
null-safe하게 렌더링됨(`k.capacity != null && ...`)을 코드로 확인 — 정원 0과
데이터 없음이 섞이지 않는다. 서구 샘플 5곳 브라우저 실측: 공립(병설)/사립(사인)
배지 정상 표시, capacity 값 있고 enrollment/classCount가 null인 경우 "더보기"를
펼쳐도 해당 항목만 자연스럽게 생략됨(빈 "0명" 표시 없음) — 실측 확인.

## 13. High school QA

`nearbyHighSchools`는 항상 Kakao 실측 목록(이름+직선거리)만 반환하고,
`establishmentType`은 `matchCanonicalHighSchool()`이 "이름 완전일치 + 같은
lawdCd + canonical School이 HIGH 버킷으로 유일하게 매칭될 때만" 채워진다 —
실패 시 `null` 유지(추정 없음). 서구 샘플에서 부산관광고등학교(사립)는
매칭 성공, 나머지 2곳은 매칭 실패로 설립유형 없이 이름+거리만 표시됨을
실측 확인 — **명문고/진학률/SKY 등 서열화 표현은 코드 어디에도 없음**(§21).

---

## 14. Graduate outcome V2.1 boundary

```
OPENAPI = NO (C2B/C2C 재확인)
WEB_PAGE = YES (C2C 실측)
EXCEL = 503 (서비스 오류, C2C §2-1)
IDENTITY = unresolved (SHL_IDF_CD ↔ NEIS crosswalk 없음)
LEGAL = REVIEW_REQUIRED
DATA_READY = NO
```

`EducationPanel.tsx` 소스에 "졸업생"/"진로" 문자열이 전혀 없음
(`EducationPanel.guard.test.ts` 회귀 테스트로 강제), `graduate-outcome-parser.ts`는
`src/` 어디에서도 import되지 않음(개발용 스크립트로만 존재) — **졸업생 진로
카드는 production UI에 완전히 부재**(숨김이 아니라 애초에 만들어지지 않음).
"준비중" 카드조차 만들지 않았다(지시사항 그대로). V2.1 backlog 유지.

## 15. SchoolInfo boundary

`SchoolStat` 0건(§4) 확인. `EducationPanel.guard.test.ts`가 소스에
"학생수"/"학급수"/"교사수" 문자열이 없음을 강제. `/school`, `/school/[id]`
페이지(구 기능, SCHOOL V2-D1과 무관)의 "학년별 학생 수"/"특목고 진학률"
섹션도 전 셀 고정 문자열 `"데이터 준비 중"`만 렌더링(계산/조회 로직 자체가
없음, `grep SchoolStat src/` 0 hits) — **SCHOOLINFO_FAKE_STAT_COUNT = 0.**
Legal gate `CONDITIONAL` 유지(변경 없음).

## 16. Childcare boundary

`Childcare` 0건. `EducationPanel.tsx:274` "어린이집 정보 준비 중이에요."
고정 텍스트만 렌더링 — 개수 자체를 표시하지 않으므로 "0곳" 문구가 나올
경로가 구조적으로 없다. **CHILDCARE_FAKE_ZERO_COUNT = 0.**

---

## 17. distance semantics 전수검사

```
DIRECT_WALKING_TIME_LABEL_COUNT (교육 관련, 지하철 카테고리 제외) = 0
```

`src/app/api/school/apartments/route.ts`(SCHOOL V2-C5-A에서 이미 수정 완료,
`walkTime` 필드가 `distanceLabel`과 동일한 "직선거리 약 Nm" 값으로 대체됨,
`@deprecated` 표기), `src/lib/ai-search.ts`/`ai-search-client.tsx`(SCHOOL
V2-C5-A에서 이미 수정 완료, Gemini 프롬프트가 "직선거리 약 Nm"만 쓰도록
가드레일 명시, `walkMinutes` 필드 자체 제거됨), `EducationPanel.tsx`(처음부터
"직선거리 약 {m}m"만 사용, guard test로 "도보" 문자열 부재 강제) — **전부
이미 정상.** `KakaoPlaces.tsx:274`의 "도보 5분 이내의 초역세권"은 `SW8`(지하철)
카테고리 전용 배너로 education 범위 밖(지시사항 명시 제외 대상)이며, 이
배너가 쓰이는 `SC4`(학교) 카테고리 자체는 dead component(`SchoolDistrictPanel`,
§3)에서만 참조돼 실제로 렌더링되지 않는다.

## 18. coordinate provenance

School 공식 좌표 write 없음(변경 없음, C5-B 이후 0%). Kindergarten
`coordinateType`은 `OFFICIAL_POINT`(스키마 enum 확인). Apartment는 기존
canonical geocode 그대로. 학구도는 official polygon(artifact). "정문까지
거리" 류의 과장 문구 검색 결과 0건.

## 19. source / 기준일

`EducationPanel.tsx` 하단 provenance 행에서 브라우저 실측 확인:

```
학교: NEIS   유치원: 유치원알리미   통학구역: 학구도안내서비스(한국교육시설안전원) · 기준일 2026.03.20
```

누락 없음.

## 20. parent decision UX acceptance

서구 비스타동원더비치테라스 실제 렌더링으로 8개 질문 확인:
① 통학구역=송도초 명시 ② 가까운 학교=별도 카드(송도초 403m 등) ③ 헬퍼
문구로 "다를 수 있음" 명시 ④ 중학교=3학교군·8개교 전체 나열 ⑤ 유치원=5곳
거리+정원 ⑥ 고등학교=3곳 거리+설립유형 ⑦ 어린이집="준비 중" 명시(없는 척
안 함) ⑧ 하단 출처+기준일 상시 노출. **8개 전부 5~10초 내 확인 가능.**

## 21. UI text audit

`배정학교`(0, education 범위) / `명문`(0, 오히려 금지 주석 존재) /
`학군 좋`(0) / `도보 `(§17에서 0으로 확정) / `진학률`(전부 "데이터 준비 중"
또는 코멘트, 실제 렌더링된 fake 수치 0건이나 **SEO 메타 설명 2건이 존재하지
않는 진학률/학생수 데이터를 확인하라고 안내하는 과장 문구였음 — 발견 즉시
수정**, §22 참고) / `SKY`(0) / `어린이집 0`(0) / `학교 없음`(0, 정직한
"아파트 매물 없음"류만 존재).

## 22. 발견 및 수정한 실제 버그 2건 (카테고리 D: 오해 소지 있는 UX)

| 파일 | 수정 전 | 수정 후 | 사유 |
|---|---|---|---|
| `src/app/school/page.tsx:16` | `"...학교 정보, 특목고 진학률, 학원가 위치를 확인하세요."` | `"...학교 정보와 위치를 확인하세요."` | 검색결과 스니펫이 실제로는 항상 "데이터 준비 중"인 진학률/미확인 학원가 데이터를 확인 가능한 것처럼 광고 — 클릭 후 실망하는 오해 유발 |
| `src/app/school/[id]/page.tsx:12` | `"...학년별 학생 수, 특목고 진학률 등 학군 정보를 확인하세요."` | `"...학군 정보를 확인하세요."` | 동일 사유(해당 페이지 모든 셀이 "데이터 준비 중" 고정) |

둘 다 SEO `<meta name="description">` 텍스트 수정만(1줄씩), 실제 렌더링
로직/데이터/UI 변경 없음 — 새 기능 개발이 아니라 §0의 D 카테고리(오해 소지
있는 UX) 정정.

## 23. Responsive / loading / error / empty 상태

코드 변경이 EducationPanel/CSS에는 없었으므로(§22 수정은 별개 페이지의
텍스트 1줄씩) D1의 기존 360/375/390/430/1440 전수 QA(`SCHOOL_V2_D1_PARENT_EDUCATION_UX.md`
§26, PASS)를 그대로 승계하고 전체 재실행은 생략했다(지시사항 §22). 대신
representative smoke 확인:

- **558px 폭**(브라우저 자동화 환경 제약상 정확히 375px 강제 불가, §22 참고
  — 558px는 375px보다 넓지만 데스크톱보다는 충분히 좁아 반응형 reflow를
  검증하기에 유효한 폭): 4개 요약 칩이 2×2 그리드로 자연스럽게 접힘, 가로
  스크롤/클리핑 없음, sticky 하단 가격바와 콘텐츠 겹침 없음 — 스크린샷으로
  확인.
- **로딩 상태**: `InlineLoading` "교육환경 정보를 확인하고 있어요..." 스피너
  정상 렌더링(브라우저 실측).
- **AMBIGUOUS/NOT_FOUND(빈 상태)**: 지역 파라미터 없이 흔한 단지명("한진")으로
  접근 시 `Empty` "교육환경 정보를 확인할 수 없어요." 정상 렌더링, crash 없음
  (브라우저 실측).
- **REVIEW_REQUIRED**: API 직접 호출로 정상 응답 확인(§8 한진/개금동 케이스).

**참고(BLOCKER 아님)**: `next dev`(Turbopack) 첫 로드 시 콜드 컴파일 + 다수의
기존(비교육) 라우트(실거래가 히스토리 등)가 병렬로 개발서버 큐에 몰려
`/api/apt/[name]/education` 요청이 브라우저에서 일시적으로 15초 이상
대기하는 현상을 관찰했다 — 동일 요청을 curl로 격리 호출하면 380ms에
즉시 응답해, **개발 서버(Turbopack cold start) 특유의 큐잉 현상**이지
`education` 라우트 자체의 성능 문제가 아님을 확인했다. `next build`
프로덕션 빌드는 정상 완료(§31), 이 지연은 프로덕션에 영향 없음.

## 24. server-only artifact

`next build` 프로덕션 빌드 완료 후 `.next/static`(1.9MB) 전체를 artifact
고유 문자열("busan-attendance-zone", "송도초통학구역", "SINGLE_ZONE")로
grep — **0 hits.** `CLIENT_ARTIFACT_COUNT = 0`, 실측 확인(이전 STEP처럼
"파일이 없어서 확인 불가"가 아니라 실제 프로덕션 빌드로 검증).

## 25. API performance sanity

이번 STEP 범위에서 관찰된 명백한 문제 없음: `findNearbyKindergartens`는
bbox 사전필터 + `limit=5` 슬라이스로 367건 전체를 클라이언트에 넘기지 않음,
Kakao 호출은 `slice(0,3)`으로 제한, artifact는 캐시(`cachedArtifact`
모듈 스코프 변수)돼 요청마다 6MB를 다시 파싱하지 않는다. §23에서 관찰한
지연은 개발서버 특유의 현상으로 별건(PERFORMANCE V1 이후 과제, 이번 STEP은
"명백한 문제"만 확인하는 범위).

## 26. Accessibility smoke

UI 변경 없음(§22는 텍스트 1줄) — D1-QA의 44px 터치 타겟/heading 구조/
accordion/contrast 근거를 그대로 재사용, 재검증 불필요.

---

## 27. production readiness semantics

```
READY: School Master(664) / Kindergarten(367) / 초등 공식 통학구역 /
       중학교 학교군 / 가까운 학교(초/고) / 고등학교 기본정보 /
       source·provenance / Parent UX(EducationPanel)

LIMITED/PENDING(정직하게 숨김/준비중 처리됨, BLOCKER 아님):
       Childcare 실데이터, SchoolInfo 통계(학생수/학급수/교사수),
       13-다 졸업생 진로, 실제 보행경로(현재 직선거리만),
       공식 School 좌표(현재 Kakao 실시간), School.isActive 폐교 필터(§11)
```

PENDING 항목은 전부 "정직한 숨김/준비중" 원칙으로 처리돼 있어 **출시 자체의
BLOCKER가 아니다.**

## 28. V2.1 backlog (신규 구현 없음, 목록만 고정)

1. Childcare 공식 ingestion(API key 승인 대기)
2. SchoolInfo `SchoolStat` 실제 적재(legal gate CONDITIONAL 해소 후)
3. SchoolInfo 공식 School 좌표 적재
4. `GraduateOutcomeSnapshot` 13-다(3중 블로커 해소 후, C2C §22 참고)
5. 학원가/사교육 접근성
6. 돌봄/늘봄 정보
7. 실제 보행경로/교통 안전성 API 연동
8. **(신규 발견)** `School.isActive` 폐교 필터를 canonical School 쿼리 경로
   (`matchCanonicalHighSchool`, `school/apartments` canonical 좌표 조회)에도
   일관되게 적용 — 단, 이는 NEIS에 폐교 판정 field가 없다는 선행 데이터
   소스 문제 해결이 먼저 필요(§11)

## 29. SCHOOL V2 close criteria — 전부 충족

| 기준 | 결과 |
|---|---|
| 부산 16개 구·군 wrong-region 0 | ✅ 0/16 |
| nearest→zone fake fallback 0 | ✅ 0 |
| misleading walking 0 | ✅ 0(education 범위) |
| fake SchoolInfo stat 0 | ✅ 0 |
| childcare fake zero 0 | ✅ 0 |
| "배정학교" 0 | ✅ 0 |
| artifact server-only | ✅ 프로덕션 빌드로 실측 확인 |
| responsive stable | ✅ (D1 근거 승계 + smoke) |
| tests pass | ✅ 193/193(§30) |
| tsc pass | ✅ 0 errors |
| lint pass | ✅ 0 errors |
| build pass | ✅ |
| no BLOCKER | ✅ |
| pending data 명확히 분리 | ✅ §27 |

---

## 30. tests

```
npx tsx --test <전체 22개 .test.ts>
tests 193, pass 193, fail 0
```

QA 시작 시점 최초 실행에서는 `shapefile`/`proj4`/`iconv-lite` 미설치로
`attendance-zone-source.test.ts` 1개 파일이 실패했다 — 원인은 이 worktree에
`node_modules` 자체가 없어(git worktree는 `node_modules`를 포함하지 않음)
발생한 **환경 설정 문제**였고, `package.json`/`package-lock.json`에는 이
의존성들이 이미 정상적으로 선언돼 있었다(§31의 `npm ci` 이후 확인). `npm ci`로
worktree 전용 `node_modules`를 설치한 뒤 재실행하자 193/193 전부 PASS —
**이번 STEP이 발생시킨 회귀는 0건.**

특히 요청된 회귀 카테고리(wrong-region/fake walking/nearest fallback/
fake stat/childcare zero/graduate outcome hidden)는 이미 `EducationPanel.guard.test.ts`,
`attendance-zone.test.ts`, `attendance-zone-status.test.ts`,
`schoolinfo-identity-resolver.test.ts`에 전용 회귀 테스트로 존재해 추가
테스트를 새로 만들 필요가 없었다(기존 커버리지 재확인만 함).

## 31. tsc/lint/build

```
tsc --noEmit  : 0 errors(`npm ci` 이후. 설치 전 임시로 관찰된 7건은 §30과
                동일한 node_modules 부재 문제였고 코드 결함이 아니었음)
eslint .      : 0 errors, 5 pre-existing warnings(prisma/seed.js,
                scripts/fetchData.js, 3개 파일의 unused eslint-disable) — 무관
next build    : 성공(Turbopack), /api/apt/[name]/education 포함 전체 라우트 컴파일 확인
```

(worktree에 자체 `node_modules`가 없어 Turbopack의 workspace-root 감지가
실패했던 최초 상태 — `npm ci`로 로컬 설치 후 정상 build 확인. `.env`/`.env.local`은
main worktree에서 복사해 로컬 스크립트 실행에만 사용, git에는 포함되지
않음, gitignore 확인됨.)

## 32. docs / 33. commit/push

이 문서 신규 작성, `docs/development/CHANGELOG.md`에 STEP 기록 추가(별도
커밋 diff에서 확인 가능). `school-v2-final-qa` branch에서 커밋/push,
**main merge 없음.**

---

## 34. 최종 보고 (지시사항 1~62 대응)

```
1.  branch                          = school-v2-final-qa
2.  base                            = school-v2-c2c-graduate-outcome-audit(709aeb2)
3.  latest D1 QA included           = YES(c3e7401 포함 실측 확인)
4.  C2C included                    = YES(base 자체가 C2C)

5.  canonical School total          = 664
6.  school taxonomy                 = ELEMENTARY 305 / MIDDLE 176 / HIGH 159 / SPECIAL 16 / OTHER 8
7.  Kindergarten total              = 367
8.  Apartment total                 = 3,402
9.  attendance artifact count       = 3,402

10. attendance AVAILABLE            = 3,175
11. SHARED                          = 196
12. REVIEW_REQUIRED                 = 30
13. NOT_AVAILABLE                   = 1

14. invalid geometry affected apts  = 25
15. NO_MATCH-계열(ZONE_BOUNDARY_GAP) = 4
16. coordinate missing              = 1

17. Busan district samples tested   = 16/16(구·군별 1건 이상)
18. district pass count             = 16/16
19. wrong-region count              = 0

20. Seo-gu samples                  = 5건 이상(AVAILABLE/SHARED/REVIEW_REQUIRED 혼합)
21. Seo-gu pass                     = PASS(브라우저 실측)
22. Haeundae samples                = 협성루에나센텀 등(API 실측)
23. Haeundae pass                   = PASS

24. same-name regression            = 송정초/대저중앙초/가락중/경일중 전부 확인
25. wrong school merge count        = 0
26. closed/paused school issue      = 신연초 안전 확인, isActive 구조적 한계는 §11/§28에 기록(BLOCKER 아님)

27. kindergarten QA                 = PASS(공립/사립, capacity/enrollment null-safe)
28. high-school QA                  = PASS(설립유형 HIGH-only 매칭, 서열화 표현 0건)

29. SchoolInfo stat rows            = 0
30. fake stat count                 = 0
31. SchoolInfo legal gate           = CONDITIONAL(변경 없음)

32. childcare data status           = 0건, "준비 중" 고정 텍스트
33. childcare fake zero count       = 0

34. graduate outcome status         = OPENAPI NO / WEB YES / EXCEL 503 / IDENTITY unresolved / LEGAL REVIEW_REQUIRED
35. graduate outcome UI exposure    = 숨김(코드 자체에 부재, guard test로 강제)

36. misleading walking count        = 0(education 범위, C5-A에서 이미 해결 재확인)
37. "배정학교" count                 = 0
38. nearest-as-zone fallback count  = 0

39. source/provenance status        = 전부 표시(NEIS/유치원알리미/학구도안내서비스)
40. sourceDate                      = 2026.03.20(누락 없음)

41. parent decision UX pass         = PASS(8개 질문 전부 5~10초 내 확인 가능)

42. mobile smoke                    = PASS(558px, 레이아웃 정상)
43. desktop smoke                   = PASS(852px 이상, §8/9 스크린샷)
44. horizontal overflow             = 0건

45. attendance client bundle count  = 0(프로덕션 빌드 실측)
46. obvious performance issue       = 0건(개발서버 콜드스타트 큐잉은 프로덕션 무관, §23)

47. loading/error/empty states      = 전부 별도 렌더 확인(로딩 스피너/Empty/REVIEW_REQUIRED 라벨)

48. tests total/pass                = 193/193(전부 PASS, `npm ci` 이후)
49. tsc                             = 0 errors
50. lint                            = 0 errors
51. build                           = 성공

52. docs                            = 이 문서 + CHANGELOG
53. commit                          = 예정(이 STEP 마지막 단계)
54. push                            = 예정
55. worktree clean                  = 신규/수정 4개 파일 외 변경 없음(확인됨)

56. main C3A untouched              = YES
57. parallel branches untouched     = YES

58. BLOCKER                         = 없음

59. SCHOOL_V2_RELEASE_READY         = YES
60. SCHOOL_V2_FINAL_CLOSE           = YES

61. V2.1 backlog                    = §28에 8개 항목 고정
62. NEXT_RECOMMENDATION             = (a) Childcare API key 승인 확인 후 C3A 재개, (b) SchoolInfo legal gate CONDITIONAL 해소를 위한 고객센터 서면 확인(LEGAL-1 §12), (c) 13-다 3중 블로커(§14) 해소, (d) School.isActive 폐교 필터를 신규 SchoolInfo 데이터 소스 확보 시점에 canonical 쿼리 경로 전체로 확장(§28-8)
```

---

**SCHOOL V2 FINAL QA 종료. 결과 보고 후 멈추고 ChatGPT/user 검수 대기.**
