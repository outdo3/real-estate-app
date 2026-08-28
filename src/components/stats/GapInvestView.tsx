'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { useRegion } from '@/contexts/RegionContext';
import { directionColor } from '@/lib/stats-format';
import styles from './GapInvestView.module.css';

// STATISTICS V2.1-3 §7/§27/§28 — 갭투자는 "단지 순위"보다 "어느 지역에서 갭
// 형태 거래가 늘고 있는가"가 먼저다. 시도 전체 → 시군구 랭킹, 특정 구 선택
// → 동 랭킹, 동까지 선택 → 단지 랭킹만 보여준다. drill-down은 새 breadcrumb
// UI를 만들지 않고 기존 RegionContext.setRegion을 그대로 재사용한다(다른
// 모든 통계 화면과 동일한 지역 선택 상태를 공유 — §29 scope 최소화).

interface RegionRow {
  code: string;
  name: string;
  gapCount: number;
  totalSaleCount: number;
  ratioPct: number | null;
  previousCount: number | null;
}

interface ApartmentRow {
  rank: number;
  groupKey: string;
  name: string;
  dong: string;
  lawdCd: string | null;
  aptSeq: string | null;
  exclusiveAreaM2: number;
  saleAmount: number;
  saleDate: string;
  jeonseAmount: number;
  jeonseDate: string;
  gap: number;
  medianGap: number | null;
  gapRatePct: number | null;
  dealCount: number;
  pyung: number | null;
  saleLabel: string;
  jeonseLabel: string;
  gapLabel: string;
  totalHouseholds: number | null;
  approvalDate: string | null;
}

interface GapInvestResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  region: { lawdCd: string | null; sidoCode: string | null; dong: string; sidoAll: boolean };
  scope: 'sido' | 'district' | 'dong';
  period: { preset: string; from: string; to: string };
  previousPeriod: { from: string; to: string } | null;
  summary: {
    totalSaleCount: number;
    gapEventCount: number;
    ratioPct: number | null;
    previousGapEventCount: number | null;
    previousTotalSaleCount: number | null;
    changeCount: number | null;
    medianGap: number | null;
  };
  regionRanking: RegionRow[];
  apartmentRanking: ApartmentRow[];
  monthlyTrend: { month: string; count: number }[];
  apiError: boolean;
  partial: boolean;
  failedDistricts: string[];
}

const PERIOD_OPTIONS = [
  { value: '30d', label: '최근 30일' },
  { value: '3m', label: '최근 3개월' },
  { value: '6m', label: '최근 6개월' },
  { value: '12m', label: '최근 12개월' },
];
const SORT_OPTIONS = [
  { value: 'count', label: '거래건수순' },
  { value: 'rate', label: '비율순' },
  { value: 'increase', label: '증가순' },
];

function formatWon(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const eok = Math.floor(abs / 10000);
  const man = abs % 10000;
  const parts: string[] = [];
  if (eok > 0) parts.push(`${eok}억`);
  if (man > 0 || parts.length === 0) parts.push(`${man.toLocaleString('ko-KR')}만`);
  return `${sign}${parts.join(' ')}`;
}

function ageLabel(approvalDate: string | null): string | null {
  if (!approvalDate) return null;
  const year = parseInt(approvalDate, 10);
  if (!Number.isFinite(year) || year < 1900) return null;
  const age = new Date().getFullYear() - year;
  return age >= 0 ? `${age}년차` : null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function GapInvestView({
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
  const { region, setRegion } = useRegion();
  const [period, setPeriod] = useState('3m');
  const [sort, setSort] = useState('count');

  const params = lawdCd
    ? new URLSearchParams({ lawdCd, dong, period, sort })
    : new URLSearchParams({ sidoCode, period, sort });

  const { data, isLoading, error } = useSWR<GapInvestResponse>(
    `/api/stats/gap-invest?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60 * 1000 }
  );

  const drillToDistrict = (row: RegionRow) => {
    setRegion({
      lawdCd: row.code,
      sidoCode: region.sidoCode,
      dong: 'all',
      sido: region.sido,
      sigungu: row.name,
      displayRegionName: `${region.sido} ${row.name}`,
    });
  };

  const drillToDong = (row: RegionRow) => {
    if (!lawdCd) return;
    setRegion({
      lawdCd,
      sidoCode: region.sidoCode,
      dong: row.name,
      sido: region.sido,
      sigungu: region.sigungu,
      displayRegionName: `${region.sido} ${region.sigungu} ${row.name}`,
    });
  };

  const goToApt = (r: ApartmentRow) => {
    const qs = new URLSearchParams({ lawdCd: r.lawdCd || lawdCd || '' });
    if (r.dong) qs.set('dong', r.dong);
    router.push(`/apt/${encodeURIComponent(r.name)}?${qs.toString()}`);
  };

  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)?.label || '';

  return (
    <div className={styles.wrap}>
      <p className={styles.question}>최근 갭 형태 거래가 많은 지역은?</p>

      <div className={styles.chipRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.value} className={`${styles.chip} ${period === p.value ? styles.chipActive : ''}`} onClick={() => setPeriod(p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      {data?.regionRanking && data.regionRanking.length > 1 && (
        <div className={styles.chipRow}>
          {SORT_OPTIONS.map((s) => (
            <button key={s.value} className={`${styles.sortChip} ${sort === s.value ? styles.sortChipActive : ''}`} onClick={() => setSort(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <InlineLoading message="분석 중입니다..." />
      ) : error || data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data?.message || '갭투자 데이터를 불러오지 못했어요.'} />
      ) : data?.apiError ? (
        <ErrorState variant="section" message="국토교통부 실거래 API 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." />
      ) : (
        <>
          {data?.partial && (
            <div className={styles.partialBanner}>
              일부 지역({data.failedDistricts.length}곳) 데이터 조회가 지연되고 있어요. 나머지 지역 결과만 우선 표시합니다.
            </div>
          )}

          <div className={styles.summaryCard}>
            <div className={styles.summaryTitle}>{displayRegionName} · {periodLabel}</div>
            {data && data.summary.totalSaleCount > 0 ? (
              <>
                <div className={styles.summaryText}>
                  전체 매매거래 <strong>{data.summary.totalSaleCount}건</strong> 중 갭투자 형태 거래{' '}
                  <strong>{data.summary.gapEventCount}건</strong>
                  {data.summary.ratioPct != null && <> · <strong>{data.summary.ratioPct}%</strong></>}
                </div>
                {data.summary.changeCount != null && (
                  <div className={styles.previousNote}>
                    이전 동일 기간 {data.summary.previousGapEventCount}건{' '}
                    <span style={{ color: data.summary.changeCount === 0 ? 'var(--text-secondary)' : directionColor(data.summary.changeCount) }}>
                      {data.summary.changeCount > 0 ? '▲' : data.summary.changeCount < 0 ? '▼' : ''}
                      {data.summary.changeCount !== 0 ? Math.abs(data.summary.changeCount) : ''}
                    </span>
                  </div>
                )}
                {data.summary.medianGap != null && (
                  <div className={styles.previousNote}>매매·전세 차이 중앙값 {formatWon(data.summary.medianGap)}</div>
                )}
              </>
            ) : (
              <div className={styles.summaryText}>{periodLabel} 동안 이 지역에서 조건에 맞는 매매 거래가 없어요.</div>
            )}
          </div>

          {data && data.monthlyTrend.some((m) => m.count > 0) && (
            <div className={styles.trendCard}>
              <div className={styles.trendTitle}>월별 갭투자 형태 거래건수(최근 12개월)</div>
              <div className={styles.trendBars}>
                {data.monthlyTrend.map((m) => {
                  const max = Math.max(1, ...data.monthlyTrend.map((x) => x.count));
                  return (
                    <div key={m.month} className={styles.trendBarCol}>
                      <div className={styles.trendBar} style={{ height: `${Math.max(4, (m.count / max) * 48)}px` }} title={`${m.month}: ${m.count}건`} />
                      <div className={styles.trendMonth}>{m.month}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.freshnessNote}>
            국토교통부 실거래 신고 자료 기준이며, 취소·정정으로 변경될 수 있어요. 매매·전세 계약 시점(날짜)이 최대 90일 이내로 가까운 거래만 갭투자 형태 거래로 인정해요 — 실제 계약 당사자·보증금 승계 여부까지 확인된 것은 아니라 참고용으로만 활용하세요.
          </div>

          {data && data.regionRanking.length > 0 && (
            <div className={styles.list}>
              {data.regionRanking.map((r) => (
                <button
                  key={r.code}
                  className={styles.row}
                  onClick={() => (data.scope === 'sido' ? drillToDistrict(r) : drillToDong(r))}
                >
                  <div className={styles.mainCol}>
                    <span className={styles.name}>{r.name}</span>
                    <span className={styles.metaRow}>전체 {r.totalSaleCount}건</span>
                  </div>
                  <div className={styles.metricCol}>
                    <span className={styles.countValue}>{r.gapCount}건{r.ratioPct != null && ` · ${r.ratioPct}%`}</span>
                    {r.previousCount != null && (
                      <span className={styles.deltaValue} style={{ color: r.gapCount === r.previousCount ? 'var(--text-secondary)' : directionColor(r.gapCount - r.previousCount) }}>
                        이전 {r.previousCount}건 {r.gapCount > r.previousCount ? '▲' : r.gapCount < r.previousCount ? '▼' : ''}
                        {r.gapCount !== r.previousCount ? Math.abs(r.gapCount - r.previousCount) : ''}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className={styles.aptSectionTitle}>단지별 갭투자 형태 거래</div>
          {!data || data.apartmentRanking.length === 0 ? (
            <Empty variant="noResult" title={`${periodLabel} 동안 이 지역에서 조건에 맞는 갭 형태 거래가 없어요.`} description="매매·전세 계약 시점이 90일 이내로 가까운 거래만 인정돼요." />
          ) : (
            <ul className={styles.aptList}>
              {data.apartmentRanking.map((r) => (
                <li key={r.groupKey} className={styles.aptRow} onClick={() => goToApt(r)}>
                  <div className={styles.aptTop}>
                    <span className={styles.aptRank}>{r.rank}</span>
                    <div className={styles.aptInfo}>
                      <div className={styles.aptName}>{r.name}</div>
                      <div className={styles.aptMeta}>
                        {r.dong}
                        {r.pyung != null ? ` · ${r.pyung}평` : ` · ${r.exclusiveAreaM2.toFixed(2)}㎡`}
                        {ageLabel(r.approvalDate) && ` · ${ageLabel(r.approvalDate)}`}
                        {r.totalHouseholds != null && ` · ${r.totalHouseholds.toLocaleString('ko-KR')}세대`}
                      </div>
                    </div>
                  </div>
                  <div className={styles.aptPriceLine}>
                    <span>매매 {r.saleLabel}</span>
                    <span>전세 {r.jeonseLabel}</span>
                    <span className={styles.aptGap}>갭 {r.gapLabel}</span>
                  </div>
                  <div className={styles.aptEvidence}>
                    {r.gapRatePct != null && `최근 매매·전세 기준 전세가율 ${r.gapRatePct}%`}
                    {' · '}매매 {r.saleDate} · 전세 {r.jeonseDate}
                    {r.dealCount > 1 && ` · 최근 ${periodLabel} ${r.dealCount}건`}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
