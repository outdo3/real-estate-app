'use client';

// REALTOR_PRO_MVP_V1 — 매물 등록.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import ListingForm from '@/components/pro/ListingForm';
import { LoadingState, ProErrorState, ReadOnlyBanner, useProMe } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

export default function ProListingNewPage() {
  const router = useRouter();
  const me = useProMe();

  if (me.loading && !me.data) return <LoadingState />;
  if (me.failure) return <ProErrorState failure={me.failure} onRetry={me.reload} />;
  if (me.data && me.data.state !== 'VERIFIED' && me.data.state !== 'SUSPENDED') {
    return <ProErrorState failure={{ ok: false, status: 403, code: 'NOT_VERIFIED_REALTOR', error: '' }} />;
  }

  return (
    <div className={s.page}>
      <Link href="/pro/listings" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        매물 목록
      </Link>
      <h1 className={s.pageTitle}>매물 등록</h1>
      {me.data?.state === 'SUSPENDED' ? (
        <ReadOnlyBanner />
      ) : (
        <ListingForm onSaved={(l) => router.push(`/pro/listings/${encodeURIComponent(l.id)}`)} />
      )}
    </div>
  );
}
