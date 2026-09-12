import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isWellFormedAptSeq } from '../apartment-score/resolve-score-identity';

/**
 * SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 §13 — 점수 identity **전달** 계약.
 *
 * 해소 규칙 자체는 resolve-score-identity.test.ts가 이미 고정한다(aptSeq 우선, 미스 시
 * 이름 폴백 금지, 후보 둘이면 AMBIGUOUS). 이 파일이 고정하는 것은 그 앞단이다:
 * **이미 canonical aptSeq를 아는 화면이 그걸 실제로 점수 요청에 싣는가.**
 *
 * 고친 문제: 비교 화면은 공유 링크의 aptSeq로 단지를 확정해 보여주면서도, 점수만
 * (lawdCd + dong + 이름)으로 다시 물었다. 그래서 정규화 이름이 겹치는 단지에서는
 * 화면의 단지와 점수의 단지가 갈라질 수 있었다.
 *
 * Production 실측(읽기 전용): ApartmentMaster 3,438건 중 같은 구 안에서 정규화 이름이
 * 겹치는 그룹이 54개, 그중 4개는 **구·법정동·이름이 모두 같아** 이름으로는 영원히
 * 확정할 수 없다(예: 26230 양정동 `수목하우스` 2건). 그 단지들에서는 aptSeq만이 답이다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const COMPARE_FETCH = read('src/lib/compare-v2/fetch.ts');
const DETAIL = read('src/app/apt/[name]/apt-client.tsx');
const REPORT = read('src/lib/report/apt-read.ts');
const SEEDS = read('src/lib/compare-v2/resolve-seeds.ts');
const RESOLVER = read('src/lib/apartment-score/resolve-score-identity.ts');

// ── A. 세 화면이 같은 identity로 점수를 묻는다(§4/§9) ──────────────────────

test('§4 비교 화면이 canonical aptSeq를 점수 요청에 싣는다', () => {
  const code = codeOf(COMPARE_FETCH);
  assert.ok(
    /incomingAptSeq && isWellFormedAptSeq\(incomingAptSeq\)\s*\?\s*\{ aptSeq: incomingAptSeq \}/.test(
      code.replace(/\s+/g, ' ').replace(/ \? /g, ' ? ')
    ) || /\{ aptSeq: incomingAptSeq \}/.test(code),
    '비교 화면이 점수를 이름으로만 묻는다'
  );
  // 예전 형태(점수를 lawdCd+dong으로만 묻기)가 무조건 경로로 남아 있지 않다.
  assert.ok(
    !/const scoreParams = new URLSearchParams\(\{ lawdCd, dong \}\);/.test(code),
    '점수 파라미터가 여전히 지역+이름 전용이다'
  );
});

test('§9 상세 화면은 이미 aptSeq로 묻는다(회귀 방지)', () => {
  const code = codeOf(DETAIL);
  assert.ok(/query\.set\('aptSeq', scoreAptSeq\)/.test(code), '상세가 aptSeq를 싣지 않는다');
  // aptSeq가 있으면 지역 파라미터로 좁히지 않는다(identity 하나면 충분하다).
  // fetchCachedResource는 import 줄에도 나오므로 if 위치 **이후**에서 찾는다.
  const at = code.indexOf('if (scoreAptSeq) {');
  assert.ok(at > -1, 'aptSeq 분기를 찾지 못했다');
  const block = code.slice(at, code.indexOf('fetchCachedResource(', at));
  assert.ok(/else \{/.test(block), 'aptSeq가 있을 때와 없을 때가 갈리지 않는다');
  assert.ok(/query\.set\('lawdCd'/.test(block), 'aptSeq가 없을 때의 지역 경로가 사라졌다');
});

test('§9 리포트는 이름 해소 단계 자체가 없다(회귀 방지)', () => {
  const code = codeOf(REPORT);
  assert.ok(/export async function readScore\(aptSeq: string\)/.test(code), '리포트가 aptSeq로 시작하지 않는다');
  assert.ok(/calculateApartmentScore\(aptSeq\)/.test(code), '리포트가 aptSeq로 점수를 계산하지 않는다');
  // 이름으로 단지를 찾는 경로가 섞이지 않았다.
  assert.ok(!/normalizeAptName|aptNamesMatch/.test(code), '리포트에 이름 매칭이 섞였다');
});

// ── B. 비교의 aptSeq를 신뢰할 수 있는 근거(§3) ─────────────────────────────

test('§3 비교의 seed aptSeq는 ApartmentMaster unique 조회로 확정된 값이다', () => {
  const code = codeOf(SEEDS);
  assert.ok(/findUnique\(\{\s*where: \{ aptSeq \}/.test(code.replace(/\s+/g, ' ')), 'unique 조회가 아니다');
  // 형태 가드를 점수 해소기와 공유한다(같은 규칙을 두 번 적지 않는다).
  assert.ok(/isWellFormedAptSeq/.test(code), '형태 가드를 재사용하지 않는다');
  // 이름/구/동은 그 aptSeq의 master 행에서 나온다 — 점수와 거래가 같은 행을 가리킨다.
  assert.ok(/select: \{ aptSeq: true, name: true, sggCd: true, umdName: true \}/.test(code));
  // 해소되지 않으면 비슷한 단지로 대체하지 않는다.
  assert.ok(/unresolved\.push\(aptSeq\)/.test(code), '해소 실패를 정직하게 보고하지 않는다');
});

test('§10 비교는 해소 실패를 다른 단지로 메우지 않는다', () => {
  const code = codeOf(SEEDS);
  for (const bad of ['findFirst', 'contains', 'startsWith', 'orderBy']) {
    assert.ok(!code.includes(bad), `느슨한 해소 수단이 있다: ${bad}`);
  }
});

// ── C. 형태 가드(§6/§11) ───────────────────────────────────────────────────

test('§11 형태가 aptSeq가 아니면 이름 경로로 흘리지 않는다', () => {
  // Production 실측: aptSeq 3,438건 전부 `{5자리}-{일련번호}` 형태, 위반 0건.
  assert.ok(isWellFormedAptSeq('26230-149'));
  assert.ok(isWellFormedAptSeq('26230-1810'));
  assert.ok(!isWellFormedAptSeq('26230'), '구 코드만으로는 aptSeq가 아니다');
  assert.ok(!isWellFormedAptSeq('대원아파트'), '이름은 aptSeq가 아니다');
  assert.ok(!isWellFormedAptSeq(''));
  assert.ok(!isWellFormedAptSeq(null));
  assert.ok(!isWellFormedAptSeq(undefined));
  assert.ok(!isWellFormedAptSeq('2623-149'), '구 코드가 5자리가 아니다');
});

test('§4 잘못된 형태의 aptSeq는 점수 요청에 실리지 않는다 — 지역 경로로 내려간다', () => {
  const code = codeOf(COMPARE_FETCH).replace(/\s+/g, ' ');
  // 형태 검사를 통과해야만 aptSeq를 싣는다.
  assert.ok(/isWellFormedAptSeq\(incomingAptSeq\)/.test(code), '형태 검사 없이 aptSeq를 싣는다');
  // 통과하지 못하면 기존 지역 경로(legacy strong fields)를 그대로 쓴다.
  assert.ok(/\{ lawdCd, dong \}/.test(code), 'legacy 경로가 사라졌다');
});

// ── D. 해소기 계약 재확인(§3/§10) ──────────────────────────────────────────

test('§3 aptSeq 미스는 이름 경로로 폴백하지 않는다(회귀 방지)', () => {
  const code = codeOf(RESOLVER);
  const block = code.slice(code.indexOf('if (fromParam)'), code.indexOf('if (!input.lawdCd)'));
  // 미스면 즉시 NOT_FOUND — 이름 후보를 찾아보지 않는다.
  assert.ok(/if \(!master\?\.aptSeq\) return \{ kind: 'NOT_FOUND' \};/.test(block), 'aptSeq 미스가 폴백한다');
  assert.ok(!/findMany/.test(block), 'aptSeq 경로에서 이름 후보를 조회한다');
});

test('§6/§10 후보가 둘 이상이면 첫 번째를 고르지 않는다(회귀 방지)', () => {
  const code = codeOf(RESOLVER);
  assert.ok(/if \(matched\.length > 1\) return \{ kind: 'AMBIGUOUS' \};/.test(code), 'AMBIGUOUS 처리가 없다');
  // 첫 행을 고르는 수단이 없다.
  assert.ok(!/findFirst|orderBy|\[0\]!/.test(code), '첫 후보를 고르는 경로가 있다');
  // 단일 확정일 때만 matched[0]을 쓴다(길이 검사 뒤).
  const at = code.indexOf('matched[0].aptSeq');
  assert.ok(at > code.indexOf("matched.length > 1"), '길이 검사 전에 첫 후보를 쓴다');
});

test('§8 이 STEP은 점수 값을 건드리지 않았다 — identity만 다룬다', () => {
  const code = codeOf(RESOLVER);
  // 해소기는 점수 계산 엔진에 의존하지 않는다(가중치·임계값·백분위를 모른다).
  assert.ok(!/apartment-score\/server|calculateApartmentScore|peer-context/.test(code),
    '해소기가 점수 계산 모듈에 의존한다');
  // 내보내는 것은 identity 판정뿐이다.
  const exports = code.match(/export (?:async )?function (\w+)/g) ?? [];
  assert.deepEqual(
    exports.sort(),
    ['export function isWellFormedAptSeq', 'export async function resolveScoreIdentity'].sort(),
    `해소기가 identity 외의 것을 내보낸다: ${exports.join(', ')}`
  );
  // 비교 화면 변경도 파라미터 조립뿐이다 — 계산 엔진을 끌어오지 않았다.
  const cmp = codeOf(COMPARE_FETCH);
  assert.ok(!/apartment-score\/server|calculateApartmentScore/.test(cmp),
    '비교 fetch가 점수 계산 모듈을 끌어온다');
});

// ── E. 성능(§12) ───────────────────────────────────────────────────────────

test('§12 aptSeq 경로는 조회 한 번이다 — 이름 스캔보다 느려지지 않는다', () => {
  const code = codeOf(RESOLVER);
  const block = code.slice(code.indexOf('if (fromParam)'), code.indexOf('if (!input.lawdCd)'));
  // unique 키 단건 조회(인덱스 적중). 후보 스캔이 없다.
  assert.ok(/findUnique/.test(block), 'unique 조회가 아니다');
  assert.equal((block.match(/await prisma/g) ?? []).length, 1, 'aptSeq 경로에 조회가 여러 번이다');
});

test('§12 비교는 요청 수가 늘지 않았다 — 단지당 2회 그대로', () => {
  const code = codeOf(COMPARE_FETCH);
  const fetches = (code.match(/fetch\(`\/api\//g) ?? []).length;
  assert.equal(fetches, 2, `단지당 API 호출이 ${fetches}회다(2회여야 한다)`);
  // 두 요청이 서로를 기다리지 않는다(직렬화하지 않았다).
  assert.ok(/Promise\.allSettled\(\[/.test(code), '두 요청이 병렬이 아니다');
});
