// REGIONAL_SEO_KEYWORD_LANDING_V1 — 사이트 단위 SEO 값의 **단일 출처**(순수 모듈).
//
// 메인 제목/설명은 사용자 확정값이다(§3). 여기 말고 다른 곳에서 문자열을 다시 적지 않는다.
// prisma/환경변수를 읽지 않는다 — 오리진은 호출부가 siteConfig에서 넘긴다.

/** 브랜드 표기. 검색결과·공유카드·구조화 데이터가 모두 같은 이름을 쓴다. */
export const BRAND_NAME = '이집';
export const BRAND_ALTERNATE_NAMES = ['E-JIP', '이집(E-JIP)'] as const;

/** 지역·페이지 제목 뒤에 붙는 브랜드 접미사. */
export const TITLE_BRAND_SUFFIX = ` | ${BRAND_NAME}`;

/** §3 사용자 확정 — 메인 title. */
export const MAIN_TITLE = '이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터';

/** §3 사용자 확정 — 메인 description. */
export const MAIN_DESCRIPTION =
  '복잡한 부동산, 이집으로 쉽게. 아파트 실거래가부터 거래량, 학군, 교통, 단지 비교까지 한눈에 확인하세요.';

export type JsonLd = Record<string, unknown>;

function stripSlash(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/**
 * §16 — 홈에만 싣는 WebSite 구조화 데이터.
 * Google 사이트 이름 문서가 "WebSite 구조화 데이터의 name이 가장 중요하고 홈페이지에 있어야 한다"고
 * 명시한다. 네이버의 사이트 이름 결정 방식은 공개 문서로 확인하지 못했다(문서 §2 참고).
 */
export function buildWebSiteJsonLd(origin: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: BRAND_NAME,
    alternateName: [...BRAND_ALTERNATE_NAMES],
    url: `${stripSlash(origin)}/`,
    inLanguage: 'ko-KR',
  };
}

/** §16 — Organization. 가격·평점 같은 부동산 값은 넣지 않는다. */
export function buildOrganizationJsonLd(origin: string): JsonLd {
  const base = stripSlash(origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: BRAND_NAME,
    alternateName: [...BRAND_ALTERNATE_NAMES],
    url: `${base}/`,
    logo: `${base}/brand/icon/ejip-app-icon-512.png`,
  };
}

export interface BreadcrumbItem {
  name: string;
  /** 사이트 내부 경로(`/report/...`). 절대 URL은 여기서 만든다. */
  path: string;
}

/** §12/§16 — BreadcrumbList. 항목이 2개 미만이면 만들지 않는다(의미 없는 경로). */
export function buildBreadcrumbJsonLd(origin: string, items: readonly BreadcrumbItem[]): JsonLd | null {
  if (items.length < 2) return null;
  const base = stripSlash(origin);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${base}${item.path.startsWith('/') ? item.path : `/${item.path}`}`,
    })),
  };
}

/**
 * JSON-LD를 `<script>`에 넣을 문자열로. Next 16 JSON-LD 가이드대로 `<`를 이스케이프해
 * 동 이름 같은 외부 문자열이 스크립트를 닫지 못하게 한다.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
