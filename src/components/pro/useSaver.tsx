'use client';

// REALTOR_PRO_MVP_V1 — 쓰기 요청 공용 훅 + 피드백.
// 422 SENSITIVE_TEXT_CONFIRM이면 서버 경고문과 해당 필드를 인라인 패널로 보여주고, "그래도 저장"을 누르면
// 같은 본문에 confirmSensitive:true만 더해 다시 보낸다(window.confirm/alert 사용 안 함).

import { useCallback, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { describeFieldErrors, fieldLabel, proFetch, type ApiFailure, type Wire } from './api';
import { InlineFailure } from './ProStateGate';
import s from './pro.module.css';

type Pending<T> = { url: string; method: string; body: Record<string, unknown>; onSuccess: (data: Wire<T>) => void };

export function useSaver<T>() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sensitive, setSensitive] = useState<ApiFailure | null>(null);
  const pending = useRef<Pending<T> | null>(null);

  const send = useCallback(async (p: Pending<T>, confirmSensitive: boolean) => {
    setBusy(true);
    setFailure(null);
    const body = confirmSensitive ? { ...p.body, confirmSensitive: true } : p.body;
    const r = await proFetch<T>(p.url, { method: p.method, body });
    setBusy(false);
    if (r.ok) {
      setSensitive(null);
      pending.current = null;
      p.onSuccess(r.data);
      return true;
    }
    if (r.code === 'SENSITIVE_TEXT_CONFIRM') {
      pending.current = p;
      setSensitive(r);
      return false;
    }
    setSensitive(null);
    setFailure(r);
    return false;
  }, []);

  const run = useCallback(
    (url: string, method: string, body: Record<string, unknown>, onSuccess: (data: Wire<T>) => void) => send({ url, method, body, onSuccess }, false),
    [send]
  );

  const confirm = useCallback(() => {
    if (pending.current) void send(pending.current, true);
  }, [send]);

  const cancel = useCallback(() => {
    pending.current = null;
    setSensitive(null);
  }, []);

  const clear = useCallback(() => {
    setFailure(null);
    setSensitive(null);
  }, []);

  return { busy, failure, sensitive, run, confirm, cancel, clear };
}

export function SaverFeedback({ saver }: { saver: Pick<ReturnType<typeof useSaver>, 'busy' | 'failure' | 'sensitive' | 'confirm' | 'cancel'> }) {
  if (saver.sensitive) {
    return (
      <div className={s.banner} role="alert" style={{ flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>저장 전에 확인해 주세요</strong>
            <p style={{ margin: '4px 0 0' }}>{saver.sensitive.error}</p>
            {saver.sensitive.sensitiveFields?.length ? (
              <p style={{ margin: '4px 0 0' }}>확인 필요 항목: {saver.sensitive.sensitiveFields.map(fieldLabel).join(', ')}</p>
            ) : null}
          </div>
        </div>
        <div className={s.btnRow}>
          <button type="button" className={s.btn} onClick={saver.cancel} disabled={saver.busy}>
            돌아가서 수정
          </button>
          <button type="button" className={s.btnDanger} onClick={saver.confirm} disabled={saver.busy}>
            그래도 저장
          </button>
        </div>
      </div>
    );
  }
  if (!saver.failure) return null;
  const fieldErrors = describeFieldErrors(saver.failure.fields);
  if (fieldErrors.length) {
    return (
      <div className={s.errorBox} role="alert">
        {saver.failure.error}
        <ul>
          {fieldErrors.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    );
  }
  return <InlineFailure failure={saver.failure} />;
}
