# AUTH/MY V1 — MY-5A: PRE-MERGE FINAL QA

## 1. Baseline & Git State
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `b88a32b feat(auth): add google oauth login`
- **Origin/Main**: `2adebb7 docs(score-v2): add production release documentation`
- **Status**: Branch is clean (except for unrelated `schema_old.prisma`). All changes are scoped strictly to AUTH/MY V1.

## 2. Complete Change Inventory
- **Prisma Schema**: `Favorite`, `RecentView`, `UserPreference` 모델 추가 (기존 사용자 테이블 관계 연결 완료)
- **Migrations**: `2024..._add_auth_my_v1` (Production DB에 이미 적용됨. `npx prisma migrate status` 결과 'Database schema is up to date!')
- **Auth**: `NextAuth` 기존 설정 유지. JWT 세션 사용, `PrismaAdapter` 연동. Google Provider 추가 (`src/lib/auth.ts`)
- **API Routes**:
  - `GET /api/my/favorites`
  - `POST /api/my/favorites`
  - `DELETE /api/my/favorites`
  - `GET /api/my/recent`
  - `POST /api/my/recent/sync`
  - `GET /api/my/preferences`
  - `PUT /api/my/preferences`
- **UI Components**: `FavoriteButton.tsx`, `LoginModal.tsx` (Google 버튼 추가), `AuthGate.tsx`
- **Pages**: `/my` (IA 전면 재구성: 프로필, 관심단지, 최근 본 단지, 관심 목적 설정)

## 3. Auth Review
- `requireUser()`를 모든 보호된 API에 적용.
- `session.user.id`만을 신뢰하며 클라이언트가 보낸 `userId` 페이로드는 일절 사용하지 않음.
- **Account Linking**: `allowDangerousEmailAccountLinking` 비활성화 유지. (동일 이메일로 다른 소셜 계정 가입 시 `OAuthAccountNotLinked` 발생 - 보안 원칙 준수)
- **Google OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 사용. (하드코딩 없음)

## 4. Favorites 검증
- 복합키 `(lawdCd, dong, name)` 기준으로 완벽하게 upsert/delete 작동.
- **Pending Intent**: 비로그인 상태로 찜 클릭 시 `sessionStorage`에 10분 TTL 보존. 로그인 후 원래 상세 페이지 복귀 시 자동으로 찜 상태 동기화 및 DB 저장 완결.

## 5. Recent 검증
- 최대 저장 갯수 (Local 8개, Server 20개) 정책 완비.
- `useRecentSync` 훅으로 로그인 세션 전환 시 자동 병합 (서버 + 로컬 비교 후 최신 뷰 유지).

## 6. Preferences 검증
- 배열 `purposes` 값은 `BUY, SELL, JEONSE, MONTHLY_RENT, LEASE_OUT, INVEST, REDEVELOPMENT, BROWSE` 8가지 Enum으로 엄격히 제한.
- 중복 제거, 올바르지 않은 문자열 400 Bad Request 리턴.

## 7. Security Audit
- **Ownership Filter**: `findMany`, `delete`, `upsert` 등 모든 쿼리에 `where: { userId: session.user.id }` 포함. 타 사용자 데이터 침범 불가.
- **No Open Redirect**: NextAuth 내장 콜백 흐름 외 임의의 URL 리다이렉션 없음.
- **Secrets Management**: DB, NextAuth Secret, OAuth Secret 모두 환경변수 기반 처리 검증 완료.

## 8. Build & Tests
- `npx prisma validate`: **PASS**
- `npx prisma generate`: **PASS**
- `npx tsc --noEmit`: **PASS** (사전 존재한 `scripts/` 디렉토리 등의 에러 제외, 신규 Auth/MY 에러 **0**)
- `npm run lint`: **PASS** (사전 에러 외 없음)
- `npm run build`: **PASS** (Next.js 빌드 성공)

## 9. Mobile/Desktop UI
- 반응형 웹 구조 점검 완료 (360/375/390px, 데스크탑 모두 호환)
- 칩(`Chip`) 래핑(Wrapping) 문제 없음.

## 10. Remaining Production E2E
- Google Cloud Console에 프로덕션 Redirect URI 등록 필요.
- Vercel 프로덕션 환경에 환경변수 3종(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXTAUTH_URL`) 등록 완료 확인.
- 메인(main) 머지 후 프로덕션 배포 시, 실제 사용자가 카카오/네이버/Google 로그인 + 관심단지 지정 + 관심 목적 저장 E2E 테스트(MY-5B) 진행 예정.

## 11. Merge Readiness
- **SAFE TO MERGE MAIN: YES**
- 진행된 작업은 기존 시스템과 100% 호환되며, 회귀(Regression) 이슈를 유발할 구조적 변경이 없음.
