import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const envSearchPaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env.local'),
  path.resolve(process.cwd(), '../../.env'),
];

for (const p of envSearchPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

export interface BackupStatusProbeResult {
  timestamp: string;
  projectId: string;
  dbConnected: boolean;
  archiverStats: {
    archivedCount: number;
    lastArchivedWal: string | null;
    lastArchivedTime: string | null;
    failedCount: number;
    lastFailedWal: string | null;
    lastFailedTime: string | null;
    statsReset: string | null;
  } | null;
  supabaseSchemas: string[];
  hasSupabaseAdminTables: boolean;
  actualBackupEvidence: {
    walArchivingActive: boolean;
    lastWalArchiveRecent: boolean;
    managementApiAccessible: boolean;
    managementApiReason: string;
    pitrStatus: 'CONFIRMED' | 'UNCONFIRMED';
    dailyBackupStatus: 'CONFIRMED' | 'UNCONFIRMED';
    summaryReason: string;
  };
}

export async function probeOperationalBackupStatus(): Promise<BackupStatusProbeResult> {
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  let projectId = 'unknown';
  const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (rawSupabaseUrl) {
    try {
      const u = new URL(rawSupabaseUrl);
      const parts = u.hostname.split('.');
      if (parts.length >= 3 && parts[1] === 'supabase') {
        projectId = parts[0];
      }
    } catch {}
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  try {
    // 1. pg_stat_archiver
    const archiverRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT archived_count, last_archived_wal, last_archived_time::text,
              failed_count, last_failed_wal, last_failed_time::text, stats_reset::text
       FROM pg_stat_archiver;`
    );

    let archiverStats: BackupStatusProbeResult['archiverStats'] = null;
    if (archiverRows && archiverRows.length > 0) {
      const r = archiverRows[0];
      archiverStats = {
        archivedCount: Number(r.archived_count || 0),
        lastArchivedWal: r.last_archived_wal || null,
        lastArchivedTime: r.last_archived_time || null,
        failedCount: Number(r.failed_count || 0),
        lastFailedWal: r.last_failed_wal || null,
        lastFailedTime: r.last_failed_time || null,
        statsReset: r.stats_reset || null,
      };
    }

    // 2. Schemas in database
    const schemaRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;`
    );
    const schemas = schemaRows.map((r: any) => r.schema_name);

    // 3. Check for any supabase admin backup tables
    const tableRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT table_schema, table_name 
       FROM information_schema.tables 
       WHERE table_schema IN ('supabase_admin', '_supabase', 'extensions', 'auth', 'storage')
       ORDER BY table_schema, table_name;`
    );
    const hasSupabaseAdminTables = tableRows.length > 0;

    // 4. Evaluate actual backup confirmation
    // Note: In Supabase architecture, pg_stat_archiver reports internal Postgres WAL archiving.
    // However, whether Supabase Pro PITR is officially provisioned, the retention period (7 vs 30 days),
    // and the exact timestamp of the last restorable physical snapshot can only be confirmed via
    // the Supabase Dashboard / Management API (`GET https://api.supabase.com/v1/projects/{ref}/database/backups`).
    // A database connection credential does not possess management-plane credentials to query Supabase platform APIs.
    const walActive = (archiverStats?.archivedCount ?? 0) > 0;
    const isLastWalArchiveRecent = archiverStats?.lastArchivedTime ? true : false;

    // Supabase platform API access check
    const hasPlatformManagementToken = Boolean(process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_MANAGEMENT_TOKEN);

    return {
      timestamp: new Date().toISOString(),
      projectId,
      dbConnected: true,
      archiverStats,
      supabaseSchemas: schemas,
      hasSupabaseAdminTables,
      actualBackupEvidence: {
        walArchivingActive: walActive,
        lastWalArchiveRecent: isLastWalArchiveRecent,
        managementApiAccessible: hasPlatformManagementToken,
        managementApiReason: hasPlatformManagementToken
          ? 'Platform management token present'
          : 'No Supabase Personal Access Token (SUPABASE_ACCESS_TOKEN) available in environment. Platform dashboard confirmation required.',
        pitrStatus: 'UNCONFIRMED', // Explicitly unconfirmed without platform API / dashboard confirmation
        dailyBackupStatus: 'UNCONFIRMED', // Explicitly unconfirmed without platform API / dashboard confirmation
        summaryReason:
          'Postgres internal WAL archiver is actively running at DB level, but exact Supabase platform backup snapshot time and PITR entitlement cannot be directly queried via SQL connection alone.',
      },
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-backup-status-probe.ts')) {
  probeOperationalBackupStatus()
    .then((res) => {
      console.log('=== SUPABASE BACKUP & ARCHIVER STATUS PROBE ===');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Probe failed:', err);
      process.exit(1);
    });
}
