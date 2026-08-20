'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import FullPageLoader from '@/components/FullPageLoader';
import styles from './detail.module.css';
import KakaoMapEmbed from '@/components/KakaoMapEmbed';
import AreaSelector from '@/components/AreaSelector';
import KakaoShareButton from '@/components/KakaoShareButton';
import AptSpecGrid from '@/components/AptSpecGrid';
import TradeTimelineList from '@/components/TradeTimelineList';
import LivingEnvironmentPanel from '@/components/LivingEnvironmentPanel';
import NeighborhoodInfoPanel from '@/components/NeighborhoodInfoPanel';
import SchoolDistrictPanel from '@/components/SchoolDistrictPanel';
import CommunityPreview from '@/components/CommunityPreview';
import StickyPriceBar from '@/components/StickyPriceBar';
import AdContainer from '@/components/AdContainer';
import ApartmentQuickSearch from '@/components/ApartmentQuickSearch';
import ApartmentSearchTrigger from '@/components/ApartmentSearchTrigger';
import ApartmentScoreCard from '@/components/ApartmentScoreCard';
import { getAreaDetailLabel, getUniqueAreaLabels, getAreaLabelsForUnit, type AreaUnit } from '@/lib/area-utils';
import { buildAptBrief } from '@/lib/apt-brief';
import type { ApartmentScoreApiResponse } from '@/lib/apartment-score/client-types';
import { getClientSessionId, setCurrentAptName } from '@/lib/live-presence';
import { recordApartmentVisit } from '@/lib/recent-apartments';
import { siteConfig } from '@/config/site';

// 차트 컴포넌트(recharts)는 번들이 무거워 메인 스레드를 오래 점유한다 — 상세페이지
// 최초 렌더에 꼭 필요하지 않으므로 지연 로딩(ssr:false)해서 초기 로드를 가볍게 하고,
// 로딩되는 동안은 실제 차트 영역과 크기가 같은 스켈레톤을 보여줘 레이아웃이 튀지 않게 한다.
const ChartSkeleton = ({ height }: { height: string }) => (
  <div className={styles.skeletonBar} style={{ height }} />
);
const PriceTrendChart = dynamic(() => import('@/components/PriceTrendChart'), {
  ssr: false,
  loading: () => <ChartSkeleton height="16rem" />,
});
const InvestmentMetrics = dynamic(() => import('@/components/InvestmentMetrics'), {
  ssr: false,
  loading: () => <ChartSkeleton height="8rem" />,
});

interface Trade {
  id: number;
  name?: string;
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
  // 세대수/준공년월/용적률 등 단지 기본정보(aptInfo) 조회는 trades와 별개의 API 호출이라
  // 서로 다른 시점에 끝나면 카드가 하나씩 뜨는 것처럼 보였다 — trades와 aptInfo 둘 다
  // 끝날 때까지 pageReady를 false로 유지해 상단 요약 영역을 한 번에 렌더링한다.
  const [infoLoading, setInfoLoading] = useState(true);
  // 최초 진입 시에만 전체화면 브랜드 로더를 보여준다 — 매매/전월세, 기간 필터를 바꿀
  // 때도 loading/infoLoading이 다시 true가 되는데, 그때마다 전체화면 오버레이가 뜨면
  // 화면이 계속 깜빡이는 느낌을 준다. 최초 1회 로딩이 끝난 뒤로는 기존 스켈레톤만 쓴다.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [ledgerType, setLedgerType] = useState<'전유부' | '표제부'>('전유부');
  const [aptInfo, setAptInfo] = useState<Record<string, string> | null>(null);
  const [lawdCdState, setLawdCdState] = useState('11680');
  const [regionName, setRegionName] = useState<string>('');
  const [urlDong, setUrlDong] = useState<string>('');
  // 사용자가 검색/진입에 쓴 이름(아실 "금호어울림" vs 네이버 "서대신금호어울림" 같은 표기
  // 차이)과 무관하게, 상세페이지 상단 표기는 실제로 매칭된 국토부 데이터의 대표 단지명으로
  // 통일한다. aptName은 API 호출 키로 계속 쓰이므로 별도 상태로 분리한다.
  const [displayName, setDisplayName] = useState<string>('');

  const [selectedArea, setSelectedArea] = useState<string>('전체');
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'매매' | '전월세'>('매매');
  const [periodFilter, setPeriodFilter] = useState<'1년' | '3년' | '5년' | '전체'>('1년');
  const [saleFilter, setSaleFilter] = useState<'all' | 'sale' | 'rent'>('all');
  const [visibleCount, setVisibleCount] = useState<number>(15);
  const [infraTab, setInfraTab] = useState<InfraTab>('환경');
  // UX QA — 탭을 조건부 렌더(unmount/remount)하면 환경↔교통↔학군을 오갈 때마다
  // KakaoPlaces/BusAccessCard/SchoolDistrictPanel이 매번 새로 geocode+API를 호출했다
  // (버스는 TAGO 캐시가 없는 좌표에서 최초 호출이 수 초 걸림 — 재호출할수록 그 지연을
  // 반복 체감). 한 번 연 탭은 계속 마운트해두고 display만 토글해 재방문 시 재호출을
  // 없앤다 — 처음 열 때까지는 그대로 지연 렌더(마운트 안 됨)라 방문한 적 없는 탭 때문에
  // API 호출이 늘지는 않는다.
  const [visitedInfraTabs, setVisitedInfraTabs] = useState<Set<InfraTab>>(new Set(['환경']));
  // APT DETAIL QA/IA v1 §6/§10 — 기본 단위는 기존 UX 그대로 ㎡ 유지. localStorage로
  // 가볍게 기억만 하고(세션/서버 저장 아님), 과도한 persistence는 두지 않는다.
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('㎡');

  // 단지 커뮤니티 시설(골프연습장/수영장 등) — scripts/crawl_facilities.py가 채워둔 값을
  // 모달을 처음 열 때만 조회한다. null은 "정보 없음"(미조사 또는 DB에 값이 없음),
  // undefined는 "아직 조회 전"으로 구분한다.
  const [facilities, setFacilities] = useState<string[] | null | undefined>(undefined);
  const [facilitiesLoading, setFacilitiesLoading] = useState(false);

  // STEP SCORE S3 — 이집점수. trades/aptInfo 로딩과 완전히 독립된 자체 상태다 — 점수
  // API가 느리거나 실패해도 상세페이지 나머지(FullPageLoader/pageReady)를 막지 않는다(§25/26).
  const [scoreResult, setScoreResult] = useState<ApartmentScoreApiResponse | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const queryAptName = searchParams.get('aptName');
    const pathName = decodeURIComponent(params.name as string);
    setAptName(queryAptName || pathName || decodeURIComponent(window.location.pathname.split('/').pop() || ''));

    const queryType = searchParams.get('type');
    if (queryType === 'rent') setTradeTypeFilter('전월세');

    // lawdCd/dong도 여기서 미리 읽어둔다 — InvestmentMetrics/PriceTrendChart가 부모의
    // fetchTrades 이펙트보다 먼저 마운트/실행되므로, 이걸 하지 않으면 하드코딩된 기본값
    // ('11680')이나 dong 없이 한 번 잘못(너무 넓게) 조회된다.
    const queryLawdCd = searchParams.get('lawdCd');
    setLawdCdState(queryLawdCd || '11680');
    const queryDong = searchParams.get('dong');
    if (queryDong) setUrlDong(queryDong);
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

  // 이전에 이 페이지에서 선택했던 면적 단위를 기억만 한다(§10) — 서버 저장/세션 없음.
  useEffect(() => {
    const saved = window.localStorage.getItem('ejip:areaUnit');
    if (saved === '㎡' || saved === '평') setAreaUnit(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem('ejip:areaUnit', areaUnit);
  }, [areaUnit]);

  useEffect(() => {
    if (!aptName) return;
    // 매매/전월세 탭을 빠르게 전환하면 이전 요청이 나중에 끝나 최신 탭의 데이터를 덮어쓸 수
    // 있다 — cancelled 플래그로 이미 무효화된(effect가 재실행된) 요청의 응답은 반영하지 않는다.
    let cancelled = false;
    // /api/apt/[name]/info는 지번(jibun)이 없어도 dong+lawdCd만으로 DB 캐시(name+dong
    // 키)를 우선 조회하므로 대부분 정확하다 — URL에 lawdCd/dong이 이미 있는 진입 경로
    // (지도 마커, AI 검색 결과, 학교 페이지 링크 등 절대다수)에서는 실거래 응답을 기다릴
    // 필요 없이 단지정보를 곧바로 병렬 조회한다. infoFetchedInline이 true면 fetchTrades
    // 안에서 다시 조회하지 않는다(중복 호출 방지).
    let infoFetchedInline = false;

    const fetchAptInfo = async (jibun: string, dong: string, lawdCd: string) => {
      try {
        const response = await fetch(`/api/apt/${encodeURIComponent(aptName)}/info?jibun=${encodeURIComponent(jibun)}&dong=${encodeURIComponent(dong)}&lawdCd=${encodeURIComponent(lawdCd)}`);
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json();
          if (cancelled) return;
          if (data.info) {
            setAptInfo(data.info);
          }
        }
      } catch (e) {
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    };

    const fetchTrades = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlLawdCd = urlParams.get('lawdCd');

        const periodParam = periodFilter === '1년' ? 12 : (periodFilter === '3년' ? 36 : (periodFilter === '5년' ? 60 : 120));
        const typeParam = tradeTypeFilter === '전월세' ? 'rent' : 'apt';

        const urlDongParam = urlParams.get('dong');
        // URL에 lawdCd가 없으면(지도 마커, 커뮤니티 글 링크 등 지역코드를 안 넘기는 진입
        // 경로) 아예 파라미터를 안 보내고, API가 DB에 저장된 실제 지역을 찾아 응답에 함께
        // 돌려주는 lawdCd를 신뢰한다 — 여기서 하드코딩된 기본 지역으로 미리 단정하지 않는다.
        const lawdCdQuery = urlLawdCd ? `&lawdCd=${urlLawdCd}` : '';
        // dong이 있으면 반드시 실거래가 조회에도 넘긴다 — 없으면 "롯데캐슬", "푸르지오"처럼
        // 같은 구 안에 있는 다른 동의 동일 브랜드 단지 실거래가 이름만으로 부분일치되어
        // 함께 섞여 나오는 문제가 있다(API 쪽에서 dong이 오면 정확히 그 동으로만 좁힌다).
        const dongQuery = urlDongParam ? `&dong=${encodeURIComponent(urlDongParam)}` : '';
        const response = await fetch(`/api/apt/${encodeURIComponent(aptName)}?type=${typeParam}&period=${periodParam}${lawdCdQuery}${dongQuery}`);
        if (cancelled) return;

        let resolvedLawdCd = urlLawdCd || '11680';
        let resolvedDong = urlDongParam || '';

        if (response.ok) {
          const data = await response.json();
          if (cancelled) return;
          const fetchedTrades = data.trades || [];
          setTrades(fetchedTrades);
          setApiError(data.apiError || null);
          if (data.lawdCd) resolvedLawdCd = data.lawdCd;
          // URL에 dong이 없었다면(위 dongQuery가 비어 실제로는 구 전체를 뒤진 응답이다) API가
          // DB 조회/지오코딩으로 찾아낸 dong을 신뢰한다(거래가 0건이어도 유효한 값). 이후 호출
          // (단지정보/투자지표/시세추이)을 좁혀서 같은 브랜드의 다른 단지가 섞이지 않게 한다.
          if (!resolvedDong && data.dong) resolvedDong = data.dong;
          // 플랫폼마다 표기가 다를 수 있는 검색어(예: "금호어울림" vs "서대신금호어울림")와
          // 무관하게, 실제로 매칭된 첫 거래의 국토부 대표 단지명으로 상단 표기를 통일한다.
          if (fetchedTrades.length > 0 && fetchedTrades[0].name) setDisplayName(fetchedTrades[0].name);

          // 이미 병렬로 dong만으로 단지정보를 조회했더라도(infoFetchedInline), 실거래
          // 응답에 지번(jibun)이 있으면 더 정밀한 값으로 한 번 더 갱신한다 — 최초 화면은
          // 이미 떠 있으므로 이 재조회가 pageReady를 다시 늦추지는 않는다(아래 setInfoLoading
          // 호출 없이 setAptInfo만 조용히 갱신).
          if (fetchedTrades.length > 0 && fetchedTrades[0].jibun) {
            if (infoFetchedInline) {
              fetch(`/api/apt/${encodeURIComponent(aptName)}/info?jibun=${encodeURIComponent(fetchedTrades[0].jibun)}&dong=${encodeURIComponent(fetchedTrades[0].dong || resolvedDong)}&lawdCd=${encodeURIComponent(resolvedLawdCd)}`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                  if (!cancelled && data?.info) setAptInfo(data.info);
                })
                .catch(() => {});
            } else {
              infoFetchedInline = true;
              fetchAptInfo(fetchedTrades[0].jibun, fetchedTrades[0].dong, resolvedLawdCd);
            }
          } else if (!infoFetchedInline) {
            infoFetchedInline = true;
            fetchAptInfo('', resolvedDong, resolvedLawdCd);
          }
        } else if (!infoFetchedInline) {
          infoFetchedInline = true;
          fetchAptInfo('', resolvedDong, resolvedLawdCd);
        }

        setLawdCdState(resolvedLawdCd);
        setUrlDong(resolvedDong);

        const urlRegion = urlParams.get('region');

        if (urlRegion) {
          setRegionName(urlRegion);
        } else {
          try {
            const regRes = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${resolvedLawdCd}00000`);
            if (cancelled) return;
            if (regRes.ok) {
              const regData = await regRes.json();
              if (cancelled) return;
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
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    setInfoLoading(true);

    // URL에 lawdCd+dong이 이미 있는(절대다수) 진입 경로는 실거래 조회를 기다리지 않고
    // 단지정보 조회를 곧바로 함께 시작한다 — 기존에는 실거래 응답이 와야만 단지정보
    // 조회가 시작돼(Waterfall) 두 호출의 지연시간이 그대로 합산됐다.
    const initialUrlParams = new URLSearchParams(window.location.search);
    const initialLawdCd = initialUrlParams.get('lawdCd');
    const initialDong = initialUrlParams.get('dong');
    if (initialLawdCd && initialDong) {
      infoFetchedInline = true;
      Promise.all([fetchTrades(), fetchAptInfo('', initialDong, initialLawdCd)]);
    } else {
      fetchTrades();
    }

    return () => {
      cancelled = true;
    };
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

  // B1-FIX3 — 선택 평형(+현재 매매/전월세)에 거래가 없을 때 다른 평형의 거래로
  // 넘어가지 않는다. selectedArea === '전체'일 때는 필터 자체가 area를 걸지 않으므로
  // filteredTrades[0]가 원래도 "현재 거래유형 전체 최신 거래"와 같다 — 별도 분기 없이
  // 이 한 줄로 두 정책(전체=전체 최신, 특정 평형=그 평형만)이 그대로 성립한다.
  // filteredTrades가 비면 예전처럼 trades[0](다른 평형일 수 있는 전체 최신)으로
  // fallback하지 않고 null로 둔다 — heroTrade가 없으면 Hero는 empty state를 보여준다.
  const heroTrade = filteredTrades.length > 0 ? filteredTrades[0] : null;

  // Hero의 큰 가격 표기와 별개로, StickyPriceBar·대출한도 모달처럼 문장형 안내를 넣을
  // 공간이 없는 곳에서 쓰는 짧은 문자열. heroTrade가 없을 때 "아직 아무 거래도 못
  // 불러온 상태"(trades 자체가 비어 있음 — 기존부터 있던 별개의 로딩/무데이터 표시)와
  // "선택한 평형+거래유형에만 거래가 없는 상태"를 구분해, 후자도 다른 평형 가격을
  // 빌려오지 않고 짧게 "거래 없음"으로만 표시한다.
  const latestPrice = heroTrade ? heroTrade.priceStr : (trades.length > 0 ? '거래 없음' : '조회 중...');
  const latestPriceNum = heroTrade ? heroTrade.price : 0; // 억 단위 정수

  // AreaSelector 칩·거래목록·Hero·거래타임라인 헤더가 전부 같은 라벨을 쓰도록,
  // 이 단지의 전체 거래(trades, 필터 무관)에 등장하는 모든 전용면적을 기준으로
  // 라벨 충돌(예: 59.8826㎡ vs 59.8839㎡가 둘 다 "59.88㎡"가 되는 경우)을 한 번에
  // 해소해 페이지 전체가 공유하는 라벨 맵을 만든다.
  const areaLabels = getUniqueAreaLabels(trades.map((t) => parseFloat(t.area)));
  // APT DETAIL QA/IA v1 §9 — ㎡|평 토글은 chip/거래표에만 적용한다(areaLabels는 항상
  // ㎡라 Hero/헤더의 "전용 X㎡ · 약 Y평" 이중표기는 그대로 둔다 — chipAreaLabels를 거기
  // 넣으면 "전용 25.4평 · 약 25.4평"처럼 평이 중복 표기되는 문제가 생긴다).
  const chipAreaLabels = getAreaLabelsForUnit(trades.map((t) => parseFloat(t.area)), areaUnit);

  const firstTrade = trades.length > 0 ? trades[0] : null;
  const primaryAddress = `${regionName || firstTrade?.dong || ''} ${displayName || aptName}`.trim();
  const addressReady = !loading && !!primaryAddress;

  // B1 Hero용 — primaryAddress(지오코딩에 쓰이는 "지역+단지명" 조합 문자열)는 건드리지
  // 않고, Hero에 표시할 "지역만" 값과 "준공·세대수" 요약 줄만 별도로 계산한다. 실제 값이
  // 없는 항목(예: 동수 — 현재 데이터 파이프라인에 없음)은 만들어내지 않고 생략한다.
  const heroRegionLabel = regionName || firstTrade?.dong || '';
  const heroBuildYearRaw = trades.length > 0 && trades[0].buildYear ? trades[0].buildYear : (aptInfo?.['사용승인일'] || null);
  const heroBuildYearNum = heroBuildYearRaw ? parseInt(heroBuildYearRaw, 10) : NaN;
  const heroHouseholds = aptInfo?.['세대수'] || null;
  const heroMetaLine = [
    !isNaN(heroBuildYearNum) && heroBuildYearNum > 1900 ? `${heroBuildYearNum}년 준공` : null,
    heroHouseholds,
  ].filter((v): v is string => !!v).join(' · ') || null;
  // trades와 aptInfo 둘 다 끝나야 상단 요약 영역(단지정보/가격/차트)을 한 번에 보여준다 —
  // 시간차를 두고 카드가 하나씩 뜨는 문제를 막는다.
  const pageReady = !loading && !infoLoading;

  useEffect(() => {
    if (pageReady) setHasLoadedOnce(true);
  }, [pageReady]);

  // 상세페이지 조회 로그 — ViewTracker(전역)는 /apt/[name] 경로를 일부러 건너뛰고
  // (주석 참고) 여기서 실제로 매칭된 단지명·지역까지 포함한 정확한 로그를 남긴다.
  // pageReady가 처음 true가 되는 시점(단지명이 확정된 시점)에 딱 한 번만 기록한다.
  useEffect(() => {
    if (!pageReady) return;
    const resolvedName = displayName || aptName;
    if (!resolvedName) return;
    const complexId = `${lawdCdState}|${urlDong}|${resolvedName}`;
    setCurrentAptName(resolvedName);
    // [UI-C1] "최근 본 단지" 기록 — pageReady가 처음 true가 되는(단지명·지역이 확정된)
    // 이 시점에 위 조회 로그와 함께 딱 한 번만 남긴다. DB 저장 없음(localStorage만).
    recordApartmentVisit({
      name: resolvedName,
      address: [heroRegionLabel, urlDong].filter(Boolean).join(' '),
      lawdCd: lawdCdState,
      dong: urlDong,
    });
    fetch('/api/log/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: window.location.pathname, sessionId: getClientSessionId(), complexId, aptName: resolvedName }),
      keepalive: true,
    }).catch(() => {});

    return () => {
      setCurrentAptName(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageReady, displayName, aptName, lawdCdState, urlDong]);

  // STEP SCORE S3 — 이집점수 API 조회. pageReady를 기다리지 않고 aptName이 확정되는
  // 대로 바로 호출한다(§25 — score 로딩이 전체 상세페이지 로딩을 막으면 안 됨). 실패해도
  // catch에서 조용히 null로 남겨 카드가 "산정 준비 중"으로 graceful degradation한다(§26).
  useEffect(() => {
    if (!aptName) return;
    let cancelled = false;
    setScoreLoading(true);
    const query = new URLSearchParams();
    if (lawdCdState) query.set('lawdCd', lawdCdState);
    if (urlDong) query.set('dong', urlDong);
    fetch(`/api/apt/${encodeURIComponent(aptName)}/score?${query.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApartmentScoreApiResponse | null) => {
        if (!cancelled) setScoreResult(data);
      })
      .catch(() => {
        if (!cancelled) setScoreResult(null);
      })
      .finally(() => {
        if (!cancelled) setScoreLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aptName, lawdCdState, urlDong]);

  const openModal = (modalName: string) => {
    setActiveModal(modalName);
    if (modalName === '커뮤니티 시설' && facilities === undefined && !facilitiesLoading) {
      setFacilitiesLoading(true);
      fetch(`/api/apt/${encodeURIComponent(aptName)}/facilities${urlDong ? `?dong=${encodeURIComponent(urlDong)}` : ''}`)
        .then((res) => res.json())
        .then((data) => setFacilities(Array.isArray(data.facilities) ? data.facilities : null))
        .catch(() => setFacilities(null))
        .finally(() => setFacilitiesLoading(false));
    }
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
      case '커뮤니티 시설':
        if (facilitiesLoading) {
          return <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>;
        }
        if (facilities && facilities.length > 0) {
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', padding: '0.5rem 0' }}>
              {facilities.map((f, i) => (
                <span
                  key={i}
                  style={{
                    padding: '0.5rem 0.9rem',
                    borderRadius: '999px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    color: '#166534',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          );
        }
        return (
          <div style={{ padding: '1.5rem 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>등록된 커뮤니티 시설 정보가 없습니다.</p>
            <Link
              href={`/community/write?aptName=${encodeURIComponent(aptName)}`}
              className={styles.quickBtn}
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              📝 정보 제보하기
            </Link>
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
      case '빠른 검색':
        // [UI-C1] 상세페이지에서 다른 단지로 즉시 이동. 기존 모달(activeModal/openModal/
        // closeModal) 구조를 그대로 재사용 — 새 overlay 시스템을 만들지 않았다.
        return (
          <ApartmentQuickSearch
            currentApt={{ name: displayName || aptName, dong: urlDong, address: primaryAddress }}
            onClose={closeModal}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.main}>
      <FullPageLoader active={!pageReady && !hasLoadedOnce} />
      <Header
        searchSlot={<ApartmentSearchTrigger onOpen={() => openModal('빠른 검색')} />}
      />

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
          {!pageReady ? (
            <div className={styles.headerSkeleton}>
              <div className={styles.skeletonBar} style={{ width: '55%', height: '0.9rem' }} />
              <div className={styles.skeletonBar} style={{ height: '4.5rem' }} />
              <div className={styles.skeletonBar} style={{ width: '40%', height: '1.8rem', marginTop: '0.5rem' }} />
              <div className={styles.skeletonBar} style={{ width: '70%' }} />
              <div className={styles.skeletonBar} style={{ height: '10rem', marginTop: '0.5rem' }} />
              <div className={styles.skeletonBar} style={{ height: '3.5rem' }} />
            </div>
          ) : (
            <>
              {/* Hero: 단지명 · 지역 · 준공/세대수 요약 + 공유 */}
              <div className={styles.heroTop}>
                <div>
                  <h1 className={styles.heroTitle}>{displayName || aptName}</h1>
                  {heroRegionLabel && <div className={styles.heroAddress}>📍 {heroRegionLabel}</div>}
                  {heroMetaLine && <div className={styles.heroMeta}>{heroMetaLine}</div>}
                </div>
                <KakaoShareButton
                  compact
                  title={`${aptName} 실거래가·시세 - ${siteConfig.name}`}
                  description={`${aptName}의 실거래가, 시세 변동 추이, 평형별 거래 내역을 확인하세요.`}
                />
              </div>

              {/* 가격 핵심 */}
              <div className={styles.priceBlock}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>최근 실거래가</span>
                  <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '4px', padding: '0.25rem' }}>
                    <button onClick={() => setTradeTypeFilter('매매')} style={{ padding: '0.3rem 0.7rem', border: 'none', background: tradeTypeFilter === '매매' ? 'var(--primary-color)' : 'transparent', color: tradeTypeFilter === '매매' ? 'white' : 'var(--text-secondary)', fontWeight: tradeTypeFilter === '매매' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>매매</button>
                    <button onClick={() => setTradeTypeFilter('전월세')} style={{ padding: '0.3rem 0.7rem', border: 'none', background: tradeTypeFilter === '전월세' ? 'var(--primary-color)' : 'transparent', color: tradeTypeFilter === '전월세' ? 'white' : 'var(--text-secondary)', fontWeight: tradeTypeFilter === '전월세' ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' }}>전월세</button>
                  </div>
                </div>

                <div style={{ marginTop: '0.3rem' }}>
                  {heroTrade ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span className={styles.price}>{heroTrade.priceStr}</span>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                          {getAreaDetailLabel(parseFloat(heroTrade.area), areaLabels)}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.15rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {heroTrade.floor}층 · {heroTrade.tradeDate}
                      </div>
                    </>
                  ) : selectedArea !== '전체' ? (
                    // 선택 평형(+현재 매매/전월세)에 거래가 없는 경우 — 다른 평형의
                    // 거래를 대신 보여주지 않고, 사용자가 무엇을 선택했는지는 위
                    // AreaSelector 칩 선택 상태에 그대로 남겨둔 채 이 자리에만
                    // 명확한 empty state를 표시한다.
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      해당 평형의 최근 거래가 없습니다.
                    </div>
                  ) : (
                    <span className={styles.price}>{latestPrice}</span>
                  )}
                </div>

                <div style={{ marginTop: '0.4rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {tradeTypeFilter === '전월세' ? '최고 보증금 / 최저 보증금' : '최고가 / 최저가'}:
                  </span>{' '}
                  <b>최고 {filteredTrades.length > 0 ? formatKoreanPrice((Math.max(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'} / 최저 {filteredTrades.length > 0 ? formatKoreanPrice((Math.min(...filteredTrades.map(t => t.price)) * 10000).toString()) : '-'}</b>
                </div>
              </div>

              {/* 평형 선택 — 가격 확인 직후, 시세 흐름 확인 직전 */}
              <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <AreaSelector trades={trades} selectedArea={selectedArea} onSelect={setSelectedArea} areaLabels={chipAreaLabels} />
                </div>
                <div style={{ display: 'flex', flexShrink: 0, border: '1px solid var(--border-color)', borderRadius: '999px', padding: '2px' }}>
                  {(['㎡', '평'] as AreaUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setAreaUnit(u)}
                      aria-pressed={areaUnit === u}
                      style={{
                        padding: '0.3rem 0.65rem',
                        borderRadius: '999px',
                        border: 'none',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        background: areaUnit === u ? 'var(--primary-color)' : 'transparent',
                        color: areaUnit === u ? 'white' : 'var(--text-secondary)',
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '1.25rem' }}>
                <PriceTrendChart aptName={aptName} lawdCd={lawdCdState} dong={urlDong} selectedArea={selectedArea} />
              </div>

              <InvestmentMetrics aptName={aptName} lawdCd={lawdCdState} dong={urlDong} selectedArea={selectedArea} />

              {/* 기존 단지 스펙 그리드(세대수/준공년월/용적률/건폐율/주차대수) — Hero 핵심
                  요약과는 별개로 삭제하지 않고 그대로 유지. address는 위 Hero에서 이미
                  보여줬으므로 중복 표시를 피하기 위해 빈 값을 넘긴다(컴포넌트 자체 수정 없음). */}
              <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-color)' }}>
                <AptSpecGrid aptName={aptName} address="" aptInfo={aptInfo} buildYear={heroBuildYearRaw} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* STEP SCORE S3 — Hero 직후, 실거래 타임라인 직전(§3 권장 배치). pageReady와
          무관한 독립 카드라 이 위치에 pageReady 조건 밖으로 둔다. */}
      {pageReady && (
        <div className="container">
          <ApartmentScoreCard result={scoreResult} loading={scoreLoading} />
        </div>
      )}

      <div className="container">
        <div className={styles.panel}>
          <div className={styles.quickButtons} style={{ justifyContent: 'center' }}>
            <button className={styles.quickBtn} onClick={() => openModal('지도')}>지도</button>
            <button className={styles.quickBtn} onClick={() => openModal('로드뷰')}>로드뷰</button>
            <button className={styles.quickBtn} onClick={() => openModal('대출한도')}>대출한도</button>
            {/* [STEP50 V1 CLEANUP] '단지정보'/'건축물대장' 버튼은 노출하지 않는다.
                '단지정보' 모달은 aptInfo가 실제로 가질 수 있는 키(세대수/총주차대수/
                용적률/건폐율, /api/apt/[name]/info/route.ts 참고)가 전부 Hero 아래
                AptSpecGrid에 이미 상시 노출돼 있어 100% 중복이었다(코드 확인 완료).
                '커뮤니티 시설' 버튼은 communityFacilities 실데이터 coverage가 0/31
                (DB 직접 조회 확인)이라 항상 "정보 없음" empty state만 반복 노출했다.
                건축물대장 버튼은 B0.5 검수에서 확인된 mgmBldrgstPk 정밀도 손상(BLOCKER)
                때문에 그 이전부터 이미 노출하지 않고 있었다. 셋 다 관련 API/모달 case/
                state는 삭제하지 않고 그대로 남겨둔다 — 버튼(진입점)만 제거했다. */}
          </div>

          {/* [STEP50 V1 CLEANUP] 이 카드("실거주민 이야기가 궁금하다면?")는 아래 4구역
              CommunityPreview 헤더의 "글쓰기"/"더보기" 링크와 완전히 동일한 목적·목적지의
              CTA를 중복 노출했다(실제 커뮤니티 글 목록 등 고유 콘텐츠 없이 링크만 있는
              배너). CommunityPreview는 실제 최근 글까지 함께 보여줘 더 자연스러운
              위치이므로 그쪽 하나만 남기고 이 배너는 제거했다. */}
        </div>
      </div>

      {/* ══════════ 2구역: 시세/실거래 타임라인 & 평면도 ══════════ */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 className={styles.zoneTitle}>실거래 타임라인</h2>
        <div className={styles.panel}>
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', margin: '0 0 1rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{selectedArea === '전체' ? '전체 평형' : getAreaDetailLabel(parseFloat(selectedArea), areaLabels)} · 총 {filteredTrades.length}건</span>
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
              areaLabels={chipAreaLabels}
            />
          </div>

          {!loading && (
            <div className={styles.briefCard}>
              <div className={styles.briefTitle}>💡 단지 브리핑</div>
              <ul className={styles.briefList}>
                {/* STEP SCORE S3 §13/§16 — score API의 Algorithmic Briefing(강점/확인점/
                    종합문장, AI 미사용)을 1순위로 쓰고, score 데이터가 부족할 때만 기존
                    non-AI 규칙기반 buildAptBrief(거래추세/세대수/거래빈도)로 폴백한다.
                    AI로 채우지 않는다(§16) — scoreResult는 score/briefing이 같은 API
                    응답에서 나오므로 점수-브리핑 모순이 구조적으로 발생하지 않는다(§17). */}
                {scoreResult?.status === 'OK' && scoreResult.briefing
                  ? [...scoreResult.briefing.strengths, ...(scoreResult.briefing.caution ? [scoreResult.briefing.caution] : []), scoreResult.briefing.summary].map(
                      (sentence, i) => <li key={i}>{sentence}</li>
                    )
                  : buildAptBrief({
                      trades: filteredTrades,
                      tradeTypeFilter,
                      totalHouseholds: aptInfo?.['세대수'] ?? null,
                      buildYear: trades.length > 0 && trades[0].buildYear ? parseInt(trades[0].buildYear, 10) : null,
                    }).map((sentence, i) => <li key={i}>{sentence}</li>)}
              </ul>
            </div>
          )}

          {/* [STEP50 V1 CLEANUP] FloorPlanPanel은 항상 "평면도 이미지는 준비 중입니다"만
              보여줬다 — 이 앱에 평면도 이미지/데이터 소스 자체가 없어(FloorPlanPanel.tsx
              주석 참고) 어떤 단지에서도 예외 없이 empty state만 노출한다. 컴포넌트 자체는
              삭제하지 않고(향후 데이터 확보 시 복원 가능) 호출만 제거했다. */}
        </div>
      </div>

      {/* ══════════ 3구역: 단지 주변 생활정보 ══════════ */}
      <div className={`container ${styles.sectionBlock}`}>
        <h2 className={styles.zoneTitle}>단지 주변 생활정보</h2>
        <div className={styles.panel}>
          <div className={styles.infraTabBar}>
            {(['환경', '교통', '학군'] as InfraTab[]).map((tab) => (
              <button
                key={tab}
                className={`${styles.infraTabBtn} ${infraTab === tab ? styles.infraTabBtnActive : ''}`}
                onClick={() => {
                  setInfraTab(tab);
                  setVisitedInfraTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
                }}
              >
                <span className={styles.infraTabIcon}>{tab === '환경' ? '🏡' : tab === '교통' ? '🚇' : '🏫'}</span>
                <span className={styles.infraTabLabel}>{tab === '환경' ? '주거환경' : tab === '교통' ? '교통·편의' : '학군'}</span>
              </button>
            ))}
          </div>

          {visitedInfraTabs.has('환경') && (
            <div style={{ display: infraTab === '환경' ? 'block' : 'none' }}>
              <LivingEnvironmentPanel address={primaryAddress} ready={addressReady} />
            </div>
          )}
          {visitedInfraTabs.has('교통') && (
            <div style={{ display: infraTab === '교통' ? 'block' : 'none' }}>
              <NeighborhoodInfoPanel address={primaryAddress} ready={addressReady} />
            </div>
          )}
          {visitedInfraTabs.has('학군') && (
            <div style={{ display: infraTab === '학군' ? 'block' : 'none' }}>
              <SchoolDistrictPanel address={primaryAddress} ready={addressReady} lawdCd={lawdCdState} />
            </div>
          )}
        </div>
      </div>

      <div className="container">
        <AdContainer variant="native" slot="apt-detail-infra-community" label="스폰서 추천 정보" />
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
