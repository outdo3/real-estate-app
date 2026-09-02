// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §19-21 — redact obvious PII patterns from raw
// AI-search free-text queries before storage. Order matters: normalize → redact → truncate,
// so the length limit can never slice a PII pattern in half and leave a fragment exposed at
// the boundary. Amounts/apartment names are intentionally never redacted — they are not PII
// and are the whole point of a real-estate search log (§52).
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// 010-1234-5678 / 01012345678 / 051-123-4567 / 02-1234-5678 등: 0 + 1~2자리 + 구분자? + 3~4자리 + 구분자? + 4자리
const PHONE_PATTERN = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;

export function redactSearchQuery(raw: string, maxLength: number): string {
  const normalized = raw.trim();
  const redacted = normalized.replace(EMAIL_PATTERN, '[이메일]').replace(PHONE_PATTERN, '[전화번호]');
  return redacted.slice(0, maxLength);
}
