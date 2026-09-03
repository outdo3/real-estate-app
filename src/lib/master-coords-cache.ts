// SUPABASE_EGRESS_P1 — 지도 마커 좌표용 구(sggCd) 단위 ApartmentMaster 조회.
// 인스턴스 간 공유 캐시를 목표로 했으나 실측상 캐시는 히트하지 않는다(아래 ⚠ 참고).
//
// 감사 실측에서 `apartment_masters WHERE sgg_cd = ?`는 **두 개의 statement shape**으로
// 45,225회 호출돼 약 3.9GB를 반환했다. 하나는 Score cohort(cohort-cache.ts에서 처리),
// 다른 하나가 이 좌표 조회다. 이 쿼리는 select는 이미 좁았지만 `/api/transactions`의
// getOrSetCache **바깥**에 있어 캐시가 전혀 걸리지 않았고, DB-first 경로든 MOLIT 경로든
// 매 요청 실행됐다.
//
// 메커니즘/한계는 cohort-cache.ts 헤더와 동일. MasterCoordRow는 string/number/null만
// 담아 직렬화로 값이 변형되지 않는다.
// ⚠ 측정 결과(2026-09-03, Production 실측) — 이 캐시는 현재 **히트하지 않는다**.
// 배포 후 같은 구(26140)로 8회 연속 요청했을 때 cohort 조회가 8회 그대로 발생했다
// (pg_stat_statements 델타: location +8, market +8). 폴백 에러 로그는 0건이라
// unstable_cache가 예외를 던지는 것도 아니고, 그냥 매번 miss한다. 즉 Next 16.3 +
// cacheComponents 비활성 상태의 이 배포에서는 unstable_cache가 인스턴스 간 공유
// 캐시로 동작하지 않는다.
//
// 그래서 이 파일이 지금 실제로 주는 이득은 **캐시가 아니라 select 축소**다
// (location 24→15 컬럼, market 15→4 컬럼 = cohort 1회당 173.5KB→75.8KB, -56.3%).
// 호출 횟수는 줄지 않았다 — 감사에서 지목한 45,225회는 그대로다.
//
// 진짜 cross-instance 캐시는 문서상 `'use cache: remote'`뿐이고, 그건
// `cacheComponents: true`(앱 전역 플래그) + 플랫폼 유료 캐시 핸들러를 요구해서
// 이번 STEP의 금지사항에 걸린다 — 그래서 STOP하고 PM에 보고했다.
// 이 래퍼는 그대로 두되(정확성에 무해하고 폴백이 항상 정답을 준다), 위 사실을
// 모르고 "캐시되고 있다"고 가정하지 말 것.
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
