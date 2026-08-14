import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findNearbyApartments, type NearbyApartmentItem } from '@/lib/nearby-apartments';
import { fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { parsePresaleHouseType, isSimilarExclusiveArea, medianPrice } from '@/lib/presale-house-type';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';

// P2-D4-B2 — 조사 문서(16번) §11이 확정한 6→12→24개월 fallback. 이미 조회한 월은 다음
// phase에서 다시 호출하지 않는다(§9~10, §33). P2-D4-B2-CONTINUE에서 "거래 존재" 기준을
// "±1㎡ 유사면적 비교 가능 거래 존재" 기준으로 강화했다(§17 — 59㎡ 분양인데 84㎡ 거래만
// 있는 단지를 "충분"으로 조기 종료하지 않기 위함).
const MONTH_PHASES = [6, 12, 24];
const MAX_RECENT_TRANSACTIONS = 3;
const AREA_TOLERANCE = 1;

function monthsBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// 실거래 identity(§39, 이전 STEP과 동일) — MOLIT 응답에 별도 거래ID가 없어, aptSeq+거래일+
// 전용면적+층+거래금액 조합을 사실상의 원본 식별자로 사용한다.
function dedupeKey(t: any): string {
  return `${t.aptSeq}|${t.dealDate}|${t.excluUseArea}|${t.floorRaw}|${t.dealAmount}`;
}

// P2-D4-B4 — 지도 마커용 additive 필드. houseTypes[].comparisons는 "선택 주택형과 실거래
// 비교 가능한 단지만" 담고 있어(±1㎡ 조건 미충족 시 통째로 빠짐) 지도가 "주변에 물리적으로
// 존재하는 단지"를 보여주는 용도로 쓰기엔 부족하다(B4-A 문서23 §4/§15 실측 — 예: id=801/847은
// B1 기준 후보 5개 중 comparisons엔 1개만 노출). findNearbyApartments()가 이미 계산해 둔
// items를 그대로 노출만 한다 — 새 검색 로직/DB 쿼리/이름 매칭을 추가하지 않는다.
function toMapApartments(items: NearbyApartmentItem[]) {
  return items.map((i) => ({
    id: i.id, aptSeq: i.aptSeq, name: i.name,
    latitude: i.latitude, longitude: i.longitude,
    distanceKm: i.distanceKm, buildYear: i.buildYear,
  }));
}

function buildHouseTypes(
  houseTypeDetails: { id: number; houseTy: string | null; supplyArea: number | null; topAmount: number | null }[],
  items: NearbyApartmentItem[],
  tradesBySeq: Map<string, any[]>
) {
  return houseTypeDetails.map((h) => {
    const parsed = parsePresaleHouseType(h.houseTy);
    if (!parsed) {
      return {
        houseTypeDetailId: h.id, houseTy: h.houseTy, supplyArea: h.supplyArea, exclusiveArea: null,
        presaleTopAmount: h.topAmount, comparisonAvailable: false, comparisons: [],
      };
    }

    const comparisons = items
      .map((apt) => {
        const rawTrades = apt.aptSeq ? (tradesBySeq.get(apt.aptSeq) ?? []) : [];
        const comparable = rawTrades.filter(
          (t) => t.excluUseArea != null && isSimilarExclusiveArea(parsed.exclusiveArea, t.excluUseArea, AREA_TOLERANCE)
        );
        if (comparable.length === 0) return null;

        const sortedDesc = [...comparable].sort((a, b) => (a.dealDate < b.dealDate ? 1 : a.dealDate > b.dealDate ? -1 : 0));
        const seen = new Set<string>();
        const deduped: any[] = [];
        for (const t of sortedDesc) {
          const key = dedupeKey(t);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(t);
        }
        const recent = deduped.slice(0, MAX_RECENT_TRANSACTIONS);
        const recentMedianPrice = medianPrice(recent.map((t) => t.dealAmount));
        const differenceAmount = h.topAmount != null && recentMedianPrice != null ? h.topAmount - recentMedianPrice : null;

        return {
          apartment: apt,
          recentTransactions: recent.map((t) => ({
            dealAmount: t.dealAmount, dealDate: t.dealDate, exclusiveArea: t.excluUseArea, floor: t.floorRaw,
          })),
          recentMedianPrice,
          differenceAmount,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.apartment.distanceKm - b.apartment.distanceKm);

    return {
      houseTypeDetailId: h.id, houseTy: parsed.raw, supplyArea: h.supplyArea, exclusiveArea: parsed.exclusiveArea,
      presaleTopAmount: h.topAmount, comparisonAvailable: true, comparisons,
    };
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const presaleId = Number(id);

  if (!Number.isInteger(presaleId) || presaleId <= 0) {
    return NextResponse.json({ success: false, error: '잘못된 분양정보 id입니다.' }, { status: 400 });
  }

  try {
    const presale = await prisma.presale.findUnique({
      where: { id: presaleId },
      select: {
        id: true, latitude: true, longitude: true,
        houseTypeDetails: { select: { id: true, houseTy: true, supplyArea: true, topAmount: true }, orderBy: { modelNo: 'asc' } },
      },
    });

    if (!presale) {
      return NextResponse.json({ success: false, error: '분양정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (presale.latitude == null || presale.longitude == null) {
      return NextResponse.json({
        success: true,
        data: {
          presaleId, locationAvailable: false, radiusKm: null, totalCandidates: 0, nearbyApartmentCount: 0,
          monthsSearched: null, nearbyApartments: [],
          houseTypes: buildHouseTypes(presale.houseTypeDetails, [], new Map()),
        },
      });
    }

    const { radiusKm, totalCandidates, items } = await findNearbyApartments(presale.latitude, presale.longitude);

    // 비교용 전용면적 후보(파싱 성공한 주택형만) — 이게 비어 있으면(모든 주택형 파싱 실패,
    // 또는 애초에 주택형 정보가 없는 공고) MOLIT 조회 자체가 무의미하므로 건너뛴다.
    const targetAreas = presale.houseTypeDetails
      .map((h) => parsePresaleHouseType(h.houseTy)?.exclusiveArea)
      .filter((a): a is number => a != null);

    if (items.length === 0 || targetAreas.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          presaleId, locationAvailable: true, radiusKm, totalCandidates, nearbyApartmentCount: items.length,
          monthsSearched: items.length === 0 ? null : 0, nearbyApartments: toMapApartments(items),
          houseTypes: buildHouseTypes(presale.houseTypeDetails, items, new Map()),
        },
      });
    }

    const distinctSggCd = [...new Set(items.map((i) => i.sggCd).filter((s): s is string => !!s))];
    const aptSeqSet = new Set(items.map((i) => i.aptSeq).filter((s): s is string => !!s));

    const fetchedMonths: string[] = [];
    const allTrades: any[] = [];
    let monthsSearched = 0;
    let tradesBySeq = new Map<string, any[]>();

    const rebuildTradesBySeq = () => {
      const map = new Map<string, any[]>();
      for (const t of allTrades) {
        if (!t.aptSeq || !aptSeqSet.has(t.aptSeq)) continue;
        const arr = map.get(t.aptSeq) ?? [];
        arr.push(t);
        map.set(t.aptSeq, arr);
      }
      return map;
    };

    for (const phase of MONTH_PHASES) {
      const monthsNeeded = monthsBack(phase);
      const newMonths = monthsNeeded.filter((m) => !fetchedMonths.includes(m));

      const fetchPromises: Promise<any[]>[] = [];
      for (const sggCd of distinctSggCd) {
        for (const dealYmd of newMonths) {
          fetchPromises.push(
            getOrSetCache(`molit:apt:${sggCd}:${dealYmd}`, 3600 * 1000, () =>
              fetchMolitData({ type: 'apt', lawdCd: sggCd, dealYmd })
            ).catch(() => [])
          );
        }
      }
      const results = await Promise.all(fetchPromises);
      for (const trades of results) {
        if (Array.isArray(trades)) allTrades.push(...trades);
      }
      fetchedMonths.push(...newMonths);
      monthsSearched = phase;
      tradesBySeq = rebuildTradesBySeq();

      // "충분" 판정 — 단순 거래 존재가 아니라, 이 Presale의 주택형 중 하나와라도 ±1㎡
      // 이내로 비교 가능한 거래가 있는지로 판단한다(§17).
      const unresolvedCount = items.filter((apt) => {
        const trades = apt.aptSeq ? (tradesBySeq.get(apt.aptSeq) ?? []) : [];
        return !trades.some(
          (t) => t.excluUseArea != null && targetAreas.some((a) => isSimilarExclusiveArea(a, t.excluUseArea, AREA_TOLERANCE))
        );
      }).length;
      if (unresolvedCount === 0) break;
    }

    return NextResponse.json({
      success: true,
      data: {
        presaleId, locationAvailable: true, radiusKm, totalCandidates, nearbyApartmentCount: items.length,
        monthsSearched, nearbyApartments: toMapApartments(items),
        houseTypes: buildHouseTypes(presale.houseTypeDetails, items, tradesBySeq),
      },
    });
  } catch (error) {
    // MOLIT 외부 API 개별 호출은 위 fetchPromises에서 이미 .catch(() => [])로 흡수되므로,
    // 이 catch까지 도달하는 오류는 DB(Prisma)/코드 런타임 오류다 — 외부 API 오류와 섞이지 않는다.
    console.error('Failed to fetch nearby market data:', error);
    logServerError(buildErrorLogMessage('GET /api/presales/[id]/nearby-market', error), '/api/presales/[id]/nearby-market', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '주변 실거래 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
