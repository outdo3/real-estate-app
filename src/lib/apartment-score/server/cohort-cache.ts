// SUPABASE_EGRESS_P1 — 구(sggCd) 단위 Score cohort 로딩. 인스턴스 간 공유 캐시를 목표로
// 했으나 실측 결과 캐시는 히트하지 않았다(아래 ⚠ 참고). 현재 실효는 select 축소다.
//
// 문제(감사에서 실측): `apartment_masters WHERE sgg_cd = ?`가 41일간 45,225회 호출되어
// 약 3.9GB를 반환했다. 단일 최대 Egress 원인이다. 원인은 캐시가 없어서가 아니라
// getOrSetCache가 **프로세스 내 Map**이라는 데 있다 — Vercel에서는 Lambda 인스턴스마다
// 별도 메모리를 갖고 수시로 재활용되므로, cold instance가 뜰 때마다 같은 cohort를
// Production DB에서 다시 읽었다(coverage manifest 때와 같은 계열의 문제).
//
// 시도한 메커니즘: `unstable_cache` (next/cache).
//  - 설치된 Next 16.3.0 문서는 이 API가 "Next.js' built-in cache to persist the result
//    **across requests and deployments**"를 쓴다고 적고 있어, 이론상 프로세스 메모리
//    바깥(=인스턴스 간 공유)이어야 한다. **실제로는 그렇게 동작하지 않았다**(⚠ 참고).
//  - `'use cache'`(plain)는 문서가 명시적으로 **in-memory**라고 밝히고 있어 이 문제를
//    해결하지 못한다. `'use cache: remote'`는 공유되지만 `cacheComponents: true`라는
//    앱 전역 아키텍처 플래그가 필요하고 문서상 "typically incurs platform fees"라,
//    이번 STEP의 금지사항(신규 유료 서비스, 무관한 대규모 변경)에 걸린다.
//  - 새 DB 테이블/스키마/외부 서비스가 전혀 필요 없다.
//    (`unstable_cache`는 Next 16에서 `use cache`로 대체 예정이라고 표시돼 있다. Cache
//     Components로 전환할 때 함께 옮기면 되는, 문서화된 이관 경로가 있다.)
//
// 직렬화 안전성(중요): 이 캐시에 담기는 값은 아래 세 타입뿐이고 전부 string/number/null
// 이다. Date나 Prisma Decimal이 하나도 없다 — 그래서 캐시 경계를 넘나들어도 값이
// 변형되지 않는다(Date였다면 문자열로 바뀌어 Score가 조용히 달라질 수 있었다).
// 실제로 Score 코드가 fetchedAt/validUntil/latestTradeDate 등 DateTime 컬럼을 읽지
// 않는다는 것을 확인한 뒤, 필요한 컬럼만 select해서 캐시한다.
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
import type { RawLocationFeature, RawMarketFeature, RawMasterInfo } from './types';

export interface ScoreCohort {
  cohortMasterRows: RawMasterInfo[];
  locationRows: RawLocationFeature[];
  marketRows: RawMarketFeature[];
}

/**
 * TTL 30분 — 기존 in-process 캐시와 **동일한 값**이라 데이터 신선도 계약이 바뀌지 않는다.
 * ApartmentMaster/location/market은 배치로 갱신되는 데이터라 분 단위로 변하지 않는다.
 * 무기한 캐시는 하지 않는다(운영자가 알아야 할 worst-case stale = 30분).
 */
const COHORT_TTL_SECONDS = 30 * 60;

/** Score가 실제로 읽는 컬럼만. RawMasterInfo와 1:1. */
const MASTER_SELECT = {
  aptSeq: true, sggCd: true, sigungu: true, umdName: true, buildYear: true,
  totalHouseholds: true, parkingCount: true, mainBuildingCount: true, geocodeQuality: true,
} as const;

/** RawLocationFeature와 1:1 — 예전에는 select 없이 전체 컬럼(fetchedAt/validUntil 등 포함)을 읽었다. */
const LOCATION_SELECT = {
  aptSeq: true, nearestSubwayDistanceM: true, subwayCount1000m: true, nearestBusStopDistanceM: true,
  busStopCount300m: true, martCount1000m: true, convenienceCount500m: true, pharmacyCount500m: true,
  hospitalCount1000m: true, parkCount1000m: true, daycareKindergartenCount500m: true,
  nearestElementaryDistanceM: true, elementaryCount1000m: true, beachDistanceM: true, qualityFlag: true,
} as const;

/** RawMarketFeature와 1:1. */
const MARKET_SELECT = {
  aptSeq: true, medianPricePerM2_12m: true, transactionCount12m: true, qualityFlag: true,
} as const;

/** 캐시를 거치지 않는 정확한 DB 조회. 캐시 miss/에러 시의 정답 경로이기도 하다. */
export async function loadScoreCohortFromDb(sggCd: string | null): Promise<ScoreCohort> {
  const rows = await prisma.apartmentMaster.findMany({
    where: { sggCd, aptSeq: { not: null } },
    select: MASTER_SELECT,
  });
  const aptSeqs = rows.map((r) => r.aptSeq!).filter(Boolean);
  const [locations, markets] = await Promise.all([
    prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: aptSeqs } }, select: LOCATION_SELECT }),
    prisma.apartmentMarketFeature.findMany({ where: { aptSeq: { in: aptSeqs } }, select: MARKET_SELECT }),
  ]);
  return {
    cohortMasterRows: rows.map((r) => ({ ...r, aptSeq: r.aptSeq! })) as RawMasterInfo[],
    locationRows: locations as RawLocationFeature[],
    marketRows: markets as RawMarketFeature[],
  };
}

// 캐시 키에는 sggCd가 들어간다(unstable_cache는 인자를 키에 포함하고, keyParts로 네임스페이스를
// 고정한다). 지역이 키에 있으므로 **다른 구의 cohort가 섞이는 것은 구조적으로 불가능**하다.
// 'v1'은 캐시 shape 버전 — select 목록이 바뀌면 올려서 옛 항목과 섞이지 않게 한다.
const loadScoreCohortCached = unstable_cache(
  async (sggCd: string | null) => loadScoreCohortFromDb(sggCd),
  ['score-cohort-v1'],
  { revalidate: COHORT_TTL_SECONDS, tags: ['score-cohort'] }
);

/**
 * 구 단위 Score cohort를 가져온다.
 *
 * 캐시가 실패하면(핸들러 오류 등) **정확한 DB 조회로 폴백한다** — 다른 지역/다른 cohort로
 * 대체하지 않는다(§3). 즉 캐시는 성능 계층일 뿐이고, 어떤 경우에도 반환되는 데이터의
 * 의미는 DB 직접 조회와 같다.
 */
export async function getScoreCohort(sggCd: string | null): Promise<ScoreCohort> {
  try {
    return await loadScoreCohortCached(sggCd);
  } catch (e) {
    console.error('[score-cohort] shared cache 조회 실패 — DB에서 직접 조회한다(정확성 우선)', e);
    return loadScoreCohortFromDb(sggCd);
  }
}
