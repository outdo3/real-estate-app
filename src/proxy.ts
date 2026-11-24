import { NextResponse, type NextRequest } from 'next/server';
import { isolatedQaResponse } from '@/lib/isolated-qa/responses';

export function proxy(request: NextRequest) {
  const response = isolatedQaResponse(request.method, new URL(request.url));
  if (response) return response;

  const next = NextResponse.next();
  next.headers.set('X-Robots-Tag', 'noindex, nofollow');
  next.headers.set('Permissions-Policy', 'geolocation=()');
  next.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://dapi.kakao.com https://*.daumcdn.net https://*.daum.net https://t1.kakaocdn.net",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.daumcdn.net https://*.kakaocdn.net https://*.kakao.com https://*.daum.net",
    "connect-src 'self' https://dapi.kakao.com https://*.daumcdn.net https://*.kakao.com https://*.daum.net",
    "form-action 'none'",
    "object-src 'none'",
    "worker-src 'none'",
  ].join('; '));
  return next;
}
