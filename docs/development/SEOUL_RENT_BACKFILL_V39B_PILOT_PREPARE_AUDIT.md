# E-JIP 서울 V3.9-B — 운영 Supabase 백업 검증 및 140건 시범 적재 준비 보고서

## 0. 작업 개요

- **목표**: 운영 Supabase 백업 및 PITR 실제 상태 확인, 포괄적 DELETE를 대체하는 외과적 정밀 롤백(Surgical Rollback) 체계 구축 및 Docker QA 실증, 종로구 202610 140건 시범 적재 사전 조건 검증.
- **원칙**: 이번 단계에서도 운영 DB 쓰기(`INSERT / UPDATE / DELETE / MIGRATION / RESTORE`)는 **단 1건도 실행하지 않음** (사전 준비 및 안전 검증 완료).
- **작업 브랜치**: `feat/ejip-seoul-rent-production-pilot-v39b`
- **기준 커밋**: `e9c42d1` (`feat/ejip-seoul-rent-production-prepare-v39a`)
- **운영 Supabase 프로젝트 ID**: `ztlnagzmwksgjkappfyh`
- **격리 Docker PostgreSQL**: `ejip-seoul-rent-qa` (`127.0.0.1:54332`, 240,856건 정상 보존)

---

## 1. 운영 백업 및 PITR 실제 확인 결과

`scripts/seoul-rent-backfill/seoul-rent-backup-status-probe.ts`를 통해 운영 DB 내부 아카이버 상태를 실측했습니다.

1. **PostgreSQL 내부 WAL 아카이버 실측 (`pg_stat_archiver`)**:
   - 아카이빙된 WAL 수 (`archived_count`): **4,791개**
   - 최근 성공 아카이빙 시각 (`last_archived_time`): **2026-11-25 06:55:14 UTC** (최근 분 단위 정상 동작 중)
   - 아카이빙 실패 수 (`failed_count`): **0개**
   - 아카이빙 실패 WAL (`last_failed_wal`): **NULL**
2. **Supabase 플랫폼 백업 및 PITR 활성화 여부 한계 분석**:
   - `archive_mode: on` 및 `wal_level: logical`로 설정되어 엔진 레벨에서 WAL은 정상 보존되고 있습니다.
   - 그러나 표준 데이터베이스 SQL 연결(Database Client)만으로는 Supabase 클라우드 플랫폼의 **물리적 백업 스냅샷 시각(Daily Backup)** 및 **Pro 플랜 PITR 부가기능 활성화 여부/보존 주기(7일/30일)**를 직접 조회할 수 없습니다(Supabase Management API 토큰 필요).
3. **사용자 지침 기준 최종 판정**:
   - 지침: *"archive_mode 및 wal_level 설정만으로 PITR 사용 가능 판정을 내리지 않는다. 복구 가능한 백업이 확인되지 않으면 시범 적재를 NOT READY로 판정한다."*
   - 판정: **미확인 (UNCONFIRMED)**. 사용자가 Supabase 대시보드에서 백업 시점을 육안 확인할 때까지 운영 DB 쓰기 상태는 **NOT READY (AWAITING BACKUP CONFIRMATION)**로 유지합니다.

---

## 2. 개선된 긴급 롤백 방식 (Surgical Rollback)

포괄적 범위 삭제(`DELETE WHERE lawd_cd LIKE '11%'`)의 위험성을 제거하고, **이번 실행에서 실제 삽입된 거래만 핀포인트로 식별해 롤백하는 외과적 정밀 롤백 모듈**을 구현했습니다.

- 모듈: `scripts/seoul-rent-backfill/seoul-rent-surgical-rollback.ts`
- 테스트: `scripts/seoul-rent-backfill/seoul-rent-surgical-rollback.test.ts`

### 주요 동작 구조
1. **실행 ID 및 자연키 매니페스트 영속화**:
   - 매 적재 실행 시 고유 `runId` (예: `manifest-11110-202610-1764057600`) 부여.
   - 실제 신규 `INSERT`된 행들의 자연키 튜플 `(group_key, deposit, monthly_rent, deal_date, floor, occurrence_index)`을 `tmp/qa-seoul-rent/rollback-manifests/`에 JSON으로 보존.
2. **외과적 정밀 삭제 SQL (`generateSurgicalRollbackSql`)**:
   - 전체 테이블을 스캔하거나 광범위한 조건을 삭제하지 않고, 매니페스트에 등록된 정확한 키 목록만을 `VALUES (...)` 절과 JOIN하여 일치하는 행만 원자적 트랜잭션으로 삭제.
   - 기존 unchanged 거래나 다른 셀의 거래, 특히 부산 데이터(134,475건)는 100% 보존.
3. **Docker QA 환경 실측 검증 (Test PASS)**:
   - Docker QA DB에 임의의 합성 키 2건 삽입 -> 총 건수 +2건 확인.
   - 정밀 롤백 실행 (`executeSurgicalRollback`) -> 정확히 해당 2건만 삭제되어 원복 완료 실증.

---

## 3. 종로구 202610 140건 운영 시범 적재 사전 점검

`scripts/seoul-rent-backfill/seoul-rent-production-apply-runner.ts --probe-pilot` 실측 결과:

| 점검 항목 | 요구 기준 | 실측 확인 결과 | 판정 |
| :--- | :--- | :--- | :---: |
| **운영 프로젝트 ID** | `ztlnagzmwksgjkappfyh` | URL 및 DB 사용자 모두 일치 확인 | **PASS** |
| **운영 DB 해당 셀 사전 데이터** | 0건 (완전 빈 상태) | `SELECT count(*) WHERE lawd_cd='11110' AND deal_ymd='202610'` = **0건** | **PASS** |
| **캐시 파일 재사용** | 기존 140건 캐시 재사용 | `seoul-a-cache/11110-202610.json` 존재, 140건 (전세 55, 월세 85) | **PASS** |
| **외부 MOLIT API 차단** | 0회 호출 | 로컬 JSON 파싱만 수행, 네트워크 I/O 차단 | **PASS** |
| **트랜잭션 청크 한도** | 500건 이하 | 140건 <= 500건 (단일 트랜잭션 청크로 원자적 완결) | **PASS** |
| **운영·QA 체크포인트 격리** | 상호 간섭 불가 | `environment: 'OPERATIONAL_SUPABASE'` 독립 파일 운용 | **PASS** |
| **부산 기존 데이터 보호** | 134,475건 불변 | 실측: 정확히 134,475건 (100% 보존 확인) | **PASS** |
| **오류 복구 절차** | 트랜잭션 롤백 + 정밀 롤백 | 실패 시 트랜잭션 자동 롤백 및 매니페스트 기반 키 롤백 준비 | **PASS** |

### INSERT 직후 실행할 사후 검증 SQL
```sql
SELECT count(*) AS total_inserted,
       count(*) FILTER (WHERE deal_type = 'jeonse') AS jeonse_count,
       count(*) FILTER (WHERE deal_type = 'wolse') AS wolse_count
FROM apartment_rent_histories
WHERE lawd_cd = '11110' AND deal_ymd = '202610';
-- 기대 결과: total_inserted = 140, jeonse_count = 55, wolse_count = 85
```

---

## 4. 테스트 및 프로덕션 빌드 결과

1. **자동화 단위 테스트 (Vitest)**:
   - `seoul-rent-surgical-rollback.test.ts`: 3/3 PASS
   - `seoul-rent-production-apply-runner.test.ts`: 4/4 PASS
   - `seoul-rent-all-300-cache-integrity.test.ts`: 7/7 PASS
   - **총 14개 테스트 전수 통과 (100% PASS)**
2. **Next.js 프로덕션 빌드 (`npx next build --webpack`)**:
   - **Compiled successfully (43/43 routes generated cleanly)**.

---

## 5. 최종 판정

### **종로구 140건 운영 적재 판정: NOT READY (AWAITING DASHBOARD BACKUP CONFIRMATION)**

- **사유**:
  - 엔진 레벨의 데이터 정합성, 140건 캐시, 4중 가드, 트랜잭션, 정밀 롤백 모듈은 **기술적으로 100% 준비 완료**되었습니다.
  - 다만 사용자의 엄격한 안전 지침(*"archive_mode 및 wal_level 설정만으로 PITR 사용 가능 판정을 내리지 않는다. 복구 가능한 백업이 확인되지 않으면 시범 적재를 NOT READY로 판정한다."*)에 따라, 클라우드 대시보드 상의 백업 시점이 육안 확인될 때까지 **NOT READY**로 판정합니다.
- **다음 조치**: 사용자가 Supabase 대시보드에서 최근 자동 백업 시각을 확인하거나 정밀 롤백 안전장치 기반으로 진행을 승인할 경우 즉시 시범 적재가 가능합니다.
