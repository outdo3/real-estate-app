# REALTOR PRO — USER DELETE SAFETY V1

## 결정
`realtor_profiles.user_id → users.id` FK(`realtor_profiles_user_id_fkey`)를 `ON DELETE CASCADE` → **`ON DELETE RESTRICT`**로 바꾼다(ON UPDATE CASCADE 유지, `user_id` NOT NULL 유지).

- 이유: users 삭제가 profile → listings/customers/briefings 등 Pro 데이터를 연쇄 삭제하면 안 된다. 계정 종료는 `status=SUSPENDED`, 실제 삭제는 별도의 명시적 절차.
- RESTRICT vs NO ACTION: 이 FK는 DEFERRABLE이 아니라 둘 다 문장 끝에서 같은 결과로 거부된다. 의도가 이름에 드러나고, 이 저장소의 기존 관례(`ApartmentUnitType.apartment → onDelete: Restrict`)와 Prisma `onDelete: Restrict`가 그대로 대응하므로 RESTRICT.

## 변경 파일
- 새 migration `prisma/migrations/20261005090000_realtor_profile_user_delete_restrict/migration.sql` (DO 블록, lock_timeout 3s, 기존 FK가 CASCADE일 때만 진행 → DROP + 재생성)
- `prisma/schema.prisma`: `RealtorProfile.user`의 `onDelete: Cascade → Restrict` 한 줄
- 기존 `20260930090000_realtor_pro_mvp_v1`은 **수정하지 않음**(sha256 `995018369e83…108f03`, Preview 적용분과 동일, 테스트가 고정)

## 전파 구조(수정 전/후)
users ─(변경)→ realtor_profiles ─CASCADE→ subscriptions / listings / customers
listings ─CASCADE→ listing_notes, matches, followups · customers ─CASCADE→ preferences, matches, followups
briefings → customer/listing는 SET NULL. `realtor_audit_logs`는 FK 없음.
수정 후: profile이 있는 users는 삭제 불가. **profile 삭제가 하위 데이터를 지우는 기존 CASCADE는 그대로**(명시적 삭제 절차의 도구).

## 검증(격리 PGlite 0.2.17, 실제 migration 24개 적용)
24/24 적용 · 수정 전 규칙에서 users 삭제 시 profile/listing/customer 연쇄 삭제 재현 · A profile 없는 user 삭제 허용 · B profile 있는 user 삭제 차단(데이터 불변) · C SUSPENDED 변경 후 데이터 유지 · D 정지 상태도 삭제 차단, profile 명시 삭제(테스트 데이터) 후 user 삭제 가능.
`prisma migrate diff`(HEAD schema → 새 schema)의 SQL = 새 migration의 DROP/ADD FK와 동일.

## 적용 순서(Production, 승인 후)
`migrate deploy` 한 번에 pending 2개가 순서대로 적용된다: `20260930090000_realtor_pro_mvp_v1` → `20261005090000_realtor_profile_user_delete_restrict`.
Preview(ejip-pro-preview)는 23/23 상태 → 새 migration 1개만 pending(아직 미적용).

## Follow-up
- 코드에 users 물리 삭제 경로 없음(회원 탈퇴 API·관리자 삭제·cron 정리 없음, `PrismaAdapter.deleteUser`는 NextAuth v4가 호출하지 않음). 약관·개인정보처리방침은 마이페이지 탈퇴를 언급하지만 구현은 없음 → 구현 시 Pro profile 보유자 처리(SUSPENDED + 명시적 삭제 절차) 정책 필요.
- Rollback: 새 migration의 역(FK를 CASCADE로 재생성)은 데이터 변경 없이 가능하나 안전 정책을 되돌리는 것이므로 권장하지 않음.

## Preview 적용 결과 (2026-10-05, 사용자 승인 — ejip-pro-preview만)
- 가드: project ref 일치 · Production과 다른 DB · 23/23 정상(failed 0) · pending = 새 migration 1개 · 기존 migration checksum 불변
- `prisma migrate deploy` → 24/24, failed 0, pending 0. FK = ON DELETE RESTRICT / ON UPDATE CASCADE, `user_id` NOT NULL
- 합성 데이터(`qa-syn-udel-*`) 실검증: A profile 없는 user 삭제 허용 · B profile 있는 user 삭제 차단(FK 위반, 데이터 불변) · C SUSPENDED 후 user/profile/listing/customer 유지(user 삭제는 여전히 차단) · D profile 명시 삭제 후 하위 행 제거, user 삭제 허용
- 이번 step이 만든 합성 행만 삭제: users 2, profiles 1, listings 1, customers 1. 전후 스냅샷 동일(users 5, ADMIN 1, profiles 5, VERIFIED 4, listings 12, customers 6, briefings 6)
- 코드 2cd1bbb → Preview dpl_56Xu3xxF7DnCSg863u7bXdYbTXeH READY (실제 코드 SHA 배포 확인)
- 로그인 후 런타임: 사용자 수동 확인 PASS(2026-10-05) — Google 로그인 · Preview ADMIN 유지 · Realtor Pro 접근 · 기존 매물/고객/브리핑 기능 · 취소 브리핑 410 · Pro 하단 일반 메뉴 숨김. 회귀 없음.
- **Preview 최종 상태 = PASS** 비로그인: `/` 200, `/pro` 200, `/api/pro/listings` 401
- PREVIEW_MIGRATION = 24/24 · USER_DELETE_WITH_PROFILE = BLOCKED · SUSPEND_PRESERVES_DATA = YES · EXPLICIT_DELETE_REQUIRED = YES · PRODUCTION_UNCHANGED = YES
