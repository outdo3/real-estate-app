import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { resolveScoreIdentity, isWellFormedAptSeq } from './resolve-score-identity';

/**
 * SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 §11.
 *
 * 고정하려는 계약은 하나다: **canonical aptSeq가 있으면 그것이 이긴다.** 없을 때만
 * 예전 이름+법정동 규칙을 쓰고, 그 규칙은 조금도 넓어지지 않았다.
 */

type MasterRow = { id: number; aptSeq: string | null; name: string; umdName: string | null; sggCd: string | null };

/**
 * 실제 부산 데이터에서 이 STEP의 문제를 일으킨 조합을 그대로 옮겨 놓은 표본.
 * 26230-1810(대원)이 들어오면서 26230-149(대원아파트)와 정규화 이름이 겹쳤다.
 */
const MASTERS: MasterRow[] = [
  { id: 149, aptSeq: '26230-149', name: '대원아파트', umdName: '범천동', sggCd: '26230' },
  { id: 1810, aptSeq: '26230-1810', name: '대원', umdName: '부전동', sggCd: '26230' },
  { id: 373, aptSeq: '26230-373', name: '동진', umdName: '부전동', sggCd: '26230' },
  // 같은 구의 무관한 단지 — 부분포함 폴백이 이것까지 끌어오지 않는지 본다.
  { id: 900, aptSeq: '26230-900', name: '서면푸르지오', umdName: '부전동', sggCd: '26230' },
  { id: 901, aptSeq: '26140-901', name: '금호어울림', umdName: '서대신동3가', sggCd: '26140' },
];

/** resolveScoreIdentity가 실제로 쓰는 두 쿼리만 구현한 가짜 prisma. */
function fakePrisma(rows: MasterRow[] = MASTERS) {
  const calls: string[] = [];
  const client = {
    apartmentMaster: {
      async findUnique({ where }: { where: { aptSeq: string } }) {
        calls.push(`findUnique:${where.aptSeq}`);
        return rows.find((r) => r.aptSeq === where.aptSeq) ?? null;
      },
      async findMany({ where }: { where: { sggCd?: string; umdName?: string } }) {
        calls.push(`findMany:${where.sggCd}:${where.umdName ?? '*'}`);
        return rows.filter(
          (r) =>
            r.aptSeq !== null &&
            r.sggCd === where.sggCd &&
            (where.umdName === undefined || r.umdName === where.umdName)
        );
      },
    },
  };
  // 테스트에서 필요한 두 메서드만 가진 최소 구현 — 라우트가 쓰는 것도 이 둘뿐이다.
  return { prisma: client as never, calls };
}

// ── aptSeq 직접 해소 ────────────────────────────────────────────────────────

test('§5 aptSeq=26230-1810 → 대원만 해소된다', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptSeqParam: '26230-1810', aptName: '대원', lawdCd: '', dong: '' });
  assert.deepEqual(r, { kind: 'RESOLVED', aptSeq: '26230-1810', via: 'APT_SEQ' });
});

test('§5 aptSeq=26230-149 → 대원아파트만 해소된다. 법정동이 필요 없다', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptSeqParam: '26230-149', aptName: '대원아파트', lawdCd: '', dong: '' });
  assert.deepEqual(r, { kind: 'RESOLVED', aptSeq: '26230-149', via: 'APT_SEQ' });
});

test('§2 aptSeq가 있으면 이름 조회를 아예 하지 않는다', async () => {
  const { prisma, calls } = fakePrisma();
  await resolveScoreIdentity(prisma, { aptSeqParam: '26230-149', aptName: '대원아파트', lawdCd: '26230', dong: '범천동' });
  assert.deepEqual(calls, ['findUnique:26230-149'], '이름/지역 조회가 일어났다');
});

test('§2 약한 단서(이름)가 aptSeq를 뒤집지 못한다', async () => {
  const { prisma } = fakePrisma();
  // 이름은 대원아파트인데 aptSeq는 대원을 가리킨다 — canonical identity가 이긴다.
  const r = await resolveScoreIdentity(prisma, {
    aptSeqParam: '26230-1810',
    aptName: '대원아파트',
    lawdCd: '26230',
    dong: '범천동',
  });
  assert.equal(r.kind === 'RESOLVED' && r.aptSeq, '26230-1810');
});

// ── 이 STEP이 실제로 고친 회귀 ──────────────────────────────────────────────

test('§5 회귀: 법정동 없는 요청이 예전에는 AMBIGUOUS였다 (aptSeq 없을 때)', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptName: '대원아파트', lawdCd: '26230', dong: '' });
  // 26230 안에 정규화 이름 "대원"이 둘이라 확정할 수 없다 — 추측하지 않는다.
  assert.deepEqual(r, { kind: 'AMBIGUOUS' });
});

test('§5 같은 요청에 aptSeq만 더하면 점수가 되살아난다', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptSeqParam: '26230-149', aptName: '대원아파트', lawdCd: '26230', dong: '' });
  assert.equal(r.kind === 'RESOLVED' && r.aptSeq, '26230-149');
});

test('§5 이름만 모호한 요청은 여전히 AMBIGUOUS로 막힌다 — 첫 번째를 고르지 않는다', async () => {
  const { prisma } = fakePrisma();
  for (const name of ['대원', '대원아파트']) {
    const r = await resolveScoreIdentity(prisma, { aptName: name, lawdCd: '26230', dong: '' });
    assert.equal(r.kind, 'AMBIGUOUS', `${name}이 임의로 확정됐다`);
  }
});

// ── 기존 폴백 경로 보존(§4) ─────────────────────────────────────────────────

test('§4 법정동이 있으면 기존 경로가 그대로 동작한다', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptName: '대원아파트', lawdCd: '26230', dong: '범천동' });
  assert.deepEqual(r, { kind: 'RESOLVED', aptSeq: '26230-149', via: 'EXACT_NAME' });
});

test('§4 정확 일치가 없을 때의 부분포함 폴백도 그대로다', async () => {
  const { prisma } = fakePrisma();
  // 사용자가 "금호어울림"으로 들어왔지만 등록명은 "금호어울림" 그대로인 경우 exact,
  // 표기가 다른 경우에만 느슨한 규칙으로 내려간다.
  const r = await resolveScoreIdentity(prisma, { aptName: '금호어울림', lawdCd: '26140', dong: '' });
  assert.equal(r.kind === 'RESOLVED' && r.aptSeq, '26140-901');
});

test('§4 lawdCd가 없고 aptSeq도 없으면 이름만으로 해소하지 않는다', async () => {
  const { prisma, calls } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptName: '대원아파트', lawdCd: '', dong: '' });
  assert.deepEqual(r, { kind: 'AMBIGUOUS' });
  assert.deepEqual(calls, [], '지역 제약 없이 DB를 뒤졌다');
});

test('§9 그 구에 없는 이름은 NOT_FOUND — 다른 단지로 대체하지 않는다', async () => {
  const { prisma } = fakePrisma();
  const r = await resolveScoreIdentity(prisma, { aptName: '존재하지않는단지', lawdCd: '26230', dong: '' });
  assert.deepEqual(r, { kind: 'NOT_FOUND' });
});

// ── 잘못된 aptSeq(§9) ───────────────────────────────────────────────────────

test('§9 형태가 aptSeq가 아니면 DB에 묻지도 않고 NOT_FOUND', async () => {
  for (const bad of ['대원아파트', '26230', 'abc-1', '26230-', "26230-1' OR 1=1", '2623-1']) {
    const { prisma, calls } = fakePrisma();
    const r = await resolveScoreIdentity(prisma, { aptSeqParam: bad, aptName: '대원아파트', lawdCd: '26230', dong: '범천동' });
    assert.deepEqual(r, { kind: 'NOT_FOUND' }, `${bad}가 통과했다`);
    assert.deepEqual(calls, [], `${bad}로 DB를 조회했다`);
  }
});

test('§9 형태는 맞지만 master가 없으면 NOT_FOUND — 이름 경로로 폴백하지 않는다', async () => {
  const { prisma, calls } = fakePrisma();
  // 이름+법정동으로는 26230-149를 찾을 수 있는 상황이지만, 없는 aptSeq를 물었으니
  // 다른 단지의 점수를 돌려주지 않는다.
  const r = await resolveScoreIdentity(prisma, { aptSeqParam: '26230-99999', aptName: '대원아파트', lawdCd: '26230', dong: '범천동' });
  assert.deepEqual(r, { kind: 'NOT_FOUND' });
  assert.deepEqual(calls, ['findUnique:26230-99999'], '이름 경로로 폴백했다');
});

test('§3 aptSeq 형태 판정', () => {
  assert.ok(isWellFormedAptSeq('26230-1810'));
  assert.ok(isWellFormedAptSeq(' 26230-1810 '), '공백은 다듬어 받는다');
  assert.ok(!isWellFormedAptSeq(''));
  assert.ok(!isWellFormedAptSeq(null));
  assert.ok(!isWellFormedAptSeq(undefined));
  assert.ok(!isWellFormedAptSeq('26230-18a'));
});

// ── 호출부 계약(§3/§7) ─────────────────────────────────────────────────────

const ROOT = resolvePath(__dirname, '../../..');
const CLIENT = readFileSync(resolvePath(ROOT, 'src/app/apt/[name]/apt-client.tsx'), 'utf8');
const ROUTE = readFileSync(resolvePath(ROOT, 'src/app/api/apt/[name]/score/route.ts'), 'utf8');

test('§3 상세는 URL의 aptSeq가 아니라 검증된 canonical aptSeq를 보낸다', () => {
  assert.ok(/query\.set\('aptSeq', scoreAptSeq\)/.test(CLIENT), '점수 요청에 aptSeq가 실리지 않는다');
  // 검증되지 않은 URL 값을 그대로 실어 보내면 안 된다.
  assert.ok(!/query\.set\('aptSeq', incomingAptSeq\)/.test(CLIENT), 'URL 값을 그대로 보낸다');
  assert.ok(/scoreAptSeq\b/.test(CLIENT) && /deriveCanonicalAptSeq/.test(CLIENT));
});

test('§7 identity가 확정되기 전에는 점수를 묻지 않는다', () => {
  assert.ok(/if \(!aptName \|\| scoreIdentityPending\) return;/.test(CLIENT), '확정 전 요청 가드가 없다');
  assert.ok(/const scoreIdentityPending = loading && !scoreAptSeq;/.test(CLIENT));
});

test('§7 한 번 확정된 identity는 탭 전환으로 흔들리지 않는다', () => {
  assert.ok(/if \(canonicalAptSeq && !scoreAptSeq\) setScoreAptSeq\(canonicalAptSeq\);/.test(CLIENT));
});

test('§3 캐시 키가 identity를 포함한다', () => {
  assert.ok(/key: `score\|\$\{aptName\}\|\$\{scoreAptSeq \|\| ''\}/.test(CLIENT), '캐시 키에 aptSeq가 없다');
});

// ── 점수 계산은 손대지 않았다(§8) ───────────────────────────────────────────

test('§8 라우트는 해소된 aptSeq를 그대로 계산 엔진에 넘긴다', () => {
  assert.ok(/const result = await calculateApartmentScore\(resolvedAptSeq\);/.test(ROUTE));
  // 라우트가 끌어오는 모듈 목록 자체를 고정한다 — 점수 산식 모듈이 새로 들어오면 깨진다.
  const imports = [...ROUTE.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, [
    '@/lib/apartment-score/peer-context',
    '@/lib/apartment-score/resolve-score-identity',
    '@/lib/apartment-score/resolve-score-version',
    '@/lib/apartment-score/server/calculate',
    '@/lib/log-server-error',
    '@/lib/prisma',
    'next/server',
  ]);
});

test('§8 라우트는 이름 매칭 함수를 더 이상 직접 쓰지 않는다', () => {
  // 해소 규칙이 두 곳으로 갈라지면 한쪽만 고쳐지는 일이 생긴다.
  assert.ok(!/apt-name-match/.test(ROUTE), '라우트가 여전히 이름 매칭을 직접 한다');
  assert.ok(/resolveScoreIdentity/.test(ROUTE));
});
