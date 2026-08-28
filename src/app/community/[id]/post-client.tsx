'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import ShareAction from '@/components/ShareAction';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function PostDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const postId = params.id as string;

  const { data, isLoading, mutate } = useSWR(`/api/community/posts/${postId}`, fetcher);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const post = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : null;
  const isAdmin = session?.user?.role === 'ADMIN';
  const isOwner = session?.user?.id === post?.authorId;

  const handleDeletePost = async () => {
    if (!confirm('게시글을 삭제할까요? 되돌릴 수 없습니다.')) return;
    const res = await fetch(`/api/community/posts/${postId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      router.push('/community');
    } else {
      alert(json.error || '삭제하지 못했습니다.');
    }
  };

  const handleTogglePin = async () => {
    const res = await fetch(`/api/community/posts/${postId}/pin`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      mutate();
    } else {
      alert(json.error || '고정 상태를 변경하지 못했습니다.');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('댓글을 삭제할까요?')) return;
    const res = await fetch(`/api/community/comments/${commentId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      mutate();
    } else {
      alert(json.error || '삭제하지 못했습니다.');
    }
  };

  const handleSubmitComment = async () => {
    if (!comment.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: comment }),
      });
      const json = await res.json();
      if (json.success) {
        setComment('');
        mutate();
      } else {
        alert(json.error || '댓글을 작성하지 못했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="게시글" />
        <div className="container">
          {isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : !post ? (
            <div className={styles.emptyState}>게시글을 찾을 수 없습니다.</div>
          ) : (
            <>
              <div className={styles.postCard}>
                <div className={styles.postHeader}>
                  <div>
                    <h1 className={styles.postTitle}>
                      {post.pinned && '📌 '}
                      {post.title}
                    </h1>
                    <div className={styles.postMeta}>
                      {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                      <span>{post.author.name}</span>
                      <span>·</span>
                      <span>{new Date(post.createdAt).toLocaleString('ko-KR')}</span>
                      {post.aptName && (
                        <Link href={`/apt/${encodeURIComponent(post.aptName)}`} className={styles.aptBadge}>
                          🏢 {post.aptName}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className={styles.postActions}>
                    <ShareAction
                      variant="icon"
                      title={`${post.title} | 이집`}
                      text={post.aptName ? `${post.aptName} 관련 이집 커뮤니티 게시글` : '이집 커뮤니티 게시글'}
                    />
                    {isAdmin && (
                      <button className={styles.actionBtn} onClick={handleTogglePin}>
                        {post.pinned ? '고정 해제' : '상단 고정'}
                      </button>
                    )}
                    {(isOwner || isAdmin) && (
                      <button className={styles.dangerBtn} onClick={handleDeletePost}>
                        삭제
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.postContent}>{post.content}</div>
              </div>

              <div className={styles.commentSection}>
                <div className={styles.commentSectionTitle}>댓글 {post.comments.length}개</div>
                <div className={styles.commentList}>
                  {post.comments.length === 0 ? (
                    <div className={styles.emptyState}>첫 댓글을 남겨보세요.</div>
                  ) : (
                    post.comments.map((c: any) => (
                      <div key={c.id} className={styles.commentItem}>
                        <div className={styles.commentMeta}>
                          {c.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                          <span className={styles.commentAuthor}>{c.author.name}</span>
                          <span>{new Date(c.createdAt).toLocaleString('ko-KR')}</span>
                          {(session?.user?.id === c.authorId || isAdmin) && (
                            <button className={styles.commentDelete} onClick={() => handleDeleteComment(c.id)}>
                              삭제
                            </button>
                          )}
                        </div>
                        <div className={styles.commentContent}>{c.content}</div>
                      </div>
                    ))
                  )}
                </div>

                <div className={styles.commentForm}>
                  <input
                    className={styles.commentInput}
                    placeholder="댓글을 입력해주세요"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
                  />
                  <button className={styles.commentSubmit} onClick={handleSubmitComment} disabled={submitting}>
                    등록
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
