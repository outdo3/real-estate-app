# E-JIP 서울 V3.9-C — 종로구 전월세 140건 운영 Supabase 시범 적재 완료 보고서

## 0. 작업 개요

- **목표**: 사용자 명시적 승인에 따라 서울 종로구 2026년 10월 전월세 140건에 한해 운영 Supabase DB(`public.apartment_rent_histories`) 실제 적재 및 전수 사후 검증 수행.
- **엄격한 승인 범위 준수**: 서울 25개 구 전체(240,856건)나 타 샤드는 적재하지 않고, 오직 승인된 **종로구 11110 / 202610 단 1개 셀만 적재**.
- **작업 브랜치**: `feat/ejip-seoul-rent-production-pilot-v39c`
- **기준 커밋**: `8240d92` (`feat/ejip-seoul-rent-production-pilot-v39b`)
- **운영 Supabase 프로젝트 ID**: `ztlnagzmwksgjkappfyh`
- **호스트**: `aws-0-ap-northeast-2.pooler.***.supabase.com`

---

## 1. 운영 Supabase 프로젝트 식별 결과

- `DATABASE_URL` 및 `SUPABASE_URL` 환경변수 교차 검증:
  - 식별자: **`ztlnagzmwksgjkappfyh` (100% MATCH)**
  - 대상 데이터베이스: `postgres`
  - 대상 테이블: `public.apartment_rent_histories`

---

## 2. 실제 백업 확인 결과

- **사용자 대시보드 확인 근거**:
  - Supabase Scheduled Physical Backup 확인 (2026-11-24 19:39 UTC 스냅샷 존재).
  - PITR 추가 기능 비활성화 상태 확인.
- **안전 조치**:
  - 물리 백업 존재 기반 하에, 이번 적재 거래만 100% 핀포인트로 식별해 롤백할 수 있는 **외과적 정밀 롤백 매니페스트(`pilot-manifest-11110-202610-1795593942624.json`)**를 DB 적재 직전에 생성·영속화하여 이중 안전망을 확보했습니다.

---

## 3. 종로구 캐시 140건 무결성

- 파일: `tmp/qa-seoul-rent/seoul-a-cache/11110-202610.json`
- SHA-256 해시: `366c1c028f74c27df0162c4df19e4cb71061016d776af597fe9db52e7e01af30` (일치)
- 총 거래 건수: **140건**
- 전세: **55건**
- 월세: **85건**
- 자연키 중복: **0건**
- 외부 MOLIT API 호출: **0회 (순수 로컬 캐시 소비)**

---

## 4. 실행 직전 부산 전월세 행수

- 실행 직전 운영 DB 실측: `SELECT count(*) WHERE lawd_cd LIKE '26%'`
- **기준선 (Baseline)**: **134,475건**

---

## 5. 실제 운영 INSERT 시도 건수

- 시도 건수: **140건** (단일 트랜잭션 청크)

---

## 6. 실제 운영 INSERT 성공 건수

- 성공 건수: **140건** (소요 시간: 2,356 ms, 단일 원자적 트랜잭션 커밋 완료)

---

## 7. 종로구 전세·월세 DB 집계 (사후 실측)

운영 DB SQL 조회 결과:
```sql
SELECT 
  count(*)::bigint AS total_cnt,
  count(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
  count(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
FROM apartment_rent_histories
WHERE lawd_cd = '11110' AND deal_ymd = '202610';
```
- **총 적재 건수**: **140건 (100% 일치)**
- **전세 건수**: **55건 (100% 일치)**
- **월세 건수**: **85건 (100% 일치)**

---

## 8. 자연키 중복 여부

- `apartment_rent_histories_group_key_deposit_monthly_rent_dea_key` 고유 인덱스 기준 중복 검사:
  - 중복 건수: **0건 (중복 충돌 없음)**

---

## 9. 부산 데이터 사전·사후 비교

- 적재 전 (Pre-flight): **134,475건**
- 적재 후 (Post-apply): **134,475건**
- **변동 건수**: **0건 (100% 완전 보존)**
- 부산 전월세 조회 함수(`getRentMonthlyAggregateFromDb`) 정상 응답 확인 완료.

---

## 10. 다른 서울 지역 변경 여부

- 종로구 202610 이외의 서울 지역 전월세 행수 실측:
  ```sql
  SELECT count(*) FROM apartment_rent_histories 
  WHERE lawd_cd LIKE '11%' AND (lawd_cd != '11110' OR deal_ymd != '202610');
  ```
- **실측 결과**: **정확히 0건** (다른 24개 구 및 다른 월 데이터 일절 미변경).

---

## 11. 운영 Checkpoint 상태

- 체크포인트 파일: `tmp/qa-seoul-rent/seoul-production-pilot-checkpoint.json`
- 환경: `environment: 'OPERATIONAL_SUPABASE'`
- 완료 셀 수: **1개 셀 (`11110-202610`)**
- 상태: **`status: 'COMPLETE'`**
- 영속화 건수: 140건
- 다른 299개 셀: 운영 완료 처리되지 않음 (철저 격리).

---

## 12. 정밀 롤백 매니페스트 상태

- 매니페스트 파일: `tmp/qa-seoul-rent/rollback-manifests/pilot-manifest-11110-202610-1795593942624.json`
- 기록된 자연키 튜플 수: **140개**
- 트랜잭션 성공 여부: `transactionSuccess: true`
- 롤백 상태: `rollbackStatus: 'NOT_TRIGGERED'` (비상 롤백 대기 완료).

---

## 13. 관련 테스트 및 빌드 결과

1. **자동화 단위 테스트 (Vitest)**:
   - `seoul-rent-production-pilot-runner.test.ts`: **3/3 PASS** (멱등성 및 재실행 시 0건 추가 검증 통과)
   - `seoul-rent-surgical-rollback.test.ts`: **3/3 PASS**
   - `seoul-rent-all-300-cache-integrity.test.ts`: **7/7 PASS**
   - **총 13개 테스트 전수 통과**.
2. **Next.js 프로덕션 빌드 (`npx next build --webpack`)**:
   - **Compiled successfully (43/43 routes generated cleanly, 0 errors)**.

---

## 14. 신규 커밋 SHA

- **기준 SHA**: `8240d92`
- **신규 커밋 SHA**: `pending commit` on `feat/ejip-seoul-rent-production-pilot-v39c`
- **커밋 메시지**: `feat(seoul-v39c): apply 140 jongno 202610 rent rows to operational db and verify post-apply integrity`

---

## 15. 최종 PASS / PARTIAL / BLOCKED 판정

### **최종 판정: PASS**

- **판정 근거**:
  1. 운영 DB 종로구 202610에 정확히 140건 (전세 55 / 월세 85) 반영 완료.
  2. 자연키 중복 0건 및 필드별 정합성 100% 일치.
  3. 부산 데이터 134,475건 변동 0건 (완전 보존).
  4. 타 서울 24개 구 및 타 거래월 변동 0건.
  5. 정밀 롤백 매니페스트 및 운영 Checkpoint 정상 기록.
  6. 재실행 시 중복 0건(140건 unchanged 판정) 멱등성 실증 완료.

---

## 16. 서울 전체 240,856건 운영 적재 전 남은 위험 및 다음 작업

1. **남은 위험 평가**:
   - 이번 시범 적재를 통해 단일 셀 트랜잭션 적재 및 Option E 가드, Checkpoint, 부산 데이터 무영향성이 운영 Supabase에서 완벽히 실증되었습니다.
   - 서울 전체 240,856건(299개 셀 추가) 일괄 적재 시에는 트랜잭션 누적 시간(셀당 약 2~3초 x 299셀 = 약 10~15분)과 커넥션 풀러 유지력이 주요 고려사항입니다.
2. **권장 다음 작업 (단계적 확장)**:
   - **1단계**: seoul-a (8개 구, 96셀, 잔여 47,677건) 순차 적재.
   - **2단계**: seoul-b (9개 구, 108셀, 85,612건) 순차 적재.
   - **3단계**: seoul-c (8개 구, 96셀, 107,427건) 순차 적재.
   - 각 샤드 간 Checkpoint 및 부산 134,475건 불변을 검증하며 진행할 것을 권장합니다.
