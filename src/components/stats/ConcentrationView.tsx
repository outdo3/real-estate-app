'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { directionColor } from '@/lib/stats-format';
import styles from './ConcentrationView.module.css';

// STATISTICS V2.1-2 §19~§26 — "거래집중". 기존 top-traded(rankings.ts, 월
// 단위)를 대체한다 — 아실 "많이산단지" benchmark를 참고하되 day-precise 기간
// (7일/30일/3개월)과 "직전 동일 기간 대비 증감"을 추가한다. §23: 거래건수가
// 많다는 사실만으로 "인기"/"선호"를 단정하지 않는다 — 문구에서 절대 그런
// 표현을 쓰지 않는다(대단지·분양 시점 등 다른 이유일 수 있음).

interface PeriodOption {
  preset: string;
  label: string;
}
const PERIOD_OPTIONS: PeriodOption[] = [
  { preset: '7d', label: '최근 7일' },
  { preset: '30d', label: '최근 30일' },
  { preset: '3m', label: '최근 3개월' },
];
const DEAL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'sale', label: '매매' },
  { value: 'jeonse', label: '전세' },
  { value: 'wolse', label: '월세' },
];
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'count', label: '거래건수순' },
  { value: 'delta', label: '거래증가순' },
  { value: 'latest', label: '최근거래순' },
];

interface ConcentrationEntry {
  rank: number;
  name: string;
  dong: string;
  lawdCd: string;
  currentCount: number;
  previousCount: number;
  deltaCount: number;
  latestDealAmount: number;
  latestPriceLabel: string;
  latestDealDate: string;
  latestExcluUseArea: number | null;
  latestPyung: number | null;
  totalHouseholds: number | null;
  approvalDate: string | null;
}

interface ConcentrationResponse {
  status: 'OK' | 'ERROR';
  message?: string;
  region: { lawdCd: string | null; sidoCode: string | null; dong: string; sidoAll: boolean };
  dealType: 'sale' | 'jeonse' | 'wolse';
  period: { preset: string; from: string; to: string };
  previousPeriod: { from: string; to: string };
  entries: ConcentrationEntry[];
  complexCount: number;
  apiError: boolean;
  partial: boolean;
  failedDistricts: string[];
}

function ageLabel(approvalDate: string | null): string | null {
  if (!approvalDate) return null;
  const year = parseInt(approvalDate, 10);
  if (!Number.isFinite(year) || year < 1900) return null;
  const age = new Date().getFullYear() - year;
  return age >= 0 ? `${age}년차` : null;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function ConcentrationView({
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
  const searchParams = useSearchParams();
  // STATISTICS V2.1-2 §26/§31/§32 — 거래량 화면에서 "이 기간 거래가 많은 단지
  // 보기"로 넘어올 때 기간/거래유형을 쿼리스트링으로 유지한다(공유 가능한
  // 필터 최대 유지, 새 state 라이브러리 없이 기존 URL만 사용). 최초 진입
  // 시에만 반영하고, 이후 사용자가 칩을 바꾸면 이 화면의 로컬 상태를 따른다.
  const initialPeriod = searchParams.get('period');
  const initialDealType = searchParams.get('dealType');
  const [preset, setPreset] = useState(PERIOD_OPTIONS.some((p) => p.preset === initialPeriod) ? initialPeriod! : '30d');
  const [dealType, setDealType] = useState(DEAL_TYPE_OPTIONS.some((d) => d.value === initialDealType) ? initialDealType! : 'sale');
  const [sort, setSort] = useState('count');

  const params = lawdCd
    ? new URLSearchParams({ lawdCd, dong, period: preset, dealType, sort })
    : new URLSearchParams({ sidoCode, period: preset, dealType, sort });

  const { data, isLoading, error } = useSWR<ConcentrationResponse>(
    `/api/stats/concentration?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60 * 1000 }
  );

  const goToApt = (e: ConcentrationEntry) => {
    const qs = new URLSearchParams({ lawdCd: e.lawdCd });
    if (e.dong) qs.set('dong', e.dong);
    router.push(`/apt/${encodeURIComponent(e.name)}?${qs.toString()}`);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.chipRow}>
        {PERIOD_OPTIONS.map((p) => (
          <button key={p.preset} className={`${styles.chip} ${preset === p.preset ? styles.chipActive : ''}`} onClick={() => setPreset(p.preset)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={styles.chipRow}>
        {DEAL_TYPE_OPTIONS.map((d) => (
          <button key={d.value} className={`${styles.dealChip} ${dealType === d.value ? styles.dealChipActive : ''}`} onClick={() => setDealType(d.value)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className={styles.chipRow}>
        {SORT_OPTIONS.map((s) => (
          <button key={s.value} className={`${styles.sortChip} ${sort === s.value ? styles.sortChipActive : ''}`} onClick={() => setSort(s.value)}>
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <InlineLoading message="거래집중 데이터를 불러오는 중입니다..." />
      ) : error || data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data?.message || '거래집중 데이터를 불러오지 못했어요.'} />
      ) : data?.apiError ? (
        <ErrorState variant="section" message="국토교통부 실거래 API 응답이 지연되고 있어요. 잠시 후 다시 시도해주세요." />
      ) : !data || data.entries.length === 0 ? (
        <Empty variant="noData" title={`${displayRegionName}, ${PERIOD_OPTIONS.find((p) => p.preset === preset)?.label || ''} 기간 내 거래가 없어요.`} description="다른 기간을 선택해보세요." showMascot={false} />
      ) : (
        <>
          {data.partial && (
            <div className={styles.partialBanner}>
              일부 지역({data.failedDistricts.length}곳) 데이터 조회가 지연되고 있어요. 나머지 지역 결과만 우선 표시합니다.
            </div>
          )}

          <div className={styles.summaryCard}>
            {/* [§43/§25] deterministic 요약 — "인기"가 아니라 사실만: 집계 단지수 +
                1위 단지 거래건수. */}
            <div className={styles.summaryTitle}>{displayRegionName} · {PERIOD_OPTIONS.find((p) => p.preset === preset)?.label}</div>
            <div className={styles.summaryText}>
              집계된 단지 <strong>{data.complexCount}곳</strong> 중 거래가 가장 많았던 단지는 <strong>{data.entries[0].currentCount}건</strong>이었어요.
            </div>
            <div className={styles.previousNote}>이전 동일 기간: {data.previousPeriod.from}~{data.previousPeriod.to}</div>
          </div>

          <div className={styles.freshnessNote}>국토교통부 실거래 신고 자료 기준이며, 취소·정정으로 변경될 수 있어요. 거래건수 순위는 단지 규모·분양 시점 등에 따라 자연스럽게 달라질 수 있어 선호도를 뜻하지 않아요.</div>

          <div className={styles.list}>
            {data.entries.map((e) => (
              <button key={`${e.dong}-${e.name}`} className={styles.row} onClick={() => goToApt(e)}>
                <div className={styles.rankCol}>{e.rank}</div>
                <div className={styles.mainCol}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{e.name}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span>{e.dong}</span>
                    {ageLabel(e.approvalDate) && <span>{ageLabel(e.approvalDate)}</span>}
                    {e.totalHouseholds != null && <span>{e.totalHouseholds.toLocaleString('ko-KR')}세대</span>}
                  </div>
                </div>
                <div className={styles.metricCol}>
                  <span className={styles.countValue}>{e.currentCount}건</span>
                  <span className={styles.deltaValue} style={{ color: e.deltaCount === 0 ? 'var(--text-secondary)' : directionColor(e.deltaCount) }}>
                    직전 {e.previousCount}건 {e.deltaCount > 0 ? '▲' : e.deltaCount < 0 ? '▼' : ''}{e.deltaCount !== 0 ? Math.abs(e.deltaCount) : ''}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
