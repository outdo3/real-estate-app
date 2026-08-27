// [STATISTICS V2.1] 갭투자(매매-전세) pairing 로직을 순수 함수로 분리했다 —
// 원래 /api/stats/dashboard/route.ts 안에 인라인으로 있었는데, "같은 단지 +
// 같은 정확한 전용면적 + 올바른 최신 거래"라는 correctness 요건을 실제로
// 검증하려면(§15 test A~H) API 라우트를 프레임워크째 돌리지 않고 이 로직만
// 독립적으로 부를 수 있어야 했다.
//
// [FINAL IDENTITY CHECK] 최초 구현은 정규화된 단지명만으로 묶었다. 부산 4개구
// (해운대/부산진/동래/서구, 5,695건) 실측 결과 아래를 확인했다:
//   - aptSeq는 매매·전세 API 양쪽에서 100% 존재하고, 같은 물리적 단지에 대해
//     99.5%(404/406) 일치했다.
//   - "같은 이름 + 같은 동" 인데도 aptSeq/지번이 다른 진짜 다른 단지 사례를
//     찾았다(부산진구 "수목하우스" 양정동 — jibun 343-3 vs 141-10, aptSeq
//     26230-2325 vs 26230-2485). 동(dong)만으로는 이 충돌을 못 잡는다 —
//     오직 aptSeq(또는 지번)만 정확히 구분해낸다.
//   - "같은 이름 + 다른 동"인 진짜 다른 단지도 11/835(1.3%) 발견됐다(예: "삼익"
//     이 부산진구/동래구 각각에서 서로 다른 동에 2곳씩 존재).
// 이 실측을 근거로 pair identity를 aptSeq 우선으로 승격했다 — 같은 이름의
// 서로 다른 단지가 우연히 같은 전용면적 거래를 갖는 경우(이번 표본엔 0건이었지만
// 구조적으로 배제되지 않음) 여전히 오염될 수 있었기 때문이다. aptSeq가 없는
// 거래(이번 실측 4개구 전체에서 0건, 그러나 전국 다른 지역/시기에 없을 가능성을
// 배제할 수 없어 방어적으로 처리)만 (lawdCd, dong, 정규화된 이름) 조합으로
// 폴백한다. STATISTICS REGION FILTER V2 이전에는 "호출부가 이미 지역별로
// 완전히 분리해서 fetch"했기 때문에 lawdCd를 여기서 다룰 필요가 없었지만,
// 이제 호출부(dashboard/route.ts)가 시도 전체 집계 시 여러 구의 거래를 섞어서
// 넘길 수 있어 fallback key에도 lawdCd를 포함해 다른 구의 동명 케이스까지
// 안전하게 구분한다.
export interface GapTrade {
  name: string;
  dong?: string;
  lawdCd?: string;
  dealAmount: number;
  excluUseArea: number | null;
  dealDate: string; // 'YYYY-MM-DD'
  dealCanceled?: boolean;
  monthlyRent?: number;
  aptSeq?: string | null;
}

export interface GapCandidate {
  name: string;
  dong: string;
  exclusiveAreaM2: number;
  latestSale: { date: string; amount: number; tradeCount: number };
  latestJeonse: { date: string; amount: number; tradeCount: number };
  gap: number;
  // FIX_STATISTICS_DATA_TRUST — 신뢰 가능한 Unit Master 평형 조회(aptSeq 우선
  // identity)를 위해 추가. 기존 소비처는 이 필드를 몰라도 그대로 동작한다(추가
  // 전용 필드, 기존 필드는 전혀 바뀌지 않음).
  aptSeq: string | null;
  // STATISTICS REGION FILTER V2 — 시도 전체 집계에서 단지 상세로 이동할 때
  // 어느 구 소속인지 반드시 필요(다른 구 단지로 잘못 연결 방지).
  lawdCd: string | null;
}

export const normalizeAptName = (name: string): string => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// 단지 identity key. aptSeq가 있으면 최우선으로 쓰고(MOLIT 원본 단지 고유번호 —
// 같은 이름·같은 동이라도 실제로 다른 단지면 값이 다르다는 것을 실측으로 확인),
// 없을 때만 (동, 정규화된 이름)으로 폴백한다 — 동 단위로는 못 잡는 충돌이
// 있다는 걸 알고 쓰는 약한 폴백이라는 점을 주석으로 명시해 둔다.
function complexIdentityKey(t: GapTrade): string {
  if (t.aptSeq) return `seq:${t.aptSeq}`;
  return `fallback:${t.lawdCd || ''}::${t.dong || ''}::${normalizeAptName(t.name)}`;
}

// (단지 identity :: 정확한 excluUseArea) 조합을 key로 묶는다. AREA MODEL V1
// 원칙대로 근접값도 절대 병합하지 않는다 — key가 raw 숫자 그대로라 84.99와
// 84.996은 항상 다른 그룹이 된다. 취소(해제)된 거래와 excluUseArea가 없는
// 거래(파싱 실패)는 애초에 pairing 후보에서 뺀다 — null끼리 뭉치는 스푸리어스
// 매칭을 방지한다. 그룹 내부는 dealDate 내림차순으로 정렬해 배열의 첫 원소가
// 항상 실제 최신 거래이도록 보장한다(입력 배열 순서를 신뢰하지 않음).
function indexByComplexAndArea(trades: GapTrade[]): Map<string, GapTrade[]> {
  const byKey = new Map<string, GapTrade[]>();
  trades.forEach((t) => {
    if (t.dealCanceled) return;
    if (t.excluUseArea == null) return;
    const key = `${complexIdentityKey(t)}::${t.excluUseArea}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(t);
    else byKey.set(key, [t]);
  });
  byKey.forEach((arr) => arr.sort((a, b) => (a.dealDate < b.dealDate ? 1 : a.dealDate > b.dealDate ? -1 : 0)));
  return byKey;
}

// 매매 거래 목록과 "순수 전세만" 걸러진 전세 거래 목록을 받아, (단지, 정확한
// 전용면적)이 양쪽 모두에 존재하는 조합만 후보로 만든다. 한쪽만 있으면(매매만/
// 전세만) 후보 자체를 만들지 않는다(§11 — 억지로 갭을 만들지 않음). 호출부가
// 전세 목록을 이미 순수 전세로 필터링해서 넘겨야 한다(반전세/월세 제외는 이
// 함수의 책임이 아니라 호출부 책임 — dashboard/route.ts가 기존에 쓰던
// monthlyRent 필터링 관례를 그대로 따른다).
export function buildGapCandidates(aptTrades: GapTrade[], pureJeonseTrades: GapTrade[]): GapCandidate[] {
  const aptByKey = indexByComplexAndArea(aptTrades);
  const rentByKey = indexByComplexAndArea(pureJeonseTrades);

  const candidates: GapCandidate[] = [];
  aptByKey.forEach((apts, key) => {
    const rents = rentByKey.get(key);
    if (!rents || rents.length === 0) return;
    const latestApt = apts[0];
    const latestRent = rents[0];
    candidates.push({
      name: latestApt.name,
      dong: latestApt.dong || '',
      exclusiveAreaM2: latestApt.excluUseArea as number,
      latestSale: { date: latestApt.dealDate, amount: latestApt.dealAmount, tradeCount: apts.length },
      latestJeonse: { date: latestRent.dealDate, amount: latestRent.dealAmount, tradeCount: rents.length },
      gap: latestApt.dealAmount - latestRent.dealAmount,
      aptSeq: latestApt.aptSeq ?? null,
      lawdCd: latestApt.lawdCd ?? null,
    });
  });
  return candidates;
}
