'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { MapPin, ChevronRight } from 'lucide-react';
import Header from '@/components/Header';
import Badge from '@/components/ui/Badge';
import Empty from '@/components/ui/Empty';
import ErrorState from '@/components/ui/ErrorState';
import InlineLoading from '@/components/ui/InlineLoading';
import KakaoShareButton from '@/components/KakaoShareButton';
import { siteConfig } from '@/config/site';
import styles from './school-detail.module.css';

// SCHOOLINFO / SCHOOL V2.1 — "학교 정보 나열"이 아니라 "이 학교를 기준으로 어떤
// 아파트를 봐야 하는가"까지 이어지는 의사결정형 페이지(§0). 기존 /api/school/apartments
// (Kakao POI 기반, aptSeq 없음)를 대체하고 /api/school/[id](canonical school identity +
// ApartmentMaster 기반 관련 아파트)만 사용한다.

interface SchoolHeader {
  schoolName: string;
  schoolLevel: string | null;
  establishmentType: string | null;
  genderType: string | null;
  address: string | null;
  roadAddress: string | null;
  sigunguCode: string | null;
  dongName: string | null;
  isActive: boolean;
}

type ApartmentRelation = 'ATTENDANCE_ZONE' | 'MIDDLE_GROUP' | 'NEARBY';

interface RelatedApartmentCard {
  aptSeq: string;
  name: string;
  dong: string | null;
  lawdCd: string | null;
  relation: ApartmentRelation;
  distanceKm: number | null;
  totalHouseholds: number | null;
  buildYear: number | null;
  hasRecentPrice: boolean;
  price: string | null;
  dealAmount: number | null;
  isCurrent: boolean;
}

interface SchoolStatBlock {
  referenceYear: number;
  disclosureYear: number | null;
  studentCount: number | null;
  classCount: number | null;
  teacherCount: number | null;
  sourceName: string;
  derived: {
    studentsPerClass: number | null;
    studentsPerTeacher: number | null;
  };
}

interface SchoolDetailResponse {
  status: 'OK' | 'NOT_FOUND' | 'ERROR';
  identity: { type: 'CANONICAL' | 'KAKAO_ONLY'; schoolId: number | null; neisSchoolCode: string | null; name: string };
  header: SchoolHeader | null;
  location: { latitude: number; longitude: number; source: 'OFFICIAL_POINT' | 'KAKAO_EXTERNAL' } | null;
  relatedApartments: RelatedApartmentCard[];
  currentApartment: RelatedApartmentCard | null;
  decisionInsights: { text: string }[];
  stat: SchoolStatBlock | null;
  source: { schoolInfoLabel: string; derivedLabel: string };
}

const RELATION_LABEL: Record<ApartmentRelation, string> = {
  ATTENDANCE_ZONE: '공식 통학구역',
  MIDDLE_GROUP: '학교군 관련',
  NEARBY: '학교 주변 아파트',
};

const RELATION_BADGE_VARIANT: Record<ApartmentRelation, 'status' | 'neutral' | 'beta'> = {
  ATTENDANCE_ZONE: 'status',
  MIDDLE_GROUP: 'beta',
  NEARBY: 'neutral',
};

function classifyLevel(schoolLevel: string | null, name: string): '초' | '중' | '고' | null {
  if (schoolLevel?.includes('초등')) return '초';
  if (schoolLevel?.includes('고등')) return '고';
  if (schoolLevel?.includes('중')) return '중';
  if (name.includes('초등학교')) return '초';
  if (name.includes('고등학교')) return '고';
  if (name.includes('중학교')) return '중';
  return null;
}

function distanceLabel(km: number | null): string | null {
  if (km == null) return null;
  return km < 1 ? `직선거리 약 ${Math.round(km * 1000)}m` : `직선거리 약 ${km.toFixed(1)}km`;
}

export default function SchoolDetailClient() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<SchoolDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const relatedSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const qs = search.toString();
    const url = `/api/school/${encodeURIComponent(params.id)}${qs ? `?${qs}` : ''}`;

    let cancelled = false;
    setLoading(true);
    setNetworkError(false);

    fetch(url)
      .then((res) => {
        if (!res.ok && res.status !== 404) throw new Error('network');
        return res.json();
      })
      .then((json: SchoolDetailResponse) => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNetworkError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (loading) {
    return (
      <div className={styles.main}>
        <Header hideLogo pageTitle="학교 정보" pageTitleLarge pageTitleAlign="left" />
        <div className="container">
          <InlineLoading message="학교 정보를 확인하고 있어요..." />
        </div>
      </div>
    );
  }

  if (networkError) {
    return (
      <div className={styles.main}>
        <Header hideLogo pageTitle="학교 정보" pageTitleLarge pageTitleAlign="left" />
        <div className="container">
          <ErrorState variant="section" message="학교 정보를 불러오지 못했어요." />
        </div>
      </div>
    );
  }

  if (!data || data.status !== 'OK') {
    return (
      <div className={styles.main}>
        <Header hideLogo pageTitle="학교 정보" pageTitleLarge pageTitleAlign="left" />
        <div className="container">
          <Empty variant="noData" title="학교 정보를 확인할 수 없어요." description="인근 학교 목록에서 다시 진입해주세요." showMascot={false} />
        </div>
      </div>
    );
  }

  const { identity, header, relatedApartments, currentApartment, decisionInsights, stat, source } = data;
  const schoolName = header?.schoolName || identity.name;
  const level = classifyLevel(header?.schoolLevel ?? null, schoolName);
  const regionLabel = [header?.roadAddress || header?.address].filter(Boolean).join(' ');
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className={styles.main}>
      <Header hideLogo pageTitle={schoolName} pageTitleLarge pageTitleAlign="left" />

      <div className="container">
        {/* SECTION 1 — 학교 헤더 */}
        <div className={styles.headerCard}>
          <div className={styles.headerTopRow}>
            <div className={styles.headerBadges}>
              {level && <Badge variant="neutral">{level}등학교</Badge>}
              {header?.establishmentType && <Badge variant="neutral">{header.establishmentType}</Badge>}
              {header?.genderType && <Badge variant="neutral">{header.genderType}</Badge>}
              {!header && <Badge variant="warning">학교알리미 미확인</Badge>}
            </div>
            <KakaoShareButton compact title={`${schoolName} - ${siteConfig.name}`} description={`${schoolName}와 관련된 아파트, 거리, 가격 비교를 확인하세요.`} />
          </div>
          {regionLabel && (
            <p className={styles.headerAddress}>
              <MapPin size={14} aria-hidden="true" /> {regionLabel}
            </p>
          )}
          {!header && <p className={styles.mutedText}>학교알리미 공식 정보와 아직 연결되지 않은 학교입니다. 표시된 정보는 카카오 지도 기준입니다.</p>}
        </div>

        {/* 현재 보고 있던 단지 컨텍스트(§10) */}
        {currentApartment && (
          <div className={styles.currentAptCallout}>
            <span className={styles.currentAptLabel}>현재 보고 있는 단지</span>
            <span className={styles.currentAptName}>{currentApartment.name}</span>
            <span className={styles.currentAptMeta}>
              {distanceLabel(currentApartment.distanceKm) || '거리 정보 없음'}
              {currentApartment.hasRecentPrice ? ` · ${currentApartment.price}` : ' · 최근 실거래 정보 없음'}
            </span>
          </div>
        )}

        {/* SECTION 2 — 한눈에 보는 학교 (SCHOOL DATA BACKFILL V1 §28: 실데이터가 있을
            때만 카드로 표시, 없으면 기존 안내 문구를 그대로 유지한다) */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>한눈에 보는 학교</h2>
          {stat ? (
            <>
              <p className={styles.statYearLabel}>{stat.referenceYear}년 기준</p>
              <div className={styles.statGrid}>
                <StatCard label="학생수" value={stat.studentCount} unit="명" sourceTag={`출처: ${stat.sourceName}`} />
                <StatCard label="교원수" value={stat.teacherCount} unit="명" sourceTag={`출처: ${stat.sourceName}`} />
                <StatCard label="학급수" value={stat.classCount} unit="개" sourceTag={`출처: ${stat.sourceName}`} />
                <StatCard label="학급당 학생수" value={stat.derived.studentsPerClass} unit="명" sourceTag={source.derivedLabel} derived />
                <StatCard label="교원 1인당 학생수" value={stat.derived.studentsPerTeacher} unit="명" sourceTag={source.derivedLabel} derived />
              </div>
            </>
          ) : (
            <div className={styles.introCard}>
              <p className={styles.introText}>
                학생수·학급수·교원수 등 학교알리미 공식 통계는 아직 연동 준비 중이에요. 연동 전까지는 관련 아파트 비교에 집중해서 보여드릴게요.
              </p>
            </div>
          )}
        </section>

        {/* SECTION 6 — 이 학교와 연결된 아파트(핵심) */}
        <section className={styles.section} ref={relatedSectionRef}>
          <h2 className={styles.sectionTitle}>이 학교와 연결된 아파트</h2>
          <p className={styles.aptDistanceCaveat}>직선거리는 이집 계산값이며, 실제 통학 경로·배정과 다를 수 있어요.</p>

          {relatedApartments.length === 0 ? (
            <div className={styles.introCard}>
              <p className={styles.introText}>이 학교와 연결된 아파트 정보를 찾지 못했어요.</p>
            </div>
          ) : (
            <div className={styles.aptList}>
              {relatedApartments.map((apt) => (
                <RelatedApartmentRow key={apt.aptSeq} apt={apt} router={router} />
              ))}
            </div>
          )}
        </section>

        {/* SECTION 7 — 이집의 해석(deterministic, 실제 비교값만) */}
        {decisionInsights.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>이집의 해석</h2>
            <div className={styles.insightCard}>
              {decisionInsights.map((insight, i) => (
                <p key={i} className={styles.insightText}>
                  {insight.text}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* CTA(§29) */}
        <div className={styles.ctaRow}>
          {relatedApartments.length > 0 && (
            <button type="button" className={styles.ctaSecondary} onClick={() => relatedSectionRef.current?.scrollIntoView({ behavior: 'smooth' })}>
              관련 아파트 보기
            </button>
          )}
          {currentApartment && (
            <button type="button" className={styles.ctaPrimary} onClick={() => router.back()}>
              현재 단지로 돌아가기
            </button>
          )}
        </div>

        {/* 출처(§8/§15/§16) */}
        <div className={styles.provenance}>
          <span>{source.schoolInfoLabel}</span>
          <span>가격·거리·비교: {source.derivedLabel}</span>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  sourceTag,
  derived = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  sourceTag: string;
  derived?: boolean;
}) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value != null ? `${value.toLocaleString()}${unit}` : '정보 없음'}</span>
      <span className={derived ? styles.statTagDerived : styles.statTagRaw}>{sourceTag}</span>
    </div>
  );
}

function RelatedApartmentRow({ apt, router }: { apt: RelatedApartmentCard; router: ReturnType<typeof useRouter> }) {
  const href = `/apt/${encodeURIComponent(apt.name)}${apt.lawdCd ? `?lawdCd=${apt.lawdCd}${apt.dong ? `&dong=${encodeURIComponent(apt.dong)}` : ''}` : ''}`;
  return (
    <div className={`${styles.aptRow} ${apt.isCurrent ? styles.aptRowCurrent : ''}`}>
      <div className={styles.aptRowInfo}>
        <div className={styles.aptRowBadgeLine}>
          <Badge variant={RELATION_BADGE_VARIANT[apt.relation]}>{RELATION_LABEL[apt.relation]}</Badge>
          {apt.isCurrent && <Badge variant="positive">현재 보는 단지</Badge>}
        </div>
        <div className={styles.aptRowName}>
          {apt.name} {apt.buildYear && <span className={styles.aptRowYear}>{apt.buildYear}년</span>}
        </div>
        <div className={styles.aptRowMeta}>
          {[distanceLabel(apt.distanceKm), apt.totalHouseholds ? `${apt.totalHouseholds.toLocaleString('ko-KR')}세대` : null, apt.hasRecentPrice ? apt.price : '최근 실거래 정보 없음']
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <button type="button" className={styles.aptRowBtn} onClick={() => router.push(href)} aria-label={`${apt.name} 상세보기`}>
        상세보기
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
