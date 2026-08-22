# SCHOOL V2-D1 — 부모 의사결정형 교육환경 UX

## 목적

SCHOOL V2 데이터 기반 작업(school-v2-integration)이 완료되어, 단지 상세 화면에
"학교 데이터 나열"이 아니라 부모가 "이 아파트에서 아이 키우기 어떨까?"를 빠르게
판단할 수 있는 실제 UI를 구현했다.

## 0. 기준 branch

base: `school-v2-integration`(HEAD `0868682`). 새 브랜치
`school-v2-d1-parent-education-ui`를 worktree로 분리해 작업. main(C3A 미커밋
작업 보존)에는 접근/수정하지 않았다.

## 1. Information architecture

기존 `/apt/[name]` → `apt-client.tsx`의 "단지 주변 생활정보" 탭(환경/교통/학군)
구조를 그대로 유지하되, **학군 탭의 내용물만** 기존 `SchoolDistrictPanel`(카카오
POI 나열)에서 신규 `EducationPanel`로 교체했다(중복 section 신설 없음, §3
지시대로 기존 구조를 대체).

```
학군 tab
 └ EducationPanel
     ├ 한눈에 요약(4개 summary chip)
     ├ 초등학교 (공식 통학구역 / 가까운 초등학교 — 분리)
     ├ 중학교 (학교군)
     ├ 유치원 (공식 데이터)
     ├ 고등학교
     ├ 어린이집 (준비 중)
     └ 출처 표기
```

`SchoolDistrictPanel.tsx`는 삭제하지 않고 보존했다(다른 곳에서 참조하지 않음,
향후 필요 시 복원 가능하도록 — CLAUDE.md #2/#14 원칙).

## 2. API 접근 방식(선택 및 이유)

**신규 전용 route** `GET /api/apt/[name]/education`을 만들었다(기존 `/info`,
`/score`, `/facilities`와 나란한 형제 route). 기존 route를 확장하지 않은 이유:

1. `getApartmentEducationZone()`이 5.76MB artifact를 매 호출 `fs.readFileSync`로
   읽는 무거운 동작이라, 기존 route(`/info` 등)의 응답 흐름에 얹으면 무관한
   관심사가 섞이고 그 route 전체가 느려질 위험이 있다(§27 성능 회귀 금지).
2. aptSeq 해석 로직(이름+lawdCd+dong 정확 매칭 우선 → 느슨한 매칭 폴백 →
   복수/미매칭 시 안전하게 실패)은 `/score` route와 동일 원칙을 재사용했다 —
   다른 단지의 데이터를 잘못 반환하는 사고를 방지하는 기존 검증된 패턴이다.
3. `apt-client.tsx`가 이미 `/info`/`/score`/`/facilities`/base route를 병렬로
   호출하는 기존 패턴이 있어, 교육 데이터도 독립 요청 1개를 추가하는 것이
   기존 waterfall 구조와 일관된다(같은 데이터를 두 번 부르는 중복은 없음).

## 3. status semantics(그대로 유지, UI 라벨만 부여)

C6-B의 4개 status(`AVAILABLE`/`SHARED`/`REVIEW_REQUIRED`/`NOT_AVAILABLE`)를
수정 없이 그대로 사용한다. UI 표시 라벨(`src/lib/education/education-ui-labels.ts`,
순수 함수로 분리해 node:test로 검증):

| status | 라벨 |
|---|---|
| AVAILABLE | 공식 통학구역 기준 |
| SHARED | 공동통학구역 |
| REVIEW_REQUIRED | 통학구역 정보 확인 중 |
| NOT_AVAILABLE | 공식 통학구역 정보를 확인할 수 없어요 |

## 4. 초등학교 — 통학구역 vs 가까운 학교 분리

두 개의 독립된 카드로 명확히 분리했다(§5 지시대로 절대 합치지 않음):

- **공식 통학구역**: `getApartmentEducationZone(aptSeq).elementary` 그대로 사용.
  AVAILABLE/SHARED는 연결된 학교 전부(`schools[]`)를 표시(임의 대표학교 선택
  금지). REVIEW_REQUIRED/NOT_AVAILABLE은 상태 텍스트만.
  법적 고지(§7): "실제 배정은 관할 교육지원청 기준을 확인하세요." — 작은
  아이콘+텍스트 1줄, 큰 경고 박스 없음.
- **가까운 초등학교**: canonical `School` 좌표가 여전히 0%(C5-B 이후 변동
  없음)라 Kakao 실시간 키워드검색("초등학교", REST, `school/apartments/route.ts`
  와 동일한 서버측 호출 패턴 재사용)으로 상위 3개, "직선거리 약 Nm"만 표시
  (도보 시간 절대 금지). 좌표가 없으면 "거리 확인 중"(§8 지시 문구 그대로).

**§9 구조적 차이 설명**: 부산 22.0%가 nearest≠zone이라는 통계는 UI에 노출하지
않고, "가까운 학교와 통학구역 학교는 다를 수 있어요."라는 짧은 도움말 1줄로만
전달한다.

## 5. 중학교 — 학교군

`middleSchoolGroup` 그대로 사용. `groupName` + `schools.length`로
"OO학교군 · N개 중학교가 포함돼 있어요" 표시, "학교 목록 보기" accordion(§19,
페이지 이동 없이 펼침). 1개교뿐인 학교군은 학교명을 바로 노출(§10, 실측상
안전 — `middleGroupIsSingleSchool()`로 판단). "단일 배정 중학교"라는 표현은
어디에도 없다(가드 테스트로 확인).

## 6. 유치원 — 공식 데이터

`Kindergarten`(부산 367건) 테이블을 `@turf/turf` distance로 직접 조회(신규
`src/lib/education/nearby-education.ts::findNearbyKindergartens`, bbox
사전필터 + turf 실거리, `nearby-apartments.ts`의 기존 패턴 재사용). 1차 카드:
유치원명/공립·사립(`establishmentType`)/직선거리. "더보기"로 `KindergartenStat`
(정원/현원/학급수) 펼침. 2km 이내 결과가 0건이면 "2km 이내 등록된 유치원이
없어요"(실제 검색 결과, 정직한 표현) — 단 아파트 좌표 자체가 없는 경우
(`COORDINATE_MISSING`)는 "단지 위치를 확인할 수 없어..."로 별도 구분(§ 아래
"확인된 부재" vs "확인 불가" 참고).

## 7. 고등학교 — 반드시 포함(§13)

canonical `School`(HIGH 159건) 좌표도 0%라 유치원과 달리 Kakao 키워드검색
("고등학교")으로 목록을 만들되, **이름+lawdCd+HIGH 버킷 완전일치가 유일할
때만** canonical `establishmentType`을 안전하게 붙인다(`matchCanonicalHighSchool`,
fuzzy matching 아님 — C2B-A/C6-A와 동일한 안전 매칭 원칙 재사용). "명문고"/
"학군 좋은" 같은 주관적 라벨은 만들지 않는다(가드 테스트로 확인).

## 8. 졸업생 진로(§14) / SchoolInfo 통계(§15)

**둘 다 section 자체를 만들지 않았다.** 13-다 졸업생 진로는 현재 OpenAPI
목록에 없어 ingestion 대상이 아니며, "준비 중" 카드를 만드는 것도 지시대로
남발하지 않는다(데이터가 있을 가능성 자체가 불확실한 항목). SchoolInfo
학생수/학급수/교사수는 `SchoolStat` 0행이므로 카드를 아예 숨겼다 — "0명" 등
가짜/추정값을 만들지 않는다(가드 테스트로 두 항목 모두 소스에 없음을 확인).
두 영역 모두 향후 데이터 확보 시 `EducationPanel`에 새 `<section>`을 추가하는
것으로 확장 가능(현재 구조가 이를 방해하지 않음).

## 9. 어린이집(§12) — "0곳" 금지

Childcare(C3A) API key 미승인으로 DB가 비어있다. "어린이집 정보 준비
중이에요."라는 고정 문구 1줄만 표시하고(section은 유지, 완전히 숨기지 않음 —
이 앱의 기존 관례인 "데이터 준비 중" 표현과 일관), API 승인 등 내부 사정은
노출하지 않는다.

## 10. "확인된 부재" vs "확인 불가" 구분(신규 발견, 구현 중 보정)

브라우저 QA 중 발견: 아파트 좌표가 아예 없는 경우(`COORDINATE_MISSING`)에도
유치원/고등학교 요약칩이 "2km 이내 없음"으로 나와 "검색했는데 없었다"처럼
읽히는 문제를 발견했다 — 실제로는 "애초에 검색할 좌표가 없었다"는 뜻이라
과장된 확신이다. `elementaryAttendanceZone.reasonCode === 'COORDINATE_MISSING'`
신호로 `coordinateUnavailable`을 판별해 이 경우 요약칩/section 문구를
"확인 불가"/"단지 위치를 확인할 수 없어..."로 분리했다(에코델타호반써밋스마트
시티로 실측 확인).

## 11. server-only 강제(§21, 매우 중요)

npm `server-only` 패키지는 Next.js 번들러의 조건부 exports에 의존해 이
프로젝트의 실제 테스트 실행 방식(`tsx --test`, plain Node)에서는 무조건
throw하며 기존 테스트를 깨뜨린다는 것을 실측으로 확인하고 **패키지 채택을
포기**했다. 대신 `attendance-zone.ts`/`nearby-education.ts` 양쪽에
`if (typeof window !== 'undefined') throw ...` 최소 runtime guard를 직접
추가했다 — 브라우저에서 평가되면 즉시 throw, plain Node(`window` undefined)
에서는 no-op이라 기존 테스트에 영향 없다.

**빌드 후 실측 검증**: `npm run build` 후 `.next/static`(client bundle)에
`busan-attendance-zone`/`resolverVersion` 문자열이 **0건**임을 grep으로
확인, `.next/server`에는 정상적으로 포함됨을 확인(`CLIENT_BUNDLE_ARTIFACT_
INCLUDED = false`).

## 12. 출처 표기(§16)

section 하단에 항상 노출: `학교: NEIS` · `유치원: 유치원알리미` ·
`통학구역: 학구도안내서비스(한국교육시설안전원) · 기준일 2026.03.20`. 복잡한
법적 문구는 본문 대신 §7의 짧은 안내 1줄로 대체.

## 13. 이집이 캐릭터(§17)

이번 STEP에서는 마스코트 캐릭터를 EducationPanel 안에 직접 등장시키지
않았다 — 기존 `Empty` 컴포넌트(마스코트 포함)를 재사용할 수 있는 지점
(`data.status !== 'OK'`)에서도 `showMascot={false}`로 억제하고 텍스트만
사용했다. 이유: 학교명/거리/통학구역 같은 실제 정보가 화면의 대부분이고,
캐릭터가 이보다 강조되면 안 된다는 지시(§17)를 가장 안전하게 지키는 방법은
"이번 STEP에서는 아예 노출하지 않는다"였다 — mascot asset/디자인이 이 화면
전용으로 확정되지 않았기 때문에(§17 "실제 mascot asset이 없거나 디자인
확정 전이면 텍스트/아이콘으로 먼저 구현") 텍스트+Lucide 아이콘(`Info`)만
사용했다.

## 14. visual hierarchy(§18)

E-jip Green(`--primary-color`), Lucide 아이콘(`School`/`GraduationCap`/
`Baby`/`Info`/`ChevronDown`)만 사용, emoji 0건(가드 테스트로 확인). 기존
디자인 시스템 컴포넌트(`Badge`/`Empty`/`ErrorState`/`InlineLoading`) 재사용,
새 UI primitive를 만들지 않았다. summary row는 모바일 2열/480px 이상 4열
grid.

## 15. interaction(§19)

중학교 학교군/유치원 상세 모두 accordion(`aria-expanded`, 기존
`ApartmentScoreCard`의 "왜 이런 점수인가요?" 패턴 그대로 재사용) — 페이지
이동 없이 단지 상세 context 유지.

## 16. aptSeq 연결(§20)

`/score` route와 동일한 이름+lawdCd+dong 매칭 로직을 `/education` route에
자체적으로 구현했다(코드 재사용이 아니라 로직 재사용 — `/score` route 자체를
건드리면 기존 Score 기능에 회귀 위험이 있어 손대지 않았다). 같은 데이터를
두 번 부르는 중복 API 호출은 없다(education route 1회 호출로 통학구역+
중학교군+유치원+고등학교 전부 응답).

## 17. QA 샘플(실제 API/브라우저로 확인)

| 아파트 | 기대 | 확인 방법 | 결과 |
|---|---|---|---|
| 향원에이스타운(79) (26140-35) | SHARED, 대신초+동신초 | 브라우저(390px) | ✅ 정확히 일치 |
| 신화타워 (26260-75) | SHARED, 온천초 HIGH+공덕초·금성초 MEDIUM | API | ✅ 3개교 전부 노출 |
| 한진 (26230-144) | REVIEW_REQUIRED(invalid geometry) | 브라우저 | ✅ 학교 목록 미노출, 상태 텍스트만 |
| 에코델타호반써밋스마트시티 (26440-147) | NOT_AVAILABLE(coordinate missing) | 브라우저 | ✅ 4개 요약칩 전부 "확인 불가" |
| 비스타동원더비치테라스 (26140-1353) | AVAILABLE 단일(송도초) | API | ✅ |
| 한진 — 중학교군 | 4학교군·18개교 | 브라우저 | ✅ |
| 향원에이스타운 — 중학교군 | 3학교군·8개교 | 브라우저 | ✅ |
| 한진/향원 — 유치원 | 공립/사립 badge, 더보기(정원/현원/학급) | 브라우저 | ✅ 실제 데이터 |
| 한진/향원 — 고등학교 | 학교명/설립유형/거리 | 브라우저 | ✅ canonical 매칭 정상 |

각 샘플에서: school name 정확, wrong-region 0건, 최근접 fallback을 통학구역
대신 쓴 사례 0건, "배정학교" 0건, 허위 도보 0건, 가짜 SchoolInfo 통계 0건,
어린이집 "0곳" 0건, 고등학교 section 존재, 출처 표기 존재 — 전부 확인.

## 18. empty/loading/error 구분(§23)

- LOADING: `InlineLoading`("교육환경 정보를 확인하고 있어요...")
- DATA_UNAVAILABLE(aptSeq 미해결): `Empty variant="noData"`(마스코트 억제)
- REVIEW_REQUIRED: 정상 렌더 경로 안에서 상태 텍스트로 표시(에러 아님)
- NETWORK_ERROR(fetch 실패/응답 오류): `ErrorState variant="inline"`

## 19. responsive / 알려진 한계

390px 모바일 뷰포트에서 실제 렌더 확인(브라우저 QA). 360/375/430/desktop
개별 스크린샷은 이번 세션에서 브라우저 자동화 도구(`resize_window` 이후
`Page.captureScreenshot`가 간헐적으로 timeout)의 불안정성 때문에 픽셀 단위로
전부 캡처하지 못했다 — CSS는 모바일 우선(2열 grid, 480px에서 4열)으로
작성했으나 360/375/430/desktop 개별 시각 확인은 후속 확인 필요로 남긴다
(정직하게 기록, 임의로 "확인 완료"라 하지 않음).

## 20. accessibility

`aria-expanded`(accordion), `aria-hidden="true"`(장식 아이콘), `role="status"`
(InlineLoading), `role="alert"`(ErrorState), 44px min-height(`expandToggle`
버튼) 적용. 별도 자동화 접근성 감사 도구는 실행하지 않았다(수동 검토만).

## 21. existing UI regression(§26)

`apt-client.tsx`의 실거래/이집점수/면적/교통/생활/통계/공유 등 기존 기능은
`EducationPanel` import 교체 1줄 + 렌더 교체 1줄 외에 손대지 않았다. 빌드
결과 라우트 목록 동일, 기존 라우트 컴파일 정상.

## 22. performance(§27)

- artifact(5.76MB) client bundle 포함 0건(§11 실측 확인).
- education route 1회 호출로 4개 데이터(통학구역/중학교군/유치원/고등학교)
  전부 응답 — 섹션별 개별 API 호출로 waterfall을 만들지 않음.
  Kakao 호출 2건(초등/고등학교)은 route 내부에서 `Promise.all` 병렬 처리.
- Kindergarten 전체 367건을 client에 내려보내지 않는다 — bbox+turf로 서버에서
  반경 2km, 상위 5건만 필터링해 응답.
- School 전체 664건도 client에 내려보내지 않는다 — Kakao 결과 상위 3건만
  canonical 매칭 시도.

## 23. tests / tsc / lint / build

- 신규: `education-ui-labels.test.ts`(10건, 순수 라벨/분기 로직), `EducationPanel.guard.test.ts`
  (8건, source-content guard — client에서 artifact 미import/"배정학교"·
  "도보"·emoji·가짜 통계·어린이집 "0곳" 미포함 확인).
  DOM 렌더링 테스트 프레임워크가 이 프로젝트에 없어(node:test 기준 기존 관례)
  순수 함수+소스 문자열 검사로 회귀를 막는다.
- 전체 `185/185 PASS`(기존 167 + 신규 18).
- `npx tsc --noEmit` — 0 errors.
- `npx eslint` — 0 errors(무관한 기존 warning 1건만).
- `npm run build` — 성공, 신규 라우트 `/api/apt/[name]/education` 정상 컴파일,
  client bundle에 artifact 미포함 재확인.

## 24. 알려진 문제 / 한계

1. ~~360/375/430/desktop 개별 뷰포트 스크린샷 미완료~~ — SCHOOL V2-D1-QA(§26)
   에서 완료.
2. 졸업생 진로/SchoolInfo 통계 section은 이번 STEP에서 아예 만들지 않음 —
   후속 D2에서 실제 데이터 확보 시 신규 section 추가 필요.
3. 고등학교 `establishmentType`은 이름+lawdCd+HIGH 완전일치가 유일할 때만
   붙는다 — 매칭 실패 시 설립유형 없이 이름+거리만 표시(정직한 부분 정보).
4. `SchoolDistrictPanel.tsx`는 삭제하지 않고 미사용 상태로 보존.

## 25. 다음 단계(SCHOOL V2-D2 제안)

- ~~360/375/430/desktop 뷰포트 실측 확인~~ — SCHOOL V2-D1-QA에서 완료(§26).
- SchoolInfo 공식 회신 도착 시 학생수/학급수 section 추가.
- 13-다 데이터 소스 확보 시 졸업생 진로 section 추가.
- Childcare(C3A) API key 승인 시 어린이집 section을 실제 리스트로 전환.

---

## 26. SCHOOL V2-D1-QA — Responsive Visual Acceptance(추가 STEP)

새 기능 개발 없이 §19의 미완료 항목(360/375/430/desktop 개별 뷰포트 확인)만
마무리했다. 기준 branch/브랜치 동일(`school-v2-d1-parent-education-ui`).

### 26.1 검증 결과

| viewport | 아파트 | status | 확인 결과 |
|---|---|---|---|
| 360×800 | 신화타워 | SHARED(HIGH+MEDIUM) | 통과(버그 1건 발견·수정, 아래 참고) |
| 375×812 | 비스타동원더비치테라스 | AVAILABLE | 통과, 오버플로/클리핑 없음 |
| 390×844 | 한진 | REVIEW_REQUIRED | 통과, "학교 목록 보기" accordion(18개교) 확장 정상 |
| 430×932 | 향원에이스타운(79) | SHARED(대칭) | 통과, 4개 summary chip 한 줄 정상 |
| 1440×900 desktop | 에코델타호반써밋스마트시티 | NOT_AVAILABLE | 통과, 과도한 여백/줄어듦 없음 |

스크린샷 5장 저장 및 사용자에게 전달 완료(`d1-qa-screenshots/` — 360/375/390/430/
desktop 각 1장).

### 26.2 실제 버그 발견 및 수정

**유치원 카드 "더보기" 버튼이 직선거리 텍스트에 붙어 보이는 문제**(360px에서
"직선거리 약 418m더보기"처럼 줄바꿈 없이 이어짐)를 실측으로 발견했다. 원인:
`.expandToggle`이 `display: inline-flex`라 앞선 인라인 텍스트와 같은 줄에
붙을 수 있었다 — `margin-top`은 인라인 박스에 새 줄을 강제하지 않는다.
`display: flex`(block-level)로 변경해 항상 새 줄에서 시작하도록 수정
(`EducationPanel.module.css`). 375px 이후 뷰포트에서 fix 적용 확인, 다른
버튼(중학교 "학교 목록 보기")에는 영향 없음(이미 block 요소 뒤라 무관).

이 외 발견된 문제: **없음.**

### 26.3 §3 체크리스트 결과

- horizontal overflow: 5개 뷰포트 전부 없음.
- chip 잘림: 없음(360px 2×2, 430px 이상 1×4 모두 텍스트 완전 노출).
- 학교명 과도한 줄바꿈: 없음(긴 이름 "부산알로이시오초등학교"/"부일전자디자인
  고등학교"/"감천초등학교병설유치원" 전부 한 줄 유지).
- accordion 버튼 잘림: 없음, "더보기"(§26.2로 수정) / "학교 목록 보기" 둘 다
  정상.
- 긴 중학교 학교군 이름 대응: "4학교군·18개 중학교" 목록 전개 시 스크롤 내
  전부 정상 표시(390px에서 실측).
- 공동통학구역 복수 학교: 신화타워(3개교, MEDIUM 포함)/향원에이스타운(2개교)
  전부 정상.
- 유치원/고등학교 카드 폭: 5개 뷰포트 전부 정상.
- source/provenance 잘림: 375px에서 한 줄 전체 노출 확인, 다른 뷰포트도
  동일 패턴이라 문제 없음.
- bottom nav 충돌: `StickyPriceBar`가 bottom nav 위에 정확히 쌓이고 겹치지
  않음(모든 모바일 뷰포트 확인).
- 44px touch target: `.expandToggle`에 `min-height: 44px` 이미 적용,
  실측으로도 클릭 반응 정상.
- 글씨 크기: 최소 0.72rem(출처 표기, 부가정보) ~ 0.95rem(섹션 제목) — 로그인
  등 기존 UI 텍스트 크기와 비슷한 범위, 과도하게 작지 않음.
- desktop 과도한 여백: 1440px에서 카드가 컨테이너 폭에 맞춰 합리적으로
  배치, 텍스트가 화면 전체 폭으로 늘어지지 않음.

### 26.4 텍스트 안전성 재확인(§5)

5개 뷰포트 QA 전체에서: "배정학교" 0건, 허위 "도보 N분"(교육 항목) 0건,
"어린이집 0곳" 0건("어린이집 정보 준비 중이에요"만 확인), SchoolInfo dummy
stat 0건, wrong-region fallback 0건 — 전부 §5 기준 그대로 유지.

### 26.5 도구 관찰(참고 기록)

`resize_window` 호출 직후 `navigate`를 하면 뷰포트가 리셋되는 현상을
재현했다 — `navigate` 이후 `resize_window`를 다시 호출해야 의도한 크기가
유지됨(작업 중 그렇게 우회). 스크린샷 해상도가 요청한 CSS px와 정확히
비례하지 않는 경우도 있었으나(디바이스 픽셀비 스케일링으로 추정), 시각적
검증 자체(레이아웃/줄바꿈/겹침)에는 영향이 없었다.

### 26.6 regression

CSS 1개 파일(`EducationPanel.module.css`)만 수정. 재실행 결과: tests
185/185 PASS(변동 없음), tsc 0 errors, eslint 0 errors(무관한 기존 warning
1건), build 성공.
