'use client';

// REALTOR_PRO_MVP_V1 — 고객 등록. 등록 후 상세에서 조건 세트·팔로업을 추가한다.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import CustomerForm from '@/components/pro/CustomerForm';
import { LoadingState, ProErrorState, ReadOnlyBanner, useProMe } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

export default function ProCustomerNewPage() {
  const router = useRouter();
  const me = useProMe();

  if (me.loading && !me.data) return <LoadingState />;
  if (me.failure) return <ProErrorState failure={me.failure} onRetry={me.reload} />;
  if (me.data && me.data.state !== 'VERIFIED' && me.data.state !== 'SUSPENDED') {
    return <ProErrorState failure={{ ok: false, status: 403, code: 'NOT_VERIFIED_REALTOR', error: '' }} />;
  }

  return (
    <div className={s.page}>
      <Link href="/pro/customers" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        고객 목록
      </Link>
      <h1 className={s.pageTitle}>고객 등록</h1>
      {me.data?.state === 'SUSPENDED' ? <ReadOnlyBanner /> : <CustomerForm onSaved={(c) => router.push(`/pro/customers/${encodeURIComponent(c.id)}`)} />}
    </div>
  );
}
