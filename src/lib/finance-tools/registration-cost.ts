/**
 * REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §10 — 등기 비용.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 이 파일이 숫자를 만들지 않는 이유
 * ══════════════════════════════════════════════════════════════════════════
 * "등기비용"이라고 한 덩어리로 불리지만 실제로는 성격이 다른 셋이 섞여 있다:
 *
 *   A. 공과금      — 취득세 등. 취득세 계산기가 이미 따로 다룬다.
 *   B. 법무사 보수 — **사무소마다 다르다.** 정해진 요율표가 없다.
 *   C. 기타 실비   — 국민주택채권 매입 후 즉시 매도할 때의 할인차손이 대표적인데,
 *                    이건 채권 시세에 따라 **매일 바뀐다**. 증지·등본·교통비 등도 있다.
 *
 * B와 C를 "평균값"으로 합쳐 숫자 하나를 보여주면 그럴듯해 보이지만, 그 숫자는
 * 어느 사무소의 것도 아니고 오늘의 채권 시세도 아니다. 자금 계획에서 수십만 원이
 * 틀리는 쪽이, 항목을 알려주고 견적을 받게 하는 쪽보다 나쁘다.
 *
 * 그래서 이 모듈은 **비용 항목과 그 성격만** 돌려준다. 금액은 만들지 않는다.
 * 실제 금액이 필요한 사용자는 법무사 상담으로 연결된다(§11).
 */

export type CostNature =
  /** 다른 계산기가 금액을 계산한다. */
  | 'CALCULATED_ELSEWHERE'
  /** 사무소마다 다르다 — 견적이 필요하다. */
  | 'QUOTE_REQUIRED'
  /** 시세·건마다 달라 사전 확정이 어렵다. */
  | 'VARIABLE';

export interface RegistrationCostItem {
  key: string;
  label: string;
  nature: CostNature;
  /** 왜 여기서 금액을 말하지 않는지에 대한 한 줄 설명. */
  note: string;
}

export const REGISTRATION_COST_ITEMS: readonly RegistrationCostItem[] = [
  {
    key: 'acquisitionTax',
    label: '취득세 등 공과금',
    nature: 'CALCULATED_ELSEWHERE',
    note: '위 취득세 계산 결과를 그대로 사용합니다.',
  },
  {
    key: 'bond',
    label: '국민주택채권 매입(할인 시 차손)',
    nature: 'VARIABLE',
    note: '채권을 사서 바로 팔 때 생기는 손실분입니다. 채권 시세에 따라 매일 달라져 미리 확정할 수 없습니다.',
  },
  {
    key: 'legalFee',
    label: '법무사 보수',
    nature: 'QUOTE_REQUIRED',
    note: '정해진 요율표가 없어 사무소마다 다릅니다. 실제 견적을 받아 확인하세요.',
  },
  {
    key: 'misc',
    label: '증지·등본·출장 등 실비',
    nature: 'VARIABLE',
    note: '건별로 달라집니다. 견적에 함께 포함해 확인하는 것이 좋습니다.',
  },
] as const;

/**
 * 자금 계획에 **확정 금액으로 넣을 수 있는** 항목이 있는가.
 *
 * 현재는 취득세뿐이다. 그래서 "예상 필요 현금"에는 취득세만 더하고, 나머지는
 * "별도 확인 필요"로 남긴다 — 합계에 추정치를 몰래 섞지 않는다.
 */
export function hasCalculableRegistrationCost(): boolean {
  return REGISTRATION_COST_ITEMS.some((item) => item.nature === 'CALCULATED_ELSEWHERE');
}

/** 견적이 필요한 항목들 — 파트너 상담 안내를 붙일 근거. */
export function quoteRequiredItems(): RegistrationCostItem[] {
  return REGISTRATION_COST_ITEMS.filter((item) => item.nature !== 'CALCULATED_ELSEWHERE');
}
