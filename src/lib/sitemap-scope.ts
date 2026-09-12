// BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §1/§2 — 사이트맵에 실을 **지역 범위**를 정하는
// 순수 모듈. prisma를 import하지 않으므로 DB 없이 테스트할 수 있다.
//
// 고친 문제: 예전 sitemap.ts는 REGION_DATA(전국 17개 시도 · 약 230개 시군구)를 통째로
// 돌면서 지역 URL을 만들었다. 그래서 실제 배포 sitemap.xml에 아래 같은 URL이 실려 있었다.
//
//     /stats?sido=서울특별시&sigungu=강남구
//     /school?sido=서울특별시&sigungu=강남구
//
// 이집의 현재 데이터는 부산이다. 서울 강남구 통계 페이지를 색인에 올리면 검색엔진에는
// **전국 서비스처럼 보이고**, 사용자는 빈 화면을 받는다. 색인 대상은 실제로 쓸모 있는
// 내용이 있는 경로여야 한다.
//
// 지역 목록은 새로 적지 않고 이미 검증된 단일 출처(BUSAN_DISTRICTS, 현행 16개 자치구·군)를
// 그대로 쓴다 — 전국 확장 시 그 목록만 늘리면 사이트맵이 따라온다.

import { BUSAN_DISTRICTS } from '@/lib/report/region-scope';

export const LAUNCH_SIDO = '부산광역시';

/**
 * 지역 쿼리스트링.
 *
 * **`&`가 아니라 `&amp;`인 것은 오타가 아니다.** Next.js의 sitemap 직렬화는 `<loc>`에
 * 넣는 문자열을 XML 이스케이프하지 **않는다**(실측: 배포된 sitemap.xml에 `&amp;`가
 * 한 겹으로만 나온다 — 이스케이프했다면 `&amp;amp;`가 됐어야 한다). 그래서 XML로서
 * 올바른 문서가 되려면 여기서 직접 이스케이프해야 한다. XML 파서가 이걸 다시 `&`로
 * 디코드하므로 크롤러가 받는 최종 URL은 `?sido=...&sigungu=...`가 맞다.
 *
 * 여기를 `&`로 "고치면" 사이트맵이 well-formed XML이 아니게 된다.
 */
export function regionQuery(sido: string, sigungu: string): string {
  return `sido=${encodeURIComponent(sido)}&amp;sigungu=${encodeURIComponent(sigungu)}`;
}

export interface SitemapRegionRoute {
  path: string;
  changeFrequency: 'daily' | 'weekly';
  priority: number;
}

/**
 * §2 — 출시 범위(부산 16개 자치구·군)의 통계/학군 지역 경로.
 *
 * 사이트맵에서 빠진다고 해서 접근이 막히는 것은 아니다(§2 마지막 줄). 서울 URL을 직접
 * 열면 지금도 그대로 열린다 — 사이트맵은 색인을 정할 뿐 접근을 정하지 않는다.
 */
export function buildLaunchRegionRoutes(): SitemapRegionRoute[] {
  const routes: SitemapRegionRoute[] = [];
  for (const district of BUSAN_DISTRICTS) {
    const query = regionQuery(LAUNCH_SIDO, district.name);
    routes.push({ path: `/stats?${query}`, changeFrequency: 'daily', priority: 0.5 });
    routes.push({ path: `/school?${query}`, changeFrequency: 'weekly', priority: 0.4 });
  }
  return routes;
}
