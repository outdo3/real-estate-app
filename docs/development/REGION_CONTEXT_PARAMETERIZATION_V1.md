# E-JIP REGION CONTEXT PARAMETERIZATION V1

서울·경기 확장을 막던 **지역 하드코딩**을 제거한다. 부산 Production 동작은 그대로 유지하고, 서울·경기 데이터는 공개하지 않는다.

- 날짜: 2026-09-16 (KST)
- 기준 커밋: `5c75e5d`
- 범위: peer-context 시도 파라미터화 + 강남구(11680) runtime fallback 제거. **DB write 0, schema 0, region enable 0, score formula 0.**
- 선행 근거: `SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1` §11 STEP 0 "peer context 시도 파라미터화 · 서울 강남구 기본값 제거"

---

## 0. 결론 요약

**판정: PASS**

1. **peer pool의 `sido: '부산'` 고정을 제거했다.** 대상 단지의 시도를 호출부가 **필수 인자**로 넘긴다. 기본값을 두지 않았으므로 빠뜨리면 컴파일이 깨진다 — 실제로 이 설계가 몰랐던 네 번째 호출부(진단 스크립트)까지 잡아냈다.
2. **강남구(11680) runtime fallback 7곳을 전부 제거했다.** 라우트 2곳, 상세 클라이언트 3곳, 카드/표 컴포넌트 2곳.
3. **지역을 모르면 어떤 지역으로도 fallback하지 않는다.** 실거래 라우트는 `regionUnresolved: true`와 빈 거래 배열을, 단지정보 라우트는 `info: null`을 돌려준다. 잘못된 지역 데이터보다 데이터 없음이 우선이다.
4. **부산 점수는 한 자리도 바뀌지 않았다** — 대표 8개 단지에서 overallScore·peer level·percentile·comparisonCount 전부 동일(§8).
5. **runtime dangerous hardcode = 0.** 남은 `부산`/`11680` 문자열은 전부 주석·표시용 매핑·의도된 부산 출시 스코프 가드다(§14).

---

## 1. 하드코딩 감사 결과

| 분류 | 내용 | 이번 STEP |
|---|---|---|
| **C — dangerous runtime** | `peer-context.ts` `SIDO_VALUE='부산'` (peer pool) | **수정** |
| **D — region fallback** | 11680 기본값 7곳 | **수정** |
| A — 의도된 부산 출시 스코프 | `report/region-scope.ts`, `daily-report.ts`, `region-aggregate.ts`, `region-read.ts`, `InvalidScope.tsx`, `sitemap-scope.ts`, `stats/large-complex` | 유지 |
| B — 표시 전용 | `presale-region.ts`, `redevelopment/labels.ts`, `redevelopment/service.ts`, `report-region-seo.ts` CITY_CRUMB, `RegionContext` 축약명 매핑 | 유지 |
| E — 주석·예시·전국 목록 | `api-molit.ts` 주석, `ai-search.ts` 주석, `regions.ts`(전국 시군구 목록) | 유지 |

`stats/large-complex`는 위험 하드코딩이 아니다 — 비부산 시도에 대해 조용히 빈 결과를 주지 않고 명시적으로 `UNSUPPORTED`를 반환한다(정직한 스코프 표현). 서울 데이터가 들어오면 그때 확장할 항목이다(§15 FOLLOW_UP).

---

## 2. Root cause — peer context

`src/lib/apartment-score/peer-context.ts:38`

```
const SIDO_VALUE = '부산';
...
prisma.apartmentMaster.findMany({ where: { sido: SIDO_VALUE, ... } })
const PEER_UNIVERSE_CACHE_KEY = 'score-v2-peer-universe:busan';   // 캐시 키도 고정
```

호출 경로 4곳이 모두 대상 단지의 `ApartmentMaster`를 이미 읽고 있었지만 **`sido`를 select하지 않았다**:

| 호출부 | 경로 |
|---|---|
| `src/app/api/apt/[name]/score/route.ts` | 단지 상세 Score |
| `src/lib/report/apt-read.ts` | 한장 리포트(단지) |
| `src/lib/report/compare-read.ts` | 비교 |
| `scripts/apartment-score/ejip-score-v2-phase2-crosscheck.ts` | 진단(cross-check) |

서울 단지를 열면 **부산 단지들과 비교한 percentile**이 사실처럼 표시됐을 것이다.

---

## 3. Region context model

새 DB 컬럼을 만들지 않았다. 이미 존재하는 `ApartmentMaster.sido`를 select에 추가해 그대로 전달한다.

- 우선순위: canonical `aptSeq` → `ApartmentMaster` 행 → 그 행의 `sido`
- 문자열 추론·fuzzy 매칭 **없음**. lawdCd에서 시도를 유추하지도 않는다(그 매핑이 필요해지면 별도 region registry STEP에서).
- 별도 resolver helper를 만들지 않았다 — 값이 이미 canonical 레코드에 있어서 새 추상화가 불필요했다(§7 "이미 있으면 재사용").

---

## 4. Sido 파라미터화

```ts
// before
export async function getPeerContext(target: PeerContextTarget): Promise<PeerContext>

// after
export async function getPeerContext(
  target: PeerContextTarget,
  regionSido: string | null,
  deps?: PeerContextDeps,        // 테스트 전용 universe 주입
): Promise<PeerContext>
```

- `regionSido`는 **필수 위치 인자**다. `sido ?? '부산'` 같은 silent fallback이 없고, 빠뜨리면 타입 에러가 난다.
- `buildPeerUniverse(sido)`가 그 시도로 조회하고, 캐시 키도 `score-v2-peer-universe:${sido}`로 분리된다 — 지역이 섞인 universe가 캐시에 남지 않는다.
- 부산 호출부는 실제 부산 `sido` 값을 넘기므로 결과가 이전과 동일하다(§8 parity).

---

## 5. 지역 미확정 정책 (no fallback)

```
sido 없음        → UNAVAILABLE_PEER_CONTEXT (universe 조회 자체를 하지 않음)
lawdCd 확정 실패 → regionUnresolved: true + 빈 거래 / info: null
```

`/api/apt/[name]`은 URL → DB 캐시 → 지오코딩 순으로 지역을 확정하고, **전부 실패하면** 이전에는 `lawdCd = lawdCd || '11680'`으로 강남구 실거래를 채웠다. 이제는:

```json
{ "trades": [], "apiError": "단지의 지역(시군구)을 확인하지 못해 실거래를 조회하지 못했습니다.",
  "lawdCd": null, "regionUnresolved": true, "partial": false, ... }
```

`apiError`(기존 실패 채널)를 쓰므로 UI가 이것을 **"거래 0건"으로 읽지 않는다** — FAILED와 ZERO를 구분하는 기존 계약 그대로다.

---

## 6. 제거한 강남구 fallback 7곳

| # | 위치 | 이전 | 이후 |
|---|---|---|---|
| 1 | `api/apt/[name]/route.ts:91` | `lawdCd \|\| '11680'` | `regionUnresolved` 응답 |
| 2 | `api/apt/[name]/info/route.ts:17` | `get('lawdCd') \|\| '11680'` | `info: null` + `regionUnresolved` |
| 3 | `apt/[name]/apt-client.tsx:116` | `useState('11680')` | `useState('')` |
| 4 | `apt-client.tsx:204` | `queryLawdCd \|\| '11680'` | `queryLawdCd \|\| ''` |
| 5 | `apt-client.tsx:317` | `urlLawdCd \|\| '11680'` | `urlLawdCd \|\| ''` |
| 6 | `components/RankCard.tsx:41` | `: '11680'` | 링크에서 `lawdCd` 생략 |
| 7 | `components/TableList.tsx:24` | `: '11680'` | 링크에서 `lawdCd` 생략 |

6·7은 `id`(`type-lawdCd-dealYmd-index`) 파싱이 실패했을 때의 fallback이었다. 잘못된 지역을 넘기느니 **아예 넘기지 않고** 상세 라우트가 DB/지오코딩으로 직접 확정하게 둔다.

부산 운영 경로(지도·검색·리포트 링크)는 항상 `lawdCd`를 URL에 담아 보내므로 이 변경의 영향을 받지 않는다.

---

## 7. Score 안전성

- Score 공식·가중치·eligibility·정규화 **변경 0**. 부산 보정 곡선 그대로.
- `PeerLevel` enum(`SIGUNGU_DECADE_SIZE` / `SIGUNGU_DECADE` / `DECADE_BUSAN` / `BUSAN_ALL`)도 **변경하지 않았다** — API 계약(`client-types.ts`)이고, UI는 이 문자열을 렌더링하지 않는다(`basis.sigungu`만 표시). 서울 공개 전 이름 정리는 FOLLOW_UP(§15).
- 바뀐 것은 오직 **어느 pool과 비교하는가**다. 부산 단지는 부산 pool 그대로라 값이 동일하다.

---

## 8. 부산 parity (Production 실측)

배포 전 Production(구 코드)에서 대표 8개 단지의 Score·peer를 그대로 기록했다.

| aptSeq | 단지 | score | peer level | percentile | comparisonCount | basis |
|---|---|---|---|---|---|---|
| 26140-1321 | 힐스테이트이진베이시티 | 41 | SIGUNGU_DECADE | 4.2 | 12 | 서구 |
| 26140-1361 | e편한세상송도더퍼스트비치 | 56 | SIGUNGU_DECADE | 29.2 | 12 | 서구 |
| 26380-1617 | 다대동롯데캐슬몰운대 | 61 | SIGUNGU_DECADE_SIZE | 73.3 | 15 | 사하구 |
| 26380-130 | 가락타운3 | 57 | SIGUNGU_DECADE_SIZE | 76.1 | 46 | 사하구 |
| 26350-2093 | 더샵센텀파크1차 | 69 | SIGUNGU_DECADE_SIZE | 87.9 | 29 | 해운대구 |
| 26350-2285 | 해운대힐스테이트위브 | 50 | SIGUNGU_DECADE_SIZE | 18.0 | 25 | 해운대구 |
| 26470-3048 | 레이카운티(2단지) | 74 | SIGUNGU_DECADE_SIZE | 72.7 | 11 | 연제구 |
| 26470-3049 | 레이카운티(3단지) | 74 | SIGUNGU_DECADE_SIZE | 72.7 | 11 | 연제구 |

배포 후 동일 비교 결과는 §12에 기록한다.

---

## 9. 서울·경기 fixture 검증 (DB write 없음)

`src/lib/apartment-score/region-context.test.ts` — universe 로더를 주입해 **어느 시도로 조회가 나가는지**를 직접 확인한다.

| 케이스 | 확인 |
|---|---|
| 서울 강남구 11680 / 송파구 11710 | `asked === ['서울']`, 부산 조회 0 |
| 경기 성남시 분당구 41135 | `asked === ['경기']`, `basis.sigungu === '성남시 분당구'`(시+일반구 보존) |
| 경기 김포시 41570 | `asked === ['경기']` |
| 서울 pool vs 부산 pool | 부산 pool을 썼다면 하위권이 될 점수가 서울 pool 기준 상위권으로 나옴 — pool 오염이 없음을 값으로 증명 |
| sido 없음(`null`/`''`/공백) | `available=false`, `percentile=null`, **universe 조회 자체를 하지 않음** |

---

## 10. 테스트 · 빌드

```
npx tsx --test src/lib/apartment-score/region-context.test.ts   pass 14   fail 0
npx tsx --test "src/**/*.test.ts" "src/**/*.test.mjs"           pass 2193 fail 0
npx eslint (변경 11개 파일)                                       0 errors
                                                                (apt-client.tsx 경고 2건은 HEAD에도 동일하게 존재 — 이번 변경과 무관)
npx tsc --noEmit                                                src/ 오류 0
                                                                기존 25건은 scripts/·tmp/ → FAIL_EXISTING_SCRIPT_ERRORS
npm run build                                                   Compiled successfully in 3.3s
```

필수 인자 설계가 실제로 작동한 사례: 처음엔 tsc 오류가 25 → 26으로 늘었고, 그 1건이 내가 놓친 네 번째 호출부(`ejip-score-v2-phase2-crosscheck.ts`)였다. 수정 후 25로 복귀.

---

## 12. Production QA (배포 후)

커밋 `c7aec0e` push → Vercel Production 배포 완료.

### 부산 parity — 8/8 완전 동일

배포 전(§8) 기록과 배포 후 응답을 `overallScore · peerAvailable · peerLevel · peerPercentile · peerCount · peerComparisonCount · peerConfidence · basis.sigungu` **8개 필드 전부** 비교:

| aptSeq | 단지 | score | level | percentile | cmp | basis | 결과 |
|---|---|---|---|---|---|---|---|
| 26140-1321 | 힐스테이트이진베이시티 | 41 | SIGUNGU_DECADE | 4.2 | 12 | 서구 | **IDENTICAL** |
| 26140-1361 | e편한세상송도더퍼스트비치 | 56 | SIGUNGU_DECADE | 29.2 | 12 | 서구 | **IDENTICAL** |
| 26380-1617 | 다대동롯데캐슬몰운대 | 61 | SIGUNGU_DECADE_SIZE | 73.3 | 15 | 사하구 | **IDENTICAL** |
| 26380-130 | 가락타운3 | 57 | SIGUNGU_DECADE_SIZE | 76.1 | 46 | 사하구 | **IDENTICAL** |
| 26350-2093 | 더샵센텀파크1차 | 69 | SIGUNGU_DECADE_SIZE | 87.9 | 29 | 해운대구 | **IDENTICAL** |
| 26350-2285 | 해운대힐스테이트위브 | 50 | SIGUNGU_DECADE_SIZE | 18.0 | 25 | 해운대구 | **IDENTICAL** |
| 26470-3048 | 레이카운티(2단지) | 74 | SIGUNGU_DECADE_SIZE | 72.7 | 11 | 연제구 | **IDENTICAL** |
| 26470-3049 | 레이카운티(3단지) | 74 | SIGUNGU_DECADE_SIZE | 72.7 | 11 | 연제구 | **IDENTICAL** |

**BUSAN PARITY: PASS** — Score 값이 한 자리도 바뀌지 않았다.

### no-fallback 동작 실측

| 시나리오 | 결과 |
|---|---|
| 부산 단지 + `lawdCd` 있음 | `trades=125 lawdCd=26140 regionUnresolved=false` |
| **부산 단지 + `lawdCd` 없음** | `trades=125 lawdCd=26140 regionUnresolved=false` — DB/지오코딩 확정 경로가 그대로 동작 |
| **확정 불가 이름 + `lawdCd` 없음** | `trades=0 lawdCd=null regionUnresolved=true apiError=set` — 이전에는 **강남구 거래**가 나왔다 |
| info + `lawdCd` 없음 | `info=null regionUnresolved=true` — 이전에는 **강남구 건축물대장**이 나왔다 |
| info + 부산 `lawdCd` | `infoKeys=5 regionUnresolved=false` |

두 번째 행이 핵심이다 — **fallback만 없앴고 정상적인 지역 확정(URL → DB 캐시 → 지오코딩)은 그대로 살아 있다.**

### 페이지·라우트 상태

| 경로 | http | 응답시간 | "강남구" 문자열 |
|---|---|---|---|
| `/report/apt/26140-1361` | 200 | 2.40s | 없음 |
| `/report/apt/26350-2093` | 200 | 2.52s | 없음 |
| `/report/compare?a=…&b=…` | 200 | 0.32s | 없음 |
| `/apt/e편한세상송도더퍼스트비치` | 200 | 0.11s | 없음 |
| `/` · `/map` · `/stats` | 200 | 0.08~0.46s | 없음 |

5xx 0건. `error_logs` 최근 2시간/24시간 **0건**(최신 항목은 2026-09-11, 배포 5일 전).

서울·경기 페이지는 공개·색인하지 않았다.

---

## 14. 남은 하드코딩 재스캔

| 분류 | 위치 | 비고 |
|---|---|---|
| **BLOCKER** | — | **0** |
| EXPECTED(부산 출시 스코프) | `report/region-scope.ts`, `daily-report.ts`, `region-aggregate.ts`, `region-read.ts`, `InvalidScope.tsx`, `sitemap-scope.ts` | 서울/경기를 리포트·사이트맵에 넣지 않기 위한 의도된 가드 |
| FOLLOW_UP | `stats/large-complex/route.ts` (`sido:'부산'`, `UNSUPPORTED` 응답) | 서울 데이터 적재 시 확장 |
| FOLLOW_UP | `PeerLevel` enum의 `DECADE_BUSAN`/`BUSAN_ALL` 이름 | 내부 값(비노출). 서울 공개 전 이름 정리 |
| FOLLOW_UP | `RegionContext` `FALLBACK_REGION`(부산광역시 전체) | GPS 실패 시 UX 기본값. 출시 범위와 일치 — 확장 시 재검토 |
| DISPLAY_ONLY | `presale-region.ts`, `redevelopment/labels.ts`, `redevelopment/service.ts`, `report-region-seo.ts` | 시도명 축약 표시 매핑 |
| TEST_ONLY | 각 `*.test.*` fixture | 유지 |
| 주석 | `api-molit.ts`, `ai-search.ts`, 신규 설명 주석 | 코드 아님 |

`11680`은 런타임 코드에서 **완전히 사라졌고**, 남은 것은 전부 주석이다(테스트가 이를 고정한다).

---

## 15. 하지 않은 것

- DB INSERT/UPDATE/DELETE 0, migration 0, schema 0.
- 서울·경기 데이터 수집 0, region enable 0, sitemap 추가 0.
- Score formula·가중치·학교 재보정 0. cancellation repair 0.
- route semantics 변경 0(응답에 `regionUnresolved` 필드만 추가 — 기존 필드 의미 불변).
- `PeerLevel` enum·`client-types.ts` 계약 변경 0.
- search/map/report의 지역 해석 로직 변경 0 — 전파만 고쳤다.

---

## 16. 남은 아키텍처 갭 (서울/경기 공개 전)

- **Score 보정**: 곡선이 부산 실측 기반이다. pool은 이제 지역별로 맞지만 곡선 자체는 별도 STEP(`SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1` §11).
- **peer level 이름**이 `BUSAN_*`이다(내부 값, 비노출).
- **리포트 스코프**가 부산 16코드 allowlist이고 `/report/city/busan` 경로가 고정이다.
- **통계 `'26'` prefix DB-first 분기**, cron 기본 lawdCd, 학교 교육청 코드 C10, 오피스텔 스크립트가 여전히 부산 고정.
- **경기 시+일반구 계층**은 `REGION_DATA`·통계 메타·지역 모달·리포트 스코프 타입에서 아직 불완전(peer context는 이번에 보존됨).
