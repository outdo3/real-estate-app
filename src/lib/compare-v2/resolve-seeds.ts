// COMPARE_SHARE_URL_COMPACT_FIX_V1 §3 — 공유 링크의 `a`/`b`(canonical aptSeq)를
// 실제 단지로 되살린다. **서버 전용**(Prisma 직접 조회).
//
// 이름으로 되짚지 않는다. aptSeq는 ApartmentMaster의 unique 키이므로 조회 결과는
// 0건 아니면 1건이고, 그 1건이 곧 그 단지다. 해석되지 않으면 비슷한 단지를 찾아
// 대신 보여주지 않고 **없다고 말한다**(§3 "no another-apartment fallback").
import { isWellFormedAptSeq } from '@/lib/apartment-score/resolve-score-identity';
import type { CompareSlotSeed } from './url';
import type { PrismaClient } from '@prisma/client';

export interface ResolvedCompareSeeds {
  /** 슬롯 순서 그대로. 해석 실패한 자리는 null. */
  seeds: [CompareSlotSeed | null, CompareSlotSeed | null];
  /** 링크에는 있었지만 실제 단지를 찾지 못한 aptSeq. 화면에 정직하게 알린다. */
  unresolved: string[];
}

export const EMPTY_COMPARE_SEEDS: ResolvedCompareSeeds = { seeds: [null, null], unresolved: [] };

export async function resolveCompareSeeds(
  prisma: Pick<PrismaClient, 'apartmentMaster'>,
  input: { a?: string | null; b?: string | null }
): Promise<ResolvedCompareSeeds> {
  const requested = [input.a, input.b].map((v) => (v || '').trim());
  if (!requested.some(Boolean)) return EMPTY_COMPARE_SEEDS;

  const seeds: [CompareSlotSeed | null, CompareSlotSeed | null] = [null, null];
  const unresolved: string[] = [];

  // 두 자리는 서로 독립이다 — 한쪽이 해석되지 않아도 다른 쪽은 그대로 보여준다.
  await Promise.all(
    requested.map(async (aptSeq, i) => {
      if (!aptSeq) return;
      // 형태부터 aptSeq가 아니면 DB에 묻지 않는다(score identity와 같은 가드를 재사용).
      if (!isWellFormedAptSeq(aptSeq)) {
        unresolved.push(aptSeq);
        return;
      }
      const master = await prisma.apartmentMaster.findUnique({
        where: { aptSeq },
        select: { aptSeq: true, name: true, sggCd: true, umdName: true },
      });
      // 이름·구·동 중 하나라도 없으면 비교 조회를 구성할 수 없다 — 억지로 채우지 않는다.
      if (!master?.aptSeq || !master.name || !master.sggCd || !master.umdName) {
        unresolved.push(aptSeq);
        return;
      }
      seeds[i] = {
        name: master.name,
        lawdCd: master.sggCd,
        dong: master.umdName,
        aptSeq: master.aptSeq,
      };
    })
  );

  return { seeds, unresolved };
}
