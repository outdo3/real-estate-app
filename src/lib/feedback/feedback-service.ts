// USER_FEEDBACK_V1 — 제출·관리 흐름(의존성 주입, Prisma·Next 없음 → 단위 테스트 대상).
//
// 제출 순서(canonical):
//   입력 검증 → context 정리(경로·허용 쿼리·UA) → 단지 후보 aptSeq를 master로 정확 확인 → rate limit
//   → DB INSERT(성공 = 제출 성공) → 응답 뒤 알림 예약(best-effort, 성공했을 때만 notifiedAt)
// 알림 실패·미설정은 저장된 의견에 아무 영향도 주지 않는다.
import {
  FEEDBACK_COPY,
  FEEDBACK_RATE_LIMIT,
  candidateAptSeq,
  isFeedbackCategory,
  isFeedbackStatus,
  isWithinFeedbackRateLimit,
  nextStatusFields,
  normalizeUserAgent,
  sanitizePagePath,
  sanitizePageQuery,
  validateFeedbackInput,
  type FeedbackCategory,
  type FeedbackStatus,
} from './feedback-rules';
import { buildFeedbackEmail, type FeedbackEmailResult } from './feedback-email';
import type { RequestLimiter } from '@/lib/community/image-upload-rate-limit';

export interface FeedbackCreateData {
  category: FeedbackCategory;
  message: string;
  userId: string | null;
  pagePath: string | null;
  pageQuery: string | null;
  aptSeq: string | null;
  apartmentName: string | null;
  lawdCd: string | null;
  userAgent: string | null;
  ipHash: string | null;
}

export interface FeedbackRow extends FeedbackCreateData {
  id: string;
  status: FeedbackStatus;
  notifiedAt: Date | null;
  adminNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeedbackRepo {
  /** 같은 사용자(userId) 또는 같은 요청자(ipHash)의 since 이후 제출 수. */
  countRecent(key: { userId: string } | { ipHash: string }, since: Date): Promise<number>;
  create(data: FeedbackCreateData): Promise<Pick<FeedbackRow, 'id' | 'createdAt'>>;
  markNotified(id: string, at: Date): Promise<void>;
}

export interface MasterLookup {
  /** aptSeq가 **정확히** 일치하는 master 1건. 이름·유사 매칭 없음. */
  findByAptSeq(aptSeq: string): Promise<{ aptSeq: string; name: string; lawdCd: string | null } | null>;
}

export interface SubmitDeps {
  repo: FeedbackRepo;
  masters: MasterLookup;
  localGuard: RequestLimiter;
  now: () => Date;
  /** 응답을 막지 않고 뒤에서 실행(라우트에서는 next/server after). */
  schedule: (task: () => Promise<void>) => void;
  notify: (email: { subject: string; text: string }) => Promise<FeedbackEmailResult>;
  siteUrl: string;
  log: (message: string) => void;
}

export interface SubmitRequest {
  body: unknown;
  userId: string | null;
  ipHash: string | null;
  userAgent: string | null;
}

export type SubmitResult =
  | { status: 201; body: { success: true; id: string } }
  | { status: 400 | 429 | 500; body: { success: false; error: string; code: string } };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function submitFeedback(req: SubmitRequest, deps: SubmitDeps): Promise<SubmitResult> {
  const body = asRecord(req.body);
  const input = validateFeedbackInput({ category: body.category, message: body.message });
  if (!input.ok) {
    const error =
      input.error === 'INVALID_CATEGORY' ? FEEDBACK_COPY.categoryRequired : input.error === 'MESSAGE_TOO_SHORT' ? FEEDBACK_COPY.tooShort : FEEDBACK_COPY.tooLong;
    return { status: 400, body: { success: false, error, code: input.error } };
  }

  const now = deps.now();

  // rate limit — 공유(DB) 한도가 기준, 인스턴스 로컬은 보조. 로그인은 userId, 익명은 일별 ipHash.
  const sharedKey = req.userId ? { userId: req.userId } : req.ipHash ? { ipHash: req.ipHash } : null;
  const localKey = req.userId ? `feedback:user:${req.userId}` : req.ipHash ? `feedback:ip:${req.ipHash}` : 'feedback:anonymous-unknown';
  if (!deps.localGuard.hit(localKey, now.getTime()).allowed) {
    return { status: 429, body: { success: false, error: FEEDBACK_COPY.rateLimited, code: 'RATE_LIMITED' } };
  }
  if (sharedKey) {
    try {
      const recent = await deps.repo.countRecent(sharedKey, new Date(now.getTime() - FEEDBACK_RATE_LIMIT.windowMs));
      if (!isWithinFeedbackRateLimit(recent)) {
        return { status: 429, body: { success: false, error: FEEDBACK_COPY.rateLimited, code: 'RATE_LIMITED' } };
      }
    } catch {
      // 한도 조회 실패는 제출을 막지 않는다(fail-open). 로컬 가드는 이미 적용됐다.
      deps.log('[FEEDBACK_RATE_LIMIT_QUERY_FAILED]');
    }
  }

  // 단지 context — 후보 aptSeq가 master와 정확히 일치할 때만 저장. 실패하면 단지 정보 없이 저장한다.
  let apartment: { aptSeq: string; apartmentName: string; lawdCd: string | null } | null = null;
  const candidate = candidateAptSeq(body.aptSeq);
  if (candidate) {
    try {
      const master = await deps.masters.findByAptSeq(candidate);
      if (master && master.aptSeq === candidate) {
        apartment = { aptSeq: master.aptSeq, apartmentName: master.name, lawdCd: master.lawdCd && /^\d{5}$/.test(master.lawdCd) ? master.lawdCd : null };
      }
    } catch {
      deps.log('[FEEDBACK_APARTMENT_LOOKUP_FAILED]');
    }
  }

  const data: FeedbackCreateData = {
    category: input.category,
    message: input.message,
    userId: req.userId,
    pagePath: sanitizePagePath(body.pagePath),
    pageQuery: sanitizePageQuery(body.pageQuery),
    aptSeq: apartment?.aptSeq ?? null,
    apartmentName: apartment?.apartmentName ?? null,
    lawdCd: apartment?.lawdCd ?? null,
    userAgent: normalizeUserAgent(req.userAgent),
    ipHash: req.ipHash,
  };

  let created: Pick<FeedbackRow, 'id' | 'createdAt'>;
  try {
    created = await deps.repo.create(data);
  } catch {
    deps.log('[FEEDBACK_INSERT_FAILED]');
    return { status: 500, body: { success: false, error: FEEDBACK_COPY.failure, code: 'SAVE_FAILED' } };
  }

  // 저장 성공 이후 — 알림은 응답을 막지 않고, 실패해도 저장·응답에 영향 없음.
  deps.schedule(async () => {
    try {
      const email = buildFeedbackEmail(
        {
          id: created.id,
          category: data.category,
          message: data.message,
          pagePath: data.pagePath,
          apartmentName: data.apartmentName,
          aptSeq: data.aptSeq,
          loggedIn: !!data.userId,
          createdAt: created.createdAt,
        },
        deps.siteUrl
      );
      const result = await deps.notify(email);
      if (result.ok) {
        await deps.repo.markNotified(created.id, deps.now());
      } else {
        deps.log(`[FEEDBACK_NOTIFY_FAILED] id=${created.id} reason=${result.reason}${result.ok === false && result.httpStatus ? ` status=${result.httpStatus}` : ''}`);
      }
    } catch {
      deps.log(`[FEEDBACK_NOTIFY_FAILED] id=${created.id} reason=EXCEPTION`);
    }
  });

  return { status: 201, body: { success: true, id: created.id } };
}

// ── 관리자 ───────────────────────────────────────────────────────────────────

export interface AdminListFilters {
  status: FeedbackStatus | null;
  category: FeedbackCategory | null;
  page: number;
}

export const ADMIN_PAGE_SIZE = 30;

export function parseAdminListFilters(params: URLSearchParams): AdminListFilters {
  const status = params.get('status');
  const category = params.get('category');
  const page = Math.max(1, Math.min(10000, parseInt(params.get('page') || '1', 10) || 1));
  return { status: isFeedbackStatus(status) ? status : null, category: isFeedbackCategory(category) ? category : null, page };
}

export interface AdminFeedbackRepo {
  list(filters: AdminListFilters, take: number, skip: number): Promise<{ rows: FeedbackRow[]; total: number }>;
  findStatus(id: string): Promise<{ status: string; resolvedAt: Date | null } | null>;
  update(id: string, data: { status: FeedbackStatus; resolvedAt: Date | null; adminNote?: string | null }): Promise<FeedbackRow>;
}

export const ADMIN_NOTE_MAX = 2000;

/** 관리자 목록에 내보낼 필드. ipHash는 운영 판단에 필요 없어 내보내지 않는다. */
export function toAdminFeedbackItem(row: FeedbackRow) {
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    message: row.message,
    loggedIn: !!row.userId,
    pagePath: row.pagePath,
    pageQuery: row.pageQuery,
    aptSeq: row.aptSeq,
    apartmentName: row.apartmentName,
    lawdCd: row.lawdCd,
    userAgent: row.userAgent,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    adminNote: row.adminNote,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateFeedbackStatus(
  id: string,
  body: unknown,
  repo: AdminFeedbackRepo,
  now: Date
): Promise<{ status: 200 | 400 | 404; body: Record<string, unknown> }> {
  const b = asRecord(body);
  if (!isFeedbackStatus(b.status)) return { status: 400, body: { success: false, error: '상태 값이 올바르지 않습니다.' } };
  let adminNote: string | null | undefined;
  if (b.adminNote !== undefined) {
    if (b.adminNote !== null && typeof b.adminNote !== 'string') return { status: 400, body: { success: false, error: '메모 형식이 올바르지 않습니다.' } };
    const note = typeof b.adminNote === 'string' ? b.adminNote.trim() : '';
    if (note.length > ADMIN_NOTE_MAX) return { status: 400, body: { success: false, error: '메모가 너무 깁니다.' } };
    adminNote = note || null;
  }
  const current = await repo.findStatus(id);
  if (!current || !isFeedbackStatus(current.status)) return { status: 404, body: { success: false, error: '의견을 찾을 수 없습니다.' } };
  const fields = nextStatusFields({ status: current.status, resolvedAt: current.resolvedAt }, b.status, now);
  const row = await repo.update(id, adminNote === undefined ? fields : { ...fields, adminNote });
  return { status: 200, body: { success: true, data: toAdminFeedbackItem(row) } };
}
