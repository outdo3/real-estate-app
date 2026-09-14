// COMMUNITY_IMAGE_UPLOAD_V1 — 브라우저 사진 전처리(선택 → 검사 → 방향 보정 디코드 → 축소 → 재인코딩).
//
// 원본 파일은 절대 그대로 올리지 않는다. 결과는 **항상 인코더(canvas)가 새로 만든 바이트**다 — 그래서
// EXIF(GPS 포함)가 결과에 남지 않는다. 방향은 디코드 단계(`imageOrientation: 'from-image'`)에서 픽셀에
// 반영된다. 브라우저 API는 codec으로 주입받아, 규칙 전체를 DOM 없이 테스트할 수 있다.
import {
  JPEG_QUALITY,
  MAX_SOURCE_BYTES,
  MAX_STORED_BYTES,
  RETRY_QUALITY,
  SOFT_TARGET_BYTES,
  WEBP_QUALITY,
  checkSourceImage,
  fitWithin,
  sniffImage,
  type StoredImageMimeType,
} from './image-rules';

export interface DecodedImage {
  /** 방향 보정이 반영된 크기. */
  width: number;
  height: number;
  close(): void;
}

export interface ImageCodec {
  /** EXIF orientation을 반영해 디코드한다. 실패하면 throw. */
  decode(blob: Blob): Promise<DecodedImage>;
  /** 주어진 크기로 그려 인코딩한다. 브라우저가 요청 형식을 못 만들면 다른 type의 Blob을 돌려줄 수 있다. */
  encode(image: DecodedImage, width: number, height: number, mimeType: StoredImageMimeType, quality: number): Promise<Blob>;
}

export type PrepareErrorCode = 'TOO_LARGE' | 'UNSUPPORTED';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: StoredImageMimeType;
  bytes: number;
  sourceBytes: number;
}

export class PrepareImageError extends Error {
  constructor(readonly code: PrepareErrorCode) {
    super(code);
    this.name = 'PrepareImageError';
  }
}

async function encodeAs(codec: ImageCodec, image: DecodedImage, w: number, h: number, quality: { webp: number; jpeg: number }): Promise<{ blob: Blob; mimeType: StoredImageMimeType }> {
  const webp = await codec.encode(image, w, h, 'image/webp', quality.webp);
  // 추정하지 않는다: 실제로 만들어진 Blob의 type으로 판정한다(Safari 등은 WebP 인코딩 요청에 PNG를 준다).
  if (webp.type === 'image/webp') return { blob: webp, mimeType: 'image/webp' };
  const jpeg = await codec.encode(image, w, h, 'image/jpeg', quality.jpeg);
  if (jpeg.type !== 'image/jpeg') throw new PrepareImageError('UNSUPPORTED');
  return { blob: jpeg, mimeType: 'image/jpeg' };
}

export async function prepareImage(file: Blob, codec: ImageCodec, maxEdge?: number): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new PrepareImageError('TOO_LARGE');

  // 디코드 전에 헤더로 형식·픽셀 수를 본다 — 파일 MIME/확장자는 믿지 않는다(SVG/HEIC/임의 바이너리 거부).
  const head = new Uint8Array(await file.arrayBuffer());
  const source = checkSourceImage(file.size, sniffImage(head));
  if (!source.ok) throw new PrepareImageError(source.code);

  let decoded: DecodedImage;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new PrepareImageError('UNSUPPORTED'); // 헤더는 맞지만 본문이 깨진 이미지
  }

  try {
    const target = fitWithin(decoded.width, decoded.height, maxEdge);
    let out = await encodeAs(codec, decoded, target.width, target.height, { webp: WEBP_QUALITY, jpeg: JPEG_QUALITY });
    if (out.blob.size > SOFT_TARGET_BYTES) {
      out = await encodeAs(codec, decoded, target.width, target.height, { webp: RETRY_QUALITY, jpeg: RETRY_QUALITY });
    }
    if (out.blob.size > MAX_STORED_BYTES) throw new PrepareImageError('TOO_LARGE');
    return { blob: out.blob, width: target.width, height: target.height, mimeType: out.mimeType, bytes: out.blob.size, sourceBytes: file.size };
  } finally {
    decoded.close();
  }
}

/** 실제 브라우저 codec. createImageBitmap(방향 보정) + canvas.toBlob(재인코딩). */
export function createBrowserImageCodec(): ImageCodec {
  const bitmaps = new WeakMap<DecodedImage, ImageBitmap>();
  return {
    async decode(blob) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const handle: DecodedImage = { width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      bitmaps.set(handle, bitmap);
      return handle;
    },
    encode(image, width, height, mimeType, quality) {
      const bitmap = bitmaps.get(image);
      if (!bitmap) return Promise.reject(new Error('unknown image'));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return Promise.reject(new Error('no 2d context'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (mimeType === 'image/jpeg') {
        // JPEG에는 알파가 없다 — 투명 PNG가 검게 나오지 않도록 흰 배경을 깐다.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(bitmap, 0, 0, width, height);
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            // 캔버스 메모리를 즉시 돌려준다(모바일 메모리 보호).
            canvas.width = 0;
            canvas.height = 0;
            if (b) resolve(b);
            else reject(new Error('encode failed'));
          },
          mimeType,
          quality
        );
      });
    },
  };
}
