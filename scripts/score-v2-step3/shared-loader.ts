/**
 * E-JIP SCORE V2 STEP 3 — step3-01의 데이터 로딩 + factor/baseline-domain 계산
 * 로직을 benchmark/pairwise 스크립트에서 재사용하기 위한 공유 모듈. 로직은
 * step3-01-full-shadow.ts와 동일(중복 재구현 아님 — 같은 함수를 그대로 옮김).
 */
import { subwayDistanceScoreV3, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore, elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS, type SubwayDataStatus } from './curves-v3';
import { T1_70_30, complexComposeCC, educationComposeEA, livingComposeLA } from './composition-v3';
import type { LivingScores } from '../score-v2-step2/composition';

export interface Row {
  aptSeq: string; name: string; sggCd: string | null; sigungu: string | null; umdName: string | null;
  subwayStatus: SubwayDataStatus; subwayRaw: number | null;
  busDist: number | null; busCount: number | null;
  age: number | null; households: number | null; parkingRatio: number | null;
  elemRaw: number | null; kgDist: number | null;
  livingRaw: { mart: number | null; convenience: number | null; pharmacy: number | null; hospital: number | null; park: number | null; daycare: number | null };
  eligible: boolean;
  identity: string; coord: string; peerEligibility: string;
}

export async function loadBusanRows() {
  const { prisma } = await import('@/lib/prisma');
  const { classify } = await import('../apartment-score/lib/peer-quality');

  const masters = await prisma.apartmentMaster.findMany({ where: { aptSeq: { not: null } } });
  const locs = await prisma.apartmentLocationFeature.findMany();
  const locByAptSeq = new Map(locs.map((l) => [l.aptSeq, l]));
  const tx = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(tx.map((t) => [t.aptSeq, t.transactionCount12m ?? 0]));
  const kindergartens = await prisma.kindergarten.findMany({ where: { latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });

  const quality = new Map(masters.map((m) => [m.aptSeq!, classify({
    aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
    totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
    buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  })]));

  function nearestKgDist(lat: number | null, lng: number | null): number | null {
    if (lat == null || lng == null) return null;
    let best = Infinity;
    for (const k of kindergartens) { const dLat = (k.latitude! - lat) * 111000; const dLng = (k.longitude! - lng) * 88000; const d = Math.sqrt(dLat * dLat + dLng * dLng); if (d < best) best = d; }
    return best < Infinity ? best : null;
  }

  const rows: Row[] = masters.map((m) => {
    const q = quality.get(m.aptSeq!)!;
    const loc = locByAptSeq.get(m.aptSeq!);
    const coordOk = q.transportPeerEligible;
    let subwayStatus: SubwayDataStatus;
    if (!coordOk) subwayStatus = 'COORD_INSUFFICIENT';
    else if (!loc) subwayStatus = 'MISSING';
    else if (loc.nearestSubwayDistanceM != null) subwayStatus = 'VALUE';
    else if (loc.qualityFlag === 'complete') subwayStatus = 'CONFIRMED_ABSENT';
    else subwayStatus = 'MISSING';

    const ratio = q.parkingPeerEligible ? (m.parkingCount as number) / (m.totalHouseholds as number) : null;
    const age = m.buildYear != null ? 2026 - m.buildYear : null;
    const kg = coordOk ? nearestKgDist(m.latitude, m.longitude) : null;

    return {
      aptSeq: m.aptSeq!, name: m.name, sggCd: m.sggCd, sigungu: m.sigungu, umdName: m.umdName,
      subwayStatus, subwayRaw: coordOk ? (loc?.nearestSubwayDistanceM ?? null) : null,
      busDist: coordOk ? (loc?.nearestBusStopDistanceM ?? null) : null, busCount: coordOk ? (loc?.busStopCount300m ?? null) : null,
      age, households: m.totalHouseholds, parkingRatio: ratio,
      elemRaw: coordOk ? (loc?.nearestElementaryDistanceM ?? null) : null, kgDist: kg,
      livingRaw: coordOk && loc ? { mart: loc.martCount1000m, convenience: loc.convenienceCount500m, pharmacy: loc.pharmacyCount500m, hospital: loc.hospitalCount1000m, park: loc.parkCount1000m, daycare: loc.daycareKindergartenCount500m } : { mart: null, convenience: null, pharmacy: null, hospital: null, park: null, daycare: null },
      eligible: q.peerEligibility === 'PEER_FULL' || q.peerEligibility === 'PEER_LIMITED',
      identity: q.identity, coord: q.coord, peerEligibility: q.peerEligibility,
    };
  });

  return { rows, masterByAptSeq: new Map(masters.map((m) => [m.aptSeq!, m])), prisma };
}

export function factorScores(r: Row) {
  const subway = subwayDistanceScoreV3(r.subwayRaw, r.subwayStatus, 'A_PIECEWISE_LINEAR');
  const busD = r.busDist != null ? busDistanceScore(r.busDist) : null;
  const busC = r.busCount != null ? busCountScore(r.busCount) : null;
  const bus = busD != null && busC != null ? busD * 0.5 + busC * 0.5 : (busD ?? busC);
  const age = r.age != null ? ageScore(r.age, 'A_PIECEWISE') : null;
  const scale = scaleScore(r.households, 'C_PIECEWISE');
  const parking = parkingScore(r.parkingRatio, 'C_PIECEWISE');
  const elementary = r.elemRaw != null ? elementaryDistanceScore(r.elemRaw) : null;
  const kindergarten = r.kgDist != null ? elementaryDistanceScore(r.kgDist) : null;
  const living: LivingScores = {
    mart: r.livingRaw.mart != null ? livingCountScore(r.livingRaw.mart, LIVING_CATEGORY_SPECS[0].halfLife) : null,
    convenience: r.livingRaw.convenience != null ? livingCountScore(r.livingRaw.convenience, LIVING_CATEGORY_SPECS[1].halfLife) : null,
    pharmacy: r.livingRaw.pharmacy != null ? livingCountScore(r.livingRaw.pharmacy, LIVING_CATEGORY_SPECS[2].halfLife) : null,
    hospital: r.livingRaw.hospital != null ? livingCountScore(r.livingRaw.hospital, LIVING_CATEGORY_SPECS[3].halfLife) : null,
    park: r.livingRaw.park != null ? livingCountScore(r.livingRaw.park, LIVING_CATEGORY_SPECS[4].halfLife) : null,
    daycare: r.livingRaw.daycare != null ? livingCountScore(r.livingRaw.daycare, LIVING_CATEGORY_SPECS[5].halfLife) : null,
  };
  return { subway, bus, age, scale, parking, elementary, kindergarten, living };
}

export function baselineDomains(r: Row) {
  const f = factorScores(r);
  const transport = T1_70_30(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION');
  const complex = complexComposeCC(f.age, f.scale, f.parking, 'M1_BOUNDED_REDISTRIBUTION');
  const education = educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION');
  const living = livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION');
  return { transport, complex, education, living, factors: f };
}
