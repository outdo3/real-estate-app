# SELLFLOW_DATA_API_V1 (+V1.1) — E-JIP -> SELLFLOW 읽기 전용 데이터 API

- 브랜치 `feat/sellflow-data-api-v1`(기준 `origin/main` `0a7f1f9`). 로컬 변경만 — push/배포/DB 쓰기/스키마·env 변경 없음.
- 구현: `src/lib/integrations/sellflow/{contract,service,handler,prisma-db,route-deps}.ts`, `src/app/api/integrations/sellflow/v1/buildings/...`
- 샘플 JSON: [`sellflow-data-api-v1-samples.json`](./sellflow-data-api-v1-samples.json) (전부 모의 값)
- **Production SELLFLOW 연결은 활성화하지 않는다.** 키/활성화 환경변수를 만들기 전까지 API는 503으로 닫혀 있다. Preview도 아직 배포하지 않았다.

### V1.1 변경 요약

1. **Kakao 좌표 제거** — SELLFLOW 응답 어디에도 `latitude`/`longitude`가 없다(검색·거래·요약·샘플 JSON·테스트). 이집 내부 master DB와 지도/nearby 기능은 그대로다.
2. **freshness와 coverage 분리** — `verification.freshnessStatus`(최근 수집 상태)와 `verification.coverageStatus`(요청 기간 전체의 검증 범위)를 따로 표현한다. 이전 V1의 단일 `freshness.status`(`PARTIAL_COVERAGE` 등)는 폐기됐다(배포된 적 없음).
3. **source 메타데이터**(`sources`)와 **콘텐츠 사용 조건 플래그**(`contentGuidance`) 추가.
4. 이용 조건 검토 결과 반영(§9) — 이용 조건 blocker 해소.

## 1. 기존 구조 조사 (STEP 1)

| 항목 | 아파트 | 오피스텔 |
| --- | --- | --- |
| Master | `apartment_masters` (11,474행, 전부 `aptSeq` 보유) | `officetel_masters` (5,056행) |
| 정식 식별자 | `aptSeq`(MOLIT, unique). 내부 PK `id`는 master 재구축 시 바뀔 수 있다고 스키마가 명시 | `id`(serial) / `canonicalKey`(unique). 이름만으로 식별하지 않음 |
| 매매 거래 | `apartment_trade_histories` (285만 행) | `officetel_trade_histories` (89,335행) |
| 전월세 거래 | `apartment_rent_histories` — `dealType` = `jeonse`/`wolse` (적재 시점 결정) | `officetel_rent_histories` — `dealType` 없음, `monthlyRent > 0`이면 월세 |
| Master 연결 | **FK 없음**. 거래의 `aptSeq`로 연결(거래 모두 aptSeq 보유) | 거래 `officetelMasterId`(FK, nullable) + 건물 단위 `canonicalKey` |
| natural key | `(groupKey, dealAmount, dealDate, floor, occurrenceIndex)` / 전월세 `(groupKey, deposit, monthlyRent, dealDate, floor, occurrenceIndex)` | `(canonicalKey, dealDate, exclusiveArea, dealAmount, floor, occurrenceIndex)` / 전월세 동일 구조 |
| 취소 | 매매만 `dealCanceled`/`cancelDate`(`YY.MM.DD`). 전월세 원천에 취소 개념 없음 | 동일. 매매 취소는 2020-01부터만 제공(그 이전 `false`는 검증된 값이 아님) |
| 정정 | 취소는 recheck가 `dealCanceled=true`로 갱신. 그 외 정정은 새 natural key 행으로 들어옴 | 동일(첫 recheck 감사: 42건이 취소·재등록 패턴) |
| Master 미연결 | 해당 없음 | 같은 지번에 master가 2개 이상이면 거래를 어느 master에도 연결하지 않음(연결 행 0건 실측) |
| 최신성 | 거래 `sourceFetchedAt` + `sync_coverage_cells.verifiedAt`(구/월 셀) | `sourceFetchedAt` + `officetel_sync_cells.verifiedAt` |
| 면적 | `exclusiveArea`(numeric, 원본 ㎡) — 평형 없음 | 동일, `representativePyeong` 사용 안 함 |

### 기존 API 재사용 판정

| API | 판정 | 이유 |
| --- | --- | --- |
| `/api/officetel/nearby` | **PARTIAL_REUSE (원칙·로직만)** | 좌표 반경·오피스텔 전용·master당 3건 요약·`x-api-key`라 건물 검색/기간 조회/아파트/통계에 맞지 않는다. 인증 fail-closed 원칙, 귀속(attribution) 의미, 건물 단위 history key 규칙만 따랐다. 코드는 건드리지 않았다 |
| `/api/officetel/[id]/transactions`, `/api/apt/[name]`, `/api/transactions` | REUSE 불가 | 사용자(공개)용 — 인증 없음, 화면용 가공, 이름 기반 조회 경로 포함 |
| `/api/presales/[id]/nearby-market` | REUSE 불가 | 아파트·분양 공고 전용 |

**결론: `NEW_API_REQUIRED`.** 기존 공개 API는 바꾸지 않았다.

## 2. Endpoints (STEP 3, 10)

Base: `https://<E-JIP host>/api/integrations/sellflow/v1` — 모두 `GET`, JSON, `Authorization: Bearer <SELLFLOW_DATA_API_KEY>`.

### 2.1 `GET /buildings/search`

| 파라미터 | 필수 | 설명 |
| --- | --- | --- |
| `lawdCd` | 예 | 시군구 코드 5자리. 지역 없는 검색은 400 |
| `q` | `q` 또는 `dong` 중 하나 | 건물명 2~40자. 공백·후행 "아파트/오피스텔" 제거 후 부분 일치 |
| `dong` | 〃 | 법정동 이름 정확 일치(≤20자) |
| `propertyType` | 아니오 | `apartment` \| `officetel` \| `all`(기본) |
| `limit` | 아니오 | 1~20, 기본 10 |

정렬: 이름 정확 일치 → 접두 일치 → 부분 일치 → 이름순. 유형별 후보 60건을 넘으면 `truncated: true`. 알 수 없는 파라미터는 400.

### 2.2 `GET /buildings/{masterId}/transactions`

| 파라미터 | 기본 | 설명 |
| --- | --- | --- |
| `transactionType` | `sale` | `sale` \| `jeonse` \| `wolse` (한 번에 하나) |
| `fromMonth`, `toMonth` | 최근 12개월(KST 현재 월 포함) | `YYYY-MM`. 최대 **36개월**(양 끝 포함), `toMonth` ≤ 현재 월, `fromMonth ≥ 2006-01` |
| `minArea`, `maxArea` | 없음 | 전용면적 ㎡ 범위(0 초과 ≤1000). 반올림하지 않고 원본 값과 비교 |
| `includeCanceled` | `false` | 매매에서만. 전월세에 `true`면 400 |
| `page`, `pageSize` | 1, 50 | `page` 1~50, `pageSize` 1~100 → 조건당 최대 5,000행 |

정렬: 거래일 내림차순. `pagination`: `page, pageSize, totalItems, totalPages, hasMore`.

### 2.3 `GET /buildings/{masterId}/summary`

`transactionType`, `fromMonth`, `toMonth`, `minArea`, `maxArea` — 2.2와 같은 의미·제한. `includeCanceled`는 지원하지 않는다(통계는 항상 취소 제외, 보내면 400). 조건에 맞는 거래가 5,000행을 넘으면 `400 RANGE_TOO_LARGE`.

### masterId

- 아파트 `apt-{aptSeq}` (예: `apt-26350-2093`) — MOLIT 정식 식별자 기반이라 master 재구축에도 유지된다.
- 오피스텔 `offi-{id}` — master 행의 숫자 id. **master를 재생성하면 바뀔 수 있으므로** SELLFLOW는 장기 보관 키로만 쓰지 말고 주소(`lawdCd`+`dong`+`jibun`)와 함께 저장해 재검색 가능하게 한다.
- 형식 오류 400 `INVALID_MASTER_ID`, 없음 404 `MASTER_NOT_FOUND`.

## 3. 응답 스키마 (STEP 4)

envelope — 성공 `{ success: true, apiVersion: "v1", requestId, asOf, data }`, 실패 `{ success: false, apiVersion, requestId, error: { code, message } }`. `X-Request-Id` 헤더에도 같은 값. `asOf`는 서버가 응답을 만든 시각(ISO).

### building

| 필드 | 설명 |
| --- | --- |
| `masterId`, `propertyType` | 위 형식 / `apartment` \| `officetel` |
| `name` | 건물명. 원천에 이름이 없는 오피스텔 master(약 7.7%)는 **지어내지 않고 `null`** |
| `masterMatchStatus`, `unresolvedReason` | §4.1 |
| `location` | `lawdCd, sigungu, dong, jibun, buildingDong, roadAddress, jibunAddress`. **좌표(위·경도)는 없다.** |
| `buildYear`, `unitCount`, `unitCountBasis` | 아파트 `households`(세대), 오피스텔 `ho`(호). 두 단위를 같은 말로 쓰지 않는다 |

### transaction item

`propertyType, masterId, masterMatchStatus("MATCHED"), transactionType, dealDate(YYYY-MM-DD), price, deposit, monthlyRent, exclusiveArea, floor, canceled, cancelDate, cancellationCoverage, contractType, sourceFetchedAt`

- 금액 단위 **만원**. 매매는 `price`만, 전월세는 `deposit`/`monthlyRent`만 채운다. 전세의 `monthlyRent: 0`은 검증된 실제 0이다.
- `exclusiveArea`는 원본 ㎡(예 `84.6389`). **평형은 제공하지 않는다**(Unit Master protection).
- `contractType`: 전월세 `신규`/`갱신`/null — 갱신 계약을 신규 시세처럼 서술하지 않도록 싣는다.
- **제공하지 않는 것**: 내부 PK, `canonicalKey`, `occurrenceIndex`, `rawUid`, 호실/동, 사용자·세션 정보, 좌표. 테스트로 검증한다.

### 공통 메타 (transactions / summary)

| 필드 | 설명 |
| --- | --- |
| `verification` | §4.4 — `freshnessStatus`, `coverageStatus`와 근거 |
| `sources` | §4.6 — 출처 메타데이터 |
| `resultState` | §4.2 |
| `contentGuidance` | (summary만) §5.3 |

## 4. 데이터 신뢰성 규칙 (STEP 5)

### 4.1 masterMatchStatus

| 값 | 의미 |
| --- | --- |
| `MATCHED` | 거래가 이 master에 확정 연결된다(아파트: aptSeq 일치, 오피스텔: 같은 지번에 master가 정확히 1건) |
| `UNRESOLVED` | 오피스텔이 같은 지번에 여러 동으로 등록돼(`MULTI_MASTER_ADDRESS`) 원천이 동을 구분하지 않는다. 또는 거래 이력 키를 만들 수 없다(`NO_HISTORY_KEY`) |

`UNRESOLVED` master의 `/transactions`·`/summary`는 **거래를 읽지 않고** `resultState: "UNATTRIBUTED_AT_ADDRESS"`, 빈 `items`, `unattributed.unattributedAtAddressCount`(같은 주소의 미연결 거래 수)만 준다. 확정되지 않은 거래를 특정 오피스텔의 거래로 내보내지 않는다.

### 4.2 resultState — 0건과 실패의 구분

| 값 | 뜻 |
| --- | --- |
| `HAS_DATA` | 조건에 맞는 거래가 있다 |
| `NO_TRANSACTIONS_VERIFIED` | 요청 기간의 **모든 달이 검증**(`coverageStatus=COMPLETE`)됐고 조건에 맞는 거래가 없다 — 신뢰할 수 있는 0 |
| `NO_TRANSACTIONS_UNVERIFIED` | 거래는 없지만 일부/전체 달이 검증되지 않았다 — "없다"고 단정하지 않는다 |
| `UNATTRIBUTED_AT_ADDRESS` | 거래는 있으나 동 구분 불가로 귀속하지 않았다 — **거래 없음이 아니다** |

데이터 조회 실패는 위 어느 값도 아니다 — **HTTP 5xx**로만 나간다. 실패를 빈 결과로 바꾸지 않는다. `resultState`는 `verification`과 별개로 유지한다(0건의 의미를 한 값으로 못 박기 위해).

### 4.3 취소

- 매매는 기본으로 **취소 거래 제외**. `includeCanceled=true`면 `canceled: true` + `cancelDate`(ISO)가 붙는다. 통계는 항상 제외하며 `quality.canceledExcludedCount`로 제외 건수를 알린다.
- 전월세 원천에는 취소 개념이 없다 → `canceled: null`, `cancellationCoverage: "NOT_PROVIDED_BY_SOURCE"`. 매매도 2020-01 이전은 원천이 취소를 제공하지 않아 `false`를 검증된 값으로 쓸 수 없으므로 `canceled: null`.
- 오피스텔 매매는 등기일이 없어 취소 신뢰가 제한적이다. 지연 취소는 주간 recheck가 반영하므로 `canceled:false`는 "마지막 확인 시점 기준"이다.

### 4.4 verification — freshness와 coverage 분리

```
verification: {
  freshnessStatus: FRESH | STALE | UNVERIFIED,
  coverageStatus:  COMPLETE | PARTIAL | UNVERIFIED,
  recent:   { months, monthsVerified, oldestVerifiedAt, newestVerifiedAt },
  coverage: { monthsRequested, monthsVerified, unverifiedMonths, oldestVerifiedAt, newestVerifiedAt },
  freshWithinHours: 192
}
```

두 값은 다른 질문에 답한다. **요청 기간이나 거래 건수와 무관하게** freshness는 "이 지역·데이터셋의 최근 수집이 정상인가"만 본다.

| 필드 | 판정 |
| --- | --- |
| `freshnessStatus` | 최근 3개월(현재 월 + 앞 2개월, KST)의 sync 검증 중 **가장 최근** 검증이 192시간(8일) 이내면 `FRESH`, 그보다 오래면 `STALE`, 최근 달 검증이 하나도 없으면 `UNVERIFIED` |
| `coverageStatus` | 요청 기간의 **모든 달**이 검증되면 `COMPLETE`, 일부면 `PARTIAL`, 없으면 `UNVERIFIED`. 미검증 달은 `coverage.unverifiedMonths`로 나열 |

- 과거 달에 개별 sync 셀이 없는 것은 **최신성 실패가 아니다** — `coverageStatus=PARTIAL`로만 표현된다. 최근 달이 정상이면 `FRESH` + `PARTIAL`이 동시에 나온다.
- 거래 0건이어도 최근 달 sync가 정상이면 `FRESH`다(`STALE`로 오판하지 않음).
- `freshnessStatus`는 요청 기간의 거래가 얼마나 최신인지가 아니라 **파이프라인 상태**다. 과거 기간을 조회해도 같다.
- 판정에 가장 최근 검증을 쓰는 이유: 아파트 전월세 셀은 오래된 순으로 돌려가며 검증돼 달마다 검증 시각이 크게 다르다(실측 9/6~10/24). 가장 오래된 달 기준이면 정상 파이프라인도 `STALE`로 보인다. 달별 나이는 `recent.oldestVerifiedAt`에 그대로 남는다.
- 거래별 `sourceFetchedAt`은 "이 행이 원천에서 마지막으로 확인된 시각"이다. 최초 적재분은 2026-09-04~05 스냅샷 시각이 남아 있을 수 있다.

**현재 운영 상태(실DB 읽기 스모크, 2026-10-25):**

| 데이터셋 | freshness | coverage(12개월 창) | 비고 |
| --- | --- | --- | --- |
| 오피스텔 매매 | FRESH | PARTIAL (8/12) | 최근 3/3 달 검증 |
| 오피스텔 전월세 | FRESH | PARTIAL (2/12) | 최근 달 셀 위주 |
| 아파트 매매 | FRESH | PARTIAL (11/12) | 2025-08부터 셀 존재 |
| 아파트 전월세(해운대구 표본) | **STALE** | PARTIAL (3/12) | 이 구의 최근 달 셀이 9/15·10/5에 마지막 검증 — **실제 수집 주기를 그대로 반영한 값** |

아파트 전월세의 `STALE`은 모델 오류가 아니라 현재 rent-sync 검증 주기(구/월 셀을 오래된 순으로 순환)가 구별로 최대 3주 이상 벌어질 수 있다는 사실이다. 숨기지 않고 노출하며, 개선하려면 rent-sync 설계 변경(별도 승인)이 필요하다. 이 API는 그 경우 `contentGuidance.recentFactsAllowed=false`로 SELLFLOW의 사실 서술을 막는다.

### 4.5 통계 (summary)

`statistics`: `transactionType, primaryMetricName(price|deposit), sampleCount, sampleStatus, canceledIncluded(false), metrics, latest, distinctAreaCount, byExclusiveArea[], byExclusiveAreaTruncated, quality, calculationMethod`. 최상위에 `asOf`, `period`, `verification`, `sources`, `contentGuidance`, `masterMatchStatus`.

- **표본**: 조회 기간·면적 조건의 비취소 거래 행 **전부**. 행 1개 = 1건. 원천이 중복 신고와 별개 계약을 구분해 주지 않아 동일 내용 행을 병합하지 않는다(`quality.identicalSiblingRows`로 가중 왜곡 가능성을 알린다).
- **sampleStatus**: `NO_DATA`(0) / `LOW_SAMPLE`(1~4) / `SUFFICIENT`(≥5). 5는 V1 기본값이며 통계적 신뢰구간이 아니다.
- **metrics**: 매매 `price`, 전세 `deposit`, 월세 `deposit`+`monthlyRent`. 각 `{min, max, median}`. `median`은 `SUFFICIENT`일 때만(그 외 null), 짝수면 가운데 두 값의 평균. 평균은 제공하지 않는다. 금액 반올림 없음.
- **`distinctAreaCount > 1`이면 전체 min/median/max는 서로 다른 면적이 섞인 값이다.** `byExclusiveArea[]`의 면적별 통계(면적별 `sampleStatus`·`median`)나 `minArea/maxArea`로 좁힌 요청을 쓴다. 면적은 반올림해 합치지 않는다.
- `quality.rowsWithoutCancellationCoverage`: 매매에서 2020-01 이전 행 수(전월세는 null).

### 4.6 source 메타데이터 (STEP 7)

```
sources: {
  transactions: { name: "국토교통부 실거래가 공개자료", dataset: "국토교통부_아파트 매매 실거래가 자료" | "…아파트 전월세…" | "…오피스텔 매매…" | "…오피스텔 전월세…",
                  provider: "공공데이터포털(data.go.kr)", processedBy: "이집(E-JIP) 수집·가공" },
  building:     { name: "건축물대장", dataset: "국토교통부_건축HUB_건축물대장정보 서비스", provider: "공공데이터포털(data.go.kr)", processedBy: "이집(E-JIP) 수집·가공" }
}
```

이것은 **메타데이터**이며 화면 표시 문구가 아니다. 본문에 어떻게 쓸지(매 문단 반복 여부, 문구)는 SELLFLOW의 UX 정책이다. `name`은 현재 이집 화면의 표기("국토교통부 실거래가")와 맞췄다. 이 메타와 `asOf`, `statistics.sampleCount`, `verification`, `statistics.calculationMethod`가 SELLFLOW의 FACT CONTEXT로 전달된다.

## 5. SELLFLOW 콘텐츠 사용 규칙 (STEP 6)

### 5.1 상태별 사용 가능 범위

| 조건 | 허용 | 금지/주의 |
| --- | --- | --- |
| `freshnessStatus = FRESH` | "최근 확인된 거래에서는 …" 같은 개별 사실 서술 | — |
| `freshnessStatus = STALE` 또는 `UNVERIFIED` | 거래 사실은 `sourceFetchedAt`/기준일을 밝히는 경우에만, "최신 시세" 표현 금지 | 현재 시점 시세 단정 |
| `coverageStatus = PARTIAL` | 개별 거래, 확인된 범위의 서술 | **전체 기간 통계를 확정적 시장 추세로 과장 금지.** 예: "지난 1년간 가격이 상승했다"는 coverage와 표본이 충분할 때만 |
| `sampleStatus = LOW_SAMPLE` | 건수·개별 거래·범위(min~max) | **급등, 급락, 시세 상승세, 하락세, 평균 시세 확정** 등 강한 추세 표현 금지. `median` 사용 금지(null이다) |
| `distinctAreaCount > 1` | 면적별 값 | 서로 다른 면적을 섞은 전체 값을 "이 단지 시세"로 서술 금지 |
| `masterMatchStatus = UNRESOLVED` / `UNATTRIBUTED_AT_ADDRESS` | 건물 정보(이름·주소)만 | 거래·시세 서술 금지, "거래 없음"으로도 쓰지 않음 |
| `NO_TRANSACTIONS_UNVERIFIED` | "확인된 범위에서는 없음" | "거래가 없다" 단정 금지 |
| 전월세 `contractType = 갱신` | 갱신 계약임을 밝힌 서술 | 신규 시세처럼 서술 금지 |
| 공통 | 기준일(`asOf`)과 표본 수(`sampleCount`) 함께 표기 | 데이터의 **정확성을 보증하는 표현 금지**("정확한", "공식 확정" 등) |

### 5.2 sampleCount / source / asOf 사용법

- `sampleCount`는 서술의 근거 건수다. 콘텐츠에 "N건의 거래 중"처럼 함께 쓰고, `LOW_SAMPLE`이면 건수를 숨기지 않는다.
- `asOf`는 응답 생성 시각이다. "기준일"로 날짜를 표기한다. 데이터가 실제로 마지막 확인된 시각은 `verification.recent.newestVerifiedAt`과 거래별 `sourceFetchedAt`이다.
- `sources`를 FACT CONTEXT에 그대로 전달한다. 출처 표기 문구는 별도 UX 정책(§8)에서 정한다.

### 5.3 contentGuidance (기계 판독용)

```
contentGuidance: { recentFactsAllowed: boolean, periodTrendEligible: boolean, reasons: [...] }
```

| 필드 | 규칙 |
| --- | --- |
| `recentFactsAllowed` | MATCHED + `sampleStatus != NO_DATA` + `freshnessStatus = FRESH` |
| `periodTrendEligible` | `reasons`가 비어 있을 때만 true: MATCHED, 표본 `SUFFICIENT`, `FRESH`, `coverageStatus = COMPLETE`, 단일 면적. **필요조건이지 충분조건이 아니다** — 추세 문장은 여전히 시점 비교(예: 기간 전/후 반) 근거를 별도로 갖춰야 한다 |
| `reasons` | `NOT_MATCHED`, `NO_DATA`, `LOW_SAMPLE`, `NOT_FRESH`, `COVERAGE_NOT_COMPLETE`, `MIXED_AREAS` |

플래그는 위 표(5.1)를 코드로 옮긴 것이며, 표시 문구가 아니다.

## 6. 오류 규격 (STEP 6)

| HTTP | code | 상황 |
| --- | --- | --- |
| 400 | `INVALID_PARAMETER`, `PERIOD_TOO_LONG`, `INVALID_MASTER_ID`, `RANGE_TOO_LARGE` | 입력 오류·한도 초과 |
| 401 | `UNAUTHORIZED` | Authorization 없음/형식 오류/키 불일치. `WWW-Authenticate: Bearer` |
| 403 | `FORBIDDEN` | 키는 맞지만 허용되지 않은 `propertyType`(`SELLFLOW_DATA_API_PROPERTY_TYPES`) |
| 404 | `MASTER_NOT_FOUND` | 대상 없음 |
| 429 | — | **V1은 발행하지 않는다**(§7). 소비자는 429를 받으면 지수 백오프로 처리하도록 구현해 둔다 |
| 500 | `INTERNAL_ERROR` | 조회 실패. 메시지에 내부 정보를 싣지 않는다 |
| 503 | `NOT_ENABLED` | 키/활성화 플래그가 없다(fail-closed) |

## 7. 요청량·비용 보호 (STEP 7)

코드로 강제하는 hard limit: 기간 36개월, `pageSize` ≤100, `page` ≤50(조건당 최대 5,000행), 검색 `limit` ≤20·후보 60, `lawdCd` 필수 + `q` 또는 `dong` 필수(광역 검색 차단), 검색어 2~40자, summary 5,000행 상한, 알 수 없는 파라미터 400. 모든 질의는 단일 master 범위 + 기간 조건이다. 성공 응답은 `Cache-Control: private, max-age=60`.

**키별 지속 rate limit은 구현하지 않았다**(서버리스 인스턴스 메모리 카운터는 신뢰할 수 없음). 필요하면 별도 승인:

| 옵션 | 비고 |
| --- | --- |
| Vercel 방화벽/WAF rate-limit | 플랜별 제공 여부·한도 **미확인** |
| Redis/KV 카운터 | 외부 저장소 추가(비용·신규 의존성) → 승인 필요 |
| SELLFLOW 쪽 호출 제한 | 서버 간 단일 호출자이므로 1차 방어로 현실적. 동시 호출 ≤2 권장 |

## 8. 호출 이력 · 출처 표기 정책 (STEP 8)

DB 스키마 변경 없이 서버 로그만: 한 요청당 한 줄 JSON `{"evt":"sellflow_api","requestId":"…","endpoint":"search|transactions|summary","status":200,"ms":87,"rows":50,"code":null}`. 키, 쿼리 값(검색어 포함), 거래 내용, 오류 메시지는 남기지 않는다(예기치 못한 오류는 *이름*만). 영구 감사 로그는 additive DB 테이블 또는 외부 로그 저장소가 필요하며 별도 승인 사항이다.

출처 표기: API는 `sources`/`asOf`/`sampleCount` 메타를 제공하고, 콘텐츠 본문에서 반복 표기할지와 문구는 SELLFLOW UX 정책이다. 이집 화면은 "국토교통부 실거래가 기준 · 취소 거래 제외" 형태의 출처 노트를 쓴다. 이용허락범위가 제한 없음이어도 출처와 기준일을 밝히는 것을 권장한다.

## 9. 이용 조건 검토 (STEP 9)

**기준: 공공데이터포털(data.go.kr) 각 데이터셋 페이지에 표시된 "이용허락범위"** (2026-10-25 시점 확인). 법적 확정 의견이 아니라 포털 표시 조건에 근거한 판단이다.

| 데이터셋 | 포털 ID | 표시된 이용허락범위 | 이집 사용처 |
| --- | --- | --- | --- |
| 국토교통부_아파트 매매 실거래가 자료 | 15126469 | 이용허락범위 제한 없음 | 아파트 매매 |
| 국토교통부_아파트 전월세 실거래가 자료 | 15126474 | 이용허락범위 제한 없음 | 아파트 전월세 |
| 국토교통부_오피스텔 매매 실거래가 자료 | 15126464 | 이용허락범위 제한 없음 | 오피스텔 매매 |
| 국토교통부_오피스텔 전월세 실거래가 자료 | 15126475 | 이용허락범위 제한 없음 | 오피스텔 전월세 |
| 국토교통부_건축HUB_건축물대장정보 서비스 | 15134735 | 이용허락범위 제한 없음 | 건물 기본 정보(master 구축) |

판단: V1에서는 MOLIT 실거래 데이터와 건축물대장 기반 건물 정보를 SELLFLOW 콘텐츠 제작의 **근거 데이터로 제공 가능**하다고 본다. 단, 다음을 지킨다.

- 데이터의 **정확성을 보증하는 표현 금지**(이집이 수집·가공한 값이며 원천의 정정·취소가 늦게 반영될 수 있음).
- 기준일(`asOf`), 표본 수(`sampleCount`), 취소 거래 처리 규칙(§4.3, `canceledIncluded`)을 함께 전달·표시한다.
- 원천 출처 메타를 API로 제공한다(§4.6). 표기 문구는 SELLFLOW UX 정책.
- 이집이 가공한 통계(중앙값 등)는 이집의 계산 결과이며 원천 자료 그대로가 아님을 `calculationMethod`로 밝힌다.

**Kakao 좌표**: SELLFLOW 계약에서 제거했으므로(서비스 간 재제공 조건 미확정) V1 Production enable blocker에서 제외한다. 이집 내부 지도 사용에는 영향이 없다.

**남은 확인(blocker 아님):** 포털 표시 조건은 데이터셋 단위이며 서비스 약관·이용 정책의 개별 조항(예: 대량 호출 제한, 변경 공지)은 별도로 변할 수 있다. 활성화 시점에 위 5개 페이지를 한 번 더 확인하는 것을 권장한다.

## 10. 테스트·검증 결과 (V1.1)

| 항목 | 명령 | 결과 |
| --- | --- | --- |
| SELLFLOW 신규 테스트 | `npx tsx --test src/lib/integrations/sellflow/sellflow.test.ts` | 38/38 pass |
| 기존 오피스텔 테스트 | `npx tsx --test src/lib/officetel/*.test.*` | 112/112 pass |
| 오피스텔 증분 sync 테스트 | `npx tsx --test src/lib/officetel/sync/sync.test.ts` | 30/30 pass |
| 아파트 거래 읽기 테스트 | `npx tsx --test src/lib/trade-history-read.test.mjs src/lib/cron-auth.test.ts src/lib/apt-detail-trade-source.test.ts` | 39/39 pass |
| Prisma | `npx prisma validate`(더미 URL) | valid |
| 타입 | `npx tsc --noEmit` | `src/` 오류 0. 전체 24건은 모두 `scripts/` 기존 오류(`FAIL_EXISTING_SCRIPT_ERRORS`) |
| lint | `npx eslint src/lib/integrations src/app/api/integrations` | 오류·경고 0 |
| build | `npm run build` | exit 0, 3개 route 동적(ƒ) 등록 |

테스트가 덮는 것: 인증 401/503/403, 키 비노출, 아파트·오피스텔 검색, 매매/전세/월세, 기간·면적 필터, 페이지네이션 상한, 취소 처리, 미연결 Master, 0건(검증/미검증), 표본 부족·충분, 최대 기간·행 상한, 내부 필드 미노출, 조회 실패 500, 로그 필드, **좌표 키 부재(응답·샘플 JSON)**, **verification: 최근 FRESH+과거 미검증→FRESH/PARTIAL, STALE, UNVERIFIED, COMPLETE, 거래 0건+FRESH, 아파트·오피스텔 전월세 부분 coverage**, contentGuidance, source 메타.

실DB 읽기 전용 스모크(쓰기 0): 위 §4.4 표의 값. 좌표 키는 어떤 응답에도 없음.

## 11. 알려진 문제 · 별도 승인 사항

1. **아파트 전월세 freshness**: 일부 구(예: 해운대구)가 `STALE`이다. rent-sync의 구/월 셀 순환 검증 주기 때문이며, 개선은 rent-sync 설계 변경(별도 승인). 그동안 이 API는 `recentFactsAllowed=false`로 사실 서술을 막는다. **Production 활성화 전에 SELLFLOW 쪽에서 이 상태를 허용할지 결정해야 한다.**
2. **coverage**: 오래된 달·전월세는 개별 sync 셀이 없어 12개월 창이 대부분 `PARTIAL`이다. 현재 구조의 사실이며, `periodTrendEligible`이 대부분 false인 이유다. 아파트 전월세의 별도 verified range를 coverage에 반영하는 확장은 후속 작업.
3. **키별 지속 rate limit / 영구 호출 감사 로그** — 외부 저장소·DB 테이블 필요(§7, §8).
4. **Production 환경변수 생성·등록** — `SELLFLOW_DATA_API_KEY`(값은 별도 생성), `SELLFLOW_DATA_API_ENABLED=true`, 선택 `SELLFLOW_DATA_API_PROPERTY_TYPES`. 만들지 않았다.
5. **오피스텔 `masterId` 안정성**(§2). 다동 오피스텔(UNRESOLVED)은 원천 한계이며 master/linkage 별도 작업 필요.

## 12. SELLFLOW 연결 정보 (STEP 14)

| 항목 | 값 |
| --- | --- |
| `E-JIP_DATA_API_BASE_URL` | `https://e-jip.com/api/integrations/sellflow/v1` (활성화 승인 후) |
| `SELLFLOW_DATA_API_KEY` | E-JIP와 SELLFLOW 양쪽 비밀 저장소에만 둔다. **값은 만들지 않음** |
| `API_VERSION` | `v1` — 필드 삭제/의미 변경 시에만 올린다. 필드 *추가*는 버전을 올리지 않으므로 **모르는 필드는 무시** |
| 인증 헤더 | `Authorization: Bearer <key>` |
| endpoint | `GET /buildings/search`, `GET /buildings/{masterId}/transactions`, `GET /buildings/{masterId}/summary` |
| timeout / retry | 10초 timeout. 5xx·네트워크 오류·429만 재시도(최대 2회, 1s→2s). 4xx 재시도 금지. `requestId`를 로그에 남겨 문의 시 전달 |
| pagination | `page`/`pageSize`, `pagination.hasMore`. 조건당 최대 5,000행 |
| 호출 권장 | 콘텐츠 1건당: 검색 1회 → summary 1~3회(면적별) → 필요 시 transactions 1회. 동시 호출 ≤2 |
| FACT CONTEXT로 전달할 값 | `sources`, `asOf`, `statistics.sampleCount`, `statistics.sampleStatus`, `verification.freshnessStatus`, `verification.coverageStatus`, `statistics.calculationMethod`, `contentGuidance` |
| 콘텐츠 규칙 | §5.1 표를 따른다. 특히 `LOW_SAMPLE`·`coverage PARTIAL`에서 추세/평균 확정 표현 금지, `UNRESOLVED`·`UNATTRIBUTED_AT_ADDRESS`는 거래·시세 서술 금지 |
| 출처·기준일 표시 | 이용허락범위는 제한 없음이지만 출처·기준일 표시를 권장. 문구와 반복 여부는 SELLFLOW UX 정책 |
