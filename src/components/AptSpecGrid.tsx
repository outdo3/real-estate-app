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
// 값이 없으면 컴팩트한 [제보/수정] 버튼을 함께 노출해 화면이 비어 보이거나 깨지지
// 않게 하고, 추정치를 만들어내지 않는다.
//
// [B2-1] 문구를 "정보 준비중" → "정보 없음"으로 변경했다. 용적률/건폐율/주차대수의
// source(건축물대장 총괄표제부)는 "여러 동으로 이뤄진 아파트 단지" 대상 개념이라,
// 소규모/단독동 건물은 애초에 이 등록 자체가 없는 경우가 실측으로 다수 확인됐다(부산
// cache-miss 표본 6곳 전부 외부 API totalCount 0). 그런 건물은 "준비 중"이 아니라
// 자동으로는 앞으로도 채워지지 않는 상태이므로, "곧 채워질 것"으로 오해할 수 있는
// 문구 대신 있는 그대로("정보 없음")를 보여주고 [제보/수정](사용자 제보) 경로로만
// 채워질 수 있음을 암묵적으로 전달한다.
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
                <span className={styles.cellMissing}>정보 없음</span>
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
