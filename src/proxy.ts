import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// /admin 하위 모든 경로(현재/향후 페이지 전부)를 한 곳에서 막는다 — 페이지마다 개별
// role 체크를 반복하면 새 관리자 페이지를 추가할 때 깜빡하고 가드를 빠뜨릴 위험이
// 있다. role==='ADMIN'이 아니어도 ADMIN_EMAIL 환경변수와 로그인 이메일이 일치하면
// 통과시킨다 — requireAdmin()(서버 API 가드)과 동일한 기준을 유지하기 위함.
// Next.js 16부터 이 파일 컨벤션의 이름이 middleware → proxy로 바뀌었다(파일명 proxy.ts,
// export도 proxy) — node_modules/next/dist/docs 마이그레이션 가이드 기준.
export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  const role = (token as any)?.role as string | undefined;
  const email = (token?.email as string | undefined) || undefined;
  const adminEmail = process.env.ADMIN_EMAIL;
  const isAdmin = role === 'ADMIN' || (!!adminEmail && !!email && email.toLowerCase() === adminEmail.toLowerCase());

  if (!isAdmin) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
