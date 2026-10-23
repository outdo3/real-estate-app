# OFFICETEL_NEARBY — API 계약 v1, 갱신 방안, SELLFLOW 연결 준비

- 브랜치 `feat/nearby-officetel-api-v1`. 로컬 커밋만. Push/배포/마이그레이션/DB 쓰기 없음.
- 구현: `src/lib/officetel/nearby-contract.ts`(순수), `nearby-read.ts`(DB 읽기), `src/app/api/officetel/nearby/route.ts`.

## 0. 검증 상태 (코드 테스트 vs 실제 DB)

| 항목 | 상태 |
| --- | --- |
| 순수 로직(계약) 테스트 22개, 모의 데이터 | PASS |
| 기존 오피스텔 테스트 110개 | PASS(변경 없음) |
| 신규 파일 타입 검사/lint | PASS |
| **계약 로직을 실제 운영 자료에 적용** (이집 공개 GET API를 읽어 명지 빌리브 기준 계산, DB 미사용) | 수행 — 아래 §6 |
| **`nearby-read.ts`를 실제 DB로 실행** | **BLOCKED** — 이집에는 스테이징/개발 DB가 없다. 앱과 모든 스크립트가 같은 Production `DATABASE_URL`을 쓰고(`docs/development/TEST_DATABASE_SAFETY_GUARD_V1.md`), 이 환경에는 그 접속 정보도 승인도 없다. 운영 DB에 임의 연결하지 않았다. `prisma/dev.db`는 36KB SQLite 잔재로 Postgres 스키마와 맞지 않아 쓸 수 없다. |

## 1. 요청

`GET /api/officetel/nearby`

| 파라미터 | 기본 | 범위 | 비고 |
| --- | --- | --- | --- |
| `lat`, `lng` | 필수 | 대한민국 범위(32.5~38.9, 124.0~132.1) | 위·경도가 뒤바뀌면 400 |
| `radiusKm` | 1 | 0.1 ~ 3 | |
| `limit` | 5 | 1 ~ 10 | 가까운 순 |
| `months` | 12 | 1 ~ 36 | 거래일 기준 조회 기간 |
| `area` | 없음 | 0 초과 500 이하 | 전용면적(㎡). 지정하면 ±`areaTolerance` 안의 거래만 센다 |
| `areaTolerance` | 1 | 0 ~ 5 | `area` 지정 시에만 의미 |
| `kinds` | `both` | `sale` \| `rent` \| `both` | 선택하지 않은 쪽은 응답에서 `null` |

인증: 헤더 `x-api-key`. 서버에 `OFFICETEL_NEARBY_API_KEY`가 설정돼 있어야 하고 값이 같아야 한다. **키가 없으면 production에서는 503으로 닫혀 있다.**
호출 제한: 이집에 공용 rate limiter가 없어 **이번에 만들지 않았다**. 현재 제한은 키 + 파라미터 상한 + 응답 상한(오피스텔 최대 10, 종류당 거래 3건, 약 10KB)이다. 운영 전에 정책을 정해야 한다.

## 2. 응답 (`{ success: true, data }`)

```jsonc
{
  "apiVersion": 1,
  "query":   { "lat": 35.09087, "lng": 128.90724, "radiusKm": 1, "limit": 10, "months": 12, "area": null, "areaTolerance": null, "kinds": "both" },
  "dataStatus": "OK",                       // OK | INSUFFICIENT | NO_NEARBY_OFFICETEL
  "comparison": { "propertyType": "officetel", "areaBasis": "전용면적(㎡)", "priceUnit": "만원", "note": "…아파트 실거래와 같은 기준으로 비교하지 마세요…" },
  "window":  { "months": 12, "dealDateFrom": "2025-10-23", "dealDateTo": "2026-10-23" },
  "dataAsOf": {                              // 거래일(lastDealDate)과 수집일(lastFetchedAt)은 다른 값
    "sale": { "lastDealDate": "2026-08-29", "lastFetchedAt": "2026-09-04T17:07:02.495Z", "freshness": "STALE", "ageDays": 48 },
    "rent": { "lastDealDate": "2026-08-31", "lastFetchedAt": "2026-09-04T17:28:38.860Z", "freshness": "STALE", "ageDays": 48 }
  },
  "source":   { "name": "국토교통부 실거래가 공개자료(오피스텔 매매·전월세)", "collectedBy": "이집(E-JIP)", "cancelledSaleDeals": "…", "duplicates": "…" },
  "coverage": { "region": "부산광역시", "note": "오피스텔 마스터와 실거래는 부산만 적재되어 있습니다." },
  "totals":   { "withinRadius": 13, "returned": 10 },
  "truncated": { "candidates": false, "tradeRows": false },
  "notes": ["수집일이 오래된 자료입니다. …"],
  "items": [{
    "id": 971, "detailPath": "/officetel/971", "name": "빌리브 명지 듀클래스 2단지", "propertyType": "officetel",
    "address": { "dong": "명지동", "jibun": "3605-1", "buildingDong": null, "roadAddress": "…" },
    "buildYear": null, "hoCnt": 241, "distanceKm": 0,
    "coordinates": { "latitude": 35.09087, "longitude": 128.90724 },
    "tradeStatus": "HAS_TRADES",              // HAS_TRADES | NO_TRADES_IN_WINDOW
    "attribution": { "status": "ATTRIBUTED", "note": null },   // ATTRIBUTED | UNATTRIBUTED_AT_ADDRESS | NO_TRANSACTIONS
    "sale": { "count": 0, "latestDealDate": null, "recent": [] },
    "rent": { "count": 26, "latestDealDate": "2026-08-23",
              "recent": [{ "dealDate": "2026-08-23", "dealMonth": "2026-08", "deposit": 27000, "monthlyRent": 0, "exclusiveArea": 84.97, "floor": 12 }] }
  }]
}
```

* 금액 단위는 **만원**. `monthlyRent: 0`은 전세, 0 초과는 월세(`deposit`은 보증금). 매매 거래는 `dealAmount`.
* `count`는 조회 기간 + 면적 조건 + 취소 제외 후의 **DB count**이다(불러온 행 수에 좌우되지 않음). `recent`는 최근순 최대 3건.
* **평균·중앙값은 없다**(동일 내용 형제 거래 다중성 때문 — 이집 상세 API와 같은 원칙).
* **CURRENT / STALE / UNKNOWN**: 데이터셋 전체의 마지막 수집 시각(`sourceFetchedAt` 최댓값)이 기준이다. 45일 초과면 STALE, 수집 시각이 없으면 UNKNOWN. STALE/UNKNOWN이면 `notes`에 "최신 시세로 쓰면 안 됩니다"가 들어간다. 소비자는 STALE을 최신 시세로 표시하면 안 된다.
* **자료 부족 상태**: `NO_NEARBY_OFFICETEL`(반경 안 없음, 부산 외 지역이면 항상 이것), `INSUFFICIENT`(오피스텔은 있으나 조건에 맞는 거래 없음). 두 경우 모두 가격을 만들지 않는다.
* `UNATTRIBUTED_AT_ADDRESS`: 같은 지번에 여러 동이 있어 원천이 동을 구분해 주지 않는 거래. **"거래 없음"이 아니다.** 어느 오피스텔에도 붙이지 않는다.
* 내부 식별정보(`canonicalKey`, 거래 id, `sourceFetchedAt`/`occurrenceIndex` 행 단위 값)는 내보내지 않는다.

오류: 400(입력 검증 실패, `{success:false,error}`), 401(키 불일치), 503(키 미설정 + production), 500(조회 실패). 오류 응답은 캐시하지 않는다.

## 3. 버전 관리

* 응답에 `apiVersion`(현재 1). **필드 삭제·의미 변경은 버전을 올리고**, 필드 추가는 올리지 않는다. 소비자는 모르는 필드를 무시해야 한다.
* 호환이 깨지는 변경이 필요하면 새 경로(`/api/officetel/nearby/v2` 등)를 추가하고 v1을 유지한다.

## 4. 오피스텔 데이터 갱신 방안 (설계만 — cron/수집 작업은 활성화하지 않음)

현황(코드로 확인):

* 오피스텔 cron이 없다(`vercel.json`의 cron은 아파트 `sale-sync`/`sale-recheck`/`rent-sync`뿐).
* 기존 적재 스크립트 `scripts/officetel/step3b-history-backfill.ts`는 **최초 backfill 전용**이다 — MOLIT을 부르지 않고 3A 스윕이 남긴 NDJSON을 읽어 `createMany({skipDuplicates:true})`로 적재한다.
  `sourceFetchedAt`에 스윕 파일 mtime을 넣었다. 그래서 2026-09-04 이후 갱신이 없다.
* 아파트에는 증분 동기화 프레임워크가 있다: `src/lib/sync/*`(run deadline, MOLIT quota guard, 셀 단위 coverage, 재확인 sweep).

설계(재사용 우선):

1. **증분 sync**: 최근 3개월(`dealYmd`)을 부산 16개 구(lawdCd)별로 오피스텔 매매·전월세 원천에서 받는다. 아파트의 `sale-sync-core` 구조(셀 = 데이터셋×구×계약월, 마감 시각, quota guard)를 따른다.
2. **중복 처리**: 기존 자연키 유니크 + `assignOccurrenceIndexes`를 그대로 쓰고 `createMany(skipDuplicates)`로 멱등하게 한다. 3B가 이미 쓰는 방식이라 새 규칙이 없다.
3. **취소 반영**: 매매는 늦게 취소가 올라온다(3A가 12개월 초과 지연 취소 93건을 식별). 최근 N개월 재확인 sweep이 필요하다(아파트 `sale-recheck`와 같은 역할). 전월세는 원천에 취소 필드가 없다.
4. **재시도/실패**: 셀 단위로 상태(COMPLETE/PARTIAL/INVALID)를 기록하고, PARTIAL은 다음 실행에서 다시 한다. 실패한 달을 "거래 없음"으로 굳히지 않는다(이집 원칙).
5. **수집 로그와 정합성**: 실행 id, 셀별 원천 totalCount vs fetched, inserted/blocked, 미연결(unresolved) 건수를 남긴다. 적재 후 master 연결률(현재 97.66%)과 다동 지번 미연결 건수를 대조한다.
6. **`sourceFetchedAt`은 실제 수집 시각**으로 기록한다(그래야 이 API의 CURRENT/STALE이 의미를 가진다).
7. **필요한 DB 변경(승인 필요)**: 현재 `SyncDataset` enum은 `SALE`/`RENT`뿐이라 오피스텔 셀을 같은 테이블에 기록하려면 enum 값 추가(마이그레이션)가 필요하다. 대안은 별도 테이블 또는 파일 로그다. **이번에는 마이그레이션을 하지 않았다.**
8. **비용**: MOLIT 공공데이터는 호출 비용이 없고 일일 호출 한도가 있다(오피스텔 API 한도는 확인하지 못했다). 16구 × 3개월 × 2종 = 96셀(+페이지)이라 주 1회 수준이면 부담이 작다. 한도와 이용약관은 `docs/realestate-research-sources.md`(SELLFLOW)의 미확인 항목과 같다.
9. 운영 투입 순서: dry-run(쓰기 없음) → 한 구 apply → 16구 → cron 등록. cron은 `CRON_SECRET` 설정 후에만. 모두 이번 단계에서 하지 않았다.

## 5. SELLFLOW 연결 준비 (SELLFLOW 코드는 변경하지 않음)

SELLFLOW의 연구자료(`ResearchInput`)는 초안으로 저장되고 관리자가 승인한 자료만 글에 쓴다. 이집 응답을 `price_comp` 초안으로 바꾸는 데 필요한 필드:

| SELLFLOW `ResearchInput` | 이집 응답에서 |
| --- | --- |
| `kind` | `"price_comp"` (주변 단지 비교는 `competitor`와 병행 가능) |
| `title` | 예: `"{현장명} 주변 오피스텔 실거래 (반경 {radiusKm}km)"` |
| `data.rows[]` (`PriceRow`) | 아래 표 |
| `sourceOrg` | `source.name` + `source.collectedBy` |
| `sourceUrl` | 호출하는 쪽이 `https://e-jip.com` + `items[].detailPath`로 조립(https 공개 주소만 허용) |
| `referenceDate` | `dataAsOf.*.lastFetchedAt`의 날짜 부분(수집 기준일). 거래일이 아니라 **수집일**을 기준일로 쓴다 |
| `collectedVia` | `"api"` |
| `body` | `notes`와 `comparison.note`, `dataAsOf.freshness` 문구 |

`PriceRow` 변환(`PRICE_ROW_LIMIT = 50` 이내):

| `PriceRow` | 이집 값 |
| --- | --- |
| `building` | `items[].name` |
| `address` | `address.roadAddress` 또는 `address.dong + " " + address.jibun` |
| `use` | `"officetel"` |
| `dealType` | 매매 → `"sale"`, `monthlyRent === 0` → `"jeonse"`, 그 외 `"monthly"` |
| `priceKind` | `"actual"` |
| `areaM2` | `exclusiveArea` (SELLFLOW는 5~500㎡만 허용) |
| `amountManwon` | 매매 `dealAmount`, 전월세 `deposit` |
| `monthlyManwon` | 월세 `monthlyRent` |
| `dealDate` | `dealDate` |
| `floor` | `floor` |
| `builtYear` | `buildYear` |
| `origin` | `"public_data"` |

주의: `freshness`가 STALE/UNKNOWN이면 SELLFLOW도 자료를 "오래된 자료"로 표시해야 한다(SELLFLOW는 자료 종류별 신선도 기준이 따로 있다). `attribution.status`가 `UNATTRIBUTED_AT_ADDRESS`인 오피스텔은 거래 행을 만들지 말고 안내만 남긴다. 아파트와 오피스텔은 같은 자료에 섞지 않는다.

## 6. 명지 빌리브 기준 실데이터 적용 결과 (DB 미사용, 공개 API 읽기)

중심 좌표: 이집이 저장한 master 971(빌리브 명지 듀클래스 2단지, 명지동 3605-1)의 좌표(35.09087, 128.90724). 지번은 제공된 참고 PDF("명지동 3605-1 일원")와 일치하는 것만 사용했다. 현장 자체의 좌표 자료는 확인하지 못했다.

* 반경별 오피스텔 수: 0.3km 8개 / 1km 13개 / 2km 15개 / 3km 19개(강서구 30개 중, 인접 구 제외).
* 가까운 순 10개 결과: 빌리브 명지 듀클래스 1~4단지가 0~0.11km에 있고, 이어서 오션퍼스트(0.14km), 제나우스 블루오션(0.19km), 대방디엠시티 센텀오션 1·2차(0.31/0.38km).
* 빌리브 2단지·1단지는 최근 12개월 전월세 26건·46건(매매 0건), 3단지·4단지(같은 지번에 마스터 2개씩)는 거래가 `UNATTRIBUTED_AT_ADDRESS`로 표시되고 "거래 없음"으로 말하지 않았다(전월세 35건은 동을 구분할 수 없어 표시하지 않음).
* 면적 필터(84㎡ ±1): 빌리브 1·2단지만 전월세가 남고 나머지는 0건.
* 최신성: 데이터셋 수집일 2026-09-04 → **STALE(48일)**, 최근 거래일 매매 2026-08-29 / 전월세 2026-08-31. 이 값은 표본(개별 오피스텔 응답)의 최댓값이며 DB 집계가 아니다.
* 응답 크기 약 9.8KB. 공개 API 호출 지연은 건당 평균 114ms/최대 184ms였으나 이는 기존 공개 API 지연이며 **신규 API의 DB 응답 시간이 아니다**.
