import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { redactMolitFailureMessage } from './api-molit.ts';

// MOLIT_PARTIAL_TRUST_V2 §17 — 인증키 노출 회귀 테스트.
//
// 실제 키는 절대 쓰지 않는다 — 아래 값은 전부 fixture다.
//
// 이 저장소에서 공공데이터 인증키(serviceKey)가 밖으로 새는 경로는 항상 같은 모양이었다:
// 요청 URL에 키가 들어가고 → fetch/파싱이 실패하면 그 URL이 통째로 에러 메시지에 담기고
// → 그 메시지가 응답 body나 로그로 그대로 나간다. 그래서 방어도 한 곳(공유 마스킹 함수)
// 으로 모으고, 두 층위로 검증한다:
//
//   1. 마스킹 함수 자체의 계약 (아래 첫 블록)
//   2. 키가 들어간 URL을 만드는 파일들이 원본 오류 메시지를 그대로 내보내지 않는다는
//      소스 수준 가드 (아래 두 번째 블록)
//
// 2번이 소스 검사인 이유: 이 경로들은 @/ 별칭 import와 Request/env에 묶여 있어 현재
// 로컬 테스트 러너에서 그대로 실행할 수 없다. 그래도 "다시 원본 메시지를 흘리는 코드가
// 들어오면 실패한다"는 회귀 방어는 결정적으로 남길 수 있다.

const FIXTURE_KEY = 'FixtureServiceKey1234567890abcdefABCDEF';
const FIXTURE_KEY_ENCODED = 'Fixture%2FService%2BKey%3D%3D';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const read = (relative) => readFileSync(join(SRC, relative), 'utf8');

// ── 1. 공유 마스킹 함수 계약 ─────────────────────────────────────────────────

test('로그/응답 포맷터는 키를 지우고 진단 정보는 남긴다', () => {
  const safe = redactMolitFailureMessage(`boom ?serviceKey=${FIXTURE_KEY}&LAWD_CD=26350&DEAL_YMD=202609`);
  assert.ok(!safe.includes(FIXTURE_KEY));
  assert.ok(safe.includes('serviceKey=[redacted]'));
  assert.ok(safe.includes('LAWD_CD=26350'), '진단에 필요한 나머지 정보는 유지한다');
});

test('fetch 실패 형태(절대 URL)의 메시지에서 키가 지워진다', () => {
  const leaked = `request to http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${FIXTURE_KEY}&LAWD_CD=26350 failed`;
  const safe = redactMolitFailureMessage(leaked);
  assert.ok(!safe.includes(FIXTURE_KEY));
  assert.ok(!safe.includes('apis.data.go.kr'), '요청 URL 자체를 남기지 않는다');
});

test('인코딩된 키 조각도 지워진다', () => {
  const safe = redactMolitFailureMessage(`fetch failed: https://apis.data.go.kr/x?serviceKey=${FIXTURE_KEY_ENCODED}&a=1`);
  assert.ok(!safe.includes('Fixture%2FService'));
  assert.ok(!safe.includes('%3D%3D'));
});

test('예외 메시지가 없거나 문자열이 아니어도 포맷터가 깨지지 않는다', () => {
  assert.equal(redactMolitFailureMessage(undefined), '알 수 없는 오류');
  assert.equal(redactMolitFailureMessage(null), '알 수 없는 오류');
  assert.equal(redactMolitFailureMessage({ notAnError: true }), '알 수 없는 오류');
  assert.equal(redactMolitFailureMessage(''), '알 수 없는 오류');
});

// ── 2. 키가 들어간 URL을 만드는 파일들의 소스 수준 가드 ──────────────────────

// serviceKey를 URL에 직접 넣는 파일 목록. 새 파일이 이 목록에 들어와야 한다면, 그
// 파일의 실패 경로도 반드시 아래 두 방식 중 하나를 거치게 만든 뒤 추가한다.
const FILES_BUILDING_KEYED_URLS = [
  'lib/api-molit.ts',
  'lib/molit-month-cache.ts',
  'app/api/ledger/route.ts',
];

test('키가 들어간 URL을 만드는 파일은 모두 공유 마스킹 함수를 쓴다', () => {
  for (const file of FILES_BUILDING_KEYED_URLS) {
    const source = read(file);
    assert.ok(
      source.includes('redactMolitFailureMessage'),
      `${file}이 실패 메시지를 마스킹하지 않는다 — serviceKey가 응답/로그로 샐 수 있다`
    );
  }
});

// apt-building-info.ts는 순수 파서 단위 테스트를 그대로 돌리기 위해 의존성을 두지 않는다.
// 대신 원본 오류 메시지/객체를 아예 쓰지 않는 방식으로 같은 보장을 얻는다.
test('건축물대장 조회는 원본 오류 객체/메시지를 로그에 남기지 않는다', () => {
  const source = read('lib/apt-building-info.ts');
  assert.ok(
    !/console\.(warn|error|log)\([^)]*,\s*e\s*\)/.test(source),
    '원본 error 객체(스택/URL 포함)를 통째로 로그에 남기면 안 된다'
  );
  assert.ok(
    !/console\.(warn|error|log)\([^)]*\(e as Error\)\?\.message/.test(source),
    '원본 오류 메시지를 그대로 로그에 남기면 안 된다'
  );
});

test('ledger 라우트는 원본 오류 메시지를 응답 body로 돌려주지 않는다', () => {
  const source = read('app/api/ledger/route.ts');
  // 예전 회귀: `return NextResponse.json({ error: error.message }, ...)`.
  // 이 라우트의 apiUrl에는 serviceKey가 들어 있어, fetch/파싱 실패 메시지가 그대로
  // 클라이언트까지 전달될 수 있었다.
  assert.ok(
    !/NextResponse\.json\(\s*\{\s*error:\s*error(\?\.)?\.?message/.test(source),
    'error.message를 응답 body에 그대로 실으면 안 된다'
  );
  assert.ok(
    !/console\.(error|warn|log)\([^)]*,\s*error\s*\)/.test(source),
    '원본 error 객체(스택/URL 포함)를 통째로 로그에 남기면 안 된다'
  );
});

test('월 조회 예외 로그는 마스킹된 메시지를 쓴다', () => {
  const source = read('lib/molit-month-cache.ts');
  assert.ok(
    !/console\.warn\([^)]*\$\{\(e as Error\)\?\.message\}/.test(source),
    '원본 예외 메시지를 그대로 로그에 남기면 안 된다(요청 URL이 담길 수 있다)'
  );
  assert.ok(/redactMolitFailureMessage\(\(e as Error\)\?\.message\)/.test(source));
});

test('마스킹 함수 자체가 두 가지 패턴(키 파라미터 + 전체 URL)을 모두 지운다', () => {
  const source = read('lib/api-molit.ts');
  assert.ok(source.includes("replace(/serviceKey=[^&\\s]*/gi"), 'serviceKey 파라미터 마스킹이 사라졌다');
  assert.ok(source.includes('replace(/https?:\\/\\/\\S+/gi'), '전체 URL 마스킹이 사라졌다');
});
