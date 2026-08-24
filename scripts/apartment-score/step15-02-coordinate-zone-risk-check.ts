/**
 * E-JIP SCORE V2 STEP 1.5 §10 — STEP0.7-A coordinate write(1,191건)가 attendance-zone
 * artifact(2026-08-22 생성, STEP0.7-A write 2026-08-23~24보다 이전)의 zone 판정에
 * 영향을 줄 수 있는지 READ-ONLY 조사. artifact regenerate 없음, DB write 없음.
 */
import * as path from 'path';
import * as fs from 'fs';

interface DryrunRow { aptSeq: string; distanceDeltaM: number }
interface Dryrun { safeAptSeqs: string[]; results: DryrunRow[] }
interface ArtifactApt { aptSeq: string; elementary: { status: string }; middle: { status: string } }
interface Artifact { apartments: ArtifactApt[] }

function main() {
  const dryrun = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'output/step07a-regeocode-dryrun.json'), 'utf-8')) as Dryrun;
  const artifact = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../data/education/attendance-zone/busan-attendance-zone-20260320.json'), 'utf-8')) as Artifact;
  const artifactByAptSeq = new Map(artifact.apartments.map((a) => [a.aptSeq, a]));

  const safeSet = new Set(dryrun.safeAptSeqs);
  const writtenRows = dryrun.results.filter((r) => safeSet.has(r.aptSeq));
  console.log(`STEP0.7-A 실제 write 대상(safeAptSeqs) = ${dryrun.safeAptSeqs.length}, dryrun.results 중 매칭 = ${writtenRows.length}`);

  const bands = [
    { label: '<100m', test: (d: number) => d < 100 },
    { label: '100~300m', test: (d: number) => d >= 100 && d < 300 },
    { label: '300m~1km', test: (d: number) => d >= 300 && d < 1000 },
  ];
  for (const b of bands) {
    const rows = writtenRows.filter((r) => b.test(r.distanceDeltaM));
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      const a = artifactByAptSeq.get(r.aptSeq);
      const status = a ? a.elementary.status : 'NOT_IN_ARTIFACT';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    console.log(`${b.label}: ${rows.length}건, attendance-zone status 분포 = ${JSON.stringify(byStatus)}`);
  }

  const moved300plus = writtenRows.filter((r) => r.distanceDeltaM >= 300);
  console.log(`\n300m 이상 이동 + attendance-zone AVAILABLE(재검토 배지 없음)인 위험 후보:`);
  const riskCandidates = moved300plus.filter((r) => artifactByAptSeq.get(r.aptSeq)?.elementary.status === 'AVAILABLE');
  console.log(`  ${riskCandidates.length}건: ${JSON.stringify(riskCandidates.map((r) => ({ aptSeq: r.aptSeq, distanceDeltaM: Math.round(r.distanceDeltaM) })))}`);
}
main();
