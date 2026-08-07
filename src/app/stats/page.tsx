'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/Header';
import { REGION_DATA, SIDO_LIST } from '../../lib/regions';
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

const TABS = ['📈 거래량·시세 동향', '🔥 특수 거래 (신고가/반등)', '💰 갭투자·매물 분석', '🏆 지역·단지 랭킹'];

export default function StatsPage() {
  const [sido, setSido] = useState('부산광역시');
  const [gungu, setGungu] = useState('서구');
  const [activeTab, setActiveTab] = useState(TABS[0]);
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/stats/dashboard?sido=${encodeURIComponent(sido)}&gungu=${encodeURIComponent(gungu)}`);
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [sido, gungu]);

  const region = `${sido} ${gungu}`;

  const renderBadge = (rank: number) => {
    let badgeClass = styles.rankBadge;
    if (rank === 1) badgeClass += ` ${styles.rankBadgeTop1}`;
    if (rank === 2) badgeClass += ` ${styles.rankBadgeTop2}`;
    if (rank === 3) badgeClass += ` ${styles.rankBadgeTop3}`;
    return <div className={badgeClass}>{rank}</div>;
  };

  const getTagClass = (type: string) => {
    if (type === 'up') return styles.tagUp;
    if (type === 'rebound') return styles.tagRebound;
    return styles.tagHot;
  };

  return (
    <div className={styles.main}>
      <Header />
      <div className="container">
        {/* 상단 탭 및 지역 필터 */}
        <div className={styles.headerTop}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <h1 className={styles.title} style={{ margin: 0, marginRight: '10px' }}>시장 통계·분석</h1>
            <select 
              className={styles.regionSelect} 
              value={sido}
              onChange={(e) => {
                const newSido = e.target.value;
                setSido(newSido);
                setGungu(REGION_DATA[newSido][0]);
              }}
            >
              {SIDO_LIST.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select 
              className={styles.regionSelect} 
              value={gungu}
              onChange={(e) => setGungu(e.target.value)}
            >
              {REGION_DATA[sido].map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className={styles.tabs}>
            {TABS.map(tab => (
              <button 
                key={tab} 
                className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {loading || !data ? (
          <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
            통계 데이터를 분석 중입니다...
          </div>
        ) : (
          <>
            {/* 1. 시장 요약 브리핑 대시보드 */}
            <div className={styles.dashboardGrid}>
              <div className={styles.summaryCard}>
                <div className={styles.cardIcon}>📊</div>
                <div className={styles.cardContent}>
                  <h3>26년 8월 거래량</h3>
                  <p>{data.summary.volume}건 <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#16a34a' }}>(월평균 대비 {data.summary.volumeChange}%)</span></p>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.cardIcon}>🏢</div>
                <div className={styles.cardContent}>
                  <h3>향후 2년 입주물량</h3>
                  <p>{data.summary.supply}세대 <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--primary-color)' }}>({data.summary.supplyStatus})</span></p>
                </div>
              </div>
              <div className={styles.summaryCard}>
                <div className={styles.cardIcon}>📈</div>
                <div className={styles.cardContent}>
                  <h3>평균 전세가율</h3>
                  <p>{data.summary.chonseRate}% <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#ef4444' }}>({data.summary.chonseChange}%)</span></p>
                </div>
              </div>
            </div>

            {/* 2. 차트 & 핫이슈 (Main Grid) */}
            <div className={styles.mainGrid}>
              
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>📈 최근 1년 월별 거래량 및 시세 추이</h2>
                </div>
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
                      <Bar yAxisId="left" dataKey="volume" name="거래량(건)" barSize={20} fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="priceIndex" name="매매가격지수" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className={styles.tipBox}>
                    <span>💡 <strong>분석 팁:</strong> 현재 {region}는 전월 대비 거래량이 증가하며 <strong>매수 심리 회복세</strong>를 보이고 있습니다.</span>
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>🔥 최근 1개월 핫이슈 거래</h2>
                </div>
                <ul className={styles.rankList}>
                  {data.hotIssues.map((item: any) => (
                    <li key={item.rank} className={styles.rankItem}>
                      {renderBadge(item.rank)}
                      <div className={styles.rankInfo}>
                        <h4>{item.name}</h4>
                        <span className={`${styles.rankTag} ${getTagClass(item.type)}`}>{item.tag}</span>
                      </div>
                      <div className={styles.rankValue}>
                        <div className={styles.rankPrice}>{item.price}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

            </div>

            {/* 3. 상세 통계 데이터 Grid (Bottom) */}
            <div className={styles.detailGrid}>
              
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>💰 소액 갭투자 단지</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>최근 3개월</span>
                </div>
                <ul className={styles.rankList}>
                  {data.gapInvest.map((item: any) => (
                    <li key={item.rank} className={styles.rankItem} style={{ padding: '0.8rem 1.25rem' }}>
                      <div className={styles.rankInfo}>
                        <h4 style={{ fontSize: '0.95rem' }}>{item.name}</h4>
                        <p>거래 {item.deals}건</p>
                      </div>
                      <div className={styles.rankValue}>
                        <div className={styles.rankPrice} style={{ fontSize: '1rem', color: '#ef4444' }}>{item.gap}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>🏆 {gungu} 평당가 랭킹</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>전체 면적 기준</span>
                </div>
                <ul className={styles.rankList}>
                  {data.topPrices.map((item: any) => (
                    <li key={item.rank} className={styles.rankItem} style={{ padding: '0.8rem 1.25rem' }}>
                      {renderBadge(item.rank)}
                      <div className={styles.rankInfo}>
                        <h4 style={{ fontSize: '0.95rem' }}>{item.name}</h4>
                        <p>최근 실거래 {item.price}</p>
                      </div>
                      <div className={styles.rankValue}>
                        <div className={styles.rankPrice} style={{ fontSize: '1rem' }}>{item.pricePerPyung}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2 className={styles.panelTitle}>📦 매물 급증 단지</h2>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>전월 대비</span>
                </div>
                <ul className={styles.rankList}>
                  {data.inventory.map((item: any) => (
                    <li key={item.rank} className={styles.rankItem} style={{ padding: '0.8rem 1.25rem' }}>
                      <div className={styles.rankInfo}>
                        <h4 style={{ fontSize: '0.95rem' }}>{item.name}</h4>
                        <p>총 {item.amount}건</p>
                      </div>
                      <div className={styles.rankValue}>
                        <div className={styles.rankPrice} style={{ fontSize: '1rem', color: item.changeRate.startsWith('+') ? '#3b82f6' : '#16a34a' }}>
                          {item.changeRate}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
}
