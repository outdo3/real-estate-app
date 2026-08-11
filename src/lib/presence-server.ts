import { prisma } from '@/lib/prisma';

// "지금 접속 중"의 기준 — 이 시간 안에 하트비트(또는 조회 로그)가 없었으면 접속 중이
// 아닌 것으로 간주한다. 클라이언트가 정확히 30초 간격으로 핑을 보내므로 30초로 두면
// 네트워크 지연만으로도 경계에서 깜빡일 수 있어 약간의 여유(45초)를 둔다.
export const ONLINE_WINDOW_MS = 45 * 1000;

// aptName/url/userId는 세 가지 상태를 구분한다: 필드 자체가 undefined면 "이번 호출은
// 이 값에 대해 할 말이 없다"(update 시 건드리지 않음), null이면 "명시적으로 비운다"
// (예: 상세페이지를 벗어나 currentAptName을 지운다), 문자열이면 그 값으로 갱신.
export async function upsertActiveSession(params: {
  sessionId: string;
  url?: string | null;
  aptName?: string | null;
  userId?: string | null;
}) {
  const { sessionId } = params;
  if (!sessionId) return;
  const hasUrl = 'url' in params;
  const hasApt = 'aptName' in params;
  const hasUser = 'userId' in params;

  await prisma.activeSession.upsert({
    where: { sessionId },
    create: {
      sessionId,
      currentUrl: params.url ?? null,
      currentAptName: params.aptName ?? null,
      userId: params.userId ?? null,
    },
    update: {
      currentUrl: hasUrl ? params.url : undefined,
      currentAptName: hasApt ? params.aptName : undefined,
      userId: hasUser ? params.userId : undefined,
      lastSeenAt: new Date(),
    },
  });
}

export function onlineSinceThreshold(): Date {
  return new Date(Date.now() - ONLINE_WINDOW_MS);
}
