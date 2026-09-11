/**
 * REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §9 — 주택 취득세(유상거래) 계산.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 파일이 대체하는 것
 * ══════════════════════════════════════════════════════════════════════════
 * 기존 `/tools` 페이지에는 이런 코드가 있었다:
 *
 *     // 계산 로직 (간단한 모의 로직)
 *     const taxRate = houseCount === '1주택' ? 0.033 : (houseCount === '2주택' ? 0.08 : 0.12);
 *
 * 작성자가 주석으로 **"모의 로직"이라고 직접 적어둔** 값이 화면에서는 "예상 취득세"로
 * 표시되고 있었다. 주택 취득세는 가액 구간별 누진이라 단일 3.3%는 대부분의 가격대에서
 * 틀린다(6억 이하는 과대, 9억 초과는 과소). 사용자가 그 숫자로 자금 계획을 세우면
 * 실제로 손해를 본다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 계산기가 지원하는 범위 — **좁게, 대신 정확하게**
 * ══════════════════════════════════════════════════════════════════════════
 * 지원:  개인 / 주택 / 유상거래(매매) / **1주택 취득** / 조정대상지역 아님
 *
 * 지원하지 않음(계산하지 않고 `UNSUPPORTED`를 돌려준다):
 *   - 2주택 이상 취득(중과세율은 조정대상지역 지정 여부에 따라 달라지고, 그 지정은
 *     수시로 바뀐다 — 지금 값을 박아두면 조용히 틀린 답이 된다)
 *   - 생애최초 감면(소득·가액 요건이 있고 개인 상황에 달렸다)
 *   - 증여 / 상속 / 신축 / 분양권 / 오피스텔·비주택
 *   - 법인 취득
 *
 * "좁고 정확한 계산기"가 "넓고 틀린 계산기"보다 낫다. 지원하지 않는 경우에는
 * 숫자를 만들어내지 않고 세무 상담이 필요하다고 말한다.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠ 운영자 확인 필요
 * ══════════════════════════════════════════════════════════════════════════
 * 아래 구간·세율은 지방세법 주택 유상거래 기준을 옮긴 것이며, 저장소 안에
 * 대조할 수 있는 1차 출처가 없다. **출시 전 현행 법령과 한 번 대조해야 한다.**
 * 그래서 이 도구는 LIMITED로 분류하고 화면에도 기준일을 노출한다.
 * 법령이 바뀌면 아래 상수만 갈아끼우면 된다(계산 로직과 분리해 둔 이유).
 */

/** 세율표의 출처와 기준일. 화면에 그대로 노출한다. */
export const ACQUISITION_TAX_RULE_VERSION = {
  source: '지방세법 주택 유상거래 취득세율(1주택·조정대상지역 외 기준)',
  referenceDate: '2026-09-11',
  /** 저장소 내 1차 출처 대조가 아직 안 됐다는 표시 — UI가 이 값을 보고 안내를 띄운다. */
  verifiedAgainstPrimarySource: false,
} as const;

const SIX_EOK = 600_000_000;
const NINE_EOK = 900_000_000;

/** 농어촌특별세 부과 기준 — 전용면적 85㎡ 초과. */
export const NONGTEUK_AREA_THRESHOLD_M2 = 85;
const NONGTEUK_RATE = 0.002;

export type AcquisitionTaxCase =
  | { kind: 'SUPPORTED'; result: AcquisitionTaxResult }
  | { kind: 'UNSUPPORTED'; reason: UnsupportedReason };

export type UnsupportedReason =
  | 'MULTI_HOME'
  | 'NOT_PURCHASE'
  | 'INVALID_PRICE';

export interface AcquisitionTaxResult {
  /** 취득세 본세율(%). 6~9억 구간은 가액에 따라 달라진다. */
  baseRatePercent: number;
  /** 취득세 본세(원). */
  baseTax: number;
  /** 지방교육세(원). */
  localEducationTax: number;
  /** 농어촌특별세(원). 85㎡ 이하면 0. */
  ruralSpecialTax: number;
  /** 세 가지 합계(원). */
  total: number;
}

export interface AcquisitionTaxInput {
  /** 취득가액(원). */
  purchasePrice: number;
  /** 취득 후 보유하게 되는 주택 수. 1만 지원한다. */
  homeCountAfterPurchase: number;
  /** 전용면적(㎡). 농특세 판정에만 쓴다. 모르면 null — 그때는 농특세를 0으로 두고 UI가 그 사실을 알린다. */
  exclusiveAreaM2: number | null;
  /** 유상거래(매매)인가. false면 지원하지 않는다. */
  isPurchase: boolean;
}

/**
 * 6억 초과 ~ 9억 이하 구간의 본세율(%).
 *
 * 이 구간은 고정 세율이 아니라 가액에 따라 1%에서 3%로 이어지는 선형 구간이다.
 * 그래서 6억 바로 위에서 세금이 껑충 뛰지 않는다.
 */
export function midBandRatePercent(purchasePrice: number): number {
  const eok = purchasePrice / 100_000_000;
  const raw = (eok * (2 / 3) - 3);
  // 법령이 소수점 다섯째 자리에서 반올림하도록 정하고 있다.
  return Math.round(raw * 100) / 100;
}

/** 가액 구간별 취득세 본세율(%). 1주택·유상거래 기준. */
export function baseRatePercent(purchasePrice: number): number {
  if (purchasePrice <= SIX_EOK) return 1;
  if (purchasePrice <= NINE_EOK) return midBandRatePercent(purchasePrice);
  return 3;
}

export function calculateAcquisitionTax(input: AcquisitionTaxInput): AcquisitionTaxCase {
  const { purchasePrice, homeCountAfterPurchase, exclusiveAreaM2, isPurchase } = input;

  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
    return { kind: 'UNSUPPORTED', reason: 'INVALID_PRICE' };
  }
  if (!isPurchase) {
    return { kind: 'UNSUPPORTED', reason: 'NOT_PURCHASE' };
  }
  if (!Number.isFinite(homeCountAfterPurchase) || homeCountAfterPurchase !== 1) {
    // 중과세율을 지어내지 않는다.
    return { kind: 'UNSUPPORTED', reason: 'MULTI_HOME' };
  }

  const rate = baseRatePercent(purchasePrice);
  const baseTax = Math.round(purchasePrice * (rate / 100));

  // 지방교육세는 취득세 본세율의 1/2에 20%를 적용한다 → 1% 구간이면 0.1%.
  const localEducationTax = Math.round(purchasePrice * ((rate / 2) / 100) * 0.2);

  // 농특세는 전용 85㎡ 초과일 때만. 면적을 모르면 **더하지 않는다**(모르는 것을
  // 있는 것처럼 청구하지 않는다 — UI가 "면적 미입력" 사실을 함께 보여준다).
  const ruralSpecialTax =
    exclusiveAreaM2 != null && Number.isFinite(exclusiveAreaM2) && exclusiveAreaM2 > NONGTEUK_AREA_THRESHOLD_M2
      ? Math.round(purchasePrice * NONGTEUK_RATE)
      : 0;

  return {
    kind: 'SUPPORTED',
    result: {
      baseRatePercent: rate,
      baseTax,
      localEducationTax,
      ruralSpecialTax,
      total: baseTax + localEducationTax + ruralSpecialTax,
    },
  };
}

export const UNSUPPORTED_MESSAGE: Record<UnsupportedReason, string> = {
  MULTI_HOME:
    '2주택 이상 취득은 조정대상지역 지정 여부에 따라 세율이 달라져 이 계산기에서 다루지 않습니다. 세무 상담이 필요합니다.',
  NOT_PURCHASE: '매매(유상거래) 외 취득(증여·상속·신축 등)은 이 계산기에서 다루지 않습니다.',
  INVALID_PRICE: '취득가액을 입력해 주세요.',
};
