'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import Header from '@/components/Header';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_COPY,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  sanitizePagePath,
  type FeedbackCategory,
} from '@/lib/feedback/feedback-rules';
import { trackFeedbackOpen, trackFeedbackSubmit } from '@/lib/analytics/track-feedback';
import styles from './page.module.css';

// USER_FEEDBACK_V1 — 의견 보내기 폼.
// 발생 화면(from)은 이 화면을 연 곳이 넘긴 앱 내부 경로다. 서버가 경로·허용 쿼리만 다시 정리하고,
// 단지(aptSeq)는 후보일 뿐 서버가 master로 정확히 확인한 경우에만 저장한다.
export default function FeedbackClient() {
  const searchParams = useSearchParams();
  const fromRaw = searchParams.get('from');
  const from = fromRaw && sanitizePagePath(fromRaw) ? fromRaw : null;
  const candidateAptSeq = searchParams.get('aptSeq');

  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    trackFeedbackOpen();
  }, []);

  const trimmedLength = message.trim().length;
  const canSubmit = !!category && trimmedLength >= FEEDBACK_MESSAGE_MIN && message.length <= FEEDBACK_MESSAGE_MAX && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) {
      setError(FEEDBACK_COPY.categoryRequired);
      return;
    }
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const [fromPath, fromQuery] = from ? [from.split(/[?#]/)[0], from.includes('?') ? from.slice(from.indexOf('?') + 1).split('#')[0] : null] : [null, null];
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, message, pagePath: fromPath ?? '/feedback', pageQuery: fromQuery, aptSeq: candidateAptSeq }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (res.status === 201 && json?.success) {
        trackFeedbackSubmit(category);
        setDone(true);
        return;
      }
      setError(res.status === 429 || res.status === 400 ? json?.error ?? FEEDBACK_COPY.failure : FEEDBACK_COPY.failure);
    } catch {
      setError(FEEDBACK_COPY.failure);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.main}>
      <Header pageTitle={FEEDBACK_COPY.title} />
      <div className="container">
        {done ? (
          <section className={styles.doneCard} role="status">
            <CheckCircle2 size={36} className={styles.doneIcon} aria-hidden="true" />
            <p className={styles.doneTitle}>{FEEDBACK_COPY.success}</p>
            <p className={styles.doneText}>보내주신 내용은 운영자가 확인한 뒤 서비스 개선에 반영할게요.</p>
            <Link href={from && from.startsWith('/') ? from : '/my'} className={styles.secondaryBtn}>
              이전 화면으로 돌아가기
            </Link>
          </section>
        ) : (
          <form className={styles.card} onSubmit={handleSubmit} noValidate>
            <h1 className={styles.title}>{FEEDBACK_COPY.title}</h1>
            <p className={styles.description}>{FEEDBACK_COPY.description}</p>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>의견 유형</legend>
              <div className={styles.categoryGrid} role="radiogroup" aria-label="의견 유형">
                {FEEDBACK_CATEGORIES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={category === key}
                    className={styles.categoryBtn}
                    onClick={() => {
                      setCategory(key);
                      setError(null);
                    }}
                  >
                    {FEEDBACK_CATEGORY_LABELS[key]}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className={styles.label} htmlFor="feedback-message">
              내용
            </label>
            <textarea
              id="feedback-message"
              className={styles.textarea}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
              placeholder={FEEDBACK_COPY.placeholder}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={8}
              aria-describedby="feedback-counter"
            />
            <div id="feedback-counter" className={styles.counter}>
              <span>{trimmedLength > 0 && trimmedLength < FEEDBACK_MESSAGE_MIN ? FEEDBACK_COPY.tooShort : '개인정보(연락처 등)는 적지 말아 주세요.'}</span>
              <span>
                {message.length.toLocaleString('ko-KR')}/{FEEDBACK_MESSAGE_MAX.toLocaleString('ko-KR')}
              </span>
            </div>

            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}

            <button type="submit" className={styles.submitBtn} disabled={!canSubmit} aria-busy={submitting}>
              {submitting ? '보내는 중...' : FEEDBACK_COPY.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
