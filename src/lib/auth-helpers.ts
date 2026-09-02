import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// API 라우트에서 로그인 세션과 권한을 서버 사이드에서 확인하기 위한 공용 헬퍼.
// 클라이언트에서 role을 확인해 UI를 숨기는 것만으로는 우회 가능하므로,
// 쓰기/삭제/관리 API는 반드시 이 헬퍼로 서버에서 다시 검증한다.
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return { error: '로그인이 필요합니다.' as const, status: 401 as const, user: null };
  if (user.banned) return { error: '커뮤니티 이용이 제한된 계정입니다.' as const, status: 403 as const, user: null };
  return { error: null, status: 200 as const, user };
}

// role이 아직 DB에서 ADMIN으로 승격되지 않은 상태에서도(예: 최초 관리자 부트스트랩)
// 환경변수 ADMIN_EMAIL과 로그인 이메일이 일치하면 관리자로 취급한다 — role 컬럼 하나만
// 신뢰 소스로 두면 배포 초기에 "아무도 ADMIN이 아니라 아무도 admin 화면에 못 들어가는"
// 상황이 생긴다.
function isAdminByEnvEmail(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  return !!adminEmail && !!email && email.toLowerCase() === adminEmail.toLowerCase();
}

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 — requireAdmin()과 동일한 판정을
// analytics 트래픽 제외 로직(src/lib/analytics/traffic-classification.ts)에서도
// 그대로 재사용한다. 판정 로직을 두 곳에 따로 두면 나중에 한쪽만 바뀌어
// admin 판정이 갈리는 위험이 있다.
export function isAdminSessionUser(user: { role?: string | null; email?: string | null } | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'ADMIN' || isAdminByEnvEmail(user.email);
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: '로그인이 필요합니다.' as const, status: 401 as const, user: null };
  if (!isAdminSessionUser(user as any)) return { error: '관리자만 사용할 수 있습니다.' as const, status: 403 as const, user: null };
  return { error: null, status: 200 as const, user };
}
