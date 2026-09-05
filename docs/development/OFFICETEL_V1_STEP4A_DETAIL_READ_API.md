# OFFICETEL V1 STEP 4A — 상세 READ API / 데이터 계약

- 상태: **완료**
- 선행: `OFFICETEL_V1_STEP3B_HISTORY_BACKFILL.md` (314,965행 적재 완료)
- Production write: **0** — 읽기 전용 API만 추가. schema/index/migration/cron 변경 없음
- 범위: **API + 데이터 계약까지.** UI는 STEP 4B (이 STEP에서 만들지 않음)

---

## 1. 기존 아키텍처 감사 — 무엇을 재사용하고 무엇을 버렸는가

| 재사용 | 근거 |
| --- | --- |
| `{ success, data } / { success, error }` + 400·404·500 | `/api/presales/[id]` 관례 |
| `logServerError(buildErrorLogMessage(...))` | 프로젝트 공통 에러 로깅 |
| `getOrSetCache(key, ttl, fetcher)` (in-flight 중복 제거 포함) | `src/lib/server-cache.ts`, admin/ops와 같은 5분 TTL |
| `getUniqueAreaLabels()` | 목록 안에서 라벨이 겹치지 않게 정밀도를 올려주는 기존 유틸 |
| 순수 로직 분리 + `.test.mjs` | repo의 `*-logic.ts` 테스트 관례 |

| 버린 것 | 근거 |
| --- | --- |
| 아파트 상세의 **이름 기반 재식별** (`/api/apt/[name]`) | 지오코딩·네이버 스크래핑으로 지역을 복구하는 레거시 구조. 오피스텔은 STEP 1~3B에서 master id / canonicalKey라는 정확한 identity를 이미 확보했다 |
| 아파트 **대표평형/공급면적/평 라벨** | 오피스텔에는 Unit Master도 공급면적도 없다 |
| `84㎡`/`59㎡` 관례 | 오피스텔 면적 분포가 완전히 다르다 (실측 한 단지 28종) |
| `세대수` 라벨 | 오피스텔 규모는 **호수(hoCnt)** 다 |

---

## 2. IDENTITY 계약 (§2)

경로 파라미터는 **정확한 identity만** 해석한다:

| 입력 | 해석 |
| --- | --- |
| `2243` | master id |
| `OFFI:26350:우동:1435-3:_` | canonicalKey (5세그먼트 전부 필수) |
| `한일오르듀`, `우동`, `OFFI:26350:우동` | **400** — 해석하지 않는다 |
| 없는 id / 없는 키 | **404** |

이름 검색·부분일치·같은 동 첫 결과·buildingDong 추측·다른 오피스텔 폴백 **전부 없음**. 잘못된 데이터보다 NO DATA가 낫다.

### 이력 조회 키 — master 키와 다르다

master는 건축물대장 `dongNm`이 있으면 동 단위 키(`...:오피스텔동`)를 갖지만, 거래 원천에는 동 필드가 없어 **거래 행은 언제나 building-level 키(`...:_`)** 다(STEP 3A에서 EXACT 일치가 65%에 그친 이유). 그래서 `buildOfficetelHistoryKey(master)`로 building-level 키를 다시 만들어 조회한다.

STEP 3B 적재 후 전수 검증: 연결된 행의 `canonical_key`가 이 값과 다른 경우 **SALE/RENT 모두 0건**.

---

## 3. 조회 성능 결정 (§12) — 인덱스를 추가하지 않은 이유

`officetel_*_histories`에는 **`officetel_master_id` 인덱스가 없다**(pg_indexes 실측). Postgres는 FK에 인덱스를 자동 생성하지 않으므로 `where masterId = X`만 걸면 226,291행 seq scan이 된다.

기존 인덱스 `(canonical_key, deal_date)`를 쓰되, **`officetelMasterId`를 함께 걸어** 두 목적을 동시에 만족시켰다:

- `canonicalKey` → 인덱스가 실제로 좁혀준다 (성능)
- `officetelMasterId` → §10 보호 (같은 주소의 unresolved 행 차단)

**결과적으로 인덱스 추가가 필요하지 않았다.** 이 STEP에서 schema/index를 건드리지 않았다.

---

## 4. 라우트

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| GET | `/api/officetel/[id]` | master + 면적 옵션 + 최근 요약 + 데이터 품질 |
| GET | `/api/officetel/[id]/transactions` | 매매/전월세 원시 거래 목록 |

`transactions`는 `?type=sale\|rent` 하나로 두 계열을 제공한다(불필요한 API 분화 금지).

query: `type`(기본 sale) · `area`(정확한 ㎡) · `limit`(기본 50, 최대 500) · `offset` · `includeCanceled`(SALE 전용, 기본 false)

잘못된 값은 **조용히 보정하지 않고 400**으로 거절한다.

---

## 5. master 응답 필드 (§3)

저장된 실제 값만. 없으면 `null`이며 추론하지 않는다.

`id` · `canonicalKey` · `name`(빈 문자열은 null로 접음 — 실측 390건) · `address{sggCd,umdNm,jibun,buildingDong,roadAddress}` · `buildYear` · `useApprovalDate` · `scale{unit:'호', hoCnt, label}` · `building{totalArea, buildingCoverageRatio, floorAreaRatio, structureName, groundFloorCount, undergroundFloorCount, registryMainPurpose, registryEtcPurpose}` · `parking{indoorMechanical, indoorAuto, outdoorMechanical, outdoorAuto, total}` · `coordinates`(보유율 0.00% → 항상 null)

**규모 의미론**: 단위는 **호**다. `hhldCnt`는 애초에 저장하지 않으며(복합용도 건물 맥락일 수 있음), 응답의 `dataQuality.scaleNote`가 이를 명시적으로 부인한다. 실측 확인 — `master`/`areas`/`summary` 어디에도 "세대"가 등장하지 않는다.

**주차 합계**: 네 값이 전부 없으면 `0`이 아니라 `null`(정보 없음). 실제로 0으로 보고된 경우는 0을 유지한다.

---

## 6. SALE 읽기 계약 (§4)

날짜 내림차순. 반환: `dealDate` · `dealAmount` · `exclusiveArea` · `floor` · `dealCanceled` · `cancelDate` · `buildYear` · `dealingGbn` · `buyerGbn` · `sellerGbn` · `estateAgentSggNm` · `occurrenceIndex` · `source` · `sourceFetchedAt` · `cancellationCoverage`

- **기본은 취소 거래 제외** — 가격/추이 표시용.
- `includeCanceled=true`로 감사/디버그 조회 가능. `meta.canceledInScope` / `canceledExcluded`로 규모를 항상 노출한다.
- **Record High 계산 없음.**

## 7. RENT 읽기 계약 (§5)

반환: `dealDate` · `deposit` · `monthlyRent` · `rentType`(월세 0 → `jeonse`, 초과 → `wolse`) · `exclusiveArea` · `floor` · `contractTerm` · `contractType` · `preDeposit` · `preMonthlyRent` · `useRenewalRight` · `occurrenceIndex` · `source` · `sourceFetchedAt`

- `contractTerm`/`contractType` 결측은 **null 그대로** (약 44% 결측). 지어내지 않는다.
- `useRenewalRight`는 `true` 또는 `null`만 존재한다 — 원천에 "미사용" 값이 없어 `false`를 만들지 않는다.
- `meta`가 결측 건수(`contractTermMissing` 등)를 함께 준다.
- `meta.hasCancellationConcept = false` — RENT 원천에는 취소 필드가 아예 없다.

---

## 8. 면적 계약 (§6)

이 오피스텔에 **실제로 존재하는** `exclusiveArea` 값만으로 옵션을 만든다(`groupBy` + 건수).

- 라벨은 `getUniqueAreaLabels()`로 목록 내 충돌이 없을 때까지 정밀도를 올린 **㎡ 표기**.
- **평 라벨을 만들지 않는다** — 공급면적이 어느 원천에도 없어 유도 자체가 불가능하다.
- 아파트 대표평형(59/84) 관례 미적용.
- 필터는 **정확한 값 일치**만 — `84~85` 같은 구간/근사는 400.

실측(id 2243): SALE 28종 / RENT 35종, 라벨 예 `28.5㎡(7) 31.69㎡(327) 32.73㎡(104) 39.29㎡(269)`.

---

## 9. 취소 신뢰 계약 (§9)

- 상수 `OFFICETEL_CANCELLATION_COVERAGE_FROM = '2020-01'`
- **행마다** `cancellationCoverage`를 붙인다: `PROVIDED` / `NOT_PROVIDED_BY_SOURCE`
- 2006~2019 행을 "취소 여부 검증 완료"로 표시하지 않는다
- `meta.rowsWithoutCancellationCoverage`와 `meta.limitations` 문구로 제한을 응답 자체에 담는다
- **역대 최고가 미노출 · Record High BLOCKED 유지**

## 10. unresolved 보호 (§10)

Production unresolved: SALE 2,368 / RENT 5,012행.

모든 이력 조회는 `canonicalKey` **AND** `officetelMasterId = master.id`로 건다. 이름·지번 부분일치·같은 주소 추측·최근접 master·첫 매칭 master **전부 없음**.

실증(CASE G): master 109는 같은 주소(`26350 중동 1754-3`)에 master가 5건이라 그 주소의 SALE 680행이 전부 unresolved다. 상세 응답은 **summary 0 / 거래목록 0건**을 반환했다 — 680행이 한 건도 새지 않았다.

응답에 `dataQuality.historyScope = 'LINKED_TO_THIS_MASTER_ONLY'`로 계약을 명시한다.

---

## 11. 추이 데이터 계약 (§8)

**V1은 원시 거래 포인트만 제공한다.** 평균/중앙값을 계산해 정본처럼 제시하지 않는다.

`meta.limitations`가 응답에 직접 담기는 내용:
1. 원천 행을 1:1 보존한다 — 동일내용 형제를 합치거나 제거하지 않는다
2. (해당 시) 모든 필드가 동일한 형제 거래 N건 포함 — 평균/중앙값은 표본 수와 함께 해석해야 한다
3. (해당 시) 2020-01 이전 구간은 취소 여부 미제공

`meta.sampleCount` / `meta.total`을 항상 함께 준다.

---

## 12. 검증

### 실 Production 데이터 케이스 (39 assertion 전부 PASS)

| 케이스 | 대상 | 결과 |
| --- | --- | --- |
| A. SALE+RENT | 2243 한일오르듀 (SALE 1,686 / RENT 1,024, 770호) | 수치 일치, 좌표 null, 평 라벨 없음 |
| B. SALE only | 2282 센트렐오피스텔 (69 / 0) | RENT는 빈 배열 + total 0 (에러 아님) |
| C. RENT only | 1323 대동레미안 스마트시티 (0 / 534) | SALE 최신 거래 `null`(지어내지 않음) |
| D. 다중 면적 | 2243 (SALE 28종) | 정확 면적 필터 동작, 구간 입력 400 |
| E. 취소 거래 | 153 (177행 중 118 취소) | 기본 59건(취소 0) / includeCanceled 177건, 합계 정합 |
| F. 결측 계약 | 3056 (RENT 2,191행) | 결측 null 유지, `useRenewalRight`에 false 없음 |
| G. unresolved 차단 | 109 (주소에 master 5건, 680행) | **0건 반환** |
| H. 없는 master | id 99999999 / 없는 키 | 404 |
| I. 느슨한 해석 금지 | 이름·부분키 4종 | 전부 400, 정확한 키만 200 |

### 성능 (로컬 production 빌드, 6회 반복)

| 엔드포인트 | first | warm median |
| --- | ---: | ---: |
| `/2243` | 302ms | **31ms** |
| `/2243/transactions?type=sale&limit=50` | 94ms | **67ms** |
| `/3056/transactions?type=rent&limit=100` | 154ms | **93ms** |
| `/109` | 53ms | **47ms** |
| `/153/transactions?limit=500&includeCanceled=true` | 177ms | **77ms** |

전부 목표(warm ≤500ms) 이내. 별도 실행 1회에서 909ms 단발 outlier를 관측했으나 재현되지 않았고, "2초 초과 시 조사" 기준에도 미달한다.

### 빌드/타입/테스트

| 항목 | 결과 |
| --- | --- |
| `node --experimental-strip-types --test` (officetel 3파일) | **56/56 PASS** (신규 17 + 기존 39) |
| `npx tsc --noEmit` | **24 errors — 전부 기존 스크립트**(baseline 동일). STEP 4A 신규 **0건** |
| `npm run build` | **PASS**, 두 라우트가 `ƒ`(dynamic)로 등록됨 |

---

## 13. 기능 상태

**READY** (이 STEP으로 가능해진 것)
- 매매 / 전월세 거래 목록 (날짜 내림차순, 페이지네이션)
- 전세·월세 구분 및 각각의 최신 거래
- 실제 전용면적 옵션 + 정확 면적 필터
- 최근 거래 요약(최근 12개월 건수, 최신 거래)
- 원시 추이 포인트

**LIMITED**
- 장기 통계 / 연도별 추이 — 2020 이전 취소 미반영 구간 표기 필수
- 평균 / 중앙값 — 동일내용 형제 다중성(SALE 7.48%)이 가중치를 왜곡. 표본 수 병기 필수
- 계약기간 / 계약유형 — 약 44% 결측을 "정보 없음"으로 구분 표시

**BLOCKED** (응답의 `dataQuality.blocked`에 기계 판독 가능하게 명시)
- `RECORD_HIGH` — 2020 이전 취소 미제공 + `rgstDate` 부재
- `SCORE` — peer cohort 근거 없음
- `FINANCE` — 건축물대장이 세법상 주택 여부를 판정하지 않음
- `MAP_DISTANCE` — master 좌표 0.00%
- `SUPPLY_AREA_OR_PYEONG` — 어느 원천에도 없음

---

## 14. 알려진 문제 / 다음 STEP

1. **STEP 4B(상세 UI)는 미착수.** 이 STEP은 API/계약까지다.
2. 오피스텔 **검색/목록 진입 경로가 아직 없다** — 현재는 master id를 알아야 상세를 열 수 있다. 4B 또는 별도 STEP에서 필요.
3. master 좌표 0.00% — 지도/거리 기능의 선행 조건.
4. master 표시명 공백 390건(7.71%) — 목록 노출 시 확인 필요.
5. incremental re-sync 여전히 금지(STEP 3B 결정 유지) — 지연 취소 93건 미반영.
6. `officetel_master_id` 인덱스는 지금 불필요하지만, 향후 master 기준 대량 집계(지역 랭킹 등)를 만들면 재검토 대상이다.
