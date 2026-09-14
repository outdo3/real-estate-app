// COMMUNITY_IMAGE_UPLOAD_V1 — 라우트가 image-handlers에 주입하는 실제 의존성(서버 전용).
import 'server-only';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { ImageHandlerDeps } from '@/lib/community/image-handlers';
import { signUploadReceipt, verifyUploadReceipt } from '@/lib/community/image-upload-token';
import { getCommunityImageStorage, getUploadTokenKey } from './server-storage';

export function buildImageHandlerDeps(): ImageHandlerDeps {
  const key = getUploadTokenKey();
  return {
    storage: key ? getCommunityImageStorage() : null,
    sign: (receipt) => {
      if (!key) throw new Error('upload token key unavailable');
      return signUploadReceipt(receipt, key);
    },
    verify: (token) => (key ? verifyUploadReceipt(token, key, Date.now()) : null),
    newUuid: () => randomUUID(),
    now: () => Date.now(),
    referencedPaths: async (paths) => {
      if (paths.length === 0) return new Set();
      const rows = await prisma.postImage.findMany({ where: { path: { in: paths } }, select: { path: true } });
      return new Set(rows.map((r) => r.path));
    },
    // 성공 업로드(바이트 수 측정용)만 info, 나머지(실패·orphan·설정 누락)는 error로 남긴다.
    log: (message, meta) => (message === '[community-images] uploaded' ? console.log : console.error)(message, meta ?? ''),
  };
}
