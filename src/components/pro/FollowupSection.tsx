'use client';

// REALTOR_PRO_MVP_V1 — 고객 팔로업(재연락·방문·계약·입주). 발송 기능 없음 — 일정 기록과 완료 처리만.

import { useState } from 'react';
import { CalendarClock, Check, Plus, X } from 'lucide-react';
import { FOLLOWUP_KINDS, FOLLOWUP_KIND_LABELS, REPEAT_RULES, TEXT_LIMITS, type FollowupKind } from '@/lib/pro/rules';
import type { FollowupRow } from '@/lib/pro/types';
import { proFetch, type ApiFailure, type Wire } from './api';
import { dateTimeInputToIso, formatDateTime, toDateInput } from './format';
import { InlineFailure } from './ProStateGate';
import { SaverFeedback, useSaver } from './useSaver';
import s from './pro.module.css';

type FollowupW = Wire<FollowupRow>;
const REPEAT_LABELS: Record<string, string> = { WEEKLY: '매주', MONTHLY: '매월' };

export function FollowupItem({ f, customerName, readOnly, onChanged }: { f: FollowupW & { overdue?: boolean }; customerName?: string | null; readOnly: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [now] = useState(() => Date.now());
  const act = async (action: 'done' | 'cancel') => {
    setBusy(true);
    const r = await proFetch(`/api/pro/followups/${encodeURIComponent(f.id)}`, { method: 'PATCH', body: { action } });
    setBusy(false);
    if (r.ok) onChanged();
    else setFailure(r);
  };
  const overdue = f.overdue ?? new Date(f.dueAt).getTime() < now;
  return (
    <li className={s.rowItem} style={{ flexWrap: 'wrap' }}>
      <div className={s.rowMain}>
        <div className={s.rowTitle}>
          {FOLLOWUP_KIND_LABELS[f.kind as FollowupKind] ?? f.kind}
          {customerName ? ` · ${customerName}` : ''}
        </div>
        <div className={s.meta} style={{ marginTop: 2 }}>
          <span>
            <CalendarClock size={12} aria-hidden="true" /> {formatDateTime(f.dueAt)}
          </span>
          {overdue && f.status === 'OPEN' ? <span className={`${s.badge} ${s.badgeError}`}>지남</span> : null}
          {f.repeatRule ? <span className={s.badge}>{REPEAT_LABELS[f.repeatRule] ?? f.repeatRule} 반복</span> : null}
        </div>
        {f.note ? <p className={s.muted} style={{ margin: '4px 0 0' }}>{f.note}</p> : null}
      </div>
      {!readOnly && f.status === 'OPEN' ? (
        <div className={s.btnRow}>
          <button type="button" className={s.btn} onClick={() => act('done')} disabled={busy}>
            <Check size={16} aria-hidden="true" />
            완료
          </button>
          <button type="button" className={s.btnGhost} onClick={() => act('cancel')} disabled={busy}>
            <X size={16} aria-hidden="true" />
            취소
          </button>
        </div>
      ) : null}
      {failure ? (
        <div style={{ width: '100%' }}>
          <InlineFailure failure={failure} />
        </div>
      ) : null}
    </li>
  );
}

export default function FollowupSection({
  customerId,
  followups,
  canRepeat,
  readOnly,
  onChanged,
}: {
  customerId: string;
  followups: FollowupW[];
  canRepeat: boolean;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const open = followups.filter((f) => f.status === 'OPEN').sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<FollowupKind>('CALL');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [time, setTime] = useState('10:00');
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const saver = useSaver<FollowupRow>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const dueAt = dateTimeInputToIso(date, time);
    if (!dueAt) {
      setLocalError('날짜를 입력해 주세요.');
      return;
    }
    setLocalError(null);
    void saver.run('/api/pro/followups', 'POST', { customerId, kind, dueAt, note: note.trim() || null, repeatRule: canRepeat && repeat ? repeat : null }, () => {
      setAdding(false);
      setNote('');
      setRepeat('');
      onChanged();
    });
  };

  return (
    <div>
      {open.length ? (
        <ul className={s.list} style={{ gap: 0 }}>
          {open.map((f) => (
            <FollowupItem key={f.id} f={f} readOnly={readOnly} onChanged={onChanged} />
          ))}
        </ul>
      ) : (
        <p className={s.empty}>진행 중인 팔로업이 없습니다.</p>
      )}
      {readOnly ? null : adding ? (
        <form className={s.form} onSubmit={submit} style={{ marginTop: 12 }} noValidate>
          <div className={s.field}>
            <label className={s.label} htmlFor="fu-kind">
              종류
            </label>
            <select id="fu-kind" className={s.select} value={kind} onChange={(e) => setKind(e.target.value as FollowupKind)}>
              {FOLLOWUP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FOLLOWUP_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className={s.row2}>
            <div className={s.field}>
              <label className={s.label} htmlFor="fu-date">
                날짜
              </label>
              <input id="fu-date" type="date" className={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="fu-time">
                시각
              </label>
              <input id="fu-time" type="time" className={s.input} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="fu-note">
              메모
            </label>
            <input id="fu-note" className={s.input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={TEXT_LIMITS.shortNote} />
          </div>
          {canRepeat ? (
            <div className={s.field}>
              <label className={s.label} htmlFor="fu-repeat">
                반복
              </label>
              <select id="fu-repeat" className={s.select} value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                <option value="">반복 안 함</option>
                {REPEAT_RULES.map((r) => (
                  <option key={r} value={r}>
                    {REPEAT_LABELS[r]}
                  </option>
                ))}
              </select>
              <p className={s.help}>완료 처리하면 다음 일정 1건이 자동으로 만들어집니다.</p>
            </div>
          ) : null}
          {localError ? (
            <div className={s.errorBox} role="alert">
              {localError}
            </div>
          ) : null}
          <SaverFeedback saver={saver} />
          <div className={s.btnRow}>
            <button type="button" className={s.btn} onClick={() => setAdding(false)}>
              취소
            </button>
            <button type="submit" className={s.btnPrimary} disabled={saver.busy} style={{ flex: 1 }}>
              팔로업 추가
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={s.btn} onClick={() => setAdding(true)} style={{ marginTop: 10 }}>
          <Plus size={16} aria-hidden="true" />
          팔로업 추가
        </button>
      )}
    </div>
  );
}
