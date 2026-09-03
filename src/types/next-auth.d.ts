import { DefaultSession } from 'next-auth';

// role/id/banned은 우리 users 테이블에만 있는 커스텀 필드이므로, next-auth의
// 기본 타입에 병합해 세션/토큰 어디서든 타입 안전하게 쓸 수 있도록 확장한다.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'GUEST' | 'USER' | 'VERIFIED' | 'ADMIN';
      banned: boolean;
      // ADMIN_ACCESS_FIX_V1 — 서버에서 계산된 관리자 여부(role 승격 또는 ADMIN_EMAIL
      // 부트스트랩). UI 노출 판단에만 쓰고, 실제 권한은 서버가 다시 검증한다.
      isAdmin: boolean;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: 'GUEST' | 'USER' | 'VERIFIED' | 'ADMIN';
    banned?: boolean;
  }
}
