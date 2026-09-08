import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TRADE_DERIVED_SUPPRESSED_MESSAGE } from './trade-read-state.ts';

// MOLIT_PARTIAL_TRUST_V2 §4/§18 — 비교 화면(CompareV2, /stats multi-compare)의 완전성.
//
// compare-v2/metrics.ts는 '../ai-search'를 거쳐 Gemini/Prisma까지 끌고 오는 import 체인이
// 있어 현재 로컬 러너에서 그대로 import할 수 없다. 그래서 selectPriceMetric의 완전성
// 분기 로직만 여기 그대로 복제해 계약을 고정하고(아래 첫 블록), 실제 구현이 그 계약에서
// 벗어나지 않는지는 소스 수준 가드로 지킨다(두 번째 블록).
//
// 복제한 로직이 구현과 어긋나면 두 번째 블록이 실패하도록 구성했다.

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const read = (relative) => readFileSync(join(SRC, relative), 'utf8');

// selectPriceMetric의 완전성 분기(구현과 동일한 규칙)
function priceMetricTrust({ hasUsableTrade, areaMismatch, sourceIncomplete }) {
  if (!hasUsableTrade) {
    return {
      trust: 'MISSING',
      displayValue: sourceIncomplete ? TRADE_DERIVED_SUPPRESSED_MESSAGE : '최근 거래 없음',
    };
  }
  return { trust: (areaMismatch || sourceIncomplete) ? 'LIMITED' : 'SAFE', displayValue: null };
}

test('완전 원본 + 84㎡ 거래 있음 → SAFE (기존 동작 그대로)', () => {
  const m = priceMetricTrust({ hasUsableTrade: true, areaMismatch: false, sourceIncomplete: false });
  assert.equal(m.trust, 'SAFE');
});

test('완전 원본 + 면적 불일치 → LIMITED (기존 동작 그대로)', () => {
  const m = priceMetricTrust({ hasUsableTrade: true, areaMismatch: true, sourceIncomplete: false });
  assert.equal(m.trust, 'LIMITED');
});

test('불완전 원본 + 거래 있음 → LIMITED (값은 유지하되 완전한 비교로 제시하지 않는다)', () => {
  const m = priceMetricTrust({ hasUsableTrade: true, areaMismatch: false, sourceIncomplete: true });
  assert.equal(m.trust, 'LIMITED');
});

test('불완전 원본 + 거래 없음 → "최근 거래 없음"이라고 말하지 않는다', () => {
  const m = priceMetricTrust({ hasUsableTrade: false, areaMismatch: false, sourceIncomplete: true });
  assert.equal(m.trust, 'MISSING');
  assert.notEqual(m.displayValue, '최근 거래 없음', '실패를 무거래로 위장하면 안 된다');
  assert.equal(m.displayValue, TRADE_DERIVED_SUPPRESSED_MESSAGE);
});

test('완전 원본 + 거래 없음 → 검증된 무거래이므로 "최근 거래 없음"이 맞다', () => {
  const m = priceMetricTrust({ hasUsableTrade: false, areaMismatch: false, sourceIncomplete: false });
  assert.equal(m.trust, 'MISSING');
  assert.equal(m.displayValue, '최근 거래 없음', '진짜 0건 표현은 그대로 유지된다');
});

// ── 구현이 위 계약을 실제로 따르는지에 대한 소스 가드 ────────────────────────

test('selectPriceMetric이 sourceIncomplete를 받아 두 분기에 모두 반영한다', () => {
  const source = read('lib/compare-v2/metrics.ts');
  assert.ok(
    /export function selectPriceMetric\(trades: RawTrade\[\], sourceIncomplete = false\)/.test(source),
    'selectPriceMetric이 완전성 인자를 받지 않는다'
  );
  assert.ok(
    source.includes('sourceIncomplete ? TRADE_DERIVED_SUPPRESSED_MESSAGE : \'최근 거래 없음\''),
    '거래 0건 분기에서 불완전 원본을 무거래로 위장하고 있다'
  );
  assert.ok(
    source.includes("trust: (areaMismatch || sourceIncomplete) ? 'LIMITED' : 'SAFE'"),
    '불완전 원본이 trust에 반영되지 않는다'
  );
});

test('비교 fetch 계층이 공유 완전성 계약으로 불완전 여부를 계산해 넘긴다', () => {
  const source = read('lib/compare-v2/fetch.ts');
  assert.ok(source.includes('resolveTradeReadState'), '공유 완전성 계약을 쓰지 않는다');
  assert.ok(
    source.includes('selectPriceMetric(trades as any, tradesIncomplete)'),
    '불완전 여부가 가격 지표로 전달되지 않는다'
  );
});

test('difference 엔진이 한쪽만 불완전한 비교에 주의 문구를 붙인다', () => {
  const source = read('lib/compare-v2/difference.ts');
  assert.ok(source.includes('incompleteSourceCaution'), '불완전 원본 경고 함수가 없다');
  // 세 조합(양쪽/첫번째/두번째)이 모두 구분되어야 어느 쪽이 불완전한지 말할 수 있다.
  assert.ok(source.includes('a.sourceIncomplete && b.sourceIncomplete'));
  assert.ok(/if \(a\.sourceIncomplete\)/.test(source));
  assert.ok(/if \(b\.sourceIncomplete\)/.test(source));
  assert.ok(
    source.includes('[incompleteCaution, recencyCaution]'),
    '기존 거래일 차이 경고를 덮어쓰지 않고 함께 보여야 한다'
  );
});

// MOLIT_PARTIAL_TRUST_V2.1 §5 — Production 실측에서 발견한 회귀.
// 면적 불일치 등으로 비교가 이미 접힌 분기에서도 각 단지의 값은 화면에 그대로 뜨는데,
// 그 분기들이 caution: null을 반환해 불완전 사실이 통째로 사라졌다.
test('비교가 접힌 분기에서도 불완전 경고가 사라지지 않는다', () => {
  const source = read('lib/compare-v2/difference.ts');

  // buildDifference의 모든 return에 caution이 실려야 한다 — caution: null이 남아 있으면
  // 그 분기에서 불완전 사실이 유실된다.
  const body = source.slice(source.indexOf('export function buildDifference'));
  const nullCautions = body.match(/caution: null/g) || [];
  assert.equal(
    nullCautions.length,
    0,
    `buildDifference에 caution: null 반환 분기가 ${nullCautions.length}개 남아 있다 — 불완전 경고가 유실된다`
  );

  // 조기 반환 분기 4개(데이터 없음 / 양쪽 null / 한쪽 null / 면적 불일치)가 모두
  // incompleteCaution을 싣는지 확인한다.
  const carried = body.match(/caution: incompleteCaution/g) || [];
  assert.ok(
    carried.length >= 4,
    `조기 반환 분기 중 ${4 - carried.length}개가 불완전 경고를 싣지 않는다`
  );

  // 계산은 반드시 첫 분기보다 먼저 이뤄져야 한다.
  const declIdx = body.indexOf('const incompleteCaution = incompleteSourceCaution(a, b)');
  const firstReturnIdx = body.indexOf('return {');
  assert.ok(declIdx > -1 && declIdx < firstReturnIdx, '불완전 경고를 첫 반환 이전에 계산해야 한다');
});

test('InvestmentMetrics는 자체 안내 배너를 두지 않는다(상세 페이지 경고 중복 방지)', () => {
  const source = read('components/InvestmentMetrics.tsx');
  // 실측: 배너를 두면 상세 페이지에 같은 문장이 3번(차트/여기/타임라인) 쌓였다.
  assert.ok(
    !source.includes('TRADE_PARTIAL_MESSAGE'),
    'InvestmentMetrics가 페이지 수준 안내 문구를 다시 렌더링하면 경고가 중복된다'
  );
  assert.ok(
    !source.includes('TRADE_API_UNAVAILABLE_MESSAGE'),
    'InvestmentMetrics가 페이지 수준 실패 문구를 다시 렌더링하면 경고가 중복된다'
  );
  // 대신 카드 자체가 이유를 말해야 한다.
  assert.ok(source.includes('TRADE_DERIVED_SUPPRESSED_MESSAGE'), '억제 카드 문구가 사라지면 안 된다');
  assert.ok(source.includes('일부 기간 미반영'), '관측값 단서가 사라지면 안 된다');
});

test('multi-compare 차트가 계열별 불완전 여부를 추적하고 표시한다', () => {
  const source = read('app/stats/[type]/type-client.tsx');
  assert.ok(source.includes('incompleteNames'), '계열별 불완전 상태를 추적하지 않는다');
  assert.ok(source.includes('resolveTradeReadState'), '공유 완전성 계약을 쓰지 않는다');
  assert.ok(source.includes('compareIncompleteNotice'), '불완전 안내 배너가 없다');
  assert.ok(source.includes('일부 기간 미반영'), '범례에 불완전 계열 표시가 없다');
});

test('InvestmentMetrics가 결합 계산값을 억제하고 관측값만 단서와 함께 남긴다', () => {
  const source = read('components/InvestmentMetrics.tsx');
  assert.ok(source.includes('resolveDerivedMetricTrust'), '결합 계산값 신뢰 판정을 쓰지 않는다');
  assert.ok(source.includes('resolveObservedMetricTrust'), '관측값 신뢰 판정을 쓰지 않는다');
  assert.ok(
    source.includes("combinedTrust === 'SUPPRESSED'"),
    '전세가율/갭이 불완전 원본에서도 계산되어 노출된다'
  );
  assert.ok(
    !/return data\.trades \|\| \[\]/.test(source),
    'fetch 실패를 빈 배열로 뭉개면 "데이터 부족"과 구분되지 않는다'
  );
});

test('large-complex 라우트가 실패한 달을 무거래로 접지 않는다', () => {
  const source = read('app/api/stats/large-complex/route.ts');
  assert.ok(source.includes('failedDistricts'), '부분 실패를 응답에 싣지 않는다');
  assert.ok(source.includes('results[m]?.failed'), '월별 실패 상태를 버리고 있다');
  assert.ok(/partial: failedDistricts\.length > 0/.test(source));
});

test('ai-search 비교는 불완전한 0건으로 이름만 재조회하지 않는다(identity 보호)', () => {
  const source = read('lib/ai-search.ts');
  assert.ok(
    source.includes('b.tradeCount === 0 && !b.tradesIncomplete && a.resolvedLawdCd'),
    '조회 실패로 인한 0건이 지역 제약 해제 + 이름 재검색을 유발한다'
  );
});
