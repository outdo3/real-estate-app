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
export const PARTNER_TYPES = ['legal_office', 'brokerage'] as const;
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

/**
 * APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §7 — 중개사 파일럿의 **영업 가능 구역**.
 *
 * 이름이 아니라 canonical 위치로만 판정한다. 단지명 문자열 매칭은 쓰지 않는다 —
 * 이름은 같은 이름이 여러 구에 있을 수 있고, 부분 문자열은 엉뚱한 단지를 끌어온다.
 *
 * dongs는 **Production ApartmentMaster.umd_name 실측값**이며 정확히 일치해야 한다.
 * 부분 문자열 매칭을 쓰면 안 되는 실제 사례: 부산 서구에는 `남부민동`(아파트 10곳)이
 * 있는데, `부민동`으로 contains 매칭하면 영업 구역이 아닌 남부민동까지 잡힌다.
 */
export interface PartnerServiceArea {
  /** 법정동코드 앞 5자리(= MOLIT lawdCd / sggCd). '서구'라는 이름은 대구·인천·광주·
   *  대전에도 있으므로 이름이 아니라 이 코드로 구를 확정한다. */
  lawdCd: string;
  /** 정확히 일치해야 하는 법정동 목록(실측 canonical 값). */
  dongs: readonly string[];
}

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
  /**
   * 카카오 오픈채팅 주소. **화면에 원문을 노출하지 않고 분석으로도 나가지 않는다.**
   *
   * 중개사 파일럿에는 카카오 채널이 없다 — 없는 채널을 지어내지 않기 위해 선택 필드다.
   * 값이 없으면 카카오 CTA 자체가 렌더되지 않는다.
   */
  kakaoUrl?: string;
  /** 중개사무소 대표 공인중개사 이름. 중개업이 아닌 파트너에는 없다. */
  representative?: string;
  /** 중개사무소 등록번호. 법정 표시사항이라 화면에 그대로 보여준다. */
  registrationNumber?: string;
  /** 사무소 주소. */
  address?: string;
  /** 파트너가 확인해 준 상담 범위 한 줄. 마케팅 문구가 아니다. */
  description?: string;
  /** 있으면 이 구역의 단지에서만 렌더된다. 없으면 위치와 무관하게 렌더된다. */
  serviceArea?: PartnerServiceArea;
  /** 끄면 CTA가 통째로 사라진다(노출 집계도 발생하지 않는다). */
  enabled: boolean;
  /** 이 파트너를 보여줄 자리. 여기에 없는 자리에서는 렌더되지 않는다. */
  placements: readonly PartnerPlacement[];
}
