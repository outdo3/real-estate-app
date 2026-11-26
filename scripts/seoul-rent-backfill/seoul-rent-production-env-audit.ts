import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

// 1. Load env safely
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

export interface ProductionAuditReport {
  timestamp: string;
  supabaseProjectId: {
    fromSupabaseUrl: string | null;
    fromDatabaseUrlHostOrUser: string | null;
    matched: boolean;
  };
  operationalDb: {
    connected: boolean;
    databaseName: string;
    currentUser: string;
    version: string;
    hostDomainMasked: string;
    port: number;
    isPooler: boolean;
    poolerModeEstimated: string;
  };
  targetTable: {
    tableName: string;
    exists: boolean;
    totalRows: number;
    busanRows: number; // lawd_cd LIKE '26%'
    seoulRows: number; // lawd_cd LIKE '11%'
    otherRows: number;
  };
  constraintsAndIndexes: {
    indexes: Array<{ indexName: string; indexDef: string }>;
    uniqueConstraints: Array<{ constraintName: string; constraintDef: string }>;
    hasNaturalKeyConstraint: boolean;
  };
  schemaDiffWithLocalQa: {
    qaConnected: boolean;
    qaTotalRows: number;
    columnsDiff: Array<{
      column: string;
      operationalType: string;
      qaType: string;
      match: boolean;
    }>;
    identicalSchema: boolean;
  };
  capacityAndStorage: {
    dbTotalSizePretty: string;
    tableTotalSizePretty: string;
    tableDataSizePretty: string;
    tableIndexSizePretty: string;
  };
  connectionAndLimits: {
    maxConnections: string;
    statementTimeout: string;
    idleInTxSessionTimeout: string;
    archiveMode: string;
    walLevel: string;
  };
  backupAndRecovery: {
    supabaseDailyBackupExpected: boolean;
    pitrCapableByWal: boolean;
    safeRollbackSqlAvailable: boolean;
  };
  errors?: string[];
}

export async function runProductionEnvAudit(): Promise<ProductionAuditReport> {
  const errors: string[] = [];

  // Parse Project ID safely
  let projectIdFromUrl: string | null = null;
  const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (rawSupabaseUrl) {
    try {
      const u = new URL(rawSupabaseUrl);
      const parts = u.hostname.split('.');
      if (parts.length >= 3 && parts[1] === 'supabase') {
        projectIdFromUrl = parts[0];
      }
    } catch {}
  }

  let projectIdFromDb: string | null = null;
  let hostDomainMasked = 'unknown';
  let port = 5432;
  const rawDbUrl = process.env.DATABASE_URL;

  if (rawDbUrl) {
    try {
      const u = new URL(rawDbUrl);
      port = Number(u.port) || 5432;
      const host = u.hostname;
      // mask host: e.g. aws-0-ap-northeast-2.pooler.supabase.com -> aws-0-***.supabase.com
      const hostParts = host.split('.');
      if (hostParts.length > 2) {
        hostDomainMasked = `${hostParts[0]}.${hostParts[1] === 'pooler' ? 'pooler.' : ''}***.${hostParts.slice(-2).join('.')}`;
      } else {
        hostDomainMasked = host;
      }

      // Check username for postgres.<project-ref> pattern commonly used by Supabase connection poolers
      if (u.username.includes('.')) {
        projectIdFromDb = u.username.split('.')[1];
      } else if (host.endsWith('.supabase.co')) {
        projectIdFromDb = host.replace('.supabase.co', '');
      }
    } catch {}
  }

  const opPrisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  const qaPrisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://qa_tester:qa_test_pass_secure@127.0.0.1:54332/ejip_seoul_rent_qa?schema=public' } },
  });

  const report: ProductionAuditReport = {
    timestamp: new Date().toISOString(),
    supabaseProjectId: {
      fromSupabaseUrl: projectIdFromUrl,
      fromDatabaseUrlHostOrUser: projectIdFromDb,
      matched: projectIdFromUrl === projectIdFromDb && projectIdFromUrl !== null,
    },
    operationalDb: {
      connected: false,
      databaseName: '',
      currentUser: '',
      version: '',
      hostDomainMasked,
      port,
      isPooler: port === 6543 || hostDomainMasked.includes('pooler'),
      poolerModeEstimated: port === 6543 ? 'Transaction mode (PgBouncer)' : 'Session / Direct mode',
    },
    targetTable: {
      tableName: 'apartment_rent_histories',
      exists: false,
      totalRows: 0,
      busanRows: 0,
      seoulRows: 0,
      otherRows: 0,
    },
    constraintsAndIndexes: {
      indexes: [],
      uniqueConstraints: [],
      hasNaturalKeyConstraint: false,
    },
    schemaDiffWithLocalQa: {
      qaConnected: false,
      qaTotalRows: 0,
      columnsDiff: [],
      identicalSchema: false,
    },
    capacityAndStorage: {
      dbTotalSizePretty: '',
      tableTotalSizePretty: '',
      tableDataSizePretty: '',
      tableIndexSizePretty: '',
    },
    connectionAndLimits: {
      maxConnections: '',
      statementTimeout: '',
      idleInTxSessionTimeout: '',
      archiveMode: '',
      walLevel: '',
    },
    backupAndRecovery: {
      supabaseDailyBackupExpected: true,
      pitrCapableByWal: false,
      safeRollbackSqlAvailable: true,
    },
  };

  try {
    // Database info
    const dbInfoRes = await opPrisma.$queryRawUnsafe<any[]>(
      `SELECT current_database(), current_user, version();`
    );
    report.operationalDb.connected = true;
    report.operationalDb.databaseName = dbInfoRes[0].current_database;
    report.operationalDb.currentUser = dbInfoRes[0].current_user;
    report.operationalDb.version = (dbInfoRes[0].version || '').split(' on ')[0];

    // Check table existence
    const tableRes = await opPrisma.$queryRawUnsafe<any[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = 'apartment_rent_histories'
       ) AS exists;`
    );
    report.targetTable.exists = Boolean(tableRes[0].exists);

    if (report.targetTable.exists) {
      // Row counts (strictly read-only)
      const countRes = await opPrisma.$queryRawUnsafe<any[]>(`
        SELECT 
          COUNT(*)::bigint AS total_rows,
          COUNT(*) FILTER (WHERE lawd_cd LIKE '26%')::bigint AS busan_rows,
          COUNT(*) FILTER (WHERE lawd_cd LIKE '11%')::bigint AS seoul_rows,
          COUNT(*) FILTER (WHERE lawd_cd NOT LIKE '26%' AND lawd_cd NOT LIKE '11%')::bigint AS other_rows
        FROM apartment_rent_histories;
      `);
      report.targetTable.totalRows = Number(countRes[0].total_rows);
      report.targetTable.busanRows = Number(countRes[0].busan_rows);
      report.targetTable.seoulRows = Number(countRes[0].seoul_rows);
      report.targetTable.otherRows = Number(countRes[0].other_rows);

      // Indexes
      const indexRes = await opPrisma.$queryRawUnsafe<any[]>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'apartment_rent_histories'
        ORDER BY indexname;
      `);
      report.constraintsAndIndexes.indexes = indexRes.map((r: any) => ({
        indexName: r.indexname,
        indexDef: r.indexdef,
      }));

      // Unique Constraints
      const constRes = await opPrisma.$queryRawUnsafe<any[]>(`
        SELECT conname, pg_get_constraintdef(c.oid) AS condef
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'apartment_rent_histories' AND c.contype = 'u'
        ORDER BY conname;
      `);
      report.constraintsAndIndexes.uniqueConstraints = constRes.map((r: any) => ({
        constraintName: r.conname,
        constraintDef: r.condef,
      }));

      report.constraintsAndIndexes.hasNaturalKeyConstraint =
        report.constraintsAndIndexes.indexes.some((i) => i.indexName.includes('natural_key') || i.indexDef.includes('UNIQUE')) ||
        report.constraintsAndIndexes.uniqueConstraints.some((c) => c.constraintName.includes('natural_key'));

      // Storage & Capacity
      const sizeRes = await opPrisma.$queryRawUnsafe<any[]>(`
        SELECT 
          pg_size_pretty(pg_database_size(current_database())) AS db_size,
          pg_size_pretty(pg_total_relation_size('"apartment_rent_histories"')) AS total_table_size,
          pg_size_pretty(pg_relation_size('"apartment_rent_histories"')) AS table_data_size,
          pg_size_pretty(pg_indexes_size('"apartment_rent_histories"')) AS table_index_size;
      `);
      report.capacityAndStorage.dbTotalSizePretty = sizeRes[0].db_size;
      report.capacityAndStorage.tableTotalSizePretty = sizeRes[0].total_table_size;
      report.capacityAndStorage.tableDataSizePretty = sizeRes[0].table_data_size;
      report.capacityAndStorage.tableIndexSizePretty = sizeRes[0].table_index_size;
    }

    // Settings / limits
    const settingsRes = await opPrisma.$queryRawUnsafe<any[]>(`
      SELECT 
        current_setting('max_connections', true) AS max_conns,
        current_setting('statement_timeout', true) AS stmt_timeout,
        current_setting('idle_in_transaction_session_timeout', true) AS idle_in_tx,
        current_setting('archive_mode', true) AS arch_mode,
        current_setting('wal_level', true) AS wal_lvl;
    `);
    const s = settingsRes[0];
    report.connectionAndLimits.maxConnections = s.max_conns || 'unknown';
    report.connectionAndLimits.statementTimeout = s.stmt_timeout || 'unknown';
    report.connectionAndLimits.idleInTxSessionTimeout = s.idle_in_tx || 'unknown';
    report.connectionAndLimits.archiveMode = s.arch_mode || 'unknown';
    report.connectionAndLimits.walLevel = s.wal_lvl || 'unknown';
    report.backupAndRecovery.pitrCapableByWal = s.arch_mode === 'on' || s.wal_lvl === 'replica' || s.wal_lvl === 'logical';

  } catch (err: any) {
    errors.push(`Operational DB query error: ${err.message}`);
  } finally {
    await opPrisma.$disconnect().catch(() => {});
  }

  // Schema diff with local Docker QA
  try {
    const qaCountRes = await qaPrisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories;`);
    report.schemaDiffWithLocalQa.qaConnected = true;
    report.schemaDiffWithLocalQa.qaTotalRows = Number(qaCountRes[0].cnt);

    // Columns from QA
    const qaColsRes = await qaPrisma.$queryRawUnsafe<any[]>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'apartment_rent_histories'
      ORDER BY column_name;
    `);

    // Columns from Operational DB
    const clientOp = new PrismaClient({ datasources: { db: { url: rawDbUrl } } });
    const opColsRes = await clientOp.$queryRawUnsafe<any[]>(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'apartment_rent_histories'
      ORDER BY column_name;
    `);
    await clientOp.$disconnect().catch(() => {});

    const qaMap = new Map<string, string>();
    for (const r of qaColsRes) {
      qaMap.set(r.column_name, `${r.data_type} (nullable: ${r.is_nullable})`);
    }

    const opMap = new Map<string, string>();
    for (const r of opColsRes) {
      opMap.set(r.column_name, `${r.data_type} (nullable: ${r.is_nullable})`);
    }

    const allCols = Array.from(new Set([...Array.from(qaMap.keys()), ...Array.from(opMap.keys())])).sort();
    let identical = true;

    for (const col of allCols) {
      const opType = opMap.get(col) ?? 'MISSING_IN_OP';
      const qaType = qaMap.get(col) ?? 'MISSING_IN_QA';
      const match = opType === qaType;
      if (!match) identical = false;
      report.schemaDiffWithLocalQa.columnsDiff.push({
        column: col,
        operationalType: opType,
        qaType,
        match,
      });
    }
    report.schemaDiffWithLocalQa.identicalSchema = identical;

  } catch (err: any) {
    errors.push(`QA DB comparison error: ${err.message}`);
  } finally {
    await qaPrisma.$disconnect().catch(() => {});
  }

  if (errors.length > 0) {
    report.errors = errors;
  }

  return report;
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-production-env-audit.ts')) {
  runProductionEnvAudit()
    .then((rep) => {
      console.log('=== E-JIP SEOUL RENT PRODUCTION READ-ONLY AUDIT ===');
      console.log(JSON.stringify(rep, null, 2));
    })
    .catch((err) => {
      console.error('Audit failed:', err);
      process.exit(1);
    });
}
