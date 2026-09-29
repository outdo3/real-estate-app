'use client';

// REALTOR_PRO_MVP_V1 — 매물 상세: 공공 정보 · 수정 · 노트 · 상태(보관/활성/계약완료) · 삭제 · 연락처 보기 · 맞는 고객 · 브리핑.

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowLeft, FileText, Handshake, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import {
  LISTING_SOURCE_LABELS,
  REPAIR_STATUS_LABELS,
  SENSITIVE_WARNING,
  TENANT_STATUS_LABELS,
  VIEWING_METHOD_LABELS,
  type ListingSource,
  type RepairStatus,
  type TenantStatus,
  type ViewingMethod,
} from '@/lib/pro/rules';
import type { ListingDetail } from '@/lib/pro/listing-service';
import type { MatchResult } from '@/lib/pro/matching';
import type { ListingDto } from '@/lib/pro/service-core';
import type { ListingNoteRow } from '@/lib/pro/types';
import { proFetch, type ApiFailure, type Wire } from '@/components/pro/api';
import ContactReveal from '@/components/pro/ContactReveal';
import { floorText, formatDate, formatDateTime, formatDealPrice, formatM2, formatManwon } from '@/components/pro/format';
import ListingForm from '@/components/pro/ListingForm';
import { ReasonList, ScoreBadge, MATCH_SCORE_NOTE } from '@/components/pro/MatchResults';
import PublicInfoPanel from '@/components/pro/PublicInfoPanel';
import { InlineFailure, LoadingState, ProErrorState, useProMe, useProQuery } from '@/components/pro/ProStateGate';
import { SaverFeedback, useSaver } from '@/components/pro/useSaver';
import s from '@/components/pro/pro.module.css';

type ListingMatch = { customerId: string; customerName: string; preferenceLabel: string; result: MatchResult };

const yn = (v: boolean | null) => (v === true ? '가능' : v === false ? '불가' : '확인 필요');

function NoteText({ n }: { n: Wire<ListingNoteRow> }) {
  if (n.kind === 'PRICE_CHANGE') return <>가격 변경 {formatManwon(n.prevPriceManwon)} → {formatManwon(n.newPriceManwon)}</>;
  if (n.kind === 'STATUS_CHANGE') return <>상태 변경: {n.body}</>;
  return <>{n.body}</>;
}

function NotesSection({ listingId, notes, readOnly, fullHistory, onChanged }: { listingId: string; notes: Wire<ListingNoteRow>[]; readOnly: boolean; fullHistory: boolean; onChanged: () => void }) {
  const [body, setBody] = useState('');
  const saver = useSaver<ListingNoteRow>();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    void saver.run(`/api/pro/listings/${encodeURIComponent(listingId)}/notes`, 'POST', { body: body.trim() }, () => {
      setBody('');
      onChanged();
    });
  };
  return (
    <div>
      {notes.length ? (
        <ul className={s.list} style={{ gap: 0 }}>
          {notes.map((n) => (
            <li key={n.id} className={s.rowItem}>
              <div className={s.rowMain}>
                <div style={{ fontSize: 'var(--font-size-body-sm)', whiteSpace: 'pre-wrap' }}>
                  <NoteText n={n} />
                </div>
                <div className={s.meta} style={{ marginTop: 2 }}>
                  <span>{formatDateTime(n.createdAt)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={s.empty}>노트가 없습니다.</p>
      )}
      {!fullHistory ? <p className={s.help}>Free 플랜은 최근 노트 1건만 보여줍니다.</p> : null}
      {!readOnly ? (
        <form className={s.form} onSubmit={submit} style={{ marginTop: 12 }} noValidate>
          <div className={s.field}>
            <label className={s.label} htmlFor="note-body">
              노트 추가
            </label>
            <textarea id="note-body" className={s.textarea} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
            <p className={s.warnNote}>
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{SENSITIVE_WARNING}</span>
            </p>
          </div>
          <SaverFeedback saver={saver} />
          <button type="submit" className={s.btn} disabled={saver.busy || !body.trim()}>
            노트 저장
          </button>
        </form>
      ) : null}
    </div>
  );
}

function MatchedCustomers({ listingId }: { listingId: string }) {
  const { data, failure, loading, reload } = useProQuery<ListingMatch[]>(`/api/pro/listings/${encodeURIComponent(listingId)}/matches`);
  if (loading && !data) return <p className={s.muted}>계산 중입니다</p>;
  if (failure) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data || data.length === 0) return <p className={s.empty}>이 매물에 맞는 고객 조건이 없습니다.</p>;
  return (
    <div>
      <p className={s.help}>{MATCH_SCORE_NOTE}</p>
      <ul className={s.list}>
        {data.map((m) => (
          <li key={m.customerId} className={s.card} style={{ boxShadow: 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Link href={`/pro/customers/${encodeURIComponent(m.customerId)}`} className={s.rowTitle} style={{ fontWeight: 600 }}>
                  {m.customerName}
                </Link>
                <span className={s.muted}> · {m.preferenceLabel}</span>
              </div>
              <ScoreBadge score={m.result.score} confidence={m.result.confidence} passedHard={m.result.passedHard} />
            </div>
            <ReasonList reasons={m.result.reasons} />
            {m.result.exclusions.length ? (
              <details style={{ marginTop: 6 }}>
                <summary className={s.muted} style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
                  조건 밖 사유 {m.result.exclusions.length}건
                </summary>
                <ReasonList reasons={m.result.exclusions} />
              </details>
            ) : null}
            <Link href={`/pro/briefings/new?listingId=${encodeURIComponent(listingId)}&customerId=${encodeURIComponent(m.customerId)}`} className={s.linkBtn}>
              <FileText size={16} aria-hidden="true" />
              이 고객용 브리핑 만들기
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProListingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();
  const me = useProMe();
  const { data, failure, loading, reload, setData } = useProQuery<ListingDetail>(id ? `/api/pro/listings/${encodeURIComponent(id)}` : null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionFailure, setActionFailure] = useState<ApiFailure | null>(null);
  const [showMatches, setShowMatches] = useState(false);

  if (loading && !data) return <LoadingState />;
  if (failure && !data) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;

  const l = data.listing;
  const readOnly = me.data?.state === 'SUSPENDED';
  const fullHistory = me.data?.capabilities.listingNoteHistory === 'FULL';

  const setState = async (body: { active: boolean; closed?: boolean }) => {
    setBusy(true);
    setActionFailure(null);
    const r = await proFetch<ListingDto>(`/api/pro/listings/${encodeURIComponent(id)}/state`, { method: 'POST', body });
    setBusy(false);
    if (r.ok) void reload();
    else setActionFailure(r);
  };

  const remove = async () => {
    setBusy(true);
    setActionFailure(null);
    const r = await proFetch(`/api/pro/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) router.push('/pro/listings');
    else setActionFailure(r);
  };

  const floor = floorText(l.floor, l.floorBand);

  return (
    <div className={s.page}>
      <Link href="/pro/listings" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        매물 목록
      </Link>

      <div className={s.pageHead}>
        <div style={{ minWidth: 0 }}>
          <h1 className={s.pageTitle}>{l.aptNameSnapshot}</h1>
          <p className={s.cardPrice}>{formatDealPrice(l)}</p>
          <div className={s.badges}>
            <span className={`${s.badge} ${l.isActive ? s.badgeBrand : ''}`}>{l.isActive ? '활성' : l.closedAt ? '계약완료' : '보관'}</span>
            {!l.aptSeq ? <span className={`${s.badge} ${s.badgeWarn}`}>단지 정보 미연결</span> : null}
            {l.tags.map((t) => (
              <span key={t} className={s.badge}>
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {readOnly ? <InlineFailure failure={{ ok: false, status: 403, code: 'SUSPENDED', error: '이용이 정지된 계정입니다. 조회만 가능합니다.' }} /> : null}

      {!readOnly ? (
        <div className={s.btnRow}>
          <Link href={`/pro/briefings/new?listingId=${encodeURIComponent(l.id)}`} className={s.btnPrimary}>
            <FileText size={16} aria-hidden="true" />
            브리핑 만들기
          </Link>
          <button type="button" className={s.btn} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            <Pencil size={16} aria-hidden="true" />
            {editing ? '수정 닫기' : '수정'}
          </button>
          {l.isActive ? (
            <>
              <button type="button" className={s.btn} onClick={() => setState({ active: false })} disabled={busy}>
                <Archive size={16} aria-hidden="true" />
                보관
              </button>
              <button type="button" className={s.btn} onClick={() => setState({ active: false, closed: true })} disabled={busy}>
                <Handshake size={16} aria-hidden="true" />
                계약완료
              </button>
            </>
          ) : (
            <button type="button" className={s.btn} onClick={() => setState({ active: true })} disabled={busy}>
              <ArchiveRestore size={16} aria-hidden="true" />
              다시 활성화
            </button>
          )}
        </div>
      ) : null}
      <InlineFailure failure={actionFailure} />

      {editing && !readOnly ? (
        <section className={s.card}>
          <h2 className={s.sectionTitle}>매물 수정</h2>
          <ListingForm
            initial={l}
            onSaved={(next) => {
              setData({ ...data, listing: next });
              setEditing(false);
              void reload();
            }}
          />
        </section>
      ) : null}

      <div className={s.grid2}>
        <section className={s.card}>
          <h2 className={s.sectionTitle}>매물 정보</h2>
          <dl className={s.kv}>
            <dt>전용면적</dt>
            <dd>{formatM2(l.exclusiveAreaM2)}</dd>
            <dt>층</dt>
            <dd>{floor ?? '-'}</dd>
            <dt>동·호</dt>
            <dd>{[l.buildingDong ? `${l.buildingDong}동` : null, l.unitHo ? `${l.unitHo}호` : null].filter(Boolean).join(' ') || '-'}</dd>
            <dt>거주 상태</dt>
            <dd>{l.tenantStatus ? TENANT_STATUS_LABELS[l.tenantStatus as TenantStatus] : '-'}</dd>
            <dt>임대 만기</dt>
            <dd>{l.tenantLeaseEndsAt ? formatDate(l.tenantLeaseEndsAt) : '-'}</dd>
            <dt>입주 가능</dt>
            <dd>
              {l.moveInAvailableAt ? formatDate(l.moveInAvailableAt) : '-'}
              {l.moveInNegotiable ? ' (협의 가능)' : ''}
            </dd>
            <dt>수리</dt>
            <dd>
              {l.repairStatus ? REPAIR_STATUS_LABELS[l.repairStatus as RepairStatus] : '-'}
              {l.repairNote ? ` · ${l.repairNote}` : ''}
            </dd>
            <dt>주차</dt>
            <dd>
              {yn(l.parkingAvailable)}
              {l.parkingNote ? ` · ${l.parkingNote}` : ''}
            </dd>
            <dt>반려동물</dt>
            <dd>{yn(l.petAllowed)}</dd>
            <dt>방문 방법</dt>
            <dd>
              {VIEWING_METHOD_LABELS[l.viewingMethod as ViewingMethod] ?? l.viewingMethod}
              {l.viewingNote ? ` · ${l.viewingNote}` : ''}
            </dd>
            <dt>출처</dt>
            <dd>{l.source ? LISTING_SOURCE_LABELS[l.source as ListingSource] : '-'}</dd>
            <dt>등록</dt>
            <dd>{formatDate(l.createdAt)}</dd>
          </dl>
          {l.memo ? (
            <>
              <hr className={s.divider} style={{ margin: '12px 0' }} />
              <p className={s.label} style={{ margin: 0 }}>
                메모(비공개)
              </p>
              <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-body-sm)', overflowWrap: 'anywhere' }}>{l.memo}</p>
            </>
          ) : null}
        </section>

        <section className={s.card}>
          <h2 className={s.sectionTitle}>공공 단지 정보</h2>
          <PublicInfoPanel aptSeq={l.aptSeq} info={data.publicInfo} />
        </section>

        <section className={s.card}>
          <h2 className={s.sectionTitle}>소유자</h2>
          <p className={s.muted} style={{ margin: '0 0 8px' }}>
            이름: {l.hasOwnerName ? '등록됨' : '없음'} · 연락처: {l.hasOwnerPhone ? '등록됨' : '없음'}
          </p>
          <ContactReveal<{ ownerName: string | null; ownerPhone: string | null }>
            url={`/api/pro/listings/${encodeURIComponent(l.id)}/contact`}
            available={l.hasOwnerName || l.hasOwnerPhone}
            toRows={(d) => [
              { label: '이름', value: d.ownerName },
              { label: '연락처', value: d.ownerPhone, tel: true },
            ]}
          />
        </section>

        <section className={s.card}>
          <h2 className={s.sectionTitle}>노트</h2>
          <NotesSection listingId={l.id} notes={data.notes} readOnly={readOnly} fullHistory={fullHistory} onChanged={reload} />
        </section>
      </div>

      <section className={s.card}>
        <h2 className={s.sectionTitle}>이 매물에 맞는 고객</h2>
        {showMatches ? (
          <MatchedCustomers listingId={l.id} />
        ) : (
          <button type="button" className={s.btn} onClick={() => setShowMatches(true)}>
            맞는 고객 계산하기
          </button>
        )}
      </section>

      {!readOnly ? (
        <section className={s.card}>
          <h2 className={s.sectionTitle}>매물 삭제</h2>
          {confirmDelete ? (
            <div className={s.banner} role="alert" style={{ flexDirection: 'column' }}>
              <span>이 매물을 삭제할까요? 삭제한 매물은 목록과 매칭에서 사라집니다.</span>
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
        </section>
      ) : null}
    </div>
  );
}
