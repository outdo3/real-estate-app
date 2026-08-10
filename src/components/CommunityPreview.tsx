'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface CommunityPost {
  id: string;
  title: string;
  createdAt: string;
  author: { name: string; role: string };
  _count: { comments: number };
}

interface CommunityPreviewProps {
  aptName: string;
}

const PREVIEW_COUNT = 3;

// 4구역 커뮤니티 요약 뷰 — 이미 B단계(커뮤니티 단지 태그 연동)에서 만든 실제 API
// (`GET /api/community/posts?aptName=`)를 그대로 재사용한다. 새 데이터 소스 없이 최근 글
// 3건만 미리보기로 보여주고 "더보기"는 필터된 커뮤니티 목록으로 보낸다.
export default function CommunityPreview({ aptName }: CommunityPreviewProps) {
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aptName) return;
    let cancelled = false;
    setPosts(null);
    setError(null);

    fetch(`/api/community/posts?page=1&aptName=${encodeURIComponent(aptName)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          setPosts(json.data.posts);
        } else {
          setError(json.error || '커뮤니티 글을 불러오지 못했습니다.');
        }
      })
      .catch(() => {
        if (!cancelled) setError('커뮤니티 글을 불러오지 못했습니다.');
      });

    return () => {
      cancelled = true;
    };
  }, [aptName]);

  const communityHref = `/community?aptName=${encodeURIComponent(aptName)}`;
  const writeHref = `/community/write?aptName=${encodeURIComponent(aptName)}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>💬 {aptName} 커뮤니티</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Link href={writeHref} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary-color)', textDecoration: 'none' }}>
            ✏️ 글쓰기
          </Link>
          <Link href={communityHref} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none' }}>
            더보기 &gt;
          </Link>
        </div>
      </div>

      {posts === null && !error ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>불러오는 중입니다...</div>
      ) : error ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>⚠️ {error}</div>
      ) : posts!.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          아직 이 단지 관련 글이 없습니다. 첫 글을 남겨보세요!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {posts!.slice(0, PREVIEW_COUNT).map((post) => (
            <Link
              key={post.id}
              href={`/community/${post.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 0',
                borderBottom: '1px solid #f1f5f9',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: '0.9rem' }}>
                {post.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>[{post._count.comments}]</span>
              </span>
              <span style={{ flexShrink: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {post.author.name} · {new Date(post.createdAt).toLocaleDateString('ko-KR')}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
