// SELLFLOW_DATA_API_V1 — route 파일이 공유하는 의존성 연결(환경변수 · Prisma · 로그). 값 자체는 로그/응답에 싣지 않는다.
import { handleSellflowRequest, type SellflowHandlerDeps, type SellflowRoute } from './handler';
import { prismaSellflowDb } from './prisma-db';
import { prismaSellflowContextDb } from './prisma-context-db';

function buildDeps(): SellflowHandlerDeps {
  return {
    // 환경변수는 요청마다 읽는다(값 변경이 재시작 없이 반영되고, 빌드 타임에 굳지 않는다).
    auth: {
      apiKey: process.env.SELLFLOW_DATA_API_KEY,
      enabled: process.env.SELLFLOW_DATA_API_ENABLED,
      propertyTypes: process.env.SELLFLOW_DATA_API_PROPERTY_TYPES,
    },
    db: prismaSellflowDb,
    ctxDb: prismaSellflowContextDb,
    now: () => new Date(),
    newRequestId: () => crypto.randomUUID(),
    log: (entry) => console.log(JSON.stringify(entry)),
    onUnexpectedError: (errorName) => console.error(JSON.stringify({ evt: 'sellflow_api_error', errorName })),
  };
}

/** `extra` lets a route add what only it needs (the building-context route adds the attendance-zone lookup, so only that function carries the 5.7MB artifact). */
export function runSellflowRoute(request: Request, route: SellflowRoute, extra: Partial<SellflowHandlerDeps> = {}): Promise<Response> {
  return handleSellflowRequest(request, route, { ...buildDeps(), ...extra });
}
