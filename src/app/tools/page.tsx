'use client';

import React, { useState } from 'react';
import Header from '@/components/Header';
import styles from './tools.module.css';

const TABS = [
  { id: 'calc', name: '🧮 세금·대출 계산기' },
  { id: 'safety', name: '📋 안전계약 체크' },
  { id: 'auction', name: '⚖️ 경·공매 비교' },
  { id: 'note', name: '📝 임장 노트' }
];

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState(TABS[0].id);

  // 세금 계산기 상태
  const [houseCount, setHouseCount] = useState('1주택');
  const [price, setPrice] = useState('1000000000'); // 10억
  const [income, setIncome] = useState('60000000'); // 6천만

  // 계산 로직 (간단한 모의 로직)
  const numericPrice = parseInt(price) || 0;
  const numericIncome = parseInt(income) || 0;
  
  const taxRate = houseCount === '1주택' ? 0.033 : (houseCount === '2주택' ? 0.08 : 0.12);
  const taxAmount = numericPrice * taxRate;
  
  const dsrLimit = numericIncome * 8; // 연소득의 대략 8배 대출 한도로 시뮬레이션

  const formatMoney = (num: number) => {
    if (num >= 100000000) {
      const eok = Math.floor(num / 100000000);
      const man = Math.floor((num % 100000000) / 10000);
      return man > 0 ? `${eok}억 ${man.toLocaleString()}만원` : `${eok}억원`;
    }
    return `${(num / 10000).toLocaleString()}만원`;
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다.');
  };

  const renderToolContent = () => {
    switch (activeTab) {
      case 'calc':
        return (
          <div className={styles.toolsGrid}>
            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>💰 스마트 취득세 계산기</h2>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>보유 주택 수</label>
                  <select className={styles.formSelect} value={houseCount} onChange={e => setHouseCount(e.target.value)}>
                    <option value="무주택">무주택 (첫 매수)</option>
                    <option value="1주택">1주택 (갈아타기)</option>
                    <option value="2주택">2주택</option>
                    <option value="3주택 이상">3주택 이상</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>취득 가액 (원)</label>
                  <input type="number" className={styles.formInput} value={price} onChange={e => setPrice(e.target.value)} />
                </div>
                <div className={styles.resultBox}>
                  <p className={styles.resultText}>👉 예상 취득세: {formatMoney(taxAmount)}</p>
                  <p className={styles.resultSubtext}>적용 세율: {(taxRate * 100).toFixed(1)}% (지방교육세 등 포함 추정치)</p>
                </div>
              </div>
            </div>

            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>🏦 DSR 대출 가능 한도 추정</h2>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>연소득 (원)</label>
                  <input type="number" className={styles.formInput} value={income} onChange={e => setIncome(e.target.value)} />
                </div>
                <div className={styles.resultBox}>
                  <p className={styles.resultText}>👉 예상 대출 한도: 약 {formatMoney(dsrLimit)}</p>
                  <p className={styles.resultSubtext}>DSR 40% 기준, 다른 부채가 없을 경우의 단순 시뮬레이션입니다.</p>
                </div>
              </div>
            </div>
          </div>
        );
      
      case 'safety':
        return (
          <div className={styles.toolsGrid}>
            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>🛡️ 전세사기 예방 / 필수 특약</h2>
              </div>
              <div className={styles.cardBody}>
                <ul className={styles.checkList}>
                  <li className={styles.checkItem}>
                    <div>
                      <div className={styles.checkItemTitle}>대출 불승인 시 계약금 반환</div>
                      <div className={styles.checkItemDesc}>&quot;임차인의 전세자금대출이 목적물의 하자로 인하여 불가할 경우, 임대인은 계약금을 즉시 반환한다.&quot;</div>
                    </div>
                    <button className={styles.copyBtn} onClick={() => handleCopy("임차인의 전세자금대출이 목적물의 하자로 인하여 불가할 경우, 임대인은 계약금을 즉시 반환한다.")}>복사</button>
                  </li>
                  <li className={styles.checkItem}>
                    <div>
                      <div className={styles.checkItemTitle}>임대인 체납 사실 확인</div>
                      <div className={styles.checkItemDesc}>&quot;임대인은 잔금일 전까지 국세/지방세 완납 증명서를 교부하며, 미납금 발생 시 계약을 해제할 수 있다.&quot;</div>
                    </div>
                    <button className={styles.copyBtn} onClick={() => handleCopy("임대인은 잔금일 전까지 국세/지방세 완납 증명서를 교부하며, 미납금 발생 시 계약을 해제할 수 있다.")}>복사</button>
                  </li>
                  <li className={styles.checkItem}>
                    <div>
                      <div className={styles.checkItemTitle}>근저당권 설정 금지 특약</div>
                      <div className={styles.checkItemDesc}>&quot;임대인은 계약 체결일로부터 잔금일 익일까지 목적물에 어떠한 근저당이나 제한물권을 설정하지 않는다.&quot;</div>
                    </div>
                    <button className={styles.copyBtn} onClick={() => handleCopy("임대인은 계약 체결일로부터 잔금일 익일까지 목적물에 어떠한 근저당이나 제한물권을 설정하지 않는다.")}>복사</button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        );

      case 'auction':
        return (
          <div className={styles.toolsGrid}>
            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>⚖️ 지역 경매 및 온비드 공매 물건</h2>
              </div>
              <div className={styles.cardBody}>
                <ul className={styles.checkList}>
                  <li className={styles.checkItem}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span className={styles.checkItemTitle}>힐스테이트이진베이시티 103동 15층</span>
                        <span className={styles.badgeDanger}>유찰 2회</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>감정가: 12억 5,000만</span>
                        <span style={{ fontWeight: 800, color: 'var(--primary-color)' }}>최저가: 8억 7,500만</span>
                      </div>
                      <div className={styles.resultBox} style={{ padding: '0.75rem', marginTop: '0.75rem' }}>
                        최근 실거래가(11.5억) 대비 <strong style={{ color: 'var(--primary-color)' }}>2.75억 저렴</strong>
                      </div>
                    </div>
                  </li>
                  <li className={styles.checkItem}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span className={styles.checkItemTitle}>대신푸르지오 105동 4층</span>
                        <span className={styles.badgeWarning}>유찰 1회</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>감정가: 8억 5,000만</span>
                        <span style={{ fontWeight: 800, color: 'var(--primary-color)' }}>최저가: 6억 8,000만</span>
                      </div>
                      <div className={styles.resultBox} style={{ padding: '0.75rem', marginTop: '0.75rem' }}>
                        최근 실거래가(7.2억) 대비 <strong style={{ color: 'var(--primary-color)' }}>0.4억 저렴</strong>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        );

      case 'note':
        return (
          <div className={styles.toolsGrid}>
            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>📝 단지 현장 임장 체크카드</h2>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>단지명</label>
                  <input type="text" className={styles.formInput} placeholder="예) 은마아파트" />
                </div>
                
                <div style={{ margin: '1.5rem 0' }}>
                  <div className={styles.ratingRow}>
                    <span className={styles.ratingLabel}>주차 편의성 (지하주차장 엘리베이터 유무)</span>
                    <div className={styles.stars}><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span>★</span></div>
                  </div>
                  <div className={styles.ratingRow}>
                    <span className={styles.ratingLabel}>단지 쾌적성 (조경 및 일조량)</span>
                    <div className={styles.stars}><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span>★</span><span>★</span></div>
                  </div>
                  <div className={styles.ratingRow}>
                    <span className={styles.ratingLabel}>학군 및 학원가 접근성</span>
                    <div className={styles.stars}><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span><span className={styles.filled}>★</span></div>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>자유 메모 (중개사 코멘트 등)</label>
                  <textarea className={styles.textarea} placeholder="매도자 우위 시장인지, 급매가 있는지 기록해보세요..."></textarea>
                </div>
                
                <button style={{ width: '100%', padding: '1rem', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
                  저장하기
                </button>
              </div>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div className={styles.main}>
      <Header />
      <div className="container">
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <h1 className={styles.title}>🛠️ 실전 부동산 도구</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>현장에서 바로 꺼내쓰는 실무 최적화 도구 모음</p>
          </div>
          <div className={styles.tabsContainer} style={{ marginTop: '1.5rem' }}>
            {TABS.map(tab => (
              <button 
                key={tab.id}
                className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.name}
              </button>
            ))}
          </div>
        </div>
        
        {/* 모바일에서는 탭 선택에 따라 하나만 보이고, PC에서는 전체를 다 뿌려줄 수도 있지만 여기서는 통일감을 위해 탭 형태로 동작하게 설계 */}
        {renderToolContent()}
      </div>
    </div>
  );
}
