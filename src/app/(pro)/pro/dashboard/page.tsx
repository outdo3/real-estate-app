'use client';

// REALTOR_PRO_MVP_V1 — "오늘 해야 할 일". 숫자 자랑 대신 행동 목록만. 섹션은 data.sections(플랜)에 있을 때만 보인다.

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { FOLLOWUP_KIND_LABELS, type FollowupKind } from '@/lib/pro/rules';
import { PLAN_LABELS, type DashboardSection } from '@/lib/pro/plan-limits';
import type { DashboardData } from '@/lib/pro/dashboard-service';
import type { ListingDto } from '@/lib/pro/service-core';
import type { Wire } from '@/components/pro/api';
import { FollowupItem } from '@/components/pro/FollowupSection';
import { formatDate, formatDateTime, formatDealPrice, formatM2 } from '@/components/pro/format';
import { LoadingState, ProErrorState, ReadOnlyBanner, useProQuery } from '@/components/pro/ProStateGate';
import { ScoreBadge } from '@/components/pro/MatchResults';
import s from '@/components/pro/pro.module.css';

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className={s.card}>
      <h2 className={s.sectionTitle}>
        {title}
        {count != null ? <span className={s.sectionCount}>{count}건</span> : null}
      </h2>
      {children}
    </section>
  );
}

function ListingRows({ items, extra }: { items: Wire<ListingDto>[]; extra?: (l: Wire<ListingDto>) => React.ReactNode }) {
  return (
    <ul className={s.list} style={{ gap: 0 }}>
      {items.map((l) => (
        <li key={l.id} className={s.rowItem}>
          <div className={s.rowMain}>
            <Link href={`/pro/listings/${encodeURIComponent(l.id)}`} className={s.rowTitle}>
              {l.aptNameSnapshot}
            </Link>
            <div className={s.meta} style={{ marginTop: 2 }}>
              <span>{formatDealPrice(l)}</span>
              {l.exclusiveAreaM2 != null ? <span>전용 {formatM2(l.exclusiveAreaM2)}</span> : null}
              {extra ? extra(l) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ProDashboardPage() {
  const { data, failure, loading, reload } = useProQuery<DashboardData>('/api/pro/dashboard');

  if (loading && !data) return <LoadingState />;
  if (failure && !data) return <ProErrorState failure={failure} onRetry={reload} />;
  if (!data) return null;

  const has = (sec: DashboardSection) => data.sections.includes(sec);
  const readOnly = data.suspended;

  return (
    <div className={s.page}>
      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>오늘 해야 할 일</h1>
          <p className={s.pageSub}>
            활성 매물 {data.counts.activeListings}건 · 고객 {data.counts.customers}명
          </p>
        </div>
        <span className={`${s.badge} ${data.plan === 'PRO' ? s.badgeBrand : ''}`}>{PLAN_LABELS[data.plan]}</span>
      </div>
      {readOnly ? <ReadOnlyBanner /> : null}
      {!readOnly ? (
        <div className={s.btnRow}>
          <Link href="/pro/listings/new" className={s.btn}>
            <Plus size={16} aria-hidden="true" />
            매물 등록
          </Link>
          <Link href="/pro/customers/new" className={s.btn}>
            <Plus size={16} aria-hidden="true" />
            고객 등록
          </Link>
        </div>
      ) : null}

      <div className={s.grid2}>
        {has('FOLLOWUPS_TODAY') ? (
          <Section title="오늘 연락·일정" count={data.followupsToday.length}>
            {data.followupsToday.length ? (
              <ul className={s.list} style={{ gap: 0 }}>
                {data.followupsToday.map((f) => (
                  <FollowupItem key={f.id} f={f} customerName={f.customerName} readOnly={readOnly} onChanged={reload} />
                ))}
              </ul>
            ) : (
              <p className={s.empty}>오늘 예정된 팔로업이 없습니다.</p>
            )}
          </Section>
        ) : null}

        {has('UNHANDLED_CUSTOMERS') ? (
          <Section title="아직 연락 계획이 없는 신규 고객" count={data.unhandledCustomers.length}>
            {data.unhandledCustomers.length ? (
              <ul className={s.list} style={{ gap: 0 }}>
                {data.unhandledCustomers.map((c) => (
                  <li key={c.id} className={s.rowItem}>
                    <div className={s.rowMain}>
                      <Link href={`/pro/customers/${encodeURIComponent(c.id)}`} className={s.rowTitle}>
                        {c.name}
                      </Link>
                      <div className={s.meta} style={{ marginTop: 2 }}>
                        <span>등록 {formatDate(c.createdAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>모든 신규 고객에게 팔로업이 잡혀 있습니다.</p>
            )}
          </Section>
        ) : null}

        {has('LEASE_ENDING') ? (
          <Section title="60일 안에 임대 만기" count={data.leaseEnding.length}>
            {data.leaseEnding.length ? (
              <ListingRows items={data.leaseEnding} extra={(l) => <span>만기 {formatDate(l.tenantLeaseEndsAt)}</span>} />
            ) : (
              <p className={s.empty}>곧 만기되는 임대 매물이 없습니다.</p>
            )}
          </Section>
        ) : null}

        {has('MATCHED_LISTINGS') ? (
          <Section title="새로 맞는 매물" count={data.matchedListings.length}>
            {data.matchedListings.length ? (
              <ul className={s.list} style={{ gap: 0 }}>
                {data.matchedListings.map((m) => (
                  <li key={m.id} className={s.rowItem}>
                    <div className={s.rowMain}>
                      <Link href={`/pro/customers/${encodeURIComponent(m.customerId)}`} className={s.rowTitle}>
                        {m.customerName}
                      </Link>
                      <span className={s.muted}> · </span>
                      <Link href={`/pro/listings/${encodeURIComponent(m.listingId)}`} className={s.rowTitle}>
                        {m.listingName}
                      </Link>
                    </div>
                    <ScoreBadge score={m.score} confidence={m.confidence} passedHard={m.passedHard} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>새로 확인할 매칭이 없습니다.</p>
            )}
          </Section>
        ) : null}

        {has('SCHEDULE') ? (
          <Section title="앞으로 2주 일정" count={data.schedule.length}>
            {data.schedule.length ? (
              <ul className={s.list} style={{ gap: 0 }}>
                {data.schedule.map((f) => (
                  <li key={f.id} className={s.rowItem}>
                    <div className={s.rowMain}>
                      <div className={s.rowTitle}>
                        {FOLLOWUP_KIND_LABELS[f.kind as FollowupKind] ?? f.kind}
                        {f.customerName ? ` · ${f.customerName}` : ''}
                      </div>
                      <div className={s.meta} style={{ marginTop: 2 }}>
                        <span>{formatDateTime(f.dueAt)}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>예정된 방문·계약·입주 일정이 없습니다.</p>
            )}
          </Section>
        ) : null}

        {has('NEW_LISTINGS') ? (
          <Section title="최근 7일 등록 매물" count={data.newListings.length}>
            {data.newListings.length ? <ListingRows items={data.newListings} /> : <p className={s.empty}>최근 등록한 매물이 없습니다.</p>}
          </Section>
        ) : null}

        {has('PRICE_CHANGED') ? (
          <Section title="최근 가격 변경" count={data.priceChanged.length}>
            {data.priceChanged.length ? (
              <ListingRows items={data.priceChanged} extra={(l) => <span>변경 {formatDate(l.priceChangedAt)}</span>} />
            ) : (
              <p className={s.empty}>최근 2주간 가격을 바꾼 매물이 없습니다.</p>
            )}
          </Section>
        ) : null}

        {has('RECENT_BRIEFINGS') ? (
          <Section title="최근 브리핑" count={data.recentBriefings.length}>
            {data.recentBriefings.length ? (
              <ul className={s.list} style={{ gap: 0 }}>
                {data.recentBriefings.map((b) => (
                  <li key={b.id} className={s.rowItem}>
                    <div className={s.rowMain}>
                      <Link href={`/pro/briefings/${encodeURIComponent(b.id)}`} className={s.rowTitle}>
                        {b.title}
                      </Link>
                      <div className={s.meta} style={{ marginTop: 2 }}>
                        <span>{formatDate(b.createdAt)}</span>
                        <span>열람 {b.viewCount}회</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={s.empty}>아직 만든 브리핑이 없습니다.</p>
            )}
          </Section>
        ) : null}
      </div>
      {data.plan === 'FREE' ? <p className={s.help}>Free 플랜에서는 연락·만기·신규 고객 섹션만 표시됩니다.</p> : null}
    </div>
  );
}
