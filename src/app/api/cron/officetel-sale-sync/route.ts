import { handleOfficetelCron } from '@/lib/officetel/sync/cron-handler';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// OFFICETEL_INCREMENTAL_SYNC_V1 — 인증 · 기본 dry-run · 응답 규칙은 cron-handler.ts. vercel.json에는 아직 등록하지 않았다.
export async function GET(request: Request) {
  return handleOfficetelCron(request, 'sale-sync');
}
