# E-JIP SCORE V2 STEP 1.5 — Data Foundation Integration

## 목적

Score V2(STEP 0~1)와 School V2(C1~FINAL QA)가 별도 branch 계열에서 각자
완결됐다. STEP 2에서 Education factor를 설계하려면 SCHOOL V2의 실제 최신
코드/데이터 계약을 Score V2 branch에서 안전하게 쓸 수 있어야 한다. 이번
STEP은 **두 development line을 통합만** 한다 — 새 기능 추가, 숫자 Score
변경, Education factor를 Score에 자동 연결하는 것 전부 범위 밖이다.

**main merge 금지. production DB write/migration 금지.**

## 현재 상태

- Score V2 base: `score-v2-step1-architecture`(commit `19c5413`)
- School V2 base: `school-v2-final-qa`(commit `470af23`)
- 신규 integration branch: `score-v2-data-foundation`(worktree `.worktrees/score-v2-data-foundation`)
- main: 미변경(`ec23919`, C3A 로컬 미커밋 작업 그대로 유지)

## 분석

### 1. Git ancestry audit(§1)

문서 기억이 아니라 실제 git으로 확인했다:

```
merge-base(score-v2-step1-architecture, school-v2-final-qa) = 82f4914
  ("feat: add core education data schema")
```

두 branch 모두 이 commit에서 갈라졌다. School 쪽 ancestry(merge-base 이후
22개 commit, `da17c0a`→`470af23`): C2A(NEIS 학교 마스터) → C2B/C2B-A/C2B-B
(SchoolInfo identity) → LEGAL-1(라이선스 게이트) → C5/C5-A/C5-B(거리 정확도) →
C6/C6-A/C6-B(통학구역) → C3B(유치원) → D1(부모 UX) → C2C(진로현황 감사) →
FINAL QA. Score 쪽(merge-base 이후 7개 commit, `6e06e01`→`19c5413`): STEP 0.5
→ 0.6 → 0.7 → 0.7-A(recovery write) → 0.8(shadow) → STEP1(architecture).

### 2. Main safety(§2)

main은 전혀 건드리지 않았다 — `reset`/`stash`/`revert`/`clean` 등 destructive
git 명령을 이번 STEP에서 한 번도 실행하지 않았다. main worktree의 C3A 로컬
미커밋 작업(`docs/development/CHANGELOG.md` M, `SCHOOL-V2-C-education-data-architecture.md`
M, `SCHOOL-V2-C3A-childcare-ingestion.md` ??, `scripts/education/` ??)은
STEP 시작 시점과 완전히 동일하게 남아있음을 재확인했다(§26 post-check 동일).

### 3. Integration branch(§3)

`score-v2-step1-architecture`(Score 최신)를 base로 새 worktree
`.worktrees/score-v2-data-foundation`(branch `score-v2-data-foundation`)를
만들고, 그 위에 `school-v2-final-qa`를 merge했다. main merge 없음.

### 4. Integration inventory(§4)

merge 전 두 branch의 변경 파일 목록을 diff로 직접 비교했다(추정 없음):

- School 쪽 변경 파일: 102개(Prisma education 관련은 스키마 자체가 merge-base에
  이미 있어 0개, `scripts/education/*`, `src/lib/education/*`,
  `src/components/EducationPanel.*`, `src/app/api/apt/[name]/education/route.ts`,
  `src/app/api/school/apartments/route.ts`, `src/app/school/*`, docs 다수)
- Score 쪽 변경 파일: 90개(`scripts/apartment-score/step07*`,
  `step08*`, `scripts/apartment_master_seed.ts`, docs 다수)
- **overlap 파일 = 정확히 1개: `docs/development/CHANGELOG.md`**

`prisma/schema.prisma`/`prisma/migrations/`는 두 branch 어느 쪽도 merge-base
이후 건드리지 않았다(grep 확인, 0 hits) — education 스키마는 merge-base
commit(`82f4914`) 자체에 포함돼 있어 통합 대상에서 애초에 제외된다.

### 5. Conflict policy 적용 결과(§5)

실제 conflict는 CHANGELOG.md 1건뿐이었고, A~E 우선순위 정책을 적용할 만한
**실질적 코드 충돌 자체가 없었다**(파일 목록이 거의 완전히 분리돼 있었음).
CHANGELOG.md는 두 branch가 같은 지점(merge-base 직후) 위에 각자 새 항목을
append해서 생긴 전형적 append-conflict였다 — 두 쪽 내용을 전부 보존하고
(하나도 버리지 않음) 시간순으로 자연스러운 순서(School 쪽이 그 날짜의 더 이른
번호(24)에서 시작, Score 쪽은 (26)에서 시작하여 School 청크를 앞에 배치)로
재배열해 커밋했다. 손실 없음.

`fix_coords.ts`(저장소 루트의 임시 스크립트)가 merge 결과 삭제된 것으로
나타났는데, 이는 이미 School V2 C5-B("서구 폴백 제거") 커밋에서 School팀이
결정한 정리였다 — 이번 STEP에서 새로 내린 삭제 결정이 아니라 이미 확정된
School V2 FINAL 상태를 그대로 받아들인 것이다.

### 6. Prisma/schema 확인(§6)

`git show 82f4914:prisma/schema.prisma`와 merge 후 `HEAD:prisma/schema.prisma`를
blob 단위로 직접 diff한 결과 **완전히 동일**(0 diff) — School V2 education
스키마(`School`/`SchoolStat`/`Kindergarten`/`KindergartenStat`/`Childcare`/
`EducationSource` 등)는 이미 merge-base에 존재했고 어느 쪽도 이후 변경하지
않았다. **새 migration 생성 없음, schema drift 없음.**

`prisma/migrations/`에 이 education 스키마의 migration.sql이 실제로 존재하며
(commit `82f4914`에 246줄 포함), 아래 §7 실측 DB count가 그 값을 그대로
반영하고 있어 **이미 production DB에 적용된 migration**임을 확인했다.

### 7. Database current-state 확인(§7, READ-ONLY)

```
School            = 664
Kindergarten      = 367
Childcare         = 0
SchoolStat        = 0
KindergartenStat  = 367
EducationSource   = 4건
  - childcare_national_api        (ATTRIBUTION_ONLY_FREE_USE, commercialUseAllowed=true)
  - childcare_national_sheet      (CONFLICTING_NONCOMMERCIAL_VS_UNRESTRICTED, commercialUseAllowed=null)
  - neis_school_info              (UNRESTRICTED_ATTRIBUTION, commercialUseAllowed=true)
  - moe_kindergarten_basicinfo_api(ATTRIBUTION_ONLY_FREE_USE, commercialUseAllowed=true)
```

기대값과 전부 일치: School 664·Kindergarten 367 확보, Childcare 0(C3A ingestion
전, §14 그대로), SchoolStat 0(LEGAL gate, §15 그대로). **이번 STEP에서 write
없음.**

`School.schoolLevel`을 School V2 확정 taxonomy(`scripts/education/lib/school-type-taxonomy.ts`,
14개 NEIS 원문값→5버킷 exact-match 매핑)로 재집계한 결과:

| bucket | count |
|---|---|
| ELEMENTARY | 305 |
| MIDDLE | 176 |
| HIGH | 159 |
| SPECIAL | 16 |
| OTHER | 8 |
| **합계** | **664** |

SCHOOL V2 FINAL이 보고한 "305/176/159/16/8"과 **정확히 일치**.

### 8. Apartment identity compatibility(§8)

`data/education/attendance-zone/busan-attendance-zone-20260320.json`(artifact,
3,402건, STEP0.7-A 이후에도 재계산하지 않은 원본 그대로)의 aptSeq를 현재
(STEP0.7-A 적용 후) `ApartmentMaster`와 직접 대조했다:

```
ApartmentMaster(aptSeq not null) = 3,402
artifact aptSeq matched          = 3,402
missing(artifact에만 있음)        = 0
missing(ApartmentMaster에만 있음) = 0
duplicate aptSeq(artifact 내부)   = 0
identity mismatch(같은 aptSeq, 다른 name) = 0
```

**완벽하게 호환** — STEP0.7-A의 identity/registry/좌표 복구가 `aptSeq`
자체를 재발급하거나 병합하지 않았기 때문에(§ STEP0.7-A "wrong merge 0"과
일치), School V2가 만든 aptSeq 키 기반 artifact는 그대로 안전하게 재사용
가능하다.

### 9. Attendance-zone compatibility(§9)

| status | 건수 |
|---|---|
| AVAILABLE | 3,175 |
| SHARED | 196 |
| REVIEW_REQUIRED | 30 |
| NOT_AVAILABLE | 1 |
| **합계** | **3,402** |

중학교군: AVAILABLE 3,400 / REVIEW_REQUIRED 1 / NOT_AVAILABLE 1. **SCHOOL V2
FINAL QA 보고와 정확히 일치** — integration 과정에서 artifact 자체가 손상되거나
변형되지 않았음을 확인했다.

### 10. Coordinate compatibility(§10) — 발견된 잔여 리스크

`getApartmentEducationZone()`이 읽는 artifact는 **2026-08-22T08:21 생성**됐고,
STEP0.7-A의 좌표 재지오코딩 write는 **2026-08-23T15:21(그 다음 날)** 실행됐다 —
즉 artifact 생성 시점이 좌표 복구보다 먼저다. artifact 생성 코드
(`scripts/education/c6a-10-busan-full-pipeline.ts` 등)는 `matchPointToZones(apt.longitude, apt.latitude, ...)`로
**실제 point-in-polygon 매칭**을 쓰기 때문에, 좌표가 바뀐 아파트는 이론적으로
zone 재배정이 필요할 수 있다.

STEP0.7-A가 실제 write한 1,191건의 `distanceDeltaM`(dry-run 산출값, 재계산
아님)을 artifact의 현재 status와 교차 확인했다:

| 이동거리 | 건수 | attendance-zone status 분포 |
|---|---|---|
| <100m | 1,126 | AVAILABLE 1,051 / SHARED 71 / REVIEW_REQUIRED 4 |
| 100~300m | 31 | AVAILABLE 28 / SHARED 3 |
| 300m~1km | 34 | AVAILABLE 31 / SHARED 1 / REVIEW_REQUIRED 2 |

**300m 이상 이동했고 현재 artifact에서 AVAILABLE(재검토 배지 없음)로 표시된
31건**이 이번 조사로 확인된 잔여 리스크다(구체적 aptSeq 목록은
`scripts/apartment-score/step15-02-coordinate-zone-risk-check.ts` 실행 결과에
보존). **지시대로 artifact를 재계산하지 않았다** — 이 31건이 실제로 zone
경계를 넘었는지는 이번 STEP에서 판정하지 않고, School V2 담당 라인이 다음
artifact 갱신 주기에 우선 검토할 대상으로만 기록한다. STEP0.7-A 자체가 이미
>1km 이동은 안전장치로 제외했으므로(§STEP0.7-A "44건 좌표 미개선"), 이 31건은
"명백한 오류"가 아니라 "경계 근접 가능성이 있는, 검증되지 않은 잔여
불확실성"으로 분류한다.

한편 `/api/apt/[name]/education` route는 attendance-zone artifact와는 별개로
**현재(복구 후) `ApartmentMaster.latitude/longitude`를 그대로 읽어 Kakao
실시간 유치원/초·고교 조회**를 수행한다(§11) — 이 부분은 좌표 복구의 혜택을
자동으로 받는다. 즉 "공식 통학구역"(정적 artifact, 복구 이전 좌표 기준)과
"주변 유치원/학교 목록"(실시간, 복구 이후 좌표 기준)이 서로 다른 좌표 세대를
쓰는 비대칭이 존재한다 — 사용자에게 혼란을 주지 않으려면 이 비대칭을 STEP2
UI 설계에서 인지해야 한다(§27 알려진 문제에 기록).

### 11. Education Score data contract audit(§11) — READY facts

| field/function | source | coverage | semantics |
|---|---|---|---|
| `getApartmentEducationZone(aptSeq).elementary` | `src/lib/education/attendance-zone.ts`(artifact) | 3,402/3,402(AVAILABLE 3,175+SHARED 196=93.3%, REVIEW_REQUIRED 30, NOT_AVAILABLE 1) | 공식 통학구역(학구도안내서비스), point-in-polygon, "가장 가까운 학교" fallback 없음 |
| `getApartmentEducationZone(aptSeq).middle` | 동일 | 3,402/3,402(AVAILABLE 3,400) | 중학교 배정군(학교군, 1교~다수교 pool) |
| `Kindergarten`(+`KindergartenStat`) | Prisma 직접 조회(DB) | 367/367 좌표 100% | 부산 유치원 canonical registry, capacity 등 |
| `School`(고교 기본) | Prisma 직접 조회(DB) | 664건(고등학교 142) | canonical registry, 좌표 0%(§11-a 주의) |
| nearby elementary/high(Kakao 실시간) | `/api/apt/[name]/education` route 내부 | 좌표 보유 아파트만(실시간 호출) | Kakao POI 기준, 좌표 저장 없음(매 요청 재조회) |
| source/provenance | `getAttendanceZoneDatasetMeta()` | 항상 제공 | `datasetVersion`, `sourceDate`(2026-03-20), `sourceName`, `legalNotice` |

§11-a: `School.latitude/longitude`는 여전히 0% 커버리지라(STEP1 조사 재확인),
고교/중학교 canonical 좌표 기반 거리 계산은 아직 불가능 — "배정군/통학구역"은
쓸 수 있지만 "가장 가까운 고등학교까지 거리"는 여전히 Kakao 실시간 조회에
의존한다.

### 12. "학교 접근성" legacy Score 분리 확인(§12)

`src/lib/apartment-score/server/categories/school-access.ts`와
`src/lib/apartment-score/server/school-access-sentence.ts`를 merge-base
commit과 blob 단위로 직접 diff한 결과 **완전히 동일**(0 diff) — 이번 merge로
V1 school-access 도메인이 SCHOOL V2 데이터를 자동으로 쓰게 되는 일은 없다.
V1은 지금도 `ApartmentLocationFeature.nearestElementaryDistanceM`(Kakao POI)만
사용한다.

### 13. school-access-sentence 자산 확인(§13)

패턴("절대 사실 → 상대 비교")이 그대로 유지됨을 파일 diff로 확인했다(§12와
동일 결과). STEP1이 제안한 공통 explainability 계약(§15, `{absoluteLevel,
relativeContext, ...}`)에 이 패턴을 그대로 일반화해 재사용할 수 있는 상태
그대로다.

### 14. Childcare boundary(§14)

이번 STEP에서 Childcare ingestion을 실행하지 않았다(`Childcare` count = 0
그대로, §7 확인). fake 데이터 생성 없음. main의 C3A 로컬 작업물
(`SCHOOL-V2-C3A-childcare-ingestion.md`, `scripts/education/`)은 전혀
건드리지 않았다(§26 재확인). Score V2 Core는 Childcare 데이터 유무와 무관하게
설계돼 있어(STEP1 §7 Education 인벤토리, Childcare=NEEDS_NEW_SOURCE/FUTURE로
이미 분류) 이 경계로 인해 블록되지 않는다.

### 15. SchoolInfo legal boundary(§15)

`SchoolStat` = 0건 그대로(§7). 이번 STEP에서 SchoolInfo 통계 ingestion,
좌표 write, 13-다(졸업생 진로현황) production 사용 — **전부 실행하지
않았다**. LEGAL gate(`SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md` CONDITIONAL
판정)는 그대로 유지된다.

### 16. Score architecture correction(§16)

STEP1 `RECOMMENDED_ARCHITECTURE`("5-domain Core: Transport/Living/Education/
Complex/**Environment**")를 다음과 같이 수정했다(숫자 Score 변경 아님,
architecture 문서만 수정):

- **Core 기본 출시 후보 = 4-domain**: Transport Accessibility / Living
  Convenience / Education Environment / Complex Quality
- **Environment(주거 쾌적성)는 Core weighted domain으로 바로 넣지 않는다.**
  현재 데이터가 해변 거리(beachDistanceM, 100% coverage) 단일 factor뿐이라
  하나의 "도메인"이라 부르기엔 근거가 얇다. 분류:
  - `LIMITED` — 데이터가 있긴 하나(해변) 도메인으로 부르기엔 폭이 좁음
  - `DISPLAY_ONLY` — 지금은 "참고 정보"로만 노출(해변까지 거리), 점수화하지 않음
  - `FUTURE_CORE_CANDIDATE` — slope(경사), park/green(공원·녹지, 이미 Living에
    있는 `parkCount1000m`와 중복 여부 STEP2에서 정리 필요), noise(소음),
    flood(침수), waterfront positive/negative(해안 접근성 대 해안 재해 리스크
    — STEP1 §3-E가 이미 지적한 상충 문제), hazards(혐오시설) 등이 충분히
    확보되면 Core 승격 재검토
- STEP1 문서(`EJIP_SCORE_V2_STEP1_ARCHITECTURE.md`)에 correction notice와
  섹션별 수정 표시를 추가했다(변경 이력 보존, 원문 삭제하지 않음).

### 17. Core definition 유지(§17) / 18. Relative policy 유지(§18)

변경 없음. "가격을 제외한, 이 아파트가 실제로 살기에 얼마나 좋은지에 대한
객관적 평가" 그대로. Market/Investment/Reconstruction 등 별도 Index 유지.
LOCAL percentile Core input 금지, BUSAN/SIGUNGU 기본 비교 population 유지 —
이번 STEP은 이 정책들을 재검증하지 않고 그대로 승계했다(§16 외 다른 수정
없음).

### 19. Benchmark compatibility(§19)

고정 3개 벤치마크(대신해모로센트럴/협성르네상스/구덕금호)가 통합 후에도
`ApartmentMaster`에서 정상 resolve됨을 §8/§20-21에서 이미 실증했다. 28개
전체 benchmark set의 재실행은 이번 STEP 범위가 아니다(STEP0.8/STEP1에서 이미
수행, 이번 STEP은 School V2 통합만).

### 20-21. 대신해모/협성 School data trace(§20-21) — READ-ONLY, 숫자 Score 없음

`getApartmentEducationZone()`을 merged 코드로 직접 호출(READ-ONLY)하고,
production 서버(`next start`)로 실제 API도 호출해 동일 결과를 재확인했다:

| | 대신해모로센트럴(26140-1356) | 협성르네상스(26140-51) | 구덕금호(26140-11) |
|---|---|---|---|
| 공식 초등 통학구역 | **대신초통학구역**(SINGLE, AVAILABLE) | **대신초통학구역**(SINGLE, AVAILABLE) — 대신해모와 **동일 학교** | 동신초통학구역(SINGLE, AVAILABLE) |
| 배정 초등학교 | 대신초등학교(HIGH confidence) | 대신초등학교(HIGH confidence) | 동신초등학교(HIGH confidence) |
| 중학교 배정군 | 3학교군(8개교) | 3학교군(8개교, 대신해모와 동일) | 3학교군(8개교, 동일) |
| 가장 가까운 유치원(DB 367건 기준, 근사거리) | 마리아유치원 약 367m | 마리아유치원 약 348m | 동신초등학교병설유치원 약 186m |

**핵심 발견**: STEP0.8이 확정한 V1 relative school score 역전(대신해모
22.0 vs 협성 11.4 — 341m가 545m보다 가까운데 오히려 낮은 점수)은 "초등학교
Kakao POI 직선거리" 기준이었다. 그런데 **SCHOOL V2 공식 통학구역 기준으로는
두 단지가 정확히 같은 초등학교(대신초등학교)에 배정**된다 — 즉 이 특정 쌍에
한해서는 "공식 통학구역"이라는 절대적 factual 기준을 쓰면 교육 접근성
비교 자체가 무의미해진다(둘 다 동일). 이는 STEP1 §11이 이미 권고한 "학업
수준이 아니라 교육 접근 환경, 그것도 가능하면 절대 fact(공식 배정) 우선"
설계 방향이 옳았음을 이 벤치마크 쌍으로 실증한다.

구덕금호는 identity/coord가 `DISPLAY_ONLY`(Score 관점)임에도 **attendance-zone
조회 자체는 AVAILABLE로 정상 동작**한다 — School V2의 zone 매칭은 Score의
identity/coordinate quality 분류와 독립적인 별도 판정이기 때문이다. 두 신뢰도
개념이 서로 동기화돼 있지 않다는 점을 STEP2 confidence 설계(§39)에서 반드시
고려해야 한다(하나가 낮다고 다른 하나도 자동으로 낮은 것은 아니다).

## 구현 내용

- git merge(`school-v2-final-qa` → `score-v2-data-foundation`), conflict
  1건(CHANGELOG.md) 해결
- 신규 read-only 검증 스크립트 3개(전부 DB write 없음):
  - `scripts/apartment-score/step15-01-integration-compat-check.ts`(§7-9)
  - `scripts/apartment-score/step15-02-coordinate-zone-risk-check.ts`(§10)
  - `scripts/apartment-score/step15-03-benchmark-education-trace.ts`(§20-21)
- STEP1 문서에 architecture correction notice 추가(§16)
- CHANGELOG.md 재정렬(내용 손실 없음)

## 테스트 결과

### 22. Integration regression suite

| 파일 | tests | pass |
|---|---|---|
| `scripts/education/lib/school-type-taxonomy.test.ts` | 10 | 10 |
| `scripts/education/lib/schoolinfo-identity-resolver.test.ts` | 12 | 12 |
| `scripts/education/lib/zone-school-identity-resolver.test.ts` | 10 | 10 |
| `src/components/EducationPanel.guard.test.ts` | 8 | 8 |
| `src/lib/education/attendance-zone.test.ts` | 9 | 9 |
| `src/lib/education/education-ui-labels.test.ts` | 10 | 10 |
| `scripts/apartment-score/lib/peer-quality.test.ts` | 20 | 20 |
| `scripts/apartment-score/lib/shadow-score.test.ts` | 8 | 8 |
| **합계** | **87** | **87** |

### 23. TypeScript/lint/build

- `npx tsc --noEmit`: **7 errors** — 전부 `scripts/education/c6a-*.ts` /
  `scripts/education/lib/attendance-zone-source.ts`(SHP 파싱 1회성 파이프라인,
  이미 실행 완료해 artifact가 이미 생성됨) 5개 파일에서 `shapefile`/`proj4`/
  `iconv-lite` 모듈을 찾지 못하는 오류. `package.json`엔 세 패키지 모두
  선언돼 있으나 이 환경의 공유 `node_modules`(git worktree가 메인 repo의
  `node_modules`를 상위 디렉터리 탐색으로 재사용)에 실제로 설치돼 있지
  않다 — **이번 통합이 만든 회귀가 아니라 기존 환경의 설치 공백**이며, 영향
  범위는 이미 실행 완료된 1회성 SHP 수집 스크립트에 한정된다(런타임
  application 코드 0건 영향). 애플리케이션 코드(API route, 컴포넌트,
  lib, Score 엔진 전체)는 0 errors.
- `npx eslint .`: **0 errors, 5 warnings** — 5개 warning 전부 이번 STEP
  이전부터 존재하던 것(`prisma/seed.js`, `scripts/fetchData.js`,
  `ai-search-client.tsx`, `apt-client.tsx`, `ViewTracker.tsx`) — merge-base
  버전으로 되돌려 직접 재확인, 동일 warning 존재함을 검증했다(신규 회귀 아님).
- `npx next build`: **성공**(Turbopack, 30 route 전부 컴파일, `/api/apt/[name]/education`,
  `/school`, `/school/[id]` 포함). 워크트리에 `node_modules` 심볼릭 링크(메인
  repo `node_modules`를 가리킴, git에 추적되지 않는 로컬 산출물)를 만들어야
  Turbopack의 workspace-root 탐지를 통과했다 — 이 심볼릭 링크는 `.gitignore`
  대상이라 커밋되지 않는다.

### 24. Runtime smoke(production server, `next start`)

| 케이스 | 결과 |
|---|---|
| 대신해모 `/api/apt/[name]/education` | HTTP 200, zone=대신초통학구역, 정상 |
| 협성 `/api/apt/[name]/education` | HTTP 200, zone=대신초통학구역, 정상 |
| 구덕금호 `/api/apt/[name]/education` | HTTP 200, zone=동신초통학구역, 정상 |
| SHARED case(명륜아이파크2단지) | HTTP 200, status=SHARED, zoneType=JOINT_ASYMMETRIC, 정상 |
| REVIEW_REQUIRED case(한진) | HTTP 200, status=REVIEW_REQUIRED, reasonCode=INVALID_ZONE_GEOMETRY, 정상 |
| `/`, `/apt/[대신해모]`, `/school` 페이지 | 전부 HTTP 200 |
| 대신해모 `/api/apt/[name]/score`(V1) | **status=OK, score=47, transport=62/living=36/parking=18/complex=92/schoolAccess=22 — STEP0.8 production 수치와 완전히 동일** |

### 25. Client bundle

`.next/static` 전체에서 attendance-zone artifact 콘텐츠(`학구도안내서비스`,
`busan-attendance-zone` 등 문자열) 검색 결과 **0건** — server-only 유지 확인.

## 알려진 문제

1. **좌표 세대 비대칭**(§10) — 공식 통학구역(artifact, 2026-08-22 좌표 기준)과
   Kakao 실시간 유치원/학교 조회(현재/복구 후 좌표 기준)가 서로 다른 좌표
   시점을 쓴다. 300m~1km 이동 + 현재 AVAILABLE 상태인 31건이 잔여 불확실성으로
   남아있다(구체 목록: `step15-02` 스크립트 출력). School V2 담당 라인의 다음
   artifact 갱신 시 우선 검토 권고.
2. **tsc 7 errors**는 이 환경의 `node_modules` 설치 공백(§23)이며, 코드
   결함이 아니다. 사용자가 원할 경우 `npm install`로 해결 가능하나, 공유
   `node_modules`를 변경하는 작업이라 이번 STEP에서 임의로 실행하지 않았다.
3. **Score confidence와 School V2 zone confidence가 동기화돼 있지 않음**(§20-21) —
   구덕금호처럼 Score identity가 낮아도 attendance-zone은 AVAILABLE로 나올 수
   있다. STEP2 confidence 설계 시 두 신호를 어떻게 합성할지 결정 필요.
4. **`School.latitude/longitude` 0% coverage 유지**(§11-a) — 고교/중학교
   canonical 좌표 기반 거리 계산은 여전히 불가능, Kakao 실시간 조회 의존 지속.

## 다음 STEP

STEP2 착수 전 정리됨: School V2 데이터가 이제 Score V2 branch 계열
(`score-v2-data-foundation`)에서 코드/DB 양쪽으로 안전하게 접근 가능하다.
STEP2는 이 branch를 이어받아 절대 curve/threshold 수치 설계에 착수할 수
있다. §10의 좌표 세대 비대칭은 STEP2 UI 설계 시 인지 필요 항목으로 이월한다.

---

## 최종 보고 (E-JIP SCORE V2 STEP 1.5)

1. branch = `score-v2-data-foundation`
2. Score base = `score-v2-step1-architecture`(`19c5413`)
3. School base = `school-v2-final-qa`(`470af23`)
4. merge-base = `82f4914`
5. conflicts count = 1(`docs/development/CHANGELOG.md`)
6. conflicts resolved = 1/1(양쪽 내용 전부 보존, 손실 없음)

7. Score recovery preserved? = YES(§8, aptSeq 3,402/3,402 완전 호환)
8. PEER_FULL current = 72.5%(STEP0.7-A 수치 그대로, 이번 STEP에서 재계산하지 않음 — 변경 없음 확인만)
9. transport eligible current = 2,833(동일, 변경 없음)

10. School total = 664
11. School taxonomy = 305(ELEMENTARY)/176(MIDDLE)/159(HIGH)/16(SPECIAL)/8(OTHER) — FINAL QA와 정확히 일치
12. Kindergarten total = 367
13. Childcare total = 0(ingestion 미실행, 정상)
14. SchoolStat total = 0(legal gate, 정상)

15. attendance artifact total = 3,402
16. AVAILABLE = 3,175
17. SHARED = 196
18. REVIEW_REQUIRED = 30
19. NOT_AVAILABLE = 1

20. Apartment↔attendance matched = 3,402
21. missing = 0
22. duplicate = 0
23. identity mismatch = 0

24. Score V1 formula changed? = NO(blob diff 0)
25. legacy school Score(V1 schoolAccess) changed? = NO(blob diff 0)
26. production Score values changed? = NO(런타임 재확인: 대신해모 47점, STEP0.8과 동일)

27. Education V2 READY facts = 공식 통학구역(elementary), 중학교 배정군, 유치원(DB 367건), 고교 기본 registry(DB, 좌표 제외), source/provenance 메타
28. Education pending facts = SchoolInfo 학업통계(LEGAL_REVIEW), Childcare(사용자 승인 대기), 학교 canonical 좌표(0%), 13-다 진로현황(NOT_AVAILABLE)

29. SchoolInfo legal gate = CONDITIONAL 유지(변경 없음)
30. childcare status = 0건, ingestion 미실행(승인 대기, 이번 STEP에서 진행하지 않음)

31. Core domain final proposal = **4-domain**(Transport/Living/Education/Complex) — STEP1의 5-domain에서 수정
32. Environment treatment = LIMITED/DISPLAY_ONLY/FUTURE_CORE_CANDIDATE(Core 제외)

33. 대신해모 education trace = 대신초통학구역(SINGLE/AVAILABLE), 대신초등학교 배정, 3학교군, 근처 유치원 약 367m
34. 협성 education trace = **대신초통학구역(대신해모와 동일 학교)**, 3학교군 동일, 근처 유치원 약 348m — V1의 341m/545m 역전 논란이 공식 배정 기준에서는 "완전 동일"로 해소됨
35. 구덕금호 negative handling = attendance-zone은 AVAILABLE(동신초통학구역)이나 Score identity는 DISPLAY_ONLY 그대로 — 두 신뢰도 축이 독립적임을 확인, STEP2 confidence 설계 과제로 기록

36. benchmark resolved count = 3/3(고정 3개 전부 정상), 28개 전체는 이번 STEP에서 재실행하지 않음(범위 밖)

37. wrong-region = 0(§8 identity mismatch 0과 동일 근거)
38. misleading walking = 0(school-access-sentence.ts blob diff 0, 기존 가드 그대로)
39. nearest-zone fallback = 0(artifact `getApartmentEducationZone()` "가장 가까운 학교 fallback 없음" 정책 코드 그대로, 변경 없음)

40. attendance client bundle count = 0

41. tests total/pass = 87/87
42. tsc = 7 errors(전부 1회성 SHP 스크립트의 기존 환경 설치 공백, 애플리케이션 코드 0 errors)
43. lint = 0 errors, 5 warnings(전부 pre-existing, 신규 아님)
44. build = 성공(`next build`, 30 routes)
45. runtime smoke = 5개 케이스 전부 통과 + V1 Score API 값 불변 확인

46. DB write? = NO
47. migration? = NO
48. API semantic change? = NO(신규 API 없음, 기존 education route는 School V2 FINAL 그대로)
49. UI change? = NO

50. docs = 본 문서 + STEP1 문서 correction 추가
51. CHANGELOG = 재정렬 완료(손실 없음)
52. commit = 진행 예정
53. push = 진행 예정
54. worktree clean = 진행 예정(커밋 후 확인)

55. main untouched = YES(`ec23919` 그대로, C3A 로컬 작업 그대로)
56. C3A untouched = YES
57. parallel branches untouched = YES(`school-v2-final-qa`=`470af23`, `score-v2-step1-architecture`=`19c5413` 그대로, worktree 둘 다 clean)

58. BLOCKER = 없음

59. SCORE_V2_STEP15_CLOSE = YES
60. SCORE_V2_DATA_FOUNDATION_READY = YES
61. SCORE_V2_STEP2_READY = YES

62. NEXT_RECOMMENDATION = STEP2에서 이 통합 branch(`score-v2-data-foundation`)를 이어받아 4-domain Core의 절대 curve/threshold 수치 설계를 시작하되, Education 도메인 설계 시 "공식 통학구역 우선, Kakao 거리는 통학구역 없는 경우의 보조"로 위계를 정하고, §10의 좌표 세대 비대칭과 §20-21의 confidence 비동기화 문제를 설계에 반영할 것을 권고한다.
