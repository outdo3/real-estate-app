/**
 * PEER FALLBACK HOTFIX — before/after 스냅샷 diff. 순수 JSON 비교만 하며
 * DB에 접근하지 않는다.
 *
 * 사용법: node --require ts-node/register/transpile-only scripts/apartment-score/busan-score-drift.ts
 *   (또는 ts-node --transpile-only로 직접 실행)
 */
import * as fs from 'fs';
import * as path from 'path';

const beforePath = path.resolve(__dirname, '.snapshot-before.json');
const afterPath = path.resolve(__dirname, '.snapshot-after.json');

const before = JSON.parse(fs.readFileSync(beforePath, 'utf-8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf-8'));

const beforeKeys = new Set(Object.keys(before));
const afterKeys = new Set(Object.keys(after));
console.log(`before 건수: ${beforeKeys.size}, after 건수: ${afterKeys.size}`);

const onlyBefore = [...beforeKeys].filter((k) => !afterKeys.has(k));
const onlyAfter = [...afterKeys].filter((k) => !beforeKeys.has(k));
if (onlyBefore.length || onlyAfter.length) {
  console.log(`[경고] 대상 목록 자체가 다름 — before에만: ${onlyBefore.length}건, after에만: ${onlyAfter.length}건`);
}

const beforeOk = [...beforeKeys].filter((k) => before[k].status === 'OK').length;
const afterOk = [...afterKeys].filter((k) => after[k].status === 'OK').length;
console.log(`\nOK 건수: before=${beforeOk} → after=${afterOk} (${afterOk - beforeOk >= 0 ? '+' : ''}${afterOk - beforeOk})`);
console.log(`preparing 건수: before=${beforeKeys.size - beforeOk} → after=${afterKeys.size - afterOk}`);

// ---- target 8 before/after ----
const TARGET_8 = [
  '26110-9', '26110-65', '26110-780', '26110-8',
  '26710-546', '26710-642', '26710-437', '26710-38',
];
console.log('\n=== target 8 before/after ===');
TARGET_8.forEach((seq) => {
  const b = before[seq];
  const a = after[seq];
  console.log(`  ${seq} ${a?.name ?? b?.name}: before(status=${b?.status}, score=${b?.score}) → after(status=${a?.status}, score=${a?.score})`);
});

// ---- score drift for apartments that were OK both before and after ----
let driftCount = 0;
let sumAbsDrift = 0;
let maxDrift = 0;
let maxDriftAptSeq = '';
const driftByGu: Record<string, { count: number; sumAbs: number; max: number }> = {};

for (const seq of beforeKeys) {
  if (!afterKeys.has(seq)) continue;
  const b = before[seq];
  const a = after[seq];
  if (b.status === 'OK' && a.status === 'OK') {
    const diff = a.score - b.score;
    if (diff !== 0) {
      driftCount++;
      sumAbsDrift += Math.abs(diff);
      if (Math.abs(diff) > Math.abs(maxDrift)) {
        maxDrift = diff;
        maxDriftAptSeq = seq;
      }
      const gu = a.gu ?? '(불명)';
      driftByGu[gu] ||= { count: 0, sumAbs: 0, max: 0 };
      driftByGu[gu].count++;
      driftByGu[gu].sumAbs += Math.abs(diff);
      if (Math.abs(diff) > Math.abs(driftByGu[gu].max)) driftByGu[gu].max = diff;
    }
  }
}

const bothOkCount = [...beforeKeys].filter((k) => afterKeys.has(k) && before[k].status === 'OK' && after[k].status === 'OK').length;
console.log(`\n=== 기존 OK 단지 중 score drift(기존 3,059건 기준) ===`);
console.log(`양쪽 다 OK인 단지: ${bothOkCount}건`);
console.log(`점수 변경된 단지: ${driftCount}건(${((100 * driftCount) / bothOkCount).toFixed(3)}%)`);
console.log(`평균 |변화|: ${driftCount > 0 ? (sumAbsDrift / driftCount).toFixed(3) : 0}`);
console.log(`최대 변화: ${maxDrift} (aptSeq=${maxDriftAptSeq}, ${after[maxDriftAptSeq]?.name})`);

console.log('\n=== 구별 drift ===');
Object.entries(driftByGu).forEach(([gu, d]) => {
  console.log(`  ${gu}: 변경 ${d.count}건, 평균|변화|=${(d.sumAbs / d.count).toFixed(3)}, max=${d.max}`);
});

// ---- 서구/해운대/중구/기장군 regression: score/coverage 동일성 확인(변경분 있으면 상세 출력) ----
console.log('\n=== 서구/해운대구 regression(기존 pilot) ===');
['서구', '해운대구'].forEach((gu) => {
  const seqs = [...beforeKeys].filter((k) => before[k].gu === gu && afterKeys.has(k));
  const changed = seqs.filter((k) => before[k].status !== after[k].status || before[k].score !== after[k].score);
  console.log(`  ${gu}: 전체 ${seqs.length}건 중 변경 ${changed.length}건`);
  changed.slice(0, 10).forEach((k) => {
    console.log(`    ${k} ${after[k].name}: before(${before[k].status},${before[k].score}) → after(${after[k].status},${after[k].score})`);
  });
});

console.log('\n=== 중구/기장군(§18-A 발견 지역) regression ===');
['중구', '기장군'].forEach((gu) => {
  const seqs = [...beforeKeys].filter((k) => before[k].gu === gu && afterKeys.has(k));
  const beforeOkGu = seqs.filter((k) => before[k].status === 'OK').length;
  const afterOkGu = seqs.filter((k) => after[k].status === 'OK').length;
  console.log(`  ${gu}: 전체 ${seqs.length}건, OK before=${beforeOkGu} → after=${afterOkGu}`);
});

// ---- category별 drift (카테고리 점수까지 바뀐 게 있는지, 카테고리 weight/formula 불변 검증용 참고자료) ----
console.log('\n=== 카테고리별 drift 요약(양쪽 다 OK인 단지 기준) ===');
const catDrift: Record<string, { changed: number; total: number }> = {};
for (const seq of beforeKeys) {
  if (!afterKeys.has(seq)) continue;
  const b = before[seq];
  const a = after[seq];
  if (b.status !== 'OK' || a.status !== 'OK') continue;
  const bCats = new Map((b.categories as any[]).map((c) => [c.key, c.score]));
  const aCats = new Map((a.categories as any[]).map((c) => [c.key, c.score]));
  for (const key of aCats.keys()) {
    catDrift[key] ||= { changed: 0, total: 0 };
    catDrift[key].total++;
    if (bCats.get(key) !== aCats.get(key)) catDrift[key].changed++;
  }
}
Object.entries(catDrift).forEach(([k, d]) => {
  console.log(`  ${k}: ${d.changed}/${d.total}건 변경(${((100 * d.changed) / d.total).toFixed(3)}%)`);
});
