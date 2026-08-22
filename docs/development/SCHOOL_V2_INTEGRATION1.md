# SCHOOL V2-INTEGRATION-1 — 승인된 SCHOOL V2 브랜치 통합

## 목적

SCHOOL V2 작업이 여러 격리 worktree/branch(C2A/C2B/C2B-A/C2B-B/LEGAL-1/C3B/C5/C5-A/
C5-B/C6/C6-A/C6-B)에 분산돼 있었다. SCHOOL V2-D(부모용 실제 UI) 구현 전에, 승인된
코드만 하나의 clean integration branch로 모으는 것이 목적이다. 새 기능/UI 구현/
migration/production DB write/main merge는 이번 STEP 범위 밖이다(전부 미수행).

## 0. main 상태 확인(작업 전 필수 점검)

`git show --stat ec23919` / `git show --name-status ec23919` 실행 결과 **`.gitignore`
3줄 추가만 포함**(C3A 파일 0건 혼입) — BLOCKER 아님. push하지 않고 그대로 보존.
main의 C3A(어린이집) 미커밋 작업(`docs/development/SCHOOL-V2-C3A-childcare-ingestion.md`,
`scripts/education/{ingest-childcare,register-childcare-source,register-childcare-file-source,
verify-childcare-normalization}.ts`)은 이번 STEP 시작·종료 시점 모두 그대로 존재함을
파일시스템 조회로 확인(git 조작 없이 `ls`만 사용) — reset/stash/checkout 등 전혀
실행하지 않았다.

## 1. branch ancestry(실측, `git branch --contains`/`git merge-base` 기준)

보고서 문구를 신뢰하지 않고 전부 git으로 재검증했다. 실제 DAG:

```
82f4914 (C1 schema)
 ├─ da17c0a (C2A)
 │   ├─ 4050166 (C2B audit)
 │   │   ├─ b94bfe0 (C2B-A) ─ 9ac7320 (C2B-B) ─ dfadbf0 (C6) ─ 3919647 (C6-A) ─ 7652cd8 (C6-B)
 │   │   └─ 047ecc9 (LEGAL-1)                    [C2B-A/B와 형제 branch, 서로 미포함]
 │   └─ 91a1a8d (C5) ─ d457100 (C5-A) ─ 5f057f0 (C5-B)   [C2B와 형제, 서로 미포함]
 └─ 1a2be74 (C3B)                                 [C2A조차 미포함, C1에서 직접 분기]
```

핵심 발견(보고서 전제와 다른 점):
- **C3B는 C2A를 포함하지 않는다** — C1에서 곧바로 분기했다(NEIS 마스터 ingestion
  이전에 이미 있던 Kindergarten 스키마만 사용).
- **LEGAL-1은 C2B-A/C2B-B를 포함하지 않는다** — 둘 다 4050166에서 독립적으로
  분기한 형제 branch다. 그 결과 두 branch가 **동일한 파일을 우연이 아니라 같은
  세션에서 병행 작업해 거의 동일한 내용으로 각자 추가**했다
  (`scripts/education/c2b-verify-schoolinfo-api.ts` 122줄,
  `docs/development/SCHOOL-V2-B-official-source-verification.md` +107줄 — 양쪽
  모두 정확히 동일한 diff 크기).
- **C5 계열은 C2B를 포함하지 않는다** — C2A에서 직접 분기, C2B/C2B-A/C2B-B/C6
  계열과 완전히 독립.
- `score-display-bug-audit`(82f4914 tip 그 자체, 추가 내용 없음)와
  `score-geocode-recovery`(6e06e01)는 SCHOOL 작업에 직접 필요하지 않아
  포함하지 않았다(지시대로).

## 2. integration worktree

`git worktree add .worktrees/school-v2-integration -b school-v2-integration 82f4914`
— 모든 SCHOOL V2 branch의 실제 공통 조상(82f4914)에서 시작. main dirty 상태를
base로 쓰지 않았다.

## 3. 통합 대상 분류

| branch | 분류 | 비고 |
|---|---|---|
| school-v2-c6b-attendance-zone-exceptions(7652cd8) | **A**(product code) | C6-B의 status 레이어 + read-only helper(`src/lib/education/`) |
| school-v2-legal1-schoolinfo-gate(047ecc9) | **C**(docs only, +1 tooling script) | SchoolInfo 게이트 판단 문서 |
| school-v2-c5b-coordinate-provenance(5f057f0) | **A**(product code) | `/school/[id]`, `/ai-search`, `/api/school/apartments` 등 실제 route 수정 |
| school-v2-c3b(1a2be74) | **B**(data/ingestion tooling) | ingestion 스크립트만, route/UI 미연동 |
| score-display-bug-audit, score-geocode-recovery | **D**(포함 안 함) | SCHOOL 통합에 불필요 |
| (C2A/C2B/C2B-A/C2B-B/C6/C6-A는 C6-B에 이미 전부 포함) | **E**(descendant에 흡수) | 별도 merge 불필요 — 7652cd8 merge 한 번으로 전부 포함됨 |

## 4. C3B worktree "clean 아님" 이슈 — 재확인 결과 오탐

과거 보고("clean: 아니오, 검토용 보존")를 그대로 믿지 않고 `D:/anti2/aaa/e-jip-school-c3b`
worktree를 직접 확인했다. **1차 확인 시 거의 모든 파일이 수정된 것으로 나왔으나,
이는 `--git-dir`를 main의 `.git`으로 강제 지정해 main HEAD와 C3B worktree 파일을
잘못 비교한 내 실수였다.** `git -C <path>`(자동 감지)로 재확인한 결과
**`git status --short` 완전히 clean, 커밋 1a2be74 밖의 우발적 미커밋 코드는 0건**
— 킨더가든 ingestion 스크립트 3개+문서 전부 이미 1a2be74에 정상 커밋돼 있었다.
BLOCKER 아님.

## 5. conflict 해결

merge 4회(C6-B chain, LEGAL-1, C5 chain, C3B) 중 **3회에서 conflict 발생, 전부
`docs/development/CHANGELOG.md` 1개 파일**(같은 날짜에 병렬로 각자 항목을
추가해서 생긴 전형적인 append-conflict). product code/스키마 파일 conflict는
**0건**(각 branch가 건드리는 실제 코드 파일이 서로 겹치지 않음을 병합 전
`git diff --stat`으로 사전 확인했고, 실제 병합 결과도 그대로 일치).

해결 원칙: 최신 우선이 아니라 **ancestry상 실제 시점**(어느 commit에서 분기했는가)에
맞춰 항목을 재배치했다 — C3B(C1에서 직접 분기)는 C1 항목 직후, C5 계열(C2A에서
분기)은 C2A 항목 직후, LEGAL-1(C2B에서 분기)은 C2B 항목 직후에 삽입. 내용 삭제
없이 전부 보존.

부수 확인: `scripts/education/c2b-verify-schoolinfo-api.ts`와
`SCHOOL-V2-B-official-source-verification.md`(§1에서 언급한 LEGAL-1/C2B-A 중복
작성분)는 git이 **동일 content add/add로 인식해 conflict 없이 자동 병합**됐다 —
수동 개입 불필요.

## 6. correctness 이슈 발견 및 수정(병합 자체가 아니라 병합 후 실제 build에서 발견)

C2A(`verify-school-normalization.ts`)와 C3B(`verify-kindergarten-normalization.ts`)는
**각자 branch에서는 문제없이 통과했지만, 두 branch가 처음으로 한 프로젝트에
공존하면서** `tsc --noEmit`에서 `Cannot redeclare block-scoped variable 'path'`/
`'failures'` 등 10건의 에러가 새로 발생했다. 원인: 두 스크립트 모두 top-level에
`import`/`export`가 전혀 없어 TypeScript가 "모듈"이 아닌 "전역 스크립트"로 취급,
`const path`/`let failures`/`function assertEqual` 등이 프로젝트 전체 전역
스코프에서 충돌했다. 각 파일 최상단에 `export {};` 한 줄을 추가해 모듈 스코프로
격리(로직 변경 0건) — 이것이 바로 "각 branch가 개별로는 통과했어도 통합에서만
드러나는 문제"의 실증 사례다.

## 7. School schema / canonical taxonomy(read-only 확인)

`prisma.school.count()`/`groupBy` + `finalSchoolTypeBucket()`(C2B-B 코드 그대로
재사용, 수정 없음)로 실측:

```
ELEMENTARY 305 / MIDDLE 176 / HIGH 159 / SPECIAL 16 / OTHER 8
TOTAL 664
```

과거 substring 기반 오분류(C2A/C2B-A가 각각 다르게 틀렸던 문제, C2B-B에서 이미
해결)가 재발하지 않았음을 확인 — `school-type-taxonomy.ts`는 exact-value lookup만
쓰므로 구조적으로 재발 불가.

## 8. Kindergarten(read-only 확인)

```
부산 Kindergarten count = 367
duplicate officialCode = 0
sample: coordinateType=OFFICIAL_POINT, coordinateSource=moe_kindergarten_api
        stats[0]: capacity/enrollment/classCount/ageBreakdown 전부 존재
```

실제 ingestion은 재실행하지 않았다(read-only count/sample만).

## 9. attendance-zone artifact 검증

```
apartments.length = 3,402
meta.sourceDate = "2026-03-20"
meta.checksum = "c85ff918..."(존재)
JSON에 geometry(coordinates 필드) 포함 여부 = false(미포함 확인)
canonical schoolId 보유 apartments = 3,396/3,402(나머지 6은 REVIEW_REQUIRED/
  NOT_AVAILABLE로 schools=[]가 의도된 정상 상태)
```

파일 크기 5.76MB(6,041,993 bytes). **client bundle 위험 재확인**:
`getApartmentEducationZone()`은 Node `fs.readFileSync`로 이 파일을 읽는 순수
서버 전용 함수이고, 현재 어떤 `src/app/**` 파일에서도 import되지 않는다(grep
확인, 0건) — 따라서 **현재 시점 client bundle 위험 = 0**. 다만 이 파일은
`data/`(저장소 루트, `public/`이 아님) 아래에 있어 Next.js가 정적 자산으로
자동 서빙하지 않는다는 것도 함께 확인했다. **SCHOOL V2-D에서 실제로 연동할 때는
반드시 Server Component/Route Handler에서만 호출해야 하며, 'use client' 파일에서
직접 import하면 안 된다** — 이번 STEP에서 코드는 추가하지 않고 권고만 남긴다
(예: 연동 시 `import 'server-only'` 가드 추가 권장).

## 10. getApartmentEducationZone() regression

`c6b-06-regression-check.ts` + `src/lib/education/attendance-zone.test.ts`(9건)
integration branch에서 재실행, 전부 기대대로:

- 향원에이스타운(26140-35) → SHARED, [대신초 HIGH, 동신초 HIGH]
- 신화타워(26260-75) → SHARED(JOINT_ZONE_ASYMMETRIC), [온천초 HIGH, 공덕초 MEDIUM,
  금성초 MEDIUM]
- invalid geometry(26230-144, 한진) → REVIEW_REQUIRED/`INVALID_ZONE_GEOMETRY`
- NO_MATCH(26230-264, 삼성비치타운) → REVIEW_REQUIRED/`ZONE_BOUNDARY_GAP`
- COORDINATE_MISSING(26440-147) → NOT_AVAILABLE
- 최근접 학교 fallback 사용 0건(schools=[] 그대로 유지 확인)

## 11. distance safety / hardcoded fallback 전수검사

- `도보 N분` grep: 교육(학교) 관련 코드에서 0건. 유일한 매치(`KakaoPlaces.tsx`
  "도보 5분 이내의 초역세권")는 **지하철 역세권 표현**이며 학교 거리와 무관(범위
  밖으로 명시된 교통 카테고리) — 오탐 아님을 코드 확인.
- `직선거리 약`/`STRAIGHT_LINE_DISTANCE` grep: C5-A/C5-B가 수정한 6개 파일
  (`ai-search.ts`, `KakaoPlaces.tsx`, `school-detail-client.tsx`,
  `school/apartments/route.ts`, `api/ai-search/route.ts`,
  `ai-search-client.tsx`) 전부에 존재.
- `129.0225`/`35.0772`/`대신동`/`송도동`/`충무동` grep: 유일한 매치는
  `school/apartments/route.ts`의 **주석**(C5-B가 제거한 과거 로직을 설명하는
  문장) — 실제 코드에 하드코딩된 fallback 값 재등장 0건.

**`WRONG_REGION_FALLBACK_COUNT = 0`** 확정.

## 12. SchoolInfo / Childcare placeholder 정책 제안(설계만, UI 미구현)

- **SchoolInfo(학생수/학급수/교사수)**: legal gate `CONDITIONAL` 유지 중이고
  `SchoolStat` 0행이므로, 기존 `SchoolDistrictPanel.tsx` 주석에 이미 남아있는
  선례("학생 수 추이"/"특목고 진학률"을 근거 없는 수치 대신 "데이터 준비 중"으로
  통일한 STEP 1.5-A 결정)를 그대로 따라 **PREPARING**(카드는 유지하되 "정보
  준비 중" 문구) 전략을 제안한다. 카드 자체를 숨기는 HIDE보다, 이미 이 코드베이스가
  일관되게 써온 패턴과 맞다.
- **Childcare(C3A)**: API key 미승인으로 데이터 자체가 없으므로 "0개"/"없음"
  표현 금지, **NOT_AVAILABLE/PREPARING** semantics 유지를 제안한다(C6-B 최종
  status 모델과 동일한 어휘 체계 재사용 권장 — 새 어휘 체계를 또 만들지 않음).

## 13. SCHOOL V2-D dependency map(코드 미변경, 조사만)

```
/apt/[name] (src/app/apt/[name]/page.tsx)
  → apt-client.tsx
      → SchoolDistrictPanel(address, ready, lawdCd)   [현재: KakaoPlaces 직선거리 POI만]
      → (신규 필요) attendance-zone 카드: aptSeq 필요
          aptSeq 확보 패턴은 이미 /api/apt/[name]/score/route.ts가 사용 중
          (ApartmentMaster.name ilike-match → aptSeq) — 동일 패턴 재사용 가능
      → getApartmentEducationZone(aptSeq)는 반드시 서버 사이드(Route Handler
        또는 Server Component)에서만 호출(§9)

기존 /api/apt/[name]/info, /score, /facilities 라우트: School/Kindergarten/
attendance-zone 관련 코드 0건(확인됨) — 신규 라우트(예:
/api/apt/[name]/education) 또는 기존 info route 확장 중 택1이 SCHOOL V2-D의
1차 결정 사항.
```

## 14. Score 분리

Score 관련 코드/formula/weight 전부 미변경. 통합 자체가 Score 로직을 건드리지
않음.

## 15. tests

```
scripts/education/lib/*.test.ts        61 (matcher12+source7+status10+
                                             schoolinfo-identity-resolver12+
                                             school-type-taxonomy10+
                                             zone-school-identity-resolver10)
src/lib/redevelopment/*.test.ts        97 (실측 재확인 — 과거 문서의 "119"는
                                             부정확한 구두 기록이었음, 실제
                                             test() 선언 수와 런타임 결과 모두
                                             97로 일치, 회귀 아님)
src/lib/education/*.test.ts             9
──────────────────────────────────────────
TOTAL                                 167, 167 PASS, 0 FAIL
```

## 16. tsc / lint / build

- `npx tsc --noEmit` — 최초 10개 에러(§6) → 수정 후 **0 errors**.
- `npx eslint scripts/education src/lib/education` — 0 errors.
- `npm run build` — 성공, 기존 라우트 목록과 동일(신규 라우트 0개, 기존 페이지
  영향 없음).

## 17. 알려진 한계

1. `docs/development/SCHOOL-V2-B-official-source-verification.md`/
   `c2b-verify-schoolinfo-api.ts`는 LEGAL-1과 C2B-A가 각자 독립적으로 만든
   near-duplicate 산출물이다 — 내용 손실은 없으나 두 branch의 히스토리가
   완전히 정리된 것은 아니다(문서화 중복, 코드 관점에서는 무해).
2. `src/lib/redevelopment` 테스트 수(97)가 과거 여러 STEP 문서에 반복
   인용된 "119"와 다르다 — 이번 STEP에서 실측 재확인한 결과이며, 통합 과정에서
   빠진 테스트는 없음(정적 `test(` 선언 카운트와 런타임 결과 일치).
3. SchoolInfo(학생수 등)/Childcare(C3A) 실 데이터는 여전히 0행 — legal
   gate/API key 승인이 선행 조건(변경 없음).
4. `getApartmentEducationZone()`은 여전히 어떤 route에서도 호출되지 않음
   (SCHOOL V2-D 범위).

## 18. 다음 단계

SCHOOL V2-D: §13 dependency map대로 `/apt/[name]`에 attendance-zone 카드 신설,
§12 placeholder 정책 적용, `getApartmentEducationZone()`을 서버 사이드에서만
호출하도록 연동.
