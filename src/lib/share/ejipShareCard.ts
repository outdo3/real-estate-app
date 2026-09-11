// SHARE_CARD_UNIFICATION_V1 — 이집 카카오 공유 카드의 **유일한** 조립 지점.
//
// 배경(감사): 같은 "공유" 버튼인데 화면마다 결과가 달랐다.
//   - 아파트 상세/StickyActionBar/학교 상세 → KakaoShareButton → 카카오 SDK 먼저
//     호출 → 브랜드 이미지 + 제목 + 설명 + CTA 버튼이 붙은 **카카오 feed 카드**.
//   - 통계/비교/지도/분양/재개발/커뮤니티 → useSharePage → navigator.share 먼저
//     호출 → 모바일에는 navigator.share가 **항상** 있으므로 카카오 분기에 영영
//     도달하지 못했다 → 카카오톡이 URL을 크롤링해 만든 **일반 OG 미리보기**.
//
// 카드 능력의 차이가 아니라 순서의 차이였다. 그래서 카드 조립 규칙을 한 곳에 모으고,
// 각 공유 표면은 type만 고르게 한다 — 페이지마다 카드 코드를 복붙하지 않는다.
//
// 이 파일은 순수 함수만 담는다(DOM/브라우저 API 없음) — 전부 테스트 가능하다.

/** 공유 카드의 성격. CTA 라벨과 기본 문구가 여기서 갈린다. */
export type EjipShareType = 'apartment' | 'stats' | 'compare' | 'report' | 'generic';

export const EJIP_BRAND_NAME = '이집';

/**
 * §9 — type별 CTA 버튼 라벨. "웹으로 보기" 같은 일반 문구를 쓰지 않는다.
 * 사용자가 카드만 보고도 무엇을 여는지 알 수 있어야 한다.
 */
export const EJIP_SHARE_CTA: Record<EjipShareType, string> = {
  apartment: '이집에서 자세히 보기',
  stats: '이집에서 통계 보기',
  compare: '이집에서 비교 보기',
  report: '이집에서 리포트 보기',
  generic: '이집에서 자세히 보기',
};

export interface EjipShareCardInput {
  type: EjipShareType;
  title: string;
  description: string;
  /** 절대 URL(https 권장). 상대경로/localhost는 카카오가 가져오지 못한다. */
  imageUrl: string;
  /** 카드와 CTA 버튼이 함께 가리키는 canonical 링크. 절대 URL이어야 한다. */
  canonicalUrl: string;
  /** 기본 CTA를 덮어쓸 때만. 비우면 type의 기본 라벨을 쓴다. */
  buttonLabel?: string;
}

/** 카카오 JavaScript SDK의 Share.sendDefault()가 받는 feed 템플릿 객체. */
export interface KakaoFeedPayload {
  objectType: 'feed';
  content: {
    title: string;
    description: string;
    imageUrl: string;
    link: { mobileWebUrl: string; webUrl: string };
  };
  buttons: { title: string; link: { mobileWebUrl: string; webUrl: string } }[];
}

const URL_RE = /https?:\/\/\S+/gi;

/** 공백 정리. 줄바꿈/연속 공백은 카드에서 의미가 없다. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * §14 — 설명문에 URL을 심지 않는다.
 *
 * 카카오 카드는 이미 link 필드로 URL을 갖고 있다. 설명에까지 URL을 넣으면 카드 안에
 * 주소가 한 번 더 보이고, 네이티브 공유로 폴백했을 때는 OS가 text와 url을 이어붙여
 * 같은 주소가 두 번 들어간 말풍선이 만들어진다.
 */
export function stripUrls(text: string): string {
  return collapse(text.replace(URL_RE, ''));
}

/**
 * §22 — 제목 끝의 브랜드 접미사를 **정확히 한 번**으로 맞춘다.
 *
 * 호출부마다 '… | 이집' / '… - 이집' / 접미사 없음이 섞여 있어서, 그대로 두면
 * '… | 이집 | 이집'처럼 중복되거나 어떤 카드에만 브랜드가 빠진다.
 */
export function withEjipSuffix(rawTitle: string): string {
  let title = collapse(rawTitle);
  // 이미 붙어 있는 접미사는 몇 개가 붙어 있든 전부 떼고 하나만 다시 붙인다.
  let previous: string;
  do {
    previous = title;
    title = title.replace(/\s*[|·\-–—]\s*이집\s*$/, '').trim();
  } while (title !== previous);
  if (!title) return EJIP_BRAND_NAME;
  return `${title} | ${EJIP_BRAND_NAME}`;
}

/** http(s) 절대 URL인지. 카카오는 상대경로/로컬 주소를 가져오지 못한다. */
export function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url);
}

export class EjipShareCardError extends Error {}

/**
 * §3 — 브랜드 카카오 카드를 만드는 공통 빌더. 모든 공유 표면이 이 함수 하나를 쓴다.
 *
 * URL이 절대경로가 아니면 **던진다**. 카카오에 깨진 카드를 보내느니 호출부가
 * 네이티브 공유/링크 복사로 내려가는 편이 낫다(§16).
 */
export function buildEjipKakaoShare(input: EjipShareCardInput): KakaoFeedPayload {
  const canonicalUrl = collapse(input.canonicalUrl);
  const imageUrl = collapse(input.imageUrl);

  if (!isAbsoluteHttpUrl(canonicalUrl)) {
    throw new EjipShareCardError(`공유 URL이 절대 URL이 아닙니다: ${canonicalUrl}`);
  }
  if (!isAbsoluteHttpUrl(imageUrl)) {
    throw new EjipShareCardError(`공유 이미지 URL이 절대 URL이 아닙니다: ${imageUrl}`);
  }

  const link = { mobileWebUrl: canonicalUrl, webUrl: canonicalUrl };
  const title = withEjipSuffix(input.title);
  const description = stripUrls(input.description);

  return {
    objectType: 'feed',
    content: { title, description, imageUrl, link },
    buttons: [{ title: input.buttonLabel?.trim() || EJIP_SHARE_CTA[input.type], link }],
  };
}

// ── 표면별 공유 문구 ────────────────────────────────────────────────────────
// §5~§8. 같은 화면이 여러 곳(Hero / StickyActionBar 등)에서 공유되더라도 문구가
// 갈라지지 않도록, 문구도 카드와 같은 곳에서 만든다.

export interface EjipShareCopy {
  title: string;
  description: string;
}

/** §5 — 아파트 상세. */
export function apartmentShareCopy(apartmentName: string): EjipShareCopy {
  const name = collapse(apartmentName);
  return {
    title: withEjipSuffix(name),
    description: `${name}의 실거래, 가격, 입지 정보를 확인해보세요.`,
  };
}

/** §6 — 단지 비교. */
export function compareShareCopy(nameA: string, nameB: string): EjipShareCopy {
  return {
    title: withEjipSuffix(`${collapse(nameA)} vs ${collapse(nameB)} 비교`),
    description: '두 단지의 실거래·가격·입지 데이터를 비교해보세요.',
  };
}

/** §7 — 통계. 화면별 subtitle이 있으면 그쪽이 더 정확하므로 우선한다. */
export const STATS_SHARE_DESCRIPTION = '지역 실거래와 가격 흐름을 이집에서 확인해보세요.';

export function statsShareCopy(contextTitle: string, subtitle?: string): EjipShareCopy {
  return {
    title: withEjipSuffix(contextTitle),
    description: collapse(subtitle || '') || STATS_SHARE_DESCRIPTION,
  };
}

/** §8 — 한장 리포트. */
export const REPORT_SHARE_DESCRIPTION = '핵심 데이터를 한 장으로 확인해보세요.';

export function reportShareCopy(reportTitle: string): EjipShareCopy {
  return {
    title: withEjipSuffix(reportTitle),
    description: REPORT_SHARE_DESCRIPTION,
  };
}
