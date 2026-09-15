/**
 * COMMUNITY_IMAGE_ORPHAN_CLEANUP_V1 — PHASE 1 Production DRY-RUN 감사.
 *
 * community-images bucket을 **목록 조회만** 하고, PostImage.path를 **읽기만** 해서 분류를 출력한다.
 * 삭제·업로드·DB 쓰기 경로가 없다. `--apply`는 PHASE 2 승인 전까지 이 스크립트에서 거부된다.
 * 키·토큰 값은 출력하지 않는다(키 종류와 HTTP status만). 경로는 기본적으로 출력하지 않고, --verbose일 때도 redact.
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/community/audit-image-orphans.ts [--verbose] [--min-age-hours=24]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';
import { COMMUNITY_IMAGE_BUCKET } from '../../src/lib/community/image-rules';
import {
  APPLY_MAX_DELETE_PER_RUN,
  APPLY_STOP_BYTES,
  APPLY_STOP_OBJECT_COUNT,
  createReadOnlyImageStorageProbe,
  describeSupabaseKeyRole,
  findCommunityImageOrphans,
  formatBytes,
  parseOrphanCliArgs,
  planOrphanCleanup,
  redactImagePath,
  type ClassifiedObject,
} from '../../src/lib/community/image-orphan-audit';

/** PHASE 1: 이 스크립트에는 삭제 모드가 없다. PHASE 2 승인 후 별도 변경으로만 바뀐다. */
const APPLY_ENABLED = false;

const prisma = new PrismaClient();

const hours = (h: number | null) => (h == null ? '-' : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

function printSamples(label: string, rows: ClassifiedObject[], verbose: boolean) {
  if (!verbose || rows.length === 0) return;
  console.log(`\n  ${label} (redacted, max 20):`);
  for (const r of rows.slice(0, 20)) {
    console.log(`    ${redactImagePath(r.path)}  age=${hours(r.ageHours)}  size=${r.size ?? '-'}  mime=${r.mimeType ?? '-'}${r.reviewReason ? `  reason=${r.reviewReason}` : ''}`);
  }
}

async function main() {
  const parsed = parseOrphanCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 2;
    return;
  }
  const { args } = parsed;
  if (args.mode === 'apply' && !APPLY_ENABLED) {
    console.error('REFUSED: --apply is disabled in PHASE 1 (Production delete requires explicit Phase 2 approval). Nothing was deleted.');
    process.exitCode = 2;
    return;
  }

  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-image-orphans');

  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  // 앱은 SUPABASE_SERVICE_ROLE_KEY만 읽는다. 로컬 운영 스크립트는 기존 verify 스크립트와 같이 옛 이름을 보조로 허용하되,
  // 키 종류가 service role/secret이 아니면 중단한다(anon 키의 빈 목록을 "객체 0"으로 오판하지 않기 위해).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
  const keyRole = describeSupabaseKeyRole(key);
  if (!url || (keyRole !== 'service_role' && keyRole !== 'secret')) {
    console.error(`BLOCKED: Storage audit needs SUPABASE_URL and a service-role key (key kind=${keyRole}).`);
    process.exitCode = 1;
    return;
  }

  const probe = createReadOnlyImageStorageProbe({ url, serviceRoleKey: key }, fetch);

  const result = await findCommunityImageOrphans(
    { minAgeHours: args.minAgeHours },
    {
      listStorageObjects: () => probe.listAllObjects(),
      listReferencedPaths: async () => {
        const out: string[] = [];
        let cursor: string | undefined;
        for (;;) {
          const rows = await prisma.postImage.findMany({
            select: { id: true, path: true },
            orderBy: { id: 'asc' },
            take: 1000,
            ...(cursor && { cursor: { id: cursor }, skip: 1 }),
          });
          out.push(...rows.map((r) => r.path));
          if (rows.length < 1000) break;
          cursor = rows[rows.length - 1].id;
        }
        return out;
      },
      existingUserIds: async (ids) => {
        const rows = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
        return new Set(rows.map((r) => r.id));
      },
      objectExists: (p) => probe.exists(p),
      now: () => Date.now(),
    }
  );

  // 보호 대상(기존 실제 글) 현황 — 개수만.
  const [postsWithImages, totalPosts] = await Promise.all([prisma.post.count({ where: { images: { some: {} } } }), prisma.post.count()]);

  // Data API 상태(읽기 요청, status만). OFF면 non-2xx.
  const dataApiRoot = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => r.status).catch(() => -1);
  const dataApiTable = await fetch(`${url}/rest/v1/post_images?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => r.status).catch(() => -1);

  console.log('COMMUNITY IMAGE ORPHAN AUDIT (DRY-RUN — nothing is deleted)');
  console.log(`bucket: ${COMMUNITY_IMAGE_BUCKET}   key kind: ${keyRole}   min age: ${args.minAgeHours}h`);

  if (!result.ok) {
    console.log(`\nRESULT: FAILED at stage=${result.stage} (${result.error}) — no candidates computed, nothing deleted.`);
    process.exitCode = 1;
    return;
  }
  const r = result.report;
  const plan = planOrphanCleanup(r);

  console.log(`now: ${r.nowIso}`);
  console.log('');
  console.log(`Storage objects:          ${r.storageObjects}`);
  console.log(`Storage bytes:            ${r.storageBytes} (${formatBytes(r.storageBytes)})`);
  console.log(`DB PostImage refs:        ${r.dbRefs}`);
  console.log(`Posts (total / w/ images): ${totalPosts} / ${postsWithImages}`);
  console.log('');
  console.log(`A Referenced:             ${r.counts.REFERENCED}`);
  console.log(`B Recent unreferenced:    ${r.counts.RECENT_UNREFERENCED}`);
  console.log(`C Safe orphan candidates: ${r.counts.SAFE_ORPHAN_CANDIDATE}`);
  console.log(`D Missing storage refs:   ${r.counts.DB_MISSING_STORAGE} (confirmed by per-object info lookup)`);
  console.log(`E Review required:        ${r.counts.REVIEW_REQUIRED}`);
  console.log(`  DB refs w/ invalid path: ${r.counts.DB_INVALID_PATH}`);
  console.log('');
  console.log(`Potential reclaim bytes:  ${r.candidateBytes} (${formatBytes(r.candidateBytes)})`);
  console.log(`Oldest candidate age:     ${hours(r.oldestCandidateAgeHours)}`);
  console.log(`Newest candidate age:     ${hours(r.newestCandidateAgeHours)}`);
  const reviewReasons = r.review.reduce<Record<string, number>>((acc, o) => ((acc[o.reviewReason!] = (acc[o.reviewReason!] ?? 0) + 1), acc), {});
  if (r.review.length) console.log(`Review reasons:           ${JSON.stringify(reviewReasons)}`);
  console.log('');
  console.log(
    `Phase 2 plan (not executed): ${plan.status}` +
      (plan.status === 'READY' ? ` batch=${plan.batch.length} deferred=${plan.deferred}` : plan.status === 'STOP' ? ` reason=${plan.reason}` : '') +
      `  [cap ${APPLY_MAX_DELETE_PER_RUN}/run, STOP > ${APPLY_STOP_OBJECT_COUNT} objects or > ${formatBytes(APPLY_STOP_BYTES)}]`
  );
  console.log(`Data API: /rest/v1/ HTTP ${dataApiRoot}, /rest/v1/post_images HTTP ${dataApiTable} (non-2xx = OFF)`);

  printSamples('Recent unreferenced', r.recentUnreferenced, args.verbose);
  printSamples('Safe orphan candidates', r.candidates, args.verbose);
  printSamples('Review required', r.review, args.verbose);
  if (args.verbose && r.dbMissingStorage.length) {
    console.log('\n  DB refs missing storage (redacted, max 20):');
    for (const p of r.dbMissingStorage.slice(0, 20)) console.log(`    ${redactImagePath(p)}`);
  }
}

main()
  .catch((e) => {
    console.error('failed:', (e as Error).name, (e as { status?: number }).status ?? '');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
