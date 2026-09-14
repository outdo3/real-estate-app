'use client';

// COMMUNITY_EDITOR_V2 — 게시글 수정 화면. 글쓰기와 같은 블록 편집기를 쓴다.
// V2 글은 저장된 블록 그대로, V1 글은 서버 adapter가 만든 `[글, 사진…]` 순서로 불러온다(저장하면 그때 블록으로 저장).
// 권한은 서버(PATCH)가 최종 판정한다. 이 화면의 권한 표시는 세션의 isAdmin(서버 규칙: role 또는 ADMIN_EMAIL)과 작성자 여부로만 한다.
// 관련 단지는 수정할 수 없다(표시만).
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AlertTriangle, ArrowLeft, Building2, RefreshCw } from 'lucide-react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import CommunityBlockEditor, { newBlockKey } from '@/components/community/CommunityBlockEditor';
import { editorBlocksFromViews, editorSnapshot, type EditorBlock } from '@/lib/community/block-editor-state';
import type { ContentBlockView } from '@/lib/community/content-blocks';
import { submitBlockPost } from '@/lib/community/submit-block-post';
import { useLeaveGuard } from '@/lib/community/use-leave-guard';
import styles from '../../write/page.module.css';

interface EditablePostResponse {
  id: string;
  title: string;
  aptName: string | null;
  authorId: string;
  updatedAt: string;
  blocks: ContentBlockView[];
}

export default function EditPostPage() {
  const params = useParams();
  const postId = params.id as string;
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [post, setPost] = useState<EditablePostResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/community/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json?.success) {
          setLoadError(json?.error || '게시글을 불러오지 못했습니다.');
          return;
        }
        const data = json.data as EditablePostResponse;
        const loaded = editorBlocksFromViews(data.blocks ?? [], newBlockKey);
        const initialBlocks: EditorBlock[] = loaded.length > 0 ? loaded : [{ key: newBlockKey(), kind: 'text', text: '' }];
        setPost(data);
        setTitle(data.title);
        setBlocks(initialBlocks);
        setInitialSnapshot(editorSnapshot(data.title, initialBlocks));
      })
      .catch(() => {
        if (!cancelled) setLoadError('게시글을 불러오지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [postId, reloadKey]);

  const canEdit = !!post && (session?.user?.id === post.authorId || session?.user?.isAdmin === true);
  const dirty = useMemo(() => initialSnapshot !== null && editorSnapshot(title, blocks) !== initialSnapshot, [title, blocks, initialSnapshot]);
  const { release, requestLeave } = useLeaveGuard(dirty || submitting);

  const handleSave = async () => {
    if (submitting || !post) return;
    setSubmitting(true);
    setError(null);
    const result = await submitBlockPost({ mode: 'edit', postId: post.id, title, expectedUpdatedAt: post.updatedAt, blocks, onStatus: setStatus });
    if (result.ok) {
      release();
      router.replace(`/community/${post.id}`);
      return;
    }
    setError(result.error);
    setSubmitting(false);
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="글 수정" />
        <div className="container">
          {loadError ? (
            <div className={styles.errorText} role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              {loadError}
              <button type="button" className={styles.cancelBtn} onClick={() => setReloadKey((k) => k + 1)}>
                <RefreshCw size={14} aria-hidden="true" /> 다시 시도
              </button>
            </div>
          ) : !post || sessionStatus === 'loading' ? (
            <p className={styles.uploadStatus} role="status">
              불러오는 중입니다...
            </p>
          ) : !canEdit ? (
            <div className={styles.errorText} role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              수정 권한이 없습니다.
              <Link href={`/community/${post.id}`}>
                <ArrowLeft size={14} aria-hidden="true" /> 게시글로 돌아가기
              </Link>
            </div>
          ) : (
            <div className={styles.form}>
              {post.aptName && (
                <div className={styles.aptChip} aria-label="관련 단지(수정할 수 없음)">
                  <span className={styles.aptChipLabel}>
                    <Building2 size={13} aria-hidden="true" />
                    {post.aptName}
                  </span>
                </div>
              )}
              <input
                className={styles.titleInput}
                placeholder="제목을 입력해주세요"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                aria-label="제목"
              />
              <CommunityBlockEditor blocks={blocks} onBlocksChange={setBlocks} onError={setError} disabled={submitting} />
              {status && (
                <p className={styles.uploadStatus} role="status" aria-live="polite">
                  {status}
                </p>
              )}
              {error && (
                <div className={styles.errorText} role="alert">
                  <AlertTriangle size={15} aria-hidden="true" />
                  {error}
                </div>
              )}
              <div className={styles.actions}>
                <button className={styles.cancelBtn} onClick={() => requestLeave(() => router.back())} disabled={submitting}>
                  취소
                </button>
                <button className={styles.submitBtn} onClick={handleSave} disabled={submitting || !dirty}>
                  {submitting ? '저장 중...' : '저장하기'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
