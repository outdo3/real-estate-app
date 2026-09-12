import type { PartnerConfig, PartnerPlacement, PartnerType } from './types';

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
  // APT_DETAIL_PARTNER_TRADE_DENSITY_V1 §6 — 중개사 파일럿.
  //
  // 채널은 **전화 하나뿐**이다. 카카오·홈페이지·이메일·프로필 사진·로고는 존재하지
  // 않으므로 비워 둔다(없는 것을 만들지 않는다). 문구도 파트너가 확인해 준 한 줄
  // 그대로이며, 자격·경력·수수료·영업시간 같은 주장은 들어가지 않는다.
  //
  // 자리는 apt_detail 하나뿐이다 — finance(자금 계획)에는 올리지 않는다(§23).
  {
    id: 'lotte-real-estate-seogu',
    type: 'brokerage',
    displayName: '롯데부동산중개사무소',
    representative: '심은희',
    phone: '0517142225',
    displayPhone: '051-714-2225',
    registrationNumber: '제26140-2024-00019호',
    address: '부산 서구 대티로 161, 301동 201호',
    description: '서대신동·동대신동·부민동·부용동 아파트 매매·전세 상담',
    // §7 — 실측 canonical 법정동. Production ApartmentMaster(sgg_cd='26140')의
    // umd_name을 직접 조회해 확인한 값이며, 추정하지 않았다.
    //
    // 파트너가 말한 영업 구역은 '서대신동·동대신동·부민동·부용동'이지만, 실제 단지가
    // 존재하는 법정동은 아래 9개다 — 부민동2가·부용동2가에는 ApartmentMaster 행이
    // 하나도 없어 목록에 넣지 않는다(없는 동을 적어두면 있는 것처럼 읽힌다).
    //
    // 남부민동(단지 10곳)은 **영업 구역이 아니다.** contains('부민동')로 매칭하면
    // 남부민동까지 잡히므로 아래 값과 **정확히 일치**할 때만 자격을 준다.
    serviceArea: {
      lawdCd: '26140',
      dongs: [
        '서대신동1가',
        '서대신동2가',
        '서대신동3가',
        '동대신동1가',
        '동대신동2가',
        '동대신동3가',
        '부민동1가',
        '부민동3가',
        '부용동1가',
      ],
    },
    enabled: true,
    placements: ['apt_detail'],
  },
];

/**
 * §7 — 이 위치에서 상담 가능한 중개사. 자격이 없으면 null이고 카드가 렌더되지 않으며,
 * 따라서 노출 집계도 발생하지 않는다(§21).
 *
 * 판정에 쓰는 것은 canonical 위치뿐이다:
 *   1. lawdCd가 영업 구역의 구와 **정확히** 같은가 ('서구'라는 이름은 대구·인천·광주·
 *      대전에도 있으므로 이름으로 판정하지 않는다)
 *   2. 법정동이 검증된 목록과 **정확히** 같은가 (부분 문자열 금지 — 남부민동 오매칭)
 *
 * 단지명은 보지 않는다. 위치를 알 수 없으면(둘 중 하나라도 비면) 자격 없음이다 —
 * 모르는 상태를 자격 있음으로 넘기지 않는다.
 */
export function getBrokerForLocation(
  location: { lawdCd?: string | null; dong?: string | null },
  placement: PartnerPlacement = 'apt_detail'
): PartnerConfig | null {
  const lawdCd = (location.lawdCd ?? '').trim();
  const dong = (location.dong ?? '').trim();
  if (!lawdCd || !dong) return null;

  return (
    PARTNERS.find(
      (p) =>
        p.enabled &&
        p.type === 'brokerage' &&
        p.placements.includes(placement) &&
        !!p.serviceArea &&
        p.serviceArea.lawdCd === lawdCd &&
        p.serviceArea.dongs.includes(dong)
    ) ?? null
  );
}

/**
 * 해당 자리에 보여줄 파트너. 없으면 null이고 호출부는 아무것도 렌더하지 않는다.
 *
 * 지금은 자리마다 한 곳만 나온다(첫 번째 일치). 파트너가 늘어나 회전/가중치가
 * 필요해지면 이 함수 하나만 바꾸면 되고, 컴포넌트와 호출부는 그대로다.
 */
export function getPartnerForPlacement(
  placement: PartnerPlacement,
  type: PartnerType = 'legal_office'
): PartnerConfig | null {
  // §7 — 중개사는 자리(placement)가 아니라 **위치**로 결정되므로 이 경로로 나오지
  // 않는다. 기본 type을 명시해, 파트너가 늘어도 기존 호출부가 엉뚱한 업종을 집지 않는다.
  return PARTNERS.find((p) => p.enabled && p.type === type && p.placements.includes(placement)) ?? null;
}

/** 테스트/디버깅용. 비활성 파트너까지 포함한 전체 목록. */
export function allPartners(): readonly PartnerConfig[] {
  return PARTNERS;
}

/** tel: 링크 값. 숫자 이외 문자가 섞여 들어와도 안전하게 만든다. */
export function telHref(partner: PartnerConfig): string {
  return `tel:${partner.phone.replace(/[^0-9+]/g, '')}`;
}
