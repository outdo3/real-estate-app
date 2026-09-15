# USER FEEDBACK V1 — Production 적용 (메일 수신 확인 대기)

- 기준 HEAD: `baff846` (main = origin/main), 사용자 파일(`package.json`·`package-lock.json`·untracked 24) 보존
- 상태: **로컬 구현·검증 완료.** Production migration 미적용, Production env 미변경, 의견 코드 push/배포 없음, Production 테스트 데이터 없음.
- PM 결정(구현 승인): A 스키마 승인 — PG enum 대신 TEXT + CHECK / B 메일 Resend(HTTPS fetch, 패키지 없음) / C analytics `feedback_open`·`feedback_submit`(category만) 승인.
- 아래 §1~§4는 승인 전 감사·제안 기록(§2의 enum 안은 TEXT+CHECK로 대체됨). 최종 구현은 §5부터.

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

---

## 5. 최종 구현 (승인 반영)

### 5.1 스키마 — `UserFeedback` / `user_feedback`

§2 제안에서 **enum만 TEXT + CHECK로 변경**. 나머지 필드(adminNote·ipHash·notifiedAt·resolvedAt·pageQuery·userAgent) 유지, users FK 없음, status 기본 `NEW`. Prisma 모델은 `prisma/schema.prisma`(additive +38줄, 기존 줄 변경 0).

### 5.2 Migration — `prisma/migrations/20260916090000_user_feedback_v1/migration.sql`

- 하나의 `DO` 블록(원자적), `lock_timeout 3s`(트랜잭션 로컬).
- `CREATE TABLE "user_feedback"` — TEXT 컬럼, `user_feedback_category_check`(BUG·DATA_ERROR·FEATURE_REQUEST·USABILITY·OTHER), `user_feedback_status_check`(NEW·REVIEWING·DONE), 인덱스 4개(status·category·user_id·ip_hash + created_at).
- 같은 블록에서 `anon`·`authenticated`·`service_role`에 `REVOKE ALL ON TABLE`(role이 있을 때만) + `ENABLE ROW LEVEL SECURITY`. 정책·FORCE·GRANT·FK·enum·다른 테이블 변경 없음.
- **의도한 결과 상태**: `user_feedback` — RLS **ON**, FORCE **OFF**, policies **0**, anon grants **0**, authenticated grants **0**, service_role grants **0**, owner = 앱 Prisma 역할(BYPASSRLS).
- **롤백**: (필요 시 데이터 export 후) `DROP TABLE "user_feedback";` + `npx prisma migrate resolve --rolled-back 20260916090000_user_feedback_v1`. 다른 객체 의존 없음(enum 타입도 없음).

### 5.3 코드

| 파일 | 역할 |
|---|---|
| `src/lib/feedback/feedback-rules.ts` | 유형·상태·문구, 입력 검증(trim 5~3000자), 경로·허용 쿼리 정리, aptSeq 형식, UA 300자, resolvedAt 규칙, 한도 상수(10분 5건) |
| `src/lib/feedback/ip-hash.ts` | 요청자 IP → `v1:` + HMAC-SHA256(key, "KST 날짜 + ip"). key = `FEEDBACK_HASH_SECRET` 또는 `NEXTAUTH_SECRET`에서 라벨로 파생(원 비밀 미반환·미출력), 둘 다 없으면 null |
| `src/lib/feedback/feedback-email.ts` | 메일 본문(유형·내용·발생 화면·확인된 단지·로그인 여부·접수 시각 KST·관리자 링크 — 이메일·user id·UA·ipHash·쿼리 없음), Resend `POST https://api.resend.com/emails`(8초 timeout, 2xx만 성공, 실패는 고정 코드) |
| `src/lib/feedback/feedback-service.ts` | 제출 흐름(검증 → 로컬 가드 → DB 공유 한도 → aptSeq master 정확 확인 → INSERT → 응답 뒤 알림, 성공 시만 notifiedAt), 관리자 필터·상태 변경·목록 직렬화(ipHash·userId 원값 제외) — 의존성 주입 |
| `src/lib/feedback/feedback-repo-prisma.ts` | Prisma 구현(`server-only`) — count·create·markNotified, ApartmentMaster `findUnique({ aptSeq })`, 관리자 list·update |
| `src/app/api/feedback/route.ts` | `POST` — 16KB 본문 상한, 선택 세션(user id), 로그인 시 IP 해시 생성 안 함, `after()`로 메일 |
| `src/app/api/admin/feedback/route.ts` · `[id]/route.ts` | `GET` 목록(최신순·status·category·30건 페이지) / `PATCH` 상태·메모 — 둘 다 `requireAdmin()` 선행 |
| `src/app/feedback/*` | 의견 보내기 화면(noindex). 유형 5개 2열(44px), textarea 16px·3000자·글자 수, 제출 중 비활성("보내는 중..."), 성공/실패 문구, `from`(앱 내부 경로)·`aptSeq`(후보) 쿼리 지원 |
| `src/app/my/page.tsx` | 로그인 분기 밖 "고객 의견 → 의견 보내기"(`/feedback?from=/my`) — 비로그인에게도 보임 |
| `src/app/admin/feedback/*` | 관리자 목록(상태·유형 필터, 처리전/확인중/완료 배지, 미리보기·페이지·단지·로그인 여부·메일 알림 여부, 펼침: 전문·aptSeq·단지명·lawdCd·허용 쿼리·UA·접수/알림/완료/수정 시각·운영 메모·상태 버튼). `/admin/*`는 proxy에서도 차단 |
| `src/app/admin/dashboard/page.tsx` | 관리자 메뉴에 "사용자 의견" 링크 |
| `src/lib/analytics/events.ts` · `track-feedback.ts` · `api/log/event/route.ts` | 이벤트 2개 + `FEEDBACK_EVENT_ACTIONS`(submit = 유형 enum) + 서버 enum 검증. GA4 매핑 없음 |

**resolvedAt 규칙(결정적)**: DONE으로 → 이전이 DONE이 아니면 now, 이미 DONE이면 기존 값 유지(없으면 now) / DONE 밖으로 → null.

**rate limit**: 기준 = DB 공유 한도(로그인 `user_id`, 익명 일별 `ip_hash`, 최근 10분 5건, 6번째 429 "짧은 시간에 의견을 여러 번 보내셨어요. 잠시 후 다시 시도해 주세요."). 보조 = 인스턴스 로컬(식별 10건/10분, 식별값 없는 익명 공유 버킷 30건/10분). DB 조회 실패 시 fail-open(로컬 가드 유지).

**단지 context**: 쿼리의 `aptSeq`는 후보. 형식 확인 → `ApartmentMaster.aptSeq` 정확 일치일 때만 aptSeq·master.name·master.sggCd 저장. 불일치·오류면 단지 정보 없이 저장(이름·유사 매칭 없음, 클라이언트가 보낸 이름/lawdCd 무시). 현재 진입점은 MY뿐이라 실제 단지 context는 향후 단지 상세 진입점이 생길 때 채워진다.

## 6. 검증

### 6.1 테스트

`src/lib/feedback/feedback.test.ts` 26건(요청 24항목 + Resend 호출 + 모바일 폼). `personal-fit-analytics.test.ts` 2건을 승인된 이벤트 2개 추가에 맞게 갱신.

| 명령 | 결과 |
|---|---|
| feedback 테스트 | 26/26 |
| analytics 관련 | 76/76 |
| src 전체 | **2115/2115** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(scripts/·tmp/ 25건, src 0) |
| eslint(변경·신규 파일) | exit 0 |
| `npm run build` | exit 0 (`/feedback`·`/admin/feedback` 정적, API 3개 동적) |

### 6.2 로컬 DB에서 migration 실측 (Docker `postgres:16-alpine`, 일회용, 검증 후 삭제)

Supabase와 같은 조건을 만들기 위해 `anon`·`authenticated`·`service_role` role과 `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES`를 먼저 설정한 뒤 **전체 21개 migration**을 `prisma migrate deploy`로 적용(`localhost:55432` 확인).

| 확인 | 결과 |
|---|---|
| 적용 | 21개 성공, `migrate status` up to date |
| `user_feedback` | RLS **t**, FORCE **f**, policies **0**, anon/authenticated/service_role grants **0/0/0**, owner postgres |
| 대조(기본 권한이 실제로 주는 것) | 같은 조건에서 `reports`·`error_logs`는 role마다 7개 권한 → 회수가 필요하다는 근거 |
| CHECK | category·status 허용 목록 = 코드 상수. `SPAM`·`CLOSED` INSERT 거절 |
| role 직접 접근 | `SET ROLE anon` SELECT / `authenticated` INSERT / `service_role` SELECT → 모두 `permission denied` |
| enum 타입 | 0개 |
| 스키마 drift | `prisma migrate diff --from-url(로컬) --to-schema-datamodel` = 빈 migration |
| Prisma repo 실제 호출 | create·countRecent·markNotified·admin list(필터)·DONE update(resolvedAt·memo) 정상, 잘못된 status는 CHECK로 거절, master 정확 일치만 반환 |

### 6.3 로컬 앱(`next start`, DATABASE_URL = 로컬 컨테이너)

- `/feedback` 200, `/my` 200, `/admin/feedback` 비관리자 307 → `/my`, `GET /api/admin/feedback` 401, `PATCH` 401.
- 400: 잘못된 유형("의견 유형을 선택해 주세요."), 공백 메시지("5자 이상 입력해 주세요."), 3001자("3,000자 이하로 입력해 주세요."), 잘못된 JSON.
- 익명 같은 IP 5건 201 → 6번째 **429**, 다른 IP 201.
- 저장 행 전수: 원문 IP 포함 0행, `code`·`token`·`callbackUrl` 포함 0행, 클라이언트가 보낸 단지 이름 0행. `page_query`는 허용 키만, 존재하지 않는 aptSeq(`99999-1`)는 단지 정보 없음, ipHash `v1:` 67자.
- 메일 env 없음 → 응답 201 유지, 로그 `[FEEDBACK_NOTIFY_FAILED] id=… reason=NOT_CONFIGURED`(메시지 원문 없음), notified_at null.
- 브라우저 제출(390px): "데이터 오류" 선택 → 한글·줄바꿈 UTF-8 저장, `from=/apt/롯데?lawdCd=26350&code=SECRET` → page_path `/apt/롯데`, page_query `lawdCd=26350`, 후보 aptSeq `26350-9` → 롯데·26350. 제출 중 버튼 비활성 "보내는 중...", 성공 문구, analytics `feedback_submit` payload = 이름 + `actionType: FEATURE_REQUEST`만(complexId·aptName null). 네트워크 실패 강제 → 실패 문구, submit 이벤트 없음. (로컬 이벤트 저장은 기존 분류기가 `NON_PRODUCTION`으로 제외 — 설계대로.)
- 360·390px: MY 진입 링크(비로그인) 58px, 유형 버튼 44px×5, textarea 16px, 제출 48px·초기 비활성, 문서 넘침 0.
- 로그인 사용자 제출·관리자 로그인 화면은 로컬 OAuth 로그인이 불가해 **단위 테스트로만** 확인(세션 위조는 하지 않음).

## 7. Production 적용 절차 (승인 후, 이 순서로)

1. **사전 스냅샷(읽기 전용)**: `ALLOW_PROD_DB_READ=1 npx tsx scripts/security/audit-db-grants-rls.ts --json > <저장소 밖 경로>/before.json`, `npx prisma migrate status`로 **대기 migration이 `20260916090000_user_feedback_v1` 1개뿐**인지 확인.
2. **Migration 적용**: `npx prisma migrate deploy` (Production `DATABASE_URL`). 이 명령은 대기 중인 migration만 적용한다 — 1번에서 1개임을 확인한 뒤 실행.
3. **사후 확인**: 같은 audit를 `after.json`으로 → `user_feedback` RLS ON·FORCE OFF·policy 0·API role 권한 0, 다른 테이블 권한 변화 0, Data API 503 유지, `migrate status` up to date.
4. **Env 설정(Vercel Production, 값 출력 금지)**: `RESEND_API_KEY`, `FEEDBACK_NOTIFICATION_EMAIL`, `FEEDBACK_EMAIL_FROM`(Resend에서 인증한 도메인 주소), 선택 `FEEDBACK_HASH_SECRET`. Resend 발신 도메인 DNS 인증(운영자). env는 배포 시점에 반영되므로 5번 전에 넣으면 재배포가 한 번으로 끝난다.
5. **코드 push/배포**: migration 적용 확인 **후에만**. 반대 순서면 `/api/feedback`이 테이블 없음으로 500.
6. **Production QA**: `[TEST]` 표시 익명 1건·로그인 1건, 관리자 목록/펼침/상태 변경, 메일 수신(env·도메인 준비 후). 테스트 행 삭제는 별도 승인.

## 8. 위험·한계

- 메일은 env·도메인 인증 전까지 발송되지 않는다(저장·관리자 화면은 정상, `notified_at` null로 보임).
- ipHash 키를 `NEXTAUTH_SECRET`에서 파생하면 그 비밀을 회전할 때 당일 한도 카운트가 초기화된다(보안 영향 없음). 전용 `FEEDBACK_HASH_SECRET` 권장.
- Vercel 프록시 헤더(`x-forwarded-for` 첫 값)를 신뢰한다. 헤더가 없으면 익명은 인스턴스 로컬 공유 버킷(30건/10분)만 적용.
- DB 한도 조회 실패 시 fail-open.
- 단지 상세 등 다른 진입점은 이번 범위 밖(MY만) — 단지 context가 실제로 채워지려면 진입점 추가가 필요.
- 유형 추가 시 CHECK 제약 교체 migration(가벼움) 필요.
- 관리자 화면의 로그인 상태 렌더는 Production 적용 후 실제 관리자 세션으로 확인해야 한다.

---

## 9. Production 적용 (2026-09-15 23:4x KST ~ 09-16)

**판정: FUNCTIONAL_WITH_EMAIL_PENDING** — 저장·관리자·보안·배포 PASS, Resend API 발송 수락(`notified_at`) 확인. 수신함 도착·Resend 대시보드 기록은 사용자 확인 필요.

| 단계 | 결과 |
|---|---|
| 시작 상태 | main `05583bc`(origin `baff846` + 승인 커밋 `d5f4efa`·`05583bc`), 사용자 파일 보존 |
| env(이름만) | Vercel Production `RESEND_API_KEY`·`FEEDBACK_NOTIFICATION_EMAIL`·`FEEDBACK_EMAIL_FROM`·`FEEDBACK_HASH_SECRET` 존재 |
| 대기 migration | 정확히 1개 `20260916090000_user_feedback_v1` |
| migration 파일 | 승인 커밋과 동일, 기대 속성 전부 일치(추가 테이블 1·TEXT+CHECK·기본 NEW·인덱스 4·API role REVOKE·RLS ON·정책/FORCE/GRANT/FK/enum/DROP 0) |
| 사전 스냅샷 | 저장소 밖 저장. Batch A 7테이블 RLS ON·FORCE OFF·정책 0·API role 권한 0, Data API 503, relation 43, user_feedback 없음 |
| 적용 | `npx prisma migrate deploy` → 해당 1개만 적용, exit 0, status up to date |
| 사후 감사 | `user_feedback` RLS **ON**·FORCE **OFF**·정책 **0**·anon **0**·authenticated **0**·service_role **0**(ACL은 소유자 postgres만). 다른 relation 43개 변화 0, 명시 권한 추가/삭제 0, policies·sequenceAcl·defaultAcl·schemaUsage·roles·memberships 동일, Batch A 유지, Data API 503 동일 |
| push 전 기준 | feedback 26/26, src 2115/2115, tsc FAIL_EXISTING_SCRIPT_ERRORS(src 0), eslint 0, build 0 |
| 배포 | push 1회(`baff846..05583bc`) → 23:49:58 KST 배포 Ready, e-jip.com·www alias |
| 스모크 | `/` `/feedback` `/my` `/community` `/map` `/stats/volume` `/report` 200, `/admin/feedback` 비로그인 307 → `/my`, 관리자 API 비로그인 401, 잘못된 제출 400(행 생성 없음), `/feedback` noindex |

### 제출 테스트(각 1건, 총 2건)

| 항목 | 익명 `cmu2sj0gv000087ip5q1o83u4` | 로그인 `cmu2skjx000007koa7vnyt4h2` |
|---|---|---|
| 경로 | 공개 API에 쿠키 없는 Node fetch | 운영자 실제 세션으로 `/feedback` 화면 제출(390px) |
| 응답 | 201 | 201(화면 성공 문구) |
| 저장 | FEATURE_REQUEST · NEW · 메시지 한글 원문 | DATA_ERROR · NEW · 메시지 한글 원문 |
| 사용자 | user_id 없음 | user_id 있음(값 미출력) |
| ipHash | `v1:` 67자 | 없음 |
| 페이지 | `/my`, 쿼리 `period=7d`만(보낸 `code`·`state`·`token`·`callbackUrl` 제거) | `/my`, 쿼리 없음 |
| 민감 정보 스캔 | 행 전체 JSON에 next-auth·session-token·callbackUrl·code=·token=·state=·password·cookie 없음, IPv4 문자열 없음 | 동일 |
| 알림 | `notified_at` 생성 0.36초 후 기록 | 0.38초 후 기록 |

### 화면·관리자

- MY "의견 보내기": 로그인 상태 58px 노출(비로그인 노출은 HTML·로컬 확인), `/feedback?from=/my`.
- `/feedback` 360px: 유형 5개 44px, textarea 16px·maxLength 3000, 제출 48px·초기 비활성, 넘침 0. 390px 제출 중 "보내는 중..." 비활성 → 성공 문구.
- analytics(브라우저 캡처): `feedback_submit` = 이름 + `actionType: DATA_ERROR`, complexId·aptName null. 서버 저장 행 0 — 운영자(관리자) 세션 트래픽은 기존 분류기가 제외(설계). 실제 사용자 트래픽에서 확인 필요.
- `/admin/feedback`(관리자 세션): 2건 최신순, 처리전 배지·유형·로그인/비로그인·KST 시각·미리보기·페이지, 메일 알림 없음 경고 없음(둘 다 notified). 필터: 유형 기능 건의 → 1건, 오류 신고 → 빈 상태, 상태 완료 → 빈 상태, 처리전 → 2건. 펼침: 전문·단지(-)·시군구 코드(-)·페이지·허용 쿼리·UA·접수/알림/완료/수정 시각·운영 메모·상태 버튼. 목록 API 항목에 userId·ipHash 없음.
- 상태(익명 테스트 행 1건만): NEW → 확인중(resolvedAt null) → 완료+메모(resolvedAt 기록, 메모 저장) → 확인중(resolvedAt null, 메모 유지) → 완료(resolvedAt 새 시각). 최종 배지 완료, 로그인 테스트 행은 NEW 그대로.

### 로그

- Vercel(조회 창 약 5분, 57건): 2xx만, `POST /api/feedback` 201·`PATCH` 200×4·목록 200, `FEEDBACK_`·Prisma·permission·Resend 오류 줄 0.
- `error_logs` 배포 이후 0건.

### 사용자 확인 필요

- 운영자 수신함 도착(제목 `[이집 새 의견] 기능 건의` / `[이집 새 의견] 데이터 오류`, 발신 e-jip.com, 본문 유형·내용·발생 화면 `/my`·관리자 링크, user id·IP·ipHash·UA 없음).
- Resend 대시보드 Emails/Logs의 발송·전달 상태 — 자동화 탭에서 대시보드 목록이 로드되지 않아(2회 "Loading...") 확인하지 못함.
- 로그인한 **비관리자** 계정의 `/admin/feedback` 차단(비로그인 307/401과 코드·테스트는 확인).

### Production 테스트 행

위 2건(`[TEST][ANONYMOUS]`, `[TEST][LOGGED_IN]`) 보존. 익명 행은 상태 QA로 완료·메모 상태. **삭제는 별도 승인 후.**
