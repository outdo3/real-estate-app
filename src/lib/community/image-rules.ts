// COMMUNITY_IMAGE_UPLOAD_V1 — 게시글 사진의 **순수 규칙** (클라이언트·서버 공용).
//
// 네트워크/DB/브라우저 API를 만지지 않는다. 한도 값, 형식 판별(매직 바이트 + 헤더의 가로·세로),
// EXIF 존재 여부, 저장 경로 생성/검증이 전부 여기 한 곳에 있다 — 클라이언트 사전 검사와 서버 검증이
// 같은 규칙을 쓰게 하기 위함이다(MIME 헤더나 파일 확장자는 어디서도 신뢰하지 않는다).

export const COMMUNITY_IMAGE_BUCKET = 'community-images';

export const MAX_IMAGES_PER_POST = 5;

/** 사용자가 고른 원본 파일 한도. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** 디코드 전에 헤더로 막는 원본 픽셀 한도(이미지 폭탄 방지). */
export const MAX_SOURCE_PIXELS = 50_000_000;
export const MAX_SOURCE_EDGE = 12_000;

/** 저장 이미지 긴 변. */
export const STORED_MAX_EDGE = 1600;
export const WEBP_QUALITY = 0.8;
export const JPEG_QUALITY = 0.82;
export const RETRY_QUALITY = 0.7;
/** 이 크기를 넘으면 한 번 더 낮은 품질로 인코딩한다. */
export const SOFT_TARGET_BYTES = 800 * 1024;
/** 서버가 받는 최종 저장 이미지 한도. */
export const MAX_STORED_BYTES = Math.floor(1.5 * 1024 * 1024);
/** bucket 자체의 한도(서버 한도 위의 이중 방어). */
export const COMMUNITY_IMAGE_BUCKET_FILE_SIZE_LIMIT = 2 * 1024 * 1024;

export const ACCEPTED_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const STORED_IMAGE_MIME_TYPES = ['image/webp', 'image/jpeg'] as const;
export type StoredImageMimeType = (typeof STORED_IMAGE_MIME_TYPES)[number];

/** 파일 선택창에 넘기는 accept 값 — 지원한다고 말하는 형식만 적는다(HEIC 미표기). */
export const IMAGE_INPUT_ACCEPT = ACCEPTED_SOURCE_MIME_TYPES.join(',');

export const IMAGE_ERROR_MESSAGES = {
  TOO_MANY: '사진은 최대 5장까지 올릴 수 있어요.',
  TOO_LARGE: '한 장당 최대 10MB까지 올릴 수 있어요.',
  UNSUPPORTED: '지원하지 않는 이미지 형식이에요.',
  UPLOAD_FAILED: '사진 업로드에 실패했습니다. 다시 시도해주세요.',
} as const;

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface SniffedImage {
  format: ImageFormat;
  width: number;
  height: number;
  /** EXIF 블록(JPEG APP1 "Exif", WebP EXIF chunk/flag)이 있는가. 저장본에는 없어야 한다. */
  hasExif: boolean;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function sniffJpeg(b: Uint8Array): SniffedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let o = 2;
  let hasExif = false;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    let marker = b[o + 1];
    // fill bytes
    while (marker === 0xff && o + 2 < b.length) {
      o++;
      marker = b[o + 1];
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // SOF 이전에 스캔/끝 → 손상
    if (o + 4 > b.length) return null;
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > b.length) return null;
    if (marker === 0xe1 && len >= 8 && ascii(b, o + 4, 4) === 'Exif') hasExif = true;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 7) return null;
      const height = u16be(b, o + 5);
      const width = u16be(b, o + 7);
      if (!width || !height) return null;
      return { format: 'jpeg', width, height, hasExif };
    }
    o += 2 + len;
  }
  return null;
}

function sniffPng(b: Uint8Array): SniffedImage | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  if (ascii(b, 12, 4) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (!width || !height) return null;
  let hasExif = false;
  // eXIf chunk scan(원본 PNG 판별용; 저장 형식은 PNG가 아니다)
  let o = 8;
  while (o + 8 <= b.length) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    if (type === 'eXIf') hasExif = true;
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + len;
  }
  return { format: 'png', width, height, hasExif };
}

function sniffWebp(b: Uint8Array): SniffedImage | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  // RIFF 크기가 실제 바이트보다 크면 잘린 파일이다.
  if (u32le(b, 4) + 8 > b.length) return null;
  const first = ascii(b, 12, 4);
  let width = 0;
  let height = 0;
  let hasExif = false;
  if (first === 'VP8X') {
    const flags = b[20];
    if (flags & 0x08) hasExif = true;
    width = u24le(b, 24) + 1;
    height = u24le(b, 27) + 1;
    let o = 12;
    while (o + 8 <= b.length) {
      const len = u32le(b, o + 4);
      if (ascii(b, o, 4) === 'EXIF') hasExif = true;
      o += 8 + len + (len % 2);
    }
  } else if (first === 'VP8 ') {
    if (b.length < 30) return null;
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = u16le(b, 26) & 0x3fff;
    height = u16le(b, 28) & 0x3fff;
  } else if (first === 'VP8L') {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  } else {
    return null;
  }
  if (!width || !height) return null;
  return { format: 'webp', width, height, hasExif };
}

/** 매직 바이트로 형식을 판별하고 헤더에서 크기를 읽는다. 지원 형식이 아니거나 헤더가 깨졌으면 null. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffJpeg(bytes) ?? sniffPng(bytes) ?? sniffWebp(bytes);
}

export function mimeTypeOf(format: ImageFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp';
}

/** 원본(선택한 파일)을 디코드해도 되는가 — 크기 → 형식 → 픽셀 순. */
export function checkSourceImage(byteLength: number, sniffed: SniffedImage | null): { ok: true } | { ok: false; code: 'TOO_LARGE' | 'UNSUPPORTED' } {
  if (byteLength > MAX_SOURCE_BYTES) return { ok: false, code: 'TOO_LARGE' };
  if (!sniffed) return { ok: false, code: 'UNSUPPORTED' };
  const { width, height } = sniffed;
  if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) return { ok: false, code: 'UNSUPPORTED' };
  return { ok: true };
}

export type StoredImageRejection = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED' | 'DIMENSIONS' | 'EXIF';

/** 서버가 저장 직전에 적용하는 검사. 통과하면 저장할 MIME과 크기를 돌려준다. */
export function checkStoredImage(bytes: Uint8Array):
  | { ok: true; mimeType: StoredImageMimeType; ext: 'webp' | 'jpg'; width: number; height: number }
  | { ok: false; reason: StoredImageRejection } {
  if (bytes.length === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.length > MAX_STORED_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  const s = sniffImage(bytes);
  if (!s || s.format === 'png') return { ok: false, reason: 'UNSUPPORTED' };
  if (Math.max(s.width, s.height) > STORED_MAX_EDGE || Math.min(s.width, s.height) < 1) return { ok: false, reason: 'DIMENSIONS' };
  if (s.hasExif) return { ok: false, reason: 'EXIF' };
  return s.format === 'webp'
    ? { ok: true, mimeType: 'image/webp', ext: 'webp', width: s.width, height: s.height }
    : { ok: true, mimeType: 'image/jpeg', ext: 'jpg', width: s.width, height: s.height };
}

/** 긴 변을 maxEdge 이하로 비율 유지 축소한 크기(확대하지 않는다). */
export function fitWithin(width: number, height: number, maxEdge: number = STORED_MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// ── 경로 ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isSafeUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_RE.test(value);
}

/** posts/{userId}/{uploadSession}/{uuid}.{ext} — 원본 파일명·이메일·이름은 들어가지 않는다. */
export function buildImagePath(userId: string, uploadSession: string, fileUuid: string, ext: 'webp' | 'jpg'): string {
  if (!isSafeUserId(userId)) throw new Error('unsafe user id for storage path');
  if (!isUuid(uploadSession) || !isUuid(fileUuid)) throw new Error('invalid uuid for storage path');
  return `posts/${userId}/${uploadSession}/${fileUuid}.${ext}`;
}

export function sessionPrefix(userId: string, uploadSession: string): string {
  if (!isSafeUserId(userId) || !isUuid(uploadSession)) throw new Error('invalid session prefix');
  return `posts/${userId}/${uploadSession}/`;
}

const PATH_RE = /^posts\/([A-Za-z0-9_-]{1,64})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(webp|jpg)$/;

export function parseImagePath(path: unknown): { userId: string; uploadSession: string; fileUuid: string; ext: 'webp' | 'jpg' } | null {
  if (typeof path !== 'string') return null;
  const m = PATH_RE.exec(path);
  if (!m || !isUuid(m[2]) || !isUuid(m[3])) return null;
  return { userId: m[1], uploadSession: m[2], fileUuid: m[3], ext: m[4] as 'webp' | 'jpg' };
}

/** 이 경로가 현재 사용자의 것인가(서버 권한 판정용). */
export function isOwnedImagePath(path: unknown, userId: string): boolean {
  const parsed = parseImagePath(path);
  return !!parsed && parsed.userId === userId;
}
