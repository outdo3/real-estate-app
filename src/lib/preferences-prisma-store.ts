// PERSONALIZED_SCORE_V1 P2-A — user_preferences Prisma 저장소(라우트와 QA 스크립트 공용).
// 클라이언트를 인자로 받는다: 라우트는 전역 prisma, QA는 롤백 트랜잭션 클라이언트를 넣는다.
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PreferencesStore } from './preferences-handlers';

type Client = Pick<PrismaClient, 'userPreference'> | Pick<Prisma.TransactionClient, 'userPreference'>;

export function createPreferencesStore(client: Client): PreferencesStore {
  return {
    find: (userId) => client.userPreference.findUnique({ where: { userId }, select: { purposes: true, fitImportance: true } }),
    upsert: (userId, patch) => {
      // 요청에 온 필드만 갱신한다. fitImportance null → DB NULL(초기화, JSON null 아님).
      const fit = patch.fitImportance === undefined ? undefined : patch.fitImportance === null ? Prisma.DbNull : patch.fitImportance;
      return client.userPreference.upsert({
        where: { userId },
        update: {
          ...(patch.purposes !== undefined && { purposes: patch.purposes }),
          ...(fit !== undefined && { fitImportance: fit }),
        },
        create: {
          userId,
          ...(patch.purposes !== undefined && { purposes: patch.purposes }),
          ...(fit !== undefined && { fitImportance: fit }),
        },
        select: { purposes: true, fitImportance: true },
      });
    },
  };
}
