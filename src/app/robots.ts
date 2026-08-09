import type { MetadataRoute } from 'next';
import { siteConfig } from '@/config/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin', '/mypage', '/community/write'],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
