'use client';

// REALTOR_PRO_MVP_V1 — 관리자: 중개사 Pro 신청 심사. 신청 정보(표시 이름·사무소·상태·등록 여부)만 본다 — 매물·고객 데이터 없음.
// /admin 경로는 proxy.ts가 막고, API는 requireAdmin()으로 다시 검증한다.

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Ban, Check, Gift, RotateCcw, X } from 'lucide-react';
import Header from '@/components/Header';
import AuthGate from '@/components/AuthGate';
import { PROFILE_STATUSES, type ProfileStatus } from '@/lib/pro/rules';
import type { ProfileDto } from '@/lib/pro/profile-service';
import { proFetch, type ApiFailure, type Wire } from '@/components/pro/api';
import { formatDate } from '@/components/pro/format';
import { InlineFailure, LoadingState, ProErrorState, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';
import styles from './page.module.css';

const STATUS_LABELS: Record<ProfileStatus, string> = { PENDING_REVIEW: '심사 대기', VERIFIED: '인증', REJECTED: '반려', SUSPENDED: '정지' };

type Pending = { kind: 'REJECTED' | 'SUSPENDED' } | null;

function ApplicationCard({ p, onChanged }: { p: Wire<ProfileDto>; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setStatus = async (status: ProfileStatus, why?: string) => {
    setBusy(true);
    setFailure(null);
    const r = await proFetch<ProfileDto>(`/api/admin/pro/applications/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { status, reason: why ?? '' } });
    setBusy(false);
    if (r.ok) {
      setPending(null);
      setReason('');
      onChanged();
    } else setFailure(r);
  };

  const grant = async () => {
    setBusy(true);
    setFailure(null);
    const r = await proFetch<{ until: Date }>(`/api/admin/pro/applications/${encodeURIComponent(p.id)}`, { method: 'POST', body: { betaDays: 30 } });
    setBusy(false);
    if (r.ok) setNotice(`베타 Pro를 ${formatDate(r.data.until)}까지 부여했습니다.`);
    else setFailure(r);
  };

  return (
    <li className={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <p className={s.cardTitle}>{p.displayName}</p>
          <p className={s.meta}>
            <span>{p.officeName ?? '사무소 미입력'}</span>
            <span>{p.officePhone ?? '전화 미입력'}</span>
            <span>신청 {formatDate(p.createdAt)}</span>
          </p>
        </div>
        <span className={s.badge}>{STATUS_LABELS[p.status as ProfileStatus] ?? p.status}</span>
      </div>
      <div className={s.badges}>
        <span className={s.badge}>자격번호 {p.hasLicenseNumber ? '있음' : '없음'}</span>
        <span className={s.badge}>등록번호 {p.hasOfficeRegNo ? '있음' : '없음'}</span>
        <span className={s.badge}>사업자번호 {p.hasBusinessRegNo ? '있음' : '없음'}</span>
      </div>
      {p.statusReason ? <p className={s.muted} style={{ margin: '8px 0 0' }}>사유: {p.statusReason}</p> : null}

      {pending ? (
        <div className={s.form} style={{ marginTop: 10 }}>
          <div className={s.field}>
            <label className={s.label} htmlFor={`reason-${p.id}`}>
              {pending.kind === 'REJECTED' ? '반려 사유' : '정지 사유'}
              <span className={s.required}>*</span>
            </label>
            <input id={`reason-${p.id}`} className={s.input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            <p className={s.help}>사유는 신청자에게 표시됩니다.</p>
          </div>
          <div className={s.btnRow}>
            <button type="button" className={s.btn} onClick={() => setPending(null)} disabled={busy}>
              취소
            </button>
            <button type="button" className={s.btnDanger} onClick={() => setStatus(pending.kind, reason.trim())} disabled={busy || !reason.trim()}>
              {pending.kind === 'REJECTED' ? '반려' : '정지'}
            </button>
          </div>
        </div>
      ) : (
        <div className={s.btnRow} style={{ marginTop: 10 }}>
          {p.status === 'PENDING_REVIEW' ? (
            <>
              <button type="button" className={s.btnPrimary} onClick={() => setStatus('VERIFIED')} disabled={busy}>
                <Check size={16} aria-hidden="true" />
                승인
              </button>
              <button type="button" className={s.btnDanger} onClick={() => setPending({ kind: 'REJECTED' })} disabled={busy}>
                <X size={16} aria-hidden="true" />
                반려
              </button>
            </>
          ) : null}
          {p.status === 'VERIFIED' ? (
            <>
              <button type="button" className={s.btn} onClick={grant} disabled={busy}>
                <Gift size={16} aria-hidden="true" />
                베타 Pro 30일 부여
              </button>
              <button type="button" className={s.btnDanger} onClick={() => setPending({ kind: 'SUSPENDED' })} disabled={busy}>
                <Ban size={16} aria-hidden="true" />
                정지
              </button>
            </>
          ) : null}
          {p.status === 'SUSPENDED' ? (
            <button type="button" className={s.btn} onClick={() => setStatus('VERIFIED')} disabled={busy}>
              <RotateCcw size={16} aria-hidden="true" />
              재개
            </button>
          ) : null}
        </div>
      )}
      {notice ? (
        <p className={s.successBox} role="status" style={{ marginTop: 8 }}>
          {notice}
        </p>
      ) : null}
      <InlineFailure failure={failure} />
    </li>
  );
}

export default function AdminProPage() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.isAdmin === true;
  const [tab, setTab] = useState<ProfileStatus>('PENDING_REVIEW');
  const { data, failure, loading, reload } = useProQuery<ProfileDto[]>(isAdmin ? `/api/admin/pro/applications?status=${tab}` : null);

  return (
    <AuthGate>
      <div className={styles.main}>
        <Header pageTitle="중개사 Pro 심사" />
        <div className={styles.inner}>
          {status === 'loading' ? (
            <LoadingState />
          ) : !isAdmin ? (
            <p className={s.empty}>관리자만 접근할 수 있는 페이지입니다.</p>
          ) : (
            <div className={s.page}>
              <h1 className={s.pageTitle}>중개사 Pro 신청</h1>
              <div className={s.segment} role="tablist" aria-label="신청 상태">
                {PROFILE_STATUSES.map((st) => (
                  <button key={st} type="button" role="tab" aria-selected={tab === st} className={`${s.segmentBtn} ${tab === st ? s.segmentActive : ''}`} onClick={() => setTab(st)}>
                    {STATUS_LABELS[st]}
                  </button>
                ))}
              </div>
              {loading && !data ? (
                <LoadingState />
              ) : failure ? (
                <ProErrorState failure={failure} onRetry={reload} />
              ) : !data || data.length === 0 ? (
                <p className={s.empty}>해당 상태의 신청이 없습니다.</p>
              ) : (
                <ul className={s.list}>
                  {data.map((p) => (
                    <ApplicationCard key={p.id} p={p} onChanged={reload} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </AuthGate>
  );
}
