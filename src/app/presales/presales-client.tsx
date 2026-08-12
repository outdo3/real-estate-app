'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import Header from '@/components/Header';
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

export default function PresalesClient() {
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
    <div className={styles.main}>
      <Header pageTitle="분양정보" />
      <div className="container">
        <div className={styles.intro}>
          <h1 className={styles.title}>분양정보</h1>
          <p className={styles.desc}>현재 청약 가능한 분양부터 최근 3년 분양정보까지 확인하세요.</p>
        </div>

        <div className={styles.filterBar}>
          <select className={styles.filterSelect} value={region} onChange={handleFilterChange(setRegion)}>
            <option value="">전체 지역</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <select className={styles.filterSelect} value={status} onChange={handleFilterChange(setStatus)}>
            <option value="">전체 상태</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select className={styles.filterSelect} value={priceMax} onChange={handleFilterChange(setPriceMax)}>
            {PRICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label === '전체' ? '전체 가격' : o.label}
              </option>
            ))}
          </select>
        </div>

        {!isLoading && !fetchError && <div className={styles.resultCount}>검색 결과 {total.toLocaleString()}건</div>}

        {isLoading ? (
          <div className={styles.stateBox}>목록을 불러오는 중입니다...</div>
        ) : fetchError ? (
          <div className={styles.stateBox}>⚠️ {fetchError}</div>
        ) : items.length === 0 ? (
          <div className={styles.stateBox}>조건에 맞는 분양정보가 없습니다.</div>
        ) : (
          <div className={styles.grid}>
            {items.map((p) => (
              <div
                key={p.id}
                className={styles.card}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/presales/${p.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/presales/${p.id}`);
                }}
              >
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
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <span className={styles.pageInfo}>
              {page} / {totalPages}
            </span>
            <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
