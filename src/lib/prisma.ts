import type { PrismaClient } from '@prisma/client';
import { disabledDatabase } from '@/lib/isolated-qa/database';

// This QA branch has no database client, including during build and fallback paths.
export const prisma = disabledDatabase<PrismaClient>();

export async function warmupConnections(_count: number): Promise<void> {}
