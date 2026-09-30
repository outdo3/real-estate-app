'use client';

// REALTOR_PRO_MVP_V1 — 고객 상세: 기본 정보 수정 · 연락처 보기 · 조건 세트 · 팔로업 · 맞는 매물 · 삭제.

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  CONSENT_STATUS_LABELS,
  CUSTOMER_STATUS_LABELS,
  DEAL_TYPE_LABELS,
  FLOOR_BAND_LABELS,
  type ConsentStatus,
  type CustomerStatus,
  type DealType,
  type FloorBand,
  type MustHaveKey,
} from '@/lib/pro/rules';
import type { CustomerDetail } from '@/lib/pro/customer-service';
import type { CustomerMatchView } from '@/lib/pro/match-service';
import type { PreferenceRow } from '@/lib/pro/types';
import { proFetch, type ApiFailure, type Wire } from '@/components/pro/api';
import ContactReveal from '@/components/pro/ContactReveal';
import CustomerForm, { PRIORITY_LABELS } from '@/components/pro/CustomerForm';
import FollowupSection from '@/components/pro/FollowupSection';
import { formatDate, formatM2, formatManwon } from '@/components/pro/format';
import MatchResults from '@/components/pro/MatchResults';
import PreferenceForm, { MUST_HAVE_LABELS } from '@/components/pro/PreferenceForm';
import { InlineFailure, LoadingState, ProErrorState, ReadOnlyBanner, useProMe, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

type PrefW = Wire<PreferenceRow>;

function range(min: string | null, max: string | null): string {
  if (min && max) return `${min} ~ ${max}`;
  if (min) return `${min} 이상`;
  if (max) return `${max} 이하`;
  return '-';
}

function PreferenceSummary({ p }: { p: PrefW }) {
  const tri = (v: boolean | null, yes: string, no: string | null) => (v === true ? yes : v === false ? no : null);
  const extras = [
    p.floorPreference ? `${FLOOR_BAND_LABELS[p.floorPreference as FloorBand]} 선호` : null,
    tri(p.parkingRequired, '주차 필요', '주차 불필요'),
    tri(p.petRequired, '반려동물 있음', null),
    tri(p.preferNewBuild, '신축 선호', null),
    p.commuteLabel ? `통근: ${p.commuteLabel}` : null,
  ].filter(Boolean) as string[];
  return (
    <dl className={s.kv}>
      <dt>거래유형</dt>
      <dd>{p.dealTypes.map((d) => DEAL_TYPE_LABELS[d as DealType] ?? d).join(', ') || '-'}</dd>
      <dt>예산</dt>
      <dd>
        {range(p.budgetMinManwon != null ? formatManwon(p.budgetMinManwon) : null, p.budgetMaxManwon != null ? formatManwon(p.budgetMaxManwon) : null)}
        {p.budgetTolerancePct ? ` (허용 ${p.budgetTolerancePct}%)` : ''}
      </dd>
      {p.monthlyRentMaxManwon != null ? (
        <>
          <dt>월세 상한</dt>
          <dd>{formatManwon(p.monthlyRentMaxManwon)}</dd>
        </>
      ) : null}
      <dt>전용면적</dt>
      <dd>{range(p.areaMinM2 != null ? formatM2(p.areaMinM2) : null, p.areaMaxM2 != null ? formatM2(p.areaMaxM2) : null)}</dd>
      <dt>지역·단지</dt>
      <dd>{p.lawdCds.length || p.aptSeqs.length ? `지역 ${p.lawdCds.length}곳 · 단지 ${p.aptSeqs.length}곳` : '지정 안 함'}</dd>
      <dt>희망 입주</dt>
      <dd>{p.moveInTargetAt ? formatDate(p.moveInTargetAt) : '-'}</dd>
      {extras.length ? (
        <>
          <dt>기타</dt>
          <dd>{extras.join(' · ')}</dd>
        </>
      ) : null}
      {p.mustHaveKeys.length ? (
        <>
          <dt>필수</dt>
          <dd>{p.mustHaveKeys.map((k) => MUST_HAVE_LABELS[k as MustHaveKey] ?? k).join(', ')}</dd>
        </>
      ) : null}
      {p.specialConditions ? (
        <>
          <dt>메모</dt>
          <dd>{p.specialConditions}</dd>
        </>
      ) : null}
    </dl>
  );
}

export default function ProCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const me = useProMe();
  const { data, failure, loading, reload, setData } = useProQuery<CustomerDetail>(id ? `/api/pro/customers/${encodeURIComponent(id)}` : null);
  const [editing, setEditing] = useState(false);
  const [editPref, setEditPref] = useState<string | null>(null);
  const [addingPref, setAddingPref] = useState(false);
  const [matches, setMatches] = useState<Wire<CustomerMatchView>[] | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchFailure, setMatchFailure] = useState<ApiFailure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionFailure, setActionFailure] = useState<ApiFailure | null>(null);

  if (loading && !data) return <LoadingState />;
  if (failure && !data) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;

  const c = data.customer;
  const readOnly = me.data?.state === 'SUSPENDED';
  const caps = me.data?.capabilities;
  const prefLimit = caps?.preferenceSetsPerCustomer ?? null;
  const canRepeat = me.data?.plan === 'PRO' && !!caps?.repeatFollowups;

  const loadMatches = async () => {
    setMatchBusy(true);
    setMatchFailure(null);
    const r = await proFetch<CustomerMatchView[]>(`/api/pro/customers/${encodeURIComponent(id)}/matches`);
    setMatchBusy(false);
    if (r.ok) setMatches(r.data);
    else setMatchFailure(r);
  };

  const remove = async () => {
    setBusy(true);
    setActionFailure(null);
    const r = await proFetch(`/api/pro/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) router.push('/pro/customers');
    else setActionFailure(r);
  };

  return (
    <div className={s.page}>
      <Link href="/pro/customers" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        고객 목록
      </Link>

      <div className={s.pageHead}>
        <div style={{ minWidth: 0 }}>
          <h1 className={s.pageTitle}>{c.name}</h1>
          <div className={s.badges}>
            <span className={s.badge}>{CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status}</span>
            <span className={`${s.badge} ${c.priority === 1 ? s.badgeError : ''}`}>우선순위 {PRIORITY_LABELS[c.priority] ?? c.priority}</span>
            <span className={`${s.badge} ${c.consentStatus === 'NOT_RECORDED' || c.consentStatus === 'WITHDRAWN' ? s.badgeWarn : ''}`}>
              {CONSENT_STATUS_LABELS[c.consentStatus as ConsentStatus] ?? c.consentStatus}
            </span>
          </div>
        </div>
        {!readOnly ? (
          <button type="button" className={s.btn} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <Pencil size={16} aria-hidden="true" />
            {editing ? '수정 닫기' : '수정'}
          </button>
        ) : null}
      </div>

      {readOnly ? <ReadOnlyBanner /> : null}

      {editing && !readOnly ? (
        <section className={s.card}>
          <h2 className={s.sectionTitle}>고객 정보 수정</h2>
          <CustomerForm
            initial={c}
            onSaved={(next) => {
              setData({ ...data, customer: next });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </section>
      ) : null}

      <div className={s.grid2}>
        <section className={s.card}>
          <h2 className={s.sectionTitle}>연락처·메모</h2>
          <ContactReveal<{ phone: string | null; email: string | null }>
            url={`/api/pro/customers/${encodeURIComponent(c.id)}/contact`}
            available={c.hasPhone || c.hasEmail}
            toRows={(d) => [
              { label: '전화', value: d.phone, tel: true },
              { label: '이메일', value: d.email },
            ]}
          />
          {c.memo ? (
            <>
              <hr className={s.divider} style={{ margin: '12px 0' }} />
              <p className={s.label} style={{ margin: 0 }}>
                메모(비공개)
              </p>
              <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-body-sm)', overflowWrap: 'anywhere' }}>{c.memo}</p>
            </>
          ) : null}
          <p className={s.help} style={{ marginTop: 8 }}>
            등록 {formatDate(c.createdAt)} · 동의 기록 {c.consentRecordedAt ? formatDate(c.consentRecordedAt) : '없음'}
          </p>
        </section>

        <section className={s.card}>
          <h2 className={s.sectionTitle}>팔로업</h2>
          <FollowupSection customerId={c.id} followups={data.followups} canRepeat={canRepeat} readOnly={readOnly} onChanged={reload} />
        </section>
      </div>

      <section className={s.card}>
        <h2 className={s.sectionTitle}>
          조건 세트
          {prefLimit != null ? (
            <span className={s.sectionCount}>
              {data.preferences.length} / {prefLimit}
            </span>
          ) : null}
        </h2>
        {data.preferences.length === 0 ? <p className={s.empty}>조건 세트가 없습니다. 조건을 추가하면 맞는 매물을 계산할 수 있습니다.</p> : null}
        <ul className={s.list}>
          {data.preferences.map((p) => (
            <li key={p.id} className={s.card} style={{ boxShadow: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <p className={s.cardTitle}>{p.label}</p>
                {!readOnly ? (
                  <button type="button" className={s.btnGhost} onClick={() => setEditPref(editPref === p.id ? null : p.id)} aria-expanded={editPref === p.id}>
                    <Pencil size={16} aria-hidden="true" />
                    {editPref === p.id ? '닫기' : '수정'}
                  </button>
                ) : null}
              </div>
              {editPref === p.id ? (
                <PreferenceForm
                  customerId={c.id}
                  initial={p}
                  onSaved={() => {
                    setEditPref(null);
                    setMatches(null);
                    void reload();
                  }}
                  onCancel={() => setEditPref(null)}
                />
              ) : (
                <PreferenceSummary p={p} />
              )}
            </li>
          ))}
        </ul>
        {!readOnly ? (
          addingPref ? (
            <div className={s.card} style={{ boxShadow: 'none', marginTop: 10 }}>
              <p className={s.cardTitle} style={{ marginBottom: 8 }}>
                새 조건 세트
              </p>
              <PreferenceForm
                customerId={c.id}
                onSaved={() => {
                  setAddingPref(false);
                  setMatches(null);
                  void reload();
                }}
                onCancel={() => setAddingPref(false)}
              />
            </div>
          ) : (
            <>
              <button type="button" className={s.btn} onClick={() => setAddingPref(true)} style={{ marginTop: 10 }}>
                <Plus size={16} aria-hidden="true" />
                조건 추가
              </button>
              {prefLimit != null && data.preferences.length >= prefLimit ? (
                <p className={s.help}>현재 플랜의 조건 세트 한도({prefLimit}개)에 도달했습니다. 추가하면 서버가 한도 안내를 돌려줍니다.</p>
              ) : null}
            </>
          )
        ) : null}
      </section>

      <section className={s.card}>
        <h2 className={s.sectionTitle}>맞는 매물</h2>
        <button type="button" className={s.btnPrimary} onClick={loadMatches} disabled={matchBusy || data.preferences.length === 0}>
          <ListChecks size={16} aria-hidden="true" />
          {matchBusy ? '계산 중' : matches ? '다시 계산' : '맞는 매물 보기'}
        </button>
        {data.preferences.length === 0 ? <p className={s.help}>조건 세트를 먼저 추가해 주세요.</p> : null}
        <InlineFailure failure={matchFailure} />
        {matches ? (
          <div style={{ marginTop: 12 }}>
            <MatchResults views={matches} customerId={c.id} readOnly={readOnly} />
          </div>
        ) : null}
      </section>

      {!readOnly ? (
        <section className={s.card}>
          <h2 className={s.sectionTitle}>고객 삭제</h2>
          {confirmDelete ? (
            <div className={s.banner} role="alert" style={{ flexDirection: 'column' }}>
              <span>이 고객을 삭제할까요? 연락처와 메모는 즉시 지워지며 되돌릴 수 없습니다.</span>
              <div className={s.btnRow}>
                <button type="button" className={s.btn} onClick={() => setConfirmDelete(false)} disabled={busy}>
                  취소
                </button>
                <button type="button" className={s.btnDanger} onClick={remove} disabled={busy}>
                  <Trash2 size={16} aria-hidden="true" />
                  삭제
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={s.btnDanger} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} aria-hidden="true" />
              삭제
            </button>
          )}
          <InlineFailure failure={actionFailure} />
        </section>
      ) : null}
    </div>
  );
}
