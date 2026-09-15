// USER_FEEDBACK_V1 — 새 의견 운영자 알림 메일(Resend HTTPS API, npm 패키지 없이 fetch).
//
// 원칙
//  - DB 저장이 끝난 뒤에만 호출된다(호출부가 보장). 이 함수의 실패는 제출 결과를 바꾸지 않는다.
//  - 메일에는 유형·내용·발생 화면(path)·확인된 단지·접수 시각·관리자 링크만 넣는다.
//    이메일·user id·user agent·ipHash·쿼리는 넣지 않는다(로그인 여부만).
//  - 환경변수 값(API 키·주소)은 반환·로그하지 않는다. 실패 사유는 고정 코드로만 돌려준다.
import { FEEDBACK_CATEGORY_LABELS, type FeedbackCategory } from './feedback-rules';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 8000;

export interface FeedbackEmailEnv {
  RESEND_API_KEY?: string;
  FEEDBACK_NOTIFICATION_EMAIL?: string;
  FEEDBACK_EMAIL_FROM?: string;
}

export interface FeedbackEmailRecord {
  id: string;
  category: FeedbackCategory;
  message: string;
  pagePath: string | null;
  apartmentName: string | null;
  aptSeq: string | null;
  loggedIn: boolean;
  createdAt: Date;
}

export function formatKst(date: Date): string {
  const k = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)} (KST)`;
}

export function buildFeedbackEmail(record: FeedbackEmailRecord, siteUrl: string): { subject: string; text: string } {
  const label = FEEDBACK_CATEGORY_LABELS[record.category];
  const base = siteUrl.replace(/\/+$/, '');
  const lines = [
    '새 의견이 접수되었습니다.',
    '',
    '유형:',
    label,
    '',
    '내용:',
    record.message,
    '',
    '발생 화면:',
    record.pagePath ?? '(알 수 없음)',
    '',
    '단지:',
    record.aptSeq && record.apartmentName ? `${record.apartmentName} (${record.aptSeq})` : '(없음)',
    '',
    '작성자:',
    record.loggedIn ? '로그인 사용자' : '비로그인 사용자',
    '',
    '접수 시간:',
    formatKst(record.createdAt),
    '',
    '관리자 확인:',
    `${base}/admin/feedback`,
  ];
  return { subject: `[이집 새 의견] ${label}`, text: lines.join('\n') };
}

export type FeedbackEmailResult =
  | { ok: true; providerId: string | null }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT'; httpStatus?: number };

export function isFeedbackEmailConfigured(env: FeedbackEmailEnv): boolean {
  return !!(env.RESEND_API_KEY?.trim() && env.FEEDBACK_NOTIFICATION_EMAIL?.trim() && env.FEEDBACK_EMAIL_FROM?.trim());
}

/** Resend에 1통 보낸다. 2xx 응답일 때만 ok(= notifiedAt 기록 조건). */
export async function sendFeedbackEmail(
  email: { subject: string; text: string },
  env: FeedbackEmailEnv,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackEmailResult> {
  if (!isFeedbackEmailConfigured(env)) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    const res = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.FEEDBACK_EMAIL_FROM!.trim(),
        to: [env.FEEDBACK_NOTIFICATION_EMAIL!.trim()],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'HTTP_ERROR', httpStatus: res.status };
    let providerId: string | null = null;
    try {
      const body = (await res.json()) as { id?: unknown };
      providerId = typeof body?.id === 'string' ? body.id : null;
    } catch {
      providerId = null;
    }
    return { ok: true, providerId };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  }
}
