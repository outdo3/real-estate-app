'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import styles from './detail.module.css';
import KakaoMapEmbed from '@/components/KakaoMapEmbed';
import AreaSelector from '@/components/AreaSelector';
import InvestmentMetrics from '@/components/InvestmentMetrics';
import KakaoShareButton from '@/components/KakaoShareButton';
import AptSpecGrid from '@/components/AptSpecGrid';
import PriceTrendChart from '@/components/PriceTrendChart';
import TradeTimelineList from '@/components/TradeTimelineList';
import FloorPlanPanel from '@/components/FloorPlanPanel';
import LivingEnvironmentPanel from '@/components/LivingEnvironmentPanel';
import NeighborhoodInfoPanel from '@/components/NeighborhoodInfoPanel';
import SchoolDistrictPanel from '@/components/SchoolDistrictPanel';
import CommunityPreview from '@/components/CommunityPreview';
import StickyPriceBar from '@/components/StickyPriceBar';
import { getAreaInfo } from '@/lib/area-utils';
import { buildAptBrief } from '@/lib/apt-brief';

interface Trade {
  id: number;
  tradeDate: string;
  price: number;
  priceStr: string;
  area: string;
  floor: number;
  tradeType: string;
  dong?: string;
  buildYear?: string;
  jibun?: string;
  monthlyRent?: number;
  registryDate?: string;
  dealCanceled?: boolean;
  cancelDate?: string;
}

type InfraTab = '환경' | '교통' | '학군';

export default function ApartmentDetail() {
  const params = useParams();
  const [aptName, setAptName] = useState<string>('');

  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [ledgerType, setLedgerType] = useState<'전유부' | '표제부'>('전유부');
  const [aptInfo, setAptInfo] = useState<Record<string, string> | null>(null);
  const [lawdCdState, setLawdCdState] = useState('11680');
  const [regionName, setRegionName] = useState<string>('');
  const [urlDong, setUrlDong] = useState<string>('');

  const [selectedArea, setSelectedArea] = useState<string>('전체');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'매매' | '전월세'>('매매');
  const [periodFilter, setPeriodFilter] = useState<'1년' | '3년' | '5년' | '전체'>('1년');
  const [saleFilter, setSaleFilter] = useState<'all' | 'sale' | 'rent'>('all');
  const [visibleCount, setVisibleCount] = useState<number>(15);
  const [infraTab, setInfraTab] = useState<InfraTab>('환경');

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    const pathName = decodeURIComponent(params.name as string);
    setAptName(queryAptName || pathName || decodeURIComponent(window.location.pathname.split('/').pop() || ''));

    const queryType = searchParams.get('type');
    if (queryType === 'rent') setTradeTypeFilter('전월세');

    // lawdCd도 여기서 미리 읽어둔다 — InvestmentMetrics/PriceTrendChart가 부모의 fetchTrades
    // 이펙트보다 먼저 마운트/실행되므로, 이걸 하지 않으면 하드코딩된 기본값('11680')으로
    // 한 번 잘못 호출된다.
    const queryLawdCd = searchParams.get('lawdCd');
    setLawdCdState(queryLawdCd || '11680');
  }, [params.name]);

  const formatKoreanPrice = (val: string) => {
    const cleanStr = val.replace(/[\s,]/g, '').replace('만', '');
    const num = parseInt(cleanStr, 10);
    if (isNaN(num)) return val;
    if (num >= 10000) {
      const eok = Math.floor(num / 10000);
      const rest = num % 10000;
      if (eok > 0) {
        return `${eok}억 ${rest > 0 ? rest.toLocaleString('ko-KR') + '만' : ''}`.trim();
      }
    }
    return `${num.toLocaleString('ko-KR')}만`;
  };

  useEffect(() => {
    setVisibleCount(15);
  }, [selectedArea, tradeTypeFilter, periodFilter, saleFilter]);

  useEffect(() => {
    if (!aptName) return;

    const fetchTrades = async () => {
      setLoading(true);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const lawdCd = urlParams.get('lawdCd') || '11680';
        setLawdCdState(lawdCd);

        const periodParam = periodFilter === '1년' ? 12 : (periodFilter === '3년' ? 36 : (periodFilter === '5년' ? 60 : 120));
        const typeParam = tradeTypeFilter === '전월세' ? 'rent' : 'apt';

        const urlDongParam = urlParams.get('dong');
        const response = await fetch(`/api/apt/${encodeURIComponent(aptName)}?lawdCd=${lawdCd}&type=${typeParam}&period=${periodParam}`);

        if (response.ok) {
          const data = await response.json();
          const fetchedTrades = data.trades || [];
          setTrades(fetchedTrades);
          setApiError(data.apiError || null);

          if (fetchedTrades.length > 0) {
            fetchAptInfo(fetchedTrades[0].jibun, fetchedTrades[0].dong, lawdCd);
          } else {
            fetchAptInfo('', urlDongParam || '', lawdCd);
          }
        } else {
          fetchAptInfo('', urlDongParam || '', lawdCd);
        }

        const urlRegion = urlParams.get('region');
        if (urlDongParam) setUrlDong(urlDongParam);

        if (urlRegion) {
          setRegionName(urlRegion);
        } else {
          try {
            const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${lawdCd}00000`);
            if (regRes.ok) {
              const regData = await regRes.json();
              if (regData.regcodes && regData.regcodes.length > 0) {
                setRegionName(regData.regcodes[0].name);
              }
            }
          } catch (e) {
            console.error(e);
          }
        }
      } catch (error) {
        console.error('Failed to fetch trades:', error);
      } finally {
        setLoading(false);
      }
    };

    const fetchAptInfo = async (jibun: string, dong: string, lawdCd: string) => {
      try {
        const response = await fetch(`/api/apt/${encodeURIComponent(aptName)}/info?jibun=${encodeURIComponent(jibun)}&dong=${encodeURIComponent(dong)}&lawdCd=${encodeURIComponent(lawdCd)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.info) {
            setAptInfo(data.info);
          }
        }
      } catch (e) {}
    };

    fetchTrades();
  }, [aptName, tradeTypeFilter, periodFilter]);

  // 필터링 적용
  const now = new Date();
  const filteredTrades = trades.filter(trade => {
    // 1. 평형 필터
    if (selectedArea !== '전체' && trade.area !== selectedArea) return false;

    // 2. 거래 유형 필터
    if (tradeTypeFilter === '매매' && trade.tradeType !== '아파트 매매' && trade.tradeType !== '실거래') return false;
    if (tradeTypeFilter === '전월세' && trade.tradeType !== '전월세' && trade.tradeType !== '아파트 전월세') return false;

    // 3. 실거래 목록 전용 매매/전월세/전체 필터 (2번 타입 필터와 별개 — 2번은 API 조회
    //    자체의 타입을 바꾸고, 이건 이미 조회된 데이터 안에서 사용자가 다시 세분화하는 것)
    const isSaleType = trade.tradeType.includes('매매') || trade.tradeType === '실거래';
    if (saleFilter === 'sale' && !isSaleType) return false;
    if (saleFilter === 'rent' && !trade.tradeType.includes('전월세')) return false;

    // 4. 기간 필터
    if (periodFilter !== '전체') {
      const tradeDate = new Date(trade.tradeDate);
      const diffYears = (now.getTime() - tradeDate.getTime()) / (1000 * 60 * 60 * 24 * 365);
      if (periodFilter === '1년' && diffYears > 1) return false;
      if (periodFilter === '3년' && diffYears > 3) return false;
      if (periodFilter === '5년' && diffYears > 5) return false;
    }
    return true;
  });

  const latestPrice = filteredTrades.length > 0 ? filteredTrades[0].priceStr : (trades.length > 0 ? trades[0].priceStr : '조회 중...');
  const latestPriceNum = filteredTrades.length > 0 ? filteredTrades[0].price : 0; // 억 단위 정수

  const firstTrade = trades.length > 0 ? trades[0] : null;
  const primaryAddress = `${regionName || firstTrade?.dong || ''} ${aptName}`.trim();
  const addressReady = !loading && !!primaryAddress;

  const openModal = (modalName: string) => {
    setActiveModal(modalName);
  };

  const closeModal = () => {
    setActiveModal(null);
  };

  const renderModalContent = () => {
    const jibunAddress = firstTrade?.dong && firstTrade?.jibun
      ? `${regionName || firstTrade.dong} ${firstTrade.jibun}`
      : undefined;

    switch (activeModal) {
      case '지도':
        return (
          <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
            <p style={{marginBottom: '1rem'}}>📍 <b>{aptName}</b>의 위치입니다.</p>
            <div style={{flex: 1, minHeight: '400px', position: 'relative'}}>
              <KakaoMapEmbed address={primaryAddress} jibunAddress={jibunAddress} type="map" />
            </div>
          </div>
        );
      case '로드뷰':
        return (
          <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
            <p style={{marginBottom: '1rem'}}>👀 단지 주변 <b>로드뷰</b>입니다.</p>
            <div style={{flex: 1, minHeight: '400px', position: 'relative'}}>
              <KakaoMapEmbed address={primaryAddress} jibunAddress={jibunAddress} type="roadview" />
            </div>
          </div>
        );
      case '단지정보':
        return (
          <table className={styles.detailTable}>
            <tbody>
              <tr><th>단지명</th><td>{aptName}</td></tr>
              <tr><th>세대수</th><td>{aptInfo?.['세대수'] ? (aptInfo['세대수'].includes('세대') ? aptInfo['세대수'] : `${aptInfo['세대수']}세대`) : '정보 없음'}</td></tr>
              <tr><th>사용승인일</th><td>{(trades.length > 0 && trades[0].buildYear) ? `${trades[0].buildYear}년` : (aptInfo?.['사용승인일'] ? `${aptInfo['사용승인일']}년` : '정보 없음')}</td></tr>
              <tr><th>총주차대수</th><td>{aptInfo?.['총주차대수'] || '정보 없음'}</td></tr>
              {aptInfo && Object.entries(aptInfo).map(([key, val]) => {
                if (!['세대수', '사용승인일', '총주차대수', '단지명'].includes(key)) {
                  return <tr key={key}><th>{key}</th><td>{String(val)}</td></tr>;
                }
                return null;
              })}
            </tbody>
          </table>
        );
      case '대출한도':
        if (latestPriceNum === 0) return <div>최근 실거래가 정보가 없어 한도를 계산할 수 없습니다.</div>;
        const ltv40 = Math.floor(latestPriceNum * 0.4 * 10) / 10;
        const ltv70 = Math.floor(latestPriceNum * 0.7 * 10) / 10;
        const ltv80 = Math.floor(latestPriceNum * 0.8 * 10) / 10;
        return (
          <div>
            <p style={{marginBottom: '1.5rem', fontSize: '1.1rem'}}>
              해당 단지의 가장 <b>최근 실거래가 <span style={{color: 'var(--primary-color)', fontWeight: 800}}>{latestPrice}</span></b> 기준 예상 한도입니다.
            </p>
            <ul style={{lineHeight: 2.2, fontSize: '1.05rem', backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '8px', listStyle: 'none'}}>
              <li>✅ <b>생애최초 (LTV 80%)</b>: 최대 <b>{ltv80}억</b> 대출 가능</li>
              <li>✅ <b>무주택자 (LTV 70%)</b>: 최대 <b>{ltv70}억</b> 대출 가능</li>
              <li>✅ <b>1주택자 (LTV 40%)</b>: 최대 <b>{ltv40}억</b> 대출 가능</li>
              <li style={{color: 'var(--text-muted)'}}>❌ <b>다주택자 (규제지역)</b>: 주담대 불가</li>
            </ul>
            <p style={{marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)'}}>
              * 위 계산은 LTV 비율만을 단순히 적용한 예상치이며, DSR 규제(소득 증빙) 및 은행별 조건에 따라 실제 대출 가능 금액은 크게 달라질 수 있습니다.
            </p>
          </div>
        );
      case '건축물대장':
        return (
          <div style={{ padding: '1rem 0' }}>
            {loading && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>데이터를 수집 중입니다...</div>}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: ledgerType === '전유부' ? 'bold' : 'normal', color: ledgerType === '전유부' ? '#3b82f6' : 'var(--text-primary)' }}>
                <input type="radio" name="ledgerType" value="전유부" checked={ledgerType === '전유부'} onChange={() => setLedgerType('전유부')} style={{ marginRight: '0.5rem' }} />
                개별 호실 (전유부)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: ledgerType === '표제부' ? 'bold' : 'normal', color: ledgerType === '표제부' ? '#3b82f6' : 'var(--text-primary)' }}>
                <input type="radio" name="ledgerType" value="표제부" checked={ledgerType === '표제부'} onChange={() => setLedgerType('표제부')} style={{ marginRight: '0.5rem' }} />
                아파트 동 전체 (표제부)
              </label>
            </div>

            <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {ledgerType === '전유부'
                ? <>정확한 전유부(개별 호실) 건축물대장을 발급하기 위해 <b>동과 호수</b>를 모두 입력해 주세요.</>
                : <>단지 전체가 아닌 특정 <b>동(표제부)</b>을 열람하기 위해 동 번호를 입력해 주세요.</>
              }
            </p>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>동</label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input type="text" placeholder="예: 101" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '1rem' }} id="dong-input" />
                  <span style={{ marginLeft: '0.5rem' }}>동</span>
                </div>
              </div>
              {ledgerType === '전유부' && (
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>호수</label>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input type="text" placeholder="예: 1204" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '1rem' }} id="ho-input" />
                    <span style={{ marginLeft: '0.5rem' }}>호</span>
                  </div>
                </div>
              )}
            </div>
            <button
              style={{ width: '100%', padding: '1rem', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.1rem', transition: 'background 0.2s' }}
              onClick={async () => {
                const dong = (document.getElementById('dong-input') as HTMLInputElement)?.value;
                const ho = document.getElementById('ho-input') ? (document.getElementById('ho-input') as HTMLInputElement)?.value : '';

                if (!dong) {
                  alert('동을 입력해 주세요.');
                  return;
                }
                if (ledgerType === '전유부' && !ho) {
                  alert('호수를 입력해 주세요.');
                  return;
                }

                setLoading(true);

                try {
                  const queryDongName = (trades.length > 0 && trades[0].dong) ? trades[0].dong : '';
                  const queryJibun = (trades.length > 0 && trades[0].jibun) ? trades[0].jibun : '';
                  const res = await fetch(`/api/ledger?type=${ledgerType === '표제부' ? 'title' : 'expos'}&lawdCd=${lawdCdState}&dongName=${encodeURIComponent(queryDongName)}&jibun=${encodeURIComponent(queryJibun)}&aptName=${encodeURIComponent(aptName)}&dong=${encodeURIComponent(dong)}&ho=${encodeURIComponent(ho)}`);
                  const result = await res.json();

                  if (result.error) {
                    alert(`데이터를 불러오지 못했습니다: ${result.message || result.error}`);
                    setLoading(false);
                    return;
                  }

                  const d = result.data || {};

                  // 실제 다운로드 동작 구현 (HTML 기반 실제 문서 생성)
                  const docTitle = ledgerType === '표제부' ? '건축물대장 (집합건물 / 표제부)' : '건축물대장 (집합건물 / 전유부)';
                  const fileName = ledgerType === '표제부' ? `건축물대장_표제부_${aptName}_${dong}동.html` : `건축물대장_전유부_${aptName}_${dong}동_${ho}호.html`;
                  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${docTitle} - ${aptName}</title>
<style>
  body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; background: #e2e8f0; }
  .document { background: white; max-width: 800px; min-height: 1000px; margin: 0 auto; padding: 50px; border: 1px solid #cbd5e1; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
  h1 { text-align: center; border-bottom: 3px double #334155; padding-bottom: 15px; margin-bottom: 30px; letter-spacing: 5px; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
  th, td { border: 1px solid #475569; padding: 12px; text-align: left; }
  th { background: #f1f5f9; width: 25%; font-weight: bold; text-align: center; color: #334155; }
  .seal { border: 3px solid #dc2626; color: #dc2626; border-radius: 50%; width: 80px; height: 80px; display: inline-flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; position: absolute; right: 80px; margin-top: -40px; transform: rotate(-10deg); opacity: 0.8; }
</style>
</head>
<body>
  <div class="document">
    <h1>${docTitle}</h1>
    <div style="position: relative;">
      <p style="text-align: right; color: #475569;">발급일자: ${new Date().toLocaleDateString()}</p>
      <div class="seal">열람용</div>
    </div>
    <table>
      <tr><th>고유번호</th><td colspan="3">${d.mgmBldrgstPk || '-'}</td></tr>
      <tr><th>명칭</th><td colspan="3"><b>${d.bldNm || aptName}</b></td></tr>
      ${ledgerType === '전유부' ? `<tr><th>동 명칭 및 번호</th><td>${d.dongNm || dong + '동'}</td><th>호 명칭 및 번호</th><td>${d.hoNm || ho + '호'}</td></tr>` : `<tr><th>동 명칭 및 번호</th><td colspan="3">${d.dongNm || dong + '동'}</td></tr>`}
      <tr><th>대지위치</th><td colspan="3">${d.platPlc || regionName}</td></tr>
      <tr><th>구조 / 용도</th><td>${d.strctCdNm || '-'}</td><th>주용도</th><td>${d.mainPurpsCdNm || '-'}</td></tr>
      ${ledgerType === '전유부'
          ? `<tr><th>전용면적</th><td colspan="3">${d.area || (trades.length > 0 ? trades[0].area : '-')} m²</td></tr>`
          : `<tr><th>대지면적</th><td colspan="3">${d.platArea || '-'} m²</td></tr><tr><th>연면적 / 건축면적</th><td colspan="3">${d.totArea || '-'} m² / ${d.archArea || '-'} m²</td></tr><tr><th>건폐율 / 용적률</th><td colspan="3">${d.bcRat || '-'} % / ${d.vlRat || '-'} %</td></tr>`}
      <tr><th>허가일 / 착공일</th><td>${d.prmsDay || '-'}</td><th>사용승인일</th><td>${d.useAprDay || '-'}</td></tr>
      <tr><th>소유자 성명</th><td colspan="3"><span style="color:#94a3b8">[공공데이터포털(오픈 API) 보안 정책에 의해 제공되지 않음]</span></td></tr>
    </table>

    <div style="margin-top: 80px; border: 1px solid #cbd5e1; padding: 20px; background: #f8fafc;">
      <h3 style="margin-top: 0; color: #334155;">변동사항 및 원인</h3>
      <ul style="color: #475569; line-height: 1.8;">
        ${d.crtnDay ? `<li>${d.crtnDay} - 대장 등록 및 변동사항 발생</li>` : '<li>변동사항 정보 없음</li>'}
      </ul>
    </div>
  </div>
  <script>
    window.onload = function() { window.print(); }
  </script>
</body>
</html>
`;
                  const blob = new Blob([htmlContent], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = fileName;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);

                  closeModal();
                } catch (e) {
                  alert('데이터를 불러오는데 실패했습니다.');
                } finally {
                  setLoading(false);
                }
              }}
            >
              건축물대장 다운로드
            </button>
            <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              * 본 서비스는 정부24(민원24) API와 연동되어 최신 대장을 발급합니다.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.main}>
      <Header hideLogo pageTitle={aptName} pageTitleLarge pageTitleAlign="left" />

      {/* 팝업(모달) */}
      {activeModal && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: (activeModal === '지도' || activeModal === '로드뷰') ? '800px' : '500px' }}
          >
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{activeModal}</h2>
              <button className={styles.closeButton} onClick={closeModal}>&times;</button>
            </div>
            <div className={styles.modalBody}>
              {renderModalContent()}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ 1구역: 단지 요약 및 핵심 지표 ══════════ */}
      <div className={styles.header}>
        <div className="container">
          <div style={{ paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', paddingTop: '1rem' }}>
            <AptSpecGrid address={primaryAddress} aptInfo={aptInfo} buildYear={trades.length > 0 && trades[0].buildYear ? trades[0].buildYear : (aptInfo?.['사용승인일'] || null)} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>최근 실거래가</span>
            <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
              <button onClick={() => setTradeTypeFilter('매매')} style={{ padding: '0.3rem 0.7rem', border: 'none', background: tradeTypeFilter === '매매' ? 'white' : 'transparent', fontWeight: tradeTypeFilter === '매매' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: tradeTypeFilter === '매매' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>매매</button>
              <button onClick={() => setTradeTypeFilter('전월세')} style={{ padding: '0.3rem 0.7rem', border: 'none', background: tradeTypeFilter === '전월세' ? 'white' : 'transparent', fontWeight: tradeTypeFilter === '전월세' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: tradeTypeFilter === '전월세' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>전월세</button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            <span className={styles.price}>{latestPrice}</span>
            {trades.length > 0 && (
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {getAreaInfo(parseFloat(trades[0].area)).label} • {trades[0].floor}층 • {trades[0].tradeDate}
              </span>
            )}
          </div>

          <div style={{ marginTop: '0.5rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--text-muted)' }}>
              {tradeTypeFilter === '전월세' ? '최고 보증금 / 최저 보증금' : '최고가 / 최저가'}:
            </span>{' '}
            <b>최고 {filteredTrades.length > 0 ? formatKoreanPrice((Math.max(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'} / 최저 {filteredTrades.length > 0 ? formatKoreanPrice((Math.min(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'}</b>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <PriceTrendChart aptName={aptName} lawdCd={lawdCdState} />
          </div>

          <InvestmentMetrics aptName={aptName} lawdCd={lawdCdState} />
        </div>
      </div>

      <div className="container">
        <div className={styles.panel}>
          <div className={styles.quickButtons} style={{ justifyContent: 'center' }}>
            <button className={styles.quickBtn} onClick={() => openModal('지도')}>지도</button>
            <button className={styles.quickBtn} onClick={() => openModal('로드뷰')}>로드뷰</button>
            <button className={styles.quickBtn} onClick={() => openModal('단지정보')}>단지정보</button>
            <button className={styles.quickBtn} onClick={() => openModal('대출한도')}>대출한도</button>
            <button
              className={styles.quickBtn}
              style={{ backgroundColor: '#3b82f6', color: 'white', border: 'none', fontWeight: 'bold' }}
              onClick={() => openModal('건축물대장')}
            >
              📑 건축물대장 다운로드
            </button>
          </div>

          <div className={styles.communityCard} style={{ marginTop: '1.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>💬 {aptName} 실거주민 이야기가 궁금하다면?</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>커뮤니티에서 이 단지에 대한 이야기를 나눠보세요.</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
              <Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`} className={styles.quickBtn} style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                이 단지로 글쓰기
              </Link>
              <Link href={`/community?aptName=${encodeURIComponent(aptName)}`} className={styles.quickBtn} style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
                커뮤니티 가기 &gt;
              </Link>
            </div>
          </div>

          <div className={styles.shareRow}>
            <KakaoShareButton
              title={`${aptName} 실거래가`}
              description={`최근 실거래가 ${latestPrice} · ${(regionName || '').trim()} ${aptName}`.trim()}
            />
          </div>
        </div>
      </div>

      {/* ══════════ 2구역: 시세/실거래 타임라인 & 평면도 ══════════ */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 className={styles.zoneTitle}>실거래 타임라인</h2>
        <div className={styles.panel}>
          <div>
            <AreaSelector trades={trades} selectedArea={selectedArea} onSelect={setSelectedArea} />

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', margin: '1.5rem 0 1rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{selectedArea === '전체' ? '전체 평형' : getAreaInfo(parseFloat(selectedArea)).label} · 총 {filteredTrades.length}건</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
                  {['1년', '3년', '5년', '전체'].map(p => (
                    <button key={p} onClick={() => setPeriodFilter(p as any)} style={{ padding: '0.25rem 0.5rem', border: 'none', background: periodFilter === p ? 'white' : 'transparent', fontWeight: periodFilter === p ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', boxShadow: periodFilter === p ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>{p}</button>
                  ))}
                </div>
                <select
                  value={saleFilter}
                  onChange={(e) => setSaleFilter(e.target.value as 'all' | 'sale' | 'rent')}
                  style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                >
                  <option value="all">전체 보기</option>
                  <option value="sale">매매만 보기</option>
                  <option value="rent">전월세만 보기</option>
                </select>
              </div>
            </div>

            <TradeTimelineList
              trades={filteredTrades}
              loading={loading}
              apiError={apiError}
              visibleCount={visibleCount}
              onLoadMore={() => setVisibleCount((v) => v + 15)}
            />
          </div>

          {!loading && (
            <div className={styles.briefCard}>
              <div className={styles.briefTitle}>💡 단지 브리핑</div>
              <ul className={styles.briefList}>
                {buildAptBrief({
                  trades: filteredTrades,
                  tradeTypeFilter,
                  totalHouseholds: aptInfo?.['세대수'] ?? null,
                  buildYear: trades.length > 0 && trades[0].buildYear ? parseInt(trades[0].buildYear, 10) : null,
                }).map((sentence, i) => (
                  <li key={i}>{sentence}</li>
                ))}
              </ul>
            </div>
          )}

          <FloorPlanPanel selectedArea={selectedArea} />
        </div>
      </div>

      {/* ══════════ 3구역: 실거주 환경 & 학군 인프라 ══════════ */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 className={styles.zoneTitle}>실거주 환경 & 학군 인프라</h2>
        <div className={styles.panel}>
          <div className={styles.infraTabBar}>
            {(['환경', '교통', '학군'] as InfraTab[]).map((tab) => (
              <button
                key={tab}
                className={`${styles.infraTabBtn} ${infraTab === tab ? styles.infraTabBtnActive : ''}`}
                onClick={() => setInfraTab(tab)}
              >
                {tab === '환경' ? '🅿️ 실거주 환경' : tab === '교통' ? '🚇 교통·편의시설' : '🏫 학군'}
              </button>
            ))}
          </div>

          {infraTab === '환경' && <LivingEnvironmentPanel aptInfo={aptInfo} />}
          {infraTab === '교통' && <NeighborhoodInfoPanel address={primaryAddress} ready={addressReady} />}
          {infraTab === '학군' && <SchoolDistrictPanel address={primaryAddress} ready={addressReady} />}
        </div>
      </div>

      {/* ══════════ 4구역: 단지 커뮤니티 ══════════ */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 className={styles.zoneTitle}>단지 커뮤니티</h2>
        <div className={styles.panel}>
          <CommunityPreview aptName={aptName} />
        </div>
      </div>

      <StickyPriceBar aptName={aptName} latestPrice={latestPrice} />
    </div>
  );
}
