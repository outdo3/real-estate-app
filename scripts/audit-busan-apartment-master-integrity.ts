/**
 * BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1 — §15 Busan full integrity audit.
 *
 * Read-only. DB write 없음. 외부 API 호출 없음(순수 DB 비교). ApartmentMaster ↔
 * legacy Apartment ↔ ApartmentTradeHistory 3개 source를 상호 비교해 identity/필드
 * 충돌을 수치화한다. Production data는 절대 건드리지 않는다 — 이 스크립트는 감사만
 * 한다(수정 후보는 별도 JSON으로만 출력, DB write는 scripts/*_repair* 어디에도 없음).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { prisma } from '../src/lib/prisma';
import { normalizeSearchKeyword } from '../src/lib/search-ranking';

const BUSAN_LAWD_CODES = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];

// 부산 대략 bounding box(위경도) — anomaly 탐지용, 정밀 행정경계 아님.
const BUSAN_BBOX = { latMin: 34.87, latMax: 35.40, lngMin: 128.75, lngMax: 129.32 };

interface RepairCandidate {
  aptSeq: string | null;
  identityKey: string;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  authoritativeSource: string;
  evidence: string;
  confidence: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED';
  severity: 'P0' | 'P1' | 'P2';
  action: string;
}

async function main() {
  const repairCandidates: RepairCandidate[] = [];

  const masters = await prisma.apartmentMaster.findMany({
    where: { sggCd: { in: BUSAN_LAWD_CODES } },
  });
  console.log(`TOTAL_MASTER: ${masters.length}`);

  const legacyRows = await prisma.apartment.findMany({
    where: { lawdCd: { in: BUSAN_LAWD_CODES } },
  });
  console.log(`TOTAL_LEGACY(부산): ${legacyRows.length}`);

  const tradeGroups = await prisma.apartmentTradeHistory.groupBy({
    by: ['aptSeq'],
    where: { lawdCd: { in: BUSAN_LAWD_CODES }, dealType: 'sale', dealCanceled: false, aptSeq: { not: null } },
    _count: { _all: true },
    _max: { aptName: true, dong: true, jibun: true, buildYear: true },
    _min: { dealDate: true },
  });
  console.log(`TRADED_APTSEQ(부산, aptSeq 있음): ${tradeGroups.length}`);

  const masterByAptSeq = new Map(masters.filter((m) => m.aptSeq).map((m) => [m.aptSeq!, m]));
  const masterByNameDong = new Map(masters.map((m) => [`${normalizeSearchKeyword(m.name)}|${m.umdName}`, m]));

  // ===== MASTER vs TRADE =====
  let masterMatch = 0;
  let masterMissing = 0;
  let nameConflict = 0;
  let jibunConflict = 0;
  let dongConflict = 0;
  let buildYearConflict = 0;
  const missingList: { aptSeq: string; aptName: string; dong: string | null; jibun: string | null; tradeCount: number; hasLegacy: boolean }[] = [];
  const conflictSamples: Record<string, { aptSeq: string; detail: string }[]> = { name: [], jibun: [], dong: [], buildYear: [] };

  for (const g of tradeGroups) {
    const aptSeq = g.aptSeq!;
    const master = masterByAptSeq.get(aptSeq);
    if (!master) {
      masterMissing++;
      const hasLegacy = legacyRows.some((l) => l.aptSeq === aptSeq);
      missingList.push({ aptSeq, aptName: g._max.aptName || '', dong: g._max.dong, jibun: g._max.jibun, tradeCount: g._count._all, hasLegacy });
      continue;
    }
    masterMatch++;

    if (normalizeSearchKeyword(master.name) !== normalizeSearchKeyword(g._max.aptName || '')) {
      nameConflict++;
      if (conflictSamples.name.length < 10) conflictSamples.name.push({ aptSeq, detail: `master="${master.name}" trade="${g._max.aptName}"` });
    }
    if (g._max.jibun && master.jibun && g._max.jibun !== master.jibun) {
      jibunConflict++;
      if (conflictSamples.jibun.length < 10) conflictSamples.jibun.push({ aptSeq, detail: `master jibun="${master.jibun}" trade jibun="${g._max.jibun}"` });
    }
    if (g._max.dong && master.umdName && g._max.dong !== master.umdName) {
      dongConflict++;
      if (conflictSamples.dong.length < 10) conflictSamples.dong.push({ aptSeq, detail: `master dong="${master.umdName}" trade dong="${g._max.dong}"` });
    }
    if (g._max.buildYear && master.buildYear && Math.abs(g._max.buildYear - master.buildYear) > 1) {
      buildYearConflict++;
      if (conflictSamples.buildYear.length < 10) conflictSamples.buildYear.push({ aptSeq, detail: `master buildYear=${master.buildYear} trade buildYear=${g._max.buildYear}` });
    }
  }

  // ===== LEGACY IDENTITY CONTAMINATION =====
  // §19: legacy Apartment row의 (name+dong)이 ApartmentMaster의 같은 (name+dong)과
  // exact match하는데 jibun이 다르면 — 해운대경동제이드 패턴의 일반화된 탐지.
  let legacyOnly = 0;
  let legacyContamination = 0;
  const contaminationSamples: { legacyId: number; name: string; dong: string | null; legacyJibun: string | null; masterJibun: string | null; masterAptSeq: string | null }[] = [];

  for (const l of legacyRows) {
    const key = `${normalizeSearchKeyword(l.name)}|${l.dong}`;
    const master = masterByNameDong.get(key);
    if (!master) {
      legacyOnly++;
      continue;
    }
    if (l.jibun && master.jibun && l.jibun !== master.jibun) {
      legacyContamination++;
      if (contaminationSamples.length < 20) {
        contaminationSamples.push({ legacyId: l.id, name: l.name, dong: l.dong, legacyJibun: l.jibun, masterJibun: master.jibun, masterAptSeq: master.aptSeq });
      }
      repairCandidates.push({
        aptSeq: master.aptSeq,
        identityKey: `${l.name}|${l.dong}`,
        field: 'legacy_apartment.jibun/totalHouseholds/approvalDate/parkingCount/far/bcr',
        currentValue: { jibun: l.jibun, totalHouseholds: l.totalHouseholds, approvalDate: l.approvalDate },
        proposedValue: { jibun: master.jibun, totalHouseholds: master.totalHouseholds, approvalDate: master.useApprovalDate },
        authoritativeSource: `ApartmentMaster(aptSeq=${master.aptSeq}, name+dong exact match)`,
        evidence: `legacy Apartment id=${l.id}("${l.name}", ${l.dong}) has jibun="${l.jibun}" but ApartmentMaster canonical row for the same name+dong has jibun="${master.jibun}" — same identity-contamination pattern as the documented 해운대경동제이드 case (SEARCH_DETAIL_IDENTITY_HOTFIX_V2)`,
        confidence: 'REVIEW_REQUIRED',
        severity: 'P0',
        action: 'code self-heal already exists in info/route.ts (cacheIdentityMismatch guard) — row will self-correct on next resolved live request; no manual DB write needed unless self-heal is confirmed not to fire',
      });
    }
  }

  // ===== HOUSEHOLD / COORDINATE OUTLIERS (ApartmentMaster) =====
  let householdOutliers = 0;
  let coordinateInvalid = 0;
  const householdOutlierSamples: { aptSeq: string; name: string; totalHouseholds: number | null; parkingCount: number | null; parkingPerHousehold: number | null; basicSpecSource: string; mainBuildingCount: number | null }[] = [];
  const coordinateSamples: { aptSeq: string; name: string; issue: string; lat: number | null; lng: number | null }[] = [];

  for (const m of masters) {
    // household outlier heuristic(§9 — outlier detector일 뿐, 자동 수정 아님).
    // 보정 근거(실측 calibration, scripts/_household-calibration-adhoc.ts):
    //   - basicSpecSource=BUILDINGHUB_TITLE(단일 건물 표제부 fallback)이면서
    //     mainBuildingCount=null인 row는 부산 전체 1,720건 중 대다수를 차지한다 —
    //     이는 정상적인 "진짜 단일 동" 단지에서도 항상 나타나는 값이라(표제부 자체가
    //     동수 개념이 없어 이 소스를 쓰는 모든 row가 mainBuildingCount=null이다),
    //     이 조건만으로는 outlier 신호가 되지 못한다(제거 — 과거 버전에서 1,741건의
    //     노이즈를 만들었던 원인).
    //   - parkingPerHousehold(세대당 주차대수) 단독으로는 임계값 5 초과가 부산 전체
    //     3,402행 중 31건뿐이고, 그중 30건이 BUILDINGHUB_TITLE 소스와 겹친다(유일한
    //     예외: 엘시티, households=882, source=BUILDINGHUB_GENERAL_TITLE — 실제
    //     고급 초고층 주상복합의 실제 특성으로 판단, outlier 아님).
    //   - 따라서 "pph>5 AND source=BUILDINGHUB_TITLE"만 outlier로 표시한다 — 세대당
    //     주차 5대 초과는 물리적으로 비현실적이고(총괄표제부 없이 단일 표제부만으로
    //     채운 값이라 "그 지번의 일부 건물만" 반영했을 위험이 구조적으로 존재),
    //     GENERAL_TITLE(총괄표제부, 복합단지 전체 집계) 소스는 이 위험이 없다.
    const pph = m.parkingPerHousehold;
    const isHouseholdOutlier = pph != null && pph > 5 && m.basicSpecSource === 'BUILDINGHUB_TITLE';

    if (isHouseholdOutlier) {
      householdOutliers++;
      if (householdOutlierSamples.length < 30) {
        householdOutlierSamples.push({
          aptSeq: m.aptSeq || '', name: m.name, totalHouseholds: m.totalHouseholds,
          parkingCount: m.parkingCount, parkingPerHousehold: pph,
          basicSpecSource: m.basicSpecSource, mainBuildingCount: m.mainBuildingCount,
        });
      }
      if (m.aptSeq) {
        repairCandidates.push({
          aptSeq: m.aptSeq,
          identityKey: m.aptSeq,
          field: 'totalHouseholds',
          currentValue: m.totalHouseholds,
          proposedValue: null,
          authoritativeSource: '건축물대장 표제부(단일 건물, BldRgstHubService getBrTitleInfo) — 총괄표제부(복합단지 전체) 레코드 없음',
          evidence: `basicSpecSource=BUILDINGHUB_TITLE(단일 건물 표제부 fallback) + mainBuildingCount=null(총괄표제부 부재로 동수 미확인) + parkingPerHousehold=${pph?.toFixed(2)} — 복합단지 중 한 개 동(건물)의 세대수만 저장됐을 위험. 총괄표제부 재조회 또는 동별 표제부 합산이 필요(이번 STEP에서 미실행, 대표사례 경동/aptSeq=26350-2에서 실측 확인: 건물"103동" 단독 72세대, 8개동 복합단지 주장 대비 총괄표제부 0건).`,
          confidence: 'REVIEW_REQUIRED',
          severity: 'P1',
          action: 'NO_AUTO_CORRECTION — 외부 서비스 수치(예: 892세대)를 그대로 채택하지 않는다. 총괄표제부 부재 시 동별 표제부 전수 합산 등 별도 조사/승인 STEP 필요.',
        });
      }
    }

    // coordinate audit
    if (m.latitude == null || m.longitude == null) {
      coordinateInvalid++;
    } else if (m.latitude === 0 && m.longitude === 0) {
      coordinateInvalid++;
      if (coordinateSamples.length < 10) coordinateSamples.push({ aptSeq: m.aptSeq || '', name: m.name, issue: 'ZERO_ZERO', lat: m.latitude, lng: m.longitude });
    } else if (
      m.latitude < BUSAN_BBOX.latMin || m.latitude > BUSAN_BBOX.latMax ||
      m.longitude < BUSAN_BBOX.lngMin || m.longitude > BUSAN_BBOX.lngMax
    ) {
      coordinateInvalid++;
      if (coordinateSamples.length < 10) coordinateSamples.push({ aptSeq: m.aptSeq || '', name: m.name, issue: 'OUTSIDE_BUSAN_BBOX', lat: m.latitude, lng: m.longitude });
    }
  }

  const identityMatchRate = tradeGroups.length > 0 ? (masterMatch / tradeGroups.length) * 100 : 0;
  const coordinateValidRate = masters.length > 0 ? ((masters.length - coordinateInvalid) / masters.length) * 100 : 0;
  const householdTrustRate = masters.length > 0 ? ((masters.length - householdOutliers) / masters.length) * 100 : 0;

  const result = {
    TOTAL_MASTER: masters.length,
    TOTAL_LEGACY: legacyRows.length,
    TRADED_APTSEQ: tradeGroups.length,
    MASTER_MATCH: masterMatch,
    MASTER_MISSING: masterMissing,
    LEGACY_ONLY: legacyOnly,
    NAME_CONFLICT: nameConflict,
    JIBUN_CONFLICT: jibunConflict,
    DONG_CONFLICT: dongConflict,
    HOUSEHOLD_OUTLIERS: householdOutliers,
    BUILD_YEAR_CONFLICT: buildYearConflict,
    COORDINATE_INVALID: coordinateInvalid,
    LEGACY_IDENTITY_CONTAMINATION: legacyContamination,
    SCORECARD: {
      IDENTITY_MATCH_RATE: `${identityMatchRate.toFixed(2)}%`,
      HOUSEHOLD_TRUST_RATE: `${householdTrustRate.toFixed(2)}%`,
      COORDINATE_VALID_RATE: `${coordinateValidRate.toFixed(2)}%`,
      MASTER_COVERAGE: `${identityMatchRate.toFixed(2)}%`,
      LEGACY_CONTAMINATION_RATE: legacyRows.length > 0 ? `${((legacyContamination / legacyRows.length) * 100).toFixed(2)}%` : '0%',
    },
  };

  console.log('\n========== RESULT ==========');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n===== MASTER_MISSING 목록 (16 fixture 포함 여부 확인용) =====');
  for (const m of missingList) console.log(`  ${m.aptSeq} ${m.aptName} (${m.dong}) trades=${m.tradeCount} hasLegacy=${m.hasLegacy}`);

  console.log('\n===== 충돌 샘플 =====');
  for (const [k, v] of Object.entries(conflictSamples)) {
    if (v.length === 0) continue;
    console.log(`  -- ${k} --`);
    for (const s of v) console.log(`    ${s.aptSeq}: ${s.detail}`);
  }

  console.log('\n===== LEGACY_IDENTITY_CONTAMINATION 샘플 =====');
  for (const c of contaminationSamples) {
    console.log(`  legacyId=${c.legacyId} "${c.name}"(${c.dong}) legacyJibun=${c.legacyJibun} masterJibun=${c.masterJibun} masterAptSeq=${c.masterAptSeq}`);
  }

  console.log('\n===== HOUSEHOLD OUTLIER 샘플 =====');
  for (const h of householdOutlierSamples) {
    console.log(`  ${h.aptSeq} ${h.name} households=${h.totalHouseholds} parking=${h.parkingCount} pph=${h.parkingPerHousehold?.toFixed(2)} source=${h.basicSpecSource} mainBldCnt=${h.mainBuildingCount}`);
  }

  console.log('\n===== COORDINATE 이상 샘플 =====');
  for (const c of coordinateSamples) console.log(`  ${c.aptSeq} ${c.name}: ${c.issue} (${c.lat}, ${c.lng})`);

  // repair candidates 저장
  const outDir = path.resolve(__dirname, '../data/master-integrity');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'busan-master-repair-candidates.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), totalCandidates: repairCandidates.length, candidates: repairCandidates }, null, 2)
  );
  console.log(`\nrepair candidates 저장: data/master-integrity/busan-master-repair-candidates.json (${repairCandidates.length}건)`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
