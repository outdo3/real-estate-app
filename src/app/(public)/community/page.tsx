'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, MapPin, PenLine, RefreshCw, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Header from '@/components/Header';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function CommunityPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [aptName, setAptName] = useState('');

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    setAptName((searchParams.get('aptName') || '').trim());
  }, []);

  const queryKey = `/api/community/posts?page=${page}${aptName ? `&aptName=${encodeURIComponent(aptName)}` : ''}`;
  // COMMUNITY_LAUNCH_READINESS_V1 §3/§16 — SWR의 error도 함께 본다.
  //
  // 예전에는 data.success === false만 오류로 처리했다. 그래서 fetch 자체가 실패하면
  // (오프라인·DNS·타임아웃) data가 undefined로 남아 "아직 작성된 글이 없습니다"가
  // 떴다 — 연결이 끊긴 상황을 "글이 없다"고 말하는 false empty다.
  const { data, isLoading, error: swrError, mutate } = useSWR(queryKey, fetcher);

  const posts = data?.success ? data.data.posts : [];
  const total = data?.success ? data.data.total : 0;
  const pageSize = data?.success ? data.data.pageSize : 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // "글이 없음"과 "DB 연결 실패 등 실제 오류"를 구분해서 보여준다 (전자를 후자로
  // 가려버리면 예를 들어 DATABASE_URL 미설정 상태를 "글이 없다"로 오인하게 됨).
  const fetchError = swrError ? '게시글 목록을 불러오지 못했습니다.' : data && !data.success ? data.error : null;

  const writeHref = `/community/write${aptName ? `?aptName=${encodeURIComponent(aptName)}` : ''}`;

  const handleClearFilter = () => {
    setAptName('');
    setPage(1);
    router.replace('/community');
  };

  // COMMUNITY_ANONYMOUS_BROWSING_UX_V1 §2/§7 — AuthGate를 걷어냈다.
  //
  // 예전에는 목록을 AuthGate로 감싸서, 비로그인 방문자가 들어오는 순간 로그인 모달이
  // 자동으로 떴다. 닫으면 볼 수 있었지만 커뮤니티는 sitemap에 들어가는 공개 화면이라
  // **검색에서 들어온 첫 방문자가 본문 대신 모달을 먼저 만났다.**
  //
  // 읽기는 공개하고 쓰기에서만 인증을 요구한다. 글쓰기 버튼은 /community/write로
  // 이동하고 그 페이지의 AuthGate가 로그인을 요구하므로, 여기서 모달을 들 필요가 없다.
  return (
    <>
      <div className={styles.main}>
        <Header pageTitle="커뮤니티" />
        <div className="container">
          {aptName && (
            <div className={styles.filterBanner}>
              <span className={styles.filterBannerText}>
                <MapPin size={14} aria-hidden="true" />
                <b>{aptName}</b> 관련글 · {total}건
              </span>
              <button className={styles.clearFilterBtn} onClick={handleClearFilter}>
                전체보기
              </button>
            </div>
          )}

          <div className={styles.headerTop}>
            {!aptName ? (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>전체 {total}건</span>
            ) : (
              <span />
            )}
            <Link href={writeHref} className={styles.writeBtn}>
              <PenLine size={15} aria-hidden="true" />
              글쓰기
            </Link>
          </div>

          {isLoading ? (
            <div className={styles.emptyState} role="status">불러오는 중입니다...</div>
          ) : fetchError ? (
            /* §16 — 조용히 실패하지 않고, 다시 시도할 방법을 준다. */
            <div className={styles.emptyState} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>{fetchError}</span>
              <button type="button" className={styles.retryBtn} onClick={() => mutate()}>
                <RefreshCw size={14} aria-hidden="true" />
                다시 시도
              </button>
            </div>
          ) : posts.length === 0 ? (
            /* §4 — 빈 상태는 "없습니다"로 끝내지 않고 무엇을 하는 곳인지 알려준다.
               과장된 마케팅 문구는 쓰지 않는다. */
            <div className={styles.emptyState}>
              <img src="/brand/mascot/ejipy-empty.webp" alt="" className={styles.emptyMascot} />
              <span className={styles.emptyTitle}>
                {aptName ? `${aptName} 관련 글이 아직 없어요` : '아직 올라온 글이 없어요'}
              </span>
              <span className={styles.emptyDesc}>
                살아본 이야기, 동네 분위기, 실제로 겪은 일을 남겨주세요.
                <br />
                같은 곳을 알아보는 사람에게 도움이 됩니다.
              </span>
              <Link href={writeHref} className={styles.emptyCta}>
                <PenLine size={15} aria-hidden="true" />
                첫 글 남기기
              </Link>
            </div>
          ) : (
            <div className={styles.list}>
              {posts.map((post: any) => (
                <div
                  key={post.id}
                  className={styles.row}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/community/${post.id}`)}
                >
                  {post.pinned && <span className={styles.pinBadge}>고정</span>}
                  <span className={styles.rowTitle}>
                    {post.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>[{post._count.comments}]</span>
                  </span>
                  {post.aptName && (
                    // LAUNCH_TRUST_BLOCKERS_V1 — aptName은 lawdCd/dong이 없는 텍스트라
                    // /apt/[name]으로 바로 연결하면 동명의 다른 단지로 잘못 연결될 위험이
                    // 있다(AGENTS.md "이름만으로 재식별 금지") — 라벨로만 표시한다.
                    <span className={styles.aptBadge} onClick={(e) => e.stopPropagation()}>
                      <Building2 size={12} aria-hidden="true" />
                      {post.aptName}
                    </span>
                  )}
                  <span className={styles.rowMeta}>
                    {post.author.role === 'ADMIN' && <span className={styles.adminBadge}>관리자</span>}
                    {/* §15 — 닉네임이 20자까지 가능해졌다. 폭을 제한하지 않으면
                        360px에서 제목을 밀어낸다. */}
                    <span className={styles.authorName}>{post.author.name}</span>
                    <span>{new Date(post.createdAt).toLocaleDateString('ko-KR')}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                이전
              </button>
              <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {page} / {totalPages}
              </span>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                다음
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
