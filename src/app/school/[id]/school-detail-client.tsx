'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import styles from './school-detail.module.css';

type SchoolLevel = '초' | '중' | '고' | null;

// MapViewer.tsx의 classifySchoolLevel과 동일한 방식 — 실제 학교명 문자열을 파싱만
// 할 뿐 지어낸 값이 아니다.
const classifySchoolLevel = (name: string): SchoolLevel => {
  if (name.includes('초등학교')) return '초';
  if (name.includes('고등학교')) return '고';
  if (name.includes('중학교')) return '중';
  return null;
};

const GRADE_ROWS_ELEM = ['1학년', '2학년', '3학년', '4학년', '5학년', '6학년'];
const SPECIAL_HIGH_ROWS = [
  { label: '과학고 진학', icon: '🔬' },
  { label: '외고·국제고 진학', icon: '🌐' },
  { label: '자사고 진학', icon: '🏫' },
];

interface NearbyApartment {
  id: number;
  name: string;
  price: string;
  walkTime: string;
  distance: number;
  buildYear: number | null;
}

type AptSort = 'distance' | 'newest';

export default function SchoolDetailClient() {
  const router = useRouter();
  const [schoolName, setSchoolName] = useState<string>('');
  const [level, setLevel] = useState<SchoolLevel>(null);
  const [apartments, setApartments] = useState<NearbyApartment[] | null>(null);
  const [aptLoading, setAptLoading] = useState(true);
  const [aptSort, setAptSort] = useState<AptSort>('newest');
  const [lawdCdState, setLawdCdState] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = params.get('name') || '';
    const lat = params.get('lat') || '';
    const lng = params.get('lng') || '';
    const lawdCd = params.get('lawdCd') || '';
    setSchoolName(name);
    setLevel(classifySchoolLevel(name));
    setLawdCdState(lawdCd);

    if (!name) {
      setAptLoading(false);
      return;
    }
    const url = `/api/school/apartments?schoolName=${encodeURIComponent(name)}${lat ? `&lat=${lat}` : ''}${lng ? `&lng=${lng}` : ''}${lawdCd ? `&lawdCd=${lawdCd}` : ''}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setApartments(data.data.filter((a: NearbyApartment) => a.id !== -1));
        }
      })
      .catch(() => setApartments(null))
      .finally(() => setAptLoading(false));
  }, []);

  const sortedApartments = apartments
    ? [...apartments].sort((a, b) =>
        aptSort === 'newest' ? (b.buildYear || 0) - (a.buildYear || 0) : a.distance - b.distance
      )
    : null;

  return (
    <div className={styles.main}>
      <Header hideLogo pageTitle={schoolName || '학교 정보'} pageTitleLarge pageTitleAlign="left" />

      <div className="container">
        {level === '초' && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>📈 학년별 학생 수 추이</h2>
            <div className={styles.tableWrapper}>
              <table className={styles.gradeTable}>
                <thead>
                  <tr>
                    <th>학년</th>
                    <th>학생 수</th>
                    <th>학급당 인원</th>
                  </tr>
                </thead>
                <tbody>
                  {GRADE_ROWS_ELEM.map((grade) => (
                    <tr key={grade}>
                      <td className={styles.gradeCell}>{grade}</td>
                      <td className={styles.dataPending}>데이터 준비 중</td>
                      <td className={styles.dataPending}>데이터 준비 중</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(level === '중' || level === '고') && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>🎓 특목고·자사고 진학률</h2>
            <div className={styles.specialGrid}>
              {SPECIAL_HIGH_ROWS.map((row) => (
                <div key={row.label} className={styles.specialCard}>
                  <div className={styles.specialIcon}>{row.icon}</div>
                  <div className={styles.specialLabel}>{row.label}</div>
                  <div className={styles.specialValue}>데이터 준비 중</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!level && (
          <div className={styles.introCard}>
            <p className={styles.introText}>학교 종류를 확인하지 못했습니다. 인근 학교 목록에서 다시 진입해주세요.</p>
          </div>
        )}

        <section className={styles.section}>
          <div className={styles.aptSectionHeader}>
            <h2 className={styles.sectionTitle}>📌 인근 아파트 단지</h2>
            <div className={styles.aptSortTabs}>
              <button
                type="button"
                className={`${styles.aptSortChip} ${aptSort === 'newest' ? styles.aptSortChipActive : ''}`}
                onClick={() => setAptSort('newest')}
              >
                신축순
              </button>
              <button
                type="button"
                className={`${styles.aptSortChip} ${aptSort === 'distance' ? styles.aptSortChipActive : ''}`}
                onClick={() => setAptSort('distance')}
              >
                거리순
              </button>
            </div>
          </div>
          {aptLoading ? (
            <div className={styles.dataPending} style={{ padding: '1rem 0' }}>
              불러오는 중...
            </div>
          ) : !sortedApartments || sortedApartments.length === 0 ? (
            <div className={styles.introCard}>
              <p className={styles.introText}>반경 1.5km 이내 아파트 정보를 찾지 못했습니다.</p>
            </div>
          ) : (
            <div className={styles.aptList}>
              {sortedApartments.map((apt) => (
                <div key={apt.id} className={styles.aptRow}>
                  <div className={styles.aptRowInfo}>
                    <div className={styles.aptRowName}>
                      {apt.name} {apt.buildYear && <span className={styles.aptRowYear}>{apt.buildYear}년</span>}
                    </div>
                    <div className={styles.aptRowMeta}>
                      {apt.walkTime} · {apt.price}
                    </div>
                  </div>
                  <div className={styles.aptRowBtns}>
                    <button
                      type="button"
                      className={styles.aptRowBtn}
                      onClick={() => router.push(`/apt/${encodeURIComponent(apt.name)}${lawdCdState ? `?lawdCd=${lawdCdState}` : ''}`)}
                    >
                      실거래
                    </button>
                    {/* 학교/동네 전체가 아니라 이 단지명 자체로 정확히 검색되도록 단지명만
                        파라미터로 넘긴다(Deep Linking). */}
                    <a
                      href={`https://m.land.naver.com/search/result/${encodeURIComponent(apt.name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.aptRowBtn}
                    >
                      매물
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
