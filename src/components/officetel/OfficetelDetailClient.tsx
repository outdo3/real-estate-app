'use client';

// OFFICETEL_V1 STEP 4B §7~§19 — 오피스텔 상세 화면.
//
// 정보 우선순위는 아파트 상세 순서를 그대로 베끼지 않는다(§8). 오피스텔은 장기 보유·
// 임대수익 관점의 상품이라 "거래가 실제로 있는가 / 얼마인가"가 먼저고, 건물 스펙은 뒤다:
//   거래 요약 → 매매/전세/월세 → 전용면적 → 추이 → 위치 → 건물 정보 → 주차·규모 → 데이터 안내
//
// 화면이 지어내는 값은 하나도 없다. 없는 값은 전부 "정보 없음"이다.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { formatUseApprovalDate, OFFICETEL_TX_PAGE_SIZE } from '@/lib/officetel/detail-contract';
import { officetelEmptyRowsLabel, type AttributionStatus } from '@/lib/officetel/attribution';
import { getUniqueAreaLabels, resolveAreaLabel } from '@/lib/area-utils';
import OfficetelLocationCard from './OfficetelLocationCard';
import styles from './officetel-detail.module.css';

type TxType = 'sale' | 'rent';
type RentKind = 'jeonse' | 'wolse';
type Tab = 'sale' | 'jeonse' | 'wolse';

interface AreaOption { exclusiveArea: number; label: string; count: number }

interface DetailProps {
  detail: {
    master: {
      id: number;
      canonicalKey: string;
      name: string | null;
      address: { sggCd: string; umdNm: string; jibun: string; buildingDong: string | null; roadAddress: string | null };
      buildYear: number | null;
      useApprovalDate: string | null;
      scale: { unit: string; hoCnt: number | null; label: string | null };
      building: {
        totalArea: number | null; buildingCoverageRatio: number | null; floorAreaRatio: number | null;
        structureName: string | null; groundFloorCount: number | null; undergroundFloorCount: number | null;
        registryMainPurpose: string | null; registryEtcPurpose: string | null;
      };
      parking: { indoorMechanical: number | null; indoorAuto: number | null; outdoorMechanical: number | null; outdoorAuto: number | null; total: number | null };
      coordinates: { latitude: number; longitude: number } | null;
    };
    areas: { sale: AreaOption[]; rent: AreaOption[] };
    summary: {
      sale: { total: number; canceled: number; recentCount: number; recentMonths?: number; latest: { dealDate: string; dealAmount: number; exclusiveArea: number; floor: number } | null };
      rent: {
        total: number; recentJeonseCount: number; recentWolseCount: number; recentMonths?: number;
        latestJeonse: { dealDate: string; deposit: number; exclusiveArea: number; floor: number } | null;
        latestWolse: { dealDate: string; deposit: number; monthlyRent: number; exclusiveArea: number; floor: number } | null;
      };
    };
    dataQuality: {
      cancellation: { coverageFrom: string; note: string };
      /** 연결 0건이 "거래 없음"인지 "동별 귀속 불가"인지 구분한다(FINAL QA). */
      attribution?: {
        status: AttributionStatus;
        unlinkedSale: number;
        unlinkedRent: number;
        mastersAtAddress: number;
        note: string | null;
      };
    };
  };
  /** PERFORMANCE_V2 §3 — 서버가 미리 담아준 기본 탭의 첫 페이지(워터폴 제거용). */
  initialTransactions?: { type: string; rows: any[]; meta: any } | null;
}

/** 만원 단위 정수를 한국식 금액 문자열로. 값을 만들지 않고 표기만 바꾼다.
 *  숫자가 아니면 절대 던지지 않는다 — 렌더 도중 예외 하나가 페이지 전체를 날린다. */
function won(manwon: number | null | undefined): string {
  if (typeof manwon !== 'number' || !Number.isFinite(manwon)) return '정보 없음';
  if (manwon >= 10000) {
    const eok = Math.floor(manwon / 10000);
    const rest = manwon % 10000;
    return rest === 0 ? `${eok}억` : `${eok}억 ${rest.toLocaleString()}만`;
  }
  return `${manwon.toLocaleString()}만`;
}

const NONE = <span className={styles.infoMissing}>정보 없음</span>;
const fmt = (v: number | null | undefined, suffix = '') =>
  v == null ? NONE : <>{typeof v === 'number' ? v.toLocaleString() : v}{suffix}</>;

const PAGE_SIZE = OFFICETEL_TX_PAGE_SIZE;

export default function OfficetelDetailClient({ detail, initialTransactions }: DetailProps) {
  const { master, areas, summary, dataQuality } = detail;
  const [tab, setTab] = useState<Tab>(detail.summary.sale.total > 0 ? 'sale' : 'jeonse');
  const [area, setArea] = useState<number | null>(null);
  // 응답을 **그 응답을 만든 쿼리 키와 함께** 들고 있는다.
  //
  // 왜: 탭을 바꾸면 새 fetch가 끝나기 전에 한 번 더 렌더된다. 그때 이전 탭의 행(예: 매매)이
  // 새 탭(전세) 렌더러로 들어가면 `r.deposit`이 undefined가 되고, 그 값을 포맷하다 예외가
  // 나면서 **페이지 전체가 빈 화면이 됐다**(QA에서 실제로 재현). 키가 다른 응답은 아예
  // 그리지 않는 것이 이 문제를 구조적으로 없애는 방법이다.
  // 서버가 준 첫 페이지를 초기 상태로 심는다 — 첫 렌더에 목록이 이미 있어서
  // hydrate 직후 한 번 더 비었다가 채워지는 왕복이 사라진다.
  const initialTab: Tab = detail.summary.sale.total > 0 ? 'sale' : 'jeonse';
  const initialKey = `${initialTab === 'sale' ? 'sale' : 'rent'}|${initialTab === 'sale' ? '' : 'jeonse'}||${PAGE_SIZE}`;
  const [data, setData] = useState<{ key: string; rows: any[]; meta: any } | null>(
    initialTransactions ? { key: initialKey, rows: initialTransactions.rows, meta: initialTransactions.meta } : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const txType: TxType = tab === 'sale' ? 'sale' : 'rent';
  const rentKind: RentKind | null = tab === 'sale' ? null : tab;
  const areaOptions = txType === 'sale' ? areas.sale : areas.rent;

  // 탭이나 면적이 바뀌면 페이지를 처음부터 다시 센다.
  useEffect(() => { setLimit(PAGE_SIZE); }, [tab, area]);

  // 탭을 바꾸면 그 탭에 없는 면적 선택은 해제한다(빈 목록으로 오해하지 않게).
  useEffect(() => {
    if (area != null && !areaOptions.some((a) => a.exclusiveArea === area)) setArea(null);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const queryKey = `${txType}|${rentKind ?? ''}|${area ?? ''}|${limit}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const qs = new URLSearchParams({ type: txType, limit: String(limit) });
      if (area != null) qs.set('area', String(area));
      // 전세/월세는 서버가 갈라준다 — 페이지를 받아 화면에서 나누면 한쪽 탭이 잘못 비어 보인다.
      if (rentKind) qs.set('rentType', rentKind);
      const res = await fetch(`/api/officetel/${master.id}/transactions?${qs.toString()}`);
      if (!res.ok) throw new Error('bad status');
      const json = await res.json();
      if (!json.success) throw new Error('bad payload');
      setData({ key: queryKey, rows: json.data.rows, meta: json.data.meta });
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [master.id, txType, rentKind, area, limit, queryKey]);

  // 서버가 준 첫 페이지와 현재 쿼리가 같으면 첫 렌더에서 재요청하지 않는다.
  const skipFirstFetchRef = React.useRef(!!initialTransactions);
  useEffect(() => {
    if (skipFirstFetchRef.current && queryKey === initialKey) { skipFirstFetchRef.current = false; return; }
    skipFirstFetchRef.current = false;
    load();
  }, [load, queryKey, initialKey]);

  // 현재 쿼리로 받은 응답일 때만 그린다. 키가 다르면 아직 로딩 중인 것으로 취급한다.
  const fresh = data && data.key === queryKey ? data : null;
  const visibleRows: any[] = fresh ? fresh.rows : [];
  const meta = fresh?.meta ?? null;

  // §14 — 2020 이전 SALE 행이 실제로 보일 때만 안내를 띄운다(모든 행에 경고를 붙이지 않는다).
  const showCancellationNote =
    txType === 'sale' && visibleRows.some((r) => r.cancellationCoverage === 'NOT_PROVIDED_BY_SOURCE');

  // FINAL QA §8 — 페이지 전체가 **하나의** 면적 라벨 맵을 공유한다.
  //
  // 칩만 충돌 해소된 라벨(전용 31.69㎡)을 쓰고 거래행·요약은 원본 float를 그대로
  // 찍어서(전용 31.6862㎡) 같은 면적이 화면 위치에 따라 다르게 보였다. 필터링에 쓰는
  // 값은 여전히 원본 exclusiveArea 그대로다 — 표기만 통일한다.
  const areaLabels = useMemo(() => {
    const all = [
      ...areas.sale.map((a) => a.exclusiveArea),
      ...areas.rent.map((a) => a.exclusiveArea),
      ...visibleRows.map((r) => Number(r.exclusiveArea)),
      summary.sale.latest?.exclusiveArea,
      summary.rent.latestJeonse?.exclusiveArea,
      summary.rent.latestWolse?.exclusiveArea,
    ].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return getUniqueAreaLabels(all);
  }, [areas, visibleRows, summary]);
  const areaLabel = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? resolveAreaLabel(v, areaLabels) : '정보 없음';

  // §22 — 빈 목록이 "진짜 0"인지 "동별로 못 가른 것"인지 서버 판정을 그대로 쓴다.
  const attribution = dataQuality.attribution;
  const attributionStatus: AttributionStatus = attribution?.status ?? 'NO_TRANSACTIONS';

  const displayName = master.name ?? `${master.address.umdNm} ${master.address.jibun} 오피스텔`;
  const addressLine = [master.address.umdNm, master.address.jibun].filter(Boolean).join(' ');

  return (
    <main className={styles.page}>
      {/* ── §7 헤더 ─────────────────────────────────────────────── */}
      <section className={styles.card}>
        <span className={styles.badge}>오피스텔</span>
        <h1 className={styles.headerName}>{displayName}</h1>
        <div className={styles.headerAddress}>
          {master.address.roadAddress ? `${master.address.roadAddress} · ` : ''}
          {addressLine}
          {master.address.buildingDong ? ` ${master.address.buildingDong}` : ''}
        </div>
        <div className={styles.headerFacts}>
          <span className={styles.headerFact}>
            규모 <strong>{master.scale.label ?? '정보 없음'}</strong>
          </span>
          <span className={styles.headerFact}>
            사용승인 <strong>{formatUseApprovalDate(master.useApprovalDate) ?? (master.buildYear ? `${master.buildYear}년` : '정보 없음')}</strong>
          </span>
          <span className={styles.headerFact}>
            층수{' '}
            <strong>
              {master.building.groundFloorCount != null
                ? `지상 ${master.building.groundFloorCount}층${master.building.undergroundFloorCount != null ? ` / 지하 ${master.building.undergroundFloorCount}층` : ''}`
                : '정보 없음'}
            </strong>
          </span>
        </div>
      </section>

      {/* ── §9 거래 요약 ────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>거래 요약</h2>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>최근 매매</div>
            {summary.sale.latest ? (
              <>
                <div className={styles.summaryValue}>{won(summary.sale.latest.dealAmount)}</div>
                <div className={styles.summaryMeta}>
                  {summary.sale.latest.dealDate} · 전용 {areaLabel(summary.sale.latest.exclusiveArea)} · {summary.sale.latest.floor}층
                </div>
              </>
            ) : (
              <div className={styles.summaryEmpty}>최근 거래 정보 없음</div>
            )}
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>최근 전세</div>
            {summary.rent.latestJeonse ? (
              <>
                <div className={styles.summaryValue}>{won(summary.rent.latestJeonse.deposit)}</div>
                <div className={styles.summaryMeta}>
                  {summary.rent.latestJeonse.dealDate} · 전용 {areaLabel(summary.rent.latestJeonse.exclusiveArea)} · {summary.rent.latestJeonse.floor}층
                </div>
              </>
            ) : (
              <div className={styles.summaryEmpty}>최근 거래 정보 없음</div>
            )}
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>최근 월세</div>
            {summary.rent.latestWolse ? (
              <>
                <div className={styles.summaryValue}>
                  {won(summary.rent.latestWolse.deposit)} / {summary.rent.latestWolse.monthlyRent.toLocaleString()}만
                </div>
                <div className={styles.summaryMeta}>
                  {summary.rent.latestWolse.dealDate} · 전용 {areaLabel(summary.rent.latestWolse.exclusiveArea)} · {summary.rent.latestWolse.floor}층
                </div>
              </>
            ) : (
              <div className={styles.summaryEmpty}>최근 거래 정보 없음</div>
            )}
          </div>
        </div>

        {/* FINAL QA — 비어 있는 이유가 "거래 없음"이 아니라면 반드시 밝힌다.
            건수까지 적어야 사용자가 "앱이 못 찾은 것"과 "실제로 없는 것"을 구분한다. */}
        {attribution?.note && (
          <div className={styles.note} style={{ marginTop: '0.85rem' }}>
            {attribution.note}
          </div>
        )}
      </section>

      {/* ── §10~§13 거래 ───────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>실거래</h2>

        <div className={styles.tabs} role="tablist" aria-label="거래 종류">
          {([['sale', '매매'], ['jeonse', '전세'], ['wolse', '월세']] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* §11 — 실제 존재하는 전용면적만. 대표평형/공급면적/평 라벨 없음. */}
        {areaOptions.length > 0 && (
          <div className={styles.chipRow}>
            <button
              type="button"
              className={`${styles.chip} ${area == null ? styles.chipActive : ''}`}
              onClick={() => setArea(null)}
            >
              전체
            </button>
            {areaOptions.map((a) => (
              <button
                key={a.exclusiveArea}
                type="button"
                className={`${styles.chip} ${area === a.exclusiveArea ? styles.chipActive : ''}`}
                onClick={() => setArea(a.exclusiveArea)}
              >
                전용 {areaLabel(a.exclusiveArea)}
              </button>
            ))}
          </div>
        )}

        {(loading || !fresh) && !error && (
          <div className={styles.txList}>
            {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
          </div>
        )}

        {error && <div className={styles.error}>거래 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>}

        {!error && fresh && visibleRows.length === 0 && (
          <div className={styles.empty}>
            {officetelEmptyRowsLabel(tab, attributionStatus)}
          </div>
        )}

        {!error && fresh && visibleRows.length > 0 && (
          <>
            <TrendChart rows={visibleRows} tab={tab} />

            <div className={styles.txList}>
              {visibleRows.map((r) => (
                <div key={r.id} className={styles.txRow}>
                  <div className={styles.txTop}>
                    <span className={styles.txAmount}>
                      {tab === 'sale'
                        ? won(r.dealAmount)
                        : tab === 'jeonse'
                          ? won(r.deposit)
                          : `${won(r.deposit)} / ${r.monthlyRent.toLocaleString()}만`}
                    </span>
                    <span className={styles.txDate}>{r.dealDate}</span>
                  </div>
                  <div className={styles.txMeta}>
                    <span>전용 {areaLabel(Number(r.exclusiveArea))}</span>
                    <span>{r.floor}층</span>
                  </div>
                  {tab !== 'sale' && (
                    <div className={styles.txSub}>
                      <span>계약기간 {r.contractTerm ?? '정보 없음'}</span>
                      <span>계약유형 {r.contractType ?? '정보 없음'}</span>
                      {/* 원천에 "미사용" 값이 없다 — true일 때만 의미가 있다. */}
                      {r.useRenewalRight === true && <span>갱신요구권 사용</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {meta?.hasMore && (
              <button type="button" className={styles.moreBtn} onClick={() => setLimit((n) => n + PAGE_SIZE)} disabled={loading}>
                {loading ? '불러오는 중...' : '더 보기'}
              </button>
            )}
          </>
        )}

        {/* §14 — 해당 구간 거래가 실제로 보일 때만, 목록 아래에 한 번만 안내한다. */}
        {showCancellationNote && (
          <div className={styles.note} style={{ marginTop: '0.8rem' }}>
            {dataQuality.cancellation.coverageFrom.slice(0, 4)}년 이전 거래는 원천 데이터 특성상 계약 해제 여부 확인에 제한이 있습니다.
          </div>
        )}
      </section>

      {/* ── STEP 6 위치 ────────────────────────────────────────── */}
      {/* 좌표는 STEP 5B가 적재한 master 좌표만 쓴다. 없으면 지도를 그리지 않는다. */}
      <OfficetelLocationCard
        coordinates={master.coordinates}
        addressLine={addressLine}
        roadAddress={master.address.roadAddress}
      />

      {/* ── §16 건물 정보 ──────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>
          <Building2 size={15} strokeWidth={2.2} aria-hidden /> 건물 정보
        </h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}><span className={styles.infoLabel}>사용승인일</span><span className={styles.infoValue}>{formatUseApprovalDate(master.useApprovalDate) ?? NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>건축연도</span><span className={styles.infoValue}>{master.buildYear ? `${master.buildYear}년` : NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>지상층</span><span className={styles.infoValue}>{fmt(master.building.groundFloorCount, '층')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>지하층</span><span className={styles.infoValue}>{fmt(master.building.undergroundFloorCount, '층')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>연면적</span><span className={styles.infoValue}>{master.building.totalArea != null ? `${master.building.totalArea.toLocaleString()}㎡` : NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>건폐율</span><span className={styles.infoValue}>{master.building.buildingCoverageRatio != null ? `${master.building.buildingCoverageRatio}%` : NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>용적률</span><span className={styles.infoValue}>{master.building.floorAreaRatio != null ? `${master.building.floorAreaRatio}%` : NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>구조</span><span className={styles.infoValue}>{master.building.structureName ?? NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>주용도</span><span className={styles.infoValue}>{master.building.registryMainPurpose ?? NONE}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>기타용도</span><span className={styles.infoValue}>{master.building.registryEtcPurpose ?? NONE}</span></div>
        </div>
      </section>

      {/* ── 주차 / 규모 ────────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>주차 · 규모</h2>
        <div className={styles.infoGrid}>
          {/* §16 — 원천 4종이 전부 없으면 0이 아니라 정보 없음이다. */}
          <div className={styles.infoItem}><span className={styles.infoLabel}>총 주차</span><span className={styles.infoValue}>{fmt(master.parking.total, '대')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>옥내 자주식</span><span className={styles.infoValue}>{fmt(master.parking.indoorAuto, '대')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>옥내 기계식</span><span className={styles.infoValue}>{fmt(master.parking.indoorMechanical, '대')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>옥외 자주식</span><span className={styles.infoValue}>{fmt(master.parking.outdoorAuto, '대')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>옥외 기계식</span><span className={styles.infoValue}>{fmt(master.parking.outdoorMechanical, '대')}</span></div>
          <div className={styles.infoItem}><span className={styles.infoLabel}>규모</span><span className={styles.infoValue}>{master.scale.label ?? NONE}</span></div>
        </div>
      </section>

      {/* ── §24 데이터 안내 ────────────────────────────────────── */}
      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>데이터 안내</h2>
        <div className={styles.note}>
          국토교통부 실거래가 공개시스템 원천 데이터를 그대로 보여줍니다.
          <ul className={styles.noteList}>
            <li>{dataQuality.cancellation.coverageFrom.slice(0, 4)}년 이전 매매는 계약 해제 여부 확인에 제한이 있습니다.</li>
            <li>매매 목록은 계약이 해제된 거래를 제외하고 보여줍니다.</li>
            <li>전월세는 원천에 계약 해제 항목이 없습니다.</li>
            <li>면적은 전용면적입니다. 공급면적·평형 정보는 제공되지 않습니다.</li>
            <li>규모는 호수 기준입니다.</li>
            <li>계약기간·계약유형은 원천에 없는 경우 정보 없음으로 표시됩니다.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

/**
 * §13 — 원시 거래 포인트만 찍는 아주 단순한 추이. 이동평균·중앙값·역대 최고가를
 * 계산하지 않고, 동일 내용 형제 거래도 합치지 않는다(각 점이 원천 한 행이다).
 * 표본 수 N을 항상 함께 보여준다.
 */
function TrendChart({ rows, tab }: { rows: any[]; tab: Tab }) {
  const points = useMemo(() => {
    const valueOf = (r: any) => (tab === 'sale' ? r.dealAmount : tab === 'jeonse' ? r.deposit : r.monthlyRent);
    return rows
      .map((r) => ({ t: new Date(r.dealDate + 'T00:00:00Z').getTime(), v: valueOf(r) }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
  }, [rows, tab]);

  if (points.length < 2) return null;

  const W = 640, H = 140, PAD = 8;
  const tMin = points[0].t, tMax = points[points.length - 1].t;
  const vMin = Math.min(...points.map((p) => p.v));
  const vMax = Math.max(...points.map((p) => p.v));
  const x = (t: number) => (tMax === tMin ? W / 2 : PAD + ((t - tMin) / (tMax - tMin)) * (W - PAD * 2));
  const y = (v: number) => (vMax === vMin ? H / 2 : H - PAD - ((v - vMin) / (vMax - vMin)) * (H - PAD * 2));

  const unit = tab === 'wolse' ? '만원(월세)' : '만원';
  const from = new Date(tMin).toISOString().slice(0, 10);
  const to = new Date(tMax).toISOString().slice(0, 10);

  return (
    <div className={styles.trendWrap}>
      <svg className={styles.trendSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`거래 추이, 표본 ${points.length}건`}>
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={2.6} fill="#0d9488" opacity={0.75} />
        ))}
      </svg>
      <div className={styles.trendLegend}>
        {from} ~ {to} · 표본 {points.length.toLocaleString()}건 · {vMin.toLocaleString()}~{vMax.toLocaleString()}{unit}
        <br />
        각 점은 실제 신고 거래 1건입니다. 동일 조건 거래를 합치지 않으며 평균·최고가를 표시하지 않습니다.
      </div>
    </div>
  );
}
