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

// ── STATS_REGION_ENABLEMENT_MIGRATION_V1 ─────────────────────────────────────
//
// stats 라우트들이 각자 `const BUSAN_SIDO_CODE = '26'` + `lawdCd.startsWith('26')`로
// 판정하던 것을 여기로 모은다. **그 판정의 의미를 정확히 옮기는 것**이 중요하다:
//
//   그 코드는 "이 지역이 출시됐는가"가 아니라
//   "이 지역 실거래를 우리 DB에 적재·유지하고 있어서 DB-first 경로를 타도 되는가"였다.
//   (route 주석: "애초에 데이터가 존재하는 지역(부산)만 DB 경로를 타도록 하는 고정된
//    지역 라우팅이다. 非부산 사용자 동작은 전혀 바뀌지 않는다")
//
// 그래서 stats 지원 여부(`stats` 축)와 **별개의 이름**으로 둔다. 둘을 같은 축으로
// 뭉뚱그리면 지금 live MOLIT로 정상 동작 중인 비부산 요청을 조용히 막게 된다.
//
// NON_BUSAN_STATS_TRUST_GATE_V1 — 이후 승인에 따라 stats 라우트는 `stats` 축으로 먼저 게이트한다
// (region/stats-gate.ts). 비부산 stats는 live MOLIT로 가지 않고 '준비 중'을 받는다. 두 축의 분리는
// 그대로 유지된다 — 게이트는 `stats`, 게이트 뒤의 DB-first/live 선택은 `cronSync`. 서울을 열 때는
// DB 적재가 끝난 뒤 두 축을 함께 연다(stats만 열면 게이트 뒤에서 다시 live 경로로 떨어진다).
// 지도/상세의 /api/transactions는 이 게이트를 쓰지 않는다.
//
// 정책을 두 벌로 만들지 않기 위해 `cronSync` 축에서 파생한다 — 정기 수집을 하는 지역만
// DB가 최신이고, 그 지역이 곧 DB-first가 안전한 지역이다.

/** 이 시도의 실거래를 DB에 유지하고 있는가(= DB-first 경로 적격). */
export function isTradeDbFirstSido(sidoCode: string | null | undefined): boolean {
  return getSidoEnablement(sidoCode).cronSync;
}

/**
 * 이 시군구 코드가 DB-first 적격인가. registry에 없는 코드는 **false**다 —
 * 접두사만 보고 추측하지 않는다(모르는 지역을 DB 경로로 보내면 빈 결과가 "0건"처럼 보인다).
 */
export function isTradeDbFirstLawdCd(lawdCd: string | null | undefined): boolean {
  return getRegionEnablement(lawdCd).cronSync;
}

/** 통계 기능이 이 시도를 지원하는가(large-complex처럼 DB 전용 기능의 게이트). */
export function isStatsEnabledSido(sidoCode: string | null | undefined): boolean {
  return getSidoEnablement(sidoCode).stats;
}

/**
 * 통계 기능이 이 시군구를 지원하는가. registry에 없는 코드는 **false**다 — 접두사로
 * 추측하지 않는다(NON_BUSAN_STATS_TRUST_GATE_V1).
 */
export function isStatsEnabledLawdCd(lawdCd: string | null | undefined): boolean {
  return getRegionEnablement(lawdCd).stats;
}

/** 통계가 지원되는 시도 코드 목록. 현재는 부산 하나뿐이며, 기본값 산출에 쓴다. */
export function getStatsEnabledSidoCodes(): readonly string[] {
  return Object.keys(ENABLEMENT_BY_SIDO).filter((code) => ENABLEMENT_BY_SIDO[code].stats);
}

/** 실거래를 DB에 유지하는 시도 코드 목록(현재 부산뿐). 기본값/상수 파생에 쓴다. */
export function getTradeDbFirstSidoCodes(): readonly string[] {
  return Object.keys(ENABLEMENT_BY_SIDO).filter((code) => ENABLEMENT_BY_SIDO[code].cronSync);
}
