'use client';

// REALTOR_PRO_MVP_V1 — 매물 단지 선택. 이집 공개 검색(/api/search)의 APARTMENT 결과에서 고른 값만 aptSeq로 저장한다.
// 이름만 입력하고 결과를 고르지 않으면 aptSeq는 null("단지 정보 미연결") — 이름으로 단지를 추정·연결하지 않는다.

import { useEffect, useRef, useState } from 'react';
import { Building2, Link2Off, Search, X } from 'lucide-react';
import type { PublicAptInfo } from '@/lib/pro/types';
import { proFetch, type Wire } from './api';
import s from './pro.module.css';

export interface AptSelection {
  aptSeq: string | null;
  lawdCd: string | null;
  umdName: string | null;
  aptNameSnapshot: string;
}

interface SearchApartment {
  type: 'APARTMENT';
  apartmentId: number;
  name: string;
  lawdCd: string | null;
  dong: string | null;
  jibun: string | null;
  aptSeq: string | null;
  completionYear: number | null;
  totalHouseholds: number | null;
}

export default function ApartmentPicker({
  value,
  onChange,
  onPrefill,
}: {
  value: AptSelection;
  onChange: (v: AptSelection) => void;
  onPrefill: (info: Wire<PublicAptInfo> | null, state: 'idle' | 'loading' | 'done' | 'failed') => void;
}) {
  const [query, setQuery] = useState(value.aptNameSnapshot);
  const [results, setResults] = useState<SearchApartment[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onPrefillRef = useRef(onPrefill);
  useEffect(() => {
    onPrefillRef.current = onPrefill;
  }, [onPrefill]);

  // 선택된 aptSeq가 있으면 prefill 조회(편집 화면 최초 진입 포함)
  useEffect(() => {
    if (!value.aptSeq) {
      onPrefillRef.current(null, 'idle');
      return;
    }
    const ac = new AbortController();
    onPrefillRef.current(null, 'loading');
    void proFetch<PublicAptInfo | null>(`/api/pro/apartments/${encodeURIComponent(value.aptSeq)}`, { signal: ac.signal }).then((r) => {
      if (ac.signal.aborted) return;
      if (r.ok) onPrefillRef.current(r.data, 'done');
      else if (r.code !== 'ABORTED') onPrefillRef.current(null, 'failed');
    });
    return () => ac.abort();
  }, [value.aptSeq]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        const json = (await res.json()) as { apartments?: SearchApartment[] };
        if (!ac.signal.aborted) setResults(Array.isArray(json.apartments) ? json.apartments.slice(0, 8) : []);
      } catch {
        if (!ac.signal.aborted) setResults([]);
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const typeName = (text: string) => {
    setQuery(text);
    setOpen(true);
    // 직접 입력하면 이전 선택(aptSeq)을 끊는다 — 이름만으로 연결하지 않음
    onChange({ aptSeq: null, lawdCd: null, umdName: null, aptNameSnapshot: text });
  };

  const choose = (a: SearchApartment) => {
    setQuery(a.name);
    setOpen(false);
    setResults([]);
    onChange({ aptSeq: a.aptSeq ?? null, lawdCd: a.lawdCd ?? null, umdName: a.dong ?? null, aptNameSnapshot: a.name });
  };

  const clearSel = () => {
    setQuery('');
    setResults([]);
    onChange({ aptSeq: null, lawdCd: null, umdName: null, aptNameSnapshot: '' });
  };

  return (
    <div className={s.field}>
      <label className={s.label} htmlFor="pro-apt-search">
        단지<span className={s.required}>*</span>
      </label>
      <div className={s.searchRow} style={{ position: 'relative' }}>
        <input
          id="pro-apt-search"
          className={s.input}
          value={query}
          onChange={(e) => typeName(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="단지명으로 검색 (2글자 이상)"
          autoComplete="off"
          maxLength={80}
          aria-describedby="pro-apt-help"
        />
        {query ? (
          <button type="button" className={s.btn} onClick={clearSel} aria-label="단지 선택 지우기">
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {value.aptSeq ? (
        <div className={s.badges}>
          <span className={`${s.badge} ${s.badgeBrand}`}>
            <Building2 size={12} aria-hidden="true" />
            단지 연결됨{value.umdName ? ` · ${value.umdName}` : ''}
          </span>
        </div>
      ) : value.aptNameSnapshot ? (
        <div className={s.badges}>
          <span className={`${s.badge} ${s.badgeWarn}`}>
            <Link2Off size={12} aria-hidden="true" />
            단지 정보 미연결
          </span>
        </div>
      ) : null}
      <p id="pro-apt-help" className={s.help}>
        검색 결과에서 단지를 고르면 공공 단지 정보가 연결됩니다. 고르지 않고 이름만 입력하면 &quot;단지 정보 미연결&quot;로 저장됩니다.
      </p>
      {open && query.trim().length >= 2 ? (
        <ul className={s.list} role="listbox" aria-label="단지 검색 결과" style={{ gap: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', background: 'var(--card-bg)', padding: '0 12px' }}>
          {searching ? <li className={s.rowItem}><span className={s.muted}>검색 중</span></li> : null}
          {!searching && results.length === 0 ? (
            <li className={s.rowItem}>
              <span className={s.muted}>
                <Search size={14} aria-hidden="true" /> 검색 결과가 없습니다. 이름만 입력해 저장할 수 있습니다.
              </span>
            </li>
          ) : null}
          {results.map((a) => (
            <li key={`${a.apartmentId}-${a.aptSeq ?? 'none'}`} className={s.rowItem} role="option" aria-selected={value.aptSeq != null && value.aptSeq === a.aptSeq}>
              <button type="button" onClick={() => choose(a)} className={s.rowMain} style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, minHeight: 44, cursor: 'pointer' }}>
                <span className={s.rowTitle}>{a.name}</span>
                <span className={s.meta} style={{ marginTop: 2 }}>
                  {a.dong ? <span>{a.dong}</span> : null}
                  {a.completionYear ? <span>{a.completionYear}년</span> : null}
                  {a.totalHouseholds ? <span>{a.totalHouseholds.toLocaleString('ko-KR')}세대</span> : null}
                  {!a.aptSeq ? <span>단지 정보 미연결</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
