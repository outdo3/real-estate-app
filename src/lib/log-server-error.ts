import { Prisma } from '@prisma/client';
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

// connection string이 에러 메시지에 우연히 포함되는 경우(예: Prisma init 오류 메시지)를 대비한
// 방어적 마스킹 — INFRA I1에서 확인된 "비밀값 절대 기록 금지" 원칙 때문에 로그 저장 직전에 둔다.
function redactConnectionStrings(text: string): string {
  return text.replace(/postgres(ql)?:\/\/\S+/gi, '[redacted-connection-string]');
}

// Prisma 예외 종류를 최소 정보로 분류한다. connection 오류(PrismaClientInitializationError)와
// query 오류(PrismaClientKnownRequestError, code 예: P2024=timeout)를 구분하는 게 목적이지,
// 모든 Prisma error code를 분류하는 프레임워크를 만드는 게 목적이 아니다(INFRA I2-A 범위).
function classifyError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `PrismaClientKnownRequestError:${error.code}`;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return `PrismaClientInitializationError${error.errorCode ? `:${error.errorCode}` : ''}`;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return 'PrismaClientRustPanicError';
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return 'PrismaClientUnknownRequestError';
  }
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  return 'UnknownError';
}

// API route catch 블록에서 logServerError(message, url, stack)의 message 인자로 바로 쓸 수 있는
// 최소 진단 문자열을 만든다. `method`는 호출부가 문자열 상수로 넘긴다(요청 method 자체가 아니라
// route 식별용) — 이 route들이 전부 GET 전용이라 request.method를 다시 파싱하지 않는다.
export function buildErrorLogMessage(method: string, error: unknown): string {
  const kind = classifyError(error);
  const rawMessage = error instanceof Error ? error.message : String(error);
  return redactConnectionStrings(`[${method}][${kind}] ${rawMessage}`);
}
