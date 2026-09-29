'use client';

// REALTOR_PRO_MVP_V1 — 고객 목록. 연락처는 목록에 표시하지 않는다(상세의 "연락처 보기"로만).

import Link from 'next/link';
import { useState } from 'react';
import { CalendarClock, Plus, Search } from 'lucide-react';
import { CUSTOMER_STATUS_LABELS, type CustomerStatus } from '@/lib/pro/rules';
import type { CustomerDto } from '@/lib/pro/service-core';
import { PRIORITY_LABELS } from '@/components/pro/CustomerForm';
import { formatDateTime } from '@/components/pro/format';
import { LoadingState, ProErrorState, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

type ListResp = { items: CustomerDto[]; count: number; limit: number };

export default function ProCustomersPage() {
  const [closed, setClosed] = useState(false);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams();
  if (closed) params.set('closed', '1');
  if (q) params.set('q', q);
  const qs = params.toString();
  const { data, failure, loading, reload } = useProQuery<ListResp>(`/api/pro/customers${qs ? `?${qs}` : ''}`);
  const items = [...(data?.items ?? [])].sort((a, b) => a.priority - b.priority || new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>고객</h1>
          {data ? (
            <p className={s.pageSub}>
              {data.count} / {data.limit}명
            </p>
          ) : null}
        </div>
        <Link href="/pro/customers/new" className={s.btnPrimary}>
          <Plus size={16} aria-hidden="true" />
          고객 등록
        </Link>
      </div>

      <form
        className={s.searchRow}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <input className={s.input} value={input} onChange={(e) => setInput(e.target.value)} placeholder="고객 이름 검색" aria-label="고객 검색" maxLength={40} />
        <button type="submit" className={s.btn} aria-label="검색">
          <Search size={16} aria-hidden="true" />
        </button>
      </form>
      <label className={s.checkRow}>
        <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        <span>종료된 고객 포함</span>
      </label>

      {loading && !data ? (
        <LoadingState />
      ) : failure ? (
        <ProErrorState failure={failure} onRetry={reload} />
      ) : items.length === 0 ? (
        <p className={s.empty}>{q ? '검색 결과가 없습니다.' : '등록한 고객이 없습니다.'}</p>
      ) : (
        <ul className={s.list}>
          {items.map((c) => (
            <li key={c.id}>
              <Link href={`/pro/customers/${encodeURIComponent(c.id)}`} className={`${s.card} ${s.cardLink}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <p className={s.cardTitle}>{c.name}</p>
                  <span className={`${s.badge} ${c.priority === 1 ? s.badgeError : ''}`}>우선순위 {PRIORITY_LABELS[c.priority] ?? c.priority}</span>
                </div>
                <p className={s.meta}>
                  <span>{CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status}</span>
                  <span>
                    <CalendarClock size={12} aria-hidden="true" /> 다음 팔로업 {c.nextFollowUpAt ? formatDateTime(c.nextFollowUpAt) : '없음'}
                  </span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
