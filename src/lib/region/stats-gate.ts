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
