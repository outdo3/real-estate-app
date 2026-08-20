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
 * [PEER FALLBACK HOTFIX] "존재하는 후보 수"만 보고 레벨을 정하기 때문에,
 * 그 레벨의 후보들이 실제로 해당 sub-metric 값을 갖고 있는지는 여기서 알 수
 * 없다(관심사 분리 원칙 유지, 실제 사용 가능 표본 부족 시 재시도는 calculate.ts의
 * 카테고리 단위 fallback이 처리 — resolvePeerPoolLevels() 참고). 이 함수는
 * 순수하게 하위호환을 위해 유지되며, resolvePeerPoolLevels()의 첫 항목을
 * 그대로 반환한다(동작 동일, 시그니처/반환값 무변경).
 *
 * @param useBuildYearDecadeBand 주차(§11)처럼 sigungu만으로는 너무 이질적인
 *   신축/구축이 섞이는 카테고리에서 LOCAL을 "sigungu + buildYear decade band"로 정의.
 *   false면 LOCAL은 "같은 동(umdName)".
 * @param cohortOtherRegions REGION_WIDE 폴백에서만 쓰는 타 지역 후보(지연 조회 가능,
 *   실측상 sigungu 표본이 139~278건이라 이 폴백까지 갈 일은 거의 없음). [PEER FALLBACK
 *   HOTFIX 확인] calculate.ts는 이 인자를 항상 생략(빈 배열)해 호출한다 — 즉 현재
 *   REGION_WIDE는 이름과 달리 "부산 전체/타 지역"이 아니라 SIGUNGU와 완전히 동일한
 *   후보 집합이다(진짜 타 지역 조회가 구현되기 전까지는 REGION_WIDE가 SIGUNGU의
 *   동의어). 새 API 의존성 추가 금지 원칙(CLAUDE.md #8) 때문에 이번 hotfix에서
 *   실제 타 지역 조회를 새로 만들지 않았다 — 이름과 실제 동작의 불일치를 여기 명시.
 */
export function resolvePeerPool(
  target: PeerCandidate,
  cohortSameSigungu: PeerCandidate[],
  useBuildYearDecadeBand: boolean,
  cohortOtherRegions: PeerCandidate[] = []
): PeerPoolResult {
  return resolvePeerPoolLevels(target, cohortSameSigungu, useBuildYearDecadeBand, cohortOtherRegions)[0];
}

/**
 * [PEER FALLBACK HOTFIX] resolvePeerPool()과 동일한 판정 로직으로 "시도 순서"
 * 전체를 배열로 반환한다 — calculate.ts가 카테고리 단위로 LOCAL 표본이 실제로는
 * 부족할 때(§3: nominal candidate 수는 충분해도 usable sub-metric 표본이 부족한
 * 경우) SIGUNGU/REGION_WIDE로 재시도할 수 있게 한다. 배열의 첫 항목이 항상
 * resolvePeerPool()의 반환값과 동일하다(단일 호출 시 동작 100% 보존).
 *
 * 순서: [LOCAL(조건 충족 시), SIGUNGU(조건 충족 시), REGION_WIDE(항상 마지막
 * 안전망으로 포함 — 조건 미충족이어도 포함해 NOT_SCORED tier로라도 반환한다,
 * 기존 resolvePeerPool()의 "그래도 부족하면 REGION_WIDE 반환" 동작과 동일)].
 * 같은 레벨을 중복 포함하지 않는다.
 */
export function resolvePeerPoolLevels(
  target: PeerCandidate,
  cohortSameSigungu: PeerCandidate[],
  useBuildYearDecadeBand: boolean,
  cohortOtherRegions: PeerCandidate[] = []
): PeerPoolResult[] {
  const targetDecade = decadeBand(target.buildYear);

  const localCandidates = useBuildYearDecadeBand
    ? cohortSameSigungu.filter((c) => decadeBand(c.buildYear) === targetDecade)
    : cohortSameSigungu.filter((c) => c.umdName === target.umdName);

  const levels: PeerPoolResult[] = [];
  if (localCandidates.length >= PEER_SAMPLE_MEDIUM) {
    levels.push(finalize('LOCAL', localCandidates));
  }
  if (cohortSameSigungu.length >= PEER_SAMPLE_MEDIUM) {
    levels.push(finalize('SIGUNGU', cohortSameSigungu));
  }
  const regionWide = [...cohortSameSigungu, ...cohortOtherRegions];
  levels.push(finalize('REGION_WIDE', regionWide));

  return levels;
}

function finalize(level: PeerLevel, candidates: PeerCandidate[]): PeerPoolResult {
  return {
    level,
    tier: tierForSize(candidates.length),
    aptSeqs: candidates.map((c) => c.aptSeq),
  };
}
