# USER FEEDBACK V1 — 감사 + 스키마·메일 제안 (STOP: 승인 대기)

- 기준 HEAD: `baff846` (main = origin/main), 사용자 파일(`package.json`·`package-lock.json`·untracked 24) 보존
- 상태: **감사·설계만.** schema/migration 파일 생성·적용 없음, 앱 코드 변경 없음, Production write 없음.

## 1. 감사 결과

| 항목 | 현재 |
|---|---|
| 관리자 인증 | `requireAdmin()`(`src/lib/auth-helpers.ts`) = 세션 로그인 + `role === 'ADMIN'` 또는 `ADMIN_EMAIL` env 일치(`admin-access.ts`). API는 매 요청 서버 재검증, 페이지는 세션의 `isAdmin` boolean으로 UI만 가림(`/admin/users`·`/admin/dashboard` 패턴) |
| 관리자 라우트 | 페이지 `/admin/{dashboard,users,behavior,ops,system}`, API `/api/admin/{dashboard,users,behavior,ops,presales,system-health}` |
| 기존 의견/신고 테이블 | `Report`(`reports`) — **커뮤니티 게시글/댓글 신고용**(postId·commentId·reporterId·reason·resolved), UI 없음·항상 0행, 대시보드 "미처리 신고" 카운트가 참조. 유형·상태 3단계·페이지/단지 context가 없어 재사용하면 신고 의미가 섞인다 → **재사용하지 않음**. `ErrorLog`는 앱 오류 로그(사용자 입력 아님) |
| 메일 | **없음.** 메일 패키지(resend/nodemailer/smtp 등) 0, 메일 코드 0, 메일 관련 env 0 |
| 알림 유틸 | 없음(Slack/웹훅/Kakao 등 0) |
| env(이름만) | Production: `ADMIN_EMAIL`, `NEXTAUTH_SECRET`, `DATABASE_URL`, `SUPABASE_*`, OAuth 3사, `CRON_SECRET`, 공공 API 키 등. 운영자 알림 수신 주소로 쓸 전용 env는 없음(`ADMIN_EMAIL`은 관리자 판정용) |
| rate limit | 커뮤니티 이미지: 공유 한도(DB `storage.objects` 최근 N분 개수) + 인스턴스 로컬 요청 한도(`image-upload-rate-limit.ts`). 공용 limiter 서비스(Upstash/KV) 없음 |
| analytics | 1st-party `ANALYTICS_EVENT_NAMES` allowlist(`src/lib/analytics/events.ts`) — 새 이벤트는 목록 추가 필요 |
| DB 권한 기본값 | Supabase `public` 기본 권한(default ACL)이 새 객체에 anon/authenticated 권한을 준다(예: `error_logs` anon 권한 7종, RLS off). Batch A·`post_images`는 revoke + RLS ON 상태 → **새 테이블은 생성과 같은 migration에서 revoke + RLS ON 필요** |
| 배포 시 migration | `npm run build` = `next build`만. migration 자동 적용 없음(수동 `prisma migrate deploy`) |
| 비로그인 MY | `/my` 비로그인 시 "로그인이 필요한 페이지입니다." 카드만 — 진입점은 로그인 여부와 무관하게 보이게 둬야 함 |
| 응답 후 작업 | Next 16 `after()`(`next/server`) 사용 가능 — DB 저장 응답 후 메일 best-effort |

## 2. 결정이 필요한 것 (3건)

### A. 스키마 추가 (필수, 승인 필요)

기존 테이블로는 불가(위 `Report` 사유). 새 테이블 1개 + enum 2개.

```prisma
enum FeedbackCategory {
  BUG
  DATA_ERROR
  FEATURE_REQUEST
  USABILITY
  OTHER
}

enum FeedbackStatus {
  NEW
  REVIEWING
  DONE
}

model UserFeedback {
  id            String           @id @default(cuid())
  category      FeedbackCategory
  message       String           @db.Text          // trim 후 5~3000자(서버 검증)
  status        FeedbackStatus   @default(NEW)

  userId        String?          @map("user_id")         // 로그인 사용자만. FK 없음(아래 설명)
  pagePath      String?          @map("page_path")       // pathname만
  pageQuery     String?          @map("page_query")      // 허용 키만 남긴 쿼리(lawdCd·dong·aptSeq·period 등), 최대 500자

  aptSeq        String?          @map("apt_seq")         // 서버가 ApartmentMaster로 확인한 값만
  apartmentName String?          @map("apartment_name")  // master.name (URL 이름 아님)
  lawdCd        String?          @map("lawd_cd")         // master.sggCd

  userAgent     String?          @map("user_agent")      // 최대 300자
  ipHash        String?          @map("ip_hash")         // 익명 rate limit 전용, 원문 IP 저장 안 함

  notifiedAt    DateTime?        @map("notified_at")     // 메일 발송 성공 시각(실패는 null로 남아 관리자 화면에서 보임)
  adminNote     String?          @db.Text @map("admin_note")
  resolvedAt    DateTime?        @map("resolved_at")     // DONE 전환 시각

  createdAt     DateTime         @default(now()) @map("created_at")
  updatedAt     DateTime         @updatedAt @map("updated_at")

  @@index([status, createdAt])
  @@index([category, createdAt])
  @@index([userId, createdAt])
  @@index([ipHash, createdAt])
  @@map("user_feedback")
}
```

설계 메모
- **enum**: 기존 스키마 관례(Role·Presale 등)와 같게 안정 키를 enum으로. 유형 추가 시 `ALTER TYPE ... ADD VALUE` migration 필요(대안: text + CHECK — 원하면 바꿈).
- **userId FK 없음**: `users`(Batch A 테이블)에 제약을 추가하지 않아 NextAuth 경로·잠금 영향 0. 사용자 삭제 시 id가 남을 수 있음(관리자 화면은 "탈퇴/알 수 없음"으로 표시).
- **단지 context**: 클라이언트가 보낸 aptSeq를 그대로 믿지 않는다 — 형식(`^\d{5}-\d+$`) 확인 후 `ApartmentMaster`에서 조회되는 경우에만 aptSeq·name·sggCd를 저장. 상세 페이지가 canonical aptSeq를 확정하지 못했으면 보내지 않음. URL의 단지 이름으로 식별하지 않음.
- **pageQuery 허용 키**: OAuth 콜백 `code`/`state`, `token` 등이 섞일 수 있어 allowlist만 저장.
- **ipHash**: `HMAC-SHA256(key, "YYYY-MM-DD(KST)|ip")` — 날짜가 섞여 **다음 날에는 같은 IP도 다른 값**(장기 추적 불가). key는 `NEXTAUTH_SECRET`에서 용도 라벨로 파생(새 env 없음) 또는 전용 env `FEEDBACK_HASH_SECRET`(선택 — 3번 표 참고).
- `adminNote`: 요청서 예시 필드. V1 관리자 화면에서는 입력 UI 없이 컬럼만 둘 수도 있음 — 빼길 원하면 제외.

### Migration SQL(제안, 파일 미생성)

`prisma/migrations/2026MMDDhhmmss_user_feedback_v1/migration.sql`

```sql
-- USER_FEEDBACK_V1 — user_feedback 테이블(추가만). 기존 테이블·데이터·권한 무변경.
-- 새 테이블은 Supabase 기본 권한으로 anon/authenticated/service_role 권한을 받으므로 같은 트랜잭션에서
-- 회수하고 RLS를 켠다(Batch A / post_images와 같은 상태: API role 권한 0, RLS ON, policy 0, FORCE OFF).
-- 앱은 Prisma(테이블 소유자, BYPASSRLS)로만 접근한다.
DO $$
DECLARE
    api_roles CONSTANT TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
    r TEXT;
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);

    CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'DATA_ERROR', 'FEATURE_REQUEST', 'USABILITY', 'OTHER');
    CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'REVIEWING', 'DONE');

    CREATE TABLE "user_feedback" (
        "id" TEXT NOT NULL,
        "category" "FeedbackCategory" NOT NULL,
        "message" TEXT NOT NULL,
        "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
        "user_id" TEXT,
        "page_path" TEXT,
        "page_query" TEXT,
        "apt_seq" TEXT,
        "apartment_name" TEXT,
        "lawd_cd" TEXT,
        "user_agent" TEXT,
        "ip_hash" TEXT,
        "notified_at" TIMESTAMP(3),
        "admin_note" TEXT,
        "resolved_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX "user_feedback_status_created_at_idx" ON "user_feedback"("status", "created_at");
    CREATE INDEX "user_feedback_category_created_at_idx" ON "user_feedback"("category", "created_at");
    CREATE INDEX "user_feedback_user_id_created_at_idx" ON "user_feedback"("user_id", "created_at");
    CREATE INDEX "user_feedback_ip_hash_created_at_idx" ON "user_feedback"("ip_hash", "created_at");

    FOREACH r IN ARRAY api_roles LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON TABLE "user_feedback" FROM %I', r);
            EXECUTE format('REVOKE ALL ON TYPE "FeedbackCategory" FROM %I', r);
            EXECUTE format('REVOKE ALL ON TYPE "FeedbackStatus" FROM %I', r);
        END IF;
    END LOOP;
    ALTER TABLE "user_feedback" ENABLE ROW LEVEL SECURITY;
END
$$;
```

(타입 USAGE 회수는 권한 audit 스크립트로 적용 전후 확인. 문제가 있으면 테이블 revoke만 유지.)

- **보안**: 적용 후 `scripts/security/audit-db-grants-rls.ts`로 `user_feedback` = RLS ON·FORCE OFF·policy 0·anon/authenticated/service_role 0, 기존 테이블 권한 변화 0, Data API 503 유지 확인.
- **롤백**: 데이터를 보존해야 하면 먼저 export. 이후 `DROP TABLE "user_feedback"; DROP TYPE "FeedbackStatus"; DROP TYPE "FeedbackCategory";` + migration 기록 정리(`prisma migrate resolve --rolled-back`). 다른 테이블 의존 없음.
- **앱 영향**: 추가만. 기존 쿼리·테이블·인덱스 변경 없음, `users` 제약 없음. 적용 전에 배포되면 API가 테이블 없음 오류를 낸다 → **순서: migration 적용 → 코드 배포**.

### B. 메일 발송 수단 (필수, 승인 필요 — 새 외부 서비스·env)

현재 메일 인프라가 전혀 없어 어떤 방식이든 새 의존성이 생긴다.

| 안 | 방식 | 필요한 것 | 비고 |
|---|---|---|---|
| **1(권장)** | Resend HTTPS API를 `fetch`로 호출(npm 패키지 추가 없음) | Resend 계정, `e-jip.com` 발신 도메인 DNS 인증(SPF/DKIM TXT), env `RESEND_API_KEY` | 무료 등급 월 3,000통·일 100통(운영 알림 규모에 충분). 도메인 인증 전에는 계정 소유 주소로만 테스트 발송 가능 |
| 2 | Gmail SMTP(앱 비밀번호) | npm `nodemailer` 추가, env `SMTP_HOST`·`SMTP_PORT`·`SMTP_USER`·`SMTP_PASS` | 비용 없음, 개인 Gmail 한도·보안 설정 의존, 새 패키지 |
| 3 | 메일 없이 V1(관리자 화면 + 대시보드 "새 의견" 카운트) | 없음 | 요청서의 이메일 요건은 미충족 — 후속으로 1/2 추가 |

공통 env(모든 안):
- `FEEDBACK_NOTIFICATION_EMAIL` — 알림 받을 운영자 주소(server-only, 코드에 주소 하드코딩 없음)
- `FEEDBACK_EMAIL_FROM` — 발신 주소(안 1: 인증된 도메인 주소)
- (선택) `FEEDBACK_HASH_SECRET` — ipHash 전용 키. 없으면 `NEXTAUTH_SECRET`에서 용도 라벨로 파생

동작: DB INSERT 성공 → 201 응답 → `after()`에서 메일 발송 → 성공 시 `notified_at` 기록, 실패·env 없음은 로그만(`error_logs`에 메시지 원문 없이 `[FEEDBACK_NOTIFY_FAILED] id=… reason=…`). 메일 본문: 유형·내용·발생 화면(path)·단지명/aptSeq·접수 시각(KST)·관리자 링크. 이메일·user id·user agent·ipHash는 넣지 않음(로그인 여부만).

### C. analytics 이벤트 (선택)

`feedback_open`, `feedback_submit`(category만) — 기존 allowlist에 2개 추가. 메시지·단지·페이지는 보내지 않음. GA4 매핑 없음. 이전 analytics 변경은 명시 승인 후 진행했으므로 여기서도 승인 시에만 포함.

## 3. 승인 후 구현 계획(요약)

| 영역 | 내용 |
|---|---|
| 진입점 | MY 하단 "의견 보내기"(로그인/비로그인 모두 노출) → `/feedback` 전용 페이지(모바일 우선, 뒤로가기 자연). 단지 상세에서 열 때는 상세가 확정한 canonical aptSeq만 전달. 추가 노출 없음 |
| 폼 | 유형 5개(칩, ≥44px), textarea(placeholder "어떤 점이 불편했는지 알려주세요."), 글자 수, "의견 보내기"(제출 중 비활성), 완료 "의견을 보내주셔서 감사합니다.", 실패 "의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요." |
| API | `POST /api/feedback` — category allowlist, message trim 5~3000자, 선택 세션(user id), context sanitize(path·허용 쿼리·UA 300자), aptSeq master 확인, rate limit, insert → 201, `after()` 메일 |
| rate limit | 공유: 같은 user_id 또는 ip_hash 최근 10분 5건(DB count, 인덱스 사용) + 인스턴스 로컬 가드. 초과 429 + 안전 문구. 조회 실패 시 fail-open(로컬 가드는 유지) |
| 관리자 | `/admin/feedback`(기존 `isAdmin` 패턴) + `GET /api/admin/feedback`(status·category 필터, 페이지네이션) + `PATCH /api/admin/feedback/[id]`(status NEW/REVIEWING/DONE, DONE이면 resolvedAt), 모두 `requireAdmin()`. 목록: 접수일·유형·상태(처리전/확인중/완료)·미리보기·페이지·단지·로그인 여부·메일 알림 여부, 펼치면 전문·aptSeq·path·UA·시각. 대시보드에 링크 |
| 테스트 | 요청서 §22의 14항목(검증·익명/로그인·단지 context·민감정보 미저장·rate limit·관리자 401/403/목록/상태·메일 실패 시 저장 유지·모바일 렌더·보안 무변경) |
| Production QA | migration 적용 → 배포 → `[TEST]` 표시 익명 1건·로그인 1건, 관리자 목록/상세/상태, 메일 수신. 테스트 행 삭제는 승인 후 |

V1 제외: 첨부 이미지, 사용자 답변함, 메일 스레드, 푸시/카카오 알림, 투표, 공개 로드맵, AI 분류.

## 4. 승인 요청 문구 예

- "USER FEEDBACK V1 — SCHEMA APPROVED (제안 그대로 / 수정: …)"
- "EMAIL: 안 1 Resend (계정·도메인 인증은 운영자가 진행) / 안 2 Gmail SMTP / 안 3 메일 후속"
- "ANALYTICS feedback_open/submit: 포함 / 제외"
- Production migration 적용 승인은 구현·로컬 검증 후 별도로 요청한다.
