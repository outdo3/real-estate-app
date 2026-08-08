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

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: '로그인이 필요합니다.' as const, status: 401 as const, user: null };
  if (user.role !== 'ADMIN') return { error: '관리자만 사용할 수 있습니다.' as const, status: 403 as const, user: null };
  return { error: null, status: 200 as const, user };
}
