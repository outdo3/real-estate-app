// src/app/api/transactions/route.ts가 이미 쓰던 "최근 N개월 YYYYMM 목록 생성" 로직을
// 공유 helper로 분리했다(SCHOOLINFO / SCHOOL V2.1 — 학교 관련 아파트 가격 조회도 동일
// 규칙을 써야 하므로 중복 구현하지 않는다). 순수 함수, 부작용 없음.
export function recentMonths(count: number, startOffset = 0): string[] {
  const res: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() - (startOffset + i));
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    res.push(`${y}${m}`);
  }
  return res;
}
