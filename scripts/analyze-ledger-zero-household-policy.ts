/**
 * BUILDING_LEDGER_ZERO_HOUSEHOLD_REVIEW_POLICY_V1 §5~§13 — 수집된 레코드로 정책 A/B/C를
 * **추가 API 호출 없이** 비교한다. DB write 0 · 외부 호출 0.
 *
 * 입력: tmp/zero-household-policy/zero-household.json (audit 스크립트가 남긴 원본 필드)
 *
 *   npx tsx scripts/analyze-ledger-zero-household-policy.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { classifyZeroHouseholdRecord } from './audit-ledger-zero-household-policy';

const OUT = path.resolve(__dirname, '../tmp/zero-household-policy');
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface ZeroRec extends Record<string, unknown> { hhldCnt?: unknown }

/** 한 단지의 0세대 레코드들을 놓고 정책별 후보 세대수를 만든다. */
export function policyOutcomes(row: {
  residentialSumNonZero: number; zeros: ZeroRec[];
}): { A: number | null; B: number | null; C: number | null; excluded: number; blockedBy: string[] } {
  const blockedBy: string[] = [];
  let excluded = 0;
  for (const z of row.zeros) {
    const v = classifyZeroHouseholdRecord(z);
    if (v.excludable) excluded++;
    else blockedBy.push(v.cls);
  }
  const sum = row.residentialSumNonZero;
  return {
    // A: 0세대 레코드가 하나라도 있으면 자동 판단 안 함(현행)
    A: row.zeros.length === 0 && sum > 0 ? sum : null,
    // B: 공식 근거로 제외 가능한 것만 빼고, 근거 없는 것이 남으면 보류
    B: blockedBy.length === 0 && sum > 0 ? sum : null,
    // C: 0세대를 근거 없이 전부 무시
    C: sum > 0 ? sum : null,
    excluded, blockedBy,
  };
}

const bucket = (r: number | null): string =>
  r == null ? 'n/a' : r < 0.1 ? '<0.1' : r < 0.5 ? '0.1-0.5' : r < 1.5 ? '0.5-1.5' : r < 2.0 ? '1.5-2.0'
  : r < 5 ? '2.0-5.0' : r < 10 ? '5.0-10.0' : '10.0+';

function main() {
  const src = JSON.parse(fs.readFileSync(path.join(OUT, 'zero-household.json'), 'utf8'));
  const rows: Record<string, any>[] = src.rows;

  const results = rows.map((r) => {
    const zeros: ZeroRec[] = r.zeros ?? [];
    // 0이 아닌 주거 레코드의 합 — 세 정책 모두 이 값을 바탕으로 한다
    const residentialSumNonZero = num(r.policyC); // policyC는 주거 hhldCnt 전부 합(0은 0이므로 동일)
    const o = policyOutcomes({ residentialSumNonZero, zeros });
    const p = r.storedParking as number | null;
    const ratio = (h: number | null) => (h && p && h > 0 ? p / h : null);
    const verdicts = zeros.map((z) => classifyZeroHouseholdRecord(z));
    return {
      aptSeq: r.aptSeq, name: r.name, dong: r.dong, jibun: r.jibun,
      records: r.records, residentialRecords: r.residentialRecords, zeroCount: zeros.length,
      storedHouseholds: r.storedHouseholds, storedParking: p, storedPph: r.storedPph,
      householdsVerdict: r.householdsVerdict, roadVerdict: r.roadVerdict, isReview: r.isReview,
      candidate: o, verdicts: verdicts.map((v) => ({ cls: v.cls, excludable: v.excludable, evidence: v.evidence })),
      oldRatio: ratio(r.storedHouseholds), ratioB: ratio(o.B), ratioC: ratio(o.C),
    };
  });

  const review = results.filter((r) => r.isReview);
  const householdsReview = results.filter((r) => r.householdsVerdict === 'REVIEW_REQUIRED');
  const alreadyAuto = results.filter((r) => r.householdsVerdict === 'ALREADY_OK');

  // §10 회귀: 이미 보정한 42건(지금은 ALREADY_OK)에 새 정책을 다시 적용해도 값이 같아야 한다
  const regression = alreadyAuto.map((r) => ({
    aptSeq: r.aptSeq, name: r.name, stored: r.storedHouseholds,
    b: r.candidate.B, same: r.candidate.B == null || r.candidate.B === r.storedHouseholds,
  }));
  const regressionBroken = regression.filter((x) => !x.same);

  // §5 정책별 결과 — households REVIEW 집합 기준
  const tally = (f: (r: any) => string | null, list = results) =>
    list.reduce((a: Record<string, number>, r) => { const k = f(r); if (k == null) return a; a[k] = (a[k] ?? 0) + 1; return a; }, {});

  const policy = (key: 'A' | 'B' | 'C') => {
    const resolvable = householdsReview.filter((r) => r.candidate[key] != null);
    const obviouslyWrong = resolvable.filter((r) => {
      const rt = r.storedParking && r.candidate[key] ? r.storedParking / (r.candidate[key] as number) : null;
      return rt != null && (rt > 5 || rt < 0.02);
    });
    return {
      resolves: resolvable.length,
      remainingReview: householdsReview.length - resolvable.length,
      implausibleAfter: obviouslyWrong.length,
      implausibleSamples: obviouslyWrong.slice(0, 5).map((r) => ({ aptSeq: r.aptSeq, name: r.name, h: r.candidate[key], p: r.storedParking })),
    };
  };

  // §13 사용자 노출 — 214 전체 기준, B 적용 가정
  const severe = (getter: (r: any) => number | null, t: number) => results.filter((r) => { const v = getter(r); return v != null && v > t; }).length;
  const afterB = (r: any) => (r.householdsVerdict === 'REVIEW_REQUIRED' && r.candidate.B != null ? r.ratioB : r.oldRatio);

  const out = {
    at: new Date().toISOString(), readOnly: true, dbWrites: 0, externalCalls: 0,
    audited: results.length,
    reviewMasters: review.length,
    householdsReviewMasters: householdsReview.length,
    roadOnlyReview: review.length - householdsReview.length,
    zeroRecords: results.reduce((s, r) => s + r.zeroCount, 0),
    zeroClassDistribution: results.flatMap((r) => r.verdicts).reduce((a: Record<string, number>, v) => { a[v.cls] = (a[v.cls] ?? 0) + 1; return a; }, {}),
    zeroExcludable: results.flatMap((r) => r.verdicts).filter((v) => v.excludable).length,
    policyA: policy('A'), policyB: policy('B'), policyC: policy('C'),
    regression: { checked: regression.length, broken: regressionBroken.length, brokenRows: regressionBroken.slice(0, 5) },
    severeBefore: { over2: severe((r) => r.oldRatio, 2), over5: severe((r) => r.oldRatio, 5), over10: severe((r) => r.oldRatio, 10) },
    severeAfterB: { over2: severe(afterB, 2), over5: severe(afterB, 5), over10: severe(afterB, 10) },
    ratioBucketsB: tally((r) => bucket(r.householdsVerdict === 'REVIEW_REQUIRED' && r.candidate.B != null ? r.ratioB : r.oldRatio)),
    blockedReasons: householdsReview.filter((r) => r.candidate.B == null)
      .flatMap((r) => r.candidate.blockedBy).reduce((a: Record<string, number>, k) => { a[k] = (a[k] ?? 0) + 1; return a; }, {}),
    derivedRatioUpdatesProjected: householdsReview.filter((r) => r.candidate.B != null && r.storedPph != null && r.storedParking != null).length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'policy-analysis.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, results: results.length }, null, 2));
}

if (require.main === module) main();
