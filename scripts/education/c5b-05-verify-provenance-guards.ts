// SCHOOL V2-C5-B §20 — 회귀 가드. 이 프로젝트에 vitest/jest가 없어(§13, C5-A와 동일 관례)
// 정적 패턴 검사 + in-process 함수 assertion으로 확인한다. DB write 없음.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { validateCoordinate, findExcessiveDuplicateCoordinates } from './lib/coordinate-guard';

const ROOT = join(__dirname, '..', '..');
let failures = 0;
const fail = (msg: string) => {
  console.error('FAIL:', msg);
  failures++;
};

// 1. Seo-gu 하드코딩 폴백 좌표가 "코드"로(주석의 역사 설명이 아니라 실제 대입문으로)
// 다시 등장하지 않았는지 — 이 STEP의 문서/주석 자체는 히스토리 설명을 위해 이
// 숫자를 텍스트로 언급할 수 있으므로, 실제 대입 패턴(`= [129.0225`)만 검사한다.
const routeFile = join(ROOT, 'src/app/api/school/apartments/route.ts');
const routeContent = readFileSync(routeFile, 'utf-8');
if (/=\s*\[129\.0225,\s*35\.0772\]/.test(routeContent)) {
  fail('api/school/apartments/route.ts에 Seo-gu 하드코딩 좌표 대입 코드가 남아있음');
}
if (/schoolCoords\s*=\s*\[129\.015,\s*35\.115\]|schoolCoords\s*=\s*\[129\.022,\s*35\.075\]|schoolCoords\s*=\s*\[129\.010,\s*35\.100\]/.test(routeContent)) {
  fail('api/school/apartments/route.ts에 동 단위 하드코딩 보정 대입 코드가 남아있음');
}
if (!/lookupCanonicalSchoolCoordinate/.test(routeContent)) {
  fail('canonical School 좌표 조회 경로가 없음(§11 요구사항 미반영)');
}
if (!/직선거리 약 \$\{distanceMeters\}m/.test(routeContent)) {
  fail('직선거리 label이 사라짐(§16 — "도보 N분" 재도입 여부 확인 필요)');
}
if (/도보 약 \$\{|walkMin = /.test(routeContent)) {
  fail('도보 시간 계산 로직이 다시 등장함(§16 위반)');
}

// 2. fix_coords.ts / fix_songdo_coords.ts가 repo root에서 제거됐는지
for (const f of ['fix_coords.ts', 'fix_songdo_coords.ts']) {
  if (existsSync(join(ROOT, f))) {
    fail(`${f}가 아직 repo root에 존재함(§15 — 제거 대상)`);
  }
}

// 3. coordinate-guard 함수 자체의 동작 확인(in-process, 네트워크/DB 없음)
const cases: { name: string; input: Parameters<typeof validateCoordinate>[0]; expectOk: boolean }[] = [
  { name: '정상 좌표(부산)', input: { latitude: 35.12, longitude: 129.01, sidoCode: '26', source: 'schoolinfo_basicinfo_api' }, expectOk: true },
  { name: '(0,0) 좌표', input: { latitude: 0, longitude: 0, sidoCode: '26', source: 'schoolinfo_basicinfo_api' }, expectOk: false },
  { name: 'latitude 범위 초과', input: { latitude: 200, longitude: 129, sidoCode: '26', source: 'x' }, expectOk: false },
  { name: '부산 bounds 밖(sidoCode=26인데 서울 좌표)', input: { latitude: 37.5, longitude: 127.0, sidoCode: '26', source: 'x' }, expectOk: false },
  { name: 'source 없음', input: { latitude: 35.12, longitude: 129.01, sidoCode: '26', source: '' }, expectOk: false },
  { name: '수동/하드코딩 source 패턴 차단', input: { latitude: 35.12, longitude: 129.01, sidoCode: '26', source: 'manual_fix' }, expectOk: false },
  { name: 'fix_ 접두 source 차단', input: { latitude: 35.12, longitude: 129.01, sidoCode: '26', source: 'fix_songdo_coords' }, expectOk: false },
  { name: '좌표 null', input: { latitude: null, longitude: null, sidoCode: '26', source: 'x' }, expectOk: false },
  { name: '다른 시도(sidoCode≠26)는 부산 bounds 검사 skip', input: { latitude: 37.5, longitude: 127.0, sidoCode: '11', source: 'x' }, expectOk: true },
];
for (const c of cases) {
  const result = validateCoordinate(c.input);
  if (result.ok !== c.expectOk) {
    fail(`coordinate-guard 케이스 실패: "${c.name}" — expected ok=${c.expectOk}, got ok=${result.ok}${!result.ok ? ` (${result.reason})` : ''}`);
  }
}

// 4. 중복좌표 탐지 유틸 동작 확인
const dupTest = findExcessiveDuplicateCoordinates(
  [
    { name: 'A', latitude: 35.1, longitude: 129.1 },
    { name: 'B', latitude: 35.1, longitude: 129.1 },
    { name: 'C', latitude: 35.1, longitude: 129.1 },
    { name: 'D', latitude: 35.2, longitude: 129.2 },
  ],
  2
);
if (dupTest.length !== 1 || dupTest[0].rows.length !== 3) {
  fail(`중복좌표 탐지 유틸이 예상과 다르게 동작함: ${JSON.stringify(dupTest)}`);
}

if (failures === 0) {
  console.log('PASS — Seo-gu fallback 제거, fix_coords 정리, coordinate-guard 동작, 직선거리 label 유지 전부 확인');
  process.exit(0);
} else {
  console.error(`\n${failures}건 실패`);
  process.exit(1);
}
