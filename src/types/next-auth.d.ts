import { DefaultSession } from 'next-auth';

// role/id/banned은 우리 users 테이블에만 있는 커스텀 필드이므로, next-auth의
// 기본 타입에 병합해 세션/토큰 어디서든 타입 안전하게 쓸 수 있도록 확장한다.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'GUEST' | 'USER' | 'VERIFIED' | 'ADMIN';
      banned: boolean;
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
