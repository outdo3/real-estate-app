import type { NextAuthOptions } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import KakaoProvider from 'next-auth/providers/kakao';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';
import { isAdminSessionUser } from '@/lib/admin-access';

interface NaverProfile {
  resultcode: string;
  message: string;
  response: {
    id: string;
    nickname?: string;
    name?: string;
    email?: string;
    profile_image?: string;
  };
}

// 네이버 로그인은 NextAuth에 내장된 공식 프로바이더가 없어(카카오만 내장 지원),
// OAuth2 authorization code flow를 표준 커스텀 프로바이더로 직접 정의한다.
function NaverProvider(): OAuthConfig<NaverProfile> {
  return {
    id: 'naver',
    name: 'Naver',
    type: 'oauth',
    authorization: {
      url: 'https://nid.naver.com/oauth2.0/authorize',
      params: { response_type: 'code' },
    },
    token: 'https://nid.naver.com/oauth2.0/token',
    userinfo: 'https://openapi.naver.com/v1/nid/me',
    clientId: process.env.NAVER_CLIENT_ID,
    clientSecret: process.env.NAVER_CLIENT_SECRET,
    checks: ['state'],
    profile(profile) {
      const account = profile.response;
      return {
        id: account.id,
        name: account.nickname || account.name || '네이버사용자',
        email: account.email ?? null,
        image: account.profile_image ?? null,
      };
    },
  };
}

const prismaAdapter = PrismaAdapter(prisma);

const customAdapter = {
  ...prismaAdapter,
  linkAccount: async (account: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { refresh_token_expires_in, ...safeAccount } = account;
    if (prismaAdapter.linkAccount) {
      return prismaAdapter.linkAccount(safeAccount as any);
    }
    return safeAccount;
  },
};

export const authOptions: NextAuthOptions = {
  adapter: customAdapter,
  providers: [
    KakaoProvider({
      clientId: process.env.KAKAO_CLIENT_ID || '',
      clientSecret: process.env.KAKAO_CLIENT_SECRET || '',
      authorization: {
        params: {
          lang: 'ko',
        },
      },
    }),
    NaverProvider(),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  session: {
    // DB에 세션 레코드를 남기지 않는 JWT 전략을 사용한다. 역할(role) 변경은
    // 다음 로그인/토큰 갱신 시점에 반영된다.
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.banned = (user as any).banned;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role as string;
        (session.user as any).banned = token.banned as boolean;
        // ADMIN_ACCESS_FIX_V1 — 관리자 여부를 **서버에서** 계산해 세션에 boolean 하나로만
        // 실어 보낸다. 클라이언트에는 ADMIN_EMAIL 값이나 허용 목록이 절대 나가지 않는다.
        // 화면(관리자 메뉴/페이지)은 이 값으로 UI를 결정하고, 실제 데이터 접근은 여전히
        // 서버의 requireAdmin()과 proxy 가드가 지킨다 — 클라이언트 값만으로 권한을 주지
        // 않는다. 세션 콜백은 매 요청 토큰에서 다시 계산되므로, ADMIN_EMAIL을 새로 설정하면
        // 재로그인 없이도 즉시 반영된다(JWT의 role과 달리).
        (session.user as any).isAdmin = isAdminSessionUser({
          role: token.role as string | undefined,
          email: (token.email as string | undefined) ?? session.user.email,
        });
      }
      return session;
    },
  },
  pages: {
    // 별도 로그인 페이지 없이 LoginModal에서 버튼 클릭 시 곧바로
    // signIn('kakao') / signIn('naver')를 호출해 각 서비스 로그인 화면으로 이동한다.
  },
};
