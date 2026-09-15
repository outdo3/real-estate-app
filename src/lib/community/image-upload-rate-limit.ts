// COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1 — 게시글 사진 업로드의 사용자별 한도(판정 로직, 의존성 주입).
//
// 두 겹이다. docs/development/COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1.md
//  1) 저장된 사진 수(모든 인스턴스 공유): Supabase가 이미 기록하는 storage.objects에서 이 사용자 경로
//     (posts/{userId}/) 아래 최근 10분·24시간에 생성된 객체 수를 센다. 새 저장소·스키마·외부 서비스 없음.
//     실패한 시도를 정리(DELETE)하면 객체가 사라져 다시 올릴 수 있다 — 정상 재시도를 막지 않기 위한 의도.
//  2) 업로드 요청 수(인스턴스 로컬, best-effort): 1)의 "올리고 지우기 반복"과 잘못된 바이트 반복 전송을 줄인다.
//     Vercel 서버리스는 인스턴스가 여러 개일 수 있어 이 한도는 인스턴스마다 따로 센다(강한 보장이 아니다).
//
// 키는 항상 서버 세션의 사용자 id에서 만든다(클라이언트 입력 없음). 관리자도 예외 없이 같은 한도.
// 사용량 조회가 실패하면 업로드를 막지 않는다(fail-open) — 2)는 계속 적용되고, 원인은 로그로 남긴다.

export const IMAGE_UPLOAD_RATE_LIMIT_MESSAGE = '사진 업로드 요청이 많습니다. 잠시 후 다시 시도해 주세요.';

const MINUTE_MS = 60 * 1000;

/** 저장된 사진 기준(공유). 글 한 개 최대 5장 → 10분에 5장짜리 글 4개, 하루 20개. */
export const STORED_IMAGE_LIMITS = {
  shortWindowMs: 10 * MINUTE_MS,
  shortMax: 20,
  dayWindowMs: 24 * 60 * MINUTE_MS,
  dayMax: 100,
} as const;

/** 업로드 요청 기준(인스턴스 로컬). 10분에 5장짜리 제출 8번(실패·재시도 포함). */
export const UPLOAD_REQUEST_LIMIT = {
  windowMs: 10 * MINUTE_MS,
  max: 40,
  /** 메모리 상한 — 넘으면 만료분부터, 그래도 넘으면 가장 오래된 키부터 버린다. */
  maxKeys: 5000,
} as const;

export function imageUploadRateLimitKey(userId: string): string {
  return `community-image-upload:${userId}`;
}

export type RateLimitReason = 'REQUESTS' | 'STORED_SHORT' | 'STORED_DAY';

export type RateLimitDecision = { allowed: true } | { allowed: false; reason: RateLimitReason; retryAfterSec: number };

/** 창 안에 이미 저장된 수와, 가장 오래된 것이 창을 벗어날 때까지 남은 초(없으면 null). */
export interface StoredUploadUsage {
  shortCount: number;
  dayCount: number;
  shortOldestExpiresInSec: number | null;
  dayOldestExpiresInSec: number | null;
}

const retryAfter = (sec: number | null, fallbackMs: number) => Math.max(1, Math.ceil(sec ?? fallbackMs / 1000));

/** 이번 업로드가 (count + 1)번째가 된다. count < max일 때만 허용 → max번째까지 성공, max+1번째 429. */
export function decideStoredUploadLimit(usage: StoredUploadUsage, limits = STORED_IMAGE_LIMITS): RateLimitDecision {
  if (usage.dayCount >= limits.dayMax) {
    return { allowed: false, reason: 'STORED_DAY', retryAfterSec: retryAfter(usage.dayOldestExpiresInSec, limits.dayWindowMs) };
  }
  if (usage.shortCount >= limits.shortMax) {
    return { allowed: false, reason: 'STORED_SHORT', retryAfterSec: retryAfter(usage.shortOldestExpiresInSec, limits.shortWindowMs) };
  }
  return { allowed: true };
}

export interface RequestLimiter {
  /** 허용되면 이번 요청을 기록한다(거절된 요청은 기록하지 않는다 — 기다리면 반드시 풀린다). */
  hit(key: string, nowMs: number): RateLimitDecision;
  size(): number;
}

export function createInMemoryRequestLimiter(opts: { windowMs: number; max: number; maxKeys: number } = UPLOAD_REQUEST_LIMIT): RequestLimiter {
  const hits = new Map<string, number[]>();

  const prune = (nowMs: number) => {
    for (const [k, ts] of hits) {
      if (ts.length === 0 || ts[ts.length - 1] <= nowMs - opts.windowMs) hits.delete(k);
    }
  };

  return {
    hit(key, nowMs) {
      const cutoff = nowMs - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { allowed: false, reason: 'REQUESTS', retryAfterSec: Math.max(1, Math.ceil((recent[0] + opts.windowMs - nowMs) / 1000)) };
      }
      recent.push(nowMs);
      hits.delete(key); // 삽입 순서 갱신(가장 오래 조용한 키가 먼저 버려지게)
      hits.set(key, recent);
      if (hits.size > opts.maxKeys) {
        prune(nowMs);
        while (hits.size > opts.maxKeys) hits.delete(hits.keys().next().value as string);
      }
      return { allowed: true };
    },
    size: () => hits.size,
  };
}

export interface ImageUploadRateLimitDeps {
  requests: RequestLimiter;
  /** 서버 세션 사용자 id로만 호출된다. */
  storedUsage: (userId: string) => Promise<StoredUploadUsage>;
  now: () => number;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

/** 요청 한도(메모리) → 저장 한도(storage.objects). 사용량 조회 실패는 허용(fail-open) + 로그. */
export async function checkImageUploadRateLimit(userId: string, deps: ImageUploadRateLimitDeps): Promise<RateLimitDecision> {
  const key = imageUploadRateLimitKey(userId);
  const byRequests = deps.requests.hit(key, deps.now());
  if (!byRequests.allowed) return byRequests;
  let usage: StoredUploadUsage;
  try {
    usage = await deps.storedUsage(userId);
  } catch (error) {
    // 사용자 id·쿼리·원문 메시지는 남기지 않는다.
    deps.log('[community-images] rate limit usage unavailable', { error: (error as { name?: string })?.name ?? 'Error' });
    return { allowed: true };
  }
  return decideStoredUploadLimit(usage);
}
