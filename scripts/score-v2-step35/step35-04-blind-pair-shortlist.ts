/**
 * E-JIP SCORE V2 STEP 3.5 §21-26 — STEP3의 48개 blind pair 품질감사 + 12~15개
 * shortlist 선정 + human-review 자료 재생성(추천 후보 P-D 기준) + agreement
 * helper(계산 준비, 실행은 안 함). READ-ONLY.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { loadBusanRows, factorScores, type Row } from '../score-v2-step3/shared-loader';
import { T1_70_30, educationComposeEA, livingComposeLA, composeTotalFromDomains, DOMAIN_WEIGHT_CANDIDATES } from '../score-v2-step3/composition-v3';
import { complexWithParkingModel, type ParkingConditionalContext } from './composition-v35';

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
function ageBand(age: number | null): string { if (age == null) return 'unknown'; if (age <= 10) return '0-10'; if (age <= 20) return '11-20'; if (age <= 30) return '21-30'; return '31+'; }

async function main() {
  const { rows, prisma } = await loadBusanRows();
  const eligible = rows.filter((r) => r.eligible);
  const rowByAptSeq = new Map(rows.map((r) => [r.aptSeq, r]));

  // P-D context
  const knownRows = eligible.filter((r) => r.parkingRatio != null);
  const byAgeBand = new Map<string, number[]>();
  for (const r of knownRows) { const b = ageBand(r.age); const pf = factorScores(r).parking; if (pf == null) continue; if (!byAgeBand.has(b)) byAgeBand.set(b, []); byAgeBand.get(b)!.push(pf); }
  const eraNeutralByAgeBand: Record<string, number> = {};
  for (const [b, vals] of byAgeBand) eraNeutralByAgeBand[b] = mean(vals);
  const ctx: ParkingConditionalContext = { eraNeutralByAgeBand, conservativeByAgeScaleBand: {} };

  function scoreOf(r: Row) {
    const f = factorScores(r);
    const transport = T1_70_30(f.subway, f.bus, 'M1_BOUNDED_REDISTRIBUTION');
    const complex = complexWithParkingModel(f.age, f.scale, f.parking, 'P-D_ERA_CONDITIONED', ageBand(r.age), '', ctx);
    const education = educationComposeEA(f.elementary, f.kindergarten, 'M1_BOUNDED_REDISTRIBUTION');
    const living = livingComposeLA(f.living, 'M1_BOUNDED_REDISTRIBUTION');
    const covered = [transport, living, education, complex].filter((x) => x.score != null).length;
    const total = covered / 4 >= 0.4 ? composeTotalFromDomains({ transport: transport.score, living: living.score, education: education.score, complex: complex.score }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION').score : null;
    return { transport: transport.score, living: living.score, education: education.score, complex: complex.score, total, coverage: covered / 4 };
  }

  // ---------------- §21 기존 48 pair 재감사(STEP3 key.csv 파싱) ----------------
  const step3KeyPath = path.resolve(__dirname, '../../data/score-v2-step3/pairwise-expert-review-key.csv');
  const keyContent = fs.readFileSync(step3KeyPath, 'utf-8').split('\n').slice(1).filter(Boolean);
  interface PairRecord { pairId: string; type: string; aAptSeq: string; bAptSeq: string }
  const pairMap = new Map<string, { type: string; a?: string; b?: string }>();
  for (const line of keyContent) {
    const cols = line.match(/(".*?"|[^,]+)(?=,|$)/g) ?? [];
    const pairId = cols[0] ?? ''; const type = cols[1] ?? ''; const side = cols[2] ?? ''; const aptSeq = cols[3] ?? '';
    if (!pairId || !aptSeq) continue;
    const cleanType = type.replace(/"/g, '');
    if (!pairMap.has(pairId)) pairMap.set(pairId, { type: cleanType });
    if (side === 'A') pairMap.get(pairId)!.a = aptSeq; else pairMap.get(pairId)!.b = aptSeq;
  }
  const pairs: PairRecord[] = [...pairMap.entries()].filter(([, v]) => v.a && v.b).map(([pairId, v]) => ({ pairId, type: v.type, aAptSeq: v.a!, bAptSeq: v.b! }));
  console.log(`[§21] STEP3 blind pair 재로딩 = ${pairs.length}개`);

  interface Audited extends PairRecord { aName: string; bName: string; aSigungu: string | null; bSigungu: string | null; aTotal: number | null; bTotal: number | null; gap: number; obvious: boolean; bothHighConfidence: boolean }
  const audited: Audited[] = [];
  for (const p of pairs) {
    const a = rowByAptSeq.get(p.aAptSeq); const b = rowByAptSeq.get(p.bAptSeq);
    if (!a || !b) continue;
    const sa = scoreOf(a); const sb = scoreOf(b);
    if (sa.total == null || sb.total == null) continue;
    const gap = Math.abs(sa.total - sb.total);
    audited.push({ ...p, aName: a.name, bName: b.name, aSigungu: a.sigungu, bSigungu: b.sigungu, aTotal: sa.total, bTotal: sb.total, gap, obvious: gap > 15, bothHighConfidence: sa.coverage >= 0.75 && sb.coverage >= 0.75 });
  }
  console.log(`  유효 pair(양쪽 total 계산됨) = ${audited.length}개`);
  console.log(`  obvious(gap>15) = ${audited.filter((a) => a.obvious).length}개, close-call(gap<=5) = ${audited.filter((a) => a.gap <= 5).length}개, moderate(5<gap<=15) = ${audited.filter((a) => a.gap > 5 && a.gap <= 15).length}개`);

  // ---------------- §22 shortlist 12~15 선정 ----------------
  const byType = new Map<string, Audited[]>();
  for (const a of audited) { if (!byType.has(a.type)) byType.set(a.type, []); byType.get(a.type)!.push(a); }
  const shortlist: Audited[] = [];
  const usedSigungu = new Set<string>();
  for (const [type, list] of byType) {
    // 각 archetype에서 "너무 obvious하지 않은" 것 우선(gap 오름차순), 지역 다양성 고려
    const sorted = [...list].sort((x, y) => x.gap - y.gap);
    let picked = 0;
    for (const cand of sorted) {
      if (picked >= 2) break; // archetype당 최대 2개
      shortlist.push(cand); picked++;
      usedSigungu.add(cand.aSigungu ?? ''); usedSigungu.add(cand.bSigungu ?? '');
    }
  }
  // close-call(가장 가치 있는 판단 지점) 추가 보강
  const closeCalls = audited.filter((a) => a.gap <= 5 && !shortlist.includes(a)).sort((a, b) => a.gap - b.gap);
  for (const c of closeCalls) { if (shortlist.length >= 15) break; shortlist.push(c); }
  const finalShortlist = shortlist.slice(0, 15);
  console.log(`\n[§22] Shortlist 확정 = ${finalShortlist.length}개(목표 12~15)`);
  finalShortlist.forEach((s) => {
    const tag = s.gap <= 5 ? 'CLOSE_CALL' : s.obvious ? 'FAIRLY_CLEAR' : 'MODERATE_TRADEOFF';
    console.log(`  [${s.type}] ${s.aName}(${s.aSigungu}) vs ${s.bName}(${s.bSigungu}) gap=${s.gap.toFixed(1)} [${tag}]`);
  });
  console.log(`  대표 archetype 수 = ${new Set(finalShortlist.map((s) => s.type)).size}, 대표 지역(구) 수 = ${new Set(finalShortlist.flatMap((s) => [s.aSigungu, s.bSigungu])).size}`);

  // ---------------- §23-24 Blind sheet + Answer key ----------------
  const outDir = path.resolve(__dirname, '../../data/score-v2-step35');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const blindLines: string[] = [
    '# E-JIP SCORE V2 STEP 3.5 — Blind Expert Review Shortlist(12~15쌍)',
    '# 질문1: 실거주 관점에서 어느 쪽이 더 좋습니까? (A / B / 비슷)',
    '# 질문2: 가장 큰 이유는? (교통 / 생활 / 교육 / 단지 / 기타)',
    '# 점수는 이 파일에 없습니다.',
    'pairId,side,builtYear,households,parkingRatio,subwayDistanceM,subwayStatus,busStopDistanceM,elementaryDistanceM,martCount,convenienceCount,pharmacyCount,hospitalCount,dataConfidence',
  ];
  const keyLines: string[] = ['pairId,type,side,aptSeq,name,sigungu,transport,living,education,complex,total,winner,gap'];
  finalShortlist.forEach((s, idx) => {
    const pairId = `SHORTLIST-${String(idx + 1).padStart(2, '0')}`;
    for (const [side, aptSeq, name, sigungu, total] of [['A', s.aAptSeq, s.aName, s.aSigungu, s.aTotal], ['B', s.bAptSeq, s.bName, s.bSigungu, s.bTotal]] as const) {
      const r = rowByAptSeq.get(aptSeq)!;
      const sc = scoreOf(r);
      const builtYear = r.age != null ? 2026 - r.age : '';
      const confidence = sc.coverage >= 0.75 ? 'HIGH' : sc.coverage >= 0.4 ? 'MEDIUM' : 'LOW';
      blindLines.push([pairId, side, builtYear, r.households ?? '', r.parkingRatio?.toFixed(2) ?? '정보없음', r.subwayRaw ?? '', r.subwayStatus, r.busDist ?? '', r.elemRaw ?? '', r.livingRaw.mart ?? '', r.livingRaw.convenience ?? '', r.livingRaw.pharmacy ?? '', r.livingRaw.hospital ?? '', confidence].join(','));
      const winner = s.gap <= 3 ? 'TIE(근소)' : (s.aTotal! > s.bTotal! ? 'A' : 'B');
      keyLines.push([pairId, `"${s.type}"`, side, aptSeq, `"${name}"`, sigungu, sc.transport?.toFixed(1) ?? '', sc.living?.toFixed(1) ?? '', sc.education?.toFixed(1) ?? '', sc.complex?.toFixed(1) ?? '', total?.toFixed(1) ?? '', winner, s.gap.toFixed(1)].join(','));
    }
  });
  fs.writeFileSync(path.resolve(outDir, 'expert-review-blind-shortlist.csv'), blindLines.join('\n'));
  fs.writeFileSync(path.resolve(outDir, 'expert-review-answer-key.csv'), keyLines.join('\n'));
  console.log('\n[saved] expert-review-blind-shortlist.csv / expert-review-answer-key.csv');

  // ---------------- §36 leakage check ----------------
  const blindContent = blindLines.join('\n');
  const namesLeaked = finalShortlist.some((s) => blindContent.includes(s.aName) || blindContent.includes(s.bName));
  const scoresLeaked = /total|score/i.test(blindContent.split('\n').slice(4).join('\n'));
  console.log(`\n[§36] Leakage check: 단지명 누출=${namesLeaked}, score/total 컬럼 누출=${scoresLeaked} (둘 다 false여야 함)`);

  // ---------------- §25 Agreement helper(계산 준비만, 실행 안 함) ----------------
  const agreementHelperCode = `
// STEP3.5 §25 — 향후 실제 human 응답(csv: pairId,humanAnswer[A|B|TIE],reasonDomain) 입력 시
// 사용할 agreement 계산 helper. 이번 STEP에서는 인간 응답이 없어 호출하지 않는다.
export interface HumanResponse { pairId: string; answer: 'A' | 'B' | 'TIE'; reasonDomain?: string }
export function computeAgreement(humanResponses: HumanResponse[], answerKey: { pairId: string; winner: string }[]) {
  const keyByPair = new Map(answerKey.map((k) => [k.pairId, k.winner]));
  let agree = 0, strongDisagree = 0, tieHandled = 0;
  for (const h of humanResponses) {
    const v2 = keyByPair.get(h.pairId);
    if (!v2) continue;
    if (h.answer === 'TIE' || v2 === 'TIE(근소)') { tieHandled++; continue; }
    if (h.answer === v2) agree++; else strongDisagree++;
  }
  const total = humanResponses.length;
  return { agreementRate: agree / total, strongDisagreementCount: strongDisagree, tieHandledCount: tieHandled, total };
}
`;
  fs.writeFileSync(path.resolve(outDir, 'agreement-helper.ts.snippet'), agreementHelperCode);
  console.log('[saved] agreement-helper.ts.snippet(참고용, 실행 안 함)');

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
