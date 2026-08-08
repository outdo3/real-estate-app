import { PrismaClient } from '@prisma/client';

// Next.js 개발 모드의 핫 리로드마다 새 PrismaClient를 만들면 커넥션이 계속 쌓이므로,
// 전역에 싱글턴으로 캐싱해 재사용한다 (Prisma 공식 권장 패턴).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
