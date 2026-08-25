'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Heart } from 'lucide-react';
import LoginModal from './LoginModal';
import {
  type FavoriteInput,
  readPendingFavorite,
  writePendingFavorite,
  clearPendingFavorite,
  isPendingFavoriteValid,
} from '@/lib/favorites';
import styles from './FavoriteButton.module.css';

// AUTH/MY V1 — MY-2. 단지 상세(Hero)에 붙는 관심단지 찜 버튼. KakaoShareButton
// compact variant와 같은 자리에 나란히 놓이도록 크기/터치 타겟(44px)을 맞췄다.
//
// 비로그인 사용자가 클릭하면: 이 단지 정보를 sessionStorage에 잠시 저장해두고
// (DB에는 아직 아무것도 쓰지 않음) 로그인 팝업을 띄운다. 로그인이 성공해 세션이
// authenticated로 바뀌면, 저장해둔 의도가 "지금 보고 있는 단지"와 일치하고
// 오래되지 않았을 때만 자동으로 찜을 완료한다 — 다른 단지로 이동했거나 오래
// 방치된 의도까지 되살리지 않는다.
export default function FavoriteButton({ lawdCd, dong, name, aptSeq, address, compact }: FavoriteInput & { compact?: boolean }) {
  const { status } = useSession();
  const [favorited, setFavorited] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const autoCompleteAttempted = useRef(false);

  const identity: FavoriteInput = { lawdCd, dong, name, aptSeq, address };

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 3000);
  };

  // 로그인 상태에서 이 단지가 이미 찜돼 있는지 확인한다. V1 사용자 규모에서는
  // 전용 status 엔드포인트보다 목록을 한 번 불러와 매칭하는 쪽이 더 단순하고
  // 안전하다(추가 API 경로/쿼리 최적화 불필요) — 비로그인 사용자는 아예 요청하지
  // 않는다(불필요한 API 호출/로그인 강제 신호 방지).
  useEffect(() => {
    if (status !== 'authenticated') {
      if (status === 'unauthenticated') setFavorited(false);
      return;
    }

    let cancelled = false;

    async function syncFavoriteState() {
      try {
        const res = await fetch('/api/my/favorites');
        const json = await res.json();
        if (cancelled) return;
        if (!json.success) {
          setFavorited(false);
          return;
        }
        const matched = (json.data as FavoriteInput[]).some(
          (f) => f.lawdCd === lawdCd && f.dong === dong && f.name === name
        );
        setFavorited(matched);

        // 로그인 직후 복귀: 로그인 전 찜하려던 의도가 지금 단지와 일치하면 자동 완료.
        if (!matched && !autoCompleteAttempted.current) {
          autoCompleteAttempted.current = true;
          const pendingFavorite = readPendingFavorite();
          if (isPendingFavoriteValid(pendingFavorite, { lawdCd, dong, name })) {
            clearPendingFavorite();
            const created = await fetch('/api/my/favorites', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(identity),
            }).then((r) => r.json());
            if (!cancelled && created.success) setFavorited(true);
          }
        } else if (matched) {
          // 이미 찜된 상태로 돌아온 경우에도 남아있는 의도는 정리한다.
          const pendingFavorite = readPendingFavorite();
          if (isPendingFavoriteValid(pendingFavorite, { lawdCd, dong, name })) clearPendingFavorite();
        }
      } catch {
        if (!cancelled) setFavorited(false);
      }
    }

    syncFavoriteState();
    return () => {
      cancelled = true;
    };
  }, [status, lawdCd, dong, name]);

  const handleClick = async () => {
    if (pending) return;

    if (status !== 'authenticated') {
      writePendingFavorite(identity);
      setModalOpen(true);
      return;
    }

    const wasFavorited = !!favorited;
    setPending(true);
    setFavorited(!wasFavorited);

    try {
      const res = wasFavorited
        ? await fetch(
            `/api/my/favorites?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}&name=${encodeURIComponent(name)}`,
            { method: 'DELETE' }
          )
        : await fetch('/api/my/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(identity),
          });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'failed');
    } catch {
      setFavorited(wasFavorited);
      showError('관심단지를 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  };

  const isActive = !!favorited;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`${styles.btn} ${isActive ? styles.active : ''}`}
        aria-pressed={isActive}
        aria-label={isActive ? '관심단지 해제' : '관심단지 저장'}
        title={isActive ? '관심단지 해제' : '관심단지 저장'}
      >
        <Heart className={styles.icon} aria-hidden="true" fill={isActive ? 'currentColor' : 'none'} />
        {!compact && (isActive ? '관심단지' : '관심단지 저장')}
      </button>
      {error && <div className={styles.errorToast}>{error}</div>}
      <LoginModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
