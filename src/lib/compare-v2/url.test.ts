import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { buildCompareUrl, buildCompareSharePath, parseCompareUrl, parseCompareAptSeqs } from './url';
import { resolveCompareSeeds, EMPTY_COMPARE_SEEDS } from './resolve-seeds';

/**
 * COMPARE_SHARE_URL_COMPACT_FIX_V1 §12.
 *
 * 고정하려는 것은 한 문장이다: **공유 링크에는 canonical aptSeq 둘 말고 아무것도
 * 들어가지 않는다.** 한글이 들어가는 순간 퍼센트 인코딩으로 300자가 넘고, 카카오톡
 * 말풍선이 %EB%... 덩어리가 된다.
 */

const A = { name: '해운대역푸르지오더원', lawdCd: '26350', dong: '우동', aptSeq: '26350-2611' };
const B = { name: '해운대경동제이드', lawdCd: '26350', dong: '우동', aptSeq: '26350-2206' };

// ── A. 짧은 canonical URL ───────────────────────────────────────────────────

test('§A 유효한 aptSeq 둘이면 a/b만 담긴 짧은 경로가 나온다', () => {
  assert.equal(buildCompareSharePath(A.aptSeq, B.aptSeq), '/stats/compare?a=26350-2611&b=26350-2206');
});

test('§A 한쪽이라도 canonical identity가 없으면 공유 경로를 만들지 않는다', () => {
  // 짧지만 열리지 않는 링크를 만드느니 만들지 않는다.
  assert.equal(buildCompareSharePath('26350-2611', null), null);
  assert.equal(buildCompareSharePath(null, '26350-2206'), null);
  assert.equal(buildCompareSharePath(undefined, undefined), null);
});

// ── B/C/D. 금지 항목 ────────────────────────────────────────────────────────

test('§B/§C 공유 URL에 단지명·법정동·구코드가 없다', () => {
  const qs = new URLSearchParams(buildCompareSharePath(A.aptSeq, B.aptSeq)!.split('?')[1]);
  assert.deepEqual([...qs.keys()].sort(), ['a', 'b']);
  for (const banned of ['aName', 'bName', 'aDong', 'bDong', 'aLawdCd', 'bLawdCd', 'aptSeq']) {
    assert.equal(qs.has(banned), false, `${banned}가 남아 있다`);
  }
});

test('§D 공유 URL에 퍼센트 인코딩된 한글이 없다', () => {
  const path = buildCompareSharePath(A.aptSeq, B.aptSeq)!;
  assert.ok(!/%[0-9A-F]{2}/i.test(path), `인코딩된 문자가 있다: ${path}`);
  // aptSeq는 숫자와 하이픈뿐이라 인코딩될 것이 없다.
  assert.ok(/^\/stats\/compare\?a=[\d-]+&b=[\d-]+$/.test(path));
});

test('§10 길이 감소 — 예전 형태 대비 4분의 1 이하', () => {
  const legacyQs = new URLSearchParams();
  legacyQs.set('aptSeq', `${A.aptSeq},${B.aptSeq}`);
  legacyQs.set('aName', A.name);
  legacyQs.set('aLawdCd', A.lawdCd);
  legacyQs.set('aDong', A.dong);
  legacyQs.set('bName', B.name);
  legacyQs.set('bLawdCd', B.lawdCd);
  legacyQs.set('bDong', B.dong);
  const legacy = `/stats/compare?${legacyQs.toString()}`;
  const compact = buildCompareSharePath(A.aptSeq, B.aptSeq)!;
  assert.ok(compact.length * 4 < legacy.length, `legacy ${legacy.length} vs compact ${compact.length}`);
});

// ── 주소창 URL(router.replace) ──────────────────────────────────────────────

test('§5 aptSeq를 아는 슬롯은 주소창에서도 a/b 한 글자로 끝난다', () => {
  assert.equal(buildCompareUrl(A, B), '/stats/compare?a=26350-2611&b=26350-2206');
});

test('§5 canonical identity가 없는 슬롯만 동반 파라미터를 유지한다', () => {
  const nameOnly = { name: '경동', lawdCd: '26350', dong: '우동' };
  const qs = new URLSearchParams(buildCompareUrl(A, nameOnly).split('?')[1]);
  assert.equal(qs.get('a'), '26350-2611');
  assert.equal(qs.has('b'), false);
  // 복원 가능성이 우선이다 — 짧게 만들자고 못 여는 링크를 만들지 않는다.
  assert.equal(qs.get('bName'), '경동');
  assert.equal(qs.get('bLawdCd'), '26350');
  assert.equal(qs.get('bDong'), '우동');
});

// ── E/F. 수신 측 해석 ───────────────────────────────────────────────────────

test('§E a/b를 그대로 읽어낸다', () => {
  const qs = new URLSearchParams('a=26350-2611&b=26350-2206');
  assert.deepEqual(parseCompareAptSeqs(qs), { a: '26350-2611', b: '26350-2206' });
  assert.deepEqual(parseCompareAptSeqs(new URLSearchParams()), { a: null, b: null });
  assert.deepEqual(parseCompareAptSeqs({ a: ' 26350-2611 ', b: '' }), { a: '26350-2611', b: null });
});

/** resolveCompareSeeds가 쓰는 findUnique만 구현한 가짜 prisma. */
function fakePrisma(rows: { aptSeq: string; name: string; sggCd: string | null; umdName: string | null }[]) {
  return {
    apartmentMaster: {
      async findUnique({ where }: { where: { aptSeq: string } }) {
        return rows.find((r) => r.aptSeq === where.aptSeq) ?? null;
      },
    },
  } as never;
}

const ROWS = [
  { aptSeq: '26350-2611', name: '해운대역푸르지오더원', sggCd: '26350', umdName: '우동' },
  { aptSeq: '26230-149', name: '대원아파트', sggCd: '26230', umdName: '범천동' },
  // 주소가 비어 있는 master — 비교 조회를 구성할 수 없다.
  { aptSeq: '26440-329', name: '에코델타더베르힐', sggCd: null, umdName: null },
];

test('§E aptSeq에서 이름·구·동을 canonical 데이터로 복원한다', async () => {
  const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: '26350-2611', b: '26230-149' });
  assert.deepEqual(r.seeds[0], { name: '해운대역푸르지오더원', lawdCd: '26350', dong: '우동', aptSeq: '26350-2611' });
  assert.deepEqual(r.seeds[1], { name: '대원아파트', lawdCd: '26230', dong: '범천동', aptSeq: '26230-149' });
  assert.deepEqual(r.unresolved, []);
});

test('§E 순서가 보존된다 — a는 첫째 칸, b는 둘째 칸', async () => {
  const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: '26230-149', b: '26350-2611' });
  assert.equal(r.seeds[0]?.aptSeq, '26230-149');
  assert.equal(r.seeds[1]?.aptSeq, '26350-2611');
});

test('§I 없는 aptSeq는 정직하게 미해결로 남는다 — 다른 단지로 채우지 않는다', async () => {
  const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: '26350-2611', b: '26350-9999' });
  assert.equal(r.seeds[0]?.aptSeq, '26350-2611');
  assert.equal(r.seeds[1], null);
  assert.deepEqual(r.unresolved, ['26350-9999']);
});

test('§I 형태부터 aptSeq가 아니면 미해결', async () => {
  for (const bad of ['해운대경동제이드', '26350', "26350-1' OR 1=1"]) {
    const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: bad, b: null });
    assert.equal(r.seeds[0], null, `${bad}가 통과했다`);
    assert.deepEqual(r.unresolved, [bad]);
  }
});

test('§J 주소가 없는 master는 억지로 채우지 않는다', async () => {
  const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: '26440-329', b: null });
  assert.equal(r.seeds[0], null);
  assert.deepEqual(r.unresolved, ['26440-329']);
});

test('§E a/b가 아예 없으면 DB를 건드리지 않는다', async () => {
  const r = await resolveCompareSeeds(fakePrisma(ROWS), { a: null, b: undefined });
  assert.deepEqual(r, EMPTY_COMPARE_SEEDS);
});

test('§F legacy 긴 URL은 계속 열린다', () => {
  const qs = new URLSearchParams(
    'aptSeq=26140-1356%2C26140-2000&aName=%EB%8C%80%EC%8B%A0%ED%95%B4%EB%AA%A8%EB%A1%9C&aLawdCd=26140&aDong=%EC%84%9C%EB%8C%80%EC%8B%A0%EB%8F%992%EA%B0%80&bName=%EB%8C%80%EC%8B%A0%EB%8D%94%EC%83%B5&bLawdCd=26140&bDong=%EB%8C%80%EC%8B%A0%EB%8F%99'
  );
  const parsed = parseCompareUrl(qs);
  assert.deepEqual(parsed.a, { name: '대신해모로', lawdCd: '26140', dong: '서대신동2가', aptSeq: '26140-1356' });
  assert.deepEqual(parsed.b, { name: '대신더샵', lawdCd: '26140', dong: '대신동', aptSeq: '26140-2000' });
});

test('§F 짧은 URL에는 legacy 파서가 아무것도 만들지 않는다(서버가 복원한다)', () => {
  const parsed = parseCompareUrl(new URLSearchParams('a=26350-2611&b=26350-2206'));
  assert.equal(parsed.a, undefined);
  assert.equal(parsed.b, undefined);
});

// ── G/H. 공유 페이로드 ──────────────────────────────────────────────────────

const ROOT = resolvePath(__dirname, '../../..');
const COMPARE = readFileSync(resolvePath(ROOT, 'src/components/compare/CompareV2.tsx'), 'utf8');
const HOOK = readFileSync(resolvePath(ROOT, 'src/hooks/useSharePage.ts'), 'utf8');

test('§G 공유 text에 URL을 넣지 않는다 — Web Share의 url 필드가 따로 있다', () => {
  const textProp = COMPARE.match(/text="([^"]*)"/);
  assert.ok(textProp, '공유 text를 찾지 못했다');
  assert.ok(!/https?:|\{shareUrl\}|url/i.test(textProp![1]), `text에 URL이 섞였다: ${textProp![1]}`);
  assert.equal(textProp![1], '2개 단지 시세와 데이터를 비교해보세요.');
});

test('§G 공유 payload는 title/text/url 세 필드로만 나간다', () => {
  assert.ok(/await nativeShare\(\{ title, text, url \}\)/.test(HOOK));
  // 카카오 폴백도 url을 description에 복사하지 않는다.
  assert.ok(/sendKakaoShare\(\{ title, description: text \|\| title, url, imageUrl/.test(HOOK));
});

test('§6 호출부가 준 canonical URL이 주소창 복사보다 우선한다', () => {
  assert.ok(/const url = explicitUrl \|\| buildShareUrl\(params\);/.test(HOOK));
  assert.ok(/url=\{shareUrl\}/.test(COMPARE), '비교 화면이 canonical URL을 넘기지 않는다');
  // 예전처럼 주소창 파라미터를 덧씌우는 방식이 남아 있으면 안 된다.
  assert.ok(!/params=\{shareParams\}/.test(COMPARE));
});

test('§8 공유 URL의 오리진은 siteConfig에서 나온다 — 호스트를 박지 않는다', () => {
  assert.ok(/absoluteUrl\(sharePath\)/.test(COMPARE));
  // 주석은 빼고 본다 — 커토버 절차를 설명하는 문장에 도메인이 등장할 수 있다.
  const code = COMPARE.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/vercel\.app|e-jip\.com/.test(code), '비교 화면에 호스트가 박혀 있다');
});

test('§11 공유 URL에 자유 입력이 들어갈 자리가 없다', () => {
  // 공유 경로를 만드는 인자는 aptSeq 둘뿐이다(가격·메모·사용자 입력이 낄 자리가 없다).
  assert.equal(buildCompareSharePath.length, 2);
});
