# APT DETAIL SERVER ERROR AUDIT — `/api/apt/[name]` "replace is not a function" (2026-09-06)

## 1. 목적

관리자 에러 로그(`error_logs`)에 반복 기록되던 두 메시지

- `raw.replace is not a function`
- `e.replace is not a function`

의 **정확한 원인 코드 위치 / 실제 들어온 값의 타입 / 재현 조건**을 밝히고,
canonical identity(아파트 재식별 규칙)를 약화시키지 않는 범위에서 수정한다.

## 2. 현재 상태 (조사 시작 시점)

`error_logs` 전체 24행 중 14행이 이 오류다. 둘 다 `url = '/api/apt/[name]'`.

| 메시지 | 건수 | 최초 | 최종 |
|---|---|---|---|
| `raw.replace is not a function` | 11 | 2026-08-28T07:28:55Z | 2026-09-02T13:45:02Z |
| `e.replace is not a function` | 3 | 2026-09-02T07:31:03Z | 2026-09-05T17:07:16Z |

두 메시지는 **서로 다른 오류가 아니라 같은 오류의 빌드별 표기**다.

- `raw` = 소스의 파라미터명 (`next dev` 빌드, 스택 경로 `.next/dev/server/chunks/...`)
- `e` = 같은 파라미터가 minify된 이름 (프로덕션 빌드, 스택 경로
  `/var/task/.next/server/chunks/...` = Vercel, 그리고 `D:\...\.next\server\chunks\...`
  = 로컬 `npm run build && npm start`)

즉 **Vercel Production에서도 실제로 발생**했다(2026-09-02T07:31:03Z, `/var/task/...` 스택).

## 3. 분석 — 원인 코드 위치 확정

### 3.1 스택 → 바이트 단위 대조

프로덕션 스택:

```
TypeError: e.replace is not a function
    at l (.next/server/chunks/src_lib_0b73t3f._.js:1:3161)
    at e.s.currentUnitTypesCount (.next/server/chunks/src_lib_0b73t3f._.js:1:4263)
```

이 청크 파일이 로컬에 그대로 남아 있어 오프셋을 직접 대조했다.

- col 3161 → `function l(e){if(!e)return"";let n=e.replace(t,"")...}`
  → `l` = `normalizeAptName`, 터진 지점은 `raw.replace(BUILDING_SUFFIX_PATTERN, '')`
- col 4263 → `for(let e of a)e.name&&e.aptSeq&&l(e.name)===r&&s.add(e.aptSeq)`
  → 호출부는 `resolveStrongIdentityAptSeqs` 안의 **`normalizeAptName(item.name)`**

(프레임 이름 `e.s.currentUnitTypesCount`는 minifier가 붙인 추론명일 뿐이며,
`shouldAdoptFallbackUnitTypes`와는 무관하다 — 오프셋이 이를 반증한다.)

dev 빌드 스택(`normalizeAptName ...:478:17` ← `resolveStrongIdentityAptSeqs ...:556:13`)도
현재 청크와 라인 오프셋 +12로 정확히 일치했다: 478+12=490 = `let s = raw.replace(...)`,
556+12=568 = `if (normalizeAptName(item.name) === requestedNorm)`.

### 3.2 코드 버전이 바뀌어도 같은 값에서 터졌다

가장 이른 2026-08-28 스택은 `resolveStrongIdentityAptSeqs`가 아직 없던 시점이라
호출부가 다르다:

```
at normalizeAptName
at aptNamesMatch
at Array.filter   ← route.ts의 allTrades.filter(item => aptNamesMatch(item.name, aptName))
at GET
```

세 코드 버전(8/28 `aptNamesMatch`, 8/30 이후 `resolveStrongIdentityAptSeqs`, 프로덕션
minify 빌드) 전부에서 **첫 인자 = `item.name`** 이다. 두 번째 인자
`aptName`은 `decodeURIComponent(params.name)`이라 항상 string이므로 후보가 아니다.

### 3.3 `item.name`은 어디서 오는가 — 실제 계약

`item`은 `fetchMolitData()` → `mapMolitItems()`(`src/lib/api-molit.ts`)가 만든 객체다.
이 매퍼에서 **`name`만 유일하게 문자열 정규화를 거치지 않는다**:

```ts
const dong      = (item.법정동 || item.umdNm  || '').toString().trim();
const buildYear = (item.건축년도 || item.buildYear || '').toString().trim();
const jibun     = (item.지번   || item.jibun  || '').toString().trim();
const aptSeq    = item.aptSeq != null ? String(item.aptSeq).trim() : null;
const name      = item.아파트 || item.aptNm || ... || '이름 없음';   // ← 원본 그대로
```

그리고 파서는 `new XMLParser({ ignoreAttributes: false, parseTagValue: true })`다.
`parseTagValue`는 **"숫자처럼 보이는 태그 텍스트"를 number로 변환**한다. 실측 확인:

| 원본 XML 텍스트 | 파싱 결과 타입/값 |
|---|---|
| `<aptNm>101</aptNm>` | number `101` |
| `<aptNm>0101</aptNm>` | number `101` (선행 0 소실) |
| `<aptNm>1.5</aptNm>` | number `1.5` |
| `<aptNm>0x1A</aptNm>` | number `26` |
| `<aptNm xsi:nil="true"/>` | object `{'@_xsi:nil':'true'}` |
| `<aptNm>1차삼성</aptNm>` | string (정상) |

`resolveStrongIdentityAptSeqs`는 `if (!item.name || !item.aptSeq) continue;`로
falsy만 거른다. 숫자 `101`이나 객체는 **truthy**라 그대로 `normalizeAptName()`에
들어가고 `.replace`가 없어 TypeError로 라우트 전체가 500이 된다.

### 3.4 잘못 들어온 실제 타입

**truthy 비문자열** — 실현 가능한 경로는 두 가지이며 둘 다 원천 XML에서 재현된다.

1. `number` — 단지명 태그 텍스트가 숫자로만 이루어진 경우 (주 원인 후보)
2. `object` — 단지명 태그에 속성이 붙어 텍스트 노드가 객체가 되는 경우

`null`/`undefined`/`''`는 `!item.name` 가드에 걸려 이 오류를 낼 수 없다.

### 3.5 재현 조건 — 어디까지 좁혀졌나

라우트는 요청 단지 하나가 아니라 **`lawdCd`(구/군) 전체의 최근 N개월 실거래 전량**을
훑는다(`period`는 클라이언트에서 12/36/60/**120**개월). 따라서 "그 구·그 기간 안에
비문자열 이름 행이 한 건이라도 있으면", 사용자가 어떤 단지를 열었든 500이 된다.
실제로 오류 시각 근처 PageView는 서로 다른 단지 5곳(대신롯데캐슬 / 동대신역비스타동원 /
연산동한솔솔파크 / 대신해모로센트럴 / 롯데캐슬 엄궁동)으로 흩어져 있는데, 이는
"특정 단지 버그"가 아니라 "특정 구·월 셀 버그"라는 이 구조와 일치한다.

배제(원천 실측):

- 부산 매매 이력 DB 전량 — 864,202행 / 18개 구·군 / 200601~202609, distinct 이름
  4,431개를 실제 파서에 통과시켜 비문자열 변환 0건
- 부산 전월세 이력 DB — distinct 3,436개, 비문자열 변환 0건
- `ApartmentMaster` — distinct 3,083개, 0건
- MOLIT 라이브 재조회: 26140/26470/26530 × 최근 120개월 × (apt) = 52,890행 0건,
  rent 26140 120개월 9,940행 0건, 36개월 3개 구 rent 24,306행 0건
- 라우트 기본 폴백 지역 11680(서울 강남구) × 120개월 35,571행 0건

즉 **부산 전역과 강남구는 현재 데이터 기준 깨끗하다.** 남은 재현 셀은 그 밖의
지역·월이다. 라우트가 지역 밖으로 나가는 경로는 실재한다: (a) `lawdCd`를 안 넘긴
진입에서 카카오 지오코딩이 동명 단지를 다른 지역으로 해석, (b) `/stats/*`가 전국
단지에 대해 이 라우트를 호출. 기존 에러 로그에는 요청 URL이 전혀 남지 않아 사후
특정이 불가능했다 — 이번에 그 로깅을 보강했다(§5).

## 4. 설계 결정

1. **`String(...)`으로 덮지 않는다.** 원래 계약은 "MOLIT 단지명 = 텍스트(식별자)"이고,
   그 계약을 깨는 주체는 **파서 설정**이다. 그래서 원천을 고친다.
2. **파서 레벨: 이름 태그에만 숫자 변환을 끈다.** `tagValueProcessor`가 `undefined`를
   반환하면 fast-xml-parser는 원본 문자열(trim만 적용)을 그대로 쓴다. 이름 태그는
   `undefined`, 나머지 태그는 `val`을 그대로 반환 → 다른 필드의 파싱 결과는 타입까지
   완전히 동일하다. 부수 효과로 `0101` 같은 표기의 **선행 0 손실도 함께 막힌다**.
3. **매퍼 레벨: `name`을 형제 필드와 같은 계약으로 맞춘다.** `mapMolitItems`는
   자체 XMLParser를 쓰는 대량 sync fetcher(`scripts/sale-molit-fetch.ts`)도 호출하므로
   파서 설정과 별개로 여기서도 문자열을 보장한다. 단, **객체/배열은 문자열화하지
   않는다** — `"[object Object]"` 같은 가짜 이름을 만드는 건 데이터 진실성 위반이라
   기존 sentinel `'이름 없음'`으로 둔다.
4. **식별 로직 레벨: 크래시만 막고 매칭은 넓히지 않는다.** `normalizeAptName`은
   비문자열에 `''`(식별 불가)를 반환한다. `''`는 `aptNamesMatch`의 기존 빈 값 가드와
   `matchesTradeIdentity`에서 매칭 성공이 되지 않는다. 추가로
   `resolveStrongIdentityAptSeqs`에 "요청 이름이 정규화 후 비면 exact set은 공집합"
   가드를 넣어, `''`끼리 같다고 판정되어 엉뚱한 aptSeq가 strong identity로 승격되는
   경로를 원천 차단했다(집합을 **줄이기만** 하는 변경).

## 5. 구현 내용

`src/lib/api-molit.ts`

- `createMolitXmlParser()` 신규 export — 이름 태그(`aptNm`/`offiNm`/`mhouseNm`/
  `아파트`/`단지`/`단지명`/`연립다세대`)만 숫자 변환 제외. `fetchMolitData()`가 사용.
- `toMolitNameText()` 내부 헬퍼 — string은 그대로, number/bigint는 문자열화,
  그 외(object/array 등)는 "없음"으로.
- `mapMolitItems()`의 `name` — 후보 우선순위는 기존과 동일하게 유지한 채 각 후보를
  위 헬퍼로 통과. 비문자열 후보가 실제로 오면 `console.warn`으로 `type/lawdCd/
  dealYmd/aptSeq/umdNm/jibun/원본값`을 남긴다(정상 데이터에서는 한 번도 찍히지 않음
  = 찍히면 그게 재현 셀이다).

`src/lib/apt-name-match.ts`

- `normalizeAptName` — `typeof raw !== 'string'`이면 `''`. 타입 시그니처는 `string`
  그대로 두어 정적 계약은 유지.
- `resolveStrongIdentityAptSeqs` — `requestedNorm`이 비면 공집합 반환.

`src/app/api/apt/[name]/route.ts`

- catch 블록의 `logServerError` 메시지에 경로+쿼리(단지명/lawdCd/dong/type/period)를
  덧붙인다. 이번 조사에서 가장 아쉬웠던 게 이 정보의 부재였다.

## 6. 테스트 결과

신규 회귀 테스트 10개(전부 수정 전에는 FAIL, 수정 후 PASS).

`src/lib/api-molit.test.mjs`

- `createMolitXmlParser`: `<aptNm>0101</aptNm>` → 문자열 `"0101"`(선행 0 보존),
  동시에 `excluUseAr`=number 84.99 / `dealYear`=number / `dealAmount`=`"65,000"` /
  `aptSeq`=`"26140-1361"`로 **이름 외 필드 타입 회귀 없음**
- `mapMolitItems`: `aptNm`이 number여도 `name`은 문자열
- `mapMolitItems`: 객체 shape이면 이름을 지어내지 않고 `'이름 없음'`
- `mapMolitItems`: 정상 문자열 이름 보존
- **재현 테스트**: 숫자 단지명이 섞인 원본 XML → 파서 → `mapMolitItems` →
  `resolveStrongIdentityAptSeqs`가 크래시 없이 정상 단지 aptSeq만 반환

`src/lib/apt-name-match.test.ts`

- `normalizeAptName`: number/object/null 입력에 크래시 없이 `''`
- `normalizeAptName`: 기존 정규화 동작 보존(건물번호 접미사/공백)
- `resolveStrongIdentityAptSeqs`: 비문자열 이름이 섞여도 정상 단지만 인정
- `resolveStrongIdentityAptSeqs`: 요청 이름이 비면 공집합
- `aptNamesMatch`/`matchesTradeIdentity`: 비문자열은 "매칭 안 됨"(오매칭 금지)

실행 결과:

- `npx tsx --test src/lib/api-molit.test.mjs src/lib/apt-name-match.test.ts` — 30/30 PASS
  (기존 20 + 신규 10)
- `npx tsx --test src/lib/trade-history-read.test.mjs scripts/sale-pagination-logic.test.ts
  scripts/trade-history-logic.test.mjs` — 44/44 PASS
- `npx tsc --noEmit` — `src/` 오류 0 (그 외는 기존 script/tmp 오류,
  FAIL_EXISTING_SCRIPT_ERRORS)
- `npm run lint` — exit 0
- `npm run build` — 성공

**실데이터 파리티(가장 중요한 회귀 근거)**: 기존 파서 vs 신규 파서로 각각
`mapMolitItems()`를 돌려 전 필드 deep-compare. 26140/26470/26530 × apt·rent ×
최근 12개월 = **11,879행 전부 완전 동일, 차이 0건.**

로컬 프로덕션 빌드(`npm run build && npm start`) 실제 호출:

- `대신해모로센트럴아파트`(26140/서대신동2가, period=120) — 113건, 이름 1종, aptSeq 1종
- `해운대경동제이드`(26350/우동) — 17건, `26350-2206` 단독
- `경동`(26350/우동) — 93건, `26350-2` 단독
  → SEARCH_DETAIL_IDENTITY_HOTFIX_V2가 막았던 "경동 ↔ 해운대경동제이드" 혼입이
  그대로 차단됨(identity 회귀 없음)

빌드 산출물 확인: 이전에 터졌던 바로 그 청크(`src_lib_0b73t3f._.js`)의 같은 함수가
이제 `function l(e){if("string"!=typeof e||!e)return""...}`로 빌드된다.

## 7. 알려진 문제 / 한계

- **재현 셀(구·월)을 특정하지 못했다.** 부산 전역·강남구는 실측으로 배제했지만,
  나머지 전국 지역까지 라이브로 훑지는 않았다(요청량 문제). 대신 §5의 `console.warn`
  + 라우트 에러 로그 요청 컨텍스트로, 다음에 같은 원본이 오면 지역·월·원본값이
  그대로 남는다.
- `mapMolitItems`는 number를 문자열화하므로, **자체 파서를 쓰는 sync fetcher 경로**
  (`scripts/sale-molit-fetch.ts`)에서는 `0101` 같은 선행 0이 여전히 손실될 수 있다.
  그 fetcher의 파서도 `createMolitXmlParser()`로 바꾸면 완전히 닫히지만, 이번 범위
  (읽기 라우트 오류)를 넘어서고 대량 sync 경로에 영향을 주므로 별도 승인 후 권장.
- 이번 수정으로 이 오류가 **다시 발생할 수 없다**고 말할 수 있는 근거는 "비문자열이
  들어와도 크래시하지 않는다"는 계약 자체이지, "비문자열이 다시는 안 온다"가 아니다.

## 8. 회귀 위험

| 항목 | 평가 |
|---|---|
| 이름 외 필드 파싱 | 실데이터 11,879행 deep-compare 차이 0 |
| 정상 이름 매칭 | 기존 회귀 테스트 20개 전부 PASS, 정규화 동작 테스트 추가 |
| canonical identity | 매칭을 **넓히지 않고** 좁히기만 함(빈 이름 exact 승격 차단) |
| DB / schema / migration | 변경 0 |
| Production write | 0 |
| 외부 API 의존성 | 추가 0 |

## 9. 다음 STEP

- Vercel Production 배포 후 `error_logs`에 `replace is not a function` 신규 유입이
  0인지 관찰(관리자 에러 로그).
- `[molit] 단지명이 문자열이 아님` warn이 찍히면 그 셀을 재현 조건으로 확정하고
  기록한다.
- (선택) `scripts/sale-molit-fetch.ts`의 파서를 `createMolitXmlParser()`로 통일.
