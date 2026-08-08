'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

const ROLE_LABELS: Record<string, string> = {
  GUEST: '게스트',
  USER: '일반회원',
  VERIFIED: '인증회원',
  ADMIN: '관리자',
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  const { data, isLoading, mutate } = useSWR(isAdmin ? '/api/admin/users' : null, fetcher);
  const users = data?.success ? data.data.users : [];
  const fetchError = data && !data.success ? data.error : null;

  const handleToggleBan = async (id: string) => {
    const res = await fetch(`/api/admin/users/${id}/ban`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      mutate();
    } else {
      alert(json.error || '처리하지 못했습니다.');
    }
  };

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="회원 관리" />
        <div className="container">
          {status === 'loading' ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : !isAdmin ? (
            <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
          ) : isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : (
            <div className={styles.list}>
              {users.map((u: any) => (
                <div key={u.id} className={styles.row}>
                  {u.image ? (
                    <img src={u.image} alt="" className={styles.avatar} />
                  ) : (
                    <div className={styles.avatarFallback}>{(u.name || '?').slice(0, 1)}</div>
                  )}
                  <div className={styles.info}>
                    <div className={styles.nickname}>
                      {u.name}
                      <span className={styles.roleBadge}>{ROLE_LABELS[u.role] || u.role}</span>
                      {u.banned && <span className={styles.bannedBadge}>강퇴됨</span>}
                    </div>
                    {u.email && <div className={styles.email}>{u.email}</div>}
                  </div>
                  {u.role !== 'ADMIN' && u.id !== session?.user?.id && (
                    <button
                      className={u.banned ? styles.unbanBtn : styles.banBtn}
                      onClick={() => handleToggleBan(u.id)}
                    >
                      {u.banned ? '강퇴 해제' : '강퇴'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
