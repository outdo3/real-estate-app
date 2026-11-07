// SELLFLOW_DATA_API_V1.3 — GET /api/integrations/sellflow/v1/buildings/{masterId}/context (단지 속성 + 공식 통학구역). 읽기 전용, 같은 서버 간 인증.
import { runSellflowRoute } from '@/lib/integrations/sellflow/route-deps';
import { getApartmentEducationZone } from '@/lib/education/attendance-zone';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ masterId: string }> }) {
  const { masterId } = await params;
  return runSellflowRoute(request, { kind: 'buildingContext', masterId }, { educationZone: getApartmentEducationZone });
}
