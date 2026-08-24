import { readFileSync } from 'fs';
const artifact = JSON.parse(readFileSync(`${__dirname}/../../data/education/attendance-zone/busan-attendance-zone-20260320.json`, 'utf-8'));
const byName = (n: string) => artifact.apartments.filter((a: any) => a.aptName.includes(n));

console.log('=== 향원에이스타운 (대신초+동신초 SHARED 기대) ===');
console.log(JSON.stringify(byName('향원에이스타운').map((a: any) => ({ aptSeq: a.aptSeq, sigungu: a.sigungu, elementary: a.elementary })), null, 1));

console.log('=== 신화타워 (온천초 HIGH + 공덕초/금성초 MEDIUM, SHARED 기대) ===');
console.log(JSON.stringify(byName('신화타워').map((a: any) => ({ aptSeq: a.aptSeq, sigungu: a.sigungu, elementary: a.elementary })), null, 1));

console.log('=== NO_MATCH 4건 (REVIEW_REQUIRED 기대) ===');
for (const n of ['삼성비치타운', '동남주상복합', '엄궁', '글로벌빌라트']) {
  console.log(n, JSON.stringify(byName(n).map((a: any) => ({ aptSeq: a.aptSeq, status: a.elementary.status, reasonCode: a.elementary.reasonCode }))));
}

console.log('=== invalid geometry 샘플 (한진/그린코아, REVIEW_REQUIRED 기대) ===');
for (const n of ['한진', '그린코아']) {
  console.log(n, JSON.stringify(byName(n).map((a: any) => ({ aptSeq: a.aptSeq, status: a.elementary.status, reasonCode: a.elementary.reasonCode, zoneName: a.elementary.zoneName }))));
}

console.log('=== 중학교 학교군 샘플 ===');
const midSample = artifact.apartments.filter((a: any) => a.middle.status === 'AVAILABLE').slice(0, 3);
console.log(JSON.stringify(midSample.map((a: any) => ({ aptSeq: a.aptSeq, aptName: a.aptName, middle: a.middle })), null, 1));

console.log('=== COORDINATE_MISSING(에코델타) ===');
console.log(JSON.stringify(byName('에코델타호반써밋').map((a: any) => ({ aptSeq: a.aptSeq, elementary: a.elementary.status, middle: a.middle.status }))));

console.log('=== meta ===');
console.log(JSON.stringify(artifact.meta, null, 1));
