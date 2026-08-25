# AUTH/MY V1 — KAKAO OAUTH ACCOUNT PAYLOAD FIX

## 1. Root Cause
- **Issue**: `[next-auth][error][adapter_error_linkAccount]` 에러 발생. `Invalid prisma.account.create() invocation: Unknown argument refresh_token_expires_in`
- **Cause**: Kakao OAuth 인증 완료 후 NextAuth로 반환되는 토큰 응답에 Kakao 고유의 `refresh_token_expires_in` 필드가 포함됨. PrismaAdapter는 이 페이로드를 그대로 Prisma `Account` 모델에 생성 시도하나, 해당 필드가 스키마에 존재하지 않아 발생하는 오류.

## 2. Environment Details
- **NextAuth Version**: `^4.24.15`
- **Prisma Account Fields**: `id`, `userId`, `type`, `provider`, `providerAccountId`, `refresh_token`, `access_token`, `expires_at`, `token_type`, `scope`, `id_token`, `session_state`

## 3. Chosen Normalization Method
- NextAuth v4의 경우 Provider 옵션 내에서 `account()` 콜백을 통한 계정 응답 정규화(normalization)를 완벽하게 지원하지 않음.
- 따라서, 기존 `PrismaAdapter`의 `linkAccount` 메서드를 감싸서(Wrapping), Kakao 특화 지원되지 않는 필드(`refresh_token_expires_in`)만 삭제하고 원래의 `linkAccount` 로직에 넘겨주는 최소한의 어댑터 래퍼(Adapter Wrapper)를 구현.

## 4. Changed Files
- `src/lib/auth.ts`: `PrismaAdapter` 인스턴스를 커스텀 어댑터로 감싸 `linkAccount` 메서드에 필터링 로직 추가.

## 5. Implementation Details
- `account` 페이로드에서 `refresh_token_expires_in` 속성을 제외(rest parameter 사용)하고, 나머지 안전한 객체(`safeAccount`)를 `prismaAdapter.linkAccount`로 전달.
- 기존 필드 보존: `provider`, `type`, `providerAccountId`, `access_token`, `refresh_token` 등 Prisma가 허용하는 모든 필드는 그대로 보존됨.

## 6. Regression Check
- **Google**: 기존에 반환하던 필드가 스키마 규격과 맞았으므로, 알 수 없는 필드가 없다면 래퍼 함수에서 변경사항 없이 통과됨 (Regression 없음).
- **Naver**: 동일하게 규격에 맞는 필드만 통과됨 (Regression 없음).

## 7. Migration & Schema Changes
- **DB/Schema 변경**: 없음 (`prisma/schema.prisma` 유지)
- **Migration**: 필요 없음. 기존 상태 그대로 유지.

## 8. Remaining Manual QA
- 코드가 반영된 이후 프로덕션으로 배포하여 사용자가 직접 카카오(Kakao) 로그인 전체 E2E (계정 링킹 포함) 과정을 진행하여 실제 생성이 성공하는지 점검.
