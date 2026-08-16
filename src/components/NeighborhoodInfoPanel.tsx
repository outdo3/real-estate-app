import React from 'react';
import KakaoPlaces from './KakaoPlaces';

interface NeighborhoodInfoPanelProps {
  address: string;
  ready: boolean; // 단지 위치(address) 확정 전에는 검색을 시작하지 않는다
}

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.1rem',
  borderRadius: '10px',
  background: '#f8fafc',
  border: '1px solid var(--border-color)',
};

// [UI-C2] 생활편의를 병원·공원 2종에서 대형마트/편의점/약국/어린이집·유치원까지
// 6종으로 확장했다. 4개 신규 카테고리는 전부 카카오 공식 category_group_code가
// 있어(키워드 검색이 아님) 오탐 필터가 필요 없다 — 부산 5개 표본단지(도심/주거/
// 대형마트 인접/소규모/온천동 외곽)로 실측 확인, 코드 근거는 KakaoPlaces.tsx 상단
// 주석 참고. 기존 교통(SW8+KTX 키워드)·병원·공원 카드는 그대로 두고(회귀 없음),
// 같은 카드 패턴을 반복해 새 카드만 추가했다 — 새 tab/공통 컴포넌트를 만들지
// 않았다.
const NEW_CATEGORY_LIMIT = 2;

// 3구역의 교통/병원·공원 정보 — 카카오 로컬 실제 POI 검색 결과만 사용한다(KTX는 전용 카테고리
// 코드가 없어 키워드 검색으로, 공원도 마찬가지). 도보/차량 시간은 KakaoPlaces가 실측 직선거리로
// 계산하는 근사치를 그대로 재사용한다.
export default function NeighborhoodInfoPanel({ address, ready }: NeighborhoodInfoPanelProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem' }}>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🚇 교통 (지하철·KTX)</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['SW8']} keywords={['KTX', '기차역']} limit={4} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏥 병원·공원</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['HP8']} keywords={['공원']} limit={4} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🛒 대형마트</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['MT1']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏪 편의점</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['CS2']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>💊 약국</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['PM9']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        {/* Kakao 공식 category_group_name 자체가 "어린이집,유치원"이라 라벨도 두
            시설을 함께 지칭한다 — 실제로는 어린이집/유치원이 섞여서 나온다. */}
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🧸 어린이집·유치원</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['PS3']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
    </div>
  );
}
