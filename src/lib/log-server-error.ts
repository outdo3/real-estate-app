import { prisma } from '@/lib/prisma';

// API route의 catch 블록에서 재사용하는 서버 에러 로깅 헬퍼.
export async function logServerError(message: string, url?: string, stack?: string) {
  try {
    await prisma.errorLog.create({
      data: { source: 'server', message: message.slice(0, 2000), stack: stack?.slice(0, 5000) ?? null, url: url ?? null },
    });
  } catch (e) {
    console.warn('logServerError failed', e);
  }
}
