import type { NextAuthOptions } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import KakaoProvider from 'next-auth/providers/kakao';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';

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
      }
      return session;
    },
  },
  pages: {
    // 별도 로그인 페이지 없이 LoginModal에서 버튼 클릭 시 곧바로
    // signIn('kakao') / signIn('naver')를 호출해 각 서비스 로그인 화면으로 이동한다.
  },
};
