'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CommunityPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR(`/api/community/posts?page=${page}`, fetcher);

  const posts = data?.success ? data.data.posts : [];
  const total = data?.success ? data.data.total : 0;
  const pageSize = data?.success ? data.data.pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // "글이 없음"과 "DB 연결 실패 등 실제 오류"를 구분해서 보여준다 (전자를 후자로
  // 가려버리면 예를 들어 DATABASE_URL 미설정 상태를 "글이 없다"로 오인하게 됨).
  const fetchError = data && !data.success ? data.error : null;

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="커뮤니티" />
        <div className="container">
          <div className={styles.headerTop}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>전체 {total}건</span>
            <Link href="/community/write" className={styles.writeBtn}>
              ✏️ 글쓰기
            </Link>
          </div>

          {isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : posts.length === 0 ? (
            <div className={styles.emptyState}>아직 작성된 글이 없습니다. 첫 글을 남겨보세요!</div>
          ) : (
            <div className={styles.list}>
              {posts.map((post: any) => (
                <Link key={post.id} href={`/community/${post.id}`} className={styles.row}>
                  {post.pinned && <span className={styles.pinBadge}>고정</span>}
                  <span className={styles.rowTitle}>
                    {post.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>[{post._count.comments}]</span>
                  </span>
                  <span className={styles.rowMeta}>
                    {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                    <span>{post.author.name}</span>
                    <span>{new Date(post.createdAt).toLocaleDateString('ko-KR')}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </button>
              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {page} / {totalPages}
              </span>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
