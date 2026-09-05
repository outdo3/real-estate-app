// OFFICETEL_V1 STEP 4A — 오피스텔 상세 READ 데이터 계층. **읽기 전용**(write 경로 없음).
//
// 아키텍처는 기존 프로젝트 관례를 그대로 따른다:
//   - `prisma` 싱글턴 + `getOrSetCache`(in-flight 중복 제거 포함) — src/lib/server-cache.ts
//   - id 기반 상세 라우트 응답 형태({success,data}/404) — /api/presales/[id] 관례
// 그러나 아파트 상세의 **의미론**은 가져오지 않는다. 아파트 경로는 이름 기반 재식별 +
// 지오코딩 + 네이버 스크래핑으로 지역을 복구하는 레거시 구조인데, 오피스텔은 STEP 1~3B에서
// master id / canonicalKey라는 정확한 identity를 이미 확보했다. 느슨한 이름 해석을
// 오피스텔에 새로 들여올 이유가 없다(AGENTS.md "이름만으로 재식별 금지").
//
// ── 조회 성능의 핵심 결정 (§12) ─────────────────────────────────────────
// `officetel_*_histories`에는 **`officetel_master_id` 인덱스가 없다**(실측: pg_indexes 확인).
// Postgres는 FK에 인덱스를 자동 생성하지 않으므로 `where masterId = X`만 걸면 226,291행
// seq scan이 된다. 대신 `(canonical_key, deal_date)` 인덱스가 있으므로 **master 주소로
// 만든 building-level canonicalKey로 좁히고, `officetelMasterId`로 교차 검증**한다.
//   - 인덱스가 실제로 좁혀준다 → 빠르다
//   - masterId 조건이 §10을 강제한다 → 같은 주소의 unresolved 행(SALE 2,368 / RENT 5,012)이
//     상세에 절대 새지 않는다
// 이 STEP에서 인덱스를 추가하지 않았다(승인 필요). 필요해지면 blocker로 보고한다.
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { getOrSetCache } from '../server-cache';
import { getUniqueAreaLabels } from '../area-utils';
import { buildOfficetelHistoryKey } from './identity';
import {
  cancellationCoverageFor,
  classifyOfficetelRentType,
  officetelDisplayName,
  officetelParkingTotal,
  officetelScaleLabel,
  OFFICETEL_BLOCKED_FEATURES,
  OFFICETEL_CANCELLATION_COVERAGE_FROM,
  officetelTradeLimitations,
  type OfficetelIdRef,
  type OfficetelTxQuery,
} from './detail-contract';

/** 상세 데이터는 하루 단위로도 거의 안 바뀐다. admin/ops와 같은 5분 TTL을 쓴다. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** "최근"의 정의 — 요약 카운트에 쓰는 창(§7). */
const RECENT_MONTHS = 12;

const MASTER_SELECT = {
  id: true, canonicalKey: true, officetelName: true,
  sggCd: true, umdNm: true, jibun: true, buildingDong: true, roadAddress: true,
  buildYear: true, useApprovalDate: true, hoCnt: true, totalArea: true,
  buildingCoverageRatio: true, floorAreaRatio: true, structureName: true,
  groundFloorCount: true, undergroundFloorCount: true,
  indoorMechanicalParking: true, indoorAutoParking: true,
  outdoorMechanicalParking: true, outdoorAutoParking: true,
  buildingRegistryMainPurpose: true, buildingRegistryEtcPurpose: true,
  latitude: true, longitude: true,
} as const;

type MasterRow = Prisma.OfficetelMasterGetPayload<{ select: typeof MASTER_SELECT }>;

/** master + 이력 조회에 쓸 building-level 키. 키를 만들 수 없으면 이력 조회를 하지 않는다. */
export interface ResolvedOfficetel {
  master: MasterRow;
  historyKey: string | null;
}

/**
 * §2 — **정확한 identity로만** master를 찾는다. 이름/부분일치/근접 폴백 없음.
 * 못 찾으면 null → 호출부가 404를 준다("다른 오피스텔"을 보여주지 않는다).
 */
export async function resolveOfficetelMaster(ref: OfficetelIdRef): Promise<ResolvedOfficetel | null> {
  if (ref.kind === 'invalid') return null;
  const master = await prisma.officetelMaster.findUnique({
    where: ref.kind === 'id' ? { id: ref.id } : { canonicalKey: ref.canonicalKey },
    select: MASTER_SELECT,
  });
  if (!master) return null;
  const key = buildOfficetelHistoryKey({ sggCd: master.sggCd, umdNm: master.umdNm, jibun: master.jibun });
  return { master, historyKey: key.ok ? key.key : null };
}

const dec = (v: Prisma.Decimal | null): number | null => (v == null ? null : Number(v));
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** §3 — 저장된 실제 값만 반환한다. 없는 값은 null이며 추론하지 않는다. */
export function toMasterPayload(r: MasterRow) {
  return {
    id: r.id,
    canonicalKey: r.canonicalKey,
    name: officetelDisplayName(r.officetelName),
    address: {
      sggCd: r.sggCd,
      umdNm: r.umdNm,
      jibun: r.jibun,
      // 원천/건축물대장이 동을 명시한 경우에만 값이 있다. 추측하지 않는다.
      buildingDong: r.buildingDong,
      roadAddress: r.roadAddress,
    },
    buildYear: r.buildYear,
    useApprovalDate: r.useApprovalDate,
    // §3 SCALE — 오피스텔 규모는 **호수**다. hhldCnt(세대수)는 저장하지 않으며
    // 저장했더라도 "세대수"로 라벨링하지 않는다(복합용도 건물 맥락일 수 있음).
    scale: { unit: '호' as const, hoCnt: r.hoCnt, label: officetelScaleLabel(r.hoCnt) },
    building: {
      totalArea: dec(r.totalArea),
      buildingCoverageRatio: r.buildingCoverageRatio,
      floorAreaRatio: r.floorAreaRatio,
      structureName: r.structureName,
      groundFloorCount: r.groundFloorCount,
      undergroundFloorCount: r.undergroundFloorCount,
      // 건축물대장상 용도 표기일 뿐, 실제 주거 사용/세법상 주택 여부가 아니다.
      registryMainPurpose: r.buildingRegistryMainPurpose,
      registryEtcPurpose: r.buildingRegistryEtcPurpose,
    },
    parking: {
      indoorMechanical: r.indoorMechanicalParking,
      indoorAuto: r.indoorAutoParking,
      outdoorMechanical: r.outdoorMechanicalParking,
      outdoorAuto: r.outdoorAutoParking,
      total: officetelParkingTotal(r),
    },
    // 좌표는 실제로 있을 때만 준다. 현재 Production 보유율 0.00%라 사실상 항상 null이다.
    coordinates: r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : null,
  };
}

/** 이 master에 연결된 행만 고르는 where 조각(§10 보호의 단일 지점). */
function scopeWhere(resolved: ResolvedOfficetel) {
  return { canonicalKey: resolved.historyKey as string, officetelMasterId: resolved.master.id };
}

export interface AreaOption {
  exclusiveArea: number;
  /** 같은 목록 안에서 서로 겹치지 않도록 만든 ㎡ 라벨. 평 라벨은 만들지 않는다(§6). */
  label: string;
  count: number;
}

/**
 * §6 AREA — 이 오피스텔에 **실제로 존재하는** 전용면적만으로 옵션을 만든다.
 * 아파트의 59/84 대표평형 관례, 공급면적 추론, 평 환산 라벨을 일절 쓰지 않는다.
 */
async function loadAreaOptions(resolved: ResolvedOfficetel): Promise<{ sale: AreaOption[]; rent: AreaOption[] }> {
  if (!resolved.historyKey) return { sale: [], rent: [] };
  const where = scopeWhere(resolved);
  const [saleG, rentG] = await Promise.all([
    prisma.officetelTradeHistory.groupBy({ by: ['exclusiveArea'], where, _count: { _all: true } }),
    prisma.officetelRentHistory.groupBy({ by: ['exclusiveArea'], where, _count: { _all: true } }),
  ]);
  const build = (rows: { exclusiveArea: Prisma.Decimal; _count: { _all: number } }[]): AreaOption[] => {
    const areas = rows.map((g) => Number(g.exclusiveArea));
    const labels = getUniqueAreaLabels(areas);
    return rows
      .map((g) => {
        const a = Number(g.exclusiveArea);
        return { exclusiveArea: a, label: labels.get(a) ?? `${a}㎡`, count: g._count._all };
      })
      .sort((x, y) => x.exclusiveArea - y.exclusiveArea);
  };
  return { sale: build(saleG), rent: build(rentG) };
}

/**
 * §7 RECENT SUMMARY — 실제 이력에서만 뽑는다. 시세 추정/평가액은 계산하지 않는다.
 * SALE 최신가는 **취소 거래를 제외**하고 고른다(§4 기본 표시 규칙).
 */
async function loadSummary(resolved: ResolvedOfficetel) {
  if (!resolved.historyKey) {
    return {
      sale: { total: 0, canceled: 0, recentCount: 0, latest: null },
      rent: { total: 0, recentJeonseCount: 0, recentWolseCount: 0, latestJeonse: null, latestWolse: null },
    };
  }
  const key = resolved.historyKey;
  const mid = resolved.master.id;
  const recentFrom = new Date();
  recentFrom.setUTCMonth(recentFrom.getUTCMonth() - RECENT_MONTHS);

  // STEP 4B — 요약을 **데이터셋당 SQL 한 번**으로 모은다.
  //
  // 처음에는 count/findFirst 9개를 Promise.all로 병렬 실행했는데, 상세 페이지를 연속으로
  // 열자 Supabase pooler가 `EMAXCONNSESSION (pool_size: 15)`로 죽었다(실측). 한 페이지가
  // 커넥션 9개를 동시에 잡으면 serverless에서 동시 요청 두세 개만으로 풀이 마른다.
  // 집계와 최신 1건을 lateral join으로 합쳐 쿼리 수를 9 → 2로 줄였다.
  // `(canonical_key, deal_date)` 인덱스를 그대로 타므로 비용도 늘지 않는다.
  const [saleAgg, rentAgg] = await Promise.all([
    prisma.$queryRaw<{
      total: number; canceled: number; recent_count: number;
      deal_date: Date | null; deal_amount: number | null; exclusive_area: Prisma.Decimal | null; floor: number | null;
    }[]>`
      WITH scoped AS (
        SELECT * FROM officetel_trade_histories
         WHERE canonical_key = ${key} AND officetel_master_id = ${mid}
      )
      SELECT (SELECT COUNT(*) FROM scoped)::int AS total,
             (SELECT COUNT(*) FROM scoped WHERE deal_canceled)::int AS canceled,
             (SELECT COUNT(*) FROM scoped WHERE NOT deal_canceled AND deal_date >= ${recentFrom})::int AS recent_count,
             l.deal_date, l.deal_amount, l.exclusive_area, l.floor
        FROM (SELECT 1) d
        LEFT JOIN LATERAL (
          SELECT deal_date, deal_amount, exclusive_area, floor FROM scoped
           WHERE NOT deal_canceled ORDER BY deal_date DESC, id DESC LIMIT 1
        ) l ON TRUE`,
    prisma.$queryRaw<{
      total: number; recent_jeonse: number; recent_wolse: number;
      j_deal_date: Date | null; j_deposit: number | null; j_exclusive_area: Prisma.Decimal | null; j_floor: number | null;
      w_deal_date: Date | null; w_deposit: number | null; w_monthly_rent: number | null; w_exclusive_area: Prisma.Decimal | null; w_floor: number | null;
    }[]>`
      WITH scoped AS (
        SELECT * FROM officetel_rent_histories
         WHERE canonical_key = ${key} AND officetel_master_id = ${mid}
      )
      SELECT (SELECT COUNT(*) FROM scoped)::int AS total,
             (SELECT COUNT(*) FROM scoped WHERE monthly_rent = 0 AND deal_date >= ${recentFrom})::int AS recent_jeonse,
             (SELECT COUNT(*) FROM scoped WHERE monthly_rent > 0 AND deal_date >= ${recentFrom})::int AS recent_wolse,
             j.deal_date AS j_deal_date, j.deposit AS j_deposit, j.exclusive_area AS j_exclusive_area, j.floor AS j_floor,
             w.deal_date AS w_deal_date, w.deposit AS w_deposit, w.monthly_rent AS w_monthly_rent,
             w.exclusive_area AS w_exclusive_area, w.floor AS w_floor
        FROM (SELECT 1) d
        LEFT JOIN LATERAL (
          SELECT deal_date, deposit, exclusive_area, floor FROM scoped
           WHERE monthly_rent = 0 ORDER BY deal_date DESC, id DESC LIMIT 1
        ) j ON TRUE
        LEFT JOIN LATERAL (
          SELECT deal_date, deposit, monthly_rent, exclusive_area, floor FROM scoped
           WHERE monthly_rent > 0 ORDER BY deal_date DESC, id DESC LIMIT 1
        ) w ON TRUE`,
  ]);

  const s = saleAgg[0];
  const r = rentAgg[0];

  return {
    sale: {
      total: s?.total ?? 0,
      canceled: s?.canceled ?? 0,
      recentCount: s?.recent_count ?? 0,
      recentMonths: RECENT_MONTHS,
      latest: s?.deal_date
        ? {
            dealDate: iso(s.deal_date),
            dealAmount: s.deal_amount as number,
            exclusiveArea: Number(s.exclusive_area),
            floor: s.floor as number,
            cancellationCoverage: cancellationCoverageFor(iso(s.deal_date)),
          }
        : null,
    },
    rent: {
      total: r?.total ?? 0,
      recentJeonseCount: r?.recent_jeonse ?? 0,
      recentWolseCount: r?.recent_wolse ?? 0,
      recentMonths: RECENT_MONTHS,
      latestJeonse: r?.j_deal_date
        ? { dealDate: iso(r.j_deal_date), deposit: r.j_deposit as number, exclusiveArea: Number(r.j_exclusive_area), floor: r.j_floor as number }
        : null,
      latestWolse: r?.w_deal_date
        ? { dealDate: iso(r.w_deal_date), deposit: r.w_deposit as number, monthlyRent: r.w_monthly_rent as number, exclusiveArea: Number(r.w_exclusive_area), floor: r.w_floor as number }
        : null,
    },
  };
}

export async function getOfficetelDetail(ref: OfficetelIdRef) {
  const resolved = await resolveOfficetelMaster(ref);
  if (!resolved) return null;
  const cacheKey = `officetel:detail:v1:${resolved.master.id}`;
  return getOrSetCache(cacheKey, CACHE_TTL_MS, async () => {
    const [areas, summary] = await Promise.all([loadAreaOptions(resolved), loadSummary(resolved)]);
    return {
      master: toMasterPayload(resolved.master),
      /** 이력 조회에 실제로 쓰인 building-level 키. 디버깅/재현용으로 노출한다. */
      historyCanonicalKey: resolved.historyKey,
      areas,
      summary,
      dataQuality: {
        /** 이 master에 연결된 이력만 반환한다. 같은 주소의 unresolved 행은 포함되지 않는다. */
        historyScope: 'LINKED_TO_THIS_MASTER_ONLY' as const,
        cancellation: {
          coverageFrom: OFFICETEL_CANCELLATION_COVERAGE_FROM,
          note: `${OFFICETEL_CANCELLATION_COVERAGE_FROM} 이전 매매는 원천이 취소 여부를 제공하지 않는다. 그 구간의 "취소 아님"은 검증된 사실이 아니다.`,
        },
        rent: { hasCancellationConcept: false, note: 'RENT 원천에는 취소 관련 필드가 존재하지 않는다.' },
        /** hhldCnt는 저장하지 않는다 — 복합용도 맥락일 수 있어 "세대수"로 해석할 수 없다. */
        scaleNote: '규모는 호수(hoCnt) 기준이다. 세대수(hhldCnt)는 저장하지 않는다.',
        areaNote: '전용면적만 제공된다. 공급면적/평형은 어느 원천에도 없어 만들지 않는다.',
        blocked: OFFICETEL_BLOCKED_FEATURES,
      },
    };
  });
}

export interface TxPage {
  type: 'sale' | 'rent';
  rows: unknown[];
  meta: Record<string, unknown>;
}

/**
 * §4/§5/§8 — 거래 이력 페이지. V1은 **원시 거래 포인트**를 그대로 준다
 * (평균/중앙값을 계산해 정본처럼 제시하지 않는다 — 동일내용 형제 다중성 때문).
 */
export async function getOfficetelTransactions(ref: OfficetelIdRef, q: OfficetelTxQuery): Promise<TxPage | null> {
  const resolved = await resolveOfficetelMaster(ref);
  if (!resolved) return null;
  if (!resolved.historyKey) {
    return { type: q.type, rows: [], meta: { total: 0, limit: q.limit, offset: q.offset, hasMore: false, reason: 'CANONICAL_KEY_UNRESOLVABLE' } };
  }

  const areaFilter = q.area ? { exclusiveArea: new Prisma.Decimal(q.area) } : {};
  const base = { ...scopeWhere(resolved), ...areaFilter };
  // 전세/월세 분리는 페이지네이션 **이전**에 해야 한다 — 페이지를 받아 클라이언트에서
  // 가르면 최근 N건이 한쪽으로 쏠린 단지에서 반대쪽 탭이 빈 목록으로 보인다(§10 QA 실측).
  const rentKindFilter =
    q.rentType === 'jeonse' ? { monthlyRent: 0 } : q.rentType === 'wolse' ? { monthlyRent: { gt: 0 } } : {};

  if (q.type === 'sale') {
    // §4 — 기본은 취소 제외. includeCanceled=true는 감사/디버그용 경로다.
    const where = q.includeCanceled ? base : { ...base, dealCanceled: false };
    const [total, canceledInScope, rows] = await Promise.all([
      prisma.officetelTradeHistory.count({ where }),
      prisma.officetelTradeHistory.count({ where: { ...base, dealCanceled: true } }),
      prisma.officetelTradeHistory.findMany({
        where,
        orderBy: [{ dealDate: 'desc' }, { id: 'desc' }],
        skip: q.offset,
        take: q.limit,
        select: {
          id: true, dealDate: true, dealAmount: true, exclusiveArea: true, floor: true,
          dealCanceled: true, cancelDate: true, buildYear: true,
          dealingGbn: true, buyerGbn: true, sellerGbn: true, estateAgentSggNm: true,
          occurrenceIndex: true, source: true, sourceFetchedAt: true,
        },
      }),
    ]);
    const mapped = rows.map((r) => ({
      id: r.id,
      dealDate: iso(r.dealDate),
      dealAmount: r.dealAmount,
      exclusiveArea: Number(r.exclusiveArea),
      floor: r.floor,
      dealCanceled: r.dealCanceled,
      cancelDate: r.cancelDate,
      buildYear: r.buildYear,
      dealingGbn: r.dealingGbn,
      buyerGbn: r.buyerGbn,
      sellerGbn: r.sellerGbn,
      estateAgentSggNm: r.estateAgentSggNm,
      occurrenceIndex: r.occurrenceIndex,
      source: r.source,
      sourceFetchedAt: r.sourceFetchedAt.toISOString(),
      // §9 — 이 행의 "취소 아님"이 검증된 것인지 원천 미제공인지 행마다 밝힌다.
      cancellationCoverage: cancellationCoverageFor(iso(r.dealDate)),
    }));
    const preCoverage = mapped.filter((m) => m.cancellationCoverage === 'NOT_PROVIDED_BY_SOURCE').length;
    return {
      type: 'sale',
      rows: mapped,
      meta: {
        total, limit: q.limit, offset: q.offset, hasMore: q.offset + mapped.length < total,
        area: q.area, includeCanceled: q.includeCanceled,
        canceledInScope, canceledExcluded: q.includeCanceled ? 0 : canceledInScope,
        sampleCount: mapped.length,
        rowsWithoutCancellationCoverage: preCoverage,
        limitations: officetelTradeLimitations({ hasPreCoverageRows: preCoverage > 0, identicalSiblingRows: countIdenticalSiblings(mapped) }),
      },
    };
  }

  const rentWhere = { ...base, ...rentKindFilter };
  const [total, rows] = await Promise.all([
    prisma.officetelRentHistory.count({ where: rentWhere }),
    prisma.officetelRentHistory.findMany({
      where: rentWhere,
      orderBy: [{ dealDate: 'desc' }, { id: 'desc' }],
      skip: q.offset,
      take: q.limit,
      select: {
        id: true, dealDate: true, deposit: true, monthlyRent: true, exclusiveArea: true, floor: true,
        contractTerm: true, contractType: true, preDeposit: true, preMonthlyRent: true,
        useRenewalRight: true, buildYear: true, occurrenceIndex: true, source: true, sourceFetchedAt: true,
      },
    }),
  ]);
  const mapped = rows.map((r) => ({
    id: r.id,
    dealDate: iso(r.dealDate),
    deposit: r.deposit,
    monthlyRent: r.monthlyRent,
    rentType: classifyOfficetelRentType(r.monthlyRent),
    exclusiveArea: Number(r.exclusiveArea),
    floor: r.floor,
    // 결측은 null 그대로 — 지어내지 않는다(약 44% 결측, STEP 3A 실측).
    contractTerm: r.contractTerm,
    contractType: r.contractType,
    preDeposit: r.preDeposit,
    preMonthlyRent: r.preMonthlyRent,
    // 원천에 "미사용" 값이 없어 false는 존재하지 않는다. null = 미기재(UNKNOWN).
    useRenewalRight: r.useRenewalRight,
    buildYear: r.buildYear,
    occurrenceIndex: r.occurrenceIndex,
    source: r.source,
    sourceFetchedAt: r.sourceFetchedAt.toISOString(),
  }));
  return {
    type: 'rent',
    rows: mapped,
    meta: {
      total, limit: q.limit, offset: q.offset, hasMore: q.offset + mapped.length < total,
      area: q.area, rentType: q.rentType, sampleCount: mapped.length,
      contractTermMissing: mapped.filter((m) => m.contractTerm == null).length,
      contractTypeMissing: mapped.filter((m) => m.contractType == null).length,
      useRenewalRightUnknown: mapped.filter((m) => m.useRenewalRight == null).length,
      hasCancellationConcept: false,
      limitations: ['RENT 원천에는 취소 관련 필드가 존재하지 않는다 — 이 목록에 취소 개념은 적용되지 않는다.'],
    },
  };
}

/** 이 페이지 안에서 모든 표시 필드가 동일한 형제 거래 수(합치지 않고 세기만 한다). */
function countIdenticalSiblings(rows: { dealDate: string; dealAmount: number; exclusiveArea: number; floor: number; dealCanceled: boolean }[]): number {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.dealDate}|${r.dealAmount}|${r.exclusiveArea}|${r.floor}|${r.dealCanceled}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
}
