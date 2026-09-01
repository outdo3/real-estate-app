'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import ApartmentAutocomplete from '@/components/ApartmentAutocomplete';
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

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    if (queryAptName) {
      setAptName(queryAptName);
      setAptLocked(true);
    }
  }, []);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      setError('제목과 내용을 모두 입력해주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, aptName: aptName.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || '게시글을 작성하지 못했습니다.');
        return;
      }
      router.push(`/community/${json.data.id}`);
    } catch (e) {
      console.error(e);
      setError('게시글을 작성하지 못했습니다.');
    } finally {
      setSubmitting(false);
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
                <span>🏢 {aptName}</span>
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
            {error && <div className={styles.errorText}>⚠️ {error}</div>}
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => router.back()}>
                취소
              </button>
              <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
                {submitting ? '등록 중...' : '등록하기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
