# AUTH/KAKAO — LOGIN LANGUAGE UX CHECK

## 1. Current Kakao Provider
- **File**: `src/lib/auth.ts`
- **Setup**: `KakaoProvider({ clientId, clientSecret })` 형태로 NextAuth의 기본 카카오 프로바이더를 사용 중이었습니다.

## 2. Current Authorization Params
- **Default Params**: 기존 설정에는 별도의 커스텀 `authorization.params`가 지정되어 있지 않아, 브라우저 환경이나 사용자의 디바이스 Locale에 따라 언어가 자동으로 결정되었습니다.

## 3. Language Support
- **OAuth Param (`lang`)**: 카카오 로그인 인가 코드 발급 API(`kauth.kakao.com/oauth/authorize`)는 `lang` 파라미터를 공식 지원합니다 (`ko`, `en` 등). 이를 통해 사용자 로그인 및 동의 화면의 언어를 한국어로 강제할 수 있습니다.

## 4. Applied Change
- `src/lib/auth.ts`의 `KakaoProvider` 설정에 `authorization: { params: { lang: 'ko' } }`를 추가 적용했습니다. 이로써 해외 IP나 외국어 설정 브라우저에서 접근하더라도 카카오 로그인 웹 화면이 한국어로 표시됩니다.

## 5. Kakao 2FA Message Control
- **2FA Message Language**: 사용자가 겪은 카카오톡 2단계 인증 알림 메시지("Confirm 2-Step Verification for Kakao Account")는 웹 화면 언어와는 별개로 동작하는 보안 시스템 알림입니다.
- **Control**: `NOT_SUPPORTED` / `UNVERIFIED`. 카카오 공식 OAuth API에서는 개발자가 파라미터(예: `lang`)를 통해 **2단계 인증 메시지**의 언어를 직접 제어하는 기능을 제공하지 않습니다. (주로 사용자의 계정 설정이나 카카오톡 앱 언어를 따릅니다.)

## 6. Login UX Notice
- 2단계 인증 메시지를 영어로 수신할 경우 발생할 수 있는 피싱 의심 및 불안감을 줄이기 위해 로그인 UI 내에 짧은 헬퍼 텍스트(Notice)를 추가했습니다.

## 7. Applied UX Notice
- **File**: `src/components/LoginModal.tsx`, `src/components/LoginModal.module.css`
- **Location**: 카카오 로그인 버튼 바로 아래
- **Copy**: "카카오 2단계 인증을 사용 중인 경우 카카오톡에서 로그인 확인 메시지가 전송될 수 있습니다."
- **Styling**: `kakaoNotice` 클래스를 통해 시각적 부담을 최소화한 Secondary 텍스트 형태로 적용했습니다.

## 8. Regression
- **Google / Naver Impact**: None. 설정이 분리되어 있고 공통 영역에 영향을 주지 않았습니다.
- **Callback / Prisma Adapter**: 기존 커스텀 `linkAccount` 로직 및 Callback 로직은 전혀 수정하지 않아 기존 로그인 안정성이 유지됩니다.

## 9. Build & Verification
- `npm run build`를 성공적으로 통과했으며, TypeScript / Lint 에러가 없음을 확인했습니다.

## 10. Next Recommendation
- 개발 측면에서 적용 가능한 모든 조치(웹 UI 언어 고정, 사전 UX 안내 문구)를 적용했습니다. 향후 특정 사용자가 계속 영어 2FA 메시지를 받는다면 카카오 계정 내 언어 설정 변경을 안내하는 FAQ를 추가하는 것을 권장합니다.
