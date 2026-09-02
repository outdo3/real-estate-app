'use client';

import React, { useState } from 'react';
import Header from '@/components/Header';
import Empty from '@/components/ui/Empty';
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
                <h2 className={styles.cardTitle}>💰 취득세 간편 추정</h2>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>보유 주택 수</label>
                  <select className={styles.formSelect} value={houseCount} onChange={e => setHouseCount(e.target.value)}>
                    <option value="1주택">1주택 (갈아타기)</option>
                    <option value="2주택">2주택</option>
                    <option value="3주택 이상">3주택 이상</option>
                  </select>
                  <p className={styles.resultSubtext} style={{ marginTop: '0.5rem' }}>
                    생애최초(무주택) 감면 조건은 아직 정확히 반영하지 못해 옵션에서 제외했습니다.
                  </p>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>취득 가액 (원)</label>
                  <input type="number" className={styles.formInput} value={price} onChange={e => setPrice(e.target.value)} />
                </div>
                <div className={styles.resultBox}>
                  <p className={styles.resultText}>👉 현재 입력조건 기준 예상 취득세: {formatMoney(taxAmount)}</p>
                  <p className={styles.resultSubtext}>적용 세율: {(taxRate * 100).toFixed(1)}% (지방교육세 등 포함 간편 추정치)</p>
                </div>
                <div className={styles.disclosurePanel} role="note" aria-label="취득세 간편 추정 한계 안내">
                  ⓘ 이 계산은 <strong>보유 주택 수와 취득가액</strong>만 반영한 간편 추정입니다.
                  지역, 면적, 취득 형태(매매·증여·상속 등), 생애최초 감면·다주택 중과 등
                  개인별 조건은 반영되지 않아 실제 세액과 다를 수 있습니다.
                </div>
              </div>
            </div>

            <div className={styles.toolCard}>
              <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>🏦 대출여력 간편추정</h2>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>연소득 (원)</label>
                  <input type="number" className={styles.formInput} value={income} onChange={e => setIncome(e.target.value)} />
                </div>
                <div className={styles.resultBox}>
                  <p className={styles.resultText}>👉 간편 추정액: 약 {formatMoney(dsrLimit)}</p>
                  <p className={styles.resultSubtext}>연소득을 기준으로 단순 추정한 참고 값입니다.</p>
                </div>
                <div className={styles.disclosurePanel} role="note" aria-label="대출여력 간편추정 한계 안내">
                  ⓘ 이 값은 <strong>실제 DSR 계산이 아닙니다.</strong> 실제 DSR은 기존 대출,
                  금리, 상환기간, 상환방식 등 여러 조건을 함께 반영하며, 이 값은 금융기관의
                  승인 가능 금액이 아닙니다.
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
                {/* LAUNCH_TRUST_BLOCKERS_V1 — 이전에는 실제 경매 API 연동 없이 특정
                    단지/동/층/감정가를 지어낸 예시 매물을 실제 매물처럼 보여줬다.
                    데이터 소스가 없는 상태이므로, /map의 경·공매 레이어와 동일하게
                    정직한 "준비 중" 상태로 대체한다(가짜 데이터 > 데이터 없음 금지). */}
                <Empty
                  variant="notReady"
                  title="경매·공매 매물 데이터는 아직 연동 준비 중입니다."
                  description="실제 경매/온비드 공매 데이터가 연동될 때까지 임의의 예시 매물을 보여드리지 않습니다."
                />
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
      <Header pageTitle="부동산 도구" />
      <div className="container">
        <div className={styles.header}>
          <div className={styles.headerTop}>
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
