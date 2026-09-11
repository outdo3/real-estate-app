/**
 * PARTNER_LEAD_TRACKING_V1 — 제휴 파트너 CTA의 타입 정의.
 *
 * ── 이 시스템이 하는 일 / 하지 않는 일 ──────────────────────────────────────
 * 하는 일 : 문맥에 맞는 자리에 "외부 상담처로 나가는 링크"를 보여주고, 그 노출과
 *           클릭을 센다.
 * 안 하는 일: 이집은 이 흐름에서 **고객 정보를 단 하나도 수집하지 않는다.**
 *           이름·전화번호·이메일·상담 내용 어느 것도 받지 않는다. 사용자는 카카오
 *           오픈채팅이나 전화로 **파트너에게 직접** 연결되고, 그 다음 대화는 이집을
 *           거치지 않는다(click-out 모델). 그래서 DB도 스키마도 필요 없다.
 *
 * ── 클릭은 상담이 아니다(§13) ───────────────────────────────────────────────
 * 이벤트 이름을 `partner_cta_click`으로 고정한 이유다. lead / conversion /
 * consultation_complete 같은 이름을 쓰지 않는다 — 우리는 사용자가 버튼을 눌렀다는
 * 사실까지만 알 수 있고, 실제로 상담이 이뤄졌는지는 **확인할 수단이 없다.** 성과처럼
 * 들리는 이름을 붙이면 나중에 그 숫자가 성과로 읽힌다.
 */

/** 파트너 업종. 새 업종이 생기면 여기에 추가한다. */
export const PARTNER_TYPES = ['legal_office'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

/**
 * CTA를 놓을 수 있는 자리(§11 — 통제된 enum).
 *
 * 문자열을 자유롭게 받지 않는 이유: placement는 GA4 파라미터로 나가는 값이라,
 * 호출부가 임의 문자열을 넣을 수 있으면 분석 값이 오염된다.
 *
 *  finance    — 자금 계획(/finance-fit). "등기·법무 비용은 계산에 포함되지 않음"을
 *               막 읽은 직후라 이 STEP에서 문맥이 가장 강한 자리다.
 *  apt_detail — 단지 상세 하단. 특정 단지를 깊이 본 뒤.
 *
 * `report_web`(리포트 웹뷰)은 **의도적으로 넣지 않았다** — 리포트는 신뢰 레이어라
 * 광고를 얹기 전에 별도 판단이 필요하다(§8). 필요해지면 여기에 한 줄 추가하면 된다.
 */
export const PARTNER_PLACEMENTS = ['finance', 'apt_detail'] as const;
export type PartnerPlacement = (typeof PARTNER_PLACEMENTS)[number];

/** 외부로 나가는 통로. 어느 쪽이 실제로 쓰이는지 알아야 파트너에게 의미가 있다. */
export const PARTNER_CHANNELS = ['kakao', 'phone'] as const;
export type PartnerChannel = (typeof PARTNER_CHANNELS)[number];

export interface PartnerConfig {
  /** 분석에 나가는 **유일한 식별자.** 사람이 읽을 수 있는 고정 slug. */
  id: string;
  type: PartnerType;
  /** 화면에 보여줄 상호. */
  displayName: string;
  /** tel: 링크에 쓰는 숫자만의 번호. **분석으로는 절대 나가지 않는다.** */
  phone: string;
  /** 화면에 보여줄 번호 표기. */
  displayPhone: string;
  /** 카카오 오픈채팅 주소. **화면에 원문을 노출하지 않고 분석으로도 나가지 않는다.** */
  kakaoUrl: string;
  /** 끄면 CTA가 통째로 사라진다(노출 집계도 발생하지 않는다). */
  enabled: boolean;
  /** 이 파트너를 보여줄 자리. 여기에 없는 자리에서는 렌더되지 않는다. */
  placements: readonly PartnerPlacement[];
}
