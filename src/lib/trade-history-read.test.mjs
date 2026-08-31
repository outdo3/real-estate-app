import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTradeQuery, TradeQueryValidationError, MAX_TRADE_QUERY_LIMIT } from './trade-history-read.ts';

// §20 — 이 read core는 사용자 요청 경로에서 MOLIT을 직접 호출해서는 안 된다. 런타임
// mock보다 정적 소스 감사가 더 확실하다(우회 불가능한 import 자체를 검사).
test('NO_MOLIT_FALLBACK: trade-history-read.ts는 MOLIT/공공데이터 fetch 헬퍼를 import하지 않는다', () => {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'trade-history-read.ts');
  const source = fs.readFileSync(filePath, 'utf-8');
  // 주석 속 설명(예: "molit-stats-helpers를 import하지 않는다")까지 걸리면 오탐이므로,
  // 실제 import 구문만 검사한다 — 우회 불가능한 유일한 신뢰 지점.
  const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
  const forbidden = ['molit-stats-helpers', 'api-molit', 'fetchMolitData'];
  for (const line of importLines) {
    for (const token of forbidden) {
      assert.ok(!line.includes(token), `import line must not reference "${token}": ${line}`);
    }
  }
  assert.ok(!source.includes('fetch('), 'trade-history-read.ts must not call fetch() directly');
});

// A. 단일 aptSeq
test('A: aptSeq 단일 값이 where.aptSeq에 그대로 들어간다(canonical identity 우선)', () => {
  const built = buildTradeQuery({ aptSeq: '26350-2' });
  assert.equal(built.where.aptSeq, '26350-2');
  assert.equal(built.where.dealCanceled, false);
});

// B. 취소 거래 기본 제외
test('B: includeCanceled를 주지 않으면 dealCanceled=false가 기본 적용된다', () => {
  const built = buildTradeQuery({ lawdCd: '26350' });
  assert.equal(built.where.dealCanceled, false);
  assert.equal(built.includeCanceled, false);
});

test('B-2: includeCanceled:true를 명시하면 dealCanceled 필터 자체가 빠진다(opt-in만 허용)', () => {
  const built = buildTradeQuery({ lawdCd: '26350', includeCanceled: true });
  assert.equal(built.where.dealCanceled, undefined);
  assert.equal(built.includeCanceled, true);
});

// C. 기간
test('C: from/to가 dealDate.gte/lte로 매핑되고 둘 다 inclusive다', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-08-31T00:00:00.000Z');
  const built = buildTradeQuery({ lawdCd: '26350', from, to });
  assert.equal(built.where.dealDate.gte, from);
  assert.equal(built.where.dealDate.lte, to);
  assert.deepEqual(built.requestedRange, { from: '2026-01-01', to: '2026-08-31' });
});

// D. area
test('D: exclusiveArea 정확 일치는 문자열로 변환된다(Decimal float 직렬화 회피, §QA-FIX)', () => {
  const built = buildTradeQuery({ lawdCd: '26350', exclusiveArea: 84.8773 });
  assert.equal(built.where.exclusiveArea, '84.8773');
  assert.equal(typeof built.where.exclusiveArea, 'string');
});

test('D-2: exclusiveAreaRange는 숫자 그대로 gte/lt 범위로 들어간다(84㎡대)', () => {
  const built = buildTradeQuery({ lawdCd: '26350', exclusiveAreaRange: { gte: 84, lt: 85 } });
  assert.deepEqual(built.where.exclusiveArea, { gte: 84, lt: 85 });
});

test('D-3: exclusiveArea와 exclusiveAreaRange를 동시에 주면 검증 에러', () => {
  assert.throws(
    () => buildTradeQuery({ lawdCd: '26350', exclusiveArea: 84.8773, exclusiveAreaRange: { gte: 84, lt: 85 } }),
    TradeQueryValidationError
  );
});

// E. region
test('E: lawdCd 배열은 where.lawdCd.in으로 batch 조건이 된다(부산 16개 구 IN 쿼리 패턴)', () => {
  const built = buildTradeQuery({ lawdCd: ['26110', '26140', '26350'] });
  assert.deepEqual(built.where.lawdCd, { in: ['26110', '26140', '26350'] });
});

test('E-2: aptSeq 배열도 where.aptSeq.in으로 batch 조건이 된다(N+1 방지, §22)', () => {
  const built = buildTradeQuery({ aptSeq: ['26350-2', '26140-1164'] });
  assert.deepEqual(built.where.aptSeq, { in: ['26350-2', '26140-1164'] });
});

// F. empty/no-fallback — scoping 조건 없는 쿼리는 애초에 구성 자체가 거부된다
test('F: aptSeq/identity/lawdCd 중 아무것도 없으면 검증 에러(전체 테이블 스캔 방지, §18)', () => {
  assert.throws(() => buildTradeQuery({}), TradeQueryValidationError);
});

test('F-2: identity(name+dong fallback)만으로도 유효한 쿼리가 만들어진다', () => {
  const built = buildTradeQuery({ identity: { aptSeq: null, name: '경동', dong: '우동' } });
  assert.equal(built.where.identityKey, 'nd:경동|우동');
});

test('F-3: aptSeq와 identity를 동시에 주면 aptSeq가 우선하고 identityKey는 걸리지 않는다', () => {
  const built = buildTradeQuery({ aptSeq: '26350-2', identity: { aptSeq: null, name: '경동', dong: '우동' } });
  assert.equal(built.where.aptSeq, '26350-2');
  assert.equal(built.where.identityKey, undefined);
});

// G. deterministic ordering
test('G: 기본 정렬은 dealDate desc + id desc(동일 날짜 tie-break)이다', () => {
  const built = buildTradeQuery({ lawdCd: '26350' });
  assert.deepEqual(built.orderBy, [{ dealDate: 'desc' }, { id: 'desc' }]);
});

test('G-2: orderDirection=asc를 주면 두 정렬 키 모두 asc로 바뀐다(방향 일관성)', () => {
  const built = buildTradeQuery({ lawdCd: '26350', orderDirection: 'asc' });
  assert.deepEqual(built.orderBy, [{ dealDate: 'asc' }, { id: 'asc' }]);
});

// H. bounded limit
test('H: limit을 주면 MAX_TRADE_QUERY_LIMIT으로 clamp된다', () => {
  const built = buildTradeQuery({ lawdCd: '26350', limit: 999999 });
  assert.equal(built.take, MAX_TRADE_QUERY_LIMIT);
});

test('H-2: limit을 주지 않으면 take가 없다(aggregation용 무제한 반환, §18)', () => {
  const built = buildTradeQuery({ lawdCd: '26350' });
  assert.equal(built.take, undefined);
});

test('H-3: limit이 0 이하이거나 유한하지 않으면 검증 에러', () => {
  assert.throws(() => buildTradeQuery({ lawdCd: '26350', limit: 0 }), TradeQueryValidationError);
  assert.throws(() => buildTradeQuery({ lawdCd: '26350', limit: -5 }), TradeQueryValidationError);
  assert.throws(() => buildTradeQuery({ lawdCd: '26350', limit: NaN }), TradeQueryValidationError);
});

test('H-4: dealType은 항상 sale로 고정된다(V1 범위 그대로, jeonse/wolse 섞이지 않음)', () => {
  const built = buildTradeQuery({ lawdCd: '26350' });
  assert.equal(built.where.dealType, 'sale');
});
