'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import LoginModal from './LoginModal';
import styles from './Header.module.css';

// 헤더 우측 끝에 항상 떠 있는 로그인/프로필 버튼.
// 비로그인: 클릭 시 간편 로그인 모달. 로그인: 아바타 클릭 시 마이페이지로 이동.
export default function HeaderAuthButton() {
  const { data: session, status } = useSession();
  const [modalOpen, setModalOpen] = useState(false);

  if (status === 'loading') {
    return <div className={styles.authButtonSkeleton} />;
  }

  if (!session) {
    return (
      <>
        <button className={styles.loginTrigger} onClick={() => setModalOpen(true)}>
          로그인
        </button>
        <LoginModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  return (
    <Link href="/my" className={styles.avatarLink} aria-label="마이페이지">
      {session.user.image ? (
        <img src={session.user.image} alt="" className={styles.avatarImg} />
      ) : (
        <span className={styles.avatarFallback}>{(session.user.name || '?').slice(0, 1)}</span>
      )}
    </Link>
  );
}
