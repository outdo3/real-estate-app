'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import { useRegion } from '@/contexts/RegionContext';
import styles from './LargeComplexView.module.css';

// STATISTICS V2.1-4 §17/§21/§23 — "세대수가 많은 단지는?" 부산 전용 V1(§14 실측:
// ApartmentMaster는 부산 데이터만 있음). 부산 외 지역 선택 시 빈 화면 대신 정직한
// unsupported 상태를 보여준다(§22/§40 — 데이터 없는 상태를 "0건"처럼 위장하지 않음).

interface ComplexItem {
  rank: number;
  id: number;
  name: string;
  aptSeq: string | null;
  lawdCd: string | null;
  sigungu: string | null;
  dong: string | null;
  totalHouseholds: number | null;
  buildYear: number | null;
  parkingPerHousehold: number | null;
  recentTrade: { dealAmount: number; dealDate: string; priceLabel: string } | null;
}

interface LargeComplexResponse {
  status: 'OK' | 'UNSUPPORTED' | 'ERROR';
  message?: string;
  supportedSidoCode?: string;
  supportedSidoName?: string;
  scope?: { sidoCode: string; sidoName: string; lawdCd: string | null; dong: string | null; scopeLabel: string };
  minHouseholds?: number;
  total?: number;
  items?: ComplexItem[];
  pagination?: { offset: number; limit: number; total: number; hasMore: boolean };
}

const HOUSEHOLD_FILTERS = [
  { value: '0', label: '전체' },
  { value: '500', label: '500세대+' },
  { value: '1000', label: '1,000세대+' },
  { value: '2000', label: '2,000세대+' },
];

const PAGE_SIZE = 30;
const BUSAN_REGION = { lawdCd: '26140', sidoCode: '26', dong: 'all', sido: '부산광역시', sigungu: '서구', displayRegionName: '부산광역시 서구 동 전체' };

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export default function LargeComplexView({
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
  const { setRegion } = useRegion();
  const [minHouseholds, setMinHouseholds] = useState('0');
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<ComplexItem[]>([]);

  useEffect(() => {
    setOffset(0);
    setAllItems([]);
  }, [lawdCd, sidoCode, dong, minHouseholds]);

  const params = new URLSearchParams({ sidoCode, minHouseholds, offset: String(offset), limit: String(PAGE_SIZE) });
  if (lawdCd) params.set('lawdCd', lawdCd);
  if (dong && dong !== 'all') params.set('dong', dong);

  const { data, isLoading } = useSWR<LargeComplexResponse>(
    `/api/stats/large-complex?${params.toString()}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60 * 1000,
      onSuccess: (json) => {
        if (json.status !== 'OK' || !json.items) return;
        setAllItems((prev) => (offset === 0 ? json.items! : [...prev, ...json.items!]));
      },
    }
  );

  const goToApt = (item: ComplexItem) => {
    const qs = new URLSearchParams({ lawdCd: item.lawdCd || '' });
    if (item.dong) qs.set('dong', item.dong);
    router.push(`/apt/${encodeURIComponent(item.name)}?${qs.toString()}`);
  };

  if (data?.status === 'UNSUPPORTED') {
    return (
      <div className={styles.wrap}>
        <Empty
          variant="notReady"
          title={data.message || '대단지 순위는 현재 부산 지역부터 제공하고 있어요.'}
          description="다른 지역은 데이터를 준비 중이에요."
        />
        <button className={styles.busanCta} onClick={() => setRegion(BUSAN_REGION)}>
          부산으로 이동
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.question}>세대수가 많은 단지는?</p>

      <div className={styles.chipRow}>
        {HOUSEHOLD_FILTERS.map((f) => (
          <button key={f.value} className={`${styles.chip} ${minHouseholds === f.value ? styles.chipActive : ''}`} onClick={() => setMinHouseholds(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && offset === 0 ? (
        <InlineLoading message={`${displayRegionName} 대단지 데이터를 불러오고 있어요...`} />
      ) : data?.status === 'ERROR' ? (
        <ErrorState variant="section" message={data.message || '데이터를 불러오지 못했어요.'} />
      ) : allItems.length === 0 ? (
        <Empty variant="noResult" title="조건에 맞는 대단지가 없어요." description="세대수 필터를 낮춰보세요." />
      ) : (
        <>
          <div className={styles.summary}>
            {data?.scope?.scopeLabel || displayRegionName} · 세대수 많은 순 {data?.total?.toLocaleString('ko-KR')}개 단지
          </div>

          <ul className={styles.list}>
            {allItems.map((item) => (
              <li key={item.id} className={styles.row} onClick={() => goToApt(item)}>
                <div className={styles.rowTop}>
                  <span className={styles.rank}>{item.rank}</span>
                  <div className={styles.rowInfo}>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>
                      {[item.sigungu, item.dong].filter(Boolean).join(' ')}
                      {item.buildYear && ` · ${item.buildYear}년 입주`}
                    </div>
                  </div>
                </div>
                <div className={styles.householdLine}>
                  <span className={styles.householdValue}>{item.totalHouseholds?.toLocaleString('ko-KR')}세대</span>
                  {item.totalHouseholds != null && item.totalHouseholds >= 1000 && (
                    <span className={styles.largeBadge}>대단지</span>
                  )}
                </div>
                <div className={styles.subLine}>
                  {item.parkingPerHousehold != null && <span>주차 {item.parkingPerHousehold}대/세대</span>}
                  {item.recentTrade && <span>최근 매매 {item.recentTrade.priceLabel}</span>}
                </div>
                <div className={styles.interpretation}>
                  {(data?.scope?.scopeLabel || '부산 전체')} {item.rank}위
                </div>
              </li>
            ))}
          </ul>

          {data?.pagination?.hasMore && (
            <button className={styles.loadMoreBtn} onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={isLoading}>
              {isLoading ? '불러오는 중...' : '더보기'}
            </button>
          )}

          <div className={styles.freshnessNote}>
            건축물대장 공식 데이터 기준(부산 지역). 평형 수 정보는 아직 충분히 확보되지
            않아 표시하지 않아요.
          </div>
        </>
      )}
    </div>
  );
}
