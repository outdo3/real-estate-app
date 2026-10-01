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
  if (request.nextUrl.pathname.startsWith('/b/')) return briefingGate(request);

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

// REALTOR_PRO_POLICY_HARDENING_V1 — 취소·만료된 고객 브리핑 링크(/b/<token>)는 410 Gone.
// 페이지는 상태 코드를 410으로 정할 수 없어 여기서 먼저 판정한다(src/lib/pro/briefing-gone.ts). 410이 아니면
// 기존 페이지가 그대로 처리한다(404·200·정지 안내). 판정 오류는 막지 않고 페이지로 넘긴다 — 페이지가 같은
// 판정을 다시 하므로 취소·만료 내용은 어느 경로로도 노출되지 않는다. 조회수는 여기서 세지 않는다.
async function briefingGate(request: NextRequest) {
  try {
    const { briefingTokenFromPath, briefingHttpStatus, briefingGoneResponse } = await import('@/lib/pro/briefing-gone');
    const token = briefingTokenFromPath(request.nextUrl.pathname);
    if (!token) return NextResponse.next();
    const { getProDeps, getProMode } = await import('@/lib/pro/runtime');
    const mode = getProMode();
    if (mode === 'OFF') return NextResponse.next();
    const { viewBriefingByToken } = await import('@/lib/pro/briefing-service');
    const { access } = await viewBriefingByToken(await getProDeps(mode), token, { countView: false });
    if (briefingHttpStatus(access) === 410) return briefingGoneResponse({ dev: process.env.NODE_ENV !== 'production' });
  } catch {
    // 저장소 오류 등 — 페이지의 기존 처리(안내 화면)에 맡긴다
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/b/:token'],
};
