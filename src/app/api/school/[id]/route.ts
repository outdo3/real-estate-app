import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { prisma } from '@/lib/prisma';
import { getApartmentsForSchool, type ZoneRelatedApartment } from '@/lib/education/attendance-zone';
import { findNearbyApartments } from '@/lib/nearby-apartments';
import { fetchMolitData } from '@/lib/api-molit';
import { recentMonths } from '@/lib/molit-months';
import { attachLatestPrice, type TradeCandidate } from '@/lib/school-trade-price';
import { buildDecisionInsights, type ComparableApartment } from '@/lib/school-decision-insight';

// SCHOOLINFO / SCHOOL V2.1 §3~7 — canonical school identity(우선순위: NEIS
// neisSchoolCode) 기반 학교 상세 API. [id]가 실제 School.neisSchoolCode와 일치하면
// 좌표 없이도(location 없이도) 학교 기본정보+관련 아파트를 반환한다(§7 핵심 PASS
// 조건). 일치하지 않으면 기존 Kakao POI 링크(쿼리스트링 name/lat/lng/lawdCd)로
// 하위호환 렌더링한다 — 링크 형식을 바꾸지 않고 route 내부에서만 분기한다.
const MAX_RELATED = 12;
const MAX_NEARBY_CANDIDATES = 8;

export const dynamic = 'force-dynamic';

interface RelatedApartmentCard {
  aptSeq: string;
  name: string;
  dong: string | null;
  lawdCd: string | null;
  relation: 'ATTENDANCE_ZONE' | 'MIDDLE_GROUP' | 'NEARBY';
  distanceKm: number | null;
  totalHouseholds: number | null;
  buildYear: number | null;
  hasRecentPrice: boolean;
  price: string | null;
  dealAmount: number | null;
  isCurrent: boolean;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const queryName = searchParams.get('name') || '';
  const queryLat = searchParams.get('lat');
  const queryLng = searchParams.get('lng');
  const queryLawdCd = searchParams.get('lawdCd') || '';
  const currentAptSeq = searchParams.get('aptSeq') || '';

  try {
    // 1순위: canonical NEIS school code로 정확히 매칭(§4 — 이름/좌표 없이도 성립).
    let canonicalSchool = await prisma.school.findUnique({ where: { neisSchoolCode: id } });

    // 2순위: 기존 Kakao POI 링크(id가 NEIS code가 아님)로 들어왔어도, 이름+같은
    // 구/군 조합이 School 테이블에서 정확히 1건으로만 확정되면 canonical로 승격한다
    // (school/apartments/route.ts의 lookupCanonicalSchoolCoordinate와 동일한 안전
    // 원칙 — 2건 이상 모호하면 승격하지 않고 이름만으로 매칭하지 않는다).
    if (!canonicalSchool && queryName && queryLawdCd) {
      const matches = await prisma.school.findMany({ where: { schoolName: queryName, sigunguCode: queryLawdCd } });
      if (matches.length === 1) canonicalSchool = matches[0];
    }

    const isCanonical = !!canonicalSchool;
    const schoolName = canonicalSchool?.schoolName || queryName;

    if (!schoolName) {
      return NextResponse.json({ status: 'NOT_FOUND' }, { status: 404 });
    }

    // 위치(location)는 identity가 아니라 속성이다(§5) — 공식 좌표가 있으면 그것만
    // 쓰고, 없으면 쿼리스트링으로 넘어온 Kakao 좌표를 "외부 소스"로만 별도 표시한다.
    // 두 소스를 섞지 않는다(§22).
    let location: { latitude: number; longitude: number; source: 'OFFICIAL_POINT' | 'KAKAO_EXTERNAL' } | null = null;
    if (canonicalSchool?.latitude != null && canonicalSchool?.longitude != null) {
      location = { latitude: canonicalSchool.latitude, longitude: canonicalSchool.longitude, source: 'OFFICIAL_POINT' };
    } else if (queryLat && queryLng) {
      const lat = parseFloat(queryLat);
      const lng = parseFloat(queryLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        location = { latitude: lat, longitude: lng, source: 'KAKAO_EXTERNAL' };
      }
    }

    // 2. 관련 아파트 — 공식 통학구역/학교군(artifact 기반, 좌표 불필요) 우선.
    const zoneRelated: ZoneRelatedApartment[] = getApartmentsForSchool({
      neisSchoolCode: canonicalSchool?.neisSchoolCode ?? null,
      schoolName,
    });
    const zoneAptSeqs = new Set(zoneRelated.map((r) => r.aptSeq));

    // 3. nearby(거리 기반) — 위치가 있을 때만, zone/middle-group과 중복되지 않는 것만.
    let nearbyCandidates: { aptSeq: string; distanceKm: number }[] = [];
    if (location) {
      const nearby = await findNearbyApartments(location.latitude, location.longitude);
      nearbyCandidates = nearby.items
        .filter((i) => i.aptSeq && !zoneAptSeqs.has(i.aptSeq))
        .slice(0, MAX_NEARBY_CANDIDATES)
        .map((i) => ({ aptSeq: i.aptSeq!, distanceKm: i.distanceKm }));
    }

    // 4. 최종 후보 aptSeq 집합(현재 보고 있던 apt 포함 — §10/§28, 목록에 없어도 비교용으로
    // 별도 조회한다).
    const relationBySeq = new Map<string, 'ATTENDANCE_ZONE' | 'MIDDLE_GROUP' | 'NEARBY'>();
    for (const r of zoneRelated) relationBySeq.set(r.aptSeq, r.relation);
    for (const n of nearbyCandidates) if (!relationBySeq.has(n.aptSeq)) relationBySeq.set(n.aptSeq, 'NEARBY');

    // §18 — 현재 보고 있는 apartment가 이 학교와 실제 관계(zone/middle/nearby)가
    // 있으면 카드 목록 자체에서 상한(MAX_RELATED)에 밀려 잘리지 않도록 항상 먼저
    // 자리를 확보한다(잘라내기 전에 pin).
    const allCandidateSeqs = Array.from(relationBySeq.keys());
    const candidateSeqs =
      currentAptSeq && relationBySeq.has(currentAptSeq)
        ? [currentAptSeq, ...allCandidateSeqs.filter((s) => s !== currentAptSeq)].slice(0, MAX_RELATED)
        : allCandidateSeqs.slice(0, MAX_RELATED);
    const allSeqs = currentAptSeq && !candidateSeqs.includes(currentAptSeq) ? [...candidateSeqs, currentAptSeq] : candidateSeqs;

    if (allSeqs.length === 0) {
      return NextResponse.json(
        buildResponse({
          isCanonical,
          canonicalSchool,
          schoolName,
          location,
          cards: [],
          currentApartment: null,
          insights: [],
        })
      );
    }

    // 5. ApartmentMaster 일괄 조회(N+1 방지, §32) — 이미 canonical identity(aptSeq)를
    // 알고 있으므로 이름 매칭이 필요 없다.
    const masters = await prisma.apartmentMaster.findMany({
      where: { aptSeq: { in: allSeqs } },
      select: { aptSeq: true, name: true, umdName: true, sggCd: true, latitude: true, longitude: true, totalHouseholds: true, buildYear: true },
    });
    const masterBySeq = new Map(masters.map((m) => [m.aptSeq!, m]));

    // 6. 가격 — lawdCd(sggCd)별로 묶어 MOLIT 12개월치를 한 번씩만 호출한다(§27/§32,
    // 아파트 개수만큼 반복 호출하지 않음 — 기존 verified pipeline 재사용).
    const distinctLawdCds = Array.from(new Set(masters.map((m) => m.sggCd).filter((v): v is string => !!v)));
    const tradesByLawdCd = new Map<string, Awaited<ReturnType<typeof fetchMolitData>>>();
    await Promise.all(
      distinctLawdCds.map(async (lawdCd) => {
        const months = recentMonths(12);
        const monthly = await Promise.all(months.map((dealYmd) => fetchMolitData({ lawdCd, dealYmd, type: 'apt' }).catch(() => [])));
        tradesByLawdCd.set(lawdCd, monthly.flat());
      })
    );

    const priceCandidates: TradeCandidate[] = allSeqs
      .map((seq) => masterBySeq.get(seq))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ aptSeq: m.aptSeq!, name: m.name, dong: m.umdName || '' }));

    const priceByLawdCd = new Map<string, ReturnType<typeof attachLatestPrice>>();
    for (const lawdCd of distinctLawdCds) {
      const candidatesForLawd = priceCandidates.filter((c) => masterBySeq.get(c.aptSeq)?.sggCd === lawdCd);
      const trades = (tradesByLawdCd.get(lawdCd) || []) as any[];
      priceByLawdCd.set(
        lawdCd,
        attachLatestPrice(
          candidatesForLawd,
          trades.map((t) => ({ name: t.name, dong: t.dong, dealAmount: t.dealAmount, price: t.price, tradeDate: t.info?.split('•').pop()?.trim() || '', dealCanceled: !!t.dealCanceled }))
        )
      );
    }
    const priceBySeq = new Map<string, ReturnType<typeof attachLatestPrice>[number]>();
    for (const list of priceByLawdCd.values()) for (const p of list) priceBySeq.set(p.aptSeq, p);

    // 7. 카드 조립 + 거리(§23 "직선거리" 명시, 이집 계산값) — 위치가 있을 때만 계산.
    const schoolPoint = location ? point([location.longitude, location.latitude]) : null;
    const toCard = (aptSeq: string): RelatedApartmentCard | null => {
      const master = masterBySeq.get(aptSeq);
      if (!master) return null;
      const relation = relationBySeq.get(aptSeq) ?? 'NEARBY';
      const nearbyMatch = nearbyCandidates.find((n) => n.aptSeq === aptSeq);
      let distanceKm: number | null = nearbyMatch ? nearbyMatch.distanceKm : null;
      if (distanceKm == null && schoolPoint && master.latitude != null && master.longitude != null) {
        distanceKm = Math.round(distance(schoolPoint, point([master.longitude, master.latitude]), { units: 'kilometers' }) * 1000) / 1000;
      }
      const priceInfo = priceBySeq.get(aptSeq);
      return {
        aptSeq,
        name: master.name,
        dong: master.umdName,
        lawdCd: master.sggCd,
        relation,
        distanceKm,
        totalHouseholds: master.totalHouseholds,
        buildYear: master.buildYear,
        hasRecentPrice: priceInfo?.hasRecentPrice ?? false,
        price: priceInfo?.price ?? null,
        dealAmount: priceInfo?.dealAmount ?? null,
        isCurrent: aptSeq === currentAptSeq,
      };
    };

    const cards = candidateSeqs.map(toCard).filter((c): c is RelatedApartmentCard => !!c);
    // §18 정렬 — 1) 현재 보고 있는 apartment 우선, 2) relation 우선순위(공식 통학구역 >
    // 학교군 > 주변), 3) 같은 relation 안에서는 거리순.
    const relationOrder: Record<RelatedApartmentCard['relation'], number> = { ATTENDANCE_ZONE: 0, MIDDLE_GROUP: 1, NEARBY: 2 };
    cards.sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const byRelation = relationOrder[a.relation] - relationOrder[b.relation];
      if (byRelation !== 0) return byRelation;
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

    const currentApartment = currentAptSeq ? toCard(currentAptSeq) : null;
    // currentApartment가 이미 cards 안에 있으면(zone/nearby로도 잡힌 경우) 그 카드에도
    // isCurrent=true가 이미 반영돼 있다(toCard가 currentAptSeq와 비교하므로).

    const comparableList: ComparableApartment[] = cards.map((c) => ({
      aptSeq: c.aptSeq,
      name: c.name,
      distanceKm: c.distanceKm,
      dealAmount: c.dealAmount,
      buildYear: c.buildYear,
      totalHouseholds: c.totalHouseholds,
      isCurrent: c.isCurrent,
    }));
    const insights = buildDecisionInsights(comparableList);

    return NextResponse.json(
      buildResponse({ isCanonical, canonicalSchool, schoolName, location, cards, currentApartment, insights })
    );
  } catch (error) {
    console.error('Failed to load school detail:', error);
    return NextResponse.json({ status: 'ERROR' }, { status: 500 });
  }
}

function buildResponse(args: {
  isCanonical: boolean;
  canonicalSchool: Awaited<ReturnType<typeof prisma.school.findUnique>>;
  schoolName: string;
  location: { latitude: number; longitude: number; source: 'OFFICIAL_POINT' | 'KAKAO_EXTERNAL' } | null;
  cards: RelatedApartmentCard[];
  currentApartment: RelatedApartmentCard | null;
  insights: { text: string }[];
}) {
  const { isCanonical, canonicalSchool, schoolName, location, cards, currentApartment, insights } = args;
  return {
    status: 'OK',
    identity: {
      type: isCanonical ? 'CANONICAL' : 'KAKAO_ONLY',
      schoolId: canonicalSchool?.id ?? null,
      neisSchoolCode: canonicalSchool?.neisSchoolCode ?? null,
      name: schoolName,
    },
    header: canonicalSchool
      ? {
          schoolName: canonicalSchool.schoolName,
          schoolLevel: canonicalSchool.schoolLevel,
          establishmentType: canonicalSchool.establishmentType,
          genderType: canonicalSchool.genderType,
          address: canonicalSchool.address,
          roadAddress: canonicalSchool.roadAddress,
          sigunguCode: canonicalSchool.sigunguCode,
          dongName: canonicalSchool.dongName,
          isActive: canonicalSchool.isActive,
        }
      : null,
    location,
    relatedApartments: cards,
    currentApartment,
    decisionInsights: insights,
    source: {
      schoolInfoLabel: '출처: NEIS',
      derivedLabel: '이집 계산값',
    },
  };
}
