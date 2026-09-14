'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Building2 } from 'lucide-react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import ApartmentAutocomplete from '@/components/ApartmentAutocomplete';
import CommunityImagePicker, { type PickedImage } from '@/components/community/CommunityImagePicker';
import { IMAGE_ERROR_MESSAGES } from '@/lib/community/image-rules';
import styles from './page.module.css';

const APT_INPUT_STYLE: React.CSSProperties = {
  padding: '0.6rem 0.85rem',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  fontSize: '0.85rem',
  color: 'var(--text-secondary)',
  width: '100%',
};

export default function WritePostPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [aptName, setAptName] = useState('');
  // LAUNCH_TRUST_BLOCKERS_V1 — 단지 상세페이지("글쓰기" 링크)에서 이미 확정된
  // 단지명으로 들어온 경우에는 그 컨텍스트를 그대로 신뢰해 잠금 표시만 하고,
  // 그 외(커뮤니티 목록에서 바로 "글쓰기")에는 자유 텍스트 대신 아래
  // ApartmentAutocomplete로만 단지를 고르게 한다 — free text → 이름만으로
  // 상세 진입 시 동명 단지 오식별 위험을 막기 위함(AGENTS.md "이름만으로
  // 재식별 금지"). DB에 lawdCd/dong 저장 컬럼이 없어(schema 변경 없이 이번
  // STEP 범위) 여전히 이름 문자열만 저장되지만, 최소한 실제로 존재하는
  // 정확한 단지명만 저장되도록 보장한다.
  const [aptLocked, setAptLocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    if (queryAptName) {
      setAptName(queryAptName);
      setAptLocked(true);
    }
  }, []);

  // COMMUNITY_IMAGE_UPLOAD_V1 — 등록 중에 창을 닫거나 뒤로 가면 확인을 받는다(업로드가 끊기면 글이 저장되지 않는다).
  useEffect(() => {
    if (!submitting) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [submitting]);

  const cleanupUploadSession = async (sessionId: string | null) => {
    if (!sessionId) return;
    try {
      await fetch(`/api/community/images?session=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    } catch {
      // 서버가 이미 정리했거나 네트워크 오류 — 서버 로그(orphan)로 추적된다.
    }
  };

  const handleSubmit = async () => {
    // §6 — 중복 제출 방지. 버튼 disabled가 1차 방어지만 가드를 한 겹 더 둔다.
    if (submitting) return;
    if (!title.trim() || !content.trim()) {
      setError('제목과 내용을 모두 입력해주세요.');
      return;
    }
    if (images.some((img) => img.status === 'processing')) {
      setError('사진을 준비하고 있어요. 잠시 후 다시 눌러주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    // 사진이 있으면: 전부 순차 업로드 성공 → 그 영수증으로 글 생성. 하나라도 실패하면 글을 만들지 않고 올린 사진을 지운다.
    const ready = images.filter((img) => img.prepared);
    const sessionId = ready.length > 0 ? crypto.randomUUID() : null;
    try {
      const imageTokens: { token: string }[] = [];
      for (let i = 0; i < ready.length; i++) {
        setUploadStatus(`사진을 업로드하고 있어요 (${i + 1}/${ready.length})`);
        const prepared = ready[i].prepared!;
        const res = await fetch(`/api/community/images?session=${encodeURIComponent(sessionId!)}`, {
          method: 'POST',
          headers: { 'Content-Type': prepared.mimeType },
          body: prepared.blob,
        });
        const json = await res.json().catch(() => null);
        if (!json?.success) {
          await cleanupUploadSession(sessionId);
          setError(json?.error || IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
          return;
        }
        imageTokens.push({ token: json.data.token });
      }
      setUploadStatus(ready.length > 0 ? '게시글을 등록하고 있어요' : null);

      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, aptName: aptName.trim() || undefined, ...(imageTokens.length > 0 && { images: imageTokens }) }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) {
        await cleanupUploadSession(sessionId);
        setError(json?.error || '게시글을 작성하지 못했습니다.');
        return;
      }
      router.push(`/community/${json.data.id}`);
    } catch (e) {
      console.error(e);
      await cleanupUploadSession(sessionId);
      setError(sessionId ? IMAGE_ERROR_MESSAGES.UPLOAD_FAILED : '게시글을 작성하지 못했습니다.');
    } finally {
      setSubmitting(false);
      setUploadStatus(null);
    }
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="글쓰기" />
        <div className="container">
          <div className={styles.writeIntro}>
            <img src="/brand/mascot/ejipy-guide.webp" alt="" className={styles.writeIntroMascot} />
            <span>이집에서 살아본 이야기를 들려주세요.</span>
          </div>
          <div className={styles.form}>
            {aptName ? (
              <div className={styles.aptChip}>
                <span className={styles.aptChipLabel}>
                  <Building2 size={13} aria-hidden="true" />
                  {aptName}
                </span>
                {!aptLocked && (
                  <button
                    type="button"
                    className={styles.aptChipRemove}
                    onClick={() => setAptName('')}
                    aria-label="단지 선택 해제"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <ApartmentAutocomplete
                onSelect={(result) => setAptName(result.name)}
                placeholder="관련 단지 검색 (선택, 예: 래미안 강남포레스트)"
                inputStyle={APT_INPUT_STYLE}
              />
            )}
            <input
              className={styles.titleInput}
              placeholder="제목을 입력해주세요"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
            <textarea
              className={styles.contentInput}
              placeholder="내용을 입력해주세요"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <CommunityImagePicker images={images} onImagesChange={setImages} onError={setError} disabled={submitting} />
            {uploadStatus && (
              <p className={styles.uploadStatus} role="status" aria-live="polite">
                {uploadStatus}
              </p>
            )}
            {error && (
              <div className={styles.errorText} role="alert">
                <AlertTriangle size={15} aria-hidden="true" />
                {error}
              </div>
            )}
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => router.back()} disabled={submitting}>
                취소
              </button>
              <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
                {submitting ? (images.length > 0 ? '업로드 중...' : '등록 중...') : '등록하기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
