// NON_BUSAN_STATS_TRUST_GATE_V1 — 통계 기능의 지역 게이트.
//
// 왜 필요한가: stats 라우트는 DB-first 적격(=실거래를 DB에 유지하는) 지역이 아니면 live MOLIT로
// 떨어졌다. 그 경로는 coverage cell·취소 반영 같은 DB-first 신뢰 장치를 전부 우회하고, 느리다
// (서울 강남 연도별 표 ≈84초). 출시 지역(부산) 밖의 통계는 신뢰할 수 있는 DB가 준비될 때까지
// **닫는다**. 판단 기준은 enablement의 `stats` 축 하나뿐이다 — 새 플래그 체계를 만들지 않는다.
//
// 이 게이트는 라우트가 캐시·DB·MOLIT·법정동 프록시를 부르기 **전에** 판정할 수 있도록 순수 함수다
// (prisma/fetch를 import하지 않는다). 막힌 지역에는:
//   - 부산 데이터로 대신 답하지 않고(fallback 없음)
//   - "0건"으로 보이는 빈 결과를 만들지 않으며
//   - 오류(500)로 취급하지도 않는다 — 준비 중인 지역은 애플리케이션 오류가 아니다.
//
// 범위: 통계 기능만. 지도/상세의 `/api/transactions`는 이 게이트를 쓰지 않는다.

import { getStatsEnabledSidoCodes, isStatsEnabledSido } from './enablement';
import { getRegionByLawdCd, getSido, REGION_SIDOS } from './registry';

export const STATS_UNSUPPORTED_REASON = 'UNSUPPORTED_REGION' as const;
export const STATS_UNSUPPORTED_MESSAGE = '이 지역 통계는 현재 준비 중입니다.';

/**
 * stats 라우트가 지역을 정하는 입력. 라우트들의 해석 순서를 그대로 따른다:
 *   1) 유효한 5자리 `lawdCd` → 그 시군구
 *   2) `lawdCd`가 없고 유효한 2자리 `sidoCode` → 시도 전체
 *   3) 그 밖에는 `resolveLawdCd(sido, gungu)` — 이때 시도는 `sidoName`(라우트 기본값 적용 후)
 */
export interface StatsRegionQuery {
  lawdCd: string | null;
  sidoCode: string | null;
  sidoName: string | null;
}

type SidoPredicate = (sidoCode: string | null | undefined) => boolean;

/**
 * 이 요청 지역에 통계를 제공하는가. registry에 없는 지역은 **false**다 — 접두사나 이름
 * 유사도로 추측하지 않고, 어떤 지역으로도 fallback하지 않는다.
 *
 * `isEnabledSido`는 테스트용 주입점이다. 기본값은 enablement의 `stats` 축이며, 서울을 열 때는
 * enablement.ts의 `stats`를 true로 바꾸는 것만으로 이 판정이 통과한다(별도 분기 없음).
 */
export function isStatsRegionSupported(
  query: StatsRegionQuery,
  isEnabledSido: SidoPredicate = isStatsEnabledSido
): boolean {
  const { lawdCd, sidoCode, sidoName } = query;
  if (lawdCd && /^\d{5}$/.test(lawdCd)) {
    const node = getRegionByLawdCd(lawdCd);
    return node ? isEnabledSido(node.sidoCode) : false;
  }
  if (!lawdCd && sidoCode && /^\d{2}$/.test(sidoCode)) {
    return getSido(sidoCode) ? isEnabledSido(sidoCode) : false;
  }
  const sido = REGION_SIDOS.find((s) => s.name === sidoName);
  return sido ? isEnabledSido(sido.code) : false;
}

/**
 * SEOUL_STATS_SALE_PARITY_V2 — 서울 지역 매매 통계 적격 여부(순수).
 * 서울 25개 구는 전체 이력 매매 실거래가 DB 적재가 완료되었으므로,
 * 매매 기반 통계(피드 매매 필터, 84㎡ 순위)의 소스로 안전하게 사용할 수 있다.
 */
export function isSeoulSaleStatsEligible(query: StatsRegionQuery): boolean {
  const { lawdCd, sidoCode, sidoName } = query;
  if (lawdCd && /^\d{5}$/.test(lawdCd)) {
    const node = getRegionByLawdCd(lawdCd);
    return node?.sidoCode === '11';
  }
  if (!lawdCd && sidoCode && /^\d{2}$/.test(sidoCode)) {
    return sidoCode === '11';
  }
  if (sidoName) {
    const sido = REGION_SIDOS.find((s) => s.name === sidoName);
    return sido?.code === '11';
  }
  return false;
}

/**
 * SEOUL_STATS_SALE_PARITY_V2 — 실거래 피드 기능별 게이트.
 * - 부산(26): 매매, 전세, 월세 전 유형 지원
 * - 서울(11): 매매(sale) 및 전체(all) 지원, 전월세 전용(jeonse/wolse) 필터는 미적재 상태로 차단
 * - 그 외 지역: 차단
 */
export function isStatsFeedSupported(
  query: StatsRegionQuery & { dealType?: string | null }
): { allowed: boolean; reason?: 'UNSUPPORTED_REGION' | 'RENT_PREPARING'; message?: string } {
  // 1. 부산 등 기존 통계 전면 공개 시도
  if (isStatsRegionSupported(query)) {
    return { allowed: true };
  }

  // 2. 서울 매매 피드 분기
  if (isSeoulSaleStatsEligible(query)) {
    if (query.dealType === 'jeonse' || query.dealType === 'wolse') {
      return {
        allowed: false,
        reason: 'RENT_PREPARING',
        message: '서울 지역의 전월세 실거래 정보는 아직 준비 중입니다 (매매 실거래가만 제공 중).',
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: STATS_UNSUPPORTED_REASON,
    message: STATS_UNSUPPORTED_MESSAGE,
  };
}

/**
 * SEOUL_STATS_SALE_PARITY_V2 — 가격 순위 기능별 게이트.
 * - 부산(26): area84, decline, rising, record-high, jeonse-risk 전 모드 지원
 * - 서울(11): area84(국민평형 순위) 및 매매 순위 지원, jeonse-risk(전세가율 위험)는 전세 미적재로 차단
 * - 그 외 지역: 차단
 */
export function isStatsRankingSupported(
  query: StatsRegionQuery & { mode?: string | null }
): { allowed: boolean; reason?: 'UNSUPPORTED_REGION' | 'RENT_PREPARING'; message?: string } {
  // 1. 부산 등 기존 통계 전면 공개 시도
  if (isStatsRegionSupported(query)) {
    return { allowed: true };
  }

  // 2. 서울 매매 기반 순위(area84 등) 분기
  if (isSeoulSaleStatsEligible(query)) {
    if (query.mode === 'jeonse-risk') {
      return {
        allowed: false,
        reason: 'RENT_PREPARING',
        message: '서울 지역의 전세가율 순위는 전월세 데이터 적재 준비 중입니다.',
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: STATS_UNSUPPORTED_REASON,
    message: STATS_UNSUPPORTED_MESSAGE,
  };
}

/** 통계가 열려 있는 시도(현재 부산). 사용자가 직접 이동할 수 있게 안내용으로만 내려준다. */
function supportedSidoFields() {
  const code = getStatsEnabledSidoCodes()[0] ?? null;
  return { supportedSidoCode: code, supportedSidoName: getSido(code)?.name ?? null };
}

/** `{ status: 'OK' | 'ERROR' }` 계약을 쓰는 라우트용 응답 본문(HTTP 200). */
export function statsUnsupportedStatusBody(message: string = STATS_UNSUPPORTED_MESSAGE) {
  return {
    status: 'UNSUPPORTED' as const,
    supported: false as const,
    reason: STATS_UNSUPPORTED_REASON,
    message,
    ...supportedSidoFields(),
  };
}

/** `{ success, data }` 계약을 쓰는 라우트(dashboard/yearly/rankings)용 응답 본문(HTTP 200). */
export function statsUnsupportedSuccessBody(message: string = STATS_UNSUPPORTED_MESSAGE) {
  return {
    success: false as const,
    supported: false as const,
    reason: STATS_UNSUPPORTED_REASON,
    message,
    ...supportedSidoFields(),
  };
}

/** 클라이언트용 — 응답이 "준비 중인 지역"인지(오류·0건과 구분). */
export function isStatsUnsupportedResponse(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const body = json as { reason?: unknown; status?: unknown };
  return body.reason === STATS_UNSUPPORTED_REASON || body.status === 'UNSUPPORTED';
}
