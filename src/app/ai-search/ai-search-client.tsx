'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Header from '@/components/Header';
import FullPageLoader from '@/components/FullPageLoader';
import ShareAction from '@/components/ShareAction';
import InlineLoading from '@/components/ui/InlineLoading';
import { useRegion } from '@/contexts/RegionContext';
import { isQaSuppressed } from '@/lib/analytics/qa-suppression';
import styles from './ai-search-client.module.css';

type AiIntent = 'condition_search' | 'regional_stats' | 'compare';

interface NearestSchoolInfo {
  name: string;
  distanceM: number;
}

interface ConditionSearchComplex {
  name: string;
  dong: string;
  price: string;
  dealAmount: number;
  buildYear: string | null;
  tradeDate: string;
  parkingInfo: string | null;
  parkingPerHousehold: number | null;
  totalHouseholds: number | null;
  nearestSchool: NearestSchoolInfo | null;
}

interface VolumeRankingItem {
  rank: number;
  name: string;
  dong: string;
  dealCount: number;
}

type StatsPeriodKey = '1' | '3' | '6' | '12';

interface RegionalStatsData {
  chartData: { month: string; volume: number; saleIndex: number | null; jeonseIndex: number | null }[];
  volume: number;
  volumeChange: number;
  jeonseRate: number | null;
  volumeRanking: Record<StatsPeriodKey, VolumeRankingItem[]>;
  volumeByPeriod: Record<StatsPeriodKey, number>;
}

interface CompareAreaOption {
  area: string;
  label: string;
  latestPrice: string;
  latestArea: string;
  tradeDate: string;
  tradeCount: number;
}

interface CompareComplexData {
  name: string;
  latestPrice: string | null;
  latestArea: string | null;
  tradeCount: number;
  totalHouseholds: string | null;
  parking: string | null;
  far: string | null;
  bcr: string | null;
  buildYear: string | null;
  facilities: string[];
  areaOptions: CompareAreaOption[];
  // DECISION_JOURNEY_V1 §6 — 상세 페이지 링크에 필요한 identity(name+lawdCd+dong).
  resolvedLawdCd?: string;
  dong?: string;
  // DECISION_JOURNEY_V1.1 — 단일 후보로 좁혀졌을 때만 존재.
  aptSeq?: string | null;
}

interface AiSearchResult {
  success: boolean;
  error?: string;
  intent?: AiIntent;
  briefing?: string;
  lawdCd?: string;
  complexes?: ConditionSearchComplex[];
  stats?: RegionalStatsData;
  complexA?: CompareComplexData;
  complexB?: CompareComplexData;
}

const FOLLOWUP_SUGGESTIONS = [
  { icon: '✨', label: '부산 서구 5억 이하 주차 넉넉한 아파트' },
  { icon: '📊', label: '부산 서구 최근 거래량 보기' },
  { icon: '⚖️', label: '대신더샵 vs 대신롯데캐슬 비교' },
];

export default function AiSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { region } = useRegion();

  const initialQ = searchParams.get('q') || '';
  // STATISTICS REGION FILTER V2 — region.lawdCd는 "시도 전체" 선택 시 null일 수
  // 있다. AI 검색은 특정 시군구 단위로만 동작하는 기능이라(이번 STEP 범위 밖)
  // sido-only일 때는 안전하게 빈 문자열로 폴백한다(기존 lawdCd 필수 동작 유지,
  // 크래시 방지).
  const initialLawdCd = searchParams.get('lawdCd') || region.lawdCd || '';

  const [inputValue, setInputValue] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // COMPARE_V2_PHASE2 §19/§23 — CompareResult(자체 렌더링 표)는 더 이상 유지하지
  // 않는다(Phase 1 감사: 유일한 안정 진입점인 추천 칩조차 실측 재현으로 compare
  // intent 분류에 실패함 — 이 분류 자체를 고치는 건 이번 STEP 범위 밖). intent가
  // 실제로 compare로 분류되고 두 단지가 모두 확인된 드문 경우에는, 이미 확보된
  // identity(name+resolvedLawdCd+dong+aptSeq)를 그대로 canonical Compare URL로
  // 넘겨 리다이렉트한다 — name-only로 다시 검색시키지 않는다.
  useEffect(() => {
    if (!result || result.intent !== 'compare' || !result.complexA || !result.complexB) return;
    const a = result.complexA;
    const b = result.complexB;
    if (!a.resolvedLawdCd || !b.resolvedLawdCd) return;
    const qs = new URLSearchParams();
    const seqs = [a.aptSeq, b.aptSeq].filter(Boolean) as string[];
    if (seqs.length > 0) qs.set('aptSeq', seqs.join(','));
    qs.set('aName', a.name);
    qs.set('aLawdCd', a.resolvedLawdCd);
    qs.set('aDong', a.dong || '');
    qs.set('bName', b.name);
    qs.set('bLawdCd', b.resolvedLawdCd);
    qs.set('bDong', b.dong || '');
    router.push(`/stats/compare?${qs.toString()}`);
  }, [result, router]);

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    const lawdCd = searchParams.get('lawdCd') || region.lawdCd || '';
    setInputValue(q);
    setLoading(true);
    setError(null);
    setResult(null);

    let cancelled = false;
    // 인기 검색어 통계용 — 실제로 질의가 실행되는 이 지점 한 곳에서만 기록한다(입력 중
    // onChange가 아니라 제출된 검색어만).
    if (!isQaSuppressed()) {
      fetch('/api/log/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, qaSuppressed: false }),
        keepalive: true,
      }).catch(() => {});
    }

    fetch('/api/ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, lawdCd }),
    })
      .then((res) => res.json())
      .then((data: AiSearchResult) => {
        if (cancelled) return;
        if (!data.success) {
          setError(data.error || 'AI 검색 중 오류가 발생했습니다.');
        } else {
          setResult(data);
        }
      })
      .catch(() => {
        if (!cancelled) setError('AI 검색 중 오류가 발생했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const runSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/ai-search?q=${encodeURIComponent(trimmed)}&lawdCd=${region.lawdCd || ''}`);
  };

  return (
    <div className={styles.page}>
      <Header hideLogo pageTitle="AI 검색" pageTitleAlign="left" />

      <main className={styles.main}>
        <form
          className={styles.searchBar}
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(inputValue);
          }}
        >
          <input
            className={styles.searchInput}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="예: 부산 서구 5억 이하 신축 아파트"
          />
          <button type="submit" className={styles.searchBtn}>
            🪄 AI 검색
          </button>
        </form>

        <div className={styles.chipRow}>
          {FOLLOWUP_SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" className={styles.chip} onClick={() => runSearch(s.label)}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        <FullPageLoader active={loading} message="이집이가 조건에 맞는 이집을 찾고 있어요." />

        {!loading && error && <div className={styles.errorBox}>{error}</div>}

        {!loading && !error && result && (
          <div className={styles.resultArea}>
            <div className={styles.briefingBox}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <span className={styles.briefingLabel}>
                  <img src="/brand/mascot/ejipy-analyze.webp" alt="" className={styles.briefingIcon} />
                  AI 브리핑
                </span>
                <ShareAction
                  variant="icon"
                  title={`${searchParams.get('q') || initialQ} AI 검색 결과 | 이집`}
                  text={result.briefing}
                />
              </div>
              <p className={styles.briefingText}>{result.briefing}</p>
            </div>

            {result.intent === 'condition_search' && (
              <ConditionSearchResult complexes={result.complexes || []} lawdCd={result.lawdCd || initialLawdCd} />
            )}
            {result.intent === 'regional_stats' && result.stats && (
              <RegionalStatsResult stats={result.stats} lawdCd={result.lawdCd || initialLawdCd} />
            )}
            {result.intent === 'compare' && result.complexA && result.complexB && (
              <InlineLoading message="비교 화면으로 이동하는 중..." />
            )}
          </div>
        )}

        {!loading && !error && !result && (
          <div className={styles.emptyBox}>
            <img src="/brand/mascot/ejipy-search.webp" alt="" className={styles.emptyMascot} />
            궁금한 걸 물어보세요. 예: “부산 서구 5억 이하 신축 아파트”
          </div>
        )}
      </main>
    </div>
  );
}

function ConditionSearchResult({ complexes, lawdCd }: { complexes: ConditionSearchComplex[]; lawdCd: string }) {
  const router = useRouter();

  if (complexes.length === 0) {
    return (
      <div className={styles.emptyBox}>
        <img src="/brand/mascot/ejipy-empty.webp" alt="" className={styles.emptyMascot} />
        찾는 이집이 아직 없어요. 검색 조건을 조금 바꿔보세요.
      </div>
    );
  }

  return (
    <div className={styles.cardGrid}>
      {complexes.map((c) => (
        <div
          key={`${c.dong}-${c.name}`}
          className={styles.card}
          onClick={() => router.push(`/apt/${encodeURIComponent(c.name)}?lawdCd=${lawdCd}&dong=${encodeURIComponent(c.dong)}`)}
        >
          <div className={styles.cardTitle}>{c.name}</div>
          <div className={styles.cardMeta}>{c.dong}</div>
          <div className={styles.cardPrice}>{c.price}</div>
          <div className={styles.cardInfo}>
            {c.totalHouseholds != null && <span>🏢 {c.totalHouseholds.toLocaleString('ko-KR')}세대</span>}
            {c.buildYear && <span>{c.totalHouseholds != null ? ' · ' : ''}{c.buildYear}년 준공</span>}
            {c.parkingInfo && <span>{(c.totalHouseholds != null || c.buildYear) ? ' · ' : ''}{c.parkingInfo}</span>}
          </div>
          {c.nearestSchool && (
            <div className={styles.schoolBadge}>
              {/* SCHOOL V2-C5-A: 직선거리 기준 — 실제 보행경로가 아니므로 "도보 N분"으로 표시하지 않는다 */}
              🏫 {c.nearestSchool.distanceM <= 300 ? '초품아' : `${c.nearestSchool.name} 직선거리 약 ${c.nearestSchool.distanceM}m`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const PERIOD_OPTIONS: { key: StatsPeriodKey; label: string }[] = [
  { key: '1', label: '최근 1개월' },
  { key: '3', label: '최근 3개월' },
  { key: '6', label: '최근 6개월' },
  { key: '12', label: '최근 1년' },
];

function RegionalStatsResult({ stats, lawdCd }: { stats: RegionalStatsData; lawdCd: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState<StatsPeriodKey>('1');
  const [showList, setShowList] = useState(false);
  const periodVolume = stats.volumeByPeriod?.[period] ?? stats.volume;
  const rankingList = stats.volumeRanking?.[period] || [];

  return (
    <div>
      <div className={styles.periodChipRow}>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`${styles.periodChip} ${period === opt.key ? styles.periodChipActive : ''}`}
            onClick={() => setPeriod(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className={styles.statsSummary}>
        <button type="button" className={styles.statCardClickable} onClick={() => setShowList((v) => !v)}>
          <div className={styles.statLabel}>{PERIOD_OPTIONS.find((o) => o.key === period)?.label} 거래량</div>
          <div className={styles.statValue}>{periodVolume}건</div>
          <div className={styles.statCardHint}>{showList ? '목록 접기 ▲' : '상위 단지 보기 ▼'}</div>
        </button>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>전월 대비</div>
          <div className={styles.statValue} style={{ color: stats.volumeChange >= 0 ? 'var(--up-color)' : 'var(--down-color)' }}>
            {stats.volumeChange >= 0 ? '+' : ''}
            {stats.volumeChange}건
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>평균 전세가율</div>
          <div className={styles.statValue}>{stats.jeonseRate != null ? `${stats.jeonseRate}%` : '정보 없음'}</div>
        </div>
      </div>

      <div className={styles.guideCard}>
        <span className={styles.guideCardLabel}>💡 전세가율 지표 가이드</span>
        <p className={styles.guideCardText}>📈 전세가율 상승 (매매가 대비 전세가 높음): 갭투자 리스크 감소, 매매가 하방 지지선 역할 및 갭투자 수요 유입 가능성 증가</p>
        <p className={styles.guideCardText}>📉 전세가율 하락 (매매가 대비 전세가 낮음): 매매가 대비 거주 가치 비중 감소, 실거주자 매수 전환율 저하 또는 매매가 거품 가능성</p>
      </div>

      {showList && (
        <div className={styles.volumeRankingList}>
          {rankingList.length === 0 ? (
            <div className={styles.emptyBox}>해당 기간 거래 내역이 없습니다.</div>
          ) : (
            rankingList.map((item) => (
              <div
                key={`${item.dong}-${item.name}`}
                className={styles.volumeRankingRow}
                onClick={() => router.push(`/apt/${encodeURIComponent(item.name)}?lawdCd=${lawdCd}&dong=${encodeURIComponent(item.dong)}`)}
              >
                <span className={styles.volumeRankingRank}>{item.rank}</span>
                <span className={styles.volumeRankingName}>{item.name}</span>
                <span className={styles.volumeRankingDong}>{item.dong}</span>
                <span className={styles.volumeRankingCount}>{item.dealCount}건</span>
              </div>
            ))
          )}
        </div>
      )}

      {stats.chartData.length > 0 && (
        <div className={styles.chartWrapper}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const data = payload[0].payload as { month: string; volume: number };
                  return (
                    <div className={styles.tooltip}>
                      <p>{data.month}</p>
                      <strong>거래량 {data.volume}건</strong>
                    </div>
                  );
                }}
              />
              <Bar dataKey="volume" name="거래량" fill="var(--primary-color)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

