'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Header from '@/components/Header';
import { useRegion } from '@/contexts/RegionContext';
import styles from './ai-search-client.module.css';

type AiIntent = 'condition_search' | 'regional_stats' | 'compare';

interface NearestSchoolInfo {
  name: string;
  distanceM: number;
  walkMinutes: number;
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

const COMPARE_ROWS: { key: keyof CompareComplexData; label: string }[] = [
  { key: 'latestPrice', label: '최근 실거래가' },
  { key: 'latestArea', label: '평형' },
  { key: 'totalHouseholds', label: '세대수' },
  { key: 'parking', label: '주차' },
  { key: 'far', label: '용적률' },
  { key: 'bcr', label: '건폐율' },
  { key: 'buildYear', label: '준공' },
];

export default function AiSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { region } = useRegion();

  const initialQ = searchParams.get('q') || '';
  const initialLawdCd = searchParams.get('lawdCd') || region.lawdCd;

  const [inputValue, setInputValue] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = searchParams.get('q');
    if (!q) return;
    const lawdCd = searchParams.get('lawdCd') || region.lawdCd;
    setInputValue(q);
    setLoading(true);
    setError(null);
    setResult(null);

    let cancelled = false;
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
    router.push(`/ai-search?q=${encodeURIComponent(trimmed)}&lawdCd=${region.lawdCd}`);
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

        {loading && (
          <div className={styles.loadingBox}>
            <div className={styles.spinner} />
            AI가 데이터를 분석하고 있어요...
          </div>
        )}

        {!loading && error && <div className={styles.errorBox}>{error}</div>}

        {!loading && !error && result && (
          <div className={styles.resultArea}>
            <div className={styles.briefingBox}>
              <span className={styles.briefingLabel}>🤖 AI 브리핑</span>
              <p className={styles.briefingText}>{result.briefing}</p>
            </div>

            {result.intent === 'condition_search' && (
              <ConditionSearchResult complexes={result.complexes || []} lawdCd={result.lawdCd || initialLawdCd} />
            )}
            {result.intent === 'regional_stats' && result.stats && (
              <RegionalStatsResult stats={result.stats} lawdCd={result.lawdCd || initialLawdCd} />
            )}
            {result.intent === 'compare' && result.complexA && result.complexB && (
              <CompareResult a={result.complexA} b={result.complexB} />
            )}
          </div>
        )}

        {!loading && !error && !result && (
          <div className={styles.emptyBox}>궁금한 걸 물어보세요. 예: “부산 서구 5억 이하 신축 아파트”</div>
        )}
      </main>
    </div>
  );
}

function ConditionSearchResult({ complexes, lawdCd }: { complexes: ConditionSearchComplex[]; lawdCd: string }) {
  const router = useRouter();

  if (complexes.length === 0) {
    return <div className={styles.emptyBox}>조건에 맞는 단지를 찾지 못했습니다.</div>;
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
            {c.buildYear && <span>{c.buildYear}년 준공</span>}
            {c.parkingInfo && <span>{c.buildYear ? ' · ' : ''}{c.parkingInfo}</span>}
          </div>
          {c.nearestSchool && (
            <div className={styles.schoolBadge}>
              🏫 {c.nearestSchool.distanceM <= 300 ? '초품아' : `${c.nearestSchool.name} 도보 ${c.nearestSchool.walkMinutes}분`}
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

// 값이 없거나(정보 없음) 동률이면 우열을 가리지 않는다 — 확인되지 않은 데이터로
// 우열을 지어내지 않기 위함. 가격/평형/용적률/건폐율은 "더 크면 좋다"는 합의가 없어
// 하이라이트 대상에서 제외하고, 세대수(클수록 대단지)·주차(세대당 대수가 넉넉할수록)·
// 준공년도(최근일수록 신축)만 객관적으로 비교 가능한 지표로 본다.
const HIGHLIGHTABLE_KEYS: Array<keyof CompareComplexData> = ['totalHouseholds', 'parking', 'buildYear'];

const parseLeadingNumber = (raw: string | null): number | null => {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
};

function winnerFor(key: keyof CompareComplexData, a: CompareComplexData, b: CompareComplexData): 'a' | 'b' | null {
  if (!HIGHLIGHTABLE_KEYS.includes(key)) return null;
  const av = parseLeadingNumber(a[key] as string | null);
  const bv = parseLeadingNumber(b[key] as string | null);
  if (av == null || bv == null || av === bv) return null;
  return av > bv ? 'a' : 'b';
}

// 비교 표에서 "최근 실거래가"/"평형" 두 행만 선택된 평형에 따라 값이 바뀐다. 나머지
// (세대수/주차/용적률/건폐율/준공/커뮤니티시설)는 단지 단위 정보라 평형과 무관하다.
function AreaDropdown({ options, selectedArea, onChange }: { options: CompareAreaOption[]; selectedArea: string; onChange: (area: string) => void }) {
  if (options.length <= 1) return null;
  return (
    <select
      value={selectedArea}
      onChange={(e) => onChange(e.target.value)}
      className={styles.areaDropdown}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <option key={opt.area} value={opt.area}>
          {opt.label} ({opt.tradeCount}건)
        </option>
      ))}
    </select>
  );
}

function CompareResult({ a, b }: { a: CompareComplexData; b: CompareComplexData }) {
  const [areaA, setAreaA] = useState(a.areaOptions[0]?.area || '');
  const [areaB, setAreaB] = useState(b.areaOptions[0]?.area || '');
  const selectedA = a.areaOptions.find((o) => o.area === areaA) || a.areaOptions[0];
  const selectedB = b.areaOptions.find((o) => o.area === areaB) || b.areaOptions[0];

  return (
    <div className={styles.compareTableWrapper}>
      <table className={styles.compareTable}>
        <colgroup>
          <col style={{ width: '28%' }} />
          <col style={{ width: '36%' }} />
          <col style={{ width: '36%' }} />
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>
              <div className={styles.compareHeaderCell}>
                <span>{a.name}</span>
                <AreaDropdown options={a.areaOptions} selectedArea={areaA} onChange={setAreaA} />
              </div>
            </th>
            <th>
              <div className={styles.compareHeaderCell}>
                <span>{b.name}</span>
                <AreaDropdown options={b.areaOptions} selectedArea={areaB} onChange={setAreaB} />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={styles.compareRowLabel}>최근 실거래가</td>
            <td>{selectedA?.latestPrice || '정보 없음'}</td>
            <td>{selectedB?.latestPrice || '정보 없음'}</td>
          </tr>
          <tr>
            <td className={styles.compareRowLabel}>평형</td>
            <td>{selectedA?.latestArea || '정보 없음'}</td>
            <td>{selectedB?.latestArea || '정보 없음'}</td>
          </tr>
          {COMPARE_ROWS.filter((row) => row.key !== 'latestPrice' && row.key !== 'latestArea').map((row) => {
            const winner = winnerFor(row.key, a, b);
            return (
              <tr key={row.key}>
                <td className={styles.compareRowLabel}>{row.label}</td>
                <td className={winner === 'a' ? styles.winnerCell : undefined}>{(a[row.key] as string) || '정보 없음'}</td>
                <td className={winner === 'b' ? styles.winnerCell : undefined}>{(b[row.key] as string) || '정보 없음'}</td>
              </tr>
            );
          })}
          <tr>
            <td className={styles.compareRowLabel}>커뮤니티시설</td>
            <td>{a.facilities.length > 0 ? a.facilities.join(', ') : '정보 없음'}</td>
            <td>{b.facilities.length > 0 ? b.facilities.join(', ') : '정보 없음'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
