'use client';

// REALTOR_PRO_MVP_V1 — 저장된 매칭 목록(조건 안, 숨기지 않은 것). 관심 표시·숨김만.
// 매칭 행에는 id만 있으므로 이름은 본인 매물·고객 목록에서 찾아 붙인다(없으면 "삭제되었거나 보관된 항목").

import Link from 'next/link';
import { useState } from 'react';
import { EyeOff, FileText, Star } from 'lucide-react';
import type { CustomerDto, ListingDto } from '@/lib/pro/service-core';
import type { MatchRow } from '@/lib/pro/types';
import { proFetch, type ApiFailure, type Wire } from '@/components/pro/api';
import { formatDateTime, formatDealPrice } from '@/components/pro/format';
import { MATCH_SCORE_NOTE, ReasonList, ScoreBadge } from '@/components/pro/MatchResults';
import { InlineFailure, LoadingState, ProErrorState, useProMe, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

type MatchW = Wire<MatchRow>;

function MatchCard({ m, listing, customer, readOnly, onState }: { m: MatchW; listing?: Wire<ListingDto>; customer?: Wire<CustomerDto>; readOnly: boolean; onState: (id: string, state: MatchW['state']) => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const setState = async (state: MatchW['state']) => {
    setBusy(true);
    const r = await proFetch(`/api/pro/matches/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { state } });
    setBusy(false);
    if (r.ok) {
      setFailure(null);
      onState(m.id, state);
    } else setFailure(r);
  };
  const shortlisted = m.state === 'SHORTLISTED';
  return (
    <li className={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          {customer ? (
            <Link href={`/pro/customers/${encodeURIComponent(customer.id)}`} className={s.rowTitle} style={{ fontWeight: 600 }}>
              {customer.name}
            </Link>
          ) : (
            <span className={s.muted}>삭제되었거나 종료된 고객</span>
          )}
          <span className={s.muted}> · </span>
          {listing ? (
            <Link href={`/pro/listings/${encodeURIComponent(listing.id)}`} className={s.rowTitle}>
              {listing.aptNameSnapshot}
            </Link>
          ) : (
            <span className={s.muted}>삭제된 매물</span>
          )}
        </div>
        <ScoreBadge score={m.score} confidence={m.confidence} passedHard={m.passedHard} />
      </div>
      <p className={s.meta}>
        {listing ? <span>{formatDealPrice(listing)}</span> : null}
        <span>계산 {formatDateTime(m.computedAt)}</span>
        {shortlisted ? <span className={`${s.badge} ${s.badgeBrand}`}>관심</span> : null}
      </p>
      <details>
        <summary className={s.muted} style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
          사유 보기
        </summary>
        <ReasonList reasons={m.reasons} />
      </details>
      <div className={s.btnRow} style={{ marginTop: 8 }}>
        {!readOnly ? (
          <>
            <button type="button" className={shortlisted ? s.btnPrimary : s.btn} onClick={() => setState(shortlisted ? 'SEEN' : 'SHORTLISTED')} disabled={busy} aria-pressed={shortlisted}>
              <Star size={16} aria-hidden="true" />
              {shortlisted ? '관심 해제' : '관심'}
            </button>
            <button type="button" className={s.btnGhost} onClick={() => setState('DISMISSED')} disabled={busy}>
              <EyeOff size={16} aria-hidden="true" />
              숨김
            </button>
          </>
        ) : null}
        {listing && customer && !readOnly ? (
          <Link href={`/pro/briefings/new?listingId=${encodeURIComponent(listing.id)}&customerId=${encodeURIComponent(customer.id)}`} className={s.btn}>
            <FileText size={16} aria-hidden="true" />
            브리핑
          </Link>
        ) : null}
      </div>
      <InlineFailure failure={failure} />
    </li>
  );
}

export default function ProMatchesPage() {
  const me = useProMe();
  const matches = useProQuery<MatchRow[]>('/api/pro/matches');
  const listings = useProQuery<{ items: ListingDto[] }>('/api/pro/listings?archived=1');
  const customers = useProQuery<{ items: CustomerDto[] }>('/api/pro/customers?closed=1');
  const [filter, setFilter] = useState<'all' | 'shortlisted'>('all');

  if (matches.loading && !matches.data) return <LoadingState />;
  if (matches.failure && !matches.data) return <ProErrorState failure={matches.failure} onRetry={matches.reload} />;
  if (!matches.data) return null;

  const readOnly = me.data?.state === 'SUSPENDED';
  const listingById = new Map((listings.data?.items ?? []).map((l) => [l.id, l]));
  const customerById = new Map((customers.data?.items ?? []).map((c) => [c.id, c]));
  const rows = matches.data.filter((m) => m.state !== 'DISMISSED' && (filter === 'all' || m.state === 'SHORTLISTED'));

  const onState = (id: string, state: MatchW['state']) => {
    matches.setData((prev) => (prev ? prev.map((m) => (m.id === id ? { ...m, state } : m)) : prev));
  };

  return (
    <div className={s.page}>
      <div>
        <h1 className={s.pageTitle}>매칭</h1>
        <p className={s.pageSub}>고객 상세에서 계산한 매칭 중 조건 안에 드는 결과입니다.</p>
      </div>
      <p className={s.help}>{MATCH_SCORE_NOTE}</p>
      <div className={s.segment} role="tablist" aria-label="매칭 보기">
        <button type="button" role="tab" aria-selected={filter === 'all'} className={`${s.segmentBtn} ${filter === 'all' ? s.segmentActive : ''}`} onClick={() => setFilter('all')}>
          전체
        </button>
        <button type="button" role="tab" aria-selected={filter === 'shortlisted'} className={`${s.segmentBtn} ${filter === 'shortlisted' ? s.segmentActive : ''}`} onClick={() => setFilter('shortlisted')}>
          관심
        </button>
      </div>
      {rows.length === 0 ? (
        <p className={s.empty}>{filter === 'shortlisted' ? '관심 표시한 매칭이 없습니다.' : '저장된 매칭이 없습니다. 고객 상세에서 "맞는 매물 보기"를 눌러 계산하세요.'}</p>
      ) : (
        <ul className={s.list}>
          {rows.map((m) => (
            <MatchCard key={m.id} m={m} listing={listingById.get(m.listingId)} customer={customerById.get(m.customerId)} readOnly={readOnly} onState={onState} />
          ))}
        </ul>
      )}
    </div>
  );
}
