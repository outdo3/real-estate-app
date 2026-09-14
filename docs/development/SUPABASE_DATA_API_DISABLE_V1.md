# SUPABASE DATA API DISABLE V1

- 기준 HEAD: `c2b6748` (main)
- 사용자 승인: "Supabase Data API 비활성화 승인" (Data API만. RLS/grant/schema/Storage/키 교체 제외)
- 상태: **적용 완료** — 2026-09-14 사용자가 Supabase Dashboard에서 Enable Data API OFF 후 저장. 검증 §6.

## 1. 원래 노출 (요약)

변경 전 Supabase Data API(PostgREST)가 켜져 있었고, public schema 테이블이 REST 경로로 게시돼 있었다. 해당 테이블들에는
RLS가 꺼져 있고 API 역할에 광범위한 grant가 있었다. 즉 API 키를 가진 누구든 REST로 테이블에 접근할 수 있는 구조였다.
세부 테이블·권한 목록은 공개 저장소에 기록하지 않는다.

## 2. 실제 의존성 (코드 전체 검색)

| 분류 | 대상 | Data API 사용 |
|---|---|---|
| A. 운영 런타임 | Next.js 앱 전체(`src/`), API route, cron(`/api/cron/*` → `src/lib/sync`) | **0** — 모두 Prisma(`DATABASE_URL`, pooler) |
| A. 운영 런타임 | 단지 시설 조회(`/api/apt/[name]/facilities`) | 0 — Prisma로 읽음 |
| B. 수동 개발 도구 | `scripts/crawl_facilities.py` | **사용** — supabase-py로 `apartments` upsert(수동 실행, 스케줄 없음). 비활성화 후 이 스크립트의 쓰기 경로는 동작하지 않는다(`--dry-run`은 무관) |
| C. 미사용 | `@supabase/*` npm 의존성, `NEXT_PUBLIC_SUPABASE*`, Supabase Auth, RPC, Realtime | 없음 |

인증은 NextAuth(JWT session)이며 Supabase Auth를 쓰지 않는다. cron 스케줄(`vercel.json`)은 이번 STEP에서 변경하지 않았다.

## 3. Prisma 경로

`prisma/schema.prisma` datasource = `env("DATABASE_URL")`(pooler 호스트), `src/lib/prisma.ts` 단일 `PrismaClient`.
Data API(PostgREST)를 거치지 않는 직접 Postgres 연결이다. Supabase 문서: Data API를 끄면 DB는 표준 Postgres처럼
직접/pooler 연결로 계속 사용한다.

## 4. Storage 분리

Storage API(`/storage/v1`)는 Data API(`/rest/v1`)와 별도 서비스다. 비활성화 전·후 모두 service role bucket 목록 조회
**HTTP 200, bucket 0개**(실측). Data API OFF는 Storage 서비스를 막지 않았다 → 향후 COMMUNITY IMAGE의 서버 경유
Storage 설계(service role, `/storage/v1`)와 충돌하지 않는다. bucket은 생성하지 않았다.

## 5. 비활성화 방법

Supabase 문서(Securing your API): Dashboard의 **Data API** 개요에서 **Enable Data API** 토글을 끈다.
"With the Data API disabled, none of the auto-generated REST endpoints respond, regardless of grants or RLS."
문서상 CLI/Management API 경로는 제시되지 않았고, 이 환경에는 관리 토큰도 없어 사용자가 대시보드에서 적용했다.
프로젝트 pause, DB 설정, grant/RLS, 키 교체는 하지 않는다.

## 6. 검증

`scripts/audit-supabase-data-api-exposure.ts` (read-only, status/개수만 출력) + production smoke.

| 항목 | 변경 전 (02:20Z) | 변경 후 (05:08Z / 05:09Z / 05:14Z) |
|---|---|---|
| Data API root (키 없음) | 401 | 401 |
| Data API root (서버 키) | 200, 테이블 경로 게시됨 | **503**, 게시 경로 0 |
| 민감 테이블 경로 HEAD limit=0 (서버 키) | 200 | **503** |
| 유효하지 않은 키 | — | 401 Invalid API key |
| Storage bucket 목록 (서버 키) | 200, 0개 | **200, 0개** |
| Prisma 직접 read | 정상 | 정상 (SELECT 1, count) |
| 앱 smoke 9개(홈/커뮤니티/통계/단지/검색/게시글 API/갭투자/단지 거래/시설) | 전부 200 | 전부 200, 응답 크기 동일 |
| NextAuth providers/csrf/session | 200 | 200 |
| cron 무인증 | 401(실행 안 됨) | 401(실행 안 됨), `vercel.json` 변경 없음 |
| DB 역할 grant·RLS | 기록만 | **변경 없음**(이번 STEP 범위 밖) |

변경 후 503 응답은 PostgREST `PGRST002`(schema cache 조회 불가)다. **가장 높은 권한인 서버 키로도** 어떤 테이블 경로도
응답하지 않으므로 그보다 낮은 권한(anon 포함)도 REST로 조회할 수 없다(anon 키는 이 감사에서 사용하지 않았다).
Supabase 문서의 비활성화 동작(노출 schema를 존재하지 않는 `pg_pgrst_no_exposed_schemas`로 설정)과 일치하며, 해당
namespace가 DB에 없음을 read-only로 확인했다. 같은 시각 Prisma가 같은 DB를 정상 조회하므로 DB 장애가 아니다.
05:08Z·05:09Z·05:14Z 세 차례(6.5분 간격) 결과가 같았다.

## 7. 저장소 secret 감사 (read-only)

- `.env*` 파일: `.gitignore` 대상, 추적/이력 커밋 0.
- 현재 서버 키: 추적 파일·git 전체 이력·`.next/static` 번들에서 일치 0.
- JWT 모양 문자열: 추적 HTML의 Supabase 무관 토큰(iss/role 없음), 로그 마스킹 테스트용 합성 fixture — Supabase 키 아님.
- `NEXT_PUBLIC_SUPABASE*`: 0.
→ 키 교체가 필요한 유출 증거 없음.

## 8. 결과와 남은 보안 작업

**닫힌 것**: Data API(REST)를 통한 외부 테이블 노출.

**이번 STEP이 해결하지 않은 것**:

- Data API를 끈 것은 REST 경로 노출만 막는다. DB 역할 grant·RLS 상태 자체는 그대로다(최소 권한 정리 별도).
- 직접 DB 자격증명(`DATABASE_URL`) 보관·접근 관리.
- service role 키 보관: 현재 로컬 이름이 `SUPABASE_KEY`로 일반적이다. COMMUNITY IMAGE 단계 전
  `SUPABASE_SERVICE_ROLE_KEY`로 명시적 이름 추가/전환 필요(값 교체 아님).
- 향후 Storage bucket/policy 설계(COMMUNITY_IMAGE_UPLOAD_V1 승인 항목).
- `scripts/crawl_facilities.py` 쓰기 경로를 Prisma/직접 연결로 옮기거나 폐기 결정(스크립트 자체는 실행하지 않았다. 같은 REST 엔드포인트가 서버 키로 503이므로 쓰기 모드는 실패할 것).
- 누군가 Data API를 다시 켜면 노출이 즉시 재발한다(grant/RLS가 그대로이므로). 재활성화가 필요해지면 먼저 RLS/grant 정리.

재확인: `ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-supabase-data-api-exposure.ts`
