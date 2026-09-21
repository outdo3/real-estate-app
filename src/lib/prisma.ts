import { PrismaClient } from '@prisma/client';
import { assertTestWriteAllowed, resolveTestDbPolicy } from '@/lib/test-db-guard';

// Next.js 개발 모드의 핫 리로드마다 새 PrismaClient를 만들면 커넥션이 계속 쌓이므로,
// 전역에 싱글턴으로 캐싱해 재사용한다 (Prisma 공식 권장 패턴).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// TEST_DATABASE_SAFETY_GUARD_V1 §8 — 테스트에서 TEST_DATABASE_URL이 있으면 그것을 쓴다.
// 운영 런타임은 이 분기에 들어오지 않으므로 동작이 바뀌지 않는다.
const policy = resolveTestDbPolicy(process.env as Record<string, string | undefined>, process.execArgv);
const testUrl = policy.testSignal && process.env.TEST_DATABASE_URL ? process.env.TEST_DATABASE_URL : null;

function createClient(): PrismaClient {
  const client = testUrl
    ? new PrismaClient({ datasources: { db: { url: testUrl } } })
    : new PrismaClient();

  // §7/§9 — 테스트 러너일 때만 쓰기 차단 미들웨어를 단다. 운영 런타임에는 붙지 않으므로
  // 요청 경로에 오버헤드도, 동작 변화도 없다. 읽기는 통과시킨다(의도된 read-only 통합 테스트 보호).
  if (policy.testSignal) {
    client.$use(async (params, next) => {
      assertTestWriteAllowed(params.action, params.model);
      return next(params);
    });
  }
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

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
