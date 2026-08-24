// SCHOOL V2 FINAL QA §7-9 — pick representative apartment samples per district/status
// for browser QA. Read-only, no DB/network write, just prints candidates.
import fs from 'node:fs';

const raw = fs.readFileSync('data/education/attendance-zone/busan-attendance-zone-20260320.json', 'utf8');
const data = JSON.parse(raw) as {
  apartments: Array<{
    aptSeq: string;
    aptName: string;
    sigungu: string;
    dong: string;
    elementary: { status: string; reasonCode: string };
  }>;
};

const districts = [
  '중구','서구','동구','영도구','부산진구','동래구','남구','북구',
  '해운대구','사하구','금정구','강서구','연제구','수영구','사상구','기장군',
];

console.log('=== 1 sample per district (prefer AVAILABLE, fallback any) ===');
for (const d of districts) {
  const inDistrict = data.apartments.filter((a) => a.sigungu === d);
  const available = inDistrict.find((a) => a.elementary.status === 'AVAILABLE');
  const pick = available ?? inDistrict[0];
  console.log(d, '->', pick ? `${pick.aptName} (${pick.aptSeq}, ${pick.dong}, elem=${pick.elementary.status}/${pick.elementary.reasonCode})` : 'NONE FOUND', `[district total: ${inDistrict.length}]`);
}

console.log('\n=== Seo-gu(서구) deep sample — mix of statuses/subareas ===');
const seogu = data.apartments.filter((a) => a.sigungu === '서구');
const seoguByStatus: Record<string, typeof seogu> = {};
for (const a of seogu) {
  const k = a.elementary.status;
  (seoguByStatus[k] ??= []).push(a);
}
for (const [status, list] of Object.entries(seoguByStatus)) {
  console.log(status, ':', list.length, 'total. sample dongs:', [...new Set(list.map((a) => a.dong))].slice(0, 10).join(', '));
}
console.log('picks:');
console.log('- 대신/송도권:', seogu.filter((a) => a.dong.includes('대신') || a.dong.includes('송도')).slice(0, 3).map((a) => `${a.aptName}(${a.dong})`));
console.log('- 공동학구(SHARED-ish reasonCode):', seogu.filter((a) => a.elementary.reasonCode.startsWith('JOINT_ZONE')).slice(0, 3).map((a) => `${a.aptName}(${a.dong},${a.elementary.reasonCode})`));
console.log('- REVIEW_REQUIRED:', seogu.filter((a) => a.elementary.status === 'REVIEW_REQUIRED').slice(0, 3).map((a) => `${a.aptName}(${a.dong},${a.elementary.reasonCode})`));

console.log('\n=== Haeundae(해운대구) sample ===');
const haeundae = data.apartments.filter((a) => a.sigungu === '해운대구');
console.log('total:', haeundae.length);
console.log(haeundae.slice(0, 5).map((a) => `${a.aptName}(${a.dong},${a.elementary.status}/${a.elementary.reasonCode})`));

console.log('\n=== global status samples (for loading/error/empty QA) ===');
for (const status of ['REVIEW_REQUIRED', 'NOT_AVAILABLE']) {
  const found = data.apartments.filter((a) => a.elementary.status === status).slice(0, 3);
  console.log(status, ':', found.map((a) => `${a.aptName}(${a.sigungu} ${a.dong})`));
}

console.log('\n=== 송정 name-collision check (해운대 vs 강서) ===');
const songjeong = data.apartments.filter((a) => a.dong.includes('송정'));
console.log(songjeong.map((a) => `${a.aptName} - ${a.sigungu} ${a.dong}`));
