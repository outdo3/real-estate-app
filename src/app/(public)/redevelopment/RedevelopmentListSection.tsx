'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { REGION_DATA, SIDO_LIST } from '@/lib/regions';
import {
  BUSINESS_TYPE_VALUES,
  STAGE_VALUES,
  BUSINESS_TYPE_LABELS,
  STAGE_LABELS,
  stageGroup,
  sourceLabel,
  sidoShortLabel,
  formatDataUpdatedAt,
} from '@/lib/redevelopment/labels';
import FilterBar from '@/components/ui/FilterBar';
import SelectFilter from '@/components/ui/SelectFilter';
import Card from '@/components/ui/Card';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import Button from '@/components/ui/Button';
import InlineLoading from '@/components/ui/InlineLoading';
import styles from './redevelopment-list.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// 이집 초기 검증 지역이 부산이라(섹션 5) 기본값으로 두되, 다른 시도도 전부 선택
// 가능하게 한다 — 부산 전용 화면으로 하드코딩하지 않는다.
const DEFAULT_SIDO = '부산광역시';

type RedevelopmentListItem = {
  id: number;
  name: string;
  sido: string;
  sigungu: string;
  businessType: string;
  stage: string;
  householdCount: number | null;
  hasSafeMapLocation: boolean;
  primarySource: string;
  dataUpdatedAt: string;
  needsReview: boolean;
};

function stageBadgeClass(stage: string): string {
  const group = stageGroup(stage as any);
  if (group === 'done') return styles.badgeDone;
  if (group === 'stopped') return styles.badgeStopped;
  if (group === 'unknown') return styles.badgeUnknown;
  return styles.badgeActive;
}

// 300ms debounce — 검색창 입력마다 매번 API를 호출하지 않는다(섹션 38).
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function RedevelopmentListSection() {
  const router = useRouter();

  const [sido, setSido] = useState(DEFAULT_SIDO);
  const [sigungu, setSigungu] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [stage, setStage] = useState('');
  const [qInput, setQInput] = useState('');
  const [page, setPage] = useState(1);

  const q = useDebouncedValue(qInput, 300);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '20');
  if (sido) params.set('sido', sido);
  if (sigungu) params.set('sigungu', sigungu);
  if (businessType) params.set('businessType', businessType);
  if (stage) params.set('stage', stage);
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading } = useSWR(`/api/redevelopment?${params.toString()}`, fetcher);

  const items: RedevelopmentListItem[] = data?.success ? data.data.items : [];
  const total: number = data?.success ? data.data.total : 0;
  const totalPages: number = data?.success ? data.data.totalPages : 1;
  const fetchError = data && !data.success ? data.error : null;

  const sigunguOptions = REGION_DATA[sido] ?? [];

  const handleSidoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSido(e.target.value);
    setSigungu('');
    setPage(1);
  };
  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <div className={styles.section}>
      <div className={styles.searchRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="재개발·재건축 사업명을 검색하세요"
          value={qInput}
          onChange={(e) => {
            setQInput(e.target.value);
            setPage(1);
          }}
          aria-label="재개발·재건축 사업명 검색"
        />
      </div>

      <FilterBar>
        <SelectFilter value={sido} onChange={handleSidoChange} aria-label="시도 선택" options={SIDO_LIST.map((s) => ({ value: s, label: s }))} />
        <SelectFilter
          value={sigungu}
          onChange={handleFilterChange(setSigungu)}
          aria-label="시군구 선택"
          options={[{ value: '', label: '전체 시군구' }, ...sigunguOptions.map((g) => ({ value: g, label: g }))]}
        />
        <SelectFilter
          value={businessType}
          onChange={handleFilterChange(setBusinessType)}
          aria-label="사업유형 선택"
          options={[{ value: '', label: '전체 유형' }, ...BUSINESS_TYPE_VALUES.filter((v) => v !== 'UNKNOWN').map((v) => ({ value: v, label: BUSINESS_TYPE_LABELS[v] }))]}
        />
        <SelectFilter
          value={stage}
          onChange={handleFilterChange(setStage)}
          aria-label="진행단계 선택"
          options={[{ value: '', label: '전체 단계' }, ...STAGE_VALUES.filter((v) => v !== 'UNKNOWN').map((v) => ({ value: v, label: STAGE_LABELS[v] }))]}
        />
      </FilterBar>

      <p className={styles.mapNote}>
        정확한 사업 위치가 확인된 구역부터 지도에 표시됩니다. 목록에서는 모든 사업을 확인할 수 있습니다.
      </p>

      {!isLoading && !fetchError && (
        <div className={styles.resultCount} aria-live="polite">
          검색 결과 {total.toLocaleString()}건
        </div>
      )}

      {isLoading ? (
        <div className={styles.stateBox}><InlineLoading message="목록을 불러오는 중입니다..." /></div>
      ) : fetchError ? (
        <ErrorState variant="section" message={fetchError} />
      ) : items.length === 0 ? (
        <Empty variant="noResult" title="조건에 맞는 정비사업이 없습니다." />
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <Card key={item.id} variant="interactive" onClick={() => router.push(`/redevelopment/${item.id}`)}>
              <div className={styles.cardTitle}>{item.name}</div>
              <div className={styles.cardMetaRow}>
                <span className={`${styles.badge} ${styles.badgeType}`}>{BUSINESS_TYPE_LABELS[item.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? item.businessType}</span>
                <span className={`${styles.badge} ${stageBadgeClass(item.stage)}`}>{STAGE_LABELS[item.stage as keyof typeof STAGE_LABELS] ?? item.stage}</span>
              </div>
              <div className={styles.cardMetaRow}>
                <span className={styles.region}>
                  {sidoShortLabel(item.sido)} {item.sigungu}
                </span>
                <span>{item.householdCount != null ? `${item.householdCount.toLocaleString()}세대` : '세대수 정보 없음'}</span>
              </div>
              <div className={styles.cardSource}>
                {sourceLabel(item.primarySource)}
                {formatDataUpdatedAt(item.dataUpdatedAt) && ` · 데이터 갱신 ${formatDataUpdatedAt(item.dataUpdatedAt)}`}
              </div>
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
    </div>
  );
}
