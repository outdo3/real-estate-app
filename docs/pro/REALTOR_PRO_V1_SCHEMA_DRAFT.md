# REALTOR PRO V1 — Schema 초안 (DRAFT)

> **DRAFT — `prisma/schema.prisma`에 반영되지 않았다. migration 없음.**
> 아래 model 스케치는 검토용이며, 실제 반영은 AGENTS.md "Database and production safety"에 따라 **명시적 승인 후** 별도 STEP에서 진행한다.

## 1. 공통 규칙 (repo 관행 준수)

| 규칙 | 근거 |
|---|---|
| PK `String @id @default(cuid())` | 사용자 데이터 테이블 관행(`Favorite`, `UserFeedback`) |
| 컬럼 snake_case `@map`, 테이블 `@@map("realtor_...")` | 전역 관행 |
| 소유 컬럼 `realtorId` → `realtor_profiles.id` (`onDelete: Cascade`) | 중개사 탈퇴 시 일괄 삭제 |
| `realtor_profiles.userId` → `users.id` unique | 기존 User 재사용, 1:1 |
| 단지 참조 = `aptSeq String?` (FK 아님) + `aptNameSnapshot`(표시용) | `ApartmentLocationFeature` 선례: master는 배치 재구축 테이블이라 formal FK 없음. **이름으로 재식별 금지** |
| 면적 = `exclusiveAreaM2 Decimal?` (= `canonicalExclusiveArea` 값) | Unit Master identity 보존, 평형 파생 저장 금지 |
| 상태값은 PG enum 대신 `String` + CHECK 제약(migration에서) | `USER_FEEDBACK_V1` 결정(TEXT+CHECK) 관행 |
| 금액 단위: **만원 정수** (`Int`) | MOLIT dealAmount 단위와 일치, 소수 없음 |
| 모든 테이블: 생성 migration에서 anon/authenticated/service_role revoke + `ENABLE ROW LEVEL SECURITY`(정책 없음) | Batch A 관행. 앱(Prisma owner)은 RLS 우회 → **앱 레이어 소유권 검사가 1차 통제** |
| soft delete: `deletedAt DateTime?` (고객·매물) | 30일 후 hard delete 배치 |
| 시간은 `timestamptz`(UTC 저장), 표시·판정은 KST | analytics 메모: naive UTC 혼동 방지 |

## 2. 테이블 요약

| 테이블 | 역할 | 소유 컬럼 | 데이터 등급 |
|---|---|---|---|
| `realtor_profiles` | 중개사 신원·인증 상태 | `user_id`(unique) | CUSTOMER_PERSONAL(자격번호) |
| `realtor_subscriptions` | 플랜·기간 | `realtor_id` | REALTOR_PRIVATE |
| `realtor_listings` | 비공개 매물 | `realtor_id` | REALTOR_PRIVATE + CUSTOMER_PERSONAL(소유자·임차인) |
| `realtor_listing_notes` | 매물 이력형 노트·가격 변경 | `realtor_id` | REALTOR_PRIVATE |
| `realtor_customers` | 고객 CRM | `realtor_id` | CUSTOMER_PERSONAL |
| `realtor_customer_preferences` | 구조화 매칭 조건 | `realtor_id` | CUSTOMER_PERSONAL |
| `realtor_matches` | 매칭 결과·사유 | `realtor_id` | REALTOR_PRIVATE |
| `realtor_followups` | 재연락·일정 | `realtor_id` | REALTOR_PRIVATE |
| `realtor_briefings` | 공유 스냅샷·토큰 | `realtor_id` | 스냅샷은 PUBLIC+선택 필드만 |
| `realtor_audit_logs` | 민감 작업 감사 | `actor_user_id` | 메타데이터만 |

`realtorId`를 자식 테이블(`notes`, `preferences`, `matches` 등)에도 **중복 보관**한다 — 모든 쿼리를 `where realtorId = ?` 한 조건으로 강제할 수 있고, 조인 누락으로 인한 타인 데이터 노출을 구조적으로 줄인다. 쓰기 시 부모와 `realtorId` 일치를 검증.

## 3. Model 스케치 (DRAFT)

```prisma
// ───────── DRAFT — NOT IN schema.prisma ─────────

model RealtorProfile {
  id     String @id @default(cuid())
  userId String @unique @map("user_id")

  displayName   String  @map("display_name")      // 브리핑 표시 이름
  officeName    String? @map("office_name")
  officePhone   String? @map("office_phone")      // 공개 가능(브리핑) — 중개사가 명시 입력
  officeAddress String? @map("office_address")
  logoUrl       String? @map("logo_url")          // Pro, Supabase storage 경로

  licenseNumberEnc  String? @map("license_number_enc")   // 자격번호(암호화), 화면 마스킹
  officeRegNoEnc    String? @map("office_reg_no_enc")    // 중개사무소 등록번호(암호화)
  businessRegNoEnc  String? @map("business_reg_no_enc")  // 사업자번호(선택)

  // 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED'  (CHECK)
  status          String    @default("PENDING_REVIEW")
  statusReason    String?   @map("status_reason")        // 반려/정지 사유(중개사에게 보임)
  reviewedByUserId String?  @map("reviewed_by_user_id")
  reviewedAt      DateTime? @map("reviewed_at")
  termsAgreedAt   DateTime  @map("terms_agreed_at")      // Pro 약관·처리위탁 동의 시각
  termsVersion    String    @map("terms_version")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  // listings, customers, ... (relations)

  @@index([status, createdAt])
  @@map("realtor_profiles")
}

model RealtorSubscription {
  id        String @id @default(cuid())
  realtorId String @map("realtor_id")

  plan   String   // 'FREE' | 'PRO'                         (CHECK)
  status String   // 'ACTIVE' | 'BETA_GRANT' | 'GRACE' | 'CANCELED' | 'EXPIRED' (CHECK)
  currentPeriodStart DateTime  @map("current_period_start")
  currentPeriodEnd   DateTime? @map("current_period_end")
  provider           String?   // 결제사 — Phase 3
  providerRef        String?   @map("provider_ref")  // 외부 구독 id(비밀 아님), 카드정보 저장 금지
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  realtor RealtorProfile @relation(fields: [realtorId], references: [id], onDelete: Cascade)

  @@index([realtorId, status])
  @@map("realtor_subscriptions")
}

model RealtorListing {
  id        String @id @default(cuid())
  realtorId String @map("realtor_id")

  // 단지 identity — aptSeq 우선, 이름은 표시 스냅샷(재식별 금지)
  aptSeq          String? @map("apt_seq")
  lawdCd          String? @map("lawd_cd")
  umdName         String? @map("umd_name")          // 법정동(dong)
  aptNameSnapshot String  @map("apt_name_snapshot")

  buildingDong String? @map("building_dong")        // 동(101동) — PRIVATE
  unitHo       String? @map("unit_ho")              // 호수 — PRIVATE, 브리핑 미포함
  floor        Int?
  floorBand    String? @map("floor_band")           // 'LOW'|'MID'|'HIGH' (브리핑 기본 표기)

  exclusiveAreaM2 Decimal? @map("exclusive_area_m2") // = ApartmentUnitType.canonicalExclusiveArea
  unitTypeRef     Int?     @map("unit_type_ref")     // ApartmentUnitType.id(선택, FK 아님)

  dealType          String  @map("deal_type")        // 'SALE'|'JEONSE'|'MONTHLY' (CHECK)
  askingPriceManwon Int?    @map("asking_price_manwon")   // 매매 호가
  depositManwon     Int?    @map("deposit_manwon")
  monthlyRentManwon Int?    @map("monthly_rent_manwon")

  // 소유자(CUSTOMER_PERSONAL) — 연락처 암호화
  ownerName      String? @map("owner_name")
  ownerPhoneEnc  String? @map("owner_phone_enc")
  ownerPhoneHash String? @map("owner_phone_hash")   // HMAC, 중복 탐지/검색용

  tenantStatus      String?   @map("tenant_status")      // 'VACANT'|'OWNER_OCCUPIED'|'TENANTED'
  tenantLeaseEndsAt DateTime? @map("tenant_lease_ends_at") // 만기 임박 대시보드
  moveInAvailableAt DateTime? @map("move_in_available_at")
  moveInNegotiable  Boolean   @default(false) @map("move_in_negotiable")

  repairStatus  String? @map("repair_status")        // 'ORIGINAL'|'PARTIAL'|'FULL'
  repairNote    String? @map("repair_note")
  parkingNote   String? @map("parking_note")
  petAllowed    Boolean? @map("pet_allowed")

  // 출입 비밀번호·열쇠 위치 필드는 의도적으로 없음(SENSITIVE_DO_NOT_STORE)
  viewingMethod String  @default("CONTACT_REALTOR") @map("viewing_method")
  viewingNote   String? @map("viewing_note")        // 비밀번호 패턴 경고 대상

  source   String? // 'OWNER_DIRECT'|'CO_BROKER'|'WALK_IN'|'OTHER'
  memo     String? // 기본 메모(자유 텍스트)
  tags     String[] @default([])

  isActive   Boolean   @default(true) @map("is_active")
  closedAt   DateTime? @map("closed_at")             // 계약완료
  priceChangedAt DateTime? @map("price_changed_at")  // 대시보드 "가격 변경"
  deletedAt  DateTime? @map("deleted_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")

  realtor RealtorProfile @relation(fields: [realtorId], references: [id], onDelete: Cascade)

  @@index([realtorId, isActive, updatedAt(sort: Desc)])
  @@index([realtorId, aptSeq])
  @@index([realtorId, tenantLeaseEndsAt])
  @@map("realtor_listings")
}

model RealtorListingNote {
  id        String @id @default(cuid())
  realtorId String @map("realtor_id")
  listingId String @map("listing_id")

  kind String   // 'NOTE'|'PRICE_CHANGE'|'STATUS_CHANGE' (CHECK)
  body String?  // NOTE 본문(비밀번호 패턴 경고 대상)
  prevPriceManwon Int? @map("prev_price_manwon")
  newPriceManwon  Int? @map("new_price_manwon")
  createdAt DateTime @default(now()) @map("created_at")

  listing RealtorListing @relation(fields: [listingId], references: [id], onDelete: Cascade)

  @@index([realtorId, listingId, createdAt(sort: Desc)])
  @@map("realtor_listing_notes")
}

model RealtorCustomer {
  id        String @id @default(cuid())
  realtorId String @map("realtor_id")

  name          String                                // 별칭 허용("박OO")
  phoneEnc      String? @map("phone_enc")
  phoneHash     String? @map("phone_hash")
  status        String  @default("NEW")                // 'NEW'|'ACTIVE'|'ON_HOLD'|'CONTRACTED'|'CLOSED'
  priority      Int     @default(2)                    // 1 높음 ~ 3 낮음
  nextFollowUpAt DateTime? @map("next_follow_up_at")   // 비정규화(대시보드 정렬용), 원본은 followups
  memo          String?                                // 자유 텍스트 — 매칭 입력 아님

  consentStatus     String    @default("NOT_RECORDED") @map("consent_status") // 'NOT_RECORDED'|'VERBAL'|'WRITTEN'|'WITHDRAWN'
  consentRecordedAt DateTime? @map("consent_recorded_at")

  lastActivityAt DateTime  @default(now()) @map("last_activity_at")  // 보존기한 판정
  deletedAt      DateTime? @map("deleted_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  realtor RealtorProfile @relation(fields: [realtorId], references: [id], onDelete: Cascade)

  @@index([realtorId, status, priority])
  @@index([realtorId, nextFollowUpAt])
  @@index([realtorId, phoneHash])
  @@map("realtor_customers")
}

// 구조화 매칭 조건 — 자유 메모와 분리. 고객당 Free 1세트, Pro 3세트
model RealtorCustomerPreference {
  id         String @id @default(cuid())
  realtorId  String @map("realtor_id")
  customerId String @map("customer_id")
  label      String @default("기본")

  dealTypes        String[] @map("deal_types")          // ['SALE','JEONSE',...]
  budgetMinManwon  Int?     @map("budget_min_manwon")
  budgetMaxManwon  Int?     @map("budget_max_manwon")
  budgetTolerancePct Int    @default(0) @map("budget_tolerance_pct") // 0~10
  monthlyRentMaxManwon Int? @map("monthly_rent_max_manwon")

  lawdCds  String[] @default([]) @map("lawd_cds")       // 희망 시군구
  aptSeqs  String[] @default([]) @map("apt_seqs")       // 희망 단지(aptSeq) — 이름 아님
  areaMinM2 Decimal? @map("area_min_m2")
  areaMaxM2 Decimal? @map("area_max_m2")
  moveInTargetAt DateTime? @map("move_in_target_at")

  commuteLabel String? @map("commute_label")            // "센텀시티역" 표시용
  commuteLat   Float?  @map("commute_lat")              // 좌표만(주소 원문 저장 최소화)
  commuteLng   Float?  @map("commute_lng")
  schoolIds    Int[]   @default([]) @map("school_ids")  // School.id
  preferNewBuild Boolean? @map("prefer_new_build")
  parkingRequired Boolean? @map("parking_required")
  floorPreference String?  @map("floor_preference")     // 'LOW'|'MID'|'HIGH'
  petRequired     Boolean? @map("pet_required")
  mustHaveKeys    String[] @default([]) @map("must_have_keys") // hard filter로 승격할 항목 키
  weightsOverride Json?    @map("weights_override")     // Phase 2

  updatedAt DateTime @updatedAt @map("updated_at")
  customer RealtorCustomer @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@index([realtorId, customerId])
  @@map("realtor_customer_preferences")
}

model RealtorMatch {
  id           String @id @default(cuid())
  realtorId    String @map("realtor_id")
  customerId   String @map("customer_id")
  preferenceId String @map("preference_id")
  listingId    String @map("listing_id")

  score         Int?     // 0~100, 정보 부족 시 null
  passedHard    Boolean  @map("passed_hard")
  reasons       Json     // [{key, verdict:'MATCH'|'PARTIAL'|'MISS'|'UNKNOWN', weight, detail}]
  engineVersion String   @map("engine_version")        // "v1.0"
  inputHash     String   @map("input_hash")            // 재계산 필요 판정
  state         String   @default("NEW")               // 'NEW'|'SEEN'|'SHORTLISTED'|'DISMISSED'
  computedAt    DateTime @map("computed_at")

  @@unique([preferenceId, listingId])
  @@index([realtorId, state, score(sort: Desc)])
  @@index([realtorId, listingId])
  @@map("realtor_matches")
}

model RealtorFollowup {
  id         String  @id @default(cuid())
  realtorId  String  @map("realtor_id")
  customerId String? @map("customer_id")
  listingId  String? @map("listing_id")

  kind   String   // 'CALL'|'VIEWING'|'CONTRACT'|'MOVE_IN'|'OTHER'
  dueAt  DateTime @map("due_at")
  note   String?
  doneAt DateTime? @map("done_at")
  repeatRule String? @map("repeat_rule")               // Pro, 'WEEKLY' 등 단순 규칙
  createdAt DateTime @default(now()) @map("created_at")

  @@index([realtorId, doneAt, dueAt])
  @@map("realtor_followups")
}

model RealtorBriefing {
  id         String  @id @default(cuid())
  realtorId  String  @map("realtor_id")
  customerId String? @map("customer_id")   // 내부 추적용, 스냅샷에는 이니셜만
  listingId  String? @map("listing_id")
  aptSeq     String? @map("apt_seq")

  tokenHash  String   @unique @map("token_hash") // SHA-256, 원문 저장 안 함
  snapshot   Json?                          // 표시 필드 전체(개인정보 제외). 만료+90일 후 null
  dataAsOf   DateTime @map("data_as_of")    // 공공 데이터 기준일
  expiresAt  DateTime @map("expires_at")
  revokedAt  DateTime? @map("revoked_at")
  firstViewedAt DateTime? @map("first_viewed_at")
  viewCount  Int      @default(0) @map("view_count")
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([realtorId, createdAt(sort: Desc)])
  @@index([expiresAt])
  @@map("realtor_briefings")
}

model RealtorAuditLog {
  id          String   @id @default(cuid())
  actorUserId String?  @map("actor_user_id")   // 탈퇴 후 가명화
  actorRole   String   @map("actor_role")      // 'REALTOR'|'ADMIN'|'SYSTEM'
  action      String                            // 'PROFILE_STATUS_CHANGE'|'BREAK_GLASS_READ'|'EXPORT'|'HARD_DELETE'|'BRIEFING_CREATE'|'BRIEFING_REVOKE'|'PLAN_CHANGE'
  targetType  String   @map("target_type")
  targetId    String?  @map("target_id")
  realtorId   String?  @map("realtor_id")      // 대상 중개사
  reason      String?                          // break-glass 필수
  meta        Json?                            // 개수 등. 연락처·메모 원문 금지
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([realtorId, createdAt(sort: Desc)])
  @@index([action, createdAt])
  @@map("realtor_audit_logs")
}
```

## 4. 테이블별 접근·보존 전략

| 테이블 | 앱 레이어 통제 | RLS | 보존/삭제 |
|---|---|---|---|
| `realtor_profiles` | 본인(`userId = session.user.id`) 읽기/수정. status 필드는 관리자 API만 | revoke+ON | 탈퇴 30일 후 삭제(cascade) |
| `realtor_subscriptions` | 본인 읽기, 쓰기는 서버(결제 웹훅/관리자)만 | revoke+ON | 전자상거래 기록 보존 기간 확인 필요(**법률 검토**) |
| `realtor_listings` | `realtorId` 강제 | revoke+ON | soft delete 30일 → hard. 비활성은 보관 |
| `realtor_listing_notes` | `realtorId` 강제 + 부모 일치 | revoke+ON | 매물과 cascade |
| `realtor_customers` | `realtorId` 강제 | revoke+ON | soft 30일 → hard; `lastActivityAt` N년 경과 삭제 안내 |
| `realtor_customer_preferences` | 동일 | revoke+ON | 고객과 cascade |
| `realtor_matches` | 동일 | revoke+ON | 재계산 시 upsert, 고객/매물 삭제 시 삭제(앱에서 처리 — 명시 FK 추가 여부는 구현 시 결정) |
| `realtor_followups` | 동일 | revoke+ON | 완료 후 1년 삭제(가설) |
| `realtor_briefings` | 중개사: `realtorId`. 공개 뷰: `tokenHash` 일치 + 미만료 + 미회수 + 중개사 VERIFIED | revoke+ON | 만료+90일 snapshot=null |
| `realtor_audit_logs` | 쓰기 전용(append), 관리자 조회만 | revoke+ON | 1년(가설) |

## 5. 기존 데이터 영향 분석

- **신규 테이블 추가만**, 기존 테이블 컬럼 변경 없음. `User`에는 Prisma relation 필드(`realtorProfile RealtorProfile?`)만 추가 → DB 컬럼 변경 없음.
- 기존 공개 read path는 신규 테이블을 읽지 않음 → 기존 기능 영향 없음.
- 롤백: 신규 테이블 drop(데이터가 있으면 내보내기 후). 기존 데이터 무영향.
- migration은 기존 수동 `prisma migrate deploy` 절차. build가 migration을 자동 적용하지 않음.

## 6. 미결정 사항

| 항목 | 선택지 |
|---|---|
| `realtor_matches` → customer/listing formal FK | 추가(cascade 자동) vs 앱 처리(유연). 권장: formal FK + cascade |
| `tags`/`lawdCds` 배열 vs 별도 테이블 | V1 배열(PG `text[]`), 검색 요구 커지면 분리 |
| 암호화 컬럼 | ARCHITECTURE §7.6 결정 A2에 따름. 평문 선택 시 `*_enc` → 평문 컬럼명으로 변경 |
| 팀 계정 | 향후 `realtor_offices`, `realtor_office_members` + 각 테이블 `officeId` 추가(현 `realtorId` 유지) |
