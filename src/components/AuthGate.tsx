'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import LoginModal from './LoginModal';

// 마이페이지/커뮤니티 등 로그인이 필요한 구역에 붙이는 래퍼. 비로그인 상태로
// 진입하면 즉시 간편 로그인 팝업을 띄운다. 배경 콘텐츠는 그대로 두어(커뮤니티
// 글 목록처럼 비로그인 상태로도 열람 가능한 화면일 수 있으므로) 모달을 닫고
// 둘러볼 수도 있게 한다.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      setModalOpen(true);
    }
  }, [status]);

  return (
    <>
      {children}
      <LoginModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
