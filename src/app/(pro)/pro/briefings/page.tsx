'use client';

// REALTOR_PRO_MVP_V1 — 브리핑 목록. 공유 링크 원문은 생성 직후 한 번만 보이며 이 목록에서는 다시 볼 수 없다.

import Link from 'next/link';
import { useState } from 'react';
import { Ban, Plus } from 'lucide-react';
import type { BriefingListItem } from '@/lib/pro/briefing-service';
import { proFetch, type ApiFailure, type Wire } from '@/components/pro/api';
import { formatDate, formatDateTime } from '@/components/pro/format';
import { InlineFailure, LoadingState, ProErrorState, useProMe, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

const STATUS_LABEL: Record<string, string> = { ACTIVE: '공유 중', EXPIRED: '만료', REVOKED: '회수됨' };

function BriefingRow({ b, canRevoke, onRevoked }: { b: Wire<BriefingListItem>; canRevoke: boolean; onRevoked: (next: Wire<BriefingListItem>) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const revoke = async () => {
    setBusy(true);
    const r = await proFetch<BriefingListItem>(`/api/pro/briefings/${encodeURIComponent(b.id)}/revoke`, { method: 'POST', body: {} });
    setBusy(false);
    if (r.ok) {
      setConfirm(false);
      onRevoked(r.data);
    } else setFailure(r);
  };
  return (
    <li className={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <Link href={`/pro/briefings/${encodeURIComponent(b.id)}`} className={s.rowTitle} style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
          {b.title}
        </Link>
        <span className={`${s.badge} ${b.status === 'ACTIVE' ? s.badgeBrand : ''}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
      </div>
      <p className={s.meta}>
        <span>생성 {formatDate(b.createdAt)}</span>
        <span>만료 {formatDateTime(b.expiresAt)}</span>
        <span>열람 {b.viewCount}회</span>
        {b.firstViewedAt ? <span>첫 열람 {formatDateTime(b.firstViewedAt)}</span> : null}
      </p>
      {b.status === 'ACTIVE' && canRevoke ? (
        confirm ? (
          <div className={s.banner} role="alert" style={{ flexDirection: 'column', marginTop: 8 }}>
            <span>이 브리핑 링크를 회수할까요? 고객은 더 이상 내용을 볼 수 없습니다.</span>
            <div className={s.btnRow}>
              <button type="button" className={s.btn} onClick={() => setConfirm(false)} disabled={busy}>
                취소
              </button>
              <button type="button" className={s.btnDanger} onClick={revoke} disabled={busy}>
                회수
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={s.btnGhost} onClick={() => setConfirm(true)} style={{ marginTop: 4 }}>
            <Ban size={16} aria-hidden="true" />
            회수
          </button>
        )
      ) : null}
      <InlineFailure failure={failure} />
    </li>
  );
}

export default function ProBriefingsPage() {
  const me = useProMe();
  const { data, failure, loading, reload, setData } = useProQuery<BriefingListItem[]>('/api/pro/briefings');
  const readOnly = me.data?.state === 'SUSPENDED';

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>브리핑</h1>
          <p className={s.pageSub}>고객에게 보낸 매물 설명 링크입니다. 링크는 만든 직후에만 복사할 수 있습니다.</p>
        </div>
        {!readOnly ? (
          <Link href="/pro/briefings/new" className={s.btnPrimary}>
            <Plus size={16} aria-hidden="true" />
            브리핑 만들기
          </Link>
        ) : null}
      </div>
      {loading && !data ? (
        <LoadingState />
      ) : failure ? (
        <ProErrorState failure={failure} onRetry={reload} />
      ) : !data || data.length === 0 ? (
        <p className={s.empty}>아직 만든 브리핑이 없습니다. 매물 상세나 고객 매칭 결과에서 만들 수 있습니다.</p>
      ) : (
        <ul className={s.list}>
          {data.map((b) => (
            <BriefingRow key={b.id} b={b} canRevoke={!!me.data} onRevoked={(next) => setData((prev) => (prev ? prev.map((x) => (x.id === next.id ? next : x)) : prev))} />
          ))}
        </ul>
      )}
    </div>
  );
}
