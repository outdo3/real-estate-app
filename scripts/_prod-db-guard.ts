// SUPABASE_EGRESS_P0_FIX_V1 §3 — scripts가 Production DB를 상대로 대량 read를 일으키는
// 구조에 대한 최소 안전장치.
//
// 배경(감사에서 PROVEN): 모든 scripts/*.ts가 dotenv로 루트 .env를 읽어 **앱과 동일한
// Production DATABASE_URL**을 쓴다. 그 결과 benchmark/QA/verification 스크립트 한 번
// 실행이 855,047행 전체 스캔이나 수만 행 materialization을 일으켰고, 이것이 41일간 관측된
// egress의 큰 몫이었다(`apartment_trade_histories` 전체를 반환한 쿼리 43회 등).
//
// 설계 원칙:
//  - 스크립트를 분류해서 **위험한 것만** 막는다. 운영 스크립트를 무조건 차단하지 않는다.
//  - 기본은 fail-closed(모르면 막는다)가 아니라 **분류에 따라** 결정한다 — 운영 sync를
//    깨뜨리는 것이 egress보다 훨씬 큰 사고이기 때문이다.
//  - Cron(sale/rent production sync)은 Next.js Function(src/lib/sync/**)에서 돌아
//    이 파일을 아예 거치지 않는다. 즉 이 가드는 구조적으로 Cron에 영향을 줄 수 없다.
//  - 판정 로직은 순수 함수로 분리해 DB/네트워크 없이 테스트한다.

export type ScriptClass =
  /** A. 운영 스크립트(수동 sync 등) — Production에서 도는 것이 정상. 절대 막지 않는다. */
  | 'OPERATIONAL'
  /** B. QA/benchmark/진단 — Production 대량 read가 문제였던 부류. 기본 차단. */
  | 'DIAGNOSTIC'
  /** C. backfill/대량 write — 명시적 승인 없이는 차단. */
  | 'BACKFILL';

export interface GuardDecision {
  allowed: boolean;
  reason: string;
  /** 차단 해제에 필요한 환경변수 이름(있을 때만). */
  overrideEnv?: string;
}

/**
 * DATABASE_URL이 Production(원격 관리형 DB)을 가리키는지 판정한다.
 *
 * 호스트가 로컬이면 Production이 아니라고 본다. 그 외(supabase 등 원격 호스트)는
 * Production으로 **간주**한다 — 모르는 원격 DB를 "아마 개발용"으로 낙관하지 않는다.
 */
export function isProductionDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // 파싱 불가한 URL을 안전한 쪽(Production으로 간주)으로 처리한다.
    return true;
  }
  if (!host) return true;
  const localHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', '0.0.0.0'];
  if (localHosts.includes(host)) return false;
  return true;
}

/**
 * 이 스크립트가 지금 이 DB를 상대로 실행돼도 되는지 결정한다(순수 함수).
 *
 * OPERATIONAL은 언제나 통과 — 운영 sync를 막는 것이 이 가드의 목적이 아니다.
 * DIAGNOSTIC/BACKFILL은 Production을 상대로 할 때만, 명시적 opt-in 환경변수가 있어야
 * 통과한다. 비-Production(로컬)에서는 전부 자유롭게 돌 수 있다.
 */
export function decideProductionDbAccess(input: {
  scriptClass: ScriptClass;
  isProductionDb: boolean;
  env: Record<string, string | undefined>;
}): GuardDecision {
  const { scriptClass, isProductionDb, env } = input;

  if (scriptClass === 'OPERATIONAL') {
    return { allowed: true, reason: 'OPERATIONAL 스크립트 — 운영 목적이므로 Production 접근을 막지 않는다.' };
  }
  if (!isProductionDb) {
    return { allowed: true, reason: 'Production DB가 아니다(로컬) — 제한 없음.' };
  }

  const overrideEnv = scriptClass === 'BACKFILL' ? 'ALLOW_PROD_DB_WRITE' : 'ALLOW_PROD_DB_READ';
  if (env[overrideEnv] === '1') {
    return { allowed: true, reason: `${overrideEnv}=1 로 명시적 승인됨.`, overrideEnv };
  }
  return {
    allowed: false,
    overrideEnv,
    reason:
      scriptClass === 'BACKFILL'
        ? 'BACKFILL 스크립트를 Production DB에 대해 실행하려 한다. 대량 write는 명시적 승인이 필요하다.'
        : 'DIAGNOSTIC(QA/benchmark/진단) 스크립트를 Production DB에 대해 실행하려 한다. 이런 실행이 관측된 Supabase egress 초과의 큰 원인이었다.',
  };
}

/**
 * 스크립트 main() 맨 앞에서 호출한다. 차단 시 그 자리에서 종료한다(fail-closed).
 * secret은 절대 출력하지 않는다 — 호스트명도 찍지 않고 판정 결과만 알린다.
 */
export function assertProductionDbAccessAllowed(scriptClass: ScriptClass, scriptName: string): void {
  const decision = decideProductionDbAccess({
    scriptClass,
    isProductionDb: isProductionDatabaseUrl(process.env.DATABASE_URL),
    env: process.env as Record<string, string | undefined>,
  });

  if (decision.allowed) return;

  console.error('');
  console.error(`[prod-db-guard] BLOCKED: ${scriptName}`);
  console.error(`[prod-db-guard] ${decision.reason}`);
  console.error(`[prod-db-guard] 의도한 실행이라면 ${decision.overrideEnv}=1 을 설정하고 다시 실행하세요.`);
  console.error(`[prod-db-guard]   예) ${decision.overrideEnv}=1 npx ts-node ... ${scriptName}`);
  console.error('');
  process.exit(1);
}
