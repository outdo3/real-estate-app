# SCHOOL V2-C2B-A — SchoolInfo ↔ NEIS Identity Disambiguation

- **STEP**: SCHOOL V2-C2B-A
- **성격**: AUDIT + RESOLVER DESIGN — SchoolStat ingestion 금지, SchoolInfo coordinate DB write 금지, migration 금지, main merge 금지.
- **Branch**: `school-v2-c2ba-identity` (worktree `D:/anti2/aaa/e-jip-school-c2ba`, base `e9062a9` = `school-v2-c2b`)
- **선행 문서**: [SCHOOL-V2-C2B 관련 CHANGELOG 항목], [SCHOOL-V2-C5B-coordinate-provenance.md](./SCHOOL-V2-C5B-coordinate-provenance.md) §4, [SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md](./SCHOOL-V2-LEGAL1-schoolinfo-usage-gate.md) — 전부 보존.

---

## 0. 목적

SchoolInfo `SCHUL_CODE`와 canonical `School.neisSchoolCode`가 서로 다른 코드 체계임이 이미 확정된 상태에서(C2B/C5B), 학교명+시군구만으로는 위험한 자동 merge가 발생할 수 있는 실제 사례(강서구 동명이교)가 확인됐다. 이번 STEP은 그 위험을 없애는 HIGH-confidence identity resolver를 설계하고 실제 부산 데이터로 검증한다. **좌표 write도, 통계 ingestion도 하지 않는다** — identity만 판단한다.

---

## 1. 부산 canonical School Universe

```
TOTAL: 664
ELEMENTARY(초등학교): 305
MIDDLE(중학교+각종학교(중)+방송통신중학교): 176
HIGH(고등학교+각종학교(고)+방송통신고등학교+평생학교(고)): 158
SPECIAL(특수학교): 16
OTHER(공동실습소+외국인학교): 9
```

`School.id` 664건, `School.neisSchoolCode` **100% 존재**(read-only 재확인) — canonical identity 자체는 완전하다.

---

## 2. SchoolInfo 부산 Universe (실제 fetch, read-only)

스크립트: `scripts/education/c2ba-01-fetch-schoolinfo-universe.ts` — 16개 구·군 × `schulKndCode`(02/03/04/05/06/07) 전수 호출, apiType=0(학교기본정보)만 사용(SchoolStat 미호출). 결과는 세션 스크래치패드에만 캐시(레포에 raw 응답 커밋 안 함, LEGAL-1 §7 raw storage 이슈와 무관하게 임시 분석용).

```
TOTAL rows: 671
ELEMENTARY: 319
MIDDLE: 183
HIGH: 144
SPECIAL: 16
OTHER: 9(schulKndCode 06/07 계열, 세부코드 08/09/10/11/25 등 혼재)
```

---

## 3. 1차 Exact Matching (정규화 없음, 학교급 무시, 이름+시군구만)

```
DIRECT_UNIQUE: 638
AMBIGUOUS:       4
NO_MATCH:       22
```

---

## 4. 학교명 Normalization Audit

공백류/전각·반각 차이만 흡수하는 `normalizeName()`을 22건의 NO_MATCH에 적용한 결과 **추가로 회복된 건수: 0건**. 즉 이번 부산 데이터셋에서는 문자 표현 차이로 인한 오매칭 위험이 실측상 발견되지 않았다 — "초등학교" suffix 제거나 부분/유사도 매칭은 애초에 시도하지 않았고(지시사항), 필요하지도 않았다.

---

## 5. Same-Sigungu Duplicate 전수조사 (SchoolInfo 측, 학교급 무관 이름 기준)

**4개 그룹**(기존 C5-B에서 확인한 3개 + 이번에 학교급을 섞어 전수조사하며 새로 발견한 1개):

| 그룹 | SCHUL_CODE | 학교급 | 주소(ADRES_BRKDN) | BNHH_YN |
|---|---|---|---|---|
| 대저중앙초등학교 | S020001248 | 02 | 강서구 대저2동 | N |
| 대저중앙초등학교 | S020002353 | 02 | 강서구 강동동 4981-5 | N |
| 송정초등학교 | S020001278 | 02 | 강서구 송정동 | N |
| 송정초등학교 | S020002202 | 02 | 강서구 신호동 | N |
| 가락중학교 | S020001202 | 03 | 강서구 죽림동 | N |
| 가락중학교 | S020002354 | 03 | 강서구 강동동 4982 | N |
| **경일중학교**(신규 발견) | S020001204 | 03 | 강서구 명지동 | N |
| **경일중학교**(신규 발견) | S020002278 | 03 | **(빈 문자열)** | N |

전부 강서구 안에서만 발생 — 부산 다른 15개 구·군에서는 이름+시군구 중복이 0건.

---

## 6. 주소 기반 2차 Disambiguation

canonical `School`은 `address`(지번주소)는 전부 null이지만 **`dongName`은 656/664(98.8%) 존재**, `roadAddress`도 657/664 존재함을 재확인(§C5-B와 별개로 이번에 직접 재확인) — 동 단위 disambiguation이 실제로 가능하다.

실제 대조 결과(§5의 4개 그룹, 총 8개 SchoolInfo row 대상):

| canonical School | dongName(NEIS) | SchoolInfo 후보 중 동이 일치하는 것 | 결과 |
|---|---|---|---|
| 송정초등학교(id=433, 해운대구) | 송정동 | 해운대구 쪽엔 애초에 강서구 후보가 안 섞임(시군구부터 다름) | HIGH |
| 송정초등학교(id=434, 강서구) | **신호동** | `S020002202`(강서구 신호동) | HIGH |
| 대저중앙초등학교(id=141, 강서구) | 강동동 | `S020002353`(강서구 강동동 4981-5) | HIGH |
| 가락중학교(id=3, 강서구) | 강동동 | `S020002354`(강서구 강동동 4982) | HIGH |
| 경일중학교(id=40, 강서구) | **"명지동, 경일중학교"**(NEIS 원본 데이터 자체가 오염됨 — 학교명이 동 이름 뒤에 잘못 붙어 저장돼 있음, 이번 STEP 범위 밖의 기존 NEIS ingestion 데이터 품질 이슈) | 토큰 정확 일치 실패 | **LOW**(자동 확정 안 함) |

주목할 점: 강서구 송정초등학교(id=434)의 NEIS `dongName`이 학교 이름과 다른 "**신호동**"이라는 사실이 SchoolInfo의 주소("강서구 신호동")와 **독립적으로 일치**한다 — 두 공식 소스가 서로 다른 경로로 같은 결론에 도달했다는 점에서 이 매칭은 우연이 아니라 신뢰할 수 있는 근거로 판단한다(강서구 신공항/에코델타시티 개발로 행정동이 재편되며 학교명과 현재 소재 동이 달라진 것으로 추정, 확정 아님).

---

## 7. 분교(BNHH_YN) 검증

§5의 8개 SchoolInfo row **전부 `BNHH_YN='N'`**(분교 아님으로 표시) — 즉 이번에 발견된 중복은 "본교-분교" 관계가 **아니다**(그렇게 표시돼 있지 않음). 실제 원인은 §13에서 확인한 대로 대부분 "폐교 후 신설/재배치"로 추정된다(가덕도 지역, 강서구 개발지구). **BNHH_YN은 이번 표본에서 disambiguation에 실질적 도움이 되지 않았다**(전부 동일값이라 구분력 0) — resolver는 그래도 BNHH_YN='Y'인 유일 후보를 만나면 MEDIUM으로 낮추도록 설계했다(향후 다른 지역/학교급에서 실제 분교 사례가 나타날 때를 대비, §10).

canonical `School` 모델 자체는 분교를 별도 row로 갖고 있는지 별도 필드가 없어 확인이 어려웠다 — `isActive`/`qualityFlag` 정도만 있고 분교 여부 전용 컬럼은 없음(이번 STEP에서 스키마를 바꾸지 않으므로 참고만).

---

## 8. 학교급 포함 여부

**포함하는 것이 안전하다고 확정** — resolver 설계에 그대로 반영(§10). canonical `School.schoolLevel`(NEIS 원문, 매우 세분화: "각종학교(중)", "평생학교(고)-3년6학기" 등 14종)과 SchoolInfo `schulKndScCode`(02/03/04/05/06/07 + 하위 세부코드)를 **ELEMENTARY/MIDDLE/HIGH/SPECIAL/OTHER 5버킷**으로 정규화해 비교해야 실제로 맞아떨어진다는 것을 확인했다(`bucketNeisLevel`/`bucketSchoolInfoKind`, 단순 코드 문자열 비교로는 안 됨).

---

## 9. 좌표 보조 사용

**사용하지 않았다** — canonical `School.latitude/longitude`가 **0/664(0%)**로 여전히 전무하다(C5-B의 write 보류 결정 그대로 유지, LEGAL-1의 CONDITIONAL 게이트와도 일치). 좌표를 보조 증거로 쓰려면 양쪽 다 좌표가 있어야 하는데(지시사항 §9) canonical 쪽이 없어 이번 STEP에서는 이 축 자체가 성립하지 않는다. 좌표 write가 CLEARED된 이후에나 재검토 가능.

---

## 10. Resolver Confidence Model (구현 완료)

`scripts/education/lib/schoolinfo-identity-resolver.ts` — 순수 함수, DB/네트워크 미접근.

```
1. sigunguCode 없으면 → NO_MATCH
2. 이름(normalizeName) + 시군구 정확히 일치하는 SchoolInfo 후보 탐색
   0건 → NO_MATCH
3. 학교급 버킷(ELEMENTARY/MIDDLE/HIGH/SPECIAL/OTHER)까지 일치하는 후보만 필터
   0건 → NO_MATCH(이름만 같은 다른 학교급 — 교차 매칭 안 함)
4. 필터 후 정확히 1건
   → BNHH_YN='Y'면 MEDIUM(보수적), 아니면 HIGH
5. 필터 후 2건 이상 (§5의 중복 사례)
   → canonical dongName 없으면 LOW(비교 자체 불가)
   → dongName이 SchoolInfo 주소 토큰과 정확히 1건만 일치 → HIGH
   → 0건 또는 2건 이상 일치 → LOW(자동 확정 금지)
```

이름 fuzzy matching, 부분 문자열, suffix 제거는 어디에도 없다(지시사항 그대로 준수).

---

## 11. Canonical Crosswalk 구조 제안 (미구현, migration 없음)

향후 매번 664개 전체를 재계산하지 않도록, 다음과 같은 `EducationIdentityMapping` 테이블을 제안한다(이번 STEP에서 schema에 추가하지 않음 — **future proposal만**):

```prisma
// FUTURE PROPOSAL — 이번 STEP에서 migration 안 함
model EducationIdentityMapping {
  id                 Int      @id @default(autoincrement())
  entityType         String   // 'SCHOOL' | 'KINDERGARTEN' | 'CHILDCARE'
  canonicalId        Int      // School.id 등 내부 PK
  externalSourceCode String   // EducationSource.code (예: 'schoolinfo_openapi')
  externalId         String   // SchoolInfo SCHUL_CODE 등
  confidence         String   // 'HIGH' | 'MEDIUM' | 'LOW'
  reasons            Json     // resolveOne()의 reasons 배열 — 감사 추적용
  resolverVersion    String   // 이 resolver 모듈의 버전/커밋 식별자
  resolvedAt         DateTime

  @@unique([entityType, canonicalId, externalSourceCode])
  @@index([externalSourceCode, externalId])
}
```

이 테이블이 있으면 MEDIUM/LOW 결과를 "reconciliation queue"(사람이 검토할 목록)로 그대로 노출할 수 있고, HIGH만 자동 ingestion에 쓰는 구조(§15)를 명시적으로 DB에 남길 수 있다. 지금은 스크립트 실행 결과를 문서/로그로만 남긴다.

---

## 12. Coverage

```
resolveAll(664 canonical, 671 SchoolInfo) 결과:
  HIGH:      633
  MEDIUM:      0
  LOW:         1   (경일중학교 — §6, NEIS dongName 데이터 오염)
  NO_MATCH:   30

TRUE_IDENTITY_COVERAGE = HIGH / 664 = 95.3%
```

학교급별:

| 버킷 | HIGH / TOTAL | % |
|---|---|---|
| ELEMENTARY | 305/305 | **100.0%** |
| MIDDLE | 170/176 | 96.6% |
| HIGH | 141/158 | 89.2% |
| SPECIAL | 16/16 | **100.0%** |
| OTHER | 1/9 | 11.1%(방송통신고/평생학교/외국인학교/공동실습소 — 아래 §13) |

**SchoolInfo 자체 row 성공률(§2, 671건 fetch 성공)과 혼동하지 않음** — 이건 SchoolInfo가 응답을 잘 줬는지의 지표이고, TRUE_IDENTITY_COVERAGE는 그중 몇 건이 canonical School과 확실하게 연결됐는지의 지표로 분리했다.

---

## 13. SchoolInfo-only / NEIS-only

**SchoolInfo-only(캐논니컬에 대응 없음), 이름+시군구 키 기준 25건 전수 확인 — 전부 `ABSCH_YN='Y'`(폐교)**:

알로이시오중학교, 알로이시오전자기계고등학교, 좌성초등학교, 좌천초등학교, 금성중학교, 동삼중학교, 배정중학교, 성지중학교, 덕천여자중학교, 위봉초등학교, 운송중학교, 감정초등학교, 서곡초등학교, 회동초등학교, 윤산중학교, 눌차초등학교, 덕도초등학교, 삼광초등학교, 세산초등학교, 지구촌고등학교, 사상중학교, 삼락중학교, 시온식품과학고등학교, 가산초등학교, 주원초등학교.

**결론(확정 근거로 확인, 추정 아님)**: SchoolInfo-only 갭의 원인은 "분교"가 아니라 **폐교**다 — C5-B에서 "분교 추정"이라고 근거 없이 단정하지 않고 남겨뒀던 것을 이번 조사로 명확히 해소했다. `ABSCH_YN='Y'`는 최근 3년 이내 폐교돼 SchoolInfo 공시 이력엔 아직 남아있지만, NEIS 학교기본정보(canonical `School`이 참조하는 원천)는 폐교교를 애초에 활성 목록에서 제외하는 것으로 보인다(추정 — NEIS API 자체의 필터 기준을 별도로 확인하지는 않았다).

**resolver 산출 NO_MATCH(30건)와의 관계**: resolver의 NO_MATCH(canonical 쪽 기준, 30건)와 위 SchoolInfo-only(25건, SchoolInfo 쪽 기준)는 **서로 다른 분모의 다른 지표**다 — 전자는 "이 canonical School이 SchoolInfo 어디에도 못 붙었다"이고 후자는 "이 SchoolInfo row가 canonical 어디에도 안 붙었다"이며, 둘 다 폐교와는 무관하게 방송통신고/평생학교/외국인학교/공동실습소 같은 **비표준 학교 유형의 명칭 표기 차이**(예: NEIS "학력인정부산경호고등학교(2년제)" vs SchoolInfo가 이 정확한 문자열로 나열하지 않음)가 주 원인으로 보인다 — 개별 원인을 전수 확정하지는 않았다(각 사례가 소수라 이번 STEP 범위에서 낮은 우선순위로 판단).

---

## 14. Same-Name Regression Cases (필수 확인)

| 케이스 | canonical id | confidence | matched SCHUL_CODE |
|---|---|---|---|
| 송정초등학교(해운대구) | 433 | **HIGH** | S020001666 |
| 송정초등학교(강서구) | 434 | **HIGH**(동 disambiguation: 신호동) | S020002202 |
| 대저중앙초등학교(강서구) | 141 | **HIGH**(동 disambiguation: 강동동) | S020002353 |
| 가락중학교(강서구) | 3 | **HIGH**(동 disambiguation: 강동동) | S020002354 |

**WRONG_MERGE = 0**(무결성 체크: 서로 다른 canonical School이 동일 SchoolInfo SCHUL_CODE에 HIGH로 매칭된 사례 전수 조사 — 0건). 4개 알려진 위험 사례 전부 실제로는 주소(동) 기반 2차 disambiguation으로 **안전하게 HIGH까지 도달**했다 — C5-B 시점에는 (이름,시군구)만 키로 써서 "unsafe"로 남겼던 것이, 이번 STEP에서 dongName을 3차 신호로 추가하면서 해소됐다.

---

## 15. Ingestion Gate

**`IDENTITY_READY_FOR_INGESTION = CONDITIONAL`**

- HIGH(633건, 95.3%)만 자동 ingestion 후보로 허용.
- MEDIUM(0건 — 이번 표본엔 없었으나 로직은 준비됨)/LOW(1건)/NO_MATCH(30건)는 **자동 저장하지 않고 reconciliation queue로 분리**하는 구조를 권장(§11의 `EducationIdentityMapping.confidence` 필드로 그대로 표현 가능).
- 664건 전체를 억지로 100% 자동 매칭하려 하지 않았다 — 특히 OTHER 버킷(방송통신/평생학교/외국인학교 등, 11.1%)은 낮은 커버리지를 그대로 인정한다.
- **단, 이 게이트는 identity(누가 누구인지)에 대한 것이지 legal(써도 되는지)에 대한 것이 아니다** — §16에서 분리.

---

## 16. Legal Gate와의 분리 (재확인, 상태 변경 없음)

LEGAL-1 판정을 그대로 유지한다 — 이번 STEP에서 CLEARED로 바꿔 쓰지 않는다:

```
SCHOOLINFO_COORDINATE_USE_GATE  = CONDITIONAL  (변경 없음)
SCHOOLINFO_STATISTICS_USE_GATE  = CONDITIONAL  (변경 없음)
```

Identity가 95.3% HIGH로 확인됐다는 것은 "누구인지 안다"는 뜻이지 "그 데이터를 이집이 써도 된다"는 뜻이 아니다 — 두 게이트 모두 CONDITIONAL로 남아있는 한, HIGH 매칭 결과가 있어도 실제 좌표/통계 ingestion은 착수하지 않는다(이번 STEP에서도 하지 않았다).

---

## 17. Tests

`scripts/education/lib/schoolinfo-identity-resolver.test.ts` — 이 프로젝트의 기존 관례(`src/lib/redevelopment/*.test.ts`, `node:test` + `node:assert/strict`, `npx tsx --test`로 실행)를 그대로 따름. DB/네트워크 접근 없는 순수 fixture:

- exact unique → HIGH
- same name, other sigungu → NO_MATCH(후보에 안 들어감)
- same name, same sigungu, 동으로 구분 가능 → HIGH
- same name, same sigungu, 동 정보 없음 → LOW
- same name, same sigungu, 동까지 같아도 2건 이상 → LOW
- school kind mismatch → NO_MATCH(교차매칭 안 함)
- address mismatch(동 불일치) → LOW
- 분교(BNHH_YN=Y) → MEDIUM(자동 확정 안 함)
- null sigunguCode → NO_MATCH(크래시 없음)
- 강서구 3그룹 패턴을 canonical dongName 없이 돌리면 전부 LOW(오매칭 0건) — `resolveAll` 통합 테스트
- normalizeName — suffix 제거 안 됨 재확인
- bucketNeisLevel/bucketSchoolInfoKind — 14종 NEIS 세분류 정확히 매핑

**12/12 PASS.**

---

## 18. 문서/커밋

- 문서: 이 파일 신규(`SCHOOL-V2-C2BA-identity-disambiguation.md`), 기존 C2B/C5B/LEGAL-1 문서 보존.
- `tsc --noEmit`: 0 errors.
- `eslint`(신규 파일 전체): 0 errors.
- DB write: 없음(전부 read-only 조회 + in-memory 계산).
- schema/migration: 없음(§11은 제안만).
