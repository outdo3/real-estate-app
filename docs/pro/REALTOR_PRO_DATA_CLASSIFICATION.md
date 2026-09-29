# REALTOR PRO — 데이터 분류 (Phase 3)

기준: `prisma/schema.prisma` Pro 모델(커밋 5cb0cd2) · `src/lib/pro/*`. **법률 검토 전 설계 분류** — 개인정보보호법상 최종 판단은 법률 검토 필요.

## 1. 등급

| 등급 | 뜻 | 저장 | 노출 |
|---|---|---|---|
| `PUBLIC` | 이집 공공 데이터(국토부 실거래, 단지 master, 좌표, 학교) | 기존 공공 테이블(Pro는 읽기만) | 공개 화면·브리핑(공개 지역만) |
| `REALTOR_PRIVATE` | 중개사 업무 기록 | `realtor_*` | 소유 중개사만. 브리핑에는 중개사가 고른 필드만 |
| `CUSTOMER_PERSONAL` | 고객·소유자·임차인 개인정보, 중개사 자격번호 | `realtor_*` — **연락처·자격번호는 암호문 + HMAC만** | 소유 중개사만(명시적 조회 + 감사로그). 브리핑 절대 미포함 |
| `SENSITIVE_DO_NOT_STORE` | 출입 비밀번호, 도어락·공동현관 번호, 키박스 코드, 열쇠 위치, 주민등록번호, 계좌·카드·인증정보 | **저장 필드 없음** | — |

## 2. 필드별

| 테이블.필드 | 등급 | 처리 |
|---|---|---|
| `realtor_listings.apt_seq / lawd_cd / umd_name` | PUBLIC(식별자) | aptSeq는 이집 검색 결과에서만. 이름 재식별 금지 |
| `realtor_listings.apt_name_snapshot` | PUBLIC(표시용) | 표시 전용 스냅샷 |
| `realtor_listings.exclusive_area_m2 / deal_type / *_manwon / floor / floor_band` | REALTOR_PRIVATE | 브리핑에는 층 구간만(정확 층 제외) |
| `realtor_listings.building_dong / unit_ho` | REALTOR_PRIVATE | 브리핑 미포함 |
| `realtor_listings.owner_name` | CUSTOMER_PERSONAL | 목록 DTO 포함 안 함(연락처 조회 응답에서만) |
| `realtor_listings.owner_phone_enc / owner_phone_hash` | CUSTOMER_PERSONAL | AES-256-GCM + HMAC. DTO는 `hasOwnerPhone`만 |
| `realtor_listings.tenant_status / tenant_lease_ends_at / move_in_*` | REALTOR_PRIVATE(임차 관련 개인 사정 포함) | 브리핑에는 입주 가능일만 |
| `realtor_listings.viewing_method / viewing_note / memo / repair_note / parking_note / tags / source` | REALTOR_PRIVATE | 비밀번호·열쇠 패턴 감지 시 저장 전 확인. 브리핑 미포함 |
| `realtor_listing_notes.body / *_price_manwon` | REALTOR_PRIVATE | 동일 패턴 감지 |
| `realtor_customers.name` | CUSTOMER_PERSONAL | 브리핑에는 이니셜("박OO")만 |
| `realtor_customers.phone_enc / phone_hash / email_enc / email_hash` | CUSTOMER_PERSONAL | 암호문 + HMAC. 삭제 시 즉시 null |
| `realtor_customers.memo` | CUSTOMER_PERSONAL | 매칭 입력 아님. 삭제 시 즉시 null |
| `realtor_customers.consent_status / consent_recorded_at` | CUSTOMER_PERSONAL(메타) | 중개사가 받은 동의 기록 |
| `realtor_customer_preferences.*`(예산·희망 지역·면적·입주·통근 좌표·학교·반려동물) | CUSTOMER_PERSONAL | 브리핑에는 "예산 범위 안/차이" 같은 판정만(원문 금액 없음). 통근지는 좌표·라벨만 |
| `realtor_matches.reasons / score` | REALTOR_PRIVATE | 사유 문자열에 예산 금액 포함 가능 → 브리핑에는 예산 사유를 일반 문구로 치환 |
| `realtor_followups.note` | REALTOR_PRIVATE | — |
| `realtor_briefings.token_hash` | 비밀 파생값 | 원문 토큰은 생성 응답 1회만. DB·로그에 원문 없음 |
| `realtor_briefings.snapshot` | 공개 가능 필드만 | `findForbiddenSnapshotKeys` 가드 + 테스트 |
| `realtor_profiles.license_number_enc / office_reg_no_enc / business_reg_no_enc` | CUSTOMER_PERSONAL | 암호문만. 화면은 "등록됨" 여부만 |
| `realtor_profiles.display_name / office_* ` | REALTOR_PRIVATE → 브리핑에 중개사가 공개 | 중개사가 직접 입력한 사무소 연락처만 브리핑에 표시 |
| `realtor_audit_logs.*` | 메타데이터 | 대상 id·필드 이름·상태값만. 연락처·메모·이름·토큰 금지(allowlist) |

## 3. 저장하지 않는 것 (SENSITIVE_DO_NOT_STORE)

- 스키마에 다음 필드가 **없다**: 출입/현관 비밀번호, 도어락 번호, 공동현관 번호, 키박스·락박스 코드, 접근 PIN, 열쇠 보관 위치, 주민등록번호, 계좌·카드 번호, 인증 정보.
- 대체: `viewing_method`(중개사 문의 / 집주인 입회 / 임차인 조율 / 공실—중개사 문의) + 짧은 `viewing_note`.
- 자유 텍스트 패턴 감지(`detectSensitiveText`): 비번·비밀번호·도어락·현관 번호·공동현관·열쇠 위치·키박스·락박스·password·`#1234`·`*1234`·주민번호 형식 → **422 SENSITIVE_TEXT_CONFIRM**(확인 없이는 저장 안 함). 감지 여부만 감사로그(`sensitiveWarningAccepted`), 내용은 로그 없음.
- 고정 테스트: `pro-security.test.ts` "17 · 스키마에 출입 비밀번호·열쇠·PIN 필드가 없다", "자유 텍스트의 비밀번호·열쇠 패턴은 확인 없이는 저장되지 않는다".
