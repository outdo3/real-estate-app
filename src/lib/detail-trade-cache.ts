// PERCEIVED_PERFORMANCE_V2_DATAFLOW §6/§7 — 상세페이지 실거래 요청의 공유 진입점.
//
// 두 가지 문제를 한 곳에서 해결한다.
//
// §6 중복 요청(감사 V1 P1-6): 상세페이지가 같은 엔드포인트를 겹치는 기간으로 5회
//    호출했다. 이제 아래 두 소비자가 **같은 60개월 창**을 요청하므로, in-flight 중복
//    제거만으로 두 요청이 하나로 합쳐진다(PriceTrendChart와 InvestmentMetrics는
//    apt-client에서 동일한 aptName/lawdCd/dong을 받으므로 키가 정확히 일치한다).
//
// §7 forward/재방문 재요청(감사 V1 P1-10): forward로 상세에 다시 들어오면 API 10건이
//    전부 다시 나갔다. 짧은 TTL 캐시로 그 창 안에서는 재요청하지 않는다.
//
// 신뢰 규칙(감사 V1 P1-10의 "정확성 주의"를 그대로 지킨다):
//   - **실패는 절대 캐시하지 않는다.** 실패를 캐시하면 다음 방문에서 "성공한 빈 결과"로
//     굳어져 FAILED가 ZERO로 접힌다.
//   - **부분 실패(partial)도 캐시하지 않는다.** 일시적인 MOLIT 실패가 TTL 동안 고착되면
//     안 된다 — 다음 방문에서 다시 시도해 완전한 결과를 받을 기회를 남긴다.
//   - 즉 **완전하게 성공한 응답만** 캐시한다. 캐시된 것은 정의상 partial=false,
//     apiError=null이므로 완전성 메타데이터가 캐시 때문에 왜곡될 여지가 없다.
//   - TTL은 서버가 이미 갖고 있는 MOLIT 월 캐시(molit-month-cache.ts, 1시간)보다
//     **훨씬 짧다**. 즉 이 캐시는 서버가 같은 순간에 돌려줬을 값보다 더 오래된 값을
//     만들어내지 않는다 — 새로운 staleness를 추가하지 않는다는 뜻이다.
//   - 저장 위치는 모듈 스코프 메모리뿐이다. sessionStorage/localStorage를 쓰지 않으므로
//     탭을 닫으면 사라지고, 디스크에도 다른 탭에도 남지 않는다.
//   - 키에 aptName/lawdCd/dong이 모두 들어가 다른 단지의 응답이 섞일 수 없다.
//
// 이 라우트들은 인증/세션에 의존하지 않는 공개 read 경로다(사용자별 데이터 없음).
import { resolveTradeReadState } from './trade-read-state';

export interface DetailTradeQuery {
  aptName: string;
  type: 'apt' | 'rent';
  period: number;
  lawdCd?: string | null;
  dong?: string | null;
  /** §2 canonical 좌표를 함께 받을지. 상세 parent 요청 하나만 true다. */
  withCoordinate?: boolean;
}

export interface DetailTradeResult {
  ok: boolean;
  payload: unknown;
  /** 이 응답이 캐시에서 나왔는지(측정/QA용). */
  fromCache: boolean;
}

/** 서버의 MOLIT 월 캐시(1시간)보다 훨씬 짧게 잡는다 — §7 참고. */
export const DETAIL_TRADE_CACHE_TTL_MS = 5 * 60 * 1000;

/** 한 세션에서 여러 단지를 오갈 때 메모리가 무한정 늘지 않도록 하는 상한. */
const MAX_ENTRIES = 24;

interface CacheEntry {
  payload: unknown;
  storedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DetailTradeResult>>();

/**
 * identity + 조회 파라미터로만 만든 키 — URL 파라미터 순서에 흔들리지 않는다.
 *
 * `withCoordinate`는 **일부러 키에 넣지 않는다.** 이 플래그는 응답에 좌표를 얹을지만
 * 정하고 거래 데이터에는 영향이 없다. 키에 넣으면 같은 거래 데이터가 "좌표 있음/없음"
 * 두 벌로 캐시돼, 매매↔전월세 토글로 돌아왔을 때 같은 데이터를 다시 받아온다(실측됨).
 * 좌표를 필요로 하는 요청은 이 페이지에서 parent의 첫 요청 하나뿐이고 그게 가장 먼저
 * 나가므로, 그 키에 캐시되는 payload에는 항상 좌표가 실려 있다.
 */
export function detailTradeCacheKey(query: DetailTradeQuery): string {
  return [
    query.aptName,
    query.type,
    String(query.period),
    query.lawdCd || '',
    query.dong || '',
  ].join('|');
}

export function buildDetailTradeUrl(query: DetailTradeQuery): string {
  const params = new URLSearchParams();
  params.set('type', query.type);
  params.set('period', String(query.period));
  if (query.lawdCd) params.set('lawdCd', query.lawdCd);
  if (query.dong) params.set('dong', query.dong);
  if (query.withCoordinate) params.set('withCoordinate', '1');
  return `/api/apt/${encodeURIComponent(query.aptName)}?${params.toString()}`;
}

/** 완전하게 성공한 응답인지 — 이 조건을 만족할 때만 캐시에 넣는다. */
function isCacheableResponse(ok: boolean, payload: unknown): boolean {
  if (!ok || payload == null || typeof payload !== 'object') return false;
  const state = resolveTradeReadState(true, payload as Parameters<typeof resolveTradeReadState>[1]);
  return state.apiError === null && !state.partial;
}

function readCache(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.storedAt > DETAIL_TRADE_CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.payload;
}

function writeCache(key: string, payload: unknown): void {
  cache.set(key, { payload, storedAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    // Map은 삽입 순서를 유지하므로 첫 키가 가장 오래된 항목이다.
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * 상세 실거래 응답을 가져온다. 같은 키의 요청이 이미 날아가 있으면 그 프로미스를
 * 공유하고, TTL 안의 **완전한** 성공 응답이 있으면 네트워크를 타지 않는다.
 *
 * 응답 payload를 그대로 돌려준다(해석하지 않는다) — 소비자마다 resolveTradeReadState나
 * coordinate 등 필요한 부분이 다르기 때문이다.
 */
export async function fetchDetailTrades(query: DetailTradeQuery): Promise<DetailTradeResult> {
  const key = detailTradeCacheKey(query);

  const cached = readCache(key);
  if (cached !== undefined) return { ok: true, payload: cached, fromCache: true };

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<DetailTradeResult> => {
    try {
      const response = await fetch(buildDetailTradeUrl(query));
      const payload = response.ok ? await response.json() : null;
      if (isCacheableResponse(response.ok, payload)) writeCache(key, payload);
      return { ok: response.ok, payload, fromCache: false };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

/** 테스트/개발용. 프로덕션 코드 경로에서는 호출하지 않는다. */
export function clearDetailTradeCache(): void {
  cache.clear();
  inflight.clear();
}
