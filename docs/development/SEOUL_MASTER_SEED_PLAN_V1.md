# E-JIP SEOUL MASTER SEED PLAN V1

서울 `ApartmentMaster`(현재 0건) 구축 실행계획. **READ-ONLY** — 계획 · 원천 검증 · 규모 산출 · dry-run만.

- 날짜: 2026-09-19 (KST) · 기준 커밋 `1296814`
- 도구: `scripts/audit-seoul-master-seed-plan.ts`(단계별 probe) · `scripts/seoul-master-seed-plan-logic.ts`(순수 판정) · 테스트 `scripts/seoul-master-seed-plan-logic.test.ts`
- 결과물: `tmp/seoul-master-seed-plan/`(로컬, 커밋 안 함) — district-counts · duplicate-audit · identity-audit · coordinate-plan · existing-sale-reconcile · review-required · seed-plan-summary (+ `raw/`)
- 하지 않은 것: Production INSERT/UPDATE/DELETE · migration · schema · stats/cronSync/SEO/sitemap enable · UI 노출

## 판정: READY_FOR_SEED_APPROVAL (Tier A 6,843행 한정)

전월세 전용 Tier B(2,244)는 별도 승인 단계로 분리 권고(§5).

## 1. 현재 기준선 (Production, `SET TRANSACTION READ ONLY`)

| 항목 | 서울 | 비고 |
|---|---|---|
| ApartmentMaster | **0** (sgg_cd·apt_seq 모두) | 부산 3,438 · 경기 0 |
| 매매 | 46행 · 강남구 11680 · 2026-08-01~08-24 · aptSeq 39 · 취소 1 | 1회성 QA 파일럿, 커버리지 셀 0 |
| 전월세 | 0 | |
| sync_coverage_cells | 0 | |
| 분양 / 재개발 | 96 / 644 | 기존 그대로 |
| 학교 · location/market feature · 오피스텔 | 0 · 0/0 · 0 | 점수·학군은 부산 데이터 의존 |
| legacy `apartments` | 10 | 상세 조회 캐시 |
| 부산 좌표 공유 | 10지점 · 28단지 | §8 전역 dedupe 위험의 근거 |

코드: registry 서울 25구 존재(`src/lib/region/registry.ts:84-108`), `ENABLEMENT_BY_SIDO`에 `'11'` 없음 → app/report/stats/sitemap/seoIndex/cronSync 전부 false(`src/lib/region/enablement.ts:48-52`).

## 2. 공식 원천

| 원천 | aptSeq | 좌표 | 판정 |
|---|---|---|---|
| **MOLIT 매매 RTMSDataSvcAptTradeDev** | 있음(100%) | 없음 | **canonical seed 원천** — 부산 M4-B와 동일 |
| MOLIT 전월세 RTMSDataSvcAptRent | 있음(100%, 같은 식별 공간 — 매매 aptSeq의 91.8%가 전월세에도 존재) | 없음 | 보조 discovery. **umdCd·도로명 필드 없음** |
| 공동주택 기본정보 AptBasisInfoServiceV5 | **없음**(kaptCode) | 없음 | seed 원천 불가. 목록 서비스 operation 미해결(`APARTMENT_OFFICIAL_BASIC_INFO_SOURCE_AUDIT_V1`) → 후속 enrichment |
| 건축물대장 BldRgstHubService | 없음 | 없음 | 후속 enrichment(세대수·동수·주차·도로명주소) |
| Kakao Local | — | 있음(비공식 geocode) | 좌표 유일 경로 |

## 3. 25개 구 커버리지 (24개월 202410~202609, 동시 1·350ms·pageNo/totalCount 검증)

매매 600셀·전월세 600셀 **전부 COMPLETE**(PARTIAL/FAILED 0). 호출 매매 601 · 전월세 806(다중 페이지 셀: 매매 1 · 전월세 183, 최대 3,023행 강동구).

| 구 | 매매 aptSeq | Tier A | Tier B | REVIEW | 24m 매매 행 | 24m 전월세 행 |
|---|---|---|---|---|---|---|
| 종로구 11110 | 99 | 99 | 40 | 7 | 1,221 | 4,522 |
| 중구 11140 | 107 | 107 | 35 | 6 | 2,250 | 7,706 |
| 용산구 11170 | 183 | 183 | 60 | 1 | 2,561 | 12,855 |
| 성동구 11200 | 160 | 159 | 40 | 0 | 6,326 | 20,969 |
| 광진구 11215 | 208 | 208 | 42 | 0 | 3,168 | 10,173 |
| 동대문구 11230 | 274 | 274 | 75 | 0 | 6,758 | 20,516 |
| 중랑구 11260 | 234 | 234 | 72 | 0 | 4,781 | 14,399 |
| 성북구 11290 | 177 | 176 | 46 | 2 | 8,094 | 17,748 |
| 강북구 11305 | 117 | 116 | 47 | 0 | 2,628 | 5,899 |
| 도봉구 11320 | 179 | 179 | 35 | 0 | 4,452 | 11,004 |
| 노원구 11350 | 289 | 289 | 46 | 0 | 12,650 | 35,721 |
| 은평구 11380 | 404 | 404 | 140 | 0 | 5,869 | 18,398 |
| 서대문구 11410 | 235 | 235 | 69 | 2 | 5,898 | 14,295 |
| 마포구 11440 | 288 | 288 | 73 | 0 | 6,152 | 23,903 |
| 양천구 11470 | 378 | 378 | 95 | 0 | 6,042 | 22,247 |
| 강서구 11500 | 519 | 519 | 174 | 0 | 8,656 | 28,558 |
| 구로구 11530 | 376 | 376 | 255 | 0 | 7,384 | 20,752 |
| 금천구 11545 | 125 | 125 | 45 | 0 | 2,108 | 6,906 |
| 영등포구 11560 | 255 | 255 | 37 | 0 | 7,463 | 22,161 |
| 동작구 11590 | 209 | 209 | 48 | 0 | 6,395 | 18,289 |
| 관악구 11620 | 239 | 238 | 102 | 0 | 4,521 | 12,569 |
| 서초구 11650 | 503 | 503 | 239 | 0 | 5,373 | 31,486 |
| 강남구 11680 | 472 | 472 | 231 | 0 | 7,033 | 46,363 |
| 송파구 11710 | 369 | 369 | 88 | 0 | 9,438 | 41,580 |
| 강동구 11740 | 448 | 448 | 110 | 0 | 8,652 | 33,096 |
| **합계** | **6,847**(구별 합) | **6,843** | **2,244** | **18** | **145,873** | **502,115** |

(구별 Tier 값은 `district-counts.json`의 `final` 필드. 매매 aptSeq 구별 합 6,847 − 여러 구 응답 중복 4 = 고유 6,843.)

## 4. 예상 MASTER 행 · aptSeq 커버리지

- 고유 aptSeq **9,105** = Tier A 6,843 + Tier B 2,244 + REVIEW 18.
- 원천 행 aptSeq null **0**(매매·전월세 모두), 형식 오류 **0**, 서울 외 prefix **0**, 다른 구 sggCd 행 **0**(부산·경기 오염 없음).
- 기존 부산 기준과 같은 방법(매매 24개월)이면 **6,843행**.

## 5. Tier 정의

| Tier | 수 | 정의 | 권고 |
|---|---|---|---|
| **A — 매매 discovery** | 6,843 | 매매 원천에 aptSeq·단지명·법정동명·**umdCd**·지번이 모두 있고 원천끼리 어긋남 없음 | **1차 seed 대상** |
| B — 전월세 전용 | 2,244 | 24개월 매매 없음, 전월세에만 등장(LH 임대·신축·소형 주상복합 등). umdCd는 **같은 구 매매 원천의 (구, 법정동명)→umdCd 대응이 하나뿐일 때만** 보강(331쌍, 모호 0) | **별도 승인 단계**: 이름이 상가·빌딩·지번 표기인 196건, 24개월 거래 ≤3건 1,185건 — 표시 정책 결정 후 |
| REVIEW_REQUIRED | 18 | 전월세 전용 + 그 법정동에 매매 원천 대응 없음 → umdCd 확정 불가 | 자동 seed 금지(`review-required.json`) — 절반 이상이 상가·빌딩 성격 |

## 6. 중복 감사 (`duplicate-audit.json`)

| 유형 | 수 | 규칙 |
|---|---|---|
| 같은 aptSeq가 여러 구 응답에 | **4** | 전부 이름·법정동·umdCd·지번이 동일한 **MOLIT 오기재**(예: 11140-1012 한진해모로가 성동구 응답에 1건) → aptSeq 앞 5자리 구를 canonical로. 표기가 다르면 CONFLICT(0건) |
| 같은 구·같은 정규화 이름, 다른 aptSeq | 260그룹 · 576 aptSeq | 차수·동군 — **merge 금지** |
| 같은 법정동+지번, 다른 aptSeq | 35그룹 · 88 aptSeq | 한 필지 여러 등록 단위 — 건축물대장 값을 서로 복사하지 않음(enrich REVIEW) |
| 같은 원천 도로명, 다른 aptSeq | 73그룹 · 168 aptSeq | 보고만 |
| 한 aptSeq의 이름 변형 | 2 | "(토지임대부아파트)" 접미 — 최신 표기 사용, identity 불변 |

## 7. 기존 서울 매매 파일럿 대조 (MASTER → 거래 방향)

46행(aptSeq 39) 전부 **EXACT**(aptSeq·구·법정동·지번 일치, 이름 정규화 일치). REVIEW 0 · UNMATCHED 0. 거래로 master를 만들지 않는다.

## 8. 좌표

- 원천 좌표 없음(MOLIT 매매/전월세·K-apt V5·건축물대장 모두 위경도 필드 없음) → Kakao만.
- 표본 100(Tier A 75 · B 25, 구별 균등, 저장 없음):
  - 현행 방식(키워드 검색에 주소 문자열, 시도·**구** 일치 확인): ACCEPT 95 · 키워드 첫 결과만 3 · 결과 없음 2 · 다른 구 0.
  - **Kakao 주소 검색(`address.json`, `analyze_type=exact`)**: `서울 {구} {법정동} {지번}` → **100/100이 법정동·본번·부번까지 일치하는 단일 결과**(현행 방식이 못 찾은 5건 포함).
  - 두 방식 거리: 중앙 4m · p90 33m · 최대 582m(e편한세상신촌3단지 — 대단지에서 도로명 출입구 vs 필지 대표점 차이).
- **seed 좌표 정책(부산 M4-B보다 엄격)**
  1. 1순위: `address.json` 지번 geocode — 결과 구·법정동·본번·부번이 원천과 모두 같을 때만 `geocodeQuality='exact'`.
  2. 2순위(1순위 실패 시): 주소 문자열 키워드 결과가 같은 시도·구일 때만.
  3. `"{동} {단지명}"` 키워드 첫 결과는 저장하지 않는다 → REVIEW(부산의 `normalized` 경로 미사용).
  4. 동 중심·인근 단지 좌표 대체 금지.
  5. 같은 필지(§6, 35그룹)는 같은 좌표가 정상 — 필지 좌표임을 artifact에 표시. **서로 다른 필지인데 좌표가 같은 경우만** batch 안에서 null 처리.
- 예상 커버리지: Tier A **≈100%**(표본 75/75 필지 일치), Tier B ≈100%(25/25). 표본 기반 추정 — 전수는 seed dry-run에서 확정.

## 9. 필수 필드 (현 schema, seed 단계)

| 필드 | 값 | 원천 |
|---|---|---|
| aptSeq | 원천 그대로 | MOLIT |
| name / normalizedName | 최신 계약일 표기 / 공백·"아파트" 제거 | MOLIT |
| sido / sigungu | '서울특별시' / 구 이름 | registry |
| sggCd | aptSeq 앞 5자리 = 조회 lawdCd | MOLIT |
| umdName / umdCd | 원천 | MOLIT 매매 |
| jibun | 원천 | MOLIT |
| buildYear | 원천(참고용) | MOLIT |
| latitude / longitude / geocodeQuality | §8 1·2순위만, 아니면 null | Kakao |
| basicSpecSource | 기본값 UNKNOWN | — |

`roadAddress` 컬럼은 schema 주석상 **건축물대장 newPlatPlc**이므로 seed에서 MOLIT 도로명(`roadNm`+건물번호)을 넣지 않는다(의미 변경 금지). MOLIT 도로명은 geocode 질의에만 쓴다.

## 10. 후속 enrichment 필드

`mgmBldrgstPk` · `roadAddress` · `jibunAddress` · `useApprovalDate` · `mainBuildingCount` · `totalHouseholds` · `parkingCount` · `floorAreaRatio` · `buildingCoverageRatio` · `parkingPerHousehold` · `basicSpecSource`

- 경로: `scripts/backfill-apartment-master-basic-data.ts`(총괄표제부 → 표제부 fallback, 부산 92.5% 세대수 달성) — **현재 `sggCd startsWith '26'` 하드코딩**(:360) → 지역 인자화 필요(코드 변경, 별도 STEP).
- 표본: 총괄표제부 성공 40/100(세대수 39) · not_found 59 · api_error 1 → 표제부 fallback 없이는 세대수 40% 수준.
- K-apt V5(세대수·동수·관리방식·난방 등)는 kaptCode crosswalk 전제 — 목록 서비스 operation 확정 전까지 보류.

## 11. 규모 · quota

| 항목 | 규모 | MOLIT 호출 | 창(10,000/endpoint) |
|---|---|---|---|
| MASTER discovery(24m 매매+전월세) | 9,105 aptSeq | 매매 601 · 전월세 806 | 각 1 |
| MASTER 좌표(address.json 1회/단지) | 6,843 (A) · 9,087 (A+B) | Kakao 6,843~9,087 | Kakao 한도는 이번 STEP 미확인 |
| 건축물대장 enrichment | 최대 2회/단지 | 13,686 (A) | 오퍼레이션별 1~2 |
| SALE 24개월 | 145,873행 | 601 | 1 |
| SALE 전체 이력(2006~) | 추정 **약 0.8~1.2M행**(6월 표본: 2006 5,041 · 2010 2,135 · 2014 5,268 · 2018 5,248 · 2022 1,146 · 최근 24m 월평균 6,078) | 25구 × 249개월 ≈ 6,300 | 1 |
| RENT 24개월 | 502,115행 | 806 | 1 |
| RENT 전체 이력(2011~) | 추정 **약 2.5~3.5M행**(6월: 2014 11,739 · 2018 12,348 · 2022 20,589) | 25구 × 190개월 × ~1.3쪽 ≈ 6,200 | 1 |

quota 수치는 `MOLIT_QUOTA_SCALE_PROBE_V1`의 실측(`x-ratelimit-limit: 10000`, endpoint별 독립)을 따른다. 이력 행 수는 연 1개월 표본 외삽이라 범위로만 적는다.

## 12. 적재 구조 (PHASE A~H)

| PHASE | 내용 | 이번 STEP |
|---|---|---|
| A | 공식 discovery(매매·전월세 24m, 페이지 검증) → raw 후보 | **수행** |
| B | canonical 검증(aptSeq 형식·구 일치·필수 필드·위치 충돌) | **수행** |
| C | 중복/identity 분류(여러 구 오기재·같은 필지·alias) → Tier | **수행** |
| D | 좌표(address.json 필지 일치) | **표본 수행**(100) |
| E | dry-run artifact(삽입 예정 행 전체 + 좌표 결과) | 계획(아래 seed 스크립트 dry-run) |
| F | 명시 승인 | **여기서 정지** |
| G | Production insert | 미수행 |
| H | 사후 감사(행 수·구별 분포·중복 0·부산 행 불변) | 미수행 |

## 13. seed 스크립트 설계 (구현은 승인 후)

기존 `apartment_master_seed.ts`를 서울에 그대로 쓰지 않는다 — 실측 확인한 결함:

1. **페이지 없음**: `numOfRows=1000` 1쪽만, totalCount 미검증 → 서울 노원구 매매 1,042행 셀 절단.
2. **실패 = 0건**: 오류 응답을 `[]`로 반환 → 실패와 무거래를 구분 못 함.
3. **전역 좌표 dedupe**: `deduplicateCoordinates()`가 **전체** master를 읽고 update — 서울 실행이 부산 28단지 좌표를 null로 만들 수 있다(부산 현재 공유 10지점·28단지 실측).
4. `normalized`(단지명 키워드 첫 결과) 좌표 저장.
5. upsert(update 경로) — 첫 seed에는 불필요한 덮어쓰기 경로.

새 스크립트(예: `scripts/seoul-master-seed.ts`) 요건:

- **dry-run 기본**, `--apply` + `ALLOW_PROD_DB_WRITE=1`(BACKFILL 가드)일 때만 write.
- **create-only**(`repair-recent-missing-masters.ts` 패턴): 이미 있는 aptSeq는 SKIP, update 경로 없음.
- aptSeq unique 제약 = 중복 방지 최종선. `sggCd LIKE '11%'` 외 행은 읽기·쓰기 대상 아님.
- 구 단위 checkpoint 파일 → 부분 실패 후 재개(완료 구 건너뜀).
- discovery는 `fetchCell`과 같은 pageNo/totalCount 검증, PARTIAL 셀이 있는 구는 seed 대상에서 제외(구 전체 보류).
- 좌표는 §8 정책, 동일 좌표 판정은 이번 batch 안에서만.
- 결과 artifact: 삽입된 `{id, aptSeq, sggCd, createdAt}` 전체 목록 + batch 시작/종료 시각.

## 14. Rollback (schema 변경 없음)

- 서울 master는 현재 0행 → seed 후 서울 행 = 이번 batch 행.
- rollback = artifact의 **id 목록**으로 `DELETE FROM apartment_masters WHERE id = ANY($ids) AND sgg_cd LIKE '11%' AND created_at BETWEEN batchStart AND batchEnd`(3중 조건, 부산 행 영향 불가).
- `seed_batch_id` 컬럼은 **필요 없음**(id 목록 + created_at 창으로 충분) — schema 변경 제안 없음.
- 서울 aptSeq를 참조하는 다른 테이블(location/market feature 등)은 seed 이후 단계에서만 생기므로 seed 직후 rollback은 단독 삭제로 끝난다.

## 15. REVIEW_REQUIRED (자동 insert 금지, `review-required.json`)

- aptSeq 없음(0) · 형식 오류(0) · 앞 5자리 ≠ 구(여러 구 오기재 4건은 표기 동일로 해소, 충돌 0)
- 원천끼리 법정동코드·지번 불일치(0)
- 필수 필드 누락: 전월세 전용 + umdCd 확정 불가 **18**
- 여러 구 표기 충돌(0)
- 좌표: 필지 불일치·키워드만(표본 Tier A 3건 수준 → 좌표 null + 목록)
- 서울 외 구 코드(0)

## 16. 서울 공개 게이트 (MASTER만으로 열지 않는다)

1. MASTER trusted — Tier A seed + 사후 감사 통과
2. SALE trusted — 서울 매매 적재 + `sync_coverage_cells` 전 셀 COMPLETE(다중 페이지 셀 실증), 결함 A(취소 래칫) 수정 선행
3. RENT trusted — 전월세 적재(월 3,000행 셀 → 다중 페이지 필수), 검증 범위 부산 하드코딩(`getRentVerifiedRange`) 해소
4. 좌표 acceptable — master 좌표 ≥ 95% exact
5. stats DB-first — 통계 경로가 `cronSync` 축으로 DB를 읽음
6. cronSync trusted — sale/rent cron이 25구 추가 후 60s 예산 안에서 회전(현재 `vercel.json`이 `districtOffset`을 넘기지 않음)
7. 그 뒤 `stats=true` + `cronSync=true` **동시** enable(stats만 열면 live로 떨어짐)
8. SEO/sitemap 마지막

(점수·학군·교통 보정은 부산 기준 — `SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1` §9~12, 공개 전 별도 게이트.)

## 17. 예상 seed 소요 (실측 기반)

- discovery(24m 매매+전월세): 1,407호출 **8분 45초 실측**.
- 좌표 address.json 1회/단지: 표본 100건 약 1분 실측 → Tier A 6,843 ≈ **1~1.5시간**.
- DB insert(create 단건): Tier A 6,843 ≈ 수 분.
- 건축물대장 enrichment(별도 STEP): 1.5s 간격 + 429 냉각 — 표본 100건 20.6분(Kakao 포함) → 6,843건 수 시간~하루, 여러 창 분할.

## 18. 테스트

- `scripts/seoul-master-seed-plan-logic.test.ts` 12개: aptSeq 단위 집계 · null aptSeq 미생성 · 구 오염 · 필수 필드/형식/위치 충돌 · alias · 중복 그룹(merge 없음) · 원천 도로명 · 파일럿 대조 · 좌표 판정 · quota 창 · 여러 구 오기재 · umdCd 보강(대응 1개만).
- probe 자체 검증: 25구 × 24개월 × 2 dataset 전 셀 COMPLETE · aptSeq 고유성(여러 구 4건 해소) · 구 코드 정확성(prefix 불일치 0 after 해소) · 부산/경기 오염 0 · fuzzy 배정 0(이름으로 aptSeq를 만들거나 합치지 않음).

## 19. No-write assertion

Production INSERT 0 · UPDATE 0 · DELETE 0 · migration 0 · schema change 0 · stats enable 0 · cronSync enable 0 · SEO/sitemap enable 0. 외부 호출은 전부 GET(MOLIT 1,607 · 건축물대장 127 · Kakao 450).

## 20. Blockers (seed 자체는 없음, 공개 전 해결)

- seed 스크립트 신규 작성(§13) — 승인 후 구현.
- 건축물대장 backfill 지역 인자화, 좌표 dedupe 범위 제한.
- 매매 결함 A(취소 래칫) — 서울 매매 적재 전 수정.
- cron 회전(25구 추가 시 60s 예산).
- Tier B 표시 정책(상가·빌딩·지번 이름 196건).

## 21. Production seed 제안

- 범위: **Tier A 6,843행**(매매 24개월 discovery, 부산 M4-B와 같은 방법).
- 필드: §9만(좌표는 필지 일치만), enrichment 필드 null.
- 순서: 새 seed 스크립트 구현 → 로컬 테스트 → dry-run artifact(삽입 예정 6,843행 + 좌표) 검토 → **파일럿 1개 구(중구 11140, 107행)** apply → 사후 감사 → 나머지 24구 → 전체 사후 감사.
- 공개 상태 변화 없음(enablement 그대로).
