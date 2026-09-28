// GYEONGGI_8_PREVIEW_FINAL_BLOCKER_V1 — 공급(`/api/stats/supply`) 지역 게이트(순수).
//
// 예전 라우트는 서울만 막는 deny-list였다(`isSeoulPublicBlocked`). 서울이 아니면 전부 통과라,
// 경기가 전 축 닫힘인 동안에도 `?sido=경기도&sigungu=…` 요청이 경기 분양 목록을 그대로 돌려줬다.
// 이제 다른 공개 표면과 같은 allowlist 모델로 판정한다 — enablement의 `supply` 축.
//
// 규칙(지역을 지정한 요청만 — 시도를 지정하지 않은 "전국" 요청은 이 게이트의 대상이 아니다):
//   · 시도만(시군구 없음): 시도 층에서 `supply`가 열린 시도만(부산). 일부 구만 열린 서울·경기의 "시도 전체"는 막힌다.
//   · 시도 + 시군구: 그 시도 registry 노드 중 이름이 **정확히 하나** 일치하는 노드의 `supply` 축.
//     이름이 없거나 둘 이상이면 모르는 지역 — 막는다(추측하지 않는다). 부모 시("수원시" 41110)는 자기 노드로
//     판정되므로 자식 일반구로 넓어지지 않는다. 다른 시도의 시군구 이름은 그 시도 노드에 없어 막힌다.
//   · registry에 없는 시도(대구 등)는 막는다.

import { getRegionEnablement, getSidoEnablement, type RegionEnablement } from '@/lib/region/enablement';
import { REGION_SIDOS, getSidoRegions } from '@/lib/region/registry';

export type SupplyRegionDecision =
  | { allowed: true; sidoCode: string; lawdCd: string | null }
  | { allowed: false; reason: 'UNKNOWN_REGION' | 'SIDO_WHOLE_NOT_SUPPORTED' | 'REGION_NOT_ENABLED' };

type SupplyAxisCheck = {
  /** 시군구 코드의 supply 축(테스트가 스위치 조합을 시뮬레이션할 때만 바꾼다). */
  lawdCd: (lawdCd: string) => boolean;
  /** 시도 층의 supply 축. */
  sido: (sidoCode: string) => boolean;
};

const RUNTIME_CHECK: SupplyAxisCheck = {
  lawdCd: (c) => getRegionEnablement(c).supply,
  sido: (c) => getSidoEnablement(c).supply,
};

/** `sidoFull`("경기도")·`sigungu`(registry 짧은 이름, "장안구")로 지정한 공급 조회를 내줘도 되는가. */
export function decideSupplyRegion(
  sidoFull: string,
  sigungu: string | null | undefined,
  check: SupplyAxisCheck = RUNTIME_CHECK
): SupplyRegionDecision {
  const sido = REGION_SIDOS.find((s) => s.name === sidoFull.trim());
  if (!sido) return { allowed: false, reason: 'UNKNOWN_REGION' };

  const name = (sigungu ?? '').trim();
  if (!name) {
    return check.sido(sido.code)
      ? { allowed: true, sidoCode: sido.code, lawdCd: null }
      : { allowed: false, reason: 'SIDO_WHOLE_NOT_SUPPORTED' };
  }

  // 선택기는 REGCODE 이름에서 시도 토큰을 뗀 값을 보낸다 — 부산·서울은 "해운대구", 경기 일반구는 "수원시 장안구".
  // registry fullName("경기도 수원시 장안구")과 **전체가 정확히** 같으면 그 노드, 아니면 짧은 이름이 정확히 하나 같은 노드.
  const regions = getSidoRegions(sido.code);
  const byFullName = regions.filter((n) => n.fullName === `${sido.name} ${name}`);
  const nodes = byFullName.length > 0 ? byFullName : regions.filter((n) => n.name === name);
  if (nodes.length !== 1) return { allowed: false, reason: 'UNKNOWN_REGION' };
  return check.lawdCd(nodes[0].lawdCd)
    ? { allowed: true, sidoCode: sido.code, lawdCd: nodes[0].lawdCd }
    : { allowed: false, reason: 'REGION_NOT_ENABLED' };
}

/** 테스트용: 주어진 enablement 판정기로 SupplyAxisCheck를 만든다. */
export function supplyCheckFrom(
  lawdCdEnablement: (lawdCd: string) => RegionEnablement,
  sidoEnablement: (sidoCode: string) => RegionEnablement
): SupplyAxisCheck {
  return { lawdCd: (c) => lawdCdEnablement(c).supply, sido: (c) => sidoEnablement(c).supply };
}
