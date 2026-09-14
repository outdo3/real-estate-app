// COMMUNITY_IMAGE_UPLOAD_V1 — 업로드 영수증(서명 토큰).
//
// 업로드 API가 바이트를 검증·저장한 뒤 "이 사용자가 이 경로에 이 크기/형식의 이미지를 올렸다"를
// HMAC으로 서명해 돌려준다. 게시글 생성 API는 클라이언트가 보낸 경로·가로·세로를 믿지 않고 이 서명만
// 검증한다(Storage에서 이미지를 다시 내려받지 않아도 된다). 키는 호출부가 주입한다(서버 전용).
import { createHmac, timingSafeEqual } from 'crypto';
import type { StoredImageMimeType } from './image-rules';

export const UPLOAD_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export interface UploadReceipt {
  userId: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: StoredImageMimeType;
  /** 만료 시각(ms). */
  exp: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** 비밀값에서 용도 전용 키를 파생한다(같은 비밀을 다른 용도 서명과 섞지 않기 위함). */
export function deriveUploadTokenKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('e-jip:community-image-upload-token:v1').digest();
}

export function signUploadReceipt(receipt: UploadReceipt, key: Buffer): string {
  const body = b64url(Buffer.from(JSON.stringify({ v: 1, ...receipt })));
  const sig = b64url(createHmac('sha256', key).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUploadReceipt(token: unknown, key: Buffer, now: number): UploadReceipt | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', key).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (parsed.v !== 1) return null;
  const { userId, path, width, height, bytes, mimeType, exp } = parsed;
  if (typeof userId !== 'string' || typeof path !== 'string') return null;
  if (![width, height, bytes, exp].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (mimeType !== 'image/webp' && mimeType !== 'image/jpeg') return null;
  if ((exp as number) < now) return null;
  return { userId, path, width: width as number, height: height as number, bytes: bytes as number, mimeType, exp: exp as number };
}
