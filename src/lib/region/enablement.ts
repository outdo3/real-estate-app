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

import { getRegionByLawdCd, REGION_NODES, type RegionNode } from './registry';

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
  // '11': 서울특별시 — registry에는 존재하지만 미출시(아래 시군구 allowlist 참고)
  // '41': 경기도     — registry에는 존재하지만 미출시
};

// ── SEOUL_MOBILE_BETA_PREP_V1 — 시군구 단위 allowlist ────────────────────────────
//
// 서울은 **시도 전체로 열 수 없다**. registry에 서울 25구가 전부 있으므로
// `ENABLEMENT_BY_SIDO`에 `'11'`을 넣는 순간 전체 이력도 검증도 없는 17개 구가
// 함께 열린다. 그래서 시도 map은 그대로 두고, 그보다 **먼저** 보는 시군구 층을 둔다.
//
// 이 층은 시도 map을 덮어쓰지 않고 앞에서 가로챈다(부산 16구는 계속 시도 층이 답한다).
// 결과적으로 `getSidoEnablement('11')`은 **계속 전부 false**다 — 이것이 중요하다:
//   · "서울 전체"(sidoCode=11) 통계/피드 요청은 지금처럼 거부된다.
//   · `?sido=서울특별시` 이름 경로도 거부된다.
//   · 시도 단위 DB-first(`isTradeDbFirstSido`)도 거부된다 — 8/25구만 적재돼 있어
//     "시도 전체 DB-first"는 부분이 아니라 **틀린** 답이기 때문이다.
// 즉 열리는 것은 오직 아래 목록의 시군구를 **직접** 지정한 요청뿐이다.

/** 서울 모바일 beta 대상 8개 구. 전체 이력 적재 + 사후 검증(원천=DB)을 통과한 구만 있다. */
export const SEOUL_BETA_LAWDCDS = [
  '11110', // 종로구
  '11140', // 중구
  '11170', // 용산구
  '11215', // 광진구
  '11230', // 동대문구
  '11410', // 서대문구
  '11440', // 마포구
  '11545', // 금천구
] as const;

/**
 * beta 공개 마스터 스위치. **이 값 하나가 서울 노출 전체를 좌우한다.**
 * false인 동안 `ENABLEMENT_BY_LAWDCD`는 빈 객체이고, 서울은 모든 축에서 닫혀 있다
 * (즉 이 파일을 제외한 어떤 동작도 지금은 바뀌지 않는다).
 */
export const SEOUL_BETA_ENABLED = false;

/**
 * beta에서 실제로 여는 축.
 *
 * `app`·`cronSync`만 연다 — 서울에 있는 데이터가 **매매 실거래 + 단지 master(좌표)뿐**이기 때문이다.
 *   · `cronSync`: 매매를 DB에 유지하고 있으므로 상세/지도의 DB-first 읽기가 옳다.
 *   · `stats`  : 전월세·학교·입지/시장 피처가 전부 부산 전용이고, feed의 DB 경로도 시도 고정이다.
 *   · `report` : 리포트/SEO 범위는 `BUSAN_DISTRICTS` 기반이라 지역 일반화가 선행돼야 한다.
 *   · `sitemap`·`seoIndex`: 위 리포트 범위가 정리되기 전에는 색인 대상이 될 수 없다.
 * 데이터가 준비되는 순서대로 축을 하나씩 여는 것이 이 인터페이스의 목적이다.
 */
const SEOUL_BETA_ENABLEMENT: RegionEnablement = {
  app: true,
  report: false,
  stats: false,
  sitemap: false,
  seoIndex: false,
  cronSync: true,
};

/**
 * 시군구 단위 공개 상태. 스위치가 꺼져 있으면 **빈 객체**이므로 어떤 조회도 시도 층으로 떨어진다.
 * 여기에 없는 시군구는 이 층이 관여하지 않는다(부산은 계속 시도 층이 답한다).
 */
const ENABLEMENT_BY_LAWDCD: Readonly<Record<string, RegionEnablement>> = SEOUL_BETA_ENABLED
  ? Object.fromEntries(SEOUL_BETA_LAWDCDS.map((code) => [code, SEOUL_BETA_ENABLEMENT]))
  : {};

/** 이 시군구가 시도와 별개로 직접 열려 있는가(= allowlist 적중). 지금은 항상 false. */
export function isBetaAllowlistedLawdCd(lawdCd: string | null | undefined): boolean {
  return !!lawdCd && lawdCd in ENABLEMENT_BY_LAWDCD;
}

/** 승인된 서울 beta 8구인가(스위치와 무관한 **정적 소속** 판정). */
export function isSeoulBetaDistrict(lawdCd: string | null | undefined): boolean {
  return !!lawdCd && (SEOUL_BETA_LAWDCDS as readonly string[]).includes(lawdCd);
}

// ── SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1 — 공개 차단 정책(서울 한정) ────────────────
//
// 이 정책은 **서울에만** 적용한다. 부산은 물론이고 경기·대구 등 다른 지역도 건드리지 않는다:
// 검색/상세는 지금도 전국을 live MOLIT로 응답하는 것이 의도된 동작이고(비부산 **통계**만
// NON_BUSAN_STATS_TRUST_GATE_V1로 닫혀 있다), 여기서 전 지역을 막으면 이번 작업 범위 밖의
// 제품 동작까지 바꾸게 된다. 닫아야 하는 것은 "승인되지 않은 서울"뿐이다.
//
// 접두사(`startsWith('11')`)로 판정하지 않는다 — registry 노드를 거쳐 시도를 확인한 뒤,
// 판정 자체는 축별 enablement에 위임한다. 그래서 allowlist가 유일한 진실 원천으로 남는다.

/**
 * 이 시군구를 해당 기능 축에서 **공개 차단**해야 하는가.
 *
 * 서울이 아니면 항상 false(=이 정책의 대상이 아님). 서울이면 그 축이 열렸는지로만 판정하므로
 *   · beta OFF  → 서울 25구 전부 차단
 *   · beta ON   → 승인 8구만 통과, 강남 11680과 나머지 17구는 계속 차단
 *   · `report`처럼 beta에서도 닫아 둔 축은 8구까지 포함해 **전부** 차단
 * 이 된다.
 */
export function isSeoulPublicBlocked(
  lawdCd: string | null | undefined,
  feature: keyof RegionEnablement = 'app'
): boolean {
  const node = getRegionByLawdCd(lawdCd);
  if (!node || node.sidoCode !== '11') return false;
  return !getRegionEnablement(node.lawdCd)[feature];
}

/**
 * 공개 차단 대상 서울 시군구 코드 목록 — DB 질의의 deny-list로 쓴다.
 * registry의 서울 노드에서 파생하므로 구를 새로 승인해도 목록이 저절로 따라온다.
 */
export function seoulPublicBlockedLawdCds(
  feature: keyof RegionEnablement = 'app'
): readonly string[] {
  return REGION_NODES.filter((n) => n.sidoCode === '11' && !getRegionEnablement(n.lawdCd)[feature])
    .map((n) => n.lawdCd);
}

/**
 * 이 시도를 지역 선택지에서 **통째로 감춰야** 하는가 = 공개 가능한 시군구가 하나도 없는가.
 *
 * 서울에만 적용한다(다른 시도는 이 정책의 대상이 아니므로 항상 false). beta가 꺼져 있으면
 * 서울 25구가 전부 닫혀 있으므로 true — 선택 자체가 불가능해진다. beta가 켜지면 8구가
 * 열리므로 false가 되어 서울이 목록에 나타나고, 그 안에서 8구만 고를 수 있다.
 */
export function isSidoPubliclyHidden(
  sidoCode: string | null | undefined,
  feature: keyof RegionEnablement = 'app'
): boolean {
  if (sidoCode !== '11') return false;
  return !REGION_NODES.some((n) => n.sidoCode === '11' && getRegionEnablement(n.lawdCd)[feature]);
}

/**
 * 이 시도가 **일부 시군구만** 공개된 상태인가 = "시도 전체" 선택을 허용하면 안 되는가.
 *
 * 부산처럼 전 구가 열린 시도는 false(= "부산광역시 전체" 그대로 동작). 서울은 beta가 켜지면
 * 8/25구만 열리므로 true가 되어 "서울특별시 전체" 버튼이 사라진다 — 부분 집계를 전체인 것처럼
 * 보여 주지 않기 위해서다. beta가 꺼져 있으면 열린 구가 0개라 시도 자체가 목록에 없다.
 */
export function isSidoPartiallyPublic(
  sidoCode: string | null | undefined,
  feature: keyof RegionEnablement = 'app'
): boolean {
  if (!sidoCode) return false;
  const nodes = REGION_NODES.filter((n) => n.sidoCode === sidoCode);
  if (nodes.length === 0) return false;
  const open = nodes.filter((n) => getRegionEnablement(n.lawdCd)[feature]).length;
  return open > 0 && open < nodes.length;
}

export function getSidoEnablement(sidoCode: string | null | undefined): RegionEnablement {
  return (sidoCode && ENABLEMENT_BY_SIDO[sidoCode]) || NOT_ENABLED;
}

/**
 * 모르는 lawdCd는 전부 닫힘으로 본다 — 어떤 지역으로도 fallback하지 않는다.
 *
 * 시군구 allowlist를 **먼저** 본다(SEOUL_MOBILE_BETA_PREP_V1). allowlist가 비어 있으면
 * 예전과 완전히 같은 동작(시도 층 단독)이다.
 */
export function getRegionEnablement(lawdCd: string | null | undefined): RegionEnablement {
  const node = getRegionByLawdCd(lawdCd);
  if (!node) return NOT_ENABLED;
  return ENABLEMENT_BY_LAWDCD[node.lawdCd] ?? getSidoEnablement(node.sidoCode);
}

/** 현재 앱에 공개된 시도 코드 목록. */
export function getEnabledSidoCodes(): readonly string[] {
  return Object.keys(ENABLEMENT_BY_SIDO).filter((code) => ENABLEMENT_BY_SIDO[code].app);
}

/**
 * 특정 기능 축에 대해 열려 있는 지역 노드 목록.
 *
 * **시군구 단위로 판정한다**(SEOUL_MOBILE_BETA_PREP_V1). 예전에는 `getSidoEnablement`를 써서
 * 한 시도가 열리면 그 시도의 모든 구가 딸려 나왔다 — 서울처럼 일부 구만 여는 경우
 * 그 동작은 곧 "승인되지 않은 17개 구까지 노출"을 뜻하므로 per-lawdCd로 바꾼다.
 * 부산은 16구가 모두 시도 층에서 열려 있어 결과가 이전과 동일하다.
 */
export function getEnabledRegions(
  feature: keyof RegionEnablement,
  nodes: readonly RegionNode[]
): readonly RegionNode[] {
  return nodes.filter((n) => getRegionEnablement(n.lawdCd)[feature]);
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
