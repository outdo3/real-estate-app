// APT DETAIL — DB-FIRST / CANCELLATION TRUST V1
//
// 상세페이지 매매 실거래의 **1차 소스를 DB로** 바꾸는 읽기 경로.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 같은 플랫폼·같은 단지·같은 시각에 지도와 상세가 서로 다른 거래를 보여줬다:
//
//   /api/transactions (지도) → DB-first → 26140-1164의 2026-09-05 129.7178㎡
//                                          6.65억 거래 **있음**
//   /api/apt/[name]  (상세) → MOLIT 라이브 → 같은 거래 **없음**
//                              (응답은 12/12개월 성공 · partial=false로 정상)
//
// MOLIT 라이브 응답은 시점에 따라 이미 신고된 거래를 빠뜨릴 수 있다(실측: 2026-09-05
// 계약 건들이 여러 단지에서 동시에 빠졌다). 반면 apartment_trade_histories는
// append-only로 축적된 신뢰 소스이고, 지도·통계·리포트가 이미 그것을 쓴다.
// 상세페이지만 약한 소스를 보고 있었다.
//
// ── 계약 ──────────────────────────────────────────────────────────────────
//  1) PRIMARY = DB(queryTrades). canonical **aptSeq**로만 조회한다.
//  2) aptSeq를 단일하게 확정하지 못하면 DB 경로를 쓰지 않는다(이름으로 재식별 금지).
//  3) DB에 그 단지 거래가 0건이면 MOLIT로 폴백한다 — DB가 "가릴" 데이터가 없는
//     경우뿐이므로 §9("MOLIT가 유효한 DB 거래를 덮지 못한다")를 위반하지 않는다.
//     부산 외 지역처럼 DB 커버리지가 없는 단지의 기존 동작이 그대로 유지된다.
//  4) 취소 거래는 활성 거래 집합에서 제외한다(queryTrades의 기본값 그대로).
//  5) 전월세(rent)는 이 경로를 쓰지 않는다 — apartment_trade_histories는 sale 전용이다.
//
// 새 쿼리를 만들지 않고 지도가 쓰는 것과 **동일한** queryTrades를 재사용한다.
// 그래야 "지도와 상세가 같은 활성 거래 집합에서 나온다"가 구조적으로 보장된다.

import { formatKoreanPrice } from '@/lib/api-molit';
import { normalizeAptName } from '@/lib/apt-name-match';
import { queryTrades, type StoredTrade } from '@/lib/trade-history-read';
import type { PrismaClient } from '@prisma/client';

/** 상세 라우트가 내려주는 거래 1건의 모양(MOLIT 경로와 동일 필드). */
export interface DetailTrade {
  id: string | number;
  name: string;
  aptSeq: string | null;
  tradeDate: string;
  price: number;
  priceStr: string;
  area: string;
  floor: number;
  tradeType: string;
  dong: string;
  buildYear: string;
  jibun: string;
  monthlyRent: number;
  registryDate: string;
  dealCanceled: boolean;
  cancelDate: string;
}

/**
 * 클라이언트 필터(`tradeType !== '아파트 매매' && tradeType !== '실거래'`)를 통과하는
 * 라벨. 지도 DB-first 경로가 쓰는 값과 동일하게 맞춘다.
 */
const DB_TRADE_TYPE_LABEL = '실거래';

/**
 * StoredTrade → 라우트 응답 모양. **순수 함수**(테스트 대상).
 *
 * area에 "m²" suffix를 붙이는 것은 MOLIT 경로(api-molit.ts)와 동일하게 맞추기 위함이다.
 * 평형 필터는 unit-area-match.ts가 숫자로 매칭하므로 suffix 유무와 무관하지만,
 * 두 소스가 같은 모양을 내도록 유지해 소비자가 소스를 구분할 필요가 없게 한다.
 */
export function toDetailTrade(t: StoredTrade): DetailTrade {
  const areaNum = Number(t.exclusiveArea);
  return {
    id: `db-apt-${t.id}`,
    name: t.aptName,
    aptSeq: t.aptSeq,
    tradeDate: t.dealDate.toISOString().slice(0, 10),
    // 만원 단위 정수 → 억 단위 실수(기존 라우트와 동일 규칙).
    price: t.dealAmount / 10000,
    priceStr: formatKoreanPrice(t.dealAmount),
    area: `${areaNum}m²`,
    floor: t.floor ?? 0,
    tradeType: DB_TRADE_TYPE_LABEL,
    dong: t.dong,
    buildYear: t.buildYear != null ? String(t.buildYear) : '',
    jibun: t.jibun || '',
    monthlyRent: 0,
    // StoredTrade에 없는 필드 — 값을 지어내지 않고 빈 문자열로 둔다.
    registryDate: '',
    // 이 경로는 취소 거래를 애초에 조회하지 않는다(§5).
    dealCanceled: false,
    cancelDate: '',
  };
}

export interface ResolveDetailAptSeqInput {
  /** URL이 넘겨준 aptSeq(지도/검색에서 canonical identity를 들고 온 경우). */
  aptSeqParam?: string | null;
  aptName: string;
  lawdCd: string;
  dong: string;
}

/**
 * 이 상세페이지의 canonical aptSeq를 확정한다. **확정하지 못하면 null**이다.
 *
 * 이름만으로 재식별하지 않는다(AGENTS.md). ApartmentMaster 조회는 항상
 * lawdCd로 지역을 좁힌 뒤, 정규화 이름이 **정확히 하나**만 일치할 때에만 채택한다.
 * 후보가 2건 이상이면 어느 쪽인지 확정할 수 없으므로 포기하고 MOLIT 경로로 넘긴다
 * (다른 단지 거래를 보여주느니 기존 동작을 유지하는 편이 안전하다).
 */
export async function resolveDetailAptSeq(
  prisma: Pick<PrismaClient, 'apartmentMaster'>,
  input: ResolveDetailAptSeqInput
): Promise<string | null> {
  const fromParam = (input.aptSeqParam || '').trim();
  if (fromParam) return fromParam;
  if (!input.lawdCd) return null;

  const candidates = await prisma.apartmentMaster.findMany({
    where: {
      sggCd: input.lawdCd,
      ...(input.dong ? { umdName: input.dong } : {}),
    },
    select: { aptSeq: true, name: true },
  });

  const target = normalizeAptName(input.aptName);
  const matches = candidates.filter((c) => c.aptSeq && normalizeAptName(c.name) === target);
  // 단일 매칭만 신뢰한다 — statistics-pyeong-resolver의 findSingleMatch와 같은 원칙.
  if (matches.length !== 1) return null;
  return matches[0].aptSeq;
}

export interface ReadDetailSaleTradesResult {
  trades: DetailTrade[];
  /** DB에서 실제로 읽었는가. false면 호출부가 MOLIT 경로를 그대로 쓴다. */
  usedDb: boolean;
  aptSeq: string | null;
}

/**
 * canonical aptSeq의 활성(비취소) 매매 거래를 DB에서 읽는다.
 *
 * `months`는 상세 라우트의 period와 같은 의미(현재 달 포함 최근 N개월).
 * 거래가 0건이면 `usedDb: false`로 돌려줘 호출부가 기존 MOLIT 경로를 타게 한다 —
 * 커버리지가 없는 지역에서 화면이 갑자기 비어버리는 것을 막기 위함이다.
 */
export async function readDetailSaleTradesFromDb(
  aptSeq: string,
  months: number
): Promise<ReadDetailSaleTradesResult> {
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  // 월 경계로 맞춘다(dealDate는 @db.Date라 시각이 없다).
  from.setHours(0, 0, 0, 0);

  const { trades } = await queryTrades({
    aptSeq,
    from,
    // §5 — 활성 거래만. queryTrades의 기본값이지만 의도를 명시한다.
    includeCanceled: false,
    // meta를 쓰지 않으므로 중복 aggregate 스캔을 끈다.
    withLatestDealDate: false,
  });

  return {
    trades: trades.map(toDetailTrade),
    usedDb: trades.length > 0,
    aptSeq,
  };
}

/**
 * MOLIT 경로 결과에서 취소 거래를 제거한다(§5).
 *
 * 상세페이지는 지금까지 dealCanceled를 전혀 필터하지 않아, 취소된 거래가 최근 실거래·
 * 타임라인·최고/최저·건수에 그대로 들어갔다. 지도(`/map`)는 예전부터 취소 건을 빼고
 * 있었으므로, 이 필터는 두 화면의 규칙을 일치시킨다.
 */
export function excludeCanceled<T extends { dealCanceled?: boolean }>(trades: readonly T[]): T[] {
  return trades.filter((t) => t.dealCanceled !== true);
}
