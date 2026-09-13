// E-JIP FINAL DEVICE UX FIX V1 — 로그인 버튼 재진입(중복 탭) 방지.
//
// 실기기 재현: 로그인 → "Try signing in with a different account." 배너가 먼저 보임 → 그
// 화면에서 Kakao를 한 번 더 누르면 정상 로그인.
//
// 코드/URL 흐름으로 확인한 사실:
//  - 이 배너는 우리 화면이 아니라 NextAuth 기본 페이지 `/api/auth/signin?error=OAuthCallback`
//    (또는 OAuthSignin/Callback 등)이 그린다. LoginModal에는 에러 상태가 없고 앱 어디에서도
//    error 파라미터를 들고 다니지 않는다 — "지난 실패가 남은 배너"가 아니라 **방금 콜백이 실패**했다.
//  - 콜백은 `next-auth.state` 쿠키와 URL의 state를 비교한다(Kakao는 기본 checks=['state']).
//    브라우저에는 state 쿠키가 **하나만** 남는다. 프로덕션 실측: signin POST를 두 번 보내면 state가
//    매번 새로 발급돼 쿠키가 덮이고, 첫 번째 URL의 state로 콜백하면 `error=OAuthCallback` →
//    바로 그 배너 페이지로 간다.
//  - next-auth/react의 signIn()은 이동 전에 providers → csrf → signin POST 세 번을 순서대로
//    왕복한다. 그 사이 모달 버튼은 아무 반응이 없어 모바일에서 다시 누르기 쉽다.
//
// 그래서 한 번 누르면 이동이 끝날 때까지 모든 로그인 버튼을 잠근다. 인증 설정(쿠키/SameSite/
// checks/프로바이더)은 건드리지 않는다. 앱 전환 중 state 쿠키 자체가 사라지는 경로(Naver 모바일
// 이슈와 같은 부류)는 이 수정으로 해결되지 않으며 별도 승인 대상이다.

export type SocialProviderId = 'kakao' | 'naver' | 'google';

export interface SignInAttemptGuard {
  pending: SocialProviderId | null;
}

export function createSignInAttemptGuard(): SignInAttemptGuard {
  return { pending: null };
}

export type SignInStartResult = 'started' | 'ignored' | 'failed';

/**
 * 진행 중인 로그인이 있으면 새로 시작하지 않는다(state 쿠키를 덮지 않게).
 *
 * guard는 동기적으로 잠근다 — React state는 다음 렌더에야 반영되므로 같은 프레임의 두 번째
 * 탭을 막지 못한다. 시작 자체가 실패하면(네트워크 등) 잠금을 풀어 다시 누를 수 있게 한다.
 * 정상적으로 이동하면 페이지가 떠나므로 잠금을 풀 필요가 없다.
 */
export async function startProviderSignIn(
  guard: SignInAttemptGuard,
  provider: SocialProviderId,
  run: () => Promise<unknown>,
  onPendingChange: (pending: SocialProviderId | null) => void
): Promise<SignInStartResult> {
  if (guard.pending) return 'ignored';
  guard.pending = provider;
  onPendingChange(provider);
  try {
    await run();
    return 'started';
  } catch {
    guard.pending = null;
    onPendingChange(null);
    return 'failed';
  }
}

/**
 * 프로바이더 화면에서 뒤로가기로 돌아오면 브라우저가 bfcache로 페이지를 그대로 복원한다 —
 * 잠긴 버튼까지 복원되면 다시 로그인할 수 없다. 복원(persisted)일 때만 잠금을 푼다.
 */
export function releaseSignInAttemptOnPageShow(
  guard: SignInAttemptGuard,
  event: { persisted: boolean },
  onPendingChange: (pending: SocialProviderId | null) => void
): boolean {
  if (!event.persisted || !guard.pending) return false;
  guard.pending = null;
  onPendingChange(null);
  return true;
}

export const SIGN_IN_PENDING_LABEL: Record<SocialProviderId, string> = {
  kakao: '카카오로 이동 중…',
  naver: '네이버로 이동 중…',
  google: 'Google로 이동 중…',
};
