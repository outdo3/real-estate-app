// REALTOR_PRO_MVP_V1 — 개인정보 필드 암호화(서버 전용). docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §7.6
//
// · AES-256-GCM(인증 암호화), 호출마다 랜덤 96-bit IV, 16바이트 인증 태그.
// · 저장 형식: `pii.v1.<keyId>.<iv b64url>.<ciphertext b64url>.<tag b64url>` — 버전·키 id를 달아 키 회전을 지원한다.
// · 키는 서버 env에서만 읽는다(값은 저장소·문서·로그에 절대 두지 않는다):
//     REALTOR_PRO_PII_KEY          현재 키(32바이트, base64 또는 hex)
//     REALTOR_PRO_PII_KEY_ID       현재 키 id(기본 'k1')
//     REALTOR_PRO_PII_KEYS_PREVIOUS  회전 전 키들 "k0:<base64>,..." (복호화 전용)
//     REALTOR_PRO_LOOKUP_PEPPER    조회용 HMAC 키(암호화 키와 분리)
//   NEXT_PUBLIC_* 로 두지 않는다 — 이 모듈은 브라우저에서 로드되면 즉시 실패한다.
// · 동등 조회(중복 연락처 탐지 등)는 평문 SHA-256이 아니라 **HMAC-SHA256(pepper)** 로 한다(사전 대입 방지).
// · 복호화 실패(키 없음·변조·형식 오류)는 조용히 빈 값으로 바꾸지 않고 `PiiCryptoError`로 드러낸다.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeEmailAddress, normalizePhoneDigits } from './rules';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/pro/crypto.ts is server-only');
}

const VERSION = 'pii.v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type PiiCryptoErrorCode = 'KEY_MISSING' | 'KEY_INVALID' | 'FORMAT' | 'UNKNOWN_KEY' | 'AUTH_FAILED';

export class PiiCryptoError extends Error {
  constructor(public readonly code: PiiCryptoErrorCode) {
    super(`pii crypto error: ${code}`); // 메시지에 키·평문·암호문을 넣지 않는다
    this.name = 'PiiCryptoError';
  }
}

export interface PiiKeyring {
  currentKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  lookupPepper: Buffer;
}

function decodeKey(raw: string): Buffer {
  const t = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== KEY_BYTES) throw new PiiCryptoError('KEY_INVALID');
  return buf;
}

/** env에서 키링을 만든다. 키가 없으면 KEY_MISSING — 호출부가 "Pro 사용 불가" 상태로 처리한다. */
export function loadPiiKeyring(env: Record<string, string | undefined>): PiiKeyring {
  const current = env.REALTOR_PRO_PII_KEY;
  const pepper = env.REALTOR_PRO_LOOKUP_PEPPER;
  if (!current || !pepper) throw new PiiCryptoError('KEY_MISSING');
  const currentKeyId = (env.REALTOR_PRO_PII_KEY_ID || 'k1').trim();
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(currentKeyId)) throw new PiiCryptoError('KEY_INVALID');
  const keys = new Map<string, Buffer>([[currentKeyId, decodeKey(current)]]);
  for (const part of (env.REALTOR_PRO_PII_KEYS_PREVIOUS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i <= 0) throw new PiiCryptoError('KEY_INVALID');
    const id = part.slice(0, i);
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id) || keys.has(id)) throw new PiiCryptoError('KEY_INVALID');
    keys.set(id, decodeKey(part.slice(i + 1)));
  }
  const pepperBuf = Buffer.from(pepper, 'utf8');
  if (pepperBuf.length < 16) throw new PiiCryptoError('KEY_INVALID');
  return { currentKeyId, keys, lookupPepper: pepperBuf };
}

const b64u = (b: Buffer) => b.toString('base64url');

/** 평문 → 버전 포함 암호문. 빈 값·null은 null(저장하지 않음). */
export function encryptField(plain: string | null | undefined, ring: PiiKeyring): string | null {
  if (plain == null || plain === '') return null;
  const key = ring.keys.get(ring.currentKeyId);
  if (!key) throw new PiiCryptoError('KEY_MISSING');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // AAD: 버전+키 id — 프리픽스를 바꿔치기한 암호문은 인증 실패
  cipher.setAAD(Buffer.from(`${VERSION}.${ring.currentKeyId}`));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${ring.currentKeyId}.${b64u(iv)}.${b64u(ct)}.${b64u(tag)}`;
}

/** 암호문 → 평문. null은 null. 형식·키·변조 문제는 PiiCryptoError. */
export function decryptField(payload: string | null | undefined, ring: PiiKeyring): string | null {
  if (payload == null || payload === '') return null;
  const parts = payload.split('.');
  if (parts.length !== 6 || `${parts[0]}.${parts[1]}` !== VERSION) throw new PiiCryptoError('FORMAT');
  const [, , keyId, ivS, ctS, tagS] = parts;
  const key = ring.keys.get(keyId);
  if (!key) throw new PiiCryptoError('UNKNOWN_KEY');
  let iv: Buffer, ct: Buffer, tag: Buffer;
  try {
    iv = Buffer.from(ivS, 'base64url');
    ct = Buffer.from(ctS, 'base64url');
    tag = Buffer.from(tagS, 'base64url');
  } catch {
    throw new PiiCryptoError('FORMAT');
  }
  if (iv.length !== IV_BYTES || tag.length !== 16) throw new PiiCryptoError('FORMAT');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`${VERSION}.${keyId}`));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new PiiCryptoError('AUTH_FAILED');
  }
}

/** 키 회전: 현재 키가 아닌 키로 암호화된 값만 재암호화한다(이미 현재 키면 그대로). */
export function reencryptIfStale(payload: string | null, ring: PiiKeyring): string | null {
  if (!payload) return payload;
  const keyId = payload.split('.')[2];
  if (keyId === ring.currentKeyId) return payload;
  return encryptField(decryptField(payload, ring), ring);
}

export function isEncryptedPayload(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${VERSION}.`) && v.split('.').length === 6;
}

// ── 정규화 + 조회 해시 ───────────────────────────────────────────────────────

export function normalizePhone(raw: string | null | undefined): string | null {
  return raw ? normalizePhoneDigits(raw) : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  return raw ? normalizeEmailAddress(raw) : null;
}

/** 정규화된 값의 HMAC-SHA256(hex). 종류 접두사로 전화·이메일 해시 공간을 분리한다. */
export function createLookupHash(kind: 'phone' | 'email', normalized: string | null, ring: PiiKeyring): string | null {
  if (!normalized) return null;
  return createHmac('sha256', ring.lookupPepper).update(`${kind}:${normalized}`).digest('hex');
}

/** 상수 시간 비교(해시 대조용). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** 전화번호 한 번에: 정규화 → 암호문 + 조회 해시. 유효하지 않으면 둘 다 null. */
export function protectPhone(raw: string | null | undefined, ring: PiiKeyring): { enc: string | null; hash: string | null } {
  const n = normalizePhone(raw);
  return { enc: encryptField(n, ring), hash: createLookupHash('phone', n, ring) };
}

export function protectEmail(raw: string | null | undefined, ring: PiiKeyring): { enc: string | null; hash: string | null } {
  const n = normalizeEmail(raw);
  return { enc: encryptField(n, ring), hash: createLookupHash('email', n, ring) };
}
