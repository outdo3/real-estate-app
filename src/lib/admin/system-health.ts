// ADMIN_SYSTEM_HEALTH_V1 — 관리자용 "운영 상태 요약"의 순수 로직.
//
// ── 이 파일이 존재하는 이유 ──────────────────────────────────────────────────
// ErrorLog 테이블에는 severity도 type도 없다. 컬럼은 source / message / stack /
// url / createdAt 다섯 개뿐이고, 운영자가 실제로 알고 싶은 것(어느 지역이, 몇 개월 중
// 몇 개월 실패했고, 왜)은 전부 message 문자열 안에 들어 있다. 그래서 failed=1과
// failed=45가 관리자 화면에서 똑같은 "SERVER" 한 줄로 보였다.
//
// 이 파일은 그 문자열을 **읽는 시점에** 구조화하고 중요도를 매긴다. schema를 바꾸지
// 않는 이유는 단순히 승인이 필요해서가 아니라, 이미 쌓인 로그에는 새 컬럼을 채울
// 방법이 없기 때문이다 — 과거 로그까지 즉시 요약 가능한 쪽은 read-time 파싱이다.
//
// ── 하지 않는 일 ────────────────────────────────────────────────────────────
// 데이터/API 응답 semantics를 바꾸지 않는다. 여기서 매기는 severity는 **관리자 화면
// 표시 전용**이며, 어떤 사용자 응답에도 흘러가지 않는다. 로그를 새로 수집하지도
// 않는다 — 이미 ErrorLog에 들어온 것만 읽는다.
//
// ADMIN_OPS_V1.1(admin-ops-evidence.ts)과 같은 구조를 따른다: 판정은 여기서 순수
// 함수로 하고 테스트하며, route는 I/O 조립만 한다.

/**
 * 개별 로그 항목의 운영 중요도.
 *
 * **왜 OverallStatusCode(HEALTHY/WARNING/CRITICAL/UNKNOWN)를 그대로 쓰지 않는가**:
 * 그 타입은 admin-ops-evidence.ts에서 "시스템 전체가 지금 어떤 상태인가"를 나타낸다.
 * 여기는 "이 로그 한 줄이 얼마나 급한가"로 개념이 다르고, 필요한 눈금도 4단계로
 * 다르다(2/60 실패와 27/60 실패를 같은 칸에 넣으면 분류의 의미가 없다).
 * 다만 **라벨 어휘와 pill 배색은 재사용한다** — 운영자가 /admin/ops와 /admin/system을
 * 오갈 때 같은 색이 같은 뜻이어야 한다.
 */
export type LogSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const SEVERITY_LABELS: Record<LogSeverity, string> = {
  LOW: '정상',
  MEDIUM: '확인 필요',
  HIGH: '위험',
  CRITICAL: '문제',
};

/** severity 정렬용 — 높을수록 급하다. */
export const SEVERITY_RANK: Record<LogSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * 로그의 종류. **실제로 ErrorLog에 들어오는 것만** 둔다.
 *
 * AUTH(OAuth 콜백 실패)와 CRON/SYNC 실패는 현재 console 출력만 있고 ErrorLog에
 * 저장되지 않는다(각 cron route의 `console.error`). 그래서 여기에 'AUTH' 같은 칸을
 * 만들지 않는다 — 수집하지 않는 종류에 필터를 달면 "AUTH 오류 0건"이 "인증은
 * 멀쩡하다"로 읽히는 false empty가 된다. 화면에서는 대신 "이 source가 무엇을 담지
 * 않는지"를 명시한다.
 */
export type LogKind = 'MOLIT' | 'SERVER' | 'CLIENT';

export const KIND_LABELS: Record<LogKind, string> = {
  MOLIT: 'MOLIT 부분 실패',
  SERVER: '서버 오류',
  CLIENT: '클라이언트 오류',
};

export interface RawErrorLogRow {
  id: number;
  source: string;
  message: string;
  url: string | null;
  createdAt: Date | string;
}

/** MOLIT_PARTIAL 한 줄에서 뽑아낸 구조. 없는 값은 지어내지 않고 null로 둔다. */
export interface MolitPartialFields {
  /** 'apt' | 'rent' 등 원문 그대로. */
  type: string | null;
  lawdCd: string | null;
  /** 원문의 `dong=-`는 "동 지정 없음"이므로 null로 읽는다. */
  dong: string | null;
  /** 요청한 조회 창(개월). */
  period: number | null;
  monthsRequested: number | null;
  monthsSucceeded: number | null;
  failedCount: number | null;
  failedMonths: string[];
  /** 원문에 `+N` 꼬리표가 있으면 그만큼 더 있다는 뜻 — 목록은 잘려 있다. */
  failedMonthsTruncated: number;
  reason: string | null;
}

export interface ParsedLogEntry {
  id: number;
  kind: LogKind;
  severity: LogSeverity;
  /** 사람이 읽는 한 줄 요약. */
  summary: string;
  /** 지역 표시용(MOLIT만). 없으면 null. */
  regionLabel: string | null;
  route: string | null;
  occurredAt: string;
  molit: MolitPartialFields | null;
  /** 실패 비율(0~1). 계산 근거가 없으면 null — 0으로 눕히지 않는다. */
  failureRatio: number | null;
  /** 비밀값을 지운 원문. 상세 보기에서 노출한다. */
  rawMessage: string;
  /** 같은 사실을 묶는 키. 반복 오류 집계에 쓴다. */
  signature: string;
}

// ── 1. 비밀값 제거 ──────────────────────────────────────────────────────────

/**
 * 관리자 화면에 **표시하기 직전** 비밀값을 지운다.
 *
 * 저장 시점에도 일부 마스킹이 있지만(log-server-error.ts의 connection string,
 * api-molit.ts의 serviceKey), 그건 "그 경로로 들어온 것"만 막는다. 관리자 화면은
 * 테이블에 이미 쌓여 있는 **모든** 과거 로그를 보여주므로, 표시 경로에서 한 번 더
 * 막는다. 관리자라도 토큰 원문을 볼 이유는 없다.
 *
 * 순서가 중요하다: 넓은 패턴(URL 전체)을 먼저 지우면 그 안의 토큰을 따로 못 지운
 * 것처럼 보이므로, 좁고 확실한 것부터 지운다.
 */
export function redactForAdminDisplay(input: string): string {
  if (!input) return '';
  let out = input;

  // 키/토큰류 — key=value 형태. 값에 공백이 없다고 가정하지 않고 구분자까지만 먹는다.
  out = out.replace(
    /\b(serviceKey|service_key|access_token|accessToken|refresh_token|refreshToken|id_token|idToken|client_secret|clientSecret|api_key|apiKey|apikey|password|passwd|pwd|secret|token|session_token|sessionToken)\b\s*[=:]\s*("[^"]*"|'[^']*'|[^&\s,;)"']+)/gi,
    (_m, key: string) => `${key}=[redacted]`
  );

  // Authorization 헤더 / Bearer 토큰.
  //
  // 값에는 **스킴이 앞에 붙는다**("Bearer eyJ..."). `\S+` 하나만 먹으면 "Bearer"까지만
  // 지우고 토큰 본체가 그대로 남는다 — 테스트가 잡아낸 실제 누출이었다. 그래서
  // 선택적 스킴 한 낱말까지 함께 먹는다.
  out = out.replace(/\bauthorization\b\s*[=:]\s*(?:[A-Za-z]+\s+)?\S+/gi, 'authorization=[redacted]');
  // authorization 접두사 없이 맨몸으로 나온 Bearer 토큰.
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');

  // 쿠키 전체.
  out = out.replace(/\b(set-cookie|cookie)\b\s*[=:]\s*[^\n]+/gi, (_m, key: string) => `${key}=[redacted]`);

  // JWT 모양(eyJ로 시작하는 3파트). 위 규칙에 안 걸린 맨몸 토큰을 잡는다.
  out = out.replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]');

  // DB connection string.
  out = out.replace(/\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/gi, '[redacted-connection-string]');

  // 남은 URL의 query string — 키 이름을 모르는 비밀값이 섞여 있을 수 있다.
  out = out.replace(/(https?:\/\/[^\s?]+)\?\S*/gi, '$1?[redacted-query]');

  // 이메일 — 운영에 필요한 건 "이메일이 있었다"지 주소 자체가 아니다.
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[redacted-email]');

  // 한국 휴대폰 번호.
  out = out.replace(/\b01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[redacted-phone]');

  return out;
}

// ── 2. MOLIT_PARTIAL 파싱 ───────────────────────────────────────────────────

const MOLIT_PARTIAL_PREFIX = '[MOLIT_PARTIAL]';

function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** `key=value` 한 쌍을 꺼낸다. 값은 다음 공백까지 — reason만 예외로 따로 다룬다. */
function readField(message: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}=(\\S*)`).exec(message);
  return m ? m[1] : undefined;
}

/**
 * `[MOLIT_PARTIAL] ... reason=...` 한 줄을 구조화한다.
 *
 * `reason`은 **마지막 필드이며 공백과 `=`를 포함**한다("OpenAPI Error: 초당 서비스
 * 요청제한 횟수 초과 에러"). 그래서 다른 필드처럼 공백까지 자르면 안 되고,
 * `reason=` 뒤 전부를 가져온다.
 */
export function parseMolitPartial(message: string): MolitPartialFields | null {
  if (!message.includes(MOLIT_PARTIAL_PREFIX)) return null;

  const rawFailedMonths = readField(message, 'failedMonths') ?? '';
  // `202401,202402+15` — `+15`는 "표시 안 된 게 15개 더 있다"는 뜻이다.
  const overflowMatch = /\+(\d+)$/.exec(rawFailedMonths);
  const truncated = overflowMatch ? Number.parseInt(overflowMatch[1], 10) : 0;
  const monthsList = rawFailedMonths
    .replace(/\+\d+$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{6}$/.test(s));

  const reasonMatch = /\breason=([\s\S]*)$/.exec(message);
  const reason = reasonMatch ? reasonMatch[1].trim() : null;

  const dongRaw = readField(message, 'dong');
  // 로그는 동이 없을 때 `dong=-`를 쓴다. 그 `-`를 동 이름으로 표시하지 않는다.
  const dong = !dongRaw || dongRaw === '-' ? null : dongRaw;

  return {
    type: readField(message, 'type') ?? null,
    lawdCd: readField(message, 'lawdCd') ?? null,
    dong,
    period: parseIntOrNull(readField(message, 'period')),
    monthsRequested: parseIntOrNull(readField(message, 'months')),
    monthsSucceeded: parseIntOrNull(readField(message, 'ok')),
    failedCount: parseIntOrNull(readField(message, 'failed')),
    failedMonths: monthsList,
    failedMonthsTruncated: Number.isFinite(truncated) ? truncated : 0,
    reason: reason && reason.length > 0 ? reason : null,
  };
}

// ── 3. severity 판정 ────────────────────────────────────────────────────────

/**
 * MOLIT 부분 실패의 중요도 — 실패 **비율**로 정한다.
 *
 * 절대 건수가 아니라 비율인 이유: 120개월 요청에서 2개월 실패와 3개월 요청에서
 * 2개월 실패는 운영상 전혀 다른 사건이다.
 *
 *   failed == 0            LOW       (부분 실패가 아니다)
 *   ratio  <  0.2          MEDIUM
 *   0.2 <= ratio < 0.5     HIGH
 *   ratio >= 0.5           CRITICAL
 *
 * 분모를 알 수 없으면(months 누락/0) 비율을 지어내지 않고 MEDIUM으로 둔다 —
 * "모른다"를 "괜찮다(LOW)"로 접지 않는다.
 */
export function classifyMolitSeverity(fields: MolitPartialFields): { severity: LogSeverity; ratio: number | null } {
  const months = fields.monthsRequested;
  const failed = fields.failedCount;

  if (failed === 0) return { severity: 'LOW', ratio: 0 };
  if (failed === null || months === null || months <= 0) return { severity: 'MEDIUM', ratio: null };

  const ratio = failed / months;
  if (ratio >= 0.5) return { severity: 'CRITICAL', ratio };
  if (ratio >= 0.2) return { severity: 'HIGH', ratio };
  return { severity: 'MEDIUM', ratio };
}

/**
 * MOLIT이 아닌 로그의 중요도.
 *
 * 비율이라는 개념이 없으므로 오류 종류로 가른다. buildErrorLogMessage가 이미
 * `[route][Kind]`를 붙여 두었으므로 그 Kind를 읽는다.
 *
 *   DB 연결 실패 / 엔진 panic   CRITICAL  (그 라우트가 통째로 죽는다)
 *   그 외 서버 라우트 예외       HIGH      (요청 하나가 5xx로 끝났다)
 *   클라이언트 오류              MEDIUM
 */
export function classifyNonMolitSeverity(kind: LogKind, message: string): LogSeverity {
  if (kind === 'CLIENT') return 'MEDIUM';
  if (/PrismaClientInitializationError|PrismaClientRustPanicError/.test(message)) return 'CRITICAL';
  return 'HIGH';
}

// ── 4. 한 줄 파싱 ───────────────────────────────────────────────────────────

/** `[GET /api/presales][PrismaClientKnownRequestError:P2024] ...` 에서 route와 kind를 뺀다. */
function parseServerEnvelope(message: string): { route: string | null; errorKind: string | null } {
  const m = /^\[([^\]]+)\]\[([^\]]+)\]/.exec(message);
  if (!m) return { route: null, errorKind: null };
  return { route: m[1], errorKind: m[2] };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** 지역 코드/동을 운영자가 읽는 라벨로. 이름을 모르면 코드를 그대로 둔다(지어내지 않는다). */
function buildRegionLabel(fields: MolitPartialFields): string | null {
  if (!fields.lawdCd && !fields.dong) return null;
  if (fields.lawdCd && fields.dong) return `${fields.lawdCd} ${fields.dong}`;
  return fields.lawdCd ?? fields.dong;
}

const MOLIT_TYPE_LABELS: Record<string, string> = {
  apt: '아파트 매매',
  rent: '아파트 전월세',
};

export function parseErrorLogEntry(row: RawErrorLogRow): ParsedLogEntry {
  const safeMessage = redactForAdminDisplay(row.message ?? '');
  const occurredAt = toIso(row.createdAt);
  const molit = parseMolitPartial(safeMessage);

  if (molit) {
    const { severity, ratio } = classifyMolitSeverity(molit);
    const typeLabel = (molit.type && MOLIT_TYPE_LABELS[molit.type]) || molit.type || '알 수 없는 유형';
    const regionLabel = buildRegionLabel(molit);
    const months = molit.monthsRequested;
    const ok = molit.monthsSucceeded;
    const failed = molit.failedCount;

    const countPart =
      months !== null && ok !== null && failed !== null
        ? `${months}개월 중 ${ok}개월 성공 / ${failed}개월 실패`
        : '성공·실패 개월 수를 읽지 못함';

    const summary = [regionLabel, typeLabel, countPart].filter(Boolean).join(' · ');

    return {
      id: row.id,
      kind: 'MOLIT',
      severity,
      summary,
      regionLabel,
      route: row.url ?? null,
      occurredAt,
      molit,
      failureRatio: ratio,
      rawMessage: safeMessage,
      // 같은 (유형, 지역, 사유)를 한 건으로 묶는다. 실패 개월 수는 매번 달라지므로
      // signature에 넣지 않는다 — 넣으면 같은 장애가 매번 새 항목이 된다.
      signature: `MOLIT|${molit.type ?? '-'}|${molit.lawdCd ?? '-'}|${normalizeReason(molit.reason)}`,
    };
  }

  const kind: LogKind = row.source === 'client' ? 'CLIENT' : 'SERVER';
  const { route, errorKind } = parseServerEnvelope(safeMessage);
  const severity = classifyNonMolitSeverity(kind, safeMessage);
  const body = safeMessage.replace(/^\[[^\]]+\]\[[^\]]+\]\s*/, '').trim();

  return {
    id: row.id,
    kind,
    severity,
    summary: body.length > 0 ? body.slice(0, 200) : safeMessage.slice(0, 200),
    regionLabel: null,
    route: route ?? row.url ?? null,
    occurredAt,
    molit: null,
    failureRatio: null,
    rawMessage: safeMessage,
    signature: `${kind}|${route ?? row.url ?? '-'}|${errorKind ?? normalizeReason(body)}`,
  };
}

/** 사유 문자열에서 매번 달라지는 부분(숫자/시각)을 지워 같은 장애를 한 건으로 묶는다. */
function normalizeReason(reason: string | null): string {
  if (!reason) return '-';
  return reason
    .replace(/\d+/g, '#')
    .slice(0, 80)
    .trim();
}

// ── 5. 요약 ────────────────────────────────────────────────────────────────

export interface RepeatedError {
  signature: string;
  kind: LogKind;
  /** **기록된** 건수. 실제 발생 횟수가 아니다(§throttle 주석 참고). */
  loggedCount: number;
  latestAt: string;
  /** 이 묶음에서 가장 나쁜 실패 비율. MOLIT이 아니면 null. */
  worstFailureRatio: number | null;
  worstSeverity: LogSeverity;
  sampleSummary: string;
}

export interface SystemHealthSummary {
  /** 조회 창 안에서 파싱된 전체 항목. */
  entries: ParsedLogEntry[];
  cards: {
    totalInWindow: number;
    molitPartial: number;
    highRisk: number;
    latestAt: string | null;
  };
  repeated: RepeatedError[];
  /** 데이터 불완전 경고 — 관리자 화면 전용 문구의 재료. */
  incompleteness: {
    anyFailure: boolean;
    likelyIncomplete: boolean;
    worstRatio: number | null;
  };
}

export const HIGH_RISK_SEVERITIES: LogSeverity[] = ['HIGH', 'CRITICAL'];

/** 실패 비율이 이 값 이상이면 "데이터 불완전 가능성 높음". */
export const LIKELY_INCOMPLETE_RATIO = 0.2;

/**
 * 파싱된 항목들을 관리자 카드/표/반복집계로 접는다.
 *
 * 새 집계 테이블을 만들지 않는다 — 조회해 온 목록 안에서만 계산한다. 그래서 여기서
 * 나오는 "N회"는 **조회 창 안에서 기록된 횟수**이고, 화면도 그렇게 표기해야 한다.
 */
export function summarizeSystemHealth(rows: RawErrorLogRow[]): SystemHealthSummary {
  const entries = rows.map(parseErrorLogEntry);

  const molitPartial = entries.filter((e) => e.kind === 'MOLIT').length;
  const highRisk = entries.filter((e) => HIGH_RISK_SEVERITIES.includes(e.severity)).length;
  const latestAt = entries.reduce<string | null>(
    (acc, e) => (acc === null || e.occurredAt > acc ? e.occurredAt : acc),
    null
  );

  const groups = new Map<string, RepeatedError>();
  for (const e of entries) {
    const existing = groups.get(e.signature);
    if (!existing) {
      groups.set(e.signature, {
        signature: e.signature,
        kind: e.kind,
        loggedCount: 1,
        latestAt: e.occurredAt,
        worstFailureRatio: e.failureRatio,
        worstSeverity: e.severity,
        sampleSummary: e.summary,
      });
      continue;
    }
    existing.loggedCount += 1;
    if (e.occurredAt > existing.latestAt) {
      existing.latestAt = e.occurredAt;
      existing.sampleSummary = e.summary;
    }
    if (e.failureRatio !== null && (existing.worstFailureRatio === null || e.failureRatio > existing.worstFailureRatio)) {
      existing.worstFailureRatio = e.failureRatio;
    }
    if (SEVERITY_RANK[e.severity] > SEVERITY_RANK[existing.worstSeverity]) {
      existing.worstSeverity = e.severity;
    }
  }

  const repeated = Array.from(groups.values())
    .filter((g) => g.loggedCount > 1)
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[b.worstSeverity] - SEVERITY_RANK[a.worstSeverity];
      if (bySeverity !== 0) return bySeverity;
      return b.loggedCount - a.loggedCount;
    });

  const ratios = entries.map((e) => e.failureRatio).filter((r): r is number => r !== null && r > 0);
  const worstRatio = ratios.length > 0 ? Math.max(...ratios) : null;

  return {
    entries,
    cards: {
      totalInWindow: entries.length,
      molitPartial,
      highRisk,
      latestAt,
    },
    repeated,
    incompleteness: {
      anyFailure: ratios.length > 0,
      likelyIncomplete: worstRatio !== null && worstRatio >= LIKELY_INCOMPLETE_RATIO,
      worstRatio,
    },
  };
}

// ── 6. 조회 창 ─────────────────────────────────────────────────────────────

export type HealthWindow = '1h' | '24h' | '7d';

export const WINDOW_LABELS: Record<HealthWindow, string> = {
  '1h': '최근 1시간',
  '24h': '최근 24시간',
  '7d': '최근 7일',
};

const WINDOW_MS: Record<HealthWindow, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export function isHealthWindow(value: unknown): value is HealthWindow {
  return value === '1h' || value === '24h' || value === '7d';
}

/** 조회 창의 시작 시각. 알 수 없는 값은 24h로 떨어진다(기본 운영 창). */
export function windowStart(window: HealthWindow, now: Date): Date {
  return new Date(now.getTime() - WINDOW_MS[window]);
}
