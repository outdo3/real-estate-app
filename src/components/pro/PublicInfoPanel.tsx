'use client';

// REALTOR_PRO_MVP_V1 — 매물 상세의 공공 단지·실거래 패널. 상태를 구분해 표시한다:
// 미연결 / 식별 불가 / 지역 준비 중 / 실거래 없음(검증된 0건) / 불러올 수 없음 — 실패를 "거래 없음"으로 바꾸지 않는다.

import type { PublicAptInfo } from '@/lib/pro/types';
import type { Wire } from './api';
import { formatDate, formatM2, formatManwon } from './format';
import s from './pro.module.css';

export default function PublicInfoPanel({ aptSeq, info }: { aptSeq: string | null; info: Wire<PublicAptInfo> | null }) {
  if (!aptSeq) {
    return <p className={s.muted}>단지 정보 미연결 — 검색 결과에서 단지를 고르면 공공 단지 정보와 실거래를 함께 볼 수 있습니다.</p>;
  }
  if (!info) {
    return <p className={s.muted}>공공 단지 정보를 확인할 수 없습니다. 실거래는 표시하지 않습니다.</p>;
  }
  const facts = [
    info.umdName,
    info.buildYear ? `${info.buildYear}년 준공` : null,
    info.totalHouseholds ? `${info.totalHouseholds.toLocaleString('ko-KR')}세대` : null,
    info.parkingCount ? `주차 ${info.parkingCount.toLocaleString('ko-KR')}대` : null,
  ].filter(Boolean);

  const state = !info.detailOpen ? 'REGION_NOT_OPEN' : info.tradeState;
  let message: string | null = null;
  if (state === 'REGION_NOT_OPEN') message = '이 지역 공공 실거래는 준비 중입니다.';
  else if (state === 'VERIFIED_ZERO') message = '최근 기간 실거래 없음';
  else if (state === 'UNAVAILABLE') message = '공공 실거래를 지금 불러올 수 없습니다.';
  else if (state === 'UNRESOLVED_IDENTITY') message = '단지 식별이 확인되지 않아 실거래를 표시하지 않습니다.';

  return (
    <div>
      <p className={s.cardTitle}>{info.name}</p>
      <p className={s.meta}>{facts.length ? facts.map((f) => <span key={String(f)}>{f}</span>) : <span>기본 정보 없음</span>}</p>
      {info.roadAddress ? <p className={s.muted} style={{ margin: '4px 0 0' }}>{info.roadAddress}</p> : null}
      <hr className={s.divider} style={{ margin: '12px 0' }} />
      <p className={s.label} style={{ margin: '0 0 6px' }}>
        최근 실거래(같은 단지)
      </p>
      {message ? (
        <p className={s.empty}>{message}</p>
      ) : info.recentTrades.length ? (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">계약일</th>
                <th scope="col">전용</th>
                <th scope="col">층</th>
                <th scope="col">거래가</th>
              </tr>
            </thead>
            <tbody>
              {info.recentTrades.map((t, i) => (
                <tr key={`${t.dealDate}-${i}`}>
                  <td>{t.dealDate}</td>
                  <td>{formatM2(t.exclusiveAreaM2)}</td>
                  <td>{t.floor != null ? `${t.floor}층` : '-'}</td>
                  <td>{formatManwon(t.priceManwon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={s.empty}>표시할 실거래가 없습니다.</p>
      )}
      <p className={s.help} style={{ marginTop: 8 }}>
        국토교통부 공개 자료 기준 · 기준일 {formatDate(info.dataAsOf)}
      </p>
    </div>
  );
}
