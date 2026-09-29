'use client';

// REALTOR_PRO_MVP_V1 — 매물 등록/수정 폼. 가격은 만원 정수, 날짜는 ISO. 평형 계산 없음(전용㎡ 정확값만).
// 출입 비밀번호·키박스·열쇠 위치를 적는 입력칸은 없다. 자유 텍스트에는 경고 문구를 붙이고, 서버가 패턴을 감지하면 확인을 받는다.

import { useCallback, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import {
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  FLOOR_BANDS,
  FLOOR_BAND_LABELS,
  LISTING_SOURCES,
  LISTING_SOURCE_LABELS,
  REPAIR_STATUSES,
  REPAIR_STATUS_LABELS,
  SENSITIVE_WARNING,
  TENANT_STATUSES,
  TENANT_STATUS_LABELS,
  TEXT_LIMITS,
  VIEWING_METHODS,
  VIEWING_METHOD_LABELS,
  type DealType,
} from '@/lib/pro/rules';
import type { ListingDto } from '@/lib/pro/service-core';
import type { PublicAptInfo } from '@/lib/pro/types';
import type { Wire } from './api';
import ApartmentPicker, { type AptSelection } from './ApartmentPicker';
import { dateInputToIso, formatM2, formatManwon, parseIntInput, parseNumInput, toDateInput } from './format';
import { SaverFeedback, useSaver } from './useSaver';
import s from './pro.module.css';

type ListingW = Wire<ListingDto>;

const triToStr = (v: boolean | null | undefined) => (v === true ? 'true' : v === false ? 'false' : '');
const strToTri = (v: string) => (v === 'true' ? true : v === 'false' ? false : null);

function SensitiveNote() {
  return (
    <p className={s.warnNote}>
      <TriangleAlert size={14} aria-hidden="true" />
      <span>{SENSITIVE_WARNING}</span>
    </p>
  );
}

function PriceHint({ v }: { v: string }) {
  const n = parseIntInput(v);
  if (typeof n !== 'number') return null;
  return <span className={s.help}>= {formatManwon(n)}원</span>;
}

export default function ListingForm({ initial, onSaved, submitLabel }: { initial?: ListingW | null; onSaved: (l: ListingW) => void; submitLabel?: string }) {
  const editing = !!initial;
  const [apt, setApt] = useState<AptSelection>({
    aptSeq: initial?.aptSeq ?? null,
    lawdCd: initial?.lawdCd ?? null,
    umdName: initial?.umdName ?? null,
    aptNameSnapshot: initial?.aptNameSnapshot ?? '',
  });
  const [prefill, setPrefill] = useState<Wire<PublicAptInfo> | null>(null);
  const [prefillState, setPrefillState] = useState<'idle' | 'loading' | 'done' | 'failed'>('idle');
  const [area, setArea] = useState(initial?.exclusiveAreaM2 != null ? String(initial.exclusiveAreaM2) : '');
  const [dealType, setDealType] = useState<DealType>((initial?.dealType as DealType) ?? 'SALE');
  const [asking, setAsking] = useState(initial?.askingPriceManwon != null ? String(initial.askingPriceManwon) : '');
  const [deposit, setDeposit] = useState(initial?.depositManwon != null ? String(initial.depositManwon) : '');
  const [monthly, setMonthly] = useState(initial?.monthlyRentManwon != null ? String(initial.monthlyRentManwon) : '');
  const [floor, setFloor] = useState(initial?.floor != null ? String(initial.floor) : '');
  const [floorBand, setFloorBand] = useState<string>(initial?.floorBand ?? '');
  const [tenantStatus, setTenantStatus] = useState<string>(initial?.tenantStatus ?? '');
  const [leaseEnd, setLeaseEnd] = useState(toDateInput(initial?.tenantLeaseEndsAt));
  const [moveIn, setMoveIn] = useState(toDateInput(initial?.moveInAvailableAt));
  const [moveInNegotiable, setMoveInNegotiable] = useState(initial?.moveInNegotiable ?? false);
  const [repairStatus, setRepairStatus] = useState<string>(initial?.repairStatus ?? '');
  const [repairNote, setRepairNote] = useState(initial?.repairNote ?? '');
  const [parkingAvailable, setParkingAvailable] = useState(triToStr(initial?.parkingAvailable));
  const [parkingNote, setParkingNote] = useState(initial?.parkingNote ?? '');
  const [petAllowed, setPetAllowed] = useState(triToStr(initial?.petAllowed));
  const [viewingMethod, setViewingMethod] = useState<string>(initial?.viewingMethod ?? 'CONTACT_REALTOR');
  const [viewingNote, setViewingNote] = useState(initial?.viewingNote ?? '');
  const [source, setSource] = useState<string>(initial?.source ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [ownerName, setOwnerName] = useState('');
  const [clearOwnerName, setClearOwnerName] = useState(false);
  const [ownerPhone, setOwnerPhone] = useState('');
  const [clearOwnerPhone, setClearOwnerPhone] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const saver = useSaver<ListingDto>();

  const handlePrefill = useCallback((info: Wire<PublicAptInfo> | null, st: 'idle' | 'loading' | 'done' | 'failed') => {
    setPrefill(info);
    setPrefillState(st);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!apt.aptNameSnapshot.trim()) {
      setLocalError('단지명을 입력하거나 검색 결과에서 선택해 주세요.');
      return;
    }
    const body: Record<string, unknown> = {
      aptSeq: apt.aptSeq,
      lawdCd: apt.lawdCd,
      umdName: apt.umdName,
      aptNameSnapshot: apt.aptNameSnapshot.trim(),
      exclusiveAreaM2: parseNumInput(area),
      dealType,
      askingPriceManwon: dealType === 'SALE' ? parseIntInput(asking) : null,
      depositManwon: dealType === 'SALE' ? null : parseIntInput(deposit),
      monthlyRentManwon: dealType === 'MONTHLY' ? parseIntInput(monthly) : null,
      floor: parseIntInput(floor),
      floorBand: floorBand || null,
      tenantStatus: tenantStatus || null,
      tenantLeaseEndsAt: dateInputToIso(leaseEnd),
      moveInAvailableAt: dateInputToIso(moveIn),
      moveInNegotiable,
      repairStatus: repairStatus || null,
      repairNote: repairNote.trim() || null,
      parkingAvailable: strToTri(parkingAvailable),
      parkingNote: parkingNote.trim() || null,
      petAllowed: strToTri(petAllowed),
      viewingMethod,
      viewingNote: viewingNote.trim() || null,
      source: source || null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      memo: memo.trim() || null,
    };
    // 이름·연락처는 응답에 없으므로(연락처 보기로만 열람) 수정 시 입력했거나 삭제를 고른 경우에만 보낸다
    if (ownerName.trim()) body.ownerName = ownerName.trim();
    else if (!editing || clearOwnerName) body.ownerName = null;
    if (ownerPhone.trim()) body.ownerPhone = ownerPhone.trim();
    else if (!editing) body.ownerPhone = null;
    else if (clearOwnerPhone) body.ownerPhone = null;
    void saver.run(editing ? `/api/pro/listings/${initial!.id}` : '/api/pro/listings', editing ? 'PATCH' : 'POST', body, (l) => {
      setOwnerPhone('');
      setClearOwnerPhone(false);
      onSaved(l);
    });
  };

  const areaOptions = prefill?.areaOptionsM2 ?? [];

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <fieldset className={s.fieldset}>
        <legend className={s.legend}>단지·면적</legend>
        <ApartmentPicker value={apt} onChange={setApt} onPrefill={handlePrefill} />
        {apt.aptSeq ? (
          prefillState === 'loading' ? (
            <p className={s.muted}>단지 정보를 불러오는 중입니다</p>
          ) : prefillState === 'failed' ? (
            <p className={s.muted}>단지 정보를 지금 불러올 수 없습니다. 면적은 직접 입력해 주세요.</p>
          ) : prefill ? (
            <p className={s.muted}>
              {[prefill.umdName, prefill.buildYear ? `${prefill.buildYear}년 준공` : null, prefill.totalHouseholds ? `${prefill.totalHouseholds.toLocaleString('ko-KR')}세대` : null]
                .filter(Boolean)
                .join(' · ') || '공공 단지 정보가 비어 있습니다'}
            </p>
          ) : prefillState === 'done' ? (
            <p className={s.muted}>공공 단지 정보가 없습니다.</p>
          ) : null
        ) : null}
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-area">
            전용면적(㎡)
          </label>
          {areaOptions.length ? (
            <div className={s.chips} role="group" aria-label="실거래 전용면적">
              {areaOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`${s.chip} ${Number(area) === m ? s.chipActive : ''}`}
                  aria-pressed={Number(area) === m}
                  onClick={() => setArea(String(m))}
                >
                  {formatM2(m)}
                </button>
              ))}
            </div>
          ) : null}
          <input id="pro-area" className={s.input} inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="예: 84.97" />
          <p className={s.help}>{areaOptions.length ? '실거래에 기록된 전용면적 중 선택하거나 직접 입력하세요.' : '전용면적을 ㎡ 단위로 입력하세요.'}</p>
        </div>
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>거래·가격</legend>
        <div className={s.chips} role="radiogroup" aria-label="거래유형">
          {DEAL_TYPES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={dealType === d} className={`${s.chip} ${dealType === d ? s.chipActive : ''}`} onClick={() => setDealType(d)}>
              {DEAL_TYPE_LABELS[d]}
            </button>
          ))}
        </div>
        {dealType === 'SALE' ? (
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-asking">
              매매가(만원)<span className={s.required}>*</span>
            </label>
            <input id="pro-asking" className={s.input} inputMode="numeric" value={asking} onChange={(e) => setAsking(e.target.value)} placeholder="예: 89000" />
            <PriceHint v={asking} />
          </div>
        ) : (
          <div className={dealType === 'MONTHLY' ? s.row2 : undefined}>
            <div className={s.field}>
              <label className={s.label} htmlFor="pro-deposit">
                보증금(만원)<span className={s.required}>*</span>
              </label>
              <input id="pro-deposit" className={s.input} inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="예: 42000" />
              <PriceHint v={deposit} />
            </div>
            {dealType === 'MONTHLY' ? (
              <div className={s.field}>
                <label className={s.label} htmlFor="pro-monthly">
                  월세(만원)<span className={s.required}>*</span>
                </label>
                <input id="pro-monthly" className={s.input} inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="예: 120" />
                <PriceHint v={monthly} />
              </div>
            ) : null}
          </div>
        )}
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>층·입주</legend>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-floor">
              층
            </label>
            <input id="pro-floor" className={s.input} inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="예: 12" />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-floorband">
              층 구간
            </label>
            <select id="pro-floorband" className={s.select} value={floorBand} onChange={(e) => setFloorBand(e.target.value)}>
              <option value="">선택 안 함</option>
              {FLOOR_BANDS.map((b) => (
                <option key={b} value={b}>
                  {FLOOR_BAND_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className={s.help}>고객 브리핑에는 정확한 층 대신 저·중·고층 구간만 표시됩니다.</p>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-tenant">
              거주 상태
            </label>
            <select id="pro-tenant" className={s.select} value={tenantStatus} onChange={(e) => setTenantStatus(e.target.value)}>
              <option value="">선택 안 함</option>
              {TENANT_STATUSES.map((t) => (
                <option key={t} value={t}>
                  {TENANT_STATUS_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-lease-end">
              임대 만기일
            </label>
            <input id="pro-lease-end" type="date" className={s.input} value={leaseEnd} onChange={(e) => setLeaseEnd(e.target.value)} />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-movein">
            입주 가능일
          </label>
          <input id="pro-movein" type="date" className={s.input} value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
        </div>
        <label className={s.checkRow}>
          <input type="checkbox" checked={moveInNegotiable} onChange={(e) => setMoveInNegotiable(e.target.checked)} />
          <span>입주일 협의 가능</span>
        </label>
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>상태·옵션</legend>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-repair">
              수리 상태
            </label>
            <select id="pro-repair" className={s.select} value={repairStatus} onChange={(e) => setRepairStatus(e.target.value)}>
              <option value="">선택 안 함</option>
              {REPAIR_STATUSES.map((r) => (
                <option key={r} value={r}>
                  {REPAIR_STATUS_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-pet">
              반려동물
            </label>
            <select id="pro-pet" className={s.select} value={petAllowed} onChange={(e) => setPetAllowed(e.target.value)}>
              <option value="">확인 필요</option>
              <option value="true">가능</option>
              <option value="false">불가</option>
            </select>
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-repair-note">
            수리 메모
          </label>
          <input id="pro-repair-note" className={s.input} value={repairNote} onChange={(e) => setRepairNote(e.target.value)} maxLength={TEXT_LIMITS.shortNote} />
        </div>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-parking">
              주차
            </label>
            <select id="pro-parking" className={s.select} value={parkingAvailable} onChange={(e) => setParkingAvailable(e.target.value)}>
              <option value="">확인 필요</option>
              <option value="true">가능</option>
              <option value="false">불가</option>
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-parking-note">
              주차 메모
            </label>
            <input id="pro-parking-note" className={s.input} value={parkingNote} onChange={(e) => setParkingNote(e.target.value)} maxLength={TEXT_LIMITS.shortNote} />
          </div>
        </div>
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>방문·출처</legend>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-viewing">
            방문 방법
          </label>
          <select id="pro-viewing" className={s.select} value={viewingMethod} onChange={(e) => setViewingMethod(e.target.value)}>
            {VIEWING_METHODS.map((v) => (
              <option key={v} value={v}>
                {VIEWING_METHOD_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-viewing-note">
            방문 안내 메모
          </label>
          <input id="pro-viewing-note" className={s.input} value={viewingNote} onChange={(e) => setViewingNote(e.target.value)} maxLength={TEXT_LIMITS.shortNote} placeholder="예: 평일 저녁 방문 가능" />
          <SensitiveNote />
        </div>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-source">
              매물 출처
            </label>
            <select id="pro-source" className={s.select} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">선택 안 함</option>
              {LISTING_SOURCES.map((v) => (
                <option key={v} value={v}>
                  {LISTING_SOURCE_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-tags">
              태그(쉼표 구분)
            </label>
            <input id="pro-tags" className={s.input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="남향, 역세권" />
          </div>
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pro-memo">
            메모(비공개)
          </label>
          <textarea id="pro-memo" className={s.textarea} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={TEXT_LIMITS.memo} />
          <SensitiveNote />
        </div>
      </fieldset>

      <fieldset className={s.fieldset}>
        <legend className={s.legend}>소유자(비공개)</legend>
        <div className={s.row2}>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-owner-name">
              소유자 이름
            </label>
            <input id="pro-owner-name" className={s.input} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={TEXT_LIMITS.name} autoComplete="off" placeholder={editing && initial?.hasOwnerName ? '변경할 때만 입력' : undefined} />
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="pro-owner-phone">
              소유자 연락처
            </label>
            <input
              id="pro-owner-phone"
              className={s.input}
              type="tel"
              inputMode="tel"
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              maxLength={TEXT_LIMITS.phone}
              autoComplete="off"
              placeholder={editing && initial?.hasOwnerPhone ? '변경할 때만 입력' : '010-0000-0000'}
            />
          </div>
        </div>
        <p className={s.help}>연락처는 암호화되어 저장됩니다. 고객 브리핑에는 소유자 정보가 표시되지 않습니다.</p>
        {editing && initial?.hasOwnerName ? (
          <label className={s.checkRow}>
            <input type="checkbox" checked={clearOwnerName} onChange={(e) => setClearOwnerName(e.target.checked)} disabled={!!ownerName.trim()} />
            <span>저장된 소유자 이름 삭제</span>
          </label>
        ) : null}
        {editing && initial?.hasOwnerPhone ? (
          <label className={s.checkRow}>
            <input type="checkbox" checked={clearOwnerPhone} onChange={(e) => setClearOwnerPhone(e.target.checked)} disabled={!!ownerPhone.trim()} />
            <span>저장된 소유자 연락처 삭제</span>
          </label>
        ) : null}
      </fieldset>

      {localError ? (
        <div className={s.errorBox} role="alert">
          {localError}
        </div>
      ) : null}
      <SaverFeedback saver={saver} />
      <div className={s.stickyActions}>
        <button type="submit" className={s.btnPrimary} disabled={saver.busy}>
          {saver.busy ? '저장 중' : submitLabel ?? (editing ? '수정 저장' : '매물 등록')}
        </button>
      </div>
    </form>
  );
}
