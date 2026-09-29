'use client';

// REALTOR_PRO_MVP_V1 — 명시적 "연락처 보기". 버튼을 누를 때만 POST(복호화 + 감사로그). 화면을 떠나면 값은 사라진다.

import { useState } from 'react';
import { Eye, EyeOff, Phone } from 'lucide-react';
import { proFetch, type ApiFailure } from './api';
import { InlineFailure } from './ProStateGate';
import s from './pro.module.css';

type Row = { label: string; value: string | null; tel?: boolean };

export default function ContactReveal<T>({ url, available, toRows }: { url: string; available: boolean; toRows: (data: T) => Row[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const reveal = async () => {
    setBusy(true);
    setFailure(null);
    const r = await proFetch<T>(url, { method: 'POST', body: {} });
    setBusy(false);
    if (r.ok) setRows(toRows(r.data as T));
    else setFailure(r);
  };

  if (!available) return <p className={s.muted}>등록된 연락처가 없습니다.</p>;

  if (rows) {
    return (
      <div>
        <dl className={s.kv}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt>{row.label}</dt>
              <dd>
                {row.value ? (
                  row.tel ? (
                    <a href={`tel:${row.value.replace(/[^\d+]/g, '')}`} className={s.linkBtn} style={{ minHeight: 0 }}>
                      <Phone size={14} aria-hidden="true" />
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )
                ) : (
                  '없음'
                )}
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" className={s.btnGhost} onClick={() => setRows(null)}>
          <EyeOff size={16} aria-hidden="true" />
          연락처 숨기기
        </button>
      </div>
    );
  }

  return (
    <div className={s.field}>
      <button type="button" className={s.btn} onClick={reveal} disabled={busy}>
        <Eye size={16} aria-hidden="true" />
        {busy ? '확인 중' : '연락처 보기'}
      </button>
      <p className={s.help}>연락처는 암호화되어 저장되며, 조회할 때마다 기록이 남습니다.</p>
      <InlineFailure failure={failure} />
    </div>
  );
}
