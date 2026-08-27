'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Calendar } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { formatPercentChange, directionColor } from '@/lib/stats-format';
import styles from './TransactionFeedView.module.css';

// STATISTICS V2 — REGIONAL TRANSACTION FEED §8~§25. 당근/아파트미 실거래 UX를
// 참고하되(날짜별 그룹, compact row, 신고가/변동 badge) 이집만의 "시장 요약 →
// 주목할 변화 → 단지" 흐름을 위에 얹는다(§51 설계 원칙). LLM 없음, 전부
// /api/stats/feed의 deterministic 계산 결과만 표시한다(§52).

interface PeriodOption {
  preset: string;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { preset: 'today', label: '오늘' },
  { preset: 'yesterday', label: '어제' },
  { preset: '7d', label: '최근 7일' },
  { preset: 'thisWeek', label: '이번 주' },
  { preset: 'lastWeek', label: '지난주' },
  { preset: '30d', label: '최근 30일' },
  { preset: '12m', label: '최근 12개월' },
];

const DEAL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'sale', label: '매매' },
  { value: 'jeonse', label: '전세' },
  { value: 'wolse', label: '월세' },
];

interface FeedTradeRow {
  uid: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  dealType: 'sale' | 'jeonse' | 'wolse';
  dealAmount: number;
  excluUseArea: number | null;
  floorRaw: string | number | null;
  dealDate: string;
  dealCanceled: boolean;
  priceLabel: string;
  isRecordHigh: boolean;
  previousTrade: { dealAmount: number; dealDate: string } | null;
  changeAmount: number | null;
  changePct: number | null;
}

interface FeedResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  region: { lawdCd: string; dong: string };
  period: { preset: string; from: string; to: string; label: string };
  summary: {
    totalCount: number;
    verifiedCount: number;
    cancelledCount: number;
    recordHighCount: number;
    riseCount: number;
    fallCount: number;
    byDealType: { sale: number; jeonse: number; wolse: number };
  };
  interpretation: string[];
  topDongs: [string, number][];
  topAreaBands: [string, number][];
  groups: { date: string; trades: FeedTradeRow[] }[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
  apiError: boolean;
}

const DEAL_TYPE_LABEL: Record<string, string> = { sale: '매매', jeonse: '전세', wolse: '월세' };
const DEAL_TYPE_VARIANT: Record<string, 'status' | 'neutral' | 'beta'> = { sale: 'status', jeonse: 'neutral', wolse: 'beta' };

function formatDateHeader(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function TransactionFeedView({ lawdCd, dong, displayRegionName }: { lawdCd: string; dong: string; displayRegionName: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState('7d');
  const [dealType, setDealType] = useState('');
  const [offset, setOffset] = useState(0);
  const [allTrades, setAllTrades] = useState<FeedTradeRow[]>([]);

  const params = new URLSearchParams({ lawdCd, dong, period: preset, offset: String(offset), limit: '50' });
  if (dealType) params.set('dealType', dealType);

  const { data, isLoading, error } = useSWR<FeedResponse>(`/api/stats/feed?${params.toString()}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
    onSuccess: (json) => {
      if (json.status !== 'OK') return;
      const flat = json.groups.flatMap((g) => g.trades);
      setAllTrades((prev) => (offset === 0 ? flat : [...prev, ...flat]));
    },
  });

  const handlePresetChange = (next: string) => {
    setPreset(next);
    setDealType(dealType); // 유지
    setOffset(0);
    setAllTrades([]);
  };
  const handleDealTypeChange = (next: string) => {
    setDealType(next);
    setOffset(0);
    setAllTrades([]);
  };

  const goToApt = (t: FeedTradeRow) => {
    const qs = new URLSearchParams({ lawdCd });
    if (t.dong) qs.set('dong', t.dong);
    router.push(`/apt/${encodeURIComponent(t.name)}?${qs.toString()}`);
  };

  // 표시용 그룹은 누적된 allTrades를 다시 날짜별로 묶는다(더보기로 페이지가
  // 늘어도 날짜 헤더가 중복되지 않게).
  const displayGroups: { date: string; trades: FeedTradeRow[] }[] = [];
  const groupMap = new Map<string, FeedTradeRow[]>();
  for (const t of allTrades) {
    if (!groupMap.has(t.dealDate)) groupMap.set(t.dealDate, []);
    groupMap.get(t.dealDate)!.push(t);
  }
  Array.from(groupMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([date, trades]) => displayGroups.push({ date, trades }));

  return (
    <div className={styles.wrap}>
      <div className={styles.periodRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.preset} className={`${styles.chip} ${preset === p.preset ? styles.chipActive : ''}`} onClick={() => handlePresetChange(p.preset)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={styles.dealTypeRow}>
        {DEAL_TYPE_OPTIONS.map((d) => (
          <button key={d.value || 'all'} className={`${styles.dealChip} ${dealType === d.value ? styles.dealChipActive : ''}`} onClick={() => handleDealTypeChange(d.value)}>
            {d.label}
          </button>
        ))}
      </div>

      {isLoading && offset === 0 ? (
        <InlineLoading message="실거래 데이터를 불러오는 중입니다..." />
      ) : error || data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data?.message || '실거래 데이터를 불러오지 못했어요.'} />
      ) : data?.apiError ? (
        <ErrorState variant="section" message="국토교통부 실거래 API 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." />
      ) : !data || data.summary.totalCount === 0 ? (
        <Empty variant="noData" title={`${displayRegionName}, ${PERIOD_OPTIONS.find((p) => p.preset === preset)?.label || ''} 기간 내 실거래가 없어요.`} description="다른 기간을 선택해보세요." showMascot={false} />
      ) : (
        <>
          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>{displayRegionName} · {data.period.label}</div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.verifiedCount}</span><span className={styles.summaryLabel}>실거래</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.recordHighCount}</span><span className={styles.summaryLabel}>신고가</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue} style={{ color: 'var(--up-color)' }}>{data.summary.riseCount}</span><span className={styles.summaryLabel}>상승거래</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue} style={{ color: 'var(--down-color)' }}>{data.summary.fallCount}</span><span className={styles.summaryLabel}>하락거래</span></div>
              {data.summary.cancelledCount > 0 && (
                <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.cancelledCount}</span><span className={styles.summaryLabel}>취소</span></div>
              )}
            </div>
          </div>

          {data.interpretation.length > 0 && (
            <div className={styles.insightCard}>
              {data.interpretation.map((line, i) => (
                <p key={i} className={styles.insightLine}>{line}</p>
              ))}
            </div>
          )}

          <div className={styles.freshnessNote}>실거래 신고 기준이며, 신고 시차로 최근 며칠간 거래는 이후 추가될 수 있어요.</div>

          {displayGroups.map((group) => (
            <div key={group.date} className={styles.dateGroup}>
              <div className={styles.dateHeader}>
                <Calendar size={13} aria-hidden="true" />
                <span>{formatDateHeader(group.date)}</span>
              </div>
              {group.trades.map((t) => (
                <button key={t.uid} className={styles.tradeRow} onClick={() => goToApt(t)}>
                  <div className={styles.tradeRowTop}>
                    <span className={styles.tradeName}>{t.name}</span>
                    <Badge variant={DEAL_TYPE_VARIANT[t.dealType]}>{DEAL_TYPE_LABEL[t.dealType]}</Badge>
                    {t.isRecordHigh && <Badge variant="positive">신고가</Badge>}
                    {t.dealCanceled && <Badge variant="warning">취소</Badge>}
                  </div>
                  <div className={styles.tradeRowMid}>
                    <span className={styles.tradePrice}>{t.priceLabel}</span>
                    {t.changeAmount != null && !t.dealCanceled && (
                      <span className={styles.tradeChange} style={{ color: directionColor(t.changeAmount) }}>
                        {t.changeAmount > 0 ? '+' : ''}{(t.changeAmount / 10000).toFixed(t.changeAmount % 10000 === 0 ? 0 : 1)}억 ({formatPercentChange(t.changePct)})
                      </span>
                    )}
                  </div>
                  <div className={styles.tradeRowMeta}>
                    <span>{t.dong}</span>
                    {t.excluUseArea != null && <span>{t.excluUseArea.toFixed(2)}㎡</span>}
                    {t.floorRaw != null && <span>{t.floorRaw}층</span>}
                    <span>{t.dealDate}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}

          {data.pagination.hasMore && (
            <button className={styles.loadMoreBtn} onClick={() => setOffset((o) => o + 50)} disabled={isLoading}>
              {isLoading ? '불러오는 중...' : '더보기'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
