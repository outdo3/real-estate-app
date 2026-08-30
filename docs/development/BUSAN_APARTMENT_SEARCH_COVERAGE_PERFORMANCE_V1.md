# BUSAN APARTMENT SEARCH COVERAGE + PERFORMANCE V1

## 1. Incident

사용자 실제 발견 사례: 아실/네이버에서는 정상 존재하는 "경동마리나"(부산 해운대구
우동, 1995년, 892세대 주장)가 이집 검색(홈/빠른검색/지도 검색 전부)에서 결과 자체가
나오지 않았다. 검색 반응 속도도 체감상 느리다는 신고가 함께 있었다.

## 2. Gyeongdong Marina Reproduction

실행 시점(2026-08-30) 기준 실제 dev 서버(`npm run dev`, localhost:3000)에 대해 4개
진입점이 모두 동일한 `/api/search?q=...` 엔드포인트를 호출함을 코드 추적(Explore
에이전트) + 실측(curl)으로 확인:

| 진입점 | 컴포넌트 | 확인 결과 |
|---|---|---|
| 홈 | `HomeApartmentSearch` → `ApartmentAutocomplete` | `/api/search` 호출, 결과 0건 |
| 빠른 검색 | `ApartmentQuickSearch` → `ApartmentAutocomplete` | 동일 endpoint, 결과 0건 |
| 지도 검색 | `src/app/map/page.tsx` → `ApartmentAutocomplete` | 동일 endpoint, 결과 0건(브라우저 실측) |
| (참고) `ApartmentAutocomplete.tsx.bak` | 미사용 dead code(커밋 안 됨) | 카카오 직접 호출 구버전, 라이브 경로 아님 |

실측 응답(수정 전):

```
GET /api/search?q=경동마리나        -> regions:0 apartments:0
GET /api/search?q=경동%20마리나     -> regions:0 apartments:0
GET /api/search?q=경동마리나아파트  -> regions:0 apartments:0
GET /api/search?q=경동              -> regions:0 apartments:15 (경동/우동/72세대 항목 없음)
```

`경동`(exact 검색어)조차 대상 단지를 반환하지 않는 **두 번째, 독립적인 버그**를
함께 재현했다 — household 수 기준 정렬 때문에 정확히 일치하는 작은 단지가 15개
제한 밖으로 밀려남(§3/§11 참고).

## 3. Root Cause

**CASE B — ApartmentMaster에 다른 이름으로 존재.**

DB 트레이스(read-only, ApartmentMaster/Apartment/ApartmentTradeHistory/
ApartmentUnitType 전수):

- `ApartmentMaster` id=2085: `aptSeq="26350-2"`, `name="경동"`,
  `normalizedName="경동"`, `umdName="우동"`, `jibun="974"`, `buildYear=1995`,
  `totalHouseholds=72`, `latitude=35.1627876973683`,
  `longitude=129.1427961553059`. "경동마리나"라는 문자열은 `name`에도
  `normalizedName`에도 없다.
- `ApartmentTradeHistory`(aptSeq=`26350-2`): 981건 실거래, `aptName="경동"` —
  MOLIT 공식 등록명도 "경동"뿐이다("경동마리나" 문자열이 우리 데이터 어디에도
  존재하지 않음).
- `Apartment`(legacy 캐시) 쪽은 별개 발견사항으로 §11에 기록.

**교차 확인(카카오 POI, 이미 앱 전역에서 쓰는 기존 API, live 호출 1회 테스트)**:

```
GET https://dapi.kakao.com/v2/local/search/keyword.json?query=경동마리나
-> "경동마리나아파트" | 부동산 > 주거시설 > 아파트 | 부산 해운대구 우동 974
   x=129.14279615530592 y=35.1627876973683
```

좌표가 `ApartmentMaster.aptSeq=26350-2`(경동)와 소수점 단위까지 완전히 일치 —
"경동마리나"는 실재하는 통용 별칭(카카오/네이버/아실이 쓰는 이름)이고, 공식
건축물대장/MOLIT 등록명은 "경동"뿐이라는 사실이 좌표로 확정됐다. **우리 데이터
소스 어디에도 "경동마리나"라는 문자열이 없으므로, normalize/contains 매칭을
아무리 개선해도 문자열 매칭만으로는 이 케이스를 못 찾는다** — 좌표 기반 역매칭이
유일한 다리.

같은 검색(`경동마리나`) Kakao 응답 7건 중 4건은 비주거 카테고리였다(상가/학원/
부동산중개업/전기차충전소) — "카테고리=아파트" 필터가 필수임을 실측으로 확인.

부가 발견(별도 이슈, 이번 STEP 범위 밖): `ApartmentMaster.totalHouseholds=72`는
명백히 오염된 값이다(981건 실거래, 최고 19층, 191㎡ 대형 평형 존재 — 72세대
단지의 특성이 아니다. parkingCount=962도 72세대 대비 비정상). 사용자가 언급한
"892세대"가 실제 값일 가능성이 높으나, **Production data write는 이번 STEP
승인 범위 밖**이므로 수정하지 않고 §25에 데이터 보정 권고로만 남긴다.

## 4. Search Architecture Before

Explore 에이전트 전수감사(§5 스코프) 요약 — 5개의 서로 다른 정규화 구현체가
존재했으나 실제 검색 API(`/api/search`)는 그중 어느 것도 안 쓰고 공백 제거만
했었다:

| 정규화 구현 | 파일 | 아파트 접미사 제거 |
|---|---|---|
| `normalizeAptName` | `src/lib/apt-name-match.ts` | O |
| `normalizeName`(seed) | `scripts/apartment_master_seed.ts` (DB `normalizedName` 컬럼을 채운 실제 로직) | O |
| local `normalizeAptName` | `src/app/api/school/apartments/route.ts` | O |
| `normalizeComplexNameForMatch` | `src/lib/ai-search.ts` | O |
| **`/api/search/route.ts`(검색 API 본체)** | — | **X (공백만 제거)** |

랭킹: DB에서 `take:50`으로 자른 뒤 JS에서 `totalHouseholds desc` 단일 기준
정렬 후 상위 15개만 반환 — exact match 여부를 전혀 고려하지 않음.

성능 핵심 병목(§12 실측): 검색 자체(`/api/search`)가 아니라, **검색 결과
선택 후 상세 이동 전 "실거래 확인" 게이트**(`HomeApartmentSearch.tsx`,
`ApartmentQuickSearch.tsx`의 `handleSelect`)가 `/api/apt/[name]?type=apt&
period=12&...`를 호출했는데, 이 라우트는 캐시가 없으면 MOLIT 실거래 API를
월별로 최대 12회 순차 호출한다 — 실측 **첫 호출 5.438초**.

## 5. Search Architecture After

세 가지 최소 code-only 변경(schema 무변경):

1. **`/api/search/route.ts` 정규화 정렬**: `normalizeSearchKeyword()`
   (`src/lib/search-ranking.ts`)로 `scripts/apartment_master_seed.ts`와
   동일 규칙(공백 제거 + 끝 "아파트" 접미사 제거) 적용. 상위집합으로만
   확장(기존 매칭 케이스 깨지지 않음).
2. **랭킹 tier화 + take 상한 제거**: `rankApartmentMatches()`가 exact(0) >
   startsWith(1) > contains(2) 순으로 tier를 매기고, 같은 tier 안에서만
   `totalHouseholds desc`. DB `take:50`도 제거(테이블 전체 ~3,400행 규모라
   무제한 `contains` 스캔도 실측 100ms 내외 — §7 감사에서 `take:50` 자체가
   실제 누락 원인 중 하나였음을 확인).
3. **카카오 별칭 폴백**(`src/lib/search-alias-fallback.ts`): DB `contains`
   매칭이 **완전히 0건**일 때만, 이미 앱 전역에서 쓰는 카카오 키워드 검색으로
   좌표 기반 역매칭. 안전장치: (a) 카테고리 정확히 "...주거시설 > 아파트"만
   후보, (b) 반경 80m 이내 `ApartmentMaster` row가 **정확히 1개**일 때만
   채택(0개=매칭 실패 유지, 2개 이상=모호하므로 채택 안 함), (c) 반환 identity는
   전부 canonical `ApartmentMaster` 값(사용자 입력 별칭을 identity에 섞지
   않음), (d) 키워드별 in-memory 캐시로 반복 호출 방지.
4. **성능**: `HomeApartmentSearch.tsx`/`ApartmentQuickSearch.tsx`의 검증
   게이트를 새 DB-only 엔드포인트 `/api/apt/[name]/verify`
   (`src/app/api/apt/[name]/verify/route.ts`)로 교체. `ApartmentTradeHistory`
   (identityKey 인덱스) + `Apartment`/`ApartmentUnitType`(name+dong 유니크
   인덱스) 존재 여부만 확인 — MOLIT 외부 호출 0회. 기존 계약(`hasTrades ||
   hasUnitTypes`)과 완전히 동일한 boolean, 데이터 소스만 DB-first로 교체.

## 6. Search Source Matrix

| ENTRY POINT | 컴포넌트 | 훅 | ENDPOINT | DB/소스 | 외부 API |
|---|---|---|---|---|---|
| 홈 | `HomeApartmentSearch.tsx` | `ApartmentAutocomplete`(debounce 250ms, min 2자) | `/api/search` | `ApartmentMaster` | 0건(정상), 카카오 fallback(0건일 때만, 최대 1회) |
| 빠른검색(상세 모달) | `ApartmentQuickSearch.tsx` | 동일 | `/api/search` | `ApartmentMaster` | 동일 |
| 지도 | `src/app/map/page.tsx` | 동일 | `/api/search` | `ApartmentMaster` | 동일 |
| 선택 후 검증(전체 3곳 공통) | `handleSelect` | — | **`/api/apt/[name]/verify`(신규)** | `ApartmentTradeHistory`+`Apartment`+`ApartmentUnitType` | 0건(변경 전: MOLIT 최대 12회/요청) |
| AI 검색(`/ai-search`) | 별도 서브시스템 | — | `/api/ai-search` → `/api/transactions` | MOLIT live | Gemini + Kakao(변경 없음, 이번 STEP 범위 밖) |

## 7. Trade-history Universe

`scripts/audit-busan-search-coverage.ts`(신규, read-only)로 부산
`ApartmentTradeHistory`의 distinct `(aptSeq, identityKey)`를 "실제 거래
universe"로 삼아 `ApartmentMaster` 매칭 + `/api/search` 실제 랭킹 로직을
그대로 재현해 분류:

- 최근 24개월: 3,403건 distinct aptSeq
- 전체(2006~2026): 4,905건 distinct aptSeq

## 8. Coverage Methodology

`scripts/search-ranking.ts`(신규 공용 순수 함수 모듈)를 감사 스크립트와
`/api/search/route.ts`가 함께 import — 시뮬레이션과 실제 코드의 랭킹 로직이
항상 동일함을 보장(별도 재구현으로 인한 드리프트 없음). 분류:

- **MATCH**: 자기 자신의 공식 이름으로 검색 시 실제 top-15 응답에 포함
- **MASTER_MISSING**: `ApartmentMaster`에 해당 aptSeq 자체가 없음
- **SEARCH_API_MISSING**: DB raw 매칭에는 있지만 응답 랭킹/절단에서 빠짐
- **NAME_MISMATCH**: 자기 이름으로 검색해도 DB raw 매칭 자체에 없음(정규화
  불일치 또는 당시 `take` 상한)
- **UNKNOWN**: 그 외(관측 없음)

## 9. Coverage Results

| 지표 | 수정 전 | 수정 후 |
|---|---|---|
| RECENT_TRADED_APT_COVERAGE(최근 24개월, N=3,403) | 97.91%(3,332) | **99.53%(3,387)** |
| MASTER_MISSING | 16 | 16(불변, 정책상 미수정) |
| NAME_MISMATCH | 5 | **0** |
| SEARCH_API_MISSING | 50 | **0** |
| TRADED_APT_COVERAGE(전체 20년, N=4,905) | (측정 안 함) | 69.36%(3,402) |

전체 20년 수치(69.36%)가 24개월 수치보다 크게 낮은 이유는 **코드 버그가
아니라 데이터 성격**이다: `ApartmentMaster`는 현재 시점 건축물대장/등록 기준
스냅샷(~3,400행, 부산)이고, `ApartmentTradeHistory`는 2006~2026 20년 전체
실거래(재건축/철거로 이제 존재하지 않는 단지 포함)다. 20년 전 거래된 단지가
현재 등록부에 없는 것은 정상이며, 검색 코드로 해결할 수 없다(§16/§29 근거).
그래서 스펙이 지정한 "특히 중요" 지표인 RECENT_TRADED_APT_COVERAGE(24개월)를
출시 readiness 기준으로 채택했고, 이 값은 목표(≥99%) **달성**.

## 10. Missing Categories

수정 후 남은 유일한 카테고리는 MASTER_MISSING(16건, 24개월 기준) —
`ApartmentMaster`에 해당 단지가 아예 없는 진짜 데이터 공백이다. 샘플:

```
26470-226 에스케이드림피아 (연산동)      26710-90 창신빌라 (기장읍 대변리)
26380-2073 대운스카이뷰1차 (하단동)      26110-1 동광맨션 (중앙동4가)
26200-623 궁전그린파크빌라 (영선동2가)   26290-4786 롯데캐슬인피니엘 (문현동)
26230-2116 피렌체 (양정동)               26290-2594 햇살좋은집 (대연동)
26230-4559 아틀리에933 (양정동)          26230-177 보해이브빌 (전포동)
26410-2153 대림포레 (구서동)             26230-2842 가야봄여름가을겨울 (가야동)
26410-253 일번파크맨션에이동 (남산동)    26260-292 삼성빌라 (온천동)
26530-1016 퀀텀펠리스 (주례동)
```

이번 STEP에서는 **임의로 Master row를 생성하지 않았다**(§25 정책 준수) —
목록/범위만 보고, 대량 보정은 별도 승인 STEP 대상.

## 11. Master Mismatch Findings (부가 발견, 이번 STEP 범위 밖 기록)

`Apartment`(legacy 캐시) 테이블에서 별개의 identity 오염을 발견했다: id=399,
`name="해운대경동제이드"`, `dong="우동"`인데 `jibun="974"`,
`totalHouseholds=72`, `approvalDate="1995년"` — 이 값들은 실제로는
"경동"(aptSeq 26350-2)의 스펙이다(진짜 해운대경동제이드는 aptSeq
26350-2206, jibun 763, 2012년, 278세대). `aptSeq=null`이라 이번 STEP이
새로 만든 `/api/apt/[name]/verify`(name+dong 유니크 조회)나 `/api/search`
(ApartmentMaster만 조회) 경로에는 영향이 없음을 확인했으나, 이 legacy row를
읽는 다른 기존 라우트(건축물대장 스펙 조회 등)가 있다면 잘못된 데이터를
보여줄 수 있다 — **이번 STEP에서 수정하지 않음**(원인 조사/데이터 보정은
별도 STEP 권고, §25/§26 대상).

## 12. Name Normalization

`normalizeSearchKeyword()`(`src/lib/search-ranking.ts`): 공백 제거 + 끝
"아파트" 접미사 제거, `scripts/apartment_master_seed.ts`가 `normalizedName`
컬럼을 채울 때 쓴 규칙과 동일하게 맞췄다(상위집합 확장, 기존 매칭 케이스
유지). "아파트"만 입력해 빈 문자열이 되는 edge case는 원래(공백만 제거한)
키워드로 폴백해 `contains: ''`(전체매칭) 사고를 막았다.

## 13. Ranking Rules

`rankApartmentMatches()`(`src/lib/search-ranking.ts`): tier 0(exact) > tier
1(startsWith) > tier 2(contains), 같은 tier 안에서만 `totalHouseholds desc`.
"경동" 검색 실측 결과(수정 후) — exact match 7건(청룡동 642세대 ~ 거제동
49세대)이 항상 최상단, 그 다음 contains 매칭이 세대수 순으로 이어짐. 예전에는
"주례경동리인"(839세대, contains)이 "경동"(72세대, exact)보다 항상 위에
있었다.

## 14. Search-Detail Identity

`/api/search` 응답의 `aptSeq`가 있으면(`ApartmentSearchResult.aptSeq`) 검증
게이트(`/api/apt/[name]/verify?aptSeq=...`)와 상세 URL(`/apt/[name]
?lawdCd=...&dong=...`)까지 그대로 전달된다 — 검색 후보 매칭(카카오 별칭
포함)은 넓어졌지만, 상세로 넘어가는 identity는 항상 `ApartmentMaster`의
canonical 값이다. `SEARCH_DETAIL_IDENTITY_HOTFIX_V2`
(`src/lib/apt-name-match.ts`, 커밋 `d7059a6`)의 로직은 이번 STEP에서 전혀
건드리지 않았다.

## 15. Performance Baseline (수정 전)

| 대상 | 값 |
|---|---|
| `/api/search` warm (대표 쿼리 5종 평균) | 60~190ms(이미 목표 이내 — 코어 검색 자체는 병목 아니었음) |
| `/api/apt/[name]?type=apt&period=12`(검증 게이트, cold, 미캐시) | **5,438ms**(경동, 12개월 MOLIT 순차 호출) |
| 동일(다른 미캐시 단지, 대신롯데캐슬) | 575ms |

## 16. Performance Bottleneck

`/api/search` 자체가 아니라 **검색 결과 선택 → 상세 이동 전 검증 게이트**가
사용자 체감 지연의 실제 원인이었다. `HomeApartmentSearch.tsx`/
`ApartmentQuickSearch.tsx`가 검색어를 고른 직후 `/api/apt/[name]?type=apt
&period=12`를 호출했는데, 이 라우트는 캐시 미스 시 월별 MOLIT API를 최대
12회 순차 호출한다(`src/lib/api-molit.ts` 경유) — 외부 API가 검색 UX
마지막 단계의 지연을 지배하는 구조였다.

## 17. Performance Changes

`/api/apt/[name]/verify`(신규, DB-only) 도입: `ApartmentTradeHistory.
identityKey`(인덱스) 존재 여부 + `Apartment.name_dong`(유니크 인덱스) 존재
시 `ApartmentUnitType` count — 외부 API 호출 0회. `TRADE_HISTORY_DATA_V1`
backfill + `TRADE_CANCELLATION_RESYNC_V1`(같은 세션 이전 STEP, 취소 보정
완료)로 이미 신뢰 가능한 영구 저장본이 있었기에 가능한 대체였다(기존
검증 계약 `hasTrades || hasUnitTypes`와 완전히 동일한 semantics, 데이터
소스만 교체).

## 18. Benchmark After

| 대상 | 수정 전 | 수정 후 |
|---|---|---|
| `/api/apt/[name]/verify`(경동, 이전엔 5,438ms cold) | 5,438ms | **61~102ms**(5회 평균) |
| `/api/apt/[name]/verify`(대신롯데캐슬, 이전엔 575ms) | 575ms | **75~136ms**(5회 평균) |
| `/api/search` warm p50(경동/경동마리나/롯데/해운대/대신롯데캐슬) | 60~190ms | 78~120ms(§목표 이내 유지, take 상한 제거·tier 랭킹·카카오 fallback 추가에도 회귀 없음) |
| `/api/search` warm p95(동일 쿼리셋) | — | 120~166ms |
| `/api/search`(1글자 "가", 서버 no-op) | — | 17~21ms |
| `/api/search`(no-result 쿼리) | — | warm 78~120ms(카카오 fallback도 0건이면 즉시 반환) |

`scripts/benchmark-apartment-search.ts`(신규, HTTP 타이밍 전용, 외부 API
호출 없음)로 재현 가능. cold 값은 Turbopack dev 컴파일 오버헤드를 포함하므로
prod 배포 시 이보다 낮을 것으로 예상(별도 구분, §13 스펙 요구사항 반영).

## 19. Home/Quick/Map Consistency

세 진입점 모두 동일한 `ApartmentAutocomplete` 컴포넌트 + `/api/search`
엔드포인트를 공유함을 코드 감사 + 브라우저 실측(홈, 지도)으로 확인 — "경동
마리나" 검색 시 두 진입점 모두 동일하게 "경동(우동 974, 72세대·1995년 준공,
지도상 명칭: 경동마리나아파트)" 1건을 반환. 빠른검색 모달은 코드 구조상
완전히 같은 컴포넌트를 재사용하므로 별도 확인 없이 동일 결론.

## 20. Mobile QA

375px, 360px에서 브라우저 실측(Chrome 도구): 검색 드롭다운(경동마리나 →
경동 + matchNote 표시), 상세페이지(경동, 84.95㎡, 7억3,500만, 2026.08.10)
전부 가로 스크롤/텍스트 잘림/하단 네비게이션 겹침 없이 정상 렌더링.
"최근 본 단지"에 "경동"과 "해운대경동제이드"가 별개 항목으로 정확히 분리
표시됨(교차 오염 없음, localStorage 기반).

## 21. Desktop QA

852px 데스크톱 폭에서 동일 시나리오(홈 검색 → 드롭다운 → 클릭 → 상세 →
지도 검색 동일 쿼리) 전부 정상. 드롭다운 위치/클릭/네비게이션 이상 없음.

## 22. Tests

신규: `src/lib/search-ranking.test.mjs`(8 tests, `npx tsx --test`) —
§38 A/B/C/D/F/H/J 커버:
- A: exact name found
- B: normalized exact found(아파트 접미사 처리)
- C: partial search returns candidates
- D: exact ranks above partial(household 무관)
- F: 서로 다른 단지명 간 tier 교차 오염 없음
- H: result limit(15)이 있어도 exact match는 절대 잘리지 않음(20개 큰
  partial 후보 속에서도 검증)
- J: no-result

§38 E(경동마리나 검색)/G(같은 aptSeq dedupe)/I(stale request)/K(canonical
aptSeq 상세 전달)는 외부 API·브라우저 상태에 의존해 순수 단위테스트로
모킹하기보다 §2/§19/§14/§20에 기록한 실측(live curl + 브라우저 네트워크
로그 + 화면 캡처)으로 증명했다 — 실측 방식이 이번 STEP의 검증 원칙
("실제 실행한 명령과 결과만 보고")에 더 부합한다고 판단.

기존 회귀 테스트 재실행(변경 없음, 전부 pass):
- `src/lib/apt-name-match.test.ts` 8/8(`SEARCH_DETAIL_IDENTITY_HOTFIX_V2`)
- `scripts/trade-history-logic.test.mjs` 15/15
- `src/lib/api-molit.test.mjs` 6/6

## 23. Known Limitations

- 카카오 별칭 폴백은 "부동산 > 주거시설 > 아파트" 카테고리 + 반경 80m + 유일
  후보 조건을 전부 만족해야 동작한다 — 카카오 POI 자체에 등록 안 된 별칭,
  또는 반경 안에 2개 이상의 `ApartmentMaster` row가 있는 밀집 지역의 별칭은
  여전히 못 찾는다(추측으로 하나를 고르지 않는다는 원칙을 지키기 위한
  의도적 제한).
- `ApartmentMaster.totalHouseholds`(경동 사례에서 72로 관측, 실제 892
  추정) 등 registry 필드 자체의 데이터 품질 문제는 이번 STEP에서 손대지
  않았다(§11, §25 데이터 보정 권고 참고).
- MASTER_MISSING 16건(24개월)/1,503건(전체 20년)은 코드로 해결 불가 —
  Master 데이터 자체의 보강이 필요하다.
- `Apartment`(legacy 캐시) 테이블의 "해운대경동제이드" identity 오염(§11)은
  이번 STEP 범위 밖으로 남겨뒀다 — 해당 legacy row를 읽는 다른 라우트에
  영향이 있는지는 별도 조사 필요.
- 카카오 폴백은 서버 프로세스 재시작 시 in-memory 캐시가 초기화된다(영구
  캐시 아님) — 배포마다 각 별칭 키워드에 대해 최초 1회씩 다시 호출.

## 24. Index Recommendation

**SEARCH_INDEX_RECOMMENDATION = NO**(이번 STEP 기준). `ApartmentMaster`가
부산 전용 ~3,400행 규모라 `contains` 전체 스캔도 실측 100ms 내외로 목표
이내다. `take:50` 제거 후에도 성능 저하 관측되지 않았다(§18). 데이터가
전국 규모로 크게 확장되면(수만 행 이상) `pg_trgm` GIN 인덱스 도입을
재검토할 근거가 생기지만, 현재 규모에서는 불필요한 인덱스 추가로 판단—
schema 변경 자체가 이번 STEP 범위 밖이기도 하다.

## 25. Data Correction Recommendation

1. `ApartmentMaster`(aptSeq=26350-2, "경동") `totalHouseholds=72`는
   실거래 규모(981건, 최고 19층, 191㎡ 대형 평형)와 명백히 불일치 —
   건축물대장 재조회로 실제 세대수(892 추정) 검증 후 보정 필요(Production
   write, 별도 승인 STEP).
2. `Apartment`(legacy, id=399, "해운대경동제이드") jibun/totalHouseholds/
   approvalDate가 실제로는 "경동"의 값과 동일함 — 원인(과거 매칭 버그로
   추정) 조사 후 보정 필요(별도 승인 STEP, §11).
3. MASTER_MISSING 16건(24개월 기준, §10 목록)은 정식 건축물대장/등록
   데이터로 `ApartmentMaster`에 추가하는 별도 backfill STEP 권고.

## 26. Launch Readiness Implication

RECENT_TRADED_APT_COVERAGE(최근 24개월) 99.53%로 스펙 목표(≥99%) 달성,
SEARCH_DETAIL_IDENTITY_MISMATCH 0건, 성능 목표(warm p50<300ms, p95<800ms)
전부 달성, 외부 MOLIT 의존성이 검색 핵심 경로(검색+검증)에서 제거됐다.
**단, MASTER_MISSING 16건과 §11의 legacy identity 오염은 이번 STEP
완료로 자동 해소되지 않는다** — 출시 전 최종 게이트로 §10/§25 항목의
후속 STEP(사용자 승인 필요) 완료 여부를 별도 확인 권고.

## 27. Next Step

1. `MASTER_DATA_COVERAGE_FIX_V1`(§10/§25-1,3, Master 데이터 보정, 승인 필요)
2. `LEGACY_APARTMENT_IDENTITY_AUDIT`(§11/§25-2, `Apartment` 캐시 테이블
   전수 오염 감사, 승인 필요)
3. `TRADE_HISTORY_READ_MIGRATION_V1`(기존 계획, `trade-history-read.ts`를
   실제 라이브 통계 API가 사용하도록 전환 — 이번 STEP의 `/verify` 엔드포인트가
   같은 방향의 선례)
