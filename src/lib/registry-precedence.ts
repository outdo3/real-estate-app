// HOUSEHOLDS_SOURCE_PRECEDENCE_HARDENING_V1 — 상세 registry의 필드별 출처 우선순위를
// 순수 함수로 분리한다(map-marker-coords.ts와 같은 이유: 라우트를 띄우지 않고 규칙만 테스트).
//
// 배경(실측): tier1 `apartments` 캐시 게이트는 parkingCount·far·bcr·approvalDate **네 필드만**
// 본다. 세대수는 게이트에 없고 `cached.totalHouseholds ?? null`로 딸려 나온다. 그래서 네 필드가
// 채워진 캐시 행은 세대수가 낡아도 그대로 통과했고, 이어서 isFullyPopulated가 그 값을 truthy로
// 보면서 master 보충이 아예 실행되지 않았다 — 경동이 master 892인데 화면에 72로 남은 경로다.
//
// 그래서 **세대수 한 필드만** 우선순위를 뒤집는다:
//
//   세대수          MASTER(non-null) > CACHE > LIVE
//   그 밖의 필드     CACHE > MASTER > LIVE   (기존 그대로)
//
// 캐시 행을 통째로 버리지 않는다. master에 없는 값(특히 사용승인일 — master의
// use_approval_date가 null인 단지가 많고 화면의 "1995년"은 캐시가 주고 있다)을 그대로 살린다.

export interface RegistryFields {
  parkingCount: number | null;
  far: number | null;
  bcr: number | null;
  totalHouseholds: number | null;
  approvalDate: string | null;
}

/** ApartmentMaster에서 이 병합에 필요한 필드만. 라우트가 Prisma row를 그대로 넘긴다. */
export interface MasterRegistrySource {
  parkingCount: number | null;
  floorAreaRatio: number | null;
  buildingCoverageRatio: number | null;
  totalHouseholds: number | null;
  useApprovalDate: string | null;
}

/** 대장 원본 "YYYYMMDD" → 화면 표기 "YYYY년". 형식이 아니면 값을 만들지 않는다. */
export function masterApprovalYear(useApprovalDate: string | null | undefined): string | null {
  const raw = useApprovalDate || '';
  return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}년` : null;
}

/**
 * master를 registry에 병합한다.
 *
 * 세대수만 master가 이긴다(non-null일 때). master가 null이면 캐시 값을 그대로 쓴다 —
 * master에 세대수가 없고 캐시에만 있는 보완 케이스(실측 9건)가 값을 잃으면 안 된다.
 * 나머지 필드는 기존 우선순위(캐시 우선, 빈 곳만 master가 보충)를 한 글자도 바꾸지 않는다.
 */
export function mergeMasterIntoRegistry(
  partial: RegistryFields | null,
  master: MasterRegistrySource | null,
): RegistryFields | null {
  if (!master) return partial;
  return {
    // 기존 그대로 — 캐시가 채운 값은 master가 덮지 않는다
    parkingCount: partial?.parkingCount ?? master.parkingCount ?? null,
    far: partial?.far ?? master.floorAreaRatio ?? null,
    bcr: partial?.bcr ?? master.buildingCoverageRatio ?? null,
    approvalDate: partial?.approvalDate ?? masterApprovalYear(master.useApprovalDate),
    // 세대수만 뒤집는다 — master가 값을 가지고 있으면 그것이 권위다
    totalHouseholds: master.totalHouseholds ?? partial?.totalHouseholds ?? null,
  };
}

/** 다섯 필드가 모두 찼는가 — live 건축물대장을 부를지 결정하는 기존 판정 그대로. */
export function isFullyPopulated(r: RegistryFields | null): boolean {
  return !!r && !!r.parkingCount && !!r.far && !!r.bcr && !!r.totalHouseholds && !!r.approvalDate;
}

/**
 * live 결과 병합 — 빈 필드만 채운다(기존 그대로). 세대수도 여기서는 기존 규칙을 따른다:
 * master/캐시가 이미 값을 줬으면 live가 덮지 않는다.
 */
export function mergeLiveIntoRegistry(
  partial: RegistryFields | null,
  live: RegistryFields,
): RegistryFields {
  return {
    parkingCount: partial?.parkingCount ?? live.parkingCount,
    far: partial?.far ?? live.far,
    bcr: partial?.bcr ?? live.bcr,
    totalHouseholds: partial?.totalHouseholds ?? live.totalHouseholds,
    approvalDate: partial?.approvalDate ?? live.approvalDate,
  };
}
