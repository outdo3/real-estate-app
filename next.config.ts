import type { NextConfig } from "next";
import { buildCanonicalHostRedirects } from "./src/config/canonical-host";
import { privateAppHeaders, privateBriefingHeaders } from "./src/lib/privacy/private-routes";

const nextConfig: NextConfig = {
  // E-JIP CANONICAL HOST REDIRECT V1 — 기본 Vercel 호스트로 들어오면 경로·쿼리를 유지한 채
  // https://e-jip.com 으로 308. 로그인이 vercel.app에서 시작돼 state 쿠키가 콜백 호스트에
  // 없던 OAuthCallback 실패를 진입 단계에서 없앤다(src/config/canonical-host.ts).
  // 정확한 호스트만 대상(프리뷰 제외), /api/cron 제외. 인증 설정은 변경하지 않는다.
  async redirects() {
    return buildCanonicalHostRedirects();
  },
  // REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 — 고객 브리핑(/b/<token>)은 URL이 곧 열람 권한이다.
  // CSP로 외부 스크립트·연결을 막고(로더가 코드 회귀로 다시 실려도 브라우저가 거부), 리퍼러·색인을 끈다.
  // 판정·헤더 값은 src/lib/privacy/private-routes.ts 한 곳에서 만든다.
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    const value = privateBriefingHeaders({ dev });
    // REALTOR_PRO_PRIVATE_APP_ISOLATION_V1 — 중개사 Pro: 외부 스크립트·연결 차단 CSP · no-referrer · noindex · frame 차단.
    const pro = privateAppHeaders({ dev });
    return [
      { source: '/b', headers: value },
      { source: '/b/:path*', headers: value },
      { source: '/pro', headers: pro },
      { source: '/pro/:path*', headers: pro },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 개발 환경에서 localhost DNS 해석이 안 되는 경우(사내망/VPN 등) 127.0.0.1로 접속해도
  // 정적 청크 요청이 cross-origin으로 차단되지 않도록 허용한다. 프로덕션 빌드에는 영향 없음.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
