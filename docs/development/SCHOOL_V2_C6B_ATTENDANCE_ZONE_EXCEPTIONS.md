# SCHOOL V2-C6-B — 통학구역 예외 해소 + V2 Persistence 준비

## 목적

C6-A(부산 3,402개 아파트 전체 point-in-polygon, 99.85% zone geometry match)가 남긴
4가지 미해결 항목 — NO_MATCH 4건, invalid geometry 3개 zone(25개 아파트), 신연초
identity, MEDIUM 18건(129개 아파트) — 을 임의 fallback 없이 안전하게 정리하고,
그 결과를 SCHOOL V2-D가 바로 쓸 수 있는 precomputed artifact + read-only helper로
확정하는 것이 목적이다. DB write/migration/Score 변경/main merge는 이번 STEP
범위 밖이다(전부 미수행).

## 0. 작업 환경

C6-A(`school-v2-c6a-busan-zone-build`, commit `3919647`)를 base로 새 워크트리
`.worktrees/school-v2-c6b-attendance-zone-exceptions`(브랜치
`school-v2-c6b-attendance-zone-exceptions`)를 만들어 작업했다 — main 체크아웃에는
이번 STEP과 무관한 C3A(보육시설) 미커밋 변경사항이 있어 그것과 격리하기 위함이다.
C6-A가 쓴 원본 SHP/CSV(`D:/anti2/aaa/schoolzone-data/`)는 그대로 재사용했다(재다운로드
없음).

## 1. NO_MATCH 아파트 4건 — 실측 결과

`scripts/education/c6b-01-investigate-exceptions.ts`로 4건 전부 재확인(C6-A와 동일
count):

| 아파트 | 구·군/동 | 좌표 | 최근접 zone | 경계까지 거리 | geocodeQuality | buildYear |
|---|---|---|---|---|---|---|
| 삼성비치타운 | 부산진구 부전동 | 35.1589, 129.0614 | 전포초통학구역 | 84m | normalized | 2004 |
| 동남주상복합 | 부산진구 당감동 | 35.1655, 129.0330 | 당평초통학구역 | 21m | normalized | 2003 |
| 엄궁 | 사상구 엄궁동 | 35.1234, 128.9650 | 동궁초통학구역 | 29m | normalized | 1983 |
| 글로벌빌라트 | 동래구 사직동 | 35.1970, 129.0533 | 사직초공덕초금성초공동(일방)통학구역 | 17m | **exact** | 2001 |

**분류 근거(추측 아님, 실측 필드 기반)**:
- 4건 전부 1983~2004년 준공 — 신규 개발(D. NEW_DEVELOPMENT) 아님, 확정 배제.
- 3건(`geocodeQuality='normalized'`)은 정밀 지오코딩이 아니므로
  **B. APARTMENT_COORDINATE_ISSUE**가 유력 — normalized 좌표는 근사치이며 17~84m
  오차는 이 정밀도 범위 내에서 자연스럽다.
- 글로벌빌라트(`geocodeQuality='exact'`, 17m)만 좌표 자체는 정밀 매칭 — 좌표가
  정확한데도 zone 밖이라는 것은 **A. POLYGON_GAP**(zone 경계 디지털화가 이 필지까지
  못 미침) 쪽 증거가 더 강하다. 인접 zone이 공동(일방)학구(사직초/공덕초/금성초)라
  경계가 복잡한 지점이라는 점도 정합적이다.
- `geocode_quality` 필드 자체가 부정확 판정의 결정적 근거는 아니다(정확도의
  프록시일 뿐) — 그래서 4건 모두 **A/B 원인을 단정하지 않고 REVIEW_REQUIRED로
  통일**했다(§5).

## 2. invalid geometry 3개 zone → 25개 아파트 실제 처리 확인

`classifyApartmentZoneStatus()`(C6-A, 수정하지 않음)를 그대로 실행해 확인한 결과:
**25건 전부 현재 코드에서 `MATCHED_SINGLE`로 나온다** — `geometryInvalid` 플래그가
zone-level 결과 레코드에는 있었지만 최종 status 계산에는 전혀 반영되지 않고
있었다(`scripts/education/c6b-03-invalid-geometry-status-check.ts`로 실측 확인,
`장림초/개포초/신덕초` school identity 자체는 전부 HIGH).

이대로 두면 자체교차(self-intersecting) polygon 안에 있다는 사실이 사용자에게
완전히 숨겨진 채 "확정 매칭"처럼 노출된다 — 그래서 §5의 새 status 레이어에서
`geometryInvalid=true`인 경우 무조건 `REVIEW_REQUIRED`로 분리했다(신규
`INVALID_ZONE_GEOMETRY` reasonCode). geometry 자체를 임의로 repair하지 않았다.

## 3. 신연초등학교 조사

CSV(§학구도연계정보) row: `신연초등학교(휴교)`, zoneId=`Z000100648`,
schoolId=`B000002546`, 관할 부산광역시남부교육지원청, lawdCd=26290(남구).

canonical 후보: `School.id=454`("신연초등학교", isActive=true, sigunguCode=26290,
roadAddress="부산광역시 남구 유엔로35번길 46") — **lawdCd 완전 일치, 이름은 "(휴교)"
접미사만 다름, 부산 전역에서 유일 후보**.

**중요 정정**: 이번 STEP 지시문이 언급한 "canonical School 664"는 실제로 조회해보니
`효림초등학교`(사하구)였다 — 신연초와 무관. 지시문의 전제 오류로 판단, 임의로
맞추지 않고 실제 DB 조회 결과(`School.id=454`)를 사용했다.

**identity 확정 여부**: canonical `isActive`는 NEIS 원본 ingestion에서 한 번도
`false`로 세팅된 적이 없는 필드다(`ingest-schools-neis.ts` 주석 실측 확인) — 즉
`isActive=true`가 "현재 휴교 아님"을 보증하지 않는다. 반대로 "(휴교)"가 실제
휴교 상태를 뜻하는지도 이 STEP만으로는 확인할 근거가 없다. **동일 물리적 학교일
가능성은 높지만(같은 lawdCd, 이름 일치, 유일 후보) 공식 source만으로 100% 확정할
수는 없다고 판단**해 identity는 **NO_MATCH로 유지**했다(억지 연결 금지, C6-A §7의
결정을 재확인).

**identity rule 제안(설계만, 미적용)**: `"(휴교)"`/`"(폐교)"`처럼 명확히 정의된
운영상태 접미사만 좁게 인식해 제거한 뒤 이름+lawdCd+학교급 매칭을 시도하는 규칙을
제안한다 — 일반 fuzzy matching이 아니라 이 특정 리터럴 패턴에만 적용되는 좁은
규칙이다. 적용하려면 학교알리미/NEIS 쪽 휴교 상태 필드를 별도로 확인해 교차검증하는
후속 STEP이 필요하다(이번 STEP에서 구현하지 않음).

## 4. MEDIUM 18건(129개 아파트) semantics 확정

`zone-school-identity-resolver.ts`(C6-A, 수정 없음) 코드 자체가 MEDIUM을
`kindMatches.length === 1`(이름+학교급 부산 전역 유일 매칭)인 경우에만 부여한다 —
즉 MEDIUM은 애초에 "학교가 불확실"이 아니라 "**학교는 유일하게 확정, 단 zone의
행정구역과 학교의 sigunguCode가 다르다**"는 뜻으로 설계돼 있었다(LOW는 후보 2건
이상일 때만 부여, 이번 18건 중 LOW는 0건).

18건 실측 분류:

| 유형 | zoneId 예 | 설명 |
|---|---|---|
| 공동(일방)학구 opt-in(7개 zone) | Z000151619~625 | 금성초/공덕초가 온천초 등 7개 "본교" zone의 opt-in 대상, zone 자체는 `isShared=true` |
| **단일 zone인데도 cross-district**(2개 zone, 신규 발견) | Z000100680(금성초통학구역), Z000100649(양동초통학구역) | `isShared=false` — 공동학구가 아닌 **일반 단일 zone**의 유일 배정 학교가 zone 소속 구·군과 다른 구·군에 등록돼 있는 사례. C6-A는 이 패턴을 "공동학구 opt-in"으로만 설명했으나, 실제로는 단일 zone에도 같은 구조가 존재함을 이번 STEP에서 추가로 확인했다 |
| 공동(대칭) cross-district(2개 zone) | Z000151585(주례초주학초), Z000150049(주양초개림초) | `isShared=true`, 대칭 공동학구 |

18건 전부 **REGION_CROSSING_BUT_IDENTITY_CONFIRMED**로 판정한다 — 어느 학교인지는
유일하게 확정되며, 확신도 상향의 근거는 이름+학교급 부산 전역 유일 매칭이라는
**deterministic evidence**다(fuzzy matching 아님). IDENTITY_UNCERTAIN이 아니므로
최종 사용자 status에서 REVIEW_REQUIRED로 내려보내지 않는다(§5).

## 5. 최종 attendance status 모델

기존 C6-A의 `classifyApartmentZoneStatus()`(zone geometry 매칭 상태)와
`zone-school-identity-resolver`(학교 identity confidence)는 **수정하지 않고**,
그 출력을 입력받아 최종 user-facing status로 변환하는 새 순수 함수
`scripts/education/lib/attendance-zone-status.ts::resolveFinalAttendanceStatus()`를
추가했다(내부 기술상태와 표시상태 분리, 신규 10-fixture 테스트 전부 통과).

우선순위(위에서부터 먼저 적용):

1. `COORDINATE_MISSING` → **NOT_AVAILABLE**
2. zone geometry `NO_MATCH`(경계 근접, §1) → **REVIEW_REQUIRED**(`ZONE_BOUNDARY_GAP`)
3. `OVERLAP` → **REVIEW_REQUIRED**(`OVERLAPPING_ZONES`) — 실측 0건
4. `geometryInvalid`(장림초/개포초/신덕초, §2) → **REVIEW_REQUIRED**(`INVALID_ZONE_GEOMETRY`)
5. 연결 학교 중 `LOW` 또는 `NO_MATCH`(신연초, §3) → **REVIEW_REQUIRED**(`SCHOOL_IDENTITY_UNRESOLVED`)
6. 그 외(전부 HIGH 또는 MEDIUM=행정구역교차확정, §4) →
   - 공동학구(`isShared`) → **SHARED**
   - 단일 → **AVAILABLE**

## 6. UI wording (확정)

| status | 문구 |
|---|---|
| AVAILABLE | "공식 통학구역 기준" |
| SHARED | "통학구역 선택 가능 학교" |
| REVIEW_REQUIRED | "통학구역 정보 확인 중" |
| NOT_AVAILABLE | "공식 통학구역 정보를 확인할 수 없어요" |

"배정학교"/"오류"/"배정 확정" 표현은 어디에도 쓰지 않는다(C6-A §18 유지). 가장
가까운 학교를 통학구역 학교로 대신 표시하지 않는다 — 이번 STEP 전체에서 fallback
코드 경로 자체가 존재하지 않음을 헬퍼 테스트로 확인했다(§9).

## 7. persistence architecture

C6-A §19 권고(공식 원본 파일 보존 → offline parser → point-in-polygon → precomputed
저장)를 그대로 V1안으로 확정한다. `ApartmentEducationLink` 최소 필드안(C1의 LATER
스키마와 충돌 없음, 이번 STEP에서 실제 테이블 생성/migration 없음):

```
apartmentId       Int
zoneId            String
zoneName          String
zoneType          String   // SINGLE | JOINT_SYMMETRIC | JOINT_ASYMMETRIC
schoolIds         Int[]    // canonical School.id, identity 확정분만
identityConfidence String  // 최종 채택된 confidence(HIGH|MEDIUM)
geometryInvalid   Boolean
status            String   // AVAILABLE | SHARED | REVIEW_REQUIRED | NOT_AVAILABLE
sourceBaseDate    String
computedAt        DateTime
```

## 8. precomputed artifact

`data/education/attendance-zone/busan-attendance-zone-20260320.json` — 부산
아파트 3,402건 전체(초등 통학구역 + 중학교 학교군), geometry는 저장하지 않음.
`scripts/education/c6b-04-final-pipeline.ts`로 생성, 결정론적(재실행 시 동일
checksum). 크기 약 5.8MB(compact JSON).

```json
{
  "meta": {
    "datasetVersion": "busan-attendance-zone-20260320",
    "sourceDate": "2026-03-20",
    "sourceName": "학구도안내서비스(한국교육시설안전원)",
    "resolverVersion": "school-v2-c6b-1.0.0",
    "generatedAt": "...",
    "totalApartments": 3402,
    "checksum": "c85ff918...",
    "legalNotice": "학교 배정 등 학구(통학구역)에 대한 정확한 사항은 관할 교육청(교육지원청)에 반드시 확인하시기 바랍니다."
  },
  "apartments": [ { "aptSeq", "aptName", "sigungu", "dong", "elementary": {...}, "middle": {...} } ]
}
```

## 9. API contract (read-only helper)

`src/lib/education/attendance-zone.ts::getApartmentEducationZone(aptSeq)` —
artifact만 읽는 순수 함수, DB 접근 없음, 아직 어떤 API route에서도 import되지
않음(SCHOOL V2-D 범위). 9개 테스트 전부 통과(`src/lib/education/attendance-zone.test.ts`).

```ts
interface SchoolAccessZoneInfo {
  elementary: {
    status: 'AVAILABLE'|'SHARED'|'REVIEW_REQUIRED'|'NOT_AVAILABLE';
    reasonCode: string;
    zoneName: string | null;
    zoneType: 'SINGLE'|'JOINT_SYMMETRIC'|'JOINT_ASYMMETRIC';
    schools: { schoolId: number|null; neisSchoolCode: string|null; schoolName: string; identityConfidence: 'HIGH'|'MEDIUM'|'LOW'|'NO_MATCH' }[];
    sourceDate: string; sourceName: string; notice: string;
  };
  middle: {
    status: 'AVAILABLE'|'SHARED'|'REVIEW_REQUIRED'|'NOT_AVAILABLE';
    reasonCode: string;
    groupName: string | null;
    schools: { schoolId: number|null; neisSchoolCode: string|null; schoolName: string; identityConfidence: string }[];
    sourceDate: string;
  };
  datasetVersion: string; generatedAt: string;
}
```

## 10. canonical IDs

모든 school 항목에 canonical `School.id`(`schoolId`)와 `neisSchoolCode`를 포함한다.
학교명은 표시용일 뿐 primary identifier가 아니다. 공동학구/학교군의 각 학교도
개별 identity(각자의 confidence)를 유지한다 — 대표 1개로 뭉치지 않는다.

## 11. 최종 coverage(실측)

**초등**: `AVAILABLE 3,175 / SHARED 196 / REVIEW_REQUIRED 30 / NOT_AVAILABLE 1`
(합계 3,402). REVIEW_REQUIRED 30 = invalid geometry 25 + zone 경계 근접 NO_MATCH 4
+ 신연초 zone 1(정확히 일치, 우연 아님).

**중학교**: `AVAILABLE 3,400 / REVIEW_REQUIRED 1 / NOT_AVAILABLE 1`.

**AVAILABLE+SHARED 합계(사용 가능) = 3,371/3,402 = 99.09%** — C6-A의
"USABLE_SCHOOL_IDENTITY_COVERAGE 99.82%"보다 낮은 이유는 이번 STEP에서
invalid-geometry 25건을 REVIEW_REQUIRED로 새로 분리했기 때문이다(정직한 재분류,
숫자를 부풀리지 않음).

## 12. regression (전부 통과, `c6b-06-regression-check.ts` + helper 테스트)

- 향원에이스타운(26140-35) → SHARED, [대신초 HIGH, 동신초 HIGH] — 그대로.
- 신화타워(26260-75) → SHARED(JOINT_ZONE_ASYMMETRIC), [온천초 HIGH, 공덕초
  MEDIUM, 금성초 MEDIUM] — MEDIUM이 있어도 REVIEW_REQUIRED로 내려가지 않음(§4/§5
  핵심 검증).
- NO_MATCH 4건 → 전부 REVIEW_REQUIRED/`ZONE_BOUNDARY_GAP`.
- invalid geometry 샘플(한진/그린코아) → REVIEW_REQUIRED/`INVALID_ZONE_GEOMETRY`,
  같은 아파트명의 다른 동 소재 아파트는 영향 없음(정상 AVAILABLE/SHARED 유지).
- 중학교 학교군 샘플(3학교군/11학교군) → canonical ID 포함, MEDIUM 학교(덕원중학교)
  섞여 있어도 AVAILABLE.
- COORDINATE_MISSING(에코델타호반써밋스마트시티) → 초등/중학교 전부 NOT_AVAILABLE.

## 13. Score 분리

Score 관련 코드/formula/weight 전부 미변경. 이번 데이터는 schoolAccess 로직에
자동 연결하지 않았다.

## 14. tests / tsc / lint / build

- 신규: `attendance-zone-status.test.ts` 10건, `attendance-zone.test.ts`(API 헬퍼) 9건.
- 전체 `npx tsx --test scripts/education/lib/*.test.ts src/lib/redevelopment/*.test.ts src/lib/education/*.test.ts` → **167/167 통과**(기존 148 + 신규 19, 회귀 없음).
- `npx tsc --noEmit` — clean.
- `npx eslint scripts/education src/lib/education` — clean.
- `npm run build` — 성공(전체 라우트 정상 컴파일, 기존 페이지/API 영향 없음 —
  이번 STEP 코드는 아직 어떤 라우트에서도 import되지 않는 순수 오프라인
  도구+헬퍼이므로 build에 실질적 영향 없음).

## 15. 알려진 문제 / 한계

1. NO_MATCH 4건 원인은 A(POLYGON_GAP)/B(APARTMENT_COORDINATE_ISSUE) 중 하나로
   단정하지 않았다 — `geocode_quality`+준공연도로 방향성만 제시(§1).
2. 신연초 identity는 여전히 미확정(NO_MATCH 유지) — 학교알리미 휴교 상태 필드
   교차검증이 후속 STEP으로 필요하다(§3).
3. 이번 STEP의 지시문이 "canonical School 664 = 신연초"라고 전제했으나 실제로는
   효림초등학교였다 — 지시문 전제 오류를 실측으로 정정했다(§3).
4. "단일 zone인데도 cross-district" 패턴(금성초통학구역/양동초통학구역, §4)은
   C6-A 문서에 없던 새 발견이나, 표본이 2개 zone뿐이라 일반화하지 않았다.
5. artifact(약 5.8MB)는 이번 STEP에서 커밋하지만, 9월 반기 갱신 시 diff 절차는
   C6-A §20(설계만)에서 아직 자동화되지 않았다.
6. `getApartmentEducationZone()`은 아직 어떤 API route에서도 호출되지 않는다
   (SCHOOL V2-D 범위).

## 16. 다음 단계

- SCHOOL V2-D: `getApartmentEducationZone()`을 실제 `/api/apt/[name]` 등에 연결.
- 신연초 identity 후속 확인(학교알리미 휴교 필드).
- 9월 갱신분 확보 시 diff 파이프라인 구현.
