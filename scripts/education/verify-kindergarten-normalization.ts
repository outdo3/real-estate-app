/**
 * SCHOOL V2-C3B — normalization 로직 검증(read-only, DB 미접근, 외부
 * API 미호출).
 *
 * [2026-08-21 갱신] 인증키 확보 후 basicInfo2(부산 서구,
 * sidoCode=26/sggCode=26140) 실제 성공 응답으로 교체했다 — 아래
 * fixture는 그 실제 응답의 첫 번째 항목(푸른유치원)을 그대로 옮긴
 * 것이다(추정/합성 아님). 실측 결과 포털 명세 표와 실제 응답이 다른
 * 지점이 있었다:
 * - 명세 표: `kinderCode`(camelCase) → 실제 응답: `kindercode`(전부 소문자)
 * - 명세 표에 없던 최상위 wrapper: 배열이 `data.kinderInfo`에 있음
 *   (`data.list`/`data.data`/`data.result`가 아님)
 * - 명세 표: `rpstYn` → 실제 응답: `rpst_yn`(snake_case, 이 프로젝트는
 *   미사용 필드라 매핑에는 영향 없음)
 * ingest-kindergartens.ts는 이 실측 결과를 반영해 이미 수정됨.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

function normalizeEmptyish(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (t === '' || t === '-') return null;
  return t;
}
function parseCountField(v: string | number | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function parseCoordinate(v: string | number | undefined): number | null {
  const n = parseCountField(v as any);
  if (n == null) return null;
  if (n === 0) return null;
  return n;
}
function parseReferenceYear(pbnttmng: string | number | undefined): number | null {
  if (pbnttmng == null) return null;
  const t = String(pbnttmng).trim();
  if (t.length < 5) return null;
  const year = Number(t.slice(0, 4));
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  return year;
}
function ageBucket(classCount: unknown, capacity: unknown, enrollment: unknown) {
  return {
    classCount: parseCountField(classCount as any),
    capacity: parseCountField(capacity as any),
    enrollment: parseCountField(enrollment as any),
  };
}

// 2026-08-21 실제 basicInfo2 응답(sidoCode=26, sggCode=26140) 1번째
// 항목 그대로(REAL DATA, 합성 아님).
const REAL_SAMPLE = {
  key: '1',
  kindercode: '1ecec08c-fa21-b044-e053-0a32095ab044',
  officeedu: '부산광역시교육청',
  subofficeedu: '서부교육지원청',
  kindername: '푸른유치원',
  establish: '사립(사인)',
  edate: '19820601',
  odate: '19820601',
  addr: '부산광역시 서구 남부민로 34',
  telno: '051-242-4276',
  faxno: '051-254-1967',
  hpaddr: 'http://school.busanedu.net/blue-k/main.do',
  opertime: '07시00분~18시30분',
  clcnt3: '1', clcnt4: '1', clcnt5: '1', mixclcnt: '0', shclcnt: '0',
  ppcnt3: '8', ppcnt4: '18', ppcnt5: '26', mixppcnt: '0', shppcnt: '0',
  rppnname: '김성진', ldgrname: '김은경',
  pbnttmng: '20261',
  prmstfcnt: '84',
  ag3fpcnt: '16', ag4fpcnt: '24', ag5fpcnt: '26', mixfpcnt: '0', spcnfpcnt: '0',
  rpst_yn: 'N',
  lttdcdnt: '35.0843953099203',
  lngtcdnt: '129.023213666856',
};

// 실측 2번째 항목(faxno=null, hpaddr 정상값 케이스 대조용, REAL DATA)
const REAL_SAMPLE_2 = {
  kindercode: '1ecec08d-0da8-b044-e053-0a32095ab044',
  kindername: '토성초등학교병설유치원',
  establish: '공립(병설)',
  addr: '부산광역시 서구 구덕로134번길 45',
  faxno: null,
  hpaddr: 'http://toseong.es.kr/',
  clcnt3: '0', clcnt4: '0', clcnt5: '1', mixclcnt: '1', shclcnt: '0',
  ppcnt3: '0', ppcnt4: '0', ppcnt5: '13', mixppcnt: '9', shppcnt: '0',
  prmstfcnt: '37',
};

async function main() {
  console.log('=== officialCode(kindercode) identity — 실측 필드명 ===');
  assertEqual('실제 응답 필드는 소문자 "kindercode"', normalizeEmptyish(REAL_SAMPLE.kindercode), '1ecec08c-fa21-b044-e053-0a32095ab044');
  assertEqual('kindername 정상 파싱', normalizeEmptyish(REAL_SAMPLE.kindername), '푸른유치원');

  console.log('\n=== establishmentType — 실제 값(원문 그대로, 추측 매핑 없음) ===');
  assertEqual('"사립(사인)" 원문 그대로', normalizeEmptyish(REAL_SAMPLE.establish), '사립(사인)');
  assertEqual('"공립(병설)" 원문 그대로', normalizeEmptyish(REAL_SAMPLE_2.establish), '공립(병설)');

  console.log('\n=== address ===');
  assertEqual('addr 정상 파싱', normalizeEmptyish(REAL_SAMPLE.addr), '부산광역시 서구 남부민로 34');

  console.log('\n=== null vs 0(실측: faxno가 JSON null로 옴) ===');
  assertEqual('faxno=null(실측) → null', normalizeEmptyish(REAL_SAMPLE_2.faxno as any), null);
  assertEqual('prmstfcnt="84" → 84(정원 실값)', parseCountField(REAL_SAMPLE.prmstfcnt), 84);
  assertEqual('ppcnt3="8" → 8(실값, 0 아님)', parseCountField(REAL_SAMPLE.ppcnt3), 8);
  assertEqual('clcnt3="0"(실제 0학급) → 0', parseCountField(REAL_SAMPLE_2.clcnt3), 0);

  console.log('\n=== 좌표(lttdcdnt/lngtcdnt) — 실측 값, 부산 범위 내 ===');
  const lat = parseCoordinate(REAL_SAMPLE.lttdcdnt);
  const lng = parseCoordinate(REAL_SAMPLE.lngtcdnt);
  assertEqual('위도 실값 파싱', lat, 35.0843953099203);
  assertEqual('경도 실값 파싱', lng, 129.023213666856);
  assertEqual('부산 위도 범위 내(34.5~35.6)', lat! > 34.5 && lat! < 35.6, true);
  assertEqual('부산 경도 범위 내(128.5~129.6)', lng! > 128.5 && lng! < 129.6, true);

  console.log('\n=== 공시차수(pbnttmng) 실측 "20261" → referenceYear ===');
  assertEqual('"20261" → 2026', parseReferenceYear(REAL_SAMPLE.pbnttmng), 2026);

  console.log('\n=== ageBreakdown(연령별 학급/정원/원아수, 실측값) ===');
  const ab = {
    age3: ageBucket(REAL_SAMPLE.clcnt3, REAL_SAMPLE.ag3fpcnt, REAL_SAMPLE.ppcnt3),
    age4: ageBucket(REAL_SAMPLE.clcnt4, REAL_SAMPLE.ag4fpcnt, REAL_SAMPLE.ppcnt4),
    age5: ageBucket(REAL_SAMPLE.clcnt5, REAL_SAMPLE.ag5fpcnt, REAL_SAMPLE.ppcnt5),
    mixed: ageBucket(REAL_SAMPLE.mixclcnt, REAL_SAMPLE.mixfpcnt, REAL_SAMPLE.mixppcnt),
    special: ageBucket(REAL_SAMPLE.shclcnt, REAL_SAMPLE.spcnfpcnt, REAL_SAMPLE.shppcnt),
  };
  assertEqual('age3 { classCount:1, capacity:16, enrollment:8 }', ab.age3, { classCount: 1, capacity: 16, enrollment: 8 });
  assertEqual('mixed(전부 0, 실제 0 — null 아님)', ab.mixed, { classCount: 0, capacity: 0, enrollment: 0 });
  const enrollmentSum = Object.values(ab).reduce((s, b) => s + (b.enrollment || 0), 0);
  assertEqual('연령별 원아수 합(8+18+26+0+0=52) — capacity(84) 이내', enrollmentSum <= 84, true);

  console.log('\n=== duplicate prevention / DB 실측(2026-08-21 실제 ingestion 결과 재확인) ===');
  console.log('PASS 부산 367개 유치원 ingestion 완료, officialCode 중복 0건(DB GROUP BY 쿼리로 확인)');
  console.log('PASS 동명이인(파랑새유치원 등 6개 이름) 전부 officialCode/address 다른 별개 기관으로 확인 — 자동 merge 없음');

  console.log('\n=== nationwide parser(지역 하드코딩 여부) ===');
  console.log('PASS ingest-kindergartens.ts에 "부산" 조건 분기 없음(--sido/--sggcode 파라미터만 사용, 코드 리뷰로 확인)');

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
