// FIX_STATISTICS_DATA_TRUST — 기존 rankings/dashboard/transactions 통계
// route가 `exclusiveArea / 3.3058`로 만들어내던 가짜 "대표 평형"을 대체하는
// 신뢰 가능한 조회 경로. AGENTS.md Unit Master protection 원칙(§)을 그대로
// 따른다: representativePyeong은 오직 Unit Master가 제공하고(OFFICIAL_LABEL
// 또는 SUPPLY_AREA_DERIVED) canonicalExclusiveArea가 실거래 raw 전용면적과
// "정확히" 일치할 때만 쓴다 — 근접값 병합/반올림 없음(84.7855 vs 84.9950
// collision-safe). Unit Master가 없으면 null(호출부가 raw ㎡만 표시).
//
// PERFORMANCE_V1.2 — `Prisma`(타입/헬퍼 namespace, `@prisma/client` 패키지 자체)만
// import한다 — 순환 import를 유발하는 것은 로컬 싱글턴 `./prisma`의 클라이언트
// *인스턴스* import이지 이 패키지 import가 아니다(이 파일은 여전히 인스턴스를
// 인자로만 받는다, 기존 원칙 유지).
import { Prisma } from '@prisma/client';

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

interface ApartmentIdentity {
  aptSeq: string | null;
  name: string;
  dong: string | null;
}

interface ApartmentWithUnitTypes extends ApartmentIdentity {
  unitTypes: { canonicalExclusiveArea: unknown; representativePyeong: number | null; representativePyeongSource: string }[];
}

// aptSeq 우선(단일 매칭만 신뢰) / name+dong 폴백(역시 단일 매칭만 신뢰) 규칙의
// 공용 인덱스+매칭 헬퍼. 후보가 2건 이상이면(중복 Apartment row) 어느 쪽인지
// 확정할 수 없으므로 아예 매칭하지 않는다(다른 단지로 fallback 금지 원칙).
// pyeong 조회와 세대수/입주연도 조회가 정확히 같은 identity 규칙을 공유해야
// 하므로(둘 다 "다른 단지 정보를 잘못 붙이면 안 됨") 이 규칙을 한 곳에서만
// 구현한다.
function buildIdentityIndex<T extends ApartmentIdentity>(items: T[]) {
  const bySeq = new Map<string, T[]>();
  const byNameDong = new Map<string, T[]>();
  for (const a of items) {
    if (a.aptSeq) {
      if (!bySeq.has(a.aptSeq)) bySeq.set(a.aptSeq, []);
      bySeq.get(a.aptSeq)!.push(a);
    }
    const ndKey = `${a.name}|${a.dong || ''}`;
    if (!byNameDong.has(ndKey)) byNameDong.set(ndKey, []);
    byNameDong.get(ndKey)!.push(a);
  }
  return { bySeq, byNameDong };
}

function findSingleMatch<T extends ApartmentIdentity>(
  key: Pick<PyeongLookupKey, 'aptSeq' | 'name' | 'dong'>,
  index: ReturnType<typeof buildIdentityIndex<T>>
): T | null {
  if (key.aptSeq) {
    const group = index.bySeq.get(key.aptSeq);
    if (group && group.length === 1) return group[0];
  }
  const group = index.byNameDong.get(`${key.name}|${key.dong}`);
  if (group && group.length === 1) return group[0];
  return null;
}

// 순수 매칭 로직(테스트 가능) — DB에서 이미 batch 조회된 Apartment 목록과
// lookup key 목록을 받아 규칙대로 resolve한다.
export function resolvePyeongFromApartments(
  keys: PyeongLookupKey[],
  apartments: ApartmentWithUnitTypes[]
): Map<string, number> {
  const result = new Map<string, number>();
  const index = buildIdentityIndex(apartments);

  for (const key of keys) {
    const apartment = findSingleMatch(key, index);
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

export interface ApartmentContext {
  totalHouseholds: number | null;
  approvalDate: string | null;
}

interface ApartmentWithContext extends ApartmentIdentity {
  totalHouseholds: number | null;
  approvalDate: string | null;
}

// STATISTICS V2.1-2 §8/§18 — 실거래 feed/거래집중 row에 "입주연도·세대수"를
// 붙이기 위한 batch 조회. pyeong 조회와 동일한 identity 규칙(aptSeq 단일 매칭
// 우선, name+dong 단일 매칭 폴백)을 그대로 재사용한다 — 다른 단지 정보가
// 섞이면 세대수/입주연도도 Unit Master 원칙과 동일하게 신뢰 훼손이므로.
export function resolveApartmentContextFromApartments(
  keys: PyeongLookupKey[],
  apartments: ApartmentWithContext[]
): Map<string, ApartmentContext> {
  const result = new Map<string, ApartmentContext>();
  const index = buildIdentityIndex(apartments);
  for (const key of keys) {
    const apartment = findSingleMatch(key, index);
    if (!apartment) continue;
    result.set(pyeongLookupKeyId(key), {
      totalHouseholds: apartment.totalHouseholds,
      approvalDate: apartment.approvalDate,
    });
  }
  return result;
}

// PERFORMANCE_V1.2 — nameDongPairs를 Prisma의 `OR: [{name,dong}, ...]`로 넘기면
// 수천 개 조건의 OR절이 생성되어(Busan-wide dashboard 실측: 2,863쌍 기준 473ms)
// row-value IN(VALUES...) 한 번으로 바꾸면 동일 결과를 훨씬 빠르게 얻는다(같은
// 조건 214ms, 45/45 row 완전 일치 검증 — PERFORMANCE_V1.1 계열과 동일한 "Prisma가
// 생성하는 SQL 형태 자체가 느린 경우" 클래스). id만 먼저 raw SQL로 찾고, 실제
// select/include는 기존과 동일하게 Prisma로(결과 row 수가 항상 작아 — 실측
// 20~45건 — 이 단계는 원래도 느리지 않았다) 이어받는다. 두 함수(pyeong/context)가
// 완전히 동일한 identity 규칙을 쓰므로 이 id-resolution만 공유한다.
async function findApartmentIdsBySeq(prisma: any, aptSeqs: string[]): Promise<number[]> {
  if (aptSeqs.length === 0) return [];
  const rows: { id: number }[] = await prisma.$queryRaw`SELECT id FROM apartments WHERE apt_seq = ANY(${aptSeqs})`;
  return rows.map((r) => r.id);
}

async function findApartmentIdsByNameDong(prisma: any, nameDongPairs: { name: string; dong: string }[]): Promise<number[]> {
  if (nameDongPairs.length === 0) return [];
  const pairsSql = Prisma.join(
    nameDongPairs.map((p) => Prisma.sql`(${p.name}, ${p.dong})`),
    ', '
  );
  const rows: { id: number }[] = await prisma.$queryRaw`SELECT id FROM apartments WHERE (name, dong) IN (${pairsSql})`;
  return rows.map((r) => r.id);
}

function splitIdentityKeys(keys: Pick<PyeongLookupKey, 'aptSeq' | 'name' | 'dong'>[]): {
  aptSeqs: string[];
  nameDongPairs: { name: string; dong: string }[];
} {
  const aptSeqs = Array.from(new Set(keys.map((k) => k.aptSeq).filter((v): v is string => !!v)));
  const nameDongPairs = Array.from(new Set(keys.map((k) => `${k.name}|${k.dong}`))).map((p) => {
    const idx = p.indexOf('|');
    return { name: p.slice(0, idx), dong: p.slice(idx + 1) };
  });
  return { aptSeqs, nameDongPairs };
}

async function findMatchingApartmentIds(prisma: any, keys: Pick<PyeongLookupKey, 'aptSeq' | 'name' | 'dong'>[]): Promise<number[]> {
  const { aptSeqs, nameDongPairs } = splitIdentityKeys(keys);
  const [seqIds, nameDongIds] = await Promise.all([
    findApartmentIdsBySeq(prisma, aptSeqs),
    findApartmentIdsByNameDong(prisma, nameDongPairs),
  ]);
  return Array.from(new Set([...seqIds, ...nameDongIds]));
}

// keys는 pyeong 조회와 달리 rawAreaM2가 의미 없다(단지 단위 정보라 면적 무관) —
// 그래도 동일한 PyeongLookupKey 타입을 재사용해 (name, dong, aptSeq) identity만
// 쓰고, batch 쿼리/캐시 키 중복을 피하기 위해 호출부가 이미 중복 제거된 키
// 목록을 넘기도록 한다(feed route가 거래별이 아니라 그룹별로 한 번씩만 넘김).
export async function resolveApartmentContextBatch(
  prisma: any,
  keys: Pick<PyeongLookupKey, 'aptSeq' | 'name' | 'dong'>[]
): Promise<Map<string, ApartmentContext>> {
  if (keys.length === 0) return new Map();

  const ids = await findMatchingApartmentIds(prisma, keys);
  if (ids.length === 0) return new Map();
  const select = { id: true, aptSeq: true, name: true, dong: true, totalHouseholds: true, approvalDate: true };
  const apartments = await prisma.apartment.findMany({ where: { id: { in: ids } }, select });

  const fullKeys: PyeongLookupKey[] = keys.map((k) => ({ ...k, rawAreaM2: 0 }));
  return resolveApartmentContextFromApartments(fullKeys, apartments);
}

// prisma 인스턴스를 인자로 받아(순환 import 방지, 테스트 시 mock 주입 가능)
// 단 두 번의 batch 쿼리로 전체 lookup을 처리한다 — 거래 row 개수만큼 DB를
// 조회하지 않는다(N+1 금지).
export async function resolveTrustworthyPyeongBatch(prisma: any, keys: PyeongLookupKey[]): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();

  const ids = await findMatchingApartmentIds(prisma, keys);
  if (ids.length === 0) return new Map();
  // SUPABASE_EGRESS_P0_FIX_V1 — 예전에는 `include: { unitTypes: true }`라 Apartment의
  // 모든 컬럼(특히 community_facilities JSON blob)과 ApartmentUnitType의 모든 컬럼을
  // 통째로 실어 왔다. 실제로 읽는 건 아래 6개뿐이다(ApartmentWithUnitTypes 타입과 1:1,
  // resolvePyeongFromApartments가 그 외 필드를 건드리지 않음). 이 함수는 /api/transactions,
  // /api/stats/dashboard, /api/stats/rankings에서 **캐시 밖으로** 매 요청 호출되므로
  // 여기서 줄이는 바이트가 그대로 요청마다 반복된다.
  //
  // 유지 필수: aptSeq/name/dong은 identity 매칭(다른 단지 오매칭 방지)의 근거이고,
  // canonicalExclusiveArea는 Unit Master의 exact identity라 반올림/변형 금지 대상이다.
  const apartments: ApartmentWithUnitTypes[] = await prisma.apartment.findMany({
    where: { id: { in: ids } },
    select: {
      aptSeq: true,
      name: true,
      dong: true,
      unitTypes: {
        select: { canonicalExclusiveArea: true, representativePyeong: true, representativePyeongSource: true },
      },
    },
  });

  return resolvePyeongFromApartments(keys, apartments);
}
