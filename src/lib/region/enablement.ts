// REGION_REGISTRY_V1 §13 — "지역이 **존재**한다"와 "지역이 **서비스에 열려 있다**"를 분리한다.
//
// registry.ts는 서울·경기의 계층을 정확히 표현하지만, 그것은 데이터 모델일 뿐 출시가 아니다.
// 실제 공개 여부는 이 파일 하나가 정한다. 그래서 registry에 지역을 추가하는 작업이
// 실수로 페이지를 열거나 sitemap을 늘리는 일이 구조적으로 불가능하다.
//
// 현재 열려 있는 지역: **부산광역시뿐**. 서울·경기는 registry에 존재하지만 모든 기능에서
// 닫혀 있다(데이터가 없고, Score 곡선도 부산 보정이며, 리포트/통계/cron도 부산 고정이다 —
// SEOUL_GYEONGGI_EXPANSION_DATA_AUDIT_V1 §27 참고).
//
// 이 파일은 기존 기능의 동작을 바꾸지 않는다. 각 소비자(리포트 allowlist, sitemap scope,
// cron 기본값 등)는 아직 자기 가드를 그대로 갖고 있고, 이 모듈은 그 정책을 **한 곳에서
// 읽을 수 있게** 해 줄 뿐이다. 소비자 이관은 다음 STEP에서 기능별로 진행한다.

import { getRegionByLawdCd, type RegionNode } from './registry';

/**
 * 기능별 공개 상태. 지역 하나가 "열렸다/닫혔다"로 뭉뚱그려지지 않도록 축을 나눈다 —
 * 실제로 확장은 이 축들이 서로 다른 시점에 열린다(데이터 적재 → 앱 노출 → 색인).
 */
export interface RegionEnablement {
  /** 앱에서 해당 지역 단지/지도/검색을 사용자에게 보여주는가. */
  app: boolean;
  /** 한장 리포트가 이 지역을 지원하는가. */
  report: boolean;
  /** 통계 화면이 이 지역을 지원하는가. */
  stats: boolean;
  /** sitemap에 URL을 넣는가. */
  sitemap: boolean;
  /** 검색엔진 색인을 허용하는가. */
  seoIndex: boolean;
  /** 정기 sync(cron)가 이 지역을 수집하는가. */
  cronSync: boolean;
}

const NOT_ENABLED: RegionEnablement = {
  app: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false,
};

const BUSAN_ENABLED: RegionEnablement = {
  app: true, report: true, stats: true, sitemap: true, seoIndex: true, cronSync: true,
};

/**
 * 시도 단위 공개 상태. **여기에 없는 시도는 전부 닫힘**이다(기본값이 닫힘이라,
 * registry에 지역을 추가하는 것만으로는 아무것도 열리지 않는다).
 */
const ENABLEMENT_BY_SIDO: Readonly<Record<string, RegionEnablement>> = {
  '26': BUSAN_ENABLED, // 부산광역시 — 현재 유일한 출시 지역
  // '11': 서울특별시 — registry에는 존재하지만 미출시
  // '41': 경기도     — registry에는 존재하지만 미출시
};

export function getSidoEnablement(sidoCode: string | null | undefined): RegionEnablement {
  return (sidoCode && ENABLEMENT_BY_SIDO[sidoCode]) || NOT_ENABLED;
}

/** 모르는 lawdCd는 전부 닫힘으로 본다 — 어떤 지역으로도 fallback하지 않는다. */
export function getRegionEnablement(lawdCd: string | null | undefined): RegionEnablement {
  const node = getRegionByLawdCd(lawdCd);
  return node ? getSidoEnablement(node.sidoCode) : NOT_ENABLED;
}

/** 현재 앱에 공개된 시도 코드 목록. */
export function getEnabledSidoCodes(): readonly string[] {
  return Object.keys(ENABLEMENT_BY_SIDO).filter((code) => ENABLEMENT_BY_SIDO[code].app);
}

/** 특정 기능 축에 대해 열려 있는 지역 노드 목록. */
export function getEnabledRegions(
  feature: keyof RegionEnablement,
  nodes: readonly RegionNode[]
): readonly RegionNode[] {
  return nodes.filter((n) => getSidoEnablement(n.sidoCode)[feature]);
}
