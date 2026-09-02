'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Home } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import styles from './Area84RankingView.module.css';

// 84SQM_RANKING_V1 — "84㎡ 국민평형 순위". PriceRankingView(하락/2년최고가/상승/
// 전세위험)와 같은 API(/api/stats/price-rankings, mode=area84)·같은 필터/페이지네이션
// 관례를 쓰지만, row 의미 자체가 다르다(비교 기준 대비 변화가 아니라 "단지별 대표
// 거래 1건의 절대가격 순위"라 별도 컴포넌트로 분리했다 — docs/development/
// 84SQM_RANKING_V1.md §5 근거).

const PERIOD_OPTIONS = [
  { value: '1m', label: '1개월' },
  { value: '3m', label: '3개월' },
  { value: '6m', label: '6개월' },
  { value: '12m', label: '12개월' },
  { value: '24m', label: '24개월' },
];

const SORT_OPTIONS = [
  { value: 'price', label: '가격높은순' },
  { value: 'recent', label: '최근거래순' },
];

interface Area84Row {
  complexKey: string;
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number;
  floorRaw: string | number | null;
  pyung: number | null;
  currentAmount: number;
  currentDate: string;
  priceLabel: string;
  previousAmount: number | null;
  previousDate: string | null;
  changeAmount: number | null;
  changePct: number | null;
  isRecent2yHigh: boolean;
  recent2yHighDeltaPct: number | null;
  totalHouseholds: number | null;
  approvalDate: string | null;
  interpretation: string;
  sigunguName: string | null;
}

interface Area84Response {
  status: 'OK' | 'ERROR';
  message?: string;
  region: { lawdCd: string | null; sidoCode: string | null; dong: string; sidoAll: boolean };
  period: { preset: string; from: string; to: string };
  historicalHighCoverageLabel: string | null;
  summary: { totalCount: number; topAmount: number | null; medianAmount: number | null } | null;
  regionInterpretation: string | null;
  sort: string;
  rows: Area84Row[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
  apiError: boolean;
  partial: boolean;
  failedDistricts: string[];
}

function formatWon(amount: number): string {
  const sign = amount < 0 ? '-' : '+';
  const abs = Math.abs(amount);
  const eok = Math.floor(abs / 10000);
  const man = abs % 10000;
  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0 || parts.length === 0) parts.push(`${man.toLocaleString('ko-KR')}만`);
  return `${sign}${parts.join(' ')}원`;
}

function formatPct(pct: number): string {
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function formatEok(amount: number | null): string {
  if (amount == null) return '-';
  const eok = amount / 10000;
  return `${eok.toFixed(eok >= 10 ? 1 : 2)}억`;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function Area84RankingView({
  lawdCd,
  sidoCode,
  dong,
  displayRegionName,
  regionQuestionLabel,
}: {
  lawdCd: string | null;
  sidoCode: string;
  dong: string;
  displayRegionName: string;
  regionQuestionLabel: string;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState('12m');
  const [sort, setSort] = useState('price');
  const [offset, setOffset] = useState(0);
  // PERCEIVED_PERFORMANCE_V1 §12 — 클릭한 행만 즉시 흐리게 표시.
  const [navigatingKey, setNavigatingKey] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<Area84Row[]>([]);

  useEffect(() => {
    setOffset(0);
    setAllRows([]);
  }, [lawdCd, sidoCode, dong, period, sort]);

  const query = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const url = `/api/stats/price-rankings?mode=area84&${query}&dong=${dong}&period=${period}&sort=${sort}&offset=${offset}&limit=30`;

  const { data, isLoading } = useSWR<Area84Response>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
    onSuccess: (json) => {
      if (json.status !== 'OK') return;
      setAllRows((prev) => (offset === 0 ? json.rows : [...prev, ...json.rows]));
    },
  });

  const coverageLabel = data?.historicalHighCoverageLabel || '2년';

  const buildAptHref = (r: Area84Row) => {
    const qs = new URLSearchParams({ lawdCd: r.lawdCd });
    if (r.dong) qs.set('dong', r.dong);
    if (r.aptSeq) qs.set('aptSeq', r.aptSeq);
    return `/apt/${encodeURIComponent(r.name)}?${qs.toString()}`;
  };
  const goToApt = (r: Area84Row) => {
    setNavigatingKey(`${r.complexKey}-${r.groupKey}`);
    router.push(buildAptHref(r));
  };
  // PERCEIVED_PERFORMANCE_V1 §16
  const prefetchApt = (r: Area84Row) => router.prefetch(buildAptHref(r));

  const regionLabel = (r: Area84Row) => [r.sigunguName, r.dong].filter(Boolean).join(' ') || displayRegionName;
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || period;

  return (
    <div className={styles.wrap}>
      <p className={styles.question}>{regionQuestionLabel}</p>

      <div className={styles.filterRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.value} className={`${styles.chip} ${period === p.value ? styles.chipActive : ''}`} onClick={() => setPeriod(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.filterRow}>
        <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬 기준">
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {data?.partial && (
        <div className={styles.partialBanner}>
          일부 지역({data.failedDistricts.length}곳) 데이터 조회가 지연되고 있어요. 나머지 지역 결과만 우선 표시합니다.
        </div>
      )}

      {isLoading && offset === 0 ? (
        <InlineLoading message={`${displayRegionName} 데이터를 불러오고 있어요...`} />
      ) : data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data.message || '데이터를 불러오지 못했어요.'} />
      ) : data?.apiError ? (
        <ErrorState variant="section" message="국토교통부 실거래 API 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." />
      ) : allRows.length === 0 ? (
        <Empty
          variant="noResult"
          title={`선택한 기간에 확인된 84㎡ 거래가 없어요.`}
          description="기간을 넓히거나 지역을 변경해보세요."
        />
      ) : (
        <>
          <div className={styles.summary}>
            {displayRegionName} · 최근 {periodLabel} 84㎡ 매매 {data?.summary?.totalCount ?? allRows.length}개 단지
            {data?.summary?.medianAmount != null && ` · 중앙값 ${formatEok(data.summary.medianAmount)}`}
          </div>

          {data?.regionInterpretation && <p className={styles.regionInterpretation}>{data.regionInterpretation}</p>}

          <ul className={styles.list}>
            {allRows.map((r, i) => (
              <li
                key={`${r.complexKey}-${r.groupKey}-${i}`}
                className={styles.row}
                onClick={() => goToApt(r)}
                onMouseEnter={() => prefetchApt(r)}
                onTouchStart={() => prefetchApt(r)}
                style={navigatingKey === `${r.complexKey}-${r.groupKey}` ? { opacity: 0.5 } : undefined}
              >
                <div className={styles.rowTop}>
                  <span className={styles.rank}>{i + 1}</span>
                  <div className={styles.rowInfo}>
                    <div className={styles.name}>{r.name}</div>
                    <div className={styles.meta}>
                      {regionLabel(r)}
                      {r.totalHouseholds != null && ` · ${r.totalHouseholds.toLocaleString('ko-KR')}세대`}
                      {r.approvalDate && ` · ${r.approvalDate}`}
                    </div>
                  </div>
                  <span className={styles.iconBadge}>
                    <Home size={16} aria-hidden="true" />
                  </span>
                </div>

                <div className={styles.priceLine}>
                  <span className={styles.priceCurrent}>{r.priceLabel}</span>
                  {r.changeAmount != null && (
                    <span
                      className={styles.delta}
                      style={{ color: r.changeAmount >= 0 ? 'var(--up-color)' : 'var(--down-color)' }}
                    >
                      {r.changeAmount >= 0 ? '▲' : '▼'} {formatWon(r.changeAmount).replace(/^[+-]/, '')} · {formatPct(r.changePct!)}
                    </span>
                  )}
                </div>

                <div className={styles.evidence}>
                  {r.excluUseArea.toFixed(2)}㎡
                  {r.pyung != null && ` · ${r.pyung}평`}
                  {r.floorRaw != null && ` · ${r.floorRaw}층`}
                  {' · '}
                  {r.currentDate}
                  {r.previousDate && ` · 직전거래 ${r.previousDate} 대비`}
                </div>

                <p className={styles.interpretation}>{r.interpretation}</p>

                {r.isRecent2yHigh && (
                  <Badge variant="positive" className={styles.recentHighBadge}>최근 {coverageLabel} 최고</Badge>
                )}
              </li>
            ))}
          </ul>

          {data?.pagination.hasMore && (
            <button className={styles.loadMoreBtn} onClick={() => setOffset((o) => o + 30)} disabled={isLoading}>
              {isLoading ? '불러오는 중...' : '더보기'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
