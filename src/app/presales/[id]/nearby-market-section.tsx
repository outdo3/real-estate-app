'use client';

import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type NearbyMarketApartment = {
  id: number;
  aptSeq: string | null;
  name: string;
  distanceKm: number;
  buildYear: number | null;
};

type NearbyMarketTransaction = {
  dealAmount: number;
  dealDate: string;
  exclusiveArea: number | null;
  floor: string | number | null;
};

type NearbyMarketComparison = {
  apartment: NearbyMarketApartment;
  recentTransactions: NearbyMarketTransaction[];
  recentMedianPrice: number | null;
  differenceAmount: number | null;
};

type NearbyMarketHouseType = {
  houseTypeDetailId: number;
  houseTy: string | null;
  supplyArea: number | null;
  exclusiveArea: number | null;
  presaleTopAmount: number | null;
  comparisonAvailable: boolean;
  comparisons: NearbyMarketComparison[];
};

type NearbyMarketData = {
  presaleId: number;
  locationAvailable: boolean;
  radiusKm: number | null;
  totalCandidates: number;
  nearbyApartmentCount: number;
  monthsSearched: number | null;
  houseTypes: NearbyMarketHouseType[];
};

type SortMode = 'distance' | 'new';

const INITIAL_VISIBLE = 3;

function formatManwon(v: number): string {
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok === 0) return `${man.toLocaleString()}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString()}만원`;
}

function formatSignedManwon(v: number): string {
  const sign = v < 0 ? '-' : '+';
  return `${sign}${formatManwon(Math.abs(v))}`;
}

// 표시 전용 반올림(소수점 최대 2자리) — 기존 P2-D3 formatArea 정책(page.module.css의
// presale-detail-client.tsx)과 동일한 규칙. DB 원본 값은 이 컴포넌트 어디서도 건드리지 않는다.
function formatArea(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function extractTypeSuffix(houseTy: string | null): string {
  return houseTy?.match(/([A-Za-z]+)$/)?.[1] || '';
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${formatArea(Math.round(km * 10) / 10)}km`;
}

function formatBuildYear(year: number | null): string {
  return year != null ? `${year}년 준공` : '준공연도 정보 없음';
}

function formatYearMonth(dealDate: string): string {
  return `${dealDate.slice(0, 4)}.${dealDate.slice(5, 7)}`;
}

function formatMonthsLabel(monthsSearched: number | null): string {
  if (monthsSearched == null) return '';
  return `최근 ${monthsSearched}개월 · 최대 3건 기준`;
}

// P2-D4-B3-FIX — 기존 "주택형·분양가" 섹션(presale-detail-client.tsx의 formatHouseTypeTitle)과
// 정확히 같은 데이터(supplyArea·suffix)·같은 표시 규칙을 사용한다. exclusiveArea(houseTy 숫자부,
// B2 비교 계산 전용 파생값)는 여기서 대표 표시명으로 쓰지 않는다 — 같은 페이지 안에서
// "79.48㎡ B"(분양 주택형)와 "60㎡ B"(비교용 전용면적)가 동시에 보여 사용자가 서로 다른
// 주택형으로 오인하는 문제(모바일 실기기 검수에서 발견)를 막기 위함이다.
function houseTypeChipLabel(h: NearbyMarketHouseType): string {
  const suffix = extractTypeSuffix(h.houseTy);
  return h.supplyArea != null
    ? `${formatArea(h.supplyArea)}㎡${suffix ? ` ${suffix}` : ''}`
    : h.houseTy || '정보 없음';
}

function sortHouseTypes(houseTypes: NearbyMarketHouseType[]): NearbyMarketHouseType[] {
  return [...houseTypes].sort((a, b) => {
    if (a.exclusiveArea == null && b.exclusiveArea == null) return 0;
    if (a.exclusiveArea == null) return 1;
    if (b.exclusiveArea == null) return -1;
    if (a.exclusiveArea !== b.exclusiveArea) return a.exclusiveArea - b.exclusiveArea;
    return extractTypeSuffix(a.houseTy).localeCompare(extractTypeSuffix(b.houseTy));
  });
}

function sortComparisons(comparisons: NearbyMarketComparison[], mode: SortMode): NearbyMarketComparison[] {
  const arr = [...comparisons];
  if (mode === 'new') {
    arr.sort((a, b) => {
      const ay = a.apartment.buildYear;
      const by = b.apartment.buildYear;
      if (ay == null && by == null) return a.apartment.distanceKm - b.apartment.distanceKm;
      if (ay == null) return 1;
      if (by == null) return -1;
      if (ay !== by) return by - ay;
      return a.apartment.distanceKm - b.apartment.distanceKm;
    });
  } else {
    arr.sort((a, b) => a.apartment.distanceKm - b.apartment.distanceKm);
  }
  return arr;
}

const INFO_TEXT =
  '선택한 분양 주택형과 전용면적 ±1㎡ 이내인 주변 아파트의 실제 거래를 비교합니다.\n\n' +
  '주변 단지는 최대 3km 범위에서 찾으며 최근 6개월 거래부터 확인하고, 필요한 경우 최대 24개월까지 조회합니다.\n\n' +
  '최근 거래 대표가격은 비슷한 전용면적의 최근 거래 최대 3건을 기준으로 계산합니다. 3건이면 가운데 가격, 2건이면 두 거래의 평균, 1건이면 해당 거래가격을 사용합니다.\n\n' +
  '가격 차이는 참고정보이며 준공연도·층·향·입지·상품 구성 등에 따라 차이가 발생할 수 있습니다.';

export default function NearbyMarketSection({ presaleId }: { presaleId: string }) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data?: NearbyMarketData; error?: string }>(
    `/api/presales/${presaleId}/nearby-market`,
    fetcher
  );

  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('distance');
  const [showAllCards, setShowAllCards] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const result = data?.success ? data.data ?? null : null;
  const apiErrorMessage = data && !data.success ? data.error : null;

  const sortedHouseTypes = useMemo(() => (result ? sortHouseTypes(result.houseTypes) : []), [result]);

  useEffect(() => {
    if (selectedId != null) return;
    if (sortedHouseTypes.length === 0) return;
    const withComparisons = sortedHouseTypes.find((h) => h.comparisonAvailable && h.comparisons.length > 0);
    setSelectedId((withComparisons ?? sortedHouseTypes[0]).houseTypeDetailId);
  }, [sortedHouseTypes, selectedId]);

  const selectedHouseType = sortedHouseTypes.find((h) => h.houseTypeDetailId === selectedId) ?? null;

  const sortedComparisons = useMemo(
    () => (selectedHouseType ? sortComparisons(selectedHouseType.comparisons, sortMode) : []),
    [selectedHouseType, sortMode]
  );

  const handleSelectHouseType = (id: number) => {
    setSelectedId(id);
    setShowAllCards(false);
    setExpandedCards(new Set());
  };

  const toggleCardExpanded = (aptId: number) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(aptId)) next.delete(aptId);
      else next.add(aptId);
      return next;
    });
  };

  const visibleComparisons = showAllCards ? sortedComparisons : sortedComparisons.slice(0, INITIAL_VISIBLE);
  const remainingCount = sortedComparisons.length - INITIAL_VISIBLE;

  return (
    <section className={styles.section}>
      <div className={styles.nearbyHeaderRow}>
        <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
          주변 아파트 실거래 비교
        </h2>
        <button
          type="button"
          className={styles.infoButton}
          aria-expanded={infoOpen}
          aria-label="주변 아파트 비교 안내"
          onClick={() => setInfoOpen((v) => !v)}
        >
          ⓘ
        </button>
      </div>

      {infoOpen && <p className={styles.infoPanel}>{INFO_TEXT}</p>}

      {isLoading ? (
        <div className={styles.nearbyStateBox}>주변 실거래 정보를 불러오는 중입니다...</div>
      ) : error || apiErrorMessage ? (
        <div className={styles.nearbyStateBox}>
          <p style={{ margin: 0 }}>
            주변 실거래 정보를 불러오지 못했습니다.
            <br />
            잠시 후 다시 확인해주세요.
          </p>
          <button type="button" className={styles.retryBtn} onClick={() => mutate()}>
            다시 시도
          </button>
        </div>
      ) : !result ? null : !result.locationAvailable ? (
        <p className={styles.emptyText}>정확한 위치정보가 없어 주변 단지를 비교할 수 없습니다.</p>
      ) : sortedHouseTypes.length === 0 ? (
        <p className={styles.emptyText}>비교할 주택형 정보가 없습니다.</p>
      ) : (
        <>
          <div className={styles.chipRow} role="group" aria-label="주택형 선택">
            {sortedHouseTypes.map((h) => (
              <button
                key={h.houseTypeDetailId}
                type="button"
                className={`${styles.chip} ${h.houseTypeDetailId === selectedId ? styles.chipActive : ''}`}
                aria-pressed={h.houseTypeDetailId === selectedId}
                onClick={() => handleSelectHouseType(h.houseTypeDetailId)}
              >
                {houseTypeChipLabel(h)}
              </button>
            ))}
          </div>

          {selectedHouseType && (
            <>
              <div className={styles.selectedSummary}>
                <h3 className={styles.selectedTitle}>{houseTypeChipLabel(selectedHouseType)}</h3>
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>최고 분양가</span>
                  <span className={styles.summaryValue}>
                    {selectedHouseType.presaleTopAmount != null ? formatManwon(selectedHouseType.presaleTopAmount) : '분양가 미공개'}
                  </span>
                </div>
                {selectedHouseType.exclusiveArea != null && (
                  <p className={styles.summaryNote}>
                    비교 전용면적 약 {formatArea(selectedHouseType.exclusiveArea)}㎡
                    <br />
                    비슷한 전용면적{' '}
                    {formatArea(selectedHouseType.exclusiveArea - 1)}㎡ ~ {formatArea(selectedHouseType.exclusiveArea + 1)}㎡의 주변
                    아파트 실거래와 비교합니다.
                  </p>
                )}
              </div>

              {sortedComparisons.length === 0 ? (
                <p className={styles.emptyText}>
                  {result.monthsSearched === 24
                    ? `최근 24개월까지 확인했지만 전용 ${
                        selectedHouseType.exclusiveArea != null ? formatArea(selectedHouseType.exclusiveArea - 1) : ''
                      }~${
                        selectedHouseType.exclusiveArea != null ? formatArea(selectedHouseType.exclusiveArea + 1) : ''
                      }㎡ 범위의 비교 가능한 거래를 찾지 못했습니다.`
                    : '비슷한 전용면적의 최근 실거래가 없습니다.'}
                </p>
              ) : (
                <>
                  <div className={styles.sortToggle} role="group" aria-label="주변단지 정렬">
                    <button
                      type="button"
                      className={`${styles.sortBtn} ${sortMode === 'distance' ? styles.sortBtnActive : ''}`}
                      aria-pressed={sortMode === 'distance'}
                      onClick={() => setSortMode('distance')}
                    >
                      거리순
                    </button>
                    <button
                      type="button"
                      className={`${styles.sortBtn} ${sortMode === 'new' ? styles.sortBtnActive : ''}`}
                      aria-pressed={sortMode === 'new'}
                      onClick={() => setSortMode('new')}
                    >
                      신축순
                    </button>
                  </div>

                  {visibleComparisons.map((c) => {
                    const latest = c.recentTransactions[0];
                    const isExpanded = expandedCards.has(c.apartment.id);
                    return (
                      <div key={c.apartment.id} className={styles.aptCard}>
                        <p className={styles.aptName}>{c.apartment.name}</p>
                        <p className={styles.aptMeta}>
                          {formatDistance(c.apartment.distanceKm)} · {formatBuildYear(c.apartment.buildYear)}
                        </p>

                        {latest && (
                          <div className={styles.cardStatBlock}>
                            <div className={styles.cardStatLabel}>최근 거래</div>
                            <div className={styles.cardStatValue}>{formatManwon(latest.dealAmount)}</div>
                            <div className={styles.cardStatDetail}>
                              {[
                                latest.exclusiveArea != null ? `${formatArea(latest.exclusiveArea)}㎡` : null,
                                latest.floor != null ? `${latest.floor}층` : null,
                                formatYearMonth(latest.dealDate),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </div>
                        )}

                        {c.recentMedianPrice != null && (
                          <div className={styles.cardStatBlock}>
                            <div className={styles.cardStatLabel}>최근 거래 대표가격</div>
                            <div className={styles.cardStatValue}>{formatManwon(c.recentMedianPrice)}</div>
                            <div className={styles.cardStatDetail}>{formatMonthsLabel(result.monthsSearched)}</div>
                          </div>
                        )}

                        <div className={styles.cardStatBlock}>
                          <div className={styles.cardStatLabel}>분양 최고가와 차이</div>
                          {selectedHouseType.presaleTopAmount == null ? (
                            <div className={styles.cardStatDetail}>분양가가 공개되지 않아 가격 차이를 계산할 수 없습니다.</div>
                          ) : c.differenceAmount != null ? (
                            <div className={styles.diffValue}>{formatSignedManwon(c.differenceAmount)}</div>
                          ) : (
                            <div className={styles.cardStatDetail}>가격 차이를 계산할 수 없습니다.</div>
                          )}
                        </div>

                        {c.recentTransactions.length > 1 && (
                          <button
                            type="button"
                            className={styles.expandBtn}
                            aria-expanded={isExpanded}
                            onClick={() => toggleCardExpanded(c.apartment.id)}
                          >
                            {isExpanded ? '접기 ▲' : `최근 거래 ${c.recentTransactions.length}건 보기 ▼`}
                          </button>
                        )}

                        {isExpanded && (
                          <div className={styles.txList}>
                            {c.recentTransactions.map((t, idx) => (
                              <div key={idx} className={styles.txRow}>
                                <span>
                                  {formatYearMonth(t.dealDate)}
                                  {t.exclusiveArea != null ? ` · ${formatArea(t.exclusiveArea)}㎡` : ''}
                                  {t.floor != null ? ` · ${t.floor}층` : ''}
                                </span>
                                <span>{formatManwon(t.dealAmount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {remainingCount > 0 && !showAllCards && (
                    <button type="button" className={styles.moreBtn} aria-expanded={false} onClick={() => setShowAllCards(true)}>
                      주변 단지 {remainingCount}곳 더보기 ↓
                    </button>
                  )}
                  {showAllCards && remainingCount > 0 && (
                    <button type="button" className={styles.moreBtn} aria-expanded={true} onClick={() => setShowAllCards(false)}>
                      접기 ↑
                    </button>
                  )}

                  <p className={styles.disclaimer}>
                    최근 실거래는 비슷한 전용면적을 기준으로 비교합니다.
                    <br />
                    준공연도·층·향·입지·상품 구성 등에 따라 가격 차이가 발생할 수 있습니다.
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
