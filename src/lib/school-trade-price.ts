// SCHOOLINFO / SCHOOL V2.1 §27 — "학교와 연결된 아파트" 카드에 붙일 최근 매매가는
// 이 프로젝트의 기존 검증된 실거래 파이프라인(fetchMolitData, dong+name 매칭)만
// 사용한다. 새 가격 소스를 만들지 않는다 — 이 파일은 "이미 받아온 trade 목록에서
// 후보 단지별 최신 거래를 찾는" 순수 매칭 로직만 분리했다(외부 API 호출 없음).

export interface TradeCandidate {
  aptSeq: string;
  name: string;
  dong: string;
}

export interface MolitTradeRecord {
  name: string;
  dong: string;
  dealAmount: number; // 만원 단위, fetchMolitData가 이미 파싱한 값
  price: string; // "N억 M만" 표시 문자열
  tradeDate: string; // "YYYY-MM-DD"
  dealCanceled?: boolean;
}

export interface CandidateTradeInfo {
  aptSeq: string;
  hasRecentPrice: boolean;
  price: string | null;
  dealAmount: number | null;
  tradeDate: string | null;
}

// 해제(취소)된 거래는 최신 거래로 채택하지 않는다 — 실제로 성립하지 않은 거래를
// "최근 매매가"로 보여주면 데이터 신뢰 원칙 위반이다.
export function attachLatestPrice(candidates: TradeCandidate[], trades: MolitTradeRecord[]): CandidateTradeInfo[] {
  const latestByKey = new Map<string, MolitTradeRecord>();
  const sorted = [...trades]
    .filter((t) => !t.dealCanceled)
    .sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

  for (const t of sorted) {
    const key = `${t.dong}|${t.name}`;
    if (!latestByKey.has(key)) latestByKey.set(key, t);
  }

  return candidates.map((c) => {
    const found = latestByKey.get(`${c.dong}|${c.name}`);
    if (!found) {
      return { aptSeq: c.aptSeq, hasRecentPrice: false, price: null, dealAmount: null, tradeDate: null };
    }
    return {
      aptSeq: c.aptSeq,
      hasRecentPrice: true,
      price: found.price,
      dealAmount: found.dealAmount,
      tradeDate: found.tradeDate,
    };
  });
}
