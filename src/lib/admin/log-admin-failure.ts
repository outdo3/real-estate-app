// ADMIN_ERROR_LOGGING_P1_V1 — 관리자 화면이 실패했을 때 **추적 가능한 흔적**을 남긴다.
//
// 배경(ADMIN_DASHBOARD_DATA_TRUST_AUDIT_V1 §11): /admin/ops와 /admin/dashboard의 catch는
// `console.error`만 했다. 운영자가 "운영 데이터를 불러오지 못했습니다"를 자주 본다고 말했는데
// 최근 24시간 error_logs는 **0건**이어서, 실패 화면과 실제 장애를 연결할 근거가 아예 없었다.
//
// 설계 제약
//  - **스키마를 바꾸지 않는다.** ErrorLog는 (source, message, stack, url, createdAt)뿐이고
//    category/metadata 컬럼이 없다. 그래서 category는 기존 관례대로 **message 접두사**로 싣는다
//    (`buildErrorLogMessage`가 이미 `[method][kind] message` 형태를 쓴다 — 그 자리에 category를 넣는다).
//  - **기존 헬퍼를 재사용한다.** 쓰기·비밀값 마스킹·best-effort는 log-server-error.ts가 이미 한다.
//  - **로깅이 관리자 응답을 더 망가뜨리지 않는다.** 전부 fire-and-forget이고 절대 throw하지 않는다.

import { buildErrorLogMessage } from '@/lib/log-redaction';

/**
 * 하위 subsystem까지 구분한다 — 운영센터는 이제 부분 실패를 허용하므로(TRUST_FIX_V1 §6),
 * "전체 실패"와 "조각 하나 실패"가 로그에서 구분돼야 원인 추적이 된다.
 */
export const ADMIN_FAILURE_CATEGORIES = [
  'ADMIN_DASHBOARD_FAILURE',
  'ADMIN_OPS_FAILURE',
  'ADMIN_OPS_REGION_MODEL_FAILURE',
  // ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §9 — DB 집계 한 조각만 실패한 경우.
  // 화면은 나머지를 그대로 보여주므로 전체 실패(ADMIN_OPS_FAILURE)와 반드시 구분돼야
  // "화면은 떴는데 숫자 하나가 비었다"를 추적할 수 있다.
  'ADMIN_OPS_DB_SUMMARY_FAILURE',
  'ADMIN_BEHAVIOR_FAILURE',
] as const;

export type AdminFailureCategory = (typeof ADMIN_FAILURE_CATEGORIES)[number];

/**
 * 같은 장애가 초당 여러 번 들어와도 error_logs를 채우지 않게 한다.
 *
 * 관리자 대시보드는 20초마다 자동 갱신(SWR refreshInterval)이고 운영센터도 주기 조회다.
 * 장애가 10분 이어지면 한 화면만으로도 수십 건이 쌓인다 — 스키마를 못 바꾸므로 여기서 막는다.
 * 창이 지나면 다시 한 번 기록해 **장애가 계속되고 있다는 사실 자체는 잃지 않는다.**
 */
export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/** 억제 판정만 떼어낸 순수 함수 — 시간과 상태를 주입받아 테스트한다. */
export function shouldLogAdminFailure(
  seen: Map<string, number>,
  key: string,
  now: number,
  windowMs: number = DEDUPE_WINDOW_MS
): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  seen.set(key, now);
  // 오래된 항목은 같은 호출에서 정리한다(별도 타이머·캐시 모듈 없이).
  for (const [k, at] of seen) if (now - at >= windowMs) seen.delete(k);
  return true;
}

/** 프로세스(=서버 인스턴스) 단위 억제 상태. 인스턴스가 여러 개면 인스턴스마다 한 번씩 남는다. */
const seenFailures = new Map<string, number>();

export interface AdminFailureInput {
  category: AdminFailureCategory;
  /** 관리자 엔드포인트 경로. ErrorLog.url에 그대로 들어간다(쿼리스트링 없이 고정 문자열). */
  endpoint: string;
  error: unknown;
  /** 가능하면 소요 시간(ms) — 타임아웃/콜드스타트 판별에 쓴다. */
  latencyMs?: number;
  /**
   * ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §9 — 부분 실패 시 어느 지표가 빠졌는지.
   * 고정 식별자만 들어온다(쿼리 내용·사용자 데이터 아님) — 중복 억제 키에도 섮여
   * 한 지표의 장애가 다른 지표의 기록을 가리지 않는다.
   */
  metricKey?: string;
}

/**
 * 관리자 실패를 기록한다. **절대 throw하지 않는다** — 호출부는 `void`로 불러도 된다.
 *
 * 남기는 것: category · 에러 종류(이름/Prisma code) · 마스킹된 메시지 · endpoint · latency · 시각.
 * 남기지 않는 것: 요청 헤더, 쿠키, 세션/OAuth 토큰, Authorization, IP, 개인정보, DB 자격증명, env 값.
 * (마스킹은 log-server-error.ts의 `redactSensitive`가 저장 직전에 한 번 더 건다.)
 */
/**
 * 쓰기 구현을 주입할 수 있게 둔다 — 기본값은 기존 헬퍼다.
 *
 * 테스트가 **Production DB에 실제로 쓰지 않도록** 하기 위한 seam이다. 이 seam이 없던
 * 초안에서는 "INSERT가 실패해도 throw하지 않는다" 테스트가 진짜 `prisma.errorLog.create`를
 * 호출해 운영 error_logs에 테스트 행을 남겼다(실측으로 확인하고 되돌린 실수).
 */
export type AdminFailureWriter = (message: string, url?: string, stack?: string) => Promise<unknown>;

/**
 * 기본 writer는 **지연 import**한다.
 *
 * `logServerError`를 정적으로 import하면 이 모듈을 부르는 것만으로 `@/lib/prisma`가 로드된다.
 * 단위 테스트는 writer를 주입해 쓰기를 하지 않는데도 Prisma 클라이언트가 만들어지는 셈이라,
 * 테스트가 DB 설정에 불필요하게 묶인다. 실제로 쓸 때만 끌어온다.
 */
const defaultWriter: AdminFailureWriter = async (message, url, stack) => {
  const { logServerError } = await import('@/lib/log-server-error');
  return logServerError(message, url, stack);
};

export function logAdminFailure(input: AdminFailureInput, write: AdminFailureWriter = defaultWriter): void {
  try {
    const base = buildErrorLogMessage(input.category, input.error);
    const message = input.metricKey ? `${base} (metric=${input.metricKey})` : base;
    const key = `${input.endpoint}|${input.metricKey ?? ''}|${message.slice(0, 200)}`;
    if (!shouldLogAdminFailure(seenFailures, key, Date.now())) return;

    const withLatency =
      typeof input.latencyMs === 'number' ? `${message} (latencyMs=${Math.round(input.latencyMs)})` : message;

    // stack은 기존 정책상 허용된 필드이고, 저장 전에 같은 마스킹을 거친다.
    const stack = input.error instanceof Error && input.error.stack ? input.error.stack : undefined;

    // fire-and-forget — logServerError 자체가 내부에서 catch하지만, 호출 자체가 던져도
    // 관리자 응답 경로에 영향이 가지 않도록 여기서 한 번 더 막는다.
    void Promise.resolve(write(withLatency, input.endpoint, stack)).catch(() => {});
  } catch (e) {
    // 로깅 실패가 새 500을 만들지 않는다.
    console.warn('[admin] logAdminFailure failed', e);
  }
}

/** 테스트 전용 — 프로세스 억제 상태를 비운다. */
export function __resetAdminFailureDedupeForTest(): void {
  seenFailures.clear();
}
