// TEST_DATABASE_SAFETY_GUARD_V1 — 테스트가 Production DB에 **쓰지 못하게** 막는다.
//
// 사고(ADMIN_ERROR_LOGGING_P1_V1 §14): 로컬에서 `npx tsx --test`로 돌린 단위 테스트가
// 기본 writer(`prisma.errorLog.create`)를 타는 바람에 **운영 `error_logs`에 4행**을 썼다.
// `scripts/_prod-db-guard.ts`는 `scripts/*.ts`가 스스로 호출할 때만 동작하고,
// **테스트 러너는 그 경로를 전혀 거치지 않는다**(코드로 확인: src/ 어디에도 호출이 없다).
//
// 설계 결정
//  - 막는 대상은 **쓰기**다. 읽기는 막지 않는다 — `src/lib/report/region-read.integration.test.ts`가
//    "Production 읽기 전용 통합 확인"으로 **의도적으로** 운영 DB를 SELECT한다(파일 주석에 명시).
//    그 계약을 깨지 않으면서 사고 유형(INSERT/UPDATE/DELETE)만 차단한다.
//  - **fail-closed**: 읽기라고 확인된 operation만 통과시키고, 모르는 operation은 쓰기로 본다.
//  - **substring 추측 금지**: DB 판별은 호스트 allowlist 계약으로 한다(아래).
//  - 비밀값을 출력하지 않는다 — 호스트명도 찍지 않고 판정 결과만 알린다.

export type TestRuntimeSignal =
  | 'NODE_TEST_CONTEXT' // node:test (npx tsx --test 포함) — Node가 자동으로 넣는다
  | 'VITEST'
  | 'JEST_WORKER_ID'
  | 'NODE_ENV_TEST'
  | 'EXEC_ARGV_TEST';

/**
 * 지금 프로세스가 테스트 러너인가.
 *
 * `NODE_TEST_CONTEXT`가 핵심이다 — Node의 내장 러너가 **자동으로** 설정하므로
 * package script를 우회해 `npx tsx --test ...`를 직접 실행해도 잡힌다(실측 확인: "child-v8").
 */
export function detectTestRuntime(
  env: Record<string, string | undefined>,
  execArgv: readonly string[] = []
): TestRuntimeSignal | null {
  if (env.NODE_TEST_CONTEXT) return 'NODE_TEST_CONTEXT';
  if (env.VITEST) return 'VITEST';
  if (env.JEST_WORKER_ID) return 'JEST_WORKER_ID';
  if (env.NODE_ENV === 'test') return 'NODE_ENV_TEST';
  if (execArgv.some((a) => a === '--test' || a.startsWith('--test-'))) return 'EXEC_ARGV_TEST';
  return null;
}

/**
 * 로컬/일회용 DB로 **확인된** 호스트 목록. 여기 없으면 Production으로 **간주**한다.
 * (scripts/_prod-db-guard.ts와 같은 계약 — 모르는 원격 DB를 "아마 개발용"으로 낙관하지 않는다.
 *  두 구현이 갈라지지 않도록 테스트로 같은 표를 고정한다.)
 */
export const NON_PRODUCTION_DB_HOSTS = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', '0.0.0.0'] as const;

export function isProductionDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // 파싱 불가 → 안전한 쪽(Production)
  }
  if (!host) return true;
  // IPv6는 `URL.hostname`이 대괄호를 포함해 돌려준다(`[::1]`). 대괄호를 벗겨 비교한다 —
  // 이걸 빼면 allowlist의 '::1'이 **영원히 매칭되지 않는다**(scripts/_prod-db-guard.ts에도
  // 같은 맹점이 있다. 안전한 쪽 오류라 동작은 막히지 않고 로컬 IPv6가 Production 취급될 뿐이다).
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return !(NON_PRODUCTION_DB_HOSTS as readonly string[]).includes(bare);
}

/** Prisma operation 중 **읽기라고 확인된 것**. 목록에 없으면 쓰기로 본다(fail-closed). */
const READ_ONLY_ACTIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'aggregate', 'count', 'groupBy', 'queryRaw', 'findRaw', 'aggregateRaw',
]);

export function isReadOnlyPrismaAction(action: string): boolean {
  return READ_ONLY_ACTIONS.has(action);
}

export interface TestDbPolicy {
  /** 테스트 러너인가(어떤 신호로 판단했는지). */
  testSignal: TestRuntimeSignal | null;
  /** 이 프로세스가 실제로 쓸 DATABASE_URL이 Production인가. */
  productionDb: boolean;
  /** 테스트가 쓰기를 해도 되는가. */
  writesAllowed: boolean;
  /** 테스트 전용 DB가 설정돼 있는가. */
  testDatabaseConfigured: boolean;
  reason: string;
}

export function resolveTestDbPolicy(
  env: Record<string, string | undefined>,
  execArgv: readonly string[] = []
): TestDbPolicy {
  const testSignal = detectTestRuntime(env, execArgv);
  const testDatabaseConfigured = !!env.TEST_DATABASE_URL;
  // 테스트에서는 TEST_DATABASE_URL이 있으면 그것을 쓴다(§8).
  const effectiveUrl = testSignal && testDatabaseConfigured ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  const productionDb = isProductionDatabaseUrl(effectiveUrl);

  if (!testSignal) {
    return { testSignal, productionDb, writesAllowed: true, testDatabaseConfigured,
      reason: '테스트 러너가 아니다 — 운영/개발 런타임은 이 가드의 대상이 아니다.' };
  }
  if (!productionDb) {
    return { testSignal, productionDb, writesAllowed: true, testDatabaseConfigured,
      reason: testDatabaseConfigured
        ? 'TEST_DATABASE_URL이 Production이 아니다 — 쓰기 허용.'
        : 'DATABASE_URL이 로컬 DB다 — 쓰기 허용.' };
  }
  return { testSignal, productionDb, writesAllowed: false, testDatabaseConfigured,
    reason: 'NO_TEST_DATABASE_CONFIGURED — 테스트가 Production DB를 가리킨다. 쓰기를 거부한다.' };
}

/** 테스트에서 쓰려는 순간 던진다. 비밀값·호스트명은 담지 않는다. */
export function assertTestWriteAllowed(
  action: string,
  model: string | undefined,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  execArgv: readonly string[] = process.execArgv
): void {
  const policy = resolveTestDbPolicy(env, execArgv);
  if (policy.writesAllowed || isReadOnlyPrismaAction(action)) return;
  throw new Error(
    'Refusing to run tests against Production database.\n' +
      `  blocked: ${model ? `${model}.` : ''}${action}\n` +
      `  detected test runner via: ${policy.testSignal}\n` +
      '  DATABASE_URL points at a non-local host, and TEST_DATABASE_URL is not set.\n' +
      '  Fix: inject a fake writer in the test, or set TEST_DATABASE_URL to a disposable database.\n' +
      '  (see docs/development/TEST_DATABASE_SAFETY_GUARD_V1.md)'
  );
}
