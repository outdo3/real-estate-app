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
import { trackEvent } from '@/lib/analytics/trackEvent';
import styles from './FavoriteButton.module.css';

// AUTH/MY V1 — MY-2. 단지 상세(Hero)에 붙는 관심단지 찜 버튼. KakaoShareButton
// compact variant와 같은 자리에 나란히 놓이도록 크기/터치 타겟(44px)을 맞췄다.
//
// 비로그인 사용자가 클릭하면: 이 단지 정보를 sessionStorage에 잠시 저장해두고
// (DB에는 아직 아무것도 쓰지 않음) 로그인 팝업을 띄운다. 로그인이 성공해 세션이
// authenticated로 바뀌면, 저장해둔 의도가 "지금 보고 있는 단지"와 일치하고
// 오래되지 않았을 때만 자동으로 찜을 완료한다 — 다른 단지로 이동했거나 오래
// 방치된 의도까지 되살리지 않는다.
// APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX §12 — 같은 페이지에 이 버튼이 두 번(Hero
// 상단 + 하단 3-action row) 마운트될 수 있다. 각 인스턴스가 독립된 useState라 한쪽에서
// 토글해도 다른 쪽은 자동으로 갱신되지 않는 문제가 있었다 — 새 favorite API/상태 저장소를
// 만들지 않고, 같은 탭 안의 다른 인스턴스에게만 "방금 이 식별자의 상태가 바뀌었다"는
// 사실을 알리는 최소한의 브라우저 네이티브 이벤트만 추가한다(서버 호출/판정 로직은 전혀
// 바뀌지 않음).
const FAVORITE_CHANGED_EVENT = 'ejip:favorite-changed';
type FavoriteChangedDetail = FavoriteInput & { favorited: boolean };

function broadcastFavoriteChanged(identity: FavoriteInput, favorited: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<FavoriteChangedDetail>(FAVORITE_CHANGED_EVENT, { detail: { ...identity, favorited } })
  );
}

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
            if (!cancelled && created.success) {
              setFavorited(true);
              broadcastFavoriteChanged(identity, true);
            }
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

  // 같은 탭의 다른 FavoriteButton 인스턴스(예: Hero 상단)가 이 단지의 상태를 바꾸면
  // 즉시 반영한다 — 식별자(lawdCd/dong/name)가 정확히 일치할 때만.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FavoriteChangedDetail>).detail;
      if (!detail) return;
      if (detail.lawdCd === lawdCd && detail.dong === dong && detail.name === name) {
        setFavorited(detail.favorited);
      }
    };
    window.addEventListener(FAVORITE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(FAVORITE_CHANGED_EVENT, handler);
  }, [lawdCd, dong, name]);

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
    broadcastFavoriteChanged(identity, !wasFavorited);

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
      // ANALYTICS V1 — 서버가 성공을 확인해준 시점에만 기록한다(낙관적 업데이트 시점이 아님).
      trackEvent(wasFavorited ? 'favorite_remove' : 'favorite_add', {
        complexId: `${lawdCd}|${dong}|${name}`,
        aptName: name,
      });
    } catch {
      setFavorited(wasFavorited);
      broadcastFavoriteChanged(identity, wasFavorited);
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
        {/* APT DETAIL CONSISTENCY HOTFIX V1 §16 — 등록 상태는 아이콘 fill(위)로만
            표현한다. 문구 길이로 상태를 표현하면(예: "관심단지"/"관심단지 저장")
            찜 여부에 따라 버튼 폭이 달라져 StickyActionBar의 3-action 레이아웃이
            깨진다 — 텍스트는 상태와 무관하게 항상 "관심단지"로 고정한다. */}
        {!compact && '관심단지'}
      </button>
      {error && <div className={styles.errorToast}>{error}</div>}
      <LoginModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
