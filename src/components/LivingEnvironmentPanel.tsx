import React from 'react';

interface LivingEnvironmentPanelProps {
  aptInfo: Record<string, string> | null;
}

const cardStyle: React.CSSProperties = {
  padding: '1rem 1.1rem',
  borderRadius: '10px',
  background: '#f8fafc',
  border: '1px solid var(--border-color)',
};

// "{count}대 (세대당 {ratio}대)" 형식으로 이미 계산되어 오는 실제 총주차대수 문자열에서
// 세대당 주차대수만 뽑아 게이지로 시각화한다 — 새 데이터를 만드는 게 아니라 기존 aptInfo
// 값을 파싱만 하는 것이라 추정치를 추가하지 않는다.
const parseParkingRatio = (raw: string | null): number | null => {
  if (!raw) return null;
  const match = raw.match(/세대당\s*([\d.]+)\s*대/);
  if (!match) return null;
  const ratio = parseFloat(match[1]);
  return isNaN(ratio) ? null : ratio;
};

function ParkingGauge({ aptInfo }: { aptInfo: Record<string, string> | null }) {
  const parkingRaw = aptInfo?.['총주차대수'] || null;
  const ratio = parseParkingRatio(parkingRaw);

  if (!parkingRaw) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>🅿️ 주차공간</div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>정보 없음</div>
      </div>
    );
  }

  // 세대당 1.5대 이상이면 게이지를 꽉 채운 것으로 취급(그 이상은 여유가 더 있다는 의미이므로
  // 굳이 막대를 넘치게 그리지 않음). 세대당 대수 자체가 없는 응답(전체 대수만 있는 경우)이면
  // 게이지 없이 원본 텍스트만 보여준다.
  const capped = ratio !== null ? Math.min(ratio / 1.5, 1) : null;
  const color = ratio === null ? 'var(--text-muted)' : ratio < 1 ? '#ef4444' : ratio < 1.3 ? '#f59e0b' : '#10b981';

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>🅿️ 주차공간 (세대당)</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{parkingRaw}</div>
      {capped !== null && (
        <div style={{ width: '100%', height: '8px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
          <div style={{ width: `${capped * 100}%`, height: '100%', background: color, borderRadius: '999px' }} />
        </div>
      )}
    </div>
  );
}

// 계절별 관리비를 실제로 산출할 데이터 소스가 없다(관리비는 단지 관리사무소별로 다르고
// 공개 API가 존재하지 않음) — 숫자를 지어내는 대신 정직하게 준비 중 상태를 보여준다.
function MaintenanceFeePlaceholder() {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>💰 계절별 평균 관리비</div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>데이터 준비 중입니다.</div>
    </div>
  );
}

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

export default function LivingEnvironmentPanel({ aptInfo }: LivingEnvironmentPanelProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
      <ParkingGauge aptInfo={aptInfo} />
      <MaintenanceFeePlaceholder />
      <DeliveryBadges />
    </div>
  );
}
