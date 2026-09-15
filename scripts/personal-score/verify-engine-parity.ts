/**
 * PERSONALIZED_SCORE_V1 P2-B — 계산 모듈(src/lib/personalized-score.ts) ↔ PHASE 1 감사 프로토타입 동등성 (STRICT READ ONLY).
 *
 * 부산 aptSeq 전체에 대해 기존 V2 엔진을 peer-context.ts와 같은 입력으로 돌리고, 결과를 **JSON 왕복**(API 응답과 같은 형태)한 뒤
 * 모듈과 PHASE 1 프로토타입(scripts/personal-score/simulate-personal-fit.ts의 personalFit, 아래에 그대로 복사)을 4개 프로필로 비교한다.
 * 추가로 "주차 결측인데 공통 점수는 중립값을 쓴 단지"에서 모듈이 주차를 한 번도 포함하지 않았는지 센다.
 * DB 쓰기 0, 단지명·주소 출력 0.
 *
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/personal-score/verify-engine-parity.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { performance } from 'perf_hooks';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';
import { calculateScoreV2 } from '../../src/lib/score-v2/engine';
import { adaptToV2Input } from '../../src/lib/score-v2/adapter';
import { getApartmentEducationZone } from '../../src/lib/education/attendance-zone';
import { calculatePersonalFit } from '../../src/lib/personalized-score';
import type { FitImportance } from '../../src/lib/fit-importance';

const prisma = new PrismaClient();
const V2_REFERENCE_YEAR = 2026;

// ── PHASE 1 프로토타입(변경 없이 복사) ──
type Axis = 'TRANSPORT' | 'LIVING' | 'SCHOOL' | 'NEWNESS' | 'PARKING';
function personalFit(scores: Record<Axis, number | null>, importance: Record<Axis, number>, minCoverage = 0.6) {
  const axes = Object.keys(importance) as Axis[];
  const total = axes.reduce((s, a) => s + importance[a], 0);
  const present = axes.filter((a) => scores[a] != null);
  const presentWeight = present.reduce((s, a) => s + importance[a], 0);
  const coverage = presentWeight / total;
  if (present.length === 0) return { score: null, coverage, state: 'NOT_ENOUGH_DATA' as const };
  const score = present.reduce((s, a) => s + (scores[a] as number) * importance[a], 0) / presentWeight;
  return { score, coverage, state: coverage >= minCoverage ? ('AVAILABLE' as const) : ('LIMITED' as const) };
}

const PROFILES: Record<string, Record<Axis, number>> = {
  transit_first: { TRANSPORT: 5, LIVING: 3, SCHOOL: 1, NEWNESS: 2, PARKING: 1 },
  family_school: { TRANSPORT: 2, LIVING: 4, SCHOOL: 5, NEWNESS: 3, PARKING: 3 },
  car_newbuild: { TRANSPORT: 1, LIVING: 2, SCHOOL: 1, NEWNESS: 5, PARKING: 5 },
  all_equal: { TRANSPORT: 3, LIVING: 3, SCHOOL: 3, NEWNESS: 3, PARKING: 3 },
};
const toFit = (p: Record<Axis, number>) =>
  ({ transport: p.TRANSPORT, living: p.LIVING, newness: p.NEWNESS, parking: p.PARKING, elementarySchoolAccess: p.SCHOOL }) as FitImportance;

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'personal-score/verify-engine-parity');
  const masters = await prisma.apartmentMaster.findMany({
    where: { sido: '부산', aptSeq: { not: null } },
    select: { aptSeq: true, sggCd: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true, parkingCount: true, mainBuildingCount: true, geocodeQuality: true },
  });
  const locations = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: masters.map((m) => m.aptSeq!) } } });
  const locBy = new Map(locations.map((l) => [l.aptSeq, l]));

  const stats: Record<string, { compared: number; stateMismatch: number; displayScoreMismatch: number; maxAbsRawDiff: number; coverageMismatch: number; full: number; limited: number; unavailable: number }> = {};
  for (const k of Object.keys(PROFILES)) stats[k] = { compared: 0, stateMismatch: 0, displayScoreMismatch: 0, maxAbsRawDiff: 0, coverageMismatch: 0, full: 0, limited: 0, unavailable: 0 };
  let scorable = 0;
  let commonNeutralParking = 0;
  let parkingIncludedWhileNeutral = 0;
  let calcMs = 0;
  let calcCount = 0;

  for (const m of masters) {
    const loc = locBy.get(m.aptSeq!) ?? null;
    const zone = getApartmentEducationZone(m.aptSeq!);
    const v2 = calculateScoreV2(adaptToV2Input(m as never, loc as never, (zone ? zone.elementary.status : 'NOT_AVAILABLE') as never), V2_REFERENCE_YEAR);
    if (v2.eligibility === 'NOT_ENOUGH_DATA' || v2.overallScore == null) continue;
    scorable++;
    const wire = JSON.parse(JSON.stringify(v2)); // API 응답 _shadowV2와 같은 형태
    const d = v2.domains;
    const ce = d.complex.evidence;
    const protoScores: Record<Axis, number | null> = {
      TRANSPORT: d.transport.score ?? null,
      LIVING: d.living.score ?? null,
      SCHOOL: d.education.score ?? null,
      NEWNESS: (ce.ageScore as number | null) ?? null,
      PARKING: (ce.parkingScore as number | null) ?? null,
    };
    const neutral = ce.parkingModelTreatment === 'P-D_ERA_CONDITIONED';
    if (neutral) commonNeutralParking++;

    for (const [name, prof] of Object.entries(PROFILES)) {
      const s = stats[name];
      const proto = personalFit(protoScores, prof);
      const t0 = performance.now();
      const mod = calculatePersonalFit({ shadowV2: wire, fitImportance: toFit(prof) });
      calcMs += performance.now() - t0;
      calcCount++;
      s.compared++;
      if (mod.status === 'UNAVAILABLE') {
        s.unavailable++;
        if (proto.state !== 'NOT_ENOUGH_DATA') s.stateMismatch++;
        continue;
      }
      if (mod.status === 'FULL') s.full++;
      else s.limited++;
      if (neutral && mod.includedAxes.includes('parking')) parkingIncludedWhileNeutral++;
      const protoState = proto.state === 'AVAILABLE' ? 'FULL' : proto.state === 'LIMITED' ? 'LIMITED' : 'UNAVAILABLE';
      if (protoState !== mod.status) s.stateMismatch++;
      if (proto.score != null) {
        s.maxAbsRawDiff = Math.max(s.maxAbsRawDiff, Math.abs(mod.rawScore - proto.score));
        if (Math.round(proto.score) !== mod.score) s.displayScoreMismatch++;
      }
      if (mod.coverage !== proto.coverage) s.coverageMismatch++;
    }
  }

  const pass =
    Object.values(stats).every((s) => s.stateMismatch === 0 && s.displayScoreMismatch === 0 && s.coverageMismatch === 0 && s.maxAbsRawDiff < 1e-9) &&
    parkingIncludedWhileNeutral === 0;
  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mastersBusan: masters.length,
        scorable,
        commonScoreUsedParkingNeutral: commonNeutralParking,
        personalIncludedParkingWhereCommonUsedNeutral: parkingIncludedWhileNeutral,
        profiles: stats,
        moduleMsPerCall: Math.round((calcMs / calcCount) * 100000) / 100000,
        result: pass ? 'PASS' : 'FAIL',
      },
      null,
      1
    )
  );
  if (!pass) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('failed:', (e as { code?: string }).code ?? (e as Error).name, String((e as Error).message).slice(0, 200));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
