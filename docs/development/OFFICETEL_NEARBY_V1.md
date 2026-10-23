# OFFICETEL_NEARBY_V1 — 주변 오피스텔 조회 API + 실거래 최신성 점검

- 브랜치: `feat/nearby-officetel-api-v1` (기준 `b78c0c4`, main). 로컬 커밋만. Push/배포 없음.
- DB/schema/migration/index 변경 **0**. Production write **0**. 기존 공개 API 변경 **0**.
- 작업 근거: SELLFLOW 분양팩이 분양 현장 좌표로 주변 오피스텔 실거래를 근거 자료로 쓰려 한다. 기존 `nearby-market`은 아파트 전용이다.

## 1. 최신성 점검 (운영 DB 접근 없음 — 코드·문서·**공개 읽기 API 표본**만)

운영 DB 접근 권한이 없고 쓰지도 않았다. 아래 수치는 `https://e-jip.com`의 **공개 GET API**를 표본으로 읽은 값이며(부산 3개 구 × 구별 25개 오피스텔, 읽기 전용, 호출 간 간격 둠),
데이터셋 전체의 최댓값이 아니다. 조회 시점: 2026-10-23.

| 데이터 | 표본 최근 거래일 | 표본 수집 시각(`sourceFetchedAt`) | 자동 수집 |
| --- | --- | --- | --- |
| 오피스텔 매매 | 2026-08-29 (강서구) / 2026-08-20 (해운대구) / 2026-05-15 (부산진구) | 2026-09-04 17:07 UTC (표본 전부 동일) | **없음** — cron 라우트(`sale-sync`, `sale-recheck`, `rent-sync`)는 아파트용. 오피스텔은 `scripts/officetel/*` 수동 적재만 있다 |
| 오피스텔 전월세 | 2026-09-01 / 2026-09-03 / 2026-09-02 | 2026-09-04 17:28 UTC (표본 전부 동일) | **없음** (같은 이유) |
| 아파트 매매 | 2026-10-21 (강서구 3개월 표본) | (이 경로는 DB-first, 수집 시각 미노출) | 코드상 `vercel.json`에 `sale-sync`/`sale-recheck` 일일 cron 등록 |
| 아파트 전월세 | **미확인** (표본 조회 안 함) | — | 코드상 `rent-sync` 일일 cron 등록 |

판정(실제 확인한 범위에서만):

* 오피스텔 자료는 **2026-09-04 1회 적재 후 갱신된 흔적이 없다**(표본 75개 master 전부 같은 수집 시각). 조회 시점 기준 약 7주 전이다. **최신 시세로 표시하면 안 된다.**
* 아파트 매매는 표본 기준 거래일이 조회 시점과 이틀 차이라 최신이다. 단, cron이 Production에서 실제로 도는지(`CRON_SECRET` 설정 여부)는 DB 없이 확인하지 못했다.
* 부산 이외: 오피스텔 마스터는 부산(26xxx)만 적재되어 있다(`OFFICETEL_V1_FINAL_QA.md`). 아파트는 지역 enablement(`src/lib/region/enablement.ts`)가 정하며 부산이 기본, 서울/경기는 베타.

데이터 처리 방식(코드로 확인):

* 취소 거래: 매매는 `dealCanceled`(원천 `cdealType=O`)로 보존하고 읽기 기본은 제외. 전월세 원천에는 취소 필드가 없어 컬럼 자체가 없다.
  오피스텔 매매는 등기일이 없어 취소 신뢰도가 LIMITED.
* 중복: 자연키 유니크 + `occurrenceIndex`. 동일 내용 형제 거래는 합치지 않고 1:1 보존.
* 최근 거래가 없는 단지: 상세 API는 `attribution`(ATTRIBUTED / UNATTRIBUTED_AT_ADDRESS / NO_TRANSACTIONS)으로 "거래 없음"과 "동 구분 불가"를 나눈다.
  다동 지번 29개(6,395행)는 어느 master에도 붙이지 않는다.

## 2. 신규 API

`GET /api/officetel/nearby` — `src/app/api/officetel/nearby/route.ts`

| 파라미터 | 기본 | 제한 |
| --- | --- | --- |
| `lat`, `lng` | 필수 | 대한민국 범위, 위·경도 뒤바뀜 거부 |
| `radiusKm` | 1 | 0.1 ~ 3 |
| `limit` | 5 | 1 ~ 10 |
| `months` | 12 | 1 ~ 36 |
| `area`(전용면적 ㎡), `areaTolerance` | 없음 / 1 | 0 초과 500 이하 / 0 ~ 5 |
| `kinds` | `both` | `sale` \| `rent` \| `both` |

* 읽는 테이블: `OfficetelMaster`, `OfficetelTradeHistory`, `OfficetelRentHistory`만. 쓰기 없음. MOLIT 실시간 호출 없음.
* 쿼리 수 고정(master 1 + 매매 1 + 전월세 1 + 건수 집계 2 + 최신성 2, 귀속 확인이 필요한 master당 최대 1).
* 응답: 오피스텔만. `comparison.note`로 아파트와 같은 기준으로 비교하지 말라고 명시. 평균/중앙값 없음(원시 거래 최근 3건 + 건수).
  `dataStatus`(OK / INSUFFICIENT / NO_NEARBY_OFFICETEL), `dataAsOf`(거래일과 수집일 분리, `freshness` CURRENT/STALE/UNKNOWN, 45일 초과 STALE),
  `source`, `coverage`(부산), `truncated`, `notes`. `canonicalKey`·거래 id·원천 컬럼은 내보내지 않는다.
* 접근: `OFFICETEL_NEARBY_API_KEY`가 있으면 `x-api-key` 필요. 없으면 Production에서 **닫혀 있다(503)**. 개발/테스트에서만 열린다.
  배포만으로 우발적으로 공개되지 않는다. 호출 제한(rate limit)은 이집에 공용 구현이 없어 **이번에 만들지 않았고**, 키 + 파라미터 상한 + 응답 상한으로 제한한다.

## 3. 테스트

`node --test src/lib/officetel/nearby-contract.test.mjs` — 모의 데이터만(운영 데이터 접근 없음). 반경 검색, 거리, 정렬, 매매/전월세 구분, 면적 조건,
거래 없는 단지, 오래된 데이터(STALE), 잘못된 좌표, 과도한 반경, 응답 크기, 접근 제어, 입력 불변을 검증한다.
기존 `src/lib/officetel/*.test.mjs` 전체도 그대로 통과한다.

## 4. 한계와 운영 전 필요한 일

* 읽기 계층(`nearby-read.ts`)은 Prisma로 실제 DB를 읽는 부분이라 **DB 없이 실행 검증하지 못했다**(타입 검사와 순수 로직 테스트만).
  `officetel_masters.latitude/longitude`에 인덱스가 없어 좌표 상자 조회는 부산 5천여 행 스캔이다(규모상 허용, 인덱스 추가는 마이그레이션이라 하지 않음).
* 오피스텔 수집 자동화가 없다 — 자동 갱신 전에는 STALE 응답이 정상이다.
* 같은 지번 다동 단지 거래는 연결되지 않는다(기존 설계). 주변 분양 비교에서 거래 0건으로 보일 수 있다 — 응답의 `attribution`으로 구분한다.
* Staging DB에서 실제 응답 확인, 키 발급·보관, 호출 제한 정책 결정이 배포 전에 필요하다.
