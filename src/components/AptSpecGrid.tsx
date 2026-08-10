import React from 'react';
import Link from 'next/link';
import styles from './AptSpecGrid.module.css';

interface AptSpecGridProps {
  aptName: string;
  address: string;
  aptInfo: Record<string, string> | null;
  buildYear: string | null; // trades[0].buildYear 등 실거래 기반 준공연도(문자열 "YYYY")
}

interface SpecCell {
  label: string;
  value: string | null;
}

// 호갱노노 스타일: 세대수/준공년월/용적률/건폐율/주차대수를 균등한 5칸 그리드로 보여준다.
// 값이 없으면 "정보 준비중"과 함께 컴팩트한 [제보/수정] 버튼을 노출해 화면이 비어
// 보이거나 깨지지 않게 하고, 추정치를 만들어내지 않는다.
export default function AptSpecGrid({ aptName, address, aptInfo, buildYear }: AptSpecGridProps) {
  const currentYear = new Date().getFullYear();
  const parsedBuildYear = buildYear ? parseInt(buildYear, 10) : NaN;
  const age = !isNaN(parsedBuildYear) && parsedBuildYear > 1900 ? currentYear - parsedBuildYear : null;

  const households = aptInfo?.['세대수']
    ? (aptInfo['세대수'].includes('세대') ? aptInfo['세대수'] : `${aptInfo['세대수']}세대`)
    : null;

  const cells: SpecCell[] = [
    { label: '세대수', value: households },
    { label: '준공년월', value: parsedBuildYear ? `${parsedBuildYear}년${age !== null ? ` · ${age}년차` : ''}` : null },
    { label: '용적률', value: aptInfo?.['용적률'] || null },
    { label: '건폐율', value: aptInfo?.['건폐율'] || null },
    { label: '주차대수', value: aptInfo?.['총주차대수'] || null },
  ];

  return (
    <div>
      {address && (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          📍 {address}
        </div>
      )}
      <div className={styles.grid}>
        {cells.map((cell) => (
          <div key={cell.label} className={styles.cell}>
            <span className={styles.cellLabel}>{cell.label}</span>
            {cell.value ? (
              <span className={styles.cellValue}>{cell.value}</span>
            ) : (
              <>
                <span className={styles.cellMissing}>정보 준비중</span>
                <Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`} className={styles.reportLink}>
                  제보/수정
                </Link>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
