import type { PartnerConfig, PartnerPlacement } from './types';

/**
 * PARTNER_LEAD_TRACKING_V1 §4 — 파트너 정보의 **단일 출처.**
 *
 * 파일 하나에 모아 두는 이유: 상호/번호/오픈채팅 주소가 여러 컴포넌트에 흩어지면
 * 파트너가 번호를 바꿨을 때 어디를 고쳐야 하는지 아무도 모르게 된다. 파일럿 파트너가
 * 한 곳뿐이라 **DB를 쓰지 않는다** — 한 행짜리 테이블을 위해 스키마와 migration을
 * 만들 이유가 없고, 파트너가 늘어나도 이 배열에 객체를 추가하면 된다.
 *
 * ── 문구에 대한 원칙 ────────────────────────────────────────────────────────
 * 아래 값은 **파트너가 실제로 확인해 준 사실만** 담는다. 무료 상담, 상담 가능 지역,
 * 영업 시간, 경력, 수수료, 업무 범위, 자격 표현 같은 건 하나도 없다 — 확인되지 않은
 * 내용을 광고 문구로 쓰면 그건 우리가 지어낸 약속이 된다. 추가 정보는 파트너가
 * 서면으로 확인해 준 뒤에만 들어온다.
 */
const PARTNERS: readonly PartnerConfig[] = [
  {
    id: 'hwangbo-jaeho-legal',
    type: 'legal_office',
    displayName: '황보재호법무사사무실',
    phone: '01080264778',
    displayPhone: '010-8026-4778',
    kakaoUrl: 'https://open.kakao.com/o/s7paR4Mi',
    enabled: true,
    placements: ['finance', 'apt_detail'],
  },
];

/**
 * 해당 자리에 보여줄 파트너. 없으면 null이고 호출부는 아무것도 렌더하지 않는다.
 *
 * 지금은 자리마다 한 곳만 나온다(첫 번째 일치). 파트너가 늘어나 회전/가중치가
 * 필요해지면 이 함수 하나만 바꾸면 되고, 컴포넌트와 호출부는 그대로다.
 */
export function getPartnerForPlacement(placement: PartnerPlacement): PartnerConfig | null {
  return PARTNERS.find((p) => p.enabled && p.placements.includes(placement)) ?? null;
}

/** 테스트/디버깅용. 비활성 파트너까지 포함한 전체 목록. */
export function allPartners(): readonly PartnerConfig[] {
  return PARTNERS;
}

/** tel: 링크 값. 숫자 이외 문자가 섞여 들어와도 안전하게 만든다. */
export function telHref(partner: PartnerConfig): string {
  return `tel:${partner.phone.replace(/[^0-9+]/g, '')}`;
}
