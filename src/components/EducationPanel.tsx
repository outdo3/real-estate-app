'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { School, GraduationCap, Baby, Info, ChevronDown, ChevronRight } from 'lucide-react';
import Badge from './ui/Badge';
import Empty from './ui/Empty';
import ErrorState from './ui/ErrorState';
import InlineLoading from './ui/InlineLoading';
import {
  ZONE_LABEL,
  ZONE_SUMMARY_LABEL,
  middleSummaryValue,
  shouldRenderZoneSchoolList,
  middleGroupIsSingleSchool,
  kindergartenSummaryValue,
  highSchoolSummaryValue,
  type AttendanceStatus,
} from '@/lib/education/education-ui-labels';
import { buildSchoolHref } from '@/lib/school-link';
import styles from './EducationPanel.module.css';

// SCHOOL V2-D1 — 단지 상세 "교육환경" section. 기존 SchoolDistrictPanel(카카오
// POI 나열)을 대체한다. "학교 데이터 나열"이 아니라 "부모가 빠르게 판단"할 수
// 있게 이해→판단 순서로 구성한다(§2). 5.76MB attendance-zone artifact는 이
// 파일에서 절대 import하지 않는다 — 전부 /api/apt/[name]/education 서버 라우트를
// 통해서만 받는다(§21).

interface EduSchoolRef {
  schoolId: number | null;
  neisSchoolCode: string | null;
  schoolName: string;
  identityConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';
}

interface ElementaryZone {
  status: AttendanceStatus;
  reasonCode: string;
  zoneName: string | null;
  zoneType: 'SINGLE' | 'JOINT_SYMMETRIC' | 'JOINT_ASYMMETRIC';
  schools: EduSchoolRef[];
  sourceDate: string;
  sourceName: string;
  notice: string;
}

interface MiddleGroup {
  status: AttendanceStatus;
  groupName: string | null;
  schools: EduSchoolRef[];
  sourceDate: string;
}

interface NearbyKakaoSchool {
  name: string;
  distanceM: number;
  establishmentType: string | null;
  // APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX §18~22 — 이 POI 고유의 canonical 좌표/id.
  // null이면(과거 캐시 응답 등) 클릭 불가로 정직하게 처리한다(이름만으로 다른 학교로
  // 재검색해 이동하지 않는다 — 동명이교 오선택 금지 원칙).
  kakaoId: string | null;
  lat: number | null;
  lng: number | null;
}

interface NearbyKindergarten {
  id: number;
  name: string;
  establishmentType: string | null;
  distanceM: number;
  capacity: number | null;
  enrollment: number | null;
  classCount: number | null;
}

interface EducationApiResponse {
  status: 'OK' | 'NOT_FOUND' | 'AMBIGUOUS' | 'INSUFFICIENT_DATA';
  elementaryAttendanceZone: ElementaryZone | null;
  middleSchoolGroup: MiddleGroup | null;
  nearbyElementarySchools: NearbyKakaoSchool[];
  nearbyHighSchools: NearbyKakaoSchool[];
  kindergartens: NearbyKindergarten[];
}

interface EducationPanelProps {
  aptName: string;
  lawdCd: string;
  dong: string;
  ready: boolean;
}

export default function EducationPanel({ aptName, lawdCd, dong, ready }: EducationPanelProps) {
  const [data, setData] = useState<EducationApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [showMiddleList, setShowMiddleList] = useState(false);
  const [showKinderMore, setShowKinderMore] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setNetworkError(false);

    fetch(`/api/apt/${encodeURIComponent(aptName)}/education?lawdCd=${encodeURIComponent(lawdCd)}&dong=${encodeURIComponent(dong)}`)
      .then((res) => {
        if (!res.ok) throw new Error('network');
        return res.json();
      })
      .then((json: EducationApiResponse) => {
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
  }, [aptName, lawdCd, dong, ready]);

  if (!ready || loading) {
    return <InlineLoading message="교육환경 정보를 확인하고 있어요..." />;
  }

  if (networkError) {
    return <ErrorState variant="inline" message="교육환경 정보를 불러오지 못했어요." />;
  }

  if (!data || data.status !== 'OK') {
    return <Empty variant="noData" title="교육환경 정보를 확인할 수 없어요." showMascot={false} />;
  }

  const zone = data.elementaryAttendanceZone;
  const middle = data.middleSchoolGroup;
  const kindergartens = data.kindergartens || [];
  const nearbyElementary = data.nearbyElementarySchools || [];
  const nearbyHigh = data.nearbyHighSchools || [];
  // 아파트 좌표 자체가 없는 경우(COORDINATE_MISSING) — "반경 내 없음"(검색해서
  // 없었다)과 "확인 불가"(애초에 검색할 좌표가 없었다)를 구분한다.
  const coordinateUnavailable = zone?.reasonCode === 'COORDINATE_MISSING';

  return (
    <div className={styles.wrap}>
      {/* 한눈에 요약 */}
      <div className={styles.summaryRow}>
        <SummaryChip icon={<School size={16} aria-hidden="true" />} label="초등 통학" value={zone ? ZONE_SUMMARY_LABEL[zone.status] : '확인 불가'} />
        <SummaryChip icon={<GraduationCap size={16} aria-hidden="true" />} label="중학교" value={middleSummaryValue(middle)} />
        <SummaryChip icon={<Baby size={16} aria-hidden="true" />} label="유치원" value={kindergartenSummaryValue(kindergartens.length, coordinateUnavailable)} />
        <SummaryChip icon={<School size={16} aria-hidden="true" />} label="고등학교" value={highSchoolSummaryValue(nearbyHigh.length, coordinateUnavailable)} />
      </div>

      {/* 초등학교 — 통학구역과 가까운 학교를 분리 */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>초등학교</h3>

        <div className={styles.card}>
          <div className={styles.cardLabel}>공식 통학구역</div>
          {zone ? <ElementaryZoneBody zone={zone} /> : <p className={styles.mutedText}>{ZONE_LABEL.NOT_AVAILABLE}</p>}
          <p className={styles.legalNotice}>
            <Info size={13} aria-hidden="true" /> 실제 배정은 관할 교육지원청 기준을 확인하세요.
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.cardLabel}>가까운 초등학교</div>
          {nearbyElementary.length > 0 ? (
            <ul className={styles.plainList}>
              {nearbyElementary.map((s) => (
                <li key={s.name}>
                  <SchoolRow school={s} href={buildSchoolHref(s, lawdCd)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.mutedText}>거리 확인 중</p>
          )}
          <p className={styles.helperNote}>
            <Info size={13} aria-hidden="true" /> 가까운 학교와 통학구역 학교는 다를 수 있어요.
          </p>
        </div>
      </section>

      {/* 중학교 — 학교군 */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>중학교</h3>
        <div className={styles.card}>
          {middle && middle.status === 'AVAILABLE' && middle.groupName ? (
            middleGroupIsSingleSchool(middle) ? (
              <p className={styles.plainText}>{middle.schools[0]?.schoolName ?? middle.groupName}</p>
            ) : (
              <>
                <p className={styles.plainText}>
                  <b>{middle.groupName}</b>
                  <span className={styles.mutedInline}> · {middle.schools.length}개 중학교가 포함돼 있어요</span>
                </p>
                <button type="button" className={styles.expandToggle} onClick={() => setShowMiddleList((v) => !v)} aria-expanded={showMiddleList}>
                  학교 목록 보기
                  <ChevronDown size={16} className={showMiddleList ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
                </button>
                {showMiddleList && (
                  <ul className={styles.plainList}>
                    {middle.schools.map((s) => (
                      <li key={s.schoolName}>{s.schoolName}</li>
                    ))}
                  </ul>
                )}
              </>
            )
          ) : (
            <p className={styles.mutedText}>{middle ? ZONE_LABEL[middle.status] : ZONE_LABEL.NOT_AVAILABLE}</p>
          )}
        </div>
      </section>

      {/* 유치원 — 공식 데이터(유치원알리미) */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>유치원</h3>
        {kindergartens.length === 0 ? (
          <p className={styles.mutedText}>{coordinateUnavailable ? '단지 위치를 확인할 수 없어 유치원 정보를 표시할 수 없어요.' : '2km 이내 등록된 유치원이 없어요.'}</p>
        ) : (
          <div className={styles.cardList}>
            {kindergartens.map((k) => (
              <div className={styles.card} key={k.id}>
                <div className={styles.rowBetween}>
                  <span className={styles.plainText}><b>{k.name}</b></span>
                  {k.establishmentType && <Badge variant="neutral">{k.establishmentType}</Badge>}
                </div>
                <span className={styles.distanceText}>직선거리 약 {k.distanceM}m</span>
                {(k.capacity != null || k.enrollment != null || k.classCount != null) && (
                  <>
                    <button
                      type="button"
                      className={styles.expandToggle}
                      onClick={() => setShowKinderMore((v) => (v === k.id ? null : k.id))}
                      aria-expanded={showKinderMore === k.id}
                    >
                      더보기
                      <ChevronDown size={16} className={showKinderMore === k.id ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
                    </button>
                    {showKinderMore === k.id && (
                      <ul className={styles.plainList}>
                        {k.classCount != null && <li>학급 수 {k.classCount}개</li>}
                        {k.capacity != null && <li>정원 {k.capacity}명</li>}
                        {k.enrollment != null && <li>현원 {k.enrollment}명</li>}
                      </ul>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 고등학교 */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>고등학교</h3>
        {nearbyHigh.length === 0 ? (
          <p className={styles.mutedText}>{coordinateUnavailable ? '단지 위치를 확인할 수 없어 고등학교 정보를 표시할 수 없어요.' : '3km 이내 고등학교 정보를 확인할 수 없어요.'}</p>
        ) : (
          <ul className={styles.plainList}>
            {nearbyHigh.map((s) => (
              <li key={s.name}>
                <SchoolRow school={s} href={buildSchoolHref(s, lawdCd)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 어린이집 — C3A ingestion 대기, "0곳"/"없음" 표현 금지 */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>어린이집</h3>
        <p className={styles.mutedText}>어린이집 정보 준비 중이에요.</p>
      </section>

      {/* 출처 */}
      <div className={styles.provenance}>
        <span>학교: NEIS</span>
        <span>유치원: 유치원알리미</span>
        {zone && <span>통학구역: {zone.sourceName} · 기준일 {zone.sourceDate.replaceAll('-', '.')}</span>}
      </div>
    </div>
  );
}

// APT_DETAIL_MOBILE_UX_REGRESSION_HOTFIX §18/§22 — 좌표가 있으면(href 존재) 학교 row
// 전체를 클릭 가능한 링크로, 없으면 기존과 동일한 정적 텍스트로 렌더한다. 두 경우
// 모두 같은 마크업 구조를 써서 클릭 가능 여부와 무관하게 레이아웃이 동일하다.
function SchoolRow({ school, href }: { school: NearbyKakaoSchool; href: string | null }) {
  const content = (
    <>
      <span>
        <b>{school.name}</b>
        {school.establishmentType && <span className={styles.mutedInline}> · {school.establishmentType}</span>}
        <span className={styles.distanceText}>직선거리 약 {school.distanceM}m</span>
      </span>
      {href && <ChevronRight className={styles.schoolRowChevron} aria-hidden="true" />}
    </>
  );

  if (!href) {
    return <div className={styles.schoolRow}>{content}</div>;
  }

  return (
    <Link href={href} className={styles.schoolRow} aria-label={`${school.name} 학교 정보 보기`}>
      {content}
    </Link>
  );
}

function SummaryChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.summaryChip}>
      {icon}
      <div className={styles.summaryChipText}>
        <span className={styles.summaryChipLabel}>{label}</span>
        <span className={styles.summaryChipValue}>{value}</span>
      </div>
    </div>
  );
}

function ElementaryZoneBody({ zone }: { zone: ElementaryZone }) {
  if (!shouldRenderZoneSchoolList(zone.status)) {
    return <p className={styles.mutedText}>{ZONE_LABEL[zone.status]}</p>;
  }
  // AVAILABLE | SHARED — 학교 목록을 전부 표시(임의 대표학교 선택 금지)
  return (
    <>
      <Badge variant="beta">{ZONE_LABEL[zone.status]}</Badge>
      <ul className={styles.plainList}>
        {zone.schools.map((s) => (
          <li key={s.schoolName}><b>{s.schoolName}</b></li>
        ))}
      </ul>
    </>
  );
}
