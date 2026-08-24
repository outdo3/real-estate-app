'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import type { FavoriteInput } from '@/lib/favorites';
import { useRecentSync } from '@/hooks/useRecentSync';
import { ALLOWED_PURPOSES, PURPOSE_LABELS, type Purpose } from '@/lib/preferences';
import styles from './page.module.css';

const ROLE_LABELS: Record<string, string> = {
  GUEST: '게스트',
  USER: '일반회원',
  VERIFIED: '인증회원',
  ADMIN: '관리자',
};

// canonical routing: 상세페이지/지도 "상세보기"/최근 본 단지와 동일한 쿼리 형태.
function aptHref(f: { lawdCd: string; dong: string; name: string }) {
  return `/apt/${encodeURIComponent(f.name)}?lawdCd=${encodeURIComponent(f.lawdCd)}&dong=${encodeURIComponent(f.dong)}`;
}

interface RecentViewItem {
  id: string;
  lawdCd: string;
  dong: string;
  name: string;
  address?: string | null;
  viewedAt: string;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function MyPage() {
  const { data: session, status } = useSession();
  const [favorites, setFavorites] = useState<FavoriteInput[] | null>(null);
  const [recentViews, setRecentViews] = useState<RecentViewItem[] | null>(null);

  // [MY-4] 관심 목적 상태
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // [MY-3] 로그인 직후 local recent → server sync
  useRecentSync();

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;

    // 관심단지
    fetch('/api/my/favorites')
      .then((res) => res.json())
      .then((json) => { if (!cancelled && json.success) setFavorites(json.data); })
      .catch(() => { if (!cancelled) setFavorites([]); });

    // 최근 본 단지
    fetch('/api/my/recent')
      .then((res) => res.json())
      .then((json) => { if (!cancelled && json.success) setRecentViews(json.data); })
      .catch(() => { if (!cancelled) setRecentViews([]); });

    // [MY-4] 관심 목적
    fetch('/api/my/preferences')
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success) {
          setPurposes((json.data.purposes as string[]).filter(
            (p): p is Purpose => (ALLOWED_PURPOSES as readonly string[]).includes(p)
          ));
          setPrefLoaded(true);
        }
      })
      .catch(() => { if (!cancelled) setPrefLoaded(true); });

    return () => { cancelled = true; };
  }, [status]);

  // 목적 chip 토글 — debounce로 PUT 요청 빈도 제한
  const handlePurposeToggle = useCallback((purpose: Purpose) => {
    setPurposes((prev) => {
      const next = prev.includes(purpose)
        ? prev.filter((p) => p !== purpose)
        : [...prev, purpose];

      // 기존 타이머 취소 후 500ms debounce
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        setSaveStatus('saving');
        fetch('/api/my/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purposes: next }),
        })
          .then((res) => res.json())
          .then((json) => {
            setSaveStatus(json.success ? 'saved' : 'error');
            // 3초 후 idle로 복귀
            setTimeout(() => setSaveStatus('idle'), 3000);
          })
          .catch(() => {
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
          });
      }, 500);

      return next;
    });
  }, []);

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="MY" />
        <div className="container">
          {status === 'loading' ? (
            <div className={styles.emptyCard}>불러오는 중입니다...</div>
          ) : !session ? (
            <div className={styles.emptyCard}>로그인이 필요한 페이지입니다.</div>
          ) : (
            <>
              {/* 프로필 */}
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

              {/* 관리자 대시보드 */}
              {session.user.role === 'ADMIN' && (
                <div className={styles.section}>
                  <Link href="/admin/dashboard" className={styles.linkCard}>
                    ⚙️ 관리자 대시보드
                  </Link>
                </div>
              )}

              {/* 관심단지 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>관심단지</div>
                {favorites === null ? (
                  <div className={styles.sectionLoading}>불러오는 중입니다...</div>
                ) : favorites.length === 0 ? (
                  <div className={styles.emptyBox}>
                    <p className={styles.emptyText}>아직 저장한 관심단지가 없습니다.</p>
                    <Link href="/" className={styles.emptyLink}>단지 둘러보기</Link>
                  </div>
                ) : (
                  favorites.map((f) => (
                    <Link key={`${f.lawdCd}|${f.dong}|${f.name}`} href={aptHref(f)} className={styles.aptItem}>
                      <div className={styles.aptName}>{f.name}</div>
                      {f.address && <div className={styles.aptAddress}>{f.address}</div>}
                    </Link>
                  ))
                )}
              </div>

              {/* 최근 본 단지 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>최근 본 단지</div>
                {recentViews === null ? (
                  <div className={styles.sectionLoading}>불러오는 중입니다...</div>
                ) : recentViews.length === 0 ? (
                  <div className={styles.emptyBox}>
                    <p className={styles.emptyText}>최근 본 단지가 없습니다.</p>
                    <Link href="/map" className={styles.emptyLink}>지도에서 찾아보기</Link>
                  </div>
                ) : (
                  recentViews.map((r) => (
                    <Link key={r.id} href={aptHref(r)} className={styles.aptItem}>
                      <div className={styles.aptName}>{r.name}</div>
                      {r.address && <div className={styles.aptAddress}>{r.address}</div>}
                    </Link>
                  ))
                )}
              </div>

              {/* [MY-4] 관심 목적 */}
              <div className={styles.section}>
                <div className={styles.sectionTitle}>어떤 집을 찾고 계세요?</div>
                <div className={styles.sectionDesc}>
                  관심 목적을 선택하면 나중에 더 맞는 정보를 보여드릴 수 있어요.
                </div>
                {!prefLoaded ? (
                  <div className={styles.sectionLoading}>불러오는 중입니다...</div>
                ) : (
                  <>
                    <div className={styles.purposeGrid}>
                      {ALLOWED_PURPOSES.map((p) => {
                        const active = purposes.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            className={`${styles.purposeChip} ${active ? styles.purposeChipActive : ''}`}
                            aria-pressed={active}
                            onClick={() => handlePurposeToggle(p)}
                          >
                            {active && <span className={styles.purposeCheck} aria-hidden="true">✓ </span>}
                            {PURPOSE_LABELS[p]}
                          </button>
                        );
                      })}
                    </div>
                    <div className={styles.saveStatus} aria-live="polite">
                      {saveStatus === 'saving' && <span className={styles.saving}>저장 중...</span>}
                      {saveStatus === 'saved' && <span className={styles.saved}>✓ 저장됐습니다</span>}
                      {saveStatus === 'error' && <span className={styles.saveError}>저장에 실패했습니다. 다시 시도해 주세요.</span>}
                    </div>
                  </>
                )}
              </div>

              {/* 바로가기 */}
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

          {/* 로그인 여부와 무관하게 항상 접근 가능해야 하는 정책 링크 */}
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
