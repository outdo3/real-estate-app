import { PrismaClient } from '@prisma/client';

// Next.js 개발 모드의 핫 리로드마다 새 PrismaClient를 만들면 커넥션이 계속 쌓이므로,
// 전역에 싱글턴으로 캐싱해 재사용한다 (Prisma 공식 권장 패턴).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// PERFORMANCE_V1.2 — 여러 DB 쿼리를 Promise.all로 "동시에" 쏘아도, 각 쿼리가
// 아직 커넥션 풀에 워밍업된 연결이 없으면 각자 별도로 새 연결을 맺어야 해서
// (원격 Supabase pooler까지 TCP+TLS 핸드셰이크) 진짜 병렬 실행의 이득이 없어진다
// — 실측: 부산 dashboard의 sale/rent-rows/rent-agg 3개 쿼리가 콜드 상태에서
// 1,414~1,415ms(사실상 순차 실행과 동일), 3-connection 워밍업 후 같은 3개 쿼리가
// 879ms(진짜 병렬)로 줄었다. 데이터를 바꾸지 않는 `SELECT 1`을 요청 시작 시점에
// 미리 몇 개 쏴서 풀에 연결을 미리 확보해둔다 — 실패해도 무시(워밍업 실패가
// 본 요청을 막으면 안 됨).
export function warmupConnections(n: number): Promise<void> {
  return Promise.all(
    Array.from({ length: n }, () => prisma.$queryRaw`SELECT 1`.catch(() => undefined))
  ).then(() => undefined);
}
