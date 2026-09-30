// REALTOR_PRO_BRIEFING_ADS_ISOLATION_V1 — 고객 브리핑 공개 페이지(/b/[token])의 메타데이터·열람 집계 정책(순수).
// 페이지(src/app/b/[token]/page.tsx)가 그대로 쓰고, 테스트는 next 런타임 없이 이 모듈만 검사한다.
//
// · 색인·팔로우·보관 금지, 리퍼러 전송 금지.
// · 루트 layout의 openGraph(og:url 등)를 **덮어쓴다** — 공유 미리보기 카드에 고객·매물·토큰 정보가 실리지 않게
//   고정 문구만 둔다. og:url·canonical은 두지 않는다(토큰 URL이 메타데이터로 새지 않게).
// · 링크 미리보기(카카오톡·네이버 등)·크롤러·프리페치는 조회수에 넣지 않는다.

import { isBotUserAgent } from '@/lib/analytics/traffic-classification';

export const BRIEFING_PAGE_TITLE = '매물 브리핑';
const BRIEFING_PAGE_DESCRIPTION = '중개사가 보낸 매물 브리핑입니다.';

export const BRIEFING_PAGE_METADATA = {
  title: BRIEFING_PAGE_TITLE,
  description: BRIEFING_PAGE_DESCRIPTION,
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  referrer: 'no-referrer' as const,
  alternates: { canonical: null },
  openGraph: { title: BRIEFING_PAGE_TITLE, description: BRIEFING_PAGE_DESCRIPTION, siteName: '이집', type: 'website' as const },
  twitter: { card: 'summary' as const, title: BRIEFING_PAGE_TITLE, description: BRIEFING_PAGE_DESCRIPTION },
};

const PREVIEW_UA = /kakaotalk-scrap|yeti\/|daumoa|slackbot|linkedinbot|twitterbot|embedly|skypeuripreview/i;

/** 사람의 열람으로 셀지(봇·링크 미리보기·프리페치 제외). 판정은 조회수에만 쓰고, 내용 공개 여부는 바꾸지 않는다. */
export function isHumanBriefingView(h: { get(name: string): string | null }): boolean {
  const ua = h.get('user-agent');
  if (!ua || isBotUserAgent(ua) || PREVIEW_UA.test(ua)) return false;
  const purpose = h.get('sec-purpose') ?? h.get('purpose') ?? h.get('x-purpose') ?? '';
  return !/prefetch|preview/i.test(purpose);
}
