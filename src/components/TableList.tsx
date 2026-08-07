import React from 'react';
import Link from 'next/link';
import styles from '@/app/page.module.css';
import { RankData } from './RankCard';

import { useRouter } from 'next/navigation';

interface TableListProps {
  title: string;
  titleHighlight: string;
  highlightColor: string;
  date: string;
  data: RankData[];
}

const TableList: React.FC<TableListProps> = ({ title, titleHighlight, highlightColor, date, data }) => {
  const router = useRouter();

  const handleRowClick = (item: RankData) => {
    const idStr = String(item.id || '');
    const parts = idStr.split('-');
    const type = parts.length > 1 ? parts[0] : 'apt';
    const lawdCd = parts.length > 1 ? parts[1] : '11680';
    router.push(`/apt/${encodeURIComponent(item.name)}?type=${type}&lawdCd=${lawdCd}`);
  };

  const getBadgeStyle = (label: string) => {
    if (label.includes('신고가') || label.includes('최고가')) {
      return { background: '#fee2e2', color: '#dc2626' };
    }
    if (label.includes('직거래')) {
      return { background: '#fef3c7', color: '#d97706' };
    }
    return { background: '#f1f5f9', color: '#475569' };
  };

  return (
    <section className={styles.section} style={{ padding: '0 0 1.5rem 0' }}>
      <div className={styles.tableContainer}>
        <table className={styles.dataTable} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {data.map((item) => {
              const badgeStyle = getBadgeStyle(item.typeLabel);
              return (
                <tr 
                  key={item.id} 
                  className={styles.tableRow} 
                  onClick={() => handleRowClick(item)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <td style={{ padding: '1.25rem 1rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{item.name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ 
                          padding: '2px 8px', 
                          borderRadius: '999px', 
                          fontSize: '0.75rem', 
                          fontWeight: 600,
                          ...badgeStyle
                        }}>
                          {item.typeLabel}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{item.info}</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '1rem' }}>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary-color)' }}>{item.price}</span>
                      <span style={{ color: '#94a3b8' }}>&gt;</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>데이터가 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default TableList;
