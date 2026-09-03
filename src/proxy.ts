import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isAdminSessionUser } from '@/lib/admin-access';

// /admin 하위 모든 경로(현재/향후 페이지 전부)를 한 곳에서 막는다 — 페이지마다 개별
// role 체크를 반복하면 새 관리자 페이지를 추가할 때 깜빡하고 가드를 빠뜨릴 위험이 있다.
// Next.js 16부터 이 파일 컨벤션의 이름이 middleware → proxy로 바뀌었다(파일명 proxy.ts,
// export도 proxy) — node_modules/next/dist/docs 마이그레이션 가이드 기준.
//
// ADMIN_ACCESS_FIX_V1:
//  - 판정을 복제하지 않고 src/lib/admin-access.ts의 단일 함수를 쓴다(requireAdmin()과
//    admin 페이지가 전부 같은 기준을 쓰도록).
//  - 실패 사유를 두 가지로 나눈다. 이전에는 전부 홈으로 보내서, 운영자가 "로그인이
//    필요한 건지, 권한이 없는 건지, 페이지가 없는 건지" 구분할 수 없었다.
//      · 미로그인      → /my (AuthGate가 붙어 있어 로그인 모달이 자동으로 열린다.
//                        새 UI를 만들지 않고 기존 로그인 유도 경로를 그대로 재사용)
//      · 로그인+비관리자 → / (기존 동작 유지 — 관리자 경로의 존재 자체를 드러내지 않는다)
//    즉 관리자 경로 비노출 정책은 그대로 두고, 자기 인증 상태만 알려준다(사용자가 이미
//    아는 정보라 새로 새는 정보가 없다).
export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.redirect(new URL('/my', request.url));
  }

  const isAdmin = isAdminSessionUser({
    role: (token as { role?: string }).role,
    email: token.email,
  });

  if (!isAdmin) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
