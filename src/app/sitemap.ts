import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';
import { absoluteUrl } from '@/config/site';
import { buildLaunchRegionRoutes } from '@/lib/sitemap-scope';

export const dynamic = 'force-dynamic';

const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/stats', priority: 0.7, changeFrequency: 'daily' },
  { path: '/school', priority: 0.6, changeFrequency: 'weekly' },
  { path: '/community', priority: 0.6, changeFrequency: 'daily' },
];

// BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §2 — 지역 경로는 출시 범위(부산 16개)만 싣는다.
// 예전에는 REGION_DATA(전국 17개 시도)를 통째로 돌아 서울/경기 등 데이터가 없는
// 지역 URL 약 460개가 색인 대상으로 나갔다. 범위 판단은 @/lib/sitemap-scope가 갖는다.
function buildRegionRoutes(): MetadataRoute.Sitemap {
  return buildLaunchRegionRoutes().map((r) => ({
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

  const communityRoutes = await buildCommunityRoutes();

  return [...staticRoutes, ...buildRegionRoutes(), ...communityRoutes];
}
