'use client';

// REALTOR_PRO_MVP_V1 — 저장된 브리핑 스냅샷 미리보기(중개사 본인). 공유 링크 원문은 다시 보여줄 수 없다.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { BriefingListItem } from '@/lib/pro/briefing-service';
import type { BriefingSnapshot } from '@/lib/pro/types';
import BriefingView from '@/components/pro/BriefingView';
import { formatDateTime } from '@/components/pro/format';
import { LoadingState, ProErrorState, useProQuery } from '@/components/pro/ProStateGate';
import s from '@/components/pro/pro.module.css';

const STATUS_LABEL: Record<string, string> = { ACTIVE: '공유 중', EXPIRED: '만료', REVOKED: '회수됨' };

export default function ProBriefingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { data, failure, loading, reload } = useProQuery<{ item: BriefingListItem; snapshot: BriefingSnapshot | null }>(id ? `/api/pro/briefings/${encodeURIComponent(id)}` : null);

  if (loading && !data) return <LoadingState />;
  if (failure && !data) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;
  const { item, snapshot } = data;

  return (
    <div className={s.page}>
      <Link href="/pro/briefings" className={s.linkBtn}>
        <ArrowLeft size={16} aria-hidden="true" />
        브리핑 목록
      </Link>
      <div>
        <h1 className={s.pageTitle}>{item.title}</h1>
        <p className={s.meta}>
          <span className={`${s.badge} ${item.status === 'ACTIVE' ? s.badgeBrand : ''}`}>{STATUS_LABEL[item.status] ?? item.status}</span>
          <span>만료 {formatDateTime(item.expiresAt)}</span>
          <span>열람 {item.viewCount}회</span>
        </p>
        <p className={s.help}>공유 링크는 만든 직후에만 표시됩니다. 다시 보내야 하면 새 브리핑을 만들어 주세요.</p>
      </div>
      {snapshot ? <BriefingView snapshot={snapshot} /> : <p className={s.empty}>보관 기간이 지나 내용이 삭제된 브리핑입니다.</p>}
    </div>
  );
}
