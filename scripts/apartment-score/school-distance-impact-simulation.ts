/**
 * SCHOOL_SCORE_IMPACT_SIMULATION_V1 — **STRICT READ ONLY** 영향 시뮬레이션.
 *
 * 질문: `nearestElementaryDistanceM`의 출처를 Kakao(현행)에서 NEIS(정식 학교 신원 +
 * 공식 좌표)로 바꾸면 E-JIP Score가 얼마나 움직이는가?
 *
 * ── 이 스크립트가 지키는 것 ────────────────────────────────────────────────
 *  - **DB 쓰기 0건.** SELECT만 한다.
 *  - **프로덕션 점수 로직을 복제하지 않는다.** `rankFeature` /
 *    `computeSchoolAccessCategory` / `resolvePeerPoolLevels` 등 실제 운영 함수를
 *    그대로 import해서 돌린다. 복제하면 시뮬레이션이 실제와 어긋나도 알 수 없다.
 *  - 바꾸는 것은 **입력 한 필드뿐**이다(nearestElementaryDistanceM). 나머지 feature,
 *    가중치, 임계값, peer 정의는 손대지 않는다.
 *
 * ── percentile이 상대값이라는 점 ───────────────────────────────────────────
 * 이게 이 시뮬레이션의 핵심이다. 41개 단지의 원본 거리만 고쳐도, 그 단지들이 속한
 * peer pool의 **다른 단지 percentile까지 함께 움직인다**. 그래서 "직접 영향"과
 * "간접 영향"을 나눠서 센다.
 *
 * 실행: npx tsx scripts/apartment-score/school-distance-impact-simulation.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '../../src/lib/prisma';
import { findNearestSchool } from '../../src/lib/report/nearest-school';
import { computeSchoolAccessCategory } from '../../src/lib/apartment-score/server/categories/school-access';
import { resolvePeerPoolLevels } from '../../src/lib/apartment-score/server/peer-groups';
import { absoluteSchoolDistanceBand } from '../../src/lib/apartment-score/server/school-distance-band';
import { CATEGORY_WEIGHTS } from '../../src/lib/apartment-score/server/config';
import type { RawLocationFeature } from '../../src/lib/apartment-score/server/types';

/** schoolAccess 카테고리가 전체 점수에서 갖는 몫. 5개 카테고리가 모두 채점될 때. */
const SCHOOL_WEIGHT_SHARE = CATEGORY_WEIGHTS.schoolAccess / 100;

interface Row {
  aptSeq: string;
  name: string;
  sggCd: string | null;
  umdName: string | null;
  buildYear: number | null;
  loc: RawLocationFeature;
  currentDistance: number | null;
  candidateDistance: number | null;
  candidateSchoolName: string | null;
}

function bucket(delta: number): string {
  const d = Math.abs(delta);
  if (d <= 5) return '0–5m';
  if (d <= 25) return '6–25m';
  if (d <= 100) return '26–100m';
  if (d <= 300) return '101–300m';
  return '>300m';
}

async function main() {
  console.log('SCHOOL_SCORE_IMPACT_SIMULATION_V1 — READ ONLY\n');

  const schools = await prisma.school.findMany({
    where: { schoolLevel: '초등학교', isActive: true, latitude: { not: null }, longitude: { not: null } },
    select: { schoolName: true, latitude: true, longitude: true },
  });

  const features = await prisma.apartmentLocationFeature.findMany();
  const masters = await prisma.apartmentMaster.findMany({
    select: { aptSeq: true, name: true, sggCd: true, umdName: true, buildYear: true },
  });
  const masterByAptSeq = new Map(masters.map((m) => [m.aptSeq, m]));

  const rows: Row[] = [];
  for (const f of features) {
    const m = masterByAptSeq.get(f.aptSeq);
    if (!m) continue;
    const neis = findNearestSchool(f.latitude, f.longitude, schools);
    rows.push({
      aptSeq: f.aptSeq,
      name: m.name,
      sggCd: m.sggCd,
      umdName: m.umdName,
      buildYear: m.buildYear,
      loc: f as unknown as RawLocationFeature,
      currentDistance: f.nearestElementaryDistanceM,
      candidateDistance: neis ? neis.distanceM : null,
      candidateSchoolName: neis ? neis.name : null,
    });
  }
  console.log(`NEIS 초등학교 ${schools.length}곳 · 분석 대상 단지 ${rows.length}건\n`);

  // ── §4 원본 거리 영향 ────────────────────────────────────────────────────
  const dist: Record<string, number> = { '0–5m': 0, '6–25m': 0, '26–100m': 0, '101–300m': 0, '>300m': 0 };
  let exact = 0, kakaoNullNeisValid = 0, neisNull = 0;
  const corrections: { row: Row; delta: number }[] = [];

  for (const r of rows) {
    if (r.candidateDistance == null) { neisNull += 1; continue; }
    if (r.currentDistance == null) { kakaoNullNeisValid += 1; continue; }
    const delta = r.candidateDistance - r.currentDistance;
    if (delta === 0) exact += 1;
    dist[bucket(delta)] += 1;
    if (Math.abs(delta) > 25) corrections.push({ row: r, delta });
  }
  corrections.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log('── §4 원본 거리 차이 분포 ──');
  for (const [k, v] of Object.entries(dist)) console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)}건`);
  console.log(`  정확히 일치      ${String(exact).padStart(5)}건`);
  console.log(`  Kakao null → NEIS 값 ${String(kakaoNullNeisValid).padStart(3)}건`);
  console.log(`  NEIS 후보 없음    ${String(neisNull).padStart(4)}건`);
  console.log(`  25m 초과 보정     ${String(corrections.length).padStart(4)}건\n`);

  console.log('── 가장 큰 보정 12건 ──');
  console.log('  aptSeq'.padEnd(16) + '단지'.padEnd(24) + '구'.padEnd(8) + '현행'.padStart(8) + '후보'.padStart(8) + '차이'.padStart(9) + '  NEIS 학교');
  for (const { row, delta } of corrections.slice(0, 12)) {
    console.log(
      '  ' + row.aptSeq.padEnd(14) + (row.name ?? '').slice(0, 22).padEnd(24) + (row.sggCd ?? '').padEnd(8) +
      String(row.currentDistance).padStart(8) + String(row.candidateDistance).padStart(8) +
      String(Math.round(delta)).padStart(9) + '  ' + (row.candidateSchoolName ?? '')
    );
  }

  // ── §5 band 전이 ─────────────────────────────────────────────────────────
  const transitions = new Map<string, number>();
  for (const r of rows) {
    const before = absoluteSchoolDistanceBand(r.currentDistance);
    const after = absoluteSchoolDistanceBand(r.candidateDistance);
    if (before === after) continue;
    const key = `${before} → ${after}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
  }
  console.log('\n── §5 band 전이(현행 임계값 200/400/650/933 그대로) ──');
  if (transitions.size === 0) console.log('  (없음)');
  for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(v).padStart(4)}건`);
  }

  // ── §6/§7 점수 시뮬레이션 — 실제 운영 함수로 ────────────────────────────
  //
  // peer pool은 sigungu 코호트 기준이다. 같은 sgg 안에서만 percentile이 만들어지므로,
  // **보정된 단지가 하나라도 있는 sgg**만 다시 계산하면 충분하다(다른 sgg는 입력이
  // 하나도 바뀌지 않아 결과가 같다). 이게 직접/간접 영향을 가르는 기준이기도 하다.
  const changedAptSeqs = new Set(
    rows.filter((r) => r.currentDistance !== r.candidateDistance).map((r) => r.aptSeq)
  );
  const affectedSgg = new Set(rows.filter((r) => changedAptSeqs.has(r.aptSeq)).map((r) => r.sggCd));
  console.log(`\n── §6/§7 점수 시뮬레이션 ──`);
  console.log(`  입력이 바뀌는 단지: ${changedAptSeqs.size}건`);
  console.log(`  영향받는 시군구: ${[...affectedSgg].filter(Boolean).join(', ')}\n`);

  const bySgg = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.sggCd ?? '';
    if (!bySgg.has(k)) bySgg.set(k, []);
    bySgg.get(k)!.push(r);
  }

  function locMapFor(cohort: Row[], candidate: boolean): Map<string, RawLocationFeature> {
    const map = new Map<string, RawLocationFeature>();
    for (const r of cohort) {
      map.set(r.aptSeq, candidate
        ? ({ ...r.loc, nearestElementaryDistanceM: r.candidateDistance } as RawLocationFeature)
        : r.loc);
    }
    return map;
  }

  const deltas: { row: Row; dCat: number; dTotal: number; direct: boolean }[] = [];

  for (const sgg of affectedSgg) {
    if (!sgg) continue;
    const cohort = bySgg.get(sgg)!;
    const peers = cohort.map((r) => ({ aptSeq: r.aptSeq, sggCd: r.sggCd, umdName: r.umdName, buildYear: r.buildYear }));
    const curMap = locMapFor(cohort, false);
    const canMap = locMapFor(cohort, true);

    for (const r of cohort) {
      const target = { aptSeq: r.aptSeq, sggCd: r.sggCd, umdName: r.umdName, buildYear: r.buildYear };
      const pool = resolvePeerPoolLevels(target, peers, false)[0];
      const before = computeSchoolAccessCategory(r.aptSeq, pool, curMap);
      const after = computeSchoolAccessCategory(r.aptSeq, pool, canMap);
      if (before.score == null || after.score == null) continue;
      const dCat = after.score - before.score;
      if (Math.abs(dCat) < 1e-9) continue;
      deltas.push({
        row: r,
        dCat,
        // 5개 카테고리가 모두 채점될 때의 몫. 일부만 채점되면 분모가 작아져 영향이 커진다.
        dTotal: dCat * SCHOOL_WEIGHT_SHARE,
        direct: changedAptSeqs.has(r.aptSeq),
      });
    }
  }

  const direct = deltas.filter((d) => d.direct);
  const indirect = deltas.filter((d) => !d.direct);
  console.log(`  점수가 움직인 단지: ${deltas.length}건`);
  console.log(`    ├ 직접(자기 입력이 바뀜):   ${direct.length}건`);
  console.log(`    └ 간접(peer 분포가 바뀜):  ${indirect.length}건`);

  // ── §9 총점 델타 분포 ────────────────────────────────────────────────────
  const buckets = { '0': 0, '>0~<0.5': 0, '0.5~1': 0, '1~2': 0, '2~3': 0, '>3': 0 };
  for (const d of deltas) {
    const a = Math.abs(d.dTotal);
    if (a === 0) buckets['0'] += 1;
    else if (a < 0.5) buckets['>0~<0.5'] += 1;
    else if (a <= 1) buckets['0.5~1'] += 1;
    else if (a <= 2) buckets['1~2'] += 1;
    else if (a <= 3) buckets['2~3'] += 1;
    else buckets['>3'] += 1;
  }
  const unchanged = rows.length - deltas.length;
  console.log('\n── §9 총점 변화 분포(점, 5개 카테고리 채점 가정) ──');
  console.log(`  변화 없음        ${String(unchanged).padStart(5)}건`);
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(16)} ${String(v).padStart(5)}건`);

  if (deltas.length) {
    const abs = deltas.map((d) => Math.abs(d.dTotal)).sort((a, b) => a - b);
    const ups = deltas.filter((d) => d.dTotal > 0).sort((a, b) => b.dTotal - a.dTotal);
    const downs = deltas.filter((d) => d.dTotal < 0).sort((a, b) => a.dTotal - b.dTotal);
    const pct = (p: number) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))];
    console.log(`\n  최대 상승  +${ups[0]?.dTotal.toFixed(2) ?? '-'}점  (${ups[0]?.row.name ?? '-'})`);
    console.log(`  최대 하락  ${downs[0]?.dTotal.toFixed(2) ?? '-'}점  (${downs[0]?.row.name ?? '-'})`);
    console.log(`  절대델타 중앙값 ${pct(0.5).toFixed(3)}점 · 95분위 ${pct(0.95).toFixed(3)}점`);
    // 반올림 후 실제로 다른 점수가 표시되는 건수(사용자가 체감하는 변화).
    const visible = deltas.filter((d) => Math.round(d.dTotal) !== 0).length;
    console.log(`  반올림 후 표시 점수가 바뀌는 단지: ${visible}건`);
  }

  // ── §12 프로덕션 예시 ────────────────────────────────────────────────────
  console.log('\n── §12 프로덕션 예시 ──');
  const byAptSeq = new Map(deltas.map((d) => [d.row.aptSeq, d]));
  const samples = [
    ...corrections.slice(0, 3).map((c) => c.row.aptSeq),
    ...rows.filter((r) => r.currentDistance == null && r.candidateDistance != null).slice(0, 1).map((r) => r.aptSeq),
    ...rows.filter((r) => r.currentDistance != null && r.currentDistance === r.candidateDistance).slice(0, 1).map((r) => r.aptSeq),
  ];
  for (const seq of samples) {
    const r = rows.find((x) => x.aptSeq === seq)!;
    const d = byAptSeq.get(seq);
    console.log(`\n  ${r.name} (${r.aptSeq})`);
    console.log(`    거리   ${r.currentDistance ?? 'null'}m → ${r.candidateDistance ?? 'null'}m  (${r.candidateSchoolName ?? '-'})`);
    console.log(`    band   ${absoluteSchoolDistanceBand(r.currentDistance)} → ${absoluteSchoolDistanceBand(r.candidateDistance)}`);
    console.log(`    학교점수 ${d ? d.dCat.toFixed(2) : '0.00'}점 변화 · 총점 ${d ? d.dTotal.toFixed(2) : '0.00'}점 변화`);
  }

  // ── §10 임계 앵커 감사 ───────────────────────────────────────────────────
  const curVals = rows.map((r) => r.currentDistance).filter((v): v is number => v != null).sort((a, b) => a - b);
  const canVals = rows.map((r) => r.candidateDistance).filter((v): v is number => v != null).sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  console.log('\n── §10 분포 비교(임계 앵커 감사) ──');
  console.log('          n      min    p10    p25    median  p75    p90    max');
  for (const [label, arr] of [['현행(Kakao)', curVals], ['후보(NEIS)', canVals]] as [string, number[]][]) {
    console.log(
      `  ${label.padEnd(12)}${String(arr.length).padStart(5)}` +
      [arr[0], q(arr, 0.1), q(arr, 0.25), q(arr, 0.5), q(arr, 0.75), q(arr, 0.9), arr[arr.length - 1]]
        .map((v) => String(Math.round(v)).padStart(7)).join('')
    );
  }
  const over933 = canVals.filter((v) => v > 933).length;
  console.log(`  후보에서 933m(현행 FAR 상한) 초과: ${over933}건 → VERY_FAR band로 떨어진다`);
}

main()
  .catch((e) => { console.error('SIMULATION FAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
