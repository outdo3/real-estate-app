/**
 * SCORE V1.1 — 부산 16개 구·군 coverage audit. 실제 DB 데이터를 읽기 전용으로
 * 조회해 리포트를 콘솔에 출력한다. production route(calculate.ts)의 로직을
 * 그대로 재사용한다(§43 — audit과 runtime 로직 분리, 계산 방식을 스크립트에서
 * 새로 만들지 않음).
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/apartment-score/busan-coverage-audit.ts
 */
import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { resolvePeerPool, type PeerCandidate } from '@/lib/apartment-score/server/peer-groups';
import { computeRegionalStrengths } from '@/lib/apartment-score/server/regional-premium';
import { PREPARING_REASON_ADMIN_LABEL } from '@/lib/apartment-score/server/preparing-reason';
import type { RawLocationFeature } from '@/lib/apartment-score/server/types';

// [실측 확인] ApartmentMaster.sido는 "부산광역시"가 아니라 "부산"으로 저장돼 있다
// (추정하지 않고 DB에서 직접 확인 — sample row 조회 결과).
const SIDO_VALUE = '부산';

const BUSAN_GUGUN = [
  '강서구', '금정구', '기장군', '남구', '동구', '동래구', '부산진구', '북구',
  '사상구', '사하구', '서구', '수영구', '연제구', '영도구', '중구', '해운대구',
];

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.round((p / 100) * (sortedAsc.length - 1)));
  return sortedAsc[idx];
}

function fmtPct(n: number, d: number): string {
  if (d === 0) return 'n/a';
  return `${((100 * n) / d).toFixed(1)}%`;
}

async function main() {
  console.log('=================================================');
  console.log('BUSAN SCORE READINESS AUDIT — SCORE V1.1');
  console.log('=================================================\n');

  const allMaster = await prisma.apartmentMaster.findMany({
    where: { sido: SIDO_VALUE, aptSeq: { not: null } },
    select: { aptSeq: true, name: true, sigungu: true, umdName: true, sggCd: true, buildYear: true },
  });
  console.log('total ApartmentMaster rows (부산, aptSeq not null):', allMaster.length);

  const missingSigungu = allMaster.filter((r) => !r.sigungu).length;
  console.log('sigungu가 null인 row:', missingSigungu, '\n');

  const locFeatures = await prisma.apartmentLocationFeature.findMany();
  const marketFeatures = await prisma.apartmentMarketFeature.findMany();
  const locByAptSeq = new Map(locFeatures.map((r) => [r.aptSeq, r]));
  const marketAptSeqs = new Set(marketFeatures.map((r) => r.aptSeq));

  console.log('ApartmentLocationFeature total rows:', locFeatures.length);
  console.log('ApartmentMarketFeature total rows:', marketFeatures.length, '\n');

  // ---- §15/§16: 구·군별 인벤토리 + 커버리지 ----
  console.log('=== §15/§16: 구·군별 ApartmentMaster count + feature 존재율 ===');
  const byGugun: Record<string, typeof allMaster> = {};
  for (const gu of BUSAN_GUGUN) byGugun[gu] = [];
  const unknownGu: typeof allMaster = [];
  allMaster.forEach((r) => {
    if (r.sigungu && byGugun[r.sigungu]) byGugun[r.sigungu].push(r);
    else unknownGu.push(r);
  });

  const guSummaryRows: any[] = [];
  for (const gu of BUSAN_GUGUN) {
    const rows = byGugun[gu];
    const withLoc = rows.filter((r) => locByAptSeq.has(r.aptSeq!));
    const withMarket = rows.filter((r) => marketAptSeqs.has(r.aptSeq!));
    guSummaryRows.push({ gu, total: rows.length, withLoc: withLoc.length, withMarket: withMarket.length });
  }
  guSummaryRows.forEach((r) => {
    console.log(`  ${r.gu}: 단지 ${r.total}건, location feature 있음 ${r.withLoc}건(${fmtPct(r.withLoc, r.total)}), market feature 있음 ${r.withMarket}건(${fmtPct(r.withMarket, r.total)})`);
  });
  if (unknownGu.length) console.log(`  (sigungu 불명/16개 목록 밖): ${unknownGu.length}건`);

  // ---- §6: 초등학교 거리 분포(전체 + 구별, location feature 있는 것만) ----
  console.log('\n=== §6: nearestElementaryDistanceM 분포(전체 부산, location feature 보유 단지 기준) ===');
  const allElemDist = locFeatures.map((r) => r.nearestElementaryDistanceM).filter((v): v is number => v != null).sort((a, b) => a - b);
  console.log(`  n=${allElemDist.length} (location feature ${locFeatures.length}건 중 non-null)`);
  console.log(`  min=${allElemDist[0]}, p10=${percentile(allElemDist, 10)}, p25=${percentile(allElemDist, 25)}, median=${percentile(allElemDist, 50)}, p75=${percentile(allElemDist, 75)}, p90=${percentile(allElemDist, 90)}, max=${allElemDist[allElemDist.length - 1]}`);

  // ---- §27: school anomaly ----
  const zeroDist = locFeatures.filter((r) => r.nearestElementaryDistanceM === 0).length;
  const under20 = locFeatures.filter((r) => r.nearestElementaryDistanceM != null && r.nearestElementaryDistanceM > 0 && r.nearestElementaryDistanceM < 20).length;
  const over3000 = locFeatures.filter((r) => r.nearestElementaryDistanceM != null && r.nearestElementaryDistanceM > 3000).length;
  const nullButComplete = locFeatures.filter((r) => r.nearestElementaryDistanceM == null && r.qualityFlag === 'complete').length;
  console.log('\n=== §27: school anomaly ===');
  console.log(`  0m: ${zeroDist}건 / <20m: ${under20}건 / >3000m: ${over3000}건 / null인데 qualityFlag=complete: ${nullButComplete}건`);

  // ---- §22-26/§16-18: score engine 실행(location feature가 있는 단지 전수) ----
  console.log('\n=== §16-18: score 계산 결과(location feature 보유 단지 전수 실행) ===');
  const targets = allMaster.filter((r) => locByAptSeq.has(r.aptSeq!));
  console.log(`대상: ${targets.length}건 (실제 calculateApartmentScore() 실행, production 로직 그대로)\n`);

  type Outcome = {
    aptSeq: string; name: string; gu: string | null; dong: string | null;
    status: string; score: number | null; coverage: number | null;
    missingCategories: string[]; preparingReason: string | null;
  };
  const outcomes: Outcome[] = [];
  const categoryMissingCount: Record<string, number> = { transport: 0, living: 0, parking: 0, complex: 0, schoolAccess: 0 };
  const preparingReasonCount: Record<string, number> = {};

  // [§25] peer-level(LOCAL/SIGUNGU/REGION_WIDE) fallback 비율 — resolvePeerPool을
  // calculate.ts와 동일하게 그대로 재사용한다(재구현 아님, §43).
  const peerLevelCount: Record<string, number> = { LOCAL: 0, SIGUNGU: 0, REGION_WIDE: 0 };
  const peerLevelCountParking: Record<string, number> = { LOCAL: 0, SIGUNGU: 0, REGION_WIDE: 0 };
  const peerLevelByGu: Record<string, Record<string, number>> = {};

  // [§26] Regional Premium 발동 빈도 — computeRegionalStrengths를 그대로 재사용.
  let regionalStrengthTotalApts = 0;
  let regionalStrengthZero = 0;
  const regionalStrengthTypeCount: Record<string, number> = {};

  const cohortBySggCd = new Map<string, typeof allMaster>();
  allMaster.forEach((r) => {
    if (!r.sggCd) return;
    const arr = cohortBySggCd.get(r.sggCd) ?? [];
    arr.push(r);
    cohortBySggCd.set(r.sggCd, arr);
  });
  const sigunguLocByGu: Record<string, Map<string, RawLocationFeature>> = {};
  for (const gu of BUSAN_GUGUN) {
    const guAptSeqs = new Set(byGugun[gu].map((r) => r.aptSeq!));
    sigunguLocByGu[gu] = new Map(locFeatures.filter((f) => guAptSeqs.has(f.aptSeq)).map((f) => [f.aptSeq, f as RawLocationFeature]));
  }

  let i = 0;
  for (const t of targets) {
    i++;
    if (i % 100 === 0) console.log(`  ...${i}/${targets.length}`);
    const result = await calculateApartmentScore(t.aptSeq!);
    // [§17] ExplainedCategory.score===null이면 그 카테고리는 NOT_SCORED — public
    // shape만으로도 카테고리별 coverage(§17)를 구할 수 있다("missing=0점"으로
    // 집계하지 않는다 — score===null인 카테고리는 아예 합계에서 제외된 것이지
    // 0점으로 채점된 게 아니다, calculate.ts의 usedWeightSum 로직 그대로).
    const missingCategories = result.categories.filter((c) => c.score == null).map((c) => c.key);
    missingCategories.forEach((k) => { categoryMissingCount[k] = (categoryMissingCount[k] ?? 0) + 1; });
    if (result.preparingReason) preparingReasonCount[result.preparingReason] = (preparingReasonCount[result.preparingReason] ?? 0) + 1;
    outcomes.push({
      aptSeq: t.aptSeq!, name: t.name, gu: t.sigungu, dong: t.umdName,
      status: result.status, score: result.score, coverage: result.coverage,
      missingCategories, preparingReason: result.preparingReason,
    });

    // §25: peer pool 재계산(동일 함수, 동일 cohort 구성 방식)
    if (t.sggCd) {
      const cohort = cohortBySggCd.get(t.sggCd) ?? [];
      const peerCandidates: PeerCandidate[] = cohort.map((c) => ({ aptSeq: c.aptSeq!, sggCd: c.sggCd, umdName: c.umdName, buildYear: c.buildYear }));
      const targetCandidate: PeerCandidate = { aptSeq: t.aptSeq!, sggCd: t.sggCd, umdName: t.umdName, buildYear: t.buildYear };
      const pool = resolvePeerPool(targetCandidate, peerCandidates, false);
      const poolParking = resolvePeerPool(targetCandidate, peerCandidates, true);
      peerLevelCount[pool.level]++;
      peerLevelCountParking[poolParking.level]++;
      const gu = t.sigungu ?? '(불명)';
      peerLevelByGu[gu] ||= { LOCAL: 0, SIGUNGU: 0, REGION_WIDE: 0 };
      peerLevelByGu[gu][pool.level]++;
    }

    // §26: regional premium 발동 빈도(같은 sigungu location feature 풀 재사용)
    if (t.sigungu && sigunguLocByGu[t.sigungu]) {
      regionalStrengthTotalApts++;
      const strengths = computeRegionalStrengths(t.aptSeq!, sigunguLocByGu[t.sigungu]);
      if (strengths.length === 0) regionalStrengthZero++;
      strengths.forEach((s) => {
        const key = `${s.type}:${s.level}`;
        regionalStrengthTypeCount[key] = (regionalStrengthTypeCount[key] ?? 0) + 1;
      });
    }
  }

  const okCount = outcomes.filter((o) => o.status === 'OK').length;
  const insufficientCount = outcomes.filter((o) => o.status === 'INSUFFICIENT_DATA').length;
  console.log(`\nOK(점수 계산됨): ${okCount}건 / INSUFFICIENT_DATA(준비중): ${insufficientCount}건 (전체 ${outcomes.length}건 중)`);

  console.log('\n=== §17: 카테고리별 missing(NOT_SCORED) 건수 ===');
  Object.entries(categoryMissingCount).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}/${outcomes.length}건 missing(${fmtPct(v, outcomes.length)})`);
  });

  console.log('\n=== §18: INSUFFICIENT_DATA preparingReason 분포(pilot 구·군, location feature 있는 단지 기준) ===');
  Object.entries(preparingReasonCount).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}건 — ${PREPARING_REASON_ADMIN_LABEL[k as keyof typeof PREPARING_REASON_ADMIN_LABEL]}`);
  });
  if (Object.keys(preparingReasonCount).length === 0) console.log('  (없음 — pilot 구·군 내 location feature 보유 단지는 전부 OK)');

  console.log('\n=== §25: peer-level(LOCAL/SIGUNGU/REGION_WIDE) fallback 비율(non-parking 카테고리 기준) ===');
  Object.entries(peerLevelCount).forEach(([k, v]) => console.log(`  ${k}: ${v}건(${fmtPct(v, targets.length)})`));
  console.log('  구·군별:');
  Object.entries(peerLevelByGu).forEach(([gu, counts]) => {
    const total = counts.LOCAL + counts.SIGUNGU + counts.REGION_WIDE;
    console.log(`    ${gu}: LOCAL ${counts.LOCAL}(${fmtPct(counts.LOCAL, total)}) / SIGUNGU ${counts.SIGUNGU}(${fmtPct(counts.SIGUNGU, total)}) / REGION_WIDE ${counts.REGION_WIDE}(${fmtPct(counts.REGION_WIDE, total)})`);
  });
  console.log('  주차(buildYear decade band 기준) peer-level:');
  Object.entries(peerLevelCountParking).forEach(([k, v]) => console.log(`    ${k}: ${v}건(${fmtPct(v, targets.length)})`));

  console.log('\n=== §26: Regional Premium 발동 빈도(sigungu 내 percentile, total score에 미가산) ===');
  console.log(`  대상 ${regionalStrengthTotalApts}건 중 strength 0개: ${regionalStrengthZero}건(${fmtPct(regionalStrengthZero, regionalStrengthTotalApts)}), 1개 이상: ${regionalStrengthTotalApts - regionalStrengthZero}건`);
  Object.entries(regionalStrengthTypeCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`    ${k}: ${v}건(${fmtPct(v, regionalStrengthTotalApts)})`);
  });

  console.log('\n구·군별 score 가능/준비중:');
  const byGuOutcome: Record<string, Outcome[]> = {};
  outcomes.forEach((o) => { const g = o.gu || '(불명)'; (byGuOutcome[g] ||= []).push(o); });
  Object.entries(byGuOutcome).sort((a, b) => b[1].length - a[1].length).forEach(([gu, rows]) => {
    const ok = rows.filter((r) => r.status === 'OK').length;
    console.log(`  ${gu}: ${rows.length}건 중 OK ${ok}건(${fmtPct(ok, rows.length)}), 준비중 ${rows.length - ok}건`);
  });

  const scores = outcomes.filter((o) => o.score != null).map((o) => o.score!).sort((a, b) => a - b);
  console.log('\n=== §24: score distribution(OK 단지 전체) ===');
  if (scores.length > 0) {
    console.log(`  n=${scores.length}, min=${scores[0]}, p25=${percentile(scores, 25)}, median=${percentile(scores, 50)}, p75=${percentile(scores, 75)}, max=${scores[scores.length - 1]}`);
    const veryLow = scores.filter((s) => s <= 10).length;
    const veryHigh = scores.filter((s) => s >= 90).length;
    console.log(`  <=10점: ${veryLow}건, >=90점: ${veryHigh}건`);
  }

  const coverages = outcomes.filter((o) => o.coverage != null).map((o) => o.coverage!).sort((a, b) => a - b);
  console.log('\ncoverage 분포(전체):');
  if (coverages.length > 0) {
    console.log(`  n=${coverages.length}, min=${coverages[0].toFixed(2)}, median=${percentile(coverages, 50)?.toFixed(2)}, max=${coverages[coverages.length - 1].toFixed(2)}`);
  }

  // ---- [BUSAN SCORE DATA V1 §27] 구·군별 score distribution ----
  console.log('\n=== BUSAN SCORE DATA V1 §27: 구·군별 score distribution ===');
  Object.entries(byGuOutcome).forEach(([gu, rows]) => {
    const guScores = rows.filter((r) => r.score != null).map((r) => r.score!).sort((a, b) => a - b);
    if (guScores.length === 0) return;
    console.log(`  ${gu}: n=${guScores.length}, min=${guScores[0]}, p25=${percentile(guScores, 25)}, median=${percentile(guScores, 50)}, p75=${percentile(guScores, 75)}, max=${guScores[guScores.length - 1]}`);
  });

  // ---- [BUSAN SCORE DATA V1 §25] wrong-score prevention 검사 ----
  console.log('\n=== BUSAN SCORE DATA V1 §25: wrong-score prevention ===');
  const belowThreshold = outcomes.filter((o) => o.status === 'OK' && o.coverage != null && o.coverage < 0.6);
  console.log(`  OK인데 coverage<0.6: ${belowThreshold.length}건(있으면 안 됨)`);
  // [진짜 중요한 검사] score engine(calculate.ts)은 cohort/peer를 항상 master.sggCd로
  // 묶는다(아래 aptSeq 접두어가 아니다) — 그러니 실제 오염 위험은 "같은 sggCd 값을
  // 가진 행들이 서로 다른 sigungu를 갖고 있는가"(=sggCd 자체가 자기 불일치)이지
  // "aptSeq 접두어가 현재 sigungu와 같은가"가 아니다. 후자는 1988년 금정구가
  // 동래구에서 분리되는 등 행정구역 변천사로 MOLIT 단지 고유번호(aptSeq)가 옛
  // lawdCd 접두어를 그대로 갖고 있는 경우가 있어(실측 확인: 26260-3648 래미안
  // 포레스티지1단지, 현재 sigungu=금정구·sggCd=26410인데 aptSeq 접두어는 옛
  // 동래구 코드 26260) 참고 정보일 뿐 실제 채점 오류가 아니다.
  const sigunguBySggCd = new Map<string, Set<string>>();
  allMaster.forEach((m) => {
    if (!m.sggCd || !m.sigungu) return;
    const set = sigunguBySggCd.get(m.sggCd) ?? new Set<string>();
    set.add(m.sigungu);
    sigunguBySggCd.set(m.sggCd, set);
  });
  const sggCdSelfConsistency = [...sigunguBySggCd.entries()].filter(([, sigungus]) => sigungus.size > 1);
  console.log(`  master.sggCd가 2개 이상 sigungu에 걸쳐 쓰인 경우(실제 score cohort 오염 위험): ${sggCdSelfConsistency.length}건(있으면 안 됨)`);

  const sggCdToSigungu = new Map<string, string>();
  allMaster.forEach((m) => { if (m.sggCd && m.sigungu && !sggCdToSigungu.has(m.sggCd)) sggCdToSigungu.set(m.sggCd, m.sigungu); });
  const crossDistrictLeak = outcomes.filter((o) => {
    const sggCdPrefix = o.aptSeq.split('-')[0];
    const expectedGu = sggCdToSigungu.get(sggCdPrefix);
    return expectedGu && o.gu && expectedGu !== o.gu;
  });
  console.log(`  [참고, score 무관] aptSeq 접두어와 현재 sigungu 불일치(MOLIT 옛 행정구역 코드 잔존 가능성): ${crossDistrictLeak.length}건`);
  const dupAptSeq = new Map<string, number>();
  allMaster.forEach((m) => { if (m.aptSeq) dupAptSeq.set(m.aptSeq, (dupAptSeq.get(m.aptSeq) ?? 0) + 1); });
  const dupCount = [...dupAptSeq.values()].filter((c) => c > 1).length;
  console.log(`  ApartmentMaster 내 중복 aptSeq: ${dupCount}건(있으면 안 됨)`);

  // ---- BUSAN SCORE READINESS(READY/LIMITED/BLOCKED) ----
  console.log('\n=== BUSAN SCORE READINESS 분류(초안) ===');
  Object.entries(guSummaryRows.reduce((acc: Record<string, typeof guSummaryRows[0]>, r) => { acc[r.gu] = r; return acc; }, {})).forEach(([gu, r]: [string, any]) => {
    const coveragePct = r.total > 0 ? (100 * r.withLoc) / r.total : 0;
    let status: string;
    if (coveragePct === 0) status = 'BLOCKED(feature 미수집)';
    else if (coveragePct < 50) status = 'LIMITED(부분 수집)';
    else status = 'READY';
    console.log(`  ${gu}: location coverage ${coveragePct.toFixed(1)}% → ${status}`);
  });

  // ---- 샘플 export(QA용) ----
  console.log('\n=== 샘플(구별 최대 3건, QA용) ===');
  for (const gu of BUSAN_GUGUN) {
    const rows = byGuOutcome[gu] || [];
    const sample = rows.slice(0, 3);
    sample.forEach((r) => {
      console.log(`  [${gu}] ${r.name}(${r.dong}) aptSeq=${r.aptSeq} status=${r.status} score=${r.score} coverage=${r.coverage?.toFixed(2)}`);
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
