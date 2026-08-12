import React from 'react';
import KakaoPlaces from './KakaoPlaces';

interface SchoolDistrictPanelProps {
  address: string;
  ready: boolean;
  lawdCd?: string;
}

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.1rem',
  borderRadius: '10px',
  background: '#f8fafc',
  border: '1px solid var(--border-color)',
};

// 초등학교 학년별 학생 수 추이, 중/고교 특목고 진학률은 실제 데이터 소스가 없다(NEIS
// schoolInfo API에 이 값이 없고, 이 앱에 다른 실제 소스도 없다 — STEP 1.5-A에서
// src/app/api/school/route.ts, src/app/api/school/stats/route.ts의 학교명 해시 기반
// 가짜 수치 생성 로직을 제거하고 동일하게 "데이터 준비 중"으로 통일했다). 단지 상세페이지처럼
// 사용자가 실제 의사결정에 쓸 화면에 근거 없는 수치를 노출시키지 않고, 대신 실제 카카오
// POI 기반의 근접 학교 목록만 보여주고 나머지는 정직하게 "준비 중"으로 표시한다.
export default function SchoolDistrictPanel({ address, ready, lawdCd }: SchoolDistrictPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏫 인근 학교</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['SC4']} limit={5} lawdCd={lawdCd} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem' }}>
        <div style={{ ...cardStyle, border: '1px dashed var(--border-color)' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.88rem' }}>📈 초등학교 학년별 학생 수 추이</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>데이터 준비 중입니다.</div>
        </div>
        <div style={{ ...cardStyle, border: '1px dashed var(--border-color)' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.88rem' }}>🎓 중/고교 특목고 진학률</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>데이터 준비 중입니다.</div>
        </div>
      </div>
    </div>
  );
}
