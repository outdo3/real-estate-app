# APT DETAIL MOLIT PARTIAL FAILURE TRUST FIX (2026-09-06)

## 1. 목적

`/api/apt/[name]`은 요청 하나가 여러 개의 (lawdCd, 월) 셀을 조회해 합친다. 그중 **일부만
실패해도** 성공한 월만 조용히 합쳐서 정상 응답처럼 돌려주고, 그 결과가 1시간 캐시에
그대로 들어갔다. 사용자에게는 "이 단지는 원래 거래가 이만큼밖에 없다"로 읽힌다.

실측(직전 STEP QA): 같은 단지·같은 조건이 로컬 **17건** / 부분 실패 상태의 Production
**7건**. E-JIP 데이터 진실성 원칙 위반 — **실패한 조회 ≠ 거래 0건/ 적은 거래**.

## 2. 시작 상태

- branch `main`, HEAD `e4cb0d7` (직전 STEP: MOLIT 숫자형 단지명 크래시 수정)
- 사용자 dirty/untracked 파일(package.json/lock, tmp/, officetel 스크립트 등) 전부 보존,
  reset/stash/clean 없음

## 3. 기존 실패 계약 추적 (수정 전)

| 항목 | 수정 전 동작 |
|---|---|
| 월 태스크 수 | `period`개(클라이언트가 12 / 36 / 60 / **120** 요청) |
| 태스크 표현 | 없음. `fetchMolitData()`가 실패해도 throw하지 않고 `typeLabel:'에러'` 플레이스홀더 1건 배열을 반환 → 그대로 `allTrades`에 concat |
| 재시도 | **없음**(0회) |
| 스로틀링 | **없음**. 12개월씩 청크로 나눠 `Promise.all` = 순간 동시 요청 12. `molit-stats-helpers.ts`의 전역 세마포어(동시 6 + 슬롯당 200ms + 1회 재시도)를 **쓰지 않는다** |
| 타임아웃 | `AbortSignal.timeout(5000)` (fetchMolitData 내부) |
| 집계 | 성공/실패 구분 없이 전부 concat. 실패 플레이스홀더는 단지명 필터에서 **조용히** 탈락 |
| `apiError` 조건 | `errorMonths >= months.length` — **모든 월이 실패했을 때만** |
| 캐시 write | `getOrSetCache('molit:{type}:{lawdCd}:{ym}', 1h)`. 실패 플레이스홀더도 **정상 값처럼 캐시**됨 |
| 캐시 TTL | 1시간 |
| 실패 vs 진짜 0건 | **구분 불가**. 둘 다 "그 달에 아무것도 없음"으로 흡수 |

### 조용한 과소집계의 정확한 경로

1. 12개월 중 1개월이 스로틀링으로 실패 → 그 달 플레이스홀더 1건 반환
2. `getOrSetCache`가 그 실패를 **1시간 캐시**에 기록
3. 라우트가 전부 concat → 단지명 필터가 플레이스홀더 제거
4. `errorMonths(1) >= months.length(12)`가 거짓 → `apiError = null`
5. 응답은 "정상 + 거래 N건". 실제로는 한 달치가 통째로 빠진 값
6. 같은 지역을 여는 다른 단지·다른 사용자도 1시간 동안 같은 축소된 값을 본다
   (캐시 키가 lawdCd+월 단위라 단지와 무관하게 공유된다). `/api/presales/[id]/nearby-market`도
   같은 키를 쓰므로 서로 오염시킬 수 있었다.

## 4. 신뢰 의미론 (수정 후)

월 셀 하나는 반드시 셋 중 하나다 — `src/lib/apt-trade-completeness.ts`:

| 상태 | 판정 | 의미 |
|---|---|---|
| `SUCCESS_WITH_DATA` | 배열 + 에러 플레이스홀더 없음 + 1건 이상 | 정상, 거래 있음 |
| `SUCCESS_EMPTY` | 배열 + 플레이스홀더 없음 + 0건 | **정상, 진짜 무거래** |
| `FAILED` | 플레이스홀더 포함 / 배열 아님 / 예외 | 실패 — 0건이 아니다 |

`SUCCESS_EMPTY ≠ FAILED`가 이 STEP의 핵심 불변식이다. 판정식은 새로 만들지 않고
통계 라우트(`molit-stats-helpers.ts`)가 이미 쓰던 규칙(`typeLabel==='에러'`)을 그대로 쓴다.

집계 요약(`summarizeTradeCompleteness`)은 통계 라우트의 `partial` / `failedDistricts`
표현과 같은 의미로 맞췄다(셀 단위만 지역 → 월):

- `partial = 실패 월이 1개 이상`
- `allFailed = 요청 월 전부 실패` (= 기존 `apiError` 조건, 하위 호환)

## 5. 응답 계약 변경 (하위 호환)

기존 필드는 의미까지 그대로 유지하고, 사실을 담은 필드만 추가했다.

```jsonc
{
  "trades": [...],
  "apiError": null,          // 기존과 동일: "요청한 모든 월이 실패"일 때만 truthy
  "lawdCd": "26140",
  "dong": "서대신동2가",
  "partial": true,           // 신규 — 한 달이라도 실패
  "failedMonths": ["202601"],// 신규 — 실패 월(YYYYMM) 오름차순
  "monthsRequested": 36,     // 신규
  "monthsSucceeded": 35      // 신규
}
```

- 일부 실패를 `apiError`로 승격하지 **않는다** — 기존 소비자(QA 스크립트의
  `isApiFailureMisclassifiedAsNoTrade` 포함)의 동작을 바꾸지 않기 위함이다.
- 실패한 월의 에러 플레이스홀더는 `trades` 계산에서 **완전히 제외**된다(이전에는
  concat된 뒤 이름 필터에 의존해 사라졌다).
- 없는 값을 지어내지 않는다. 실패 월의 거래는 채우지 않고, 빠졌다는 사실만 알린다.

## 6. 프론트엔드 정직한 상태

`src/lib/trade-read-state.ts`가 응답을 화면용 상태로 정규화한다(공용).

- `incompleteMessage` 신규: 전체 실패 → `실거래가 API 요청에 실패했습니다.`,
  일부 실패 → **`일부 기간의 거래 정보를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.`**
- `TradeTimelineList`: 목록이 비어 있든 아니든 이 문구를 노출한다. 거래가 있을 때는
  목록 위 배너로 "아래 목록은 불러온 기간만 반영한 결과입니다"를 덧붙인다.
  값이 없을 때만 "선택한 조건의 실거래가 없습니다."라고 말한다.
- `PriceTrendChart`: 이미 있던 안내 자리에 같은 문구를 연결(새 재시도 UI 추가 없음).
- 원본 오류 문자열("초당 서비스 요청제한 횟수 초과 에러" 등)을 화면에 그대로 찍던
  기존 문구(`실거래가 데이터를 불러오지 못했습니다. (${apiError})`)를 제거했다.

## 7. 캐시 안전성

`getOrSetCache(key, ttl, fetcher, { shouldCache })` — **옵션은 추가만** 했고, 옵션을
주지 않으면 기존과 100% 동일하게 무조건 캐시한다(다른 라우트 의미 변경 없음).

`src/lib/molit-month-cache.ts`(신규)가 MOLIT 월 조회 + 캐시를 한 곳으로 모은다:

- 키 형식은 기존 그대로 `molit:{type}:{lawdCd}:{dealYmd}`, TTL도 1시간 그대로
  (두 라우트가 같은 원본 월 데이터를 계속 공유해야 하므로 키를 바꾸지 않았다)
- **`FAILED`는 캐시하지 않는다** → 다음 요청이 재시도해 회복 가능
- 이미 캐시된 정상 결과는 TTL 안에서 재조회 자체가 없으므로 실패로 덮이지 않는다
- `/api/presales/[id]/nearby-market`도 같은 헬퍼를 쓰도록 바꿨다(반환 아이템/키/TTL
  동일, 달라지는 건 실패를 캐시하지 않는 것뿐) — 그래야 두 라우트가 서로의 캐시를
  오염시키지 않는다

| 시나리오 | 이전 | 이후 |
|---|---|---|
| 월 조회 실패 | 1시간 캐시 → 그 지역·월이 1시간 내내 축소 | 캐시 안 함 → 다음 요청이 재시도 |
| 실패 후 성공 | 1시간 뒤에야 회복 | 즉시 회복, 그때 정상 캐시 |
| 정상 캐시 + 이후 일시적 실패 | 덮일 수 있음 | 덮이지 않음 |
| 진짜 0건(성공) | 캐시됨 | 캐시됨(동일) — 무거래를 매번 재조회하지 않는다 |

## 8. 재시도 / Rate limit 감사 (변경 없음)

| | `/api/apt/[name]` | 통계 라우트(`molit-stats-helpers.ts`) |
|---|---|---|
| 동시성 | 청크 12 동시(전역 세마포어 미사용) | 전역 세마포어 6 + 슬롯당 200ms 유지 |
| 재시도 | 0회 | 1회(400ms 후) |
| 타임아웃 | 5s | 5s(같은 `fetchMolitData`) |

§8 지시에 따라 **동시성/재시도 정책은 손대지 않았다.** 다만 감사 결과로 남긴다:
두 경로가 서로 다른 풀을 쓰기 때문에 상세 페이지와 통계가 동시에 돌면 순간 동시
MOLIT 요청이 최대 6+12=18까지 갈 수 있고, 이것이 "초당 서비스 요청제한" 발생 원인의
하나로 보인다. 상세 라우트를 기존 전역 세마포어로 옮기는 것은 지연시간 프로파일을
바꾸는 변경이라 **별도 STEP**으로 제안한다(이번 STEP의 목표는 정직한 실패 표현이다).

## 9. 보너스로 발견·수정한 비밀값 노출 (P0)

부분 실패 검증 중 `?type=bogus`로 요청했더니 응답 `apiError`가 이랬다:

```
Failed to parse URL from ?serviceKey=<공공데이터 인증키 전체>&LAWD_CD=...
```

- 원인: 알 수 없는 `type`이면 `endpoint`가 빈 문자열로 남아 상대 URL이 만들어지고,
  `fetch`의 실패 메시지에 요청 URL(=serviceKey 포함)이 통째로 들어간다. 그 메시지가
  에러 플레이스홀더 → 라우트 응답 → 화면/ErrorLog까지 그대로 흘렀다.
- `type`은 쿼리스트링으로 외부에서 지정 가능하므로 **누구나 호출 한 번으로 인증키를
  얻을 수 있는 실제 노출 경로**였다.
- 수정: (1) URL을 만들기 전에 지원하지 않는 거래 유형을 명시적으로 차단,
  (2) `redactMolitFailureMessage()`로 `serviceKey=...`와 URL을 마스킹한 뒤에만 밖으로
  내보냄, (3) 에러 플레이스홀더의 `info`에 넣던 키 조각(앞 5자+뒤 5자) 제거.
- 저장된 로그 점검(READ ONLY): `error_logs`에 `serviceKey`/키 조각을 포함한 행 **0건**.
- 실측 확인: 수정 후 같은 요청의 응답은 `apiError="지원하지 않는 거래 유형입니다."`,
  응답 본문 어디에도 `serviceKey` 문자열 없음.

## 10. 테스트

전부 결정적(네트워크/Production 스로틀링 의존 없음).

`src/lib/apt-trade-completeness.test.ts` (19)
- 월 분류: 정상/진짜 0건/에러 플레이스홀더/배열 아님
- A 12/12 성공 · B 11+1 실패 · C 6+6 실패 · D 12/12 실패 · E 전부 성공+0건
- 에러 플레이스홀더가 거래 목록에 새어 들어가지 않음
- 전 월 실패 시에만 `apiError`, 사유 없으면 일반 문구
- 실패 월 정렬/요청 0개 방어

`src/lib/molit-month-cache.test.ts` (8)
- 성공 캐시 / **진짜 0건도 캐시**(실패로 취급 금지) / 실패는 캐시 안 함
- 부분 실패 다음 요청이 완전한 결과를 받음(회복)
- 캐시된 정상 결과가 이후 실패로 덮이지 않음(오염 방지)
- fetcher가 throw해도 0건이 아니라 FAILED
- 캐시 키 형식이 기존과 동일

`src/lib/server-cache.test.ts` (6)
- 옵션 미지정 시 기존 동작 유지 / shouldCache=false면 캐시 안 함 / 회복 / 오염 방지 /
  TTL / in-flight 중복 제거 유지

`src/lib/trade-read-state.test.mjs` (9)
- 부분 실패는 거래가 있어도 완전한 결과가 아님 / 부분 실패 + 0건도 "거래 없음"이 아님 /
  전체 실패는 실패 문구 / 원본 오류 문구 미노출 / partial 없는 예전 응답 하위 호환

`src/lib/api-molit.test.mjs` (15)
- 기존 취소 필드 + 숫자형 단지명 회귀(직전 STEP) 유지
- 신규: serviceKey 마스킹 3개 + 지원하지 않는 type 차단 1개

합계 **136개 PASS / 0 FAIL** (위 5개 파일 + `apt-name-match` 24, `trade-history-read`,
`sale-pagination-logic`, `trade-history-logic`, `busan-qa-logic` 포함).

## 11. 검증

- `npx tsc --noEmit` — `src/` 오류 **0** (그 외는 기존 script/tmp 오류,
  FAIL_EXISTING_SCRIPT_ERRORS)
- `npm run lint` — exit 0. `apt-client.tsx:593`의 "Unused eslint-disable directive"
  경고는 HEAD 원본을 그대로 lint해도 동일하게 나오는 **기존 경고**임을 확인
- `npm run build` — 성공
- 로컬 프로덕션 빌드 실호출(저부하, MOLIT 하드히트 없음):
  - 해운대경동제이드 36개월 → 17건, `partial=false`, `ok=36/36`, aptSeq `26350-2206` 단독
  - 경동 36개월 → 93건, `partial=false`, aptSeq `26350-2` 단독 (identity 분리 유지)
  - 대신해모로센트럴 rent 12개월 → 41건, `ok=12/12`
  - 존재하지 않는 단지 → `trades=0, apiError=null, partial=false, ok=12/12`
    (**진짜 0건이 실패로 오분류되지 않음**)
  - `type=bogus` → `apiError="지원하지 않는 거래 유형입니다.", partial=true, ok=0/3`,
    응답에 `serviceKey` 없음

## 12. 관리자 로깅

부분 실패(전체 실패는 기존 `apiError` 경로) 시 **요청당 한 줄**만 남긴다. 같은
`(type, lawdCd)`에 대해 5분 이내 반복은 억제한다(스로틀링은 연속 발생하므로 그대로
두면 같은 사실이 수십 번 쌓인다).

```
[MOLIT_PARTIAL] source=MOLIT type=apt lawdCd=26140 dong=서대신동2가 period=36
  months=36 ok=34 failed=2 failedMonths=202601,202512 reason=<마스킹된 원본 사유>
```

실패 월은 최대 12개까지 나열하고 나머지는 `+N`으로 요약한다. 비밀값은 §9의 마스킹을
거친 뒤에만 들어간다.

## 13. sale-molit-fetch 파서 통일 (§13)

`scripts/sale-molit-fetch.ts`는 자체 `new XMLParser({ ignoreAttributes:false,
parseTagValue:true })`를 쓰고 있었다. `createMolitXmlParser()`로 바꿨다.

- 이 파서는 **단지명 태그만** 숫자 변환을 끈다. `resultCode`/`totalCount`/거래금액/면적
  등 이 fetcher가 읽는 다른 필드의 파싱 결과는 완전히 동일하다(직전 STEP에서 실데이터
  11,879행 deep-compare로 확인).
- 쓰기 동작 변화 없음. 유일한 차이는 숫자처럼 보이는 단지명의 원본 표기(예: 선행 0)가
  보존된다는 것 — 부산 DB distinct 이름 4,431개 중 해당 사례 0건이므로 기존 행에는
  영향이 없다. 이번 STEP에서 Production sync/bulk write는 **하지 않았다**.
- 후속 감사 필요(이번 범위 밖): `scripts/rent-trade-history/rent-molit-fetch.ts`,
  `scripts/officetel/*`, `scripts/redevelopment/import_busan.ts`,
  `scripts/apartment_master_seed.ts`, `src/app/api/school/apartments/route.ts`도 각자
  `XMLParser`를 만든다.

## 14. 직전 STEP(e4cb0d7) 회귀

- 숫자형 단지명 → `name` 문자열 보장, 객체 shape → 가짜 이름 안 만듦: 테스트 유지 PASS
- strong aptSeq identity / 느슨한 이름 폴백 금지 / 교차 단지 누출 없음:
  `apt-name-match.test.ts` 24개 PASS + 로컬 실호출로 경동 ↔ 해운대경동제이드 분리 확인
- 식별 로직은 이번 STEP에서 한 줄도 바꾸지 않았다

## 15. 남은 신뢰 리스크

1. **`InvestmentMetrics`, `/stats/[type]` 비교 차트는 `partial`을 읽지 않는다.**
   부분 실패 시 전세가율/갭/추이가 불완전한 표본으로 계산될 수 있다(값 자체는 실제
   거래지만 기간 커버리지가 다름). 이번 범위 밖 — 다음 STEP 후보.
2. **동시성 18 문제**(§8) — 스로틀링 발생 빈도 자체를 줄이려면 상세 라우트를 전역
   세마포어로 옮기는 별도 STEP이 필요하다.
3. TTL 만료 후 재조회가 실패하면, 직전까지 갖고 있던 정상 데이터를 stale로 제공하지
   않고 정직하게 `partial`로 보고한다. 더 나은 UX(stale-if-error)는 캐시 의미론을
   추가로 바꿔야 해서 이번엔 넣지 않았다.
4. `apiError`는 여전히 "전 월 실패"에서만 켜진다. 이건 하위 호환을 위한 의도된 선택이며,
   부분 실패는 `partial`로만 표현된다 — 새 소비자는 `partial`을 읽어야 한다.
