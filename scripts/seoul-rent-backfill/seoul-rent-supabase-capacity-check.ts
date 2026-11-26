import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Worktree 및 루트 환경변수 경로 순차 탐색
const envSearchPaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env.local'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../.env.local'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../../.env.local'),
  path.resolve(__dirname, '../../../../.env'),
];

for (const p of envSearchPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

export interface SupabaseCapacityReport {
  connected: boolean;
  databaseName?: string;
  hostDomain?: string;
  totalDbSizePretty?: string;
  totalDbSizeBytes?: number;
  rentTableName?: string | null;
  hasApartmentRentHistory?: boolean;
  rentHistoryRowCount?: number;
  rentTotalSizePretty?: string;
  rentTotalSizeBytes?: number;
  rentDataSizePretty?: string;
  rentDataSizeBytes?: number;
  rentIndexSizePretty?: string;
  rentIndexSizeBytes?: number;
  error?: string;
}

export async function checkSupabaseCapacity(): Promise<SupabaseCapacityReport> {
  let prismaClient: any = null;
  try {
    const { prisma } = await import('../../src/lib/prisma');
    prismaClient = prisma;

    // 1. Host Domain (비밀번호/토큰 제외, 호스트 도메인만 추출)
    let hostDomain = 'unknown';
    const rawUrl = process.env.DATABASE_URL;
    if (rawUrl) {
      try {
        const u = new URL(rawUrl);
        hostDomain = u.hostname;
      } catch {}
    }

    // 2. Database Name & Total DB Size
    const dbInfo = await prisma.$queryRawUnsafe<any[]>(
      `SELECT current_database() AS db_name,
              pg_database_size(current_database()) AS total_bytes,
              pg_size_pretty(pg_database_size(current_database())) AS total_pretty;`
    );

    const dbName = dbInfo?.[0]?.db_name ?? 'unknown';
    const totalBytes = Number(dbInfo?.[0]?.total_bytes ?? 0);
    const totalPretty = dbInfo?.[0]?.total_pretty ?? 'unknown';

    // 2.1 Public 테이블 목록 확인
    const tablesRes = await prismaClient.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    ) as any[];
    const existingTables: string[] = (tablesRes ?? []).map((r: any) => r.table_name);

    let rentRowCount: number | undefined;
    let rentTotalBytes: number | undefined;
    let rentTotalPretty: string | undefined;
    let rentDataBytes: number | undefined;
    let rentDataPretty: string | undefined;
    let rentIndexBytes: number | undefined;
    let rentIndexPretty: string | undefined;

    const actualTableName = existingTables.includes('apartment_rent_histories')
      ? 'apartment_rent_histories'
      : existingTables.includes('ApartmentRentHistory')
        ? 'ApartmentRentHistory'
        : null;

    if (actualTableName) {
      // 3. ApartmentRentHistory Table Row Count & Size
      const rentCountRes = await prismaClient.$queryRawUnsafe(
        `SELECT count(*)::bigint AS cnt FROM "${actualTableName}";`
      ) as any[];
      rentRowCount = Number(rentCountRes?.[0]?.cnt ?? 0);

      const rentSizeRes = await prismaClient.$queryRawUnsafe(
        `SELECT pg_total_relation_size('"${actualTableName}"') AS total_bytes,
                pg_size_pretty(pg_total_relation_size('"${actualTableName}"')) AS total_pretty,
                pg_relation_size('"${actualTableName}"') AS data_bytes,
                pg_size_pretty(pg_relation_size('"${actualTableName}"')) AS data_pretty,
                pg_indexes_size('"${actualTableName}"') AS index_bytes,
                pg_size_pretty(pg_indexes_size('"${actualTableName}"')) AS index_pretty;`
      ) as any[];

      rentTotalBytes = Number(rentSizeRes?.[0]?.total_bytes ?? 0);
      rentTotalPretty = rentSizeRes?.[0]?.total_pretty ?? '0 bytes';
      rentDataBytes = Number(rentSizeRes?.[0]?.data_bytes ?? 0);
      rentDataPretty = rentSizeRes?.[0]?.data_pretty ?? '0 bytes';
      rentIndexBytes = Number(rentSizeRes?.[0]?.index_bytes ?? 0);
      rentIndexPretty = rentSizeRes?.[0]?.index_pretty ?? '0 bytes';
    }

    return {
      connected: true,
      databaseName: dbName,
      hostDomain,
      totalDbSizePretty: totalPretty,
      totalDbSizeBytes: totalBytes,
      rentTableName: actualTableName,
      hasApartmentRentHistory: actualTableName !== null,
      rentHistoryRowCount: rentRowCount,
      rentTotalSizePretty: rentTotalPretty,
      rentTotalSizeBytes: rentTotalBytes,
      rentDataSizePretty: rentDataPretty,
      rentDataSizeBytes: rentDataBytes,
      rentIndexSizePretty: rentIndexPretty,
      rentIndexSizeBytes: rentIndexBytes,
    };
  } catch (err: any) {
    return {
      connected: false,
      error: err.message || String(err),
    };
  } finally {
    if (prismaClient) {
      await prismaClient.$disconnect();
    }
  }
}

// 직접 실행 시 결과 출력
if (require.main === module || process.argv[1]?.endsWith('seoul-rent-supabase-capacity-check.ts')) {
  checkSupabaseCapacity().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
}
