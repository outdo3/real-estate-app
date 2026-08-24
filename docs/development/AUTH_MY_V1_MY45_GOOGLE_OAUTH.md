# AUTH/MY V1 — MY-4.5: ADD GOOGLE OAUTH LOGIN

## 1. Baseline
- **Branch**: `feature/auth-my-v1`
- **HEAD**: `238eef8 feat(auth): add user preferences and my home`
- (이전 MY-4 작업이 완료된 직후 상태)

## 2. Existing Auth Structure
- **Framework**: NextAuth.js
- **Providers**: Kakao, Naver (커스텀 OAuth flow)
- **Session Strategy**: JWT (DB에 세션 레코드 남기지 않음)
- **Adapter**: PrismaAdapter
- **Login Modal**: `LoginModal.tsx`에서 클라이언트 사이드로 NextAuth `signIn()` 호출

## 3. Google Provider Implementation
- NextAuth의 공식 `GoogleProvider`를 `src/lib/auth.ts`에 추가.
- 카카오, 네이버에 이어 3번째 프로바이더로 순서 배치. (한국 사용자에게 더 익숙한 카카오/네이버 우선)

## 4. Environment Variables
Google OAuth 사용을 위해 다음 환경 변수가 필요합니다:
```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```
*주의: 실제 운영 환경의 Secret은 코드에 하드코딩되지 않으며, 배포 플랫폼(Vercel 등) 환경 변수 설정으로 관리해야 합니다.*

## 5. LoginModal
- `src/components/LoginModal.tsx`에 "Google로 계속하기" 버튼 추가.
- `src/components/LoginModal.module.css`에 `.googleBtn` 스타일 (Google의 공식 가이드에 가까운 흰색 배경 + 테두리) 적용.
- 외부 의존성(emoji 포함)을 줄이기 위해 인라인 SVG 형태로 구글 로고 삽입.
- 안내 문구를 "카카오 또는 네이버 계정으로..."에서 "소셜 계정으로..."로 일반화.

## 6. Callback Flow
- 기존 Kakao/Naver와 완전히 동일한 NextAuth.js `callbackUrl` 흐름 사용.
- 사용자가 보고 있던 원래 페이지(예: 아파트 상세 페이지)로 정상적으로 복귀 가능 (same-origin).

## 7. Favorite Pending Intent Compatibility
- MY-2에서 구현한 `sessionStorage` 기반의 관심단지 펜딩 인텐트는 로그인 제공자에 구애받지 않음.
- Google OAuth 리디렉션 후에도 동일하게 도메인으로 돌아오면 자동 저장(pending favorite resolve) 로직이 정상 작동함.

## 8. Recent Sync Compatibility
- 로그인 직후 수행되는 `useRecentSync` 훅은 인증 상태(`authenticated`)를 감지하므로, Google 로그인 사용자에게도 정상 작동.

## 9. Preferences Compatibility
- `GET/PUT /api/my/preferences`는 세션의 `user.id`에 기반하므로 Google 로그인 사용자도 Kakao/Naver 사용자와 동일하게 동작.

## 10. Account Linking Policy
- 동일 이메일 주소를 사용하는 계정들에 대해 강제 연결(`allowDangerousEmailAccountLinking: true`)을 수행하지 않음.
- 사용자가 동일 이메일의 다른 소셜 제공자로 로그인하려 할 때, NextAuth의 기본 보안 정책에 따라 `OAuthAccountNotLinked` 오류가 발생하도록 두어 보안을 우선시함.

## 11. OAuth Error Handling
- 소셜 로그인 취소 또는 오류 발생 시(예: Account linking 거부 등), NextAuth의 기본 오류 처리 방식을 따르며 앱 크래시 방지. 사용자는 다시 시도할 수 있음.

## 12. Google Console Setup Requirements
Google Cloud Console 설정 가이드:
1. **OAuth Client Type**: Web application
2. **Authorized JavaScript origins**: 
   - `http://localhost:3000` (개발 환경)
   - `https://your-production-domain.com` (운영 환경)
3. **Authorized redirect URIs**: 
   - `http://localhost:3000/api/auth/callback/google`
   - `https://your-production-domain.com/api/auth/callback/google`

## 13. Tests & Validation
- 타입 체크 (`tsc --noEmit`), 린트 (`npm run lint`), 빌드 (`npm run build`) 통과 확인 (AUTH/MY 신규 이슈 없음).
- DB Schema나 기존 마이그레이션 파일 변경 없이 적용됨.

## 14. Production Data Safety
- 프로덕션 DB에 테스트 목적으로 Google 계정 관련 데이터를 쓰지 않음.
- 실 사용 환경에서의 테스트는 최종 통합 QA(MY-5)에서 수행 예정.

## 15. Limitations & QA Requirements (MY-5)
- 환경 변수 미설정으로 인해 이 단계에서 Google 로그인 E2E 테스트는 불가능. 
- MY-5(최종 QA) 단계 전 Vercel (Preview/Production) 환경 및 개발 로컬에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 등록 필수.
