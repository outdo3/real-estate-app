/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §6 — 수정 후 실측(READ ONLY).
 * 라우트 핸들러를 직접 호출해 cold/warm 응답시간과 응답 필드를 기록한다.
 */
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
config({ path: '.env.local', quiet: true });

async function main() {
  const { GET } = await import('../src/app/api/stats/feed/route');
  const { prisma } = await import('../src/lib/prisma');

  const call = async (qs: string) => {
    const t = Date.now();
    const res = await GET(new Request(`http://localhost:3000/api/stats/feed?${qs}`));
    const body: any = await res.json();
    const ms = Date.now() - t;
    return { ms, status: res.status, body };
  };

  const cases = [
    'sidoCode=26&period=12m&offset=0&limit=50',
    'sidoCode=26&period=12m&offset=0&limit=50',
    'sidoCode=26&period=7d&offset=0&limit=50',
    'sidoCode=26&period=7d&offset=0&limit=50',
    'sidoCode=26&period=30d&offset=0&limit=50',
    'lawdCd=26140&period=7d&offset=0&limit=50',
    'lawdCd=26140&period=7d&offset=0&limit=50',
  ];
  for (const qs of cases) {
    const r = await call(qs);
    const s = r.body.summary || {};
    console.log(
      `${String(r.ms).padStart(6)}ms  HTTP ${r.status}  ${qs.replace('&offset=0&limit=50', '')}\n` +
      `          status=${r.body.status} total=${r.body.pagination?.total} verified=${s.verifiedCount} canceled=${s.cancelledCount} ` +
      `recordHigh=${s.recordHighCount} rise=${s.riseCount} fall=${s.fallCount} apiError=${r.body.apiError} partial=${r.body.partial} failed=${(r.body.failedDistricts || []).length} groups=${(r.body.groups || []).length}`
    );
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
