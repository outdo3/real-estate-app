import { prisma } from '@/lib/prisma';
import { assertTestWriteAllowed } from '@/lib/test-db-guard';

// TEST_DATABASE_SAFETY_GUARD_V1 §9 — 마스킹·예외 분류는 순수 모듈로 옮겼다(log-redaction.ts).
// 이 파일은 **DB 쓰기**만 담당한다. 기존 import 경로가 깨지지 않도록 그대로 re-export한다.
export { redactSensitive, buildErrorLogMessage } from '@/lib/log-redaction';

// API route의 catch 블록에서 재사용하는 서버 에러 로깅 헬퍼.
export async function logServerError(message: string, url?: string, stack?: string) {
  try {
    // §9 — 이 헬퍼가 사고의 실제 경로였다(테스트가 운영 error_logs에 씀).
    // prisma 미들웨어와 별개로 여기서도 한 번 막는다(2중 보호).
    assertTestWriteAllowed('create', 'ErrorLog');
    await prisma.errorLog.create({
      data: { source: 'server', message: message.slice(0, 2000), stack: stack?.slice(0, 5000) ?? null, url: url ?? null },
    });
  } catch (e) {
    console.warn('logServerError failed', e);
  }
}
