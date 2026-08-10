import React from 'react';
import KakaoPlaces from './KakaoPlaces';

interface SchoolDistrictPanelProps {
  address: string;
  ready: boolean;
}

// 초등학교 학년별 학생 수 추이, 중/고교 특목고 진학률은 실제 데이터 소스가 없다 — 이 앱의
// 기존 학군 기능(src/app/api/school/route.ts)이 쓰는 값은 학교명 해시로 만들어낸 시뮬레이션
// 수치이지, 진짜 나이스(NEIS) 학년별 통계나 진학률이 아니다(코드 확인 완료). 단지 상세페이지처럼
// 사용자가 실제 의사결정에 쓸 화면에 그 가짜 수치를 새로 노출시키지 않고, 대신 실제 카카오
// POI 기반의 근접 학교 목록만 보여주고 나머지는 정직하게 "준비 중"으로 표시한다.
export default function SchoolDistrictPanel({ address, ready }: SchoolDistrictPanelProps) {
  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏫 인근 학교</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['SC4']} limit={5} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div style={{ padding: '1rem', borderRadius: '10px', background: '#f8fafc', border: '1px dashed var(--border-color)' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.9rem' }}>📈 초등학교 학년별 학생 수 추이</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>데이터 준비 중입니다.</div>
        </div>
        <div style={{ padding: '1rem', borderRadius: '10px', background: '#f8fafc', border: '1px dashed var(--border-color)' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.35rem', fontSize: '0.9rem' }}>🎓 중/고교 특목고 진학률</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>데이터 준비 중입니다.</div>
        </div>
      </div>
    </div>
  );
}
