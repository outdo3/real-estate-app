# APT INFO IDENTITY HOTFIX V1

baseline: `0c32420` (main)
날짜: 2026-08-28

## 1. Goal

`/api/apt/[name]/info`의 `fetchCachedRegistry()` fallback이 name 제약 없이
`dong+jibun`만으로 재조회하면서, 이미 exact identity(name+dong)로 찾은
정확한 Unit Master 결과를 같은 주소의 다른 이름 표기 row(0건)로 덮어쓰던
데이터 신뢰 버그를 고친다. UI/response contract/DB schema는 건드리지
않는다.

## 2. Discovery

직전 STEP(APT DETAIL CONSISTENCY HOTFIX V1) QA 중 대신롯데캐슬 픽스처가
사용자가 원래 보고한 "14평/25평 노출"과 다르게 "평형 정보 없음"만 보여
발견했다. 그 STEP에서는 이 버그가 "apartment basic data" 영역이라 범위
밖으로 문서화만 하고 넘어갔고, 이번 STEP에서 정식으로 고친다.

## 3. Root Cause

`fetchCachedRegistry()` 안에서:

1. `cached = prisma.apartment.findFirst({ where: { name: aptName, dong:
   dongKey }, include: { unitTypes: true } })` — exact identity 조회.
   `unitTypes = cached.unitTypes`로 설정(대신롯데캐슬 id=11, 8건).
2. `cached`의 registry 필드(parkingCount/far/bcr/approvalDate) 중 하나라도
   비어 있으면(대신롯데캐슬은 `approvalDate`가 null) 그대로 반환하지 않고
   폴백으로 진입.
3. 폴백: `byJibun = prisma.apartment.findFirst({ where: { dong: dongKey,
   jibun } })` — **name이 where절에 전혀 없다.**
4. `if (byJibun) { unitTypes = byJibun.unitTypes; }` — **조건 없이
   무조건 대입.** 같은 주소에 "대신롯데캐슬아파트"(id=95, unitTypes
   0건)라는 이름 변형 row가 있어, `findFirst`가 이 row를 반환하면
   8건 → 0건으로 덮어써버린다.

name이 identity 조건에서 빠지는 지점은 정확히 3번(byJibun where절)이고,
그 결과를 무조건 채택하는 지점은 4번이다.

## 4. Previous Fallback Flow

```
cached(name+dong exact) 조회
  └─ unitTypes = cached?.unitTypes   (조건 없음)
  └─ registry 4필드 모두 있으면 return
  └─ 없으면:
       byJibun(dong+jibun only, name 없음) 조회
         └─ unitTypes = byJibun?.unitTypes   (조건 없음 — 버그)
         └─ registry 4필드 모두 있으면 return
       없으면 return null
```

## 5. Identity Contract (이번 STEP에서 확정)

이 라우트가 실제로 접근 가능한 identity 신호는 `name`, `dong`, `jibun`,
`lawdCd` 뿐이다(요청에 `aptSeq`가 없음, §8). 확정한 우선순위:

1. **exact `name+dong`**(`Apartment.@@unique([name, dong])`) — unitTypes의
   유일한 신뢰 가능 출처.
2. **정규화된 이름 일치**(`normalizeAptName()`, 기존 `apt-name-match.ts`
   재사용) — `name+dong` exact가 없거나 비어 있을 때만, `dong+jibun`
   후보의 unitTypes를 채택하기 위한 최소 identity proof.
3. 그 외(이름 불일치)는 unitTypes를 채택하지 않는다 — 정직한 no-data가
   우선(§13).

registry 메타데이터(parkingCount/far/bcr/approvalDate/totalHouseholds)는
이 우선순위와 별개다(§9).

## 6. Strong vs Weak Result

- **STRONG**: `cached`(exact name+dong)에서 얻은 `unitTypes`.
- **WEAK**: `byJibun`(dong+jibun only, name 무관)에서 얻은 `unitTypes`.

새 규칙: WEAK는 STRONG이 이미 non-empty일 때 절대 개입하지 않는다.
STRONG이 empty(0건)일 때만, WEAK가 §5의 identity proof(정규화 이름 일치)
까지 통과해야 채택된다. 이 판단은 순수 함수
`shouldAdoptFallbackUnitTypes()`(`src/lib/apt-name-match.ts`)로
분리해 단위 테스트했다.

```ts
export function shouldAdoptFallbackUnitTypes(params: {
  currentUnitTypesCount: number;
  fallbackName: string;
  requestedAptName: string;
  fallbackUnitTypesCount: number;
}): boolean {
  if (params.currentUnitTypesCount > 0) return false;
  if (params.fallbackUnitTypesCount === 0) return false;
  return normalizeAptName(params.fallbackName) === normalizeAptName(params.requestedAptName);
}
```

## 7. Name / Alias Handling

새 정규화 규칙을 만들지 않았다(§6 지시 — "existing helper 우선"). 기존
`src/lib/apt-name-match.ts`의 `normalizeAptName()`(공백 제거 + 끝
"아파트" 접미사 제거)을 그대로 재사용했다 — 이 헬퍼는 이미
`Apartment.aptSeq` 스키마 주석(§181-186)에서 "대신더샵"/"대신더샵아파트"
같은 표기 변형이 같은 aptSeq로 매칭되는 실제 4쌍 사례의 근거로 인용되고
있어, 이번 케이스(대신롯데캐슬/대신롯데캐슬아파트)와 정확히 같은 유형의
문제에 이미 검증된 도구다. `aptNamesMatch()`(느슨한 양방향 부분포함 +
차수/브랜드 alias)는 쓰지 않았다 — unitTypes 채택처럼 위험이 큰
판단에는 더 엄격한 `normalizeAptName()` 완전 일치만 인정한다.

## 8. Address Handling / aptSeq Priority

`aptSeq`를 최우선으로 쓰라는 지시(§7)를 검토했으나, 이 라우트의 요청
파라미터(`name`, `lawdCd`, `dong`, `jibun`)에 `aptSeq`가 전혀 없다
(`apt-client.tsx`도 이 라우트를 호출할 때 aptSeq를 넘기지 않는다 — 실측
확인). 게다가 실제 DB 조사 결과, 이 fixture 자체가 **aptSeq만으로는
구분되지 않는 사례**다 — "대신롯데캐슬"(id=11)과 "대신롯데캐슬아파트"
(id=95)가 이미 같은 `aptSeq='26140-1164'`를 공유한다. 부산 전체에서
`dong+jibun`이 겹치는 6쌍을 전수 조사한 결과 전부 "같은 aptSeq, 이름
표기만 다름" 패턴이었다(§12 참고). 그래서 aptSeq는 이 STEP에서 identity
proof로 채택하지 않았고, 대신 §5/§7의 정규화 이름 일치를 proof로
썼다 — TRUE GATE("데이터 구조상 canonical identity 자체가 불가능")에는
해당하지 않으므로 질문 없이 이 설계로 진행했다.

## 9. ApprovalDate Role

`approvalDate`는 **metadata completeness**(건축물대장 필드 하나)이지
apartment identity가 아니다. 기존 코드는 이 둘을 분리하지 못해
"approvalDate가 없다"는 이유만으로 identity 재조회(byJibun)를 트리거하고,
그 재조회 결과가 unitTypes까지 함께 덮어썼다. 이번 수정으로 두 역할을
분리했다: `approvalDate` 등 registry 필드 부족은 여전히 `byJibun`(주소
기반) 조회를 트리거하지만(§10 — 이 필드들은 건물 단위 사실이라 주소
기반 재조회가 안전하다), 그 결과의 `unitTypes`는 더 이상 자동으로
따라오지 않는다.

## 10. Metadata Fallback Is Intentionally Unchanged

`fetchBuildingRegistryInfo(aptName, lawdCd, dong, jibun)` 자체가
aptName이 아니라 `lawdCd+dong+jibun`(주소)으로 건축물대장을 조회한다
(실측 확인, `apt-building-info.ts:89-96`) — 즉 parkingCount/far/bcr/
approvalDate/totalHouseholds는 애초에 "그 주소의 물리적 건물"에 귀속된
사실이지 특정 아파트명에 속한 데이터가 아니다. 그래서 `byJibun`의
registry 필드 보충 로직은 **의도적으로 변경하지 않았다** — 이름이 다른
row에서 이 필드들을 가져오는 것은 데이터 신뢰 위반이 아니다. unitTypes
(Unit Master)만 아파트 identity별로 다를 수 있는 데이터라 별도로
보호했다.

## 11. Cache Key

`fetchCachedRegistry`라는 이름과 달리 이 라우트에는 별도 in-memory/외부
캐시 레이어가 없다(`getOrSetCache`/Redis/`unstable_cache` 등 미사용,
grep으로 확인). "캐시"는 이전 요청에서 `prisma.apartment.upsert()`로
DB(Apartment 테이블)에 영구 저장해둔 결과를 재사용한다는 의미다. 별도
런타임 cache key가 존재하지 않아 §19-20(cache key 보강)은 해당 사항이
없다 — DB 쿼리 자체가 이미 §5의 identity 우선순위(`name+dong` exact
먼저)를 따르므로 별도 key 설계가 필요 없다.

## 12. 대신롯데캐슬 Fixture (Before/After)

DB 실측(읽기 전용, `tmp/qa-scratch/`, 커밋 대상 아님):

| | Before(버그) | After(수정) |
|---|---|---|
| `대신롯데캐슬`(exact) 조회 | unitTypes 8건 → byJibun(0건)이 덮어써 **0건** | unitTypes **8건 유지** |
| 34평 collision(84.7855㎡/84.995㎡) | 소실 | **보존** |
| 라이브 API(`/api/apt/대신롯데캐슬/info`) | `unitTypes: null` | `unitTypes` **8건 배열** |
| 상세페이지 평 모드 | "평형 정보 없음"(전 chip) | **14평/25평×2(collision 캡션)/34평×2(collision 캡션)** — 사용자 원래 보고와 일치 |

## 13. Same-address Collision (No-data Policy 재확인)

부산 전체 `dong+jibun` 중복 6쌍을 전수 조사(§8) — 전부 같은 aptSeq를
공유하는 이름 표기 변형이었고, "진짜 다른 아파트가 같은 주소를 공유하는"
실사례는 DB에 없었다. 그래서 Fixture C(같은 주소, 다른 아파트)는 실제
데이터가 아니라 **synthetic 단위 테스트**로 검증했다(§14). 정책은
동일하게 유지: 정규화 이름이 다르면(=identity proof 없음) unitTypes를
절대 채택하지 않고, 정직한 no-data(`null`)를 반환한다 — "틀린
fallback보다 정확한 no-data"(§30) 원칙 그대로.

## 14. QA

`scripts/run-apt-info-identity-qa.ts` — A파트(순수 함수, 서버 불필요) 9개
+ B파트(라이브) 전부 PASS.

A파트:
- A. strong(non-empty) 결과는 이름이 같아도 fallback으로 덮이지 않음.
- B. fallback이 0건이면 이름이 같아도 채택 안 됨(무의미한 덮어쓰기 방지).
- C. 정규화 후 이름이 다르면(synthetic, 다른 아파트 가정) 채택 안 됨.
- D/D-2. aptSeq 정보 없이도 안전하게 동작 — 정규화 이름 일치가 있을
  때만 채택, 없으면 거부.
- E. 함수 시그니처에 지역/주소 파라미터가 없어 구조적으로 "이름만으로
  타 지역까지 검색"이 불가능함을 확인.
- F. 이전 STEP(APT DETAIL CONSISTENCY HOTFIX V1)의 fake-pyeong 부재
  가드가 여전히 유지됨.
- G. 과거 버그 패턴(`if (byJibun) { unitTypes = byJibun.unitTypes; }`
  무조건 대입)이 코드에 재도입되지 않았는지 정적 검사.
- H. 응답 contract(`success`/`aptName`/`info`/`unitTypes` 필드) 불변
  확인.

B파트(dev 서버 대상 live 검증):
- `대신롯데캐슬`(exact) 조회 → unitTypes **8건**(34평 collision 케이스
  포함) 확인.
- `대신롯데캐슬아파트`(변형) 조회 → 서버 에러 없이 정상 응답(success:
  true) 확인.
- 회귀 스모크: `동대신역비스타동원아파트`/`연산동한솔솔파크`/
  `대신롯데캐슬`/`/map`/`/stats`/`/school` 전부 httpStatus < 500.

브라우저로 `/apt/대신롯데캐슬` 평 모드 전환까지 직접 확인 — 14평/25평
(collision 캡션 포함)/34평(collision 캡션 포함) 정상 노출, 사용자 원래
보고와 일치.

## 15. Regression

- `동대신역비스타동원아파트`(Unit Master 자체 없음): 토글 항상 노출,
  "평형 정보 없음" 정직한 폴백 그대로 — 이번 identity 수정과 무관하게
  동일하게 동작(브라우저로 재확인).
- `연산동한솔솔파크`(Apartment row는 있으나 unit type 0건): 영향 없음.
- area chips / recent price / score / school / chart / parking: 이번
  변경은 `fetchCachedRegistry()` 내부 `unitTypes` 대입 조건 하나만
  건드렸고, 나머지 registry 병합/네이버 스크래핑/live registry
  fetch/upsert 로직은 바이트 단위로 그대로다.
- 직전 STEP의 ㎡/평 toggle 계약(§18) 전부 유지: 항상 노출, trusted
  pyeong만 표시, `/3.3058` fake 계산 없음, no-pyeong 정직한 폴백,
  collision 보존 — 정적 가드(F)로 재확인.

## 16. Known Limitations

- `findFirst({ where: { dong, jibun } })`는 여전히 orderBy가 없어
  Postgres의 비결정적 스캔 순서에 의존한다 — 실측상 항상 같은 row를
  반환했지만(이번 STEP에서 여러 방향으로 테스트), 이는 이번 STEP의 안전
  가드(§6)가 있어도 "어떤 row가 candidate로 뽑히는지"는 여전히
  비결정적이다. `orderBy: { id: 'asc' }` 같은 결정론적 정렬 추가는
  §28("NO BROAD REFACTOR")을 넘는 별도 판단이 필요해 이번 STEP에서는
  건드리지 않았다.
- "대신롯데캐슬아파트"(약한 표기, 0건)로 직접 방문하는 사용자는 여전히
  "평형 정보 없음"을 본다 — `byJibun` 후보가 우연히 자기 자신을 다시
  반환하는 경우 정규화 이름 일치 로직이 개입할 기회가 없기 때문이다
  (실측 확인). 두 표기 row 자체를 병합/정리하는 것은 데이터 cleanup이라
  이번 STEP 범위(§27 "NO DB CHANGE") 밖이다.
- 같은 주소의 "진짜 다른 아파트" 충돌은 현재 DB에 실사례가 없어 synthetic
  테스트로만 검증했다 — 실사례가 생기면 fixture를 추가해야 한다.

## 17. Next Step

ChatGPT PM 검수 대기. 승인 시 다음 후보:
- `UNIT_MASTER_COVERAGE_V2`(Unit Master 백필, 커버리지 0.32% 해소)
- 이름 표기 변형(id=11/id=95류) 정리 — 데이터 cleanup, DB 쓰기 필요라
  별도 승인 STEP.
- `findFirst` 비결정적 순서에 `orderBy` 추가 여부 판단.
