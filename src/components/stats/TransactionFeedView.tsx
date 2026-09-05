'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
// PERFORMANCE_V2 §10 — 목록 누적은 순수 로직으로 분리했다(회귀 테스트 있음).
import {
  buildFeedQueryKey,
  emptyFeedPages,
  mergeFeedPage,
  resolveVisibleFeed,
  groupTradesByDate,
  type FeedPages,
} from '@/lib/stats/feed-accumulator';
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
  lawdCd: string;
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
  recentTrend: { dealAmount: number; dealDate: string }[] | null;
  totalHouseholds: number | null;
  approvalDate: string | null;
}

interface FeedResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  region: { lawdCd: string | null; sidoCode: string | null; dong: string; sidoAll: boolean };
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
  partial: boolean;
  failedDistricts: string[];
  recordHighWindow: { from: string; to: string };
  recordHighCoverageLabel: string;
}

const DEAL_TYPE_LABEL: Record<string, string> = { sale: '매매', jeonse: '전세', wolse: '월세' };
const DEAL_TYPE_VARIANT: Record<string, 'status' | 'neutral' | 'beta'> = { sale: 'status', jeonse: 'neutral', wolse: 'beta' };

function formatDateHeader(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m, 10)}월 ${parseInt(d, 10)}일`;
}

// approvalDate는 "YYYY년"(캐싱 원본 표기, apartments.approval_date 코멘트 참고)
// 형태로 저장돼 있다 — 여기서는 그대로 "N년차"만 계산한다(가공/추정 없음).
function ageLabel(approvalDate: string | null): string | null {
  if (!approvalDate) return null;
  const year = parseInt(approvalDate, 10);
  if (!Number.isFinite(year) || year < 1900) return null;
  const age = new Date().getFullYear() - year;
  return age >= 0 ? `${age}년차` : null;
}

// mini price trend(§9) — 실제 거래만, 미래 leakage 없음(서버가 이미 시간순
// 검증된 최근 5건까지만 내려줌). 장식용 SVG라 aria-hidden, 방향/수치는 이미
// 위 텍스트(changeAmount/changePct, ▲▼ 배지)로 전달되므로 색상만으로 의미를
// 전달하지 않는다(§42).
function MiniTrend({ points }: { points: { dealAmount: number; dealDate: string }[] }) {
  const w = 56;
  const h = 20;
  const amounts = points.map((p) => p.dealAmount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const range = max - min || 1;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = i * step;
    const y = h - ((p.dealAmount - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = amounts[amounts.length - 1] >= amounts[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className={styles.miniTrend}>
      <polyline points={coords.join(' ')} fill="none" stroke={rising ? 'var(--up-color)' : 'var(--down-color)'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function TransactionFeedView({
  lawdCd,
  sidoCode,
  dong,
  displayRegionName,
}: {
  lawdCd: string | null;
  sidoCode: string;
  dong: string;
  displayRegionName: string;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState('7d');
  const [dealType, setDealType] = useState('');
  const [offset, setOffset] = useState(0);

  // PERFORMANCE_V2 §10 — 누적본은 "그것을 만든 쿼리 키"와 함께 들고 다닌다.
  const queryKey = buildFeedQueryKey({ lawdCd, sidoCode, dong, preset, dealType });
  const [pages, setPages] = useState<FeedPages<FeedTradeRow>>(() => emptyFeedPages(queryKey));

  // STATISTICS REGION FILTER V2 §15 — 지역이 바뀌면 페이지 위치를 처음으로 되돌린다.
  // 누적본 자체는 queryKey가 갈라 주므로 여기서 비우지 않는다(전환 중 깜빡임 방지, §16).
  useEffect(() => {
    setOffset(0);
  }, [lawdCd, sidoCode, dong]);

  const params = lawdCd
    ? new URLSearchParams({ lawdCd, dong, period: preset, offset: String(offset), limit: '50' })
    : new URLSearchParams({ sidoCode, period: preset, offset: String(offset), limit: '50' });
  if (dealType) params.set('dealType', dealType);

  const { data, isLoading, error } = useSWR<FeedResponse>(`/api/stats/feed?${params.toString()}`, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
  });

  // PERFORMANCE_V2 §10 — 목록을 SWR `onSuccess`로 상태에 복사하지 않는다.
  // `onSuccess`는 **실제 fetch에서만** 불리므로, 전체 → 매매 → 전체 처럼 이미 캐시에 있는
  // 키로 돌아오면 호출되지 않는다. 그러면 data는 정상인데 목록 상태만 빈 채로 남아
  // "상단 지표는 바뀌는데 하단 단지 목록만 사라지는" 버그가 된다(사용자 보고 증상).
  // 대신 현재 응답에서 파생시키고, 더보기 페이지만 offset별로 누적한다.
  useEffect(() => {
    if (!data || data.status !== 'OK') return;
    const flat = data.groups.flatMap((g) => g.trades);
    setPages((prev) => mergeFeedPage(prev, queryKey, offset, flat));
  }, [data, queryKey, offset]);

  const handlePresetChange = (next: string) => {
    setPreset(next);
    setOffset(0);
  };
  const handleDealTypeChange = (next: string) => {
    setDealType(next);
    setOffset(0);
  };

  // STATISTICS REGION FILTER V2 — 시도 전체 집계에서는 거래마다 소속 구가 다를
  // 수 있어(예: 부산 전체 보기 중 서구 거래와 해운대구 거래가 섞여 있음),
  // region 레벨의 lawdCd(시도 전체일 때는 null)가 아니라 그 거래 자신의
  // lawdCd(t.lawdCd, API가 채워 보냄)로 canonical 이동해야 다른 구 단지로
  // 잘못 연결되지 않는다.
  const goToApt = (t: FeedTradeRow) => {
    const qs = new URLSearchParams({ lawdCd: t.lawdCd });
    if (t.dong) qs.set('dong', t.dong);
    if (t.aptSeq) qs.set('aptSeq', t.aptSeq);
    router.push(`/apt/${encodeURIComponent(t.name)}?${qs.toString()}`);
  };

  // §16 — 필터/지역 전환 중에는 이전 목록을 그대로 두고 stale로만 표시한다.
  // 목록이 잠깐 비었다가 다시 차는 깜빡임이 "느리다"는 체감의 큰 부분이었다.
  const { trades: visibleTrades, isStale } = resolveVisibleFeed(pages, queryKey);
  const displayGroups = useMemo(() => groupTradesByDate(visibleTrades), [visibleTrades]);

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

      {isLoading && offset === 0 && visibleTrades.length === 0 ? (
        <InlineLoading message="실거래 데이터를 불러오는 중입니다..." />
      ) : error || data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data?.message || '실거래 데이터를 불러오지 못했어요.'} />
      ) : data?.apiError ? (
        <ErrorState variant="section" message="국토교통부 실거래 API 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." />
      ) : !data || (!isStale && data.summary.totalCount === 0 && visibleTrades.length === 0) ? (
        <Empty variant="noData" title={`${displayRegionName}, ${PERIOD_OPTIONS.find((p) => p.preset === preset)?.label || ''} 기간 내 실거래가 없어요.`} description="다른 기간을 선택해보세요." showMascot={false} />
      ) : (
        <>
          {data.partial && (
            <div className={styles.partialBanner}>
              일부 지역({data.failedDistricts.length}곳) 데이터 조회가 지연되고 있어요. 나머지 지역 실거래만 우선 표시합니다.
            </div>
          )}

          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>{displayRegionName} · {data.period.label}</div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.verifiedCount}</span><span className={styles.summaryLabel}>실거래</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.recordHighCount}</span><span className={styles.summaryLabel}>{data.recordHighCoverageLabel}최고가</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue} style={{ color: 'var(--up-color)' }}>{data.summary.riseCount}</span><span className={styles.summaryLabel}>상승거래</span></div>
              <div className={styles.summaryItem}><span className={styles.summaryValue} style={{ color: 'var(--down-color)' }}>{data.summary.fallCount}</span><span className={styles.summaryLabel}>하락거래</span></div>
              {data.summary.cancelledCount > 0 && (
                <div className={styles.summaryItem}><span className={styles.summaryValue}>{data.summary.cancelledCount}</span><span className={styles.summaryLabel}>취소</span></div>
              )}
            </div>
            <div className={styles.recordHighWindowNote}>
              {data.recordHighCoverageLabel}최고가/직전거래 비교 기준: {data.recordHighWindow.from}~{data.recordHighWindow.to}
              {data.region.sidoAll ? '(시도 전체 보기는 표시 기간 내 비교만 지원돼요)' : ''}
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
                    {/* [STATISTICS V2.1-2 §11/§20] "신고가"(무제한 주장) 대신 실제
                        조회 범위를 밝힌 bounded label만 쓴다 — record-high 화면과
                        동일 원칙. */}
                    {t.isRecordHigh && <Badge variant="positive">{data.recordHighCoverageLabel}최고</Badge>}
                    {t.dealCanceled && <Badge variant="warning">취소</Badge>}
                  </div>
                  <div className={styles.tradeRowMid}>
                    <span className={styles.tradePrice}>{t.priceLabel}</span>
                    {t.changeAmount != null && !t.dealCanceled && (
                      <span className={styles.tradeChange} style={{ color: directionColor(t.changeAmount) }}>
                        {t.changeAmount > 0 ? '+' : ''}{(t.changeAmount / 10000).toFixed(t.changeAmount % 10000 === 0 ? 0 : 1)}억 ({formatPercentChange(t.changePct)})
                      </span>
                    )}
                    {t.recentTrend && t.recentTrend.length >= 3 && <MiniTrend points={t.recentTrend} />}
                  </div>
                  <div className={styles.tradeRowMeta}>
                    <span>{t.dong}</span>
                    {ageLabel(t.approvalDate) && <span>{ageLabel(t.approvalDate)}</span>}
                    {t.totalHouseholds != null && <span>{t.totalHouseholds.toLocaleString('ko-KR')}세대</span>}
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
