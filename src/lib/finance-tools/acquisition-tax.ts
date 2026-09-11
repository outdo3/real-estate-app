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
 * 1차 출처 대조 완료 (ACQUISITION_TAX_PRIMARY_SOURCE_VERIFICATION_V1)
 * ══════════════════════════════════════════════════════════════════════════
 * 2026-09-11에 법제처 운영 사이트(국가법령정보센터 law.go.kr / 찾기쉬운 생활법령정보
 * easylaw.go.kr)와 대조했다. 아래 세 산식이 **전부 법령과 일치**함을 확인했고,
 * 구현을 고칠 부분은 없었다.
 *
 *   취득세     지방세법 제11조제1항제8호
 *              6억 이하 1천분의 10 / 6~9억 (가액 × 2/3억원 − 3) × 1/100 / 9억 초과 1천분의 30
 *              반올림: 소수점 다섯째자리에서 반올림 → 넷째자리까지(세율을 분수로 볼 때)
 *
 *   지방교육세 지방세법 제151조
 *              **주택 유상거래(제11조제1항제8호)는 별도 단서**가 적용된다 —
 *              일반 부동산의 "(세율 − 1천분의 20) × 20/100"이 아니라
 *              "해당 세율 × 100분의 50"을 적용해 산출한 금액의 100분의 20이다.
 *              (일반 산식을 쓰면 1% 구간에서 음수가 나온다 — 실제로 다른 산식이다.)
 *
 *   농어촌특별세 농어촌특별세법 제5조
 *              과세표준 = 표준세율을 100분의 2로 적용해 산출한 취득세액, 세율 100분의 10
 *              → 결과적으로 취득가액의 0.2%. **취득세액의 10%가 아니다**(실제 세율이
 *              1%든 3%든 과세표준은 2% 기준으로 고정된다).
 *              비과세: 전용면적 85㎡ 이하 서민주택
 *
 * 법령이 바뀌면 아래 상수만 갈아끼우면 된다(계산 로직과 분리해 둔 이유).
 */

/** 세율표의 출처와 기준일. 화면에 그대로 노출한다. */
export const ACQUISITION_TAX_RULE_VERSION = {
  source: '지방세법 제11조·제151조, 농어촌특별세법 제5조 (주택 유상거래·1주택 기준)',
  referenceDate: '2026-09-11',
  /**
   * 1차 출처 대조 완료. 근거는 아래 PRIMARY_SOURCES와 이 파일 상단 주석에 있다.
   * 법령 개정으로 산식이 바뀌면 **다시 false로 내리고** 대조부터 한다.
   */
  verifiedAgainstPrimarySource: true,
} as const;

/** 대조에 사용한 출처. 다음 검증자가 같은 곳을 볼 수 있도록 남긴다. */
export const PRIMARY_SOURCES = [
  { law: '지방세법 제11조(부동산 취득의 세율)', url: 'https://www.law.go.kr/lsLawLinkInfo.do?lsJoLnkSeq=1000225659&chrClsCd=010202' },
  { law: '지방세법 제151조(지방교육세 과세표준과 세율)', url: 'https://www.law.go.kr/LSW//lsLawLinkInfo.do?lsJoLnkSeq=1000226905&lsId=001649&chrClsCd=010202&print=print' },
  { law: '농어촌특별세법', url: 'https://www.law.go.kr/LSW/lsInfoP.do?lsId=001569&ancYnChk=0' },
  { law: '찾기쉬운 생활법령정보 — 매매를 한 경우 세금 납부하기(법제처)', url: 'https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=666&ccfNo=2&cciNo=2&cnpClsNo=4' },
] as const;

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

  // 지방세법 제151조 — 주택 유상거래는 "해당 세율 × 100분의 50"을 적용해 산출한
  // 금액의 100분의 20이다(일반 부동산의 "세율 − 1천분의 20" 산식이 아니다).
  // → 1% 구간이면 0.1%, 3% 구간이면 0.3%.
  const localEducationTax = Math.round(purchasePrice * ((rate / 2) / 100) * 0.2);

  // 농어촌특별세법 제5조 — 과세표준은 **표준세율 2%로 산출한 취득세액**이고 세율은
  // 10%다. 그래서 실제 취득세율이 1%든 3%든 결과는 취득가액의 0.2%로 고정된다
  // (취득세액의 10%가 아니다 — 흔한 오해).
  // 전용 85㎡ 이하는 서민주택으로 비과세. 면적을 모르면 **더하지 않는다**
  // (모르는 것을 있는 것처럼 청구하지 않는다).
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
