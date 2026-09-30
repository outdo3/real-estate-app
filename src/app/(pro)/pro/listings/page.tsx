'use client';

// REALTOR_PRO_MVP_V1 — 매물 목록(활성/보관). 비공개 메모·소유자 정보는 목록에 표시하지 않는다.

import Link from 'next/link';
import { useState } from 'react';
import { Link2Off, Plus, Search } from 'lucide-react';
import type { ListingDto } from '@/lib/pro/service-core';
import { formatDate, formatDealPrice, formatM2, floorText } from '@/components/pro/format';
import { LoadingState, ProErrorState, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

type ListResp = { items: ListingDto[]; activeCount: number; limit: number };

export default function ProListingsPage() {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (tab === 'archived') params.set('archived', '1');
  if (q) params.set('q', q);
  const qs = params.toString();
  const { data, failure, loading, reload } = useProQuery<ListResp>(`/api/pro/listings${qs ? `?${qs}` : ''}`);

  // archived=1이면 서버가 보관 매물까지 함께 돌려준다 — 탭별로 나눠 보여준다
  const items = (data?.items ?? []).filter((l) => (tab === 'active' ? l.isActive : !l.isActive));

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>매물</h1>
          {data ? (
            <p className={s.pageSub}>
              활성 {data.activeCount} / {data.limit}건
            </p>
          ) : null}
        </div>
        <Link href="/pro/listings/new" className={s.btnPrimary}>
          <Plus size={16} aria-hidden="true" />
          매물 등록
        </Link>
      </div>

      <div className={s.segment} role="tablist" aria-label="매물 상태">
        <button type="button" role="tab" aria-selected={tab === 'active'} className={`${s.segmentBtn} ${tab === 'active' ? s.segmentActive : ''}`} onClick={() => setTab('active')}>
          활성
        </button>
        <button type="button" role="tab" aria-selected={tab === 'archived'} className={`${s.segmentBtn} ${tab === 'archived' ? s.segmentActive : ''}`} onClick={() => setTab('archived')}>
          보관
        </button>
      </div>

      <form
        className={s.searchRow}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <input className={s.input} value={input} onChange={(e) => setInput(e.target.value)} placeholder="단지명·태그 검색" aria-label="매물 검색" maxLength={40} />
        <button type="submit" className={s.btn} aria-label="검색">
          <Search size={16} aria-hidden="true" />
        </button>
      </form>

      {loading && !data ? (
        <LoadingState />
      ) : failure ? (
        <ProErrorState failure={failure} onRetry={reload} />
      ) : items.length === 0 ? (
        <p className={s.empty}>{q ? '검색 결과가 없습니다.' : tab === 'active' ? '활성 매물이 없습니다. 첫 매물을 등록해 보세요.' : '보관한 매물이 없습니다.'}</p>
      ) : (
        <ul className={s.list}>
          {items.map((l) => {
            const floor = floorText(l.floor, l.floorBand);
            return (
              <li key={l.id}>
                <Link href={`/pro/listings/${encodeURIComponent(l.id)}`} className={`${s.card} ${s.cardLink}`}>
                  <p className={s.cardTitle}>{l.aptNameSnapshot}</p>
                  <p className={s.cardPrice}>{formatDealPrice(l)}</p>
                  <p className={s.meta}>
                    {l.exclusiveAreaM2 != null ? <span>전용 {formatM2(l.exclusiveAreaM2)}</span> : null}
                    {floor ? <span>{floor}</span> : null}
                    {l.umdName ? <span>{l.umdName}</span> : null}
                    <span>등록 {formatDate(l.createdAt)}</span>
                  </p>
                  <div className={s.badges}>
                    {!l.aptSeq ? (
                      <span className={`${s.badge} ${s.badgeWarn}`}>
                        <Link2Off size={12} aria-hidden="true" />
                        단지 정보 미연결
                      </span>
                    ) : null}
                    {l.closedAt ? <span className={s.badge}>계약완료</span> : null}
                    {l.tags.map((t) => (
                      <span key={t} className={s.badge}>
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
