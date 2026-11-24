/**
 * E-JIP 서울 V3.3 — 격리 DB 안전 진단 및 스키마·가드 정밀 검증 모듈
 *
 * 최우선 안전 원칙:
 * 1. 운영 Supabase DB에 대한 어떠한 쓰기나 마이그레이션도 원천 차단
 * 2. 격리된 별도 PostgreSQL(로컬 또는 독립 테스트 인스턴스)만 허용
 * 3. 격리 DB 미확인 시 DB 쓰기를 거부하고 BLOCKED 상태 반환
 */

export interface DbEnvironmentCheckResult {
  hasIsolatedDb: boolean;
  dbHost: string | null;
  isOperationalHost: boolean;
  canExecuteWrite: boolean;
  status: 'READY' | 'BLOCKED_OPERATIONAL_DB' | 'BLOCKED_NO_ISOLATED_DB';
  reason: string;
}

/**
 * 접속 URL이 운영 Supabase DB인지 정밀 대조 판정 (호스트/도메인 기준, 비밀키 노출 없음)
 */
export function evaluateDbEnvironment(dbUrl?: string): DbEnvironmentCheckResult {
  if (!dbUrl) {
    return {
      hasIsolatedDb: false,
      dbHost: null,
      isOperationalHost: false,
      canExecuteWrite: false,
      status: 'BLOCKED_NO_ISOLATED_DB',
      reason: 'No database URL provided in environment.',
    };
  }

  let host = '';
  try {
    const parsed = new URL(dbUrl);
    host = parsed.hostname;
  } catch {
    return {
      hasIsolatedDb: false,
      dbHost: null,
      isOperationalHost: false,
      canExecuteWrite: false,
      status: 'BLOCKED_NO_ISOLATED_DB',
      reason: 'Invalid database URL format.',
    };
  }

  // 운영 Supabase 및 클라우드 호스트 식별
  const isOperationalHost =
    host.includes('supabase.com') ||
    host.includes('pooler.supabase.com') ||
    host.includes('supabase.co');

  if (isOperationalHost) {
    return {
      hasIsolatedDb: false,
      dbHost: host,
      isOperationalHost: true,
      canExecuteWrite: false,
      status: 'BLOCKED_OPERATIONAL_DB',
      reason: `Detected production Supabase host (${host}). Writes are strictly blocked to protect production data.`,
    };
  }

  // 로컬 PostgreSQL(localhost, 127.0.0.1) 또는 명시적 격리 테스트 DB만 허용
  const isLocalOrTest =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.includes('test-db') ||
    host.includes('isolated');

  if (isLocalOrTest) {
    return {
      hasIsolatedDb: true,
      dbHost: host,
      isOperationalHost: false,
      canExecuteWrite: true,
      status: 'READY',
      reason: `Isolated test database confirmed at ${host}. Safe for test execution.`,
    };
  }

  return {
    hasIsolatedDb: false,
    dbHost: host,
    isOperationalHost: false,
    canExecuteWrite: false,
    status: 'BLOCKED_NO_ISOLATED_DB',
    reason: `Host ${host} is neither a verified local database nor an approved isolated test instance.`,
  };
}

/**
 * ApartmentRentHistory Prisma 스키마 고유 인덱스 불변식 검증
 */
export const RENT_SCHEMA_INVARIANTS = {
  modelName: 'ApartmentRentHistory',
  tableName: 'apartment_rent_histories',
  naturalKeyConstraintName: 'rent_natural_key',
  naturalKeyFields: [
    'groupKeyStr',
    'deposit',
    'monthlyRent',
    'dealDate',
    'floor',
    'occurrenceIndex',
  ],
  requiredIndexes: [
    ['lawdCd', 'dealYmd'],
    ['dealDate'],
    ['aptSeq'],
  ],
};
