export interface AptBriefTrade {
  tradeDate: string;
  price: number;
  tradeType: string;
}

export interface AptBriefInput {
  // 현재 화면에 적용된 평형/기간/유형 필터가 반영된 거래 목록 (최신순 정렬, apt-client.tsx의
  // filteredTrades를 그대로 넘긴다 — 사용자가 보고 있는 조건 기준으로 브리핑이 생성된다).
  trades: AptBriefTrade[];
  tradeTypeFilter: '매매' | '전월세';
  totalHouseholds: string | null; // aptInfo['세대수'] 원본 문자열 (예: "1,302세대")
  buildYear: number | null;
}

const parseHouseholdCount = (raw: string | null): number | null => {
  if (!raw) return null;
  const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? null : num;
};

// 이미 보유한 데이터(시세 추이, 세대수, 준공연도, 최근 거래 빈도)를 조합해 2~4개의
// 규칙 기반 브리핑 문장을 만든다. 실제 LLM 호출이 아니다 — 데이터가 부족한 항목은
// 해당 문장을 건너뛰고, 아무 것도 만들 수 없으면 안내 문구 하나로 폴백한다.
export function buildAptBrief(input: AptBriefInput): string[] {
  const { trades, tradeTypeFilter, totalHouseholds, buildYear } = input;
  const sentences: string[] = [];

  // 1. 최근 시세 추이 (매매 기준, 거래 2건 이상일 때만 — trades는 최신순이므로
  // trades[0]이 최신, trades[trades.length-1]이 가장 오래된 거래)
  if (tradeTypeFilter === '매매' && trades.length >= 2) {
    const latest = trades[0].price;
    const oldest = trades[trades.length - 1].price;
    if (oldest > 0) {
      const pctChange = ((latest - oldest) / oldest) * 100;
      if (pctChange >= 3) {
        sentences.push(`최근 시세는 약 ${pctChange.toFixed(1)}% 상승 추세입니다.`);
      } else if (pctChange <= -3) {
        sentences.push(`최근 시세는 약 ${Math.abs(pctChange).toFixed(1)}% 하락 추세입니다.`);
      } else {
        sentences.push('최근 시세는 큰 변동 없이 보합세를 보이고 있습니다.');
      }
    }
  }

  // 2. 단지 규모/연식
  const households = parseHouseholdCount(totalHouseholds);
  const age = buildYear ? new Date().getFullYear() - buildYear : null;
  const ageLabel = age === null ? null : age <= 5 ? '신축' : age <= 15 ? '준신축' : '구축';
  if (households && ageLabel) {
    sentences.push(`총 ${households.toLocaleString('ko-KR')}세대 규모의 ${ageLabel} 단지입니다.`);
  } else if (households) {
    sentences.push(`총 ${households.toLocaleString('ko-KR')}세대 규모의 단지입니다.`);
  } else if (ageLabel) {
    sentences.push(`${ageLabel} 단지입니다.`);
  }

  // 3. 최근 거래 활발도 (최근 3개월)
  if (trades.length > 0) {
    const now = new Date();
    const recentCount = trades.filter((t) => {
      const diffDays = (now.getTime() - new Date(t.tradeDate).getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= 90;
    }).length;
    sentences.push(
      recentCount >= 3
        ? `최근 3개월간 ${recentCount}건 거래되어 거래가 활발한 편입니다.`
        : `최근 3개월간 ${recentCount}건 거래되어 거래가 다소 드문 편입니다.`
    );
  }

  if (sentences.length === 0) {
    sentences.push('최근 실거래 데이터가 충분하지 않아 상세한 브리핑을 제공하기 어렵습니다.');
  }

  return sentences;
}
