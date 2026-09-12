import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { siteConfig, buildOpenGraph, absoluteUrl } from '@/config/site';
import PostDetailPageClient from './post-client';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  let post: { title: string; content: string } | null = null;
  try {
    post = await prisma.post.findUnique({
      where: { id },
      select: { title: true, content: true },
    });
  } catch (e) {
    console.error('[community/[id]] generateMetadata Prisma 조회 실패', e);
  }

  if (!post) {
    return {
      title: `게시글을 찾을 수 없습니다 - ${siteConfig.name} 커뮤니티`,
    };
  }

  const description = post.content.replace(/\s+/g, ' ').trim().slice(0, 120);
  const title = `${post.title} - ${siteConfig.name} 커뮤니티`;

  // COMMUNITY_LAUNCH_READINESS_V1 — canonical/og:url을 **이 글**로 맞춘다.
  //
  // buildOpenGraph는 url을 siteConfig.url(사이트 루트)로 넣는다. 그대로 쓰면 모든
  // 커뮤니티 글의 og:url이 홈을 가리켜, 공유 카드와 검색엔진이 글을 구분하지 못한다.
  // 오리진은 여전히 siteConfig 한 곳에서만 나온다 — /stats/compare가 쓰는 것과 같은
  // 패턴이라 공용 헬퍼를 바꾸지 않는다(범위 밖 화면에 영향을 주지 않기 위해).
  const canonical = absoluteUrl(`/community/${id}`);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      ...buildOpenGraph({ title: post.title, description, type: 'article' }),
      url: canonical,
    },
  };
}

export default function PostDetailPage() {
  return <PostDetailPageClient />;
}
