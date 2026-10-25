// SELLFLOW_DATA_API_V1 — GET /api/integrations/sellflow/v1/buildings/{masterId}/transactions
import { runSellflowRoute } from '@/lib/integrations/sellflow/route-deps';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ masterId: string }> }) {
  const { masterId } = await params;
  return runSellflowRoute(request, { kind: 'transactions', masterId });
}
