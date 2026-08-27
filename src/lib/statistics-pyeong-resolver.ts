// FIX_STATISTICS_DATA_TRUST — 기존 rankings/dashboard/transactions 통계
// route가 `exclusiveArea / 3.3058`로 만들어내던 가짜 "대표 평형"을 대체하는
// 신뢰 가능한 조회 경로. AGENTS.md Unit Master protection 원칙(§)을 그대로
// 따른다: representativePyeong은 오직 Unit Master가 제공하고(OFFICIAL_LABEL
// 또는 SUPPLY_AREA_DERIVED) canonicalExclusiveArea가 실거래 raw 전용면적과
// "정확히" 일치할 때만 쓴다 — 근접값 병합/반올림 없음(84.7855 vs 84.9950
// collision-safe). Unit Master가 없으면 null(호출부가 raw ㎡만 표시).

export interface UnitTypeCandidate {
  canonicalExclusiveArea: number;
  representativePyeong: number | null;
  representativePyeongSource: 'OFFICIAL_LABEL' | 'SUPPLY_AREA_DERIVED' | 'UNKNOWN';
}

// Prisma Decimal↔float 왕복 오차를 흡수하기 위한 최소 허용치. 84.7855와
// 84.9950처럼 실제로 다른 raw area는 이 허용치보다 훨씬 크게 벌어져 있어
// 서로 병합되지 않는다(테스트로 고정).
const AREA_MATCH_EPSILON = 0.001;

export function matchTrustworthyPyeong(unitTypes: UnitTypeCandidate[], rawAreaM2: number): number | null {
  const match = unitTypes.find((u) => Math.abs(u.canonicalExclusiveArea - rawAreaM2) < AREA_MATCH_EPSILON);
  if (!match) return null;
  if (match.representativePyeong == null) return null;
  if (match.representativePyeongSource === 'UNKNOWN') return null;
  return match.representativePyeong;
}

export interface PyeongLookupKey {
  name: string;
  dong: string;
  aptSeq: string | null;
  rawAreaM2: number;
}

export function pyeongLookupKeyId(k: PyeongLookupKey): string {
  return `${k.aptSeq || ''}|${k.name}|${k.dong}|${k.rawAreaM2}`;
}

interface ApartmentWithUnitTypes {
  aptSeq: string | null;
  name: string;
  dong: string | null;
  unitTypes: { canonicalExclusiveArea: unknown; representativePyeong: number | null; representativePyeongSource: string }[];
}

// 순수 매칭 로직(테스트 가능) — DB에서 이미 batch 조회된 Apartment 목록과
// lookup key 목록을 받아 (aptSeq 우선, 단일 매칭만 신뢰 / name+dong 폴백,
// 역시 단일 매칭만 신뢰) 규칙으로 resolve한다. 후보가 2건 이상이면(중복
// Apartment row — 기존에 실제로 발견된 케이스) 어느 쪽인지 확정할 수 없으므로
// 아예 매칭하지 않는다(다른 단지로 fallback 금지 원칙).
export function resolvePyeongFromApartments(
  keys: PyeongLookupKey[],
  apartments: ApartmentWithUnitTypes[]
): Map<string, number> {
  const result = new Map<string, number>();

  const bySeq = new Map<string, ApartmentWithUnitTypes[]>();
  const byNameDong = new Map<string, ApartmentWithUnitTypes[]>();
  for (const a of apartments) {
    if (a.aptSeq) {
      if (!bySeq.has(a.aptSeq)) bySeq.set(a.aptSeq, []);
      bySeq.get(a.aptSeq)!.push(a);
    }
    const ndKey = `${a.name}|${a.dong || ''}`;
    if (!byNameDong.has(ndKey)) byNameDong.set(ndKey, []);
    byNameDong.get(ndKey)!.push(a);
  }

  for (const key of keys) {
    let apartment: ApartmentWithUnitTypes | null = null;
    if (key.aptSeq) {
      const group = bySeq.get(key.aptSeq);
      if (group && group.length === 1) apartment = group[0];
    }
    if (!apartment) {
      const group = byNameDong.get(`${key.name}|${key.dong}`);
      if (group && group.length === 1) apartment = group[0];
    }
    if (!apartment) continue;

    const candidates: UnitTypeCandidate[] = apartment.unitTypes.map((u) => ({
      canonicalExclusiveArea: Number(u.canonicalExclusiveArea),
      representativePyeong: u.representativePyeong,
      representativePyeongSource: u.representativePyeongSource as UnitTypeCandidate['representativePyeongSource'],
    }));
    const pyeong = matchTrustworthyPyeong(candidates, key.rawAreaM2);
    if (pyeong != null) result.set(pyeongLookupKeyId(key), pyeong);
  }

  return result;
}

// prisma 인스턴스를 인자로 받아(순환 import 방지, 테스트 시 mock 주입 가능)
// 단 두 번의 batch 쿼리로 전체 lookup을 처리한다 — 거래 row 개수만큼 DB를
// 조회하지 않는다(N+1 금지).
export async function resolveTrustworthyPyeongBatch(prisma: any, keys: PyeongLookupKey[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();

  const aptSeqs = Array.from(new Set(keys.map((k) => k.aptSeq).filter((v): v is string => !!v)));
  const nameDongPairs = Array.from(new Set(keys.map((k) => `${k.name}|${k.dong}`))).map((p) => {
    const idx = p.indexOf('|');
    return { name: p.slice(0, idx), dong: p.slice(idx + 1) };
  });

  const [bySeqRows, byNameDongRows] = await Promise.all([
    aptSeqs.length > 0
      ? prisma.apartment.findMany({ where: { aptSeq: { in: aptSeqs } }, include: { unitTypes: true } })
      : Promise.resolve([]),
    nameDongPairs.length > 0
      ? prisma.apartment.findMany({ where: { OR: nameDongPairs }, include: { unitTypes: true } })
      : Promise.resolve([]),
  ]);

  const merged = new Map<number, ApartmentWithUnitTypes>();
  for (const a of [...bySeqRows, ...byNameDongRows]) merged.set(a.id, a);

  return resolvePyeongFromApartments(keys, Array.from(merged.values()));
}
