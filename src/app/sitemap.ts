import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { absoluteUrl } from '@/config/site';
import { REGION_DATA } from '@/lib/regions';

export const dynamic = 'force-dynamic';

const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/stats', priority: 0.7, changeFrequency: 'daily' },
  { path: '/school', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/community', priority: 0.6, changeFrequency: 'daily' },
];

function buildRegionRoutes(): MetadataRoute.Sitemap {
  const routes: MetadataRoute.Sitemap = [];
  for (const [sido, sigunguList] of Object.entries(REGION_DATA)) {
    for (const sigungu of sigunguList) {
      const query = `sido=${encodeURIComponent(sido)}&sigungu=${encodeURIComponent(sigungu)}`;
      routes.push({
        url: absoluteUrl(`/stats?${query}`),
        changeFrequency: 'daily',
        priority: 0.5,
      });
      routes.push({
        url: absoluteUrl(`/school?${query}`),
        changeFrequency: 'weekly',
        priority: 0.4,
      });
    }
  }
  return routes;
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

  const communityRoutes = await buildCommunityRoutes();

  return [...staticRoutes, ...buildRegionRoutes(), ...communityRoutes];
}
