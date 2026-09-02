'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import Button from '@/components/ui/Button';
import ShareAction from '@/components/ShareAction';
import Empty from '@/components/ui/Empty';
import InlineLoading from '@/components/ui/InlineLoading';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';
import { trackEvent } from '@/lib/analytics/trackEvent';
import type { CompareApartment, CompareDifference } from '@/lib/compare-v2/types';
import { fetchCompareApartment } from '@/lib/compare-v2/fetch';
import { buildDifferences, buildTradeoffSummary, buildHeadlineDifferences } from '@/lib/compare-v2/difference';
import { formatHeadlineBullet, scoreDomainSummary } from '@/lib/compare-v2/format';
import { buildCompareUrl, parseCompareUrl, type CompareSlotSeed } from '@/lib/compare-v2/url';
import styles from './CompareV2.module.css';

interface SlotState {
  seed: CompareSlotSeed;
  apartment: CompareApartment | null;
  loading: boolean;
}

// COMPARE_V2_PHASE2 — canonical 2-complex compare, replacing the old name-keyed
// CompareView for the /stats/compare entry (multi-compare's 5-complex chart stays
// on the legacy component, unchanged, per this Phase's explicit 2-complex scope).
// Region selection is no longer required to view an already-identified pair — only
// the "add a complex by search" affordance needs one, and only implicitly via
// ApartmentAutocomplete's own region-free keyword search.
export default function CompareV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<(SlotState | null)[]>([null, null]);
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const { a, b } = parseCompareUrl(searchParams);
    const next: (SlotState | null)[] = [null, null];
    if (a) next[0] = { seed: a, apartment: null, loading: true };
    if (b) next[1] = { seed: b, apartment: null, loading: true };
    if (a || b) setSlots(next);
  }, [searchParams]);

  useEffect(() => {
    slots.forEach((slot, i) => {
      if (!slot || slot.apartment || !slot.loading) return;
      fetchCompareApartment({
        name: slot.seed.name,
        lawdCd: slot.seed.lawdCd,
        dong: slot.seed.dong,
        incomingAptSeq: slot.seed.aptSeq,
      }).then((apartment) => {
        setSlots((prev) => {
          const next = [...prev];
          const cur = next[i];
          if (!cur) return prev;
          next[i] = { ...cur, apartment, loading: false };
          return next;
        });
      });
    });
  }, [slots]);

  useEffect(() => {
    const a = slots[0]?.seed;
    const b = slots[1]?.seed;
    if (!a && !b) return;
    const url = buildCompareUrl(
      a || { name: '', lawdCd: '', dong: '' },
      b
    );
    router.replace(url, { scroll: false });
  }, [slots[0]?.seed.aptSeq, slots[0]?.seed.name, slots[1]?.seed.aptSeq, slots[1]?.seed.name]);

  const addComplex = (result: ApartmentSearchResult) => {
    if (result.type !== 'APARTMENT' || !result.lawdCd || !result.dong) return;
    const emptyIndex = slots.findIndex((s) => s === null);
    if (emptyIndex === -1) return; // 최대 2개 — 안내는 렌더 쪽에서 처리
    const seed: CompareSlotSeed = { name: result.name, lawdCd: result.lawdCd, dong: result.dong, aptSeq: result.aptSeq || undefined };
    if (filledCount === 0) trackEvent('compare_start');
    setSlots((prev) => {
      const next = [...prev];
      next[emptyIndex] = { seed, apartment: null, loading: true };
      return next;
    });
    trackEvent('compare_add', { aptName: result.name });
  };

  const removeSlot = (index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    trackEvent('compare_remove');
  };

  const both = slots[0]?.apartment && slots[1]?.apartment ? ([slots[0]!.apartment!, slots[1]!.apartment!] as const) : null;
  const bothLoading = slots[0]?.loading || slots[1]?.loading;
  const filledCount = slots.filter(Boolean).length;

  const differences = both ? buildDifferences(both[0].metrics, both[1].metrics) : [];
  const tradeoff = both ? buildTradeoffSummary(differences) : null;
  const headline = both && tradeoff ? buildHeadlineDifferences(differences, tradeoff) : [];

  const shareParams = both
    ? {
        aptSeq: [
          both[0].identity.kind === 'aptSeq' ? both[0].identity.aptSeq : undefined,
          both[1].identity.kind === 'aptSeq' ? both[1].identity.aptSeq : undefined,
        ].filter(Boolean).join(',') || null,
        aName: both[0].displayName,
        aLawdCd: both[0].identity.lawdCd,
        aDong: both[0].identity.dong,
        bName: both[1].displayName,
        bLawdCd: both[1].identity.lawdCd,
        bDong: both[1].identity.dong,
      }
    : undefined;

  return (
    <div className={styles.page}>
      <Header pageTitle="단지 비교" />
      <div className="container">
        <div className={styles.topBar}>
          <div className={styles.topBarTitle}>단지 2곳 비교</div>
          {both && (
            <ShareAction
              title={`${both[0].displayName} vs ${both[1].displayName} 비교`}
              text="이집에서 두 단지를 비교해보세요"
              params={shareParams}
            />
          )}
        </div>

        <div className={styles.slotRow}>
          {[0, 1].map((i) => {
            const slot = slots[i];
            return (
              <div key={i} className={styles.slotCard}>
                {slot ? (
                  <>
                    <div className={styles.slotHeader}>
                      <div>
                        <div className={styles.slotName}>
                          {slot.apartment ? (
                            <Link href={buildDetailHref(slot.apartment)}>{slot.apartment.displayName}</Link>
                          ) : (
                            slot.seed.name
                          )}
                        </div>
                        {slot.apartment?.regionLabel && <div className={styles.slotRegion}>{slot.apartment.regionLabel}</div>}
                      </div>
                      <button className={styles.removeBtn} onClick={() => removeSlot(i)} aria-label="제거">×</button>
                    </div>
                    {slot.loading && <InlineLoading message="불러오는 중..." />}
                  </>
                ) : (
                  <ApartmentAutocomplete
                    key={filledCount}
                    onSelect={addComplex}
                    placeholder={`비교할 단지 검색 (${filledCount}/2)`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {filledCount === 0 && (
          <Empty variant="noData" title="비교할 단지 2곳을 검색해서 추가해주세요." showMascot={false} />
        )}

        {both && bothLoading && <InlineLoading message="비교 데이터를 불러오는 중..." />}

        {both && !bothLoading && (
          <>
            {headline.length > 0 && (
              <div className={styles.panel}>
                <div className={styles.panelTitle}>핵심 차이</div>
                <ul className={styles.headlineList}>
                  {headline.map((d) => (
                    <li key={d.metricKey}>{formatHeadlineBullet(d, both[0].displayName, both[1].displayName)}</li>
                  ))}
                </ul>
              </div>
            )}

            <PriceSection a={both[0]} b={both[1]} differences={differences} />
            <ScoreSection a={both[0]} b={both[1]} />
            <MetricGroupSection
              title="단지 여건"
              keys={['buildYear', 'totalHouseholds', 'parkingPerHousehold']}
              a={both[0]} b={both[1]} differences={differences}
            />
            <MetricGroupSection
              title="교통 · 생활 · 교육"
              keys={['subwayDistance', 'busDistance', 'elementaryDistance', 'convenienceCount']}
              a={both[0]} b={both[1]} differences={differences}
            />

            {tradeoff && <TradeoffSection tradeoff={tradeoff} aName={both[0].displayName} bName={both[1].displayName} />}

            <div className={styles.nextActions}>
              <Button variant="secondary" size="sm" href={buildDetailHref(both[0])} onClick={() => trackEvent('compare_detail_click', { aptName: both[0].displayName })}>
                {both[0].displayName} 상세보기
              </Button>
              <Button variant="secondary" size="sm" href={buildDetailHref(both[1])} onClick={() => trackEvent('compare_detail_click', { aptName: both[1].displayName })}>
                {both[1].displayName} 상세보기
              </Button>
            </div>
          </>
        )}

        {filledCount === 2 && (
          <div className={styles.maxHint}>최대 2개까지 비교할 수 있어요. 단지를 제거한 후 다시 추가해주세요.</div>
        )}
      </div>
    </div>
  );
}

function buildDetailHref(apt: CompareApartment): string {
  const qs = new URLSearchParams({ lawdCd: apt.identity.lawdCd, dong: apt.identity.dong });
  if (apt.identity.kind === 'aptSeq') qs.set('aptSeq', apt.identity.aptSeq);
  return `/apt/${encodeURIComponent(apt.displayName)}?${qs.toString()}`;
}

function findDiff(differences: CompareDifference[], key: string): CompareDifference | undefined {
  return differences.find((d) => d.metricKey === key);
}

function PriceSection({ a, b, differences }: { a: CompareApartment; b: CompareApartment; differences: CompareDifference[] }) {
  const diff = findDiff(differences, 'salePrice');
  const priceA = a.metrics.find((m) => m.key === 'salePrice');
  const priceB = b.metrics.find((m) => m.key === 'salePrice');
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>가격{priceA?.area ? ` (${priceA.area.label} 기준)` : ''}</div>
      <div className={styles.priceRow}>
        <div className={styles.priceCol}>
          <div className={styles.priceValue}>{priceA?.displayValue || '정보 없음'}</div>
          {priceA?.period && <div className={styles.priceDate}>{priceA.period.from}</div>}
        </div>
        <div className={styles.priceCol}>
          <div className={styles.priceValue}>{priceB?.displayValue || '정보 없음'}</div>
          {priceB?.period && <div className={styles.priceDate}>{priceB.period.from}</div>}
        </div>
      </div>
      {diff?.differenceDisplay && <div className={styles.priceDiff}>차이 {diff.differenceDisplay}</div>}
      {diff?.reason && <div className={styles.caution}>{diff.reason}</div>}
      {diff?.caution && <div className={styles.caution}>{diff.caution}</div>}
    </div>
  );
}

function ScoreSection({ a, b }: { a: CompareApartment; b: CompareApartment }) {
  if (!a.score?.available && !b.score?.available) return null;
  const domainKeys = ['transport', 'living', 'education', 'complex'] as const;
  const labelOf: Record<string, string> = { transport: '교통', living: '생활', education: '교육', complex: '단지' };
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>이집 분석 (절대 평가 — 순위 아님)</div>
      {domainKeys.map((key) => {
        const da = a.score?.domains.find((d) => d.key === key);
        const db = b.score?.domains.find((d) => d.key === key);
        return (
          <div key={key} className={styles.domainRow}>
            <div className={styles.domainLabel}>{labelOf[key]}</div>
            <ScoreBar score={da?.score ?? null} />
            <ScoreBar score={db?.score ?? null} />
          </div>
        );
      })}
      <div className={styles.peerRow}>
        <span>{a.score?.peer ? scoreDomainSummary(a.score.peer.percentile, a.score.peer.confidence) : '비교군 정보 부족'}</span>
        <span>{b.score?.peer ? scoreDomainSummary(b.score.peer.percentile, b.score.peer.confidence) : '비교군 정보 부족'}</span>
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return <div className={styles.scoreBarWrap}><span className={styles.scoreMissing}>정보 없음</span></div>;
  return (
    <div className={styles.scoreBarWrap}>
      <div className={styles.scoreBarTrack}>
        <div className={styles.scoreBarFill} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
      <span className={styles.scoreValue}>{Math.round(score)}</span>
    </div>
  );
}

function MetricGroupSection({
  title, keys, a, b, differences,
}: {
  title: string; keys: string[]; a: CompareApartment; b: CompareApartment; differences: CompareDifference[];
}) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{title}</div>
      <table className={styles.metricTable}>
        <tbody>
          {keys.map((key) => {
            const ma = a.metrics.find((m) => m.key === key);
            const mb = b.metrics.find((m) => m.key === key);
            if (!ma || !mb) return null;
            const diff = findDiff(differences, key);
            return (
              <tr key={key}>
                <td className={styles.metricLabel}>{ma.label}</td>
                <td className={diff?.favors === 'a' ? styles.favorCell : undefined}>{ma.displayValue}</td>
                <td className={diff?.favors === 'b' ? styles.favorCell : undefined}>{mb.displayValue}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradeoffSection({ tradeoff, aName, bName }: { tradeoff: ReturnType<typeof buildTradeoffSummary>; aName: string; bName: string }) {
  const hasAny = tradeoff.aStrengths.length || tradeoff.bStrengths.length || tradeoff.similar.length || tradeoff.needsReview.length;
  if (!hasAny) return null;
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>요약</div>
      {tradeoff.aStrengths.length > 0 && (
        <div className={styles.tradeoffRow}><strong>{aName}의 강점</strong> {tradeoff.aStrengths.map((d) => d.label).join(', ')}</div>
      )}
      {tradeoff.bStrengths.length > 0 && (
        <div className={styles.tradeoffRow}><strong>{bName}의 강점</strong> {tradeoff.bStrengths.map((d) => d.label).join(', ')}</div>
      )}
      {tradeoff.similar.length > 0 && (
        <div className={styles.tradeoffRow}><strong>비슷한 항목</strong> {tradeoff.similar.map((d) => d.label).join(', ')}</div>
      )}
      {tradeoff.needsReview.length > 0 && (
        <div className={styles.tradeoffRow}><strong>확인 필요</strong> {tradeoff.needsReview.map((d) => d.label).join(', ')}</div>
      )}
    </div>
  );
}
