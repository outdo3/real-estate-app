// STATISTICS V2.1-4 §20/§26 — 대단지 랭킹 DATA TRUST 감사 중 실측 확인: ApartmentMaster는
// 한 총괄표제부(mgmBldrgstPk)에 속한 여러 동/구역이 각각 별도 aptSeq row로 저장돼 있고,
// totalHouseholds는 그 총괄표제부 전체의 공통값이 각 row에 그대로 복제돼 있다(예:
// "엘지메트로시티1~5, 4-1, 4-2" 7개 row가 전부 mgmBldrgstPk="103413424", 세대수 7,374로
// 동일). 세대수 DESC로 그대로 정렬하면 같은 단지가 여러 번 상위권을 차지해 "다른 대단지
// 여러 곳"처럼 보이는 착시가 생긴다(실측: 상위 10건 중 9건이 실제로는 단 2개 단지).
// mgmBldrgstPk가 같은 row는 하나의 대표 row만 남긴다 — 이름을 새로 만들지 않고, 실제
// 존재하는 이름 중 결정론적 규칙(가장 짧은 이름, 동률이면 aptSeq 오름차순)으로 하나만
// 고른다(추정/재작성 없음).
export interface DedupableComplex {
  id: number;
  name: string;
  aptSeq: string | null;
  mgmBldrgstPk: string | null;
}

export function dedupeByRegistryGroup<T extends DedupableComplex>(rows: T[]): T[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.mgmBldrgstPk ? `pk:${r.mgmBldrgstPk}` : `row:${r.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const result: T[] = [];
  for (const group of byKey.values()) {
    const rep = [...group].sort((a, b) => {
      const lenDiff = a.name.length - b.name.length;
      if (lenDiff !== 0) return lenDiff;
      return (a.aptSeq || '').localeCompare(b.aptSeq || '');
    })[0];
    result.push(rep);
  }
  return result;
}
