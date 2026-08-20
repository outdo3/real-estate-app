import type { PeerLevel, PeerTier, PeerPoolResult } from './types';
import { PEER_SAMPLE_HIGH, PEER_SAMPLE_MEDIUM } from './config';

export interface PeerCandidate {
  aptSeq: string;
  sggCd: string | null;
  umdName: string | null;
  buildYear: number | null;
}

function tierForSize(size: number): PeerTier {
  if (size >= PEER_SAMPLE_HIGH) return 'HIGH';
  if (size >= PEER_SAMPLE_MEDIUM) return 'MEDIUM';
  return 'NOT_SCORED';
}

function decadeBand(buildYear: number | null): number | null {
  return buildYear == null ? null : Math.floor(buildYear / 10) * 10;
}

/**
 * 지리적/속성 기준 peer 후보 목록만 결정한다(§14). 특정 feature 값의 null 여부는
 * 전혀 보지 않는다 — 그건 percentile.rankFeature가 별도로 처리한다(관심사 분리).
 *
 * LEVEL1(LOCAL) → LEVEL2(SIGUNGU) → LEVEL3(REGION_WIDE) 순으로, 표본이
 * PEER_SAMPLE_MEDIUM(5) 이상이 되는 첫 레벨을 채택한다(§15).
 *
 * @param useBuildYearDecadeBand 주차(§11)처럼 sigungu만으로는 너무 이질적인
 *   신축/구축이 섞이는 카테고리에서 LOCAL을 "sigungu + buildYear decade band"로 정의.
 *   false면 LOCAL은 "같은 동(umdName)".
 * @param cohortOtherRegions REGION_WIDE 폴백에서만 쓰는 타 지역 후보(지연 조회 가능,
 *   실측상 sigungu 표본이 139~278건이라 이 폴백까지 갈 일은 거의 없음).
 */
export function resolvePeerPool(
  target: PeerCandidate,
  cohortSameSigungu: PeerCandidate[],
  useBuildYearDecadeBand: boolean,
  cohortOtherRegions: PeerCandidate[] = []
): PeerPoolResult {
  const targetDecade = decadeBand(target.buildYear);

  const localCandidates = useBuildYearDecadeBand
    ? cohortSameSigungu.filter((c) => decadeBand(c.buildYear) === targetDecade)
    : cohortSameSigungu.filter((c) => c.umdName === target.umdName);

  if (localCandidates.length >= PEER_SAMPLE_MEDIUM) {
    return finalize('LOCAL', localCandidates);
  }

  if (cohortSameSigungu.length >= PEER_SAMPLE_MEDIUM) {
    return finalize('SIGUNGU', cohortSameSigungu);
  }

  const regionWide = [...cohortSameSigungu, ...cohortOtherRegions];
  return finalize('REGION_WIDE', regionWide);
}

function finalize(level: PeerLevel, candidates: PeerCandidate[]): PeerPoolResult {
  return {
    level,
    tier: tierForSize(candidates.length),
    aptSeqs: candidates.map((c) => c.aptSeq),
  };
}
