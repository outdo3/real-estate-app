import React from 'react';
import KakaoPlaces from './KakaoPlaces';

interface NeighborhoodInfoPanelProps {
  address: string;
  ready: boolean; // 단지 위치(address) 확정 전에는 검색을 시작하지 않는다
}

// 3구역의 교통/병원·공원 정보 — 카카오 로컬 실제 POI 검색 결과만 사용한다(KTX는 전용 카테고리
// 코드가 없어 키워드 검색으로, 공원도 마찬가지). 도보/차량 시간은 KakaoPlaces가 실측 직선거리로
// 계산하는 근사치를 그대로 재사용한다.
export default function NeighborhoodInfoPanel({ address, ready }: NeighborhoodInfoPanelProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
      <div>
        <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🚇 교통 (지하철·KTX)</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['SW8']} keywords={['KTX', '기차역']} limit={4} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div>
        <h4 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏥 병원·공원</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['HP8']} keywords={['공원']} limit={4} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
    </div>
  );
}
