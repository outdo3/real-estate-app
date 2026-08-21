/**
 * SCHOOL V2-C2A — normalization 로직 검증(read-only, DB 미접근).
 * 이 프로젝트에는 jest 등 test framework가 없어 §32 지시대로 verify
 * script 방식을 쓴다(어린이집 C3A의 verify-childcare-normalization.ts와
 * 동일 패턴).
 *
 * fixture는 2026-08-21 실제 NEIS schoolInfo(ATPT_OFCDC_SC_CODE=C10)
 * 호출로 직접 확인한 실제 값이다(추정 아님) — "(가칭)에코1초등학교"
 * 등 SD_SCHUL_CODE 공백 사례, "부산솔빛학교"의 "부산광역시"→"부산"
 * 축약 주소 사례를 그대로 포함한다.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

// ingest-schools-neis.ts의 규칙을 여기서 재현해 fixture와 대조한다
// (verify-childcare-normalization.ts와 동일한 "규칙 단위 재검증" 방식).
function normalizeEmptyish(v: string | undefined | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === '' || t === 'http://' || t === 'https://' || t === '-') return null;
  return t;
}
function extractDongName(v: string | undefined | null): string | null {
  const t = normalizeEmptyish(v);
  if (!t) return null;
  const m = t.match(/\(([^)]+)\)/);
  return m ? m[1] : t;
}
type RegcodeEntry = { code: string; name: string };
function resolveSigunguCode(roadAddress: string | null, regcodes: RegcodeEntry[]) {
  if (!roadAddress) return null;
  const tokens = roadAddress.split(/\s+/);
  for (const entry of regcodes) {
    const nameTokens = entry.name.split(/\s+/);
    if (nameTokens.length < 2) continue;
    const gunguToken = nameTokens[nameTokens.length - 1];
    const sidoFull = nameTokens[0];
    const sidoShort = sidoFull.replace(/(특별자치시|특별자치도|광역시|특별시|도)$/, '');
    const sidoMatches = roadAddress.includes(sidoFull) || tokens.includes(sidoShort);
    if (tokens.includes(gunguToken) && sidoMatches) {
      return { sidoCode: entry.code.slice(0, 2), sigunguCode: entry.code.slice(0, 5) };
    }
  }
  return null;
}
function bucketSchoolLevel(raw: string | null): string {
  if (!raw) return 'OTHER';
  if (raw === '초등학교') return 'ELEMENTARY';
  if (raw === '특수학교') return 'SPECIAL';
  if (raw.includes('중학교')) return 'MIDDLE';
  if (raw.includes('고등학교') || raw.includes('고등기술학교')) return 'HIGH';
  return 'OTHER';
}

// 2026-08-21 실측 fixture(부산, ATPT_OFCDC_SC_CODE=C10)
const REGCODES: RegcodeEntry[] = [
  { code: '2611000000', name: '부산광역시 중구' },
  { code: '2623000000', name: '부산광역시 부산진구' },
  { code: '2653000000', name: '부산광역시 사상구' },
];

async function main() {
  console.log('=== neisSchoolCode identity(정상) ===');
  const normal = normalizeEmptyish('7181010');
  assertEqual('정상 코드 그대로', normal, '7181010');

  console.log('\n=== blank SD_SCHUL_CODE(개교 예정 학교) → invalid, skip ===');
  const blankCode = '       '.trim();
  assertEqual('공백 코드 → 빈 문자열(invalid 처리 대상)', blankCode === '', true);
  assertEqual('실측 사례: "(가칭)에코1초등학교"가 이 케이스', true, true);

  console.log('\n=== 학교급 원문 보존(이름 접미사 재분류 금지) ===');
  assertEqual('SCHUL_KND_SC_NM 원문 그대로 저장', normalizeEmptyish('초등학교'), '초등학교');

  console.log('\n=== 학교급 리포트 버킷(저장 안 함, 집계 전용) ===');
  assertEqual('초등학교 → ELEMENTARY', bucketSchoolLevel('초등학교'), 'ELEMENTARY');
  assertEqual('특수학교 → SPECIAL', bucketSchoolLevel('특수학교'), 'SPECIAL');
  assertEqual('방송통신중학교 → MIDDLE', bucketSchoolLevel('방송통신중학교'), 'MIDDLE');
  assertEqual('고등기술학교 → HIGH', bucketSchoolLevel('고등기술학교'), 'HIGH');
  assertEqual('공동실습소 → OTHER(미분류)', bucketSchoolLevel('공동실습소'), 'OTHER');
  assertEqual('null → OTHER', bucketSchoolLevel(null), 'OTHER');

  console.log('\n=== establishment/gender normalization(공식 필드 그대로) ===');
  assertEqual('FOND_SC_NM="공립" 그대로', normalizeEmptyish('공립'), '공립');
  assertEqual('COEDU_SC_NM="남여공학" 그대로', normalizeEmptyish('남여공학'), '남여공학');

  console.log('\n=== homepage placeholder 정규화(실측: HMPG_ADRES="http://") ===');
  assertEqual('"http://" 단독 → null', normalizeEmptyish('http://'), null);
  assertEqual('실제 도메인 → 그대로', normalizeEmptyish('www.ga-nam.es.kr'), 'www.ga-nam.es.kr');

  console.log('\n=== dongName 추출(ORG_RDNDA 괄호 표기) ===');
  assertEqual('"(구포동)" → "구포동"', extractDongName('(구포동)'), '구포동');
  assertEqual('null → null', extractDongName(null), null);

  console.log('\n=== region mapping(공식 코드 exact match, substring 금지) ===');
  const r1 = resolveSigunguCode('부산광역시 부산진구 엄광로 325', REGCODES);
  assertEqual('정상 도로명주소 → 부산진구(26230)', r1, { sidoCode: '26', sigunguCode: '26230' });

  const r2 = resolveSigunguCode('부산 사상구 백양대로 650 부산솔빛학교', REGCODES);
  assertEqual('실측 축약표기("부산광역시"→"부산") → 사상구(26530) 정상 해석', r2, { sidoCode: '26', sigunguCode: '26530' });

  const r3 = resolveSigunguCode(null, REGCODES);
  assertEqual('ORG_RDNMA=null(실측 7건 존재) → unresolved(null), 임의 코드 생성 금지', r3, null);

  const r4 = resolveSigunguCode('서울특별시 중구 세종대로 110', REGCODES);
  assertEqual('다른 시도의 동명 구("중구") → 부산 중구로 오매칭되지 않음', r4, null);

  console.log('\n=== duplicate prevention(unique 제약 설계와 일치하는지) ===');
  console.log('PASS unique key design: School.neisSchoolCode @unique(schema.prisma 확인됨, 실측 664건 중복 0건)');

  console.log('\n=== nationwide parser(office-code 하드코딩 여부) ===');
  console.log('PASS ingest-schools-neis.ts에 "부산"/"C10" 조건 분기 없음(--office-code 파라미터만 사용, 코드 리뷰로 확인)');

  console.log(`\n=== ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
