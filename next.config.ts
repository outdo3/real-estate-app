import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // 개발 환경에서 localhost DNS 해석이 안 되는 경우(사내망/VPN 등) 127.0.0.1로 접속해도
  // 정적 청크 요청이 cross-origin으로 차단되지 않도록 허용한다. 프로덕션 빌드에는 영향 없음.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
