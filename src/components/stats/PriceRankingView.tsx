'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { TrendingDown, TrendingUp, Award, AlertTriangle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { areaBandLabel } from '@/lib/regional-feed';
import styles from './PriceRankingView.module.css';

// STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING §3/§23. 세 화면이
// 공유하는 랭킹 UI. "단순 숫자 나열"이 아니라 비교 기준(과거 최고가/직전
// 거래)을 항상 함께 보여주고(§18 evidence display), deterministic
// interpretation(§17, API가 이미 계산해 내려줌)을 붙인다. LLM 호출 없음.

export type PriceRankingMode = 'decline' | 'record-high' | 'rising' | 'jeonse-risk';

// STATISTICS V2.1-3 §25 — 전세위험은 warning-orange 계열을 쓰고, red로 과도한
// 공포를 조성하지 않는다(down-color는 파랑, error/red 계열이 아님에 주의 —
// 기존 --warning-color 토큰을 그대로 재사용).
const MODE_META: Record<PriceRankingMode, { icon: typeof TrendingDown; color: string; soft: string; question: string }> = {
  decline: { icon: TrendingDown, color: 'var(--down-color)', soft: 'var(--down-soft)', question: '요즘 가격이 많이 내려온 단지는?' },
  'record-high': { icon: Award, color: 'var(--up-color)', soft: 'var(--up-soft)', question: '최근 최고가를 새로 쓴 단지는?' },
  rising: { icon: TrendingUp, color: 'var(--up-color)', soft: 'var(--up-soft)', question: '최근 가격이 많이 오른 단지는?' },
  'jeonse-risk': { icon: AlertTriangle, color: 'var(--warning-color)', soft: 'var(--warn-soft)', question: '최근 전세가격이 이전보다 낮아진 단지는?' },
};

// FIX_PRICE_RANKINGS_V2_1_1A — MOLIT 실거래 API가 단지/면적 단위 필터 없이
// 지역+월 단위로만 조회되는 구조라(감사 결과), "역대 최고가"를 무제한으로
// 보장할 수 없다(라이브 재조회 규모가 시도 전체 집계에서 그대로 폭증). 라벨은
// API의 historicalHighCoverageLabel을 그대로 표시에 사용하되, 응답이 없는
// 과도기(구버전 캐시 등)를 대비해 API의 lookbackMonths 상수와 동일한 기본값을
// fallback으로 둔다.
const DEFAULT_COVERAGE_LABEL = '2년';

const PERIOD_OPTIONS = [
  { value: '7d', label: '7일' },
  { value: '30d', label: '30일' },
  { value: '3m', label: '3개월' },
  { value: '6m', label: '6개월' },
  { value: '12m', label: '12개월' },
];

const SORT_OPTIONS: Record<PriceRankingMode, { value: string; label: string }[]> = {
  decline: [
    { value: 'declineRate', label: '하락률순' },
    { value: 'declineAmount', label: '하락금액순' },
    { value: 'recent', label: '최근거래순' },
  ],
  'record-high': [
    { value: 'recent', label: '최근순' },
    { value: 'deltaAmount', label: '2년최고가 상승액순' },
    { value: 'deltaRate', label: '2년최고가 상승률순' },
    { value: 'price', label: '거래가격순' },
  ],
  rising: [
    { value: 'riseRate', label: '상승률순' },
    { value: 'riseAmount', label: '상승금액순' },
    { value: 'recent', label: '최근거래순' },
  ],
  'jeonse-risk': [
    { value: 'declineRate', label: '하락률순' },
    { value: 'declineAmount', label: '하락금액순' },
    { value: 'recent', label: '최근거래순' },
  ],
};

interface PriceRankingRow {
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number | null;
  floorRaw: string | number | null;
  pyung: number | null;
  interpretation: string;
  /** §26 — 시도 전체 결과에서만 채워짐(구/군 짧은 이름, 예: "서구"). 동
   * 이름만으로는 여러 구에 걸쳐 모호할 수 있어 구+동을 함께 표시한다. */
  sigunguName: string | null;
  priceLabel: string;
  currentAmount: number;
  currentDate: string;
  // decline/record-high
  priorHighAmount?: number;
  priorHighDate?: string;
  declineAmount?: number;
  declinePct?: number;
  deltaAmount?: number;
  deltaPct?: number;
  // rising
  previousAmount?: number;
  previousDate?: string;
  riseAmount?: number;
  risePct?: number;
}

interface PriceRankingResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  mode: PriceRankingMode;
  region: { lawdCd: string | null; sidoCode: string | null; dong: string; sidoAll: boolean };
  period: { preset: string; from: string; to: string };
  historicalHighCoverageLabel: string | null;
  sort: string;
  rows: PriceRankingRow[];
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

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function PriceRankingView({
  mode,
  lawdCd,
  sidoCode,
  dong,
  displayRegionName,
}: {
  mode: PriceRankingMode;
  lawdCd: string | null;
  sidoCode: string;
  dong: string;
  displayRegionName: string;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState('30d');
  const [sort, setSort] = useState(SORT_OPTIONS[mode][0].value);
  const [areaBand, setAreaBand] = useState<string>('all');
  const [offset, setOffset] = useState(0);
  const [allRows, setAllRows] = useState<PriceRankingRow[]>([]);

  useEffect(() => {
    setOffset(0);
    setAllRows([]);
  }, [mode, lawdCd, sidoCode, dong, period, sort]);

  const query = lawdCd ? `lawdCd=${lawdCd}` : `sidoCode=${sidoCode}`;
  const url = `/api/stats/price-rankings?mode=${mode}&${query}&dong=${dong}&period=${period}&sort=${sort}&offset=${offset}&limit=30`;

  const { data, isLoading } = useSWR<PriceRankingResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60 * 1000,
    onSuccess: (json) => {
      if (json.status !== 'OK') return;
      setAllRows((prev) => (offset === 0 ? json.rows : [...prev, ...json.rows]));
    },
  });

  const meta = MODE_META[mode];
  const Icon = meta.icon;
  const coverageLabel = data?.historicalHighCoverageLabel || DEFAULT_COVERAGE_LABEL;
  // FIX_PRICE_RANKINGS_V2_1_1A §7/§8 — 메뉴 "최고가"는 향후 절대가격 순위
  // 기능을 위해 남겨두고, 이 화면(같은 단지·같은 면적의 조회 가능 범위 내
  // 최고가 경신)은 무제한을 뜻하는 "신고가" 대신 정직하게 범위를 밝힌
  // 라벨을 쓴다.
  const recordHighLabel = `${coverageLabel}최고가`;

  // §6 — 면적 필터는 표시용 10㎡ 구간 버킷일 뿐, 그룹핑/비교 identity는 항상
  // raw 전용면적 그대로 유지된다(areaBandLabel은 regional-feed.ts의 순수
  // display 전용 함수 재사용 — exclusiveArea/3.3058 아님).
  const areaBands = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      const band = areaBandLabel(r.excluUseArea);
      if (band) set.add(band);
    }
    return Array.from(set).sort((a, b) => parseInt(a) - parseInt(b));
  }, [allRows]);

  const filteredRows = useMemo(() => {
    if (areaBand === 'all') return allRows;
    return allRows.filter((r) => areaBandLabel(r.excluUseArea) === areaBand);
  }, [allRows, areaBand]);

  const goToApt = (r: PriceRankingRow) => {
    const qs = new URLSearchParams({ lawdCd: r.lawdCd });
    if (r.dong) qs.set('dong', r.dong);
    if (r.aptSeq) qs.set('aptSeq', r.aptSeq);
    router.push(`/apt/${encodeURIComponent(r.name)}?${qs.toString()}`);
  };

  // §26 — 시도 전체 결과는 구/군 + 동을 함께 표시(동 이름만으로는 여러 구에
  // 걸쳐 모호할 수 있음). 특정 구를 선택한 경우 동 이름만으로 충분하다.
  const regionLabel = (r: PriceRankingRow) => [r.sigunguName, r.dong].filter(Boolean).join(' ') || displayRegionName;

  return (
    <div className={styles.wrap}>
      <p className={styles.question}>{meta.question}</p>

      <div className={styles.filterRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.value} className={`${styles.chip} ${period === p.value ? styles.chipActive : ''}`} onClick={() => setPeriod(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.filterRow}>
        <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬 기준">
          {SORT_OPTIONS[mode].map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {areaBands.length > 1 && (
          <select className={styles.sortSelect} value={areaBand} onChange={(e) => setAreaBand(e.target.value)} aria-label="면적 필터">
            <option value="all">전체 면적</option>
            {areaBands.map((b) => (
              <option key={b} value={b}>{b}㎡대</option>
            ))}
          </select>
        )}
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
      ) : filteredRows.length === 0 ? (
        <Empty
          variant="noResult"
          title={
            mode === 'decline'
              ? `${PERIOD_OPTIONS.find((p) => p.value === period)?.label} 동안 이 지역에서 하락 거래가 없어요.`
              : mode === 'record-high'
                ? `${PERIOD_OPTIONS.find((p) => p.value === period)?.label} 동안 이 지역에서 ${recordHighLabel} 거래가 없어요.`
                : mode === 'jeonse-risk'
                  ? `${PERIOD_OPTIONS.find((p) => p.value === period)?.label} 동안 이 지역에서 조건에 맞는 전세가 하락 거래가 없어요.`
                  : `${PERIOD_OPTIONS.find((p) => p.value === period)?.label} 동안 이 지역에서 상승 거래가 없어요.`
          }
          description="기간을 넓히거나 지역을 변경해보세요."
        />
      ) : (
        <>
          <div className={styles.summary}>
            {displayRegionName} · {PERIOD_OPTIONS.find((p) => p.value === period)?.label} 동안{' '}
            {mode === 'decline' ? '하락' : mode === 'record-high' ? recordHighLabel : mode === 'jeonse-risk' ? '전세가 하락' : '상승'} 거래 {data?.pagination.total ?? filteredRows.length}건
          </div>

          {/* §19 — 이 데이터만으로 임대인의 보증금 반환 능력을 판단할 수 없다는
              고지를 항상 함께 보여준다(위험을 확정하지 않는다는 원칙의 UI 반영). */}
          {mode === 'jeonse-risk' && (
            <div className={styles.jeonseRiskDisclaimer}>
              실제 임대인의 보증금 반환 능력은 이 데이터만으로 판단할 수 없습니다.
            </div>
          )}

          <ul className={styles.list}>
            {filteredRows.map((r, i) => (
              <li key={`${r.groupKey}-${r.currentDate}-${i}`} className={styles.row} onClick={() => goToApt(r)}>
                <div className={styles.rowTop}>
                  <span className={styles.rank}>{i + 1}</span>
                  <div className={styles.rowInfo}>
                    <div className={styles.name}>{r.name}</div>
                    <div className={styles.meta}>
                      {regionLabel(r)}
                      {r.excluUseArea != null && ` · ${r.excluUseArea.toFixed(2)}㎡`}
                      {r.pyung != null && ` · ${r.pyung}평`}
                    </div>
                  </div>
                  <span className={styles.iconBadge} style={{ background: meta.soft, color: meta.color }}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                </div>

                <div className={styles.priceLine}>
                  <span className={styles.priceCurrent}>{r.priceLabel}</span>
                  {mode === 'decline' && r.declineAmount != null && (
                    <span className={styles.delta} style={{ color: 'var(--down-color)' }}>
                      ▼ {formatWon(r.declineAmount).replace('-', '')} · {formatPct(r.declinePct!)}
                    </span>
                  )}
                  {mode === 'record-high' && r.deltaAmount != null && (
                    <span className={styles.delta} style={{ color: 'var(--up-color)' }}>
                      ▲ {formatWon(r.deltaAmount).replace('+', '')} · {formatPct(r.deltaPct!)}
                    </span>
                  )}
                  {mode === 'rising' && r.riseAmount != null && (
                    <span className={styles.delta} style={{ color: 'var(--up-color)' }}>
                      ▲ {formatWon(r.riseAmount).replace('+', '')} · {formatPct(r.risePct!)}
                    </span>
                  )}
                  {mode === 'jeonse-risk' && r.declineAmount != null && (
                    <span className={styles.delta} style={{ color: 'var(--warning-color)' }}>
                      ▼ {formatWon(r.declineAmount).replace('-', '')} · {formatPct(r.declinePct!)}
                    </span>
                  )}
                </div>

                {/* §18 evidence display — 비교 기준을 항상 명시. decline/
                    record-high는 무제한 "역대"가 아니라 조회 가능 범위
                    (coverageLabel)로 명시적으로 범위를 밝힌다(FIX_PRICE_
                    RANKINGS_V2_1_1A §6 DATA CLAIM=DATA COVERAGE 원칙). */}
                <div className={styles.evidence}>
                  {mode === 'decline' && `최근 ${coverageLabel} 최고가 ${r.priorHighDate} 대비`}
                  {mode === 'record-high' && `최근 ${coverageLabel} 최고가 ${r.priorHighDate} 대비`}
                  {mode === 'rising' && `직전 거래 ${r.previousDate} 대비`}
                  {mode === 'jeonse-risk' && `직전 전세 거래 ${r.previousDate} 대비`}
                  {' · '}
                  {r.currentDate}
                  {r.floorRaw != null && ` · ${r.floorRaw}층`}
                </div>

                <p className={styles.interpretation}>{r.interpretation}</p>

                {mode === 'record-high' && (
                  <Badge variant="positive" className={styles.recordHighBadge}>{recordHighLabel}</Badge>
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
