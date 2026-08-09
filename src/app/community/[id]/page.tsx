import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { siteConfig, buildOpenGraph } from '@/config/site';
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

  return {
    title,
    description,
    openGraph: buildOpenGraph({
      title: post.title,
      description,
      type: 'article',
    }),
  };
}

export default function PostDetailPage() {
  return <PostDetailPageClient />;
}
