// SELLFLOW_DATA_API_V1 — GET /api/integrations/sellflow/v1/buildings/search
// 서버 간 읽기 전용. 인증·검증·응답 규격은 src/lib/integrations/sellflow/handler.ts, 계약은 docs/development/SELLFLOW_DATA_API_V1.md.
import { runSellflowRoute } from '@/lib/integrations/sellflow/route-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return runSellflowRoute(request, { kind: 'search' });
}
