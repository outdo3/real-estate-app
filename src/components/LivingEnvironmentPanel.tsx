import React from 'react';
import KakaoPlaces from './KakaoPlaces';

interface LivingEnvironmentPanelProps {
  address: string;
  ready: boolean; // 단지 위치(address) 확정 전에는 검색을 시작하지 않는다
}

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.1rem',
  borderRadius: '10px',
  background: '#f8fafc',
  border: '1px solid var(--border-color)',
};

// [APT DETAIL QA/IA v1 §11/§12] 세대당 주차대수는 상단 AptSpecGrid("주차대수")에 이미
// 핵심 숫자로 표시된다 — 여기서 같은 값을 게이지로 한 번 더 보여주던 카드를
// 제거했다(중복 제거, 데이터 자체를 없앤 게 아니라 표시 위치만 상단으로 일원화).

const NEW_CATEGORY_LIMIT = 2;

// 쿠팡 로켓배송/SSG 새벽배송은 국내 대부분 아파트 단지에서 통상적으로 이용 가능한 서비스라서
// 이 단지에 한정된 검증된 사실이 아니라 일반적인 생활 인프라 안내로 표시한다(단지별 확인 필요
// 라는 문구로 특정 단지에 대한 확정적 주장이 되지 않도록 함).
function DeliveryBadges() {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>📦 배송 생활권</div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem', borderRadius: '999px', background: '#fff1f2', color: '#e11d48', fontWeight: 700 }}>🚚 쿠팡 로켓배송</span>
        <span style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem', borderRadius: '999px', background: '#fefce8', color: '#ca8a04', fontWeight: 700 }}>🌙 SSG 새벽배송</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>국내 대부분 아파트 단지에서 이용 가능 (단지별로 다를 수 있음)</div>
    </div>
  );
}

// [APT DETAIL QA/IA v1 §13/§14] 기존에는 이 카드들(마트/편의점/약국/어린이집·유치원/
// 공원/병원)이 전부 "교통" 탭(NeighborhoodInfoPanel)에 있었다 — 교통과 무관한 생활편의
// 정보라 사용자 지적대로 "주거환경"으로 옮긴다. 컴포넌트(KakaoPlaces)는 그대로
// 재사용하고 어느 탭에서 렌더링되는지만 바꿨다(회귀 위험 최소화, 로직 변경 없음).
// 기존에 "병원·공원" 한 카드로 묶여 있던 걸 여기서는 의료/녹지 성격이 달라 분리했다.
export default function LivingEnvironmentPanel({ address, ready }: LivingEnvironmentPanelProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
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
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🌳 공원</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={[]} keywords={['공원']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      <div style={cardStyle}>
        <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>🏥 병원</h4>
        {ready ? (
          <KakaoPlaces address={address} categories={['HP8']} limit={NEW_CATEGORY_LIMIT} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>단지 위치 확인 후 표시됩니다.</p>
        )}
      </div>
      {/* [STEP50 V1 CLEANUP] 계절별 평균 관리비는 공개 데이터 소스가 없어(관리비는 단지
          관리사무소별로 다름) 항상 "데이터 준비 중입니다"만 노출했다 — 실데이터가 있는
          항목만 남기고 이 placeholder는 화면에서 제거했다. */}
      <DeliveryBadges />
    </div>
  );
}
