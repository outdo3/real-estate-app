'use client';

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import type { AnalyticsRange, BehaviorSummary } from '@/lib/admin-analytics/types';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
];

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(0)}%`;
}

function num(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ADMIN_USER_BEHAVIOR_ANALYTICS_V1_PHASE2 §11 — distinct sessionId를 "순 방문자"라고
// 강하게 표현하지 않는다. 카드 라벨/보조문구에서 "브라우저 세션 기준" 임을 항상 밝힌다.
export default function AdminBehaviorPage() {
  const { data: session, status } = useSession();
  // ADMIN_ACCESS_FIX_V1 — role만 보면 ADMIN_EMAIL로 부트스트랩된 운영자가 proxy/API는
  // 통과하고도 이 화면에서만 non-admin으로 판정돼 데이터를 아예 요청하지 않았다.
  // 서버가 계산해 세션에 실어준 isAdmin을 쓴다(실제 권한은 서버가 다시 검증).
  const isAdmin = session?.user?.isAdmin === true;
  const [range, setRange] = useState<AnalyticsRange>('7d');

  const { data, isLoading, error: swrError } = useSWR(
    isAdmin ? `/api/admin/behavior?range=${range}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const d: BehaviorSummary | null = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : swrError ? '행동 분석 데이터를 불러오지 못했습니다.' : null;

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="사용자 행동 분석" />
        <div className="container">
          <div className={styles.rangeRow}>
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.rangeBtn} ${range === opt.value ? styles.rangeBtnActive : ''}`}
                onClick={() => setRange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {status === 'loading' ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : !isAdmin ? (
            <div className={styles.emptyState}>관리자만 접근할 수 있는 페이지입니다.</div>
          ) : isLoading ? (
            <div className={styles.emptyState}>불러오는 중입니다...</div>
          ) : fetchError ? (
            // §43 — 집계 실패를 "0명"으로 보여주지 않는다. 명확히 실패 상태를 표시한다.
            <div className={styles.emptyState}>⚠️ {fetchError}</div>
          ) : d ? (
            <>
              <p className={styles.rangeCaption}>{d.rangeLabel} 기준 · 브라우저 세션(익명 sessionId) 단위 집계입니다.</p>

              <div className={styles.kpiGrid}>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>방문 세션</div>
                  <div className={styles.kpiValue}>{num(d.kpi.sessions)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>페이지뷰</div>
                  <div className={styles.kpiValue}>{num(d.kpi.pageViews)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>단지 상세조회</div>
                  <div className={styles.kpiValue}>{num(d.kpi.detailViews)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>비교 사용</div>
                  <div className={styles.kpiValue}>{num(d.kpi.compareStarts)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>관심단지 추가</div>
                  <div className={styles.kpiValue}>{num(d.kpi.favoriteAdds)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>자금 계산 실행</div>
                  <div className={styles.kpiValue}>{num(d.kpi.financeFitCalculates)}</div>
                </div>
                <div className={styles.kpiTile}>
                  <div className={styles.kpiLabel}>공유 성공</div>
                  <div className={styles.kpiValue}>{num(d.kpi.shareSuccesses)}</div>
                </div>
              </div>

              <div className={styles.grid}>
                <div className={styles.cardWide}>
                  <div className={styles.cardTitle}>사용자 여정</div>
                  <div className={styles.funnelRow}>
                    {d.funnel.map((step, i) => (
                      <React.Fragment key={step.step}>
                        <div className={styles.funnelStep}>
                          <div className={styles.funnelLabel}>{step.label}</div>
                          <div className={styles.funnelValue}>{num(step.sessionCount)}</div>
                          {step.conversionFromPrevious !== null && (
                            <div className={styles.funnelConversion}>이전 단계 대비 {formatPercent(step.conversionFromPrevious)}</div>
                          )}
                        </div>
                        {i < d.funnel.length - 1 && <div className={styles.funnelArrow}>→</div>}
                      </React.Fragment>
                    ))}
                  </div>
                  <p className={styles.note}>
                    같은 세션이 같은 단계를 여러 번 반복해도 1회로 집계됩니다. &quot;검색이 이 상세조회를 직접
                    발생시켰다&quot;와 같은 단계 간 인과관계는 현재 데이터로 확인할 수 없습니다.
                  </p>
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTitle}>인기 단지 TOP 10</div>
                  {d.popularApartments.length === 0 ? (
                    <div className={styles.noData}>데이터 없음</div>
                  ) : (
                    <ul className={styles.rankList}>
                      {d.popularApartments.map((a, i) => (
                        <li key={a.complexId} className={styles.rankRow}>
                          <span className={styles.rankIndex}>{i + 1}</span>
                          <span className={styles.rankName}>{a.aptName}</span>
                          <span className={styles.rankMeta}>{a.dong}</span>
                          <span className={styles.rankCount}>{num(a.views)}회</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTitle}>관심 지역 TOP 10 (상세조회 기준)</div>
                  {d.popularRegions.length === 0 ? (
                    <div className={styles.noData}>데이터 없음</div>
                  ) : (
                    <ul className={styles.rankList}>
                      {d.popularRegions.map((r, i) => (
                        <li key={`${r.lawdCd}-${r.dong}`} className={styles.rankRow}>
                          <span className={styles.rankIndex}>{i + 1}</span>
                          <span className={styles.rankName}>{r.dong}</span>
                          <span className={styles.rankMeta}>{r.lawdCd}</span>
                          <span className={styles.rankCount}>{num(r.detailViews)}회</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTitle}>기능 사용량</div>
                  <ul className={styles.rankList}>
                    {d.featureUsage.map((f) => (
                      <li key={f.feature} className={styles.rankRow}>
                        <span className={styles.rankName}>{f.label}</span>
                        {f.trust === 'PAGEVIEW_PROXY' && <span className={styles.proxyBadge}>추정</span>}
                        <span className={styles.rankCount}>{num(f.count)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={styles.note}>&quot;추정&quot; 표시는 전용 이벤트가 없어 페이지뷰만으로 집계한 값입니다.</p>
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTitle}>다음 행동 유형 (상세 → ?)</div>
                  {d.nextActionBreakdown.length === 0 ? (
                    <div className={styles.noData}>데이터 없음</div>
                  ) : (
                    <ul className={styles.rankList}>
                      {d.nextActionBreakdown.map((a) => (
                        <li key={a.actionType} className={styles.rankRow}>
                          <span className={styles.rankName}>{a.label}</span>
                          <span className={styles.rankCount}>{num(a.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={styles.card}>
                  <div className={styles.cardTitle}>공유 성공률</div>
                  <div className={styles.statRow}>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>시도</div>
                      <div className={styles.statValue}>{num(d.shareStats.attempts)}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>성공</div>
                      <div className={styles.statValue}>{num(d.shareStats.successes)}</div>
                    </div>
                    <div className={styles.statTile}>
                      <div className={styles.statLabel}>성공률</div>
                      <div className={styles.statValue}>{formatPercent(d.shareStats.successRate)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <p className={styles.historicalNote}>ℹ️ {d.historicalDataNote}</p>
              <p className={styles.generatedAt}>최근 집계 · {new Date(d.generatedAt).toLocaleString('ko-KR')} 기준(최대 5분 지연)</p>
            </>
          ) : null}
        </div>
      </div>
    </AuthGate>
  );
}
