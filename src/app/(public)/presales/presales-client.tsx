'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Header from '@/components/Header';
import FilterBar from '@/components/ui/FilterBar';
import SelectFilter from '@/components/ui/SelectFilter';
import Card from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import InlineLoading from '@/components/ui/InlineLoading';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type PresaleStatus = 'upcoming' | 'ongoing' | 'closed' | 'unsold';

type PresaleItem = {
  id: number;
  houseName: string;
  locationAddress: string;
  subscriptionAreaName: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  totalSupplyHouseholds: number | null;
  moveInExpectedYm: string | null;
  pblancUrl: string | null;
  status: PresaleStatus;
};

const STATUS_OPTIONS: { value: PresaleStatus; label: string }[] = [
  { value: 'ongoing', label: '접수중' },
  { value: 'upcoming', label: '접수예정' },
  { value: 'closed', label: '접수마감' },
  { value: 'unsold', label: '무순위(잔여세대)' },
];

const STATUS_LABEL: Record<PresaleStatus, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.value, o.label])
) as Record<PresaleStatus, string>;

const STATUS_BADGE_CLASS: Record<PresaleStatus, string> = {
  ongoing: styles.badgeOngoing,
  upcoming: styles.badgeUpcoming,
  closed: styles.badgeClosed,
  unsold: styles.badgeUnsold,
};

const PRICE_OPTIONS = [
  { value: '', label: '전체' },
  { value: '30000', label: '3억 이하' },
  { value: '50000', label: '5억 이하' },
  { value: '70000', label: '7억 이하' },
  { value: '100000', label: '10억 이하' },
  { value: 'over', label: '10억 초과' },
];

function formatManwon(v: number): string {
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok === 0) return `${man.toLocaleString()}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString()}만원`;
}

function formatPriceRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return '가격 미공개';
  if (min != null && max != null && min === max) return formatManwon(min);
  if (min != null && max != null) return `${formatManwon(min)} ~ ${formatManwon(max)}`;
  return formatManwon((min ?? max) as number);
}

function formatMoveIn(ym: string | null): string {
  if (!ym || !/^\d{6}$/.test(ym)) return '입주예정 정보 없음';
  const year = ym.slice(0, 4);
  const month = parseInt(ym.slice(4, 6), 10);
  return `${year}년 ${month}월 예정`;
}

function formatHouseholds(n: number | null): string {
  if (n == null) return '세대수 정보 없음';
  return `총 ${n.toLocaleString()}세대`;
}

// 재개발·분양 허브(/redevelopment)의 '분양·청약' 탭에서도 이 목록을 그대로
// 재사용한다(같은 목록 UI 복제 금지) — Header/intro가 없는 섹션만 필요하므로
// 별도 컴포넌트로 분리해서 export.
export function PresaleListSection() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('');
  const [priceMax, setPriceMax] = useState('');

  const params = new URLSearchParams();
  params.set('page', String(page));
  if (region) params.set('region', region);
  if (status) params.set('status', status);
  if (priceMax) params.set('priceMax', priceMax);

  const { data, isLoading } = useSWR(`/api/presales?${params.toString()}`, fetcher);

  const items: PresaleItem[] = data?.success ? data.data.items : [];
  const total = data?.success ? data.data.total : 0;
  const totalPages = data?.success ? data.data.totalPages : 1;
  const regions: string[] = data?.success ? data.data.regions : [];
  const fetchError = data && !data.success ? data.error : null;

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <>
        <FilterBar>
          <SelectFilter
            value={region}
            onChange={handleFilterChange(setRegion)}
            aria-label="지역 선택"
            options={[{ value: '', label: '전체 지역' }, ...regions.map((r) => ({ value: r, label: r }))]}
          />
          <SelectFilter
            value={status}
            onChange={handleFilterChange(setStatus)}
            aria-label="상태 선택"
            options={[{ value: '', label: '전체 상태' }, ...STATUS_OPTIONS]}
          />
          <SelectFilter
            value={priceMax}
            onChange={handleFilterChange(setPriceMax)}
            aria-label="가격 선택"
            options={PRICE_OPTIONS.map((o) => ({ value: o.value, label: o.label === '전체' ? '전체 가격' : o.label }))}
          />
        </FilterBar>

        {!isLoading && !fetchError && <div className={styles.resultCount}>검색 결과 {total.toLocaleString()}건</div>}

        {isLoading ? (
          <div className={styles.stateBox}><InlineLoading message="목록을 불러오는 중입니다..." /></div>
        ) : fetchError ? (
          <ErrorState variant="section" message={fetchError} />
        ) : items.length === 0 ? (
          <Empty variant="noResult" title="조건에 맞는 분양정보가 없습니다." />
        ) : (
          <div className={styles.grid}>
            {items.map((p) => (
              <Card key={p.id} variant="interactive" onClick={() => router.push(`/presales/${p.id}`)}>
                <div className={styles.cardTitle}>{p.houseName}</div>
                <div className={styles.cardMetaRow}>
                  <span className={`${styles.badge} ${STATUS_BADGE_CLASS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                  <span className={styles.region}>{p.subscriptionAreaName || '지역 정보 없음'}</span>
                </div>
                <div className={styles.price}>{formatPriceRange(p.minPrice, p.maxPrice)}</div>
                <div className={styles.cardMetaRow}>
                  <span>{formatHouseholds(p.totalSupplyHouseholds)}</span>
                  <span>{formatMoveIn(p.moveInExpectedYm)}</span>
                </div>
                {p.pblancUrl && (
                  <a
                    href={p.pblancUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.cardLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    청약홈에서 공고 보기 ↗
                  </a>
                )}
              </Card>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>이전</Button>
            <span className={styles.pageInfo}>
              {page} / {totalPages}
            </span>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>다음</Button>
          </div>
        )}
    </>
  );
}

export default function PresalesClient() {
  return (
    <div className={styles.main}>
      <Header pageTitle="분양정보" />
      <div className="container">
        <div className={styles.intro}>
          <h1 className={styles.title}>분양정보</h1>
          <p className={styles.desc}>현재 청약 가능한 분양부터 최근 3년 분양정보까지 확인하세요.</p>
        </div>
        <PresaleListSection />
      </div>
    </div>
  );
}
