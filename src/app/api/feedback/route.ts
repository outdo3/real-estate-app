import { after, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { siteConfig } from '@/config/site';
import { createInMemoryRequestLimiter } from '@/lib/community/image-upload-rate-limit';
import { sendFeedbackEmail } from '@/lib/feedback/feedback-email';
import { deriveFeedbackHashKey, extractClientIp, hashRequesterIp } from '@/lib/feedback/ip-hash';
import { prismaFeedbackRepo, prismaMasterLookup } from '@/lib/feedback/feedback-repo-prisma';
import { submitFeedback } from '@/lib/feedback/feedback-service';
import { FEEDBACK_COPY } from '@/lib/feedback/feedback-rules';

// USER_FEEDBACK_V1 — 사용자 의견 제출(비로그인 허용). docs/development/USER_FEEDBACK_V1.md
// DB 저장이 성공하면 201을 돌려주고, 운영자 메일은 응답 뒤(after) best-effort로 보낸다.
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// 인스턴스 로컬 보조 가드 — 기준 한도는 DB(10분 5건). 식별값이 없는 익명 요청은 한 버킷을 공유하므로 넉넉하게.
const identifiedLimiter = createInMemoryRequestLimiter({ windowMs: 10 * MINUTE_MS, max: 10, maxKeys: 5000 });
const unknownLimiter = createInMemoryRequestLimiter({ windowMs: 10 * MINUTE_MS, max: 30, maxKeys: 1 });
const localGuard = {
  hit: (key: string, nowMs: number) => (key === 'feedback:anonymous-unknown' ? unknownLimiter : identifiedLimiter).hit(key, nowMs),
  size: () => identifiedLimiter.size() + unknownLimiter.size(),
};

const BODY_MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > BODY_MAX_BYTES) {
      return NextResponse.json({ success: false, error: FEEDBACK_COPY.tooLong, code: 'MESSAGE_TOO_LONG' }, { status: 400 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: FEEDBACK_COPY.failure, code: 'INVALID_BODY' }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const user = await getCurrentUser();
    userId = typeof user?.id === 'string' ? user.id : null;
  } catch {
    userId = null; // 세션 확인 실패는 비로그인 제출로 처리(로그인 강제 없음)
  }

  const now = new Date();
  // 로그인 사용자는 userId로 한도를 센다 — IP는 해시조차 만들 필요가 없다.
  const ipHash = userId ? null : hashRequesterIp(extractClientIp(request.headers), deriveFeedbackHashKey({ FEEDBACK_HASH_SECRET: process.env.FEEDBACK_HASH_SECRET, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET }), now);

  const result = await submitFeedback(
    { body, userId, ipHash, userAgent: request.headers.get('user-agent') },
    {
      repo: prismaFeedbackRepo,
      masters: prismaMasterLookup,
      localGuard,
      now: () => new Date(),
      schedule: (task) => after(task),
      notify: (email) =>
        sendFeedbackEmail(email, {
          RESEND_API_KEY: process.env.RESEND_API_KEY,
          FEEDBACK_NOTIFICATION_EMAIL: process.env.FEEDBACK_NOTIFICATION_EMAIL,
          FEEDBACK_EMAIL_FROM: process.env.FEEDBACK_EMAIL_FROM,
        }),
      siteUrl: siteConfig.url,
      log: (message) => console.warn(message),
    }
  );
  return NextResponse.json(result.body, { status: result.status });
}
