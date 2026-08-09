import type { Metadata } from 'next';
import AppProviders from '@/components/AppProviders';
import { siteConfig } from '@/config/site';
import './globals.css';

import { headers } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  let host = 'localhost:3000';
  try {
    const headersList = headers();
    host = headersList.get('host') || 'localhost:3000';
  } catch (e) {
    // build time fallback
    if (process.env.VERCEL_URL) host = process.env.VERCEL_URL;
  }
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: siteConfig.name,
    description: siteConfig.description,
    openGraph: {
      title: siteConfig.name,
      description: siteConfig.description,
      siteName: siteConfig.name,
      locale: 'ko_KR',
      type: 'website',
      images: [
        {
          url: `${origin}/og-image.png`,
          width: 1200,
          height: 630,
          alt: siteConfig.name,
        },
      ],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
