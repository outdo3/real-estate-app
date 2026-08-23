// E-JIP SCORE V2 STEP 0.7 §1 — STEP 0.5/0.6 고위험 1,725건 + MOLIT 복구후보
// 1,398건을 정확히 동일한 조건으로 재현하는 공용 모듈(step06-04와 동일 조건,
// 새 조건을 만들지 않음). READ-ONLY. 여러 step07 스크립트가 이 모듈을 재사용해
// "재현마다 조건이 미묘하게 달라지는" 위험을 없앤다.
import { prisma } from '../../../src/lib/prisma';
import { classify, type QualityInput } from './peer-quality';

export interface UniverseRow {
  aptSeq: string;
  aptName: string;
  normalizedName: string;
  lawdCd: string | null; // sggCd
  dong: string | null; // umdName
  jibun: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  lat: number | null;
  lng: number | null;
  coordinateQuality: string | null; // geocodeQuality raw
  registryLinked: boolean; // totalHouseholds != null 기준(peer-quality.ts와 동일)
  households: number | null;
  builtYear: number | null;
  mgmBldrgstPk: string | null;
  transactionCount12m: number;
}

export async function loadUniverse() {
  const masters = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { not: null } },
    select: {
      aptSeq: true, name: true, normalizedName: true, sggCd: true, umdName: true, jibun: true,
      roadAddress: true, jibunAddress: true, mgmBldrgstPk: true,
      totalHouseholds: true, parkingCount: true, mainBuildingCount: true, buildYear: true,
      geocodeQuality: true, latitude: true, longitude: true,
    },
  });
  const market = await prisma.apartmentMarketFeature.findMany({ select: { aptSeq: true, transactionCount12m: true } });
  const txMap = new Map(market.map((m) => [m.aptSeq, m.transactionCount12m ?? 0]));

  const rows: UniverseRow[] = masters.map((m) => ({
    aptSeq: m.aptSeq!,
    aptName: m.name,
    normalizedName: m.normalizedName,
    lawdCd: m.sggCd,
    dong: m.umdName,
    jibun: m.jibun,
    roadAddress: m.roadAddress,
    jibunAddress: m.jibunAddress,
    lat: m.latitude,
    lng: m.longitude,
    coordinateQuality: m.geocodeQuality,
    registryLinked: m.totalHouseholds != null,
    households: m.totalHouseholds,
    builtYear: m.buildYear,
    mgmBldrgstPk: m.mgmBldrgstPk,
    transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
  }));

  const classified = masters.map((m) => {
    const input: QualityInput = {
      aptSeq: m.aptSeq!, roadAddress: m.roadAddress, jibunAddress: m.jibunAddress, mgmBldrgstPk: m.mgmBldrgstPk,
      totalHouseholds: m.totalHouseholds, parkingCount: m.parkingCount, mainBuildingCount: m.mainBuildingCount,
      buildYear: m.buildYear, geocodeQuality: m.geocodeQuality, latitude: m.latitude, longitude: m.longitude,
      transactionCount12m: txMap.get(m.aptSeq!) ?? 0,
    };
    return { aptSeq: m.aptSeq!, q: classify(input) };
  });
  const highRiskSeqs = new Set(
    classified.filter((r) => r.q.coord === 'COORD_LOW' && !r.q.hasAddress && !r.q.registryLinked).map((r) => r.aptSeq)
  );

  const rowByAptSeq = new Map(rows.map((r) => [r.aptSeq, r]));
  const highRisk = rows.filter((r) => highRiskSeqs.has(r.aptSeq));
  // C. mgmBldrgstPk 없음(§19와 동일 — highRisk 자체가 이미 주소 없음 조건이라 사실상 전원 없음) + transactionCount12m>=1
  const molitCandidates = highRisk.filter((r) => r.mgmBldrgstPk == null && r.transactionCount12m >= 1);
  const noEvidence = highRisk.filter((r) => r.mgmBldrgstPk == null && r.transactionCount12m === 0);

  return { all: rows, highRisk, molitCandidates, noEvidence, rowByAptSeq };
}
