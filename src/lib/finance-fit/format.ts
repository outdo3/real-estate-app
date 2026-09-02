// FINANCE_FIT_V1_PHASE2A §17 — 한국식 금액 표시. 만원 단위 아래는 절사해 과도한
// fake precision(예: "524,831,271원")을 만들지 않는다. 입력은 원 단위 정수를 가정한다.
export function formatWon(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.round(Math.abs(amount));

  if (abs >= 100_000_000) {
    const eok = Math.floor(abs / 100_000_000);
    const man = Math.floor((abs % 100_000_000) / 10_000);
    return man > 0 ? `${sign}${eok}억 ${man.toLocaleString('ko-KR')}만원` : `${sign}${eok}억원`;
  }
  if (abs >= 10_000) {
    const man = Math.floor(abs / 10_000);
    return `${sign}${man.toLocaleString('ko-KR')}만원`;
  }
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}

export function formatWonPerMonth(amount: number): string {
  return `${formatWon(amount)}/월`;
}

export function formatPercent(ratePercent: number): string {
  return `${ratePercent.toFixed(1)}%`;
}
