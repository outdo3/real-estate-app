import React from 'react';
import KakaoPlaces from './KakaoPlaces';
import BusAccessCard from './BusAccessCard';

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

// [APT DETAIL QA/IA v1 §13] 마트/편의점/약국/어린이집·유치원/공원/병원은 교통과 무관한
// 생활편의 정보라 LivingEnvironmentPanel(주거환경 탭)으로 옮겼다(§UI-C2에서 여기 추가
//됐던 카드들 — 컴포넌트 자체는 그대로 재사용, 렌더 위치만 이동). 이 패널은 이제 순수
// 교통(대중교통/광역교통)만 남는다.

// [UI-C3-3] 기존에는 지하철(SW8)+KTX(키워드)가 "교통" 카드 하나에 합쳐져 있었다. 사용자가
// "일상적으로 타는 대중교통"과 "가끔 이용하는 광역교통"은 판단 맥락이 달라 의미가 섞인다고
// 지적해, IA를 대중교통(지하철·버스)/광역교통(KTX·기차)으로 분리했다. 컴포넌트(KakaoPlaces/
// BusAccessCard)는 그대로 재사용하고 상위 section에서만 묶었다(§3 옵션 A — container만 통합,
// component 자체를 합치지 않음, 회귀 위험이 가장 낮은 선택).
const subSectionTitleStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  margin: '0 0 0.4rem',
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
};

// 3구역의 교통 정보(대중교통/광역교통) — 카카오 로컬 실제 POI 검색 결과만 사용한다(KTX는
// 전용 카테고리 코드가 없어 키워드 검색). 도보/차량 시간은 KakaoPlaces가 실측 직선거리로
// 계산하는 근사치를 그대로 재사용한다.
export default function NeighborhoodInfoPanel({ address, ready }: NeighborhoodInfoPanelProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem' }}>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.7rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🚇 대중교통</h4>
        {ready ? (
          <>
            <div style={{ marginBottom: '0.9rem' }}>
              <div style={subSectionTitleStyle}>🚇 지하철</div>
              {/* keywords를 넘기지 않아 KTX/기차역이 섞이지 않는다 — SW8 카테고리(지하철)만 조회. */}
              <KakaoPlaces address={address} categories={['SW8']} limit={4} />
            </div>
            <div>
              <div style={subSectionTitleStyle}>🚌 버스</div>
              {/* [UI-C3-2/3] Kakao Local은 시내버스 정류장을 검색하지 못해(문서44) 국토교통부
                  TAGO 버스정류소정보(/api/transit/bus-stops)로 조회한다. */}
              <BusAccessCard address={address} />
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        {/* [UI-C3-3] KTX/기차역을 지하철·버스와 분리해 "광역교통"으로 뺐다 — 향후 SRT/공항
            (✈️)도 이 카드 아래 추가할 수 있는 구조. 기존 KTX 필터(폐역 제외, KTX특송퀵서비스
            오탐 제거)는 KakaoPlaces.tsx 쪽 로직이라 그대로 유지된다(회귀 없음). */}
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🚄 광역교통</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={[]} keywords={['KTX', '기차역']} limit={4} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
    </div>
  );
}
