import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { absoluteUrl } from '@/config/site';
import { buildDongRoutes, buildLaunchRegionRoutes } from '@/lib/sitemap-scope';
import { readBusanDongTradeCounts } from '@/lib/seo/region-seo-read';

export const dynamic = 'force-dynamic';

const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/stats', priority: 0.7, changeFrequency: 'daily' },
  { path: '/school', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/community', priority: 0.6, changeFrequency: 'daily' },
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §12/§15 — 부산 → 구 → 동 브리핑으로 내려가는 리포트 허브.
  { path: '/report', priority: 0.6, changeFrequency: 'daily' },
];

// BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §2 — 지역 경로는 출시 범위(부산 16개)만 싣는다.
// REGIONAL_SEO_KEYWORD_LANDING_V1 §15 — 그 지역 경로는 이제 서버 렌더 지역 브리핑(canonical)이다.
// 예전에는 REGION_DATA(전국 17개 시도)를 통째로 돌아 서울/경기 등 데이터가 없는
// 지역 URL 약 460개가 색인 대상으로 나갔다. 범위 판단은 @/lib/sitemap-scope가 갖는다.
function buildRegionRoutes(): MetadataRoute.Sitemap {
  return buildLaunchRegionRoutes().map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}

/**
 * §8/§15 — 최근 1년 표본이 있는 동 브리핑. 조회가 실패하면 동만 빠진다(나머지 사이트맵은 그대로).
 * 실패를 "색인할 동 없음"으로 캐시하지 않는다 — readBusanDongTradeCounts가 실패를 저장하지 않는다.
 */
async function buildDongReportRoutes(): Promise<MetadataRoute.Sitemap> {
  const rows = await readBusanDongTradeCounts();
  if (!rows) return [];
  return buildDongRoutes(rows).map((r) => ({
    url: absoluteUrl(r.path),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}

const MAX_COMMUNITY_URLS = 500;

async function buildCommunityRoutes(): Promise<MetadataRoute.Sitemap> {
  const posts = await prisma.post.findMany({
    select: { id: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_COMMUNITY_URLS,
  });
  return posts.map((post) => ({
    url: absoluteUrl(`/community/${post.id}`),
    lastModified: post.updatedAt,
    changeFrequency: 'never' as const,
    priority: 0.4,
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    priority: r.priority,
    changeFrequency: r.changeFrequency,
  }));

  const [dongRoutes, communityRoutes] = await Promise.all([buildDongReportRoutes(), buildCommunityRoutes()]);

  return [...staticRoutes, ...buildRegionRoutes(), ...dongRoutes, ...communityRoutes];
}
