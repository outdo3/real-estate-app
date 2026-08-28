'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import Header from '@/components/Header';
import ShareAction from '@/components/ShareAction';
import NearbyMarketSection, { type NearbyMarketApiResponse } from './nearby-market-section';
import PresaleNearbyMap from './presale-nearby-map';
import styles from './page.module.css';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type PresaleStatus = 'upcoming' | 'ongoing' | 'closed' | 'unsold';

type HouseTypeDetail = {
  id: number;
  houseTy: string | null;
  supplyArea: number | null;
  generalSupply: number | null;
  specialSupply: number | null;
  totalSupply: number | null;
  topAmount: number | null;
};

type PresaleDetail = {
  id: number;
  houseName: string;
  locationAddress: string | null;
  subscriptionAreaName: string | null;
  houseSecdName: string | null;
  rentSecdName: string | null;
  constructCompany: string | null;
  businessEntityName: string | null;
  latitude: number | null;
  longitude: number | null;
  totalSupplyHouseholds: number | null;
  announcementDate: string | null;
  receiptStartDate: string | null;
  receiptEndDate: string | null;
  winnerDate: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  moveInExpectedYm: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  pblancUrl: string | null;
  status: PresaleStatus;
  houseTypeDetails: HouseTypeDetail[];
};

const STATUS_LABEL: Record<PresaleStatus, string> = {
  ongoing: '접수중',
  upcoming: '접수예정',
  closed: '접수마감',
  unsold: '무순위(잔여세대)',
};

const STATUS_BADGE_CLASS: Record<PresaleStatus, string> = {
  ongoing: styles.badgeOngoing,
  upcoming: styles.badgeUpcoming,
  closed: styles.badgeClosed,
  unsold: styles.badgeUnsold,
};

function formatManwon(v: number): string {
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok === 0) return `${man.toLocaleString()}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString()}만원`;
}

function formatPriceRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return '가격 미공개';
  if (min != null && max != null && min === max) return formatManwon(min);
  if (min != null && max != null) return `${formatManwon(min)} ~ ${formatManwon(max)}`;
  return formatManwon((min ?? max) as number);
}

function formatMoveIn(ym: string | null): string {
  if (!ym || !/^\d{6}$/.test(ym)) return '입주예정 정보 없음';
  const year = ym.slice(0, 4);
  const month = parseInt(ym.slice(4, 6), 10);
  return `${year}년 ${month}월 예정`;
}

function formatHouseholds(n: number | null): string {
  if (n == null) return '세대수 정보 없음';
  return `총 ${n.toLocaleString()}세대`;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  return d.slice(0, 10).replace(/-/g, '.');
}

// 표시 전용 반올림(소수점 최대 2자리) — DB 원본 supplyArea 값 자체는 건드리지 않는다.
// Math.round 후 Number의 기본 문자열 변환이 trailing zero를 자연히 제거한다
// (84 -> "84", 83.6 -> "83.6", 83.65 -> "83.65").
function formatArea(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function formatHouseTypeTitle(d: HouseTypeDetail): string {
  const typeSuffix = d.houseTy?.match(/([A-Za-z]+)$/)?.[1] || '';
  return d.supplyArea != null
    ? `${formatArea(d.supplyArea)}㎡${typeSuffix ? ` ${typeSuffix}` : ''}`
    : d.houseTy || '주택형 정보 없음';
}

function formatHouseTypeSubtitle(d: HouseTypeDetail): string {
  const supplyLabel = d.totalSupply != null ? `공급 ${d.totalSupply.toLocaleString()}세대` : null;
  const priceLabel = d.topAmount != null ? `최고 ${formatManwon(d.topAmount)}` : '분양가 미공개';
  return [supplyLabel, priceLabel].filter(Boolean).join(' · ');
}

export default function PresaleDetailClient() {
  const params = useParams();
  const id = params.id as string;

  const { data, isLoading } = useSWR(`/api/presales/${id}`, fetcher);

  // P2-D4-B4 — B3(주변 아파트 실거래 비교)와 B4(지도)가 같은 nearby-market 응답을
  // 공유한다. fetch를 여기 한 곳에서만 호출해 두 섹션이 각자 useSWR을 갖지 않게 하고,
  // 선택된 주택형(selectedHouseTypeId)도 여기서 관리해 지도 popup의 대표가격이 B3의
  // 현재 선택과 항상 같은 값을 보도록 한다(추가 API 호출 없이 client-side로만 연결).
  const {
    data: marketData,
    error: marketError,
    isLoading: marketLoading,
    mutate: marketMutate,
  } = useSWR<NearbyMarketApiResponse>(`/api/presales/${id}/nearby-market`, fetcher);
  const [selectedHouseTypeId, setSelectedHouseTypeId] = useState<number | null>(null);

  const presale: PresaleDetail | null = data?.success ? data.data : null;
  const fetchError = data && !data.success ? data.error : null;
  const isNotFound = fetchError === '분양정보를 찾을 수 없습니다.';

  const scheduleRows = presale
    ? [
        { label: '모집공고', text: presale.announcementDate ? formatDate(presale.announcementDate) : null },
        {
          label: '청약접수',
          text:
            presale.receiptStartDate && presale.receiptEndDate
              ? `${formatDate(presale.receiptStartDate)} ~ ${formatDate(presale.receiptEndDate)}`
              : null,
        },
        { label: '당첨발표', text: presale.winnerDate ? formatDate(presale.winnerDate) : null },
        {
          label: '계약기간',
          text:
            presale.contractStartDate && presale.contractEndDate
              ? `${formatDate(presale.contractStartDate)} ~ ${formatDate(presale.contractEndDate)}`
              : null,
        },
        { label: '입주예정', text: formatMoveIn(presale.moveInExpectedYm) },
      ].filter((row) => row.text)
    : [];

  return (
    <div className={styles.main}>
      <Header pageTitle="분양정보" />
      <div className="container">
        {isLoading ? (
          <div className={styles.stateBox}>상세 정보를 불러오는 중입니다...</div>
        ) : isNotFound ? (
          <div className={styles.stateBox}>
            <p>분양정보를 찾을 수 없습니다.</p>
            <Link href="/presales" className={styles.stateLink}>
              분양정보 목록으로 돌아가기
            </Link>
          </div>
        ) : fetchError ? (
          <div className={styles.stateBox}>⚠️ {fetchError}</div>
        ) : presale ? (
          <>
            {/* A. 상단 핵심 요약 */}
            <section className={styles.summarySection}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                <h1 className={styles.title}>{presale.houseName}</h1>
                <ShareAction
                  title={`${presale.houseName} 분양정보 | 이집`}
                  text={presale.subscriptionAreaName ? `${presale.subscriptionAreaName} 분양가·일정 정보` : '분양가·일정 정보'}
                />
              </div>
              <div className={styles.metaRow}>
                <span className={`${styles.badge} ${STATUS_BADGE_CLASS[presale.status]}`}>{STATUS_LABEL[presale.status]}</span>
                <span className={styles.region}>{presale.subscriptionAreaName || '지역 정보 없음'}</span>
              </div>
              <div className={styles.price}>{formatPriceRange(presale.minPrice, presale.maxPrice)}</div>
              <p className={styles.priceCaption}>최고 분양가 기준</p>
              <div className={styles.metaRow}>
                <span>{formatHouseholds(presale.totalSupplyHouseholds)}</span>
                <span>{formatMoveIn(presale.moveInExpectedYm)}</span>
              </div>
            </section>

            {/* B. 청약 일정 */}
            {scheduleRows.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>청약 일정</h2>
                <div className={styles.scheduleList}>
                  {scheduleRows.map((row) => (
                    <div key={row.label} className={styles.scheduleRow}>
                      <span className={styles.scheduleLabel}>{row.label}</span>
                      <span className={styles.scheduleValue}>{row.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* C. 주택형 / 분양가 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>주택형 · 분양가</h2>
              {presale.houseTypeDetails.length === 0 ? (
                <p className={styles.emptyText}>주택형 정보가 없습니다.</p>
              ) : (
                <div className={styles.accordionList}>
                  {presale.houseTypeDetails.map((d) => (
                    <details key={d.id} className={styles.accordionItem}>
                      <summary className={styles.accordionSummary}>
                        <span className={styles.accordionTitle}>{formatHouseTypeTitle(d)}</span>
                        <span className={styles.accordionSubtitle}>{formatHouseTypeSubtitle(d)}</span>
                      </summary>
                      <div className={styles.accordionBody}>
                        <div className={styles.accordionRow}>
                          <span>일반공급</span>
                          <span>{d.generalSupply != null ? `${d.generalSupply.toLocaleString()}세대` : '정보 없음'}</span>
                        </div>
                        <div className={styles.accordionRow}>
                          <span>특별공급</span>
                          <span>{d.specialSupply != null ? `${d.specialSupply.toLocaleString()}세대` : '정보 없음'}</span>
                        </div>
                        <div className={styles.accordionRow}>
                          <span>총 공급</span>
                          <span>{d.totalSupply != null ? `${d.totalSupply.toLocaleString()}세대` : '정보 없음'}</span>
                        </div>
                        <div className={styles.accordionRow}>
                          <span>최고 분양가</span>
                          <span>{d.topAmount != null ? formatManwon(d.topAmount) : '분양가 미공개'}</span>
                        </div>
                        <div className={styles.accordionRow}>
                          <span>원본 주택형 코드</span>
                          <span>{d.houseTy || '정보 없음'}</span>
                        </div>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </section>

            {/* D. 사업정보 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>사업정보</h2>
              <div className={styles.infoList}>
                <div className={styles.infoRow}>
                  <span>시공사</span>
                  <span>{presale.constructCompany || '정보 없음'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>사업주체</span>
                  <span>{presale.businessEntityName || '정보 없음'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>주택유형</span>
                  <span>{presale.houseSecdName || '정보 없음'}</span>
                </div>
                <div className={styles.infoRow}>
                  <span>공급구분</span>
                  <span>{presale.rentSecdName || '정보 없음'}</span>
                </div>
              </div>
            </section>

            {/* E. 위치정보 */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>위치정보</h2>
              <div className={styles.locationCard}>
                <p className={styles.locationAddress}>{presale.locationAddress || '주소 정보 없음'}</p>
                {presale.latitude != null && presale.longitude != null ? (
                  <a
                    href={`https://map.kakao.com/link/map/${encodeURIComponent(presale.houseName)},${presale.latitude},${presale.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.stateLink}
                  >
                    카카오맵에서 보기 ↗
                  </a>
                ) : (
                  <p className={styles.emptyText}>정확한 위치정보 준비 중</p>
                )}
              </div>
            </section>

            {/* 위치와 주변 단지 지도 (B4) */}
            <PresaleNearbyMap
              houseName={presale.houseName}
              latitude={presale.latitude}
              longitude={presale.longitude}
              marketData={marketData}
              marketLoading={marketLoading}
              selectedHouseTypeId={selectedHouseTypeId}
            />

            {/* 주변 아파트 실거래 비교 (B3) */}
            <NearbyMarketSection
              data={marketData}
              error={marketError}
              isLoading={marketLoading}
              mutate={marketMutate}
              selectedId={selectedHouseTypeId}
              onSelectId={setSelectedHouseTypeId}
            />

            {/* F. 청약홈 원문 CTA */}
            {presale.pblancUrl && (
              <a href={presale.pblancUrl} target="_blank" rel="noopener noreferrer" className={styles.ctaButton}>
                청약홈에서 모집공고 보기 ↗
              </a>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
