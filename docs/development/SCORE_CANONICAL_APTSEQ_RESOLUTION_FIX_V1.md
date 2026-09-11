# SCORE CANONICAL APTSEQ RESOLUTION FIX V1

작성일: 2026-09-11
선행: `MASTER_COVERAGE_SYNC_APPLY_DOMAIN_OG_FIX_V1` §5
기준 커밋: `4521652` (main)

## 목적

이집점수가 "어느 단지의 점수인가"를 이름이 아니라 **canonical aptSeq**로 정하게 만든다.

점수 모델은 건드리지 않는다. 산식·가중치·임계·학교 거리 출처·percentile 정규화는
한 줄도 바뀌지 않았다. 바뀐 것은 **어느 단지를 계산 엔진에 넘기는가**뿐이다.

## 1. 기존 해소 경로

```
client(apt-client.tsx)
  └ /api/apt/[name]/score?lawdCd&dong
      └ ApartmentMaster.findMany({ sggCd: lawdCd, umdName: dong })
          └ 정규화 이름 완전 일치 → 있으면 그것만
            없으면 aptNamesMatch 부분포함 폴백
              └ 1건이면 채택 · 0건 NOT_FOUND · 2건 이상 AMBIGUOUS
                └ calculateApartmentScore(aptSeq)
                    └ ApartmentLocationFeature → score
```

`aptSeq`는 **어디에서도 읽히지 않았다.** 쿼리 파라미터로도 받지 않았고,
호출부가 이미 들고 있는 canonical identity도 쓰지 않았다.

## 2. 모호성의 정확한 원인

`normalizeAptName`은 끝의 "아파트"를 지운다(`src/lib/apt-name-match.ts:38`).

```
대원아파트 → 대원
대원      → 대원
```

부산진구(26230)에는 원래 `대원아파트`(26230-149, 범천동)만 있었다.
`MASTER_COVERAGE_SYNC`가 `대원`(26230-1810, 부전동)을 넣자 같은 구에서 정규화 이름이
겹쳤다. 법정동을 싣지 않고 들어오는 경로에서는 후보가 2건이 되어 AMBIGUOUS가 됐다.

```
?lawdCd=26230             → AMBIGUOUS   (점수가 사라진다)
?lawdCd=26230&dong=범천동  → OK, 58점
```

**틀린 점수를 준 적은 없다.** 라우트는 확정하지 못하면 거부하도록 설계돼 있었고 그
설계는 옳았다. 문제는 호출부가 답을 알고 있는데도 묻지 않았다는 것이다.

## 3. 부산 전역 충돌 감사 (§6)

`scripts/apartment-score/score-identity-collision-audit.ts` (읽기 전용, 재실행 가능).
이 STEP 이전의 해소 규칙을 그대로 재현해 부산 16개 구 3,438건 전부에 대입했다.

```
BEFORE (이름 기반 해소)
  법정동 없이 → AMBIGUOUS   : 116 단지
  법정동 있어도 AMBIGUOUS   :   8 단지
  다른 단지로 확정될 위험   :   0 건
AFTER (aptSeq 우선)
  aptSeq로 단일 해소 가능   : 3,438 / 3,438
  되살아나는 단지           : 124
정규화 이름 충돌 그룹       :  54
```

**이 문제는 대원아파트 1건이 아니었다.** 직전 STEP이 보고한 "1건"은 *20건 INSERT가
새로 만들어낸* OK→AMBIGUOUS 변화량이고, 여기 116/8은 부산 전역에 **원래 존재하던**
총량이다. 두 숫자는 서로 다른 것을 세며 모순이 아니다.

법정동이 있어도 모호한 8건은 **같은 동에 같은 이름**이 실제로 있는 경우다
(예: `수목하우스` 26230-2325 · 26230-2485 둘 다 양정동). 이 단지들은 이름 경로로는
어떤 파라미터를 줘도 점수를 볼 수 없었다.

`다른 단지로 확정될 위험 0건`이 중요하다 — 기존 규칙은 **틀리게 고른 적이 없고
포기했을 뿐이다.** 그래서 이 STEP은 "틀린 것을 고치는" 작업이 아니라 "알 수 있는데
포기하던 것을 알게 하는" 작업이다.

## 4. 변경한 파일

| 파일 | 성격 |
|---|---|
| `src/lib/apartment-score/resolve-score-identity.ts` | 신규 — 해소 규칙 단일 출처 |
| `src/lib/apartment-score/resolve-score-identity.test.ts` | 신규 — 20건 |
| `src/app/api/apt/[name]/score/route.ts` | 해소부를 위 모듈 호출로 교체 |
| `src/app/apt/[name]/apt-client.tsx` | 점수 요청에 canonical aptSeq를 싣는다 |
| `scripts/apartment-score/score-identity-collision-audit.ts` | 신규 — 읽기 전용 감사 |

점수 산식 쪽(`src/lib/score-v2/*`, `src/lib/apartment-score/server/*`,
`peer-context.ts`, `prisma/schema.prisma`)은 **변경 0건**이다.

## 5. aptSeq 우선 구조

```
1. canonical aptSeq  → 존재 확인 후 즉시 확정. 이름으로 재해소하지 않는다.
2. sggCd(+법정동) 안에서 정규화 이름 완전 일치
3. 완전 일치가 없을 때만 aptNamesMatch 부분포함 폴백
4. 후보 2건 이상 → AMBIGUOUS (절대 첫 번째를 고르지 않는다)
```

2~4는 기존 라우트 규칙 **그대로**다. 이 STEP이 더한 것은 1번 한 층이고, 어느 경로도
넓히지 않았다.

aptSeq가 왔을 때 **이름이 맞는지 되묻지 않는다.** 약한 단서가 강한 identity를 뒤집게
두면 aptSeq를 받는 의미가 없다. 대신 계약의 나머지 절반은 **호출부가 무엇을
보내는가**에 있다(§6 아래).

형태 가드: MOLIT aptSeq는 `{lawdCd 5자리}-{일련번호}`다. 실측으로 ApartmentMaster
3,438건, TradeHistory distinct aptSeq 4,977건 **전부** 이 형태이고 예외가 없다.
형태부터 어긋난 값은 DB에 묻지 않고 곧바로 NOT_FOUND다 — 이름 경로로 흘려보내
엉뚱한 단지의 점수가 되지 않게 하기 위함이다.

## 6. 호출부 — URL 값을 그대로 보내지 않는다

상세페이지는 URL의 `aptSeq`를 **그대로 보내지 않는다.** `deriveCanonicalAptSeq`가
이 페이지의 거래 목록(이미 name+dong으로 검증된 집합)에 그 값이 실제로 있을 때만
canonical로 채택한다. 즉 손으로 URL을 고쳐도 화면과 다른 단지의 점수가 나오지 않는다.

두 가지를 함께 넣었다.

- **identity 확정 전에는 묻지 않는다.** canonical aptSeq는 거래 응답이 와야 정해지므로,
  그 전에 점수를 물으면 화면의 나머지와 다른 단지를 가리킬 수 있다. 점수 카드는 그
  동안 기존의 "산정 준비 중" 상태를 유지한다(새 UI 상태 없음).
- **한 번 확정된 identity는 고정한다.** canonical aptSeq는 현재 탭의 거래 목록에서
  나오므로 전월세 탭으로 바꾸면 null로 되돌아갈 수 있다. 그때마다 이름 경로로 다시
  물으면 같은 화면에서 점수가 사라졌다 돌아온다. 다른 단지로 이동하면 페이지가 새로
  마운트되므로 이 고정은 단지 경계를 넘지 않는다(`canonicalCoord`와 같은 방식).

비용: 점수 요청이 거래 응답 뒤로 밀린다. 로컬 프로덕션 빌드 warm 실측으로 거래
65~96ms, 점수 99~155ms이므로 점수 카드가 채워지는 시점이 그만큼 늦어진다. 대신 점수가
화면의 나머지와 **항상 같은 단지**를 가리킨다. 후자가 이 제품의 신뢰 요건이다(§7).

## 7. 실측 QA (§12, 읽기 전용)

로컬 프로덕션 빌드 기준. 세 경로를 같은 단지에 대해 나란히 호출했다.

| 단지 | aptSeq | 이름+구 | 이름+구+동 | **aptSeq** |
|---|---|---|---|---|
| 대원 | 26230-1810 | AMBIGUOUS | INSUFFICIENT_DATA | INSUFFICIENT_DATA |
| 대원아파트 | 26230-149 | **AMBIGUOUS** | OK / 58 | **OK / 58** |
| 진흥목화 | 26140-2 | OK / 65 | OK / 65 | OK / 65 |
| 해운대경동제이드 | 26350-2206 | OK / 54 | OK / 54 | OK / 54 |
| 아름베스트빌1 | 26410-206 | INSUFFICIENT_DATA | INSUFFICIENT_DATA | INSUFFICIENT_DATA |
| 수목하우스 | 26230-2325 | AMBIGUOUS | **AMBIGUOUS** | **OK / 60** |
| 수목하우스 | 26230-2485 | AMBIGUOUS | **AMBIGUOUS** | **OK / 59** |
| (없는 단지) | 26230-99999 | NOT_FOUND | NOT_FOUND | NOT_FOUND |

읽는 법:

- **점수 값이 경로와 무관하게 같다** (65/65/65, 54/54/54, 58=58). 같은 master로
  해소되면 같은 점수가 나온다 — 산식이 바뀌지 않았다는 실측 증거다(§8).
- `대원아파트`가 되살아났다.
- 같은 동 동명 단지 `수목하우스` 둘이 각각 **다른 점수**(60, 59)로 해소된다. 이름
  경로로는 어떤 파라미터로도 볼 수 없던 단지들이다. 둘이 같은 값이 아니라는 점이
  "다른 단지로 폴백하지 않았다"는 증거다.
- `대원`(26230-1810)이 INSUFFICIENT_DATA인 것은 정상이다 — 방금 들어온 master라
  좌표·LocationFeature가 아직 없다. 점수를 지어내지 않는다.

잘못된 aptSeq:

```
aptSeq=대원아파트        → NOT_FOUND
aptSeq=26230             → NOT_FOUND
aptSeq=26230-1' OR 1=1   → NOT_FOUND   (DB 조회 자체가 일어나지 않음)
```

## 8. identity parity (§7)

상세페이지가 실제로 하는 순서를 그대로 흉내내 검증했다
(거래 조회 → canonical aptSeq 도출 → 그 aptSeq로 점수 조회).

| 단지 | URL aptSeq | 거래 aptSeq 집합 | 채택 | 점수 |
|---|---|---|---|---|
| 수목하우스 | 26230-2325 | {26230-2325} | 26230-2325 | OK / 60 |
| 수목하우스 | 26230-2485 | {26230-2485} | 26230-2485 | OK / 59 |
| 대원아파트 | 26230-149 | {26230-149} | 26230-149 | OK / 58 |
| 진흥목화 | 26140-2 | {26140-2} | 26140-2 | OK / 65 |
| 해운대경동제이드 | 26350-2206 | {26350-2206} | 26350-2206 | OK / 54 |

화면의 네 소비자가 **같은 값 하나**를 쓴다: 지도 딥링크(`handleViewOnMap`),
리포트 진입 CTA, 실거래 DB-first 조회, 그리고 이제 점수까지 전부
`canonicalAptSeq`에서 나온다. 리포트 생성 경로(`lib/report/apt-read.ts`)는 원래부터
aptSeq로 `calculateApartmentScore`를 직접 부르므로 같은 identity다.

## 9. 점수 산식 무변경 증명 (§8)

1. **변경 파일 목록** — `src/lib/score-v2/*`, `src/lib/apartment-score/server/*`,
   `peer-context.ts`, `prisma/schema.prisma` 변경 0건(`git status`로 확인).
2. **라우트 import 목록을 테스트가 고정** — 점수 산식 모듈이 새로 들어오면 테스트가
   깨진다.
3. **라우트는 해소된 aptSeq를 그대로 넘긴다** — `calculateApartmentScore(resolvedAptSeq)`.
4. **실측 동일값** — §7 표의 65/65/65, 54/54/54, 58=58.

## 10. 아직 aptSeq를 보내지 않는 호출부 (§10)

| 호출부 | 상태 | 판단 |
|---|---|---|
| `apt-client.tsx` (상세) | **보낸다** | 이 STEP에서 연결 |
| `lib/report/apt-read.ts` (리포트) | 원래부터 aptSeq | 변경 불필요 |
| `lib/compare-v2/fetch.ts` (비교) | 보내지 않음 | 아래 참고 |

비교(CompareV2)는 거래와 점수를 **의도적으로 병렬 호출**한다(COMPARE_V2_ARCHITECTURE_
AUDIT.md §21 — "score resolves its own aptSeq independently"). aptSeq를 쓰려면 그
병렬을 직렬로 바꿔야 한다. 비교 진입은 항상 `dong`을 싣기 때문에 116건 중 대부분은
영향받지 않지만, 같은 동 동명 8건은 비교 화면에서 여전히 AMBIGUOUS다.
**이 STEP의 범위를 넘으므로 바꾸지 않고 백로그에 기록했다.**

`/api/apt/[name]/education` 라우트도 같은 이름 기반 해소를 쓴다(주석에 "score route와
동일 원칙"이라고 적혀 있다). 점수와 무관한 별도 경로이고 이 STEP의 범위가 아니라
손대지 않았다 — 백로그에 기록.

## 11. 테스트 (§11)

`src/lib/apartment-score/resolve-score-identity.test.ts` 20건. 가짜 prisma로 DB 없이
돈다.

- aptSeq 직접 해소 / aptSeq가 있으면 이름 조회를 아예 하지 않음(호출 기록으로 검증)
- 약한 이름 단서가 aptSeq를 뒤집지 못함
- 대원 / 대원아파트 회귀 케이스 고정
- 이름만 모호한 요청은 여전히 AMBIGUOUS — 첫 번째를 고르지 않음
- 법정동 폴백 / 부분포함 폴백 보존, lawdCd 없이 이름만으로는 해소하지 않음
- 잘못된 형태의 aptSeq 6종 → DB 조회 없이 NOT_FOUND
- master 없는 aptSeq → 이름 경로로 폴백하지 않음
- 호출부 계약(검증된 aptSeq만 전송 · identity 확정 전 미요청 · 고정 · 캐시 키)
- 점수 산식 무변경(라우트 import 목록 고정)

```
전체 src 테스트 : 751 / 751 PASS   (신규 20건 포함)
```

## 12. 품질 (§13)

```
npx tsc --noEmit     src 오류 0   (scripts/ 20 + tmp/ 4 = 기존 14개 파일,
                                  FAIL_EXISTING_SCRIPT_ERRORS)
npx eslint <변경 파일> 오류 0
                     (apt-client.tsx:731 "Unused eslint-disable" 경고 1건은 기존)
npm run build        exit 0
```

## 13. 알려진 문제 / 보존 항목

- **`REVIEW_REQUIRED` master `26440-329 에코델타더베르힐`** — 이 STEP에서 손대지
  않았다. 그대로 보류.
- **비교(CompareV2)의 같은 동 동명 8건** — §10.
- **`education` 라우트** — §10.
- **점수 카드 도착 시점이 거래 응답 뒤로 밀림** — §6. 의도한 교환이다.
- **모바일 렌더 QA 미실시** — 브라우저 도구 미승인. 이 STEP은 데이터 해소 경로
  변경이라 시각 회귀 표면이 없다.

## 14. 다음 STEP

1. 도메인 커토버(환경변수 + 재배포 + Kakao JS 키 도메인 등록 + OAuth 리디렉션 URI)
2. `MASTER COVERAGE SYNC AUTOMATION` (승인 필요)
3. CompareV2 / education 라우트의 aptSeq 해소
4. `SCHOOL SCORE MODEL REBASE V1` (기존 P1, 유지)
