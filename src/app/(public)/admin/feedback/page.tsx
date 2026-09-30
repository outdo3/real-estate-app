'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@/lib/feedback/feedback-rules';
import { formatKst } from '@/lib/feedback/feedback-email';
import styles from './page.module.css';

// USER_FEEDBACK_V1 — 관리자 의견 목록. 페이지 노출은 세션 isAdmin(UI용), 데이터는 API의 requireAdmin()이 지킨다.
// /admin/* 전체는 proxy에서도 막힌다.

interface AdminFeedbackItem {
  id: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  message: string;
  loggedIn: boolean;
  pagePath: string | null;
  pageQuery: string | null;
  aptSeq: string | null;
  apartmentName: string | null;
  lawdCd: string | null;
  userAgent: string | null;
  notifiedAt: string | null;
  adminNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const kst = (iso: string | null) => (iso ? formatKst(new Date(iso)) : '-');

export default function AdminFeedbackPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.isAdmin === true;

  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | ''>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const qs = new URLSearchParams({ page: String(page) });
  if (statusFilter) qs.set('status', statusFilter);
  if (categoryFilter) qs.set('category', categoryFilter);
  const { data, isLoading, mutate } = useSWR(isAdmin ? `/api/admin/feedback?${qs.toString()}` : null, fetcher);
  const items: AdminFeedbackItem[] = data?.success ? data.data.items : [];
  const total: number = data?.success ? data.data.total : 0;
  const pageSize: number = data?.success ? data.data.pageSize : 30;
  const fetchError = data && !data.success ? data.error : null;

  const save = async (item: AdminFeedbackItem, nextStatus: FeedbackStatus) => {
    setSavingId(item.id);
    setActionError(null);
    try {
      const body: Record<string, unknown> = { status: nextStatus };
      if (noteDrafts[item.id] !== undefined) body.adminNote = noteDrafts[item.id];
      const res = await fetch(`/api/admin/feedback/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setActionError(json?.error ?? '상태를 변경하지 못했습니다.');
        return;
      }
      await mutate();
    } catch {
      setActionError('상태를 변경하지 못했습니다.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="사용자 의견" />
        <div className="container">
          {status === 'loading' ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : !isAdmin ? (
            <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
          ) : (
            <>
              <div className={styles.filters}>
                <label className={styles.filter}>
                  <span>상태</span>
                  <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as FeedbackStatus | ''); setPage(1); }}>
                    <option value="">전체</option>
                    {FEEDBACK_STATUSES.map((s) => (
                      <option key={s} value={s}>{FEEDBACK_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.filter}>
                  <span>유형</span>
                  <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value as FeedbackCategory | ''); setPage(1); }}>
                    <option value="">전체</option>
                    {FEEDBACK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{FEEDBACK_CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </label>
                <span className={styles.total}>{data?.success ? `${total.toLocaleString('ko-KR')}건` : ''}</span>
              </div>

              {actionError && <p className={styles.actionError} role="alert">{actionError}</p>}

              {isLoading ? (
                <div className={styles.emptyState}>불러오는 중입니다...</div>
              ) : fetchError ? (
                <div className={styles.emptyState}>{fetchError}</div>
              ) : items.length === 0 ? (
                <div className={styles.emptyState}>조건에 맞는 의견이 없습니다.</div>
              ) : (
                <ul className={styles.list}>
                  {items.map((item) => {
                    const open = openId === item.id;
                    return (
                      <li key={item.id} className={styles.item}>
                        <button type="button" className={styles.summary} aria-expanded={open} onClick={() => setOpenId(open ? null : item.id)}>
                          <span className={styles.metaRow}>
                            <span className={`${styles.badge} ${styles[`status_${item.status}`]}`}>{FEEDBACK_STATUS_LABELS[item.status]}</span>
                            <span className={styles.badge}>{FEEDBACK_CATEGORY_LABELS[item.category]}</span>
                            <span className={styles.muted}>{item.loggedIn ? '로그인' : '비로그인'}</span>
                            <span className={styles.muted}>{kst(item.createdAt)}</span>
                          </span>
                          <span className={styles.preview}>{item.message}</span>
                          <span className={styles.contextRow}>
                            <span>{item.pagePath ?? '페이지 정보 없음'}</span>
                            {item.apartmentName && <span>· {item.apartmentName}</span>}
                            {!item.notifiedAt && <span className={styles.warn}>· 메일 알림 없음</span>}
                          </span>
                        </button>
                        {open && (
                          <div className={styles.detail}>
                            <p className={styles.fullMessage}>{item.message}</p>
                            <dl className={styles.dl}>
                              <dt>단지</dt><dd>{item.aptSeq ? `${item.apartmentName ?? ''} (${item.aptSeq})` : '-'}</dd>
                              <dt>시군구 코드</dt><dd>{item.lawdCd ?? '-'}</dd>
                              <dt>페이지</dt><dd>{item.pagePath ?? '-'}</dd>
                              <dt>쿼리(허용 키)</dt><dd>{item.pageQuery ?? '-'}</dd>
                              <dt>User agent</dt><dd className={styles.ua}>{item.userAgent ?? '-'}</dd>
                              <dt>접수</dt><dd>{kst(item.createdAt)}</dd>
                              <dt>메일 알림</dt><dd>{kst(item.notifiedAt)}</dd>
                              <dt>완료</dt><dd>{kst(item.resolvedAt)}</dd>
                              <dt>수정</dt><dd>{kst(item.updatedAt)}</dd>
                            </dl>
                            <label className={styles.noteLabel} htmlFor={`note-${item.id}`}>운영 메모</label>
                            <textarea
                              id={`note-${item.id}`}
                              className={styles.note}
                              value={noteDrafts[item.id] ?? item.adminNote ?? ''}
                              maxLength={2000}
                              rows={3}
                              onChange={(e) => setNoteDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                            />
                            <div className={styles.statusButtons} role="group" aria-label="상태 변경">
                              {FEEDBACK_STATUSES.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  className={styles.statusBtn}
                                  aria-pressed={item.status === s}
                                  disabled={savingId === item.id}
                                  onClick={() => save(item, s)}
                                >
                                  {FEEDBACK_STATUS_LABELS[s]}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {total > pageSize && (
                <div className={styles.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>이전</button>
                  <span>{page} / {Math.ceil(total / pageSize)}</span>
                  <button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)}>다음</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
