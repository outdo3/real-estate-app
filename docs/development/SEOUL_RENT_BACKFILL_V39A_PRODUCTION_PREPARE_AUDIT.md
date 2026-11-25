# E-JIP 서울 V3.9-A — 서울 240,856건 운영 Supabase 적재 사전 준비 및 안전 검증 보고서

## 0. 작업 개요

- **목표**: 서울 25개 구 12개월 전월세 240,856건(300셀)의 운영 Supabase 적재를 위한 사전 안전 진단, 300개 캐시 무결성 검증, 4중 가드 장착 안전 실행기 구현, 백업/롤백 절차 수립 및 서비스 개방 준비 점검.
- **원칙**: 운영 Supabase DB에 대한 어떠한 쓰기/마이그레이션도 수행하지 않음 (Read-Only 사전 점검 완료).
- **작업 브랜치**: `feat/ejip-seoul-rent-production-prepare-v39a`
- **기준 커밋**: `3f55e2d` (`feat/ejip-seoul-rent-backfill-v38b`)
- **격리 Docker PostgreSQL**: `ejip-seoul-rent-qa` (`127.0.0.1:54332`, 240,856건 정상 보존)

---

## 1. 운영 Supabase 환경 및 스키마 점검 결과

`scripts/seoul-rent-backfill/seoul-rent-production-env-audit.ts`를 통해 비밀번호 노출 없이 안전하게 읽기 전용 실측을 완료했습니다.

1. **Supabase 프로젝트 ID**:
   - `SUPABASE_URL`: `ztlnagzmwksgjkappfyh`
   - `DATABASE_URL`: `ztlnagzmwksgjkappfyh`
   - 교차 대조 결과: **MATCH (`matched: true`)**
2. **대상 DB 및 엔진**:
   - 데이터베이스: `postgres`
   - 사용자: `postgres`
   - 엔진 버전: `PostgreSQL 17.6`
   - 호스트: `aws-0-ap-northeast-2.pooler.***.supabase.com:5432` (Session / Direct pooler mode)
3. **대상 테이블 (`apartment_rent_histories`)**:
   - 테이블 존재 여부: `true` (존재함)
   - 운영 총 행수: **134,475건**
   - **기존 부산 데이터 건수**: **134,475건** (100% 부산 `lawd_cd LIKE '26%'`)
   - **서울 기존 데이터 건수**: **0건** (현재 운영 DB에 서울 전월세 행 없음)
   - 기타 지역 데이터: 0건
4. **고유 제약조건 및 인덱스**:
   - 자연키 고유 인덱스: `apartment_rent_histories_group_key_deposit_monthly_rent_dea_key` ON `(group_key, deposit, monthly_rent, deal_date, floor, occurrence_index)`
   - 기본키 인덱스: `apartment_rent_histories_pkey` ON `(id)`
   - 복합 인덱스: `(apt_seq, exclusive_area, deal_date)`, `(deal_date)`, `(identity_key, deal_date)`, `(lawd_cd, deal_date)`, `(lawd_cd, deal_type, deal_date)`
5. **로컬 QA 스키마와 운영 스키마 비교**:
   - 전체 29개 컬럼 전수 존재 (누락 컬럼 0개)
   - 모든 컬럼의 Nullability 100% 일치
   - PostgreSQL 바이너리 호환성(text vs varchar, timestamptz vs timestamp) 100% 만족
6. **저장 용량 및 한도**:
   - DB 총 사용량: 1,830 MB (~1.83 GB)
   - `apartment_rent_histories` 테이블 총 용량: 67 MB (데이터 34 MB, 인덱스 33 MB)
   - 240,856건 추가 시 예상 증가량: 약 125 MB (데이터 ~65 MB, 인덱스 ~60 MB), DB 한도 내 충분한 여유 공간 확보.
   - 설정 한도: `max_connections: 60`, `statement_timeout: 2min` (120,000ms), `idle_in_transaction_session_timeout: 0`

---

## 2. 백업 및 복구 가능성 확인

1. **운영 백업 정책 및 PITR 가능 여부**:
   - `archive_mode: on`, `wal_level: logical` 확인 완료.
   - WAL 아카이빙 활성화 상태로 Supabase 일일 백업 및 Point-In-Time-Recovery (PITR) 가용 상태 확인.
2. **긴급 롤백 절차 수립 및 격리 환경 실측 검증**:
   - 파일: `scripts/seoul-rent-backfill/ROLLBACK_SEOUL_RENT_202511_202610.sql`
   - 안전 원칙: `lawd_cd LIKE '11%'` 및 `deal_ymd BETWEEN '202511' AND '202610'`만 원자적 트랜잭션(`BEGIN ... COMMIT`)으로 삭제.
   - 부산 데이터 영향: `lawd_cd LIKE '26%'`에 대한 영향 0건 보장.
   - **실측 검증**: Docker PostgreSQL QA DB(240,856건)에서 롤백 트랜잭션 드라이런 실행 결과:
     `NOTICE: Rollback Pre-check: Target Seoul Rows = 240856`, `DELETE 240856` 정상 판정 완료.

---

## 3. 기존 부산 데이터 보호 계획

1. **완전한 지역 코드 격리**:
   - 부산: `26xxx`, 서울: `11xxx`.
   - 모든 적재 쿼리 및 중복 대조 쿼리는 대상 셀의 `lawd_cd`와 `deal_ymd`에 한정되어 실행됨.
2. **트랜잭션 가드 및 불변식 검증**:
   - `seoul-rent-production-apply-runner.ts`에 적재 전 `initialBusanRows`(134,475건) 측정 및 적재 후 `finalBusanRows` 검증 로직 탑재.
   - 불일치 시 즉시 에러 발생 및 알림.

---

## 4. 서울 25개 구 300개 캐시 파일 통합 무결성 검증

`scripts/seoul-rent-backfill/seoul-rent-all-300-cache-integrity.ts` 전수 검증 결과:

| 구분 | 대상 구 수 | 셀 수 | 거래 건수 | 전세 | 월세 | 무결성 결과 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **seoul-a** | 8개 구 | 96셀 | 47,817건 | 21,918건 | 25,899건 | **100% MATCH** |
| **seoul-b** | 9개 구 | 108셀 | 85,612건 | 44,801건 | 40,811건 | **100% MATCH** |
| **seoul-c** | 8개 구 | 96셀 | 107,427건 | 52,791건 | 54,636건 | **100% MATCH** |
| **총합계** | **25개 구** | **300셀** | **240,856건** | **119,510건** | **121,346건** | **100% PASS** |

- **300개 파일 전수 SHA-256 해시 검증**: 완료 (누락 0개, 손상 0개).
- **전역 자연키 중복 검증**: **0건** (240,856건 전체에서 자연키 충돌 0건 보장).
- **송파구 202610 캐시 재사용**: 1,404건 정상 보존 확인.
- **Fail-Fast 동작**: 캐시 디렉터리나 파일 부재 시 즉시 중단 검증 완료.

---

## 5. 운영 Apply 안전 실행기 구현

`scripts/seoul-rent-backfill/seoul-rent-production-apply-runner.ts` 구현 완료:

1. **4중 쓰기 방어 가드**:
   - `ALLOW_PRODUCTION_WRITE === 'true'`
   - CLI 인자 `--confirm-production-write`
   - `PRODUCTION_CONFIRMATION_PASSPHRASE === 'CONFIRM_APPLY_SEOUL_RENT_2026'`
   - Supabase Project ID 일치 (`ztlnagzmwksgjkappfyh`)
   - 하나라도 미충족 시 자동으로 **DRY-RUN SAFE** 모드로 실행되며 DB 쓰기를 원천 차단.
2. **체크포인트 격리**:
   - 경로: `tmp/qa-seoul-rent/seoul-production-applied-checkpoint.json`
   - `targetDbEnv: 'OPERATIONAL_SUPABASE'` 명시. QA 체크포인트 유입 시 `SECURITY MISMATCH` 에러로 차단.
3. **청크 트랜잭션**:
   - 500건 단위 트랜잭션 분할 커밋 (`BATCH_CHUNK_SIZE = 500`).
   - 실패 시 해당 셀 전체 롤백 및 중단.
4. **Zero-Call 강제**:
   - 외부 국토부 API 호출 0회 (로컬 300개 캐시만 소비).

---

## 6. 단계별 운영 적재 계획 (8단계)

실제 사용자 승인 후 적용할 8단계 계획:

1. **1단계: 운영 백업 상태 최종 확인**
   - Supabase 대시보드에서 최근 자동 백업 시각 확인.
2. **2단계: 운영 DB 연결 및 스키마 재확인**
   - `seoul-rent-production-env-audit.ts` 실행하여 134,475건 부산 데이터 및 연결 상태 재확인.
3. **3단계: 종로구 202610 (140건) 소량 시범 적재**
   - 종로구 1셀만 최초 적재하여 실제 INSERT, 자연키 중복 방지, 부산 데이터 불변 확인.
4. **4단계: seoul-a 8개 구 (96셀, 47,817건) 적재**
   - 종로, 중구, 용산, 광진, 동대문, 서대문, 마포, 금천 적재 및 체크포인트 갱신.
5. **5단계: seoul-b 9개 구 (108셀, 85,612건) 적재**
   - 성동, 중랑, 성북, 강북, 도봉, 노원, 은평, 양천, 강서 적재 및 체크포인트 갱신.
6. **6단계: seoul-c 8개 구 (96셀, 107,427건) 적재**
   - 구로, 영등포, 동작, 관악, 서초, 강남, 송파, 강동 적재 및 체크포인트 갱신.
7. **7단계: 서울 25개 구 300셀 최종 집계 검증**
   - 운영 DB `COUNT(*) FILTER (WHERE lawd_cd LIKE '11%')`가 정확히 **240,856건**인지 검증.
   - 전세 119,510건, 월세 121,346건 집계 일치 확인.
8. **8단계: 부산 전월세 기능 및 회귀 확인**
   - 부산 전월세 건수(134,475건) 불변 확인 및 부산 대시보드 API 응답 정상 확인.

---

## 7. 서비스 개방 준비 점검

코드베이스 분석 결과:

1. **이미 구현되어 배포/설정만 남은 기능**:
   - **서울 전월세 정기 갱신 (Cron)**: `src/app/api/cron/rent-sync/route.ts` 및 `rent-sync-scope.ts`에 이미 `scope=seoul-a`, `seoul-b`, `seoul-c`, `seoul-all` 지원 구현 완료. 적재 완료 후 cron 파라미터 활성화만 남음.
   - **DB-first 읽기 인프라**: `src/lib/rent-history-read.ts`에 raw SQL 기반 단일 쿼리 aggregate 및 버킷팅 구현 완료.
2. **데이터 적재 후 후속 활성화/개발이 필요한 기능**:
   - **서울 단지 상세 전월세 탭**: 현재 단지 상세(`src/app/apt/[name]/`)는 매매 실거래 중심. 전월세 탭 및 거래 내역 렌더링 컴포넌트 추가 연결 필요.
   - **실거래 피드 (`/api/stats/feed`)**: 현재 매매 중심 피드에서 전월세 거래 타입 필터링 지원 확장 필요.
   - **전세가율 및 통계 대시보드 (`/api/stats/dashboard`)**: `isStatsRegionSupported` 및 `ENABLEMENT_BY_LAWDCD`의 `stats: true` 활성화 시 서울 지역 통계 즉시 제공 가능.
   - **84㎡ 순위 (`/api/stats/price-rankings`)**: 서울 매매 순위에 전세가율 및 전세 가격 순위 탭 연동.

---

## 8. 판정

- **운영 DB 적재 판정**: **GO (READY FOR USER APPROVAL)**
- 모든 데이터의 정합성, 격리성, 복구 가능성 및 안전 실행기가 완전히 준비되었습니다.
- 사용자의 명시적 승인 전까지 운영 DB에 대한 어떠한 쓰기도 실행하지 않습니다.
