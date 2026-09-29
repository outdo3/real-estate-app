'use client';

// REALTOR_PRO_MVP_V1 — 고객 등록/수정 폼. 연락처는 서버가 즉시 암호화한다(수정 화면에 기존 값을 채우지 않음).

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  CONSENT_STATUSES,
  CONSENT_STATUS_LABELS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_LABELS,
  PRIORITY_MAX,
  PRIORITY_MIN,
  SENSITIVE_WARNING,
  TEXT_LIMITS,
} from '@/lib/pro/rules';
import type { CustomerDto } from '@/lib/pro/service-core';
import type { Wire } from './api';
import { SaverFeedback, useSaver } from './useSaver';
import s from './pro.module.css';

type CustomerW = Wire<CustomerDto>;

export const PRIORITY_LABELS: Record<number, string> = { 1: '높음', 2: '보통', 3: '낮음' };

export default function CustomerForm({ initial, onSaved, onCancel }: { initial?: CustomerW | null; onSaved: (c: CustomerW) => void; onCancel?: () => void }) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [clearPhone, setClearPhone] = useState(false);
  const [clearEmail, setClearEmail] = useState(false);
  const [status, setStatus] = useState<string>(initial?.status ?? 'NEW');
  const [priority, setPriority] = useState<number>(initial?.priority ?? 2);
  const [consent, setConsent] = useState<string>(initial?.consentStatus ?? 'NOT_RECORDED');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const saver = useSaver<CustomerDto>();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!name.trim()) {
      setLocalError('고객 이름을 입력해 주세요.');
      return;
    }
    const body: Record<string, unknown> = { name: name.trim(), status, priority, consentStatus: consent, memo: memo.trim() || null };
    if (phone.trim()) body.phone = phone.trim();
    else if (!editing || clearPhone) body.phone = null;
    if (email.trim()) body.email = email.trim();
    else if (!editing || clearEmail) body.email = null;
    void saver.run(editing ? `/api/pro/customers/${initial!.id}` : '/api/pro/customers', editing ? 'PATCH' : 'POST', body, (c) => {
      setPhone('');
      setEmail('');
      setClearPhone(false);
      setClearEmail(false);
      onSaved(c);
    });
  };

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>기본 정보</legend>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-c-name">
            이름<span className={s.required}>*</span>
          </label>
          <input id="pro-c-name" className={s.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={TEXT_LIMITS.name} autoComplete="off" />
        </div>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-c-phone">
              전화번호
            </label>
            <input
              id="pro-c-phone"
              className={s.input}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={TEXT_LIMITS.phone}
              autoComplete="off"
              placeholder={editing && initial?.hasPhone ? '변경할 때만 입력' : '010-0000-0000'}
            />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-c-email">
              이메일
            </label>
            <input
              id="pro-c-email"
              className={s.input}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={TEXT_LIMITS.email}
              autoComplete="off"
              placeholder={editing && initial?.hasEmail ? '변경할 때만 입력' : ''}
            />
          </div>
        </div>
        <p className={s.help}>연락처는 암호화되어 저장되며, 목록에는 표시되지 않습니다.</p>
        {editing && initial?.hasPhone ? (
          <label className={s.checkRow}>
            <input type="checkbox" checked={clearPhone} onChange={(e) => setClearPhone(e.target.checked)} disabled={!!phone.trim()} />
            <span>저장된 전화번호 삭제</span>
          </label>
        ) : null}
        {editing && initial?.hasEmail ? (
          <label className={s.checkRow}>
            <input type="checkbox" checked={clearEmail} onChange={(e) => setClearEmail(e.target.checked)} disabled={!!email.trim()} />
            <span>저장된 이메일 삭제</span>
          </label>
        ) : null}
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>상태</legend>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-c-status">
              진행 상태
            </label>
            <select id="pro-c-status" className={s.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              {CUSTOMER_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {CUSTOMER_STATUS_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-c-priority">
              우선순위
            </label>
            <select id="pro-c-priority" className={s.select} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {Array.from({ length: PRIORITY_MAX - PRIORITY_MIN + 1 }, (_, i) => PRIORITY_MIN + i).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p] ?? p}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-c-consent">
            개인정보 동의
          </label>
          <select id="pro-c-consent" className={s.select} value={consent} onChange={(e) => setConsent(e.target.value)}>
            {CONSENT_STATUSES.map((v) => (
              <option key={v} value={v}>
                {CONSENT_STATUS_LABELS[v]}
              </option>
            ))}
          </select>
          <p className={s.help}>고객 동의 여부를 기록하세요.</p>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-c-memo">
            메모(비공개)
          </label>
          <textarea id="pro-c-memo" className={s.textarea} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={TEXT_LIMITS.memo} />
          <p className={s.warnNote}>
            <TriangleAlert size={14} aria-hidden="true" />
            <span>{SENSITIVE_WARNING}</span>
          </p>
          <p className={s.help}>메모는 매칭 조건으로 쓰이지 않습니다. 매칭 조건은 고객 상세의 조건 세트에서 입력하세요.</p>
        </div>
      </fieldset>

      {localError ? (
        <div className={s.errorBox} role="alert">
          {localError}
        </div>
      ) : null}
      <SaverFeedback saver={saver} />
      <div className={s.btnRow}>
        {onCancel ? (
          <button type="button" className={s.btn} onClick={onCancel}>
            취소
          </button>
        ) : null}
        <button type="submit" className={s.btnPrimary} disabled={saver.busy} style={{ flex: 1 }}>
          {saver.busy ? '저장 중' : editing ? '수정 저장' : '고객 등록'}
        </button>
      </div>
    </form>
  );
}
