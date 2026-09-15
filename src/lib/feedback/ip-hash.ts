// USER_FEEDBACK_V1 — 익명 제출 rate limit용 요청자 식별값. 원문 IP는 어디에도 저장·로그하지 않는다.
//
// ipHash = "v1:" + HMAC-SHA256(key, "<KST 날짜>|<ip>")
//  - 날짜가 섞여 **다음 날에는 같은 IP도 다른 값**이 된다 → 10분 한도에는 충분하고 장기 추적은 불가.
//  - key: FEEDBACK_HASH_SECRET(권장) → 없으면 NEXTAUTH_SECRET에서 용도 라벨로 파생한 별도 키.
//    파생 키는 HMAC(NEXTAUTH_SECRET, 라벨)이라 결과값에서 원 비밀을 되돌릴 수 없고, 비밀 자체는 반환·출력하지 않는다.
//  - 둘 다 없으면 null → 익명 제출은 인스턴스 로컬 가드만 적용된다(저장은 막지 않음).
import { createHmac } from 'node:crypto';

const DERIVE_LABEL = 'e-jip:user-feedback:ip-hash:v1';
const IP_MAX = 64;

export function deriveFeedbackHashKey(env: { FEEDBACK_HASH_SECRET?: string; NEXTAUTH_SECRET?: string }): Buffer | null {
  const dedicated = env.FEEDBACK_HASH_SECRET?.trim();
  if (dedicated) return Buffer.from(dedicated, 'utf8');
  const nextAuth = env.NEXTAUTH_SECRET?.trim();
  if (nextAuth) return createHmac('sha256', nextAuth).update(DERIVE_LABEL).digest();
  return null;
}

/** 프록시가 붙인 첫 번째 주소(Vercel: x-forwarded-for의 맨 앞) → 없으면 x-real-ip. 형식이 이상하면 null. */
export function extractClientIp(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const candidate = (forwarded ? forwarded.split(',')[0] : headers.get('x-real-ip'))?.trim() ?? '';
  if (!candidate || candidate.length > IP_MAX || !/^[0-9a-fA-F:.]+$/.test(candidate)) return null;
  return candidate;
}

function kstDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function hashRequesterIp(ip: string | null, key: Buffer | null, now: Date): string | null {
  if (!ip || !key) return null;
  return `v1:${createHmac('sha256', key).update(`${kstDate(now)}|${ip}`).digest('hex')}`;
}
