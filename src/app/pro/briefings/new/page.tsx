'use client';

// REALTOR_PRO_MVP_V1 — 브리핑 만들기. 생성 응답의 token으로 만든 공유 링크는 이 화면에서 한 번만 보인다(서버에는 해시만).
// 카카오 API·자동 발송 없음 — 링크 복사만.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { ArrowLeft, Copy, TriangleAlert } from 'lucide-react';
import type { BriefingListItem } from '@/lib/pro/briefing-service';
import type { CustomerDto, ListingDto } from '@/lib/pro/service-core';
import type { BriefingSnapshot } from '@/lib/pro/types';
import type { Wire } from '@/components/pro/api';
import BriefingView from '@/components/pro/BriefingView';
import { formatDealPrice } from '@/components/pro/format';
import { LoadingState, ProErrorState, ReadOnlyBanner, useProMe, useProQuery } from '@/components/pro/ProStateGate';
import { SaverFeedback, useSaver } from '@/components/pro/useSaver';
import s from '@/components/pro/pro.module.css';

type Created = { briefing: BriefingListItem; token: string; snapshot: BriefingSnapshot };

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('ok');
    } catch {
      inputRef.current?.select();
      setCopied('fail');
    }
  };
  return (
    <section className={s.card} aria-labelledby="share-title">
      <h2 id="share-title" className={s.sectionTitle}>
        공유 링크
      </h2>
      <p className={s.warnNote} role="alert">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>이 링크는 지금만 표시됩니다. 화면을 떠나면 다시 볼 수 없으니 지금 복사해 고객에게 보내세요.</span>
      </p>
      <div className={s.searchRow} style={{ marginTop: 10 }}>
        <input ref={inputRef} className={s.input} value={url} readOnly aria-label="브리핑 공유 링크" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={s.btnPrimary} onClick={copy}>
          <Copy size={16} aria-hidden="true" />
          복사
        </button>
      </div>
      {copied === 'ok' ? <p className={s.help}>복사했습니다.</p> : null}
      {copied === 'fail' ? <p className={s.help}>자동 복사가 지원되지 않습니다. 선택된 링크를 직접 복사해 주세요.</p> : null}
    </section>
  );
}

function NewBriefingInner() {
  const sp = useSearchParams();
  const initialListing = sp?.get('listingId') ?? '';
  const initialCustomer = sp?.get('customerId') ?? '';
  const me = useProMe();
  const listings = useProQuery<{ items: ListingDto[] }>('/api/pro/listings');
  const customers = useProQuery<{ items: CustomerDto[] }>('/api/pro/customers');
  const [listingId, setListingId] = useState(initialListing);
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [days, setDays] = useState<number | null>(null);
  const [created, setCreated] = useState<{ url: string; snapshot: Wire<BriefingSnapshot> } | null>(null);
  const saver = useSaver<Created>();

  if (me.loading && !me.data) return <LoadingState />;
  if (me.failure) return <ProErrorState failure={me.failure} onRetry={me.reload} />;
  if (!me.data) return null;
  if (me.data.state !== 'VERIFIED' && me.data.state !== 'SUSPENDED') return <ProErrorState failure={{ ok: false, status: 403, code: 'NOT_VERIFIED_REALTOR', error: '' }} />;
  if (me.data.state === 'SUSPENDED') return <ReadOnlyBanner />;

  const exp = me.data.capabilities.briefingExpiryDays;
  const expiry = days ?? exp.default;
  const options = Array.from({ length: exp.max - exp.min + 1 }, (_, i) => exp.min + i);

  if (created) {
    return (
      <div className={s.page}>
        <h1 className={s.pageTitle}>브리핑을 만들었습니다</h1>
        <ShareLink url={created.url} />
        <section>
          <h2 className={s.sectionTitle}>고객에게 보이는 화면</h2>
          <BriefingView snapshot={created.snapshot} />
        </section>
        <div className={s.btnRow}>
          <Link href="/pro/briefings" className={s.btn}>
            브리핑 목록
          </Link>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!listingId) return;
    void saver.run('/api/pro/briefings', 'POST', { listingId, customerId: customerId || null, expiresInDays: expiry }, (d) => {
      setCreated({ url: `${window.location.origin}/b/${d.token}`, snapshot: d.snapshot });
    });
  };

  const listingItems = listings.data?.items ?? [];
  const customerItems = customers.data?.items ?? [];
  const listingKnown = !listingId || listingItems.some((l) => l.id === listingId);
  const customerKnown = !customerId || customerItems.some((c) => c.id === customerId);

  return (
    <div className={s.page}>
      <Link href="/pro/briefings" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        브리핑 목록
      </Link>
      <h1 className={s.pageTitle}>브리핑 만들기</h1>
      <p className={s.pageSub}>고객에게는 단지 기본 정보, 매물 가격·면적·층 구간, 공공 실거래, 조건 비교, 담당 중개사 정보만 보입니다. 소유자 정보·동호수·비공개 메모는 포함되지 않습니다.</p>
      <form className={s.form} onSubmit={submit} noValidate>
        <fieldset className={s.fieldset}>
          <legend className={s.legend}>대상</legend>
          <div className={s.field}>
            <label className={s.label} htmlFor="bf-listing">
              매물<span className={s.required}>*</span>
            </label>
            {listings.failure ? <ProErrorState failure={listings.failure} onRetry={listings.reload} /> : null}
            <select id="bf-listing" className={s.select} value={listingId} onChange={(e) => setListingId(e.target.value)}>
              <option value="">{listings.loading ? '불러오는 중' : '매물 선택'}</option>
              {!listingKnown ? <option value={listingId}>선택한 매물</option> : null}
              {listingItems.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.aptNameSnapshot} · {formatDealPrice(l)}
                </option>
              ))}
            </select>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="bf-customer">
              고객(선택)
            </label>
            <select id="bf-customer" className={s.select} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">고객 없이 만들기</option>
              {!customerKnown ? <option value={customerId}>선택한 고객</option> : null}
              {customerItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className={s.help}>고객을 고르면 그 고객의 조건과 비교한 결과가 함께 담깁니다. 브리핑에는 고객 이름 대신 이니셜만 표시되고 예산 금액은 싣지 않습니다.</p>
          </div>
          <div className={s.field}>
            <label className={s.label} htmlFor="bf-exp">
              유효기간
            </label>
            <select id="bf-exp" className={s.select} value={expiry} onChange={(e) => setDays(Number(e.target.value))} disabled={options.length <= 1}>
              {options.map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </select>
            {options.length <= 1 ? <p className={s.help}>현재 플랜의 브리핑 유효기간은 {exp.default}일입니다.</p> : null}
          </div>
        </fieldset>
        <SaverFeedback saver={saver} />
        <button type="submit" className={`${s.btnPrimary} ${s.btnBlock}`} disabled={saver.busy || !listingId}>
          {saver.busy ? '만드는 중' : '브리핑 만들기'}
        </button>
      </form>
    </div>
  );
}

export default function ProBriefingNewPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <NewBriefingInner />
    </Suspense>
  );
}
