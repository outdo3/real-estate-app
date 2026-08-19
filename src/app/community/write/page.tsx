'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

export default function WritePostPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [aptName, setAptName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    if (queryAptName) setAptName(queryAptName);
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
            <input
              className={styles.aptNameInput}
              placeholder="단지명 (선택, 예: 래미안 강남포레스트)"
              value={aptName}
              onChange={(e) => setAptName(e.target.value)}
              maxLength={100}
            />
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
