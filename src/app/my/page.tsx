'use client';

import React from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

const ROLE_LABELS: Record<string, string> = {
  GUEST: '게스트',
  USER: '일반회원',
  VERIFIED: '인증회원',
  ADMIN: '관리자',
};

export default function MyPage() {
  const { data: session, status } = useSession();

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="마이페이지" />
        <div className="container">
          {status === 'loading' ? (
            <div className={styles.emptyCard}>불러오는 중입니다...</div>
          ) : !session ? (
            <div className={styles.emptyCard}>로그인이 필요한 페이지입니다.</div>
          ) : (
            <>
              <div className={styles.profileCard}>
                {session.user.image ? (
                  <img src={session.user.image} alt="" className={styles.avatar} />
                ) : (
                  <div className={styles.avatarFallback}>{(session.user.name || '?').slice(0, 1)}</div>
                )}
                <div>
                  <div className={styles.nickname}>
                    {session.user.name}
                    <span className={styles.roleBadge}>{ROLE_LABELS[session.user.role] || session.user.role}</span>
                  </div>
                  {session.user.email && <div className={styles.email}>{session.user.email}</div>}
                </div>
              </div>

              {session.user.role === 'ADMIN' && (
                <div className={styles.section}>
                  <Link href="/admin/dashboard" className={styles.linkCard}>
                    ⚙️ 관리자 대시보드
                  </Link>
                </div>
              )}

              <div className={styles.section}>
                <div className={styles.sectionTitle}>바로가기</div>
                <Link href="/community" className={styles.linkCard}>
                  💬 커뮤니티 둘러보기
                </Link>
                <Link href="/community/write" className={styles.linkCard}>
                  ✏️ 새 글 작성하기
                </Link>
                {session.user.role === 'ADMIN' && (
                  <Link href="/admin/users" className={styles.linkCard}>
                    🛡️ 회원 관리 (관리자)
                  </Link>
                )}
              </div>

              <button className={styles.logoutBtn} onClick={() => signOut({ callbackUrl: '/' })}>
                로그아웃
              </button>
            </>
          )}

          {/* 로그인 여부와 무관하게 항상 접근 가능해야 하는 정책 링크라 위 로그인 분기
              밖에 둔다. */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>약관 및 정책</div>
            <Link href="/terms" className={styles.linkCard}>
              📄 이용약관
            </Link>
            <Link href="/privacy" className={styles.linkCard}>
              🔒 개인정보처리방침
            </Link>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
