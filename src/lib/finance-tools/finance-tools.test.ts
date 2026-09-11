import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loanAmountAtLtv,
  ltvPercent,
  calculateDsr,
  calculateGap,
  pricePerPyeong,
} from './ratios';
import {
  calculateAcquisitionTax,
  baseRatePercent,
  midBandRatePercent,
  ACQUISITION_TAX_RULE_VERSION,
} from './acquisition-tax';
import { REGISTRATION_COST_ITEMS, quoteRequiredItems } from './registration-cost';
import { calculateMonthlyPayment } from '../finance-fit/amortization';

/**
 * REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §24.
 *
 * 결정적인 예시만 쓴다. **지원하지 않는 정책 가정을 테스트에 넣지 않는다** —
 * 그러면 그 가정이 테스트를 통해 사실처럼 굳는다.
 */

const EOK = 100_000_000;

// ── LTV: 산수만, 한도 판정 없음 ─────────────────────────────────────────────

test('LTV: 가정 비율에서 대출액과 필요 자기자금이 나온다', () => {
  const r = loanAmountAtLtv(10 * EOK, 70)!;
  assert.equal(r.loanAmount, 7 * EOK);
  assert.equal(r.requiredOwnFunds, 3 * EOK);
  assert.equal(r.ratioPercent, 70);
});

test('LTV: 대출액에서 비율을 거꾸로 구한다', () => {
  assert.equal(ltvPercent(7 * EOK, 10 * EOK), 70);
  // 집값보다 큰 대출이 들어오면 100을 넘겨 **사실대로** 돌려준다.
  assert.equal(ltvPercent(12 * EOK, 10 * EOK), 120);
});

test('LTV: 말이 안 되는 입력은 null이다(NaN/Infinity를 만들지 않는다)', () => {
  assert.equal(loanAmountAtLtv(0, 70), null);
  assert.equal(loanAmountAtLtv(-1, 70), null);
  assert.equal(loanAmountAtLtv(10 * EOK, -5), null);
  assert.equal(loanAmountAtLtv(10 * EOK, 150), null);
  assert.equal(loanAmountAtLtv(NaN, 70), null);
  assert.equal(ltvPercent(1, 0), null);
  assert.equal(ltvPercent(1, Infinity), null);
});

// ── DSR ─────────────────────────────────────────────────────────────────────

test('DSR: 기존 + 신규 원리금을 연소득으로 나눈다', () => {
  // 연소득 6천만, 기존 연 600만, 신규 월 100만(연 1,200만) → 1,800만/6,000만 = 30%
  const r = calculateDsr(60_000_000, 6_000_000, 1_000_000)!;
  assert.equal(r.newAnnualDebtService, 12_000_000);
  assert.equal(r.totalAnnualDebtService, 18_000_000);
  assert.equal(r.percent, 30);
});

test('DSR: 기존 부채가 없으면 신규분만 반영된다', () => {
  const r = calculateDsr(50_000_000, 0, 1_000_000)!;
  assert.equal(r.totalAnnualDebtService, 12_000_000);
  assert.equal(r.percent, 24);
});

test('DSR: 소득이 없거나 음수면 계산하지 않는다', () => {
  assert.equal(calculateDsr(0, 0, 1_000_000), null);
  assert.equal(calculateDsr(-1, 0, 1_000_000), null);
  assert.equal(calculateDsr(NaN, 0, 1_000_000), null);
  assert.equal(calculateDsr(50_000_000, -1, 1_000_000), null);
});

test('DSR은 승인 여부를 판정하지 않는다 — 비율만 돌려준다', () => {
  // 연소득 3천만 / 신규 월 200만(연 2,400만) → 80%
  const r = calculateDsr(30_000_000, 0, 2_000_000)!;
  // 규제 한도를 한참 넘는 값도 그대로 돌려준다. "불가"라고 말하는 것은 우리 몫이 아니다.
  assert.equal(r.percent, 80);
  assert.equal('approved' in r, false);
  assert.equal('limit' in r, false);
});

test('DSR은 상환 공식을 다시 구현하지 않는다(기존 함수 결과를 받는다)', () => {
  const monthly = calculateMonthlyPayment(3 * EOK, 3.5, 30);
  const r = calculateDsr(60_000_000, 0, monthly)!;
  assert.equal(r.newAnnualDebtService, Math.round(monthly * 12));
});

// ── 월 상환액(기존 구현 재사용 확인) ────────────────────────────────────────

test('월 상환액: 원리금균등 표준 공식', () => {
  // 3억 / 3.5% / 30년 → 약 134.7만원
  const m = calculateMonthlyPayment(3 * EOK, 3.5, 30);
  assert.ok(m > 1_340_000 && m < 1_350_000, `예상 범위를 벗어남: ${m}`);
});

test('월 상환액: 금리 0%면 원금을 개월수로 나눈다', () => {
  assert.equal(calculateMonthlyPayment(1_200_000, 0, 1), 100_000);
});

test('월 상환액: 원금이 0이거나 기간이 0이면 0이다(Infinity 금지)', () => {
  assert.equal(calculateMonthlyPayment(0, 3.5, 30), 0);
  assert.equal(calculateMonthlyPayment(3 * EOK, 3.5, 0), 0);
});

// ── 취득세: 좁고 정확하게 ───────────────────────────────────────────────────

test('취득세: 6억 이하 1주택은 본세 1%', () => {
  assert.equal(baseRatePercent(5 * EOK), 1);
  const c = calculateAcquisitionTax({
    purchasePrice: 5 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: 84.95, isPurchase: true,
  });
  assert.equal(c.kind, 'SUPPORTED');
  if (c.kind !== 'SUPPORTED') return;
  assert.equal(c.result.baseTax, 5_000_000);          // 1%
  assert.equal(c.result.localEducationTax, 500_000);  // 0.1%
  assert.equal(c.result.ruralSpecialTax, 0);          // 85㎡ 이하
  assert.equal(c.result.total, 5_500_000);
});

test('취득세: 9억 초과는 본세 3%', () => {
  assert.equal(baseRatePercent(10 * EOK), 3);
  const c = calculateAcquisitionTax({
    purchasePrice: 10 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: 84, isPurchase: true,
  });
  if (c.kind !== 'SUPPORTED') throw new Error('지원돼야 한다');
  assert.equal(c.result.baseTax, 30_000_000);
  assert.equal(c.result.localEducationTax, 3_000_000); // 3%/2 × 20% = 0.3%
});

test('취득세: 6~9억은 구간 안에서 1%→3%로 이어진다(경계에서 튀지 않는다)', () => {
  assert.equal(midBandRatePercent(6 * EOK), 1);
  assert.equal(midBandRatePercent(9 * EOK), 3);
  const mid = midBandRatePercent(7.5 * EOK);
  assert.ok(mid > 1 && mid < 3, `중간 구간이 1~3% 사이여야 한다: ${mid}`);
  // 단조 증가
  assert.ok(midBandRatePercent(8 * EOK) > midBandRatePercent(7 * EOK));
});

test('취득세: 전용 85㎡ 초과면 농특세 0.2%가 붙는다', () => {
  const over = calculateAcquisitionTax({
    purchasePrice: 5 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: 101.5, isPurchase: true,
  });
  if (over.kind !== 'SUPPORTED') throw new Error('지원돼야 한다');
  assert.equal(over.result.ruralSpecialTax, 1_000_000);
});

test('취득세: 면적을 모르면 농특세를 더하지 않는다(모르는 것을 청구하지 않는다)', () => {
  const c = calculateAcquisitionTax({
    purchasePrice: 5 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: null, isPurchase: true,
  });
  if (c.kind !== 'SUPPORTED') throw new Error('지원돼야 한다');
  assert.equal(c.result.ruralSpecialTax, 0);
});

test('취득세: 2주택 이상은 세율을 지어내지 않고 거절한다', () => {
  for (const n of [2, 3, 5]) {
    const c = calculateAcquisitionTax({
      purchasePrice: 5 * EOK, homeCountAfterPurchase: n, exclusiveAreaM2: 84, isPurchase: true,
    });
    assert.equal(c.kind, 'UNSUPPORTED');
    if (c.kind === 'UNSUPPORTED') assert.equal(c.reason, 'MULTI_HOME');
  }
});

test('취득세: 예전의 고정 3.3% / 8% / 12% 모의값이 되살아나지 않는다', () => {
  // 5억 기준 예전 모의 로직은 1,650만원(3.3%)을 냈다. 실제 1주택 세율로는 550만원이다.
  const c = calculateAcquisitionTax({
    purchasePrice: 5 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: 84, isPurchase: true,
  });
  if (c.kind !== 'SUPPORTED') throw new Error('지원돼야 한다');
  assert.notEqual(c.result.total, 16_500_000);
  assert.equal(c.result.total, 5_500_000);
});

test('취득세: 매매가 아니면 계산하지 않는다', () => {
  const c = calculateAcquisitionTax({
    purchasePrice: 5 * EOK, homeCountAfterPurchase: 1, exclusiveAreaM2: 84, isPurchase: false,
  });
  assert.equal(c.kind, 'UNSUPPORTED');
});

test('취득세: 가액이 없거나 이상하면 계산하지 않는다', () => {
  for (const p of [0, -1, NaN, Infinity]) {
    const c = calculateAcquisitionTax({
      purchasePrice: p, homeCountAfterPurchase: 1, exclusiveAreaM2: 84, isPurchase: true,
    });
    assert.equal(c.kind, 'UNSUPPORTED');
  }
});

test('취득세: 세율표에 기준일이 붙어 있고, 1차 출처 미대조 상태가 표시된다', () => {
  assert.ok(ACQUISITION_TAX_RULE_VERSION.referenceDate);
  assert.ok(ACQUISITION_TAX_RULE_VERSION.source.length > 0);
  // 출시 전 대조가 끝나면 이 값을 true로 바꾸고 UI 안내가 사라진다.
  assert.equal(ACQUISITION_TAX_RULE_VERSION.verifiedAgainstPrimarySource, false);
});

// ── 등기비용: 금액을 만들지 않는다 ──────────────────────────────────────────

test('등기비용: 법무사 보수를 숫자로 만들지 않는다', () => {
  const legal = REGISTRATION_COST_ITEMS.find((i) => i.key === 'legalFee')!;
  assert.equal(legal.nature, 'QUOTE_REQUIRED');
  // 어떤 항목에도 금액 필드가 없다 — 구조적으로 지어낼 수 없다.
  for (const item of REGISTRATION_COST_ITEMS) {
    assert.equal('amount' in item, false, `${item.key}에 금액이 있으면 안 된다`);
  }
});

test('등기비용: 견적이 필요한 항목이 파트너 상담 근거가 된다', () => {
  const q = quoteRequiredItems();
  assert.ok(q.length >= 1);
  assert.ok(q.every((i) => i.nature !== 'CALCULATED_ELSEWHERE'));
});

// ── 갭 / 전세가율 ───────────────────────────────────────────────────────────

test('갭: 매매가 - 전세가', () => {
  const r = calculateGap(5 * EOK, 3 * EOK)!;
  assert.equal(r.gapAmount, 2 * EOK);
  assert.equal(r.jeonseRatioPercent, 60);
});

test('전세가율: 전세가 / 매매가 × 100', () => {
  assert.equal(calculateGap(4 * EOK, 3 * EOK)!.jeonseRatioPercent, 75);
});

test('갭: 전세가가 매매가보다 높으면 음수 갭을 사실대로 돌려준다', () => {
  const r = calculateGap(3 * EOK, 3.2 * EOK)!;
  assert.ok(r.gapAmount < 0);
  assert.ok(r.jeonseRatioPercent > 100);
});

test('갭: 매매가가 없으면 계산하지 않는다', () => {
  assert.equal(calculateGap(0, 3 * EOK), null);
  assert.equal(calculateGap(NaN, 3 * EOK), null);
  assert.equal(calculateGap(5 * EOK, -1), null);
});

// ── 평당가 ──────────────────────────────────────────────────────────────────

test('평당가: 저장소의 기존 환산 상수를 쓴다(두 번째 규칙을 만들지 않는다)', () => {
  const r = pricePerPyeong(5 * EOK, 84.95)!;
  // 84.95㎡ ≈ 25.7평 → 약 1,946만원/평
  assert.ok(r.pyeong > 25.6 && r.pyeong < 25.8, `평 환산: ${r.pyeong}`);
  assert.ok(r.pricePerPyeong > 19_000_000 && r.pricePerPyeong < 20_000_000);
  assert.equal(r.pricePerM2, Math.round(5 * EOK / 84.95));
});

test('평당가: 면적이 0이거나 음수면 계산하지 않는다(0으로 나누기 금지)', () => {
  assert.equal(pricePerPyeong(5 * EOK, 0), null);
  assert.equal(pricePerPyeong(5 * EOK, -1), null);
  assert.equal(pricePerPyeong(0, 84), null);
  assert.equal(pricePerPyeong(5 * EOK, NaN), null);
});

// ── 전역: 어떤 결과에도 NaN/Infinity가 없다 ─────────────────────────────────

test('극단값을 넣어도 NaN/Infinity가 새어 나오지 않는다', () => {
  const extremes = [0, -1, 1, 1e15, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity];
  for (const a of extremes) {
    for (const b of extremes) {
      const results = [
        loanAmountAtLtv(a, b),
        ltvPercent(a, b),
        calculateDsr(a, 0, b),
        calculateGap(a, b),
        pricePerPyeong(a, b),
      ];
      for (const r of results) {
        if (r === null) continue;
        for (const v of Object.values(r)) {
          assert.ok(Number.isFinite(v as number), `NaN/Infinity 누출: ${a}, ${b} → ${v}`);
        }
      }
    }
  }
});
