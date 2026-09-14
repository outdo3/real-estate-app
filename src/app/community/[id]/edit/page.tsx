'use client';

// COMMUNITY_EDITOR_V2 — 게시글 수정 화면. 글쓰기와 같은 블록 편집기를 쓴다.
// V2 글은 저장된 블록 그대로, V1 글은 서버 adapter가 만든 `[글, 사진…]` 순서로 불러온다(저장하면 그때 블록으로 저장).
// 권한은 서버(PATCH)가 최종 판정한다. 이 화면의 권한 표시는 세션의 isAdmin(서버 규칙: role 또는 ADMIN_EMAIL)과 작성자 여부로만 한다.
// 관련 단지는 수정할 수 없다(표시만).
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useSWRConfig } from 'swr';
import { AlertTriangle, ArrowLeft, Building2, RefreshCw } from 'lucide-react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import SimpleInlineComposer, { newBlockKey } from '@/components/community/SimpleInlineComposer';
import { editorBlocksFromViews, editorSnapshot, normalizeComposerBlocks, type EditorBlock } from '@/lib/community/block-editor-state';
import type { ContentBlockView } from '@/lib/community/content-blocks';
import { COMMUNITY_LIST_PATH, isMissingPostStatus, isPostDeleted, markPostDeleted } from '@/lib/community/deleted-post-navigation';
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

const noSubscribe = () => () => {};

export default function EditPostPage() {
  const params = useParams();
  const postId = params.id as string;
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { mutate } = useSWRConfig();

  const [post, setPost] = useState<EditablePostResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // COMMUNITY_DELETE_NAVIGATION_CLEANUP_V1 — 삭제됐거나 없는 글의 수정 주소는 "글 수정 / 게시글을 찾을 수 없습니다 / 다시 시도"
  // 같은 중간 화면 없이 바로 목록으로 간다. 이 탭에서 이미 삭제(404)를 확인한 글이면 요청도 하지 않는다.
  const knownDeleted = useSyncExternalStore(noSubscribe, () => isPostDeleted(postId), () => false);
  const [notFound, setNotFound] = useState(false);
  const missing = knownDeleted || notFound;

  useEffect(() => {
    if (!missing) return;
    markPostDeleted(postId);
    router.replace(COMMUNITY_LIST_PATH);
  }, [missing, postId, router]);

  // 모바일 BFCache로 수정 화면이 되살아나면 글이 아직 있는지만 확인한다(작성 중인 내용은 건드리지 않는다).
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (isPostDeleted(postId)) {
        setNotFound(true);
        return;
      }
      fetch(`/api/community/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' })
        .then((res) => {
          if (isMissingPostStatus(res.status)) setNotFound(true);
        })
        .catch(() => undefined);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [postId]);

  useEffect(() => {
    if (knownDeleted) return;
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/community/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' })
      .then((res) => {
        // 404만 "없는 글" — 목록으로. 통신 실패·500은 아래 오류·다시 시도 화면.
        if (isMissingPostStatus(res.status)) return { success: false, missing: true };
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (json?.missing) {
          setNotFound(true);
          return;
        }
        if (!json?.success) {
          setLoadError(json?.error || '게시글을 불러오지 못했습니다.');
          return;
        }
        const data = json.data as EditablePostResponse;
        // V2.1 — 작성기 모양(인접 글 합치기, 마지막 사진 뒤 이어 쓰기 칸)으로 맞춘 뒤 비교 스냅샷을 만든다.
        const initialBlocks: EditorBlock[] = normalizeComposerBlocks(editorBlocksFromViews(data.blocks ?? [], newBlockKey), newBlockKey);
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
  }, [postId, reloadKey, knownDeleted]);

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
      // 상세 화면은 SWR 캐시로 이 글을 기억하고 있다. 돌아가기 전에 캐시에 **저장된 최신 글을 직접 넣는다**.
      // (Production QA에서 두 번 확인: 데이터 없이 mutate(key)만 부르면 SWR은 "지금 마운트된" 훅만 재검증하는데
      //  수정 화면에서는 상세가 언마운트 상태라 캐시가 그대로 남고, 상세의 마운트 재검증은 requestAnimationFrame 뒤로 미뤄진다.)
      const detailKey = `/api/community/posts/${post.id}`;
      await mutate(
        detailKey,
        fetch(detailKey, { cache: 'no-store' }).then((res) => res.json()),
        { revalidate: false }
      ).catch(() => undefined);
      router.replace(`/community/${post.id}`);
      return;
    }
    setError(result.error);
    setSubmitting(false);
  };

  // 없는 글: 목록으로 이동하는 동안 헤더·오류 카드·로그인 창을 포함해 아무것도 그리지 않는다.
  if (missing) return null;

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
              <SimpleInlineComposer blocks={blocks} onBlocksChange={setBlocks} onError={setError} disabled={submitting} />
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
