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
import { cityReportHref, districtReportHref, dongReportHref } from '@/lib/report/report-links';
import { indexableDongs, type DongTradeCount } from '@/lib/seo/report-region-seo';

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
 * §2 — 출시 범위(부산)의 지역 경로.
 *
 * REGIONAL_SEO_KEYWORD_LANDING_V1 §15 — 예전에는 구마다 `/stats?sido=&sigungu=`와
 * `/school?sido=&sigungu=`(32개)를 실었다. 둘 다 클라이언트 화면이라 서버 HTML에는 지역 내용이
 * 없고(실측: 서구 URL의 H1/본문이 "시장 통계·분석"/"부산광역시 전체"), 쿼리는 공유용 상태 복원일
 * 뿐이라 canonical이 `/stats`·`/school`이다. canonical이 아닌 쿼리 변형은 사이트맵에 싣지 않는다.
 *
 * 대신 **서버에서 실제 거래 데이터를 렌더하는** 지역 한장 브리핑을 싣는다:
 * 부산 전체 1개 + 검증된 16개 자치구·군. 동은 DB 표본 판정이 필요해 buildDongRoutes가 따로 만든다.
 *
 * 사이트맵에서 빠진다고 해서 접근이 막히는 것은 아니다 — 사이트맵은 색인을 정할 뿐 접근을 정하지 않는다.
 */
export function buildLaunchRegionRoutes(): SitemapRegionRoute[] {
  const routes: SitemapRegionRoute[] = [{ path: cityReportHref(), changeFrequency: 'daily', priority: 0.8 }];
  for (const district of BUSAN_DISTRICTS) {
    const path = districtReportHref(district.lawdCd);
    if (path) routes.push({ path, changeFrequency: 'daily', priority: 0.7 });
  }
  return routes;
}

/** §8/§15 — 최근 1년 표본이 있는 동만(indexableDongs와 같은 판정 — 동 페이지 robots와 갈라지지 않는다). */
export function buildDongRoutes(rows: readonly DongTradeCount[]): SitemapRegionRoute[] {
  return indexableDongs(rows)
    .map((r) => dongReportHref(r.lawdCd, r.dong))
    .filter((p): p is string => !!p)
    .map((path) => ({ path, changeFrequency: 'weekly' as const, priority: 0.5 }));
}
