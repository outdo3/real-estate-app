// SELLFLOW_DATA_API_V1.3 — GET /api/integrations/sellflow/v1/areas/{lawdCd}/context (시군구별 재개발·분양 컨텍스트). 읽기 전용, 같은 서버 간 인증.
import { runSellflowRoute } from '@/lib/integrations/sellflow/route-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ lawdCd: string }> }) {
  const { lawdCd } = await params;
  return runSellflowRoute(request, { kind: 'areaContext', lawdCd });
}
