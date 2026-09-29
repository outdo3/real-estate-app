# REALTOR PRO V1 — 아키텍처 설계

- 상태: **설계 전용.** 코드·schema·migration·auth 변경 없음. 이 문서의 모든 구현 항목은 승인 대상이다.
- 기준: `main` 377acf7 (Next.js 16.3, Prisma 5.22, NextAuth 4.24, Supabase Postgres)

## 0. 설계를 제약한 repo 사실

| 사실 | 위치 | 설계 영향 |
|---|---|---|
| `User.id`는 `String @default(cuid())` | `prisma/schema.prisma` `model User` | 모든 Pro 테이블 소유자 FK는 `String` |
| DB 컬럼 snake_case + `@map`/`@@map`, 사용자 데이터 테이블 PK는 cuid | `Favorite`, `RecentView`, `UserFeedback` | Pro 테이블 동일 규칙 |
| NextAuth **JWT 세션 전략**, `session.user.id`/`role`/`banned`/`isAdmin` | `src/lib/auth.ts` | role 변경은 재로그인/토큰 갱신 때 반영 → Pro 권한은 **매 요청 DB에서 조회**(JWT에 굽지 않음) |
| 서버 인증 헬퍼 `getCurrentUser()`/`requireUser()`/`requireAdmin()` | `src/lib/auth-helpers.ts` | `requireRealtor()`를 같은 패턴으로 추가(향후) |
| `Role` enum: `GUEST/USER/VERIFIED/ADMIN` | schema | 중개사 상태를 `Role`에 섞지 않고 별도 `realtor_profiles.status`로 관리 |
| Next 16 `proxy.ts`(구 middleware), 현재 matcher는 `/admin/:path*`만 | `src/proxy.ts` | `/pro`는 V1에서 proxy를 확장하지 않고 **layout 서버 가드 + API 가드**로 보호(auth 동작 변경 최소화) |
| 공개 지역 판정 단일 소스 | `src/lib/region/enablement.ts` (`getRegionEnablement(lawdCd)`) | Pro prefill도 이 함수로 판정 |
| 단지 정식 식별 = `ApartmentMaster.aptSeq`(unique, nullable) | schema | 매물은 `aptSeq`로 참조. 이름은 표시용 스냅샷 |
| `ApartmentUnitType`은 `Apartment.id`(레거시 캐시 테이블)에 연결, `canonicalExclusiveArea Decimal` | schema | 면적 선택은 `canonicalExclusiveArea` 값 그대로 저장, `representativePyeong`은 Unit Master 제공 시에만 표시 |
| 새 테이블은 Supabase default ACL로 anon/authenticated 권한을 받음 → 기존 방침: **같은 migration에서 revoke + RLS ON(정책 없음)** | `20260915100000_security_hardening_v2_batch_a`, `USER_FEEDBACK_V1.md` | Pro 테이블 전부 동일 적용 |
| 앱은 Prisma로 테이블 owner 권한 접속 → RLS를 우회 | `src/lib/prisma.ts` | **앱 레이어 소유권 검사가 1차 통제**, RLS는 심층 방어 |
| Prisma pool `connection_limit=1` 환경 | 운영 메모 | Pro API에서 `Promise.all` 병렬 쿼리 금지, 순차 또는 단일 쿼리 |
| 모바일 하단 네비 5개 공유 설정 | `src/lib/bottom-nav-items.tsx` | Pro는 기존 탭을 늘리지 않음(§6) |
| 1st-party analytics allowlist | `src/lib/analytics/events.ts` | Pro 이벤트 추가 시 PII 금지 |
| 개인화 점수 모듈 별도 존재 | `src/lib/personalized-score.ts` | 매칭 엔진은 이것과도 분리된 `src/lib/pro/matching/` |

## 1. 모듈 구성

```
src/lib/pro/                (향후)
  access.ts                 requireRealtor(), requireProPlan(), assertOwner()
  plan-limits.ts            Free/Pro 한도 상수 + 검증
  listings/                 매물 CRUD, 가격 변경 이력, 입력 sanitize(비밀번호 패턴 경고)
  customers/                고객 CRUD, 조건 세트
  matching/                 순수 함수 엔진(score.ts, reasons.ts) + 저장(persist.ts)
  briefings/                스냅샷 생성, 토큰 발급/검증, 공개 뷰 데이터 조립
  public-data/              aptSeq → 공공 데이터 prefill(enablement 게이트 포함)
  audit.ts                  감사로그 기록
src/app/pro/...             페이지(§6)
src/app/api/pro/...         API(§6)
src/app/b/[token]/          공개 브리핑 뷰
```

- 매칭 엔진은 **DB 접근 없는 순수 함수**로 두고 단위 테스트로 고정한다(기존 `*-pure.ts` 관행).

## 2. 인증 재사용

- 별도 로그인/계정 체계를 만들지 않는다. 기존 Kakao/Naver/Google OAuth `User`를 그대로 쓰고, 중개사 여부는 `realtor_profiles`(1:1, `user_id` unique)로 확장한다.
- OAuth 계정 연결 정책·세션 전략·토큰 처리는 **변경하지 않는다**.
- 권한 판정은 JWT 값이 아니라 **매 요청 `realtor_profiles` + `realtor_subscriptions` 조회**로 한다. 이유: JWT 전략이라 role 변경이 즉시 반영되지 않으며, 정지(suspend)는 즉시 효력이 있어야 한다.

## 3. 중개사 상태 모델 (B10)

| 상태 | 판정 | 가능한 것 |
|---|---|---|
| 일반 사용자 | `realtor_profiles` 없음 | 이집 일반 기능 + `/pro` 소개·신청 |
| 신청자 `APPLICANT` | profile.status=`PENDING_REVIEW` | 신청서 수정, 상태 확인. 매물/고객 입력 **불가** |
| 인증 중개사 `VERIFIED` | status=`VERIFIED` | 플랜에 따른 기능 |
| └ Free | subscription 없음 또는 `FREE` | Free 한도 |
| └ Pro | subscription `ACTIVE`(또는 베타 `BETA_GRANT`) & 기간 내 | Pro 한도 |
| 반려 `REJECTED` | status=`REJECTED` | 사유 확인, 재신청 |
| 정지 `SUSPENDED` | status=`SUSPENDED` | 로그인 가능, Pro 전체 **읽기/내보내기만**, 공유 링크 즉시 비활성 |

- 기존 `User.banned`(커뮤니티 제한)와 `realtor_profiles.status`는 **독립**이다. 단 `banned=true`면 브리핑 생성 차단(외부 노출 행위이므로) — 정책 결정 필요.
- 상태 전환은 관리자만 가능하고 전부 `realtor_audit_logs`에 기록.

### 3.1 자격 검증 (수동 우선)

| 항목 | V1(수동) | 이후(자동) |
|---|---|---|
| 공인중개사 자격번호 | 신청서 입력 + 관리자 대조 | 공공 조회 API 존재·이용조건 확인 후 검토(유료 API 임의 추가 금지) |
| 중개사무소 등록번호 | 입력 + 관리자 대조(국가공간정보포털 등 공개 조회 수동 확인) | 동일 |
| 사업자등록번호 | 입력(선택) | 국세청 상태조회 API 검토 |
| 증빙 파일 업로드 | **V1에서 받지 않음**(민감 파일 보관 리스크). 필요 시 관리자와 별도 채널 | 보관 정책·암호화 설계 후 |

- 자격번호·등록번호 원문은 `CUSTOMER_PERSONAL`급으로 취급(§7), 화면에는 마스킹 표시.
- 검증 방식·보관은 **법률 검토 필요**.

## 4. 플랜/한도 게이트

- `requireRealtor()` → `{ user, profile, plan: 'FREE' | 'PRO' }` 반환. 모든 `/api/pro/*` 첫 줄에서 호출.
- 한도는 `plan-limits.ts` 상수. 베타 동안 `PRO_BETA_ALL_PRO`(서버 전용 env, 이름만) 또는 subscription `BETA_GRANT`로 전원 Pro.
- 결제 연동은 Phase 3에서 별도 설계·승인(PG 선정, 웹훅 검증, 청약철회).

## 5. 이집 공공 데이터 연동 (B7)

### 5.1 단지 선택 흐름

1. 중개사가 매물 등록 시 기존 검색(`/api/search`, `APARTMENT` 결과 계약)으로 단지 선택 → **`aptSeq`, `lawdCd`, `umdName`(dong)** 을 받음.
2. `aptSeq` 없는 결과(미식별 단지)는 "단지 정보 미연결" 매물로 저장 가능하되 prefill·매칭의 단지 기반 조건(학교/통근 등)은 `UNKNOWN` 처리. **이름으로 다른 단지를 찾아 연결하지 않는다.**
3. 저장 시 `apt_seq`(식별) + `apt_name_snapshot`(표시용) 저장. 이후 표시·조회는 `aptSeq`로만.

### 5.2 Prefill 항목과 게이트

| 데이터 | 원천 | 게이트 |
|---|---|---|
| 단지명·주소·준공연도·세대수·주차 | `ApartmentMaster` | 항상 가능(중개사 본인 입력 보조, 공개 노출 아님) |
| 좌표 | `ApartmentMaster.latitude/longitude` | 항상 |
| 면적 선택지 | `ApartmentUnitType.canonicalExclusiveArea` (Unit Master) | 없으면 실거래 원본 전용면적 ㎡ 목록 또는 직접 입력(㎡) |
| 최근 실거래·가격 추이 | `ApartmentTradeHistory` / 기존 trade read 경로 | `getRegionEnablement(lawdCd).detail === true`일 때만 |
| 학교·입지 feature | `ApartmentLocationFeature`, `School` | 해당 데이터가 적재된 지역만(현재 부산 중심). 없으면 `unavailable` |
| 브리핑의 공공 데이터 섹션 | 위 동일 | **`detail`이 닫힌 지역은 공공 섹션 생략**, "이 지역 공공 데이터는 준비 중" 표기 |

- 닫힌 지역(`detail=false`)의 실거래를 Pro 경로로 우회 노출하지 않는다 — Pro는 공개 게이트의 **예외가 아니다**.
- data truth 상태(`missing`/`unavailable`/API error/unresolved identity/verified zero)는 그대로 전달. 조회 실패를 "거래 없음"으로 표기하지 않는다.

### 5.3 면적 규칙

- 저장값: `exclusive_area_m2 Decimal`(= 선택한 `canonicalExclusiveArea` 그대로) + 선택적 `unit_type_ref`.
- 표시: Unit Master `representativePyeong`(신뢰 source)이 있을 때만 "OO평", 없으면 "84.97㎡". `/3.3058` 계산 평형 금지, 공급면적 추정 금지.
- 고객 조건의 면적은 **㎡ 범위**(min/max)로 저장. UI 칩("59㎡대/84㎡대")은 표시일 뿐 identity 아님.

### 5.4 데이터 분리

- 중개사 비공개 데이터는 `realtor_*` 테이블에만. 공공 테이블(`apartment_masters` 등)에 쓰지 않는다.
- 공개 화면(단지 상세·지도·통계·리포트·sitemap)은 `realtor_*`를 **읽지 않는다**. 이를 테스트로 고정(공개 read path에서 `realtor` 모델 import 금지 lint/test).

## 6. IA / 라우트 (B11)

### 6.1 페이지

| 경로 | 내용 | 가드 |
|---|---|---|
| `/pro` | 소개 + 상태별 진입(미신청→신청, 심사중→상태, 인증→대시보드 이동) | 공개 |
| `/pro/apply` | 중개사 신청서 | 로그인 |
| `/pro/dashboard` | 오늘 해야 할 일 | VERIFIED |
| `/pro/listings` | 매물 목록(활성/보관 탭, 검색) | VERIFIED |
| `/pro/listings/new` | 매물 등록(단지 검색 → 면적 → 가격 → 상태) | VERIFIED |
| `/pro/listings/[id]` | 매물 상세·노트·가격 이력·매칭 고객 | 소유자 |
| `/pro/customers` | 고객 목록(우선순위·재연락일 정렬) | VERIFIED |
| `/pro/customers/new` | 고객 등록 | VERIFIED |
| `/pro/customers/[id]` | 고객 상세·조건·팔로업·매칭 매물 | 소유자 |
| `/pro/matches` | 매칭 결과 목록(고객별/매물별 전환) | VERIFIED |
| `/pro/briefings` | 생성한 브리핑 목록, 열람/만료/회수 | VERIFIED |
| `/pro/briefings/new?customerId=&listingId=` | 브리핑 미리보기·생성 | 소유자 |
| `/pro/settings` | 프로필(이름·사무소·연락처·로고), 플랜, 내보내기, 삭제 | VERIFIED |
| `/b/[token]` | **공개 브리핑 뷰**(고객용) | 토큰 |
| `/admin/pro/applications` | 신청 심사 | 관리자(기존 proxy 범위) |

- `/pro/*`는 `src/app/pro/layout.tsx`(서버 컴포넌트)에서 `requireRealtor()` → 미로그인 `/my`로 유도, 미인증 `/pro`로 redirect. 모든 `/pro/*`와 `/b/*`는 `robots: noindex`, sitemap 제외.
- `/b/[token]`은 짧은 경로로 두어 문자·메신저 붙여넣기 편의. `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`.

### 6.2 API

| Method | 경로 | 비고 |
|---|---|---|
| POST/GET | `/api/pro/profile` | 신청·조회·수정 |
| GET/POST | `/api/pro/listings` | 목록/생성(한도 검사) |
| GET/PATCH/DELETE | `/api/pro/listings/[id]` | 소유권 검사, DELETE=soft delete |
| POST | `/api/pro/listings/[id]/notes` | 노트 추가 |
| GET/POST | `/api/pro/customers` | |
| GET/PATCH/DELETE | `/api/pro/customers/[id]` | |
| PUT | `/api/pro/customers/[id]/preferences` | 조건 세트 |
| GET | `/api/pro/matches?customerId=|listingId=` | 계산 결과 |
| POST | `/api/pro/matches/recompute` | 수동 재계산(Free), Pro는 변경 시 자동 |
| PATCH | `/api/pro/matches/[id]` | SEEN/DISMISSED/SHORTLISTED |
| GET/POST | `/api/pro/followups`, PATCH `/[id]` | |
| GET/POST | `/api/pro/briefings`, PATCH `/[id]`(회수/만료) | |
| GET | `/api/pro/dashboard` | 오늘 할 일 집계(순차 쿼리) |
| GET | `/api/pro/export` | 본인 데이터 CSV(감사로그 기록) |
| POST | `/api/pro/briefings/view/[token]` | 열람 기록(봇 필터, 카운트만) |
| GET/PATCH | `/api/admin/pro/applications` | `requireAdmin()` |

- 모든 쓰기 API: 입력 zod 검증 → `requireRealtor()` → `assertOwner(row.realtorId === profile.id)` → 쓰기 → 감사로그(민감 작업만).
- 존재하지 않음과 타인 소유는 **둘 다 404**로 응답(타인 리소스 존재 여부 비노출).

### 6.3 모바일 네비게이션 공존

- 기존 `BOTTOM_NAV_ITEMS` 5탭(홈/지도/통계/재개발·분양/MY)은 **변경하지 않는다**.
- 진입점: `/my` 페이지에 "중개사 Pro" 카드(인증 중개사일 때 "Pro 대시보드").
- `/pro/*` 내부에서는 **Pro 전용 하단 탭**(대시보드/매물/고객/매칭/브리핑)으로 교체 렌더링하고, 상단 헤더에 "이집으로 돌아가기" 링크. 두 하단 바가 동시에 나오지 않도록 `Header`의 하단 탭 렌더를 `/pro` 경로에서 숨김(구현 시 `BottomNavItem` 설정 공유 방식 유지).
- 360/375/390px: 하단 탭 5개 × 최소 64px 폭, 터치 44px 이상, 폼 하단 고정 CTA가 하단 탭과 겹치지 않게 `safe-area-inset-bottom` 반영. 가로 스크롤 금지. 데스크톱은 좌측 사이드 네비 + 2단(목록/상세) 레이아웃.

## 7. 개인정보·보안 (B9)

### 7.1 데이터 분류

| 등급 | 예시 | 저장 | 노출 |
|---|---|---|---|
| `PUBLIC` | 단지 master, 실거래, 좌표, 학교 | 공공 테이블 | 공개 화면, 브리핑 |
| `REALTOR_PRIVATE` | 매물 호가·층·메모·태그·출처, 중개사 노트, 매칭 결과 | `realtor_*` | 소유 중개사만. 브리핑에는 **중개사가 선택한 필드만** |
| `CUSTOMER_PERSONAL` | 고객/소유자 이름·연락처, 예산, 통근지, 자녀 학교 선호, 반려동물, 임차인 정보, 자격·등록번호 | `realtor_*`(연락처 암호화 검토) | 소유 중개사만. 브리핑에 **절대 미포함**(해당 고객 본인 이름도 기본은 이니셜) |
| `SENSITIVE_DO_NOT_STORE` | 현관/세대 출입 비밀번호, 공동현관 번호, 열쇠 보관 위치, 주민등록번호, 계좌번호, 신분증 사본, 건강정보 | **저장하지 않음** | — |

### 7.2 출입 비밀번호 대체 설계 (B4)

- 스키마에 비밀번호/키 필드를 **두지 않는다**.
- 대신 `viewing_method` enum(`CONTACT_REALTOR` 기본 / `OWNER_PRESENT` / `TENANT_COORDINATION` / `VACANT_CONTACT_REALTOR`) + `viewing_note`(짧은 자유 텍스트, 예: "평일 저녁 임차인과 사전 조율").
- 입력 UI 경고문: "출입 비밀번호·열쇠 위치는 입력하지 마세요. 유출 시 범죄에 악용될 수 있습니다."
- 서버 측 sanitize: 메모/노트 필드에 `비번|비밀번호|현관|도어락|#\d{3,}|\*\d{3,}` 등 패턴 감지 시 **저장 전 경고 모달**(강제 차단 대신 확인 요구 — 오탐 대비). 감지 여부만 로그, 내용은 로그에 남기지 않음.

### 7.3 동·호수 노출 규칙

- `building_dong`·`unit_ho`는 `REALTOR_PRIVATE`. 목록 화면은 "OO동 중층"처럼 요약, 호수는 상세에서만.
- 브리핑에는 호수 **미포함**, 동은 중개사가 명시 선택 시에만, 층은 "저/중/고층" 구간 기본(정확 층은 선택).

### 7.4 접근 통제

| 주체 | 권한 |
|---|---|
| 중개사 | **본인 `realtor_profile_id` 소유 행만** CRUD. 모든 쿼리에 `where: { realtorId }` 강제(헬퍼로 강제, 직접 `findUnique({id})` 금지) |
| 팀/사무소 | V1 없음. 향후 `realtor_offices` + 멤버십·역할 설계 후 |
| 브리핑 수신 고객 | 토큰으로 **스냅샷 1건만** 읽기 |
| 플랫폼 관리자 | 신청 심사 정보만 조회. 매물·고객 데이터 **일상 열람 불가**(관리 UI 없음). 분쟁·법적 요청 시 break-glass: 사유 입력 → 대상 한정 조회 → 감사로그 + 해당 중개사 사후 통지(정책 결정 필요) |

- **1차 통제 = 앱 레이어 소유권 검사.** Prisma가 테이블 owner로 접속해 RLS를 우회하므로 RLS만 믿으면 안 된다.
- **RLS = 심층 방어.** 신규 `realtor_*` 테이블은 생성 migration에서 anon/authenticated/service_role 권한 revoke + `ENABLE ROW LEVEL SECURITY`(정책 없음) — 기존 Batch A 관행. Supabase 클라이언트로 직접 접근하는 경로를 만들지 않으며, 만들게 되면 `auth.uid()` 매핑 정책을 별도 설계.

### 7.5 보존·삭제·내보내기

| 대상 | 정책(가설, 법률 검토 필요) |
|---|---|
| 고객 레코드 | 중개사가 삭제 시 soft delete → 30일 후 hard delete. 마지막 활동 후 N년(예: 3년) 경과 시 삭제 안내 |
| 매물(비활성) | 보관 무기한(중개사 소유 업무기록) — 단 소유자 연락처는 거래 종료 후 삭제 권고 UI |
| 브리핑 스냅샷 | 만료 후 90일 뒤 스냅샷 본문 삭제, 메타(생성일·열람수)만 유지 |
| 감사로그 | 1년 보존(가설) |
| 중개사 탈퇴 | 내보내기 안내 → 30일 유예 → 전체 `realtor_*` 삭제(cascade), 감사로그는 식별자 가명화 후 보존 |
| 내보내기 | 본인 데이터 CSV, 연락처 포함 여부 선택, 감사로그 기록 |

### 7.6 암호화

- 연락처(`*_phone`, `*_email`)는 **애플리케이션 레벨 암호화** 후보: AES-256-GCM, 키는 서버 env(이름 예: `PRO_FIELD_ENC_KEY`, 값은 문서/코드에 두지 않음), 검색용 `phone_hash`(HMAC, 뒤 4자리 검색 지원 시 별도 컬럼).
- 트레이드오프: 암호화 시 DB 검색 불가·키 회전 비용. V1 결정 옵션 — (A) MVP는 평문 + 전송/저장 기본 암호화(Supabase at-rest)만, Phase 2에 필드 암호화 / (B) MVP부터 필드 암호화. **권장 (B) 연락처 한정** — 나중에 평문 데이터를 마이그레이션하는 비용이 더 크다.
- 로그/에러 로그(`log-redaction.ts` 재사용)에 연락처·이름이 남지 않도록 redaction 대상 키 추가.

### 7.7 개인정보보호법 고려사항 (설계 수준, **법률 검토 필수**)

| 쟁점 | 설계 대응(초안) |
|---|---|
| 처리 주체 | 고객·소유자 정보의 수집 주체는 **중개사**, 이집은 **수탁자(처리위탁)** 구조로 보는 안이 유력 — 위탁 계약/약관 조항 필요. 확정은 법률 검토 |
| 수집 동의 | 고객 레코드에 `consent_status`(`NOT_RECORDED`/`VERBAL`/`WRITTEN`/`WITHDRAWN`)·`consent_recorded_at` 필드. 중개사가 고객 동의를 받았음을 기록하도록 유도(이집이 동의를 대리 취득하지 않음) |
| 목적 제한 | 매칭·연락·브리핑 목적 외 사용 금지. 이집은 Pro 데이터를 광고·통계·학습에 쓰지 않음을 약관에 명시(결정 필요) |
| 최소 수집 | 필수는 이름(또는 별칭)만. 연락처·자녀 학교 등은 선택 |
| 제3자 제공 | 브리핑 공유는 중개사가 **고객 본인에게** 매물 정보를 제공하는 것. 매물 소유자·다른 고객 정보는 포함하지 않으므로 제3자 제공이 발생하지 않도록 설계. 공유 링크 전달 범위는 통제 불가 → 만료·회수·개인정보 미포함으로 대응 |
| 정보주체 권리 | 중개사가 고객 요청 시 열람·정정·삭제 가능한 UI 제공 |
| 보존 기한 | §7.5, 공인중개사법상 거래 관련 서류 보존 의무와의 관계 확인 필요 |
| 유출 대응 | 감사로그 + 관리자 break-glass 기록 + 통지 절차 문서화 |

### 7.8 감사로그 대상

로그인 자체는 제외. 기록: 중개사 상태 변경(관리자), break-glass 열람, 내보내기, 고객/매물 hard delete, 브리핑 생성·회수, 연락처 복호화 대량 조회(내보내기), 플랜 변경. **로그 본문에 연락처·메모 원문을 넣지 않고 대상 id만.**

## 8. 매칭 엔진 V1 (B6)

### 8.1 원칙

- **결정적·설명 가능**: 같은 입력 → 같은 결과. 모든 점수는 사유 목록으로 분해 가능.
- 생성형 AI/불투명 모델 미사용.
- **E-JIP Score V2 및 개인화 점수와 분리**: 입력으로 쓰지도, 결과를 섞지도 않는다. 매칭 %는 "이 고객 조건과 이 매물의 일치도"일 뿐 단지 품질 점수가 아님을 UI에 명시.

### 8.2 Hard filter (하나라도 실패 → 매칭 제외, 사유는 "제외 이유"로 보관)

| 조건 | 판정 |
|---|---|
| 거래유형 | 고객 `dealTypes`에 매물 `dealType` 포함 |
| 예산 상한 | 매매: 호가 ≤ `budgetMax × (1 + tolerance)` (기본 tolerance 0%, 고객별 0~10% 설정) / 전세: 보증금 기준 / 월세: 보증금 ≤ 상한 AND 월세 ≤ `monthlyRentMax` |
| 지역 | 고객 희망 지역(`lawdCd` 목록 또는 `aptSeq` 목록)이 있으면 매물 `lawdCd`/`aptSeq` 포함 |
| 매물 활성 | `is_active=true` & 계약완료 아님 |
| 고객 필수 조건 | 고객이 "필수"로 표시한 항목(예: 주차 필수, 반려동물 가능 필수) |

### 8.3 Soft preference (가중치 합 100, V1 기본값 — 고객별 조정은 Phase 2)

| 항목 | 기본 가중치 | 점수 계산(0~1) |
|---|---|---|
| 예산 적합 | 25 | 예산 범위 안 1.0 / min 미만(너무 저렴) 0.8 / tolerance 구간 선형 감소 |
| 면적 | 20 | 고객 ㎡ 범위 안 1.0 / 범위 밖 ±10% 이내 0.5 / 그 외 0 |
| 입주 시기 | 15 | 입주가능일과 희망일 차이 ≤7일 1.0, ≤30일 선형 감소, 초과 0 |
| 통근 | 10 | 단지 좌표↔고객 통근지 **직선거리** 구간(≤5km 1.0, ≤10km 0.6, 그 외 0.2). V1은 경로 API 없음, UI에 "직선거리 기준" 명시 |
| 학교 | 10 | 고객 희망 학교(`School` id)가 있으면 단지 feature 기준 거리/배정 정보 있을 때만 판정, 없으면 `UNKNOWN` |
| 층 | 5 | 저/중/고 선호 일치 1.0 |
| 신축 선호 | 5 | 준공 10년 이내 1.0 / 20년 이내 0.5 |
| 주차 | 5 | 필수가 아니면 soft |
| 반려동물·기타 | 5 | 매물 표시와 일치 |

### 8.4 점수와 UNKNOWN 처리

- `matchPercent = round(100 × Σ(w_i × s_i) / Σ(w_i for 판정 가능 항목))`
- 매물·고객 한쪽이라도 값이 없는 항목은 `UNKNOWN`으로 **분모에서 제외**하고 사유에 "확인 필요"로 표시(없는 데이터를 불리/유리하게 가정하지 않음). 판정 가능 가중치 합이 50 미만이면 %를 보이지 않고 "정보 부족"으로 표시.
- 결과 저장: `score`, `reasons[]`(구조화 JSON), `engine_version`("v1.0"), `computed_at`, 입력 해시(재계산 필요 여부 판정).

### 8.5 설명 예시

```
박OO 고객과 91% 일치
 ✓ 예산 범위 안 (호가 8.9억 / 예산 8.0~9.5억)
 ✓ 요청 면적 84㎡대와 일치 (전용 84.97㎡)
 ✓ 통근지(센텀시티역)까지 직선 3.1km
 ✓ 희망 학교 반경 조건 충족
 △ 입주 가능일이 희망일보다 2주 늦음
 ? 주차 조건 — 매물 정보 없음(확인 필요)
```
(UI에서는 lucide 아이콘으로 표시, 이모지 미사용)

### 8.6 실행 시점

| 트리거 | Free | Pro |
|---|---|---|
| 고객 화면 "맞는 매물 보기" | 동기 계산, 상위 3 | 동기 계산, 전체 |
| 매물 생성/가격 변경, 고객 조건 변경 | 없음 | 해당 1건 × 상대 전체 재계산(최대 300×500=15만 쌍, 순수 함수라 서버 1회 수백 ms 수준 추정 — 구현 시 측정) |
| 신규 고매칭(≥70) | — | 대시보드 "매칭된 매물"에 표시(푸시/카톡 알림은 범위 밖) |

## 9. 고객 브리핑 (B8)

### 9.1 생성 흐름

1. 중개사: 고객 + 매물(또는 매물 없이 단지만) 선택 → 미리보기.
2. 포함 섹션 토글(기본 ON: 단지 기본, 호가, 최근 실거래 맥락, 가격 추이, 입지 요약, 일치 이유, 조건과 다른 점, 중개사 정보).
3. 생성 시 **스냅샷**(표시할 값 전체를 JSON으로 고정) 저장 → 이후 매물·고객 수정이 공유된 브리핑을 바꾸지 않음(설명한 내용의 증거 보존). 공공 데이터 기준일 표기.

### 9.2 표시/비표시

| 표시 | 비표시(절대) |
|---|---|
| 단지명·주소(동 단위)·준공·세대수 | 소유자 이름·연락처 |
| 호가/보증금/월세, 면적(Unit Master 규칙) | 호수, 출입/열람 방법 상세 |
| 최근 실거래 맥락(같은 면적 최근 N건, 기준일) — 공개 지역만 | 중개사 비공개 메모·노트·태그·출처 |
| 가격 추이 요약 — 공개 지역만 | 다른 고객 정보·다른 매칭 |
| 입지 요약(역·학교 거리, 데이터 있을 때만) | 고객 예산 원문(기본). "예산 범위 안"만 표기 |
| 일치 이유·조건과 다른 점 | 고객 연락처·이름 전체(기본 "박OO 고객님") |
| 중개사 이름·사무소·연락처·로고(Pro) | E-JIP Score를 매칭 %처럼 보이게 하는 표현 |

- 브리핑 하단 고지: "본 자료는 참고용이며 실거래 데이터는 국토교통부 공개 자료 기준(기준일)입니다. 매물 정보는 중개사가 제공한 내용입니다." (문구 **법률 검토 필요**, 중개대상물 표시·광고 규정 관련 확인)

### 9.3 공유 토큰

| 항목 | 설계 |
|---|---|
| 토큰 | 32바이트 CSPRNG, base64url(43자). DB에는 **SHA-256 해시만** 저장, 원문은 생성 응답에서 1회만 반환 |
| URL | `https://<canonical>/b/<token>` — 기존 canonical share origin 규칙 재사용 |
| 만료 | Free 7일 고정, Pro 1~30일 선택. 만료/회수 시 410 페이지("만료된 브리핑입니다", 중개사 연락처도 미표시) |
| 회수 | 중개사가 즉시 revoke 가능. 정지된 중개사의 링크는 자동 비활성 |
| 열람 기록 | 첫 열람 시각·열람 횟수(봇/미리보기 크롤러 UA 제외 — 기존 BOT_LIKE 판정 재사용). IP·UA 원문 저장 안 함 |
| 색인 | `noindex, nofollow`, sitemap 제외, OG 이미지는 개인정보 없는 일반 카드 |
| 무차별 대입 | 토큰 엔트로피로 충분 + `/b/*` 요청 rate limit(인스턴스 로컬) |

### 9.4 형태

- **모바일 카드**: 360px 1장 요약(단지·가격·일치율·상위 3 이유·중개사 연락 버튼). 기존 `dom-to-png.ts`로 이미지 저장 가능(Phase 2).
- **웹 리포트**: `/b/[token]` 스크롤 페이지, 섹션별 카드. 기존 한장 리포트(`src/lib/report/apt-report.ts`) 컴포넌트/계산 재사용하되 입력은 스냅샷.
- 공유 방식: 링크 복사 + OS 네이티브 공유(기존 share chooser 규칙). **카카오 API 자동 발송 없음.**

## 10. 성능·운영

- Pro 테이블은 중개사 단위 조회가 대부분 → `(realtor_id, ...)` 복합 인덱스 우선.
- 커넥션 1개 환경: 대시보드는 섹션별 순차 쿼리 또는 단일 CTE. 측정 후 최적화.
- 공공 데이터 prefill은 기존 캐시(`server-cache`, `detail-resource-cache`) 재사용, Pro 전용 외부 API 호출 추가 없음.
- `main` push = production 배포 가능성 → Pro는 feature flag(`PRO_ENABLED`, 서버 env, 기본 false)로 전체 차단 상태에서 배포.

## 11. 승인이 필요한 결정 목록

| # | 결정 | 필요 시점 |
|---|---|---|
| A1 | `realtor_*` 테이블 신설(schema/migration) | MVP Day 1 이전 |
| A2 | 연락처 필드 암호화 방식(§7.6 A/B) | A1과 함께 |
| A3 | `/pro` 경로에서 Header 하단 탭 교체 | MVP |
| A4 | 관리자 break-glass 정책·중개사 통지 여부 | 베타 전 |
| A5 | 개인정보 처리위탁 구조·약관·동의 문구 | **베타(외부 중개사 사용) 전 법률 검토** |
| A6 | 결제 PG·가격 | Phase 3 |
| A7 | `User.banned`와 Pro 상호작용 | MVP |
