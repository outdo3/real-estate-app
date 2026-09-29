'use client';

// REALTOR_PRO_MVP_V1 — 고객 조건 세트 편집. 지역(lawdCd)·단지(aptSeq)는 이집 공개 검색 결과에서 고른 값만 넣는다(직접 추정 없음).
// 통근지 좌표·학교는 이 화면에서 새로 입력하지 않는다(좌표 변환 기능 없음) — 기존 값이 있으면 그대로 유지한다.

import { useEffect, useRef, useState } from 'react';
import { MapPin, Building2, X } from 'lucide-react';
import {
  BUDGET_TOLERANCE_MAX_PCT,
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  FLOOR_BANDS,
  FLOOR_BAND_LABELS,
  MUST_HAVE_KEYS,
  TEXT_LIMITS,
  type DealType,
  type MustHaveKey,
} from '@/lib/pro/rules';
import type { PreferenceRow } from '@/lib/pro/types';
import type { Wire } from './api';
import { dateInputToIso, formatManwon, parseIntInput, parseNumInput, toDateInput } from './format';
import { SaverFeedback, useSaver } from './useSaver';
import s from './pro.module.css';

type PrefW = Wire<PreferenceRow>;

export const MUST_HAVE_LABELS: Record<MustHaveKey, string> = { parking: '주차 필수', pet: '반려동물 필수', moveIn: '입주일 필수', area: '면적 필수' };

const triToStr = (v: boolean | null | undefined) => (v === true ? 'true' : v === false ? 'false' : '');
const strToTri = (v: string) => (v === 'true' ? true : v === 'false' ? false : null);

type AreaPick = { kind: 'REGION' | 'APT'; code: string; label: string };

function AreaSearch({ onPick }: { onPick: (p: AreaPick) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AreaPick[]>([]);
  const [busy, setBusy] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(async () => {
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: ac.signal });
        const json = (await res.json()) as {
          regions?: { name: string; sigungu: string; lawdCd: string }[];
          apartments?: { name: string; aptSeq: string | null; dong: string | null }[];
        };
        if (ac.signal.aborted) return;
        const regions: AreaPick[] = [];
        for (const r of json.regions ?? []) {
          if (r.lawdCd && !regions.some((x) => x.code === r.lawdCd)) regions.push({ kind: 'REGION', code: r.lawdCd, label: r.sigungu || r.name });
        }
        const apts: AreaPick[] = (json.apartments ?? []).filter((a) => !!a.aptSeq).map((a) => ({ kind: 'APT', code: a.aptSeq as string, label: a.dong ? `${a.name} (${a.dong})` : a.name }));
        setItems([...regions.slice(0, 4), ...apts.slice(0, 6)]);
      } catch {
        if (!ac.signal.aborted) setItems([]);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => () => acRef.current?.abort(), []);

  return (
    <div className={s.field}>
      <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="지역(구·동) 또는 단지명 검색" aria-label="선호 지역·단지 검색" autoComplete="off" />
      {q.trim().length >= 2 ? (
        <ul className={s.list} style={{ gap: 0 }}>
          {busy ? <li className={s.muted}>검색 중</li> : null}
          {!busy && items.length === 0 ? <li className={s.muted}>검색 결과가 없습니다.</li> : null}
          {items.map((it) => (
            <li key={`${it.kind}-${it.code}`}>
              <button
                type="button"
                className={s.linkBtn}
                onClick={() => {
                  onPick(it);
                  setQ('');
                  setItems([]);
                }}
              >
                {it.kind === 'REGION' ? <MapPin size={14} aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}
                {it.kind === 'REGION' ? `${it.label} 전체` : it.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function PreferenceForm({ customerId, initial, onSaved, onCancel }: { customerId: string; initial?: PrefW | null; onSaved: (p: PrefW) => void; onCancel?: () => void }) {
  const editing = !!initial;
  const [label, setLabel] = useState(initial?.label ?? '기본');
  const [dealTypes, setDealTypes] = useState<DealType[]>((initial?.dealTypes as DealType[]) ?? []);
  const [budgetMin, setBudgetMin] = useState(initial?.budgetMinManwon != null ? String(initial.budgetMinManwon) : '');
  const [budgetMax, setBudgetMax] = useState(initial?.budgetMaxManwon != null ? String(initial.budgetMaxManwon) : '');
  const [tolerance, setTolerance] = useState<number>(initial?.budgetTolerancePct ?? 0);
  const [rentMax, setRentMax] = useState(initial?.monthlyRentMaxManwon != null ? String(initial.monthlyRentMaxManwon) : '');
  const [lawdCds, setLawdCds] = useState<string[]>(initial?.lawdCds ?? []);
  const [aptSeqs, setAptSeqs] = useState<string[]>(initial?.aptSeqs ?? []);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [areaMin, setAreaMin] = useState(initial?.areaMinM2 != null ? String(initial.areaMinM2) : '');
  const [areaMax, setAreaMax] = useState(initial?.areaMaxM2 != null ? String(initial.areaMaxM2) : '');
  const [moveIn, setMoveIn] = useState(toDateInput(initial?.moveInTargetAt));
  const [commuteLabel, setCommuteLabel] = useState(initial?.commuteLabel ?? '');
  const [preferNewBuild, setPreferNewBuild] = useState(triToStr(initial?.preferNewBuild));
  const [parkingRequired, setParkingRequired] = useState(triToStr(initial?.parkingRequired));
  const [petRequired, setPetRequired] = useState(triToStr(initial?.petRequired));
  const [floorPref, setFloorPref] = useState<string>(initial?.floorPreference ?? '');
  const [mustHave, setMustHave] = useState<MustHaveKey[]>((initial?.mustHaveKeys as MustHaveKey[]) ?? []);
  const [special, setSpecial] = useState(initial?.specialConditions ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const saver = useSaver<PreferenceRow>();

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const pick = (p: AreaPick) => {
    setLabels((m) => ({ ...m, [p.code]: p.label }));
    if (p.kind === 'REGION') setLawdCds((l) => (l.includes(p.code) ? l : [...l, p.code]));
    else setAptSeqs((l) => (l.includes(p.code) ? l : [...l, p.code]));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (dealTypes.length === 0) {
      setLocalError('거래유형을 하나 이상 선택해 주세요.');
      return;
    }
    const body: Record<string, unknown> = {
      label: label.trim() || '기본',
      dealTypes,
      budgetMinManwon: parseIntInput(budgetMin),
      budgetMaxManwon: parseIntInput(budgetMax),
      budgetTolerancePct: tolerance,
      monthlyRentMaxManwon: dealTypes.includes('MONTHLY') ? parseIntInput(rentMax) : null,
      lawdCds,
      aptSeqs,
      areaMinM2: parseNumInput(areaMin),
      areaMaxM2: parseNumInput(areaMax),
      moveInTargetAt: dateInputToIso(moveIn),
      commuteLabel: commuteLabel.trim() || null,
      // 좌표·학교는 이 화면에서 편집하지 않는다 — 기존 값 유지
      commuteLat: initial?.commuteLat ?? null,
      commuteLng: initial?.commuteLng ?? null,
      schoolIds: (initial?.schoolIds ?? []).map(String),
      preferNewBuild: strToTri(preferNewBuild),
      parkingRequired: strToTri(parkingRequired),
      floorPreference: floorPref || null,
      petRequired: strToTri(petRequired),
      mustHaveKeys: mustHave,
      specialConditions: special.trim() || null,
    };
    void saver.run(
      editing ? `/api/pro/customers/${encodeURIComponent(customerId)}/preferences/${encodeURIComponent(initial!.id)}` : `/api/pro/customers/${encodeURIComponent(customerId)}/preferences`,
      editing ? 'PUT' : 'POST',
      body,
      onSaved
    );
  };

  const hint = (v: string) => {
    const n = parseIntInput(v);
    return typeof n === 'number' ? <span className={s.help}>= {formatManwon(n)}원</span> : null;
  };

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <div className={s.field}>
        <label className={s.label} htmlFor={`pf-label-${initial?.id ?? 'new'}`}>
          조건 이름
        </label>
        <input id={`pf-label-${initial?.id ?? 'new'}`} className={s.input} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={TEXT_LIMITS.label} />
      </div>

      <div className={s.field}>
        <span className={s.label}>
          거래유형<span className={s.required}>*</span>
        </span>
        <div className={s.chips} role="group" aria-label="거래유형">
          {DEAL_TYPES.map((d) => (
            <button key={d} type="button" aria-pressed={dealTypes.includes(d)} className={`${s.chip} ${dealTypes.includes(d) ? s.chipActive : ''}`} onClick={() => setDealTypes((l) => toggle(l, d))}>
              {DEAL_TYPE_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-bmin">
            최소 예산(만원)
          </label>
          <input id="pf-bmin" className={s.input} inputMode="numeric" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} />
          {hint(budgetMin)}
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-bmax">
            최대 예산(만원)
          </label>
          <input id="pf-bmax" className={s.input} inputMode="numeric" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} />
          {hint(budgetMax)}
        </div>
      </div>
      <p className={s.help}>매매는 매매가, 전세·월세는 보증금 기준으로 비교합니다.</p>
      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-tol">
            예산 허용 폭
          </label>
          <select id="pf-tol" className={s.select} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))}>
            {Array.from({ length: BUDGET_TOLERANCE_MAX_PCT + 1 }, (_, i) => i).map((p) => (
              <option key={p} value={p}>
                {p === 0 ? '없음' : `${p}%`}
              </option>
            ))}
          </select>
        </div>
        {dealTypes.includes('MONTHLY') ? (
          <div className={s.field}>
            <label className={s.label} htmlFor="pf-rent">
              월세 상한(만원)
            </label>
            <input id="pf-rent" className={s.input} inputMode="numeric" value={rentMax} onChange={(e) => setRentMax(e.target.value)} />
          </div>
        ) : null}
      </div>

      <div className={s.field}>
        <span className={s.label}>선호 지역·단지</span>
        {lawdCds.length || aptSeqs.length ? (
          <div className={s.chips}>
            {lawdCds.map((c) => (
              <button key={`r-${c}`} type="button" className={`${s.chip} ${s.chipActive}`} onClick={() => setLawdCds((l) => l.filter((x) => x !== c))} aria-label={`${labels[c] ?? `지역 ${c}`} 삭제`}>
                <MapPin size={14} aria-hidden="true" /> {labels[c] ?? `지역 ${c}`} <X size={14} aria-hidden="true" />
              </button>
            ))}
            {aptSeqs.map((c) => (
              <button key={`a-${c}`} type="button" className={`${s.chip} ${s.chipActive}`} onClick={() => setAptSeqs((l) => l.filter((x) => x !== c))} aria-label={`${labels[c] ?? `단지 ${c}`} 삭제`}>
                <Building2 size={14} aria-hidden="true" /> {labels[c] ?? `단지 ${c}`} <X size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className={s.help}>지정하지 않으면 지역 조건 없이 비교합니다.</p>
        )}
        <AreaSearch onPick={pick} />
      </div>

      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-amin">
            최소 전용(㎡)
          </label>
          <input id="pf-amin" className={s.input} inputMode="decimal" value={areaMin} onChange={(e) => setAreaMin(e.target.value)} />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-amax">
            최대 전용(㎡)
          </label>
          <input id="pf-amax" className={s.input} inputMode="decimal" value={areaMax} onChange={(e) => setAreaMax(e.target.value)} />
        </div>
      </div>

      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-movein">
            희망 입주일
          </label>
          <input id="pf-movein" type="date" className={s.input} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-floor">
            선호 층
          </label>
          <select id="pf-floor" className={s.select} value={floorPref} onChange={(e) => setFloorPref(e.target.value)}>
            <option value="">상관없음</option>
            {FLOOR_BANDS.map((b) => (
              <option key={b} value={b}>
                {FLOOR_BAND_LABELS[b]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={s.row2}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-parking">
            주차
          </label>
          <select id="pf-parking" className={s.select} value={parkingRequired} onChange={(e) => setParkingRequired(e.target.value)}>
            <option value="">상관없음</option>
            <option value="true">필요</option>
            <option value="false">필요 없음</option>
          </select>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pf-pet">
            반려동물
          </label>
          <select id="pf-pet" className={s.select} value={petRequired} onChange={(e) => setPetRequired(e.target.value)}>
            <option value="">상관없음</option>
            <option value="true">함께 거주</option>
            <option value="false">없음</option>
          </select>
        </div>
      </div>
      <div className={s.field}>
        <label className={s.label} htmlFor="pf-new">
          신축 선호
        </label>
        <select id="pf-new" className={s.select} value={preferNewBuild} onChange={(e) => setPreferNewBuild(e.target.value)}>
          <option value="">상관없음</option>
          <option value="true">선호</option>
          <option value="false">선호하지 않음</option>
        </select>
      </div>

      <div className={s.field}>
        <span className={s.label}>반드시 맞아야 하는 조건</span>
        <div className={s.chips} role="group" aria-label="필수 조건">
          {MUST_HAVE_KEYS.map((k) => (
            <button key={k} type="button" aria-pressed={mustHave.includes(k)} className={`${s.chip} ${mustHave.includes(k) ? s.chipActive : ''}`} onClick={() => setMustHave((l) => toggle(l, k))}>
              {MUST_HAVE_LABELS[k]}
            </button>
          ))}
        </div>
        <p className={s.help}>필수로 지정한 조건이 맞지 않는 매물은 결과에서 &quot;조건 밖&quot;으로 분리됩니다.</p>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="pf-commute">
          통근지 메모
        </label>
        <input id="pf-commute" className={s.input} value={commuteLabel} onChange={(e) => setCommuteLabel(e.target.value)} maxLength={40} placeholder="예: 센텀시티역" />
        <p className={s.help}>통근 거리 비교는 좌표가 있어야 합니다. 이 화면에서는 이름만 기록되며, 거리 항목은 &quot;확인 필요&quot;로 표시됩니다.</p>
      </div>

      <div className={s.field}>
        <label className={s.label} htmlFor="pf-special">
          기타 조건 메모
        </label>
        <input id="pf-special" className={s.input} value={special} onChange={(e) => setSpecial(e.target.value)} maxLength={TEXT_LIMITS.shortNote} />
        <p className={s.help}>기타 메모는 자동 매칭 계산에 쓰이지 않습니다.</p>
      </div>

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
          {saver.busy ? '저장 중' : editing ? '조건 저장' : '조건 추가'}
        </button>
      </div>
    </form>
  );
}
