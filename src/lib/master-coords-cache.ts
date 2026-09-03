// SUPABASE_EGRESS_P1 — 지도 마커 좌표용 구(sggCd) 단위 ApartmentMaster 조회를
// 인스턴스 간 공유 캐시로 옮긴다.
//
// 감사 실측에서 `apartment_masters WHERE sgg_cd = ?`는 **두 개의 statement shape**으로
// 45,225회 호출돼 약 3.9GB를 반환했다. 하나는 Score cohort(cohort-cache.ts에서 처리),
// 다른 하나가 이 좌표 조회다. 이 쿼리는 select는 이미 좁았지만 `/api/transactions`의
// getOrSetCache **바깥**에 있어 캐시가 전혀 걸리지 않았고, DB-first 경로든 MOLIT 경로든
// 매 요청 실행됐다.
//
// 메커니즘/근거는 cohort-cache.ts 헤더와 동일(unstable_cache = 요청·배포를 가로질러
// 지속되는 Next 내장 캐시 → 인스턴스 간 공유). MasterCoordRow는 string/number/null만
// 담아 직렬화로 값이 변형되지 않는다.
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import type { MasterCoordRow } from '@/lib/map-marker-coords';

/** cohort-cache.ts와 동일한 30분 — 좌표는 배치 seed 데이터라 분 단위로 바뀌지 않는다. */
const COORDS_TTL_SECONDS = 30 * 60;

export async function loadMasterCoordsFromDb(sggCd: string): Promise<MasterCoordRow[]> {
  return prisma.apartmentMaster.findMany({
    where: { sggCd },
    select: { name: true, umdName: true, aptSeq: true, buildYear: true, latitude: true, longitude: true },
  });
}

const loadMasterCoordsCached = unstable_cache(
  async (sggCd: string) => loadMasterCoordsFromDb(sggCd),
  ['master-coords-v1'],
  { revalidate: COORDS_TTL_SECONDS, tags: ['master-coords'] }
);

/**
 * 캐시 실패 시 DB 직접 조회로 폴백한다 — 다른 지역 좌표로 대체하지 않는다.
 * 지역(sggCd)이 캐시 키에 들어가므로 다른 구의 좌표가 섞이는 것은 구조적으로 불가능하다.
 */
export async function getMasterCoords(sggCd: string): Promise<MasterCoordRow[]> {
  try {
    return await loadMasterCoordsCached(sggCd);
  } catch (e) {
    console.error('[master-coords] shared cache 조회 실패 — DB에서 직접 조회한다(정확성 우선)', e);
    return loadMasterCoordsFromDb(sggCd);
  }
}
