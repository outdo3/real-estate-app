# REALTOR PRO — 기존 아키텍처 감사 (Phase 1)

작성: 2026-09-30 · 기준: `realtor-pro-v1-design` 554651b(= main 377acf7 + 설계 문서) · 읽기 전용 감사

| 항목 | 현재 repo 사실 | Pro MVP 결정 |
|---|---|---|
| CURRENT_AUTH_MODEL | NextAuth 4.24, **JWT 세션 전략**(`src/lib/auth.ts`), Kakao/Naver/Google OAuth + PrismaAdapter. `session.user.{id, role, banned, isAdmin}` | 재사용. 새 로그인·계정 체계 없음. Pro 권한은 JWT에 굽지 않고 **매 요청 DB 조회**(정지 즉시 반영) |
| CURRENT_USER_PK | `User.id String @default(cuid())` (`users`) | `realtor_profiles.user_id` → `users.id` unique(1:1), `onDelete: Cascade` |
| CURRENT_ROLE_MODEL | `Role` enum `GUEST/USER/VERIFIED/ADMIN`, 관리자 판정은 `src/lib/admin-access.ts` 단일 함수 | 중개사 상태는 `Role`에 섞지 않고 `realtor_profiles.status`(`PENDING_REVIEW/VERIFIED/REJECTED/SUSPENDED`). 관리자 심사는 기존 `requireAdmin()` |
| CURRENT_DB_ACCESS_PATTERN | Prisma 5.22 싱글턴(`src/lib/prisma.ts`), 테이블 **소유자**로 접속(BYPASSRLS). `connection_limit=1` 환경 — `Promise.all` 병렬 쿼리 금지 관행. 기능별 repo 분리(`feedback-repo-prisma.ts`) | `ProRepo` 인터페이스 + `repo-prisma.ts`(모든 쿼리 `realtorId` 조건) + `repo-memory.ts`(테스트·로컬 데모). 순차 쿼리 |
| CURRENT_RLS_PATTERN | 신규 테이블 migration 한 DO 블록 안에서 anon/authenticated/service_role **REVOKE ALL** + `ENABLE ROW LEVEL SECURITY`(정책 0, FORCE 없음) — `20260915100000_security_hardening_v2_batch_a`, `20260916090000_user_feedback_v1` | 같은 패턴 + 소유자 정책(SELECT/INSERT/UPDATE/DELETE, `app.realtor_id` 세션 설정 기반) 을 **심층 방어**로 추가. 1차 통제는 앱 레이어 |
| CURRENT_API_PATTERN | App Router route handler(`src/app/api/**/route.ts`), `params: Promise<...>`, 서비스에 의존성 주입(`submitFeedback(req, { repo, now, ... })`), JSON `{ success, error, code }`. server action 미사용 | `/api/pro/*` route handler → `src/lib/pro/*-service.ts`(DI). 타인 소유/없음 모두 404 |
| CURRENT_VALIDATION_LIBRARY | **없음(zod 미설치)**. 순수 규칙 모듈의 수동 검증(`feedback-rules.ts` `validateFeedbackInput`) + migration CHECK와 같은 허용 목록을 테스트로 고정 | 같은 방식: `src/lib/pro/rules.ts` 수동 검증 + 필드 allowlist(mass assignment 차단). 새 의존성 추가 없음 |
| CURRENT_ENCRYPTION_HELPER | 필드 암호화 헬퍼 **없음**. 키 기반 해시만 존재(`feedback/ip-hash.ts` HMAC 계열) | `src/lib/pro/crypto.ts` 신설: AES-256-GCM(버전 프리픽스, 랜덤 IV), HMAC-SHA256 조회 해시. env `REALTOR_PRO_PII_KEY`, `REALTOR_PRO_LOOKUP_PEPPER`(값은 저장소에 없음) |
| CURRENT_AUDIT_PATTERN | 전용 감사로그 **없음**. 서버 오류 기록 `log-server-error.ts` + 마스킹 `log-redaction.ts` | `realtor_audit_logs` + `src/lib/pro/audit.ts`(메타데이터 allowlist, PII 금지) |
| CURRENT_UI_LIBRARY | React 19 + **CSS Modules** + `globals.css` 토큰(`--primary-color` 등), 아이콘 `lucide-react`, 이모지 금지. 하단 탭 `src/lib/bottom-nav-items.tsx`(5개 고정) | 같은 방식. 기존 하단 탭은 변경하지 않음(Header 교체는 승인 A3 대상) — Pro 내부 탭은 페이지 상단 탭 바 |
| CURRENT_TEST_PATTERN | `node:test` + `assert/strict`, `npx tsx --test "src/**/*.test.ts"`. DB 없는 순수/주입 테스트, 소스 문자열 고정 테스트, migration.sql을 읽어 CHECK 목록 고정 | 같은 방식. Pro 테스트는 DB·네트워크 0(메모리 repo) |
| 라우트 보호 | `src/proxy.ts`(Next 16 middleware 후속) matcher `/admin/:path*`만 | `/pro`는 proxy 확장 없이 layout 서버 가드 + API 가드. `/admin/pro/*`는 기존 proxy 범위 |
| 공개 지역 게이트 | `src/lib/region/enablement.ts` `getRegionEnablement(lawdCd)` | 공공 데이터 prefill·브리핑 실거래는 `detail` 축이 열린 지역만 |
| 단지 식별 | `ApartmentMaster.aptSeq` unique nullable, 이름은 표시용 | 매물 `apt_seq`(FK 없음 — master는 배치 재구축 테이블) + `apt_name_snapshot`. 이름 재식별 금지 |
| 면적 | `ApartmentUnitType.canonicalExclusiveArea Decimal` | `exclusive_area_m2` 그대로 저장, 평형 계산 금지 |
| 배포 | `main` push = Vercel Production | Pro 전체를 서버 flag `REALTOR_PRO_ENABLED`(기본 꺼짐)로 차단한 채로만 병합 가능 |

## 재사용할 것 (복제 금지)

- `getCurrentUser()`/`requireAdmin()` (`src/lib/auth-helpers.ts`) — Pro 전용 인증 없음.
- `prisma` 싱글턴 + 테스트 쓰기 가드(`test-db-guard.ts`).
- `redactSensitive()` (`log-redaction.ts`) — 서버 오류 기록 시.
- `getRegionEnablement()` — Pro도 공개 게이트의 예외가 아님.
- `/api/search`의 `APARTMENT` 결과 계약(aptSeq·lawdCd·dong) — 매물 단지 선택.
- CSS 토큰·lucide 아이콘.

## 만들지 않을 것

- 두 번째 사용자/세션 체계, service-role 클라이언트, 브라우저용 Supabase 키 사용.
- zod 등 새 의존성, 결제·메시지 발송 연동.
