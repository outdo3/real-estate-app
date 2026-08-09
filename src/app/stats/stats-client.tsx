'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import useSWR from 'swr';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import styles from './page.module.css';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

type TabKey = 'volume' | 'gap' | 'ranking' | 'supply';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

const TABS: { key: TabKey; label: string }[] = [
  { key: 'volume', label: '📊 거래량 분석' },
  { key: 'gap', label: '💰 갭투자 분석' },
  { key: 'ranking', label: '🏆 단지 랭킹' },
  { key: 'supply', label: '🏢 입주/전세가율' },
];

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// ?sido=...&sigungu=...로 진입한 경우(사이트맵/공유 링크) 최초 1회만 URL의 지역으로
// RegionContext를 초기화한다. useSearchParams()는 정적 렌더링 페이지에서 Suspense 경계
//안에 있어야 하므로 별도 컴포넌트로 분리했다.
function RegionUrlSync({ setRegion }: { setRegion: (region: RegionState) => void }) {
  const searchParams = useSearchParams();
  const hydratedFromUrl = useRef(false);

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const sido = searchParams.get('sido');
    const sigungu = searchParams.get('sigungu');
    if (!sido || !sigungu) return;
    resolveLawdCdByNames(sido, sigungu).then((lawdCd) => {
      if (!lawdCd) return;
      setRegion({
        lawdCd,
        dong: 'all',
        sido,
        sigungu,
        displayRegionName: `${sido} ${sigungu} 동 전체`,
      });
    });
  }, [searchParams, setRegion]);

  return null;
}

export default function StatsPage() {
  const { region, setRegion, openRegionModal } = useRegion();
  const [activeTab, setActiveTab] = useState<TabKey>('volume');
  const [chartView, setChartView] = useState<'graph' | 'table'>('table');
  const [tradeModal, setTradeModal] = useState<{ title: string; trades: any[] } | null>(null);

  // SWR이 lawdCd별로 응답을 캐시하므로, 이미 조회한 지역으로 다시 돌아오면(탭 이동 후
  // 복귀 등) 재요청 없이 캐시된 데이터를 즉시 보여준다. isLoading은 해당 키에 대한
  // 캐시가 전혀 없을 때(최초 조회)만 true가 된다.
  const { data: apiResponse, error: swrError, isLoading } = useSWR(
    region.lawdCd ? `/api/stats/dashboard?lawdCd=${region.lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );

  // 연도별 통계표는 무거운 조회라, "표로 보기"가 실제로 선택됐을 때만 요청한다
  // (그래프 보기만 쓰는 사용자는 이 요청 자체가 나가지 않음).
  const { data: yearlyResponse, isLoading: yearlyLoading, error: yearlySwrError } = useSWR(
    region.lawdCd && chartView === 'table' ? `/api/stats/yearly?lawdCd=${region.lawdCd}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30 * 60 * 1000 }
  );
  const yearlyTable = yearlyResponse?.success ? yearlyResponse.data.yearlyTable : null;
  const yearlyError = yearlySwrError
    ? '연도별 통계를 불러오지 못했습니다.'
    : (!yearlyLoading && yearlyResponse && !yearlyResponse.success
        ? (yearlyResponse.error || '연도별 통계를 불러오지 못했습니다.')
        : null);

  const data = apiResponse?.success ? apiResponse.data : null;
  const fetchError = apiResponse && !apiResponse.success
    ? apiResponse.error
    : (swrError ? '통계 데이터를 불러오지 못했습니다.' : null);
  const loading = isLoading;

  const renderBadge = (rank: number) => {
    let badgeClass = styles.compactRank;
    if (rank === 1) badgeClass += ` ${styles.rankBadgeTop1}`;
    if (rank === 2) badgeClass += ` ${styles.rankBadgeTop2}`;
    if (rank === 3) badgeClass += ` ${styles.rankBadgeTop3}`;
    return <div className={badgeClass}>{rank}</div>;
  };

  // 랭킹 항목 클릭 시 해당 단지의 실거래 내역(단지명/실거래가/거래일자) 팝업 오픈
  const openComplexTrades = (name: string) => {
    const key = normalizeAptName(name);
    const trades = data?.complexTrades?.[key] || [];
    setTradeModal({ title: `${name} 최근 거래 내역`, trades });
  };

  // 순위 리스트 공통 렌더러: 단지명, 평형/부가정보, 값(가격/갭 등), 거래건수를 한 줄에 압축 표시
  // 항목 클릭 시 해당 단지의 실거래 내역 팝업이 뜬다.
  const renderCompactList = (
    items: any[],
    valueKey: string,
    options?: { valueColor?: string; emptyText?: string; meta?: (item: any) => string }
  ) => {
    const { valueColor, emptyText = '표시할 데이터가 없습니다.', meta = (item: any) => (item.pyung ? `${item.pyung}평` : '') } = options || {};
    if (!items || items.length === 0) {
      return <div className={styles.emptyState}>{emptyText}</div>;
    }
    return (
      <ul className={styles.compactList}>
        {items.map((item) => (
          <li
            key={item.rank}
            className={styles.compactItem}
            onClick={() => openComplexTrades(item.name)}
            role="button"
            tabIndex={0}
          >
            {renderBadge(item.rank)}
            <div className={styles.compactInfo}>
              <div className={styles.compactName}>{item.name}</div>
              <div className={styles.compactMeta}>{meta(item)}</div>
            </div>
            <div className={styles.compactValue}>
              <div className={styles.compactPrice} style={valueColor ? { color: valueColor } : undefined}>
                {item[valueKey]}
              </div>
              <div className={styles.compactSub}>거래 {item.dealCount}건</div>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className={styles.main}>
      <Suspense fallback={null}>
        <RegionUrlSync setRegion={setRegion} />
      </Suspense>
      <Header pageTitle="시장 통계·분석" />
      <div className="container">
        {/* 상단 지역 선택: 실거래가 탭과 동일한 전역 지역 선택 모달을 공유한다 */}
        <div className={styles.headerTop}>
          <button className={styles.regionTrigger} onClick={openRegionModal}>
            <span>📍 {region.displayRegionName}</span>
            <span className={styles.regionTriggerCaret}>▾</span>
          </button>
        </div>

        {/* 서브 카테고리 탭 */}
        <div className={styles.tabs}>
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`${styles.tab} ${activeTab === tab.key ? styles.activeTab : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
            통계 데이터를 분석 중입니다...
          </div>
        ) : fetchError || !data ? (
          <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
            ⚠️ {fetchError || '통계 데이터를 불러오지 못했습니다.'}
          </div>
        ) : (
          <>
            {/* 상단 요약 바: 실데이터만 표시 (입주물량 등 미연동 지표는 하단 탭에서 안내) */}
            <div className={styles.dashboardGrid}>
              <div
                className={styles.summaryCard}
                style={{ cursor: 'pointer' }}
                onClick={() => setTradeModal({ title: `이번 달 실거래 내역 (${data.summary.volume}건)`, trades: data.currentMonthTrades || [] })}
                role="button"
                tabIndex={0}
              >
                <div className={styles.cardIcon}>📊</div>
                <div className={styles.cardContent}>
                  <h3>이번 달 거래량</h3>
                  <p>{data.summary.volume}건 <span style={{ fontSize: '0.9rem', fontWeight: 600, color: data.summary.volumeChange >= 0 ? '#ef4444' : '#3b82f6' }}>(전월 대비 {data.summary.volumeChange >= 0 ? '+' : ''}{data.summary.volumeChange}건)</span></p>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.cardIcon}>📈</div>
                <div className={styles.cardContent}>
                  <h3>평균 전세가율</h3>
                  <p>{data.summary.chonseRate != null ? `${data.summary.chonseRate}%` : '데이터 없음'}</p>
                </div>
              </div>
            </div>

            {/* 1. 거래량 분석 */}
            {activeTab === 'volume' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>📊 거래량·시세 추이</h2>
                  <div className={styles.viewToggle}>
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'graph' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('graph')}
                    >
                      📊 그래프 보기
                    </button>
                    <button
                      className={`${styles.viewToggleBtn} ${chartView === 'table' ? styles.viewToggleActive : ''}`}
                      onClick={() => setChartView('table')}
                    >
                      📋 표로 보기
                    </button>
                  </div>
                </div>

                {chartView === 'graph' ? (
                  <div className={styles.panelBody} style={{ height: '400px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={data.chartData}
                        margin={{ top: 20, right: 20, bottom: 20, left: 0 }}
                      >
                        <CartesianGrid stroke="#f5f5f5" vertical={false} />
                        <XAxis dataKey="month" scale="band" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
                        <YAxis yAxisId="left" orientation="left" stroke="#94a3b8" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" domain={['auto', 'auto']} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                          labelStyle={{ fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}
                        />
                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '13px' }} />
                        <Bar yAxisId="left" dataKey="volume" name="거래량(건)" barSize={16} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="saleIndex" name="매매가격지수" stroke="#3b82f6" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
                        <Line yAxisId="right" type="monotone" dataKey="jeonseIndex" name="전세가격지수" stroke="#10b981" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className={styles.tipBox}>
                      <span>💡 <strong>분석 팁:</strong> 최근 12개월 실거래 기준, {region.displayRegionName}의 거래량과 매매/전세 가격지수(최초 유효월=100 기준) 추이입니다.</span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.panelBody}>
                    <div className={styles.tableWrapper}>
                      <table className={styles.yearlyTable}>
                        <thead>
                          <tr>
                            <th>거래년월</th>
                            <th>최고가</th>
                            <th>최저가</th>
                            <th>평균가</th>
                            <th>거래량(건)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {yearlyError ? (
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                                ⚠️ {yearlyError}
                              </td>
                            </tr>
                          ) : !yearlyTable ? (
                            Array.from({ length: 6 }).map((_, i) => (
                              <tr key={`skeleton-${i}`}>
                                <td colSpan={5}>
                                  <div className={styles.skeletonBar} />
                                </td>
                              </tr>
                            ))
                          ) : (
                            [...yearlyTable].reverse().map((row: any) => (
                              <tr key={row.year}>
                                <td className={styles.yearlyTableYear}>{row.year}년</td>
                                <td>{row.maxPrice || '-'}</td>
                                <td>{row.minPrice || '-'}</td>
                                <td>{row.avgPrice || '-'}</td>
                                <td>{row.count.toLocaleString('ko-KR')}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. 갭투자 분석 */}
            {activeTab === 'gap' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>💰 소액 갭투자 단지 TOP 5</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3개월 · 매매-전세 근사 갭</span>
                </div>
                {renderCompactList(data.gapInvest, 'gap', {
                  valueColor: '#ef4444',
                  emptyText: '최근 3개월 내 매매·전세가 함께 확인된 단지가 없습니다.',
                })}
              </div>
            )}

            {/* 3. 단지 랭킹 */}
            {activeTab === 'ranking' && (
              <div className={styles.rankingGrid}>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>🔥 최근 핫이슈 거래</h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3개월 최고가 TOP 5</span>
                  </div>
                  {renderCompactList(data.hotIssues, 'price')}
                </div>
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>🏆 {region.sigungu} 평당가 랭킹</h2>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 1년 평균</span>
                  </div>
                  {renderCompactList(data.topPrices, 'pricePerPyung', {
                    meta: () => '최근 1년 평균 평당가',
                  })}
                </div>
              </div>
            )}

            {/* 4. 입주/전세가율 */}
            {activeTab === 'supply' && (
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>🏢 입주물량 · 전세가율</h2>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.dashboardGrid} style={{ marginBottom: 0 }}>
                    <div className={styles.summaryCard}>
                      <div className={styles.cardIcon}>📈</div>
                      <div className={styles.cardContent}>
                        <h3>{region.displayRegionName} 평균 전세가율</h3>
                        <p>{data.jeonseRate != null ? `${data.jeonseRate}%` : '데이터 없음'} <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>(최근 3개월 실거래 기준)</span></p>
                      </div>
                    </div>
                  </div>
                  <div className={styles.emptyState} style={{ marginTop: '1.25rem' }}>
                    📦 입주(예정)물량 데이터는 아직 연동되지 않았습니다. 임의의 추정치를 표시하지 않기 위해 비워둡니다.
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 거래 내역 팝업: 거래량 카드 또는 랭킹 항목 클릭 시 단지명/실거래가/거래일자 목록 표시 */}
      {tradeModal && (
        <div className={styles.modalOverlay} onClick={() => setTradeModal(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{tradeModal.title}</h2>
              <button className={styles.closeButton} onClick={() => setTradeModal(null)} aria-label="닫기">
                &times;
              </button>
            </div>
            <div className={styles.modalBody}>
              {tradeModal.trades.length === 0 ? (
                <div className={styles.emptyState}>표시할 거래 내역이 없습니다.</div>
              ) : (
                <ul className={styles.tradeList}>
                  {tradeModal.trades.map((t: any, i: number) => (
                    <li key={i} className={styles.tradeRow}>
                      <span className={styles.tradeName}>{t.name}</span>
                      <span className={styles.tradePrice}>{t.price}</span>
                      <span className={styles.tradeDate}>{t.tradeDate}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <RegionSelectModal />
    </div>
  );
}
