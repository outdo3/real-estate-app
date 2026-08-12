'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// 실시간 접속자/인기 단지는 자주 바뀌므로 짧은 간격으로 다시 조회한다.
const REFRESH_INTERVAL_MS = 20 * 1000;

// 파이프라인 상태 문구는 "정상"/"오류" 외에도 "미연동"/"설정됨"처럼 실패가 아닌
// 중립적인 상태를 나타낼 수 있다. 이 둘을 전부 오류(빨간색)로 표시하면 아직 구현되지
// 않았을 뿐인 기능이 장애처럼 보이므로, 상태 문구에 따라 세 가지 스타일로 구분한다.
function pipelineStatusClass(status: string): string {
  if (status.startsWith('정상')) return styles.pipelineStatusOk;
  if (status.startsWith('오류')) return styles.pipelineStatusError;
  return styles.pipelineStatusNeutral;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

export default function AdminDashboardPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  const { data, isLoading, error: swrError } = useSWR(
    isAdmin ? '/api/admin/dashboard' : null,
    fetcher,
    { refreshInterval: REFRESH_INTERVAL_MS, revalidateOnFocus: false }
  );

  const d = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : swrError ? '대시보드를 불러오지 못했습니다.' : null;

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="관리자 대시보드" />
        <div className="container">
          {status === 'loading' ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : !isAdmin ? (
            <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
          ) : isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : d ? (
            <>
              <div className={styles.grid}>
                {/* 1. 트래픽 요약 */}
                <div className={styles.card}>
                  <div className={styles.cardTitle}>📈 트래픽 요약</div>
                  <div className={styles.statRow}>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>오늘 방문자(UV)</div>
                      <div className={styles.statValue}>{d.traffic.todayUniqueVisitors.toLocaleString('ko-KR')}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>오늘 페이지뷰(PV)</div>
                      <div className={styles.statValue}>{d.traffic.todayPageViews.toLocaleString('ko-KR')}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>
                        <span className={styles.onlineDot} />
                        실시간 접속자
                      </div>
                      <div className={styles.statValue}>{d.traffic.onlineNow.toLocaleString('ko-KR')}명</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>오늘 신규가입 / 총회원</div>
                      <div className={styles.statValue}>
                        {d.traffic.todayNewUsers.toLocaleString('ko-KR')} / {d.traffic.totalUsers.toLocaleString('ko-KR')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. 실시간 및 인기 아파트 */}
                <div className={styles.card}>
                  <div className={styles.cardTitle}>🏢 실시간 및 인기 아파트</div>
                  <div className={styles.subLabel}>🟢 지금 보는 사람이 많은 단지</div>
                  {d.apartments.realtime.length === 0 ? (
                    <div className={styles.emptyRow}>지금 상세페이지를 보고 있는 방문자가 없습니다.</div>
                  ) : (
                    <ul className={styles.rankList}>
                      {d.apartments.realtime.map((a: any, i: number) => (
                        <li key={a.aptName} className={styles.rankRow}>
                          <span className={styles.rankIndex}>{i + 1}</span>
                          <span className={styles.rankName}>{a.aptName}</span>
                          <span className={styles.rankValue}>{a.viewers}명 보는 중</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.subLabel}>누적 인기 조회 TOP 10 (최근 30일)</div>
                  {d.apartments.popular30d.length === 0 ? (
                    <div className={styles.emptyRow}>아직 집계된 조회 기록이 없습니다.</div>
                  ) : (
                    <ul className={styles.rankList}>
                      {d.apartments.popular30d.map((a: any, i: number) => (
                        <li key={a.aptName} className={styles.rankRow}>
                          <span className={styles.rankIndex}>{i + 1}</span>
                          <span className={styles.rankName}>{a.aptName}</span>
                          <span className={styles.rankValue}>{a.views}회</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 3. 인기 검색어 & 지역 관심도 */}
                <div className={styles.card}>
                  <div className={styles.cardTitle}>🔍 인기 검색어 & 지역 관심도 (최근 7일)</div>
                  <div className={styles.subLabel}>인기 검색어 TOP 10</div>
                  {d.search.topQueries.length === 0 ? (
                    <div className={styles.emptyRow}>아직 검색 기록이 없습니다.</div>
                  ) : (
                    <div>
                      {d.search.topQueries.map((q: any) => (
                        <span key={q.query} className={styles.chip}>
                          {q.query} <b>{q.count}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.subLabel}>관심 지역 TOP 10</div>
                  {d.search.topRegions.length === 0 ? (
                    <div className={styles.emptyRow}>검색어에서 지역명을 인식하지 못했습니다.</div>
                  ) : (
                    <div>
                      {d.search.topRegions.map((r: any) => (
                        <span key={r.region} className={styles.chip}>
                          {r.region} <b>{r.count}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. 커뮤니티 현황 */}
                <div className={styles.card}>
                  <div className={styles.cardTitle}>💬 커뮤니티 현황</div>
                  <div className={styles.statRow}>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>오늘 신규 게시글</div>
                      <div className={styles.statValue}>{d.community.todayNewPosts.toLocaleString('ko-KR')}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>오늘 신규 댓글</div>
                      <div className={styles.statValue}>{d.community.todayNewComments.toLocaleString('ko-KR')}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>미처리 신고</div>
                      <div className={styles.statValue}>{d.community.unresolvedReports.toLocaleString('ko-KR')}건</div>
                    </div>
                  </div>
                  <div className={styles.subLabel}>최근 작성된 글</div>
                  {d.community.recentPosts.length === 0 ? (
                    <div className={styles.emptyRow}>작성된 글이 없습니다.</div>
                  ) : (
                    d.community.recentPosts.map((p: any) => (
                      <div key={p.id} className={styles.postRow}>
                        <div className={styles.postTitle}>{p.title}</div>
                        <div className={styles.postMeta}>
                          {p.author?.name || '알 수 없음'} · {p.aptName || '단지 태그 없음'} · {formatTime(p.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* 5. 공공 API 파이프라인 상태 */}
                <div className={styles.card}>
                  <div className={styles.cardTitle}>⚙️ 공공 API & 데이터 파이프라인 상태</div>
                  {d.pipeline.map((p: any) => (
                    <div key={p.name} className={styles.pipelineRow}>
                      <span className={styles.pipelineName}>{p.name}</span>
                      <span className={pipelineStatusClass(p.status)}>
                        {p.status} · {formatTime(p.checkedAt)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 6. 시스템 에러 로그 */}
                <div className={styles.cardWide}>
                  <div className={styles.cardTitle}>🚨 시스템 에러 로그 (최근 20건)</div>
                  {d.errors.length === 0 ? (
                    <div className={styles.emptyRow}>최근 기록된 에러가 없습니다.</div>
                  ) : (
                    d.errors.map((e: any) => (
                      <div key={e.id} className={styles.errorRow}>
                        <span className={styles.errorSource}>{e.source === 'server' ? 'SERVER' : 'CLIENT'}</span>
                        <span className={styles.errorMessage}>{e.message}</span>
                        <div className={styles.errorMeta}>
                          {e.url ? `${e.url} · ` : ''}
                          {formatTime(e.createdAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className={styles.refreshHint}>20초마다 자동 갱신됩니다.</div>
            </>
          ) : null}
        </div>
      </div>
    </AuthGate>
  );
}
