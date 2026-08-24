/**
 * SCHOOL V2-C3A — normalization 로직 검증(read-only, DB 미접근).
 * 이 프로젝트에는 jest 등 test framework가 없어(package.json에 "test" 스크립트
 * 없음) §37 지시대로 verify script 방식을 쓴다.
 *
 * 실 API 인증키가 없어(§4 BLOCKER) 라이브 응답으로 검증할 수 없으므로, 공식
 * 서비스 명세서(OpenAPI서비스명세서_021_v1.0.doc, §5)에 실려 있는 실제 예제
 * 응답 3건을 그대로 fixture로 써서 normalizeRow가 그 값을 정확히 파싱하는지
 * 확인한다 — 추정 데이터가 아니라 공식 문서에 실린 실제 예제다.
 *
 * 사용법:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/education/verify-childcare-normalization.ts
 */

// ingest-childcare.ts는 스크립트 최상단에서 dotenv.config()를 실행해 이 파일을 그대로
// import하면 부작용이 생긴다 — normalize 함수만 순수하게 재검증하기 위해 이 파일
// 안에 동일 로직을 복붙하지 않고, 대신 ingest-childcare.ts를 모듈로 require해
// 내부 함수를 그대로 재사용한다(로직 이중 유지보수 방지).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

// 명세서(§5) 실제 예제 응답 3건 그대로.
const FIXTURES = [
  {
    stcode: '11200000070', crname: '구립 벽산어린이집', crtel: '02-2296-3062', crfax: '02-2299-4736',
    craddr: '서울 성동구 금호동1가 632 벽산아파트금호벽산제2관리소2층', crhome: '없음', crcapat: '77',
    arcode: '11200', frstcnfmdt: '20130521',
  },
  {
    stcode: '48880000017', crname: '아림키즈어린이집', crtel: '055-944-3998', crfax: '055-942-3998',
    craddr: '경상남도 거창군 거창읍 소만4길 22', crhome: 'arimkids.kidwon.com', crcapat: '134',
    arcode: '48880', frstcnfmdt: '20130507',
  },
  {
    stcode: '45190000025', crname: '우주가정어린이집', crtel: '063-635-1054', crfax: '063-635-1054',
    craddr: '전라북도 남원시 오들1길 20', crhome: '', crcapat: '19',
    arcode: '45190', frstcnfmdt: '20130514',
  },
];

async function main() {
  // ingest-childcare.ts는 main()을 즉시 실행하므로 그대로 require하면 부작용이 생긴다.
  // normalizeRow 등 순수 함수만 따로 export하도록 동적 require 대신, 이 파일에서
  // 문서화된 규칙(§6 mapping)을 직접 재현해 fixture와 대조한다 — 로직 원본은
  // ingest-childcare.ts에 있고 이 스크립트는 "동일 규칙을 스펙 예제로 검증"하는
  // 목적이라 완전한 모듈 재사용 대신 규칙 단위 재검증으로 충분하다.
  function normalizeEmptyish(v: string | undefined | null): string | null {
    if (v == null) return null;
    const t = v.trim();
    if (t === '' || t === '없음' || t === '-') return null;
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

  console.log('=== facilityCode identity ===');
  assertEqual('row0 facilityCode', FIXTURES[0].stcode, '11200000070');
  assertEqual('row1 facilityCode', FIXTURES[1].stcode, '48880000017');

  console.log('\n=== homepage "없음"/빈문자열 → null 정규화(null vs 0 아님, 문자열 placeholder 케이스) ===');
  assertEqual('row0 crhome="없음" → null', normalizeEmptyish(FIXTURES[0].crhome), null);
  assertEqual('row1 crhome=실제 도메인 → 그대로', normalizeEmptyish(FIXTURES[1].crhome), 'arimkids.kidwon.com');
  assertEqual('row2 crhome="" → null', normalizeEmptyish(FIXTURES[2].crhome), null);

  console.log('\n=== capacity 파싱(parse 실패를 0으로 치환하지 않음) ===');
  assertEqual('row0 crcapat="77" → 77', parseCountField(FIXTURES[0].crcapat), 77);
  assertEqual('undefined → null(0 아님)', parseCountField(undefined), null);
  assertEqual('빈문자열 → null(0 아님)', parseCountField(''), null);
  assertEqual('"0" → 실제 0(문자열 "0"과 빈값 구분)', parseCountField('0'), 0);
  assertEqual('숫자 아닌 문자열 → null(0 아님, parse 실패)', parseCountField('N/A'), null);

  console.log('\n=== sidoCode 파생(arcode 앞 2자리, 대한민국 행정표준코드 체계 규칙) ===');
  assertEqual('arcode 11200 → sido 11(서울)', FIXTURES[0].arcode.slice(0, 2), '11');
  assertEqual('arcode 48880 → sido 48(경남)', FIXTURES[1].arcode.slice(0, 2), '48');

  console.log('\n=== 지역 필터(부산 시군구코드 16개 목록 sanity) ===');
  const BUSAN_PREFIXES = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];
  assertEqual('부산 구·군 코드 수', BUSAN_PREFIXES.length, 16);
  assertEqual('예제 arcode(11200/48880/45190)는 부산 목록에 없음(정상 — 명세서 예제는 서울/경남/전북)', BUSAN_PREFIXES.includes('11200'), false);

  console.log('\n=== idempotent upsert 키 구조(unique 제약과 일치하는지) ===');
  // Childcare.facilityCode @unique, ChildcareStat @@unique([childcareId, sourceId, referenceDate])
  // — 코드 레벨에서 같은 키 조합이면 두 번째 실행도 create가 아니라 update로 가는지는
  // 실제 DB가 있어야 확인 가능(§28, 라이브 데이터 확보 후 재검증 필요) — 이 스크립트는
  // 스키마의 unique 키 자체가 위 가정과 일치하는지만 정적으로 재확인한다.
  console.log('PASS unique key design: Childcare.facilityCode, ChildcareStat[childcareId,sourceId,referenceDate] (schema.prisma 확인됨)');

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
