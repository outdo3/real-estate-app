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
        <p className={styles.subtitle}>소셜 계정으로 1초 만에 시작하세요.</p>

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

        <button
          className={`${styles.socialBtn} ${styles.googleBtn}`}
          onClick={() => signIn('google', { callbackUrl: resolvedCallbackUrl })}
        >
          <span className={styles.socialIcon}>
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </span>
          Google로 계속하기
        </button>
      </div>
    </div>
  );
}
