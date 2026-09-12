'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Building2, Pin, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
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

  // §3/§16 — SWR의 error도 본다. 예전에는 fetch 자체가 실패하면(오프라인 등)
  // data가 undefined로 남아 "게시글을 찾을 수 없습니다"가 떴다 — 연결 실패를
  // 글이 없는 것으로 말하는 false empty다. 404와 통신 실패는 다른 상태다.
  const { data, isLoading, error: swrError, mutate } = useSWR(`/api/community/posts/${postId}`, fetcher);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // §7/§8 — 진행 중 중복 실행 방지. 예전에는 삭제에 in-flight 상태가 없어
  // 연타하면 같은 요청이 여러 번 나갔다.
  const [deletingPost, setDeletingPost] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const post = data?.success ? data.data : null;
  const fetchError = swrError ? '게시글을 불러오지 못했습니다.' : data && !data.success ? data.error : null;
  const isAdmin = session?.user?.role === 'ADMIN';
  const isOwner = session?.user?.id === post?.authorId;

  const handleDeletePost = async () => {
    if (deletingPost) return;
    if (!confirm('게시글을 삭제할까요? 되돌릴 수 없습니다.')) return;
    setDeletingPost(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/community/posts/${postId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        router.push('/community');
        return;
      }
      setActionError(json.error || '삭제하지 못했습니다.');
    } catch {
      setActionError('삭제하지 못했습니다.');
    } finally {
      setDeletingPost(false);
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
    if (deletingCommentId) return;
    if (!confirm('댓글을 삭제할까요?')) return;
    setDeletingCommentId(commentId);
    setActionError(null);
    try {
      const res = await fetch(`/api/community/comments/${commentId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        mutate();
        return;
      }
      setActionError(json.error || '삭제하지 못했습니다.');
    } catch {
      setActionError('삭제하지 못했습니다.');
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleSubmitComment = async () => {
    // §8 — Enter 연타로 같은 댓글이 여러 번 올라가지 않게 한다. 버튼은 disabled로
    // 막히지만 키보드 경로에는 가드가 없었다.
    if (submitting || !comment.trim()) return;
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
        setActionError(null);
        mutate();
      } else {
        setActionError(json.error || '댓글을 작성하지 못했습니다.');
      }
    } catch {
      setActionError('댓글을 작성하지 못했습니다.');
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
            <div className={styles.emptyState} role="status">불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{fetchError}</span>
              <button type="button" className={styles.retryBtn} onClick={() => mutate()}>
                <RefreshCw size={14} aria-hidden="true" />
                다시 시도
              </button>
            </div>
          ) : !post ? (
            <div className={styles.emptyState}>
              <span>게시글을 찾을 수 없습니다.</span>
              <Link href="/community" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                커뮤니티로 돌아가기
              </Link>
            </div>
          ) : (
            <>
              <div className={styles.postCard}>
                <div className={styles.postHeader}>
                  <div>
                    <h1 className={styles.postTitle}>
                      {post.pinned && <Pin size={16} aria-label="고정된 글" className={styles.pinIcon} />}
                      {post.title}
                    </h1>
                    <div className={styles.postMeta}>
                      {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                      <span>{post.author.name}</span>
                      <span>·</span>
                      <span>{new Date(post.createdAt).toLocaleString('ko-KR')}</span>
                      {post.aptName && (
                        // LAUNCH_TRUST_BLOCKERS_V1 — 게시글의 aptName은 자유 텍스트(또는
                        // 과거에 자유 텍스트로 저장된 값)라 lawdCd/dong이 없다. 예전처럼
                        // /apt/[name]으로 바로 링크하면 동명의 다른 단지로 잘못 연결될
                        // 위험이 있어(AGENTS.md "이름만으로 재식별 금지"), 클릭 가능한
                        // 링크가 아닌 라벨로만 표시한다.
                        <span className={styles.aptBadge}>
                          <Building2 size={12} aria-hidden="true" />
                          {post.aptName}
                        </span>
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
                      <button className={styles.dangerBtn} onClick={handleDeletePost} disabled={deletingPost}>
                        {deletingPost ? '삭제 중...' : '삭제'}
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.postContent}>{post.content}</div>
                {actionError && (
                  <p className={styles.actionError} role="alert">{actionError}</p>
                )}
              </div>

              {/* §5 — 상세에서 목록으로 돌아가는 경로. 브라우저 뒤로가기에만 의존하면
                  공유 링크로 바로 들어온 사용자는 나갈 길이 없다. */}
              <Link href="/community" className={styles.backLink}>
                <ArrowLeft size={15} aria-hidden="true" />
                커뮤니티 목록
              </Link>

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
                            <button
                              className={styles.commentDelete}
                              onClick={() => handleDeleteComment(c.id)}
                              disabled={deletingCommentId === c.id}
                            >
                              {deletingCommentId === c.id ? '삭제 중...' : '삭제'}
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
                    aria-label="댓글 내용"
                    disabled={submitting}
                  />
                  <button
                    className={styles.commentSubmit}
                    onClick={handleSubmitComment}
                    disabled={submitting || !comment.trim()}
                  >
                    {submitting ? '등록 중...' : '등록'}
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
