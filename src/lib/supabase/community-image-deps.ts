// COMMUNITY_IMAGE_UPLOAD_V1 — 라우트가 image-handlers에 주입하는 실제 의존성(서버 전용).
import 'server-only';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { ImageHandlerDeps } from '@/lib/community/image-handlers';
import { signUploadReceipt, verifyUploadReceipt } from '@/lib/community/image-upload-token';
import { checkImageUploadRateLimit, createInMemoryRequestLimiter } from '@/lib/community/image-upload-rate-limit';
import { queryStoredUploadUsage } from '@/lib/community/image-upload-usage-db';
import { getCommunityImageStorage, getUploadTokenKey } from './server-storage';

// COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1 — 요청 한도는 인스턴스(프로세스)마다 하나. 요청마다 새로 만들면 한도가 무의미하다.
const uploadRequestLimiter = createInMemoryRequestLimiter();

// 한도 초과(429)는 정상 사용 중에도 생길 수 있는 이벤트라 info로 남긴다(사유만, 사용자 id·IP 없음).
const INFO_MESSAGES = new Set(['[community-images] uploaded', '[community-images] rate limited']);

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
    rateLimit: (userId) =>
      checkImageUploadRateLimit(userId, {
        requests: uploadRequestLimiter,
        storedUsage: queryStoredUploadUsage,
        now: () => Date.now(),
        log: (message, meta) => console.error(message, meta ?? ''),
      }),
    // 성공 업로드(바이트 수 측정용)·한도 초과는 info, 나머지(실패·orphan·설정 누락)는 error로 남긴다.
    log: (message, meta) => (INFO_MESSAGES.has(message) ? console.log : console.error)(message, meta ?? ''),
  };
}
