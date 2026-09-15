/**
 * PERSONALIZED_SCORE_V1 PHASE 1 — 개인화 적합도 설계 시뮬레이션 (STRICT READ ONLY, 감사용 프로토타입).
 *
 * 1) 부산 aptSeq 전체에 대해 **기존** V2 엔진(adaptToV2Input + calculateScoreV2, peer-context.ts와 같은 입력·기준연도)을
 *    그대로 실행해 도메인/요소 점수 가용성을 집계한다. 엔진·가중치·공식은 건드리지 않는다.
 * 2) 그 결과 위에서만 "중요도 1~5 → 정규화 가중치, 결측 축 제외 후 재정규화" 프로토타입을 계산해
 *    프로필별 분포·공통 점수와의 차이·순위 상관·LIMITED 비율·계산 시간을 본다.
 *
 * 이 파일의 프로토타입은 PHASE 2 설계 근거용이며 앱 코드가 아니다. DB 쓰기 0, 단지명·주소·사용자 정보 출력 0.
 * 실행: ALLOW_PROD_DB_READ=1 npx tsx scripts/personal-score/simulate-personal-fit.ts
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

const prisma = new PrismaClient();
const V2_REFERENCE_YEAR = 2026; // peer-context.ts / calculate.ts와 동일

type Axis = 'TRANSPORT' | 'LIVING' | 'SCHOOL' | 'NEWNESS' | 'PARKING';
type Importance = Record<Axis, 1 | 2 | 3 | 4 | 5>;
type AxisScores = Record<Axis, number | null>;

/** 감사 프로토타입: 중요도 → 가중치, 결측 축 제외 후 재정규화. 결측을 0으로 두지 않는다. */
function personalFit(scores: AxisScores, importance: Importance, minCoverage = 0.6) {
  const axes = Object.keys(importance) as Axis[];
  const total = axes.reduce((s, a) => s + importance[a], 0);
  const present = axes.filter((a) => scores[a] != null);
  const presentWeight = present.reduce((s, a) => s + importance[a], 0);
  const coverage = presentWeight / total;
  if (present.length === 0) return { score: null, coverage, state: 'NOT_ENOUGH_DATA' as const };
  const score = present.reduce((s, a) => s + (scores[a] as number) * importance[a], 0) / presentWeight;
  return { score, coverage, state: coverage >= minCoverage ? ('AVAILABLE' as const) : ('LIMITED' as const) };
}

const PROFILES: Record<string, Importance> = {
  transit_first: { TRANSPORT: 5, LIVING: 3, SCHOOL: 1, NEWNESS: 2, PARKING: 1 },
  family_school: { TRANSPORT: 2, LIVING: 4, SCHOOL: 5, NEWNESS: 3, PARKING: 3 },
  car_newbuild: { TRANSPORT: 1, LIVING: 2, SCHOOL: 1, NEWNESS: 5, PARKING: 5 },
  all_equal: { TRANSPORT: 3, LIVING: 3, SCHOOL: 3, NEWNESS: 3, PARKING: 3 },
};

const pct = (xs: number[], ps = [0.1, 0.5, 0.9]) => {
  const s = [...xs].sort((a, b) => a - b);
  return ps.map((p) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10 : null));
};
function spearman(a: number[], b: number[]) {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const r = new Array(xs.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r as number[];
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0);
  return Math.round((1 - (6 * d2) / (n * (n * n - 1))) * 1000) / 1000;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'personal-score/simulate-personal-fit');
  const masters = await prisma.apartmentMaster.findMany({
    where: { sido: '부산', aptSeq: { not: null } },
    select: { aptSeq: true, sggCd: true, sigungu: true, umdName: true, buildYear: true, totalHouseholds: true, parkingCount: true, mainBuildingCount: true, geocodeQuality: true },
  });
  const locations = await prisma.apartmentLocationFeature.findMany({ where: { aptSeq: { in: masters.map((m) => m.aptSeq!) } } });
  const locBy = new Map(locations.map((l) => [l.aptSeq, l]));

  const count = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  const eligibility: Record<string, number> = {};
  const geocode: Record<string, number> = {};
  const subwayStatus: Record<string, number> = {};
  const attendance: Record<string, number> = {};
  const domainPresent: Record<string, number> = { transport: 0, living: 0, education: 0, complex: 0 };
  const factorPresent: Record<string, number> = { ageScore: 0, parkingScore_known: 0, scaleScore: 0 };
  const rows: { common: number; axes: AxisScores }[] = [];
  let noLocation = 0;
  let engineErrors = 0;

  for (const m of masters) {
    count(geocode, String(m.geocodeQuality));
    const loc = locBy.get(m.aptSeq!) ?? null;
    if (!loc) noLocation++;
    const zone = getApartmentEducationZone(m.aptSeq!);
    const zoneStatus = zone ? zone.elementary.status : 'NOT_AVAILABLE';
    count(attendance, String(zoneStatus));
    let v2;
    try {
      v2 = calculateScoreV2(adaptToV2Input(m as never, loc as never, zoneStatus as never), V2_REFERENCE_YEAR);
    } catch {
      engineErrors++;
      continue;
    }
    count(eligibility, v2.eligibility);
    const d = v2.domains as unknown as Record<string, { score: number | null; evidence?: Record<string, unknown> }>;
    for (const k of Object.keys(domainPresent)) if (d[k]?.score != null) domainPresent[k]++;
    const ce = d.complex?.evidence ?? {};
    if (ce.ageScore != null) factorPresent.ageScore++;
    if (ce.parkingScore != null) factorPresent.parkingScore_known++;
    if (ce.scaleScore != null) factorPresent.scaleScore++;
    const te = d.transport?.evidence ?? {};
    count(subwayStatus, String(te.subwayStatus ?? te.subwayDataStatus ?? (te.subwayIsSentinel ? 'SENTINEL' : d.transport?.score == null ? 'NO_TRANSPORT' : 'VALUE_OR_OTHER')));

    if (v2.eligibility === 'NOT_ENOUGH_DATA' || v2.overallScore == null) continue;
    rows.push({
      common: v2.overallScore,
      axes: {
        TRANSPORT: d.transport?.score ?? null,
        LIVING: d.living?.score ?? null,
        SCHOOL: d.education?.score ?? null,
        NEWNESS: (ce.ageScore as number | null) ?? null,
        PARKING: (ce.parkingScore as number | null) ?? null, // KNOWN만. 연령대 중립값은 개인화에 쓰지 않는다
      },
    });
  }

  const axisPresent: Record<Axis, number> = { TRANSPORT: 0, LIVING: 0, SCHOOL: 0, NEWNESS: 0, PARKING: 0 };
  for (const r of rows) for (const a of Object.keys(axisPresent) as Axis[]) if (r.axes[a] != null) axisPresent[a]++;

  const profiles: Record<string, unknown> = {};
  for (const [name, imp] of Object.entries(PROFILES)) {
    const t0 = performance.now();
    const results = rows.map((r) => personalFit(r.axes, imp));
    const ms = performance.now() - t0;
    const again = rows.map((r) => personalFit(r.axes, imp));
    const deterministic = results.every((x, i) => x.score === again[i].score && x.state === again[i].state);
    const states: Record<string, number> = {};
    results.forEach((x) => count(states, x.state));
    const ok = results.map((x, i) => ({ x, r: rows[i] })).filter(({ x }) => x.score != null);
    const deltas = ok.map(({ x, r }) => (x.score as number) - r.common);
    const personal = ok.map(({ x }) => x.score as number);
    const common = ok.map(({ r }) => r.common);
    const topN = Math.max(1, Math.floor(ok.length * 0.1));
    const topCommon = new Set(ok.map((o, i) => [o.r.common, i] as const).sort((a, b) => b[0] - a[0]).slice(0, topN).map(([, i]) => i));
    const topPersonal = ok.map((o, i) => [o.x.score as number, i] as const).sort((a, b) => b[0] - a[0]).slice(0, topN).map(([, i]) => i);
    profiles[name] = {
      importance: imp,
      states,
      personal_p10_50_90: pct(personal),
      delta_vs_common_p10_50_90: pct(deltas),
      abs_delta_ge10_share: Math.round((deltas.filter((v) => Math.abs(v) >= 10).length / deltas.length) * 1000) / 10,
      spearman_vs_common: spearman(personal, common),
      top10pct_overlap_with_common: Math.round((topPersonal.filter((i) => topCommon.has(i)).length / topN) * 1000) / 10,
      deterministic,
      calc_ms_total: Math.round(ms * 100) / 100,
      calc_ms_per_apartment: Math.round((ms / rows.length) * 10000) / 10000,
    };
  }

  // 결측 재정규화 설명 가능성 예시(가상의 한 단지 축 점수, 실데이터 아님): 학교 결측 → 나머지 재정규화
  const example = personalFit({ TRANSPORT: 80, LIVING: 70, SCHOOL: null, NEWNESS: 60, PARKING: 50 }, PROFILES.family_school);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mastersBusan: masters.length,
        noLocationFeature: noLocation,
        engineErrors,
        geocodeQuality: geocode,
        v2Eligibility: eligibility,
        v2DomainPresent: domainPresent,
        complexFactorPresent: factorPresent,
        transportSubwayEvidence: subwayStatus,
        attendanceZoneStatus: attendance,
        scorable: rows.length,
        personalAxisPresentAmongScorable: axisPresent,
        profiles,
        syntheticRenormalizationExample: { input: 'T80 L70 S=null N60 P50, family_school importance', ...example },
      },
      null,
      1
    )
  );
}

main()
  .catch((e) => {
    console.error('failed:', (e as { code?: string }).code ?? (e as Error).name, String((e as Error).message).slice(0, 200));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
