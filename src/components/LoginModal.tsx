'use client';

import React from 'react';
import { signIn } from 'next-auth/react';
import styles from './LoginModal.module.css';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  /** 로그인 완료 후 돌아올 경로. 기본값은 현재 페이지. */
  callbackUrl?: string;
}

// 마이페이지/커뮤니티 진입 시 뜨는 간편 로그인 팝업. 버튼 클릭 시 곧바로 해당
// 서비스의 OAuth 동의 화면으로 이동한다(별도 로그인 페이지를 거치지 않음).
export default function LoginModal({ open, onClose, callbackUrl }: LoginModalProps) {
  if (!open) return null;

  const resolvedCallbackUrl = callbackUrl || (typeof window !== 'undefined' ? window.location.href : undefined);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="닫기">
          ×
        </button>
        <div className={styles.title}>간편 로그인</div>
        <p className={styles.subtitle}>카카오 또는 네이버 계정으로 1초 만에 시작하세요.</p>

        <button
          className={`${styles.socialBtn} ${styles.kakaoBtn}`}
          onClick={() => signIn('kakao', { callbackUrl: resolvedCallbackUrl })}
        >
          <span className={styles.socialIcon}>💬</span>
          카카오로 시작하기
        </button>

        <button
          className={`${styles.socialBtn} ${styles.naverBtn}`}
          onClick={() => signIn('naver', { callbackUrl: resolvedCallbackUrl })}
        >
          <span className={styles.socialIcon}>N</span>
          네이버로 시작하기
        </button>
      </div>
    </div>
  );
}
