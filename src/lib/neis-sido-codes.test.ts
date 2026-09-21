import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  addressMatchesRegion,
  bucketForTab,
  classifySchoolKind,
  isTentativeSchoolRecord,
  resolveNeisEduCode,
  schoolBelongsToRegion,
} from './neis-sido-codes';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
const school = (SCHUL_NM: string, ORG_RDNMA: string) => ({ SCHUL_NM, ORG_RDNMA, LCTN_SC_NM: '부산광역시' });

// 부산 16개 구·군. 이름 일부가 다른 지역명에 포함되는 쌍이 많아 회귀 대상이다.
const BUSAN = ['중구','서구','동구','영도구','부산진구','동래구','남구','북구','해운대구','사하구','금정구','강서구','연제구','수영구','사상구','기장군'];

// ── A/B. 사용자가 보고한 바로 그 사례 ────────────────────────────────────────

test('A · 서구를 고르면 (가칭)명지 학교가 0건이다', () => {
  // 실측한 NEIS 원본 주소 그대로 — 명지는 강서구인데 NEIS는 설립 교육지원청 주소를 준다.
  const reported = [
    school('(가칭)명지3고등학교', '부산광역시 부산진구 화지로 12'),
    school('(가칭)명지3중학교', '부산광역시 북구 백양대로1016번다길 44'),
    school('(가칭)명지4중학교', '부산광역시 북구 백양대로1016번다길 44'),
    school('(가칭)명지6초등학교', '부산광역시 북구 백양대로1016번다길 44'),
  ];
  const shown = reported.filter((s) => schoolBelongsToRegion(s, '부산광역시 서구', '서구'));
  assert.deepEqual(shown, [], '서구 목록에 다른 구 학교가 섞였다');
});

test('A2 · 그 학교들은 주소상의 구(부산진구·북구)에도 노출되지 않는다 — 소속을 주장할 근거가 없다', () => {
  // 세 학교가 한 주소를 공유한다는 것 자체가 "학교 위치가 아니라 사무소 주소"라는 증거다.
  const s = school('(가칭)명지3중학교', '부산광역시 북구 백양대로1016번다길 44');
  for (const g of BUSAN) {
    assert.equal(schoolBelongsToRegion(s, `부산광역시 ${g}`, g), false, `${g} 목록에 들어갔다`);
  }
});

test('B · 강서구를 고르면 실제 강서구 학교는 정상 노출된다', () => {
  const real = school('명지초등학교', '부산광역시 강서구 명지국제7로 60');
  assert.equal(schoolBelongsToRegion(real, '부산광역시 강서구', '강서구'), true);
  assert.equal(schoolBelongsToRegion(real, '부산광역시 서구', '서구'), false);
});

// ── C/D. 완전일치만 허용, 부분일치 금지 ──────────────────────────────────────

test('C · 시/군/구 토큰 완전일치만 통과한다', () => {
  assert.equal(addressMatchesRegion('부산광역시 서구 구덕로 225', '부산광역시 서구', '서구'), true);
  assert.equal(addressMatchesRegion('부산광역시 강서구 명지국제7로 60', '부산광역시 서구', '서구'), false);
});

test('D · substring fallback이 없다 — 이름이 포함관계인 구가 서로를 끌어오지 않는다', () => {
  const pairs: [string, string][] = [
    ['서구', '강서구'], ['동구', '해운대구'], ['남구', '해운대구'],
    ['북구', '강서구'], ['사하구', '사상구'], ['중구', '기장군'],
  ];
  for (const [picked, other] of pairs) {
    const addr = `부산광역시 ${other} 어떤로 1`;
    assert.equal(
      addressMatchesRegion(addr, `부산광역시 ${picked}`, picked),
      false,
      `${picked} 선택에 ${other} 주소가 매칭됐다`
    );
  }
  // 반대로 자기 자신은 반드시 매칭된다.
  for (const g of BUSAN) {
    assert.equal(addressMatchesRegion(`부산광역시 ${g} 어떤로 1`, `부산광역시 ${g}`, g), true, g);
  }
});

/** 주석을 지운 실제 코드만 본다 — 주석에 옛 코드를 인용해 둔 것까지 잡으면 오탐이다. */
const codeOnly = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

test('D2 · 코드에 loose fallback 지름길이 다시 생기지 않는다(회귀 방지)', () => {
  const guard = codeOnly('src/lib/neis-sido-codes.ts');
  assert.ok(!/addr\.includes\(/.test(guard), 'addr.includes(...) fail-open이 되살아났다');
  const listRoute = codeOnly('src/app/api/school/route.ts');
  assert.ok(!/SCHUL_NM\.includes\(/.test(listRoute), '학교명 기반 지역 예외가 다시 생겼다');
  const statsRoute = codeOnly('src/app/api/school/stats/route.ts');
  // 목록과 요약 카드가 같은 판정 함수를 쓰는지(§11 parity).
  for (const [name, code] of [['list', listRoute], ['stats', statsRoute]] as const) {
    assert.ok(code.includes('schoolBelongsToRegion'), `${name} 라우트가 공통 판정을 쓰지 않는다`);
  }
});

// ── E. 지역 불명 → 다른 구 fallback 없이 NO DATA ─────────────────────────────

test('E · 시/군/구가 비면 전 지역을 열어주지 않고 0건이다', () => {
  // 이것이 사용자가 본 현상의 실제 원인이었다: region "부산광역시 " (sigungu='')가
  // 부산 671곳 중 663곳을 통과시켰다.
  for (const gungu of ['', ' ', undefined as unknown as string]) {
    assert.equal(addressMatchesRegion('부산광역시 북구 백양대로1016번다길 44', '부산광역시 ', gungu), false);
  }
  const all = [
    school('(가칭)명지3고등학교', '부산광역시 부산진구 화지로 12'),
    school('경남고등학교', '부산광역시 서구 구덕로 225'),
  ];
  assert.deepEqual(all.filter((s) => schoolBelongsToRegion(s, '부산광역시 ', '')), []);
});

test('E2 · 주소가 없으면 어느 구에도 넣지 않는다', () => {
  assert.equal(addressMatchesRegion('', '부산광역시 서구', '서구'), false);
  assert.equal(schoolBelongsToRegion({ SCHUL_NM: '어떤학교', ORG_RDNMA: null, LCTN_SC_NM: null }, '부산광역시 서구', '서구'), false);
});

// ── F. 16개 구·군 전체 — wrong-district 0 ────────────────────────────────────

test('F · 부산 16개 구·군 어디를 골라도 다른 구 학교가 0건이다', () => {
  // 각 구마다 "자기 학교 1곳 + 나머지 15개 구 학교"를 넣고, 자기 것만 나오는지 본다.
  const corpus = BUSAN.map((g) => school(`${g}테스트학교`, `부산광역시 ${g} 어떤로 1`));
  let totalWrong = 0;
  for (const g of BUSAN) {
    const shown = corpus.filter((s) => schoolBelongsToRegion(s, `부산광역시 ${g}`, g));
    const wrong = shown.filter((s) => s.SCHUL_NM !== `${g}테스트학교`);
    totalWrong += wrong.length;
    assert.equal(shown.length, 1, `${g}: 반환 ${shown.length}건`);
  }
  assert.equal(totalWrong, 0, 'wrong-district가 남아 있다');
});

// ── (가칭) 판정 ──────────────────────────────────────────────────────────────

test('(가칭) 레코드만 제외하고, 개교한 학교는 그대로 둔다', () => {
  assert.equal(isTentativeSchoolRecord('(가칭)명지3중학교'), true);
  assert.equal(isTentativeSchoolRecord('명지중학교'), false);
  assert.equal(isTentativeSchoolRecord(''), false);
  assert.equal(isTentativeSchoolRecord(null), false);
  // 개교 후 NEIS가 실제 주소를 채우면 자동으로 다시 포함된다.
  assert.equal(schoolBelongsToRegion(school('명지3중학교', '부산광역시 강서구 명지국제7로 60'), '부산광역시 강서구', '강서구'), true);
});

// ── 대신 학교: 이름 예외를 지워도 주소로 정상 포함된다 ───────────────────────

test('대신 계열 3곳은 이름 예외 없이 주소만으로 서구에 포함된다', () => {
  const daesin = [
    school('대신여자중학교', '부산광역시 서구 보동길 268'),
    school('대신초등학교', '부산광역시 서구 대신로 63'),
    school('부산대신중학교', '부산광역시 서구 대신로109번길 10'),
  ];
  assert.equal(daesin.filter((s) => schoolBelongsToRegion(s, '부산광역시 서구', '서구')).length, 3);
});

// ── 교육청 코드 ──────────────────────────────────────────────────────────────

test('resolveNeisEduCode — 모르는 시도는 다른 지역으로 대체하지 않고 null', () => {
  assert.equal(resolveNeisEduCode('부산광역시'), 'C10');
  assert.equal(resolveNeisEduCode('없는도'), null);
});

// ── COUNT CONTRACT (OPTION B) ───────────────────────────────────────────────

test('§10 · 서구 24 = 초 11 + 중 7 + 고 5 + 기타 1 (N = A+B+C+D)', () => {
  // 실측 NEIS 서구 24곳의 학교급 구성을 그대로 재현한다.
  const kinds = [
    ...Array(11).fill('초등학교'),
    ...Array(7).fill('중학교'),
    ...Array(5).fill('고등학교'),
    '특수학교', // 부산혜송학교
  ];
  const c = { elementary: 0, middle: 0, high: 0, other: 0 };
  for (const k of kinds) c[classifySchoolKind(k)]++;
  assert.deepEqual(c, { elementary: 11, middle: 7, high: 5, other: 1 });
  assert.equal(c.elementary + c.middle + c.high + c.other, 24, 'total = 초+중+고+기타 여야 한다');
});

test('§10 · 부산혜송학교(특수학교)는 전체에 포함되고 초/중/고 탭에는 없다', () => {
  assert.equal(classifySchoolKind('특수학교'), 'other');
  assert.equal(bucketForTab('전체'), null, '전체 탭은 학교급 필터를 걸지 않는다');
  for (const tab of ['초등', '중등', '고등']) {
    assert.notEqual(bucketForTab(tab), 'other');
  }
});

test('§7 · 초/중/고 밖 학교급은 버리지 않고 전부 기타로 센다', () => {
  const others = [
    '특수학교', '외국인학교', '각종학교(고)', '각종학교(중)', '방송통신고등학교',
    '방송통신중학교', '고등기술학교', '공동실습소', '평생학교(고)-3년6학기', '평생학교(중)-2년6학기',
  ];
  for (const k of others) assert.equal(classifySchoolKind(k), 'other', k);
  // 값이 없거나 모르는 학교급도 버리지 않는다.
  assert.equal(classifySchoolKind(null), 'other');
  assert.equal(classifySchoolKind(undefined), 'other');
  assert.equal(classifySchoolKind('미래에생길학교급'), 'other');
});

test('§7 · 이름이 비슷해도 초/중/고로 승격되지 않는다(숫자 부풀림 방지)', () => {
  assert.equal(classifySchoolKind('방송통신고등학교'), 'other', "'고등학교'로 끝난다고 고등이 되면 안 된다");
  assert.equal(classifySchoolKind('방송통신중학교'), 'other');
  assert.equal(classifySchoolKind('고등기술학교'), 'other');
  assert.equal(classifySchoolKind('고등학교'), 'high');
});

test('§8 · 탭 계약 — 전체/학원가는 전체, 초등/중등/고등만 좁힌다', () => {
  assert.equal(bucketForTab('전체'), null);
  assert.equal(bucketForTab('학원가'), null);
  assert.equal(bucketForTab('초등'), 'elementary');
  assert.equal(bucketForTab('중등'), 'middle');
  assert.equal(bucketForTab('고등'), 'high');
});

test('§6 · 목록과 요약 카드가 같은 분류 함수를 쓴다(계약 분기 방지)', () => {
  for (const rel of ['src/app/api/school/route.ts', 'src/app/api/school/stats/route.ts']) {
    assert.ok(read(rel).includes('classifySchoolKind'), `${rel}가 공통 분류를 쓰지 않는다`);
  }
  // 요약 카드 total에 기타가 포함돼야 한다.
  const stats = read('src/app/api/school/stats/route.ts');
  assert.ok(/highCount \+ otherCount/.test(stats), 'total에 otherCount가 빠졌다');
});

// ── REGION TRANSITION (P0) ──────────────────────────────────────────────────

test('§1~§3 · 지역 전환 시 이전 목록을 버리고, 늦은 응답이 덮지 못한다', () => {
  const client = read('src/app/school/school-client.tsx');
  assert.ok(client.includes('setSchools([])'), '지역/탭 변경 시 목록 초기화가 없다');
  assert.ok(client.includes('setStats(EMPTY_STATS)'), '지역 변경 시 통계 초기화가 없다');
  assert.ok(client.includes('AbortController'), '요청 취소 가드가 없다');
  assert.ok(client.includes('cancelled = true'), 'stale 응답 가드가 없다');
  assert.ok(/\{!loading && schools\.map\(/.test(client), '로딩 중에도 이전 목록을 렌더한다');
});
