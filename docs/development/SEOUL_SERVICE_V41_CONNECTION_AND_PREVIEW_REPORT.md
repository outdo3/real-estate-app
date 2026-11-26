# E-JIP 서울 V4.1 — 서울 25개 구 매매·전월세 서비스 연결 및 Preview 검증 보고서

## 1. 개요 및 목적

- **문서 식별자**: `SEOUL_SERVICE_V41_CONNECTION_AND_PREVIEW_REPORT_V1`
- **작업 브랜치**: `feat/ejip-seoul-service-v41`
- **기준 브랜치**: `feat/ejip-seoul-rent-production-shard-c-v39f` (`4e346eb`)
- **운영 Supabase 상태**: **Strict Read-Only** (추가/수정/삭제 0건, 데이터 완전성 100% 보존)
- **핵심 목표**:
  1. 서울 25개 구 전월세 데이터 240,856건(100% `aptSeq` 보유) 및 기적재 매매 데이터를 사용자 대면 서비스와 API에 정밀 연결.
  2. 기존 부산 전용 UI 및 실거래 API, 통계 로직을 100% 재사용하여 서울 아파트 상세, 실거래 피드, 가격 순위, 통계 대시보드에 데이터 표출.
  3. 외부 국토부(MOLIT) API 실시간 호출 차단(Zero-Call Guard) 및 DB-First 신뢰성 보장.
  4. 부산 16개 구 기존 프로덕션 기능 회귀 0건 검증.

---

## 2. 주요 변경 및 구현 내역

### 2.1 서울 전월세 검증 범위 분리 및 파라미터화 (`sync-coverage.ts`, `rent-history-read.ts`)
- 부산 전월세 검증 기간(`202408`~`202610`, 27개월)과 서울 전월세 검증 기간(`202511`~`202610`, 12개월)을 물리적으로 분리.
- `SEOUL_RENT_VERIFIED_RANGE: VerifiedRange = { from: '202511', to: '202610' }` 정의.
- `getRentVerifiedRange(lawdCdOrSido)` 헬퍼를 추가하여 서울 지역(11로 시작하는 코드) 질의 시 자동으로 `SEOUL_RENT_VERIFIED_RANGE`를 반환하도록 리팩토링.
- `fetchRentMonthBucketsFromDb`, `getRentMonthlyAggregateFromDb`, `getRentPeriodComparisonFromDb`에 해당 범위 자동 적용.

### 2.2 아파트 상세 전월세 거래 조회 및 DB-First 매핑 (`apt-detail-trade-source.ts`, `api/apt/[name]/route.ts`)
- `readDetailRentTradesFromDb(aptSeq, months)` 함수 구현: `apartment_rent_histories` 테이블에서 `dealDate >= fromDate` 조건으로 조회하여 `DetailTrade` 규격으로 변환.
- 전세/월세 분기: `monthlyRent > 0`인 경우 보증금 및 월세 금액 포맷팅, `tradeType = '전월세'` 처리.
- `/api/apt/[name]/route.ts`:
  - `type === 'rent'` 요청 시 `readDetailRentTradesFromDb`를 호출하여 DB-First로 즉시 응답.
  - 거래 내역이 0건인 경우에도 `apiError: null`로 정직하게 반환(허위 API 오류 표출 차단).

### 2.3 실거래 피드 API 서울 전월세 개방 (`api/stats/feed/route.ts`, `stats-gate.ts`)
- `isStatsFeedSupported`: 서울 25구에 대해 `sale`뿐만 아니라 `jeonse`, `wolse` 필터도 전면 개방.
- 단일 구 피드(`isSeoulDistrict`): `fetchRentMonthBucketsFromDb`와 `storedRentToFeedRaw`를 통해 DB에서만 안전하게 추출.
- 서울시 전체 피드(`isSeoulSido`): `rentSplit`을 서울 검증 기간(`202511`~`202610`)으로 제한하여 unverified 호출 0건 유지.

### 2.4 가격 순위 및 전세가율 위험 순위 (`api/stats/price-rankings/route.ts`, `stats-gate.ts`)
- `isStatsRankingSupported`: 서울 25구에 대해 `area84` 및 `jeonse-risk` 모드 전면 개방.
- `jeonse-risk` 순위 계산 시 서울 단일 구 및 시도 전체에서 `fetchRentMonthBucketsFromDb`를 활용한 DB-First 읽기 연결.

### 2.5 통계 대시보드 API 서울 개방 (`api/stats/dashboard/route.ts`)
- `isSeoulSaleStatsEligible`를 게이트에 통합하여 서울 25개 구 요청 허용.
- `isDbOnlyLawdCd` 지역(서울 25구)에 대해 미검증 전월세 국토부 태스크 발송 원천 차단 (`tasks = []`).
- 전세가율(`jeonseRate`) 및 기간별 거래량 요약(`volumeSummaryByPeriod`) 산출 정상화.

### 2.6 정기 Cron 수집 스코프 분기 사전 준비 (`api/cron/rent-sync/route.ts`)
- `resolveRentSyncScope`를 통해 URL 쿼리 파라미터(`scope=seoul-all`, `seoul-a`, `seoul-b`, `seoul-c`, `busan`) 해석.
- 운영 Cron은 미활성(Dormant) 상태로 유지하며, 추후 승인 시 안전하게 활성화 가능한 기반 마련.

---

## 3. 대표 단지 상세 조회 실측 결과

| 지역 | 단지명 | aptSeq | 매매 거래 (DB) | 전월세 거래 (DB) | 최근 전월세 거래 샘플 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **종로구** | 경희궁자이(2단지) | `11110-2445` | 23건 | **179건** | 2026-10-31 (전월세 보 13억 5,000만) |
| **마포구** | 마포래미안푸르지오1단지 | `11440-5407` | 9건 | **114건** | 2026-10-30 (전월세 보 10억) |
| **서초구** | 반포자이 | `11650-3500` | 50건 | **394건** | 2026-10-30 (전월세 보 10억 / 월세 100만) |
| **강남구** | 은마 | `11680-218` | 67건 | **693건** | 2026-10-09 (전월세 보 2억 / 월세 165만) |
| **송파구** | 헬리오시티 | `11710-8865` | 170건 | **1,683건** | 2026-10-31 (전월세 보 2억 / 월세 440만) |

- **검증 결과**: 5개 단지 전원 매매 및 전월세 거래가 DB(`tradeDataSource: 'DB'`)에서 정상 추출되며, 최근 2026년 10월 실거래까지 완벽하게 표시됨.

---

## 4. 실거래 피드 및 통계 실측 결과

### 4.1 실거래 피드 (`/api/stats/feed`)
- **마포구 (`11440`) 12개월 실적**:
  - 매매(`sale`): 총 1,820건 (11개 일자 그룹)
  - 전세(`jeonse`): 총 4,890건
  - 월세(`wolse`): 총 5,608건
  - 부분 실패 / 오류: `partial: false`, `apiError: null`
- **서울시 전체 (`sidoCode=11`) 12개월 실적**:
  - 매매(`sale`): 총 65,153건
  - 전세(`jeonse`): 총 107,001건
  - 월세(`wolse`): 총 110,745건
  - 외부 MOLIT 신규 호출: **0회 (DB 100% 서빙)**

### 4.2 가격 순위 (`/api/stats/price-rankings`)
- **강남구 84㎡ 매매 순위**: 1위 현대14차(203,204,205,206동) 52억 6,000만
- **서울시 전체 84㎡ 매매 순위**: 1위 래미안원베일리 57억 5,000만
- **마포구 전세가율 위험 순위 (`jeonse-risk`)**: 30개 단지 랭킹 정상 산출

### 4.3 통계 대시보드 (`/api/stats/dashboard`)
- 종로구(`11110`): 전세가율 **58.2%**
- 마포구(`11440`): 전세가율 **47.9%**
- 강남구(`11680`): 전세가율 **42.0%**
- 송파구(`11710`): 전세가율 **43.5%**

---

## 5. 부산 기존 서비스 0회귀 검증

- **부산 해운대구(`26350`) 대시보드**: `success: true`, 정상 산출 확인.
- **부산 전월세 피드**: 정상 동작 확인.
- **부산 단위 테스트 37종 전수 통과**: `trade-history-read.test.mjs`, `rent-verified-range.test.mjs`, `rent-verified-range-dashboard.test.mjs`.

---

## 6. 단위 및 통합 테스트 결과

1. `seoul-stats-v2.test.ts`: **3/3 PASS**
2. `seoul-25-preview-on.test.ts`: **6/6 PASS**
3. `seoul-25-go-live-switch.test.ts`: **7/7 PASS**
4. `apt-detail-trade-source.test.ts`: **14/14 PASS**
5. `trade-history-read.test.mjs`: **23/23 PASS**
6. `rent-verified-range.test.mjs`: **11/11 PASS**
7. `rent-sync-scope.test.ts`: **2/2 PASS**
8. `verify-seoul-v41-service.ts`: **전 구간 PASS (Exit 0)**
- **TypeScript 타입 검사 (`tsc --noEmit`)**:
  - `src/` 애플리케이션 코드: **에러 0건 (100% Clean)**
  - `scripts/`: 기존 스크립트 에러 외 신규 에러 없음 (`FAIL_EXISTING_SCRIPT_ERRORS`).

---

## 7. SELLFLOW 및 정기 동기화 검토

1. **SELLFLOW 호환성**:
   - `/api/presales/[id]/nearby-market`, `/api/officetel/nearby`는 독립적인 전용 로직을 유지하며, 통계 피드(`feed`) 응답 스키마가 동일하게 유지되므로 SELLFLOW 연동에 영향 없음.
2. **정기 Cron 동기화 (Rent Sync)**:
   - 현재 운영 Cron은 미활성(Dormant) 상태.
   - 추후 승인 시 `GET /api/cron/rent-sync?scope=seoul-all` 또는 샤드별(`seoul-a/b/c`)로 순차 가동 가능하도록 완전하게 분기 준비 완료.
