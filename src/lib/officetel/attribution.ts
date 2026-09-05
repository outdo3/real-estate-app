// OFFICETEL FINAL QA — "거래 없음"과 "동별로 귀속되지 않음"을 구분한다.
//
// 왜 필요한가: 같은 지번에 여러 동이 등록된 단지(이안해운대 5동, 퀸즈타운W 사하 5동 …)는
// 국토교통부 실거래 원천이 **동을 구분해 주지 않는다**. 그래서 STEP 3B 적재는 어느 동의
// 거래인지 확정할 수 없는 행을 어느 master에도 붙이지 않았다 — 잘못 붙이면 다른 동의
// 거래가 이 동의 것으로 보이므로, 그 판단 자체는 옳다(실측: 다중 master 지번에 연결된
// 행 0건 = 교차 오염 0).
//
// 문제는 화면이다. 연결된 행이 0건이라고 해서 "매매 거래 없음"이라고 쓰면, 실제로는
// 1,350건이 있는 주소에 대고 "거래가 없다"고 단정하게 된다. 실패한 귀속을 결측으로
// 위장하는 것이고, 데이터 진실성 원칙이 금지하는 바로 그 형태다.
//
// 이 모듈은 세 상태를 명시적으로 가른다. import가 없다 — 판정만 한다.

export type AttributionStatus =
  /** 이 master에 귀속된 거래가 실제로 있다. */
  | 'ATTRIBUTED'
  /** 이 주소에 거래는 있으나 어느 동의 것인지 확정할 수 없어 붙이지 않았다. */
  | 'UNATTRIBUTED_AT_ADDRESS'
  /** 이 주소에 거래 자체가 없다 — 검증된 진짜 0. */
  | 'NO_TRANSACTIONS';

export interface AttributionInput {
  /** 이 master에 연결된 행 수. */
  linkedSale: number;
  linkedRent: number;
  /** 같은 (구·법정동·지번)에 있으나 어느 master에도 연결되지 않은 행 수. */
  unlinkedSale: number;
  unlinkedRent: number;
  /** 같은 지번에 등록된 master 수(동 수). */
  mastersAtAddress: number;
}

export interface Attribution {
  status: AttributionStatus;
  unlinkedSale: number;
  unlinkedRent: number;
  mastersAtAddress: number;
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function resolveAttribution(input: AttributionInput): Attribution {
  const linkedSale = n(input.linkedSale);
  const linkedRent = n(input.linkedRent);
  const unlinkedSale = n(input.unlinkedSale);
  const unlinkedRent = n(input.unlinkedRent);
  const mastersAtAddress = n(input.mastersAtAddress);

  // 하나라도 귀속돼 있으면 화면은 그 데이터를 그대로 보여준다.
  if (linkedSale + linkedRent > 0) {
    return { status: 'ATTRIBUTED', unlinkedSale, unlinkedRent, mastersAtAddress };
  }
  // 귀속은 0인데 같은 주소에 거래가 있다 — "없음"이 아니라 "구분 불가"다.
  if (unlinkedSale + unlinkedRent > 0) {
    return { status: 'UNATTRIBUTED_AT_ADDRESS', unlinkedSale, unlinkedRent, mastersAtAddress };
  }
  // 원천에도 없다 — 이것만이 신뢰할 수 있는 0이다.
  return { status: 'NO_TRANSACTIONS', unlinkedSale: 0, unlinkedRent: 0, mastersAtAddress };
}

/** 탭별 빈 목록 자리에 쓸 한 줄. 상태를 뭉개지 않는다. */
export function officetelEmptyRowsLabel(
  tab: 'sale' | 'jeonse' | 'wolse',
  status: AttributionStatus
): string {
  if (status === 'UNATTRIBUTED_AT_ADDRESS') {
    return '이 주소의 거래를 동별로 구분할 수 없어 표시하지 않습니다.';
  }
  return tab === 'sale' ? '매매 거래 없음' : tab === 'jeonse' ? '전세 거래 없음' : '월세 거래 없음';
}

/**
 * 왜 비어 있는지를 설명하는 안내문. 숨기지 않고 건수까지 밝힌다 —
 * 사용자가 "이 앱이 데이터를 못 찾은 것"과 "거래가 없는 것"을 구분할 수 있어야 한다.
 */
export function officetelAttributionNote(a: Attribution): string | null {
  if (a.status !== 'UNATTRIBUTED_AT_ADDRESS') return null;
  const parts: string[] = [];
  if (a.unlinkedSale > 0) parts.push(`매매 ${a.unlinkedSale.toLocaleString()}건`);
  if (a.unlinkedRent > 0) parts.push(`전월세 ${a.unlinkedRent.toLocaleString()}건`);
  const counts = parts.join(' · ');
  const dongPart =
    a.mastersAtAddress > 1
      ? `이 지번에는 건물 ${a.mastersAtAddress}개 동이 등록되어 있습니다. `
      : '';
  return (
    `${dongPart}국토교통부 실거래 원천이 동을 구분해 제공하지 않아, ` +
    `어느 동의 거래인지 확정할 수 없는 ${counts}은 표시하지 않습니다. ` +
    `다른 동의 거래를 이 동의 거래처럼 보여주지 않기 위한 조치입니다.`
  );
}
