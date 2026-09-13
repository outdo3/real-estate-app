import type { NextConfig } from "next";
import { buildCanonicalHostRedirects } from "./src/config/canonical-host";

const nextConfig: NextConfig = {
  // E-JIP CANONICAL HOST REDIRECT V1 — 기본 Vercel 호스트로 들어오면 경로·쿼리를 유지한 채
  // https://e-jip.com 으로 308. 로그인이 vercel.app에서 시작돼 state 쿠키가 콜백 호스트에
  // 없던 OAuthCallback 실패를 진입 단계에서 없앤다(src/config/canonical-host.ts).
  // 정확한 호스트만 대상(프리뷰 제외), /api/cron 제외. 인증 설정은 변경하지 않는다.
  async redirects() {
    return buildCanonicalHostRedirects();
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // 개발 환경에서 localhost DNS 해석이 안 되는 경우(사내망/VPN 등) 127.0.0.1로 접속해도
  // 정적 청크 요청이 cross-origin으로 차단되지 않도록 허용한다. 프로덕션 빌드에는 영향 없음.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
